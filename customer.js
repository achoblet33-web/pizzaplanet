const API_BASE = window.PIZZAPLANET_API || '';
const fallbackProducts = [
  {id:'reine',name:'Reine',description:'Tomate, mozzarella, jambon, champignons',price:14,available:true},
  {id:'4fromages',name:'4 Fromages',description:'Tomate, mozzarella, emmental, chèvre',price:15,available:true},
  {id:'margherita',name:'Margherita',description:'Tomate, mozzarella, basilic',price:12,available:true},
  {id:'vegetarienne',name:'Végétarienne',description:'Tomate, mozzarella, légumes grillés',price:14,available:true}
];
let products=[];
let cart=JSON.parse(localStorage.getItem('pp-cart')||'[]');
const euro=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n);
async function loadProducts(){
  try { const r=await fetch(`${API_BASE}/api/products`,{headers:{accept:'application/json'}}); if(!r.ok) throw new Error(); products=await r.json(); }
  catch { products=fallbackProducts; }
  renderProducts(); renderCart();
}
function renderProducts(){
 const root=document.querySelector('#products');
 root.innerHTML=products.map(p=>`<article class="product"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description||'')}</p><span class="price">${euro(p.price)}</span>${p.available===false?'<button disabled>Rupture de stock</button>':`<button class="btn-primary" data-add="${p.id}">Ajouter</button>`}</article>`).join('');
 root.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>addToCart(b.dataset.add));
}
function addToCart(id){const p=products.find(x=>x.id===id);if(!p||p.available===false)return;const row=cart.find(x=>x.id===id);row?row.qty++:cart.push({id,qty:1});save();}
function renderCart(){const root=document.querySelector('#cartItems');if(!cart.length){root.innerHTML='<div class="empty muted">Votre panier est vide.</div>'}else{root.innerHTML=cart.map(i=>{const p=products.find(x=>x.id===i.id);return p?`<div class="cart-row"><span>${escapeHtml(p.name)} × ${i.qty}</span><span>${euro(p.price*i.qty)} <button data-remove="${p.id}" aria-label="Retirer">−</button></span></div>`:''}).join('');root.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>removeFromCart(b.dataset.remove));}const total=cart.reduce((s,i)=>{const p=products.find(x=>x.id===i.id);return s+(p?p.price*i.qty:0)},0);document.querySelector('#cartTotal').textContent=euro(total);}
function removeFromCart(id){const r=cart.find(x=>x.id===id);if(!r)return;r.qty--;if(r.qty<=0)cart=cart.filter(x=>x.id!==id);save();}
function save(){localStorage.setItem('pp-cart',JSON.stringify(cart));renderCart();}
document.querySelector('#checkoutBtn').onclick=()=>{if(!cart.length)return alert('Ajoutez au moins un produit.');alert('Étape suivante : choix retrait/livraison puis paiement sécurisé Stripe via le Worker.');};
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
loadProducts();
setInterval(loadProducts,30000);