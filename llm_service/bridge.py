"""Local adapter: current website observations + separate historical reference.
Website-only evidence prefetch. Original experiment results remain separate.
"""
import argparse,json,tempfile,threading
from time import perf_counter
from pathlib import Path
from datetime import datetime,timezone,timedelta
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from shared_llm.db import connect
from shared_llm.tools import RepositoryTools
from shared_llm.ollama import OllamaClient
from shared_llm.agent import run_agent

TZ=timezone(timedelta(hours=8))
def iso(s):return datetime.fromisoformat(s.replace('Z','+00:00')).astimezone(TZ).isoformat()

class LiveRepository(RepositoryTools):
    def __init__(self,*a,reference=None,**kw):
        super().__init__(*a,**kw);self.reference=reference
    def get_room_context(self,room_id,at_time):
        data=super().get_room_context(room_id,at_time)
        data['observation_source']=self.source
        data['warning']='Website observation snapshot at the stated cutoff. Synthetic means simulated, not stale. Check sensor_age_minutes relative to the cutoff; it is not wall-clock delivery age.'
        data['historical_reference_available']=bool(self.reference)
        return data
    def _historical_samples(self,sensor_id,target_time):
        if not self.reference:return []
        return self.reference._historical_samples(sensor_id,target_time)

def analyse(req,config):
    started=perf_counter()
    points=req['points']
    cutoff_dt=datetime.fromisoformat(iso(req['as_of']))
    allowed={p['code'] for p in points}
    latest_rows={}
    for row in req['history']:
        code=row['point_code']
        stamp=datetime.fromisoformat(iso(row['timestamp']))
        if code not in allowed or stamp>cutoff_dt:
            continue
        previous=latest_rows.get(code)
        if previous is None or stamp>datetime.fromisoformat(iso(previous['timestamp'])):
            latest_rows[code]=row
    # Website accumulated history is intentionally excluded from all model tools.
    history=list(latest_rows.values())
    if not points or not history:raise ValueError('No room readings available')
    cutoff=iso(req['as_of']);room=req['room_id']
    reference_path=config.get('history_db','') or str(Path(__file__).resolve().parent.parent/'storage'/'digital_twin.sqlite')
    if reference_path and not Path(reference_path).is_file():raise ValueError('Historical database not found. Put digital_twin.sqlite in website/storage or set LLM_HISTORY_DB to the existing database.')
    with tempfile.TemporaryDirectory(prefix='twin_room_') as folder:
        db_path=str(Path(folder)/'snapshot.sqlite')
        with connect(db_path) as db:
            db.execute('INSERT INTO rooms(room_id,room_name,room_type) VALUES(?,?,?)',(room,req['room_name'],'monitoring_location'))
            lookup={p['code']:p for p in points}
            for r in history:
                p=lookup.get(r['point_code'])
                if not p:continue
                stamp=iso(r['timestamp']);dt=datetime.fromisoformat(stamp)
                if dt>datetime.fromisoformat(cutoff):continue
                db.execute('INSERT OR REPLACE INTO sensor_readings VALUES(?,?,?,?,?,?,?,?,?,?,?)',('fault',stamp,p['code'],room,p['sensorType'],float(r['value']),p['unit'],req['source'],r.get('quality','ok'),dt.weekday(),dt.hour*60+dt.minute))
            db.commit()
        reference=RepositoryTools(reference_path,dataset='normal',as_of=cutoff,retrieval=config['retrieval']) if reference_path else None
        tools=LiveRepository(db_path,dataset='fault',as_of=cutoff,retrieval=config['retrieval'],reference=reference)
        tools.source=req['source']
        # Application-managed evidence collection; model may request additional tools.
        approved={s['function']['name'] for s in tools.specifications()}
        initial=[]
        def retrieve(name,args):
            try:
                tools.execute(name,args)
                tools.used[-1]['initiated_by']='application'
            except Exception as exc:
                tools.used.append({'tool':name,'arguments':args,'status':'error',
                    'initiated_by':'application','result':{'error':str(exc)}})
            initial.append(tools.used[-1])
        if 'get_room_context' in approved:
            retrieve('get_room_context',{'room_id':room,'at_time':cutoff})
        latest={}
        for row in history:
            stamp=iso(row['timestamp'])
            if stamp<=cutoff and row['point_code'] in lookup:
                if row['point_code'] not in latest or stamp>latest[row['point_code']]:latest[row['point_code']]=stamp
        if 'compare_to_baseline' in approved:
            for point in points:
                if point['sensorType'] in {'temperature','co2','humidity','light','power'} and point['code'] in latest:
                    retrieve('compare_to_baseline',{'sensor_id':point['code'],'at_time':latest[point['code']]})
        initial=[x for x in initial if x.get('status')!='error']
        client=OllamaClient(model=config['model'],temperature=config['temperature'])
        # The fault identifier is an internal storage partition, NOT a fault label.
        question=(req['question']+'\nSelected room: '+room+' ('+req['room_name']+'). '
          +'Use the available tools to retrieve observations at or before '+cutoff+'. '
          +'The fault dataset identifier here is a live observation partition, not an anomaly label. '
          +'Source: '+req['source']+'. IFC location is a demonstration alias, not a verified physical mapping. '
          +'Only the latest reading per website sensor is available; website accumulated history is excluded. No website trend analysis is possible. Historical normal references come only from the original storage SQLite. '
          +'Forecasts are not connected. Historical baselines, when available, are synthetic reference data, not calibrated limits. '
          +'Comfort indicator uses demo penalties: temperature max(0,abs(T-24.5)-2.5)*14; humidity max(0,abs(RH-52.5)-12.5)*2; '
          +'CO2 max(0,CO2-900)/12; score=round(max(0,100-total penalties/available comfort channels)). '
          +'Occupancy and leakage are not comfort channels. Do not invent headcount, AC state or maintenance information.')
        if len(question)>2000:raise ValueError('Please shorten your question to 900 characters')
        result=run_agent(question,tools,client,prompt_variant=config['prompt'],initial_evidence=initial)
        result['elapsed_seconds']=round(perf_counter()-started,3)
        result['prefetch_tool_call_count']=sum(x.get('initiated_by')=='application' for x in tools.used)
        result['model_tool_call_count']=result['tool_call_count']
        result['tool_call_count']+=result['prefetch_tool_call_count']
        result['retrieval_policy']='application_prefetch_plus_model_tools'
        result.update({'dataset':'website_snapshot','observation_source':req['source'],'room_id':room,'as_of':cutoff,
          'reference_source':'synthetic_normal_history' if reference else 'unavailable','history_available':bool(reference),
          'historical_comparisons_ok':sum(x.get('tool')=='compare_to_baseline' and x['result'].get('status')=='ok' for x in tools.used),
          'website_observation_policy':'latest_per_sensor_only',
          'website_snapshot_points':len(history),
          'integration_note':'Latest-only live observation adapter; not the unchanged development benchmark. Schema-valid answers require evidence review.'})
        return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8011);args=parser.parse_args();lock=threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def reply(self,status,value):
            data=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def do_GET(self):
            if self.path=='/health':self.reply(200,{'ok':True})
            else:self.reply(404,{'error':'Not found'})
        def do_POST(self):
            if self.path!='/ask':self.reply(404,{'error':'Not found'});return
            if not lock.acquire(False):self.reply(409,{'error':'Another room question is running. Please wait.'});return
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0<size<=6000000:raise ValueError('Invalid request size')
                body=json.loads(self.rfile.read(size));self.reply(200,analyse(body['request'],body['config']))
            except (KeyError,ValueError,TypeError) as e:self.reply(400,{'error':str(e)})
            except Exception as e:self.reply(503,{'error':str(e)})
            finally:lock.release()
    print(f'Room LLM bridge: http://127.0.0.1:{args.port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
if __name__=='__main__':main()
