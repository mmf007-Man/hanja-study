import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogStore, TEXTBOOK_ID } from '../../data/catalogStore';
import { LocalStorageAdapter } from '../../storage/localStorageAdapter';
import type { CharacterCatalog, Textbook } from '../../types/catalog';
import type { FrozenQuestion } from '../../types/storage';
import type { AnswerDraft } from '../gradingEngine';
import { createSeededRng } from '../prng';
import { makeReadingKey } from '../questionGenerator';
import { makeReviewItemId } from '../reviewQueueEngine';
import { ActiveSessionConflictError, SessionEngine } from '../sessionEngine';

const DATA_DIR = path.resolve(process.cwd(), 'data');

function loadRealCatalog(): CatalogStore {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'characters.json'), 'utf-8'),
  ) as CharacterCatalog;
  const textbook = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, `textbooks/${TEXTBOOK_ID}.json`), 'utf-8'),
  ) as Textbook;
  return new CatalogStore(catalog, textbook);
}

function makeCorrectDraft(store: CatalogStore, q: FrozenQuestion): AnswerDraft {
  const ch = store.getCharacterById(q.characterId)!;
  switch (q.questionType) {
    case 'hanja_to_choice':
      return {
        meaning: q.correctMeaning ?? q.targetMeanings[0]!,
        sound: q.targetSound,
      };
    case 'hanja_to_input':
      return {
        meaning: ch.readings[0]!.meanings[0]!,
        sound: ch.readings[0]!.sound,
      };
    case 'reading_to_choice':
      return { characterId: q.characterId };
    case 'reading_to_write':
      return { completed: true, strokeGuideUsed: false };
  }
}

function makeWrongDraft(store: CatalogStore, q: FrozenQuestion): AnswerDraft {
  const ch = store.getCharacterById(q.characterId)!;
  switch (q.questionType) {
    case 'hanja_to_choice': {
      const wrongMeaning = q.meaningChoices!.find(
        (m) => m !== (q.correctMeaning ?? q.targetMeanings[0]),
      )!;
      return { meaning: wrongMeaning, sound: q.targetSound };
    }
    case 'hanja_to_input':
      return { meaning: '오답뜻', sound: ch.readings[0]!.sound };
    case 'reading_to_choice': {
      const wrongCharId = q.characterChoices!.find((id) => id !== q.characterId)!;
      return { characterId: wrongCharId };
    }
    case 'reading_to_write':
      return { completed: false, strokeGuideUsed: true };
  }
}

describe('SessionEngine', () => {
  const store = loadRealCatalog();
  const unit01Id = `${TEXTBOOK_ID}-unit-01`;
  let adapter: LocalStorageAdapter;
  let engine: SessionEngine;

  beforeEach(async () => {
    window.localStorage.clear();
    adapter = new LocalStorageAdapter({ storage: window.localStorage });
    await adapter.saveProfile({
      id: 'prof_a',
      name: '민수',
      avatarId: 'tiger',
      createdAt: '2026-11-22T09:00:00Z',
    });
    await adapter.saveProfile({
      id: 'prof_b',
      name: '서연',
      avatarId: 'rabbit',
      createdAt: '2026-11-22T09:00:00Z',
    });
    engine = new SessionEngine(store, adapter);
  });

  it('preserves question order and MCQ choices on mid-session reload without duplicating exposureCount', async () => {
    const started = await engine.startNormalSession('prof_a', {
      unitIds: [unit01Id],
      selectedTypes: ['hanja_to_choice', 'hanja_to_input'],
      rng: createSeededRng('resume-test'),
      nowIso: '2026-11-22T10:00:00Z',
    });

    // Generation alone does NOT increment exposureCount
    expect(await adapter.getExposureStats('prof_a')).toEqual({});

    // Expose Q1 and Q2, submit Q1, re-expose Q2 (simulating page reload)
    const q1 = started.questions[0]!;
    const q2 = started.questions[1]!;

    await engine.markQuestionExposed('prof_a', q1.questionId, '2026-11-22T10:00:10Z');
    await engine.submitAnswer(
      'prof_a',
      q1.questionId,
      makeCorrectDraft(store, q1),
      '2026-11-22T10:00:20Z',
    );
    await engine.markQuestionExposed('prof_a', q2.questionId, '2026-11-22T10:00:30Z');

    // Simulate reload with fresh adapter/engine instance
    const reloadedAdapter = new LocalStorageAdapter({ storage: window.localStorage });
    const reloadedEngine = new SessionEngine(store, reloadedAdapter);

    const resumed = (await reloadedEngine.getActiveSession('prof_a'))!;
    expect(resumed).not.toBeNull();
    expect(resumed.questions).toEqual(started.questions);
    expect(resumed.answers).toHaveLength(1);
    expect(resumed.currentIndex).toBe(1);

    // Calling markQuestionExposed again on already-exposed Q2 must NOT increment exposureCount
    await reloadedEngine.markQuestionExposed(
      'prof_a',
      q2.questionId,
      '2026-11-22T10:01:00Z',
    );
    const stats = await reloadedAdapter.getExposureStats('prof_a');
    expect(
      stats[makeReadingKey(q1.characterId, q1.targetSound)]!.exposureCount,
    ).toBe(1);
    expect(
      stats[makeReadingKey(q2.characterId, q2.targetSound)]!.exposureCount,
    ).toBe(1);
    expect(
      stats[makeReadingKey(q2.characterId, q2.targetSound)]!.lastExposedAt,
    ).toBe('2026-11-22T10:00:30Z');

    // Duplicate submission on Q1 is rejected
    await expect(
      reloadedEngine.submitAnswer(
        'prof_a',
        q1.questionId,
        makeCorrectDraft(store, q1),
      ),
    ).rejects.toThrow();
  });

  it('handles active session conflict vs forceReplace and marks exposed-unanswered questions as abandoned on early finish', async () => {
    const session = await engine.startNormalSession('prof_a', {
      unitIds: [unit01Id],
      selectedTypes: ['hanja_to_input'],
      rng: createSeededRng('abandon-test'),
      nowIso: '2026-11-22T10:00:00Z',
    });

    // Starting another session without forceReplace throws ActiveSessionConflictError
    await expect(
      engine.startNormalSession('prof_a', {
        unitIds: [unit01Id],
        selectedTypes: ['hanja_to_input'],
      }),
    ).rejects.toThrow(ActiveSessionConflictError);

    // Q1 exposed & answered, Q2 exposed & unanswered, Q3..Q20 unexposed
    const q1 = session.questions[0]!;
    const q2 = session.questions[1]!;
    await engine.markQuestionExposed('prof_a', q1.questionId, '2026-11-22T10:00:10Z');
    await engine.submitAnswer(
      'prof_a',
      q1.questionId,
      makeCorrectDraft(store, q1),
      '2026-11-22T10:00:20Z',
    );
    await engine.markQuestionExposed('prof_a', q2.questionId, '2026-11-22T10:00:30Z');

    const completed = await engine.finishSession('prof_a', '2026-11-22T10:01:00Z');
    expect(await engine.getActiveSession('prof_a')).toBeNull();
    expect(completed.answers).toHaveLength(2);
    expect(completed.answeredCount).toBe(1);
    expect(completed.correctCount).toBe(1);
    expect(completed.abandonedCount).toBe(1);
    expect(completed.score).toBe(2);
    expect(completed.maxScore).toBe(2);
    expect(completed.answers[1]).toMatchObject({
      questionId: q2.questionId,
      outcome: 'abandoned',
      errorType: 'abandoned',
      score: 0,
    });

    // Abandoned question must NOT enter reviewQueue
    const reviewQueue = await adapter.getReviewQueue('prof_a');
    expect(Object.keys(reviewQueue)).toHaveLength(0);

    // forceReplace abandons old session and starts new one
    await engine.startNormalSession('prof_a', {
      unitIds: [unit01Id],
      selectedTypes: ['hanja_to_choice'],
      forceReplace: true,
    });
    const replaced = await engine.startNormalSession('prof_a', {
      unitIds: [unit01Id],
      selectedTypes: ['reading_to_choice'],
      forceReplace: true,
    });
    expect(replaced.selectedTypes).toEqual(['reading_to_choice']);
  });

  it('gives identical daily challenge questions across profiles, isolates states, and preserves first daily record on replay', async () => {
    const dailyA = await engine.startDailySession('prof_a', {
      dateKey: '2026-11-22',
      nowIso: '2026-11-22T09:00:00Z',
    });
    const dailyB = await engine.startDailySession('prof_b', {
      dateKey: '2026-11-22',
      nowIso: '2026-11-22T09:05:00Z',
    });

    expect(dailyA.questions).toEqual(dailyB.questions);
    expect(dailyA.questions).toHaveLength(20);

    // Complete all 20 questions for prof_a with 18 correct + 2 wrong
    for (let i = 0; i < dailyA.questions.length; i += 1) {
      const q = dailyA.questions[i]!;
      await engine.markQuestionExposed('prof_a', q.questionId, '2026-11-22T09:01:00Z');
      const draft =
        i < 18 ? makeCorrectDraft(store, q) : makeWrongDraft(store, q);
      await engine.submitAnswer('prof_a', q.questionId, draft, '2026-11-22T09:01:10Z');
    }
    await engine.finishSession('prof_a', '2026-11-22T09:05:00Z');

    const firstRecord = (await adapter.getDailyChallenge('prof_a', '2026-11-22'))!;
    expect(firstRecord).not.toBeNull();
    expect(firstRecord.score).toBe(36);
    expect(firstRecord.maxScore).toBe(40);
    expect(firstRecord.correctCount).toBe(18);
    expect(firstRecord.totalCount).toBe(20);

    // Profile B remains unaffected
    expect(await adapter.getDailyChallenge('prof_b', '2026-11-22')).toBeNull();
    expect(Object.keys(await adapter.getReviewQueue('prof_b'))).toHaveLength(0);
    expect(Object.keys(await adapter.getReviewQueue('prof_a'))).toHaveLength(2);

    // Replay daily challenge for prof_a with 20/20: must NOT overwrite first official record
    const replay = await engine.startDailySession('prof_a', {
      dateKey: '2026-11-22',
      nowIso: '2026-11-22T12:00:00Z',
    });
    for (const q of replay.questions) {
      await engine.markQuestionExposed('prof_a', q.questionId, '2026-11-22T12:01:00Z');
      await engine.submitAnswer(
        'prof_a',
        q.questionId,
        makeCorrectDraft(store, q),
        '2026-11-22T12:01:10Z',
      );
    }
    await engine.finishSession('prof_a', '2026-11-22T12:05:00Z');

    const afterReplay = (await adapter.getDailyChallenge('prof_a', '2026-11-22'))!;
    expect(afterReplay).toEqual(firstRecord);
  });

  it('runs a full end-to-end review session with spacing and filler until all items graduate', async () => {
    // Seed 2 wrong answers in a normal session
    const normal = await engine.startNormalSession('prof_a', {
      unitIds: [unit01Id],
      selectedTypes: ['hanja_to_choice'],
      questionCount: 2,
      rng: createSeededRng('e2e-review'),
      nowIso: '2026-11-22T10:00:00Z',
    });

    const q1 = normal.questions[0]!;
    const q2 = normal.questions[1]!;
    await engine.markQuestionExposed('prof_a', q1.questionId, '2026-11-22T10:00:10Z');
    await engine.submitAnswer(
      'prof_a',
      q1.questionId,
      makeWrongDraft(store, q1),
      '2026-11-22T10:00:15Z',
    );
    await engine.markQuestionExposed('prof_a', q2.questionId, '2026-11-22T10:00:20Z');
    await engine.submitDontKnow('prof_a', q2.questionId, '2026-11-22T10:00:25Z');
    await engine.finishSession('prof_a', '2026-11-22T10:00:30Z');

    const revSession = await engine.startReviewSession('prof_a', {
      unitIds: [unit01Id],
      rng: createSeededRng('e2e-rev-start'),
      nowIso: '2026-11-22T10:05:00Z',
    });

    let currentSession = revSession;
    let steps = 0;
    let sawFiller = false;
    const sequence: Array<string | undefined> = [];

    while (steps < 20) {
      const activeQ = currentSession.questions[currentSession.currentIndex]!;
      sequence.push(activeQ.reviewItemId);
      if (activeQ.isReviewFiller) {
        sawFiller = true;
      }

      await engine.markQuestionExposed(
        'prof_a',
        activeQ.questionId,
        '2026-11-22T10:06:00Z',
      );
      const res = await engine.submitAnswer(
        'prof_a',
        activeQ.questionId,
        makeCorrectDraft(store, activeQ),
        '2026-11-22T10:06:05Z',
      );
      steps += 1;
      currentSession = res.session;
      if (res.isSessionComplete) {
        break;
      }
    }

    const finished = await engine.finishSession('prof_a', '2026-11-22T10:10:00Z');
    expect(finished.mode).toBe('review');
    // 2 items x 2 consecutive passes = 4 review questions, and if last item needed spacing -> filler (5)
    expect(steps).toBeGreaterThanOrEqual(4);
    expect(steps).toBeLessThanOrEqual(5);
    if (steps === 5) {
      expect(sawFiller).toBe(true);
    }

    // Never consecutive identical reviewItemId
    for (let i = 1; i < sequence.length; i += 1) {
      if (sequence[i] !== undefined && sequence[i - 1] !== undefined) {
        expect(sequence[i]).not.toBe(sequence[i - 1]);
      }
    }

    const finalQueue = await adapter.getReviewQueue('prof_a');
    const id1 = makeReviewItemId(q1.characterId, q1.questionType, q1.targetSound);
    const id2 = makeReviewItemId(q2.characterId, q2.questionType, q2.targetSound);
    expect(finalQueue[id1]!.status).toBe('completed');
    expect(finalQueue[id2]!.status).toBe('completed');

    // Starting review session when nothing needs review throws
    await expect(engine.startReviewSession('prof_a')).rejects.toThrow();
  });

  it('inserts a filler question when 1 review item remains and graduates after A -> filler -> A', async () => {
    const normal = await engine.startNormalSession('prof_b', {
      unitIds: [unit01Id],
      selectedTypes: ['hanja_to_input'],
      questionCount: 1,
      rng: createSeededRng('single-review-e2e'),
      nowIso: '2026-11-22T10:00:00Z',
    });
    const q1 = normal.questions[0]!;
    await engine.markQuestionExposed('prof_b', q1.questionId, '2026-11-22T10:00:10Z');
    await engine.submitAnswer(
      'prof_b',
      q1.questionId,
      makeWrongDraft(store, q1),
      '2026-11-22T10:00:15Z',
    );
    await engine.finishSession('prof_b', '2026-11-22T10:00:20Z');

    let rev = await engine.startReviewSession('prof_b', {
      unitIds: [unit01Id],
      rng: createSeededRng('single-rev-flow'),
      nowIso: '2026-11-22T10:05:00Z',
    });

    // Step 1: A (correct -> streak 1)
    const step1Q = rev.questions[rev.currentIndex]!;
    expect(step1Q.characterId).toBe(q1.characterId);
    await engine.markQuestionExposed('prof_b', step1Q.questionId, '2026-11-22T10:05:10Z');
    const res1 = await engine.submitAnswer(
      'prof_b',
      step1Q.questionId,
      makeCorrectDraft(store, step1Q),
      '2026-11-22T10:05:15Z',
    );
    expect(res1.isSessionComplete).toBe(false);
    rev = res1.session;

    // Step 2: filler !== A
    const step2Q = rev.questions[rev.currentIndex]!;
    expect(step2Q.isReviewFiller).toBe(true);
    expect(step2Q.characterId).not.toBe(q1.characterId);
    await engine.markQuestionExposed('prof_b', step2Q.questionId, '2026-11-22T10:05:20Z');
    const res2 = await engine.submitAnswer(
      'prof_b',
      step2Q.questionId,
      makeCorrectDraft(store, step2Q),
      '2026-11-22T10:05:25Z',
    );
    expect(res2.isSessionComplete).toBe(false);
    rev = res2.session;

    // Step 3: A again (correct -> streak 2 -> completed!)
    const step3Q = rev.questions[rev.currentIndex]!;
    expect(step3Q.characterId).toBe(q1.characterId);
    expect(step3Q.isReviewFiller).toBeUndefined();
    await engine.markQuestionExposed('prof_b', step3Q.questionId, '2026-11-22T10:05:30Z');
    const res3 = await engine.submitAnswer(
      'prof_b',
      step3Q.questionId,
      makeCorrectDraft(store, step3Q),
      '2026-11-22T10:05:35Z',
    );
    expect(res3.isSessionComplete).toBe(true);

    const completed = await engine.finishSession('prof_b', '2026-11-22T10:06:00Z');
    expect(completed.answers).toHaveLength(3);
    const id1 = makeReviewItemId(q1.characterId, q1.questionType, q1.targetSound);
    expect((await adapter.getReviewQueue('prof_b'))[id1]!.status).toBe('completed');
  });
});
