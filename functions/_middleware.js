function unauthorized(message='Authentification administrateur requise',status=401){
  return new Response(message,{status,headers:{'WWW-Authenticate':'Basic realm="Planet Pizza Administration", charset="UTF-8"','Cache-Control':'no-store'}});
}
function decodeBasic(header){
  if(!header||!header.startsWith('Basic ')) return null;
  try{
    const raw=atob(header.slice(6));
    const i=raw.indexOf(':');
    return i>=0?{user:raw.slice(0,i),password:raw.slice(i+1)}:null;
  }catch{return null}
}
async function same(a,b){
  const e=new TextEncoder();
  const [ha,hb]=await Promise.all([crypto.subtle.digest('SHA-256',e.encode(String(a||''))),crypto.subtle.digest('SHA-256',e.encode(String(b||'')))]);
  const x=new Uint8Array(ha),y=new Uint8Array(hb); let d=0;
  for(let i=0;i<x.length;i++) d|=x[i]^y[i];
  return d===0;
}
export async function onRequest(context){
  const path=new URL(context.request.url).pathname;
  const protectedPath=path==='/admin.html'||path.startsWith('/api/admin/');
  if(!protectedPath) return context.next();
  if(!context.env.ADMIN_PASSWORD) return unauthorized('Administration non configurée côté serveur',503);
  const credentials=decodeBasic(context.request.headers.get('Authorization'));
  const expectedUser=context.env.ADMIN_USER||'admin';
  if(!credentials || !(await same(credentials.user,expectedUser)) || !(await same(credentials.password,context.env.ADMIN_PASSWORD))) return unauthorized();
  if(context.request.method!=='GET'&&context.request.method!=='HEAD'){
    const origin=context.request.headers.get('Origin');
    const own=new URL(context.request.url).origin;
    if(origin&&origin!==own) return new Response('Origine refusée',{status:403});
  }
  return context.next();
}