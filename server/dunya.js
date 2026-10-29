// Yaşayan dünya: gerçek takvim mevsimi, gerçek hava (Open-Meteo, il merkezleri), il ligi ve sezonlar, memleket/hemşehri, rozetler.
// Hava kaynağı HAVA_KAYNAGI ile seçilir: open-meteo (varsayılan) · sahte (test/çevrimdışı) · kapali.
// Open-Meteo ücretsiz uç noktası ticari olmayan kullanım içindir (CC BY 4.0, atıf gerekir); ticari yayında abonelik gerekir.
const db = require('./db');
const L = require('./lib/ledger');
const { iller } = require('./harita/sinirlar');
const { MEVSIMLER, HAVA, LIG, URUNLER, TARIM, AFET, BAKIM } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);

// ---------- Mevsim (Türkiye saatiyle ay)
function mevsim(t = simdi()) {
  const ay = Number(new Intl.DateTimeFormat('en', { month: 'numeric', timeZone: 'Europe/Istanbul' }).format(t));
  const [kod, m] = Object.entries(MEVSIMLER).find(([, v]) => v.aylar.includes(ay));
  return { kod, ad: m.ad, ikon: m.ikon, buyume: m.buyume };
}
// plaka verilirse ilin şu anki havası da sayılır: açık, ılık gündüz ekilen açık tarla daha hızlı büyür
async function buyumeKati(urun, seraVar, t = simdi(), plaka = null) {
  if (seraVar) return 1;
  const b = mevsim(t).buyume;
  const kati = (b[urun] ?? b._) * (plaka ? await require('./iklim').gunesKati(plaka, t) : 1);
  return Math.round(kati * 100) / 100;
}

// ---------- Hava
const WMO = (k) => (k === 0 ? ['☀️', 'Açık'] : k <= 2 ? ['🌤️', 'Az bulutlu'] : k === 3 ? ['☁️', 'Kapalı'] : k <= 48 ? ['🌫️', 'Sisli']
  : k <= 57 ? ['🌦️', 'Çisenti'] : k <= 67 ? ['🌧️', 'Yağmurlu'] : k <= 77 ? ['🌨️', 'Karlı'] : k <= 82 ? ['🌧️', 'Sağanak'] : k <= 86 ? ['🌨️', 'Kar sağanağı'] : ['⛈️', 'Fırtına']);

let yenileniyor = null;
async function olcumleriGetir() {
  const kaynak = process.env.HAVA_KAYNAGI || 'open-meteo';
  if (kaynak === 'kapali') return null;
  if (kaynak === 'sahte') {
    // Deterministik: plakaya göre sıcaklık, her 7. ilde yağmur; tahminde her 11. ilde don, her 13. ilde dolu
    return iller.map((il, i) => ({ plaka: il.plaka, sicaklik: 8 + (i % 20), yagis: i % 7 === 0 ? 1.2 : 0, kod: i % 7 === 0 ? 61 : 1, ruzgar: 10, gunduz: 1,
      tahmin: { saat: { min: i % 11 === 0 ? -2 : 6 + (i % 20), max: 14 + (i % 20), yagisMaks: i % 7 === 0 ? 1.2 : 0, kodlar: i % 13 === 0 ? [3, 96] : [1, 2], ruzgarMaks: 15 },
        yarin: { min: 4 + (i % 10), max: 16 + (i % 12), yagis: i % 7 === 0 ? 3.4 : 0, kod: i % 7 === 0 ? 61 : 2, ruzgar: 14 } } }));
  }
  const lat = iller.map((il) => il.merkez[1].toFixed(3)).join(','), lon = iller.map((il) => il.merkez[0].toFixed(3)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code,wind_speed_10m,is_day`
    + `&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m&forecast_hours=${HAVA.tahminSaat}`
    + `&daily=temperature_2m_min,temperature_2m_max,precipitation_sum,weather_code,wind_speed_10m_max&forecast_days=2&timezone=Europe%2FIstanbul`;
  const r = await fetch(url, { headers: { 'user-agent': 'SanalTurkiye/0.11 (oyun prototipi)' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const j = await r.json();
  const liste = Array.isArray(j) ? j : [j];
  return liste.map((x, i) => ({ plaka: iller[i].plaka, sicaklik: x.current.temperature_2m, yagis: x.current.precipitation, kod: x.current.weather_code,
    ruzgar: x.current.wind_speed_10m, gunduz: x.current.is_day, tahmin: tahminCikar(x) }));
}
// Open-Meteo yanıtından özet tahmin: önümüzdeki saatler (risk) ve yarın (gösterim). Eksik alan olursa null.
function tahminCikar(x) {
  const sayilar = (a) => (Array.isArray(a) ? a.filter((v) => typeof v === 'number' && Number.isFinite(v)) : []);
  const s = x.hourly || {}, d = x.daily || {};
  const sic = sayilar(s.temperature_2m), yag = sayilar(s.precipitation), kod = sayilar(s.weather_code), rz = sayilar(s.wind_speed_10m);
  const saat = sic.length ? { min: Math.min(...sic), max: Math.max(...sic), yagisMaks: yag.length ? Math.max(...yag) : 0,
    kodlar: [...new Set(kod)], ruzgarMaks: rz.length ? Math.max(...rz) : 0 } : null;
  const g = (a) => (Array.isArray(a) && typeof a[1] === 'number' ? a[1] : null);
  const yarin = g(d.temperature_2m_min) !== null ? { min: g(d.temperature_2m_min), max: g(d.temperature_2m_max), yagis: g(d.precipitation_sum) ?? 0,
    kod: g(d.weather_code) ?? 0, ruzgar: g(d.wind_speed_10m_max) ?? 0 } : null;
  return saat || yarin ? { saat, yarin } : null;
}

// Ölçümü kaydet ve oyuna uygula: yağmur açık tarlayı sular (sulama hattı yoksa), don hassas ürünü işaretler (sera korur).
// Tek işlem (havaBakim içinden çağrılınca kayıt noktası)
const uygula = (o, t = simdi()) => db.tx(async () => {
  const iklim = require('./iklim');
  await db.run(`INSERT INTO hava_durumu (plaka, sicaklik, yagis, kod, ruzgar, gunduz, guncellendi, tahmin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(plaka) DO UPDATE SET sicaklik = excluded.sicaklik, yagis = excluded.yagis, kod = excluded.kod, ruzgar = excluded.ruzgar,
              gunduz = excluded.gunduz, guncellendi = excluded.guncellendi, tahmin = excluded.tahmin`,
    o.plaka, o.sicaklik, o.yagis, o.kod, o.ruzgar, o.gunduz, t, o.tahmin ? JSON.stringify(o.tahmin) : null);
  await iklim.gecmisKaydet(o, t);
  const ekinler = await db.all(`SELECT c.*, (SELECT COUNT(*) FROM structures s WHERE s.parcel_id = c.parcel_id AND s.type = 'SERA' AND s.status = 'ACTIVE') AS sera
                              FROM crops c JOIN parcels p ON p.id = c.parcel_id JOIN regions r ON r.id = p.il_id
                              WHERE c.status = 'GROWING' AND r.plaka = ?`, o.plaka);
  let sulanan = 0, donan = 0;
  for (const e of ekinler) {
    const u = URUNLER[e.crop_type];
    if (o.yagis >= HAVA.yagmurEsigi && !e.sera && e.waterings < u.sulama && t < e.ready_at
        && (!e.last_watered_at || t - e.last_watered_at >= TARIM.sulamaAraligiMs)) {
      sulanan += (await db.run(`UPDATE crops SET waterings = waterings + 1, last_watered_at = ?, yagmur_at = ? WHERE id = ? AND waterings = ?`, t, t, e.id, e.waterings)).changes;
    }
    if (o.sicaklik <= HAVA.donEsigi && !e.don && iklim.ekinEtkilenir(e, 'DON', t, e.sera)) {
      const r = await db.run(`UPDATE crops SET don = 1 WHERE id = ? AND don = 0`, e.id);
      donan += r.changes;
      if (r.changes) await bildir(e.user_id, `❄️ Don: ${e.parcel_id} tarlandaki ${u.ad} zarar gördü (verim −%${Math.round((1 - HAVA.donVerimKati) * 100)}). Sera don etkisini önler.`, `parsel:${e.parcel_id}`);
    }
  }
  const afetler = await afetleriUygula(o, t);
  return { sulanan, donan, afetler, uyarilan: o.tahmin ? await iklim.uyarilariGonder(o.plaka, o.tahmin, t) : 0 };
});

// Hava kaynaklı afetler: ölçüm eşiği aşarsa ildeki oyuncu varlıkları etkilenir (aynı afet ilde 12 saatte bir).
// Tek işlem: afet kaydı, etkiler ve afet desteği (defter) birlikte yazılır
const afetleriUygula = (o, t) => db.tx(async () => {
  const turler = [];
  if (o.ruzgar >= AFET.FIRTINA.ruzgarEsigi) turler.push('FIRTINA');
  if (o.yagis >= AFET.SAGANAK.yagisEsigi) turler.push('SAGANAK');
  if (AFET.DOLU.kodlar.includes(o.kod)) turler.push('DOLU');
  if (o.sicaklik >= AFET.SICAK.sicaklikEsigi) turler.push('SICAK');
  if (!turler.length) return [];
  const ilB = await db.get(`SELECT id, name FROM regions WHERE type = 'IL' AND plaka = ?`, o.plaka);
  const olan = [];
  // Aynı ilde aynı anda iki tur (çok sunucu) aynı afeti iki kez yazmasın
  await db.kilit(`afet:${o.plaka}`);
  for (const tur of turler) {
    if (await db.get(`SELECT 1 FROM afetler WHERE plaka = ? AND tur = ? AND created_at > ?`, o.plaka, tur, t - AFET.tekrarMs)) continue;
    const etkilenen = new Map();   // user → adet
    const say = (u) => etkilenen.set(u, (etkilenen.get(u) || 0) + 1);
    const seraVar = `(EXISTS (SELECT 1 FROM structures s WHERE s.parcel_id = c.parcel_id AND s.type = 'SERA' AND s.status = 'ACTIVE') OR COALESCE(c.ortu_bitis, 0) > ${Number(t)} OR c.ilac = 1)`;   // örtü ve bitki koruma ilacı da korur
    const ekinler = `SELECT c.* FROM crops c JOIN parcels p ON p.id = c.parcel_id WHERE c.status = 'GROWING' AND p.il_id = ?`;
    if (tur === 'FIRTINA') {
      // Yıpranma öne alınır: bakım zamanı hasar kadar geriye çekilir
      const geri = Math.round((AFET.FIRTINA.yapiHasari / BAKIM.yipranmaGunluk) * BAKIM.gunMs);
      for (const y of await db.all(`SELECT s.* FROM structures s JOIN parcels p ON p.id = s.parcel_id JOIN users u ON u.id = s.owner_user_id
                                  WHERE p.il_id = ? AND s.status = 'ACTIVE' AND u.is_npc = 0`, ilB.id)) {
        await db.run(`UPDATE structures SET bakim_at = ? WHERE id = ?`, (y.bakim_at ?? y.completed_at ?? y.completes_at) - geri, y.id);
        say(y.owner_user_id);
      }
    } else if (tur === 'SAGANAK' || tur === 'DOLU') {
      for (const e of await db.all(`${ekinler} AND NOT ${seraVar}`, ilB.id)) {
        await db.run(`UPDATE crops SET afet_kati = afet_kati * ? WHERE id = ?`, AFET[tur].verimKati, e.id);
        say(e.user_id);
      }
    } else if (tur === 'SICAK') {
      // Olgun ekin ve seralı tarla etkilenmez; sulama hattı kurumayı önler
      for (const e of await db.all(`${ekinler} AND c.waterings > 0 AND c.ready_at > ${Number(t)}
          AND NOT EXISTS (SELECT 1 FROM structures s WHERE s.parcel_id = c.parcel_id AND s.type IN ('SULAMA_HATTI', 'SERA') AND s.status = 'ACTIVE')`, ilB.id)) {
        await db.run(`UPDATE crops SET waterings = GREATEST(0, waterings - ?) WHERE id = ?`, AFET.SICAK.sulamaKaybi, e.id);
        say(e.user_id);
      }
    }
    const adet = [...etkilenen.values()].reduce((a, b) => a + b, 0);
    const afetId = (await db.run(`INSERT INTO afetler (plaka, tur, olcum, etkilenen, created_at) VALUES (?, ?, ?, ?, ?)`,
      o.plaka, tur, JSON.stringify({ ...o, tahmin: undefined }), adet, t)).lastInsertRowid;
    await require('./iklim').afetEtkilenenleri(afetId, [...etkilenen.keys()], o.plaka, t);
    await L.denetim({ eylem: 'WEATHER_EVENT', varlik: `IL:${ilB.id}`, bolge: ilB.id, herkese: true, sonra: { tur, ad: AFET[tur].ad, il: ilB.name, etkilenen: adet } });
    const metin = { FIRTINA: 'yapıların yıprandı; bakım yapmayı unutma', SAGANAK: 'açık tarladaki ekinlerin verim kaybetti', DOLU: 'açık tarladaki ekinlerin zarar gördü', SICAK: 'açık tarlaların kurudu; yeniden sulaman gerekiyor' }[tur];
    const korunma = { FIRTINA: '', SAGANAK: 'Sera, tarla örtüsü ve bitki koruma ilacı korur.', DOLU: 'Sera, tarla örtüsü ve bitki koruma ilacı korur.', SICAK: 'Sera ve sulama hattı korur.' }[tur];
    for (const [u, n] of etkilenen) await bildir(u, `${AFET[tur].ikon} ${require('./lib/turkce').bulunma(ilB.name)} ${AFET[tur].ad.toLocaleLowerCase('tr-TR')}: ${n} varlığın etkilendi — ${metin}.${korunma && ` ${korunma}`}`, null);
    olan.push(tur);
  }
  return olan;
});
async function sonAfetler(gun = 3) {
  return (await db.all(`SELECT a.plaka, a.tur, a.etkilenen, a.created_at, r.name AS il FROM afetler a JOIN regions r ON r.type = 'IL' AND r.plaka = a.plaka
                     WHERE a.created_at > ? ORDER BY a.id DESC LIMIT 30`, simdi() - gun * 864e5)).map((a) => ({ ...a, ad: AFET[a.tur].ad, ikon: AFET[a.tur].ikon }));
}

// Tembel bakım: veri bayatsa yenilemeyi başlatır. Dönen söz yenileme bitince çözülür (yenileme yoksa hemen);
// bakım turu onu beklemez (index.js), testler bekler. Ağ çağrısı işlem dışında; yazma tek işlemde.
const sonGuncelleme = async () => (await db.get(`SELECT MAX(guncellendi) AS t FROM hava_durumu`)).t || 0;
async function havaBakim() {
  if (yenileniyor) return yenileniyor;
  if (simdi() - await sonGuncelleme() < HAVA.yenilemeMs) return null;
  if (yenileniyor) return yenileniyor;   // SELECT beklenirken başka çağrı başlatmış olabilir
  yenileniyor = olcumleriGetir()
    .then((liste) => liste && db.tx(async () => {
      // Çok sunucu: aynı anda iki örnek yenilediyse ikincisi kilidi alınca güncel veriyi görür ve yazmaz
      await db.kilit('hava');
      if (simdi() - await sonGuncelleme() < HAVA.yenilemeMs) return;
      const t = simdi();
      for (const o of liste) await uygula(o, t);
    }))
    .catch((e) => { if (!process.env.SESSIZ) console.warn('Hava verisi alınamadı:', e.message); })
    .finally(() => { yenileniyor = null; });
  return yenileniyor;
}
async function havaListesi() {
  const kayitlar = await db.all(`SELECT h.*, r.name AS il, r.center_lon AS lon, r.center_lat AS lat FROM hava_durumu h JOIN regions r ON r.type = 'IL' AND r.plaka = h.plaka`);
  return {
    mevsim: (({ kod, ad, ikon }) => ({ kod, ad, ikon }))(mevsim()),
    kaynak: 'Open-Meteo.com (CC BY 4.0)',
    afetler: await sonAfetler(),
    tahminSaat: HAVA.tahminSaat,
    iller: kayitlar.map((h) => {
      const [gIkon, durum] = WMO(h.kod), ikon = gece(gIkon, h);
      let tahmin = null;
      try { tahmin = h.tahmin ? JSON.parse(h.tahmin) : null; } catch { /* bozuk kayıt: tahminsiz */ }
      const riskler = require('./iklim').riskler(tahmin).map(({ tur, ad, ikon: i, deger }) => ({ tur, ad, ikon: i, deger }));
      return { plaka: h.plaka, il: h.il, lon: h.lon, lat: h.lat, sicaklik: Math.round(h.sicaklik), yagis: h.yagis, kod: h.kod, ruzgar: h.ruzgar, ikon, durum,
        gunduz: !!h.gunduz, guncellendi: h.guncellendi, riskler, uyari: riskler[0]?.ikon || null };
    }),
  };
}
// Açık/az bulutlu gece güneş yerine ay
const gece = (ikon, h) => (!h.gunduz && (ikon === '☀️' || ikon === '🌤️') ? '🌙' : ikon);
const ilHavasi = async (plaka) => {
  const h = await db.get(`SELECT * FROM hava_durumu WHERE plaka = ?`, plaka);
  if (!h) return null;
  const [gIkon, durum] = WMO(h.kod), ikon = gece(gIkon, h);
  return { sicaklik: Math.round(h.sicaklik), yagis: h.yagis, ikon, durum, gunduz: !!h.gunduz };
};

// ---------- Rozetler (albüm ve başarımlar)
async function rozetVer(userId, kod, ad, ikon, aciklama) {
  const r = await db.run(`INSERT OR IGNORE INTO rozetler (user_id, kod, ad, ikon, aciklama, created_at) VALUES (?, ?, ?, ?, ?, ?)`, userId, kod, ad, ikon, aciklama, simdi());
  if (r.changes) await bildir(userId, `${ikon} Yeni rozet: ${ad}`, null);
  return !!r.changes;
}

// ---------- Memleket / hemşehri
async function memleketSec(userId, plaka) {
  const p = String(plaka || '').padStart(2, '0');
  const il = await db.get(`SELECT id, name FROM regions WHERE type = 'IL' AND plaka = ?`, p);
  if (!il) throw new OyunHatasi(400, 'Geçersiz il');
  return db.tx(async () => {
    const u = await db.get(`SELECT memleket_plaka, memleket_at FROM users WHERE id = ? FOR UPDATE`, userId);
    if (u.memleket_plaka === p) return { tamam: true };
    if (u.memleket_at && simdi() - u.memleket_at < LIG.memleketBeklemeMs) {
      throw new OyunHatasi(409, `Memleketini ${Math.ceil((u.memleket_at + LIG.memleketBeklemeMs - simdi()) / 86400000)} gün sonra değiştirebilirsin`);
    }
    await db.run(`UPDATE users SET memleket_plaka = ?, memleket_at = ? WHERE id = ?`, p, simdi(), userId);
    await L.denetim({ aktor: userId, eylem: 'HOMETOWN_SET', varlik: `IL:${il.id}`, sonra: { plaka: p } });
    return { tamam: true, il: il.name };
  });
}
async function memleketBilgisi(plaka, userId) {
  const p = String(plaka || '').padStart(2, '0');
  const il = await db.get(`SELECT id, name, plaka FROM regions WHERE type = 'IL' AND plaka = ?`, p);
  if (!il) throw new OyunHatasi(404, 'İl bulunamadı');
  const hemsehri = (await db.get(`SELECT COUNT(*) c FROM users WHERE memleket_plaka = ? AND status = 'ACTIVE' AND is_npc = 0`, p)).c;
  const gurbette = (await db.get(`SELECT COUNT(DISTINCT u.id) c FROM users u JOIN parcels pr ON pr.owner_user_id = u.id
                               WHERE u.memleket_plaka = ? AND pr.il_id <> ?`, p, il.id)).c;
  const sira = await require('./hasat-yarisi').ilSirasi(il.id);
  return { il: il.name, plaka: p, hemsehri, gurbette, yarisSirasi: sira?.sira ?? null, yarisPuani: sira?.ilPuani ?? 0, hava: await ilHavasi(p),
    benimMemleketim: userId ? (await db.get(`SELECT memleket_plaka FROM users WHERE id = ?`, userId))?.memleket_plaka === p : false };
}
const rozetlerim = (userId) => db.all(`SELECT kod, ad, ikon, aciklama, created_at FROM rozetler WHERE user_id = ? ORDER BY id DESC`, userId);

function rotalar(app, { h, auth }) {
  app.get('/api/hava', h(require('./lib/onbellek').ortakYanit(60_000, () => havaListesi())));
  app.get('/api/memleket/:plaka', h((req) => memleketBilgisi(req.params.plaka, req.kullanici?.id ?? null)));
  app.post('/api/hesap/memleket', auth.girisGerekli, h((req) => memleketSec(req.kullanici.id, req.body?.plaka)));
  app.get('/api/rozetlerim', auth.girisGerekli, h((req) => rozetlerim(req.kullanici.id)));
}

module.exports = { rotalar, mevsim, buyumeKati, havaBakim, uygula, havaListesi, ilHavasi,
  memleketSec, memleketBilgisi, rozetVer, rozetlerim, afetleriUygula, sonAfetler, tahminCikar, wmo: WMO };
