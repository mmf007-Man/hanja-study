"""Parse the textbook's reading notation without adding dictionary senses."""
import re


def parse_reading(text):
    text = ' '.join(text.split())
    readings = []
    # An unspaced slash joins sounds sharing one gloss: 불/부 아니다.
    # A spaced slash starts a separate sound/gloss pair: 락 즐겁다 / 악 노래.
    for pair in re.split(r'\s+/\s+', text):
        match = re.fullmatch(r'([가-힣](?:/[가-힣])*)\s+(.+)', pair)
        if not match:
            raise ValueError(f'Unrecognized textbook reading: {text!r}')
        sounds, gloss = match.groups()
        meanings = [meaning.strip() for meaning in gloss.split(',')]
        if not all(meanings) or any('/' in meaning for meaning in meanings):
            raise ValueError(f'Ambiguous textbook gloss: {text!r}')
        for sound in sounds.split('/'):
            if any(r['sound'] == sound for r in readings):
                raise ValueError(f'Duplicate sound: {text!r}')
            readings.append({'sound': sound, 'meanings': meanings[:]})
    return readings
