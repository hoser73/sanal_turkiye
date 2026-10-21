// Canlı bağlantı (WebSocket, /canli): bildirimler, herkese açık oyun olayları ve sohbet mesajları anında iletilir.
// Kimlik oturum çerezinden okunur; Origin denetlenir (siteler arası WebSocket ele geçirmeye karşı). İstemci veriyi yine API'den okur.
const { WebSocketServer } = require('ws');
const auth = require('./auth');
const { yol } = require('./lib/olaylar');
const { kanalCoz } = require('./sohbet');

const MAKS_KANAL = 6;
const istemciler = new Set();

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
    wss.handleUpgrade(req, soket, bas, (ws) => baglandi(ws, req));
  });
  const nabiz = setInterval(() => {
    for (const ws of istemciler) {
      if (!ws.canli) { ws.terminate(); continue; }
      ws.canli = false;
      ws.ping();
      // Oturum kapatıldıysa (çıkış, parola sıfırlama, hesap silme) kimlik düşer
      if (ws.kullanici && !auth.cereztenKullanici(ws.cerez)) { ws.kullanici = null; gonder(ws, { tip: 'oturum-kapandi' }); }
    }
  }, 30_000);
  nabiz.unref();
  wss.on('close', () => clearInterval(nabiz));
  return wss;
}

function gonder(ws, veri) {
  if (ws.readyState === 1) ws.send(JSON.stringify(veri));
}

function baglandi(ws, req) {
  ws.cerez = req.headers.cookie || '';
  ws.kullanici = auth.cereztenKullanici(ws.cerez);
  ws.kanallar = new Set();
  ws.canli = true;
  ws.kova = { t: Date.now(), n: 0 };
  istemciler.add(ws);
  ws.on('pong', () => { ws.canli = true; });
  ws.on('close', () => { istemciler.delete(ws); kanalSayilariniYay([...ws.kanallar]); });
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

function kanalSayilariniYay(kanallar) {
  for (const k of kanallar) {
    let sayi = 0;
    for (const ws of istemciler) if (ws.kanallar.has(k)) sayi++;
    for (const ws of istemciler) if (ws.kanallar.has(k)) gonder(ws, { tip: 'cevrimici', kanal: k, sayi });
  }
}

yol.on('bildirim', (b) => {
  for (const ws of istemciler) if (ws.kullanici?.id === b.userId) gonder(ws, { tip: 'bildirim', metin: b.metin, link: b.link });
});
yol.on('olay', (o) => {
  for (const ws of istemciler) gonder(ws, { tip: 'olay', eylem: o.eylem, bolge: o.bolge });
});
yol.on('sohbet', ({ kanal, mesaj }) => {
  for (const ws of istemciler) {
    if (ws.kanallar.has(kanal)) gonder(ws, { tip: 'sohbet', kanal, mesaj: { id: mesaj.id, metin: mesaj.metin, ad: mesaj.ad, zaman: mesaj.zaman, ben: ws.kullanici?.id === mesaj.userId } });
  }
});

const baglantiSayisi = () => istemciler.size;
module.exports = { bagla, baglantiSayisi };
