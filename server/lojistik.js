// İller arası lojistik (§8.7): oyuncu, parselinin bulunduğu bir ilden ürününü başka bir ilin tüccarına sevk eder.
// Mesafe il merkezleri arası kuş uçuşu × güzergâh katsayısıdır (kara 1,3; deniz 1,2). Varışta ürün o ilin günlük talebine göre satılır.
// Fırtına, limanlar arası deniz sevkiyatını geciktirir. Açık formül: ücret = sabit + km × km ücreti × miktar.
const db = require('./db');
const { metin, sayi } = require('./lib/girdi');
const L = require('./lib/ledger');
const { LOJISTIK, URUNLER, NPC_PAZAR, AFET } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const bugun = () => new Date().toISOString().slice(0, 10);
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);
const kurus = (n) => Math.round(n * 100) / 100;
const il = (plaka) => db.get(`SELECT id, name, plaka, center_lon AS lon, center_lat AS lat FROM regions WHERE type = 'IL' AND plaka = ?`, String(plaka).padStart(2, '0'));

function kusUcusu(a, b) {
  const R = 6371, r = Math.PI / 180;
  const d = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(d));
}
const limanMi = (plaka) => LOJISTIK.limanlar.includes(plaka);

// İlin bu ürün için tüccar çarpanı: yöresel ürün yerelde ucuz, uzakta pahalı; büyükşehirler tüketim primi verir
function ilKati(urun, plaka) {
  const u = URUNLER[urun];
  let k = LOJISTIK.buyuksehir[plaka] || 1;
  if (u.bolgeler) k *= u.bolgeler.includes(plaka) ? LOJISTIK.yoreselYerelKati : LOJISTIK.yoreselUzakKati;
  return Math.round(k * 1000) / 1000;
}
// Günlük talep doldukça fiyat düşer (NPC pazarıyla aynı eğri, il bazında)
function ilFiyati(urun, plaka, satilan) {
  const oran = Math.min(1, satilan / LOJISTIK.ilGunlukTalep);
  return URUNLER[urun].tabanFiyat * ilKati(urun, plaka) * (NPC_PAZAR.fiyatUst - (NPC_PAZAR.fiyatUst - NPC_PAZAR.fiyatAlt) * oran);
}

async function teklif({ urun, miktar, kaynak, hedef, mod }) {
  const u = URUNLER[urun];
  if (!u || !Object.hasOwn(URUNLER, urun)) throw new OyunHatasi(400, 'Bilinmeyen ürün');
  // Dükkân ürünleri ve paket sarfları NPC'ye satılmaz; sevkiyatla da satılamaz (ucuz paket → il pazarı farkı akçe basardı)
  if (u.dukkan) throw new OyunHatasi(422, `${u.ad} dükkân ürünüdür; il pazarlarına sevk edilemez`);
  const m = Number(miktar);
  if (!Number.isInteger(m) || m < 1 || m > LOJISTIK.maxMiktar) throw new OyunHatasi(400, `Miktar 1–${LOJISTIK.maxMiktar} olmalı`);
  const md = Object.hasOwn(LOJISTIK.modlar, mod) ? LOJISTIK.modlar[mod] : null;
  if (!md) throw new OyunHatasi(400, 'Geçersiz taşıma türü');
  const a = await il(kaynak), b = await il(hedef);
  if (!a || !b) throw new OyunHatasi(400, 'Geçersiz il');
  if (a.plaka === b.plaka) throw new OyunHatasi(400, 'Kaynak ve hedef il aynı');
  if (md.limanGerekli && !(limanMi(a.plaka) && limanMi(b.plaka))) throw new OyunHatasi(422, 'Deniz yolu yalnızca liman illeri arasında kullanılabilir');
  const km = Math.round(kusUcusu(a, b) * (mod === 'DENIZ' ? 1.2 : 1.3));
  const maliyet = kurus(md.sabit + km * md.kmUcret * m);
  const satilan = (await db.get(`SELECT satilan FROM il_talep WHERE gun = ? AND plaka = ? AND urun = ?`, bugun(), b.plaka, urun))?.satilan || 0;
  const tahmin = kurus(m * (ilFiyati(urun, b.plaka, satilan) + ilFiyati(urun, b.plaka, satilan + m)) / 2);
  return { a, b, km, maliyet, sureMs: LOJISTIK.sureMs(km, mod), tahminiGelir: tahmin, ilKati: ilKati(urun, b.plaka), m };
}

const gonder = (userId, govde = {}) => db.tx(async () => {
  const kaynak = String(govde.kaynak || '').padStart(2, '0');
  if (!await db.get(`SELECT 1 FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ? AND r.plaka = ? LIMIT 1`, userId, kaynak)) {
    throw new OyunHatasi(403, 'Sevkiyat yalnızca parselin olan bir ilden yapılabilir');
  }
  const mod = String(govde.mod || 'KARA');
  const t0 = await teklif({ urun: String(govde.urun || ''), miktar: govde.miktar, kaynak, hedef: String(govde.hedef || ''), mod });
  await require('./ekonomi').envanterBozulmasi(userId);
  const tx = L.yeniTx();
  await L.envanterDegis(userId, govde.urun, -t0.m, `Sevkiyat: ${t0.a.name} → ${t0.b.name}`, tx);
  await L.harca(userId, t0.maliyet, `Nakliye (${LOJISTIK.modlar[mod].ad}) ${t0.a.name} → ${t0.b.name}`, tx);
  const t = simdi();
  const id = (await db.run(`INSERT INTO sevkiyatlar (user_id, urun, miktar, kaynak_plaka, hedef_plaka, mod, km, maliyet, cikis, varis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId, govde.urun, t0.m, t0.a.plaka, t0.b.plaka, mod, t0.km, t0.maliyet, t, t + t0.sureMs)).lastInsertRowid;
  await L.denetim({ aktor: userId, eylem: 'SHIPMENT_SENT', varlik: `SEVK:${id}`, sonra: { urun: govde.urun, miktar: t0.m, rota: `${t0.a.plaka}-${t0.b.plaka}`, mod }, bolge: t0.a.id, herkese: true });
  return { tamam: true, id, varis: t + t0.sureMs, maliyet: t0.maliyet, km: t0.km, tahminiGelir: t0.tahminiGelir };
});

// Varışta teslim: o anki il talebine göre satış. Fırtınadaki limana gemi yanaşamaz → gecikme.
async function lojistikBakim() {
  const t = simdi();
  for (const { id } of await db.all(`SELECT id FROM sevkiyatlar WHERE durum = 'YOLDA' AND varis <= ? LIMIT 100`, t)) {
    await db.tx(async () => {
      // Sevkiyat satırı kilitlenip taze okunur: teslim bir kez yapılır, fırtına gecikmesi bir kez uygulanır
      const s = await db.get(`SELECT * FROM sevkiyatlar WHERE id = ? FOR UPDATE`, id);
      if (!s || s.durum !== 'YOLDA' || s.varis > t) return;
      const hedef = await il(s.hedef_plaka);
      if (s.mod === 'DENIZ' && !s.notlar) {
        const h = await db.get(`SELECT ruzgar FROM hava_durumu WHERE plaka = ?`, s.hedef_plaka);
        if (h && h.ruzgar >= AFET.FIRTINA.ruzgarEsigi) {
          const ek = Math.round((s.varis - s.cikis) * (AFET.FIRTINA.denizGecikmeKati - 1));
          if ((await db.run(`UPDATE sevkiyatlar SET varis = varis + ?, notlar = 'fırtına gecikmesi' WHERE id = ? AND durum = 'YOLDA' AND notlar IS NULL`, ek, s.id)).changes !== 1) return;
          await bildir(s.user_id, `🌪️ Fırtına: ${hedef.name} limanına gemin yanaşamadı, sevkiyat gecikti.`, null);
          return;
        }
      }
      if ((await db.run(`UPDATE sevkiyatlar SET durum = 'TESLIM' WHERE id = ? AND durum = 'YOLDA'`, s.id)).changes !== 1) return;
      const g = bugun();
      await db.kilit(`il-talep:${g}:${s.hedef_plaka}:${s.urun}`);   // aynı ilin talebine eşzamanlı teslimler sırayla fiyatlanır
      const satilan = (await db.get(`SELECT satilan FROM il_talep WHERE gun = ? AND plaka = ? AND urun = ?`, g, s.hedef_plaka, s.urun))?.satilan || 0;
      const gelir = Math.floor(s.miktar * (ilFiyati(s.urun, s.hedef_plaka, satilan) + ilFiyati(s.urun, s.hedef_plaka, satilan + s.miktar)) / 2 * 100) / 100;
      await db.run(`INSERT INTO il_talep (gun, plaka, urun, satilan) VALUES (?, ?, ?, ?) ON CONFLICT(gun, plaka, urun) DO UPDATE SET satilan = il_talep.satilan + excluded.satilan`,
        g, s.hedef_plaka, s.urun, s.miktar);
      const tx = L.yeniTx();
      if (gelir > 0) await L.aktar({ kaynak: 'SYS:NPC', hedef: L.hesap(s.user_id), tutar: gelir, sebep: `Sevkiyat satışı: ${s.miktar} ${URUNLER[s.urun].ad} (${hedef.name})`, tx });
      await db.run(`UPDATE sevkiyatlar SET gelir = ? WHERE id = ?`, gelir, s.id);
      await L.denetim({ anahtar: `SHIPMENT_DELIVERED:${s.id}`, aktor: s.user_id, eylem: 'SHIPMENT_DELIVERED', varlik: `SEVK:${s.id}`, bolge: hedef.id, herkese: true,
        sonra: { urun: s.urun, miktar: s.miktar, gelir } });
      await bildir(s.user_id, `🚚 ${s.miktar} ${URUNLER[s.urun].ad} ${hedef.name} tüccarına teslim edildi: ₳${gelir} (nakliye ₳${s.maliyet}).`, null);
    });
  }
}

async function lojistikBilgisi(userId) {
  const sevkiyatlarim = [];
  if (userId) {
    for (const s of await db.all(`SELECT * FROM sevkiyatlar WHERE user_id = ? ORDER BY id DESC LIMIT 20`, userId)) {
      sevkiyatlarim.push({ ...s, kaynak: (await il(s.kaynak_plaka)).name, hedef: (await il(s.hedef_plaka)).name, urunAd: URUNLER[s.urun].ad, ikon: URUNLER[s.urun].ikon });
    }
  }
  return {
    limanlar: LOJISTIK.limanlar, modlar: LOJISTIK.modlar, ilGunlukTalep: LOJISTIK.ilGunlukTalep,
    kaynakIller: userId ? await db.all(`SELECT DISTINCT r.plaka, r.name FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ? ORDER BY r.name`, userId) : [],
    sevkiyatlarim,
  };
}

function rotalar(app, { h, auth }) {
  app.get('/api/lojistik', h((req) => lojistikBilgisi(req.kullanici?.id ?? null)));
  app.get('/api/lojistik/teklif', h(async (req) => {
    const r = await teklif({ urun: metin(req.query.urun), miktar: sayi(req.query.miktar), kaynak: metin(req.query.kaynak), hedef: metin(req.query.hedef), mod: metin(req.query.mod) || 'KARA' });
    return { km: r.km, maliyet: r.maliyet, sureMs: r.sureMs, tahminiGelir: r.tahminiGelir, ilKati: r.ilKati, kaynak: r.a.name, hedef: r.b.name };
  }));
  app.post('/api/sevkiyat', auth.dogrulanmisGerekli, h((req) => gonder(req.kullanici.id, req.body)));
}

module.exports = { rotalar, teklif, gonder, lojistikBakim, lojistikBilgisi, ilKati, kusUcusu };
