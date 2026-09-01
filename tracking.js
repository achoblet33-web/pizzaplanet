const STATUS_ORDER=['confirmed','preparing','ready','completed'];
const STATUS_META={
  confirmed:{title:'Commande reçue',desc:'Paiement confirmé. Le restaurant va prendre votre commande en charge.',notification:'Votre commande a bien été reçue par Planet Pizza.'},
  preparing:{title:'En préparation',desc:'Le restaurant a pris votre commande en charge et la prépare.',notification:'Votre commande est maintenant en préparation.'},
  ready:{title:'Commande prête',desc:'Votre commande est prête à être retirée au restaurant.',notification:'Votre commande est prête. Vous pouvez venir la retirer au restaurant.'},
  completed:{title:'Commande terminée',desc:'Votre commande a été remise.',notification:'Votre commande a été remise. Merci et bon appétit !'},
  cancelled:{title:'Commande annulée',desc:'Cette commande a été annulée.',notification:'Votre commande a été annulée. Contactez le restaurant si besoin.'}
};
let activeCode='';
let refreshTimer=null;
let lastStatus='';
let notificationsEnabled=localStorage.getItem('pp-track-notifications')==='1';
let notificationRegistration=null;
let pushSubscribed=false;
let pushConfigured=null;

function cleanCode(v){return String(v||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,4)}
function fmtTime(iso){try{return new Date(iso).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}catch{return ''}}
function statusStorageKey(code){return `pp-track-status-${code}`}
function pushStorageKey(code){return `pp-track-push-${code}`}

function b64urlToBytes(value){
  const normalized=String(value||'').replace(/-/g,'+').replace(/_/g,'/');
  const padded=normalized+'='.repeat((4-normalized.length%4)%4);
  const raw=atob(padded);
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}

async function registerNotificationServiceWorker(){
  if(!('serviceWorker' in navigator))return null;
  try{
    notificationRegistration=await navigator.serviceWorker.register('/notification-sw.js');
    return notificationRegistration;
  }catch{return null}
}

async function showSystemNotification(title,options){
  if(!notificationsEnabled||!('Notification' in window)||Notification.permission!=='granted')return;
  try{
    const registration=notificationRegistration||await registerNotificationServiceWorker();
    if(registration?.showNotification){await registration.showNotification(title,options);return;}
    new Notification(title,options);
  }catch{}
}

async function subscribeForPush(){
  pushSubscribed=false;
  if(!activeCode||!notificationsEnabled||Notification.permission!=='granted'||!('serviceWorker' in navigator))return false;
  try{
    const configResponse=await fetch('/api/push/config',{cache:'no-store'});
    const config=await configResponse.json();
    pushConfigured=Boolean(config.configured&&config.public_key);
    if(!pushConfigured)return false;
    const registration=notificationRegistration||await registerNotificationServiceWorker();
    if(!registration?.pushManager)return false;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription){
      subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64urlToBytes(config.public_key)});
    }
    const response=await fetch('/api/push/subscribe',{
      method:'POST',headers:{'content-type':'application/json','accept':'application/json'},
      body:JSON.stringify({code:activeCode,subscription:subscription.toJSON()})
    });
    if(!response.ok)return false;
    pushSubscribed=true;
    localStorage.setItem(pushStorageKey(activeCode),'1');
    return true;
  }catch{return false}
  finally{updateNotificationButton()}
}

async function fetchTracking(code){
  const r=await fetch(`/api/track?code=${encodeURIComponent(code)}`,{cache:'no-store'});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||'Suivi indisponible');
  return data;
}

function showToast(title,body){
  const toast=document.querySelector('#trackToast');
  if(!toast)return;
  toast.innerHTML=`<strong>${title}</strong><div>${body}</div>`;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>{toast.classList.remove('show');toast.classList.add('hidden')},8000);
}

function sendCustomerNotification(data){
  const meta=STATUS_META[data.status];
  if(!meta)return;
  const eta=(data.status==='confirmed'||data.status==='preparing')&&Number.isFinite(Number(data.estimated_minutes_remaining))
    ? ` Temps estimé : environ ${data.estimated_minutes_remaining} min.`:'';
  const title=`Planet Pizza · ${data.code} · ${meta.title}`;
  const body=`${meta.notification}${eta}`;
  showToast(title,body);
  try{if(navigator.vibrate)navigator.vibrate([120,60,120])}catch{}
  document.title=`🔔 ${meta.title} — ${data.code}`;
  setTimeout(()=>{document.title='Suivre ma commande — Planet Pizza'},10000);
  showSystemNotification(title,{body,icon:'/logo2.png',badge:'/logo2.png',tag:`planet-pizza-${data.code}`,renotify:true,data:{url:`/suivi.html?code=${encodeURIComponent(data.code)}`}});
}

function updateNotificationButton(){
  const btn=document.querySelector('#notificationBtn');
  const text=document.querySelector('#notificationState');
  if(!btn||!text)return;
  if(!('Notification' in window)){
    btn.disabled=true;btn.textContent='Notifications non prises en charge';text.textContent='Votre navigateur ne permet pas les notifications système.';return;
  }
  if(Notification.permission==='denied'){
    btn.disabled=true;btn.textContent='Notifications bloquées';text.textContent='Autorisez les notifications pour ce site dans les réglages du navigateur.';return;
  }
  if(Notification.permission==='granted'&&notificationsEnabled){
    btn.textContent='🔔 Notifications activées';
    if(pushSubscribed)text.textContent='Notifications push actives : vous serez prévenu même si la page de suivi est fermée.';
    else if(pushConfigured===false)text.textContent='Alertes actives sur la page. Le push en arrière-plan doit encore être configuré côté restaurant.';
    else text.textContent='Notifications activées. Connexion au service push en cours…';
    return;
  }
  btn.textContent='🔔 Activer les notifications';text.textContent='Activez les alertes pour être prévenu lorsque la commande passe en préparation, devient prête puis est remise.';
}

async function enableNotifications(){
  if(!('Notification' in window))return updateNotificationButton();
  await registerNotificationServiceWorker();
  let permission=Notification.permission;
  if(permission!=='granted')permission=await Notification.requestPermission();
  notificationsEnabled=permission==='granted';
  localStorage.setItem('pp-track-notifications',notificationsEnabled?'1':'0');
  if(notificationsEnabled&&activeCode)await subscribeForPush();
  updateNotificationButton();
  if(notificationsEnabled&&activeCode){
    try{sendCustomerNotification(await fetchTracking(activeCode))}catch{}
  }
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

  const previous=lastStatus||localStorage.getItem(statusStorageKey(data.code))||'';
  if(previous&&previous!==data.status)sendCustomerNotification(data);
  lastStatus=data.status;
  localStorage.setItem(statusStorageKey(data.code),data.status);
}

async function loadCode(code){
  const nextCode=cleanCode(code);
  if(nextCode.length!==4)return;
  if(nextCode!==activeCode){
    activeCode=nextCode;
    lastStatus=localStorage.getItem(statusStorageKey(activeCode))||'';
    pushSubscribed=localStorage.getItem(pushStorageKey(activeCode))==='1';
  }
  document.querySelector('#trackCode').value=activeCode;
  try{
    render(await fetchTracking(activeCode));
    if(notificationsEnabled&&Notification.permission==='granted'&&!pushSubscribed)subscribeForPush();
  }catch(e){
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
  document.querySelector('#notificationBtn')?.addEventListener('click',enableNotifications);
  registerNotificationServiceWorker();
  updateNotificationButton();
  const initial=cleanCode(new URLSearchParams(location.search).get('code')||localStorage.getItem('pp-last-order-code'));
  if(initial.length===4)loadCode(initial);
  refreshTimer=setInterval(()=>{if(activeCode)loadCode(activeCode)},5000);
});
