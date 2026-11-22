import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogStore, TEXTBOOK_ID } from '../../data/catalogStore';
import type { Character, CharacterCatalog, Textbook } from '../../types/catalog';
import type { FrozenQuestion, ReviewItem } from '../../types/storage';
import { createAbandonedAnswer, gradeDontKnow, gradeSubmission } from '../gradingEngine';
import { createSeededRng } from '../prng';
import { buildMcqQuestion } from '../questionGenerator';
import {
  applySessionOutcomeToReviewQueue,
  makeReviewItemId,
  resetReviewSessionStreaks,
  selectNextReviewQuestion,
} from '../reviewQueueEngine';

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

function getChar(store: CatalogStore, glyph: string): Character {
  const found = store.characters.find((c) => c.character === glyph);
  if (!found) {
    throw new Error(`Missing character: ${glyph}`);
  }
  return found;
}

describe('reviewQueueEngine', () => {
  const { rawCatalog, rawTextbook, store } = loadRealCatalog();
  const hanChar = getChar(store, '漢');
  const rakChar = getChar(store, '樂');
  const unit01Id = `${TEXTBOOK_ID}-unit-01`;

  it('requires 2 consecutive passes in review to complete while preserving full history, and resets streak on failure', () => {
    const qNormal: FrozenQuestion = {
      questionId: 'q1',
      characterId: hanChar.id,
      questionType: 'hanja_to_input',
      targetSound: '한',
      targetMeanings: ['한나라'],
    };

    const failNormal = gradeSubmission(
      qNormal,
      hanChar,
      { meaning: '틀림', sound: '한' },
      '2026-11-22T10:00:00Z',
    ).record;

    let queue: Record<string, ReviewItem> = {};
    queue = applySessionOutcomeToReviewQueue(
      queue,
      qNormal,
      hanChar,
      failNormal,
      'sess-1',
      '2026-11-22T10:00:00Z',
    );

    const itemId = makeReviewItemId(hanChar.id, 'hanja_to_input', '한');
    expect(queue[itemId]).toMatchObject({
      status: 'needs_review',
      sessionStreak: 0,
      lastErrorType: 'meaning_error',
    });
    expect(queue[itemId]!.history.map((h) => h.event)).toEqual(['registered']);

    // Review pass 1 -> streak = 1, still needs_review
    const qReview1 = selectNextReviewQuestion(store, queue, {}, { unitIds: [unit01Id] })!;
    expect(qReview1.reviewItemId).toBe(itemId);
    const pass1 = gradeSubmission(
      qReview1,
      hanChar,
      { meaning: '한나라', sound: '한' },
      '2026-11-22T10:05:00Z',
    ).record;
    queue = applySessionOutcomeToReviewQueue(
      queue,
      qReview1,
      hanChar,
      pass1,
      'sess-rev-1',
      '2026-11-22T10:05:00Z',
    );
    expect(queue[itemId]!.status).toBe('needs_review');
    expect(queue[itemId]!.sessionStreak).toBe(1);

    // Fail (or dont_know) on review -> resets sessionStreak to 0
    const dontKnowRev = gradeDontKnow(qReview1, '2026-11-22T10:06:00Z').record;
    queue = applySessionOutcomeToReviewQueue(
      queue,
      qReview1,
      hanChar,
      dontKnowRev,
      'sess-rev-1',
      '2026-11-22T10:06:00Z',
    );
    expect(queue[itemId]!.status).toBe('needs_review');
    expect(queue[itemId]!.sessionStreak).toBe(0);
    expect(queue[itemId]!.lastErrorType).toBe('dont_know');

    // Two consecutive passes -> completed, preserving all prior history
    const passA = gradeSubmission(
      qReview1,
      hanChar,
      { meaning: '한나라', sound: '한' },
      '2026-11-22T10:07:00Z',
    ).record;
    queue = applySessionOutcomeToReviewQueue(
      queue,
      qReview1,
      hanChar,
      passA,
      'sess-rev-1',
      '2026-11-22T10:07:00Z',
    );
    expect(queue[itemId]!.sessionStreak).toBe(1);

    const passB = gradeSubmission(
      qReview1,
      hanChar,
      { meaning: '한나라', sound: '한' },
      '2026-11-22T10:08:00Z',
    ).record;
    queue = applySessionOutcomeToReviewQueue(
      queue,
      qReview1,
      hanChar,
      passB,
      'sess-rev-1',
      '2026-11-22T10:08:00Z',
    );
    expect(queue[itemId]!.status).toBe('completed');
    expect(queue[itemId]!.sessionStreak).toBe(2);
    expect(queue[itemId]!.history.map((h) => h.event)).toEqual([
      'registered',
      'review_pass',
      'review_fail',
      'review_pass',
      'review_pass',
      'completed',
    ]);
  });

  it('resets needs_review sessionStreak on new session without affecting completed items, and reopens completed items if missed again', () => {
    const itemId = makeReviewItemId(hanChar.id, 'hanja_to_input', '한');
    const qNormal: FrozenQuestion = {
      questionId: 'q1',
      characterId: hanChar.id,
      questionType: 'hanja_to_input',
      targetSound: '한',
      targetMeanings: ['한나라'],
    };

    const initialQueue: Record<string, ReviewItem> = {
      [itemId]: {
        reviewItemId: itemId,
        characterId: hanChar.id,
        questionType: 'hanja_to_input',
        targetSound: '한',
        targetMeanings: ['한나라'],
        status: 'needs_review',
        sessionStreak: 1,
        lastErrorType: 'meaning_error',
        history: [{ at: 't0', event: 'registered', sessionId: 's0', errorType: 'meaning_error' }],
      },
      'hanja-6A02::hanja_to_input::락': {
        reviewItemId: 'hanja-6A02::hanja_to_input::락',
        characterId: rakChar.id,
        questionType: 'hanja_to_input',
        targetSound: '락',
        targetMeanings: ['즐겁다'],
        status: 'completed',
        sessionStreak: 2,
        history: [
          { at: 't0', event: 'registered', sessionId: 's0', errorType: 'sound_error' },
          { at: 't1', event: 'completed', sessionId: 's1' },
        ],
      },
    };

    const reset = resetReviewSessionStreaks(initialQueue);
    expect(reset[itemId]!.sessionStreak).toBe(0);
    expect(reset['hanja-6A02::hanja_to_input::락']!.status).toBe('completed');
    expect(reset['hanja-6A02::hanja_to_input::락']!.sessionStreak).toBe(2);

    // Normal correct answer NEVER increments needs_review sessionStreak
    const normalCorrect = gradeSubmission(
      qNormal,
      hanChar,
      { meaning: '한나라', sound: '한' },
      't2',
    ).record;
    const afterNormalCorrect = applySessionOutcomeToReviewQueue(
      initialQueue,
      qNormal,
      hanChar,
      normalCorrect,
      's2',
      't2',
    );
    expect(afterNormalCorrect[itemId]!.sessionStreak).toBe(1);

    // Abandoned answer NEVER mutates queue
    const abandoned = createAbandonedAnswer(qNormal, 't3');
    const afterAbandoned = applySessionOutcomeToReviewQueue(
      initialQueue,
      qNormal,
      hanChar,
      abandoned,
      's2',
      't3',
    );
    expect(afterAbandoned).toEqual(initialQueue);

    // Completed item missed in normal session reopens as needs_review preserving history
    const qRakNormal: FrozenQuestion = {
      questionId: 'q-rak',
      characterId: rakChar.id,
      questionType: 'hanja_to_input',
      targetSound: '락',
      targetMeanings: ['즐겁다'],
    };
    const rakWrong = gradeSubmission(
      qRakNormal,
      rakChar,
      { meaning: '즐겁다', sound: '악' },
      't4',
    ).record;
    const reopenedQueue = applySessionOutcomeToReviewQueue(
      initialQueue,
      qRakNormal,
      rakChar,
      rakWrong,
      's3',
      't4',
    );
    const reopened = reopenedQueue['hanja-6A02::hanja_to_input::락']!;
    expect(reopened.status).toBe('needs_review');
    expect(reopened.sessionStreak).toBe(0);
    expect(reopened.lastErrorType).toBe('pair_mismatch');
    expect(reopened.history.map((h) => h.event)).toEqual([
      'registered',
      'completed',
      'reopened',
    ]);
  });

  it('preserves format independently for choice vs input and regenerates MCQ distractors while keeping target pair', () => {
    const qChoice = buildMcqQuestion(store, rakChar, 'hanja_to_choice', {
      targetSound: '락',
      rng: createSeededRng('orig-mcq'),
    })!;
    const qInput: FrozenQuestion = {
      questionId: 'q-rak-input',
      characterId: rakChar.id,
      questionType: 'hanja_to_input',
      targetSound: '락',
      targetMeanings: ['즐겁다'],
    };

    let queue: Record<string, ReviewItem> = {};
    queue = applySessionOutcomeToReviewQueue(
      queue,
      qChoice,
      rakChar,
      gradeSubmission(qChoice, rakChar, { meaning: '즐겁다', sound: qChoice.soundChoices!.find((s) => s !== '락')! }, 't1').record,
      's1',
      't1',
    );
    queue = applySessionOutcomeToReviewQueue(
      queue,
      qInput,
      rakChar,
      gradeSubmission(qInput, rakChar, { meaning: '틀림', sound: '락' }, 't2').record,
      's1',
      't2',
    );

    const choiceId = makeReviewItemId(rakChar.id, 'hanja_to_choice', '락');
    const inputId = makeReviewItemId(rakChar.id, 'hanja_to_input', '락');
    expect(Object.keys(queue)).toEqual([choiceId, inputId]);

    // First review item selected is choice (FIFO) with freshly reconstructed distractors
    const revChoice1 = selectNextReviewQuestion(store, queue, {}, {
      unitIds: [unit01Id],
      rng: createSeededRng('rev-mcq-1'),
    })!;
    const revChoice2 = selectNextReviewQuestion(store, queue, {}, {
      unitIds: [unit01Id],
      rng: createSeededRng('rev-mcq-2'),
    })!;

    expect(revChoice1.questionType).toBe('hanja_to_choice');
    expect(revChoice1.targetSound).toBe('락');
    expect(revChoice1.targetMeanings).toEqual(['즐겁다']);
    expect(revChoice1.meaningChoices).toContain('즐겁다');
    expect(revChoice1.soundChoices).toContain('락');
    // Different RNG seeds regenerate different distractors/order
    expect(revChoice1.soundChoices).not.toEqual(revChoice2.soundChoices);

    // Completing choice item leaves input item untouched
    queue = applySessionOutcomeToReviewQueue(
      queue,
      revChoice1,
      rakChar,
      gradeSubmission(revChoice1, rakChar, { meaning: '즐겁다', sound: '락' }, 't3').record,
      's2',
      't3',
    );
    queue = applySessionOutcomeToReviewQueue(
      queue,
      revChoice2,
      rakChar,
      gradeSubmission(revChoice2, rakChar, { meaning: '즐겁다', sound: '락' }, 't4').record,
      's2',
      't4',
    );
    expect(queue[choiceId]!.status).toBe('completed');
    expect(queue[inputId]!.status).toBe('needs_review');
  });

  it('enforces A -> B -> A spacing and inserts a filler character !== A when only 1 item remains (plus registers missed filler)', () => {
    const unit01Chars = store.getUnitById(unit01Id)!.characterIds;
    const charA = store.getCharacterById(unit01Chars[0]!)!;
    const charB = store.getCharacterById(unit01Chars[1]!)!;
    const idA = makeReviewItemId(charA.id, 'hanja_to_input', charA.readings[0]!.sound);
    const idB = makeReviewItemId(charB.id, 'hanja_to_input', charB.readings[0]!.sound);

    let queue: Record<string, ReviewItem> = {
      [idA]: {
        reviewItemId: idA,
        characterId: charA.id,
        questionType: 'hanja_to_input',
        targetSound: charA.readings[0]!.sound,
        targetMeanings: [...charA.readings[0]!.meanings],
        status: 'needs_review',
        sessionStreak: 0,
        history: [{ at: '2026-11-22T09:00:00Z', event: 'registered', sessionId: 's0' }],
      },
      [idB]: {
        reviewItemId: idB,
        characterId: charB.id,
        questionType: 'hanja_to_input',
        targetSound: charB.readings[0]!.sound,
        targetMeanings: [...charB.readings[0]!.meanings],
        status: 'needs_review',
        sessionStreak: 0,
        history: [{ at: '2026-11-22T09:01:00Z', event: 'registered', sessionId: 's0' }],
      },
    };

    // With A and B both pending, after A is reviewed, B must be picked next
    const first = selectNextReviewQuestion(store, queue, {}, { unitIds: [unit01Id] })!;
    expect(first.reviewItemId).toBe(idA);
    const second = selectNextReviewQuestion(store, queue, {}, {
      unitIds: [unit01Id],
      lastReviewedItemId: idA,
    })!;
    expect(second.reviewItemId).toBe(idB);

    // Complete B, leaving only A with lastReviewedItemId === idA
    queue[idB]!.status = 'completed';
    const filler = selectNextReviewQuestion(store, queue, {}, {
      unitIds: [unit01Id],
      lastReviewedItemId: idA,
      rng: createSeededRng('filler-1'),
    })!;
    expect(filler.isReviewFiller).toBe(true);
    expect(filler.reviewItemId).toBeUndefined();
    expect(filler.characterId).not.toBe(charA.id);

    // If filler is missed, it enters the review queue immediately!
    const fillerChar = store.getCharacterById(filler.characterId)!;
    const fillerWrong = gradeDontKnow(filler, '2026-11-22T10:10:00Z').record;
    queue = applySessionOutcomeToReviewQueue(
      queue,
      filler,
      fillerChar,
      fillerWrong,
      's1',
      '2026-11-22T10:10:00Z',
    );
    const fillerId = makeReviewItemId(
      filler.characterId,
      filler.questionType,
      filler.targetSound,
    );
    expect(queue[fillerId]?.status).toBe('needs_review');

    // Also verify single-char unit falls back to other textbook units for filler
    const singleUnitTextbook: Textbook = {
      ...rawTextbook,
      units: [
        {
          id: 'single-unit',
          number: 1,
          title: '단독',
          sourcePages: [1],
          characterIds: [charA.id],
        },
        ...rawTextbook.units,
      ],
    };
    const singleUnitStore = new CatalogStore(rawCatalog, singleUnitTextbook);
    const fallbackFiller = selectNextReviewQuestion(
      singleUnitStore,
      { [idA]: queue[idA]! },
      {},
      { unitIds: ['single-unit'], lastReviewedItemId: idA, rng: createSeededRng('fb') },
    )!;
    expect(fallbackFiller.isReviewFiller).toBe(true);
    expect(fallbackFiller.characterId).not.toBe(charA.id);
  });
});
