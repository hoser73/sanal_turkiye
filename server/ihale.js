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


const HAFTA = 7 * 86_400_000;
const haftaNo = (t = Date.now()) => Math.floor((t - LIG.baslangic) / HAFTA);
const bitisi = (h) => LIG.baslangic + (h + 1) * HAFTA - I.bitisOncesiMs;   // pazar TR 21.00
const emanet = (id) => `IHALE:${id}`;
const setKodu = (h) => Object.keys(KOLEKSIYON.setler)[((h % Object.keys(KOLEKSIYON.setler).length) + Object.keys(KOLEKSIYON.setler).length) % Object.keys(KOLEKSIYON.setler).length];
const q = {
  acikParsel: db.sorgu(`SELECT 1 FROM ihaleler WHERE parcel_id = ? AND durum = 'ACIK' LIMIT 1`),
  ihale: db.sorgu('SELECT * FROM ihaleler WHERE id = ?'),
  // Teklif ve sonuçlandırma ihale satırını işlem sonuna kadar kilitler: en yüksek teklif ve iadeler sırayla işlenir
  ihaleKilitle: db.sorgu('SELECT * FROM ihaleler WHERE id = ? FOR UPDATE'),
  enYuksek: db.sorgu(`SELECT * FROM ihale_teklifleri WHERE ihale_id = ? AND durum = 'AKTIF' ORDER BY tutar DESC, at LIMIT 1`),
  aktifler: db.sorgu(`SELECT * FROM ihale_teklifleri WHERE ihale_id = ? AND durum = 'AKTIF' ORDER BY tutar DESC, at`),
  benim: db.sorgu(`SELECT * FROM ihale_teklifleri WHERE ihale_id = ? AND user_id = ? AND durum = 'AKTIF'`),
  // Koşullu yazma: aynı teklif iki kez iade edilmez
  iade: db.sorgu(`UPDATE ihale_teklifleri SET durum = 'IADE' WHERE id = ? AND durum = 'AKTIF'`),
};
const ihaledeMi = async (parcelId) => !!await q.acikParsel.get(parcelId);
// Oyuncunun önde olduğu açık ihaleler (geçilen teklif hemen iade edildiğinden ihalede tek aktif teklif vardır).
// Parsel sınırına sayılır: önde olan oyuncu ihale biterken sınırda kalıp tarlayı alamaz hâle gelmesin
// (yoksa ihale satılmadan kapanır; ihaleyi kilitleyip son anda başka parsel almak satışı boşa çıkarırdı).
const q2 = {
  onde: db.sorgu(`SELECT i.id, p.region_id FROM ihale_teklifleri t JOIN ihaleler i ON i.id = t.ihale_id JOIN parcels p ON p.id = i.parcel_id
                    WHERE t.user_id = ? AND t.durum = 'AKTIF' AND i.durum = 'ACIK'`),
};
async function ondeOlunan(userId, { haric = null, regionId = null } = {}) {
  return (await q2.onde.all(userId)).filter((x) => x.id !== haric && (regionId == null || x.region_id === regionId)).length;
}
const bildir = (userId, m, link) => require('./pazar').bildir(userId, m, link);
async function teklifIade(tk, ihaleId, sebep, tx = L.yeniTx()) {
  if ((await q.iade.run(tk.id)).changes !== 1) return false;
  await L.aktar({ kaynak: emanet(ihaleId), hedef: L.hesap(tk.user_id), tutar: tk.tutar, sebep, tx });
  return true;
}

// Haftanın ihalelerini kur (bir kez): setin her ilinde il merkezine en yakın boş, sahipsiz tarım hücresi
let kurulum = null;
async function haftayiKur(h = haftaNo()) {
  if (await db.get('SELECT 1 FROM ihale_haftalari WHERE hafta = ?', h)) return;
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
        const p = await oyun.parselGetir(id);
        if (p.owner_user_id || p.zoning_type !== 'TARIM' || p.area_m2 > 25_000 || await ihaledeMi(id)) continue;
        secilen.push({ id, taban: Math.max(1, Math.round(await oyun.tahsisFiyati(p) * I.tabanOrani)) });
        break;
      }
    }
    // Hafta kaydı koşullu: çok sunucuda aynı hafta iki kez kurulmaz
    await db.tx(async () => {
      if ((await db.run('INSERT OR IGNORE INTO ihale_haftalari (hafta, kuruldu_at) VALUES (?, ?)', h, Date.now())).changes !== 1) return;
      for (const s of secilen) await db.run('INSERT INTO ihaleler (hafta, parcel_id, set_kod, taban, bitis) VALUES (?, ?, ?, ?, ?)', h, s.id, kod, s.taban, bitisi(h));
    });
  })().finally(() => { kurulum = null; });
  return kurulum;
}

const teklifVer = (userId, ihaleId, govde = {}) => db.tx(async () => {
  const i = await q.ihaleKilitle.get(Number(ihaleId)), t = Date.now();
  if (!i) throw new OyunHatasi(404, 'İhale bulunamadı');
  if (i.durum !== 'ACIK' || t >= i.bitis) throw new OyunHatasi(409, 'Bu ihale bitti', 'BITTI');
  if ((await db.get('SELECT is_npc FROM users WHERE id = ?', userId))?.is_npc) throw new OyunHatasi(403, 'Demo hesaplar teklif veremez');
  const p = await db.get('SELECT region_id FROM parcels WHERE id = ?', i.parcel_id);
  if ((await db.get('SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ?', userId)).c + await ondeOlunan(userId, { haric: i.id }) >= HESAP.maxParsel) {
    throw new OyunHatasi(409, `Hesap başına en fazla ${HESAP.maxParsel} parsel (önde olduğun ihaleler dahil); önce birini sat`, 'PARSEL_SINIRI');
  }
  if ((await db.get('SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ? AND region_id = ?', userId, p.region_id)).c
      + await ondeOlunan(userId, { haric: i.id, regionId: p.region_id }) >= HESAP.maxParselMahalle) {
    throw new OyunHatasi(409, `Bir mahallede en fazla ${HESAP.maxParselMahalle} parsel (önde olduğun ihaleler dahil)`, 'PARSEL_SINIRI');
  }
  const tutar = Number(govde.tutar);
  const ust = await q.enYuksek.get(i.id);
  const asgari = ust ? Math.ceil(ust.tutar * (1 + I.artis)) : i.taban;
  if (!Number.isInteger(tutar) || tutar < asgari) throw new OyunHatasi(400, `En az ${asgari} akçe teklif vermelisin`, 'DUSUK');
  const tx = L.yeniTx(), eski = await q.benim.get(i.id, userId);
  if (eski) await teklifIade(eski, i.id, 'İhale teklifi yükseltildi (eski teklif iadesi)', tx);
  if (await L.bakiye(userId) < tutar) throw new OyunHatasi(402, `Yetersiz bakiye: ${tutar} akçe gerekli`, 'YETERSIZ_BAKIYE');
  await L.aktar({ kaynak: L.hesap(userId), hedef: emanet(i.id), tutar, sebep: `İhale teklifi ${i.parcel_id}`, tx });
  await db.run('INSERT INTO ihale_teklifleri (ihale_id, user_id, tutar, at) VALUES (?, ?, ?, ?)', i.id, userId, tutar, t);
  // Geçilen (başkasının) en yüksek teklif hemen iade edilir
  if (ust && ust.user_id !== userId && await teklifIade(ust, i.id, 'İhalede teklifin geçildi (iade)', tx)) {
    await bildir(ust.user_id, `🔨 İhalede teklifin geçildi: ${i.parcel_id} için yeni teklif ₳${tutar}. Akçen iade edildi.`, 'pazar:ihale');
  }
  await L.denetim({ aktor: userId, eylem: 'AUCTION_BID', varlik: `IHALE:${i.id}`, sonra: { tutar } });
  return { tamam: true, tutar };
});

// Hesap silinirken: oyuncunun açık ihalelerdeki aktif teklifleri iade edilip kapanır (emanette akçe kalmasın)
const tekliflerIade = (userId) => db.tx(async () => {
  const liste = await db.all(`SELECT t.* FROM ihale_teklifleri t JOIN ihaleler i ON i.id = t.ihale_id
                            WHERE t.user_id = ? AND t.durum = 'AKTIF' AND i.durum = 'ACIK'`, userId);
  for (const tk of liste) {
    await q.ihaleKilitle.get(tk.ihale_id);   // eşzamanlı sonuçlandırma / teklifle sırayla
    await teklifIade(tk, tk.ihale_id, 'İhale teklifi iadesi (hesap silindi)');
  }
  return liste.length;
});

// Biten ihaleler: en yüksekten başlayarak parsel sınırı uygun ilk teklif kazanır; diğerleri iade.
// Hesabı silinmiş ya da askıdaki oyuncunun teklifi kazanamaz (iade edilir).
const sonuclandir = (t = Date.now()) => db.tx(async () => {
  const oyun = require('./oyun');
  const aktifKullanici = db.sorgu(`SELECT 1 FROM users WHERE id = ? AND status = 'ACTIVE' AND silindi_at IS NULL`);
  for (const { id } of await db.all(`SELECT id FROM ihaleler WHERE durum = 'ACIK' AND bitis <= ?`, t)) {
    // Satır kilitlenip taze okunur: eşzamanlı ikinci sonuçlandırma (başka istek / sunucu) bu ihaleyi atlar
    const i = await q.ihaleKilitle.get(id);
    if (!i || i.durum !== 'ACIK' || i.bitis > t) continue;
    let kazanan = null;
    for (const tk of await q.aktifler.all(i.id)) {
      if (!kazanan && await aktifKullanici.get(tk.user_id)) {
        try {
          // İç işlem (kayıt noktası): tahsis başarısız olursa yalnız onun yazdıkları geri alınır, sıradaki teklife geçilir
          await db.tx(() => oyun.parselEdin(tk.user_id, i.parcel_id, { id: i.id, fiyat: tk.tutar, kaynak: emanet(i.id) }));
          kazanan = tk;
          await db.run(`UPDATE ihale_teklifleri SET durum = 'KAZANDI' WHERE id = ? AND durum = 'AKTIF'`, tk.id);
          await bildir(tk.user_id, `🔨 İhaleyi kazandın! ${i.parcel_id} artık senin (₳${tk.tutar}).`, `parsel:${i.parcel_id}`);
          continue;
        } catch { /* sınır vb.: sıradaki teklif */ }
      }
      if (await teklifIade(tk, i.id, 'İhale sonuçlandı (iade)') && kazanan) {
        await bildir(tk.user_id, `🔨 ${i.parcel_id} ihalesi bitti; kazanan teklif ₳${kazanan.tutar}. Akçen iade edildi.`, 'pazar:ihale');
      }
    }
    await db.run(`UPDATE ihaleler SET durum = ?, kazanan = ?, fiyat = ? WHERE id = ? AND durum = 'ACIK'`, kazanan ? 'SATILDI' : 'SATILMADI', kazanan?.user_id ?? null, kazanan?.tutar ?? null, i.id);
  }
});
let sonBakim = 0;
async function ihaleBakim(t = Date.now()) {
  if (t - sonBakim < 60_000) return;
  sonBakim = t;
  await sonuclandir(t);
}

async function liste(userId, t = Date.now()) {
  const h = haftaNo(t);
  await haftayiKur(h);
  await sonuclandir(t);
  const oyun = require('./oyun'), set = KOLEKSIYON.setler[setKodu(h)];
  const ihaleler = [];
  for (const i of await db.all('SELECT * FROM ihaleler WHERE hafta = ? ORDER BY id', h)) {
    const k = await oyun.parselKarti(i.parcel_id, userId, {}, { hafif: true }), ust = await q.enYuksek.get(i.id), ben = userId ? await q.benim.get(i.id, userId) : null;
    const teklifSayisi = (await q.aktifler.all(i.id)).length;
    ihaleler.push({ id: i.id, parsel: i.parcel_id, mahalle: k.mahalle, ilce: k.ilce, il: k.il, alan: k.alan, konum: k.konum, taban: i.taban,
      enYuksek: ust?.tutar ?? null, liderBen: !!ust && ust.user_id === userId, benimTeklif: ben?.tutar ?? null,
      asgari: ust ? Math.ceil(ust.tutar * (1 + I.artis)) : i.taban, teklifSayisi,
      bitis: i.bitis, kalanMs: Math.max(0, i.bitis - t), durum: i.durum, fiyat: i.fiyat, kazandim: i.kazanan === userId });
  }
  return { hafta: h, set: { ad: set.ad, ikon: set.ikon }, ihaleler, tabanOrani: I.tabanOrani, artis: I.artis };
}

function rotalar(app, { h, auth }) {
  app.get('/api/ihale', h((req) => liste(req.kullanici?.id ?? null)));
  app.post('/api/ihale/:id/teklif', auth.dogrulanmisGerekli, h((req) => teklifVer(req.kullanici.id, req.params.id, req.body || {})));
}

module.exports = { rotalar, liste, teklifVer, sonuclandir, tekliflerIade, ihaleBakim, ihaledeMi, haftayiKur, haftaNo, ondeOlunan };
