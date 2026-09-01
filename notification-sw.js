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
