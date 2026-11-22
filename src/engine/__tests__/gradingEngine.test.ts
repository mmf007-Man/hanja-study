import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogStore, TEXTBOOK_ID } from '../../data/catalogStore';
import type { Character, CharacterCatalog, Textbook } from '../../types/catalog';
import type { FrozenQuestion } from '../../types/storage';
import {
  calculateSessionMetrics,
  canSubmitAnswer,
  createAbandonedAnswer,
  gradeDontKnow,
  gradeSubmission,
  normalizeAnswer,
} from '../gradingEngine';

const DATA_DIR = path.resolve(process.cwd(), 'data');

function loadStore(): CatalogStore {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'characters.json'), 'utf-8'),
  ) as CharacterCatalog;
  const textbook = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, `textbooks/${TEXTBOOK_ID}.json`), 'utf-8'),
  ) as Textbook;
  return new CatalogStore(catalog, textbook);
}

function getChar(store: CatalogStore, glyph: string): Character {
  const ch = store.characters.find((c) => c.character === glyph);
  if (!ch) {
    throw new Error(`Missing character: ${glyph}`);
  }
  return ch;
}

describe('gradingEngine', () => {
  const store = loadStore();
  const hanChar = getChar(store, '漢');
  const rakChar = getChar(store, '樂');
  const yearChar = getChar(store, '年');
  const sixChar = getChar(store, '六');

  const inputQuestionFor = (ch: Character): FrozenQuestion => ({
    questionId: `q-${ch.id}-input`,
    characterId: ch.id,
    questionType: 'hanja_to_input',
    targetSound: ch.readings[0]!.sound,
    targetMeanings: [...ch.readings[0]!.meanings],
  });

  const choiceQuestionForRak: FrozenQuestion = {
    questionId: 'q-rak-choice',
    characterId: rakChar.id,
    questionType: 'hanja_to_choice',
    targetSound: '락',
    targetMeanings: ['즐겁다'],
    correctMeaning: '즐겁다',
    meaningChoices: ['즐겁다', '하늘', '땅', '물'],
    soundChoices: ['락', '천', '지', '수'],
  };

  it('strips all whitespace while rejecting inflection, synonym, and typo in meaning input', () => {
    expect(normalizeAnswer(' 한 나라 ')).toBe('한나라');

    const qHan = inputQuestionFor(hanChar);
    expect(
      gradeSubmission(
        qHan,
        hanChar,
        { meaning: ' 한 나라 ', sound: ' 한 ' },
        '2026-11-22T10:00:00Z',
      ).record,
    ).toMatchObject({
      score: 2,
      outcome: 'correct',
      meaningCorrect: true,
      soundCorrect: true,
      pairMatched: true,
    });

    // 1-char typo
    expect(
      gradeSubmission(
        qHan,
        hanChar,
        { meaning: '한나리', sound: '한' },
        '2026-11-22T10:00:00Z',
      ).record,
    ).toMatchObject({
      score: 0,
      outcome: 'incorrect',
      meaningCorrect: false,
      soundCorrect: true,
      errorType: 'meaning_error',
    });

    // Inflection / synonym rejected on 樂
    const qRak = inputQuestionFor(rakChar);
    expect(
      gradeSubmission(
        qRak,
        rakChar,
        { meaning: '즐거울', sound: '락' },
        '2026-11-22T10:00:00Z',
      ).record,
    ).toMatchObject({
      score: 0,
      outcome: 'incorrect',
      meaningCorrect: false,
      soundCorrect: true,
      errorType: 'meaning_error',
    });

    expect(
      gradeSubmission(
        qRak,
        rakChar,
        { meaning: '기쁘다', sound: '락' },
        '2026-11-22T10:00:00Z',
      ).record,
    ).toMatchObject({
      score: 0,
      outcome: 'incorrect',
      meaningCorrect: false,
      soundCorrect: true,
      errorType: 'meaning_error',
    });
  });

  it('accepts registered allowedSounds (年/연, 六/육, 樂/낙) and rejects unapproved initial sounds', () => {
    const qYear = inputQuestionFor(yearChar);
    expect(
      gradeSubmission(
        qYear,
        yearChar,
        { meaning: '해', sound: '연' },
        '2026-11-22T10:00:00Z',
      ).record,
    ).toMatchObject({ score: 2, outcome: 'correct' });

    const qSix = inputQuestionFor(sixChar);
    expect(
      gradeSubmission(
        qSix,
        sixChar,
        { meaning: '여섯', sound: '육' },
        '2026-11-22T10:00:00Z',
      ).record,
    ).toMatchObject({ score: 2, outcome: 'correct' });

    const qRak = inputQuestionFor(rakChar);
    expect(
      gradeSubmission(
        qRak,
        rakChar,
        { meaning: '즐겁다', sound: '낙' },
        '2026-11-22T10:00:00Z',
      ).record,
    ).toMatchObject({ score: 2, outcome: 'correct' });

    // Unapproved initial sound (樂 cannot be '약'; Year cannot be '련')
    expect(
      gradeSubmission(
        qYear,
        yearChar,
        { meaning: '해', sound: '련' },
        '2026-11-22T10:00:00Z',
      ).record,
    ).toMatchObject({
      score: 0,
      outcome: 'incorrect',
      meaningCorrect: true,
      soundCorrect: false,
      errorType: 'sound_error',
    });
  });

  it('detects multi-reading pair mismatches on 樂 with 0 points and warning flag', () => {
    const qRak = inputQuestionFor(rakChar);

    // Valid pairs -> 2 points
    for (const [meaning, sound] of [
      ['즐겁다', '락'],
      ['즐겁다', '낙'],
      ['노래', '악'],
    ]) {
      const res = gradeSubmission(
        qRak,
        rakChar,
        { meaning, sound },
        '2026-11-22T10:00:00Z',
      );
      expect(res.record.score).toBe(2);
      expect(res.record.outcome).toBe('correct');
      expect(res.showPairMismatchWarning).toBe(false);
    }

    // Cross-pair mismatches -> 0 points, pair_mismatch, showPairMismatchWarning: true
    for (const [meaning, sound] of [
      ['즐겁다', '악'],
      ['노래', '락'],
      ['노래', '낙'],
    ]) {
      const res = gradeSubmission(
        qRak,
        rakChar,
        { meaning, sound },
        '2026-11-22T10:00:00Z',
      );
      expect(res.record).toMatchObject({
        score: 0,
        outcome: 'incorrect',
        meaningCorrect: true,
        soundCorrect: true,
        pairMatched: false,
        errorType: 'pair_mismatch',
        submittedMeaning: meaning,
        submittedSound: sound,
      });
      expect(res.showPairMismatchWarning).toBe(true);
      expect(res.shouldRevealAnswerImmediately).toBe(false);
    }
  });

  it('enforces canSubmitAnswer completeness across all 4 question types', () => {
    const qInput = inputQuestionFor(hanChar);
    expect(canSubmitAnswer(qInput, {})).toBe(false);
    expect(canSubmitAnswer(qInput, { meaning: '한나라', sound: '   ' })).toBe(false);
    expect(canSubmitAnswer(qInput, { meaning: '  ', sound: '한' })).toBe(false);
    expect(canSubmitAnswer(qInput, { meaning: '한나라', sound: '한' })).toBe(true);

    expect(canSubmitAnswer(choiceQuestionForRak, { meaning: '즐겁다' })).toBe(false);
    expect(canSubmitAnswer(choiceQuestionForRak, { sound: '락' })).toBe(false);
    expect(
      canSubmitAnswer(choiceQuestionForRak, { meaning: '즐겁다', sound: '락' }),
    ).toBe(true);

    const qReadChoice: FrozenQuestion = {
      questionId: 'q-rc',
      characterId: hanChar.id,
      questionType: 'reading_to_choice',
      targetSound: '한',
      targetMeanings: ['한나라'],
      characterChoices: [hanChar.id, rakChar.id, yearChar.id, sixChar.id],
    };
    expect(canSubmitAnswer(qReadChoice, {})).toBe(false);
    expect(canSubmitAnswer(qReadChoice, { characterId: '' })).toBe(false);
    expect(canSubmitAnswer(qReadChoice, { characterId: hanChar.id })).toBe(true);

    const qWrite: FrozenQuestion = {
      questionId: 'q-write',
      characterId: hanChar.id,
      questionType: 'reading_to_write',
      targetSound: '한',
      targetMeanings: ['한나라'],
    };
    expect(canSubmitAnswer(qWrite, {})).toBe(false);
    expect(canSubmitAnswer(qWrite, { completed: false })).toBe(false);
    expect(canSubmitAnswer(qWrite, { completed: true })).toBe(true);
  });

  it('handles dont_know with immediate reveal, 0 points, and exclusion from meaning/sound accuracy', () => {
    const res = gradeDontKnow(choiceQuestionForRak, '2026-11-22T10:00:00Z');
    expect(res.shouldRevealAnswerImmediately).toBe(true);
    expect(res.showPairMismatchWarning).toBe(false);
    expect(res.record).toMatchObject({
      score: 0,
      outcome: 'dont_know',
      errorType: 'dont_know',
    });
    expect(res.record.meaningCorrect).toBeUndefined();
    expect(res.record.soundCorrect).toBeUndefined();
  });

  it('computes questionAccuracy and meaning/sound accuracies according to spec denominators', () => {
    const qInput = inputQuestionFor(hanChar);
    const qWrite: FrozenQuestion = {
      questionId: 'q-write',
      characterId: hanChar.id,
      questionType: 'reading_to_write',
      targetSound: '한',
      targetMeanings: ['한나라'],
    };

    const answers = [
      // 1. hanja_to_input correct (2 pts) -> meaning: ok, sound: ok
      gradeSubmission(qInput, hanChar, { meaning: '한나라', sound: '한' }, 't1').record,
      // 2. hanja_to_choice meaning_error (0 pts) -> meaning: fail, sound: ok
      gradeSubmission(
        choiceQuestionForRak,
        rakChar,
        { meaning: '하늘', sound: '락' },
        't2',
      ).record,
      // 3. reading_to_write correct with guide (2 pts) -> counts for questionAccuracy, not readingGraded
      gradeSubmission(qWrite, hanChar, { completed: true, strokeGuideUsed: true }, 't3')
        .record,
      // 4. dont_know (0 pts) -> in confirmedCount denominator, excluded from readingGraded
      gradeDontKnow(qInput, 't4').record,
      // 5. abandoned (0 pts) -> excluded from ALL accuracy denominators
      createAbandonedAnswer(qInput, 't5'),
    ];

    expect(answers[2]!.strokeGuideUsed).toBe(true);

    const metrics = calculateSessionMetrics(answers);
    expect(metrics.totalScore).toBe(4);
    expect(metrics.maxScore).toBe(8);
    expect(metrics.confirmedCount).toBe(4);
    expect(metrics.correctCount).toBe(2);
    expect(metrics.incorrectCount).toBe(1);
    expect(metrics.dontKnowCount).toBe(1);
    expect(metrics.abandonedCount).toBe(1);
    expect(metrics.readingGradedCount).toBe(2);
    expect(metrics.meaningCorrectCount).toBe(1);
    expect(metrics.soundCorrectCount).toBe(2);
    expect(metrics.questionAccuracy).toBeCloseTo(2 / 4);
    expect(metrics.meaningAccuracy).toBeCloseTo(1 / 2);
    expect(metrics.soundAccuracy).toBeCloseTo(2 / 2);
  });
});
