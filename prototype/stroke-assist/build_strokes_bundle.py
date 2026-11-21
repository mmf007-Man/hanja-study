import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_STROKES = ROOT / 'data' / 'strokes' / 'normalized_strokes.json'
OUT_BUNDLE_JS = ROOT / 'prototype' / 'stroke-assist' / 'js' / 'strokes-bundle.js'
OUT_REVIEW_JS = ROOT / 'prototype' / 'stroke-assist' / 'js' / 'review-data.js'
OUT_CATALOG_JSON = ROOT / 'prototype' / 'stroke-assist' / 'data' / 'catalog-targets.json'
OUT_REVIEW_TARGETS_JSON = ROOT / 'prototype' / 'stroke-assist' / 'data' / 'review-targets.json'

print("Reading normalized_strokes.json...")
with open(DATA_STROKES, 'r', encoding='utf-8') as f:
    norm_data = json.load(f)

chars_list = norm_data['characters']
print(f"Total normalized characters: {len(chars_list)}")

# Build dictionary by character and by id
bundle_dict = {}
for c in chars_list:
    # Ensure isTopDown flag is explicitly set on each item for instant recognition
    c['isTopDown'] = True
    c['coordinateSystem'] = 'top-down'
    bundle_dict[c['character']] = c

# Also preserve metadata & list on bundle object
bundle_obj = {
    'schemaVersion': norm_data.get('schemaVersion', 1),
    'generatedAt': norm_data.get('generatedAt', ''),
    'coordinateSystem': norm_data.get('coordinateSystem', {}),
    'statistics': norm_data.get('statistics', {}),
    'characters': chars_list,
    'byCharacter': bundle_dict
}

print(f"Writing strokes-bundle.js to {OUT_BUNDLE_JS}...")
with open(OUT_BUNDLE_JS, 'w', encoding='utf-8') as f:
    f.write('// Auto-generated Standalone Stroke Data Bundle for file:/// and Offline execution\n')
    f.write('// Contains 637 characters in 1024x1024 Top-Down Standard SVG coordinate system\n')
    f.write('window.STROKE_DATA_BUNDLE = ')
    json.dump(bundle_dict, f, ensure_ascii=False)
    f.write(';\n')
    f.write('window.STROKE_DATA_BUNDLE.characters = ')
    json.dump(chars_list, f, ensure_ascii=False)
    f.write(';\n')
    f.write('window.STROKE_DATA_BUNDLE.metadata = ')
    json.dump({
        'schemaVersion': norm_data.get('schemaVersion', 1),
        'generatedAt': norm_data.get('generatedAt', ''),
        'coordinateSystem': norm_data.get('coordinateSystem', {}),
        'statistics': norm_data.get('statistics', {})
    }, f, ensure_ascii=False, indent=2)
    f.write(';\n')

print(f"strokes-bundle.js created successfully ({OUT_BUNDLE_JS.stat().st_size / 1024 / 1024:.2f} MB).")

# Now update review-data.js and catalog-targets.json with normalized_strokes metadata (notes, needsManualReview)
norm_map = {c['character']: c for c in chars_list}

with open(ROOT / 'data' / 'characters.json', 'r', encoding='utf-8') as f:
    chars_catalog = json.load(f)['characters']

full_catalog = []
order_num = 1

for c in chars_catalog:
    ch = c['character']
    cid = c['id']
    ucode = c['codePoint']
    readings = c.get('readings', [])
    readings_list = [f"{r['sound']}: {', '.join(r['meanings'])}" for r in readings]
    reading_display = " / ".join(readings_list)
    doc_reading = readings_list[0] if readings_list else ""

    norm_c = norm_map.get(ch, {})
    is_high = norm_c.get('isHighPriority159', False)
    needs_manual = norm_c.get('needsManualReview', False)
    audit_status = norm_c.get('auditStatus', 'needsManualReview' if needs_manual else 'verified_candidate')
    provider = norm_c.get('provider', '')
    render_mode = norm_c.get('renderMode', 'fill')
    stroke_count = norm_c.get('strokeCount', len(norm_c.get('strokes', [])))
    notes = norm_c.get('notes', '')

    # Category and Detail
    if audit_status == 'corrected_internal':
        category = "자체 보정 정체자"
        detail = f"[3단계 보정 완료] {notes}" if notes else f"한국 교과서 기준 정체자·필순 보정 완료 ({provider}, {stroke_count}획)"
        review_status = "일치"
    elif is_high:
        category = "집중 검수 159자"
        detail = notes or f"고위험군 집중 검수 대상 한자 (제공처: {provider}, {stroke_count}획)"
        review_status = "대기" if needs_manual else "일치"
    elif needs_manual:
        category = "수동 검수 필요"
        detail = notes or f"제공처 간 획수 불일치 또는 검증 필요 한자 ({provider})"
        review_status = "대기"
    else:
        category = "일반 기본 한자"
        detail = f"기본 한자 (제공처: {provider}, {stroke_count}획)"
        review_status = "일치"

    item = {
        "order": order_num,
        "id": cid,
        "character": ch,
        "codePoint": ucode,
        "docReading": doc_reading,
        "readings": readings,
        "readingDisplay": reading_display,
        "isHighPriority159": is_high,
        "needsManualReview": needs_manual,
        "auditStatus": audit_status,
        "provider": provider,
        "renderMode": render_mode,
        "strokeCount": stroke_count,
        "category": category,
        "detail": detail,
        "notes": notes,
        "reviewStatus": review_status
    }
    full_catalog.append(item)
    order_num += 1

with open(OUT_CATALOG_JSON, 'w', encoding='utf-8') as f:
    json.dump(full_catalog, f, ensure_ascii=False, indent=2)

review_targets_159 = [item for item in full_catalog if item['isHighPriority159']]
with open(OUT_REVIEW_TARGETS_JSON, 'w', encoding='utf-8') as f:
    json.dump(review_targets_159, f, ensure_ascii=False, indent=2)

with open(OUT_REVIEW_JS, 'w', encoding='utf-8') as f:
    f.write('// Auto-generated 637 Hanja Catalog with normalized_strokes metadata\n')
    f.write('window.ALL_CHARACTERS_637 = ')
    json.dump(full_catalog, f, ensure_ascii=False, indent=2)
    f.write(';\n\n')
    f.write('// Backward-compatible 159 high-priority subset\n')
    f.write('window.REVIEW_TARGETS_159 = window.ALL_CHARACTERS_637.filter(c => c.isHighPriority159);\n')

manual_count = sum(1 for x in full_catalog if x['needsManualReview'])
high_count = sum(1 for x in full_catalog if x['isHighPriority159'])
corrected_count = sum(1 for x in full_catalog if x.get('auditStatus') == 'corrected_internal')

print(f"review-data.js, catalog-targets.json, and review-targets.json updated successfully (637 total, {manual_count} manual review, {high_count} high priority, {corrected_count} corrected internal).")
