import './uygulama.js';   // iOS uygulamasında (Flutter kabuğu) çalışıyorsa önce sınıf ve görüntü ayarı
import { emojiYedeginiKur } from './emoji.js';
import { sihirbazKur } from './sihirbaz.js';
emojiYedeginiKur();   // cihaz emoji çizemiyorsa (ör. iOS Simülatörü) emojiler görsele döner
import { api, esc, sayi, akce, sure, zamanOnce, tost, ApiHatasi, tamlayan, sayiBulunma, konumCipleri, paraGirdisi, formVerisi } from './yardimci.js';
import { endeksGrafigi, degisimCipi, kisaTarih } from './grafik.js';
import { yolBolumu } from './yol-ui.js';
import { haritaKur } from './harita.js';
import { kaynaklariAyarla } from './stil.js';
import { GRAFIK, varsayilanGrafik } from './dunya3d.js';
import { parselPazarBolumu, pazarPaneli as pazarSekmesi, netOnizleme, borsaUrunSec, sevkiyatOnizle } from './pazar-ui.js';
import { hesapKur, hesapDurumuCiz, urlTokenleri, epostaDogrula, sikayetAc, hesapAc } from './hesap-ui.js';
import { canliBaslat, canliYenile, canliDinle, servisCalisaniKaydet } from './canli.js';
import { sohbetKur, sohbetKanallariniYenile } from './sohbet-ui.js';
import { meslekBolumu, kooperatifBolumu, albumBolumu, yarisKarti } from './topluluk-ui.js';
import { hayvanSatiri, susBolumu, ciftlikBolumu } from './ciftlik-ui.js';
import { ses, sesDurumu, sesAyarla, muzikAyarla } from './ses.js';
import { imeceKarti, komsularBolumu, parselKomsuDugmeleri, urunGonderFormu, yoreselBolumu, etkinlikBolumu } from './komsuluk-ui.js';
import { balikOyunu } from './balik-ui.js';
import { havaPenceresi, iklimSatiri, ortuSatiri } from './hava-ui.js';
import { carsiGirisi, dukkanHTML, bankaHTML } from './carsi-ui.js';
import { girisKur } from './giris-ui.js';
import { tanitimKur } from './tanitim-ui.js';
import { avatarSVG } from './avatar.js';
import { rehberKur } from './rehber.js';
import { ciftlikIciKur } from './ciftlik-ici.js';

const $ = (s, kok = document) => kok.querySelector(s);
const $$ = (s, kok = document) => [...kok.querySelectorAll(s)];

const durum = {
  kurallar: null,
  ben: null,            // /api/ben (girişliyse)
  kart: null,           // seçili parselin kartı
  secili: null,
  sekme: 'parsel',
  saatFarki: 0,         // sunucu saati - istemci saati
  harita: null,
  cuzdan: null,
  bolgeler: [],
  pazarAlt: 'gazete',   // Pazar sekmesinin alt sekmesi (açılışta günün gazetesi)
  pazarFiltre: { il: '', imar: '', sirala: 'yeni' },
  konum: null,          // haritanın merkezindeki il / ilçe (kırıntı ve "bu ildeki haberler")
  sahne: undefined,     // parsel 3B sahnesi (ilk kullanımda kurulur; WebGL yoksa null)
  akisFiltre: 'turkiye',
  mahalleId: null,      // haritada seçilen mahalle (mahalle sohbet kanalı)
};
const kipOku = () => { try { return localStorage.getItem('st-kip') || '2d'; } catch { return '2d'; } };
const kipYaz = (k) => { try { localStorage.setItem('st-kip', k); } catch { /* özel pencere */ } };

const IMAR_IKON = { KONUT: '🏠', TICARET: '🏪', TARIM: '🌾', SANAYI: '🏭', TURIZM: '🏨', KARMA: '🏙️', KORUMA: '🌲', PARK: '⛲', SU: '🌊', YOL: '🛣️' };
// Konum, akışta ayrı satırda gösterilir (mahalle · ilçe, il)
const AKIS_METIN = {
  DEMO_RESIDENT_ARRIVED: (a) => ['🧳', `Mahalleye yeni bir demo sakin geldi: <b>${esc(a.after?.ad)}</b>`],
  DEMO_RESIDENT_LEAVING: (a) => ['🚚', `<b>${esc(a.after?.ad)}</b> (demo sakin) mahalleden taşınıyor; parselleri satışta`],
  WEATHER_EVENT: (a) => [{ FIRTINA: '🌪️', SAGANAK: '🌊', DOLU: '🧊', SICAK: '🔥' }[a.after?.tur] || '⚠️', `<b>${esc(a.after?.il)}</b>: ${esc(a.after?.ad)} (${a.after?.etkilenen} varlık etkilendi)`],
  SHIPMENT_SENT: (a) => ['🚚', `<b>${esc(a.aktor)}</b> ${esc(urunAd(a.after?.urun))} sevkiyatı yola çıkardı`],
  SHIPMENT_DELIVERED: (a) => ['📦', `<b>${esc(a.aktor)}</b> ${a.after?.miktar} ${esc(urunAd(a.after?.urun))} teslim etti`],
  LEASE_STARTED: (a) => ['🔑', `<b>${esc(a.aktor)}</b> bir tarla kiraladı (${a.after?.gun} gün)`],
  LEASE_OFFERED: (a) => ['🏷️', `<b>${esc(a.aktor)}</b> tarlasını kiraya verdi: ${akce(a.after?.gunluk)}/gün`],
  COOP_FOUNDED: (a) => ['🤝', `<b>${esc(a.aktor)}</b> “${esc(a.after?.ad)}” kooperatifini kurdu`],
  COOP_JOINED: (a) => ['🤝', `<b>${esc(a.aktor)}</b> “${esc(a.after?.ad)}” kooperatifine katıldı`],
  LANDMARK_COLLECTED: (a) => ['📔', `<b>${esc(a.aktor)}</b> ${esc(a.after?.simge)} kartını topladı`],
  PRODUCTION_COLLECTED: (a) => ['⚙️', `<b>${esc(a.aktor)}</b> ${a.after?.miktar} ${esc(urunAd(a.after?.urun))} üretti`],
  SEASON_CLOSED: (a) => ['🏆', `Sezon kapandı; kürsü: ${esc((a.after?.ilk3 || []).join(', '))}`],
  PARCEL_ACQUIRED: (a) => ['📍', `<b>${esc(a.aktor)}</b> bir parsel edindi`],
  STRUCTURE_STARTED: (a) => ['🏗️', `<b>${esc(a.aktor)}</b> ${esc(yapiAd(a.after?.tip))} inşaatına başladı`],
  STRUCTURE_COMPLETED: (a) => ['✅', `<b>${esc(a.aktor)}</b> ${esc(yapiAd(a.after?.tip))} tamamladı`],
  CROP_PLANTED: (a) => ['🌱', `<b>${esc(a.aktor)}</b> ${esc(urunAd(a.after?.urun))} ekti`],
  CROP_HARVESTED: (a) => ['🧺', `<b>${esc(a.aktor)}</b> ${sayi(a.after?.miktar)} ${esc(urunAd(a.after?.urun))} hasat etti`],
  PARCEL_VISITED: (a) => ['👋', `<b>${esc(a.aktor)}</b>, ${esc(tamlayan(a.after?.sahip || ''))} parselini ziyaret etti`],
  LISTING_CREATED: (a) => ['🏷️', `<b>${esc(a.aktor)}</b> bir parseli ${akce(a.after?.fiyat)} fiyatla ilana çıkardı`],
  PARCEL_TRADED: (a) => ['🤝', `Bir parsel ${akce(a.after?.fiyat)} bedelle el değiştirdi: <b>${esc(a.after?.satici)}</b> → <b>${esc(a.aktor)}</b>`],
};
const yapiAd = (t) => durum.kurallar?.yapilar[t]?.ad || t;
const urunAd = (u) => durum.kurallar?.urunler[u]?.ad || u;
const urunIkon = (u) => durum.kurallar?.urunler[u]?.ikon || '🧺';
const sunucuSimdi = () => Date.now() + durum.saatFarki;
const girisli = () => !!durum.ben;

// ================= Seviye kutlaması: konfeti, büyük yıldız ve bu seviyede açılan bölümler =================
function seviyeKutla(seviye) {
  const acilan = ACILIMLAR.filter((a) => a.seviye === seviye);
  const k = document.createElement('div');
  k.className = 'seviye-kutlama';
  k.innerHTML = `<canvas></canvas><div class="sk-kart" role="dialog" aria-label="Seviye atladın">
      <div class="sk-yildiz">⭐<b>${seviye}</b></div><h2>Seviye ${seviye}!</h2><p>Aferin, çiftliğin büyüyor!</p>
      ${acilan.length ? `<div class="sk-acilan"><h4>Yeni açılanlar</h4>${acilan.map((a) => `<div><span>${a.ikon}</span><b>${esc(a.ad)}</b><small>${esc(a.metin)}</small></div>`).join('')}</div>` : ''}
      ${durum.ben?.seviye?.odulBekleyen ? '<p class="sk-odul">🎁 Seviye ödülün Çiftlik sekmesinde seni bekliyor</p>' : ''}
      <button type="button" class="sk-tamam">Harika!</button></div>`;
  document.body.appendChild(k);
  ses('seviye');
  // Konfeti
  const c = k.querySelector('canvas'), x = c.getContext('2d');
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; x.scale(devicePixelRatio, devicePixelRatio);
  const renkler = ['#f2c14e', '#3fa34d', '#e8483a', '#4fc1b5', '#f28cb1', '#7b6cf6'];
  const p = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.38, vx: (Math.random() - 0.5) * 14, vy: -6 - Math.random() * 10, r: 4 + Math.random() * 5, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, renk: renkler[Math.floor(Math.random() * renkler.length)] }));
  let kare = 0;
  const ciz = () => {
    x.clearRect(0, 0, innerWidth, innerHeight);
    for (const q of p) { q.vy += 0.32; q.vx *= 0.99; q.x += q.vx; q.y += q.vy; q.a += q.va; x.save(); x.translate(q.x, q.y); x.rotate(q.a); x.fillStyle = q.renk; x.fillRect(-q.r, -q.r / 2, q.r * 2, q.r); x.restore(); }
    if (p.some((q) => q.y < innerHeight + 20)) kare = requestAnimationFrame(ciz);
  };
  ciz();
  const kapat = () => { cancelAnimationFrame(kare); k.remove(); };
  k.querySelector('.sk-tamam').addEventListener('click', kapat);
  k.addEventListener('click', (e) => { if (e.target === k) kapat(); });
}

// ================= Çiftliğim (ana ekran) =================
const anaParsel = () => { const p = durum.ben?.portfoy || []; return (p.find((x) => x.imarAd === 'Tarım') || p[0])?.id || null; };
async function ciftligeGir(id = anaParsel()) {
  if (!id || !durum.harita) return;
  durum.harita.parseleGit(id, { zoom: 17.5, anlik: true });   // harita zaten çiftliğin arkasında kalır: uçuş animasyonu yok
  await parselSec(id, { haritadan: true });
  ciftlikDugmesiCiz();
}
// Ana ekran Çiftliğim: parseli olan oyuncu oyuna her girişte kendi çiftliğinde açılır. Yeni oyuncuysa (sihirbaz sürüyor)
// önce ilk giriş sihirbazı: arsa seçimi ya da çiftlikte adım adım tur.
async function oturumBasi() {
  if (durum.sihirbaz && await durum.sihirbaz.baslat()) return;
  if (anaParsel()) ciftligeGir();
}
// Harita açılışı: Türkiye görünümü yerine oyuncunun köyü (parseli, yoksa memleketi, yoksa Konya Meram)
function koyGorunumu() {
  const p = (durum.ben?.portfoy || []).find((x) => x.id === anaParsel());
  if (p?.lon) return { merkez: [p.lon, p.lat], zoom: 16.5 };
  const memleket = durum.ben?.hesap?.memleket || durum.ben?.memleket;   // sunucu memleketi hesap durumunda gönderir
  const il = memleket?.plaka && durum.bolgeler.find((b) => b.type === 'IL' && b.plaka === memleket.plaka);
  if (il) return { merkez: [il.center_lon, il.center_lat], zoom: 12.5 };
  return { merkez: [32.4325, 37.8397], zoom: 13 };
}
async function baslangicTarlasiAl() {
  try {
    const r = await api('/api/baslangic/tarla', {});
    tost(r.hediye > 0 ? `🎁 Tarlan hazır! Başlangıç hediyesi ${akce(r.hediye)} ile tahsis edildi` : `🌱 Tarlan hazır! ${akce(r.bedel ?? 0)} tahsis bedeliyle senin oldu`);
    ses('seviye');
    await benYenile({ sessiz: true });
    haritaYenile();
    await ciftligeGir(r.parsel);
  } catch (e) { tost(e.message, 'hata'); }
}
// Haritadayken "Çiftliğim" düğmesi: tek dokunuşla kendi çiftliğine döner
function ciftlikDugmesiKur() {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ciftlik-dugme'; b.id = 'ciftlikDugme'; b.hidden = true;
  b.innerHTML = '<span>🏡</span><b>Çiftliğim</b>';
  b.addEventListener('click', () => ciftligeGir());
  $('.sahne')?.appendChild(b);
  ciftlikDugmesiCiz();
}
function ciftlikDugmesiCiz() { const b = $('#ciftlikDugme'); if (b) b.hidden = !anaParsel(); }

// ================= Başlangıç =================
async function basla() {
  const [kurallar, bolgeler] = await Promise.all([api('/api/kurallar'), api('/api/bolgeler')]);
  durum.kurallar = kurallar;
  durum.bolgeler = bolgeler;
  kaynaklariAyarla(kurallar.haritaKaynak);
  const tokenler = urlTokenleri();
  await benYenile({ sessiz: true });
  if (tokenler.dogrula) await epostaDogrula(tokenler.dogrula);

  panelCiz();
  // Açılış hep düz (2B) Türkiye görünümü; kayıtlı 3B tercihi yalnızca konumlu bağlantıyla (#konum, ?parsel) açılınca uygulanır
  const yakinKonum = Number((/konum=([\d.]+)/.exec(location.hash) || [])[1] || 0) >= 6.5;   // ülke ölçeğindeki eski #konum sayılmaz
  const baslangicKip = yakinKonum || new URLSearchParams(location.search).has('parsel') ? kipOku() : '2d';
  kipDugmesiCiz(baslangicKip);
  // Açılış ekranı: Google/Apple dönüşü, sıfırlama bağlantısı, iki adımlı kod ya da giriş yapmamış ziyaretçi (harita arkada yüklenir)
  if (durum.ikinciAdimBekleniyor) giris.ac('ikiAdim');
  else giris.adresIsle({ girisli: girisli(), sifirla: tokenler.sifirla }).then((r) => { if (r === 'hesap') hesapAc('guvenlik'); });
  durum.harita = await haritaKur($('#harita'), {
    parselTik: (id) => parselSec(id, { haritadan: true }),   // kendi parselime haritadan dokununca tam sayfa çiftliğe girilir
    carsiTik: (k) => { durum.carsiAlt = k; sekmeSec('carsi'); },
    ilTik: ilSec,
    ilceTik: ilceSec,
    mahalleAlanTik: mahalleAlanSec,
    konumDegisti,
    kip: baslangicKip,
    tema: gorunumTercihi(),
    grafik: tercihOku('st-grafik', varsayilanGrafik()),
    koy: koyGorunumu(),
  });
  // Rehber (görev şeridi) ve etkinlik şeridi
  durum.rehber = rehberKur({ durum, harita: durum.harita, parselSec, sekmeSec, ciftlikAlt, tarlaAl: baslangicTarlasiAl });
  durum.ciftlikIci = ciftlikIciKur({ durum, eylemDagit, sunucuSimdi, ayrintiAc: () => sekmeSec('parsel'), dunyayaCik: () => { ciftlikDugmesiCiz(); if (durum.kart) sekmeSec('parsel'); }, tostDis: tost, tarlayaGec: (id) => ciftligeGir(id),
    ziyaretEt: async (id) => { durum.harita.parseleGit(id, { zoom: 17.5, anlik: true }); await parselSec(id); durum.ciftlikIci?.ac({ ziyaret: true }); },
    yenileDis: async () => { await benYenile({ sessiz: true }); if (durum.secili) durum.kart = await api(`/api/parsel/${encodeURIComponent(durum.secili)}`).catch(() => durum.kart); haritaYenile(); durum.ciftlikIci.yenile(); } });
  durum.sihirbaz = sihirbazKur({ durum, tost, ses, benYenile, haritaYenile, ciftligeGir, sunucuSimdi });
  ciftlikDugmesiKur();
  durum.rehber.guncelle();
  etkinlikYenile();
  gorunumMenusuCiz();
  durum.harita.yoreselGoster(durum.kurallar.yoresel);
  carsiSubeleriYukle();
  $('#harita').addEventListener('kip', (e) => kipDugmesiCiz(e.detail));
  // Işık: gerçek saat (gece karanlık, alacakaranlık turuncu) ya da hep gündüz; tercih tarayıcıda saklanır
  const isikCiz = (a) => { $('#isikDugme').textContent = a === 'gunduz' ? '☀️' : '🌗'; $('#isikDugme').title = a === 'gunduz' ? 'Işık: hep gündüz' : 'Işık: gerçek saat'; };
  let isikTercihi = 'gercek';
  try { isikTercihi = localStorage.getItem('st-isik') || 'gercek'; } catch { /* özel pencere */ }
  durum.harita.isikAyari(isikTercihi);
  isikCiz(isikTercihi);
  $('#isikDugme').addEventListener('click', () => {
    isikTercihi = isikTercihi === 'gunduz' ? 'gercek' : 'gunduz';
    try { localStorage.setItem('st-isik', isikTercihi); } catch { /* yok say */ }
    durum.harita.isikAyari(isikTercihi);
    isikCiz(isikTercihi);
    tost(isikTercihi === 'gunduz' ? '☀️ Harita hep gündüz' : '🌗 Harita ışığı gerçek saate göre');
  });
  if (durum.ben) durum.harita.benimParsellerim(durum.ben.portfoy);

  // Bağlantıda parsel varsa (#parsel=TR-…) aç
  const bagParsel = new URLSearchParams(location.search).get('parsel');
  if (bagParsel) { durum.harita.parseleGit(bagParsel, { zoom: 17.5 }); parselSec(bagParsel); }

  canliBaslat();
  servisCalisaniKaydet(baglantiyaGit);
  havaYenile();
  durum.harita.gunesGuncelle();
  setInterval(() => { if (!document.hidden) { havaYenile(); havaSeridiYenile({ zorla: true }); durum.harita.gunesGuncelle(); } }, 10 * 60_000);
  // Güneş/ışık yalnızca harita belirgin kaydığında (0,2°) ya da dakikada bir güncellenir: her kaydırmada ışık, gökyüzü ve
  // arazi yeniden ayarlanınca 3B dünya baştan kuruluyordu
  let gunesSon = { t: 0, lon: 0, lat: 0 };
  durum.harita.map.on('moveend', () => {
    const c = durum.harita.map.getCenter(), t = Date.now();
    if (t - gunesSon.t < 60_000 && Math.abs(c.lng - gunesSon.lon) < 0.2 && Math.abs(c.lat - gunesSon.lat) < 0.2) return;
    gunesSon = { t, lon: c.lng, lat: c.lat };
    durum.harita.gunesGuncelle();
  });
  sohbetKanallariniYenile();
  const git = new URLSearchParams(location.hash.slice(1)).get('git');
  if (git) baglantiyaGit(git);
  // Çiftliğim ana ekran: parseli olan oyuncu oturumun başında doğrudan kendi çiftliğinde açılır (bağlantıyla gelmediyse)
  else if (!bagParsel) oturumBasi();

  setInterval(sayaclariGuncelle, 1000);
  // Bildirimler canlı kanaldan anında gelir; bu yoklama yalnızca kaçanlar için (her oyuncu 30 sn'de bir değil, 2 dk'da bir)
  setInterval(() => { if (girisli() && !document.hidden) benYenile({ sessiz: true }); }, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && girisli()) benYenile({ sessiz: true }); });
}

async function havaYenile() {
  try { durum.harita?.havaGoster((await api('/api/hava')).iller); } catch { /* hava isteğe bağlıdır */ }
}
// Çiftliğin havası (hava penceresi için): giriş yapmış oyuncuya, dakikada en çok bir istek. Haritanın üstündeki hava
// şeridi kaldırıldı (v0.43: haritayı kalabalıklaştırıyordu); pencere Çiftlik sekmesindeki "Çiftliğinin havası"ndan açılır,
// riskli hava uyarıları ayrıca bildirim olarak gelir (iklim.js).
let havaSeridiZaman = 0;
async function havaSeridiYenile({ zorla = false } = {}) {
  if (!girisli()) { durum.benimHavam = null; return; }
  if (!zorla && Date.now() - havaSeridiZaman < 60_000) return;
  havaSeridiZaman = Date.now();
  try { durum.benimHavam = await api('/api/hava/benim'); } catch { return; }
  if ($('#genelModal').open && $('#genelGovde .hava-penceresi')) $('#genelGovde').innerHTML = `<div class="hava-penceresi">${havaPenceresi(durum.benimHavam)}</div>`;
}
async function havaPenceresiAc() {
  if (!girisli()) { tost('Çiftliğinin havasını görmek için giriş yap', 'hata'); return; }
  await havaSeridiYenile({ zorla: true });
  if (durum.benimHavam) genelPencere(`<div class="hava-penceresi">${havaPenceresi(durum.benimHavam)}</div>`);
}
let oncekiBen = null;
async function benYenile({ sessiz = false } = {}) {
  try {
    const onceki = durum.ben?.bakiye;
    oncekiBen = durum.ben;
    const ben = await api('/api/ben');
    durum.ikinciAdimBekleniyor = !!ben?.ikinciAdimBekleniyor;
    durum.ben = ben?.kullanici ? ben : null;
    if (durum.ben) durum.saatFarki = durum.ben.simdi - Date.now();
    const oncekiSeviye = oncekiBen?.seviye?.seviye;
    if (oncekiSeviye && durum.ben?.seviye?.seviye > oncekiSeviye) setTimeout(() => seviyeKutla(durum.ben.seviye.seviye), 400);
    if (onceki != null && durum.ben && onceki !== durum.ben.bakiye) {
      $('#bakiye').classList.remove('parla'); void $('#bakiye').offsetWidth; $('#bakiye').classList.add('parla');
    }
  } catch (e) {
    // Yalnızca oturum gerçekten yoksa (401) çıkış sayılır; kısa bir ağ kesintisi oyuncuyu çıkarmasın (ve dönüşte
    // oturumBasi yeniden çalışıp çiftliğe atmasın)
    if (e instanceof ApiHatasi && e.status === 401) durum.ben = null;
    else if (!sessiz) tost(e.message, 'hata');
  }
  ustCiz();
  durum.rehber?.guncelle();
  havaSeridiYenile();
  hesapDurumuCiz(durum.ben);
  durum.harita?.benimParsellerim(durum.ben?.portfoy || []);
  ciftlikDugmesiCiz();
  if (!oncekiBen && durum.ben && durum.ciftlikIci) oturumBasi();   // yeni giriş yapıldıysa çiftliğe (ya da sihirbaza)
}

function haritaYenile() {
  return durum.harita?.yenile();
}

// ---------- Konum kırıntısı: Türkiye › İl › İlçe ----------
let konumZamanlayici = 0;
let sonSohbetIl = null;
function konumDegisti(merkez, zoom) {
  clearTimeout(konumZamanlayici);
  konumZamanlayici = setTimeout(async () => {
    durum.konum = zoom >= 6.5 ? await api(`/api/konum?lon=${merkez.lng.toFixed(5)}&lat=${merkez.lat.toFixed(5)}`).catch(() => null) : null;
    kirintiCiz();
    if (durum.konum?.ilId !== sonSohbetIl) { sonSohbetIl = durum.konum?.ilId; sohbetKanallariniYenile(); }
    if (durum.sekme === 'haberler' && durum.akisFiltre === 'il') panelCiz();
  }, 250);
}
function kirintiCiz() {
  const k = durum.konum;
  $('#kirinti').innerHTML = `<button type="button" data-git="turkiye">Türkiye</button>${k ? `<span>›</span>
    <button type="button" data-git="il" data-plaka="${esc(k.plaka)}">${esc(k.il)}</button><span>›</span>
    <button type="button" data-git="ilce" data-ilce="${esc(k.ilceId)}">${esc(k.ilce)}</button>` : ''}`;
}
$('#kirinti').addEventListener('click', (e) => {
  const b = e.target.closest('[data-git]');
  if (!b) return;
  if (b.dataset.git === 'turkiye') durum.harita.turkiyeyeGit();
  else if (b.dataset.git === 'il') ilSec(b.dataset.plaka);
  else {
    const r = durum.bolgeler.find((x) => String(x.id) === b.dataset.ilce);
    if (r) durum.harita.yereGit({ bbox: r.bbox, zoom: 13 });
  }
});
// İl → ilçeleri görünür, ilçe → mahalle alanları, mahalle → yakınlaş ve mahalle panelini aç
function ilSec(plaka) {
  const il = durum.bolgeler.find((r) => r.type === 'IL' && r.plaka === plaka);
  if (!il) return;
  durum.harita.yereGit({ bbox: il.bbox, zoom: 9.6 });
  durum.harita.ilceleriGoster(plaka);
}
function ilceSec(id) {
  const ilce = durum.bolgeler.find((r) => r.type === 'ILCE' && r.id === Number(id));
  if (!ilce) return;
  durum.harita.ilceleriGoster(ilce.plaka);
  durum.harita.yereGit({ bbox: ilce.bbox, zoom: 12.6 });
  durum.harita.mahalleleriGoster(ilce.id).then((bilgi) => { if (bilgi) tost(`📍 ${bilgi.ad}: ${bilgi.mahalleSayisi} mahalle ve köy`); });
}
async function mahalleAlanSec(ilceId, yerId, lngLat) {
  try {
    const r = await api(`/api/ilce/${ilceId}/mahalle`, { yerId });
    durum.harita.yereGit({ merkez: [lngLat.lng, lngLat.lat], zoom: 14.6 });
    if (r.id) { mahalleSec(r.id); tost(`📍 ${r.ad || 'Mahalle'}`); }
    else tost(`📍 ${r.ad}: henüz oyuncu yok. Giriş yapıp ilk parseli sen edinebilirsin.`);
  } catch (e) { tost(e.message, 'hata'); }
}

// Düğme sesi (hafif tık)
document.addEventListener('click', (e) => { if (e.target.closest('.dugme, .sekmeler button, .kip-secici button, .sus-oge')) ses('tik'); }, true);

// ---------- Görünüm (tema, grafik) ve sinematik tur ----------
function tercihOku(k, v) { try { return localStorage.getItem(k) || v; } catch { return v; } }
// Görünüm: yalnızca çiftlik ya da harita (eski denemelerden kalan değerler çiftliğe döner)
const gorunumTercihi = () => (tercihOku('st-gorunum', 'ciftlik') === 'harita' ? 'harita' : 'ciftlik');
function tercihYaz(k, v) { try { localStorage.setItem(k, v); } catch { /* özel pencere */ } }
function gorunumMenusuCiz() {
  const tema = durum.harita?.tema() || gorunumTercihi();
  const grafik = tercihOku('st-grafik', varsayilanGrafik());
  $$('#gorunumMenu [data-tema]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tema === tema)));
  $$('#gorunumMenu [data-grafik]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.grafik === grafik)));
  const sd = sesDurumu();
  $$('#gorunumMenu [data-ses]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.ses === 'acik') === sd.ses)));
  $$('#gorunumMenu [data-muzik]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.muzik === 'acik') === sd.muzik)));
  const hareket = durum.harita?.hareketli() ?? true;
  $$('#gorunumMenu [data-hareket]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.hareket === 'acik') === hareket)));
}
function gorunumMenusu(ac) {
  const m = $('#gorunumMenu');
  m.hidden = !ac;
  $('#ayarDugme').setAttribute('aria-expanded', String(ac));
  if (ac) gorunumMenusuCiz();
}
$('#ayarDugme').addEventListener('click', (e) => { e.stopPropagation(); gorunumMenusu($('#gorunumMenu').hidden); });
document.addEventListener('click', (e) => { if (!e.target.closest('#gorunumMenu, #ayarDugme')) gorunumMenusu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#gorunumMenu').hidden) gorunumMenusu(false); });
$('#gorunumMenu').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tema]'), g = e.target.closest('[data-grafik]'), h = e.target.closest('[data-hareket]');
  const sb = e.target.closest('[data-ses]'), mb = e.target.closest('[data-muzik]');
  if (sb) sesAyarla(sb.dataset.ses === 'acik');
  if (mb) muzikAyarla(mb.dataset.muzik === 'acik');
  if (h && durum.harita) {
    durum.harita.hareketAyarla(h.dataset.hareket === 'acik');
    tost(h.dataset.hareket === 'acik' ? '🚜 Araçlar, hayvanlar ve kuşlar açık' : '⏸ Hareketli öğeler kapalı');
  }
  if (!durum.harita) return;
  if (t) {
    tercihYaz('st-gorunum', t.dataset.tema);
    durum.harita.temaAyarla(t.dataset.tema);
    tost(t.dataset.tema === 'ciftlik' ? '🌾 Çiftlik görünümü' : '🗺️ Harita görünümü');
  }
  if (g) {
    tercihYaz('st-grafik', g.dataset.grafik);
    durum.harita.grafikAyarla(g.dataset.grafik);
    tost(`Grafik: ${GRAFIK[g.dataset.grafik].ad}${g.dataset.grafik === 'hafif' ? ' — 3B dünya kapalı' : ''}`);
  }
  gorunumMenusuCiz();
});
let turuDurdur = null;
$('#turDugme').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!durum.harita) return;
  if (turuDurdur) { turuDurdur(); return; }
  if (durum.harita.tema() === 'harita') { durum.harita.temaAyarla('ciftlik'); tercihYaz('st-gorunum', 'ciftlik'); gorunumMenusuCiz(); }
  $('#turDugme').textContent = '⏹';
  $('#turDugme').title = 'Turu durdur';
  turuDurdur = durum.harita.turBaslat(() => { turuDurdur = null; $('#turDugme').textContent = '🎬'; $('#turDugme').title = 'Sinematik Türkiye turu'; });
  tost('🎬 Türkiye turu başladı — haritaya dokununca durur');
});

// ---------- 2B / 3B ----------
function kipDugmesiCiz(kip) {
  $$('#kipSecici [data-kip]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kip === kip)));
  kipYaz(kip);
}
$('#kipSecici').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kip]');
  if (!b || !durum.harita) return;
  durum.harita.kipAyarla(b.dataset.kip);
  kipDugmesiCiz(b.dataset.kip);
  if (b.dataset.kip === '3d' && durum.harita.zoom() < 13) tost('3B görünüm için bir yere yakınlaş: arazi, binalar ve yapılar hacim kazanır');
});

// ---------- Arama: il / ilçe / mahalle / köy ----------
let aramaZamanlayici = 0, aramaSonuclari = [];
$('#arama').addEventListener('input', (e) => {
  clearTimeout(aramaZamanlayici);
  const q = e.target.value.trim();
  if (q.length < 2) { $('#aramaSonuc').hidden = true; return; }
  aramaZamanlayici = setTimeout(async () => {
    aramaSonuclari = await api(`/api/ara?q=${encodeURIComponent(q)}`).catch(() => []);
    const kutu = $('#aramaSonuc');
    kutu.innerHTML = aramaSonuclari.length ? aramaSonuclari.map((r, i) => `
      <li role="option"><button type="button" data-i="${i}"><span class="arama-ikon">${r.tur === 'il' ? '🏛️' : r.tur === 'ilce' ? '🏘️' : '📍'}</span>
        <span><b>${esc(r.ad)}</b><small>${esc(r.ust)}</small></span></button></li>`).join('')
      : '<li class="arama-bos">Sonuç yok. Mahalle ve köy adları haritada gezildikçe dizine eklenir.</li>';
    kutu.hidden = false;
  }, 220);
});
$('#arama').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && aramaSonuclari[0]) aramaSec(aramaSonuclari[0]);
  if (e.key === 'Escape') $('#aramaSonuc').hidden = true;
});
$('#aramaSonuc').addEventListener('click', (e) => {
  const b = e.target.closest('[data-i]');
  if (b) aramaSec(aramaSonuclari[Number(b.dataset.i)]);
});
function aramaSec(r) {
  $('#aramaSonuc').hidden = true;
  $('#arama').value = r.ad;
  $('#arama').blur();
  if (r.tur === 'yer') durum.harita.yereGit({ merkez: r.merkez, zoom: 15.6 });
  else durum.harita.yereGit({ bbox: r.bbox, zoom: r.tur === 'il' ? 10.5 : 13 });
}
document.addEventListener('click', (e) => { if (!e.target.closest('.arama')) $('#aramaSonuc').hidden = true; });

// ================= Üst çubuk =================
function ustCiz() {
  const b = durum.ben;
  $('#bakiye').hidden = !b;
  $('#girisDugme').hidden = !!b;
  $('#kullanici').hidden = !b;
  if (b) {
    $('#bakiyeDeger').textContent = akce(b.bakiye).slice(1);   // sembol ayrı (₺)
    $('#kullaniciAd').innerHTML = `${avatarSVG(b.hesap?.avatar, 26)}<span>${esc(b.kullanici.ad)}</span>`;
    const kalan = b.gorevler.filter((g) => !g.tamam).length + (b.seviye?.odulBekleyen ? 1 : 0) + (b.gunlukOdul ? 1 : 0);
    $('#gorevRozet').hidden = !kalan;
    $('#gorevRozet').textContent = kalan;
    if (b.seviye) {
      $('#seviye').hidden = false;
      $('#seviyeDeger').textContent = b.seviye.seviye;
      const s = b.seviye;
      $('#seviyeCubuk').style.width = `${s.sonraki ? Math.min(100, ((s.tp - s.esik) / (s.sonraki - s.esik)) * 100) : 100}%`;
      $('#seviye').title = `Seviye ${s.seviye} · ${s.tp} TP${s.sonraki ? ` / ${s.sonraki}` : ''}`;
    }
    const pz = b.pazar;
    $('#kilitli').hidden = !pz.kilitli;
    $('#kilitliDeger').textContent = akce(pz.kilitli);
    $('#bildirimRozet').hidden = !pz.okunmamis;
    $('#bildirimRozet').textContent = pz.okunmamis > 99 ? '99+' : pz.okunmamis;
    $('#pazarRozet').hidden = !pz.gelenTeklif;
    $('#pazarRozet').textContent = pz.gelenTeklif;
    $('#bakiye').title = `Kullanılabilir: ${akce(b.bakiye)}${pz.kilitli ? ` · Tekliflerde kilitli: ${akce(pz.kilitli)}` : ''}. Oyun parasıdır, nakde çevrilemez.`;
  } else {
    $('#gorevRozet').hidden = true;
    $('#pazarRozet').hidden = true;
    $('#kilitli').hidden = true;
  }
  $('#bildirimDugme').hidden = !b;
}

// ================= Panel =================
// Sekmeler 4 ana bölümde toplanır (Çiftlik, Pazar, Köy, Ben); seçili parsel varsa başta "Parsel" görünür.
// Pazar = pazar + çarşı (bölümün üstünde alt sekmeler çıkar), Köy = haberler. İç sekme adları değişmedi.
const SEKME_GRUP = { pazar: ['pazar', 'carsi'], carsi: ['pazar', 'carsi'] };
const ALT_AD = { pazar: '📈 Pazar', carsi: '🏪 Çarşı' };
const grupBasi = (ad) => SEKME_GRUP[ad]?.[0] || ad;
// Seviyeyle açılan bölümler: yeni oyuncuyu derin sistemlerle boğmamak için (kurallar sunucuda ayrıca denetlenir)
const ACILIMLAR = [
  { seviye: 3, kod: 'balik', ikon: '🎣', ad: 'Balık tutma', metin: 'Göl, nehir ya da kıyıda balık tut; nadir balıkları koleksiyonuna ekle.' },
  { seviye: 3, kod: 'komsuluk', ikon: '🤝', ad: 'Komşuluk', metin: 'Komşu ol, birbirinizin tarlasını sulayın, hediye gönderin.' },
  { seviye: 4, kod: 'carsi', ikon: '🏪', ad: 'Çarşı', metin: 'Banka, nalbur, market ve zirai bayi: gübre, ilaç, aşı ve daha fazlası.' },
];
const seviyem = () => durum.ben?.seviye?.seviye || 1;
const acikMi = (kod) => { const a = ACILIMLAR.find((x) => x.kod === kod); return !a || !durum.ben || seviyem() >= a.seviye; };
function kilitliBolum(kod) {
  const a = ACILIMLAR.find((x) => x.kod === kod);
  return `<div class="kilit-ekrani"><div class="kilit-ikon">${a.ikon}<span>🔒</span></div><h3>${esc(a.ad)}</h3><p>${esc(a.metin)}</p>
    <div class="kilit-seviye">Seviye ${sayiBulunma(a.seviye)} açılır · sen şu an seviye ${seviyem()}</div>
    <div class="cubuk altin"><span style="width:${Math.min(100, (seviyem() / a.seviye) * 100)}%"></span></div>
    <p class="kucuk">Ekip biç, sat ve siparişleri teslim et: TP kazanıp seviye atlarsın.</p></div>`;
}
function sekmeSec(ad) {
  panelAc();
  durum.sekme = ad;
  durum.grupSon ??= {};
  if (SEKME_GRUP[ad]) durum.grupSon[grupBasi(ad)] = ad;
  $$('.sekmeler button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sekme === grupBasi(ad))));
  $('#panelIcerik').scrollTop = 0;
  panelCiz();
  if (ad === 'arazilerim' && girisli()) cuzdanYukle();
}

// Çizim sırası: hızlı sekme değişiminde geç gelen eski yanıt yeni sekmenin üstüne yazılmasın
let panelCizimNo = 0;
async function panelCiz() {
  const kap = $('#panelIcerik');
  const no = ++panelCizimNo;
  const ciz = {
    parsel: parselPaneli, arazilerim: arazilerimPaneli, gorevler: gorevlerPaneli, carsi: carsiPaneli, pazar: pazarPaneli, haberler: haberlerPaneli,
  }[durum.sekme];
  $('.sekmeler [data-sekme="parsel"]').hidden = !durum.kart;
  const grup = SEKME_GRUP[durum.sekme];
  const ust = grup ? `<div class="alt-sekmeler">${grup.map((x) => `<button type="button" data-eylem="sekme-git" data-sekme="${x}" aria-selected="${x === durum.sekme}">${ALT_AD[x]}${acikMi(x) ? '' : ' 🔒'}</button>`).join('')}</div>` : '';
  let govde;
  try { govde = acikMi(durum.sekme) ? await ciz() : kilitliBolum(durum.sekme); }
  catch (e) { govde = `<div class="bos-durum"><div class="buyuk-ikon">⚠️</div><h3>Yüklenemedi</h3><p>${esc(e.message)}</p><button type="button" class="dugme ince" data-eylem="panel-yenile">Tekrar dene</button></div>`; }
  if (no !== panelCizimNo) return;
  kap.innerHTML = ust + govde;
  // Dar ekranda sekme çubuğu kayar: seçili sekme görünür alana gelsin
  for (const b of kap.querySelectorAll('.segment [aria-selected="true"], .alt-sekmeler [aria-selected="true"]')) {
    const s = b.parentElement;
    if (s.scrollWidth > s.clientWidth) s.scrollLeft = b.offsetLeft - s.offsetLeft - (s.clientWidth - b.offsetWidth) / 2;
  }
}

// ---------- Çarşı: banka, nalbur, market, zirai bayi (her türden tek işletme; sponsor markası sunucudan)
async function carsiPaneli() {
  const k = durum.carsiAlt;
  try {
    if (!k) return carsiGirisi(await api('/api/carsi'));
    if (k === 'BANKA') return girisli() ? bankaHTML(await api('/api/banka')) : girisIste('Bankayı kullanmak için giriş yap');
    return dukkanHTML(await api(`/api/carsi/${encodeURIComponent(k)}`), { girisli: girisli(), bakiye: durum.ben?.bakiye || 0, envanter: durum.ben?.envanter || [], kurallar: durum.kurallar });
  } catch (e) { return `<p class="kucuk">${esc(e.message)}</p>`; }
}
async function carsiSubeleriYukle() {
  try {
    const [subeler, c] = await Promise.all([api('/api/carsi/subeler'), api('/api/carsi')]);
    durum.harita?.carsiGoster(subeler, c.isletmeler);
  } catch { /* şubeler süs; yüklenmezse harita yine çalışır */ }
}
const stokta = (kod) => (durum.ben?.envanter || []).find((i) => i.item_id === kod)?.miktar || 0;

const girisIste = (metin) => `
  <div class="bos-durum"><div class="buyuk-ikon">🗝️</div><h3>${metin}</h3>
  <p>Ücretsiz hesap aç, ${akce(500)} hoş geldin hibesiyle başla.</p>
  <button class="dugme birincil" data-eylem="giris-ac">Ücretsiz başla</button></div>`;

// ---------- Parsel kartı ----------
const FIYAT_OLAY = { TAHSIS: ['🏷️', 'Tahsis'], SATIS: ['🤝', 'Satış'], HAZINE: ['🏛️', 'Hazine aldı'], BASLANGIC: ['🌱', 'Başlangıç'] };
// Sahibine: Hazine'nin alım teklifi (kâr her zaman paraya döner); uygun değilse sebebi
function hazineKutusu(h, g) {
  if (!h) return '';
  const kar = g ? h.teklif + g.kira - g.maliyet : null;
  return `<div class="hazine-kutu"><div class="kucuk">🏛️ Hazine alım teklifi · değerin %${Math.round(h.oran * 100)}'i</div>
    <div class="satir"><div><b>${akce(h.teklif)}</b>
      ${kar != null ? `<div class="kucuk ${kar >= 0 ? 'arti' : 'eksi'}">Satarsan ${kar >= 0 ? 'kâr +' : 'zarar −'}${akce(Math.abs(kar))}</div>` : ''}</div>
      <button type="button" class="dugme ince" data-eylem="hazineye-sat" data-teklif="${h.teklif}" ${h.uygun ? '' : 'disabled'}>Hazine'ye sat</button></div>
    ${h.uygun ? '<p class="kucuk">Alıcı beklemeden anında para. Parsel, yapıları ve süsleriyle Hazine\'ye geçer.</p>'
      : `<p class="sebep">${esc(h.sebep)}${h.acilis ? ` · <span data-bitis="${h.acilis}">${sure(h.acilis - sunucuSimdi())}</span> sonra` : ''}</p>`}
    <p class="kucuk">Teklifte kendi parsellerin ve yatırımların mahalle endeksine sayılmaz. Daha yüksek fiyat için pazarda ilana çıkarabilirsin.</p></div>`;
}
function degerKutusu(k) {
  const d = k.deger, pi = k.piyasa, g = k.getirim;
  const endeks = `<span class="endeks-cip" title="Mahalle arsa endeksi (100 = tahsis bedeli)">📈 ${esc(k.mahalle)} ${sayi(pi.endeks)}</span> ${degisimCipi(pi.degisim7, ' 7g')}`;
  const bos = !k.sahip;
  const gecmis = [...pi.fiyatGecmisi.map((x) => ({ ...x, ikon: FIYAT_OLAY[x.tur][0], ad: FIYAT_OLAY[x.tur][1] })),
    { ikon: '📍', ad: 'Bugün · tahmini', fiyat: d.toplam, tarih: Date.now(), kim: '' }];
  return `<div class="kutu deger-kutu">
    <div class="satir"><div><div class="kucuk">${bos ? 'Bugünkü tahmini değer' : 'Tahmini değer'}</div><b class="fiyat">${akce(d.toplam)}</b></div><div class="sag">${endeks}</div></div>
    ${bos ? `<p class="kucuk">Tahsis fiyatı güncel endeksle belirlenir: bugün ${akce(k.birincilBedel)}. Mahalle geliştikçe değeri artar.</p>` : ''}
    ${konumCipleri(k.konumDegeri)}
    <div class="deger-dokum"><span title="Taban bedel ${akce(d.tahsis)} × endeks ${sayi(pi.endeks)}">🌱 Arsa <b>${akce(d.arsa)}</b></span><span>🏠 Yapılar <b>${akce(d.yapilar)}</b></span><span>🌼 Süsler <b>${akce(d.susler)}</b></span></div>
    ${g ? `<div class="getiri-satir"><span>Alış ${akce(g.alis)}</span><span>Yatırım ${akce(g.yatirim)}</span>${g.kira ? `<span>Kira ${akce(g.kira)}</span>` : ''}
      <b class="${g.getiri >= 0 ? 'arti' : 'eksi'}">${g.getiri >= 0 ? 'Kâr +' : 'Zarar −'}${akce(Math.abs(g.getiri))}${g.getiriYuzde != null ? ` (%${sayi(Math.abs(g.getiriYuzde))})` : ''}</b></div>` : ''}
    ${hazineKutusu(k.hazine, g)}
    <div class="kucuk grafik-baslik">${esc(k.mahalle)} arsa endeksi${pi.seri.length > 1 ? ` · son ${pi.seri.length} gün` : ''}</div>
    ${endeksGrafigi(pi.seri, { yukseklik: 104 })}
    ${girisli() && pi.endeks != null ? `<form class="alarm-form satir" data-bolge="${k.mahalleId}"><label class="kucuk">🔔 Endeks
        <input type="number" name="hedef" step="1" min="1" value="${Math.round(pi.endeks * 1.1)}" aria-label="Hedef endeks"></label>
        <button class="dugme ince">olunca haber ver</button></form>` : ''}
    <details class="acilir"><summary>Fiyat geçmişi (${pi.fiyatGecmisi.length})</summary>
      <ul class="zaman-cizgisi">${gecmis.slice().reverse().map((x) => `<li><span>${x.ikon} ${esc(x.ad)}${x.fiyat != null ? ` · <b>${akce(x.fiyat)}</b>` : ''}${x.kim ? ` · ${esc(x.kim)}` : ''}</span><time>${kisaTarih(x.tarih)}</time></li>`).join('')}</ul></details>
    <p class="kucuk">Arsa = taban bedel × mahalle endeksi. Taban bedel konumdan gelir: ilin ve ilçenin fiyat seviyesi, denize ve merkeze yakınlık, düz ya da dağlık arazi, yol. Endeks mahalledeki talep, yatırımlar ve gerçek satışlarla değişir; yapılar bakım durumuyla değerlenir. Oyun içi göstergedir.</p></div>`;
}

function parselPaneli() {
  const k = durum.kart;
  // Tarlası olan oyuncuya "parsel seç" yerine çiftliğine dönüş (açılışta çiftlik yüklenirken de bu görünür)
  if (!k && anaParsel()) {
    return `<div class="bos-durum"><div class="buyuk-ikon">🏡</div><h3>Çiftliğin seni bekliyor</h3>
      <p>Haritada gezinebilir ya da başka bir parsele dokunabilirsin.</p>
      <button type="button" class="dugme altin" data-eylem="ciftlige-gir">Çiftliğime git</button></div>`;
  }
  if (!k) {
    return `<div class="bos-durum"><div class="buyuk-ikon">🗺️</div><h3>Bir parsel seç</h3>
      <p>Haritada bir parsele dokun. Yeşil parseller tarım; ilk tarlan için iyi bir başlangıç.</p>
      ${girisli() ? '' : '<p class="kucuk">Gezinmek için hesap gerekmez.</p>'}</div>`;
  }
  const imar = k.imar;
  const ben = k.sahip?.ben;
  const parcalar = [];

  // Başlık (dönen 3B maket kaldırıldı: parselin görünümü tam sayfa çiftlikte)
  parcalar.push(`
    <p class="mono">${k.adaParsel ? `Ada ${k.adaParsel.ada} · Parsel ${k.adaParsel.parsel} · ` : ''}${esc(k.id)}</p>
    <h2 class="kart-baslik">${esc(k.mahalle)}</h2>
    <p class="alt-yazi">${esc(k.ilce)} · ${esc(k.il)} <span class="plaka">${esc(k.plaka)}</span></p>
    <span class="cip" style="background:${imar.renk}">${IMAR_IKON[imar.tip] || ''} ${esc(imar.ad)}</span>
    ${k.pazar?.ilan ? `<span class="cip satilik-cip">🏷️ Satılık · ${akce(k.pazar.ilan.fiyat)}</span>` : ''}
    <dl class="istatistik">
      <div><dt>Alan (oyun)</dt><dd>${sayi(k.alan)} m²</dd></div>
      <div><dt>TAKS / KAKS</dt><dd>${sayi(imar.taks)} / ${sayi(imar.kaks)}</dd></div>
      <div><dt>Durum</dt><dd>${k.durum === 'ACTIVE' ? 'Aktif' : 'Dondurulmuş'}</dd></div>
      <div title="Yapılar, faaliyet ve mahalle çekiciliğinden oluşan gösterge. Fiyat tahmini değildir."><dt>Gelişmişlik skoru ⓘ</dt><dd>${k.gelismislikSkoru}/100</dd></div>
    </dl>`);

  // Sahiplik kutusu
  if (imar.parselDegil) {
    parcalar.push(`<div class="kutu"><b>${esc(imar.ad)} · parsel değil</b><p class="kucuk">${esc(imar.aciklama)} Yakındaki bir hücreye dokun.</p></div>`);
  } else if (!k.sahip && k.simge) {
    // Simge parsel: sahiplik kutusu yerine aşağıdaki simge kartı (Kartı topla) gösterilir
  } else if (!k.sahip && k.ihalede) {
    parcalar.push(`<div class="kutu vurgulu"><b>🔨 Bu tarla bu hafta ihalede</b>
      <p class="kucuk">Olağan yoldan edinilemez; en yüksek teklifi veren alır.</p>
      <button type="button" class="dugme birincil genis" data-eylem="pazar-alt" data-alt="ihale">İhaleye git</button></div>`);
  } else if (!k.sahip && k.birincilBedel != null) {
    parcalar.push(`<div class="kutu vurgulu">
      <div class="satir"><div><b>Boş parsel</b><div class="kucuk">Birincil tahsis bedeli</div></div><div class="fiyat">${akce(k.birincilBedel)}</div></div>
      <p class="kucuk">Platformun sabit kuralla belirlediği tahsis bedeli: alan × imar birim bedeli × mahalle çekiciliği. Satış fiyatı ya da değer tahmini değildir.</p>
      ${girisli()
        ? `<button class="dugme birincil genis" data-eylem="edin" ${durum.ben.bakiye < k.birincilBedel ? 'disabled' : ''}>Parseli edin</button>
           ${durum.ben.bakiye < k.birincilBedel ? '<p class="sebep">Bakiye yetersiz</p>' : ''}`
        : '<button class="dugme birincil genis" data-eylem="giris-ac">Ücretsiz başla ve edin</button>'}
    </div>`);
  } else if (!k.sahip) {
    parcalar.push(`<div class="kutu"><b>Kamu alanı · oyuncu tahsisine kapalı</b><p class="kucuk">${esc(imar.aciklama)}</p></div>`);
  } else if (ben) {
    parcalar.push(`<div class="kutu vurgulu"><b>Bu parselin kullanım hakkı sende</b>
      <p class="kucuk">${esc(imar.aciklama)}</p></div>`);
  } else {
    parcalar.push(`<div class="kutu"><div class="satir"><div><div class="kucuk">Kullanım hakkı</div><b>${esc(k.sahip.ad)}</b>${k.sahip.unvan ? ` <span class="kucuk">· ${esc(k.sahip.unvan)}</span>` : ''}${k.sahip.demoSakin ? ' <span class="demo-rozet" title="Oyunun canlandırdığı demo sakin">demo</span>' : k.sahip.npc ? ' <span class="kucuk">(demo komşu)</span>' : ''}</div>
      ${parselKomsuDugmeleri(k)}
      ${girisli() ? `<div class="satir-dugmeler"><button class="dugme altin ince" data-eylem="ciftlik-gez">🏡 Çiftliğini gez</button><button class="dugme ince" data-eylem="ziyaret">👋 Ziyaret et</button>
        ${k.sahip.npc ? '' : `<button type="button" class="bag sessiz" data-eylem="sikayet" data-tur="PARSEL" data-id="${esc(k.id)}" data-baslik="Parsel ${esc(k.id)}">bildir</button>`}</div>` : ''}</div>
      ${k.durum === 'FROZEN' ? '<p class="kucuk uyari-metin">❄️ Bu parsel moderasyon incelemesi süresince dondurulmuştur.</p>' : ''}</div>`);
  }

  // Tahmini değer ve piyasa: arsa (tahsis bedeli × mahalle endeksi) + yapılar + süsler; sahibine kâr/zarar; endeks
  // grafiği ve parselin fiyat geçmişi (tahsis, satışlar)
  if (k.deger && k.piyasa && (k.sahip || k.birincilBedel != null)) parcalar.push(degerKutusu(k));

  if (ben) parcalar.unshift(`<button type="button" class="dugme altin genis ciftlige-gir" data-eylem="ciftlik-gez">🏡 Çiftliğime gir</button>`);
  else if (k.sahip && girisli()) parcalar.unshift(`<button type="button" class="dugme altin genis ciftlige-gir" data-eylem="ciftlik-gez">🏡 ${esc(k.sahip.ad ? tamlayan(k.sahip.ad) : 'Komşunun')} çiftliğini gez</button>`);
  if (ben) parcalar.push(`<div class="kutu danisman"><div class="satir"><b>🧑‍🌾 Danışman</b><button type="button" class="dugme ince" data-eylem="danisman">Öneri al</button></div><div id="danismanKutu"></div></div>`);

  // Simge parsel (kamu mirası): kartın başında
  if (k.simge) {
    parcalar.unshift(`<div class="kutu simge-kart"><div class="satir"><div><span style="font-size:30px">${k.simge.ikon}</span> <b>${esc(k.simge.ad)}</b>
      <div class="kucuk">Simge parsel · ${esc(k.simge.bolge)} · kamu mirası, edinilemez</div></div>
      ${girisli() ? (k.simge.toplandi ? '<span class="cip yesil">📔 albümde</span>' : `<button class="dugme altin ince" data-eylem="simge-topla" data-kod="${esc(k.simge.kod)}">📔 Kartı topla</button>`) : ''}</div>
      <p class="kucuk" style="margin-bottom:0">${esc(k.simge.not)}</p></div>`);
  }
  // Üretim (tesisler)
  if (ben && k.uretim) parcalar.push(uretimBolumu(k));

  // Pazar (ilan, teklif, devir)
  parcalar.push(parselPazarBolumu(k, { ben: durum.ben, sunucuSimdi, kurallar: durum.kurallar }));

  // Kira ve ortaklık
  if (girisli() && k.tarimMi && (ben || k.kira || k.ortaklar?.length)) parcalar.push(kiraBolumu(k, ben));

  // Tarla
  if (k.kullanimHakkim && k.tarimMi) parcalar.push(tarlaBolumu(k));

  // Yapılar
  if (k.yapilar.length) {
    const saglikRenk = (v) => (v >= 70 ? '' : v >= k.bakim.esik ? 'altin' : 'kirmizi');
    parcalar.push(`<h3 class="bolum">Yapılar ve geliştirmeler</h3><ul class="liste">${k.yapilar.map((y) => `
      <li class="liste-oge"><span class="ikon">${y.ikon}</span><div class="govde"><b>${esc(y.ad)}</b>
        ${y.durum === 'BUILDING'
          ? `<div class="kucuk">İnşaatta · <span data-bitis="${y.bitis}">${sure(y.bitis - sunucuSimdi())}</span></div>`
          : `<div class="kucuk">Sağlık %${y.saglik}${y.etkisiz ? ' · <b class="kirmizi-metin">bakımsız: etkisi durdu</b>' : ''}</div>
             <div class="cubuk ince ${saglikRenk(y.saglik)}"><span style="width:${y.saglik}%"></span></div>
             ${hayvanSatiri(y, { ben, yem: stokta('YEM'), asi: stokta('ASI'), simdi: sunucuSimdi })}`}</div></li>`).join('')}</ul>
      ${ben && k.bakim.toplam > 0 ? `<div class="satir" style="margin-top:8px"><span class="kucuk">Yapılar günde ${k.bakim.yipranma} puan yıpranır; %${k.bakim.esik} altında etkileri durur.</span>
        <button class="dugme ince" data-eylem="bakim" ${durum.ben.bakiye < k.bakim.toplam ? 'disabled' : ''}>🔧 Bakım yap (${akce(k.bakim.toplam)})</button></div>` : ''}`);
  }

  // Çiftlik süsleri
  if (k.susler?.length || (ben && k.susSecenekleri)) parcalar.push(susBolumu(k));

  // İnşaat atölyesi
  if (ben && k.insaatSecenekleri) {
    const ku = k.imarKullanimi;
    parcalar.push(`<h3 class="bolum">İnşaat atölyesi</h3>
      <div class="kutu">
        <div class="satir kucuk"><span>Taban alanı (TAKS)</span><span>${sayi(ku.kullanilanTaban)} / ${sayi(ku.maxTaban)} m²</span></div>
        <div class="cubuk"><span style="width:${ku.maxTaban ? Math.min(100, (ku.kullanilanTaban / ku.maxTaban) * 100) : 0}%"></span></div>
        <div class="satir kucuk"><span>İnşaat alanı (KAKS)</span><span>${sayi(ku.kullanilanInsaat)} / ${sayi(ku.maxInsaat)} m²</span></div>
        <div class="cubuk altin"><span style="width:${ku.maxInsaat ? Math.min(100, (ku.kullanilanInsaat / ku.maxInsaat) * 100) : 0}%"></span></div>
        <p class="kucuk">Oyun kuralıdır; gerçek imar bilgisi değildir. Uygunluk sunucuda denetlenir.</p>
      </div>
      <ul class="liste" style="margin-top:10px">${k.insaatSecenekleri.map((s) => {
        const yetmez = s.uygun && durum.ben.bakiye < s.maliyet;
        const kapali = !s.uygun || yetmez;
        return `<li class="liste-oge insaat-oge" aria-disabled="${kapali}">
          <span class="ikon">${s.ikon}</span>
          <div class="govde"><b>${esc(s.ad)}</b>
            <div class="kucuk">${esc(s.etki)} · ${sure(s.sureMs)}${s.taban ? ` · ${s.taban} m²${s.kat > 1 ? ` × ${s.kat} kat` : ''}` : ''}</div>
            ${!s.uygun ? `<div class="sebep">${esc(s.sebep)}</div>` : yetmez ? '<div class="sebep">Bakiye yetersiz</div>' : ''}
          </div>
          <button class="dugme ince" data-eylem="insaat" data-tip="${s.tip}" ${kapali ? 'disabled' : ''}>${akce(s.maliyet)}</button>
        </li>`;
      }).join('')}</ul>`);
  }

  // Parsel birleştirme: yan yana kendi parsellerini tek parsel yap (kare parsellerde)
  if (ben && k.birlestirme && (k.birlestirme.adaylar.length || k.birlestirme.uyeler.length)) parcalar.push(birlestirmeBolumu(k));

  // Komşular (3×3)
  const hucre = (dx, dy) => {
    if (!dx && !dy) return `<span class="merkez" style="background:${imar.renk}">bu parsel</span>`;
    const n = k.komsular.find((x) => x.dx === dx && x.dy === dy);
    if (!n || !n.imar || n.imar === 'DIS') return '<span style="background:#ece6da">sınır dışı</span>';
    const kural = durum.kurallar.imar[n.imar];
    const renk = kural.renk;
    const etiket = n.uye ? 'bu parsel' : n.ben ? '★ sen' : n.sahip ? esc(n.sahip) : kural.parselDegil ? esc(kural.ad.split(' ')[0].toLocaleLowerCase('tr-TR')) : 'boş';
    return `<button type="button" data-eylem="git" data-id="${esc(n.id)}" style="background:${renk}" title="${esc(n.id)}">${etiket}</button>`;
  };
  parcalar.push(`<h3 class="bolum">Komşuluk</h3><div class="komsu-grid">${
    [-1, 0, 1].map((dy) => [-1, 0, 1].map((dx) => hucre(dx, dy)).join('')).join('')}</div>`);

  if (k.gecmis.length) {
    parcalar.push(`<h3 class="bolum">Kullanım hakkı geçmişi</h3><table class="tablo">${k.gecmis.map((g) => `
      <tr><td>${esc(g.sahip)}<div class="kucuk">${g.reason === 'PRIMARY_ALLOCATION' ? 'Birincil tahsis' : g.reason === 'SEED_NPC' ? 'Başlangıç sakini' : esc(g.reason)} · ${zamanOnce(g.start_at)}</div></td>
      <td>${g.price != null ? akce(g.price) : '—'}</td></tr>`).join('')}</table>`);
  }
  parcalar.push(`<p class="kucuk" style="margin-top:18px">${esc(k.imarKaynak.not)} Bu kayıt resmî ada/parsel bilgisi değildir ve taşınmaz mülkiyeti temsil etmez.
    <a href="?parsel=${esc(k.id)}" class="bag" data-eylem="bagi-kopyala">Parsel bağlantısını kopyala</a></p>`);
  return parcalar.join('');
}

// Parsel birleştirme: birleşik parçalar ve yanındaki kendi parselleri (birleştirilebilir mi, neden değil)
function birlestirmeBolumu(k) {
  const b = k.birlestirme;
  const ap = (x) => (x.adaParsel ? `Ada ${x.adaParsel.ada} / Parsel ${x.adaParsel.parsel}` : esc(x.id));
  const yon = (x) => ({ '1,0': 'doğusunda', '-1,0': 'batısında', '0,1': 'güneyinde', '0,-1': 'kuzeyinde' })[`${Math.sign(x.dx)},${Math.sign(x.dy)}`] || 'yanında';
  return `<h3 class="bolum">🧩 Parsel birleştirme</h3>
    <div class="kutu">
      <p class="kucuk" style="margin-top:0">Yan yana kendi parsellerini tek parsel yap: alanlar toplanır, yapılaşma hakkı (TAKS/KAKS) ve verim büyür,
        yapılar ve süsler bu parsele geçer. Aynı mahalle ve imarda, ekinsiz ve ilansız olmalı; en çok ${b.maksParca} parça. Harç ${akce(b.harc)}. Birleşim geri alınmaz.</p>
      ${b.uyeler.length ? `<div class="satir kucuk"><span>Bu parsel ${b.parca} parçadan oluşuyor</span><span>${sayi(k.alan)} m²</span></div>
        <ul class="liste">${b.uyeler.map((u) => `<li class="liste-oge"><span class="ikon">🧩</span><div class="govde"><b>${ap(u)}</b><div class="kucuk">${sayi(u.alan)} m² · birleştirildi</div></div></li>`).join('')}</ul>` : ''}
      ${b.adaylar.length ? `<ul class="liste">${b.adaylar.map((a) => `<li class="liste-oge" aria-disabled="${!a.uygun}"><span class="ikon">➕</span>
        <div class="govde"><b>${ap(a)}</b><div class="kucuk">${sayi(a.alan)} m² · bu parselin ${yon(a)}</div>${a.uygun ? '' : `<div class="sebep">${esc(a.sebep)}</div>`}</div>
        <button class="dugme ince" data-eylem="birlestir" data-uye="${esc(a.id)}" data-alan="${k.alan + a.alan}" ${a.uygun ? '' : 'disabled'}>Birleştir</button></li>`).join('')}</ul>` : ''}
    </div>`;
}

// Kiralama ve ortaklık
function kiraBolumu(k, ben) {
  const r = k.kira;
  const p = [];
  if (r?.durum === 'AKTIF') p.push(`<p>🔑 <b>${esc(r.kiraci)}</b> kiracı · bitişe <span data-bitis="${r.bitis}">${sure(r.bitis - sunucuSimdi())}</span>${r.benKiraciyim ? ' · tarımsal kullanım hakkı sende' : ''}</p>`);
  else if (r?.durum === 'TEKLIF') {
    p.push(`<p>🏷️ Kiralık: <b>${akce(r.gunluk)}</b>/gün × ${r.gun} gün = ${akce(r.gunluk * r.gun)}</p>`);
    p.push(r.sahibiyim ? `<button class="bag tehlike" data-eylem="kira-iptal" data-id="${r.id}">Teklifi geri çek</button>`
      : `<button class="dugme ince birincil" data-eylem="kirala" data-id="${r.id}" data-toplam="${r.gunluk * r.gun}" ${durum.ben.bakiye < r.gunluk * r.gun ? 'disabled' : ''}>Kirala (${akce(r.gunluk * r.gun)})</button>`);
  } else if (ben) {
    p.push(`<details class="acilir"><summary>Kiraya ver</summary><form class="form satir kira-form"><label>₺/gün${paraGirdisi({ name: 'gunluk', min: 1, deger: 10, ek: 'required' })}</label>
      <label>Gün<input name="gun" type="number" min="1" max="30" value="3" required></label><button class="dugme ince">Teklif aç</button></form>
      <p class="kucuk">Kiracı bedeli peşin öder; süre boyunca ekim, sulama ve hasat onda olur. Sahiplik sende kalır, kirada satış yapılamaz.</p></details>`);
  }
  if (k.ortaklar?.length) {
    p.push(`<p class="kucuk" style="margin-bottom:4px">Hasat ortakları:</p><ul class="madde">${k.ortaklar.map((o) => `<li>${esc(o.ad)} · %${Math.round(o.pay * 100)} ${o.durum === 'DAVET' ? '(davet bekliyor)' : ''}
      ${o.ben && o.durum === 'DAVET' ? `<button class="bag" data-eylem="ortak-yanit" data-id="${o.id}" data-kabul="1">kabul et</button> <button class="bag tehlike" data-eylem="ortak-yanit" data-id="${o.id}" data-kabul="0">reddet</button>`
        : (ben || o.ben) ? `<button class="bag tehlike" data-eylem="ortak-bitir" data-id="${o.id}">sonlandır</button>` : ''}</li>`).join('')}</ul>`);
  }
  if (ben) p.push(`<details class="acilir"><summary>Hasat ortağı davet et</summary><form class="form satir ortak-form"><label>Oyuncu adı<input name="ortakAd" required></label>
    <label>Pay %<input name="pay" type="number" min="5" max="50" value="20" required></label><button class="dugme ince">Davet et</button></form></details>`);
  return `<h3 class="bolum">Kira ve ortaklık</h3><div class="kutu">${p.join('')}</div>`;
}

// Üretim zinciri: tesislerin reçeteleri ve süren partiler
function uretimBolumu(k) {
  const u = k.uretim;
  const suren = (x) => {
    const bitti = sunucuSimdi() >= x.bitis;
    return `<li class="liste-oge"><span class="ikon">${x.ikon}</span><div class="govde"><b>${sayi(x.cikti)} ${esc(x.ad)}</b>
      <span class="kucuk">${bitti ? 'Hazır!' : `bitişe <span data-bitis="${x.bitis}">${sure(x.bitis - sunucuSimdi())}</span>`}</span></div>
      <button class="dugme ince ${bitti ? 'altin' : ''}" data-eylem="uretim-topla" data-id="${x.id}" ${bitti ? '' : 'disabled'}>Topla</button></li>`;
  };
  const mesgul = new Set(u.surenler.map((x) => x.tesis));
  const ruzgar = k.iklim?.ruzgar?.degirmenHizli && u.receteler.some((r) => r.tesis === 'DEGIRMEN')
    ? `<p class="kucuk rozet-hava">🌬️ ${esc(k.il)} rüzgârlı (${k.iklim.ruzgar.kmh} km/s): değirmen %25 hızlı öğütüyor.</p>` : '';
  return `<h3 class="bolum">Üretim</h3>${ruzgar}
    ${u.surenler.length ? `<ul class="liste">${u.surenler.map(suren).join('')}</ul>` : ''}
    <ul class="liste" style="margin-top:8px">${u.receteler.map((r) => {
      const yeter = Math.min(...r.girdi.map((g) => Math.floor(g.stok / g.adet)));
      return `<li class="liste-oge uretim-oge"><span class="ikon">${r.ikon}</span><div class="govde"><b>${esc(r.ad)}</b>
        <span class="kucuk">${r.girdi.map((g) => `${g.adet} ${g.ikon} ${esc(g.ad)} (${sayi(g.stok)})`).join(' + ')} → ${r.cikti} adet · ${sure(Math.round(r.sureMs * (1 - u.zanaatkarBonusu)))}${r.enerji ? ` · enerji ${akce(r.enerji)}` : ''}</span>
        <span class="kucuk">${esc(r.tesisAd)}${mesgul.has(r.tesis) ? ' · meşgul' : ''}</span></div>
        <form class="uretim-form"><input type="hidden" name="recete" value="${r.kod}"><input type="number" name="parti" min="1" max="${Math.max(1, Math.min(10, yeter))}" value="1" aria-label="Parti">
        <button class="dugme ince" ${yeter < 1 || mesgul.has(r.tesis) ? 'disabled' : ''}>Üret</button></form></li>`;
    }).join('')}</ul>`;
}

// İlin gerçek havası ve mevsim (Open-Meteo, il merkezi)
function havaSatiri(k) {
  if (!k.hava && !k.mevsim) return '';
  return `<div class="hava-satiri">${k.mevsim ? `<span>${k.mevsim.ikon} ${esc(k.mevsim.ad)}</span>` : ''}${k.hava ? `<span>${k.hava.ikon} ${k.hava.sicaklik}° · ${esc(k.hava.durum)}${k.hava.yagis ? ` · ${k.hava.yagis} mm` : ''}</span><span class="kucuk">${esc(k.il)} merkezi, şu an</span>` : ''}</div>${iklimSatiri(k)}`;
}
function tarlaBolumu(k) {
  const e = k.ekin;
  const kat = Math.min(4, Math.max(1, Math.round(k.alan / 500)));
  if (!e) {
    const urunler = durum.kurallar.urunler;
    const secenek = new Map((k.urunSecenekleri || []).map((x) => [x.kod, x]));
    const sirali = Object.entries(urunler).filter(([, u]) => !u.mamul).sort(([a], [b]) => (secenek.get(b)?.uygun ? 1 : 0) - (secenek.get(a)?.uygun ? 1 : 0));
    return `<h3 class="bolum">Tarla</h3><div class="kutu">${havaSatiri(k)}<p style="margin-top:0">Ne ekmek istersin? <span class="kucuk">(${sayi(k.alan)} m² → ×${kat} tohum ve verim)</span></p>
      <div class="urun-sec">${sirali.map(([kod, u]) => {
        const s = secenek.get(kod) || { uygun: true, buyume: 1 };
        const yoresel = u.bolgeler ? `<span class="yoresel ${s.uygun ? '' : 'disi'}">${s.uygun ? 'yöresel' : `yalnızca ${esc(u.bolgeAd)}`}</span>` : '';
        return `<button type="button" data-eylem="ek" data-urun="${kod}" ${!s.uygun || durum.ben.bakiye < u.tohum * kat ? 'disabled' : ''}>
          <span class="ikon">${u.ikon}</span><b>${esc(u.ad)}</b>${yoresel}
          <span class="kucuk">${akce(u.tohum * kat)} · ${sure(Math.round(u.sureMs * s.buyume))}${s.buyume !== 1 ? ` <span class="${s.buyume > 1 ? 'kirmizi-metin' : 'yesil-metin'}">(${k.mevsim.ikon}${k.iklim?.gunesli ? '☀️' : ''}×${s.buyume})</span>` : ''}</span>
          <span class="kucuk">💧 ${u.sulama} sulama${u.donHassas ? ' · ❄️ dona hassas' : ''}</span>
        </button>`;
      }).join('')}</div></div>`;
  }
  const ilerleme = Math.min(1, (sunucuSimdi() - e.ekim) / (e.hazir - e.ekim));
  const olgun = sunucuSimdi() >= e.hazir;
  return `<h3 class="bolum">Tarla</h3><div class="kutu ${olgun ? 'uyari' : ''}">${havaSatiri(k)}
    <div class="satir"><div style="display:flex;gap:10px;align-items:center"><span style="font-size:30px">${e.ikon}</span>
      <div><b>${esc(e.ad)}</b><div class="kucuk">${!olgun ? `Olgunlaşmaya <span data-bitis="${e.hazir}">${sure(e.hazir - sunucuSimdi())}</span>`
        : e.tazelik === 'CURUDU' ? '<b class="kirmizi-metin">Tarlada çürüdü</b> · temizlemek için hasat et'
        : e.tazelik === 'BOZULUYOR' ? `<b class="kirmizi-metin">Bozuluyor · verim %${Math.round(e.verimOrani * 100)}</b> · çürümeye <span data-bitis="${sunucuSimdi() + e.curumeyeMs}">${sure(e.curumeyeMs)}</span>`
        : `Hasada hazır! · taze kalma <span data-bitis="${sunucuSimdi() + e.bozulmayaMs}">${sure(e.bozulmayaMs)}</span>`}</div></div></div>
      <div class="kucuk">💧 ${e.sulama}/${e.gerekenSulama}${e.otomatikSulama ? '<br>otomatik' : ''}</div></div>
    <div class="cubuk"><span data-ilerleme-bas="${e.ekim}" data-ilerleme-son="${e.hazir}" style="width:${ilerleme * 100}%"></span></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      ${!olgun && !e.otomatikSulama && e.sulama < e.gerekenSulama
        ? `<button class="dugme ince" data-eylem="sula">💧 Sula (${akce(e.sulamaMaliyeti)})</button>` : ''}
      <button class="dugme ${olgun ? 'altin' : ''} ince" data-eylem="hasat" ${olgun ? '' : 'disabled'}>${e.tazelik === 'CURUDU' ? '🧹 Tarlayı temizle' : '🧺 Hasat et'}</button>
    </div>
    ${!olgun && !e.otomatikSulama && e.sulama < e.gerekenSulama ? '<p class="kucuk">Eksik sulama verimi düşürür. Sulama hattı kurarsan otomatik sulanır; yağmur da açık tarlayı sular.</p>' : ''}
    ${e.tazelik !== 'CURUDU' ? ortuSatiri(k, { ...e, donHassas: !!durum.kurallar.urunler[e.tip]?.donHassas }, (k.iklim?.ortu.birimMaliyet || 0) * kat) : ''}
    ${zirai(k, e, olgun)}
    ${e.don ? '<p class="kucuk kirmizi-metin">❄️ Bu ekin don gördü: verim %25 düşük olacak. Sera kurarsan sonraki ekinler korunur.</p>' : ''}
    ${e.yagmurAt ? `<p class="kucuk">🌧️ Son yağmur tarlanı ${zamanOnce(e.yagmurAt)} suladı.</p>` : ''}
  </div>`;
}

// Zirai bayi ürünleri: gübre (olgunlaşmadan), bitki koruma ilacı; durum rozetleri
function zirai(k, e, olgun) {
  const rozet = [e.gubre ? '🧪 gübreli (+%20 hasat)' : '', e.ilac ? '🛡️ ilaçlı (don/dolu/sağanak koruması)' : ''].filter(Boolean);
  const dugmeler = !k.kullanimHakkim || e.tazelik === 'CURUDU' ? [] : [
    !e.gubre && !olgun && stokta('GUBRE') ? `<button class="dugme ince" data-eylem="carsi-kullan" data-urun="GUBRE">🧪 Gübre ver (${stokta('GUBRE')})</button>` : '',
    !e.ilac && !olgun && stokta('ILAC') ? `<button class="dugme ince" data-eylem="carsi-kullan" data-urun="ILAC">🛡️ İlaçla (${stokta('ILAC')})</button>` : '',
  ].filter(Boolean);
  if (!rozet.length && !dugmeler.length) return '';
  return `<div class="zirai-satir">${rozet.map((r) => `<span class="rozet-hava">${r}</span>`).join('')}${dugmeler.join('')}</div>`;
}

// ---------- Arazilerim ----------
const ARAZI_ALT = [['arazi', 'Arazilerim'], ['meslek', 'Meslek'], ['koop', 'Kooperatif'], ['album', 'Albüm']];
async function arazilerimPaneli() {
  if (!girisli()) return girisIste('Arazilerini görmek için giriş yap');
  const b = durum.ben;
  const alt = durum.araziAlt || 'arazi';
  const ust = `<div class="segment" role="tablist">${ARAZI_ALT.map(([k, ad]) => `<button type="button" data-eylem="arazi-alt" data-alt="${k}" aria-selected="${alt === k}">${ad}</button>`).join('')}</div>`;
  if (alt === 'meslek') return `<h2 class="kart-baslik">Meslek</h2>${ust}${await meslekBolumu()}`;
  if (alt === 'koop') return `<h2 class="kart-baslik">Kooperatif</h2>${ust}${await kooperatifBolumu({ ben: b, konum: durum.konum })}`;
  if (alt === 'album') return `<h2 class="kart-baslik">Simge albümü</h2>${ust}${await albumBolumu()}`;
  const parcalar = [`<h2 class="kart-baslik">Arazilerim</h2>${ust}
    <p class="alt-yazi">${b.portfoy.length} / ${b.limitler.maxParsel} parsel · mahalle başına en fazla ${b.limitler.maxParselMahalle} · ${new Set(b.portfoy.map((p) => p.il)).size} ilde</p>`];
  if (!b.portfoy.length) {
    parcalar.push('<div class="kutu"><p style="margin:0">Henüz parselin yok. Türkiye\'nin herhangi bir yerine yakınlaş, yeşil (tarım) bir hücreye dokun ve edin. Köyünü, mahalleni arayabilirsin.</p></div>');
  } else {
    const kz = durum.portfoyKz;
    const kzParsel = new Map((kz?.parseller || []).map((x) => [x.id, x]));
    if (kz?.parseller.length) {
      const z = kz.ozet;
      parcalar.push(`<div class="kutu portfoy-kutu"><div class="satir"><div><div class="kucuk">Portföy değeri</div><b class="fiyat">${akce(z.deger)}</b></div>
        <div class="sag"><div class="kucuk">Kâr / zarar</div><b class="${z.acikGetiri >= 0 ? 'arti' : 'eksi'}">${z.acikGetiri >= 0 ? '+' : '−'}${akce(Math.abs(z.acikGetiri))}</b> ${degisimCipi(z.acikGetiriYuzde)}</div></div>
        <p class="kucuk">Maliyet ${akce(z.maliyet)} = alış bedelleri + yaptığın yatırımlar${z.kira ? ` · toplanan kira ${akce(z.kira)}` : ''}. Değer, mahalle endeksine ve yapılarına göre değişir.</p></div>`);
    }
    parcalar.push(`<ul class="liste" style="margin-top:12px">${b.portfoy.map((p) => {
      let alt = `${esc(p.imarAd)} · ${sayi(p.area_m2)} m²`;
      let sag = '';
      if (p.ekin) sag = p.ekin.olgun ? '<b style="color:#c25e00">Hasada hazır</b>' : `${p.ekin.ikon} %${Math.round(p.ekin.ilerleme * 100)}`;
      else if (p.insaatta) sag = '🏗️ inşaatta';
      if (p.yapiSayisi) alt += ` · ${p.yapiSayisi} yapı`;
      const g = kzParsel.get(p.id);
      if (g) sag = `<b>${akce(g.deger)}</b><span class="${g.getiri >= 0 ? 'arti' : 'eksi'}">${g.getiri >= 0 ? '+' : '−'}${akce(Math.abs(g.getiri))}</span>${sag ? `<span>${sag}</span>` : ''}`;
      return `<li><button type="button" class="liste-oge" data-eylem="git" data-id="${esc(p.id)}">
        <span class="ikon">${IMAR_IKON[p.zoning_type] || '📍'}</span>
        <span class="govde"><b>${esc(p.mahalle)}</b><span class="kucuk">${esc(p.ilce)}, ${esc(p.il)}</span><span class="kucuk">${alt}</span></span>
        <span class="sag kucuk">${sag}</span></button></li>`;
    }).join('')}</ul>`);
  }
  if (durum.portfoyKz?.satislar.length) {
    parcalar.push(`<h3 class="bolum">Satışlarım</h3><table class="tablo">${durum.portfoyKz.satislar.map((s) => `<tr>
      <td>${esc(s.id)}<div class="kucuk">${kisaTarih(s.tarih)} · ${esc(s.alici)} · ${akce(s.fiyat)} (masraf ${akce(s.masraf)})</div><div class="kucuk">Maliyet ${akce(s.alis + s.yatirim)}</div></td>
      <td class="${s.kar >= 0 ? 'arti' : 'eksi'}">${s.kar >= 0 ? '+' : '−'}${sayi(Math.abs(s.kar))}${s.karYuzde != null ? `<div class="kucuk">%${sayi(s.karYuzde)}</div>` : ''}</td></tr>`).join('')}</table>`);
  }
  const ks = await api('/api/koleksiyon').catch(() => null);
  if (ks) parcalar.push(yoreSetleriHTML(ks));
  parcalar.push(`<h3 class="bolum">Envanter</h3>${envanterHTML()}`);
  parcalar.push(`<p class="kucuk hesap-satiri">${esc(b.kullanici.ad)} olarak oynuyorsun · <button type="button" class="bag" data-eylem="hesap-ac">Hesabım ve gizlilik</button> · <button type="button" class="bag" data-eylem="cikis">Çıkış yap</button></p>`);
  parcalar.push(`<h3 class="bolum">Cüzdan hareketleri</h3>${durum.cuzdan
    ? `<table class="tablo">${durum.cuzdan.map((c) => `<tr><td>${esc(c.reason)}<div class="kucuk">${zamanOnce(c.created_at)}</div></td>
        <td class="${c.tutar >= 0 ? 'arti' : 'eksi'}">${c.tutar >= 0 ? '+' : '−'}${akce(Math.abs(c.tutar))}</td></tr>`).join('')}</table>`
    : '<p class="kucuk">Yükleniyor…</p>'}`);
  return parcalar.join('');
}

// Yöre setleri: tamamlananlar ve en yakın üç set; kalanlar açılır listede (koleksiyon.js)
function yoreSetleriHTML(k) {
  const kart = (s) => `<li class="set-kart${s.tamam ? ' tamam' : ''}"><span class="set-ikon">${s.ikon}</span>
    <div class="govde"><b>${esc(s.ad)}</b><span class="set-iller">${s.iller.map((i) => `<span class="${i.var ? 'var' : ''}">${i.var ? '✓' : '○'} ${esc(i.ad)}</span>`).join('')}</span></div>
    <span class="set-durum">${s.tamam ? `+%${Math.round(k.hasatBonus * 100)}` : `${s.sahip}/${s.toplam}`}</span></li>`;
  const one = k.setler.filter((s) => s.tamam || s.sahip > 0).slice(0, Math.max(3, k.tamam));
  const kalan = k.setler.filter((s) => !one.includes(s));
  return `<h3 class="bolum">🗺️ Yöre setleri${k.tamam ? ` · ${k.tamam} tamam` : ''}</h3>
    <p class="kucuk">Bir setin üç ilinin hepsinde arazin olursa o illerdeki hasadın %${Math.round(k.hasatBonus * 100)} artar; seti ilk tamamlayışında ${akce(k.odul)} ve rozet.</p>
    ${one.length ? `<ul class="set-liste">${one.map(kart).join('')}</ul>` : ''}
    <details class="acilir"><summary>${one.length ? 'Diğer setler' : 'Bütün setler'} (${kalan.length})</summary><ul class="set-liste">${kalan.map(kart).join('')}</ul></details>`;
}

function envanterHTML() {
  const env = durum.ben.envanter;
  if (!env.length) return '<p class="kucuk">Envanterin boş. Hasat ettiğin ürünler burada görünür.</p>';
  return `<ul class="liste">${env.map((i) => `
    <li class="liste-oge"><span class="ikon">${i.ikon}</span><div class="govde"><b>${esc(i.ad)}</b><span class="kucuk">${sayi(i.miktar)} adet${i.gunlukBozulma ? ` · depoda günde %${sayi(i.gunlukBozulma * 100)} bozulur` : ''}</span></div>
      ${durum.kurallar.urunler[i.item_id]?.dukkan ? '<span class="kucuk">dükkân ürünü</span>' : `<form class="sat-form" data-urun="${esc(i.item_id)}">
        <input type="number" name="miktar" min="1" max="${i.miktar}" value="${i.miktar}" aria-label="Satış miktarı">
        <button class="dugme ince" type="submit">Sat</button>
      </form>`}</li>`).join('')}</ul>`;
}

async function cuzdanYukle() {
  try {
    [durum.cuzdan, durum.portfoyKz] = await Promise.all([api('/api/cuzdan'), api('/api/portfoy').catch(() => null)]);
    if (durum.sekme === 'arazilerim') panelCiz();
  } catch { /* yoksay */ }
}

// ---------- Görevler ----------
async function gorevlerPaneli() {
  if (!girisli()) return girisIste('Seviye, günlük ödül, siparişler, komşular ve yöresel ürünler seni bekliyor');
  const alt = durum.ciftlikAlt || 'ciftlik';
  const etkinlik = durum.etkinlik?.aktif;
  const segment = `<div class="segment" role="tablist">
    <button type="button" data-eylem="ciftlik-alt" data-alt="ciftlik" aria-selected="${alt === 'ciftlik'}">🌾 Çiftlik</button>
    <button type="button" data-eylem="ciftlik-alt" data-alt="komsular" aria-selected="${alt === 'komsular'}">🤝 Komşular</button>
    <button type="button" data-eylem="ciftlik-alt" data-alt="yoresel" aria-selected="${alt === 'yoresel'}">📔 Yöresel</button>
    <button type="button" data-eylem="ciftlik-alt" data-alt="etkinlik" aria-selected="${alt === 'etkinlik'}">${etkinlik ? etkinlik.ikon : '📅'} Etkinlik</button>
    <button type="button" data-eylem="ciftlik-alt" data-alt="yol" aria-selected="${alt === 'yol'}">🛤️ Yol${durum.ben?.yol?.alinabilir ? ` <span class="rozet">${durum.ben.yol.alinabilir}</span>` : ''}</button></div>`;
  try {
    if (alt === 'komsular') {
      if (!acikMi('komsuluk')) return segment + kilitliBolum('komsuluk');
      const [k, m] = await Promise.all([api('/api/komsuluk'), api('/api/imece').catch(() => null)]);
      return segment + (m ? imeceKarti(m) : '') + komsularBolumu(k);
    }
    if (alt === 'yoresel') return segment + yoreselBolumu(await api('/api/yoresel'));
    if (alt === 'etkinlik') { durum.etkinlik = await api('/api/etkinlik'); return segment + etkinlikBolumu(durum.etkinlik, { simdi: sunucuSimdi }); }
    if (alt === 'yol') return segment + yolBolumu(await api('/api/yol'), { simdi: sunucuSimdi });
  } catch (e) { return `${segment}<p class="kucuk">${esc(e.message)}</p>`; }
  let ciftlik = '';
  try { ciftlik = ciftlikBolumu(await api('/api/ciftlik'), { simdi: sunucuSimdi, mini: durum.ben?.miniEtkinlik }); } catch { /* bağlantı yoksa yalnızca görevler */ }
  ciftlik = segment + gunlukGorevKarti(await api('/api/gunluk-gorevler').catch(() => null)) + ciftlik;
  const g = durum.ben.gorevler;
  const biten = g.filter((x) => x.tamam).length;
  return `<h2 class="kart-baslik">Çiftliğim</h2>${ciftlik}<h3 class="bolum">İlk adımlar</h3>
    <p class="alt-yazi">${biten} / ${g.length} görev · toplam ${akce(g.reduce((a, x) => a + x.odul, 0))} ödül</p>
    <div class="cubuk"><span style="width:${(biten / g.length) * 100}%"></span></div>
    <div style="margin-top:8px">${g.map((x) => `
      <div class="gorev ${x.tamam ? 'tamam' : ''}"><span class="tik">${x.tamam ? '✓' : ''}</span>
        <div style="flex:1"><b>${esc(x.ad)}</b><div class="kucuk">${esc(x.ipucu)}</div></div>
        <span class="kucuk">+${akce(x.odul)}</span></div>`).join('')}</div>
    <p class="kucuk" style="margin-top:14px">Görev ödülleri oyun parasıdır (TL); nakde çevrilemez.</p>`;
}

// Günlük görevler kartı (Çiftlik sekmesinin başında)
function gunlukGorevKarti(d) {
  if (!d) return '';
  const biten = d.gorevler.filter((x) => x.tamam).length;
  return `<div class="kutu gunluk-gorev"><div class="satir"><b>🎯 Günlük görevler</b><span class="kucuk">${biten}/3 · ödül ${akce(d.odul)} + ${d.tp} TP</span></div>
    ${d.gorevler.map((x) => `<div class="gunluk-satir ${x.tamam ? 'tamam' : ''}"><span>${x.tamam ? '✅' : x.ikon}</span><b>${esc(x.ad)}</b><div class="cubuk ince"><span style="width:${(x.yapilan / x.hedef) * 100}%"></span></div><small>${x.yapilan}/${x.hedef}</small></div>`).join('')}
    <button class="dugme altin genis" data-eylem="gorev-odul" ${d.hepsi && !d.alindi ? '' : 'disabled'}>${d.alindi ? '✓ Bugünkü ödül alındı' : d.hepsi ? `🎁 Ödülü al (${akce(d.odul)})` : '🎁 Üçünü de bitir, ödülü al'}</button></div>`;
}

// Haritada seçilen mahalle: mahalle sohbet kanalı ona geçer
function mahalleSec(id) {
  durum.mahalleId = Number(id);
  sohbetKanallariniYenile();
}

// ---------- Pazar ----------
function pazarPaneli() {
  return pazarSekmesi({
    ben: durum.ben, alt: durum.pazarAlt, filtre: durum.pazarFiltre, bolgeler: durum.bolgeler,
    kurallar: durum.kurallar, envanterHTML, sunucuSimdi,
  });
}

// ---------- Haber akışı (Türkiye / bulunduğun il) ----------
async function haberlerPaneli() {
  const lig = durum.akisFiltre === 'yaris';
  const ilModu = durum.akisFiltre === 'il' && durum.konum?.ilId;
  const ust = `<h2 class="kart-baslik">Haberler</h2>
    <div class="segment" role="tablist">
      <button type="button" data-eylem="akis-filtre" data-filtre="turkiye" aria-selected="${!ilModu && !lig}">Tüm Türkiye</button>
      <button type="button" data-eylem="akis-filtre" data-filtre="il" aria-selected="${!!ilModu}" ${durum.konum ? '' : 'disabled'}>${durum.konum ? esc(durum.konum.il) : 'Bulunduğun il'}</button>
      <button type="button" data-eylem="akis-filtre" data-filtre="yaris" aria-selected="${lig}">🏁 Hasat yarışı</button>
    </div>
    ${!lig ? '<div class="satir zaman-satir"><span class="kucuk">Son 30 günde Türkiye nasıl büyüdü?</span><button type="button" class="dugme ince" data-eylem="ulke-zaman">▶️ Zaman yolculuğu</button></div>' : ''}`;
  if (lig) return ust + yarisKarti(await api('/api/hasat-yarisi'));
  const akis = await api(`/api/akis${ilModu ? `?il=${durum.konum.ilId}` : ''}`);
  return `${ust}
    ${akis.length ? akis.map((a) => {
      const f = AKIS_METIN[a.action];
      if (!f) return '';
      const [ikon, metin] = f(a);
      return `<div class="akis-oge"><span class="ikon">${ikon}</span><div><div>${metin}</div>
        <div class="kucuk">📍 ${[a.mahalle, a.ilce && `${a.ilce}, ${a.il}`].filter(Boolean).map(esc).join(' · ')} · <time>${zamanOnce(a.created_at)}</time></div></div></div>`;
    }).join('') : '<p class="kucuk">Henüz hareket yok. İlk adımı sen at!</p>'}`;
}

// ================= Eylemler =================
async function parselSec(id, { haritadan = false } = {}) {
  durum.harita.sec(id);
  try {
    const kart = await api(`/api/parsel/${encodeURIComponent(id)}`);
    // Tarla hücresine tıklanınca sunucu tarlanın kimliğini döndürür; seçim tarla sınırını izler
    durum.secili = kart.id || id;
    durum.kart = kart;
    durum.saatFarki = kart.simdi - Date.now();
    durum.harita.sec(durum.secili, kart.geometri);
  } catch (e) {
    tost(e.message, 'hata');
    durum.harita.sec(durum.secili, durum.kart?.id === durum.secili ? durum.kart.geometri : null);
    return;
  }
  // Kendi parselim: doğrudan çiftlik (parsel sekmesi ve maketi çiftlikten çıkınca çizilir; telefonda iki 3B sahne birden kurulmasın)
  // Çiftlik açılamazsa (WebGL yok) parsel kartı açılır: oyuncu kendi parseline yine de ulaşır
  if (haritadan && durum.kart?.sahip?.ben && durum.ciftlikIci?.ac()) return;
  if (window.matchMedia('(max-width: 820px)').matches) panelBoyut('');
  sekmeSec('parsel');
}

function gorevTostu(r) {
  // Tur sürerken başlangıç görevleri ödül vermez (tur verir): "+₺0" bildirimi gösterilmez
  if (r?.gorev?.odul > 0) setTimeout(() => tost(`🎯 Görev tamamlandı: ${r.gorev.ad} (+${akce(r.gorev.odul)})`, 'gorev'), 500);
}

async function eylem(yol, govde, basariMesaji) {
  try {
    const r = await api(yol, govde || {});
    if (r?.mesaj) tost(r.mesaj, r.tamam === false || r.npcRed ? 'hata' : '');   // sunucunun açıklaması öncelikli
    else if (basariMesaji) tost(typeof basariMesaji === 'function' ? basariMesaji(r) : basariMesaji);
    gorevTostu(r);
    return r;
  } catch (e) {
    tost(e.message, 'hata');
    return null;
  } finally {
    await eylemSonrasiYenile();
  }
}
// Bir eylemden sonra oyuncu, seçili parsel, harita ve panel tazelenir
async function eylemSonrasiYenile() {
  await Promise.all([benYenile(), durum.secili ? api(`/api/parsel/${encodeURIComponent(durum.secili)}`).then((k) => { durum.kart = k; }) : null, haritaYenile()]);
  if (durum.sekme === 'arazilerim') cuzdanYukle();
  panelCiz();
}

// Ortak eylem dağıtıcısı: paneldeki ve tam sayfa çiftlik görünümündeki data-eylem düğmeleri buradan geçer
async function eylemDagit(b, e = null) {
  const id = durum.secili && encodeURIComponent(durum.secili);
  switch (b.dataset.eylem) {
    case 'sekme-git': return sekmeSec(b.dataset.sekme);
    // ---- Çiftlik gelişimi: yapı yükseltme, işçi, günlük görevler, üretim, genişletme
    case 'kira-topla': {
      // Bir ya da birden çok konutun birikmiş kirası (data-id: virgüllü yapı kimlikleri)
      b.disabled = true;
      let toplam = 0;
      for (const yid of String(b.dataset.id || '').split(',').filter(Boolean)) {
        try { toplam += (await api(`/api/yapi/${encodeURIComponent(yid)}/kira`, {})).tutar || 0; } catch { /* bu yapıda henüz yok */ }
      }
      if (toplam) { tost(`💰 Kira geliri: +${akce(toplam)}`); ses('para'); } else tost('Henüz toplanacak kira yok', 'hata');
      return eylemSonrasiYenile().then(() => ({ tamam: toplam > 0 }));
    }
    case 'yapi-yukselt':
      b.disabled = true;
      return eylem(`/api/yapi/${b.dataset.id}/yukselt`, { hedef: Number(b.dataset.seviye) || undefined }, (r) => `⬆️ Yapı ${r.seviye}. seviyeye yükseldi (${akce(r.bedel)})${r.kira ? ` · biriken kira: +${akce(r.kira)}` : ''}`).then((r) => { if (r?.tamam) ses('seviye'); });
    case 'isci-tut':
      b.disabled = true;
      return eylem('/api/isci/tut', { gun: Number(b.dataset.gun) }, (r) => `👷 İşçi tutuldu: ${new Date(r.bitis).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} tarihine kadar çalışacak`);
    case 'gorev-odul':
      b.disabled = true;
      return eylem('/api/gunluk-gorevler/odul', null, (r) => `🎉 Günlük görevler tamam: ${akce(r.odul)} + ${r.tp} TP`).then((r) => { if (r?.tamam) ses('seviye'); });
    case 'uretim-basla':
      b.disabled = true;
      return eylem(`/api/parsel/${id}/uretim`, { recete: b.dataset.recete, parti: Number(b.dataset.parti || 1) }, '⚙️ Üretim başladı');
    case 'genislet':
      b.disabled = true;
      return eylem(`/api/parsel/${encodeURIComponent(b.dataset.parsel)}/edin`, null, (r) => `🏡 Çiftliğin büyüdü! ${akce(r.bedel)} tahsis bedeli ödendi`).then((r) => { if (r?.tamam) ses('seviye'); });
    case 'ciftlik-gez':
      return durum.ciftlikIci?.ac({ ziyaret: true });
    case 'giris-ac': return authAc('kayit');
    case 'git':
      durum.harita.parseleGit(b.dataset.id);
      return parselSec(b.dataset.id);
    case 'cikis':
      return $('#cikisDugme').click();
    case 'hesap-ac':
      return hesapAc(b.dataset.bolum);
    case 'sikayet':
      if (!girisli()) return authAc('giris');
      return sikayetAc(b.dataset.tur, b.dataset.id, b.dataset.baslik || 'İçerik');
    case 'sekme':
      return sekmeSec(b.dataset.sekme);
    case 'panel-yenile':
      return panelCiz();
    case 'yere-git':
      return durum.harita.yereGit({ merkez: [Number(b.dataset.lon), Number(b.dataset.lat)], zoom: Number(b.dataset.zoom) || 15 });
    case 'akis-filtre':
      durum.akisFiltre = b.dataset.filtre;
      return panelCiz();
    case 'koop-ac':
      durum.araziAlt = 'koop';
      return sekmeSec('arazilerim');
    case 'tuccara-git':
      durum.pazarAlt = 'urun';
      return sekmeSec('pazar');
    case 'yaris-ac':
      durum.akisFiltre = 'yaris';
      return sekmeSec('haberler');
    case 'bagi-kopyala': {
      e?.preventDefault();
      const url = `${location.origin}/?parsel=${durum.secili}${location.hash}`;
      try { await navigator.clipboard.writeText(url); tost('🔗 Parsel bağlantısı kopyalandı'); } catch { tost(url); }
      return;
    }
    case 'edin':
      b.disabled = true;
      return eylem(`/api/parsel/${id}/edin`, null, (r) => `📍 Parsel senin! ${akce(r.bedel)} tahsis bedeli ödendi`);
    case 'ziyaret':
      return eylem(`/api/parsel/${id}/ziyaret`, null, (r) => `👋 ${r.sahip} ziyaretinden memnun kaldı`);
    case 'insaat':
      b.disabled = true;
      return eylem(`/api/parsel/${id}/insaat`, { tip: b.dataset.tip }, `🏗️ ${yapiAd(b.dataset.tip)} inşaatı başladı`);
    case 'ulke-zaman': {
      b.disabled = true;
      const noktalar = await api('/api/zaman/turkiye?gun=30').catch(() => []);
      if (!noktalar.length) { tost('Son 30 günde edinilen parsel yok'); b.disabled = false; return; }
      durum.harita.turkiyeyeGit();
      await durum.harita.zamanOynat(noktalar, { ilerleme: (o, t) => { b.textContent = `⏳ ${new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}`; } });
      b.textContent = `✓ ${noktalar.length} parsel`;
      setTimeout(() => { durum.harita.zamanTemizle(); b.textContent = '▶️ Zaman yolculuğu'; b.disabled = false; }, 6000);
      return;
    }
    case 'kirala':
      if (!confirm(`Bu tarlayı ${akce(Number(b.dataset.toplam))} peşin bedelle kiralamak istiyor musun?`)) return;
      return eylem(`/api/kira/${b.dataset.id}/kirala`, {}, '🔑 Tarlayı kiraladın');
    case 'kira-iptal':
      return eylem(`/api/kira/${b.dataset.id}/iptal`, {}, 'Kira teklifi geri çekildi');
    case 'ortak-yanit':
      return eylem(`/api/ortak/${b.dataset.id}/yanit`, { kabul: b.dataset.kabul === '1' }, b.dataset.kabul === '1' ? 'Ortaklığı kabul ettin' : 'Davet reddedildi');
    case 'ortak-bitir':
      if (!confirm('Ortaklığı sonlandırmak istiyor musun?')) return;
      return eylem(`/api/ortak/${b.dataset.id}/bitir`, {}, 'Ortaklık sonlandı');
    case 'danisman': {
      b.disabled = true;
      try {
        const r = await api(`/api/parsel/${id}/danisman`, {});
        $('#danismanKutu').innerHTML = `<ul class="madde">${r.oneriler.map((o) => `<li><b>${esc(o.baslik)}</b> — ${esc(o.neden)}</li>`).join('') || '<li>Şu an önerim yok; her şey yolunda görünüyor.</li>'}</ul>
          <p class="kucuk">${r.kaynak === 'claude' ? '🤖 Yapay zekâ (Claude) önerisi; oyun kuralı değildir.' : '📏 Kural tabanlı öneri.'}${r.not ? ` ${esc(r.not)}` : ''}</p>`;
      } catch (err) { tost(err.message, 'hata'); } finally { b.disabled = false; }
      return;
    }
    case 'gazete': {
      b.disabled = true;
      try {
        const g = await api(`/api/gazete/${b.dataset.id}`);
        b.closest('.gazete').innerHTML = `<p class="ust-baslik">📰 ${esc(g.baslik)}</p><h3 class="gazete-manset">${esc(g.manset)}</h3>
          ${g.haberler.map((x) => `<p><b>${esc(x.baslik)}.</b> ${esc(x.metin)}</p>`).join('')}<blockquote>${esc(g.kose)}</blockquote>
          <p class="kucuk">${g.kaynak === 'claude' ? '🤖 Oyun olaylarından yapay zekâ (Claude) ile derlendi' : 'Oyun olaylarından derlendi'} · ${zamanOnce(g.tarih)}</p>`;
      } catch (err) { tost(err.message, 'hata'); b.disabled = false; }
      return;
    }
    case 'arazi-alt':
      durum.araziAlt = b.dataset.alt;
      return panelCiz();
    case 'meslek-sec':
      return eylem('/api/meslek', { meslek: b.dataset.meslek }, 'Mesleğin kaydedildi');
    case 'koop-katil':
      return eylem(`/api/kooperatif/${b.dataset.id}/katil`, {}, 'Kooperatife katıldın 🤝');
    case 'imece-davet':
      b.disabled = true;
      return eylem('/api/imece/davet', { kullaniciId: Number(b.dataset.id) }, (r) => (r.id && b.textContent.includes('demo') ? '🤝 İmece başladı' : '🤝 İmece daveti gönderildi'));
    case 'imece-kabul':
      return eylem(`/api/imece/${b.dataset.id}/kabul`, {}, '🤝 İmece başladı: bu hafta birlikte çalışıyorsunuz');
    case 'imece-reddet':
      return eylem(`/api/imece/${b.dataset.id}/reddet`, {}, 'Davet reddedildi');
    case 'imece-birak':
      if (!confirm('İmeceden ayrılmak istiyor musun? Aldığın ödüller sende kalır.')) return;
      return eylem('/api/imece/birak', {}, 'İmeceden ayrıldın');
    case 'koop-ayril':
      if (!confirm('Kooperatiften ayrılmak istiyor musun?')) return;
      return eylem('/api/kooperatif/ayril', {}, 'Kooperatiften ayrıldın');
    case 'koop-dagit':
      return eylem('/api/kooperatif/dagit', {}, (r) => `Kasadan her üyeye ${akce(r.pay)} dağıtıldı`);
    case 'simgeye-git':
      durum.harita.parseleGit(b.dataset.parsel, { zoom: 17.4 });
      return parselSec(b.dataset.parsel);
    case 'simge-topla':
      b.disabled = true;
      return eylem(`/api/simge/${b.dataset.kod}/topla`, {}, (r) => `📔 ${r.simge} albümüne eklendi (+${akce(r.odul)})${r.rozetler.length ? ` · Rozet: ${r.rozetler.join(', ')}` : ''}`);
    case 'uretim-topla':
      b.disabled = true;
      return eylem(`/api/uretim/${b.dataset.id}/topla`, {}, (r) => `📦 ${sayi(r.miktar)} ${urunAd(r.urun)} depoya girdi`);
    case 'ek': {
      b.disabled = true;
      const konum = durum.kart?.konum;
      return eylem(`/api/parsel/${id}/ek`, { urun: b.dataset.urun }, `🌱 ${urunAd(b.dataset.urun)} ekildi`)
        .then((r) => { if (r?.tamam !== false && r) { durum.harita.efekt('ek', konum, '🌱'); ses('ek'); } });
    }
    case 'carsi-ac':
      durum.carsiAlt = b.dataset.kategori; $('#panelIcerik').scrollTop = 0; return panelCiz();
    case 'carsi-geri':
      durum.carsiAlt = null; return panelCiz();
    case 'alarm-sil':
      return eylem(`/api/alarm/${b.dataset.id}/sil`, {}, 'Alarm silindi');
    case 'yardim-gonder':
      b.disabled = true;
      return eylem(`/api/yardim/${b.dataset.id}/gonder`, { adet: Number(b.dataset.adet) }, (r) => `🤝 ${r.adet} ürün gönderildi${r.istekTamam ? '; istek tamamlandı' : ''}`);
    case 'yardim-kapat':
      return eylem(`/api/yardim/${b.dataset.id}/kapat`, {}, 'İsteğin kapatıldı');
    case 'vadeli-kapat':
      b.disabled = true;
      return eylem(`/api/banka/vadeli/${b.dataset.id}/kapat`, {}, (r) => (r.bozuldu ? `↩️ Vadeli hesap bozuldu; ${akce(r.anapara)} cüzdanına döndü` : `🏦 Vadeli hesap kapandı: ${akce(r.anapara)} + ${akce(r.faiz)} getiri`));
    case 'carsi-kullan':
      b.disabled = true;
      return eylem('/api/carsi/kullan', { urun: b.dataset.urun, parselId: durum.secili, yapiId: b.dataset.yapi ? Number(b.dataset.yapi) : undefined },
        () => ({ GUBRE: '🧪 Gübre verildi: hasat %20 fazla olacak', ILAC: '🛡️ İlaçlandı: ekin dona, doluya ve sağanağa karşı korunuyor', ASI: '💉 Hayvanlar aşılandı: 7 gün boyunca +1 ürün' }[b.dataset.urun]));
    case 'ortu':
      b.disabled = true;
      return eylem(`/api/parsel/${id}/ortu`, null, (r) => `⛺ Tarla örtüldü (${akce(r.maliyet)}); 12 saat korunuyor`).then(() => havaSeridiYenile({ zorla: true }));
    case 'hava-ac':
      return havaPenceresiAc();
    case 'sula': {
      const konum = durum.kart?.konum;
      return eylem(`/api/parsel/${id}/sula`, null, '💧 Tarla sulandı').then((r) => { if (r) { durum.harita.efekt('sula', konum); ses('sula'); } });
    }
    case 'birlestir':
      if (!confirm(`Bu iki parsel tek parsel olacak (${sayi(Number(b.dataset.alan))} m²). Harç ${akce(durum.kart?.birlestirme?.harc ?? 0)}. Birleşim geri alınmaz. Onaylıyor musun?`)) return;
      b.disabled = true;
      return eylem(`/api/parsel/${id}/birlestir`, { uye: b.dataset.uye }, (r) => `🧩 Parseller birleşti: ${sayi(r.alan)} m², ${r.parca} parça`);
    case 'bakim':
      b.disabled = true;
      return eylem(`/api/parsel/${id}/bakim`, null, (r) => `🔧 ${r.adet} yapının bakımı yapıldı (${akce(r.tutar)})`);
    case 'emir-iptal':
      return eylem(`/api/borsa/emir/${b.dataset.id}/iptal`, null, 'Emir iptal edildi; kilitli tutar iade edildi');
    case 'hasat': {
      b.disabled = true;
      const konum = durum.kart?.konum;
      return eylem(`/api/parsel/${id}/hasat`, null, (r) => `🧺 ${sayi(r.miktar)} ${urunAd(r.urun)} hasat ettin`)
        .then((r) => { if (r?.urun) { durum.harita.efekt('hasat', konum, urunIkon(r.urun)); ses('hasat'); } });
    }
    // ---- Çiftliğim alt bölümleri, komşuluk, yöresel ürünler, etkinlik
    case 'ciftlik-alt':
      durum.ciftlikAlt = b.dataset.alt;
      $('#panelIcerik').scrollTop = 0;
      return panelCiz();
    case 'etkinlik-ac':
      return ciftlikAlt('etkinlik');
    case 'yol-al':
      b.disabled = true;
      return eylem('/api/yol/al', b.dataset.kademe ? { kademe: Number(b.dataset.kademe) } : {}, (r) => `🎁 Sezon yolu: ${[r.akce ? `+${akce(r.akce)}` : '', ...r.esya.map(([, n]) => `${n} eşya`), ...r.kozmetik].filter(Boolean).join(' · ')}`);
    case 'arkadas-istek':
      b.disabled = true;
      return eylem('/api/arkadas/istek', { parselId: id }, (r) => (r.kabul ? `🤝 ${r.ad} ile artık komşusunuz` : `🤝 ${r.ad} adlı oyuncuya komşuluk isteği gönderildi`));
    case 'arkadas-kabul':
      b.disabled = true;
      return eylem(`/api/arkadas/${b.dataset.id}/kabul`, null, (r) => `🤝 ${r.ad} ile artık komşusunuz`);
    case 'arkadas-sil':
      return eylem(`/api/arkadas/${b.dataset.id}/sil`, null, 'İstek kaldırıldı');
    case 'yardim':
    case 'komsuya-yardim': {
      b.disabled = true;
      const pid = b.dataset.parsel || id;
      const konum = b.dataset.parsel ? null : durum.kart?.konum;
      return eylem(`/api/parsel/${encodeURIComponent(pid)}/yardim`, null, (r) => (r.etki === 'SULADI' ? `💧 Komşunun tarlasını suladın (+${akce(r.odul)})` : `🌱 Komşunun tarlasının bakımını yaptın (+${akce(r.odul)})`))
        .then((r) => { if (r?.tamam) { durum.harita.efekt('sula', konum); ses('sula'); } });
    }
    case 'komsuya-git':
      durum.harita.parseleGit(b.dataset.parsel, { zoom: 17.6 });
      return parselSec(b.dataset.parsel);
    case 'hediye-gonder':
      b.disabled = true;
      return eylem('/api/hediye/gonder', { kullaniciId: Number(b.dataset.id) }, '🎁 Hediye gönderildi').then((r) => { if (r?.tamam) ses('para'); });
    case 'hediye-al':
      b.disabled = true;
      return eylem(`/api/hediye/${b.dataset.id}/al`, null, (r) => (r.akce ? `🎁 Hediye: ${akce(r.akce)}` : `🎁 Hediye: ${sayi(r.adet)} ${r.ad}`)).then((r) => { if (r?.tamam) ses('hasat'); });
    case 'urun-gonder-ac':
      return genelPencere(urunGonderFormu(b.dataset.ad, b.dataset.id, durum.ben?.envanter || []));
    case 'yoresel-uret':
      b.disabled = true;
      return eylem(`/api/yoresel/${b.dataset.kod}/uret`, null, (r) => `🏭 ${sayi(r.adet)} ${urunAd(r.urun)} üretildi`).then((r) => { if (r?.tamam) ses('hasat'); });
    case 'yoresel-album':
      b.disabled = true;
      return eylem(`/api/yoresel/${b.dataset.kod}/album`, null, (r) => `📔 Albüme eklendi (+${akce(r.odul)})${r.bolgeTamam ? ` · ${r.bolgeTamam} tamamlandı: +${akce(r.bolgeOdulu)}` : ''}`).then((r) => { if (r?.tamam) ses(r.bolgeTamam ? 'seviye' : 'para'); });
    case 'etkinlik-odul':
      b.disabled = true;
      return eylem('/api/etkinlik/odul', { gorev: Number(b.dataset.gorev) }, (r) => `🎉 Etkinlik ödülü: ${akce(r.odul)}${r.tp ? ` + ${r.tp} TP` : ''}`).then((r) => { if (r?.tamam) ses('seviye'); });
    // ---- Çiftlik: hayvanlar, süsler, ödüller, siparişler
    case 'hayvan-besle': {
      b.disabled = true;
      const konum = durum.kart?.konum;
      return eylem(`/api/yapi/${b.dataset.id}/besle`, null, (r) => `🌽 Hayvanlar yemlendi${r.yemSatin ? ` (${r.yemSatin} yem satın alındı: ${akce(r.odenen)})` : ''}`)
        .then((r) => { if (r?.tamam) { durum.harita.efekt('ek', konum, '🌽'); ses('besle'); } });
    }
    case 'hayvan-topla': {
      b.disabled = true;
      const konum = durum.kart?.konum;
      return eylem(`/api/yapi/${b.dataset.id}/topla`, null, (r) => `${urunIkon(r.urun)} ${sayi(r.miktar)} ${urunAd(r.urun)} toplandı`)
        .then((r) => { if (r?.urun) { durum.harita.efekt('hasat', konum, urunIkon(r.urun)); ses('hasat'); } });
    }
    case 'sus-ekle':
      b.disabled = true;
      return eylem(`/api/parsel/${id}/sus`, { tur: b.dataset.tur }, '🌷 Süs yerleştirildi').then((r) => { if (r?.tamam) ses('para'); });
    case 'sus-kaldir':
      if (!confirm('Süsü kaldırmak istiyor musun? Bedeli iade edilmez.')) return;
      return eylem(`/api/sus/${b.dataset.id}/kaldir`, null, 'Süs kaldırıldı');
    case 'seviye-odul':
      b.disabled = true;
      return eylem('/api/seviye-odul', null, (r) => `🎁 Seviye ödülü: ${akce(r.tutar)}`).then((r) => { if (r?.tamam) ses('seviye'); });
    case 'gunluk-odul':
      b.disabled = true;
      return eylem('/api/gunluk-odul', null, (r) => `🎁 ${r.seri}. gün ödülü: ${akce(r.akce)} + ${r.tp} TP`).then((r) => { if (r?.tamam) ses('para'); });
    case 'ciftlige-gir':
      return ciftligeGir();
    case 'siparis-teslim':
      b.disabled = true;
      return eylem(`/api/siparis/${b.dataset.id}/teslim`, null, (r) => `📦 ${r.musteri} siparişini aldı: ${akce(r.odul)} + ${r.tp} TP`).then((r) => { if (r?.tamam) ses('para'); });
    case 'siparis-reddet':
      return eylem(`/api/siparis/${b.dataset.id}/reddet`, null, 'Sipariş reddedildi; yakında yeni müşteri gelir');
    // ---- Pazar
    case 'pazar-alt':
      durum.pazarAlt = b.dataset.alt;
      return durum.sekme === 'pazar' ? panelCiz() : sekmeSec('pazar');   // başka sekmeden (ör. parsel kartı) gelindiyse
    case 'borsa-urun':
      borsaUrunSec(b.dataset.urun);
      return panelCiz();
    case 'hemen-al':
      if (!confirm(`Bu parseli ${akce(Number(b.dataset.fiyat))} karşılığında satın almak istiyor musun? İşlem geri alınamaz.`)) return;
      b.disabled = true;
      return eylem(`/api/ilan/${b.dataset.ilan}/hemen-al`, { fiyat: Number(b.dataset.fiyat) }, (r) => `🤝 Parsel artık senin (${akce(r.fiyat)})`);
    case 'teklif-geri':
      return eylem(`/api/ilan/${b.dataset.ilan}/teklif-geri`, null, (r) => `↩️ Teklif geri çekildi, ${akce(r.iade)} iade edildi`);
    case 'teklif-kabul':
      if (!confirm(`${akce(Number(b.dataset.tutar))} teklifini kabul ediyor musun? Parsel, yapıları ve ekiniyle birlikte devredilir.`)) return;
      b.disabled = true;
      return eylem(`/api/teklif/${b.dataset.teklif}/kabul`, null, (r) => `🤝 Satış tamamlandı: ${akce(r.fiyat - r.ucret)} hesabına geçti`);
    case 'teklif-red':
      return eylem(`/api/teklif/${b.dataset.teklif}/red`, null, 'Teklif reddedildi, tutar alıcıya iade edildi');
    case 'hazineye-sat': {
      const teklif = Number(b.dataset.teklif);
      if (!confirm(`Bu parseli yapıları ve süsleriyle Hazine'ye ${akce(teklif)} karşılığında satmak istiyor musun? Geri alınamaz; parsel Hazine ilanına çıkar.`)) return;
      b.disabled = true;
      return eylem(`/api/parsel/${id}/hazineye-sat`, { teklif }, (r) => `🏛️ Hazine'ye satıldı: +${akce(r.teklif)} (${r.kar >= 0 ? 'kâr +' : 'zarar −'}${akce(Math.abs(r.kar))})`);
    }
    case 'ilan-iptal':
      if (!confirm('İlanı kaldırmak istiyor musun? Bekleyen teklifler iade edilir.')) return;
      return eylem(`/api/ilan/${b.dataset.ilan}/iptal`, null, 'İlan kaldırıldı');
  }
}
$('#panelIcerik').addEventListener('click', (e) => {
  const b = e.target.closest('[data-eylem]');
  if (!b || b.disabled) return;
  return eylemDagit(b, e);
});

$('#panelIcerik').addEventListener('change', (e) => {
  const f = e.target.closest('[data-filtre]');
  if (!f) return;
  durum.pazarFiltre[f.dataset.filtre] = f.value;
  panelCiz();
});
$('#panelIcerik').addEventListener('input', (e) => {
  const f = e.target.closest('.ilan-form');
  if (f) netOnizleme(f, durum.kurallar);
  if (e.target.name === 'manifesto') {
    const sayac = e.target.closest('form').querySelector('[data-sayac="manifesto"]');
    if (sayac) sayac.textContent = `${e.target.value.length}/600`;
  }
});

$('#panelIcerik').addEventListener('submit', (e) => {
  const v = formVerisi;   // para alanları (data-para) TL'den oyun birimine çevrilir
  const pid = durum.secili && encodeURIComponent(durum.secili);
  // Çarşı: satın alma ve banka
  if (e.target.matches('.carsi-al-form')) {
    e.preventDefault();
    const adet = Number(v(e.target).adet || 1);
    return eylem('/api/carsi/satin-al', { urun: e.target.dataset.urun, adet }, (r) => `🛍️ ${r.marka}: ${adet > 1 ? `${adet} × ` : ''}${durum.kurallar.urunler[r.urun]?.ad || r.urun} alındı (${akce(r.tutar)})`);
  }
  if (e.target.matches('.alarm-form')) {
    e.preventDefault();
    return eylem('/api/alarm', { bolgeId: Number(e.target.dataset.bolge), hedef: Number(v(e.target).hedef) },
      (r) => `🔔 Alarm kuruldu: ${r.mahalle} endeksi ${r.yon === 'YUKARI' ? 'yükselip' : 'düşüp'} ${v(e.target).hedef} olunca haber vereceğiz`);
  }
  if (e.target.matches('.ihale-form')) {
    e.preventDefault();
    return eylem(`/api/ihale/${e.target.dataset.id}/teklif`, { tutar: Number(v(e.target).tutar) }, (r) => `🔨 Teklifin ${akce(r.tutar)}; ihalede şu an öndesin`);
  }
  if (e.target.matches('.yardim-form')) {
    e.preventDefault();
    const d = v(e.target);
    return eylem('/api/yardim', { urun: d.urun, adet: Number(d.adet) }, '🙋 İsteğin kooperatife iletildi');
  }
  if (e.target.matches('.vadeli-form')) {
    e.preventDefault();
    return eylem('/api/banka/vadeli', { tutar: Number(v(e.target).tutar) }, (r) => `🔒 Vadeli hesap açıldı; vadesinde ${akce(r.getiri)} getiri`);
  }
  if (e.target.matches('.ilan-form')) {
    e.preventDefault();
    const d = v(e.target);
    return eylem(`/api/parsel/${pid}/ilan`, { fiyat: Number(d.fiyat), gun: Number(d.gun), kosul: d.kosul },
      (r) => `🏷️ İlan yayında. Satılırsa eline ${akce(r.net)} geçer`);
  }
  if (e.target.matches('.teklif-form')) {
    e.preventDefault();
    return eylem(`/api/ilan/${e.target.dataset.ilan}/teklif`, { tutar: Number(v(e.target).tutar) },
      (r) => (r.npcKabul ? `🤝 Teklifin kabul edildi; parsel artık senin (${akce(r.fiyat)})` : `💬 ${akce(r.tutar)} teklifin iletildi; tutar kilitlendi`));
  }
  if (e.target.matches('.kira-form')) {
    e.preventDefault();
    const d = v(e.target);
    return eylem(`/api/parsel/${pid}/kira`, { gunluk: Number(d.gunluk), gun: Number(d.gun) }, 'Kira teklifi açıldı');
  }
  if (e.target.matches('.ortak-form')) {
    e.preventDefault();
    const d = v(e.target);
    return eylem(`/api/parsel/${pid}/ortak`, { ortakAd: d.ortakAd, pay: Number(d.pay) / 100 }, 'Ortaklık daveti gönderildi');
  }
  if (e.target.matches('.sevk-form')) {
    e.preventDefault();
    const d = v(e.target);
    return eylem('/api/sevkiyat', { urun: d.urun, miktar: Number(d.miktar), kaynak: d.kaynak, hedef: d.hedef, mod: d.mod },
      (r) => `🚚 Sevkiyat yola çıktı (${r.km} km, nakliye ${akce(r.maliyet)}, tahmini satış ${akce(r.tahminiGelir)})`);
  }
  if (e.target.matches('.uretim-form')) {
    e.preventDefault();
    const d = v(e.target);
    return eylem(`/api/parsel/${pid}/uretim`, { recete: d.recete, parti: Number(d.parti) }, (r) => `⚙️ Üretim başladı${r.enerji ? ` (enerji ${akce(r.enerji)})` : ''}`);
  }
  if (e.target.matches('.koop-kur')) {
    e.preventDefault();
    const d = v(e.target);
    return eylem('/api/kooperatif', { ilId: Number(d.ilId), ad: d.ad, aciklama: d.aciklama }, '🤝 Kooperatif kuruldu');
  }
  if (e.target.matches('.koop-aidat')) {
    e.preventDefault();
    return eylem('/api/kooperatif/aidat', { tutar: Number(v(e.target).tutar) }, 'Aidat ortak kasaya yatırıldı');
  }
  if (e.target.matches('.emir-form')) {
    e.preventDefault();
    const d = v(e.target);
    return eylem('/api/borsa/emir', { urun: d.urun, yon: d.yon, fiyat: Number(d.fiyat), miktar: Number(d.miktar), gun: Number(d.gun) },
      (r) => (r.dolan ? `${r.dolan} adet hemen eşleşti${r.kalan ? `, ${r.kalan} adet defterde bekliyor` : ''}` : 'Emrin deftere yazıldı'));
  }
  if (e.target.matches('.fiyat-form')) {
    e.preventDefault();
    return eylem(`/api/ilan/${e.target.dataset.ilan}/fiyat`, { fiyat: Number(v(e.target).fiyat) }, (r) => `Fiyat ${akce(r.fiyat)} olarak güncellendi`);
  }
  const f = e.target.closest('.sat-form');
  if (!f) return;
  e.preventDefault();
  const miktar = Number(new FormData(f).get('miktar'));
  eylem('/api/pazar/sat', { urun: f.dataset.urun, miktar },
    (r) => `💰 ${sayi(r.adet)} adet ${akce(r.tutar)} karşılığında satıldı${r.kismi ? ' (talep sınırı)' : ''}`);
});

$$('.sekmeler button').forEach((b) => b.addEventListener('click', () => sekmeSec(durum.grupSon?.[b.dataset.sekme] || b.dataset.sekme)));

// Süre sayaçları (yeniden çizmeden)
let yenilemeBekliyor = false;
function sayaclariGuncelle() {
  const t = sunucuSimdi();
  // Biten sayaç yalnızca bir kez tazeleme tetikler (ekranda kalan süresi geçmiş bir sayaç sonsuz tazeleme döngüsü
  // başlatıyordu); yalnızca paneldeki sayaçlar parsel/yönetim tazelemesine bakar
  let biten = false;
  for (const el of $$('[data-bitis]')) {
    const kalan = Number(el.dataset.bitis) - t;
    el.textContent = sure(kalan);
    if (kalan <= 0 && !el.dataset.bitti) { el.dataset.bitti = '1'; if (el.closest('#panelIcerik')) biten = true; }
  }
  for (const el of $$('[data-ilerleme-bas]')) {
    const bas = Number(el.dataset.ilerlemeBas), son = Number(el.dataset.ilerlemeSon);
    el.style.width = `${Math.min(100, ((t - bas) / (son - bas)) * 100)}%`;
  }
  if (biten && !yenilemeBekliyor && durum.secili) {
    yenilemeBekliyor = true;
    setTimeout(async () => {
      try {
        durum.kart = await api(`/api/parsel/${encodeURIComponent(durum.secili)}`);
        await haritaYenile();
        if (durum.sekme === 'parsel') panelCiz();
      } finally { yenilemeBekliyor = false; }
    }, 700);
  }
}

// ================= Bildirimler =================
// Bildirim türü simgesi: metin bir emojiyle başlıyorsa o, değilse bağlantı türünden
const BILDIRIM_SIMGE = { pazar: '💰', parsel: '🌾', arazilerim: '🧺', komsuluk: '🤝', gorevler: '🎯', yonetim: '🛡️' };
function bildirimSimgesi(n) {
  const e = /^(\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u.exec(n.text);
  if (e) return { simge: e[1], metin: n.text.slice(e[0].length) };
  return { simge: BILDIRIM_SIMGE[String(n.link || '').split(':')[0]] || '🔔', metin: n.text };
}
async function bildirimAc() {
  const kutu = $('#bildirimKutu');
  if (!kutu.hidden) { kutu.hidden = true; return; }
  const liste = await api('/api/bildirimler');
  // Aynı metinli bildirimler en yenisinin yerinde tek satırda "×N" toplanır
  const metinle = new Map();
  for (const n of liste) {
    const g = metinle.get(n.text);
    if (g) { g.adet++; g.yeni ||= !n.okundu; } else metinle.set(n.text, { ...n, adet: 1, yeni: !n.okundu });
  }
  const gruplar = [...metinle.values()];
  const yeniSayi = liste.filter((n) => !n.okundu).length;
  kutu.innerHTML = `<div class="bildirim-baslik"><b>Bildirimler</b>${yeniSayi ? `<span class="bildirim-yeni">${yeniSayi >= 60 ? '60+' : yeniSayi} yeni</span>` : ''}
      <button type="button" class="bildirim-kapat" aria-label="Kapat">✕</button></div>
    ${gruplar.length ? `<ul>${gruplar.map((n) => {
      const { simge, metin } = bildirimSimgesi(n);
      return `<li><button type="button" class="${n.yeni ? 'yeni' : ''}" data-link="${esc(n.link || '')}">
        <span class="bildirim-simge">${simge}</span>
        <span class="bildirim-govde"><span class="bildirim-metin">${esc(metin)}</span>
          <span class="bildirim-alt"><time>${zamanOnce(n.created_at)}</time>${n.adet > 1 ? `<span class="bildirim-adet">×${n.adet}</span>` : ''}</span></span>
        ${n.yeni ? '<span class="bildirim-nokta" aria-label="yeni"></span>' : ''}</button></li>`;
    }).join('')}</ul>`
    : '<div class="bildirim-bos"><span>🔔</span><b>Her şey yolunda</b><p>Yeni bir şey olduğunda burada göreceksin.</p></div>'}`;
  kutu.hidden = false;
  if (liste.some((n) => !n.okundu)) { await api('/api/bildirimler/okundu', {}); benYenile({ sessiz: true }); }
}
document.addEventListener('click', (e) => { const k = $('#bildirimKutu'); if (!k.hidden && !e.target.closest('.bildirim-sar')) k.hidden = true; });
$('#bildirimDugme').addEventListener('click', (e) => { e.stopPropagation(); bildirimAc(); });
$('#bildirimKutu').addEventListener('click', (e) => {
  if (e.target.closest('.bildirim-kapat')) { $('#bildirimKutu').hidden = true; return; }
  const b = e.target.closest('[data-link]');
  if (!b) return;
  $('#bildirimKutu').hidden = true;
  baglantiyaGit(b.dataset.link);
});
// Bildirim bağlantıları: "parsel:TR-…", "pazar:borsa", "arazilerim", "yonetim" (kaldırılan seçim bölümünün eski "mahalle:" / "belediye:" bağlantıları bir şey yapmaz)
function baglantiyaGit(link) {
  const [tur, deger] = String(link || '').split(':');
  if (tur === 'parsel' && deger) { durum.harita.parseleGit(deger); parselSec(deger); }
  else if (tur === 'pazar') { durum.pazarAlt = deger || 'ilanlar'; sekmeSec('pazar'); }
  else if (tur === 'arazilerim') sekmeSec('arazilerim');
  else if (tur === 'komsuluk') ciftlikAlt('komsular');
  else if (tur === 'gorevler') ciftlikAlt('ciftlik');
  else if (tur === 'yonetim') location.href = '/yonetim.html';
  else if (tur === 'carsi') { durum.carsiAlt = deger || null; sekmeSec('carsi'); }
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('#bildirimKutu')) $('#bildirimKutu').hidden = true;
});

// ================= Mobil çekmece =================
// Masaüstünde sağ panel katlanır: kapalıyken harita tüm pencereyi kaplar; bir yer seçilince ya da sekme açılınca kendiliğinden açılır
function masaustu() { return !window.matchMedia('(max-width: 820px)').matches; }
function panelDurumu(acik, { kaydet = true } = {}) {
  $('.sahne').classList.toggle('panel-kapali', !acik);
  $('#panelKatla').setAttribute('aria-expanded', String(acik));
  $('#panelKatla').title = acik ? 'Paneli kapat' : 'Paneli aç';
  if (kaydet) tercihYaz('st-panel', acik ? 'acik' : 'kapali');
  durum.harita?.paneleGoreSigdir();
}
function panelAc() { if (masaustu() && $('.sahne').classList.contains('panel-kapali')) panelDurumu(true, { kaydet: false }); }   // kendiliğinden açılış tercihi değiştirmez
$('#panelKatla').addEventListener('click', () => panelDurumu($('.sahne').classList.contains('panel-kapali')));
panelDurumu(tercihOku('st-panel', 'kapali') === 'acik', { kaydet: false });

function panelBoyut(sinif) {
  const p = $('#panel');
  p.classList.remove('buyuk', 'kucuk');
  if (sinif) p.classList.add(sinif);
}
$('#panelTutamac').addEventListener('click', () => {
  const p = $('#panel');
  panelBoyut(p.classList.contains('kucuk') ? '' : p.classList.contains('buyuk') ? 'kucuk' : 'buyuk');
});

// ================= Kimlik (tam sayfa açılış ve hesap akışları: giris-ui.js) =================
function authAc(mod) { giris.ac({ kayit: 'karsilama', giris: 'giris', ikiAdim: 'ikiAdim' }[mod] || mod, { oyundan: true }); }
async function girisSonrasi(mesaj) {
  canliYenile();
  await benYenile();
  await haritaYenile();
  if (durum.secili) durum.kart = await api(`/api/parsel/${encodeURIComponent(durum.secili)}`);
  panelCiz();
  if (mesaj) tost(mesaj);
}
const giris = girisKur({ api, tost, girisSonrasi, iller: () => durum.bolgeler.filter((b) => b.type === 'IL'),
  rehberBaslat: () => { durum.rehber?.guncelle(); sekmeSec('parsel'); }, sihirbazda: () => !!durum.sihirbaz?.aktif() });
tanitimKur({ api, girisli, kayitAc: () => giris.ac('karsilama'), epostaKayit: () => giris.ac('hesap'), girisAc: () => giris.ac('giris'),
  kapat: () => giris.kapat(), kartKapat: () => giris.kartKapat(), disariTik: () => giris.disariTik(), ilOner: (p) => giris.ilOner(p) });
$('#girisDugme').addEventListener('click', () => authAc('giris'));

async function cikisSonrasi() {
  durum.ben = null; durum.cuzdan = null;
  canliYenile();
  sohbetKanallariniYenile();
  ustCiz();
  hesapDurumuCiz(null);
  if (durum.secili) durum.kart = await api(`/api/parsel/${encodeURIComponent(durum.secili)}`);
  await haritaYenile();
  panelCiz();
}
$('#cikisDugme').addEventListener('click', async () => { await api('/api/cikis', {}); await cikisSonrasi(); });
hesapKur({ yenile: () => benYenile({ sessiz: true }), cikti: cikisSonrasi, iller: () => durum.bolgeler.filter((b) => b.type === 'IL') });

// ================= Canlılık =================
// Bildirim anında gelir; herkese açık olaylar haritayı ve akışı (yığılmayı önlemek için gecikmeli) tazeler
let olayZamanlayici = 0;
canliDinle('bildirim', (m) => {
  tost(`🔔 ${m.metin}`);
  if (durum.ben?.hesap?.ayarlar?.bildirimSesi) ses('bildirim');
  benYenile({ sessiz: true });
});
// Ülkenin her yerindeki olaylar gelir: harita yalnızca olay ekrandaki alandaysa (ve çiftlik açık değilse) tazelenir;
// tazeleme birikip 4–6 sn sonra bir kez yapılır (binlerce oyuncu aynı anda haritayı yeniden indirmesin)
canliDinle('olay', (m) => {
  const gorunurde = !!m?.parsel && !!durum.harita?.gorunurMu?.(m.parsel);
  if (!m?.ben && gorunurde) durum.harita?.canliBaloncuk(m?.eylem, m?.parsel);
  if (!gorunurde && durum.sekme !== 'haberler') return;
  if (olayZamanlayici) return;
  olayZamanlayici = setTimeout(() => {
    olayZamanlayici = 0;
    if (document.hidden) return;
    if (gorunurde && !durum.ciftlikIci?.acik()) haritaYenile();
    if (durum.sekme === 'haberler') panelCiz();
  }, 4000 + Math.random() * 2000);
});
canliDinle('durum', (d) => { document.body.classList.toggle('cevrimdisi', d !== 'acik'); });
sohbetKur({
  kanallarFn: () => {
    const k = [];
    const mahalle = durum.mahalleId || durum.ben?.portfoy?.[0]?.mahalleId;
    const mAd = durum.ben?.portfoy?.find((p) => p.mahalleId === Number(mahalle))?.mahalle;
    if (mahalle) k.push({ kanal: `mahalle:${mahalle}`, ad: mAd || 'Mahalle', ikon: '🏘️' });
    if (durum.konum?.ilId) k.push({ kanal: `il:${durum.konum.ilId}`, ad: `${durum.konum.il} meydanı`, ikon: '🏛️' });
    if (durum.ben?.hesap?.memleket) k.push({ kanal: `memleket:${durum.ben.hesap.memleket.plaka}`, ad: `${durum.ben.hesap.memleket.ad} hemşehrileri`, ikon: '🧿' });
    return k;
  },
  sikayetAc: (tur, id, baslik) => (girisli() ? sikayetAc(tur, id, baslik) : authAc('giris')),
  girisAc: () => authAc('giris'),
});

// İstemci hataları sunucu günlüğüne (sayfa başına en çok 5; kişisel veri gönderilmez)
let hataSayisi = 0;
function hataBildir(ileti, dosya, satir, yigin) {
  if (++hataSayisi > 5) return;
  fetch('/api/istemci-hata', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ileti: String(ileti).slice(0, 500), dosya: String(dosya || '').replace(location.origin, ''), satir, yigin: String(yigin || '').slice(0, 1500), surum: durum.kurallar?.surum || '' }) }).catch(() => {});
}
window.addEventListener('error', (e) => hataBildir(e.message, e.filename, e.lineno, e.error?.stack));
window.addEventListener('unhandledrejection', (e) => hataBildir(e.reason?.message || e.reason, '', null, e.reason?.stack));

basla().catch((e) => {
  console.error(e);
  tost('Oyun yüklenemedi: ' + e.message, 'hata');
});

// Sevkiyat önizlemesi: alan değiştikçe sunucudan maliyet/süre/gelir tahmini
$('#panelIcerik').addEventListener('change', (e) => { const f = e.target.closest('.sevk-form'); if (f) sevkiyatOnizle(f); });

// ================= Çiftliğim alt bölümü, genel pencere, etkinlik şeridi, balık tutma, rehber =================
function ciftlikAlt(alt) {
  durum.ciftlikAlt = alt;
  if (window.matchMedia('(max-width: 820px)').matches) panelBoyut('');
  sekmeSec('gorevler');
}
function genelPencere(html) {
  $('#genelGovde').innerHTML = html;
  const d = $('#genelModal');
  if (!d.open) d.showModal();
  return d;
}
$('#genelModal').addEventListener('click', (e) => { if (e.target.closest('[data-kapat]') || e.target === e.currentTarget) e.currentTarget.close(); });
// Ürün gönderme formu pencerede: gönderimi panel dağıtıcısına ilet
$('#genelModal').addEventListener('submit', (e) => {
  if (!e.target.matches('.urun-gonder-form')) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  $('#genelModal').close();
  eylem('/api/urun/gonder', { kullaniciId: Number(e.target.dataset.id), urun: d.urun, adet: Number(d.adet) }, () => `📦 ${sayi(Number(d.adet))} ${urunAd(d.urun)} gönderildi`);
});

// Etkinlik verisi (Çiftlik → Etkinlik sekmesi ve rozeti). Haritanın üstündeki etkinlik şeridi v0.43'te kaldırıldı.
async function etkinlikYenile() {
  try { durum.etkinlik = await api('/api/etkinlik'); } catch { /* etkinlik isteğe bağlıdır */ }
}
// Hava penceresindeki tarlalar: örtü ser ya da tarlaya git
$('#genelModal').addEventListener('click', async (e) => {
  const b = e.target.closest('.hava-penceresi [data-eylem]');
  if (!b || b.disabled) return;
  const id = b.dataset.id;
  if (b.dataset.eylem === 'git') { $('#genelModal').close(); durum.harita.parseleGit(id); return parselSec(id); }
  if (b.dataset.eylem === 'ortu') {
    b.disabled = true;
    await eylem(`/api/parsel/${encodeURIComponent(id)}/ortu`, null, (r) => `⛺ Tarla örtüldü (${akce(r.maliyet)}); 12 saat korunuyor`);
    havaSeridiYenile({ zorla: true });
  }
});

// Balık tutma: 🎣'a basınca oyun hemen açılır. Olta oyuncunun bölgesinin suyuna atılır (çiftliğin ili; kıyıdaysa deniz,
// değilse göl/nehir); haritada su aramak gerekmez. Konum çiftlikten, tarla yoksa haritanın ortasından alınır.
let balikOyun = null;
$('#oltaDugme').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!durum.harita) return;
  if (!girisli()) { tost('Balık tutmak için giriş yap', 'hata'); return; }
  if (!acikMi('balik')) { tost(`🎣 Balık tutma seviye ${sayiBulunma(ACILIMLAR.find((a) => a.kod === 'balik').seviye)} açılır`, 'hata'); return; }
  const tarla = durum.ben?.portfoy?.[0];
  const konum = tarla?.lon != null ? { lon: tarla.lon, lat: tarla.lat } : (({ lng, lat }) => ({ lon: lng, lat }))(durum.harita.merkez?.() || { lng: 32.48, lat: 37.87 });
  const d = genelPencere('<h2 class="pencere-baslik">🎣 Balık tutma</h2><div id="balikAlani"></div>');
  balikOyun?.kapat();
  balikOyun = balikOyunu($('#balikAlani'), { api, ses, sonuc: () => benYenile({ sessiz: true }) });
  balikOyun.at(konum);
  d.addEventListener('close', () => { balikOyun?.kapat(); balikOyun = null; }, { once: true });
});
window.addEventListener('rehber-yeniden', () => durum.rehber?.yeniden());
