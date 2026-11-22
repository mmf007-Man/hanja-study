import React, { useMemo } from 'react';
import type { CatalogStore } from '../data/catalogStore';
import { calculateSessionMetrics } from '../engine/gradingEngine';
import type {
  AnswerRecord,
  CompletedSessionRecord,
  DailyChallengeRecord,
  UserProfile,
} from '../types/storage';
import { getAvatarPreset } from '../utils/avatars';
import {
  QUESTION_TYPE_SHORT_LABELS,
  SESSION_MODE_LABELS,
  formatCharacterReadingsSummary,
  formatDurationMs,
  formatPercent,
} from '../utils/labels';

export interface FamilyDailyEntry {
  profile: UserProfile;
  record: DailyChallengeRecord;
}

export interface ResultScreenProps {
  catalog: CatalogStore;
  activeProfileId: string;
  completedSession: CompletedSessionRecord | null;
  dailyRecord: DailyChallengeRecord | null;
  familyDailyLeaderboard: FamilyDailyEntry[];
  pendingReviewCount: number;
  isDailyView: boolean;
  onStartReview: () => void;
  onRetrySameScope: () => void;
  onGoHome: () => void;
}

function getAnswerBadgeInfo(answer: AnswerRecord): {
  label: string;
  className: string;
} {
  if (answer.outcome === 'correct') {
    return { label: '✓ 정답', className: 'pill-success' };
  }
  if (answer.outcome === 'dont_know') {
    return { label: '? 모르겠어요', className: 'pill-neutral' };
  }
  if (answer.outcome === 'abandoned') {
    return { label: '— 중도 이탈', className: 'pill-muted' };
  }
  if (answer.errorType === 'pair_mismatch') {
    return { label: '⚠ 개별 존재하나 쌍 불일치', className: 'pill-warning' };
  }
  return { label: '✕ 오답', className: 'pill-danger' };
}

export const ResultScreen: React.FC<ResultScreenProps> = ({
  catalog,
  activeProfileId,
  completedSession,
  dailyRecord,
  familyDailyLeaderboard,
  pendingReviewCount,
  isDailyView,
  onStartReview,
  onRetrySameScope,
  onGoHome,
}) => {
  const metrics = useMemo(() => {
    if (!completedSession) return null;
    return calculateSessionMetrics(completedSession.answers);
  }, [completedSession]);

  const pairMismatchAnswers = useMemo(() => {
    if (!completedSession) return [];
    return completedSession.answers.filter(
      (a) => a.errorType === 'pair_mismatch',
    );
  }, [completedSession]);

  const durationMs = useMemo(() => {
    if (completedSession) {
      const startMs = Date.parse(completedSession.startedAt);
      const endMs = Date.parse(completedSession.completedAt);
      if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
        return Math.max(0, endMs - startMs);
      }
    }
    return dailyRecord?.durationMs ?? 0;
  }, [completedSession, dailyRecord]);

  const sortedLeaderboard = useMemo(() => {
    return [...familyDailyLeaderboard].sort((a, b) => {
      if (b.record.score !== a.record.score) {
        return b.record.score - a.record.score;
      }
      if (a.record.durationMs !== b.record.durationMs) {
        return a.record.durationMs - b.record.durationMs;
      }
      return a.record.completedAt.localeCompare(b.record.completedAt);
    });
  }, [familyDailyLeaderboard]);

  const displayScore = completedSession?.score ?? dailyRecord?.score ?? 0;
  const displayMaxScore =
    completedSession?.maxScore ?? dailyRecord?.maxScore ?? 0;
  const modeTitle = isDailyView
    ? '하루 도전 결과'
    : completedSession
      ? `${SESSION_MODE_LABELS[completedSession.mode]} 결과`
      : '학습 결과';

  return (
    <div className="screen-stack" data-testid="result-screen">
      <header className="screen-header">
        <div>
          <h1 className="screen-title">{modeTitle}</h1>
          {isDailyView && dailyRecord && (
            <p className="screen-subtitle">기준 날짜: {dailyRecord.dateKey}</p>
          )}
        </div>
        <button type="button" className="btn btn-secondary" onClick={onGoHome}>
          홈으로
        </button>
      </header>

      {isDailyView && (
        <div className="daily-tabs" role="tablist" aria-label="순위표 보기">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="daily-tab is-active"
          >
            오늘 가족 비교
          </button>
          <button
            type="button"
            role="tab"
            aria-selected="false"
            disabled
            className="daily-tab"
          >
            주간 순위 (2차 업데이트 예정)
          </button>
        </div>
      )}

      <section className="card result-summary-card" aria-label="요약 점수">
        <div className="result-score-hero">
          <div className="result-score-main">
            <span className="result-score-label">획득 점수</span>
            <strong className="result-score-value" data-testid="result-score">
              {displayScore} / {displayMaxScore}점
            </strong>
          </div>
          <div className="result-time-box">
            <span className="result-score-label">소요 시간</span>
            <strong className="result-time-value">
              {formatDurationMs(durationMs)}
            </strong>
          </div>
        </div>

        {metrics && (
          <div className="accuracy-grid">
            <div className="accuracy-card" data-testid="question-accuracy-card">
              <span className="accuracy-title">문항 정답률</span>
              <strong className="accuracy-value">
                {formatPercent(metrics.correctCount, metrics.confirmedCount)}
              </strong>
              <span className="accuracy-note">
                확정 응답 기준 (&apos;중도 이탈&apos; {metrics.abandonedCount}건 제외)
              </span>
            </div>

            <div className="accuracy-card" data-testid="reading-accuracy-card">
              <span className="accuracy-title">뜻·음 개별 정답률</span>
              <strong className="accuracy-value">
                {metrics.meaningAccuracy !== null &&
                metrics.soundAccuracy !== null
                  ? `뜻 ${Math.round(metrics.meaningAccuracy * 100)}% (${metrics.meaningCorrectCount}/${metrics.readingGradedCount}) · 음 ${Math.round(metrics.soundAccuracy * 100)}% (${metrics.soundCorrectCount}/${metrics.readingGradedCount})`
                  : '뜻·음 개별 채점 문항 없음'}
              </strong>
              <span className="accuracy-note">
                일반 제출 기준 · &apos;모르겠어요&apos; {metrics.dontKnowCount}건 · &apos;중도 이탈&apos; {metrics.abandonedCount}건 별도
              </span>
            </div>
          </div>
        )}
      </section>

      {pairMismatchAnswers.length > 0 && (
        <section
          className="card pair-mismatch-highlight"
          aria-label="쌍 불일치 오답 안내"
          data-testid="result-pair-mismatch-card"
        >
          <h2 className="card-title pair-mismatch-title">
            <span aria-hidden="true">⚠</span> 개별 존재하나 쌍 불일치 오답 ({pairMismatchAnswers.length}건)
          </h2>
          <ul className="mismatch-list">
            {pairMismatchAnswers.map((ans) => {
              const ch = catalog.getCharacterById(ans.characterId);
              return (
                <li key={ans.questionId} className="mismatch-item">
                  <div className="mismatch-user-row">
                    <strong className="mismatch-hanja" lang="zh-Hant">
                      {ch?.character ?? ans.characterId}
                    </strong>
                    <span>
                      내 답안: {ans.submittedMeaning ?? '-'} ·{' '}
                      {ans.submittedSound ?? '-'}
                    </span>
                  </div>
                  {ch && (
                    <div className="mismatch-correct-row">
                      올바른 뜻·음 쌍: {formatCharacterReadingsSummary(ch)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {isDailyView && (
        <section
          className="card"
          aria-labelledby="family-leaderboard-heading"
          data-testid="family-leaderboard"
        >
          <h2 id="family-leaderboard-heading" className="card-title">
            기기 내 가족 비교표
          </h2>
          {sortedLeaderboard.length === 0 ? (
            <p className="empty-state">오늘 완료된 가족 기록이 아직 없습니다.</p>
          ) : (
            <ol className="leaderboard-list">
              {sortedLeaderboard.map((entry, idx) => {
                const avatar = getAvatarPreset(entry.profile.avatarId);
                const isMe = entry.profile.id === activeProfileId;
                return (
                  <li
                    key={entry.profile.id}
                    className={`leaderboard-row${isMe ? ' is-me' : ''}`}
                    data-testid={`leaderboard-row-${entry.profile.id}`}
                  >
                    <span className="leaderboard-rank">{idx + 1}위</span>
                    <span
                      className="avatar-badge avatar-badge-sm"
                      style={{
                        backgroundColor: avatar.bg,
                        color: avatar.color,
                      }}
                      aria-hidden="true"
                    >
                      {avatar.icon}
                    </span>
                    <span className="leaderboard-name">
                      {entry.profile.name}
                      {isMe && <span className="pill pill-primary">나</span>}
                    </span>
                    <span className="leaderboard-score">
                      <strong>
                        {entry.record.score}/{entry.record.maxScore}점
                      </strong>
                      <span className="leaderboard-meta">
                        {entry.record.correctCount}/{entry.record.totalCount} ·{' '}
                        {formatDurationMs(entry.record.durationMs)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}

      {completedSession && (
        <section className="card" aria-labelledby="answer-reveal-heading">
          <h2 id="answer-reveal-heading" className="card-title">
            문항별 정답 공개 ({completedSession.answers.length}문항)
          </h2>
          <ol className="answer-reveal-list">
            {completedSession.answers.map((ans, idx) => {
              const ch = catalog.getCharacterById(ans.characterId);
              const badge = getAnswerBadgeInfo(ans);
              const chosenChar = ans.submittedCharacterId
                ? catalog.getCharacterById(ans.submittedCharacterId)
                : undefined;

              let userAnswerText = '-';
              if (ans.outcome === 'dont_know') {
                userAnswerText = '모르겠어요';
              } else if (ans.outcome === 'abandoned') {
                userAnswerText = '중도 이탈';
              } else if (
                ans.questionType === 'hanja_to_choice' ||
                ans.questionType === 'hanja_to_input'
              ) {
                userAnswerText = `${ans.submittedMeaning ?? '-'} · ${ans.submittedSound ?? '-'}`;
              } else if (ans.questionType === 'reading_to_choice') {
                userAnswerText = chosenChar?.character ?? ans.submittedCharacterId ?? '-';
              } else if (ans.questionType === 'reading_to_write') {
                userAnswerText = '쓰기 완료';
              }

              return (
                <li key={ans.questionId} className="answer-reveal-item">
                  <div className="answer-item-top">
                    <span className="answer-item-num">#{idx + 1}</span>
                    <span className="pill pill-neutral">
                      {QUESTION_TYPE_SHORT_LABELS[ans.questionType]}
                    </span>
                    <span className={`pill ${badge.className}`}>
                      {badge.label}
                    </span>
                    {ans.strokeGuideUsed && (
                      <span className="pill pill-info">점선 가이드 사용</span>
                    )}
                  </div>

                  <div className="answer-item-main">
                    <span className="answer-item-hanja" lang="zh-Hant">
                      {ch?.character ?? ans.characterId}
                    </span>
                    <div className="answer-item-details">
                      <div>
                        <span className="detail-label">내 답안:</span>{' '}
                        <span>{userAnswerText}</span>
                      </div>
                      {ch && (
                        <div>
                          <span className="detail-label">교과서 정답:</span>{' '}
                          <strong>{formatCharacterReadingsSummary(ch)}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <footer className="result-actions">
        {pendingReviewCount > 0 && (
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={onStartReview}
          >
            오답 복습 바로 시작 ({pendingReviewCount}개)
          </button>
        )}
        <div className="btn-row-equal">
          {(completedSession?.mode !== 'review' || pendingReviewCount > 0) && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onRetrySameScope}
            >
              같은 범위 다시 풀기
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={onGoHome}>
            홈으로
          </button>
        </div>
      </footer>
    </div>
  );
};
