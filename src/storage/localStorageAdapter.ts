import {
  BACKUP_EXPORT_FORMAT,
  BACKUP_EXPORT_SCHEMA_VERSION,
  PROFILE_STATE_SCHEMA_VERSION,
  normalizeAndValidateProfileName,
  parseSafeBackupJson,
  validateBackupPayload,
} from './backupValidation';
import type { StorageAdapter } from './storageAdapter';
import {
  ProfileValidationError,
  StorageQuotaExceededError,
  type AppBackupPayload,
  type CompletedSessionRecord,
  type DailyChallengeRecord,
  type ProfileLearningState,
  type ReadingExposureStat,
  type ReviewHistoryEntry,
  type ReviewItem,
  type SessionSnapshot,
  type StorageMeta,
  type StorageUsageInfo,
  type UserProfile,
} from '../types/storage';

export const STORAGE_PREFIX = 'hanja_study_v1_';
export const META_STORAGE_KEY = `${STORAGE_PREFIX}meta`;
export const PROFILES_STORAGE_KEY = `${STORAGE_PREFIX}profiles`;
export const STATE_STORAGE_KEY_PREFIX = `${STORAGE_PREFIX}state_`;

export const MAX_COMPLETED_SESSIONS = 100;
export const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024;
export const STORAGE_WARNING_RATIO = 0.8;
export const DEFAULT_DATA_VERSION = '0.3.0';

export interface LocalStorageAdapterOptions {
  storage?: Storage;
  dataVersion?: string;
  quotaBytes?: number;
}

function getStateKey(profileId: string): string {
  return `${STATE_STORAGE_KEY_PREFIX}${profileId}`;
}

function createDefaultMeta(): StorageMeta {
  return {
    schemaVersion: 1,
    activeProfileId: null,
    tolerancePreset: 'normal',
  };
}

function createEmptyProfileState(profileId: string): ProfileLearningState {
  return {
    schemaVersion: PROFILE_STATE_SCHEMA_VERSION,
    profileId,
    activeSession: null,
    exposureStats: {},
    reviewQueue: {},
    dailyChallenges: {},
    completedSessions: [],
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isQuotaExceededError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014
    );
  }
  if (error && typeof error === 'object' && 'name' in error) {
    const errName = (error as { name?: unknown }).name;
    return (
      errName === 'QuotaExceededError' ||
      errName === 'NS_ERROR_DOM_QUOTA_REACHED'
    );
  }
  return false;
}

function parseReadingKey(readingKey: string): { characterId: string; sound: string } {
  const sepIndex = readingKey.indexOf('::');
  if (sepIndex <= 0 || sepIndex >= readingKey.length - 2) {
    throw new Error(`유효하지 않은 readingKey 형식입니다: ${readingKey}`);
  }
  return {
    characterId: readingKey.slice(0, sepIndex),
    sound: readingKey.slice(sepIndex + 2),
  };
}

function mergeProfileStates(
  existing: ProfileLearningState,
  incoming: ProfileLearningState,
): ProfileLearningState {
  const mergedExposure: Record<string, ReadingExposureStat> = cloneJson(
    existing.exposureStats,
  );
  for (const [key, incStat] of Object.entries(incoming.exposureStats)) {
    const curStat = mergedExposure[key];
    if (!curStat) {
      mergedExposure[key] = cloneJson(incStat);
      continue;
    }
    const latestExposedAt = [curStat.lastExposedAt, incStat.lastExposedAt]
      .filter((ts): ts is string => ts !== null)
      .sort()
      .at(-1) ?? null;
    mergedExposure[key] = {
      readingKey: key,
      characterId: curStat.characterId,
      sound: curStat.sound,
      exposureCount: Math.max(curStat.exposureCount, incStat.exposureCount),
      lastExposedAt: latestExposedAt,
    };
  }

  const mergedReviewQueue: Record<string, ReviewItem> = cloneJson(
    existing.reviewQueue,
  );
  for (const [key, incItem] of Object.entries(incoming.reviewQueue)) {
    const curItem = mergedReviewQueue[key];
    if (!curItem) {
      mergedReviewQueue[key] = cloneJson(incItem);
      continue;
    }
    const historyByKey = new Map<string, ReviewHistoryEntry>();
    for (const h of [...curItem.history, ...incItem.history]) {
      historyByKey.set(`${h.at}::${h.event}::${h.sessionId}`, cloneJson(h));
    }
    const mergedHistory = Array.from(historyByKey.values()).sort((a, b) =>
      a.at.localeCompare(b.at),
    );
    const curLastAt = curItem.history.at(-1)?.at ?? '';
    const incLastAt = incItem.history.at(-1)?.at ?? '';
    const latestItem = incLastAt > curLastAt ? incItem : curItem;

    mergedReviewQueue[key] = {
      ...cloneJson(latestItem),
      history: mergedHistory,
    };
  }

  const mergedDaily: Record<string, DailyChallengeRecord> = cloneJson(
    existing.dailyChallenges,
  );
  for (const [dateKey, incDaily] of Object.entries(incoming.dailyChallenges)) {
    const curDaily = mergedDaily[dateKey];
    if (!curDaily || incDaily.completedAt > curDaily.completedAt) {
      mergedDaily[dateKey] = cloneJson(incDaily);
    }
  }

  const sessionMap = new Map<string, CompletedSessionRecord>();
  for (const session of [...existing.completedSessions, ...incoming.completedSessions]) {
    if (!sessionMap.has(session.sessionId)) {
      sessionMap.set(session.sessionId, cloneJson(session));
    }
  }
  const mergedCompleted = Array.from(sessionMap.values())
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, MAX_COMPLETED_SESSIONS);

  return {
    schemaVersion: PROFILE_STATE_SCHEMA_VERSION,
    profileId: existing.profileId,
    activeSession:
      existing.activeSession !== null
        ? cloneJson(existing.activeSession)
        : cloneJson(incoming.activeSession),
    exposureStats: mergedExposure,
    reviewQueue: mergedReviewQueue,
    dailyChallenges: mergedDaily,
    completedSessions: mergedCompleted,
  };
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly mode = 'local' as const;

  private readonly storage: Storage;
  private readonly dataVersion: string;
  private readonly quotaBytes: number;

  constructor(options: LocalStorageAdapterOptions = {}) {
    const resolvedStorage =
      options.storage ??
      (typeof window !== 'undefined' ? window.localStorage : undefined);
    if (!resolvedStorage) {
      throw new Error('사용 가능한 LocalStorage 인스턴스가 없습니다.');
    }

    this.storage = resolvedStorage;
    this.dataVersion = options.dataVersion ?? DEFAULT_DATA_VERSION;
    this.quotaBytes = options.quotaBytes ?? DEFAULT_QUOTA_BYTES;
  }

  async getMeta(): Promise<StorageMeta> {
    const raw = this.storage.getItem(META_STORAGE_KEY);
    if (!raw) {
      return createDefaultMeta();
    }
    const parsed = JSON.parse(raw) as StorageMeta;
    return {
      schemaVersion: 1,
      activeProfileId: parsed.activeProfileId ?? null,
      tolerancePreset: parsed.tolerancePreset ?? 'normal',
    };
  }

  async saveMeta(meta: StorageMeta): Promise<StorageMeta> {
    const next: StorageMeta = {
      schemaVersion: 1,
      activeProfileId: meta.activeProfileId ?? null,
      tolerancePreset: meta.tolerancePreset ?? 'normal',
    };
    this.writeItem(META_STORAGE_KEY, JSON.stringify(next));
    return cloneJson(next);
  }

  async getStorageUsageInfo(): Promise<StorageUsageInfo> {
    let usedBytes = 0;
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) {
        continue;
      }
      const value = this.storage.getItem(key) ?? '';
      // JavaScript UTF-16 code units occupy 2 bytes each in DOM Storage
      usedBytes += (key.length + value.length) * 2;
    }

    const usageRatio = this.quotaBytes > 0 ? usedBytes / this.quotaBytes : 0;
    return {
      usedBytes,
      quotaBytes: this.quotaBytes,
      usageRatio,
      isWarning: usageRatio >= STORAGE_WARNING_RATIO,
    };
  }

  async listProfiles(): Promise<UserProfile[]> {
    const raw = this.storage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as UserProfile[];
    return Array.isArray(parsed) ? cloneJson(parsed) : [];
  }

  async saveProfile(profile: UserProfile): Promise<UserProfile> {
    if (!profile.id || profile.id.trim() === '' || /\s/.test(profile.id)) {
      throw new ProfileValidationError('유효하지 않은 프로필 ID입니다.');
    }
    if (!profile.avatarId || profile.avatarId.trim() === '') {
      throw new ProfileValidationError('아바타 ID가 필요합니다.');
    }
    const validatedName = normalizeAndValidateProfileName(profile.name);
    const normalized: UserProfile = {
      id: profile.id,
      name: validatedName,
      avatarId: profile.avatarId,
      createdAt: profile.createdAt || new Date().toISOString(),
    };

    const profiles = await this.listProfiles();
    const existingIndex = profiles.findIndex((p) => p.id === normalized.id);
    const isNew = existingIndex === -1;

    if (isNew) {
      profiles.push(normalized);
    } else {
      profiles[existingIndex] = normalized;
    }

    this.writeItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
    if (isNew && !this.storage.getItem(getStateKey(normalized.id))) {
      this.writeProfileState(createEmptyProfileState(normalized.id));
    }

    return cloneJson(normalized);
  }

  async deleteProfile(profileId: string): Promise<void> {
    const profiles = await this.listProfiles();
    const filtered = profiles.filter((p) => p.id !== profileId);

    this.writeItem(PROFILES_STORAGE_KEY, JSON.stringify(filtered));
    this.storage.removeItem(getStateKey(profileId));

    const meta = await this.getMeta();
    if (meta.activeProfileId === profileId) {
      meta.activeProfileId = filtered[0]?.id ?? null;
      await this.saveMeta(meta);
    }
  }

  async getActiveProfileId(): Promise<string | null> {
    const meta = await this.getMeta();
    if (!meta.activeProfileId) {
      return null;
    }
    const profiles = await this.listProfiles();
    const exists = profiles.some((p) => p.id === meta.activeProfileId);
    return exists ? meta.activeProfileId : null;
  }

  async setActiveProfileId(profileId: string): Promise<void> {
    const profiles = await this.listProfiles();
    if (!profiles.some((p) => p.id === profileId)) {
      throw new ProfileValidationError(
        `존재하지 않는 프로필을 활성화할 수 없습니다: ${profileId}`,
      );
    }
    const meta = await this.getMeta();
    meta.activeProfileId = profileId;
    await this.saveMeta(meta);
  }

  async getActiveSession(profileId: string): Promise<SessionSnapshot | null> {
    const state = this.readProfileState(profileId);
    return state.activeSession ? cloneJson(state.activeSession) : null;
  }

  async saveActiveSession(
    profileId: string,
    snapshot: SessionSnapshot,
  ): Promise<void> {
    const state = this.readProfileStateOrCreate(profileId);
    state.activeSession = cloneJson(snapshot);
    this.writeProfileState(state);
  }

  async clearActiveSession(profileId: string): Promise<void> {
    const state = this.readProfileStateOrCreate(profileId);
    state.activeSession = null;
    this.writeProfileState(state);
  }

  async appendCompletedSession(
    profileId: string,
    summary: CompletedSessionRecord,
  ): Promise<void> {
    const state = this.readProfileStateOrCreate(profileId);
    const deduped = state.completedSessions.filter(
      (item) => item.sessionId !== summary.sessionId,
    );
    state.completedSessions = [cloneJson(summary), ...deduped].slice(
      0,
      MAX_COMPLETED_SESSIONS,
    );
    this.writeProfileState(state);
  }

  async listCompletedSessions(
    profileId: string,
    limit?: number,
  ): Promise<CompletedSessionRecord[]> {
    const state = this.readProfileState(profileId);
    const items =
      limit !== undefined && limit >= 0
        ? state.completedSessions.slice(0, limit)
        : state.completedSessions;
    return cloneJson(items);
  }

  async getExposureStats(
    profileId: string,
  ): Promise<Record<string, ReadingExposureStat>> {
    const state = this.readProfileState(profileId);
    return cloneJson(state.exposureStats);
  }

  async recordReadingExposure(
    profileId: string,
    readingKey: string,
    exposedAt: string,
  ): Promise<void> {
    const { characterId, sound } = parseReadingKey(readingKey);
    const state = this.readProfileStateOrCreate(profileId);
    const current = state.exposureStats[readingKey];

    state.exposureStats[readingKey] = {
      readingKey,
      characterId,
      sound,
      exposureCount: (current?.exposureCount ?? 0) + 1,
      lastExposedAt: exposedAt,
    };

    this.writeProfileState(state);
  }

  async getReviewQueue(
    profileId: string,
  ): Promise<Record<string, ReviewItem>> {
    const state = this.readProfileState(profileId);
    return cloneJson(state.reviewQueue);
  }

  async upsertReviewItems(
    profileId: string,
    items: ReviewItem[],
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const state = this.readProfileStateOrCreate(profileId);
    for (const item of items) {
      state.reviewQueue[item.reviewItemId] = cloneJson(item);
    }
    this.writeProfileState(state);
  }

  async getDailyChallenge(
    profileId: string,
    dateKey: string,
  ): Promise<DailyChallengeRecord | null> {
    const state = this.readProfileState(profileId);
    const record = state.dailyChallenges[dateKey];
    return record ? cloneJson(record) : null;
  }

  async saveDailyChallenge(
    profileId: string,
    record: DailyChallengeRecord,
  ): Promise<void> {
    const state = this.readProfileStateOrCreate(profileId);
    state.dailyChallenges[record.dateKey] = cloneJson(record);
    this.writeProfileState(state);
  }

  async exportBackup(): Promise<AppBackupPayload> {
    const meta = await this.getMeta();
    const profiles = await this.listProfiles();
    const states: Record<string, ProfileLearningState> = {};

    for (const profile of profiles) {
      states[profile.id] = this.readProfileState(profile.id);
    }

    const activeProfileId =
      meta.activeProfileId &&
      profiles.some((profile) => profile.id === meta.activeProfileId)
        ? meta.activeProfileId
        : null;

    return {
      exportFormat: BACKUP_EXPORT_FORMAT,
      exportSchemaVersion: BACKUP_EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      dataVersion: this.dataVersion,
      activeProfileId,
      profiles,
      states,
    };
  }

  async importBackup(
    payload: AppBackupPayload,
    strategy: 'replace' | 'merge',
  ): Promise<void> {
    const validated = validateBackupPayload(payload);
    await this.applyValidatedBackup(validated, strategy);
  }

  async importBackupJson(
    jsonText: string,
    strategy: 'replace' | 'merge',
  ): Promise<void> {
    const validated = parseSafeBackupJson(jsonText);
    await this.applyValidatedBackup(validated, strategy);
  }

  private async applyValidatedBackup(
    validated: AppBackupPayload,
    strategy: 'replace' | 'merge',
  ): Promise<void> {
    const snapshot = this.captureStorageSnapshot();
    const currentMeta = await this.getMeta();

    try {
      if (strategy === 'replace') {
        const nextIds = new Set(validated.profiles.map((p) => p.id));
        for (const key of Object.keys(snapshot)) {
          if (key.startsWith(STATE_STORAGE_KEY_PREFIX)) {
            const existingId = key.slice(STATE_STORAGE_KEY_PREFIX.length);
            if (!nextIds.has(existingId)) {
              this.storage.removeItem(key);
            }
          }
        }

        const nextMeta: StorageMeta = {
          schemaVersion: 1,
          activeProfileId: validated.activeProfileId,
          tolerancePreset: currentMeta.tolerancePreset,
        };
        this.writeItem(META_STORAGE_KEY, JSON.stringify(nextMeta));
        this.writeItem(
          PROFILES_STORAGE_KEY,
          JSON.stringify(validated.profiles),
        );
        for (const profile of validated.profiles) {
          const state =
            validated.states[profile.id] ?? createEmptyProfileState(profile.id);
          this.writeProfileState(state);
        }
        return;
      }

      // strategy === 'merge'
      const existingProfiles = await this.listProfiles();
      const mergedProfileMap = new Map<string, UserProfile>();
      for (const p of existingProfiles) {
        mergedProfileMap.set(p.id, cloneJson(p));
      }

      const mergedStates: Record<string, ProfileLearningState> = {};
      for (const p of existingProfiles) {
        mergedStates[p.id] = this.readProfileState(p.id);
      }

      for (const incProfile of validated.profiles) {
        const incState =
          validated.states[incProfile.id] ??
          createEmptyProfileState(incProfile.id);
        const existingState = mergedStates[incProfile.id];
        if (!mergedProfileMap.has(incProfile.id)) {
          mergedProfileMap.set(incProfile.id, cloneJson(incProfile));
          mergedStates[incProfile.id] = cloneJson(incState);
        } else if (existingState) {
          mergedStates[incProfile.id] = mergeProfileStates(
            existingState,
            incState,
          );
        }
      }

      const mergedProfiles = Array.from(mergedProfileMap.values());
      const resolvedActiveId =
        currentMeta.activeProfileId &&
        mergedProfileMap.has(currentMeta.activeProfileId)
          ? currentMeta.activeProfileId
          : validated.activeProfileId;

      const nextMeta: StorageMeta = {
        schemaVersion: 1,
        activeProfileId: resolvedActiveId,
        tolerancePreset: currentMeta.tolerancePreset,
      };
      this.writeItem(META_STORAGE_KEY, JSON.stringify(nextMeta));
      this.writeItem(PROFILES_STORAGE_KEY, JSON.stringify(mergedProfiles));
      for (const profile of mergedProfiles) {
        const state = mergedStates[profile.id];
        if (state) {
          this.writeProfileState(state);
        }
      }
    } catch (error) {
      this.restoreStorageSnapshot(snapshot);
      throw error;
    }
  }

  private captureStorageSnapshot(): Record<string, string> {
    const snapshot: Record<string, string> = {};
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        const val = this.storage.getItem(key);
        if (val !== null) {
          snapshot[key] = val;
        }
      }
    }
    return snapshot;
  }

  private restoreStorageSnapshot(snapshot: Record<string, string>): void {
    const currentKeys: string[] = [];
    for (let i = 0; i < this.storage.length; i += 1) {
      const key = this.storage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        currentKeys.push(key);
      }
    }
    for (const key of currentKeys) {
      if (!(key in snapshot)) {
        this.storage.removeItem(key);
      }
    }
    for (const [key, value] of Object.entries(snapshot)) {
      this.storage.setItem(key, value);
    }
  }

  private assertProfileExists(profileId: string): void {
    const raw = this.storage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) {
      throw new ProfileValidationError(`프로필을 찾을 수 없습니다: ${profileId}`);
    }
    const profiles = JSON.parse(raw) as UserProfile[];
    if (!Array.isArray(profiles) || !profiles.some((p) => p.id === profileId)) {
      throw new ProfileValidationError(`프로필을 찾을 수 없습니다: ${profileId}`);
    }
  }

  private readProfileState(profileId: string): ProfileLearningState {
    const raw = this.storage.getItem(getStateKey(profileId));
    if (!raw) {
      return createEmptyProfileState(profileId);
    }
    return JSON.parse(raw) as ProfileLearningState;
  }

  private readProfileStateOrCreate(profileId: string): ProfileLearningState {
    this.assertProfileExists(profileId);
    return this.readProfileState(profileId);
  }

  private writeProfileState(state: ProfileLearningState): void {
    this.writeItem(getStateKey(state.profileId), JSON.stringify(state));
  }

  private writeItem(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch (error) {
      if (isQuotaExceededError(error)) {
        throw new StorageQuotaExceededError(
          '저장 공간이 부족합니다. JSON 백업 후 오래된 기록을 정리해 주세요.',
          error,
        );
      }
      throw error;
    }
  }
}
