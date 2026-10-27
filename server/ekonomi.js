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
function ambarVar(userId, t = simdi()) {
  const oyun = require('./oyun');
  const ambarlar = db.prepare(`SELECT * FROM structures WHERE owner_user_id = ? AND type = 'AMBAR' AND status = 'ACTIVE'`).all(userId);
  return ambarlar.some((s) => oyun.saglik(s, t) >= BAKIM.etkisizEsik);
}
function envanterBozulmasi(userId) {
  const t = simdi();
  const gun = Math.floor(t / BOZULMA.gunMs);
  const ambar = ambarVar(userId, t);
  const oranlar = Object.fromEntries(Object.entries(BOZULMA.envanterGunluk).map(([k, o]) => [k, ambar ? o / BOZULMA.ambarKati : o]));
  const u = db.prepare(`SELECT bozulma_gun FROM users WHERE id = ?`).get(userId);
  if (u.bozulma_gun == null) { db.prepare(`UPDATE users SET bozulma_gun = ? WHERE id = ?`).run(gun, userId); return { oranlar, ambar, kayip: [] }; }
  const gecen = Math.min(BOZULMA.maxGun, gun - u.bozulma_gun);
  if (gecen <= 0) return { oranlar, ambar, kayip: [] };
  const kayip = [];
  db.transaction(() => {
    if (db.prepare(`UPDATE users SET bozulma_gun = ? WHERE id = ? AND bozulma_gun = ?`).run(gun, userId, u.bozulma_gun).changes !== 1) return;
    const tx = L.yeniTx();
    for (const i of L.envanter(userId)) {
      const oran = oranlar[i.item_id];
      if (!oran) continue;
      const adet = Math.floor(i.miktar * (1 - (1 - oran) ** gecen));
      if (adet > 0) { L.envanterDegis(userId, i.item_id, -adet, `Depoda bozulma (${gecen} gün)`, tx); kayip.push({ urun: i.item_id, adet }); }
    }
  })();
  if (kayip.length) {
    bildir(userId, `Depoda bekleyen ürünlerin bir kısmı bozuldu: ${kayip.map((k) => `${k.adet} ${URUNLER[k.urun].ad}`).join(', ')}.${ambar ? '' : ' Ambar bozulmayı yarıya indirir.'}`, 'arazilerim');
  }
  return { oranlar, ambar, kayip };
}

// ---------- Borsa
const q = {
  emir: db.prepare(`SELECT * FROM urun_emirleri WHERE id = ?`),
  karsiAlis: db.prepare(`SELECT * FROM urun_emirleri WHERE urun = ? AND yon = 'AL' AND durum = 'ACIK' AND fiyat >= ? AND expires_at > ? ORDER BY fiyat DESC, id`),
  karsiSatis: db.prepare(`SELECT * FROM urun_emirleri WHERE urun = ? AND yon = 'SAT' AND durum = 'ACIK' AND fiyat <= ? AND expires_at > ? ORDER BY fiyat, id`),
  kalanGuncelle: db.prepare(`UPDATE urun_emirleri SET kalan = kalan - ?, durum = CASE WHEN kalan - ? = 0 THEN 'DOLDU' ELSE durum END,
                             closed_at = CASE WHEN kalan - ? = 0 THEN ? ELSE closed_at END WHERE id = ? AND durum = 'ACIK' AND kalan >= ?`),
  acikSayisi: db.prepare(`SELECT COUNT(*) c FROM urun_emirleri WHERE user_id = ? AND durum = 'ACIK'`),
  islemEkle: db.prepare(`INSERT INTO urun_islemleri (urun, alis_emri, satis_emri, alici_id, satici_id, fiyat, miktar, ucret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
};

function fiyatBandi(urun) {
  const u = URUNLER[urun];
  return { alt: kurus(u.tabanFiyat * BORSA.fiyatAltKati), ust: kurus(u.tabanFiyat * BORSA.fiyatUstKati) };
}

// Tek eşleşme: alış emri (a) ile satış emri (s) arasında m adet, p birim fiyattan
function eslestir(a, s, m, p, t) {
  for (const e of [a, s]) {
    if (q.kalanGuncelle.run(m, m, m, t, e.id, m).changes !== 1) throw new Error(`Emir ${e.id} tutarsız`);
  }
  const tutar = kurus(p * m);
  const ucret = Math.max(0.01, kurus(tutar * BORSA.ucretOrani * (1 - require('./uretim').meslekBonusu(s.user_id, 'TUCCAR'))));
  const tx = L.yeniTx();
  L.aktar({ kaynak: emanet(a.id), hedef: L.hesap(s.user_id), tutar, sebep: `Borsa satışı: ${m} ${URUNLER[a.urun].ad}`, tx });
  L.aktar({ kaynak: L.hesap(s.user_id), hedef: 'SYS:SINK', tutar: ucret, sebep: 'Borsa işlem ücreti', tx });
  const fark = kurus((a.fiyat - p) * m);   // alıcı limitinin altında doldu: farkı iade
  if (fark > 0) L.aktar({ kaynak: emanet(a.id), hedef: L.hesap(a.user_id), tutar: fark, sebep: 'Borsa fiyat farkı iadesi', tx });
  L.envanterDegis(a.user_id, a.urun, m, `Borsa alışı #${a.id}`, tx);
  q.islemEkle.run(a.urun, a.id, s.id, a.user_id, s.user_id, p, m, ucret, t);
  L.denetim({ aktor: null, eylem: 'COMMODITY_TRADE', varlik: a.urun, sonra: { fiyat: p, miktar: m }, herkese: true });
  return { miktar: m, fiyat: p };
}

const emirVer = db.transaction((userId, govde = {}) => {
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
  if (q.acikSayisi.get(userId).c >= BORSA.maxAcikEmir) throw new OyunHatasi(409, `En fazla ${BORSA.maxAcikEmir} açık emrin olabilir`);
  if (yon === 'SAT') envanterBozulmasi(userId);

  const t = simdi();
  const id = db.prepare(`INSERT INTO urun_emirleri (user_id, urun, yon, fiyat, miktar, kalan, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, urun, yon, fiyat, miktar, miktar, t, t + BORSA.sureMs(gun)).lastInsertRowid;
  // Emanete al
  if (yon === 'AL') L.aktar({ kaynak: L.hesap(userId), hedef: emanet(id), tutar: kurus(fiyat * miktar), sebep: `Borsa alış emri #${id} kilidi` });
  else L.envanterDegis(userId, urun, -miktar, `Borsa satış emri #${id} kilidi`);

  // Eşleştir (kendi emirleri atlanır)
  const doldu = [];
  let emir = q.emir.get(id);
  const karsilar = yon === 'AL' ? q.karsiSatis.all(urun, fiyat, t) : q.karsiAlis.all(urun, fiyat, t);
  for (const k of karsilar) {
    if (emir.kalan === 0) break;
    if (k.user_id === userId) continue;
    const m = Math.min(emir.kalan, k.kalan);
    const sonuc = yon === 'AL' ? eslestir(emir, k, m, k.fiyat, t) : eslestir(k, emir, m, k.fiyat, t);
    doldu.push(sonuc);
    bildir(k.user_id, `${yon === 'AL' ? 'Satış' : 'Alış'} emrin eşleşti: ${m} ${URUNLER[urun].ad} × ₳${k.fiyat}`, 'pazar:borsa');
    emir = q.emir.get(id);
  }
  L.denetim({ aktor: userId, eylem: 'COMMODITY_ORDER', varlik: `EMIR:${id}`, sonra: { urun, yon, fiyat, miktar, dolan: miktar - emir.kalan } });
  return { tamam: true, id, dolan: miktar - emir.kalan, kalan: emir.kalan, islemler: doldu };
});

function emirKapat(e, durum, t) {
  if (db.prepare(`UPDATE urun_emirleri SET durum = ?, closed_at = ? WHERE id = ? AND durum = 'ACIK'`).run(durum, t, e.id).changes !== 1) return false;
  if (e.kalan > 0) {
    if (e.yon === 'AL') {
      const kalanTutar = L.hesapBakiye(emanet(e.id));
      if (kalanTutar > 0) L.aktar({ kaynak: emanet(e.id), hedef: L.hesap(e.user_id), tutar: kalanTutar, sebep: `Borsa alış emri #${e.id} iadesi` });
    } else L.envanterDegis(e.user_id, e.urun, e.kalan, `Borsa satış emri #${e.id} iadesi`);
  }
  return true;
}
const emirIptal = db.transaction((userId, emirId) => {
  const e = q.emir.get(Number(emirId));
  if (!e || e.user_id !== userId) throw new OyunHatasi(404, 'Emir bulunamadı');
  if (e.durum !== 'ACIK') throw new OyunHatasi(409, 'Emir zaten kapalı');
  emirKapat(e, 'IPTAL', simdi());
  return { tamam: true };
});
function borsaBakim() {
  const t = simdi();
  for (const e of db.prepare(`SELECT * FROM urun_emirleri WHERE durum = 'ACIK' AND expires_at <= ? LIMIT 200`).all(t)) {
    db.transaction(() => { if (emirKapat(e, 'SURESI_DOLDU', t)) bildir(e.user_id, `Borsa emrinin süresi doldu; kalan ${e.kalan} ${URUNLER[e.urun].ad} iade edildi.`, 'pazar:borsa'); })();
  }
}

function defter(urun, t = simdi()) {
  const derinlik = (yon, sira) => db.prepare(`SELECT fiyat, SUM(kalan) AS miktar, COUNT(*) AS emir FROM urun_emirleri
    WHERE urun = ? AND yon = ? AND durum = 'ACIK' AND expires_at > ? GROUP BY fiyat ORDER BY fiyat ${sira} LIMIT 6`).all(urun, yon, t);
  const son = db.prepare(`SELECT fiyat, miktar, created_at FROM urun_islemleri WHERE urun = ? ORDER BY id DESC LIMIT 12`).all(urun);
  const hacim24 = db.prepare(`SELECT COALESCE(SUM(miktar), 0) m FROM urun_islemleri WHERE urun = ? AND created_at > ?`).get(urun, t - 24 * 3600e3).m;
  return { alis: derinlik('AL', 'DESC'), satis: derinlik('SAT', 'ASC'), sonIslemler: son, hacim24 };
}
// Ürün defterleri herkese aynı ve ürün başına birkaç sorgu: 5 sn önbellek (testlerde kapalı)
let borsaOnbellek = { t: 0, v: null };
function borsaUrunleri(t) {
  if (process.env.ONBELLEK !== 'kapali' && borsaOnbellek.v && t - borsaOnbellek.t < 5000) return borsaOnbellek.v;
  const oyun = require('./oyun');
  const satilanSorgu = db.prepare(`SELECT sold FROM npc_demand WHERE day = ? AND item_id = ?`), gun = new Date().toISOString().slice(0, 10);
  const v = Object.entries(URUNLER).map(([kod, u]) => ({ kod, ad: u.ad, ikon: u.ikon, taban: u.tabanFiyat, bant: fiyatBandi(kod),
    npcFiyat: kurus(oyun.birimFiyat(kod, satilanSorgu.get(gun, kod)?.sold || 0)), ...defter(kod, t) }));
  borsaOnbellek = { t, v };
  return v;
}
function borsa(userId) {
  const t = simdi();
  const urunler = borsaUrunleri(t);
  return {
    urunler, ucretOrani: BORSA.ucretOrani, sureler: BORSA.sureler, minTutar: BORSA.minTutar,
    emirlerim: userId ? db.prepare(`SELECT id, urun, yon, fiyat, miktar, kalan, durum, created_at, expires_at FROM urun_emirleri
                                   WHERE user_id = ? ORDER BY (durum = 'ACIK') DESC, id DESC LIMIT 30`).all(userId) : [],
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
function ekonomiPaneli() {
  const bakiyeler = db.prepare(`SELECT w.user_id, SUM(w.credit) - SUM(w.debit) AS b FROM wallet_ledger w JOIN users u ON u.id = w.user_id
                                WHERE w.account LIKE 'U:%' AND u.is_npc = 0 GROUP BY w.user_id`).all().map((r) => r.b);
  const arz = kurus(bakiyeler.reduce((a, b) => a + b, 0));
  const akis = (gun) => db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN account IN ('SYS:MINT','SYS:NPC') THEN debit END), 0) AS basilan,
      COALESCE(SUM(CASE WHEN account = 'SYS:SINK' THEN credit - debit END), 0) AS yakilan
    FROM wallet_ledger WHERE created_at >= datetime('now', ?)`).get(`-${gun} days`);
  const a7 = akis(7);
  const gunluk = db.prepare(`SELECT date(created_at) AS gun,
      ROUND(COALESCE(SUM(CASE WHEN account IN ('SYS:MINT','SYS:NPC') THEN debit END), 0), 2) AS basilan,
      ROUND(COALESCE(SUM(CASE WHEN account = 'SYS:SINK' THEN credit - debit END), 0), 2) AS yakilan,
      COUNT(DISTINCT tx_group) AS islem
    FROM wallet_ledger WHERE created_at >= datetime('now', '-14 days') GROUP BY gun ORDER BY gun DESC`).all();
  const kaynak = new Map();
  for (const r of db.prepare(`SELECT account, reason, debit, credit FROM wallet_ledger WHERE created_at >= datetime('now', '-7 days')
                              AND (account IN ('SYS:MINT','SYS:NPC') AND debit > 0 OR account = 'SYS:SINK' AND credit > 0)`).all()) {
    const yon = r.account === 'SYS:SINK' ? 'YAKIM' : 'BASIM';
    const k = `${yon}|${neden(r.reason)}`;
    kaynak.set(k, kurus((kaynak.get(k) || 0) + (r.debit || r.credit)));
  }
  const b = borsa(null);
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
  app.post('/api/borsa/emir', auth.dogrulanmisGerekli, h((req) => { const r = emirVer(req.kullanici.id, req.body); borsaOnbellek.t = 0; return r; }));
  app.post('/api/borsa/emir/:id/iptal', auth.girisGerekli, h((req) => { const r = emirIptal(req.kullanici.id, req.params.id); borsaOnbellek.t = 0; return r; }));
  app.get('/api/yonetim/ekonomi', auth.rolGerekli('MODERATOR', 'DENETCI', 'ADMIN'), h(() => ekonomiPaneli()));
}

module.exports = { rotalar, envanterBozulmasi, emirVer, emirIptal, borsaBakim, borsa, ekonomiPaneli, gini };
