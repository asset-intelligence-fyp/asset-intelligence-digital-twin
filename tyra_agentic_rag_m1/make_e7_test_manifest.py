#!/usr/bin/env python3
"""Select reproducible, event-disjoint E7 inference cases from private point labels.

Run locally, OUTSIDE inference, before running the frozen test. Its output
manifest contains sensor IDs/timestamps ONLY, never labels or event identities.
The separate private audit MUST NOT be supplied to the LLM or retriever.
"""
from __future__ import annotations
import argparse
from bisect import bisect_left, bisect_right
import csv
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import random
from collections import defaultdict, Counter

UTC = timezone.utc
MYT = timezone(timedelta(hours=8))
STEP = timedelta(minutes=5)
POS = {'1','true','t','yes','y'}
NEG = {'0','false','f','no','n'}

@dataclass(frozen=True)
class Row:
    t: datetime
    active: bool
    event: str
    scenario: str

def parse_time(s):
    dt = datetime.fromisoformat(s.strip().replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError(f'Label timestamp is not timezone-aware: {s}')
    return dt.astimezone(UTC)

def local_date(dt):
    return dt.astimezone(MYT).date().isoformat()

def stamp(dt):
    return dt.astimezone(MYT).isoformat(timespec='seconds')

def digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()

def file_hash(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1024 * 1024):
            h.update(block)
    return h.hexdigest()

def load_labels(path):
    by_sensor = defaultdict(list)
    needed = {'timestamp','sensor_id','fault_active'}
    with path.open(newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        if not needed.issubset(set(reader.fieldnames or [])):
            raise ValueError(f'Missing columns: {sorted(needed - set(reader.fieldnames or []))}')
        for line, r in enumerate(reader, 2):
            sensor = (r.get('sensor_id') or '').strip()
            if not sensor:
                raise ValueError(f'Missing sensor_id on line {line}')
            value = (r.get('fault_active') or '').strip().lower()
            if value not in POS | NEG:
                raise ValueError(f'Unexpected fault_active={value!r}, line {line}')
            by_sensor[sensor].append(Row(parse_time(r['timestamp']), value in POS,
                                         (r.get('event_id') or '').strip(),
                                         (r.get('scenario') or '').strip()))
    for sensor, rows in by_sensor.items():
        rows.sort(key=lambda x:x.t)
        for before, after in zip(rows, rows[1:]):
            if before.t == after.t:
                raise ValueError(f'Duplicate ground-truth key: {sensor} {before.t}')
    return dict(by_sensor)

def make_groups(by_sensor):
    groups = defaultdict(list)
    for sensor, rows in by_sensor.items():
        previous_unnamed_key = None
        previous_unnamed_time = None
        for row in rows:
            if not row.active:
                previous_unnamed_key = None
                continue
            if row.event:
                key = ('event_id', row.event)  # Global event identity across sensors
                previous_unnamed_key = None
            else:
                if previous_unnamed_key is not None and previous_unnamed_time is not None and row.t - previous_unnamed_time == STEP:
                    key = previous_unnamed_key
                else:
                    key = ('contiguous_unlabeled', sensor, row.t.isoformat())
                previous_unnamed_key = key
                previous_unnamed_time = row.t
            groups[(key, sensor)].append(row)
    return groups

def make_candidates(by_sensor, excluded_days, excluded_events, points, min_positive, pre_onset):
    indices = {s:{r.t:r for r in rows} for s,rows in by_sensor.items()}
    candidates = []
    for (event_key,sensor), active_rows in make_groups(by_sensor).items():
        if event_key[0] == 'event_id' and event_key[1] in excluded_events:
            continue
        start = active_rows[0].t - pre_onset*STEP
        window = [indices[sensor].get(start + i*STEP) for i in range(points)]
        if any(r is None for r in window):
            continue
        if any(local_date(r.t) in excluded_days for r in window):
            continue
        valid_event_times = {r.t for r in active_rows}
        if any(r.active and r.t not in valid_event_times for r in window):
            continue
        positives = sum(r.active for r in window)
        if positives < min_positive:
            continue
        scenario = next((r.scenario for r in active_rows if r.scenario), 'unspecified')
        candidates.append({'sensor': sensor,'start':start,'end':window[-1].t,
                           'event_key':event_key,'scenario':scenario,
                           'sensor_type':sensor.split('-',1)[0],
                           'positive_points':positives, 'event_first_positive':active_rows[0].t})
    return candidates, indices

def overlap(sensor, start, end, selected):
    return any(s == sensor and not (end < a or start > b) for s,a,b in selected)

def choose_faults(candidates, count, rng):
    rng.shuffle(candidates)
    selected, used_events, intervals = [], set(), []
    seen_types, seen_sensors = set(), set()
    while len(selected) < count:
        remaining = [c for c in candidates if c['event_key'] not in used_events
                     and not overlap(c['sensor'],c['start'],c['end'],intervals)]
        if not remaining:
            break
        # Diversity-first selection: prioritize unseen scenario/sensor-type pairs,
        # then unseen sensors; seed breaks ties reproducibly.
        remaining.sort(key=lambda c:(
            (c['scenario'],c['sensor_type']) in seen_types,
            c['sensor'] in seen_sensors,
        ))
        c = remaining[0]
        selected.append(c)
        used_events.add(c['event_key'])
        seen_types.add((c['scenario'],c['sensor_type']))
        seen_sensors.add(c['sensor'])
        intervals.append((c['sensor'],c['start'],c['end']))
    return selected, intervals

def choose_normals(faults, by_sensor, indices, points, excluded_days, buffer_hours, rng, selected_intervals):
    positives = {s: sorted(r.t for r in rows if r.active) for s,rows in by_sensor.items()}
    output = []
    buffer = timedelta(hours=buffer_hours)
    used_days = {local_date(c['start']) for c in faults}
    for c in faults:
        sensor = c['sensor']; target = c['start'].astimezone(MYT)
        candidates = []
        for row in by_sensor[sensor]:
            start = row.t
            if row.active or local_date(start) in excluded_days or local_date(start) in used_days:
                continue
            local = start.astimezone(MYT)
            if local.hour != target.hour or local.minute != target.minute:
                continue
            end = start + (points-1)*STEP
            if overlap(sensor,start,end,selected_intervals):
                continue
            matches = [indices[sensor].get(start+i*STEP) for i in range(points)]
            if any(r is None or r.active or local_date(r.t) in excluded_days or local_date(r.t) in used_days for r in matches):
                continue
            positives_s = positives[sensor]
            if bisect_right(positives_s,end+buffer) > bisect_left(positives_s,start-buffer):
                continue
            candidates.append(start)
        if not candidates:
            continue
        start = rng.choice(candidates)
        end = start + (points-1)*STEP
        output.append({'sensor':sensor,'start':start,'end':end,
                       'paired_fault':c})
        selected_intervals.append((sensor,start,end))
    return output

def write_private(path, obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    # Write with owner-only permissions; the file contains fault information.
    fd = os.open(path,os.O_WRONLY | os.O_CREAT | os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as f:
        json.dump(obj,f,indent=2,ensure_ascii=False)
        f.write('\n')

def make_manifest(args):
    if not 1 <= args.min_positive <= args.points - args.pre_onset or args.pre_onset < 0:
        raise ValueError('Require 0 <= pre-onset < points and 1 <= min-positive <= points - pre-onset')
    if args.events < 1 or args.normal_buffer_hours < 0:
        raise ValueError('events must be positive; normal-buffer-hours cannot be negative')
    if args.out.resolve() == args.private_audit.resolve():
        raise ValueError('Manifest and private audit paths must differ')
    if args.out.exists() or args.private_audit.exists():
        raise FileExistsError('An output already exists. Do not silently change a frozen test manifest.')
    rng = random.Random(args.seed)
    labels = load_labels(args.labels)
    excluded = set(args.exclude_day)
    candidates, indices = make_candidates(labels,excluded,set(args.exclude_event_id),args.points,args.min_positive,args.pre_onset)
    faults, intervals = choose_faults(candidates,args.events,rng)
    if not faults:
        raise ValueError('No eligible fault windows. Check available events, exclusions and --min-positive.')
    normals = choose_normals(faults,labels,indices,args.points,excluded,args.normal_buffer_hours,rng,intervals)
    ordered = [('fault',c) for c in faults] + [('normal',c) for c in normals]
    rng.shuffle(ordered)
    cases = []; audit_cases = []
    for i,(kind,c) in enumerate(ordered,1):
        case_id = f'CASE-{i:04d}'
        cases.append({'case_id':case_id,'sensor_id':c['sensor'],
                      'start':stamp(c['start']),'stride':1,'limit':args.points})
        detail = {'case_id':case_id,'selection_type':kind,'sensor_id':c['sensor'],
                  'start':stamp(c['start']),'end':stamp(c['end'])}
        if kind == 'fault':
            detail.update({'event_id':c['event_key'][1] if c['event_key'][0]=='event_id' else None,
                           'scenario':c['scenario'],'positive_points':c['positive_points'], 'event_first_positive':stamp(c['event_first_positive']),
                           'event_group_key':str(c['event_key'])})
        else:
            detail.update({'paired_event_id':c['paired_fault']['event_key'][1] if c['paired_fault']['event_key'][0]=='event_id' else None})
        audit_cases.append(detail)
    policy = {'seed':args.seed,'points_per_case':args.points,
              'excluded_days':sorted(excluded),
              'min_positive_in_fault_window':args.min_positive, 'pre_onset_points':args.pre_onset,
              'normal_buffer_hours':args.normal_buffer_hours,
              'requested_distinct_events':args.events}
    manifest = {'manifest_version':'1.0','purpose':'frozen E7 evaluation; inference cases contain no labels',
                'policy':policy,'cases':cases,'cases_sha256':digest(cases)}
    private = {'source_labels':str(args.labels.resolve()),'source_labels_sha256':file_hash(args.labels),
               'excluded_event_ids':sorted(set(args.exclude_event_id)),
               'inference_cases_sha256':manifest['cases_sha256'],
               'selected_distinct_fault_events':len(faults), 'selected_normal_windows':len(normals),
               'eligible_fault_sensor_windows':len(candidates),
               'selected_scenarios':dict(Counter(c['scenario'] for c in faults)),
               'selected_sensor_types':dict(Counter(c['sensor_type'] for c in faults)),
               'cases':audit_cases}
    args.out.parent.mkdir(parents=True,exist_ok=True)
    # Write private first. Neither file is overwritten on a rerun.
    write_private(args.private_audit,private)
    args.out.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(f'Frozen manifest: {args.out} ({len(cases)} cases; {len(cases)*args.points} predictions)')
    print(f'Unique fault events: {len(faults)} / {args.events} requested; normal windows: {len(normals)}')
    print('Manifest SHA256 of cases:',manifest['cases_sha256'])
    print(f'PRIVATE audit (contains labels/event identities): {args.private_audit}')
    print('Never provide the private audit to the LLM or retrieval pipeline.')
    if len(faults) < args.events:
        print('NOTE: Fewer eligible distinct events than requested; inspect private audit counts.')
    if len(normals) < len(faults):
        print('NOTE: Not enough matched, distant normal windows for every selected fault event.')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--labels',type=Path,required=True)
    ap.add_argument('--out',type=Path,default=Path('evaluation/E7_frozen_manifest.json'))
    ap.add_argument('--private-audit',type=Path,default=Path('evaluation_private/E7_selection_audit.json'))
    ap.add_argument('--events',type=int,default=20)
    ap.add_argument('--points',type=int,default=12)
    ap.add_argument('--min-positive',type=int,default=3)
    ap.add_argument('--pre-onset',type=int,default=3,
                    help='Number of 5-minute readings before first fault-positive timestamp')
    ap.add_argument('--seed',type=int,default=20261118)
    ap.add_argument('--normal-buffer-hours',type=int,default=12)
    ap.add_argument('--exclude-day',action='append',default=['2026-01-02','2026-01-08'],
                    help='Local Malaysia YYYY-MM-DD to exclude entirely; repeat as needed')
    ap.add_argument('--exclude-event-id',action='append',default=[],
                    help='Exclude additional previously inspected event IDs; repeat as needed')
    args=ap.parse_args()
    make_manifest(args)
if __name__=='__main__': main()
