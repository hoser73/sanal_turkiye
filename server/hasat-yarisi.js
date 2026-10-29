// Hasat yarışı: oyunun tek haftalık yarışı (haftalar LIG.baslangic'tan 7'şer gün). Oyuncunun işleri (olay yolu) iki
// yere puan yazar: kooperatifinin takım puanına ve ilinin puanına (memleketi; seçmediyse ilk tarlasının ili). Aynı işten
// günde en çok HASAT_YARISI.gunlukTavan kayıt sayılır. Hafta bitince bir kez sonuçlanır: aktif (en az minAktifUye üyeli)
// kooperatifin ulaşılan takım sandıkları en az minKatki puan veren üyelere akçe olarak dağıtılır (hafta içinde kooperatif
// değiştiren oyuncu yalnızca en çok katkı verdiği kooperatiften pay alır), Türkiye'de ilk üç aktif kooperatifin kasasına (KOOP:<id>) bonus girer;
// il sıralamasında (il puanı = toplam ÷ √oyuncu, kalabalık il kazanmasın) ilk üç ilin yeterli katkı veren oyuncularına
// ilOdulu verilir. (v0.41'e kadar ayrı bir 28 günlük il ligi vardı; bu yarışa katıldı.) Demo hesaplar puan almaz.
const db = require('./db');
const L = require('./lib/ledger');
const { HASAT_YARISI: Y, KOOPERATIF, LIG } = require('./config/rules');
const { yol } = require('./lib/olaylar');


const HAFTA = 7 * 86_400_000, TR_SAAT = 3 * 3600_000;
const haftaNo = (t = Date.now()) => Math.floor((t - LIG.baslangic) / HAFTA);
const haftaBitis = (h) => LIG.baslangic + (h + 1) * HAFTA;
const gunAnahtari = (t) => new Date(t + TR_SAAT).toISOString().slice(0, 10);
const sandikSayisi = (puan) => Y.sandiklar.filter((s) => puan >= s.esik).length;

const q = {
  uyelik: db.sorgu(`SELECT u.koop_id FROM kooperatif_uyeleri u JOIN kooperatifler k ON k.id = u.koop_id JOIN users x ON x.id = u.user_id
    WHERE u.user_id = ? AND k.durum = 'AKTIF' AND x.is_npc = 0`),
  // Güncellemede kolonlar tablo adıyla: Postgres'te yalın ad (excluded ile) belirsiz sayılır
  gunluk: db.sorgu(`INSERT INTO koop_yaris_gunluk (user_id, gun, eylem, adet) VALUES (?, ?, ?, 1)
    ON CONFLICT (user_id, gun, eylem) DO UPDATE SET adet = koop_yaris_gunluk.adet + 1 RETURNING adet`),
  ekle: db.sorgu(`INSERT INTO koop_yaris (hafta, koop_id, user_id, puan) VALUES (?, ?, ?, ?)
    ON CONFLICT (hafta, koop_id, user_id) DO UPDATE SET puan = koop_yaris.puan + excluded.puan`),
  takimlar: db.sorgu(`SELECT y.koop_id, SUM(y.puan) AS puan, k.ad, r.name AS il,
      (SELECT COUNT(*) FROM kooperatif_uyeleri u WHERE u.koop_id = y.koop_id) AS uye
    FROM koop_yaris y JOIN kooperatifler k ON k.id = y.koop_id JOIN regions r ON r.id = k.il_id
    WHERE y.hafta = ? GROUP BY y.koop_id, k.ad, r.name ORDER BY puan DESC, MIN(y.koop_id)`),
  katkilar: db.sorgu(`SELECT y.user_id, y.puan, u.display_name AS ad FROM koop_yaris y JOIN users u ON u.id = y.user_id
    WHERE y.hafta = ? AND y.koop_id = ? ORDER BY y.puan DESC`),
  // Oyuncunun yarıştığı il: memleketi, seçmediyse ilk edindiği tarlanın ili
  il: db.sorgu(`SELECT COALESCE((SELECT r.id FROM regions r WHERE r.type = 'IL' AND r.plaka = u.memleket_plaka),
      (SELECT p.il_id FROM parcels p WHERE p.owner_user_id = u.id ORDER BY p.acquired_at, p.id LIMIT 1)) AS il_id FROM users u WHERE u.id = ? AND u.is_npc = 0`),
  ilEkle: db.sorgu(`INSERT INTO koop_yaris_il (hafta, il_id, user_id, puan) VALUES (?, ?, ?, ?)
    ON CONFLICT (hafta, il_id, user_id) DO UPDATE SET puan = koop_yaris_il.puan + excluded.puan`),
  iller: db.sorgu(`SELECT y.il_id, r.name AS il, r.plaka, SUM(y.puan) AS puan, COUNT(*) AS oyuncu FROM koop_yaris_il y
    JOIN regions r ON r.id = y.il_id WHERE y.hafta = ? GROUP BY y.il_id, r.name, r.plaka`),
  ilKatkilar: db.sorgu('SELECT user_id, puan FROM koop_yaris_il WHERE hafta = ? AND il_id = ?'),
};
// İl sıralaması: il puanı = toplam ÷ √oyuncu (eşitlikte toplam puan)
const ilSiralamasi = async (h) => (await q.iller.all(h)).map((x) => ({ ...x, ilPuani: Math.round((x.puan / Math.sqrt(x.oyuncu)) * 10) / 10 }))
  .sort((a, b) => b.ilPuani - a.ilPuani || b.puan - a.puan || a.il_id - b.il_id).map((x, i) => ({ ...x, sira: i + 1 }));

// Kendi işlemini açar (çağıran işlemdeyse kayıt noktası olur)
function puanVer(userId, eylem, t = Date.now()) {
  const p = Y.puanlar[eylem];
  if (!p || !userId) return Promise.resolve(0);
  return db.tx(async () => {
    const u = await q.uyelik.get(userId), il = (await q.il.get(userId))?.il_id;
    if (!u && !il) return 0;
    if ((await q.gunluk.get(userId, gunAnahtari(t), eylem)).adet > Y.gunlukTavan) return 0;
    if (u) await q.ekle.run(haftaNo(t), u.koop_id, userId, p);
    if (il) await q.ilEkle.run(haftaNo(t), il, userId, p);
    return p;
  });
}
yol.on('eylem', ({ eylem, aktor }) => {
  puanVer(aktor, eylem).catch(() => { /* kullanıcı ya da kooperatif silinmiş olabilir */ });
});

// Sıralamaya yalnızca aktif (en az minAktifUye üyeli) kooperatifler girer
const aktifTakimlar = async (h) => (await q.takimlar.all(h)).filter((x) => x.uye >= KOOPERATIF.minAktifUye);

// Biten haftayı bir kez sonuçlandır (koop_yaris_hafta birincil anahtarı ikinci kez çalışmayı engeller)
const sonuclandir = (h) => db.tx(async () => {
  if (h < 0 || await db.get('SELECT 1 FROM koop_yaris_hafta WHERE hafta = ?', h)) return false;
  // Koşullu yazma: aynı anda iki sunucu/istek sonuçlandırmaya girerse yalnızca biri devam eder
  if ((await db.run('INSERT OR IGNORE INTO koop_yaris_hafta (hafta, sonuclandi_at) VALUES (?, ?)', h, Date.now())).changes !== 1) return false;
  const takimlar = await q.takimlar.all(h);
  const sira = new Map(takimlar.filter((x) => x.uye >= KOOPERATIF.minAktifUye).map((x, i) => [x.koop_id, i + 1]));
  // Sandık payı haftada oyuncu başına bir kez: birden çok kooperatifte katkısı varsa en çok katkı verdiğinden
  const payKoop = new Map();
  for (const tk of takimlar) {
    if (!sira.has(tk.koop_id) || !sandikSayisi(tk.puan)) continue;
    for (const k of await q.katkilar.all(h, tk.koop_id)) {
      const o = payKoop.get(k.user_id);
      if (k.puan >= Y.minKatki && (!o || k.puan > o.puan)) payKoop.set(k.user_id, { koop: tk.koop_id, puan: k.puan });
    }
  }
  for (const tk of takimlar) {
    const no = sira.get(tk.koop_id) ?? null, s = no ? sandikSayisi(tk.puan) : 0;
    const bonus = no && no <= Y.kasaBonusu.length ? Y.kasaBonusu[no - 1] : 0;
    await db.run('INSERT INTO koop_yaris_sonuc (hafta, koop_id, sira, puan, sandik, bonus) VALUES (?, ?, ?, ?, ?, ?)', h, tk.koop_id, no, tk.puan, s, bonus);
    const tx = L.yeniTx();
    if (bonus) await L.aktar({ kaynak: 'SYS:MINT', hedef: `KOOP:${tk.koop_id}`, tutar: bonus, sebep: `Hasat yarışı ${no}.lik bonusu`, tx });
    const odul = Y.sandiklar.slice(0, s).reduce((a, x) => a + x.odul, 0);
    for (const k of await q.katkilar.all(h, tk.koop_id)) {
      const bildir = (m) => require('./pazar').bildir(k.user_id, m, 'arazilerim');
      if (odul && payKoop.get(k.user_id)?.koop === tk.koop_id) {
        await L.odul(k.user_id, odul, `Hasat yarışı: ${s} sandık`, tx);
        await bildir(`🏁 Hasat yarışı bitti: ${tk.ad} ${s} sandık açtı${no ? `, Türkiye ${no}.` : ''}. Payın +${odul} akçe`);
      } else if (no && no <= 3) await bildir(`🏁 Hasat yarışında ${tk.ad} Türkiye ${no}. oldu!`);
    }
  }
  // İller: ilk üç ilin en az minKatki veren oyuncularına il ödülü
  for (const x of await ilSiralamasi(h)) {
    const odul = Y.ilOdulu[x.sira - 1] || 0;
    await db.run('INSERT INTO koop_yaris_il_sonuc (hafta, il_id, sira, puan, oyuncu, il_puani, odul) VALUES (?, ?, ?, ?, ?, ?, ?)', h, x.il_id, x.sira, x.puan, x.oyuncu, x.ilPuani, odul);
    if (!odul) continue;
    const tx = L.yeniTx();
    for (const k of await q.ilKatkilar.all(h, x.il_id)) {
      if (k.puan < Y.minKatki) continue;
      await L.odul(k.user_id, odul, `Hasat yarışı: ${x.il} ${x.sira}.`, tx);
      // SEZON_ ile başlayan rozet altın varak çatıyı ve "İl Şampiyonu" unvanını açar (kozmetik.js)
      await require('./dunya').rozetVer(k.user_id, `SEZON_${h}_${x.plaka}`, `${h}. hafta ${x.il} ${x.sira}.si`, ['🥇', '🥈', '🥉'][x.sira - 1], `Hasat yarışında ${x.il} Türkiye ${x.sira}. oldu; katkın ${k.puan} puan.`);
      await require('./pazar').bildir(k.user_id, `🗺️ Hasat yarışında ${x.il} Türkiye ${x.sira}. oldu! Katkın için +${odul} akçe`, 'arazilerim');
    }
  }
  return true;
});
let sonBakim = 0;
async function yarisBakim(t = Date.now()) {
  if (t - sonBakim < 60_000) return;
  sonBakim = t;
  await sonuclandir(haftaNo(t) - 1);
}

async function durumu(userId, t = Date.now()) {
  const h = haftaNo(t);
  await sonuclandir(h - 1);
  const sirali = await aktifTakimlar(h);
  const uyelik = userId ? await q.uyelik.get(userId) : null;
  let benim = null;
  if (uyelik) {
    const tk = (await q.takimlar.all(h)).find((x) => x.koop_id === uyelik.koop_id);
    const puan = tk?.puan || 0;
    const koop = await db.get('SELECT ad, (SELECT COUNT(*) FROM kooperatif_uyeleri WHERE koop_id = ?) AS uye FROM kooperatifler WHERE id = ?', uyelik.koop_id, uyelik.koop_id);
    const katki = await q.katkilar.all(h, uyelik.koop_id);
    benim = {
      koopId: uyelik.koop_id, ad: koop.ad, puan, aktif: koop.uye >= KOOPERATIF.minAktifUye,
      sira: sirali.findIndex((x) => x.koop_id === uyelik.koop_id) + 1 || null,
      sandiklar: Y.sandiklar.map((s) => ({ ...s, acik: puan >= s.esik })),
      katkim: katki.find((k) => k.user_id === userId)?.puan || 0,
      uyeler: katki.map((k) => ({ ad: k.ad, puan: k.puan, ben: k.user_id === userId })),
    };
  }
  const iller = await ilSiralamasi(h), benimIlId = userId ? (await q.il.get(userId))?.il_id : null;
  let benimIl = null;
  if (benimIlId) {
    const x = iller.find((i) => i.il_id === benimIlId);
    const r = await db.get('SELECT name, plaka FROM regions WHERE id = ?', benimIlId);
    const katkim = (await db.get('SELECT puan FROM koop_yaris_il WHERE hafta = ? AND il_id = ? AND user_id = ?', h, benimIlId, userId))?.puan || 0;
    benimIl = { il: r.name, plaka: r.plaka, sira: x?.sira || null, ilPuani: x?.ilPuani || 0, katkim };
  }
  const gecenIller = await db.all(`SELECT s.sira, s.il_puani AS ilPuani, r.name AS il FROM koop_yaris_il_sonuc s JOIN regions r ON r.id = s.il_id
    WHERE s.hafta = ? ORDER BY s.sira LIMIT 3`, h - 1);
  const gecen = await db.all(`SELECT s.sira, s.puan, s.sandik, s.bonus, k.ad FROM koop_yaris_sonuc s JOIN kooperatifler k ON k.id = s.koop_id
    WHERE s.hafta = ? AND s.sira IS NOT NULL ORDER BY s.sira LIMIT 3`, h - 1);
  return {
    hafta: h, bitis: haftaBitis(h), kalanMs: haftaBitis(h) - t, benim,
    siralama: sirali.slice(0, 10).map((x, i) => ({ sira: i + 1, ad: x.ad, il: x.il, puan: x.puan, uye: x.uye, ben: x.koop_id === uyelik?.koop_id })),
    gecenHafta: gecen, minKatki: Y.minKatki, kasaBonusu: Y.kasaBonusu, minUye: KOOPERATIF.minAktifUye,
    iller: iller.slice(0, 10).map((x) => ({ sira: x.sira, il: x.il, plaka: x.plaka, ilPuani: x.ilPuani, puan: x.puan, oyuncu: x.oyuncu, ben: x.il_id === benimIlId })),
    benimIl, gecenIller, ilOdulu: Y.ilOdulu,
    puanlar: Object.entries(Y.puanlar).map(([eylem, p]) => ({ eylem, puan: p })),
  };
}

function rotalar(app, { h }) {
  app.get('/api/hasat-yarisi', h((req) => durumu(req.kullanici?.id ?? null)));
}

// Çiftlik sekmesindeki kısa özet: haftanın bitişi, ilin sırası ve katkın
async function ozet(userId, t = Date.now()) {
  const h = haftaNo(t), il = (await q.il.get(userId))?.il_id;
  const katki = il ? (await db.get('SELECT puan FROM koop_yaris_il WHERE hafta = ? AND il_id = ? AND user_id = ?', h, il, userId))?.puan || 0 : 0;
  const x = il ? (await ilSiralamasi(h)).find((i) => i.il_id === il) : null;
  return { kalanMs: haftaBitis(h) - t, il: il ? (await db.get('SELECT name FROM regions WHERE id = ?', il)).name : null, sira: x?.sira || null, katkim: katki, minKatki: Y.minKatki };
}
// Memleket bilgisi için: ilin bu haftaki yarış sırası
const ilSirasi = async (ilId, t = Date.now()) => { const x = (await ilSiralamasi(haftaNo(t))).find((i) => i.il_id === ilId); return x ? { sira: x.sira, ilPuani: x.ilPuani } : null; };

module.exports = { rotalar, durumu, ozet, puanVer, sonuclandir, yarisBakim, haftaNo, ilSirasi };
