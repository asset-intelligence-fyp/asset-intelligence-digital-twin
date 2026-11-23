import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,scryptSync} from 'node:crypto';
import express from 'express';
import {adminAuth} from '../server/adminAuth.js';

const hashFor=(password)=>{
 const salt=randomBytes(16).toString('hex');
 return 'scrypt:'+salt+':'+scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
};
async function serve(pool,run){
 const app=express();app.use(express.json());adminAuth(app,pool,'digital_twin');
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 try{await run('http://127.0.0.1:'+server.address().port);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
async function login(url,username,password){
 return fetch(url+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
}

test('database administrator logs in, receives a session and can log out',async()=>{
 const password='private-db-admin-password';
 const users=[{user_id:1,username:'admin',password_hash:hashFor(password),role_name:'admin'}];
 const pool={query:async(query,params)=>{
  assert.match(query,/digital_twin\.users/);
  assert.match(query,/JOIN digital_twin[.]roles/);
  return {rows:users.filter(x=>x.username===params[0])};
 }};
 await serve(pool,async base=>{
  const incorrect=await login(base,'admin','incorrect');
  assert.equal(incorrect.status,401);
  const ok=await login(base,'admin',password);
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).username,'admin');
  const cookie=ok.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  const header={Cookie:cookie.split(';')[0]};
  assert.equal((await(await fetch(base+'/api/admin/session',{headers:header})).json()).authenticated,true);
  assert.equal((await fetch(base+'/api/admin/logout',{method:'POST',headers:header})).status,200);
  assert.equal((await(await fetch(base+'/api/admin/session',{headers:header})).json()).authenticated,false);
 });
});

test('admin login requires PostgreSQL and does not use .env credentials',async()=>{
 await serve(null,async base=>{
  const response=await login(base,'admin','password');
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/PostgreSQL/);
 });
});

test('a missing admin user is rejected and a database outage reports 503',async()=>{
 await serve({query:async()=>({rows:[]})},async base=>{
  assert.equal((await login(base,'admin','anything')).status,401);
 });
 await serve({query:async()=>{throw Error('database offline')}},async base=>{
  assert.equal((await login(base,'admin','anything')).status,503);
 });
});
