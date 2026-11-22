import React, { useMemo, useState } from 'react';
import type { CatalogStore } from '../data/catalogStore';
import {
  ALL_QUESTION_TYPES,
  DEFAULT_QUESTION_COUNT,
  validateGenerationConfig,
} from '../engine/questionGenerator';
import { ActiveSessionConflictError } from '../engine/sessionEngine';
import type { QuestionType } from '../types/catalog';
import type { SessionSnapshot } from '../types/storage';
import {
  QUESTION_TYPE_LABELS,
  SESSION_MODE_LABELS,
  computeDistributionCounts,
} from '../utils/labels';

export interface StudySetupScreenProps {
  catalog: CatalogStore;
  activeSession: SessionSnapshot | null;
  onBack: () => void;
  onStartSession: (
    unitIds: string[],
    selectedTypes: QuestionType[],
    forceReplace?: boolean,
  ) => Promise<void>;
  onResumeActiveSession: () => void;
}

export const StudySetupScreen: React.FC<StudySetupScreenProps> = ({
  catalog,
  activeSession,
  onBack,
  onStartSession,
  onResumeActiveSession,
}) => {
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>(() =>
    catalog.units.map((u) => u.id),
  );
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>([
    'hanja_to_choice',
    'hanja_to_input',
    'reading_to_choice',
  ]);
  const [conflictSession, setConflictSession] =
    useState<SessionSnapshot | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const unitStats = useMemo(
    () =>
      catalog.units.map((unit) => ({
        unit,
        totalCount: unit.characterIds.length,
        writingCount: catalog.getWritingCandidates([unit.id]).length,
      })),
    [catalog],
  );

  const validation = useMemo(
    () =>
      validateGenerationConfig(catalog, {
        unitIds: selectedUnitIds,
        selectedTypes,
      }),
    [catalog, selectedUnitIds, selectedTypes],
  );

  const uniqueSelectedCount = useMemo(() => {
    if (selectedUnitIds.length === 0) return 0;
    return catalog.getReadingCandidates(selectedUnitIds).length;
  }, [catalog, selectedUnitIds]);

  const distributionCounts = useMemo(
    () =>
      computeDistributionCounts(
        validation.effectiveTypes.length,
        DEFAULT_QUESTION_COUNT,
      ),
    [validation.effectiveTypes.length],
  );

  const toggleUnit = (unitId: string) => {
    setSelectedUnitIds((prev) =>
      prev.includes(unitId)
        ? prev.filter((id) => id !== unitId)
        : [...prev, unitId],
    );
  };

  const toggleType = (type: QuestionType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const handleStart = async (forceReplace = false) => {
    if (!validation.valid) return;
    setSubmitError(null);
    setIsStarting(true);
    try {
      await onStartSession(selectedUnitIds, selectedTypes, forceReplace);
      setConflictSession(null);
    } catch (error) {
      if (error instanceof ActiveSessionConflictError) {
        setConflictSession(error.activeSession);
      } else {
        setSubmitError(
          error instanceof Error
            ? error.message
            : '학습 회차를 시작하는 중 오류가 발생했습니다.',
        );
      }
    } finally {
      setIsStarting(false);
    }
  };

  const resolvedConflict = conflictSession ?? null;

  return (
    <div className="screen-stack" data-testid="study-setup-screen">
      <header className="top-nav-bar">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          ← 홈으로
        </button>
        <h1 className="screen-title-sm">일반 학습 설정</h1>
      </header>

      {!validation.valid && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">✕</span>
          <div>
            {validation.errors.map((err, idx) => (
              <div key={idx}>{err}</div>
            ))}
          </div>
        </div>
      )}

      {validation.valid && validation.warnings.length > 0 && (
        <div className="alert alert-warning" role="status">
          <span aria-hidden="true">⚠</span>
          <div>
            {validation.warnings.map((warn, idx) => (
              <div key={idx}>{warn}</div>
            ))}
          </div>
        </div>
      )}

      <section className="card" aria-labelledby="unit-select-heading">
        <div className="card-header-row">
          <div>
            <h2 id="unit-select-heading" className="card-title">
              단원 선택 ({selectedUnitIds.length} / {catalog.units.length}단원)
            </h2>
            <p className="card-subtitle">
              선택 범위 고유 한자: <strong>{uniqueSelectedCount}자</strong>
            </p>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                setSelectedUnitIds(catalog.units.map((u) => u.id))
              }
            >
              전체 선택
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSelectedUnitIds([])}
            >
              선택 해제
            </button>
          </div>
        </div>

        {selectedUnitIds.length > 0 && uniqueSelectedCount < DEFAULT_QUESTION_COUNT && (
          <p className="info-note">
            20자 미만 범위: 전수 출제 후 적은 횟수 순으로 반복해 20문제를 채웁니다.
          </p>
        )}

        <div className="unit-checkbox-grid">
          {unitStats.map(({ unit, totalCount, writingCount }) => {
            const checked = selectedUnitIds.includes(unit.id);
            return (
              <label
                key={unit.id}
                className={`unit-checkbox-item${checked ? ' is-checked' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleUnit(unit.id)}
                />
                <span className="unit-checkbox-body">
                  <span className="unit-checkbox-title">
                    {unit.number}단원 · {unit.title}
                  </span>
                  <span className="unit-checkbox-meta">
                    {totalCount}자 · 쓰기 {writingCount}자
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="card" aria-labelledby="type-select-heading">
        <h2 id="type-select-heading" className="card-title">
          문제 유형 선택
        </h2>

        <div className="type-toggle-list">
          {ALL_QUESTION_TYPES.map((type) => {
            const checked = selectedTypes.includes(type);
            const candidateCount = validation.candidatesByType[type].length;
            return (
              <label
                key={type}
                className={`type-toggle-item${checked ? ' is-checked' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleType(type)}
                />
                <span className="type-toggle-body">
                  <span className="type-toggle-title">
                    {QUESTION_TYPE_LABELS[type]}
                  </span>
                  <span className="type-toggle-meta">
                    출제 가능 {candidateCount}자
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {distributionCounts.length > 0 && (
          <p className="distribution-preview">
            {distributionCounts.join(' · ')}문제 무작위 배분 및 순서 섞기 (총{' '}
            {DEFAULT_QUESTION_COUNT}문항)
          </p>
        )}
      </section>

      {submitError && (
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">✕</span>
          <span>{submitError}</span>
        </div>
      )}

      <div className="sticky-action-footer">
        {activeSession && (
          <p className="field-hint">
            진행 중인 회차({SESSION_MODE_LABELS[activeSession.mode]},{' '}
            {activeSession.answers.length}/{activeSession.questions.length})가 있습니다.
          </p>
        )}
        <button
          type="button"
          className="btn btn-primary btn-block btn-lg"
          disabled={!validation.valid || isStarting}
          onClick={() => void handleStart(false)}
        >
          {isStarting ? '문항 준비 중...' : '시작'}
        </button>
      </div>

      {resolvedConflict && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="conflict-modal-title"
        >
          <div className="modal-card">
            <h3 id="conflict-modal-title" className="modal-title">
              진행 중인 학습이 있습니다
            </h3>
            <p className="modal-body">
              {SESSION_MODE_LABELS[resolvedConflict.mode]} ({resolvedConflict.answers.length}/
              {resolvedConflict.questions.length}문항 진행)을 이어서 풀거나, 기존 회차를 끝내고 새로 시작할 수 있습니다.
            </p>
            <div className="modal-actions-stack">
              <button
                type="button"
                className="btn btn-primary"
                onClick={onResumeActiveSession}
              >
                이어하기
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handleStart(true)}
                disabled={isStarting}
              >
                기존 회차 끝내고 새로 시작
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConflictSession(null)}
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
