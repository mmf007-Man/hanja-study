import type {
  Character,
  CharacterCatalog,
  Textbook,
  TextbookUnit,
} from '../types/catalog';

export const TEXTBOOK_ID = 'chunjae-middle-hanja-2022-ahn';
export const SUPPORTED_SCHEMA_VERSION = 1;
export const DEFAULT_CACHE_VERSION = '0.3.0';

export class CatalogLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogLoadError';
  }
}

export interface LoadCatalogOptions {
  fetchFn?: typeof fetch;
  baseUrl?: string;
  cacheVersion?: string;
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

function validateCatalogAndTextbook(
  catalog: CharacterCatalog,
  textbook: Textbook,
): void {
  if (
    !catalog ||
    typeof catalog !== 'object' ||
    !Array.isArray(catalog.characters)
  ) {
    throw new CatalogLoadError('유효하지 않은 한자 카탈로그 형식입니다.');
  }
  if (
    !textbook ||
    typeof textbook !== 'object' ||
    !Array.isArray(textbook.units)
  ) {
    throw new CatalogLoadError('유효하지 않은 교과서 데이터 형식입니다.');
  }
  if (catalog.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new CatalogLoadError(
      `지원하지 않는 카탈로그 schemaVersion입니다: ${String(catalog.schemaVersion)}`,
    );
  }
  if (textbook.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new CatalogLoadError(
      `지원하지 않는 교과서 schemaVersion입니다: ${String(textbook.schemaVersion)}`,
    );
  }
  if (
    typeof catalog.dataVersion !== 'string' ||
    catalog.dataVersion.trim() === ''
  ) {
    throw new CatalogLoadError('카탈로그 dataVersion이 비어 있습니다.');
  }
  if (catalog.dataVersion !== textbook.dataVersion) {
    throw new CatalogLoadError(
      `카탈로그(${catalog.dataVersion})와 교과서(${textbook.dataVersion})의 dataVersion이 일치하지 않습니다.`,
    );
  }
}

export class CatalogStore {
  readonly schemaVersion: number;
  readonly dataVersion: string;
  readonly updatedAt: string;
  readonly textbook: Textbook;
  readonly characters: readonly Character[];
  readonly units: readonly TextbookUnit[];

  private readonly byId: Map<string, Character>;
  private readonly unitById: Map<string, TextbookUnit>;

  constructor(catalog: CharacterCatalog, textbook: Textbook) {
    validateCatalogAndTextbook(catalog, textbook);

    const charMap = new Map<string, Character>();
    for (const char of catalog.characters) {
      if (charMap.has(char.id)) {
        throw new CatalogLoadError(`중복된 한자 ID가 있습니다: ${char.id}`);
      }
      charMap.set(char.id, char);
    }

    const unitMap = new Map<string, TextbookUnit>();
    for (const unit of textbook.units) {
      if (unitMap.has(unit.id)) {
        throw new CatalogLoadError(`중복된 단원 ID가 있습니다: ${unit.id}`);
      }
      for (const charId of unit.characterIds) {
        if (!charMap.has(charId)) {
          throw new CatalogLoadError(
            `단원(${unit.id})이 존재하지 않는 한자 ID(${charId})를 참조합니다.`,
          );
        }
      }
      unitMap.set(unit.id, unit);
    }

    this.schemaVersion = catalog.schemaVersion;
    this.dataVersion = catalog.dataVersion;
    this.updatedAt = catalog.updatedAt;
    this.textbook = textbook;
    this.characters = catalog.characters;
    this.units = textbook.units;
    this.byId = charMap;
    this.unitById = unitMap;
  }

  getCharacterById(characterId: string): Character | undefined {
    return this.byId.get(characterId);
  }

  getUnitById(unitId: string): TextbookUnit | undefined {
    return this.unitById.get(unitId);
  }

  /**
   * 선택한 단원(미지정 시 전체 단원)의 한자를 교과서 단원/수록 순서대로 중복 없이 반환한다.
   */
  getCharactersForUnits(unitIds?: readonly string[]): Character[] {
    let targetUnits: readonly TextbookUnit[];

    if (unitIds === undefined) {
      targetUnits = this.units;
    } else {
      const requestedSet = new Set<string>();
      for (const id of unitIds) {
        if (!this.unitById.has(id)) {
          throw new CatalogLoadError(`알 수 없는 단원 ID입니다: ${id}`);
        }
        requestedSet.add(id);
      }
      if (requestedSet.size === 0) {
        return [];
      }
      targetUnits = this.units.filter((unit) => requestedSet.has(unit.id));
    }

    const seenIds = new Set<string>();
    const result: Character[] = [];

    for (const unit of targetUnits) {
      for (const charId of unit.characterIds) {
        if (seenIds.has(charId)) {
          continue;
        }
        const char = this.byId.get(charId);
        if (char) {
          seenIds.add(charId);
          result.push(char);
        }
      }
    }

    return result;
  }

  getReadingCandidates(unitIds?: readonly string[]): Character[] {
    return this.getCharactersForUnits(unitIds).filter(
      (char) => char.readingStatus === 'verified',
    );
  }

  getWritingCandidates(unitIds?: readonly string[]): Character[] {
    return this.getCharactersForUnits(unitIds).filter(
      (char) =>
        char.readingStatus === 'verified' && char.strokeStatus === 'verified',
    );
  }
}

async function fetchJson<T>(fetchFn: typeof fetch, url: string): Promise<T> {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new CatalogLoadError(
      `데이터 요청 실패 (${response.status} ${response.statusText}): ${url}`,
    );
  }
  return (await response.json()) as T;
}

export async function loadCatalogStore(
  options: LoadCatalogOptions = {},
): Promise<CatalogStore> {
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  if (!fetchFn) {
    throw new CatalogLoadError('사용 가능한 fetch 구현이 없습니다.');
  }

  const baseUrl = options.baseUrl ?? getDefaultBaseUrl();
  const cacheVersion = options.cacheVersion ?? DEFAULT_CACHE_VERSION;
  const query = `?v=${encodeURIComponent(cacheVersion)}`;

  const charactersUrl = `${joinBaseUrl(baseUrl, 'data/characters.json')}${query}`;
  const textbookUrl = `${joinBaseUrl(baseUrl, `data/textbooks/${TEXTBOOK_ID}.json`)}${query}`;

  const [catalog, textbook] = await Promise.all([
    fetchJson<CharacterCatalog>(fetchFn, charactersUrl),
    fetchJson<Textbook>(fetchFn, textbookUrl),
  ]);

  return new CatalogStore(catalog, textbook);
}
