import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'node_modules/.cache/noise-metrics'))
import numpy as np
from metrics import RATE, align, measure


class MetricsTest(unittest.TestCase):
    def setUp(self):
        random = np.random.default_rng(42)
        self.speech = random.normal(0, 0.04, RATE * 3)
        self.clean = np.pad(self.speech, (RATE, RATE))

    def test_identity_preserves_voice(self):
        result = measure(self.clean, self.clean, self.clean, RATE, RATE * 4)
        self.assertAlmostEqual(result['stoi'], 1.0)
        self.assertAlmostEqual(result['speechGainDb'], 0.0)
        self.assertEqual(result['dropoutPercent'], 0)

    def test_muting_everything_is_voice_loss_even_when_noise_is_removed(self):
        result = measure(self.clean, self.clean, self.clean * 0, RATE, RATE * 4)
        self.assertEqual(result['stoi'], 0)
        self.assertEqual(result['dropoutPercent'], 100)

    def test_uniform_attenuation_is_reported_even_if_stoi_is_unchanged(self):
        result = measure(self.clean, self.clean, self.clean * 0.01, RATE, RATE * 4)
        self.assertAlmostEqual(result['stoi'], 1.0)
        self.assertAlmostEqual(result['speechGainDb'], -40)
        self.assertEqual(result['dropoutPercent'], 100)

    def test_alignment_compensates_delay_without_changing_samples(self):
        padded = np.pad(self.clean, (1234, 500))
        actual, delay = align(self.clean, padded)
        self.assertEqual(delay, 1234)
        np.testing.assert_array_equal(actual, self.clean)


if __name__ == '__main__':
    unittest.main()
