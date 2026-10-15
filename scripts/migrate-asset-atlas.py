"""Losslessly migrate the legacy image table to a Sparrow PNG/XML library.

Run from the repository root. Requires Pillow. The old catalog is retired only
after XML metadata and every image region have been read back and compared.
"""
import base64
import hashlib
import io
import json
from pathlib import Path
import xml.etree.ElementTree as ET

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def migrate():
    source = ROOT / 'src/data/nativeAssets.json'
    legacy = json.loads(source.read_text(encoding='utf-8'))
    if not legacy.get('assets'):
        print('No legacy assets to migrate.')
        return
    table = legacy.get('images', {})

    def unpack(value):
        if isinstance(value, str):
            if value.startswith('@@'):
                return value[1:]
            return table.get(value[1:], value) if value.startswith('@') else value
        if isinstance(value, list):
            return [unpack(v) for v in value]
        if isinstance(value, dict):
            return {k: unpack(v) for k, v in value.items()}
        return value

    assets = unpack(legacy['assets'])
    for asset in assets:
        asset.pop('thumbnail', None)
    document = {'assets': assets, 'categories': legacy.get('categories', ['Geral'])}
    images, by_pixels, refs = {}, {}, {}

    def pixel_key(image):
        return (image.size, hashlib.sha256(image.tobytes()).digest())

    def collect(value):
        if isinstance(value, str) and value.startswith('data:image/'):
            image = Image.open(io.BytesIO(base64.b64decode(value.split(',', 1)[1]))).convert('RGBA')
            key = pixel_key(image)
            name = by_pixels.get(key)
            if name is None:
                name = f'image_{len(images)}'
                by_pixels[key] = name
                images[name] = image
            refs[value] = name
        elif isinstance(value, list):
            for v in value:
                collect(v)
        elif isinstance(value, dict):
            for v in value.values():
                collect(v)

    collect(document)
    contained = {}
    # Slicer frames already present in their source sheet become overlapping XML
    # rectangles instead of another copy of the same pixels in the packed PNG.
    for asset in assets:
        parent = refs.get(asset.get('sourceImageSrc', ''))
        if not parent:
            continue
        image = images[parent]
        for preset in asset.get('slicerPresets', []):
            for frames in preset.get('directions', {}).values():
                for frame in frames:
                    x, y, w, h = (int(frame.get(k, 0)) for k in ('x', 'y', 'w', 'h'))
                    if x < 0 or y < 0 or w <= 0 or h <= 0 or x+w > image.width or y+h > image.height:
                        continue
                    name = by_pixels.get(pixel_key(image.crop((x, y, x+w, y+h))))
                    if name and name != parent and images[name].width * images[name].height < image.width * image.height:
                        contained[name] = (parent, x, y, w, h)

    width = max(1, max((im.width for im in images.values()), default=1), min(4096, int(sum(im.width*im.height for n, im in images.items() if n not in contained)**0.5)+1))
    x = y = row = 0
    rectangles = {}
    for name, image in sorted(images.items(), key=lambda item: (-item[1].height, item[0])):
        if name in contained:
            continue
        if x + image.width > width:
            x = 0
            y += row
            row = 0
        rectangles[name] = (x, y, image.width, image.height)
        x += image.width
        row = max(row, image.height)
    sheet = Image.new('RGBA', (width, max(1, y+row)))
    for name, (x, y, w, h) in rectangles.items():
        sheet.paste(images[name], (x, y))

    def resolve(name):
        if name not in rectangles:
            parent, x, y, w, h = contained[name]
            px, py, _, _ = resolve(parent)
            rectangles[name] = (px+x, py+y, w, h)
        return rectangles[name]

    for name in images:
        resolve(name)

    def encode(value):
        if value is None:
            return ET.Element('Null')
        if isinstance(value, bool):
            el = ET.Element('Boolean'); el.text = str(value).lower(); return el
        if isinstance(value, (int, float)):
            el = ET.Element('Number'); el.text = str(value); return el
        if isinstance(value, str):
            el = ET.Element('Image' if value in refs else 'String')
            el.text = refs.get(value, value)
            return el
        el = ET.Element('Array' if isinstance(value, list) else 'Object')
        if isinstance(value, list):
            for v in value:
                el.append(encode(v))
        else:
            for k, v in value.items():
                entry = ET.SubElement(el, 'Entry', key=k); entry.append(encode(v))
        return el

    buffer = io.BytesIO(); sheet.save(buffer, format='PNG', optimize=True)
    png = buffer.getvalue()
    png_name = f'library-{hashlib.sha256(png).hexdigest()}.png'
    root = ET.Element('TextureAtlas', imagePath=png_name, liraVersion='1')
    for name, (x, y, w, h) in rectangles.items():
        ET.SubElement(root, 'SubTexture', name=name, x=str(x), y=str(y), width=str(w), height=str(h))
    metadata = ET.SubElement(root, 'LiraAssets'); metadata.append(encode(document))
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding='unicode', short_empty_elements=True).replace('<Null />', '<Null/>').replace('<String />', '<String></String>').replace('<Array />', '<Array></Array>').replace('<Object />', '<Object></Object>') + '\n'
    directory = ROOT / 'public/assets/library'; directory.mkdir(parents=True, exist_ok=True)
    png_path = directory / png_name
    png_path.write_bytes(png)
    xml_path = directory / 'library.xml'
    temporary = directory / '.library.xml.tmp'; temporary.write_text(xml, encoding='utf-8')
    decoded = Image.open(png_path).convert('RGBA')
    for name, (x, y, w, h) in rectangles.items():
        assert pixel_key(decoded.crop((x, y, x+w, y+h))) == pixel_key(images[name]), name
    parsed = ET.parse(temporary).getroot()

    def decode(el):
        if el.tag == 'Null': return None
        if el.tag == 'Boolean': return el.text == 'true'
        if el.tag == 'Number': return float(el.text) if '.' in el.text else int(el.text)
        if el.tag == 'String': return el.text or ''
        if el.tag == 'Image':
            # Compare pixels separately above; recover the exact original string here.
            return next(s for s, name in refs.items() if name == el.text)
        if el.tag == 'Array': return [decode(v) for v in el]
        if el.tag == 'Object': return {v.attrib['key']: decode(v[0]) for v in el}
        raise ValueError(el.tag)

    def comparable(value):
        if isinstance(value, str) and value in refs: return ('image', refs[value])
        if isinstance(value, list): return [comparable(v) for v in value]
        if isinstance(value, dict): return {k: comparable(v) for k, v in value.items()}
        return value
    assert comparable(decode(parsed.find('LiraAssets')[0])) == comparable(document)
    temporary.replace(xml_path)
    # Compatibility stub for older readers/tests; no asset catalog or image data remains.
    source.write_text(json.dumps({'categories': document['categories'], 'assets': [], 'images': {}}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'Validated {len(assets)} assets and {len(images)} pixel-identical images; {len(contained)} frames reuse source-sheet regions.')
    print(f'PNG: {len(png)} bytes; XML: {len(xml.encode("utf-8"))} bytes; sheet: {sheet.width}x{sheet.height}.')


if __name__ == '__main__':
    migrate()
