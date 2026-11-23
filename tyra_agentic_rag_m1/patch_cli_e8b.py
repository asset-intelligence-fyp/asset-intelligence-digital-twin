#!/usr/bin/env python3
"""Idempotently register E8-B without overwriting E7/E8-A implementation."""
from __future__ import annotations
import ast, re, sys
from pathlib import Path


def patch(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    if "from .e8a import run_e8a_detection" not in original:
        raise RuntimeError("E8-B installer requires E8-A already installed")
    data = original
    p = re.search(r"(batch\.add_argument\('--method',choices=\[)([^\]]+)(\])", data)
    if not p:
        raise RuntimeError("Cannot locate --method registration")
    if "'e8b'" not in p.group(2):
        data = data[:p.start()] + p.group(1) + p.group(2) + ",'e8b'" + p.group(3) + data[p.end():]
    anchor = "    batch.add_argument('--max-rounds',type=int,default=2)"
    if "'--e8b-screening-file'" not in data:
        if anchor not in data:raise RuntimeError("Cannot locate --max-rounds registration")
        data = data.replace(anchor, anchor + "\n"
            "    batch.add_argument('--e8b-screening-file',default=None,help='Label-free E7 cached screenings')\n"
            "    batch.add_argument('--e8b-context-db',default='data/e8b_context.sqlite',"
            "help='Causal allowlisted operational context SQLite index')", 1)
    validation_anchor = "    if args.limit<1 or args.stride<1:raise ValueError('limit and stride must be positive')"
    if "E8-B supports anomaly detection only" not in data:
        if validation_anchor not in data:raise RuntimeError("Cannot locate batch validation")
        data = data.replace(validation_anchor,
            "    if args.method == 'e8b' and args.task != 'detect':\n"
            "        raise ValueError('E8-B supports anomaly detection only')\n"
            "    if args.method == 'e8b' and not root_path(args.e8b_context_db).is_file():\n"
            "        raise FileNotFoundError('E8-B context index is missing; build it first: ' + str(root_path(args.e8b_context_db)))\n"
            + validation_anchor, 1)
    if "e8b_cached_screenings = None" not in data:
        # After E8-A, its cache loader appears before the LLM initializer.
        llm = "    llm=OllamaJSON()"
        if llm not in data:raise RuntimeError("Cannot locate LLM initializer")
        data = data.replace(llm,
            "    e8b_cached_screenings = None\n"
            "    if args.method == 'e8b' and args.e8b_screening_file:\n"
            "        from .e8a_cache import load_causal_screenings\n"
            "        e8b_cached_screenings = load_causal_screenings(\n"
            "            root_path(args.e8b_screening_file), expected_model=SETTINGS.model)\n"
            + llm, 1)
    if "from .e8b import run_e8b_detection" not in data:
        anchor = re.search(r"(?m)^([ \t]+)(if|elif) args\.method == 'e8a':[ \t]*$", data)
        if anchor is None:raise RuntimeError("Cannot locate E8-A dispatch")
        indent = anchor.group(1)
        head = ("if" if anchor.group(2)=="if" else "elif")
        code = (f"{indent}{head} args.method == 'e8b':\n"
            f"{indent}    from .e8b import run_e8b_detection\n"
            f"{indent}    result=run_e8b_detection(retriever,llm,args.max_rounds,\n"
            f"{indent}        screening_override=(e8b_cached_screenings[(args.sensor,utc_stamp(stamp(t)))]\n"
            f"{indent}            if e8b_cached_screenings is not None else None),\n"
            f"{indent}        context_db=root_path(args.e8b_context_db))\n"
            f"{indent}elif args.method == 'e8a':")
        data = data[:anchor.start()] + code + data[anchor.end():]
    ast.parse(data, filename=str(path))
    if data != original:
        path.write_text(data, encoding="utf-8")
    return data != original

if __name__ == '__main__':
    result = patch(Path(sys.argv[1]))
    print('E8-B CLI:', 'patched' if result else 'already installed')
