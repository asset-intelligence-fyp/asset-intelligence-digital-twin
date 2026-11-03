#!/usr/bin/env python3
"""Optional broker-level random publisher for the TwinLabs nine-point UI.

Publishes independently generated *synthetic*, random-walk values. This is
not a calibrated building or physical telemetry source. Do not run this
alongside the original independent 3HRU simulator for the same points.
"""
from __future__ import annotations
import argparse
import datetime
import json
import math
import os
import random
import time

POINTS = (
    ('SAT-501A', 'HRU501A', 'Supply Air Temperature', '°C'),
    ('MAT-501A', 'HRU501A', 'Mixed Air Temperature', '°C'),
    ('FS-501A', 'HRU501A', 'Supply Fan Status', 'ON/OFF'),
    ('SAT-504', 'HRU504', 'Supply Air Temperature', '°C'),
    ('DP-504', 'HRU504', 'Outdoor Air Damper Position', '%'),
    ('DPCMD-504', 'HRU504', 'Outdoor Air Damper Command', '%'),
    ('SAT-507', 'HRU507', 'Supply Air Temperature', '°C'),
    ('CV-507', 'HRU507', 'Cooling Valve Position', '%'),
    ('S-L5-008-TEMP', 'HRU507', 'Room Temperature', '°C'),
)
INITIAL = {'SAT-501A':18.4, 'MAT-501A':23.1, 'FS-501A':1,
           'SAT-504':18.7, 'DP-504':14.0, 'DPCMD-504':13.5,
           'SAT-507':19.2, 'CV-507':55.0, 'S-L5-008-TEMP':23.7}
PROVENANCE = 'SYNTHETIC_RANDOM_WALK_NINE_POINT'

def values_step(values, rng):
    out = dict(values)
    for code, _, _, _ in POINTS:
        old = values[code]
        if code == 'FS-501A': out[code] = 1-old if rng.random() < .015 else old
        elif code == 'DPCMD-504': out[code] = max(5,min(85,old+rng.uniform(-.8,.8)))
        elif code == 'DP-504': out[code] = max(0,min(100,old+(out['DPCMD-504']-old)*.3+rng.uniform(-.4,.4)))
        elif code == 'CV-507': out[code] = max(0,min(100,old+rng.uniform(-2,2)))
        else: out[code] = max(12,min(35,old+.025*(INITIAL[code]-old)+rng.uniform(-.15,.15)))
    return {k:round(v,4) if k!='FS-501A' else int(v) for k,v in out.items()}

def messages(values, seq, timestamp):
    for code, asset, name, unit in POINTS:
        value = values[code]
        if not math.isfinite(value): raise ValueError('Nonfinite random value')
        yield f'dt/{asset}/{code}', dict(timestamp=timestamp,source_timestamp=timestamp,
            asset_id=asset,sensor_id=code,point_code=code,reading_type=name,
            value=value,unit=unit,sequence=seq,quality='simulated',
            generation_mode='random_walk_simulation',provenance=PROVENANCE,
            generator='uncalibrated_random_walk')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--interval',type=float,default=3)
    parser.add_argument('--ticks',type=int,default=0,help='0 means continuous')
    parser.add_argument('--seed',type=int)
    parser.add_argument('--host',default=os.getenv('MQTT_HOST','127.0.0.1'))
    parser.add_argument('--port',type=int,default=int(os.getenv('MQTT_PORT','1883')))
    args=parser.parse_args()
    if args.interval<=0 or args.ticks<0:parser.error('interval must be >0 and ticks >=0')
    try:
        import paho.mqtt.client as mqtt
    except ImportError as error:
        raise SystemExit('Install paho-mqtt: python3 -m pip install "paho-mqtt>=2,<3"') from error
    client=mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,client_id=f'twinlabs-random-{os.getpid()}')
    if os.getenv('MQTT_USERNAME'):client.username_pw_set(os.environ['MQTT_USERNAME'],os.getenv('MQTT_PASSWORD'))
    client.connect(args.host,args.port,60)
    client.loop_start()
    values=dict(INITIAL)
    rng=random.Random(args.seed)
    i=0
    try:
        while args.ticks==0 or i<args.ticks:
            i+=1
            values=values_step(values,rng)
            now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
            for topic,payload in messages(values,i,now):
                result=client.publish(topic,json.dumps(payload),qos=1,retain=False)
                result.wait_for_publish(timeout=5)
                if not result.is_published():raise ConnectionError(f'MQTT publish failed: {topic}')
            print(f'Random synthetic MQTT tick {i}: published 9/9 points',flush=True)
            if args.ticks==0 or i<args.ticks:time.sleep(args.interval)
    except KeyboardInterrupt:
        pass
    finally:
        client.disconnect();client.loop_stop()

if __name__=='__main__':main()

