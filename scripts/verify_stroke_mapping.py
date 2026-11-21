"""Verify stroke mapping against catalog characters."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_MAPPED_PATH = ROOT / 'data/strokes/raw_mapped.json'

if not RAW_MAPPED_PATH.exists():
    print("raw_mapped.json이 없습니다. (main 브랜치에서는 제외됨. 필요 시 python scripts/map_and_screen_strokes.py 실행 후 검증하세요.)")
    sys.exit(0)

catalog = json.loads((ROOT / 'data/characters.json').read_text(encoding='utf-8'))
mapped = json.loads(RAW_MAPPED_PATH.read_text(encoding='utf-8'))
summary = json.loads((ROOT / 'data/strokes/mapping_summary.json').read_text(encoding='utf-8'))

cat_ids = {c['id'] for c in catalog['characters']}
cat_chars = {c['character'] for c in catalog['characters']}

mapped_ids = {c['id'] for c in mapped['characters']}
mapped_chars = {c['character'] for c in mapped['characters']}

assert len(cat_ids) == 637, f"Catalog count {len(cat_ids)} != 637"
assert cat_ids == mapped_ids, "IDs do not match exactly!"
assert cat_chars == mapped_chars, "Characters do not match exactly!"
assert mapped['totalCharacters'] == 637, "totalCharacters != 637"
assert summary['totalCatalogCharacters'] == 637, "summary count != 637"

print("VERIFICATION PASS:")
print(f"  1. Exact ID match: {len(mapped_ids)} / {len(cat_ids)} (100.0%)")
print(f"  2. Exact Character match: {len(mapped_chars)} / {len(cat_chars)} (100.0%)")
print(f"  3. Stroke count mismatches detected: {summary['strokeCountMismatchCount']}")
print(f"  4. Missing in MakeMeAHanzi: {len(summary['missingInMakeMeAHanzi'])} characters")
print(f"  5. Missing across all sources: {len(summary['missingInAllSources'])} characters")

for prov, data in summary['providerCoverage'].items():
    print(f"  - Provider {prov:15s}: {data['count']:3d} / 637 ({data['percentage']:5.2f}%) | 159-subset: {data['highPriorityCount']:3d} / 159 ({data['highPriorityPercentage']:5.2f}%)")

print("All cross-checks passed successfully.")
