// Tam sayfa çiftlik: oyuncu kendi parseline girer ve oyunu içeriden oynar (sevimli 3B tarz).
// Ekine dokun → sula / hasat et; boş tarlaya dokun → ne ekeceğini seç; yapıya dokun → durumu, hayvan ürünü topla/yemle;
// boş alana dokun → inşaat atölyesi. Eylemler paneldeki ortak dağıtıcıdan (eylemDagit) geçer; sonuçlar sunucudan gelir.
// Çiftçi dokunulan yere yürüyüp işi yapar, ardından efekt ("+N", uçuşan ürünler) çıkar. Geri: haritaya dönüş.
import * as THREE from '/vendor/three/three.module.js';
import { api, esc, akce, sayi, sure, tamlayan } from './yardimci.js';
import { endeksGrafigi, degisimCipi, kisaTarih } from './grafik.js';
import { S } from './model3d.js';
import { tarlaCercevesi } from './tarla-geo.js';
import { RENK, RUZGAR, malz, levha, yuvarlakAgac, cam, cali, tas, ciftci, papatyalar, otTutamlari, ornekli, kureGeo } from './sevimli3d.js';
import { sevimliParselModeli, sevimliKomsu } from './sevimli-parsel.js';
import { tavsan, kirpi, ordek, cesme, dukkan, ev, apartman, pansiyon, bayrakDiregi } from './sevimli3d-yapi.js';
import { sevimliSonIslem, gokFonu, MOBIL } from './sevimli-efekt.js';
import { canliKur } from './sevimli-canli.js';
import { ses, ortamSesi } from './ses.js';
import { paylas } from './foto.js';
import { bulmacaAc } from './bulmaca.js';
import { gunesKonumu, isikRengi } from './gunes.js';

function tohumlu(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

// Düğme altı için kısa süre: "3 sa", "25 dk"
const kisaSure = (ms) => (ms >= 3600_000 ? `${Math.floor(ms / 3600_000)} sa` : `${Math.max(1, Math.ceil(ms / 60_000))} dk`);

export function ciftlikIciKur({ durum, eylemDagit, sunucuSimdi, ayrintiAc, dunyayaCik, yenileDis, tostDis, tarlayaGec, ziyaretEt }) {
  const kok = document.createElement('div');
  kok.className = 'ci';
  kok.hidden = true;
  kok.innerHTML = `<div class="ci-sahne"></div>
    <div class="ci-ust">
      <button type="button" class="ci-geri" data-ci="kapat" aria-label="Köy haritasına çık">🏘️ <span>Köy</span></button>
      <div class="ci-baslik" data-ci="arazilerim" role="button" tabindex="0" aria-label="Arazilerim"></div>
      <button type="button" class="ci-geri ci-foto" data-ci="foto" aria-label="Fotoğraf çek ve paylaş" title="Fotoğraf ve paylaşım kartı">📸</button>
      <div class="ci-sayaclar"></div>
    </div>
    <div class="ci-envanter"></div>
    <div class="ci-ipucu">Bir yere dokun: ekine, toprağa, yapıya ya da boş alana</div>
    <div class="ci-sayfa" hidden></div>
    <div class="ci-alt"></div>`;
  document.body.appendChild(kok);
  const sahneKap = kok.querySelector('.ci-sahne'), baslik = kok.querySelector('.ci-baslik'), sayaclar = kok.querySelector('.ci-sayaclar');
  const envanter = kok.querySelector('.ci-envanter'), alt = kok.querySelector('.ci-alt'), sayfa = kok.querySelector('.ci-sayfa'), ipucu = kok.querySelector('.ci-ipucu');

  let gok = null, gunes = null, gece = 0, kis = false, kar = null;
  let ziyaret = false, isci = null;
  const komsuKartlari = new Map();   // çiftliğe katılmış komşu parsellerin kartları (sahneye çizmek için)
  let renderer = null, sahne, ust, kamera, efekt = null, canli = null, grup = null, model = null, parselG = null, kare = 0, onceki = 0, acik = false;
  let aci = -0.6, egim = 0.95, uzaklik = 70, hedefUzaklik = 70, odak = new THREE.Vector3(), kadraj = 30, sayfaHedef = null;
  const hedefOdak = new THREE.Vector3();   // kamera odağı yumuşakça buraya kayar (meydan görünümü)
  let meydanKonum = null, meydanOncekiUzaklik = null;

  function kur() {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(MOBIL ? 1.5 : 2, devicePixelRatio));   // telefonda 3× piksel yoğunluğu çizilmez
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    sahneKap.appendChild(renderer.domElement);
    sahne = new THREE.Scene(); ust = new THREE.Scene();
    sahne.background = gokFonu();
    kamera = new THREE.PerspectiveCamera(32, 1, 1, 900);
    sahne.add(new THREE.HemisphereLight('#e8f1ff', '#b9d98a', 1.55));
    gok = sahne.children.at(-1);
    gunes = new THREE.DirectionalLight('#fff3df', 1.9);
    gunes.position.set(-45, 80, 35); gunes.castShadow = true;
    gunes.shadow.mapSize.setScalar(MOBIL ? 1024 : 2048);
    Object.assign(gunes.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 260 });
    gunes.shadow.radius = 8; gunes.shadow.blurSamples = 16; gunes.shadow.bias = -0.0005;
    sahne.add(gunes);
    grup = new THREE.Group(); sahne.add(grup);
    canli = canliKur(sahne, { sesCal: ses, ust });
    sevimliSonIslem(renderer, sahne, kamera, ust).then((e) => { efekt = e; boyutla(); }).catch(() => {});
    addEventListener('resize', boyutla);
    etkilesimKur();
  }
  function boyutla() {
    if (!renderer) return;
    const g = innerWidth, y = innerHeight;
    renderer.setSize(g, y); kamera.aspect = g / y; kamera.fov = g < y ? 44 : 32; kamera.updateProjectionMatrix();
    efekt?.boyut(g, y);
  }

  // ---------- Gün ve mevsim: parselin gerçek konumuna göre güneş; gece ay ışığı ve yanan pencereler, kışın kar
  // Gün evreleri (güneşin gerçek yüksekliği): gündüz, altın saat (gün doğumu/batımı), alacakaranlık, gece.
  // ?saat=21 ile denemede saat zorlanabilir.
  const EVRE = {
    gunduz: { gok: ['#9fd3f5', '#d5ecf7', '#f6f0dc'], sis: '#dcebef', hemi: ['#e8f1ff', '#b9d98a', 1.55], isik: ['#fff3df', 1.9], yildiz: 0 },
    altin:  { gok: ['#7fb2e6', '#f6c79a', '#ffd9a8'], sis: '#f3d2b4', hemi: ['#ffe6c8', '#b9c98a', 1.25], isik: ['#ffb877', 1.35], yildiz: 0 },
    alaca:  { gok: ['#3a4a86', '#a678b0', '#f2a58a'], sis: '#8e7fa6', hemi: ['#b9a6d8', '#5e6a4a', 0.85], isik: ['#c79be0', 0.55], yildiz: 0.45 },
    gece:   { gok: ['#0f1a3a', '#223467', '#3f5288'], sis: '#2c3b66', hemi: ['#7d90c8', '#26331f', 0.6], isik: ['#a9bfff', 0.42], yildiz: 1 },
  };
  const gunZamani = () => {
    const z = Number(new URLSearchParams(location.search).get('saat'));
    if (!Number.isFinite(z) || new URLSearchParams(location.search).get('saat') == null) return Date.now();
    const d = new Date(); d.setHours(Math.floor(z), Math.round((z % 1) * 60), 0, 0); return d.getTime();
  };
  let evre = 'gunduz';
  function zamanAyarla() {
    const k = durum.kart, g = gunesKonumu(k.konum.lon, k.konum.lat, gunZamani());
    evre = g.yukseklik > 12 ? 'gunduz' : g.yukseklik > 0 ? 'altin' : g.yukseklik > -7 ? 'alaca' : 'gece';
    const e = EVRE[evre];
    const oncekiGece = gece;
    gece = evre === 'gece' || evre === 'alaca' ? 1 : 0;   // pencereler alacakaranlıkta yanar
    if (acik && oncekiGece !== gece) ortamSesi(true, { gece: !!gece });   // gece cırcır böceği, gündüz kuşlar
    const az = (g.azimut * Math.PI) / 180;
    if (evre === 'gece') {
      // Ay ışığı: güneşin karşı yönünden, yüksekten; soğuk mavi
      const yk = (45 * Math.PI) / 180;
      gunes.position.set(-Math.sin(az) * Math.cos(yk) * 100, Math.sin(yk) * 100, Math.cos(az) * Math.cos(yk) * 100);
    } else {
      const yk = (Math.max(evre === 'gunduz' ? 10 : 6, g.yukseklik) * Math.PI) / 180;
      gunes.position.set(Math.sin(az) * Math.cos(yk) * 100, Math.sin(yk) * 100, -Math.cos(az) * Math.cos(yk) * 100);
    }
    gunes.color.set(e.isik[0]); gunes.intensity = e.isik[1];
    gok.color.set(e.hemi[0]); gok.groundColor.set(e.hemi[1]); gok.intensity = e.hemi[2];
    sahne.background?.dispose?.();   // dakikada bir yenilenir: eski gökyüzü dokusu bellekte kalmasın
    sahne.background = gokFonu(e.gok);
    // Uzaklık sisi: tepeler ve ağaç kuşağı ufukta gökyüzüne karışır (derinlik hissi)
    sahne.fog = new THREE.Fog(e.sis, 190, 640);
    gokcismiAyarla(e.yildiz, az);
    const ay = new Date().getMonth();
    kis = ay === 11 || ay <= 1;
  }
  // Yıldızlar ve ay: sis dışı, gökyüzü kubbesinde; yalnızca akşam ve gece görünür
  let yildizlar = null, ayGorsel = null;
  function gokcismiAyarla(yogunluk, gunesAz) {
    if (!yildizlar) {
      const n = MOBIL ? 260 : 520, p = new Float32Array(n * 3), r = tohumlu('yildiz');
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, y = 0.12 + r() * 0.88, d = Math.sqrt(1 - y * y);
        p.set([Math.cos(a) * d * 560, y * 560, Math.sin(a) * d * 560], i * 3);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      yildizlar = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#fffbe8', size: 2.2, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
      const hale = x.createRadialGradient(64, 64, 10, 64, 64, 64);
      hale.addColorStop(0, 'rgba(255,248,220,1)'); hale.addColorStop(0.32, 'rgba(255,244,210,.95)'); hale.addColorStop(0.36, 'rgba(210,225,255,.35)'); hale.addColorStop(1, 'rgba(180,200,255,0)');
      x.fillStyle = hale; x.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      ayGorsel = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, fog: false, depthWrite: false, transparent: true }));
      ayGorsel.scale.setScalar(70);
      sahne.add(yildizlar, ayGorsel);
    }
    yildizlar.visible = yogunluk > 0; yildizlar.material.opacity = yogunluk;
    ayGorsel.visible = yogunluk >= 1;
    const yk = (38 * Math.PI) / 180;
    ayGorsel.position.set(-Math.sin(gunesAz) * Math.cos(yk) * 520, Math.sin(yk) * 520, Math.cos(gunesAz) * Math.cos(yk) * 520);
  }
  // Köy fenerleri: patika kavşaklarında; akşam ve gece yanar (ışık kaynağı yok, parlayan cam + hale: telefonda ucuz)
  function fenerler(r, yaricap) {
    const g = new THREE.Group();
    const direk = new THREE.MeshLambertMaterial({ color: '#3d342c' });
    const cam = new THREE.MeshLambertMaterial({ color: gece ? '#ffe08a' : '#f4ecd8', emissive: gece ? '#ffc04d' : '#000000', emissiveIntensity: gece ? 1.6 : 0 });
    let hale = null;
    if (gece) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
      const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(255,196,96,.75)'); gr.addColorStop(0.45, 'rgba(255,170,70,.28)'); gr.addColorStop(1, 'rgba(255,150,50,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      hale = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    }
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const f = new THREE.Group();
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 4.2, 8), direk); d.position.y = 2.1;
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.62), cam); k.position.y = 4.55;
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.4, 4).rotateY(Math.PI / 4), direk); s.position.y = 5.1;
      f.add(d, k, s);
      if (hale) { const h = new THREE.Sprite(hale); h.scale.setScalar(3.4); h.position.y = 4.55; f.add(h); }
      f.position.set(sx * yaricap, 0, sz * yaricap + (r() - 0.5));
      f.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.add(f);
    }
    return g;
  }
  function karKur() {
    if (kar) { sahne.remove(kar); kar.geometry.dispose(); kar = null; }
    if (!kis) return;
    const n = 1400, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { p[i * 3] = (Math.random() - 0.5) * 160; p[i * 3 + 1] = Math.random() * 60; p[i * 3 + 2] = (Math.random() - 0.5) * 160; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    kar = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.5, transparent: true, opacity: 0.9, depthWrite: false }));
    sahne.add(kar);
  }

  // Parsel kartından sevimli model verisi (yapı seviyesi yp'nin 3. alanında)
  function kartVerisi(k) {
    const yp = (k.yapilar || []).map((y) => `${y.tip}:${y.durum === 'ACTIVE' ? 1 : 0}:${y.seviye || 1}`).join(',');
    const ek = k.ekin ? `${k.ekin.tip}:${Math.min(1, (sunucuSimdi() - k.ekin.ekim) / (k.ekin.hazir - k.ekin.ekim)).toFixed(2)}` : '';
    const ss = (k.susler || []).map((s) => `${s.tur}:${s.yuva}`).join(',');
    return { id: k.id, imar: k.imar.tip, yp, ek, kz: k.kozmetik, ss };
  }
  // Genişletme işareti: yere serili yarı saydam çerçeve ve havada zıplayan "+" rozeti
  let artiDoku = null;
  const ziplayanlar = [], rozetQ = new THREE.Quaternion(), rozetV = new THREE.Vector3();
  let bulutlar = null;
  function genisletIsareti() {
    const g = new THREE.Group();
    const cerceve = new THREE.Mesh(new THREE.PlaneGeometry(S - 3, S - 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18, depthWrite: false }));
    cerceve.position.y = 0.45; g.add(cerceve);
    if (!artiDoku) {
      const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
      const d = x.createLinearGradient(0, 0, 0, 256); d.addColorStop(0, '#5cc469'); d.addColorStop(1, '#2f8f3e');
      x.fillStyle = '#ffffff'; x.beginPath(); x.arc(128, 128, 128, 0, 7); x.fill();
      x.fillStyle = d; x.beginPath(); x.arc(128, 128, 110, 0, 7); x.fill();
      x.strokeStyle = '#ffffff'; x.lineWidth = 34; x.lineCap = 'round';
      x.beginPath(); x.moveTo(128, 70); x.lineTo(128, 186); x.moveTo(70, 128); x.lineTo(186, 128); x.stroke();
      artiDoku = new THREE.CanvasTexture(c); artiDoku.colorSpace = THREE.SRGBColorSpace; artiDoku.anisotropy = 4;
    }
    // Yuvarlak rozet (kare sprite değil): yumuşak gölgelendirme sprite'ın kare dörtgenini koyu leke olarak boyuyordu.
    // Kendi şeklindeki düz disk + arkasında ince kalınlık; her karede kameraya döner.
    const arti = new THREE.Group();
    const yuz = new THREE.Mesh(new THREE.CircleGeometry(2.5, 48), new THREE.MeshBasicMaterial({ map: artiDoku }));
    const kenar = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.35, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#d9e8d2' }));
    kenar.position.z = -0.19;
    arti.add(yuz, kenar); arti.position.y = 5;
    ziplayanlar.push(arti); g.add(arti);
    return g;
  }
  // Parselin çevresindeki 5 × 5 hücre: yakın komşular (3 × 3) ve dış halka
  const komsuHepsi = (k) => [...(k.komsular || []), ...(k.cevre || [])];
  // Çiftlik kümesi: açık parsel ve çevresindeki oyuncuya ait araziler. Kayıtta ayrı parsellerdir ama çiftlikte tek parça
  // gibi oynanır: Hasat / Sula / Ek hepsine birden işler, komşu araziye yerinde dokunulur (araziye geçmek gerekmez).
  function ciftlikSeti() {
    const k = durum.kart;
    if (!k || ziyaret) return [];
    const kimlikler = new Set([k.id, ...komsuHepsi(k).filter((n) => n.ben).map((n) => n.id)]);
    return (durum.ben?.portfoy || []).filter((p) => kimlikler.has(p.id));
  }
  // Olgunluk anlık hesaplanır (portföy son /api/ben anındaki görüntüdür; çiftlik açıkken ekin olgunlaşınca Hasat çıksın)
  const olgunMu = (p) => !!p.ekin && (p.ekin.olgun || (p.ekin.hazir != null && sunucuSimdi() >= p.ekin.hazir));
  const susuzMu = (p) => p.ekin && !olgunMu(p) && !p.ekin.otomatikSulama && p.ekin.sulama < p.ekin.gerekenSulama && !p.ekin.sonrakiSulamaMs;
  const bosMu = (p) => !p.ekin && p.imarAd === 'Tarım';
  const tohumKati = (alan) => Math.min(4, Math.max(1, Math.round(alan / 500)));
  // Arazilerim: oyuncunun bütün arazileri; dokununca o araziye geçilir (çiftlik o arazide açılır)
  function arazilerimSayfasi() {
    if (ziyaret) return;
    const liste = durum.ben?.portfoy || [];
    sayfaAc(`${ust2('🗺️', 'Arazilerim', `${liste.length} arazi · toplam ${sayi(liste.reduce((t, p) => t + (p.area_m2 || 0), 0))} m²`)}
      <div class="ci-liste">${liste.map((p) => {
        const bu = p.id === durum.kart?.id;
        const ekin = p.ekin ? `${p.ekin.ikon || '🌱'} ${esc(p.ekin.ad || '')}${olgunMu(p) ? ' · hasada hazır' : ''}` : (p.imarAd === 'Tarım' ? 'boş tarla' : esc(p.imarAd));
        return `<div class="ci-satir ${bu ? 'secili' : ''}"><span class="ci-satir-ikon">${p.imarAd === 'Tarım' ? '🌾' : '🏡'}</span>
          <div><b>${esc(p.mahalle)}${p.adaParsel ? ` · Ada ${p.adaParsel.ada}/${p.adaParsel.parsel}` : ''}</b><small>${sayi(p.area_m2)} m² · ${ekin}</small></div>
          ${bu ? '<span class="ci-sayi">buradasın</span>' : `<button type="button" class="ci-b kucuk" data-ci="tarlaya-gec" data-parsel="${esc(p.id)}">Git</button>`}</div>`;
      }).join('')}</div>`);
  }
  // Çiftliğe katılmış komşu arazi: durumu ve yerinde iş (hasat, sula, ek) — başka araziye geçmeden
  function komsuBenSayfasi(id) {
    const kk = komsuKartlari.get(id), p = (durum.ben?.portfoy || []).find((x) => x.id === id);
    const ap = kk?.adaParsel || p?.adaParsel;
    const alt = `${ap ? `Ada ${ap.ada} · Parsel ${ap.parsel} · ` : ''}${sayi(p?.area_m2 || kk?.alan || 0)} m² · çiftliğinin parçası`;
    const e = p?.ekin;
    const durumMetni = !e ? 'Boş: ekim bekliyor' : e.olgun ? `${e.ikon} ${esc(e.ad)} hasada hazır!` : `${e.ikon} ${esc(e.ad)} · %${Math.round((e.ilerleme || 0) * 100)} büyüdü${susuzMu(p) ? ' · sulanmayı bekliyor' : ''}`;
    const dugmeler = [];
    if (e?.olgun) dugmeler.push(`<button type="button" class="ci-b altin" data-ci="arazi-is" data-is="hasat" data-parsel="${esc(id)}">🧺 Hasat et</button>`);
    if (p && susuzMu(p)) dugmeler.push(`<button type="button" class="ci-b" data-ci="arazi-is" data-is="sula" data-parsel="${esc(id)}">💧 Sula</button>`);
    if (p && bosMu(p)) dugmeler.push(`<button type="button" class="ci-b altin" data-ci="ek-hedef" data-parsel="${esc(id)}">🌱 Ek</button>`);
    sayfaAc(`${ust2('🌾', 'Tarlan', alt)}
      <p class="ci-not ${e?.olgun ? 'yesil' : ''}">${durumMetni}</p>
      ${dugmeler.length ? `<div class="ci-dugmeler">${dugmeler.join('')}</div>` : ''}`);
  }
  // Başkasının (ya da sahipsiz) parseli: sahibi, arsa bilgisi, yapılar ve oyun içi tahmini değer
  async function komsuBilgiSayfasi(id) {
    sayfaAc(`${ust2('🔎', 'Parsel', 'yükleniyor…')}`);
    const kk = await api(`/api/parsel/${encodeURIComponent(id)}`).catch(() => null);
    if (!kk) return sayfaKapat();
    const ap = kk.adaParsel ? `Ada ${kk.adaParsel.ada} · Parsel ${kk.adaParsel.parsel} · ` : '';
    const d = kk.deger || { toplam: 0, arsa: 0, yapilar: 0, susler: 0 };
    const yapilar = (kk.yapilar || []).map((y) => `<span class="cip">${y.ikon || '🏠'} ${esc(y.ad || y.tip)}${(y.seviye || 1) > 1 ? ` ${'★'.repeat(y.seviye)}` : ''}${y.durum === 'BUILDING' ? ' · inşaatta' : ''}</span>`).join('');
    const ilan = kk.pazar?.ilan;
    const pi = kk.piyasa;
    const sonSatis = pi?.fiyatGecmisi.filter((x) => x.tur === 'SATIS').at(-1);
    const sahipAd = kk.sahip ? `${esc(kk.sahip.ad)}${kk.sahip.ben ? ' (sen)' : ''}` : 'Sahipsiz arsa';
    sayfaAc(`${ust2(kk.sahip ? '👤' : '🌿', sahipAd, `${ap}${sayi(kk.alan)} m² · ${esc(kk.imar.ad)}`)}
      <div class="ci-deger"><small>Tahmini değer</small><b>${akce(d.toplam)}</b>
        <span>Arsa ${akce(d.arsa)}${d.yapilar ? ` · Yapılar ${akce(d.yapilar)}` : ''}${d.susler ? ` · Süsler ${akce(d.susler)}` : ''}</span>
        ${pi ? `<span class="ci-endeks">📈 ${esc(kk.mahalle)} endeksi <b>${sayi(pi.endeks)}</b> ${degisimCipi(pi.degisim7, ' 7g')}</span>` : ''}</div>
      ${pi?.seri.length > 1 ? endeksGrafigi(pi.seri, { yukseklik: 86, etiket: false }) : ''}
      ${sonSatis ? `<p class="ci-not">🤝 Son satış ${akce(sonSatis.fiyat)} · ${kisaTarih(sonSatis.tarih)}</p>` : ''}
      ${ilan ? `<p class="ci-not yesil">🏷️ Satılık · ${akce(ilan.fiyat)}</p>` : ''}
      ${yapilar ? `<div class="ci-yapi-ciplari">${yapilar}</div>` : `<p class="ci-not">${kk.sahip ? 'Üstünde yapı yok.' : `Boş arsa · edinme bedeli ${akce(kk.birincilBedel ?? d.arsa)}`}</p>`}
      ${kk.ekin ? `<p class="ci-not">${kk.ekin.ikon} ${esc(kk.ekin.ad)} ${kk.ekin.olgun ? 'hasada hazır' : 'büyüyor'}</p>` : ''}
      <p class="ci-dipnot">Tahmini değer = arsa (taban bedel × mahalle endeksi) + yapılar + süsler. Endeks talep, yatırım ve satışlarla değişir; oyun içi göstergedir.</p>
      ${kk.sahip && !kk.sahip.ben ? `<div class="ci-dugmeler"><button type="button" class="ci-b" data-ci="komsu-gez" data-parsel="${esc(kk.id)}">👋 Çiftliğini gez</button></div>` : ''}`);
  }
  async function komsuKartlariniYukle() {
    const k = durum.kart;
    if (k.tarla) return;
    const benimler = komsuHepsi(k).filter((n) => n.ben && !komsuKartlari.has(n.id));
    await Promise.all(benimler.map((n) => api(`/api/parsel/${encodeURIComponent(n.id)}`).then((kk) => komsuKartlari.set(n.id, kk)).catch(() => {})));
    if (benimler.length && acik) sahneKurgula();
  }

  // Telefonda çevre süsleri (ot, çiçek, taş, tepe korusu) daha seyrek: sahne daha çabuk kurulur, kare hızı yükselir
  const YOGUN = MOBIL ? 0.45 : 1;
  // ---------- Çevre: dalgalı çayır (uzakta tepelere yükselir), patikalar, ot/çiçek/taş, bulutlar
  // Çayır yüksekliği: merkezdeki 5 × 5 hücre düz; 110 m'den sonra yumuşak tepeler
  const tepe = (x, z) => {
    const d = Math.hypot(x, z), t = THREE.MathUtils.smoothstep(d, 105, 300);
    if (t <= 0) return 0;
    return t * (16 + 14 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 + 0.4) + 9 * Math.sin((x + z) * 0.043));
  };
  function cayir(r) {
    const geo = new THREE.PlaneGeometry(1100, 1100, 140, 140).rotateX(-Math.PI / 2);
    const p = geo.attributes.position, renk = new Float32Array(p.count * 3);
    const [a, b, c, u] = (kis ? ['#eef4f6', '#e2ebf0', '#f7fafb', '#dce6ee'] : ['#86c94a', '#76bb42', '#9ad25a', '#7fb36a']).map((x) => new THREE.Color(x));
    const f1 = r() * 6, f2 = r() * 6, renkK = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, tepe(x, z));
      // Lekeli çimen: iki ölçekte dalgalanan açık/koyu yamalar; uzakta hafif mavimsi (hava perspektifi)
      const n = Math.sin(x * 0.045 + f1) * Math.sin(z * 0.038 + f2) * 0.6 + Math.sin(x * 0.13 + z * 0.11 + f2) * 0.25;
      renkK.copy(a).lerp(n > 0 ? c : b, Math.min(1, Math.abs(n) * 1.3)).lerp(u, THREE.MathUtils.smoothstep(Math.hypot(x, z), 150, 420) * 0.6);
      renk.set([renkK.r, renkK.g, renkK.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(renk, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    return m;
  }
  // Hücreler arasındaki toprak patikalar: çiftliğin çevresinde halka ve dışarı uzanan yollar (ızgara parselde)
  function patikalar(r) {
    const renk = kis ? '#e8eef2' : '#e2c48e', yan = [];
    for (const k of [-1.5, 1.5]) {
      const a = levha(2.8, 5 * S, renk, { kalinlik: 0.02, kose: 1.2 }); a.position.set(k * S, 0, 0); grup.add(a);
      const b = levha(5 * S, 2.8, renk, { kalinlik: 0.02, kose: 1.2 }); b.position.set(0, 0.01, k * S); grup.add(b);
      for (let i = 0; i < 70 * YOGUN; i++) { const t = (r() - 0.5) * 5 * S, s = (r() < 0.5 ? -1 : 1) * (1.7 + r() * 0.5); yan.push([k * S + s, t], [t, k * S + s]); }
    }
    grup.add(otTutamlari(yan, r, { boy: 1.0 }));
  }
  // Boş çimen şeritlerine ot tutamları, kır çiçekleri, taşlar ve çalılar (hücre içleri ve patikalar boş kalır)
  function cevreSusle(r, dolu) {
    const ot = [], papatya = [], gelincik = [], mavi = [];
    const bosMu = (x, z) => {
      const gx = Math.round(x / S), gz = Math.round(z / S), fx = x - gx * S, fz = z - gz * S, uzak = Math.max(Math.abs(x), Math.abs(z));
      if (uzak > 86) return false;
      if (!dolu) return uzak > 48;                                     // gerçek tarla: tarlanın çevresi
      if (Math.abs(Math.abs(x) - 1.5 * S) < 2 || Math.abs(Math.abs(z) - 1.5 * S) < 2) return false;   // patika
      if (uzak > 76) return true;
      if (dolu.has(`${gx},${gz}`) && Math.abs(fx) < 15.4 && Math.abs(fz) < 15.4) return false;
      return Math.abs(fx) > 12.6 || Math.abs(fz) > 12.6;
    };
    for (let i = 0; i < 9000 && ot.length < 900 * YOGUN; i++) {
      const x = (r() - 0.5) * 172, z = (r() - 0.5) * 172;
      if (!bosMu(x, z)) continue;
      const q = r();
      if (q < 0.62) ot.push([x, z]);
      else if (q < 0.8) papatya.push([x / 2.4, z / 2.4]);
      else if (q < 0.9) gelincik.push([x, 0.55, z, 0, 0.32, 0.22]);
      else mavi.push([x, 0.5, z, 0, 0.26, 0.2]);
    }
    if (kis) return;
    grup.add(otTutamlari(ot, r, { boy: 1.05 }));
    const p = papatyalar(papatya); p.scale.setScalar(2.4); grup.add(p);
    const sap = [...gelincik, ...mavi].map(([x, , z]) => [x, 0, z, 0, 0.45, 0.5]);
    if (sap.length) grup.add(ornekli(new THREE.CylinderGeometry(0.04, 0.05, 1, 4).translate(0, 0.5, 0), '#5aa834', sap, { golge: false, ruzgar: 0.12 }));
    if (gelincik.length) grup.add(ornekli(kureGeo, '#e8433a', gelincik, { golge: false, ruzgar: 0.12 }));
    if (mavi.length) grup.add(ornekli(kureGeo, '#7a8ff0', mavi, { golge: false, ruzgar: 0.12 }));
    for (let i = 0, n = 0; i < 400 && n < 34 * YOGUN; i++) {
      const x = (r() - 0.5) * 172, z = (r() - 0.5) * 172;
      if (!bosMu(x, z)) continue;
      const o = n % 3 ? tas(r) : cali(r); o.scale.multiplyScalar(n % 3 ? 1.5 + r() : 1.8 + r() * 0.8); o.position.set(x, 0, z); o.rotation.y = r() * 6.28; grup.add(o); n++;
    }
  }
  // Küçük kır hayvanları (abartısız): iki tavşan, bir kirpi; yakında gölet varsa iki ördek. Çimen şeritlerinde dolaşır.
  function kirHayvanlari(r, dolu, k) {
    if (kis) return;
    const yer = (enAz) => {
      for (let i = 0; i < 300; i++) {
        const x = (r() - 0.5) * 112, z = (r() - 0.5) * 112, gx = Math.round(x / S), gz = Math.round(z / S), fx = x - gx * S, fz = z - gz * S;
        if (Math.hypot(x, z) < enAz || Math.max(Math.abs(x), Math.abs(z)) > 56) continue;
        if (dolu ? (dolu.has(`${gx},${gz}`) || (Math.abs(fx) < 13 && Math.abs(fz) < 13)) : Math.max(Math.abs(x), Math.abs(z)) < 46) continue;
        return new THREE.Vector3(x, 0, z);
      }
      return null;
    };
    const ekle = (o, p, tur, yaricap, s) => {
      o.scale.setScalar(s); o.position.copy(p); o.rotation.y = r() * 6.28; o.userData.tepki = { tur: 'hayvan' }; grup.add(o);
      canli.hayvanEkle(o, { merkez: p, yaricap, tur });
    };
    for (const renk of ['#f4efe6', '#c99a6b']) { const p = yer(22); if (p) ekle(tavsan(renk), p, 'tavsan', 5, 2.8); }
    const p = yer(22); if (p) ekle(kirpi(), p, 'kirpi', 2.5, 2.6);
    const su = komsuHepsi(k).find((n) => n.imar === 'SU' && Math.abs(n.dx) <= 2 && Math.abs(n.dy) <= 2);
    if (su && dolu) for (let i = 0; i < 2; i++) {
      const m = new THREE.Vector3(su.dx * S + (r() - 0.5) * 6, 0.15, su.dy * S + (r() - 0.5) * 6);
      ekle(ordek(), m, 'ordek', 7, 2.6);
    }
  }
  // Pofuduk bulutlar: uzakta, yavaşça dönen halka (sis etkilemez)
  function bulutlarKur(r) {
    bulutlar = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#dfe8f0', emissiveIntensity: gece ? 0.05 : 0.45, fog: false });
    const geo = new THREE.IcosahedronGeometry(1, 2);
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Group(), a = (i / 9) * Math.PI * 2 + r() * 0.4, d = 330 + r() * 90;
      for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(geo, m); s.position.set((k - 2.5) * 9 + (r() - 0.5) * 6, (r() - 0.3) * 5, (r() - 0.5) * 8); s.scale.set(11 + r() * 7, 7 + r() * 5, 9 + r() * 5); b.add(s); }
      b.position.set(Math.cos(a) * d, 85 + r() * 50, Math.sin(a) * d); b.lookAt(0, b.position.y, 0); bulutlar.add(b);
    }
    grup.add(bulutlar);
  }

  // ---------- Sahne: parsel ortada, çevresinde 5 × 5 komşu hücre ve ağaçlık kenar
  function sahneKurgula() {
    for (const c of [...grup.children]) { grup.remove(c); c.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (!o.geometry?.userData?.paylasimli) o.geometry?.dispose?.(); }); }
    ziplayanlar.length = 0;
    canli.temizle();
    const k = durum.kart, r = tohumlu(k.id);
    zamanAyarla();
    const zemin = cayir(r); zemin.position.y = -0.05; grup.add(zemin);
    grup.add(fenerler(r, k.tarla ? 44 : S / 2 + 1.6));
    if (!ziyaret) { const m = meydanKur(r); if (m) grup.add(m); }   // çiftliğin dört köşesinde (gerçek tarlada tarlanın çevresinde)
    let tarla = null, olcek = 1;
    if (k.tarla && k.geometri?.type === 'Polygon') {
      const halka = k.geometri.coordinates[0].slice(0, -1);
      const lon0 = halka.reduce((t, p) => t + p[0], 0) / halka.length, lat0 = halka.reduce((t, p) => t + p[1], 0) / halka.length;
      const mx = 111320 * Math.cos((lat0 * Math.PI) / 180);
      tarla = tarlaCercevesi(halka.map(([a, b]) => [(a - lon0) * mx, -(b - lat0) * 110540]), k.tarla.yon || 0);
      tarla.merkez = [0, 0];
      olcek = Math.min(1, 80 / ((tarla.alan[2] - tarla.alan[0] + 0.04) * S));
    } else {
      const komsuImar = Object.fromEntries(komsuHepsi(k).map((n) => [`${n.dx},${n.dy}`, n.imar]));
      const komsu = Object.fromEntries(komsuHepsi(k).map((n) => [`${n.dx},${n.dy}`, n]));
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue;
        const n = komsu[`${dx},${dy}`];
        // Çiftliğe katılmış komşu parsel: kendi modeliyle çizilir, dokununca o tarlaya geçilir
        if (n?.ben && komsuKartlari.has(n.id)) {
          const kk = komsuKartlari.get(n.id);
          // Gerçek tarla birden çok hücreyi kaplar: her hücresi çiftliğin devamı olarak (aynı ekinle, yapısız tarla) çizilir;
          // hücreler arası boşluksuz yastık tarlanın bütün olduğunu gösterir. Izgara parsel kendi modeliyle çizilir.
          const veri = n.tarla ? { id: `${n.id}:${dx},${dy}`, imar: 'TARIM', yp: '', ek: kartVerisi(kk).ek, kz: '', ss: '' } : kartVerisi(kk);
          const m = sevimliParselModeli(veri, { gece }); m.position.set(dx * S, 0.3, dy * S);
          if (n.tarla) m.scale.set(1 / 0.88, 1, 1 / 0.84);   // tarla hücreleri kenar boşluğu bırakmadan birbirine değsin
          m.traverse((o) => { if (o.userData.tepki || o.userData.tepkiHedef) { delete o.userData.tepki; delete o.userData.tepkiHedef; } });
          m.userData.tepki = { tur: 'komsu-ben', id: n.id };
          const ic2 = n.tarla ? levha(S + 0.2, S + 0.2, kis ? '#f6f9fa' : RENK.cimen, { kalinlik: 0.25, kose: 0.3 }) : levha(S - 0.7, S - 0.7, kis ? '#f6f9fa' : RENK.cimen, { kalinlik: 0.25, kose: 2.2 });
          ic2.position.set(dx * S, 0, dy * S); ic2.userData.tepki = { tur: 'komsu-ben', id: n.id };
          grup.add(ic2, m);
          continue;
        }
        const imar = komsuImar[`${dx},${dy}`] || (Math.abs(dx) === 2 || Math.abs(dy) === 2 ? (r() < 0.5 ? 'TARIM' : 'KORUMA') : 'DIS');
        const d = sevimliKomsu(imar, `${k.id}${dx}${dy}`, gece); d.position.set(dx * S, 0.2, dy * S); grup.add(d);
        // Komşu süs ekinleri benim ekinim değil: dokununca "+N" hasat tepkisi ve ekin sayfası açılmasın
        d.traverse((o) => { delete o.userData.tepki; delete o.userData.tepkiHedef; });
        // Genişletme: hemen yanındaki boş tarım hücresinde "+" işareti (kendi çiftliğimde); hücrenin tamamı da satın alma sayfasını açar
        if (!ziyaret && n && n.imar === 'TARIM' && !n.sahip && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
          const isaret = genisletIsareti(); isaret.position.set(dx * S, 0, dy * S); isaret.userData.tepki = { tur: 'genislet', id: n.id }; grup.add(isaret);
          d.userData.tepki = { tur: 'genislet', id: n.id };
        } else if (n) d.userData.tepki = { tur: 'komsu', id: n.id };   // başka birinin (ya da sahipsiz) parseli: kimin, ne değerde
      }
      const ic = levha(S - 0.7, S - 0.7, kis ? '#f6f9fa' : RENK.cimen, { kalinlik: 0.25, kose: 2.2 });
      ic.userData.tepki = { tur: 'zemin' }; grup.add(ic);
      patikalar(r);
    }
    const dolu = new Set(['0,0', ...komsuHepsi(k).filter((n) => n.ben && komsuKartlari.has(n.id)).map((n) => `${n.dx},${n.dy}`)]);
    cevreSusle(r, tarla ? null : dolu);
    kirHayvanlari(r, tarla ? null : dolu, k);
    // Uzak kenar: ağaç kuşağı
    for (let i = 0; i < (MOBIL ? 28 : 40); i++) {
      const a = (i / 40) * Math.PI * 2 + r() * 0.1, d = 88 + r() * 25;
      const t = r() < 0.4 ? cam(r, 4) : r() < 0.85 ? yuvarlakAgac(r, 3.4) : cali(r);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (meydanKonum && Math.abs(x - meydanKonum.x) < meydanKonum.yari + 8 && Math.abs(z - meydanKonum.z) < 18) continue;   // meydanın önü açık kalsın
      t.position.set(x, tepe(x, z), z); grup.add(t);
    }
    // Tepelerdeki seyrek korular (sisle ufka karışır)
    for (let i = 0; i < 70 * YOGUN; i++) {
      const a = r() * Math.PI * 2, d = 125 + r() * 150, x = Math.cos(a) * d, z = Math.sin(a) * d;
      const t = r() < 0.5 ? cam(r, 4.5 + r() * 2) : yuvarlakAgac(r, 3.8 + r() * 1.6);
      t.position.set(x, tepe(x, z) - 0.3, z); grup.add(t);
    }
    bulutlarKur(r);
    parselG = new THREE.Group(); parselG.position.y = 0.3; parselG.scale.setScalar(olcek); grup.add(parselG);
    model = sevimliParselModeli(kartVerisi(k), { tarla, sahipli: true, gece });
    parselG.add(model);
    if (tarla) zemin.userData.tepki = { tur: 'zemin' };   // gerçek tarlada çevredeki çayır da inşaat alanı
    canli.yuruyenEkle(model.userData.ciftci, model.userData.yuruyus || [], 2.4);
    // İşçi tutulduysa ikinci bir çalışan tarlada dolaşır
    if (isci?.aktif && !ziyaret && model.userData.yuruyus?.length > 1) {
      const c = ciftci({ tulum: '#e8873a', gomlek: '#fff4d6', sapka: true });
      c.scale.setScalar(2.4); c.position.copy(model.userData.yuruyus.at(-1)); c.userData.tepki = { tur: 'ciftci' }; model.add(c);
      canli.yuruyenEkle(c, [...model.userData.yuruyus].reverse(), 2.4);
    }
    for (const h of model.userData.hayvanlar || []) canli.hayvanEkle(h.o, h);
    karKur();
    kadraj = tarla ? Math.max(30, (tarla.alan[2] - tarla.alan[0]) * S * olcek * 0.6) : 30;
    hedefUzaklik = kadraj * 2.3;
  }

  // ---------- Üst bilgi, envanter ve eylem çubuğu
  const ekinDurumu = () => {
    const e = durum.kart?.ekin;
    if (!e) return null;
    const olgun = sunucuSimdi() >= e.hazir;
    return { ...e, olgun, susuz: !e.otomatikSulama && e.sulama < e.gerekenSulama, ilerleme: Math.min(1, (sunucuSimdi() - e.ekim) / (e.hazir - e.ekim)) };
  };
  let hudZaman = 0;
  function hudCiz() {
    const k = durum.kart, b = durum.ben;
    const arsaSayisi = (b?.portfoy || []).length;
    baslik.innerHTML = `<b>${ziyaret ? `${esc(k.sahip?.ad ? tamlayan(k.sahip.ad) : 'Komşunun')} çiftliği` : esc(k.mahalle)}${!ziyaret && arsaSayisi > 1 ? ` <span class="ci-arsa-sayi">▾ ${arsaSayisi} arazi</span>` : ''}</b><small>${esc(k.ilce)} · ${sayi(k.alan)} m² · ${esc(k.imar.ad)}</small>`;
    if (ziyaret) {
      sayaclar.innerHTML = `<span class="ci-sayac altin">${akce(b?.bakiye ?? 0)}</span>`;
      envanter.hidden = true;
      alt.innerHTML = `<button type="button" class="ci-d yesil" data-eylem="ziyaret" data-hedef="zemin">👋<span>Selam ver</span></button>
        ${k.ekin && k.komsuluk?.yardim ? '<button type="button" class="ci-d mavi" data-eylem="yardim" data-hedef="ekin">💧<span>Yardım et</span></button>' : ''}
        <button type="button" class="ci-d" data-ci="kapat">🏘️<span>Köy</span></button>`;
      return;
    }
    sayaclar.innerHTML = `<span class="ci-sayac">⭐ ${b?.seviye?.seviye ?? 1}</span><span class="ci-sayac altin">${akce(b?.bakiye ?? 0)}</span>`;
    const stok = (b?.envanter || []).filter((i) => i.miktar > 0).sort((x, y) => y.miktar - x.miktar).slice(0, 4);
    envanter.innerHTML = stok.map((i) => `<span title="${esc(i.ad)}">${i.ikon} <b>${sayi(i.miktar)}</b></span>`).join('');
    envanter.hidden = !stok.length;
    const e = ekinDurumu(), dugmeler = [], set = ciftlikSeti();
    const hs = set.filter(olgunMu), ss = set.filter(susuzMu), bs = set.filter(bosMu);
    // Sıradaki ekin olgunlaşınca çubuk kendiliğinden yeniden çizilir
    clearTimeout(hudZaman);
    const sonraki = Math.min(...set.filter((p) => p.ekin && !olgunMu(p) && p.ekin.hazir).map((p) => p.ekin.hazir), e && !e.olgun ? e.hazir : Infinity);
    if (Number.isFinite(sonraki)) hudZaman = setTimeout(() => { if (acik && durum.kart) hudCiz(); }, Math.min(2 ** 31 - 1, Math.max(500, sonraki - sunucuSimdi() + 400)));
    const say = (n) => (n > 1 ? ` (${n})` : '');
    // Yalnızca açık parsel işliyse çiftçi yürüyüp tek eylemi yapar; birden çok arazide toplu iş
    if (hs.length === 1 && hs[0].id === k.id && e?.olgun) dugmeler.push(`<button type="button" class="ci-d altin" data-eylem="hasat" data-hedef="ekin">🧺<span>Hasat</span></button>`);
    else if (hs.length) dugmeler.push(`<button type="button" class="ci-d altin" data-ci="ciftlik-hasat">🧺<span>Hasat${say(hs.length)}</span></button>`);
    if (ss.length === 1 && ss[0].id === k.id && e?.susuz) dugmeler.push(`<button type="button" class="ci-d mavi" data-eylem="sula" data-hedef="ekin">💧<span>Sula</span></button>`);
    else if (ss.length) dugmeler.push(`<button type="button" class="ci-d mavi" data-ci="ciftlik-sula">💧<span>Sula${say(ss.length)}</span></button>`);
    if (bs.length || (!e && k.imar.tip === 'TARIM' && !set.length)) dugmeler.push(`<button type="button" class="ci-d yesil" data-ci="ek">🌱<span>Ek${say(bs.length)}</span></button>`);
    for (const y of k.yapilar || []) {
      if (y.hayvan?.durum === 'HAZIR') dugmeler.push(`<button type="button" class="ci-d altin" data-eylem="hayvan-topla" data-id="${y.id}" data-hedef="yapi:${y.id}">${y.hayvan.urunIkon}<span>Topla</span></button>`);
      else if (y.hayvan?.durum === 'AC') dugmeler.push(`<button type="button" class="ci-d" data-eylem="hayvan-besle" data-id="${y.id}" data-hedef="yapi:${y.id}">🌽<span>Yemle</span></button>`);
    }
    // Toplu işler: başka parsellerde de hasat ya da sulama bekleyen varsa tek dokunuşla hepsi
    const portfoy = b?.portfoy || [];
    const hasatlik = portfoy.filter(olgunMu), susuzlar = portfoy.filter(susuzMu);
    // Çiftliğin dışındaki (uzaktaki) arazilerde de iş varsa: bütün arazilerde tek dokunuşla
    if (hasatlik.length > hs.length) dugmeler.push(`<button type="button" class="ci-d altin" data-ci="hepsi-hasat">🧺<span>Tümü (${hasatlik.length})</span></button>`);
    if (susuzlar.length > ss.length) dugmeler.push(`<button type="button" class="ci-d mavi" data-ci="hepsi-sula">💧<span>Tümü (${susuzlar.length})</span></button>`);
    const kiralik = (k.yapilar || []).filter((y) => y.kira?.birikmis >= 1);
    if (kiralik.length) dugmeler.push(`<button type="button" class="ci-d altin" data-eylem="kira-topla" data-id="${kiralik.map((y) => y.id).join(',')}">💰<span>Kira ${akce(kiralik.reduce((t, y) => t + y.kira.birikmis, 0))}</span></button>`);
    if (k.insaatSecenekleri?.length) dugmeler.push(`<button type="button" class="ci-d" data-ci="insaat">🔨<span>İnşa et</span></button>`);
    if (k.susSecenekleri) dugmeler.push(`<button type="button" class="ci-d" data-ci="sus">🌷<span>Süsle</span></button>`);
    const sd = b?.sandik;
    if (sd) dugmeler.push(`<button type="button" class="ci-d${sd.hazir ? ' altin' : ''}" data-ci="sandik">🎁<span>${sd.hazir ? 'Sandık' : kisaSure(sd.kalanMs)}</span></button>`);
    dugmeler.push(`<button type="button" class="ci-d" data-ci="gunluk">🎯<span>Günlük</span></button>`);
    dugmeler.push(`<button type="button" class="ci-d" data-ci="meydan">🏛️<span>Meydan</span></button>`);
    dugmeler.push(`<button type="button" class="ci-d" data-ci="bulmaca">🧩<span>Bulmaca</span></button>`);
    dugmeler.push(`<button type="button" class="ci-d${isci?.aktif ? ' yesil' : ''}" data-ci="isci">👷<span>İşçi</span></button>`);
    dugmeler.push(`<button type="button" class="ci-d" data-ci="ayrinti">📋<span>Kart</span></button>`);
    alt.innerHTML = dugmeler.join('');
  }

  // ---------- Dokunma sayfaları
  function sayfaAc(html, hedef = null) { sayfaHedef = hedef; sayfa.innerHTML = `<div class="ci-sayfa-tutamac"></div>${html}`; sayfa.hidden = false; ipucu.hidden = true; }
  function sayfaKapat() {
    sayfa.hidden = true; sayfaHedef = null;
    // Meydan görünümünden çiftliğe dön
    if (meydanOncekiUzaklik != null) { hedefOdak.set(0, 0, 0); hedefUzaklik = meydanOncekiUzaklik; meydanOncekiUzaklik = null; etkilesim(); }
  }
  const ust2 = (ikon, ad, alt2) => `<div class="ci-sayfa-ust"><span class="ci-sayfa-ikon">${ikon}</span><div><b>${ad}</b><small>${alt2}</small></div><button type="button" class="ci-sayfa-kapat" data-ci="sayfa-kapat" aria-label="Kapat">✕</button></div>`;
  function ekinSayfasi() {
    const e = ekinDurumu();
    if (!e) return ekSayfasi();
    const kalan = Math.max(0, e.hazir - sunucuSimdi());
    sayfaAc(`${ust2(e.ikon, esc(e.ad), e.olgun ? 'Hasada hazır!' : `Olgunlaşmaya ${sure(kalan)}`)}
      <div class="ci-cubuk"><b style="width:${Math.round(e.ilerleme * 100)}%"></b></div>
      <div class="ci-bilgi"><span>💧 ${e.sulama}/${e.gerekenSulama}${e.otomatikSulama ? ' · otomatik' : ''}</span><span>🌱 %${Math.round(e.ilerleme * 100)}</span></div>
      <div class="ci-dugmeler">
        ${e.susuz && !e.olgun && !e.sonrakiSulamaMs ? `<button type="button" class="ci-b mavi" data-eylem="sula" data-hedef="ekin">💧 Sula (${akce(e.sulamaMaliyeti)})</button>` : ''}
        <button type="button" class="ci-b ${e.olgun ? 'altin' : ''}" data-eylem="hasat" data-hedef="ekin" ${e.olgun ? '' : 'disabled'}>${e.tazelik === 'CURUDU' ? '🧹 Temizle' : '🧺 Hasat et'}</button>
      </div>`, 'ekin');
  }
  // Ek: çiftlikteki bütün boş arazilere aynı ürün (ya da yalnızca dokunulan araziye). Tek arazi açık parselse çiftçi
  // yürüyüp eker (olağan eylem); birden çok arazide toplu ekim yapılır.
  function ekSayfasi(hedefler = null) {
    const k = durum.kart, urunler = durum.kurallar.urunler;
    const set = ciftlikSeti(), bos = hedefler ? set.filter((p) => hedefler.includes(p.id)) : set.filter(bosMu);
    const tekAna = !bos.length || (bos.length === 1 && bos[0].id === k.id);
    const alanlar = tekAna ? [k.alan] : bos.map((p) => p.area_m2);
    const katToplam = alanlar.reduce((t, a) => t + tohumKati(a), 0);
    const secenek = new Map((k.urunSecenekleri || []).map((x) => [x.kod, x]));
    const liste = Object.entries(urunler).filter(([, u]) => !u.mamul && u.tohum).sort(([a], [b]) => (secenek.get(b)?.uygun ? 1 : 0) - (secenek.get(a)?.uygun ? 1 : 0));
    const alt = tekAna ? `${sayi(k.alan)} m² · ×${tohumKati(k.alan)} tohum ve verim` : `${bos.length} arazi · ${sayi(alanlar.reduce((t, a) => t + a, 0))} m² · hepsine birden`;
    sayfaAc(`${ust2('🌱', 'Ne ekelim?', alt)}
      <div class="ci-tohumlar">${liste.map(([kod, u]) => {
        const sec = secenek.get(kod) || { uygun: true, buyume: 1 }, fiyat = u.tohum * katToplam, kapali = !sec.uygun || (durum.ben?.bakiye ?? 0) < fiyat;
        const dugme = tekAna ? `data-eylem="ek" data-urun="${kod}" data-hedef="toprak"` : `data-ci="ciftlik-ek" data-urun="${kod}" data-parseller="${esc(bos.map((p) => p.id).join(','))}"`;
        return `<button type="button" class="ci-tohum" ${dugme} ${kapali ? 'disabled' : ''}>
          <span>${u.ikon}</span><b>${esc(u.ad)}</b><small>${akce(fiyat)} · ${sure(Math.round(u.sureMs * (sec.buyume || 1)))}</small>${!sec.uygun ? `<em>${esc(u.bolgeAd || 'bölge dışı')}</em>` : ''}</button>`;
      }).join('')}</div>`, 'toprak');
  }
  async function topluEk(urun, kimlikler, dugme) {
    dugme?.closest('.ci-tohumlar')?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    let tamam = 0, hata = '';
    for (const id of kimlikler) {
      try { await api(`/api/parsel/${encodeURIComponent(id)}/ek`, { urun }); tamam++; komsuKartlari.delete(id); } catch (e) { hata = e.message; }
    }
    sayfaKapat();
    ses('ek');
    await yenileDis?.();
    komsuKartlariniYukle();
    tostDis?.(tamam ? `🌱 ${tamam} araziye ${esc(durum.kurallar.urunler[urun]?.ad || urun)} ekildi` : hata || 'Ekilemedi', tamam ? '' : 'hata');
  }

  // İnşaat atölyesi: yapılar türlerine göre bölümlerde; "Ev ve keyif" en üstte (ekip biçmek istemeyen oyuncu için)
  const KATEGORI_SIRA = ['Ev ve keyif', 'Yapı', 'Su ve tarım', 'Hayvancılık', 'Üretim', 'Enerji', 'Sınır ve güvenlik', 'Estetik'];
  const KATEGORI_AD = { 'Yapı': 'Çiftlik ve iş yapıları' };
  function insaatSayfasi() {
    const k = durum.kart, ku = k.imarKullanimi;
    const gruplar = new Map();
    for (const s of k.insaatSecenekleri || []) { const g = s.kategori || 'Yapı'; if (!gruplar.has(g)) gruplar.set(g, []); gruplar.get(g).push(s); }
    const sira = [...gruplar.keys()].sort((a, b) => (KATEGORI_SIRA.indexOf(a) + 99) % 99 - (KATEGORI_SIRA.indexOf(b) + 99) % 99);
    const satir = (s) => {
      const kapali = !s.uygun || (durum.ben?.bakiye ?? 0) < s.maliyet;
      const gelir = s.gelir ? ` · günde ${akce(s.gelir)} kira` : '';
      return `<div class="ci-satir ${kapali ? 'kapali' : ''}"><span class="ci-satir-ikon">${s.ikon}</span><div><b>${esc(s.ad)}</b><small>${esc(s.etki)}${gelir} · ${sure(s.sureMs)}</small>
        ${!s.uygun ? `<em>${esc(s.sebep)}</em>` : ''}</div>
        <button type="button" class="ci-b kucuk" data-eylem="insaat" data-tip="${s.tip}" data-hedef="zemin" ${kapali ? 'disabled' : ''}>${akce(s.maliyet)}</button></div>`;
    };
    sayfaAc(`${ust2('🔨', 'İnşaat atölyesi', `Taban ${sayi(ku.kullanilanTaban)}/${sayi(ku.maxTaban)} m² · İnşaat ${sayi(ku.kullanilanInsaat)}/${sayi(ku.maxInsaat)} m²`)}
      ${k.imar.tip === 'TARIM' ? '<p class="ci-not">Tarım arazisine konut olarak yalnızca <b>bağ evi</b> yapılabilir. Villa, dağ evi, havuz ve oyun parkı için konut ya da turizm arazisi edin.</p>' : ''}
      ${sira.map((g) => `<h4 class="ci-grup">${esc(KATEGORI_AD[g] || g)}</h4><div class="ci-liste">${gruplar.get(g).map(satir).join('')}</div>`).join('')}`, 'zemin');
  }
  function susSayfasi() {
    const k = durum.kart;
    sayfaAc(`${ust2('🌷', 'Çiftliğini süsle', `${k.susler.length}/8 süs`)}
      <div class="ci-tohumlar">${(k.susSecenekleri || []).map((s) => `<button type="button" class="ci-tohum" data-eylem="sus-ekle" data-tur="${s.kod}" data-hedef="zemin" ${s.acik && k.susler.length < 8 ? '' : 'disabled'}>
        <span>${s.acik ? s.ikon : '🔒'}</span><b>${esc(s.ad)}</b><small>${s.acik ? akce(s.fiyat) : `Seviye ${s.minSeviye}`}</small></button>`).join('')}</div>`, 'zemin');
  }
  function yapiSayfasi(sira) {
    const y = durum.kart.yapilar?.[sira];
    if (!y) return insaatSayfasi();
    const h = y.hayvan, kalan = Math.max(0, y.bitis - sunucuSimdi());
    const hayvan = !h ? '' : h.durum === 'HAZIR' ? `<p class="ci-not yesil">${h.urunIkon} ${h.miktar} ${esc(h.urunAd)} hazır!</p>`
      : h.durum === 'BESLENDI' ? `<p class="ci-not">⏳ ${esc(h.urunAd)} hazırlanıyor · ${sure(Math.max(0, h.hazir - sunucuSimdi()))}</p>` : `<p class="ci-not">${h.ikon} ${h.sayi} ${esc(String(h.hayvan).toLocaleLowerCase('tr-TR'))} aç · ${h.yem} yem ister</p>`;
    sayfaAc(`${ust2(y.ikon || '🏠', esc(y.ad || y.tip), y.durum === 'BUILDING' ? `İnşaat sürüyor · ${sure(kalan)}` : `Sağlık %${y.saglik}${y.etkisiz ? ' · bakım gerekli' : ''}`)}
      ${y.durum === 'BUILDING' ? '<p class="ci-not">🏗️ Usta çalışıyor; bitince burada belirir.</p>' : `<div class="ci-cubuk saglik"><b style="width:${y.saglik}%"></b></div>`}
      ${hayvan}
      ${y.kira ? `<p class="ci-not ${y.kira.birikmis >= 1 ? 'yesil' : ''}">🏡 Turistlere kiralanıyor · günde <b>${akce(y.kira.gunluk)}</b>${y.kira.havuz ? ' (havuzla +%50)' : ''}<br>Birikmiş kira: <b>${akce(y.kira.birikmis)}</b>${y.kira.dolu ? ' · <b>doldu</b>, topla ki birikmeye devam etsin' : ''}</p>` : ''}
      <div class="ci-dugmeler">
        ${y.kira && !ziyaret && y.kira.birikmis >= 1 ? `<button type="button" class="ci-b altin" data-eylem="kira-topla" data-id="${y.id}" data-hedef="yapi:${y.id}">💰 Kirayı topla</button>` : ''}
        ${h?.durum === 'HAZIR' ? `<button type="button" class="ci-b altin" data-eylem="hayvan-topla" data-id="${y.id}" data-hedef="yapi:${y.id}">${h.urunIkon} Topla</button>` : ''}
        ${h?.durum === 'AC' ? `<button type="button" class="ci-b" data-eylem="hayvan-besle" data-id="${y.id}" data-hedef="yapi:${y.id}">🌽 Yemle</button>` : ''}
        ${y.etkisiz || (y.saglik ?? 100) < 90 ? `<button type="button" class="ci-b" data-eylem="bakim" data-hedef="yapi:${y.id}">🔧 Bakım</button>` : ''}
      </div>
      ${uretimHTML(y)}
      ${y.durum === 'ACTIVE' && !ziyaret ? `<div class="ci-yukselt"><span>Seviye <b>${'★'.repeat(y.seviye || 1)}${'☆'.repeat(Math.max(0, 3 - (y.seviye || 1)))}</b>${h ? ` · her seviye +%50 ürün` : y.kira ? ' · her seviye +%50 kira' : ''}</span>
        ${y.yukseltBedeli ? `<button type="button" class="ci-b altin kucuk" data-eylem="yapi-yukselt" data-id="${y.id}" data-hedef="yapi:${y.id}" ${(durum.ben?.bakiye ?? 0) < y.yukseltBedeli ? 'disabled' : ''}>⬆️ Yükselt ${akce(y.yukseltBedeli)}</button>` : '<em>En üst seviye</em>'}</div>` : ''}`, `yapi:${y.id}`);
  }
  // Tesisin (değirmen, fırın, fabrika…) üretimi: süren partiler (topla) ve yapılabilecek reçeteler (üret)
  function uretimHTML(y) {
    const u = durum.kart.uretim;
    if (!u || ziyaret) return '';
    const suren = u.surenler.filter((x) => x.tesis === y.tip), recete = u.receteler.filter((r) => r.tesis === y.tip);
    if (!suren.length && !recete.length) return '';
    return `<h4 class="ci-alt-baslik">⚙️ Üretim</h4><div class="ci-liste">
      ${suren.map((x) => { const bitti = sunucuSimdi() >= x.bitis; return `<div class="ci-satir"><span class="ci-satir-ikon">${x.ikon}</span><div><b>${sayi(x.cikti)} ${esc(x.ad)}</b><small>${bitti ? 'Hazır!' : `bitişe ${sure(x.bitis - sunucuSimdi())}`}</small></div>
        <button type="button" class="ci-b kucuk ${bitti ? 'altin' : ''}" data-eylem="uretim-topla" data-id="${x.id}" data-hedef="yapi:${y.id}" ${bitti ? '' : 'disabled'}>Topla</button></div>`; }).join('')}
      ${suren.length ? '' : recete.map((r) => { const yeter = Math.min(...r.girdi.map((g) => Math.floor(g.stok / g.adet))); return `<div class="ci-satir ${yeter < 1 ? 'kapali' : ''}"><span class="ci-satir-ikon">${r.ikon}</span><div><b>${esc(r.ad)}</b>
        <small>${r.girdi.map((g) => `${g.adet} ${g.ikon} (${sayi(g.stok)})`).join(' + ')} → ${r.cikti} · ${sure(r.sureMs)}</small></div>
        <button type="button" class="ci-b kucuk" data-eylem="uretim-basla" data-recete="${r.kod}" data-parti="1" data-hedef="yapi:${y.id}" ${yeter < 1 ? 'disabled' : ''}>Üret</button></div>`; }).join('')}</div>`;
  }
  // Günlük görevler: bugünün 3 görevi ve ödül
  // Günlük sandık: 8 saatte bir ücretsiz; hazırsa açılır, değilse kalan süre ve içerik oranları gösterilir (sandik.js)
  async function sandikSayfasi() {
    const d = await api('/api/sandik').catch(() => null);
    if (!d) return;
    const oranlar = `<div class="ci-sandik-oran">${d.oranlar.map((o) => `<span>${esc(o.ikon)} ${esc(o.metin)} <b>%${Math.round(o.oran * 100)}</b></span>`).join('')}</div>`;
    sayfaAc(`${ust2('🎁', 'Günlük sandık', d.hazir ? 'Hazır! Aç bakalım' : `Yeni sandık ${sure(d.kalanMs)} sonra`)}
      <div class="ci-sandik ${d.hazir ? 'hazir' : ''}"><span class="ci-sandik-ikon">🎁</span>
        ${d.hazir ? '<button type="button" class="ci-b altin" data-ci="sandik-ac">Sandığı aç</button>' : `<p class="ci-not">Her 8 saatte bir yeni sandık dolar.</p>`}</div>
      <p class="ci-alt-baslik">Sandıktan ne çıkabilir?</p>${oranlar}`);
  }
  async function gunlukSayfasi() {
    sayfaAc(`${ust2('🎯', 'Günlük görevler', 'yükleniyor…')}`);
    const d = await api('/api/gunluk-gorevler').catch(() => null);
    if (!d) return sayfaKapat();
    sayfaAc(`${ust2('🎯', 'Günlük görevler', `Her gün yenilenir · ödül ${akce(d.odul)} + ${d.tp} TP`)}
      <div class="ci-liste">${d.gorevler.map((g) => `<div class="ci-satir ${g.tamam ? 'bitti' : ''}"><span class="ci-satir-ikon">${g.tamam ? '✅' : g.ikon}</span><div><b>${esc(g.ad)}</b>
        <div class="ci-cubuk ince"><b style="width:${Math.round((g.yapilan / g.hedef) * 100)}%"></b></div></div><span class="ci-sayi">${g.yapilan}/${g.hedef}</span></div>`).join('')}</div>
      <div class="ci-dugmeler" style="margin-top:10px"><button type="button" class="ci-b altin" data-eylem="gorev-odul" ${d.hepsi && !d.alindi ? '' : 'disabled'}>${d.alindi ? '✓ Bugünkü ödül alındı' : d.hepsi ? `🎁 Ödülü al (${akce(d.odul)})` : '🎁 Hepsini bitir, ödülü al'}</button></div>`);
  }
  // Köy meydanı: topluluk binaları (kalıcı bonus); kurulanlar çiftliğin güneyindeki meydanda 3B görünür
  let meydanVeri = null;
  async function meydanSayfasi() {
    if (!meydanVeri) sayfaAc(`${ust2('🏛️', 'Köy meydanı', 'yükleniyor…')}`);
    // Kamera meydana kayar (sayfa ekranın altını kapladığı için meydan üst yarıda görünsün diye odak biraz öne alınır)
    if (meydanKonum && meydanOncekiUzaklik == null) {
      meydanOncekiUzaklik = hedefUzaklik;
      const uz = Math.max(85, meydanKonum.yari * 3.2);
      hedefOdak.set(meydanKonum.x + Math.sin(aci) * uz * 0.42, 0, meydanKonum.z + Math.cos(aci) * uz * 0.42);
      hedefUzaklik = uz; etkilesim();
    }
    const d = await api('/api/meydan').catch(() => null);
    if (!d) return sayfaKapat();
    const once = meydanVeri?.kurulu; meydanVeri = d;
    if (once != null && once !== d.kurulu) sahneKurgula();
    const kart = (b) => {
      const durumYazi = { HAZIR: '<span class="ci-meydan-durum hazir">✓ Kurulu</span>', INSAATTA: `<span class="ci-meydan-durum">🏗️ ${sure(b.kalanMs)}</span>`,
        KILITLI: `<span class="ci-meydan-durum kilit">🔒 Seviye ${b.seviye}</span>`, YOK: '' }[b.durum];
      return `<div class="ci-meydan-kart ${b.durum.toLowerCase()}">
        <span class="ci-meydan-ikon">${b.ikon}</span>
        <div class="ci-meydan-govde"><b>${esc(b.ad)}</b><small>${esc(b.etki)}</small>
          ${b.durum === 'YOK' ? `<div class="ci-meydan-malzeme"><span class="${(durum.ben?.bakiye ?? 0) >= b.akce ? '' : 'eksik'}">${akce(b.akce)}</span>${b.malzeme.map((m) => `<span class="${m.eldeki >= m.adet ? '' : 'eksik'}">${m.ikon} ${m.eldeki}/${m.adet}</span>`).join('')}</div>` : ''}</div>
        ${b.durum === 'YOK' ? `<button type="button" class="ci-b altin ci-meydan-b" data-ci="meydan-insa" data-kod="${b.kod}" ${b.eksik.length ? 'disabled' : ''}>Kur</button>` : durumYazi}
      </div>`;
    };
    sayfaAc(`${ust2('🏛️', 'Köy meydanı', `${d.kurulu}/${d.toplam} bina · köy nüfusu ${sayi(d.nufus)}`)}
      <p class="ci-not">Topluluk binaları köyünü büyütür ve kalıcı bonus verir. Malzemeleri tarlandan ve üretimden topla.</p>
      <div class="ci-meydan-liste">${d.binalar.map(kart).join('')}</div>`);
  }
  // Meydandaki binaların 3B modelleri (çiftliğin güneyinde, çayırda bir sıra)
  const MEYDAN_MODEL = {
    CESME: () => { const m = cesme(); m.scale.setScalar(1.6); return m; },
    KAHVEHANE: () => dukkan({ tente: '#b8432f', gece }),
    PAZAR_YERI: () => dukkan({ tente: '#2e86de', restoran: true, gece }),
    OKUL: () => { const g = new THREE.Group(); const a = apartman({ catiRenk: '#d9574a', gece }); a.scale.set(1.3, 0.75, 1); const b = bayrakDiregi(); b.position.set(4.2, 0, 2.6); g.add(a, b); return g; },
    SAGLIK_OCAGI: () => ev({ catiRenk: '#c9d1d9', duvar: '#ffffff', gece }),
    KUTUPHANE: () => pansiyon({ catiRenk: '#8e5a3a', gece }),
    PTT: () => dukkan({ tente: '#f2c230', gece }),
  };
  function meydanKur(r) {
    const kurulu = (meydanVeri?.binalar || []).filter((b) => b.durum !== 'KILITLI' && b.durum !== 'YOK');
    if (!kurulu.length) { meydanKonum = null; return null; }
    const g = new THREE.Group();
    const zemin = levha(kurulu.length * 13 + 8, 16, '#e8d9b5', { kalinlik: 0.2, kose: 3 }); g.add(zemin);
    kurulu.forEach((b, i) => {
      const m = MEYDAN_MODEL[b.kod]?.();
      if (!m) return;
      m.position.set((i - (kurulu.length - 1) / 2) * 13, 0.2, 0);
      if (b.durum === 'INSAATTA') m.scale.multiplyScalar(0.6);   // inşaattaki bina küçük ve iskeleli görünür
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(m);
    });
    g.position.set(0, 0, 2.5 * S + 14 + (r() - 0.5) * 2);
    meydanKonum = g.position.clone(); meydanKonum.yari = (kurulu.length * 13 + 8) / 2;
    return g;
  }

  // İşçi: tutulduysa bitişi; tutma seçenekleri
  async function isciSayfasi() {
    isci = await api('/api/isci').catch(() => isci);
    const bit = isci?.aktif ? new Date(isci.bitis).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null;
    sayfaAc(`${ust2('👷', 'Tarla işçisi', bit ? `Çalışıyor · ${bit} tarihine kadar` : 'Sen yokken çiftliğin işlesin')}
      <p class="ci-not">İşçi bütün tarlalarında olgun ekinleri hasat eder, susamış ekinleri sular (sulama bedeli senden), hayvanları yemler ve ürünlerini toplar.</p>
      <div class="ci-dugmeler">${[1, 3, 7].map((g) => `<button type="button" class="ci-b ${g === 3 ? 'altin' : ''}" data-eylem="isci-tut" data-gun="${g}" ${(durum.ben?.bakiye ?? 0) < (isci?.gunluk || 60) * g ? 'disabled' : ''}>${g} gün · ${akce((isci?.gunluk || 60) * g)}</button>`).join('')}</div>`);
  }
  // Genişletme: yandaki boş tarlayı çiftliğe katma
  async function genisletSayfasi(nid) {
    sayfaAc(`${ust2('🏡', 'Çiftliğini büyüt', 'yükleniyor…')}`);
    const kk = await api(`/api/parsel/${encodeURIComponent(nid)}`).catch(() => null);
    if (!kk) return sayfaKapat();
    const bedel = kk.birincilBedel, bakiye = durum.ben?.bakiye ?? 0;
    if (kk.sahip) return sayfaAc(`${ust2('🏡', 'Bu tarla artık dolu', `${esc(kk.mahalle)} · ${sayi(kk.alan)} m²`)}<p class="ci-not">Bu tarlayı az önce başka biri aldı. Çevrendeki diğer boş tarlalara bakabilirsin.</p>`);
    const eksik = bedel != null && bakiye < bedel;
    sayfaAc(`${ust2('🏡', 'Çiftliğini büyüt', `${esc(kk.mahalle)} · ${sayi(kk.alan)} m² · ${esc(kk.imar.ad)}`)}
      <p class="ci-not">Yandaki bu boş tarlayı çiftliğine kat: ekip biçebilir, yapı kurabilirsin. Çiftliğinde yan yana görünür.</p>
      ${eksik ? `<p class="ci-not ci-uyari">💰 Bu tarla için <b>${akce(bedel)}</b> gerekiyor, sende <b>${akce(bakiye)}</b> var. Ürünlerini hasat edip pazarda sat ya da günlük görevleri tamamla; para biriktiğinde buradan alabilirsin.</p>` : ''}
      <div class="ci-dugmeler"><button type="button" class="ci-b altin" data-eylem="genislet" data-parsel="${esc(kk.id)}" data-hedef="zemin" ${bedel == null || eksik ? 'disabled' : ''}>🏡 Çiftliğe kat${bedel != null ? ` (${akce(bedel)})` : ''}</button></div>`);
  }

  // ---------- Etkileşim: sürükle döndür, tekerlek/çimdik yakınlaş, dokun → sayfa
  const isin = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let surukle = null;
  const dokunuslar = new Map();
  function hedefNoktasi(hedef) {
    // Eylemin yapılacağı yer (çiftçi oraya yürür ve efekt orada çıkar)
    let bulunan = null;
    model?.traverse((o) => {
      if (bulunan || !o.userData.tepki) return;
      const t = o.userData.tepki;
      if (hedef === 'ekin' && t.tur === 'ekin') bulunan = o;
      else if (hedef === 'toprak' && (t.tur === 'toprak' || t.tur === 'ekin')) bulunan = o;
      else if (hedef?.startsWith('yapi:') && t.sira !== undefined && durum.kart.yapilar?.[t.sira]?.id === Number(hedef.slice(5))) bulunan = o;
    });
    return bulunan;
  }
  function etkilesimKur() {
    const el = renderer.domElement;
    for (const olay of ['pointerdown', 'pointermove', 'wheel']) el.addEventListener(olay, etkilesim, { passive: true });
    el.addEventListener('pointerdown', (e) => {
      dokunuslar.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (dokunuslar.size === 2) { const [a, b] = [...dokunuslar.values()]; surukle = { cimdik: Math.hypot(a.x - b.x, a.y - b.y), uz: hedefUzaklik }; return; }
      surukle = { x: e.clientX, y: e.clientY, aci, egim, t: performance.now(), oynadi: false };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dokunuslar.has(e.pointerId)) return;
      dokunuslar.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!surukle) return;
      if (surukle.cimdik && dokunuslar.size === 2) { const [a, b] = [...dokunuslar.values()]; hedefUzaklik = THREE.MathUtils.clamp(surukle.uz * (surukle.cimdik / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y))), kadraj * 1.1, kadraj * 4); return; }
      if (!surukle.oynadi && Math.hypot(e.clientX - surukle.x, e.clientY - surukle.y) < 7) return;
      surukle.oynadi = true;
      aci = surukle.aci - (e.clientX - surukle.x) * 0.008;
      egim = THREE.MathUtils.clamp(surukle.egim + (e.clientY - surukle.y) * 0.005, 0.45, 1.35);
    });
    el.addEventListener('pointerup', (e) => {
      dokunuslar.delete(e.pointerId);
      const s = surukle; surukle = null;
      if (!s || s.cimdik || s.oynadi || performance.now() - s.t > 500) return;
      ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      isin.setFromCamera(ndc, kamera);
      for (const v of isin.intersectObject(grup, true)) {
        let o = v.object;
        while (o && o !== grup && !o.userData.tepki && !o.userData.tepkiHedef) o = o.parent;
        if (o?.userData.tepkiHedef) o = o.userData.tepkiHedef;
        if (!o || o === grup) continue;
        const t = o.userData.tepki;
        if (t.tur === 'genislet') { ses('tik'); genisletSayfasi(t.id); return; }
        if (t.tur === 'komsu') { ses('tik'); komsuBilgiSayfasi(t.id); return; }
        canli.tepki(o, v.point);
        if (t.tur === 'komsu-ben') { komsuBenSayfasi(t.id); return; }
        if (ziyaret) return;   // ziyarette yalnızca tepki
        if (t.tur === 'ekin') ekinSayfasi();
        else if (t.tur === 'toprak') ekSayfasi();
        else if (t.sira !== undefined) yapiSayfasi(t.sira);
        else if (t.tur === 'zemin') { if (durum.kart.insaatSecenekleri?.length) insaatSayfasi(); }
        if (t.tur !== 'ciftci' && t.tur !== 'hayvan') canli.git(model.worldToLocal(v.point.clone()), 1.6);
        return;
      }
      sayfaKapat();
    });
    el.addEventListener('pointercancel', (e) => { dokunuslar.delete(e.pointerId); surukle = null; });
    el.addEventListener('wheel', (e) => { e.preventDefault(); hedefUzaklik = THREE.MathUtils.clamp(hedefUzaklik * (e.deltaY > 0 ? 1.1 : 0.9), kadraj * 1.1, kadraj * 4); }, { passive: false });

    kok.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-ci]')?.dataset.ci;
      if (c === 'kapat') return kapat();
      if (c === 'arazilerim') return arazilerimSayfasi();
      if (c === 'komsu-gez') { const id = e.target.closest('[data-parsel]').dataset.parsel; kapat(); return ziyaretEt?.(id); }
      if (c === 'foto') return paylas(durum.kart, { fotograf });
      if (c === 'sayfa-kapat') return sayfaKapat();
      if (c === 'ek') return ekSayfasi();
      if (c === 'insaat') return insaatSayfasi();
      if (c === 'sus') return susSayfasi();
      if (c === 'ayrinti') { kapat(); return ayrintiAc?.(); }
      if (c === 'hepsi-hasat' || c === 'hepsi-sula') return topluIs(c === 'hepsi-hasat' ? 'hasat' : 'sula', e.target.closest('button'));
      if (c === 'ciftlik-hasat' || c === 'ciftlik-sula') return topluIs(c === 'ciftlik-hasat' ? 'hasat' : 'sula', e.target.closest('button'), ciftlikSeti());
      if (c === 'ciftlik-ek') { const b = e.target.closest('[data-urun]'); return topluEk(b.dataset.urun, b.dataset.parseller.split(','), b); }
      if (c === 'arazi-is') { const b = e.target.closest('[data-parsel]'); sayfaKapat(); return topluIs(b.dataset.is, b, ciftlikSeti().filter((p) => p.id === b.dataset.parsel)); }
      if (c === 'ek-hedef') return ekSayfasi([e.target.closest('[data-parsel]').dataset.parsel]);
      if (c === 'yeniden-ek') return;
      if (c === 'gunluk') return gunlukSayfasi();
      if (c === 'meydan') return meydanSayfasi();
      if (c === 'sandik') return sandikSayfasi();
      if (c === 'sandik-ac') {
        const b = e.target.closest('button'); b.disabled = true;
        try {
          const r = await api('/api/sandik/ac', {});
          ses('sandik');
          sayfaAc(`${ust2('🎁', 'Günlük sandık', 'Açıldı!')}<div class="ci-sandik acildi"><span class="ci-sandik-ikon">✨</span>
            <div class="ci-sandik-odul"><i>${esc(r.odul.ikon)}</i><b>${esc(r.odul.metin)}</b></div><p class="ci-not">Bir sonraki sandık 8 saat sonra.</p></div>`);
          await yenileDis?.();
        } catch (err) { tostDis?.(err.message, 'hata'); sandikSayfasi(); }
        return;
      }
      if (c === 'bulmaca') return bulmacaAc({ yenile: yenileDis });
      if (c === 'meydan-insa') {
        const b = e.target.closest('[data-kod]'); b.disabled = true;
        try { const r = await api('/api/meydan/insa', { kod: b.dataset.kod }); tostDis?.(`🏗️ ${r.ad} inşaatı başladı`); await yenileDis?.(); }
        catch (err) { tostDis?.(err.message, 'hata'); }
        return meydanSayfasi();
      }
      if (c === 'isci') return isciSayfasi();
      if (c === 'tarlaya-gec') { const id = e.target.closest('[data-parsel]').dataset.parsel; kapat(); return tarlayaGec?.(id); }
      const b = e.target.closest('[data-eylem]');
      if (!b || b.disabled) return;
      // Çiftçi işin yapılacağı yere yürür; eylem sunucuda yapılır, sonra sahne yenilenir ve efekt çıkar
      const hedef = hedefNoktasi(b.dataset.hedef);
      const nokta = hedef ? new THREE.Box3().setFromObject(hedef).getCenter(new THREE.Vector3()) : null;
      if (nokta) canli.git(model.worldToLocal(nokta.clone()), 2.4);
      b.disabled = true;
      const oncekiKart = durum.kart, oncekiEkin = oncekiKart?.ekin;
      await eylemDagit(b);
      sayfaKapat();
      if (durum.kart !== oncekiKart && acik) { if (b.dataset.eylem === 'genislet') { durum.kart = await api(`/api/parsel/${encodeURIComponent(durum.secili)}`).catch(() => durum.kart); komsuKartlariniYukle(); } if (b.dataset.eylem === 'isci-tut') isci = await api('/api/isci').catch(() => isci); yenile(); }
      // Hasattan sonra tarla boşaldıysa aynı ürünü tek dokunuşla yeniden ekmeyi öner
      if (b.dataset.eylem === 'hasat' && oncekiEkin && !durum.kart?.ekin && durum.kurallar.urunler[oncekiEkin.tip]) {
        const u = durum.kurallar.urunler[oncekiEkin.tip], kat = Math.min(4, Math.max(1, Math.round(durum.kart.alan / 500)));
        setTimeout(() => sayfaAc(`${ust2(u.ikon, `${esc(u.ad)} yeniden ekilsin mi?`, 'Hasat bitti, toprak hazır')}
          <div class="ci-dugmeler"><button type="button" class="ci-b" data-eylem="ek" data-urun="${oncekiEkin.tip}" data-hedef="toprak" ${(durum.ben?.bakiye ?? 0) < u.tohum * kat ? 'disabled' : ''}>🌱 Aynısını ek<small class="ci-b-alt">${akce(u.tohum * kat)}</small></button>
          <button type="button" class="ci-b altin" data-ci="ek">Başka ürün</button></div>`, 'toprak'), 1300);
      }
      if (nokta) {
        const yeniHedef = hedefNoktasi(b.dataset.hedef) || hedef;
        canli.tepki(yeniHedef, nokta);
      }
    });
    addEventListener('keydown', (e) => { if (acik && e.key === 'Escape') (sayfa.hidden ? kapat() : sayfaKapat()); });
    addEventListener('popstate', () => { if (acik && !history.state?.ciftlik) kapat({ gecmis: false }); });   // telefonda geri tuşu
  }

  // Toplu hasat / sulama: oyuncunun bütün parsellerinde sırayla (her biri ayrı sunucu isteği; kural denetimi aynı)
  async function topluIs(tur, dugme, kaynak = durum.ben?.portfoy || []) {
    if (dugme) dugme.disabled = true;
    const liste = tur === 'hasat' ? kaynak.filter(olgunMu) : kaynak.filter(susuzMu);
    let tamam = 0, toplam = 0;
    for (const p of liste) {
      try {
        const r = await api(`/api/parsel/${encodeURIComponent(p.id)}/${tur}`, {});
        if (r) { tamam++; toplam += r.miktar || 0; }
      } catch { /* tek parsel hatası toplu işi durdurmaz */ }
    }
    ses(tur === 'hasat' ? 'hasat' : 'sula');
    for (const p of liste) komsuKartlari.delete(p.id);   // çiftlikteki komşu arazinin ekini yeniden çizilsin
    await yenileDis?.();
    komsuKartlariniYukle();
    const hedef = hedefNoktasi('ekin');
    if (hedef) canli.tepki(hedef, new THREE.Box3().setFromObject(hedef).getCenter(new THREE.Vector3()));
    tostDis?.(tur === 'hasat' ? `🧺 ${tamam} tarla hasat edildi${toplam ? ` (${sayi(toplam)} ürün)` : ''}` : `💧 ${tamam} tarla sulandı`);
  }

  // Kare hızı: dokunulurken telefonda 30, masaüstünde 60 kare; 6 sn dokunulmazsa telefonda 15, masaüstünde 30 kare
  // (sahne yine canlı görünür ama GPU ve pil boşuna yorulmaz)
  let sonEtkilesim = 0;
  const etkilesim = () => { sonEtkilesim = performance.now(); };
  function dongu(t) {
    kare = requestAnimationFrame(dongu);
    if (document.hidden) return;
    const bosta = t - sonEtkilesim > 6000 && Math.abs(hedefUzaklik - uzaklik) < 0.05 && odak.distanceToSquared(hedefOdak) < 0.01;
    const aralik = MOBIL ? (bosta ? 66 : 33) : (bosta ? 33 : 0);
    if (aralik && t - onceki < aralik - 4) return;
    const dt = Math.min(0.1, (t - onceki) / 1000 || 0.016); onceki = t;
    uzaklik += (hedefUzaklik - uzaklik) * Math.min(1, dt * 4);
    odak.lerp(hedefOdak, Math.min(1, dt * 3));
    kamera.position.set(odak.x + Math.sin(aci) * Math.cos(egim) * uzaklik, Math.sin(egim) * uzaklik, odak.z + Math.cos(aci) * Math.cos(egim) * uzaklik);
    kamera.lookAt(odak);
    RUZGAR.uZaman.value = t / 1000;
    for (const k of model?.userData.kanatlar || []) k.rotation.z -= dt * 0.9;
    canli.kare(dt, t / 1000, kadraj * 1.2);
    // "+" rozetleri ekrana dik ve dik duruşlu (eğilmeden) kameraya bakar
    // "+" rozetleri ekranda hep aynı küçük boyda (≈58 px) durur; uzaklık arttıkça büyütülür, yaklaşınca küçülür
    const pikselBasi = (2 * Math.tan((kamera.fov * Math.PI) / 360)) / innerHeight;
    for (const o of ziplayanlar) {
      const s = (kamera.position.distanceTo(o.getWorldPosition(rozetV)) * pikselBasi * 58) / 5;
      o.scale.setScalar(s);
      o.position.y = 1.2 + s * 2.8 + Math.abs(Math.sin(t / 380)) * s * 0.9;
      o.quaternion.copy(o.parent.getWorldQuaternion(rozetQ).invert().multiply(kamera.quaternion));
    }
    if (bulutlar) bulutlar.rotation.y += dt * 0.006;
    if (kar) { const p = kar.geometry.attributes.position; for (let i = 0; i < p.count; i++) { let y = p.getY(i) - dt * 4; if (y < 0) y = 60; p.setY(i, y); p.setX(i, p.getX(i) + Math.sin(t / 900 + i) * dt * 0.6); } p.needsUpdate = true; }
    if (efekt) efekt.ciz(); else renderer.render(sahne, kamera);
  }

  // Çiftlik açıkken gün ilerler: dakikada bir güneş/ay güncellenir; evre değişince (akşam oldu) sahne yeniden kurulur
  setInterval(() => {
    if (!acik || !durum.kart || !renderer) return;
    const onceki = evre;
    zamanAyarla();
    if (evre !== onceki) sahneKurgula();
  }, 60_000);

  function yenile() {
    if (!acik || !durum.kart) return;
    etkilesim();
    sahneKurgula(); hudCiz();
    if (sayfaHedef === 'ekin') ekinSayfasi();
  }
  function ac({ ziyaret: z = false } = {}) {
    ziyaret = !durum.kart?.sahip?.ben && (z || false);
    if (!durum.kart?.sahip || (!ziyaret && !durum.kart.sahip.ben)) return false;
    if (!renderer) { try { kur(); } catch (e) { console.warn('Çiftlik görünümü açılamadı', e); return false; } }
    acik = true; kok.hidden = false; document.body.classList.add('ciftlik-ici');
    kok.classList.remove('giris'); void kok.offsetWidth; kok.classList.add('giris');
    uzaklik = 140; aci = -0.6; egim = 0.95;
    sayfaKapat(); ipucu.hidden = false;
    boyutla(); sahneKurgula(); hudCiz();
    if (!ziyaret) { komsuKartlari.clear(); komsuKartlariniYukle();   // her açılışta taze (komşu tarlanın ekini değişmiş olabilir)
      api('/api/isci').then((d) => { const ilk = !isci; isci = d; if (ilk && d?.aktif) sahneKurgula(); hudCiz(); }).catch(() => {});
      api('/api/meydan').then((d) => { const degisti = d.kurulu + d.binalar.filter((b) => b.durum === 'INSAATTA').length !== (meydanVeri ? meydanVeri.kurulu + meydanVeri.binalar.filter((b) => b.durum === 'INSAATTA').length : 0); meydanVeri = d; if (degisti) sahneKurgula(); }).catch(() => {}); }
    if (!history.state?.ciftlik) history.pushState({ ...(history.state || {}), ciftlik: true }, '');
    etkilesim(); cancelAnimationFrame(kare); kare = requestAnimationFrame(dongu);
    ses('tik'); ortamSesi(true, { gece: !!gece });
    durum.harita?.duraklat?.(true);
    setTimeout(() => { ipucu.hidden = true; }, 6000);
    return true;
  }
  function kapat({ gecmis = true } = {}) {
    if (!acik) return;
    acik = false; kok.hidden = true; document.body.classList.remove('ciftlik-ici'); sayfaKapat(); ortamSesi(false); durum.harita?.duraklat?.(false);
    dunyayaCik?.();
    cancelAnimationFrame(kare);
    if (gecmis && history.state?.ciftlik) history.back();
  }
  // Paylaşım kartı için anlık görüntü: aynı karede çizip okunur (çizim tamponu korunmadığından)
  function fotograf() {
    if (efekt) efekt.ciz(); else renderer.render(sahne, kamera);
    return renderer.domElement.toDataURL('image/png');
  }

  return { ac, kapat, yenile, sayfaKapat, acik: () => acik };
}
