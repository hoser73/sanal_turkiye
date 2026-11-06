const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
// Bütün hız sınırları: istemci api() JSON bekler; aşımda Türkçe JSON yanıt
const hizSiniri = (ayar) => rateLimit({ standardHeaders: 'draft-8', legacyHeaders: false, ...ayar,
  handler: (_req, res) => res.status(429).json({ hata: 'Çok fazla istek; biraz sonra tekrar dene', kod: 'HIZ_SINIRI' }) });

require('./db');
const { seedEt } = require('./seed');
const auth = require('./auth');
const oyun = require('./oyun');
const pazar = require('./pazar');
const piyasa = require('./piyasa');
piyasa.hazineId(true);   // Hazine (oyunun alıcısı) hesabı açılışta hazır olsun
const arama = require('./arama');
const hesap = require('./hesap');
const moderasyon = require('./moderasyon');
const ekonomi = require('./ekonomi');
const sohbet = require('./sohbet');
const push = require('./push');
const canli = require('./canli');
const dunya = require('./dunya');
const uretim = require('./uretim');
const kooperatif = require('./kooperatif');
const simge = require('./simge');
const yz = require('./yz');
const kozmetik = require('./kozmetik');
const zaman = require('./zaman');
const lojistik = require('./lojistik');
const kira = require('./kira');
const nufus = require('./nufus');
const posta = require('./posta');
const imar = require('./harita/imar');
const { parselHazirla, komsuImarlari, koordinatlar } = require('./harita/parsel');
const { npcSeedEt } = require('./npc');
const { IMAR, IMAR_KAYNAK_NOTU, YAPILAR, URUNLER, BIRIM, HESAP, PAZAR, BOZULMA, BAKIM, BORSA, MEVSIMLER, LIG, RECETELER, MESLEKLER } = require('./config/rules');
const { OyunHatasi } = require('./lib/ledger');
const { gunluk, istekGunlugu, sonHatalar } = require('./lib/gunluk');
const { ortakYanit } = require('./lib/onbellek');   // herkese aynı uçlar: kısa süreli önbellek
const { metin, sayi } = require('./lib/girdi');

seedEt();

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Harita karo kaynakları (kendi karo sunucusuna geçiş: docs/karo-sunucusu.md)
const HARITA_KAYNAK = {
  vektor: process.env.VEKTOR_TILEJSON || 'https://tiles.openfreemap.org/planet',
  yukselti: process.env.YUKSELTI_KARO || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  harfler: process.env.HARF_KARO || 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
};
const koken = (u) => { try { return new URL(u.replace(/[{}]/g, '')).origin; } catch { return null; } };
// Karo sunucusu TileJSON içinde başka bir alan adına yönlendirebilir: EK_KARO_KOKENLERI ile eklenir
const DIS_KAYNAKLAR = [...new Set([...Object.values(HARITA_KAYNAK).map(koken), ...String(process.env.EK_KARO_KOKENLERI || '').split(',')].filter(Boolean))];
// Canlı bağlantı: bazı tarayıcılar 'self' ile ws:// eşleştirmez; aynı kökenin ws/wss adresi açıkça eklenir
const WS_KAYNAKLARI = [(process.env.TABAN_URL || `http://localhost:${process.env.PORT || 3400}`).replace(/^http/, 'ws').replace(/\/$/, '')];
// Aynı ağdaki telefondan (ör. http://192.168.1.106:3400) açılınca da canlı bağlantı izinli olsun: isteğin kendi adresi
const istekWs = (req) => `${req.secure ? 'wss' : 'ws'}://${String(req.headers.host || '').replace(/[^\w.:\-[\]]/g, '')}`;
// Yalnızca https ile yayındayken http isteklerini https'e yükselt ve HSTS gönder. Geliştirmede (http://localhost)
// Safari / iOS uygulaması (WKWebView) yükseltmeyi localhost'a da uyguladığı için CSS ve JS yüklenmiyordu.
const HTTPS = /^https:/.test(process.env.TABAN_URL || '');
app.use(helmet({
  strictTransportSecurity: HTTPS ? { maxAge: 31536000, includeSubDomains: true } : false,
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: HTTPS ? [] : null,
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      childSrc: ['blob:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', ...DIS_KAYNAKLAR],
      connectSrc: ["'self'", ...WS_KAYNAKLARI, istekWs, ...DIS_KAYNAKLAR],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(istekGunlugu);
// Yönetici marka güncellemesi logo taşır (≤150 KB); diğer bütün istekler 50 KB ile sınırlı
const jsonKucuk = express.json({ limit: '50kb' }), jsonLogo = express.json({ limit: '260kb' });
app.use((req, res, next) => (/^\/api\/yonetim\/isletme\//.test(req.path) ? jsonLogo : jsonKucuk)(req, res, next));
app.use(cookieParser());
// İmar karoları harita gezinirken çok sayıda istenir; ayrı ve daha geniş bir sınır
app.use('/api/karo/', hizSiniri({ windowMs: 60_000, limit: 2400 }));
// API_HIZ_SINIRI: IP başına dakikalık genel sınır (varsayılan 600); yük testi / ters vekil arkasında ayarlanır
app.use('/api/', hizSiniri({ windowMs: 60_000, limit: Number(process.env.API_HIZ_SINIRI || 600), skip: (req) => req.path.startsWith('/karo/') }));
// Testler aynı IP'den çok sayıda hesap açar: KIMLIK_HIZ_CARPANI yalnızca test/geliştirme içindir
const kimlikSiniri = (n) => n * Number(process.env.KIMLIK_HIZ_CARPANI || 1);
// Yalnızca kimlik bilgisi gönderen istekler sayılır (açılışta çağrılan GET /api/giris/yollar sınırı tüketmesin)
app.use(['/api/kayit', '/api/giris', '/api/passkey', '/api/oauth'], hizSiniri({ windowMs: 15 * 60_000, limit: kimlikSiniri(30),
  skip: (req) => req.method === 'GET' && !req.originalUrl.startsWith('/api/oauth') }));
app.use(['/api/telefon'], hizSiniri({ windowMs: 15 * 60_000, limit: kimlikSiniri(15) }));
app.use(['/api/oyuncu-adi'], hizSiniri({ windowMs: 15 * 60_000, limit: kimlikSiniri(90) }));
// Kaba kuvvet ve e-posta bombalamasına karşı: sıfırlama, doğrulama, 2FA ve kritik hesap işlemleri
app.use(['/api/sifre', '/api/eposta', '/api/giris/2fa', '/api/2fa', '/api/hesap/sil'],
  hizSiniri({ windowMs: 15 * 60_000, limit: kimlikSiniri(20) }));
// Oturum yalnızca API isteklerinde okunur (statik dosyalar için her seferinde oturum sorgusu yapılmaz)
app.use((req, res, next) => (req.path.startsWith('/api/') ? auth.kimlik(req, res, next) : next()));
// Bakım işleri (süresi dolan inşaat, ilan, borsa emri, hava, kira, ihale…). Eskiden her /api
// isteğinde hepsi çalışıyordu (her istekte bir düzine tablo taraması). Artık en sık BAKIM_ARALIGI_MS'de bir (varsayılan
// 1 sn; testte 0 = her istekte) ve ayrıca zamanlayıcıyla; her iş ayrı korunur: biri hata verirse istekler düşmez.
const BAKIM_ARALIGI = Number(process.env.BAKIM_ARALIGI_MS ?? 1000);
const BAKIM_ISLERI = [
  ['inşaat', () => oyun.bekleyenleriIsle()], ['pazar', () => pazar.pazarBakim()], ['borsa', () => ekonomi.borsaBakim()],
  ['hava', () => dunya.havaBakim()],
  ['lojistik', () => lojistik.lojistikBakim()], ['kira', () => kira.kiraBakim()],
  ['endeks', () => piyasa.endeksBakim()], ['hazine', () => piyasa.hazineBakim()], ['hasat yarışı', () => require('./hasat-yarisi').yarisBakim()], ['ihale', () => require('./ihale').ihaleBakim()], ['fiyat alarmı', () => require('./alarm').alarmBakim()],
];
let sonBakim = 0;
function bakim() {
  const t = Date.now();
  if (BAKIM_ARALIGI && t - sonBakim < BAKIM_ARALIGI) return;
  sonBakim = t;
  for (const [ad, is] of BAKIM_ISLERI) {
    try { is(); } catch (e) { gunluk.error('bakım işi başarısız', { is: ad, hata: e }); }
  }
  posta.postaBakim().catch(() => {});   // başarısız e-postaları arka planda yeniden dene
}
app.use('/api/', (req, _res, next) => { if (!req.path.startsWith('/karo/')) bakim(); next(); });
if (BAKIM_ARALIGI) setInterval(bakim, BAKIM_ARALIGI).unref();   // kimse istek atmasa da süreler işlesin

// Sync ve async işleyicilerin hatalarını tek yerde toplayan sarmalayıcı
const h = (fn) => (req, res, next) => {
  Promise.resolve().then(() => fn(req, res)).then((r) => { if (r !== undefined && !res.headersSent) res.json(r); }).catch(next);
};
const uid = (req) => req.kullanici.id;
const parselId = (req) => String(req.params.id || '');
// Parsel işlemlerinden önce hücreyi hazırla (ilk dokunuşta imar + mahalle; sonraki çağrılar anında döner)
// Deneme ilçesinde hücre bir tarlaya aitse işlem tarlanın (asıl parselin) kimliğiyle sürer
const hazir = (fn) => h(async (req, res) => { req.params.id = await parselHazirla(parselId(req)); return fn(req, res); });

uretim.rotalar(app, { h, auth, hazir });
kira.rotalar(app, { h, auth, hazir });

// ---- Kimlik
app.post('/api/kayit', h(auth.kayit));
app.post('/api/giris', h(auth.giris));
app.post('/api/cikis', h(auth.cikis));
app.post('/api/giris/2fa', h(auth.ikinciAdim));
app.post('/api/eposta/dogrula', h(auth.epostaDogrula));
app.post('/api/eposta/yeniden', auth.girisGerekli, h(auth.dogrulamaYenidenGonder));
app.post('/api/sifre/unuttum', h(auth.sifreUnuttum));
app.post('/api/sifre/sifirla', h(auth.sifreSifirla));
app.post('/api/sifre/degistir', auth.girisGerekli, h(auth.sifreDegistir));
app.post('/api/2fa/kur', auth.girisGerekli, auth.tazeOturumGerekli, h(auth.ikiAdimKur));
app.post('/api/2fa/etkinlestir', auth.girisGerekli, h(auth.ikiAdimEtkinlestir));
app.post('/api/2fa/kapat', auth.girisGerekli, h(auth.ikiAdimKapat));
app.get('/api/oturumlar', auth.girisGerekli, h(auth.oturumlar));
app.post('/api/oturum/:id/kapat', auth.girisGerekli, h(auth.oturumKapat));
app.post('/api/oturumlar/digerleri', auth.girisGerekli, h(auth.digerOturumlariKapat));
hesap.rotalar(app, { h });
moderasyon.rotalar(app, { h, auth });
ekonomi.rotalar(app, { h, auth });
sohbet.rotalar(app, { h, auth });
push.rotalar(app, { h, auth });
dunya.rotalar(app, { h, auth });
kooperatif.rotalar(app, { h, auth });
simge.rotalar(app, { h, auth });
// Komşuluk, yöresel ürünler, etkinlikler, balık tutma, hatırlatmalar
for (const m of ['./komsuluk', './yoresel', './etkinlik', './balik', './hatirlatma', './iklim', './carsi', './giris-yollari', './tanitim', './baslangic', './gelisim', './sihirbaz', './mevsim-yolu', './hasat-yarisi', './koy-meydani', './bulmaca', './koleksiyon', './yardim', './gazete', './imece', './sandik', './ihale', './alarm', './birlestirme']) require(m).rotalar(app, { h, auth, hazir });
require('./db').indeksleriKur();   // tüm modüllerin tabloları kurulduktan sonra
yz.rotalar(app, { h, auth });
kozmetik.rotalar(app, { h, auth });
zaman.rotalar(app, { h });
lojistik.rotalar(app, { h, auth });
// Geliştirme posta kutusu: SMTP yokken doğrulama/sıfırlama iletileri burada görünür (üretimde kapalı)
if (process.env.NODE_ENV !== 'production') app.get('/api/gelistirici/posta', h(() => posta.gelistirmeKutusu()));

// ---- Statik oyun verisi
app.get('/api/kurallar', h(ortakYanit(10 * 60_000, () => ({ surum: require('../package.json').version, haritaKaynak: HARITA_KAYNAK, yoresel: require('./config/rules').YORESEL, hayvanlar: require('./config/rules').HAYVANLAR, susler: require('./config/rules').SUSLER, receteler: RECETELER, meslekler: MESLEKLER, mevsimler: MEVSIMLER, lig: LIG, bozulma: BOZULMA, bakim: BAKIM, borsa: { ucretOrani: BORSA.ucretOrani, sureler: BORSA.sureler, minTutar: BORSA.minTutar }, birim: BIRIM, imar: IMAR, imarKaynakNotu: IMAR_KAYNAK_NOTU, yapilar: YAPILAR, urunler: URUNLER, hesap: HESAP,
  pazar: { ucretOrani: PAZAR.ucretOrani, minUcret: PAZAR.minUcret, maxFiyat: PAZAR.maxFiyat, ilanSureleri: PAZAR.ilanSureleri,
    aliciKosullari: Object.fromEntries(Object.entries(PAZAR.aliciKosullari).map(([k, v]) => [k, v.ad])) } }))));

// ---- Harita
app.get('/api/bolgeler', h(ortakYanit(60_000, () => oyun.bolgeler())));
// İl → ilçe → mahalle gezintisi (sınırlar ve oyun kuralıyla çıkarılan mahalle alanları)
const bolgeHaritasi = require('./harita/bolgeler');
// Ağır uçlar (ilçe taraması, karo arama): IP başına dakikada 20
const agirSinir = hizSiniri({ windowMs: 60_000, limit: Number(process.env.AGIR_HIZ_SINIRI || 20) });
app.get('/api/il/:plaka/ilceler', h((req, res) => { res.set('cache-control', 'public, max-age=3600'); return bolgeHaritasi.ilIlceleri(String(req.params.plaka)); }));
app.get('/api/ilce/:id/mahalleler', agirSinir, h((req) => bolgeHaritasi.ilceMahalleleri(req.params.id)));
app.post('/api/ilce/:id/mahalle', agirSinir, h((req) => bolgeHaritasi.mahalleBolgesiAc(req.params.id, req.body?.yerId, req.kullanici?.id ?? null)));
// Çiftlik: hayvancılık, seviye, günlük ödül, siparişler, süsler
const ciftlik = require('./ciftlik');
app.get('/api/ciftlik', auth.girisGerekli, h((req) => ciftlik.ozet(uid(req))));
app.post('/api/yapi/:id/besle', auth.girisGerekli, h((req) => ciftlik.besle(uid(req), req.params.id)));
app.post('/api/yapi/:id/topla', auth.girisGerekli, h((req) => ciftlik.topla(uid(req), req.params.id)));
app.post('/api/seviye-odul', auth.girisGerekli, h((req) => ciftlik.seviyeOdulAl(uid(req))));
app.post('/api/gunluk-odul', auth.girisGerekli, h((req) => ciftlik.gunlukAl(uid(req))));
app.post('/api/siparis/:id/teslim', auth.girisGerekli, h((req) => ciftlik.siparisTeslim(uid(req), req.params.id)));
app.post('/api/siparis/:id/reddet', auth.girisGerekli, h((req) => ciftlik.siparisReddet(uid(req), req.params.id)));
app.post('/api/parsel/:id/sus', auth.girisGerekli, hazir((req) => ciftlik.susEkle(uid(req), parselId(req), metin(req.body?.tur))));
app.post('/api/sus/:id/kaldir', auth.girisGerekli, h((req) => ciftlik.susKaldir(uid(req), req.params.id)));
app.get('/api/istatistik/iller', h(ortakYanit(30_000, () => oyun.ilIstatistikleri())));
app.get('/api/ara', h((req) => arama.ara(req.query.q)));
app.get('/api/konum', h((req) => arama.konum(Number(req.query.lon), Number(req.query.lat))));
app.get('/api/harita/parseller', h((req) => {
  const bbox = metin(req.query.bbox).split(',').map(Number);
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) throw new OyunHatasi(400, 'bbox=w,s,e,n gerekli');
  return oyun.haritaParselleri(req.kullanici?.id ?? null, bbox);
}));
// Karo numarası geçerli olmalı ve Türkiye'nin sınır kutusuna (25,5–45,0 D; 35,7–42,2 K) düşmeli: dünyanın her
// karosu hesaplanıp diske yazılmasın
const TR_KARO = (() => {
  const x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** 14);
  const y = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** 14); };
  return { x0: x(25.5), x1: x(45.0), y0: y(42.2), y1: y(35.7) };
})();
// Karo numarası kanonik ondalık olmalı (0x25c6, 9670e0, ' 9670' reddedilir); yönlendirmeden gelen metni sayıya çevirir
const karoNo = (v) => (/^\d{1,5}$/.test(v) ? Number(v) : NaN);
function karoDenetle(kx, ky) {
  if (!Number.isInteger(kx) || !Number.isInteger(ky) || kx < 0 || ky < 0 || kx >= 2 ** 14 || ky >= 2 ** 14) throw new OyunHatasi(400, 'Geçersiz karo');
  if (kx < TR_KARO.x0 || kx > TR_KARO.x1 || ky < TR_KARO.y0 || ky > TR_KARO.y1) throw new OyunHatasi(404, 'Karo Türkiye dışında');
}
// İmar karosu: 64 × 64 PNG, her piksel bir parsel hücresi (z14)
app.get('/api/karo/imar/:kx/:ky.png', h(async (req, res) => {
  const kx = karoNo(req.params.kx), ky = karoNo(req.params.ky);
  karoDenetle(kx, ky);
  let png;
  try {
    png = await imar.imarPng(kx, ky, IMAR, await require('./harita/tarla').karoMaskesi(kx, ky));
  } catch (e) {
    console.warn(`İmar karosu ${kx}/${ky} hazırlanamadı: ${e.message}`);
    throw new OyunHatasi(503, 'İmar karosu şu an hazırlanamıyor');
  }
  res.set({ 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }).send(png);
}));
app.get('/api/parsel/:id', hazir(async (req) => {
  const id = parselId(req);
  const uidVeya = req.kullanici?.id ?? null;
  const { x, y } = koordinatlar(id);
  const komsu = await komsuImarlari(x, y);
  return { ...oyun.parselKarti(id, uidVeya, komsu), pazar: pazar.parselPazarBilgisi(id, uidVeya) };
}));
app.get('/api/akis', h(ortakYanit(3000, (req) => oyun.haberAkisi({ ilId: Number(req.query.il) || null }), (req) => String(Number(req.query.il) || ''))));
app.get('/api/pazar', h(ortakYanit(5000, () => oyun.pazarDurumu())));
// Oyun içi piyasa: Türkiye ve mahalle endeksleri, bölge endeks serisi, oyuncunun portföy kâr/zararı (piyasa.js)
app.get('/api/piyasa', h(ortakYanit(30000, () => piyasa.piyasaOzeti())));
app.get('/api/piyasa/endeks', h(ortakYanit(30000, (req) => piyasa.bolgeEndeksi(metin(req.query.tur), req.query.id) || { seri: [] },
  (req) => `${metin(req.query.tur)}:${Number(req.query.id) || 0}`)));
app.get('/api/portfoy', auth.girisGerekli, h((req) => piyasa.portfoy(uid(req))));
app.post('/api/parsel/:id/hazineye-sat', auth.dogrulanmisGerekli, hazir((req) => piyasa.hazineyeSat(uid(req), parselId(req), req.body)));


// Tarla karosu (deneme ilçeleri): tarlalar karo başına bir kez üretilip saklanır, değişmez → önbelleklenir ve sıkıştırılır
app.get('/api/harita/tarla/:kx/:ky', h(async (req, res) => {
  const kx = karoNo(req.params.kx), ky = karoNo(req.params.ky);
  karoDenetle(kx, ky);
  const tarla = require('./harita/tarla');
  const govde = Buffer.from(JSON.stringify((await tarla.karoVerisi(kx, ky)) || { m: null, t: [] }));
  res.set({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600', vary: 'accept-encoding' });
  if (/\bgzip\b/.test(req.get('accept-encoding') || '')) res.set('content-encoding', 'gzip').send(require('zlib').gzipSync(govde));
  else res.send(govde);
}));

// ---- Oyuncu eylemleri
// Misafir için 200 + null: istemci oturum durumunu hata üretmeden öğrenir
app.get('/api/ben', h((req) => (req.kullanici ? { ...oyun.oyuncuOzeti(uid(req)), pazar: pazar.pazarOzeti(uid(req)), hesap: auth.hesapDurumu(uid(req)), yol: require('./mevsim-yolu').ozet(uid(req)), sandik: require('./sandik').ozet(uid(req)), siparis: ciftlik.siparisOzeti(uid(req)), miniEtkinlik: require('./mini-etkinlik').aktif() }
  : req.ikinciAdimBekleyen ? { ikinciAdimBekleniyor: true } : null)));
app.get('/api/cuzdan', auth.girisGerekli, h((req) => oyun.cuzdanHareketleri(uid(req))));
app.post('/api/parsel/:id/edin', auth.girisGerekli, hazir((req) => oyun.parselEdin(uid(req), parselId(req))));
app.post('/api/parsel/:id/insaat', auth.girisGerekli, hazir((req) => oyun.insaatBaslat(uid(req), parselId(req), metin(req.body?.tip))));
app.post('/api/parsel/:id/ek', auth.girisGerekli, hazir((req) => oyun.ek(uid(req), parselId(req), metin(req.body?.urun))));
app.post('/api/parsel/:id/sula', auth.girisGerekli, hazir((req) => oyun.sula(uid(req), parselId(req))));
app.post('/api/parsel/:id/hasat', auth.girisGerekli, hazir((req) => oyun.hasat(uid(req), parselId(req))));
app.post('/api/parsel/:id/bakim', auth.girisGerekli, hazir((req) => oyun.bakimYap(uid(req), parselId(req))));
app.post('/api/parsel/:id/ziyaret', auth.girisGerekli, hazir((req) => oyun.ziyaret(uid(req), parselId(req))));
// ---- Oyuncular arası pazar (§8)
const ilanId = (req) => req.params.id;
app.get('/api/ilanlar', h((req) => pazar.ilanlar({ il: req.query.il || null, ilce: req.query.ilce || null, imar: req.query.imar || null, sirala: metin(req.query.sirala) }, req.kullanici?.id ?? null)));
app.get('/api/islemler', h(ortakYanit(5000, () => pazar.sonIslemler())));
app.get('/api/benim-pazarim', auth.girisGerekli, h((req) => pazar.benimPazarim(uid(req))));
app.post('/api/parsel/:id/ilan', auth.dogrulanmisGerekli, hazir((req) => pazar.ilanAc(uid(req), parselId(req), req.body)));
app.post('/api/ilan/:id/fiyat', auth.dogrulanmisGerekli, h((req) => pazar.fiyatDegistir(uid(req), ilanId(req), req.body)));
app.post('/api/ilan/:id/iptal', auth.girisGerekli, h((req) => pazar.ilanIptal(uid(req), ilanId(req))));
app.post('/api/ilan/:id/teklif', auth.dogrulanmisGerekli, h((req) => pazar.teklifVer(uid(req), ilanId(req), req.body)));
app.post('/api/ilan/:id/teklif-geri', auth.girisGerekli, h((req) => pazar.teklifGeriCek(uid(req), ilanId(req))));
app.post('/api/ilan/:id/hemen-al', auth.dogrulanmisGerekli, h((req) => pazar.hemenAl(uid(req), ilanId(req), req.body)));
app.post('/api/teklif/:id/kabul', auth.dogrulanmisGerekli, h((req) => pazar.teklifKabul(uid(req), req.params.id)));
app.post('/api/teklif/:id/red', auth.girisGerekli, h((req) => pazar.teklifRed(uid(req), req.params.id)));
app.get('/api/bildirimler', auth.girisGerekli, h((req) => pazar.bildirimler(uid(req))));
app.post('/api/bildirimler/okundu', auth.girisGerekli, h((req) => pazar.bildirimleriOku(uid(req))));
app.post('/api/pazar/sat', auth.girisGerekli, h((req) => oyun.npcSat(uid(req), metin(req.body?.urun), sayi(req.body?.miktar))));

// İstemci tarafı hatalar (window.onerror): kısa, kişisel veri içermeyen rapor; ayrı hız sınırı
app.post('/api/istemci-hata', hizSiniri({ windowMs: 60_000, limit: 20 }), h((req) => {
  const b = req.body || {};
  const ileti = metin(b.ileti).trim();
  if (!ileti) throw new OyunHatasi(400, 'Hata iletisi boş');
  gunluk.error('istemci hatası', { kaynak: 'istemci', hataIletisi: ileti.slice(0, 500), dosya: metin(b.dosya).slice(0, 200),
    satir: Number.isInteger(b.satir) ? b.satir : null, yigin: metin(b.yigin).slice(0, 1500), surum: metin(b.surum).slice(0, 20), kullanici: req.kullanici?.id });
  return { tamam: true };
}));
app.get('/api/yonetim/posta', auth.rolGerekli('MODERATOR', 'DENETCI', 'ADMIN'), h(() => posta.kuyrukDurumu()));
app.get('/api/yonetim/hatalar', auth.rolGerekli('MODERATOR', 'DENETCI', 'ADMIN'), h(() => sonHatalar(80)));
app.get('/api/mahalle/:id/nufus', h((req) => nufus.mahalleNufusu(req.params.id)));
app.get('/api/saglik', h(() => ({ durum: 'iyi', surum: require('../package.json').version, calisma: Math.round(process.uptime()), bellekMb: Math.round(process.memoryUsage().rss / 1e6),
  canliBaglanti: canli.baglantiSayisi() })));

app.use('/api', (_req, _res, next) => next(new OyunHatasi(404, 'Uç bulunamadı')));

// ---- Statik dosyalar (metin dosyaları önce sıkıştırılmış olarak denenir: lib/sikistir.js)
const { sikistirilmisStatik } = require('./lib/sikistir');
const HAFTA_SN = 7 * 24 * 3600;
app.use('/vendor/maplibre', sikistirilmisStatik(path.join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist'), { maxAge: HAFTA_SN }));
app.use('/vendor/three', sikistirilmisStatik(path.join(__dirname, '..', 'node_modules', 'three', 'build'), { maxAge: HAFTA_SN }));
app.use('/vendor/maplibre', express.static(path.join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist'), { maxAge: '7d' }));
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build'), { maxAge: '7d' }));
// three.js ekleri (son işleme, HDR yükleyici): yalın 'three' içe aktarımı tarayıcı için mutlak yola çevrilir (içe aktarma haritası gerekmez)
const THREE_EK = path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm');
const threeEkOnbellek = new Map();
app.get(/^\/vendor\/three-ek\/(.+\.js)$/, (req, res, next) => {
  const dosya = path.normalize(path.join(THREE_EK, req.params[0]));
  if (!dosya.startsWith(THREE_EK + path.sep)) return next();
  let kod = threeEkOnbellek.get(dosya);
  if (!kod) {
    try { kod = require('fs').readFileSync(dosya, 'utf8'); } catch { return next(); }
    kod = kod.replace(/from\s+'three'/g, "from '/vendor/three/three.module.js'").replace(/from\s+'three\/addons\//g, "from '/vendor/three-ek/");
    threeEkOnbellek.set(dosya, kod);
  }
  res.type('application/javascript').set('Cache-Control', 'public, max-age=604800').send(kod);
});
app.use(sikistirilmisStatik(path.join(__dirname, '..', 'public')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Hata yöneticisi (yığın izi sızdırmaz)
app.use((err, _req, res, _next) => {
  if (err instanceof OyunHatasi) return res.status(err.status).json({ hata: err.message, kod: err.kod });
  if (err.type === 'entity.too.large') return res.status(413).json({ hata: 'İstek çok büyük' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ hata: 'Geçersiz JSON' });
  // Express ve gövde ayrıştırıcının istemci hataları (bozuk yüzde kodlaması, desteklenmeyen sıkıştırma…): sunucu hatası değil
  const durum = err.status ?? err.statusCode;
  if (Number.isInteger(durum) && durum >= 400 && durum < 500) return res.status(durum).json({ hata: 'Geçersiz istek' });
  gunluk.error('sunucu hatası', { id: _req.istekId, yol: _req.path, yontem: _req.method, kullanici: _req.kullanici?.id, hata: err });
  res.status(500).json({ hata: 'Sunucu hatası', istekKimligi: _req.istekId });
});

auth.eskiOturumlariTemizle();
setInterval(auth.eskiOturumlariTemizle, 6 * 3600 * 1000).unref();

// Demo komşular ağdan imar verisi ister; sunucuyu bekletmeden arka planda yerleşir
app.hazir = npcSeedEt({ sessiz: !!process.env.SESSIZ }).catch((e) => console.warn('Demo komşular:', e.message));

const PORT = Number(process.env.PORT || 3400);
app.canliBagla = canli.bagla;
if (require.main === module) {
  // Üretimde eksik/güvensiz ayarla açılmaz; uyarılar günlüğe yazılır
  const denetim = require('./yapilandirma').uretimDenetimi();
  for (const u of denetim.uyarilar) gunluk.warn('yapılandırma uyarısı', { uyari: u });
  if (denetim.hatalar.length) {
    for (const h of denetim.hatalar) gunluk.error('yapılandırma hatası', { hataIletisi: h });
    process.stderr.write(`\nSunucu başlatılmadı: ${denetim.hatalar.length} yapılandırma hatası (bkz. .env.ornek, docs/yayina-alma.md)\n`);
    process.exit(1);
  }
  const sunucu = app.listen(PORT, () => gunluk.info(`Sanal Türkiye → http://localhost:${PORT}`, { port: PORT, surum: require('../package.json').version }));
  process.on('unhandledRejection', (e) => gunluk.error('yakalanmamış söz reddi', { hata: e }));
  // Tutarsız durumda çalışmaya devam etmemek için kaydedip çık; süreç yöneticisi (systemd/pm2) yeniden başlatır
  process.on('uncaughtException', (e) => { gunluk.error('yakalanmamış istisna', { hata: e }); setTimeout(() => process.exit(1), 200); });
  canli.bagla(sunucu);
  nufus.baslat();   // yaşayan nüfus: gerçek oyuncusu az mahallelerde demo sakinler
  require('./hatirlatma').baslat();   // geri çağıran bildirimler (hasat, hayvan, sipariş)
  require('./gelisim').baslat();   // işçiler: olgun ekini hasat eder, susuz tarlayı sular, hayvanları yemler
  // Arsa konum değeri (kıyı, merkez, arazi…) henüz hesaplanmamış parseller arka planda tamamlanır
  require('./harita/parsel').eksikKonumlariDoldur().then((n) => n && gunluk.info('konum değerleri tamamlandı', { parsel: n })).catch((e) => gunluk.error('konum doldurma', { hata: e }));
  // Düzenli kapanış (docker stop / systemd): yeni bağlantıları kes, veritabanını kapat
  const kapat = (sinyal) => {
    gunluk.info('kapanıyor', { sinyal });
    sunucu.close(() => { try { require('./db').close(); } catch { /* zaten kapalı */ } process.exit(0); });
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => kapat('SIGTERM'));
  process.on('SIGINT', () => kapat('SIGINT'));
}
module.exports = app;
