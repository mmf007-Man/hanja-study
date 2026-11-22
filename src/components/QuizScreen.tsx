import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogStore } from '../data/catalogStore';
import type { StrokeLazyLoader } from '../data/strokeLoader';
import { canSubmitAnswer, type AnswerDraft } from '../engine/gradingEngine';
import type {
  SessionEngine,
  SubmitQuestionResult,
} from '../engine/sessionEngine';
import type { NormalizedStrokeEntry } from '../types/catalog';
import type {
  CompletedSessionRecord,
  FrozenQuestion,
  ReviewItem,
  SessionSnapshot,
} from '../types/storage';
import {
  QUESTION_TYPE_SHORT_LABELS,
  SESSION_MODE_LABELS,
  formatCharacterReadingsSummary,
  formatDurationMs,
  formatReadingBadgeText,
} from '../utils/labels';
import { StrokeCanvas, type StrokeCanvasCompletePayload } from './StrokeCanvas';

export interface QuizScreenProps {
  catalog: CatalogStore;
  strokeLoader: StrokeLazyLoader;
  sessionEngine: SessionEngine;
  profileId: string;
  session: SessionSnapshot;
  reviewQueue: Record<string, ReviewItem>;
  onSessionUpdated: (
    session: SessionSnapshot,
    reviewQueue: Record<string, ReviewItem>,
  ) => void;
  onSessionCompleted: (
    completed: CompletedSessionRecord,
    reviewQueue: Record<string, ReviewItem>,
  ) => void;
}

interface PendingPauseState {
  kind: 'dont_know' | 'pair_mismatch' | 'write_complete';
  question: FrozenQuestion;
  result: SubmitQuestionResult;
}

interface LastFeedbackPill {
  isCorrect: boolean;
  score: 0 | 2;
}

export const QuizScreen: React.FC<QuizScreenProps> = ({
  catalog,
  strokeLoader,
  sessionEngine,
  profileId,
  session,
  reviewQueue,
  onSessionUpdated,
  onSessionCompleted,
}) => {
  const [draft, setDraft] = useState<AnswerDraft>({});
  const [pendingPause, setPendingPause] = useState<PendingPauseState | null>(
    null,
  );
  const [lastFeedback, setLastFeedback] = useState<LastFeedbackPill | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showExitModal, setShowExitModal] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  const [strokeEntry, setStrokeEntry] = useState<NormalizedStrokeEntry | null>(
    null,
  );
  const [strokeLoading, setStrokeLoading] = useState(false);
  const [strokeError, setStrokeError] = useState<string | null>(null);
  const [strokeReloadToken, setStrokeReloadToken] = useState(0);

  const [elapsedMs, setElapsedMs] = useState<number>(() => {
    const startMs = Date.parse(session.startedAt);
    return Number.isFinite(startMs) ? Math.max(0, Date.now() - startMs) : 0;
  });

  const latestSessionRef = useRef(session);
  latestSessionRef.current = session;
  const latestReviewQueueRef = useRef(reviewQueue);
  latestReviewQueueRef.current = reviewQueue;
  const exposingQuestionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const startMs = Date.parse(session.startedAt);
    const updateTimer = () => {
      if (Number.isFinite(startMs)) {
        setElapsedMs(Math.max(0, Date.now() - startMs));
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [session.startedAt]);

  const activeQuestion = session.questions[session.currentIndex] ?? null;
  const displayedQuestion = pendingPause
    ? pendingPause.question
    : activeQuestion;
  const displayedCharacter = displayedQuestion
    ? catalog.getCharacterById(displayedQuestion.characterId)
    : undefined;

  // Reset local draft when displayed question changes (without pending pause)
  const displayedQuestionId = displayedQuestion?.questionId ?? null;
  useEffect(() => {
    if (!pendingPause) {
      setDraft({});
      setSubmitError(null);
    }
  }, [displayedQuestionId, pendingPause]);

  // Mark question as exposed once when first displayed
  useEffect(() => {
    if (pendingPause !== null || !displayedQuestion) {
      return;
    }
    const qId = displayedQuestion.questionId;
    if (session.exposedQuestionIds.includes(qId)) {
      return;
    }
    if (exposingQuestionIdRef.current === qId) {
      return;
    }
    exposingQuestionIdRef.current = qId;
    let cancelled = false;

    void sessionEngine
      .markQuestionExposed(profileId, qId)
      .then((updated) => {
        if (exposingQuestionIdRef.current === qId) {
          exposingQuestionIdRef.current = null;
        }
        if (
          !cancelled &&
          latestSessionRef.current.sessionId === updated.sessionId &&
          updated.answers.length >= latestSessionRef.current.answers.length
        ) {
          onSessionUpdated(updated, latestReviewQueueRef.current);
        }
      })
      .catch(() => {
        if (exposingQuestionIdRef.current === qId) {
          exposingQuestionIdRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    pendingPause,
    displayedQuestion,
    session.exposedQuestionIds,
    sessionEngine,
    profileId,
    onSessionUpdated,
  ]);

  // Lazy-load strokes ONLY when current displayed question is reading_to_write
  const writingCharId =
    displayedQuestion?.questionType === 'reading_to_write'
      ? displayedQuestion.characterId
      : null;

  useEffect(() => {
    if (!writingCharId) {
      setStrokeEntry(null);
      setStrokeLoading(false);
      setStrokeError(null);
      return;
    }

    const cached = strokeLoader.getCachedStroke(writingCharId);
    if (cached) {
      setStrokeEntry(cached);
      setStrokeLoading(false);
      setStrokeError(null);
      return;
    }

    let cancelled = false;
    setStrokeEntry(null);
    setStrokeLoading(true);
    setStrokeError(null);

    void strokeLoader
      .loadCharacterStroke(writingCharId)
      .then((entry) => {
        if (!cancelled) {
          setStrokeEntry(entry);
          setStrokeLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStrokeError(
            error instanceof Error
              ? error.message
              : '획 데이터를 불러오지 못했습니다.',
          );
          setStrokeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [writingCharId, strokeLoader, strokeReloadToken]);

  const activeReviewQueue = pendingPause
    ? pendingPause.result.reviewQueue
    : reviewQueue;

  const pendingReviewCount = useMemo(
    () =>
      Object.values(activeReviewQueue).filter(
        (item) => item.status === 'needs_review',
      ).length,
    [activeReviewQueue],
  );

  const cumulativeScore = useMemo(
    () => session.answers.reduce((acc, a) => acc + a.score, 0),
    [session.answers],
  );

  const finalizeAndExit = useCallback(async () => {
    setIsFinishing(true);
    setSubmitError(null);
    try {
      const completed = await sessionEngine.finishSession(profileId);
      setShowExitModal(false);
      onSessionCompleted(completed, latestReviewQueueRef.current);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : '학습을 종료하는 중 오류가 발생했습니다.',
      );
    } finally {
      setIsFinishing(false);
    }
  }, [sessionEngine, profileId, onSessionCompleted]);

  const applyImmediateOrPause = useCallback(
    async (
      question: FrozenQuestion,
      result: SubmitQuestionResult,
      kind: 'normal' | 'dont_know' | 'write_complete',
    ) => {
      onSessionUpdated(result.session, result.reviewQueue);

      if (kind === 'dont_know') {
        setPendingPause({ kind: 'dont_know', question, result });
        return;
      }

      if (result.grading.showPairMismatchWarning) {
        setPendingPause({ kind: 'pair_mismatch', question, result });
        return;
      }

      if (kind === 'write_complete') {
        setPendingPause({ kind: 'write_complete', question, result });
        return;
      }

      if (result.isSessionComplete) {
        const completed = await sessionEngine.finishSession(profileId);
        onSessionCompleted(completed, result.reviewQueue);
        return;
      }

      setLastFeedback({
        isCorrect: result.grading.record.outcome === 'correct',
        score: result.grading.record.score,
      });
      setDraft({});
    },
    [onSessionUpdated, onSessionCompleted, sessionEngine, profileId],
  );

  const handleNormalSubmit = async (event?: React.FormEvent) => {
    if (event) event.preventDefault();
    if (!displayedQuestion || pendingPause || isSubmitting) return;
    if (!canSubmitAnswer(displayedQuestion, draft)) return;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await sessionEngine.submitAnswer(
        profileId,
        displayedQuestion.questionId,
        draft,
      );
      await applyImmediateOrPause(displayedQuestion, result, 'normal');
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : '답안을 제출하는 중 오류가 발생했습니다.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDontKnow = async () => {
    if (!displayedQuestion || pendingPause || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await sessionEngine.submitDontKnow(
        profileId,
        displayedQuestion.questionId,
      );
      await applyImmediateOrPause(displayedQuestion, result, 'dont_know');
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : '처리에 실패했습니다. 다시 시도해 주세요.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWriteComplete = useCallback(
    async (payload: StrokeCanvasCompletePayload) => {
      if (!displayedQuestion || pendingPause || isSubmitting) return;
      setIsSubmitting(true);
      setSubmitError(null);
      try {
        const result = await sessionEngine.submitAnswer(
          profileId,
          displayedQuestion.questionId,
          {
            completed: true,
            strokeGuideUsed: payload.strokeGuideUsed,
          },
        );
        await applyImmediateOrPause(
          displayedQuestion,
          result,
          'write_complete',
        );
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : '쓰기 답안 저장에 실패했습니다.',
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      displayedQuestion,
      pendingPause,
      isSubmitting,
      sessionEngine,
      profileId,
      applyImmediateOrPause,
    ],
  );

  const handleAdvanceAfterPause = async () => {
    if (!pendingPause) return;
    const { result } = pendingPause;

    if (result.isSessionComplete) {
      setIsFinishing(true);
      try {
        const completed = await sessionEngine.finishSession(profileId);
        onSessionCompleted(completed, result.reviewQueue);
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : '결과 화면으로 이동하지 못했습니다.',
        );
      } finally {
        setIsFinishing(false);
      }
      return;
    }

    setLastFeedback({
      isCorrect: result.grading.record.outcome === 'correct',
      score: result.grading.record.score,
    });
    setPendingPause(null);
    setDraft({});
  };

  if (!displayedQuestion || !displayedCharacter) {
    return (
      <div className="screen-stack">
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">✕</span>
          <span>표시할 문항 데이터를 찾을 수 없습니다.</span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void finalizeAndExit()}
        >
          결과 화면으로 이동
        </button>
      </div>
    );
  }

  const displayedIndex = session.questions.findIndex(
    (q) => q.questionId === displayedQuestion.questionId,
  );
  const progressNumerator =
    displayedIndex >= 0 ? displayedIndex + 1 : session.currentIndex + 1;
  const progressDenominator = session.questions.length;
  const progressRatio =
    progressDenominator > 0
      ? Math.min(100, Math.round((progressNumerator / progressDenominator) * 100))
      : 0;

  const reviewItem = displayedQuestion.reviewItemId
    ? activeReviewQueue[displayedQuestion.reviewItemId]
    : undefined;
  const currentStreak = reviewItem?.sessionStreak ?? 0;

  const isSubmitEnabled =
    !pendingPause && !isSubmitting && canSubmitAnswer(displayedQuestion, draft);

  return (
    <div className="screen-stack" data-testid="quiz-screen">
      <header className="quiz-top-bar">
        <div className="quiz-top-row">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setShowExitModal(true)}
            disabled={isFinishing}
          >
            {session.mode === 'review' ? '복습 끝내기' : '학습 끝내기'}
          </button>

          <div className="quiz-badges">
            <span className="pill pill-primary">
              {SESSION_MODE_LABELS[session.mode]}
            </span>
            <span className="quiz-timer" aria-label="경과 시간">
              {formatDurationMs(elapsedMs)}
            </span>
          </div>

          <div className="quiz-score-group">
            <strong className="quiz-score" data-testid="cumulative-score">
              {cumulativeScore}점
            </strong>
            {lastFeedback && (
              <span
                className={`pill ${lastFeedback.isCorrect ? 'pill-success' : 'pill-danger'}`}
                data-testid="last-feedback-pill"
              >
                {lastFeedback.isCorrect
                  ? `✓ 직전 +${lastFeedback.score}점`
                  : '✕ 직전 0점'}
              </span>
            )}
          </div>
        </div>

        <div className="quiz-progress-row">
          {session.mode === 'review' ? (
            <div className="review-progress-meta">
              <span>대기 {pendingReviewCount}개</span>
              {displayedQuestion.reviewItemId && (
                <span className="pill pill-info">
                  연속 정답: {currentStreak}/2
                </span>
              )}
            </div>
          ) : (
            <>
              <span className="quiz-progress-text" data-testid="quiz-progress">
                {progressNumerator} / {progressDenominator}
              </span>
              <div className="progress-track" aria-hidden="true">
                <div
                  className="progress-fill"
                  style={{ width: `${progressRatio}%` }}
                />
              </div>
            </>
          )}
        </div>
      </header>

      {displayedQuestion.isReviewFiller && (
        <div className="alert alert-info" role="status" data-testid="filler-badge">
          <span className="pill pill-info">연습 삽입 문제</span>
          <span>
            남은 복습 항목의 연속 정답 횟수에 합산되지 않습니다. (틀리면 복습 대기열에 추가됩니다)
          </span>
        </div>
      )}

      <section className="card quiz-question-card">
        <div className="quiz-type-header">
          <span className="pill pill-neutral">
            {QUESTION_TYPE_SHORT_LABELS[displayedQuestion.questionType]}
          </span>
        </div>

        {(displayedQuestion.questionType === 'hanja_to_choice' ||
          displayedQuestion.questionType === 'hanja_to_input') && (
          <div className="hanja-prompt-box">
            <span className="hanja-prompt-glyph" lang="zh-Hant">
              {displayedCharacter.character}
            </span>
          </div>
        )}

        {(displayedQuestion.questionType === 'reading_to_choice' ||
          displayedQuestion.questionType === 'reading_to_write') && (
          <div className="reading-prompt-box">
            <div className="reading-badges">
              {displayedCharacter.readings.map((reading, idx) => (
                <span key={idx} className="reading-pair-badge">
                  {formatReadingBadgeText(reading)}
                </span>
              ))}
            </div>
            {displayedQuestion.questionType === 'reading_to_write' &&
              strokeEntry && (
                <span className="stroke-hint-chip">
                  총획: {strokeEntry.strokeCount}획
                </span>
              )}
          </div>
        )}

        {displayedQuestion.questionType === 'hanja_to_choice' && (
          <div className="mcq-sections">
            <div className="mcq-group">
              <p className="mcq-group-label">뜻 선택</p>
              <div className="choice-grid-2">
                {(displayedQuestion.meaningChoices ?? []).map((meaning) => {
                  const selected = draft.meaning === meaning;
                  return (
                    <button
                      key={meaning}
                      type="button"
                      className={`choice-btn${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      disabled={pendingPause !== null || isSubmitting}
                      onClick={() =>
                        setDraft((prev) => ({ ...prev, meaning }))
                      }
                    >
                      {meaning}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mcq-group">
              <p className="mcq-group-label">음 선택</p>
              <div className="choice-grid-2">
                {(displayedQuestion.soundChoices ?? []).map((sound) => {
                  const selected = draft.sound === sound;
                  return (
                    <button
                      key={sound}
                      type="button"
                      className={`choice-btn${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      disabled={pendingPause !== null || isSubmitting}
                      onClick={() => setDraft((prev) => ({ ...prev, sound }))}
                    >
                      {sound}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {displayedQuestion.questionType === 'hanja_to_input' && (
          <form onSubmit={handleNormalSubmit} className="form-stack">
            <div className="field-group">
              <label htmlFor="quiz-meaning-input" className="field-label">
                뜻 입력
              </label>
              <input
                id="quiz-meaning-input"
                type="text"
                className="text-input"
                placeholder="원문 뜻 입력"
                aria-label="원문 뜻 입력"
                value={draft.meaning ?? ''}
                disabled={pendingPause !== null || isSubmitting}
                onFocus={(e) =>
                  e.currentTarget.scrollIntoView?.({
                    block: 'center',
                    behavior: 'smooth',
                  })
                }
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, meaning: e.target.value }))
                }
              />
            </div>

            <div className="field-group">
              <label htmlFor="quiz-sound-input" className="field-label">
                음 입력
              </label>
              <input
                id="quiz-sound-input"
                type="text"
                className="text-input"
                placeholder="음 입력"
                aria-label="음 입력"
                value={draft.sound ?? ''}
                disabled={pendingPause !== null || isSubmitting}
                onFocus={(e) =>
                  e.currentTarget.scrollIntoView?.({
                    block: 'center',
                    behavior: 'smooth',
                  })
                }
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, sound: e.target.value }))
                }
              />
            </div>
          </form>
        )}

        {displayedQuestion.questionType === 'reading_to_choice' && (
          <div className="hanja-choice-grid" role="group" aria-label="한자 보기">
            {(displayedQuestion.characterChoices ?? []).map((cid) => {
              const choiceChar = catalog.getCharacterById(cid);
              const selected = draft.characterId === cid;
              return (
                <button
                  key={cid}
                  type="button"
                  className={`hanja-choice-card${selected ? ' is-selected' : ''}`}
                  aria-pressed={selected}
                  disabled={pendingPause !== null || isSubmitting}
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, characterId: cid }))
                  }
                >
                  <span className="hanja-choice-glyph" lang="zh-Hant">
                    {choiceChar?.character ?? cid}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {displayedQuestion.questionType === 'reading_to_write' && (
          <div className="writing-area">
            {strokeLoading && (
              <div className="status-box" role="status">
                필순 데이터를 불러오는 중입니다...
              </div>
            )}
            {strokeError && (
              <div className="alert alert-error" role="alert">
                <span aria-hidden="true">✕</span>
                <div className="error-retry-row">
                  <span>{strokeError}</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setStrokeReloadToken((n) => n + 1)}
                  >
                    다시 불러오기
                  </button>
                </div>
              </div>
            )}
            {strokeEntry && !strokeLoading && !strokeError && (
              <StrokeCanvas
                key={displayedQuestion.questionId}
                strokeEntry={strokeEntry}
                preset="normal"
                showGrid={true}
                totalStrokeHint={true}
                disabled={pendingPause !== null || isSubmitting}
                onComplete={handleWriteComplete}
              />
            )}
          </div>
        )}

        {pendingPause?.kind === 'pair_mismatch' && (
          <div
            className="alert alert-warning"
            role="alert"
            data-testid="pair-mismatch-warning"
          >
            <span aria-hidden="true">⚠</span>
            <div>
              <strong>개별 존재하나 쌍 불일치</strong> (0점 · 복습 등록)
              <div className="alert-subtext">
                입력한 뜻과 음이 한자에 각각 존재하지만 서로 다른 독음 쌍입니다. 올바른 쌍 조합은 결과 화면에서 공개됩니다.
              </div>
            </div>
          </div>
        )}

        {pendingPause?.kind === 'dont_know' && (
          <div
            className="answer-reveal-card"
            role="status"
            data-testid="dont-know-reveal"
          >
            <div className="answer-reveal-header">
              <span className="pill pill-neutral">? 모르겠어요 (0점 · 복습 등록)</span>
            </div>
            <div className="answer-reveal-body">
              <strong className="answer-reveal-hanja" lang="zh-Hant">
                {displayedCharacter.character}
              </strong>
              <span>{formatCharacterReadingsSummary(displayedCharacter)}</span>
            </div>
          </div>
        )}

        {pendingPause?.kind === 'write_complete' && (
          <div
            className="alert alert-success"
            role="status"
            data-testid="write-complete-feedback"
          >
            <span aria-hidden="true">✓</span>
            <span>
              정답 (+2점)
              {pendingPause.result.grading.record.strokeGuideUsed
                ? ' · 점선 가이드 사용 기록됨'
                : ''}
            </span>
          </div>
        )}

        {submitError && (
          <div className="alert alert-error" role="alert">
            <span aria-hidden="true">✕</span>
            <span>{submitError}</span>
          </div>
        )}
      </section>

      <footer className="quiz-action-bar">
        {pendingPause ? (
          <button
            type="button"
            className="btn btn-primary btn-block btn-lg"
            onClick={() => void handleAdvanceAfterPause()}
            disabled={isFinishing}
          >
            {pendingPause.result.isSessionComplete ? '결과 보기' : '다음 문제'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleDontKnow()}
              disabled={isSubmitting}
            >
              모르겠어요
            </button>
            {displayedQuestion.questionType !== 'reading_to_write' && (
              <button
                type="button"
                className="btn btn-primary btn-flex"
                disabled={!isSubmitEnabled}
                onClick={() => void handleNormalSubmit()}
              >
                {isSubmitting ? '채점 중...' : '제출'}
              </button>
            )}
          </>
        )}
      </footer>

      {showExitModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-quiz-modal-title"
        >
          <div className="modal-card">
            <h3 id="exit-quiz-modal-title" className="modal-title">
              {session.mode === 'review' ? '복습을 끝낼까요?' : '학습을 끝낼까요?'}
            </h3>
            <p className="modal-body">
              현재 표시된 미제출 문항은 &apos;중도 이탈&apos;(0점, 복습 미등록)로 처리되고 완료한 문항만 결과에 공개됩니다.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowExitModal(false)}
                disabled={isFinishing}
              >
                계속 풀기
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void finalizeAndExit()}
                disabled={isFinishing}
              >
                {isFinishing ? '정리 중...' : '끝내기 확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
