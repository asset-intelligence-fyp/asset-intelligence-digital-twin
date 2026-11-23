#!/usr/bin/env python3
"""Download REAL NASA POWER gridded regional weather for Kuching (not on-site sensors).

Only call when network available. NASA hourly station-like reanalysis is regional,
not an actual rooftop rain gauge. The generator's local rain sensor stays simulated.
"""
import argparse,json,time,urllib.request
from pathlib import Path
from datetime import date
PARAMS=['T2M','RH2M','ALLSKY_SFC_SW_DWN','PRECTOTCORR']

def run():
 p=argparse.ArgumentParser();p.add_argument('--start-year',type=int,default=2019);p.add_argument('--end-year',type=int,default=2025)
 p.add_argument('--out',default='data/nasa_power_hourly');p.add_argument('--lat',type=float,default=1.55);p.add_argument('--lon',type=float,default=110.36);a=p.parse_args()
 target=Path(a.out);target.mkdir(parents=True,exist_ok=True)
 for y in range(a.start_year-1,a.end_year+1):
  out=target/f'nasa_power_{y}.json'
  if y==a.start_year-1:
   start=end=f'{y}1231' # MYT first 8h requires prior UTC calendar day
  else:
   start=f'{y}0101';end=f'{y}1231'
  url=('https://power.larc.nasa.gov/api/temporal/hourly/point?'
       f'parameters={",".join(PARAMS)}&community=SB&latitude={a.lat}&longitude={a.lon}'
       f'&start={start}&end={end}&format=JSON&time-standard=UTC')
  print('Requesting',y,start,end,flush=True)
  data=None
  for retry in range(4):
   try:
    req=urllib.request.Request(url,headers={'User-Agent':'FYP-Research-Weather-Importer/1.0'})
    with urllib.request.urlopen(req,timeout=180) as response:data=json.load(response)
    params=data['properties']['parameter']
    assert all(p in params for p in PARAMS)
    assert len(params['T2M'])>4
    break
   except Exception as e:
    if retry==3:raise RuntimeError(f'NASA POWER request failed for {y}: {e}') from e
    print('Retry:',e,flush=True);time.sleep(4*(retry+1))
  out.write_text(json.dumps(data,separators=(',',':')),encoding='utf8')
  print('Saved',out,'hours',len(params['T2M']),flush=True)
if __name__=='__main__':run()
