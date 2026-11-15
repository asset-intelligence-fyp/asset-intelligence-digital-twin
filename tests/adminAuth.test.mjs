import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,scryptSync} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import express from 'express';
import {adminAuth} from '../server/adminAuth.js';

const exec=promisify(execFile);
const originalUsername=process.env.ADMIN_USERNAME,originalHash=process.env.ADMIN_PASSWORD_HASH;
const restore=()=>{if(originalUsername===undefined)delete process.env.ADMIN_USERNAME;else process.env.ADMIN_USERNAME=originalUsername;
 if(originalHash===undefined)delete process.env.ADMIN_PASSWORD_HASH;else process.env.ADMIN_PASSWORD_HASH=originalHash;};
const makeHash=password=>{const salt=randomBytes(16).toString('hex');return 'scrypt:'+salt+':'+scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');};
async function withApp(run){
 const app=express();app.use(express.json());adminAuth(app);
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 try{await run('http://127.0.0.1:'+server.address().port);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const login=(base,username,password)=>fetch(base+'/api/admin/login',{
 method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})
});
test('local admin setup preserves other .env entries and replaces old credentials',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'twinlabs-admin-'));
 try{
  writeFileSync(join(dir,'.env'),'PGDATABASE=demo\nADMIN_USERNAME=old\nADMIN_PASSWORD_HASH=scrypt:old\nSIMULATOR_MODE=hybrid\nADMIN_USERNAME=duplicate\n');
  const {stdout}=await exec(process.execPath,[fileURLToPath(new URL('../scripts/setup-admin.mjs',import.meta.url))],{cwd:dir,env:{...process.env,ADMIN_USERNAME:'',ADMIN_PASSWORD_HASH:''}});
  const password=stdout.match(/^Password: ([^\r\n]+)$/m)?.[1];
  assert.ok(password&&password.length>=12);
  const content=readFileSync(join(dir,'.env'),'utf8');
  assert.match(content,/PGDATABASE=demo/);
  assert.match(content,/SIMULATOR_MODE=hybrid/);
  assert.equal((content.match(/^ADMIN_USERNAME=/gm)||[]).length,1);
  assert.equal((content.match(/^ADMIN_PASSWORD_HASH=/gm)||[]).length,1);
  assert.match(content,/^ADMIN_USERNAME=admin$/m);
  const hash=content.match(/^ADMIN_PASSWORD_HASH=(scrypt:[a-f0-9]{32}:[a-f0-9]{128})$/m)?.[1];
  assert.ok(hash);
  const [,salt,expected]=hash.split(':');
  assert.equal(scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex'),expected);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('admin login, session cookie, logout and incorrect password',async()=>{
 const password='unique-local-demo-password';
 process.env.ADMIN_USERNAME='admin';
 process.env.ADMIN_PASSWORD_HASH=makeHash(password);
 try{await withApp(async base=>{
  const bad=await login(base,'admin','incorrect-password');
  assert.equal(bad.status,401);
  const unauth=await(await fetch(base+'/api/admin/session')).json();
  assert.equal(unauth.authenticated,false);
  const ok=await login(base,'admin',password);
  assert.equal(ok.status,200);
  const cookie=ok.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  const credential=cookie.split(';')[0];
  const session=await(await fetch(base+'/api/admin/session',{headers:{Cookie:credential}})).json();
  assert.equal(session.authenticated,true);
  assert.equal(session.username,'admin');
  const logout=await fetch(base+'/api/admin/logout',{method:'POST',headers:{Cookie:credential}});
  assert.equal(logout.status,200);
  const after=await(await fetch(base+'/api/admin/session',{headers:{Cookie:credential}})).json();
  assert.equal(after.authenticated,false);
 });}finally{restore();}
});
test('missing and malformed local admin configuration gives actionable setup error',async()=>{
 delete process.env.ADMIN_USERNAME;delete process.env.ADMIN_PASSWORD_HASH;
 try{await withApp(async base=>{
  const missing=await login(base,'admin','anything');
  assert.equal(missing.status,503);
  assert.match((await missing.json()).error,/npm run admin:setup/);
  process.env.ADMIN_USERNAME='admin';
  process.env.ADMIN_PASSWORD_HASH='scrypt:invalid';
  const invalid=await login(base,'admin','anything');
  assert.equal(invalid.status,503);
  assert.match((await invalid.json()).error,/npm run admin:setup/);
 });}finally{restore();}
});
