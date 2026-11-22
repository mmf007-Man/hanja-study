import type { Character, CharacterReading, QuestionType } from '../types/catalog';
import type { AnswerErrorType, SessionMode } from '../types/storage';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  hanja_to_choice: '한자 → 뜻·음 (객관식)',
  hanja_to_input: '한자 → 뜻·음 (주관식)',
  reading_to_choice: '뜻·음 → 한자 (객관식)',
  reading_to_write: '한자 쓰기 (필순·획 보정)',
};

export const QUESTION_TYPE_SHORT_LABELS: Record<QuestionType, string> = {
  hanja_to_choice: '뜻·음 객관식',
  hanja_to_input: '뜻·음 주관식',
  reading_to_choice: '한자 객관식',
  reading_to_write: '한자 쓰기',
};

export const SESSION_MODE_LABELS: Record<SessionMode, string> = {
  normal: '일반 학습',
  review: '오답 복습',
  daily: '하루 도전',
};

export const ERROR_TYPE_LABELS: Record<AnswerErrorType, string> = {
  meaning_error: '뜻 오답',
  sound_error: '음 오답',
  both_error: '뜻·음 오답',
  pair_mismatch: '개별 존재하나 쌍 불일치',
  dont_know: '모르겠어요',
  abandoned: '중도 이탈',
};

export function formatDurationMs(ms: number): string {
  const safeSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatKoreanDate(isoString: string | null | undefined): string {
  if (!isoString) {
    return '학습 기록 없음';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '학습 기록 없음';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

export function formatReadingBadgeText(reading: CharacterReading): string {
  const meaningsText = reading.meanings.join(', ');
  const allowed =
    reading.allowedSounds && reading.allowedSounds.length > 0
      ? ` (${reading.allowedSounds.join(', ')})`
      : '';
  return `${meaningsText} · ${reading.sound}${allowed}`;
}

export function formatCharacterReadingsSummary(character: Character): string {
  return character.readings.map(formatReadingBadgeText).join(' / ');
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return '0% (0/0)';
  }
  const pct = Math.round((numerator / denominator) * 100);
  return `${pct}% (${numerator}/${denominator})`;
}

export function computeDistributionCounts(
  typeCount: number,
  questionCount = 20,
): number[] {
  if (typeCount <= 0) {
    return [];
  }
  const base = Math.floor(questionCount / typeCount);
  const remainder = questionCount % typeCount;
  return Array.from({ length: typeCount }, (_, index) =>
    base + (index < remainder ? 1 : 0),
  );
}
