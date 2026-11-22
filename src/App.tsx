import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HomeScreen } from './components/HomeScreen';
import {
  ProfileScreen,
  type ProfileSummaryInfo,
} from './components/ProfileScreen';
import { QuizScreen } from './components/QuizScreen';
import {
  ResultScreen,
  type FamilyDailyEntry,
} from './components/ResultScreen';
import { StudySetupScreen } from './components/StudySetupScreen';
import { loadCatalogStore, type CatalogStore } from './data/catalogStore';
import { StrokeLazyLoader } from './data/strokeLoader';
import { getLocalDateKey } from './engine/prng';
import { ActiveSessionConflictError, SessionEngine } from './engine/sessionEngine';
import { LocalStorageAdapter } from './storage/localStorageAdapter';
import type { StorageAdapter } from './storage/storageAdapter';
import type { QuestionType } from './types/catalog';
import type {
  AppBackupPayload,
  CompletedSessionRecord,
  DailyChallengeRecord,
  ReadingExposureStat,
  ReviewItem,
  SessionSnapshot,
  StorageUsageInfo,
  UserProfile,
} from './types/storage';
import { SESSION_MODE_LABELS } from './utils/labels';

export interface AppProps {
  catalogStore?: CatalogStore;
  strokeLoader?: StrokeLazyLoader;
  storageAdapter?: StorageAdapter;
}

type ScreenId = 'profiles' | 'home' | 'setup' | 'quiz' | 'result';

interface ResultViewState {
  completedSession: CompletedSessionRecord | null;
  dailyRecord: DailyChallengeRecord | null;
  isDailyView: boolean;
  familyDailyLeaderboard: FamilyDailyEntry[];
}

interface HomeConflictState {
  target: 'review' | 'daily';
  activeSession: SessionSnapshot;
}

function createProfileId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `prof_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  return `prof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function countPendingReviews(queue: Record<string, ReviewItem>): number {
  return Object.values(queue).filter((item) => item.status === 'needs_review')
    .length;
}

function countCompletedReviews(queue: Record<string, ReviewItem>): number {
  return Object.values(queue).filter((item) => item.status === 'completed')
    .length;
}

function countStudiedCharacters(
  exposureStats: Record<string, ReadingExposureStat>,
): number {
  const charIds = new Set<string>();
  for (const stat of Object.values(exposureStats)) {
    if (stat.exposureCount > 0) {
      charIds.add(stat.characterId);
    }
  }
  return charIds.size;
}

function countTodaySolvedQuestions(
  completedSessions: CompletedSessionRecord[],
  activeSession: SessionSnapshot | null,
  todayDateKey: string,
): number {
  const seen = new Set<string>();
  const allSources: Array<{
    sessionId: string;
    answers: CompletedSessionRecord['answers'];
  }> = [...completedSessions];
  if (activeSession) {
    allSources.push(activeSession);
  }

  for (const src of allSources) {
    for (const ans of src.answers) {
      if (ans.outcome === 'abandoned') {
        continue;
      }
      const parsed = new Date(ans.submittedAt);
      const ansDateKey = Number.isNaN(parsed.getTime())
        ? ans.submittedAt.slice(0, 10)
        : getLocalDateKey(parsed);
      if (ansDateKey === todayDateKey) {
        seen.add(`${src.sessionId}::${ans.questionId}`);
      }
    }
  }
  return seen.size;
}

export function App({
  catalogStore: injectedCatalog,
  strokeLoader: injectedStrokeLoader,
  storageAdapter: injectedStorage,
}: AppProps = {}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [catalog, setCatalog] = useState<CatalogStore | null>(
    injectedCatalog ?? null,
  );
  const [strokeLoader, setStrokeLoader] = useState<StrokeLazyLoader | null>(
    injectedStrokeLoader ?? null,
  );
  const storageRef = useRef<StorageAdapter | null>(injectedStorage ?? null);

  const [screen, setScreen] = useState<ScreenId>('profiles');
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [profileSummaries, setProfileSummaries] = useState<
    Record<string, ProfileSummaryInfo>
  >({});
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageUsageInfo | null>(null);

  const [activeSession, setActiveSession] = useState<SessionSnapshot | null>(
    null,
  );
  const [reviewQueue, setReviewQueue] = useState<Record<string, ReviewItem>>(
    {},
  );
  const [exposureStats, setExposureStats] = useState<
    Record<string, ReadingExposureStat>
  >({});
  const [completedSessions, setCompletedSessions] = useState<
    CompletedSessionRecord[]
  >([]);
  const [todayDailyRecord, setTodayDailyRecord] =
    useState<DailyChallengeRecord | null>(null);

  const [resultView, setResultView] = useState<ResultViewState | null>(null);
  const [homeConflict, setHomeConflict] = useState<HomeConflictState | null>(
    null,
  );

  const sessionEngine = useMemo(() => {
    if (!catalog || !storageRef.current) return null;
    return new SessionEngine(catalog, storageRef.current);
  }, [catalog, status]);

  const loadSummariesForProfiles = useCallback(
    async (
      storage: StorageAdapter,
      profileList: UserProfile[],
    ): Promise<Record<string, ProfileSummaryInfo>> => {
      const summaries: Record<string, ProfileSummaryInfo> = {};
      await Promise.all(
        profileList.map(async (profile) => {
          const [pActive, pCompleted, pQueue] = await Promise.all([
            storage.getActiveSession(profile.id),
            storage.listCompletedSessions(profile.id, 1),
            storage.getReviewQueue(profile.id),
          ]);
          summaries[profile.id] = {
            lastStudiedAt:
              pCompleted[0]?.completedAt ?? pActive?.updatedAt ?? null,
            pendingReviewCount: countPendingReviews(pQueue),
            hasActiveSession: pActive !== null,
            activeSessionAnswered: pActive?.answers.length ?? 0,
            activeSessionTotal: pActive?.questions.length ?? 0,
          };
        }),
      );
      return summaries;
    },
    [],
  );

  const loadProfileWorkspace = useCallback(
    async (storage: StorageAdapter, profileId: string) => {
      const todayKey = getLocalDateKey();
      const [pActive, pQueue, pExposure, pCompleted, pDaily, nextUsage] =
        await Promise.all([
          storage.getActiveSession(profileId),
          storage.getReviewQueue(profileId),
          storage.getExposureStats(profileId),
          storage.listCompletedSessions(profileId),
          storage.getDailyChallenge(profileId, todayKey),
          storage.getStorageUsageInfo(),
        ]);

      setActiveSession(pActive);
      setReviewQueue(pQueue);
      setExposureStats(pExposure);
      setCompletedSessions(pCompleted);
      setTodayDailyRecord(pDaily);
      setUsage(nextUsage);
    },
    [],
  );

  const loadFamilyLeaderboard = useCallback(
    async (
      storage: StorageAdapter,
      profileList: UserProfile[],
      dateKey: string,
    ): Promise<FamilyDailyEntry[]> => {
      const entries = await Promise.all(
        profileList.map(async (profile) => {
          const record = await storage.getDailyChallenge(profile.id, dateKey);
          return record ? { profile, record } : null;
        }),
      );
      return entries.filter((e): e is FamilyDailyEntry => e !== null);
    },
    [],
  );

  const refreshAllFromStorage = useCallback(
    async (storage: StorageAdapter, preferredScreen?: ScreenId) => {
      const [profileList, currentActiveId, nextUsage] = await Promise.all([
        storage.listProfiles(),
        storage.getActiveProfileId(),
        storage.getStorageUsageInfo(),
      ]);
      const summaries = await loadSummariesForProfiles(storage, profileList);

      setProfiles(profileList);
      setProfileSummaries(summaries);
      setUsage(nextUsage);

      const validActive = profileList.find((p) => p.id === currentActiveId);
      if (validActive) {
        setActiveProfileId(validActive.id);
        await loadProfileWorkspace(storage, validActive.id);
        if (preferredScreen) {
          setScreen(preferredScreen);
        }
      } else {
        setActiveProfileId(null);
        setActiveSession(null);
        setReviewQueue({});
        setExposureStats({});
        setCompletedSessions([]);
        setTodayDailyRecord(null);
        setScreen('profiles');
      }
    },
    [loadProfileWorkspace, loadSummariesForProfiles],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const storage = injectedStorage ?? new LocalStorageAdapter();
        storageRef.current = storage;

        const loadedCatalog = injectedCatalog ?? (await loadCatalogStore());
        const loader =
          injectedStrokeLoader ??
          new StrokeLazyLoader({ dataVersion: loadedCatalog.dataVersion });

        if (cancelled) return;

        setCatalog(loadedCatalog);
        setStrokeLoader(loader);

        const [profileList, currentActiveId, nextUsage] = await Promise.all([
          storage.listProfiles(),
          storage.getActiveProfileId(),
          storage.getStorageUsageInfo(),
        ]);
        const summaries = await loadSummariesForProfiles(storage, profileList);

        if (cancelled) return;

        setProfiles(profileList);
        setProfileSummaries(summaries);
        setUsage(nextUsage);

        const active = profileList.find((p) => p.id === currentActiveId) ?? null;
        if (active) {
          setActiveProfileId(active.id);
          await loadProfileWorkspace(storage, active.id);
          if (!cancelled) {
            setScreen('home');
          }
        } else {
          setActiveProfileId(null);
          setScreen('profiles');
        }

        if (!cancelled) {
          setStatus('ready');
        }
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : '초기 데이터를 불러오는 중 오류가 발생했습니다.',
        );
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [
    injectedCatalog,
    injectedStrokeLoader,
    injectedStorage,
    loadProfileWorkspace,
    loadSummariesForProfiles,
  ]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  );

  const handleSelectProfile = async (profileId: string) => {
    const storage = storageRef.current;
    if (!storage) return;
    setActionError(null);
    await storage.setActiveProfileId(profileId);
    setActiveProfileId(profileId);
    setResultView(null);
    await loadProfileWorkspace(storage, profileId);
    setScreen('home');
  };

  const handleCreateProfile = async (name: string, avatarId: string) => {
    const storage = storageRef.current;
    if (!storage) return;
    setActionError(null);
    const created = await storage.saveProfile({
      id: createProfileId(),
      name,
      avatarId,
      createdAt: new Date().toISOString(),
    });
    const [profileList, nextUsage] = await Promise.all([
      storage.listProfiles(),
      storage.getStorageUsageInfo(),
    ]);
    const summaries = await loadSummariesForProfiles(storage, profileList);
    setProfiles(profileList);
    setProfileSummaries(summaries);
    setUsage(nextUsage);
    // Keep user on profile list unless they tap to enter; ensure created exists
    void created;
  };

  const handleDeleteProfile = async (profileId: string) => {
    const storage = storageRef.current;
    if (!storage) return;
    setActionError(null);
    await storage.deleteProfile(profileId);
    await refreshAllFromStorage(storage, 'profiles');
  };

  const handleExportBackup = async (): Promise<AppBackupPayload> => {
    const storage = storageRef.current;
    if (!storage) {
      throw new Error('저장소가 초기화되지 않았습니다.');
    }
    return storage.exportBackup();
  };

  const handleImportBackup = async (
    payload: AppBackupPayload,
    strategy: 'replace' | 'merge',
  ) => {
    const storage = storageRef.current;
    if (!storage) {
      throw new Error('저장소가 초기화되지 않았습니다.');
    }
    await storage.importBackup(payload, strategy);
    setResultView(null);
    await refreshAllFromStorage(storage, 'profiles');
  };

  const handleStartNormalSession = async (
    unitIds: string[],
    selectedTypes: QuestionType[],
    forceReplace = false,
  ) => {
    if (!sessionEngine || !activeProfile) return;
    setActionError(null);
    const snapshot = await sessionEngine.startNormalSession(activeProfile.id, {
      unitIds,
      selectedTypes,
      forceReplace,
    });
    await loadProfileWorkspace(storageRef.current!, activeProfile.id);
    setActiveSession(snapshot);
    setScreen('quiz');
  };

  const handleStartReviewSession = async (forceReplace = false) => {
    if (!sessionEngine || !activeProfile || !storageRef.current) return;
    setActionError(null);
    if (!forceReplace && activeSession?.mode === 'review') {
      setScreen('quiz');
      return;
    }
    try {
      const snapshot = await sessionEngine.startReviewSession(activeProfile.id, {
        forceReplace,
      });
      setHomeConflict(null);
      await loadProfileWorkspace(storageRef.current, activeProfile.id);
      setActiveSession(snapshot);
      setScreen('quiz');
    } catch (error) {
      if (error instanceof ActiveSessionConflictError) {
        setHomeConflict({ target: 'review', activeSession: error.activeSession });
      } else {
        setActionError(
          error instanceof Error
            ? error.message
            : '오답 복습을 시작할 수 없습니다.',
        );
      }
    }
  };

  const handleStartDailySession = async (
    forcePractice = false,
    forceReplace = false,
  ) => {
    if (!sessionEngine || !activeProfile || !storageRef.current) return;
    setActionError(null);
    if (!forcePractice && !forceReplace && activeSession?.mode === 'daily') {
      setScreen('quiz');
      return;
    }
    try {
      const snapshot = await sessionEngine.startDailySession(activeProfile.id, {
        dateKey: getLocalDateKey(),
        forceReplace,
      });
      setHomeConflict(null);
      await loadProfileWorkspace(storageRef.current, activeProfile.id);
      setActiveSession(snapshot);
      setScreen('quiz');
    } catch (error) {
      if (error instanceof ActiveSessionConflictError) {
        setHomeConflict({ target: 'daily', activeSession: error.activeSession });
      } else {
        setActionError(
          error instanceof Error
            ? error.message
            : '하루 도전을 시작할 수 없습니다.',
        );
      }
    }
  };

  const handleViewDailyResult = async () => {
    if (!storageRef.current || !activeProfile || !todayDailyRecord) return;
    setActionError(null);
    const matchedSession =
      completedSessions.find(
        (s) => s.sessionId === todayDailyRecord.sessionId,
      ) ?? null;
    const leaderboard = await loadFamilyLeaderboard(
      storageRef.current,
      profiles,
      todayDailyRecord.dateKey,
    );
    setResultView({
      completedSession: matchedSession,
      dailyRecord: todayDailyRecord,
      isDailyView: true,
      familyDailyLeaderboard: leaderboard,
    });
    setScreen('result');
  };

  const handleQuizSessionUpdated = useCallback(
    (updated: SessionSnapshot, nextQueue: Record<string, ReviewItem>) => {
      setActiveSession(updated);
      setReviewQueue(nextQueue);
    },
    [],
  );

  const handleQuizSessionCompleted = useCallback(
    async (
      completed: CompletedSessionRecord,
      nextQueue: Record<string, ReviewItem>,
    ) => {
      const storage = storageRef.current;
      if (!storage || !activeProfile) return;

      setActiveSession(null);
      setReviewQueue(nextQueue);

      const todayKey = getLocalDateKey();
      const [pExposure, pCompleted, pDaily, nextUsage, summaries] =
        await Promise.all([
          storage.getExposureStats(activeProfile.id),
          storage.listCompletedSessions(activeProfile.id),
          storage.getDailyChallenge(activeProfile.id, todayKey),
          storage.getStorageUsageInfo(),
          loadSummariesForProfiles(storage, profiles),
        ]);

      setExposureStats(pExposure);
      setCompletedSessions(pCompleted);
      setTodayDailyRecord(pDaily);
      setUsage(nextUsage);
      setProfileSummaries(summaries);

      const isDaily = completed.mode === 'daily';
      const leaderboard = isDaily
        ? await loadFamilyLeaderboard(storage, profiles, todayKey)
        : [];

      setResultView({
        completedSession: completed,
        dailyRecord: isDaily ? pDaily : null,
        isDailyView: isDaily,
        familyDailyLeaderboard: leaderboard,
      });
      setScreen('result');
    },
    [activeProfile, loadFamilyLeaderboard, loadSummariesForProfiles, profiles],
  );

  const handleRetrySameScope = async () => {
    if (!resultView || !sessionEngine || !activeProfile || !storageRef.current) {
      return;
    }
    const { completedSession, isDailyView } = resultView;
    if (isDailyView || completedSession?.mode === 'daily') {
      await handleStartDailySession(true, true);
      return;
    }
    if (completedSession?.mode === 'normal') {
      await handleStartNormalSession(
        completedSession.unitIds,
        completedSession.selectedTypes,
        true,
      );
      return;
    }
    if (completedSession?.mode === 'review') {
      await handleStartReviewSession(true);
    }
  };

  const handleGoHome = async () => {
    if (storageRef.current && activeProfile) {
      await loadProfileWorkspace(storageRef.current, activeProfile.id);
      const summaries = await loadSummariesForProfiles(
        storageRef.current,
        profiles,
      );
      setProfileSummaries(summaries);
    }
    setResultView(null);
    setActionError(null);
    setScreen('home');
  };

  const todayDateKey = getLocalDateKey();
  const pendingReviewCount = countPendingReviews(reviewQueue);
  const completedReviewCount = countCompletedReviews(reviewQueue);
  const studiedCharacterCount = countStudiedCharacters(exposureStats);
  const todaySolvedCount = countTodaySolvedQuestions(
    completedSessions,
    activeSession,
    todayDateKey,
  );

  return (
    <main className="app-shell">
      {status === 'loading' && (
        <section className="card status-card" aria-live="polite">
          <p>교과서 데이터와 학습 저장소를 불러오는 중입니다...</p>
        </section>
      )}

      {status === 'error' && (
        <section className="alert alert-error" role="alert">
          <span aria-hidden="true">✕</span>
          <div>
            <strong>초기화 실패:</strong> {errorMessage}
          </div>
        </section>
      )}

      {status === 'ready' && actionError && (
        <div className="alert alert-error app-action-error" role="alert">
          <span aria-hidden="true">✕</span>
          <span>{actionError}</span>
        </div>
      )}

      {status === 'ready' &&
        catalog &&
        strokeLoader &&
        sessionEngine &&
        screen === 'profiles' && (
          <ProfileScreen
            profiles={profiles}
            profileSummaries={profileSummaries}
            activeProfileId={activeProfileId}
            usage={usage}
            onSelectProfile={handleSelectProfile}
            onCreateProfile={handleCreateProfile}
            onDeleteProfile={handleDeleteProfile}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
            onBackToHome={
              activeProfile ? () => setScreen('home') : undefined
            }
          />
        )}

      {status === 'ready' &&
        catalog &&
        strokeLoader &&
        sessionEngine &&
        screen === 'home' &&
        activeProfile && (
          <HomeScreen
            profile={activeProfile}
            activeSession={activeSession}
            pendingReviewCount={pendingReviewCount}
            completedReviewCount={completedReviewCount}
            studiedCharacterCount={studiedCharacterCount}
            todaySolvedCount={todaySolvedCount}
            todayDateKey={todayDateKey}
            todayDailyRecord={todayDailyRecord}
            onOpenProfiles={async () => {
              if (storageRef.current) {
                const summaries = await loadSummariesForProfiles(
                  storageRef.current,
                  profiles,
                );
                setProfileSummaries(summaries);
              }
              setScreen('profiles');
            }}
            onResumeSession={() => {
              if (activeSession) {
                setScreen('quiz');
              }
            }}
            onOpenStudySetup={() => setScreen('setup')}
            onStartReview={() => void handleStartReviewSession(false)}
            onStartDaily={(forcePractice = false) =>
              void handleStartDailySession(forcePractice, false)
            }
            onViewDailyResult={() => void handleViewDailyResult()}
          />
        )}

      {status === 'ready' &&
        catalog &&
        screen === 'setup' &&
        activeProfile && (
          <StudySetupScreen
            catalog={catalog}
            activeSession={activeSession}
            onBack={() => setScreen('home')}
            onStartSession={handleStartNormalSession}
            onResumeActiveSession={() => setScreen('quiz')}
          />
        )}

      {status === 'ready' &&
        catalog &&
        strokeLoader &&
        sessionEngine &&
        screen === 'quiz' &&
        activeProfile &&
        activeSession && (
          <QuizScreen
            catalog={catalog}
            strokeLoader={strokeLoader}
            sessionEngine={sessionEngine}
            profileId={activeProfile.id}
            session={activeSession}
            reviewQueue={reviewQueue}
            onSessionUpdated={handleQuizSessionUpdated}
            onSessionCompleted={handleQuizSessionCompleted}
          />
        )}

      {status === 'ready' &&
        catalog &&
        screen === 'result' &&
        activeProfile &&
        resultView && (
          <ResultScreen
            catalog={catalog}
            activeProfileId={activeProfile.id}
            completedSession={resultView.completedSession}
            dailyRecord={resultView.dailyRecord}
            familyDailyLeaderboard={resultView.familyDailyLeaderboard}
            pendingReviewCount={pendingReviewCount}
            isDailyView={resultView.isDailyView}
            onStartReview={() => void handleStartReviewSession(true)}
            onRetrySameScope={() => void handleRetrySameScope()}
            onGoHome={() => void handleGoHome()}
          />
        )}

      {homeConflict && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="home-conflict-modal-title"
        >
          <div className="modal-card">
            <h3 id="home-conflict-modal-title" className="modal-title">
              진행 중인 학습이 있습니다
            </h3>
            <p className="modal-body">
              진행 중인 {SESSION_MODE_LABELS[homeConflict.activeSession.mode]} (
              {homeConflict.activeSession.answers.length}/
              {homeConflict.activeSession.questions.length}문항)을 이어서 풀거나, 기존 회차를 끝내고 새로 시작할 수 있습니다.
            </p>
            <div className="modal-actions-stack">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setHomeConflict(null);
                  setScreen('quiz');
                }}
              >
                이어하기
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const target = homeConflict.target;
                  if (target === 'review') {
                    void handleStartReviewSession(true);
                  } else {
                    void handleStartDailySession(true, true);
                  }
                }}
              >
                기존 회차 끝내고 새로 시작
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setHomeConflict(null)}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
