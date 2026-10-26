"""Small pinned MS-SNSD evaluation, cached outside shipped assets. No training."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'node_modules/.cache/noise-metrics'))
import numpy as np
from scipy import signal
from metrics import RATE, align, measure, rms


def write_wav(path, samples):
    with wave.open(str(path), 'wb') as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())


def read_wav(path):
    with wave.open(str(path), 'rb') as file:
        if file.getsampwidth() != 2:
            raise ValueError('Expected 16-bit PCM: ' + str(path))
        values = np.frombuffer(file.readframes(file.getnframes()), dtype='<i2').astype(np.float64) / 32768
        values = values.reshape(-1, file.getnchannels()).mean(axis=1)
        rate = file.getframerate()
    divisor = np.gcd(RATE, rate)
    return signal.resample_poly(values, RATE // divisor, rate // divisor)


def prepare(output, profile):
    manifest = json.loads(Path(__file__).with_name('manifest.json').read_text())
    cache = ROOT / 'node_modules/.cache/ms-snsd' / manifest['revision']
    for item in manifest['files']:
        target = cache / item['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            url = f'https://raw.githubusercontent.com/{manifest["repository"]}/{manifest["revision"]}/{item["path"]}'
            print('Downloading ' + item['path'], flush=True)
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read()
            if len(data) != item['bytes'] or hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() != item['gitBlob']:
                raise ValueError('Dataset integrity mismatch: ' + item['path'])
            target.write_bytes(data)
        data = target.read_bytes()
        if hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() != item['gitBlob']:
            raise ValueError('Cached dataset integrity mismatch: ' + item['path'])
    specifications = []
    if profile == 'smoke':
        specifications = [(0, None, None, 0.0045), (0, None, None, 0.04),
                          (0, 'AirConditioner', 5, 0.03), (0, 'Typing', 5, 0.03)]
    elif profile == 'validation':
        for clip_index, speaker in enumerate([113, 347]):
            specifications.extend([(speaker, None, None, 0.0045),
                                   (speaker, ['Typing', 'AirConditioner'][clip_index], 5, 0.0045)])
            for noise_index, noise in enumerate(['ShuttingDoor', 'Neighbor']):
                specifications.append((speaker, noise, 10 * ((clip_index + noise_index) % 2), 0.03))
    else:
        for speaker in [0, 17]:
            specifications.extend([(speaker, None, None, 0.0045), (speaker, None, None, 0.04)])
            for noise in ['AirConditioner', 'Typing', 'Babble', 'VacuumCleaner']:
                specifications.extend((speaker, noise, snr, 0.03) for snr in [0, 10])
    cases = []
    output.mkdir(parents=True, exist_ok=True)
    for speaker, noise, snr, level in specifications:
        name = f'voice{speaker}-{noise or "clean"}-{snr if snr is not None else level}'
        if noise and level != 0.03:
            name += '-quiet'
        directory = output / name
        directory.mkdir(exist_ok=True)
        voice = read_wav(cache / f'clean_test/clnsp{speaker}.wav')[RATE:RATE * 6]
        if len(voice) != RATE * 5:
            raise ValueError('Speech sample too short')
        voice *= level / max(rms(voice), 1e-12)
        clean = np.pad(voice, (RATE * 3, RATE))
        noisy = clean.copy()
        if noise:
            background = read_wav(cache / f'noise_test/{noise}_1.wav')
            background = np.resize(background, len(clean))
            background *= level / (max(rms(background), 1e-12) * 10 ** (snr / 20))
            noisy += background
        headroom = max(1.0, float(np.max(np.abs(noisy))) / 0.95)
        clean, noisy = clean / headroom, noisy / headroom
        clean.astype('<f4').tofile(directory / 'clean.f32')
        noisy.astype('<f4').tofile(directory / 'input.f32')
        write_wav(directory / 'clean.wav', clean)
        write_wav(directory / 'input.wav', noisy)
        cases.append(dict(id=name, speaker=speaker, noise=noise, snrDb=snr, speechRms=level,
                          samples=len(clean), speechStart=RATE * 3, speechEnd=RATE * 8))
    (output / 'cases.json').write_text(json.dumps(dict(dataset=manifest, profile=profile, cases=cases), indent=2))
    print(f'Prepared {len(cases)} cases at {RATE} Hz', flush=True)


def score(output):
    document = json.loads((output / 'cases.json').read_text())
    run = json.loads((output / 'run.json').read_text())
    results = []
    for case in document['cases']:
        if run.get('caseIds') is not None and case['id'] not in run['caseIds']:
            continue
        directory = output / case['id']
        clean = np.fromfile(directory / 'clean.f32', dtype='<f4').astype(np.float64)
        noisy = np.fromfile(directory / 'input.f32', dtype='<f4').astype(np.float64)
        for processed in sorted(directory.glob('*.processed.f32')):
            engine = processed.name.removesuffix('.processed.f32')
            if engine not in run['engines']:
                continue
            captured = np.fromfile(processed, dtype='<f4').astype(np.float64)
            enhanced, delay = align(clean, captured)
            raw = np.fromfile(directory / f'{engine}.raw.f32', dtype='<f4').astype(np.float64)
            raw_aligned, raw_delay = align(noisy, raw)
            if rms(raw_aligned - noisy) / max(rms(noisy), 1e-12) > 0.03:
                raise ValueError('Capture dropped/drifted samples: ' + case['id'] + '/' + engine)
            metrics = measure(clean, noisy, enhanced, case['speechStart'], case['speechEnd'])
            results.append(dict(**case, engine=engine, delayMs=1000 * delay / RATE,
                                processingDelayMs=1000 * (delay - raw_delay) / RATE, **metrics))
            write_wav(directory / f'{engine}.wav', enhanced)
    report = dict(datasetRevision=document['dataset']['revision'], run=run, profile=document['profile'], results=results)
    (output / 'report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    for engine in sorted(set(row['engine'] for row in results)):
        rows = [row for row in results if row['engine'] == engine]
        clean_rows = [row for row in rows if row['noise'] is None]
        noisy_rows = [row for row in rows if row['noise'] is not None]
        def average(rows, key):
            values = [row[key] for row in rows if row[key] is not None]
            return round(float(np.mean(values)), 3) if values else None
        print(json.dumps(dict(engine=engine, cleanStoi=average(clean_rows, 'stoi'),
                              cleanSpeechGainDb=average(clean_rows, 'speechGainDb'), cleanDropoutPercent=average(clean_rows, 'dropoutPercent'),
                              noisyStoi=average(noisy_rows, 'stoi'), inputStoi=average(noisy_rows, 'inputStoi'),
                              siSdrImprovementDb=average(noisy_rows, 'siSdrImprovementDb'), noiseReductionDb=average(noisy_rows, 'noiseReductionDb'))), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare', 'score'])
    parser.add_argument('output', type=Path)
    parser.add_argument('--profile', choices=['smoke', 'full', 'validation'], default='full')
    arguments = parser.parse_args()
    if arguments.action == 'prepare':
        prepare(arguments.output.resolve(), arguments.profile)
    else:
        score(arguments.output.resolve())
