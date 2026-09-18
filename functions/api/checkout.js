import {json,body} from './_lib/db.js';
import {purgeStalePendingOrders} from './_lib/order-cleanup.js';
import {orderingState,ensureProductionSchema} from './_lib/store.js';
import {serviceEstimate} from './_lib/tracking.js';

const STRIPE_API='https://api.stripe.com/v1/checkout/sessions';
const ORDER_CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',ORDER_CODE_LENGTH=4,ACTIVE_ORDER_WINDOW_MS=48*60*60*1000,STRIPE_CHECKOUT_LIFETIME_SECONDS=31*60;
const MAX_FREE_MEDIUM_CENTS=1450;
const DOUGHS=new Set(['fine','epaisse']);
function stripeHeaders(secret){return {Authorization:`Bearer ${secret}`,'Content-Type':'application/x-www-form-urlencoded'}}
function add(p,k,v){p.append(k,String(v))}
function orderNumber(id){let n=BigInt(String(id))%BigInt(ORDER_CODE_ALPHABET.length**ORDER_CODE_LENGTH),out='';for(let i=0;i<ORDER_CODE_LENGTH;i++){out=ORDER_CODE_ALPHABET[Number(n%BigInt(ORDER_CODE_ALPHABET.length))]+out;n/=BigInt(ORDER_CODE_ALPHABET.length)}return out}
async function makeOrderIdentity(db){const cutoffId=(Date.now()-ACTIVE_ORDER_WINDOW_MS)*1000;const {results}=await db.prepare(`SELECT id FROM orders WHERE id>=?`).bind(cutoffId).all();const used=new Set(results.map(r=>orderNumber(r.id)));for(let a=0;a<40;a++){const orderId=Date.now()*1000+Math.floor(Math.random()*1000),displayOrderNumber=orderNumber(orderId);if(!used.has(displayOrderNumber))return {orderId,displayOrderNumber}}throw new Error('code')}
function doughKey(type,size){return `${type}:${size}`}

export async function onRequest(context){
 if(context.request.method!=='POST')return json({error:'Méthode non autorisée'},405,{Allow:'POST'});
 if(!context.env.STRIPE_SECRET_KEY)return json({error:'Paiement Stripe non configuré côté serveur'},503);
 const db=context.env.DB;await ensureProductionSchema(db);
 const state=await orderingState(db);
 if(!state.can_order)return json({error:state.exceptional_closed?'Le restaurant a exceptionnellement fermé la prise de commandes.':'Les commandes en ligne sont ouvertes de 17h30 à 22h00.',service_status:state},409);
 try{await purgeStalePendingOrders(db)}catch{}
 const input=await body(context.request);
 if(!Array.isArray(input.items)||!input.items.length)return json({error:'Panier vide'},400);
 if(input.items.length>40)return json({error:'Panier trop volumineux'},400);
 if(!input.customer?.name?.trim())return json({error:'Nom client requis'},400);

 const productIds=[...new Set(input.items.map(i=>Number(i.product_id)).filter(Number.isFinite))];
 const ph=productIds.map(()=>'?').join(',');
 const {results:products}=await db.prepare(`SELECT id,name,price_cents,active,available FROM products WHERE id IN (${ph})`).bind(...productIds).all();
 const {results:variants}=await db.prepare(`SELECT id,product_id,size_code,label,price_cents,active FROM product_variants WHERE product_id IN (${ph}) AND active=1`).bind(...productIds).all();
 const byProduct=new Map(products.map(p=>[Number(p.id),p])),byVariant=new Map(variants.map(v=>[Number(v.id),v]));
 const normalized=[];
 for(const item of input.items){
  const product=byProduct.get(Number(item.product_id)),variant=byVariant.get(Number(item.variant_id)),qty=Number(item.quantity),dough=String(item.dough_type||'');
  if(!product||!product.active||!product.available||!variant||Number(variant.product_id)!==Number(product.id)||!Number.isInteger(qty)||qty<1||qty>20)return json({error:`Produit/taille indisponible: ${product?.name??item.product_id}`},409);
  if(!DOUGHS.has(dough))return json({error:`Choisissez pâte fine ou pâte épaisse pour ${product.name}`},400);
  normalized.push({product,variant,quantity:qty,dough_type:dough,unitPrice:Number(variant.price_cents)});
 }
 const mediumUnits=[]; const largeUnits=[];
 for(const r of normalized){
  if(r.variant.size_code==='moyenne')for(let i=0;i<r.quantity;i++)mediumUnits.push(r.unitPrice);
  if(r.variant.size_code==='grande')for(let i=0;i<r.quantity;i++)largeUnits.push(r.unitPrice);
 }
 const mediumCount=mediumUnits.length,largeCount=largeUnits.length;
 const mediumRewards=Math.floor(mediumCount/2),largeRewards=Math.floor(largeCount/2),rewardCount=mediumRewards+largeRewards;
 const mediumPairCap=mediumRewards?Math.min(...mediumUnits.slice().sort((a,b)=>a-b).slice(0,mediumRewards*2)):MAX_FREE_MEDIUM_CENTS;
 const freePizzaCap=Math.min(MAX_FREE_MEDIUM_CENTS,mediumPairCap);
 const promo=input.promotion||{},reward=rewardCount?String(promo.reward||'drinks'):'none';
 if(rewardCount&& !['drinks','pizza'].includes(reward))return json({error:'Choix de promotion invalide'},400);

 const orderLines=[];let total=0;
 const requirements=new Map();
 const addRequirement=(dough,size,qty)=>{const k=doughKey(dough,size);requirements.set(k,(requirements.get(k)||0)+qty)};
 for(const row of normalized){
  orderLines.push({product:row.product,productName:row.product.name,quantity:row.quantity,unitPrice:row.unitPrice,options:{variant_id:row.variant.id,size_code:row.variant.size_code,size_label:row.variant.label,dough_type:row.dough_type},stripeName:`${row.product.name} — ${row.variant.label} — pâte ${row.dough_type==='fine'?'fine':'épaisse'}`});
  total+=row.unitPrice*row.quantity;addRequirement(row.dough_type,row.variant.size_code,row.quantity);
 }
 let freePizza=null;
 if(reward==='pizza'&&rewardCount){
  const freeProductId=Number(promo.free_product_id),freeDough=DOUGHS.has(String(promo.dough_type))?String(promo.dough_type):'fine';
  if(!Number.isFinite(freeProductId))return json({error:'Choisissez la pizza moyenne offerte.'},400);
  const row=await db.prepare(`SELECT p.id,p.name,p.active,p.available,v.id variant_id,v.label,v.price_cents FROM products p JOIN product_variants v ON v.product_id=p.id WHERE p.id=? AND p.active=1 AND p.available=1 AND v.size_code='moyenne' AND v.active=1 LIMIT 1`).bind(freeProductId).first();
  if(!row||Number(row.price_cents)>freePizzaCap)return json({error:`La pizza offerte doit être une moyenne d’une valeur maximale de ${(freePizzaCap/100).toFixed(2).replace('.',',')} € et ne pas dépasser la moins chère des pizzas moyennes ouvrant droit à l’offre.`},409);
  freePizza={id:row.id,name:row.name,variant_id:row.variant_id,label:row.label,price:Number(row.price_cents),dough_type:freeDough};
  orderLines.push({product:{id:row.id},productName:row.name,quantity:rewardCount,unitPrice:0,options:{variant_id:row.variant_id,size_code:'moyenne',size_label:row.label,dough_type:freeDough,promotion:'pizza_offerte',promotion_label:`${rewardCount} pizza(s) moyenne(s) offerte(s)`},stripeName:`🎁 ${row.name} — moyenne offerte`});
  addRequirement(freeDough,'moyenne',rewardCount);
 }
 if(reward==='drinks'&&mediumRewards)orderLines.push({product:null,productName:'Boissons 50cl offertes',quantity:mediumRewards*2,unitPrice:0,options:{promotion:'boissons_50cl',promotion_label:'Boissons à choisir sur place'},stripeName:'Boissons 50cl offertes'});
 if(reward==='drinks'&&largeRewards)orderLines.push({product:null,productName:'Boissons 2L offertes',quantity:largeRewards*2,unitPrice:0,options:{promotion:'boissons_2l',promotion_label:'Boissons à choisir sur place'},stripeName:'Boissons 2L offertes'});

 const {results:stockRows}=await db.prepare(`SELECT dough_type,size_code,quantity,configured FROM dough_stock`).all();
 for(const s of stockRows){const need=requirements.get(doughKey(s.dough_type,s.size_code))||0;if(Number(s.configured)===1&&need>Number(s.quantity))return json({error:`Stock de pâtes insuffisant: pâte ${s.dough_type}, taille ${s.size_code}.`,stock_error:true},409)}
 const restaurant=await db.prepare(`SELECT id,currency FROM restaurants ORDER BY id LIMIT 1`).first();if(!restaurant)return json({error:'Restaurant non configuré'},500);
 let identity;try{identity=await makeOrderIdentity(db)}catch{return json({error:'Impossible de générer le code de commande. Réessayez.'},503)}
 const estimate=await serviceEstimate(db),now=new Date(),readyAt=new Date(now.getTime()+estimate.estimated_wait_minutes*60000).toISOString(),nowIso=now.toISOString();
 const promoNote=rewardCount?(reward==='pizza'?`${rewardCount} pizza(s) moyenne(s) offerte(s), valeur max 14,50 €`:`${mediumRewards*2} boisson(s) 50cl + ${largeRewards*2} boisson(s) 2L offerte(s), choix sur place`):'';
 const ins=await db.prepare(`INSERT INTO orders(id,restaurant_id,customer_name,customer_phone,customer_email,fulfillment_type,total_cents,status,payment_status,notes,created_at,updated_at,estimated_ready_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(identity.orderId,restaurant.id,input.customer.name.trim(),input.customer.phone||null,input.customer.email||null,'pickup',total,'new','pending',[input.notes,promoNote].filter(Boolean).join(' | ')||null,nowIso,nowIso,readyAt).run();
 if(!ins.meta.changes)return json({error:'Impossible de créer la commande'},500);
 await db.batch(orderLines.map(line=>db.prepare(`INSERT INTO order_items(order_id,product_id,product_name,quantity,unit_price_cents,options_json) VALUES(?,?,?,?,?,?)`).bind(identity.orderId,line.product?.id??null,line.productName,line.quantity,line.unitPrice,JSON.stringify(line.options||{}))));
 const origin=new URL(context.request.url).origin,p=new URLSearchParams();add(p,'mode','payment');add(p,'expires_at',Math.floor(Date.now()/1000)+STRIPE_CHECKOUT_LIFETIME_SECONDS);add(p,'success_url',`${origin}/payment-success.html?order_id=${identity.orderId}&session_id={CHECKOUT_SESSION_ID}`);add(p,'cancel_url',`${origin}/payment-cancel.html?order_id=${identity.orderId}`);add(p,'client_reference_id',identity.orderId);if(input.customer.email)add(p,'customer_email',input.customer.email);add(p,'metadata[order_id]',identity.orderId);add(p,'metadata[order_number]',identity.displayOrderNumber);add(p,'payment_intent_data[metadata][order_id]',identity.orderId);
 orderLines.filter(l=>l.unitPrice>0).forEach((line,i)=>{add(p,`line_items[${i}][quantity]`,line.quantity);add(p,`line_items[${i}][price_data][currency]`,restaurant.currency||'eur');add(p,`line_items[${i}][price_data][unit_amount]`,line.unitPrice);add(p,`line_items[${i}][price_data][product_data][name]`,line.stripeName)});
 const response=await fetch(STRIPE_API,{method:'POST',headers:stripeHeaders(context.env.STRIPE_SECRET_KEY),body:p}),session=await response.json();
 if(!response.ok||!session.id||!session.url){await db.prepare(`UPDATE orders SET status='cancelled',payment_status='failed',updated_at=? WHERE id=?`).bind(new Date().toISOString(),identity.orderId).run();return json({error:'Impossible de créer la session de paiement',details:session?.error?.message},502)}
 return json({checkout_url:session.url,order_id:identity.orderId,order_number:identity.displayOrderNumber,total_cents:total,estimated_wait_minutes:estimate.estimated_wait_minutes,estimated_ready_at:readyAt,promotions:{reward,medium_rewards:mediumRewards,large_rewards:largeRewards,free_pizza_cap_cents:freePizzaCap,free_medium_pizzas:reward==='pizza'?rewardCount:0,free_50cl:reward==='drinks'?mediumRewards*2:0,free_2l:reward==='drinks'?largeRewards*2:0}});
}
