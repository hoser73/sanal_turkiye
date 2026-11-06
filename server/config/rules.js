// Oyun kuralları — tek kaynak. Bütün sayılar tasarım varsayımıdır (bkz. proje planı §3, §4, §5).
// Buradaki imar oranları GERÇEK Meram imar bilgisi DEĞİLDİR; oyun kuralıdır.

// Oyun içi birim: nakde çevrilemeyen oyun puanı (plan §10.1)
// Oyun parası Türk lirası görünümündedir: kurallardaki ve defterdeki tutarlar oyun birimidir, oyuncuya kat ile çarpılıp TL
// gösterilir (lib/para.js). Gerçek para değildir, nakde çevrilemez. v0.50 dengesi: 1 birim = ₺300 — tohum, ürün, ödül ve
// ücretler gerçeğe yakın (buğday tohumu ≈ ₺12 bin, hasat ≈ ₺42 bin); arsa ve yapılar aşağıdaki ölçeklerle büyütülür
// (gerçekte arazi ve bina, tarım ürününe göre çok daha değerlidir).
const BIRIM = { kod: 'TRY', ad: 'TL', sembol: '₺', kat: 300 };
const ARSA_OLCEK = 100 / 3;   // arsa m² fiyatı: v0.49'daki TL değerleri korunur (₺10.000 → ₺300 birim)
const YAPI_OLCEK = 10;        // yapı maliyetleri: TL olarak v0.49'un ≈ üçte biri (sera ≈ ₺360 bin, müstakil ev ≈ ₺450 bin)

// Demo hızı: 1 = tasarım süreleri (dakika). Prototipte süreler kısa tutuldu.
const OYUN_HIZI = Number(process.env.OYUN_HIZI || 1);
const dk = (n) => Math.round((n * 60 * 1000) / OYUN_HIZI);

// §3.1 izin matrisi + §3.3 TAKS/KAKS
const IMAR = {
  KONUT:   { ad: 'Konut',          renk: '#f2c48d', taks: 0.30, kaks: 0.60, satilik: true,  m2Fiyat: 0.40 * ARSA_OLCEK, aciklama: 'Villa, ev, apartman (plan limitleriyle). Sanayi yasak.' },
  TICARET: { ad: 'Ticaret',        renk: '#e58f8f', taks: 0.40, kaks: 1.20, satilik: true,  m2Fiyat: 0.55 * ARSA_OLCEK, aciklama: 'Dükkan, ofis, restoran, otel. Ağır sanayi ve plan dışı konut yasak.' },
  TARIM:   { ad: 'Tarım',          renk: '#a8d08d', taks: 0.12, kaks: 0.12, satilik: true,  m2Fiyat: 0.12 * ARSA_OLCEK, aciklama: 'Tarla, bahçe, sulama, sera. İzinsiz konut/fabrika yasak.' },
  SANAYI:  { ad: 'Sanayi',         renk: '#b4a7d6', taks: 0.50, kaks: 1.00, satilik: true,  m2Fiyat: 0.30 * ARSA_OLCEK, aciklama: 'Fabrika, depo, lojistik. Konut yasak.' },
  TURIZM:  { ad: 'Turizm',         renk: '#7fc8d6', taks: 0.25, kaks: 0.50, satilik: true,  m2Fiyat: 0.45 * ARSA_OLCEK, aciklama: 'Konaklama ve rekreasyon.' },
  KARMA:   { ad: 'Karma kullanım', renk: '#f0a868', taks: 0.35, kaks: 1.05, satilik: true,  m2Fiyat: 0.50 * ARSA_OLCEK, aciklama: 'Belirlenmiş oranlarla konut + ticaret.' },
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
  TEL_CIT:      { ad: 'Tel çit',        ikon: '🪵', kategori: 'Sınır ve güvenlik', maliyet: 30,  sure: 1, taban: 0,   kat: 0, emsal: false, izin: ['KONUT','TICARET','TARIM','SANAYI','TURIZM','KARMA'], tekil: true, etki: 'Dayanıklılık, görünüm' },
  SULAMA_HATTI: { ad: 'Sulama hattı',   ikon: '💧', kategori: 'Su ve tarım',       maliyet: 40,  sure: 2, taban: 0,   kat: 0, emsal: false, izin: ['TARIM'], tekil: true, etki: 'Ekin otomatik sulanır, verim +%15' },
  SU_DEPOSU:    { ad: 'Su deposu',      ikon: '🛢️', kategori: 'Su ve tarım',       maliyet: 60,  sure: 2, taban: 10,  kat: 1, emsal: true,  izin: ['TARIM','SANAYI'], tekil: true, etki: 'Sulama maliyeti yarıya iner' },
  SERA:         { ad: 'Sera',           ikon: '🌱', kategori: 'Yapı',              maliyet: 120, sure: 4, taban: 40,  kat: 1, emsal: true,  izin: ['TARIM'], tekil: true, minAlan: 800, etki: 'Verim +%25, kuraklık riski yok' },
  AMBAR:        { ad: 'Ambar',          ikon: '🌾', kategori: 'Yapı',              maliyet: 80,  sure: 3, taban: 50,  kat: 1, emsal: true,  izin: ['TARIM'], tekil: true, minAlan: 800, etki: 'Tarlada taze kalma 2 kat, depodaki bozulma yarıya iner' },
  EV:           { ad: 'Müstakil ev',    ikon: '🏠', kategori: 'Ev ve keyif', gelir: 20,              maliyet: 150, sure: 4, taban: 120, kat: 2, emsal: true,  izin: ['KONUT','KARMA'], etki: 'Nüfus +4, mahalle çekiciliği' },
  APARTMAN:     { ad: 'Apartman',       ikon: '🏢', kategori: 'Yapı',              maliyet: 400, sure: 8, taban: 130, kat: 4, emsal: true,  izin: ['KONUT','KARMA'], minAlan: 800, gelir: 50, etki: 'Nüfus +16; daireler kiraya verilir' },
  DUKKAN:       { ad: 'Dükkan',         ikon: '🏪', kategori: 'Yapı',              maliyet: 140, sure: 4, taban: 80,  kat: 1, emsal: true,  izin: ['TICARET','KARMA'], etki: 'Ticaret faaliyeti (pazar modülünde)' },
  RESTORAN:     { ad: 'Restoran',       ikon: '🍽️', kategori: 'Yapı',              maliyet: 220, sure: 5, taban: 120, kat: 1, emsal: true,  izin: ['TICARET','TURIZM','KARMA'], etki: 'Ziyaretçi ilgisi' },
  PANSIYON:     { ad: 'Pansiyon',       ikon: '🏨', kategori: 'Yapı',              maliyet: 260, sure: 6, taban: 150, kat: 2, emsal: true,  izin: ['TURIZM','TICARET'], minAlan: 800, gelir: 45, etki: 'Konaklama; misafirlerden günlük gelir' },
  DEPO:         { ad: 'Depo',           ikon: '📦', kategori: 'Yapı',              maliyet: 160, sure: 4, taban: 200, kat: 1, emsal: true,  izin: ['SANAYI'], etki: 'Lojistik kapasitesi' },
  FABRIKA:      { ad: 'Atölye/fabrika', ikon: '🏭', kategori: 'Yapı',              maliyet: 450, sure: 8, taban: 300, kat: 1, emsal: true,  izin: ['SANAYI'], minAlan: 800, etki: 'Salça, zeytinyağı, pekmez, kumaş, fındık ezmesi, paket çay' },
  GUNES_PANELI: { ad: 'Güneş paneli',   ikon: '☀️', kategori: 'Enerji',            maliyet: 70,  sure: 2, taban: 0,   kat: 0, emsal: false, izin: ['KONUT','TICARET','TARIM','SANAYI','TURIZM','KARMA'], tekil: true, etki: 'Enerji üretimi' },
  DEGIRMEN:     { ad: 'Değirmen',       ikon: '🌬️', kategori: 'Üretim',            maliyet: 180, sure: 5, taban: 60,  kat: 1, emsal: true,  izin: ['TARIM','SANAYI'], tekil: true, etki: 'Buğdayı una çevirir' },
  FIRIN:        { ad: 'Fırın',          ikon: '🥖', kategori: 'Üretim',            maliyet: 200, sure: 5, taban: 70,  kat: 1, emsal: true,  izin: ['TICARET','KARMA'], tekil: true, etki: 'Undan ekmek ve simit' },
  PEYZAJ:       { ad: 'Peyzaj ve ağaç', ikon: '🌳', kategori: 'Estetik',           gizli: true,           maliyet: 25,  sure: 1, taban: 0,   kat: 0, emsal: false, izin: ['KONUT','TICARET','TARIM','SANAYI','TURIZM','KARMA'], tekil: true, etki: 'Ziyaretçi ilgisi, kozmetik puan' },
  // Ev ve keyif: ekip biçmek istemeyen oyuncu için. Konut yapıları turistlere kiralanır: gelir = günlük kira (akçe),
  // her gün çiftlikten toplanır (en çok 2 günlük birikir); havuz parseldeki evlerin kirasını %50 artırır, yükseltme
  // her seviyede +%50. Tarım arazisine yalnızca bağ evi ve çardak yapılabilir (gerçekteki gibi küçük taban).
  BAG_EVI:      { ad: 'Bağ evi',        ikon: '🏡', kategori: 'Ev ve keyif',       maliyet: 220, sure: 4, taban: 45,  kat: 1, emsal: true,  izin: ['TARIM','KONUT','KARMA','TURIZM'], tekil: true, minAlan: 600, gelir: 15, etki: 'Hafta sonu evi; turistlere kiralanır' },
  DAG_EVI:      { ad: 'Ahşap dağ evi',  ikon: '🛖', kategori: 'Ev ve keyif',       maliyet: 380, sure: 5, taban: 70,  kat: 2, emsal: true,  izin: ['KONUT','KARMA','TURIZM'], minSeviye: 2, gelir: 30, etki: 'Şömineli kulübe; turistlere kiralanır' },
  VILLA:        { ad: 'Villa',          ikon: '🏝️', kategori: 'Ev ve keyif',       maliyet: 900, sure: 8, taban: 160, kat: 2, emsal: true,  izin: ['KONUT','KARMA','TURIZM'], tekil: true, minAlan: 600, minSeviye: 3, gelir: 75, etki: 'Geniş teraslı lüks ev; turistlere kiralanır' },
  HAVUZ:        { ad: 'Yüzme havuzu',   ikon: '🏊', kategori: 'Ev ve keyif',       maliyet: 300, sure: 3, taban: 0,   kat: 0, emsal: false, izin: ['KONUT','KARMA','TURIZM'], tekil: true, etki: 'Şezlonglar ve şemsiye; evlerin kira geliri +%50' },
  CARDAK:       { ad: 'Çardak',         ikon: '⛱️', kategori: 'Ev ve keyif',       maliyet: 60,  sure: 1, taban: 0,   kat: 0, emsal: false, izin: ['TARIM','KONUT','KARMA','TURIZM','TICARET'], tekil: true, etki: 'Gölgede çay keyfi; mahalle çekiciliği' },
  OYUN_PARKI:   { ad: 'Oyun parkı',     ikon: '🛝', kategori: 'Ev ve keyif',       maliyet: 120, sure: 2, taban: 0,   kat: 0, emsal: false, izin: ['KONUT','KARMA','TURIZM'], tekil: true, etki: 'Kaydırak ve salıncak; mahalle çekiciliği' },
  // Hayvancılık (oyuncu seviyesiyle açılır): barınak yemlenince ürün verir (bkz. HAYVANLAR)
  KUMES:        { ad: 'Kümes',          ikon: '🐔', kategori: 'Hayvancılık',       maliyet: 90,  sure: 2, taban: 20,  kat: 1, emsal: true,  izin: ['TARIM'], tekil: true, minSeviye: 2, etki: '6 tavuk: yemlenince yumurta' },
  INEK_AHIRI:   { ad: 'İnek ahırı',     ikon: '🐄', kategori: 'Hayvancılık',       maliyet: 220, sure: 4, taban: 60,  kat: 1, emsal: true,  izin: ['TARIM'], tekil: true, minSeviye: 3, etki: '2 inek: yemlenince süt' },
  AGIL:         { ad: 'Ağıl',           ikon: '🐑', kategori: 'Hayvancılık',       maliyet: 160, sure: 3, taban: 30,  kat: 1, emsal: true,  izin: ['TARIM'], tekil: true, minSeviye: 4, etki: '5 koyun: yemlenince yün' },
  MANDIRA:      { ad: 'Mandıra',        ikon: '🧀', kategori: 'Üretim',            maliyet: 260, sure: 5, taban: 50,  kat: 1, emsal: true,  izin: ['TARIM','SANAYI'], tekil: true, minSeviye: 5, etki: 'Sütten peynir ve tereyağı' },
  // v0.44 tarım arazisinde kurulan küçük üretim: arıcılık, zeytin sıkma, çay (zeytinyağı ve paket çay için fabrika şartı kalktı)
  ARI_KOVANI:   { ad: 'Arı kovanları',  ikon: '🐝', kategori: 'Hayvancılık',       maliyet: 140, sure: 3, taban: 0,   kat: 0, emsal: false, izin: ['TARIM'], tekil: true, minSeviye: 4, etki: '3 kovan: şerbetle beslenince bal' },
  ZEYTIN_SIKMA: { ad: 'Zeytin sıkma evi', ikon: '🫒', kategori: 'Üretim',          maliyet: 240, sure: 5, taban: 50,  kat: 1, emsal: true,  izin: ['TARIM'], tekil: true, minSeviye: 5, etki: 'Zeytinden zeytinyağı' },
  CAY_ATOLYESI: { ad: 'Çay atölyesi',   ikon: '🍵', kategori: 'Üretim',            maliyet: 220, sure: 5, taban: 45,  kat: 1, emsal: true,  izin: ['TARIM'], tekil: true, minSeviye: 5, etki: 'Yaş çaydan paket çay' },
};
for (const y of Object.values(YAPILAR)) y.maliyet *= YAPI_OLCEK;   // tablodaki maliyetler v0.49 ölçeğinde yazılı
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
  UN:          { ad: 'Un',             ikon: '🥣', mamul: true, tabanFiyat: 2.2 },
  EKMEK:       { ad: 'Ekmek',          ikon: '🍞', mamul: true, tabanFiyat: 1.6 },
  SALCA:       { ad: 'Domates salçası', ikon: '🥫', mamul: true, tabanFiyat: 4.5 },
  ZEYTINYAGI:  { ad: 'Zeytinyağı',     ikon: '🫗', mamul: true, tabanFiyat: 8.5 },
  PEKMEZ:      { ad: 'Üzüm pekmezi',   ikon: '🍯', mamul: true, tabanFiyat: 6.5 },
  KURU_KAYISI: { ad: 'Gün kurusu kayısı', ikon: '🟠', mamul: true, tabanFiyat: 4.8 },
  KUMAS:       { ad: 'Pamuklu kumaş',  ikon: '🧵', mamul: true, tabanFiyat: 5.5 },
  FINDIK_EZMESI: { ad: 'Fındık ezmesi', ikon: '🫙', mamul: true, tabanFiyat: 7.5 },
  PAKET_CAY:   { ad: 'Paket çay',      ikon: '🫖', mamul: true, tabanFiyat: 4.6 },
  // Hayvansal ürünler ve yem (ekilmez: barınaktan toplanır ya da tesiste üretilir)
  YEM:         { ad: 'Yem',            ikon: '🌽', mamul: true, tabanFiyat: 0.6 },
  YUMURTA:     { ad: 'Yumurta',        ikon: '🥚', mamul: true, hayvansal: true, tabanFiyat: 0.8 },
  SUT:         { ad: 'Süt',            ikon: '🥛', mamul: true, hayvansal: true, tabanFiyat: 1.5 },
  YUN:         { ad: 'Yün',            ikon: '🧶', mamul: true, hayvansal: true, tabanFiyat: 2.2 },
  PEYNIR:      { ad: 'Peynir',         ikon: '🧀', mamul: true, tabanFiyat: 5.5 },
  TEREYAGI:    { ad: 'Tereyağı',       ikon: '🧈', mamul: true, tabanFiyat: 6.2 },
  YUN_IPLIGI:  { ad: 'Yün ipliği',     ikon: '🪢', mamul: true, tabanFiyat: 6 },
  BAL:         { ad: 'Bal',            ikon: '🍯', mamul: true, hayvansal: true, tabanFiyat: 3.2 },
  LOKMA:       { ad: 'Lokma tatlısı',  ikon: '🍩', mamul: true, tabanFiyat: 3.4 },
};
for (const u of Object.values(URUNLER)) if (!u.mamul) u.sureMs = dk(u.sure);

// Üretim zinciri: tesis (ya da tesisler: hangisi varsa) + girdiler → çıktı. Bir tesiste aynı anda tek parti; enerji bedeli akçe (güneş paneli yarıya indirir).
const RECETELER = {
  UN:            { tesis: 'DEGIRMEN', girdi: { BUGDAY: 10 }, cikti: 6, sure: 2, enerji: 4 },
  EKMEK:         { tesis: 'FIRIN',    girdi: { UN: 4 }, cikti: 8, sure: 1, enerji: 3 },
  KURU_KAYISI:   { tesis: 'AMBAR',    girdi: { KAYISI: 6 }, cikti: 4, sure: 3, enerji: 0 },
  SALCA:         { tesis: 'FABRIKA',  girdi: { DOMATES: 10 }, cikti: 4, sure: 2, enerji: 6 },
  ZEYTINYAGI:    { tesis: ['ZEYTIN_SIKMA', 'FABRIKA'], girdi: { ZEYTIN: 8 }, cikti: 3, sure: 3, enerji: 6 },
  PEKMEZ:        { tesis: 'FABRIKA',  girdi: { UZUM: 8 }, cikti: 3, sure: 3, enerji: 5 },
  KUMAS:         { tesis: 'FABRIKA',  girdi: { PAMUK: 6 }, cikti: 3, sure: 3, enerji: 8 },
  FINDIK_EZMESI: { tesis: 'FABRIKA',  girdi: { FINDIK: 6 }, cikti: 3, sure: 2, enerji: 5 },
  PAKET_CAY:     { tesis: ['CAY_ATOLYESI', 'FABRIKA'], girdi: { CAY: 6 }, cikti: 4, sure: 2, enerji: 4 },
  LOKMA:         { tesis: 'FIRIN',    girdi: { UN: 3, BAL: 2 }, cikti: 6, sure: 1, enerji: 2 },
  YEM:           { tesis: 'DEGIRMEN', girdi: { BUGDAY: 4 }, cikti: 8, sure: 1, enerji: 1 },
  PEYNIR:        { tesis: 'MANDIRA',  girdi: { SUT: 6 }, cikti: 3, sure: 2, enerji: 3 },
  TEREYAGI:      { tesis: 'MANDIRA',  girdi: { SUT: 8 }, cikti: 2, sure: 2, enerji: 3 },
  YUN_IPLIGI:    { tesis: 'FABRIKA',  girdi: { YUN: 6 }, cikti: 3, sure: 2, enerji: 4 },
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
// Hayvancılık: barınak yemlenir (yem envanterden düşer; yoksa yem fiyatından satın alınır), süre dolunca ürün toplanır
const HAYVANLAR = {
  KUMES:      { hayvan: 'Tavuk', ikon: '🐔', sayi: 6, urun: 'YUMURTA', miktar: 6, yem: 2, sure: 2 },
  INEK_AHIRI: { hayvan: 'İnek',  ikon: '🐄', sayi: 2, urun: 'SUT',     miktar: 4, yem: 4, sure: 3 },
  AGIL:       { hayvan: 'Koyun', ikon: '🐑', sayi: 5, urun: 'YUN',     miktar: 3, yem: 3, sure: 5 },
  ARI_KOVANI: { hayvan: 'Arı',   ikon: '🐝', sayi: 3, urun: 'BAL',     miktar: 3, yem: 1, sure: 4 },
};
for (const h of Object.values(HAYVANLAR)) h.sureMs = dk(h.sure);
const YEM_FIYATI = 1.2;   // envanterde yem yoksa birim başına

// Oyuncu seviyesi: eylemler tecrübe puanı (TP) kazandırır. Seviye n için toplam TP = 20 × n × (n − 1) × max(1, n / 5):
// ilk beş seviye hızlı (öğrenme), sonrası dikleşir (v0.45 ekonomi simülasyonu: aktif oyuncu 30 günde 38'e çıkıyordu)
// Seviyeyle açılan bölümler (istemcide ACILIMLAR ile aynı); sunucu da denetler
const SEVIYE_KILIDI = { balik: { seviye: 3, ad: 'Balık tutma' }, carsi: { seviye: 4, ad: 'Çarşı' } };
const SEVIYE = {
  tp: { PARCEL_ACQUIRED: 10, CROP_PLANTED: 2, CROP_HARVESTED: 6, STRUCTURE_COMPLETED: 8, PRODUCTION_COLLECTED: 4, ANIMALS_FED: 1,
    ANIMAL_PRODUCE_COLLECTED: 4, PARCEL_VISITED: 1, COMMODITY_TRADE: 2, TRADE_SETTLED: 5, DECORATION_PLACED: 2,
    NEIGHBOR_HELPED: 3, GI_PRODUCED: 5, FISH_CAUGHT: 2, COOP_HELPED: 3 },
  gunlukEylemTavani: 20,   // aynı eylem türünden günde en çok bu kadar TP kaydı (tek tek satarak TP kasılmasın)
  katsayi: 20, dikles: 5, maks: 60,
  seviyeOdulu: (n) => 20 + n * 10,   // her yeni seviyede akçe
};
// Günlük giriş ödülü: art arda gelinen her gün artar (7. günden sonra sabit)
const GUNLUK_ODUL = { akce: [10, 15, 20, 25, 30, 40, 60], tp: 5 };
// Sipariş panosu: köylüler çiftlik ürünleri ister; teslim eden akçe ve TP kazanır
const SIPARIS = {
  acikMaks: 4, yenilemeMs: dk(40), sureMs: dk(24 * 60), reddetBeklemeMs: dk(5),
  primOrani: 1.45, tpCarpani: 1.5, kalemMin: 1, kalemMaks: 3, seviyeKat: 0.15, seviyeTavan: 10,   // sipariş büyüklüğü seviyeyle artar (tavana kadar)
  musteriler: ['Ayşe Teyze', 'Hasan Amca', 'Fadime Nine', 'Bakkal Mehmet', 'Fırıncı Rıza', 'Muhtar Kâzım', 'Öğretmen Zeynep', 'Lokantacı Yusuf',
    'Pazarcı Emine', 'Çoban Ali', 'Kahveci İsmail', 'Doktor Elif'],
};
// Çiftlik süsleri: parselde 3B görünür; seviyeyle açılır; parsel başına en çok 8
const SUSLER = {
  CICEK_TARHI:   { ad: 'Çiçek tarhı',   ikon: '🌷', fiyat: 15, minSeviye: 1 },
  KORKULUK:      { ad: 'Korkuluk',      ikon: '🎃', fiyat: 20, minSeviye: 1 },
  TAS_YOL:       { ad: 'Taş yol',       ikon: '🪨', fiyat: 15, minSeviye: 1 },
  BANK:          { ad: 'Bahçe bankı',   ikon: '🪑', fiyat: 25, minSeviye: 2 },
  KUYU:          { ad: 'Kuyu',          ikon: '🪣', fiyat: 45, minSeviye: 3 },
  ODUN_YIGINI:   { ad: 'Odun yığını',   ikon: '🪵', fiyat: 20, minSeviye: 3 },
  YEL_DEGIRMENI: { ad: 'Yel değirmeni', ikon: '🌬️', fiyat: 120, minSeviye: 5 },
  CESME:         { ad: 'Çeşme',         ikon: '⛲', fiyat: 90, minSeviye: 6 },
  // Etkinlik süsleri: yalnızca etkinlik süresince satın alınır, sonra çiftlikte kalır
  BAYRAK_DIREGI: { ad: 'Bayrak direği', ikon: '🇹🇷', fiyat: 10, minSeviye: 1, etkinlik: 'CUMHURIYET' },
  DILEK_AGACI:   { ad: 'Dilek ağacı',   ikon: '🌳', fiyat: 15, minSeviye: 1, etkinlik: 'HIDIRELLEZ' },
  HASAT_ARABASI: { ad: 'Hasat arabası', ikon: '🛒', fiyat: 25, minSeviye: 1, etkinlik: 'HASAT_SENLIGI' },
  KARDAN_ADAM:   { ad: 'Kardan adam',   ikon: '⛄', fiyat: 10, minSeviye: 1, etkinlik: 'YILBASI' },
};
const SUS_MAKS = 8;

// ---------- Komşuluk: arkadaşlık, tarla yardımı, hediye, ürün gönderme
const KOMSULUK = {
  maxArkadas: 60,
  yardimGunluk: 10, parselYardimGunluk: 3, yardimOdul: 3, yardimKisaltma: 0.1,   // olgunlaşma süresinin %10'u
  hediyeGunlukAlim: 8,
  hediyeArkadaslikMs: 24 * 3600_000,   // hediye en az bu kadar süredir arkadaş olana gider (yeni yan hesaplar değer basmasın)
  hediyeler: [{ urun: 'YEM', adet: 6 }, { urun: 'YEM', adet: 4 }, { urun: 'YUMURTA', adet: 3 }, { akce: 8 }, { akce: 5 }, { urun: 'UN', adet: 2 }],
  gonderimGunlukAdet: 30,
  // Kötüye kullanım sınırları: değer aktaran işlemler (hediye, ürün gönderme) için en düşük seviye; istek sınırları
  gonderimMinSeviye: 3, istekGunluk: 20, istekTekrarMs: 7 * 24 * 3600_000,
};

// ---------- Coğrafi işaretli (yöresel) ürünler: yalnızca o ilde parseli olan üretir (günde bir parti),
// koleksiyona eklenir ya da borsada başka illerin oyuncularıyla takas edilir. Bölge = coğrafi bölge (albüm sayfası).
const YORESEL = {
  MALATYA_KAYISISI:  { ad: 'Malatya kayısısı',      ikon: '🍑', il: '44', bolge: 'Doğu Anadolu',     girdi: { KAYISI: 4 } },
  ERZINCAN_TULUMU:   { ad: 'Erzincan tulum peyniri', ikon: '🧀', il: '24', bolge: 'Doğu Anadolu',     girdi: { SUT: 5 } },
  KARS_KASARI:       { ad: 'Kars kaşarı',           ikon: '🧀', il: '36', bolge: 'Doğu Anadolu',     girdi: { SUT: 6 } },
  VAN_OTLU_PEYNIRI:  { ad: 'Van otlu peyniri',      ikon: '🧀', il: '65', bolge: 'Doğu Anadolu',     girdi: { SUT: 5 } },
  ANTEP_FISTIGI:     { ad: 'Antep fıstığı',         ikon: '🥜', il: '27', bolge: 'Güneydoğu Anadolu', akce: 30 },
  SIIRT_FISTIGI:     { ad: 'Siirt fıstığı',         ikon: '🥜', il: '56', bolge: 'Güneydoğu Anadolu', akce: 30 },
  MARDIN_SABUNU:     { ad: 'Mardin bıttım sabunu',  ikon: '🧼', il: '47', bolge: 'Güneydoğu Anadolu', akce: 25 },
  GIRESUN_FINDIGI:   { ad: 'Giresun fındığı',       ikon: '🌰', il: '28', bolge: 'Karadeniz',        girdi: { FINDIK: 4 } },
  RIZE_CAYI:         { ad: 'Rize çayı',             ikon: '🍃', il: '53', bolge: 'Karadeniz',        girdi: { CAY: 4 } },
  AMASYA_ELMASI:     { ad: 'Amasya elması',         ikon: '🍎', il: '05', bolge: 'Karadeniz',        girdi: { ELMA: 4 } },
  TOKAT_YAPRAGI:     { ad: 'Tokat yaprağı',         ikon: '🍃', il: '60', bolge: 'Karadeniz',        girdi: { UZUM: 3 } },
  SAFRANBOLU_SAFRANI:{ ad: 'Safranbolu safranı',    ikon: '🌼', il: '78', bolge: 'Karadeniz',        akce: 40 },
  TASKOPRU_SARIMSAGI:{ ad: 'Taşköprü sarımsağı',    ikon: '🧄', il: '37', bolge: 'Karadeniz',        akce: 15 },
  KAYSERI_PASTIRMASI:{ ad: 'Kayseri pastırması',    ikon: '🥩', il: '38', bolge: 'İç Anadolu',        akce: 35 },
  KONYA_ETLI_EKMEK:  { ad: 'Konya etli ekmeği',     ikon: '🫓', il: '42', bolge: 'İç Anadolu',        girdi: { UN: 2 } },
  AFYON_KAYMAGI:     { ad: 'Afyon kaymağı',         ikon: '🥛', il: '03', bolge: 'Ege',              girdi: { SUT: 4 } },
  AYDIN_INCIRI:      { ad: 'Aydın inciri',          ikon: '🟤', il: '09', bolge: 'Ege',              akce: 25 },
  MANISA_MESIRI:     { ad: 'Manisa mesir macunu',   ikon: '🍯', il: '45', bolge: 'Ege',              akce: 30 },
  BURSA_SEFTALISI:   { ad: 'Bursa şeftalisi',       ikon: '🍑', il: '16', bolge: 'Marmara',          akce: 20 },
  EZINE_PEYNIRI:     { ad: 'Ezine peyniri',         ikon: '🧀', il: '17', bolge: 'Marmara',          girdi: { SUT: 5 } },
  EDIRNE_PEYNIRI:    { ad: 'Edirne beyaz peyniri',  ikon: '🧀', il: '22', bolge: 'Marmara',          girdi: { SUT: 4 } },
  FINIKE_PORTAKALI:  { ad: 'Finike portakalı',      ikon: '🍊', il: '07', bolge: 'Akdeniz',          akce: 20 },
  HATAY_KUNEFESI:    { ad: 'Hatay künefesi',        ikon: '🍮', il: '31', bolge: 'Akdeniz',          girdi: { UN: 2 }, akce: 10 },
  ISPARTA_GULU:      { ad: 'Isparta gülü',          ikon: '🌹', il: '32', bolge: 'Akdeniz',          akce: 25 },
  ADANA_KEBABI:      { ad: 'Adana kebabı',          ikon: '🍢', il: '01', bolge: 'Akdeniz',          akce: 30 },
};
const YORESEL_KURAL = { partiCikti: 2, albumOdul: 15, albumTp: 10, bolgeOdul: 100, tabanFiyat: 9 };

// ---------- Balık tutma (mini oyun): göl, nehir ya da kıyıda olta atılır; ısırınca zamanında çekilirse balık tutulur
const BALIK = {
  gunlukAtis: 20, isirma: [2000, 6500], pencere: 900, tolerans: 450, altinOran: 0.02, altinOdul: 50,
  // Çekince balık oltaya takılır, ardından mücadele: oyuncu makarayı sarar. Sunucu en kısa mücadele süresini ister
  // (taban + güç × adım ms) ve süre aşımında balık kaçar. Mücadelenin kendisi istemcide oynanır.
  mucadele: { tabanMs: 900, gucMs: 500, maksMs: 60_000 },
  // Olta takımı: yem (türe göre çekicilik, kimi ücretli), derinlik (türün sevdiği su katmanı), misina (ince: daha çok ısırır ama
  // kolay kopar; kalın: dayanıklı ama balık ürker). Uygun yem ve derinlik balığın daha çabuk ısırmasını sağlar.
  yemler: {
    SOLUCAN: { ad: 'Solucan', ikon: '🪱', fiyat: 0 }, MISIR: { ad: 'Mısır', ikon: '🌽', fiyat: 1 },
    KARIDES: { ad: 'Karides', ikon: '🦐', fiyat: 3 }, SAHTE: { ad: 'Sahte yem', ikon: '🐟', fiyat: 5 },
  },
  derinlikler: { SIG: { ad: 'Sığ', m: 1 }, ORTA: { ad: 'Orta', m: 3 }, DERIN: { ad: 'Derin', m: 6 } },
  misinalar: {
    INCE: { ad: 'İnce 0,18 mm', isirma: 0.8, dayanim: 0.86 }, ORTA: { ad: 'Orta 0,25 mm', isirma: 1, dayanim: 1 },
    KALIN: { ad: 'Kalın 0,35 mm', isirma: 1.3, dayanim: 1.22 },
  },
  // Balık aktivitesi: ilin gerçek saati ve havası ısırma süresini çarpar (küçük = daha çabuk ısırır)
  aktivite: { safak: 0.7, aksam: 0.75, ogle: 1.15, gece: 1.3, bulutlu: 0.85, yagmur: 0.8, firtina: 1.45, ruzgar: 1.2, asiriSicaklik: 1.2,
    min: 1500, maks: 15000 },
  // guc: 1 (kolay) … 5 (çok güçlü); kg: ağırlık aralığı; davranis: mücadele biçimi (inatci: ağır ve sürekli çeker,
  // kacak: ani uzun kaçışlar, sicrayan: sudan sıçrar, surucu: hafif ve çevik); yem/derinlik: tercih çarpanları
  turler: {
    HAMSI: { ad: 'Hamsi', ikon: '🐟', tabanFiyat: 1.2, guc: 1, kg: [0.02, 0.06], davranis: 'surucu',
      yem: { SOLUCAN: 0.8, MISIR: 0.3, KARIDES: 1.3, SAHTE: 1 }, derinlik: { SIG: 1.5, ORTA: 1, DERIN: 0.4 } },
    LUFER: { ad: 'Lüfer', ikon: '🐟', tabanFiyat: 3.2, guc: 4, kg: [0.4, 2.8], davranis: 'kacak',
      yem: { SOLUCAN: 0.4, MISIR: 0.1, KARIDES: 1.2, SAHTE: 2 }, derinlik: { SIG: 1, ORTA: 1.4, DERIN: 0.7 } },
    CIPURA: { ad: 'Çipura', ikon: '🐠', tabanFiyat: 2.6, guc: 3, kg: [0.3, 1.8], davranis: 'inatci',
      yem: { SOLUCAN: 1.2, MISIR: 0.3, KARIDES: 1.8, SAHTE: 0.3 }, derinlik: { SIG: 0.6, ORTA: 1.2, DERIN: 1.3 } },
    LEVREK: { ad: 'Levrek', ikon: '🐟', tabanFiyat: 2.8, guc: 3, kg: [0.4, 3.5], davranis: 'sicrayan',
      yem: { SOLUCAN: 0.8, MISIR: 0.2, KARIDES: 1.5, SAHTE: 1.8 }, derinlik: { SIG: 1.2, ORTA: 1.2, DERIN: 0.7 } },
    SAZAN: { ad: 'Sazan', ikon: '🐟', tabanFiyat: 1.4, guc: 2, kg: [0.8, 6], davranis: 'inatci',
      yem: { SOLUCAN: 1.2, MISIR: 2.2, KARIDES: 0.4, SAHTE: 0.2 }, derinlik: { SIG: 0.5, ORTA: 1, DERIN: 1.6 } },
    ALABALIK: { ad: 'Alabalık', ikon: '🐟', tabanFiyat: 2.4, guc: 3, kg: [0.3, 2.2], davranis: 'sicrayan',
      yem: { SOLUCAN: 1.4, MISIR: 0.8, KARIDES: 0.5, SAHTE: 1.6 }, derinlik: { SIG: 1.3, ORTA: 1.1, DERIN: 0.6 } },
    INCI_KEFALI: { ad: 'İnci kefali', ikon: '🐟', tabanFiyat: 2, guc: 1, kg: [0.05, 0.3], davranis: 'surucu',
      yem: { SOLUCAN: 1.3, MISIR: 1, KARIDES: 0.8, SAHTE: 0.5 }, derinlik: { SIG: 1.3, ORTA: 1, DERIN: 0.6 } },
    ALTIN_BALIK: { ad: 'Altın balık', ikon: '🐡', tabanFiyat: 12, nadir: true, guc: 5, kg: [0.5, 1.5], davranis: 'kacak',
      yem: { SOLUCAN: 1, MISIR: 1, KARIDES: 1, SAHTE: 1 }, derinlik: { SIG: 1, ORTA: 1, DERIN: 1 } },
  },
  // Kıyı bölgeleri (plaka): denizde tutulan tür
  deniz: {
    KARADENIZ: { iller: ['39', '22', '34', '41', '81', '67', '74', '78', '37', '57', '55', '52', '28', '61', '53', '08'], turler: { HAMSI: 0.7, LUFER: 0.3 } },
    MARMARA: { iller: ['59', '10', '16', '77', '17'], turler: { LUFER: 0.5, LEVREK: 0.3, HAMSI: 0.2 } },
    EGE: { iller: ['35', '09', '48', '45'], turler: { CIPURA: 0.55, LEVREK: 0.45 } },
    AKDENIZ: { iller: ['07', '33', '01', '31', '80'], turler: { LEVREK: 0.5, CIPURA: 0.5 } },
  },
};
// ---------- Çarşı: gerçek hayattaki gibi banka, nalbur, market, zirai bayi. Her türden oyunda TEK işletme vardır; sponsorluk
// anlaşması yapılınca yönetim panelinden markanın adı, logosu ve renkleri girilir (sözleşme bitince varsayılana döner).
// Ürünler envantere girer, NPC tüccara satılmaz, bozulmaz. "kalici" ürün elde oldukça etkisini sürdürür.
const CARSI = {
  kategoriler: {
    BANKA:  { tur: 'Banka', ad: 'Sanal Banka', ikon: '🏦', renk: '#0b5e8c', renk2: '#e6f2fa', slogan: 'Paran güvende, çiftliğin büyüsün' },
    NALBUR: { tur: 'Nalbur / hırdavat', ad: 'Usta Nalbur', ikon: '🔨', renk: '#a5492a', renk2: '#fbeee6', slogan: 'Çividen kamışa her şey' },
    MARKET: { tur: 'Market', ad: 'Mahalle Market', ikon: '🛒', renk: '#2f8a3c', renk2: '#eaf6ec', slogan: 'Taze, ucuz, yakın' },
    ZIRAI:  { tur: 'Zirai bayi ve veteriner', ad: 'Bereket Zirai Bayi', ikon: '🌱', renk: '#5f7d1f', renk2: '#f1f6e4', slogan: 'Bol hasat, sağlıklı sürü' },
  },
  urunler: {
    KALIP_SETI:   { dukkan: 'NALBUR', ad: 'Kalıp ve iskele seti', ikon: '🧱', fiyat: 40, etki: 'Bir sonraki inşaat %30 kısa sürer (3 dakikadan uzun inşaatta kendiliğinden kullanılır)' },
    BAKIM_KITI:   { dukkan: 'NALBUR', ad: 'Bakım kiti', ikon: '🧰', fiyat: 25, etki: 'Bir parseldeki yapıların bakımı ücretsiz (bakımda kendiliğinden kullanılır)' },
    TARLA_ORTUSU: { dukkan: 'NALBUR', ad: 'Tarla örtüsü', ikon: '⛺', fiyat: 10, etki: 'Örtü sermek ücretsiz (örtü serince kendiliğinden kullanılır)' },
    KARBON_KAMIS: { dukkan: 'NALBUR', ad: 'Karbon kamış', ikon: '🎣', fiyat: 120, kalici: true, etki: 'Balık mücadelesinde makara %20 hızlı sarar (kalıcı)' },
    ORGU_MISINA:  { dukkan: 'NALBUR', ad: 'Örgü misina', ikon: '🧵', fiyat: 80, kalici: true, etki: 'Misina dayanımı +%12 (kalıcı)' },
    SAHTE_YEM_TAKIMI: { dukkan: 'NALBUR', ad: 'Sahte yem (rapala)', ikon: '🐟', fiyat: 30, kalici: true, etki: 'Sahte yemle atış ücretsiz; misina koparsa sahte yem kaybolur' },
    YEM_PAKETI:   { dukkan: 'MARKET', ad: 'Hayvan yemi (20 çuval)', ikon: '🌽', fiyat: 20, verir: { YEM: 20 }, etki: 'Besleme başına ödenen yem fiyatından %17 ucuz' },
    KARIDES_PAKETI: { dukkan: 'MARKET', ad: 'Karides yem (10 atış)', ikon: '🦐', fiyat: 25, verir: { YEM_KARIDES: 10 }, etki: 'Atış başına ₺750 (tek tek ₺900)' },
    MISIR_PAKETI: { dukkan: 'MARKET', ad: 'Mısır yem (10 atış)', ikon: '🌽', fiyat: 8, verir: { YEM_MISIR: 10 }, etki: 'Atış başına ₺240 (tek tek ₺300)' },
    GUBRE:        { dukkan: 'ZIRAI', ad: 'Gübre', ikon: '🧪', fiyat: 12, kullan: 'EKIN', etki: 'Ekili tarlaya ver: hasat %20 fazla' },
    ILAC:         { dukkan: 'ZIRAI', ad: 'Bitki koruma ilacı', ikon: '🛡️', fiyat: 15, kullan: 'EKIN', etki: 'Ekili tarlaya ver: ekin olgunlaşana kadar don, dolu ve sağanaktan korunur' },
    ASI:          { dukkan: 'ZIRAI', ad: 'Hayvan aşısı', ikon: '💉', fiyat: 20, kullan: 'BARINAK', etki: 'Barınağa uygula: 7 gün boyunca her toplamada +1 ürün' },
  },
  // Pakette gelen sarf malzemeleri (envanterde görünür, yalnızca oyunda kullanılır)
  sarf: { YEM_KARIDES: { ad: 'Karides yem', ikon: '🦐' }, YEM_MISIR: { ad: 'Mısır yem', ikon: '🌽' } },
  etki: { kalipKisalma: 0.3, gubreBonus: 0.2, asiSureMs: 7 * 24 * 3600 * 1000, asiEk: 1, kamisSarma: 1.2, misinaDayanim: 0.12 },
  // Banka: yalnızca vadeli hesap (kredi v0.41'de kaldırıldı: değer aktarma açıkları üretiyordu). Akçe nakde çevrilemez;
  // gerçek bankacılık hizmeti değildir. Faiz oyun içi ödüldür (basılır), üst sınırlıdır.
  banka: { vadeliGun: 7, vadeliFaiz: 0.025, vadeliMin: 50, vadeliMaks: 10000 },
  logoMaksBayt: 150_000,
};
for (const [kod, u] of Object.entries(CARSI.urunler)) URUNLER[kod] = { ad: u.ad, ikon: u.ikon, mamul: true, dukkan: u.dukkan, tabanFiyat: Math.round(u.fiyat * 0.5 * 100) / 100 };
for (const [kod, u] of Object.entries(CARSI.sarf)) URUNLER[kod] = { ad: u.ad, ikon: u.ikon, mamul: true, dukkan: 'MARKET', sarf: true, tabanFiyat: 1 };
for (const [kod, b] of Object.entries(BALIK.turler)) URUNLER[kod] = { ad: b.ad, ikon: b.ikon, tabanFiyat: b.tabanFiyat, nadir: b.nadir, mamul: true, balik: true };
for (const [kod, y] of Object.entries(YORESEL)) URUNLER[kod] = { ad: y.ad, ikon: y.ikon, mamul: true, yoresel: y.il, tabanFiyat: YORESEL_KURAL.tabanFiyat };

// ---------- Köy meydanı (koy-meydani.js): oyuncunun kendi köy meydanına kurduğu topluluk binaları. Her bina bir kez
// kurulur, oyuncu seviyesiyle açılır, akçe ve çiftlik ürünüyle yapılır; bitince kalıcı bonus verir (oran: çarpan, ek: adet).
const KOY_MEYDANI = {
  CESME:        { ad: 'Köy çeşmesi', ikon: '⛲', seviye: 2, akce: 150, malzeme: { BUGDAY: 20 }, sureMs: dk(10), etki: 'Sulama %20 daha ucuz', oran: 0.8 },
  KAHVEHANE:    { ad: 'Kahvehane', ikon: '☕', seviye: 3, akce: 300, malzeme: { BUGDAY: 30, DOMATES: 20 }, sureMs: dk(20), etki: 'Sipariş ödülleri %10 fazla', oran: 1.1 },
  PAZAR_YERI:   { ad: 'Köy pazarı', ikon: '🧺', seviye: 4, akce: 450, malzeme: { DOMATES: 30, ELMA: 20 }, sureMs: dk(30), etki: 'Tüccara satış %5 fazla getirir', oran: 1.05 },
  OKUL:         { ad: 'Köy okulu', ikon: '🏫', seviye: 5, akce: 650, malzeme: { ELMA: 30, UN: 10 }, sureMs: dk(45), etki: 'Tecrübe puanı (TP) %10 fazla', oran: 1.1 },
  SAGLIK_OCAGI: { ad: 'Sağlık ocağı', ikon: '🏥', seviye: 6, akce: 850, malzeme: { UN: 20, YUMURTA: 20 }, sureMs: dk(60), etki: 'Yapı bakımı %25 daha ucuz', oran: 0.75 },
  KUTUPHANE:    { ad: 'Halk kütüphanesi', ikon: '📚', seviye: 7, akce: 1050, malzeme: { EKMEK: 15, SUT: 20 }, sureMs: dk(90), etki: 'Günlük görev ödülü %20 fazla', oran: 1.2 },
  PTT:          { ad: 'Postane', ikon: '📮', seviye: 8, akce: 1300, malzeme: { EKMEK: 20, PEYNIR: 10 }, sureMs: dk(120), etki: 'Sipariş panosuna +1 müşteri', ek: 1 },
};

// ---------- Günlük sandık (sandik.js): her aralikMs'de bir ücretsiz sandık. İçerik rastgeledir; oranlar oyuncuya açıkça
// gösterilir (parayla satılmaz, şans kutusu değildir).
const GUNLUK_SANDIK = {
  aralikMs: 8 * 3600_000, biriktir: 2,   // en çok 2 sandık birikir (seyrek giren oyuncu kaybetmesin)
  icerik: [
    { tur: 'akce', min: 15, max: 35, oran: 0.6 },
    { tur: 'esya', kod: 'GUBRE', adet: 1, oran: 0.2 },
    { tur: 'esya', kod: 'YEM', adet: 15, oran: 0.15 },
    { tur: 'esya', kod: 'KALIP_SETI', adet: 1, oran: 0.05 },
  ],
};
// ---------- Mini etkinlikler (mini-etkinlik.js): her hafta sonu (Türkiye saatiyle cuma–pazar) sırayla bir kısa etkinlik.
// Şablonlar tekrar tekrar kullanılır; etkiler oyunun ilgili yerlerinde okunur (TP, tüccar, ekin büyümesi, olta hakkı).
const MINI_ETKINLIK = {
  gunler: [5, 6, 0],   // cuma, cumartesi, pazar
  sablonlar: [
    { kod: 'CIFT_TP', ad: 'Bereket hafta sonu', ikon: '⭐', aciklama: 'Bütün işler 2 kat TP kazandırır', tpKat: 2 },
    { kod: 'TUCCAR', ad: 'Pazar şenliği', ikon: '🧺', aciklama: 'Tüccar ürünlerine %20 fazla öder', tuccarKat: 1.2 },
    { kod: 'BOLLUK', ad: 'Bolluk günleri', ikon: '🌱', aciklama: 'Yeni ekilen ekinler %25 daha çabuk olgunlaşır', buyumeKat: 0.75 },
    { kod: 'BALIK', ad: 'Balık bolluğu', ikon: '🎣', aciklama: 'Günlük olta hakkı +10', balikEk: 10 },
  ],
};

// ---------- Haftalık arazi ihalesi (ihale.js): her hafta sıradaki yöre setinin illerinde (il merkezine yakın) birer boş
// tarla açık artırmaya çıkar. Taban, olağan tahsis bedelinin tabanOrani'dır; teklifler emanette tutulur, geçilen teklif
// iade edilir; en az artis kadar yükseltilir. Pazar günü TR 21.00'de biter; kazanan parseli olağan tahsisle alır.
const IHALE = { adet: 3, tabanOrani: 0.7, artis: 0.05, bitisOncesiMs: 6 * 3600_000 };
// Fiyat alarmı (alarm.js): mahalle endeksi hedefe ulaşınca bildirim; oyuncu başına en çok maks açık alarm
const FIYAT_ALARMI = { maks: 5 };

// ---------- Yöre setleri (koleksiyon.js): bir setin her ilinde en az bir parselin varsa set tamamdır; tamam olduğu sürece
// o illerdeki tarlalarının hasadı hasatBonus kadar artar. Set ilk kez tamamlanınca bir kerelik ödül ve rozet. Hesap başına
// 8 parsel sınırı (HESAP.maxParsel) yüzünden hangi seti kovalayacağın bir yatırım kararıdır.
const KOLEKSIYON = {
  hasatBonus: 0.1, odul: 120,
  setler: {
    KAPADOKYA: { ad: 'Kapadokya', ikon: '🎈', iller: ['50', '38', '51'] },
    KARADENIZ: { ad: 'Çay ve fındık kıyısı', ikon: '🍃', iller: ['53', '61', '28'] },
    EGE: { ad: 'Ege zeytinliği', ikon: '🫒', iller: ['35', '09', '48'] },
    CUKUROVA: { ad: 'Çukurova', ikon: '☁️', iller: ['01', '33', '80'] },
    TAHIL: { ad: 'Tahıl ambarı', ikon: '🌾', iller: ['42', '70', '03'] },
    BEREKETLI_HILAL: { ad: 'Bereketli Hilal', ikon: '🌶️', iller: ['63', '21', '47'] },
    TRAKYA: { ad: 'Trakya', ikon: '🌻', iller: ['22', '39', '59'] },
    KAYISI: { ad: 'Kayısı yolu', ikon: '🍑', iller: ['44', '23', '02'] },
    YAYLA: { ad: 'Doğu yaylaları', ikon: '🐄', iller: ['25', '36', '75'] },
    MARMARA: { ad: 'Marmara bahçeleri', ikon: '🍐', iller: ['16', '54', '77'] },
    GOLLER: { ad: 'Göller yöresi', ikon: '🌹', iller: ['32', '15', '07'] },
  },
};

// Kaldırılan siyaset bölümünün (seçim, belediye, referandum, görevden alma; v0.47) denetim kaydı eylemleri: eski kayıtlar
// silinemez (audit_events), haber akışında gösterilmez
const SIYASI_EYLEMLER = ['ELECTION_ANNOUNCED', 'CANDIDACY_OPENED', 'CANDIDATE_REGISTERED', 'CANDIDATE_WITHDRAWN', 'CAMPAIGN_STARTED', 'VOTING_OPENED',
  'VOTING_CLOSED', 'VOTE_CAST', 'OBJECTION_FILED', 'ELECTION_CLOSED', 'ELECTION_ANNULLED', 'ELECTION_NO_CANDIDATE', 'OFFICE_VACATED', 'PROMISE_UPDATED',
  'PROJECT_PROPOSED', 'COUNCIL_VOTE', 'PROJECT_APPROVED', 'PROJECT_REJECTED', 'PROJECT_COMPLETED', 'MUHTAR_REQUEST', 'MUHTAR_ANNOUNCEMENT', 'REQUEST_CLOSED',
  'RECALL_STARTED', 'RECALL_SIGNED', 'RECALL_FAILED', 'RECALL_SUCCEEDED', 'REFERENDUM_PROPOSED', 'REFERENDUM_OPENED', 'REFERENDUM_VOTE', 'REFERENDUM_CLOSED'];

// ---------- Motif bulmacası (bulmaca.js): Türk motifli taşlarla 3'lü eşleştirme. Bölümler sırayla açılır; bölüm
// tanımı (tahta, hamle, hedefler, ot kaplı kareler) bölüm numarasından türetilir. Oyun istemcide oynanır; sunucu en kısa
// süreyi (taban + kullanılan hamle × hamleMs) ve hamle sınırını denetler. Günde en çok gunlukOdul bölüm ödül verir.
const BULMACA = {
  gunlukOdul: 5, minSureMs: 12_000, hamleMs: 450, maksSureMs: 45 * 60_000,
  hamleBasinaAzami: 15,   // bir hamlede toplanabilecek hedef taşın makul üst sınırı (en az hamle denetimi; bulmaca.js)
  satir: 8, sutun: 7,
  taslar: { NAR: 'Nar', LALE: 'Lale', CINI: 'Çini', BUGDAY: 'Başak', NAZAR: 'Nazar', FINDIK: 'Fındık' },
  // Bölüm ödülü: her 10. bölüm kalıp seti (inşaatı hızlandırır), her 5. gübre, kalanlar akçe; yıldız başına +2 akçe
  odul(n) {
    if (n % 10 === 0) return { akce: 30 + Math.min(n, 30), esya: ['KALIP_SETI', 1] };
    if (n % 5 === 0) return { akce: 15 + Math.min(Math.floor(n / 2), 10), esya: ['GUBRE', 2] };
    return { akce: Math.min(20, 8 + Math.floor(n / 2)) };
  },
  yildizAkce: 2,
};

// ---------- Sezon yolu (mevsim-yolu.js): her mevsim ücretsiz, 30 kademeli ödül yolu. Oyun eylemleri "yol puanı" verir;
// aynı eylem türünden günde en çok gunlukTavan kayıt sayılır. n. kademenin bedeli taban + artis × n puandır.
const MEVSIM_YOLU = {
  kademe: 30, taban: 40, artis: 6, gunlukTavan: 15,
  puanlar: { DAILY_QUESTS_REWARDED: 20, ORDER_DELIVERED: 10, STRUCTURE_COMPLETED: 6, GI_PRODUCED: 5, CROP_HARVESTED: 4,
    PRODUCTION_COLLECTED: 4, ANIMAL_PRODUCE_COLLECTED: 4, NEIGHBOR_HELPED: 4, FISH_CAUGHT: 2, TRADE_SETTLED: 2, DECORATION_PLACED: 2,
    CROP_PLANTED: 1, PARCEL_VISITED: 1, PUZZLE_WON: 3, COOP_HELPED: 3 },
  eylemAdi: { DAILY_QUESTS_REWARDED: 'Günlük görevleri bitir', ORDER_DELIVERED: 'Sipariş teslim et', STRUCTURE_COMPLETED: 'Yapı tamamla',
    GI_PRODUCED: 'Yöresel ürün üret', CROP_HARVESTED: 'Hasat et', PRODUCTION_COLLECTED: 'Üretim topla', ANIMAL_PRODUCE_COLLECTED: 'Hayvan ürünü topla',
    NEIGHBOR_HELPED: 'Komşuya yardım et', FISH_CAUGHT: 'Balık tut', TRADE_SETTLED: 'Tüccara sat', DECORATION_PLACED: 'Süs koy',
    CROP_PLANTED: 'Ek', PARCEL_VISITED: 'Komşu ziyaret et', PUZZLE_WON: 'Motif bulmacası bölümü geç', COOP_HELPED: 'Kooperatif isteğine ürün gönder' },
  // Kademe ödülü: her 5. kademe büyük (eşya/kozmetik), 3. ve 8. sıradakiler eşya, kalanlar akçe
  odul(n) {
    const ozel = { 5: { esya: ['KALIP_SETI', 2], akce: 40 }, 10: { kozmetik: 'BAYRAK_YOLCU', akce: 60 }, 15: { esya: ['BAKIM_KITI', 3], akce: 100 },
      20: { kozmetik: 'CATI_BAKIR', akce: 120 }, 25: { esya: ['TARLA_ORTUSU', 5], akce: 150 }, 30: { kozmetik: 'UNVAN_YOLCU', akce: 300 } };
    if (ozel[n]) return ozel[n];
    if (n % 5 === 3) return { esya: ['YEM', 20], akce: 10 };
    return { akce: 10 + 2 * n };
  },
};

// ---------- Mevsimlik etkinlikler (her yıl aynı günler, AA-GG; bitiş dahil). Görev ilerlemesi denetim kaydından sayılır.
const ETKINLIKLER = {
  CUMHURIYET: { ad: 'Cumhuriyet Bayramı', ikon: '🇹🇷', bas: '10-20', bit: '11-02', renk: '#c8102e',
    aciklama: 'Cumhuriyetimizin yıl dönümünü çiftlikte kutla: görevleri tamamla, bayrak direğini dik.',
    gorevler: [{ ad: '10 hasat yap', eylem: 'CROP_HARVESTED', hedef: 10, odul: 50, tp: 15 },
      { ad: '5 sipariş teslim et', eylem: 'ORDER_DELIVERED', hedef: 5, odul: 60, tp: 20 },
      { ad: 'Çiftliğine bir süs yerleştir', eylem: 'DECORATION_PLACED', hedef: 1, odul: 20, tp: 5 }],
    ortak: { ad: 'Türkiye genelinde 1923 sipariş teslimi', eylem: 'ORDER_DELIVERED', hedef: 1923, odul: 100 },
    sus: 'BAYRAK_DIREGI' },
  HIDIRELLEZ: { ad: 'Hıdırellez', ikon: '🌹', bas: '05-04', bit: '05-08', renk: '#d94b6a',
    aciklama: 'Baharın gelişi: tohum ek, komşuna yardım et, dilek ağacına dileğini as.',
    gorevler: [{ ad: '6 tarlaya tohum ek', eylem: 'CROP_PLANTED', hedef: 6, odul: 40, tp: 10 },
      { ad: '3 komşuya yardım et', eylem: 'NEIGHBOR_HELPED', hedef: 3, odul: 40, tp: 10 }],
    ortak: { ad: 'Türkiye genelinde 5000 ekim', eylem: 'CROP_PLANTED', hedef: 5000, odul: 80 },
    sus: 'DILEK_AGACI' },
  CIFTCILER_GUNU: { ad: 'Dünya Çiftçiler Günü', ikon: '🧑‍🌾', bas: '05-12', bit: '05-16', renk: '#5d9e34',
    aciklama: '14 Mayıs: çiftçilerin emeğine selam olsun.',
    gorevler: [{ ad: '15 hasat yap', eylem: 'CROP_HARVESTED', hedef: 15, odul: 60, tp: 15 },
      { ad: 'Hayvanlarını 5 kez yemle', eylem: 'ANIMALS_FED', hedef: 5, odul: 40, tp: 10 }],
    ortak: { ad: 'Türkiye genelinde 10.000 hasat', eylem: 'CROP_HARVESTED', hedef: 10000, odul: 80 } },
  HASAT_SENLIGI: { ad: 'Hasat Şenliği', ikon: '🌾', bas: '09-10', bit: '09-24', renk: '#d9a531',
    aciklama: 'Bereketli hasat zamanı: ambarları doldur, yöresel ürünlerini üret.',
    gorevler: [{ ad: '20 hasat yap', eylem: 'CROP_HARVESTED', hedef: 20, odul: 70, tp: 20 },
      { ad: '3 yöresel ürün partisi üret', eylem: 'GI_PRODUCED', hedef: 3, odul: 50, tp: 15 }],
    ortak: { ad: 'Türkiye genelinde 20.000 hasat', eylem: 'CROP_HARVESTED', hedef: 20000, odul: 100 },
    sus: 'HASAT_ARABASI' },
  YILBASI: { ad: 'Yeni Yıl', ikon: '⛄', bas: '12-26', bit: '01-02', renk: '#3d8fdb',
    aciklama: 'Komşularına hediye gönder, yeni yıla bereketle gir.',
    gorevler: [{ ad: '5 hediye gönder', eylem: 'GIFT_SENT', hedef: 5, odul: 40, tp: 10 },
      { ad: '5 sipariş teslim et', eylem: 'ORDER_DELIVERED', hedef: 5, odul: 60, tp: 20 }],
    ortak: { ad: 'Türkiye genelinde 3000 hediye', eylem: 'GIFT_SENT', hedef: 3000, odul: 80 },
    sus: 'KARDAN_ADAM' },
};

// Hatırlatmalar (geri çağıran bildirimler): sessiz saatlerde gönderilmez, aynı olay için bir kez
const HATIRLATMA = { aralikMs: 60_000, sessiz: [23, 8], siparisUyariMs: 3600_000 };

const KOOPERATIF = { kurulusBedeli: 100, maxUye: 12, minAktifUye: 3, satisPrimi: 0.06, adMin: 3, adMax: 40 };
// İmece (imece.js): iki komşunun haftalık ortak hedefi. İkisinin işleri ortak puana yazar (aynı işten günde en çok
// gunlukTavan); ortak puan kademe eşiğini geçince en az minKatki puan katan ortak kademe ödülünü alır. Pasif ortak
// bırakılabilir; haftada en çok haftalikOrtak ortaklık kurulur (ödül için ortak değiştirip durmak olmasın).
const IMECE = {
  puanlar: { ORDER_DELIVERED: 12, DAILY_QUESTS_REWARDED: 15, CROP_HARVESTED: 5, PRODUCTION_COLLECTED: 5, ANIMAL_PRODUCE_COLLECTED: 5,
    GI_PRODUCED: 8, NEIGHBOR_HELPED: 4, COOP_HELPED: 4, PUZZLE_WON: 3, FISH_CAUGHT: 2 },
  gunlukTavan: 15, minKatki: 30, haftalikOrtak: 2, davetSuresiMs: 24 * 3600_000,
  kademeler: [{ esik: 150, akce: 30 }, { esik: 400, akce: 60, esya: ['GUBRE', 2] }, { esik: 800, akce: 120, esya: ['KALIP_SETI', 1] }],
};
// Kooperatif yardım istekleri (yardim.js): üye "şu üründen şu kadar lazım" der, diğer üyeler envanterinden gönderir.
// Yardım eden TP, yol puanı ve yarış puanı kazanır (COOP_HELPED); akçe aktarılmaz. Değer aktarmayı sınırlamak için tek
// istekte en çok maksAdet, üye başına tek açık istek ve istekler arasında bekleme; yardım eden günde en çok gunlukYardim kez.
const YARDIM = { maksAdet: 20, sureMs: 12 * 3600_000, beklemeMs: 4 * 3600_000, gunlukYardim: 5 };
// Kooperatif hasat yarışı (hasat-yarisi.js): haftalık takım yarışı. Üyelerin işleri takım puanına eklenir (aynı işten
// günde en çok gunlukTavan kayıt). Takım sandıkları hafta sonunda en az minKatki puan veren üyelere dağıtılır; Türkiye
// sıralamasında ilk üç (en az minAktifUye üyeli) kooperatifin ortak kasasına bonus girer.
const HASAT_YARISI = {
  puanlar: { ORDER_DELIVERED: 12, DAILY_QUESTS_REWARDED: 15, GI_PRODUCED: 8, CROP_HARVESTED: 5, PRODUCTION_COLLECTED: 5,
    ANIMAL_PRODUCE_COLLECTED: 5, NEIGHBOR_HELPED: 3, COOP_HELPED: 4 },
  gunlukTavan: 15,
  sandiklar: [{ esik: 300, odul: 30, ad: 'Bakır sandık' }, { esik: 800, odul: 60, ad: 'Gümüş sandık' }, { esik: 1500, odul: 120, ad: 'Altın sandık' }],
  minKatki: 30,
  kasaBonusu: [500, 300, 150],
  ilOdulu: [40, 25, 15],   // il sıralamasında ilk üç ilin en az minKatki veren oyuncularına
};


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
  onarimOrani: 0.025,         // tam onarım = yapı maliyetinin %2,5'i (eksik sağlıkla orantılı; yapılar YAPI_OLCEK'le büyüdü)
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
  kisiselTaban: 60,     // ortak limit dolsa da her oyuncudan ürün başına günde bu kadar alınır (v0.45: 25 ilk satışı zararına bırakıyordu)
  fiyatAlt: 0.8,        // taban fiyat çarpanı alt sınırı
  fiyatUst: 1.2,
};

// Parsel birleştirme (tevhit): aynı sahibin, aynı mahalle ve imardaki yan yana kare parselleri tek parsel olur
const BIRLESTIRME = {
  harc: 25,        // birleştirme başına tescil harcı (₺7.500)
  maksParca: 4,    // birleşik parsel en çok bu kadar hücreden oluşur
};

const HESAP = {
  baslangicBakiye: 10000,    // ₺3 milyon
  baslangicHediyeUst: 10000, // ₺3 milyon: başlangıç tarlası hediyesi en çok bu kadar (kıyıdaki pahalı tarlada farkı oyuncu öder)
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
  KOSULLAR:  { surum: '2026-11-taslak-4', ad: 'Kullanım Koşulları', yol: '/yasal/kullanim-kosullari.html', zorunlu: true },
  KVKK:      { surum: '2026-11-taslak-3', ad: 'KVKK Aydınlatma Metni', yol: '/yasal/kvkk.html', zorunlu: true },
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
  // Erken uyarı: önümüzdeki saatlerin tahmini (Open-Meteo hourly) risk taşıyorsa tarlası etkilenecek oyuncuya haber verilir.
  // Olgun ama hasat edilmemiş ekin de tarlada sayılır: uyarı "hasat et ya da örtü ser" demektir.
  tahminSaat: 12,
  uyariTekrarMs: 12 * 3600 * 1000,   // aynı oyuncuya aynı ilde aynı risk için en çok 12 saatte bir
  // Açık, ılık bir gündüzde ekilen açık tarla daha hızlı büyür (sera zaten mevsimden etkilenmez)
  gunes: { min: 12, max: 32, kodlar: [0, 1, 2], kati: 0.85 },
  // Rüzgârlı havada değirmen daha hızlı öğütür (ölçüm: il merkezi, km/s)
  ruzgar: { esik: 20, kati: 0.75 },
  // Kuraklık dengesi: son 7 günde ölçümlerin %10'undan azı yağışlıysa ilde elle sulama %30 ucuz (yağmur bedava sular, kurak il geride kalmasın)
  kuraklik: { gun: 7, minOlcum: 24, oran: 0.1, indirim: 0.3 },
  // Afet desteği: 7 günde 2. kez afetten etkilenen doğrulanmış ve en az 7 günlük hesaba haftada bir destek (yeni hesaplarla toplanamasın)
  afetDestegi: { gun: 7, esik: 2, tutar: 40, minHesapGun: 7 },
  // Tarla örtüsü: ekini 12 saat dona, doluya ve sağanağa karşı korur. Gerçek saatle işler (hava gerçek zamanlıdır).
  ortu: { ad: 'Tarla örtüsü', ikon: '⛺', birimMaliyet: 4, sureMs: 12 * 3600 * 1000, korur: ['DON', 'DOLU', 'SAGANAK'] },
};

// §8 oyuncular arası pazar
const PAZAR = {
  ucretOrani: 0.05,            // satıcıdan kesilen, açıkça gösterilen işlem masrafı (oyundan çıkar)
  minUcret: 1,
  maxFiyat: 5_000_000,         // ₺1,5 milyar
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

// Oyun içi piyasa (piyasa.js): arsa değeri = tahsis bedeli × mahalle çarpanı; endeks = 100 × çarpan.
// Akçe nakde çevrilmez; bu bir oyun göstergesidir, gerçek yatırım tavsiyesi ya da değerlemesi değildir.
const PIYASA = {
  pencereGun: 30,          // talep ve işlem sinyallerinin geriye bakış penceresi
  talepParsel: 0.012,      // mahallede sahipli her parsel çarpanı bu kadar artırır…
  talepYeni: 0.03,         // …son 30 günde edinilen her parsel ayrıca bu kadar
  talepUst: 0.45,
  gelisimKat: 0.35,        // mahalledeki yapı yatırımı / arsa bedeli oranının çarpana katkısı
  gelisimUst: 0.6,
  islemAgirlik: 0.6,       // yeterli satış varsa çarpanın bu kadarı gerçek işlem fiyatlarından gelir
  min: 0.6, maks: 3,
  gecmisGun: 30,           // endeks grafiği ve ilk dolduruşta geriye kaç gün
  kayitAraligiMs: 10 * 60 * 1000,   // bugünün endeks karesi en sık bu aralıkla tazelenir
  // Hazine alım teklifi: oyun her sahipli parsele değerinin altında alım teklifi verir (kâr her zaman akçeye döner).
  // Teklifteki mahalle çarpanı satıcının kendi parselleri, yapıları ve işlemleri hariç hesaplanır (kendi çıkış
  // fiyatını şişiremez); yeni tahsis de güncel endeksle fiyatlanır (ucuz tahsis + hemen Hazine'ye satış olmaz).
  hazine: {
    oran: 0.85,                     // tahmini değerin bu kadarı
    minTutmaMs: dk(3 * 24 * 60),    // parsel en az bu kadar süredir sahibinde olmalı
    hediyeTutmaMs: dk(30 * 24 * 60), // başlangıç hediyesi arsa: hesap açıp hediyeyi paraya çevirmek olmasın
    gunlukSatis: 1,                 // oyuncu başına günde en çok bu kadar Hazine satışı
    ilanGun: 7,                     // Hazine aldığı parseli bugünkü değeriyle pazara koyar
    ad: 'Sanal Türkiye Hazinesi',
  },
};

// İlk 10 dakika görevleri (§12.2)
const GOREVLER = [
  { kod: 'ILK_PARSEL', ad: 'İlk parselini edin',        odul: 30, ipucu: 'Haritada yeşil (tarım) boş bir parsele tıkla ve "Edin" de.' },
  { kod: 'ILK_EKIM',   ad: 'Tarlana tohum ek',          odul: 20, ipucu: 'Tarım parselinin kartında bir ürün seç ve ek.' },
  { kod: 'ILK_SULAMA', ad: 'Ekinini sula',              odul: 10, ipucu: 'Ekili tarlada "Sula" düğmesi.' },
  { kod: 'ILK_HASAT',  ad: 'İlk hasadını topla',        odul: 40, ipucu: 'Ekin olgunlaşınca "Hasat et".' },
  { kod: 'ILK_SATIS',  ad: 'Ürününü pazarda sat',        odul: 20, ipucu: 'Pazar → Tüccara sat.' },
  { kod: 'ILK_YAPI',   ad: 'Parseline bir geliştirme yap', odul: 25, ipucu: 'Tel çit, sulama hattı ya da bir ev iyi bir başlangıç.' },
  { kod: 'KOMSU_ZIYARET', ad: 'Bir komşunu ziyaret et',  odul: 15, ipucu: 'Başka bir oyuncunun parseline tıklayıp "Ziyaret et".' },
];

// Haftalık takvim ve memleket: hafta numaraları baslangic'tan 7'şer gün (hasat yarışı, haftalık sipariş özeti). Eski 28
// günlük il ligi v0.41'de hasat yarışının il sıralamasına katıldı.
const LIG = {
  baslangic: Date.UTC(2026, 0, 5),
  memleketBeklemeMs: 30 * 24 * 3600 * 1000,
};

// Moderasyon
const MODERASYON = {
  sebepler: { SPAM: 'İstenmeyen içerik / reklam', TACIZ: 'Taciz veya hakaret', NEFRET: 'Nefret söylemi', DOLANDIRICILIK: 'Dolandırıcılık / manipülasyon',
    COKLU_HESAP: 'Çoklu hesap', UYGUNSUZ_AD: 'Uygunsuz ad', KISISEL_VERI: 'Kişisel verinin ifşası', DIGER: 'Diğer' },
  hedefTurleri: ['KULLANICI', 'PARSEL', 'MESAJ', 'ILAN'],
  // İki kişi kuralı: bu işlemler öneren dışında ikinci bir yetkilinin onayıyla uygulanır
  islemler: {
    ICERIK_GIZLE: { ad: 'İçeriği gizle', ikiKisi: false },
    PARSEL_DONDUR: { ad: 'Parseli dondur', ikiKisi: true },
    PARSEL_COZ: { ad: 'Parsel dondurmayı kaldır', ikiKisi: true },
    HESAP_ASKI: { ad: 'Hesabı askıya al', ikiKisi: true },
    HESAP_AC: { ad: 'Askıyı kaldır', ikiKisi: true },
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
  // Sezon yolu ödülleri (satılmaz; yol kademesinde verilir)
  BAYRAK_YOLCU:   { tur: 'bayrak', ad: 'Yolcu flaması', renk: '#7a4fd0', yol: true },
  CATI_BAKIR:     { tur: 'cati', ad: 'Bakır çatı', renk: '#b0603a', yol: true },
  UNVAN_YOLCU:    { tur: 'unvan', ad: 'Mevsim Yolcusu', yol: true },
};

// §8.7 iller arası lojistik: ürün kendi ilinden başka bir ilin tüccarına sevk edilir. Kara her ile, deniz yalnızca limanlar arası.
// Yöresel ürün kendi bölgesinde ucuz, uzakta pahalıdır; büyükşehirler tüketim merkezidir. Varışta o ilin günlük talebiyle satılır.
const LOJISTIK = {
  limanlar: ['34', '35', '33', '07', '61', '55', '41', '10', '16', '31', '48', '17', '53', '52', '01', '09', '22', '59', '57', '28', '74', '78', '81', '08'],
  modlar: {
    // Denge: 600 km kara ≈ birim başına 0,36 birim (≈ ₺110) — sıradan ürünü taşımak kârsız, yöresel/işlenmiş ürünü uzak büyükşehre taşımak kârlı
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

// §7.7 yaşayan nüfus: gerçek oyuncusu az olan mahallelerde boşluğu dolduran, açıkça "demo sakin" etiketli simüle vatandaşlar.
// Aynı kurallarla oynarlar; mahallede gerçek oyuncu çoğaldıkça taşınırlar.
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
  baslangicBakiye: 10000,
};

module.exports = { ARSA_OLCEK, YAPI_OLCEK, BIRLESTIRME, IHALE, FIYAT_ALARMI, GUNLUK_SANDIK, MINI_ETKINLIK, IMECE, YARDIM, KOLEKSIYON, SEVIYE_KILIDI, SIYASI_EYLEMLER, BULMACA, KOY_MEYDANI, HASAT_YARISI, MEVSIM_YOLU, PIYASA, CARSI, KOMSULUK, YORESEL, YORESEL_KURAL, BALIK, ETKINLIKLER, HATIRLATMA, HAYVANLAR, YEM_FIYATI, SEVIYE, GUNLUK_ODUL, SIPARIS, SUSLER, SUS_MAKS, NUFUS, LOJISTIK, KIRA, ORTAKLIK, AFET, KOZMETIK, RECETELER, MESLEKLER, MESLEK, KOOPERATIF, LIG, MEVSIMLER, HAVA, BOLGE, BOZULMA, BAKIM, BORSA, MODERASYON, YASAL, ROLLER, BIRIM, OYUN_HIZI, IMAR, IMAR_KAYNAK_NOTU, IL_CEKICILIK, YERLESIM_CEKICILIK, YAPILAR, URUNLER, TARIM, NPC_PAZAR, PAZAR, HESAP, GOREVLER };
