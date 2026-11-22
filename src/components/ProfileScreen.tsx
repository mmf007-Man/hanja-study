import React, { useRef, useState } from 'react';
import { getLocalDateKey } from '../engine/prng';
import {
  normalizeAndValidateProfileName,
  parseSafeBackupJson,
} from '../storage/backupValidation';
import type {
  AppBackupPayload,
  StorageUsageInfo,
  UserProfile,
} from '../types/storage';
import { AVATAR_PRESETS, getAvatarPreset } from '../utils/avatars';
import { formatKoreanDate } from '../utils/labels';

export interface ProfileSummaryInfo {
  lastStudiedAt: string | null;
  pendingReviewCount: number;
  hasActiveSession: boolean;
  activeSessionAnswered: number;
  activeSessionTotal: number;
}

export interface ProfileScreenProps {
  profiles: UserProfile[];
  profileSummaries: Record<string, ProfileSummaryInfo>;
  activeProfileId: string | null;
  usage: StorageUsageInfo | null;
  onSelectProfile: (profileId: string) => Promise<void> | void;
  onCreateProfile: (name: string, avatarId: string) => Promise<void>;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onExportBackup: () => Promise<AppBackupPayload>;
  onImportBackup: (
    payload: AppBackupPayload,
    strategy: 'replace' | 'merge',
  ) => Promise<void>;
  onBackToHome?: () => void;
}

async function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () =>
      reject(new Error('백업 파일을 읽는 중 오류가 발생했습니다.'));
    reader.readAsText(file, 'utf-8');
  });
}

function formatBytesKb(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  profiles,
  profileSummaries,
  activeProfileId,
  usage,
  onSelectProfile,
  onCreateProfile,
  onDeleteProfile,
  onExportBackup,
  onImportBackup,
  onBackToHome,
}) => {
  const [nameInput, setNameInput] = useState('');
  const [selectedAvatarId, setSelectedAvatarId] = useState(
    AVATAR_PRESETS[0]!.id,
  );
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<AppBackupPayload | null>(
    null,
  );
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCreateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);

    let validatedName: string;
    try {
      validatedName = normalizeAndValidateProfileName(nameInput);
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : '프로필 이름을 확인해 주세요.',
      );
      return;
    }

    setIsCreating(true);
    try {
      await onCreateProfile(validatedName, selectedAvatarId);
      setNameInput('');
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : '프로필을 추가하는 중 오류가 발생했습니다.',
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await onDeleteProfile(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportClick = async () => {
    setBackupError(null);
    setBackupStatus(null);
    try {
      const payload = await onExportBackup();
      const jsonText = JSON.stringify(payload, null, 2);
      const dateStr = getLocalDateKey().replace(/-/g, '');
      const filename = `hanja-study-backup-${dateStr}.json`;

      const blob = new Blob([jsonText], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setBackupStatus(`백업 파일(${filename})을 내보냈습니다.`);
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : '백업 내보내기에 실패했습니다.',
      );
    }
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setBackupError(null);
    setBackupStatus(null);

    try {
      const text = await readFileAsText(file);
      const validated = parseSafeBackupJson(text);
      setPendingImport(validated);
    } catch (error) {
      setPendingImport(null);
      setBackupError(
        error instanceof Error
          ? error.message
          : '유효하지 않은 백업 파일입니다.',
      );
    }
  };

  const handleConfirmImport = async (strategy: 'replace' | 'merge') => {
    if (!pendingImport) return;
    setIsImporting(true);
    setBackupError(null);
    try {
      await onImportBackup(pendingImport, strategy);
      setPendingImport(null);
      setBackupStatus(
        strategy === 'replace'
          ? '백업 데이터로 기기 기록을 복원했습니다.'
          : '백업 데이터를 기존 기록과 병합했습니다.',
      );
    } catch (error) {
      setBackupError(
        error instanceof Error
          ? error.message
          : '백업 데이터를 불러오는 중 오류가 발생했습니다.',
      );
    } finally {
      setIsImporting(false);
    }
  };

  const usagePercent = usage
    ? Math.min(100, Math.round(usage.usageRatio * 100))
    : 0;

  return (
    <div className="screen-stack" data-testid="profile-screen">
      <header className="screen-header">
        <div>
          <h1 className="screen-title">가족 프로필 선택</h1>
          <p className="screen-subtitle">
            한 기기에서 가족별 학습·복습·하루 도전 기록을 따로 관리합니다.
          </p>
        </div>
        {activeProfileId && onBackToHome && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onBackToHome}
          >
            홈으로
          </button>
        )}
      </header>

      <section className="card" aria-labelledby="profile-list-heading">
        <div className="card-header-row">
          <h2 id="profile-list-heading" className="card-title">
            등록된 프로필 ({profiles.length}명)
          </h2>
        </div>

        {profiles.length === 0 ? (
          <p className="empty-state">
            아직 등록된 프로필이 없습니다. 아래에서 새 프로필을 만들어 학습을 시작하세요.
          </p>
        ) : (
          <ul className="profile-list">
            {profiles.map((profile) => {
              const avatar = getAvatarPreset(profile.avatarId);
              const summary = profileSummaries[profile.id];
              const isActive = profile.id === activeProfileId;
              return (
                <li
                  key={profile.id}
                  className={`profile-card${isActive ? ' is-active' : ''}`}
                >
                  <button
                    type="button"
                    className="profile-select-btn"
                    onClick={() => void onSelectProfile(profile.id)}
                    aria-label={`${profile.name} 프로필로 시작`}
                  >
                    <span
                      className="avatar-badge"
                      style={{
                        backgroundColor: avatar.bg,
                        color: avatar.color,
                      }}
                      aria-hidden="true"
                    >
                      {avatar.icon}
                    </span>
                    <span className="profile-info">
                      <span className="profile-name-row">
                        <strong className="profile-name">{profile.name}</strong>
                        {isActive && (
                          <span className="pill pill-primary">현재 선택</span>
                        )}
                        {summary?.hasActiveSession && (
                          <span className="pill pill-info">
                            진행 중 ({summary.activeSessionAnswered}/
                            {summary.activeSessionTotal})
                          </span>
                        )}
                      </span>
                      <span className="profile-meta">
                        최근 학습: {formatKoreanDate(summary?.lastStudiedAt)} ·
                        복습 대기 {summary?.pendingReviewCount ?? 0}개
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-sm"
                    onClick={() => setDeleteTarget(profile)}
                    aria-label={`${profile.name} 프로필 삭제`}
                  >
                    삭제
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="profile-create-heading">
        <h2 id="profile-create-heading" className="card-title">
          새 프로필 추가
        </h2>
        <form onSubmit={handleCreateSubmit} className="form-stack">
          <div className="field-group">
            <label htmlFor="new-profile-name" className="field-label">
              이름 (1~12자)
            </label>
            <input
              id="new-profile-name"
              type="text"
              className="text-input"
              placeholder="예: 민수, 엄마, 지혜"
              maxLength={20}
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                if (createError) setCreateError(null);
              }}
            />
          </div>

          <div className="field-group">
            <span className="field-label">아바타 선택</span>
            <div className="avatar-grid" role="group" aria-label="아바타 선택">
              {AVATAR_PRESETS.map((preset) => {
                const selected = selectedAvatarId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`avatar-option${selected ? ' is-selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => setSelectedAvatarId(preset.id)}
                  >
                    <span
                      className="avatar-option-icon"
                      style={{ backgroundColor: preset.bg, color: preset.color }}
                      aria-hidden="true"
                    >
                      {preset.icon}
                    </span>
                    <span className="avatar-option-label">{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {createError && (
            <div className="alert alert-error" role="alert">
              <span aria-hidden="true">✕</span>
              <span>{createError}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={isCreating}
          >
            {isCreating ? '추가 중...' : '프로필 추가'}
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="storage-backup-heading">
        <h2 id="storage-backup-heading" className="card-title">
          저장 공간 &amp; JSON 백업
        </h2>

        {usage && (
          <div className="storage-usage-box">
            <div className="storage-usage-header">
              <span>기기 저장 공간 사용량</span>
              <span>
                {formatBytesKb(usage.usedBytes)} / {formatBytesKb(usage.quotaBytes)} ({usagePercent}%)
              </span>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div
                className={`progress-fill${usage.isWarning ? ' is-warning' : ''}`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            {usage.isWarning && (
              <div className="alert alert-warning" role="alert">
                <span aria-hidden="true">⚠</span>
                <span>
                  저장 공간 사용량이 80% 이상입니다. JSON 파일로 백업한 뒤 오래된 프로필이나 기록을 정리해 주세요.
                </span>
              </div>
            )}
          </div>
        )}

        <div className="backup-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleExportClick()}
          >
            전체 데이터 내보내기(JSON)
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            백업 파일 불러오기(JSON)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="sr-only-input"
            aria-label="백업 파일 불러오기(JSON)"
            data-testid="backup-file-input"
            onChange={(e) => void handleFileChange(e)}
          />
        </div>

        {backupStatus && (
          <div className="alert alert-success" role="status">
            <span aria-hidden="true">✓</span>
            <span>{backupStatus}</span>
          </div>
        )}

        {backupError && (
          <div className="alert alert-error" role="alert">
            <span aria-hidden="true">✕</span>
            <span>{backupError}</span>
          </div>
        )}
      </section>

      <footer className="v2-notice-badge" aria-label="2차 업데이트 안내">
        2차 업데이트 안내: 추후 로그인 기반 클라우드 동기화 및 주간 순위 지원 예정
      </footer>

      {deleteTarget && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div className="modal-card">
            <h3 id="delete-modal-title" className="modal-title">
              프로필을 삭제할까요?
            </h3>
            <p className="modal-body">
              {deleteTarget.name}님의 모든 학습·복습 기록이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={isDeleting}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
              >
                {isDeleting ? '삭제 중...' : '삭제 확인'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingImport && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-modal-title"
        >
          <div className="modal-card">
            <h3 id="import-modal-title" className="modal-title">
              현재 기기 데이터를 덮어쓸까요?
            </h3>
            <p className="modal-body">
              백업 파일에 프로필 {pendingImport.profiles.length}명(데이터 버전{' '}
              {pendingImport.dataVersion})이 포함되어 있습니다. 복원 방식을 선택해 주세요.
            </p>
            <div className="modal-actions-stack">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleConfirmImport('replace')}
                disabled={isImporting}
              >
                덮어쓰기 (현재 데이터 교체)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handleConfirmImport('merge')}
                disabled={isImporting}
              >
                기존 데이터와 병합
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPendingImport(null)}
                disabled={isImporting}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
