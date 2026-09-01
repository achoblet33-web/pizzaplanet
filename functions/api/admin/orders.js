import { json, body } from '../_lib/db.js';

const ALLOWED = new Set(['new','confirmed','preparing','ready','completed','cancelled']);

export async function onRequest(context){
 const db=context.env.DB;
 if(context.request.method==='GET'){
  const {results}=await db.prepare(`SELECT id,customer_name,customer_phone,customer_email,fulfillment_type,total_cents,status,payment_status,notes,stock_deducted,created_at,updated_at FROM orders ORDER BY created_at DESC LIMIT 100`).all();
  if(!results.length)return json({orders:[]});
  const ids=results.map(o=>o.id);
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
  return json({orders:results.map(o=>({...o,items:byOrder.get(String(o.id))||[]}))});
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
