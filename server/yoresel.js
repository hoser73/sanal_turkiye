// Coğrafi işaretli (yöresel) ürünler: her ürün yalnızca kendi ilinde parseli olan oyuncu tarafından üretilir (günde bir parti;
// girdi yöre ürünü ya da akçe). Ürünler albüme konur (koleksiyon ödülü; coğrafi bölge tamamlanınca ek ödül) ya da borsada,
// arkadaşa gönderilerek başka illerin oyuncularıyla takas edilir. Üretim hasat yarışına puan yazar (GI_PRODUCED).
const db = require('./db');
const L = require('./lib/ledger');
const { YORESEL, YORESEL_KURAL, URUNLER } = require('./config/rules');
const { OyunHatasi } = L;

db.exec(`
CREATE TABLE IF NOT EXISTS yoresel_uretim (
  user_id INTEGER NOT NULL REFERENCES users(id),
  urun    TEXT NOT NULL,
  gun     TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, urun, gun)
);
CREATE TABLE IF NOT EXISTS yoresel_album (
  user_id INTEGER NOT NULL REFERENCES users(id),
  urun    TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (user_id, urun)
);
CREATE TABLE IF NOT EXISTS yoresel_bolge_odul (
  user_id INTEGER NOT NULL REFERENCES users(id),
  bolge   TEXT NOT NULL,
  PRIMARY KEY (user_id, bolge)
);
`);

const gun = (t = Date.now()) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
const BOLGELER = [...new Set(Object.values(YORESEL).map((y) => y.bolge))];
const ilAdi = (plaka) => db.prepare(`SELECT name FROM regions WHERE type = 'IL' AND plaka = ?`).get(plaka)?.name || plaka;

function ildekiParsel(userId, plaka) {
  return db.prepare(`SELECT p.id, p.region_id FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ? AND r.plaka = ? AND p.status = 'ACTIVE' LIMIT 1`).get(userId, plaka);
}

function durum(userId) {
  const g = gun();
  const albumde = new Set(db.prepare(`SELECT urun FROM yoresel_album WHERE user_id = ?`).all(userId).map((r) => r.urun));
  const bugun = new Set(db.prepare(`SELECT urun FROM yoresel_uretim WHERE user_id = ? AND gun = ?`).all(userId, g).map((r) => r.urun));
  const bolgeOdul = new Set(db.prepare(`SELECT bolge FROM yoresel_bolge_odul WHERE user_id = ?`).all(userId).map((r) => r.bolge));
  const iller = new Set(db.prepare(`SELECT DISTINCT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ?`).all(userId).map((r) => r.plaka));
  const urunler = Object.entries(YORESEL).map(([kod, y]) => ({
    kod, ad: y.ad, ikon: y.ikon, il: y.il, ilAd: ilAdi(y.il), bolge: y.bolge,
    girdi: Object.entries(y.girdi || {}).map(([u, n]) => ({ kod: u, ad: URUNLER[u].ad, ikon: URUNLER[u].ikon, adet: n, eldeki: L.envanterMiktar(userId, u) })),
    akce: y.akce || 0, eldeki: L.envanterMiktar(userId, kod), albumde: albumde.has(kod),
    uretebilir: iller.has(y.il), bugunUretildi: bugun.has(kod),
  }));
  const bolgeler = BOLGELER.map((b) => {
    const u = urunler.filter((x) => x.bolge === b);
    return { ad: b, toplam: u.length, albumde: u.filter((x) => x.albumde).length, odulAlindi: bolgeOdul.has(b) };
  });
  return { urunler, bolgeler, kural: YORESEL_KURAL, albumToplam: albumde.size };
}

const uret = db.transaction((userId, kod) => {
  const y = Object.hasOwn(YORESEL, String(kod)) ? YORESEL[kod] : null;
  if (!y) throw new OyunHatasi(400, 'Bilinmeyen yöresel ürün');
  const p = ildekiParsel(userId, y.il);
  if (!p) throw new OyunHatasi(403, `${y.ad} yalnızca ${ilAdi(y.il)} ilinde parseli olanlar tarafından üretilir`);
  const g = gun();
  if (db.prepare(`SELECT 1 FROM yoresel_uretim WHERE user_id = ? AND urun = ? AND gun = ?`).get(userId, kod, g)) throw new OyunHatasi(409, 'Bugünün partisini ürettin; yarın yine gel');
  require('./ekonomi').envanterBozulmasi(userId);
  const tx = L.yeniTx();
  for (const [u, n] of Object.entries(y.girdi || {})) L.envanterDegis(userId, u, -n, `Yöresel üretim: ${y.ad}`, tx);
  if (y.akce) L.harca(userId, y.akce, `Yöresel üretim: ${y.ad}`, tx);
  L.envanterDegis(userId, kod, YORESEL_KURAL.partiCikti, `Yöresel üretim: ${y.ad}`, tx);
  db.prepare(`INSERT INTO yoresel_uretim (user_id, urun, gun, at) VALUES (?, ?, ?, ?)`).run(userId, kod, g, Date.now());
  L.denetim({ aktor: userId, eylem: 'GI_PRODUCED', varlik: p.id, sonra: { urun: kod, adet: YORESEL_KURAL.partiCikti }, bolge: p.region_id, herkese: true });
  return { tamam: true, urun: kod, adet: YORESEL_KURAL.partiCikti };
});

const albumeEkle = db.transaction((userId, kod) => {
  const y = Object.hasOwn(YORESEL, String(kod)) ? YORESEL[kod] : null;
  if (!y) throw new OyunHatasi(400, 'Bilinmeyen yöresel ürün');
  if (db.prepare(`SELECT 1 FROM yoresel_album WHERE user_id = ? AND urun = ?`).get(userId, kod)) throw new OyunHatasi(409, 'Bu ürün albümünde zaten var');
  L.envanterDegis(userId, kod, -1, `Albüme eklendi: ${y.ad}`);
  db.prepare(`INSERT INTO yoresel_album (user_id, urun, at) VALUES (?, ?, ?)`).run(userId, kod, Date.now());
  L.odul(userId, YORESEL_KURAL.albumOdul, `Yöresel albüm: ${y.ad}`);
  require('./ciftlik').tpEkle(userId, YORESEL_KURAL.albumTp, 'GI_ALBUM');
  // Bölge tamamlandı mı?
  const bolgeUrunleri = Object.entries(YORESEL).filter(([, x]) => x.bolge === y.bolge).map(([k]) => k);
  const tamam = bolgeUrunleri.every((k) => db.prepare(`SELECT 1 FROM yoresel_album WHERE user_id = ? AND urun = ?`).get(userId, k));
  let bolgeOdulu = 0;
  if (tamam && !db.prepare(`SELECT 1 FROM yoresel_bolge_odul WHERE user_id = ? AND bolge = ?`).get(userId, y.bolge)) {
    db.prepare(`INSERT INTO yoresel_bolge_odul (user_id, bolge) VALUES (?, ?)`).run(userId, y.bolge);
    L.odul(userId, YORESEL_KURAL.bolgeOdul, `Yöresel albüm: ${y.bolge} tamamlandı`);
    bolgeOdulu = YORESEL_KURAL.bolgeOdul;
  }
  L.denetim({ aktor: userId, eylem: 'GI_COLLECTED', sonra: { urun: kod, bolge: tamam ? y.bolge : null } });
  return { tamam: true, odul: YORESEL_KURAL.albumOdul, bolgeTamam: tamam ? y.bolge : null, bolgeOdulu };
});

function rotalar(app, { h, auth }) {
  app.get('/api/yoresel', auth.girisGerekli, h((req) => durum(req.kullanici.id)));
  app.post('/api/yoresel/:kod/uret', auth.girisGerekli, h((req) => uret(req.kullanici.id, req.params.kod)));
  app.post('/api/yoresel/:kod/album', auth.girisGerekli, h((req) => albumeEkle(req.kullanici.id, req.params.kod)));
}

module.exports = { rotalar, durum, uret, albumeEkle };
