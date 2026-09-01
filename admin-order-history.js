(function(){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let archiveMode=false;
  let archivePage=1;
  let archiveHasMore=false;

  function shortOrderCode(id){
    try{
      let n=BigInt(String(id))%BigInt(alphabet.length**4),out='';
      for(let i=0;i<4;i++){
        out=alphabet[Number(n%BigInt(alphabet.length))]+out;
        n/=BigInt(alphabet.length);
      }
      return out;
    }catch{return '----'}
  }

  // Remplace l'ancien numéro long par un code opérationnel de 4 caractères.
  orderNumber=shortOrderCode;

  function renderOrderCards(orders,archived){
    const root=document.querySelector('#orders');
    if(!root)return;
    root.innerHTML=orders.map(o=>{
      const items=(o.items||[]).map(i=>{
        const opts=i.options||{};
        const size=opts.size_label?` (${esc(opts.size_label)})`:'';
        const promo=Boolean(opts.promotion);
        const price=Number(i.unit_price_cents)*Number(i.quantity);
        return `<div class="order-line ${promo?'promo-item':''}"><span>${promo?'🎁 ':''}${esc(i.product_name)}${size} × ${i.quantity}${opts.promotion_label?` <small>— ${esc(opts.promotion_label)}</small>`:''}</span><strong>${money(price)}</strong></div>`;
      }).join('')||'<div class="muted small">Aucun article.</div>';
      const paymentClass=o.payment_status==='paid'?'payment-paid':'payment-pending';
      const contacts=[o.customer_phone,o.customer_email].filter(Boolean).map(esc).join(' · ');
      const controls=archived
        ? '<div class="muted small">🗂 Commande archivée automatiquement après 48 h.</div>'
        : `<div class="actions"><select data-order-status="${o.id}" style="background:#0b0e14;color:#fff;padding:8px;border-radius:8px"><option value="new" ${o.status==='new'?'selected':''}>Nouvelle</option><option value="confirmed" ${o.status==='confirmed'?'selected':''}>Confirmée</option><option value="preparing" ${o.status==='preparing'?'selected':''}>En préparation</option><option value="ready" ${o.status==='ready'?'selected':''}>Prête</option><option value="completed" ${o.status==='completed'?'selected':''}>Terminée</option><option value="cancelled" ${o.status==='cancelled'?'selected':''}>Annuler</option></select></div>`;
      return `<article class="card"><div class="row"><div><div class="muted small">Commande</div><strong class="order-number">${shortOrderCode(o.id)}</strong><div style="margin-top:5px"><strong>${esc(o.customer_name)}</strong></div></div><div style="text-align:right"><span class="badge ${o.status==='cancelled'?'off':o.status==='new'?'low':'on'}">${statusLabels[o.status]||o.status}</span><div class="small ${paymentClass}" style="margin-top:6px">${paymentLabels[o.payment_status]||esc(o.payment_status)}</div></div></div><p class="muted small">${new Date(o.created_at).toLocaleString('fr-FR')} · ${money(o.total_cents)} · ${o.fulfillment_type==='delivery'?'🚗 Livraison':'🏪 Retrait'}</p>${contacts?`<p class="muted small">${contacts}</p>`:''}<div class="order-items">${items}</div>${o.notes?`<p class="muted small">📝 ${esc(o.notes)}</p>`:''}${controls}</article>`;
    }).join('')||(archived?'<p class="muted">Aucune commande archivée.</p>':'<p class="muted">Aucune commande à traiter sur les dernières 48 h.</p>');

    if(!archived){
      root.querySelectorAll('[data-order-status]').forEach(el=>el.onchange=async()=>{
        try{
          await api('/api/admin/orders',{method:'PATCH',body:JSON.stringify({id:Number(el.dataset.orderStatus),status:el.value})});
          await loadOrders();
        }catch(e){
          alert(e.data?.insufficient?.map(x=>`${x.name}: ${x.stock} ${x.unit} disponibles, ${x.required} requis`).join('\n')||e.message);
          await loadOrders();
        }
      });
    }
  }

  // L'actualisation existante continue à détecter les nouvelles commandes,
  // mais ne remplace pas l'écran lorsqu'on consulte les archives.
  renderOrders=function(orders){
    if(!archiveMode)renderOrderCards(orders,false);
  };

  async function loadArchive(page=1){
    try{
      const data=await api(`/api/admin/orders?archive=1&page=${page}&limit=50`);
      archivePage=Number(data.page||page);
      archiveHasMore=Boolean(data.has_more);
      renderOrderCards(data.orders||[],true);
      const pager=document.querySelector('#archivePager');
      if(pager)pager.classList.toggle('hidden',archivePage<=1&&!archiveHasMore);
      const label=document.querySelector('#archivePageLabel');
      if(label)label.textContent=`Page ${archivePage}`;
      const prev=document.querySelector('#archivePrev');
      const next=document.querySelector('#archiveNext');
      if(prev)prev.disabled=archivePage<=1;
      if(next)next.disabled=!archiveHasMore;
    }catch(e){
      document.querySelector('#orders').innerHTML='<p class="muted">Archives indisponibles.</p>';
    }
  }

  const activeBtn=document.querySelector('#ordersActiveBtn');
  const archiveBtn=document.querySelector('#ordersArchiveBtn');
  const note=document.querySelector('#archiveNote');
  const pager=document.querySelector('#archivePager');

  if(activeBtn)activeBtn.onclick=async()=>{
    archiveMode=false;
    activeBtn.classList.add('active');
    archiveBtn?.classList.remove('active');
    note?.classList.add('hidden');
    pager?.classList.add('hidden');
    await loadOrders();
  };

  if(archiveBtn)archiveBtn.onclick=async()=>{
    archiveMode=true;
    archiveBtn.classList.add('active');
    activeBtn?.classList.remove('active');
    note?.classList.remove('hidden');
    await loadArchive(1);
  };

  document.querySelector('#archivePrev')?.addEventListener('click',()=>{if(archivePage>1)loadArchive(archivePage-1)});
  document.querySelector('#archiveNext')?.addEventListener('click',()=>{if(archiveHasMore)loadArchive(archivePage+1)});
})();
