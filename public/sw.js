// Sanal Türkiye servis çalışanı: uygulama kabuğunu önbelleğe alır (çevrimdışı açılış), API'yi her zaman ağdan ister,
// imar karolarını sınırlı önbellekte tutar ve web push bildirimlerini gösterir.
const SURUM = 'st-v0.6.2';
const KABUK = [
  '/', '/index.html', '/cevrimdisi.html', '/css/app.css', '/icon.svg', '/manifest.json',
  '/js/app.js', '/js/yardimci.js', '/js/harita.js', '/js/stil.js', '/js/izgara.js', '/js/modeller.js', '/js/sahne3d.js',
  '/js/pazar-ui.js', '/js/secim-ui.js', '/js/belediye-ui.js', '/js/hesap-ui.js', '/js/dilekce-ui.js', '/js/canli.js', '/js/sohbet-ui.js', '/js/lig-ui.js', '/js/gunes.js', '/js/topluluk-ui.js', '/js/foto.js', '/js/harita-gorsel.js',
  '/vendor/maplibre/maplibre-gl.css', '/vendor/maplibre/maplibre-gl.mjs', '/vendor/three/three.module.js', '/css/sayfa.css',
  '/veri/iller.geojson', '/veri/il-etiketleri.geojson', '/veri/maske.geojson', '/veri/turkiye.geojson',
];
const KARO_ONBELLEK = 'st-karolar';
const KARO_SINIRI = 400;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SURUM).then((c) => c.addAll(KABUK)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ad) => Promise.all(ad.filter((k) => k !== SURUM && k !== KARO_ONBELLEK).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function karoOnbellegi(istek) {
  const c = await caches.open(KARO_ONBELLEK);
  const var_ = await c.match(istek);
  const ag = fetch(istek).then(async (y) => {
    if (y.ok) {
      await c.put(istek, y.clone());
      const anahtarlar = await c.keys();
      if (anahtarlar.length > KARO_SINIRI) await Promise.all(anahtarlar.slice(0, anahtarlar.length - KARO_SINIRI).map((k) => c.delete(k)));
    }
    return y;
  }).catch(() => var_);
  return var_ || ag;
}

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // dış karolar tarayıcı önbelleğine kalır
  if (u.pathname.startsWith('/api/karo/')) return e.respondWith(karoOnbellegi(e.request));
  if (u.pathname.startsWith('/api/') || u.pathname === '/canli') return;     // oyun verisi her zaman güncel olmalı
  if (e.request.mode === 'navigate') {
    // Sayfa: önce ağ (güncel sürüm), ağ yoksa kabuk, o da yoksa çevrimdışı sayfası
    return e.respondWith(fetch(e.request).catch(async () => (await caches.match('/index.html')) || caches.match('/cevrimdisi.html')));
  }
  // Statik dosyalar: önce ağ (her zaman güncel kod), ağ yoksa önbellek. Büyük kütüphaneler (vendor) önbellekten.
  if (u.pathname.startsWith('/vendor/')) {
    return e.respondWith(caches.open(SURUM).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((y) => { if (y.ok) c.put(e.request, y.clone()); return y; })));
  }
  e.respondWith(caches.open(SURUM).then((c) => fetch(e.request)
    .then((y) => { if (y.ok) c.put(e.request, y.clone()); return y; })
    .catch(async () => (await c.match(e.request)) || Response.error())));
});

self.addEventListener('push', (e) => {
  let v = {};
  try { v = e.data.json(); } catch { v = { metin: e.data?.text() }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((pencereler) => {
    // Açık ve görünür bir sekme varsa bildirim zaten oyunda gösterilir
    if (pencereler.some((p) => p.visibilityState === 'visible')) return;
    return self.registration.showNotification(v.baslik || 'Sanal Türkiye', {
      body: v.metin || '', icon: '/icon.svg', badge: '/icon.svg', tag: v.link || 'st', data: { link: v.link || null }, lang: 'tr',
    });
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hedef = '/' + (e.notification.data?.link ? `#git=${encodeURIComponent(e.notification.data.link)}` : '');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((p) => {
    const acik = p.find((x) => new URL(x.url).origin === location.origin);
    if (acik) { acik.postMessage({ tip: 'git', link: e.notification.data?.link }); return acik.focus(); }
    return self.clients.openWindow(hedef);
  }));
});
