import unittest
from conversation_metrics import comparison_summary


def row(engine, case, direction, delay, stoi, noise=None):
    return dict(engine=engine, id=case, direction=direction, totalDelayMs=delay,
                stoi=stoi, inputStoi=1 if noise is None else 0.7, noise=noise)


class ComparisonSummaryTest(unittest.TestCase):
    def test_matches_case_and_direction_and_uses_arithmetic_mean(self):
        rows = [row('bypass', 'same', 'A', 10, 0.98), row('bypass', 'same', 'B', 40, 0.90),
                row('rnnoise', 'same', 'B', 70, 0.95), row('rnnoise', 'same', 'A', 20, 0.96),
                row('bypass', 'noise', 'A', 30, 0.7, 'typing'),
                row('rnnoise', 'noise', 'A', 90, 0.8, 'typing')]
        result = comparison_summary(rows, 'rnnoise')
        self.assertEqual(result['delayMeanMs'], 60)
        self.assertAlmostEqual(result['pairedDelayDeltaMeanMs'], 100 / 3)
        self.assertAlmostEqual(result['cleanStoiDelta'], 0.015)
        self.assertAlmostEqual(result['mixedStoiDelta'], 0.1)
        self.assertEqual(result['pairedLatencyCaptures'], 3)

    def test_erased_speech_keeps_zero_stoi_and_has_no_fake_latency(self):
        rows = [row('bypass', 'a', 'A', 20, 0.9), row('deepfilter', 'a', 'A', None, 0)]
        result = comparison_summary(rows, 'deepfilter')
        self.assertIsNone(result['delayMeanMs'])
        self.assertIsNone(result['pairedDelayDeltaMeanMs'])
        self.assertEqual(result['cleanStoi'], 0)
        self.assertEqual(result['cleanStoiDelta'], -0.9)
        self.assertEqual(result['unavailableDelayCaptures'], 1)
        self.assertEqual(result['pairedLatencyCaptures'], 0)

    def test_missing_reference_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Missing paired'):
            comparison_summary([row('classic', 'a', 'A', 10, 0.9)], 'classic')


if __name__ == '__main__':
    unittest.main()
