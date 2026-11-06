// İmece: iki komşunun haftalık ortak hedefi (haftalar LIG.baslangic'tan 7'şer gün). Oyuncu bir komşusunu davet eder,
// komşu kabul edince ortaklık o hafta için kurulur. İkisinin oyun işleri (olay yolu) ortak puana yazar; aynı işten günde
// en çok IMECE.gunlukTavan kayıt sayılır. Ortak puan bir kademenin eşiğini geçince, en az minKatki puan katmış ortak o
// kademenin ödülünü alır (katkısı sonradan yetişen ortak geçilmiş kademeleri o an alır). Pasif ortak bırakılabilir; haftada
// en çok haftalikOrtak ortaklık kurulur. Demo komşu ortak olabilir (yalnız oynayan da imece yapsın) ama ödül almaz.
const db = require('./db');
const { tl } = require('./lib/para');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { IMECE: I, LIG, URUNLER } = require('./config/rules');
const { yol } = require('./lib/olaylar');

db.exec(`
CREATE TABLE IF NOT EXISTS imece (
  id INTEGER PRIMARY KEY, hafta INTEGER NOT NULL, a_id INTEGER NOT NULL REFERENCES users(id), b_id INTEGER NOT NULL REFERENCES users(id),
  durum TEXT NOT NULL DEFAULT 'DAVET',   -- DAVET / AKTIF / BITTI / RED
  puan_a INTEGER NOT NULL DEFAULT 0, puan_b INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, kabul_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_imece_a ON imece(a_id, hafta, durum);
CREATE INDEX IF NOT EXISTS ix_imece_b ON imece(b_id, hafta, durum);
CREATE TABLE IF NOT EXISTS imece_gunluk (
  user_id INTEGER NOT NULL, gun TEXT NOT NULL, eylem TEXT NOT NULL, adet INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, gun, eylem)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS imece_odul (
  imece_id INTEGER NOT NULL REFERENCES imece(id), user_id INTEGER NOT NULL, kademe INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (imece_id, user_id, kademe)
) WITHOUT ROWID;
`);

const HAFTA = 7 * 86_400_000;
const haftaNo = (t = Date.now()) => Math.floor((t - LIG.baslangic) / HAFTA);
const haftaBitis = (h) => LIG.baslangic + (h + 1) * HAFTA;
const gunAnahtari = (t) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
const q = {
  aktif: db.prepare(`SELECT * FROM imece WHERE hafta = ? AND durum = 'AKTIF' AND (a_id = ? OR b_id = ?)`),
  aktifler: db.prepare(`SELECT * FROM imece WHERE hafta = ? AND durum = 'AKTIF' AND (a_id = ? OR b_id = ?)`),
  kurulan: db.prepare(`SELECT COUNT(*) AS c FROM imece WHERE hafta = ? AND durum IN ('AKTIF', 'BITTI') AND (a_id = ? OR b_id = ?)`),
  gelen: db.prepare(`SELECT i.id, i.created_at, u.display_name AS ad FROM imece i JOIN users u ON u.id = i.a_id
    WHERE i.hafta = ? AND i.b_id = ? AND i.durum = 'DAVET' AND i.created_at > ?`),
  giden: db.prepare(`SELECT i.id, u.display_name AS ad FROM imece i JOIN users u ON u.id = i.b_id
    WHERE i.hafta = ? AND i.a_id = ? AND i.durum = 'DAVET' AND i.created_at > ?`),
  imece: db.prepare('SELECT * FROM imece WHERE id = ?'),
  gunluk: db.prepare(`INSERT INTO imece_gunluk (user_id, gun, eylem, adet) VALUES (?, ?, ?, 1)
    ON CONFLICT (user_id, gun, eylem) DO UPDATE SET adet = adet + 1 RETURNING adet`),
  arkadas: db.prepare(`SELECT 1 FROM arkadasliklar WHERE durum = 'KABUL' AND ((isteyen = ? AND hedef = ?) OR (isteyen = ? AND hedef = ?))`),
  kullanici: db.prepare('SELECT id, display_name AS ad, is_npc FROM users WHERE id = ?'),
};
const ortakId = (i, userId) => (i.a_id === userId ? i.b_id : i.a_id);
const katkisi = (i, userId) => (i.a_id === userId ? i.puan_a : i.puan_b);
const bildir = (userId, m) => require('./pazar').bildir(userId, m, 'gorevler');

// Geçilen kademelerin ödülü, katkısı yeten ve henüz almamış (gerçek) ortaklara
function oduller(i) {
  const toplam = i.puan_a + i.puan_b, t = Date.now();
  for (const userId of [i.a_id, i.b_id]) {
    if (katkisi(i, userId) < I.minKatki || q.kullanici.get(userId)?.is_npc) continue;
    I.kademeler.forEach((k, n) => {
      if (toplam < k.esik) return;
      if (db.prepare('INSERT OR IGNORE INTO imece_odul (imece_id, user_id, kademe, at) VALUES (?, ?, ?, ?)').run(i.id, userId, n + 1, t).changes !== 1) return;
      const tx = L.yeniTx();
      L.odul(userId, k.akce, `İmece ${n + 1}. kademe`, tx);
      if (k.esya) L.envanterDegis(userId, k.esya[0], k.esya[1], `İmece ${n + 1}. kademe`, tx);
      bildir(userId, `🤝 İmece ${n + 1}. kademe tamam! +${tl(k.akce)}${k.esya ? ` ve ${k.esya[1]} ${URUNLER[k.esya[0]].ad}` : ''}`);
    });
  }
}

function puanVer(userId, eylem, t = Date.now()) {
  const p = I.puanlar[eylem];
  if (!p || !userId) return 0;
  // Gerçek oyuncunun tek imecesi olur; demo komşu birden çok oyuncuya ortak olabilir
  const satirlar = q.aktifler.all(haftaNo(t), userId, userId);
  if (!satirlar.length) return 0;
  if (q.gunluk.get(userId, gunAnahtari(t), eylem).adet > I.gunlukTavan) return 0;
  for (const i of satirlar) {
    db.prepare(`UPDATE imece SET ${i.a_id === userId ? 'puan_a = puan_a' : 'puan_b = puan_b'} + ? WHERE id = ?`).run(p, i.id);
    oduller(q.imece.get(i.id));
  }
  return p;
}
yol.on('eylem', ({ eylem, aktor }) => {
  try { db.transaction(() => puanVer(aktor, eylem))(); } catch { /* kullanıcı silinmiş olabilir */ }
});

const davet = db.transaction((userId, hedefId) => {
  const t = Date.now(), h = haftaNo(t);
  hedefId = Number(hedefId);
  if (!q.kullanici.get(hedefId) || hedefId === userId) throw new OyunHatasi(404, 'Komşu bulunamadı');
  if (!q.arkadas.get(userId, hedefId, hedefId, userId)) throw new OyunHatasi(403, 'Yalnızca komşunu imeceye çağırabilirsin');
  if (q.aktif.get(h, userId, userId)) throw new OyunHatasi(409, 'Bu hafta zaten bir imecen var');
  const hedef = q.kullanici.get(hedefId);
  if (!hedef.is_npc && q.aktif.get(h, hedefId, hedefId)) throw new OyunHatasi(409, 'Komşunun bu hafta başka bir imecesi var');
  if (q.kurulan.get(h, userId, userId).c >= I.haftalikOrtak) throw new OyunHatasi(409, `Haftada en çok ${I.haftalikOrtak} imece kurulur`, 'HAFTALIK');
  if (q.giden.all(h, userId, t - I.davetSuresiMs).length) throw new OyunHatasi(409, 'Zaten bekleyen bir davetin var');
  const id = Number(db.prepare('INSERT INTO imece (hafta, a_id, b_id, created_at) VALUES (?, ?, ?, ?)').run(h, userId, hedefId, t).lastInsertRowid);
  if (hedef.is_npc) return kabulEt(hedefId, id);   // demo komşu hemen kabul eder
  bildir(hedefId, `🤝 ${q.kullanici.get(userId).ad} seni bu haftanın imecesine çağırıyor`);
  return { tamam: true, id };
});
function kabulEt(userId, id) {
  const i = q.imece.get(Number(id)), t = Date.now(), h = haftaNo(t);
  if (!i || i.b_id !== userId || i.durum !== 'DAVET' || i.hafta !== h || i.created_at <= t - I.davetSuresiMs) throw new OyunHatasi(404, 'Davet bulunamadı');
  for (const u of [i.a_id, i.b_id]) {
    if (q.kullanici.get(u).is_npc) continue;
    if (q.aktif.get(h, u, u)) throw new OyunHatasi(409, 'Bu hafta zaten bir imece var');
    if (q.kurulan.get(h, u, u).c >= I.haftalikOrtak) throw new OyunHatasi(409, `Haftada en çok ${I.haftalikOrtak} imece kurulur`, 'HAFTALIK');
  }
  db.prepare(`UPDATE imece SET durum = 'AKTIF', kabul_at = ? WHERE id = ?`).run(t, i.id);
  db.prepare(`UPDATE imece SET durum = 'RED' WHERE hafta = ? AND durum = 'DAVET' AND id <> ? AND (a_id IN (?, ?) OR b_id IN (?, ?))`).run(h, i.id, i.a_id, i.b_id, i.a_id, i.b_id);
  if (!q.kullanici.get(userId).is_npc) bildir(i.a_id, `🤝 ${q.kullanici.get(userId).ad} imece davetini kabul etti`);
  return { tamam: true, id: i.id };
}
const kabul = db.transaction(kabulEt);
const reddet = db.transaction((userId, id) => {
  const i = q.imece.get(Number(id));
  if (!i || i.b_id !== userId || i.durum !== 'DAVET') throw new OyunHatasi(404, 'Davet bulunamadı');
  db.prepare(`UPDATE imece SET durum = 'RED' WHERE id = ?`).run(i.id);
  return { tamam: true };
});
// Ortaklığı bırak: alınmış ödüller kalır; aynı hafta (sınır dahilinde) yeni ortak aranabilir
const birak = db.transaction((userId) => {
  const i = q.aktif.get(haftaNo(), userId, userId);
  if (!i) throw new OyunHatasi(404, 'Bu hafta imecen yok');
  db.prepare(`UPDATE imece SET durum = 'BITTI' WHERE id = ?`).run(i.id);
  const o = ortakId(i, userId);
  if (!q.kullanici.get(o)?.is_npc) bildir(o, `🤝 ${q.kullanici.get(userId).ad} imeceden ayrıldı; yeni bir komşuyla imece kurabilirsin`);
  return { tamam: true };
});

function durumu(userId, t = Date.now()) {
  const h = haftaNo(t), i = q.aktif.get(h, userId, userId);
  let aktif = null;
  if (i) {
    const o = q.kullanici.get(ortakId(i, userId)), toplam = i.puan_a + i.puan_b;
    const alinan = new Set(db.prepare('SELECT kademe FROM imece_odul WHERE imece_id = ? AND user_id = ?').all(i.id, userId).map((r) => r.kademe));
    aktif = {
      id: i.id, ortak: { id: o.id, ad: o.ad, demo: !!o.is_npc }, toplam, katkim: katkisi(i, userId), ortakKatki: katkisi(i, o.id),
      kademeler: I.kademeler.map((k, n) => ({ esik: k.esik, akce: k.akce, esya: k.esya ? { ikon: URUNLER[k.esya[0]].ikon, ad: URUNLER[k.esya[0]].ad, adet: k.esya[1] } : null,
        gecildi: toplam >= k.esik, alindi: alinan.has(n + 1) })),
    };
  }
  const arkadaslar = i ? [] : db.prepare(`SELECT u.id, u.display_name AS ad, u.is_npc AS demo FROM arkadasliklar a
      JOIN users u ON u.id = CASE WHEN a.isteyen = ? THEN a.hedef ELSE a.isteyen END
      WHERE a.durum = 'KABUL' AND (a.isteyen = ? OR a.hedef = ?) ORDER BY u.is_npc, u.display_name LIMIT 30`).all(userId, userId, userId)
    .filter((a) => a.demo || !q.aktif.get(h, a.id, a.id)).map((a) => ({ ...a, demo: !!a.demo }));
  return {
    hafta: h, bitis: haftaBitis(h), kalanMs: haftaBitis(h) - t, aktif,
    gelen: q.gelen.all(h, userId, t - I.davetSuresiMs), giden: q.giden.all(h, userId, t - I.davetSuresiMs)[0] || null,
    adaylar: arkadaslar, kalanOrtaklik: Math.max(0, I.haftalikOrtak - q.kurulan.get(h, userId, userId).c), minKatki: I.minKatki,
    kademeler: I.kademeler.map((k) => k.esik),
  };
}

function rotalar(app, { h, auth }) {
  app.get('/api/imece', auth.girisGerekli, h((req) => durumu(req.kullanici.id)));
  app.post('/api/imece/davet', auth.dogrulanmisGerekli, h((req) => davet(req.kullanici.id, req.body?.kullaniciId)));
  app.post('/api/imece/:id/kabul', auth.dogrulanmisGerekli, h((req) => kabul(req.kullanici.id, req.params.id)));
  app.post('/api/imece/:id/reddet', auth.girisGerekli, h((req) => reddet(req.kullanici.id, req.params.id)));
  app.post('/api/imece/birak', auth.girisGerekli, h((req) => birak(req.kullanici.id)));
}

module.exports = { rotalar, durumu, davet, kabul, reddet, birak, puanVer, haftaNo };
