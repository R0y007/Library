const crypto = require('node:crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;

function json(res, status, body, extra={}) {
  res.status(status).setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  Object.entries(extra).forEach(([k,v])=>res.setHeader(k,v));
  res.end(JSON.stringify(body));
}
function fail(res,status,msg){return json(res,status,{error:msg});}
function sha256(v){return crypto.createHash('sha256').update(v).digest('hex');}
function token(bytes=32){return crypto.randomBytes(bytes).toString('base64url');}
function now(){return new Date().toISOString();}
function hashPassword(password){const salt=crypto.randomBytes(16);const d=crypto.scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:128*1024*1024});return `scrypt$${salt.toString('base64url')}$${d.toString('base64url')}`;}
function verifyPassword(password,stored){try{const [,s,h]=String(stored).split('$');const salt=Buffer.from(s,'base64url');const expected=Buffer.from(h,'base64url');const actual=crypto.scryptSync(password,salt,expected.length,{N:16384,r:8,p:1,maxmem:128*1024*1024});return crypto.timingSafeEqual(actual,expected);}catch{return false;}}
function b64(v){return Buffer.from(v).toString('base64url');}
function signJwt(payload){const head=b64(JSON.stringify({alg:'HS256',typ:'JWT'}));const body=b64(JSON.stringify(payload));const sig=crypto.createHmac('sha256',SESSION_SECRET).update(`${head}.${body}`).digest('base64url');return `${head}.${body}.${sig}`;}
function verifyJwt(jwt){try{const [h,p,s]=String(jwt||'').split('.');if(!h||!p||!s)return null;const expected=crypto.createHmac('sha256',SESSION_SECRET).update(`${h}.${p}`).digest('base64url');if(!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected)))return null;const data=JSON.parse(Buffer.from(p,'base64url').toString());if(!data.exp||Date.now()>data.exp)return null;return data;}catch{return null;}}
function cookies(req){const out={};for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i<0)continue;out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());}return out;}
function setSession(res,jwt){res.setHeader('Set-Cookie',`avam_session=${encodeURIComponent(jwt)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`);}
function clearSession(res){res.setHeader('Set-Cookie','avam_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>100000)reject(new Error('Body too large'));});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch{reject(new Error('Invalid JSON'));}});});}
function clean(v,max=5000){return String(v??'').trim().slice(0,max);}
function certInput(x){
  const c={id:clean(x.id,40).toUpperCase(),status:clean(x.status,20),mechName:clean(x.mechName,120),owner:clean(x.owner,120),faction:clean(x.faction,120),dateIssued:clean(x.dateIssued,10),pvpTypes:clean(x.pvpTypes,300),combat:Number(x.combat),aesthetic:Number(x.aesthetic),technical:Number(x.technical),admin:Number(x.admin),notes:clean(x.notes,3000)};
  if(!/^AVAM-\d{4}-\d{4}$/.test(c.id))throw Error('Certificate ID must use AVAM-YYYY-NNNN format.');
  if(!['Active','Suspended','Revoked'].includes(c.status))throw Error('Invalid certificate status.');
  if(!c.mechName||!c.owner||!/^(\d{4})-(\d{2})-(\d{2})$/.test(c.dateIssued))throw Error('Name, owner, and a valid issue date are required.');
  for(const [k,max] of Object.entries({combat:15,aesthetic:10,technical:15,admin:5}))if(!Number.isInteger(c[k])||c[k]<0||c[k]>max)throw Error(`Invalid ${k} score.`);
  return c;
}
function publicCert(r){return {id:r.id,status:r.status,mechName:r.mech_name,owner:r.owner,faction:r.faction,dateIssued:r.date_issued,pvpTypes:r.pvp_types,combat:r.combat,aesthetic:r.aesthetic,technical:r.technical,admin:r.admin,revokedMessage:r.status==='Revoked'?'This certificate has been revoked and is no longer valid.':null};}
function adminCert(r){return {...publicCert(r),notes:r.notes,createdAt:r.created_at,updatedAt:r.updated_at};}
async function sb(path, opts={}){
  if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY)throw Error('Supabase environment variables are not configured.');
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{...opts,headers:{apikey:SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation',...(opts.headers||{})}});
  const text=await r.text();let data={};try{data=text?JSON.parse(text):{};}catch{}
  if(!r.ok)throw Error(data.message||data.hint||data.error||'Database request failed.');return data;
}
async function getAdmin(){const rows=await sb('admins?select=id,password_hash,password_version&limit=1');return rows[0]||null;}
async function auth(req,res,requireCsrf=true){const jwt=verifyJwt(cookies(req).avam_session);if(!jwt)return null;const admin=await getAdmin();if(!admin||admin.password_version!==jwt.pv)return null;if(requireCsrf){const csrf=req.headers['x-csrf-token'];if(!csrf||csrf!==jwt.csrf)return null;}return jwt;}
async function publicVerify(res,id){const safe=clean(id,40).toUpperCase();const rows=await sb(`certificates?id=eq.${encodeURIComponent(safe)}&select=*`);if(!rows.length)return fail(res,404,'Certificate ID not found.');return json(res,200,{certificate:publicCert(rows[0])});}

module.exports=async(req,res)=>{
  if(req.method==='OPTIONS')return json(res,204,{});
  const path=(req.url||'').split('?')[0].replace(/^\/api\/?/,'').replace(/\/$/,'');
  try{
    if(!SESSION_SECRET)return fail(res,500,'Server is not configured.');
    if(path.startsWith('verify/'))return publicVerify(res,path.slice(7));

    if(path==='admin/login'&&req.method==='POST'){
      const b=await body(req);const password=String(b.password||'');
      const admin=await getAdmin();
      if(!admin||!verifyPassword(password,admin.password_hash))return fail(res,401,'Invalid password.');
      const csrf=token(24);const jwt=signJwt({sub:'admin',pv:admin.password_version,csrf,exp:Date.now()+28800000});setSession(res,jwt);return json(res,200,{ok:true,csrfToken:csrf});
    }
    if(path==='admin/logout'&&req.method==='POST'){clearSession(res);return json(res,200,{ok:true});}
    if(path==='admin/me'&&req.method==='GET'){const jwt=await auth(req,res,false);if(!jwt)return fail(res,401,'Authentication required.');return json(res,200,{authenticated:true,csrfToken:jwt.csrf});}
    const jwt=await auth(req,res,true);if(!jwt)return fail(res,401,'Authentication required.');
    if(path==='admin/certificates'&&req.method==='GET'){
      const rows=await sb('certificates?select=*&order=date_issued.desc,id.desc');return json(res,200,{certificates:rows.map(adminCert)});
    }
    if(path==='admin/certificates'&&req.method==='POST'){
      const c=certInput(await body(req));const t=now();const rows=await sb('certificates',{method:'POST',body:JSON.stringify({id:c.id,status:c.status,mech_name:c.mechName,owner:c.owner,faction:c.faction,date_issued:c.dateIssued,pvp_types:c.pvpTypes,combat:c.combat,aesthetic:c.aesthetic,technical:c.technical,admin:c.admin,notes:c.notes,created_at:t,updated_at:t})});return json(res,201,{certificate:adminCert(rows[0])});
    }
    if(path.startsWith('admin/certificates/')&&req.method==='PUT'){
      const id=decodeURIComponent(path.slice('admin/certificates/'.length));const c=certInput({...await body(req),id});const rows=await sb(`certificates?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status:c.status,mech_name:c.mechName,owner:c.owner,faction:c.faction,date_issued:c.dateIssued,pvp_types:c.pvpTypes,combat:c.combat,aesthetic:c.aesthetic,technical:c.technical,admin:c.admin,notes:c.notes,updated_at:now()})});if(!rows.length)return fail(res,404,'Certificate not found.');return json(res,200,{certificate:adminCert(rows[0])});
    }
    if(path.startsWith('admin/certificates/')&&req.method==='DELETE'){
      const id=decodeURIComponent(path.slice('admin/certificates/'.length));const rows=await sb(`certificates?id=eq.${encodeURIComponent(id)}`,{method:'DELETE'});if(!rows.length)return fail(res,404,'Certificate not found.');return json(res,200,{ok:true});
    }
    if(path==='admin/change-password'&&req.method==='POST'){
      const b=await body(req);const current=String(b.currentPassword||'');const next=String(b.newPassword||'');if(next.length<8||next.length>200)return fail(res,400,'New password must be 8–200 characters.');const admin=await getAdmin();if(!admin||!verifyPassword(current,admin.password_hash))return fail(res,401,'Current password is incorrect.');await sb(`admins?id=eq.${admin.id}`,{method:'PATCH',body:JSON.stringify({password_hash:hashPassword(next),password_version:admin.password_version+1,updated_at:now()})});clearSession(res);return json(res,200,{ok:true,message:'Password changed. Please sign in again.'});
    }
    return fail(res,404,'Not found.');
  }catch(e){console.error(e);return fail(res,400,e.message||'Request failed.');}
};
