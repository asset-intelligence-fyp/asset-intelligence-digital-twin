"""Create date-based research split manifest. No anomaly labels are needed."""
from __future__ import annotations
import json
from datetime import timedelta
from pathlib import Path
from .db import db_connect, stamp, valid_timestamp
from .config import PROJECT_ROOT


def make_splits(out='data/splits.json', db_path=None):
    con=db_connect(True,db_path)
    try:
        first,last=con.execute('SELECT MIN(timestamp),MAX(timestamp) FROM readings').fetchone()
    finally:
        con.close()
    if first is None:raise ValueError('Empty readings table')
    n=int((last-first).total_seconds()//300)
    a=first+timedelta(minutes=5*round(n*0.6))
    b=first+timedelta(minutes=5*round(n*0.8))
    manifest={
        'development':{'start':stamp(first),'end':stamp(a)},
        'validation':{'start':stamp(a+timedelta(minutes=5)),'end':stamp(b)},
        'test':{'start':stamp(b+timedelta(minutes=5)),'end':stamp(last)},
        'warning': 'Review boundaries for complete fault episodes and independent scenario-seed splits; do not tune using test data.'
    }
    output=PROJECT_ROOT/out
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(manifest,indent=2))
    return manifest
