import tls from 'node:tls';

// Minimal TLS-only SMTP client for the fixed Gmail submission endpoint.
// TLS certificate verification is enabled; never sends credentials over plaintext.
const HOST='smtp.gmail.com';
const PORT=465;
const TIMEOUT_MS=12000;
const HEADER_EMAIL=/^[^\s\r\n<>@]+@[^\s\r\n<>@]+\.[^\s\r\n<>@]+$/;
function validateEmail(value){
 if(typeof value!=='string'||value.length>254||!HEADER_EMAIL.test(value))
  throw Error('Invalid email address');
 return value;
}
export function gmailConfigured(){
 return Boolean(process.env.GMAIL_USER?.trim()&&process.env.GMAIL_APP_PASSWORD?.trim());
}
export function gmailMessage({from,to,link,code,expiresAt}){
 validateEmail(from);validateEmail(to);
 const expires=new Date(expiresAt);
 if(!Number.isFinite(expires.getTime()))throw Error('Invalid invitation expiry');
 const text=[
  'You are invited to TwinLabs',
  '',
  'An administrator has invited you to access the TwinLabs Digital Twin platform as a Viewer.',
  '',
  'Open this invitation link:',
  link,
  '',
  'If the link does not open, visit the TwinLabs website and select Login > Have an invitation code?',
  'Your one-time code: '+code,
  '',
  'Expires: '+expires.toUTCString(),
  'This invitation can be used once only. If you did not request access, ignore this email.',
  '',
  'Security: the TwinLabs website may be available only on the host\'s private network. Do not forward this code.'
 ].join('\n');
 const encoded=Buffer.from(text,'utf8').toString('base64').replace(/.{1,76}/g,'$&\r\n').trimEnd();
 return [
  'From: "TwinLabs" <'+from+'>',
  'To: <'+to+'>',
  'Subject: Your TwinLabs invitation',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: base64',
  'Date: '+new Date().toUTCString(),
  '',
  encoded
 ].join('\r\n');
}
function readReplies(socket){
 let buffer='',lines=[],queue=[],pending=null,finished=false;
 function done(err){
  finished=true;
  if(pending){const p=pending;pending=null;p.reject(err)}
  queue=[];
 }
 function deliver(response){
  if(finished)return;
  if(pending){const p=pending;pending=null;p.resolve(response)}
  else queue.push({response});
 }
 socket.on('data',data=>{
  buffer+=data.toString('utf8');
  if(buffer.length>16384){done(Error('SMTP response too large'));socket.destroy();return}
  let i;
  while((i=buffer.indexOf('\n'))!==-1){
   const line=buffer.slice(0,i).replace(/\r$/,'');buffer=buffer.slice(i+1);
   if(!/^\d{3}[ -]/.test(line)){done(Error('Invalid SMTP response'));socket.destroy();return}
   lines.push(line);
   if(line[3]===' '){const response={code:Number(line.slice(0,3)),text:lines.join('\n')};lines=[];deliver(response)}
  }
 });
 socket.once('error',e=>done(e));
 socket.once('close',()=>{if(!finished)done(Error('SMTP connection closed unexpectedly'))});
 return function next(){
  if(queue.length)return Promise.resolve(queue.shift().response);
  if(finished)return Promise.reject(Error('SMTP connection closed'));
  return new Promise((resolve,reject)=>pending={resolve,reject});
 };
}
export async function sendGmailSmtp({to,message}){
 const from=validateEmail(process.env.GMAIL_USER.trim());
 const recipient=validateEmail(to);
 const pass=process.env.GMAIL_APP_PASSWORD.replace(/\s/g,'');
 const socket=tls.connect({host:HOST,port:PORT,servername:HOST,rejectUnauthorized:true});
 socket.setTimeout(TIMEOUT_MS,()=>socket.destroy(Error('Gmail SMTP timed out')));
 const next=readReplies(socket);
 const expect=async(expected)=>{
  const reply=await next();
  if(!expected.includes(reply.code)){
   // Never include credential-bearing SMTP commands in error output.
   throw Error('Gmail SMTP rejected request ('+reply.code+'): '+reply.text.slice(0,250));
  }
  return reply;
 };
 const command=async(line,expected)=>{if(socket.destroyed)throw Error('SMTP connection closed');socket.write(line+'\r\n');return expect(expected)};
 try{
  await expect([220]);
  await command('EHLO twinlabs.local',[250]);
  const auth=Buffer.from('\0'+from+'\0'+pass).toString('base64');
  await command('AUTH PLAIN '+auth,[235]);
  await command('MAIL FROM:<'+from+'>',[250]);
  await command('RCPT TO:<'+recipient+'>',[250,251]);
  await command('DATA',[354]);
  // Message content is base64-encoded so SMTP dot-stuffing is not needed here.
  await command(message+'\r\n.',[250]);
  try{await command('QUIT',[221])}catch{}
  return {sent:true};
 }finally{socket.end();socket.destroy()}
}
