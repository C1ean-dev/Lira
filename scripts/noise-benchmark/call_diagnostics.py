"""Diagnostics, not a replacement for the fixed-alignment quality score."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'node_modules/.cache/noise-metrics'))
import numpy as np
from scipy import signal
from metrics import RATE, rms, align


def window_delays(reference, received, start, end, window=RATE // 4, hop=RATE // 4, max_delay=RATE * 2):
    rows = []
    peak = max(rms(reference[start:end]), 1e-12)
    for offset in range(start, end - window + 1, hop):
        a = reference[offset:offset + window]
        if rms(a) < peak * 0.1:
            continue
        b = received[offset:min(len(received), offset + window + max_delay)]
        if len(b) < len(a) or rms(b) < 1e-10:
            continue
        correlations = signal.correlate(b, a, mode='valid', method='fft')
        lag = int(np.argmax(np.abs(correlations)))
        matched = b[lag:lag + window]
        coefficient = float(abs(np.dot(a, matched)) / max(np.linalg.norm(a) * np.linalg.norm(matched), 1e-20))
        rows.append(dict(atMs=offset * 1000 / RATE, delayMs=lag * 1000 / RATE, correlation=coefficient))
    return rows


def stats_stages(before, after):
    # Chromium exposes audio playout as a separate stats object, not as inbound
    # RTP fields. Only use it when one unambiguous object is available.
    if len(before.get('playout', [])) == len(after.get('playout', [])) == 1:
        before, after = {**before, **before['playout'][0]}, {**after, **after['playout'][0]}
    def average(total, count, multiplier=1000):
        if any(row.get(key) is None for row in [before, after] for key in [total, count]):
            return None
        numerator, denominator = after[total] - before[total], after[count] - before[count]
        return multiplier * numerator / denominator if denominator > 0 and numerator >= 0 else None
    return dict(bufferMeanMs=average('jitterBufferDelaySeconds', 'jitterBufferEmittedCount'),
                bufferTargetMeanMs=average('jitterBufferTargetDelay', 'jitterBufferEmittedCount'),
                bufferMinimumMeanMs=average('jitterBufferMinimumDelay', 'jitterBufferEmittedCount'),
                sendQueueMeanMs=average('totalPacketSendDelay', 'packetsSent'),
                devicePlayoutReportedMeanMs=average('totalPlayoutDelay', 'totalSamplesCount'),
                encodeCpuMs=None)


def stage_breakdown(samples, before, after, sent, received):
    stats = stats_stages(before, after)
    transport = match_transport(sent, received)
    ticks = [((b['rtp'] - a['rtp']) % (2 ** 32)) / 48 for a, b in zip(sent, sent[1:])]
    ticks = [value for value in ticks if 0 < value < 200]
    return dict(inputVirtualBridgeMs=samples['inputBridgeDelayMs'], physicalMicrophoneMs=None,
                motorGraphMs=samples['localDelayMs'] - samples['inputBridgeDelayMs'] if samples['localDelayMs'] is not None else None,
                encodingCpuMs=None, codecPacketCadenceMs=float(np.median(ticks)) if ticks else None,
                encodingUnavailableReason='Audio totalEncodeTime is not exposed by WebRTC stats; packet cadence is not encoder CPU latency',
                transportCallbackMedianMs=transport['medianMs'], bufferMeanMs=stats['bufferMeanMs'],
                receiverVolumeGraphMs=samples['receiverGraphDelayMs'],
                browserEstimatedDevicePlayoutMs=stats['devicePlayoutReportedMeanMs'],
                captureStreamAdditionalMs=samples['playbackCaptureDelayMs'], softwareTotalMs=samples['totalDelayMs'],
                caveat='Means from RTP counters and waveform delays have different sampling; do not sum them. captureStream clones media content before physical playout.')


def native_trace_summary(events):
    stacks, durations = {}, {}
    for event in events:
        key = event.get('pid'), event.get('tid')
        phase = event.get('ph')
        if phase == 'X':
            durations.setdefault(event.get('name', ''), []).append(event.get('dur', 0) / 1000)
        elif phase == 'B':
            stacks.setdefault(key, []).append(event)
        elif phase == 'E' and stacks.get(key):
            begin = stacks[key].pop()
            duration = (event['ts'] - begin['ts']) / 1000
            if duration >= 0:
                durations.setdefault(begin.get('name', ''), []).append(duration)
    return {name: dict(count=len(values), meanMs=float(np.mean(values)), medianMs=float(np.median(values)), maxMs=max(values))
            for name, values in durations.items() if values}


def match_transport(sent, received):
    indexed = {}
    for row in sent:
        indexed.setdefault(row['rtp'], []).append(row)
    delays, mismatches = [], 0
    for row in received:
        candidates = indexed.get(row['rtp'], [])
        if not candidates:
            continue
        source = next((candidate for candidate in candidates if candidate['hash'] == row['hash'] and candidate['size'] == row['size'] and
                       (not candidate.get('data') or candidate['data'] == row.get('data'))), None)
        if source is None:
            mismatches += 1
            continue
        candidates.remove(source)
        delays.append(row['atMs'] - source.get('forwardedAtMs', source['atMs']))
    return dict(matched=len(delays), payloadMismatches=mismatches,
                medianMs=float(np.median(delays)) if delays else None,
                minMs=min(delays) if delays else None, maxMs=max(delays) if delays else None,
                method='sender encoded-frame callback to receiver callback before jitter buffer, shared monotonic clock; includes scheduling and native queues')


def diagnose(output):
    run = json.loads((output / 'conversation-run.json').read_text())
    cases = {row['id']: row for row in json.loads((output / 'cases.json').read_text())['cases']}
    results = {(row['capture'], row['id']): row for row in json.loads((output / 'conversation-report.json').read_text())['results']}
    rows = []
    for capture in run['captures']:
        for direction, case_id in enumerate(capture['cases']):
            case = cases[case_id]
            channels = [np.fromfile(output / f'{capture["id"]}.{direction * 6 + i}.f32', dtype='<f4').astype(np.float64) for i in range(6)]
            exact = np.fromfile(output / case_id / 'input.f32', dtype='<f4').astype(np.float64)
            _, lead = align(exact, channels[0])
            # Account for local filter lag before selecting the speech window.
            _, local_lag = align(channels[0], channels[2], max_delay=RATE) if rms(channels[2]) > 1e-10 else (None, 0)
            start = lead + local_lag + case['speechStart']
            end = min(lead + local_lag + case['speechEnd'], len(channels[2]))
            windows = window_delays(channels[2], channels[3], start, end)
            trusted = [row['delayMs'] for row in windows if row['correlation'] >= 0.5]
            receiver = capture['participants'][1 - direction]
            sender = capture['participants'][direction]
            sent = sender.get('frames', {}).get('sent', [])
            received = receiver.get('frames', {}).get('received', [])
            if capture.get('measurementStartMs'):
                sent = [row for row in sent if capture['measurementStartMs'] <= row['atMs'] <= capture['measurementEndMs']]
                received = [row for row in received if capture['measurementStartMs'] <= row['atMs'] <= capture['measurementEndMs']]
            rows.append(dict(engine=capture['engine'], capture=capture['id'], case=case_id,
                             windows=windows, reliableWindows=len(trusted),
                             windowDelayMinMs=min(trusted) if trusted else None,
                             windowDelayMaxMs=max(trusted) if trusted else None,
                             receiverStats=stats_stages(receiver['before'], receiver['after']),
                             transport=match_transport(sent, received),
                             stages=stage_breakdown(results[capture['id'], case_id], receiver['before'], receiver['after'], sent, received)))
    (output / 'call-diagnostics.json').write_text(json.dumps(rows, indent=2, allow_nan=False) + '\n', encoding='utf8')
    trace = output / 'native-trace.json'
    if trace.exists():
        document = json.loads(trace.read_text(encoding='utf8'))
        summary = native_trace_summary(document['traceEvents'])
        (output / 'native-audio-scopes.json').write_text(json.dumps(summary, indent=2, allow_nan=False) + '\n', encoding='utf8')
    for row in rows:
        if row['engine'] == 'deepfilter' or run.get('encodedProbe'):
            print(json.dumps({key: value for key, value in row.items() if key != 'windows'}), flush=True)


def prepare_replay(source, output):
    from dataset import write_wav
    run = json.loads((source / 'conversation-run.json').read_text())
    for capture in run['captures']:
        if capture['engine'] != 'deepfilter':
            continue
        for direction, case_id in enumerate(capture['cases']):
            directory = output / case_id
            clean = np.fromfile(directory / 'clean.f32', dtype='<f4').astype(np.float64)
            local = np.fromfile(source / f'{capture["id"]}.{direction * 6 + 2}.f32', dtype='<f4').astype(np.float64)
            aligned, _ = align(clean, local) if rms(local) > 1e-10 else (np.zeros(len(clean)), None)
            (directory / 'original-input.f32').write_bytes((directory / 'input.f32').read_bytes())
            aligned.astype('<f4').tofile(directory / 'input.f32')
            write_wav(directory / 'input.wav', aligned)


if __name__ == '__main__':
    if sys.argv[1] == '--prepare-replay':
        prepare_replay(Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve())
    else:
        diagnose(Path(sys.argv[1]).resolve())
