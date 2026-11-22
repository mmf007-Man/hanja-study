import type {
  NormalizedStrokeChunk,
  NormalizedStrokeEntry,
  StrokeIndex,
  StrokeIndexUnitChunk,
} from '../types/catalog';
import { SUPPORTED_SCHEMA_VERSION } from './catalogStore';

export class StrokeLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrokeLoadError';
  }
}

export interface StrokeLazyLoaderOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  dataVersion: string;
}

function joinBaseUrl(baseUrl: string, relativePath: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedRel = relativePath.replace(/^\/+/, '');
  return `${normalizedBase}${normalizedRel}`;
}

function getDefaultBaseUrl(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) {
    return import.meta.env.BASE_URL;
  }
  return './';
}

export class StrokeLazyLoader {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly dataVersion: string;

  private readonly cache = new Map<string, NormalizedStrokeEntry>();
  private readonly chunkMetaByUnit = new Map<string, StrokeIndexUnitChunk>();
  private readonly loadedUnits = new Set<string>();
  private readonly inFlightUnits = new Map<string, Promise<void>>();

  private indexData: StrokeIndex | null = null;
  private indexPromise: Promise<StrokeIndex> | null = null;

  constructor(options: StrokeLazyLoaderOptions) {
    const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
    if (!fetchFn) {
      throw new StrokeLoadError('사용 가능한 fetch 구현이 없습니다.');
    }
    if (!options.dataVersion || options.dataVersion.trim() === '') {
      throw new StrokeLoadError('유효한 dataVersion이 필요합니다.');
    }

    this.fetchFn = fetchFn;
    this.baseUrl = options.baseUrl ?? getDefaultBaseUrl();
    this.dataVersion = options.dataVersion;
  }

  getCachedStroke(characterId: string): NormalizedStrokeEntry | undefined {
    return this.cache.get(characterId);
  }

  hasCharacterStroke(characterId: string): boolean {
    return this.cache.has(characterId);
  }

  getCachedCount(): number {
    return this.cache.size;
  }

  getLoadedUnitCount(): number {
    return this.loadedUnits.size;
  }

  async loadIndex(): Promise<StrokeIndex> {
    if (this.indexData) {
      return this.indexData;
    }
    if (this.indexPromise) {
      return this.indexPromise;
    }

    const url = `${joinBaseUrl(this.baseUrl, 'data/strokes/index.json')}?v=${encodeURIComponent(this.dataVersion)}`;
    this.indexPromise = (async () => {
      try {
        const response = await this.fetchFn(url);
        if (!response.ok) {
          throw new StrokeLoadError(
            `획 인덱스 요청 실패 (${response.status} ${response.statusText}): ${url}`,
          );
        }
        const index = (await response.json()) as StrokeIndex;
        if (
          !index ||
          typeof index !== 'object' ||
          index.schemaVersion !== SUPPORTED_SCHEMA_VERSION
        ) {
          throw new StrokeLoadError('지원하지 않는 획 인덱스 schemaVersion입니다.');
        }
        if (index.dataVersion !== this.dataVersion) {
          throw new StrokeLoadError(
            `획 인덱스 dataVersion 불일치: expected=${this.dataVersion}, actual=${String(index.dataVersion)}`,
          );
        }
        if (!Array.isArray(index.unitChunks) || !index.characterToUnits) {
          throw new StrokeLoadError('유효하지 않은 획 인덱스 구조입니다.');
        }

        this.chunkMetaByUnit.clear();
        for (const chunk of index.unitChunks) {
          this.chunkMetaByUnit.set(chunk.unitId, chunk);
        }
        this.indexData = index;
        return index;
      } catch (error) {
        this.indexPromise = null;
        throw error;
      }
    })();

    return this.indexPromise;
  }

  async prefetchUnits(unitIds: readonly string[]): Promise<void> {
    if (unitIds.length === 0) {
      return;
    }

    await this.loadIndex();

    const uniqueUnitIds = Array.from(new Set(unitIds));
    await Promise.all(uniqueUnitIds.map((unitId) => this.loadUnitChunk(unitId)));
  }

  async loadCharacterStroke(
    characterId: string,
  ): Promise<NormalizedStrokeEntry> {
    const cached = this.cache.get(characterId);
    if (cached) {
      return cached;
    }

    const index = await this.loadIndex();
    const unitIds = index.characterToUnits[characterId];
    if (!unitIds || unitIds.length === 0) {
      throw new StrokeLoadError(
        `획 인덱스에서 한자(${characterId})의 단원을 찾을 수 없습니다.`,
      );
    }

    const targetUnitId = unitIds[0];
    if (!targetUnitId) {
      throw new StrokeLoadError(
        `획 인덱스에서 한자(${characterId})의 유효한 단원 ID를 찾을 수 없습니다.`,
      );
    }

    await this.prefetchUnits([targetUnitId]);

    const entry = this.cache.get(characterId);
    if (!entry) {
      throw new StrokeLoadError(
        `단원 청크(${targetUnitId})에 한자(${characterId})의 획 데이터가 없습니다.`,
      );
    }
    return entry;
  }

  private async loadUnitChunk(unitId: string): Promise<void> {
    if (this.loadedUnits.has(unitId)) {
      return;
    }

    const existingPromise = this.inFlightUnits.get(unitId);
    if (existingPromise) {
      return existingPromise;
    }

    const chunkMeta = this.chunkMetaByUnit.get(unitId);
    if (!chunkMeta) {
      throw new StrokeLoadError(`알 수 없는 단원 청크 ID입니다: ${unitId}`);
    }

    const url = `${joinBaseUrl(this.baseUrl, `data/strokes/${chunkMeta.file}`)}?v=${encodeURIComponent(this.dataVersion)}`;
    const loadPromise = (async () => {
      try {
        const response = await this.fetchFn(url);
        if (!response.ok) {
          throw new StrokeLoadError(
            `획 청크 요청 실패 (${response.status} ${response.statusText}): ${url}`,
          );
        }
        const chunk = (await response.json()) as NormalizedStrokeChunk;
        if (
          !chunk ||
          typeof chunk !== 'object' ||
          chunk.schemaVersion !== SUPPORTED_SCHEMA_VERSION
        ) {
          throw new StrokeLoadError(
            `지원하지 않는 획 청크 schemaVersion입니다: ${unitId}`,
          );
        }
        if (chunk.dataVersion !== this.dataVersion) {
          throw new StrokeLoadError(
            `획 청크(${unitId}) dataVersion 불일치: expected=${this.dataVersion}, actual=${String(chunk.dataVersion)}`,
          );
        }
        if (chunk.unitId !== unitId || !Array.isArray(chunk.characters)) {
          throw new StrokeLoadError(
            `유효하지 않은 획 청크 형식입니다: ${unitId}`,
          );
        }

        for (const entry of chunk.characters) {
          if (!this.cache.has(entry.id)) {
            this.cache.set(entry.id, entry);
          }
        }
        this.loadedUnits.add(unitId);
      } finally {
        this.inFlightUnits.delete(unitId);
      }
    })();

    this.inFlightUnits.set(unitId, loadPromise);
    return loadPromise;
  }
}
