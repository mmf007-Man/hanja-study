import urllib.request
import urllib.parse
import json

chars = ['土', '士', '日', '曰', '木', '永', '學', '道', '馬', '國', '火', '九']
samples = {}

for c in chars:
    url = f"https://raw.githubusercontent.com/chanind/hanzi-writer-data/master/data/{urllib.parse.quote(c)}.json"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            samples[c] = data
            print(f"{c}: OK ({len(data['strokes'])} strokes, {len(data['medians'])} medians)")
    except Exception as e:
        print(f"{c}: Fail {e}")

if samples:
    with open('prototype/stroke-assist/data/sample-strokes.json', 'w', encoding='utf-8') as f:
        json.dump(samples, f, ensure_ascii=False, indent=2)

    with open('prototype/stroke-assist/js/sample-strokes.js', 'w', encoding='utf-8') as f:
        f.write('// Built-in sample stroke data for testing prototype (HanziWriter format)\n')
        f.write('window.SAMPLE_STROKES = ')
        json.dump(samples, f, ensure_ascii=False, indent=2)
        f.write(';\n')

    print(f"Saved {len(samples)} sample characters successfully!")
