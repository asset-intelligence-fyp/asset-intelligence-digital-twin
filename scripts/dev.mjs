import {spawn} from 'node:child_process';
import dotenv from 'dotenv';
dotenv.config();
if(!process.env.TWIN_STORAGE&&!process.env.DATABASE_URL&&!process.env.PGDATABASE)process.env.TWIN_STORAGE='memory';
const python=process.env.PYTHON||(process.platform==='win32'?'py':'python3');
const pythonArgs=!process.env.PYTHON&&process.platform==='win32'?['-3']:[];
const bridge=spawn(python,[...pythonArgs,'llm_service/bridge.py'],{stdio:'inherit'});
const api=spawn(process.execPath,['server/sensorServer.js'],{stdio:'inherit'});
const web=spawn(process.execPath,['node_modules/vite/bin/vite.js',...process.argv.slice(2)],{stdio:'inherit'});
const simulator=(process.env.SIMULATOR_MODE!=='replay'||process.env.DATASET_PATH)&&process.env.SIMULATOR_AUTOSTART!=='false'?spawn(process.execPath,['scripts/run-simulator.mjs'],{stdio:'inherit'}):null;
if(!simulator)console.log('Simulator is stopped. See docs/hybrid-simulator.md for hybrid/replay setup.');
const children=[bridge,api,web,...(simulator?[simulator]:[])];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');process.exitCode=code}
for(const child of children){child.on('exit',code=>{if(child===simulator){console.log(`Simulator exited (${code}); website stays available.`)}else stop(code||0)});child.on('error',e=>{console.error(e.message);stop(1)})}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());