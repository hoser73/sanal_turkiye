// Başlangıç tarlası: yeni oyuncu haritada tarla aramadan oyuna başlasın. Hesap başına bir kez, hiç parseli yokken,
// memleketinin il merkezine (yoksa Konya Meram'a) en yakın boş tarım hücresi oyuncuya hediye edilir: tahsis bedeli
// kadar akçe "başlangıç hediyesi" olarak verilir ve olağan tahsis (parselEdin) aynı işlemde yapılır — defter tutarlı kalır,
// ILK_PARSEL görevi de olağan yoldan tamamlanır.
const db = require('./db');
const { metin } = require('./lib/girdi');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const oyun = require('./oyun');
const auth = require('./auth');
const { hucreAra, parselHazirla } = require('./harita/parsel');
const IL_MERKEZ = require('./harita/il-merkezleri');

const VARSAYILAN = [32.4325, 37.8397];   // Konya, Meram ovası

const q = {
  kullanici: db.sorgu(`SELECT id, is_npc, memleket_plaka, baslangic_tarla_at FROM users WHERE id = ?`),
  parselSayisi: db.sorgu(`SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ?`),
  isaretle: db.sorgu(`UPDATE users SET baslangic_tarla_at = ? WHERE id = ? AND baslangic_tarla_at IS NULL`),
};

// Oyuncu başlangıç tarlası alabilir mi (istemci rehberde "Tarlamı al" düğmesini buna göre gösterir)
async function hakVar(userId) {
  const u = await q.kullanici.get(userId);
  return !!u && !u.is_npc && !u.baslangic_tarla_at && (await q.parselSayisi.get(userId)).c === 0;
}

// Bir parseli hediye olarak tahsis et: tahsis bedeli kadar akçe hediye + olağan parselEdin, tek işlemde.
// Silinmiş bir hesabın kimliğiyle açılan hesapta hediye verilmez: tarla olağan tahsisle, oyuncunun kendi akçesiyle alınır.
async function hediyeEt(userId, id) {
  const p = await oyun.parselGetir(id);
  if (p.owner_user_id) throw new OyunHatasi(409, 'Bu arsa az önce başkasına geçti; başka bir arsa seç', 'TAHSISLI');
  if (p.zoning_type !== 'TARIM') throw new OyunHatasi(422, 'Başlangıç arsası tarım arazisi olmalı');
  if (p.area_m2 > ADAY_ALAN_UST) throw new OyunHatasi(422, 'Bu tarla hediye için çok büyük; daha küçük bir tarla seç', 'BUYUK');
  const bedel = await auth.tekrarHesapMi(userId) ? 0 : await oyun.tahsisFiyati(p);
  return db.tx(async () => {
    // Denetimden işleme kadar başkası almış olabilir: parsel satırı kilitlenip yeniden bakılır (sıradaki adaya geçilsin)
    if ((await oyun.parselGetir(id, { kilit: true })).owner_user_id) throw new OyunHatasi(409, 'Bu arsa az önce başkasına geçti; başka bir arsa seç', 'TAHSISLI');
    if ((await q.isaretle.run(Date.now(), userId)).changes !== 1) throw new OyunHatasi(409, 'Başlangıç tarlanı zaten aldın', 'ALINDI');
    if (bedel > 0) await L.odul(userId, bedel, 'Başlangıç tarlası hediyesi');
    const r = await oyun.parselEdin(userId, id);
    // Hediye arsa ayrı işaretlenir: Hazine'ye satış için daha uzun tutma süresi (piyasa.js)
    await db.run(`UPDATE parcel_ownership SET reason = 'BASLANGIC' WHERE parcel_id = ? AND user_id = ? AND end_at IS NULL`, id, userId);
    return { ...r, parsel: id, hediye: bedel };
  });
}
async function hakKontrol(userId) {
  const u = await q.kullanici.get(userId);
  if (!u || u.is_npc) throw new OyunHatasi(403, 'Yalnızca oyuncular başlangıç tarlası alabilir');
  if (u.baslangic_tarla_at) throw new OyunHatasi(409, 'Başlangıç tarlanı zaten aldın', 'ALINDI');
  if ((await q.parselSayisi.get(userId)).c > 0) throw new OyunHatasi(409, 'Zaten bir parselin var', 'PARSELI_VAR');
  return u;
}

// Sihirbaz: oyuncunun seçtiği köyde/mahallede 3 boş tarla adayı. Adaylar oyuncu için 1 saat hatırlanır; hediye yalnızca
// bunlardan biri için verilir (oyuncu rastgele büyük ve pahalı bir tarlayı hediye olarak alamasın).
const ADAY_SURE = 60 * 60_000, ADAY_ALAN_UST = 25_000;
const adayHafiza = new Map();   // userId → { ids: Set, at }
async function adaylar(userId, { ilce, yer }) {
  await hakKontrol(userId);
  const ilceSatir = await db.get(`SELECT id, name, source_idx, center_lon, center_lat FROM regions WHERE id = ? AND type = 'ILCE'`, Number(ilce));
  if (!ilceSatir) throw new OyunHatasi(404, 'İlçe bulunamadı');
  const y = yer ? await db.get(`SELECT ad, lon, lat FROM yerler WHERE id = ? AND ilce_idx = ?`, String(yer), ilceSatir.source_idx) : null;
  if (yer && !y) throw new OyunHatasi(404, 'Mahalle ya da köy bulunamadı');
  const [lon, lat] = y ? [y.lon, y.lat] : [ilceSatir.center_lon, ilceSatir.center_lat];
  const hucreler = await hucreAra(lon, lat, ['TARIM'], 8, 3, 40);
  const bulunan = [], buyukler = [], tekrar = await auth.tekrarHesapMi(userId);
  for (const hucre of hucreler) {
    if (bulunan.length >= 3) break;
    const id = await parselHazirla(hucre);
    if (bulunan.some((a) => a.id === id) || buyukler.some((a) => a.id === id)) continue;
    const kart = await oyun.parselKarti(id, userId, {}, { hafif: true });
    if (kart.sahip || kart.imar.tip !== 'TARIM') continue;
    const aday = { id, mahalle: kart.mahalle, ilce: kart.ilce, il: kart.il, alan: kart.alan, adaParsel: kart.adaParsel,
      konum: kart.konum, geometri: kart.geometri, tarla: !!kart.tarla, hediye: tekrar ? 0 : kart.birincilBedel ?? null, bedel: kart.birincilBedel ?? null };
    (kart.alan <= ADAY_ALAN_UST ? bulunan : buyukler).push(aday);
  }
  const sonuc = bulunan.slice(0, 3);   // çok büyük tarlalar hediye edilmez
  if (!sonuc.length) throw new OyunHatasi(404, 'Bu yerin yakınında boş tarla bulamadık; yakındaki başka bir köy seç', 'TARLA_YOK');
  adayHafiza.set(userId, { ids: new Set(sonuc.map((a) => a.id)), at: Date.now() });
  return { yer: y?.ad || ilceSatir.name, adaylar: sonuc };
}

// Başlangıç tarlası: parsel verilirse (sihirbazdaki aday) o, verilmezse memleketin il merkezine en yakın boş tarla
async function baslangicTarlasi(userId, secilen = null) {
  const u = await hakKontrol(userId);
  if (secilen) {
    const h = adayHafiza.get(userId);
    if (!h || Date.now() - h.at > ADAY_SURE || !h.ids.has(secilen)) throw new OyunHatasi(409, 'Bu arsa sana önerilenlerden değil; listeyi yenile', 'ADAY_DEGIL');
    const r = await hediyeEt(userId, secilen);
    adayHafiza.delete(userId);
    return r;
  }
  const [lon, lat] = (u.memleket_plaka && IL_MERKEZ[u.memleket_plaka]) || VARSAYILAN;
  const hucreler = await hucreAra(lon, lat, ['TARIM'], 4, 2, 48);
  for (const aday of hucreler) {
    const id = await parselHazirla(aday);   // deneme ilçesinde gerçek tarlanın kimliği
    const p = await oyun.parselGetir(id);
    if (p.owner_user_id || p.area_m2 > ADAY_ALAN_UST) continue;
    try {
      return await hediyeEt(userId, id);
    } catch (e) {
      if (e.kod === 'TAHSISLI') continue;   // bu arada başkası aldıysa sıradaki aday
      throw e;
    }
  }
  throw new OyunHatasi(503, 'Yakında boş tarla bulunamadı; haritadan bir tarla seçebilirsin', 'TARLA_YOK');
}

async function rotalar(app, { h, auth }) {
  app.get('/api/baslangic/adaylar', auth.girisGerekli, h((req) => adaylar(req.kullanici.id, { ilce: req.query.ilce, yer: req.query.yer || null })));
  app.post('/api/baslangic/tarla', auth.girisGerekli, h((req) => baslangicTarlasi(req.kullanici.id, metin(req.body?.parsel) || null)));
}

module.exports = { rotalar, baslangicTarlasi, hakVar, adaylar };
