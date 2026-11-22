import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function createAndEnterProfile(page: Page, name: string): Promise<void> {
  await expect(page.getByTestId('profile-screen')).toBeVisible();
  await page.locator('#new-profile-name').fill(name);
  await page.getByRole('button', { name: '프로필 추가' }).click();
  const profileBtn = page.getByRole('button', { name: `${name} 프로필로 시작` });
  await expect(profileBtn).toBeVisible();
  await profileBtn.click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
}

async function drawLineOnCanvas(
  page: Page,
  startRelX: number,
  startRelY: number,
  endRelX: number,
  endRelY: number,
  steps = 8,
): Promise<void> {
  const canvas = page.getByTestId('stroke-drawing-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('stroke-drawing-canvas boundingBox is null');
  }
  const x1 = box.x + box.width * startRelX;
  const y1 = box.y + box.height * startRelY;
  const x2 = box.x + box.width * endRelX;
  const y2 = box.y + box.height * endRelY;

  await page.mouse.move(x1, y1);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
  }
  await page.mouse.up();
}

async function performVerticalTouchDrag(
  page: Page,
  startRelX: number,
  startRelY: number,
  endRelX: number,
  endRelY: number,
): Promise<void> {
  const canvas = page.getByTestId('stroke-drawing-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('stroke-drawing-canvas boundingBox is null');
  }
  const x1 = Math.round(box.x + box.width * startRelX);
  const y1 = Math.round(box.y + box.height * startRelY);
  const x2 = Math.round(box.x + box.width * endRelX);
  const y2 = Math.round(box.y + box.height * endRelY);

  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: x1, y: y1, id: 1 }],
  });
  const steps = 8;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: Math.round(x1 + (x2 - x1) * t),
          y: Math.round(y1 + (y2 - y1) * t),
          id: 1,
        },
      ],
    });
  }
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await client.detach();
}

test.describe('한자 학습 웹앱 E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
  });

  test('1. 비쓰기 모드 획 데이터 미로드 및 새로고침 이어하기, 2. 프로필 격리', async ({
    page,
  }) => {
    const strokeRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/data/strokes/')) {
        strokeRequests.push(req.url());
      }
    });

    await createAndEnterProfile(page, '민수');

    await page.getByRole('button', { name: '일반 학습 설정' }).click();
    await expect(page.getByTestId('study-setup-screen')).toBeVisible();

    await page.getByRole('button', { name: '선택 해제' }).click();
    await page.locator('.unit-checkbox-item', { hasText: /^1단원 ·/ }).locator('input').check();

    // 객관식만 선택 (한자 → 뜻·음 객관식)
    await page.locator('label', { hasText: '한자 → 뜻·음 (주관식)' }).locator('input').uncheck();
    await page.locator('label', { hasText: '뜻·음 → 한자 (객관식)' }).locator('input').uncheck();
    await page.locator('label', { hasText: '한자 → 뜻·음 (객관식)' }).locator('input').check();

    await page.getByRole('button', { name: '시작' }).click();
    await expect(page.getByTestId('quiz-screen')).toBeVisible();
    await expect(page.getByTestId('quiz-progress')).toHaveText('1 / 20');

    // 비쓰기 세션 시작 시 획 청크 요청이 0건이어야 함
    expect(strokeRequests).toEqual([]);

    // 1번 문항 답안 선택 및 제출
    const mcqGroups = page.locator('.mcq-group');
    await mcqGroups.nth(0).locator('.choice-btn').first().click();
    await mcqGroups.nth(1).locator('.choice-btn').first().click();
    await page.getByRole('button', { name: '제출' }).click();

    await expect(page.getByTestId('quiz-progress')).toHaveText('2 / 20');
    const scoreTextBeforeReload = await page.getByTestId('cumulative-score').textContent();
    expect(strokeRequests).toEqual([]);

    // 새로고침 후 이어하기 검증
    await page.reload();
    await expect(page.getByTestId('home-screen')).toBeVisible();
    const resumeBanner = page.locator('.resume-banner');
    await expect(resumeBanner).toBeVisible();
    await expect(resumeBanner).toContainText('1 / 20문항 완료');

    await resumeBanner.getByRole('button', { name: '이어하기' }).click();
    await expect(page.getByTestId('quiz-screen')).toBeVisible();
    await expect(page.getByTestId('quiz-progress')).toHaveText('2 / 20');
    await expect(page.getByTestId('cumulative-score')).toHaveText(scoreTextBeforeReload ?? '');

    // 프로필 격리 검증: 새 프로필 B 생성 후 프로필 A의 진행 중 세션이 보이지 않아야 함
    await page.reload();
    await expect(page.getByTestId('home-screen')).toBeVisible();
    await page.getByRole('button', { name: '프로필 전환' }).click();

    await createAndEnterProfile(page, '지혜');
    await expect(page.locator('.resume-banner')).toHaveCount(0);
    await expect(page.getByTestId('home-screen')).toContainText('0문항');
  });

  test('3. 쓰기 캔버스 지연 로딩, 3회 연속 실패 점선 가이드, 터치 스크롤 잠금 및 화면 회전', async ({
    page,
  }, testInfo) => {
    const strokeRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/data/strokes/')) {
        strokeRequests.push(req.url());
      }
    });

    await createAndEnterProfile(page, '서연');

    await page.getByRole('button', { name: '일반 학습 설정' }).click();
    await page.getByRole('button', { name: '선택 해제' }).click();
    await page.locator('.unit-checkbox-item', { hasText: /^1단원 ·/ }).locator('input').check();

    await page.locator('label', { hasText: '한자 → 뜻·음 (객관식)' }).locator('input').uncheck();
    await page.locator('label', { hasText: '한자 → 뜻·음 (주관식)' }).locator('input').uncheck();
    await page.locator('label', { hasText: '뜻·음 → 한자 (객관식)' }).locator('input').uncheck();
    await page.locator('label', { hasText: '한자 쓰기 (필순·획 보정)' }).locator('input').check();

    await page.getByRole('button', { name: '시작' }).click();
    await expect(page.getByTestId('quiz-screen')).toBeVisible();
    await expect(page.getByTestId('stroke-canvas')).toBeVisible();
    await expect(page.getByTestId('stroke-drawing-canvas')).toBeVisible();

    expect(
      strokeRequests.some((url) =>
        url.includes('chunjae-middle-hanja-2022-ahn-unit-01.json'),
      ),
    ).toBe(true);

    // 3회 연속 오답 획 입력 -> 3회째 점선 가이드 자동 표시
    await expect(page.getByTestId('dotted-guide-layer')).toHaveCount(0);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await drawLineOnCanvas(page, 0.5, 0.5, 0.51, 0.51, 3);
      if (attempt < 3) {
        await expect(page.getByTestId('stroke-feedback-bar')).toContainText(
          `(${attempt}/3)`,
        );
      }
    }
    await expect(page.getByTestId('dotted-guide-layer')).toBeVisible();

    // 스크롤 가능한 상태에서 캔버스 내부 세로 드래그 시 window.scrollY 고정 확인
    await page.evaluate(() => {
      document.body.style.minHeight = `${window.innerHeight + 600}px`;
      window.scrollTo(0, 80);
    });
    const scrollBefore = await page.evaluate(() => window.scrollY);
    expect(scrollBefore).toBeGreaterThan(0);

    if (testInfo.project.name === 'mobile-chromium') {
      await performVerticalTouchDrag(page, 0.5, 0.2, 0.5, 0.8);
    } else {
      await drawLineOnCanvas(page, 0.5, 0.2, 0.5, 0.8, 8);
    }
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(1);

    // 세로 -> 가로 뷰포트 회전 후 캔버스 정사각형 비율 및 상호작용 유지 확인
    await page.setViewportSize({ width: 844, height: 390 });
    const stageBox = await page.getByTestId('stroke-stage').boundingBox();
    expect(stageBox).not.toBeNull();
    expect(Math.abs(stageBox!.width - stageBox!.height)).toBeLessThanOrEqual(2);

    await page.getByRole('button', { name: '처음부터 다시' }).click();
    await expect(page.getByTestId('dotted-guide-layer')).toHaveCount(0);
    await expect(page.getByTestId('stroke-feedback-bar')).toContainText('처음부터 다시 써 보세요.');
  });

  test('4. 하루 도전 동일 문제 세트 및 JSON 백업 내보내기/가져오기/손상 파일 방어', async ({
    page,
  }, testInfo) => {
    // Profile A: 민수
    await createAndEnterProfile(page, '민수');
    await page.getByRole('button', { name: '오늘의 도전 시작' }).click();
    await expect(page.getByTestId('quiz-screen')).toBeVisible();

    const promptCard = page.locator('.quiz-question-card');
    const firstPromptTypeA = await promptCard.locator('.quiz-type-header').textContent();
    const firstPromptBodyA =
      (await promptCard.locator('.hanja-prompt-glyph, .reading-badges').first().textContent()) ??
      '';

    // Profile B: 지혜 전환 후 같은 날 하루 도전 시작 -> 첫 문항 동일 확인
    await page.reload();
    await page.getByRole('button', { name: '프로필 전환' }).click();
    await createAndEnterProfile(page, '지혜');
    await page.getByRole('button', { name: '오늘의 도전 시작' }).click();
    await expect(page.getByTestId('quiz-screen')).toBeVisible();

    const firstPromptTypeB = await promptCard.locator('.quiz-type-header').textContent();
    const firstPromptBodyB =
      (await promptCard.locator('.hanja-prompt-glyph, .reading-badges').first().textContent()) ??
      '';

    expect(firstPromptTypeB).toBe(firstPromptTypeA);
    expect(firstPromptBodyB).toBe(firstPromptBodyA);

    // 프로필 화면에서 JSON 백업 내보내기 -> LocalStorage 초기화 -> 복원
    await page.reload();
    await page.getByRole('button', { name: '프로필 전환' }).click();
    await expect(page.getByTestId('profile-screen')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '전체 데이터 내보내기(JSON)' }).click();
    const download = await downloadPromise;
    const backupFilePath = testInfo.outputPath('exported-backup.json');
    await download.saveAs(backupFilePath);

    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await expect(page.getByTestId('profile-screen')).toBeVisible();
    await expect(page.getByText('등록된 프로필 (0명)')).toBeVisible();

    await page.getByTestId('backup-file-input').setInputFiles(backupFilePath);
    await expect(page.getByText('현재 기기 데이터를 덮어쓸까요?')).toBeVisible();
    await page.getByRole('button', { name: '덮어쓰기 (현재 데이터 교체)' }).click();

    await expect(page.getByText('등록된 프로필 (2명)')).toBeVisible();
    await expect(page.getByRole('button', { name: '민수 프로필로 시작' })).toBeVisible();
    await expect(page.getByRole('button', { name: '지혜 프로필로 시작' })).toBeVisible();

    // 손상된 JSON 업로드 시 오류 표시 및 기존 프로필 유지
    const invalidFilePath = testInfo.outputPath('invalid-backup.json');
    fs.writeFileSync(invalidFilePath, '{ "corrupted": true }', 'utf-8');
    await page.getByTestId('backup-file-input').setInputFiles(invalidFilePath);

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText('등록된 프로필 (2명)')).toBeVisible();
    await expect(page.getByRole('button', { name: '민수 프로필로 시작' })).toBeVisible();
    await expect(page.getByRole('button', { name: '지혜 프로필로 시작' })).toBeVisible();
  });
});
