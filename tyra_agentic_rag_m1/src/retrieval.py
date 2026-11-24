"""Bounded, causal, UNLABELED time-series retrieval tools.

The agent never provides the cutoff to a tool. It is fixed by the evaluator.
No arbitrary SQL, label data or unrestricted retrieval is exposed.
"""
from __future__ import annotations
from datetime import timedelta
from pathlib import Path
import math
import numpy as np
from .db import db_connect, get_series, valid_timestamp, stamp, exact_value
from .config import PROJECT_ROOT


class TemporalRetriever:
    TOOL_NAMES = ("recent", "reference", "summary", "seasonal", "similar", "related", "context")

    def __init__(self, sensor_id: str, as_of: str, task: str = "detect",
                 horizon: int = 12, db_path=None):
        self.sensor_id = sensor_id
        self.as_of = valid_timestamp(as_of)
        self.task = task
        self.horizon = horizon
        self.db_path = db_path
        con = db_connect(True, db_path)
        try:
            row = con.execute("SELECT ANY_VALUE(zone_id) FROM readings WHERE sensor_id=? AND timestamp<=?",
                              [sensor_id, self.as_of]).fetchone()
        finally:
            con.close()
        if not row or row[0] is None:
            raise ValueError(f"Unknown sensor: {sensor_id}")
        self.zone = row[0]

    def recent(self, hours: int = 3):
        hours = max(1, min(6, int(hours)))
        return {"tool": "recent", "sensor_id": self.sensor_id,
                "as_of": stamp(self.as_of), "readings": get_series(
                    self.sensor_id, self.as_of, hours * 12 + 1, self.db_path)}

    def reference(self, weeks: int = 12):
        """Compare the current value with previous same-weekday, same-time readings.

        All references precede the fixed as_of timestamp. These historical
        readings are unlabeled and are NOT guaranteed to be normal.
        """
        weeks = max(4, min(16, int(weeks)))
        anchors = [self.as_of - timedelta(days=7 * i)
                   for i in range(1, weeks + 1)]
        marks = ",".join("?" for _ in anchors)
        con = db_connect(True, self.db_path)
        try:
            history = con.execute(
                f"""SELECT timestamp, value FROM readings
                    WHERE sensor_id=? AND timestamp IN ({marks})
                    ORDER BY timestamp""",
                [self.sensor_id, *anchors]
            ).fetchall()
        finally:
            con.close()

        historical = [
            {"timestamp": stamp(t), "value": round(float(v), 5)}
            for t, v in history
        ]
        current_value = exact_value(self.sensor_id, self.as_of, self.db_path)
        current = None if current_value is None else {
            "timestamp": stamp(self.as_of), "value": round(current_value, 5)
        }
        last_hour = get_series(self.sensor_id, self.as_of, 13, self.db_path)
        last_three_hours = get_series(self.sensor_id, self.as_of, 37, self.db_path)
        recent_trend = {
            "available_points_1h": len(last_hour),
            "delta_1h": (
                round(last_hour[-1]["value"] - last_hour[0]["value"], 5)
                if len(last_hour) == 13 and
                   last_hour[-1]["timestamp"] == stamp(self.as_of)
                else None
            ),
            "available_points_3h": len(last_three_hours),
            "delta_3h": (
                round(last_three_hours[-1]["value"] - last_three_hours[0]["value"], 5)
                if len(last_three_hours) == 37 and
                   last_three_hours[-1]["timestamp"] == stamp(self.as_of)
                else None
            ),
        }
        distribution = {"n": len(historical)}
        if historical:
            vals = np.array([r["value"] for r in historical], dtype=float)
            distribution.update({
                "median": round(float(np.median(vals)), 5),
                "p10": round(float(np.percentile(vals, 10)), 5),
                "p90": round(float(np.percentile(vals, 90)), 5),
                "minimum": round(float(np.min(vals)), 5),
                "maximum": round(float(np.max(vals)), 5),
            })
            if current_value is not None:
                distribution["current_minus_median"] = round(
                    float(current_value) - float(np.median(vals)), 5
                )
        return {
            "tool": "reference",
            "sensor_id": self.sensor_id,
            "as_of": stamp(self.as_of),
            "current": current,
            "same_weekday_and_clock": historical,
            "reference_summary": distribution,
            "recent_trend": recent_trend,
            "caution": (
                "Historical comparator readings are unlabeled and might include "
                "anomalies or different operating regimes. A difference alone "
                "does not establish a fault."
            ),
        }

    def summary(self, days: int = 30):
        days = max(1, min(90, int(days)))
        start = self.as_of - timedelta(days=days)
        bucket = "1 day" if days > 7 else "1 hour"
        limit = 60 if days > 7 else 36
        con = db_connect(True, self.db_path)
        try:
            rows = con.execute(f"""SELECT time_bucket(INTERVAL '{bucket}',timestamp) bucket,
                ROUND(AVG(value),4) avg_value, ROUND(MIN(value),4) minimum,
                ROUND(MAX(value),4) maximum, COUNT(*) count
                FROM readings WHERE sensor_id=? AND timestamp>=? AND timestamp<=?
                GROUP BY 1 ORDER BY 1 DESC LIMIT {limit}""",
                [self.sensor_id, start, self.as_of]).fetchall()
        finally:
            con.close()
        return {"tool":"summary", "resolution":bucket, "days_requested":days,
                "warning":"Most recent bucket may be incomplete; only observed values are included",
                "buckets":[{"bucket_start":stamp(r[0]), "mean":float(r[1]),
                           "min":float(r[2]),"max":float(r[3]),"samples":r[4]}
                           for r in reversed(rows)]}

    def seasonal(self):
        # Explicitly historical anchors. Retrieves one hour ending at each earlier anchor.
        offsets = [1, 7, 28, 364, 728, 1092, 1820, 2550]
        out=[]
        for days in offsets:
            end = self.as_of - timedelta(days=days)
            if end >= self.as_of:
                continue
            rows = get_series(self.sensor_id,end,13,self.db_path)
            if len(rows) >= 10:
                out.append({"days_ago":days,"end":stamp(end),
                            "readings":rows})
            if len(out) >= 8:
                break
        return {"tool":"seasonal","historical_periods":out}

    def similar(self, top_k: int = 3):
        top_k=max(1,min(5,int(top_k)))
        n=12  # Shape matching: most recent 60 min excluding the left boundary.
        current=get_series(self.sensor_id,self.as_of,n,self.db_path)
        if len(current)<n:
            return {"tool":"similar","matches":[],"reason":"Insufficient current history"}
        x=np.array([r['value'] for r in current], dtype=float)
        offsets=[1,2,3,7,14,21,28,35,56,91,182,364,365,728,1092,1456,1820,2184,2550]
        out=[]
        for day in offsets:
            end=self.as_of-timedelta(days=day)
            if self.task == "forecast" and end+timedelta(minutes=5*self.horizon)>self.as_of:
                continue
            hist=get_series(self.sensor_id,end,n,self.db_path)
            if len(hist)!=n:
                continue
            # Exclude incomplete windows or irregularly sampled sequences.
            times=[valid_timestamp(r['timestamp']) for r in hist]
            if any((b-a)!=timedelta(minutes=5) for a,b in zip(times,times[1:])):
                continue
            y=np.array([r['value'] for r in hist],dtype=float)
            sx=max(float(np.std(x)),0.1); sy=max(float(np.std(y)),0.1)
            shape=float(np.sqrt(np.mean(((x-x.mean())/sx-(y-y.mean())/sy)**2)))
            level=float(abs(x.mean()-y.mean())/max(abs(x.mean())*0.1,1.0))
            score=0.7*shape+0.3*level
            match={"historical_end":stamp(end),"days_ago":day,"distance":round(score,4),
                   "values":[round(float(v),4) for v in y]}
            if self.task=="forecast":
                cont=get_series(self.sensor_id,end+timedelta(minutes=5*self.horizon),
                                self.horizon,self.db_path,
                                start=end+timedelta(minutes=5))
                if len(cont)!=self.horizon:
                    continue
                match["historical_continuation"]=[r['value'] for r in cont]
                match["continuation_end"]=cont[-1]["timestamp"]
            out.append(match)
        out=sorted(out,key=lambda r:r['distance'])[:top_k]
        return {"tool":"similar", "current_values":[round(float(v),4) for v in x],
                "matching_method":"deterministic normalized-shape plus level distance",
                "matches":out}

    def related(self):
        con=db_connect(True,self.db_path)
        try:
            neighbors=con.execute("""SELECT DISTINCT sensor_id FROM readings
                     WHERE zone_id=? AND sensor_id<>? AND timestamp<=? ORDER BY sensor_id LIMIT 3""",
                     [self.zone,self.sensor_id,self.as_of]).fetchall()
        finally:
            con.close()
        out=[]
        for (neighbor,) in neighbors:
            out.append({"sensor_id":neighbor,
                        "readings":get_series(neighbor,self.as_of,13,self.db_path)})
        return {"tool":"related","zone_id":self.zone,"related":out}

    def context(self):
        # Allowlisted fields only; do not expose injection or label metadata.
        import csv
        p=PROJECT_ROOT / "data" / "sensor_metadata.csv"
        extra={}
        if p.exists():
            with p.open(newline="") as f:
                for row in csv.DictReader(f):
                    if row.get("sensor_id")==self.sensor_id:
                        extra={k:row[k] for k in ("unit","description","equipment","sensor_type")
                               if k in row}
                        break
        return {"tool":"context","sensor_id":self.sensor_id,"zone_id":self.zone,
                "sensor_metadata":extra,
                "note":"No future schedules or ground-truth fault annotations are supplied"}

    def execute(self, action: str, hours: int = 3, days: int = 30):
        if action not in self.TOOL_NAMES:
            raise ValueError(f"Disallowed tool: {action}")
        if action=="recent":return self.recent(hours)
        if action=="reference":return self.reference()
        if action=="summary":return self.summary(days)
        if action=="seasonal":return self.seasonal()
        if action=="similar":return self.similar(3)
        if action=="related":return self.related()
        return self.context()
