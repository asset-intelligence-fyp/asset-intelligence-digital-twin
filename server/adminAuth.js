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
  const secure = process.env.NODE_ENV === 'production' || req.secure;
  return `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
export function adminAuth(app) {
  app.post('/api/admin/login',(req,res)=>{
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = attempts.get(ip);
    if(record && record.until > now && record.count >= MAX_ATTEMPTS) return res.status(429).json({error:'Too many login attempts. Try again later.'});
    const name = process.env.ADMIN_USERNAME;
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if(!name || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash||'')) return res.status(503).json({error:'Admin login is not configured on this computer. Run npm run admin:setup, then restart npm run dev.'});
    const valid = typeof req.body?.username === 'string' && req.body.username === name && verifyPassword(req.body?.password,hash);
    if(!valid) {
      const prev = record?.until > now ? record.count : 0;
      attempts.set(ip,{count:prev+1,until:now+WINDOW_MS});
      return res.status(401).json({error:'Invalid credentials'});
    }
    attempts.delete(ip);
    const token=randomBytes(32).toString('hex');
    sessions.set(token,{username:name,expires:now+SESSION_MS});
    res.setHeader('Set-Cookie',cookie(req,token,8*60*60));
    return res.json({authenticated:true,username:name});
  });
  app.get('/api/admin/session',(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const session=readSession(req);
    res.json({authenticated:!!session,username:session?.username||null});
  });
  app.post('/api/admin/logout',(req,res)=>{
    sessions.delete(parseCookie(req));
    res.setHeader('Set-Cookie',cookie(req,'',0));
    res.json({authenticated:false});
  });
}
export function requireAdmin(req,res,next) {
  if(!readSession(req)) return res.status(401).json({error:'Admin login required'});
  // Same-origin checks for authenticated API requests.
  const origin=req.get('origin');
  const host=req.get('host');
  if(origin && host) {
    try { const u=new URL(origin); const allowed = u.host===host || (process.env.NODE_ENV!=='production' && ['localhost','127.0.0.1'].includes(u.hostname) && ['5173','3001'].includes(u.port)); if(!allowed)return res.status(403).json({error:'Invalid origin'}); }
    catch { return res.status(403).json({error:'Invalid origin'}); }
  }
  next();
}
