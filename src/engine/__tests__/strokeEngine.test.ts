import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  MedianPoint,
  NormalizedStrokeChunk,
  NormalizedStrokeEntry,
  StrokeIndex,
} from '../../types/catalog';
import {
  FONT_TRANSFORM_Y,
  STROKE_PRESETS,
  calcCosineSimilarity,
  calcPathLength,
  convertMedianToSvg,
  dist,
  evaluateStroke,
  getBoundingBox,
  resamplePoints,
} from '../strokeEngine';

const PROJECT_ROOT = path.resolve(process.cwd());
const PUBLIC_STROKES_DIR = path.join(PROJECT_ROOT, 'public', 'data', 'strokes');
const SAMPLE_STROKES_PATH = path.join(
  PROJECT_ROOT,
  'prototype',
  'stroke-assist',
  'data',
  'sample-strokes.json',
);

interface SampleStrokeData {
  strokes: string[];
  medians: MedianPoint[][];
}

function loadSampleStrokes(): Record<string, SampleStrokeData> {
  return JSON.parse(fs.readFileSync(SAMPLE_STROKES_PATH, 'utf-8')) as Record<
    string,
    SampleStrokeData
  >;
}

function loadAllChunkEntries(): {
  index: StrokeIndex;
  entriesByChar: Map<string, NormalizedStrokeEntry>;
  allUniqueEntries: NormalizedStrokeEntry[];
} {
  const index = JSON.parse(
    fs.readFileSync(path.join(PUBLIC_STROKES_DIR, 'index.json'), 'utf-8'),
  ) as StrokeIndex;

  const entriesByChar = new Map<string, NormalizedStrokeEntry>();
  const allUniqueEntries: NormalizedStrokeEntry[] = [];

  for (const unitMeta of index.unitChunks) {
    const chunkPath = path.join(PUBLIC_STROKES_DIR, unitMeta.file);
    const chunk = JSON.parse(fs.readFileSync(chunkPath, 'utf-8')) as NormalizedStrokeChunk;
    for (const entry of chunk.characters) {
      if (!entriesByChar.has(entry.character)) {
        entriesByChar.set(entry.character, entry);
        allUniqueEntries.push(entry);
      }
    }
  }

  return { index, entriesByChar, allUniqueEntries };
}

describe('strokeEngine', () => {
  const samples = loadSampleStrokes();
  const { index, entriesByChar, allUniqueEntries } = loadAllChunkEntries();

  it('exports finalized Phase 03 presets and geometry helpers', () => {
    expect(FONT_TRANSFORM_Y).toBe(900);
    expect(STROKE_PRESETS.normal).toEqual({
      name: '보통 (Normal)',
      startTolerance: 165,
      endTolerance: 185,
      avgTolerance: 140,
      minCosine: 0.60,
      minRatio: 0.55,
      maxRatio: 1.65,
    });

    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(calcPathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 8 }])).toBe(10);
    expect(resamplePoints([{ x: 0, y: 0 }, { x: 100, y: 0 }], 5)).toHaveLength(5);
    expect(getBoundingBox([{ x: 10, y: 20 }, { x: 50, y: 80 }])).toEqual({
      minX: 10,
      maxX: 50,
      minY: 20,
      maxY: 80,
      width: 40,
      height: 60,
    });
    expect(calcCosineSimilarity({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(0);
    expect(calcCosineSimilarity({ x: 1, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(-1);
  });

  it('supports both font-inverted (isTopDown: false) and top-down (default isTopDown: true) coordinates', () => {
    const tuSample = samples['土']!;
    const tuSvgPoints = convertMedianToSvg(tuSample.medians[0]!, false);
    expect(tuSvgPoints[0]).toEqual({
      x: tuSample.medians[0]![0]![0],
      y: FONT_TRANSFORM_Y - tuSample.medians[0]![0]![1],
    });

    const fontRes = evaluateStroke(
      tuSvgPoints,
      tuSample.medians[0]!,
      STROKE_PRESETS.normal,
      { character: '土', strokeIndex: 0, isTopDown: false },
    );
    expect(fontRes.pass).toBe(true);
    expect(fontRes.reason).toBe('pass');
    expect(fontRes.score).toBe(100);

    // Also verify options.isTopDown: false works when context omits it
    const fontResFromOpt = evaluateStroke(
      tuSvgPoints,
      tuSample.medians[0]!,
      { ...STROKE_PRESETS.normal, isTopDown: false },
      { character: '土', strokeIndex: 0 },
    );
    expect(fontResFromOpt.pass).toBe(true);

    // Default top-down coordinate system with normalized chunk entry (漢)
    const hanEntry = entriesByChar.get('漢')!;
    expect(hanEntry).toBeDefined();
    const hanMed0Svg = convertMedianToSvg(hanEntry.medians[0]!, true);
    const topDownRes = evaluateStroke(hanMed0Svg, hanEntry.medians[0]!, STROKE_PRESETS.normal, {
      character: '漢',
      strokeIndex: 0,
    });
    expect(topDownRes.pass).toBe(true);
    expect(topDownRes.score).toBe(100);
  });

  it('detects all failure reasons in the expected priority order', () => {
    const horizontalMedian: MedianPoint[] = [
      [200, 500],
      [500, 500],
      [800, 500],
    ];

    // too_few_points
    expect(evaluateStroke([], horizontalMedian).reason).toBe('too_few_points');
    expect(evaluateStroke([{ x: 200, y: 500 }], horizontalMedian).reason).toBe('too_few_points');

    // dot_too_small (< 25)
    const dotRes = evaluateStroke(
      [{ x: 200, y: 500 }, { x: 210, y: 505 }],
      horizontalMedian,
    );
    expect(dotRes.pass).toBe(false);
    expect(dotRes.reason).toBe('dot_too_small');

    // reversed_stroke
    const reversedRes = evaluateStroke(
      [{ x: 800, y: 500 }, { x: 200, y: 500 }],
      horizontalMedian,
    );
    expect(reversedRes.pass).toBe(false);
    expect(reversedRes.reason).toBe('reversed_stroke');
    expect(reversedRes.metrics.isReversed).toBe(true);

    // start_point_mismatch
    const startFailRes = evaluateStroke(
      [{ x: 420, y: 500 }, { x: 800, y: 500 }],
      horizontalMedian,
    );
    expect(startFailRes.pass).toBe(false);
    expect(startFailRes.reason).toBe('start_point_mismatch');

    // wrong_direction
    const dirFailRes = evaluateStroke(
      [{ x: 200, y: 500 }, { x: 200, y: 900 }],
      horizontalMedian,
    );
    expect(dirFailRes.pass).toBe(false);
    expect(dirFailRes.reason).toBe('wrong_direction');

    // end_point_mismatch
    const endFailRes = evaluateStroke(
      [{ x: 200, y: 500 }, { x: 1050, y: 500 }],
      horizontalMedian,
    );
    expect(endFailRes.pass).toBe(false);
    expect(endFailRes.reason).toBe('end_point_mismatch');

    // too_short (U-shape target with straight shortcut between same endpoints)
    const uShapeMedian: MedianPoint[] = [
      [200, 300],
      [200, 700],
      [500, 700],
      [500, 300],
    ];
    const shortRes = evaluateStroke(
      [{ x: 200, y: 300 }, { x: 500, y: 300 }],
      uShapeMedian,
    );
    expect(shortRes.pass).toBe(false);
    expect(shortRes.reason).toBe('too_short');

    // too_long (straight short target with large detour)
    const shortTarget: MedianPoint[] = [
      [200, 500],
      [500, 500],
    ];
    const longRes = evaluateStroke(
      [
        { x: 200, y: 500 },
        { x: 200, y: 900 },
        { x: 500, y: 900 },
        { x: 500, y: 500 },
      ],
      shortTarget,
    );
    expect(longRes.pass).toBe(false);
    expect(longRes.reason).toBe('too_long');

    // trajectory_deviation (endpoints match, length ratio ~1.46 <= 1.65, middle deviates > 140)
    const trajRes = evaluateStroke(
      [
        { x: 200, y: 500 },
        { x: 500, y: 820 },
        { x: 800, y: 500 },
      ],
      horizontalMedian,
    );
    expect(trajRes.pass).toBe(false);
    expect(trajRes.reason).toBe('trajectory_deviation');
  });

  it('enforces 土/士 and 日/曰 discrimination rules and pass/reject boundaries', () => {
    const tuEntry = entriesByChar.get('土')!;
    const shiEntry = entriesByChar.get('士')!;
    const riEntry = entriesByChar.get('日')!;
    const yueEntry = entriesByChar.get('曰')!;

    // 土 stroke 0 too wide (> 560) -> special_char_rule
    const tuWideTop = evaluateStroke(
      [{ x: 150, y: 440 }, { x: 500, y: 440 }, { x: 850, y: 440 }],
      tuEntry.medians[0]!,
      STROKE_PRESETS.normal,
      { character: '土', strokeIndex: 0 },
    );
    expect(tuWideTop.pass).toBe(false);
    expect(tuWideTop.reason).toBe('special_char_rule');

    // 土 stroke 2 too short (< 500) -> special_char_rule
    const tuShortBottom = evaluateStroke(
      [{ x: 300, y: 850 }, { x: 500, y: 850 }, { x: 700, y: 850 }],
      tuEntry.medians[2]!,
      STROKE_PRESETS.normal,
      { character: '土', strokeIndex: 2 },
    );
    expect(tuShortBottom.pass).toBe(false);
    expect(tuShortBottom.reason).toBe('special_char_rule');

    // 士 stroke 0 too short (< 530) -> special_char_rule
    const shiShortTop = evaluateStroke(
      [{ x: 300, y: 460 }, { x: 500, y: 460 }, { x: 700, y: 460 }],
      shiEntry.medians[0]!,
      STROKE_PRESETS.normal,
      { character: '士', strokeIndex: 0 },
    );
    expect(shiShortTop.pass).toBe(false);
    expect(shiShortTop.reason).toBe('special_char_rule');

    // 士 stroke 2 too wide (> 540) -> special_char_rule
    const shiWideBottom = evaluateStroke(
      [{ x: 150, y: 850 }, { x: 500, y: 850 }, { x: 850, y: 850 }],
      shiEntry.medians[2]!,
      STROKE_PRESETS.normal,
      { character: '士', strokeIndex: 2 },
    );
    expect(shiWideBottom.pass).toBe(false);
    expect(shiWideBottom.reason).toBe('special_char_rule');

    // 日 stroke 1 drawn wide -> special_char_rule
    const riWide = evaluateStroke(
      [{ x: 200, y: 200 }, { x: 700, y: 200 }, { x: 700, y: 500 }],
      riEntry.medians[1]!,
      STROKE_PRESETS.normal,
      { character: '日', strokeIndex: 1 },
    );
    expect(riWide.pass).toBe(false);
    expect(riWide.reason).toBe('special_char_rule');

    // 曰 stroke 1 drawn tall -> special_char_rule
    const yueTall = evaluateStroke(
      [{ x: 300, y: 150 }, { x: 600, y: 150 }, { x: 600, y: 700 }],
      yueEntry.medians[1]!,
      STROKE_PRESETS.normal,
      { character: '曰', strokeIndex: 1 },
    );
    expect(yueTall.pass).toBe(false);
    expect(yueTall.reason).toBe('special_char_rule');
  });

  it('passes 100% of all 637 characters and 5,932 strokes across the 20 normalized runtime chunks', () => {
    expect(index.unitChunks).toHaveLength(20);
    expect(allUniqueEntries).toHaveLength(637);

    let totalStrokes = 0;
    let fillCount = 0;
    const strokeModeChars: string[] = [];

    for (const entry of allUniqueEntries) {
      if (entry.renderMode === 'stroke') {
        strokeModeChars.push(entry.character);
      } else if (entry.renderMode === 'fill') {
        fillCount += 1;
      }

      expect(entry.medians.length).toBe(entry.strokes.length);

      for (let sIdx = 0; sIdx < entry.medians.length; sIdx += 1) {
        totalStrokes += 1;
        const median = entry.medians[sIdx]!;
        const userPoints = convertMedianToSvg(median, true);

        const res = evaluateStroke(userPoints, median, STROKE_PRESETS.normal, {
          character: entry.character,
          strokeIndex: sIdx,
          totalStrokes: entry.medians.length,
          isTopDown: true,
          renderMode: entry.renderMode,
        });

        if (!res.pass) {
          throw new Error(
            `Stroke failed for ${entry.character} #${sIdx + 1}: ${res.reason} - ${res.feedback}`,
          );
        }
      }
    }

    expect(totalStrokes).toBe(5932);
    expect(fillCount).toBe(630);
    expect(strokeModeChars.sort()).toEqual(['厖', '姉', '爲', '硏', '絶', '郞', '顔'].sort());
  });
});
