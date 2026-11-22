"""Build runtime static data and per-unit stroke chunks for the web app."""

from __future__ import annotations

import json
import shutil
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'
PUBLIC_DATA_DIR = ROOT / 'public' / 'data'
TEXTBOOK_ID = 'chunjae-middle-hanja-2022-ahn'


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n',
        encoding='utf-8',
    )


def build_app_data(root: Path = ROOT, output_dir: Path | None = None) -> dict:
    data_dir = root / 'data'
    out_dir = output_dir or (root / 'public' / 'data')

    catalog = read_json(data_dir / 'characters.json')
    textbook = read_json(data_dir / 'textbooks' / f'{TEXTBOOK_ID}.json')
    strokes_doc = read_json(data_dir / 'strokes' / 'normalized_strokes.json')

    if catalog.get('schemaVersion') != 1 or textbook.get('schemaVersion') != 1:
        raise ValueError('Unsupported schemaVersion in catalog or textbook')
    if catalog.get('dataVersion') != textbook.get('dataVersion'):
        raise ValueError(
            f"dataVersion mismatch: catalog={catalog.get('dataVersion')} vs textbook={textbook.get('dataVersion')}"
        )

    data_version = catalog['dataVersion']
    catalog_ids = {char['id'] for char in catalog['characters']}
    strokes_by_id = {entry['id']: entry for entry in strokes_doc['characters']}

    if len(strokes_by_id) != len(strokes_doc['characters']):
        raise ValueError('Duplicate character ID found in normalized_strokes.json')
    if catalog_ids != set(strokes_by_id):
        missing = sorted(catalog_ids - set(strokes_by_id))
        extra = sorted(set(strokes_by_id) - catalog_ids)
        raise ValueError(f'Stroke catalog mismatch: missing={missing[:5]}, extra={extra[:5]}')

    # Clean output directory to avoid stale chunks
    chunks_dir = out_dir / 'strokes' / 'chunks'
    if chunks_dir.exists():
        shutil.rmtree(chunks_dir)

    # Copy base catalog & textbook JSON
    write_json(out_dir / 'characters.json', catalog)
    write_json(out_dir / 'textbooks' / f'{TEXTBOOK_ID}.json', textbook)

    character_to_units: dict[str, list[str]] = defaultdict(list)
    unit_chunks: list[dict] = []
    covered_characters: set[str] = set()

    for unit in textbook['units']:
        unit_id = unit['id']
        char_ids = unit['characterIds']
        chunk_characters = []
        for char_id in char_ids:
            if char_id not in strokes_by_id:
                raise ValueError(f'Missing stroke entry for {char_id} in unit {unit_id}')
            chunk_characters.append(strokes_by_id[char_id])
            character_to_units[char_id].append(unit_id)
            covered_characters.add(char_id)

        chunk_rel_file = f'chunks/{unit_id}.json'
        chunk_payload = {
            'schemaVersion': 1,
            'dataVersion': data_version,
            'unitId': unit_id,
            'characters': chunk_characters,
        }
        write_json(out_dir / 'strokes' / chunk_rel_file, chunk_payload)

        unit_chunks.append(
            {
                'unitId': unit_id,
                'number': unit['number'],
                'title': unit['title'],
                'file': chunk_rel_file,
                'characterCount': len(char_ids),
                'characterIds': char_ids,
            }
        )

    if covered_characters != set(strokes_by_id):
        uncovered = sorted(set(strokes_by_id) - covered_characters)
        raise ValueError(f'Uncovered stroke characters: {uncovered[:5]}')

    index_payload = {
        'schemaVersion': 1,
        'dataVersion': data_version,
        'textbookId': textbook['id'],
        'coordinateSystem': strokes_doc['coordinateSystem'],
        'totalCharacters': len(strokes_by_id),
        'unitChunks': unit_chunks,
        'characterToUnits': dict(character_to_units),
    }
    write_json(out_dir / 'strokes' / 'index.json', index_payload)

    return {
        'dataVersion': data_version,
        'unitCount': len(unit_chunks),
        'uniqueCharacters': len(covered_characters),
        'totalEntries': sum(c['characterCount'] for c in unit_chunks),
    }


if __name__ == '__main__':
    try:
        summary = build_app_data()
        print(
            f"Built public/data (v{summary['dataVersion']}): "
            f"{summary['unitCount']} unit chunks, "
            f"{summary['uniqueCharacters']} unique characters, "
            f"{summary['totalEntries']} unit entries"
        )
    except (ValueError, KeyError, OSError) as exc:
        print(f'FAIL: {exc}', file=sys.stderr)
        sys.exit(1)
