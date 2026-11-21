# 한자 쓰기 획 보정(Stroke Assist) 시제품 및 637자·159자 검수 뷰어

천재교과서 2022 개정 중학교 『한문』(안대회 외) **637자 / 5,932획** 학습 웹앱의 **쓰기 획 보정(Phase 03)** 및 **159자 집중 검수 · 637자 전체 뷰어(Phase 02)** 시제품입니다.
외부 CDN이나 Node.js 번들러 의존성이 전혀 없는 **순수 HTML / CSS / Vanilla JS**로 구성되어 있으며, 이 디렉터리의 실행용 정적 파일만으로 독립 배포(`gh-pages`) 및 로컬 실행(`file:///`, HTTP 서버)이 가능합니다.

---

## 1. 실행 방법

### 방법 1: 로컬 정적 서버 실행 (권장)
```bash
# 방법 A: 시제품 폴더 단독 루트 서빙 (GitHub Pages / gh-pages 동일 구조)
cd prototype/stroke-assist
python -m http.server 8000
# 접속: http://localhost:8000/

# 방법 B: 프로젝트 루트에서 서빙
python -m http.server 8000
# 접속: http://localhost:8000/prototype/stroke-assist/
```

### 방법 2: 브라우저에서 직접 파일 열기 (`file:///`)
- `prototype/stroke-assist/index.html` 파일을 웹 브라우저(Chrome, Edge, Safari 등)에서 직접 엽니다.
- 637자 전체 획 데이터(`js/strokes-bundle.js`), 637자/159자 카탈로그(`js/review-data.js`), 12자 샘플 데이터(`js/sample-strokes.js`)가 JS 번들로 내장되어 있어 `file:///` 환경에서도 네트워크 오류 없이 즉시 동작합니다.

---

## 2. 독립 정적 서빙 및 404 방지 설계

- **독립 실행 구조 (`gh-pages` 호환)**: `gh-pages` 브랜치 및 GitHub Actions `_site/` 아티팩트에는 이 폴더의 런타임 파일(`index.html`, `css/`, `js/`, `data/`)과 `.nojekyll`, `THIRD-PARTY-NOTICES.md`만 루트에 배치됩니다.
- **초기 로드 404 0건 보장**: `js/app.js`는 `hasFullStrokeBundle()`로 `window.STROKE_DATA_BUNDLE`에 637자 전체가 이미 로드되었는지 먼저 확인합니다. 전체 번들이 로드된 경우(`strokes-bundle.js` 포함 상태) 상위 디렉터리의 `data/strokes/normalized_strokes.json`을 백그라운드 `fetch()`하지 않으므로, 단독 루트 배포 환경(`gh-pages`)에서도 404 네트워크 요청이 발생하지 않습니다.

---

## 3. 주요 기능 및 구성

### 모드 A: 획 보정(어시스트) 시제품 (Stroke Assist)
- **한 획 단위 실시간 판정**: 마우스나 터치(`PointerEvent`)로 한 획을 긋고 손을 떼는 순간(`pointerup`) 즉시 판정 엔진(`js/stroke-engine.js`)이 작동합니다.
- **다중 렌더링·좌표계 지원**:
  - `renderMode: "fill"` (AnimCJK / MakeMeAHanzi 외곽선 path) 및 `renderMode: "stroke"` (KanjiVG 중심선 path) 모두 지원
  - Top-Down 표준 SVG 좌표계(`1024×1024`, 637자 번들) 및 폰트 반전 좌표계(Y축 900 반전, 12자 샘플) 자동 감지·변환
- **정자 벡터 획 즉시 스냅 & 실패 획 보존**: 통과 시 해당 획을 정자 SVG path로 즉시 교체하며, 실패 시 정답으로 자동 교체하지 않고 기존 성공 획만 유지한 채 다시 쓰도록 유도합니다.
- **허용 오차 프리셋 & 슬라이더**: `엄격 (Strict)`, `보통 (Normal - 기본값)`, `관대 (Lenient)` 프리셋 및 5종 지표 실시간 조정
- **글자 변별성 특수 판정**: `土`/`士`(가로획 상대 길이 비율), `日`/`曰`(종횡비) 오인 방지 규칙 적용
- **보조 가이드 & 편의 기능**: 흐린 정자 가이드(Ghost Outline), 현재 획 필순 힌트, 획 번호 배지 On/Off, 처음부터 다시 쓰기, 이전 획 취소(Undo)

### 모드 B: 159자 집중 검수 & 637자 전체 뷰어 (Inspection Viewer)
- **대상 범위 필터 (Scope)**:
  - 🔍 `집중 검수 159자만 보기 (High Priority)` (기본값)
  - ⚠️ `수동 검수/불일치 필요 글자 (Manual Review)`
  - 📚 `전체 637자 보기 (ALL 637)`
- **획별 시각화 및 애니메이션**: 획별 색상·번호 표시, 필순 재생(`▶`), 일시정지(`⏸`), 이전/다음 획 단계별 탐색
- **검수 상태·메모 관리**: LocalStorage 자동 저장 및 JSON 내보내기/불러오기 지원

---

## 4. 디렉터리 구조 (배포 대상 vs 개발·테스트용)

```
prototype/stroke-assist/
├── [정적 웹 배포 대상 (gh-pages / GitHub Actions _site 루트 포함)]
│   ├── index.html                   # 메인 단일 페이지 UI
│   ├── css/
│   │   └── style.css                # 순수 CSS 레이아웃 및 반응형 스타일
│   ├── js/
│   │   ├── app.js                   # 화면 컨트롤러 (637자 번들 감지 시 404 fetch 생략)
│   │   ├── stroke-engine.js         # 획 판정·스냅 엔진 (637자 / 5,932획 검증)
│   │   ├── strokes-bundle.js        # 637자 Top-Down 1024×1024 전체 획 JS 번들
│   │   ├── review-data.js           # 637자 카탈로그 및 159자 집중 검수 메타데이터
│   │   └── sample-strokes.js        # 12자 샘플 획 데이터 (HanziWriter 형식)
│   └── data/
│       ├── catalog-targets.json     # 637자 카탈로그 JSON
│       ├── review-targets.json      # 159자 고위험군 검수 대상 JSON
│       └── sample-strokes.json      # 12자 샘플 획 JSON
│
└── [개발·빌드·테스트 전용 (gh-pages 배포 제외)]
    ├── build_review_data.py         # 637자/159자 카탈로그 빌드 스크립트
    ├── build_strokes_bundle.py      # normalized_strokes.json → strokes-bundle.js 변환기
    ├── fetch_samples.py             # 12자 샘플 데이터 다운로드 스크립트
    ├── test_prototype.js            # Node.js 통합 테스트 (637자 / 5,932획 전수 통과)
    ├── test_637_all.js              # 637자 전체 획 판정 세부 점검 스크립트
    └── README.md                    # 본 문서
```

---

## 5. 통합 테스트 실행

프로젝트 루트에서 Node.js로 실행합니다.

```bash
node prototype/stroke-assist/test_prototype.js
```

- 637자 카탈로그 및 159자 집중 검수 목록 로드 검증
- `strokes-bundle.js` 637자 / **5,932획** 100% 판정 통과 및 역방향 획 거부, `土`/`士`·`日`/`曰` 특수 판정 검증
- `js/app.js` 문법 검사
