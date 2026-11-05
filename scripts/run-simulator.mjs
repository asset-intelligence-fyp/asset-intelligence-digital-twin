import {spawn} from 'node:child_process';
import dotenv from 'dotenv';
dotenv.config();
if(!process.env.DATASET_PATH){console.error('Dataset replay needs DATASET_PATH in .env (original generated ZIP or extracted directory). See docs/dataset-replay.md.');process.exit(1)}
const python=process.env.PYTHON||(process.platform==='win32'?'py':'python3');
const args=!process.env.PYTHON&&process.platform==='win32'?['-3']:[];
args.push('-m','tools.dataset_replay.replay','--dataset',process.env.DATASET_PATH,'--split',process.env.DATASET_SPLIT||'fault_weather_2026_q1','--interval-seconds',process.env.SIM_INTERVAL_SECONDS||'2','--http-url',`http://localhost:${process.env.SERVER_PORT||3001}/api/sensor-readings`);
for(const [key,flag] of [['DATASET_START','--start'],['DATASET_END','--end'],['SIM_TICKS','--ticks'],['SIM_CLOCK_DOMAIN','--clock-domain']])if(process.env[key])args.push(flag,process.env[key]);
const child=spawn(python,[...args,...process.argv.slice(2)],{stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));child.on('error',e=>{console.error(e.message);process.exitCode=1});
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>child.kill(s));
