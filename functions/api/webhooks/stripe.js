import {json} from '../_lib/db.js';
import {recordStatusEvent} from '../_lib/tracking.js';
import {ensureProductionSchema} from '../_lib/store.js';
const TOLERANCE_SECONDS=300;
function hexToBytes(hex){const out=new Uint8Array(hex.length/2);for(let i=0;i<out.length;i++)out[i]=parseInt(hex.slice(i*2,i*2+2),16);return out}
function constantTimeEqual(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0}
async function sign(secret,payload){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload)))}
async function verify(request,secret,raw){const h=request.headers.get('stripe-signature');if(!h)return false;const parts=h.split(','),t=Number(parts.find(x=>x.startsWith('t='))?.slice(2)),sigs=parts.filter(x=>x.startsWith('v1=')).map(x=>x.slice(3));if(!Number.isFinite(t)||!sigs.length||Math.abs(Math.floor(Date.now()/1000)-t)>TOLERANCE_SECONDS)return false;const expected=await sign(secret,`${t}.${raw}`);return sigs.some(v=>constantTimeEqual(expected,hexToBytes(v)))}
function key(d,s){return `${d}:${s}`}
async function consumeDough(db,orderId){
 await ensureProductionSchema(db);
 const order=await db.prepare(`SELECT id,stock_deducted,payment_status,status FROM orders WHERE id=?`).bind(orderId).first();
 if(!order)return {ok:false,error:'Commande introuvable'};
 if(Number(order.stock_deducted)===1)return {ok:true,changed:false}
 if(order.payment_status!=='paid')return {ok:false,error:'Paiement non confirmé'};
 const {results:items}=await db.prepare(`SELECT quantity,options_json FROM order_items WHERE order_id=?`).bind(orderId).all();
 const need=new Map();
 for(const item of items){let o={};try{o=JSON.parse(item.options_json||'{}')}catch{};if(!o.dough_type||!o.size_code)continue;const k=key(o.dough_type,o.size_code);need.set(k,(need.get(k)||0)+Number(item.quantity||0))}
 const {results:stocks}=await db.prepare(`SELECT id,dough_type,size_code,quantity,configured FROM dough_stock`).all();
 const insufficient=[];const statements=[];const now=new Date().toISOString();
 for(const s of stocks){const qty=need.get(key(s.dough_type,s.size_code))||0;if(!qty)continue;if(Number(s.configured)===1&&Number(s.quantity)<qty)insufficient.push({dough_type:s.dough_type,size_code:s.size_code,stock:Number(s.quantity),required:qty});else if(Number(s.configured)===1)statements.push(db.prepare(`UPDATE dough_stock SET quantity=quantity-?,updated_at=? WHERE id=? AND quantity>=?`).bind(qty,now,s.id,qty))}
 if(insufficient.length)return {ok:false,error:'Stock de pâte insuffisant après paiement',insufficient};
 statements.push(db.prepare(`UPDATE orders SET stock_deducted=1,status='preparing',updated_at=? WHERE id=? AND stock_deducted=0`).bind(now,orderId));
 await db.batch(statements);
 try{await recordStatusEvent(db,orderId,'confirmed',now,'stripe');await recordStatusEvent(db,orderId,'preparing',now,'system')}catch{}
 return {ok:true,changed:true};
}
export async function onRequest(context){
 if(context.request.method!=='POST')return json({error:'Méthode non autorisée'},405,{Allow:'POST'});
 if(!context.env.STRIPE_WEBHOOK_SECRET)return json({error:'Webhook Stripe non configuré'},503);
 const raw=await context.request.text();if(!(await verify(context.request,context.env.STRIPE_WEBHOOK_SECRET,raw)))return json({error:'Signature Stripe invalide'},400);
 let event;try{event=JSON.parse(raw)}catch{return json({error:'Payload JSON invalide'},400)}
 await ensureProductionSchema(context.env.DB);
 const ins=await context.env.DB.prepare(`INSERT OR IGNORE INTO stripe_events(event_id,event_type,status) VALUES(?,?,?)`).bind(event.id,event.type,'received').run();if(!ins.meta.changes)return json({received:true,duplicate:true});
 try{
  const session=event.data?.object,orderId=session?.metadata?.order_id||session?.client_reference_id;
  if(orderId&&(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded')){
   const paid=session.payment_status==='paid'||event.type==='checkout.session.async_payment_succeeded';
   if(paid){await context.env.DB.prepare(`UPDATE orders SET payment_status='paid',updated_at=? WHERE id=?`).bind(new Date().toISOString(),orderId).run();const stock=await consumeDough(context.env.DB,orderId);if(!stock.ok){await context.env.DB.prepare(`UPDATE stripe_events SET status='stock_error',processed_at=? WHERE event_id=?`).bind(new Date().toISOString(),event.id).run();return json({received:true,warning:stock.error,insufficient:stock.insufficient||[]})}}
  }else if(orderId&&event.type==='checkout.session.async_payment_failed'){const now=new Date().toISOString();await context.env.DB.prepare(`UPDATE orders SET payment_status='failed',status='cancelled',updated_at=? WHERE id=?`).bind(now,orderId).run();try{await recordStatusEvent(context.env.DB,orderId,'cancelled',now,'stripe')}catch{}}
  await context.env.DB.prepare(`UPDATE stripe_events SET status='processed',processed_at=? WHERE event_id=?`).bind(new Date().toISOString(),event.id).run();return json({received:true});
 }catch(e){await context.env.DB.prepare(`UPDATE stripe_events SET status='error',processed_at=? WHERE event_id=?`).bind(new Date().toISOString(),event.id).run();return json({error:'Erreur traitement webhook'},500)}
}
