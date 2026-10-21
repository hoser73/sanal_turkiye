// Oyun kuralları — tek kaynak. Bütün sayılar tasarım varsayımıdır (bkz. proje planı §3, §4, §5).
// Buradaki imar oranları GERÇEK Meram imar bilgisi DEĞİLDİR; oyun kuralıdır.

// Oyun içi birim: nakde çevrilemeyen oyun puanı (plan §10.1)
const BIRIM = { kod: 'AKCE', ad: 'akçe', sembol: '₳' };

// Demo hızı: 1 = tasarım süreleri (dakika). Prototipte süreler kısa tutuldu.
const OYUN_HIZI = Number(process.env.OYUN_HIZI || 1);
const dk = (n) => Math.round((n * 60 * 1000) / OYUN_HIZI);

// §3.1 izin matrisi + §3.3 TAKS/KAKS
const IMAR = {
  KONUT:   { ad: 'Konut',          renk: '#f2c48d', taks: 0.30, kaks: 0.60, satilik: true,  m2Fiyat: 0.40, aciklama: 'Villa, ev, apartman (plan limitleriyle). Sanayi yasak.' },
  TICARET: { ad: 'Ticaret',        renk: '#e58f8f', taks: 0.40, kaks: 1.20, satilik: true,  m2Fiyat: 0.55, aciklama: 'Dükkan, ofis, restoran, otel. Ağır sanayi ve plan dışı konut yasak.' },
  TARIM:   { ad: 'Tarım',          renk: '#a8d08d', taks: 0.12, kaks: 0.12, satilik: true,  m2Fiyat: 0.12, aciklama: 'Tarla, bahçe, sulama, sera. İzinsiz konut/fabrika yasak.' },
  SANAYI:  { ad: 'Sanayi',         renk: '#b4a7d6', taks: 0.50, kaks: 1.00, satilik: true,  m2Fiyat: 0.30, aciklama: 'Fabrika, depo, lojistik. Konut yasak.' },
  TURIZM:  { ad: 'Turizm',         renk: '#7fc8d6', taks: 0.25, kaks: 0.50, satilik: true,  m2Fiyat: 0.45, aciklama: 'Konaklama ve rekreasyon.' },
  KARMA:   { ad: 'Karma kullanım', renk: '#f0a868', taks: 0.35, kaks: 1.05, satilik: true,  m2Fiyat: 0.50, aciklama: 'Belirlenmiş oranlarla konut + ticaret.' },
  KORUMA:  { ad: 'Koruma / orman', renk: '#5e9e6e', taks: 0,    kaks: 0,    satilik: false, m2Fiyat: 0,    aciklama: 'Koruma görevleri ve gezi etkinlikleri. Özel yapılaşma yok, oyuncu satışına kapalı.' },
  PARK:    { ad: 'Kamu / park',    renk: '#c9e4b4', taks: 0.05, kaks: 0.05, satilik: false, m2Fiyat: 0,    aciklama: 'Okul, hastane, park, spor alanı gibi kamu kullanımları. Oyuncu satışına kapalı.' },
  // Parsel olmayan hücreler (gerçek su yüzeyi ve ana yollar)
  SU:      { ad: 'Su yüzeyi',      renk: '#8fc1d9', taks: 0, kaks: 0, satilik: false, m2Fiyat: 0, parselDegil: true, karoOpaklik: 0, aciklama: 'Deniz, göl ya da nehir. Parsel değildir.' },
  YOL:     { ad: 'Yol / demiryolu', renk: '#b9b3a6', taks: 0, kaks: 0, satilik: false, m2Fiyat: 0, parselDegil: true, karoOpaklik: 0.25, aciklama: 'Ana yol ya da demiryolu güzergâhı. Parsel değildir.' },
};

// İmar kaynağı: gerçek arazi kullanımı (OpenStreetMap / OpenMapTiles) → oyun imarı. Bkz. server/harita/imar.js
const IMAR_KAYNAK_NOTU = 'İmar türü gerçek arazi kullanımından (OpenStreetMap) türetilmiş oyun kuralıdır; resmî imar planı değildir.';

// Çekicilik = il katsayısı × yerleşim türü katsayısı (birincil tahsis bedelini etkiler; fiyat tahmini değildir)
const IL_CEKICILIK = {
  '34': 1.6, '06': 1.35, '35': 1.35, '07': 1.3, '48': 1.3, '16': 1.2, '41': 1.15, '09': 1.15, '42': 1.1, '01': 1.1,
  '33': 1.1, '27': 1.05, '55': 1.05, '61': 1.05, '26': 1.05, '10': 1.05, '59': 1.05, '54': 1.05, '17': 1.05, '20': 1.05,
};
const YERLESIM_CEKICILIK = { city: 1.25, town: 1.1, suburb: 1.15, quarter: 1.15, neighbourhood: 1.15, village: 0.9, hamlet: 0.85, isolated_dwelling: 0.8, KIRSAL: 0.85 };

// §4.1 geliştirme kategorileri. taban: taban alanı (m²), kat: kat sayısı.
// emsal=false olanlar (çit, sulama, panel, peyzaj) TAKS/KAKS hesabına girmez.
const YAPILAR = {
  TEL_CIT:      { ad: 'Tel çit',        ikon: '🧱', kategori: 'Sınır ve güvenlik', maliyet: 30,  sure: 1, taban: 0,   kat: 0, emsal: false, izin: ['KONUT','TICARET','TARIM','SANAYI','TURIZM','KARMA'], tekil: true, etki: 'Dayanıklılık, görünüm' },
  SULAMA_HATTI: { ad: 'Sulama hattı',   ikon: '💧', kategori: 'Su ve tarım',       maliyet: 40,  sure: 2, taban: 0,   kat: 0, emsal: false, izin: ['TARIM'], tekil: true, etki: 'Ekin otomatik sulanır, verim +%15' },
  SU_DEPOSU:    { ad: 'Su deposu',      ikon: '🛢️', kategori: 'Su ve tarım',       maliyet: 60,  sure: 2, taban: 10,  kat: 1, emsal: true,  izin: ['TARIM','SANAYI'], tekil: true, etki: 'Sulama maliyeti yarıya iner' },
  SERA:         { ad: 'Sera',           ikon: '🌱', kategori: 'Yapı',              maliyet: 120, sure: 4, taban: 40,  kat: 1, emsal: true,  izin: ['TARIM'], tekil: true, minAlan: 800, etki: 'Verim +%25, kuraklık riski yok' },
  AMBAR:        { ad: 'Ambar',          ikon: '🏚️', kategori: 'Yapı',              maliyet: 80,  sure: 3, taban: 50,  kat: 1, emsal: true,  izin: ['TARIM'], tekil: true, minAlan: 800, etki: 'Tarlada taze kalma 2 kat, depodaki bozulma yarıya iner' },
  EV:           { ad: 'Müstakil ev',    ikon: '🏠', kategori: 'Yapı',              maliyet: 150, sure: 4, taban: 120, kat: 2, emsal: true,  izin: ['KONUT','KARMA'], etki: 'Nüfus +4, mahalle çekiciliği' },
  APARTMAN:     { ad: 'Apartman',       ikon: '🏢', kategori: 'Yapı',              maliyet: 400, sure: 8, taban: 130, kat: 4, emsal: true,  izin: ['KONUT','KARMA'], minAlan: 800, etki: 'Nüfus +16' },
  DUKKAN:       { ad: 'Dükkan',         ikon: '🏪', kategori: 'Yapı',              maliyet: 140, sure: 4, taban: 80,  kat: 1, emsal: true,  izin: ['TICARET','KARMA'], etki: 'Ticaret faaliyeti (pazar modülünde)' },
  RESTORAN:     { ad: 'Restoran',       ikon: '🍽️', kategori: 'Yapı',              maliyet: 220, sure: 5, taban: 120, kat: 1, emsal: true,  izin: ['TICARET','TURIZM','KARMA'], etki: 'Ziyaretçi ilgisi' },
  PANSIYON:     { ad: 'Pansiyon',       ikon: '🏨', kategori: 'Yapı',              maliyet: 260, sure: 6, taban: 150, kat: 2, emsal: true,  izin: ['TURIZM','TICARET'], minAlan: 800, etki: 'Konaklama' },
  DEPO:         { ad: 'Depo',           ikon: '📦', kategori: 'Yapı',              maliyet: 160, sure: 4, taban: 200, kat: 1, emsal: true,  izin: ['SANAYI'], etki: 'Lojistik kapasitesi' },
  FABRIKA:      { ad: 'Atölye/fabrika', ikon: '🏭', kategori: 'Yapı',              maliyet: 450, sure: 8, taban: 300, kat: 1, emsal: true,  izin: ['SANAYI'], minAlan: 800, etki: 'Salça, zeytinyağı, pekmez, kumaş, fındık ezmesi, paket çay' },
  GUNES_PANELI: { ad: 'Güneş paneli',   ikon: '☀️', kategori: 'Enerji',            maliyet: 70,  sure: 2, taban: 0,   kat: 0, emsal: false, izin: ['KONUT','TICARET','TARIM','SANAYI','TURIZM','KARMA'], tekil: true, etki: 'Enerji üretimi' },
  DEGIRMEN:     { ad: 'Değirmen',       ikon: '🌬️', kategori: 'Üretim',            maliyet: 180, sure: 5, taban: 60,  kat: 1, emsal: true,  izin: ['TARIM','SANAYI'], tekil: true, etki: 'Buğdayı una çevirir' },
  FIRIN:        { ad: 'Fırın',          ikon: '🥖', kategori: 'Üretim',            maliyet: 200, sure: 5, taban: 70,  kat: 1, emsal: true,  izin: ['TICARET','KARMA'], tekil: true, etki: 'Undan ekmek ve simit' },
  PEYZAJ:       { ad: 'Peyzaj ve ağaç', ikon: '🌳', kategori: 'Estetik',           maliyet: 25,  sure: 1, taban: 0,   kat: 0, emsal: false, izin: ['KONUT','TICARET','TARIM','SANAYI','TURIZM','KARMA'], tekil: true, etki: 'Ziyaretçi ilgisi, kozmetik puan' },
};
for (const y of Object.values(YAPILAR)) y.sureMs = dk(y.sure);

// §5.1 ürünler. sulama: gereken sulama sayısı. bolgeler: yalnızca bu illerde (plaka) ekilebilen yöresel ürünler.
// donHassas: don olayında (gerçek hava ≤ 0 °C) açık tarlada verim düşer; sera korur.
const BOLGE = {
  KARADENIZ_FINDIK: ['52', '61', '28', '53', '55', '81', '14', '67', '74'],
  CAY: ['53', '61', '08'],
  PAMUK: ['01', '33', '63', '21', '47', '80', '31', '09', '35', '72'],
  ZEYTIN: ['35', '09', '10', '48', '17', '16', '31', '33', '07', '27', '45', '20', '79', '77', '41'],
  KAYISI: ['44', '23', '02', '46', '58', '62'],
  UZUM: ['45', '20', '50', '35', '59', '22', '79', '39', '64', '06', '51', '21'],
};
const URUNLER = {
  BUGDAY: { ad: 'Buğday', ikon: '🌾', tohum: 20, sure: 4, sulama: 2, verim: 70, tabanFiyat: 1.0 },
  DOMATES:{ ad: 'Domates', ikon: '🍅', tohum: 25, sure: 3, sulama: 3, verim: 60, tabanFiyat: 1.2, donHassas: true },
  ELMA:   { ad: 'Elma',   ikon: '🍎', tohum: 40, sure: 6, sulama: 2, verim: 65, tabanFiyat: 1.4 },
  FINDIK: { ad: 'Fındık', ikon: '🌰', tohum: 45, sure: 7, sulama: 2, verim: 40, tabanFiyat: 2.6, bolgeler: BOLGE.KARADENIZ_FINDIK, bolgeAd: 'Karadeniz' },
  CAY:    { ad: 'Çay',    ikon: '🍃', tohum: 35, sure: 5, sulama: 3, verim: 50, tabanFiyat: 2.0, bolgeler: BOLGE.CAY, bolgeAd: 'Doğu Karadeniz', donHassas: true },
  PAMUK:  { ad: 'Pamuk',  ikon: '☁️', tohum: 30, sure: 6, sulama: 3, verim: 55, tabanFiyat: 1.8, bolgeler: BOLGE.PAMUK, bolgeAd: 'Çukurova, Ege ve GAP' },
  ZEYTIN: { ad: 'Zeytin', ikon: '🫒', tohum: 50, sure: 8, sulama: 1, verim: 45, tabanFiyat: 2.4, bolgeler: BOLGE.ZEYTIN, bolgeAd: 'Ege, Marmara ve Akdeniz', donHassas: true },
  KAYISI: { ad: 'Kayısı', ikon: '🍑', tohum: 45, sure: 6, sulama: 2, verim: 45, tabanFiyat: 2.5, bolgeler: BOLGE.KAYISI, bolgeAd: 'Malatya ve çevresi', donHassas: true },
  UZUM:   { ad: 'Üzüm',   ikon: '🍇', tohum: 40, sure: 5, sulama: 2, verim: 55, tabanFiyat: 1.9, bolgeler: BOLGE.UZUM, bolgeAd: 'bağ illeri' },
  // §5.7 işlenmiş ürünler (mamul): ekilmez, tesislerde reçeteyle üretilir
  UN:          { ad: 'Un',             ikon: '🌾', mamul: true, tabanFiyat: 2.2 },
  EKMEK:       { ad: 'Ekmek',          ikon: '🍞', mamul: true, tabanFiyat: 1.6 },
  SALCA:       { ad: 'Domates salçası', ikon: '🥫', mamul: true, tabanFiyat: 4.5 },
  ZEYTINYAGI:  { ad: 'Zeytinyağı',     ikon: '🫗', mamul: true, tabanFiyat: 8.5 },
  PEKMEZ:      { ad: 'Üzüm pekmezi',   ikon: '🍯', mamul: true, tabanFiyat: 6.5 },
  KURU_KAYISI: { ad: 'Gün kurusu kayısı', ikon: '🟠', mamul: true, tabanFiyat: 4.8 },
  KUMAS:       { ad: 'Pamuklu kumaş',  ikon: '🧵', mamul: true, tabanFiyat: 5.5 },
  FINDIK_EZMESI: { ad: 'Fındık ezmesi', ikon: '🫙', mamul: true, tabanFiyat: 7.5 },
  PAKET_CAY:   { ad: 'Paket çay',      ikon: '🫖', mamul: true, tabanFiyat: 4.6 },
};
for (const u of Object.values(URUNLER)) if (!u.mamul) u.sureMs = dk(u.sure);

// Üretim zinciri: tesis + girdiler → çıktı. Bir tesiste aynı anda tek parti; enerji bedeli akçe (güneş paneli yarıya indirir).
const RECETELER = {
  UN:            { tesis: 'DEGIRMEN', girdi: { BUGDAY: 10 }, cikti: 6, sure: 2, enerji: 4 },
  EKMEK:         { tesis: 'FIRIN',    girdi: { UN: 4 }, cikti: 8, sure: 1, enerji: 3 },
  KURU_KAYISI:   { tesis: 'AMBAR',    girdi: { KAYISI: 6 }, cikti: 4, sure: 3, enerji: 0 },
  SALCA:         { tesis: 'FABRIKA',  girdi: { DOMATES: 10 }, cikti: 4, sure: 2, enerji: 6 },
  ZEYTINYAGI:    { tesis: 'FABRIKA',  girdi: { ZEYTIN: 8 }, cikti: 3, sure: 3, enerji: 6 },
  PEKMEZ:        { tesis: 'FABRIKA',  girdi: { UZUM: 8 }, cikti: 3, sure: 3, enerji: 5 },
  KUMAS:         { tesis: 'FABRIKA',  girdi: { PAMUK: 6 }, cikti: 3, sure: 3, enerji: 8 },
  FINDIK_EZMESI: { tesis: 'FABRIKA',  girdi: { FINDIK: 6 }, cikti: 3, sure: 2, enerji: 5 },
  PAKET_CAY:     { tesis: 'FABRIKA',  girdi: { CAY: 6 }, cikti: 4, sure: 2, enerji: 4 },
};
for (const r of Object.values(RECETELER)) r.sureMs = dk(r.sure);

// §7.4 meslekler: oyuncu bir meslek seçer; ilgili eylemlerle deneyim kazanır, seviye (1–5) bonusu artırır
const MESLEKLER = {
  CIFTCI:     { ad: 'Çiftçi',     ikon: '🧑‍🌾', aciklama: 'Hasat verimi', bonus: 0.08, seviyeBonus: 0.02, eylemler: ['CROP_HARVESTED'] },
  ZANAATKAR:  { ad: 'Zanaatkâr',  ikon: '🛠️', aciklama: 'Üretim süresi kısalır', bonus: 0.15, seviyeBonus: 0.03, eylemler: ['PRODUCTION_COLLECTED'] },
  TUCCAR:     { ad: 'Tüccar',     ikon: '🧑‍💼', aciklama: 'Pazar ve borsa ücreti indirimi', bonus: 0.3, seviyeBonus: 0.05, eylemler: ['PARCEL_TRADED', 'COMMODITY_TRADE', 'TRADE_SETTLED'] },
  MIMAR:      { ad: 'Mimar',      ikon: '👷', aciklama: 'İnşaat süresi kısalır', bonus: 0.15, seviyeBonus: 0.03, eylemler: ['STRUCTURE_COMPLETED'] },
};
const MESLEK = { degisimBeklemeMs: 7 * 24 * 3600 * 1000, maxSeviye: 5, xpBasamak: 10 };   // seviye = 1 + ⌊√(xp / basamak)⌋

// §7.5 kooperatifler: aynı ilde en fazla 12 üye; ortak kasa, eşit dağıtım; 3+ üyeli kooperatif tüccara ortak satışta fiyat primi alır
const KOOPERATIF = { kurulusBedeli: 100, maxUye: 12, minAktifUye: 3, satisPrimi: 0.06, adMin: 3, adMax: 40 };


const TARIM = {
  sulamaMaliyeti: 5,          // su/enerji, akçe (§5.3)
  sulamaAraligiMs: dk(0.5),   // aynı tarlayı art arda sulama engeli
  verimAlanBirimi: 500,       // her 500 m² için 1 verim katı
  maxVerimKati: 4,
  sulamaHattiBonus: 0.15,
  seraBonus: 0.25,
};

// §5.4 ürün bozulması: tarlada olgun ekin bir süre taze kalır, sonra verimi düşer ve en sonunda çürür.
// Envanterdeki ürün her oyun günü bileşik oranla bozulur. Ambar her ikisini de yavaşlatır.
const BOZULMA = {
  tazeMs: dk(12 * 60),        // olgunlaştıktan sonra tam verim süresi
  bozulmaMs: dk(24 * 60),     // ardından verim %100 → minVerim'e iner; sonra çürür
  minVerimOrani: 0.3,
  ambarKati: 2,               // ambar: tarlada taze süreyi uzatır, envanter bozulmasını yarıya indirir
  envanterGunluk: { BUGDAY: 0.005, DOMATES: 0.06, ELMA: 0.02, FINDIK: 0.003, CAY: 0.02, PAMUK: 0.002, ZEYTIN: 0.01, KAYISI: 0.04, UZUM: 0.05, UN: 0.002, EKMEK: 0.2 },
  gunMs: dk(24 * 60),
  maxGun: 30,
};

// §4.4 yapı bakımı: yapılar her oyun günü yıpranır; sağlık eşiğin altına inince etkisi kesilir. Bakım, eksik sağlıkla orantılı ücretlidir.
const BAKIM = {
  yipranmaGunluk: 3,          // puan / gün (100 → 0 yaklaşık 33 gün)
  etkisizEsik: 40,
  onarimOrani: 0.25,          // tam onarım = yapı maliyetinin %25'i (eksik sağlıkla orantılı)
  gunMs: dk(24 * 60),
};

// §8.6 ürün borsası: oyuncular arası alış/satış emri defteri (fiyat-zaman önceliği, kendi emriyle eşleşme yok)
const BORSA = {
  ucretOrani: 0.02,           // satıcıdan, oyundan çıkar
  minTutar: 5,
  maxAcikEmir: 20,
  maxMiktar: 10000,
  fiyatAltKati: 0.2, fiyatUstKati: 5,   // taban fiyata göre emir fiyat bandı (manipülasyon sınırı)
  sureler: [1, 3, 7],
};
BORSA.sureMs = (gun) => dk(gun * 24 * 60);

// §5.2 NPC talebi: yalnızca sınırlı taban talep, sınırsız geri alım yok.
const NPC_PAZAR = {
  gunlukTalep: 400,     // ürün başına, bütün oyuncular için günlük toplam NPC alım limiti
  fiyatAlt: 0.8,        // taban fiyat çarpanı alt sınırı
  fiyatUst: 1.2,
};

const HESAP = {
  baslangicBakiye: 500,
  maxParsel: 8,         // §10.3 tekel/arsa kapama: hesap başı limit
  maxParselMahalle: 4,
  minYas: 13,           // 13 yaş altı kayıt olamaz
  yetiskinYas: 18,      // 13–17: genç hesap (sohbet varsayılan kapalı, süre hatırlatıcı açık, aday olamaz)
  gencSureHatirlatici: 60,   // dakika
  dogrulamaSaat: 48,    // e-posta doğrulama bağlantısının ömrü
  sifirlamaDakika: 60,  // parola sıfırlama bağlantısının ömrü
  ikinciAdimDakika: 10, // parola sonrası 2FA kodu için süre
  ikinciAdimDeneme: 5,
};

// KVKK ve sözleşme metinleri: sürüm değişince oyuncudan yeniden onay istenir
const YASAL = {
  KOSULLAR:  { surum: '2026-10-taslak-2', ad: 'Kullanım Koşulları', yol: '/yasal/kullanim-kosullari.html', zorunlu: true },
  KVKK:      { surum: '2026-10-taslak-2', ad: 'KVKK Aydınlatma Metni', yol: '/yasal/kvkk.html', zorunlu: true },
  PAZARLAMA: { surum: '2026-10-taslak', ad: 'Ticari elektronik ileti izni', yol: '/yasal/kvkk.html#iletiler', zorunlu: false },
};
const ROLLER = { OYUNCU: 'Oyuncu', MODERATOR: 'Moderatör', DENETCI: 'Denetçi', ADMIN: 'Yönetici' };

// §5.5 mevsimler (gerçek takvim, Türkiye): açık tarlada büyüme süresi çarpanı. Sera mevsimden etkilenmez.
const MEVSIMLER = {
  KIS:      { ad: 'Kış',      ikon: '❄️', aylar: [12, 1, 2],  buyume: { _: 1.6, BUGDAY: 1.0, CAY: 2.0, ZEYTIN: 1.2 } },
  ILKBAHAR: { ad: 'İlkbahar', ikon: '🌸', aylar: [3, 4, 5],   buyume: { _: 0.9, KAYISI: 0.8, CAY: 0.8 } },
  YAZ:      { ad: 'Yaz',      ikon: '☀️', aylar: [6, 7, 8],   buyume: { _: 0.85, BUGDAY: 1.1, PAMUK: 0.8, UZUM: 0.8 } },
  SONBAHAR: { ad: 'Sonbahar', ikon: '🍂', aylar: [9, 10, 11], buyume: { _: 1.1, ELMA: 0.85, FINDIK: 0.85, ZEYTIN: 0.85, UZUM: 0.9 } },
};

// §5.6 gerçek hava (Open-Meteo, il merkezleri): yağmur açık tarlayı sular, don hassas ürünlere zarar verir
const HAVA = {
  yenilemeMs: 30 * 60 * 1000,
  yagmurEsigi: 0.2,           // mm (son saat)
  donEsigi: 0,                // °C
  donVerimKati: 0.75,
};

// §8 oyuncular arası pazar
const PAZAR = {
  ucretOrani: 0.05,            // satıcıdan kesilen, açıkça gösterilen işlem masrafı (oyundan çıkar)
  minUcret: 1,
  maxFiyat: 100000,
  ilanSureleri: [1, 3, 7],     // gün
  aliciKosullari: {
    HERKES:      { ad: 'Herkes',                  yasMs: 0 },
    HESAP_1_GUN: { ad: 'Hesabı en az 1 günlük',   yasMs: dk(24 * 60) },
    HESAP_7_GUN: { ad: 'Hesabı en az 7 günlük',   yasMs: dk(7 * 24 * 60) },
  },
  referansGun: 30,             // mahalle fiyat referansı penceresi
  guvenilirlikEsigi: 3,        // bu sayıdan az işlem varsa "fiyat güvenilirliği düşük"
  washPencereGun: 7,           // aynı iki hesap arasında tekrarlı işlem penceresi
  washCiftEsigi: 3,
  sapmaUst: 5, sapmaAlt: 0.2,  // birincil tahsis bedeline göre olağandışı fiyat
  npcKabulOrani: 0.9,          // demo komşular istenen fiyatın %90'ı ve üzerini kabul eder
};
PAZAR.ilanSuresiMs = (gun) => dk(gun * 24 * 60);

// §6 mahalle muhtarlığı seçimi. Süreler gündür; SECIM_HIZI yalnızca seçim takvimini hızlandırır
// (geliştirme/demo: SECIM_HIZI=1440 → 1 gün = 1 dakika). Oyun içi seçimdir; gerçek kamu seçimi değildir.
const SECIM_HIZI = Number(process.env.SECIM_HIZI || 1);
const gun = (n) => Math.round((n * 24 * 3600 * 1000) / SECIM_HIZI);
const SECIM = {
  asamalar: [   // duyuru → adaylık → kampanya → oylama → itiraz → sonuç → devir (§6.2)
    { kod: 'DUYURU',   ad: 'Duyuru',   sureMs: gun(1) },
    { kod: 'ADAYLIK',  ad: 'Adaylık',  sureMs: gun(2) },
    { kod: 'KAMPANYA', ad: 'Kampanya', sureMs: gun(2) },
    { kod: 'OYLAMA',   ad: 'Oylama',   sureMs: gun(2) },
    { kod: 'ITIRAZ',   ad: 'İtiraz',   sureMs: gun(1) },
  ],
  muhtarDonemMs: gun(30),                   // §6.1 muhtar: 30 gün
  yenidenDenemeMs: gun(3),                  // aday çıkmazsa / iptal olursa yeni seçime kadar bekleme
  minSecmen: Number(process.env.SECIM_MIN_SECMEN || 3),   // seçim için en az bu kadar oyuncu sakin (NPC sayılmaz)
  aday: {                                   // §6.2: hesap yaşı, oyun içi itibar, asgari etkinlik; ücretli adaylık yok
    minHesapYasiMs: gun(7),
    minItibar: 25,
    minEtkinlik: 5,                         // son 30 günde en az bu kadar oyun eylemi
    manifestoMaks: 600, vaatMaks: 5, vaatUzunluk: 120, butceMaks: 100000,
  },
  secmenMinHesapYasiMs: gun(1),             // kütük dondurulurken hesap en az bu kadar eski olmalı (çoklu hesap önlemi)
  duyuruMaks: 400,
  itirazMin: 10, itirazMaks: 500,
  gunMs: gun(1),
};
// Seçim türleri: aynı motor (server/secim.js) her türün takvimi, bölgesi ve makamlarıyla çalışır
SECIM.turler = {
  MUHTAR: {
    ad: 'Muhtarlık', bolge: 'MAHALLE', sakinKolonu: 'region_id', asamalar: SECIM.asamalar,
    donemMs: SECIM.muhtarDonemMs, minSecmen: SECIM.minSecmen,
    makamlar: { MUHTAR: { ad: 'Mahalle muhtarı', koltuk: 1, aday: { minHesapYasiMs: gun(7), minItibar: 25, minEtkinlik: 5 } } },
  },
  BELEDIYE: {   // §6.1: başkan ve meclis 90 gün; §23 belediye seçim sıklığı 90 gün
    ad: 'Belediye', bolge: 'ILCE', sakinKolonu: 'ilce_id',
    asamalar: [
      { kod: 'DUYURU', ad: 'Duyuru', sureMs: gun(2) }, { kod: 'ADAYLIK', ad: 'Adaylık', sureMs: gun(3) },
      { kod: 'KAMPANYA', ad: 'Kampanya', sureMs: gun(3) }, { kod: 'OYLAMA', ad: 'Oylama', sureMs: gun(2) },
      { kod: 'ITIRAZ', ad: 'İtiraz', sureMs: gun(2) },
    ],
    donemMs: gun(90), minSecmen: Number(process.env.BELEDIYE_MIN_SECMEN || 5),
    makamlar: {
      BASKAN: { ad: 'Belediye başkanı', koltuk: 1, aday: { minHesapYasiMs: gun(14), minItibar: 40, minEtkinlik: 10 } },
      MECLIS: { ad: 'Meclis üyesi', koltuk: 5, aday: { minHesapYasiMs: gun(7), minItibar: 25, minEtkinlik: 5 } },
    },
  },
};

// §6.3 belediye bütçesi ve projeleri. Oranlar kuralla sabittir: başkan para basamaz, oran belirleyemez.
const BELEDIYE = {
  gelir: {
    tahsisPayi: 0.10,        // birincil tahsis bedelinin (zaten oyundan çıkan) payı ilçe kasasına
    ruhsatPayi: 0.10,        // inşaat maliyetinin payı (ruhsat harcı)
    islemPayi: 0.5,          // oyuncular arası pazar işlem masrafının payı
    sakinBasiGunluk: 4,      // ilçede parseli olan her aktif oyuncu için günlük devlet katkısı
    gunlukTavan: 200,
  },
  meclisOylamaMs: gun(1),
  nitelikliOran: 2 / 3,      // başkanın çıkarı olan mahalle ya da büyük proje: nitelikli çoğunluk
  buyukProjeEsigi: 800,
  projeler: {
    SULAMA_KANALI: { ad: 'Sulama kanalı', ikon: '💧', maliyet: 600, sureMs: gun(3), etki: 'Mahalledeki tarlalarda sulama maliyeti %50 azalır, hasat verimi %10 artar' },
    YOL_BAKIMI:    { ad: 'Yol bakımı',    ikon: '🛣️', maliyet: 500, sureMs: gun(3), etki: 'Mahalledeki inşaatlar %25 daha kısa sürer' },
    PARK:          { ad: 'Mahalle parkı', ikon: '🌳', maliyet: 400, sureMs: gun(2), etki: 'Mahalle çekiciliği +0,08 (tahsis bedeli ve gelişmişlik skoru)', cekicilik: 0.08 },
    PAZAR_YERI:    { ad: 'Semt pazarı',   ikon: '🧺', maliyet: 900, sureMs: gun(4), etki: 'Mahallede parseli olan oyuncular NPC pazarında %8 daha yüksek fiyat alır' },
  },
  etki: { sulamaIndirim: 0.5, hasatBonus: 0.10, insaatKisalma: 0.25, pazarBonus: 0.08 },
  gerekce: [20, 600], talep: [10, 400],
};
// Oyun içi itibar: herkese açık, basit ve şeffaf formül
const ITIBAR = { gorev: 5, parsel: 4, yapi: 3, hasat: 2, islem: 3, hesapGunu: 1, maks: 100 };

// İlk 10 dakika görevleri (§12.2)
const GOREVLER = [
  { kod: 'ILK_PARSEL', ad: 'İlk parselini edin',        odul: 30, ipucu: 'Haritada yeşil (tarım) boş bir parsele tıkla ve "Edin" de.' },
  { kod: 'ILK_EKIM',   ad: 'Tarlana tohum ek',          odul: 20, ipucu: 'Tarım parselinin kartında bir ürün seç ve ek.' },
  { kod: 'ILK_SULAMA', ad: 'Ekinini sula',              odul: 10, ipucu: 'Ekili tarlada "Sula" düğmesi.' },
  { kod: 'ILK_YAPI',   ad: 'Parseline bir geliştirme yap', odul: 25, ipucu: 'Çit, sulama hattı veya peyzaj iyi bir başlangıç.' },
  { kod: 'ILK_HASAT',  ad: 'İlk hasadını topla',        odul: 40, ipucu: 'Ekin olgunlaşınca "Hasat et".' },
  { kod: 'ILK_SATIS',  ad: 'Ürününü pazarda sat',        odul: 20, ipucu: 'Envanter → Pazara sat.' },
  { kod: 'KOMSU_ZIYARET', ad: 'Bir komşunu ziyaret et',  odul: 15, ipucu: 'Başka bir oyuncunun parseline tıklayıp "Ziyaret et".' },
  { kod: 'ILK_OY',     ad: 'Mahalle seçiminde oy kullan', odul: 15, ipucu: 'Mahalle sekmesinde oylama açıkken oy pusulanı doldur.' },
];

// §7.3 il ligi ve sezonlar: oyuncuların il içindeki herkese açık eylemleri puan kazandırır. Açık formül:
// lig puanı = toplam puan / √(etkin oyuncu) — kalabalık iller ile küçük illeri dengeler. Gurbetçinin eylemi memleketine de yarı puan yazar.
const LIG_HIZI = Number(process.env.LIG_HIZI || 1);   // seçim hızından bağımsız; sezonlar varsayılan 28 gerçek gün
const LIG = {
  sezonMs: Math.round((28 * 24 * 3600 * 1000) / LIG_HIZI),
  baslangic: Date.UTC(2026, 0, 5),
  puanlar: { PARCEL_ACQUIRED: 5, STRUCTURE_COMPLETED: 4, CROP_HARVESTED: 3, PARCEL_TRADED: 4, PARCEL_VISITED: 1, MUHTAR_ANNOUNCEMENT: 1,
    ELECTION_CLOSED: 15, PROJECT_COMPLETED: 12, STRUCTURES_MAINTAINED: 1, COMMODITY_TRADE: 1 },
  gurbetOrani: 0.5,
  rozetMinPuan: 10,
  memleketBeklemeMs: 30 * 24 * 3600 * 1000,
};

// §6.5 görevden alma (geri çağırma) ve moderasyon
const GOREVDEN_ALMA = {
  imzaOrani: 0.4,        // makam bölgesindeki oyuncu sakinlerin (hedef hariç) %40'ı
  minImza: 2,
  sureMs: gun(5),        // dilekçe 5 gün açık kalır
  korumaOrani: 0.2,      // görev süresinin ilk %20'sinde dilekçe başlatılamaz (balayı)
  beklemeMs: gun(10),    // başarısız dilekçeden sonra aynı makam için bekleme
  gerekceMin: 20,
};
const MODERASYON = {
  sebepler: { SPAM: 'İstenmeyen içerik / reklam', TACIZ: 'Taciz veya hakaret', NEFRET: 'Nefret söylemi', DOLANDIRICILIK: 'Dolandırıcılık / manipülasyon',
    COKLU_HESAP: 'Çoklu hesap / oy kaçakçılığı', UYGUNSUZ_AD: 'Uygunsuz ad', KISISEL_VERI: 'Kişisel verinin ifşası', DIGER: 'Diğer' },
  hedefTurleri: ['KULLANICI', 'PARSEL', 'DUYURU', 'MESAJ', 'ILAN', 'PROJE'],
  // İki kişi kuralı: bu işlemler öneren dışında ikinci bir yetkilinin onayıyla uygulanır
  islemler: {
    ICERIK_GIZLE: { ad: 'İçeriği gizle', ikiKisi: false },
    PARSEL_DONDUR: { ad: 'Parseli dondur', ikiKisi: true },
    PARSEL_COZ: { ad: 'Parsel dondurmayı kaldır', ikiKisi: true },
    HESAP_ASKI: { ad: 'Hesabı askıya al', ikiKisi: true },
    HESAP_AC: { ad: 'Askıyı kaldır', ikiKisi: true },
    GOREVDEN_AL: { ad: 'Görevden al (kural ihlali)', ikiKisi: true, denetciGerekli: true },
    SECIM_IPTAL: { ad: 'Seçimi iptal et', ikiKisi: true, denetciGerekli: true },
  },
  acikSikayetSiniri: 10,
};

// §9 kozmetikler: oyun avantajı sağlamaz; görünüm ve kimlik. Bir kısmı akçeyle alınır (oyundan çıkar), bir kısmı rozetle açılır.
const KOZMETIK = {
  CATI_LACIVERT: { tur: 'cati', ad: 'Lacivert çatı', renk: '#2f4a7a', fiyat: 60 },
  CATI_YESIL:    { tur: 'cati', ad: 'Yeşil çatı', renk: '#3f7d4e', fiyat: 60 },
  CATI_MOR:      { tur: 'cati', ad: 'Mor çatı', renk: '#6b4a8a', fiyat: 80 },
  CATI_ALTIN:    { tur: 'cati', ad: 'Altın varak çatı', renk: '#c9a227', rozet: 'SEZON_' },
  BAYRAK_KIRMIZI: { tur: 'bayrak', ad: 'Kırmızı flama', renk: '#c8302e', fiyat: 40 },
  BAYRAK_TURKUAZ: { tur: 'bayrak', ad: 'Turkuaz flama', renk: '#1fa7a0', fiyat: 40 },
  BAYRAK_GEZGIN:  { tur: 'bayrak', ad: 'Gezgin flaması', renk: '#e08a1e', rozet: 'ALBUM_' },
  UNVAN_TOPRAK:   { tur: 'unvan', ad: 'Toprak Ana / Baba', fiyat: 120 },
  UNVAN_GEZGIN:   { tur: 'unvan', ad: 'Gezgin', rozet: 'ALBUM_' },
  UNVAN_SAMPIYON: { tur: 'unvan', ad: 'İl Şampiyonu', rozet: 'SEZON_' },
};

// §8.7 iller arası lojistik: ürün kendi ilinden başka bir ilin tüccarına sevk edilir. Kara her ile, deniz yalnızca limanlar arası.
// Yöresel ürün kendi bölgesinde ucuz, uzakta pahalıdır; büyükşehirler tüketim merkezidir. Varışta o ilin günlük talebiyle satılır.
const LOJISTIK = {
  limanlar: ['34', '35', '33', '07', '61', '55', '41', '10', '16', '31', '48', '17', '53', '52', '01', '09', '22', '59', '57', '28', '74', '78', '81', '08'],
  modlar: {
    // Denge: 600 km kara ≈ birim başına ₳0,36 — sıradan ürünü taşımak kârsız, yöresel/işlenmiş ürünü uzak büyükşehre taşımak kârlı
    KARA:  { ad: 'Kara (kamyon)', kmUcret: 0.0006, sabit: 3, hizKmSaat: 70 },
    DENIZ: { ad: 'Deniz (gemi)',  kmUcret: 0.00025, sabit: 8, hizKmSaat: 30, limanGerekli: true },
  },
  sureCarpani: 1 / 60,          // oyun süresi: gerçek yolculuk süresinin 1/60'ı (500 km kara ≈ 7 dk)
  ilGunlukTalep: 300,           // ürün başına, il başına günlük
  buyuksehir: { '34': 1.18, '06': 1.12, '35': 1.12, '16': 1.06, '07': 1.08, '01': 1.04, '42': 1.04, '27': 1.04 },
  yoreselUzakKati: 1.35, yoreselYerelKati: 0.9,
  maxMiktar: 2000,
};
LOJISTIK.sureMs = (km, mod) => Math.max(60_000, Math.round((km / LOJISTIK.modlar[mod].hizKmSaat) * 3600_000 * LOJISTIK.sureCarpani / OYUN_HIZI));

// §8.8 kiralama ve ortaklık
const KIRA = { maxGun: 30, minGunluk: 1, maxGunluk: 1000, ucretOrani: 0.05, teklifSuresiMs: dk(3 * 24 * 60) };
const ORTAKLIK = { maxOrtak: 3, maxToplamPay: 0.5, minPay: 0.05 };

// §5.8 hava kaynaklı afetler (gerçek hava verisinden; deprem gibi travmatik olaylar oyunlaştırılmaz)
const AFET = {
  FIRTINA: { ad: 'Fırtına', ikon: '🌪️', ruzgarEsigi: 60, yapiHasari: 15, denizGecikmeKati: 2 },
  SAGANAK: { ad: 'Sağanak / sel riski', ikon: '🌊', yagisEsigi: 10, verimKati: 0.85 },
  DOLU:    { ad: 'Dolu', ikon: '🧊', kodlar: [96, 99], verimKati: 0.8 },
  SICAK:   { ad: 'Aşırı sıcak', ikon: '🔥', sicaklikEsigi: 38, sulamaKaybi: 1 },
  tekrarMs: 12 * 3600 * 1000,   // aynı ilde aynı afet en çok 12 saatte bir
};

// §6.6 referandum: ilçe sakinlerinin gizli oyla danışma oylaması (başkan ya da sakinlerin %25'inin imzasıyla açılır)
const REFERANDUM = { sureMs: gun(3), imzaOrani: 0.25, minImza: 2, nisapOrani: 0.3, soruMin: 15, soruMax: 200, aciklamaMax: 600 };

// §7.7 yaşayan nüfus: gerçek oyuncusu az olan mahallelerde boşluğu dolduran, açıkça "demo sakin" etiketli simüle vatandaşlar.
// Aynı kurallarla oynarlar; mahallede gerçek oyuncu çoğaldıkça taşınırlar. Seçimlere yalnızca "doldurma kipi"nde katılırlar:
// bölgedeki gerçek oyuncu sayısı seçim eşiğinin altındayken. Eşiğe ulaşılınca yalnızca gerçek oyuncular aday olur ve oy kullanır.
const NUFUS = {
  etkin: process.env.NUFUS !== 'kapali',
  mahalleHedef: 4,             // gerçek oyuncusu olan mahallede hedef sakin sayısı (gerçek + demo)
  cekilmeEsigi: 4,             // bu kadar gerçek oyuncu olunca demo sakinler taşınmaya başlar
  maxToplam: 400,              // Türkiye geneli demo sakin üst sınırı
  dongüMs: 30_000,             // nüfus döngüsü (yerleştirme, eylemler, taşınma)
  eylemAraligiMs: dk(15),      // bir demo sakinin iki eylemi arası (oyun hızıyla ölçeklenir)
  turBasinaEylem: 12,          // bir döngüde en çok kaç demo sakin eylem yapar
  tasinmaMs: dk(3 * 24 * 60),  // taşınma kararından sonra satılamayan parseller devlete döner
  sohbetYanitMs: [3000, 9000], // gerçek oyuncunun mesajına yanıt gecikmesi
  sohbetYanitAraligiMs: 60_000,          // mahalle başına en sık yanıt
  sohbetKendiliginden: dk(120),          // mahalle başına kendiliğinden sohbet aralığı
  baslangicBakiye: 500,
};

module.exports = { NUFUS, LOJISTIK, KIRA, ORTAKLIK, AFET, REFERANDUM, KOZMETIK, RECETELER, MESLEKLER, MESLEK, KOOPERATIF, LIG, MEVSIMLER, HAVA, BOLGE, BOZULMA, BAKIM, BORSA, GOREVDEN_ALMA, MODERASYON, YASAL, ROLLER, BIRIM, OYUN_HIZI, IMAR, IMAR_KAYNAK_NOTU, IL_CEKICILIK, YERLESIM_CEKICILIK, YAPILAR, URUNLER, TARIM, NPC_PAZAR, PAZAR, SECIM, SECIM_HIZI, BELEDIYE, ITIBAR, HESAP, GOREVLER };
