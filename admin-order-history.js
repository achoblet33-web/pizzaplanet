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
  orderNumber=shortOrderCode;

  function ageText(iso){
    const ms=Date.now()-Date.parse(iso||'');
    if(!Number.isFinite(ms)||ms<0)return '';
    const min=Math.floor(ms/60000);
    if(min<1)return "à l'instant";
    if(min<60)return `${min} min`;
    const h=Math.floor(min/60),m=min%60;
    return `${h} h ${m?m+' min':''}`.trim();
  }

  function orderItems(o){
    return (o.items||[]).map(i=>{
      const opts=i.options||{};
      const size=opts.size_label?` (${esc(opts.size_label)})`:'';
      const promo=Boolean(opts.promotion);
      const price=Number(i.unit_price_cents)*Number(i.quantity);
      return `<div class="order-line ${promo?'promo-item':''}"><span>${promo?'🎁 ':''}${esc(i.product_name)}${size} × ${i.quantity}${opts.promotion_label?` <small>— ${esc(opts.promotion_label)}</small>`:''}</span><strong>${money(price)}</strong></div>`;
    }).join('')||'<div class="muted small">Aucun article.</div>';
  }

  function primaryAction(o){
    if(o.payment_status!=='paid')return '';
    if(o.status==='confirmed')return `<button class="btn-primary kitchen-action" data-next="preparing" data-order="${o.id}">▶ Prendre en charge</button>`;
    if(o.status==='preparing')return `<button class="btn-primary kitchen-action" data-next="ready" data-order="${o.id}">✅ Commande prête</button>`;
    if(o.status==='ready')return `<button class="btn-primary kitchen-action" data-next="completed" data-order="${o.id}">🤝 Remise au client</button>`;
    return '';
  }

  function card(o,archived=false){
    const contacts=[o.customer_phone,o.customer_email].filter(Boolean).map(esc).join(' · ');
    const paymentClass=o.payment_status==='paid'?'payment-paid':'payment-pending';
    const statusSince=o.updated_at||o.created_at;
    return `<article class="card kitchen-card status-${esc(o.status)}">
      <div class="row">
        <div>
          <div class="muted small">Commande</div>
          <strong class="order-number">${shortOrderCode(o.id)}</strong>
          <div style="margin-top:6px"><strong>${esc(o.customer_name)}</strong></div>
        </div>
        <div style="text-align:right">
          <span class="badge ${o.status==='cancelled'?'off':o.status==='confirmed'?'low':'on'}">${statusLabels[o.status]||o.status}</span>
          <div class="small ${paymentClass}" style="margin-top:6px">${paymentLabels[o.payment_status]||esc(o.payment_status)}</div>
        </div>
      </div>
      <p class="muted small">Créée il y a ${ageText(o.created_at)} · étape actuelle depuis ${ageText(statusSince)} · ${money(o.total_cents)} · ${o.fulfillment_type==='delivery'?'🚗 Livraison':'🏪 Retrait'}</p>
      ${contacts?`<p class="muted small">${contacts}</p>`:''}
      <div class="order-items">${orderItems(o)}</div>
      ${o.notes?`<p class="muted small">📝 ${esc(o.notes)}</p>`:''}
      ${archived?'<div class="muted small">🗂 Archivée automatiquement après 48 h.</div>':primaryAction(o)}
    </article>`;
  }

  function section(title,icon,orders,emptyText){
    return `<section class="kitchen-section"><div class="row kitchen-section-head"><h3>${icon} ${title}</h3><span class="badge ${orders.length?'on':''}">${orders.length}</span></div><div class="cards">${orders.map(o=>card(o,false)).join('')||`<p class="muted small">${emptyText}</p>`}</div></section>`;
  }

  async function kitchenSummary(){
    try{
      const s=await api('/api/service-status');
      return `<div class="kitchen-summary"><strong>⏱ Attente estimée client : ${s.estimated_wait_min}–${s.estimated_wait_max} min</strong><span>${s.waiting_orders} en attente · ${s.preparing_orders} en préparation</span></div>`;
    }catch{return ''}
  }

  async function renderKitchen(orders){
    const root=document.querySelector('#orders');
    if(!root||archiveMode)return;
    const confirmed=orders.filter(o=>o.payment_status==='paid'&&o.status==='confirmed');
    const preparing=orders.filter(o=>o.payment_status==='paid'&&o.status==='preparing');
    const ready=orders.filter(o=>o.payment_status==='paid'&&o.status==='ready');
    const pending=orders.filter(o=>o.payment_status!=='paid'||o.status==='new');
    const done=orders.filter(o=>o.status==='completed'||o.status==='cancelled');
    root.innerHTML=(await kitchenSummary())+
      section('À prendre en charge','🆕',confirmed,'Aucune nouvelle commande payée.')+
      section('En préparation','🔥',preparing,'Aucune commande en préparation.')+
      section('Prêtes à remettre','✅',ready,'Aucune commande prête.')+
      section('Paiements en attente','💳',pending,'Aucun paiement en attente.')+
      section('Terminées récemment','🧾',done,'Aucune commande terminée récemment.');

    root.querySelectorAll('[data-next]').forEach(btn=>btn.onclick=async()=>{
      btn.disabled=true;
      const original=btn.textContent;
      btn.textContent='Mise à jour…';
      try{
        await api('/api/admin/orders',{method:'PATCH',body:JSON.stringify({id:Number(btn.dataset.order),status:btn.dataset.next})});
        await loadOrders();
      }catch(e){
        alert(e.message);
        btn.disabled=false;
        btn.textContent=original;
      }
    });
  }

  renderOrders=function(orders){ if(!archiveMode)renderKitchen(orders); };

  function renderArchive(orders){
    const root=document.querySelector('#orders');
    if(!root)return;
    root.innerHTML=`<div class="cards">${orders.map(o=>card(o,true)).join('')||'<p class="muted">Aucune commande archivée sur cette page.</p>'}</div>`;
  }

  async function loadArchive(page=1){
    try{
      const data=await api(`/api/admin/orders?archive=1&page=${page}&limit=50`);
      archivePage=Number(data.page||page);
      archiveHasMore=Boolean(data.has_more);
      renderArchive(data.orders||[]);
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
  const archiveCount=document.querySelector('#archiveCount');
  if(archiveCount)archiveCount.textContent='48 h+';

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
