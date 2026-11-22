import type { Character } from '../types/catalog';
import type {
  AnswerErrorType,
  AnswerRecord,
  FrozenQuestion,
} from '../types/storage';

export interface AnswerDraft {
  meaning?: string;
  sound?: string;
  characterId?: string;
  completed?: boolean;
  strokeGuideUsed?: boolean;
}

export interface GradingResult {
  record: AnswerRecord;
  shouldRevealAnswerImmediately: boolean;
  showPairMismatchWarning: boolean;
}

export interface SessionMetrics {
  totalScore: number;
  maxScore: number;
  confirmedCount: number;
  correctCount: number;
  incorrectCount: number;
  dontKnowCount: number;
  abandonedCount: number;
  readingGradedCount: number;
  meaningCorrectCount: number;
  soundCorrectCount: number;
  questionAccuracy: number;
  meaningAccuracy: number | null;
  soundAccuracy: number | null;
}

/**
 * Strip all whitespace from an answer string for grading comparison.
 * Display strings retain their original textbook formatting.
 */
export function normalizeAnswer(value: string): string {
  return value.replace(/\s+/g, '');
}

/**
 * Enforce required input/selection completeness before enabling normal submission.
 */
export function canSubmitAnswer(
  question: FrozenQuestion,
  draft: AnswerDraft,
): boolean {
  switch (question.questionType) {
    case 'hanja_to_choice':
    case 'hanja_to_input':
      return (
        typeof draft.meaning === 'string' &&
        normalizeAnswer(draft.meaning).length > 0 &&
        typeof draft.sound === 'string' &&
        normalizeAnswer(draft.sound).length > 0
      );
    case 'reading_to_choice':
      return (
        typeof draft.characterId === 'string' &&
        draft.characterId.trim().length > 0
      );
    case 'reading_to_write':
      return draft.completed === true;
  }
}

function classifyMeaningSoundError(
  meaningCorrect: boolean,
  soundCorrect: boolean,
  pairMatched: boolean,
): AnswerErrorType | undefined {
  if (pairMatched && meaningCorrect && soundCorrect) {
    return undefined;
  }
  if (meaningCorrect && soundCorrect && !pairMatched) {
    return 'pair_mismatch';
  }
  if (!meaningCorrect && !soundCorrect) {
    return 'both_error';
  }
  return meaningCorrect ? 'sound_error' : 'meaning_error';
}

function gradeHanjaToChoice(
  question: FrozenQuestion,
  character: Character,
  draft: AnswerDraft,
  submittedAt: string,
): GradingResult {
  const submittedMeaning = draft.meaning ?? '';
  const submittedSound = draft.sound ?? '';
  const normMeaning = normalizeAnswer(submittedMeaning);
  const normSound = normalizeAnswer(submittedSound);

  const meaningMatchesTarget =
    question.correctMeaning !== undefined
      ? normMeaning === normalizeAnswer(question.correctMeaning)
      : question.targetMeanings.some((m) => normalizeAnswer(m) === normMeaning);
  const soundMatchesTarget =
    normSound === normalizeAnswer(question.targetSound);

  let pairMatched = false;
  if (meaningMatchesTarget && soundMatchesTarget) {
    const targetReading = character.readings.find(
      (r) => normalizeAnswer(r.sound) === normalizeAnswer(question.targetSound),
    );
    pairMatched = targetReading
      ? targetReading.meanings.some((m) => normalizeAnswer(m) === normMeaning)
      : true;
  }

  const isCorrect = meaningMatchesTarget && soundMatchesTarget && pairMatched;
  const errorType = isCorrect
    ? undefined
    : classifyMeaningSoundError(
        meaningMatchesTarget,
        soundMatchesTarget,
        pairMatched,
      );

  const record: AnswerRecord = {
    questionId: question.questionId,
    characterId: question.characterId,
    questionType: question.questionType,
    targetSound: question.targetSound,
    score: isCorrect ? 2 : 0,
    outcome: isCorrect ? 'correct' : 'incorrect',
    meaningCorrect: meaningMatchesTarget,
    soundCorrect: soundMatchesTarget,
    pairMatched,
    submittedMeaning,
    submittedSound,
    submittedAt,
    ...(errorType !== undefined ? { errorType } : {}),
  };

  return {
    record,
    shouldRevealAnswerImmediately: false,
    showPairMismatchWarning: errorType === 'pair_mismatch',
  };
}

function gradeHanjaToInput(
  question: FrozenQuestion,
  character: Character,
  draft: AnswerDraft,
  submittedAt: string,
): GradingResult {
  const submittedMeaning = draft.meaning ?? '';
  const submittedSound = draft.sound ?? '';
  const normMeaning = normalizeAnswer(submittedMeaning);
  const normSound = normalizeAnswer(submittedSound);

  let meaningCorrect = false;
  let soundCorrect = false;
  let pairMatched = false;

  for (const reading of character.readings) {
    const matchesMeaning = reading.meanings.some(
      (m) => normalizeAnswer(m) === normMeaning,
    );
    const validSounds = [reading.sound, ...(reading.allowedSounds ?? [])];
    const matchesSound = validSounds.some(
      (s) => normalizeAnswer(s) === normSound,
    );

    if (matchesMeaning) {
      meaningCorrect = true;
    }
    if (matchesSound) {
      soundCorrect = true;
    }
    if (matchesMeaning && matchesSound) {
      pairMatched = true;
    }
  }

  const isCorrect = pairMatched;
  const errorType = isCorrect
    ? undefined
    : classifyMeaningSoundError(meaningCorrect, soundCorrect, pairMatched);

  const record: AnswerRecord = {
    questionId: question.questionId,
    characterId: question.characterId,
    questionType: question.questionType,
    targetSound: question.targetSound,
    score: isCorrect ? 2 : 0,
    outcome: isCorrect ? 'correct' : 'incorrect',
    meaningCorrect,
    soundCorrect,
    pairMatched,
    submittedMeaning,
    submittedSound,
    submittedAt,
    ...(errorType !== undefined ? { errorType } : {}),
  };

  return {
    record,
    shouldRevealAnswerImmediately: false,
    showPairMismatchWarning: errorType === 'pair_mismatch',
  };
}

/**
 * Grade a normal submitted answer.
 * Normal submissions show correctness/score immediately while withholding answer reveal until session end.
 */
export function gradeSubmission(
  question: FrozenQuestion,
  character: Character,
  draft: AnswerDraft,
  submittedAt: string,
): GradingResult {
  switch (question.questionType) {
    case 'hanja_to_choice':
      return gradeHanjaToChoice(question, character, draft, submittedAt);
    case 'hanja_to_input':
      return gradeHanjaToInput(question, character, draft, submittedAt);
    case 'reading_to_choice': {
      const submittedCharacterId = draft.characterId ?? '';
      const isCorrect = submittedCharacterId === question.characterId;
      return {
        record: {
          questionId: question.questionId,
          characterId: question.characterId,
          questionType: question.questionType,
          targetSound: question.targetSound,
          score: isCorrect ? 2 : 0,
          outcome: isCorrect ? 'correct' : 'incorrect',
          submittedCharacterId,
          submittedAt,
        },
        shouldRevealAnswerImmediately: false,
        showPairMismatchWarning: false,
      };
    }
    case 'reading_to_write': {
      const isCorrect = draft.completed === true;
      return {
        record: {
          questionId: question.questionId,
          characterId: question.characterId,
          questionType: question.questionType,
          targetSound: question.targetSound,
          score: isCorrect ? 2 : 0,
          outcome: isCorrect ? 'correct' : 'incorrect',
          strokeGuideUsed: Boolean(draft.strokeGuideUsed),
          submittedAt,
        },
        shouldRevealAnswerImmediately: false,
        showPairMismatchWarning: false,
      };
    }
  }
}

/**
 * Record a "모르겠어요" selection: 0 pts, immediate answer reveal, excluded from meaning/sound denominators.
 */
export function gradeDontKnow(
  question: FrozenQuestion,
  submittedAt: string,
): GradingResult {
  return {
    record: {
      questionId: question.questionId,
      characterId: question.characterId,
      questionType: question.questionType,
      targetSound: question.targetSound,
      score: 0,
      outcome: 'dont_know',
      errorType: 'dont_know',
      submittedAt,
    },
    shouldRevealAnswerImmediately: true,
    showPairMismatchWarning: false,
  };
}

/**
 * Record an exposed-but-unanswered question as abandoned upon mid-session exit.
 */
export function createAbandonedAnswer(
  question: FrozenQuestion,
  abandonedAt: string,
): AnswerRecord {
  return {
    questionId: question.questionId,
    characterId: question.characterId,
    questionType: question.questionType,
    targetSound: question.targetSound,
    score: 0,
    outcome: 'abandoned',
    errorType: 'abandoned',
    submittedAt: abandonedAt,
  };
}

/**
 * Compute question-level and reading-level accuracy metrics following spec formulas.
 */
export function calculateSessionMetrics(
  answers: readonly AnswerRecord[],
): SessionMetrics {
  let totalScore = 0;
  let confirmedCount = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let dontKnowCount = 0;
  let abandonedCount = 0;
  let readingGradedCount = 0;
  let meaningCorrectCount = 0;
  let soundCorrectCount = 0;

  for (const answer of answers) {
    if (answer.outcome === 'abandoned') {
      abandonedCount += 1;
      continue;
    }

    confirmedCount += 1;
    totalScore += answer.score;

    if (answer.outcome === 'correct') {
      correctCount += 1;
    } else if (answer.outcome === 'incorrect') {
      incorrectCount += 1;
    } else if (answer.outcome === 'dont_know') {
      dontKnowCount += 1;
    }

    if (
      (answer.questionType === 'hanja_to_choice' ||
        answer.questionType === 'hanja_to_input') &&
      (answer.outcome === 'correct' || answer.outcome === 'incorrect')
    ) {
      readingGradedCount += 1;
      if (answer.meaningCorrect === true) {
        meaningCorrectCount += 1;
      }
      if (answer.soundCorrect === true) {
        soundCorrectCount += 1;
      }
    }
  }

  return {
    totalScore,
    maxScore: confirmedCount * 2,
    confirmedCount,
    correctCount,
    incorrectCount,
    dontKnowCount,
    abandonedCount,
    readingGradedCount,
    meaningCorrectCount,
    soundCorrectCount,
    questionAccuracy: confirmedCount > 0 ? correctCount / confirmedCount : 0,
    meaningAccuracy:
      readingGradedCount > 0 ? meaningCorrectCount / readingGradedCount : null,
    soundAccuracy:
      readingGradedCount > 0 ? soundCorrectCount / readingGradedCount : null,
  };
}
