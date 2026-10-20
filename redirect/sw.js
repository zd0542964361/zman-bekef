// הכתובת הישנה של "זמן בכיף": מוחקים את העותק השמור ושולחים את מי שפתוח לכתובת החדשה
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('https://zmanbekef.github.io/' + new URL(c.url).search).catch(() => {});
  })());
});
