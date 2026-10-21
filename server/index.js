const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

require('./db');
const { seedEt } = require('./seed');
const auth = require('./auth');
const oyun = require('./oyun');
const pazar = require('./pazar');
const arama = require('./arama');
const secim = require('./secim');
const belediye = require('./belediye');
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
const referandum = require('./referandum');
const posta = require('./posta');
const imar = require('./harita/imar');
const { parselHazirla, komsuImarlari, koordinatlar } = require('./harita/parsel');
const { npcSeedEt } = require('./npc');
const { IMAR, IMAR_KAYNAK_NOTU, YAPILAR, URUNLER, BIRIM, HESAP, PAZAR, BELEDIYE, BOZULMA, BAKIM, BORSA, MEVSIMLER, LIG, RECETELER, MESLEKLER } = require('./config/rules');
const { OyunHatasi } = require('./lib/ledger');
const { gunluk, istekGunlugu, sonHatalar } = require('./lib/gunluk');

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
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      childSrc: ['blob:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', ...DIS_KAYNAKLAR],
      connectSrc: ["'self'", ...WS_KAYNAKLARI, ...DIS_KAYNAKLAR],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(istekGunlugu);
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
// İmar karoları harita gezinirken çok sayıda istenir; ayrı ve daha geniş bir sınır
app.use('/api/karo/', rateLimit({ windowMs: 60_000, limit: 2400, standardHeaders: 'draft-8', legacyHeaders: false }));
// API_HIZ_SINIRI: IP başına dakikalık genel sınır (varsayılan 600); yük testi / ters vekil arkasında ayarlanır
app.use('/api/', rateLimit({ windowMs: 60_000, limit: Number(process.env.API_HIZ_SINIRI || 600), standardHeaders: 'draft-8', legacyHeaders: false, skip: (req) => req.path.startsWith('/karo/') }));
// Testler aynı IP'den çok sayıda hesap açar: KIMLIK_HIZ_CARPANI yalnızca test/geliştirme içindir
const kimlikSiniri = (n) => n * Number(process.env.KIMLIK_HIZ_CARPANI || 1);
app.use(['/api/kayit', '/api/giris'], rateLimit({ windowMs: 15 * 60_000, limit: kimlikSiniri(30), standardHeaders: 'draft-8', legacyHeaders: false }));
// Kaba kuvvet ve e-posta bombalamasına karşı: sıfırlama, doğrulama, 2FA ve kritik hesap işlemleri
app.use(['/api/sifre', '/api/eposta', '/api/giris/2fa', '/api/2fa', '/api/hesap/sil'],
  rateLimit({ windowMs: 15 * 60_000, limit: kimlikSiniri(20), standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(auth.kimlik);
// Süresi dolan inşaat ve ilanları tembel biçimde işle (idempotent)
app.use('/api/', (req, _res, next) => {
  if (req.path.startsWith('/karo/')) return next();
  try { oyun.bekleyenleriIsle(); pazar.pazarBakim(); secim.secimBakim(); belediye.belediyeBakim(); moderasyon.gorevdenAlmaBakim(); ekonomi.borsaBakim(); dunya.sezonBakim(); dunya.havaBakim();
    lojistik.lojistikBakim(); kira.kiraBakim(); referandum.referandumBakim(); next(); } catch (e) { next(e); }
});

// Sync ve async işleyicilerin hatalarını tek yerde toplayan sarmalayıcı
const h = (fn) => (req, res, next) => {
  Promise.resolve().then(() => fn(req, res)).then((r) => { if (r !== undefined && !res.headersSent) res.json(r); }).catch(next);
};
const uid = (req) => req.kullanici.id;
const parselId = (req) => String(req.params.id || '');
// Parsel işlemlerinden önce hücreyi hazırla (ilk dokunuşta imar + mahalle; sonraki çağrılar anında döner)
const hazir = (fn) => h(async (req, res) => { await parselHazirla(parselId(req)); return fn(req, res); });

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
app.post('/api/2fa/kur', auth.girisGerekli, h(auth.ikiAdimKur));
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
yz.rotalar(app, { h, auth });
kozmetik.rotalar(app, { h, auth });
zaman.rotalar(app, { h });
lojistik.rotalar(app, { h, auth });
referandum.rotalar(app, { h, auth });
// Geliştirme posta kutusu: SMTP yokken doğrulama/sıfırlama iletileri burada görünür (üretimde kapalı)
if (process.env.NODE_ENV !== 'production') app.get('/api/gelistirici/posta', h(() => posta.gelistirmeKutusu()));

// ---- Statik oyun verisi
app.get('/api/kurallar', h(() => ({ haritaKaynak: HARITA_KAYNAK, receteler: RECETELER, meslekler: MESLEKLER, mevsimler: MEVSIMLER, lig: LIG, bozulma: BOZULMA, bakim: BAKIM, borsa: { ucretOrani: BORSA.ucretOrani, sureler: BORSA.sureler, minTutar: BORSA.minTutar }, birim: BIRIM, imar: IMAR, imarKaynakNotu: IMAR_KAYNAK_NOTU, yapilar: YAPILAR, urunler: URUNLER, hesap: HESAP,
  belediye: { projeler: BELEDIYE.projeler, gelir: BELEDIYE.gelir },
  pazar: { ucretOrani: PAZAR.ucretOrani, minUcret: PAZAR.minUcret, maxFiyat: PAZAR.maxFiyat, ilanSureleri: PAZAR.ilanSureleri,
    aliciKosullari: Object.fromEntries(Object.entries(PAZAR.aliciKosullari).map(([k, v]) => [k, v.ad])) } })));

// ---- Harita
app.get('/api/bolgeler', h(() => oyun.bolgeler()));
app.get('/api/istatistik/iller', h(() => oyun.ilIstatistikleri()));
app.get('/api/ara', h((req) => arama.ara(req.query.q)));
app.get('/api/konum', h((req) => arama.konum(Number(req.query.lon), Number(req.query.lat))));
app.get('/api/harita/parseller', h((req) => {
  const bbox = String(req.query.bbox || '').split(',').map(Number);
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) throw new OyunHatasi(400, 'bbox=w,s,e,n gerekli');
  return oyun.haritaParselleri(req.kullanici?.id ?? null, bbox);
}));
// İmar karosu: 64 × 64 PNG, her piksel bir parsel hücresi (z14)
app.get('/api/karo/imar/:kx/:ky.png', h(async (req, res) => {
  const kx = Number(req.params.kx), ky = Number(req.params.ky);
  if (!Number.isInteger(kx) || !Number.isInteger(ky) || kx < 0 || ky < 0 || kx >= 2 ** 14 || ky >= 2 ** 14) throw new OyunHatasi(400, 'Geçersiz karo');
  let png;
  try {
    png = await imar.imarPng(kx, ky, IMAR);
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
app.get('/api/akis', h((req) => oyun.haberAkisi({ ilId: Number(req.query.il) || null })));
app.get('/api/pazar', h(() => oyun.pazarDurumu()));

// ---- Mahalle ve muhtarlık seçimi (§6)
const bboxOku = (req) => {
  const b = String(req.query.bbox || '').split(',').map(Number);
  if (b.length !== 4 || b.some((v) => !Number.isFinite(v))) throw new OyunHatasi(400, 'bbox=w,s,e,n gerekli');
  return b;
};
app.get('/api/mahalle/:id', h((req) => secim.mahalleBilgisi(req.params.id, req.kullanici?.id ?? null)));
app.get('/api/mahallelerim', auth.girisGerekli, h((req) => secim.mahallelerim(uid(req))));
app.get('/api/harita/secimler', h((req) => secim.haritaSecimleri(bboxOku(req))));
app.get('/api/secim/:id/yeniden-say', h((req) => secim.yenidenSay(req.params.id)));
app.post('/api/secim/:id/aday', auth.dogrulanmisGerekli, h((req) => secim.adayOl(uid(req), req.params.id, req.body)));
app.post('/api/secim/:id/adaylik-geri', auth.dogrulanmisGerekli, h((req) => secim.adaylikGeriCek(uid(req), req.params.id)));
app.post('/api/secim/:id/oy', auth.dogrulanmisGerekli, h((req) =>
  secim.oyVer(uid(req), req.params.id, req.body, secim.cihazOzeti(req.ip, req.get('user-agent')))));
app.post('/api/secim/:id/makbuz', h((req) => secim.makbuzDogrula(req.params.id, req.body?.makbuz)));
app.post('/api/secim/:id/itiraz', auth.dogrulanmisGerekli, h((req) => secim.itirazEt(uid(req), req.params.id, req.body)));
app.post('/api/mahalle/:id/duyuru', auth.dogrulanmisGerekli, h((req) => secim.duyuruYap(uid(req), req.params.id, req.body)));
app.post('/api/vaat/:id', auth.dogrulanmisGerekli, h((req) => secim.vaatGuncelle(uid(req), req.params.id, req.body)));

// ---- İlçe belediyesi (§6.1, §6.3, §6.4)
app.get('/api/belediye/:id', h((req) => belediye.belediyeBilgisi(req.params.id, req.kullanici?.id ?? null)));
app.get('/api/belediyelerim', auth.girisGerekli, h((req) => belediye.belediyelerim(uid(req))));
app.get('/api/harita/belediyeler', h((req) => belediye.haritaBelediyeleri(bboxOku(req))));
app.post('/api/belediye/:id/proje', auth.dogrulanmisGerekli, h((req) => belediye.projeTeklif(uid(req), req.params.id, req.body)));
app.post('/api/proje/:id/oy', auth.dogrulanmisGerekli, h((req) => belediye.meclisOyu(uid(req), req.params.id, req.body)));
app.post('/api/mahalle/:id/talep', auth.dogrulanmisGerekli, h((req) => belediye.talepGonder(uid(req), req.params.id, req.body)));
app.post('/api/talep/:id/kapat', auth.dogrulanmisGerekli, h((req) => belediye.talepKapat(uid(req), req.params.id, req.body)));

// ---- Oyuncu eylemleri
// Misafir için 200 + null: istemci oturum durumunu hata üretmeden öğrenir
app.get('/api/ben', h((req) => (req.kullanici ? { ...oyun.oyuncuOzeti(uid(req)), pazar: pazar.pazarOzeti(uid(req)), hesap: auth.hesapDurumu(uid(req)) }
  : req.ikinciAdimBekleyen ? { ikinciAdimBekleniyor: true } : null)));
app.get('/api/cuzdan', auth.girisGerekli, h((req) => oyun.cuzdanHareketleri(uid(req))));
app.post('/api/parsel/:id/edin', auth.girisGerekli, hazir((req) => oyun.parselEdin(uid(req), parselId(req))));
app.post('/api/parsel/:id/insaat', auth.girisGerekli, hazir((req) => oyun.insaatBaslat(uid(req), parselId(req), String(req.body?.tip || ''))));
app.post('/api/parsel/:id/ek', auth.girisGerekli, hazir((req) => oyun.ek(uid(req), parselId(req), String(req.body?.urun || ''))));
app.post('/api/parsel/:id/sula', auth.girisGerekli, hazir((req) => oyun.sula(uid(req), parselId(req))));
app.post('/api/parsel/:id/hasat', auth.girisGerekli, hazir((req) => oyun.hasat(uid(req), parselId(req))));
app.post('/api/parsel/:id/bakim', auth.girisGerekli, hazir((req) => oyun.bakimYap(uid(req), parselId(req))));
app.post('/api/parsel/:id/ziyaret', auth.girisGerekli, hazir((req) => oyun.ziyaret(uid(req), parselId(req))));
// ---- Oyuncular arası pazar (§8)
const ilanId = (req) => req.params.id;
app.get('/api/ilanlar', h((req) => pazar.ilanlar({ il: req.query.il || null, ilce: req.query.ilce || null, imar: req.query.imar || null, sirala: String(req.query.sirala || '') }, req.kullanici?.id ?? null)));
app.get('/api/islemler', h(() => pazar.sonIslemler()));
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
app.post('/api/pazar/sat', auth.girisGerekli, h((req) => oyun.npcSat(uid(req), String(req.body?.urun || ''), Number(req.body?.miktar))));

// İstemci tarafı hatalar (window.onerror): kısa, kişisel veri içermeyen rapor; ayrı hız sınırı
app.post('/api/istemci-hata', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }), h((req) => {
  const b = req.body || {};
  gunluk.error('istemci hatası', { kaynak: 'istemci', hataIletisi: String(b.ileti || '').slice(0, 500), dosya: String(b.dosya || '').slice(0, 200),
    satir: Number(b.satir) || null, yigin: String(b.yigin || '').slice(0, 1500), surum: String(b.surum || '').slice(0, 20), kullanici: req.kullanici?.id });
  return { tamam: true };
}));
app.get('/api/yonetim/hatalar', auth.rolGerekli('MODERATOR', 'DENETCI', 'ADMIN'), h(() => sonHatalar(80)));
app.get('/api/saglik', h(() => ({ durum: 'iyi', surum: require('../package.json').version, calisma: Math.round(process.uptime()), bellekMb: Math.round(process.memoryUsage().rss / 1e6),
  canliBaglanti: canli.baglantiSayisi() })));

app.use('/api', (_req, _res, next) => next(new OyunHatasi(404, 'Uç bulunamadı')));

// ---- Statik dosyalar
app.use('/vendor/maplibre', express.static(path.join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist'), { maxAge: '7d' }));
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Hata yöneticisi (yığın izi sızdırmaz)
app.use((err, _req, res, _next) => {
  if (err instanceof OyunHatasi) return res.status(err.status).json({ hata: err.message, kod: err.kod });
  if (err.type === 'entity.too.large') return res.status(413).json({ hata: 'İstek çok büyük' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ hata: 'Geçersiz JSON' });
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
  const sunucu = app.listen(PORT, () => gunluk.info(`Sanal Türkiye → http://localhost:${PORT}`, { port: PORT, surum: require('../package.json').version }));
  process.on('unhandledRejection', (e) => gunluk.error('yakalanmamış söz reddi', { hata: e }));
  // Tutarsız durumda çalışmaya devam etmemek için kaydedip çık; süreç yöneticisi (systemd/pm2) yeniden başlatır
  process.on('uncaughtException', (e) => { gunluk.error('yakalanmamış istisna', { hata: e }); setTimeout(() => process.exit(1), 200); });
  canli.bagla(sunucu);
}
module.exports = app;
