import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'node_modules/.cache/noise-metrics'))
import numpy as np
from metrics import RATE, align, measure_capture


class CaptureLatencyTest(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(103)
        self.signal = np.pad(rng.normal(0, 0.04, RATE), (RATE // 2, RATE // 2))

    def test_alignment_finds_delay_and_retains_samples(self):
        aligned, delay = align(self.signal, np.pad(self.signal, (1234, 700)))
        self.assertEqual(delay, 1234)
        np.testing.assert_array_equal(aligned, self.signal)

    def test_measurement_subtracts_capture_start_offset(self):
        raw = np.pad(self.signal, (12000, 4000))
        processed = np.pad(self.signal * 0.5, (12000 + 960, 4000))
        result = measure_capture(self.signal, self.signal, raw, processed, RATE // 2, RATE * 3 // 2)
        self.assertAlmostEqual(result['processingDelayMs'], 20)
        self.assertAlmostEqual(result['stoi'], 1)
        self.assertAlmostEqual(result['speechGainDb'], -6.020599913, places=6)

    def test_rejects_silence_instead_of_reporting_zero_delay(self):
        with self.assertRaisesRegex(ValueError, 'silent'):
            align(self.signal, self.signal * 0)

    def test_rejects_corrupted_reference_capture(self):
        raw = np.pad(self.signal, (12000, 4000))
        raw[14000:16000] = 0.2
        processed = np.pad(self.signal, (13000, 4000))
        with self.assertRaisesRegex(ValueError, 'Capture dropped/drifted'):
            measure_capture(self.signal, self.signal, raw, processed, RATE // 2, RATE * 3 // 2)

    def test_rejects_negative_processing_delay(self):
        with self.assertRaisesRegex(ValueError, 'negative'):
            measure_capture(self.signal, self.signal, np.pad(self.signal, (15000, 1000)),
                            np.pad(self.signal, (12000, 1000)), RATE // 2, RATE * 3 // 2)

    def test_muted_voice_is_reported_as_missing_latency_and_zero_intelligibility(self):
        raw = np.pad(self.signal, (12000, 4000))
        result = measure_capture(self.signal, self.signal, raw, np.zeros(len(raw)), RATE // 2, RATE * 3 // 2)
        self.assertIsNone(result['processingDelayMs'])
        self.assertEqual(result['stoi'], 0)
        self.assertEqual(result['dropoutPercent'], 100)
        self.assertEqual(result['delayUnavailableReason'], 'speech erased')

    def test_background_before_erased_voice_does_not_establish_speech_latency(self):
        raw = np.pad(self.signal, (12000, 4000))
        output = np.zeros(len(raw))
        output[12000:15000] = np.random.default_rng(77).normal(0, 0.005, 3000)
        result = measure_capture(self.signal, self.signal, raw, output, RATE // 2, RATE * 3 // 2)
        self.assertIsNone(result['processingDelayMs'])
        self.assertEqual(result['stoi'], 0)


if __name__ == '__main__':
    unittest.main()
