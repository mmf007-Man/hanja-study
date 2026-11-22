import type { CatalogStore } from '../data/catalogStore';
import type { StorageAdapter } from '../storage/storageAdapter';
import type { QuestionType } from '../types/catalog';
import type {
  AnswerRecord,
  CompletedSessionRecord,
  DailyChallengeRecord,
  FrozenQuestion,
  ReviewItem,
  SessionSnapshot,
} from '../types/storage';
import {
  calculateSessionMetrics,
  canSubmitAnswer,
  createAbandonedAnswer,
  gradeDontKnow,
  gradeSubmission,
  type AnswerDraft,
  type GradingResult,
} from './gradingEngine';
import { getLocalDateKey } from './prng';
import {
  ALL_QUESTION_TYPES,
  generateDailyQuestions,
  generateNormalQuestions,
  makeReadingKey,
} from './questionGenerator';
import {
  applySessionOutcomeToReviewQueue,
  makeReviewItemId,
  resetReviewSessionStreaks,
  selectNextReviewQuestion,
} from './reviewQueueEngine';

export class SessionEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionEngineError';
  }
}

export class ActiveSessionConflictError extends SessionEngineError {
  readonly activeSession: SessionSnapshot;

  constructor(
    activeSession: SessionSnapshot,
    message = '이미 진행 중인 학습 회차가 있습니다.',
  ) {
    super(message);
    this.name = 'ActiveSessionConflictError';
    this.activeSession = activeSession;
  }
}

export interface StartNormalSessionOptions {
  unitIds?: string[];
  selectedTypes: QuestionType[];
  questionCount?: number;
  forceReplace?: boolean;
  nowIso?: string;
  rng?: () => number;
}

export interface StartDailySessionOptions {
  dateKey?: string;
  unitIds?: string[];
  selectedTypes?: QuestionType[];
  questionCount?: number;
  forceReplace?: boolean;
  nowIso?: string;
}

export interface StartReviewSessionOptions {
  unitIds?: string[];
  forceReplace?: boolean;
  nowIso?: string;
  rng?: () => number;
}

export interface SubmitQuestionResult {
  session: SessionSnapshot;
  grading: GradingResult;
  reviewQueue: Record<string, ReviewItem>;
  isSessionComplete: boolean;
}

function createIdSuffix(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractDailyDateKey(sessionId: string, startedAt: string): string {
  const match = /^daily_(\d{4}-\d{2}-\d{2})_/.exec(sessionId);
  if (match?.[1]) {
    return match[1];
  }
  const parsed = new Date(startedAt);
  return Number.isNaN(parsed.getTime())
    ? getLocalDateKey()
    : getLocalDateKey(parsed);
}

export class SessionEngine {
  constructor(
    private readonly catalog: CatalogStore,
    private readonly storage: StorageAdapter,
  ) {}

  async getActiveSession(profileId: string): Promise<SessionSnapshot | null> {
    return this.storage.getActiveSession(profileId);
  }

  /**
   * Abandon an active session mid-way: exposed-but-unanswered questions become 'abandoned',
   * unexposed questions are omitted, and activeSession is cleared without recording a DailyChallenge completion.
   */
  async abandonActiveSession(
    profileId: string,
    nowIso: string = new Date().toISOString(),
  ): Promise<CompletedSessionRecord | null> {
    const session = await this.storage.getActiveSession(profileId);
    if (!session) {
      return null;
    }
    return this.finalizeSession(profileId, session, nowIso, false);
  }

  async startNormalSession(
    profileId: string,
    options: StartNormalSessionOptions,
  ): Promise<SessionSnapshot> {
    const timestamp = options.nowIso ?? new Date().toISOString();
    await this.ensureNoConflict(profileId, options.forceReplace, timestamp);

    const exposureStats = await this.storage.getExposureStats(profileId);
    const questions = generateNormalQuestions(this.catalog, {
      unitIds: options.unitIds,
      selectedTypes: options.selectedTypes,
      exposureStats,
      questionCount: options.questionCount,
      rng: options.rng,
    });

    await this.resetStreaksForNewSession(profileId);

    const resolvedUnitIds =
      options.unitIds !== undefined
        ? [...options.unitIds]
        : this.catalog.units.map((u) => u.id);

    const snapshot: SessionSnapshot = {
      sessionId: `normal_${createIdSuffix()}`,
      mode: 'normal',
      dataVersion: this.catalog.dataVersion,
      unitIds: resolvedUnitIds,
      selectedTypes: [...options.selectedTypes],
      questions,
      currentIndex: 0,
      exposedQuestionIds: [],
      answers: [],
      startedAt: timestamp,
      updatedAt: timestamp,
    };

    await this.storage.saveActiveSession(profileId, snapshot);
    return snapshot;
  }

  async startDailySession(
    profileId: string,
    options: StartDailySessionOptions = {},
  ): Promise<SessionSnapshot> {
    const timestamp = options.nowIso ?? new Date().toISOString();
    await this.ensureNoConflict(profileId, options.forceReplace, timestamp);

    const dateKey =
      options.dateKey ?? getLocalDateKey(new Date(timestamp));
    const unitIds =
      options.unitIds !== undefined
        ? [...options.unitIds]
        : this.catalog.units.map((u) => u.id);
    const selectedTypes =
      options.selectedTypes !== undefined
        ? [...options.selectedTypes]
        : [...ALL_QUESTION_TYPES];

    const questions = generateDailyQuestions(this.catalog, dateKey, {
      unitIds,
      selectedTypes,
      questionCount: options.questionCount,
    });

    await this.resetStreaksForNewSession(profileId);

    const snapshot: SessionSnapshot = {
      sessionId: `daily_${dateKey}_${createIdSuffix()}`,
      mode: 'daily',
      dataVersion: this.catalog.dataVersion,
      unitIds,
      selectedTypes,
      questions,
      currentIndex: 0,
      exposedQuestionIds: [],
      answers: [],
      startedAt: timestamp,
      updatedAt: timestamp,
    };

    await this.storage.saveActiveSession(profileId, snapshot);
    return snapshot;
  }

  async startReviewSession(
    profileId: string,
    options: StartReviewSessionOptions = {},
  ): Promise<SessionSnapshot> {
    const timestamp = options.nowIso ?? new Date().toISOString();
    await this.ensureNoConflict(profileId, options.forceReplace, timestamp);

    const resetQueue = await this.resetStreaksForNewSession(profileId);
    const exposureStats = await this.storage.getExposureStats(profileId);
    const unitIds =
      options.unitIds !== undefined
        ? [...options.unitIds]
        : this.catalog.units.map((u) => u.id);

    const firstQuestion = selectNextReviewQuestion(
      this.catalog,
      resetQueue,
      exposureStats,
      {
        unitIds,
        lastReviewedItemId: undefined,
        rng: options.rng,
        questionId: 'rev-1',
      },
    );

    if (!firstQuestion) {
      throw new SessionEngineError('복습할 오답 항목이 없습니다.');
    }

    const activeTypes = Array.from(
      new Set(
        Object.values(resetQueue)
          .filter((item) => item.status === 'needs_review')
          .map((item) => item.questionType),
      ),
    );

    const snapshot: SessionSnapshot = {
      sessionId: `review_${createIdSuffix()}`,
      mode: 'review',
      dataVersion: this.catalog.dataVersion,
      unitIds,
      selectedTypes:
        activeTypes.length > 0 ? activeTypes : [firstQuestion.questionType],
      questions: [firstQuestion],
      currentIndex: 0,
      exposedQuestionIds: [],
      answers: [],
      startedAt: timestamp,
      updatedAt: timestamp,
    };

    await this.storage.saveActiveSession(profileId, snapshot);
    return snapshot;
  }

  /**
   * Mark a question as shown on screen for the first time, incrementing reading exposure once.
   */
  async markQuestionExposed(
    profileId: string,
    questionId: string,
    nowIso: string = new Date().toISOString(),
  ): Promise<SessionSnapshot> {
    const session = await this.requireActiveSession(profileId);
    const questionIndex = session.questions.findIndex(
      (q) => q.questionId === questionId,
    );
    if (questionIndex === -1) {
      throw new SessionEngineError(
        `진행 중인 회차에서 문항(${questionId})을 찾을 수 없습니다.`,
      );
    }

    if (session.exposedQuestionIds.includes(questionId)) {
      return session;
    }

    const question = session.questions[questionIndex]!;
    const readingKey = makeReadingKey(
      question.characterId,
      question.targetSound,
    );
    await this.storage.recordReadingExposure(profileId, readingKey, nowIso);

    const updated: SessionSnapshot = {
      ...session,
      currentIndex: Math.max(session.currentIndex, questionIndex),
      exposedQuestionIds: [...session.exposedQuestionIds, questionId],
      updatedAt: nowIso,
    };

    await this.storage.saveActiveSession(profileId, updated);
    return updated;
  }

  async submitAnswer(
    profileId: string,
    questionId: string,
    draft: AnswerDraft,
    nowIso: string = new Date().toISOString(),
  ): Promise<SubmitQuestionResult> {
    return this.processSubmission(profileId, questionId, 'normal', draft, nowIso);
  }

  async submitDontKnow(
    profileId: string,
    questionId: string,
    nowIso: string = new Date().toISOString(),
  ): Promise<SubmitQuestionResult> {
    return this.processSubmission(profileId, questionId, 'dont_know', {}, nowIso);
  }

  async finishSession(
    profileId: string,
    nowIso: string = new Date().toISOString(),
  ): Promise<CompletedSessionRecord> {
    const session = await this.requireActiveSession(profileId);
    return this.finalizeSession(profileId, session, nowIso, true);
  }

  private async processSubmission(
    profileId: string,
    questionId: string,
    submissionKind: 'normal' | 'dont_know',
    draft: AnswerDraft,
    nowIso: string,
  ): Promise<SubmitQuestionResult> {
    const session = await this.requireActiveSession(profileId);
    const question = session.questions.find((q) => q.questionId === questionId);
    if (!question) {
      throw new SessionEngineError(
        `진행 중인 회차에서 문항(${questionId})을 찾을 수 없습니다.`,
      );
    }

    if (session.answers.some((a) => a.questionId === questionId)) {
      throw new SessionEngineError(
        `문항(${questionId})은 이미 제출되어 재시도할 수 없습니다.`,
      );
    }

    const character = this.catalog.getCharacterById(question.characterId);
    if (!character) {
      throw new SessionEngineError(
        `한자 데이터(${question.characterId})를 찾을 수 없습니다.`,
      );
    }

    let grading: GradingResult;
    if (submissionKind === 'dont_know') {
      grading = gradeDontKnow(question, nowIso);
    } else {
      if (!canSubmitAnswer(question, draft)) {
        throw new SessionEngineError(
          '답안을 모두 입력하거나 선택한 뒤 제출해 주세요.',
        );
      }
      grading = gradeSubmission(question, character, draft, nowIso);
    }

    const currentQueue = await this.storage.getReviewQueue(profileId);
    const nextQueue = applySessionOutcomeToReviewQueue(
      currentQueue,
      question,
      character,
      grading.record,
      session.sessionId,
      nowIso,
    );

    const changedItems = this.collectChangedReviewItems(currentQueue, nextQueue);
    if (changedItems.length > 0) {
      await this.storage.upsertReviewItems(profileId, changedItems);
    }

    const nextAnswers = [...session.answers, grading.record];
    let nextQuestions: FrozenQuestion[] = [...session.questions];
    let nextIndex = session.currentIndex;
    let nextLastReviewedItemId = session.lastReviewedItemId;
    let isSessionComplete: boolean;

    if (session.mode === 'review') {
      if (question.reviewItemId !== undefined) {
        nextLastReviewedItemId = question.reviewItemId;
      } else {
        // Filler question answered: allow scheduling any waiting review item next,
        // unless the filler itself failed and entered the queue (avoid immediate self-repeat).
        nextLastReviewedItemId =
          grading.record.outcome !== 'correct'
            ? makeReviewItemId(
                question.characterId,
                question.questionType,
                question.targetSound,
              )
            : undefined;
      }

      const exposureStats = await this.storage.getExposureStats(profileId);
      const nextReviewQuestion = selectNextReviewQuestion(
        this.catalog,
        nextQueue,
        exposureStats,
        {
          unitIds: session.unitIds,
          lastReviewedItemId: nextLastReviewedItemId,
          questionId: `rev-${nextQuestions.length + 1}`,
        },
      );

      if (nextReviewQuestion) {
        nextQuestions = [...nextQuestions, nextReviewQuestion];
        nextIndex = nextQuestions.length - 1;
        isSessionComplete = false;
      } else {
        nextIndex = Math.max(0, nextQuestions.length - 1);
        isSessionComplete = true;
      }
    } else {
      const answeredIds = new Set(nextAnswers.map((a) => a.questionId));
      const firstUnansweredIdx = nextQuestions.findIndex(
        (q) => !answeredIds.has(q.questionId),
      );
      if (firstUnansweredIdx === -1) {
        nextIndex = Math.max(0, nextQuestions.length - 1);
        isSessionComplete = true;
      } else {
        nextIndex = firstUnansweredIdx;
        isSessionComplete = false;
      }
    }

    const updatedSession: SessionSnapshot = {
      ...session,
      questions: nextQuestions,
      currentIndex: nextIndex,
      answers: nextAnswers,
      updatedAt: nowIso,
      ...(nextLastReviewedItemId !== undefined
        ? { lastReviewedItemId: nextLastReviewedItemId }
        : {}),
    };

    if (nextLastReviewedItemId === undefined) {
      delete updatedSession.lastReviewedItemId;
    }

    await this.storage.saveActiveSession(profileId, updatedSession);

    return {
      session: updatedSession,
      grading,
      reviewQueue: nextQueue,
      isSessionComplete,
    };
  }

  private async finalizeSession(
    profileId: string,
    session: SessionSnapshot,
    nowIso: string,
    allowDailySave: boolean,
  ): Promise<CompletedSessionRecord> {
    const answerByQuestionId = new Map<string, AnswerRecord>();
    for (const answer of session.answers) {
      answerByQuestionId.set(answer.questionId, answer);
    }
    const exposedSet = new Set(session.exposedQuestionIds);

    const finalAnswers: AnswerRecord[] = [];
    for (const question of session.questions) {
      const existingAnswer = answerByQuestionId.get(question.questionId);
      if (existingAnswer) {
        finalAnswers.push(existingAnswer);
      } else if (exposedSet.has(question.questionId)) {
        finalAnswers.push(createAbandonedAnswer(question, nowIso));
      }
      // Unexposed questions are omitted from answers.
    }

    const metrics = calculateSessionMetrics(finalAnswers);
    const completed: CompletedSessionRecord = {
      sessionId: session.sessionId,
      mode: session.mode,
      dataVersion: session.dataVersion,
      unitIds: [...session.unitIds],
      selectedTypes: [...session.selectedTypes],
      score: metrics.totalScore,
      maxScore: metrics.maxScore,
      answeredCount: metrics.confirmedCount,
      correctCount: metrics.correctCount,
      dontKnowCount: metrics.dontKnowCount,
      abandonedCount: metrics.abandonedCount,
      meaningCorrectCount: metrics.meaningCorrectCount,
      soundCorrectCount: metrics.soundCorrectCount,
      readingGradedCount: metrics.readingGradedCount,
      answers: finalAnswers,
      startedAt: session.startedAt,
      completedAt: nowIso,
    };

    await this.storage.appendCompletedSession(profileId, completed);
    await this.storage.clearActiveSession(profileId);

    if (
      allowDailySave &&
      session.mode === 'daily' &&
      metrics.abandonedCount === 0 &&
      metrics.confirmedCount === session.questions.length
    ) {
      const dateKey = extractDailyDateKey(session.sessionId, session.startedAt);
      const existingDaily = await this.storage.getDailyChallenge(
        profileId,
        dateKey,
      );
      if (!existingDaily) {
        const startMs = Date.parse(session.startedAt);
        const endMs = Date.parse(nowIso);
        const durationMs =
          Number.isFinite(startMs) && Number.isFinite(endMs)
            ? Math.max(0, endMs - startMs)
            : 0;

        const dailyRecord: DailyChallengeRecord = {
          dateKey,
          sessionId: session.sessionId,
          dataVersion: session.dataVersion,
          score: metrics.totalScore,
          maxScore: metrics.maxScore,
          correctCount: metrics.correctCount,
          totalCount: session.questions.length,
          durationMs,
          completedAt: nowIso,
        };
        await this.storage.saveDailyChallenge(profileId, dailyRecord);
      }
    }

    return completed;
  }

  private async ensureNoConflict(
    profileId: string,
    forceReplace: boolean | undefined,
    nowIso: string,
  ): Promise<void> {
    const existing = await this.storage.getActiveSession(profileId);
    if (!existing) {
      return;
    }
    if (!forceReplace) {
      throw new ActiveSessionConflictError(existing);
    }
    await this.abandonActiveSession(profileId, nowIso);
  }

  private async requireActiveSession(
    profileId: string,
  ): Promise<SessionSnapshot> {
    const session = await this.storage.getActiveSession(profileId);
    if (!session) {
      throw new SessionEngineError('진행 중인 학습 회차가 없습니다.');
    }
    return session;
  }

  private async resetStreaksForNewSession(
    profileId: string,
  ): Promise<Record<string, ReviewItem>> {
    const queue = await this.storage.getReviewQueue(profileId);
    const resetQueue = resetReviewSessionStreaks(queue);
    const changed = this.collectChangedReviewItems(queue, resetQueue);
    if (changed.length > 0) {
      await this.storage.upsertReviewItems(profileId, changed);
    }
    return resetQueue;
  }

  private collectChangedReviewItems(
    prev: Record<string, ReviewItem>,
    next: Record<string, ReviewItem>,
  ): ReviewItem[] {
    const changed: ReviewItem[] = [];
    for (const [id, nextItem] of Object.entries(next)) {
      const prevItem = prev[id];
      if (
        !prevItem ||
        prevItem.status !== nextItem.status ||
        prevItem.sessionStreak !== nextItem.sessionStreak ||
        prevItem.lastErrorType !== nextItem.lastErrorType ||
        prevItem.history.length !== nextItem.history.length
      ) {
        changed.push(nextItem);
      }
    }
    return changed;
  }
}
