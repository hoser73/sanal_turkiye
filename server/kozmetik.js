// Kozmetikler: çatı rengi, flama ve unvan. Oyun avantajı vermez. Akçeyle alınan oyundan çıkar (enflasyon frenidir);
// rozetle açılanlar ilgili rozete sahip oyuncuya ücretsizdir.
const db = require('./db');
const L = require('./lib/ledger');
const { KOZMETIK } = require('./config/rules');
const { OyunHatasi } = L;

const bul = (kod) => (typeof kod === 'string' && Object.hasOwn(KOZMETIK, kod) ? KOZMETIK[kod] : null);
const sahip = (userId, kod) => !!db.prepare(`SELECT 1 FROM kozmetikler WHERE user_id = ? AND kod = ?`).get(userId, kod);
const rozetVar = (userId, onek) => !!db.prepare(`SELECT 1 FROM rozetler WHERE user_id = ? AND kod LIKE ?`).get(userId, `${onek}%`);
const kullanilabilir = (userId, kod, k) => sahip(userId, kod) || (k.rozet && rozetVar(userId, k.rozet));

function secili(userId) {
  const s = JSON.parse(db.prepare(`SELECT kozmetik FROM users WHERE id = ?`).get(userId)?.kozmetik || '{}');
  const cik = {};
  for (const [tur, kod] of Object.entries(s)) { const k = bul(kod); if (k?.tur === tur) cik[tur] = { kod, ...k }; }
  return cik;
}
// Haritadaki 3B parsel için kısa kod: "cati:#hex|bayrak:#hex"
function haritaKodu(userId) {
  const s = secili(userId);
  return [s.cati && `cati:${s.cati.renk}`, s.bayrak && `bayrak:${s.bayrak.renk}`].filter(Boolean).join('|');
}

function katalog(userId) {
  const s = secili(userId);
  return Object.entries(KOZMETIK).map(([kod, k]) => ({ kod, ...k, sahip: kullanilabilir(userId, kod, k), secili: s[k.tur]?.kod === kod,
    kilit: k.yol ? 'Sezon yolu ödülü' : k.rozet ? `${k.rozet === 'SEZON_' ? 'İl ligi sezon rozeti' : 'Albüm bölge rozeti'} gerekir` : null }));
}
const al = db.transaction((userId, kod) => {
  const k = bul(kod);
  if (!k) throw new OyunHatasi(404, 'Kozmetik bulunamadı');
  if (!k.fiyat) throw new OyunHatasi(409, k.yol ? 'Bu kozmetik sezon yolunda kazanılır' : 'Bu kozmetik satın alınamaz; rozetle açılır');
  if (sahip(userId, kod)) throw new OyunHatasi(409, 'Zaten sende');
  L.harca(userId, k.fiyat, `Kozmetik: ${k.ad}`);
  db.prepare(`INSERT INTO kozmetikler (user_id, kod, created_at) VALUES (?, ?, ?)`).run(userId, kod, Date.now());
  L.denetim({ aktor: userId, eylem: 'COSMETIC_BOUGHT', varlik: kod, sonra: { fiyat: k.fiyat } });
  return { tamam: true };
});
function sec(userId, { tur, kod } = {}) {
  if (!['cati', 'bayrak', 'unvan'].includes(tur)) throw new OyunHatasi(400, 'Geçersiz tür');
  const s = JSON.parse(db.prepare(`SELECT kozmetik FROM users WHERE id = ?`).get(userId).kozmetik || '{}');
  if (kod == null || kod === '') delete s[tur];
  else {
    const k = bul(kod);
    if (!k || k.tur !== tur) throw new OyunHatasi(400, 'Geçersiz kozmetik');
    if (!kullanilabilir(userId, kod, k)) throw new OyunHatasi(403, 'Bu kozmetik sende yok');
    s[tur] = kod;
  }
  db.prepare(`UPDATE users SET kozmetik = ? WHERE id = ?`).run(JSON.stringify(s), userId);
  return { tamam: true };
}

function rotalar(app, { h, auth }) {
  app.get('/api/kozmetik', auth.girisGerekli, h((req) => katalog(req.kullanici.id)));
  app.post('/api/kozmetik/al', auth.girisGerekli, h((req) => al(req.kullanici.id, req.body?.kod)));
  app.post('/api/kozmetik/sec', auth.girisGerekli, h((req) => sec(req.kullanici.id, req.body)));
}
module.exports = { rotalar, katalog, al, sec, secili, haritaKodu };
