// Çiftlik oyunu katmanı: hayvancılık (yemle, topla), oyuncu seviyesi ve tecrübe puanı (TP), seviye ödülleri, günlük giriş ödülü,
// sipariş panosu (köylülerin istekleri) ve çiftlik süsleri. Kurallar config/rules.js'de. Bakiye yalnızca oyuncunun bir
// düğmeye basmasıyla değişir (ödül al, teslim et). (Mahalle köy yarışması v0.42'de kalktı: haftalık yarış hasat-yarisi.js.)
const db = require('./db');
const L = require('./lib/ledger');
const { yol } = require('./lib/olaylar');
const { URUNLER, YAPILAR, RECETELER, HAYVANLAR, YEM_FIYATI, SEVIYE, GUNLUK_ODUL, SIPARIS, SUSLER, SUS_MAKS, BAKIM } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const bul = (tablo, kod) => (typeof kod === 'string' && Object.hasOwn(tablo, kod) ? tablo[kod] : null);


// ---------- Seviye ve TP
// Seviye n için gereken toplam TP = katsayı × n × (n − 1) × max(1, n / dikleşme); seviye bu eşiklere göre sayılarak bulunur
const seviyeEsigi = (n) => Math.round(SEVIYE.katsayi * n * (n - 1) * Math.max(1, n / SEVIYE.dikles));
function seviyeHesap(tp) {
  let n = 1;
  while (n < SEVIYE.maks && seviyeEsigi(n + 1) <= tp) n++;
  return n;
}
async function oyuncuSeviyesi(userId) {
  const u = await db.get(`SELECT tp FROM users WHERE id = ?`, userId);
  return seviyeHesap(u?.tp || 0);
}
async function anaBolge(userId) {
  return (await db.get(`SELECT region_id FROM parcels WHERE owner_user_id = ? ORDER BY acquired_at LIMIT 1`, userId))?.region_id ?? null;
}
// TP artışı tek cümlede yapılır (RETURNING): eşzamanlı iki eylem seviye atlamasını iki kez bildirmez
async function tpEkle(userId, tp, eylem, bolge = null) {
  if (!userId || !(tp > 0)) return;
  return db.tx(async () => {
    tp = Math.round(tp * await require('./koy-meydani').oran(userId, 'OKUL') * require('./mini-etkinlik').tpKat());   // köy okulu, hafta sonu etkinliği
    await db.run(`INSERT INTO tp_kayitlari (user_id, tp, eylem, region_id, at) VALUES (?, ?, ?, ?, ?)`, userId, tp, eylem, bolge ?? await anaBolge(userId), simdi());
    const u = await db.get(`UPDATE users SET tp = tp + ? WHERE id = ? RETURNING tp`, tp, userId);
    if (!u) return;
    const sonra = seviyeHesap(u.tp);
    if (sonra > seviyeHesap(u.tp - tp)) {
      await require('./pazar').bildir(userId, `⭐ Seviye ${sonra} oldun! Seviye ödülün seni bekliyor.`, 'gorevler');   // bildir canlı kanala da iletir
    }
  });
}
const tpGunSayisi = db.sorgu(`SELECT COUNT(*) AS c FROM tp_kayitlari WHERE user_id = ? AND eylem = ? AND at >= ?`);
// Oyun eylemleri TP kazandırır (işlem kaydedildikten sonra, olay yolu üzerinden; yalnızca olayı doğuran sunucuda)
yol.on('eylem', async ({ eylem, aktor, bolge }) => {
  const tp = SEVIYE.tp[eylem];
  if (!tp || !aktor) return;
  // Günlük tavan: Türkiye saatiyle bugün başlayan kayıtlar
  const gunBasi = Date.parse(`${new Date(simdi() + 3 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`) - 3 * 3600_000;
  try {
    await db.tx(async () => {
      await db.kilit(`tp:${aktor}`);   // sayım ve yazım arasında aynı oyuncunun ikinci eylemi tavanı aşmasın
      if ((await tpGunSayisi.get(aktor, eylem, gunBasi)).c >= SEVIYE.gunlukEylemTavani) return;
      await tpEkle(aktor, tp, eylem, bolge);
    });
  } catch { /* kullanıcı silinmiş olabilir */ }
});
async function seviyeBilgisi(userId) {
  const u = await db.get(`SELECT tp, odul_seviye FROM users WHERE id = ?`, userId);
  const n = seviyeHesap(u.tp);
  const bekleyen = [];
  for (let s = Math.max(2, u.odul_seviye + 1); s <= n; s++) bekleyen.push(s);
  return {
    tp: u.tp, seviye: n, esik: seviyeEsigi(n), sonraki: n < SEVIYE.maks ? seviyeEsigi(n + 1) : null,
    odulBekleyen: bekleyen, odulTutari: bekleyen.reduce((a, s) => a + SEVIYE.seviyeOdulu(s), 0),
    acilanlar: acilanlar(n + 1),
  };
}
// Bir sonraki seviyede açılacak içerik (yapı, süs)
function acilanlar(n) {
  return [
    ...Object.entries(YAPILAR).filter(([, y]) => y.minSeviye === n).map(([kod, y]) => ({ kod, ad: y.ad, ikon: y.ikon })),
    ...Object.entries(SUSLER).filter(([, s]) => s.minSeviye === n).map(([kod, s]) => ({ kod, ad: s.ad, ikon: s.ikon })),
  ];
}
// Koşullu yazma: aynı ödül iki kez (çift tıklama, eşzamanlı istek) ödenmez
const seviyeOdulAl = (userId) => db.tx(async () => {
  const b = await seviyeBilgisi(userId);
  if (!b.odulBekleyen.length) throw new OyunHatasi(409, 'Alınacak seviye ödülü yok');
  const r = await db.run(`UPDATE users SET odul_seviye = ? WHERE id = ? AND odul_seviye < ?`, b.seviye, userId, b.seviye);
  if (r.changes !== 1) throw new OyunHatasi(409, 'Alınacak seviye ödülü yok');
  await L.odul(userId, b.odulTutari, `Seviye ödülü (${b.odulBekleyen.join(', ')})`);
  await L.denetim({ aktor: userId, eylem: 'LEVEL_REWARD_CLAIMED', sonra: { seviyeler: b.odulBekleyen, tutar: b.odulTutari } });
  return { tamam: true, tutar: b.odulTutari, seviye: b.seviye };
});
async function seviyeKontrol(userId, minSeviye, ad) {
  if (!minSeviye || minSeviye <= 1) return;
  const npc = (await db.get(`SELECT is_npc FROM users WHERE id = ?`, userId))?.is_npc;
  if (npc) return;
  if (await oyuncuSeviyesi(userId) < minSeviye) throw new OyunHatasi(403, `${ad} seviye ${require('./lib/turkce').sayiBulunma(minSeviye)} açılır`, 'SEVIYE');
}

// ---------- Günlük giriş ödülü (İstanbul tarihine göre)
const gunAnahtari = (t) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
async function gunlukDurum(userId, t = simdi()) {
  const u = await db.get(`SELECT gunluk_gun, gunluk_seri FROM users WHERE id = ?`, userId);
  const bugun = gunAnahtari(t), dun = gunAnahtari(t - 86400_000);
  const seri = u.gunluk_gun === dun ? u.gunluk_seri + 1 : u.gunluk_gun === bugun ? u.gunluk_seri : 1;
  return { alinabilir: u.gunluk_gun !== bugun, seri, akce: GUNLUK_ODUL.akce[Math.min(seri, GUNLUK_ODUL.akce.length) - 1], tp: GUNLUK_ODUL.tp, tablo: GUNLUK_ODUL.akce };
}
const gunlukAl = (userId) => db.tx(async () => {
  const d = await gunlukDurum(userId);
  if (!d.alinabilir) throw new OyunHatasi(409, 'Bugünün ödülünü aldın; yarın yine gel');
  // Koşullu yazma: eşzamanlı ikinci istek ödülü ikinci kez almaz
  const bugun = gunAnahtari(simdi());
  const r = await db.run(`UPDATE users SET gunluk_gun = ?, gunluk_seri = ? WHERE id = ? AND (gunluk_gun IS NULL OR gunluk_gun <> ?)`, bugun, d.seri, userId, bugun);
  if (r.changes !== 1) throw new OyunHatasi(409, 'Bugünün ödülünü aldın; yarın yine gel');
  await L.odul(userId, d.akce, `Günlük ödül (${d.seri}. gün)`);
  await L.denetim({ aktor: userId, eylem: 'DAILY_REWARD_CLAIMED', sonra: { seri: d.seri, akce: d.akce } });
  await tpEkle(userId, d.tp, 'DAILY_REWARD_CLAIMED');
  return { tamam: true, akce: d.akce, seri: d.seri, tp: d.tp };
});

// ---------- Hayvancılık
const bakimSatiri = (sid) => db.get(`SELECT * FROM hayvan_bakim WHERE structure_id = ?`, sid);
// Yükseltilmiş barınak (gelisim.js) her seviyede yarım kat fazla ürün verir
const seviyeliMiktar = (h, s) => h.miktar + Math.ceil(h.miktar / 2) * ((s.seviye || 1) - 1);
async function hayvanDurumu(s, t = simdi()) {
  const h = HAYVANLAR[s.type];
  if (!h || s.status !== 'ACTIVE') return null;
  const b = await bakimSatiri(s.id);
  const beslendi = b?.durum === 'BESLENDI';
  return {
    hayvan: h.hayvan, ikon: h.ikon, sayi: h.sayi + ((s.seviye || 1) - 1), urun: h.urun, urunAd: URUNLER[h.urun].ad, urunIkon: URUNLER[h.urun].ikon, miktar: seviyeliMiktar(h, s), yem: h.yem,
    asiBitis: s.asi_bitis && s.asi_bitis > t ? s.asi_bitis : null,
    durum: !beslendi ? 'AC' : t >= b.hazir_at ? 'HAZIR' : 'BESLENDI', hazir: beslendi ? b.hazir_at : null, kalanMs: beslendi ? Math.max(0, b.hazir_at - t) : 0,
  };
}
async function barinakGetir(userId, structureId) {
  const oyun = require('./oyun');
  const s = await db.get(`SELECT * FROM structures WHERE id = ?`, Number(structureId));
  if (!s || !HAYVANLAR[s.type]) throw new OyunHatasi(404, 'Barınak bulunamadı');
  const p = await oyun.parselGetir(s.parcel_id);
  oyun.sahibiOlmali(p, userId);
  if (s.status !== 'ACTIVE') throw new OyunHatasi(409, 'Barınak henüz yapımda');
  if (oyun.saglik(s) < BAKIM.etkisizEsik) throw new OyunHatasi(409, 'Barınak bakımsız; önce bakım yap');
  return { s, p, h: HAYVANLAR[s.type] };
}
const besle = (userId, structureId) => db.tx(async () => {
  const { s, p, h } = await barinakGetir(userId, structureId);
  const b = await bakimSatiri(s.id);
  if (b?.durum === 'BESLENDI') throw new OyunHatasi(409, simdi() >= b.hazir_at ? 'Önce ürünleri topla' : 'Hayvanlar tok; ürün hazırlanıyor');
  const t = simdi();
  // Koşullu yazma: eşzamanlı ikinci yemleme hiçbir satırı değiştirmez ve geri alınır
  const r = await db.run(`INSERT INTO hayvan_bakim (structure_id, user_id, durum, beslendi_at, hazir_at) VALUES (?, ?, 'BESLENDI', ?, ?)
              ON CONFLICT(structure_id) DO UPDATE SET user_id = excluded.user_id, durum = 'BESLENDI', beslendi_at = excluded.beslendi_at, hazir_at = excluded.hazir_at
              WHERE hayvan_bakim.durum <> 'BESLENDI'`, s.id, userId, t, t + h.sureMs);
  if (r.changes !== 1) throw new OyunHatasi(409, 'Hayvanlar tok; ürün hazırlanıyor');
  const tx = L.yeniTx();
  const eldeki = Math.min(h.yem, await L.envanterMiktar(userId, 'YEM'));
  if (eldeki > 0) await L.envanterDegis(userId, 'YEM', -eldeki, `Yem: ${YAPILAR[s.type].ad}`, tx);
  const alinan = h.yem - eldeki;
  if (alinan > 0) await L.harca(userId, L.yuvarla(alinan * YEM_FIYATI), `Yem satın alındı (${alinan})`, tx);
  await L.denetim({ aktor: userId, eylem: 'ANIMALS_FED', varlik: p.id, sonra: { yapi: s.type, yem: h.yem, satinAlinan: alinan }, bolge: p.region_id });
  return { tamam: true, hazir: t + h.sureMs, yemEnvanter: eldeki, yemSatin: alinan, odenen: L.yuvarla(alinan * YEM_FIYATI) };
});
const topla = (userId, structureId) => db.tx(async () => {
  const { s, p, h } = await barinakGetir(userId, structureId);
  const b = await bakimSatiri(s.id);
  if (b?.durum !== 'BESLENDI') throw new OyunHatasi(409, 'Önce hayvanları yemle');
  const t = simdi();
  if (t < b.hazir_at) throw new OyunHatasi(409, 'Ürün henüz hazır değil');
  // Koşullu yazma: ürün yalnızca bir kez toplanır
  const r = await db.run(`UPDATE hayvan_bakim SET durum = 'AC', hazir_at = NULL WHERE structure_id = ? AND durum = 'BESLENDI' AND hazir_at <= ?`, s.id, t);
  if (r.changes !== 1) throw new OyunHatasi(409, 'Önce hayvanları yemle');
  // Zirai bayiden aşı yapılmış barınak her toplamada fazladan ürün verir
  const miktar = seviyeliMiktar(h, s) + (s.asi_bitis && s.asi_bitis > simdi() ? require('./config/rules').CARSI.etki.asiEk : 0);
  await L.envanterDegis(userId, h.urun, miktar, `${h.hayvan} ürünü: ${URUNLER[h.urun].ad}`);
  await L.denetim({ aktor: userId, eylem: 'ANIMAL_PRODUCE_COLLECTED', varlik: p.id, sonra: { urun: h.urun, miktar }, bolge: p.region_id });
  return { tamam: true, urun: h.urun, miktar, asili: miktar > seviyeliMiktar(h, s) };
});
// Harita için: parselde toplanmayı bekleyen hayvan ürünü var mı
async function parselHayvanHazir(parcelId, t = simdi()) {
  return !!await db.get(`SELECT 1 FROM hayvan_bakim b JOIN structures s ON s.id = b.structure_id
                       WHERE s.parcel_id = ? AND b.durum = 'BESLENDI' AND b.hazir_at <= ? LIMIT 1`, parcelId, t);
}

// ---------- Sipariş panosu
async function urunHavuzu(userId) {
  const havuz = new Set(['BUGDAY', 'DOMATES', 'ELMA']);
  const parseller = await db.all(`SELECT p.id, r.code FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ?`, userId);
  const plakalar = new Set(parseller.map((p) => p.code.slice(3)));
  for (const [kod, u] of Object.entries(URUNLER)) if (!u.mamul && u.bolgeler?.some((b) => plakalar.has(b))) havuz.add(kod);
  const yapilar = new Set((await db.all(`SELECT DISTINCT s.type FROM structures s JOIN parcels p ON p.id = s.parcel_id
                                      WHERE p.owner_user_id = ? AND s.status = 'ACTIVE'`, userId)).map((r) => r.type));
  for (const [tip, h] of Object.entries(HAYVANLAR)) if (yapilar.has(tip)) havuz.add(h.urun);
  for (const [kod, r] of Object.entries(RECETELER)) if ([].concat(r.tesis).some((x) => yapilar.has(x)) && kod !== 'YEM') havuz.add(kod);
  return [...havuz];
}
async function siparisUret(userId, t) {
  const sv = await oyuncuSeviyesi(userId);
  const havuz = await urunHavuzu(userId);
  const n = Math.min(havuz.length, SIPARIS.kalemMin + Math.floor(Math.random() * (SIPARIS.kalemMaks - SIPARIS.kalemMin + 1)));
  const secilen = havuz.sort(() => Math.random() - 0.5).slice(0, n);
  const kalemler = {};
  let deger = 0, adetToplam = 0;
  for (const kod of secilen) {
    const u = URUNLER[kod];
    const taban = u.hayvansal ? 3 : u.mamul ? 1 : 6;
    const adet = taban + Math.floor(Math.random() * (taban * (1 + Math.min(sv, SIPARIS.seviyeTavan) * SIPARIS.seviyeKat)));
    kalemler[kod] = adet;
    deger += u.tabanFiyat * adet;
    adetToplam += adet;
  }
  const odul = Math.max(5, Math.round(deger * SIPARIS.primOrani));   // sipariş ödülü tam akçe
  const tp = Math.round(5 + adetToplam * SIPARIS.tpCarpani * 0.5);
  const musteri = SIPARIS.musteriler[Math.floor(Math.random() * SIPARIS.musteriler.length)];
  await db.run(`INSERT INTO siparisler (user_id, musteri, kalemler, odul, tp, olusturma, son) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userId, musteri, JSON.stringify(kalemler), odul, tp, t, t + SIPARIS.sureMs);
}
// Pano yenileme oyuncu başına kilitlenir: aynı anda açılan iki sayfa fazladan sipariş üretmez
const siparisBakim = (userId, t = simdi()) => db.tx(async () => {
  await db.kilit(`siparis:${userId}`);
  await db.run(`UPDATE siparisler SET durum = 'SURESI_DOLDU', bitis = son WHERE user_id = ? AND durum = 'ACIK' AND son <= ?`, userId, t);
  const u = await db.get(`SELECT siparis_sonraki FROM users WHERE id = ?`, userId);
  let acik = (await db.get(`SELECT COUNT(*) c FROM siparisler WHERE user_id = ? AND durum = 'ACIK'`, userId)).c;
  const maks = SIPARIS.acikMaks + await require('./koy-meydani').ek(userId, 'PTT');   // postane +1 müşteri
  if (u.siparis_sonraki == null) {
    // İlk ziyaret: pano dolu başlar
    for (; acik < maks - 1; acik++) await siparisUret(userId, t);
    await db.run(`UPDATE users SET siparis_sonraki = ? WHERE id = ?`, t + SIPARIS.yenilemeMs, userId);
    return;
  }
  let sonraki = u.siparis_sonraki;
  while (acik < maks && sonraki <= t) { await siparisUret(userId, sonraki); acik++; sonraki += SIPARIS.yenilemeMs; }
  if (acik >= maks && sonraki <= t) sonraki = t + SIPARIS.yenilemeMs;
  if (sonraki !== u.siparis_sonraki) await db.run(`UPDATE users SET siparis_sonraki = ? WHERE id = ?`, sonraki, userId);
});
async function siparisler(userId) {
  const t = simdi();
  await siparisBakim(userId, t);
  const envanter = Object.fromEntries((await L.envanter(userId)).map((i) => [i.item_id, i.miktar]));
  const liste = (await db.all(`SELECT * FROM siparisler WHERE user_id = ? AND durum = 'ACIK' ORDER BY id`, userId)).map((s) => {
    const kalemler = Object.entries(JSON.parse(s.kalemler)).map(([kod, adet]) => ({ kod, ad: URUNLER[kod]?.ad || kod, ikon: URUNLER[kod]?.ikon || '📦', adet, eldeki: envanter[kod] || 0 }));
    return { id: s.id, musteri: s.musteri, kalemler, odul: s.odul, tp: s.tp, son: s.son, kalanMs: s.son - t, hazir: kalemler.every((k) => k.eldeki >= k.adet) };
  });
  const u = await db.get(`SELECT siparis_sonraki FROM users WHERE id = ?`, userId);
  const maks = SIPARIS.acikMaks + await require('./koy-meydani').ek(userId, 'PTT');
  return { liste, sonrakiMs: liste.length < maks ? Math.max(0, (u.siparis_sonraki || t) - t) : null, maks };
}
// Çiftlik alt çubuğu için: açık ve teslime hazır sipariş sayısı
async function siparisOzeti(userId) {
  const l = (await siparisler(userId)).liste;
  return { acik: l.length, hazir: l.filter((s) => s.hazir).length };
}
const siparisTeslim = (userId, siparisId) => db.tx(async () => {
  await require('./ekonomi').envanterBozulmasi(userId);
  const s = await db.get(`SELECT * FROM siparisler WHERE id = ? AND user_id = ?`, Number(siparisId), userId);
  if (!s) throw new OyunHatasi(404, 'Sipariş bulunamadı');
  const t = simdi();
  if (s.durum !== 'ACIK' || s.son <= t) throw new OyunHatasi(409, 'Sipariş artık açık değil');
  // Koşullu yazma: sipariş yalnızca bir kez teslim edilir
  const r = await db.run(`UPDATE siparisler SET durum = 'TESLIM', bitis = ? WHERE id = ? AND durum = 'ACIK' AND son > ?`, t, s.id, t);
  if (r.changes !== 1) throw new OyunHatasi(409, 'Sipariş artık açık değil');
  const tx = L.yeniTx();
  for (const [kod, adet] of Object.entries(JSON.parse(s.kalemler))) await L.envanterDegis(userId, kod, -adet, `Sipariş teslimi: ${s.musteri}`, tx);
  const odul = Math.round(s.odul * await require('./koy-meydani').oran(userId, 'KAHVEHANE'));   // kahvehane
  await L.odul(userId, odul, `Sipariş ödemesi: ${s.musteri}`, tx);
  await L.denetim({ aktor: userId, eylem: 'ORDER_DELIVERED', varlik: String(s.id), sonra: { musteri: s.musteri, odul } });
  await tpEkle(userId, s.tp, 'ORDER_DELIVERED');
  return { tamam: true, odul, tp: s.tp, musteri: s.musteri };
});
const siparisReddet = (userId, siparisId) => db.tx(async () => {
  // Koşullu yazma: aynı sipariş iki kez reddedilmez
  const r = await db.run(`UPDATE siparisler SET durum = 'REDDEDILDI', bitis = ? WHERE id = ? AND user_id = ? AND durum = 'ACIK'`, simdi(), Number(siparisId), userId);
  if (r.changes !== 1) throw new OyunHatasi(404, 'Açık sipariş bulunamadı');
  // Yerine yenisi biraz sonra gelir
  await db.run(`UPDATE users SET siparis_sonraki = GREATEST(COALESCE(siparis_sonraki, 0), ?) WHERE id = ?`, simdi() + SIPARIS.reddetBeklemeMs, userId);
  return { tamam: true };
});


// ---------- Çiftlik süsleri
async function parselSusleri(parcelId) {
  return (await db.all(`SELECT id, tur, yuva FROM parsel_susleri WHERE parcel_id = ? ORDER BY yuva`, parcelId))
    .map((s) => ({ ...s, ad: SUSLER[s.tur]?.ad, ikon: SUSLER[s.tur]?.ikon }));
}
const susKodu = async (parcelId) => (await parselSusleri(parcelId)).map((s) => `${s.tur}:${s.yuva}`).join(',');
const susEkle = (userId, parcelId, tur) => db.tx(async () => {
  const oyun = require('./oyun');
  const p = await oyun.parselGetir(parcelId);
  oyun.sahibiOlmali(p, userId);
  const s = bul(SUSLER, tur);
  if (!s) throw new OyunHatasi(400, 'Geçersiz süs');
  await seviyeKontrol(userId, s.minSeviye, s.ad);
  if (s.etkinlik && !require('./etkinlik').etkinlikAktifMi(s.etkinlik)) throw new OyunHatasi(409, `${s.ad} yalnızca etkinlik süresince alınabilir`);
  // Yuva seçimi parsel başına sıralanır (iki istek aynı boş yuvayı seçmesin)
  await db.kilit(`susler:${p.id}`);
  const dolu = new Set((await db.all(`SELECT yuva FROM parsel_susleri WHERE parcel_id = ?`, p.id)).map((r) => r.yuva));
  if (dolu.size >= SUS_MAKS) throw new OyunHatasi(409, `Bir parselde en çok ${SUS_MAKS} süs olabilir`);
  let yuva = 0;
  while (dolu.has(yuva)) yuva++;
  await L.harca(userId, s.fiyat, `Süs: ${s.ad}`);
  const id = (await db.run(`INSERT INTO parsel_susleri (parcel_id, user_id, tur, yuva, at) VALUES (?, ?, ?, ?, ?)`, p.id, userId, tur, yuva, simdi())).lastInsertRowid;
  await L.denetim({ aktor: userId, eylem: 'DECORATION_PLACED', varlik: p.id, sonra: { tur, yuva }, bolge: p.region_id });
  return { tamam: true, id, yuva };
});
const susKaldir = (userId, susId) => db.tx(async () => {
  const oyun = require('./oyun');
  const s = await db.get(`SELECT * FROM parsel_susleri WHERE id = ?`, Number(susId));
  if (!s) throw new OyunHatasi(404, 'Süs bulunamadı');
  oyun.sahibiOlmali(await oyun.parselGetir(s.parcel_id), userId);
  const r = await db.run(`DELETE FROM parsel_susleri WHERE id = ?`, s.id);
  if (r.changes !== 1) throw new OyunHatasi(404, 'Süs bulunamadı');
  return { tamam: true };
});
const susSecenekleri = async (userId) => {
  const sv = await oyuncuSeviyesi(userId);
  const etkinlik = require('./etkinlik').aktifEtkinlik()?.kod;
  // Etkinlik süsleri yalnızca kendi etkinliği sürerken listelenir
  return Object.entries(SUSLER).filter(([, s]) => !s.etkinlik || s.etkinlik === etkinlik)
    .map(([kod, s]) => ({ kod, ad: s.ad, ikon: s.ikon, fiyat: s.fiyat, minSeviye: s.minSeviye, acik: sv >= s.minSeviye, etkinlik: !!s.etkinlik }));
};

// Görevler sekmesi için tek özet
async function ozet(userId) {
  return { seviye: await seviyeBilgisi(userId), gunluk: await gunlukDurum(userId), siparisler: await siparisler(userId), yaris: await require('./hasat-yarisi').ozet(userId) };
}

module.exports = {
  seviyeHesap, seviyeEsigi, oyuncuSeviyesi, seviyeBilgisi, seviyeOdulAl, seviyeKontrol, tpEkle,
  gunlukDurum, gunlukAl,
  hayvanDurumu, seviyeliMiktar, besle, topla, parselHayvanHazir,
  siparisler, siparisOzeti, siparisTeslim, siparisReddet,
  parselSusleri, susKodu, susEkle, susKaldir, susSecenekleri,
  ozet,
};

// Seviye kilidi: oyuncunun seviyesi bölümün açılış seviyesinin altındaysa 403 (SEVIYE_KILIDI, config/rules.js)
module.exports.seviyeKilidi = async (userId, bolum) => {
  const k = require('./config/rules').SEVIYE_KILIDI[bolum];
  if (k && await module.exports.oyuncuSeviyesi(userId) < k.seviye) {
    throw new OyunHatasi(403, `${k.ad} ${k.seviye}. seviyede açılır`, 'SEVIYE');
  }
};
