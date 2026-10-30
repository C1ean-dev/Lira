import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'node_modules/.cache/noise-metrics'))
import numpy as np
from dataset import mix_at_snr


class MixtureTest(unittest.TestCase):
    def test_nonstationary_noise_has_requested_snr_during_speech(self):
        clean = np.zeros(9000)
        clean[3000:8000] = 0.03 * np.sin(np.arange(5000))
        background = np.full(9000, 0.001)
        background[3000:8000] = 0.1
        original = background.copy()
        for snr in [-5, 0, 5, 10]:
            with self.subTest(snr=snr):
                mixed = mix_at_snr(clean, background, snr, 3000, 8000)
                actual = 10 * np.log10(np.mean(clean[3000:8000] ** 2) /
                                      np.mean((mixed - clean)[3000:8000] ** 2))
                self.assertAlmostEqual(float(actual), snr, places=6)
        np.testing.assert_array_equal(background, original)


if __name__ == '__main__':
    unittest.main()
