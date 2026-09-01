const API_BASE = window.PIZZAPLANET_API || '';
const fallbackProducts = [
  {id:'reine',name:'Reine',description:'Tomate, mozzarella, jambon, champignons',price_cents:1400,available:true,variants:[]},
  {id:'4fromages',name:'4 Fromages',description:'Tomate, mozzarella, emmental, chèvre',price_cents:1500,available:true,variants:[]},
  {id:'margherita',name:'Margherita',description:'Tomate, mozzarella, basilic',price_cents:1200,available:true,variants:[]},
  {id:'vegetarienne',name:'Végétarienne',description:'Tomate, mozzarella, légumes grillés',price_cents:1400,available:true,variants:[]}
];
let products=[];
let cart=JSON.parse(localStorage.getItem('pp-cart')||'[]');
const euroCents=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(Number(n)/100);
async function loadProducts(){
 try { const r=await fetch(`${API_BASE}/api/products`,{headers:{accept:'application/json'},cache:'no-store'}); if(!r.ok) throw new Error(); const data=await r.json(); products=data.products||data; }
 catch { products=fallbackProducts; }
 normalizeCart(); renderProducts(); renderCart();
}
function normalizeCart(){
 cart=cart.map(i=>({id:Number(i.id),variant_id:i.variant_id==null?null:Number(i.variant_id),qty:Number(i.qty)||1}));
 save(false);
}
function renderProducts(){
 const root=document.querySelector('#products');
 root.innerHTML=products.map(p=>{
  const variants=Array.isArray(p.variants)?p.variants:[];
  const selector=variants.length?`<label class="size-label">Taille<select class="size-select" data-variant-for="${p.id}">${variants.map(v=>`<option value="${v.id}">${escapeHtml(v.label)} — ${euroCents(v.price_cents)}</option>`).join('')}</select></label>`:`<span class="price">${euroCents(p.price_cents)}</span>`;
  return `<article class="product"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description||'')}</p>${selector}${p.available===false?'<button disabled>Rupture de stock</button>':`<button class="btn-primary" data-add="${p.id}">Ajouter</button>`}</article>`;
 }).join('');
 root.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{
  const productId=Number(b.dataset.add);
  const select=root.querySelector(`[data-variant-for="${productId}"]`);
  addToCart(productId,select?Number(select.value):null);
 });
}
function addToCart(id,variantId){
 const p=products.find(x=>Number(x.id)===id);if(!p||p.available===false)return;
 const variants=Array.isArray(p.variants)?p.variants:[];
 const variant=variantId==null?null:variants.find(v=>Number(v.id)===Number(variantId));
 if(variants.length&&!variant)return alert('Choisissez une taille.');
 const row=cart.find(x=>Number(x.id)===id&&Number(x.variant_id||0)===Number(variantId||0));
 row?row.qty++:cart.push({id,variant_id:variantId,qty:1});save();
}
function itemDetails(i){
 const p=products.find(x=>Number(x.id)===Number(i.id));if(!p)return null;
 const variant=(p.variants||[]).find(v=>Number(v.id)===Number(i.variant_id));
 return {p,variant,price:Number(variant?.price_cents??p.price_cents),label:variant?.label||''};
}
function renderCart(){
 const root=document.querySelector('#cartItems');
 if(!cart.length){root.innerHTML='<div class="empty muted">Votre panier est vide.</div>'}
 else{
  root.innerHTML=cart.map((i,index)=>{const d=itemDetails(i);return d?`<div class="cart-row"><span>${escapeHtml(d.p.name)}${d.label?` <small>(${escapeHtml(d.label)})</small>`:''} × ${i.qty}</span><span>${euroCents(d.price*i.qty)} <button data-remove-index="${index}" aria-label="Retirer">−</button></span></div>`:''}).join('');
  root.querySelectorAll('[data-remove-index]').forEach(b=>b.onclick=()=>removeFromCart(Number(b.dataset.removeIndex)));
 }
 const total=cart.reduce((s,i)=>{const d=itemDetails(i);return s+(d?d.price*i.qty:0)},0);document.querySelector('#cartTotal').textContent=euroCents(total);
}
function removeFromCart(index){const r=cart[index];if(!r)return;r.qty--;if(r.qty<=0)cart.splice(index,1);save();}
function save(render=true){localStorage.setItem('pp-cart',JSON.stringify(cart));if(render)renderCart();}
async function checkout(){
 if(!cart.length)return alert('Ajoutez au moins un produit.');
 const name=prompt('Votre nom :'); if(!name?.trim())return;
 const email=prompt('Votre e-mail pour le reçu (facultatif) :')||'';
 const fulfillment=confirm('OK = retrait sur place\nAnnuler = livraison')?'pickup':'delivery';
 const items=cart.map(i=>({product_id:Number(i.id),variant_id:i.variant_id==null?null:Number(i.variant_id),quantity:Number(i.qty)}));
 const button=document.querySelector('#checkoutBtn');button.disabled=true;button.textContent='Préparation du paiement…';
 try{
  const r=await fetch(`${API_BASE}/api/checkout`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({items,customer:{name:name.trim(),email:email.trim()||undefined},fulfillment_type:fulfillment})});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||'Impossible de démarrer le paiement');
  window.location.assign(data.checkout_url);
 }catch(e){alert(e.message);button.disabled=false;button.textContent='Continuer';}
}
document.querySelector('#checkoutBtn').onclick=checkout;
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
loadProducts();
setInterval(loadProducts,30000);
