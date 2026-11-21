import json
import os
import re

# Load 637 characters catalog
with open('data/characters.json', 'r', encoding='utf-8') as f:
    chars_data = json.load(f)
    chars = chars_data['characters']

# Load 159 high-priority review list from markdown
with open('docs/참고-획데이터-기준-및-대조목록.md', 'r', encoding='utf-8') as f:
    doc_lines = f.readlines()

high159_map = {}
for line in doc_lines:
    line_clean = line.strip()
    if line_clean.startswith('|') and 'hanja-' in line_clean:
        parts = [p.strip() for p in line_clean.split('|')[1:-1]]
        if len(parts) >= 8:
            seq = int(parts[0])
            hid = parts[1].replace('`', '').strip()
            ch = parts[2].replace('*', '').strip()
            ucode = parts[3].replace('`', '').strip()
            reading = parts[4].strip()
            category = parts[5].strip()
            detail = parts[6].strip()
            status = parts[7].replace('`', '').strip()

            high159_map[ch] = {
                "seq": seq,
                "id": hid,
                "character": ch,
                "codePoint": ucode,
                "reading": reading,
                "category": category,
                "detail": detail,
                "status": status
            }

print(f"Total 159 targets extracted: {len(high159_map)}")

# List of 45 characters with stroke count mismatches / manual review from report
mismatch_45 = {
    '近', '選', '進', '退', '祖', '育', '過', '防', '敬', '骨', '差', '草', '之', '降', '除', '速',
    '造', '陽', '遠', '苦', '限', '花', '落', '追', '遇', '道', '連', '達', '流', '福', '着', '祝',
    '敢', '以', '庭', '極', '華', '莫', '禮', '姉', '敎', '顔', '兎', '厖', '畫'
}

# Build full 637 list with rich metadata
full_catalog = []
order_num = 1

for c in chars:
    ch = c['character']
    cid = c['id']
    ucode = c['codePoint']
    readings = c.get('readings', [])
    readings_list = [f"{r['sound']}: {', '.join(r['meanings'])}" for r in readings]
    reading_display = " / ".join(readings_list)
    doc_reading = readings_list[0] if readings_list else ""

    is_high = ch in high159_map
    needs_manual = (ch in mismatch_45) or is_high

    if is_high:
        meta159 = high159_map[ch]
        category = meta159["category"]
        detail = meta159["detail"]
        review_status = meta159["status"]
        seq_159 = meta159["seq"]
    else:
        category = "일반 기본 한자"
        detail = "기본 부수와 필순이 한·중·일 간 대체로 일치하는 기본 한자"
        review_status = "대기"
        seq_159 = None

    item = {
        "order": order_num,
        "id": cid,
        "character": ch,
        "codePoint": ucode,
        "docReading": doc_reading,
        "readings": readings,
        "readingDisplay": reading_display,
        "isHighPriority159": is_high,
        "seq159": seq_159,
        "needsManualReview": needs_manual,
        "category": category,
        "detail": detail,
        "reviewStatus": review_status,
        "notes": ""
    }
    full_catalog.append(item)
    order_num += 1

print(f"Total catalog characters processed: {len(full_catalog)}")

# Write to review-targets.json (full 637)
with open('prototype/stroke-assist/data/catalog-targets.json', 'w', encoding='utf-8') as f:
    json.dump(full_catalog, f, ensure_ascii=False, indent=2)

# Also update review-data.js
with open('prototype/stroke-assist/js/review-data.js', 'w', encoding='utf-8') as f:
    f.write('// Auto-generated 637 Hanja Catalog with 159 High Priority & Screening Metadata\n')
    f.write('window.ALL_CHARACTERS_637 = ')
    json.dump(full_catalog, f, ensure_ascii=False, indent=2)
    f.write(';\n\n')
    f.write('// Backward-compatible 159 high-priority subset\n')
    f.write('window.REVIEW_TARGETS_159 = window.ALL_CHARACTERS_637.filter(c => c.isHighPriority159);\n')

print("Successfully generated catalog-targets.json and updated review-data.js!")
