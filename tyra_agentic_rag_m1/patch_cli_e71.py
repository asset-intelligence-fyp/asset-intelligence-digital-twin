"""Insert e71 dispatch into an existing E7 CLI, idempotently."""
from __future__ import annotations

import re
import sys
from pathlib import Path


def patch_cli(path: Path) -> None:
    s = path.read_text(encoding="utf-8")
    if "from .e7 import run_e7_detection" not in s:
        raise RuntimeError("Install and verify E7 first; no E7 dispatch found in src/cli.py")
    method_pattern = re.compile(r"(batch\.add_argument\('--method',choices=\[)([^]]+)(\])")
    match = method_pattern.search(s)
    if not match:
        raise RuntimeError("Could not find --method choices in src/cli.py. No changes made.")
    if "'e71'" not in match.group(2):
        s = s[:match.start()] + match.group(1) + match.group(2) + ",'e71'" + match.group(3) + s[match.end():]
    if "'--e71-no-context'" not in s:
        anchor = "    batch.add_argument('--max-rounds',type=int,default=2)"
        if anchor not in s:
            raise RuntimeError("Missing max-rounds option anchor; no changes made")
        s = s.replace(anchor, anchor + "\n" +
            "    batch.add_argument('--e71-no-context',action='store_true',help='E7.1 ablation: exclude context')\n" +
            "    batch.add_argument('--e71-context-db',default=None,help='E7.1 external context index path')", 1)
    if "'--e71-screening-file'" not in s:
        anchor = "    batch.add_argument('--e71-context-db',default=None,help='E7.1 external context index path')"
        if anchor not in s:
            raise RuntimeError("Missing E7.1 context option anchor; no changes made")
        s = s.replace(anchor, anchor + "\n" +
            "    batch.add_argument('--e71-screening-file',default=None,help='Reuse cached E7/E7.1 inference screening; paired ablation')", 1)
    if "E7.1 supports --task detect only" not in s:
        anchor = "    if args.limit<1 or args.stride<1:raise ValueError('limit and stride must be positive')"
        if anchor not in s:
            raise RuntimeError("Missing batch validation anchor; no changes made")
        s = s.replace(anchor, "    if args.method == 'e71' and args.task != 'detect':\n"
                         "        raise ValueError('E7.1 supports --task detect only')\n"+anchor, 1)
    if "from .e71 import run_e71_detection" not in s:
        old = "                if args.method == 'e7':\n"
        if old not in s:
            raise RuntimeError("Missing E7 dispatch anchor; no changes made")
        new = ("                if args.method == 'e71':\n"
               "                    from .e71 import run_e71_detection\n"
               "                    result=run_e71_detection(retriever,llm,args.max_rounds,\n"
               "                        context_db=args.e71_context_db, use_context=not args.e71_no_context,\n"
               "                        screening_override=(e71_cached_screens[(args.sensor,stamp(t))]\n"
               "                            if e71_cached_screens is not None else None))\n"
               "                elif args.method == 'e7':\n")
        s = s.replace(old, new, 1)
    if "e71_cached_screens = None" not in s:
        anchor = "    llm=OllamaJSON()"
        if anchor not in s:
            raise RuntimeError("Missing LLM construction anchor; no changes made")
        code = "    e71_cached_screens = None\n    if args.method == 'e71' and args.e71_screening_file:\n        e71_cached_screens = {}\n        with root_path(args.e71_screening_file).open(encoding='utf-8') as sf:\n            for line in sf:\n                if not line.strip():continue\n                previous=json.loads(line)\n                if previous.get('task') != 'detect' or previous.get('valid') is False:\n                    raise ValueError('Cached screening file must contain valid detection inference records')\n                if previous.get('model') and previous['model'] != SETTINGS.model:\n                    raise ValueError('Cached screening model differs from configured OLLAMA_MODEL')\n                if any(k in previous for k in ('label','fault_active','ground_truth')):\n                    raise ValueError('Cached screening file must not contain ground-truth labels')\n                screen=previous.get('screening') or previous.get('answer') or {}\n                if screen.get('status') not in ('normal','suspect','anomaly','unknown'):\n                    raise ValueError('Bad cached screening status')\n                origin_dt=valid_timestamp(previous.get('origin'))\n                if any(valid_timestamp(ts) > origin_dt for ts in screen.get('evidence_timestamps', [])):\n                    raise ValueError('Cached screening includes a future evidence timestamp')\n                key=(previous.get('sensor_id'),previous.get('origin'))\n                if key in e71_cached_screens:\n                    raise ValueError('Duplicate timestamp in screening file')\n                e71_cached_screens[key]=screen\n"
        s = s.replace(anchor, code + anchor, 1)
    path.write_text(s, encoding="utf-8")


if __name__ == "__main__":
    patch_cli(Path(sys.argv[1]))
    print("E7.1 CLI method registered")
