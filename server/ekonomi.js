// Ekonomi: envanter bozulması, oyuncular arası ürün borsası (emir defteri) ve ekonomi gözlem paneli (§5, §8.6, §10.3).
// Borsa: alış emri akçeyi, satış emri ürünü emanete alır. Eşleşme fiyat-zaman önceliğiyle ve bekleyen emrin fiyatından yapılır;
// bir oyuncunun emri kendi emriyle eşleşmez. Ücret satıcıdan kesilip oyundan çıkar.
const db = require('./db');
const L = require('./lib/ledger');
const { URUNLER, BOZULMA, BORSA, BAKIM } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const emanet = (emirId) => `ESCROW:EMIR:${emirId}`;
const bul = (tablo, kod) => (typeof kod === 'string' && Object.hasOwn(tablo, kod) ? tablo[kod] : null);
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);
const kurus = (n) => Math.round(n * 100) / 100;

// ---------- Envanter bozulması (tembel, oyun günü başına bileşik oran)
async function ambarVar(userId, t = simdi()) {
  const oyun = require('./oyun');
  const ambarlar = await db.all(`SELECT * FROM structures WHERE owner_user_id = ? AND type = 'AMBAR' AND status = 'ACTIVE'`, userId);
  return ambarlar.some((s) => oyun.saglik(s, t) >= BAKIM.etkisizEsik);
}
// İşlem içinde de çağrılabilir (lib/ledger envanterDegis → bozulmaGuncelle): kendi db.tx'i iç içe ise kayıt noktası olur
async function envanterBozulmasi(userId) {
  const t = simdi();
  const gun = Math.floor(t / BOZULMA.gunMs);
  const ambar = await ambarVar(userId, t);
  const oranlar = Object.fromEntries(Object.entries(BOZULMA.envanterGunluk).map(([k, o]) => [k, ambar ? o / BOZULMA.ambarKati : o]));
  const u = await db.get(`SELECT bozulma_gun FROM users WHERE id = ?`, userId);
  if (u.bozulma_gun == null) {
    await db.run(`UPDATE users SET bozulma_gun = ? WHERE id = ? AND bozulma_gun IS NULL`, gun, userId);
    return { oranlar, ambar, kayip: [] };
  }
  const gecen = Math.min(BOZULMA.maxGun, gun - u.bozulma_gun);
  if (gecen <= 0) return { oranlar, ambar, kayip: [] };
  const kayip = [];
  await db.tx(async () => {
    // Koşullu yazma: aynı gün için bozulma bir kez işlenir (eşzamanlı ikinci çağrı hiçbir şey yapmaz)
    if ((await db.run(`UPDATE users SET bozulma_gun = ? WHERE id = ? AND bozulma_gun = ?`, gun, userId, u.bozulma_gun)).changes !== 1) return;
    const tx = L.yeniTx();
    for (const i of await L.envanter(userId)) {
      const oran = oranlar[i.item_id];
      if (!oran) continue;
      const adet = Math.floor(i.miktar * (1 - (1 - oran) ** gecen));
      if (adet > 0) { await L.envanterDegis(userId, i.item_id, -adet, `Depoda bozulma (${gecen} gün)`, tx); kayip.push({ urun: i.item_id, adet }); }
    }
  });
  if (kayip.length) {
    await bildir(userId, `Depoda bekleyen ürünlerin bir kısmı bozuldu: ${kayip.map((k) => `${k.adet} ${URUNLER[k.urun].ad}`).join(', ')}.${ambar ? '' : ' Ambar bozulmayı yarıya indirir.'}`, 'arazilerim');
  }
  return { oranlar, ambar, kayip };
}

// Envantere ürün eklenmeden önce (lib/ledger envanterDegis): işlenmemiş gün varsa bozulmayı şimdi uygula
async function bozulmaGuncelle(userId, itemId) {
  if (!BOZULMA.envanterGunluk[itemId]) return;
  const u = await db.get(`SELECT bozulma_gun FROM users WHERE id = ?`, userId);
  if (u && u.bozulma_gun != null && u.bozulma_gun < Math.floor(simdi() / BOZULMA.gunMs)) await envanterBozulmasi(userId);
}

// ---------- Borsa
const q = {
  emir: db.sorgu(`SELECT * FROM urun_emirleri WHERE id = ?`),
  emirKilitle: db.sorgu(`SELECT * FROM urun_emirleri WHERE id = ? FOR UPDATE`),
  // Karşı emirler işlem sonuna kadar kilitlenir: aynı emir iki eşleşmede birden doldurulamaz (kalan taze okunur)
  karsiAlis: db.sorgu(`SELECT * FROM urun_emirleri WHERE urun = ? AND yon = 'AL' AND durum = 'ACIK' AND fiyat >= ? AND expires_at > ? ORDER BY fiyat DESC, id FOR UPDATE`),
  karsiSatis: db.sorgu(`SELECT * FROM urun_emirleri WHERE urun = ? AND yon = 'SAT' AND durum = 'ACIK' AND fiyat <= ? AND expires_at > ? ORDER BY fiyat, id FOR UPDATE`),
  kalanGuncelle: db.sorgu(`UPDATE urun_emirleri SET kalan = kalan - ?, durum = CASE WHEN kalan - ? = 0 THEN 'DOLDU' ELSE durum END,
                             closed_at = CASE WHEN kalan - ? = 0 THEN ? ELSE closed_at END WHERE id = ? AND durum = 'ACIK' AND kalan >= ?`),
  acikSayisi: db.sorgu(`SELECT COUNT(*) c FROM urun_emirleri WHERE user_id = ? AND durum = 'ACIK'`),
  islemEkle: db.sorgu(`INSERT INTO urun_islemleri (urun, alis_emri, satis_emri, alici_id, satici_id, fiyat, miktar, ucret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
};

function fiyatBandi(urun) {
  const u = URUNLER[urun];
  return { alt: kurus(u.tabanFiyat * BORSA.fiyatAltKati), ust: kurus(u.tabanFiyat * BORSA.fiyatUstKati) };
}

// Tek eşleşme: alış emri (a) ile satış emri (s) arasında m adet, p birim fiyattan
async function eslestir(a, s, m, p, t) {
  for (const e of [a, s]) {
    if ((await q.kalanGuncelle.run(m, m, m, t, e.id, m)).changes !== 1) throw new Error(`Emir ${e.id} tutarsız`);
  }
  const tutar = kurus(p * m);
  const ucret = Math.max(0.01, kurus(tutar * BORSA.ucretOrani * (1 - await require('./uretim').meslekBonusu(s.user_id, 'TUCCAR'))));
  const tx = L.yeniTx();
  await L.aktar({ kaynak: emanet(a.id), hedef: L.hesap(s.user_id), tutar, sebep: `Borsa satışı: ${m} ${URUNLER[a.urun].ad}`, tx });
  await L.aktar({ kaynak: L.hesap(s.user_id), hedef: 'SYS:SINK', tutar: ucret, sebep: 'Borsa işlem ücreti', tx });
  const fark = kurus((a.fiyat - p) * m);   // alıcı limitinin altında doldu: farkı iade
  if (fark > 0) await L.aktar({ kaynak: emanet(a.id), hedef: L.hesap(a.user_id), tutar: fark, sebep: 'Borsa fiyat farkı iadesi', tx });
  await envanterBozulmasi(a.user_id);   // alıcının birikmiş bozulması önce işlenir: bugün alınan ürün geçmiş günlerden bozulmaz
  await L.envanterDegis(a.user_id, a.urun, m, `Borsa alışı #${a.id}`, tx);
  await q.islemEkle.run(a.urun, a.id, s.id, a.user_id, s.user_id, p, m, ucret, t);
  await L.denetim({ aktor: null, eylem: 'COMMODITY_TRADE', varlik: a.urun, sonra: { fiyat: p, miktar: m }, herkese: true });
  return { miktar: m, fiyat: p };
}

const emirVer = (userId, govde = {}) => db.tx(async () => {
  const urun = String(govde.urun || '');
  if (!bul(URUNLER, urun)) throw new OyunHatasi(400, 'Bilinmeyen ürün');
  const yon = govde.yon === 'AL' ? 'AL' : govde.yon === 'SAT' ? 'SAT' : null;
  if (!yon) throw new OyunHatasi(400, 'Yön AL ya da SAT olmalı');
  const fiyat = kurus(Number(govde.fiyat));
  const bant = fiyatBandi(urun);
  if (!(fiyat >= bant.alt && fiyat <= bant.ust)) throw new OyunHatasi(400, `Birim fiyat ₳${bant.alt}–₳${bant.ust} aralığında olmalı`);
  const miktar = Number(govde.miktar);
  if (!Number.isInteger(miktar) || miktar < 1 || miktar > BORSA.maxMiktar) throw new OyunHatasi(400, 'Geçersiz miktar');
  if (fiyat * miktar < BORSA.minTutar) throw new OyunHatasi(400, `Emir tutarı en az ₳${BORSA.minTutar} olmalı`);
  const gun = Number(govde.gun ?? 3);
  if (!BORSA.sureler.includes(gun)) throw new OyunHatasi(400, `Süre ${BORSA.sureler.join(', ')} gün olabilir`);
  await db.kilit(`borsa-emir:${userId}`);   // açık emir sınırı eşzamanlı emirlerle aşılmasın
  if ((await q.acikSayisi.get(userId)).c >= BORSA.maxAcikEmir) throw new OyunHatasi(409, `En fazla ${BORSA.maxAcikEmir} açık emrin olabilir`);
  if (yon === 'SAT') await envanterBozulmasi(userId);

  const t = simdi();
  const id = (await db.run(`INSERT INTO urun_emirleri (user_id, urun, yon, fiyat, miktar, kalan, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, urun, yon, fiyat, miktar, miktar, t, t + BORSA.sureMs(gun))).lastInsertRowid;
  // Emanete al
  if (yon === 'AL') await L.aktar({ kaynak: L.hesap(userId), hedef: emanet(id), tutar: kurus(fiyat * miktar), sebep: `Borsa alış emri #${id} kilidi` });
  else await L.envanterDegis(userId, urun, -miktar, `Borsa satış emri #${id} kilidi`);

  // Eşleştir (kendi emirleri atlanır)
  const doldu = [];
  let emir = await q.emir.get(id);
  const karsilar = yon === 'AL' ? await q.karsiSatis.all(urun, fiyat, t) : await q.karsiAlis.all(urun, fiyat, t);
  for (const k of karsilar) {
    if (emir.kalan === 0) break;
    if (k.user_id === userId) continue;
    const m = Math.min(emir.kalan, k.kalan);
    const sonuc = yon === 'AL' ? await eslestir(emir, k, m, k.fiyat, t) : await eslestir(k, emir, m, k.fiyat, t);
    doldu.push(sonuc);
    await bildir(k.user_id, `${yon === 'AL' ? 'Satış' : 'Alış'} emrin eşleşti: ${m} ${URUNLER[urun].ad} × ₳${k.fiyat}`, 'pazar:borsa');
    emir = await q.emir.get(id);
  }
  await L.denetim({ aktor: userId, eylem: 'COMMODITY_ORDER', varlik: `EMIR:${id}`, sonra: { urun, yon, fiyat, miktar, dolan: miktar - emir.kalan } });
  return { tamam: true, id, dolan: miktar - emir.kalan, kalan: emir.kalan, islemler: doldu };
});

// Kapanan emrin kalanını iade eder. Satış emrindeki ürün emirde beklerken de depodaki gibi bozulur (açık kaldığı oyun günleri).
// Emir satırı kilitlenip yeniden okunur: eşzamanlı bir eşleşme kalanı azaltmış olabilir (eski kalan iade edilirse ürün
// çoğalırdı). Dönüş: { e (taze emir), s (iade özeti) } ya da emir zaten kapandıysa null.
async function emirKapat(emirId, durum, t) {
  const e = await q.emirKilitle.get(emirId);
  if (!e || e.durum !== 'ACIK') return null;
  if ((await db.run(`UPDATE urun_emirleri SET durum = ?, closed_at = ? WHERE id = ? AND durum = 'ACIK'`, durum, t, e.id)).changes !== 1) return null;
  const sonuc = { iade: e.kalan, bozulan: 0 };
  if (e.kalan > 0) {
    if (e.yon === 'AL') {
      const kalanTutar = await L.hesapBakiye(emanet(e.id));
      if (kalanTutar > 0) await L.aktar({ kaynak: emanet(e.id), hedef: L.hesap(e.user_id), tutar: kalanTutar, sebep: `Borsa alış emri #${e.id} iadesi` });
      sonuc.iade = kalanTutar;
    } else {
      const { oranlar } = await envanterBozulmasi(e.user_id);   // depodakiler önce işlenir; iade edilen ürün ikinci kez bozulmaz
      const gun = Math.min(BOZULMA.maxGun, Math.floor(t / BOZULMA.gunMs) - Math.floor(e.created_at / BOZULMA.gunMs));
      const oran = oranlar[e.urun];
      sonuc.bozulan = gun > 0 && oran ? Math.floor(e.kalan * (1 - (1 - oran) ** gun)) : 0;
      sonuc.iade = e.kalan - sonuc.bozulan;
      if (sonuc.iade > 0) await L.envanterDegis(e.user_id, e.urun, sonuc.iade, `Borsa satış emri #${e.id} iadesi${sonuc.bozulan ? ` (${sonuc.bozulan} bozuldu)` : ''}`);
    }
  }
  return { e, s: sonuc };
}
const iadeMetni = (e, s) => (e.yon === 'AL' ? `kalan ₳${s.iade} iade edildi`
  : `kalan ${s.iade} ${URUNLER[e.urun].ad} iade edildi${s.bozulan ? ` (${s.bozulan} adedi emirde beklerken bozuldu)` : ''}`);
const emirIptal = (userId, emirId) => db.tx(async () => {
  const e = await q.emirKilitle.get(Number(emirId));
  if (!e || e.user_id !== userId) throw new OyunHatasi(404, 'Emir bulunamadı');
  if (e.durum !== 'ACIK') throw new OyunHatasi(409, 'Emir zaten kapalı');
  const r = await emirKapat(e.id, 'IPTAL', simdi());
  if (!r) throw new OyunHatasi(409, 'Emir zaten kapalı');
  return { tamam: true, ...r.s, mesaj: `Emir iptal edildi; ${iadeMetni(r.e, r.s)}.` };
});
async function borsaBakim() {
  const t = simdi();
  for (const { id } of await db.all(`SELECT id FROM urun_emirleri WHERE durum = 'ACIK' AND expires_at <= ? LIMIT 200`, t)) {
    await db.tx(async () => {
      const r = await emirKapat(id, 'SURESI_DOLDU', t);
      if (r) await bildir(r.e.user_id, `Borsa emrinin süresi doldu; ${iadeMetni(r.e, r.s)}.`, 'pazar:borsa');
    });
  }
}

async function defter(urun, t = simdi()) {
  const derinlik = (yon, sira) => db.all(`SELECT fiyat, SUM(kalan) AS miktar, COUNT(*) AS emir FROM urun_emirleri
    WHERE urun = ? AND yon = ? AND durum = 'ACIK' AND expires_at > ? GROUP BY fiyat ORDER BY fiyat ${sira} LIMIT 6`, urun, yon, t);
  const son = await db.all(`SELECT fiyat, miktar, created_at FROM urun_islemleri WHERE urun = ? ORDER BY id DESC LIMIT 12`, urun);
  const hacim24 = (await db.get(`SELECT COALESCE(SUM(miktar), 0) m FROM urun_islemleri WHERE urun = ? AND created_at > ?`, urun, t - 24 * 3600e3)).m;
  return { alis: await derinlik('AL', 'DESC'), satis: await derinlik('SAT', 'ASC'), sonIslemler: son, hacim24 };
}
// Ürün defterleri herkese aynı ve ürün başına birkaç sorgu: 5 sn önbellek (testlerde kapalı)
let borsaOnbellek = { t: 0, v: null };
async function borsaUrunleri(t) {
  if (process.env.ONBELLEK !== 'kapali' && borsaOnbellek.v && t - borsaOnbellek.t < 5000) return borsaOnbellek.v;
  const oyun = require('./oyun');
  const gun = oyun.bugun(t);   // Türkiye günü (tüccar talebiyle aynı anahtar)
  const v = [];
  for (const [kod, u] of Object.entries(URUNLER)) {
    const satilan = (await db.get(`SELECT sold FROM npc_demand WHERE day = ? AND item_id = ?`, gun, kod))?.sold || 0;
    v.push({ kod, ad: u.ad, ikon: u.ikon, taban: u.tabanFiyat, bant: fiyatBandi(kod),
      npcFiyat: kurus(oyun.birimFiyat(kod, satilan)), ...await defter(kod, t) });
  }
  borsaOnbellek = { t, v };
  return v;
}
async function borsa(userId) {
  const t = simdi();
  const urunler = await borsaUrunleri(t);
  return {
    urunler, ucretOrani: BORSA.ucretOrani, sureler: BORSA.sureler, minTutar: BORSA.minTutar,
    emirlerim: userId ? await db.all(`SELECT id, urun, yon, fiyat, miktar, kalan, durum, created_at, expires_at FROM urun_emirleri
                                   WHERE user_id = ? ORDER BY (durum = 'ACIK') DESC, id DESC LIMIT 30`, userId) : [],
  };
}

// ---------- Ekonomi gözlemi (yetkililer)
const neden = (r) => r.replace(/\(.*?\)|#\d+|TR-\S+|×\d+|\d+(\.\d+)?/g, '').split(':')[0].replace(/\s+/g, ' ').trim() || 'diğer';
function gini(degerler) {
  const x = degerler.filter((v) => v > 0).sort((a, b) => a - b);
  const n = x.length, top = x.reduce((a, b) => a + b, 0);
  if (n < 2 || !top) return 0;
  return Math.round((x.reduce((a, v, i) => a + (2 * (i + 1) - n - 1) * v, 0) / (n * top)) * 100) / 100;
}
async function ekonomiPaneli() {
  const bakiyeler = (await db.all(`SELECT w.user_id, SUM(w.credit) - SUM(w.debit) AS b FROM wallet_ledger w JOIN users u ON u.id = w.user_id
                                WHERE w.account LIKE 'U:%' AND u.is_npc = 0 GROUP BY w.user_id`)).map((r) => r.b);
  const arz = kurus(bakiyeler.reduce((a, b) => a + b, 0));
  const akis = (gun) => db.get(`SELECT
      COALESCE(SUM(CASE WHEN account IN ('SYS:MINT','SYS:NPC') THEN debit END), 0) AS basilan,
      COALESCE(SUM(CASE WHEN account = 'SYS:SINK' THEN credit - debit END), 0) AS yakilan
    FROM wallet_ledger WHERE created_at >= datetime('now', ?)`, `-${gun} days`);
  const a7 = await akis(7);
  // created_at 'YYYY-MM-DD HH:MM:SS' metnidir: gün = ilk 10 karakter (iki motorda da aynı; date() Postgres'te yok).
  // Yuvarlama JS'de: ROUND(gerçek, n) Postgres'te çalışmaz.
  const gunluk = (await db.all(`SELECT substr(created_at, 1, 10) AS gun,
      COALESCE(SUM(CASE WHEN account IN ('SYS:MINT','SYS:NPC') THEN debit END), 0) AS basilan,
      COALESCE(SUM(CASE WHEN account = 'SYS:SINK' THEN credit - debit END), 0) AS yakilan,
      COUNT(DISTINCT tx_group) AS islem
    FROM wallet_ledger WHERE created_at >= datetime('now', '-14 days') GROUP BY substr(created_at, 1, 10) ORDER BY gun DESC`))
    .map((g) => ({ ...g, basilan: kurus(g.basilan), yakilan: kurus(g.yakilan) }));
  const kaynak = new Map();
  for (const r of await db.all(`SELECT account, reason, debit, credit FROM wallet_ledger WHERE created_at >= datetime('now', '-7 days')
                              AND (account IN ('SYS:MINT','SYS:NPC') AND debit > 0 OR account = 'SYS:SINK' AND credit > 0)`)) {
    const yon = r.account === 'SYS:SINK' ? 'YAKIM' : 'BASIM';
    const k = `${yon}|${neden(r.reason)}`;
    kaynak.set(k, kurus((kaynak.get(k) || 0) + (r.debit || r.credit)));
  }
  const b = await borsa(null);
  return {
    ozet: { arz, basilan7: kurus(a7.basilan), yakilan7: kurus(a7.yakilan), net7: kurus(a7.basilan - a7.yakilan),
      kisiBasi: bakiyeler.length ? kurus(arz / bakiyeler.length) : 0, gini: gini(bakiyeler) },
    gunluk,
    kaynaklar: [...kaynak].map(([k, tutar]) => ({ yon: k.split('|')[0], sebep: k.split('|')[1], tutar })).sort((x, y) => y.tutar - x.tutar).slice(0, 20),
    urunler: b.urunler.map((u) => ({ ad: `${u.ikon} ${u.ad}`, npc: u.npcFiyat, son: u.sonIslemler[0]?.fiyat ?? null, alis: u.alis[0]?.fiyat ?? null, satis: u.satis[0]?.fiyat ?? null })),
  };
}

function rotalar(app, { h, auth }) {
  app.get('/api/borsa', h((req) => borsa(req.kullanici?.id ?? null)));
  // Emir ve iptal defteri değiştirir: önbellek boşalır, oyuncu kendi emrini hemen görür
  app.post('/api/borsa/emir', auth.dogrulanmisGerekli, h(async (req) => { const r = await emirVer(req.kullanici.id, req.body); borsaOnbellek.t = 0; return r; }));
  app.post('/api/borsa/emir/:id/iptal', auth.girisGerekli, h(async (req) => { const r = await emirIptal(req.kullanici.id, req.params.id); borsaOnbellek.t = 0; return r; }));
  app.get('/api/yonetim/ekonomi', auth.rolGerekli('MODERATOR', 'DENETCI', 'ADMIN'), h(() => ekonomiPaneli()));
}

module.exports = { rotalar, envanterBozulmasi, bozulmaGuncelle, emirVer, emirIptal, borsaBakim, borsa, ekonomiPaneli, gini };
