import {ensureProductionSchema,formatMartiniqueTime} from '../_lib/store.js';

function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function xmlText(v){return esc(v).replace(/\r?\n/g,'&#10;')}
function empty(){return new Response('',{status:200,headers:{'content-type':'text/xml; charset=utf-8','cache-control':'no-store'}})}
async function same(a,b){
 const e=new TextEncoder();
 const [ha,hb]=await Promise.all([crypto.subtle.digest('SHA-256',e.encode(String(a||''))),crypto.subtle.digest('SHA-256',e.encode(String(b||'')))]);
 const x=new Uint8Array(ha),y=new Uint8Array(hb);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0;
}
async function heartbeat(db,id,result=null,error=null){
 const now=new Date().toISOString();
 await db.prepare(`INSERT INTO printer_state(printer_id,last_seen_at,last_result_at,last_success,last_error,updated_at)
 VALUES(?,?,?,?,?,?)
 ON CONFLICT(printer_id) DO UPDATE SET
 last_seen_at=excluded.last_seen_at,
 last_result_at=COALESCE(excluded.last_result_at,printer_state.last_result_at),
 last_success=COALESCE(excluded.last_success,printer_state.last_success),
 last_error=CASE WHEN excluded.last_result_at IS NULL THEN printer_state.last_error ELSE excluded.last_error END,
 updated_at=excluded.updated_at`).bind(id,now,result===null?null:now,result===null?null:(result?1:0),result===null?null:error,now).run();
}
function orderCode(id){const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let n=BigInt(String(id))%BigInt(A.length**4),o='';for(let i=0;i<4;i++){o=A[Number(n%BigInt(A.length))]+o;n/=BigInt(A.length)}return o}
async function ticketXml(db,job,deviceId){
 const o=await db.prepare(`SELECT id,customer_name,customer_phone,total_cents,created_at,estimated_ready_at,notes FROM orders WHERE id=? AND payment_status='paid'`).bind(job.order_id).first();
 if(!o)return '';
 const {results:items}=await db.prepare(`SELECT product_name,quantity,options_json FROM order_items WHERE order_id=? ORDER BY id`).bind(job.order_id).all();
 const itemXml=items.map(i=>{
   let x={};try{x=JSON.parse(i.options_json||'{}')}catch{}
   const meta=[x.size_label,x.dough_type==='fine'?'PATE FINE':x.dough_type==='epaisse'?'PATE EPAISSE':'',x.promotion_label].filter(Boolean).join(' - ');
   return `<text em="true">${xmlText(i.quantity+' x '+i.product_name)}&#10;</text>${meta?`<text>${xmlText(meta)}&#10;</text>`:''}`;
 }).join('');
 const total=(Number(o.total_cents||0)/100).toFixed(2).replace('.',',')+' EUR';
 const ordered=formatMartiniqueTime(o.created_at),ready=o.estimated_ready_at?formatMartiniqueTime(o.estimated_ready_at):'';
 return `<?xml version="1.0" encoding="utf-8"?>
<PrintRequestInfo Version="2.00">
<ePOSPrint>
<Parameter><devid>${esc(deviceId)}</devid><timeout>10000</timeout><printjobid>PP_${job.id}</printjobid></Parameter>
<PrintData>
<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
<text align="center"/><text smooth="true"/><text em="true" width="2" height="2"/><text>PLANET PIZZA&#10;</text>
<text width="1" height="1" em="false"/><text>106 ROUTE DES RELIGIEUSES&#10;0596 71 74 78&#10;</text>
<feed unit="12"/>
<text em="true" width="2" height="2"/><text>COMMANDE ${esc(orderCode(o.id))}&#10;</text>
<text width="1" height="1"/><text>CLIENT: ${xmlText(o.customer_name)}&#10;</text>
${o.customer_phone?`<text>TEL: ${xmlText(o.customer_phone)}&#10;</text>`:''}
<feed unit="8"/>
<text em="true" width="2" height="2"/><text>HEURE ${esc(ordered)}&#10;</text>
${ready?`<text width="1" height="1">RETRAIT ESTIME ${esc(ready)}&#10;</text>`:''}
<feed unit="12"/><text align="left"/><text width="1" height="1" em="false"/>
${itemXml}
<feed unit="12"/><text em="true" width="2" height="1"/><text>TOTAL ${esc(total)}&#10;</text>
${o.notes?`<text width="1" height="1" em="false">NOTE: ${xmlText(o.notes)}&#10;</text>`:''}
<feed line="3"/><cut type="feed"/>
</epos-print>
</PrintData>
</ePOSPrint>
</PrintRequestInfo>`;
}
export async function onRequest(context){
 if(context.request.method!=='POST')return new Response('Method not allowed',{status:405});
 const db=context.env.DB;await ensureProductionSchema(db);
 const url=new URL(context.request.url);
 const expectedToken=context.env.EPSON_SDP_TOKEN||'';
 const suppliedToken=url.searchParams.get('token')||'';
 if(!expectedToken||!(await same(expectedToken,suppliedToken)))return new Response('Forbidden',{status:403});
 let form;
 try{form=await context.request.formData()}catch{return new Response('Bad Request',{status:400})}
 const id=String(form.get('ID')||form.get('Name')||'');
 const expectedId=context.env.EPSON_PRINTER_ID||'';
 if(!expectedId||!(await same(expectedId,id)))return new Response('Forbidden',{status:403});
 const type=String(form.get('ConnectionType')||'');
 await heartbeat(db,id);
 if(type==='GetRequest'){
   const retryBefore=new Date(Date.now()-2*60*1000).toISOString();
   const job=await db.prepare(`SELECT id,order_id,status,sent_at FROM print_jobs
     WHERE status='pending' OR status='error' OR (status='sent' AND (sent_at IS NULL OR sent_at<?))
     ORDER BY id LIMIT 1`).bind(retryBefore).first();
   if(!job)return empty();
   const xml=await ticketXml(db,job,context.env.EPSON_DEVICE_ID||'local_printer');
   if(!xml)return empty();
   await db.prepare(`UPDATE print_jobs SET status='sent',printer_id=?,attempts=attempts+1,sent_at=?,last_error=NULL WHERE id=?`).bind(id,new Date().toISOString(),job.id).run();
   return new Response(xml,{status:200,headers:{'content-type':'text/xml; charset=utf-8','cache-control':'no-store'}});
 }
 if(type==='SetResponse'){
   const response=String(form.get('ResponseFile')||'');
   const m=response.match(/<printjobid>\s*PP_(\d+)\s*<\/printjobid>/i);
   const jobId=m?Number(m[1]):null;
   const success=/success\s*=\s*["']true["']/i.test(response)||/success\s*=\s*["']1["']/i.test(response);
   const code=response.match(/code\s*=\s*["']([^"']*)["']/i)?.[1]||'';
   if(jobId){
     if(success){
       const now=new Date().toISOString();
       await db.prepare(`UPDATE print_jobs SET status='printed',printed_at=?,last_error=NULL WHERE id=?`).bind(now,jobId).run();
       const job=await db.prepare(`SELECT order_id FROM print_jobs WHERE id=?`).bind(jobId).first();
       if(job)await db.prepare(`UPDATE orders SET printed_at=? WHERE id=?`).bind(now,job.order_id).run();
     }else{
       await db.prepare(`UPDATE print_jobs SET status='error',last_error=? WHERE id=?`).bind(code||'Erreur Epson',jobId).run();
     }
   }
   await heartbeat(db,id,success,success?null:(code||'Erreur Epson'));
   return empty();
 }
 return empty();
}
