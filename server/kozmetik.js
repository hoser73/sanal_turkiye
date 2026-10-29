// Kozmetikler: çatı rengi, flama ve unvan. Oyun avantajı vermez. Akçeyle alınan oyundan çıkar (enflasyon frenidir);
// rozetle açılanlar ilgili rozete sahip oyuncuya ücretsizdir.
const db = require('./db');
const L = require('./lib/ledger');
const { KOZMETIK } = require('./config/rules');
const { OyunHatasi } = L;

const bul = (kod) => (typeof kod === 'string' && Object.hasOwn(KOZMETIK, kod) ? KOZMETIK[kod] : null);
const sahip = async (userId, kod) => !!await db.get(`SELECT 1 FROM kozmetikler WHERE user_id = ? AND kod = ?`, userId, kod);
// Rozet kodları büyük harf ASCII; önek eşleşmesi iki motorda da aynı (Postgres LIKE büyük/küçük harf duyarlı)
const rozetVar = async (userId, onek) => !!await db.get(`SELECT 1 FROM rozetler WHERE user_id = ? AND kod LIKE ?`, userId, `${onek}%`);
const kullanilabilir = async (userId, kod, k) => await sahip(userId, kod) || (k.rozet && await rozetVar(userId, k.rozet));

async function secili(userId) {
  const s = JSON.parse((await db.get(`SELECT kozmetik FROM users WHERE id = ?`, userId))?.kozmetik || '{}');
  const cik = {};
  for (const [tur, kod] of Object.entries(s)) { const k = bul(kod); if (k?.tur === tur) cik[tur] = { kod, ...k }; }
  return cik;
}
// Haritadaki 3B parsel için kısa kod: "cati:#hex|bayrak:#hex"
async function haritaKodu(userId) {
  const s = await secili(userId);
  return [s.cati && `cati:${s.cati.renk}`, s.bayrak && `bayrak:${s.bayrak.renk}`].filter(Boolean).join('|');
}

async function katalog(userId) {
  const s = await secili(userId);
  const liste = [];
  for (const [kod, k] of Object.entries(KOZMETIK)) {
    liste.push({ kod, ...k, sahip: await kullanilabilir(userId, kod, k), secili: s[k.tur]?.kod === kod,
      kilit: k.yol ? 'Sezon yolu ödülü' : k.rozet ? `${k.rozet === 'SEZON_' ? 'Hasat yarışında ilk üç il rozeti' : 'Albüm bölge rozeti'} gerekir` : null });
  }
  return liste;
}
const al = (userId, kod) => db.tx(async () => {
  const k = bul(kod);
  if (!k) throw new OyunHatasi(404, 'Kozmetik bulunamadı');
  if (!k.fiyat) throw new OyunHatasi(409, k.yol ? 'Bu kozmetik sezon yolunda kazanılır' : 'Bu kozmetik satın alınamaz; rozetle açılır');
  if (await sahip(userId, kod)) throw new OyunHatasi(409, 'Zaten sende');
  // Birincil anahtar (oyuncu, kod): eşzamanlı ikinci satın alma satır yazamaz ve ödeme yapmaz
  if ((await db.run(`INSERT OR IGNORE INTO kozmetikler (user_id, kod, created_at) VALUES (?, ?, ?)`, userId, kod, Date.now())).changes !== 1) {
    throw new OyunHatasi(409, 'Zaten sende');
  }
  await L.harca(userId, k.fiyat, `Kozmetik: ${k.ad}`);
  await L.denetim({ aktor: userId, eylem: 'COSMETIC_BOUGHT', varlik: kod, sonra: { fiyat: k.fiyat } });
  return { tamam: true };
});
async function sec(userId, { tur, kod } = {}) {
  if (!['cati', 'bayrak', 'unvan'].includes(tur)) throw new OyunHatasi(400, 'Geçersiz tür');
  return db.tx(async () => {
    // Satır kilidi: eşzamanlı iki seçim birbirinin yazdığını ezmesin
    const s = JSON.parse((await db.get(`SELECT kozmetik FROM users WHERE id = ? FOR UPDATE`, userId)).kozmetik || '{}');
    if (kod == null || kod === '') delete s[tur];
    else {
      const k = bul(kod);
      if (!k || k.tur !== tur) throw new OyunHatasi(400, 'Geçersiz kozmetik');
      if (!await kullanilabilir(userId, kod, k)) throw new OyunHatasi(403, 'Bu kozmetik sende yok');
      s[tur] = kod;
    }
    await db.run(`UPDATE users SET kozmetik = ? WHERE id = ?`, JSON.stringify(s), userId);
    return { tamam: true };
  });
}

function rotalar(app, { h, auth }) {
  app.get('/api/kozmetik', auth.girisGerekli, h((req) => katalog(req.kullanici.id)));
  app.post('/api/kozmetik/al', auth.girisGerekli, h((req) => al(req.kullanici.id, req.body?.kod)));
  app.post('/api/kozmetik/sec', auth.girisGerekli, h((req) => sec(req.kullanici.id, req.body)));
}
module.exports = { rotalar, katalog, al, sec, secili, haritaKodu };
