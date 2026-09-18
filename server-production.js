import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const PORT=Number(process.env.PORT||8080);
const DB_PATH=process.env.DB_PATH||path.join(__dirname,'planet-pizza.sqlite');
fs.mkdirSync(path.dirname(DB_PATH),{recursive:true});

const sqlite=new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

function initDatabase(){
  const schema=fs.readFileSync(path.join(__dirname,'data','schema.sql'),'utf8');
  sqlite.exec(schema);
  const row=sqlite.prepare('SELECT COUNT(*) c FROM restaurants').get();
  if(!row?.c){
    const seed=fs.readFileSync(path.join(__dirname,'data','seed.sql'),'utf8');
    sqlite.exec(seed);
  }
}
initDatabase();

class Prepared{
  constructor(sql,args=[]){this.sql=sql;this.args=args}
  bind(...args){return new Prepared(this.sql,args)}
  all(){const rows=sqlite.prepare(this.sql).all(...this.args);return Promise.resolve({results:rows})}
  first(){return Promise.resolve(sqlite.prepare(this.sql).get(...this.args)??null)}
  run(){
    const info=sqlite.prepare(this.sql).run(...this.args);
    return Promise.resolve({meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}})
  }
}
const DB={
  prepare(sql){return new Prepared(sql)},
  async batch(statements){
    const tx=sqlite.transaction((items)=>items.map(item=>{
      const info=sqlite.prepare(item.sql).run(...item.args);
      return {meta:{changes:Number(info.changes||0),last_row_id:Number(info.lastInsertRowid||0)}};
    }));
    return tx(statements);
  }
};

const API_MODULES={
  '/api/products':'functions/api/products.js',
  '/api/checkout':'functions/api/checkout.js',
  '/api/orders':'functions/api/orders.js',
  '/api/service-status':'functions/api/service-status.js',
  '/api/track':'functions/api/track.js',
  '/api/push/config':'functions/api/push/config.js',
  '/api/push/subscribe':'functions/api/push/subscribe.js',
  '/api/webhooks/stripe':'functions/api/webhooks/stripe.js',
  '/api/admin/orders':'functions/api/admin/orders.js',
  '/api/admin/stocks':'functions/api/admin/stocks.js',
  '/api/admin/settings':'functions/api/admin/settings.js',
  '/api/admin/catalog':'functions/api/admin/catalog.js'
};

const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
function securityHeaders(extra={}){return {'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'SAMEORIGIN','permissions-policy':'camera=(), microphone=(), geolocation=()',...extra}}
function sendNode(res,status,headers,body){res.writeHead(status,securityHeaders(headers));if(body==null)return res.end();if(Buffer.isBuffer(body)||typeof body==='string')return res.end(body);return res.end(String(body))}
function basicAuthorized(req){const expectedUser=process.env.ADMIN_USER||'admin',expectedPass=process.env.ADMIN_PASSWORD||'';if(!expectedPass)return {ok:false,status:503,message:'Administration non configurée'};const h=req.headers.authorization||'';if(!h.startsWith('Basic '))return {ok:false,status:401,message:'Authentification requise'};try{const raw=Buffer.from(h.slice(6),'base64').toString('utf8'),i=raw.indexOf(':'),user=raw.slice(0,i),pass=raw.slice(i+1);const ok=user===expectedUser&&pass===expectedPass;return ok?{ok:true}:{ok:false,status:401,message:'Identifiants invalides'}}catch{return {ok:false,status:401,message:'Authentification requise'}}}
async function nodeRequest(req,origin){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?Buffer.concat(chunks):undefined;const headers=new Headers();for(const [k,v] of Object.entries(req.headers)){if(Array.isArray(v))v.forEach(x=>headers.append(k,x));else if(v!=null)headers.set(k,String(v))}const init={method:req.method,headers};if(body&&req.method!=='GET'&&req.method!=='HEAD')init.body=body;return new Request(origin+req.url,init)}
async function handleApi(req,res,url){const modulePath=API_MODULES[url.pathname];if(!modulePath)return false;if(url.pathname.startsWith('/api/admin/')){const a=basicAuthorized(req);if(!a.ok)return sendNode(res,a.status,{'content-type':'application/json; charset=utf-8','www-authenticate':'Basic realm="Planet Pizza Administration"'},JSON.stringify({error:a.message}));if(req.method!=='GET'&&req.method!=='HEAD'){const origin=req.headers.origin;if(origin&&origin!==`${url.protocol}//${url.host}`){sendNode(res,403,{'content-type':'application/json'},JSON.stringify({error:'Origine refusée'}));return true;}}}
  const request=await nodeRequest(req,`${url.protocol}//${url.host}`),waiters=[];const env={DB,STRIPE_SECRET_KEY:process.env.STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET:process.env.STRIPE_WEBHOOK_SECRET,VAPID_PUBLIC_KEY:process.env.VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY:process.env.VAPID_PRIVATE_KEY,VAPID_SUBJECT:process.env.VAPID_SUBJECT,ADMIN_USER:process.env.ADMIN_USER,ADMIN_PASSWORD:process.env.ADMIN_PASSWORD};try{const mod=await import(pathToFileURL(path.join(__dirname,modulePath)).href);const response=await mod.onRequest({request,env,waitUntil:p=>waiters.push(Promise.resolve(p))});Promise.allSettled(waiters).catch(()=>{});const headers={};response.headers.forEach((v,k)=>headers[k]=v);sendNode(res,response.status,headers,Buffer.from(await response.arrayBuffer()))}catch(err){console.error('API error',url.pathname,err);sendNode(res,500,{'content-type':'application/json; charset=utf-8'},JSON.stringify({error:'Erreur serveur'}))}return true}
function serveStatic(req,res,url){let pathname=decodeURIComponent(url.pathname);if(pathname==='/')pathname='/index.html';if(pathname==='/admin')pathname='/admin.html';if(pathname==='/commander')pathname='/customer.html';if(pathname==='/suivi')pathname='/suivi.html';if(pathname==='/admin.html'){const a=basicAuthorized(req);if(!a.ok)return sendNode(res,a.status,{'content-type':'text/plain; charset=utf-8','www-authenticate':'Basic realm="Planet Pizza Administration"'},a.message)}const safe=path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/,'');const file=path.join(__dirname,safe);if(!file.startsWith(__dirname))return sendNode(res,403,{'content-type':'text/plain'},'Forbidden');if(!fs.existsSync(file)||!fs.statSync(file).isFile())return sendNode(res,404,{'content-type':'text/plain; charset=utf-8'},'Page introuvable');const ext=path.extname(file).toLowerCase(),cache=ext==='.html'?'no-store':ext==='.jpg'||ext==='.png'?'public, max-age=86400':'public, max-age=300';sendNode(res,200,{'content-type':MIME[ext]||'application/octet-stream','cache-control':cache},fs.readFileSync(file))}
const server=http.createServer(async(req,res)=>{const proto=(req.headers['x-forwarded-proto']||'https').split(',')[0].trim(),host=req.headers.host||'localhost',url=new URL(req.url,`${proto}://${host}`);if(url.pathname==='/health')return sendNode(res,200,{'content-type':'application/json'},JSON.stringify({ok:true,service:'planet-pizza-production'}));if(await handleApi(req,res,url))return;serveStatic(req,res,url)});
server.listen(PORT,'0.0.0.0',()=>console.log(`Planet Pizza production listening on ${PORT} · DB ${DB_PATH}`));
