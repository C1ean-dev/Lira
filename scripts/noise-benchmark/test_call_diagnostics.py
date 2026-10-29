import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'node_modules/.cache/noise-metrics'))
import numpy as np
from call_diagnostics import window_delays, stats_stages, match_transport, stage_breakdown, native_trace_summary
from metrics import RATE


class CallDiagnosticsTest(unittest.TestCase):
    def test_window_delays_distinguish_fixed_delay_from_growing_buffer(self):
        voice = np.random.default_rng(103).normal(0, 0.04, RATE * 3)
        fixed = np.pad(voice, (RATE // 5, RATE))
        rows = window_delays(voice, fixed, 0, len(voice), window=RATE // 5, hop=RATE // 5)
        self.assertTrue(all(abs(row['delayMs'] - 200) < 0.1 for row in rows))
        growing = np.zeros(RATE * 5)
        for i in range(3):
            offset = i * RATE + RATE // 5 + i * RATE // 10
            growing[offset:offset + RATE] = voice[i * RATE:(i + 1) * RATE]
        rows = window_delays(voice, growing, 0, len(voice), window=RATE // 5, hop=RATE // 5)
        reliable = [row for row in rows if row['correlation'] > 0.9]
        self.assertGreaterEqual(len(reliable), 12)
        self.assertEqual(sorted(set(round(row['delayMs']) for row in reliable)), [200, 300, 400])

    def test_stats_use_counter_deltas_and_do_not_invent_audio_encode_time(self):
        before = dict(jitterBufferDelaySeconds=100, jitterBufferEmittedCount=1000,
                      totalEncodeTime=999, packetsSent=10, totalPacketSendDelay=0.1)
        after = dict(jitterBufferDelaySeconds=106, jitterBufferEmittedCount=1200,
                     totalEncodeTime=1999, packetsSent=20, totalPacketSendDelay=0.12)
        result = stats_stages(before, after)
        self.assertAlmostEqual(result['bufferMeanMs'], 30)
        self.assertAlmostEqual(result['sendQueueMeanMs'], 2)
        self.assertIsNone(result['encodeCpuMs'])
        self.assertIsNone(stats_stages(after, before)['bufferMeanMs'])

    def test_transport_matches_identical_frames_and_clock_not_half_rtt(self):
        sent = [dict(rtp=100, hash='a', size=17, atMs=1000), dict(rtp=1060, hash='b', size=18, atMs=1020)]
        received = [dict(rtp=100, hash='a', size=17, atMs=1003), dict(rtp=1060, hash='b', size=18, atMs=1025)]
        result = match_transport(sent, received)
        self.assertEqual(result['matched'], 2)
        self.assertEqual(result['medianMs'], 4)
        received[0]['hash'] = 'corrupt'
        self.assertEqual(match_transport(sent, received)['payloadMismatches'], 1)

    def test_transport_handles_reused_rtp_timestamp_without_false_corruption(self):
        sent = [dict(rtp=100, hash='a', size=17, atMs=1000), dict(rtp=100, hash='b', size=18, atMs=1020)]
        received = [dict(rtp=100, hash='a', size=17, atMs=1003), dict(rtp=100, hash='b', size=18, atMs=1025)]
        self.assertEqual(match_transport(sent, received)['matched'], 2)
        self.assertEqual(match_transport(sent, received)['payloadMismatches'], 0)

    def test_stage_report_keeps_unobservable_encoding_explicit(self):
        before = dict(jitterBufferDelaySeconds=0, jitterBufferEmittedCount=0,
                      playout=[dict(totalPlayoutDelay=0, totalSamplesCount=0)])
        after = dict(jitterBufferDelaySeconds=6, jitterBufferEmittedCount=200,
                     playout=[dict(totalPlayoutDelay=8.4, totalSamplesCount=200)])
        samples = dict(inputBridgeDelayMs=20, localDelayMs=60, receiverGraphDelayMs=20, playbackCaptureDelayMs=0, totalDelayMs=140)
        frames = [dict(rtp=100, hash='a', size=1, atMs=1000), dict(rtp=1060, hash='b', size=1, atMs=1020)]
        received = [{**row, 'atMs': row['atMs'] + 1} for row in frames]
        result = stage_breakdown(samples, before, after, frames, received)
        self.assertEqual(result['inputVirtualBridgeMs'], 20)
        self.assertEqual(result['motorGraphMs'], 40)
        self.assertEqual(result['transportCallbackMedianMs'], 1)
        self.assertEqual(result['bufferMeanMs'], 30)
        self.assertEqual(result['browserEstimatedDevicePlayoutMs'], 42)
        self.assertEqual(result['codecPacketCadenceMs'], 20)
        self.assertIsNone(result['encodingCpuMs'])
        self.assertIsNone(result['physicalMicrophoneMs'])
        self.assertEqual(result['captureStreamAdditionalMs'], 0)

    def test_native_trace_preserves_nested_thread_scope_durations(self):
        events = [dict(name='AudioEncode', ph='X', ts=0, dur=500, pid=1, tid=1),
                  dict(name='AudioEncode', ph='B', ts=1000, pid=1, tid=1),
                  dict(name='Inner', ph='B', ts=1100, pid=1, tid=1),
                  dict(ph='E', ts=1200, pid=1, tid=1), dict(ph='E', ts=1300, pid=1, tid=1)]
        report = native_trace_summary(events)
        self.assertEqual(report['AudioEncode']['count'], 2)
        self.assertAlmostEqual(report['AudioEncode']['meanMs'], 0.4)
        self.assertAlmostEqual(report['Inner']['meanMs'], 0.1)


if __name__ == '__main__':
    unittest.main()
