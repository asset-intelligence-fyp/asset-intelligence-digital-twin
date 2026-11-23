import test from 'node:test';
import assert from 'node:assert/strict';
import {sendInvitationEmail,emailConfigured} from '../server/invitationEmail.js';
import {gmailMessage,gmailConfigured} from '../server/gmailSmtp.js';

function withEnv(config,fn){
 const keys=['RESEND_API_KEY','INVITE_FROM_EMAIL','APP_PUBLIC_URL','EMAIL_PROVIDER','GMAIL_USER','GMAIL_APP_PASSWORD'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const originalFetch=globalThis.fetch;
 return (async()=>{
  try{
   for(const key of keys){if(Object.hasOwn(config,key))process.env[key]=config[key];else delete process.env[key]}
   await fn();
  }finally{
   for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key]}
   globalThis.fetch=originalFetch;
  }
 })();
}
test('email is explicitly not sent without provider config',async()=>{
 await withEnv({},async()=>{
  assert.equal(emailConfigured(),false);
  const r=await sendInvitationEmail({to:'person@example.test',code:'test-code',expiresAt:new Date()});
  assert.equal(r.sent,false);
  assert.match(r.reason,/not configured/i);
 });
});
test('email sends one-time link through configured provider',async()=>{
 await withEnv({
  RESEND_API_KEY:'fake-api-key',
  INVITE_FROM_EMAIL:'TwinLabs <invites@example.test>',
  APP_PUBLIC_URL:'http://172.20.10.7:3001'
 },async()=>{
  let called=0;
  globalThis.fetch=async(url,opts)=>{
   called++;
   assert.equal(url,'https://api.resend.com/emails');
   assert.match(opts.headers.Authorization,/Bearer fake-api-key/);
   const body=JSON.parse(opts.body);
   assert.equal(body.to,'person@example.test');
   assert.match(body.text,/http:\/\/172\.20\.10\.7:3001\/\?invite=abc123/);
   return {ok:true,json:async()=>({id:'mock-message-id'})};
  };
  const r=await sendInvitationEmail({to:'person@example.test',code:'abc123',expiresAt:new Date('2026-12-01')});
  assert.equal(r.sent,true);assert.equal(r.providerId,'mock-message-id');assert.equal(called,1);
 });
});
test('provider failure is shown as unsent, not a success',async()=>{
 await withEnv({
  RESEND_API_KEY:'fake-api-key',INVITE_FROM_EMAIL:'Sender <sender@example.test>',APP_PUBLIC_URL:'https://twinlabs.example.test'
 },async()=>{
  globalThis.fetch=async()=>({ok:false,status:403,json:async()=>({message:'Sender not verified'})});
  const r=await sendInvitationEmail({to:'person@example.test',code:'abc123',expiresAt:new Date()});
  assert.equal(r.sent,false);assert.match(r.reason,/403/);
 });
});

test('Gmail SMTP is selected without requiring a Resend API key or a custom domain',async()=>{
 await withEnv({
  EMAIL_PROVIDER:'gmail',
  GMAIL_USER:'twinlabsdigital@gmail.com',
  GMAIL_APP_PASSWORD:'fake-app-password-for-test',
  APP_PUBLIC_URL:'http://172.20.10.7:3001'
 },async()=>{
  assert.equal(gmailConfigured(),true);
  assert.equal(emailConfigured(),true);
  const raw=gmailMessage({
   from:'twinlabsdigital@gmail.com',
   to:'friend@example.test',
   link:'http://172.20.10.7:3001/?invite=one-time-123',
   code:'one-time-123',
   expiresAt:'2026-12-01T12:00:00Z'
  });
  assert.match(raw,/From: "TwinLabs" <twinlabsdigital@gmail.com>/);
  assert.match(raw,/Content-Transfer-Encoding: base64/);
  const body=Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g,''),'base64').toString();
  assert.match(body,/one-time-123/);
  assert.match(body,/172\.20\.10\.7:3001/);
 });
});
test('Gmail email is not configured without an App Password',async()=>{
 await withEnv({EMAIL_PROVIDER:'gmail',GMAIL_USER:'twinlabsdigital@gmail.com',APP_PUBLIC_URL:'http://localhost:3001'},async()=>{
  assert.equal(gmailConfigured(),false);
  assert.equal(emailConfigured(),false);
 });
});
test('Gmail message refuses invalid header addresses',()=>{
 assert.throws(()=>gmailMessage({from:'x@gmail.com\r\nBcc: stolen@example.test',to:'friend@example.test',link:'http://localhost',code:'abc',expiresAt:new Date()}),/Invalid email address/);
});
