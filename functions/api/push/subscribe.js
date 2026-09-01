import { json, body } from '../_lib/db.js';
import { activeCutoffId, publicOrderCode } from '../_lib/tracking.js';

function cleanCode(value){return String(value||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,4)}

export async function onRequest(context){
  if(context.request.method!=='POST')return json({error:'Méthode non autorisée'},405,{Allow:'POST'});
  if(!context.env.VAPID_PUBLIC_KEY||!context.env.VAPID_PRIVATE_KEY)return json({error:'Notifications push non configurées'},503);

  const table=await context.env.DB.prepare(`SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='push_subscriptions'`).first();
  if(!table?.ok)return json({error:'Migration des notifications non appliquée'},503);

  const input=await body(context.request);
  const code=cleanCode(input.code);
  const subscription=input.subscription||{};
  const endpoint=String(subscription.endpoint||'');
  const p256dh=String(subscription.keys?.p256dh||'');
  const auth=String(subscription.keys?.auth||'');
  if(code.length!==4)return json({error:'Code de commande invalide'},400);
  if(!endpoint.startsWith('https://')||!p256dh||!auth)return json({error:'Abonnement push invalide'},400);

  const cutoff=activeCutoffId();
  const {results}=await context.env.DB.prepare(`
    SELECT id,status,payment_status
    FROM orders
    WHERE id>=? AND payment_status='paid' AND status IN ('confirmed','preparing','ready')
    ORDER BY id DESC LIMIT 300
  `).bind(cutoff).all();
  const order=(results||[]).find(row=>publicOrderCode(row.id)===code);
  if(!order)return json({error:'Commande introuvable ou déjà terminée'},404);

  const now=new Date().toISOString();
  await context.env.DB.prepare(`
    INSERT INTO push_subscriptions (order_id,endpoint,p256dh,auth,created_at,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(order_id,endpoint) DO UPDATE SET
      p256dh=excluded.p256dh,
      auth=excluded.auth,
      updated_at=excluded.updated_at
  `).bind(order.id,endpoint,p256dh,auth,now,now).run();

  return json({ok:true,code,status:order.status});
}
