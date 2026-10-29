import unittest
from compare_conditions import compare


class ConditionComparisonTest(unittest.TestCase):
    def test_pairs_case_direction_and_repeat_and_keeps_missing_latency_out_of_the_mean(self):
        rows = []
        for repetition, before, after in [(0, 100, 80), (1, 300, None)]:
            for condition, delay in [('baseline', before), ('candidate', after)]:
                rows.append(dict(engine='deepfilter', id='voice', direction='A', repetition=repetition,
                                 condition=condition, noise=None, engineDelayMs=delay, totalDelayMs=delay,
                                 stoi=0 if delay is None else 0.9, localStoi=0.95, dropoutPercent=0,
                                 receiverBufferMs=20, speechGainDb=0))
        result = compare(dict(results=rows))[0]['metrics']
        self.assertEqual(result['totalDelayMs']['delta'], -20)
        self.assertEqual(result['totalDelayMs']['pairedCount'], 1)
        self.assertEqual(result['totalDelayMs']['afterUnavailable'], 1)
        self.assertAlmostEqual(result['cleanStoi']['after'], 0.45)


if __name__ == '__main__':
    unittest.main()
