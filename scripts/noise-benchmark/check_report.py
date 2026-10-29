"""Gate on real captured audio, rather than on mock node parameters."""
import argparse
import json
import hashlib
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('report', type=Path)
parser.add_argument('--compare', type=Path)
arguments = parser.parse_args()
report = json.loads(arguments.report.read_text())
if not report['results']:
    raise SystemExit('Empty benchmark report')
if report['run'].get('caseIds') is not None:
    expected = {(case, engine) for case in report['run']['caseIds'] for engine in report['run']['engines']}
    actual = {(row['id'], row['engine']) for row in report['results']}
    if expected != actual or len(actual) != len(report['results']):
        raise SystemExit('Incomplete or duplicate benchmark captures')
failures = []
for row in report['results']:
    if row['noise'] and row['noiseReductionDb'] is not None and row['noiseReductionDb'] < -1:
        failures.append(f'{row["id"]}/{row["engine"]}: amplifies noise by {-row["noiseReductionDb"]:.2f} dB')
    if row['noise'] is None and (row['stoi'] < 0.9 or row['speechGainDb'] < -9 or row['dropoutPercent'] > 10):
        failures.append(f'{row["id"]}/{row["engine"]}: loses clean speech (STOI {row["stoi"]:.3f}, gain {row["speechGainDb"]:.1f} dB, dropout {row["dropoutPercent"]:.1f}%)')
    # A clean-only check cannot catch denoisers that mute speech in mixtures.
    # These are catastrophic-loss floors; paired checks remain stricter.
    if row['noise'] is not None and (row['stoi'] < 0.5 or row['speechGainDb'] < -18):
        failures.append(f'{row["id"]}/{row["engine"]}: loses mixed speech (STOI {row["stoi"]:.3f}, gain {row["speechGainDb"]:.1f} dB)')
if arguments.compare:
    previous = json.loads(arguments.compare.read_text())
    if report['datasetRevision'] != previous['datasetRevision']:
        raise SystemExit('Cannot compare different dataset revisions')
    before = {(row['id'], row['engine']): row for row in previous['results']}
    checked_inputs = set()
    for row in report['results']:
        old = before.get((row['id'], row['engine']))
        if old is None:
            failures.append('Missing baseline case: ' + row['id'] + '/' + row['engine'])
            continue
        if row['id'] not in checked_inputs:
            for name in ['input.f32', 'clean.f32']:
                current = (arguments.report.parent / row['id'] / name).read_bytes()
                original = (arguments.compare.parent / row['id'] / name).read_bytes()
                if hashlib.sha256(current).digest() != hashlib.sha256(original).digest():
                    failures.append('Different comparison input: ' + row['id'] + '/' + name)
            checked_inputs.add(row['id'])
        if old and row['stoi'] < old['stoi'] - 0.03:
            failures.append(f'{row["id"]}/{row["engine"]}: STOI regressed {old["stoi"]:.3f} -> {row["stoi"]:.3f}')
        if row['speechGainDb'] < old['speechGainDb'] - 3:
            failures.append(f'{row["id"]}/{row["engine"]}: speech gain regressed {old["speechGainDb"]:.1f} -> {row["speechGainDb"]:.1f} dB')
    for engine in set(row['engine'] for row in report['results']):
        for clean in [True, False]:
            paired = [row for row in report['results'] if row['engine'] == engine and (row['noise'] is None) == clean and (row['id'], engine) in before]
            if paired:
                delta = sum(row['stoi'] - before[(row['id'], engine)]['stoi'] for row in paired) / len(paired)
                if delta < -0.005:
                    failures.append(f'{engine}: average {"clean" if clean else "noisy"} STOI regressed by {-delta:.3f}')
if failures:
    raise SystemExit('\n'.join(failures))
print('No noise amplification; paired intelligibility checks passed.')
