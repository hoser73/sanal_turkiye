// Oyun içi piyasa: parsel değeri, bölge endeksi, fiyat geçmişi ve portföy kâr/zarar. Akçe nakde çevrilmez; bunlar
// oyun göstergeleridir, gerçek bir yatırım değerlemesi değildir.
//  • Arsa değeri = birincil tahsis bedeli × mahalle çarpanı. Çarpan üç sinyalden çıkar: talep (mahallede sahipli
//    parsel ve son 30 günde edinilenler), gelişme (mahalledeki yapı yatırımının arsa bedeline oranı) ve gerçek satışlar
//    (son 30 günde işaretsiz satışların fiyatı / satış anındaki tahmini değer; yalnızca en az 3 farklı satıcı ve
//    3 farklı alıcı varsa devreye girer: birkaç hesabın kendi arasındaki işlemleri endeksi oynatamaz).
//  • Endeks = 100 × çarpan (100 = tahsis bedeli seviyesi). Her gün bölge başına bir kare saklanır (deger_endeksi);
//    ilçe, il ve Türkiye endeksi mahallelerin arsa bedeliyle ağırlıklı ortalamasıdır. İlk kurulumda geçmiş günler
//    sahiplik, yapı ve satış kayıtlarından yeniden hesaplanır (uydurma veri yok).
//  • Portföy: her parselin alış bedeli (sahiplik kaydı) + o sahiplik boyunca yapılan yatırım (inşaat, yükseltme,
//    süs) = maliyet; bugünkü tahmini değer + toplanan kira − maliyet = getiri. Satılan parseller gerçekleşmiş kâr.
const db = require('./db');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { PIYASA: P, PAZAR, YAPILAR, SUSLER } = require('./config/rules');

const GUN = 86_400_000;
const TR_SAAT = 3 * 3600_000;
const oyun = () => require('./oyun');
const sqlZamani = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);   // datetime('now') biçimi (UTC)
const sqlMs = (s) => new Date(s.replace(' ', 'T') + 'Z').getTime();
const gunAnahtari = (t) => new Date(t + TR_SAAT).toISOString().slice(0, 10);
const gunSonu = (gun) => Date.parse(`${gun}T23:59:59.999Z`) - TR_SAAT;
const sinirla = (v, a, b) => Math.min(b, Math.max(a, v));
const yuvarla = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

// Yapının yatırım değeri: yapım maliyeti + yükseltme bedelleri (aşınma oyun.tahminiDeger'de uygulanır)
function yapiYatirimi(tip, seviye = 1) {
  const y = YAPILAR[tip];
  if (!y) return 0;
  let v = y.maliyet;
  for (let sv = 2; sv <= seviye; sv++) v += Math.round(y.maliyet * sv * 1.5);
  return v;
}

// Hazine: oyunun kendi alıcısı (demo sakin değildir; npc_kisilik yok). İlk Hazine satışında oluşturulur.
let hazineOnbellek = null;
const hazineAyari = async () => (await db.get(`SELECT deger FROM ayarlar WHERE anahtar = 'hazine_kullanici'`))?.deger;
async function hazineId(olustur = true) {
  if (hazineOnbellek) return hazineOnbellek;
  const a = await hazineAyari();
  if (a != null) return (hazineOnbellek = Number(a));
  if (!olustur) return null;
  // Eşzamanlı açılışlar (çok sunucu) tek Hazine hesabı oluştursun: kilitten sonra yeniden okunur
  return db.tx(async () => {
    await db.kilit('hazine-olustur');
    const b = await hazineAyari();
    if (b != null) return (hazineOnbellek = Number(b));
    const id = (await db.run('INSERT INTO users (display_name, is_npc) VALUES (?, 1)', P.hazine.ad)).lastInsertRowid;
    await db.run(`INSERT INTO ayarlar (anahtar, deger) VALUES ('hazine_kullanici', ?)`, String(id));
    return (hazineOnbellek = Number(id));
  });
}

// ---------- Bölge sinyalleri (t anına göre; regionId verilmezse sahipli parseli olan bütün mahalleler)
// haric: bu oyuncunun parselleri, yapıları ve işlemleri sayılmaz (Hazine teklifi). Hazine'nin elindeki parseller talep
// sayılmaz (arsası ve yapısı gelişme oranında kalır).
async function bolgeSinyalleri(t, regionId = null, { haric = null } = {}) {
  const f = regionId == null ? '' : ' AND p.region_id = ?';
  const arg = regionId == null ? [] : [regionId];
  const hazine = await hazineId(false);
  const ts = sqlZamani(t), pencereBasi = sqlZamani(t - P.pencereGun * GUN);
  const harita = new Map();
  // Arsa toplamı mahallenin bütün sahipli arsalarıdır (satıcınınki dahil: küçük bir arsaya yığılan yapılar oranı
  // şişiremesin). Talep yalnızca e-postası doğrulanmış oyuncular ve demo sakinlerden; Hazine ve satıcı sayılmaz.
  for (const x of await db.all(`SELECT p.region_id, p.ilce_id, p.il_id, p.area_m2, p.zoning_type, r.attractiveness, o.start_at, o.reason, o.user_id,
        CASE WHEN u.is_npc = 1 OR u.email_dogrulandi_at IS NOT NULL THEN 1 ELSE 0 END AS gecerli
      FROM parcel_ownership o JOIN parcels p ON p.id = o.parcel_id JOIN regions r ON r.id = p.region_id JOIN users u ON u.id = o.user_id
      WHERE o.start_at <= ? AND (o.end_at IS NULL OR o.end_at > ?)${f}`, ts, ts, ...arg)) {
    let b = harita.get(x.region_id);
    if (!b) harita.set(x.region_id, b = { ilce: x.ilce_id, il: x.il_id, sahipli: 0, yeni: 0, arsa: 0, yapi: 0, islemler: [] });
    b.arsa += oyun().birincilBedel(x);
    if (x.user_id === haric || x.user_id === hazine || !x.gecerli) continue;
    b.sahipli++;
    if (x.start_at > pencereBasi && x.reason !== 'SEED_NPC') b.yeni++;
  }
  // Yalnızca t anında bitmiş yapılar; seviye yükseltmeleri dahil
  for (const s of await db.all(`SELECT s.type, s.seviye, s.owner_user_id, p.region_id FROM structures s JOIN parcels p ON p.id = s.parcel_id
      WHERE s.status = 'ACTIVE' AND COALESCE(s.completed_at, s.completes_at) <= ?${f}`, t, ...arg)) {
    const b = s.owner_user_id === haric ? null : harita.get(s.region_id);
    if (b) b.yapi += yapiYatirimi(s.type, s.seviye || 1);
  }
  // İşlemler: işaretsiz ve değerinin 0,5–2 katı arasında gerçekleşenler (uç fiyatlı yıkama işlemleri endeksi oynatamaz)
  for (const x of await db.all(`SELECT t.price, t.deger_ani, t.carpan_ani, t.seller_id, t.buyer_id, p.region_id FROM trades t JOIN parcels p ON p.id = t.parcel_id
      WHERE t.flags = '[]' AND t.deger_ani > 0 AND t.price BETWEEN t.deger_ani * 0.5 AND t.deger_ani * 2
        AND t.created_at > ? AND t.created_at <= ?${f}`, t - P.pencereGun * GUN, t, ...arg)) {
    if (haric != null && (x.seller_id === haric || x.buyer_id === haric)) continue;
    harita.get(x.region_id)?.islemler.push(x);
  }
  return harita;
}

function carpanHesapla(b) {
  if (!b) return { carpan: 1, talep: 0, gelisim: 0, islemCarpani: null, islemSayisi: 0, sahipli: 0 };
  const talep = Math.min(P.talepUst, b.sahipli * P.talepParsel + b.yeni * P.talepYeni);
  const gelisim = b.arsa > 0 ? Math.min(P.gelisimUst, (b.yapi / b.arsa) * P.gelisimKat) : 0;
  const model = 1 + talep + gelisim;
  let carpan = model, islemCarpani = null;
  const farkli = (k) => new Set(b.islemler.map((x) => x[k])).size;
  if (farkli('seller_id') >= PAZAR.guvenilirlikEsigi && farkli('buyer_id') >= PAZAR.guvenilirlikEsigi) {
    // Satış, o anki değerin kaç katına olduysa arsa çarpanı da o yöne çekilir (medyan: tek uç işlem endeksi oynatamaz)
    const oranlar = b.islemler.map((x) => (x.carpan_ani || 1) * (x.price / x.deger_ani)).sort((a, c) => a - c);
    islemCarpani = oranlar[Math.floor((oranlar.length - 1) / 2)];
    carpan = model * (1 - P.islemAgirlik) + islemCarpani * P.islemAgirlik;
  }
  return { carpan: yuvarla(sinirla(carpan, P.min, P.maks)), talep: yuvarla(talep), gelisim: yuvarla(gelisim),
    islemCarpani: islemCarpani == null ? null : yuvarla(islemCarpani), islemSayisi: b.islemler.length, sahipli: b.sahipli };
}

// Kısa önbellek: kart ve harita aynı mahalleyi art arda sorar (testlerde kapalı)
const ONBELLEK = process.env.ONBELLEK !== 'kapali';
const carpanOnbellek = new Map();
async function mahalleCarpani(regionId, t = Date.now()) {
  const o = ONBELLEK && carpanOnbellek.get(regionId);
  if (o && Math.abs(t - o.t) < 60_000) return o.v;
  const v = carpanHesapla((await bolgeSinyalleri(t, regionId)).get(regionId));
  if (ONBELLEK) { if (carpanOnbellek.size > 5000) carpanOnbellek.clear(); carpanOnbellek.set(regionId, { t, v }); }
  return v;
}

// ---------- Endeks kareleri
const kareYaz = db.sorgu(`INSERT INTO deger_endeksi (tur, bolge_id, gun, endeks, parsel, islem, hacim) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (tur, bolge_id, gun) DO UPDATE SET endeks = excluded.endeks, parsel = excluded.parsel, islem = excluded.islem, hacim = excluded.hacim`);

async function endeksKaydet(t) {
  const gun = gunAnahtari(t);
  const gunBasi = gunSonu(gun) - GUN + 1;
  const gunlukIslem = new Map();
  for (const x of await db.all(`SELECT p.region_id, COUNT(*) AS c, SUM(t.price) AS s FROM trades t JOIN parcels p ON p.id = t.parcel_id
      WHERE t.created_at >= ? AND t.created_at <= ? GROUP BY p.region_id`, gunBasi, t)) gunlukIslem.set(x.region_id, x);
  const toplamlar = new Map();   // "ILCE:5" → { ag, arsa, parsel, islem, hacim }
  const ekle = (k, c, b, is) => {
    let a = toplamlar.get(k);
    if (!a) toplamlar.set(k, a = { ag: 0, arsa: 0, parsel: 0, islem: 0, hacim: 0 });
    a.ag += c.carpan * b.arsa; a.arsa += b.arsa; a.parsel += b.sahipli; a.islem += is?.c || 0; a.hacim += is?.s || 0;
  };
  const sinyaller = await bolgeSinyalleri(t);   // okuma işlem dışında; yazma tek işlemde
  await db.tx(async () => {
    for (const [r, b] of sinyaller) {
      const c = carpanHesapla(b), is = gunlukIslem.get(r);
      await kareYaz.run('MAHALLE', r, gun, yuvarla(100 * c.carpan, 2), b.sahipli, is?.c || 0, is?.s || 0);
      ekle(`ILCE:${b.ilce}`, c, b, is); ekle(`IL:${b.il}`, c, b, is); ekle('TR:0', c, b, is);
    }
    for (const [k, a] of toplamlar) {
      const [tur, id] = k.split(':');
      await kareYaz.run(tur, Number(id), gun, yuvarla(a.arsa > 0 ? (100 * a.ag) / a.arsa : 100, 2), a.parsel, a.islem, a.hacim);
    }
  });
}

// Bakım: bugünün karesi en sık kayitAraligiMs'de bir tazelenir; hiç kare yoksa geçmiş günler kayıtlardan doldurulur
let sonKayit = 0;
async function endeksBakim(t = Date.now()) {
  if (t - sonKayit < P.kayitAraligiMs) return;
  sonKayit = t;
  if (!await db.get(`SELECT 1 FROM deger_endeksi WHERE tur = 'TR' LIMIT 1`)) {
    for (let d = P.gecmisGun; d >= 1; d--) await endeksKaydet(gunSonu(gunAnahtari(t - d * GUN)));
  }
  await endeksKaydet(t);
}

async function endeksSerisi(tur, bolgeId, gunSayisi = P.gecmisGun) {
  const satirlar = (await db.all(`SELECT gun, endeks, parsel, islem, hacim FROM deger_endeksi WHERE tur = ? AND bolge_id = ?
    ORDER BY gun DESC LIMIT ?`, tur, bolgeId, gunSayisi)).reverse();
  // Sahipli parsel olmayan günler grafikte boşluk değil, 100 (tahsis seviyesi) değildir: kayıt yoksa yoktur
  const son = satirlar.at(-1), hafta = satirlar.at(-8) || satirlar[0];
  return {
    seri: satirlar.map((x) => ({ gun: x.gun, endeks: x.endeks, islem: x.islem, hacim: x.hacim })),
    endeks: son?.endeks ?? null,
    degisim7: son && hafta && hafta !== son ? yuvarla(((son.endeks - hafta.endeks) / hafta.endeks) * 100, 1) : null,
    parsel: son?.parsel ?? 0,
  };
}

// Parsel kartı için: mahallenin çarpanı ve endeks serisi
async function parselPiyasasi(p, t = Date.now()) {
  const c = await mahalleCarpani(p.region_id, t);
  const s = await endeksSerisi('MAHALLE', p.region_id);
  return { carpan: c.carpan, endeks: yuvarla(100 * c.carpan, 1), degisim7: s.degisim7, seri: s.seri,
    sinyaller: { talep: c.talep, gelisim: c.gelisim, islemCarpani: c.islemCarpani, islemSayisi: c.islemSayisi, sahipli: c.sahipli },
    fiyatGecmisi: await fiyatGecmisi(p.id) };
}

// ---------- Parselin fiyat geçmişi: tahsis ve satışlar (eskiden yeniye)
async function fiyatGecmisi(parcelId) {
  return (await db.all(`SELECT o.start_at, o.reason, o.price, u.display_name AS kim FROM parcel_ownership o JOIN users u ON u.id = o.user_id
      WHERE o.parcel_id = ? ORDER BY o.id DESC LIMIT 20`, parcelId)).reverse()
    .map((o) => ({ tur: { TRADE: 'SATIS', PRIMARY_ALLOCATION: 'TAHSIS', HAZINE: 'HAZINE' }[o.reason] || 'BASLANGIC',
      fiyat: o.price == null ? null : Math.round(o.price), tarih: sqlMs(o.start_at), kim: o.kim }));
}

// ---------- Portföy
// Bir sahiplik süresince parsele yapılan yatırım (inşaat, yükseltme, süs) ve toplanan kira
async function yatirimVeGelir(userId, parcelId, bas, bit = null) {
  let yatirim = 0, kira = 0;
  for (const e of await db.all(`SELECT action, after_json FROM audit_events WHERE entity = ? AND actor_id = ? AND created_at >= ? AND created_at <= ?
      AND action IN ('STRUCTURE_STARTED', 'STRUCTURE_UPGRADED', 'DECORATION_PLACED', 'RENT_COLLECTED')`, parcelId, userId, bas, bit || '9999')) {
    const a = JSON.parse(e.after_json || '{}');
    if (e.action === 'STRUCTURE_STARTED') yatirim += a.maliyet || 0;
    else if (e.action === 'STRUCTURE_UPGRADED') yatirim += a.bedel || 0;
    else if (e.action === 'DECORATION_PLACED') yatirim += SUSLER[a.tur]?.fiyat || 0;
    else kira += a.tutar || 0;
  }
  return { yatirim: Math.round(yatirim), kira: Math.round(kira) };
}

// Sahibine, kartta: bu parselin alış, yatırım, kira ve bugünkü getirisi
async function parselGetirisi(userId, parcelId, degerToplam) {
  const o = await db.get(`SELECT price, reason, start_at FROM parcel_ownership WHERE parcel_id = ? AND user_id = ? AND end_at IS NULL`, parcelId, userId);
  if (!o) return null;
  const alis = Math.round(o.price || 0);
  const { yatirim, kira } = await yatirimVeGelir(userId, parcelId, o.start_at);
  const maliyet = alis + yatirim, getiri = degerToplam + kira - maliyet;
  return { alisTuru: o.reason, alisTarihi: sqlMs(o.start_at), alis, yatirim, kira, maliyet, getiri,
    getiriYuzde: maliyet > 0 ? yuvarla((getiri / maliyet) * 100, 1) : null };
}

async function portfoy(userId, t = Date.now()) {
  const acik = await db.all(`SELECT o.parcel_id, o.price, o.reason, o.start_at FROM parcel_ownership o JOIN parcels p ON p.id = o.parcel_id
      AND p.owner_user_id = o.user_id WHERE o.user_id = ? AND o.end_at IS NULL ORDER BY o.id`, userId);
  const parseller = [];
  for (const o of acik) {
    const p = await oyun().parselGetir(o.parcel_id);
    const deger = await oyun().parselDegeri(p, t);
    const alis = Math.round(o.price || 0);
    const { yatirim, kira } = await yatirimVeGelir(userId, p.id, o.start_at);
    const maliyet = alis + yatirim;
    const getiri = deger.toplam + kira - maliyet;
    parseller.push({ id: p.id, mahalle: p.mahalle, ilce: p.ilce, imar: p.zoning_type, adaParsel: require('./harita/ada').adaParsel(p.grid_x, p.grid_y), alisTuru: o.reason, alisTarihi: sqlMs(o.start_at),
      alis, yatirim, kira, maliyet, deger: deger.toplam, getiri, getiriYuzde: maliyet > 0 ? yuvarla((getiri / maliyet) * 100, 1) : null,
      endeks: yuvarla(100 * deger.carpan, 1) });
  }
  const satislar = [];
  for (const s of await db.all(`SELECT t.parcel_id, t.price, t.fee, t.created_at, a.display_name AS alici FROM trades t JOIN users a ON a.id = t.buyer_id
      WHERE t.seller_id = ? ORDER BY t.id DESC LIMIT 30`, userId)) {
    const o = await db.get(`SELECT price, start_at, end_at FROM parcel_ownership WHERE parcel_id = ? AND user_id = ? AND start_at <= ?
        ORDER BY id DESC LIMIT 1`, s.parcel_id, userId, sqlZamani(s.created_at));
    const alis = Math.round(o?.price || 0);
    const { yatirim, kira } = o ? await yatirimVeGelir(userId, s.parcel_id, o.start_at, o.end_at) : { yatirim: 0, kira: 0 };
    const net = s.price - s.fee;
    const kar = net + kira - alis - yatirim;
    satislar.push({ id: s.parcel_id, tarih: s.created_at, fiyat: s.price, masraf: s.fee, net, alis, yatirim, kira, kar,
      karYuzde: alis + yatirim > 0 ? yuvarla((kar / (alis + yatirim)) * 100, 1) : null, alici: s.alici });
  }
  for (const e of await db.all(`SELECT entity, after_json, created_at FROM audit_events WHERE actor_id = ? AND action = 'TREASURY_PURCHASE'
      ORDER BY id DESC LIMIT 30`, userId)) {
    const a = JSON.parse(e.after_json);
    satislar.push({ id: e.entity, tarih: sqlMs(e.created_at), fiyat: a.teklif, masraf: 0, net: a.teklif, alis: a.alis, yatirim: a.yatirim, kira: a.kira,
      kar: a.teklif + a.kira - a.alis - a.yatirim, karYuzde: a.alis + a.yatirim > 0 ? yuvarla(((a.teklif + a.kira - a.alis - a.yatirim) / (a.alis + a.yatirim)) * 100, 1) : null,
      alici: P.hazine.ad, hazine: true });
  }
  satislar.sort((a, b) => b.tarih - a.tarih);
  const top = (dizi, k) => dizi.reduce((a, x) => a + x[k], 0);
  const maliyet = top(parseller, 'maliyet');
  const acikGetiri = top(parseller, 'getiri');
  return {
    ozet: { parsel: parseller.length, deger: top(parseller, 'deger'), maliyet, kira: top(parseller, 'kira'), acikGetiri,
      acikGetiriYuzde: maliyet > 0 ? yuvarla((acikGetiri / maliyet) * 100, 1) : null, gerceklesen: top(satislar, 'kar'), satisSayisi: satislar.length },
    parseller, satislar,
  };
}

// ---------- Hazine alım teklifi
// Teklif = oran × (arsa: taban bedel × satıcı hariç mahalle çarpanı + yapılar + süsler). Uygun değilse sebebiyle döner.
async function hazineTeklifi(userId, p, t = Date.now()) {
  const o = await db.get(`SELECT price, reason, start_at FROM parcel_ownership WHERE parcel_id = ? AND user_id = ? AND end_at IS NULL`, p.id, userId);
  if (!o || p.owner_user_id !== userId) return null;
  // Teklifte satış sinyali kullanılmaz (başka hesaplar arası yıkama işlemleri Hazine fiyatını şişiremesin): talep + gelişme
  const sinyal = (await bolgeSinyalleri(t, p.region_id, { haric: userId })).get(p.region_id);
  const c = carpanHesapla(sinyal && { ...sinyal, islemler: [] });
  const yapilar = await db.all('SELECT * FROM structures WHERE parcel_id = ?', p.id);
  const deger = await oyun().tahminiDeger(p, yapilar, t, c.carpan);
  const teklif = Math.max(1, Math.floor(deger.toplam * P.hazine.oran));
  const sonuc = { teklif, oran: P.hazine.oran, deger: deger.toplam, carpan: c.carpan, uygun: false, sebep: null, acilis: null };
  // Başlangıç hediyesi parsel, kimin elinde olursa olsun hediye edildiği andan 30 gün sonra Hazine'ye satılabilir
  // (hediyeyi ikinci hesaba devredip oradan Hazine'ye satmak olmasın)
  const hediye = (await db.get(`SELECT MAX(start_at) AS s FROM parcel_ownership WHERE parcel_id = ? AND reason = 'BASLANGIC'`, p.id)).s;
  const hediyeAcilis = hediye ? sqlMs(hediye) + P.hazine.hediyeTutmaMs : 0;
  const acilis = Math.max(sqlMs(o.start_at) + P.hazine.minTutmaMs, hediyeAcilis);
  const gunBasi = sqlZamani(gunSonu(gunAnahtari(t)) - GUN + 1);
  if (p.status !== 'ACTIVE') sonuc.sebep = 'Parsel dondurulmuş';
  else if (await db.get(`SELECT 1 FROM listings WHERE parcel_id = ? AND status = 'ACTIVE'`, p.id)) sonuc.sebep = 'Parsel ilanda; önce ilanı kaldır';
  else if (await require('./kira').acikKira(p.id)) sonuc.sebep = 'Parsel kirada ya da kira teklifinde';
  else if (await db.get(`SELECT 1 FROM crops WHERE parcel_id = ? AND status = 'GROWING'`, p.id)) sonuc.sebep = 'Tarlada ekin var; önce hasat et';
  else if (yapilar.some((s) => s.status === 'BUILDING')) sonuc.sebep = 'İnşaat sürüyor; bitince satabilirsin';
  else if (await db.get(`SELECT 1 FROM uretimler WHERE parcel_id = ? AND durum = 'URETIMDE'`, p.id)) sonuc.sebep = 'Tesiste süren üretim var; önce süren üretimi topla';
  else if (await db.get(`SELECT 1 FROM hayvan_bakim b JOIN structures s ON s.id = b.structure_id WHERE s.parcel_id = ? AND b.durum = 'BESLENDI'`, p.id)) {
    sonuc.sebep = 'Hayvanların ürünü hazırlanıyor; önce topla';
  } else if (t < acilis) { sonuc.sebep = acilis === hediyeAcilis ? 'Başlangıç hediyesi arsa, hediye edildikten 30 gün sonra Hazine\'ye satılabilir' : 'Parsel en az 3 gündür senin olmalı'; sonuc.acilis = acilis; }
  else if (deger.toplam > PAZAR.maxFiyat) sonuc.sebep = 'Değeri pazar üst sınırını aşıyor; pazarda ilanla sat';
  else if ((await db.get(`SELECT COUNT(*) AS c FROM audit_events WHERE actor_id = ? AND action = 'TREASURY_PURCHASE' AND created_at >= ?`, userId, gunBasi)).c >= P.hazine.gunlukSatis) {
    sonuc.sebep = `Hazine'ye günde en çok ${P.hazine.gunlukSatis} parsel satabilirsin`;
  } else sonuc.uygun = true;
  return sonuc;
}

// Parseli Hazine'ye sat: akçe hemen hesaba geçer; parsel, yapıları ve süsleriyle Hazine'nin olur ve bugünkü değeriyle pazara çıkar
function hazineyeSat(userId, parcelId, govde) {
  return db.tx(async () => {
    const t = Date.now();
    // Parsel satırı kilitlenir (pazar.js ile aynı): uygunluk denetimi ile devir arasına ilan / kira / satış girmesin
    await db.get(`SELECT id FROM parcels WHERE id = ? FOR UPDATE`, parcelId);
    const p = await oyun().parselGetir(parcelId);
    oyun().sahibiOlmali(p, userId);
    // Günlük satış sınırı eşzamanlı satışlarla aşılmasın
    await db.kilit(`hazine-satis:${userId}`);
    const tk = await hazineTeklifi(userId, p, t);
    if (!tk.uygun) throw new OyunHatasi(409, tk.sebep, 'HAZINE_UYGUN_DEGIL');
    const gorulen = Number(govde?.teklif);
    if (govde?.teklif != null && gorulen !== tk.teklif) throw new OyunHatasi(409, `Teklif güncellendi: artık ${tk.teklif} akçe`, 'TEKLIF_DEGISTI');
    const hz = await hazineId(false);
    if (!hz) throw new OyunHatasi(503, 'Hazine hazır değil');
    const o = await db.get(`SELECT price, start_at FROM parcel_ownership WHERE parcel_id = ? AND end_at IS NULL`, p.id);
    const alis = Math.round(o.price || 0);
    const { yatirim, kira } = await yatirimVeGelir(userId, p.id, o.start_at);

    await db.run(`UPDATE parcel_ownership SET end_at = datetime('now') WHERE parcel_id = ? AND end_at IS NULL`, p.id);
    await db.run(`INSERT INTO parcel_ownership (parcel_id, user_id, reason, price) VALUES (?, ?, 'HAZINE', ?)`, p.id, hz, tk.teklif);
    const r = await db.run(`UPDATE parcels SET owner_user_id = ?, acquired_at = datetime('now'), version = version + 1
                          WHERE id = ? AND owner_user_id = ? AND version = ?`, hz, p.id, userId, p.version);
    if (r.changes !== 1) throw new OyunHatasi(409, 'Parsel az önce değişti; tekrar dene');
    await db.run(`UPDATE structures SET owner_user_id = ?, gelir_at = ? WHERE parcel_id = ?`, hz, t, p.id);   // kira sayacı sıfırdan
    await require('./kira').devirdeKapat(p.id);
    const tx = L.yeniTx();
    await L.odul(userId, tk.teklif, `Hazine alımı ${p.id}`, tx);
    await L.denetim({ anahtar: `TREASURY_PURCHASE:${tx}`, aktor: userId, eylem: 'TREASURY_PURCHASE', varlik: p.id,
      sonra: { teklif: tk.teklif, deger: tk.deger, alis, yatirim, kira }, bolge: p.region_id, herkese: true });
    carpanOnbellek.delete(p.region_id);
    const ilan = await hazineIlani(hz, p.id, t);
    return { tamam: true, teklif: tk.teklif, kar: tk.teklif + kira - alis - yatirim, ilanId: ilan?.ilanId ?? null };
  });
}

// Hazine'nin elindeki parseli bugünkü değeriyle ilana koyar (süresi dolanlar bakımda yeniden ilana çıkar)
async function hazineIlani(hz, parcelId, t = Date.now()) {
  const p = await oyun().parselGetir(parcelId);
  const fiyat = Math.max(1, Math.round((await oyun().parselDegeri(p, t)).toplam));
  if (fiyat > PAZAR.maxFiyat) return null;   // üst sınırın üstündeki parsel ucuza ilana çıkmaz
  return require('./pazar').ilanAc(hz, p.id, { fiyat, gun: P.hazine.ilanGun, kosul: 'HERKES' });
}
let sonHazineBakim = 0;
async function hazineBakim(t = Date.now()) {
  if (t - sonHazineBakim < P.kayitAraligiMs) return;
  sonHazineBakim = t;
  const hz = await hazineId(false);
  if (!hz) return;
  for (const x of await db.all(`SELECT p.id FROM parcels p WHERE p.owner_user_id = ? AND p.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.parcel_id = p.id AND l.status = 'ACTIVE') LIMIT 200`, hz)) {
    // Her ilan kendi işleminde (pazar.ilanAc): biri başarısız olursa yalnız o geri alınır
    try { await hazineIlani(hz, x.id, t); } catch { /* kirada vb.: sonraki turda */ }
  }
}

// ---------- Piyasa özeti (Pazar → Endeksler)
async function piyasaOzeti() {
  const tr = await endeksSerisi('TR', 0);
  const gun = tr.seri.at(-1)?.gun;
  const hafta = tr.seri.at(-8)?.gun || tr.seri[0]?.gun;
  const mahalleler = gun ? (await db.all(`
    SELECT e.bolge_id AS id, e.endeks, e.parsel, r.name AS ad, ri.name AS ilce, rl.name AS il, h.endeks AS onceki
    FROM deger_endeksi e JOIN regions r ON r.id = e.bolge_id JOIN regions ri ON ri.id = r.parent_id
      LEFT JOIN regions rl ON rl.id = ri.parent_id
      LEFT JOIN deger_endeksi h ON h.tur = 'MAHALLE' AND h.bolge_id = e.bolge_id AND h.gun = ?
    WHERE e.tur = 'MAHALLE' AND e.gun = ?`, hafta, gun))
    .map((m) => ({ ...m, degisim7: m.onceki ? yuvarla(((m.endeks - m.onceki) / m.onceki) * 100, 1) : null, onceki: undefined })) : [];
  const islem30 = await db.get(`SELECT COUNT(*) AS c, COALESCE(SUM(price), 0) AS s FROM trades WHERE created_at > ?`, Date.now() - 30 * GUN);
  return {
    tr,
    yukselenler: mahalleler.filter((m) => m.degisim7 > 0).sort((a, b) => b.degisim7 - a.degisim7 || b.endeks - a.endeks).slice(0, 8),
    degerliler: [...mahalleler].sort((a, b) => b.endeks - a.endeks).slice(0, 8),
    islem30: { sayi: islem30.c, hacim: islem30.s },
    not: 'Endeks 100 = taban arsa bedeli seviyesi. Talep, mahalledeki yatırımlar ve gerçek satışlardan hesaplanır. Oyun içi göstergedir; akçe nakde çevrilmez.',
  };
}

async function bolgeEndeksi(tur, id) {
  if (!['MAHALLE', 'ILCE', 'IL', 'TR'].includes(tur)) return null;
  return endeksSerisi(tur, tur === 'TR' ? 0 : Number(id) || 0);
}

module.exports = {
  yapiYatirimi, mahalleCarpani, carpanHesapla, bolgeSinyalleri, endeksKaydet, endeksBakim, endeksSerisi, bolgeEndeksi,
  parselPiyasasi, fiyatGecmisi, portfoy, parselGetirisi, hazineId, hazineTeklifi, hazineyeSat, hazineBakim, piyasaOzeti, gunAnahtari,
};
