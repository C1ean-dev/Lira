"""Paired source-snapshot A/B analysis. Never mix conditions or missing delays."""
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'node_modules/.cache/noise-metrics'))
import numpy as np


def compare(report):
    rows = report['results']
    def key(row):
        return row['engine'], row['id'], row['direction'], row.get('repetition', 0)
    baseline = {key(row): row for row in rows if row.get('condition') == 'baseline'}
    output = []
    for condition in sorted(set(row.get('condition', 'current') for row in rows) - {'baseline'}):
        paired = [(baseline[key(row)], row) for row in rows if row.get('condition') == condition]
        if len(paired) * len(set(row['condition'] for row in rows)) != len(rows):
            raise ValueError('Incomplete conditions')
        def mean(values):
            values = [v for v in values if v is not None]
            return float(np.mean(values)) if values else None
        summary = dict(condition=condition, pairs=len(paired), metrics={})
        for metric in ['engineDelayMs', 'totalDelayMs', 'stoi', 'localStoi', 'dropoutPercent', 'receiverBufferMs', 'speechGainDb']:
            pairs = [(a[metric], b[metric]) for a, b in paired if a.get(metric) is not None and b.get(metric) is not None]
            changes = [b - a for a, b in pairs]
            summary['metrics'][metric] = dict(before=mean([a for a, _ in pairs]), after=mean([b for _, b in pairs]),
                                            delta=mean(changes), pairedCount=len(pairs),
                                            beforeUnavailable=sum(a.get(metric) is None for a, _ in paired),
                                            afterUnavailable=sum(b.get(metric) is None for _, b in paired))
        for clean in [True, False]:
            subset = [(a, b) for a, b in paired if (a['noise'] is None) == clean]
            for metric in ['stoi', 'localStoi']:
                name = ('clean' if clean else 'mixed') + metric[0].upper() + metric[1:]
                summary['metrics'][name] = dict(before=mean([a[metric] for a, _ in subset]), after=mean([b[metric] for _, b in subset]),
                                               delta=mean([b[metric] - a[metric] for a, b in subset]))
        output.append(summary)
    return output


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'node_modules/.cache/noise-metrics'))
    # numpy is also installed in the benchmark-specific path when run via dataset.py.
    directory = Path(sys.argv[1])
    result = compare(json.loads((directory / 'conversation-report.json').read_text(encoding='utf8')))
    (directory / 'ab-comparison.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n', encoding='utf8')
    print(json.dumps(result, indent=2, allow_nan=False))
