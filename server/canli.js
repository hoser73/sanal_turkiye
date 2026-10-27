// Canlı bağlantı (WebSocket, /canli): bildirimler, herkese açık oyun olayları ve sohbet mesajları anında iletilir.
// Kimlik oturum çerezinden okunur; Origin denetlenir (siteler arası WebSocket ele geçirmeye karşı). İstemci veriyi yine API'den okur.
const { WebSocketServer } = require('ws');
const auth = require('./auth');
const { yol } = require('./lib/olaylar');
const { kanalCoz } = require('./sohbet');

const MAKS_KANAL = 6;
// Bağlantı sınırı: IP başına ve toplam (boşta binlerce bağlantı her olayı pahalılaştırmasın)
const MAKS_IP_BAGLANTI = Number(process.env.WS_IP_SINIRI || 8), MAKS_BAGLANTI = Number(process.env.WS_TOPLAM_SINIRI || 20000);
const ipSayilari = new Map();
const istemciIp = (req) => (process.env.NODE_ENV === 'production' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?';
const istemciler = new Set();
const kullaniciSoketleri = new Map();   // userId → Set<ws>: bildirim yalnızca o oyuncunun bağlantılarına gider (herkes taranmaz)
function kullaniciBagla(ws, kullanici) {
  if (ws.kullanici) { const s = kullaniciSoketleri.get(ws.kullanici.id); s?.delete(ws); if (s && !s.size) kullaniciSoketleri.delete(ws.kullanici.id); }
  ws.kullanici = kullanici;
  if (kullanici) { if (!kullaniciSoketleri.has(kullanici.id)) kullaniciSoketleri.set(kullanici.id, new Set()); kullaniciSoketleri.get(kullanici.id).add(ws); }
}

function bagla(sunucu) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  sunucu.on('upgrade', (req, soket, bas) => {
    if (new URL(req.url, 'http://x').pathname !== '/canli') return soket.destroy();
    const origin = req.headers.origin;
    if (origin) {
      let tamam = false;
      try { tamam = new URL(origin).host === req.headers.host; } catch { /* geçersiz */ }
      if (!tamam) { soket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return soket.destroy(); }
    }
    const ip = istemciIp(req);
    if ((ipSayilari.get(ip) || 0) >= MAKS_IP_BAGLANTI || istemciler.size >= MAKS_BAGLANTI) { soket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); return soket.destroy(); }
    wss.handleUpgrade(req, soket, bas, (ws) => { ws.ip = ip; ipSayilari.set(ip, (ipSayilari.get(ip) || 0) + 1); baglandi(ws, req); });
  });
  const nabiz = setInterval(() => {
    for (const ws of istemciler) {
      if (!ws.canli) { ws.terminate(); continue; }
      ws.canli = false;
      ws.ping();
      // Oturum kapatıldıysa (çıkış, parola sıfırlama, hesap silme) kimlik düşer
      if (ws.kullanici && !auth.cereztenKullanici(ws.cerez)) { kullaniciBagla(ws, null); gonder(ws, { tip: 'oturum-kapandi' }); }
    }
  }, 30_000);
  nabiz.unref();
  wss.on('close', () => clearInterval(nabiz));
  return wss;
}

function gonder(ws, veri) {
  if (ws.readyState === 1) ws.send(typeof veri === 'string' ? veri : JSON.stringify(veri));
}

function baglandi(ws, req) {
  ws.cerez = req.headers.cookie || '';
  ws.kullanici = null;
  kullaniciBagla(ws, auth.cereztenKullanici(ws.cerez));
  ws.kanallar = new Set();
  ws.canli = true;
  ws.kova = { t: Date.now(), n: 0 };
  istemciler.add(ws);
  ws.on('pong', () => { ws.canli = true; });
  ws.on('close', () => {
    istemciler.delete(ws); kullaniciBagla(ws, null); kanalSayilariniYay([...ws.kanallar]);
    const n = (ipSayilari.get(ws.ip) || 1) - 1;
    if (n > 0) ipSayilari.set(ws.ip, n); else ipSayilari.delete(ws.ip);
  });
  ws.on('message', (ham) => {
    const t = Date.now();
    if (t - ws.kova.t > 10_000) ws.kova = { t, n: 0 };
    if (++ws.kova.n > 20) return ws.close(1008, 'Çok fazla ileti');
    let m;
    try { m = JSON.parse(ham); } catch { return; }
    if (m?.tip === 'abone' && Array.isArray(m.kanallar)) {
      const eski = [...ws.kanallar];
      ws.kanallar = new Set();
      for (const k of m.kanallar.slice(0, MAKS_KANAL)) { try { ws.kanallar.add(kanalCoz(k).kanal); } catch { /* geçersiz kanal yok sayılır */ } }
      kanalSayilariniYay([...new Set([...eski, ...ws.kanallar])]);
    }
  });
  gonder(ws, { tip: 'merhaba', kullanici: ws.kullanici ? { id: ws.kullanici.id, ad: ws.kullanici.display_name } : null });
}

// Çevrimiçi sayıları: her abonelik/ayrılışta değil, değişen kanallar biriktirilip 3 sn'de bir tek geçişte yayılır
// (yeniden bağlanma fırtınasında her bağlantı için bütün istemcileri taramak O(N²) olurdu)
const kirliKanallar = new Set();
const SAYIM_GECIKME = process.env.ONBELLEK === 'kapali' ? 0 : 3000;   // testte anında
let sayimZamanlayici = 0;
function kanalSayilariniYay(kanallar) {
  for (const k of kanallar) kirliKanallar.add(k);
  if (sayimZamanlayici) return;
  sayimZamanlayici = setTimeout(() => {
    sayimZamanlayici = 0;
    const sayilar = new Map([...kirliKanallar].map((k) => [k, 0]));
    kirliKanallar.clear();
    for (const ws of istemciler) for (const k of ws.kanallar) if (sayilar.has(k)) sayilar.set(k, sayilar.get(k) + 1);
    const iletiler = new Map([...sayilar].map(([k, sayi]) => [k, JSON.stringify({ tip: 'cevrimici', kanal: k, sayi })]));
    for (const ws of istemciler) for (const k of ws.kanallar) if (iletiler.has(k)) gonder(ws, iletiler.get(k));
  }, SAYIM_GECIKME);
  sayimZamanlayici.unref?.();
}

yol.on('bildirim', (b) => {
  const soketler = kullaniciSoketleri.get(b.userId);
  if (!soketler) return;
  const ileti = JSON.stringify({ tip: 'bildirim', metin: b.metin, link: b.link });
  for (const ws of soketler) gonder(ws, ileti);
});
// Herkese açık olay: haritadaki canlı baloncuklar için parsel kimliği (konum) gider; kimin yaptığı gitmez, yalnızca alıcının kendisi mi
const PARSEL_KIMLIGI = /^TR-\d{7}-\d{7}$/;
yol.on('olay', (o) => {
  const parsel = typeof o.varlik === 'string' && PARSEL_KIMLIGI.test(o.varlik) ? o.varlik : undefined;
  // İleti bir kez metne çevrilir (herkese aynı); yalnızca olayı yapanın kendi bağlantılarına "ben" sürümü gider
  const herkes = JSON.stringify({ tip: 'olay', eylem: o.eylem, bolge: o.bolge, parsel, ben: false });
  const kendi = o.aktor ? kullaniciSoketleri.get(o.aktor) : null;
  const benIleti = kendi ? JSON.stringify({ tip: 'olay', eylem: o.eylem, bolge: o.bolge, parsel, ben: true }) : null;
  for (const ws of istemciler) gonder(ws, kendi?.has(ws) ? benIleti : herkes);
});
yol.on('sohbet', ({ kanal, mesaj }) => {
  for (const ws of istemciler) {
    if (ws.kanallar.has(kanal)) gonder(ws, { tip: 'sohbet', kanal, mesaj: { id: mesaj.id, metin: mesaj.metin, ad: mesaj.ad, zaman: mesaj.zaman, ben: ws.kullanici?.id === mesaj.userId, demo: !!mesaj.demo } });
  }
});

const baglantiSayisi = () => istemciler.size;
module.exports = { bagla, baglantiSayisi };
