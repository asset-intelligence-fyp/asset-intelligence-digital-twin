"""Label-free E8-B inference and context-usage audit."""
from __future__ import annotations
import argparse, json
from collections import Counter
from pathlib import Path


def summarize(path: str | Path) -> dict:
    status=Counter(); grounding=Counter(); signals=Counter(); sources=Counter()
    context_use=Counter(); basis=Counter(); retrieval=Counter(); all_count=0
    for line in Path(path).open(encoding='utf-8'):
        if not line.strip():continue
        r=json.loads(line); all_count+=1
        if r.get('method')!='e8b' or r.get('valid') is not True:
            raise ValueError(f'Invalid E8-B result at record {all_count}')
        status[r.get('verified_status','unknown')]+=1
        grounding[r.get('evidence_status','unknown')]+=1
        for x in r.get('context_signals',[]):
            signals[x.get('code','?')]+=1
        for k,v in (r.get('operational_context') or {}).get('source_counts',{}).items():
            if v:sources[k]+=1
        v=r.get('validation') or {}
        basis[v.get('diagnosis_basis','not_supplied')]+=1
        if v.get('valid_context_ids'):
            context_use['decisions_citing_context']+=1
        for t in r.get('trace',[]):
            if t.get('source')=='LLM_planned':retrieval[t.get('tool','?')]+=1
    if not all_count:raise ValueError('Empty E8-B inference file')
    return {'records': all_count, 'verified_status_counts': dict(status),
            'evidence_status_counts': dict(grounding),
            'classification_coverage': round((all_count-status['unknown'])/all_count, 6),
            'context_signal_counts': dict(signals),
            'readings_with_context_source': dict(sources),
            'review_diagnosis_basis_counts': dict(basis),
            'context_citation_counts': dict(context_use),
            'llm_selected_optional_tools': dict(retrieval),
            'warning': 'This report contains no ground truth. Context availability and factual grounding are not anomaly accuracy.'}

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input',required=True)
    ap.add_argument('--out',default=None)
    args=ap.parse_args()
    data=summarize(args.input)
    output=json.dumps(data,indent=2)
    if args.out:
        Path(args.out).write_text(output+'\n',encoding='utf-8')
    print(output)

if __name__=='__main__':main()
