export {
  createSeededRng,
  getLocalDateKey,
  shuffleWithRng,
} from './prng';

export {
  ALL_QUESTION_TYPES,
  DEFAULT_QUESTION_COUNT,
  QuestionGenerationError,
  buildMcqQuestion,
  compareTimestampsAsc,
  generateDailyQuestions,
  generateNormalQuestions,
  generateQuestionForCharacter,
  getCharacterExposureSummary,
  hasReadingOverlap,
  makeReadingKey,
  selectReadingPair,
  validateGenerationConfig,
  type BuildQuestionOptions,
  type GenerateDailyQuestionsOptions,
  type GenerateNormalQuestionsOptions,
  type GenerationConfigInput,
  type GenerationValidationResult,
} from './questionGenerator';

export {
  calculateSessionMetrics,
  canSubmitAnswer,
  createAbandonedAnswer,
  gradeDontKnow,
  gradeSubmission,
  normalizeAnswer,
  type AnswerDraft,
  type GradingResult,
  type SessionMetrics,
} from './gradingEngine';

export {
  applySessionOutcomeToReviewQueue,
  makeReviewItemId,
  resetReviewSessionStreaks,
  selectNextReviewQuestion,
  type SelectNextReviewOptions,
} from './reviewQueueEngine';

export {
  ActiveSessionConflictError,
  SessionEngine,
  SessionEngineError,
  type StartDailySessionOptions,
  type StartNormalSessionOptions,
  type StartReviewSessionOptions,
  type SubmitQuestionResult,
} from './sessionEngine';

export {
  FONT_TRANSFORM_Y,
  STROKE_PRESETS,
  calcCosineSimilarity,
  calcPathLength,
  convertMedianToSvg,
  dist,
  evaluateStroke,
  getBoundingBox,
  resamplePoints,
  type BoundingBox,
  type MedianPoint,
  type StrokeConfig,
  type StrokeEvalChecks,
  type StrokeEvalContext,
  type StrokeEvalMetrics,
  type StrokeEvalOptions,
  type StrokeEvalResult,
  type StrokeFailReason,
  type StrokePoint,
  type StrokePresetName,
} from './strokeEngine';

export {
  DOTTED_GUIDE_FAILURE_THRESHOLD,
  applyStrokeAttemptResult,
  createStrokeAttemptState,
  resetStrokeAttempt,
  type StrokeAttemptState,
  type StrokeFeedbackTone,
} from './strokeSession';
