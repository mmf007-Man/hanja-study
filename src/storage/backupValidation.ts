import type { QuestionType } from '../types/catalog';
import {
  BackupValidationError,
  ProfileValidationError,
  type AnswerErrorType,
  type AnswerOutcome,
  type AnswerRecord,
  type AppBackupPayload,
  type CompletedSessionRecord,
  type DailyChallengeRecord,
  type FrozenQuestion,
  type ProfileLearningState,
  type ReadingExposureStat,
  type ReviewHistoryEntry,
  type ReviewHistoryEvent,
  type ReviewItem,
  type SessionMode,
  type SessionSnapshot,
  type UserProfile,
} from '../types/storage';

export const BACKUP_EXPORT_FORMAT = 'hanja-study-backup';
export const BACKUP_EXPORT_SCHEMA_VERSION = 1;
export const PROFILE_STATE_SCHEMA_VERSION = 1;
export const PROFILE_NAME_MIN_LENGTH = 1;
export const PROFILE_NAME_MAX_LENGTH = 12;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const VALID_QUESTION_TYPES = new Set<QuestionType>([
  'hanja_to_choice',
  'hanja_to_input',
  'reading_to_choice',
  'reading_to_write',
]);

const VALID_SESSION_MODES = new Set<SessionMode>(['normal', 'review', 'daily']);

const VALID_ANSWER_OUTCOMES = new Set<AnswerOutcome>([
  'correct',
  'incorrect',
  'dont_know',
  'abandoned',
]);

const VALID_ERROR_TYPES = new Set<AnswerErrorType>([
  'meaning_error',
  'sound_error',
  'both_error',
  'pair_mismatch',
  'dont_know',
  'abandoned',
]);

const VALID_REVIEW_EVENTS = new Set<ReviewHistoryEvent>([
  'registered',
  'review_pass',
  'review_fail',
  'completed',
  'reopened',
]);

export function normalizeAndValidateProfileName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new ProfileValidationError('프로필 이름은 문자열이어야 합니다.');
  }
  const trimmed = name.trim();
  const length = [...trimmed].length;
  if (length < PROFILE_NAME_MIN_LENGTH || length > PROFILE_NAME_MAX_LENGTH) {
    throw new ProfileValidationError(
      `프로필 이름은 공백 제외 ${PROFILE_NAME_MIN_LENGTH}~${PROFILE_NAME_MAX_LENGTH}자여야 합니다.`,
    );
  }
  return trimmed;
}

function assertSafeObjectGraph(value: unknown, path = 'root'): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertSafeObjectGraph(value[i], `${path}[${i}]`);
    }
    return;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new BackupValidationError(
      `허용되지 않은 객체 프로토타입이 감지되었습니다 (${path}).`,
    );
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new BackupValidationError(
        `보안상 허용되지 않는 키('${key}')가 포함되어 있습니다 (${path}).`,
      );
    }
    const child = (value as Record<string, unknown>)[key];
    assertSafeObjectGraph(child, `${path}.${key}`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BackupValidationError(`${label}은(는) 비어 있지 않은 문자열이어야 합니다.`);
  }
  return value;
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new BackupValidationError(`${label}은(는) 배열이어야 합니다.`);
  }
  return value.map((item, idx) =>
    assertNonEmptyString(item, `${label}[${idx}]`),
  );
}

function assertNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BackupValidationError(`${label}은(는) 0 이상의 정수여야 합니다.`);
  }
  return value;
}

function assertQuestionType(value: unknown, label: string): QuestionType {
  if (typeof value !== 'string' || !VALID_QUESTION_TYPES.has(value as QuestionType)) {
    throw new BackupValidationError(`유효하지 않은 문제 유형입니다 (${label}).`);
  }
  return value as QuestionType;
}

function validateUserProfile(value: unknown, index: number): UserProfile {
  if (!isPlainRecord(value)) {
    throw new BackupValidationError(`profiles[${index}]는 객체여야 합니다.`);
  }
  const id = assertNonEmptyString(value.id, `profiles[${index}].id`);
  let name: string;
  try {
    name = normalizeAndValidateProfileName(value.name);
  } catch (error) {
    throw new BackupValidationError(
      error instanceof Error ? error.message : `profiles[${index}].name이 유효하지 않습니다.`,
    );
  }
  const avatarId = assertNonEmptyString(value.avatarId, `profiles[${index}].avatarId`);
  const createdAt = assertNonEmptyString(value.createdAt, `profiles[${index}].createdAt`);

  return { id, name, avatarId, createdAt };
}

function validateFrozenQuestion(value: unknown, path: string): FrozenQuestion {
  if (!isPlainRecord(value)) {
    throw new BackupValidationError(`${path}는 객체여야 합니다.`);
  }

  const question: FrozenQuestion = {
    questionId: assertNonEmptyString(value.questionId, `${path}.questionId`),
    characterId: assertNonEmptyString(value.characterId, `${path}.characterId`),
    questionType: assertQuestionType(value.questionType, `${path}.questionType`),
    targetSound: assertNonEmptyString(value.targetSound, `${path}.targetSound`),
    targetMeanings: assertStringArray(value.targetMeanings, `${path}.targetMeanings`),
  };

  if (value.meaningChoices !== undefined) {
    question.meaningChoices = assertStringArray(value.meaningChoices, `${path}.meaningChoices`);
  }
  if (value.soundChoices !== undefined) {
    question.soundChoices = assertStringArray(value.soundChoices, `${path}.soundChoices`);
  }
  if (value.characterChoices !== undefined) {
    question.characterChoices = assertStringArray(
      value.characterChoices,
      `${path}.characterChoices`,
    );
  }
  if (value.reviewItemId !== undefined) {
    question.reviewItemId = assertNonEmptyString(value.reviewItemId, `${path}.reviewItemId`);
  }

  return question;
}

function validateAnswerRecord(value: unknown, path: string): AnswerRecord {
  if (!isPlainRecord(value)) {
    throw new BackupValidationError(`${path}는 객체여야 합니다.`);
  }
  if (value.score !== 0 && value.score !== 2) {
    throw new BackupValidationError(`${path}.score는 0 또는 2여야 합니다.`);
  }
  if (
    typeof value.outcome !== 'string' ||
    !VALID_ANSWER_OUTCOMES.has(value.outcome as AnswerOutcome)
  ) {
    throw new BackupValidationError(`${path}.outcome이 유효하지 않습니다.`);
  }

  const record: AnswerRecord = {
    questionId: assertNonEmptyString(value.questionId, `${path}.questionId`),
    characterId: assertNonEmptyString(value.characterId, `${path}.characterId`),
    questionType: assertQuestionType(value.questionType, `${path}.questionType`),
    targetSound: assertNonEmptyString(value.targetSound, `${path}.targetSound`),
    score: value.score,
    outcome: value.outcome as AnswerOutcome,
    submittedAt: assertNonEmptyString(value.submittedAt, `${path}.submittedAt`),
  };

  if (value.meaningCorrect !== undefined) {
    if (typeof value.meaningCorrect !== 'boolean') {
      throw new BackupValidationError(`${path}.meaningCorrect는 boolean이어야 합니다.`);
    }
    record.meaningCorrect = value.meaningCorrect;
  }
  if (value.soundCorrect !== undefined) {
    if (typeof value.soundCorrect !== 'boolean') {
      throw new BackupValidationError(`${path}.soundCorrect는 boolean이어야 합니다.`);
    }
    record.soundCorrect = value.soundCorrect;
  }
  if (value.pairMatched !== undefined) {
    if (typeof value.pairMatched !== 'boolean') {
      throw new BackupValidationError(`${path}.pairMatched는 boolean이어야 합니다.`);
    }
    record.pairMatched = value.pairMatched;
  }
  if (value.errorType !== undefined) {
    if (
      typeof value.errorType !== 'string' ||
      !VALID_ERROR_TYPES.has(value.errorType as AnswerErrorType)
    ) {
      throw new BackupValidationError(`${path}.errorType이 유효하지 않습니다.`);
    }
    record.errorType = value.errorType as AnswerErrorType;
  }
  if (value.strokeGuideUsed !== undefined) {
    if (typeof value.strokeGuideUsed !== 'boolean') {
      throw new BackupValidationError(`${path}.strokeGuideUsed는 boolean이어야 합니다.`);
    }
    record.strokeGuideUsed = value.strokeGuideUsed;
  }

  return record;
}

function validateSessionSnapshot(value: unknown, path: string): SessionSnapshot {
  if (!isPlainRecord(value)) {
    throw new BackupValidationError(`${path}는 객체여야 합니다.`);
  }
  if (
    typeof value.mode !== 'string' ||
    !VALID_SESSION_MODES.has(value.mode as SessionMode)
  ) {
    throw new BackupValidationError(`${path}.mode가 유효하지 않습니다.`);
  }
  if (!Array.isArray(value.selectedTypes)) {
    throw new BackupValidationError(`${path}.selectedTypes는 배열이어야 합니다.`);
  }
  if (!Array.isArray(value.questions)) {
    throw new BackupValidationError(`${path}.questions는 배열이어야 합니다.`);
  }
  if (!Array.isArray(value.answers)) {
    throw new BackupValidationError(`${path}.answers는 배열이어야 합니다.`);
  }

  return {
    sessionId: assertNonEmptyString(value.sessionId, `${path}.sessionId`),
    mode: value.mode as SessionMode,
    dataVersion: assertNonEmptyString(value.dataVersion, `${path}.dataVersion`),
    unitIds: assertStringArray(value.unitIds, `${path}.unitIds`),
    selectedTypes: value.selectedTypes.map((t, idx) =>
      assertQuestionType(t, `${path}.selectedTypes[${idx}]`),
    ),
    questions: value.questions.map((q, idx) =>
      validateFrozenQuestion(q, `${path}.questions[${idx}]`),
    ),
    currentIndex: assertNonNegativeInteger(value.currentIndex, `${path}.currentIndex`),
    exposedQuestionIds: assertStringArray(
      value.exposedQuestionIds,
      `${path}.exposedQuestionIds`,
    ),
    answers: value.answers.map((a, idx) =>
      validateAnswerRecord(a, `${path}.answers[${idx}]`),
    ),
    startedAt: assertNonEmptyString(value.startedAt, `${path}.startedAt`),
    updatedAt: assertNonEmptyString(value.updatedAt, `${path}.updatedAt`),
  };
}

function validateExposureStats(
  value: unknown,
  path: string,
): Record<string, ReadingExposureStat> {
  if (!isPlainRecord(value)) {
    throw new BackupValidationError(`${path}는 객체여야 합니다.`);
  }
  const result: Record<string, ReadingExposureStat> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isPlainRecord(entry)) {
      throw new BackupValidationError(`${path}.${key}는 객체여야 합니다.`);
    }
    const readingKey = assertNonEmptyString(
      entry.readingKey,
      `${path}.${key}.readingKey`,
    );
    if (readingKey !== key) {
      throw new BackupValidationError(`${path}.${key}의 키가 readingKey와 일치하지 않습니다.`);
    }
    if (entry.lastExposedAt !== null && typeof entry.lastExposedAt !== 'string') {
      throw new BackupValidationError(
        `${path}.${key}.lastExposedAt은 문자열 또는 null이어야 합니다.`,
      );
    }
    result[key] = {
      readingKey,
      characterId: assertNonEmptyString(entry.characterId, `${path}.${key}.characterId`),
      sound: assertNonEmptyString(entry.sound, `${path}.${key}.sound`),
      exposureCount: assertNonNegativeInteger(
        entry.exposureCount,
        `${path}.${key}.exposureCount`,
      ),
      lastExposedAt: entry.lastExposedAt,
    };
  }
  return result;
}

function validateReviewHistoryEntry(value: unknown, path: string): ReviewHistoryEntry {
  if (!isPlainRecord(value)) {
    throw new BackupValidationError(`${path}는 객체여야 합니다.`);
  }
  if (
    typeof value.event !== 'string' ||
    !VALID_REVIEW_EVENTS.has(value.event as ReviewHistoryEvent)
  ) {
    throw new BackupValidationError(`${path}.event가 유효하지 않습니다.`);
  }
  const entry: ReviewHistoryEntry = {
    at: assertNonEmptyString(value.at, `${path}.at`),
    event: value.event as ReviewHistoryEvent,
    sessionId: assertNonEmptyString(value.sessionId, `${path}.sessionId`),
  };
  if (value.errorType !== undefined) {
    if (
      typeof value.errorType !== 'string' ||
      !VALID_ERROR_TYPES.has(value.errorType as AnswerErrorType)
    ) {
      throw new BackupValidationError(`${path}.errorType이 유효하지 않습니다.`);
    }
    entry.errorType = value.errorType as AnswerErrorType;
  }
  return entry;
}

function validateReviewQueue(value: unknown, path: string): Record<string, ReviewItem> {
  if (!isPlainRecord(value)) {
    throw new BackupValidationError(`${path}는 객체여야 합니다.`);
  }
  const result: Record<string, ReviewItem> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isPlainRecord(item)) {
      throw new BackupValidationError(`${path}.${key}는 객체여야 합니다.`);
    }
    const reviewItemId = assertNonEmptyString(
      item.reviewItemId,
      `${path}.${key}.reviewItemId`,
    );
    if (reviewItemId !== key) {
      throw new BackupValidationError(
        `${path}.${key}의 키가 reviewItemId와 일치하지 않습니다.`,
      );
    }
    if (item.status !== 'needs_review' && item.status !== 'completed') {
      throw new BackupValidationError(`${path}.${key}.status가 유효하지 않습니다.`);
    }
    if (!Array.isArray(item.history)) {
      throw new BackupValidationError(`${path}.${key}.history는 배열이어야 합니다.`);
    }

    const validatedItem: ReviewItem = {
      reviewItemId,
      characterId: assertNonEmptyString(item.characterId, `${path}.${key}.characterId`),
      questionType: assertQuestionType(item.questionType, `${path}.${key}.questionType`),
      targetSound: assertNonEmptyString(item.targetSound, `${path}.${key}.targetSound`),
      targetMeanings: assertStringArray(
        item.targetMeanings,
        `${path}.${key}.targetMeanings`,
      ),
      status: item.status,
      sessionStreak: assertNonNegativeInteger(
        item.sessionStreak,
        `${path}.${key}.sessionStreak`,
      ),
      history: item.history.map((h, idx) =>
        validateReviewHistoryEntry(h, `${path}.${key}.history[${idx}]`),
      ),
    };

    if (item.lastErrorType !== undefined) {
      if (
        typeof item.lastErrorType !== 'string' ||
        !VALID_ERROR_TYPES.has(item.lastErrorType as AnswerErrorType)
      ) {
        throw new BackupValidationError(`${path}.${key}.lastErrorType이 유효하지 않습니다.`);
      }
      validatedItem.lastErrorType = item.lastErrorType as AnswerErrorType;
    }

    result[key] = validatedItem;
  }
  return result;
}

function validateDailyChallenges(
  value: unknown,
  path: string,
): Record<string, DailyChallengeRecord> {
  if (!isPlainRecord(value)) {
    throw new BackupValidationError(`${path}는 객체여야 합니다.`);
  }
  const result: Record<string, DailyChallengeRecord> = {};
  for (const [key, record] of Object.entries(value)) {
    if (!isPlainRecord(record)) {
      throw new BackupValidationError(`${path}.${key}는 객체여야 합니다.`);
    }
    const dateKey = assertNonEmptyString(record.dateKey, `${path}.${key}.dateKey`);
    if (dateKey !== key) {
      throw new BackupValidationError(`${path}.${key}의 키가 dateKey와 일치하지 않습니다.`);
    }
    result[key] = {
      dateKey,
      sessionId: assertNonEmptyString(record.sessionId, `${path}.${key}.sessionId`),
      dataVersion: assertNonEmptyString(record.dataVersion, `${path}.${key}.dataVersion`),
      score: assertNonNegativeInteger(record.score, `${path}.${key}.score`),
      maxScore: assertNonNegativeInteger(record.maxScore, `${path}.${key}.maxScore`),
      correctCount: assertNonNegativeInteger(
        record.correctCount,
        `${path}.${key}.correctCount`,
      ),
      totalCount: assertNonNegativeInteger(record.totalCount, `${path}.${key}.totalCount`),
      durationMs: assertNonNegativeInteger(record.durationMs, `${path}.${key}.durationMs`),
      completedAt: assertNonEmptyString(record.completedAt, `${path}.${key}.completedAt`),
    };
  }
  return result;
}

function validateCompletedSessions(
  value: unknown,
  path: string,
): CompletedSessionRecord[] {
  if (!Array.isArray(value)) {
    throw new BackupValidationError(`${path}는 배열이어야 합니다.`);
  }
  return value.map((item, idx) => {
    const itemPath = `${path}[${idx}]`;
    if (!isPlainRecord(item)) {
      throw new BackupValidationError(`${itemPath}는 객체여야 합니다.`);
    }
    if (
      typeof item.mode !== 'string' ||
      !VALID_SESSION_MODES.has(item.mode as SessionMode)
    ) {
      throw new BackupValidationError(`${itemPath}.mode가 유효하지 않습니다.`);
    }
    if (!Array.isArray(item.selectedTypes)) {
      throw new BackupValidationError(`${itemPath}.selectedTypes는 배열이어야 합니다.`);
    }
    if (!Array.isArray(item.answers)) {
      throw new BackupValidationError(`${itemPath}.answers는 배열이어야 합니다.`);
    }

    const record: CompletedSessionRecord = {
      sessionId: assertNonEmptyString(item.sessionId, `${itemPath}.sessionId`),
      mode: item.mode as SessionMode,
      dataVersion: assertNonEmptyString(item.dataVersion, `${itemPath}.dataVersion`),
      unitIds: assertStringArray(item.unitIds, `${itemPath}.unitIds`),
      selectedTypes: item.selectedTypes.map((t, tIdx) =>
        assertQuestionType(t, `${itemPath}.selectedTypes[${tIdx}]`),
      ),
      score: assertNonNegativeInteger(item.score, `${itemPath}.score`),
      maxScore: assertNonNegativeInteger(item.maxScore, `${itemPath}.maxScore`),
      answeredCount: assertNonNegativeInteger(
        item.answeredCount,
        `${itemPath}.answeredCount`,
      ),
      correctCount: assertNonNegativeInteger(item.correctCount, `${itemPath}.correctCount`),
      dontKnowCount: assertNonNegativeInteger(
        item.dontKnowCount,
        `${itemPath}.dontKnowCount`,
      ),
      abandonedCount: assertNonNegativeInteger(
        item.abandonedCount,
        `${itemPath}.abandonedCount`,
      ),
      answers: item.answers.map((a, aIdx) =>
        validateAnswerRecord(a, `${itemPath}.answers[${aIdx}]`),
      ),
      startedAt: assertNonEmptyString(item.startedAt, `${itemPath}.startedAt`),
      completedAt: assertNonEmptyString(item.completedAt, `${itemPath}.completedAt`),
    };

    if (item.meaningCorrectCount !== undefined) {
      record.meaningCorrectCount = assertNonNegativeInteger(
        item.meaningCorrectCount,
        `${itemPath}.meaningCorrectCount`,
      );
    }
    if (item.soundCorrectCount !== undefined) {
      record.soundCorrectCount = assertNonNegativeInteger(
        item.soundCorrectCount,
        `${itemPath}.soundCorrectCount`,
      );
    }
    if (item.readingGradedCount !== undefined) {
      record.readingGradedCount = assertNonNegativeInteger(
        item.readingGradedCount,
        `${itemPath}.readingGradedCount`,
      );
    }

    return record;
  });
}

function validateProfileLearningState(
  value: unknown,
  expectedProfileId: string,
): ProfileLearningState {
  const path = `states.${expectedProfileId}`;
  if (!isPlainRecord(value)) {
    throw new BackupValidationError(`${path}는 객체여야 합니다.`);
  }
  if (value.schemaVersion !== PROFILE_STATE_SCHEMA_VERSION) {
    throw new BackupValidationError(
      `${path}.schemaVersion은 ${PROFILE_STATE_SCHEMA_VERSION}이어야 합니다.`,
    );
  }
  if (value.profileId !== expectedProfileId) {
    throw new BackupValidationError(
      `${path}.profileId(${String(value.profileId)})가 키(${expectedProfileId})와 일치하지 않습니다.`,
    );
  }

  return {
    schemaVersion: 1,
    profileId: expectedProfileId,
    activeSession:
      value.activeSession === null
        ? null
        : validateSessionSnapshot(value.activeSession, `${path}.activeSession`),
    exposureStats: validateExposureStats(value.exposureStats, `${path}.exposureStats`),
    reviewQueue: validateReviewQueue(value.reviewQueue, `${path}.reviewQueue`),
    dailyChallenges: validateDailyChallenges(
      value.dailyChallenges,
      `${path}.dailyChallenges`,
    ),
    completedSessions: validateCompletedSessions(
      value.completedSessions,
      `${path}.completedSessions`,
    ),
  };
}

export function parseSafeBackupJson(jsonText: string): AppBackupPayload {
  if (typeof jsonText !== 'string' || jsonText.trim() === '') {
    throw new BackupValidationError('백업 JSON 문자열이 비어 있습니다.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText, (key, val) => {
      if (key !== '' && FORBIDDEN_KEYS.has(key)) {
        throw new BackupValidationError(
          `보안상 허용되지 않는 JSON 키('${key}')가 포함되어 있습니다.`,
        );
      }
      return val;
    });
  } catch (error) {
    if (error instanceof BackupValidationError) {
      throw error;
    }
    throw new BackupValidationError('손상되었거나 유효하지 않은 JSON 파일입니다.');
  }

  return validateBackupPayload(parsed);
}

export function validateBackupPayload(input: unknown): AppBackupPayload {
  assertSafeObjectGraph(input);

  if (!isPlainRecord(input)) {
    throw new BackupValidationError('백업 최상위 구조는 JSON 객체여야 합니다.');
  }
  if (input.exportFormat !== BACKUP_EXPORT_FORMAT) {
    throw new BackupValidationError(
      `지원하지 않는 백업 형식입니다: ${String(input.exportFormat)}`,
    );
  }
  if (input.exportSchemaVersion !== BACKUP_EXPORT_SCHEMA_VERSION) {
    throw new BackupValidationError(
      `지원하지 않는 백업 스키마 버전입니다: ${String(input.exportSchemaVersion)}`,
    );
  }

  const exportedAt = assertNonEmptyString(input.exportedAt, 'exportedAt');
  const dataVersion = assertNonEmptyString(input.dataVersion, 'dataVersion');

  if (!Array.isArray(input.profiles)) {
    throw new BackupValidationError('profiles는 배열이어야 합니다.');
  }

  const profiles: UserProfile[] = [];
  const profileIds = new Set<string>();
  for (let i = 0; i < input.profiles.length; i += 1) {
    const profile = validateUserProfile(input.profiles[i], i);
    if (profileIds.has(profile.id)) {
      throw new BackupValidationError(`중복된 프로필 ID가 있습니다: ${profile.id}`);
    }
    profileIds.add(profile.id);
    profiles.push(profile);
  }

  let activeProfileId: string | null = null;
  if (input.activeProfileId !== null) {
    activeProfileId = assertNonEmptyString(input.activeProfileId, 'activeProfileId');
    if (!profileIds.has(activeProfileId)) {
      throw new BackupValidationError(
        `activeProfileId(${activeProfileId})가 profiles 목록에 존재하지 않습니다.`,
      );
    }
  }

  if (!isPlainRecord(input.states)) {
    throw new BackupValidationError('states는 객체여야 합니다.');
  }

  const stateKeys = new Set(Object.keys(input.states));
  for (const stateId of stateKeys) {
    if (!profileIds.has(stateId)) {
      throw new BackupValidationError(
        `states에 정의되지 않은 프로필 ID(${stateId})가 있습니다.`,
      );
    }
  }
  for (const profileId of profileIds) {
    if (!stateKeys.has(profileId)) {
      throw new BackupValidationError(
        `프로필(${profileId})에 대응하는 학습 상태(states.${profileId})가 누락되었습니다.`,
      );
    }
  }

  const states: Record<string, ProfileLearningState> = {};
  for (const profileId of profileIds) {
    states[profileId] = validateProfileLearningState(input.states[profileId], profileId);
  }

  return {
    exportFormat: BACKUP_EXPORT_FORMAT,
    exportSchemaVersion: BACKUP_EXPORT_SCHEMA_VERSION,
    exportedAt,
    dataVersion,
    activeProfileId,
    profiles,
    states,
  };
}
