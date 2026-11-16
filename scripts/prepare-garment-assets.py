#!/usr/bin/env python3
"""Deterministically crop the three existing demo atlases; never redraw garments."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'assets' / 'garments'
ATLASES = [
    ('products-cutout.png', [('oat', 'coat', 'coat'), ('navy', 'coat', 'coat'), ('trouser', 'bottom', 'trousers'), ('bag', 'bag', 'bag')]),
    ('wardrobe-essentials-cutout.png', [('tee', 'top', 'knit'), ('jeans', 'bottom', 'trousers'), ('shoe', 'shoes', 'shoes'), ('scarf', 'bag', 'scarf')]),
    ('statement-items.png', [('red-knit', 'top', 'knit'), ('lilac-cardigan', 'coat', 'cardigan'), ('mint-pants', 'bottom', 'trousers'), ('black-boots', 'shoes', 'shoes')]),
]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    assets = []
    for atlas_name, entries in ATLASES:
        source = ROOT / 'public' / 'images' / atlas_name
        with Image.open(source) as atlas:
            if atlas.size != (1254, 1254):
                raise ValueError(f'{atlas_name}: expected known 1254 × 1254 source')
            if atlas.mode != 'RGBA':
                raise ValueError(f'{atlas_name}: expected an existing transparent atlas')
            for index, (garment_id, slot, garment_kind) in enumerate(entries):
                left, top = (index % 2) * 627, (index // 2) * 627
                box = (left, top, left + 627, top + 627)
                target = OUT / f'{garment_id}.png'
                cropped = atlas.crop(box)
                cropped.save(target, format='PNG', optimize=False, compress_level=9)
                with Image.open(target) as saved:
                    saved.load()
                    if saved.size != (627, 627):
                        raise ValueError(f'{target.name}: invalid crop dimensions')
                    if saved.mode != 'RGBA' or saved.getchannel('A').getextrema()[0] != 0:
                        raise ValueError(f'{target.name}: transparent canvas was not preserved')
                assets.append({
                    'id': garment_id, 'slot': slot, 'garment_kind': garment_kind,
                    'url': f'/assets/garments/{garment_id}.png',
                    'file': f'public/assets/garments/{garment_id}.png',
                    'mime': 'image/png', 'width': 627, 'height': 627,
                    'bytes': target.stat().st_size, 'sha256': digest(target),
                    'source': {'file': f'public/images/{atlas_name}', 'sha256': digest(source), 'crop_rect': {'x': left, 'y': top, 'width': 627, 'height': 627}},
                })
    manifest = {'version': 1, 'processing_version': 'atlas-transparent-quadrants-v2', 'demo': True, 'assets': assets}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Prepared and decoded {len(assets)} independent demo garment images in {OUT}')

if __name__ == '__main__':
    main()
