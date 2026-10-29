// Yerel seçimler (plan §6, §14.3, §20.1): mahalle muhtarlığı ve ilçe belediyesi (başkan + meclis).
// Oyun içi seçimlerdir; gerçek kamu seçimi değildir. Tür ve makamlar config/rules.js → SECIM.turler.
//
// Akış: DUYURU → ADAYLIK → KAMPANYA (kütük dondurulur) → OYLAMA → İTİRAZ (sayım + denetim) → SONUÇ / İPTAL → devir
// Takvim seçim açılırken bellidir; aşama geçişleri tembel ve idempotenttir (secimBakim).
//
// Gizli oy: "kim oy kullandı" (secim_katilim) ile "ne oylandı" (secim_oylari) ayrı tablolardadır; oy kaydında
// kullanıcı kimliği ve zaman yoktur. Belediye pusulası iki bölümlüdür (başkan + meclis) ama tek makbuz verir.
// Makbuz yalnızca oyunun sayıma GİRDİĞİNİ kanıtlar, KİME verildiğini değil: oy satın alana kanıt gösterilemez.
// Oylama kapanınca (sayımla aynı işlemde) oy sandığı karıştırılır (db.sandigiKaristir; Postgres'te işlem kimliği ve
// yazılış sırası katılım kaydıyla eşleşmesin).
//
// Denetim: aynı cihazdan çoklu oy kümeleri tespit edilir. Oylar gizli olduğu için şüpheli oylar tek tek
// ayıklanamaz; şüpheli sayısı herhangi bir makamdaki belirleyici farkı değiştirebilecek düzeydeyse seçim iptal
// edilir ve yenilenir. İtiraz aşaması sonunda bağımsız yeniden sayım yapılır.
const crypto = require('crypto');
const db = require('./db');
const { SECIM, ITIBAR, BELEDIYE, HESAP, NUFUS } = require('./config/rules');
const L = require('./lib/ledger');
const { OyunHatasi } = L;


const AKTIF = ['DUYURU', 'ADAYLIK', 'KAMPANYA', 'OYLAMA', 'ITIRAZ'];
const AKTIF_SQL = `('DUYURU','ADAYLIK','KAMPANYA','OYLAMA','ITIRAZ')`;
const SIRA = [...AKTIF, 'BITTI'];
const ASAMA_AD = { DUYURU: 'Duyuru', ADAYLIK: 'Adaylık', KAMPANYA: 'Kampanya', OYLAMA: 'Oylama', ITIRAZ: 'İtiraz', SONUCLANDI: 'Sonuçlandı', IPTAL: 'İptal edildi', ADAY_YOK: 'Aday çıkmadı' };
const TUR = (s) => SECIM.turler[s.tur] || SECIM.turler.MUHTAR;
// Seçimde doldurulan makamlar (ara seçimde yalnızca başkanlık)
const makamListesi = (s) => (s.ara ? ['BASKAN'] : Object.keys(TUR(s).makamlar));
const toplamSure = (tur) => tur.asamalar.reduce((a, x) => a + x.sureMs, 0);

const simdi = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sqlZaman = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const sqlMs = (s) => new Date(s.replace(' ', 'T') + 'Z').getTime();

function bildir(userId, metin, link) {
  return require('./pazar').bildir(userId, metin, link);
}
const bolgeLinki = (s) => (s.tur === 'BELEDIYE' ? `belediye:${s.region_id}` : `mahalle:${s.region_id}`);

// Cihaz özeti için kalıcı gizli tuz (veritabanında bir kez üretilir)
let _tuz = null;
async function tuz() {
  if (_tuz) return _tuz;
  await db.run(`INSERT OR IGNORE INTO ayarlar (anahtar, deger) VALUES ('secim_tuzu', ?)`, crypto.randomBytes(32).toString('hex'));
  _tuz = (await db.get(`SELECT deger FROM ayarlar WHERE anahtar = 'secim_tuzu'`)).deger;
  return _tuz;
}
async function cihazOzeti(ip, tarayici) {
  return sha(`${await tuz()}|${ip || ''}|${String(tarayici || '').slice(0, 300)}`).slice(0, 32);
}
// Makbuz anahtarı: muhtarlıkta (tek makam) eski biçim korunur
const makbuzAnahtari = (s, makam, makbuz) => (s.tur === 'BELEDIYE' ? `${s.id}:${makam}:${makbuz}` : `${s.id}:${makbuz}`);

const q = {
  secim: db.sorgu(`SELECT * FROM secimler WHERE id = ?`),
  aktifSecim: db.sorgu(`SELECT * FROM secimler WHERE region_id = ? AND asama IN ${AKTIF_SQL}`),
  sonSecim: db.sorgu(`SELECT * FROM secimler WHERE region_id = ? ORDER BY id DESC LIMIT 1`),
  adaylar: db.sorgu(`SELECT a.*, u.display_name AS ad, u.is_npc AS npc FROM adaylar a JOIN users u ON u.id = a.user_id WHERE a.secim_id = ? ORDER BY a.id`),
  aktifAdaylar: db.sorgu(`SELECT * FROM adaylar WHERE secim_id = ? AND durum = 'AKTIF'`),
  kutukte: db.sorgu(`SELECT 1 FROM secmen_kutugu WHERE secim_id = ? AND user_id = ?`),
  kutukSayisi: db.sorgu(`SELECT COUNT(*) AS c FROM secmen_kutugu WHERE secim_id = ?`),
  kutuk: db.sorgu(`SELECT user_id FROM secmen_kutugu WHERE secim_id = ?`),
  katildi: db.sorgu(`SELECT 1 FROM secim_katilim WHERE secim_id = ? AND user_id = ?`),
  katilimSayisi: db.sorgu(`SELECT COUNT(*) AS c FROM secim_katilim WHERE secim_id = ?`),
  muhtar: db.sorgu(`SELECT m.*, u.display_name AS ad FROM muhtarlar m JOIN users u ON u.id = m.user_id
                      WHERE m.region_id = ? AND m.baslangic <= ? AND m.bitis > ? ORDER BY m.id DESC LIMIT 1`),
  baskan: db.sorgu(`SELECT * FROM belediye_uyeleri WHERE region_id = ? AND makam = 'BASKAN' AND baslangic <= ? AND bitis > ? ORDER BY id DESC LIMIT 1`),
  // Görevdeki meclisin dönem sonu (verilen andan sonra da görevde kalacak üyeler)
  meclisBitisi: db.sorgu(`SELECT MAX(bitis) AS b FROM belediye_uyeleri WHERE region_id = ? AND makam = 'MECLIS' AND baslangic <= ? AND bitis > ?`),
  mahalle: db.sorgu(`SELECT r.*, ri.name AS ilce, ri.id AS ilce_id, rl.name AS il, rl.id AS il_id FROM regions r JOIN regions ri ON ri.id = r.parent_id
                       JOIN regions rl ON rl.id = ri.parent_id WHERE r.id = ? AND r.type = 'MAHALLE'`),
};
// Sakinler: bölgede parseli olan oyuncular (NPC hariç). Bölge kolonu türe göre: mahalle → region_id, ilçe → ilce_id
const sakinSorgu = {
  region_id: db.sorgu(`SELECT DISTINCT u.id, u.created_at FROM parcels p JOIN users u ON u.id = p.owner_user_id
                         WHERE p.region_id = ? AND u.is_npc = 0 AND u.status = 'ACTIVE'`),
  ilce_id: db.sorgu(`SELECT DISTINCT u.id, u.created_at FROM parcels p JOIN users u ON u.id = p.owner_user_id
                       WHERE p.ilce_id = ? AND u.is_npc = 0 AND u.status = 'ACTIVE'`),
};
const sakinMiSorgu = {
  region_id: db.sorgu(`SELECT 1 FROM parcels p JOIN users u ON u.id = p.owner_user_id WHERE p.region_id = ? AND p.owner_user_id = ? AND u.is_npc = 0 LIMIT 1`),
  ilce_id: db.sorgu(`SELECT 1 FROM parcels p JOIN users u ON u.id = p.owner_user_id WHERE p.ilce_id = ? AND p.owner_user_id = ? AND u.is_npc = 0 LIMIT 1`),
};
const sakinler = async (tur, regionId) => sakinSorgu[tur.sakinKolonu].all(regionId);
// Yaşayan nüfus: demo sakinler (NPC) yalnızca "doldurma kipi"nde seçmen ve aday olur — bölgedeki gerçek oyuncu eşiğin altındayken
const demoSorgu = {
  region_id: db.sorgu(`SELECT DISTINCT u.id, u.created_at FROM parcels p JOIN users u ON u.id = p.owner_user_id
                         WHERE p.region_id = ? AND u.is_npc = 1 AND u.npc_kisilik IS NOT NULL AND u.npc_durum = 'AKTIF'`),
  ilce_id: db.sorgu(`SELECT DISTINCT u.id, u.created_at FROM parcels p JOIN users u ON u.id = p.owner_user_id
                       WHERE p.ilce_id = ? AND u.is_npc = 1 AND u.npc_kisilik IS NOT NULL AND u.npc_durum = 'AKTIF'`),
};
const demoSakinler = async (tur, regionId) => demoSorgu[tur.sakinKolonu].all(regionId);
const doldurmaKipi = async (tur, regionId) => NUFUS.etkin && (await sakinler(tur, regionId)).length < tur.minSecmen;
// Seçmen adayları: gerçek sakinler + (doldurma kipinde) demo sakinler
const secmenler = async (tur, regionId) => (await doldurmaKipi(tur, regionId)
  ? [...await sakinler(tur, regionId), ...await demoSakinler(tur, regionId)] : sakinler(tur, regionId));
const sakinMi = async (tur, regionId, userId) => !!await sakinMiSorgu[tur.sakinKolonu].get(regionId, userId);

// ---------- Oyun içi itibar ve etkinlik (açık formül) ----------
async function itibar(userId) {
  const u = await db.get(`SELECT created_at FROM users WHERE id = ?`, userId);
  const p = {
    gorev: (await db.get(`SELECT COUNT(*) c FROM quest_progress WHERE user_id = ?`, userId)).c,
    parsel: (await db.get(`SELECT COUNT(*) c FROM parcels WHERE owner_user_id = ?`, userId)).c,
    yapi: (await db.get(`SELECT COUNT(*) c FROM structures WHERE owner_user_id = ? AND status = 'ACTIVE'`, userId)).c,
    hasat: (await db.get(`SELECT COUNT(*) c FROM crops WHERE user_id = ? AND status = 'HARVESTED'`, userId)).c,
    islem: (await db.get(`SELECT COUNT(*) c FROM trades WHERE (seller_id = ? OR buyer_id = ?) AND flags = '[]'`, userId, userId)).c,
    hesapGunu: Math.floor((simdi() - sqlMs(u.created_at)) / SECIM.gunMs),
  };
  const toplam = Object.entries(p).reduce((a, [k, v]) => a + v * ITIBAR[k], 0);
  return { toplam: Math.min(ITIBAR.maks, toplam), parcalar: p };
}
async function etkinlik(userId) {
  return (await db.get(`SELECT COUNT(*) c FROM audit_events WHERE actor_id = ? AND created_at >= ?`, userId, sqlZaman(simdi() - 30 * SECIM.gunMs))).c;
}

async function adayUygunlugu(userId, secim, makam) {
  const tur = TUR(secim);
  const kosul = tur.makamlar[makam].aday;
  const sebepler = [];
  const u = await db.get(`SELECT created_at, status, is_npc, dogum_yili, npc_kisilik, npc_durum FROM users WHERE id = ?`, userId);
  if (u?.is_npc) {
    // Demo sakin: yalnızca doldurma kipinde, bölgede oturuyorsa ve taşınmıyorsa; itibar/hesap yaşı koşulları aranmaz (iskele rolü)
    if (!u.npc_kisilik || u.npc_durum !== 'AKTIF') sebepler.push('Demo komşular aday olamaz');
    else if (!await doldurmaKipi(tur, secim.region_id)) sebepler.push('Bölgede yeterli gerçek oyuncu var; demo sakinler seçime katılmaz');
    else if (!(await demoSakinler(tur, secim.region_id)).some((d) => d.id === userId)) sebepler.push('Bu bölgede oturmuyor');
    return { uygun: !sebepler.length, sebepler, itibar: 0, itibarParcalari: {}, etkinlik: 0 };
  }
  if (!u || u.status !== 'ACTIVE') sebepler.push('Hesap aday olamaz');
  if (u?.dogum_yili && new Date().getUTCFullYear() - u.dogum_yili < HESAP.yetiskinYas) sebepler.push(`Aday olmak için ${HESAP.yetiskinYas} yaşını doldurmuş olmalısın`);
  if (!await sakinMi(tur, secim.region_id, userId)) sebepler.push(tur.bolge === 'ILCE' ? 'Bu ilçede parselin olmalı' : 'Bu mahallede parselin olmalı');
  if (simdi() - sqlMs(u.created_at) < kosul.minHesapYasiMs) sebepler.push(`Hesabın en az ${Math.round(kosul.minHesapYasiMs / SECIM.gunMs)} günlük olmalı`);
  const it = await itibar(userId);
  if (it.toplam < kosul.minItibar) sebepler.push(`İtibar en az ${kosul.minItibar} olmalı (şu an ${it.toplam})`);
  const et = await etkinlik(userId);
  if (et < kosul.minEtkinlik) sebepler.push(`Son 30 günde en az ${kosul.minEtkinlik} oyun eylemi gerekli (şu an ${et})`);
  return { uygun: !sebepler.length, sebepler, itibar: it.toplam, itibarParcalari: it.parcalar, etkinlik: et };
}

// ---------- Görevdeki makam sahipleri ----------
// Türün görevdeki yönetiminin bitişi (yoksa null): yeni seçim zamanlaması için
async function gorevBitisi(tur, regionId, t) {
  if (tur === SECIM.turler.MUHTAR) return (await q.muhtar.get(regionId, t, t))?.bitis ?? null;
  return (await q.baskan.get(regionId, t, t))?.bitis ?? null;
}

// ---------- Takvim ve açılış ----------
function takvim(tur, bas) {
  const t = {};
  let x = bas;
  for (const a of tur.asamalar) { t[a.kod] = x; x += a.sureMs; }
  t.BITIS = x;
  return t;
}

async function secimAc(regionId, turKod = 'MUHTAR', bas = simdi()) {
  const tur = SECIM.turler[turKod];
  const t = takvim(tur, bas);
  // Meclis seçim bittikten sonra da görevdeyse yalnızca başkanlık için ara seçim yapılır
  const ara = turKod === 'BELEDIYE' && (await q.meclisBitisi.get(regionId, bas, t.BITIS))?.b ? 1 : 0;
  const id = (await db.run(`INSERT INTO secimler (region_id, tur, asama, duyuru_at, adaylik_at, kampanya_at, oylama_at, itiraz_at, bitis_at, created_at, ara)
                         VALUES (?, ?, 'DUYURU', ?, ?, ?, ?, ?, ?, ?, ?)`,
  regionId, turKod, t.DUYURU, t.ADAYLIK, t.KAMPANYA, t.OYLAMA, t.ITIRAZ, t.BITIS, bas, ara)).lastInsertRowid;
  await L.denetim({ anahtar: `ELECTION_ANNOUNCED:${id}`, eylem: 'ELECTION_ANNOUNCED', varlik: `SECIM:${id}`, bolge: regionId, herkese: true,
    sonra: { tur: turKod, adaylik: t.ADAYLIK, oylama: t.OYLAMA, ...(ara ? { ara: true } : {}) } });
  const link = turKod === 'BELEDIYE' ? `belediye:${regionId}` : `mahalle:${regionId}`;
  const duyuru = ara ? 'Belediye başkanlığı için ara seçim duyuruldu; meclis görevini sürdürüyor.' : `${tur.ad} seçimi duyuruldu.`;
  for (const s of await sakinler(tur, regionId)) await bildir(s.id, `${duyuru} Adaylık başvuruları yakında açılıyor.`, link);
  return id;
}

// Yeterli oyuncu sakini olan, aktif seçimi ve görevdeki yönetimi olmayan bölgelerde seçim aç
async function yeniSecimleriAc(t) {
  for (const [kod, tur] of Object.entries(SECIM.turler)) {
    // Gerçek oyuncu eşiği ya da (yaşayan nüfus açıksa) en az bir gerçek oyuncu + demo sakinlerle eşik
    // (HAVING'de takma ad yerine ifadenin kendisi: Postgres takma adı HAVING'de tanımaz)
    const gercek = `COUNT(DISTINCT CASE WHEN u.is_npc = 0 AND u.status = 'ACTIVE' THEN u.id END)`;
    const toplam = `COUNT(DISTINCT CASE WHEN u.is_npc = 0 AND u.status = 'ACTIVE' OR (u.is_npc = 1 AND u.npc_kisilik IS NOT NULL AND u.npc_durum = 'AKTIF') THEN u.id END)`;
    const bolgeler = await db.all(`
      SELECT p.${tur.sakinKolonu} AS r, ${gercek} AS gercek, ${toplam} AS toplam
      FROM parcels p JOIN users u ON u.id = p.owner_user_id WHERE p.owner_user_id IS NOT NULL GROUP BY p.${tur.sakinKolonu}
      HAVING ${gercek} >= ? OR (? = 1 AND ${gercek} >= 1 AND ${toplam} >= ?)`, tur.minSecmen, NUFUS.etkin ? 1 : 0, tur.minSecmen);
    for (const { r } of bolgeler) {
      if (await q.aktifSecim.get(r)) continue;
      const bitis = await gorevBitisi(tur, r, t);
      if (bitis && bitis - toplamSure(tur) > t) continue;   // görev süresi dolmadan yeni seçim yok
      const son = await q.sonSecim.get(r);
      if (son && ['IPTAL', 'ADAY_YOK'].includes(son.asama) && son.bitis_at + SECIM.yenidenDenemeMs > t) continue;
      // Bölge başına tek aktif seçim: denetim ile açılış arasına başka sunucu/istek girmesin
      await db.tx(async () => {
        await db.kilit(`secim-ac:${r}`);
        if (!await q.aktifSecim.get(r)) await secimAc(r, kod, t);
      });
    }
  }
}

// ---------- Sayım ve denetim ----------
async function sayimYap(secimId) {
  const satirlar = await db.all(`SELECT aday_id, makam, COUNT(*) AS c FROM secim_oylari WHERE secim_id = ? GROUP BY aday_id, makam`, secimId);
  const oylar = Object.fromEntries(satirlar.map((r) => [r.aday_id, r.c]));
  const makamToplam = {};
  for (const r of satirlar) makamToplam[r.makam] = (makamToplam[r.makam] || 0) + r.c;
  const pusula = satirlar.reduce((a, r) => a + r.c, 0);
  // Özet: tüm pusulaların (makbuz özeti : aday) sıralı listesinin özeti. Seçim kaydı bununla denetlenir.
  // (Sıra makbuz özetine göredir; sandık karıştırması özeti değiştirmez.)
  const liste = await db.all(`SELECT makbuz_ozeti || ':' || aday_id AS s FROM secim_oylari WHERE secim_id = ? ORDER BY makbuz_ozeti`, secimId);
  return { oylar, makamToplam, pusula, ozetHash: sha(liste.map((x) => x.s).join('\n')) };
}

async function denetimYap(s) {
  const bulgular = [];
  const kumeler = await db.all(`SELECT cihaz_ozeti, COUNT(*) AS c FROM secim_katilim WHERE secim_id = ? GROUP BY cihaz_ozeti HAVING COUNT(*) > 1`, s.id);
  const supheli = kumeler.reduce((a, k) => a + (k.c - 1), 0);
  for (const k of kumeler) bulgular.push({ tur: 'AYNI_CIHAZ', metin: `${k.c} hesap aynı cihazdan oy kullandı`, sayi: k.c });
  const katilim = (await q.katilimSayisi.get(s.id)).c;
  const makamSayisi = (await adayliMakamlar(s)).length;
  const pusula = (await db.get(`SELECT COUNT(*) AS c FROM secim_oylari WHERE secim_id = ?`, s.id)).c;
  if (katilim * makamSayisi !== pusula) bulgular.push({ tur: 'BUTUNLUK', metin: `Katılım (${katilim}) ile pusula sayısı (${pusula}) uyuşmuyor`, sayi: Math.abs(katilim * makamSayisi - pusula) });
  return { supheli, bulgular, katilim, pusula };
}

// Pusulada yer alan makamlar: aktif adayı olanlar (ör. meclise aday çıkmadıysa pusula yalnızca başkan bölümüdür)
async function adayliMakamlar(s) {
  const aktif = new Set((await q.aktifAdaylar.all(s.id)).map((a) => a.makam || 'MUHTAR'));
  return makamListesi(s).filter((m) => aktif.has(m));
}

// Her makam için koltuk sayısı kadar kazanan (en az 1 oy); eşitlikte açık kura. marj: koltuğu belirleyen fark.
function kazananlariBelirle(s, oylar, adaylar) {
  const tur = TUR(s);
  const sonuc = {};
  for (const makam of makamListesi(s)) {
    const m = tur.makamlar[makam];
    const sirali = adaylar.filter((a) => (a.makam || 'MUHTAR') === makam)
      .map((a) => ({ id: a.id, oy: oylar[a.id] || 0, kura: sha(`kura:${s.id}:${a.id}`) }))
      .sort((a, b) => b.oy - a.oy || a.kura.localeCompare(b.kura));
    const kazananlar = sirali.slice(0, m.koltuk).filter((a) => a.oy > 0);
    const son = kazananlar[kazananlar.length - 1];
    const sonraki = sirali[kazananlar.length];
    sonuc[makam] = {
      kazananlar: kazananlar.map((a) => a.id),
      marj: son ? son.oy - (sonraki?.oy || 0) : 0,
      kura: !!(son && sonraki && son.oy === sonraki.oy),
    };
  }
  return sonuc;
}

// ---------- Aşama geçişleri ----------
function hedefAsama(s, t) {
  if (t < s.adaylik_at) return 'DUYURU';
  if (t < s.kampanya_at) return 'ADAYLIK';
  if (t < s.oylama_at) return 'KAMPANYA';
  if (t < s.itiraz_at) return 'OYLAMA';
  if (t < s.bitis_at) return 'ITIRAZ';
  return 'BITTI';
}

const asamaYaz = db.sorgu(`UPDATE secimler SET asama = ? WHERE id = ? AND asama = ?`);

// İşlem içinde, seçim satırı kilitliyken çağrılır (ilerlet)
async function gecis(s, sonraki, t) {
  const tur = TUR(s);
  const r = s.region_id;
  const link = bolgeLinki(s);
  const olay = (eylem, sonra = {}, herkese = true) => L.denetim({ anahtar: `${eylem}:${s.id}`, eylem, varlik: `SECIM:${s.id}`, bolge: r, herkese, sonra: { tur: s.tur, ...sonra } });
  const kutugeBildir = async (metin) => { for (const x of await q.kutuk.all(s.id)) await bildir(x.user_id, metin, link); };

  if (sonraki === 'ADAYLIK') {
    if ((await asamaYaz.run('ADAYLIK', s.id, s.asama)).changes !== 1) return;
    await olay('CANDIDACY_OPENED');
    for (const k of await sakinler(tur, r)) await bildir(k.id, `${tur.ad} seçiminde adaylık başvuruları açıldı.`, link);
    return;
  }
  if (sonraki === 'KAMPANYA') {
    // Seçmen kütüğü dondurulur: o anda bölgede parseli olan ve hesabı yeterince eski oyuncular
    const esik = s.kampanya_at - SECIM.secmenMinHesapYasiMs;
    const ekle = db.sorgu(`INSERT OR IGNORE INTO secmen_kutugu (secim_id, user_id) VALUES (?, ?)`);
    for (const k of await sakinler(tur, r)) if (sqlMs(k.created_at) <= esik) await ekle.run(s.id, k.id);
    // Doldurma kipi: demo sakinler (hesap yaşı aranmadan) kütüğe girer; seçim kaydında işaretlenir
    if (await doldurmaKipi(tur, r)) {
      for (const d of await demoSakinler(tur, r)) await ekle.run(s.id, d.id);
      await db.run(`UPDATE secimler SET doldurma = 1 WHERE id = ?`, s.id);
    }
    for (const a of await q.aktifAdaylar.all(s.id)) {
      if (!await q.kutukte.get(s.id, a.user_id)) await db.run(`UPDATE adaylar SET durum = 'DUSTU' WHERE id = ?`, a.id);
    }
    // Belediyede başkan adayı yoksa seçim yapılamaz; muhtarlıkta muhtar adayı
    const anaMakam = Object.keys(tur.makamlar)[0];
    if (!(await q.aktifAdaylar.all(s.id)).some((a) => (a.makam || 'MUHTAR') === anaMakam)) {
      if ((await db.run(`UPDATE secimler SET asama = 'ADAY_YOK', bitis_at = ? WHERE id = ? AND asama = ?`, t, s.id, s.asama)).changes !== 1) return;
      await olay('ELECTION_NO_CANDIDATE', {}, false);   // haber akışını doldurmasın (mahalle sayfasında görünür)
      return;
    }
    if ((await asamaYaz.run('KAMPANYA', s.id, s.asama)).changes !== 1) return;
    await olay('CAMPAIGN_STARTED', { kutuk: (await q.kutukSayisi.get(s.id)).c });
    return;
  }
  if (sonraki === 'OYLAMA') {
    // Kampanyada adaylar çekildiyse ana makamda aday kalmamış olabilir: boş pusulayla oylama açılmaz
    const anaMakam = Object.keys(tur.makamlar)[0];
    if (!(await q.aktifAdaylar.all(s.id)).some((a) => (a.makam || 'MUHTAR') === anaMakam)) {
      if ((await db.run(`UPDATE secimler SET asama = 'ADAY_YOK', bitis_at = ? WHERE id = ? AND asama = ?`, t, s.id, s.asama)).changes !== 1) return;
      await olay('ELECTION_NO_CANDIDATE', {}, false);
      await kutugeBildir(`${tur.ad} seçiminde adaylar çekildiği için oylama yapılamadı; geçici yönetim sürüyor.`);
      return;
    }
    if ((await asamaYaz.run('OYLAMA', s.id, s.asama)).changes !== 1) return;
    await olay('VOTING_OPENED');
    await kutugeBildir(`${tur.ad} seçiminde oylama başladı. Oyun gizlidir.`);
    return;
  }
  if (sonraki === 'ITIRAZ') {
    const sayim = await sayimYap(s.id);
    const denetim = await denetimYap(s);
    const kutuk = (await q.kutukSayisi.get(s.id)).c;
    const k = kazananlariBelirle(s, sayim.oylar, await q.aktifAdaylar.all(s.id));
    const anaMakam = Object.keys(tur.makamlar)[0];
    const marjlar = Object.values(k).filter((x) => x.kazananlar.length).map((x) => x.marj);
    const sonuc = {
      oylar: sayim.oylar, makamToplam: sayim.makamToplam, toplam: denetim.katilim, kutuk,
      katilimOrani: kutuk ? denetim.katilim / kutuk : 0,
      kazananlar: Object.fromEntries(Object.entries(k).map(([m, x]) => [m, x.kazananlar])),
      marj: marjlar.length ? Math.min(...marjlar) : 0,
      demoKatilim: (await db.get(`SELECT COUNT(*) c FROM secim_katilim k JOIN users u ON u.id = k.user_id WHERE k.secim_id = ? AND u.is_npc = 1`, s.id)).c,
      kura: Object.values(k).some((x) => x.kura),
      denetim,
    };
    const u = await db.run(`UPDATE secimler SET asama = 'ITIRAZ', sonuc_json = ?, ozet_hash = ?, kazanan_aday_id = ? WHERE id = ? AND asama = ?`,
      JSON.stringify(sonuc), sayim.ozetHash, k[anaMakam].kazananlar[0] ?? null, s.id, s.asama);
    if (u.changes !== 1) return;
    // Oylama kapandı: sayımla aynı işlemde sandık karıştırılır (gizli oy; yalnızca Postgres'te iş yapar)
    await db.sandigiKaristir('secim_oylari', 'secim_id', s.id);
    await olay('VOTING_CLOSED', { toplam: denetim.katilim, kutuk });
    await kutugeBildir('Oylama bitti; geçici sonuçlar açıklandı. İtiraz süresi başladı.');
    return;
  }
  if (sonraki === 'BITTI') await karar(s, t);
}

async function karar(s, t) {
  const tur = TUR(s);
  const sonuc = JSON.parse(s.sonuc_json || '{}');
  const yeniden = await sayimYap(s.id);
  let iptal = null;
  if (yeniden.ozetHash !== s.ozet_hash || yeniden.pusula !== sonuc.denetim?.pusula) iptal = 'Bağımsız yeniden sayım ilk sayımla uyuşmadı';
  else if (sonuc.denetim?.bulgular?.some((b) => b.tur === 'BUTUNLUK')) iptal = 'Katılım ve pusula sayıları uyuşmadı';
  else if (!sonuc.toplam || !s.kazanan_aday_id) iptal = 'Geçerli oy kullanılmadı';
  else if (sonuc.denetim.supheli > 0 && sonuc.denetim.supheli >= sonuc.marj) {
    iptal = `Şüpheli katılım (${sonuc.denetim.supheli}) belirleyici farkı (${sonuc.marj}) değiştirebilecek düzeyde. ` +
      'Oylar gizli olduğundan şüpheli oylar ayıklanamaz; seçim yenilenecek.';
  }
  const link = bolgeLinki(s);
  const kutugeBildir = async (metin) => { for (const x of await q.kutuk.all(s.id)) await bildir(x.user_id, metin, link); };

  const itirazYanit = db.sorgu(`UPDATE itirazlar SET durum = ?, yanit = ? WHERE secim_id = ? AND durum = 'INCELEMEDE'`);
  if (iptal) {
    const u = await db.run(`UPDATE secimler SET asama = 'IPTAL', iptal_sebebi = ?, bitis_at = ? WHERE id = ? AND asama = 'ITIRAZ'`, iptal, t, s.id);
    if (u.changes !== 1) return;
    await itirazYanit.run('KABUL', `Seçim iptal edildi: ${iptal}`, s.id);
    await L.denetim({ anahtar: `ELECTION_ANNULLED:${s.id}`, eylem: 'ELECTION_ANNULLED', varlik: `SECIM:${s.id}`, bolge: s.region_id, herkese: true, sonra: { tur: s.tur, sebep: iptal } });
    await kutugeBildir(`${tur.ad} seçimi iptal edildi: ${iptal}`);
    return;
  }

  const u = await db.run(`UPDATE secimler SET asama = 'SONUCLANDI' WHERE id = ? AND asama = 'ITIRAZ'`, s.id);
  if (u.changes !== 1) return;
  await itirazYanit.run('RED', `Yeniden sayım ilk sayımla uyumlu; şüpheli katılım (${sonuc.denetim.supheli}) sonucu değiştirecek düzeyde değil (belirleyici fark ${sonuc.marj}).`, s.id);

  const adayGetir = db.sorgu(`SELECT a.*, u.display_name AS ad FROM adaylar a JOIN users u ON u.id = a.user_id WHERE a.id = ?`);
  const ana = await adayGetir.get(s.kazanan_aday_id);
  if (s.tur === 'BELEDIYE') {
    // Devir: önceki başkan ve meclisin görevi biter; yeni yönetim 90 gün görev alır.
    // Ara seçimde yalnızca başkanlık devredilir; meclis görevde kalır, yeni başkan meclisin dönem sonuna kadar görev yapar.
    let bitis = t + tur.donemMs;
    if (s.ara) {
      bitis = (await q.meclisBitisi.get(s.region_id, t, t))?.b || bitis;
      await db.run(`UPDATE belediye_uyeleri SET bitis = ? WHERE region_id = ? AND makam = 'BASKAN' AND bitis > ?`, t, s.region_id, t);
      // Başkan seçilen meclis üyesi meclis koltuğundan ayrılır
      await db.run(`UPDATE belediye_uyeleri SET bitis = ? WHERE region_id = ? AND makam = 'MECLIS' AND user_id = ? AND bitis > ?`, t, s.region_id, ana.user_id, t);
    } else await db.run(`UPDATE belediye_uyeleri SET bitis = ? WHERE region_id = ? AND bitis > ?`, t, s.region_id, t);
    const uyeEkle = db.sorgu(`INSERT INTO belediye_uyeleri (region_id, user_id, makam, secim_id, aday_id, baslangic, bitis) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const vaatEkle = db.sorgu(`INSERT INTO gorev_vaatleri (uye_id, sira, metin, updated_at) VALUES (?, ?, ?, ?)`);
    for (const [makam, idler] of Object.entries(sonuc.kazananlar)) {
      for (const adayId of idler) {
        const a = await adayGetir.get(adayId);
        const uid = (await uyeEkle.run(s.region_id, a.user_id, makam, s.id, a.id, t, bitis)).lastInsertRowid;
        for (const [i, v] of JSON.parse(a.vaatler).entries()) await vaatEkle.run(uid, i + 1, v, t);
      }
    }
    const meclis = [];
    for (const id of sonuc.kazananlar.MECLIS || []) meclis.push((await adayGetir.get(id)).ad);
    await L.denetim({ anahtar: `ELECTION_CLOSED:${s.id}`, aktor: ana.user_id, eylem: 'ELECTION_CLOSED', varlik: `SECIM:${s.id}`, bolge: s.region_id, herkese: true,
      sonra: { tur: 'BELEDIYE', kazanan: ana.ad, oy: sonuc.oylar[ana.id] || 0, toplam: sonuc.toplam, meclis, ...(s.ara ? { ara: true } : {}) } });
    await kutugeBildir(s.ara ? `${ana.ad} ara seçimle belediye başkanı oldu; meclis görevini sürdürüyor.`
      : `${ana.ad} belediye başkanı seçildi; meclis: ${meclis.length ? meclis.join(', ') : 'üye seçilmedi'}.`);
    return;
  }
  // Muhtarlık devri: önceki muhtarın görevi biter, yenisi 30 günlüğüne başlar; vaatleri takip listesine geçer
  await db.run(`UPDATE muhtarlar SET bitis = ? WHERE region_id = ? AND bitis > ?`, t, s.region_id, t);
  const mid = (await db.run(`INSERT INTO muhtarlar (region_id, user_id, secim_id, aday_id, baslangic, bitis) VALUES (?, ?, ?, ?, ?, ?)`,
    s.region_id, ana.user_id, s.id, ana.id, t, t + tur.donemMs)).lastInsertRowid;
  for (const [i, v] of JSON.parse(ana.vaatler).entries()) {
    await db.run(`INSERT INTO vaat_takip (muhtar_id, sira, metin, updated_at) VALUES (?, ?, ?, ?)`, mid, i + 1, v, t);
  }
  await L.denetim({ anahtar: `ELECTION_CLOSED:${s.id}`, aktor: ana.user_id, eylem: 'ELECTION_CLOSED', varlik: `SECIM:${s.id}`, bolge: s.region_id, herkese: true,
    sonra: { tur: 'MUHTAR', kazanan: ana.ad, oy: sonuc.oylar[ana.id] || 0, toplam: sonuc.toplam } });
  await kutugeBildir(`${ana.ad} mahallenin yeni muhtarı oldu (${sonuc.oylar[ana.id] || 0}/${sonuc.toplam} oy).`);
}

// Her geçiş kendi işleminde: seçim satırı kilitlenip yeniden okunur (oy verme, adaylık, itiraz paylaşımlı kilitle bekler;
// sayım sürerken yeni oy giremez, iki sunucu aynı geçişi iki kez yapamaz). Geçişler ayrıca koşullu yazılır (WHERE asama = ?).
async function ilerlet(s, t) {
  for (let guvenlik = 0; guvenlik < 8 && s && AKTIF.includes(s.asama); guvenlik++) {
    const hedef = hedefAsama(s, t);
    if (SIRA.indexOf(s.asama) >= SIRA.indexOf(hedef)) return;
    s = await db.tx(async () => {
      const guncel = await db.get(`SELECT * FROM secimler WHERE id = ? FOR UPDATE`, s.id);
      if (guncel && guncel.asama === s.asama) await gecis(guncel, SIRA[SIRA.indexOf(guncel.asama) + 1], t);
      return q.secim.get(s.id);
    });
  }
}

let sonAcmaKontrolu = 0;
async function secimBakim({ zorla = false } = {}) {
  const t = simdi();
  for (const s of await db.all(`SELECT * FROM secimler WHERE asama IN ${AKTIF_SQL}`)) await ilerlet(s, t);
  if (zorla || t - sonAcmaKontrolu > 20000) {
    sonAcmaKontrolu = t;
    await yeniSecimleriAc(t);
  }
}

// ---------- Oyuncu eylemleri ----------
// kilit: işlem içinde seçim satırını paylaşımlı kilitler; aşama geçişi (FOR UPDATE) bu işlem bitene dek bekler
async function aktifSecimGetir(secimId, beklenen, { kilit = false } = {}) {
  const s = kilit ? await db.get(`SELECT * FROM secimler WHERE id = ? FOR SHARE`, Number(secimId)) : await q.secim.get(Number(secimId));
  if (!s) throw new OyunHatasi(404, 'Seçim bulunamadı');
  if (beklenen && !beklenen.includes(s.asama)) {
    throw new OyunHatasi(409, `Bu işlem için seçimin ${beklenen.map((a) => ASAMA_AD[a]).join(' / ')} aşamasında olması gerekir (şu an: ${ASAMA_AD[s.asama]})`, 'ASAMA');
  }
  return s;
}
const metin = (v, ad, min, max) => {
  if (typeof v !== 'string') throw new OyunHatasi(400, `${ad} gerekli`);
  const m = v.trim();
  if (m.length < min || m.length > max) throw new OyunHatasi(400, `${ad} ${min}–${max} karakter olmalı`);
  return m;
};

const adayOl = (userId, secimId, govde) => db.tx(async () => {
  const s = await aktifSecimGetir(secimId, ['ADAYLIK'], { kilit: true });
  const tur = TUR(s);
  const makamlar = makamListesi(s);
  const makam = govde?.makam ?? (makamlar.length === 1 ? makamlar[0] : null);
  if (!makamlar.includes(makam)) {
    throw new OyunHatasi(400, s.ara ? 'Bu ara seçimde yalnızca belediye başkanlığına aday olunur; meclis görevde' : `Makam seçilmeli: ${makamlar.map((m) => tur.makamlar[m].ad).join(' / ')}`);
  }
  const u = await adayUygunlugu(userId, s, makam);
  if (!u.uygun) throw new OyunHatasi(403, `${tur.makamlar[makam].ad} adayı olamazsın: ${u.sebepler.join('; ')}`, 'ADAY_UYGUN_DEGIL');
  const manifesto = metin(govde?.manifesto, 'Manifesto', 20, SECIM.aday.manifestoMaks);
  const vaatler = Array.isArray(govde?.vaatler) ? govde.vaatler.filter((v) => typeof v === 'string' && v.trim()).map((v) => metin(v, 'Vaat', 3, SECIM.aday.vaatUzunluk)) : [];
  if (vaatler.length > SECIM.aday.vaatMaks) throw new OyunHatasi(400, `En fazla ${SECIM.aday.vaatMaks} vaat`);
  let butce = null;
  if (govde?.butce != null && govde.butce !== '') {
    butce = Number(govde.butce);
    if (!Number.isInteger(butce) || butce < 0 || butce > SECIM.aday.butceMaks) throw new OyunHatasi(400, 'Bütçe tahmini geçersiz');
  }
  const r = await db.run(`INSERT OR IGNORE INTO adaylar (secim_id, user_id, makam, manifesto, vaatler, butce, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    s.id, userId, makam, manifesto, JSON.stringify(vaatler), butce, simdi());
  if (r.changes !== 1) throw new OyunHatasi(409, 'Bu seçimde zaten adaysın (bir seçimde tek makama aday olunur)');
  await L.denetim({ aktor: userId, eylem: 'CANDIDATE_REGISTERED', varlik: `SECIM:${s.id}`, bolge: s.region_id, herkese: true, sonra: { tur: s.tur, makam } });
  return { tamam: true, adayId: r.lastInsertRowid };
});

const adaylikGeriCek = (userId, secimId) => db.tx(async () => {
  const s = await aktifSecimGetir(secimId, ['ADAYLIK', 'KAMPANYA'], { kilit: true });
  const r = await db.run(`UPDATE adaylar SET durum = 'CEKILDI' WHERE secim_id = ? AND user_id = ? AND durum = 'AKTIF'`, s.id, userId);
  if (r.changes !== 1) throw new OyunHatasi(409, 'Bu seçimde aktif adaylığın yok');
  await L.denetim({ aktor: userId, eylem: 'CANDIDATE_WITHDRAWN', varlik: `SECIM:${s.id}`, bolge: s.region_id });
  return { tamam: true };
});

// govde: muhtarlık { adayId } · belediye { secimler: { BASKAN: adayId, MECLIS: adayId } }
// cihaz: cihazOzeti() sonucu (söz de olabilir; işlem açılmadan beklenir)
async function oyVer(userId, secimId, govde, cihaz) {
  const cihazOz = await cihaz;
  return db.tx(async () => {
    const s = await aktifSecimGetir(secimId, ['OYLAMA'], { kilit: true });
    const tur = TUR(s);
    if (!await q.kutukte.get(s.id, userId)) throw new OyunHatasi(403, 'Seçmen kütüğünde değilsin (kütük kampanya başında dondurulur)', 'KUTUK_DISI');
    const makamlar = await adayliMakamlar(s);
    if (!makamlar.length) throw new OyunHatasi(409, 'Bu seçimde oylanacak aday yok', 'ADAY_YOK');
    const tercih = Object.keys(tur.makamlar).length === 1 ? { [makamlar[0]]: govde?.adayId ?? govde?.secimler?.[makamlar[0]] } : (govde?.secimler || {});
    const secilen = {};
    for (const makam of makamlar) {
      const a = await db.get(`SELECT id FROM adaylar WHERE id = ? AND secim_id = ? AND makam = ? AND durum = 'AKTIF'`, Number(tercih[makam]), s.id, makam);
      if (!a) throw new OyunHatasi(400, `${tur.makamlar[makam].ad} için geçerli bir aday seç`);
      secilen[makam] = a.id;
    }
    // 1) Katılım (tekil oy): aynı hesap ikinci kez oy kullanamaz (birincil anahtar; eşzamanlı ikinci istek de reddedilir)
    const gun = new Date().toISOString().slice(0, 10);   // UTC gün (eski date('now') ile aynı)
    const k = await db.run(`INSERT OR IGNORE INTO secim_katilim (secim_id, user_id, gun, cihaz_ozeti) VALUES (?, ?, ?, ?)`, s.id, userId, gun, cihazOz);
    if (k.changes !== 1) throw new OyunHatasi(409, 'Bu seçimde zaten oy kullandın', 'CIFT_OY');
    // 2) Pusula(lar): kullanıcıdan bağımsız; yalnızca makbuz özeti, makam ve aday
    const makbuz = crypto.randomBytes(12).toString('base64url');
    for (const makam of makamlar) {
      await db.run(`INSERT INTO secim_oylari (makbuz_ozeti, secim_id, aday_id, makam) VALUES (?, ?, ?, ?)`,
        sha(makbuzAnahtari(s, makam, makbuz)), s.id, secilen[makam], makam);
    }
    await L.denetim({ aktor: userId, eylem: 'VOTE_CAST', varlik: `SECIM:${s.id}`, bolge: s.region_id });   // seçim içermez
    const gorev = await require('./oyun').gorevTamamla(userId, 'ILK_OY', L.yeniTx());
    return { tamam: true, makbuz, gorev };
  });
}

async function makbuzDogrula(secimId, makbuz) {
  if (typeof makbuz !== 'string' || makbuz.length > 64) throw new OyunHatasi(400, 'Geçersiz makbuz');
  const s = await q.secim.get(Number(secimId));
  if (!s) throw new OyunHatasi(404, 'Seçim bulunamadı');
  const makamlar = await adayliMakamlar(s);
  let dahil = makamlar.length > 0;
  for (const m of makamlar) {
    if (!dahil) break;
    dahil = !!await db.get(`SELECT 1 FROM secim_oylari WHERE secim_id = ? AND makbuz_ozeti = ?`, s.id, sha(makbuzAnahtari(s, m, makbuz.trim())));
  }
  return { dahil };   // kime oy verildiği bilinçli olarak döndürülmez
}

const itirazEt = (userId, secimId, govde) => db.tx(async () => {
  const s = await aktifSecimGetir(secimId, ['ITIRAZ'], { kilit: true });
  const aday = await db.get(`SELECT 1 FROM adaylar WHERE secim_id = ? AND user_id = ?`, s.id, userId);
  if (!await q.kutukte.get(s.id, userId) && !aday) throw new OyunHatasi(403, 'Yalnızca seçmenler ve adaylar itiraz edebilir');
  const sebep = metin(govde?.sebep, 'İtiraz gerekçesi', SECIM.itirazMin, SECIM.itirazMaks);
  const r = await db.run(`INSERT OR IGNORE INTO itirazlar (secim_id, user_id, sebep, created_at) VALUES (?, ?, ?, ?)`, s.id, userId, sebep, simdi());
  if (r.changes !== 1) throw new OyunHatasi(409, 'Bu seçime zaten itiraz ettin');
  await L.denetim({ aktor: userId, eylem: 'OBJECTION_FILED', varlik: `SECIM:${s.id}`, bolge: s.region_id, herkese: true, sonra: { tur: s.tur } });
  return { tamam: true };
});

// Herkesin çalıştırabileceği bağımsız yeniden sayım (§14.3)
async function yenidenSay(secimId) {
  const s = await q.secim.get(Number(secimId));
  if (!s) throw new OyunHatasi(404, 'Seçim bulunamadı');
  if (!s.ozet_hash) throw new OyunHatasi(409, 'Sayım oylama bittikten sonra yapılır');
  const y = await sayimYap(s.id);
  const kayit = JSON.parse(s.sonuc_json);
  const uyumlu = y.ozetHash === s.ozet_hash && y.pusula === kayit.denetim.pusula
    && Object.keys({ ...y.oylar, ...kayit.oylar }).every((k) => (y.oylar[k] || 0) === (kayit.oylar[k] || 0));
  return { uyumlu, kayitliOzet: s.ozet_hash, yenidenOzet: y.ozetHash, kayitli: kayit.oylar, yeniden: y.oylar, toplam: y.pusula };
}

// ---------- Muhtar yetkileri (§6.1: mahalle talepleri, küçük projeler) ----------
async function muhtarOlmali(userId, regionId) {
  const t = simdi();
  const m = await q.muhtar.get(regionId, t, t);
  if (!m || m.user_id !== userId) throw new OyunHatasi(403, 'Bu işlem yalnızca görevdeki mahalle muhtarına açıktır');
  return m;
}
async function duyuruYap(userId, regionId, govde) {
  const r = Number(regionId);
  await muhtarOlmali(userId, r);
  const m = metin(govde?.metin, 'Duyuru', 5, SECIM.duyuruMaks);
  const tarama = require('./lib/icerik').icerikDenetle(m);
  if (tarama.karar === 'ENGEL') throw new OyunHatasi(422, `Duyuru yayımlanamaz: ${tarama.nedenler.map((n) => n.not).join(', ')}`);
  await db.tx(async () => {
    await db.run(`INSERT INTO mahalle_duyurulari (region_id, user_id, metin, created_at) VALUES (?, ?, ?, ?)`, r, userId, m, simdi());
    await L.denetim({ aktor: userId, eylem: 'MUHTAR_ANNOUNCEMENT', varlik: `MAHALLE:${r}`, bolge: r, herkese: true, sonra: { metin: m.slice(0, 120) } });
  });
  for (const k of await sakinler(SECIM.turler.MUHTAR, r)) if (k.id !== userId) await bildir(k.id, `Muhtardan duyuru: ${m.slice(0, 80)}`, `mahalle:${r}`);
  return { tamam: true };
}
const VAAT_DURUM = ['BEKLIYOR', 'BASLADI', 'TAMAMLANDI', 'VAZGECILDI'];
async function vaatGuncelle(userId, vaatId, govde) {
  const v = await db.get(`SELECT v.*, m.region_id FROM vaat_takip v JOIN muhtarlar m ON m.id = v.muhtar_id WHERE v.id = ?`, Number(vaatId));
  if (!v) throw new OyunHatasi(404, 'Vaat bulunamadı');
  const m = await muhtarOlmali(userId, v.region_id);
  if (m.id !== v.muhtar_id) throw new OyunHatasi(403, 'Bu vaat önceki döneme ait');
  if (!VAAT_DURUM.includes(govde?.durum)) throw new OyunHatasi(400, 'Geçersiz durum');
  const aciklama = govde?.aciklama ? metin(govde.aciklama, 'Açıklama', 0, 200) : null;
  await db.tx(async () => {
    await db.run(`UPDATE vaat_takip SET durum = ?, aciklama = ?, updated_at = ? WHERE id = ?`, govde.durum, aciklama, simdi(), v.id);
    await L.denetim({ aktor: userId, eylem: 'PROMISE_UPDATED', varlik: `MAHALLE:${v.region_id}`, bolge: v.region_id, sonra: { vaat: v.sira, durum: govde.durum } });
  });
  return { tamam: true };
}

// ---------- Okuma ----------
// Aday sırası her izleyiciye kendi tohumuyla karışık gelir: oy pusulasında sıra avantajı olmasın (§6.2 eşit görünürlük)
async function adayListesi(s, userId, sonucGorunur, sonuc) {
  const liste = [];
  for (const a of await q.adaylar.all(s.id)) {
    liste.push({
      id: a.id, ad: a.ad, demo: !!a.npc, makam: a.makam || 'MUHTAR', ben: a.user_id === userId, durum: a.durum, manifesto: a.manifesto, vaatler: JSON.parse(a.vaatler), butce: a.butce,
      itibar: (await itibar(a.user_id)).toplam, oy: sonucGorunur ? (sonuc.oylar[a.id] || 0) : null, sira: sha(`${userId || 'misafir'}:${a.id}`),
    });
  }
  return liste
    .sort((a, b) => (sonucGorunur ? b.oy - a.oy : 0) || a.sira.localeCompare(b.sira))
    .map(({ sira, ...a }) => a);
}

async function secimDetayi(s, userId) {
  const tur = TUR(s);
  const t = simdi();
  const sonucGorunur = !!s.sonuc_json;
  const sonuc = s.sonuc_json ? JSON.parse(s.sonuc_json) : null;
  let makamUygunlugu = null;
  if (userId && s.asama === 'ADAYLIK') {
    makamUygunlugu = {};
    for (const m of makamListesi(s)) makamUygunlugu[m] = await adayUygunlugu(userId, s, m);
  }
  const ben = userId ? {
    sakin: await sakinMi(tur, s.region_id, userId),
    kutukte: !!await q.kutukte.get(s.id, userId),
    oyKullandi: !!await q.katildi.get(s.id, userId),
    aday: !!await db.get(`SELECT 1 FROM adaylar WHERE secim_id = ? AND user_id = ? AND durum = 'AKTIF'`, s.id, userId),
    adayUygunlugu: makamUygunlugu ? Object.values(makamUygunlugu)[0] : null,
    makamUygunlugu,
    itirazim: (await db.get(`SELECT sebep, durum, yanit FROM itirazlar WHERE secim_id = ? AND user_id = ?`, s.id, userId)) || null,
  } : null;
  return {
    id: s.id, tur: s.tur, turAd: tur.ad, asama: s.asama, asamaAd: ASAMA_AD[s.asama], ara: !!s.ara,
    makamlar: Object.fromEntries(makamListesi(s).map((k) => [k, { ad: tur.makamlar[k].ad, koltuk: tur.makamlar[k].koltuk }])),
    takvim: tur.asamalar.map((a) => ({ kod: a.kod, ad: a.ad, bas: s[`${a.kod.toLowerCase()}_at`] })).concat([{ kod: 'SONUC', ad: 'Sonuç ve devir', bas: s.bitis_at }]),
    adaylar: await adayListesi(s, userId, sonucGorunur, sonuc),
    kutukSayisi: (await q.kutukSayisi.get(s.id)).c,
    doldurma: !!s.doldurma,
    demoKutuk: (await db.get(`SELECT COUNT(*) c FROM secmen_kutugu k JOIN users u ON u.id = k.user_id WHERE k.secim_id = ? AND u.is_npc = 1`, s.id)).c,
    katilimSayisi: ['OYLAMA', 'ITIRAZ', 'SONUCLANDI', 'IPTAL'].includes(s.asama) ? (await q.katilimSayisi.get(s.id)).c : null,
    sonuc: sonuc && { ...sonuc, ozetHash: s.ozet_hash, kazananAdayId: s.kazanan_aday_id, denetim: { supheli: sonuc.denetim.supheli, bulgular: sonuc.denetim.bulgular } },
    itirazlar: await db.all(`SELECT sebep, durum, yanit, created_at FROM itirazlar WHERE secim_id = ? ORDER BY id`, s.id),
    iptalSebebi: s.iptal_sebebi,
    ben,
    simdi: t,
  };
}

// Bir bölgenin aktif ya da son seçimi
async function bolgeSecimi(regionId, userId) {
  const s = (await q.aktifSecim.get(regionId)) || (await q.sonSecim.get(regionId));
  return s ? secimDetayi(s, userId) : null;
}
async function gecmisSecimler(regionId) {
  return db.all(`SELECT s.id, s.asama, s.bitis_at, s.iptal_sebebi, u.display_name AS kazanan FROM secimler s
                     LEFT JOIN adaylar a ON a.id = s.kazanan_aday_id AND s.asama = 'SONUCLANDI' LEFT JOIN users u ON u.id = a.user_id
                     WHERE s.region_id = ? AND s.asama NOT IN ${AKTIF_SQL} ORDER BY s.id DESC LIMIT 6`, regionId);
}

async function mahalleBilgisi(regionId, userId) {
  const r = await q.mahalle.get(Number(regionId));
  if (!r) throw new OyunHatasi(404, 'Mahalle bulunamadı');
  const t = simdi();
  const m = await q.muhtar.get(r.id, t, t);
  const aktif = await q.aktifSecim.get(r.id);
  const tur = SECIM.turler.MUHTAR;
  const sakin = await sakinler(tur, r.id);
  const moderasyon = require('./moderasyon');
  return {
    mahalle: { id: r.id, ad: r.name, ilce: r.ilce, ilceId: r.ilce_id, il: r.il, ilId: r.il_id, sinif: r.place_class, merkez: [r.center_lon, r.center_lat] },
    sakinSayisi: sakin.length,
    demoSakin: (await demoSakinler(tur, r.id)).length,
    doldurma: await doldurmaKipi(tur, r.id),
    benSakinim: !!userId && sakin.some((k) => k.id === userId),
    minSecmen: tur.minSecmen,
    muhtar: m ? {
      id: m.id, userId: m.user_id, ad: m.ad, demo: !!(await db.get(`SELECT is_npc FROM users WHERE id = ?`, m.user_id))?.is_npc, ben: m.user_id === userId, baslangic: m.baslangic, bitis: m.bitis,
      vaatler: await db.all(`SELECT id, sira, metin, durum, aciklama, updated_at FROM vaat_takip WHERE muhtar_id = ? ORDER BY sira`, m.id),
    } : null,
    duyurular: await db.all(`SELECT d.id, d.metin, d.created_at, u.display_name AS ad FROM mahalle_duyurulari d JOIN users u ON u.id = d.user_id
                           WHERE d.region_id = ? AND d.gizlendi = 0 ORDER BY d.id DESC LIMIT 10`, r.id),
    dilekceler: await moderasyon.dilekceler(r.id, userId),
    dilekceKurallari: moderasyon.dilekceKurallari,
    secim: await bolgeSecimi(r.id, userId),
    gecmis: await gecmisSecimler(r.id),
    hizmetler: [...await require('./belediye').mahalleHizmetleri(r.id)].map((k) => ({ kod: k, ...BELEDIYE.projeler[k] })),
    hizmetTurleri: BELEDIYE.projeler,
    yeniSecim: !aktif && sakin.length < tur.minSecmen
      ? (NUFUS.etkin && sakin.length >= 1 ? 'Demo sakinler yerleştikçe seçim takvimi kendiliğinden açılır.'
        : `Seçim için mahallede en az ${tur.minSecmen} oyuncu sakin gerekir (şu an ${sakin.length}). O zamana dek geçici yönetim sürer.`) : null,
  };
}

async function mahallelerim(userId) {
  const t = simdi();
  // EXISTS Postgres'te boolean döner: 0/1 için CASE; GROUP BY seçilen bölge adlarının anahtarlarını da içerir
  return db.all(`
    SELECT r.id, r.name AS ad, ri.name AS ilce, rl.name AS il, COUNT(p.id) AS parsel,
      (SELECT asama FROM secimler s WHERE s.region_id = r.id AND s.asama IN ${AKTIF_SQL}) AS secim,
      CASE WHEN EXISTS (SELECT 1 FROM muhtarlar m WHERE m.region_id = r.id AND m.user_id = ? AND m.bitis > ?) THEN 1 ELSE 0 END AS muhtarim
    FROM parcels p JOIN regions r ON r.id = p.region_id JOIN regions ri ON ri.id = r.parent_id JOIN regions rl ON rl.id = ri.parent_id
    WHERE p.owner_user_id = ? GROUP BY r.id, ri.id, rl.id ORDER BY r.name`, userId, t, userId);
}

// Harita: görünür alandaki aktif seçimler ve muhtarı olan mahalleler
async function haritaSecimleri([w, s, e, n]) {
  const t = simdi();
  const satirlar = await db.all(`
    SELECT r.id, r.name, r.center_lon AS lon, r.center_lat AS lat,
      (SELECT asama FROM secimler x WHERE x.region_id = r.id AND x.asama IN ${AKTIF_SQL}) AS secim,
      (SELECT u.display_name FROM muhtarlar m JOIN users u ON u.id = m.user_id WHERE m.region_id = r.id AND m.baslangic <= ? AND m.bitis > ? ORDER BY m.id DESC LIMIT 1) AS muhtar
    FROM regions r WHERE r.type = 'MAHALLE' AND r.center_lon BETWEEN ? AND ? AND r.center_lat BETWEEN ? AND ? LIMIT 400`, t, t, w, e, s, n);
  return {
    type: 'FeatureCollection',
    features: satirlar.filter((x) => x.secim || x.muhtar).map((x) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
      properties: { id: x.id, ad: x.name, secim: x.secim || '', asama: x.secim ? ASAMA_AD[x.secim] : '', muhtar: x.muhtar || '' },
    })),
  };
}

module.exports = {
  secimBakim, secimAc, adayOl, adaylikGeriCek, oyVer, makbuzDogrula, itirazEt, yenidenSay, duyuruYap, vaatGuncelle,
  mahalleBilgisi, mahallelerim, haritaSecimleri, cihazOzeti, itibar, adayUygunlugu, bolgeSecimi, gecmisSecimler, sakinler, sakinMi,
  demoSakinler, doldurmaKipi, secmenler,
  ASAMA_AD, metin,
};
