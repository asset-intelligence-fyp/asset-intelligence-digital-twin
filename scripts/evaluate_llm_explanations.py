#!/usr/bin/env python3
"""Generate blind manual review forms for Qwen anomaly explanations (no truth labels)."""
import argparse
import csv
import json
from pathlib import Path

DIMENSIONS = ('numerical_grounding', 'causal_restraint', 'recommended_checks')


def template(predictions_path, output):
    rows = []
    with Path(predictions_path).open(encoding='utf8') as source:
        for line in source:
            if not line.strip():
                continue
            p = json.loads(line)
            rows.append({'case_id': p['case_id'], 'finding': p.get('finding',''),
                         **{field: '' for field in DIMENSIONS}, 'reviewer_id': '',
                         'reviewer_notes': ''})
    out = Path(output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('w', newline='', encoding='utf8') as fh:
        fields = ('case_id','finding',*DIMENSIONS,'reviewer_id','reviewer_notes')
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return {'cases': len(rows), 'template': str(out),
            'rubric': {'0': 'Unsupported, misleading or absent',
                      '1': 'Partially grounded or useful',
                      '2': 'Grounded, appropriately cautious and actionable'}}


def score(review_csv, out):
    with Path(review_csv).open(newline='', encoding='utf8') as source:
        reviews = list(csv.DictReader(source))
    if not reviews:
        raise ValueError('No manual review rows')
    sums = {field: [] for field in DIMENSIONS}
    for row in reviews:
        for field in DIMENSIONS:
            value = row[field].strip()
            if value not in ('0','1','2'):
                raise ValueError(f"Unscored/invalid review for {row['case_id']} {field}; fill 0,1,2")
            sums[field].append(int(value))
    report = {'reviewed_rows':len(reviews),'rubric_max':2,
              'mean_scores':{key:round(sum(values)/len(values),3) for key,values in sums.items()},
              'note':'Manual reviewer scores only; not ground-truth anomaly classification accuracy.'}
    path=Path(out)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(report,indent=2),encoding='utf8')
    return report


def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__)
    subs=ap.add_subparsers(dest='command',required=True)
    t=subs.add_parser('template')
    t.add_argument('--predictions',default='reports/llm_anomaly_eval/predictions.jsonl')
    t.add_argument('--out',default='reports/llm_anomaly_eval/explanation_review.csv')
    s=subs.add_parser('score')
    s.add_argument('--reviews',required=True)
    s.add_argument('--out',default='reports/llm_anomaly_eval/explanation_review_summary.json')
    args=ap.parse_args(argv)
    result=template(args.predictions,args.out) if args.command=='template' else score(args.reviews,args.out)
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    main()
