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
const ucretHesapla = (fiyat, saticiId = null) => Math.max(PAZAR.minUcret, Math.floor(fiyat * PAZAR.ucretOrani * (1 - require('./uretim').meslekBonusu(saticiId, 'TUCCAR'))));
const sqlZamani = (s) => new Date(s.replace(' ', 'T') + 'Z').getTime();

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
  kullanici: db.prepare(`SELECT id, display_name, is_npc, status, created_at FROM users WHERE id = ?`),
  ilan: db.prepare(`SELECT * FROM listings WHERE id = ?`),
  aktifIlanParsel: db.prepare(`SELECT * FROM listings WHERE parcel_id = ? AND status = 'ACTIVE'`),
  teklif: db.prepare(`SELECT * FROM bids WHERE id = ?`),
  aktifTeklifler: db.prepare(`SELECT * FROM bids WHERE listing_id = ? AND status = 'ACTIVE' ORDER BY amount DESC, id`),
  benimAktifTeklifim: db.prepare(`SELECT * FROM bids WHERE listing_id = ? AND buyer_id = ? AND status = 'ACTIVE'`),
  teklifDurum: db.prepare(`UPDATE bids SET status = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'`),
  bildir: db.prepare(`INSERT INTO notifications (user_id, text, link) VALUES (?, ?, ?)`),
  parselSayisi: db.prepare(`SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ?`),
  mahalleParselSayisi: db.prepare(`SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ? AND region_id = ?`),
};

function bildir(userId, metin, link = null) {
  const u = q.kullanici.get(userId);
  if (!u || u.is_npc) return;
  const id = q.bildir.run(userId, metin, link).lastInsertRowid;
  require('./lib/olaylar').yay('bildirim', { id, userId, metin, link });
}

// ---------- Varlık özeti (ilan ve devir anı) ----------
function varlikOzeti(p) {
  const yapilar = db.prepare(`SELECT type, status FROM structures WHERE parcel_id = ? ORDER BY id`).all(p.id);
  const ekin = db.prepare(`SELECT crop_type, ready_at FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(p.id);
  return {
    parsel: { id: p.id, mahalle: p.mahalle, alan: p.area_m2, imar: p.zoning_type },
    yapilar: yapilar.map((y) => ({ tip: y.type, ad: YAPILAR[y.type]?.ad, durum: y.status })),
    ekin: ekin ? { tip: ekin.crop_type, ad: URUNLER[ekin.crop_type]?.ad, hazir: ekin.ready_at } : null,
    borclar: [],
    haklar: ['Oyun içi kullanım hakkı (taşınmaz mülkiyeti değildir)'],
  };
}

// ---------- Bakım: süresi dolan ilanlar (tembel, idempotent) ----------
function pazarBakim() {
  const biten = db.prepare(`SELECT id FROM listings WHERE status = 'ACTIVE' AND expires_at <= ?`).all(simdi());
  if (!biten.length) return;
  db.transaction(() => {
    for (const { id } of biten) {
      const r = db.prepare(`UPDATE listings SET status = 'EXPIRED', closed_at = ?, version = version + 1 WHERE id = ? AND status = 'ACTIVE'`).run(simdi(), id);
      if (r.changes !== 1) continue;
      const ilan = q.ilan.get(id);
      teklifleriIadeEt(ilan, 'EXPIRED', 'İlan süresi doldu');
      L.denetim({ anahtar: `LISTING_EXPIRED:${id}`, aktor: ilan.seller_id, eylem: 'LISTING_EXPIRED', varlik: `LISTING:${id}` });
      bildir(ilan.seller_id, `${ilan.parcel_id} ilanının süresi doldu`, `parsel:${ilan.parcel_id}`);
    }
  })();
}

// Aktif teklifi kapat ve kilitli tutarı teklif sahibine iade et
function teklifIade(b, yeniDurum, sebep, tx = L.yeniTx()) {
  if (q.teklifDurum.run(yeniDurum, simdi(), b.id).changes !== 1) return false;
  L.aktar({ kaynak: emanet(b.id), hedef: L.hesap(b.buyer_id), tutar: b.amount, sebep: `Teklif iadesi: ${sebep}`, tx });
  return true;
}
function teklifleriIadeEt(ilan, yeniDurum, sebep, haricId = null) {
  for (const b of q.aktifTeklifler.all(ilan.id)) {
    if (b.id === haricId) continue;
    if (teklifIade(b, yeniDurum, sebep)) {
      bildir(b.buyer_id, `${ilan.parcel_id} için ₳${b.amount} teklifin iade edildi: ${sebep}`, `parsel:${ilan.parcel_id}`);
    }
  }
}

function aktifIlanGetir(ilanId) {
  const i = q.ilan.get(kimlik(ilanId, 'ilan'));
  if (!i) throw new OyunHatasi(404, 'İlan bulunamadı');
  if (i.status !== 'ACTIVE' || i.expires_at <= simdi()) throw new OyunHatasi(409, 'İlan artık aktif değil', 'ILAN_KAPALI');
  return i;
}

// §8.3 buyer_conditions + §10.3 hesap başı limit
function aliciUygunlukHatasi(userId, ilan, p) {
  const u = q.kullanici.get(userId);
  if (!u || u.status !== 'ACTIVE') return 'Hesap işlem yapamaz durumda';
  const kosul = PAZAR.aliciKosullari[ilan.buyer_condition] || PAZAR.aliciKosullari.HERKES;
  if (kosul.yasMs && simdi() - sqlZamani(u.created_at) < kosul.yasMs) return `Satıcının alıcı koşulu: ${kosul.ad.toLocaleLowerCase('tr-TR')}`;
  if (q.parselSayisi.get(userId).c >= HESAP.maxParsel) return `Hesap başına en fazla ${HESAP.maxParsel} parsel`;
  if (q.mahalleParselSayisi.get(userId, p.region_id).c >= HESAP.maxParselMahalle) return `Bir mahallede en fazla ${HESAP.maxParselMahalle} parsel`;
  return null;
}
function aliciUygunMu(userId, ilan, p) {
  const hata = aliciUygunlukHatasi(userId, ilan, p);
  if (hata) throw new OyunHatasi(403, hata, 'ALICI_UYGUN_DEGIL');
}

// ---------- §8.5 / §10.3 manipülasyon işaretleri ----------
function manipulasyonIsaretleri(saticiId, aliciId, p, fiyat) {
  const isaretler = [];
  const pencere = simdi() - PAZAR.washPencereGun * 86400000;
  const geriDonus = db.prepare(`SELECT 1 FROM trades WHERE parcel_id = ? AND seller_id = ? AND buyer_id = ? AND created_at >= ?`)
    .get(p.id, aliciId, saticiId, pencere);
  if (geriDonus) isaretler.push('GERI_DONUS');   // A→B→A
  const cift = db.prepare(`SELECT COUNT(*) AS c FROM trades WHERE created_at >= ? AND
    ((seller_id = ? AND buyer_id = ?) OR (seller_id = ? AND buyer_id = ?))`).get(pencere, saticiId, aliciId, aliciId, saticiId).c;
  if (cift + 1 >= PAZAR.washCiftEsigi) isaretler.push('TEKRARLI_CIFT');
  const bedel = oyun.birincilBedel(p);
  if (fiyat > bedel * PAZAR.sapmaUst || fiyat < bedel * PAZAR.sapmaAlt) isaretler.push('FIYAT_SAPMASI');
  return isaretler;
}

// ---------- Devir (her zaman bir işlemin içinde çağrılır) ----------
function devret(ilan, aliciId, fiyat, teklif) {
  const p = oyun.parselGetir(ilan.parcel_id);
  if (p.owner_user_id !== ilan.seller_id) throw new OyunHatasi(409, 'Satıcı artık bu parselin sahibi değil');
  if (p.status !== 'ACTIVE') throw new OyunHatasi(423, 'Parsel geçici olarak dondurulmuş');
  if (require('./kira').aktifKira(p.id)) throw new OyunHatasi(409, 'Parsel kirada; kira bitmeden devredilemez');
  aliciUygunMu(aliciId, ilan, p);
  require('./kira').devirdeKapat(p.id);

  // İlan kilidi: aynı ilan iki kez satılamaz
  const t = simdi();
  const r = db.prepare(`UPDATE listings SET status = 'SOLD', closed_at = ?, version = version + 1
                        WHERE id = ? AND status = 'ACTIVE' AND version = ?`).run(t, ilan.id, ilan.version);
  if (r.changes !== 1) throw new OyunHatasi(409, 'İlan az önce değişti; tekrar deneyin', 'ILAN_DEGISTI');

  const ucret = ucretHesapla(fiyat, ilan.seller_id);
  const tx = L.yeniTx();
  const kaynak = teklif ? emanet(teklif.id) : L.hesap(aliciId);
  if (teklif) {
    if (q.teklifDurum.run('ACCEPTED', t, teklif.id).changes !== 1) throw new OyunHatasi(409, 'Teklif artık geçerli değil');
  } else if (L.bakiye(aliciId) < fiyat) {
    throw new OyunHatasi(402, `Yetersiz bakiye: ${fiyat} akçe gerekli`, 'YETERSIZ_BAKIYE');
  }
  if (fiyat > ucret) L.aktar({ kaynak, hedef: L.hesap(ilan.seller_id), tutar: fiyat - ucret, sebep: `Parsel satışı ${p.id}`, tx });
  L.aktar({ kaynak, hedef: 'SYS:SINK', tutar: ucret, sebep: `İşlem masrafı ${p.id}`, tx });
  require('./belediye').belediyePayi(p.ilce_id, ucret, 'islemPayi', 'pazar işlem payı', tx);

  // Sahiplik devri: eski kaydı kapat, yenisini aç; parsel sürümü kilidiyle
  db.prepare(`UPDATE parcel_ownership SET end_at = datetime('now') WHERE parcel_id = ? AND end_at IS NULL`).run(p.id);
  db.prepare(`INSERT INTO parcel_ownership (parcel_id, user_id, reason, price) VALUES (?, ?, 'TRADE', ?)`).run(p.id, aliciId, fiyat);
  const pr = db.prepare(`UPDATE parcels SET owner_user_id = ?, acquired_at = datetime('now'), version = version + 1
                         WHERE id = ? AND owner_user_id = ? AND version = ?`).run(aliciId, p.id, ilan.seller_id, p.version);
  if (pr.changes !== 1) throw new OyunHatasi(409, 'Parsel az önce değişti; tekrar deneyin');
  db.prepare(`UPDATE structures SET owner_user_id = ? WHERE parcel_id = ?`).run(aliciId, p.id);
  db.prepare(`UPDATE crops SET user_id = ? WHERE parcel_id = ? AND status = 'GROWING'`).run(aliciId, p.id);

  const isaretler = manipulasyonIsaretleri(ilan.seller_id, aliciId, p, fiyat);
  const tradeId = db.prepare(`INSERT INTO trades (listing_id, parcel_id, seller_id, buyer_id, price, fee, via, asset_snapshot, flags, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(ilan.id, p.id, ilan.seller_id, aliciId, fiyat, ucret, teklif ? 'BID' : 'BUY_NOW',
      JSON.stringify(varlikOzeti(p)), JSON.stringify(isaretler), t).lastInsertRowid;

  teklifleriIadeEt(ilan, 'CANCELLED', 'parsel başka bir alıcıya devredildi', teklif?.id);

  const satici = q.kullanici.get(ilan.seller_id), alici = q.kullanici.get(aliciId);
  L.denetim({ anahtar: `PARCEL_TRADED:${ilan.id}`, aktor: aliciId, eylem: 'PARCEL_TRADED', varlik: p.id,
    once: { sahip: satici.display_name }, sonra: { fiyat, satici: satici.display_name, ilan: ilan.id, trade: tradeId },
    bolge: p.region_id, herkese: true });
  if (isaretler.length) {
    L.denetim({ anahtar: `TRADE_FLAGGED:${tradeId}`, eylem: 'TRADE_FLAGGED', varlik: `TRADE:${tradeId}`, sonra: { isaretler } });
  }
  bildir(ilan.seller_id, `${p.id} parselin ${alici.display_name} adlı oyuncuya ₳${fiyat} karşılığında devredildi (masraf ₳${ucret})`, `parsel:${p.id}`);
  bildir(aliciId, `${p.id} parseli artık sende (₳${fiyat})`, `parsel:${p.id}`);
  return { tamam: true, tradeId, fiyat, ucret, parsel: p.id, isaretler };
}

// ---------- İlan işlemleri (satıcı) ----------
const ilanAc = db.transaction((userId, parcelId, govde) => {
  const p = oyun.parselGetir(parcelId);
  oyun.sahibiOlmali(p, userId);
  const fiyat = tamSayi(govde?.fiyat, 'Fiyat', 1, PAZAR.maxFiyat);
  const gun = Number(govde?.gun ?? 3);
  if (!PAZAR.ilanSureleri.includes(gun)) throw new OyunHatasi(400, `İlan süresi ${PAZAR.ilanSureleri.join(', ')} gün olabilir`);
  const kosul = String(govde?.kosul || 'HERKES');
  if (!oyun.bul(PAZAR.aliciKosullari, kosul)) throw new OyunHatasi(400, 'Geçersiz alıcı koşulu');
  if (q.aktifIlanParsel.get(p.id)) throw new OyunHatasi(409, 'Bu parsel zaten ilanda');
  if (require('./kira').acikKira(p.id)) throw new OyunHatasi(409, 'Kirada ya da kira teklifindeki parsel satışa çıkarılamaz');
  const t = simdi();
  const id = db.prepare(`INSERT INTO listings (parcel_id, seller_id, asking_price, asset_snapshot, fee_rate, buyer_condition, created_at, expires_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(p.id, userId, fiyat, JSON.stringify(varlikOzeti(p)), PAZAR.ucretOrani, kosul, t, t + PAZAR.ilanSuresiMs(gun)).lastInsertRowid;
  L.denetim({ anahtar: `LISTING_CREATED:${id}`, aktor: userId, eylem: 'LISTING_CREATED', varlik: `LISTING:${id}`,
    sonra: { fiyat, gun, kosul, parsel: p.id }, bolge: p.region_id, herkese: true });
  return { tamam: true, ilanId: id, ucret: ucretHesapla(fiyat, userId), net: fiyat - ucretHesapla(fiyat, userId) };
});

const fiyatDegistir = db.transaction((userId, ilanId, govde) => {
  const i = aktifIlanGetir(ilanId);
  if (i.seller_id !== userId) throw new OyunHatasi(403, 'Bu ilan senin değil');
  const fiyat = tamSayi(govde?.fiyat, 'Fiyat', 1, PAZAR.maxFiyat);
  if (fiyat === i.asking_price) throw new OyunHatasi(409, 'Fiyat aynı');
  const r = db.prepare(`UPDATE listings SET asking_price = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'ACTIVE'`)
    .run(fiyat, i.id, i.version);
  if (r.changes !== 1) throw new OyunHatasi(409, 'İlan az önce değişti; tekrar deneyin');
  L.denetim({ aktor: userId, eylem: 'LISTING_PRICE_CHANGED', varlik: `LISTING:${i.id}`, once: { fiyat: i.asking_price }, sonra: { fiyat } });
  // İstenen fiyata eşit ya da üstündeki teklifler artık "hemen al" sayılmaz; satıcı yine de kabul edebilir
  return { tamam: true, fiyat };
});

const ilanIptal = db.transaction((userId, ilanId) => {
  const i = aktifIlanGetir(ilanId);
  if (i.seller_id !== userId) throw new OyunHatasi(403, 'Bu ilan senin değil');
  const r = db.prepare(`UPDATE listings SET status = 'CANCELLED', closed_at = ?, version = version + 1 WHERE id = ? AND version = ? AND status = 'ACTIVE'`)
    .run(simdi(), i.id, i.version);
  if (r.changes !== 1) throw new OyunHatasi(409, 'İlan az önce değişti; tekrar deneyin');
  teklifleriIadeEt(i, 'CANCELLED', 'satıcı ilanı kaldırdı');
  L.denetim({ aktor: userId, eylem: 'LISTING_CANCELLED', varlik: `LISTING:${i.id}` });
  return { tamam: true };
});

const teklifKabul = db.transaction((userId, teklifId) => {
  const b = q.teklif.get(kimlik(teklifId, 'teklif'));
  if (!b || b.status !== 'ACTIVE') throw new OyunHatasi(409, 'Teklif artık geçerli değil');
  const i = aktifIlanGetir(b.listing_id);
  if (i.seller_id !== userId) throw new OyunHatasi(403, 'Bu ilan senin değil');
  const p = oyun.parselGetir(i.parcel_id);
  const engel = aliciUygunlukHatasi(b.buyer_id, i, p);
  if (engel) {
    // Alıcı artık uygun değil: teklif reddedilir ve kilit çözülür; işlem yine de kaydedilir
    teklifIade(b, 'REJECTED', `alıcı uygun değil (${engel})`);
    bildir(b.buyer_id, `${i.parcel_id} için teklifin kabul edilemedi: ${engel}. Tutar iade edildi.`, `parsel:${i.parcel_id}`);
    return { tamam: false, mesaj: `Alıcı artık uygun değil: ${engel}. Teklif iade edildi.` };
  }
  return devret(i, b.buyer_id, b.amount, b);
});

const teklifRed = db.transaction((userId, teklifId) => {
  const b = q.teklif.get(kimlik(teklifId, 'teklif'));
  if (!b || b.status !== 'ACTIVE') throw new OyunHatasi(409, 'Teklif artık geçerli değil');
  const i = q.ilan.get(b.listing_id);
  if (i.seller_id !== userId) throw new OyunHatasi(403, 'Bu ilan senin değil');
  teklifIade(b, 'REJECTED', 'satıcı reddetti');
  L.denetim({ aktor: userId, eylem: 'BID_REJECTED', varlik: `LISTING:${i.id}`, sonra: { teklif: b.id, tutar: b.amount } });
  bildir(b.buyer_id, `${i.parcel_id} için ₳${b.amount} teklifin reddedildi; tutar iade edildi`, `parsel:${i.parcel_id}`);
  return { tamam: true };
});

// ---------- Alıcı işlemleri ----------
const teklifVer = db.transaction((userId, ilanId, govde) => {
  const i = aktifIlanGetir(ilanId);
  if (i.seller_id === userId) throw new OyunHatasi(409, 'Kendi ilanına teklif veremezsin');
  const p = oyun.parselGetir(i.parcel_id);
  aliciUygunMu(userId, i, p);
  const tutar = tamSayi(govde?.tutar, 'Teklif', 1, PAZAR.maxFiyat);
  if (tutar >= i.asking_price) throw new OyunHatasi(409, 'Teklif istenen fiyata eşit ya da yüksek; "Hemen al" kullan');
  const mevcut = q.benimAktifTeklifim.get(i.id, userId);
  if (mevcut && tutar <= mevcut.amount) throw new OyunHatasi(409, `Yeni teklif mevcut teklifinden (₳${mevcut.amount}) yüksek olmalı`);

  const tx = L.yeniTx();
  if (mevcut) teklifIade(mevcut, 'REPLACED', 'teklif yükseltildi', tx);
  const t = simdi();
  const id = db.prepare(`INSERT INTO bids (listing_id, buyer_id, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(i.id, userId, tutar, t, t).lastInsertRowid;
  L.aktar({ kaynak: L.hesap(userId), hedef: emanet(id), tutar, sebep: `Teklif kilidi (ilan #${i.id})`, tx });   // fon kilidi
  L.denetim({ aktor: userId, eylem: 'BID_PLACED', varlik: `LISTING:${i.id}`, sonra: { teklif: id, tutar } });

  const satici = q.kullanici.get(i.seller_id);
  if (satici.is_npc) {
    // Demo komşu: istenen fiyatın belirli oranı ve üstünü kabul eder, altını reddeder
    if (tutar >= Math.ceil(i.asking_price * PAZAR.npcKabulOrani)) {
      return { ...devret(q.ilan.get(i.id), userId, tutar, q.teklif.get(id)), npcKabul: true };
    }
    teklifIade(q.teklif.get(id), 'REJECTED', `${satici.display_name} bu fiyatı düşük buldu`);
    return { tamam: true, teklifId: id, npcRed: true, mesaj: `${satici.display_name} teklifini düşük buldu; tutar iade edildi` };
  }
  const alici = q.kullanici.get(userId);
  bildir(i.seller_id, `${i.parcel_id} ilanına ${alici.display_name} ₳${tutar} teklif verdi`, `parsel:${i.parcel_id}`);
  return { tamam: true, teklifId: id, tutar };
});

const teklifGeriCek = db.transaction((userId, ilanId) => {
  const i = q.ilan.get(kimlik(ilanId, 'ilan'));
  if (!i) throw new OyunHatasi(404, 'İlan bulunamadı');
  const b = q.benimAktifTeklifim.get(i.id, userId);
  if (!b) throw new OyunHatasi(409, 'Bu ilanda aktif teklifin yok');
  teklifIade(b, 'WITHDRAWN', 'teklif geri çekildi');
  L.denetim({ aktor: userId, eylem: 'BID_WITHDRAWN', varlik: `LISTING:${i.id}`, sonra: { teklif: b.id } });
  return { tamam: true, iade: b.amount };
});

const hemenAl = db.transaction((userId, ilanId, govde) => {
  const i = aktifIlanGetir(ilanId);
  if (i.seller_id === userId) throw new OyunHatasi(409, 'Kendi ilanını satın alamazsın');
  // İstemcinin gördüğü fiyat değiştiyse işlemi yapma (fiyat sürprizi yok)
  if (govde?.fiyat != null && Number(govde.fiyat) !== i.asking_price) {
    throw new OyunHatasi(409, `İstenen fiyat ₳${i.asking_price} olarak güncellendi; tekrar kontrol et`, 'FIYAT_DEGISTI');
  }
  const mevcut = q.benimAktifTeklifim.get(i.id, userId);
  if (mevcut) teklifIade(mevcut, 'REPLACED', 'hemen al ile değiştirildi');
  return devret(q.ilan.get(i.id), userId, i.asking_price, null);
});

// ---------- Okuma: ilan listesi, parsel ilan bilgisi, benim pazarım ----------
function ilanSatiri(i, userId) {
  const enYuksek = db.prepare(`SELECT MAX(amount) AS m, COUNT(*) AS c FROM bids WHERE listing_id = ? AND status = 'ACTIVE'`).get(i.id);
  return {
    id: i.id, parsel: i.parcel_id, mahalle: i.mahalle, ilce: i.ilce, il: i.il, alan: i.area_m2, imar: i.zoning_type,
    konum: { lon: i.centroid_lon, lat: i.centroid_lat },
    fiyat: i.asking_price, enYuksekTeklif: enYuksek.m, teklifSayisi: enYuksek.c,
    satici: { ad: i.satici, npc: !!i.is_npc, ben: i.seller_id === userId },
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

function ilanlar({ il, ilce, imar, sirala } = {}, userId) {
  pazarBakim();
  const kosullar = [`l.status = 'ACTIVE'`];
  const params = [];
  if (il) { kosullar.push('p.il_id = ?'); params.push(kimlik(il, 'il')); }
  if (ilce) { kosullar.push('p.ilce_id = ?'); params.push(kimlik(ilce, 'ilçe')); }
  if (imar) {
    if (!oyun.bul(IMAR, imar)) throw new OyunHatasi(400, 'Geçersiz imar türü');
    kosullar.push('p.zoning_type = ?'); params.push(imar);
  }
  const siralama = { ucuz: 'l.asking_price ASC', pahali: 'l.asking_price DESC', yeni: 'l.id DESC', bitis: 'l.expires_at ASC', m2: 'CAST(l.asking_price AS REAL) / p.area_m2 ASC' }[sirala] || 'l.id DESC';
  const satirlar = db.prepare(`${ILAN_SEC} WHERE ${kosullar.join(' AND ')} ORDER BY ${siralama} LIMIT 60`).all(...params);
  return satirlar.map((i) => ilanSatiri(i, userId));
}

// §8.5: referans fiyat yalnızca işaretsiz işlemlerden; az işlem varsa güvenilirlik uyarısı
function piyasaGostergeleri(p) {
  const pencere = simdi() - PAZAR.referansGun * 86400000;
  const sonIslem = db.prepare(`SELECT price, created_at FROM trades WHERE parcel_id = ? AND flags = '[]' ORDER BY id DESC LIMIT 1`).get(p.id);
  const mahalle = db.prepare(`SELECT t.price, pp.area_m2 FROM trades t JOIN parcels pp ON pp.id = t.parcel_id
                              WHERE pp.region_id = ? AND t.flags = '[]' AND t.created_at >= ?`).all(p.region_id, pencere);
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

function parselPazarBilgisi(parcelId, userId) {
  pazarBakim();
  const p = oyun.parselGetir(parcelId);
  const i = q.aktifIlanParsel.get(p.id);
  const piyasa = piyasaGostergeleri(p);
  if (!i) return { ilan: null, piyasa };

  const satici = q.kullanici.get(i.seller_id);
  const benimIlanim = i.seller_id === userId;
  const aktif = q.aktifTeklifler.all(i.id);
  const tumTeklifler = db.prepare(`SELECT b.*, u.display_name FROM bids b JOIN users u ON u.id = b.buyer_id WHERE b.listing_id = ? ORDER BY b.id`).all(i.id);
  // Teklif sahipleri yalnızca satıcıya ve kendilerine adıyla görünür; diğerlerine "Alıcı 1, 2…"
  const sira = new Map();
  for (const b of tumTeklifler) if (!sira.has(b.buyer_id)) sira.set(b.buyer_id, sira.size + 1);
  const teklifSahibi = (b) => (benimIlanim || b.buyer_id === userId ? b.display_name : `Alıcı ${sira.get(b.buyer_id)}`);
  const olaylar = db.prepare(`SELECT action, before_json, after_json, created_at FROM audit_events
                              WHERE entity = ? AND action IN ('LISTING_CREATED','LISTING_PRICE_CHANGED') ORDER BY id`).all(`LISTING:${i.id}`);
  const gecmis = [
    ...olaylar.map((o) => ({ tur: o.action, zaman: sqlZamani(o.created_at), once: JSON.parse(o.before_json || 'null'), sonra: JSON.parse(o.after_json || 'null') })),
    ...tumTeklifler.map((b) => ({ tur: 'TEKLIF', zaman: b.created_at, tutar: b.amount, durum: b.status, kim: teklifSahibi(b), ben: b.buyer_id === userId })),
  ].sort((a, b) => a.zaman - b.zaman);

  const benimTeklifim = userId ? q.benimAktifTeklifim.get(i.id, userId) : null;
  const engel = userId && !benimIlanim ? aliciUygunlukHatasi(userId, i, p) : null;
  const kosul = PAZAR.aliciKosullari[i.buyer_condition];
  return {
    ilan: {
      id: i.id, fiyat: i.asking_price, birim: i.listing_currency, olusturma: i.created_at, bitis: i.expires_at,
      satici: { ad: satici.display_name, npc: !!satici.is_npc, ben: benimIlanim },
      kosul: { kod: i.buyer_condition, ad: kosul.ad },
      ucretOrani: i.fee_rate, ucret: ucretHesapla(i.asking_price, i.seller_id), net: i.asking_price - ucretHesapla(i.asking_price, i.seller_id),
      ilanAniVarliklar: JSON.parse(i.asset_snapshot),
      guncelVarliklar: varlikOzeti(p),
      enYuksekTeklif: aktif[0]?.amount ?? null,
      teklifSayisi: aktif.length,
      teklifler: benimIlanim ? aktif.map((b) => ({ id: b.id, tutar: b.amount, kim: q.kullanici.get(b.buyer_id).display_name, zaman: b.created_at,
        ucret: ucretHesapla(b.amount, i.seller_id), net: b.amount - ucretHesapla(b.amount, i.seller_id) })) : null,
      benimTeklifim: benimTeklifim ? { id: benimTeklifim.id, tutar: benimTeklifim.amount } : null,
      aliciEngeli: engel,
      gecmis,
    },
    piyasa,
  };
}

function benimPazarim(userId) {
  pazarBakim();
  const ilanlarim = db.prepare(`${ILAN_SEC} WHERE l.seller_id = ? ORDER BY (l.status = 'ACTIVE') DESC, l.id DESC LIMIT 20`).all(userId)
    .map((i) => ({ ...ilanSatiri(i, userId), durum: i.status }));
  const tekliflerim = db.prepare(`
    SELECT b.id, b.amount, b.status, b.created_at, b.updated_at, l.id AS ilan, l.parcel_id, l.asking_price, l.status AS ilan_durum,
      r.name AS mahalle, ri.name AS ilce
    FROM bids b JOIN listings l ON l.id = b.listing_id JOIN parcels p ON p.id = l.parcel_id JOIN regions r ON r.id = p.region_id
      JOIN regions ri ON ri.id = p.ilce_id
    WHERE b.buyer_id = ? ORDER BY (b.status = 'ACTIVE') DESC, b.id DESC LIMIT 20`).all(userId);
  const islemlerim = db.prepare(`
    SELECT t.id, t.parcel_id, t.price, t.fee, t.via, t.created_at, t.seller_id, t.buyer_id, s.display_name AS satici, a.display_name AS alici
    FROM trades t JOIN users s ON s.id = t.seller_id JOIN users a ON a.id = t.buyer_id
    WHERE t.seller_id = ? OR t.buyer_id = ? ORDER BY t.id DESC LIMIT 20`).all(userId, userId)
    .map((t) => ({ ...t, yon: t.buyer_id === userId ? 'ALIS' : 'SATIS' }));
  return { ilanlarim, tekliflerim, islemlerim };
}

function sonIslemler() {
  return db.prepare(`
    SELECT t.id, t.parcel_id, t.price, t.via, t.flags, t.created_at, p.area_m2, p.zoning_type, r.name AS mahalle,
      ri.name AS ilce, rl.name AS il, s.display_name AS satici, a.display_name AS alici
    FROM trades t JOIN parcels p ON p.id = t.parcel_id JOIN regions r ON r.id = p.region_id
      JOIN regions ri ON ri.id = p.ilce_id JOIN regions rl ON rl.id = p.il_id
      JOIN users s ON s.id = t.seller_id JOIN users a ON a.id = t.buyer_id
    ORDER BY t.id DESC LIMIT 30`).all()
    .map((t) => ({ ...t, flags: undefined, incelemede: t.flags !== '[]', m2Fiyat: Math.round((t.price / t.area_m2) * 100) / 100 }));
}

function pazarOzeti(userId) {
  return {
    kilitli: db.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM bids WHERE buyer_id = ? AND status = 'ACTIVE'`).get(userId).s,
    gelenTeklif: db.prepare(`SELECT COUNT(*) AS c FROM bids b JOIN listings l ON l.id = b.listing_id
                             WHERE l.seller_id = ? AND l.status = 'ACTIVE' AND b.status = 'ACTIVE'`).get(userId).c,
    okunmamis: db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`).get(userId).c,
  };
}

function bildirimler(userId) {
  return db.prepare(`SELECT id, text, link, read_at IS NOT NULL AS okundu, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30`).all(userId);
}
function bildirimleriOku(userId) {
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`).run(userId);
  return { tamam: true };
}

module.exports = {
  pazarBakim, ilanAc, fiyatDegistir, ilanIptal, teklifVer, teklifGeriCek, teklifKabul, teklifRed, hemenAl,
  ilanlar, parselPazarBilgisi, benimPazarim, sonIslemler, pazarOzeti, bildirimler, bildirimleriOku,
  ucretHesapla, bildir,
};
