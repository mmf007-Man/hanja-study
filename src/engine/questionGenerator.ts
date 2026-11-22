import { CatalogLoadError, type CatalogStore } from '../data/catalogStore';
import type { Character, CharacterReading, QuestionType } from '../types/catalog';
import type { FrozenQuestion, ReadingExposureStat } from '../types/storage';
import { normalizeAnswer } from './gradingEngine';
import { createSeededRng, shuffleWithRng } from './prng';

export const DEFAULT_QUESTION_COUNT = 20;

export const ALL_QUESTION_TYPES: readonly QuestionType[] = [
  'hanja_to_choice',
  'hanja_to_input',
  'reading_to_choice',
  'reading_to_write',
];

export class QuestionGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuestionGenerationError';
  }
}

export interface GenerationConfigInput {
  unitIds?: readonly string[];
  selectedTypes: readonly QuestionType[];
}

export interface GenerationValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  effectiveTypes: QuestionType[];
  candidatesByType: Record<QuestionType, Character[]>;
}

export interface BuildQuestionOptions {
  unitIds?: readonly string[];
  exposureStats?: Record<string, ReadingExposureStat>;
  rng?: () => number;
  questionId?: string;
  targetSound?: string;
  correctMeaning?: string;
  reviewItemId?: string;
  isReviewFiller?: boolean;
}

export interface GenerateNormalQuestionsOptions {
  unitIds?: readonly string[];
  selectedTypes: readonly QuestionType[];
  exposureStats: Record<string, ReadingExposureStat>;
  questionCount?: number;
  rng?: () => number;
  questionIdPrefix?: string;
}

export interface GenerateDailyQuestionsOptions {
  unitIds?: readonly string[];
  selectedTypes?: readonly QuestionType[];
  questionCount?: number;
}

export function makeReadingKey(characterId: string, sound: string): string {
  return `${characterId}::${sound}`;
}

export function compareTimestampsAsc(a: string | null, b: string | null): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return -1;
  }
  if (b === null) {
    return 1;
  }
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) {
    return aMs - bMs;
  }
  return a.localeCompare(b);
}

/**
 * Compute character-level exposure total and earliest/latest timestamp across all readings.
 */
export function getCharacterExposureSummary(
  character: Character,
  exposureStats: Record<string, ReadingExposureStat>,
): { exposureCount: number; lastExposedAt: string | null } {
  let exposureCount = 0;
  let lastExposedAt: string | null = null;

  for (const reading of character.readings) {
    const stat = exposureStats[makeReadingKey(character.id, reading.sound)];
    if (!stat) {
      continue;
    }
    exposureCount += stat.exposureCount;
    if (stat.lastExposedAt !== null) {
      if (
        lastExposedAt === null ||
        compareTimestampsAsc(lastExposedAt, stat.lastExposedAt) < 0
      ) {
        lastExposedAt = stat.lastExposedAt;
      }
    }
  }

  return { exposureCount, lastExposedAt };
}

/**
 * Select the least-exposed reading pair for a character:
 * exposureCount asc -> lastExposedAt asc (null first) -> random tie-break via rng.
 */
export function selectReadingPair(
  character: Character,
  exposureStats: Record<string, ReadingExposureStat>,
  rng: () => number = Math.random,
): CharacterReading {
  if (character.readings.length === 0) {
    throw new QuestionGenerationError(
      `한자(${character.character})에 등록된 독음 쌍이 없습니다.`,
    );
  }
  if (character.readings.length === 1) {
    return character.readings[0]!;
  }

  const ranked = character.readings.map((reading) => {
    const stat = exposureStats[makeReadingKey(character.id, reading.sound)];
    return {
      reading,
      exposureCount: stat?.exposureCount ?? 0,
      lastExposedAt: stat?.lastExposedAt ?? null,
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

  return ranked[0]!.reading;
}

/**
 * Check whether two characters share any (sound/allowedSounds && meaning) overlap.
 */
export function hasReadingOverlap(a: Character, b: Character): boolean {
  for (const ra of a.readings) {
    const soundsA = new Set([
      normalizeAnswer(ra.sound),
      ...(ra.allowedSounds ?? []).map(normalizeAnswer),
    ]);
    const meaningsA = new Set(ra.meanings.map(normalizeAnswer));

    for (const rb of b.readings) {
      const soundsB = [
        normalizeAnswer(rb.sound),
        ...(rb.allowedSounds ?? []).map(normalizeAnswer),
      ];
      const meaningsB = rb.meanings.map(normalizeAnswer);

      if (
        soundsB.some((s) => soundsA.has(s)) &&
        meaningsB.some((m) => meaningsA.has(m))
      ) {
        return true;
      }
    }
  }
  return false;
}

function splitUnitAndFallbackPools(
  catalog: CatalogStore,
  unitIds?: readonly string[],
): { primary: Character[]; fallback: Character[] } {
  const allVerified = catalog.getReadingCandidates();
  if (unitIds === undefined) {
    return { primary: allVerified, fallback: [] };
  }
  const primary = catalog.getReadingCandidates(unitIds);
  const primaryIds = new Set(primary.map((c) => c.id));
  const fallback = allVerified.filter((c) => !primaryIds.has(c.id));
  return { primary, fallback };
}

function collectDistinctStrings(
  characters: readonly Character[],
  excludedNorms: Set<string>,
  extractor: (character: Character) => string[],
  needed: number,
  rng: () => number,
): string[] {
  const seenNorm = new Set<string>(excludedNorms);
  const candidates: string[] = [];

  for (const ch of characters) {
    for (const raw of extractor(ch)) {
      const norm = normalizeAnswer(raw);
      if (norm === '' || seenNorm.has(norm)) {
        continue;
      }
      seenNorm.add(norm);
      candidates.push(raw);
    }
  }

  return shuffleWithRng(candidates, rng).slice(0, needed);
}

function buildHanjaToChoiceQuestion(
  catalog: CatalogStore,
  character: Character,
  options: BuildQuestionOptions = {},
): FrozenQuestion | null {
  const rng = options.rng ?? Math.random;
  const exposureStats = options.exposureStats ?? {};

  const targetReading =
    options.targetSound !== undefined
      ? (character.readings.find((r) => r.sound === options.targetSound) ??
        selectReadingPair(character, exposureStats, rng))
      : selectReadingPair(character, exposureStats, rng);

  if (targetReading.meanings.length === 0) {
    return null;
  }

  const correctMeaning =
    options.correctMeaning !== undefined &&
    targetReading.meanings.includes(options.correctMeaning)
      ? options.correctMeaning
      : targetReading.meanings[
          Math.floor(rng() * targetReading.meanings.length)
        ]!;

  // Exclude ALL valid meanings, sounds, and allowedSounds of the target character
  const excludedMeaningNorms = new Set<string>();
  const excludedSoundNorms = new Set<string>();

  for (const r of character.readings) {
    for (const m of r.meanings) {
      excludedMeaningNorms.add(normalizeAnswer(m));
    }
    excludedSoundNorms.add(normalizeAnswer(r.sound));
    for (const allowed of r.allowedSounds ?? []) {
      excludedSoundNorms.add(normalizeAnswer(allowed));
    }
  }

  const { primary, fallback } = splitUnitAndFallbackPools(
    catalog,
    options.unitIds,
  );

  const primaryMeanings = collectDistinctStrings(
    primary,
    excludedMeaningNorms,
    (ch) => ch.readings.flatMap((r) => r.meanings),
    3,
    rng,
  );
  for (const m of primaryMeanings) {
    excludedMeaningNorms.add(normalizeAnswer(m));
  }

  const fallbackMeanings =
    primaryMeanings.length < 3
      ? collectDistinctStrings(
          fallback,
          excludedMeaningNorms,
          (ch) => ch.readings.flatMap((r) => r.meanings),
          3 - primaryMeanings.length,
          rng,
        )
      : [];

  const meaningDistractors = [...primaryMeanings, ...fallbackMeanings];
  if (meaningDistractors.length < 3) {
    return null;
  }

  const primarySounds = collectDistinctStrings(
    primary,
    excludedSoundNorms,
    (ch) => ch.readings.map((r) => r.sound),
    3,
    rng,
  );
  for (const s of primarySounds) {
    excludedSoundNorms.add(normalizeAnswer(s));
  }

  const fallbackSounds =
    primarySounds.length < 3
      ? collectDistinctStrings(
          fallback,
          excludedSoundNorms,
          (ch) => ch.readings.map((r) => r.sound),
          3 - primarySounds.length,
          rng,
        )
      : [];

  const soundDistractors = [...primarySounds, ...fallbackSounds];
  if (soundDistractors.length < 3) {
    return null;
  }

  const meaningChoices = shuffleWithRng(
    [correctMeaning, ...meaningDistractors],
    rng,
  );
  const soundChoices = shuffleWithRng(
    [targetReading.sound, ...soundDistractors],
    rng,
  );

  return {
    questionId: options.questionId ?? `q-${character.id}-hanja_to_choice`,
    characterId: character.id,
    questionType: 'hanja_to_choice',
    targetSound: targetReading.sound,
    targetMeanings: [...targetReading.meanings],
    correctMeaning,
    meaningChoices,
    soundChoices,
    ...(options.reviewItemId !== undefined
      ? { reviewItemId: options.reviewItemId }
      : {}),
    ...(options.isReviewFiller !== undefined
      ? { isReviewFiller: options.isReviewFiller }
      : {}),
  };
}

function buildReadingToChoiceQuestion(
  catalog: CatalogStore,
  character: Character,
  options: BuildQuestionOptions = {},
): FrozenQuestion | null {
  const rng = options.rng ?? Math.random;
  const primaryReading = character.readings[0];
  if (!primaryReading) {
    return null;
  }

  const { primary, fallback } = splitUnitAndFallbackPools(
    catalog,
    options.unitIds,
  );

  const isEligibleDistractor = (candidate: Character): boolean =>
    candidate.id !== character.id && !hasReadingOverlap(character, candidate);

  const primaryPool = shuffleWithRng(
    primary.filter(isEligibleDistractor),
    rng,
  );
  const picked = primaryPool.slice(0, 3);

  if (picked.length < 3) {
    const pickedIds = new Set(picked.map((c) => c.id));
    const fallbackPool = shuffleWithRng(
      fallback.filter((c) => !pickedIds.has(c.id) && isEligibleDistractor(c)),
      rng,
    );
    picked.push(...fallbackPool.slice(0, 3 - picked.length));
  }

  if (picked.length < 3) {
    return null;
  }

  const characterChoices = shuffleWithRng(
    [character.id, ...picked.map((c) => c.id)],
    rng,
  );

  return {
    questionId: options.questionId ?? `q-${character.id}-reading_to_choice`,
    characterId: character.id,
    questionType: 'reading_to_choice',
    targetSound: options.targetSound ?? primaryReading.sound,
    targetMeanings: [...primaryReading.meanings],
    characterChoices,
    ...(options.reviewItemId !== undefined
      ? { reviewItemId: options.reviewItemId }
      : {}),
    ...(options.isReviewFiller !== undefined
      ? { isReviewFiller: options.isReviewFiller }
      : {}),
  };
}

/**
 * Build a 4-choice MCQ question for either hanja_to_choice or reading_to_choice.
 * Returns null when fewer than 3 valid distractors exist across the entire textbook.
 */
export function buildMcqQuestion(
  catalog: CatalogStore,
  character: Character,
  questionType: 'hanja_to_choice' | 'reading_to_choice',
  options: BuildQuestionOptions = {},
): FrozenQuestion | null {
  if (character.readingStatus !== 'verified' || character.readings.length === 0) {
    return null;
  }
  if (questionType === 'hanja_to_choice') {
    return buildHanjaToChoiceQuestion(catalog, character, options);
  }
  return buildReadingToChoiceQuestion(catalog, character, options);
}

/**
 * Generate a frozen question for a single character and question type.
 * Returns null if the character is ineligible (e.g. unverified stroke for writing, or < 3 MCQ distractors).
 */
export function generateQuestionForCharacter(
  catalog: CatalogStore,
  character: Character,
  questionType: QuestionType,
  options: BuildQuestionOptions = {},
): FrozenQuestion | null {
  if (character.readingStatus !== 'verified' || character.readings.length === 0) {
    return null;
  }

  if (questionType === 'hanja_to_choice' || questionType === 'reading_to_choice') {
    return buildMcqQuestion(catalog, character, questionType, options);
  }

  if (questionType === 'reading_to_write' && character.strokeStatus !== 'verified') {
    return null;
  }

  const primaryReading = character.readings[0]!;
  return {
    questionId: options.questionId ?? `q-${character.id}-${questionType}`,
    characterId: character.id,
    questionType,
    targetSound: options.targetSound ?? primaryReading.sound,
    targetMeanings: [...primaryReading.meanings],
    ...(options.reviewItemId !== undefined
      ? { reviewItemId: options.reviewItemId }
      : {}),
    ...(options.isReviewFiller !== undefined
      ? { isReviewFiller: options.isReviewFiller }
      : {}),
  };
}

function canBuildHanjaToChoice(
  allVerified: readonly Character[],
  character: Character,
): boolean {
  if (character.readings.length === 0) {
    return false;
  }

  const excludedMeanings = new Set<string>();
  const excludedSounds = new Set<string>();
  for (const r of character.readings) {
    for (const m of r.meanings) {
      excludedMeanings.add(normalizeAnswer(m));
    }
    excludedSounds.add(normalizeAnswer(r.sound));
    for (const allowed of r.allowedSounds ?? []) {
      excludedSounds.add(normalizeAnswer(allowed));
    }
  }

  const meaningPool = new Set<string>();
  const soundPool = new Set<string>();

  for (const candidate of allVerified) {
    for (const r of candidate.readings) {
      const sNorm = normalizeAnswer(r.sound);
      if (sNorm !== '' && !excludedSounds.has(sNorm)) {
        soundPool.add(sNorm);
      }
      for (const m of r.meanings) {
        const mNorm = normalizeAnswer(m);
        if (mNorm !== '' && !excludedMeanings.has(mNorm)) {
          meaningPool.add(mNorm);
        }
      }
    }
    if (meaningPool.size >= 3 && soundPool.size >= 3) {
      return true;
    }
  }

  return false;
}

function canBuildReadingToChoice(
  allVerified: readonly Character[],
  character: Character,
): boolean {
  let count = 0;
  for (const candidate of allVerified) {
    if (candidate.id !== character.id && !hasReadingOverlap(character, candidate)) {
      count += 1;
      if (count >= 3) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validate selected units and question types before starting a session.
 */
export function validateGenerationConfig(
  catalog: CatalogStore,
  config: GenerationConfigInput,
): GenerationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const candidatesByType: Record<QuestionType, Character[]> = {
    hanja_to_choice: [],
    hanja_to_input: [],
    reading_to_choice: [],
    reading_to_write: [],
  };

  if (config.unitIds !== undefined && config.unitIds.length === 0) {
    errors.push('최소 1개 이상의 단원을 선택해 주세요.');
  }

  const uniqueTypes: QuestionType[] = [];
  const seenTypes = new Set<QuestionType>();
  for (const type of config.selectedTypes) {
    if (!seenTypes.has(type)) {
      seenTypes.add(type);
      uniqueTypes.push(type);
    }
  }

  if (uniqueTypes.length === 0) {
    errors.push('최소 1개 이상의 문제 유형을 선택해 주세요.');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
      effectiveTypes: [],
      candidatesByType,
    };
  }

  let readingCandidates: Character[];
  try {
    readingCandidates = catalog.getReadingCandidates(config.unitIds);
  } catch (error) {
    if (error instanceof CatalogLoadError) {
      errors.push(error.message);
      return {
        valid: false,
        errors,
        warnings,
        effectiveTypes: [],
        candidatesByType,
      };
    }
    throw error;
  }

  const allVerified = catalog.getReadingCandidates();
  const writingIdSet = new Set(
    catalog.getWritingCandidates(config.unitIds).map((c) => c.id),
  );

  for (const ch of readingCandidates) {
    if (ch.readings.length === 0) {
      continue;
    }
    candidatesByType.hanja_to_input.push(ch);
    if (canBuildHanjaToChoice(allVerified, ch)) {
      candidatesByType.hanja_to_choice.push(ch);
    }
    if (canBuildReadingToChoice(allVerified, ch)) {
      candidatesByType.reading_to_choice.push(ch);
    }
    if (writingIdSet.has(ch.id)) {
      candidatesByType.reading_to_write.push(ch);
    }
  }

  const effectiveTypes = uniqueTypes.filter(
    (type) => candidatesByType[type].length > 0,
  );
  const droppedTypes = uniqueTypes.filter(
    (type) => candidatesByType[type].length === 0,
  );

  if (effectiveTypes.length === 0) {
    errors.push(
      '선택한 단원과 문제 유형에 출제 가능한 한자 또는 4지선다 보기가 부족합니다.',
    );
    return {
      valid: false,
      errors,
      warnings,
      effectiveTypes: [],
      candidatesByType,
    };
  }

  if (droppedTypes.length > 0) {
    warnings.push(
      `출제 불가능한 유형(${droppedTypes.join(', ')})을 제외하고 유효한 유형으로 문항 수를 재분배합니다.`,
    );
  }

  const uniqueEligibleIds = new Set<string>();
  for (const type of effectiveTypes) {
    for (const ch of candidatesByType[type]) {
      uniqueEligibleIds.add(ch.id);
    }
  }
  if (uniqueEligibleIds.size < DEFAULT_QUESTION_COUNT) {
    warnings.push(
      `선택한 범위의 출제 가능 한자(${uniqueEligibleIds.size}자)가 20자 미만이므로 한자를 반복 출제해 20문항을 채웁니다.`,
    );
  }

  return {
    valid: true,
    errors,
    warnings,
    effectiveTypes,
    candidatesByType,
  };
}

function allocateTypeSlots(
  effectiveTypes: readonly QuestionType[],
  questionCount: number,
  rng: () => number,
): QuestionType[] {
  const k = effectiveTypes.length;
  const base = Math.floor(questionCount / k);
  const remainder = questionCount % k;

  const shuffledIndices = shuffleWithRng(
    Array.from({ length: k }, (_, idx) => idx),
    rng,
  );
  const bonusIndices = new Set(shuffledIndices.slice(0, remainder));

  const slots: QuestionType[] = [];
  for (let i = 0; i < k; i += 1) {
    const type = effectiveTypes[i]!;
    const count = base + (bonusIndices.has(i) ? 1 : 0);
    for (let j = 0; j < count; j += 1) {
      slots.push(type);
    }
  }

  return shuffleWithRng(slots, rng);
}

/**
 * Generate a normal (or custom-RNG) learning session of 20 questions (default).
 */
export function generateNormalQuestions(
  catalog: CatalogStore,
  options: GenerateNormalQuestionsOptions,
): FrozenQuestion[] {
  const rng = options.rng ?? Math.random;
  const questionCount = options.questionCount ?? DEFAULT_QUESTION_COUNT;
  const validation = validateGenerationConfig(catalog, {
    unitIds: options.unitIds,
    selectedTypes: options.selectedTypes,
  });

  if (!validation.valid) {
    throw new QuestionGenerationError(validation.errors.join(' '));
  }
  if (questionCount <= 0) {
    return [];
  }

  const { effectiveTypes, candidatesByType } = validation;
  const typeSlots = allocateTypeSlots(effectiveTypes, questionCount, rng);

  // Build union of all eligible characters across effectiveTypes
  const eligibleMap = new Map<string, Character>();
  for (const type of effectiveTypes) {
    for (const ch of candidatesByType[type]) {
      eligibleMap.set(ch.id, ch);
    }
  }
  const allEligibleChars = Array.from(eligibleMap.values());

  const assignedChars: Array<Character | undefined> = new Array<
    Character | undefined
  >(questionCount);
  const assignedTypes: QuestionType[] = [...typeSlots];

  if (allEligibleChars.length >= questionCount) {
    // >= 20 eligible characters: no duplicate characters within the session.
    // Assign constrained slots (fewer candidates) first so narrower pools aren't starved.
    const slotOrder = Array.from({ length: questionCount }, (_, idx) => idx).sort(
      (a, b) =>
        candidatesByType[assignedTypes[a]!].length -
        candidatesByType[assignedTypes[b]!].length,
    );

    const usedIds = new Set<string>();
    const shuffledPools = new Map<QuestionType, Character[]>();
    for (const type of effectiveTypes) {
      shuffledPools.set(type, shuffleWithRng(candidatesByType[type], rng));
    }

    for (const slotIdx of slotOrder) {
      const slotType = assignedTypes[slotIdx]!;
      const pool = shuffledPools.get(slotType)!;
      let picked = pool.find((c) => !usedIds.has(c.id));

      if (!picked) {
        // Fallback to any effectiveType that still has an unused character
        for (const altType of effectiveTypes) {
          const altPool = shuffledPools.get(altType)!;
          const altChar = altPool.find((c) => !usedIds.has(c.id));
          if (altChar) {
            assignedTypes[slotIdx] = altType;
            picked = altChar;
            break;
          }
        }
      }

      if (!picked) {
        throw new QuestionGenerationError(
          '중복 없이 20문항을 배정할 수 있는 한자 수가 부족합니다.',
        );
      }

      usedIds.add(picked.id);
      assignedChars[slotIdx] = picked;
    }
  } else {
    // < 20 eligible characters: Round 1 uses every eligible character once,
    // then fills remaining slots preferring lowest personal exposureCount without immediate repeats.
    const round1Count = allEligibleChars.length;
    const round1Chars = shuffleWithRng(allEligibleChars, rng);
    const inSessionCount = new Map<string, number>();

    // Assign Round 1 (match characters to slots they can fulfill)
    const remainingSlotIndices = new Set(
      Array.from({ length: round1Count }, (_, idx) => idx),
    );
    const eligibleByTypeSets = new Map<QuestionType, Set<string>>();
    for (const type of effectiveTypes) {
      eligibleByTypeSets.set(
        type,
        new Set(candidatesByType[type].map((c) => c.id)),
      );
    }

    // Order Round 1 characters from fewest supported types to most
    const charsOrdered = [...round1Chars].sort((a, b) => {
      const countA = effectiveTypes.filter((t) =>
        eligibleByTypeSets.get(t)!.has(a.id),
      ).length;
      const countB = effectiveTypes.filter((t) =>
        eligibleByTypeSets.get(t)!.has(b.id),
      ).length;
      return countA - countB;
    });

    for (const ch of charsOrdered) {
      let targetSlot: number | undefined;
      for (const slotIdx of remainingSlotIndices) {
        if (eligibleByTypeSets.get(assignedTypes[slotIdx]!)!.has(ch.id)) {
          targetSlot = slotIdx;
          break;
        }
      }
      if (targetSlot === undefined) {
        // Adjust slot type to one supported by ch if needed
        targetSlot = remainingSlotIndices.values().next().value as number;
        const supportedType = effectiveTypes.find((t) =>
          eligibleByTypeSets.get(t)!.has(ch.id),
        )!;
        assignedTypes[targetSlot] = supportedType;
      }
      remainingSlotIndices.delete(targetSlot);
      assignedChars[targetSlot] = ch;
      inSessionCount.set(ch.id, (inSessionCount.get(ch.id) ?? 0) + 1);
    }

    // Round 2: fill remaining slots from lowest effective exposure, avoiding prevCharId
    for (let slotIdx = round1Count; slotIdx < questionCount; slotIdx += 1) {
      const slotType = assignedTypes[slotIdx]!;
      const prevCharId = slotIdx > 0 ? assignedChars[slotIdx - 1]?.id : undefined;
      let pool = candidatesByType[slotType];

      if (pool.length === 0) {
        const fallbackType = effectiveTypes.find(
          (t) => candidatesByType[t].length > 0,
        )!;
        assignedTypes[slotIdx] = fallbackType;
        pool = candidatesByType[fallbackType];
      }

      const nonAdjacentPool =
        pool.length > 1 && prevCharId !== undefined
          ? pool.filter((c) => c.id !== prevCharId)
          : pool;

      const ranked = nonAdjacentPool.map((ch) => {
        const summary = getCharacterExposureSummary(ch, options.exposureStats);
        const sessionCount = inSessionCount.get(ch.id) ?? 0;
        return {
          ch,
          effectiveExposure: summary.exposureCount + sessionCount,
          lastExposedAt: summary.lastExposedAt,
          tieBreaker: rng(),
        };
      });

      ranked.sort((a, b) => {
        if (a.effectiveExposure !== b.effectiveExposure) {
          return a.effectiveExposure - b.effectiveExposure;
        }
        const tsDiff = compareTimestampsAsc(a.lastExposedAt, b.lastExposedAt);
        if (tsDiff !== 0) {
          return tsDiff;
        }
        return a.tieBreaker - b.tieBreaker;
      });

      const picked = ranked[0]!.ch;
      assignedChars[slotIdx] = picked;
      inSessionCount.set(picked.id, (inSessionCount.get(picked.id) ?? 0) + 1);
    }
  }

  const prefix = options.questionIdPrefix ?? 'q';
  const questions: FrozenQuestion[] = [];

  for (let i = 0; i < questionCount; i += 1) {
    const ch = assignedChars[i]!;
    const qType = assignedTypes[i]!;
    const questionId = `${prefix}-${String(i + 1).padStart(2, '0')}`;

    const built = generateQuestionForCharacter(catalog, ch, qType, {
      unitIds: options.unitIds,
      exposureStats: options.exposureStats,
      rng,
      questionId,
    });

    if (built) {
      questions.push(built);
      continue;
    }

    // Fallback to another effectiveType if a specific (character, type) failed 4-choice construction
    let recovered: FrozenQuestion | null = null;
    for (const altType of effectiveTypes) {
      if (altType === qType) {
        continue;
      }
      recovered = generateQuestionForCharacter(catalog, ch, altType, {
        unitIds: options.unitIds,
        exposureStats: options.exposureStats,
        rng,
        questionId,
      });
      if (recovered) {
        break;
      }
    }
    if (!recovered) {
      throw new QuestionGenerationError(
        `한자(${ch.character})에 대한 문항을 생성할 수 없습니다.`,
      );
    }
    questions.push(recovered);
  }

  return questions;
}

/**
 * Generate a deterministic 20-question Daily Challenge set for a given YYYY-MM-DD key.
 * Ignores personal exposureStats so every profile receives the identical question set.
 */
export function generateDailyQuestions(
  catalog: CatalogStore,
  dateKey: string,
  options: GenerateDailyQuestionsOptions = {},
): FrozenQuestion[] {
  const unitIds = options.unitIds ?? catalog.units.map((u) => u.id);
  const selectedTypes = options.selectedTypes ?? [...ALL_QUESTION_TYPES];
  const rng = createSeededRng(`daily:${dateKey}`);

  return generateNormalQuestions(catalog, {
    unitIds,
    selectedTypes,
    exposureStats: {},
    questionCount: options.questionCount ?? DEFAULT_QUESTION_COUNT,
    rng,
    questionIdPrefix: `daily-${dateKey}-q`,
  });
}
