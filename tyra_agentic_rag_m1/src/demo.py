"""Demo data only: synthetic normal readings + injected faults with separate labels."""
from __future__ import annotations
import csv
from datetime import datetime, timedelta
from pathlib import Path
import math
import random
from .config import PROJECT_ROOT
from .db import stamp


def make_demo(days: int = 21):
    random.seed(2026)
    days=max(5,min(35,days))
    raw=PROJECT_ROOT/"data"/"raw"/"demo_readings.csv"
    truth=PROJECT_ROOT/"data"/"ground_truth"/"demo_events.csv"
    raw.parent.mkdir(parents=True,exist_ok=True)
    truth.parent.mkdir(parents=True,exist_ok=True)
    start=datetime(2025,1,1,0,0)
    events=[
        ("E1","TEMP_01",start+timedelta(days=9,hours=10),start+timedelta(days=9,hours=12),"spike"),
        ("E2","CO2_01",start+timedelta(days=12,hours=8),start+timedelta(days=12,hours=14),"drift"),
        ("E3","TEMP_01",start+timedelta(days=16,hours=11),start+timedelta(days=16,hours=18),"level_shift")
    ]
    with raw.open('w',newline='') as f:
        w=csv.writer(f)
        w.writerow(['timestamp','sensor_id','zone_id','value'])
        for n in range(days*288):
            t=start+timedelta(minutes=5*n)
            hour=t.hour+t.minute/60
            occupied=int(8<=hour<18)
            temp=23 + 0.9*math.sin(2*math.pi*(hour-6)/24)+random.gauss(0,0.08)
            co2=480+occupied*300+35*math.sin(2*math.pi*hour/24)+random.gauss(0,15)
            if events[0][2]<=t<=events[0][3]:temp+=3
            if events[1][2]<=t<=events[1][3]:
                co2+=300*(t-events[1][2]).total_seconds()/(6*3600)
            if events[2][2]<=t<=events[2][3]:temp+=2.2
            w.writerow([stamp(t),'TEMP_01','Zone_A',round(temp,3)])
            w.writerow([stamp(t),'CO2_01','Zone_A',round(co2,2)])
            w.writerow([stamp(t),'OCC_01','Zone_A',occupied*10])
    with truth.open('w',newline='') as f:
        w=csv.writer(f)
        w.writerow(['event_id','sensor_id','start_timestamp','end_timestamp','anomaly_type'])
        for item in events:w.writerow([item[0],item[1],stamp(item[2]),stamp(item[3]),item[4]])
    return str(raw),str(truth)
