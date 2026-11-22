import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageAdapter } from '../localStorageAdapter';
import { parseSafeBackupJson, validateBackupPayload } from '../backupValidation';
import {
  BackupValidationError,
  type AppBackupPayload,
  type CompletedSessionRecord,
  type UserProfile,
} from '../../types/storage';

function makeProfile(id: string, name: string): UserProfile {
  return {
    id,
    name,
    avatarId: 'rabbit',
    createdAt: '2026-11-22T10:00:00+09:00',
  };
}

function makeCompleted(sessionId: string, completedAt: string): CompletedSessionRecord {
  return {
    sessionId,
    mode: 'normal',
    dataVersion: '0.3.0',
    unitIds: ['chunjae-middle-hanja-2022-ahn-unit-01'],
    selectedTypes: ['hanja_to_choice'],
    score: 38,
    maxScore: 40,
    answeredCount: 20,
    correctCount: 19,
    dontKnowCount: 1,
    abandonedCount: 0,
    answers: [],
    startedAt: completedAt,
    completedAt,
  };
}

describe('Backup validation and import/export round-trip', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips Export -> clear -> Import(replace) with 100% fidelity', async () => {
    const adapter = new LocalStorageAdapter({ storage: window.localStorage });
    await adapter.saveProfile(makeProfile('prof_1', '민수'));
    await adapter.saveProfile(makeProfile('prof_2', '서연'));
    await adapter.setActiveProfileId('prof_2');
    await adapter.recordReadingExposure('prof_1', 'hanja-6F22::한', '2026-11-22T11:00:00+09:00');
    await adapter.appendCompletedSession(
      'prof_2',
      makeCompleted('sess_01', '2026-11-22T11:05:00+09:00'),
    );

    const exported = await adapter.exportBackup();
    const jsonText = JSON.stringify(exported);

    window.localStorage.clear();
    await expect(adapter.listProfiles()).resolves.toEqual([]);

    await adapter.importBackupJson(jsonText, 'replace');

    await expect(adapter.listProfiles()).resolves.toHaveLength(2);
    await expect(adapter.getActiveProfileId()).resolves.toBe('prof_2');
    await expect(adapter.getExposureStats('prof_1')).resolves.toEqual({
      'hanja-6F22::한': {
        readingKey: 'hanja-6F22::한',
        characterId: 'hanja-6F22',
        sound: '한',
        exposureCount: 1,
        lastExposedAt: '2026-11-22T11:00:00+09:00',
      },
    });
    const sessions = await adapter.listCompletedSessions('prof_2');
    expect(sessions.map((s) => s.sessionId)).toEqual(['sess_01']);
  });

  it('supports merge strategy without overwriting existing profiles or sessions', async () => {
    const adapter = new LocalStorageAdapter({ storage: window.localStorage });
    await adapter.saveProfile(makeProfile('prof_1', '민수'));
    await adapter.setActiveProfileId('prof_1');
    await adapter.recordReadingExposure('prof_1', 'hanja-6F22::한', '2026-11-22T09:00:00+09:00');
    await adapter.appendCompletedSession(
      'prof_1',
      makeCompleted('sess_local', '2026-11-22T09:30:00+09:00'),
    );

    const incomingPayload: AppBackupPayload = {
      exportFormat: 'hanja-study-backup',
      exportSchemaVersion: 1,
      exportedAt: '2026-11-22T12:00:00+09:00',
      dataVersion: '0.3.0',
      activeProfileId: 'prof_new',
      profiles: [
        makeProfile('prof_1', '민수'),
        makeProfile('prof_new', '아빠'),
      ],
      states: {
        prof_1: {
          schemaVersion: 1,
          profileId: 'prof_1',
          activeSession: null,
          exposureStats: {
            'hanja-6F22::한': {
              readingKey: 'hanja-6F22::한',
              characterId: 'hanja-6F22',
              sound: '한',
              exposureCount: 3,
              lastExposedAt: '2026-11-22T11:00:00+09:00',
            },
          },
          reviewQueue: {},
          dailyChallenges: {},
          completedSessions: [
            makeCompleted('sess_remote', '2026-11-22T11:30:00+09:00'),
          ],
        },
        prof_new: {
          schemaVersion: 1,
          profileId: 'prof_new',
          activeSession: null,
          exposureStats: {},
          reviewQueue: {},
          dailyChallenges: {},
          completedSessions: [],
        },
      },
    };

    await adapter.importBackup(incomingPayload, 'merge');

    const profiles = await adapter.listProfiles();
    expect(profiles.map((p) => p.id)).toEqual(['prof_1', 'prof_new']);
    await expect(adapter.getActiveProfileId()).resolves.toBe('prof_1');
    const stats = await adapter.getExposureStats('prof_1');
    expect(stats['hanja-6F22::한']!.exposureCount).toBe(3);
    const sessions = await adapter.listCompletedSessions('prof_1');
    expect(sessions.map((s) => s.sessionId)).toEqual(['sess_remote', 'sess_local']);
  });

  it('rejects malformed payloads and prototype pollution without mutating storage', async () => {
    const adapter = new LocalStorageAdapter({ storage: window.localStorage });
    await adapter.saveProfile(makeProfile('prof_keep', '기존프로필'));
    await adapter.setActiveProfileId('prof_keep');

    const invalidFormat = JSON.stringify({
      exportFormat: 'wrong-format',
      exportSchemaVersion: 1,
      exportedAt: '2026-11-22T10:00:00Z',
      dataVersion: '0.3.0',
      activeProfileId: null,
      profiles: [],
      states: {},
    });

    await expect(adapter.importBackupJson(invalidFormat, 'replace')).rejects.toThrow(
      BackupValidationError,
    );

    const protoPollutionJson =
      '{"exportFormat":"hanja-study-backup","exportSchemaVersion":1,"exportedAt":"2026-11-22T10:00:00Z","dataVersion":"0.3.0","activeProfileId":null,"profiles":[],"states":{},"__proto__":{"polluted":true}}';

    expect(() => parseSafeBackupJson(protoPollutionJson)).toThrow(
      BackupValidationError,
    );
    await expect(
      adapter.importBackupJson(protoPollutionJson, 'replace'),
    ).rejects.toThrow(BackupValidationError);

    const nestedConstructorPollution = JSON.stringify({
      exportFormat: 'hanja-study-backup',
      exportSchemaVersion: 1,
      exportedAt: '2026-11-22T10:00:00Z',
      dataVersion: '0.3.0',
      activeProfileId: null,
      profiles: [],
      states: {
        constructor: {},
      },
    });
    expect(() => parseSafeBackupJson(nestedConstructorPollution)).toThrow(
      BackupValidationError,
    );

    // Pre-parsed object with own __proto__ property also rejected
    const objWithOwnProto = JSON.parse(protoPollutionJson) as unknown;
    expect(() => validateBackupPayload(objWithOwnProto)).toThrow(
      BackupValidationError,
    );

    // Existing storage remained untouched
    const profiles = await adapter.listProfiles();
    expect(profiles.map((p) => p.id)).toEqual(['prof_keep']);
    await expect(adapter.getActiveProfileId()).resolves.toBe('prof_keep');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('preserves M2 optional fields on FrozenQuestion, AnswerRecord, and SessionSnapshot during round-trip', async () => {
    const adapter = new LocalStorageAdapter({ storage: window.localStorage });
    await adapter.saveProfile(makeProfile('prof_m2', '지민'));
    await adapter.setActiveProfileId('prof_m2');

    await adapter.saveActiveSession('prof_m2', {
      sessionId: 'review_m2_01',
      mode: 'review',
      dataVersion: '0.3.0',
      unitIds: ['chunjae-middle-hanja-2022-ahn-unit-01'],
      selectedTypes: ['hanja_to_choice', 'reading_to_choice'],
      questions: [
        {
          questionId: 'rev-1',
          characterId: 'hanja-6A02',
          questionType: 'hanja_to_choice',
          targetSound: '락',
          targetMeanings: ['즐겁다'],
          correctMeaning: '즐겁다',
          meaningChoices: ['즐겁다', '하늘', '땅', '물'],
          soundChoices: ['락', '천', '지', '수'],
          reviewItemId: 'hanja-6A02::hanja_to_choice::락',
        },
        {
          questionId: 'rev-2',
          characterId: 'hanja-6F22',
          questionType: 'reading_to_choice',
          targetSound: '한',
          targetMeanings: ['한나라'],
          characterChoices: ['hanja-6F22', 'hanja-65E5', 'hanja-6708', 'hanja-706B'],
          isReviewFiller: true,
        },
      ],
      currentIndex: 1,
      exposedQuestionIds: ['rev-1', 'rev-2'],
      answers: [
        {
          questionId: 'rev-1',
          characterId: 'hanja-6A02',
          questionType: 'hanja_to_choice',
          targetSound: '락',
          score: 0,
          outcome: 'incorrect',
          meaningCorrect: true,
          soundCorrect: false,
          pairMatched: false,
          errorType: 'sound_error',
          submittedMeaning: '즐겁다',
          submittedSound: '천',
          submittedAt: '2026-11-22T12:00:00Z',
        },
        {
          questionId: 'rev-2',
          characterId: 'hanja-6F22',
          questionType: 'reading_to_choice',
          targetSound: '한',
          score: 2,
          outcome: 'correct',
          submittedCharacterId: 'hanja-6F22',
          submittedAt: '2026-11-22T12:00:10Z',
        },
      ],
      lastReviewedItemId: 'hanja-6A02::hanja_to_choice::락',
      startedAt: '2026-11-22T11:59:00Z',
      updatedAt: '2026-11-22T12:00:10Z',
    });

    const exported = await adapter.exportBackup();
    const jsonText = JSON.stringify(exported);

    window.localStorage.clear();
    await adapter.importBackupJson(jsonText, 'replace');

    const restored = await adapter.getActiveSession('prof_m2');
    expect(restored).not.toBeNull();
    expect(restored!.lastReviewedItemId).toBe('hanja-6A02::hanja_to_choice::락');
    expect(restored!.questions[0]!.correctMeaning).toBe('즐겁다');
    expect(restored!.questions[1]!.isReviewFiller).toBe(true);
    expect(restored!.answers[0]!.submittedMeaning).toBe('즐겁다');
    expect(restored!.answers[0]!.submittedSound).toBe('천');
    expect(restored!.answers[1]!.submittedCharacterId).toBe('hanja-6F22');
  });

  it('rolls back atomically if QuotaExceededError occurs mid-import', async () => {
    const backing = new Map<string, string>();
    let failOnKeyPrefix: string | null = null;

    const mockStorage: Storage = {
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
        if (failOnKeyPrefix && k.startsWith(failOnKeyPrefix)) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
        backing.set(k, v);
      },
    };

    const adapter = new LocalStorageAdapter({ storage: mockStorage });
    await adapter.saveProfile(makeProfile('prof_orig', '원본'));
    await adapter.setActiveProfileId('prof_orig');

    const incoming: AppBackupPayload = {
      exportFormat: 'hanja-study-backup',
      exportSchemaVersion: 1,
      exportedAt: '2026-11-22T12:00:00+09:00',
      dataVersion: '0.3.0',
      activeProfileId: 'prof_new',
      profiles: [makeProfile('prof_new', '새프로필')],
      states: {
        prof_new: {
          schemaVersion: 1,
          profileId: 'prof_new',
          activeSession: null,
          exposureStats: {},
          reviewQueue: {},
          dailyChallenges: {},
          completedSessions: [],
        },
      },
    };

    failOnKeyPrefix = 'hanja_study_v1_state_prof_new';
    await expect(adapter.importBackup(incoming, 'replace')).rejects.toThrow();

    failOnKeyPrefix = null;
    await expect(adapter.listProfiles()).resolves.toMatchObject([
      { id: 'prof_orig', name: '원본' },
    ]);
    await expect(adapter.getActiveProfileId()).resolves.toBe('prof_orig');
  });
});
