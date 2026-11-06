// Sezon yolu: her mevsim (Türkiye saatiyle Ara–Şub kış, Mar–May ilkbahar, Haz–Ağu yaz, Eyl–Kas sonbahar) ücretsiz, 30
// kademeli ödül yolu. Oyun eylemleri (olay yolundaki 'eylem') yol puanı verir; aynı eylem türünden günde en çok
// MEVSIM_YOLU.gunlukTavan kayıt sayılır (tek tek satarak kasılmasın). Kademe ödülü elle alınır: akçe, eşya (envanter)
// ya da yalnızca yolda kazanılan kozmetik. Mevsim bitince puan sıfırdan başlar (eski dönemin alınmamış ödülleri yanar).
const db = require('./db');
const { tl } = require('./lib/para');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { MEVSIM_YOLU: Y, MEVSIMLER, URUNLER, KOZMETIK } = require('./config/rules');
const { yol } = require('./lib/olaylar');

db.exec(`
CREATE TABLE IF NOT EXISTS yol_puanlari (
  user_id INTEGER NOT NULL REFERENCES users(id), donem TEXT NOT NULL, puan INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, donem)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS yol_gunluk (
  user_id INTEGER NOT NULL, gun TEXT NOT NULL, eylem TEXT NOT NULL, adet INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, gun, eylem)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS yol_odulleri (
  user_id INTEGER NOT NULL REFERENCES users(id), donem TEXT NOT NULL, kademe INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (user_id, donem, kademe)
) WITHOUT ROWID;
`);

const TR_SAAT = 3 * 3600_000;
const SONRAKI = { KIS: 3, ILKBAHAR: 6, YAZ: 9, SONBAHAR: 12 };   // bir sonraki mevsimin başladığı ay
function donem(t = Date.now()) {
  const d = new Date(t + TR_SAAT);
  const ay = d.getUTCMonth() + 1;
  const mevsim = Object.entries(MEVSIMLER).find(([, v]) => v.aylar.includes(ay))[0];
  const yil = d.getUTCFullYear() - (mevsim === 'KIS' && ay <= 2 ? 1 : 0);   // kış aralıkta başlar
  const bitisYil = mevsim === 'KIS' ? yil + 1 : yil;
  return { kod: `${yil}-${mevsim}`, mevsim, yil, bitis: Date.UTC(bitisYil, SONRAKI[mevsim] - 1, 1) - TR_SAAT };
}
const gunAnahtari = (t) => new Date(t + TR_SAAT).toISOString().slice(0, 10);
// n. kademeye ulaşmak için gereken toplam puan
const esik = (n) => Y.taban * n + (Y.artis * n * (n + 1)) / 2;

// Ödülün oyuncuya gösterilen hâli
function odulYazisi(o) {
  const p = [];
  if (o.kozmetik) p.push({ ikon: KOZMETIK[o.kozmetik].tur === 'cati' ? '🏠' : KOZMETIK[o.kozmetik].tur === 'bayrak' ? '🚩' : '🎖️', metin: KOZMETIK[o.kozmetik].ad, ozel: true });
  if (o.esya) p.push({ ikon: URUNLER[o.esya[0]]?.ikon || '📦', metin: `${o.esya[1]} ${URUNLER[o.esya[0]]?.ad || o.esya[0]}` });
  if (o.akce) p.push({ ikon: '₺', metin: `${tl(o.akce)}` });
  return p;
}

// ---------- Puan: oyun eylemleri (işlem bittikten sonra olay yolundan)
const q = {
  npc: db.prepare('SELECT is_npc FROM users WHERE id = ?'),
  gunluk: db.prepare(`INSERT INTO yol_gunluk (user_id, gun, eylem, adet) VALUES (?, ?, ?, 1)
    ON CONFLICT (user_id, gun, eylem) DO UPDATE SET adet = adet + 1 RETURNING adet`),
  puanEkle: db.prepare(`INSERT INTO yol_puanlari (user_id, donem, puan) VALUES (?, ?, ?)
    ON CONFLICT (user_id, donem) DO UPDATE SET puan = puan + excluded.puan`),
  puan: db.prepare('SELECT puan FROM yol_puanlari WHERE user_id = ? AND donem = ?'),
  alinanlar: db.prepare('SELECT kademe FROM yol_odulleri WHERE user_id = ? AND donem = ?'),
  odulYaz: db.prepare('INSERT OR IGNORE INTO yol_odulleri (user_id, donem, kademe, at) VALUES (?, ?, ?, ?)'),
};
function puanVer(userId, eylem, t = Date.now()) {
  const p = Y.puanlar[eylem];
  if (!p || !userId || q.npc.get(userId)?.is_npc) return 0;
  if (q.gunluk.get(userId, gunAnahtari(t), eylem).adet > Y.gunlukTavan) return 0;
  q.puanEkle.run(userId, donem(t).kod, p);
  return p;
}
yol.on('eylem', ({ eylem, aktor }) => {
  try { puanVer(aktor, eylem); } catch { /* kullanıcı silinmiş olabilir */ }
});

// ---------- Durum ve ödül alma
function durumu(userId, t = Date.now()) {
  const d = donem(t);
  const puan = q.puan.get(userId, d.kod)?.puan || 0;
  const alinan = new Set(q.alinanlar.all(userId, d.kod).map((r) => r.kademe));
  const kademeler = Array.from({ length: Y.kademe }, (_, i) => {
    const n = i + 1;
    return { n, esik: esik(n), odul: odulYazisi(Y.odul(n)), buyuk: n % 5 === 0, alindi: alinan.has(n), acik: puan >= esik(n) };
  });
  const ulasilan = kademeler.filter((k) => k.acik).length;
  return {
    donem: d.kod, mevsim: d.mevsim, ad: `${MEVSIMLER[d.mevsim].ad} yolu`, ikon: MEVSIMLER[d.mevsim].ikon, bitis: d.bitis, kalanMs: d.bitis - t,
    puan, ulasilan, sonraki: ulasilan < Y.kademe ? { n: ulasilan + 1, esik: esik(ulasilan + 1), eksik: esik(ulasilan + 1) - puan } : null,
    alinabilir: kademeler.filter((k) => k.acik && !k.alindi).length,
    kademeler,
    puanlar: Object.entries(Y.puanlar).map(([eylem, p]) => ({ ad: Y.eylemAdi[eylem], puan: p })),
    gunlukTavan: Y.gunlukTavan,
  };
}

// /api/ben için kısa özet (rozet ve görev şeridi ipucu)
function ozet(userId, t = Date.now()) {
  const d = donem(t), puan = q.puan.get(userId, d.kod)?.puan || 0;
  let ulasilan = 0;
  while (ulasilan < Y.kademe && puan >= esik(ulasilan + 1)) ulasilan++;
  return { puan, ulasilan, alinabilir: ulasilan - q.alinanlar.all(userId, d.kod).length };
}

const kademeAl = (userId, d, n, t) => {
  const puan = q.puan.get(userId, d.kod)?.puan || 0;
  if (puan < esik(n)) throw new OyunHatasi(409, `Bu kademe için ${esik(n)} puan gerekiyor (sende ${puan})`, 'YETERSIZ_PUAN');
  if (q.odulYaz.run(userId, d.kod, n, t).changes !== 1) throw new OyunHatasi(409, 'Bu kademenin ödülünü zaten aldın', 'ALINDI');
  const o = Y.odul(n), tx = L.yeniTx();
  if (o.akce) L.odul(userId, o.akce, `Sezon yolu ${n}. kademe`, tx);
  if (o.esya) L.envanterDegis(userId, o.esya[0], o.esya[1], `Sezon yolu ${n}. kademe`, tx);
  if (o.kozmetik) db.prepare('INSERT OR IGNORE INTO kozmetikler (user_id, kod, created_at) VALUES (?, ?, ?)').run(userId, o.kozmetik, t);
  L.denetim({ aktor: userId, eylem: 'SEASON_PATH_REWARD', varlik: `YOL:${d.kod}:${n}`, sonra: o });
  return o;
};
// kademe verilirse o kademe, verilmezse açık ve alınmamış bütün kademeler
const odulAl = db.transaction((userId, govde = {}) => {
  const t = Date.now(), d = donem(t);
  let liste;
  if (govde.kademe != null) {
    const n = govde.kademe;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > Y.kademe) throw new OyunHatasi(400, 'Geçersiz kademe');
    liste = [n];
  } else {
    const alinan = new Set(q.alinanlar.all(userId, d.kod).map((r) => r.kademe));
    const puan = q.puan.get(userId, d.kod)?.puan || 0;
    liste = Array.from({ length: Y.kademe }, (_, i) => i + 1).filter((n) => puan >= esik(n) && !alinan.has(n));
    if (!liste.length) throw new OyunHatasi(409, 'Alınacak ödül yok', 'BOS');
  }
  const toplam = { akce: 0, esya: [], kozmetik: [] };
  for (const n of liste) {
    const o = kademeAl(userId, d, n, t);
    toplam.akce += o.akce || 0;
    if (o.esya) toplam.esya.push(o.esya);
    if (o.kozmetik) toplam.kozmetik.push(KOZMETIK[o.kozmetik].ad);
  }
  return { tamam: true, kademeler: liste, ...toplam };
});

function rotalar(app, { h, auth }) {
  app.get('/api/yol', auth.girisGerekli, h((req) => durumu(req.kullanici.id)));
  app.post('/api/yol/al', auth.girisGerekli, h((req) => odulAl(req.kullanici.id, req.body || {})));
}

module.exports = { rotalar, durumu, ozet, odulAl, puanVer, donem, esik };
