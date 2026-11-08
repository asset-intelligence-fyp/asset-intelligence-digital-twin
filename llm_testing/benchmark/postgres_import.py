"""Optional allowlisted bulk import into a dedicated PostgreSQL test database.
Never import keys or user-provided arbitrary CSVs.
"""
import argparse,os,csv,io
from .common import INPUT,read_csv

def main():
 import psycopg
 dsn=os.environ.get('PG_DSN','')
 if 'digital_twin_llm_test' not in dsn:raise ValueError('PG_DSN must explicitly point to digital_twin_llm_test, never the operational website DB')
 p=argparse.ArgumentParser();p.add_argument('--inputs',default=INPUT);a=p.parse_args()
 with psycopg.connect(dsn) as conn:
  with conn.cursor() as cur:
   cur.execute('CREATE SCHEMA IF NOT EXISTS llm_benchmark')
   cur.execute('CREATE TABLE IF NOT EXISTS llm_benchmark.daily(sensor_id text NOT NULL, date date NOT NULL, mean double precision, p90 double precision, payload jsonb NOT NULL, PRIMARY KEY(sensor_id,date))')
   cur.execute('CREATE TABLE IF NOT EXISTS llm_benchmark.weekly(sensor_id text NOT NULL, week_start date NOT NULL, mean_daily_value double precision, payload jsonb NOT NULL, PRIMARY KEY(sensor_id,week_start))')
   cur.execute('CREATE TABLE IF NOT EXISTS llm_benchmark.sensor_metadata(sensor_id text PRIMARY KEY,payload jsonb NOT NULL)')
   for filename,table,datekey,valkey in [('daily_sensor_conditions.csv','daily','date','mean'),('weekly_sensor_conditions.csv','weekly','week_start','mean_daily_value'),('sensor_registry.csv','sensor_metadata',None,None)]:
    from psycopg.types.json import Jsonb
    count=0
    for row in read_csv(a.inputs,filename):
     if table=='sensor_metadata':cur.execute('INSERT INTO llm_benchmark.sensor_metadata VALUES (%s,%s) ON CONFLICT(sensor_id) DO NOTHING',(row['sensor_id'],Jsonb(row)))
     else:
      val=float(row[valkey]) if row[valkey] else None
      if table=='daily':cur.execute('INSERT INTO llm_benchmark.daily VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',(row['sensor_id'],row['date'],val,float(row['p90']) if row['p90'] else None,Jsonb(row)))
      else:cur.execute('INSERT INTO llm_benchmark.weekly VALUES (%s,%s,%s,%s) ON CONFLICT DO NOTHING',(row['sensor_id'],row['week_start'],val,Jsonb(row)))
     count+=1
    print('Imported',filename,count)
if __name__=='__main__':main()
