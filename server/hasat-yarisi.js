// Kooperatif hasat yarışı: haftalık takım yarışı (haftalar il ligiyle aynı takvimde, LIG.baslangic'tan 7'şer gün).
// Kooperatif üyesinin oyun eylemleri (olay yolu) kooperatifinin o haftaki puanına eklenir; aynı işten günde en çok
// HASAT_YARISI.gunlukTavan kayıt sayılır. Hafta bitince bir kez sonuçlanır: ulaşılan takım sandıkları en az minKatki
// puan veren üyelere akçe olarak dağıtılır; Türkiye sıralamasında ilk üç aktif kooperatifin ortak kasasına (KOOP:<id>)
// bonus girer. Demo hesaplar puan almaz.
const db = require('./db');
const L = require('./lib/ledger');
const { HASAT_YARISI: Y, KOOPERATIF, LIG } = require('./config/rules');
const { yol } = require('./lib/olaylar');

db.exec(`
CREATE TABLE IF NOT EXISTS koop_yaris (
  hafta INTEGER NOT NULL, koop_id INTEGER NOT NULL REFERENCES kooperatifler(id), user_id INTEGER NOT NULL REFERENCES users(id),
  puan INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (hafta, koop_id, user_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ix_koop_yaris_koop ON koop_yaris(koop_id, hafta);
CREATE TABLE IF NOT EXISTS koop_yaris_gunluk (
  user_id INTEGER NOT NULL, gun TEXT NOT NULL, eylem TEXT NOT NULL, adet INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, gun, eylem)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS koop_yaris_sonuc (
  hafta INTEGER NOT NULL, koop_id INTEGER NOT NULL, sira INTEGER, puan INTEGER NOT NULL, sandik INTEGER NOT NULL, bonus INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hafta, koop_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS koop_yaris_hafta (hafta INTEGER PRIMARY KEY, sonuclandi_at INTEGER NOT NULL);
`);

const HAFTA = 7 * 86_400_000, TR_SAAT = 3 * 3600_000;
const haftaNo = (t = Date.now()) => Math.floor((t - LIG.baslangic) / HAFTA);
const haftaBitis = (h) => LIG.baslangic + (h + 1) * HAFTA;
const gunAnahtari = (t) => new Date(t + TR_SAAT).toISOString().slice(0, 10);
const sandikSayisi = (puan) => Y.sandiklar.filter((s) => puan >= s.esik).length;

const q = {
  uyelik: db.prepare(`SELECT u.koop_id FROM kooperatif_uyeleri u JOIN kooperatifler k ON k.id = u.koop_id JOIN users x ON x.id = u.user_id
    WHERE u.user_id = ? AND k.durum = 'AKTIF' AND x.is_npc = 0`),
  gunluk: db.prepare(`INSERT INTO koop_yaris_gunluk (user_id, gun, eylem, adet) VALUES (?, ?, ?, 1)
    ON CONFLICT (user_id, gun, eylem) DO UPDATE SET adet = adet + 1 RETURNING adet`),
  ekle: db.prepare(`INSERT INTO koop_yaris (hafta, koop_id, user_id, puan) VALUES (?, ?, ?, ?)
    ON CONFLICT (hafta, koop_id, user_id) DO UPDATE SET puan = puan + excluded.puan`),
  takimlar: db.prepare(`SELECT y.koop_id, SUM(y.puan) AS puan, k.ad, r.name AS il,
      (SELECT COUNT(*) FROM kooperatif_uyeleri u WHERE u.koop_id = y.koop_id) AS uye
    FROM koop_yaris y JOIN kooperatifler k ON k.id = y.koop_id JOIN regions r ON r.id = k.il_id
    WHERE y.hafta = ? GROUP BY y.koop_id ORDER BY puan DESC, MIN(y.koop_id)`),
  katkilar: db.prepare(`SELECT y.user_id, y.puan, u.display_name AS ad FROM koop_yaris y JOIN users u ON u.id = y.user_id
    WHERE y.hafta = ? AND y.koop_id = ? ORDER BY y.puan DESC`),
};

function puanVer(userId, eylem, t = Date.now()) {
  const p = Y.puanlar[eylem];
  if (!p || !userId) return 0;
  const u = q.uyelik.get(userId);
  if (!u) return 0;
  if (q.gunluk.get(userId, gunAnahtari(t), eylem).adet > Y.gunlukTavan) return 0;
  q.ekle.run(haftaNo(t), u.koop_id, userId, p);
  return p;
}
yol.on('eylem', ({ eylem, aktor }) => {
  try { puanVer(aktor, eylem); } catch { /* kullanıcı ya da kooperatif silinmiş olabilir */ }
});

// Sıralamaya yalnızca aktif (en az minAktifUye üyeli) kooperatifler girer
const aktifTakimlar = (h) => q.takimlar.all(h).filter((x) => x.uye >= KOOPERATIF.minAktifUye);

// Biten haftayı bir kez sonuçlandır (koop_yaris_hafta birincil anahtarı ikinci kez çalışmayı engeller)
const sonuclandir = db.transaction((h) => {
  if (h < 0 || db.prepare('SELECT 1 FROM koop_yaris_hafta WHERE hafta = ?').get(h)) return false;
  db.prepare('INSERT INTO koop_yaris_hafta (hafta, sonuclandi_at) VALUES (?, ?)').run(h, Date.now());
  const sirali = aktifTakimlar(h);
  const sira = new Map(sirali.map((x, i) => [x.koop_id, i + 1]));
  for (const tk of q.takimlar.all(h)) {
    const s = sandikSayisi(tk.puan), no = sira.get(tk.koop_id) ?? null;
    const bonus = no && no <= Y.kasaBonusu.length ? Y.kasaBonusu[no - 1] : 0;
    db.prepare('INSERT INTO koop_yaris_sonuc (hafta, koop_id, sira, puan, sandik, bonus) VALUES (?, ?, ?, ?, ?, ?)').run(h, tk.koop_id, no, tk.puan, s, bonus);
    const tx = L.yeniTx();
    if (bonus) L.aktar({ kaynak: 'SYS:MINT', hedef: `KOOP:${tk.koop_id}`, tutar: bonus, sebep: `Hasat yarışı ${no}.lik bonusu`, tx });
    const odul = Y.sandiklar.slice(0, s).reduce((a, x) => a + x.odul, 0);
    for (const k of q.katkilar.all(h, tk.koop_id)) {
      const bildir = (m) => require('./pazar').bildir(k.user_id, m, 'arazilerim');
      if (odul && k.puan >= Y.minKatki) {
        L.odul(k.user_id, odul, `Hasat yarışı: ${s} sandık`, tx);
        bildir(`🏁 Hasat yarışı bitti: ${tk.ad} ${s} sandık açtı${no ? `, Türkiye ${no}.` : ''}. Payın +${odul} akçe`);
      } else if (no && no <= 3) bildir(`🏁 Hasat yarışında ${tk.ad} Türkiye ${no}. oldu!`);
    }
  }
  return true;
});
let sonBakim = 0;
function yarisBakim(t = Date.now()) {
  if (t - sonBakim < 60_000) return;
  sonBakim = t;
  sonuclandir(haftaNo(t) - 1);
}

function durumu(userId, t = Date.now()) {
  const h = haftaNo(t);
  sonuclandir(h - 1);
  const sirali = aktifTakimlar(h);
  const uyelik = userId ? q.uyelik.get(userId) : null;
  let benim = null;
  if (uyelik) {
    const tk = q.takimlar.all(h).find((x) => x.koop_id === uyelik.koop_id);
    const puan = tk?.puan || 0;
    const koop = db.prepare('SELECT ad, (SELECT COUNT(*) FROM kooperatif_uyeleri WHERE koop_id = ?) AS uye FROM kooperatifler WHERE id = ?').get(uyelik.koop_id, uyelik.koop_id);
    const katki = q.katkilar.all(h, uyelik.koop_id);
    benim = {
      koopId: uyelik.koop_id, ad: koop.ad, puan, aktif: koop.uye >= KOOPERATIF.minAktifUye,
      sira: sirali.findIndex((x) => x.koop_id === uyelik.koop_id) + 1 || null,
      sandiklar: Y.sandiklar.map((s) => ({ ...s, acik: puan >= s.esik })),
      katkim: katki.find((k) => k.user_id === userId)?.puan || 0,
      uyeler: katki.map((k) => ({ ad: k.ad, puan: k.puan, ben: k.user_id === userId })),
    };
  }
  const gecen = db.prepare(`SELECT s.sira, s.puan, s.sandik, s.bonus, k.ad FROM koop_yaris_sonuc s JOIN kooperatifler k ON k.id = s.koop_id
    WHERE s.hafta = ? AND s.sira IS NOT NULL ORDER BY s.sira LIMIT 3`).all(h - 1);
  return {
    hafta: h, bitis: haftaBitis(h), kalanMs: haftaBitis(h) - t, benim,
    siralama: sirali.slice(0, 10).map((x, i) => ({ sira: i + 1, ad: x.ad, il: x.il, puan: x.puan, uye: x.uye, ben: x.koop_id === uyelik?.koop_id })),
    gecenHafta: gecen, minKatki: Y.minKatki, kasaBonusu: Y.kasaBonusu, minUye: KOOPERATIF.minAktifUye,
    puanlar: Object.entries(Y.puanlar).map(([eylem, p]) => ({ eylem, puan: p })),
  };
}

function rotalar(app, { h }) {
  app.get('/api/hasat-yarisi', h((req) => durumu(req.kullanici?.id ?? null)));
}

module.exports = { rotalar, durumu, puanVer, sonuclandir, yarisBakim, haftaNo };
