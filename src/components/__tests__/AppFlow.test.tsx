import fs from 'node:fs';
import path from 'node:path';
import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { CatalogStore, TEXTBOOK_ID } from '../../data/catalogStore';
import { StrokeLazyLoader } from '../../data/strokeLoader';
import { getLocalDateKey } from '../../engine/prng';
import { convertMedianToSvg } from '../../engine/strokeEngine';
import { LocalStorageAdapter } from '../../storage/localStorageAdapter';
import type {
  CharacterCatalog,
  NormalizedStrokeChunk,
  StrokeIndex,
  Textbook,
} from '../../types/catalog';

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

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PUBLIC_STROKES_DIR = path.resolve(
  process.cwd(),
  'public',
  'data',
  'strokes',
);
const STAGE_SIZE = 512;

function loadRawCatalogAndTextbook(): {
  catalog: CharacterCatalog;
  textbook: Textbook;
} {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'characters.json'), 'utf-8'),
  ) as CharacterCatalog;
  const textbook = JSON.parse(
    fs.readFileSync(
      path.join(DATA_DIR, `textbooks/${TEXTBOOK_ID}.json`),
      'utf-8',
    ),
  ) as Textbook;
  return { catalog, textbook };
}

function createRealCatalog(): CatalogStore {
  const { catalog, textbook } = loadRawCatalogAndTextbook();
  return new CatalogStore(catalog, textbook);
}

function createUnit7SubsetCatalogWithLe(): CatalogStore {
  const { catalog, textbook } = loadRawCatalogAndTextbook();
  const unit07 = textbook.units.find(
    (u) => u.id === `${TEXTBOOK_ID}-unit-07`,
  )!;
  const subsetIds = unit07.characterIds.slice(0, 10);
  if (!subsetIds.includes('hanja-6A02')) {
    subsetIds[0] = 'hanja-6A02';
  }
  const subsetSet = new Set(subsetIds);
  const filteredChars = catalog.characters.filter((c) => subsetSet.has(c.id));
  const filteredTextbook: Textbook = {
    ...textbook,
    counts: {
      units: 1,
      entries: subsetIds.length,
      uniqueCharacters: filteredChars.length,
    },
    units: [
      {
        ...unit07,
        characterIds: subsetIds,
      },
    ],
  };
  return new CatalogStore(
    { ...catalog, characters: filteredChars },
    filteredTextbook,
  );
}

function createStrokeFetchSpy() {
  const fetchedUrls: string[] = [];
  const fetchFn: typeof fetch = vi.fn(async (input: RequestInfo | URL) => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    fetchedUrls.push(urlStr);

    const cleanPath = urlStr.split('?')[0] ?? '';
    const marker = 'data/strokes/';
    const idx = cleanPath.indexOf(marker);
    if (idx === -1) {
      return new Response('Not found', { status: 404, statusText: 'Not Found' });
    }
    const relPath = cleanPath.slice(idx + marker.length);
    const fullPath = path.join(PUBLIC_STROKES_DIR, relPath);
    if (!fs.existsSync(fullPath)) {
      return new Response('Not found', { status: 404, statusText: 'Not Found' });
    }
    const content = fs.readFileSync(fullPath, 'utf-8');
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  return { fetchFn, fetchedUrls };
}

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

async function createProfileInUi(name: string, avatarLabel: string) {
  const nameInput = screen.getByLabelText(/이름/);
  fireEvent.change(nameInput, { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: avatarLabel }));
  fireEvent.click(screen.getByRole('button', { name: '프로필 추가' }));
  await screen.findByRole('button', { name: `${name} 프로필로 시작` });
}

function answerCurrentQuestionCorrectly(catalog: CatalogStore): void {
  const hanjaGlyphEl = document.querySelector('.hanja-prompt-glyph');
  const readingBadges = document.querySelectorAll('.reading-pair-badge');

  // Check if hanja_to_choice
  if (screen.queryByText('뜻 선택') && hanjaGlyphEl) {
    const glyph = hanjaGlyphEl.textContent?.trim() ?? '';
    const ch = catalog.characters.find((c) => c.character === glyph)!;
    const validMeanings = new Set(ch.readings.flatMap((r) => r.meanings));
    const validSounds = new Set(ch.readings.map((r) => r.sound));

    const groups = document.querySelectorAll('.mcq-group');
    const meaningBtns = within(groups[0] as HTMLElement).getAllByRole('button');
    const soundBtns = within(groups[1] as HTMLElement).getAllByRole('button');

    const correctMeaningBtn = meaningBtns.find((b) =>
      validMeanings.has(b.textContent?.trim() ?? ''),
    )!;
    const correctSoundBtn = soundBtns.find((b) =>
      validSounds.has(b.textContent?.trim() ?? ''),
    )!;
    fireEvent.click(correctMeaningBtn);
    fireEvent.click(correctSoundBtn);
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    return;
  }

  // Check if hanja_to_input
  const meaningInput = screen.queryByLabelText('원문 뜻 입력');
  const soundInput = screen.queryByLabelText('음 입력');
  if (meaningInput && soundInput && hanjaGlyphEl) {
    const glyph = hanjaGlyphEl.textContent?.trim() ?? '';
    const ch = catalog.characters.find((c) => c.character === glyph)!;
    fireEvent.change(meaningInput, {
      target: { value: ch.readings[0]!.meanings[0]! },
    });
    fireEvent.change(soundInput, {
      target: { value: ch.readings[0]!.sound },
    });
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    return;
  }

  // Check if reading_to_choice
  if (readingBadges.length > 0 && screen.queryByRole('group', { name: '한자 보기' })) {
    const badgeTexts = Array.from(readingBadges).map(
      (el) => el.textContent?.trim() ?? '',
    );
    const choiceBtns = within(
      screen.getByRole('group', { name: '한자 보기' }),
    ).getAllByRole('button');

    const matchedBtn = choiceBtns.find((btn) => {
      const glyph = btn.textContent?.trim() ?? '';
      const ch = catalog.characters.find((c) => c.character === glyph);
      if (!ch) return false;
      return ch.readings.some((r) =>
        badgeTexts.some(
          (bt) => bt.includes(r.sound) && r.meanings.some((m) => bt.includes(m)),
        ),
      );
    })!;
    fireEvent.click(matchedBtn);
    fireEvent.click(screen.getByRole('button', { name: '제출' }));
    return;
  }

  // Fallback: click 모르겠어요
  fireEvent.click(screen.getByRole('button', { name: '모르겠어요' }));
}

describe('M4 UI & Full User Flow Integration Tests', () => {
  const realCatalog = createRealCatalog();

  beforeEach(() => {
    window.localStorage.clear();
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

  it('1. Isolates active sessions, exposure stats, and review items between profiles and supports 2-step delete', async () => {
    const { fetchFn } = createStrokeFetchSpy();
    const storage = new LocalStorageAdapter({ storage: window.localStorage });
    const strokeLoader = new StrokeLazyLoader({
      fetchFn,
      dataVersion: realCatalog.dataVersion,
    });

    render(
      <App
        catalogStore={realCatalog}
        strokeLoader={strokeLoader}
        storageAdapter={storage}
      />,
    );

    await screen.findByTestId('profile-screen');

    // Create Profile A (호랑이) & Profile B (토끼)
    await createProfileInUi('민수', '호랑이');
    await createProfileInUi('서연', '토끼');

    // Select Profile A -> Home
    fireEvent.click(screen.getByRole('button', { name: '민수 프로필로 시작' }));
    await screen.findByTestId('home-screen');

    // Start normal session in Profile A (uncheck writing so it stays non-writing)
    fireEvent.click(screen.getByRole('button', { name: '일반 학습 설정' }));
    await screen.findByTestId('study-setup-screen');
    fireEvent.click(screen.getByRole('button', { name: '시작' }));
    await screen.findByTestId('quiz-screen');

    // Answer Q1 with 모르겠어요 to register exposure & review item in Profile A
    await waitFor(async () => {
      const profiles = await storage.listProfiles();
      const pA = profiles.find((p) => p.name === '민수')!;
      const active = await storage.getActiveSession(pA.id);
      expect(active?.exposedQuestionIds.length).toBeGreaterThanOrEqual(1);
    });
    fireEvent.click(screen.getByRole('button', { name: '모르겠어요' }));
    await screen.findByTestId('dont-know-reveal');
    fireEvent.click(screen.getByRole('button', { name: '다음 문제' }));

    // Exit quiz via [학습 끝내기] -> no, keep active session! Navigate back to profile switch?
    // Wait: let's abandon? No, prompt says: "Profile B has 0 active sessions, 0 exposure, 0 review items".
    // Let's finish or leave active session in Profile A by remounting or checking Profile A's state,
    // wait: from QuizScreen there's only [학습 끝내기], OR on reload user goes to Home where [프로필 전환] is!
    // Let's simulate reload (unmount + remount App) so Profile A STILL has an activeSession!
    cleanup();
    render(
      <App
        catalogStore={realCatalog}
        strokeLoader={strokeLoader}
        storageAdapter={storage}
      />,
    );
    await screen.findByTestId('home-screen');
    expect(screen.getByText(/진행 중: 일반 학습/)).toBeInTheDocument();

    // Switch to Profile B
    fireEvent.click(screen.getByRole('button', { name: '프로필 전환' }));
    await screen.findByTestId('profile-screen');
    fireEvent.click(screen.getByRole('button', { name: '서연 프로필로 시작' }));
    await screen.findByTestId('home-screen');

    // Verify Profile B has 0 active sessions, 0 exposure, 0 review items
    expect(screen.queryByText(/진행 중:/)).not.toBeInTheDocument();
    expect(screen.getByText('복습할 오답이 없어요')).toBeDisabled();
    expect(screen.getByText('0자')).toBeInTheDocument();
    expect(screen.getByText('0문항')).toBeInTheDocument();

    const profiles = await storage.listProfiles();
    const profA = profiles.find((p) => p.name === '민수')!;
    const profB = profiles.find((p) => p.name === '서연')!;
    expect(await storage.getActiveSession(profB.id)).toBeNull();
    expect(await storage.getExposureStats(profB.id)).toEqual({});
    expect(await storage.getReviewQueue(profB.id)).toEqual({});
    expect(await storage.getActiveSession(profA.id)).not.toBeNull();

    // Test 2-step delete on Profile A
    fireEvent.click(screen.getByRole('button', { name: '프로필 전환' }));
    await screen.findByTestId('profile-screen');
    fireEvent.click(screen.getByRole('button', { name: '민수 프로필 삭제' }));
    expect(
      screen.getByText(/민수님의 모든 학습·복습 기록이 삭제됩니다/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: '민수 프로필로 시작' }),
      ).not.toBeInTheDocument();
    });
    expect(await storage.listProfiles()).toHaveLength(1);
  });

  it('2. Validates < 20 char notice, disabled start on invalid config, and resume conflict modal', async () => {
    const { fetchFn } = createStrokeFetchSpy();
    const subsetCatalog = createUnit7SubsetCatalogWithLe();
    const storage = new LocalStorageAdapter({ storage: window.localStorage });
    await storage.saveProfile({
      id: 'prof_1',
      name: '지혜',
      avatarId: 'owl',
      createdAt: '2026-11-22T09:00:00Z',
    });
    await storage.setActiveProfileId('prof_1');

    const strokeLoader = new StrokeLazyLoader({
      fetchFn,
      dataVersion: subsetCatalog.dataVersion,
    });

    render(
      <App
        catalogStore={subsetCatalog}
        strokeLoader={strokeLoader}
        storageAdapter={storage}
      />,
    );

    await screen.findByTestId('home-screen');
    fireEvent.click(screen.getByRole('button', { name: '일반 학습 설정' }));
    await screen.findByTestId('study-setup-screen');

    // < 20 chars notice is visible (subset unit has 10 chars)
    expect(
      screen.getByText(/20자 미만 범위: 전수 출제 후 적은 횟수 순으로 반복해 20문제를 채웁니다/),
    ).toBeInTheDocument();

    const startBtn = screen.getByRole('button', { name: '시작' });
    expect(startBtn).toBeEnabled();

    // Deselect all units -> validation error & disabled start
    fireEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    expect(
      screen.getByText(/최소 1개 이상의 단원을 선택해 주세요/),
    ).toBeInTheDocument();
    expect(startBtn).toBeDisabled();

    // Select all units again, start a session
    fireEvent.click(screen.getByRole('button', { name: '전체 선택' }));
    expect(startBtn).toBeEnabled();
    fireEvent.click(startBtn);
    await screen.findByTestId('quiz-screen');

    // Reload to return to Home with activeSession intact
    cleanup();
    render(
      <App
        catalogStore={subsetCatalog}
        strokeLoader={strokeLoader}
        storageAdapter={storage}
      />,
    );
    await screen.findByTestId('home-screen');
    expect(screen.getByText(/진행 중 회차 있음/)).toBeInTheDocument();

    // Open StudySetup & click Start -> triggers Resume Conflict Modal
    fireEvent.click(screen.getByRole('button', { name: '일반 학습 설정' }));
    await screen.findByTestId('study-setup-screen');
    fireEvent.click(screen.getByRole('button', { name: '시작' }));

    await screen.findByText('진행 중인 학습이 있습니다');
    expect(
      screen.getByRole('button', { name: '이어하기' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '기존 회차 끝내고 새로 시작' }),
    ).toBeInTheDocument();

    // Choose '기존 회차 끝내고 새로 시작'
    fireEvent.click(
      screen.getByRole('button', { name: '기존 회차 끝내고 새로 시작' }),
    );
    await screen.findByTestId('quiz-screen');
    expect(screen.getByTestId('quiz-progress')).toHaveTextContent('1 / 20');
  });

  it('3. Completes non-writing flow with 0 stroke fetches, dont_know reveal, pair_mismatch warning, result accuracies, and review graduation', async () => {
    const { fetchFn, fetchedUrls } = createStrokeFetchSpy();
    const subsetCatalog = createUnit7SubsetCatalogWithLe();
    const storage = new LocalStorageAdapter({ storage: window.localStorage });
    await storage.saveProfile({
      id: 'prof_1',
      name: '민수',
      avatarId: 'tiger',
      createdAt: '2026-11-22T09:00:00Z',
    });
    await storage.setActiveProfileId('prof_1');

    const strokeLoader = new StrokeLazyLoader({
      fetchFn,
      dataVersion: subsetCatalog.dataVersion,
    });

    render(
      <App
        catalogStore={subsetCatalog}
        strokeLoader={strokeLoader}
        storageAdapter={storage}
      />,
    );

    await screen.findByTestId('home-screen');
    fireEvent.click(screen.getByRole('button', { name: '일반 학습 설정' }));
    await screen.findByTestId('study-setup-screen');

    // Select ONLY hanja_to_input (all 10 chars including 樂 will appear in first 10 questions)
    fireEvent.click(
      screen.getByLabelText(/한자 → 뜻·음 \(객관식\)/),
    );
    fireEvent.click(
      screen.getByLabelText(/뜻·음 → 한자 \(객관식\)/),
    );
    fireEvent.click(screen.getByRole('button', { name: '시작' }));
    await screen.findByTestId('quiz-screen');

    // Verify 0 stroke chunk fetches for non-writing session!
    expect(fetchedUrls).toHaveLength(0);

    // Step through questions until we hit 樂 (test dont_know on Q1, then answer correctly, and test pair_mismatch on 樂)
    let sawDontKnow = false;
    let sawPairMismatch = false;

    for (let step = 0; step < 20; step += 1) {
      await waitFor(async () => {
        const active = await storage.getActiveSession('prof_1');
        expect(active?.exposedQuestionIds.length).toBeGreaterThan(step);
      });

      const glyph =
        document.querySelector('.hanja-prompt-glyph')?.textContent?.trim() ?? '';

      if (!sawPairMismatch && glyph === '樂') {
        sawPairMismatch = true;
        fireEvent.change(screen.getByLabelText('원문 뜻 입력'), {
          target: { value: '즐겁다' },
        });
        fireEvent.change(screen.getByLabelText('음 입력'), {
          target: { value: '악' },
        });
        fireEvent.click(screen.getByRole('button', { name: '제출' }));

        await screen.findByTestId('pair-mismatch-warning');
        expect(screen.getByText(/개별 존재하나 쌍 불일치/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '다음 문제' }));
      } else if (!sawDontKnow) {
        sawDontKnow = true;
        fireEvent.click(screen.getByRole('button', { name: '모르겠어요' }));
        await screen.findByTestId('dont-know-reveal');
        fireEvent.click(screen.getByRole('button', { name: '다음 문제' }));
      } else {
        answerCurrentQuestionCorrectly(subsetCatalog);
        // Wait for next question to render
        await waitFor(() => {
          expect(screen.getByTestId('last-feedback-pill')).toBeInTheDocument();
        });
      }

      if (sawDontKnow && sawPairMismatch && step >= 2) {
        // Wait for the next active question to be marked exposed before abandoning
        await waitFor(async () => {
          const active = await storage.getActiveSession('prof_1');
          expect(active?.exposedQuestionIds.length).toBeGreaterThan(
            active?.answers.length ?? 0,
          );
        });
        break;
      }
    }

    expect(sawDontKnow).toBe(true);
    expect(sawPairMismatch).toBe(true);
    expect(fetchedUrls).toHaveLength(0);

    // Finish session mid-way via [학습 끝내기]
    fireEvent.click(screen.getByRole('button', { name: '학습 끝내기' }));
    expect(
      screen.getByText(/현재 표시된 미제출 문항은 '중도 이탈'/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '끝내기 확인' }));

    // Result screen assertions
    await screen.findByTestId('result-screen');
    expect(screen.getByTestId('question-accuracy-card')).toHaveTextContent(
      "'중도 이탈' 1건 제외",
    );
    expect(screen.getByTestId('reading-accuracy-card')).toHaveTextContent(
      "'모르겠어요' 1건 · '중도 이탈' 1건 별도",
    );
    expect(screen.getByTestId('result-pair-mismatch-card')).toHaveTextContent(
      '樂',
    );
    expect(screen.getByTestId('result-pair-mismatch-card')).toHaveTextContent(
      '즐겁다 · 락',
    );

    // Enter Review Queue and graduate remaining items!
    const reviewBtn = screen.getByRole('button', {
      name: /오답 복습 바로 시작/,
    });
    fireEvent.click(reviewBtn);
    await screen.findByTestId('quiz-screen');

    // Answer review questions correctly until session completes and reaches ResultScreen
    for (let i = 0; i < 15; i += 1) {
      if (screen.queryByTestId('result-screen')) {
        break;
      }
      answerCurrentQuestionCorrectly(subsetCatalog);
      await waitFor(() => {
        expect(
          screen.queryByTestId('result-screen') !== null ||
            screen.queryByTestId('quiz-screen') !== null,
        ).toBe(true);
      });
    }

    await screen.findByTestId('result-screen');
    expect(
      screen.queryByRole('button', { name: /오답 복습 바로 시작/ }),
    ).not.toBeInTheDocument();
    expect(fetchedUrls).toHaveLength(0);
  });

  it('4. Lazy-loads ONLY the selected unit stroke chunk for reading_to_write and submits completed strokes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchFn, fetchedUrls } = createStrokeFetchSpy();
    const storage = new LocalStorageAdapter({ storage: window.localStorage });
    await storage.saveProfile({
      id: 'prof_write',
      name: '쓰기왕',
      avatarId: 'panda',
      createdAt: '2026-11-22T09:00:00Z',
    });
    await storage.setActiveProfileId('prof_write');

    const strokeLoader = new StrokeLazyLoader({
      fetchFn,
      dataVersion: realCatalog.dataVersion,
    });

    render(
      <App
        catalogStore={realCatalog}
        strokeLoader={strokeLoader}
        storageAdapter={storage}
      />,
    );

    await screen.findByTestId('home-screen');
    fireEvent.click(screen.getByRole('button', { name: '일반 학습 설정' }));
    await screen.findByTestId('study-setup-screen');

    // Select ONLY Unit 1
    fireEvent.click(screen.getByRole('button', { name: '선택 해제' }));
    fireEvent.click(screen.getByLabelText(/^1단원 ·/));

    // Select ONLY reading_to_write
    fireEvent.click(screen.getByLabelText(/한자 → 뜻·음 \(객관식\)/));
    fireEvent.click(screen.getByLabelText(/한자 → 뜻·음 \(주관식\)/));
    fireEvent.click(screen.getByLabelText(/뜻·음 → 한자 \(객관식\)/));
    fireEvent.click(screen.getByLabelText(/한자 쓰기 \(필순·획 보정\)/));

    fireEvent.click(screen.getByRole('button', { name: '시작' }));
    await screen.findByTestId('quiz-screen');
    await screen.findByTestId('stroke-canvas');

    // Verify only index.json and unit-01 chunk were fetched
    expect(
      fetchedUrls.some((u) => u.includes('data/strokes/index.json')),
    ).toBe(true);
    const chunkUrls = fetchedUrls.filter((u) => u.includes('chunks/'));
    expect(chunkUrls).toHaveLength(1);
    expect(chunkUrls[0]).toContain(`${TEXTBOOK_ID}-unit-01.json`);

    // Look up active question's real medians from unit-01 chunk and draw all strokes
    const active = await storage.getActiveSession('prof_write');
    const q1 = active!.questions[0]!;
    const unit01Chunk = JSON.parse(
      fs.readFileSync(
        path.join(PUBLIC_STROKES_DIR, `chunks/${TEXTBOOK_ID}-unit-01.json`),
        'utf-8',
      ),
    ) as NormalizedStrokeChunk;
    const strokeEntry = unit01Chunk.characters.find(
      (c) => c.id === q1.characterId,
    )!;

    const canvas = screen.getByTestId('stroke-drawing-canvas');
    for (let idx = 0; idx < strokeEntry.medians.length; idx += 1) {
      const svgPts = convertMedianToSvg(strokeEntry.medians[idx]!, true);
      drawStrokeOnCanvas(canvas, svgPts, idx + 1);
      await act(async () => {
        vi.advanceTimersByTime(150);
      });
    }

    await screen.findByTestId('write-complete-feedback');
    expect(
      screen.getByTestId('write-complete-feedback'),
    ).toHaveTextContent('정답 (+2점)');

    // Verify stored AnswerRecord
    const updatedSession = await storage.getActiveSession('prof_write');
    expect(updatedSession?.answers).toHaveLength(1);
    expect(updatedSession?.answers[0]).toMatchObject({
      questionId: q1.questionId,
      outcome: 'correct',
      score: 2,
      strokeGuideUsed: false,
    });

    // Advance to Q2
    fireEvent.click(screen.getByRole('button', { name: '다음 문제' }));
    await waitFor(() => {
      expect(screen.getByTestId('quiz-progress')).toHaveTextContent('2 / 20');
    });
  });

  it('5. Generates identical Daily Challenge questions across profiles and ranks family leaderboard correctly', async () => {
    const { fetchFn } = createStrokeFetchSpy();
    const subsetCatalog = createUnit7SubsetCatalogWithLe();
    // Note: use a non-writing daily test? Wait: startDailySession uses ALL_QUESTION_TYPES!
    // If a writing question appears in Daily Challenge, StrokeLazyLoader will fetch the chunk cleanly from public/data/strokes.
    const storage = new LocalStorageAdapter({ storage: window.localStorage });
    await storage.saveProfile({
      id: 'prof_a',
      name: '민수',
      avatarId: 'tiger',
      createdAt: '2026-11-22T09:00:00Z',
    });
    await storage.saveProfile({
      id: 'prof_b',
      name: '서연',
      avatarId: 'rabbit',
      createdAt: '2026-11-22T09:00:00Z',
    });
    await storage.setActiveProfileId('prof_a');

    const strokeLoader = new StrokeLazyLoader({
      fetchFn,
      dataVersion: subsetCatalog.dataVersion,
    });

    const indexJson = JSON.parse(
      fs.readFileSync(path.join(PUBLIC_STROKES_DIR, 'index.json'), 'utf-8'),
    ) as StrokeIndex;
    const chunkCache = new Map<string, NormalizedStrokeChunk>();
    const getStrokeForChar = (charId: string) => {
      const unitId = indexJson.characterToUnits[charId]![0]!;
      let chunk = chunkCache.get(unitId);
      if (!chunk) {
        chunk = JSON.parse(
          fs.readFileSync(
            path.join(PUBLIC_STROKES_DIR, `chunks/${unitId}.json`),
            'utf-8',
          ),
        ) as NormalizedStrokeChunk;
        chunkCache.set(unitId, chunk);
      }
      return chunk.characters.find((c) => c.id === charId)!;
    };

    const completeAll20DailyQuestions = async (
      profileId: string,
      answerCorrectly: boolean,
    ) => {
      for (let i = 0; i < 20; i += 1) {
        await waitFor(async () => {
          const active = await storage.getActiveSession(profileId);
          expect(active).not.toBeNull();
        });
        const session = (await storage.getActiveSession(profileId))!;
        const q = session.questions[session.currentIndex]!;

        if (!answerCorrectly) {
          fireEvent.click(screen.getByRole('button', { name: '모르겠어요' }));
          await screen.findByTestId('dont-know-reveal');
          fireEvent.click(
            screen.getByRole('button', {
              name: i === 19 ? '결과 보기' : '다음 문제',
            }),
          );
          continue;
        }

        if (q.questionType === 'reading_to_write') {
          await screen.findByTestId('stroke-canvas');
          const entry = getStrokeForChar(q.characterId);
          const canvas = screen.getByTestId('stroke-drawing-canvas');
          for (let s = 0; s < entry.medians.length; s += 1) {
            const pts = convertMedianToSvg(entry.medians[s]!, true);
            drawStrokeOnCanvas(canvas, pts, s + 1);
            await new Promise((r) => setTimeout(r, 140));
          }
          await screen.findByTestId('write-complete-feedback');
          fireEvent.click(
            screen.getByRole('button', {
              name: i === 19 ? '결과 보기' : '다음 문제',
            }),
          );
        } else {
          answerCurrentQuestionCorrectly(subsetCatalog);
          if (i < 19) {
            await waitFor(async () => {
              const updated = await storage.getActiveSession(profileId);
              expect(updated?.answers.length).toBe(i + 1);
            });
          }
        }
      }
    };

    render(
      <App
        catalogStore={subsetCatalog}
        strokeLoader={strokeLoader}
        storageAdapter={storage}
      />,
    );

    // Profile A starts Daily Challenge
    await screen.findByTestId('home-screen');
    fireEvent.click(screen.getByRole('button', { name: '오늘의 도전 시작' }));
    await screen.findByTestId('quiz-screen');
    const sessionA = (await storage.getActiveSession('prof_a'))!;

    await completeAll20DailyQuestions('prof_a', false);
    await screen.findByTestId('result-screen');
    expect(screen.getByTestId('result-score')).toHaveTextContent('0 / 40점');

    // Switch to Profile B
    fireEvent.click(screen.getAllByRole('button', { name: '홈으로' })[0]!);
    await screen.findByTestId('home-screen');
    fireEvent.click(screen.getByRole('button', { name: '프로필 전환' }));
    await screen.findByTestId('profile-screen');
    fireEvent.click(screen.getByRole('button', { name: '서연 프로필로 시작' }));
    await screen.findByTestId('home-screen');

    // Profile B starts Daily Challenge -> verify deterministic identical questions!
    fireEvent.click(screen.getByRole('button', { name: '오늘의 도전 시작' }));
    await screen.findByTestId('quiz-screen');
    const sessionB = (await storage.getActiveSession('prof_b'))!;
    expect(sessionB.questions.map((q) => q.characterId)).toEqual(
      sessionA.questions.map((q) => q.characterId),
    );
    expect(sessionB.questions.map((q) => q.questionType)).toEqual(
      sessionA.questions.map((q) => q.questionType),
    );

    // Profile B answers all 20 correctly (40/40)
    await completeAll20DailyQuestions('prof_b', true);
    await screen.findByTestId('result-screen');
    expect(screen.getByTestId('result-score')).toHaveTextContent('40 / 40점');

    // Family leaderboard ranks Profile B (#1, 40/40) ahead of Profile A (#2, 0/40)
    const leaderboard = screen.getByTestId('family-leaderboard');
    const rows = within(leaderboard).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('1위');
    expect(rows[0]).toHaveTextContent('서연');
    expect(rows[0]).toHaveTextContent('40/40점');
    expect(rows[1]).toHaveTextContent('2위');
    expect(rows[1]).toHaveTextContent('민수');
    expect(rows[1]).toHaveTextContent('0/40점');

    // Verify today's daily record exists for today's dateKey
    const todayKey = getLocalDateKey();
    expect((await storage.getDailyChallenge('prof_b', todayKey))?.score).toBe(
      40,
    );
  }, 30000);

  it('6. Exports JSON backup, restores after localStorage clear, and rejects malformed JSON without altering data', async () => {
    const { fetchFn } = createStrokeFetchSpy();
    const storage = new LocalStorageAdapter({ storage: window.localStorage });
    const strokeLoader = new StrokeLazyLoader({
      fetchFn,
      dataVersion: realCatalog.dataVersion,
    });

    await storage.saveProfile({
      id: 'prof_orig',
      name: '백업대상',
      avatarId: 'fox',
      createdAt: '2026-11-22T09:00:00Z',
    });
    await storage.recordReadingExposure(
      'prof_orig',
      'hanja-4E00::일',
      '2026-11-22T10:00:00Z',
    );

    let capturedBlob: Blob | null = null;
    const origCreateObjectUrl = URL.createObjectURL;
    const origRevokeObjectUrl = URL.revokeObjectURL;
    const createObjectUrlSpy = vi.fn((obj: Blob | MediaSource) => {
      capturedBlob = obj as Blob;
      return 'blob:mock-backup';
    });
    const revokeObjectUrlSpy = vi.fn(() => {});
    URL.createObjectURL = createObjectUrlSpy;
    URL.revokeObjectURL = revokeObjectUrlSpy;
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    render(
      <App
        catalogStore={realCatalog}
        strokeLoader={strokeLoader}
        storageAdapter={storage}
      />,
    );

    await screen.findByTestId('profile-screen');
    expect(
      screen.getByRole('button', { name: '백업대상 프로필로 시작' }),
    ).toBeInTheDocument();

    // Export JSON backup
    fireEvent.click(
      screen.getByRole('button', { name: '전체 데이터 내보내기(JSON)' }),
    );
    await waitFor(() => {
      expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    });
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(capturedBlob).not.toBeNull();

    const exportedJsonText = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsText(capturedBlob!, 'utf-8');
    });

    // Clear localStorage completely and remount App -> 0 profiles
    window.localStorage.clear();
    cleanup();
    render(
      <App
        catalogStore={realCatalog}
        strokeLoader={strokeLoader}
        storageAdapter={storage}
      />,
    );
    await screen.findByTestId('profile-screen');
    expect(screen.getByText('등록된 프로필 (0명)')).toBeInTheDocument();

    // Import valid JSON backup
    const fileInput = screen.getByTestId('backup-file-input');
    const validFile = new File([exportedJsonText], 'backup.json', {
      type: 'application/json',
    });
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await screen.findByText('현재 기기 데이터를 덮어쓸까요?');
    fireEvent.click(
      screen.getByRole('button', { name: '덮어쓰기 (현재 데이터 교체)' }),
    );

    await screen.findByRole('button', { name: '백업대상 프로필로 시작' });
    expect(await storage.getExposureStats('prof_orig')).toHaveProperty(
      'hanja-4E00::일',
    );

    // Import malformed JSON -> error alert shown, existing profile preserved!
    const badFile = new File(['{broken json!!!'], 'corrupt.json', {
      type: 'application/json',
    });
    fireEvent.change(screen.getByTestId('backup-file-input'), {
      target: { files: [badFile] },
    });

    await screen.findByRole('alert');
    expect(
      screen.getByText(/손상되었거나 유효하지 않은 JSON 파일입니다/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '백업대상 프로필로 시작' }),
    ).toBeInTheDocument();
    expect(await storage.listProfiles()).toHaveLength(1);

    URL.createObjectURL = origCreateObjectUrl;
    URL.revokeObjectURL = origRevokeObjectUrl;
  });
});
