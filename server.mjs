import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const production=process.env.NODE_ENV==='production';
const dataDir=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
if(process.env.RENDER==='true'&&!process.env.DATA_DIR)throw new Error('Set DATA_DIR to the Render persistent disk mount path.');
mkdirSync(dataDir,{recursive:true});
const db=new DatabaseSync(path.join(dataDir,'planner.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,name TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS responses(person TEXT NOT NULL REFERENCES people(id),week TEXT NOT NULL,days TEXT NOT NULL,note TEXT NOT NULL,updated TEXT NOT NULL,PRIMARY KEY(person,week));
CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,invite TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_users(id TEXT PRIMARY KEY,email TEXT NOT NULL,password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth_limits(id TEXT PRIMARY KEY,bucket INTEGER NOT NULL,count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS used_recovery(token_hash TEXT PRIMARY KEY);
PRAGMA user_version=1;`);
const cookieName=production?'__Host-team-admin':'team-admin';
const sessionSeconds=7*24*3600;
const scrypt=promisify(scryptCallback);
let hashing=0;
const token=()=>randomBytes(32).toString('hex');
const digest=s=>createHash('sha256').update(s).digest('hex');
const equal=(a,b)=>timingSafeEqual(Buffer.from(digest(a),'hex'),Buffer.from(digest(b),'hex'));
class AppError extends Error{constructor(status,message){super(message);this.status=status}}
const fail=(status,message)=>{throw new AppError(status,message)};
function send(res,data,status=200,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data))}
function getCookie(req){const values=(req.headers.cookie||'').split(';').map(s=>s.trim());return values.find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||''}
function cookie(value,age=sessionSeconds){return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${production?'; Secure':''}`}
function isAdmin(req){const value=getCookie(req);if(!/^[a-f0-9]{64}$/.test(value))return false;return !!db.prepare('SELECT 1 FROM admin_sessions WHERE token_hash=? AND expires>?').get(digest(value),Date.now())}
function requireAdmin(req){if(!isAdmin(req))fail(401,'Log in als beheerder.')}
function createSession(){const value=token();db.prepare('DELETE FROM admin_sessions WHERE expires<=?').run(Date.now());db.prepare('INSERT INTO admin_sessions VALUES(?,?)').run(digest(value),Date.now()+sessionSeconds*1000);return value}
function rateLimit(key,limit,windowMs=15*60*1000){const bucket=Math.floor(Date.now()/windowMs);const r=db.prepare('INSERT INTO auth_limits(id,bucket,count) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN bucket=excluded.bucket THEN count+1 ELSE 1 END,bucket=excluded.bucket RETURNING count').get(key,bucket);if(r.count>limit)fail(429,'Te veel pogingen. Probeer het over 15 minuten opnieuw.')}
function validPassword(value){return typeof value==='string'&&value.length>=12&&value.length<=128}
async function passwordHash(value,salt=randomBytes(16).toString('hex')){if(hashing>=2)fail(429,'Er wordt al ingelogd. Probeer het over enkele seconden opnieuw.');hashing++;try{const key=await scrypt(value,salt,64,{N:65536,r:8,p:2,maxmem:128*1024*1024});return `scrypt:${salt}:${key.toString('hex')}`}finally{hashing--}}
async function passwordMatches(value,stored){const [method,salt]=stored.split(':');if(method!=='scrypt'||!salt)return false;return equal(await passwordHash(value,salt),stored)}
function person(req){const raw=(req.headers.authorization||'').replace(/^Bearer /,'');if(!/^[a-f0-9]{64}$/.test(raw))fail(401,'Open je persoonlijke link of uitnodigingslink.');const p=db.prepare('SELECT id,name FROM people WHERE id=?').get(digest(raw));if(!p)fail(401,'Deze persoonlijke link is niet geldig.');return p}
function validWeek(w){if(typeof w!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(w))return false;const d=new Date(w+'T12:00:00Z');return !isNaN(+d)&&d.toISOString().slice(0,10)===w&&d.getUTCDay()===1&&+w.slice(0,4)>=2025&&+w.slice(0,4)<=2100}
function validDays(days){return Array.isArray(days)&&days.length===7&&days.every(d=>d&&['yes','no','unknown'].includes(d.status)&&Array.isArray(d.slots)&&d.slots.length<=6&&(d.status!=='yes'||d.slots.length>0)&&d.slots.every((s,i)=>s&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end)&&s.start<s.end&&(i===0||d.slots[i-1].end<=s.start)))}
async function body(req){if(!(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Ongeldig verzoek.');const origin=req.headers.origin;const configured=process.env.APP_ORIGIN||process.env.RENDER_EXTERNAL_URL;const expected=configured?new URL(configured).origin:`${production?'https':'http'}://${req.headers.host}`;if(origin&&origin!==expected)fail(403,'Verzoek vanaf een andere website geweigerd.');let raw='';for await(const chunk of req){raw+=chunk.toString();if(Buffer.byteLength(raw)>20000)fail(413,'Invoer te groot.')}try{return JSON.parse(raw)}catch{fail(400,'Ongeldige invoer.')}}
async function auth(req,res,url){
 if(req.method==='GET'){return send(res,{authenticated:isAdmin(req),configured:!!db.prepare("SELECT 1 FROM admin_users WHERE id='main'").get()})}
 if(req.method!=='POST')fail(405,'Niet toegestaan.');
 const b=await body(req);
 if(b.action==='logout'){const value=getCookie(req);db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(digest(value));return send(res,{ok:true},200,{'Set-Cookie':cookie('',0)})}
 if(!['login','setup','reset','password'].includes(b.action))fail(400,'Onbekende actie.');
 rateLimit('admin-auth',30);
 const user=db.prepare("SELECT * FROM admin_users WHERE id='main'").get();
 if(b.action==='setup'||b.action==='reset'){
  const expected=process.env[b.action==='setup'?'ADMIN_SETUP_TOKEN':'ADMIN_RECOVERY_TOKEN']||'';
  if(expected.length<32||typeof b.code!=='string'||!equal(b.code,expected))fail(403,'De instel- of herstelcode is niet geldig.');
  if(b.action==='setup'&&user)fail(409,'De beheerder is al ingesteld. Log in met je e-mailadres en wachtwoord.');
  if(b.action==='reset'&&(!user||db.prepare('SELECT 1 FROM used_recovery WHERE token_hash=?').get(digest(expected))))fail(403,'De herstelcode is niet beschikbaar. Maak een nieuwe code aan in je hostinginstellingen.');
  if(!validPassword(b.password))fail(400,'Kies een wachtwoord van 12 tot 128 tekens.');
  const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
  if(b.action==='setup'&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254))fail(400,'Vul een geldig e-mailadres in.');
  const hash=await passwordHash(b.password);
  db.exec('BEGIN IMMEDIATE');try{if(b.action==='setup'){const result=db.prepare("INSERT OR IGNORE INTO admin_users VALUES('main',?,?)").run(email,hash);if(result.changes!==1)fail(409,'De beheerder is al ingesteld.')}else{const claimed=db.prepare('INSERT OR IGNORE INTO used_recovery VALUES(?)').run(digest(expected));if(claimed.changes!==1)fail(403,'Deze herstelcode is al gebruikt.');db.prepare("UPDATE admin_users SET password_hash=? WHERE id='main'").run(hash);db.prepare('DELETE FROM admin_sessions').run()}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  return send(res,{ok:true},200,{'Set-Cookie':cookie(createSession())});
 }
 if(b.action==='password'){requireAdmin(req);if(typeof b.currentPassword!=='string'||b.currentPassword.length>128||!await passwordMatches(b.currentPassword,user.password_hash))fail(403,'Het huidige wachtwoord klopt niet.');if(!validPassword(b.password))fail(400,'Kies een wachtwoord van 12 tot 128 tekens.');const hash=await passwordHash(b.password);if(!isAdmin(req)||db.prepare("SELECT password_hash FROM admin_users WHERE id='main'").get()?.password_hash!==user.password_hash)fail(409,'Je sessie is gewijzigd. Log opnieuw in.');db.exec('BEGIN IMMEDIATE');try{db.prepare("UPDATE admin_users SET password_hash=? WHERE id='main'").run(hash);db.prepare('DELETE FROM admin_sessions').run();db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return send(res,{ok:true},200,{'Set-Cookie':cookie(createSession())})}
 const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(typeof b.password!=='string'||b.password.length>128)fail(401,'E-mailadres of wachtwoord klopt niet.');
 // Always perform the password calculation, including for an unknown email.
 const matches=user?await passwordMatches(b.password,user.password_hash):(await passwordHash(b.password),false);
 if(!user||!equal(email,user.email)||!matches||db.prepare("SELECT password_hash FROM admin_users WHERE id='main'").get()?.password_hash!==user.password_hash)fail(401,'E-mailadres of wachtwoord klopt niet.');
 return send(res,{ok:true},200,{'Set-Cookie':cookie(createSession())});
}
async function planner(req,res,url){
 if(req.method==='GET'){
  const week=url.searchParams.get('week');if(!validWeek(week))fail(400,'Kies een geldige week.');
  if(url.searchParams.get('view')==='admin'){requireAdmin(req);const rows=db.prepare('SELECT p.id,p.name,r.days,r.note,r.updated FROM people p LEFT JOIN responses r ON r.person=p.id AND r.week=? ORDER BY p.name COLLATE NOCASE').all(week);return send(res,{people:rows.map(r=>({...r,days:r.days?JSON.parse(r.days):null})),invite:db.prepare("SELECT invite FROM settings WHERE id='main'").get()?.invite||null})}
  const p=person(req);const r=db.prepare('SELECT days,note,updated FROM responses WHERE person=? AND week=?').get(p.id,week);return send(res,{name:p.name,response:r?{...r,days:JSON.parse(r.days)}:null});
 }
 if(req.method!=='POST')fail(405,'Niet toegestaan.');const b=await body(req);
 if(b.action==='invite'){requireAdmin(req);db.prepare("INSERT OR IGNORE INTO settings VALUES('main',?)").run(token());return send(res,db.prepare("SELECT invite FROM settings WHERE id='main'").get())}
 if(b.action==='join'){rateLimit('join',100);const setting=db.prepare("SELECT invite FROM settings WHERE id='main'").get();if(typeof b.invite!=='string'||!setting||!equal(setting.invite,b.invite))fail(403,'Deze uitnodigingslink is niet geldig.');if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>80)fail(400,'Vul je naam in (maximaal 80 tekens).');const value=token();db.prepare('INSERT INTO people VALUES(?,?,?)').run(digest(value),b.name.trim(),new Date().toISOString());return send(res,{token:value,name:b.name.trim()})}
 if(b.action==='save'){const p=person(req);if(!validWeek(b.week)||!validDays(b.days)||typeof b.note!=='string'||b.note.length>500)fail(400,'Controleer je tijden: eindtijd na begintijd, op volgorde en zonder overlap. Verdeel een nachtdienst over twee dagen.');const days=b.days.map(d=>({status:d.status,slots:d.status==='yes'?d.slots.map(s=>({start:s.start,end:s.end})):[]}));const updated=new Date().toISOString();db.prepare('INSERT INTO responses VALUES(?,?,?,?,?) ON CONFLICT(person,week) DO UPDATE SET days=excluded.days,note=excluded.note,updated=excluded.updated').run(p.id,b.week,JSON.stringify(days),b.note.trim(),updated);return send(res,{updated})}
 fail(400,'Onbekende actie.');
}
function backup(req,res){requireAdmin(req);if(req.method!=='GET')fail(405,'Niet toegestaan.');const data={format:'teamplanner-backup-v1',created:new Date().toISOString(),people:db.prepare('SELECT * FROM people').all(),responses:db.prepare('SELECT * FROM responses').all(),settings:db.prepare('SELECT * FROM settings').all()};send(res,data,200,{'Content-Disposition':`attachment; filename="teamplanner-backup-${new Date().toISOString().slice(0,10)}.json"`})}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
function serve(req,res,url){if(!['GET','HEAD'].includes(req.method))fail(405,'Niet toegestaan.');const directory=path.join(root,'dist');let filename=path.resolve(directory,'.'+decodeURIComponent(url.pathname));if(!filename.startsWith(directory+path.sep)&&filename!==directory)fail(404,'Niet gevonden.');try{if(!statSync(filename).isFile())filename=path.join(directory,'index.html')}catch{if(path.extname(filename))fail(404,'Niet gevonden.');filename=path.join(directory,'index.html')};const data=readFileSync(filename);res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':filename.endsWith('index.html')?'no-cache':'public, max-age=31536000, immutable','Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data)}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
 try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/health'){db.prepare('SELECT 1').get();return send(res,{ok:true})}if(url.pathname==='/api/admin')return await auth(req,res,url);if(url.pathname==='/api/planner')return await planner(req,res,url);if(url.pathname==='/api/backup')return backup(req,res);if(url.pathname.startsWith('/api/'))fail(404,'Niet gevonden.');serve(req,res,url)}catch(e){if(!res.headersSent)send(res,{error:e instanceof AppError?e.message:'Er ging iets mis. Probeer het opnieuw.'},e.status||500);else res.end();if(!(e instanceof AppError))console.error('Request failed:',e.name)}
});
server.requestTimeout=30000;server.headersTimeout=15000;
server.listen(Number(process.env.PORT)||3000,process.env.HOST||'0.0.0.0',()=>console.log(`Teamplanner listening on port ${Number(process.env.PORT)||3000}`));
function stop(){server.close(()=>{db.close();process.exit(0)});setTimeout(()=>process.exit(1),10000).unref()}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
