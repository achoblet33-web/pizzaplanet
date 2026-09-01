import { json, body } from '../_lib/db.js';

const ALLOWED = new Set(['new','confirmed','preparing','ready','completed','cancelled']);
const ACTIVE_ORDERING = `CASE status
 WHEN 'new' THEN 0
 WHEN 'confirmed' THEN 1
 WHEN 'preparing' THEN 2
 WHEN 'ready' THEN 3
 WHEN 'completed' THEN 4
 WHEN 'cancelled' THEN 5
 ELSE 6 END, created_at DESC`;

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
  const where=archive?`datetime(created_at) < datetime('now','-48 hours')`:`datetime(created_at) >= datetime('now','-48 hours')`;
  const orderBy=archive?'created_at DESC':ACTIVE_ORDERING;
  const {results}=await db.prepare(`SELECT id,customer_name,customer_phone,customer_email,fulfillment_type,total_cents,status,payment_status,notes,stock_deducted,created_at,updated_at FROM orders WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).bind(limit,offset).all();
  const countRow=await db.prepare(`SELECT COUNT(*) total FROM orders WHERE ${where}`).first();
  const total=Number(countRow?.total||0);
  const orders=await attachItems(db,results);
  return json({orders,total,page,limit,has_more:offset+orders.length<total,archive});
 }
 if(context.request.method!=='PATCH')return json({error:'Méthode non autorisée'},405,{Allow:'GET, PATCH'});
 const input=await body(context.request);
 if(!input.id||!ALLOWED.has(input.status))return json({error:'Commande ou statut invalide'},400);
 const order=await db.prepare(`SELECT id,status,payment_status,stock_deducted FROM orders WHERE id=?`).bind(input.id).first();
 if(!order)return json({error:'Commande introuvable'},404);
 if(order.status===input.status)return json({ok:true,stock:'unchanged'});
 if(input.status!=='cancelled' && order.payment_status!=='paid')return json({error:'Cette commande doit être payée avant d’être confirmée/préparée.'},409);
 if(input.status==='cancelled' && Number(order.stock_deducted)===1)return json({error:'Pour éviter une incohérence de stock, l’annulation après consommation doit être traitée par le flux de remboursement Stripe.'},409);
 const result=await db.prepare(`UPDATE orders SET status=?,updated_at=? WHERE id=?`).bind(input.status,new Date().toISOString(),input.id).run();
 if(!result.meta.changes)return json({error:'Commande introuvable'},404);
 return json({ok:true,stock:'unchanged'});
}
