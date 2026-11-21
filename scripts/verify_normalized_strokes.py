"""Comprehensive verification script for normalized_strokes.json."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CATALOG_PATH = ROOT / 'data/characters.json'
NORMALIZED_PATH = ROOT / 'data/strokes/normalized_strokes.json'

catalog = json.loads(CATALOG_PATH.read_text(encoding='utf-8'))
data = json.loads(NORMALIZED_PATH.read_text(encoding='utf-8'))

cat_chars = catalog['characters']
norm_chars = data['characters']

print(f"Total catalog characters: {len(cat_chars)}")
print(f"Total normalized characters: {len(norm_chars)}")

assert len(cat_chars) == 637, f"Catalog count {len(cat_chars)} != 637"
assert len(norm_chars) == 637, f"Normalized count {len(norm_chars)} != 637"

cat_id_set = {c['id'] for c in cat_chars}
norm_id_set = {c['id'] for c in norm_chars}
assert cat_id_set == norm_id_set, "Character IDs do not match 100%!"

cat_glyph_set = {c['character'] for c in cat_chars}
norm_glyph_set = {c['character'] for c in norm_chars}
assert cat_glyph_set == norm_glyph_set, "Character glyphs do not match 100%!"

# Check stroke and median consistency
stroke_median_mismatches = []
out_of_bounds = []
empty_strokes = []

min_x, max_x = float('inf'), float('-inf')
min_y, max_y = float('inf'), float('-inf')

by_provider = {}
by_render_mode = {}
by_audit_status = {}

for c in norm_chars:
    cid = c['id']
    ch = c['character']
    prov = c['provider']
    rm = c['renderMode']
    status = c['auditStatus']

    by_provider[prov] = by_provider.get(prov, 0) + 1
    by_render_mode[rm] = by_render_mode.get(rm, 0) + 1
    by_audit_status[status] = by_audit_status.get(status, 0) + 1

    strokes = c['strokes']
    medians = c['medians']

    if len(strokes) != len(medians):
        stroke_median_mismatches.append((cid, ch, len(strokes), len(medians)))
    if len(strokes) == 0:
        empty_strokes.append((cid, ch))

    for s_idx, med in enumerate(medians):
        if len(med) < 2:
            print(f"Warning: Median has < 2 points in {ch} stroke {s_idx}")
        for p in med:
            x, y = p[0], p[1]
            min_x = min(min_x, x)
            max_x = max(max_x, x)
            min_y = min(min_y, y)
            max_y = max(max_y, y)
            if not (-100 <= x <= 1124 and -100 <= y <= 1124):
                out_of_bounds.append((cid, ch, s_idx, x, y))

print("\n--- VERIFICATION CHECKS ---")
print(f"1. Missing characters: 0 / 637 (100.0% coverage)")
print(f"2. len(strokes) == len(medians) mismatches: {len(stroke_median_mismatches)}")
assert len(stroke_median_mismatches) == 0, f"Found {len(stroke_median_mismatches)} mismatches!"
print(f"3. Empty strokes: {len(empty_strokes)}")
assert len(empty_strokes) == 0, f"Found empty strokes: {empty_strokes}"
print(f"4. Coordinate bounds across all medians: X in [{min_x:.1f}, {max_x:.1f}], Y in [{min_y:.1f}, {max_y:.1f}]")
print(f"5. Extreme out of bounds (> 100 margin): {len(out_of_bounds)}")
assert len(out_of_bounds) == 0, f"Out of bounds: {out_of_bounds}"

print("\n--- BREAKDOWN BY PROVIDER ---")
for p, count in by_provider.items():
    print(f"  {p:15s}: {count:3d} ({count/637*100:.2f}%)")

print("\n--- BREAKDOWN BY RENDER MODE ---")
for rm, count in by_render_mode.items():
    print(f"  {rm:15s}: {count:3d} ({count/637*100:.2f}%)")

print("\n--- BREAKDOWN BY AUDIT STATUS ---")
for st, count in by_audit_status.items():
    print(f"  {st:20s}: {count:3d} ({count/637*100:.2f}%)")

print("\nALL NORMALIZED STROKE CHECKS PASSED PERFECTLY.")
