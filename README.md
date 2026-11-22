# 중학 한문 학습 웹 앱 (천재교과서 2022 개정 · 637자)

어린이와 가족이 함께 중학교 한문 교과서 한자의 **뜻·음·자형·필순**을 익히고, 실시간 획 보정 쓰기와 오답 복습·하루 도전으로 꾸준히 학습할 수 있는 **100% 정적 한자 학습 웹 앱(Vite + React + TypeScript)**입니다.

- **대상 교과서**: 천재교과서 2022 개정 중학교 『한문』(안대회 외) 20개 소단원
- **데이터 규모** (`v0.3.0` / `schemaVersion: 1`):
  - 단원 항목 **638개** / 중복 제외 **637자** (`readingStatus: "verified"`, `strokeStatus: "verified"`)
  - 복수 독음 구분 **642개 독음 쌍** / 두음법칙 추가 허용 음 **29자** (`allowedSounds`)
  - 637자 전체 Top-Down `1024×1024` 획·메디안 데이터 (**총 5,932획**, 단원별 청크 지연 로딩)
- **현재 구현 단계**: 본 앱(M1~M5) 구현 완료 — Vite + React + TS 본 앱, 4유형 학습·채점·복습 큐·쓰기 획 보정(`StrokeCanvas`), 기기 내 가족 프로필 전환 & 하루 도전, JSON 백업 내보내기/가져오기, Vitest 단위·통합 테스트 및 Playwright 데스크톱/모바일 E2E 테스트, GitHub Actions CI & GitHub Pages 자동 배포 파이프라인 구축 완료. (실제 휴대폰 실기기·라이브 URL 가족 QA 진행 예정)

---

## 1. 브랜치 분리 구조 (3-Branch Architecture)

저작권이 있는 교과서 원문 이미지 아카이브와 개발 소스, 그리고 실제 GitHub Pages 정적 실행 파일이 섞이지 않도록 **역할별 3개 브랜치**로 분리 관리합니다.

| 브랜치 | 용도 | 포함 내용 | 제외 내용 | 비고 |
|---|---|---|---|---|
| **`master`** | **로컬 아카이브 전용** | 개발 소스 전체 + 교과서 원문 212쪽 이미지 + 필순 대조 12장 + `raw_mapped.json` | - | 저작권·대용량 보호를 위해 **로컬 보관 전용** |
| **`main`** | **GitHub 개발 소스 전용** | `README.md`, `THIRD-PARTY-NOTICES.md`, `src/`, `e2e/`, `data/`(정제 JSON), `docs/`, `prototype/stroke-assist/`, `scripts/`, `.github/workflows/` | 교과서 이미지 227개 파일, `data/strokes/raw_mapped.json`, `public/data/`, `dist/` | PR/개발 및 GitHub Actions CI·빌드 기준 브랜치 |
| **`gh-pages` / GitHub Actions Pages** | **정적 호스팅 배포 전용** | Vite 빌드 산출물(`dist/`: `index.html`, `assets/`, `data/` 20단원 청크, `THIRD-PARTY-NOTICES.md`) + `/prototype/stroke-assist/` + `.nojekyll` | `docs/`, `scripts/`, `src/`, `e2e/`, `data/strokes/normalized_strokes.json` 등 개발·원본 파일 일체 | 서버/로그인 없는 초경량 정적 호스팅 |

---

## 2. 디렉터리 구조 (`main` 개발 소스 기준)

```text
.
├── .github/
│   └── workflows/
│       └── deploy-pages.yml         # main push 시 검증·테스트·빌드·E2E 후 _site/ GitHub Pages 배포
├── data/
│   ├── README.md                    # 데이터 규격, 버전(0.3.0), 브랜치별 제외 파일 안내
│   ├── characters.json              # 637자 기본 정보 (뜻·음·allowedSounds·strokeData)
│   ├── textbooks/
│   │   └── chunjae-middle-hanja-2022-ahn.json
│   ├── sources/
│   │   └── chunjae-middle-hanja-2022-ahn-readings.json
│   │   # (master 전용 아카이브: *-ahn-pages/ 212쪽, *-ahn-stroke-checks/ 12장)
│   └── strokes/
│       ├── normalized_strokes.json  # 637자 Top-Down 1024×1024 정규화 획·메디안 (5,932획)
│       └── mapping_summary.json     # 오픈소스 1차 매핑 요약
│       # (master 전용 중간 파일: raw_mapped.json)
├── docs/                            # 기획서, 채점·화면·기술·검증 설계서 및 검수 보고서
├── e2e/
│   └── app.spec.ts                  # Playwright 데스크톱·모바일 터치 E2E 테스트
├── public/
│   └── data/                        # scripts/build_app_data.py로 생성되는 정적 런타임 JSON(Git 미추적)
├── prototype/
│   └── stroke-assist/               # 순수 HTML/CSS/JS 쓰기 획 보정 & 검수 시제품
├── scripts/
│   ├── validate_data.py             # 한자·단원·뜻음·두음법칙·strokeData 무결성 검증
│   ├── build_app_data.py            # public/data/ 카탈로그·20단원 획 청크·인덱스 생성
│   ├── verify_normalized_strokes.py # 637자 정규화 획 좌표·커버리지 검증
│   └── ...                          # 데이터 수집·매핑·정규화·보조 스크립트
├── src/
│   ├── components/                  # ProfileScreen, HomeScreen, StudySetupScreen, QuizScreen, ResultScreen, StrokeCanvas
│   ├── data/                        # CatalogStore, StrokeLazyLoader (단원별 획 청크 지연 로딩)
│   ├── engine/                      # SessionEngine, QuestionGenerator, GradingEngine, ReviewQueueEngine, StrokeEngine
│   ├── storage/                     # StorageAdapter, LocalStorageAdapter, backupValidation
│   ├── types/                       # TypeScript 도메인·저장소 타입 정의
│   └── utils/                       # 아바타 프리셋 및 표시 라벨 헬퍼
├── index.html
├── package.json
├── playwright.config.ts
├── start-local-test.bat             # Windows 원클릭 로컬 테스트 서버 실행 배치 파일
├── THIRD-PARTY-NOTICES.md           # AnimCJK, MakeMeAHanzi, KanjiVG 오픈소스 라이선스 고지
└── vite.config.ts
```

---

## 3. 데이터·단위 테스트·E2E 검증

Python 3.9+ 및 Node.js 20+ 환경에서 프로젝트 루트 기준으로 실행합니다.

```bash
# 1. 의존성 설치 (최초 1회)
npm ci
npx playwright install chromium

# 2. 한자·단원·뜻음·두음법칙·strokeData 무결성 검증
python scripts/validate_data.py

# 3. 런타임 정적 데이터 및 20개 단원 획 청크 생성 (public/data/)
python scripts/build_app_data.py

# 4. TypeScript 타입 검사
npm run typecheck
npx tsc -p tsconfig.node.json --noEmit

# 5. Vitest 단위·통합 테스트 (엔진, 스토리지, StrokeCanvas, 앱 전체 흐름)
npm test

# 6. 프로덕션 정적 빌드 (dist/ 생성 및 THIRD-PARTY-NOTICES.md 포함)
npm run build

# 7. Playwright 데스크톱·모바일 터치 E2E 테스트 (dist/ preview 대상)
npm run test:e2e
```

> 참고: 시제품(637자/5,932획) 단독 검증은 `node prototype/stroke-assist/test_prototype.js`로 실행할 수 있으며, `python scripts/verify_stroke_mapping.py`는 `raw_mapped.json`이 포함된 로컬 아카이브(`master`) 전용입니다.

---

## 4. 로컬 실행 및 GitHub Pages 배포

### 로컬 웹 앱 실행
- **Windows 간편 실행**: 프로젝트 루트의 `start-local-test.bat`를 실행하면 `npm run dev -- --open --host`로 PC(`http://localhost:5173`) 및 같은 Wi-Fi 모바일 기기 접속 주소를 함께 안내합니다.
- **수동 실행**:
  ```bash
  npm run dev -- --host
  # 또는 빌드 결과물 미리보기:
  npm run build && npm run preview -- --host 127.0.0.1 --port 4173
  ```

### GitHub Actions CI 및 GitHub Pages 배포
1. 저장소 **Settings → Pages → Source**를 **GitHub Actions**로 설정합니다.
2. `main` 브랜치에 push하거나 Actions 탭에서 `Deploy Static Web App to GitHub Pages` 워크플로우(`.github/workflows/deploy-pages.yml`)를 수동 실행(`workflow_dispatch`)하면 다음 순서로 자동 검증·배포됩니다.
   - `validate_data.py` → `build_app_data.py` → `npm run typecheck` → `npm test` → `npm run build` → `npm run test:e2e`
   - 검증 통과 후 `dist/` 전체(루트 앱 + `THIRD-PARTY-NOTICES.md`), `/prototype/stroke-assist/` 런타임 파일, `.nojekyll`을 `_site/`로 조립하여 GitHub Pages에 배포합니다.

---

## 5. 오픈소스 라이선스

본 프로젝트의 한자 획 벡터 및 사전 보조 데이터는 **AnimCJK**(Arphic Public License / GNU LGPL v3+), **MakeMeAHanzi**(Arphic Public License / GNU LGPL v3+), **KanjiVG**(CC BY-SA 3.0)를 기반으로 구축·정규화되었습니다. 상세 저작권 및 라이선스 고지는 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)를 확인하세요.
