import {ensureProductionSchema,formatMartiniqueTime} from '../_lib/store.js';
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')}
function empty(){return new Response('',{status:200,headers:{'content-type':'text/xml; charset=utf-8','cache-control':'no-store'}})}
async function ticketXml(db,job){
 const o=await db.prepare(`SELECT id,customer_name,total_cents,created_at,estimated_ready_at,notes FROM orders WHERE id=?`).bind(job.order_id).first();
 if(!o)return '';
 const {results:items}=await db.prepare(`SELECT product_name,quantity,options_json FROM order_items WHERE order_id=? ORDER BY id`).bind(job.order_id).all();
 const lines=items.map(i=>{let x={};try{x=JSON.parse(i.options_json||'{}')}catch{};const opt=[x.size_label,x.dough_type==='fine'?'PATE FINE':x.dough_type==='epaisse'?'PATE EPAISSE':'',x.promotion_label].filter(Boolean).join(' - ');return `${i.quantity} x ${esc(i.product_name)}${opt?' / '+esc(opt):''}\n`}).join('');
 const total=(Number(o.total_cents||0)/100).toFixed(2).replace('.',',')+' EUR';
 const ordered=formatMartiniqueTime(o.created_at),ready=o.estimated_ready_at?formatMartiniqueTime(o.estimated_ready_at):'';
 return `<?xml version="1.0" encoding="utf-8"?>
<PrintRequestInfo Version="2.00"><ePOSPrint><Parameter><devid>local_printer</devid><timeout>10000</timeout><printjobid>PP${job.id}</printjobid></Parameter><PrintData>
<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
<text align="center"/><text em="true" width="2" height="2"/><text>PLANET PIZZA\n</text>
<text width="1" height="1"/><text>106 ROUTE DES RELIGIEUSES\n0596 71 74 78\n</text><feed unit="12"/>
<text em="true" width="2" height="2"/><text>COMMANDE ${esc(String(o.id).slice(-6))}\n</text>
<text width="1" height="1"/><text>Client: ${esc(o.customer_name)}\n</text>
<text em="true" width="2" height="2"/><text>HEURE ${esc(ordered)}\n</text>
${ready?`<text>PRET ESTIME ${esc(ready)}\n</text>`:''}<text width="1" height="1"/><feed unit="10"/>
<text align="left"/><text>${lines}</text><feed unit="10"/><text em="true"/><text>TOTAL ${esc(total)}\n</text>
${o.notes?`<text em="false"/><text>NOTE: ${esc(o.notes)}\n</text>`:''}<feed unit="20"/><cut type="feed"/>
</epos-print></PrintData></ePOSPrint></PrintRequestInfo>`;
}
export async function onRequest(context){
 if(context.request.method!=='POST')return new Response('Method not allowed',{status:405});
 const db=context.env.DB;await ensureProductionSchema(db);
 const raw=await context.request.text();const p=new URLSearchParams(raw);
 const id=p.get('ID')||'';
 if(!context.env.EPSON_PRINTER_ID||id!==context.env.EPSON_PRINTER_ID)return new Response('Forbidden',{status:403});
 const type=p.get('ConnectionType');
 if(type==='GetRequest'){
  const job=await db.prepare(`SELECT id,order_id FROM print_jobs WHERE status='pending' ORDER BY id LIMIT 1`).first();
  if(!job)return empty();
  const xml=await ticketXml(db,job);if(!xml)return empty();
  await db.prepare(`UPDATE print_jobs SET status='sent',printer_id=?,attempts=attempts+1,sent_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id,job.id).run();
  return new Response(xml,{headers:{'content-type':'text/xml; charset=utf-8','cache-control':'no-store'}});
 }
 if(type==='SetResponse'){
  const response=p.get('ResponseFile')||'';const m=response.match(/printjobid[^>]*>(?:PP)?(\d+)/i);const jobId=m?Number(m[1]):null;
  const success=/success\s*=\s*["']true["']/i.test(response)||/success\s*=\s*["']1["']/i.test(response);
  if(jobId){
   await db.prepare(`UPDATE print_jobs SET status=?,printed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE printed_at END,last_error=? WHERE id=?`).bind(success?'printed':'error',success?1:0,success?null:'Réponse Epson en erreur',jobId).run();
   if(success){const job=await db.prepare(`SELECT order_id FROM print_jobs WHERE id=?`).bind(jobId).first();if(job)await db.prepare(`UPDATE orders SET printed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(job.order_id).run();}
  }
  return empty();
 }
 return empty();
}
