import { useEffect, useState } from 'react';
import { loadCatalogStore, type CatalogStore } from './data/catalogStore';
import { LocalStorageAdapter } from './storage/localStorageAdapter';
import type { StorageUsageInfo, UserProfile } from './types/storage';

interface BootstrapState {
  status: 'loading' | 'ready' | 'error';
  catalog: CatalogStore | null;
  profiles: UserProfile[];
  activeProfile: UserProfile | null;
  usage: StorageUsageInfo | null;
  errorMessage: string | null;
}

export function App() {
  const [state, setState] = useState<BootstrapState>({
    status: 'loading',
    catalog: null,
    profiles: [],
    activeProfile: null,
    usage: null,
    errorMessage: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const storage = new LocalStorageAdapter();
        const [catalog, profiles, activeProfileId, usage] = await Promise.all([
          loadCatalogStore(),
          storage.listProfiles(),
          storage.getActiveProfileId(),
          storage.getStorageUsageInfo(),
        ]);

        if (cancelled) {
          return;
        }

        const activeProfile =
          profiles.find((p) => p.id === activeProfileId) ?? null;

        setState({
          status: 'ready',
          catalog,
          profiles,
          activeProfile,
          usage,
          errorMessage: null,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState({
          status: 'error',
          catalog: null,
          profiles: [],
          activeProfile: null,
          usage: null,
          errorMessage:
            error instanceof Error
              ? error.message
              : '초기 데이터를 불러오는 중 오류가 발생했습니다.',
        });
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>중학 한자 공부</h1>
        <p className="app-subtitle">
          천재교과서 중학교 한문(안대회) 학습 앱 · M1 데이터/저장소 레이어
        </p>
      </header>

      {state.status === 'loading' && (
        <section className="status-card" aria-live="polite">
          <p>교과서 데이터와 학습 저장소를 불러오는 중입니다...</p>
        </section>
      )}

      {state.status === 'error' && (
        <section className="error-box" role="alert">
          <strong>초기화 실패:</strong> {state.errorMessage}
        </section>
      )}

      {state.status === 'ready' && state.catalog && (
        <>
          <section className="status-card">
            <h2>교과서 카탈로그 상태</h2>
            <dl className="status-list">
              <dt>교과서</dt>
              <dd>
                {state.catalog.textbook.publisher}{' '}
                {state.catalog.textbook.title} ({state.catalog.textbook.leadAuthor})
              </dd>
              <dt>데이터 버전</dt>
              <dd>{state.catalog.dataVersion}</dd>
              <dt>단원 수</dt>
              <dd>{state.catalog.units.length}단원</dd>
              <dt>고유 한자 수</dt>
              <dd>{state.catalog.characters.length}자</dd>
              <dt>뜻·음 학습 가능</dt>
              <dd>{state.catalog.getReadingCandidates().length}자</dd>
              <dt>쓰기 학습 가능</dt>
              <dd>{state.catalog.getWritingCandidates().length}자</dd>
            </dl>
          </section>

          <section className="status-card">
            <h2>로컬 프로필 저장소 상태</h2>
            <dl className="status-list">
              <dt>등록된 프로필</dt>
              <dd>{state.profiles.length}명</dd>
              <dt>활성 프로필</dt>
              <dd>
                {state.activeProfile
                  ? `${state.activeProfile.name} (${state.activeProfile.id})`
                  : '선택된 프로필 없음'}
              </dd>
              <dt>저장 공간 사용량</dt>
              <dd>
                {state.usage
                  ? `${(state.usage.usedBytes / 1024).toFixed(1)} KB (${(state.usage.usageRatio * 100).toFixed(2)}%)`
                  : '-'}
              </dd>
            </dl>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
