/**
 * Stroke Assist Engine (실시간 획 판정 및 보정 엔진)
 * - 1024x1024 viewBox 기준 판정
 * - HanziWriter/MakeMeAHanzi 폰트 좌표계(Y축 900 반전) 및 표준 Top-Down SVG 좌표계(0..1024) 자동 지원
 * - renderMode ("fill" 외곽선 채우기 / "stroke" 중심선 선 그리기) 지원
 * - 시작점/끝점 오차, 진행 방향(코사인 유사도), 궤적 평균 오차, 길이 비율 검사
 * - 土/士, 日/曰 등 변별력 특수 검사 내장
 */

(function (window) {
  'use strict';

  // Y축 변환 상수 (HanziWriter font coordinate y -> SVG coordinate y)
  const FONT_TRANSFORM_Y = 900;

  // 허용 오차 프리셋 정의
  const PRESETS = {
    strict: {
      name: '엄격 (Strict)',
      startTolerance: 110,
      endTolerance: 130,
      avgTolerance: 95,
      minCosine: 0.80,     // 약 36도 이내
      minRatio: 0.70,
      maxRatio: 1.35
    },
    normal: {
      name: '보통 (Normal)',
      startTolerance: 165,
      endTolerance: 185,
      avgTolerance: 140,
      minCosine: 0.60,     // 약 53도 이내
      minRatio: 0.55,
      maxRatio: 1.65
    },
    lenient: {
      name: '관대 (Lenient)',
      startTolerance: 230,
      endTolerance: 250,
      avgTolerance: 195,
      minCosine: 0.40,     // 약 66도 이내
      minRatio: 0.45,
      maxRatio: 2.00
    }
  };

  /**
   * 두 점 사이의 유클리드 거리
   */
  function dist(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 점 배열의 총 누적 호 길이
   */
  function calcPathLength(points) {
    if (!points || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += dist(points[i - 1], points[i]);
    }
    return total;
  }

  /**
   * 등간격 N개 점으로 궤적 리샘플링 (선형 보간)
   */
  function resample(points, numPoints) {
    if (!points || points.length === 0) return [];
    if (points.length === 1) {
      const res = [];
      for (let i = 0; i < numPoints; i++) res.push({ x: points[0].x, y: points[0].y });
      return res;
    }

    const totalLength = calcPathLength(points);
    if (totalLength === 0) {
      const res = [];
      for (let i = 0; i < numPoints; i++) res.push({ x: points[0].x, y: points[0].y });
      return res;
    }

    const interval = totalLength / (numPoints - 1);
    const result = [{ x: points[0].x, y: points[0].y }];
    let currentDistance = 0;
    let currentIndex = 0;

    for (let i = 1; i < numPoints - 1; i++) {
      const targetDist = i * interval;
      while (currentIndex < points.length - 1) {
        const segDist = dist(points[currentIndex], points[currentIndex + 1]);
        if (currentDistance + segDist >= targetDist) {
          const t = segDist === 0 ? 0 : (targetDist - currentDistance) / segDist;
          result.push({
            x: points[currentIndex].x + t * (points[currentIndex + 1].x - points[currentIndex].x),
            y: points[currentIndex].y + t * (points[currentIndex + 1].y - points[currentIndex].y)
          });
          break;
        } else {
          currentDistance += segDist;
          currentIndex++;
        }
      }
    }
    result.push({ x: points[points.length - 1].x, y: points[points.length - 1].y });
    return result;
  }

  /**
   * 메디안 포인트([x, y]) 배열을 표준 SVG top-down 좌표계({x, y})로 변환
   * @param {Array<[number, number]>} medianPoints 
   * @param {boolean} isTopDown - 이미 0..1024 top-down 좌표계인지 여부
   */
  function convertMedianToSvg(medianPoints, isTopDown = false) {
    if (!medianPoints) return [];
    return medianPoints.map(([x, y]) => ({
      x: x,
      y: isTopDown ? y : (FONT_TRANSFORM_Y - y)
    }));
  }

  /**
   * 점 배열의 바운딩 박스
   */
  function getBoundingBox(points) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return {
      minX, maxX, minY, maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * 벡터 코사인 유사도
   */
  function calcCosineSimilarity(v1, v2) {
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    if (mag1 < 1e-4 || mag2 < 1e-4) return 1.0;
    const dot = v1.x * v2.x + v1.y * v2.y;
    return Math.max(-1.0, Math.min(1.0, dot / (mag1 * mag2)));
  }

  /**
   * 실시간 획 판정 엔진
   * @param {Array<{x:number, y:number}>} userPoints - 사용자가 입력한 궤적 점 목록 (viewBox 0..1024)
   * @param {Array<[number, number]>} targetMedian - 현재 획의 정답 메디안 좌표
   * @param {Object} options - 판정 옵션 (프리셋 또는 개별 파라미터)
   * @param {Object} context - 글자 컨텍스트 ({ character, strokeIndex, totalStrokes, isTopDown, renderMode })
   */
  function evaluateStroke(userPoints, targetMedian, options = {}, context = {}) {
    const config = Object.assign({}, PRESETS.normal, options);
    const N = 32; // 리샘플링 포인트 수

    // 좌표계 확인: context.isTopDown 또는 options.isTopDown
    const isTopDown = !!(context.isTopDown || options.isTopDown);

    // 1. 최소 점 개수 및 길이 검사
    if (!userPoints || userPoints.length < 2) {
      return {
        pass: false,
        score: 0,
        reason: 'too_few_points',
        feedback: '입력이 너무 짧습니다. 획을 자연스럽게 그어주세요.',
        metrics: {}
      };
    }

    const userRawLength = calcPathLength(userPoints);
    if (userRawLength < 25) {
      return {
        pass: false,
        score: 0,
        reason: 'dot_too_small',
        feedback: '점이 너무 작거나 잘못 눌렸습니다.',
        metrics: { userLength: userRawLength }
      };
    }

    // 2. 메디안 좌표 변환 및 리샘플링
    const targetSvgPoints = convertMedianToSvg(targetMedian, isTopDown);
    const targetLength = calcPathLength(targetSvgPoints);

    const userResampled = resample(userPoints, N);
    const targetResampled = resample(targetSvgPoints, N);

    // 3. 지표 계산
    // 3.1 시작점 및 끝점 거리
    const startDist = dist(userResampled[0], targetResampled[0]);
    const endDist = dist(userResampled[N - 1], targetResampled[N - 1]);

    // 3.2 길이 비율
    const userLength = calcPathLength(userResampled);
    const lengthRatio = targetLength > 0 ? (userLength / targetLength) : 1;

    // 3.3 방향 벡터 (시작 -> 끝 전체 벡터)
    const userVec = {
      x: userResampled[N - 1].x - userResampled[0].x,
      y: userResampled[N - 1].y - userResampled[0].y
    };
    const targetVec = {
      x: targetResampled[N - 1].x - targetResampled[0].x,
      y: targetResampled[N - 1].y - targetResampled[0].y
    };

    let cosineSim = calcCosineSimilarity(userVec, targetVec);
    // 점(丶) 처럼 목표 메디안이 매우 짧은 경우(길이 < 70) 방향성 검사를 완화
    if (targetLength < 70) {
      cosineSim = Math.max(cosineSim, config.minCosine);
    }
    const angleDiffDeg = Math.round(Math.acos(Math.max(-1, Math.min(1, cosineSim))) * (180 / Math.PI));

    // 3.4 궤적 평균 오차 (리샘플링 유클리드 거리)
    let totalTrajectoryDist = 0;
    for (let i = 0; i < N; i++) {
      totalTrajectoryDist += dist(userResampled[i], targetResampled[i]);
    }
    const avgTrajectoryDist = totalTrajectoryDist / N;

    // 3.5 바운딩 박스
    const userBBox = getBoundingBox(userResampled);
    const targetBBox = getBoundingBox(targetResampled);

    // 4. 개별 기준 판정
    const passStart = startDist <= config.startTolerance;
    const passEnd = endDist <= config.endTolerance;
    const passRatio = (lengthRatio >= config.minRatio && lengthRatio <= config.maxRatio);
    const passCosine = (cosineSim >= config.minCosine);
    const passAvg = (avgTrajectoryDist <= config.avgTolerance);

    // 5. 역방향(반대로 씀) 특별 감지
    // 시작점이 목표 끝점에 가깝고, 끝점이 목표 시작점에 가까우며 코사인이 음수일 때
    const reverseStartDist = dist(userResampled[0], targetResampled[N - 1]);
    const reverseEndDist = dist(userResampled[N - 1], targetResampled[0]);
    const isReversed = (cosineSim < -0.3) || (reverseStartDist < startDist && reverseEndDist < endDist && targetLength > 90);

    // 6. 특수 글자 변별성 검사 (土 / 士, 日 / 曰)
    let specialCheckPass = true;
    let specialFeedback = null;
    const char = context.character;
    const sIndex = context.strokeIndex;

    if (char === '土') {
      // 흙 토(土): 1획(index 0)은 짧은 가로, 3획(index 2)은 긴 가로
      if (sIndex === 0) {
        if (userBBox.width > 560) {
          specialCheckPass = false;
          specialFeedback = '흙 토(土)의 첫 가로획은 짧아야 합니다. 너무 길면 선비 사(士)가 됩니다.';
        }
      } else if (sIndex === 2) {
        if (userBBox.width < 500) {
          specialCheckPass = false;
          specialFeedback = '흙 토(土)의 마지막 가로획은 길게 받쳐주어야 합니다.';
        }
      }
    } else if (char === '士') {
      // 선비 사(士): 1획(index 0)은 긴 가로, 3획(index 2)은 짧은 가로
      if (sIndex === 0) {
        if (userBBox.width < 530) {
          specialCheckPass = false;
          specialFeedback = '선비 사(士)의 첫 가로획은 길어야 합니다. 너무 짧으면 흙 토(土)가 됩니다.';
        }
      } else if (sIndex === 2) {
        if (userBBox.width > 540) {
          specialCheckPass = false;
          specialFeedback = '선비 사(士)의 마지막 가로획은 짧아야 합니다.';
        }
      }
    } else if (char === '日') {
      // 날 일(日): 세로로 길쭉한 직사각형 (정답 h/w ~ 1.96, w ~ 347)
      if (sIndex === 1) { // 꺾임 획 (ㄱ 형태)
        if (userBBox.width > 440 || (userBBox.width > 0 && userBBox.height / userBBox.width < 1.35)) {
          specialCheckPass = false;
          specialFeedback = '날 일(日)은 세로로 길쭉하게 써야 합니다. 가로가 너무 넓으면 가로 왈(曰)이 됩니다.';
        }
      }
    } else if (char === '曰') {
      // 가로 왈(曰): 가로로 넓적한 직사각형 (정답 h/w ~ 1.08, w ~ 517)
      if (sIndex === 1) {
        if (userBBox.width < 430 || (userBBox.width > 0 && userBBox.height / userBBox.width > 1.35)) {
          specialCheckPass = false;
          specialFeedback = '가로 왈(曰)은 가로로 넓게 써야 합니다. 세로가 너무 길면 날 일(日)이 됩니다.';
        }
      }
    }

    // 7. 종합 통과 여부 및 피드백 결정
    let pass = passStart && passEnd && passRatio && passCosine && passAvg && !isReversed && specialCheckPass;

    let reason = 'pass';
    let feedback = '완벽합니다! 다음 획을 쓰세요.';

    if (!pass) {
      if (specialFeedback) {
        reason = 'special_char_rule';
        feedback = specialFeedback;
      } else if (isReversed) {
        reason = 'reversed_stroke';
        feedback = '획의 방향이 반대입니다. 올바른 방향으로 그어주세요.';
      } else if (!passStart) {
        reason = 'start_point_mismatch';
        feedback = `시작 위치가 벗어났습니다. (오차: ${Math.round(startDist)}px / 기준: ${config.startTolerance}px)`;
      } else if (!passCosine) {
        reason = 'wrong_direction';
        feedback = `획의 진행 방향이 어긋났습니다. (사잇각: ${angleDiffDeg}도 / 기준: ${Math.round(Math.acos(config.minCosine) * 180 / Math.PI)}도 이내)`;
      } else if (!passEnd) {
        reason = 'end_point_mismatch';
        feedback = `끝 위치가 벗어났습니다. (오차: ${Math.round(endDist)}px / 기준: ${config.endTolerance}px)`;
      } else if (!passRatio) {
        if (lengthRatio < config.minRatio) {
          reason = 'too_short';
          feedback = `획의 길이가 너무 짧습니다. (길이 비율: ${Math.round(lengthRatio * 100)}%)`;
        } else {
          reason = 'too_long';
          feedback = `획의 길이가 너무 깁니다. (길이 비율: ${Math.round(lengthRatio * 100)}%)`;
        }
      } else if (!passAvg) {
        reason = 'trajectory_deviation';
        feedback = `획의 궤적이 정해진 경로를 벗어났습니다. (평균 오차: ${Math.round(avgTrajectoryDist)}px)`;
      }
    }

    // 종합 정확도 점수 계산 (100점 만점)
    let score = 100;
    score -= (startDist / config.startTolerance) * 15;
    score -= (endDist / config.endTolerance) * 15;
    score -= (avgTrajectoryDist / config.avgTolerance) * 35;
    score -= (Math.abs(1 - lengthRatio)) * 20;
    score -= (1 - Math.max(0, cosineSim)) * 15;
    if (isReversed) score -= 40;
    if (!specialCheckPass) score -= 30;
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      pass,
      score,
      reason,
      feedback,
      metrics: {
        startDist: Math.round(startDist),
        endDist: Math.round(endDist),
        avgTrajectoryDist: Math.round(avgTrajectoryDist),
        lengthRatio: parseFloat(lengthRatio.toFixed(2)),
        cosineSim: parseFloat(cosineSim.toFixed(2)),
        angleDiffDeg,
        userLength: Math.round(userLength),
        targetLength: Math.round(targetLength),
        isReversed
      },
      checks: {
        passStart,
        passEnd,
        passRatio,
        passCosine,
        passAvg,
        passSpecial: specialCheckPass
      },
      userResampled,
      targetResampled
    };
  }

  // 글로벌 네임스페이스 등록
  window.StrokeEngine = {
    FONT_TRANSFORM_Y,
    PRESETS,
    dist,
    calcPathLength,
    resample,
    convertMedianToSvg,
    getBoundingBox,
    calcCosineSimilarity,
    evaluateStroke
  };

})(window);
