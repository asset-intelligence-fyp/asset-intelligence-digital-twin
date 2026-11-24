"""Ollama structured JSON inference. All calls are to local localhost Ollama."""
from __future__ import annotations
import json
from typing import Type
from pydantic import BaseModel
from .config import SETTINGS


class OllamaJSON:
    def __init__(self, model: str | None = None, host: str | None = None):
        from ollama import Client
        self.model=model or SETTINGS.model
        self.client=Client(host=host or SETTINGS.host, timeout=240)
        self.totals={"input_tokens":0,"output_tokens":0,"latency_ms":0.0,"calls":0}

    def ask(self, system: str, prompt: str, schema: Type[BaseModel]) -> BaseModel:
        messages=[{"role":"system","content":system}, {"role":"user","content":prompt}]
        last_error=None
        for attempt in range(2):
            try:
                r = self.client.chat(
   			model=self.model,
   			messages=messages,
			format=schema.model_json_schema(),
    			think=False,
    			options={
        			"temperature": 0,
        			"num_ctx": SETTINGS.num_ctx,
        			"num_predict": 1024
    			},
    			stream=False,
		)

                self.totals["calls"] += 1
                self.totals["input_tokens"] += int(getattr(r,"prompt_eval_count",0) or 0)
                self.totals["output_tokens"] += int(getattr(r,"eval_count",0) or 0)
                self.totals["latency_ms"] += float(getattr(r,"total_duration",0) or 0) / 1e6
                obj=schema.model_validate_json(r.message.content)
                return obj
            except Exception as ex:
                last_error=ex
                messages.append({"role":"user","content":
                    "The previous response failed schema validation. Return only a valid JSON object "
                    "matching the requested format. No additional commentary."})
        raise RuntimeError(f"Local LLM failed after retry: {last_error}")
