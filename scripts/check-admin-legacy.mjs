import dotenv from 'dotenv';
dotenv.config();
const username=process.env.ADMIN_USERNAME;
const hash=process.env.ADMIN_PASSWORD_HASH||'';
const valid=typeof username==='string'&&username.length>0&&
 /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash);
if(!valid){
 console.error('Admin credentials missing or invalid. Run: npm run admin:setup');
 process.exit(1);
}
console.log('Admin credentials: configured (username '+username+'). Password/hash not displayed.');
const port=Number(process.env.SERVER_PORT||3001);
const base='http://127.0.0.1:'+port;
let health;
try{
 const response=await fetch(base+'/api/health',{signal:AbortSignal.timeout(4000)});
 health=await response.json();
 if(!response.ok||!health.ok)throw Error('API health returned '+response.status);
 console.log('API reachable. Storage: '+health.storage+', schema: '+(health.schema||'none')+'.');
 if(health.storage==='temporary_memory'){
  console.warn('Database viewer unavailable in memory mode. Use PostgreSQL and run npm run db:check for the database demonstration.');
 }else if(health.schema==='digital_twin'&&(!health.timescale?.hypertable)){
  console.warn('PostgreSQL is connected but the v3 TimescaleDB hypertable is not confirmed.');
 }
}catch(e){
 console.error('API unavailable: '+e.message+'. Start npm run dev, then rerun this command.');
 process.exit(1);
}
if(!process.argv.includes('--verify-login')){
 console.log('Configuration check passed. To test a real login: npm run admin:check -- --verify-login');
 process.exit(0);
}
async function maskedPassword(){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('An interactive local terminal is required.');
 process.stdout.write('Enter the generated admin password (hidden): ');
 const chars=[];
 process.stdin.setRawMode(true);process.stdin.resume();
 try{
  return await new Promise((resolve,reject)=>{
   const onData=buffer=>{
    for(const byte of buffer){
     if(byte===3){process.stdin.off('data',onData);reject(Error('Cancelled'));return;}
     if(byte===13||byte===10){process.stdin.off('data',onData);resolve(chars.join(''));return;}
     if(byte===127||byte===8){chars.pop();continue;}
     if(byte>=32&&byte<=126)chars.push(String.fromCharCode(byte));
    }
   };
   process.stdin.on('data',onData);
  });
 }finally{process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
}
try{
 const password=await maskedPassword();
 const response=await fetch(base+'/api/admin/login',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({username,password}),signal:AbortSignal.timeout(5000)
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'Login returned HTTP '+response.status);
 const cookie=response.headers.get('set-cookie')?.split(';')[0];
 if(!cookie)throw Error('Login succeeded but no session cookie was returned.');
 const sessionResponse=await fetch(base+'/api/admin/session',{
  headers:{Cookie:cookie},signal:AbortSignal.timeout(5000)
 });
 const session=await sessionResponse.json();
 if(!sessionResponse.ok||session.authenticated!==true||session.username!==username){
  throw Error('Session verification failed');
 }
 console.log('PASS: server accepted admin password and authenticated session cookie.');
 const dbResponse=await fetch(base+'/api/admin/database/summary',{
  headers:{Cookie:cookie},signal:AbortSignal.timeout(5000)
 });
 if(dbResponse.ok){
  const db=await dbResponse.json();
  console.log('PASS: authenticated database view is accessible: '+db.database?.database+
   ' ('+(db.active_schema||'unknown')+').');
 }else{
  const db=await dbResponse.json().catch(()=>({}));
  console.warn('Database viewer not ready: '+(db.error||'HTTP '+dbResponse.status)+
   '. The login works; verify PostgreSQL separately.');
 }
}catch(e){console.error('Admin login smoke test failed: '+e.message);process.exitCode=1;}
