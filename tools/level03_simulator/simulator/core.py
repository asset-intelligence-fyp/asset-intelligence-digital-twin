"""Stateful Stage-1 18-point synthetic sensor simulator; SOP v1.4.

Three modes: normal (no injection), demo (reproducible simultaneous regression
scenarios), live (sparse seeded, scenario-constrained random events).
All time-series values are illustrative, not measured or physically calibrated.
"""
from __future__ import annotations
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import math
import random

UNITS = {"temperature":"°C", "humidity":"%RH", "co2":"ppm", "occupancy":"binary", "light":"lux", "power":"kW", "water_leakage":"binary"}
PREFIX = {"temperature":"TEMP", "humidity":"RH", "co2":"CO2", "occupancy":"PIR", "light":"LUX", "power":"PWR", "water_leakage":"LEAK"}


def clamp(x, low, high):
    return max(low, min(high, x))


def follow(old, target, tau):
    return old + (target-old)*(-math.expm1(-1.0/max(1.0,tau)))


class SevenSensorSimulator:
    def __init__(self, config, inventory, start_time="2026-10-30T08:00:00+08:00", seed=437119, fault_mode="normal"):
        if fault_mode not in ("normal", "demo", "live"):
            raise ValueError("fault_mode must be normal, demo or live")
        self.c, self.inventory, self.rooms = config, inventory, inventory["rooms"]
        self.seed, self.rng, self.tick, self.fault_mode = seed, random.Random(seed), 0, fault_mode
        start = datetime.fromisoformat(start_time)
        self.start = start.replace(tzinfo=ZoneInfo(config['timezone'])) if start.tzinfo is None else start.astimezone(ZoneInfo(config['timezone']))
        self.states = {r['room_id']: {'temperature': 27.1, 'humidity': 69.0, 'co2': config['co2_background_ppm']+10,
                     'last_occupied':-100000, 'occupied_people':0} for r in self.rooms}
        self.events = []  # generated event schedule; never included in HTTP payload
        self._planned_days = set()
        self._event_counter = 0

    def _room_people(self, room, t):
        kind=room['type']
        hour=t.hour+t.minute/60
        if kind=='distribution_board' or t.weekday()>=5: return 0
        if not self.c['office_start_hour']<=hour<self.c['office_end_hour']: return 0
        # Day-to-day variation is deterministic for a given seed, day, and room.
        day_variation=random.Random(f'{self.seed}:{t.date().isoformat()}:{room["room_id"]}').uniform(-0.1,0.1)
        if kind=='meeting_room':
            shift=day_variation*1.5
            meeting=(9+shift<=hour<10.5+shift or 14+shift<=hour<15.5+shift)
            return max(1,round(room['capacity']*0.65)) if meeting else 0
        if kind=='toilet':
            # Presence episodes of about 2-3 minutes rather than fixed random noise.
            minute=t.hour*60+t.minute
            offset=int(day_variation*20)
            return 1 if (minute+offset)%31<3 else 0
        if kind=='cleaning_room':
            minute=t.hour*60+t.minute
            shift=round(day_variation*15)
            return int(any(start+shift<=minute<end+shift for start,end in ((555,575),(790,805),(1035,1060))))
        if 12<=hour<13: return max(0,round(room['capacity']*0.25))
        return max(1,round(room['capacity']*clamp(0.7+day_variation+0.08*math.sin(hour),0.35,0.9)))

    
    def _plan_day(self, t):
        day = t.date()
        if day in self._planned_days:
            return
        self._planned_days.add(day)

        if self.fault_mode != 'live':
            return

        settings = self.c['live_faults']
        distribution = settings['events_per_day_probabilities']

        # Choose 0-3 abnormal events for this simulated day.
        counts = sorted(int(k) for k in distribution)
        weights = [distribution[str(k)] for k in counts]
        target_count = self.rng.choices(counts, weights=weights, k=1)[0]
        target_count = min(target_count, settings.get('max_events_per_day', 3))

        if target_count == 0:
            return

        # Find eligible sensor/scenario combinations.
        candidates = []
        for room in self.rooms:
            for stype in room['sensors']:
                for scenario in self.c['abnormal_scenarios'].get(stype, []):
                    if room['type'] in scenario['eligible_room_types']:
                        candidates.append((room, stype, scenario))

        if not candidates:
            return

        day_start = datetime.combine(
            day, datetime.min.time(), tzinfo=self.start.tzinfo
        )
        allow_overlap = settings.get('allow_overlapping_faults', True)
        allow_same_sensor_overlap = settings.get(
            'allow_same_sensor_overlap', False
        )

        scheduled = 0

        # Try different candidates until enough valid events are scheduled.
        for _ in range(max(30, target_count * 40)):
            if scheduled >= target_count:
                break

            room, stype, scenario = self.rng.choice(candidates)
            first_hour, last_hour = scenario['start_hours']

            # Respect occupied_required, especially for CO2 faults.
            if scenario.get('occupied_required', False):
                valid_minutes = [
                    m for m in range(first_hour * 60, last_hour * 60)
                    if self._room_people(
                        room, day_start + timedelta(minutes=m)
                    ) > 0
                ]
                if not valid_minutes:
                    continue
                minute = self.rng.choice(valid_minutes)
            else:
                minute = self.rng.randrange(
                    first_hour * 60, last_hour * 60
                )

            start = day_start + timedelta(minutes=minute)
            duration = self.rng.randint(*scenario['duration_minutes'])
            end = start + timedelta(minutes=duration)

            if start < self.start:
                continue

            sensor_id = f'{PREFIX[stype]}-{room["room_id"]}'

            # Check overlap with existing scheduled events.
            overlapping = [
                e for e in self.events
                if start < e['end'] and end > e['start']
            ]

            if overlapping and not allow_overlap:
                continue

            if not allow_same_sensor_overlap:
                if any(e['sensor_id'] == sensor_id for e in overlapping):
                    continue

            severity = self.rng.uniform(*scenario['severity_range'])
            self._event_counter += 1

            self.events.append({
                'event_id': f'EVT-{self._event_counter:05d}',
                'sensor_id': sensor_id,
                'room_id': room['room_id'],
                'sensor_type': stype,
                'scenario': scenario['name'],
                'start': start,
                'end': end,
                'duration_minutes': duration,
                'severity': round(severity, 4),
                'seed': self.seed
            })
            scheduled += 1


    def _active_event(self, stype, room, t):
        if self.fault_mode=='demo':
            active=self.c['fault_start_minute']<=self.tick<self.c['fault_start_minute']+self.c['fault_duration_minutes']
            kinds={'temperature':('open_office',), 'humidity':('toilet',), 'co2':('meeting_room',),
                   'occupancy':('meeting_room',), 'light':('open_office',), 'water_leakage':('toilet','cleaning_room'),
                   'power':('distribution_board',)}
            if active and room['type'] in kinds.get(stype,()):
                return {'event_id':'DEMO-'+stype.upper()+'-'+room['room_id'], 'scenario':stype+'_demo_event',
                        'severity': {'temperature':6., 'humidity':88., 'co2':0.12, 'occupancy':1., 'light':0.15, 'power':3., 'water_leakage':1.}[stype]}
        elif self.fault_mode=='live':
            return next((e for e in self.events if e['sensor_type']==stype and e['room_id']==room['room_id'] and e['start']<=t<e['end']),None)
        return None

    def step(self):
        t=self.start+timedelta(minutes=self.tick)
        self._plan_day(t)
        c=self.c; hour=t.hour+t.minute/60
        hourly=c['outdoor_hourly_c']
        outside=hourly[t.hour]*(1-t.minute/60)+hourly[(t.hour+1)%24]*(t.minute/60)
        outside+=0.35*math.sin(2*math.pi*(t.timetuple().tm_yday-90)/365)
        daylight=max(0.,math.sin(math.pi*(hour-6)/12))
        ac_on=t.weekday()<5 and c['ac_start_hour']<=hour<c['ac_end_hour']
        readings=[];truth=[];activity=0; active_lights=0
        for room in self.rooms:
            rid,kind=room['room_id'],room['type']; state=self.states[rid]
            n=self._room_people(room,t)
            # Demo regression: a planned extended meeting makes low ventilation
            # observable; without occupants CO2 cannot build up.
            if self.fault_mode=='demo' and kind=='meeting_room' and self._active_event('co2',room,t):
                n=max(1,round(room['capacity']*0.5))
            occupied=int(n>0); activity+=n
            state['occupied_people']=n
            if occupied: state['last_occupied']=self.tick
            env_room=kind in ('open_office','meeting_room')
            cooling=ac_on and env_room
            ev={key:self._active_event(key,room,t) for key in room['sensors']}

            # AC-off equilibrium is an indoor thermal target (not outdoor temperature).
            # 26.2+0.18*(Tout-27) produces typical evenings in the ~26-28°C region
            # under the illustrative weather profile, without hard clipping.
            off_target=(c['temperature']['unconditioned_base_c']+
                       c['temperature']['outdoor_coupling']*(outside-27)+
                       c['temperature']['solar_gain_c']*daylight+0.025*n)
            on_target=c['ac_setpoint_c']+c['temperature']['conditioned_offset_c']+0.03*max(0,outside-31)+0.025*n
            target=on_target if cooling else off_target
            if ev.get('temperature'):target+=ev['temperature']['severity']
            state['temperature']=follow(state['temperature'],target,c['temperature_tau_ac_on_min'] if cooling else c['temperature_tau_ac_off_min'])

            # Slight daily moisture variation for occupied rooms and damp service rooms.
            if cooling: rh_target=c['occupied_target_rh']+0.12*n
            elif kind=='toilet': rh_target=c['humidity']['wc_target_rh']+2*daylight+1.0*occupied
            else: rh_target=c['unoccupied_target_rh']-2+1.5*daylight
            if ev.get('humidity'):
                rh_target=ev['humidity']['severity']  # target RH 75-85
            state['humidity']=follow(state['humidity'],rh_target,c['humidity']['response_tau_min'])

            # Source term derived from assumed occupant generation in L/min and
            # ROOM VOLUME (m3); concentration change ppm/min = 1000 * L/min / m3.
            volume=room.get('volume_m3',100)
            source=n*c['co2']['emission_litre_per_person_min']*1000.0/volume
            vent=c['ventilation_occupied_per_hour'] if cooling else c['ventilation_unoccupied_per_hour']
            if ev.get('co2'):vent=ev['co2']['severity']
            background=c['co2_background_ppm']
            state['co2']=clamp(state['co2']+source-vent*(state['co2']-background)/60, background-5,3500)

            lighting_on=(occupied or self.tick-state['last_occupied']<c['lighting']['switch_off_delay_minutes']) and 7<=hour<20
            if lighting_on:active_lights+=1
            daylight_lux=(c['lighting']['office_daylight_lux'] if env_room else c['lighting']['service_daylight_lux'])*daylight
            artificial=(c['lighting']['office_artificial_lux'] if env_room else c['lighting']['service_artificial_lux']) if lighting_on else 0
            if ev.get('light'):artificial*=ev['light']['severity']
            lux=max(0,daylight_lux+artificial+self.rng.gauss(0,2.0 if lighting_on else 0.6))
            pir=occupied
            if ev.get('occupancy'):pir=int(ev['occupancy']['severity'])
            leak=int(bool(ev.get('water_leakage')))
            values={'temperature':round(state['temperature']+self.rng.gauss(0,0.035),2),
                    'humidity':round(clamp(state['humidity']+self.rng.gauss(0,0.10),0,100),2),
                    'co2':round(state['co2']+self.rng.gauss(0,2)), 'occupancy':pir,
                    'light':round(lux), 'water_leakage':leak}
            for stype in room['sensors']:
                if stype=='power': continue
                sensor_id=f'{PREFIX[stype]}-{rid}'
                readings.append({'sensor_id':sensor_id,'room_id':rid,'sensor_type':stype,'timestamp':t.isoformat(),
                                 'value':values[stype],'unit':UNITS[stype],'source':'simulated'})
                event=ev.get(stype)
                truth.append({'timestamp':t.isoformat(),'sensor_id':sensor_id,'room_id':rid,
                              'fault_active':int(bool(event)),'scenario':event['scenario'] if event else 'normal',
                              'event_id':event['event_id'] if event else ''})
        meter=self.inventory['power_meter']
        power=meter['idle_kw']+meter.get('unmonitored_floor_baseline_kw',0)+meter['lighting_kw']*(active_lights/4.0)+meter['plug_kw_per_occupied_person']*activity+(meter['other_occupied_kw'] if activity else 0)
        power_event=None
        for r in self.rooms:
            if 'power' not in r['sensors']:continue
            power_event=self._active_event('power',r,t)
            if power_event:power+=power_event['severity']
            power=round(max(0,power+self.rng.gauss(0,0.025)),3)
            sensor_id=f'PWR-{r["room_id"]}'
            readings.append({'sensor_id':sensor_id,'room_id':r['room_id'],'sensor_type':'power','timestamp':t.isoformat(),
                             'value':power,'unit':'kW','source':'simulated'})
            truth.append({'timestamp':t.isoformat(),'sensor_id':sensor_id,'room_id':r['room_id'],
                          'fault_active':int(bool(power_event)), 'scenario':power_event['scenario'] if power_event else 'normal',
                          'event_id':power_event['event_id'] if power_event else ''})
        self.tick+=1
        return {'sequence':self.tick,'simulated_time':t.isoformat(),'readings':readings,
                'simulation_context':{'outdoor_temperature_c':round(outside,2),'ac_on':int(ac_on),'ac_setpoint_c':c['ac_setpoint_c']}},truth
