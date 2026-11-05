"""Publish newly generated hybrid telemetry; no live weather service is contacted."""
from __future__ import annotations
import argparse,json,math,time,uuid,secrets,logging
from logging.handlers import RotatingFileHandler
from datetime import datetime,timezone
from pathlib import Path
from tools.dataset_replay.replay import Publisher
from tools.hybrid_simulator.engine import HybridSimulator,PRODUCER,HERE
class ControlledPublisher(Publisher):
 def controls(self):
  # Reuse the same connection; a failed control request reconnects on the next send.
  if not self.connection:return {}
  try:
   self.connection.request('GET','/api/simulation/control');response=self.connection.getresponse();data=json.loads(response.read())
   if response.status!=200:raise OSError('Simulation control endpoint unavailable')
   return data
  except (OSError,ValueError):self.close();raise

def main(argv=None):
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--profile',default=str(HERE/'profile.json'));ap.add_argument('--seed',type=int);ap.add_argument('--start');ap.add_argument('--step-seconds',type=float,default=5);ap.add_argument('--interval-seconds',type=float,default=5);ap.add_argument('--ticks',type=int,default=0);ap.add_argument('--http-url',default='http://localhost:3001/api/sensor-readings');ap.add_argument('--clock-domain',choices=('same_host','unsynchronized_remote'),default='same_host');ap.add_argument('--calendar-file');ap.add_argument('--fault-mode',choices=('normal','demo'),default='normal');ap.add_argument('--private-dir',default='runtime/hybrid');args=ap.parse_args(argv)
 if args.seed is not None and not 0<=args.seed<=4294967295:ap.error('Seed must be a 32-bit unsigned integer')
 if not math.isfinite(args.interval_seconds) or args.interval_seconds<=0 or args.ticks<0:ap.error('Positive finite release interval and nonnegative ticks required')
 publisher=None
 try:
  seed=args.seed if args.seed is not None else secrets.randbits(32);profile=json.loads(Path(args.profile).read_text());sim=HybridSimulator(profile,seed,args.start,args.step_seconds,args.calendar_file,args.fault_mode);run=uuid.uuid4().hex
  folder=Path(args.private_dir);folder.mkdir(parents=True,exist_ok=True);logger=logging.getLogger('hybrid-truth');logger.setLevel(logging.INFO);logger.propagate=False;handler=RotatingFileHandler(folder/'fault_truth_PRIVATE.jsonl',maxBytes=5_000_000,backupCount=2);logger.handlers=[handler]
  publisher=ControlledPublisher(args.http_url);controls={};n=0
  print(f'Hybrid generator seed={seed} profile={profile["profile_id"]} step={args.step_seconds}s release={args.interval_seconds}s; fresh synthetic observations, not dataset replay',flush=True)
  while not args.ticks or n<args.ticks:
   began=time.monotonic();released=datetime.now(timezone.utc).isoformat(timespec='milliseconds');batch,truth=sim.step(controls);n+=1
   message={**batch,'producer':PRODUCER,'synthetic':True,'replay_id':run,'batch_id':f'{run}:{n}','sequence':n,'dataset':'generated_hybrid','clock_domain':args.clock_domain,'generated_at_utc':released,'release_interval_seconds':args.interval_seconds}
   publisher.send(message);logger.info(json.dumps({'run_id':run,'sequence':n,'timestamp':batch['dataset_timestamp'],'seed':seed,'profile_id':profile['profile_id'],'injected_faults':truth}))
   controls=publisher.controls()
   print(f'hybrid batch={n} time={batch["dataset_timestamp"]} weather={batch["simulation"]["weather"]["scene"]} calendar={batch["simulation"]["calendar"]["day_type"]} readings=18',flush=True)
   if not args.ticks or n<args.ticks:time.sleep(max(0,args.interval_seconds-(time.monotonic()-began)))
  return 0
 except (OSError,ValueError,KeyError) as e:ap.error(str(e))
 finally:
  if publisher:publisher.close()
  for handler in logging.getLogger('hybrid-truth').handlers:handler.close()
if __name__=='__main__':
 try:raise SystemExit(main())
 except KeyboardInterrupt:print('Hybrid generator stopped.')
