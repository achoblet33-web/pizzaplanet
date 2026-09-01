const API_BASE = window.PIZZAPLANET_API || '';
let products=[];
let cart=JSON.parse(localStorage.getItem('pp-cart')||'[]');
const euroCents=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(n||0)/100);

async function loadProducts(){
 try {
  const r=await fetch(`${API_BASE}/api/products`,{headers:{accept:'application/json'},cache:'no-store'});
  if(!r.ok) throw new Error('Catalogue indisponible');
  const data=await r.json(); products=data.products||data;
 } catch {
  products=[];
  document.querySelector('#products').innerHTML='<div class="empty muted">Le catalogue est momentanément indisponible. Réessayez dans quelques instants.</div>';
 }
 normalizeCart();
 if(products.length) renderProducts();
 renderCart();
}

function normalizeCart(){
 cart=cart.map(i=>({id:Number(i.id),variant_id:i.variant_id==null?null:Number(i.variant_id),qty:Math.max(1,Number(i.qty)||1)})).filter(i=>Number.isFinite(i.id));
 save(false);
}

function renderProducts(){
 const root=document.querySelector('#products');
 root.innerHTML=products.map(p=>{
  const variants=Array.isArray(p.variants)?p.variants:[];
  const selector=variants.length?`<label class="size-label">Taille<select class="size-select" data-variant-for="${p.id}">${variants.map(v=>`<option value="${v.id}" data-size="${escapeHtml(v.size_code)}">${escapeHtml(v.label)} — ${euroCents(v.price_cents)}</option>`).join('')}</select></label>`:`<span class="price">${euroCents(p.price_cents)}</span>`;
  return `<article class="product"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description||'')}</p>${selector}${p.available===false?'<button disabled>Rupture de stock</button>':`<button class="btn-primary" data-add="${p.id}">Ajouter</button>`}</article>`;
 }).join('');
 root.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{
  const productId=Number(b.dataset.add);
  const select=root.querySelector(`[data-variant-for="${productId}"]`);
  addToCart(productId,select?Number(select.value):null);
 });
}

function addToCart(id,variantId){
 const p=products.find(x=>Number(x.id)===id); if(!p||p.available===false)return;
 const variants=Array.isArray(p.variants)?p.variants:[];
 const variant=variantId==null?null:variants.find(v=>Number(v.id)===Number(variantId));
 if(variants.length&&!variant)return alert('Choisissez une taille.');
 const row=cart.find(x=>Number(x.id)===id&&Number(x.variant_id||0)===Number(variantId||0));
 row?row.qty++:cart.push({id,variant_id:variantId,qty:1});
 save();
}

function itemDetails(i){
 const p=products.find(x=>Number(x.id)===Number(i.id)); if(!p)return null;
 const variant=(p.variants||[]).find(v=>Number(v.id)===Number(i.variant_id));
 return {p,variant,price:Number(variant?.price_cents??p.price_cents),label:variant?.label||'',sizeCode:variant?.size_code||''};
}

function calculatePromotions(){
 const rows=cart.map((item,index)=>{const d=itemDetails(item);return d?{index,item,d}:null}).filter(Boolean);
 const mediumUnits=[];
 let subtotal=0;
 rows.forEach(row=>{
  subtotal+=row.d.price*row.item.qty;
  if(row.d.sizeCode==='moyenne'){
   for(let n=0;n<row.item.qty;n++) mediumUnits.push({rowIndex:row.index,price:row.d.price});
  }
 });

 const freePizzaCount=Math.floor(mediumUnits.length/3);
 const freeByRow=new Map();
 const cheapest=[...mediumUnits].sort((a,b)=>a.price-b.price);
 for(let n=0;n<freePizzaCount;n++) freeByRow.set(cheapest[n].rowIndex,(freeByRow.get(cheapest[n].rowIndex)||0)+1);
 let pizzaDiscount=0;
 freeByRow.forEach((count,rowIndex)=>{
  const row=rows.find(r=>r.index===rowIndex);
  if(row) pizzaDiscount+=row.d.price*count;
 });

 const paidMediumCount=mediumUnits.length-freePizzaCount;
 const freeDrinks=paidMediumCount;
 return {rows,subtotal,pizzaDiscount,total:subtotal-pizzaDiscount,mediumCount:mediumUnits.length,freePizzaCount,freeByRow,freeDrinks};
}

function renderCart(){
 const root=document.querySelector('#cartItems');
 const promoRoot=document.querySelector('#promoSummary');
 const promo=calculatePromotions();

 if(!cart.length){
  root.innerHTML='<div class="empty muted">Votre panier est vide.</div>';
  promoRoot.innerHTML='';
 } else {
  root.innerHTML=cart.map((i,index)=>{
   const d=itemDetails(i); if(!d)return '';
   const freeCount=promo.freeByRow.get(index)||0;
   const original=d.price*i.qty;
   const discounted=d.price*(i.qty-freeCount);
   const priceHtml=freeCount?`<span><span class="old-price">${euroCents(original)}</span>${euroCents(discounted)}</span>`:`<span>${euroCents(original)}</span>`;
   return `<div class="cart-row"><span>${escapeHtml(d.p.name)}${d.label?` <small>(${escapeHtml(d.label)})</small>`:''} × ${i.qty}${freeCount?`<span class="promo-line">🎁 ${freeCount} pizza${freeCount>1?'s':''} offerte${freeCount>1?'s':''}</span>`:''}</span><span>${priceHtml} <button data-remove-index="${index}" aria-label="Retirer">−</button></span></div>`;
  }).join('');
  root.querySelectorAll('[data-remove-index]').forEach(b=>b.onclick=()=>removeFromCart(Number(b.dataset.removeIndex)));

  const messages=[];
  if(promo.freeDrinks>0) messages.push(`🥤 <strong>${promo.freeDrinks} boisson${promo.freeDrinks>1?'s':''} offerte${promo.freeDrinks>1?'s':''}</strong> avec ${promo.freeDrinks} pizza${promo.freeDrinks>1?'s':''} moyenne${promo.freeDrinks>1?'s':''} payée${promo.freeDrinks>1?'s':''}.`);
  if(promo.pizzaDiscount>0) messages.push(`🍕 Promo 2 achetées = 1 offerte : <strong>-${euroCents(promo.pizzaDiscount)}</strong> (la/les moyenne(s) la/les moins chère(s)).`);
  const rest=promo.mediumCount%3;
  if(rest===2) messages.push('💡 Ajoutez une 3e pizza moyenne : la moins chère des 3 sera offerte.');
  else if(rest===1) messages.push('💡 Ajoutez 2 autres pizzas moyennes pour obtenir la moins chère des 3 offerte.');
  promoRoot.innerHTML=messages.length?`<div class="promo-summary">${messages.map(x=>`<div>${x}</div>`).join('')}</div>`:'';
 }
 document.querySelector('#cartTotal').textContent=euroCents(promo.total);
}

function removeFromCart(index){const r=cart[index];if(!r)return;r.qty--;if(r.qty<=0)cart.splice(index,1);save();}
function save(render=true){localStorage.setItem('pp-cart',JSON.stringify(cart));if(render)renderCart();}

async function checkout(){
 if(!cart.length)return alert('Ajoutez au moins un produit.');
 const name=prompt('Votre nom :'); if(!name?.trim())return;
 const email=prompt('Votre e-mail pour le reçu (facultatif) :')||'';
 const fulfillment=confirm('OK = retrait sur place\nAnnuler = livraison')?'pickup':'delivery';
 const items=cart.map(i=>({product_id:Number(i.id),variant_id:i.variant_id==null?null:Number(i.variant_id),quantity:Number(i.qty)}));
 const button=document.querySelector('#checkoutBtn');button.disabled=true;button.textContent='Calcul des offres et paiement…';
 try{
  const r=await fetch(`${API_BASE}/api/checkout`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({items,customer:{name:name.trim(),email:email.trim()||undefined},fulfillment_type:fulfillment})});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||'Impossible de démarrer le paiement');
  localStorage.setItem('pp-last-order-id',String(data.order_id||''));
  window.location.assign(data.checkout_url);
 }catch(e){alert(e.message);button.disabled=false;button.textContent='Continuer';}
}

document.querySelector('#checkoutBtn').onclick=checkout;
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
loadProducts();
setInterval(loadProducts,30000);
