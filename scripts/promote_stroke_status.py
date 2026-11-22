"""Safely promote strokeStatus (draft -> verified) in data/characters.json."""
import argparse
import datetime
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from validate_data import read_json, validate  # noqa: E402

_SEMVER_RE = re.compile(r'^(\d+)\.(\d+)\.(\d+)$')
_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_STROKE_STATUSES = ('verified', 'draft', 'pending', 'unavailable')


def dedupe_preserve_order(items):
    """Return unique items in their original order."""
    seen = set()
    ordered = []
    for item in items:
        if item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered


def extract_glyphs_from_text(text):
    """Extract individual Hanja/character tokens ignoring whitespace and commas."""
    glyphs = []
    for token in re.split(r'[\s,]+', text.strip()):
        if token:
            glyphs.extend(list(token))
    return dedupe_preserve_order(glyphs)


def load_chars_file(path):
    """Load target characters from a UTF-8 text file (ignoring # comments, spaces, commas)."""
    if not path.is_file():
        raise ValueError(f'Characters file not found: {path}')
    lines = []
    for raw_line in path.read_text(encoding='utf-8').splitlines():
        clean_line = raw_line.split('#', 1)[0]
        if clean_line.strip():
            lines.append(clean_line)
    glyphs = extract_glyphs_from_text(' '.join(lines))
    if not glyphs:
        raise ValueError(f'No target characters found in file: {path}')
    return glyphs


def load_review_json(path, sync_unavailable=False):
    """Parse Mode B review JSON and classify targets by reviewStatus."""
    if not path.is_file():
        raise ValueError(f'Review JSON file not found: {path}')
    entries = read_json(path)
    if not isinstance(entries, list):
        raise ValueError(f'Review JSON must be a JSON array: {path}')

    seen_status = {}
    promote_targets = []
    unavailable_targets = []
    skipped_by_status = {}

    for idx, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f'Review JSON item #{idx} must be an object')
        glyph = entry.get('character')
        if not isinstance(glyph, str) or len(glyph) != 1:
            raise ValueError(f'Review JSON item #{idx} has invalid character: {glyph!r}')
        entry_id = entry.get('id')
        review_status = entry.get('reviewStatus') or '대기'
        if not isinstance(review_status, str):
            raise ValueError(f'Review JSON item #{idx} ({glyph}) has invalid reviewStatus: {review_status!r}')

        if glyph in seen_status:
            if seen_status[glyph] != review_status:
                raise ValueError(
                    f'Conflicting reviewStatus for {glyph} in {path}: '
                    f'{seen_status[glyph]!r} vs {review_status!r}'
                )
            continue
        seen_status[glyph] = review_status

        if review_status == '일치':
            promote_targets.append((glyph, entry_id))
        elif review_status == '제외':
            if sync_unavailable:
                unavailable_targets.append((glyph, entry_id))
            else:
                skipped_by_status.setdefault('제외 (미동기화)', []).append(glyph)
        else:
            skipped_by_status.setdefault(review_status, []).append(glyph)

    return promote_targets, unavailable_targets, skipped_by_status


def validate_date_string(date_str):
    """Validate YYYY-MM-DD date format."""
    if not _DATE_RE.fullmatch(date_str):
        raise ValueError(f'Invalid date format (expected YYYY-MM-DD): {date_str}')
    datetime.date.fromisoformat(date_str)
    return date_str


def compute_next_version(current_version, bump_mode, explicit_version):
    """Compute target dataVersion from current version and CLI options."""
    if explicit_version is not None:
        if not _SEMVER_RE.fullmatch(explicit_version):
            raise ValueError(f'Invalid semantic version (expected X.Y.Z): {explicit_version}')
        return explicit_version
    if bump_mode == 'none':
        return current_version
    match = _SEMVER_RE.fullmatch(current_version)
    if not match:
        raise ValueError(f'Current dataVersion is not semantic X.Y.Z: {current_version}')
    major, minor, patch = (int(part) for part in match.groups())
    if bump_mode == 'minor':
        return f'{major}.{minor + 1}.0'
    if bump_mode == 'patch':
        return f'{major}.{minor}.{patch + 1}'
    raise ValueError(f'Unsupported bump mode: {bump_mode}')


def write_json(path, data):
    """Write JSON in repository style (UTF-8, indent=2, trailing newline)."""
    with path.open('w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write('\n')


def build_normalized_stroke_index(root):
    """Load data/strokes/normalized_strokes.json and index by character ID."""
    norm_path = root / 'data/strokes/normalized_strokes.json'
    if not norm_path.is_file():
        raise ValueError(f'Normalized stroke data not found: {norm_path}')
    norm_data = read_json(norm_path)
    characters = norm_data.get('characters')
    if not isinstance(characters, list):
        raise ValueError('normalized_strokes.json must contain a characters array')
    by_id = {}
    for entry in characters:
        cid = entry.get('id')
        if not isinstance(cid, str) or not cid:
            raise ValueError('normalized_strokes.json entry missing valid id')
        if cid in by_id:
            raise ValueError(f'Duplicate id in normalized_strokes.json: {cid}')
        by_id[cid] = entry
    return by_id


def has_valid_stroke_ref(stroke_data):
    """Check strokeData dict has non-empty provider, key, and version strings."""
    if not isinstance(stroke_data, dict):
        return False
    return all(
        isinstance(stroke_data.get(field), str) and stroke_data[field].strip()
        for field in ('provider', 'key', 'version')
    )


def has_valid_normalized_strokes(norm_entry, expected_glyph):
    """Verify normalized_strokes entry matches glyph and has valid strokes/medians."""
    if norm_entry is None:
        return False, 'normalized_strokes.json에 항목이 없습니다'
    if norm_entry.get('character') != expected_glyph:
        return False, f"normalized_strokes.json 글자 불일치 ({norm_entry.get('character')!r} != {expected_glyph!r})"
    strokes = norm_entry.get('strokes')
    medians = norm_entry.get('medians')
    if not isinstance(strokes, list) or not isinstance(medians, list):
        return False, 'normalized_strokes.json의 strokes 또는 medians가 배열이 아닙니다'
    if len(strokes) == 0 or len(strokes) != len(medians):
        return False, f'normalized_strokes.json 획/중심선 불일치 (strokes={len(strokes)}, medians={len(medians)})'
    return True, None


def check_promote_eligibility(char_entry, norm_by_id, expected_id=None):
    """Run all pre-flight checks before promoting a character to verified."""
    glyph = char_entry['character']
    cid = char_entry['id']
    if expected_id is not None and expected_id != cid:
        return 'ineligible', f'리뷰 JSON ID 불일치 ({expected_id} != {cid})'

    status = char_entry.get('strokeStatus')
    if status == 'verified':
        return 'already_verified', None
    if status != 'draft':
        return 'ineligible', f"현재 strokeStatus가 '{status}'입니다 ('draft'만 승격 가능)"

    if char_entry.get('readingStatus') != 'verified':
        return 'ineligible', f"readingStatus가 '{char_entry.get('readingStatus')}'입니다 ('verified' 필수)"

    if not has_valid_stroke_ref(char_entry.get('strokeData')):
        return 'ineligible', 'strokeData(provider, key, version)가 불완전합니다'

    ok, reason = has_valid_normalized_strokes(norm_by_id.get(cid), glyph)
    if not ok:
        return 'ineligible', reason

    return 'eligible', None


def verify_post_apply_normalized_consistency(catalog, norm_by_id):
    """Verify all verified characters in catalog match normalized_strokes.json."""
    for char_entry in catalog['characters']:
        if char_entry.get('strokeStatus') == 'verified':
            ok, reason = has_valid_normalized_strokes(norm_by_id.get(char_entry['id']), char_entry['character'])
            if not ok:
                raise ValueError(f"Post-apply normalized_strokes check failed for {char_entry['character']}: {reason}")


def format_glyph_preview(glyphs, limit=20):
    """Format glyph list compactly for terminal summary."""
    if not glyphs:
        return '-'
    if len(glyphs) <= limit:
        return ''.join(glyphs)
    return f"{''.join(glyphs[:limit])} ... (+{len(glyphs) - limit})"


def build_parser():
    """Build CLI argument parser."""
    parser = argparse.ArgumentParser(
        description='Safely promote strokeStatus (draft -> verified) in data/characters.json.',
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        '--chars',
        nargs='+',
        help='Target Hanja characters (e.g. "一十九" or "一,十,九")',
    )
    group.add_argument(
        '--chars-file',
        type=Path,
        help='Path to UTF-8 text file containing target characters (# comments supported)',
    )
    group.add_argument(
        '--from-review-json',
        type=Path,
        help='Path to Mode B exported JSON array (hanja_review_data_*.json)',
    )
    group.add_argument(
        '--all-draft',
        action='store_true',
        help='Target all characters currently in strokeStatus == "draft"',
    )

    parser.add_argument(
        '--sync-unavailable',
        action='store_true',
        help='With --from-review-json, set reviewStatus == "제외" entries to strokeStatus "unavailable" (and clear strokeData)',
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='Apply changes to disk (default is dry-run)',
    )
    parser.add_argument(
        '--bump-version',
        choices=('none', 'minor', 'patch'),
        default='none',
        help='Bump semantic dataVersion in characters.json and textbooks/*.json (default: none)',
    )
    parser.add_argument(
        '--data-version',
        default=None,
        help='Set explicit semantic dataVersion (X.Y.Z) in characters.json and textbooks/*.json',
    )
    parser.add_argument(
        '--date',
        default=None,
        help='Set updatedAt date (YYYY-MM-DD) when updating version/date (default: today when version or --update-date is set)',
    )
    parser.add_argument(
        '--update-date',
        action='store_true',
        help='Update updatedAt to --date (or today) in characters.json and textbooks/*.json',
    )
    parser.add_argument(
        '--root',
        type=Path,
        default=ROOT,
        help=argparse.SUPPRESS,
    )
    return parser


def main(argv=None):
    """CLI entry point."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.sync_unavailable and args.from_review_json is None:
        parser.error('--sync-unavailable can only be used with --from-review-json')
    if args.data_version is not None and args.bump_version != 'none':
        parser.error('--data-version cannot be combined with --bump-version')

    root = args.root.resolve()
    catalog_path = root / 'data/characters.json'
    textbook_paths = sorted((root / 'data/textbooks').glob('*.json'))

    try:
        catalog = read_json(catalog_path)
        norm_by_id = build_normalized_stroke_index(root)
        if not textbook_paths:
            raise ValueError('No textbook JSON files found under data/textbooks/')
        textbooks = [(path, read_json(path)) for path in textbook_paths]

        current_version = catalog['dataVersion']
        current_date = catalog['updatedAt']
        target_version = compute_next_version(current_version, args.bump_version, args.data_version)

        version_changed = target_version != current_version
        explicit_date = validate_date_string(args.date) if args.date is not None else None
        should_update_date = version_changed or args.update_date or (explicit_date is not None)
        target_date = explicit_date or (datetime.date.today().isoformat() if should_update_date else current_date)

        by_char = {entry['character']: entry for entry in catalog['characters']}

        promote_targets = []
        unavailable_targets = []
        skipped_by_status = {}

        if args.chars is not None:
            mode_label = '--chars'
            glyphs = extract_glyphs_from_text(' '.join(args.chars))
            if not glyphs:
                raise ValueError('No characters parsed from --chars')
            promote_targets = [(glyph, None) for glyph in glyphs]
        elif args.chars_file is not None:
            mode_label = f'--chars-file ({args.chars_file})'
            glyphs = load_chars_file(args.chars_file)
            promote_targets = [(glyph, None) for glyph in glyphs]
        elif args.from_review_json is not None:
            mode_label = f'--from-review-json ({args.from_review_json})'
            promote_targets, unavailable_targets, skipped_by_status = load_review_json(
                args.from_review_json,
                sync_unavailable=args.sync_unavailable,
            )
        else:
            mode_label = '--all-draft'
            promote_targets = [
                (entry['character'], entry['id'])
                for entry in catalog['characters']
                if entry.get('strokeStatus') == 'draft'
            ]
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        return 1

    to_promote = []
    already_verified = []
    to_unavailable = []
    already_unavailable = []
    ineligible = []

    for glyph, expected_id in promote_targets:
        char_entry = by_char.get(glyph)
        if char_entry is None:
            ineligible.append((glyph, 'data/characters.json에 존재하지 않는 한자입니다'))
            continue
        outcome, reason = check_promote_eligibility(char_entry, norm_by_id, expected_id=expected_id)
        if outcome == 'eligible':
            to_promote.append(char_entry)
        elif outcome == 'already_verified':
            already_verified.append(glyph)
        else:
            ineligible.append((glyph, reason))

    for glyph, expected_id in unavailable_targets:
        char_entry = by_char.get(glyph)
        if char_entry is None:
            ineligible.append((glyph, 'data/characters.json에 존재하지 않는 한자입니다'))
            continue
        if expected_id is not None and expected_id != char_entry['id']:
            ineligible.append((glyph, f"리뷰 JSON ID 불일치 ({expected_id} != {char_entry['id']})"))
            continue
        if char_entry.get('strokeStatus') == 'unavailable':
            already_unavailable.append(glyph)
        else:
            to_unavailable.append(char_entry)

    if ineligible:
        print(f'[{"APPLIED" if args.apply else "DRY-RUN"}] Pre-flight validation FAILED ({mode_label})')
        print(f'- Ineligible / failed targets ({len(ineligible)}):')
        for glyph, reason in ineligible:
            print(f'  * {glyph}: {reason}')
        print('No files were modified.')
        return 1

    applied_files = []
    metadata_changed = (target_version != current_version) or (
        should_update_date and (
            catalog.get('updatedAt') != target_date
            or any(book.get('updatedAt') != target_date or book.get('dataVersion') != target_version for _, book in textbooks)
        )
    )
    has_changes = bool(to_promote or to_unavailable or metadata_changed)

    if args.apply and has_changes:
        backups = {catalog_path: catalog_path.read_bytes()}
        for book_path, _ in textbooks:
            backups[book_path] = book_path.read_bytes()

        for char_entry in to_promote:
            char_entry['strokeStatus'] = 'verified'
        for char_entry in to_unavailable:
            char_entry['strokeStatus'] = 'unavailable'
            char_entry.pop('strokeData', None)

        if target_version != current_version or should_update_date:
            catalog['dataVersion'] = target_version
            if should_update_date:
                catalog['updatedAt'] = target_date
            for _, book in textbooks:
                book['dataVersion'] = target_version
                if should_update_date:
                    book['updatedAt'] = target_date

        try:
            write_json(catalog_path, catalog)
            applied_files.append(catalog_path)
            if target_version != current_version or should_update_date:
                for book_path, book in textbooks:
                    write_json(book_path, book)
                    applied_files.append(book_path)

            validation_summaries = validate(root=root)
            verify_post_apply_normalized_consistency(catalog, norm_by_id)
        except Exception as error:
            for orig_path, orig_content in backups.items():
                orig_path.write_bytes(orig_content)
            print(f'FAIL: Post-apply validation failed (changes rolled back): {error}', file=sys.stderr)
            return 1
    else:
        validation_summaries = []

    projected_counts = Counter(entry['strokeStatus'] for entry in catalog['characters'])
    if not args.apply:
        for char_entry in to_promote:
            projected_counts[char_entry['strokeStatus']] -= 1
            projected_counts['verified'] += 1
        for char_entry in to_unavailable:
            projected_counts[char_entry['strokeStatus']] -= 1
            projected_counts['unavailable'] += 1

    mode_banner = 'APPLIED' if args.apply else 'DRY-RUN'
    print(f'=== Stroke Status Promotion Summary ({mode_banner}) ===')
    print(f'Source / 대상 선택: {mode_label}')
    print(f'Promoted (draft -> verified) / 승격 대상: {len(to_promote)}자 ({format_glyph_preview([c["character"] for c in to_promote])})')
    print(f'Already verified / 기승격 완료: {len(already_verified)}자')
    if unavailable_targets or args.sync_unavailable:
        print(f'Synced to unavailable / 제외 반영: {len(to_unavailable)}자 ({format_glyph_preview([c["character"] for c in to_unavailable])})')
        print(f'Already unavailable / 기존 제외: {len(already_unavailable)}자')

    if skipped_by_status:
        skipped_total = sum(len(v) for v in skipped_by_status.values())
        print(f'Skipped review items (remain draft) / 보류·수정 대기: {skipped_total}자')
        for status_name, glyphs in skipped_by_status.items():
            print(f'  - {status_name}: {len(glyphs)}자 ({format_glyph_preview(glyphs, limit=12)})')

    status_summary = ', '.join(f'{st}={projected_counts.get(st, 0)}' for st in _STROKE_STATUSES)
    print(f'Catalog totals ({"actual" if args.apply else "projected"}) / 전체 현황: {status_summary} (total={len(catalog["characters"])})')
    print(
        f'Version / 버전 정보: dataVersion {current_version} -> {target_version}, '
        f'updatedAt {current_date} -> {target_date}'
    )

    if args.apply:
        if applied_files:
            rel_files = ', '.join(str(p.relative_to(root)) for p in applied_files)
            print(f'Updated files / 수정된 파일: {rel_files}')
            for summary in validation_summaries:
                print(f'PASS: {summary}')
        else:
            print('No changes needed; files untouched.')
    else:
        print('Dry-run mode: no files were modified. Pass --apply to write changes.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
