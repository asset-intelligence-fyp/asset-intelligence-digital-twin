"""E7.1 inference-only audit: retrieval choice, context coverage, citations, runtime.

No ground truth; evaluation with labels is deliberately a separate step.
"""
from __future__ import annotations
import argparse
import json
from collections import Counter
from pathlib import Path


def report(src: str | Path) -> dict:
    count = 0
    screen = Counter()
    review = Counter()
    supported = Counter()
    grounding = Counter()
    planned = Counter()
    fallbacks = Counter()
    context_kinds = Counter()
    llm_calls = []
    latencies = []
    no_context = 0
    screening_sources = Counter()
    decision_changes = Counter()
    with Path(src).open(encoding="utf-8") as inp:
        for line in inp:
            if not line.strip(): continue
            r=json.loads(line)
            if r.get("method") != "e71":
                raise ValueError("Expected E7.1 predictions, not exported channels")
            count += 1
            screening_sources[r.get("screening_source", "unknown")] += 1
            decision_changes[(r.get("screening_status", "unknown"), r.get("review_status", "unknown"))] += 1
            screen[r.get("screening_status", "unknown")]+=1
            review[r.get("review_status", "unknown")]+=1
            supported[r.get("supported_status", "unknown")]+=1
            grounding[r.get("evidence_status", "unknown")]+=1
            for t in r.get("trace", []):
                source = t.get("source", "")
                if source == "LLM_selected": planned[t.get("tool")]+=1
                elif "fallback" in source: fallbacks[t.get("tool")]+=1
            context = r.get("operational_context") or {}
            if not context.get("available"): no_context+=1
            for name in {x.get("kind") for x in context.get("observations", []) if x.get("kind")}:
                context_kinds[name]+=1
            if isinstance(r.get("llm_calls"), (int,float)): llm_calls.append(r["llm_calls"])
            if isinstance(r.get("latency_ms"), (int,float)): latencies.append(r["latency_ms"])
    return {"records": count, "screening": dict(screen), "review": dict(review),
            "strict_supported": dict(supported), "evidence_quality": dict(grounding),
            "LLM_selected_optional_tools": dict(planned), "planner_fallback_tools": dict(fallbacks),
            "screening_sources": dict(screening_sources),
            "screening_to_review": {f"{s}->{v}": n for (s,v),n in decision_changes.items()},
            "LLM_optional_calls_total": sum(planned.values()),
            "LLM_optional_calls_per_observation": round(sum(planned.values())/count,3) if count else None,
            "no_context_observations": no_context, "context_kind_observations": dict(context_kinds),
            "mean_llm_calls": round(sum(llm_calls)/len(llm_calls),2) if llm_calls else None,
            "mean_latency_seconds": round(sum(latencies)/len(latencies)/1000,2) if latencies else None,
            "note": "Retrieval selection counts show whether agent actually chose optional tools. They do not prove performance improvement."}


def main():
    p=argparse.ArgumentParser(description="Audit E7.1 adaptive retrieval without labels")
    p.add_argument("--input", required=True)
    args=p.parse_args()
    print(json.dumps(report(args.input), indent=2))


if __name__ == "__main__": main()
