// Coğrafi işaretli (yöresel) ürünler: her ürün yalnızca kendi ilinde parseli olan oyuncu tarafından üretilir (günde bir parti;
// girdi yöre ürünü ya da akçe). Ürünler albüme konur (koleksiyon ödülü; coğrafi bölge tamamlanınca ek ödül) ya da borsada,
// arkadaşa gönderilerek başka illerin oyuncularıyla takas edilir. Üretim il ligine puan yazar.
const db = require('./db');
const L = require('./lib/ledger');
const { YORESEL, YORESEL_KURAL, URUNLER } = require('./config/rules');
const { OyunHatasi } = L;


const gun = (t = Date.now()) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
const BOLGELER = [...new Set(Object.values(YORESEL).map((y) => y.bolge))];
const ilAdi = async (plaka) => (await db.get(`SELECT name FROM regions WHERE type = 'IL' AND plaka = ?`, plaka))?.name || plaka;

function ildekiParsel(userId, plaka) {
  return db.get(`SELECT p.id, p.region_id FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ? AND r.plaka = ? AND p.status = 'ACTIVE' ORDER BY p.id LIMIT 1`, userId, plaka);
}

async function durum(userId) {
  const g = gun();
  const albumde = new Set((await db.all(`SELECT urun FROM yoresel_album WHERE user_id = ?`, userId)).map((r) => r.urun));
  const bugun = new Set((await db.all(`SELECT urun FROM yoresel_uretim WHERE user_id = ? AND gun = ?`, userId, g)).map((r) => r.urun));
  const bolgeOdul = new Set((await db.all(`SELECT bolge FROM yoresel_bolge_odul WHERE user_id = ?`, userId)).map((r) => r.bolge));
  const iller = new Set((await db.all(`SELECT DISTINCT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ?`, userId)).map((r) => r.plaka));
  // İl adları ve stoklar önce toplanır (senkron eşlemede bekleme yapılmaz)
  const ilAdlari = new Map((await db.all(`SELECT plaka, name FROM regions WHERE type = 'IL'`)).map((r) => [r.plaka, r.name]));
  const stok = {};
  for (const i of await L.envanter(userId)) stok[i.item_id] = i.miktar;
  const urunler = Object.entries(YORESEL).map(([kod, y]) => ({
    kod, ad: y.ad, ikon: y.ikon, il: y.il, ilAd: ilAdlari.get(y.il) || y.il, bolge: y.bolge,
    girdi: Object.entries(y.girdi || {}).map(([u, n]) => ({ kod: u, ad: URUNLER[u].ad, ikon: URUNLER[u].ikon, adet: n, eldeki: stok[u] || 0 })),
    akce: y.akce || 0, eldeki: stok[kod] || 0, albumde: albumde.has(kod),
    uretebilir: iller.has(y.il), bugunUretildi: bugun.has(kod),
  }));
  const bolgeler = BOLGELER.map((b) => {
    const u = urunler.filter((x) => x.bolge === b);
    return { ad: b, toplam: u.length, albumde: u.filter((x) => x.albumde).length, odulAlindi: bolgeOdul.has(b) };
  });
  return { urunler, bolgeler, kural: YORESEL_KURAL, albumToplam: albumde.size };
}

const uret = (userId, kod) => db.tx(async () => {
  const y = Object.hasOwn(YORESEL, String(kod)) ? YORESEL[kod] : null;
  if (!y) throw new OyunHatasi(400, 'Bilinmeyen yöresel ürün');
  const p = await ildekiParsel(userId, y.il);
  if (!p) throw new OyunHatasi(403, `${y.ad} yalnızca ${await ilAdi(y.il)} ilinde parseli olanlar tarafından üretilir`);
  const g = gun();
  if (await db.get(`SELECT 1 FROM yoresel_uretim WHERE user_id = ? AND urun = ? AND gun = ?`, userId, kod, g)) throw new OyunHatasi(409, 'Bugünün partisini ürettin; yarın yine gel');
  // Birincil anahtar (oyuncu, ürün, gün): eşzamanlı ikinci parti satır yazamaz ve geri alınır
  if ((await db.run(`INSERT OR IGNORE INTO yoresel_uretim (user_id, urun, gun, at) VALUES (?, ?, ?, ?)`, userId, kod, g, Date.now())).changes !== 1) {
    throw new OyunHatasi(409, 'Bugünün partisini ürettin; yarın yine gel');
  }
  await require('./ekonomi').envanterBozulmasi(userId);
  const tx = L.yeniTx();
  for (const [u, n] of Object.entries(y.girdi || {})) await L.envanterDegis(userId, u, -n, `Yöresel üretim: ${y.ad}`, tx);
  if (y.akce) await L.harca(userId, y.akce, `Yöresel üretim: ${y.ad}`, tx);
  await L.envanterDegis(userId, kod, YORESEL_KURAL.partiCikti, `Yöresel üretim: ${y.ad}`, tx);
  await L.denetim({ aktor: userId, eylem: 'GI_PRODUCED', varlik: p.id, sonra: { urun: kod, adet: YORESEL_KURAL.partiCikti }, bolge: p.region_id, herkese: true });
  return { tamam: true, urun: kod, adet: YORESEL_KURAL.partiCikti };
});

const albumeEkle = (userId, kod) => db.tx(async () => {
  const y = Object.hasOwn(YORESEL, String(kod)) ? YORESEL[kod] : null;
  if (!y) throw new OyunHatasi(400, 'Bilinmeyen yöresel ürün');
  if (await db.get(`SELECT 1 FROM yoresel_album WHERE user_id = ? AND urun = ?`, userId, kod)) throw new OyunHatasi(409, 'Bu ürün albümünde zaten var');
  await L.envanterDegis(userId, kod, -1, `Albüme eklendi: ${y.ad}`);
  // Birincil anahtar (oyuncu, ürün): eşzamanlı ikinci ekleme satır yazamaz ve geri alınır
  if ((await db.run(`INSERT OR IGNORE INTO yoresel_album (user_id, urun, at) VALUES (?, ?, ?)`, userId, kod, Date.now())).changes !== 1) {
    throw new OyunHatasi(409, 'Bu ürün albümünde zaten var');
  }
  await L.odul(userId, YORESEL_KURAL.albumOdul, `Yöresel albüm: ${y.ad}`);
  await require('./ciftlik').tpEkle(userId, YORESEL_KURAL.albumTp, 'GI_ALBUM');
  // Bölge tamamlandı mı?
  const bolgeUrunleri = Object.entries(YORESEL).filter(([, x]) => x.bolge === y.bolge).map(([k]) => k);
  const albumde = new Set((await db.all(`SELECT urun FROM yoresel_album WHERE user_id = ?`, userId)).map((r) => r.urun));
  const tamam = bolgeUrunleri.every((k) => albumde.has(k));
  let bolgeOdulu = 0;
  // Birincil anahtar (oyuncu, bölge): bölge ödülü yalnızca gerçekten yazılan satır için bir kez ödenir
  if (tamam && (await db.run(`INSERT OR IGNORE INTO yoresel_bolge_odul (user_id, bolge) VALUES (?, ?)`, userId, y.bolge)).changes === 1) {
    await L.odul(userId, YORESEL_KURAL.bolgeOdul, `Yöresel albüm: ${y.bolge} tamamlandı`);
    bolgeOdulu = YORESEL_KURAL.bolgeOdul;
  }
  await L.denetim({ aktor: userId, eylem: 'GI_COLLECTED', sonra: { urun: kod, bolge: tamam ? y.bolge : null } });
  return { tamam: true, odul: YORESEL_KURAL.albumOdul, bolgeTamam: tamam ? y.bolge : null, bolgeOdulu };
});

function rotalar(app, { h, auth }) {
  app.get('/api/yoresel', auth.girisGerekli, h((req) => durum(req.kullanici.id)));
  app.post('/api/yoresel/:kod/uret', auth.girisGerekli, h((req) => uret(req.kullanici.id, req.params.kod)));
  app.post('/api/yoresel/:kod/album', auth.girisGerekli, h((req) => albumeEkle(req.kullanici.id, req.params.kod)));
}

module.exports = { rotalar, durum, uret, albumeEkle };
