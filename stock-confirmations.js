const stockPanel = document.querySelector('#stockConfirmations');
async function refreshStockConfirmations(){
  if(!stockPanel) return;
  try {
    const r=await fetch('/api/admin/stocks',{cache:'no-store'});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||'Erreur stock');
    const items=data.ingredients||[];
    const zero=items.filter(i=>Number(i.quantity)<=0);
    stockPanel.innerHTML=`<div class="card"><div class="row"><div><strong>Validation des ruptures</strong><div class="muted small">Une pizza ne sera bloquée que si son ingrédient est à zéro <strong>et</strong> que tu confirmes ici la rupture.</div></div><span class="badge ${zero.some(i=>i.out_of_stock_confirmed)?'off':'on'}">${zero.filter(i=>i.out_of_stock_confirmed).length} rupture(s) confirmée(s)</span></div>${zero.length?zero.map(i=>`<div class="row stock-confirm-row"><div><strong>${escStock(i.name)}</strong><div class="muted small">${i.unit} · stock : <strong>0</strong>${i.out_of_stock_confirmed?' · 🔴 confirmé':' · 🟠 à valider'}</div></div><button class="tab ${i.out_of_stock_confirmed?'active':''}" data-stock-action="${i.id}" data-confirmed="${i.out_of_stock_confirmed?'1':'0'}">${i.out_of_stock_confirmed?'Annuler la rupture':'Confirmer la rupture'}</button></div>`).join(''):'<p class="muted small">Aucun ingrédient à zéro. Les ruptures éventuelles ne bloquent donc rien.</p>'}</div>`;
    stockPanel.querySelectorAll('[data-stock-action]').forEach(b=>b.onclick=()=>confirmStock(Number(b.dataset.stockAction),b.dataset.confirmed==='1'));
  } catch(e) { stockPanel.innerHTML=`<div class="card"><strong>Validation des ruptures indisponible</strong><p class="muted small">${escStock(e.message)}</p></div>`; }
}
async function confirmStock(id,alreadyConfirmed){
  const action=alreadyConfirmed?'unconfirm_out':'confirm_out';
  try{
    const r=await fetch('/api/admin/stocks',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,action})});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||'Impossible de modifier la rupture');
    await refreshStockConfirmations();
    if(typeof window.load==='function') window.load();
  }catch(e){alert(e.message)}
}
function escStock(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
refreshStockConfirmations();
setInterval(refreshStockConfirmations,5000);
