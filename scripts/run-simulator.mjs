import {spawn} from 'node:child_process';
const child=spawn(process.env.PYTHON||'python3',['-m','tools.level03_simulator.simulator.run','--interval-seconds',process.env.SIM_INTERVAL_SECONDS||'5','--fault-mode',process.env.SIM_FAULT_MODE||'normal','--out-dir',process.env.SIM_OUTPUT_DIR||'runtime/simulator','--start-sim-time',new Date().toISOString(),'--http-url',`http://localhost:${process.env.SERVER_PORT||3001}/api/sensor-readings`,...process.argv.slice(2)],{stdio:'inherit'});
child.on('exit',code=>process.exit(code??1));for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>child.kill(s));
