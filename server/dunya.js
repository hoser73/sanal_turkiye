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
const sqlZaman = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// ---------- Mevsim (Türkiye saatiyle ay)
function mevsim(t = simdi()) {
  const ay = Number(new Intl.DateTimeFormat('en', { month: 'numeric', timeZone: 'Europe/Istanbul' }).format(t));
  const [kod, m] = Object.entries(MEVSIMLER).find(([, v]) => v.aylar.includes(ay));
  return { kod, ad: m.ad, ikon: m.ikon, buyume: m.buyume };
}
function buyumeKati(urun, seraVar, t = simdi()) {
  if (seraVar) return 1;
  const b = mevsim(t).buyume;
  return b[urun] ?? b._;
}

// ---------- Hava
const WMO = (k) => (k === 0 ? ['☀️', 'Açık'] : k <= 2 ? ['🌤️', 'Az bulutlu'] : k === 3 ? ['☁️', 'Kapalı'] : k <= 48 ? ['🌫️', 'Sisli']
  : k <= 57 ? ['🌦️', 'Çisenti'] : k <= 67 ? ['🌧️', 'Yağmurlu'] : k <= 77 ? ['🌨️', 'Karlı'] : k <= 82 ? ['🌧️', 'Sağanak'] : k <= 86 ? ['🌨️', 'Kar sağanağı'] : ['⛈️', 'Fırtına']);

let yenileniyor = null;
async function olcumleriGetir() {
  const kaynak = process.env.HAVA_KAYNAGI || 'open-meteo';
  if (kaynak === 'kapali') return null;
  if (kaynak === 'sahte') {
    // Deterministik: plakaya göre sıcaklık, her 7. ilde yağmur
    return iller.map((il, i) => ({ plaka: il.plaka, sicaklik: 8 + (i % 20), yagis: i % 7 === 0 ? 1.2 : 0, kod: i % 7 === 0 ? 61 : 1, ruzgar: 10, gunduz: 1 }));
  }
  const lat = iller.map((il) => il.merkez[1].toFixed(3)).join(','), lon = iller.map((il) => il.merkez[0].toFixed(3)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,weather_code,wind_speed_10m,is_day&timezone=Europe%2FIstanbul`;
  const r = await fetch(url, { headers: { 'user-agent': 'SanalTurkiye/0.6 (oyun prototipi)' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const j = await r.json();
  const liste = Array.isArray(j) ? j : [j];
  return liste.map((x, i) => ({ plaka: iller[i].plaka, sicaklik: x.current.temperature_2m, yagis: x.current.precipitation, kod: x.current.weather_code,
    ruzgar: x.current.wind_speed_10m, gunduz: x.current.is_day }));
}

// Ölçümü kaydet ve oyuna uygula: yağmur açık tarlayı sular (sulama hattı yoksa), don hassas ürünü işaretler (sera korur)
function uygula(o, t = simdi()) {
  db.prepare(`INSERT INTO hava_durumu (plaka, sicaklik, yagis, kod, ruzgar, gunduz, guncellendi) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(plaka) DO UPDATE SET sicaklik = excluded.sicaklik, yagis = excluded.yagis, kod = excluded.kod, ruzgar = excluded.ruzgar,
              gunduz = excluded.gunduz, guncellendi = excluded.guncellendi`).run(o.plaka, o.sicaklik, o.yagis, o.kod, o.ruzgar, o.gunduz, t);
  const ekinler = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM structures s WHERE s.parcel_id = c.parcel_id AND s.type = 'SERA' AND s.status = 'ACTIVE') AS sera
                              FROM crops c JOIN parcels p ON p.id = c.parcel_id JOIN regions r ON r.id = p.il_id
                              WHERE c.status = 'GROWING' AND r.plaka = ?`).all(o.plaka);
  let sulanan = 0, donan = 0;
  for (const e of ekinler) {
    const u = URUNLER[e.crop_type];
    if (o.yagis >= HAVA.yagmurEsigi && !e.sera && e.waterings < u.sulama && t < e.ready_at
        && (!e.last_watered_at || t - e.last_watered_at >= TARIM.sulamaAraligiMs)) {
      sulanan += db.prepare(`UPDATE crops SET waterings = waterings + 1, last_watered_at = ?, yagmur_at = ? WHERE id = ? AND waterings = ?`).run(t, t, e.id, e.waterings).changes;
    }
    if (o.sicaklik <= HAVA.donEsigi && u.donHassas && !e.sera && !e.don) {
      donan += db.prepare(`UPDATE crops SET don = 1 WHERE id = ?`).run(e.id).changes;
      bildir(e.user_id, `❄️ Don: ${e.parcel_id} tarlandaki ${u.ad} zarar gördü (verim −%${Math.round((1 - HAVA.donVerimKati) * 100)}). Sera don etkisini önler.`, `parsel:${e.parcel_id}`);
    }
  }
  return { sulanan, donan, afetler: afetleriUygula(o, t) };
}

// Hava kaynaklı afetler: ölçüm eşiği aşarsa ildeki oyuncu varlıkları etkilenir (aynı afet ilde 12 saatte bir)
function afetleriUygula(o, t) {
  const turler = [];
  if (o.ruzgar >= AFET.FIRTINA.ruzgarEsigi) turler.push('FIRTINA');
  if (o.yagis >= AFET.SAGANAK.yagisEsigi) turler.push('SAGANAK');
  if (AFET.DOLU.kodlar.includes(o.kod)) turler.push('DOLU');
  if (o.sicaklik >= AFET.SICAK.sicaklikEsigi) turler.push('SICAK');
  const ilB = db.prepare(`SELECT id, name FROM regions WHERE type = 'IL' AND plaka = ?`).get(o.plaka);
  const olan = [];
  for (const tur of turler) {
    if (db.prepare(`SELECT 1 FROM afetler WHERE plaka = ? AND tur = ? AND created_at > ?`).get(o.plaka, tur, t - AFET.tekrarMs)) continue;
    const etkilenen = new Map();   // user → adet
    const say = (u) => etkilenen.set(u, (etkilenen.get(u) || 0) + 1);
    const seraVar = `EXISTS (SELECT 1 FROM structures s WHERE s.parcel_id = c.parcel_id AND s.type = 'SERA' AND s.status = 'ACTIVE')`;
    const ekinler = `SELECT c.* FROM crops c JOIN parcels p ON p.id = c.parcel_id WHERE c.status = 'GROWING' AND p.il_id = ?`;
    if (tur === 'FIRTINA') {
      // Yıpranma öne alınır: bakım zamanı hasar kadar geriye çekilir
      const geri = Math.round((AFET.FIRTINA.yapiHasari / BAKIM.yipranmaGunluk) * BAKIM.gunMs);
      for (const y of db.prepare(`SELECT s.* FROM structures s JOIN parcels p ON p.id = s.parcel_id JOIN users u ON u.id = s.owner_user_id
                                  WHERE p.il_id = ? AND s.status = 'ACTIVE' AND u.is_npc = 0`).all(ilB.id)) {
        db.prepare(`UPDATE structures SET bakim_at = ? WHERE id = ?`).run((y.bakim_at ?? y.completed_at ?? y.completes_at) - geri, y.id);
        say(y.owner_user_id);
      }
    } else if (tur === 'SAGANAK' || tur === 'DOLU') {
      for (const e of db.prepare(`${ekinler} AND NOT ${seraVar}`).all(ilB.id)) {
        db.prepare(`UPDATE crops SET afet_kati = afet_kati * ? WHERE id = ?`).run(AFET[tur].verimKati, e.id);
        say(e.user_id);
      }
    } else if (tur === 'SICAK') {
      for (const e of db.prepare(`${ekinler} AND c.waterings > 0 AND NOT EXISTS (SELECT 1 FROM structures s WHERE s.parcel_id = c.parcel_id AND s.type = 'SULAMA_HATTI' AND s.status = 'ACTIVE')`).all(ilB.id)) {
        db.prepare(`UPDATE crops SET waterings = MAX(0, waterings - ?) WHERE id = ?`).run(AFET.SICAK.sulamaKaybi, e.id);
        say(e.user_id);
      }
    }
    const adet = [...etkilenen.values()].reduce((a, b) => a + b, 0);
    db.prepare(`INSERT INTO afetler (plaka, tur, olcum, etkilenen, created_at) VALUES (?, ?, ?, ?, ?)`).run(o.plaka, tur, JSON.stringify(o), adet, t);
    L.denetim({ eylem: 'WEATHER_EVENT', varlik: `IL:${ilB.id}`, bolge: ilB.id, herkese: true, sonra: { tur, ad: AFET[tur].ad, il: ilB.name, etkilenen: adet } });
    const metin = { FIRTINA: 'yapıların yıprandı; bakım yapmayı unutma', SAGANAK: 'açık tarladaki ekinlerin verim kaybetti', DOLU: 'açık tarladaki ekinlerin zarar gördü', SICAK: 'açık tarlaların kurudu; yeniden sulaman gerekiyor' }[tur];
    for (const [u, n] of etkilenen) bildir(u, `${AFET[tur].ikon} ${require('./lib/turkce').bulunma(ilB.name)} ${AFET[tur].ad.toLocaleLowerCase('tr-TR')}: ${n} varlığın etkilendi — ${metin}. Sera ve sulama hattı korur.`, null);
    olan.push(tur);
  }
  return olan;
}
function sonAfetler(gun = 3) {
  return db.prepare(`SELECT a.plaka, a.tur, a.etkilenen, a.created_at, r.name AS il FROM afetler a JOIN regions r ON r.type = 'IL' AND r.plaka = a.plaka
                     WHERE a.created_at > ? ORDER BY a.id DESC LIMIT 30`).all(simdi() - gun * 864e5).map((a) => ({ ...a, ad: AFET[a.tur].ad, ikon: AFET[a.tur].ikon }));
}

// Tembel bakım: veri bayatsa arka planda yenile (isteği bekletmez)
function havaBakim() {
  const son = db.prepare(`SELECT MAX(guncellendi) AS t FROM hava_durumu`).get().t || 0;
  if (yenileniyor || simdi() - son < HAVA.yenilemeMs) return yenileniyor;
  yenileniyor = olcumleriGetir()
    .then((liste) => { if (liste) db.transaction(() => { const t = simdi(); for (const o of liste) uygula(o, t); })(); })
    .catch((e) => { if (!process.env.SESSIZ) console.warn('Hava verisi alınamadı:', e.message); })
    .finally(() => { yenileniyor = null; });
  return yenileniyor;
}
function havaListesi() {
  const kayitlar = db.prepare(`SELECT h.*, r.name AS il, r.center_lon AS lon, r.center_lat AS lat FROM hava_durumu h JOIN regions r ON r.type = 'IL' AND r.plaka = h.plaka`).all();
  return {
    mevsim: (({ kod, ad, ikon }) => ({ kod, ad, ikon }))(mevsim()),
    kaynak: 'Open-Meteo.com (CC BY 4.0)',
    afetler: sonAfetler(),
    iller: kayitlar.map((h) => { const [ikon, durum] = WMO(h.kod); return { plaka: h.plaka, il: h.il, lon: h.lon, lat: h.lat, sicaklik: Math.round(h.sicaklik), yagis: h.yagis, ikon, durum, gunduz: !!h.gunduz, guncellendi: h.guncellendi }; }),
  };
}
const ilHavasi = (plaka) => {
  const h = db.prepare(`SELECT * FROM hava_durumu WHERE plaka = ?`).get(plaka);
  if (!h) return null;
  const [ikon, durum] = WMO(h.kod);
  return { sicaklik: Math.round(h.sicaklik), yagis: h.yagis, ikon, durum, gunduz: !!h.gunduz };
};

// ---------- İl ligi ve sezonlar
const sezonNo = (t = simdi()) => Math.floor((t - LIG.baslangic) / LIG.sezonMs) + 1;
const sezonAraligi = (n) => ({ bas: LIG.baslangic + (n - 1) * LIG.sezonMs, son: LIG.baslangic + n * LIG.sezonMs });

// Olayın ili: bölge mahalle ise iki üst, ilçe ise bir üst, il ise kendisi
const IL_SQL = `CASE r.type WHEN 'MAHALLE' THEN (SELECT parent_id FROM regions WHERE id = r.parent_id) WHEN 'ILCE' THEN r.parent_id WHEN 'IL' THEN r.id END`;
function puanlar(n) {
  const { bas, son } = sezonAraligi(n);
  const eylemler = Object.keys(LIG.puanlar);
  const satirlar = db.prepare(`SELECT a.action, a.actor_id, ${IL_SQL} AS il_id, u.memleket_plaka FROM audit_events a
                               JOIN regions r ON r.id = a.region_id JOIN users u ON u.id = a.actor_id
                               WHERE a.public = 1 AND u.is_npc = 0 AND a.created_at >= ? AND a.created_at < ?
                                 AND a.action IN (${eylemler.map(() => '?').join(',')})`).all(sqlZaman(bas), sqlZaman(son), ...eylemler);
  const ilPlaka = new Map(db.prepare(`SELECT id, plaka FROM regions WHERE type = 'IL'`).all().map((r) => [r.plaka, r.id]));
  const iller_ = new Map();   // il_id → { puan, oyuncular:Set, katki: Map(user → puan) }
  const ekle = (ilId, userId, p) => {
    if (!ilId) return;
    const k = iller_.get(ilId) || { puan: 0, oyuncular: new Set(), katki: new Map() };
    k.puan += p; k.oyuncular.add(userId); k.katki.set(userId, (k.katki.get(userId) || 0) + p);
    iller_.set(ilId, k);
  };
  for (const s of satirlar) {
    const p = LIG.puanlar[s.action];
    ekle(s.il_id, s.actor_id, p);
    const memleket = s.memleket_plaka && ilPlaka.get(s.memleket_plaka);
    if (memleket && memleket !== s.il_id) ekle(memleket, s.actor_id, p * LIG.gurbetOrani);
  }
  return iller_;
}
function ligTablosu(n = sezonNo()) {
  const p = puanlar(n);
  const adlar = new Map(db.prepare(`SELECT id, name, plaka FROM regions WHERE type = 'IL'`).all().map((r) => [r.id, r]));
  const tablo = [...p].map(([ilId, k]) => ({ ilId, il: adlar.get(ilId)?.name, plaka: adlar.get(ilId)?.plaka, puan: Math.round(k.puan * 10) / 10,
    oyuncu: k.oyuncular.size, ligPuani: Math.round((k.puan / Math.sqrt(Math.max(1, k.oyuncular.size))) * 10) / 10, katki: k.katki }))
    .sort((a, b) => b.ligPuani - a.ligPuani || b.puan - a.puan);
  tablo.forEach((x, i) => { x.sira = i + 1; });
  return tablo;
}

// Biten sezonun sonucu ilk erişimde bir kez yazılır; ilk üç ilin katkı veren oyuncularına rozet verilir
function sezonBakim() {
  const n = sezonNo() - 1;
  if (n < 1 || db.prepare(`SELECT 1 FROM ayarlar WHERE anahtar = ?`).get(`sezon_kapandi:${n}`)) return;
  const tablo = ligTablosu(n);
  db.transaction(() => {
    if (db.prepare(`INSERT OR IGNORE INTO ayarlar (anahtar, deger) VALUES (?, ?)`).run(`sezon_kapandi:${n}`, String(simdi())).changes !== 1) return;
    const ekle = db.prepare(`INSERT OR REPLACE INTO sezon_sonuclari (sezon, il_id, puan, oyuncu, lig_puani, sira) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const x of tablo) ekle.run(n, x.ilId, x.puan, x.oyuncu, x.ligPuani, x.sira);
    const madalya = ['🥇', '🥈', '🥉'];
    for (const x of tablo.slice(0, 3)) {
      for (const [userId, katki] of x.katki) {
        if (katki < LIG.rozetMinPuan) continue;
        rozetVer(userId, `SEZON_${n}_${x.plaka}`, `${n}. sezon ${x.il} ${x.sira}.si`, madalya[x.sira - 1], `${x.il} il liginde ${x.sira}. oldu; katkın ${Math.round(katki)} puan.`);
      }
    }
    L.denetim({ anahtar: `SEASON_CLOSED:${n}`, eylem: 'SEASON_CLOSED', varlik: `SEZON:${n}`, herkese: true, sonra: { ilk3: tablo.slice(0, 3).map((x) => x.il) } });
  })();
}
function rozetVer(userId, kod, ad, ikon, aciklama) {
  const r = db.prepare(`INSERT OR IGNORE INTO rozetler (user_id, kod, ad, ikon, aciklama, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(userId, kod, ad, ikon, aciklama, simdi());
  if (r.changes) bildir(userId, `${ikon} Yeni rozet: ${ad}`, null);
  return !!r.changes;
}

function lig(userId) {
  const n = sezonNo();
  const { son } = sezonAraligi(n);
  const tablo = ligTablosu(n);
  const ben = userId ? db.prepare(`SELECT memleket_plaka FROM users WHERE id = ?`).get(userId) : null;
  const benimKatkim = userId ? tablo.filter((x) => x.katki.has(userId)).map((x) => ({ il: x.il, puan: Math.round(x.katki.get(userId) * 10) / 10 })) : [];
  const onceki = db.prepare(`SELECT s.*, r.name AS il FROM sezon_sonuclari s JOIN regions r ON r.id = s.il_id WHERE s.sezon = ? ORDER BY s.sira LIMIT 3`).all(n - 1);
  return {
    sezon: n, bitis: son, mevsim: (({ kod, ad, ikon }) => ({ kod, ad, ikon }))(mevsim()),
    tablo: tablo.slice(0, 81).map(({ katki, ...x }) => x), benimKatkim, memleket: ben?.memleket_plaka || null, oncekiSezon: onceki,
    formul: 'Lig puanı = toplam puan ÷ √(etkin oyuncu). Gurbetteki hemşehrinin eylemi memleketine de yarım puan yazar.',
    puanlar: LIG.puanlar,
  };
}

// ---------- Memleket / hemşehri
function memleketSec(userId, plaka) {
  const p = String(plaka || '').padStart(2, '0');
  const il = db.prepare(`SELECT id, name FROM regions WHERE type = 'IL' AND plaka = ?`).get(p);
  if (!il) throw new OyunHatasi(400, 'Geçersiz il');
  const u = db.prepare(`SELECT memleket_plaka, memleket_at FROM users WHERE id = ?`).get(userId);
  if (u.memleket_plaka === p) return { tamam: true };
  if (u.memleket_at && simdi() - u.memleket_at < LIG.memleketBeklemeMs) {
    throw new OyunHatasi(409, `Memleketini ${Math.ceil((u.memleket_at + LIG.memleketBeklemeMs - simdi()) / 86400000)} gün sonra değiştirebilirsin`);
  }
  db.prepare(`UPDATE users SET memleket_plaka = ?, memleket_at = ? WHERE id = ?`).run(p, simdi(), userId);
  L.denetim({ aktor: userId, eylem: 'HOMETOWN_SET', varlik: `IL:${il.id}`, sonra: { plaka: p } });
  return { tamam: true, il: il.name };
}
function memleketBilgisi(plaka, userId) {
  const p = String(plaka || '').padStart(2, '0');
  const il = db.prepare(`SELECT id, name, plaka FROM regions WHERE type = 'IL' AND plaka = ?`).get(p);
  if (!il) throw new OyunHatasi(404, 'İl bulunamadı');
  const hemsehri = db.prepare(`SELECT COUNT(*) c FROM users WHERE memleket_plaka = ? AND status = 'ACTIVE' AND is_npc = 0`).get(p).c;
  const gurbette = db.prepare(`SELECT COUNT(DISTINCT u.id) c FROM users u JOIN parcels pr ON pr.owner_user_id = u.id
                               WHERE u.memleket_plaka = ? AND pr.il_id <> ?`).get(p, il.id).c;
  const sira = ligTablosu().find((x) => x.ilId === il.id);
  return { il: il.name, plaka: p, hemsehri, gurbette, ligSirasi: sira?.sira ?? null, ligPuani: sira?.ligPuani ?? 0, hava: ilHavasi(p),
    benimMemleketim: userId ? db.prepare(`SELECT memleket_plaka FROM users WHERE id = ?`).get(userId)?.memleket_plaka === p : false };
}
const rozetlerim = (userId) => db.prepare(`SELECT kod, ad, ikon, aciklama, created_at FROM rozetler WHERE user_id = ? ORDER BY id DESC`).all(userId);

function rotalar(app, { h, auth }) {
  app.get('/api/hava', h(() => havaListesi()));
  app.get('/api/lig', h((req) => lig(req.kullanici?.id ?? null)));
  app.get('/api/memleket/:plaka', h((req) => memleketBilgisi(req.params.plaka, req.kullanici?.id ?? null)));
  app.post('/api/hesap/memleket', auth.girisGerekli, h((req) => memleketSec(req.kullanici.id, req.body?.plaka)));
  app.get('/api/rozetlerim', auth.girisGerekli, h((req) => rozetlerim(req.kullanici.id)));
}

module.exports = { rotalar, mevsim, buyumeKati, havaBakim, uygula, havaListesi, ilHavasi, ligTablosu, lig, sezonNo, sezonAraligi, sezonBakim,
  memleketSec, memleketBilgisi, rozetVer, rozetlerim, afetleriUygula, sonAfetler };
