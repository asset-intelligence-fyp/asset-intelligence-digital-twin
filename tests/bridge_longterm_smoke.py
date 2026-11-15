"""Local smoke test of Python bridge with mock Qwen; no real Ollama required."""
import json, os, socket, sqlite3, subprocess, sys, tempfile, threading, time
from datetime import datetime,timedelta,timezone
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request,urlopen

DRAFT={'projected_value':720.0,'lower_scenario':480.0,'upper_scenario':960.0,
       'direction':'increasing','explanation':'Illustrative monthly trend continuation.',
       'assumptions':['Similar occupancy patterns'],'limitations':['Unknown future weather']}
class OllamaStub(BaseHTTPRequestHandler):
    def do_POST(self):
        assert self.path=='/api/chat'
        request=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert request['model']=='qwen3:1.7b' and request['format']['type']=='object'
        result=json.dumps({'message':{'content':json.dumps(DRAFT)}}).encode()
        self.send_response(200);self.send_header('Content-Length',str(len(result)));self.end_headers();self.wfile.write(result)
    def log_message(self,*a):pass
with tempfile.TemporaryDirectory() as folder:
    db=Path(folder)/'hist.sqlite'
    conn=sqlite3.connect(db)
    conn.execute('CREATE TABLE sensor_readings(dataset TEXT,sensor_id TEXT,timestamp TEXT,value REAL,quality_flag TEXT)')
    cutoff=datetime(2026,11,6,14,0,tzinfo=timezone(timedelta(hours=8)))
    for day in range(1,180):
        date=(cutoff-timedelta(days=day)).isoformat()
        conn.execute('INSERT INTO sensor_readings VALUES (?,?,?,?,?)',('normal','CO2-L03-MEET-01',date,650+day%30,'ok'))
    conn.commit();conn.close()
    mock=ThreadingHTTPServer(('127.0.0.1',0),OllamaStub)
    threading.Thread(target=mock.serve_forever,daemon=True).start()
    port=18432
    env={**os.environ,'OLLAMA_URL':f'http://127.0.0.1:{mock.server_address[1]}'}
    server=subprocess.Popen([sys.executable,'llm_service/bridge.py','--port',str(port)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env)
    try:
        for _ in range(100):
            try:
                urlopen(f'http://127.0.0.1:{port}/health',timeout=.15);break
            except Exception:time.sleep(.05)
        point={'code':'CO2-L03-MEET-01','sensorType':'co2','unit':'ppm','simulatorRoomId':'L03-MEET-01'}
        req={'config':{'model':'qwen3:1.7b','prompt':'concise','history_db':str(db)},'request':{
            'point':point,'room_id':'L03-MEET-01','horizon_months':4,'source':'http','as_of':cutoff.isoformat(),
            'history':[{'point_code':point['code'],'value':655,'timestamp':(cutoff-timedelta(minutes=2)).isoformat(),'quality':'simulated'}]}}
        b=json.dumps(req).encode();q=Request(f'http://127.0.0.1:{port}/predict',data=b,headers={'Content-Type':'application/json'},method='POST')
        with urlopen(q,timeout=15) as res:out=json.load(res)
        assert out['status']=='llm_projection',out
        assert out['projected_value']==720 and out['model']=='qwen3:1.7b',out
        assert out['coverage']['historical_normal_days']==179,out
        print('PASS /predict with Qwen mock: 4-month projection, 179 reference dates, output:',out['projected_value'])
    finally:
        server.terminate();server.wait(timeout=5);mock.shutdown();mock.server_close()
