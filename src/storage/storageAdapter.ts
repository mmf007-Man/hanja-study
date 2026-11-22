import type {
  AppBackupPayload,
  CompletedSessionRecord,
  DailyChallengeRecord,
  ReadingExposureStat,
  ReviewItem,
  SessionSnapshot,
  StorageMeta,
  StorageUsageInfo,
  UserProfile,
} from '../types/storage';

export interface StorageAdapter {
  readonly mode: 'local' | 'remote';

  // 프로필 관리
  listProfiles(): Promise<UserProfile[]>;
  saveProfile(profile: UserProfile): Promise<UserProfile>;
  deleteProfile(profileId: string): Promise<void>;
  getActiveProfileId(): Promise<string | null>;
  setActiveProfileId(profileId: string): Promise<void>;

  // 메타/용량 상태
  getMeta(): Promise<StorageMeta>;
  saveMeta(meta: StorageMeta): Promise<StorageMeta>;
  getStorageUsageInfo(): Promise<StorageUsageInfo>;

  // 학습 회차 & 이어하기 스냅샷
  getActiveSession(profileId: string): Promise<SessionSnapshot | null>;
  saveActiveSession(profileId: string, snapshot: SessionSnapshot): Promise<void>;
  clearActiveSession(profileId: string): Promise<void>;
  appendCompletedSession(
    profileId: string,
    summary: CompletedSessionRecord,
  ): Promise<void>;
  listCompletedSessions(
    profileId: string,
    limit?: number,
  ): Promise<CompletedSessionRecord[]>;

  // 뜻·음 쌍 개인 누적 출제 이력
  getExposureStats(
    profileId: string,
  ): Promise<Record<string, ReadingExposureStat>>;
  recordReadingExposure(
    profileId: string,
    readingKey: string,
    exposedAt: string,
  ): Promise<void>;

  // 오답 복습 큐
  getReviewQueue(profileId: string): Promise<Record<string, ReviewItem>>;
  upsertReviewItems(profileId: string, items: ReviewItem[]): Promise<void>;

  // 하루 도전
  getDailyChallenge(
    profileId: string,
    dateKey: string,
  ): Promise<DailyChallengeRecord | null>;
  saveDailyChallenge(
    profileId: string,
    record: DailyChallengeRecord,
  ): Promise<void>;

  // 백업 & 마이그레이션
  exportBackup(): Promise<AppBackupPayload>;
  importBackup(
    payload: AppBackupPayload,
    strategy: 'replace' | 'merge',
  ): Promise<void>;
}
