import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';

const sessions = new Map();
let authenticationPool=null;
const attempts = new Map();
const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const cookieName = 'twinlabs_admin_session';

function parseCookie(req) {
  const pairs = (req.headers.cookie || '').split(';');
  const value = pairs.find(v => v.trim().startsWith(cookieName + '='));
  return value ? value.trim().slice(cookieName.length + 1) : '';
}
function readSession(req) {
  const token = parseCookie(req);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) { sessions.delete(token); return null; }
  return session;
}
function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const [algorithm,salt,expected] = (stored || '').split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(expected || '')) return false;
  const actual = scryptSync(password,Buffer.from(salt,'hex'),64);
  return timingSafeEqual(actual,Buffer.from(expected,'hex'));
}
function actionFingerprint(method,path,body){
 return createHash('sha256').update(JSON.stringify([method,path,body])).digest('hex');
}
function cookie(req, value, maxAge) {
  const secure = req.secure || req.headers['x-forwarded-proto']==='https';
  return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
export function adminAuth(app,pool=null,schema='digital_twin') {
  authenticationPool=pool;
  app.post('/api/admin/login',async(req,res)=>{
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = attempts.get(ip);
    if(record && record.until > now && record.count >= MAX_ATTEMPTS) return res.status(429).json({error:'Too many login attempts. Try again later.'});
    // Preserve the original local .env administrator for memory / legacy
    // development only; LAN-hosted digital_twin uses database-backed accounts.
    if(!pool||schema!=='digital_twin'){
      const name=process.env.ADMIN_USERNAME;
      const hash=process.env.ADMIN_PASSWORD_HASH||'';
      if(!name||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash))
       return res.status(503).json({error:'Admin login requires the digital_twin PostgreSQL database, or the local development credentials from npm run admin:setup.'});
      const valid=typeof req.body?.username==='string'&&req.body.username===name&&verifyPassword(req.body?.password,hash);
      if(!valid){
       const prev=record?.until>now?record.count:0;
       attempts.set(ip,{count:prev+1,until:now+WINDOW_MS});
       return res.status(401).json({error:'Invalid credentials'});
      }
      attempts.delete(ip);
      const token=randomBytes(32).toString('hex');
      sessions.set(token,{username:name,userId:null,role:'admin',legacy:true,expires:now+SESSION_MS});
      res.setHeader('Set-Cookie',cookie(req,token,8*60*60));
      return res.json({authenticated:true,username:name,role:'admin',legacy:true});
    }
    const username=req.body?.username,password=req.body?.password;
    if(typeof username!=='string'||username.length>120||typeof password!=='string'||password.length>1024)return res.status(400).json({error:'Invalid login request'});
    let user;
    try{
      const result=await pool.query(
        `SELECT users.user_id,users.username,users.password_hash,users.is_active,roles.role_name
         FROM digital_twin.users users
         JOIN digital_twin.roles roles ON roles.role_id=users.role_id
         WHERE users.username=$1 LIMIT 1`,[username]);
      user=result.rows[0];
    }catch(e){
      console.error('Admin authentication database query failed:',e.message);
      return res.status(503).json({error:'Admin database unavailable. Check PostgreSQL and digital_twin schema.'});
    }
    const valid=!!user&&user.is_active!==false&&verifyPassword(password,user.password_hash);
    if(!valid){
      const prev=record?.until>now?record.count:0;
      attempts.set(ip,{count:prev+1,until:now+WINDOW_MS});
      return res.status(401).json({error:'Invalid credentials'});
    }
    attempts.delete(ip);
    const token=randomBytes(32).toString('hex');
    sessions.set(token,{username:user.username,userId:user.user_id,role:user.role_name,expires:now+SESSION_MS});
    res.setHeader('Set-Cookie',cookie(req,token,8*60*60));
    return res.json({authenticated:true,username:user.username,role:user.role_name});
  });
  // Every management write requires a fresh password. Authorization is one-use,
  // scoped to the exact HTTP method, path and request body, and expires in 60 seconds.
  app.post('/api/admin/confirm-password',requireAdmin,async(req,res)=>{
    const session=readSession(req);
    if(!session)return res.status(401).json({error:'Admin session expired'});
    const now=Date.now();
    if((session.confirmLockedUntil||0)>now)return res.status(429).json({error:'Too many attempts. Try again later.'});
    const {password,action}=req.body||{};
    if(typeof password!=='string'||password.length>1024)return res.status(400).json({error:'Admin password is required.'});
    if(!action||!['POST','PATCH','DELETE','PUT'].includes(action.method)||
      typeof action.path!=='string'||!action.path.startsWith('/api/admin/manage/')||
      action.path.length>512||action.path.includes('?')||action.path.includes('#')||
      action.body===undefined||typeof action.body!=='object'||action.body===null||Array.isArray(action.body))
      return res.status(400).json({error:'Invalid change request.'});
    try{
      const result=await pool.query('SELECT password_hash FROM digital_twin.users WHERE user_id=$1 AND is_active=TRUE',[session.userId]);
      if(!result.rowCount||!verifyPassword(password,result.rows[0].password_hash)){
        session.confirmFailures=(session.confirmFailures||0)+1;
        if(session.confirmFailures>=5){
          session.confirmLockedUntil=now+15*60*1000;
          session.confirmFailures=0;
        }
        return res.status(401).json({error:'Incorrect administrator password.'});
      }
      session.confirmFailures=0;
      session.confirmLockedUntil=0;
      const token=randomBytes(32).toString('hex');
      session.confirmation={
        tokenHash:createHash('sha256').update(token).digest('hex'),
        fingerprint:actionFingerprint(action.method,action.path,action.body),
        expires:now+60*1000
      };
      res.setHeader('Cache-Control','no-store');
      res.json({confirmed:true,authorization:token});
    }catch(e){
      console.error('Admin password confirmation unavailable:',e.message);
      res.status(503).json({error:'Unable to verify administrator password.'});
    }
  });
  app.get('/api/admin/session',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const session=readSession(req);
    if(!session)return res.json({authenticated:false,username:null,role:null});
    if(session.legacy)return res.json({authenticated:true,username:session.username,role:'admin',legacy:true});
    if(!pool)return res.json({authenticated:false,username:null,role:null});
    try{
      const result=await pool.query(
        'SELECT r.role_name,u.is_active FROM digital_twin.users u JOIN digital_twin.roles r USING(role_id) WHERE u.user_id=$1',
        [session.userId]
      );
      if(!result.rowCount||!result.rows[0].is_active){
        sessions.delete(parseCookie(req));
        res.setHeader('Set-Cookie',cookie(req,'',0));
        return res.json({authenticated:false,username:null,role:null});
      }
      session.role=result.rows[0].role_name;
      res.json({authenticated:true,username:session.username,role:session.role});
    }catch(e){
      console.error('Session validation failed:',e.message);
      res.status(503).json({authenticated:false,username:null,role:null,error:'Session database unavailable'});
    }
  });
  app.post('/api/admin/logout',(req,res)=>{
    sessions.delete(parseCookie(req));
    res.setHeader('Set-Cookie',cookie(req,'',0));
    res.json({authenticated:false});
  });
}
// All signed-in account roles may acknowledge an alert, but only active users.
export async function requireSignedIn(req,res,next) {
 const account=readSession(req);
 if(!account)return res.status(401).json({error:'Sign in to acknowledge alerts.'});
 if(!account.legacy){
  try{
   if(!authenticationPool)return res.status(503).json({error:'Authentication database unavailable'});
   const check=await authenticationPool.query(
    'SELECT u.username,r.role_name FROM digital_twin.users u JOIN digital_twin.roles r USING(role_id) WHERE u.user_id=$1 AND u.is_active=TRUE',
    [account.userId]
   );
   if(!check.rowCount)return res.status(403).json({error:'Account disabled or access revoked. Sign in again.'});
   account.role=check.rows[0].role_name;
  }catch(e){console.error('Account permission check failed:',e.message);return res.status(503).json({error:'Unable to verify account permissions'});}
 }
 const origin=req.get('origin'),host=req.get('host');
 if(origin&&host){
  try{if(new URL(origin).host!==host)return res.status(403).json({error:'Invalid origin'});}
  catch{return res.status(403).json({error:'Invalid origin'});}
 }
 req.account=account;
 next();
}
export async function requireAdmin(req,res,next) {
  const admin=readSession(req);
  if(!admin||admin.role!=='admin') return res.status(401).json({error:'Administrator login required'});
  // Revalidate privileges against PostgreSQL on each protected request.
  // Demoted accounts and deleted users lose admin access immediately.
  if(!admin.legacy){
   try{
     if(!authenticationPool)return res.status(503).json({error:'Authentication database unavailable'});
     const check=await authenticationPool.query(
       "SELECT 1 FROM digital_twin.users u JOIN digital_twin.roles r USING(role_id) WHERE u.user_id=$1 AND r.role_name='admin' AND u.is_active=TRUE",
       [admin.userId]
     );
     if(!check.rowCount)return res.status(403).json({error:'Administrator access revoked; sign in again'});
   }catch(e){console.error('Permission check failed:',e.message);return res.status(503).json({error:'Permission verification unavailable'});}
  }
  req.admin=admin;
  // Same-origin checks for authenticated API requests.
  const origin=req.get('origin');
  const host=req.get('host');
  if(origin && host) {
    try { const u=new URL(origin); const allowed = u.host===host || (process.env.NODE_ENV!=='production' && ['localhost','127.0.0.1'].includes(u.hostname) && ['5173','3001'].includes(u.port)); if(!allowed)return res.status(403).json({error:'Invalid origin'}); }
    catch { return res.status(403).json({error:'Invalid origin'}); }
  }
  next();
}

export function requireConfirmedAdmin(req,res,next){
 const session=readSession(req);
 if(!session||session.role!=='admin')return res.status(401).json({error:'Administrator session required'});
 const pending=session.confirmation;
 // Never leave a previous confirmation available after a write attempt.
 session.confirmation=null;
 const supplied=req.get('x-admin-confirmation')||'';
 if(!pending||pending.expires<=Date.now()||!/^[a-f0-9]{64}$/.test(supplied))
  return res.status(428).json({error:'Confirm your administrator password for this change.',requiresPassword:true});
 const actualHash=createHash('sha256').update(supplied).digest('hex');
 const tokenOK=timingSafeEqual(Buffer.from(pending.tokenHash,'hex'),Buffer.from(actualHash,'hex'));
 const actionOK=pending.fingerprint===actionFingerprint(req.method,req.path,req.body||{});
 if(!tokenOK||!actionOK)
  return res.status(428).json({error:'Password confirmation does not match this change. Please confirm again.',requiresPassword:true});
 next();
}
