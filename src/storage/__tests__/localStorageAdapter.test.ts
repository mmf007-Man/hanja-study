import { beforeEach, describe, expect, it } from 'vitest';
import {
  LocalStorageAdapter,
  MAX_COMPLETED_SESSIONS,
} from '../localStorageAdapter';
import {
  ProfileValidationError,
  StorageQuotaExceededError,
  type CompletedSessionRecord,
  type DailyChallengeRecord,
  type ReviewItem,
  type SessionSnapshot,
  type UserProfile,
} from '../../types/storage';

function makeProfile(id: string, name: string): UserProfile {
  return {
    id,
    name,
    avatarId: 'tiger',
    createdAt: '2026-11-22T10:00:00+09:00',
  };
}

function makeSessionSnapshot(sessionId: string): SessionSnapshot {
  return {
    sessionId,
    mode: 'normal',
    dataVersion: '0.3.0',
    unitIds: ['chunjae-middle-hanja-2022-ahn-unit-01'],
    selectedTypes: ['hanja_to_choice'],
    questions: [
      {
        questionId: `${sessionId}-q1`,
        characterId: 'hanja-6F22',
        questionType: 'hanja_to_choice',
        targetSound: '한',
        targetMeanings: ['한나라'],
        meaningChoices: ['한나라', '글자', '글월', '아들'],
        soundChoices: ['한', '자', '문', '자'],
      },
    ],
    currentIndex: 0,
    exposedQuestionIds: [`${sessionId}-q1`],
    answers: [],
    startedAt: '2026-11-22T10:00:00+09:00',
    updatedAt: '2026-11-22T10:01:00+09:00',
  };
}

function makeCompletedSession(
  index: number,
): CompletedSessionRecord {
  const iso = new Date(Date.UTC(2026, 10, 22, 0, index, 0)).toISOString();
  return {
    sessionId: `sess_${String(index).padStart(3, '0')}`,
    mode: 'normal',
    dataVersion: '0.3.0',
    unitIds: ['chunjae-middle-hanja-2022-ahn-unit-01'],
    selectedTypes: ['hanja_to_choice'],
    score: 40,
    maxScore: 40,
    answeredCount: 20,
    correctCount: 20,
    dontKnowCount: 0,
    abandonedCount: 0,
    answers: [],
    startedAt: iso,
    completedAt: iso,
  };
}

describe('LocalStorageAdapter', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('supports profile CRUD, name trimming (1~12 chars), and active profile fallback on delete', async () => {
    const adapter = new LocalStorageAdapter({ storage: window.localStorage });

    await expect(adapter.listProfiles()).resolves.toEqual([]);
    await expect(adapter.getActiveProfileId()).resolves.toBeNull();

    // Name validation
    await expect(
      adapter.saveProfile(makeProfile('p1', '   ')),
    ).rejects.toThrow(ProfileValidationError);
    await expect(
      adapter.saveProfile(makeProfile('p1', '가나다라마바사아자차카타파')),
    ).rejects.toThrow(ProfileValidationError);

    const savedA = await adapter.saveProfile(makeProfile('prof_a', '  민수  '));
    expect(savedA.name).toBe('민수');
    const savedB = await adapter.saveProfile(makeProfile('prof_b', '가나다라마바사아자차카타'));
    expect(savedB.name).toBe('가나다라마바사아자차카타');

    await adapter.setActiveProfileId('prof_a');
    await expect(adapter.getActiveProfileId()).resolves.toBe('prof_a');

    await expect(adapter.setActiveProfileId('missing')).rejects.toThrow(
      ProfileValidationError,
    );

    await adapter.deleteProfile('prof_a');
    await expect(adapter.listProfiles()).resolves.toEqual([savedB]);
    await expect(adapter.getActiveProfileId()).resolves.toBe('prof_b');

    await adapter.deleteProfile('prof_b');
    await expect(adapter.getActiveProfileId()).resolves.toBeNull();
  });

  it('completely isolates sessions, exposure stats, review queue, and daily challenges per profile', async () => {
    const adapter = new LocalStorageAdapter({ storage: window.localStorage });
    await adapter.saveProfile(makeProfile('prof_a', '민수'));
    await adapter.saveProfile(makeProfile('prof_b', '지영'));

    const sessionA = makeSessionSnapshot('sess_a');
    await adapter.saveActiveSession('prof_a', sessionA);
    await adapter.recordReadingExposure('prof_a', 'hanja-6A02::락', '2026-11-22T10:05:00+09:00');
    await adapter.recordReadingExposure('prof_a', 'hanja-6A02::락', '2026-11-22T10:06:00+09:00');

    const reviewA: ReviewItem = {
      reviewItemId: 'hanja-6A02::hanja_to_choice::락',
      characterId: 'hanja-6A02',
      questionType: 'hanja_to_choice',
      targetSound: '락',
      targetMeanings: ['즐겁다'],
      status: 'needs_review',
      sessionStreak: 0,
      lastErrorType: 'meaning_error',
      history: [
        {
          at: '2026-11-22T10:06:00+09:00',
          event: 'registered',
          sessionId: 'sess_a',
          errorType: 'meaning_error',
        },
      ],
    };
    await adapter.upsertReviewItems('prof_a', [reviewA]);

    const dailyA: DailyChallengeRecord = {
      dateKey: '2026-11-22',
      sessionId: 'daily_a',
      dataVersion: '0.3.0',
      score: 36,
      maxScore: 40,
      correctCount: 18,
      totalCount: 20,
      durationMs: 120000,
      completedAt: '2026-11-22T10:15:00+09:00',
    };
    await adapter.saveDailyChallenge('prof_a', dailyA);

    // Profile A state verified
    await expect(adapter.getActiveSession('prof_a')).resolves.toEqual(sessionA);
    await expect(adapter.getExposureStats('prof_a')).resolves.toEqual({
      'hanja-6A02::락': {
        readingKey: 'hanja-6A02::락',
        characterId: 'hanja-6A02',
        sound: '락',
        exposureCount: 2,
        lastExposedAt: '2026-11-22T10:06:00+09:00',
      },
    });
    await expect(adapter.getReviewQueue('prof_a')).resolves.toEqual({
      [reviewA.reviewItemId]: reviewA,
    });
    await expect(adapter.getDailyChallenge('prof_a', '2026-11-22')).resolves.toEqual(dailyA);

    // Profile B remains completely empty/isolated
    await expect(adapter.getActiveSession('prof_b')).resolves.toBeNull();
    await expect(adapter.getExposureStats('prof_b')).resolves.toEqual({});
    await expect(adapter.getReviewQueue('prof_b')).resolves.toEqual({});
    await expect(adapter.getDailyChallenge('prof_b', '2026-11-22')).resolves.toBeNull();

    await adapter.clearActiveSession('prof_a');
    await expect(adapter.getActiveSession('prof_a')).resolves.toBeNull();
  });

  it('enforces the 100-session cap on completedSessions', async () => {
    const adapter = new LocalStorageAdapter({ storage: window.localStorage });
    await adapter.saveProfile(makeProfile('prof_a', '민수'));

    for (let i = 1; i <= 105; i += 1) {
      await adapter.appendCompletedSession('prof_a', makeCompletedSession(i));
    }

    const allStored = await adapter.listCompletedSessions('prof_a');
    expect(allStored).toHaveLength(MAX_COMPLETED_SESSIONS);
    expect(allStored[0]!.sessionId).toBe('sess_105');
    expect(allStored[99]!.sessionId).toBe('sess_006');

    const top3 = await adapter.listCompletedSessions('prof_a', 3);
    expect(top3.map((s) => s.sessionId)).toEqual(['sess_105', 'sess_104', 'sess_103']);
  });

  it('computes storage usage warning at >=80% and wraps DOMException QuotaExceededError', async () => {
    const smallQuotaAdapter = new LocalStorageAdapter({
      storage: window.localStorage,
      quotaBytes: 1200,
    });
    await smallQuotaAdapter.saveProfile(makeProfile('prof_a', '민수'));
    const usageBefore = await smallQuotaAdapter.getStorageUsageInfo();
    expect(usageBefore.isWarning).toBe(false);

    // Add enough data to cross 80% of 1200 bytes (960 bytes)
    await smallQuotaAdapter.saveActiveSession('prof_a', makeSessionSnapshot('sess_big'));
    const usageAfter = await smallQuotaAdapter.getStorageUsageInfo();
    expect(usageAfter.usageRatio).toBeGreaterThanOrEqual(0.8);
    expect(usageAfter.isWarning).toBe(true);

    // Simulate QuotaExceededError on setItem
    const backing = new Map<string, string>();
    let throwQuota = false;
    const quotaStorage: Storage = {
      get length() {
        return backing.size;
      },
      clear: () => backing.clear(),
      getItem: (k) => backing.get(k) ?? null,
      key: (idx) => Array.from(backing.keys())[idx] ?? null,
      removeItem: (k) => {
        backing.delete(k);
      },
      setItem: (k, v) => {
        if (throwQuota) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
        backing.set(k, v);
      },
    };

    const quotaAdapter = new LocalStorageAdapter({ storage: quotaStorage });
    await quotaAdapter.saveProfile(makeProfile('prof_q', '테스트'));

    throwQuota = true;
    await expect(
      quotaAdapter.saveActiveSession('prof_q', makeSessionSnapshot('sess_fail')),
    ).rejects.toThrow(StorageQuotaExceededError);
  });
});
