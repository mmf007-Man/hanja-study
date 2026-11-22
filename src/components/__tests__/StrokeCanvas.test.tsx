import fs from 'node:fs';
import path from 'node:path';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertMedianToSvg } from '../../engine/strokeEngine';
import type {
  NormalizedStrokeChunk,
  NormalizedStrokeEntry,
  StrokeIndex,
} from '../../types/catalog';
import { StrokeCanvas } from '../StrokeCanvas';

if (typeof globalThis.PointerEvent === 'undefined') {
  class MockPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
    }
  }
  globalThis.PointerEvent = MockPointerEvent as unknown as typeof PointerEvent;
}

const PUBLIC_STROKES_DIR = path.resolve(process.cwd(), 'public', 'data', 'strokes');

function loadEntryByChar(char: string): NormalizedStrokeEntry {
  const index = JSON.parse(
    fs.readFileSync(path.join(PUBLIC_STROKES_DIR, 'index.json'), 'utf-8'),
  ) as StrokeIndex;

  for (const unitMeta of index.unitChunks) {
    const chunk = JSON.parse(
      fs.readFileSync(path.join(PUBLIC_STROKES_DIR, unitMeta.file), 'utf-8'),
    ) as NormalizedStrokeChunk;
    const found = chunk.characters.find((entry) => entry.character === char);
    if (found) return found;
  }

  throw new Error(`Character not found in chunks: ${char}`);
}

const STAGE_SIZE = 512;

function drawStrokeOnCanvas(
  canvas: HTMLElement,
  points: Array<{ x: number; y: number }>,
  pointerId = 1,
): void {
  const scale = STAGE_SIZE / 1024;
  const first = points[0]!;
  fireEvent.pointerDown(canvas, {
    pointerId,
    clientX: first.x * scale,
    clientY: first.y * scale,
  });

  for (let i = 1; i < points.length; i += 1) {
    const pt = points[i]!;
    fireEvent.pointerMove(canvas, {
      pointerId,
      clientX: pt.x * scale,
      clientY: pt.y * scale,
    });
  }

  const last = points[points.length - 1]!;
  fireEvent.pointerUp(canvas, {
    pointerId,
    clientX: last.x * scale,
    clientY: last.y * scale,
  });
}

describe('StrokeCanvas', () => {
  const hanEntry = loadEntryByChar('漢'); // renderMode: 'fill'
  const sisterEntry = loadEntryByChar('姉'); // renderMode: 'stroke'
  const oneEntry = loadEntryByChar('一'); // 1 stroke
  const twoEntry = loadEntryByChar('二'); // 2 strokes

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: STAGE_SIZE,
      bottom: STAGE_SIZE,
      width: STAGE_SIZE,
      height: STAGE_SIZE,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders fill mode (漢) and stroke mode (姉) SVG path attributes properly', () => {
    expect(hanEntry.renderMode).toBe('fill');
    expect(sisterEntry.renderMode).toBe('stroke');

    const { rerender } = render(
      <StrokeCanvas strokeEntry={hanEntry} showGhostOutline totalStrokeHint />,
    );

    expect(screen.getByTestId('total-stroke-hint')).toHaveTextContent(
      `총획: ${hanEntry.strokeCount}획`,
    );

    const fillGhostPath = screen
      .getByTestId('ghost-outline-layer')
      .querySelector('path');
    expect(fillGhostPath).toHaveAttribute('fill', '#1e293b');
    expect(fillGhostPath).toHaveAttribute('stroke', 'none');

    // Pass stroke 0 of 漢
    const canvas = screen.getByTestId('stroke-drawing-canvas');
    drawStrokeOnCanvas(canvas, convertMedianToSvg(hanEntry.medians[0]!, true));
    act(() => {
      vi.advanceTimersByTime(120);
    });

    const fillSnappedPath = screen
      .getByTestId('snapped-strokes-layer')
      .querySelector('path');
    expect(fillSnappedPath).toHaveAttribute('fill', '#1e293b');
    expect(fillSnappedPath).toHaveAttribute('stroke', 'none');

    // Switch to 姉 (stroke mode) -> state resets and stroke-mode attributes are used
    rerender(<StrokeCanvas strokeEntry={sisterEntry} showGhostOutline />);
    expect(screen.getByTestId('stroke-counter')).toHaveTextContent(
      `현재 획: 1 / ${sisterEntry.strokeCount}`,
    );
    expect(
      screen.getByTestId('snapped-strokes-layer').querySelectorAll('path'),
    ).toHaveLength(0);

    const strokeGhostPath = screen
      .getByTestId('ghost-outline-layer')
      .querySelector('path');
    expect(strokeGhostPath).toHaveAttribute('fill', 'none');
    expect(strokeGhostPath).toHaveAttribute('stroke', '#1e293b');
    expect(strokeGhostPath).toHaveAttribute('stroke-width', '48');

    drawStrokeOnCanvas(
      screen.getByTestId('stroke-drawing-canvas'),
      convertMedianToSvg(sisterEntry.medians[0]!, true),
    );
    act(() => {
      vi.advanceTimersByTime(120);
    });

    const strokeSnappedPath = screen
      .getByTestId('snapped-strokes-layer')
      .querySelector('path');
    expect(strokeSnappedPath).toHaveAttribute('fill', 'none');
    expect(strokeSnappedPath).toHaveAttribute('stroke', '#1e293b');
    expect(strokeSnappedPath).toHaveAttribute('stroke-width', '54');
    expect(strokeSnappedPath).toHaveAttribute('stroke-linecap', 'round');
    expect(strokeSnappedPath).toHaveAttribute('stroke-linejoin', 'round');
  });

  it('shows dotted guide only after 3 consecutive failures and reports strokeGuideUsed on completion', () => {
    const onComplete = vi.fn();
    const onStrokeFail = vi.fn();
    const onStrokePass = vi.fn();

    render(
      <StrokeCanvas
        strokeEntry={twoEntry}
        onComplete={onComplete}
        onStrokeFail={onStrokeFail}
        onStrokePass={onStrokePass}
      />,
    );

    const canvas = screen.getByTestId('stroke-drawing-canvas');
    const reversedStroke0 = convertMedianToSvg(twoEntry.medians[0]!, true).reverse();

    // 1st failure -> no dotted guide
    drawStrokeOnCanvas(canvas, reversedStroke0);
    expect(onStrokeFail).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('dotted-guide-layer')).not.toBeInTheDocument();

    // 2nd failure -> still no dotted guide
    drawStrokeOnCanvas(canvas, reversedStroke0);
    expect(onStrokeFail).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('dotted-guide-layer')).not.toBeInTheDocument();

    // 3rd consecutive failure -> dotted guide appears automatically
    drawStrokeOnCanvas(canvas, reversedStroke0);
    expect(onStrokeFail).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('dotted-guide-layer')).toBeInTheDocument();
    expect(
      screen.getByTestId('snapped-strokes-layer').querySelectorAll('path'),
    ).toHaveLength(0);

    // Complete stroke 0 and stroke 1 cleanly
    drawStrokeOnCanvas(canvas, convertMedianToSvg(twoEntry.medians[0]!, true));
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(onStrokePass).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('dotted-guide-layer')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('snapped-strokes-layer').querySelectorAll('path'),
    ).toHaveLength(1);

    drawStrokeOnCanvas(canvas, convertMedianToSvg(twoEntry.medians[1]!, true));
    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(onStrokePass).toHaveBeenCalledTimes(2);
    expect(
      screen.getByTestId('snapped-strokes-layer').querySelectorAll('path'),
    ).toHaveLength(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      strokeGuideUsed: true,
      totalStrokes: 2,
    });
  });

  it('resets snapped strokes and stroke counter when clicking 처음부터 다시', () => {
    const onReset = vi.fn();
    render(<StrokeCanvas strokeEntry={twoEntry} onReset={onReset} />);

    const canvas = screen.getByTestId('stroke-drawing-canvas');
    drawStrokeOnCanvas(canvas, convertMedianToSvg(twoEntry.medians[0]!, true));
    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getByTestId('stroke-counter')).toHaveTextContent('현재 획: 2 / 2');
    expect(
      screen.getByTestId('snapped-strokes-layer').querySelectorAll('path'),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '처음부터 다시' }));

    expect(screen.getByTestId('stroke-counter')).toHaveTextContent('현재 획: 1 / 2');
    expect(
      screen.getByTestId('snapped-strokes-layer').querySelectorAll('path'),
    ).toHaveLength(0);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('completes a single-stroke character without guide (strokeGuideUsed: false)', () => {
    const onComplete = vi.fn();
    render(<StrokeCanvas strokeEntry={oneEntry} onComplete={onComplete} />);

    const canvas = screen.getByTestId('stroke-drawing-canvas');
    drawStrokeOnCanvas(canvas, convertMedianToSvg(oneEntry.medians[0]!, true));
    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(onComplete).toHaveBeenCalledWith({
      strokeGuideUsed: false,
      totalStrokes: 1,
    });
  });
});
