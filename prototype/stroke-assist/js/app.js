/**
 * Stroke Assist & Inspection Viewer Application
 * Pure Vanilla JavaScript - No external dependencies
 * Supports both fill (contour) and stroke (centerline) rendering modes
 * Supports both 0..1024 top-down and font-inverted coordinate systems
 */

(function () {
  'use strict';

  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================
  const state = {
    currentMode: 'assist', // 'assist' | 'review'

    // Mode A: Stroke Assist State
    assist: {
      charKey: '土',
      charData: null,
      currentStrokeIndex: 0,
      completedStrokes: [],
      isDrawing: false,
      userPoints: [],
      activePreset: 'normal',
      tolerance: Object.assign({}, window.StrokeEngine ? window.StrokeEngine.PRESETS.normal : {}),
      guides: {
        ghost: true,
        hint: true,
        numbers: true
      },
      recentEval: null,
      isAutoPlaying: false
    },

    // Mode B: 637 & 159 Inspection Review State
    review: {
      items: [],
      selectedItem: null,
      selectedStrokeData: null,
      filters: {
        scope: 'high159', // 'high159' | 'all637' | 'manual'
        search: '',
        category: 'ALL',
        status: 'ALL'
      },
      animator: {
        isPlaying: false,
        currentStep: 0,
        timer: null
      }
    }
  };

  // LocalStorage Key
  const STORAGE_KEY_REVIEW = 'hanja_stroke_assist_review_v2';

  // In-memory cache for normalized_strokes.json if fetched
  let cachedNormalizedBundle = null;

  // DOM Elements Cache
  const els = {};

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    initReviewData();
    initToleranceSliders();
    bindEvents();
    renderReviewStats();
    renderReviewTable();

    // Preload normalized_strokes.json only when the full 637-character JS bundle is not loaded
    if (!hasFullStrokeBundle()) {
      tryPreloadNormalizedStrokes();
    }

    // Initialize Assist Mode
    await initAssistMode();

    // Select first item in review if available
    if (state.review.items.length > 0) {
      const initialItem = state.review.items.find(x => x.isHighPriority159) || state.review.items[0];
      selectReviewItem(initialItem);
    }
  });

  function cacheElements() {
    // Mode tabs
    els.tabAssist = document.getElementById('tabAssist');
    els.tabReview = document.getElementById('tabReview');
    els.viewAssist = document.getElementById('viewAssist');
    els.viewReview = document.getElementById('viewReview');

    // Assist Canvas & SVG
    els.drawingCanvas = document.getElementById('drawingCanvas');
    els.ctx = els.drawingCanvas ? els.drawingCanvas.getContext('2d') : null;
    els.stageWrapper = document.getElementById('stageWrapper');
    els.svgGhost = document.getElementById('svgGhost');
    els.svgSnapped = document.getElementById('svgSnapped');
    els.svgHint = document.getElementById('svgHint');
    els.feedbackOverlay = document.getElementById('feedbackOverlay');
    els.completeCard = document.getElementById('completeCard');

    // Assist Meta & Stats
    els.charHuge = document.getElementById('charHuge');
    els.charMetaTitle = document.getElementById('charMetaTitle');
    els.charMetaSub = document.getElementById('charMetaSub');
    els.strokeCounterText = document.getElementById('strokeCounterText');
    els.strokePills = document.getElementById('strokePills');
    els.charQuickBtns = document.querySelectorAll('.char-btn');

    // Debugger & Metrics
    els.metricStatusBadge = document.getElementById('metricStatusBadge');
    els.metricScoreNum = document.getElementById('metricScoreNum');
    els.metricScoreBar = document.getElementById('metricScoreBar');
    els.metricFeedbackText = document.getElementById('metricFeedbackText');
    els.valStartDist = document.getElementById('valStartDist');
    els.valEndDist = document.getElementById('valEndDist');
    els.valAvgDist = document.getElementById('valAvgDist');
    els.valLenRatio = document.getElementById('valLenRatio');
    els.valAngle = document.getElementById('valAngle');
    els.specialAlertBox = document.getElementById('specialAlertBox');

    // Sliders
    els.sliderStart = document.getElementById('sliderStart');
    els.sliderEnd = document.getElementById('sliderEnd');
    els.sliderAvg = document.getElementById('sliderAvg');
    els.sliderCos = document.getElementById('sliderCos');
    els.sliderRatio = document.getElementById('sliderRatio');
    els.valSliderStart = document.getElementById('valSliderStart');
    els.valSliderEnd = document.getElementById('valSliderEnd');
    els.valSliderAvg = document.getElementById('valSliderAvg');
    els.valSliderCos = document.getElementById('valSliderCos');
    els.valSliderRatio = document.getElementById('valSliderRatio');

    // Action buttons
    els.btnReset = document.getElementById('btnReset');
    els.btnUndo = document.getElementById('btnUndo');
    els.btnAutoPlay = document.getElementById('btnAutoPlay');
    els.chkGhost = document.getElementById('chkGhost');
    els.chkHint = document.getElementById('chkHint');
    els.chkNumbers = document.getElementById('chkNumbers');

    // Review Mode Controls
    els.reviewScopeFilter = document.getElementById('reviewScopeFilter');
    els.reviewSearch = document.getElementById('reviewSearch');
    els.reviewCategoryFilter = document.getElementById('reviewCategoryFilter');
    els.reviewStatusFilter = document.getElementById('reviewStatusFilter');
    els.reviewTableBody = document.getElementById('reviewTableBody');
    els.statTotal = document.getElementById('statTotal');
    els.statPending = document.getElementById('statPending');
    els.statVerified = document.getElementById('statVerified');
    els.statShapeCorrection = document.getElementById('statShapeCorrection');
    els.statOrderCorrection = document.getElementById('statOrderCorrection');
    els.statExcluded = document.getElementById('statExcluded');

    // Review Detail
    els.detailCharBox = document.getElementById('detailCharBox');
    els.detailTitle = document.getElementById('detailTitle');
    els.detailSubMeta = document.getElementById('detailSubMeta');
    els.detailNoteBox = document.getElementById('detailNoteBox');
    els.animatorStage = document.getElementById('animatorStage');
    els.btnAnimPlay = document.getElementById('btnAnimPlay');
    els.btnAnimPrev = document.getElementById('btnAnimPrev');
    els.btnAnimNext = document.getElementById('btnAnimNext');
    els.btnAnimReset = document.getElementById('btnAnimReset');
    els.animStepText = document.getElementById('animStepText');
    els.reviewNotesInput = document.getElementById('reviewNotesInput');
    els.btnSaveReview = document.getElementById('btnSaveReview');
    els.btnExportJson = document.getElementById('btnExportJson');
    els.btnImportJson = document.getElementById('btnImportJson');
    els.btnPracticeInAssist = document.getElementById('btnPracticeInAssist');
  }

  // ==========================================================================
  // REVIEW DATA MANAGEMENT
  // ==========================================================================
  function initReviewData() {
    // Determine base catalog
    let baseList = [];
    if (window.ALL_CHARACTERS_637 && Array.isArray(window.ALL_CHARACTERS_637)) {
      baseList = JSON.parse(JSON.stringify(window.ALL_CHARACTERS_637));
    } else if (window.REVIEW_TARGETS_159 && Array.isArray(window.REVIEW_TARGETS_159)) {
      baseList = JSON.parse(JSON.stringify(window.REVIEW_TARGETS_159));
    }

    // Merge saved status from LocalStorage if available
    const saved = localStorage.getItem(STORAGE_KEY_REVIEW);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const statusMap = new Map(parsed.map(x => [x.id || x.character, x]));
          baseList.forEach(it => {
            const key = it.id || it.character;
            if (statusMap.has(key)) {
              const savedItem = statusMap.get(key);
              it.reviewStatus = savedItem.reviewStatus || it.reviewStatus;
              it.notes = savedItem.notes || it.notes;
            }
          });
        }
      } catch (e) {
        console.warn('LocalStorage review parse error:', e);
      }
    }

    state.review.items = baseList;
  }

  function saveReviewData() {
    try {
      localStorage.setItem(STORAGE_KEY_REVIEW, JSON.stringify(state.review.items));
    } catch (e) {
      console.error('LocalStorage save error:', e);
    }
  }

  // ==========================================================================
  // RENDERING HELPERS: Fill (Contour) vs Stroke (Centerline)
  // ==========================================================================
  function getCharRenderMode(charData) {
    if (charData && charData.renderMode) return charData.renderMode; // 'fill' or 'stroke'
    if (charData && charData.provider === 'kanjivg') return 'stroke';
    return 'fill';
  }

  function isTopDownCoord(charData) {
    if (!charData) return false;
    return charData.coordinateSystem === 'top-down' ||
           charData.coordinateSystem === 'standard-svg' ||
           charData.isTopDown === true;
  }

  function getSvgGroupTransform(charData) {
    return isTopDownCoord(charData) ? '' : 'transform="translate(0, 900) scale(1, -1)"';
  }

  /**
   * Render SVG path string based on renderMode ('fill' vs 'stroke')
   */
  function buildSvgPathElement(pathD, {
    renderMode = 'fill',
    color = '#1e293b',
    opacity = 1,
    strokeWidth = 52
  } = {}) {
    if (renderMode === 'stroke') {
      return `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />`;
    } else {
      return `<path d="${pathD}" fill="${color}" stroke="none" opacity="${opacity}" />`;
    }
  }

  // ==========================================================================
  // STROKE DATA FETCHING PIPELINE (637 CHARACTERS SUPPORT)
  // ==========================================================================
  function getStrokeBundleCount() {
    const bundle = window.STROKE_DATA_BUNDLE;
    if (!bundle) return 0;
    if (Array.isArray(bundle.characters)) return bundle.characters.length;
    return Object.keys(bundle).filter(k => k !== 'characters' && k !== 'metadata').length;
  }

  function hasFullStrokeBundle() {
    const expectedCount = Array.isArray(window.ALL_CHARACTERS_637) && window.ALL_CHARACTERS_637.length > 0
      ? window.ALL_CHARACTERS_637.length
      : 637;
    return getStrokeBundleCount() >= expectedCount;
  }

  async function tryPreloadNormalizedStrokes() {
    if (cachedNormalizedBundle) return;
    const candidatePaths = [
      'data/strokes/normalized_strokes.json',
      '../../data/strokes/normalized_strokes.json'
    ];
    for (const p of candidatePaths) {
      try {
        const resp = await fetch(p);
        if (resp.ok) {
          const bundle = await resp.json();
          // Map to character dictionary
          if (bundle.characters && Array.isArray(bundle.characters)) {
            cachedNormalizedBundle = new Map(bundle.characters.map(c => [c.character, c]));
            console.log(`[Stroke Assist] Loaded ${cachedNormalizedBundle.size} normalized strokes bundle from ${p}!`);
            return;
          } else if (typeof bundle === 'object') {
            cachedNormalizedBundle = new Map(Object.entries(bundle));
            return;
          }
        }
      } catch (e) {
        // file:/// or not found yet
      }
    }
  }

  async function fetchStrokeData(char) {
    // Priority 1: Standalone JS bundle (window.STROKE_DATA_BUNDLE) for file:/// protocol
    if (window.STROKE_DATA_BUNDLE) {
      if (window.STROKE_DATA_BUNDLE[char]) return window.STROKE_DATA_BUNDLE[char];
      if (window.STROKE_DATA_BUNDLE.characters && Array.isArray(window.STROKE_DATA_BUNDLE.characters)) {
        const found = window.STROKE_DATA_BUNDLE.characters.find(c => c.character === char);
        if (found) return found;
      }
    }

    // Priority 2: Built-in 12 samples
    if (window.SAMPLE_STROKES && window.SAMPLE_STROKES[char]) {
      return window.SAMPLE_STROKES[char];
    }

    // Priority 3: Cached normalized strokes bundle
    if (cachedNormalizedBundle && cachedNormalizedBundle.has(char)) {
      return cachedNormalizedBundle.get(char);
    }

    // Priority 4: Try fetching normalized_strokes.json if not already tried
    await tryPreloadNormalizedStrokes();
    if (cachedNormalizedBundle && cachedNormalizedBundle.has(char)) {
      return cachedNormalizedBundle.get(char);
    }

    // Priority 5: Try individual stroke JSON files
    const codePoint = char.codePointAt(0).toString(16).toUpperCase();
    const candidatePaths = [
      `data/strokes/${codePoint}.json`,
      `../../data/strokes/${codePoint}.json`,
      `data/strokes/${encodeURIComponent(char)}.json`,
      `../../data/strokes/${encodeURIComponent(char)}.json`
    ];

    for (const p of candidatePaths) {
      try {
        const resp = await fetch(p);
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.strokes && data.strokes.length > 0) {
            return data;
          }
        }
      } catch (e) {
        // try next
      }
    }

    return null;
  }

  // ==========================================================================
  // MODE A: STROKE ASSIST LOGIC
  // ==========================================================================
  async function initAssistMode() {
    resizeCanvas();
    await loadAssistCharacter(state.assist.charKey);
  }

  function resizeCanvas() {
    if (!els.drawingCanvas || !els.stageWrapper) return;
    const rect = els.stageWrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    els.drawingCanvas.width = rect.width * dpr;
    els.drawingCanvas.height = rect.height * dpr;
    if (els.ctx) {
      els.ctx.scale(dpr, dpr);
    }
  }

  window.addEventListener('resize', () => {
    resizeCanvas();
  });

  async function loadAssistCharacter(char) {
    state.assist.charKey = char;
    state.assist.currentStrokeIndex = 0;
    state.assist.completedStrokes = [];
    state.assist.recentEval = null;

    const data = await fetchStrokeData(char);
    if (data && data.strokes && data.strokes.length > 0) {
      state.assist.charData = data;
      setupAssistUI();
    } else {
      alert(`글자 [${char}]의 획 벡터 데이터가 아직 준비되지 않았습니다. 내장 샘플 글자를 선택해 주세요.`);
    }
  }

  function setupAssistUI() {
    const data = state.assist.charData;
    if (!data) return;

    // Update Quick Buttons Active State
    if (els.charQuickBtns) {
      els.charQuickBtns.forEach(btn => {
        if (btn.dataset.char === state.assist.charKey) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }

    // Meta text
    const foundTarget = state.review.items.find(item => item.character === state.assist.charKey);
    const reading = foundTarget ? foundTarget.docReading : (getFallbackReading(state.assist.charKey));
    const codePoint = 'U+' + state.assist.charKey.codePointAt(0).toString(16).toUpperCase();
    const renderMode = getCharRenderMode(data);
    const modeBadge = renderMode === 'stroke' ? ' (선 모드)' : '';

    if (els.charHuge) els.charHuge.textContent = state.assist.charKey;
    if (els.charMetaTitle) els.charMetaTitle.textContent = `${state.assist.charKey} (${reading})${modeBadge}`;
    if (els.charMetaSub) els.charMetaSub.textContent = `${codePoint} · 총 ${data.strokes.length}획 · 정규 필순`;

    // Reset Complete Card
    if (els.completeCard) els.completeCard.classList.remove('show');

    // Render Canvas & SVGs
    renderAssistStage();
    updateStrokeCounter();
    clearDrawingCanvas();
    resetDebuggerMetrics();
  }

  function getFallbackReading(char) {
    const map = {
      '土': '토: 흙', '士': '사: 선비', '日': '일: 날', '曰': '왈: 가로',
      '木': '목: 나무', '永': '영: 길다', '學': '학: 배우다', '道': '도: 길',
      '馬': '마: 말', '國': '국: 나라', '火': '화: 불', '九': '구: 아홉'
    };
    return map[char] || '한자';
  }

  function renderAssistStage() {
    const data = state.assist.charData;
    if (!data) return;
    const renderMode = getCharRenderMode(data);
    const transformAttr = getSvgGroupTransform(data);

    // 1. Ghost Outline Layer
    if (els.svgGhost) {
      if (state.assist.guides.ghost) {
        let ghostHtml = `<g ${transformAttr}>`;
        data.strokes.forEach((pathD) => {
          ghostHtml += buildSvgPathElement(pathD, {
            renderMode,
            color: '#1e293b',
            opacity: renderMode === 'stroke' ? 0.12 : 0.08,
            strokeWidth: 48
          });
        });
        ghostHtml += `</g>`;
        els.svgGhost.innerHTML = ghostHtml;
      } else {
        els.svgGhost.innerHTML = '';
      }
    }

    // 2. Snapped Strokes Layer
    renderSnappedStrokes();

    // 3. Hint / Current Stroke Median Layer
    renderHintLayer();
  }

  function renderSnappedStrokes() {
    if (!els.svgSnapped || !state.assist.charData) return;
    const data = state.assist.charData;
    const renderMode = getCharRenderMode(data);
    const transformAttr = getSvgGroupTransform(data);

    let html = `<g ${transformAttr}>`;
    state.assist.completedStrokes.forEach(strokeIdx => {
      const pathD = data.strokes[strokeIdx];
      html += buildSvgPathElement(pathD, {
        renderMode,
        color: '#1e293b',
        opacity: 1,
        strokeWidth: 54
      });
    });
    html += `</g>`;
    els.svgSnapped.innerHTML = html;
  }

  function renderHintLayer() {
    if (!els.svgHint || !state.assist.charData) return;
    const data = state.assist.charData;
    const curIdx = state.assist.currentStrokeIndex;

    // If all strokes done, clear hint
    if (curIdx >= data.strokes.length || !state.assist.guides.hint) {
      els.svgHint.innerHTML = '';
      return;
    }

    const median = data.medians ? data.medians[curIdx] : null;
    if (!median || median.length === 0) {
      els.svgHint.innerHTML = '';
      return;
    }

    const isTopDown = isTopDownCoord(data);
    const medianSvg = window.StrokeEngine.convertMedianToSvg(median, isTopDown);

    let pathD = `M ${medianSvg[0].x} ${medianSvg[0].y}`;
    for (let i = 1; i < medianSvg.length; i++) {
      pathD += ` L ${medianSvg[i].x} ${medianSvg[i].y}`;
    }

    const startP = medianSvg[0];

    let html = '';
    // Hint line (dashed blue)
    html += `<path d="${pathD}" fill="none" stroke="#2563eb" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8 8" opacity="0.65" />`;

    // Start point pulsing circle
    html += `<circle cx="${startP.x}" cy="${startP.y}" r="20" fill="#2563eb" opacity="0.85" />`;
    html += `<circle cx="${startP.x}" cy="${startP.y}" r="8" fill="#ffffff" />`;

    // Stroke Number Badge
    if (state.assist.guides.numbers) {
      html += `<g transform="translate(${startP.x - 28}, ${startP.y - 28})">
        <circle cx="16" cy="16" r="14" fill="#2563eb" />
        <text x="16" y="21" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">${curIdx + 1}</text>
      </g>`;
    }

    els.svgHint.innerHTML = html;
  }

  function updateStrokeCounter() {
    if (!state.assist.charData) return;
    const total = state.assist.charData.strokes.length;
    const current = state.assist.currentStrokeIndex;

    if (els.strokeCounterText) {
      els.strokeCounterText.textContent = `현재 획: ${Math.min(current + 1, total)} / ${total}`;
    }

    if (els.strokePills) {
      let pillsHtml = '';
      for (let i = 0; i < total; i++) {
        let cls = 'stroke-pill';
        if (state.assist.completedStrokes.includes(i)) {
          cls += ' done';
        } else if (i === current) {
          cls += ' current';
        }
        pillsHtml += `<div class="${cls}"></div>`;
      }
      els.strokePills.innerHTML = pillsHtml;
    }
  }

  function clearDrawingCanvas() {
    if (!els.ctx || !els.drawingCanvas) return;
    els.ctx.clearRect(0, 0, els.drawingCanvas.width, els.drawingCanvas.height);
  }

  // ==========================================================================
  // POINTER DRAWING & EVALUATION (CORE REQUIREMENT)
  // ==========================================================================
  function getCanvasPoint(evt) {
    const rect = els.stageWrapper.getBoundingClientRect();
    const x = (evt.clientX - rect.left) * (1024 / rect.width);
    const y = (evt.clientY - rect.top) * (1024 / rect.height);
    return { x, y, t: performance.now() };
  }

  function handlePointerDown(evt) {
    if (!state.assist.charData || state.assist.currentStrokeIndex >= state.assist.charData.strokes.length) return;
    state.assist.isDrawing = true;
    try {
      els.drawingCanvas.setPointerCapture(evt.pointerId);
    } catch (e) {}

    const pt = getCanvasPoint(evt);
    state.assist.userPoints = [pt];

    clearDrawingCanvas();
    drawUserStroke(state.assist.userPoints, '#2563eb');
  }

  function handlePointerMove(evt) {
    if (!state.assist.isDrawing) return;
    const pt = getCanvasPoint(evt);
    state.assist.userPoints.push(pt);
    drawUserStroke(state.assist.userPoints, '#2563eb');
  }

  function handlePointerUp(evt) {
    if (!state.assist.isDrawing) return;
    state.assist.isDrawing = false;
    try {
      els.drawingCanvas.releasePointerCapture(evt.pointerId);
    } catch (e) {}

    // Evaluate stroke!
    evaluateUserStroke();
  }

  function drawUserStroke(points, color = '#2563eb', lineWidth = 16) {
    if (!els.ctx || !points || points.length < 1) return;
    const rect = els.stageWrapper.getBoundingClientRect();
    const scale = rect.width / 1024;

    clearDrawingCanvas();
    els.ctx.save();
    els.ctx.strokeStyle = color;
    els.ctx.fillStyle = color;
    els.ctx.lineWidth = lineWidth * scale;
    els.ctx.lineCap = 'round';
    els.ctx.lineJoin = 'round';

    if (points.length === 1) {
      els.ctx.beginPath();
      els.ctx.arc(points[0].x * scale, points[0].y * scale, (lineWidth / 2) * scale, 0, Math.PI * 2);
      els.ctx.fill();
    } else {
      els.ctx.beginPath();
      els.ctx.moveTo(points[0].x * scale, points[0].y * scale);
      for (let i = 1; i < points.length; i++) {
        els.ctx.lineTo(points[i].x * scale, points[i].y * scale);
      }
      els.ctx.stroke();
    }
    els.ctx.restore();
  }

  /**
   * Core Stroke Evaluation Logic
   */
  function evaluateUserStroke() {
    const data = state.assist.charData;
    const curIdx = state.assist.currentStrokeIndex;
    if (!data || curIdx >= data.strokes.length) return;

    const targetMedian = data.medians ? data.medians[curIdx] : null;
    if (!targetMedian) {
      showFeedback(false, '이 글자의 중심선 궤적 데이터가 없습니다.');
      return;
    }

    const context = {
      character: state.assist.charKey,
      strokeIndex: curIdx,
      totalStrokes: data.strokes.length,
      isTopDown: isTopDownCoord(data),
      renderMode: getCharRenderMode(data)
    };

    const evalResult = window.StrokeEngine.evaluateStroke(
      state.assist.userPoints,
      targetMedian,
      state.assist.tolerance,
      context
    );

    state.assist.recentEval = evalResult;
    updateDebuggerMetrics(evalResult);

    if (evalResult.pass) {
      // PASS: Snap to regular SVG stroke instantly!
      showFeedback(true, evalResult.feedback || '정확합니다!');

      state.assist.completedStrokes.push(curIdx);
      state.assist.currentStrokeIndex++;

      // Flash user line green, then snap to regular vector
      drawUserStroke(state.assist.userPoints, '#10b981');
      setTimeout(() => {
        clearDrawingCanvas();
        renderSnappedStrokes();
        renderHintLayer();
        updateStrokeCounter();

        // Check if all strokes completed
        if (state.assist.currentStrokeIndex >= data.strokes.length) {
          triggerHanjaCompletion();
        }
      }, 120);

    } else {
      // FAIL: DO NOT auto-replace! Keep previous successful strokes intact.
      showFeedback(false, evalResult.feedback || '다시 시도해 보세요.');

      // Flash red line, then remove
      drawUserStroke(state.assist.userPoints, '#ef4444');
      setTimeout(() => {
        clearDrawingCanvas();
      }, 450);
    }
  }

  function showFeedback(isSuccess, message) {
    if (!els.feedbackOverlay) return;
    els.feedbackOverlay.textContent = message;
    els.feedbackOverlay.className = `feedback-overlay show ${isSuccess ? 'success' : 'fail'}`;

    clearTimeout(els.feedbackTimer);
    els.feedbackTimer = setTimeout(() => {
      els.feedbackOverlay.classList.remove('show');
    }, 2200);
  }

  function triggerHanjaCompletion() {
    if (els.completeCard) {
      els.completeCard.classList.add('show');
    }
    showFeedback(true, `축하합니다! [${state.assist.charKey}] 쓰기를 모두 완성했습니다.`);
  }

  // ==========================================================================
  // DEBUGGER & METRICS DISPLAY
  // ==========================================================================
  function resetDebuggerMetrics() {
    if (els.metricStatusBadge) {
      els.metricStatusBadge.textContent = '대기중';
      els.metricStatusBadge.className = 'metric-status-badge';
    }
    if (els.metricScoreNum) els.metricScoreNum.textContent = '--';
    if (els.metricScoreBar) els.metricScoreBar.style.width = '0%';
    if (els.metricFeedbackText) els.metricFeedbackText.textContent = '획을 그으면 실시간 판정 결과가 표시됩니다.';
    if (els.valStartDist) els.valStartDist.textContent = '-';
    if (els.valEndDist) els.valEndDist.textContent = '-';
    if (els.valAvgDist) els.valAvgDist.textContent = '-';
    if (els.valLenRatio) els.valLenRatio.textContent = '-';
    if (els.valAngle) els.valAngle.textContent = '-';
    if (els.specialAlertBox) els.specialAlertBox.classList.remove('show');
  }

  function updateDebuggerMetrics(res) {
    if (!res) return;

    if (els.metricStatusBadge) {
      els.metricStatusBadge.textContent = res.pass ? '통과 (PASS)' : '오류 (FAIL)';
      els.metricStatusBadge.className = `metric-status-badge ${res.pass ? 'pass' : 'fail'}`;
    }
    if (els.metricScoreNum) els.metricScoreNum.textContent = `${res.score}점`;
    if (els.metricScoreBar) {
      els.metricScoreBar.style.width = `${res.score}%`;
      els.metricScoreBar.style.backgroundColor = res.pass ? 'var(--success-color)' : 'var(--danger-color)';
    }
    if (els.metricFeedbackText) {
      els.metricFeedbackText.textContent = res.feedback;
    }

    const m = res.metrics || {};
    const c = res.checks || {};

    if (els.valStartDist) {
      els.valStartDist.textContent = `${m.startDist}px / ${state.assist.tolerance.startTolerance}px`;
      els.valStartDist.className = `val ${c.passStart ? 'status-pass' : 'status-fail'}`;
    }
    if (els.valEndDist) {
      els.valEndDist.textContent = `${m.endDist}px / ${state.assist.tolerance.endTolerance}px`;
      els.valEndDist.className = `val ${c.passEnd ? 'status-pass' : 'status-fail'}`;
    }
    if (els.valAvgDist) {
      els.valAvgDist.textContent = `${m.avgTrajectoryDist}px / ${state.assist.tolerance.avgTolerance}px`;
      els.valAvgDist.className = `val ${c.passAvg ? 'status-pass' : 'status-fail'}`;
    }
    if (els.valLenRatio) {
      els.valLenRatio.textContent = `${Math.round(m.lengthRatio * 100)}% (${state.assist.tolerance.minRatio * 100}% ~ ${state.assist.tolerance.maxRatio * 100}%)`;
      els.valLenRatio.className = `val ${c.passRatio ? 'status-pass' : 'status-fail'}`;
    }
    if (els.valAngle) {
      els.valAngle.textContent = `${m.angleDiffDeg}° (코사인: ${m.cosineSim})`;
      els.valAngle.className = `val ${c.passCosine ? 'status-pass' : 'status-fail'}`;
    }

    // Special Alert for 土 / 士 / 日 / 曰
    if (els.specialAlertBox) {
      if (res.reason === 'special_char_rule') {
        els.specialAlertBox.textContent = `[특수 판정 경고] ${res.feedback}`;
        els.specialAlertBox.classList.add('show');
      } else {
        els.specialAlertBox.classList.remove('show');
      }
    }
  }

  // ==========================================================================
  // TOLERANCE CONTROLS & PRESETS (PHASE 03 EXPERIMENTAL UI)
  // ==========================================================================
  function initToleranceSliders() {
    updateSliderUI();

    if (els.sliderStart) {
      els.sliderStart.addEventListener('input', (e) => {
        state.assist.tolerance.startTolerance = parseInt(e.target.value, 10);
        state.assist.activePreset = 'custom';
        updateSliderUI();
      });
    }
    if (els.sliderEnd) {
      els.sliderEnd.addEventListener('input', (e) => {
        state.assist.tolerance.endTolerance = parseInt(e.target.value, 10);
        state.assist.activePreset = 'custom';
        updateSliderUI();
      });
    }
    if (els.sliderAvg) {
      els.sliderAvg.addEventListener('input', (e) => {
        state.assist.tolerance.avgTolerance = parseInt(e.target.value, 10);
        state.assist.activePreset = 'custom';
        updateSliderUI();
      });
    }
    if (els.sliderCos) {
      els.sliderCos.addEventListener('input', (e) => {
        state.assist.tolerance.minCosine = parseFloat(e.target.value);
        state.assist.activePreset = 'custom';
        updateSliderUI();
      });
    }
    if (els.sliderRatio) {
      els.sliderRatio.addEventListener('input', (e) => {
        const spread = parseFloat(e.target.value);
        state.assist.tolerance.minRatio = parseFloat((1 - spread).toFixed(2));
        state.assist.tolerance.maxRatio = parseFloat((1 + spread).toFixed(2));
        state.assist.activePreset = 'custom';
        updateSliderUI();
      });
    }

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const presetKey = btn.dataset.preset;
        if (presetKey && window.StrokeEngine.PRESETS[presetKey]) {
          state.assist.activePreset = presetKey;
          state.assist.tolerance = Object.assign({}, window.StrokeEngine.PRESETS[presetKey]);
          updateSliderUI();
        }
      });
    });
  }

  function updateSliderUI() {
    const t = state.assist.tolerance;
    if (els.sliderStart) els.sliderStart.value = t.startTolerance;
    if (els.sliderEnd) els.sliderEnd.value = t.endTolerance;
    if (els.sliderAvg) els.sliderAvg.value = t.avgTolerance;
    if (els.sliderCos) els.sliderCos.value = t.minCosine;
    if (els.sliderRatio) els.sliderRatio.value = (t.maxRatio - 1).toFixed(2);

    if (els.valSliderStart) els.valSliderStart.textContent = `${t.startTolerance}px`;
    if (els.valSliderEnd) els.valSliderEnd.textContent = `${t.endTolerance}px`;
    if (els.valSliderAvg) els.valSliderAvg.textContent = `${t.avgTolerance}px`;
    if (els.valSliderCos) els.valSliderCos.textContent = `${t.minCosine} (약 ${Math.round(Math.acos(t.minCosine) * 180 / Math.PI)}°)`;
    if (els.valSliderRatio) els.valSliderRatio.textContent = `±${Math.round((t.maxRatio - 1) * 100)}%`;

    document.querySelectorAll('.preset-btn').forEach(btn => {
      if (btn.dataset.preset === state.assist.activePreset) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // ==========================================================================
  // MODE B: 159 & 637 INSPECTION VIEWER
  // ==========================================================================
  function getFilteredReviewItems() {
    const query = state.review.filters.search.trim().toLowerCase();
    const scope = state.review.filters.scope;
    const cat = state.review.filters.category;
    const status = state.review.filters.status;

    return state.review.items.filter(item => {
      // 1. Scope filter
      if (scope === 'high159' && !item.isHighPriority159) return false;
      if (scope === 'manual' && !item.needsManualReview) return false;

      // 2. Search
      if (query) {
        const matchChar = item.character.includes(query);
        const matchReading = item.docReading.toLowerCase().includes(query) || (item.readingDisplay && item.readingDisplay.toLowerCase().includes(query));
        const matchUcode = item.codePoint.toLowerCase().includes(query);
        if (!matchChar && !matchReading && !matchUcode) return false;
      }

      // 3. Category
      if (cat !== 'ALL' && !item.category.includes(cat)) return false;

      // 4. Status
      if (status !== 'ALL') {
        const curStatus = item.reviewStatus || '대기';
        if (status === '대기' && curStatus !== '대기') return false;
        if (status === '일치' && curStatus !== '일치') return false;
        if (status === '자형보정' && !curStatus.includes('자형')) return false;
        if (status === '필순보정' && !curStatus.includes('필순')) return false;
        if (status === '제외' && curStatus !== '제외') return false;
      }

      return true;
    });
  }

  function renderReviewStats() {
    const scopeItems = state.review.items.filter(item => {
      const scope = state.review.filters.scope;
      if (scope === 'high159') return item.isHighPriority159;
      if (scope === 'manual') return item.needsManualReview;
      return true;
    });

    const total = scopeItems.length;
    let pending = 0, verified = 0, shapeCorrection = 0, orderCorrection = 0, excluded = 0;

    scopeItems.forEach(it => {
      const st = it.reviewStatus || '대기';
      if (st === '대기') pending++;
      else if (st === '일치') verified++;
      else if (st.includes('자형')) shapeCorrection++;
      else if (st.includes('필순')) orderCorrection++;
      else if (st === '제외') excluded++;
    });

    if (els.statTotal) els.statTotal.textContent = total;
    if (els.statPending) els.statPending.textContent = pending;
    if (els.statVerified) els.statVerified.textContent = verified;
    if (els.statShapeCorrection) els.statShapeCorrection.textContent = shapeCorrection;
    if (els.statOrderCorrection) els.statOrderCorrection.textContent = orderCorrection;
    if (els.statExcluded) els.statExcluded.textContent = excluded;
  }

  function renderReviewTable() {
    if (!els.reviewTableBody) return;
    const filtered = getFilteredReviewItems();

    let html = '';
    filtered.forEach(it => {
      const isSelected = state.review.selectedItem && state.review.selectedItem.id === it.id;
      const curStatus = it.reviewStatus || '대기';
      let badgeClass = '대기';
      if (curStatus === '일치') badgeClass = '일치';
      else if (curStatus.includes('자형')) badgeClass = '자형보정';
      else if (curStatus.includes('필순')) badgeClass = '필순보정';
      else if (curStatus === '제외') badgeClass = '제외';

      const seqLabel = it.isHighPriority159 ? `★${it.seq159 || it.order}` : it.order;

      html += `<tr class="${isSelected ? 'selected' : ''}" data-id="${it.id}">
        <td>${seqLabel}</td>
        <td class="char-cell">${it.character}</td>
        <td><strong>${it.docReading}</strong><br><span style="font-size:11px;color:var(--gray-500)">${it.codePoint}</span></td>
        <td><span style="font-size:11px;color:var(--gray-600)">${it.category}</span></td>
        <td><span class="status-badge ${badgeClass}">${curStatus}</span></td>
      </tr>`;
    });

    if (filtered.length === 0) {
      html = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--gray-500)">일치하는 검수 대상 한자가 없습니다.</td></tr>`;
    }

    els.reviewTableBody.innerHTML = html;

    els.reviewTableBody.querySelectorAll('tr[data-id]').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.id;
        const found = state.review.items.find(x => x.id === id);
        if (found) selectReviewItem(found);
      });
    });
  }

  async function selectReviewItem(item) {
    state.review.selectedItem = item;
    renderReviewTable();

    if (els.detailCharBox) els.detailCharBox.textContent = item.character;
    if (els.detailTitle) els.detailTitle.textContent = `${item.character} (${item.docReading})`;
    if (els.detailSubMeta) {
      const priorityTag = item.isHighPriority159 ? ' [집중검수 159자]' : ' [일반 한자]';
      els.detailSubMeta.textContent = `${item.id} · ${item.codePoint} · ${item.category}${priorityTag}`;
    }
    if (els.detailNoteBox) {
      els.detailNoteBox.textContent = item.detail;
    }
    if (els.reviewNotesInput) {
      els.reviewNotesInput.value = item.notes || '';
    }

    // Set Radio status
    const curStatus = item.reviewStatus || '대기';
    document.querySelectorAll('.radio-pill-label').forEach(label => {
      const radio = label.querySelector('input[type="radio"]');
      if (radio && radio.value === curStatus) {
        radio.checked = true;
        label.classList.add('selected');
      } else {
        label.classList.remove('selected');
      }
    });

    await loadReviewStrokeData(item.character);
  }

  async function loadReviewStrokeData(char) {
    state.review.selectedStrokeData = null;
    state.review.animator.currentStep = 0;
    stopAnimation();

    const data = await fetchStrokeData(char);
    if (data && data.strokes && data.strokes.length > 0) {
      state.review.selectedStrokeData = data;
      renderAnimatorStage();
    } else {
      renderAnimatorFallback(char);
    }
  }

  function renderAnimatorStage() {
    if (!els.animatorStage) return;
    const data = state.review.selectedStrokeData;
    if (!data) return;

    const totalStrokes = data.strokes.length;
    const currentStep = state.review.animator.currentStep;
    const renderMode = getCharRenderMode(data);
    const transformAttr = getSvgGroupTransform(data);
    const isTopDown = isTopDownCoord(data);

    if (els.animStepText) {
      const modeLabel = renderMode === 'stroke' ? ' (선 모드)' : '';
      els.animStepText.textContent = `획 진행: ${currentStep} / ${totalStrokes}획${modeLabel}`;
    }

    let svgHtml = `<svg viewBox="0 0 1024 1024" width="100%" height="100%" style="display:block;">
      <defs>
        <pattern id="grid" width="512" height="512" patternUnits="userSpaceOnUse">
          <line x1="512" y1="0" x2="512" y2="1024" stroke="#e2e8f0" stroke-width="2" />
          <line x1="0" y1="512" x2="1024" y2="512" stroke="#e2e8f0" stroke-width="2" />
          <line x1="0" y1="0" x2="1024" y2="1024" stroke="#f1f5f9" stroke-width="2" stroke-dasharray="8 8" />
          <line x1="1024" y1="0" x2="0" y2="1024" stroke="#f1f5f9" stroke-width="2" stroke-dasharray="8 8" />
        </pattern>
      </defs>
      <rect width="1024" height="1024" fill="#ffffff" />
      <rect width="1024" height="1024" fill="url(#grid)" />
      
      <!-- Ghost background for full character -->
      <g ${transformAttr}>`;

    data.strokes.forEach((pathD) => {
      svgHtml += buildSvgPathElement(pathD, {
        renderMode,
        color: '#1e293b',
        opacity: renderMode === 'stroke' ? 0.12 : 0.08,
        strokeWidth: 48
      });
    });

    // Render strokes up to currentStep
    const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b', '#ef4444'];
    for (let i = 0; i < currentStep && i < totalStrokes; i++) {
      const pathD = data.strokes[i];
      const strokeColor = colors[i % colors.length];
      svgHtml += buildSvgPathElement(pathD, {
        renderMode,
        color: strokeColor,
        opacity: 1,
        strokeWidth: 54
      });
    }
    svgHtml += `</g>`;

    // Render Stroke Numbers and Start Points
    if (data.medians) {
      for (let i = 0; i < currentStep && i < totalStrokes; i++) {
        const med = data.medians[i];
        if (med && med.length > 0) {
          const startX = med[0][0];
          const startY = isTopDown ? med[0][1] : (900 - med[0][1]);
          svgHtml += `<g transform="translate(${startX - 18}, ${startY - 18})">
            <circle cx="18" cy="18" r="16" fill="#1e293b" />
            <text x="18" y="24" font-size="16" font-weight="bold" fill="#ffffff" text-anchor="middle">${i + 1}</text>
          </g>`;
        }
      }
    }

    svgHtml += `</svg>`;
    els.animatorStage.innerHTML = svgHtml;
  }

  function renderAnimatorFallback(char) {
    if (!els.animatorStage) return;
    if (els.animStepText) els.animStepText.textContent = '획 데이터: 1단계 데이터 구축 대기중';

    els.animatorStage.innerHTML = `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--gray-50);color:var(--gray-500);text-align:center;padding:20px;">
      <div style="font-family:var(--font-hanja);font-size:96px;color:var(--gray-400);line-height:1;">${char}</div>
      <div style="font-size:12px;margin-top:12px;color:var(--gray-600);font-weight:600;">1단계 데이터 다운로드 후 자동 연동됩니다.</div>
      <div style="font-size:11px;color:var(--gray-400);margin-top:4px;">(경로: data/strokes/normalized_strokes.json)</div>
    </div>`;
  }

  function stepAnimation(forward = true) {
    const data = state.review.selectedStrokeData;
    if (!data) return;
    const total = data.strokes.length;

    if (forward) {
      if (state.review.animator.currentStep < total) {
        state.review.animator.currentStep++;
      } else {
        stopAnimation();
      }
    } else {
      if (state.review.animator.currentStep > 0) {
        state.review.animator.currentStep--;
      }
    }
    renderAnimatorStage();
  }

  function startAnimation() {
    const data = state.review.selectedStrokeData;
    if (!data) return;
    stopAnimation();

    if (state.review.animator.currentStep >= data.strokes.length) {
      state.review.animator.currentStep = 0;
    }

    state.review.animator.isPlaying = true;
    if (els.btnAnimPlay) els.btnAnimPlay.textContent = '⏸ 일시정지';

    state.review.animator.timer = setInterval(() => {
      if (state.review.animator.currentStep < data.strokes.length) {
        stepAnimation(true);
      } else {
        stopAnimation();
      }
    }, 600);
  }

  function stopAnimation() {
    state.review.animator.isPlaying = false;
    if (state.review.animator.timer) {
      clearInterval(state.review.animator.timer);
      state.review.animator.timer = null;
    }
    if (els.btnAnimPlay) els.btnAnimPlay.textContent = '▶ 필순 재생';
  }

  // ==========================================================================
  // EVENT BINDINGS
  // ==========================================================================
  function bindEvents() {
    // Mode Switch
    if (els.tabAssist) {
      els.tabAssist.addEventListener('click', () => switchMode('assist'));
    }
    if (els.tabReview) {
      els.tabReview.addEventListener('click', () => switchMode('review'));
    }

    // Pointer Events for Assist Canvas
    if (els.drawingCanvas) {
      els.drawingCanvas.addEventListener('pointerdown', handlePointerDown);
      els.drawingCanvas.addEventListener('pointermove', handlePointerMove);
      els.drawingCanvas.addEventListener('pointerup', handlePointerUp);
      els.drawingCanvas.addEventListener('pointercancel', handlePointerUp);
      els.drawingCanvas.addEventListener('contextmenu', e => e.preventDefault());
    }

    // Character Quick Select Buttons
    if (els.charQuickBtns) {
      els.charQuickBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const char = btn.dataset.char;
          if (char) loadAssistCharacter(char);
        });
      });
    }

    // Reset & Undo
    if (els.btnReset) {
      els.btnReset.addEventListener('click', () => {
        state.assist.currentStrokeIndex = 0;
        state.assist.completedStrokes = [];
        clearDrawingCanvas();
        renderSnappedStrokes();
        renderHintLayer();
        updateStrokeCounter();
        resetDebuggerMetrics();
        if (els.completeCard) els.completeCard.classList.remove('show');
        showFeedback(true, '다시 쓰기를 시작합니다.');
      });
    }

    if (els.btnUndo) {
      els.btnUndo.addEventListener('click', () => {
        if (state.assist.completedStrokes.length > 0) {
          state.assist.completedStrokes.pop();
          state.assist.currentStrokeIndex = Math.max(0, state.assist.currentStrokeIndex - 1);
          clearDrawingCanvas();
          renderSnappedStrokes();
          renderHintLayer();
          updateStrokeCounter();
          resetDebuggerMetrics();
          if (els.completeCard) els.completeCard.classList.remove('show');
          showFeedback(true, '이전 획을 취소했습니다.');
        }
      });
    }

    // Display Guide Checkboxes
    if (els.chkGhost) {
      els.chkGhost.addEventListener('change', (e) => {
        state.assist.guides.ghost = e.target.checked;
        renderAssistStage();
      });
    }
    if (els.chkHint) {
      els.chkHint.addEventListener('change', (e) => {
        state.assist.guides.hint = e.target.checked;
        renderHintLayer();
      });
    }
    if (els.chkNumbers) {
      els.chkNumbers.addEventListener('change', (e) => {
        state.assist.guides.numbers = e.target.checked;
        renderHintLayer();
      });
    }

    // Review Scope Filter
    if (els.reviewScopeFilter) {
      els.reviewScopeFilter.addEventListener('change', (e) => {
        state.review.filters.scope = e.target.value;
        renderReviewStats();
        renderReviewTable();
      });
    }

    // Review Search & Filters
    if (els.reviewSearch) {
      els.reviewSearch.addEventListener('input', (e) => {
        state.review.filters.search = e.target.value;
        renderReviewTable();
      });
    }
    if (els.reviewCategoryFilter) {
      els.reviewCategoryFilter.addEventListener('change', (e) => {
        state.review.filters.category = e.target.value;
        renderReviewTable();
      });
    }
    if (els.reviewStatusFilter) {
      els.reviewStatusFilter.addEventListener('change', (e) => {
        state.review.filters.status = e.target.value;
        renderReviewTable();
      });
    }

    // Review Status Radio Pills
    document.querySelectorAll('.radio-pill-label').forEach(label => {
      label.addEventListener('click', () => {
        document.querySelectorAll('.radio-pill-label').forEach(l => l.classList.remove('selected'));
        label.classList.add('selected');
        const radio = label.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
      });
    });

    // Save Review Button
    if (els.btnSaveReview) {
      els.btnSaveReview.addEventListener('click', () => {
        if (!state.review.selectedItem) return;
        const selectedRadio = document.querySelector('input[name="reviewStatus"]:checked');
        const statusVal = selectedRadio ? selectedRadio.value : '대기';
        const notesVal = els.reviewNotesInput ? els.reviewNotesInput.value.trim() : '';

        state.review.selectedItem.reviewStatus = statusVal;
        state.review.selectedItem.notes = notesVal;

        saveReviewData();
        renderReviewStats();
        renderReviewTable();
        alert(`[${state.review.selectedItem.character}] 검수 상태가 '${statusVal}'(으)로 저장되었습니다.`);
      });
    }

    // Review Animator Controls
    if (els.btnAnimPlay) {
      els.btnAnimPlay.addEventListener('click', () => {
        if (state.review.animator.isPlaying) {
          stopAnimation();
        } else {
          startAnimation();
        }
      });
    }
    if (els.btnAnimNext) {
      els.btnAnimNext.addEventListener('click', () => {
        stopAnimation();
        stepAnimation(true);
      });
    }
    if (els.btnAnimPrev) {
      els.btnAnimPrev.addEventListener('click', () => {
        stopAnimation();
        stepAnimation(false);
      });
    }
    if (els.btnAnimReset) {
      els.btnAnimReset.addEventListener('click', () => {
        stopAnimation();
        state.review.animator.currentStep = 0;
        renderAnimatorStage();
      });
    }

    // Export Review JSON
    if (els.btnExportJson) {
      els.btnExportJson.addEventListener('click', () => {
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state.review.items, null, 2));
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute('href', dataStr);
        downloadAnchor.setAttribute('download', `hanja_review_data_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      });
    }

    // Import Review JSON
    if (els.btnImportJson) {
      els.btnImportJson.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (re) => {
            try {
              const imported = JSON.parse(re.target.result);
              if (Array.isArray(imported)) {
                state.review.items = imported;
                saveReviewData();
                renderReviewStats();
                renderReviewTable();
                if (state.review.items.length > 0) selectReviewItem(state.review.items[0]);
                alert('검수 데이터를 성공적으로 불러왔습니다!');
              }
            } catch (err) {
              alert('JSON 파싱 오류: ' + err.message);
            }
          };
          reader.readAsText(file);
        };
        fileInput.click();
      });
    }

    // Practice in Assist Mode Button
    if (els.btnPracticeInAssist) {
      els.btnPracticeInAssist.addEventListener('click', () => {
        if (!state.review.selectedItem) return;
        const char = state.review.selectedItem.character;
        switchMode('assist');
        loadAssistCharacter(char);
      });
    }
  }

  function switchMode(mode) {
    state.currentMode = mode;
    if (mode === 'assist') {
      if (els.tabAssist) els.tabAssist.classList.add('active');
      if (els.tabReview) els.tabReview.classList.remove('active');
      if (els.viewAssist) els.viewAssist.classList.add('active');
      if (els.viewReview) els.viewReview.classList.remove('active');
      resizeCanvas();
    } else {
      if (els.tabAssist) els.tabAssist.classList.remove('active');
      if (els.tabReview) els.tabReview.classList.add('active');
      if (els.viewAssist) els.viewAssist.classList.remove('active');
      if (els.viewReview) els.viewReview.classList.add('active');
      stopAnimation();
    }
  }

})();
