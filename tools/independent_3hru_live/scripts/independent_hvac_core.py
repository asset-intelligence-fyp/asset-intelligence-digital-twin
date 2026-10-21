"""STATEFUL, LBNL-informed, independently generated three-HRU synthetic telemetry.

One-minute steps. No per-row LBNL replay and no reuse of the offline training
sequence/seed. Weather *statistics* come from the offline training period only.
The controls/thermal constants are illustrative, not a calibrated building model.
The sensor names refer to a virtual three-HRU BIM mapping, not measured HRUs.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta
import json
import math
from pathlib import Path
import random

BIM_POINTS = ("SAT-501A", "MAT-501A", "FS-501A", "SAT-504", "DP-504",
              "DPCMD-504", "SAT-507", "CV-507", "S-L5-008-TEMP")
AUX_FIELDS = ("OA-TEMP", "CVCMD-507", "FS-504", "FS-507", "SYS-CTL")
COLUMNS = ("timestamp",) + BIM_POINTS + AUX_FIELDS
FAULTS = ("damper_stuck", "valve_stuck", "coil_degradation", "sensor_spike", "sensor_drift")

def clamp(x, low, high): return min(high, max(low, x))

def follow(current, target, minutes):
    return current + (target - current) * (1 - math.exp(-1.0 / max(minutes, .1)))

@dataclass
class FaultEvent:
    event_id: str
    event_type: str
    asset: str
    field: str
    onset_tick: int
    duration_minutes: int
    severity: float
    fixed_value: float | None = None

    def record(self, start_time:datetime) -> dict:
        return {"event_id":self.event_id,"event_type":self.event_type,"asset":self.asset,
                "affected_field":self.field,"start_time":(start_time+timedelta(minutes=self.onset_tick)).isoformat(timespec='seconds'),
                "end_time_exclusive":(start_time+timedelta(minutes=self.onset_tick+self.duration_minutes)).isoformat(timespec='seconds'),
                "duration_minutes":self.duration_minutes,"severity":round(self.severity,3),
                "fixed_value":None if self.fixed_value is None else round(self.fixed_value,3),
                "ground_truth_only":True}

class ThreeHRUIndependent:
    def __init__(self, calibration:dict, seed:int=437119, start_time:str='2026-07-01T10:00:00',
                 fault_mode:str='automatic', mean_hours_between_faults:float=48.0,
                 initial_fault_after_minutes:int=30):
        if fault_mode not in ('automatic','normal',*FAULTS):
            raise ValueError('Unsupported fault_mode')
        if mean_hours_between_faults<=0 or initial_fault_after_minutes<0:
            raise ValueError('Invalid fault scheduling settings')
        self.c=calibration;self.rng=random.Random(seed)
        self.start_time=datetime.fromisoformat(start_time)
        self.fault_mode=fault_mode
        self.mean_gap_minutes=mean_hours_between_faults*60.0
        self.fault_after=initial_fault_after_minutes
        self.tick=0; self.active:FaultEvent|None=None; self.new_events=[];self.count=0
        self.next_allowed_tick=initial_fault_after_minutes
        self.weather_front=0.;self.thermal_load=0.
        self.outside=None
        self.z501=23.7;self.z504=24.3;self.zone507=24.1
        self.mat501=22.;self.sat501=21.;self.sat504=21.5;self.sat507=20.7
        self.dactual=10.;self.vactual=15.;self.last_values=None

    def _fans(self,t):
        weekday=t.weekday();h=t.hour
        # The reference LBNL schedule is for one AHU. Separate virtual schedules
        # below are assumptions about BIM HRUs, not observed source behaviours.
        occupied=int((weekday<5 and 6<=h<22) or (weekday==5 and 6<=h<18))
        f501=occupied
        f504=int((weekday<5 and 7<=h<21) or (weekday==5 and 8<=h<16))
        f507=int(weekday<5 and 8<=h<20)
        return occupied,f501,f504,f507

    def _outdoor(self,t):
        d=t.timetuple().tm_yday
        fit=self.c['outdoor_seasonal_fit_c']
        theta=2*math.pi*d/365.25
        annual=fit['intercept']+fit['sin_annual']*math.sin(theta)+fit['cos_annual']*math.cos(theta)
        hourly=self.c['hourly_outdoor_deviation_c']
        fractional=t.hour+t.minute/60
        h=int(fractional)%24
        w=fractional-h
        diurnal=hourly[h]*(1-w)+hourly[(h+1)%24]*w
        # Persistent weather fronts, independent of chronological LBNL rows.
        self.weather_front=clamp(.9995*self.weather_front+self.rng.gauss(0,.07),-12,12)
        return annual+diurnal+self.weather_front

    def _start_fault(self,typ):
        self.count+=1
        defs={'damper_stuck':('HRU504','DP-504',(25,75)),
              'valve_stuck':('HRU507','CV-507',(20,40,65)),
              'coil_degradation':('HRU507','SAT-507',(.4,.55,.7)),
              'sensor_spike':('HRU501A','SAT-501A',(-6.0,-4.0,4.0,6.0)),
              'sensor_drift':('Unit507','S-L5-008-TEMP',(-3.5,-2.5,2.5,3.5))}
        asset,field,choices=defs[typ]
        severity=self.rng.choice(choices)
        # A stuck actuator jams at its current position; ground truth records
        # that position, not an unrelated nominal fault severity.
        if typ == "damper_stuck": severity = self.dactual
        if typ == "valve_stuck": severity = self.vactual
        duration = (self.rng.randint(1,3) if typ=='sensor_spike' else
                    self.rng.randint(240,1200) if typ in ('coil_degradation','sensor_drift') else
                    self.rng.randint(120,480))
        fixed=self.dactual if typ=='damper_stuck' else self.vactual if typ=='valve_stuck' else None
        event=FaultEvent(f'evt-{self.count:04d}',typ,asset,field,self.tick,duration,severity,fixed)
        self.active=event;self.new_events.append(event.record(self.start_time))

    def _fault_scheduler(self):
        if self.active and self.tick>=self.active.onset_tick+self.active.duration_minutes:
            self.active=None
            self.next_allowed_tick=self.tick+30
        if self.active or self.tick<self.next_allowed_tick: return
        if self.fault_mode=='normal': return
        if self.fault_mode=='automatic':
            if self.rng.random() < 1.0/self.mean_gap_minutes:
                self._start_fault(self.rng.choice(FAULTS))
        elif self.count==0:
            self._start_fault(self.fault_mode)

    def step(self):
        t=self.start_time+timedelta(minutes=self.tick)
        occ,f501,f504,f507=self._fans(t)
        self._fault_scheduler()
        f=self.active
        outside=self._outdoor(t)
        # Simulated zones have inertia and feedback; not independent noise streams.
        # Indoor thermal gains are small relative to the ventilation/conditioned-air term.
        self.thermal_load=.998*self.thermal_load+self.rng.gauss(0,.006)
        def damper_command(zone,fan,shift):
            if not fan:return 0.
            desired=.10
            if 1.5 < outside < 18 and outside < zone-1:
                desired=clamp(.10+(zone-outside)/19, .10, .85)
            return 100*clamp(desired+shift,.1,1.)
        dcmd=damper_command(self.z504,f504,.035)
        if f and f.event_type=='damper_stuck':
            # Stuck actuator does not follow changing command.
            self.dactual=f.fixed_value
        else:
            self.dactual=clamp(follow(self.dactual,dcmd,5)+self.rng.gauss(0,.08),0,100)
        # Mixed air responds to damper/return conditions.
        c501=damper_command(self.z501,f501,-.02)/100
        mix501=c501*outside+(1-c501)*self.z501
        mix504=(self.dactual/100)*outside+(1-self.dactual/100)*self.z504
        mix507=.10*outside+.90*self.zone507
        self.mat501=follow(self.mat501,mix501,8)
        # Valve command for HRU507 adapts to cooling demand; actual follows with lag.
        vcmd=100*clamp((mix507-15.0)/13.0,0,1) if f507 else 0.
        if f and f.event_type=='valve_stuck':
            self.vactual=f.fixed_value
        else:
            self.vactual=clamp(follow(self.vactual,vcmd,9)+self.rng.gauss(0,.06),0,100)
        def target(mixed,fan,eff):
            # 12.5C nominal coil leaving-air temperature, mixed through a
            # continuously modulating cooling effect. This is illustrative.
            if not fan:return mixed
            demand=clamp((mixed-15.0)/14,0,1)
            return mixed-eff*demand*max(0,mixed-12.5)
        t501=target(self.mat501,f501,.82)
        t504=target(mix504,f504,.80)
        coil_eff=.93
        if f and f.event_type=='coil_degradation':
            progress=clamp((self.tick-f.onset_tick)/f.duration_minutes,0,1)
            coil_eff*=1+ (f.severity-1)*progress
        if f507:
            t507=mix507-coil_eff*(self.vactual/100)*max(0,mix507-12.5)
        else:
            t507=mix507
        self.sat501=follow(self.sat501,t501,12)
        self.sat504=follow(self.sat504,t504,14)
        self.sat507=follow(self.sat507,t507,18)
        # Zones change more slowly than supply-air temperature.
        def zone_next(z, supply, fan, load, thermal_gain):
            outdoor_term=.00024*(outside-z)
            supply_term=(.0028*(supply-z)) if fan else 0.
            return clamp(z+outdoor_term+supply_term+thermal_gain+load,12,36)
        gains=.0017 if occ else .00035
        self.z501=zone_next(self.z501,self.sat501,f501,self.thermal_load*.025,gains)
        self.z504=zone_next(self.z504,self.sat504,f504,self.thermal_load*.025,gains+.00025)
        self.zone507=zone_next(self.zone507,self.sat507,f507,self.thermal_load*.025,gains+.0001)
        values={
            'timestamp':t.isoformat(sep=' ',timespec='seconds'),
            'SAT-501A':self.sat501+self.rng.gauss(0,.035),
            'MAT-501A':self.mat501+self.rng.gauss(0,.04),
            'FS-501A':f501,
            'SAT-504':self.sat504+self.rng.gauss(0,.04),
            'DP-504':clamp(self.dactual+self.rng.gauss(0,.17),0,100),
            'DPCMD-504':dcmd,
            'SAT-507':self.sat507+self.rng.gauss(0,.04),
            'CV-507':clamp(self.vactual+self.rng.gauss(0,.18),0,100),
            'S-L5-008-TEMP':self.zone507+self.rng.gauss(0,.03),
            'OA-TEMP':outside+self.rng.gauss(0,.04),
            'CVCMD-507':vcmd,
            'FS-504':f504,'FS-507':f507,'SYS-CTL':occ}
        # Faults affecting sensors have no physical effect on other readings.
        # Separate equipment faults affect linked physical variables above.
        if f and f.event_type=='sensor_spike':
            values[f.field]+=f.severity
        elif f and f.event_type=='sensor_drift':
            progress=clamp((self.tick-f.onset_tick)/f.duration_minutes,0,1)
            values[f.field]+=progress*f.severity
        for k,v in values.items():
            if isinstance(v,float):
                if not math.isfinite(v):raise RuntimeError(f'Nonfinite field: {k}')
                values[k]=round(v,4)
        self.tick+=1
        self.last_values=values
        return values, f

if __name__=='__main__':
    p=Path(__file__).resolve().parents[1]/'reference'/'train_only_weather_calibration.json'
    engine=ThreeHRUIndependent(json.loads(p.read_text()))
    for _ in range(2):print(engine.step())
