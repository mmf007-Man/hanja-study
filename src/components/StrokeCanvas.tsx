import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  convertMedianToSvg,
  evaluateStroke,
  STROKE_PRESETS,
  type StrokeEvalResult,
  type StrokePoint,
  type StrokePresetName,
} from '../engine/strokeEngine';
import {
  applyStrokeAttemptResult,
  createStrokeAttemptState,
  resetStrokeAttempt,
  type StrokeAttemptState,
  type StrokeFeedbackTone,
} from '../engine/strokeSession';
import type { NormalizedStrokeEntry } from '../types/catalog';
import './StrokeCanvas.css';

export interface StrokeCanvasPassPayload {
  strokeIndex: number;
  evalResult: StrokeEvalResult;
  state: StrokeAttemptState;
}

export interface StrokeCanvasFailPayload {
  strokeIndex: number;
  evalResult: StrokeEvalResult;
  state: StrokeAttemptState;
}

export interface StrokeCanvasCompletePayload {
  strokeGuideUsed: boolean;
  totalStrokes: number;
}

export interface StrokeCanvasProps {
  strokeEntry: NormalizedStrokeEntry;
  preset?: StrokePresetName;
  disabled?: boolean;
  showGrid?: boolean;
  showGhostOutline?: boolean;
  totalStrokeHint?: boolean;
  onStrokePass?: (payload: StrokeCanvasPassPayload) => void;
  onStrokeFail?: (payload: StrokeCanvasFailPayload) => void;
  onComplete?: (payload: StrokeCanvasCompletePayload) => void;
  onReset?: (state: StrokeAttemptState) => void;
}

const VIEWBOX_SIZE = 1024;
const PASS_FLASH_COLOR = '#10b981';
const FAIL_FLASH_COLOR = '#ef4444';
const ACTIVE_DRAW_COLOR = '#2563eb';
const PASS_FLASH_MS = 120;
const FAIL_FLASH_MS = 450;

const FEEDBACK_ICONS: Record<StrokeFeedbackTone, string> = {
  neutral: '•',
  pass: '✓',
  fail: '✕',
  complete: '★',
};

function buildMedianSvgPath(points: readonly StrokePoint[]): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  let path = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i += 1) {
    const pt = points[i]!;
    path += ` L ${pt.x} ${pt.y}`;
  }
  return path;
}

export const StrokeCanvas: React.FC<StrokeCanvasProps> = ({
  strokeEntry,
  preset = 'normal',
  disabled = false,
  showGrid = true,
  showGhostOutline = false,
  totalStrokeHint = false,
  onStrokePass,
  onStrokeFail,
  onComplete,
  onReset,
}) => {
  const totalStrokes = strokeEntry.strokes.length;

  const [attemptState, setAttemptState] = useState<StrokeAttemptState>(() =>
    createStrokeAttemptState(totalStrokes),
  );
  const [snappedIndices, setSnappedIndices] = useState<number[]>([]);

  const attemptStateRef = useRef<StrokeAttemptState>(attemptState);
  attemptStateRef.current = attemptState;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const userPointsRef = useRef<StrokePoint[]>([]);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSnapStrokesRef = useRef<number[] | null>(null);
  const pendingCompletePayloadRef = useRef<StrokeCanvasCompletePayload | null>(null);

  const callbacksRef = useRef({
    onStrokePass,
    onStrokeFail,
    onComplete,
    onReset,
  });
  callbacksRef.current = {
    onStrokePass,
    onStrokeFail,
    onComplete,
    onReset,
  };

  const clearFlashTimer = useCallback(() => {
    if (flashTimerRef.current !== null) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
  }, []);

  const clearDrawingCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }, []);

  const drawUserStroke = useCallback((points: readonly StrokePoint[], color: string) => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || points.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = stage.getBoundingClientRect();
    const cssWidth = rect.width > 0 ? rect.width : 320;
    const scale = cssWidth / VIEWBOX_SIZE;
    const lineWidth = 16 * scale;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const first = points[0]!;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(first.x * scale, first.y * scale, lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(first.x * scale, first.y * scale);
      for (let i = 1; i < points.length; i += 1) {
        const pt = points[i]!;
        ctx.lineTo(pt.x * scale, pt.y * scale);
      }
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = rect.width > 0 ? rect.width : 320;
    const cssHeight = rect.height > 0 ? rect.height : 320;

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }, []);

  // Reset state whenever the target character entry changes
  useEffect(() => {
    clearFlashTimer();
    pendingSnapStrokesRef.current = null;
    pendingCompletePayloadRef.current = null;
    activePointerIdRef.current = null;
    userPointsRef.current = [];
    clearDrawingCanvas();

    const initial = createStrokeAttemptState(strokeEntry.strokes.length);
    attemptStateRef.current = initial;
    setAttemptState(initial);
    setSnappedIndices([]);
  }, [strokeEntry.id, strokeEntry.strokes.length, clearFlashTimer, clearDrawingCanvas]);

  // Keep canvas DPR & dimensions aligned across resize / orientation / virtual keyboard
  useEffect(() => {
    syncCanvasSize();
    const stage = stageRef.current;
    let observer: ResizeObserver | null = null;

    if (stage && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        syncCanvasSize();
      });
      observer.observe(stage);
    }

    window.addEventListener('resize', syncCanvasSize);
    return () => {
      if (observer) {
        observer.disconnect();
      }
      window.removeEventListener('resize', syncCanvasSize);
    };
  }, [syncCanvasSize]);

  // Clean up pending timers on unmount
  useEffect(() => {
    return () => {
      clearFlashTimer();
    };
  }, [clearFlashTimer]);

  const flushPendingFlash = useCallback(() => {
    clearFlashTimer();
    clearDrawingCanvas();
    if (pendingSnapStrokesRef.current !== null) {
      setSnappedIndices(pendingSnapStrokesRef.current);
      pendingSnapStrokesRef.current = null;
    }
    if (pendingCompletePayloadRef.current !== null) {
      const payload = pendingCompletePayloadRef.current;
      pendingCompletePayloadRef.current = null;
      callbacksRef.current.onComplete?.(payload);
    }
  }, [clearFlashTimer, clearDrawingCanvas]);

  const mapPointerToStage = useCallback((event: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const stage = stageRef.current;
    const rect = stage ? stage.getBoundingClientRect() : event.currentTarget.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : VIEWBOX_SIZE;
    const height = rect.height > 0 ? rect.height : VIEWBOX_SIZE;
    const x = ((event.clientX - rect.left) / width) * VIEWBOX_SIZE;
    const y = ((event.clientY - rect.top) / height) * VIEWBOX_SIZE;
    return { x, y, t: performance.now() };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      flushPendingFlash();

      const current = attemptStateRef.current;
      if (current.isCompleted || current.currentStrokeIndex >= strokeEntry.strokes.length) {
        return;
      }

      if (activePointerIdRef.current !== null) {
        return;
      }

      const pointerId = event.pointerId ?? 0;
      activePointerIdRef.current = pointerId;
      try {
        event.currentTarget.setPointerCapture?.(pointerId);
      } catch {
        // Ignore capture errors in synthetic / unsupported environments
      }

      const pt = mapPointerToStage(event);
      userPointsRef.current = [pt];
      drawUserStroke(userPointsRef.current, ACTIVE_DRAW_COLOR);
    },
    [disabled, flushPendingFlash, strokeEntry.strokes.length, mapPointerToStage, drawUserStroke],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const pointerId = event.pointerId ?? 0;
      if (disabled || activePointerIdRef.current !== pointerId) return;
      const pt = mapPointerToStage(event);
      userPointsRef.current.push(pt);
      drawUserStroke(userPointsRef.current, ACTIVE_DRAW_COLOR);
    },
    [disabled, mapPointerToStage, drawUserStroke],
  );

  const releaseCaptureSafely = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pointerId = event.pointerId ?? 0;
    try {
      if (event.currentTarget.hasPointerCapture?.(pointerId)) {
        event.currentTarget.releasePointerCapture?.(pointerId);
      }
    } catch {
      // Ignore release errors in synthetic / unsupported environments
    }
  };

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const pointerId = event.pointerId ?? 0;
      if (activePointerIdRef.current !== pointerId) return;
      activePointerIdRef.current = null;
      userPointsRef.current = [];
      releaseCaptureSafely(event);
      clearDrawingCanvas();
    },
    [clearDrawingCanvas],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const pointerId = event.pointerId ?? 0;
      if (activePointerIdRef.current !== pointerId) return;
      activePointerIdRef.current = null;
      releaseCaptureSafely(event);

      const points = userPointsRef.current;
      userPointsRef.current = [];

      const current = attemptStateRef.current;
      if (disabled || current.isCompleted || current.currentStrokeIndex >= strokeEntry.strokes.length) {
        clearDrawingCanvas();
        return;
      }

      const strokeIndex = current.currentStrokeIndex;
      const targetMedian = strokeEntry.medians[strokeIndex];
      if (!targetMedian) {
        clearDrawingCanvas();
        return;
      }

      const evalResult = evaluateStroke(
        points,
        targetMedian,
        { ...STROKE_PRESETS[preset], isTopDown: true },
        {
          character: strokeEntry.character,
          strokeIndex,
          totalStrokes: strokeEntry.strokes.length,
          isTopDown: true,
          renderMode: strokeEntry.renderMode,
        },
      );

      const nextState = applyStrokeAttemptResult(current, evalResult);
      attemptStateRef.current = nextState;
      setAttemptState(nextState);

      if (evalResult.pass) {
        drawUserStroke(points, PASS_FLASH_COLOR);
        callbacksRef.current.onStrokePass?.({
          strokeIndex,
          evalResult,
          state: nextState,
        });

        pendingSnapStrokesRef.current = nextState.completedStrokes;
        pendingCompletePayloadRef.current = nextState.isCompleted
          ? {
              strokeGuideUsed: nextState.strokeGuideUsed,
              totalStrokes: nextState.totalStrokes,
            }
          : null;

        clearFlashTimer();
        flashTimerRef.current = setTimeout(() => {
          flashTimerRef.current = null;
          clearDrawingCanvas();
          if (pendingSnapStrokesRef.current !== null) {
            setSnappedIndices(pendingSnapStrokesRef.current);
            pendingSnapStrokesRef.current = null;
          }
          if (pendingCompletePayloadRef.current !== null) {
            const payload = pendingCompletePayloadRef.current;
            pendingCompletePayloadRef.current = null;
            callbacksRef.current.onComplete?.(payload);
          }
        }, PASS_FLASH_MS);
      } else {
        drawUserStroke(points, FAIL_FLASH_COLOR);
        callbacksRef.current.onStrokeFail?.({
          strokeIndex,
          evalResult,
          state: nextState,
        });

        clearFlashTimer();
        flashTimerRef.current = setTimeout(() => {
          flashTimerRef.current = null;
          clearDrawingCanvas();
        }, FAIL_FLASH_MS);
      }
    },
    [
      disabled,
      strokeEntry.character,
      strokeEntry.medians,
      strokeEntry.renderMode,
      strokeEntry.strokes.length,
      preset,
      clearDrawingCanvas,
      drawUserStroke,
      clearFlashTimer,
    ],
  );

  const handleReset = useCallback(() => {
    if (disabled) return;
    clearFlashTimer();
    pendingSnapStrokesRef.current = null;
    pendingCompletePayloadRef.current = null;
    activePointerIdRef.current = null;
    userPointsRef.current = [];
    clearDrawingCanvas();

    const nextState = resetStrokeAttempt(attemptStateRef.current);
    attemptStateRef.current = nextState;
    setAttemptState(nextState);
    setSnappedIndices([]);
    callbacksRef.current.onReset?.(nextState);
  }, [disabled, clearFlashTimer, clearDrawingCanvas]);

  const dottedGuideData = useMemo(() => {
    if (!attemptState.showDottedGuide || attemptState.isCompleted) {
      return null;
    }
    const median = strokeEntry.medians[attemptState.currentStrokeIndex];
    if (!median || median.length === 0) {
      return null;
    }
    const svgPoints = convertMedianToSvg(median, true);
    const startPoint = svgPoints[0];
    if (!startPoint) {
      return null;
    }
    return {
      pathD: buildMedianSvgPath(svgPoints),
      startPoint,
      strokeNumber: attemptState.currentStrokeIndex + 1,
    };
  }, [
    attemptState.showDottedGuide,
    attemptState.isCompleted,
    attemptState.currentStrokeIndex,
    strokeEntry.medians,
  ]);

  const renderMode = strokeEntry.renderMode;
  const displayStrokeNum =
    totalStrokes === 0
      ? 0
      : attemptState.isCompleted
        ? totalStrokes
        : attemptState.currentStrokeIndex + 1;

  return (
    <div className="stroke-canvas-root" data-testid="stroke-canvas">
      <div className="stroke-canvas-header">
        <div className="stroke-progress-group">
          <span className="stroke-counter-text" data-testid="stroke-counter">
            현재 획: {displayStrokeNum} / {totalStrokes}
          </span>
          <div className="stroke-pills" aria-hidden="true">
            {Array.from({ length: totalStrokes }, (_, idx) => {
              const isDone = attemptState.completedStrokes.includes(idx);
              const isCurrent = !attemptState.isCompleted && idx === attemptState.currentStrokeIndex;
              const pillClass = isDone
                ? 'stroke-pill done'
                : isCurrent
                  ? 'stroke-pill current'
                  : 'stroke-pill';
              return <span key={idx} className={pillClass} />;
            })}
          </div>
        </div>

        {totalStrokeHint && (
          <span className="stroke-hint-chip" data-testid="total-stroke-hint">
            총획: {strokeEntry.strokeCount}획
          </span>
        )}
      </div>

      <div
        ref={stageRef}
        className={`stroke-stage${disabled ? ' is-disabled' : ''}`}
        data-testid="stroke-stage"
        onContextMenu={(e) => e.preventDefault()}
      >
        {showGrid && (
          <svg
            className="stroke-layer stroke-grid-layer"
            viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
            aria-hidden="true"
          >
            <line x1="512" y1="0" x2="512" y2="1024" className="stroke-grid-line" />
            <line x1="0" y1="512" x2="1024" y2="512" className="stroke-grid-line" />
            <line
              x1="0"
              y1="0"
              x2="1024"
              y2="1024"
              className="stroke-grid-line stroke-grid-diagonal"
            />
            <line
              x1="1024"
              y1="0"
              x2="0"
              y2="1024"
              className="stroke-grid-line stroke-grid-diagonal"
            />
          </svg>
        )}

        {showGhostOutline && (
          <svg
            className="stroke-layer stroke-ghost-layer"
            data-testid="ghost-outline-layer"
            viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
            aria-hidden="true"
          >
            {strokeEntry.strokes.map((pathD, idx) =>
              renderMode === 'stroke' ? (
                <path
                  key={idx}
                  d={pathD}
                  fill="none"
                  stroke="#1e293b"
                  strokeWidth={48}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.12}
                />
              ) : (
                <path
                  key={idx}
                  d={pathD}
                  fill="#1e293b"
                  stroke="none"
                  opacity={0.08}
                />
              ),
            )}
          </svg>
        )}

        <svg
          className="stroke-layer stroke-snapped-layer"
          data-testid="snapped-strokes-layer"
          viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
          aria-hidden="true"
        >
          {snappedIndices.map((strokeIdx) => {
            const pathD = strokeEntry.strokes[strokeIdx];
            if (!pathD) return null;
            return renderMode === 'stroke' ? (
              <path
                key={strokeIdx}
                d={pathD}
                fill="none"
                stroke="#1e293b"
                strokeWidth={54}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <path
                key={strokeIdx}
                d={pathD}
                fill="#1e293b"
                stroke="none"
              />
            );
          })}
        </svg>

        {dottedGuideData && (
          <svg
            className="stroke-layer stroke-guide-layer"
            data-testid="dotted-guide-layer"
            viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
            aria-hidden="true"
          >
            <path
              d={dottedGuideData.pathD}
              fill="none"
              stroke="#2563eb"
              strokeWidth={12}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="16 16"
              opacity={0.75}
            />
            <circle
              cx={dottedGuideData.startPoint.x}
              cy={dottedGuideData.startPoint.y}
              r={20}
              fill="#2563eb"
              opacity={0.85}
            />
            <circle
              cx={dottedGuideData.startPoint.x}
              cy={dottedGuideData.startPoint.y}
              r={8}
              fill="#ffffff"
            />
          </svg>
        )}

        <canvas
          ref={canvasRef}
          className="stroke-drawing-canvas"
          data-testid="stroke-drawing-canvas"
          aria-label={`${strokeEntry.character} 쓰기 캔버스`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      <div
        className={`stroke-feedback-bar tone-${attemptState.feedbackTone}`}
        data-testid="stroke-feedback-bar"
        role="status"
        aria-live="polite"
      >
        <span className="stroke-feedback-icon" aria-hidden="true">
          {FEEDBACK_ICONS[attemptState.feedbackTone]}
        </span>
        <span className="stroke-feedback-text">{attemptState.feedbackMessage}</span>
      </div>

      <div className="stroke-canvas-actions">
        <button
          type="button"
          className="stroke-reset-btn"
          onClick={handleReset}
          disabled={disabled}
        >
          처음부터 다시
        </button>
      </div>
    </div>
  );
};

export default StrokeCanvas;
