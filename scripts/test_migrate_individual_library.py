import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET
from PIL import Image

spec = importlib.util.spec_from_file_location('migration', Path(__file__).with_name('migrate-individual-library.py'))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


class MigrationTest(unittest.TestCase):
    def test_distributed_library_preserves_100_sampled_images_and_metadata(self):
        source = Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'library'
        legacy = ET.fromstring((source / 'library.xml').read_text(encoding='utf-8'))
        references = list(legacy.find('LiraAssets').iter('Image'))
        names = list(dict.fromkeys(node.text for node in references))
        self.assertGreaterEqual(len(names), 100)
        sampled = [names[index * (len(names) - 1) // 99] for index in range(100)]
        selected = set(sampled)
        # Keep the real document's structure and metadata, but bound conversion
        # and pixel checks to 100 regions spread across the original atlas.
        for index, node in enumerate(references):
            if node.text not in selected:
                node.text = sampled[index % len(sampled)]
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            (directory / 'library.xml').write_text(ET.tostring(legacy, encoding='unicode'), encoding='utf-8')
            shutil.copyfile(source / legacy.attrib['imagePath'], directory / legacy.attrib['imagePath'])
            catalog = migration.migrate(directory)
            self.assert_original_library_pixels(legacy, catalog, directory)

    def assert_original_library_pixels(self, legacy, catalog, directory):
        previous = legacy.find('LiraAssets')[0]
        current = ET.fromstring(catalog['document'])
        regions = {region.attrib['name']: region.attrib for region in legacy.findall('SubTexture')}
        checked = set()
        with Image.open(directory / legacy.attrib['imagePath']) as atlas:
            def compare(old, new):
                self.assertEqual(old.attrib, new.attrib)
                if old.tag == 'Image':
                    self.assertEqual(new.tag, 'Image')
                    self.assertIn(new.text, catalog['images'])
                    if old.text not in checked:
                        checked.add(old.text)
                        region = regions[old.text]
                        x, y, w, h = [int(region[key]) for key in ('x', 'y', 'width', 'height')]
                        expected = atlas.crop((x, y, x + w, y + h)).convert('RGBA')
                        with Image.open(directory / 'images' / new.text) as actual:
                            self.assertEqual(actual.size, expected.size)
                            self.assertEqual(actual.convert('RGBA').tobytes(), expected.tobytes(), old.text)
                elif old.tag == 'String' and (old.text or '').startswith('composition:'):
                    self.assertEqual(new.tag, 'Image')
                    self.assertIn(new.text, catalog['images'])
                else:
                    self.assertEqual(old.tag, new.tag)
                    self.assertEqual(old.text or '', new.text or '')
                    self.assertEqual(len(old), len(new))
                    for before, after in zip(old, new):
                        compare(before, after)
            compare(previous, current)
        self.assertEqual(len(checked), 100)

    def test_materializes_legacy_composition_frames(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            Image.new('RGBA', (2, 2), 'red').save(directory / 'library.png')
            metadata = '<Object><Entry key="assets"><Array><Object><Entry key="width"><Number>1</Number></Entry><Entry key="height"><Number>1</Number></Entry><Entry key="frames"><Array><String>composition:frames:0</String></Array></Entry><Entry key="frameLayers"><Array><Array><Object><Entry key="dataUrl"><Image>red</Image></Entry><Entry key="x"><Number>0</Number></Entry><Entry key="y"><Number>0</Number></Entry><Entry key="width"><Number>32</Number></Entry><Entry key="height"><Number>32</Number></Entry></Object></Array></Array></Entry></Object></Array></Entry></Object>'
            (directory / 'library.xml').write_text('<TextureAtlas imagePath="library.png"><SubTexture name="red" x="0" y="0" width="2" height="2"/><LiraAssets>' + metadata + '</LiraAssets></TextureAtlas>')
            result = migration.migrate(directory)
            self.assertNotIn('composition:', result['document'])
            self.assertEqual(len(result['images']), 2)

    def test_splits_images_without_changing_pixels_or_deleting_originals(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            original = Image.new('RGBA', (4, 2), 'red')
            original.paste('blue', (2, 0, 4, 2))
            original.save(directory / 'library.png')
            xml = '<TextureAtlas imagePath="library.png"><SubTexture name="red" x="0" y="0" width="2" height="2"/><SubTexture name="blue" x="2" y="0" width="2" height="2"/><LiraAssets><Array><Image>red</Image><Image>blue</Image><Image>red</Image></Array></LiraAssets></TextureAtlas>'
            (directory / 'library.xml').write_text(xml)
            catalog = migration.migrate(directory)
            self.assertEqual(len(catalog['images']), 2)
            self.assertEqual(json.loads((directory / 'catalog.json').read_text()), catalog)
            colors = set()
            for name in catalog['images']:
                with Image.open(directory / 'images' / name) as image:
                    self.assertEqual(image.size, (2, 2))
                    colors.add(image.getpixel((0, 0)))
            self.assertEqual(colors, {(255, 0, 0, 255), (0, 0, 255, 255)})
            self.assertEqual((directory / 'library.xml').read_text(), xml)
            self.assertTrue((directory / 'library.png').exists())


if __name__ == '__main__':
    unittest.main()
