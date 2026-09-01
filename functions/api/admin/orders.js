import { json, body, getRecipeRequirements } from '../_lib/db.js';

const ALLOWED = new Set(['new','confirmed','preparing','ready','completed','cancelled']);
const CONSUME_AT = new Set(['confirmed','preparing','ready','completed']);

async function applyStock(db, orderId, direction, reason) {
  const requirements = await getRecipeRequirements({ DB: db }, orderId);
  if (!requirements.length) return { ok:true, changed:false };
  if (direction < 0) {
    const insufficient = requirements.filter(r => Number(r.stock_qty) < Number(r.required_qty));
    if (insufficient.length) return { ok:false, insufficient };
  }
  const now = new Date().toISOString();
  const statements = [];
  for (const r of requirements) {
    const delta = Number(r.required_qty) * direction;
    statements.push(db.prepare(`UPDATE ingredients SET quantity=?,updated_at=? WHERE id=?`).bind(Number(r.stock_qty)+delta,now,r.ingredient_id));
    statements.push(db.prepare(`INSERT INTO inventory_movements (ingredient_id,quantity_delta,reason,order_id,created_at) VALUES (?,?,?,?,?)`).bind(r.ingredient_id,delta,reason,orderId,now));
  }
  await db.batch(statements);
  return { ok:true,changed:true };
}

export async function onRequest(context) {
  const db=context.env.DB;
  if(context.request.method==='GET'){
    const {results}=await db.prepare(`SELECT id,customer_name,customer_phone,fulfillment_type,total_cents,status,payment_status,notes,created_at,updated_at FROM orders ORDER BY created_at DESC LIMIT 100`).all();
    return json({orders:results});
  }
  if(context.request.method!=='PATCH') return json({error:'Méthode non autorisée'},405,{Allow:'GET, PATCH'});
  const input=await body(context.request);
  if(!input.id||!ALLOWED.has(input.status)) return json({error:'Commande ou statut invalide'},400);

  const order=await db.prepare(`SELECT id,status FROM orders WHERE id=?`).bind(input.id).first();
  if(!order) return json({error:'Commande introuvable'},404);
  if(order.status===input.status) return json({ok:true,stock:'unchanged'});

  const consumed=await db.prepare(`SELECT 1 FROM inventory_movements WHERE order_id=? AND reason='order_consumption' LIMIT 1`).bind(input.id).first();
  const shouldConsume=CONSUME_AT.has(input.status);
  const wasConsumed=Boolean(consumed);

  if(shouldConsume&&!wasConsumed){
    const result=await applyStock(db,input.id,-1,'order_consumption');
    if(!result.ok) return json({error:'Stock insuffisant pour préparer cette commande',insufficient:result.insufficient.map(x=>({ingredient_id:x.ingredient_id,name:x.name,stock:Number(x.stock_qty),required:Number(x.required_qty)}))},409);
  }

  if(input.status==='cancelled'&&wasConsumed){
    await applyStock(db,input.id,1,'order_restoration');
  }

  const result=await db.prepare(`UPDATE orders SET status=?,updated_at=? WHERE id=?`).bind(input.status,new Date().toISOString(),input.id).run();
  if(!result.meta.changes) return json({error:'Commande introuvable'},404);
  return json({ok:true,stock:input.status==='cancelled'&&wasConsumed?'restored':shouldConsume&&!wasConsumed?'deducted':'unchanged'});
}
