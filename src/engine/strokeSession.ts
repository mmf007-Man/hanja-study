import type { StrokeEvalResult } from './strokeEngine';

export const DOTTED_GUIDE_FAILURE_THRESHOLD = 3;

export type StrokeFeedbackTone = 'neutral' | 'pass' | 'fail' | 'complete';

export interface StrokeAttemptState {
  totalStrokes: number;
  currentStrokeIndex: number;
  completedStrokes: number[];
  consecutiveFailures: number;
  showDottedGuide: boolean;
  strokeGuideUsed: boolean;
  isCompleted: boolean;
  feedbackTone: StrokeFeedbackTone;
  feedbackMessage: string;
}

/**
 * 한자 쓰기 시도 상태 초기화
 */
export function createStrokeAttemptState(totalStrokes: number): StrokeAttemptState {
  const normalizedTotal = Math.max(0, totalStrokes);
  const isCompleted = normalizedTotal === 0;
  return {
    totalStrokes: normalizedTotal,
    currentStrokeIndex: 0,
    completedStrokes: [],
    consecutiveFailures: 0,
    showDottedGuide: false,
    strokeGuideUsed: false,
    isCompleted,
    feedbackTone: 'neutral',
    feedbackMessage: isCompleted ? '획 데이터가 없습니다.' : '순서에 맞게 획을 그어보세요.',
  };
}

/**
 * 단일 획 판정 결과를 세션 상태에 반영
 */
export function applyStrokeAttemptResult(
  state: StrokeAttemptState,
  evalResult: StrokeEvalResult,
): StrokeAttemptState {
  if (state.isCompleted || state.currentStrokeIndex >= state.totalStrokes) {
    return state;
  }

  if (evalResult.pass) {
    const completedStrokes = [...state.completedStrokes, state.currentStrokeIndex];
    const nextIndex = state.currentStrokeIndex + 1;
    const isCompleted = nextIndex >= state.totalStrokes;

    return {
      ...state,
      currentStrokeIndex: nextIndex,
      completedStrokes,
      consecutiveFailures: 0,
      showDottedGuide: false,
      strokeGuideUsed: state.strokeGuideUsed,
      isCompleted,
      feedbackTone: isCompleted ? 'complete' : 'pass',
      feedbackMessage: isCompleted
        ? '모든 획을 바르게 완성했습니다!'
        : evalResult.feedback || '완벽합니다! 다음 획을 쓰세요.',
    };
  }

  const nextFailures = state.consecutiveFailures + 1;
  const showDottedGuide = nextFailures >= DOTTED_GUIDE_FAILURE_THRESHOLD;
  const strokeGuideUsed = state.strokeGuideUsed || showDottedGuide;
  const guideHint = showDottedGuide
    ? '점선 가이드가 표시되었습니다. 시작점부터 따라 써 보세요.'
    : `다시 써 보세요 (${nextFailures}/${DOTTED_GUIDE_FAILURE_THRESHOLD})`;

  return {
    ...state,
    consecutiveFailures: nextFailures,
    showDottedGuide,
    strokeGuideUsed,
    isCompleted: false,
    feedbackTone: 'fail',
    feedbackMessage: evalResult.feedback
      ? `${evalResult.feedback} — ${guideHint}`
      : guideHint,
  };
}

/**
 * 쓰기 시도를 첫 획부터 초기화 (가이드 사용 이력은 보존)
 */
export function resetStrokeAttempt(state: StrokeAttemptState): StrokeAttemptState {
  const isCompleted = state.totalStrokes === 0;
  return {
    totalStrokes: state.totalStrokes,
    currentStrokeIndex: 0,
    completedStrokes: [],
    consecutiveFailures: 0,
    showDottedGuide: false,
    strokeGuideUsed: state.strokeGuideUsed,
    isCompleted,
    feedbackTone: 'neutral',
    feedbackMessage: isCompleted
      ? '획 데이터가 없습니다.'
      : '처음부터 다시 써 보세요.',
  };
}
