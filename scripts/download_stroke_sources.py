"""Download open-source Hanja stroke datasets to tmp/."""
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TMP_DIR = ROOT / 'tmp'

SOURCES = [
    # AnimCJK
    {
        'name': 'AnimCJK graphicsKo.txt',
        'url': 'https://raw.githubusercontent.com/parsimonhi/animCJK/master/graphicsKo.txt',
        'dest': TMP_DIR / 'animcjk' / 'graphicsKo.txt',
    },
    {
        'name': 'AnimCJK dictionaryKo.txt',
        'url': 'https://raw.githubusercontent.com/parsimonhi/animCJK/master/dictionaryKo.txt',
        'dest': TMP_DIR / 'animcjk' / 'dictionaryKo.txt',
    },
    {
        'name': 'AnimCJK graphicsZhHant.txt',
        'url': 'https://raw.githubusercontent.com/parsimonhi/animCJK/master/graphicsZhHant.txt',
        'dest': TMP_DIR / 'animcjk' / 'graphicsZhHant.txt',
    },
    {
        'name': 'AnimCJK dictionaryZhHant.txt',
        'url': 'https://raw.githubusercontent.com/parsimonhi/animCJK/master/dictionaryZhHant.txt',
        'dest': TMP_DIR / 'animcjk' / 'dictionaryZhHant.txt',
    },
    {
        'name': 'AnimCJK README.md',
        'url': 'https://raw.githubusercontent.com/parsimonhi/animCJK/master/README.md',
        'dest': TMP_DIR / 'animcjk' / 'README.md',
    },
    {
        'name': 'AnimCJK COPYING.txt',
        'url': 'https://raw.githubusercontent.com/parsimonhi/animCJK/master/licenses/COPYING.txt',
        'dest': TMP_DIR / 'animcjk' / 'COPYING.txt',
    },
    # MakeMeAHanzi
    {
        'name': 'MakeMeAHanzi graphics.txt',
        'url': 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/graphics.txt',
        'dest': TMP_DIR / 'makemeahanzi' / 'graphics.txt',
    },
    {
        'name': 'MakeMeAHanzi dictionary.txt',
        'url': 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt',
        'dest': TMP_DIR / 'makemeahanzi' / 'dictionary.txt',
    },
    {
        'name': 'MakeMeAHanzi README.md',
        'url': 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/README.md',
        'dest': TMP_DIR / 'makemeahanzi' / 'README.md',
    },
    {
        'name': 'MakeMeAHanzi COPYING',
        'url': 'https://raw.githubusercontent.com/skishore/makemeahanzi/master/COPYING',
        'dest': TMP_DIR / 'makemeahanzi' / 'COPYING',
    },
    # KanjiVG
    {
        'name': 'KanjiVG kvg-index.json',
        'url': 'https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kvg-index.json',
        'dest': TMP_DIR / 'kanjivg' / 'kvg-index.json',
    },
    {
        'name': 'KanjiVG README.md',
        'url': 'https://raw.githubusercontent.com/KanjiVG/kanjivg/master/README.md',
        'dest': TMP_DIR / 'kanjivg' / 'README.md',
    },
    {
        'name': 'KanjiVG COPYING',
        'url': 'https://raw.githubusercontent.com/KanjiVG/kanjivg/master/COPYING',
        'dest': TMP_DIR / 'kanjivg' / 'COPYING',
    },
]


def download_file(url: str, dest: Path, name: str):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        print(f"Already downloaded: {name} ({dest.stat().st_size:,} bytes)")
        return
    print(f"Downloading {name} from {url}...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp, open(dest, 'wb') as out_f:
        chunk_size = 1024 * 256
        total = 0
        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            out_f.write(chunk)
            total += len(chunk)
            print(f"\r  Received {total:,} bytes", end='', flush=True)
        print(f"\r  Finished: {total:,} bytes saved to {dest}")


def main():
    print(f"Starting stroke datasets download to {TMP_DIR}...")
    for item in SOURCES:
        download_file(item['url'], item['dest'], item['name'])
    print("\nAll datasets downloaded successfully.")


if __name__ == '__main__':
    main()
