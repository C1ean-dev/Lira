"""Independent review regressions for PR #103's quality checker."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / 'scripts/noise-benchmark/check_report.py'


class QualityGuardsTest(unittest.TestCase):
    def report(self):
        rows = []
        for name, noise in [('clean', None), ('mixed', 'Typing')]:
            rows.append(dict(id=name, engine='rnnoise', noise=noise, stoi=0.99,
                             inputStoi=0.8, speechGainDb=-1.0, dropoutPercent=0,
                             noiseReductionDb=30 if noise else None))
        return dict(datasetRevision='same-fixed-revision',
                    run=dict(caseIds=['clean', 'mixed'], engines=['rnnoise']), results=rows)

    def check(self, current, baseline=None):
        with tempfile.TemporaryDirectory(prefix='lira-quality-review-') as temporary:
            folder = Path(temporary)
            reports = [('current', current)] + ([('baseline', baseline)] if baseline else [])
            for name, report in reports:
                target = folder / name
                target.mkdir()
                (target / 'report.json').write_text(json.dumps(report), encoding='utf-8')
                for case in report['run']['caseIds']:
                    (target / case).mkdir()
                    for source in ['input.f32', 'clean.f32']:
                        (target / case / source).write_bytes(b'identical source samples')
            command = [sys.executable, '-B', str(CHECKER), str(folder / 'current/report.json')]
            if baseline:
                command += ['--compare', str(folder / 'baseline/report.json')]
            return subprocess.run(command, capture_output=True, text=True)

    def test_healthy_report_passes(self):
        result = self.check(self.report())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_muting_speech_only_when_noise_is_present_must_fail(self):
        report = self.report()
        report['results'][1].update(stoi=0, speechGainDb=-240, dropoutPercent=100,
                                    noiseReductionDb=240)
        result = self.check(report)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_uniformly_attenuating_noisy_speech_40_db_must_fail_comparison(self):
        baseline = self.report()
        current = copy.deepcopy(baseline)
        current['results'][1].update(speechGainDb=-41, noiseReductionDb=70)
        result = self.check(current, baseline)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_uniform_attenuation_fails_without_a_baseline_too(self):
        current = self.report()
        current['results'][1]['speechGainDb'] = -41
        self.assertNotEqual(self.check(current).returncode, 0)

    def test_comparison_rejects_gain_loss_even_above_the_absolute_floor(self):
        baseline = self.report()
        baseline['results'][1]['speechGainDb'] = -8
        current = copy.deepcopy(baseline)
        current['results'][1]['speechGainDb'] = -12
        self.assertNotEqual(self.check(current, baseline).returncode, 0)

    def test_small_gain_variation_and_mixture_dropout_do_not_fail(self):
        baseline = self.report()
        current = copy.deepcopy(baseline)
        current['results'][1].update(speechGainDb=-2, dropoutPercent=80)
        self.assertEqual(self.check(current, baseline).returncode, 0)


if __name__ == '__main__':
    unittest.main()
