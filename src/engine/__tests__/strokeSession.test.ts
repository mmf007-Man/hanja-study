import { describe, expect, it } from 'vitest';
import type { StrokeEvalResult } from '../strokeEngine';
import {
  DOTTED_GUIDE_FAILURE_THRESHOLD,
  applyStrokeAttemptResult,
  createStrokeAttemptState,
  resetStrokeAttempt,
} from '../strokeSession';

const PASS_EVAL: StrokeEvalResult = {
  pass: true,
  score: 96,
  reason: 'pass',
  feedback: '완벽합니다! 다음 획을 쓰세요.',
  metrics: {},
};

const FAIL_EVAL: StrokeEvalResult = {
  pass: false,
  score: 40,
  reason: 'wrong_direction',
  feedback: '획의 진행 방향이 어긋났습니다.',
  metrics: {},
};

describe('strokeSession', () => {
  it('progresses through strokes and triggers dotted guide only after 3 consecutive failures', () => {
    let state = createStrokeAttemptState(3);
    expect(state).toMatchObject({
      totalStrokes: 3,
      currentStrokeIndex: 0,
      completedStrokes: [],
      consecutiveFailures: 0,
      showDottedGuide: false,
      strokeGuideUsed: false,
      isCompleted: false,
      feedbackTone: 'neutral',
    });

    // Fail 1 & Fail 2 -> no dotted guide yet
    state = applyStrokeAttemptResult(state, FAIL_EVAL);
    expect(state.consecutiveFailures).toBe(1);
    expect(state.showDottedGuide).toBe(false);
    expect(state.strokeGuideUsed).toBe(false);
    expect(state.currentStrokeIndex).toBe(0);
    expect(state.completedStrokes).toEqual([]);
    expect(state.feedbackTone).toBe('fail');

    state = applyStrokeAttemptResult(state, FAIL_EVAL);
    expect(state.consecutiveFailures).toBe(2);
    expect(state.showDottedGuide).toBe(false);
    expect(state.strokeGuideUsed).toBe(false);
    expect(state.currentStrokeIndex).toBe(0);

    // Fail 3 -> dotted guide activates and strokeGuideUsed becomes true
    state = applyStrokeAttemptResult(state, FAIL_EVAL);
    expect(state.consecutiveFailures).toBe(DOTTED_GUIDE_FAILURE_THRESHOLD);
    expect(state.showDottedGuide).toBe(true);
    expect(state.strokeGuideUsed).toBe(true);
    expect(state.currentStrokeIndex).toBe(0);

    // Pass stroke 0 -> resets consecutiveFailures & showDottedGuide, preserves strokeGuideUsed
    state = applyStrokeAttemptResult(state, PASS_EVAL);
    expect(state.completedStrokes).toEqual([0]);
    expect(state.currentStrokeIndex).toBe(1);
    expect(state.consecutiveFailures).toBe(0);
    expect(state.showDottedGuide).toBe(false);
    expect(state.strokeGuideUsed).toBe(true);
    expect(state.isCompleted).toBe(false);
    expect(state.feedbackTone).toBe('pass');

    // Complete remaining strokes
    state = applyStrokeAttemptResult(state, PASS_EVAL);
    expect(state.completedStrokes).toEqual([0, 1]);
    expect(state.currentStrokeIndex).toBe(2);
    expect(state.isCompleted).toBe(false);

    state = applyStrokeAttemptResult(state, PASS_EVAL);
    expect(state.completedStrokes).toEqual([0, 1, 2]);
    expect(state.currentStrokeIndex).toBe(3);
    expect(state.isCompleted).toBe(true);
    expect(state.strokeGuideUsed).toBe(true);
    expect(state.feedbackTone).toBe('complete');
  });

  it('preserves strokeGuideUsed across resetStrokeAttempt', () => {
    let state = createStrokeAttemptState(2);
    state = applyStrokeAttemptResult(state, FAIL_EVAL);
    state = applyStrokeAttemptResult(state, FAIL_EVAL);
    state = applyStrokeAttemptResult(state, FAIL_EVAL);
    expect(state.showDottedGuide).toBe(true);
    expect(state.strokeGuideUsed).toBe(true);

    state = applyStrokeAttemptResult(state, PASS_EVAL);
    expect(state.completedStrokes).toEqual([0]);

    const resetState = resetStrokeAttempt(state);
    expect(resetState).toMatchObject({
      totalStrokes: 2,
      currentStrokeIndex: 0,
      completedStrokes: [],
      consecutiveFailures: 0,
      showDottedGuide: false,
      strokeGuideUsed: true,
      isCompleted: false,
      feedbackTone: 'neutral',
    });
  });
});
