import type { MedianPoint, StrokeRenderMode } from '../types/catalog';

export type { MedianPoint };

/**
 * HanziWriter/MakeMeAHanzi 폰트 좌표계 Y축 변환 상수
 */
export const FONT_TRANSFORM_Y = 900;

const RESAMPLE_COUNT = 32;
const MIN_DRAW_LENGTH = 25;
const SHORT_STROKE_LENGTH = 70;
const REVERSE_CHECK_MIN_LENGTH = 90;

export interface StrokePoint {
  x: number;
  y: number;
  t?: number;
}

export type StrokePresetName = 'strict' | 'normal' | 'lenient';

export interface StrokeConfig {
  name: string;
  startTolerance: number;
  endTolerance: number;
  avgTolerance: number;
  minCosine: number;
  minRatio: number;
  maxRatio: number;
}

export type StrokeEvalOptions = Partial<StrokeConfig> & {
  preset?: StrokePresetName;
  isTopDown?: boolean;
};

export interface StrokeEvalContext {
  character?: string;
  strokeIndex?: number;
  totalStrokes?: number;
  isTopDown?: boolean;
  renderMode?: StrokeRenderMode;
}

export type StrokeFailReason =
  | 'pass'
  | 'too_few_points'
  | 'dot_too_small'
  | 'special_char_rule'
  | 'reversed_stroke'
  | 'start_point_mismatch'
  | 'wrong_direction'
  | 'end_point_mismatch'
  | 'too_short'
  | 'too_long'
  | 'trajectory_deviation';

export interface StrokeEvalMetrics {
  startDist?: number;
  endDist?: number;
  avgTrajectoryDist?: number;
  lengthRatio?: number;
  cosineSim?: number;
  angleDiffDeg?: number;
  userLength?: number;
  targetLength?: number;
  isReversed?: boolean;
}

export interface StrokeEvalChecks {
  passStart: boolean;
  passEnd: boolean;
  passRatio: boolean;
  passCosine: boolean;
  passAvg: boolean;
  passSpecial: boolean;
}

export interface StrokeEvalResult {
  pass: boolean;
  score: number;
  reason: StrokeFailReason;
  feedback: string;
  metrics: StrokeEvalMetrics;
  checks?: StrokeEvalChecks;
  userResampled?: StrokePoint[];
  targetResampled?: StrokePoint[];
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Phase 03에서 확정된 허용 오차 프리셋
 */
export const STROKE_PRESETS: Record<StrokePresetName, StrokeConfig> = {
  strict: {
    name: '엄격 (Strict)',
    startTolerance: 110,
    endTolerance: 130,
    avgTolerance: 95,
    minCosine: 0.80,
    minRatio: 0.70,
    maxRatio: 1.35,
  },
  normal: {
    name: '보통 (Normal)',
    startTolerance: 165,
    endTolerance: 185,
    avgTolerance: 140,
    minCosine: 0.60,
    minRatio: 0.55,
    maxRatio: 1.65,
  },
  lenient: {
    name: '관대 (Lenient)',
    startTolerance: 230,
    endTolerance: 250,
    avgTolerance: 195,
    minCosine: 0.40,
    minRatio: 0.45,
    maxRatio: 2.00,
  },
};

/**
 * 두 점 사이의 유클리드 거리
 */
export function dist(p1: StrokePoint, p2: StrokePoint): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 점 배열의 총 누적 호 길이
 */
export function calcPathLength(points: readonly StrokePoint[]): number {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev && curr) {
      total += dist(prev, curr);
    }
  }
  return total;
}

/**
 * 등간격 N개 점으로 궤적 리샘플링 (선형 보간)
 */
export function resamplePoints(
  points: readonly StrokePoint[],
  numPoints: number,
): StrokePoint[] {
  if (!points || points.length === 0 || numPoints <= 0) return [];
  const first = points[0]!;
  if (numPoints === 1) {
    return [{ x: first.x, y: first.y }];
  }

  if (points.length === 1) {
    return Array.from({ length: numPoints }, () => ({ x: first.x, y: first.y }));
  }

  const totalLength = calcPathLength(points);
  if (totalLength === 0) {
    return Array.from({ length: numPoints }, () => ({ x: first.x, y: first.y }));
  }

  const interval = totalLength / (numPoints - 1);
  const result: StrokePoint[] = [{ x: first.x, y: first.y }];
  let currentDistance = 0;
  let currentIndex = 0;

  for (let i = 1; i < numPoints - 1; i += 1) {
    const targetDist = i * interval;
    let pushed = false;
    while (currentIndex < points.length - 1) {
      const pCurr = points[currentIndex]!;
      const pNext = points[currentIndex + 1]!;
      const segDist = dist(pCurr, pNext);
      if (currentDistance + segDist >= targetDist) {
        const t = segDist === 0 ? 0 : (targetDist - currentDistance) / segDist;
        result.push({
          x: pCurr.x + t * (pNext.x - pCurr.x),
          y: pCurr.y + t * (pNext.y - pCurr.y),
        });
        pushed = true;
        break;
      }
      currentDistance += segDist;
      currentIndex += 1;
    }
    if (!pushed) {
      const last = points[points.length - 1]!;
      result.push({ x: last.x, y: last.y });
    }
  }

  const last = points[points.length - 1]!;
  result.push({ x: last.x, y: last.y });
  return result;
}

/**
 * 메디안 포인트([x, y]) 배열을 표준 SVG top-down 좌표계({x, y})로 변환
 */
export function convertMedianToSvg(
  medianPoints: readonly MedianPoint[],
  isTopDown = true,
): StrokePoint[] {
  if (!medianPoints || medianPoints.length === 0) return [];
  return medianPoints.map(([x, y]) => ({
    x,
    y: isTopDown ? y : FONT_TRANSFORM_Y - y,
  }));
}

/**
 * 점 배열의 바운딩 박스
 */
export function getBoundingBox(points: readonly StrokePoint[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * 두 벡터의 코사인 유사도 [-1.0, 1.0]
 */
export function calcCosineSimilarity(v1: StrokePoint, v2: StrokePoint): number {
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  if (mag1 < 1e-4 || mag2 < 1e-4) return 1.0;
  const dot = v1.x * v2.x + v1.y * v2.y;
  return Math.max(-1.0, Math.min(1.0, dot / (mag1 * mag2)));
}

function resolveConfig(options: StrokeEvalOptions): StrokeConfig {
  const basePreset =
    options.preset && STROKE_PRESETS[options.preset]
      ? STROKE_PRESETS[options.preset]
      : STROKE_PRESETS.normal;

  return {
    name: options.name ?? basePreset.name,
    startTolerance: options.startTolerance ?? basePreset.startTolerance,
    endTolerance: options.endTolerance ?? basePreset.endTolerance,
    avgTolerance: options.avgTolerance ?? basePreset.avgTolerance,
    minCosine: options.minCosine ?? basePreset.minCosine,
    minRatio: options.minRatio ?? basePreset.minRatio,
    maxRatio: options.maxRatio ?? basePreset.maxRatio,
  };
}

function checkSpecialCharacterRules(
  context: StrokeEvalContext,
  userBBox: BoundingBox,
): { pass: boolean; feedback: string | null } {
  const char = context.character;
  const sIndex = context.strokeIndex;

  if (char === '土') {
    if (sIndex === 0 && userBBox.width > 560) {
      return {
        pass: false,
        feedback: '흙 토(土)의 첫 가로획은 짧아야 합니다. 너무 길면 선비 사(士)가 됩니다.',
      };
    }
    if (sIndex === 2 && userBBox.width < 500) {
      return {
        pass: false,
        feedback: '흙 토(土)의 마지막 가로획은 길게 받쳐주어야 합니다.',
      };
    }
  } else if (char === '士') {
    if (sIndex === 0 && userBBox.width < 530) {
      return {
        pass: false,
        feedback: '선비 사(士)의 첫 가로획은 길어야 합니다. 너무 짧으면 흙 토(土)가 됩니다.',
      };
    }
    if (sIndex === 2 && userBBox.width > 540) {
      return {
        pass: false,
        feedback: '선비 사(士)의 마지막 가로획은 짧아야 합니다.',
      };
    }
  } else if (char === '日') {
    if (
      sIndex === 1 &&
      (userBBox.width > 440 || (userBBox.width > 0 && userBBox.height / userBBox.width < 1.35))
    ) {
      return {
        pass: false,
        feedback: '날 일(日)은 세로로 길쭉하게 써야 합니다. 가로가 너무 넓으면 가로 왈(曰)이 됩니다.',
      };
    }
  } else if (char === '曰') {
    if (
      sIndex === 1 &&
      (userBBox.width < 430 || (userBBox.width > 0 && userBBox.height / userBBox.width > 1.35))
    ) {
      return {
        pass: false,
        feedback: '가로 왈(曰)은 가로로 넓게 써야 합니다. 세로가 너무 길면 날 일(日)이 됩니다.',
      };
    }
  }

  return { pass: true, feedback: null };
}

/**
 * 실시간 획 판정 엔진 (1024x1024 좌표계 기준)
 */
export function evaluateStroke(
  userPoints: readonly StrokePoint[],
  targetMedian: readonly MedianPoint[],
  options: StrokeEvalOptions = {},
  context: StrokeEvalContext = {},
): StrokeEvalResult {
  const config = resolveConfig(options);
  const isTopDown = context.isTopDown ?? options.isTopDown ?? true;

  // 1. 최소 점 개수 및 길이 검사
  if (!userPoints || userPoints.length < 2) {
    return {
      pass: false,
      score: 0,
      reason: 'too_few_points',
      feedback: '입력이 너무 짧습니다. 획을 자연스럽게 그어주세요.',
      metrics: {},
    };
  }

  const userRawLength = calcPathLength(userPoints);
  if (userRawLength < MIN_DRAW_LENGTH) {
    return {
      pass: false,
      score: 0,
      reason: 'dot_too_small',
      feedback: '점이 너무 작거나 잘못 눌렸습니다.',
      metrics: { userLength: userRawLength },
    };
  }

  // 2. 메디안 좌표 변환 및 리샘플링
  const targetSvgPoints = convertMedianToSvg(targetMedian, isTopDown);
  if (targetSvgPoints.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: 'too_few_points',
      feedback: '정답 획 좌표 데이터가 비어 있습니다.',
      metrics: {},
    };
  }

  const targetLength = calcPathLength(targetSvgPoints);
  const userResampled = resamplePoints(userPoints, RESAMPLE_COUNT);
  const targetResampled = resamplePoints(targetSvgPoints, RESAMPLE_COUNT);

  const uStart = userResampled[0]!;
  const uEnd = userResampled[RESAMPLE_COUNT - 1]!;
  const tStart = targetResampled[0]!;
  const tEnd = targetResampled[RESAMPLE_COUNT - 1]!;

  // 3. 지표 계산
  const startDist = dist(uStart, tStart);
  const endDist = dist(uEnd, tEnd);

  const userLength = calcPathLength(userResampled);
  const lengthRatio = targetLength > 0 ? userLength / targetLength : 1;

  const userVec: StrokePoint = { x: uEnd.x - uStart.x, y: uEnd.y - uStart.y };
  const targetVec: StrokePoint = { x: tEnd.x - tStart.x, y: tEnd.y - tStart.y };

  let cosineSim = calcCosineSimilarity(userVec, targetVec);
  // 점(丶)처럼 목표 메디안이 매우 짧은 경우 방향성 검사 완화
  if (targetLength < SHORT_STROKE_LENGTH) {
    cosineSim = Math.max(cosineSim, config.minCosine);
  }
  const angleDiffDeg = Math.round(
    Math.acos(Math.max(-1, Math.min(1, cosineSim))) * (180 / Math.PI),
  );

  let totalTrajectoryDist = 0;
  for (let i = 0; i < RESAMPLE_COUNT; i += 1) {
    totalTrajectoryDist += dist(userResampled[i]!, targetResampled[i]!);
  }
  const avgTrajectoryDist = totalTrajectoryDist / RESAMPLE_COUNT;

  const userBBox = getBoundingBox(userResampled);

  // 4. 개별 기준 판정
  const passStart = startDist <= config.startTolerance;
  const passEnd = endDist <= config.endTolerance;
  const passRatio = lengthRatio >= config.minRatio && lengthRatio <= config.maxRatio;
  const passCosine = cosineSim >= config.minCosine;
  const passAvg = avgTrajectoryDist <= config.avgTolerance;

  // 5. 역방향 감지
  const reverseStartDist = dist(uStart, tEnd);
  const reverseEndDist = dist(uEnd, tStart);
  const isReversed =
    cosineSim < -0.3 ||
    (reverseStartDist < startDist &&
      reverseEndDist < endDist &&
      targetLength > REVERSE_CHECK_MIN_LENGTH);

  // 6. 특수 글자 변별성 검사 (土/士, 日/曰)
  const specialCheck = checkSpecialCharacterRules(context, userBBox);
  const specialCheckPass = specialCheck.pass;
  const specialFeedback = specialCheck.feedback;

  // 7. 종합 판정 및 실패 우선순위 결정
  const pass =
    passStart &&
    passEnd &&
    passRatio &&
    passCosine &&
    passAvg &&
    !isReversed &&
    specialCheckPass;

  let reason: StrokeFailReason = 'pass';
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
      feedback = `획의 진행 방향이 어긋났습니다. (사잇각: ${angleDiffDeg}도 / 기준: ${Math.round(
        (Math.acos(config.minCosine) * 180) / Math.PI,
      )}도 이내)`;
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

  // 8. 종합 정확도 점수 (0..100)
  let score = 100;
  score -= (startDist / config.startTolerance) * 15;
  score -= (endDist / config.endTolerance) * 15;
  score -= (avgTrajectoryDist / config.avgTolerance) * 35;
  score -= Math.abs(1 - lengthRatio) * 20;
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
      isReversed,
    },
    checks: {
      passStart,
      passEnd,
      passRatio,
      passCosine,
      passAvg,
      passSpecial: specialCheckPass,
    },
    userResampled,
    targetResampled,
  };
}
