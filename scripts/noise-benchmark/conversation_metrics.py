"""Score bidirectional Lira playback captures on one instrumentation sample clock."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'node_modules/.cache/noise-metrics'))
import numpy as np
from metrics import RATE, measure_capture, measure, align, rms


def median_or_none(values):
    measured = [value for value in values if value is not None]
    return float(np.median(measured)) if measured else None


def speech_correlation(clean, enhanced, start, end):
    a, b = clean[start:end], enhanced[start:end]
    return float(abs(np.dot(a, b)) / max(np.linalg.norm(a) * np.linalg.norm(b), 1e-20))


def supported_speech_lag(recorded, speech_end):
    # Search the whole captured speech window, allowing large real call delays.
    # Never accept a lag that would truncate the scored speech at the end.
    return max(0, min(RATE * 3, len(recorded) - speech_end))


def pair_cases(cases):
    speakers = list(dict.fromkeys(case['speaker'] for case in cases))
    if len(speakers) != 2:
        raise ValueError('Conversation requires two recordings')
    groups = [[case for case in cases if case['speaker'] == speaker] for speaker in speakers]
    if len(groups[0]) != len(groups[1]):
        raise ValueError('Conversation requires equally sized groups from two recordings')
    return list(zip(*groups))


def measure_direction(clean, noisy, channels, speech_start, speech_end):
    if len(channels) != 6:
        raise ValueError('Expected six capture channels per direction')
    # All six channels share the recorder's start and clock. Only the initial
    # recording offset is subtracted; transport/receiver buffers remain in total.
    raw, bridge, local, decoded, gain, playback = channels
    # Validate the exact source before accepting even an erased/uncorrelated
    # received stream. Noise has no meaningful speech lag, positive or negative.
    reference, raw_delay = align(noisy, raw)
    if rms(reference - noisy) / max(rms(noisy), 1e-12) > 0.03:
        raise ValueError('Capture dropped/drifted samples')
    stages = []
    for channel in [bridge, local, decoded, gain, playback]:
        limit = supported_speech_lag(channel, speech_end)
        aligned, _ = align(clean, channel, max_delay=limit) if rms(channel) > 1e-10 else (np.zeros(len(clean)), None)
        correlation = speech_correlation(clean, aligned, speech_start, speech_end)
        if correlation < 0.1 and rms(channel) > 1e-10:
            stages.append(dict(**measure(clean, noisy, aligned, speech_start, speech_end), delayMs=None,
                               rawDelayMs=1000 * raw_delay / RATE, processingDelayMs=None,
                               delayUnavailableReason='speech correlation too weak'))
        else:
            stages.append(measure_capture(clean, noisy, raw, channel, speech_start, speech_end, max_delay=limit))
    result = dict(stages[-1])
    aligned, _ = align(clean, playback, max_delay=supported_speech_lag(playback, speech_end)) if rms(playback) > 1e-10 else (np.zeros(len(clean)), None)
    correlation = speech_correlation(clean, aligned, speech_start, speech_end)
    total = result.pop('processingDelayMs')
    if correlation < 0.1 and total is not None:
        total = None
        result['delayUnavailableReason'] = 'speech correlation too weak'
    delays = [stage['processingDelayMs'] for stage in stages]
    return dict(**result, totalDelayMs=total, latencyCorrelation=correlation,
                localStoi=stages[1]['stoi'], decodedStoi=stages[2]['stoi'],
                inputBridgeDelayMs=delays[0], localDelayMs=delays[1], decodedDelayMs=delays[2],
                receiverGraphDelayMs=delays[3] - delays[2] if None not in delays[2:4] else None,
                playbackCaptureDelayMs=delays[4] - delays[3] if None not in delays[3:5] else None)


def score(output):
    from dataset import write_wav
    document = json.loads((output / 'cases.json').read_text())
    run = json.loads((output / 'conversation-run.json').read_text())
    cases = {case['id']: case for case in document['cases']}
    results = []
    for capture in run['captures']:
        for direction, case_id in enumerate(capture['cases']):
            case = cases[case_id]
            clean = np.fromfile(output / case_id / 'clean.f32', dtype='<f4').astype(np.float64)
            noisy = np.fromfile(output / case_id / 'input.f32', dtype='<f4').astype(np.float64)
            channels = [np.fromfile(output / f'{capture["id"]}.{direction * 6 + index}.f32', dtype='<f4').astype(np.float64) for index in range(6)]
            metrics = measure_direction(clean, noisy, channels, case['speechStart'], case['speechEnd'])
            row = dict(**case, **metrics, engine=capture['engine'], capture=capture['id'], direction='A→B' if direction == 0 else 'B→A')
            results.append(row)
            aligned, _ = align(clean, channels[-1], max_delay=supported_speech_lag(channels[-1], case['speechEnd'])) if rms(channels[-1]) > 1e-10 else (np.zeros(len(clean)), None)
            write_wav(output / case_id / f'conversation-{capture["engine"]}.wav', aligned)
    summaries = []
    for engine in run['engines']:
        rows = [row for row in results if row['engine'] == engine]
        def mean(rows, key):
            values = [row[key] for row in rows if row[key] is not None]
            return float(np.mean(values)) if values else None
        delays = [row['totalDelayMs'] for row in rows if row['totalDelayMs'] is not None]
        summary = dict(engine=engine, captures=len(rows), measurableDelayCaptures=len(delays),
                       delayMedianMs=float(np.median(delays)) if delays else None,
                       delayMinMs=min(delays) if delays else None, delayMaxMs=max(delays) if delays else None,
                       mixedStoi=mean([row for row in rows if row['noise'] is not None], 'stoi'),
                       cleanStoi=mean([row for row in rows if row['noise'] is None], 'stoi'),
                       inputMixedStoi=mean([row for row in rows if row['noise'] is not None], 'inputStoi'),
                       localMixedStoi=mean([row for row in rows if row['noise'] is not None], 'localStoi'),
                       decodedMixedStoi=mean([row for row in rows if row['noise'] is not None], 'decodedStoi'),
                       inputBridgeMedianMs=median_or_none([row['inputBridgeDelayMs'] for row in rows]),
                       localMedianMs=median_or_none([row['localDelayMs'] for row in rows]),
                       decodedMedianMs=median_or_none([row['decodedDelayMs'] for row in rows]),
                       speechGainDb=mean(rows, 'speechGainDb'), dropoutPercent=mean(rows, 'dropoutPercent'))
        summaries.append(summary)
        print(json.dumps(summary, allow_nan=False), flush=True)
    report = dict(datasetRevision=document['dataset']['revision'], run=run, results=results, summary=summaries)
    (output / 'conversation-report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf8')


if __name__ == '__main__':
    score(Path(sys.argv[1]).resolve())
