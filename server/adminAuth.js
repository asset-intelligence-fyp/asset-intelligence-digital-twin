import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';

const sessions = new Map();
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
function cookie(req, value, maxAge) {
  const secure = req.secure || req.headers['x-forwarded-proto']==='https';
  return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
export function adminAuth(app,pool=null,schema='digital_twin') {
  app.post('/api/admin/login',async(req,res)=>{
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = attempts.get(ip);
    if(record && record.until > now && record.count >= MAX_ATTEMPTS) return res.status(429).json({error:'Too many login attempts. Try again later.'});
    if(!pool||schema!=='digital_twin')return res.status(503).json({error:'Admin login requires the configured digital_twin PostgreSQL database.'});
    const username=req.body?.username,password=req.body?.password;
    if(typeof username!=='string'||username.length>120||typeof password!=='string'||password.length>1024)return res.status(400).json({error:'Invalid login request'});
    let user;
    try{
      const result=await pool.query(
        `SELECT users.user_id,users.username,users.password_hash,roles.role_name
         FROM digital_twin.users users
         JOIN digital_twin.roles roles ON roles.role_id=users.role_id
         WHERE users.username=$1 LIMIT 1`,[username]);
      user=result.rows[0];
    }catch(e){
      console.error('Admin authentication database query failed:',e.message);
      return res.status(503).json({error:'Admin database unavailable. Check PostgreSQL and digital_twin schema.'});
    }
    const valid=!!user&&verifyPassword(password,user.password_hash);
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
  app.get('/api/admin/session',(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const session=readSession(req);
    res.json({authenticated:!!session,username:session?.username||null,role:session?.role||null});
  });
  app.post('/api/admin/logout',(req,res)=>{
    sessions.delete(parseCookie(req));
    res.setHeader('Set-Cookie',cookie(req,'',0));
    res.json({authenticated:false});
  });
}
export function requireAdmin(req,res,next) {
  const admin=readSession(req);
  if(!admin||admin.role!=='admin') return res.status(401).json({error:'Administrator login required'});
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
