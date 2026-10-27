// Balık tutma mini oyunu. Oyuncu 🎣'a basınca kendi bölgesinin suyuna (kıyı ilinde deniz, değilse göl/nehir) olta atar;
// haritada belirli bir suya dokunduysa oraya. Sunucu ısırma anını ve tutulacak balığı
// belirler. Isırma anı şamandıranın batışını çizebilmek için istemciye bildirilir (zamanlama oyunu doğası gereği).
// Zamanında "Çek!" denirse balık oltaya takılır (TAKILDI) ve mücadele başlar; istemci yalnızca balığın gücünü öğrenir.
// Mücadele istemcide oynanır; sunucu en kısa süreyi ve süre aşımını denetler, türü ve ağırlığı balık çıkınca söyler.
// Olta takımı: yem (türe göre çekicilik; karides ve sahte yem ücretli), derinlik ve misina tür olasılığını ve ısırma süresini
// değiştirir; ilin gerçek saati ve havası balık aktivitesini belirler. Kazanç günlük atış hakkıyla sınırlıdır. Tür yöreye göre: Karadeniz'de hamsi, Ege'de çipura, Van Gölü'nde inci kefali,
// iç sularda sazan ve alabalık; çok nadiren altın balık.
const db = require('./db');
const L = require('./lib/ledger');
const I = require('./harita/izgara');
const { ilceBul } = require('./harita/sinirlar');
const { BALIK, URUNLER } = require('./config/rules');
const { OyunHatasi } = L;

db.exec(`CREATE TABLE IF NOT EXISTS balik_atislari (
  id      INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plaka   TEXT,
  tur     TEXT NOT NULL,
  isirma  INTEGER NOT NULL,
  durum   TEXT NOT NULL DEFAULT 'BEKLIYOR',      -- BEKLIYOR / TUTULDU / KACTI
  gun     TEXT NOT NULL,
  at      INTEGER NOT NULL
)`);
db.exec(`CREATE INDEX IF NOT EXISTS ix_balik_gun ON balik_atislari(user_id, gun)`);
for (const [k, tanim] of [['takildi_at', 'INTEGER'], ['agirlik', 'REAL'], ['yem', 'TEXT'], ['derinlik', 'TEXT'], ['misina', 'TEXT'], ['yem_stok', 'INTEGER']]) {
  if (!db.prepare(`PRAGMA table_info(balik_atislari)`).all().some((c) => c.name === k)) db.exec(`ALTER TABLE balik_atislari ADD COLUMN ${k} ${tanim}`);
}
const mucadeleMinMs = (tur) => BALIK.mucadele.tabanMs + (BALIK.turler[tur]?.guc || 1) * BALIK.mucadele.gucMs;
const gun = (t = Date.now()) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);

// Nokta su mu? İç su (göl, nehir): imar karosunda SU ve bir ilçe içinde. Deniz: ilçe dışı ama ~2 km içinde kıyı ilçesi var.
// Testler sahte karo kaynağında su bulunmadığından bu işlevi değiştirebilir.
const yerlesik = {
  async suBul(lon, lat) {
    const { hucreImari } = require('./harita/imar');
    const c = I.hucre(lon, lat);
    const { kod, ilce } = await hucreImari(c.x, c.y);
    if (kod === 'SU' && ilce) return { tip: 'ic', plaka: ilce.plaka };
    if (kod === 'DIS' || kod === 'SU') {
      for (const [dx, dy] of [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02], [0.015, 0.015], [-0.015, 0.015], [0.015, -0.015], [-0.015, -0.015]]) {
        const k = ilceBul(lon + dx, lat + dy);
        if (k) return { tip: 'deniz', plaka: k.plaka };
      }
    }
    return null;
  },
};
const ayar = { suBul: yerlesik.suBul };

function agirlikliSec(tablo) {
  const toplam = Object.values(tablo).reduce((x, y) => x + y, 0);
  let r = Math.random() * toplam, son = null;
  for (const [k, w] of Object.entries(tablo)) { son = k; r -= w; if (r <= 0) return k; }
  return son;
}
// Yörenin doğal tür dağılımı (altın balık hariç)
function yoreTurleri({ tip, plaka }) {
  if (tip === 'deniz') return Object.values(BALIK.deniz).find((d) => d.iller.includes(plaka))?.turler || { LEVREK: 0.5, HAMSI: 0.5 };
  if (plaka === '65') return { INCI_KEFALI: 1 };
  const karadenizDogu = ['08', '53', '61', '29', '28', '25', '75', '04', '36', '69', '24'];
  return karadenizDogu.includes(plaka) ? { ALABALIK: 0.7, SAZAN: 0.3 } : { SAZAN: 0.7, ALABALIK: 0.3 };
}
// Takımla ağırlıklandırılmış dağılım ve uyum (1 = ortalama; düşük uyum = balık geç ısırır)
function turDagilimi(su, yem, derinlik) {
  const yore = yoreTurleri(su), sonuc = {};
  let uyumPay = 0, uyumPayda = 0;
  for (const [kod, w] of Object.entries(yore)) {
    const t = BALIK.turler[kod], k = (t.yem[yem] ?? 1) * (t.derinlik[derinlik] ?? 1);
    sonuc[kod] = w * k; uyumPay += w * k; uyumPayda += w;
  }
  return { dagilim: sonuc, uyum: uyumPayda ? uyumPay / uyumPayda : 1 };
}
function turSec(su, yem, derinlik) {
  if (Math.random() < BALIK.altinOran) return 'ALTIN_BALIK';
  return agirlikliSec(turDagilimi(su, yem, derinlik).dagilim);
}

// Balık aktivitesi: ilin gerçek saati (Türkiye) ve havası. Çarpan < 1 balık daha çabuk ısırır.
function aktivite(plaka, t = Date.now()) {
  const A = BALIK.aktivite, sebepler = [];
  let kat = 1;
  const saat = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Istanbul' }).format(t));
  if (saat >= 5 && saat < 8) { kat *= A.safak; sebepler.push('🌅 şafak: balık yemde'); }
  else if (saat >= 17 && saat < 20) { kat *= A.aksam; sebepler.push('🌇 akşamüstü: balık yemde'); }
  else if (saat >= 11 && saat < 15) { kat *= A.ogle; sebepler.push('☀️ öğle: balık derinde dinleniyor'); }
  else if (saat >= 22 || saat < 4) { kat *= A.gece; sebepler.push('🌙 gece: balık durgun'); }
  const h = plaka ? db.prepare(`SELECT * FROM hava_durumu WHERE plaka = ?`).get(plaka) : null;
  if (h) {
    if (h.kod >= 95) { kat *= A.firtina; sebepler.push('⛈️ fırtına: balık saklanıyor'); }
    else if ((h.kod >= 51 && h.kod <= 67) || (h.kod >= 80 && h.kod <= 82)) { kat *= A.yagmur; sebepler.push('🌧️ yağmur: su hareketli, balık iştahlı'); }
    else if (h.kod === 2 || h.kod === 3) { kat *= A.bulutlu; sebepler.push('☁️ bulutlu: balık yüzeye yakın'); }
    if (h.ruzgar >= 30) { kat *= A.ruzgar; sebepler.push('🌬️ sert rüzgâr'); }
    if (h.sicaklik < 3 || h.sicaklik > 32) { kat *= A.asiriSicaklik; sebepler.push(h.sicaklik < 3 ? '🥶 soğuk su' : '🥵 sıcak su'); }
  }
  kat = Math.round(kat * 100) / 100;
  const etiket = kat <= 0.8 ? 'yüksek' : kat <= 1.05 ? 'normal' : 'düşük';
  return { kat, etiket, sebepler, saat, hava: h ? { sicaklik: Math.round(h.sicaklik), kod: h.kod, ruzgar: Math.round(h.ruzgar), gunduz: !!h.gunduz } : null };
}

// Takım seçimini doğrula (bilinmeyen değer varsayılana döner)
const sec = (tablo, kod, varsayilan) => (typeof kod === 'string' && Object.hasOwn(tablo, kod) ? kod : varsayilan);
function takim(govde = {}) {
  return { yem: sec(BALIK.yemler, govde.yem, 'SOLUCAN'), derinlik: sec(BALIK.derinlikler, govde.derinlik, 'ORTA'), misina: sec(BALIK.misinalar, govde.misina, 'ORTA') };
}

// Atıştan önce: bu noktada su var mı, hangi türler, aktivite (tür olasılıkları istemcide takımla hesaplanır)
// Olta nereye atılır: verilen nokta su ise oraya; değilse (ya da nokta yoksa) oyuncunun bölgesinin suyuna. Bölge: noktanın
// ili, yoksa ilk tarlasının ili, yoksa memleketi, yoksa Konya. Kıyı ilinde deniz, değilse göl/nehir. (v0.43: balık tutmak
// için haritada su aramak gerekmiyor; 🎣'a basınca oyun başlar.)
async function suVeyaBolge(userId, lon, lat) {
  const nokta = Number.isFinite(lon) && Number.isFinite(lat);
  if (nokta) { const su = await ayar.suBul(lon, lat); if (su) return su; }
  const plaka = (nokta && ilceBul(lon, lat)?.plaka)
    || db.prepare(`SELECT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ? ORDER BY p.acquired_at LIMIT 1`).get(userId)?.plaka
    || db.prepare('SELECT memleket_plaka FROM users WHERE id = ?').get(userId)?.memleket_plaka || '42';
  const kiyi = Object.values(BALIK.deniz).some((d) => d.iller.includes(plaka));
  return { tip: kiyi ? 'deniz' : 'ic', plaka };
}

async function ortam(userId, { lon, lat } = {}) {
  const su = await suVeyaBolge(userId, Number(lon), Number(lat));
  const yore = yoreTurleri(su);
  return {
    su: { tip: su.tip, plaka: su.plaka },
    turler: Object.entries(yore).map(([kod, w]) => ({ kod, ad: BALIK.turler[kod].ad, w, yem: BALIK.turler[kod].yem, derinlik: BALIK.turler[kod].derinlik })),
    aktivite: aktivite(su.plaka),
    kalan: Math.max(0, BALIK.gunlukAtis - db.prepare(`SELECT COUNT(*) c FROM balik_atislari WHERE user_id = ? AND gun = ?`).get(userId, gun()).c),
    // Çarşıdan alınmış yem stoku (varsa atış ücretsiz)
    stok: { KARIDES: L.envanterMiktar(userId, 'YEM_KARIDES'), MISIR: L.envanterMiktar(userId, 'YEM_MISIR'), SAHTE: L.envanterMiktar(userId, 'SAHTE_YEM_TAKIMI') > 0 ? 1 : 0 },
  };
}

async function at(userId, govde = {}) {
  require('./ciftlik').seviyeKilidi(userId, 'balik');
  const lon = Number(govde.lon), lat = Number(govde.lat);
  const tk = takim(govde);
  const g = gun();
  const say = () => db.prepare(`SELECT COUNT(*) c FROM balik_atislari WHERE user_id = ? AND gun = ?`).get(userId, g).c;
  if (say() >= BALIK.gunlukAtis) throw new OyunHatasi(429, `Bugün ${BALIK.gunlukAtis} kez olta attın; balıklar yarın yine burada`);
  const su = await suVeyaBolge(userId, lon, lat);
  // Su denetimi beklenirken başka istekler gelmiş olabilir: sayım ve kayıt beklemeden sonra, tek işlemde
  const sonuc = db.transaction(() => {
    const bugun = say();
    if (bugun >= BALIK.gunlukAtis) throw new OyunHatasi(429, `Bugün ${BALIK.gunlukAtis} kez olta attın; balıklar yarın yine burada`);
    const t = Date.now();
    // Yem: marketten alınmış paket ya da nalburdan sahte yem takımı varsa stoktan, yoksa akçe
    const yem = BALIK.yemler[tk.yem], carsi = require('./carsi');
    const stok = { KARIDES: 'YEM_KARIDES', MISIR: 'YEM_MISIR' }[tk.yem];
    let yemStok = 0;
    if (tk.yem === 'SAHTE' && carsi.sahip(userId, 'SAHTE_YEM_TAKIMI')) yemStok = 1;
    else if (stok && carsi.stoktanKullan(userId, stok, `Balık yemi: ${yem.ad}`)) yemStok = 1;
    else if (yem.fiyat > 0) L.harca(userId, yem.fiyat, `Balık yemi: ${yem.ad}`);
    // Önceki bekleyen atış kaçmış sayılır
    db.prepare(`UPDATE balik_atislari SET durum = 'KACTI' WHERE user_id = ? AND durum IN ('BEKLIYOR', 'TAKILDI')`).run(userId);
    const akt = aktivite(su.plaka, t), { uyum } = turDagilimi(su, tk.yem, tk.derinlik);
    const A = BALIK.aktivite;
    const taban = BALIK.isirma[0] + Math.random() * (BALIK.isirma[1] - BALIK.isirma[0]);
    const bekleme = Math.round(Math.min(A.maks, Math.max(A.min, taban * akt.kat * BALIK.misinalar[tk.misina].isirma / Math.max(0.35, Math.min(1.6, uyum)))));
    const isirma = t + bekleme;
    const id = db.prepare(`INSERT INTO balik_atislari (user_id, plaka, tur, isirma, gun, at, yem, derinlik, misina, yem_stok) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, su.plaka, turSec(su, tk.yem, tk.derinlik), isirma, g, t, tk.yem, tk.derinlik, tk.misina, yemStok).lastInsertRowid;
    return { id, isirmaMs: isirma - t, pencereMs: BALIK.pencere, tip: su.tip, plaka: su.plaka, kalan: BALIK.gunlukAtis - bugun - 1, aktivite: akt, ...tk,
      yemFiyat: yemStok ? 0 : yem.fiyat, yemStok: !!yemStok };
  })();
  return sonuc;
}

// Çek: zamanındaysa balık oltaya takılır ve mücadele başlar (balık henüz envantere girmez)
const cek = db.transaction((userId, atisId) => {
  const a = db.prepare(`SELECT * FROM balik_atislari WHERE id = ? AND user_id = ?`).get(Number(atisId), userId);
  if (!a) throw new OyunHatasi(404, 'Olta bulunamadı');
  if (a.durum !== 'BEKLIYOR') throw new OyunHatasi(409, 'Bu olta çoktan çekildi');
  const t = Date.now();
  const erken = t < a.isirma - 150, gec = t > a.isirma + BALIK.pencere + BALIK.tolerans;
  if (erken || gec) {
    db.prepare(`UPDATE balik_atislari SET durum = 'KACTI' WHERE id = ?`).run(a.id);
    return { takildi: false, tutuldu: false, sebep: erken ? 'erken' : 'gec' };
  }
  db.prepare(`UPDATE balik_atislari SET durum = 'TAKILDI', takildi_at = ? WHERE id = ? AND durum = 'BEKLIYOR'`).run(t, a.id);
  const tur = BALIK.turler[a.tur];
  // Nalburdan alınan kalıcı takım: örgü misina dayanımı, karbon kamış sarma hızı
  const carsi = require('./carsi'), E = require('./config/rules').CARSI.etki;
  return { takildi: true, guc: tur.guc, davranis: tur.davranis,
    dayanim: L.yuvarla(BALIK.misinalar[a.misina || 'ORTA'].dayanim * (carsi.sahip(userId, 'ORGU_MISINA') ? 1 + E.misinaDayanim : 1)),
    sarmaHiz: carsi.sahip(userId, 'KARBON_KAMIS') ? E.kamisSarma : 1, minMs: mucadeleMinMs(a.tur), maksMs: BALIK.mucadele.maksMs };
});

// Mücadele sonucu: istemci balığı çıkardı mı (basari) ya da misina koptu / balık kaçtı mı
const cikar = db.transaction((userId, atisId, { basari, neden } = {}) => {
  const a = db.prepare(`SELECT * FROM balik_atislari WHERE id = ? AND user_id = ?`).get(Number(atisId), userId);
  if (!a) throw new OyunHatasi(404, 'Olta bulunamadı');
  if (a.durum !== 'TAKILDI') throw new OyunHatasi(409, a.durum === 'BEKLIYOR' ? 'Balık henüz oltaya takılmadı' : 'Bu mücadele bitti');
  const t = Date.now(), sure = t - a.takildi_at;
  if (basari === true && sure < mucadeleMinMs(a.tur)) throw new OyunHatasi(409, 'Balık henüz yorulmadı; sarmaya devam et');
  if (basari !== true || sure > BALIK.mucadele.maksMs) {
    db.prepare(`UPDATE balik_atislari SET durum = 'KACTI' WHERE id = ?`).run(a.id);
    // Misina koptuysa stoktaki sahte yem balıkla gider
    // (koptuğunu istemci bildirir; bildirmese de kaçan balıkla sahte yem üçte bir olasılıkla gider: yem hiç tükenmez olmasın)
    if ((neden === 'koptu' || Math.random() < 1 / 3) && a.yem === 'SAHTE' && a.yem_stok) require('./carsi').stoktanKullan(userId, 'SAHTE_YEM_TAKIMI', 'Misina koptu: sahte yem kayboldu');
    return { tutuldu: false, sebep: sure > BALIK.mucadele.maksMs ? 'gec' : 'kacti' };
  }
  const tur = BALIK.turler[a.tur];
  const agirlik = Math.round((tur.kg[0] + Math.random() ** 1.6 * (tur.kg[1] - tur.kg[0])) * 100) / 100;   // iri balık daha nadir
  const onceki = db.prepare(`SELECT MAX(agirlik) AS m FROM balik_atislari WHERE user_id = ? AND tur = ? AND durum = 'TUTULDU'`).get(userId, a.tur).m;
  if (db.prepare(`UPDATE balik_atislari SET durum = 'TUTULDU', agirlik = ? WHERE id = ? AND durum = 'TAKILDI'`).run(agirlik, a.id).changes !== 1) {
    throw new OyunHatasi(409, 'Bu mücadele bitti');
  }
  L.envanterDegis(userId, a.tur, 1, `Balık: ${URUNLER[a.tur].ad}`);
  let odul = 0;
  if (a.tur === 'ALTIN_BALIK') { odul = BALIK.altinOdul; L.odul(userId, odul, 'Altın balık tuttun'); }
  L.denetim({ aktor: userId, eylem: 'FISH_CAUGHT', sonra: { tur: a.tur, plaka: a.plaka, agirlik } });
  return { tutuldu: true, urun: a.tur, ad: URUNLER[a.tur].ad, ikon: URUNLER[a.tur].ikon, odul, agirlik, rekor: onceki == null || agirlik > onceki, oncekiRekor: onceki ?? null };
});

function rotalar(app, { h, auth }) {
  app.get('/api/balik/ortam', auth.girisGerekli, h((req) => ortam(req.kullanici.id, req.query)));
  app.get('/api/balik/takim', h(() => ({ yemler: BALIK.yemler, derinlikler: BALIK.derinlikler, misinalar: BALIK.misinalar, gunlukAtis: BALIK.gunlukAtis })));
  app.post('/api/balik/at', auth.girisGerekli, h((req) => at(req.kullanici.id, req.body || {})));
  app.post('/api/balik/:id/cek', auth.girisGerekli, h((req) => cek(req.kullanici.id, req.params.id)));
  app.post('/api/balik/:id/cikar', auth.girisGerekli, h((req) => cikar(req.kullanici.id, req.params.id, req.body || {})));
}

module.exports = { rotalar, at, cek, cikar, ortam, aktivite, turDagilimi, ayar };
