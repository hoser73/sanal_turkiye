// Çarşı: gerçek hayattaki gibi banka, nalbur/hırdavat, market, zirai bayi + veteriner. Her türden oyunda TEK işletme vardır
// (kategori birincil anahtar). Sponsorluk anlaşması yapılınca yönetici, markanın adını, logosunu, renklerini ve sözleşme
// tarihlerini panelden girer; sözleşme bitince işletme varsayılan adına döner. Sponsorlu işletme her yerde "Sponsor" etiketiyle
// gösterilir (ticari reklam açıkça belirtilir). Şubeler: sponsorun gerçek şube konumları yüklenene kadar her il başkentinin merkezinde bir şube.
// Banka akçe ile çalışır; akçe nakde çevrilemez, bu gerçek bir bankacılık hizmeti değildir.
const db = require('./db');
const L = require('./lib/ledger');
const { CARSI, URUNLER, HAYVANLAR } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const GUN = 24 * 3600 * 1000;
const bul = (tablo, kod) => (typeof kod === 'string' && Object.hasOwn(tablo, kod) ? tablo[kod] : null);

db.exec(`
CREATE TABLE IF NOT EXISTS isletmeler (
  kategori TEXT PRIMARY KEY, ad TEXT NOT NULL, ikon TEXT, logo TEXT, renk TEXT, renk2 TEXT, slogan TEXT, web TEXT,
  sponsor INTEGER NOT NULL DEFAULT 0, sozlesme_bas INTEGER, sozlesme_bit INTEGER, guncelleyen INTEGER, guncellendi INTEGER
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS subeler (id INTEGER PRIMARY KEY, kategori TEXT NOT NULL, ad TEXT NOT NULL, lon REAL NOT NULL, lat REAL NOT NULL);
CREATE INDEX IF NOT EXISTS ix_sube_kategori ON subeler(kategori);
CREATE TABLE IF NOT EXISTS banka_vadeli (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), tutar REAL NOT NULL, faiz REAL NOT NULL,
  bas INTEGER NOT NULL, vade INTEGER NOT NULL, durum TEXT NOT NULL DEFAULT 'ACIK', kapandi_at INTEGER   -- ACIK / KAPANDI / BOZULDU
);
CREATE INDEX IF NOT EXISTS ix_vadeli_user ON banka_vadeli(user_id, durum);
`);
function kolon(tablo, ad, tanim) {
  if (!db.prepare(`PRAGMA table_info(${tablo})`).all().some((k) => k.name === ad)) db.exec(`ALTER TABLE ${tablo} ADD COLUMN ${ad} ${tanim}`);
}
kolon('crops', 'gubre', 'INTEGER NOT NULL DEFAULT 0');
kolon('crops', 'ilac', 'INTEGER NOT NULL DEFAULT 0');
kolon('structures', 'asi_bitis', 'INTEGER');

// ---------- Marka (işletme kimliği)
function marka(kategori, t = simdi()) {
  const v = CARSI.kategoriler[kategori];
  const r = db.prepare(`SELECT * FROM isletmeler WHERE kategori = ?`).get(kategori);
  const sozlesmede = !!r?.sponsor && (!r.sozlesme_bas || r.sozlesme_bas <= t) && (!r.sozlesme_bit || r.sozlesme_bit > t);
  if (!r || (r.sponsor && !sozlesmede)) return { kategori, tur: v.tur, ad: v.ad, ikon: v.ikon, renk: v.renk, renk2: v.renk2, slogan: v.slogan, logo: null, web: null, sponsor: false };
  return { kategori, tur: v.tur, ad: r.ad, ikon: r.ikon || v.ikon, renk: r.renk || v.renk, renk2: r.renk2 || v.renk2, slogan: r.slogan ?? v.slogan,
    logo: r.logo || null, web: r.web || null, sponsor: sozlesmede };
}
const markalar = (t = simdi()) => Object.keys(CARSI.kategoriler).map((k) => marka(k, t));

// Yönetici: markayı güncelle ya da varsayılana döndür. Logo yalnızca PNG/JPEG/WebP veri adresi (SVG değil: betik taşıyabilir).
const RENK = /^#[0-9a-f]{6}$/i;
function tarih(v, ad) {
  if (v == null || v === '') return null;
  const t = Date.parse(`${v}T00:00:00+03:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || !Number.isFinite(t)) throw new OyunHatasi(400, `${ad} YYYY-AA-GG biçiminde olmalı`);
  return t;
}
function markaGuncelle(yoneticiId, kategori, g = {}) {
  if (!bul(CARSI.kategoriler, kategori)) throw new OyunHatasi(404, 'Böyle bir işletme türü yok');
  const once = marka(kategori);
  if (g.sifirla === true) {
    db.prepare(`DELETE FROM isletmeler WHERE kategori = ?`).run(kategori);
    L.denetim({ aktor: yoneticiId, eylem: 'BUSINESS_BRAND_RESET', varlik: `ISLETME:${kategori}`, once: { ad: once.ad } });
    return marka(kategori);
  }
  const ad = String(g.ad ?? '').trim();
  if (ad.length < 2 || ad.length > 40 || /[\u0000-\u001f<>]/.test(ad)) throw new OyunHatasi(400, 'Ad 2–40 karakter olmalı');
  const slogan = g.slogan == null ? null : String(g.slogan).trim().slice(0, 80);
  if (slogan && /[<>]/.test(slogan)) throw new OyunHatasi(400, 'Slogan geçersiz karakter içeriyor');
  const ikon = g.ikon == null || g.ikon === '' ? null : String(g.ikon).trim();
  if (ikon && ([...ikon].length > 4 || /[\w<>]/.test(ikon))) throw new OyunHatasi(400, 'Simge tek bir emoji olmalı');
  for (const k of ['renk', 'renk2']) if (g[k] != null && g[k] !== '' && !RENK.test(g[k])) throw new OyunHatasi(400, 'Renk #RRGGBB biçiminde olmalı');
  let logo = null;
  if (g.logo) {
    const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(g.logo));
    if (!m) throw new OyunHatasi(400, 'Logo PNG, JPEG ya da WebP olmalı');
    if (Math.floor((m[2].length * 3) / 4) > CARSI.logoMaksBayt) throw new OyunHatasi(413, `Logo en çok ${Math.round(CARSI.logoMaksBayt / 1000)} KB olabilir`);
    logo = g.logo;
  }
  let web = null;
  if (g.web) {
    try { const u = new URL(String(g.web)); if (u.protocol !== 'https:' || String(g.web).length > 200) throw new Error(); web = u.href; }
    catch { throw new OyunHatasi(400, 'Web adresi https:// ile başlamalı'); }
  }
  const bas = tarih(g.sozlesmeBas, 'Sözleşme başlangıcı'), bit = tarih(g.sozlesmeBit, 'Sözleşme bitişi');
  if (bas && bit && bit <= bas) throw new OyunHatasi(400, 'Sözleşme bitişi başlangıçtan sonra olmalı');
  db.prepare(`INSERT INTO isletmeler (kategori, ad, ikon, logo, renk, renk2, slogan, web, sponsor, sozlesme_bas, sozlesme_bit, guncelleyen, guncellendi)
              VALUES (@kategori, @ad, @ikon, @logo, @renk, @renk2, @slogan, @web, @sponsor, @bas, @bit, @yon, @t)
              ON CONFLICT(kategori) DO UPDATE SET ad = excluded.ad, ikon = excluded.ikon, logo = excluded.logo, renk = excluded.renk, renk2 = excluded.renk2,
                slogan = excluded.slogan, web = excluded.web, sponsor = excluded.sponsor, sozlesme_bas = excluded.sozlesme_bas, sozlesme_bit = excluded.sozlesme_bit,
                guncelleyen = excluded.guncelleyen, guncellendi = excluded.guncellendi`)
    .run({ kategori, ad, ikon, logo, renk: g.renk || null, renk2: g.renk2 || null, slogan, web, sponsor: g.sponsor ? 1 : 0, bas, bit, yon: yoneticiId, t: simdi() });
  L.denetim({ aktor: yoneticiId, eylem: 'BUSINESS_BRAND_UPDATED', varlik: `ISLETME:${kategori}`, once: { ad: once.ad, sponsor: once.sponsor },
    sonra: { ad, sponsor: !!g.sponsor, sozlesmeBas: g.sozlesmeBas || null, sozlesmeBit: g.sozlesmeBit || null, logo: !!logo } });
  return marka(kategori);
}
function yonetimListesi() {
  return Object.entries(CARSI.kategoriler).map(([k, v]) => {
    const r = db.prepare(`SELECT * FROM isletmeler WHERE kategori = ?`).get(k);
    return { kategori: k, tur: v.tur, varsayilan: { ad: v.ad, ikon: v.ikon, renk: v.renk, renk2: v.renk2, slogan: v.slogan }, kayit: r || null, gorunen: marka(k),
      gercekSube: db.prepare(`SELECT COUNT(*) c FROM subeler WHERE kategori = ?`).get(k).c };
  });
}

// ---------- Şubeler: gerçek şube listesi yüklenene kadar her il merkezinde bir şube (türlere göre küçük kaydırma)
const KAYMA = { BANKA: [0.006, 0.004], NALBUR: [-0.006, 0.004], MARKET: [0.006, -0.004], ZIRAI: [-0.006, -0.004] };
let ilMerkezleri = null;
function subeler() {
  ilMerkezleri ??= (() => {
    // Şehir merkezi (il başkenti); nokta kendi il sınırında değilse ilin coğrafi ortası
    const M = require('./harita/il-merkezleri'), { ilceBul } = require('./harita/sinirlar');
    return db.prepare(`SELECT plaka, name, center_lon AS lon, center_lat AS lat FROM regions WHERE type = 'IL' ORDER BY plaka`).all().map((il) => {
      const m = M[il.plaka];
      return m && ilceBul(m[0], m[1])?.plaka === il.plaka ? { ...il, lon: m[0], lat: m[1] } : il;
    });
  })();
  const liste = [];
  for (const m of markalar()) {
    const gercek = db.prepare(`SELECT ad, lon, lat FROM subeler WHERE kategori = ?`).all(m.kategori);
    const kaynak = gercek.length ? gercek : ilMerkezleri.map((il) => ({ ad: `${il.name} şubesi`, lon: il.lon + KAYMA[m.kategori][0], lat: il.lat + KAYMA[m.kategori][1] }));
    for (const s of kaynak) liste.push({ kategori: m.kategori, ad: `${m.ad} · ${s.ad}`, lon: s.lon, lat: s.lat, ikon: m.ikon });
  }
  return liste;
}
// Yönetici: sponsorun gerçek şubelerini yükle (boş liste = il merkezlerine dön)
function subeYukle(yoneticiId, kategori, liste) {
  if (!bul(CARSI.kategoriler, kategori)) throw new OyunHatasi(404, 'Böyle bir işletme türü yok');
  if (!Array.isArray(liste) || liste.length > 5000) throw new OyunHatasi(400, 'En çok 5000 şube');
  const temiz = liste.map((s, i) => {
    const ad = String(s?.ad ?? '').trim(), lon = Number(s?.lon), lat = Number(s?.lat);
    if (!ad || ad.length > 60 || /[<>]/.test(ad) || !(lon >= 25 && lon <= 45.5) || !(lat >= 35.5 && lat <= 42.5)) throw new OyunHatasi(400, `${i + 1}. şube geçersiz (ad, Türkiye içinde konum)`);
    return { ad, lon, lat };
  });
  db.transaction(() => {
    db.prepare(`DELETE FROM subeler WHERE kategori = ?`).run(kategori);
    const ekle = db.prepare(`INSERT INTO subeler (kategori, ad, lon, lat) VALUES (?, ?, ?, ?)`);
    for (const s of temiz) ekle.run(kategori, s.ad, s.lon, s.lat);
  })();
  L.denetim({ aktor: yoneticiId, eylem: 'BUSINESS_BRANCHES_UPDATED', varlik: `ISLETME:${kategori}`, sonra: { adet: temiz.length } });
  return { tamam: true, adet: temiz.length };
}

// ---------- Dükkân: satın alma ve kullanma
function vitrin(userId, kategori) {
  if (!bul(CARSI.kategoriler, kategori)) throw new OyunHatasi(404, 'Böyle bir işletme yok');
  const m = marka(kategori);
  const urunler = Object.entries(CARSI.urunler).filter(([, u]) => u.dukkan === kategori).map(([kod, u]) => ({
    kod, ad: u.ad, ikon: u.ikon, fiyat: u.fiyat, etki: u.etki, kalici: !!u.kalici, kullan: u.kullan || null,
    eldeki: userId ? (u.verir ? Object.entries(u.verir).map(([k]) => L.envanterMiktar(userId, k))[0] : L.envanterMiktar(userId, kod)) : 0,
  }));
  return { marka: m, urunler };
}
const satinAl = db.transaction((userId, kod, adet = 1) => {
  require('./ciftlik').seviyeKilidi(userId, 'carsi');
  const u = bul(CARSI.urunler, kod);
  if (!u) throw new OyunHatasi(400, 'Bu ürün satılmıyor');
  adet = Number(adet);
  if (!Number.isInteger(adet) || adet < 1 || adet > 20) throw new OyunHatasi(400, 'Adet 1–20 olmalı');
  if (u.kalici && (adet > 1 || L.envanterMiktar(userId, kod) > 0)) throw new OyunHatasi(409, `${u.ad} zaten sende; kalıcı ürünler bir kez alınır`);
  const m = marka(u.dukkan), tutar = u.fiyat * adet, tx = L.yeniTx();
  L.aktar({ kaynak: L.hesap(userId), hedef: `ISLETME:${u.dukkan}`, tutar, sebep: `${m.ad}: ${adet} × ${u.ad}`, tx });
  if (u.verir) for (const [k, n] of Object.entries(u.verir)) L.envanterDegis(userId, k, n * adet, `${m.ad}: ${u.ad}`, tx);
  else L.envanterDegis(userId, kod, adet, `${m.ad}: ${u.ad}`, tx);
  L.denetim({ aktor: userId, eylem: 'SHOP_PURCHASE', varlik: `ISLETME:${u.dukkan}`, sonra: { urun: kod, adet, tutar, marka: m.ad } });
  return { tamam: true, urun: kod, adet, tutar, marka: m.ad };
});
const kullan = db.transaction((userId, { urun, parselId, yapiId } = {}) => {
  const u = bul(CARSI.urunler, urun);
  if (!u?.kullan) throw new OyunHatasi(400, 'Bu ürün doğrudan kullanılmaz');
  if (L.envanterMiktar(userId, urun) < 1) throw new OyunHatasi(409, `Envanterinde ${u.ad} yok; ${marka(u.dukkan).ad}'dan alabilirsin`);
  const oyun = require('./oyun'), t = simdi();
  if (u.kullan === 'EKIN') {
    const p = oyun.parselGetir(String(parselId || ''));
    require('./kira').kullanimHakki(p, userId);
    const e = db.prepare(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(p.id);
    if (!e) throw new OyunHatasi(409, 'Bu tarlada ekin yok');
    const kolonAd = urun === 'GUBRE' ? 'gubre' : 'ilac';
    if (e[kolonAd]) throw new OyunHatasi(409, `Bu ekine zaten ${u.ad.toLocaleLowerCase('tr-TR')} verildi`);
    if (urun === 'GUBRE' && t >= e.ready_at) throw new OyunHatasi(409, 'Ekin olgunlaşmış; gübre artık işe yaramaz');
    db.prepare(`UPDATE crops SET ${kolonAd} = 1 WHERE id = ?`).run(e.id);
    L.envanterDegis(userId, urun, -1, `${u.ad}: ${p.id}`);
    L.denetim({ aktor: userId, eylem: 'SHOP_ITEM_USED', varlik: p.id, sonra: { urun }, bolge: p.region_id });
    return { tamam: true, urun, parsel: p.id };
  }
  const s = db.prepare(`SELECT * FROM structures WHERE id = ?`).get(Number(yapiId));
  if (!s || !HAYVANLAR[s.type]) throw new OyunHatasi(404, 'Barınak bulunamadı');
  const p = oyun.parselGetir(s.parcel_id);
  oyun.sahibiOlmali(p, userId);
  if (s.asi_bitis && s.asi_bitis > t) throw new OyunHatasi(409, 'Bu barınaktaki hayvanlar zaten aşılı');
  db.prepare(`UPDATE structures SET asi_bitis = ? WHERE id = ?`).run(t + CARSI.etki.asiSureMs, s.id);
  L.envanterDegis(userId, urun, -1, `${u.ad}: barınak ${s.id}`);
  L.denetim({ aktor: userId, eylem: 'SHOP_ITEM_USED', varlik: p.id, sonra: { urun, yapi: s.id }, bolge: p.region_id });
  return { tamam: true, urun, yapi: s.id, bitis: t + CARSI.etki.asiSureMs };
});
// Diğer modüllerin kullandığı: elde varsa bir adet harca (true döner)
function stoktanKullan(userId, urun, sebep, tx) {
  if (L.envanterMiktar(userId, urun) < 1) return false;
  L.envanterDegis(userId, urun, -1, sebep, tx);
  return true;
}
const sahip = (userId, urun) => !!userId && L.envanterMiktar(userId, urun) > 0;

// ---------- Banka
const B = CARSI.banka;
function bankaOzet(userId, t = simdi()) {
  const vadeliler = db.prepare(`SELECT * FROM banka_vadeli WHERE user_id = ? ORDER BY durum = 'ACIK' DESC, id DESC LIMIT 12`).all(userId)
    .map((v) => ({ id: v.id, tutar: v.tutar, faiz: v.faiz, getiri: L.yuvarla(v.tutar * v.faiz), bas: v.bas, vade: v.vade, durum: v.durum, vadeDoldu: t >= v.vade }));
  const acikVadeli = vadeliler.filter((v) => v.durum === 'ACIK').reduce((a, v) => a + v.tutar, 0);
  return {
    marka: marka('BANKA'), bakiye: L.bakiye(userId), vadeliler, acikVadeli,
    kurallar: { ...B }, uyari: 'Akçe nakde çevrilemez; bu bir oyun içi hizmettir, gerçek bankacılık ya da yatırım hizmeti değildir.',
  };
}
const vadeliAc = db.transaction((userId, tutar) => {
  require('./ciftlik').seviyeKilidi(userId, 'carsi');
  tutar = Number(tutar);
  if (!Number.isInteger(tutar) || tutar < B.vadeliMin) throw new OyunHatasi(400, `Vadeli hesap en az ${B.vadeliMin} akçe`);
  const acik = db.prepare(`SELECT COALESCE(SUM(tutar), 0) s FROM banka_vadeli WHERE user_id = ? AND durum = 'ACIK'`).get(userId).s;
  if (acik + tutar > B.vadeliMaks) throw new OyunHatasi(409, `Vadeli hesaplarının toplamı en çok ${B.vadeliMaks} akçe olabilir`);
  const t = simdi(), tx = L.yeniTx();
  L.aktar({ kaynak: L.hesap(userId), hedef: `BANKA:VADELI:${userId}`, tutar, sebep: `${marka('BANKA').ad}: ${B.vadeliGun} günlük vadeli hesap`, tx });
  const id = db.prepare(`INSERT INTO banka_vadeli (user_id, tutar, faiz, bas, vade) VALUES (?, ?, ?, ?, ?)`).run(userId, tutar, B.vadeliFaiz, t, t + B.vadeliGun * GUN).lastInsertRowid;
  L.denetim({ aktor: userId, eylem: 'DEPOSIT_OPENED', varlik: `VADELI:${id}`, sonra: { tutar } });
  return { tamam: true, id, vade: t + B.vadeliGun * GUN, getiri: L.yuvarla(tutar * B.vadeliFaiz) };
});
const vadeliKapat = db.transaction((userId, id) => {
  const v = db.prepare(`SELECT * FROM banka_vadeli WHERE id = ? AND user_id = ?`).get(Number(id), userId);
  if (!v) throw new OyunHatasi(404, 'Vadeli hesap bulunamadı');
  if (v.durum !== 'ACIK') throw new OyunHatasi(409, 'Bu hesap kapandı');
  const t = simdi(), doldu = t >= v.vade, tx = L.yeniTx(), ad = marka('BANKA').ad;
  if (db.prepare(`UPDATE banka_vadeli SET durum = ?, kapandi_at = ? WHERE id = ? AND durum = 'ACIK'`).run(doldu ? 'KAPANDI' : 'BOZULDU', t, v.id).changes !== 1) throw new OyunHatasi(409, 'Eşzamanlı işlem');
  L.aktar({ kaynak: `BANKA:VADELI:${userId}`, hedef: L.hesap(userId), tutar: v.tutar, sebep: `${ad}: vadeli hesap ${doldu ? 'vadesi doldu' : 'bozduruldu'}`, tx });
  const faiz = doldu ? L.yuvarla(v.tutar * v.faiz) : 0;
  if (faiz > 0) L.odul(userId, faiz, `${ad}: vadeli hesap getirisi`, tx);
  L.denetim({ aktor: userId, eylem: doldu ? 'DEPOSIT_MATURED' : 'DEPOSIT_BROKEN', varlik: `VADELI:${v.id}`, sonra: { tutar: v.tutar, faiz } });
  return { tamam: true, anapara: v.tutar, faiz, bozuldu: !doldu };
});
function rotalar(app, { h, auth }) {
  app.get('/api/carsi', h((req) => ({ isletmeler: markalar(), urunler: CARSI.urunler, sarf: CARSI.sarf })));
  app.get('/api/carsi/subeler', h(require('./lib/onbellek').ortakYanit(30_000, () => subeler())));
  app.get('/api/carsi/:kategori', h((req) => vitrin(req.kullanici?.id ?? null, String(req.params.kategori))));
  app.post('/api/carsi/satin-al', auth.girisGerekli, h((req) => satinAl(req.kullanici.id, String(req.body?.urun || ''), req.body?.adet ?? 1)));
  app.post('/api/carsi/kullan', auth.girisGerekli, h((req) => kullan(req.kullanici.id, req.body || {})));
  app.get('/api/banka', auth.girisGerekli, h((req) => bankaOzet(req.kullanici.id)));
  app.post('/api/banka/vadeli', auth.dogrulanmisGerekli, h((req) => vadeliAc(req.kullanici.id, req.body?.tutar)));
  app.post('/api/banka/vadeli/:id/kapat', auth.dogrulanmisGerekli, h((req) => vadeliKapat(req.kullanici.id, req.params.id)));
  app.get('/api/yonetim/isletmeler', auth.rolGerekli('ADMIN'), h(() => yonetimListesi()));
  app.put('/api/yonetim/isletme/:kategori', auth.rolGerekli('ADMIN'), h((req) => markaGuncelle(req.kullanici.id, String(req.params.kategori), req.body || {})));
  app.put('/api/yonetim/isletme/:kategori/subeler', auth.rolGerekli('ADMIN'), h((req) => subeYukle(req.kullanici.id, String(req.params.kategori), req.body?.subeler)));
}

module.exports = { rotalar, marka, markalar, markaGuncelle, subeler, subeYukle, vitrin, satinAl, kullan, stoktanKullan, sahip,
  bankaOzet, vadeliAc, vadeliKapat };
