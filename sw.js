const C='autoplanner-v4',F=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));
});

// Push-meldingen (Firebase Cloud Messaging). Mislukt het laden, dan werkt de app gewoon verder zonder meldingen.
let fbOK=false;
try{
  importScripts('firebase-config.js','https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
  if(self.FB_CONFIG&&!/^VUL/.test(self.FB_CONFIG.apiKey)){
    firebase.initializeApp(self.FB_CONFIG);
    fbOK=true;
    firebase.messaging().onBackgroundMessage(p=>{
      const d=p.data||{};
      return self.registration.showNotification(d.title||'Benny Berlingo',{body:d.body||'',icon:'icon-192.png',badge:'badge-96.png',tag:d.tag||undefined,vibrate:[120,60,120],data:{url:'./'}});
    });
  }
}catch(e){}
self.addEventListener('push',e=>{
  if(fbOK)return;
  try{const d=(e.data&&e.data.json().data)||{};e.waitUntil(self.registration.showNotification(d.title||'Benny Berlingo',{body:d.body||'',icon:'icon-192.png',badge:'badge-96.png',tag:d.tag||undefined,data:{url:'./'}}))}catch(x){}
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{
    for(const c of l){if('focus' in c)return c.focus()}
    return clients.openWindow((e.notification.data&&e.notification.data.url)||'./');
  }));
});
