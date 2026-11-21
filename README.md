# 중학 한문 학습 웹 앱 (천재교과서 2022 개정 · 637자)

어린이와 가족이 함께 중학교 한문 교과서 한자의 **뜻·음·자형·필순**을 정확하게 익히고, 실시간 획 보정 쓰기와 오답 복습으로 꾸준히 학습할 수 있는 **정적 한자 학습 웹 앱 프로젝트**입니다.

- **대상 교과서**: 천재교과서 2022 개정 중학교 『한문』(안대회 외) 20개 소단원
- **데이터 규모** (`v0.2.0` / `schemaVersion: 1`):
  - 단원 항목 **638개** / 중복 제외 **637자**
  - 복수 독음 구분 **642개 독음 쌍** (`readingStatus: "verified"`)
  - 두음법칙 추가 허용 음 **29자** (`allowedSounds`)
  - 637자 전체 Top-Down `1024×1024` 획·메디안 데이터 연결 (**총 5,932획**, `strokeStatus: "draft"`)
- **현재 구현 단계**: 637자 데이터·획 데이터 구축 완료, **쓰기 획 보정(Stroke Assist) 및 159자 집중 검수 시제품** 동작 검증 완료, 본 앱(MVP) 기획·설계 문서 확정

---

## 1. 브랜치 분리 구조 (3-Branch Architecture)

저작권이 있는 교과서 원문 이미지 아카이브와 개발 소스, 그리고 실제 GitHub Pages 정적 실행 파일이 섞이지 않도록 **역할별 3개 브랜치**로 분리 관리합니다.

| 브랜치 | 용도 | 포함 내용 | 제외 내용 | 비고 |
|---|---|---|---|---|
| **`master`** | **로컬 아카이브 전용** | 개발 소스 전체 + 교과서 원문 212쪽 이미지 + 필순 대조 12장 + `raw_mapped.json` | - | 저작권·대용량 보호를 위해 **로컬 보관 전용** |
| **`main`** | **GitHub 개발 소스 전용** | `README.md`, `THIRD-PARTY-NOTICES.md`, `data/`(정제 JSON), `docs/`, `prototype/stroke-assist/`, `scripts/`, `.github/workflows/` | 교과서 이미지 227개 파일, `data/strokes/raw_mapped.json`, 웹 루트 배포 파일(`index.html`, `.nojekyll`) | PR/개발 및 GitHub Actions 빌드 기준 브랜치 |
| **`gh-pages`** | **GitHub Pages 정적 배포 전용** | 브라우저 실행용 최소 정적 파일만 루트에 배치 (`index.html`, `css/`, `js/`, `data/` 3종 JSON, `.nojekyll`, `THIRD-PARTY-NOTICES.md`) | `docs/`, `scripts/`, `README.md`, `build_*.py`, `test_*.js`, `data/characters.json`, `data/strokes/` 등 개발·원본 파일 일체 | 초경량 정적 호스팅 전용 (~5.3 MB) |

---

## 2. 디렉터리 구조 (`main` 개발 소스 기준)

```
.
├── .github/
│   └── workflows/
│       └── deploy-pages.yml         # main push 시 정적 실행 파일만 _site/로 모아 GitHub Pages 배포
├── data/
│   ├── README.md                    # 데이터 규격, 버전(0.2.0), 브랜치별 제외 파일 안내
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
├── prototype/
│   └── stroke-assist/               # 순수 HTML/CSS/JS 쓰기 획 보정 & 159자/637자 검수 시제품
│       ├── README.md                # 시제품 상세 실행·구조 안내
│       ├── index.html
│       ├── css/
│       ├── js/                      # app.js, stroke-engine.js, strokes-bundle.js, review-data.js, sample-strokes.js
│       ├── data/                    # catalog-targets.json, review-targets.json, sample-strokes.json
│       ├── build_*.py               # JS 번들 및 검수 목록 생성 스크립트
│       └── test_*.js                # Node.js 기반 637자 / 5,932획 통합 테스트
├── scripts/
│   ├── validate_data.py             # 한자·단원·뜻음·두음법칙·strokeData 무결성 검증
│   ├── verify_normalized_strokes.py # 637자 정규화 획 좌표·커버리지 검증
│   ├── verify_stroke_mapping.py     # (master 로컬 전용) raw_mapped.json 검증
│   └── ...                          # 데이터 수집·매핑·정규화·보조 스크립트
├── README.md                        # 본 문서
└── THIRD-PARTY-NOTICES.md           # AnimCJK, MakeMeAHanzi, KanjiVG 오픈소스 라이선스 고지
```

---

## 3. 데이터 및 시제품 검증

Python 3.9+ 및 Node.js가 설치된 환경에서 프로젝트 루트 기준으로 실행합니다.

```bash
# 1. 한자·단원·뜻음·두음법칙·strokeData 무결성 검증
python scripts/validate_data.py

# 2. 정규화 획 데이터(637자 / 5,932획, Top-Down 1024×1024) 검증
python scripts/verify_normalized_strokes.py

# 3. 시제품 획 판정 엔진 & 637자/5,932획 통합 테스트
node prototype/stroke-assist/test_prototype.js
```

> 참고: `python scripts/verify_stroke_mapping.py`는 `raw_mapped.json`이 포함된 로컬 아카이브(`master`) 검증용이며, `main` 브랜치에서 실행할 경우 누락 안내 메시지를 출력하고 안전하게 종료합니다.

---

## 4. 로컬 실행 및 GitHub Pages 배포

### 로컬 웹 앱 실행
```bash
# 권장: 시제품 디렉터리를 루트로 정적 서버 실행 (gh-pages와 동일한 경로 구조)
cd prototype/stroke-assist
python -m http.server 8000
# 브라우저 접속: http://localhost:8000/
```
또는 프로젝트 루트에서 `python -m http.server 8000` 실행 후 `http://localhost:8000/prototype/stroke-assist/`로 접속하거나, `prototype/stroke-assist/index.html`을 브라우저로 직접 열어도(`file:///`) 동작합니다.

### GitHub Pages 배포 방법
1. **GitHub Actions 자동 배포 (권장)**:
   - 저장소 Settings → Pages → Source를 **GitHub Actions**로 설정합니다.
   - `main` 브랜치에 push하거나 Actions 탭에서 `Deploy Static Web App to GitHub Pages` 워크플로우(`.github/workflows/deploy-pages.yml`)를 수동 실행(`workflow_dispatch`)하면, `prototype/stroke-assist/`의 실행용 정적 파일과 `.nojekyll`, `THIRD-PARTY-NOTICES.md`만 `_site/`에 모아 자동 배포합니다.
2. **`gh-pages` 브랜치 직접 배포**:
   - GitHub Pages Source를 **Deploy from a branch** (`gh-pages` / `/(root)`)로 설정해 경량 정적 실행 파일 전용 브랜치를 그대로 서빙할 수도 있습니다.

---

## 5. 오픈소스 라이선스

본 프로젝트의 한자 획 벡터 및 사전 보조 데이터는 **AnimCJK**(Arphic Public License / GNU LGPL v3+), **MakeMeAHanzi**(Arphic Public License / GNU LGPL v3+), **KanjiVG**(CC BY-SA 3.0)를 기반으로 구축·정규화되었습니다. 상세 저작권 및 라이선스 고지는 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)를 확인하세요.
