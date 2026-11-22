export type QuestionType =
  | 'hanja_to_choice'
  | 'hanja_to_input'
  | 'reading_to_choice'
  | 'reading_to_write';

export type ReadingStatus = 'pending' | 'draft' | 'verified';

export type StrokeStatus = 'pending' | 'draft' | 'verified' | 'unavailable';

export interface CharacterReading {
  sound: string;
  meanings: string[];
  allowedSounds?: string[];
}

export interface StrokeDataRef {
  provider: string;
  key: string;
  version: string;
}

export interface Character {
  id: string;
  character: string;
  codePoint: string;
  readings: CharacterReading[];
  readingStatus: ReadingStatus;
  strokeData?: StrokeDataRef | null;
  strokeStatus: StrokeStatus;
  readingVerifiedAt?: string;
  readingSourceIds?: string[];
}

export interface CharacterCatalog {
  schemaVersion: number;
  dataVersion: string;
  updatedAt: string;
  readingSourceFile?: string;
  characters: Character[];
}

export interface TextbookSource {
  title: string;
  url: string;
}

export interface TextbookCounts {
  units: number;
  entries: number;
  uniqueCharacters: number;
}

export interface TextbookUnit {
  id: string;
  number: number;
  title: string;
  sourcePages: number[];
  characterIds: string[];
}

export interface Textbook {
  schemaVersion: number;
  dataVersion: string;
  updatedAt: string;
  id: string;
  title: string;
  publisher: string;
  leadAuthor: string;
  curriculumRevision: string;
  scope: string;
  sourceEditionStatus?: string;
  verifiedAgainstPhysicalBook?: boolean;
  sourceReference?: string;
  sources?: TextbookSource[];
  orderBasis?: string;
  counts: TextbookCounts;
  units: TextbookUnit[];
}

export type StrokeRenderMode = 'fill' | 'stroke';

export type MedianPoint = [number, number];

export interface NormalizedStrokeEntry {
  id: string;
  character: string;
  codePoint: string;
  sound: string;
  meanings: string[];
  provider: string;
  sourceVersion: string;
  renderMode: StrokeRenderMode;
  strokeCount: number;
  strokes: string[];
  medians: MedianPoint[][];
  auditStatus?: string;
  needsManualReview?: boolean;
  isHighPriority159?: boolean;
  notes?: string;
}

export interface NormalizedStrokeChunk {
  schemaVersion: number;
  dataVersion: string;
  unitId: string;
  characters: NormalizedStrokeEntry[];
}

export interface StrokeIndexUnitChunk {
  unitId: string;
  number: number;
  title: string;
  file: string;
  characterCount: number;
  characterIds: string[];
}

export interface StrokeCoordinateSystem {
  viewBox: string;
  origin: string;
  xAxis: string;
  yAxis: string;
}

export interface StrokeIndex {
  schemaVersion: number;
  dataVersion: string;
  textbookId: string;
  coordinateSystem: StrokeCoordinateSystem;
  totalCharacters: number;
  unitChunks: StrokeIndexUnitChunk[];
  characterToUnits: Record<string, string[]>;
}
