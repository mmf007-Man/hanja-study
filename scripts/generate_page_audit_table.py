"""Generate page-by-page cross-reference table for 140 audit/corrected characters."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

strokes_path = ROOT / 'data/strokes/normalized_strokes.json'
readings_path = ROOT / 'data/sources/chunjae-middle-hanja-2022-ahn-readings.json'

strokes_data = json.loads(strokes_path.read_text(encoding='utf-8'))['characters']
readings_entries = json.loads(readings_path.read_text(encoding='utf-8'))['entries']

# Filter target 140 characters
target_dict = {c['id']: c for c in strokes_data if c['needsManualReview'] or c['auditStatus'] == 'corrected_internal'}
print(f"Total target characters: {len(target_dict)}")

# Map character to occurrences
char_occurrences = {}
for e in readings_entries:
    cid = e['characterId']
    if cid in target_dict:
        if cid not in char_occurrences:
            char_occurrences[cid] = []
        char_occurrences[cid].append(e)

# Group by page
page_groups = {}
for cid, occ_list in char_occurrences.items():
    c_info = target_dict[cid]
    for occ in occ_list:
        p = occ['page']
        u = occ['unitNumber']
        if p not in page_groups:
            page_groups[p] = []
        page_groups[p].append({
            'character': c_info['character'],
            'id': cid,
            'codePoint': c_info['codePoint'],
            'sound': c_info['sound'],
            'meanings': c_info['meanings'],
            'unit': u,
            'page': p,
            'provider': c_info['provider'],
            'strokeCount': c_info['strokeCount'],
            'auditStatus': c_info['auditStatus'],
            'renderMode': c_info['renderMode'],
            'notes': c_info['notes'],
        })

sorted_pages = sorted(page_groups.keys())
print(f"Total pages: {len(sorted_pages)}")
print(f"Total character occurrences across pages: {sum(len(v) for v in page_groups.values())}")

# Print key characters summary
key_chars = ['兎', '草', '厖', '步', '者', '花', '舊', '觀', '畵', '姉', '顔', '晩', '爲', '硏', '絶', '郞', '苦', '落', '葉', '藥', '萬', '敬', '祖', '福', '祝', '禮', '敎', '鷄', '豊', '晝']
print("\n=== KEY CHARACTERS PAGE MAPPING ===")
for ch in key_chars:
    matching = [e for e in readings_entries if e['character'] == ch]
    for m in matching:
        cid = m['characterId']
        c_status = target_dict.get(cid, {}).get('auditStatus', 'verified_candidate')
        c_prov = target_dict.get(cid, {}).get('provider', '-')
        c_strokes = target_dict.get(cid, {}).get('strokeCount', '-')
        print(f"  {ch} ({cid}): Unit {m['unitNumber']:02d}, Page {m['page']:3d} | status={c_status}, provider={c_prov}, strokes={c_strokes}")
