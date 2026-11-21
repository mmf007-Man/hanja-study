import os
import shutil
import hashlib
import json
from PIL import Image

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def get_image_info(path):
    with Image.open(path) as img:
        return img.format, img.width, img.height

def main():
    root = os.path.abspath('.')
    pages_dest_dir = os.path.join(root, 'data', 'sources', 'chunjae-middle-hanja-2022-ahn-pages')
    stroke_dest_dir = os.path.join(root, 'data', 'sources', 'chunjae-middle-hanja-2022-ahn-stroke-checks')
    os.makedirs(pages_dest_dir, exist_ok=True)
    os.makedirs(stroke_dest_dir, exist_ok=True)

    dir1 = r'C:\Users\youngs\.gemini\antigravity\brain\861bceb4-7fca-48ae-80c2-e8a8084fb366\browser_sandbox\screenshots'
    dir2 = r'C:\Users\youngs\.gemini\antigravity\brain\3a603221-6dfe-4a8a-a542-69538ff9bef1\browser_sandbox\screenshots'
    dir3 = r'C:\Users\youngs\.gemini\antigravity\brain\e91e4787-6de9-4a10-9301-afa47d7febad\browser_sandbox\screenshots'
    dir4 = r'C:\Users\youngs\.gemini\antigravity\brain\514aeff1-b2d6-4215-9e14-41f6024e6002\browser_sandbox\screenshots'
    dir5 = r'C:\Users\youngs\.gemini\antigravity\brain\c5fdd752-6bda-4210-84c4-a9671d2854b8\browser_sandbox\screenshots'
    dir_stroke = r'C:\Users\youngs\.gemini\antigravity\brain\72c0b056-b10d-45be-81e4-57a8a3cad7d9\browser_sandbox\screenshots'

    # Build mapping for 212 pages
    mapping = {}

    # 1~50
    for i in range(1, 6):
        mapping[i] = os.path.join(dir1, f'step_152_shot_{i}_textbook_p{i:03d}.png')
    for i in range(6, 11):
        mapping[i] = os.path.join(dir1, f'step_154_shot_{i-5}_textbook_p{i:03d}.png')
    for i in range(11, 16):
        mapping[i] = os.path.join(dir1, f'step_156_shot_{i-10}_textbook_p{i:03d}.png')
    for i in range(16, 21):
        mapping[i] = os.path.join(dir1, f'step_158_shot_{i-15}_textbook_p{i:03d}.png')
    for i in range(21, 26):
        mapping[i] = os.path.join(dir1, f'step_160_shot_{i-20}_textbook_p{i:03d}.png')
    mapping[26] = os.path.join(dir1, 'step_320_shot_1_textbook_p026.png')
    for i in range(27, 30):
        mapping[i] = os.path.join(dir1, f'step_173_shot_{i-25}_textbook_p{i:03d}.png')
    mapping[30] = os.path.join(dir1, 'step_171_shot_1_textbook_p030.png')
    for i in range(31, 36):
        mapping[i] = os.path.join(dir1, f'step_175_shot_{i-30}_textbook_p{i:03d}.png')
    for i in range(36, 41):
        mapping[i] = os.path.join(dir1, f'step_177_shot_{i-35}_textbook_p{i:03d}.png')
    for i in range(41, 45):
        mapping[i] = os.path.join(dir1, f'step_179_shot_{i-40}_textbook_p{i:03d}.png')
    mapping[45] = os.path.join(dir1, 'step_185_shot_1_textbook_p045.png')
    for i in range(46, 50):
        mapping[i] = os.path.join(dir1, f'step_187_shot_{i-45}_textbook_p{i:03d}.png')
    mapping[50] = os.path.join(dir1, 'step_189_shot_1_textbook_p050.png')

    # 51~100
    mapping[51] = os.path.join(dir2, 'step_31_shot_1_page_51.png')
    for i in range(52, 58):
        mapping[i] = os.path.join(dir2, f'step_31_shot_{i-50}_page_{i}.png')
    for i in range(58, 64):
        mapping[i] = os.path.join(dir2, f'step_33_shot_{i-57}_page_{i}.png')
    for i in range(64, 70):
        mapping[i] = os.path.join(dir2, f'step_35_shot_{i-63}_page_{i}.png')
    mapping[70] = os.path.join(dir2, 'step_42_shot_1_page_70.png')
    for i in range(71, 75):
        mapping[i] = os.path.join(dir2, f'step_44_shot_{i-70}_page_{i}.png')
    for i in range(75, 79):
        mapping[i] = os.path.join(dir2, f'step_46_shot_{i-74}_page_{i}.png')
    for i in range(79, 82):
        mapping[i] = os.path.join(dir2, f'step_48_shot_{i-78}_page_{i}.png')
    mapping[82] = os.path.join(dir2, 'step_50_shot_1_page_82.png')
    for i in range(83, 86):
        mapping[i] = os.path.join(dir2, f'step_52_shot_{i-82}_page_{i}.png')
    for i in range(86, 89):
        mapping[i] = os.path.join(dir2, f'step_54_shot_{i-85}_page_{i}.png')
    mapping[89] = os.path.join(dir2, 'step_56_shot_1_page_89.png')
    for i in range(90, 93):
        mapping[i] = os.path.join(dir2, f'step_64_shot_{i-89}_page_{i}.png')
    for i in range(93, 97):
        mapping[i] = os.path.join(dir2, f'step_66_shot_{i-92}_page_{i}.png')
    for i in range(97, 101):
        mapping[i] = os.path.join(dir2, f'step_72_shot_{i-96}_page_{i}.png')

    # 101~150
    for i in range(101, 111):
        mapping[i] = os.path.join(dir3, f'step_33_shot_{i-100}.png')
    for i in range(111, 119):
        mapping[i] = os.path.join(dir3, f'step_40_shot_{i-110}.png')
    mapping[119] = os.path.join(dir3, 'step_42_shot_1.png')
    mapping[120] = os.path.join(dir3, 'step_46_shot_1.png')
    for i in range(121, 127):
        mapping[i] = os.path.join(dir3, f'step_52_shot_{i-120}.png')
    for i in range(127, 133):
        mapping[i] = os.path.join(dir3, f'step_54_shot_{i-126}.png')
    for i in range(133, 139):
        mapping[i] = os.path.join(dir3, f'step_56_shot_{i-132}.png')
    for i in range(139, 145):
        mapping[i] = os.path.join(dir3, f'step_58_shot_{i-138}.png')
    for i in range(145, 151):
        mapping[i] = os.path.join(dir3, f'step_60_shot_{i-144}.png')

    # 151~193 & 208~212
    for i in range(151, 155):
        mapping[i] = os.path.join(dir4, f'step_123_shot_{i-150}.png')
    mapping[155] = os.path.join(dir4, 'step_140_shot_1.png')
    for i in range(156, 160):
        mapping[i] = os.path.join(dir4, f'step_148_shot_{i-155}.png')
    for i in range(160, 163):
        mapping[i] = os.path.join(dir4, f'step_150_shot_{i-159}.png')
    for i in range(163, 166):
        mapping[i] = os.path.join(dir4, f'step_152_shot_{i-162}.png')
    for i in range(166, 169):
        mapping[i] = os.path.join(dir4, f'step_154_shot_{i-165}.png')
    for i in range(169, 172):
        mapping[i] = os.path.join(dir4, f'step_156_shot_{i-168}.png')
    for i in range(172, 175):
        mapping[i] = os.path.join(dir4, f'step_158_shot_{i-171}.png')
    for i in range(175, 178):
        mapping[i] = os.path.join(dir4, f'step_160_shot_{i-174}.png')
    for i in range(178, 180):
        mapping[i] = os.path.join(dir4, f'step_162_shot_{i-177}.png')
    for i in range(180, 182):
        mapping[i] = os.path.join(dir4, f'step_164_shot_{i-179}.png')
    for i in range(182, 185):
        mapping[i] = os.path.join(dir4, f'step_173_shot_{i-181}.png')
    for i in range(185, 188):
        mapping[i] = os.path.join(dir4, f'step_175_shot_{i-184}.png')
    for i in range(188, 191):
        mapping[i] = os.path.join(dir4, f'step_177_shot_{i-187}.png')
    for i in range(191, 194):
        mapping[i] = os.path.join(dir4, f'step_179_shot_{i-190}.png')
    mapping[208] = os.path.join(dir4, 'step_181_shot_1.png')
    for i in range(209, 211):
        mapping[i] = os.path.join(dir4, f'step_183_shot_{i-208}.png')
    for i in range(211, 213):
        mapping[i] = os.path.join(dir4, f'step_185_shot_{i-210}.png')

    # 194~207
    for i in range(194, 197):
        mapping[i] = os.path.join(dir5, f'step_190_shot_{i-193}_hanja900_p{i}_clean_2000x2600.png')
    for i in range(197, 200):
        mapping[i] = os.path.join(dir5, f'step_192_shot_{i-196}_hanja900_p{i}_clean_2000x2600.png')
    for i in range(200, 203):
        mapping[i] = os.path.join(dir5, f'step_194_shot_{i-199}_hanja900_p{i}_clean_2000x2600.png')
    for i in range(203, 206):
        mapping[i] = os.path.join(dir5, f'step_196_shot_{i-202}_hanja900_p{i}_clean_2000x2600.png')
    for i in range(206, 208):
        mapping[i] = os.path.join(dir5, f'step_198_shot_{i-205}_hanja900_p{i}_clean_2000x2600.png')

    print(f'Copying {len(mapping)} pages...')
    pages_manifest = []
    res_counts = {}
    total_bytes = 0

    for page_num in range(1, 213):
        src = mapping[page_num]
        filename = f'page-{page_num:03d}.png'
        dest = os.path.join(pages_dest_dir, filename)

        shutil.copy2(src, dest)

        src_hash = sha256_file(src)
        dest_hash = sha256_file(dest)
        assert src_hash == dest_hash, f'Hash mismatch on page {page_num}'

        fmt, w, h = get_image_info(dest)
        assert fmt == 'PNG', f'Format not PNG: {fmt} on {filename}'
        fsize = os.path.getsize(dest)
        assert fsize > 0, f'Empty file {filename}'

        res_key = f'{w}x{h}'
        res_counts[res_key] = res_counts.get(res_key, 0) + 1
        total_bytes += fsize

        pages_manifest.append({
            'page': page_num,
            'filename': filename,
            'width': w,
            'height': h,
            'resolution': res_key,
            'sizeBytes': fsize,
            'sha256': dest_hash,
            'sourceOriginalName': os.path.basename(src)
        })

    print(f'All 212 pages copied and verified! Total size: {total_bytes} bytes ({total_bytes / (1024*1024):.2f} MB)')
    print('Resolution distribution:', res_counts)

    # Copy stroke checks
    stroke_mapping = {
        'step_227.png': 'p018_필순기본.png',
        'step_229.png': 'p019_필순9원칙.png',
        'step_235.png': 'p019_근_확대300.png',
        'step_239.png': 'p078_새한자_초.png',
        'step_243.png': 'p086_새한자_토_보.png',
        'step_245.png': 'p150_새한자_방.png',
        'step_254.png': 'qr_01_근_완성.png',
        'step_188_shot_1.png': 'qr_01_근_단계1.png',
        'step_188_shot_2.png': 'qr_01_근_단계2.png',
        'step_188_shot_3.png': 'qr_01_근_단계3.png',
        'step_188_shot_4.png': 'qr_01_근_단계4.png',
        'step_188_shot_5.png': 'qr_01_근_단계5.png'
    }

    stroke_manifest = []
    stroke_total_bytes = 0
    for src_name, dest_name in stroke_mapping.items():
        src = os.path.join(dir_stroke, src_name)
        assert os.path.exists(src), f'Stroke check file missing: {src}'
        dest = os.path.join(stroke_dest_dir, dest_name)
        shutil.copy2(src, dest)
        src_hash = sha256_file(src)
        dest_hash = sha256_file(dest)
        assert src_hash == dest_hash
        fmt, w, h = get_image_info(dest)
        fsize = os.path.getsize(dest)
        stroke_total_bytes += fsize
        stroke_manifest.append({
            'filename': dest_name,
            'width': w,
            'height': h,
            'resolution': f'{w}x{h}',
            'sizeBytes': fsize,
            'sha256': dest_hash,
            'sourceOriginalName': src_name
        })
    print(f'All {len(stroke_manifest)} stroke-check images copied and verified! ({stroke_total_bytes / (1024*1024):.2f} MB)')

    # Remove old appendix_900 if exists
    old_appendix_dir = os.path.join(root, 'tmp', 'appendix_900')
    if os.path.exists(old_appendix_dir):
        shutil.rmtree(old_appendix_dir)
        print('Deleted old tmp/appendix_900 directory.')

    # Save manifest.json
    manifest_data = {
        'schemaVersion': '1.0.0',
        'dataset': 'chunjae-middle-hanja-2022-ahn-pages',
        'description': '천재교과서 2022 개정 중학교 한문(안대회 외) 전 페이지(1~212쪽) 고해상도 아카이브',
        'totalPages': 212,
        'namingPattern': 'page-{page:03d}.png',
        'totalSizeBytes': total_bytes,
        'totalSizeMB': round(total_bytes / (1024 * 1024), 2),
        'resolutionDistribution': res_counts,
        'sectionMapping': [
            {'name': '표지 및 앞부속 (도비라, 머리말, 차례 등)', 'pageRange': [1, 9]},
            {'name': '대단원 1: 한문과의 첫 만남 (01~03단원)', 'pageRange': [10, 37]},
            {'name': '대단원 2: 나와 우리를 표현하는 한자 (04~06단원)', 'pageRange': [38, 65]},
            {'name': '대단원 3: 지혜가 담긴 성어 (07~10단원)', 'pageRange': [66, 101]},
            {'name': '대단원 4: 생각을 여는 문장 (11~14단원)', 'pageRange': [102, 137]},
            {'name': '대단원 5: 한문으로 만나는 세상 (15~17단원)', 'pageRange': [138, 165]},
            {'name': '대단원 6: 역사를 빚은 인물들 (18~20단원)', 'pageRange': [166, 193]},
            {'name': '부록: 중학교 한문 교육용 기초 한자 900자 표지 및 본문', 'pageRange': [194, 207]},
            {'name': '부록: 색인, 출처, 판권지 등 뒷부속', 'pageRange': [208, 212]}
        ],
        'pages': pages_manifest
    }

    manifest_path = os.path.join(pages_dest_dir, 'manifest.json')
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest_data, f, ensure_ascii=False, indent=2)
    print(f'Wrote manifest.json to {manifest_path}')

if __name__ == '__main__':
    main()
