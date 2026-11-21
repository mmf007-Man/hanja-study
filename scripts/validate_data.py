"""Validate the character catalog and ordered textbook data using Python 3."""
import json
import re
import sys
from pathlib import Path
from reading_format import parse_reading

ROOT = Path(__file__).resolve().parents[1]
_HANGUL_BASE = 0xAC00
_SYLLABLE_STRIDE = 21 * 28
_CHOSEONG_NIEUN = 2
_CHOSEONG_RIEUL = 5
_CHOSEONG_IEUNG = 11
_ALLOWED_READING_KEYS = frozenset({'sound', 'meanings', 'allowedSounds'})


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_allowed_sounds(reading, glyph):
    allowed = reading['allowedSounds']
    require(isinstance(allowed, list) and bool(allowed), f'Empty or invalid allowedSounds: {glyph}')
    sound = reading['sound']
    require(len(sound) == 1 and bool(re.fullmatch(r'[가-힣]', sound)), f'Invalid base sound for allowedSounds: {glyph}')
    sound_initial, sound_rime = divmod(ord(sound) - _HANGUL_BASE, _SYLLABLE_STRIDE)
    require(
        sound_initial in (_CHOSEONG_NIEUN, _CHOSEONG_RIEUL),
        f'allowedSounds requires ㄴ/ㄹ initial sound: {glyph} ({sound})',
    )
    valid_initials = (_CHOSEONG_IEUNG,) if sound_initial == _CHOSEONG_NIEUN else (_CHOSEONG_NIEUN, _CHOSEONG_IEUNG)
    for alt in allowed:
        require(isinstance(alt, str) and bool(re.fullmatch(r'[가-힣]', alt)), f'Invalid allowedSound syllable: {glyph}')
        require(alt != sound, f'allowedSound equals base sound: {glyph} ({alt})')
        alt_initial, alt_rime = divmod(ord(alt) - _HANGUL_BASE, _SYLLABLE_STRIDE)
        require(
            alt_initial in valid_initials and alt_rime == sound_rime,
            f'Invalid initial-sound law mapping: {glyph} ({sound} -> {alt})',
        )
    require(len(allowed) == len(set(allowed)), f'Duplicate allowedSounds: {glyph}')


def read_json(path):
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f'{path.name}: duplicate JSON key {key}')
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_keys)


def validate(root=ROOT):
    catalog = read_json(root / 'data/characters.json')
    require(catalog['schemaVersion'] == 1, 'Unsupported catalog schema')
    evidence_path = (root / catalog['readingSourceFile']).resolve()
    require(evidence_path.is_relative_to(root.resolve()), 'Reading source must be inside project')
    evidence = read_json(evidence_path)
    require(evidence['review']['status'] == 'verified', 'Source transcription is not reviewed')
    source_by_id = {}
    for entry in evidence['entries']:
        require(entry['id'] not in source_by_id, 'Duplicate reading source ID')
        require(entry['characterId'] == f"hanja-{ord(entry['character']):04X}", 'Source character mismatch')
        require(type(entry['page']) is int and entry['page'] > 0, 'Invalid source page')
        require(type(entry['unitNumber']) is int and entry['unitNumber'] > 0, 'Invalid source unit')
        require(entry['id'] == f"unit-{entry['unitNumber']:02d}-{entry['characterId']}", 'Invalid reading source ID')
        parse_reading(entry['readingText'])
        source_by_id[entry['id']] = entry
    cited_sources = set()
    by_id = {}
    for char in catalog['characters']:
        glyph = char['character']
        require(isinstance(glyph, str) and len(glyph) == 1, 'Expected one Unicode character')
        require(re.fullmatch(r'[\u3400-\u9fff\uf900-\ufaff]', glyph), f'Not a supported Hanja: {glyph}')
        require(char['id'] == f'hanja-{ord(glyph):04X}', f'ID does not match character: {glyph}')
        require(char['codePoint'] == f'U+{ord(glyph):04X}', f'Code point mismatch: {glyph}')
        require(char['id'] not in by_id, f'Duplicate character ID: {glyph}')
        require(char['readingStatus'] in ('pending', 'draft', 'verified'), f'Invalid reading status: {glyph}')
        require(isinstance(char['readings'], list), f'Invalid readings: {glyph}')
        require(char['readingStatus'] != 'verified' or bool(char['readings']), f'Verified readings are empty: {glyph}')
        for reading in char['readings']:
            require(isinstance(reading, dict), f'Invalid reading entry: {glyph}')
            require(set(reading) <= _ALLOWED_READING_KEYS, f'Unexpected reading keys: {glyph}')
            require(re.fullmatch(r'[가-힣]+', reading['sound']), f'Invalid sound: {glyph}')
            require(isinstance(reading['meanings'], list) and bool(reading['meanings']), f'Empty meanings: {glyph}')
            require(all(isinstance(m, str) and m.strip() for m in reading['meanings']), f'Invalid meaning: {glyph}')
            if 'allowedSounds' in reading:
                validate_allowed_sounds(reading, glyph)
        require(len({r['sound'] for r in char['readings']}) == len(char['readings']), f'Duplicate sound: {glyph}')
        source_ids = char.get('readingSourceIds', [])
        require(len(source_ids) == len(set(source_ids)), f'Duplicate reading citations: {glyph}')
        if char['readingStatus'] == 'verified':
            require(bool(source_ids), f'Missing reading provenance: {glyph}')
            base_readings = [{'sound': r['sound'], 'meanings': r['meanings']} for r in char['readings']]
            for source_id in source_ids:
                require(source_id in source_by_id, f'Unknown reading source: {glyph}')
                entry = source_by_id[source_id]
                require(entry['characterId'] == char['id'], f'Reading source points at another character: {glyph}')
                require(base_readings == parse_reading(entry['readingText']), f'Reading differs from reviewed source: {glyph}')
                cited_sources.add(source_id)
            require(char.get('readingVerifiedAt') == evidence['review']['date'], f'Reading review date mismatch: {glyph}')
        require(char['strokeStatus'] in ('pending', 'draft', 'verified', 'unavailable'), f'Invalid stroke status: {glyph}')
        stroke = char.get('strokeData')
        if char['strokeStatus'] == 'verified' or (char['strokeStatus'] == 'draft' and stroke is not None):
            require(isinstance(stroke, dict), f'Stroke data must be an object: {glyph}')
            require(all(isinstance(stroke.get(k), str) and stroke[k].strip() for k in ('provider', 'key', 'version')), f'Incomplete stroke reference: {glyph}')
        by_id[char['id']] = char

    seen_book_ids, referenced = set(), set()
    paths = sorted((root / 'data/textbooks').glob('*.json'))
    require(bool(paths), 'No textbook data found')
    summaries = []
    for path in paths:
        book = read_json(path)
        require(book['schemaVersion'] == catalog['schemaVersion'], f'{path.name}: schema mismatch')
        require(book['dataVersion'] == catalog['dataVersion'], f'{path.name}: data version mismatch')
        require(book['id'] not in seen_book_ids, f'{path.name}: duplicate textbook ID')
        seen_book_ids.add(book['id'])
        require(path.stem == book['id'], f'{path.name}: filename does not match ID')
        require(book['scope'] == 'unit-new-characters', f'{path.name}: unexpected scope')
        source = (root / book['sourceReference']).resolve()
        require(source.is_relative_to(root.resolve()), 'Reference must be inside the project')
        rows = []
        for line in source.read_text(encoding='utf-8').splitlines():
            if re.match(r'^\| \d{2} \|', line):
                number, title, count, pages, glyphs = [p.strip() for p in line.strip('|').split('|')]
                rows.append((int(number), title, int(count), [int(p.strip()) for p in pages.split(',')], glyphs.split()))
        units = book['units']
        require(len(units) == len(rows) > 0, f'{path.name}: unit count differs from reference')
        all_ids = []
        for position, (unit, row) in enumerate(zip(units, rows), 1):
            number, title, count, pages, glyphs = row
            require(unit['number'] == number == position, f'{path.name}: unit sequence mismatch')
            require(unit['id'] == f"{book['id']}-unit-{number:02d}", f'{path.name}: invalid unit ID')
            require(unit['title'] == title, f'Unit {number}: title differs from reference')
            require(unit['sourcePages'] == pages, f'Unit {number}: source pages differ')
            ids = unit['characterIds']
            require(len(ids) == count == len(set(ids)), f'Unit {number}: missing/duplicate entries')
            require(all(char_id in by_id for char_id in ids), f'Unit {number}: unknown character reference')
            require([by_id[char_id]['character'] for char_id in ids] == glyphs, f'Unit {number}: character order differs from reference')
            if book['id'] == evidence['textbookId']:
                source_entries = [e for e in evidence['entries'] if e['unitNumber'] == number]
                require([e['characterId'] for e in source_entries] == ids, f'Unit {number}: source reading coverage/order mismatch')
                require(all(e['page'] in pages for e in source_entries), f'Unit {number}: unexpected reading source page')
            all_ids.extend(ids)
        actual = {'units': len(units), 'entries': len(all_ids), 'uniqueCharacters': len(set(all_ids))}
        require(book['counts'] == actual, f'{path.name}: incorrect counts')
        referenced.update(all_ids)
        summaries.append(f"{book['id']}: {actual['units']} units, {actual['entries']} entries, {actual['uniqueCharacters']} unique")
    require(set(by_id) == referenced, 'Catalog contains unreferenced characters')
    require(evidence['textbookId'] in seen_book_ids, 'Reading source textbook missing')
    require(cited_sources == set(source_by_id), 'Some reviewed reading sources are not cited')
    allowed_count = sum(1 for c in by_id.values() for r in c['readings'] if 'allowedSounds' in r)
    draft_stroke_count = sum(1 for c in by_id.values() if c['strokeStatus'] == 'draft' and isinstance(c.get('strokeData'), dict))
    verified_stroke_count = sum(1 for c in by_id.values() if c['strokeStatus'] == 'verified')
    summaries.append(
        f"{len(by_id)} verified characters, {sum(len(c['readings']) for c in by_id.values())} reading pairs, "
        f"{len(cited_sources)} citations, {allowed_count} allowedSounds pairs, "
        f"{draft_stroke_count} draft strokeData, {verified_stroke_count} verified strokeData"
    )
    return summaries


if __name__ == '__main__':
    try:
        for summary in validate():
            print('PASS:', summary)
        print('PASS: IDs, references, order, counts, Unicode, source readings and readiness status')
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
