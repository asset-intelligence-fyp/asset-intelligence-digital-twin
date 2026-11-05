import {spawn} from 'node:child_process';
import dotenv from 'dotenv';
dotenv.config();
const mode=process.env.SIMULATOR_MODE||'hybrid';
if(!['hybrid','replay'].includes(mode)){console.error('SIMULATOR_MODE must be hybrid or replay');process.exit(1)}
if(mode==='replay'&&!process.env.DATASET_PATH){console.error('Dataset replay needs DATASET_PATH in .env (original generated ZIP or extracted directory). See docs/dataset-replay.md.');process.exit(1)}
const python=process.env.PYTHON||(process.platform==='win32'?'py':'python3');
const args=!process.env.PYTHON&&process.platform==='win32'?['-3']:[];
args.push('-m',mode==='hybrid'?'tools.hybrid_simulator.run':'tools.dataset_replay.replay','--interval-seconds',process.env.SIM_INTERVAL_SECONDS||(mode==='hybrid'?'5':'2'),'--http-url',`http://localhost:${process.env.SERVER_PORT||3001}/api/sensor-readings`);
if(mode==='replay')args.push('--dataset',process.env.DATASET_PATH,'--split',process.env.DATASET_SPLIT||'fault_weather_2026_q1');
const optional=mode==='hybrid'?[['SIM_START_TIME','--start'],['SIM_STEP_SECONDS','--step-seconds'],['SIM_SEED','--seed'],['SIM_CALENDAR_FILE','--calendar-file'],['SIM_FAULT_MODE','--fault-mode'],['SIM_PROFILE','--profile']]:[['DATASET_START','--start'],['DATASET_END','--end']];
for(const [key,flag] of [...optional,['SIM_TICKS','--ticks'],['SIM_CLOCK_DOMAIN','--clock-domain']])if(process.env[key])args.push(flag,process.env[key]);
const child=spawn(python,[...args,...process.argv.slice(2)],{stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));child.on('error',e=>{console.error(e.message);process.exitCode=1});
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>child.kill(s));
