// Kiralama ve ortaklık (§8.8). Kiralama: sahip parselini günlük bedelle kiraya verir; kiracı bedeli peşin öder ve süre boyunca
// tarımsal kullanım hakkı (ek, sula, hasat) kiracıya geçer. Sahiplik değişmez; kirada parsel satılamaz.
// Ortaklık: sahip, parselindeki hasattan pay alacak ortak davet eder (toplam en çok %50); ortak kabul edince hasat otomatik bölünür.
const db = require('./db');
const L = require('./lib/ledger');
const { KIRA, ORTAKLIK, BOZULMA } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);
const adi = async (id) => (await db.get(`SELECT display_name FROM users WHERE id = ?`, id))?.display_name;
// Parsel satırı kilidi (pazar.js ile aynı): kira, ortaklık ve satış aynı parselde eşzamanlı ilerlemesin
const parselKilitle = (parcelId) => db.get(`SELECT id FROM parcels WHERE id = ? FOR UPDATE`, parcelId);

const aktifKira = async (parcelId, t = simdi()) => (await db.get(`SELECT * FROM kiralar WHERE parcel_id = ? AND durum = 'AKTIF' AND bitis > ?`, parcelId, t)) || null;
const acikKira = async (parcelId) => (await db.get(`SELECT * FROM kiralar WHERE parcel_id = ? AND durum IN ('TEKLIF', 'AKTIF')`, parcelId)) || null;
const ekinVar = async (parcelId) => !!await db.get(`SELECT 1 FROM crops WHERE parcel_id = ? AND status = 'GROWING'`, parcelId);

// Kira bitti ama son kiracının ektiği ekin hâlâ tarlada (parsel el değiştirmedi): o ekin üzerinde hakkı sürer
async function eskiKiracininEkini(p, userId) {
  const son = await db.get(`SELECT sahip_id, kiraci_id FROM kiralar WHERE parcel_id = ? AND kiraci_id IS NOT NULL ORDER BY id DESC LIMIT 1`, p.id);
  if (!son || son.kiraci_id !== userId || son.sahip_id !== p.owner_user_id) return false;
  return !!await db.get(`SELECT 1 FROM crops WHERE parcel_id = ? AND status = 'GROWING' AND user_id = ?`, p.id, userId);
}

// Tarımsal kullanım hakkı: kirada ise yalnızca kiracı, değilse sahip. Kira bitince eski kiracı yalnızca kendi
// ektiği ve hâlâ tarlada duran ekini sulayıp hasat edebilir (yeni ekin ekemez: tarla dolu).
async function kullanimHakki(p, userId) {
  if (p.status !== 'ACTIVE') throw new OyunHatasi(423, 'Parsel geçici olarak dondurulmuş');
  const k = await aktifKira(p.id);
  if (k) { if (k.kiraci_id !== userId) throw new OyunHatasi(403, k.sahip_id === userId ? 'Parselin kirada; tarımsal kullanım hakkı kiracıda' : 'Bu parselin kullanım hakkı sende değil'); return 'KIRACI'; }
  if (p.owner_user_id !== userId) {
    if (await eskiKiracininEkini(p, userId)) return 'ESKI_KIRACI';
    throw new OyunHatasi(403, 'Bu parselin kullanım hakkı sizde değil');
  }
  return 'SAHIP';
}

const kiraTeklifi = (userId, parcelId, govde = {}) => db.tx(async () => {
  const oyun = require('./oyun');
  await parselKilitle(parcelId);   // aynı parsele eşzamanlı kira teklifi / ilan açılmasın
  const p = await oyun.parselGetir(parcelId);
  oyun.sahibiOlmali(p, userId);
  if (p.zoning_type !== 'TARIM') throw new OyunHatasi(422, 'Yalnızca tarım parselleri kiraya verilebilir');
  if (await acikKira(p.id)) throw new OyunHatasi(409, 'Bu parsel için açık bir kira kaydı var');
  if (await db.get(`SELECT 1 FROM listings WHERE parcel_id = ? AND status = 'ACTIVE'`, p.id)) throw new OyunHatasi(409, 'Satış ilanındaki parsel kiraya verilemez');
  if (await ekinVar(p.id)) throw new OyunHatasi(409, 'Tarlada ekin var; hasat etmeden kiraya veremezsin', 'EKIN_VAR');
  const gunluk = Number(govde.gunluk), gun = Number(govde.gun);
  if (!Number.isInteger(gunluk) || gunluk < KIRA.minGunluk || gunluk > KIRA.maxGunluk) throw new OyunHatasi(400, `Günlük bedel ${KIRA.minGunluk}–${KIRA.maxGunluk}`);
  if (!Number.isInteger(gun) || gun < 1 || gun > KIRA.maxGun) throw new OyunHatasi(400, `Süre 1–${KIRA.maxGun} gün`);
  const id = (await db.run(`INSERT INTO kiralar (parcel_id, sahip_id, gunluk, gun, created_at) VALUES (?, ?, ?, ?, ?)`, p.id, userId, gunluk, gun, simdi())).lastInsertRowid;
  await L.denetim({ aktor: userId, eylem: 'LEASE_OFFERED', varlik: p.id, sonra: { gunluk, gun }, bolge: p.region_id, herkese: true });
  return { tamam: true, id };
});

const kirala = (userId, kiraId) => db.tx(async () => {
  const k = await db.get(`SELECT * FROM kiralar WHERE id = ?`, Number(kiraId));
  if (!k || k.durum !== 'TEKLIF') throw new OyunHatasi(404, 'Kira teklifi bulunamadı');
  if (k.sahip_id === userId) throw new OyunHatasi(400, 'Kendi parselini kiralayamazsın');
  if (simdi() > k.created_at + KIRA.teklifSuresiMs) throw new OyunHatasi(409, 'Teklifin süresi dolmuş');
  await parselKilitle(k.parcel_id);   // satış (pazar.devret) ve ekim ile aynı anda kiralanamasın
  // Bedel alınmadan önce: parsel kullanılabilir mi (dondurulmuş, el değiştirmiş ya da sahibi bu arada ekmiş olabilir)
  const p = await db.get(`SELECT owner_user_id, region_id, status FROM parcels WHERE id = ?`, k.parcel_id);
  if (p.status !== 'ACTIVE') throw new OyunHatasi(423, 'Parsel geçici olarak dondurulmuş; şu an kiralanamaz');
  if (p.owner_user_id !== k.sahip_id) throw new OyunHatasi(409, 'Parsel el değiştirmiş; bu teklif artık geçerli değil');
  if (await ekinVar(k.parcel_id)) throw new OyunHatasi(409, 'Tarlada şu an ekin var; sahibi hasat edince kiralayabilirsin', 'EKIN_VAR');
  const toplam = k.gunluk * k.gun;
  const ucret = Math.max(1, Math.floor(toplam * KIRA.ucretOrani));
  const t = simdi();
  // Koşullu yazma: aynı teklifi iki kiracı birden kabul edemez
  if ((await db.run(`UPDATE kiralar SET durum = 'AKTIF', kiraci_id = ?, baslangic = ?, bitis = ? WHERE id = ? AND durum = 'TEKLIF'`,
    userId, t, t + k.gun * BOZULMA.gunMs, k.id)).changes !== 1) throw new OyunHatasi(409, 'Teklif az önce değişti');
  const tx = L.yeniTx();
  await L.aktar({ kaynak: L.hesap(userId), hedef: L.hesap(k.sahip_id), tutar: toplam, sebep: `Kira bedeli ${k.parcel_id} (${k.gun} gün)`, tx });
  await L.aktar({ kaynak: L.hesap(k.sahip_id), hedef: 'SYS:SINK', tutar: ucret, sebep: 'Kira işlem ücreti', tx });
  await L.denetim({ aktor: userId, eylem: 'LEASE_STARTED', varlik: k.parcel_id, sonra: { gun: k.gun, toplam }, bolge: p.region_id, herkese: true });
  await bildir(k.sahip_id, `${await adi(userId)} ${k.parcel_id} parselini ${k.gun} günlüğüne kiraladı: ₳${toplam} (ücret ₳${ucret}).`, `parsel:${k.parcel_id}`);
  return { tamam: true, toplam, bitis: t + k.gun * BOZULMA.gunMs };
});

async function kiraIptal(userId, kiraId) {
  const r = await db.run(`UPDATE kiralar SET durum = 'IPTAL' WHERE id = ? AND sahip_id = ? AND durum = 'TEKLIF'`, Number(kiraId), userId);
  if (!r.changes) throw new OyunHatasi(409, 'Yalnızca bekleyen kendi teklifini geri çekebilirsin');
  return { tamam: true };
}
async function kiraBakim() {
  const t = simdi();
  for (const k of await db.all(`SELECT * FROM kiralar WHERE durum = 'AKTIF' AND bitis <= ?`, t)) {
    await db.tx(async () => {
      if (!(await db.run(`UPDATE kiralar SET durum = 'BITTI' WHERE id = ? AND durum = 'AKTIF'`, k.id)).changes) return;
      const ekin = await db.get(`SELECT 1 FROM crops WHERE parcel_id = ? AND status = 'GROWING' AND user_id = ?`, k.parcel_id, k.kiraci_id);
      await bildir(k.sahip_id, `${k.parcel_id} parselinin kira süresi doldu; kullanım hakkı sana döndü.${ekin ? ' Kiracının ektiği ekin hasat edilene kadar onundur.' : ''}`, `parsel:${k.parcel_id}`);
      await bildir(k.kiraci_id, `${k.parcel_id} parselinin kira süresi doldu.${ekin ? ' Ektiğin ekini yine sulayıp hasat edebilirsin.' : ''}`, `parsel:${k.parcel_id}`);
    });
  }
  await db.run(`UPDATE kiralar SET durum = 'IPTAL' WHERE durum = 'TEKLIF' AND created_at < ?`, t - KIRA.teklifSuresiMs);
}

// ---------- Ortaklık
const aktifOrtaklar = (parcelId) => db.all(`SELECT * FROM ortaklar WHERE parcel_id = ? AND durum = 'AKTIF'`, parcelId);
const ortakDavet = (userId, parcelId, govde = {}) => db.tx(async () => {
  const oyun = require('./oyun');
  await parselKilitle(parcelId);   // toplam pay denetimi eşzamanlı davetlerle aşılmasın
  const p = await oyun.parselGetir(parcelId);
  oyun.sahibiOlmali(p, userId);
  const ortak = await db.get(`SELECT id FROM users WHERE display_name = ? AND is_npc = 0 AND status = 'ACTIVE'`, typeof govde.ortakAd === 'string' ? govde.ortakAd.trim() : '');
  if (!ortak) throw new OyunHatasi(404, 'Bu adla oyuncu bulunamadı');
  if (ortak.id === userId) throw new OyunHatasi(400, 'Kendinle ortak olamazsın');
  const pay = Math.round(Number(govde.pay) * 100) / 100;
  if (!(pay >= ORTAKLIK.minPay && pay <= ORTAKLIK.maxToplamPay)) throw new OyunHatasi(400, `Pay %${ORTAKLIK.minPay * 100}–%${ORTAKLIK.maxToplamPay * 100}`);
  const mevcut = await db.all(`SELECT * FROM ortaklar WHERE parcel_id = ? AND durum IN ('DAVET', 'AKTIF')`, p.id);
  if (mevcut.length >= ORTAKLIK.maxOrtak) throw new OyunHatasi(409, `En fazla ${ORTAKLIK.maxOrtak} ortak`);
  if (mevcut.reduce((a, o) => a + o.pay, 0) + pay > ORTAKLIK.maxToplamPay + 1e-9) throw new OyunHatasi(409, `Ortakların toplam payı %${ORTAKLIK.maxToplamPay * 100}'yi geçemez`);
  // Benzersizlik (ux_ortak) çakışması hata yerine 409: Postgres'te işlem bozulmaz
  const r = await db.run(`INSERT OR IGNORE INTO ortaklar (parcel_id, sahip_id, ortak_id, pay, created_at) VALUES (?, ?, ?, ?, ?)`, p.id, userId, ortak.id, pay, simdi());
  if (r.changes !== 1) throw new OyunHatasi(409, 'Bu oyuncu zaten ortak ya da davetli');
  const id = r.lastInsertRowid;
  await bildir(ortak.id, `${await adi(userId)} seni ${p.id} parselinin hasadına %${Math.round(pay * 100)} payla ortak olmaya davet etti.`, `parsel:${p.id}`);
  return { tamam: true, id };
});
const ortakYanit = (userId, ortakId, kabul) => db.tx(async () => {
  const o = await db.get(`SELECT * FROM ortaklar WHERE id = ?`, Number(ortakId));
  if (!o || o.ortak_id !== userId || o.durum !== 'DAVET') throw new OyunHatasi(404, 'Davet bulunamadı');
  if ((await db.run(`UPDATE ortaklar SET durum = ? WHERE id = ? AND durum = 'DAVET'`, kabul ? 'AKTIF' : 'BITTI', o.id)).changes !== 1) {
    throw new OyunHatasi(404, 'Davet bulunamadı');
  }
  if (kabul) await L.denetim({ aktor: userId, eylem: 'PARTNERSHIP_STARTED', varlik: o.parcel_id, sonra: { pay: o.pay } });
  await bildir(o.sahip_id, `${await adi(userId)} ${o.parcel_id} ortaklık davetini ${kabul ? 'kabul etti' : 'reddetti'}.`, `parsel:${o.parcel_id}`);
  return { tamam: true };
});
const ortaklikBitir = (userId, ortakId) => db.tx(async () => {
  const o = await db.get(`SELECT * FROM ortaklar WHERE id = ?`, Number(ortakId));
  if (!o || ![o.sahip_id, o.ortak_id].includes(userId) || !['DAVET', 'AKTIF'].includes(o.durum)) throw new OyunHatasi(404, 'Ortaklık bulunamadı');
  if ((await db.run(`UPDATE ortaklar SET durum = 'BITTI' WHERE id = ? AND durum IN ('DAVET', 'AKTIF')`, o.id)).changes !== 1) {
    throw new OyunHatasi(404, 'Ortaklık bulunamadı');
  }
  await bildir(userId === o.sahip_id ? o.ortak_id : o.sahip_id, `${o.parcel_id} ortaklığı sona erdi.`, `parsel:${o.parcel_id}`);
  return { tamam: true };
});
// Hasat paylaşımı (hasat işleminin içinde çağrılır): ortakların payı aşağı yuvarlanır, kalan sahibe
async function hasatPaylastir(p, ekenId, miktar, urun, tx) {
  if (ekenId !== p.owner_user_id) return { sahibe: miktar, paylar: [] };
  let kalan = miktar;
  const paylar = [];
  for (const o of await aktifOrtaklar(p.id)) {
    const adet = Math.floor(miktar * o.pay);
    if (adet < 1) continue;
    await require('./ekonomi').envanterBozulmasi(o.ortak_id);   // birikmiş bozulma önce: yeni gelen pay geçmiş günlerden bozulmaz
    await L.envanterDegis(o.ortak_id, urun, adet, `Ortaklık hasat payı ${p.id}`, tx);
    kalan -= adet;
    paylar.push({ ortak: await adi(o.ortak_id), adet });
    await bildir(o.ortak_id, `${p.id} hasadından payına ${adet} ürün düştü.`, `parsel:${p.id}`);
  }
  return { sahibe: kalan, paylar };
}
// Satışta ortaklık ve bekleyen kira teklifleri sona erer
async function devirdeKapat(parcelId) {
  await db.run(`UPDATE ortaklar SET durum = 'BITTI' WHERE parcel_id = ? AND durum IN ('DAVET', 'AKTIF')`, parcelId);
  await db.run(`UPDATE kiralar SET durum = 'IPTAL' WHERE parcel_id = ? AND durum = 'TEKLIF'`, parcelId);
}

async function parselKira(parcelId, userId) {
  const k = await acikKira(parcelId);
  const ortaklar = await db.all(`SELECT o.id, o.pay, o.durum, o.ortak_id, u.display_name AS ad FROM ortaklar o JOIN users u ON u.id = o.ortak_id
                               WHERE o.parcel_id = ? AND o.durum IN ('DAVET', 'AKTIF')`, parcelId);
  return {
    kira: k && { id: k.id, durum: k.durum, gunluk: k.gunluk, gun: k.gun, bitis: k.bitis, kiraci: k.kiraci_id ? await adi(k.kiraci_id) : null, benKiraciyim: k.kiraci_id === userId, sahibiyim: k.sahip_id === userId },
    ortaklar: ortaklar.map((o) => ({ id: o.id, ad: o.ad, pay: o.pay, durum: o.durum, ben: o.ortak_id === userId })),
  };
}
const kiraliklar = () => db.all(`SELECT k.id, k.parcel_id, k.gunluk, k.gun, p.area_m2, r.name AS mahalle, rl.name AS il, u.display_name AS sahip
  FROM kiralar k JOIN parcels p ON p.id = k.parcel_id JOIN regions r ON r.id = p.region_id JOIN regions rl ON rl.id = p.il_id JOIN users u ON u.id = k.sahip_id
  WHERE k.durum = 'TEKLIF' AND k.created_at > ? ORDER BY k.id DESC LIMIT 40`, simdi() - KIRA.teklifSuresiMs);

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
