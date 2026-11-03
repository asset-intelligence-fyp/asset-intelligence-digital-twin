"""Minimal Ollama /api/chat client using only Python standard library."""
from __future__ import annotations
import json
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError

class OllamaClient:
    def __init__(self,base_url='http://127.0.0.1:11434',model='qwen3:4b',timeout=120,temperature=0):
        if not base_url.startswith(('http://127.0.0.1:','http://localhost:')):
            raise ValueError('Only loopback Ollama endpoints are accepted by the starter')
        self.base_url=base_url.rstrip('/')
        self.model=model;self.timeout=timeout;self.temperature=temperature

    def chat(self,messages,tools=None,format=None):
        request={'model':self.model,'messages':messages,'stream':False,
                 'options':{'temperature':self.temperature}}
        if tools is not None:request['tools']=tools
        if format is not None:request['format']=format
        req=Request(self.base_url+'/api/chat',data=json.dumps(request).encode('utf8'),
                    headers={'Content-Type':'application/json'},method='POST')
        try:
            with urlopen(req,timeout=self.timeout) as resp:
                return json.loads(resp.read().decode('utf8'))
        except HTTPError as e:
            body=e.read().decode('utf8',errors='replace')[:500]
            raise RuntimeError(f'Ollama HTTP {e.code}: {body}. Is model {self.model!r} downloaded?') from e
        except URLError as e:
            raise RuntimeError(f'Cannot connect to Ollama at {self.base_url}. Start Ollama and run: ollama pull {self.model}') from e
