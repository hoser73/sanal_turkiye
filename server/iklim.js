// Gerçek havanın oyun kuralları (dunya.js ölçümü çeker ve kaydeder; burası ölçümün oyuna etkisini yönetir):
// önümüzdeki saatlerin tahmininden erken uyarı, uyarıya karşı tarla örtüsü, güneşli havada hızlı büyüme,
// rüzgârlı havada hızlı değirmen, kurak illere sulama indirimi ve üst üste afet yaşayana destek.
const db = require('./db');
const L = require('./lib/ledger');
const { HAVA, AFET, URUNLER } = require('./config/rules');
const { bulunma } = require('./lib/turkce');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);
const gunAdi = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(t);   // YYYY-MM-DD
const RISK = {
  DON:     { ad: 'Don', ikon: '❄️', ekin: true },
  DOLU:    { ad: 'Dolu', ikon: '🧊', ekin: true },
  SAGANAK: { ad: 'Sağanak', ikon: '🌊', ekin: true },
  FIRTINA: { ad: 'Fırtına', ikon: '🌪️', ekin: false },
  SICAK:   { ad: 'Aşırı sıcak', ikon: '🔥', ekin: false },
};

// Postgres'te ON CONFLICT … DO UPDATE içinde nitelenmemiş kolon adı (hedef tablo / excluded) belirsizdir: tablo adıyla nitelenir
const q = {
  hava: db.sorgu(`SELECT * FROM hava_durumu WHERE plaka = ?`),
  gecmis: db.sorgu(`INSERT INTO hava_gecmisi (plaka, gun, olcum, yagisli) VALUES (?, ?, 1, ?)
                      ON CONFLICT(plaka, gun) DO UPDATE SET olcum = hava_gecmisi.olcum + 1, yagisli = hava_gecmisi.yagisli + excluded.yagisli`),
  gecmisToplam: db.sorgu(`SELECT COALESCE(SUM(olcum), 0) AS olcum, COALESCE(SUM(yagisli), 0) AS yagisli FROM hava_gecmisi WHERE plaka = ? AND gun > ?`),
  seraVar: db.sorgu(`SELECT 1 FROM structures WHERE parcel_id = ? AND type = 'SERA' AND status = 'ACTIVE'`),
};

// Ölçümün tazeliği: iki yenileme süresinden eskiyse ölçüme dayalı bonus verilmez
async function tazeOlcum(plaka, t = simdi()) {
  const h = plaka ? await q.hava.get(plaka) : null;
  return h && t - h.guncellendi <= HAVA.yenilemeMs * 2 ? h : null;
}
async function tahminOku(plaka) {
  const h = plaka ? await q.hava.get(plaka) : null;
  if (!h?.tahmin) return null;
  try { return JSON.parse(h.tahmin); } catch { return null; }
}

// ---------- Tahmin → riskler
function riskler(tahmin) {
  const s = tahmin?.saat;
  if (!s) return [];
  const r = [];
  if (s.min <= HAVA.donEsigi) r.push({ tur: 'DON', deger: `${Math.round(s.min)}°` });
  if (s.kodlar?.some((k) => AFET.DOLU.kodlar.includes(k))) r.push({ tur: 'DOLU', deger: '' });
  if (s.yagisMaks >= AFET.SAGANAK.yagisEsigi) r.push({ tur: 'SAGANAK', deger: `${s.yagisMaks} mm/sa` });
  if (s.ruzgarMaks >= AFET.FIRTINA.ruzgarEsigi) r.push({ tur: 'FIRTINA', deger: `${Math.round(s.ruzgarMaks)} km/s` });
  if (s.max >= AFET.SICAK.sicaklikEsigi) r.push({ tur: 'SICAK', deger: `${Math.round(s.max)}°` });
  return r.map((x) => ({ ...x, ad: RISK[x.tur].ad, ikon: RISK[x.tur].ikon, ekin: RISK[x.tur].ekin }));
}

// Ekin bu riske karşı korunuyor mu? Sera hepsine, örtü dona/doluya/sağanağa karşı korur. Don yalnızca hassas ürünü vurur.
function ekinEtkilenir(e, tur, t, seraVar) {
  if (seraVar) return false;
  if (tur === 'DON' && !URUNLER[e.crop_type]?.donHassas) return false;
  if (HAVA.ortu.korur.includes(tur) && ((e.ortu_bitis && e.ortu_bitis > t) || e.ilac)) return false;   // örtü ya da bitki koruma ilacı
  return true;
}
const ortuluMu = (e, t) => !!(e.ortu_bitis && e.ortu_bitis > t);

// Erken uyarı: riskli ilde etkilenecek ekini olan oyuncuya (aynı risk için 12 saatte bir) haber ver
async function uyarilariGonder(plaka, tahmin, t = simdi()) {
  const liste = riskler(tahmin).filter((r) => r.ekin);
  if (!liste.length) return 0;
  const il = await db.get(`SELECT id, name FROM regions WHERE type = 'IL' AND plaka = ?`, plaka);
  if (!il) return 0;
  const ekinler = await db.all(`SELECT c.*, EXISTS (SELECT 1 FROM structures s WHERE s.parcel_id = c.parcel_id AND s.type = 'SERA' AND s.status = 'ACTIVE') AS sera
                              FROM crops c JOIN parcels p ON p.id = c.parcel_id JOIN users u ON u.id = c.user_id
                              WHERE c.status = 'GROWING' AND p.il_id = ? AND u.is_npc = 0`, il.id);
  // Oyuncu başına tek bildirim: yeni (12 saattir bildirilmemiş) riskler ve etkilenecek ekinler birlikte
  const kisiler = new Map();   // user → { riskler: Set, ekinler: Map }
  for (const r of liste) {
    for (const e of ekinler) {
      if (!ekinEtkilenir(e, r.tur, t, e.sera)) continue;
      const k = kisiler.get(e.user_id) || { riskler: new Set(), ekinler: new Map() };
      k.riskler.add(r.tur); k.ekinler.set(e.id, e);
      kisiler.set(e.user_id, k);
    }
  }
  let gonderilen = 0;
  for (const [userId, k] of kisiler) {
    const yeni = [];
    for (const r of liste) {
      if (k.riskler.has(r.tur)
        && !await db.get(`SELECT 1 FROM hava_uyarilari WHERE user_id = ? AND plaka = ? AND tur = ? AND created_at > ?`, userId, plaka, r.tur, t - HAVA.uyariTekrarMs)) yeni.push(r);
    }
    if (!yeni.length) continue;
    for (const r of yeni) await db.run(`INSERT INTO hava_uyarilari (user_id, plaka, tur, created_at) VALUES (?, ?, ?, ?)`, userId, plaka, r.tur, t);
    const es = [...k.ekinler.values()];
    const urunler = [...new Set(es.map((e) => URUNLER[e.crop_type].ad))].join(', ');
    const riskMetni = yeni.map((r) => `${r.ad.toLocaleLowerCase('tr-TR')}${r.deger ? ` (${r.deger})` : ''}`).join(' ve ');
    await bildir(userId, `${yeni.map((r) => r.ikon).join('')} ${bulunma(il.name)} önümüzdeki ${HAVA.tahminSaat} saatte ${riskMetni} bekleniyor. `
      + `${es.length > 1 ? `${es.length} tarlandaki` : 'Tarlandaki'} ${urunler} zarar görebilir: olgunsa hasat et ya da ${HAVA.ortu.ikon} örtü ser.`, `parsel:${es[0].parcel_id}`);
    gonderilen++;
  }
  return gonderilen;
}

// ---------- Tarla örtüsü
const ortuSer = (userId, parcelId) => db.tx(async () => {
  const oyun = require('./oyun');
  const p = await oyun.parselGetir(parcelId);
  await require('./kira').kullanimHakki(p, userId);
  const e = await db.get(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`, p.id);
  if (!e) throw new OyunHatasi(409, 'Örtü serilecek ekin yok');
  const t = simdi();
  if (ortuluMu(e, t)) throw new OyunHatasi(409, 'Tarla zaten örtülü');
  if (oyun.aktifYapiVar(await db.all(`SELECT * FROM structures WHERE parcel_id = ?`, p.id), 'SERA', t)) throw new OyunHatasi(409, 'Sera bu tarlayı zaten koruyor');
  // Nalburdan alınmış örtü varsa o serilir (ücretsiz)
  const tx = L.yeniTx();
  const stoktan = await require('./carsi').stoktanKullan(userId, 'TARLA_ORTUSU', `${HAVA.ortu.ad} (${p.id})`, tx);
  const maliyet = stoktan ? 0 : HAVA.ortu.birimMaliyet * oyun.verimKati(p);
  if (maliyet) await L.harca(userId, maliyet, `${HAVA.ortu.ad} (${p.id})`, tx);
  const bitis = t + HAVA.ortu.sureMs;
  if ((await db.run(`UPDATE crops SET ortu_bitis = ? WHERE id = ? AND status = 'GROWING' AND (ortu_bitis IS NULL OR ortu_bitis <= ?)`, bitis, e.id, t)).changes !== 1) {
    throw new OyunHatasi(409, 'Eşzamanlı işlem, tekrar deneyin');
  }
  await L.denetim({ aktor: userId, eylem: 'CROP_COVERED', varlik: p.id, bolge: p.region_id, sonra: { bitis } });
  return { tamam: true, maliyet, bitis, stoktan };
});

// ---------- Ölçüme dayalı katsayılar
async function gunesKati(plaka, t = simdi()) {
  const h = await tazeOlcum(plaka, t), g = HAVA.gunes;
  return h && h.gunduz && g.kodlar.includes(h.kod) && h.sicaklik >= g.min && h.sicaklik <= g.max ? g.kati : 1;
}
async function ruzgarKati(plaka, t = simdi()) {
  const h = await tazeOlcum(plaka, t);
  return h && h.ruzgar >= HAVA.ruzgar.esik ? HAVA.ruzgar.kati : 1;
}
async function gecmisKaydet(o, t = simdi()) {
  await q.gecmis.run(o.plaka, gunAdi(t), o.yagis >= HAVA.yagmurEsigi ? 1 : 0);
}
async function kuraklik(plaka, t = simdi()) {
  const k = HAVA.kuraklik;
  const g = await q.gecmisToplam.get(plaka, gunAdi(t - k.gun * 864e5));
  const oran = g.olcum ? g.yagisli / g.olcum : null;
  const kurak = g.olcum >= k.minOlcum && oran < k.oran;
  return { kurak, yagisliOran: oran === null ? null : Math.round(oran * 100) / 100, indirim: kurak ? k.indirim : 0, gun: k.gun };
}

// ---------- Afet desteği
// Afet desteği defter yazdığından tek işlemde (afetleriUygula içinden çağrılınca kayıt noktası)
const afetEtkilenenleri = (afetId, kullanicilar, plaka, t = simdi()) => db.tx(async () => {
  const d = HAVA.afetDestegi;
  const verilen = [];
  for (const userId of kullanicilar) {
    await db.run(`INSERT OR IGNORE INTO afet_etkilenen (afet_id, user_id, created_at) VALUES (?, ?, ?)`, afetId, userId, t);
    const u = await db.get(`SELECT is_npc, status, email_dogrulandi_at, created_at FROM users WHERE id = ?`, userId);
    if (!u || u.is_npc || u.status !== 'ACTIVE' || !u.email_dogrulandi_at) continue;
    if (t - Date.parse(`${u.created_at.replace(' ', 'T')}Z`) < d.minHesapGun * 864e5) continue;
    const say = (await db.get(`SELECT COUNT(*) AS c FROM afet_etkilenen WHERE user_id = ? AND created_at > ?`, userId, t - d.gun * 864e5)).c;
    if (say < d.esik) continue;
    // Aynı oyuncuya eşzamanlı iki afet turu iki destek vermesin
    await db.kilit(`afet-destegi:${userId}`);
    if (await db.get(`SELECT 1 FROM afet_destekleri WHERE user_id = ? AND created_at > ?`, userId, t - d.gun * 864e5)) continue;
    await db.run(`INSERT INTO afet_destekleri (user_id, tutar, created_at) VALUES (?, ?, ?)`, userId, d.tutar, t);
    await L.odul(userId, d.tutar, `Afet desteği (${d.gun} günde ${say} afet)`);
    await bildir(userId, `🤝 Afet desteği: son ${d.gun} günde ${say} kez hava afetinden etkilendin; hesabına ₳${d.tutar} destek yattı. Sera ve örtü ekinini korur.`, null);
    verilen.push(userId);
  }
  return verilen;
});

// ---------- Okuma
async function parselIklimi(plaka, t = simdi()) {
  const tahmin = await tahminOku(plaka);
  const h = await tazeOlcum(plaka, t);
  return {
    yarin: tahmin?.yarin ? { ...tahmin.yarin, ...wmo(tahmin.yarin.kod) } : null,
    riskler: riskler(tahmin),
    tahminSaat: HAVA.tahminSaat,
    kuraklik: await kuraklik(plaka, t),
    gunesli: (await gunesKati(plaka, t)) < 1, gunesKati: HAVA.gunes.kati,
    ruzgar: h ? { kmh: Math.round(h.ruzgar), degirmenHizli: h.ruzgar >= HAVA.ruzgar.esik } : null,
    ortu: { ...HAVA.ortu },
  };
}
const wmo = (k) => { const [ikon, durum] = require('./dunya').wmo(k); return { ikon, durum }; };

// Oyuncunun tarlası olan illerin havası, riskleri ve risk altındaki ekinleri
async function benimHavam(userId, t = simdi()) {
  const ekinler = await db.all(`SELECT c.*, m.name AS mahalle, r.plaka, r.name AS il,
                                EXISTS (SELECT 1 FROM structures s WHERE s.parcel_id = c.parcel_id AND s.type = 'SERA' AND s.status = 'ACTIVE') AS sera
                              FROM crops c JOIN parcels p ON p.id = c.parcel_id JOIN regions m ON m.id = p.region_id
                              JOIN regions r ON r.id = p.il_id WHERE c.status = 'GROWING' AND c.user_id = ?`, userId);
  const plakalar = new Set([
    ...(await db.all(`SELECT DISTINCT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ?`, userId)).map((x) => x.plaka),
    ...ekinler.map((e) => e.plaka),
  ]);
  const iller = [];
  for (const plaka of plakalar) {
    const il = await db.get(`SELECT name FROM regions WHERE type = 'IL' AND plaka = ?`, plaka);
    const ik = await parselIklimi(plaka, t);
    const ilEkinleri = ekinler.filter((e) => e.plaka === plaka);
    iller.push({
      plaka, il: il?.name, hava: await require('./dunya').ilHavasi(plaka), ...ik,
      tarlalar: ilEkinleri.map((e) => ({
        parselId: e.parcel_id, mahalle: e.mahalle, urun: URUNLER[e.crop_type].ad, ikon: URUNLER[e.crop_type].ikon, olgun: t >= e.ready_at,
        sera: !!e.sera, ortuBitis: ortuluMu(e, t) ? e.ortu_bitis : null,
        tehdit: ik.riskler.filter((r) => r.ekin && ekinEtkilenir(e, r.tur, t, e.sera)).map((r) => r.tur),
      })),
    });
  }
  iller.sort((a, b) => b.tarlalar.filter((x) => x.tehdit.length).length - a.tarlalar.filter((x) => x.tehdit.length).length || b.tarlalar.length - a.tarlalar.length);
  const d = HAVA.afetDestegi;
  return {
    iller,
    afetDestegi: { ...d,
      etkilenme: (await db.get(`SELECT COUNT(*) AS c FROM afet_etkilenen WHERE user_id = ? AND created_at > ?`, userId, t - d.gun * 864e5)).c,
      sonDestek: (await db.get(`SELECT created_at FROM afet_destekleri WHERE user_id = ? ORDER BY id DESC LIMIT 1`, userId))?.created_at ?? null },
    kaynak: 'Open-Meteo.com (CC BY 4.0)',
  };
}

function rotalar(app, { h, auth, hazir }) {
  app.get('/api/hava/benim', auth.girisGerekli, h((req) => benimHavam(req.kullanici.id)));
  app.post('/api/parsel/:id/ortu', auth.girisGerekli, hazir((req) => ortuSer(req.kullanici.id, String(req.params.id))));
}

module.exports = { rotalar, riskler, ekinEtkilenir, ortuluMu, uyarilariGonder, ortuSer, gunesKati, ruzgarKati, gecmisKaydet, kuraklik,
  afetEtkilenenleri, parselIklimi, benimHavam, RISK };
