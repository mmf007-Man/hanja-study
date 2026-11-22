# 교과서 순서에 따른 한자 데이터

천재교과서 2022 개정 중학교 『한문』(안대회 외) 교과서의 새 한자를 단원 순서로 구성한 기초 데이터다. 20개 소단원에 638개 항목이 있으며, 서로 다른 글자는 637자다. 공식 공개 미리보기에서 정리한 [참고 목록](../docs/참고-교과서-단원별-한자목록.md)을 기준으로 한다.

**최종 현행화 기준일: `2026-11-22`** (데이터 버전 `0.3.0` / `schemaVersion: 1`)
- **637자 뜻·음 전수 검수 완료** (`readingStatus: "verified"`, 642개 독음 쌍, `readingVerifiedAt: "2026-10-19"`)
- **두음법칙 추가 허용 음(`allowedSounds`) 29자 반영** ([추가 허용 음 검수 문서](../docs/참고-추가-허용-음-검수.md))
- **교과서 정자 코드포인트 교정 완료**: `豊` (`U+8C4A`) → `豐` (`U+8C50`), `畵` (`U+7575`) → `畫` (`U+756B`)
- **637자 전체 `strokeData` 연결 및 `verified` 승격 완료** (`strokeStatus: "verified"`, 총 5,932획, Top-Down `1024×1024` 정규화 기준 [normalized_strokes.json](strokes/normalized_strokes.json))
- 2026-11-22 시제품 필기 검증 통과(`PRESETS.normal` 허용 오차 및 연속 3회 실패 점선 가이드 확정)에 따라 637자 전체를 `verified`로 승격했다.

---

## 파일 구성 및 브랜치별 포함 범위

| 파일 / 디렉터리 | 역할 | `master` (로컬 아카이브) | `main` (개발 소스) | `gh-pages` (정적 배포) |
|---|---|:---:|:---:|:---:|
| [characters.json](characters.json) | 중복 없는 한자 637자 기본 정보 (뜻·음·두음법칙·획 참조) | 포함 | 포함 | 제외 (JS 번들 내장) |
| [chunjae-middle-hanja-2022-ahn.json](textbooks/chunjae-middle-hanja-2022-ahn.json) | 20개 단원 제목, 순서, 단원별 `characterIds` | 포함 | 포함 | 제외 |
| [chunjae-middle-hanja-2022-ahn-readings.json](sources/chunjae-middle-hanja-2022-ahn-readings.json) | 638개 항목 원문 표기, 쪽수, 검수 범위 | 포함 | 포함 | 제외 |
| [strokes/normalized_strokes.json](strokes/normalized_strokes.json) | 637자 Top-Down `1024×1024` 정규화 획·메디안 (5,932획) | 포함 | 포함 | 제외 (`js/strokes-bundle.js` 사용) |
| [strokes/mapping_summary.json](strokes/mapping_summary.json) | 오픈소스 1차 매핑 커버리지 및 불일치 요약 | 포함 | 포함 | 제외 |
| `strokes/raw_mapped.json` | 1차 매핑 원시 추출 중간 파일 (~9.6 MB) | **로컬 전용** | **제외** | **제외** |
| `sources/chunjae-middle-hanja-2022-ahn-pages/` | 교과서 원문 이미지 212쪽 (+ `manifest.json`, `README.md`) | **로컬 전용** | **제외** | **제외** |
| `sources/chunjae-middle-hanja-2022-ahn-stroke-checks/` | 필순 대조 확대 이미지 12장 (+ `README.md`) | **로컬 전용** | **제외** | **제외** |
| [검수 보고서](../docs/참고-교과서-뜻음-검수.md) | 검수 결과, 복수 독음 처리, 단원순 전체 뜻·음 표 | 포함 | 포함 | 제외 |
| [검사 스크립트](../scripts/validate_data.py) | 문자·참조·순서·두음법칙·원문 대조 검증 | 포함 | 포함 | 제외 |
| [정규화 획 검증 스크립트](../scripts/verify_normalized_strokes.py) | `normalized_strokes.json` 637자 좌표·무결성 검증 | 포함 | 포함 | 제외 |

> [!NOTE]
> **로컬 아카이브(`master`) 전용 데이터 안내**:
> `data/sources/chunjae-middle-hanja-2022-ahn-pages/`(교과서 212쪽 이미지), `data/sources/chunjae-middle-hanja-2022-ahn-stroke-checks/`(필순 대조 이미지 12장), `data/strokes/raw_mapped.json`(원시 매핑 중간 산출물)은 저작권 보호 및 저장소 경량화를 위해 **로컬 `master` 브랜치에만 보관**하며 GitHub `main` 및 `gh-pages` 브랜치에서는 `.gitignore`로 제외합니다.

모든 JSON은 UTF-8이며 외부 패키지 없이 읽을 수 있다.

---

## 순서와 고유 ID

- `units` 배열은 1~20단원 순서다. 각 단원의 `number`도 같은 순서를 나타낸다.
- `characterIds` 배열은 참고 목록에 기록한 단원 내 한자 순서다. 앱은 이 배열을 그대로 읽는다. 문자 코드나 가나다순으로 다시 정렬하지 않는다.
- 한자 ID는 `hanja-` 뒤에 유니코드 코드 포인트를 붙인다. 예를 들어 `漢`은 `hanja-6F22`다. 읽는 음이나 뜻을 수정해도 ID는 바뀌지 않는다.
- `者`의 ID `hanja-8005`는 6단원과 10단원에서 함께 참조한다. 글자 정보는 한 번 저장하며 단원별 학습 항목은 유지한다.
- `sourcePages`는 단원 전체의 새 한자란 출처 페이지들이다. 개별 글자의 페이지를 뜻하지 않는다.
- 한자별 `readingSourceIds`로 전사 기록의 항목을 찾으면 개별 글자의 단원, 페이지, 원문 뜻·음 표기를 확인할 수 있다. 전사 기록 경로는 한자 파일의 `readingSourceFile`에 있다.
- `姉`, `敎`, `鷄`, `兎`, `豐`, `畫`, `厖` 등의 자형을 그대로 보존했다. 데이터 처리 중 비슷한 한자로 치환하거나 유니코드 호환 정규화를 적용하지 않는다.

---

## 한자 정보 형식

현재 `漢`의 기본 정보는 다음과 같다.

```json
{
  "id": "hanja-6F22",
  "character": "漢",
  "codePoint": "U+6F22",
  "readings": [{ "sound": "한", "meanings": ["한나라"] }],
  "readingStatus": "verified",
  "strokeData": {
    "provider": "animcjk_ko",
    "key": "6F22",
    "version": "c63765b1"
  },
  "strokeStatus": "verified",
  "readingVerifiedAt": "2026-10-19",
  "readingSourceIds": ["unit-01-hanja-6F22"]
}
```

`readings`에는 검수할 뜻·음 묶음을 `{ "sound": "음", "meanings": ["뜻"] }` 형식으로 넣는다. 서로 다른 독음은 별도 묶음으로 구분한다. 입력한 뒤에는 `draft`, 출처와 대조한 뒤에는 `verified` 상태로 바꾼다. 뜻 문자열만으로 주관식 허용 답안을 자동 확정하지 않는다.

두음법칙이 적용되어 사전 검수로 추가 허용 음이 확정된 묶음에는 선택 필드 `allowedSounds`(문자열 배열)를 함께 둔다. 교과서 기본 음(`sound`)은 원문 그대로 유지하고, 해당 묶음에만 종속되는 허용 발음을 넣으며, 적용 대상이 아닌 묶음에는 `allowedSounds` 필드를 두지 않는다(빈 배열 생략). 자세한 검수 목록은 [추가 허용 음 검수 문서](../docs/참고-추가-허용-음-검수.md)를 참고한다.

```json
{
  "id": "hanja-6A02",
  "character": "樂",
  "codePoint": "U+6A02",
  "readings": [
    { "sound": "락", "meanings": ["즐겁다"], "allowedSounds": ["낙"] },
    { "sound": "악", "meanings": ["노래"] }
  ]
}
```

현재 `verified`는 공식 공개 미리보기의 새 한자란과의 대조를 뜻한다. 638개 항목의 원문 텍스트를 대조하고 복수 독음 및 누락 글리프를 화면으로 확인했다.

`樂`의 `락: 즐겁다`와 `악: 노래`는 서로 다른 묶음이며, `不`의 `불`과 `부`에는 각각 `아니다`를 연결했다. 쉼표로 나열된 뜻은 같은 음의 `meanings` 배열에 보존했다. 새 한자란에 없는 사전 뜻·음은 추가하지 않았으며, 두음법칙 허용 음은 사전 검수로 확정된 29개 독음 쌍에만 `allowedSounds`로 별도 연결했다(`樂`은 `락` 묶음에만 `"allowedSounds": ["낙"]` 반영).

`strokeData`에는 `data/strokes/normalized_strokes.json`과 연동되는 획 자료의 `provider`, `key`, `version`을 기록한다. 현재 637자 모두 `strokeData` 연결 및 `strokeStatus: "verified"` 상태이며, `normalized_strokes.json`은 모든 획 외곽선(`strokes`)과 중심선(`medians`)을 **Top-Down `1024×1024` 표준 SVG 좌표계**로 통일했다. `strokeStatus`는 `pending`, `draft`, `verified`, `unavailable` 중 하나다.

앱은 `readingStatus`가 `verified`인 글자만 뜻·음 퀴즈에 사용하고, `strokeStatus`가 `verified`이며 실제 획 자료를 불러올 수 있는 글자만 쓰기 문제 후보로 사용해야 한다.

---

## 앱에서 읽는 예

아래 코드는 JSON을 이미 불러온 상황의 데이터 연결 예시다. 서버나 화면 구현은 포함하지 않는다.

```javascript
const byId = new Map(catalog.characters.map(item => [item.id, item]));
const orderedUnits = textbook.units.map(unit => ({
  number: unit.number,
  title: unit.title,
  characters: unit.characterIds.map(id => byId.get(id))
}));
```

1단원의 앞 다섯 글자는 `漢 字 文 子 曰`이며, 20단원의 마지막 다섯 글자는 `破 片 極 質 量`이다.

---

## 수정과 검사

프로젝트 루트 폴더에서 Python 3.9 이상으로 실행한다.

```sh
# 1. 한자·단원·뜻음·두음법칙·strokeData 참조 무결성 검사
python scripts/validate_data.py

# 2. Top-Down 1024×1024 정규화 획 데이터(637자 / 5,932획) 검사
python scripts/verify_normalized_strokes.py

# 3. (master 로컬 아카이브 전용) raw_mapped.json 1차 매핑 검증
python scripts/verify_stroke_mapping.py
```

`validate_data.py`는 실제 저장한 JSON을 읽어 중복 ID와 누락된 참조, 단원 순서, 한자 순서, 집계 수치, `allowedSounds` 29쌍, `strokeData` 연결 상태 및 검수 상태의 모순을 확인한다. 원문 표기 해석은 [reading_format.py](../scripts/reading_format.py)가 담당한다.

`schemaVersion`은 데이터 구조 버전이며 현재 `1`이다. `dataVersion`은 내용 버전이며 현재 한자·교과서 파일 모두 `0.3.0`이다. 내용을 배포용으로 갱신할 때 두 파일의 내용 버전과 수정 날짜를 함께 올린다.
