// One-command LAN demonstration: build the complete website and serve it from
// the API on port 3001. Teammates use a browser, never direct database access.
import {spawn,spawnSync} from 'node:child_process';
import {networkInterfaces} from 'node:os';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
if(existsSync(resolve(root,'.env')))process.loadEnvFile(resolve(root,'.env'));
const port=Number(process.env.SERVER_PORT||3001);
const env={...process.env,TWIN_DB_SCHEMA:'digital_twin'};
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('SERVER_PORT must be between 1024 and 65535.');
if(env.TWIN_STORAGE==='memory')throw Error('Remove TWIN_STORAGE=memory from .env. Shared Admin Database requires PostgreSQL.');
if(!env.DATABASE_URL&&!env.PGDATABASE){
 console.error('No PostgreSQL database configured in .env. Copy your existing working database connection into this project first. Do not share it with teammates.');
 process.exit(1);
}
// Bootstrap npm dependencies before importing the PostgreSQL driver.
if(!existsSync(resolve(root,'node_modules','pg')))run('npm',['ci'],'Installing project dependencies');
const {default:pg}=await import('pg');
const db=new pg.Pool(env.DATABASE_URL?{connectionString:env.DATABASE_URL,connectionTimeoutMillis:5000}:{
 host:env.PGHOST||'localhost',port:Number(env.PGPORT||5432),database:env.PGDATABASE,
 ...(env.PGUSER?{user:env.PGUSER}:{}),...(env.PGPASSWORD?{password:env.PGPASSWORD}:{}),
 connectionTimeoutMillis:5000
});
let adminExists=false;
try{
 const check=await db.query(`SELECT
  to_regclass('digital_twin.sensor_registry') IS NOT NULL AS sensors,
  to_regclass('digital_twin.sensor_readings') IS NOT NULL AS readings,
  to_regclass('digital_twin.users') IS NOT NULL AS users,
  to_regclass('digital_twin.roles') IS NOT NULL AS roles`);
 if(Object.values(check.rows[0]).some(v=>!v))throw Error('Missing digital_twin tables. Back up your database, then review npm run db:setup:v3; this hosting script intentionally never alters existing schema.');
 const tables=await db.query('SELECT count(*)::int AS sensors FROM digital_twin.sensor_registry');
 if(tables.rows[0].sensors===0)throw Error('Database has no registered sensors; verify the selected database.');
 const account=await db.query(`SELECT EXISTS(
  SELECT 1 FROM digital_twin.users u JOIN digital_twin.roles r ON r.role_id=u.role_id
  WHERE u.username='admin' AND r.role_name='admin'
 ) AS exists`);
 adminExists=account.rows[0].exists;
 console.log('PostgreSQL connection verified: digital_twin tables and '+tables.rows[0].sensors+' sensors available.');
}catch(e){console.error('Hosting preflight failed: '+e.message);process.exitCode=1;await db.end();process.exit(1);}
await db.end();

function run(command,args,description){
 console.log('\n'+description);
 const cmd=process.platform==='win32'?'cmd.exe':command;
 const argv=process.platform==='win32'?['/d','/s','/c',[command,...args].join(' ')]:args;
 const result=spawnSync(cmd,argv,{stdio:'inherit',cwd:root,env});
 if(result.error||result.status!==0)throw Error(description+' failed. '+(result.error?.message||'Exit '+result.status));
}
try{
 if(!existsSync(resolve(root,'node_modules','vite')))run('npm',['ci'],'Installing project dependencies');
 run('node',['scripts/repair-alert-schema.mjs'],'Checking and repairing legacy alert schema (additive only)');
 if(!adminExists){
  console.log('No database administrator found. Creating one securely (password shown once)...');
  run('node',['scripts/setup-db-admin.mjs'],'Initializing database-backed admin login');
 }
 run('npm',['run','build'],'Building TwinLabs Website');
}catch(e){console.error(e.message);process.exit(1);}

const active=[];
let stopping=false;
function launch(label,command,args,{optional=false}={}){
 const child=spawn(command,args,{cwd:root,env,stdio:'inherit',windowsHide:false});
 active.push(child);
 child.on('error',error=>{
  console.error(label+' could not start: '+error.message);
  if(!optional)shutdown(1);
 });
 child.on('exit',code=>{
  if(stopping)return;
  console.error(label+' exited'+(code===null?'':(' (code '+code+')'))+'.');
  if(!optional)shutdown(code||1);
 });
 return child;
}
function shutdown(code=0){
 if(stopping)return;
 stopping=true;
 for(const child of active)if(child.exitCode===null)child.kill();
 process.exitCode=code;
}
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>shutdown(0));
const python=env.PYTHON||(process.platform==='win32'?'py':'python3');
const pythonArgs=process.platform==='win32'&&!env.PYTHON?['-3']:[];
if(env.HOST_START_AI!=='false')launch('Qwen3 bridge',python,[...pythonArgs,'llm_service/bridge.py'],{optional:true});
launch('TwinLabs Website + Backend',process.execPath,['server/sensorServer.js']);
if(env.SIMULATOR_AUTOSTART!=='false')launch('TwinLabs Simulator',process.execPath,['scripts/run-simulator.mjs'],{optional:true});
console.log('\nTwinLabs shared website starting.');
console.log('Host URL: http://localhost:'+port);
const urls=[];
for(const items of Object.values(networkInterfaces())){
 for(const entry of items||[]){
  if(entry.family==='IPv4'&&!entry.internal&&!entry.address.startsWith('169.254.'))urls.push('http://'+entry.address+':'+port);
 }
}
if(urls.length){console.log('Team LAN URLs (use the IP on the shared Hotspot):');for(const url of new Set(urls))console.log('  '+url);}
else console.log('Could not detect LAN IP. Check the Windows Wi-Fi IPv4 address with ipconfig.');
console.log('Your teammates only need a browser and the same Hotspot. No PostgreSQL/pgAdmin setup on their Macs.');
console.log('Keep the host computer awake. Press Ctrl+C to stop.\n');
