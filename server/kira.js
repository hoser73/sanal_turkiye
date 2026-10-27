// Kiralama ve ortaklık (§8.8). Kiralama: sahip parselini günlük bedelle kiraya verir; kiracı bedeli peşin öder ve süre boyunca
// tarımsal kullanım hakkı (ek, sula, hasat) kiracıya geçer. Sahiplik değişmez; kirada parsel satılamaz.
// Ortaklık: sahip, parselindeki hasattan pay alacak ortak davet eder (toplam en çok %50); ortak kabul edince hasat otomatik bölünür.
const db = require('./db');
const L = require('./lib/ledger');
const { KIRA, ORTAKLIK, BOZULMA } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);
const adi = (id) => db.prepare(`SELECT display_name FROM users WHERE id = ?`).get(id)?.display_name;

const aktifKira = (parcelId, t = simdi()) => db.prepare(`SELECT * FROM kiralar WHERE parcel_id = ? AND durum = 'AKTIF' AND bitis > ?`).get(parcelId, t) || null;
const acikKira = (parcelId) => db.prepare(`SELECT * FROM kiralar WHERE parcel_id = ? AND durum IN ('TEKLIF', 'AKTIF')`).get(parcelId) || null;

// Tarımsal kullanım hakkı: kirada ise yalnızca kiracı, değilse sahip
function kullanimHakki(p, userId) {
  if (p.status !== 'ACTIVE') throw new OyunHatasi(423, 'Parsel geçici olarak dondurulmuş');
  const k = aktifKira(p.id);
  if (k) { if (k.kiraci_id !== userId) throw new OyunHatasi(403, k.sahip_id === userId ? 'Parselin kirada; tarımsal kullanım hakkı kiracıda' : 'Bu parselin kullanım hakkı sende değil'); return 'KIRACI'; }
  if (p.owner_user_id !== userId) throw new OyunHatasi(403, 'Bu parselin kullanım hakkı sizde değil');
  return 'SAHIP';
}

const kiraTeklifi = db.transaction((userId, parcelId, govde = {}) => {
  const oyun = require('./oyun');
  const p = oyun.parselGetir(parcelId);
  oyun.sahibiOlmali(p, userId);
  if (p.zoning_type !== 'TARIM') throw new OyunHatasi(422, 'Yalnızca tarım parselleri kiraya verilebilir');
  if (acikKira(p.id)) throw new OyunHatasi(409, 'Bu parsel için açık bir kira kaydı var');
  if (db.prepare(`SELECT 1 FROM listings WHERE parcel_id = ? AND status = 'ACTIVE'`).get(p.id)) throw new OyunHatasi(409, 'Satış ilanındaki parsel kiraya verilemez');
  const gunluk = Number(govde.gunluk), gun = Number(govde.gun);
  if (!Number.isInteger(gunluk) || gunluk < KIRA.minGunluk || gunluk > KIRA.maxGunluk) throw new OyunHatasi(400, `Günlük bedel ${KIRA.minGunluk}–${KIRA.maxGunluk}`);
  if (!Number.isInteger(gun) || gun < 1 || gun > KIRA.maxGun) throw new OyunHatasi(400, `Süre 1–${KIRA.maxGun} gün`);
  const id = db.prepare(`INSERT INTO kiralar (parcel_id, sahip_id, gunluk, gun, created_at) VALUES (?, ?, ?, ?, ?)`).run(p.id, userId, gunluk, gun, simdi()).lastInsertRowid;
  L.denetim({ aktor: userId, eylem: 'LEASE_OFFERED', varlik: p.id, sonra: { gunluk, gun }, bolge: p.region_id, herkese: true });
  return { tamam: true, id };
});

const kirala = db.transaction((userId, kiraId) => {
  const k = db.prepare(`SELECT * FROM kiralar WHERE id = ?`).get(Number(kiraId));
  if (!k || k.durum !== 'TEKLIF') throw new OyunHatasi(404, 'Kira teklifi bulunamadı');
  if (k.sahip_id === userId) throw new OyunHatasi(400, 'Kendi parselini kiralayamazsın');
  require('./carsi').gecikmeEngeli(userId);
  if (simdi() > k.created_at + KIRA.teklifSuresiMs) throw new OyunHatasi(409, 'Teklifin süresi dolmuş');
  const toplam = k.gunluk * k.gun;
  const ucret = Math.max(1, Math.floor(toplam * KIRA.ucretOrani));
  const t = simdi();
  if (db.prepare(`UPDATE kiralar SET durum = 'AKTIF', kiraci_id = ?, baslangic = ?, bitis = ? WHERE id = ? AND durum = 'TEKLIF'`)
    .run(userId, t, t + k.gun * BOZULMA.gunMs, k.id).changes !== 1) throw new OyunHatasi(409, 'Teklif az önce değişti');
  const tx = L.yeniTx();
  L.aktar({ kaynak: L.hesap(userId), hedef: L.hesap(k.sahip_id), tutar: toplam, sebep: `Kira bedeli ${k.parcel_id} (${k.gun} gün)`, tx });
  L.aktar({ kaynak: L.hesap(k.sahip_id), hedef: 'SYS:SINK', tutar: ucret, sebep: 'Kira işlem ücreti', tx });
  const p = db.prepare(`SELECT region_id FROM parcels WHERE id = ?`).get(k.parcel_id);
  L.denetim({ aktor: userId, eylem: 'LEASE_STARTED', varlik: k.parcel_id, sonra: { gun: k.gun, toplam }, bolge: p.region_id, herkese: true });
  bildir(k.sahip_id, `${adi(userId)} ${k.parcel_id} parselini ${k.gun} günlüğüne kiraladı: ₳${toplam} (ücret ₳${ucret}).`, `parsel:${k.parcel_id}`);
  return { tamam: true, toplam, bitis: t + k.gun * BOZULMA.gunMs };
});

function kiraIptal(userId, kiraId) {
  const r = db.prepare(`UPDATE kiralar SET durum = 'IPTAL' WHERE id = ? AND sahip_id = ? AND durum = 'TEKLIF'`).run(Number(kiraId), userId);
  if (!r.changes) throw new OyunHatasi(409, 'Yalnızca bekleyen kendi teklifini geri çekebilirsin');
  return { tamam: true };
}
function kiraBakim() {
  const t = simdi();
  for (const k of db.prepare(`SELECT * FROM kiralar WHERE durum = 'AKTIF' AND bitis <= ?`).all(t)) {
    if (db.prepare(`UPDATE kiralar SET durum = 'BITTI' WHERE id = ? AND durum = 'AKTIF'`).run(k.id).changes) {
      for (const u of [k.sahip_id, k.kiraci_id]) bildir(u, `${k.parcel_id} parselinin kira süresi doldu; kullanım hakkı sahibine döndü.`, `parsel:${k.parcel_id}`);
    }
  }
  db.prepare(`UPDATE kiralar SET durum = 'IPTAL' WHERE durum = 'TEKLIF' AND created_at < ?`).run(t - KIRA.teklifSuresiMs);
}

// ---------- Ortaklık
const aktifOrtaklar = (parcelId) => db.prepare(`SELECT * FROM ortaklar WHERE parcel_id = ? AND durum = 'AKTIF'`).all(parcelId);
const ortakDavet = db.transaction((userId, parcelId, govde = {}) => {
  const oyun = require('./oyun');
  const p = oyun.parselGetir(parcelId);
  oyun.sahibiOlmali(p, userId);
  const ortak = db.prepare(`SELECT id FROM users WHERE display_name = ? AND is_npc = 0 AND status = 'ACTIVE'`).get(String(govde.ortakAd || '').trim());
  if (!ortak) throw new OyunHatasi(404, 'Bu adla oyuncu bulunamadı');
  if (ortak.id === userId) throw new OyunHatasi(400, 'Kendinle ortak olamazsın');
  const pay = Math.round(Number(govde.pay) * 100) / 100;
  if (!(pay >= ORTAKLIK.minPay && pay <= ORTAKLIK.maxToplamPay)) throw new OyunHatasi(400, `Pay %${ORTAKLIK.minPay * 100}–%${ORTAKLIK.maxToplamPay * 100}`);
  const mevcut = db.prepare(`SELECT * FROM ortaklar WHERE parcel_id = ? AND durum IN ('DAVET', 'AKTIF')`).all(p.id);
  if (mevcut.length >= ORTAKLIK.maxOrtak) throw new OyunHatasi(409, `En fazla ${ORTAKLIK.maxOrtak} ortak`);
  if (mevcut.reduce((a, o) => a + o.pay, 0) + pay > ORTAKLIK.maxToplamPay + 1e-9) throw new OyunHatasi(409, `Ortakların toplam payı %${ORTAKLIK.maxToplamPay * 100}'yi geçemez`);
  let id;
  try { id = db.prepare(`INSERT INTO ortaklar (parcel_id, sahip_id, ortak_id, pay, created_at) VALUES (?, ?, ?, ?, ?)`).run(p.id, userId, ortak.id, pay, simdi()).lastInsertRowid; } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new OyunHatasi(409, 'Bu oyuncu zaten ortak ya da davetli');
    throw e;
  }
  bildir(ortak.id, `${adi(userId)} seni ${p.id} parselinin hasadına %${Math.round(pay * 100)} payla ortak olmaya davet etti.`, `parsel:${p.id}`);
  return { tamam: true, id };
});
function ortakYanit(userId, ortakId, kabul) {
  const o = db.prepare(`SELECT * FROM ortaklar WHERE id = ?`).get(Number(ortakId));
  if (!o || o.ortak_id !== userId || o.durum !== 'DAVET') throw new OyunHatasi(404, 'Davet bulunamadı');
  db.prepare(`UPDATE ortaklar SET durum = ? WHERE id = ?`).run(kabul ? 'AKTIF' : 'BITTI', o.id);
  if (kabul) L.denetim({ aktor: userId, eylem: 'PARTNERSHIP_STARTED', varlik: o.parcel_id, sonra: { pay: o.pay } });
  bildir(o.sahip_id, `${adi(userId)} ${o.parcel_id} ortaklık davetini ${kabul ? 'kabul etti' : 'reddetti'}.`, `parsel:${o.parcel_id}`);
  return { tamam: true };
}
function ortaklikBitir(userId, ortakId) {
  const o = db.prepare(`SELECT * FROM ortaklar WHERE id = ?`).get(Number(ortakId));
  if (!o || ![o.sahip_id, o.ortak_id].includes(userId) || !['DAVET', 'AKTIF'].includes(o.durum)) throw new OyunHatasi(404, 'Ortaklık bulunamadı');
  db.prepare(`UPDATE ortaklar SET durum = 'BITTI' WHERE id = ?`).run(o.id);
  bildir(userId === o.sahip_id ? o.ortak_id : o.sahip_id, `${o.parcel_id} ortaklığı sona erdi.`, `parsel:${o.parcel_id}`);
  return { tamam: true };
}
// Hasat paylaşımı (hasat işleminin içinde çağrılır): ortakların payı aşağı yuvarlanır, kalan sahibe
function hasatPaylastir(p, ekenId, miktar, urun, tx) {
  if (ekenId !== p.owner_user_id) return { sahibe: miktar, paylar: [] };
  let kalan = miktar;
  const paylar = [];
  for (const o of aktifOrtaklar(p.id)) {
    const adet = Math.floor(miktar * o.pay);
    if (adet < 1) continue;
    L.envanterDegis(o.ortak_id, urun, adet, `Ortaklık hasat payı ${p.id}`, tx);
    kalan -= adet;
    paylar.push({ ortak: adi(o.ortak_id), adet });
    bildir(o.ortak_id, `${p.id} hasadından payına ${adet} ürün düştü.`, `parsel:${p.id}`);
  }
  return { sahibe: kalan, paylar };
}
// Satışta ortaklık ve bekleyen kira teklifleri sona erer
function devirdeKapat(parcelId) {
  db.prepare(`UPDATE ortaklar SET durum = 'BITTI' WHERE parcel_id = ? AND durum IN ('DAVET', 'AKTIF')`).run(parcelId);
  db.prepare(`UPDATE kiralar SET durum = 'IPTAL' WHERE parcel_id = ? AND durum = 'TEKLIF'`).run(parcelId);
}

function parselKira(parcelId, userId) {
  const k = acikKira(parcelId);
  const ortaklar = db.prepare(`SELECT o.id, o.pay, o.durum, o.ortak_id, u.display_name AS ad FROM ortaklar o JOIN users u ON u.id = o.ortak_id
                               WHERE o.parcel_id = ? AND o.durum IN ('DAVET', 'AKTIF')`).all(parcelId);
  return {
    kira: k && { id: k.id, durum: k.durum, gunluk: k.gunluk, gun: k.gun, bitis: k.bitis, kiraci: k.kiraci_id ? adi(k.kiraci_id) : null, benKiraciyim: k.kiraci_id === userId, sahibiyim: k.sahip_id === userId },
    ortaklar: ortaklar.map((o) => ({ id: o.id, ad: o.ad, pay: o.pay, durum: o.durum, ben: o.ortak_id === userId })),
  };
}
const kiraliklar = () => db.prepare(`SELECT k.id, k.parcel_id, k.gunluk, k.gun, p.area_m2, r.name AS mahalle, rl.name AS il, u.display_name AS sahip
  FROM kiralar k JOIN parcels p ON p.id = k.parcel_id JOIN regions r ON r.id = p.region_id JOIN regions rl ON rl.id = p.il_id JOIN users u ON u.id = k.sahip_id
  WHERE k.durum = 'TEKLIF' AND k.created_at > ? ORDER BY k.id DESC LIMIT 40`).all(simdi() - KIRA.teklifSuresiMs);

function rotalar(app, { h, auth, hazir }) {
  app.get('/api/kiraliklar', h(() => kiraliklar()));
  app.post('/api/parsel/:id/kira', auth.dogrulanmisGerekli, hazir((req) => kiraTeklifi(req.kullanici.id, String(req.params.id), req.body)));
  app.post('/api/kira/:id/kirala', auth.dogrulanmisGerekli, h((req) => kirala(req.kullanici.id, req.params.id)));
  app.post('/api/kira/:id/iptal', auth.girisGerekli, h((req) => kiraIptal(req.kullanici.id, req.params.id)));
  app.post('/api/parsel/:id/ortak', auth.dogrulanmisGerekli, hazir((req) => ortakDavet(req.kullanici.id, String(req.params.id), req.body)));
  app.post('/api/ortak/:id/yanit', auth.girisGerekli, h((req) => ortakYanit(req.kullanici.id, req.params.id, req.body?.kabul === true)));
  app.post('/api/ortak/:id/bitir', auth.girisGerekli, h((req) => ortaklikBitir(req.kullanici.id, req.params.id)));
}

module.exports = { rotalar, kullanimHakki, aktifKira, acikKira, kiraTeklifi, kirala, kiraIptal, kiraBakim, ortakDavet, ortakYanit, ortaklikBitir,
  hasatPaylastir, devirdeKapat, parselKira, kiraliklar };
