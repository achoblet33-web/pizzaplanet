self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{}}catch{payload={body:event.data?.text?.()||''}}
  const title=payload.title||'Planet Pizza';
  const options={
    body:payload.body||'Votre commande a été mise à jour.',
    icon:'/logo2.png',
    badge:'/logo2.png',
    tag:payload.code?`planet-pizza-${payload.code}`:'planet-pizza-order',
    renotify:true,
    data:{url:payload.url||'/suivi.html'}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=event.notification.data?.url||'/';
  event.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
      for(const client of windows){
        if('focus' in client){
          client.navigate?.(target);
          return client.focus();
        }
      }
      return clients.openWindow?clients.openWindow(target):undefined;
    })
  );
});
