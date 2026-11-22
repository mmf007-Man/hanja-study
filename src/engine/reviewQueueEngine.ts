import type { CatalogStore } from '../data/catalogStore';
import type { Character, QuestionType } from '../types/catalog';
import type {
  AnswerRecord,
  FrozenQuestion,
  ReadingExposureStat,
  ReviewHistoryEntry,
  ReviewItem,
} from '../types/storage';
import {
  ALL_QUESTION_TYPES,
  compareTimestampsAsc,
  generateQuestionForCharacter,
  getCharacterExposureSummary,
} from './questionGenerator';

export interface SelectNextReviewOptions {
  unitIds?: readonly string[];
  lastReviewedItemId?: string;
  rng?: () => number;
  questionId?: string;
}

export function makeReviewItemId(
  characterId: string,
  questionType: QuestionType,
  targetSound: string,
): string {
  return `${characterId}::${questionType}::${targetSound}`;
}

/**
 * Reset sessionStreak = 0 for all active ('needs_review') items at the start of a new session.
 * Completed items and all historical entries remain intact.
 */
export function resetReviewSessionStreaks(
  queue: Record<string, ReviewItem>,
): Record<string, ReviewItem> {
  const next: Record<string, ReviewItem> = {};
  for (const [id, item] of Object.entries(queue)) {
    if (item.status === 'needs_review') {
      next[id] = {
        ...item,
        sessionStreak: 0,
        targetMeanings: [...item.targetMeanings],
        history: item.history.map((h) => ({ ...h })),
      };
    } else {
      next[id] = {
        ...item,
        targetMeanings: [...item.targetMeanings],
        history: item.history.map((h) => ({ ...h })),
      };
    }
  }
  return next;
}

function cloneQueue(
  queue: Record<string, ReviewItem>,
): Record<string, ReviewItem> {
  const copy: Record<string, ReviewItem> = {};
  for (const [id, item] of Object.entries(queue)) {
    copy[id] = {
      ...item,
      targetMeanings: [...item.targetMeanings],
      history: item.history.map((h) => ({ ...h })),
    };
  }
  return copy;
}

/**
 * Apply a single graded answer to the review queue according to M2 state machine rules.
 */
export function applySessionOutcomeToReviewQueue(
  queue: Record<string, ReviewItem>,
  question: FrozenQuestion,
  character: Character,
  answer: AnswerRecord,
  sessionId: string,
  nowIso: string,
): Record<string, ReviewItem> {
  if (answer.outcome === 'abandoned') {
    return cloneQueue(queue);
  }

  const nextQueue = cloneQueue(queue);
  const resolvedMeanings =
    question.targetMeanings.length > 0
      ? [...question.targetMeanings]
      : [
          ...(character.readings.find((r) => r.sound === question.targetSound)
            ?.meanings ??
            character.readings[0]?.meanings ??
            []),
        ];

  if (question.reviewItemId !== undefined) {
    const itemId = question.reviewItemId;
    const existing = nextQueue[itemId];

    if (answer.outcome === 'correct') {
      const nextStreak = (existing?.sessionStreak ?? 0) + 1;
      const history: ReviewHistoryEntry[] = [
        ...(existing?.history ?? []),
        { at: nowIso, event: 'review_pass', sessionId },
      ];
      if (nextStreak >= 2) {
        history.push({ at: nowIso, event: 'completed', sessionId });
      }

      nextQueue[itemId] = {
        reviewItemId: itemId,
        characterId: existing?.characterId ?? question.characterId,
        questionType: existing?.questionType ?? question.questionType,
        targetSound: existing?.targetSound ?? question.targetSound,
        targetMeanings: existing?.targetMeanings ?? resolvedMeanings,
        status: nextStreak >= 2 ? 'completed' : 'needs_review',
        sessionStreak: nextStreak,
        ...(existing?.lastErrorType !== undefined
          ? { lastErrorType: existing.lastErrorType }
          : {}),
        history,
      };
      return nextQueue;
    }

    // Incorrect or dont_know on a review target resets sessionStreak to 0
    const errorType = answer.errorType ?? existing?.lastErrorType;
    const failEntry: ReviewHistoryEntry = {
      at: nowIso,
      event: 'review_fail',
      sessionId,
      ...(answer.errorType !== undefined ? { errorType: answer.errorType } : {}),
    };

    nextQueue[itemId] = {
      reviewItemId: itemId,
      characterId: existing?.characterId ?? question.characterId,
      questionType: existing?.questionType ?? question.questionType,
      targetSound: existing?.targetSound ?? question.targetSound,
      targetMeanings: existing?.targetMeanings ?? resolvedMeanings,
      status: 'needs_review',
      sessionStreak: 0,
      ...(errorType !== undefined ? { lastErrorType: errorType } : {}),
      history: [...(existing?.history ?? []), failEntry],
    };
    return nextQueue;
  }

  // Normal / daily / review-filler question:
  // Correct answers NEVER increment needs_review sessionStreak.
  if (answer.outcome === 'correct') {
    return nextQueue;
  }

  const itemId = makeReviewItemId(
    question.characterId,
    question.questionType,
    question.targetSound,
  );
  const existing = nextQueue[itemId];
  const errorType = answer.errorType ?? existing?.lastErrorType;

  if (!existing) {
    nextQueue[itemId] = {
      reviewItemId: itemId,
      characterId: question.characterId,
      questionType: question.questionType,
      targetSound: question.targetSound,
      targetMeanings: resolvedMeanings,
      status: 'needs_review',
      sessionStreak: 0,
      ...(errorType !== undefined ? { lastErrorType: errorType } : {}),
      history: [
        {
          at: nowIso,
          event: 'registered',
          sessionId,
          ...(answer.errorType !== undefined
            ? { errorType: answer.errorType }
            : {}),
        },
      ],
    };
    return nextQueue;
  }

  if (existing.status === 'completed') {
    nextQueue[itemId] = {
      ...existing,
      status: 'needs_review',
      sessionStreak: 0,
      ...(errorType !== undefined ? { lastErrorType: errorType } : {}),
      history: [
        ...existing.history,
        {
          at: nowIso,
          event: 'reopened',
          sessionId,
          ...(answer.errorType !== undefined
            ? { errorType: answer.errorType }
            : {}),
        },
      ],
    };
    return nextQueue;
  }

  // Already needs_review in queue
  nextQueue[itemId] = {
    ...existing,
    status: 'needs_review',
    sessionStreak: 0,
    ...(errorType !== undefined ? { lastErrorType: errorType } : {}),
    history: [
      ...existing.history,
      {
        at: nowIso,
        event: 'review_fail',
        sessionId,
        ...(answer.errorType !== undefined
          ? { errorType: answer.errorType }
          : {}),
      },
    ],
  };
  return nextQueue;
}

function getLatestEntryTimestamp(item: ReviewItem): string | null {
  let latest: string | null = null;
  for (const entry of item.history) {
    if (entry.event === 'registered' || entry.event === 'reopened') {
      if (latest === null || compareTimestampsAsc(latest, entry.at) < 0) {
        latest = entry.at;
      }
    }
  }
  if (latest !== null) {
    return latest;
  }
  return item.history[0]?.at ?? null;
}

function buildReviewTargetQuestion(
  catalog: CatalogStore,
  item: ReviewItem,
  options: SelectNextReviewOptions,
): FrozenQuestion | null {
  const character = catalog.getCharacterById(item.characterId);
  if (!character) {
    return null;
  }

  const rng = options.rng ?? Math.random;
  const questionId =
    options.questionId ?? `rev-${item.characterId}-${item.questionType}`;

  const built = generateQuestionForCharacter(
    catalog,
    character,
    item.questionType,
    {
      unitIds: options.unitIds,
      rng,
      questionId,
      targetSound: item.targetSound,
      correctMeaning:
        item.targetMeanings.length === 1 ? item.targetMeanings[0] : undefined,
      reviewItemId: item.reviewItemId,
    },
  );

  if (!built) {
    return null;
  }

  return {
    ...built,
    targetSound: item.targetSound,
    targetMeanings: [...item.targetMeanings],
    reviewItemId: item.reviewItemId,
  };
}

function buildFillerQuestion(
  catalog: CatalogStore,
  excludedCharId: string,
  preferredType: QuestionType,
  exposureStats: Record<string, ReadingExposureStat>,
  options: SelectNextReviewOptions,
): FrozenQuestion | null {
  const rng = options.rng ?? Math.random;
  const questionId = options.questionId ?? `rev-filler-${excludedCharId}`;

  const unitChars =
    options.unitIds !== undefined && options.unitIds.length > 0
      ? catalog
          .getReadingCandidates(options.unitIds)
          .filter((c) => c.id !== excludedCharId)
      : [];
  const unitCharIds = new Set(unitChars.map((c) => c.id));
  const fallbackChars = catalog
    .getReadingCandidates()
    .filter((c) => c.id !== excludedCharId && !unitCharIds.has(c.id));

  const tryPools = [unitChars, fallbackChars];
  const typesToTry: QuestionType[] = [
    preferredType,
    ...ALL_QUESTION_TYPES.filter((t) => t !== preferredType),
  ];

  for (const pool of tryPools) {
    if (pool.length === 0) {
      continue;
    }

    const ranked = pool.map((ch) => {
      const summary = getCharacterExposureSummary(ch, exposureStats);
      return {
        ch,
        exposureCount: summary.exposureCount,
        lastExposedAt: summary.lastExposedAt,
        tieBreaker: rng(),
      };
    });

    ranked.sort((a, b) => {
      if (a.exposureCount !== b.exposureCount) {
        return a.exposureCount - b.exposureCount;
      }
      const tsDiff = compareTimestampsAsc(a.lastExposedAt, b.lastExposedAt);
      if (tsDiff !== 0) {
        return tsDiff;
      }
      return a.tieBreaker - b.tieBreaker;
    });

    for (const candidate of ranked) {
      for (const qType of typesToTry) {
        const built = generateQuestionForCharacter(
          catalog,
          candidate.ch,
          qType,
          {
            unitIds: options.unitIds,
            exposureStats,
            rng,
            questionId,
            isReviewFiller: true,
          },
        );
        if (built) {
          return built;
        }
      }
    }
  }

  return null;
}

/**
 * Select the next review question (or a 1-question filler when only 1 item remains
 * and it matches lastReviewedItemId). Returns null when all review items are completed.
 */
export function selectNextReviewQuestion(
  catalog: CatalogStore,
  queue: Record<string, ReviewItem>,
  exposureStats: Record<string, ReadingExposureStat>,
  options: SelectNextReviewOptions = {},
): FrozenQuestion | null {
  const needsReview = Object.values(queue).filter(
    (item) => item.status === 'needs_review',
  );
  if (needsReview.length === 0) {
    return null;
  }

  needsReview.sort((a, b) => {
    const tsDiff = compareTimestampsAsc(
      getLatestEntryTimestamp(a),
      getLatestEntryTimestamp(b),
    );
    if (tsDiff !== 0) {
      return tsDiff;
    }
    if (a.sessionStreak !== b.sessionStreak) {
      return a.sessionStreak - b.sessionStreak;
    }
    return a.reviewItemId.localeCompare(b.reviewItemId);
  });

  const nonImmediate = needsReview.find(
    (item) => item.reviewItemId !== options.lastReviewedItemId,
  );

  if (nonImmediate) {
    return buildReviewTargetQuestion(catalog, nonImmediate, options);
  }

  // Only 1 needs_review item remains and it matches lastReviewedItemId
  const onlyItem = needsReview[0]!;
  const filler = buildFillerQuestion(
    catalog,
    onlyItem.characterId,
    onlyItem.questionType,
    exposureStats,
    options,
  );
  if (filler) {
    return filler;
  }

  // Extreme edge case: catalog has only 1 character total
  return buildReviewTargetQuestion(catalog, onlyItem, options);
}
