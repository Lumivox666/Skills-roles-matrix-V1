/**
 * TCG Machines — Skills & Roles Matrix
 * Flat, dependency-free Railway / local Node.js host.
 * Persistent state is written only to the attached Railway volume.
 * Shared-password gateway is intended for an internal pilot, NOT a granular permissions system.
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = __dirname;
const IS_RAILWAY = !!(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_ENVIRONMENT_ID);
const VOLUME = process.env.RAILWAY_VOLUME_MOUNT_PATH;
const DATA_DIR = path.resolve(VOLUME || process.env.DATA_DIR || path.join(ROOT, 'data'));
const STATE_PATH = path.join(DATA_DIR, 'tcg_matrix_data.json');
const PREVIOUS_PATH = path.join(DATA_DIR, 'tcg_matrix_previous.json');
const SEED_PATH = path.join(ROOT, 'tcg_matrix_seed.json');
const MAX_BODY = 4 * 1024 * 1024;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || (process.env.APP_PASSWORD ? '0.0.0.0' : '127.0.0.1');
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;
const COOKIE_NAME = 'tcg_session';
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be a valid TCP port');
if (IS_RAILWAY && !VOLUME) {
  console.error('Railway volume NOT attached. Attach a volume, e.g. at /app/data, before starting.');
  console.error('Refusing to write employee qualifications to disposable deployment storage.');
  process.exit(1);
}
if (IS_RAILWAY && APP_PASSWORD.length < 12) {
  console.error('APP_PASSWORD is required on Railway and must contain at least 12 characters.');
  console.error('Set it in Railway -> Service -> Variables. Never commit it to GitHub.');
  process.exit(1);
}
if (!IS_RAILWAY && !APP_PASSWORD) console.warn('Local-only preview: no APP_PASSWORD. Server will bind to loopback only.');

try {
  fs.mkdirSync(DATA_DIR, {recursive:true});
  fs.accessSync(DATA_DIR, fs.constants.W_OK | fs.constants.R_OK);
  if (!fs.existsSync(STATE_PATH)) {
    const seed = fs.readFileSync(SEED_PATH, 'utf8');
    JSON.parse(seed); // Fail loudly if the packaged seed is invalid.
    fs.writeFileSync(STATE_PATH,seed,{encoding:'utf8',flag:'wx'});
    console.log('Created a fresh matrix from the 137-skill seed in the persistent storage directory.');
  }
} catch (error) {
  console.error('Unable to access the persistent data directory:',DATA_DIR,error.message);
  console.error('Check Railway volume mount path and filesystem permissions.');
  process.exit(1);
}
let state;
try { state = JSON.parse(fs.readFileSync(STATE_PATH,'utf8')); }
catch(error) { console.error('Could not load existing state; refusing to reset it:',error.message);process.exit(1); }
function valid(s) {
  return !!(s && s.version === 1 && Array.isArray(s.skills) && s.skills.length <= 10000 &&
    Array.isArray(s.roles) && s.roles.length <= 10000 &&
    Array.isArray(s.employees) && s.employees.length <= 2000 &&
    s.awards && typeof s.awards === 'object' && !Array.isArray(s.awards) &&
    Array.isArray(s.trainingRequests) && Array.isArray(s.audit));
}
if (!valid(state)) { console.error('Invalid existing state; refusing to overwrite it. Restore from a backup.');process.exit(1); }
const revision = s => crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex').slice(0,24);
let currentRevision = revision(state);
let lastDailyBackup = '';
const failedLogins = new Map();

function headers(extra={}) {return {...securityHeaders,...extra};}
function sendJson(res,status,obj,extra={}) {
  res.writeHead(status,headers({'Content-Type':'application/json; charset=utf-8',...extra}));
  res.end(JSON.stringify(obj));
}
function error(res,status,message) {sendJson(res,status,{error:message});}
function secureCompare(a,b) {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x,y);
}
function sign(payload) {
  const p=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
  const mac=crypto.createHmac('sha256',SESSION_SECRET).update(p).digest('base64url');
  return p+'.'+mac;
}
function isAuthorized(req) {
  if (!APP_PASSWORD) return !IS_RAILWAY && (req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '::ffff:127.0.0.1');
  const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(v=>{
    const i=v.indexOf('=');return i<0?['','']:[v.slice(0,i).trim(),v.slice(i+1).trim()];
  }));
  const token=cookies[COOKIE_NAME]||'';
  const parts=token.split('.');
  if(parts.length!==2 || parts[0].length>200 || parts[1].length>100)return false;
  const expected=crypto.createHmac('sha256',SESSION_SECRET).update(parts[0]).digest('base64url');
  const b1=Buffer.from(expected),b2=Buffer.from(parts[1]);
  if(b1.length!==b2.length || !crypto.timingSafeEqual(b1,b2))return false;
  try {
    const s=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    return s.exp > Date.now() && s.exp < Date.now()+SESSION_MAX_AGE_S*1000+60000;
  } catch {return false;}
}
function secureCookie(req) {
  // Railway public domains use HTTPS terminated at the edge proxy.
  return !!(IS_RAILWAY || process.env.NODE_ENV==='production' || req.headers['x-forwarded-proto']==='https');
}
function setCookie(res,req,token,maxAge) {
  res.setHeader('Set-Cookie',`${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie(req)?'; Secure':''}`);
}
function originAllowed(req) {
  const origin=req.headers.origin;
  if(!origin)return true; // Nonbrowser CLI requests do not include Origin.
  try {return new URL(origin).host.toLowerCase()===String(req.headers.host||'').toLowerCase();}
  catch{return false;}
}
function readJsonBody(req,res,callback) {
  if(!String(req.headers['content-type']||'').startsWith('application/json'))return error(res,415,'JSON required');
  let raw='',exceeded=false;
  req.on('data',chunk=>{raw+=chunk;if(Buffer.byteLength(raw,'utf8')>MAX_BODY){exceeded=true;error(res,413,'Request too large');req.pause();}});
  req.on('end',()=>{
    if(exceeded)return;
    let value;try{value=JSON.parse(raw)}catch{return error(res,400,'Invalid JSON')}
    callback(value);
  });
  req.on('error',err=>console.error('Request upload failed:',err.message));
}
function saveState(next) {
  // All paths are on the SAME filesystem: atomic rename protects the primary state file.
  const today=new Date().toISOString().slice(0,10);
  if(today!==lastDailyBackup) {
    const backupDir=path.join(DATA_DIR,'backups');
    fs.mkdirSync(backupDir,{recursive:true});
    const dailyPath=path.join(backupDir,`matrix-${today}.json`);
    if(!fs.existsSync(dailyPath))fs.copyFileSync(STATE_PATH,dailyPath);
    lastDailyBackup=today;
    const backups=fs.readdirSync(backupDir).filter(x=>/^matrix-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort();
    for(const old of backups.slice(0,Math.max(0,backups.length-14)))fs.unlinkSync(path.join(backupDir,old));
  }
  fs.copyFileSync(STATE_PATH,PREVIOUS_PATH);
  const temp=STATE_PATH+'.'+process.pid+'.tmp';
  try {
    fs.writeFileSync(temp,JSON.stringify(next,null,2),'utf8');
    fs.renameSync(temp,STATE_PATH);
  } finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
const LOGIN_HTML=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TCG Machines | Sign in</title><link rel="icon" href="/TCG_Machines_Icon.png"><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 20% 10%,#372316,#101112 55%);font:15px/1.5 system-ui,-apple-system,Segoe UI,Arial;color:#eee}.panel{width:min(430px,100%);background:#1a1c1e;border:1px solid #484747;border-top:4px solid #ff881f;border-radius:14px;padding:30px;box-shadow:0 25px 90px #0009}img{max-width:260px;display:block;margin:0 auto 25px}h1{font-size:21px;margin:0 0 5px}p{color:#bbb;margin:0 0 24px}label{display:block;font-weight:600;margin-bottom:9px}input{display:block;width:100%;background:#101214;border:1px solid #676767;border-radius:7px;padding:12px 14px;font:inherit;color:#fff}input:focus{outline:2px solid #ff881f;border-color:transparent}button{width:100%;margin-top:14px;background:#ff881f;color:#1b120a;border:0;padding:12px;border-radius:7px;font:inherit;font-weight:800;cursor:pointer}button:disabled{opacity:.55}#error{color:#ffb2a5;min-height:22px;margin-top:12px;font-size:13px}small{display:block;margin-top:20px;color:#888}</style></head><body><main class="panel"><img alt="TCG Machines" src="/TCG_Machines_Logo.png"><h1>Skills &amp; Roles Matrix</h1><p>Production training · qualifications · role assignments</p><form id="login"><label for="password">Team access password</label><input id="password" type="password" required autocomplete="current-password" autofocus><button id="submit">Sign in</button><div id="error" role="alert"></div></form><small>Authorized TCG team members only.</small></main><script>document.getElementById('login').addEventListener('submit',async e=>{e.preventDefault();const b=document.getElementById('submit'),m=document.getElementById('error');b.disabled=true;m.textContent='';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value})});if(!r.ok){m.textContent=r.status===429?'Too many attempts. Try again in a few minutes.':'Incorrect password.';return;}location.reload();}catch{m.textContent='Could not contact the server.';}finally{b.disabled=false;}});</script></body></html>`;

function file(res,filepath,contentType) {
  res.writeHead(200,headers({'Content-Type':contentType}));
  fs.createReadStream(filepath).on('error',()=>res.destroy()).pipe(res);
}
const server=http.createServer((req,res)=>{
  let pathname;
  try{pathname=new URL(req.url,'http://localhost').pathname;}catch{return error(res,400,'Bad path');}
  if(req.method==='GET' && (pathname==='/api/health'||pathname==='/health')) {
    // Readiness verifies that the persistent volume is writable rather than merely that HTTP started.
    try{fs.accessSync(DATA_DIR,fs.constants.R_OK|fs.constants.W_OK);return sendJson(res,200,{status:'ok',app:'tcg-skills-roles',version:'1.3.0'});}
    catch{return error(res,503,'Data volume not accessible');}
  }
  if(req.method==='GET' && pathname==='/TCG_Machines_Logo.png')return file(res,path.join(ROOT,'TCG_Machines_Logo.png'),'image/png');
  if(req.method==='GET' && pathname==='/TCG_Machines_Icon.png')return file(res,path.join(ROOT,'TCG_Machines_Icon.png'),'image/png');
  if(req.method==='POST' && pathname==='/api/login') {
    if(!APP_PASSWORD)return error(res,400,'Login disabled in local loopback preview');
    if(!originAllowed(req))return error(res,403,'Origin mismatch');
    const ip=req.socket.remoteAddress||'unknown';
    const now=Date.now(),entry=failedLogins.get(ip)||{attempts:0,until:now+15*60*1000};
    if(now>entry.until){entry.attempts=0;entry.until=now+15*60*1000;}
    if(entry.attempts>=10)return error(res,429,'Too many attempts; please try later');
    return readJsonBody(req,res,value=>{
      if(typeof value?.password!=='string'||!secureCompare(value.password,APP_PASSWORD)){
        entry.attempts++;failedLogins.set(ip,entry);return error(res,401,'Incorrect password');
      }
      failedLogins.delete(ip);
      setCookie(res,req,sign({exp:Date.now()+SESSION_MAX_AGE_S*1000}),SESSION_MAX_AGE_S);
      return sendJson(res,200,{ok:true});
    });
  }
  if(req.method==='GET' && pathname==='/logout') {
    setCookie(res,req,'',0);res.writeHead(303,headers({Location:'/'}));return res.end();
  }
  if(!isAuthorized(req)) {
    if(req.method==='GET' && (pathname==='/'||pathname==='/index.html'||pathname==='/login')) {
      res.writeHead(200,headers({'Content-Type':'text/html; charset=utf-8'}));return res.end(LOGIN_HTML);
    }
    return error(res,401,'Sign in required');
  }
  if(req.method==='GET' && (pathname==='/'||pathname==='/index.html'))return file(res,path.join(ROOT,'index.html'),'text/html; charset=utf-8');
  if(req.method==='GET' && pathname==='/api/state')return sendJson(res,200,{revision:currentRevision,state});
  if(req.method==='GET' && pathname==='/api/seed')return sendJson(res,200,JSON.parse(fs.readFileSync(SEED_PATH,'utf8')));
  if(req.method==='GET' && pathname==='/api/backup') {
    res.writeHead(200,headers({'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="TCG_Skills_Matrix_Backup.json"'}));
    return res.end(JSON.stringify(state,null,2));
  }
  if(req.method==='PUT' && pathname==='/api/state') {
    if(!originAllowed(req))return error(res,403,'Cross-origin update denied');
    return readJsonBody(req,res,value=>{
      if(value?.revision!==currentRevision)return error(res,409,'Another device has updated the matrix; export your draft and refresh.');
      if(!valid(value?.state))return error(res,422,'Invalid matrix format');
      try{
        saveState(value.state);
        state=value.state;currentRevision=revision(state);
      }catch(err){console.error('Save failed:',err.message);return error(res,500,'Could not write to persistent volume');}
      return sendJson(res,200,{revision:currentRevision,saved:true});
    });
  }
  return error(res,404,'Not found');
});
server.on('error',error=>{console.error('TCG server could not start:',error.message);process.exit(1);});
server.listen(PORT,HOST,()=>{
  console.log('TCG Machines Skills & Roles Matrix v1.3');
  console.log('Persistent data directory:',DATA_DIR);
  console.log('Open: http://localhost:'+PORT);
  if(HOST==='0.0.0.0')for(const entries of Object.values(os.networkInterfaces()))for(const addr of entries||[])if(addr.family==='IPv4'&&!addr.internal)console.log('LAN: http://'+addr.address+':'+PORT);
  console.log('TV dashboard: /#tv | Health: /api/health');
  console.log(APP_PASSWORD?'Password gate enabled':'LOCAL LOOPBACK ONLY — no password gate');
  if(!process.env.SESSION_SECRET && APP_PASSWORD)console.log('Tip: set SESSION_SECRET for logins to survive restarts.');
});
