# Third-Party Notices

이 저장소 및 배포 번들에 포함된 한자 획 벡터(외곽선/중심선) 및 사전 보조 데이터는 아래 오픈소스 프로젝트의 데이터를 기반으로 구축·정규화되었습니다. (기준 문서: `docs/보고-오픈소스-획데이터-1차-매핑결과.md`)

## 1. AnimCJK
- **사용 데이터**: `graphicsKo.txt`, `dictionaryKo.txt`, `graphicsZhHant.txt`, `dictionaryZhHant.txt`
- **참조 커밋 / 버전**: `c63765b1` (2026-11-08)
- **라이선스**:
  - `graphics*` (SVG 획 외곽선 및 메디안 데이터): **Arphic Public License**
  - `dictionary*` (사전 및 메타데이터): **GNU LGPL v3+**
- **프로젝트 출처**: https://github.com/parsimonhi/animCJK

## 2. MakeMeAHanzi
- **사용 데이터**: `graphics.txt`, `dictionary.txt`
- **참조 커밋 / 버전**: `bddc96d4` (2026-03-08)
- **라이선스**:
  - `graphics.txt` (SVG 획 외곽선 및 메디안 데이터): **Arphic Public License**
  - `dictionary.txt` (사전 및 메타데이터): **GNU LGPL v3+**
- **프로젝트 출처**: https://github.com/skishore/makemeahanzi

## 3. KanjiVG
- **사용 데이터**: `kvg-index.json` 및 개별 SVG 획 패스 데이터 (한국 정자 누락 보완 9자 기준)
- **참조 커밋 / 버전**: `610091ce` (2026-11-05)
- **라이선스**: **Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)**
- **프로젝트 출처**: https://kanjivg.tagaini.net/

## 비고
- 위 데이터는 `data/strokes/normalized_strokes.json`, `prototype/stroke-assist/js/strokes-bundle.js`, `data/strokes/raw_mapped.json`(로컬 아카이브 전용) 등에 반영되어 있으며, 배포 및 재배포 시 각 원저작물의 라이선스(Arphic Public License, GNU LGPL v3+, CC BY-SA 3.0) 고지 의무를 준수합니다.
