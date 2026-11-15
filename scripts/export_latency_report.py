"""Save the running app's source-to-browser benchmark; never substitute HTTP ack timing."""
import argparse,json
from pathlib import Path
from urllib.request import urlopen
ap=argparse.ArgumentParser();ap.add_argument('--url',default='http://localhost:3001/api/benchmarks/latency');ap.add_argument('--output',type=Path,default=Path('runtime/latency-report.json'));args=ap.parse_args()
with urlopen(args.url,timeout=10) as response: data=json.load(response)
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({k:v for k,v in data.items() if k!='samples'},indent=2))
