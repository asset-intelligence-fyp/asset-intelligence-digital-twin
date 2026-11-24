import {gmailConfigured,gmailMessage,sendGmailSmtp} from './gmailSmtp.js';
// Sends real invitation emails through the Resend HTTPS API when configured.
// No provider secret is ever returned to browsers or stored in PostgreSQL.
export function emailConfigured(){
 const provider=(process.env.EMAIL_PROVIDER||'resend').toLowerCase();
 return Boolean(process.env.APP_PUBLIC_URL&&(provider==='gmail'?gmailConfigured():provider==='resend'&&process.env.RESEND_API_KEY&&process.env.INVITE_FROM_EMAIL));
}
export async function sendInvitationEmail({to,code,expiresAt}){
 if(!emailConfigured())return {sent:false,reason:'Email sending is not configured. Copy the invitation code and share it privately.'};
 const base=process.env.APP_PUBLIC_URL.trim();
 let origin;
 try {
  const u=new URL(base);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('invalid');
  origin=u.origin;
 }catch{return {sent:false,reason:'APP_PUBLIC_URL must be the reachable website URL, for example http://172.20.10.7:3001.'};}
 const link=origin+'/?invite='+encodeURIComponent(code);
 const provider=(process.env.EMAIL_PROVIDER||'resend').toLowerCase();
 const from=provider==='gmail'?process.env.GMAIL_USER?.trim():process.env.INVITE_FROM_EMAIL?.trim();
 const plain='You have been invited to TwinLabs as a Viewer.\n\nOpen this invitation link on the same trusted network as the TwinLabs host:\n'+link+'\n\nIf the link does not open, visit '+origin+' and choose Login → Have an invitation code? Then enter this code:\n'+code+'\n\nThis code expires at '+new Date(expiresAt).toUTCString()+' and can only be used once.\n\nIf you did not expect this invitation, ignore this message.';
 if(provider==='gmail'){
  try{
   const message=gmailMessage({from,to,link,code,expiresAt});
   await sendGmailSmtp({to,message});
   return {sent:true,providerId:null};
  }catch(e){
   console.error('Gmail invitation email failed:',String(e.message||e).slice(0,350));
   return {sent:false,reason:'Gmail SMTP did not accept the invitation. Check Gmail address, App Password, network access and server log.'};
  }
 }
 if(provider!=='resend')return {sent:false,reason:'Unknown EMAIL_PROVIDER. Use gmail or resend.'};
 try{
  const response=await fetch('https://api.resend.com/emails',{
   method:'POST',
   headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify({from,to,subject:'Your TwinLabs invitation',text:plain}),
   signal:AbortSignal.timeout(12000)
  });
  if(!response.ok){
   const err=await response.json().catch(()=>({}));
   console.error('Invitation email provider rejected request:',response.status,String(err.message||'').slice(0,300));
   return {sent:false,reason:'Email provider rejected the request (HTTP '+response.status+'). Check verified sending domain, API key and recipient policy.'};
  }
  const body=await response.json();
  return {sent:true,providerId:body.id||null};
 }catch(e){
  console.error('Invitation email failed:',e.message);
  return {sent:false,reason:'Could not reach email provider. Share the code manually or retry delivery.'};
 }
}
