(function(){
  const button=document.querySelector('#adminNotificationBtn');
  const state=document.querySelector('#adminNotificationState');
  const supported='Notification' in window;
  let enabled=localStorage.getItem('pp-admin-notifications')==='1';
  let registration=null;

  async function registerWorker(){
    if(!('serviceWorker' in navigator))return null;
    try{registration=await navigator.serviceWorker.register('/notification-sw.js');return registration}catch{return null}
  }

  async function showNotification(title,options){
    if(!enabled||!supported||Notification.permission!=='granted')return;
    try{
      const reg=registration||await registerWorker();
      if(reg?.showNotification){await reg.showNotification(title,options);return;}
      new Notification(title,options);
    }catch{}
  }

  function refreshButton(){
    if(!button||!state)return;
    if(!supported){
      button.disabled=true;
      button.textContent='Notifications non prises en charge';
      state.textContent='Le navigateur de cette tablette ne permet pas les notifications système.';
      return;
    }
    if(Notification.permission==='denied'){
      button.disabled=true;
      button.textContent='Notifications bloquées';
      state.textContent='Autorisez les notifications Planet Pizza dans les réglages du navigateur.';
      return;
    }
    if(Notification.permission==='granted'&&enabled){
      button.textContent='🔔 Alertes tablette activées';
      state.textContent='La tablette sera alertée uniquement lorsqu’une nouvelle commande payée arrive à prendre en charge.';
      return;
    }
    button.textContent='🔔 Activer les alertes tablette';
    state.textContent='Une alerte sonore, visuelle et système sera envoyée uniquement à l’arrivée d’une nouvelle commande payée.';
  }

  async function enable(){
    if(!supported)return refreshButton();
    await registerWorker();
    let permission=Notification.permission;
    if(permission!=='granted')permission=await Notification.requestPermission();
    enabled=permission==='granted';
    localStorage.setItem('pp-admin-notifications',enabled?'1':'0');
    refreshButton();
    if(enabled){
      showNotification('Planet Pizza',{body:'Alertes tablette activées. Vous serez prévenu à la prochaine nouvelle commande.',icon:'/logo2.png',badge:'/logo2.png',tag:'planet-pizza-admin-test',data:{url:'/admin.html'}});
    }
  }

  if(button)button.addEventListener('click',enable);
  registerWorker();
  refreshButton();

  if(typeof notifyNewPaidOrder==='function'){
    const originalNotify=notifyNewPaidOrder;
    notifyNewPaidOrder=function(order){
      originalNotify(order);
      const code=typeof orderNumber==='function'?orderNumber(order.id):String(order.id);
      showNotification(`🍕 Nouvelle commande ${code}`,{
        body:'Nouvelle commande payée à prendre en charge maintenant.',
        icon:'/logo2.png',
        badge:'/logo2.png',
        tag:`planet-pizza-order-${order.id}`,
        renotify:true,
        requireInteraction:true,
        data:{url:'/admin.html'}
      });
    };
  }
})();
