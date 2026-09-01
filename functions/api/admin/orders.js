import { json, body } from '../_lib/db.js';
import { recordStatusEvent } from '../_lib/tracking.js';

const ALLOWED = new Set(['new','confirmed','preparing','ready','completed','cancelled']);
const ACTIVE_ORDERING = `CASE status
 WHEN 'confirmed' THEN 0
 WHEN 'preparing' THEN 1
 WHEN 'ready' THEN 2
 WHEN 'new' THEN 3
 WHEN 'completed' THEN 4
 WHEN 'cancelled' THEN 5
 ELSE 6 END, created_at ASC`;
const ARCHIVE_AFTER_MS = 48 * 60 * 60 * 1000;
const FORWARD_TRANSITIONS = { confirmed: 'preparing', preparing: 'ready', ready: 'completed' };

async function attachItems(db, orders){
 if(!orders.length)return [];
 const ids=orders.map(o=>o.id);
 const placeholders=ids.map(()=>'?').join(',');
 const {results:items}=await db.prepare(`SELECT id,order_id,product_id,product_name,quantity,unit_price_cents,options_json FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`).bind(...ids).all();
 const byOrder=new Map();
 for(const item of items){
  let options={};
  try{options=JSON.parse(item.options_json||'{}')}catch{}
  const orderId=String(item.order_id);
  if(!byOrder.has(orderId))byOrder.set(orderId,[]);
  byOrder.get(orderId).push({...item,options});
 }
 return orders.map(o=>({...o,items:byOrder.get(String(o.id))||[]}));
}

export async function onRequest(context){
 const db=context.env.DB;
 if(context.request.method==='GET'){
  const url=new URL(context.request.url);
  const archive=url.searchParams.get('archive')==='1';
  const requested=Number(url.searchParams.get('limit'));
  const limit=archive?Math.min(100,Math.max(10,requested||50)):Math.min(250,Math.max(50,requested||250));
  const page=Math.max(1,Number(url.searchParams.get('page'))||1);
  const offset=(page-1)*limit;
  const cutoffId=(Date.now()-ARCHIVE_AFTER_MS)*1000;
  const operator=archive?'<':'>=';
  const orderBy=archive?'created_at DESC':ACTIVE_ORDERING;
  const fetchLimit=limit+1;
  const {results:rawResults}=await db.prepare(`SELECT id,customer_name,customer_phone,customer_email,fulfillment_type,total_cents,status,payment_status,notes,stock_deducted,created_at,updated_at FROM orders WHERE id ${operator} ? ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(cutoffId,fetchLimit,offset).all();
  const hasMore=rawResults.length>limit;
  const results=hasMore?rawResults.slice(0,limit):rawResults;
  const orders=await attachItems(db,results);
  return json({orders,page,limit,has_more:hasMore,archive});
 }
 if(context.request.method!=='PATCH')return json({error:'Méthode non autorisée'},405,{Allow:'GET, PATCH'});
 const input=await body(context.request);
 if(!input.id||!ALLOWED.has(input.status))return json({error:'Commande ou statut invalide'},400);
 const order=await db.prepare(`SELECT id,status,payment_status,stock_deducted FROM orders WHERE id=?`).bind(input.id).first();
 if(!order)return json({error:'Commande introuvable'},404);
 if(order.status===input.status)return json({ok:true,stock:'unchanged'});
 if(input.status!=='cancelled' && order.payment_status!=='paid')return json({error:'Cette commande doit être payée avant d’être prise en charge.'},409);
 if(input.status==='cancelled' && Number(order.stock_deducted)===1)return json({error:'Pour éviter une incohérence de stock, l’annulation après paiement doit être traitée par le flux de remboursement Stripe.'},409);
 if(input.status!=='cancelled' && FORWARD_TRANSITIONS[order.status]!==input.status){
  return json({error:'Transition invalide. Parcours attendu : prise en charge → prête → remise au client.'},409);
 }
 const now=new Date().toISOString();
 const result=await db.prepare(`UPDATE orders SET status=?,updated_at=? WHERE id=?`).bind(input.status,now,input.id).run();
 if(!result.meta.changes)return json({error:'Commande introuvable'},404);
 try{await recordStatusEvent(db,input.id,input.status,now,'restaurant')}catch{}
 return json({ok:true,stock:'unchanged',status:input.status,updated_at:now});
}
