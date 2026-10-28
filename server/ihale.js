// Haftalık arazi ihalesi: her hafta (LIG.baslangic takvimi) sıradaki yöre setinin (KOLEKSIYON.setler, haftaya göre döner)
// her ilinde il merkezine yakın boş bir tarım hücresi açık artırmaya çıkar. İhaledeki tarla olağan yoldan edinilemez
// (oyun.parselEdin). Taban: tahsis bedelinin IHALE.tabanOrani'sı. Teklif akçesi emanete (IHALE:<id>) geçer; geçilen teklif
// ve oyuncunun eski teklifi iade edilir; yeni teklif en az IHALE.artis kadar yüksek olmalı. Pazar günü TR 21.00'de
// biter: en yüksek teklifi veren tarlayı olağan tahsisle alır, ödeme emanetten yapılır. Önde olunan ihaleler parsel
// sınırına sayıldığından lider bitişte sınırda kalamaz; yine de tahsis olmazsa ihale satılmadan kapanır ve akçe iade edilir. Hafta ilk açıldığında ihaleler kurulur (hücre arama eşzamansızdır).
const db = require('./db');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { IHALE: I, KOLEKSIYON, LIG, HESAP } = require('./config/rules');

db.exec(`
CREATE TABLE IF NOT EXISTS ihaleler (
  id INTEGER PRIMARY KEY, hafta INTEGER NOT NULL, parcel_id TEXT NOT NULL REFERENCES parcels(id), set_kod TEXT, taban INTEGER NOT NULL,
  bitis INTEGER NOT NULL, durum TEXT NOT NULL DEFAULT 'ACIK',   -- ACIK / SATILDI / SATILMADI
  kazanan INTEGER, fiyat INTEGER
);
CREATE INDEX IF NOT EXISTS ix_ihale_parsel ON ihaleler(parcel_id, durum);
CREATE TABLE IF NOT EXISTS ihale_teklifleri (
  id INTEGER PRIMARY KEY, ihale_id INTEGER NOT NULL REFERENCES ihaleler(id), user_id INTEGER NOT NULL REFERENCES users(id),
  tutar INTEGER NOT NULL, durum TEXT NOT NULL DEFAULT 'AKTIF', at INTEGER NOT NULL   -- AKTIF / IADE / KAZANDI
);
CREATE INDEX IF NOT EXISTS ix_ihale_teklif ON ihale_teklifleri(ihale_id, durum);
CREATE TABLE IF NOT EXISTS ihale_haftalari (hafta INTEGER PRIMARY KEY, kuruldu_at INTEGER NOT NULL);
`);

const HAFTA = 7 * 86_400_000;
const haftaNo = (t = Date.now()) => Math.floor((t - LIG.baslangic) / HAFTA);
const bitisi = (h) => LIG.baslangic + (h + 1) * HAFTA - I.bitisOncesiMs;   // pazar TR 21.00
const emanet = (id) => `IHALE:${id}`;
const setKodu = (h) => Object.keys(KOLEKSIYON.setler)[((h % Object.keys(KOLEKSIYON.setler).length) + Object.keys(KOLEKSIYON.setler).length) % Object.keys(KOLEKSIYON.setler).length];
const q = {
  acikParsel: db.prepare(`SELECT 1 FROM ihaleler WHERE parcel_id = ? AND durum = 'ACIK' LIMIT 1`),
  ihale: db.prepare('SELECT * FROM ihaleler WHERE id = ?'),
  enYuksek: db.prepare(`SELECT * FROM ihale_teklifleri WHERE ihale_id = ? AND durum = 'AKTIF' ORDER BY tutar DESC, at LIMIT 1`),
  aktifler: db.prepare(`SELECT * FROM ihale_teklifleri WHERE ihale_id = ? AND durum = 'AKTIF' ORDER BY tutar DESC, at`),
  benim: db.prepare(`SELECT * FROM ihale_teklifleri WHERE ihale_id = ? AND user_id = ? AND durum = 'AKTIF'`),
  iade: db.prepare(`UPDATE ihale_teklifleri SET durum = 'IADE' WHERE id = ?`),
};
const ihaledeMi = (parcelId) => !!q.acikParsel.get(parcelId);
// Oyuncunun önde olduğu açık ihaleler (geçilen teklif hemen iade edildiğinden ihalede tek aktif teklif vardır).
// Parsel sınırına sayılır: önde olan oyuncu ihale biterken sınırda kalıp tarlayı alamaz hâle gelmesin
// (yoksa ihale satılmadan kapanır; ihaleyi kilitleyip son anda başka parsel almak satışı boşa çıkarırdı).
const q2 = {
  onde: db.prepare(`SELECT i.id, p.region_id FROM ihale_teklifleri t JOIN ihaleler i ON i.id = t.ihale_id JOIN parcels p ON p.id = i.parcel_id
                    WHERE t.user_id = ? AND t.durum = 'AKTIF' AND i.durum = 'ACIK'`),
};
function ondeOlunan(userId, { haric = null, regionId = null } = {}) {
  return q2.onde.all(userId).filter((x) => x.id !== haric && (regionId == null || x.region_id === regionId)).length;
}
const bildir = (userId, m, link) => require('./pazar').bildir(userId, m, link);
const teklifIade = (tk, ihaleId, sebep, tx = L.yeniTx()) => {
  q.iade.run(tk.id);
  L.aktar({ kaynak: emanet(ihaleId), hedef: L.hesap(tk.user_id), tutar: tk.tutar, sebep, tx });
};

// Haftanın ihalelerini kur (bir kez): setin her ilinde il merkezine en yakın boş, sahipsiz tarım hücresi
let kurulum = null;
async function haftayiKur(h = haftaNo()) {
  if (db.prepare('SELECT 1 FROM ihale_haftalari WHERE hafta = ?').get(h)) return;
  if (kurulum) return kurulum;
  kurulum = (async () => {
    const { hucreAra, parselHazirla } = require('./harita/parsel');
    const IL_MERKEZ = require('./harita/il-merkezleri'), oyun = require('./oyun');
    const kod = setKodu(h), secilen = [];
    for (const plaka of KOLEKSIYON.setler[kod].iller.slice(0, I.adet)) {
      const merkez = IL_MERKEZ[plaka];
      if (!merkez) continue;
      const hucreler = await hucreAra(merkez[0], merkez[1], ['TARIM'], 6, 2, 40).catch(() => []);
      for (const hucre of hucreler) {
        const id = await parselHazirla(hucre).catch(() => null);
        if (!id) continue;
        const p = oyun.parselGetir(id);
        if (p.owner_user_id || p.zoning_type !== 'TARIM' || p.area_m2 > 25_000 || ihaledeMi(id)) continue;
        secilen.push({ id, taban: Math.max(1, Math.round(oyun.tahsisFiyati(p) * I.tabanOrani)) });
        break;
      }
    }
    db.transaction(() => {
      if (db.prepare('INSERT OR IGNORE INTO ihale_haftalari (hafta, kuruldu_at) VALUES (?, ?)').run(h, Date.now()).changes !== 1) return;
      for (const s of secilen) db.prepare('INSERT INTO ihaleler (hafta, parcel_id, set_kod, taban, bitis) VALUES (?, ?, ?, ?, ?)').run(h, s.id, kod, s.taban, bitisi(h));
    })();
  })().finally(() => { kurulum = null; });
  return kurulum;
}

const teklifVer = db.transaction((userId, ihaleId, govde = {}) => {
  const i = q.ihale.get(Number(ihaleId)), t = Date.now();
  if (!i) throw new OyunHatasi(404, 'İhale bulunamadı');
  if (i.durum !== 'ACIK' || t >= i.bitis) throw new OyunHatasi(409, 'Bu ihale bitti', 'BITTI');
  if (db.prepare('SELECT is_npc FROM users WHERE id = ?').get(userId)?.is_npc) throw new OyunHatasi(403, 'Demo hesaplar teklif veremez');
  const p = db.prepare('SELECT region_id FROM parcels WHERE id = ?').get(i.parcel_id);
  if (db.prepare('SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ?').get(userId).c + ondeOlunan(userId, { haric: i.id }) >= HESAP.maxParsel) {
    throw new OyunHatasi(409, `Hesap başına en fazla ${HESAP.maxParsel} parsel (önde olduğun ihaleler dahil); önce birini sat`, 'PARSEL_SINIRI');
  }
  if (db.prepare('SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ? AND region_id = ?').get(userId, p.region_id).c
      + ondeOlunan(userId, { haric: i.id, regionId: p.region_id }) >= HESAP.maxParselMahalle) {
    throw new OyunHatasi(409, `Bir mahallede en fazla ${HESAP.maxParselMahalle} parsel (önde olduğun ihaleler dahil)`, 'PARSEL_SINIRI');
  }
  const tutar = Number(govde.tutar);
  const ust = q.enYuksek.get(i.id);
  const asgari = ust ? Math.ceil(ust.tutar * (1 + I.artis)) : i.taban;
  if (!Number.isInteger(tutar) || tutar < asgari) throw new OyunHatasi(400, `En az ${asgari} akçe teklif vermelisin`, 'DUSUK');
  const tx = L.yeniTx(), eski = q.benim.get(i.id, userId);
  if (eski) teklifIade(eski, i.id, 'İhale teklifi yükseltildi (eski teklif iadesi)', tx);
  if (L.bakiye(userId) < tutar) throw new OyunHatasi(402, `Yetersiz bakiye: ${tutar} akçe gerekli`, 'YETERSIZ_BAKIYE');
  L.aktar({ kaynak: L.hesap(userId), hedef: emanet(i.id), tutar, sebep: `İhale teklifi ${i.parcel_id}`, tx });
  db.prepare('INSERT INTO ihale_teklifleri (ihale_id, user_id, tutar, at) VALUES (?, ?, ?, ?)').run(i.id, userId, tutar, t);
  // Geçilen (başkasının) en yüksek teklif hemen iade edilir
  if (ust && ust.user_id !== userId) {
    teklifIade(ust, i.id, 'İhalede teklifin geçildi (iade)', tx);
    bildir(ust.user_id, `🔨 İhalede teklifin geçildi: ${i.parcel_id} için yeni teklif ₳${tutar}. Akçen iade edildi.`, 'pazar:ihale');
  }
  L.denetim({ aktor: userId, eylem: 'AUCTION_BID', varlik: `IHALE:${i.id}`, sonra: { tutar } });
  return { tamam: true, tutar };
});

// Hesap silinirken: oyuncunun açık ihalelerdeki aktif teklifleri iade edilip kapanır (emanette akçe kalmasın)
const tekliflerIade = db.transaction((userId) => {
  const liste = db.prepare(`SELECT t.* FROM ihale_teklifleri t JOIN ihaleler i ON i.id = t.ihale_id
                            WHERE t.user_id = ? AND t.durum = 'AKTIF' AND i.durum = 'ACIK'`).all(userId);
  for (const tk of liste) teklifIade(tk, tk.ihale_id, 'İhale teklifi iadesi (hesap silindi)');
  return liste.length;
});

// Biten ihaleler: en yüksekten başlayarak parsel sınırı uygun ilk teklif kazanır; diğerleri iade.
// Hesabı silinmiş ya da askıdaki oyuncunun teklifi kazanamaz (iade edilir).
const sonuclandir = db.transaction((t = Date.now()) => {
  const oyun = require('./oyun');
  const aktifKullanici = db.prepare(`SELECT 1 FROM users WHERE id = ? AND status = 'ACTIVE' AND silindi_at IS NULL`);
  for (const i of db.prepare(`SELECT * FROM ihaleler WHERE durum = 'ACIK' AND bitis <= ?`).all(t)) {
    let kazanan = null;
    for (const tk of q.aktifler.all(i.id)) {
      if (!kazanan && aktifKullanici.get(tk.user_id)) {
        try {
          db.transaction(() => oyun.parselEdin(tk.user_id, i.parcel_id, { id: i.id, fiyat: tk.tutar, kaynak: emanet(i.id) }))();
          kazanan = tk;
          db.prepare(`UPDATE ihale_teklifleri SET durum = 'KAZANDI' WHERE id = ?`).run(tk.id);
          bildir(tk.user_id, `🔨 İhaleyi kazandın! ${i.parcel_id} artık senin (₳${tk.tutar}).`, `parsel:${i.parcel_id}`);
          continue;
        } catch { /* sınır vb.: sıradaki teklif */ }
      }
      teklifIade(tk, i.id, 'İhale sonuçlandı (iade)');
      if (kazanan) bildir(tk.user_id, `🔨 ${i.parcel_id} ihalesi bitti; kazanan teklif ₳${kazanan.tutar}. Akçen iade edildi.`, 'pazar:ihale');
    }
    db.prepare('UPDATE ihaleler SET durum = ?, kazanan = ?, fiyat = ? WHERE id = ?').run(kazanan ? 'SATILDI' : 'SATILMADI', kazanan?.user_id ?? null, kazanan?.tutar ?? null, i.id);
  }
});
let sonBakim = 0;
function ihaleBakim(t = Date.now()) {
  if (t - sonBakim < 60_000) return;
  sonBakim = t;
  sonuclandir(t);
}

async function liste(userId, t = Date.now()) {
  const h = haftaNo(t);
  await haftayiKur(h);
  sonuclandir(t);
  const oyun = require('./oyun'), set = KOLEKSIYON.setler[setKodu(h)];
  const ihaleler = db.prepare('SELECT * FROM ihaleler WHERE hafta = ? ORDER BY id').all(h).map((i) => {
    const k = oyun.parselKarti(i.parcel_id, userId, {}, { hafif: true }), ust = q.enYuksek.get(i.id), ben = userId ? q.benim.get(i.id, userId) : null;
    return { id: i.id, parsel: i.parcel_id, mahalle: k.mahalle, ilce: k.ilce, il: k.il, alan: k.alan, konum: k.konum, taban: i.taban,
      enYuksek: ust?.tutar ?? null, liderBen: !!ust && ust.user_id === userId, benimTeklif: ben?.tutar ?? null,
      asgari: ust ? Math.ceil(ust.tutar * (1 + I.artis)) : i.taban, teklifSayisi: q.aktifler.all(i.id).length,
      bitis: i.bitis, kalanMs: Math.max(0, i.bitis - t), durum: i.durum, fiyat: i.fiyat, kazandim: i.kazanan === userId };
  });
  return { hafta: h, set: { ad: set.ad, ikon: set.ikon }, ihaleler, tabanOrani: I.tabanOrani, artis: I.artis };
}

function rotalar(app, { h, auth }) {
  app.get('/api/ihale', h((req) => liste(req.kullanici?.id ?? null)));
  app.post('/api/ihale/:id/teklif', auth.dogrulanmisGerekli, h((req) => teklifVer(req.kullanici.id, req.params.id, req.body || {})));
}

module.exports = { rotalar, liste, teklifVer, sonuclandir, tekliflerIade, ihaleBakim, ihaledeMi, haftayiKur, haftaNo, ondeOlunan };
