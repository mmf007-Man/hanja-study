import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { StrokeLazyLoader, StrokeLoadError } from '../strokeLoader';
import { TEXTBOOK_ID } from '../catalogStore';

const PROJECT_ROOT = path.resolve(process.cwd());
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

function createPublicDataFetch(onRequest?: (url: string) => void): typeof fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    onRequest?.(url);

    const cleanPath = url.split('?')[0]!.replace(/^\/+/, '');
    const filePath = path.join(PUBLIC_DIR, cleanPath);

    if (!fs.existsSync(filePath)) {
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return new Response(content, { status: 200 });
  };
}

describe('StrokeLazyLoader', () => {
  it('performs 0 fetches on initialization and lazily loads only requested unit chunks', async () => {
    const requestedUrls: string[] = [];
    const loader = new StrokeLazyLoader({
      fetchFn: createPublicDataFetch((url) => requestedUrls.push(url)),
      baseUrl: '/',
      dataVersion: '0.3.0',
    });

    // Zero network requests on initialization
    expect(requestedUrls).toHaveLength(0);
    expect(loader.getCachedCount()).toBe(0);
    expect(loader.getLoadedUnitCount()).toBe(0);

    const unit01Id = `${TEXTBOOK_ID}-unit-01`;
    await loader.prefetchUnits([unit01Id]);

    expect(requestedUrls).toEqual([
      '/data/strokes/index.json?v=0.3.0',
      `/data/strokes/chunks/${unit01Id}.json?v=0.3.0`,
    ]);
    expect(loader.getLoadedUnitCount()).toBe(1);
    expect(loader.hasCharacterStroke('hanja-6F22')).toBe(true);

    // Loading cached character performs 0 additional fetches
    const hanEntry = await loader.loadCharacterStroke('hanja-6F22');
    expect(hanEntry.character).toBe('漢');
    expect(hanEntry.strokeCount).toBe(14);
    expect(hanEntry.renderMode).toBe('fill');
    expect(requestedUrls).toHaveLength(2);
  });

  it('deduplicates concurrent unit/index fetches and handles multi-unit character 者', async () => {
    let chunkFetchCount = 0;
    let indexFetchCount = 0;
    const baseFetch = createPublicDataFetch((url) => {
      if (url.includes('/data/strokes/index.json')) indexFetchCount += 1;
      if (url.includes('/data/strokes/chunks/')) chunkFetchCount += 1;
    });

    const loader = new StrokeLazyLoader({
      fetchFn: baseFetch,
      baseUrl: '/',
      dataVersion: '0.3.0',
    });

    const unit06Id = `${TEXTBOOK_ID}-unit-06`;
    const unit10Id = `${TEXTBOOK_ID}-unit-10`;

    // Concurrent calls for the same unit and duplicate character IDs
    await Promise.all([
      loader.prefetchUnits([unit06Id, unit06Id]),
      loader.prefetchUnits([unit06Id]),
      loader.loadCharacterStroke('hanja-8005'),
    ]);

    expect(indexFetchCount).toBe(1);
    expect(chunkFetchCount).toBe(1);
    expect(loader.hasCharacterStroke('hanja-8005')).toBe(true);

    // Prefetching unit 10 succeeds cleanly and keeps hanja-8005 cached
    await loader.prefetchUnits([unit10Id]);
    expect(chunkFetchCount).toBe(2);
    const jaEntry = await loader.loadCharacterStroke('hanja-8005');
    expect(jaEntry.character).toBe('者');
  });

  it('loads all 637 unique characters across the 20 generated chunks', async () => {
    const loader = new StrokeLazyLoader({
      fetchFn: createPublicDataFetch(),
      baseUrl: '/',
      dataVersion: '0.3.0',
    });

    const index = await loader.loadIndex();
    expect(index.totalCharacters).toBe(637);
    expect(index.unitChunks).toHaveLength(20);

    await loader.prefetchUnits(index.unitChunks.map((u) => u.unitId));
    expect(loader.getLoadedUnitCount()).toBe(20);
    expect(loader.getCachedCount()).toBe(637);
  });

  it('handles HTTP errors, version mismatch, and unknown IDs cleanly', async () => {
    const loader = new StrokeLazyLoader({
      fetchFn: createPublicDataFetch(),
      baseUrl: '/',
      dataVersion: '0.3.0',
    });

    await expect(loader.prefetchUnits(['non-existent-unit'])).rejects.toThrow(
      StrokeLoadError,
    );
    await expect(loader.loadCharacterStroke('hanja-FFFF')).rejects.toThrow(
      StrokeLoadError,
    );

    const wrongVersionLoader = new StrokeLazyLoader({
      fetchFn: createPublicDataFetch(),
      baseUrl: '/',
      dataVersion: '9.9.9',
    });
    await expect(wrongVersionLoader.loadIndex()).rejects.toThrow(
      StrokeLoadError,
    );

    let failNext = true;
    const baseFetch = createPublicDataFetch();
    const flakyLoader = new StrokeLazyLoader({
      fetchFn: async (input, init) => {
        if (failNext) {
          failNext = false;
          return new Response('Error', { status: 503, statusText: 'Unavailable' });
        }
        return baseFetch(input, init);
      },
      baseUrl: '/',
      dataVersion: '0.3.0',
    });

    await expect(flakyLoader.loadIndex()).rejects.toThrow(StrokeLoadError);
    // Retry succeeds because failed indexPromise was cleared
    const recoveredIndex = await flakyLoader.loadIndex();
    expect(recoveredIndex.totalCharacters).toBe(637);
  });
});
