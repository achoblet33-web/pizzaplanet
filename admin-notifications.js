(function(){
  const button=document.querySelector('#adminNotificationBtn');
  const state=document.querySelector('#adminNotificationState');
  const supported='Notification' in window;
  let enabled=localStorage.getItem('pp-admin-notifications')==='1';

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
    let permission=Notification.permission;
    if(permission!=='granted')permission=await Notification.requestPermission();
    enabled=permission==='granted';
    localStorage.setItem('pp-admin-notifications',enabled?'1':'0');
    refreshButton();
    if(enabled){
      try{new Notification('Planet Pizza',{body:'Alertes tablette activées. Vous serez prévenu à la prochaine nouvelle commande.',icon:'logo2.png',tag:'planet-pizza-admin-test'})}catch{}
    }
  }

  if(button)button.addEventListener('click',enable);
  refreshButton();

  if(typeof notifyNewPaidOrder==='function'){
    const originalNotify=notifyNewPaidOrder;
    notifyNewPaidOrder=function(order){
      originalNotify(order);
      if(!enabled||!supported||Notification.permission!=='granted')return;
      try{
        const code=typeof orderNumber==='function'?orderNumber(order.id):String(order.id);
        const n=new Notification(`🍕 Nouvelle commande ${code}`,{
          body:'Nouvelle commande payée à prendre en charge maintenant.',
          icon:'logo2.png',
          tag:`planet-pizza-order-${order.id}`,
          renotify:true,
          requireInteraction:true
        });
        n.onclick=()=>{window.focus();document.querySelector('[data-tab="orders"]')?.click();n.close()};
      }catch{}
    };
  }
})();
