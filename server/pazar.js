// Oyuncular arası pazar (plan §8): ilan → teklif → fon kilidi → uygunluk denetimi → devir → kayıt ve bildirim.
// Her teklifin tutarı ESCROW:BID:<id> emanet hesabında kilitlenir; devir tek atomik işlemde yapılır (§8.4).
// Fiyat gösteriminde dört metrik ayrıdır: istenen fiyat, en yüksek teklif, son gerçekleşen işlem, gelişmişlik skoru (§8.5).
const db = require('./db');
const { PAZAR, HESAP, IMAR, YAPILAR, URUNLER } = require('./config/rules');
const L = require('./lib/ledger');
const oyun = require('./oyun');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const emanet = (bidId) => `ESCROW:BID:${bidId}`;
// Satıcı tüccar meslekliyse ücret indirimi (açık formül: ücret × (1 − meslek bonusu))
const ucretHesapla = async (fiyat, saticiId = null) => Math.max(PAZAR.minUcret, Math.floor(fiyat * PAZAR.ucretOrani * (1 - await require('./uretim').meslekBonusu(saticiId, 'TUCCAR'))));
const sqlZamani = (s) => new Date(s.replace(' ', 'T') + 'Z').getTime();
const sqlMetni = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);   // datetime('now') biçimi
const hazineMi = async (userId) => userId != null && userId === await require('./piyasa').hazineId(false);

function tamSayi(v, ad, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new OyunHatasi(400, `${ad} ${min}–${max} arasında tam sayı olmalı`);
  return n;
}
function kimlik(v, ad) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new OyunHatasi(400, `Geçersiz ${ad}`);
  return n;
}

const q = {
  kullanici: db.sorgu(`SELECT id, display_name, is_npc, status, created_at FROM users WHERE id = ?`),
  ilan: db.sorgu(`SELECT * FROM listings WHERE id = ?`),
  // İlan üzerindeki her değişiklik (teklif, kabul, satış, iptal) ilan satırını işlem sonuna kadar kilitler
  ilanKilitle: db.sorgu(`SELECT * FROM listings WHERE id = ? FOR UPDATE`),
  parselKilitle: db.sorgu(`SELECT id FROM parcels WHERE id = ? FOR UPDATE`),
  aktifIlanParsel: db.sorgu(`SELECT * FROM listings WHERE parcel_id = ? AND status = 'ACTIVE'`),
  teklif: db.sorgu(`SELECT * FROM bids WHERE id = ?`),
  aktifTeklifler: db.sorgu(`SELECT * FROM bids WHERE listing_id = ? AND status = 'ACTIVE' ORDER BY amount DESC, id`),
  benimAktifTeklifim: db.sorgu(`SELECT * FROM bids WHERE listing_id = ? AND buyer_id = ? AND status = 'ACTIVE'`),
  teklifDurum: db.sorgu(`UPDATE bids SET status = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'`),
  bildir: db.sorgu(`INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)`),
  // Aynı bildirim (metin + bağlantı) yinelenmez: eskisi silinip yenisi en üste yazılır (ör. dönen seçim aşamaları)
  bildirimYineleme: db.sorgu(`DELETE FROM notifications WHERE user_id = ? AND text = ? AND COALESCE(link, '') = COALESCE(?, '')`),
  parselSayisi: db.sorgu(`SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ?`),
  mahalleParselSayisi: db.sorgu(`SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ? AND region_id = ?`),
};

// Bildirim metnindeki ham parsel kimliği (TR-0618015-0407079) oyuncunun tanıdığı biçime çevrilir: "Bademli 231/67"
// (mahalle, Ada/Parsel). Bağlantı (link) kimliği korur.
const parselEtiketi = db.sorgu(`SELECT p.grid_x, p.grid_y, r.name AS mahalle FROM parcels p LEFT JOIN regions r ON r.id = p.region_id WHERE p.id = ?`);
async function okunurParsel(metin) {
  metin = String(metin);
  const etiket = new Map();
  for (const [id] of metin.matchAll(/TR-\d{7}-\d{7}/g)) {
    if (etiket.has(id)) continue;
    const p = await parselEtiketi.get(id);
    const ap = p && require('./harita/ada').adaParsel(p.grid_x, p.grid_y);
    etiket.set(id, p && ap ? `${p.mahalle || 'Parsel'} ${ap.ada}/${ap.parsel}` : id);
  }
  return etiket.size ? metin.replace(/TR-\d{7}-\d{7}/g, (id) => etiket.get(id)) : metin;
}
async function bildir(userId, metin, link = null) {
  const u = await q.kullanici.get(userId);
  if (!u || u.is_npc) return;
  metin = await okunurParsel(metin);
  await q.bildirimYineleme.run(userId, metin, link);
  const id = (await q.bildir.run(userId, metin, link)).lastInsertRowid;
  require('./lib/olaylar').yay('bildirim', { id, userId, metin, link });
}

// ---------- Varlık özeti (ilan ve devir anı) ----------
async function varlikOzeti(p) {
  const yapilar = await db.all(`SELECT type, status FROM structures WHERE parcel_id = ? ORDER BY id`, p.id);
  const ekin = await db.get(`SELECT crop_type, ready_at FROM crops WHERE parcel_id = ? AND status = 'GROWING'`, p.id);
  return {
    parsel: { id: p.id, mahalle: p.mahalle, alan: p.area_m2, imar: p.zoning_type },
    yapilar: yapilar.map((y) => ({ tip: y.type, ad: YAPILAR[y.type]?.ad, durum: y.status })),
    ekin: ekin ? { tip: ekin.crop_type, ad: URUNLER[ekin.crop_type]?.ad, hazir: ekin.ready_at } : null,
    borclar: [],
    haklar: ['Oyun içi kullanım hakkı (taşınmaz mülkiyeti değildir)'],
  };
}

// ---------- Bakım: süresi dolan ilanlar (tembel, idempotent) ----------
async function pazarBakim() {
  const biten = await db.all(`SELECT id FROM listings WHERE status = 'ACTIVE' AND expires_at <= ?`, simdi());
  if (!biten.length) return;
  await db.tx(async () => {
    for (const { id } of biten) {
      // Koşullu yazma: eşzamanlı bakım / satış aynı ilanı ikinci kez kapatamaz
      const r = await db.run(`UPDATE listings SET status = 'EXPIRED', closed_at = ?, version = version + 1 WHERE id = ? AND status = 'ACTIVE'`, simdi(), id);
      if (r.changes !== 1) continue;
      const ilan = await q.ilan.get(id);
      await teklifleriIadeEt(ilan, 'EXPIRED', 'İlan süresi doldu');
      await L.denetim({ anahtar: `LISTING_EXPIRED:${id}`, aktor: ilan.seller_id, eylem: 'LISTING_EXPIRED', varlik: `LISTING:${id}` });
      await bildir(ilan.seller_id, `${ilan.parcel_id} ilanının süresi doldu`, `parsel:${ilan.parcel_id}`);
    }
  });
}

// Aktif teklifi kapat ve kilitli tutarı teklif sahibine iade et (koşullu yazma: iade bir kez yapılır)
async function teklifIade(b, yeniDurum, sebep, tx = L.yeniTx()) {
  if ((await q.teklifDurum.run(yeniDurum, simdi(), b.id)).changes !== 1) return false;
  await L.aktar({ kaynak: emanet(b.id), hedef: L.hesap(b.buyer_id), tutar: b.amount, sebep: `Teklif iadesi: ${sebep}`, tx });
  return true;
}
async function teklifleriIadeEt(ilan, yeniDurum, sebep, haricId = null) {
  for (const b of await q.aktifTeklifler.all(ilan.id)) {
    if (b.id === haricId) continue;
    if (await teklifIade(b, yeniDurum, sebep)) {
      await bildir(b.buyer_id, `${ilan.parcel_id} için ₳${b.amount} teklifin iade edildi: ${sebep}`, `parsel:${ilan.parcel_id}`);
    }
  }
}

// İşlem içinde çağrılır: ilan satırı işlem sonuna kadar kilitlenir
async function aktifIlanGetir(ilanId) {
  const i = await q.ilanKilitle.get(kimlik(ilanId, 'ilan'));
  if (!i) throw new OyunHatasi(404, 'İlan bulunamadı');
  if (i.status !== 'ACTIVE' || i.expires_at <= simdi()) throw new OyunHatasi(409, 'İlan artık aktif değil', 'ILAN_KAPALI');
  return i;
}

// §8.3 buyer_conditions + §10.3 hesap başı limit
async function aliciUygunlukHatasi(userId, ilan, p) {
  const u = await q.kullanici.get(userId);
  if (!u || u.status !== 'ACTIVE') return 'Hesap işlem yapamaz durumda';
  const kosul = PAZAR.aliciKosullari[ilan.buyer_condition] || PAZAR.aliciKosullari.HERKES;
  if (kosul.yasMs && simdi() - sqlZamani(u.created_at) < kosul.yasMs) return `Satıcının alıcı koşulu: ${kosul.ad.toLocaleLowerCase('tr-TR')}`;
  const onde = (bolge) => require('./ihale').ondeOlunan(userId, { regionId: bolge });   // önde olunan açık ihaleler de sayılır
  if ((await q.parselSayisi.get(userId)).c + await onde(null) >= HESAP.maxParsel) return `Hesap başına en fazla ${HESAP.maxParsel} parsel (önde olduğun ihaleler dahil)`;
  if ((await q.mahalleParselSayisi.get(userId, p.region_id)).c + await onde(p.region_id) >= HESAP.maxParselMahalle) return `Bir mahallede en fazla ${HESAP.maxParselMahalle} parsel (önde olduğun ihaleler dahil)`;
  return null;
}
async function aliciUygunMu(userId, ilan, p) {
  const hata = await aliciUygunlukHatasi(userId, ilan, p);
  if (hata) throw new OyunHatasi(403, hata, 'ALICI_UYGUN_DEGIL');
}

// ---------- §8.5 / §10.3 manipülasyon işaretleri ----------
async function manipulasyonIsaretleri(saticiId, aliciId, p, fiyat, deger) {
  const isaretler = [];
  const pencere = simdi() - PAZAR.washPencereGun * 86400000;
  // Parsel, referans penceresinde daha önce sahibi olmuş birine dönüyor: A→B→A ve A→B→C→A döngüleri
  const geriDonus = await db.get(`SELECT 1 FROM parcel_ownership WHERE parcel_id = ? AND user_id = ? AND end_at IS NOT NULL AND end_at >= ?`,
    p.id, aliciId, sqlMetni(simdi() - PAZAR.referansGun * 86400000));
  if (geriDonus) isaretler.push('GERI_DONUS');
  const cift = (await db.get(`SELECT COUNT(*) AS c FROM trades WHERE created_at >= ? AND
    ((seller_id = ? AND buyer_id = ?) OR (seller_id = ? AND buyer_id = ?))`, pencere, saticiId, aliciId, aliciId, saticiId)).c;
  if (cift + 1 >= PAZAR.washCiftEsigi) isaretler.push('TEKRARLI_CIFT');
  // Olağandışı fiyat: satış anındaki tahmini değere göre (yapılı parsel arsa bedelinin çok üstünde satılabilir)
  const bedel = deger?.toplam || oyun.birincilBedel(p);
  if (fiyat > bedel * PAZAR.sapmaUst || fiyat < bedel * PAZAR.sapmaAlt) isaretler.push('FIYAT_SAPMASI');
  return isaretler;
}

// ---------- Devir (her zaman bir işlemin içinde çağrılır; ilan satırı çağıran tarafından kilitlenmiştir) ----------
async function devret(ilan, aliciId, fiyat, teklif) {
  await q.parselKilitle.get(ilan.parcel_id);   // sahiplik, kira ve ortaklık denetimi ile devir arasına başka işlem girmesin
  const p = await oyun.parselGetir(ilan.parcel_id);
  if (p.owner_user_id !== ilan.seller_id) throw new OyunHatasi(409, 'Satıcı artık bu parselin sahibi değil');
  if (p.status !== 'ACTIVE') throw new OyunHatasi(423, 'Parsel geçici olarak dondurulmuş');
  if (await require('./kira').aktifKira(p.id)) throw new OyunHatasi(409, 'Parsel kirada; kira bitmeden devredilemez');
  await aliciUygunMu(aliciId, ilan, p);
  await require('./kira').devirdeKapat(p.id);
  const degerAni = await oyun.parselDegeri(p);   // devirden önce: endeks ve fiyat sapması bu değere göre

  // İlan kilidi: aynı ilan iki kez satılamaz
  const t = simdi();
  const r = await db.run(`UPDATE listings SET status = 'SOLD', closed_at = ?, version = version + 1
                        WHERE id = ? AND status = 'ACTIVE' AND version = ?`, t, ilan.id, ilan.version);
  if (r.changes !== 1) throw new OyunHatasi(409, 'İlan az önce değişti; tekrar deneyin', 'ILAN_DEGISTI');

  const ucret = await ucretHesapla(fiyat, ilan.seller_id);
  const tx = L.yeniTx();
  const kaynak = teklif ? emanet(teklif.id) : L.hesap(aliciId);
  if (teklif) {
    if ((await q.teklifDurum.run('ACCEPTED', t, teklif.id)).changes !== 1) throw new OyunHatasi(409, 'Teklif artık geçerli değil');
  } else if (await L.bakiye(aliciId) < fiyat) {
    throw new OyunHatasi(402, `Yetersiz bakiye: ${fiyat} akçe gerekli`, 'YETERSIZ_BAKIYE');
  }
  if (fiyat > ucret) await L.aktar({ kaynak, hedef: L.hesap(ilan.seller_id), tutar: fiyat - ucret, sebep: `Parsel satışı ${p.id}`, tx });
  await L.aktar({ kaynak, hedef: 'SYS:SINK', tutar: ucret, sebep: `İşlem masrafı ${p.id}`, tx });
  await require('./belediye').belediyePayi(p.ilce_id, ucret, 'islemPayi', 'pazar işlem payı', tx);

  // Sahiplik devri: eski kaydı kapat, yenisini aç; parsel sürümü kilidiyle
  await db.run(`UPDATE parcel_ownership SET end_at = datetime('now') WHERE parcel_id = ? AND end_at IS NULL`, p.id);
  await db.run(`INSERT INTO parcel_ownership (parcel_id, user_id, reason, price) VALUES (?, ?, 'TRADE', ?)`, p.id, aliciId, fiyat);
  const pr = await db.run(`UPDATE parcels SET owner_user_id = ?, acquired_at = datetime('now'), version = version + 1
                         WHERE id = ? AND owner_user_id = ? AND version = ?`, aliciId, p.id, ilan.seller_id, p.version);
  if (pr.changes !== 1) throw new OyunHatasi(409, 'Parsel az önce değişti; tekrar deneyin');
  await db.run(`UPDATE structures SET owner_user_id = ?, gelir_at = ? WHERE parcel_id = ?`, aliciId, t, p.id);   // kira sayacı yeni sahiple başlar
  await db.run(`UPDATE crops SET user_id = ? WHERE parcel_id = ? AND status = 'GROWING'`, aliciId, p.id);
  // Tesislerde süren üretim ve beslenmiş hayvanların ürünü de yapıyla birlikte alıcıya geçer
  await db.run(`UPDATE uretimler SET user_id = ? WHERE parcel_id = ? AND durum = 'URETIMDE'`, aliciId, p.id);
  await db.run(`UPDATE hayvan_bakim SET user_id = ? WHERE structure_id IN (SELECT id FROM structures WHERE parcel_id = ?)`, aliciId, p.id);

  const isaretler = await manipulasyonIsaretleri(ilan.seller_id, aliciId, p, fiyat, degerAni);
  const tradeId = (await db.run(`INSERT INTO trades (listing_id, parcel_id, seller_id, buyer_id, price, fee, via, asset_snapshot, flags, created_at, deger_ani, carpan_ani)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ilan.id, p.id, ilan.seller_id, aliciId, fiyat, ucret, teklif ? 'BID' : 'BUY_NOW',
  JSON.stringify(await varlikOzeti(p)), JSON.stringify(isaretler), t, degerAni.toplam, degerAni.carpan)).lastInsertRowid;

  await teklifleriIadeEt(ilan, 'CANCELLED', 'parsel başka bir alıcıya devredildi', teklif?.id);

  const satici = await q.kullanici.get(ilan.seller_id), alici = await q.kullanici.get(aliciId);
  await L.denetim({ anahtar: `PARCEL_TRADED:${ilan.id}`, aktor: aliciId, eylem: 'PARCEL_TRADED', varlik: p.id,
    once: { sahip: satici.display_name }, sonra: { fiyat, satici: satici.display_name, ilan: ilan.id, trade: tradeId },
    bolge: p.region_id, herkese: true });
  if (isaretler.length) {
    await L.denetim({ anahtar: `TRADE_FLAGGED:${tradeId}`, eylem: 'TRADE_FLAGGED', varlik: `TRADE:${tradeId}`, sonra: { isaretler } });
  }
  await bildir(ilan.seller_id, `${p.id} parselin ${alici.display_name} adlı oyuncuya ₳${fiyat} karşılığında devredildi (masraf ₳${ucret})`, `parsel:${p.id}`);
  await bildir(aliciId, `${p.id} parseli artık sende (₳${fiyat})`, `parsel:${p.id}`);
  return { tamam: true, tradeId, fiyat, ucret, parsel: p.id, isaretler };
}

// ---------- İlan işlemleri (satıcı) ----------
const ilanAc = (userId, parcelId, govde) => db.tx(async () => {
  await q.parselKilitle.get(parcelId);   // aynı parsele eşzamanlı ilan / kira teklifi açılmasın
  const p = await oyun.parselGetir(parcelId);
  oyun.sahibiOlmali(p, userId);
  const fiyat = tamSayi(govde?.fiyat, 'Fiyat', 1, PAZAR.maxFiyat);
  const gun = Number(govde?.gun ?? 3);
  if (!PAZAR.ilanSureleri.includes(gun)) throw new OyunHatasi(400, `İlan süresi ${PAZAR.ilanSureleri.join(', ')} gün olabilir`);
  const kosul = String(govde?.kosul || 'HERKES');
  if (!oyun.bul(PAZAR.aliciKosullari, kosul)) throw new OyunHatasi(400, 'Geçersiz alıcı koşulu');
  if (await q.aktifIlanParsel.get(p.id)) throw new OyunHatasi(409, 'Bu parsel zaten ilanda');
  if (await require('./kira').acikKira(p.id)) throw new OyunHatasi(409, 'Kirada ya da kira teklifindeki parsel satışa çıkarılamaz');
  const t = simdi();
  const id = (await db.run(`INSERT INTO listings (parcel_id, seller_id, asking_price, asset_snapshot, fee_rate, buyer_condition, created_at, expires_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  p.id, userId, fiyat, JSON.stringify(await varlikOzeti(p)), PAZAR.ucretOrani, kosul, t, t + PAZAR.ilanSuresiMs(gun))).lastInsertRowid;
  await L.denetim({ anahtar: `LISTING_CREATED:${id}`, aktor: userId, eylem: 'LISTING_CREATED', varlik: `LISTING:${id}`,
    sonra: { fiyat, gun, kosul, parsel: p.id }, bolge: p.region_id, herkese: true });
  const ucret = await ucretHesapla(fiyat, userId);
  return { tamam: true, ilanId: id, ucret, net: fiyat - ucret };
});

const fiyatDegistir = (userId, ilanId, govde) => db.tx(async () => {
  const i = await aktifIlanGetir(ilanId);
  if (i.seller_id !== userId) throw new OyunHatasi(403, 'Bu ilan senin değil');
  const fiyat = tamSayi(govde?.fiyat, 'Fiyat', 1, PAZAR.maxFiyat);
  if (fiyat === i.asking_price) throw new OyunHatasi(409, 'Fiyat aynı');
  const r = await db.run(`UPDATE listings SET asking_price = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'ACTIVE'`,
    fiyat, i.id, i.version);
  if (r.changes !== 1) throw new OyunHatasi(409, 'İlan az önce değişti; tekrar deneyin');
  await L.denetim({ aktor: userId, eylem: 'LISTING_PRICE_CHANGED', varlik: `LISTING:${i.id}`, once: { fiyat: i.asking_price }, sonra: { fiyat } });
  // İstenen fiyata eşit ya da üstündeki teklifler artık "hemen al" sayılmaz; satıcı yine de kabul edebilir
  return { tamam: true, fiyat };
});

const ilanIptal = (userId, ilanId) => db.tx(async () => {
  const i = await aktifIlanGetir(ilanId);
  if (i.seller_id !== userId) throw new OyunHatasi(403, 'Bu ilan senin değil');
  const r = await db.run(`UPDATE listings SET status = 'CANCELLED', closed_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'ACTIVE'`,
    simdi(), i.id, i.version);
  if (r.changes !== 1) throw new OyunHatasi(409, 'İlan az önce değişti; tekrar deneyin');
  await teklifleriIadeEt(i, 'CANCELLED', 'satıcı ilanı kaldırdı');
  await L.denetim({ aktor: userId, eylem: 'LISTING_CANCELLED', varlik: `LISTING:${i.id}` });
  return { tamam: true };
});

const teklifKabul = (userId, teklifId) => db.tx(async () => {
  const b0 = await q.teklif.get(kimlik(teklifId, 'teklif'));
  if (!b0 || b0.status !== 'ACTIVE') throw new OyunHatasi(409, 'Teklif artık geçerli değil');
  const i = await aktifIlanGetir(b0.listing_id);
  // İlan kilitlendikten sonra teklif yeniden okunur (arada geri çekilmiş / yükseltilmiş olabilir)
  const b = await q.teklif.get(b0.id);
  if (b.status !== 'ACTIVE') throw new OyunHatasi(409, 'Teklif artık geçerli değil');
  if (i.seller_id !== userId) throw new OyunHatasi(403, 'Bu ilan senin değil');
  const p = await oyun.parselGetir(i.parcel_id);
  const engel = await aliciUygunlukHatasi(b.buyer_id, i, p);
  if (engel) {
    // Alıcı artık uygun değil: teklif reddedilir ve kilit çözülür; işlem yine de kaydedilir
    await teklifIade(b, 'REJECTED', `alıcı uygun değil (${engel})`);
    await bildir(b.buyer_id, `${i.parcel_id} için teklifin kabul edilemedi: ${engel}. Tutar iade edildi.`, `parsel:${i.parcel_id}`);
    return { tamam: false, mesaj: `Alıcı artık uygun değil: ${engel}. Teklif iade edildi.` };
  }
  return devret(i, b.buyer_id, b.amount, b);
});

const teklifRed = (userId, teklifId) => db.tx(async () => {
  const b = await q.teklif.get(kimlik(teklifId, 'teklif'));
  if (!b || b.status !== 'ACTIVE') throw new OyunHatasi(409, 'Teklif artık geçerli değil');
  const i = await q.ilanKilitle.get(b.listing_id);
  if (i.seller_id !== userId) throw new OyunHatasi(403, 'Bu ilan senin değil');
  // Koşullu iade: teklif bu arada kabul edilmiş / geri çekilmişse ikinci kez iade edilmez
  if (!await teklifIade(b, 'REJECTED', 'satıcı reddetti')) throw new OyunHatasi(409, 'Teklif artık geçerli değil');
  await L.denetim({ aktor: userId, eylem: 'BID_REJECTED', varlik: `LISTING:${i.id}`, sonra: { teklif: b.id, tutar: b.amount } });
  await bildir(b.buyer_id, `${i.parcel_id} için ₳${b.amount} teklifin reddedildi; tutar iade edildi`, `parsel:${i.parcel_id}`);
  return { tamam: true };
});

// ---------- Alıcı işlemleri ----------
const teklifVer = (userId, ilanId, govde) => db.tx(async () => {
  const i = await aktifIlanGetir(ilanId);
  if (i.seller_id === userId) throw new OyunHatasi(409, 'Kendi ilanına teklif veremezsin');
  if (await hazineMi(i.seller_id)) throw new OyunHatasi(409, "Hazine pazarlık yapmaz; ilan fiyatından almak için Hemen al'ı kullan", 'HAZINE_PAZARLIK_YOK');
  const p = await oyun.parselGetir(i.parcel_id);
  await aliciUygunMu(userId, i, p);
  const tutar = tamSayi(govde?.tutar, 'Teklif', 1, PAZAR.maxFiyat);
  if (tutar >= i.asking_price) throw new OyunHatasi(409, 'Teklif istenen fiyata eşit ya da yüksek; "Hemen al" kullan');
  const mevcut = await q.benimAktifTeklifim.get(i.id, userId);
  if (mevcut && tutar <= mevcut.amount) throw new OyunHatasi(409, `Yeni teklif mevcut teklifinden (₳${mevcut.amount}) yüksek olmalı`);

  const tx = L.yeniTx();
  if (mevcut) await teklifIade(mevcut, 'REPLACED', 'teklif yükseltildi', tx);
  const t = simdi();
  const id = (await db.run(`INSERT INTO bids (listing_id, buyer_id, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    i.id, userId, tutar, t, t)).lastInsertRowid;
  await L.aktar({ kaynak: L.hesap(userId), hedef: emanet(id), tutar, sebep: `Teklif kilidi (ilan #${i.id})`, tx });   // fon kilidi
  await L.denetim({ aktor: userId, eylem: 'BID_PLACED', varlik: `LISTING:${i.id}`, sonra: { teklif: id, tutar } });

  const satici = await q.kullanici.get(i.seller_id);
  if (satici.is_npc) {
    // Demo komşu: istenen fiyatın belirli oranı ve üstünü kabul eder, altını reddeder
    if (tutar >= Math.ceil(i.asking_price * PAZAR.npcKabulOrani)) {
      return { ...await devret(await q.ilan.get(i.id), userId, tutar, await q.teklif.get(id)), npcKabul: true };
    }
    await teklifIade(await q.teklif.get(id), 'REJECTED', `${satici.display_name} bu fiyatı düşük buldu`);
    return { tamam: true, teklifId: id, npcRed: true, mesaj: `${satici.display_name} teklifini düşük buldu; tutar iade edildi` };
  }
  const alici = await q.kullanici.get(userId);
  await bildir(i.seller_id, `${i.parcel_id} ilanına ${alici.display_name} ₳${tutar} teklif verdi`, `parsel:${i.parcel_id}`);
  return { tamam: true, teklifId: id, tutar };
});

const teklifGeriCek = (userId, ilanId) => db.tx(async () => {
  const i = await q.ilanKilitle.get(kimlik(ilanId, 'ilan'));
  if (!i) throw new OyunHatasi(404, 'İlan bulunamadı');
  const b = await q.benimAktifTeklifim.get(i.id, userId);
  if (!b) throw new OyunHatasi(409, 'Bu ilanda aktif teklifin yok');
  if (!await teklifIade(b, 'WITHDRAWN', 'teklif geri çekildi')) throw new OyunHatasi(409, 'Bu ilanda aktif teklifin yok');
  await L.denetim({ aktor: userId, eylem: 'BID_WITHDRAWN', varlik: `LISTING:${i.id}`, sonra: { teklif: b.id } });
  return { tamam: true, iade: b.amount };
});

const hemenAl = (userId, ilanId, govde) => db.tx(async () => {
  const i = await aktifIlanGetir(ilanId);
  if (i.seller_id === userId) throw new OyunHatasi(409, 'Kendi ilanını satın alamazsın');
  // İstemcinin gördüğü fiyat değiştiyse işlemi yapma (fiyat sürprizi yok)
  if (govde?.fiyat != null && Number(govde.fiyat) !== i.asking_price) {
    throw new OyunHatasi(409, `İstenen fiyat ₳${i.asking_price} olarak güncellendi; tekrar kontrol et`, 'FIYAT_DEGISTI');
  }
  const mevcut = await q.benimAktifTeklifim.get(i.id, userId);
  if (mevcut) await teklifIade(mevcut, 'REPLACED', 'hemen al ile değiştirildi');
  return devret(await q.ilan.get(i.id), userId, i.asking_price, null);
});

// ---------- Okuma: ilan listesi, parsel ilan bilgisi, benim pazarım ----------
// Hazine oyunun kendisidir: demo komşu (npc) sayılmaz, ayrı işaretlenir
async function saticiBilgisi(saticiId, ad, isNpc, userId) {
  const hazine = await hazineMi(saticiId);
  return { ad, npc: !!isNpc && !hazine, hazine, ben: saticiId === userId };
}
async function ilanSatiri(i, userId) {
  const enYuksek = await db.get(`SELECT MAX(amount) AS m, COUNT(*) AS c FROM bids WHERE listing_id = ? AND status = 'ACTIVE'`, i.id);
  return {
    id: i.id, parsel: i.parcel_id, mahalle: i.mahalle, ilce: i.ilce, il: i.il, alan: i.area_m2, imar: i.zoning_type,
    konum: { lon: i.centroid_lon, lat: i.centroid_lat },
    fiyat: i.asking_price, enYuksekTeklif: enYuksek.m, teklifSayisi: enYuksek.c,
    satici: await saticiBilgisi(i.seller_id, i.satici, i.is_npc, userId),
    bitis: i.expires_at, olusturma: i.created_at, kosul: i.buyer_condition,
    m2Fiyat: Math.round((i.asking_price / i.area_m2) * 100) / 100,
    yapiSayisi: i.yapi,
  };
}

const ILAN_SEC = `SELECT l.*, p.area_m2, p.zoning_type, p.centroid_lon, p.centroid_lat, r.name AS mahalle, ri.name AS ilce, rl.name AS il,
    u.display_name AS satici, u.is_npc,
    (SELECT COUNT(*) FROM structures s WHERE s.parcel_id = p.id AND s.status = 'ACTIVE') AS yapi
  FROM listings l JOIN parcels p ON p.id = l.parcel_id JOIN regions r ON r.id = p.region_id
    JOIN regions ri ON ri.id = p.ilce_id JOIN regions rl ON rl.id = p.il_id JOIN users u ON u.id = l.seller_id`;

async function ilanlar({ il, ilce, imar, sirala } = {}, userId) {
  await pazarBakim();
  const kosullar = [`l.status = 'ACTIVE'`];
  const params = [];
  if (il) { kosullar.push('p.il_id = ?'); params.push(kimlik(il, 'il')); }
  if (ilce) { kosullar.push('p.ilce_id = ?'); params.push(kimlik(ilce, 'ilçe')); }
  if (imar) {
    if (!oyun.bul(IMAR, imar)) throw new OyunHatasi(400, 'Geçersiz imar türü');
    kosullar.push('p.zoning_type = ?'); params.push(imar);
  }
  const siralama = { ucuz: 'l.asking_price ASC', pahali: 'l.asking_price DESC', yeni: 'l.id DESC', bitis: 'l.expires_at ASC', m2: 'CAST(l.asking_price AS REAL) / p.area_m2 ASC' }[sirala] || 'l.id DESC';
  const satirlar = await db.all(`${ILAN_SEC} WHERE ${kosullar.join(' AND ')} ORDER BY ${siralama} LIMIT 60`, ...params);
  const sonuc = [];
  for (const i of satirlar) sonuc.push(await ilanSatiri(i, userId));
  return sonuc;
}

// §8.5: referans fiyat yalnızca işaretsiz işlemlerden; az işlem varsa güvenilirlik uyarısı
async function piyasaGostergeleri(p) {
  const pencere = simdi() - PAZAR.referansGun * 86400000;
  const sonIslem = await db.get(`SELECT price, created_at FROM trades WHERE parcel_id = ? AND flags = '[]' ORDER BY id DESC LIMIT 1`, p.id);
  const mahalle = await db.all(`SELECT t.price, pp.area_m2 FROM trades t JOIN parcels pp ON pp.id = t.parcel_id
                              WHERE pp.region_id = ? AND t.flags = '[]' AND t.created_at >= ?`, p.region_id, pencere);
  const m2ler = mahalle.map((x) => x.price / x.area_m2).sort((a, b) => a - b);
  const medyan = m2ler.length ? m2ler[Math.floor((m2ler.length - 1) / 2)] : null;
  return {
    sonIslem: sonIslem ? { fiyat: sonIslem.price, tarih: sonIslem.created_at } : null,
    mahalleIslemSayisi: mahalle.length,
    mahalleMedyanM2: medyan == null ? null : Math.round(medyan * 100) / 100,
    guvenilirlikDusuk: mahalle.length < PAZAR.guvenilirlikEsigi,
    referansGun: PAZAR.referansGun,
  };
}

async function parselPazarBilgisi(parcelId, userId) {
  await pazarBakim();
  const p = await oyun.parselGetir(parcelId);
  const i = await q.aktifIlanParsel.get(p.id);
  const piyasa = await piyasaGostergeleri(p);
  // Tüccar mesleğinin işlem masrafı indirimi (ilan formundaki net önizleme için)
  const ucretIndirimi = userId ? await require('./uretim').meslekBonusu(userId, 'TUCCAR') : 0;
  if (!i) return { ilan: null, piyasa, ucretIndirimi };

  const satici = await q.kullanici.get(i.seller_id);
  const benimIlanim = i.seller_id === userId;
  const aktif = await q.aktifTeklifler.all(i.id);
  const tumTeklifler = await db.all(`SELECT b.*, u.display_name FROM bids b JOIN users u ON u.id = b.buyer_id WHERE b.listing_id = ? ORDER BY b.id`, i.id);
  // Teklif sahipleri yalnızca satıcıya ve kendilerine adıyla görünür; diğerlerine "Alıcı 1, 2…"
  const sira = new Map();
  for (const b of tumTeklifler) if (!sira.has(b.buyer_id)) sira.set(b.buyer_id, sira.size + 1);
  const teklifSahibi = (b) => (benimIlanim || b.buyer_id === userId ? b.display_name : `Alıcı ${sira.get(b.buyer_id)}`);
  const olaylar = await db.all(`SELECT action, before_json, after_json, created_at FROM audit_events
                              WHERE entity = ? AND action IN ('LISTING_CREATED','LISTING_PRICE_CHANGED') ORDER BY id`, `LISTING:${i.id}`);
  const gecmis = [
    ...olaylar.map((o) => ({ tur: o.action, zaman: sqlZamani(o.created_at), once: JSON.parse(o.before_json || 'null'), sonra: JSON.parse(o.after_json || 'null') })),
    ...tumTeklifler.map((b) => ({ tur: 'TEKLIF', zaman: b.created_at, tutar: b.amount, durum: b.status, kim: teklifSahibi(b), ben: b.buyer_id === userId })),
  ].sort((a, b) => a.zaman - b.zaman);

  const benimTeklifim = userId ? await q.benimAktifTeklifim.get(i.id, userId) : null;
  const engel = userId && !benimIlanim ? await aliciUygunlukHatasi(userId, i, p) : null;
  const kosul = PAZAR.aliciKosullari[i.buyer_condition];
  const ucret = await ucretHesapla(i.asking_price, i.seller_id);
  let teklifler = null;
  if (benimIlanim) {
    teklifler = [];
    for (const b of aktif) {
      const bUcret = await ucretHesapla(b.amount, i.seller_id);
      teklifler.push({ id: b.id, tutar: b.amount, kim: (await q.kullanici.get(b.buyer_id)).display_name, zaman: b.created_at,
        ucret: bUcret, net: b.amount - bUcret });
    }
  }
  return {
    ilan: {
      id: i.id, fiyat: i.asking_price, birim: i.listing_currency, olusturma: i.created_at, bitis: i.expires_at,
      satici: await saticiBilgisi(satici.id, satici.display_name, satici.is_npc, userId),
      kosul: { kod: i.buyer_condition, ad: kosul.ad },
      ucretOrani: i.fee_rate, ucret, net: i.asking_price - ucret,
      ilanAniVarliklar: JSON.parse(i.asset_snapshot),
      guncelVarliklar: await varlikOzeti(p),
      enYuksekTeklif: aktif[0]?.amount ?? null,
      teklifSayisi: aktif.length,
      teklifler,
      benimTeklifim: benimTeklifim ? { id: benimTeklifim.id, tutar: benimTeklifim.amount } : null,
      aliciEngeli: engel,
      gecmis,
    },
    piyasa,
    ucretIndirimi,
  };
}

async function benimPazarim(userId) {
  await pazarBakim();
  const ilanlarim = [];
  for (const i of await db.all(`${ILAN_SEC} WHERE l.seller_id = ? ORDER BY (l.status = 'ACTIVE') DESC, l.id DESC LIMIT 20`, userId)) {
    ilanlarim.push({ ...await ilanSatiri(i, userId), durum: i.status });
  }
  const tekliflerim = await db.all(`
    SELECT b.id, b.amount, b.status, b.created_at, b.updated_at, l.id AS ilan, l.parcel_id, l.asking_price, l.status AS ilan_durum,
      r.name AS mahalle, ri.name AS ilce
    FROM bids b JOIN listings l ON l.id = b.listing_id JOIN parcels p ON p.id = l.parcel_id JOIN regions r ON r.id = p.region_id
      JOIN regions ri ON ri.id = p.ilce_id
    WHERE b.buyer_id = ? ORDER BY (b.status = 'ACTIVE') DESC, b.id DESC LIMIT 20`, userId);
  const islemlerim = (await db.all(`
    SELECT t.id, t.parcel_id, t.price, t.fee, t.via, t.created_at, t.seller_id, t.buyer_id, s.display_name AS satici, a.display_name AS alici
    FROM trades t JOIN users s ON s.id = t.seller_id JOIN users a ON a.id = t.buyer_id
    WHERE t.seller_id = ? OR t.buyer_id = ? ORDER BY t.id DESC LIMIT 20`, userId, userId))
    .map((t) => ({ ...t, yon: t.buyer_id === userId ? 'ALIS' : 'SATIS' }));
  return { ilanlarim, tekliflerim, islemlerim };
}

async function sonIslemler() {
  return (await db.all(`
    SELECT t.id, t.parcel_id, t.price, t.via, t.flags, t.created_at, p.area_m2, p.zoning_type, r.name AS mahalle,
      ri.name AS ilce, rl.name AS il, s.display_name AS satici, a.display_name AS alici
    FROM trades t JOIN parcels p ON p.id = t.parcel_id JOIN regions r ON r.id = p.region_id
      JOIN regions ri ON ri.id = p.ilce_id JOIN regions rl ON rl.id = p.il_id
      JOIN users s ON s.id = t.seller_id JOIN users a ON a.id = t.buyer_id
    ORDER BY t.id DESC LIMIT 30`))
    .map((t) => ({ ...t, flags: undefined, incelemede: t.flags !== '[]', m2Fiyat: Math.round((t.price / t.area_m2) * 100) / 100 }));
}

async function pazarOzeti(userId) {
  return {
    kilitli: (await db.get(`SELECT COALESCE(SUM(amount), 0) AS s FROM bids WHERE buyer_id = ? AND status = 'ACTIVE'`, userId)).s,
    gelenTeklif: (await db.get(`SELECT COUNT(*) AS c FROM bids b JOIN listings l ON l.id = b.listing_id
                             WHERE l.seller_id = ? AND l.status = 'ACTIVE' AND b.status = 'ACTIVE'`, userId)).c,
    okunmamis: (await db.get(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`, userId)).c,
  };
}

async function bildirimler(userId) {
  // Eski kayıtlarda ham parsel kimliği olabilir: okunurken de çevrilir. okundu 0/1 (Postgres'te boolean olmasın)
  const satirlar = await db.all(`SELECT id, text, link, CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END AS okundu, created_at
                                 FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60`, userId);
  const sonuc = [];
  for (const b of satirlar) sonuc.push(/TR-\d{7}-\d{7}/.test(b.text) ? { ...b, text: await okunurParsel(b.text) } : b);
  return sonuc;
}
async function bildirimleriOku(userId) {
  await db.run(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`, userId);
  return { tamam: true };
}

module.exports = {
  pazarBakim, ilanAc, fiyatDegistir, ilanIptal, teklifVer, teklifGeriCek, teklifKabul, teklifRed, hemenAl,
  ilanlar, parselPazarBilgisi, benimPazarim, sonIslemler, pazarOzeti, bildirimler, bildirimleriOku,
  ucretHesapla, bildir,
};
