import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogStore, TEXTBOOK_ID } from '../../data/catalogStore';
import type { Character, CharacterCatalog, QuestionType, Textbook } from '../../types/catalog';
import type { ReadingExposureStat } from '../../types/storage';
import { createSeededRng } from '../prng';
import {
  ALL_QUESTION_TYPES,
  buildMcqQuestion,
  generateDailyQuestions,
  generateNormalQuestions,
  generateQuestionForCharacter,
  makeReadingKey,
  selectReadingPair,
  validateGenerationConfig,
} from '../questionGenerator';

const DATA_DIR = path.resolve(process.cwd(), 'data');

function loadRealCatalog(): {
  rawCatalog: CharacterCatalog;
  rawTextbook: Textbook;
  store: CatalogStore;
} {
  const rawCatalog = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'characters.json'), 'utf-8'),
  ) as CharacterCatalog;
  const rawTextbook = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, `textbooks/${TEXTBOOK_ID}.json`), 'utf-8'),
  ) as Textbook;
  return {
    rawCatalog,
    rawTextbook,
    store: new CatalogStore(rawCatalog, rawTextbook),
  };
}

function getCharByGlyph(store: CatalogStore, glyph: string): Character {
  const found = store.characters.find((c) => c.character === glyph);
  if (!found) {
    throw new Error(`Character not found: ${glyph}`);
  }
  return found;
}

describe('questionGenerator', () => {
  const { rawCatalog, rawTextbook, store } = loadRealCatalog();
  const unit01Id = `${TEXTBOOK_ID}-unit-01`;

  it('distributes 20 questions evenly across 1/2/3/4 selected types and shuffles order', () => {
    const countByType = (types: readonly QuestionType[], seed: string) => {
      const questions = generateNormalQuestions(store, {
        unitIds: [unit01Id],
        selectedTypes: types,
        exposureStats: {},
        rng: createSeededRng(seed),
      });
      expect(questions).toHaveLength(20);
      const counts = new Map<QuestionType, number>();
      for (const q of questions) {
        counts.set(q.questionType, (counts.get(q.questionType) ?? 0) + 1);
      }
      return { questions, counts };
    };

    // 1 type -> 20
    const one = countByType(['hanja_to_choice'], 'split-1');
    expect(one.counts.get('hanja_to_choice')).toBe(20);

    // 2 types -> 10 / 10
    const two = countByType(['hanja_to_choice', 'hanja_to_input'], 'split-2');
    expect(two.counts.get('hanja_to_choice')).toBe(10);
    expect(two.counts.get('hanja_to_input')).toBe(10);
    expect(
      two.questions.slice(0, 10).every((q) => q.questionType === two.questions[0]!.questionType),
    ).toBe(false);

    // 3 types -> 7 / 7 / 6 where 1 random type gets 6
    const typesGetting6 = new Set<QuestionType>();
    for (let i = 0; i < 20; i += 1) {
      const three = countByType(
        ['hanja_to_choice', 'hanja_to_input', 'reading_to_choice'],
        `split-3-${i}`,
      );
      const vals = [
        three.counts.get('hanja_to_choice') ?? 0,
        three.counts.get('hanja_to_input') ?? 0,
        three.counts.get('reading_to_choice') ?? 0,
      ].sort((a, b) => a - b);
      expect(vals).toEqual([6, 7, 7]);
      for (const [t, c] of three.counts.entries()) {
        if (c === 6) {
          typesGetting6.add(t);
        }
      }
    }
    expect(typesGetting6.size).toBeGreaterThan(1);

    // 4 types -> 5 / 5 / 5 / 5
    const four = countByType([...ALL_QUESTION_TYPES], 'split-4');
    for (const t of ALL_QUESTION_TYPES) {
      expect(four.counts.get(t)).toBe(5);
    }
  });

  it('prevents duplicate characters when >= 20 eligible characters exist and keeps answers within selected units', () => {
    const unit01Chars = new Set(store.getUnitById(unit01Id)!.characterIds);
    expect(unit01Chars.size).toBeGreaterThanOrEqual(20);

    const questions = generateNormalQuestions(store, {
      unitIds: [unit01Id],
      selectedTypes: [...ALL_QUESTION_TYPES],
      exposureStats: {},
      rng: createSeededRng('no-dup-unit01'),
    });

    const charIds = questions.map((q) => q.characterId);
    expect(new Set(charIds).size).toBe(20);
    for (const charId of charIds) {
      expect(unit01Chars.has(charId)).toBe(true);
    }
  });

  it('repeats characters for < 20 unit without consecutive duplicates and prioritizes lowest exposureCount', () => {
    // Build a 5-character synthetic unit inside the real catalog
    const fiveCharIds = store.getUnitById(unit01Id)!.characterIds.slice(0, 5);
    const smallTextbook: Textbook = {
      ...rawTextbook,
      units: [
        {
          id: 'small-unit-5',
          number: 1,
          title: '소규모 단원',
          sourcePages: [1],
          characterIds: fiveCharIds,
        },
        ...rawTextbook.units,
      ],
    };
    const smallStore = new CatalogStore(rawCatalog, smallTextbook);

    // Give first two characters higher exposure so remaining 3 are preferred in round 2
    const exposureStats: Record<string, ReadingExposureStat> = {};
    for (const id of fiveCharIds.slice(0, 2)) {
      const ch = smallStore.getCharacterById(id)!;
      const key = makeReadingKey(id, ch.readings[0]!.sound);
      exposureStats[key] = {
        readingKey: key,
        characterId: id,
        sound: ch.readings[0]!.sound,
        exposureCount: 5,
        lastExposedAt: '2026-11-22T09:00:00Z',
      };
    }

    const questions = generateNormalQuestions(smallStore, {
      unitIds: ['small-unit-5'],
      selectedTypes: ['hanja_to_choice', 'hanja_to_input'],
      exposureStats,
      rng: createSeededRng('small-unit-repeat'),
    });

    expect(questions).toHaveLength(20);
    // All answers strictly from small-unit-5
    for (const q of questions) {
      expect(fiveCharIds).toContain(q.characterId);
    }
    // Round 1 uses all 5 characters once
    expect(new Set(questions.slice(0, 5).map((q) => q.characterId)).size).toBe(5);
    // Zero back-to-back duplicate characters anywhere (including Round 1 -> Round 2)
    for (let i = 1; i < questions.length; i += 1) {
      expect(questions[i]!.characterId).not.toBe(questions[i - 1]!.characterId);
    }
    // Low-exposure characters appear more frequently overall than high-exposure ones
    const freq = new Map<string, number>();
    for (const q of questions) {
      freq.set(q.characterId, (freq.get(q.characterId) ?? 0) + 1);
    }
    const lowMin = Math.min(...fiveCharIds.slice(2).map((id) => freq.get(id) ?? 0));
    const highMax = Math.max(...fiveCharIds.slice(0, 2).map((id) => freq.get(id) ?? 0));
    expect(lowMin).toBeGreaterThanOrEqual(highMax);
  });

  it('handles 1-character unit edge case with cross-unit MCQ distractors', () => {
    const singleCharId = store.getUnitById(unit01Id)!.characterIds[0]!;
    const oneCharTextbook: Textbook = {
      ...rawTextbook,
      units: [
        {
          id: 'single-char-unit',
          number: 1,
          title: '1자 단원',
          sourcePages: [1],
          characterIds: [singleCharId],
        },
        ...rawTextbook.units,
      ],
    };
    const oneCharStore = new CatalogStore(rawCatalog, oneCharTextbook);

    const questions = generateNormalQuestions(oneCharStore, {
      unitIds: ['single-char-unit'],
      selectedTypes: ['hanja_to_choice'],
      exposureStats: {},
      rng: createSeededRng('single-char'),
    });

    expect(questions).toHaveLength(20);
    for (const q of questions) {
      expect(q.characterId).toBe(singleCharId);
      expect(q.meaningChoices).toHaveLength(4);
      expect(q.soundChoices).toHaveLength(4);
    }
  });

  it('excludes all other valid meanings, sounds, and allowedSounds for multi-reading & multi-meaning characters in hanja_to_choice', () => {
    const multiGlyphs = ['樂', '不', '車', '則', '畜', '日'];
    for (const glyph of multiGlyphs) {
      const ch = getCharByGlyph(store, glyph);
      const allValidMeanings = new Set(ch.readings.flatMap((r) => r.meanings));
      const allValidSounds = new Set(
        ch.readings.flatMap((r) => [r.sound, ...(r.allowedSounds ?? [])]),
      );

      for (let i = 0; i < 10; i += 1) {
        const q = buildMcqQuestion(store, ch, 'hanja_to_choice', {
          rng: createSeededRng(`multi-${glyph}-${i}`),
        });
        expect(q).not.toBeNull();
        expect(q!.meaningChoices).toHaveLength(4);
        expect(q!.soundChoices).toHaveLength(4);
        expect(new Set(q!.meaningChoices).size).toBe(4);
        expect(new Set(q!.soundChoices).size).toBe(4);

        const meaningHits = q!.meaningChoices!.filter((m) => allValidMeanings.has(m));
        const soundHits = q!.soundChoices!.filter((s) => allValidSounds.has(s));

        expect(meaningHits).toEqual([q!.correctMeaning]);
        expect(soundHits).toEqual([q!.targetSound]);
      }
    }
  });

  it('excludes overlapping (sound/allowedSounds && meaning) characters in reading_to_choice distractors', () => {
    const overlapPairs: Array<[string, string]> = [
      ['故', '古'],
      ['號', '呼'],
    ];

    for (const [targetGlyph, forbiddenGlyph] of overlapPairs) {
      const target = getCharByGlyph(store, targetGlyph);
      const forbidden = getCharByGlyph(store, forbiddenGlyph);
      for (let i = 0; i < 15; i += 1) {
        const q = buildMcqQuestion(store, target, 'reading_to_choice', {
          rng: createSeededRng(`overlap-${targetGlyph}-${i}`),
        });
        expect(q).not.toBeNull();
        expect(q!.characterChoices).toHaveLength(4);
        expect(new Set(q!.characterChoices).size).toBe(4);
        expect(q!.characterChoices).toContain(target.id);
        expect(q!.characterChoices).not.toContain(forbidden.id);
      }
    }
  });

  it('draws distractors from selected units first and falls back to other units only when < 3 exist', () => {
    const twoChars = store.getUnitById(unit01Id)!.characterIds.slice(0, 2);
    const smallTextbook: Textbook = {
      ...rawTextbook,
      units: [
        {
          id: 'two-char-unit',
          number: 1,
          title: '2자 단원',
          sourcePages: [1],
          characterIds: twoChars,
        },
        ...rawTextbook.units,
      ],
    };
    const smallStore = new CatalogStore(rawCatalog, smallTextbook);
    const target = smallStore.getCharacterById(twoChars[0]!)!;
    const unitMate = smallStore.getCharacterById(twoChars[1]!)!;

    const q = buildMcqQuestion(smallStore, target, 'reading_to_choice', {
      unitIds: ['two-char-unit'],
      rng: createSeededRng('fallback-unit'),
    });
    expect(q).not.toBeNull();
    expect(q!.characterChoices).toHaveLength(4);
    expect(q!.characterChoices).toContain(target.id);
    // Unit mate should be chosen first, with remaining 2 drawn from other textbook units
    expect(q!.characterChoices).toContain(unitMate.id);
  });

  it('returns null and rejects/rebalances when < 3 valid distractors exist across the entire textbook', () => {
    const tinyChars = rawCatalog.characters.slice(0, 3);
    const tinyCatalog: CharacterCatalog = {
      ...rawCatalog,
      characters: tinyChars,
    };
    const tinyTextbook: Textbook = {
      ...rawTextbook,
      counts: { units: 1, entries: 3, uniqueCharacters: 3 },
      units: [
        {
          id: 'tiny-unit',
          number: 1,
          title: '초소형',
          sourcePages: [1],
          characterIds: tinyChars.map((c) => c.id),
        },
      ],
    };
    const tinyStore = new CatalogStore(tinyCatalog, tinyTextbook);

    expect(
      buildMcqQuestion(tinyStore, tinyChars[0]!, 'hanja_to_choice', {
        unitIds: ['tiny-unit'],
      }),
    ).toBeNull();
    expect(
      buildMcqQuestion(tinyStore, tinyChars[0]!, 'reading_to_choice', {
        unitIds: ['tiny-unit'],
      }),
    ).toBeNull();

    const mcqOnlyValidation = validateGenerationConfig(tinyStore, {
      unitIds: ['tiny-unit'],
      selectedTypes: ['hanja_to_choice', 'reading_to_choice'],
    });
    expect(mcqOnlyValidation.valid).toBe(false);
    expect(mcqOnlyValidation.errors.length).toBeGreaterThan(0);

    const mixedValidation = validateGenerationConfig(tinyStore, {
      unitIds: ['tiny-unit'],
      selectedTypes: ['hanja_to_choice', 'hanja_to_input'],
    });
    expect(mixedValidation.valid).toBe(true);
    expect(mixedValidation.effectiveTypes).toEqual(['hanja_to_input']);
    expect(mixedValidation.warnings.length).toBeGreaterThan(0);

    const rebalanced = generateNormalQuestions(tinyStore, {
      unitIds: ['tiny-unit'],
      selectedTypes: ['hanja_to_choice', 'hanja_to_input'],
      exposureStats: {},
      rng: createSeededRng('rebalance'),
    });
    expect(rebalanced).toHaveLength(20);
    expect(rebalanced.every((q) => q.questionType === 'hanja_to_input')).toBe(true);
  });

  it('selects reading pairs by exposureCount asc -> lastExposedAt asc (null first) -> rng tie-break', () => {
    const rakChar = getCharByGlyph(store, '樂');
    const rakKey = makeReadingKey(rakChar.id, '락');
    const akKey = makeReadingKey(rakChar.id, '악');

    // 1. Lower exposureCount wins
    expect(
      selectReadingPair(
        rakChar,
        {
          [rakKey]: {
            readingKey: rakKey,
            characterId: rakChar.id,
            sound: '락',
            exposureCount: 2,
            lastExposedAt: '2026-11-22T08:00:00Z',
          },
          [akKey]: {
            readingKey: akKey,
            characterId: rakChar.id,
            sound: '악',
            exposureCount: 1,
            lastExposedAt: '2026-11-22T10:00:00Z',
          },
        },
        createSeededRng('pair-1'),
      ).sound,
    ).toBe('악');

    // 2. Same exposureCount: null lastExposedAt wins over timestamp
    expect(
      selectReadingPair(
        rakChar,
        {
          [rakKey]: {
            readingKey: rakKey,
            characterId: rakChar.id,
            sound: '락',
            exposureCount: 1,
            lastExposedAt: '2026-11-22T08:00:00Z',
          },
          [akKey]: {
            readingKey: akKey,
            characterId: rakChar.id,
            sound: '악',
            exposureCount: 1,
            lastExposedAt: null,
          },
        },
        createSeededRng('pair-2'),
      ).sound,
    ).toBe('악');

    // 3. Same exposureCount: older timestamp wins
    expect(
      selectReadingPair(
        rakChar,
        {
          [rakKey]: {
            readingKey: rakKey,
            characterId: rakChar.id,
            sound: '락',
            exposureCount: 1,
            lastExposedAt: '2026-11-22T07:00:00Z',
          },
          [akKey]: {
            readingKey: akKey,
            characterId: rakChar.id,
            sound: '악',
            exposureCount: 1,
            lastExposedAt: '2026-11-22T09:00:00Z',
          },
        },
        createSeededRng('pair-3'),
      ).sound,
    ).toBe('락');

    // 4. Complete tie uses rng tie-break
    const pickedSounds = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      pickedSounds.add(
        selectReadingPair(rakChar, {}, createSeededRng(`tie-${i}`)).sound,
      );
    }
    expect(pickedSounds).toEqual(new Set(['락', '악']));
  });

  it('excludes strokeStatus !== verified characters from reading_to_write', () => {
    const unit01CharIds = store.getUnitById(unit01Id)!.characterIds;
    const unverifiedId = unit01CharIds[0]!;
    const modifiedCatalog: CharacterCatalog = {
      ...rawCatalog,
      characters: rawCatalog.characters.map((c) =>
        c.id === unverifiedId ? { ...c, strokeStatus: 'draft' } : c,
      ),
    };
    const modifiedStore = new CatalogStore(modifiedCatalog, rawTextbook);
    const unverifiedChar = modifiedStore.getCharacterById(unverifiedId)!;

    expect(
      generateQuestionForCharacter(modifiedStore, unverifiedChar, 'reading_to_write'),
    ).toBeNull();

    const validation = validateGenerationConfig(modifiedStore, {
      unitIds: [unit01Id],
      selectedTypes: ['reading_to_write'],
    });
    expect(
      validation.candidatesByType.reading_to_write.some((c) => c.id === unverifiedId),
    ).toBe(false);

    const writeQuestions = generateNormalQuestions(modifiedStore, {
      unitIds: [unit01Id],
      selectedTypes: ['reading_to_write'],
      exposureStats: {},
      rng: createSeededRng('write-filter'),
    });
    expect(writeQuestions.some((q) => q.characterId === unverifiedId)).toBe(false);
  });

  it('generates identical 20-question sets for the same dateKey in daily challenge', () => {
    const first = generateDailyQuestions(store, '2026-11-22');
    const second = generateDailyQuestions(store, '2026-11-22');
    const otherDate = generateDailyQuestions(store, '2026-11-23');

    expect(first).toHaveLength(20);
    expect(first).toEqual(second);
    expect(otherDate.map((q) => q.characterId)).not.toEqual(
      first.map((q) => q.characterId),
    );
  });
});
