const STATUS_ORDER=['confirmed','preparing','ready','completed'];
const STATUS_META={
  confirmed:{title:'Commande reçue',desc:'Paiement confirmé. Le restaurant va prendre votre commande en charge.'},
  preparing:{title:'En préparation',desc:'Le restaurant a pris votre commande en charge et la prépare.'},
  ready:{title:'Commande prête',desc:'Votre commande est prête pour le retrait ou la remise.'},
  completed:{title:'Commande terminée',desc:'Votre commande a été remise.'},
  cancelled:{title:'Commande annulée',desc:'Cette commande a été annulée.'}
};
let activeCode='';
let refreshTimer=null;

function cleanCode(v){return String(v||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,4)}
function fmtTime(iso){try{return new Date(iso).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}catch{return ''}}

async function fetchTracking(code){
  const r=await fetch(`/api/track?code=${encodeURIComponent(code)}`,{cache:'no-store'});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||'Suivi indisponible');
  return data;
}

function render(data){
  document.querySelector('#trackError').classList.add('hidden');
  document.querySelector('#trackingResult').classList.remove('hidden');
  document.querySelector('#resultCode').textContent=data.code;
  const meta=STATUS_META[data.status]||{title:data.status,desc:''};
  document.querySelector('#resultStatus').textContent=meta.title;
  const eta=document.querySelector('#resultEta');
  if(data.status==='ready')eta.textContent='Prête maintenant';
  else if(data.status==='completed')eta.textContent='Terminée';
  else if(data.status==='cancelled')eta.textContent='—';
  else eta.textContent=`≈ ${data.estimated_minutes_remaining} min`;
  document.querySelector('#resultRefresh').textContent=`Mise à jour automatique · dernière vérification ${fmtTime(data.refreshed_at)}`;

  const eventMap=new Map((data.timeline||[]).map(e=>[e.status,e.occurred_at]));
  const currentIndex=STATUS_ORDER.indexOf(data.status);
  document.querySelector('#timeline').innerHTML=STATUS_ORDER.map((status,index)=>{
    const info=STATUS_META[status];
    const done=currentIndex>=0&&index<currentIndex;
    const current=status===data.status;
    const occurred=eventMap.get(status);
    return `<div class="step ${done?'done':''} ${current?'current':''}"><div class="step-dot">${done?'✓':current?'●':'○'}</div><div><strong>${info.title}</strong><div class="muted small">${occurred?fmtTime(occurred)+' · ':''}${info.desc}</div></div></div>`;
  }).join('')+(data.status==='cancelled'?`<div class="step current"><div class="step-dot">!</div><div><strong>Commande annulée</strong><div class="muted small">${STATUS_META.cancelled.desc}</div></div></div>`:'');
}

async function loadCode(code){
  activeCode=cleanCode(code);
  if(activeCode.length!==4)return;
  document.querySelector('#trackCode').value=activeCode;
  try{render(await fetchTracking(activeCode))}
  catch(e){
    document.querySelector('#trackingResult').classList.add('hidden');
    const err=document.querySelector('#trackError');err.textContent=e.message;err.classList.remove('hidden');
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  const form=document.querySelector('#trackForm');
  const input=document.querySelector('#trackCode');
  input.addEventListener('input',()=>input.value=cleanCode(input.value));
  form.addEventListener('submit',e=>{
    e.preventDefault();
    const code=cleanCode(input.value);
    if(code.length!==4)return;
    history.replaceState(null,'',`suivi.html?code=${encodeURIComponent(code)}`);
    loadCode(code);
  });
  const initial=cleanCode(new URLSearchParams(location.search).get('code'));
  if(initial.length===4)loadCode(initial);
  refreshTimer=setInterval(()=>{if(activeCode)loadCode(activeCode)},5000);
});
