"""Local-only, optional HTTP entrypoint for future Node.js backend integration.

Run: python -m shared_llm.api --db storage/digital_twin.sqlite --model qwen3:4b
DO NOT expose this proof-of-concept server to the public internet.
"""
from __future__ import annotations
import argparse
import json
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from .db import connect
from .tools import RepositoryTools
from .ollama import OllamaClient
from .agent import run_agent

def serve(db_path,model,port,ollama):
    class Handler(BaseHTTPRequestHandler):
        def reply(self,status,obj):
            data=json.dumps(obj,ensure_ascii=False).encode('utf8')
            self.send_response(status)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Content-Length',str(len(data)))
            self.end_headers();self.wfile.write(data)
        def do_GET(self):
            if self.path!='/health':self.reply(404,{'error':'Not found'});return
            try:
                with connect(db_path,readonly=True) as db:
                    count=db.execute('SELECT COUNT(*) FROM sensor_readings').fetchone()[0]
                self.reply(200,{'status':'ok','sensor_readings':count,'data_kind':'synthetic historical'})
            except Exception as exc:self.reply(503,{'error':str(exc)})
        def do_POST(self):
            if self.path!='/ask':self.reply(404,{'error':'Not found'});return
            length=int(self.headers.get('Content-Length','0'))
            if length<=0 or length>20000:self.reply(413,{'error':'Bad or excessive request size'});return
            try:
                request=json.loads(self.rfile.read(length))
                if set(request)-{'question','as_of','dataset','prompt','retrieval'}:
                    raise ValueError('Unknown request parameters')
                tools=RepositoryTools(db_path,request.get('dataset','normal'),request['as_of'],
                                      request.get('retrieval','contextual'))
                client=OllamaClient(ollama,model=model)
                response=run_agent(request['question'],tools,client,prompt_variant=request.get('prompt','baseline'))
                self.reply(200,response)
            except (KeyError,ValueError) as exc:self.reply(400,{'error':str(exc)})
            except RuntimeError as exc:self.reply(503,{'error':str(exc)})
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    print(f'Local-only API on http://127.0.0.1:{port} (no authentication; development use only)')
    server.serve_forever()

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--db',default='storage/digital_twin.sqlite')
    p.add_argument('--model',default='qwen3:4b')
    p.add_argument('--ollama',default='http://127.0.0.1:11434')
    p.add_argument('--port',type=int,default=8009)
    args=p.parse_args()
    serve(args.db,args.model,args.port,args.ollama)
