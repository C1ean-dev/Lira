import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'node_modules/.cache/noise-metrics'))
import numpy as np
from conversation_metrics import measure_direction, pair_cases, median_or_none
from metrics import RATE


class ConversationMeasurementTest(unittest.TestCase):
    def setUp(self):
        self.voice = np.pad(np.random.default_rng(103).normal(0, 0.04, RATE), (RATE // 2, RATE // 2))
        self.start, self.end = RATE // 2, RATE * 3 // 2

    def test_total_delay_keeps_transport_and_receiver_buffers(self):
        # One recorder clock, a 250 ms recording start offset, then actual
        # microphone bridge / processor / RTP / receiver / playback delays.
        lags = [0, 480, 2400, 5280, 5760, 6720]
        channels = [np.pad(self.voice * (0.5 if i > 1 else 1), (12000 + lag, 5000)) for i, lag in enumerate(lags)]
        result = measure_direction(self.voice, self.voice, channels, self.start, self.end)
        self.assertAlmostEqual(result['totalDelayMs'], 140)
        self.assertAlmostEqual(result['decodedDelayMs'], 110)
        self.assertAlmostEqual(result['localDelayMs'], 50)
        self.assertAlmostEqual(result['inputBridgeDelayMs'], 10)
        self.assertAlmostEqual(result['receiverGraphDelayMs'], 10)
        self.assertAlmostEqual(result['playbackCaptureDelayMs'], 20)
        self.assertAlmostEqual(result['stoi'], 1)
        self.assertAlmostEqual(result['localStoi'], 1)
        self.assertAlmostEqual(result['decodedStoi'], 1)

    def test_uncorrelated_comfort_noise_does_not_establish_speech_delay(self):
        raw = np.pad(self.voice, (12000, 7000))
        noise = np.random.default_rng(41).normal(0, 1e-6, len(raw))
        result = measure_direction(self.voice, self.voice, [raw, raw, raw, noise, noise, noise], self.start, self.end)
        self.assertIsNone(result['totalDelayMs'])
        self.assertEqual(result['delayUnavailableReason'], 'speech correlation too weak')
        self.assertLess(result['latencyCorrelation'], 0.1)
        self.assertLess(result['stoi'], 0.1)

    def test_pairs_different_recordings_without_dropping_scenarios(self):
        cases = [dict(id=f'{speaker}-{index}', speaker=speaker) for speaker in [113, 347] for index in range(4)]
        pairs = pair_cases(cases)
        self.assertEqual(len(pairs), 4)
        self.assertEqual(sorted(c['id'] for pair in pairs for c in pair), sorted(c['id'] for c in cases))
        self.assertTrue(all(a['speaker'] != b['speaker'] for a, b in pairs))

    def test_rejects_incomplete_or_unpaired_captures(self):
        with self.assertRaisesRegex(ValueError, 'six'):
            measure_direction(self.voice, self.voice, [self.voice], self.start, self.end)
        with self.assertRaisesRegex(ValueError, 'two recordings'):
            pair_cases([dict(id='only', speaker=113)])

    def test_missing_delay_summary_is_null_instead_of_nan(self):
        self.assertIsNone(median_or_none([None, None]))
        self.assertEqual(median_or_none([10, None, 20]), 15)

    def test_delay_above_one_second_is_not_mistaken_for_erased_speech(self):
        raw = np.pad(self.voice, (12000, RATE * 2))
        received = np.pad(self.voice * 0.5, (12000 + 57600, RATE * 2 - 57600))
        result = measure_direction(self.voice, self.voice, [raw, raw, raw, received, received, received], self.start, self.end)
        self.assertAlmostEqual(result['totalDelayMs'], 1200)
        self.assertAlmostEqual(result['stoi'], 1)

    def test_unrelated_received_noise_cannot_create_negative_delay_error(self):
        raw = np.pad(self.voice, (12000, 7000))
        for seed in range(8):
            noise = np.random.default_rng(seed).normal(0, 1e-6, len(raw))
            result = measure_direction(self.voice, self.voice, [raw, raw, raw, noise, noise, noise], self.start, self.end)
            self.assertIsNone(result['totalDelayMs'])


if __name__ == '__main__':
    unittest.main()
