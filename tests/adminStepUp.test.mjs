import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,scryptSync} from 'node:crypto';
import express from 'express';
import {adminAuth,requireAdmin,requireConfirmedAdmin} from '../server/adminAuth.js';

function hash(password){
 const salt=randomBytes(16);
 return 'scrypt:'+salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex');
}
test('write operations require fresh administrator password even with login session',async()=>{
 const password='secure-sample-admin-password';
 const user={user_id:1,username:'admin',password_hash:hash(password),role_name:'admin',is_active:true};
 const pool={query:async(sql,params)=>{
  if(sql.includes('password_hash FROM digital_twin.users'))return {rowCount:1,rows:[{password_hash:user.password_hash}]};
  if(sql.includes('SELECT 1 FROM digital_twin.users'))return {rowCount:1,rows:[{one:1}]};
  if(sql.includes('SELECT users.user_id'))return {rowCount:1,rows:[user]};
  throw Error('Unexpected SQL in test: '+sql);
 }};
 const app=express();app.use(express.json());adminAuth(app,pool,'digital_twin');
 let writes=0;
 app.patch('/api/admin/manage/example',requireAdmin,requireConfirmedAdmin,(_req,res)=>{writes++;res.json({ok:true})});
 const server=app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const headers={Cookie:cookie,'Content-Type':'application/json'};
  const blocked=await fetch(base+'/api/admin/manage/example',{method:'PATCH',headers,body:'{}'});
  assert.equal(blocked.status,428);assert.equal(writes,0);
  const invalid=await fetch(base+'/api/admin/confirm-password',{method:'POST',headers,body:JSON.stringify({password:'incorrect'})});
  assert.equal(invalid.status,401);
  assert.equal((await fetch(base+'/api/admin/manage/example',{method:'PATCH',headers,body:'{}'})).status,428);
  const action={method:'PATCH',path:'/api/admin/manage/example',body:{name:'new'}};
  const confirmed=await fetch(base+'/api/admin/confirm-password',{method:'POST',headers,body:JSON.stringify({password,action})});
  assert.equal(confirmed.status,200);
  const {authorization}=await confirmed.json();
  assert.match(authorization,/^[a-f0-9]{64}$/);
  const withToken={...headers,'X-Admin-Confirmation':authorization};
  const wrongBody=await fetch(base+'/api/admin/manage/example',{method:'PATCH',headers:withToken,body:JSON.stringify({name:'different'})});
  assert.equal(wrongBody.status,428);
  assert.equal(writes,0);
  const reusedWrong=await fetch(base+'/api/admin/manage/example',{method:'PATCH',headers:withToken,body:JSON.stringify(action.body)});
  assert.equal(reusedWrong.status,428);
  const confirmAgain=await fetch(base+'/api/admin/confirm-password',{method:'POST',headers,body:JSON.stringify({password,action})});
  const tokenAgain=(await confirmAgain.json()).authorization;
  const confirmedHeaders={...headers,'X-Admin-Confirmation':tokenAgain};
  const permitted=await fetch(base+'/api/admin/manage/example',{method:'PATCH',headers:confirmedHeaders,body:JSON.stringify(action.body)});
  assert.equal(permitted.status,200);assert.equal(writes,1);
  const replay=await fetch(base+'/api/admin/manage/example',{method:'PATCH',headers:confirmedHeaders,body:JSON.stringify(action.body)});
  assert.equal(replay.status,428);assert.equal(writes,1);
  const anotherWithoutPassword=await fetch(base+'/api/admin/manage/example',{method:'PATCH',headers,body:JSON.stringify(action.body)});
  assert.equal(anotherWithoutPassword.status,428);
 }finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 }
});
