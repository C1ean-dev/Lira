"""Split a legacy Lira atlas into immutable image files, preserving its metadata.

The original PNG/XML are retained as a migration backup.
"""
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from PIL import Image


def decode(node):
    if node.tag == 'Object':
        return {entry.attrib['key']: decode(entry[0]) for entry in node}
    if node.tag == 'Array':
        return [decode(child) for child in node]
    if node.tag == 'Number':
        return float(node.text)
    if node.tag == 'Boolean':
        return node.text == 'true'
    if node.tag == 'Null':
        return None
    return node.text or ''


def entry(node, key):
    return next((child[0] for child in node if child.attrib.get('key') == key), None)


def materialize_compositions(document, directory):
    root = ET.fromstring(document)
    assets = entry(root, 'assets')
    added = set()
    for asset_node in assets if assets is not None else []:
        asset = decode(asset_node)
        groups = [(entry(asset_node, 'frames'), None)]
        directions = entry(asset_node, 'directionalFrames')
        if directions is not None:
            groups += [(child[0], child.attrib['key']) for child in directions]
        for group, direction in groups:
            if group is None:
                continue
            for node in list(group) if group.tag == 'Array' else [group]:
                if node.tag != 'String' or not (node.text or '').startswith('composition:'):
                    continue
                index = int(node.text.split(':')[2])
                layers = ((asset.get('directionalFrameLayers') or {}).get(direction, []) if direction else (asset.get('frameLayers') or []))[index]
                dims = (asset.get('directionalDimensions') or {}).get(direction, {}) or {}
                width = dims.get('pixelWidth') or (dims.get('width') or asset['width']) * 32
                height = dims.get('pixelHeight') or (dims.get('height') or asset['height']) * 32
                board_max = max(width, height, 1)
                original_max = max([board_max] + [max(layer.get('origWidth') or layer['width'], layer.get('origHeight') or layer['height']) for layer in layers])
                scale = max(1, min(16, math.ceil(min(512, max(board_max, original_max)) / board_max)))
                canvas = Image.new('RGBA', (round(width * scale), round(height * scale)))
                for layer in layers:
                    with Image.open(directory / 'images' / layer['dataUrl']) as source:
                        image = source.convert('RGBA').resize((round(layer['width'] * scale), round(layer['height'] * scale)), Image.Resampling.BICUBIC if scale > 1 or original_max > board_max * 1.25 else Image.Resampling.NEAREST)
                    if layer.get('flipH'):
                        image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                    opacity = layer.get('opacity', 1)
                    if opacity != 1:
                        image.putalpha(image.getchannel('A').point(lambda value: round(value * opacity)))
                    canvas.alpha_composite(image, (round(layer['x'] * scale), round(layer['y'] * scale)))
                output = io.BytesIO()
                canvas.save(output, format='PNG')
                data = output.getvalue()
                name = hashlib.sha256(data).hexdigest() + '.png'
                target = directory / 'images' / name
                if not target.exists():
                    target.write_bytes(data)
                added.add(name)
                node.tag = 'Image'
                node.text = name
    return ET.tostring(root, encoding='unicode', short_empty_elements=False).replace('<Null></Null>', '<Null/>'), added


def migrate(directory):
    directory = Path(directory)
    xml = (directory / 'library.xml').read_text(encoding='utf-8')
    root = ET.fromstring(xml)
    image_name = root.attrib['imagePath']
    if Path(image_name).name != image_name or '/' in image_name or '\\' in image_name:
        raise ValueError('Invalid atlas filename')
    document = re.search(r'<LiraAssets>([\s\S]*?)</LiraAssets>', xml).group(1)
    regions = {r.attrib['name']: r.attrib for r in root.findall('SubTexture')}
    images = directory / 'images'
    images.mkdir(exist_ok=True)
    names = {}
    with Image.open(directory / image_name) as atlas:
        for reference in ET.fromstring(document).iter('Image'):
            key = reference.text
            if key in names:
                continue
            region = regions[key]
            x, y, w, h = [int(region[n]) for n in ('x', 'y', 'width', 'height')]
            if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > atlas.width or y + h > atlas.height:
                raise ValueError('Invalid image bounds')
            output = io.BytesIO()
            atlas.crop((x, y, x + w, y + h)).save(output, format='PNG')
            data = output.getvalue()
            name = hashlib.sha256(data).hexdigest() + '.png'
            target = images / name
            if not target.exists():
                target.write_bytes(data)
            names[key] = name
    document = re.sub(r'<Image>([^<]+)</Image>', lambda m: '<Image>' + names[m.group(1)] + '</Image>', document)
    document, composed = materialize_compositions(document, directory)
    catalog = {'version': 2, 'document': document, 'images': sorted(set(names.values()) | composed)}
    temporary = directory / 'catalog.json.tmp'
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temporary.replace(directory / 'catalog.json')
    return catalog


if __name__ == '__main__':
    result = migrate(sys.argv[1])
    print(f'Migrated {len(result["images"])} individual images; original atlas preserved.')
