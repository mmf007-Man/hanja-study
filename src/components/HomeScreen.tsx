import React from 'react';
import type {
  DailyChallengeRecord,
  SessionSnapshot,
  UserProfile,
} from '../types/storage';
import { getAvatarPreset } from '../utils/avatars';
import { SESSION_MODE_LABELS } from '../utils/labels';

export interface HomeScreenProps {
  profile: UserProfile;
  activeSession: SessionSnapshot | null;
  pendingReviewCount: number;
  completedReviewCount: number;
  studiedCharacterCount: number;
  todaySolvedCount: number;
  todayDateKey: string;
  todayDailyRecord: DailyChallengeRecord | null;
  onOpenProfiles: () => void;
  onResumeSession: () => void;
  onOpenStudySetup: () => void;
  onStartReview: () => void;
  onStartDaily: (forcePractice?: boolean) => void;
  onViewDailyResult: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  profile,
  activeSession,
  pendingReviewCount,
  completedReviewCount,
  studiedCharacterCount,
  todaySolvedCount,
  todayDateKey,
  todayDailyRecord,
  onOpenProfiles,
  onResumeSession,
  onOpenStudySetup,
  onStartReview,
  onStartDaily,
  onViewDailyResult,
}) => {
  const avatar = getAvatarPreset(profile.avatarId);
  const activeAnswered = activeSession?.answers.length ?? 0;
  const activeTotal = activeSession?.questions.length ?? 0;
  const canResumeReview = activeSession?.mode === 'review';

  return (
    <div className="screen-stack" data-testid="home-screen">
      <header className="top-nav-bar">
        <button
          type="button"
          className="profile-chip-btn"
          onClick={onOpenProfiles}
          aria-label="프로필 전환"
        >
          <span
            className="avatar-badge avatar-badge-sm"
            style={{ backgroundColor: avatar.bg, color: avatar.color }}
            aria-hidden="true"
          >
            {avatar.icon}
          </span>
          <span className="profile-chip-name">{profile.name}</span>
          <span className="profile-chip-action">프로필 전환</span>
        </button>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onOpenProfiles}
        >
          설정 · 백업
        </button>
      </header>

      {activeSession && (
        <section className="resume-banner" aria-label="진행 중인 학습 이어하기">
          <div className="resume-banner-text">
            <strong>
              진행 중: {SESSION_MODE_LABELS[activeSession.mode]}
            </strong>
            <span>
              {activeSession.mode === 'review'
                ? `복습 대기 ${pendingReviewCount}개 · ${activeAnswered}문항 완료`
                : `${activeAnswered} / ${activeTotal}문항 완료`}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onResumeSession}
          >
            이어하기
          </button>
        </section>
      )}

      <section className="mode-cards-grid" aria-label="학습 모드 선택">
        <article className="mode-card">
          <div className="mode-card-header">
            <h2 className="mode-card-title">일반 학습</h2>
            {activeSession?.mode === 'normal' && (
              <span className="pill pill-info">
                진행 중 회차 있음 ({activeAnswered}/{activeTotal})
              </span>
            )}
          </div>
          <p className="mode-card-desc">
            단원과 문제 유형(객관식·주관식·쓰기)을 골라 20문제를 풉니다.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={onOpenStudySetup}
          >
            일반 학습 설정
          </button>
        </article>

        <article className="mode-card">
          <div className="mode-card-header">
            <h2 className="mode-card-title">오답 복습</h2>
            {pendingReviewCount > 0 ? (
              <span className="pill pill-warning">
                복습 대기 {pendingReviewCount}개
              </span>
            ) : (
              <span className="pill pill-neutral">대기 0개</span>
            )}
          </div>
          <p className="mode-card-desc">
            틀렸던 한자를 원래 문제 형식으로 연속 2회 맞혀 복습을 마칩니다.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={pendingReviewCount === 0 && !canResumeReview}
            onClick={onStartReview}
          >
            {canResumeReview
              ? '오답 복습 이어하기'
              : pendingReviewCount > 0
                ? `오답 복습 시작 (${pendingReviewCount}개)`
                : '복습할 오답이 없어요'}
          </button>
        </article>

        <article className="mode-card">
          <div className="mode-card-header">
            <h2 className="mode-card-title">하루 도전</h2>
            {todayDailyRecord ? (
              <span className="pill pill-success">
                ✓ 오늘 완료 · {todayDailyRecord.score}/{todayDailyRecord.maxScore}점
              </span>
            ) : activeSession?.mode === 'daily' ? (
              <span className="pill pill-info">
                진행 중 ({activeAnswered}/{activeTotal})
              </span>
            ) : (
              <span className="pill pill-neutral">{todayDateKey}</span>
            )}
          </div>
          <p className="mode-card-desc">
            오늘 날짜 기준 동일 20문제를 풀고 기기 내 가족과 점수를 비교합니다.
          </p>
          {todayDailyRecord ? (
            <div className="daily-card-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onViewDailyResult}
              >
                오늘 결과 · 가족 비교
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onStartDaily(true)}
              >
                연습으로 다시 풀기
              </button>
              <p className="field-hint">
                오늘의 첫 공식 기록({todayDailyRecord.score}점)이 가족 비교표에 유지됩니다.
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => onStartDaily(false)}
            >
              {activeSession?.mode === 'daily'
                ? '하루 도전 이어하기'
                : '오늘의 도전 시작'}
            </button>
          )}
        </article>
      </section>

      <section className="summary-bar" aria-label="개인 학습 요약">
        <div className="summary-stat">
          <span className="summary-stat-label">누적 학습 한자</span>
          <strong className="summary-stat-value">{studiedCharacterCount}자</strong>
        </div>
        <div className="summary-stat">
          <span className="summary-stat-label">오늘 푼 문항</span>
          <strong className="summary-stat-value">{todaySolvedCount}문항</strong>
        </div>
        <div className="summary-stat">
          <span className="summary-stat-label">복습 완료 누적</span>
          <strong className="summary-stat-value">{completedReviewCount}개</strong>
        </div>
      </section>
    </div>
  );
};
