import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CatalogLoadError,
  CatalogStore,
  TEXTBOOK_ID,
  loadCatalogStore,
} from '../catalogStore';
import type { CharacterCatalog, Textbook } from '../../types/catalog';

const PROJECT_ROOT = path.resolve(process.cwd());
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

function readProjectJson<T>(relativePath: string): T {
  const fullPath = path.join(DATA_DIR, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as T;
}

describe('CatalogStore & loadCatalogStore', () => {
  it('loads real data/characters.json and textbook with ?v= cache-busting and validates counts', async () => {
    const requestedUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      requestedUrls.push(url);

      if (url.includes('/data/characters.json?v=')) {
        const data = readProjectJson<CharacterCatalog>('characters.json');
        return new Response(JSON.stringify(data), { status: 200 });
      }
      if (url.includes(`/data/textbooks/${TEXTBOOK_ID}.json?v=`)) {
        const data = readProjectJson<Textbook>(`textbooks/${TEXTBOOK_ID}.json`);
        return new Response(JSON.stringify(data), { status: 200 });
      }
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    };

    const store = await loadCatalogStore({
      fetchFn: mockFetch,
      baseUrl: '/',
      cacheVersion: '0.3.0',
    });

    expect(requestedUrls).toEqual([
      '/data/characters.json?v=0.3.0',
      `/data/textbooks/${TEXTBOOK_ID}.json?v=0.3.0`,
    ]);
    expect(store.schemaVersion).toBe(1);
    expect(store.dataVersion).toBe('0.3.0');
    expect(store.units).toHaveLength(20);
    expect(store.characters).toHaveLength(637);
    expect(store.textbook.counts).toEqual({
      units: 20,
      entries: 638,
      uniqueCharacters: 637,
    });
    expect(store.getReadingCandidates()).toHaveLength(637);
    expect(store.getWritingCandidates()).toHaveLength(637);
  });

  it('preserves exact textbook units[].characterIds order and deduplicates 者 across Unit 6 & 10', () => {
    const catalog = readProjectJson<CharacterCatalog>('characters.json');
    const textbook = readProjectJson<Textbook>(`textbooks/${TEXTBOOK_ID}.json`);
    const store = new CatalogStore(catalog, textbook);

    const unit01 = store.getUnitById(`${TEXTBOOK_ID}-unit-01`);
    expect(unit01).toBeDefined();
    const unit01Chars = store.getReadingCandidates([unit01!.id]);
    expect(unit01Chars.map((c) => c.id)).toEqual(unit01!.characterIds);

    const unit06Id = `${TEXTBOOK_ID}-unit-06`;
    const unit10Id = `${TEXTBOOK_ID}-unit-10`;
    const unit06 = store.getUnitById(unit06Id)!;
    const unit10 = store.getUnitById(unit10Id)!;

    expect(unit06.characterIds).toContain('hanja-8005');
    expect(unit10.characterIds).toContain('hanja-8005');

    // Combined units deduplicate hanja-8005 while preserving unit order (Unit 6 first)
    const combined = store.getReadingCandidates([unit06Id, unit10Id]);
    const expectedCombinedCount =
      unit06.characterIds.length + unit10.characterIds.length - 1;
    expect(combined).toHaveLength(expectedCombinedCount);
    expect(combined.filter((c) => c.id === 'hanja-8005')).toHaveLength(1);

    // Passing unit-10 alone preserves unit-10 exact order including hanja-8005
    const onlyUnit10 = store.getReadingCandidates([unit10Id]);
    expect(onlyUnit10.map((c) => c.id)).toEqual(unit10.characterIds);
  });

  it('filters readingCandidates by readingStatus and writingCandidates by readingStatus + strokeStatus', () => {
    const catalog = readProjectJson<CharacterCatalog>('characters.json');
    const textbook = readProjectJson<Textbook>(`textbooks/${TEXTBOOK_ID}.json`);

    const modifiedCatalog: CharacterCatalog = {
      ...catalog,
      characters: catalog.characters.map((c, idx) => {
        if (idx === 0) {
          return { ...c, readingStatus: 'draft', strokeStatus: 'verified' };
        }
        if (idx === 1) {
          return { ...c, readingStatus: 'verified', strokeStatus: 'draft' };
        }
        return c;
      }),
    };

    const store = new CatalogStore(modifiedCatalog, textbook);
    const readingCandidates = store.getReadingCandidates();
    const writingCandidates = store.getWritingCandidates();

    expect(readingCandidates).toHaveLength(636);
    expect(readingCandidates.some((c) => c.id === catalog.characters[0]!.id)).toBe(false);
    expect(readingCandidates.some((c) => c.id === catalog.characters[1]!.id)).toBe(true);

    expect(writingCandidates).toHaveLength(635);
    expect(writingCandidates.some((c) => c.id === catalog.characters[0]!.id)).toBe(false);
    expect(writingCandidates.some((c) => c.id === catalog.characters[1]!.id)).toBe(false);
  });

  it('rejects schemaVersion/dataVersion mismatches, HTTP failures, and unknown unit IDs', async () => {
    const catalog = readProjectJson<CharacterCatalog>('characters.json');
    const textbook = readProjectJson<Textbook>(`textbooks/${TEXTBOOK_ID}.json`);

    expect(
      () =>
        new CatalogStore({ ...catalog, schemaVersion: 2 }, textbook),
    ).toThrow(CatalogLoadError);

    expect(
      () =>
        new CatalogStore(catalog, { ...textbook, dataVersion: '0.2.0' }),
    ).toThrow(CatalogLoadError);

    const store = new CatalogStore(catalog, textbook);
    expect(() => store.getReadingCandidates(['unknown-unit'])).toThrow(
      CatalogLoadError,
    );

    const failingFetch: typeof fetch = async () =>
      new Response('Server Error', { status: 500, statusText: 'Server Error' });
    await expect(
      loadCatalogStore({ fetchFn: failingFetch, baseUrl: './' }),
    ).rejects.toThrow(CatalogLoadError);
  });
});
