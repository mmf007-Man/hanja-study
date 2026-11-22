import type { QuestionType } from './catalog';

export type TolerancePreset = 'strict' | 'normal' | 'lenient';

export interface UserProfile {
  id: string;
  name: string;
  avatarId: string;
  createdAt: string;
}

export interface ReadingExposureStat {
  readingKey: string;
  characterId: string;
  sound: string;
  exposureCount: number;
  lastExposedAt: string | null;
}

export interface FrozenQuestion {
  questionId: string;
  characterId: string;
  questionType: QuestionType;
  targetSound: string;
  targetMeanings: string[];
  meaningChoices?: string[];
  soundChoices?: string[];
  characterChoices?: string[];
  reviewItemId?: string;
}

export type AnswerOutcome = 'correct' | 'incorrect' | 'dont_know' | 'abandoned';

export type AnswerErrorType =
  | 'meaning_error'
  | 'sound_error'
  | 'both_error'
  | 'pair_mismatch'
  | 'dont_know'
  | 'abandoned';

export interface AnswerRecord {
  questionId: string;
  characterId: string;
  questionType: QuestionType;
  targetSound: string;
  score: 0 | 2;
  outcome: AnswerOutcome;
  meaningCorrect?: boolean;
  soundCorrect?: boolean;
  pairMatched?: boolean;
  errorType?: AnswerErrorType;
  strokeGuideUsed?: boolean;
  submittedAt: string;
}

export type SessionMode = 'normal' | 'review' | 'daily';

export interface SessionSnapshot {
  sessionId: string;
  mode: SessionMode;
  dataVersion: string;
  unitIds: string[];
  selectedTypes: QuestionType[];
  questions: FrozenQuestion[];
  currentIndex: number;
  exposedQuestionIds: string[];
  answers: AnswerRecord[];
  startedAt: string;
  updatedAt: string;
}

export type ReviewHistoryEvent =
  | 'registered'
  | 'review_pass'
  | 'review_fail'
  | 'completed'
  | 'reopened';

export interface ReviewHistoryEntry {
  at: string;
  event: ReviewHistoryEvent;
  sessionId: string;
  errorType?: AnswerErrorType;
}

export interface ReviewItem {
  reviewItemId: string;
  characterId: string;
  questionType: QuestionType;
  targetSound: string;
  targetMeanings: string[];
  status: 'needs_review' | 'completed';
  sessionStreak: number;
  lastErrorType?: AnswerErrorType;
  history: ReviewHistoryEntry[];
}

export interface DailyChallengeRecord {
  dateKey: string;
  sessionId: string;
  dataVersion: string;
  score: number;
  maxScore: number;
  correctCount: number;
  totalCount: number;
  durationMs: number;
  completedAt: string;
}

export interface CompletedSessionRecord {
  sessionId: string;
  mode: SessionMode;
  dataVersion: string;
  unitIds: string[];
  selectedTypes: QuestionType[];
  score: number;
  maxScore: number;
  answeredCount: number;
  correctCount: number;
  dontKnowCount: number;
  abandonedCount: number;
  meaningCorrectCount?: number;
  soundCorrectCount?: number;
  readingGradedCount?: number;
  answers: AnswerRecord[];
  startedAt: string;
  completedAt: string;
}

export interface ProfileLearningState {
  schemaVersion: 1;
  profileId: string;
  activeSession: SessionSnapshot | null;
  exposureStats: Record<string, ReadingExposureStat>;
  reviewQueue: Record<string, ReviewItem>;
  dailyChallenges: Record<string, DailyChallengeRecord>;
  completedSessions: CompletedSessionRecord[];
}

export interface AppBackupPayload {
  exportFormat: 'hanja-study-backup';
  exportSchemaVersion: 1;
  exportedAt: string;
  dataVersion: string;
  activeProfileId: string | null;
  profiles: UserProfile[];
  states: Record<string, ProfileLearningState>;
}

export interface StorageMeta {
  schemaVersion: 1;
  activeProfileId: string | null;
  tolerancePreset: TolerancePreset;
}

export interface StorageUsageInfo {
  usedBytes: number;
  quotaBytes: number;
  usageRatio: number;
  isWarning: boolean;
}

export class StorageQuotaExceededError extends Error {
  readonly causeError?: unknown;

  constructor(
    message = '저장 공간이 부족합니다. JSON 백업 후 오래된 기록을 정리해 주세요.',
    causeError?: unknown,
  ) {
    super(message);
    this.name = 'StorageQuotaExceededError';
    this.causeError = causeError;
  }
}

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileValidationError';
  }
}
