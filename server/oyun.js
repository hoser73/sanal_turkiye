// Oyun motoru (modüler monolit, plan §13.2): parsel, imar, inşaat, tarım, pazar, görev.
// Bütün kurallar SUNUCUDA denetlenir (§3.2); her değişiklik tek atomik işlemde yapılır (§8.4).
const db = require('./db');
const { IMAR, IMAR_KAYNAK_NOTU, YAPILAR, URUNLER, TARIM, NPC_PAZAR, HESAP, GOREVLER, BELEDIYE, BOZULMA, BAKIM, HAVA, CARSI, OZELLIK, SIYASI_EYLEMLER, OYUN_HIZI } = require('./config/rules');
const { adaParsel } = require('./harita/ada');
const SIHIRBAZ_ILK_EKIN = () => require('./sihirbaz').SIHIRBAZ.ilkEkinMs;
const L = require('./lib/ledger');
const I = require('./harita/izgara');
const belediye = require('./belediye');
const { OyunHatasi } = L;
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);

const PARSEL_SEC = `SELECT p.*, r.name AS mahalle, r.attractiveness, r.code AS mahalle_kodu, r.place_class,
    ri.name AS ilce, rl.name AS il, rl.plaka
  FROM parcels p JOIN regions r ON r.id = p.region_id JOIN regions ri ON ri.id = p.ilce_id JOIN regions rl ON rl.id = p.il_id`;
const q = {
  parsel: db.sorgu(`${PARSEL_SEC} WHERE p.id = ?`),
  // İşlem içinde parsel satırını işlem sonuna kadar kilitler (yalnızca parcels; bölge satırları kilitlenmez; SQLite'ta düşer)
  parselKilitli: db.sorgu(`${PARSEL_SEC} WHERE p.id = ? FOR UPDATE OF p`),
  kullanici: db.sorgu(`SELECT id, display_name, is_npc FROM users WHERE id = ?`),
  npcKisilik: db.sorgu(`SELECT npc_kisilik FROM users WHERE id = ?`),
  yapilar: db.sorgu(`SELECT * FROM structures WHERE parcel_id = ? ORDER BY id`),
  ekin: db.sorgu(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`),
  parselSayisi: db.sorgu(`SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ?`),
  mahalleParselSayisi: db.sorgu(`SELECT COUNT(*) AS c FROM parcels WHERE owner_user_id = ? AND region_id = ?`),
  bitenYapilar: db.sorgu(`SELECT s.*, p.region_id FROM structures s JOIN parcels p ON p.id = s.parcel_id WHERE s.status = 'BUILDING' AND s.completes_at <= ?`),
  yapiTamamla: db.sorgu(`UPDATE structures SET status = 'ACTIVE', completed_at = ? WHERE id = ? AND status = 'BUILDING'`),
  // Hücre → gerçek tarla eşlemesi (harita/tarla.js)
  tarlaHucreleri: db.sorgu(`SELECT x, y, tarla_id FROM tarla_hucreleri WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?`),
};

// Prototip zinciri kirliliğine karşı: yalnızca kendi anahtarları (ör. "__proto__" reddedilir)
const bul = (tablo, kod) => (typeof kod === 'string' && Object.hasOwn(tablo, kod) ? tablo[kod] : null);
const simdi = () => Date.now();
// Türkiye günü (UTC+3): tüccar talebi ve ziyaret gibi günlük sınırlar İstanbul gece yarısında döner (diğer günlüklerle aynı)
const TR_MS = 3 * 3_600_000;
const bugun = (t = simdi()) => new Date(t + TR_MS).toISOString().slice(0, 10);
const gunBasiMetni = (t = simdi()) => new Date(Date.parse(`${bugun(t)}T00:00:00Z`) - TR_MS).toISOString().replace('T', ' ').slice(0, 19);

// ---------- Görevler ----------
const gorevEkle = db.sorgu(`INSERT OR IGNORE INTO quest_progress (user_id, quest_code) VALUES (?, ?)`);
// İlk giriş turunun da ödüllendirdiği görevler: tur sürerken tamamlanırsa ödülü tur verir (aynı iş iki kez ödenmesin)
const TUR_GOREVLERI = new Set(['ILK_EKIM', 'ILK_SULAMA', 'ILK_HASAT', 'ILK_SATIS', 'ILK_YAPI']);
// İşlem (db.tx) içinde çağrılır: ödül defterden yazılır
async function gorevTamamla(userId, kod, tx) {
  const g = GOREVLER.find((x) => x.kod === kod);
  if (!g) return null;
  if ((await gorevEkle.run(userId, kod)).changes !== 1) return null;   // zaten tamamlanmış
  if (TUR_GOREVLERI.has(kod) && await require('./sihirbaz').aktifMi(userId)) return { kod: g.kod, ad: g.ad, odul: 0 };
  await L.odul(userId, g.odul, `Görev: ${g.ad}`, tx);
  return { kod: g.kod, ad: g.ad, odul: g.odul };
}
async function gorevler(userId) {
  const biten = new Set((await db.all(`SELECT quest_code FROM quest_progress WHERE user_id = ?`, userId)).map((r) => r.quest_code));
  return GOREVLER.filter((g) => OZELLIK.siyaset || g.kod !== 'ILK_OY').map((g) => ({ ...g, tamam: biten.has(g.kod) }));   // seçim görevi siyasetle açılır
}

// ---------- Yapı tamamlama (tembel, idempotent) ----------
// Koşullu güncelleme: aynı yapıyı eşzamanlı iki istek tamamlamaya kalkarsa yalnızca biri yazar
async function bekleyenleriIsle() {
  const t = simdi();
  const biten = await q.bitenYapilar.all(t);
  if (!biten.length) return;
  await db.tx(async () => {
    for (const s of biten) {
      if ((await q.yapiTamamla.run(t, s.id)).changes !== 1) continue;
      await L.denetim({
        anahtar: `STRUCTURE_COMPLETED:${s.id}:${s.started_at}`, aktor: s.owner_user_id, eylem: 'STRUCTURE_COMPLETED',
        varlik: s.parcel_id, sonra: { tip: s.type }, bolge: s.region_id, herkese: true,
      });
    }
  });
}

// ---------- İmar motoru (§3.2) ----------
function imarKullanimi(parsel, yapilar) {
  const imar = IMAR[parsel.zoning_type];
  const taban = yapilar.reduce((a, y) => a + y.footprint_m2, 0);
  const insaat = yapilar.reduce((a, y) => a + y.floor_area_m2, 0);
  return {
    taks: imar.taks, kaks: imar.kaks,
    maxTaban: Math.floor(parsel.area_m2 * imar.taks),
    maxInsaat: Math.floor(parsel.area_m2 * imar.kaks),
    kullanilanTaban: taban, kullanilanInsaat: insaat,
  };
}

function insaatUygunluk(parsel, tip, yapilar) {
  const y = bul(YAPILAR, tip);
  if (!y) return { uygun: false, sebep: 'Bilinmeyen yapı türü' };
  if (!y.izin.includes(parsel.zoning_type)) {
    return { uygun: false, sebep: `${IMAR[parsel.zoning_type].ad} alanında izin verilmez` };
  }
  if (y.minAlan && parsel.area_m2 < y.minAlan) {
    return { uygun: false, sebep: `En az ${y.minAlan} m² parsel gerekir` };
  }
  if (y.tekil && yapilar.some((s) => s.type === tip)) {
    return { uygun: false, sebep: 'Bu parselde zaten var' };
  }
  if (y.emsal) {
    const k = imarKullanimi(parsel, yapilar);
    if (k.kullanilanTaban + y.taban > k.maxTaban) {
      return { uygun: false, sebep: `TAKS aşılır (taban ${k.kullanilanTaban}+${y.taban} > ${k.maxTaban} m²)` };
    }
    if (k.kullanilanInsaat + y.taban * y.kat > k.maxInsaat) {
      return { uygun: false, sebep: `KAKS/emsal aşılır (inşaat ${k.kullanilanInsaat}+${y.taban * y.kat} > ${k.maxInsaat} m²)` };
    }
  }
  return { uygun: true };
}

// ---------- Gösterge (fiyat DEĞİL — §4.3) ----------
function gelismislikSkoru(parsel, yapilar, ekin) {
  const aktif = yapilar.filter((s) => s.status === 'ACTIVE');
  const yapiPuani = aktif.reduce((a, s) => a + (YAPILAR[s.type]?.emsal ? 12 : 5), 0);
  return Math.min(100, Math.round(yapiPuani + (ekin ? 8 : 0) + (parsel.attractiveness - 0.9) * 40));
}

// Oyun içi tahmini değer (akçe): arsa (tahsis bedeli × mahalle çarpanı, piyasa.js) + üstündeki yapıların yatırım
// değeri (yapım maliyeti ve yükseltme harcamaları; tamamlanmış yapı sağlığına göre en çok yarıya kadar aşınır) + süsler.
// Satış ilanındaki fiyatı sahibi belirler; bu bir oyun göstergesidir.
// carpanZorla: Hazine teklifinde satıcı hariç hesaplanan çarpan
async function tahminiDeger(parsel, yapilar, t = simdi(), carpanZorla = null) {
  const piyasa = require('./piyasa');
  const carpan = carpanZorla ?? (await piyasa.mahalleCarpani(parsel.region_id, t)).carpan;
  const arsa = Math.round(birincilBedel(parsel) * carpan);
  let yapi = 0;
  for (const s of yapilar) {
    let v = piyasa.yapiYatirimi(s.type, s.seviye || 1);
    if (s.status === 'ACTIVE') v *= Math.max(0.5, saglik(s, t) / 100);
    yapi += v;
  }
  const { SUSLER } = require('./config/rules');
  const sus = (await require('./ciftlik').parselSusleri(parsel.id)).reduce((a, x) => a + (SUSLER[x.tur]?.fiyat || 0), 0);
  return { toplam: Math.round(arsa + yapi + sus), arsa, tahsis: birincilBedel(parsel), carpan, yapilar: Math.round(yapi), susler: sus };
}
const parselDegeri = async (p, t = simdi()) => tahminiDeger(p, await q.yapilar.all(p.id), t);
// Boş parselin tahsis fiyatı: taban bedel × güncel mahalle çarpanı (ucuz tahsis + hemen Hazine'ye satış kârı olmasın)
const tahsisFiyati = async (p, t = simdi()) => Math.round(birincilBedel(p) * (await require('./piyasa').mahalleCarpani(p.region_id, t)).carpan);

function birincilBedel(parsel) {
  const imar = IMAR[parsel.zoning_type];
  return Math.round(parsel.area_m2 * imar.m2Fiyat * parsel.attractiveness);
}

// kilit: işlem içinde parsel satırını işlem sonuna kadar kilitler (sahiplik, inşaat, ekim, hasat yarışlarına karşı)
async function parselGetir(id, { kilit = false } = {}) {
  if (!I.idCoz(id)) throw new OyunHatasi(400, 'Geçersiz parsel kimliği');
  const p = await (kilit ? q.parselKilitli : q.parsel).get(id);
  if (!p) throw new OyunHatasi(404, 'Parsel bulunamadı');
  return p;
}

function sahibiOlmali(p, userId) {
  if (p.owner_user_id !== userId) throw new OyunHatasi(403, 'Bu parselin kullanım hakkı sizde değil');
  if (p.status !== 'ACTIVE') throw new OyunHatasi(423, 'Parsel geçici olarak dondurulmuş');
}

// Harita kozmetik kodu: aynı istekte bir oyuncunun kodu bir kez hesaplanır
const kozmetikOnbellek = new Map();
async function kozmetikKodu(userId) {
  const k = kozmetikOnbellek.get(userId);
  if (k && Date.now() - k.t < 5000) return k.v;
  const v = await require('./kozmetik').haritaKodu(userId);
  kozmetikOnbellek.set(userId, { v, t: Date.now() });
  if (kozmetikOnbellek.size > 5000) kozmetikOnbellek.clear();
  return v;
}

// ---------- Parsel kartı ----------
// komsuImar: { "dx,dy": imar } — HTTP katmanı karo önbelleğinden doldurur (async)
// hafif: arka plan işleri (işçi turu, demo sakinler, aday listesi) için piyasa ve Hazine hesapları atlanır
async function parselKarti(id, userId, komsuImar = {}, { hafif = false } = {}) {
  await bekleyenleriIsle();
  const p = await parselGetir(id);
  const yapilar = await q.yapilar.all(id);
  const ekin = (await q.ekin.get(id)) || null;
  const sahip = p.owner_user_id ? await q.kullanici.get(p.owner_user_id) : null;
  const imar = IMAR[p.zoning_type];
  const benim = !!userId && p.owner_user_id === userId;
  const t = simdi();
  const hizmetler = await belediye.mahalleHizmetleri(p.region_id);

  // Çevre hücreleri (5 × 5): kayıtlı ızgara parselleri ve gerçek tarlalar. Bir hücreyi gerçek bir tarla kaplıyorsa
  // (tarla_hucreleri) o hücrenin sahibi tarlanın sahibidir; kimlik tarlanınkidir (satın alma ve geçiş o tarlaya).
  const R = 2;
  const kayitliKomsular = await db.all(`
    SELECT p.id, p.zoning_type, p.owner_user_id, p.grid_x, p.grid_y, u.display_name AS sahip
    FROM parcels p LEFT JOIN users u ON u.id = p.owner_user_id
    WHERE p.grid_x BETWEEN ? AND ? AND p.grid_y BETWEEN ? AND ? AND p.id <> ?`,
    p.grid_x - R, p.grid_x + R, p.grid_y - R, p.grid_y + R, p.id);
  const tarlaHucreleri = new Map((await q.tarlaHucreleri.all(p.grid_x - R, p.grid_x + R, p.grid_y - R, p.grid_y + R)).map((h) => [`${h.x},${h.y}`, h.tarla_id]));
  const tarlaKimlikleri = [...new Set(tarlaHucreleri.values())].filter((t) => t !== p.id);
  const tarlaSahipleri = new Map(tarlaKimlikleri.length ? (await db.all(`
    SELECT p.id, p.owner_user_id, u.display_name AS sahip FROM parcels p LEFT JOIN users u ON u.id = p.owner_user_id
    WHERE p.id IN (${tarlaKimlikleri.map(() => '?').join(',')})`, ...tarlaKimlikleri)).map((r) => [r.id, r]) : []);
  const komsular = [], cevre = [];   // komsular: 3 × 3 (parsel kartı); cevre: dış halka (tam sayfa çiftlik 5 × 5 çizer)
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (!dx && !dy) continue;
      const x = p.grid_x + dx, y = p.grid_y + dy;
      const k = kayitliKomsular.find((n) => n.grid_x === x && n.grid_y === y && n.owner_user_id);
      const tarlaId = tarlaHucreleri.get(`${x},${y}`);
      if (!k && tarlaId && tarlaId !== p.id) {
        const t = tarlaSahipleri.get(tarlaId);
        (Math.max(Math.abs(dx), Math.abs(dy)) <= 1 ? komsular : cevre).push({ id: tarlaId, dx, dy, imar: 'TARIM', tarla: true, sahip: t?.sahip || null, ben: !!userId && !!t && t.owner_user_id === userId });
        continue;
      }
      if (tarlaId && tarlaId === p.id) continue;   // parselin kendi tarlası
      const kk = k || kayitliKomsular.find((n) => n.grid_x === x && n.grid_y === y);
      (Math.max(Math.abs(dx), Math.abs(dy)) <= 1 ? komsular : cevre).push({
        id: I.parselId(x, y), dx, dy,
        imar: kk?.zoning_type || komsuImar[`${dx},${dy}`] || null,
        sahip: kk?.sahip || null, ben: !!userId && kk?.owner_user_id === userId,
      });
    }
  }

  const gecmis = await db.all(`
    SELECT o.start_at, o.end_at, o.reason, o.price, u.display_name AS sahip
    FROM parcel_ownership o JOIN users u ON u.id = o.user_id WHERE o.parcel_id = ? ORDER BY o.id DESC LIMIT 10`, id);

  const ciftlik = require('./ciftlik');
  const kozmetik = require('./kozmetik');
  const gelisim = require('./gelisim');
  const kira = require('./kira');
  const dunya = require('./dunya');
  let insaatSecenekleri = null;
  if (benim) {
    const seviye = imar.parselDegil ? null : await ciftlik.oyuncuSeviyesi(userId);
    insaatSecenekleri = imar.parselDegil ? [] : Object.entries(YAPILAR)
      .filter(([, y]) => y.izin.includes(p.zoning_type) && !y.gizli)   // gizli: artık atölyede sunulmayan (var olan durur)
      .map(([tip, y]) => {
        const kilit = y.minSeviye && seviye < y.minSeviye;
        return { tip, ad: y.ad, ikon: y.ikon, kategori: y.kategori, maliyet: y.maliyet, sureMs: y.sureMs, minSeviye: y.minSeviye || 1,
          taban: y.taban, kat: y.kat, etki: y.etki, gelir: y.gelir || null, ...(kilit ? { uygun: false, sebep: `Seviye ${require('./lib/turkce').sayiBulunma(y.minSeviye)} açılır`, kilitli: true } : insaatUygunluk(p, tip, yapilar)) };
      });
  }

  // Tahmini değer; hafif değilse piyasa, getiri ve Hazine teklifi
  const deger = await tahminiDeger(p, yapilar, t);
  let degerAlanlari = { deger };
  if (!hafif) {
    const piyasa = require('./piyasa');
    degerAlanlari = { deger, piyasa: await piyasa.parselPiyasasi(p, t), getirim: benim ? await piyasa.parselGetirisi(userId, p.id, deger.toplam) : null,
      hazine: benim ? await piyasa.hazineTeklifi(userId, p, t) : null };
  }
  const yapiKartlari = [];
  for (const s of yapilar) {
    yapiKartlari.push({ id: s.id, tip: s.type, ad: YAPILAR[s.type]?.ad, ikon: YAPILAR[s.type]?.ikon,
      seviye: s.seviye || 1, maxSeviye: gelisim.GELISIM.maxSeviye, yukseltBedeli: benim && s.status === 'ACTIVE' ? gelisim.yukseltmeBedeli(s) : null,
      yukseltEtki: benim ? gelisim.yukseltmeEtkisi(s, yapilar, t) : null,
      durum: s.status, bitis: s.completes_at, kalanMs: Math.max(0, s.completes_at - t),
      saglik: saglik(s, t), bakimMaliyeti: bakimMaliyeti(s, t), etkisiz: s.status === 'ACTIVE' && saglik(s, t) < BAKIM.etkisizEsik,
      hayvan: await ciftlik.hayvanDurumu(s, t), kira: gelisim.kiraDurumu(s, yapilar, t) });
  }
  let kullanimHakkim = false;
  if (userId) { try { await kira.kullanimHakki(p, userId); kullanimHakkim = true; } catch { /* hak yok */ } }
  let urunSecenekleri = null;
  if (p.zoning_type === 'TARIM') {
    urunSecenekleri = [];
    for (const [kod, u] of Object.entries(URUNLER)) {
      if (u.mamul) continue;
      urunSecenekleri.push({ kod, uygun: !u.bolgeler || u.bolgeler.includes(p.plaka), bolgeAd: u.bolgeAd || null,
        buyume: await dunya.buyumeKati(kod, aktifYapiVar(yapilar, 'SERA', t), t, p.plaka) });
    }
  }

  return {
    id: p.id, mahalle: p.mahalle, mahalleId: p.region_id, ilce: p.ilce, belediyeId: p.ilce_id, il: p.il, plaka: p.plaka,
    hizmetler: [...hizmetler].map((k) => ({ kod: k, ad: BELEDIYE.projeler[k].ad, ikon: BELEDIYE.projeler[k].ikon, etki: BELEDIYE.projeler[k].etki })),
    konum: { lon: p.centroid_lon, lat: p.centroid_lat }, hucre: { x: p.grid_x, y: p.grid_y },
    adaParsel: adaParsel(p.grid_x, p.grid_y),   // oyun içi Ada/Parsel no (gerçek tapu değil)
    geometri: await parselGeometrisi(p), tarla: await tarlaBilgisi(p),
    imarKaynak: { surum: p.zoning_source, not: IMAR_KAYNAK_NOTU },
    alan: p.area_m2, durum: p.status, geomVersiyon: p.geom_version,
    imar: { tip: p.zoning_type, ...imar },
    imarKullanimi: imarKullanimi(p, yapilar),
    sahip: sahip ? { ad: sahip.display_name, npc: !!sahip.is_npc, demoSakin: !!sahip.is_npc && !!(await q.npcKisilik.get(sahip.id))?.npc_kisilik, ben: benim, unvan: sahip.is_npc ? null : (await kozmetik.secili(sahip.id)).unvan?.ad || null } : null,
    kozmetik: sahip && !sahip.is_npc ? await kozmetik.haritaKodu(sahip.id) : '',
    // Simge (kamu mirası) ve bu hafta ihalede olan tarla olağan yoldan edinilemez: tahsis bedeli gösterilmez
    birincilBedel: !p.owner_user_id && imar.satilik && !(await require('./simge').parselSimgesi(id)) && !(await require('./ihale').ihaledeMi(id)) ? await tahsisFiyati(p, t) : null,
    ihalede: !p.owner_user_id && await require('./ihale').ihaledeMi(id),
    gelismislikSkoru: gelismislikSkoru(p, yapilar, ekin),
    ...degerAlanlari,
    yapilar: yapiKartlari,
    susler: await ciftlik.parselSusleri(id),
    komsuluk: await require('./komsuluk').parselIliskisi(userId, id),
    susSecenekleri: benim ? await ciftlik.susSecenekleri(userId) : null,
    bakim: { toplam: L.yuvarla(yapilar.reduce((a, s) => a + bakimMaliyeti(s, t), 0)), esik: BAKIM.etkisizEsik, yipranma: BAKIM.yipranmaGunluk },
    ekin: ekin && { ...ekinDurumu(ekin, yapilar, t),
      sulamaMaliyeti: L.yuvarla(await sulamaBirimi(yapilar, hizmetler, p.plaka) * verimKati(p) * (benim ? await require('./koy-meydani').oran(userId, 'CESME') : 1)) },
    tarimMi: p.zoning_type === 'TARIM',
    uretim: await require('./uretim').parselUretimi(id, userId),
    ...await kira.parselKira(id, userId),
    kullanimHakkim,
    afetKati: ekin?.afet_kati ?? 1,
    simge: await require('./simge').parselSimgesi(id, userId, { gorme: !hafif }),
    hava: await dunya.ilHavasi(p.plaka),
    iklim: await require('./iklim').parselIklimi(p.plaka, t),
    mevsim: (({ kod, ad, ikon }) => ({ kod, ad, ikon }))(dunya.mevsim(t)),
    // Sihirbazdaki ilk ekim kısa sürer; tohum kartı bu süreyi gösterir
    ilkEkinMs: userId && p.owner_user_id === userId && await require('./sihirbaz').hizliIlkEkin(userId) ? SIHIRBAZ_ILK_EKIN() : null,
    urunSecenekleri,
    insaatSecenekleri,
    komsular, cevre,
    gecmis,
    simdi: t,
  };
}

// Parseli devlete geri bırak (hesap silme, demo sakin taşınması): yapılara bağlı hayvan ve üretim kayıtları, süsler,
// yapılar silinir (yabancı anahtar sırası); ekin kapanır; sahiplik kaydı biter
// Çağıranın işlemi (db.tx) içinde çalışır
async function parseliBosalt(id) {
  const yapilar = 'SELECT id FROM structures WHERE parcel_id = ?';
  await db.run(`DELETE FROM hayvan_bakim WHERE structure_id IN (${yapilar})`, id);
  await db.run(`DELETE FROM uretimler WHERE structure_id IN (${yapilar})`, id);
  await db.run(`DELETE FROM parsel_susleri WHERE parcel_id = ?`, id);
  await db.run(`DELETE FROM structures WHERE parcel_id = ?`, id);
  await db.run(`UPDATE crops SET status = 'HARVESTED', harvested_qty = 0 WHERE parcel_id = ? AND status = 'GROWING'`, id);
  await db.run(`UPDATE parcel_ownership SET end_at = datetime('now') WHERE parcel_id = ? AND end_at IS NULL`, id);
  await db.run(`UPDATE parcels SET owner_user_id = NULL, acquired_at = NULL, version = version + 1 WHERE id = ?`, id);
}

// ---------- Parsel edinme: birincil tahsis (§8.1) ----------
const sahiplikAc = db.sorgu(`INSERT INTO parcel_ownership (parcel_id, user_id, reason, price) VALUES (?, ?, 'PRIMARY_ALLOCATION', ?)`);
const sahipAta = db.sorgu(`UPDATE parcels SET owner_user_id = ?, acquired_at = datetime('now'), version = version + 1
                             WHERE id = ? AND owner_user_id IS NULL AND status = 'ACTIVE' AND version = ?`);

// ihale verilirse (ihale.js sonuçlandırma): bedel kazanan teklif, ödeme ihale emanetinden
const parselEdin = (userId, id, ihale = null) => db.tx(async () => {
  // Oyuncu başına parsel sınırı eşzamanlı iki edinmeyle aşılmasın; parsel satırı da işlem sonuna kadar kilitlenir
  await db.kilit(`parsel-edinme:${userId}`);
  const p = await parselGetir(id, { kilit: true });
  if (await require('./simge').parselSimgesi(id)) throw new OyunHatasi(409, 'Simge parsel: kamu mirasıdır, edinilemez', 'SIMGE');
  if (!ihale && await require('./ihale').ihaledeMi(id)) throw new OyunHatasi(409, 'Bu tarla bu hafta ihalede; Pazar → İhale\'den teklif ver', 'IHALEDE');
  const imar = IMAR[p.zoning_type];
  if (imar.parselDegil) throw new OyunHatasi(409, `${imar.ad}: bu hücre parsel değildir`);
  if (!imar.satilik) throw new OyunHatasi(409, `${imar.ad} parselleri oyuncu tahsisine kapalıdır`);
  if (p.owner_user_id) throw new OyunHatasi(409, 'Bu parsel zaten tahsis edilmiş', 'TAHSISLI');
  // Önde olunan açık ihaleler de sayılır (ihaleyle tahsiste o ihalenin kendisi hariç)
  const onde = (bolge) => require('./ihale').ondeOlunan(userId, { haric: ihale?.id ?? null, regionId: bolge });
  if ((await q.parselSayisi.get(userId)).c + await onde(null) >= HESAP.maxParsel) {
    throw new OyunHatasi(409, `Hesap başına en fazla ${HESAP.maxParsel} parsel (arsa kapama önlemi; önde olduğun ihaleler dahil)`);
  }
  if ((await q.mahalleParselSayisi.get(userId, p.region_id)).c + await onde(p.region_id) >= HESAP.maxParselMahalle) {
    throw new OyunHatasi(409, `Bir mahallede en fazla ${HESAP.maxParselMahalle} parsel`);
  }
  const bedel = ihale ? ihale.fiyat : await tahsisFiyati(p);
  // Koşullu yazma (optimistik kilit): okuduğumuz sürüm hâlâ geçerliyse ve parsel boşsa ata
  if ((await sahipAta.run(userId, id, p.version)).changes !== 1) {
    throw new OyunHatasi(409, 'Parsel az önce başka bir oyuncuya tahsis edildi', 'TAHSISLI');
  }
  await sahiplikAc.run(id, userId, bedel);
  const tx = L.yeniTx();
  if (ihale) await L.aktar({ kaynak: ihale.kaynak, hedef: 'SYS:SINK', tutar: bedel, sebep: `İhale ile tahsis ${id}`, tx });
  else await L.harca(userId, bedel, `Birincil tahsis ${id}`, tx);
  await belediye.belediyePayi(p.ilce_id, bedel, 'tahsisPayi', 'tahsis payı', tx);
  await L.denetim({ anahtar: `PARCEL_ACQUIRED:${tx}`, aktor: userId, eylem: 'PARCEL_ACQUIRED', varlik: id,
    sonra: { bedel, imar: p.zoning_type }, bolge: p.region_id, herkese: true });
  const gorev = await gorevTamamla(userId, 'ILK_PARSEL', tx);
  return { tamam: true, bedel, gorev };
});

// ---------- İnşaat (§4.2) ----------
const KALIP_MIN_MS = Math.round(3 * 60_000 / OYUN_HIZI);   // 3 oyun dakikasından kısa inşaatta kalıp seti harcanmaz
const yapiEkle = db.sorgu(`INSERT INTO structures (parcel_id, owner_user_id, type, footprint_m2, floor_area_m2, status, started_at, completes_at)
                             VALUES (?, ?, ?, ?, ?, 'BUILDING', ?, ?)`);
const insaatBaslat = (userId, id, tip) => db.tx(async () => {
  // Parsel kilitlenir: eşzamanlı iki inşaat TAKS/KAKS ve tekil yapı denetimini birlikte aşamasın
  const p = await parselGetir(id, { kilit: true });
  sahibiOlmali(p, userId);
  const yapilar = await q.yapilar.all(id);
  const u = insaatUygunluk(p, tip, yapilar);
  if (!u.uygun) throw new OyunHatasi(422, u.sebep, 'IMAR_IHLALI');
  const y = YAPILAR[tip];
  await require('./ciftlik').seviyeKontrol(userId, y.minSeviye, y.ad);
  const tx = L.yeniTx();
  await L.harca(userId, y.maliyet, `İnşaat: ${y.ad} (${id})`, tx);   // kaynak ayrımı
  await belediye.belediyePayi(p.ilce_id, y.maliyet, 'ruhsatPayi', 'ruhsat harcı', tx);
  const t = simdi();
  // Belediyenin yol bakımı yaptığı mahallede inşaat daha kısa sürer
  // Nalburdan alınan kalıp seti kendiliğinden kullanılır (inşaat kısalır); kısa inşaatta harcanmaz
  const sureKalipsiz = y.sureMs * ((await belediye.mahalleHizmetleri(p.region_id)).has('YOL_BAKIMI') ? 1 - BELEDIYE.etki.insaatKisalma : 1)
    * (1 - await require('./uretim').meslekBonusu(userId, 'MIMAR'));
  const kalip = sureKalipsiz >= KALIP_MIN_MS && await require('./carsi').stoktanKullan(userId, 'KALIP_SETI', `Kalıp seti: ${y.ad} (${id})`, tx);
  const sure = Math.round(sureKalipsiz * (kalip ? 1 - CARSI.etki.kalipKisalma : 1));
  const yapiId = (await yapiEkle.run(id, userId, tip, y.taban, y.taban * y.kat, t, t + sure)).lastInsertRowid;
  // Yapı kimliği tek başına benzersiz değil: parsel boşaltılınca yapılar silinir ve SQLite en büyük kimliği yeniden verir
  await L.denetim({ anahtar: `STRUCTURE_STARTED:${yapiId}:${t}`, aktor: userId, eylem: 'STRUCTURE_STARTED', varlik: id,
    sonra: { tip, maliyet: y.maliyet }, bolge: p.region_id, herkese: true });
  const gorev = await gorevTamamla(userId, 'ILK_YAPI', tx);
  return { tamam: true, yapiId, bitis: t + sure, gorev, kalip };
});

// ---------- Tarım (§5) ----------
// Yapı sağlığı (0–100): son bakımdan bu yana geçen oyun günüyle tembel hesaplanır (zamanlayıcı gerekmez)
function saglik(s, t = simdi()) {
  if (s.status !== 'ACTIVE') return 100;
  const bas = s.bakim_at ?? s.completed_at ?? s.completes_at;
  return Math.max(0, Math.round(100 - BAKIM.yipranmaGunluk * Math.max(0, t - bas) / BAKIM.gunMs));
}
const bakimMaliyeti = (s, t = simdi()) => L.yuvarla((YAPILAR[s.type]?.maliyet || 0) * BAKIM.onarimOrani * (100 - saglik(s, t)) / 100);
// Bakımsız (sağlığı eşiğin altında) yapının etkisi kesilir
function aktifYapiVar(yapilar, tip, t = simdi()) {
  return yapilar.some((s) => s.type === tip && s.status === 'ACTIVE' && saglik(s, t) >= BAKIM.etkisizEsik);
}
// Sulama birim maliyeti: su deposu yarıya, belediyenin sulama kanalı ayrıca yarıya indirir; kurak ilde (gerçek hava) ayrıca indirim
async function sulamaBirimi(yapilar, hizmetler, plaka = null) {
  let b = TARIM.sulamaMaliyeti;
  if (aktifYapiVar(yapilar, 'SU_DEPOSU')) b /= 2;
  if (hizmetler.has('SULAMA_KANALI')) b *= 1 - BELEDIYE.etki.sulamaIndirim;
  if (plaka) b *= 1 - (await require('./iklim').kuraklik(plaka)).indirim;
  return L.yuvarla(b);
}
function verimKati(p) {
  return Math.min(TARIM.maxVerimKati, Math.max(1, Math.round(p.area_m2 / TARIM.verimAlanBirimi)));
}
function ekinDurumu(e, yapilar, t = simdi()) {
  const u = URUNLER[e.crop_type];
  const hat = aktifYapiVar(yapilar, 'SULAMA_HATTI');
  const sulama = hat ? u.sulama : e.waterings;
  const toplam = e.ready_at - e.planted_at;
  return {
    id: e.id, tip: e.crop_type, ad: u.ad, ikon: u.ikon,
    ekim: e.planted_at, hazir: e.ready_at, kalanMs: Math.max(0, e.ready_at - t),
    ilerleme: Math.min(1, (t - e.planted_at) / toplam),
    olgun: t >= e.ready_at,
    sulama, gerekenSulama: u.sulama, otomatikSulama: hat,
    sonrakiSulamaMs: e.last_watered_at ? Math.max(0, e.last_watered_at + TARIM.sulamaAraligiMs - t) : 0,
    ...tazelik(e, yapilar, t),
    don: !!e.don, yagmurAt: e.yagmur_at || null, mevsim: e.mevsim || null,
    ortuBitis: e.ortu_bitis && e.ortu_bitis > t ? e.ortu_bitis : null, gubre: !!e.gubre, ilac: !!e.ilac,
  };
}
// Olgun ekin: taze süre boyunca tam verim, sonra doğrusal düşüş, sonunda çürüme (ambar taze süreyi uzatır)
function tazelik(e, yapilar, t) {
  const taze = BOZULMA.tazeMs * (aktifYapiVar(yapilar, 'AMBAR', t) ? BOZULMA.ambarKati : 1);
  const bozulmaBas = e.ready_at + taze, curume = bozulmaBas + BOZULMA.bozulmaMs;
  if (t < bozulmaBas) return { tazelik: 'TAZE', verimOrani: 1, bozulmayaMs: Math.max(0, bozulmaBas - t), curumeyeMs: curume - t };
  if (t >= curume) return { tazelik: 'CURUDU', verimOrani: 0, bozulmayaMs: 0, curumeyeMs: 0 };
  const oran = 1 - (1 - BOZULMA.minVerimOrani) * ((t - bozulmaBas) / BOZULMA.bozulmaMs);
  return { tazelik: 'BOZULUYOR', verimOrani: Math.round(oran * 100) / 100, bozulmayaMs: 0, curumeyeMs: curume - t };
}

const ek = (userId, id, urun) => db.tx(async () => {
  // Parsel kilidi: aynı tarlaya eşzamanlı iki ekim yapılamasın
  const p = await parselGetir(id, { kilit: true });
  await require('./kira').kullanimHakki(p, userId);
  if (p.zoning_type !== 'TARIM') throw new OyunHatasi(422, 'Ekim yalnızca tarım parsellerinde yapılabilir', 'IMAR_IHLALI');
  const u = bul(URUNLER, urun);
  if (!u) throw new OyunHatasi(400, 'Bilinmeyen ürün');
  if (u.mamul) throw new OyunHatasi(400, `${u.ad} ekilmez; tesislerde üretilir`);
  if (u.bolgeler && !u.bolgeler.includes(p.plaka)) throw new OyunHatasi(422, `${u.ad} yöresel bir üründür; yalnızca ${u.bolgeAd} illerinde ekilebilir`, 'BOLGE_DISI');
  if (await q.ekin.get(id)) throw new OyunHatasi(409, 'Bu tarlada zaten ekin var');
  const kat = verimKati(p);
  const tx = L.yeniTx();
  await L.harca(userId, u.tohum * kat, `Tohum: ${u.ad} ×${kat} (${id})`, tx);
  const t = simdi();
  const dunya = require('./dunya');
  const buyume = await dunya.buyumeKati(urun, aktifYapiVar(await q.yapilar.all(id), 'SERA', t), t, p.plaka) * require('./mini-etkinlik').buyumeKat(t);
  const ilkEkin = await require('./sihirbaz').hizliIlkEkin(userId);   // ilk giriş sihirbazında ilk ekin 1 dakikada olur
  const m = dunya.mevsim(t);
  await db.run(`INSERT INTO crops (parcel_id, user_id, crop_type, planted_at, ready_at, mevsim) VALUES (?, ?, ?, ?, ?, ?)`,
    id, userId, urun, t, t + (ilkEkin ? Math.min(SIHIRBAZ_ILK_EKIN(), Math.round(u.sureMs * buyume)) : Math.round(u.sureMs * buyume)), m.kod);
  await L.denetim({ aktor: userId, eylem: 'CROP_PLANTED', varlik: id, sonra: { urun }, bolge: p.region_id, herkese: true });
  const gorev = await gorevTamamla(userId, 'ILK_EKIM', tx);
  return { tamam: true, maliyet: u.tohum * kat, buyume, mevsim: m.ad, gorev };
});

const sula = (userId, id) => db.tx(async () => {
  const p = await parselGetir(id, { kilit: true });
  await require('./kira').kullanimHakki(p, userId);
  const e = await q.ekin.get(id);
  if (!e) throw new OyunHatasi(409, 'Sulanacak ekin yok');
  const yapilar = await q.yapilar.all(id);
  if (aktifYapiVar(yapilar, 'SULAMA_HATTI')) throw new OyunHatasi(409, 'Sulama hattı bu tarlayı otomatik suluyor');
  const u = URUNLER[e.crop_type];
  if (e.waterings >= u.sulama) throw new OyunHatasi(409, 'Ekin yeterince sulandı');
  const t = simdi();
  if (t >= e.ready_at) throw new OyunHatasi(409, 'Ekin olgunlaştı; sulama artık verimi değiştirmez, hasat et');
  if (e.last_watered_at && t - e.last_watered_at < TARIM.sulamaAraligiMs) {
    throw new OyunHatasi(429, 'Toprak hâlâ nemli; biraz sonra tekrar sula');
  }
  const kat = verimKati(p);
  const birim = await sulamaBirimi(yapilar, await belediye.mahalleHizmetleri(p.region_id), p.plaka) * await require('./koy-meydani').oran(userId, 'CESME');   // köy çeşmesi
  const tx = L.yeniTx();
  await L.harca(userId, L.yuvarla(birim * kat), `Sulama/enerji (${id})`, tx);
  await L.denetim({ aktor: userId, eylem: 'CROP_WATERED', varlik: id, bolge: p.region_id });
  const r = await db.run(`UPDATE crops SET waterings = waterings + 1, last_watered_at = ? WHERE id = ? AND waterings = ?`, t, e.id, e.waterings);
  if (r.changes !== 1) throw new OyunHatasi(409, 'Eşzamanlı işlem, tekrar deneyin');
  const gorev = await gorevTamamla(userId, 'ILK_SULAMA', tx);
  return { tamam: true, maliyet: L.yuvarla(birim * kat), gorev };
});

const hasat = (userId, id) => db.tx(async () => {
  const p = await parselGetir(id, { kilit: true });
  await require('./kira').kullanimHakki(p, userId);
  const e = await q.ekin.get(id);
  if (!e) throw new OyunHatasi(409, 'Hasat edilecek ekin yok');
  const t = simdi();
  if (t < e.ready_at) throw new OyunHatasi(409, 'Ekin henüz olgunlaşmadı');
  const yapilar = await q.yapilar.all(id);
  const u = URUNLER[e.crop_type];
  const durum = ekinDurumu(e, yapilar, t);
  const sulamaOrani = Math.min(1, durum.sulama / u.sulama);
  let bonus = 0;
  if (aktifYapiVar(yapilar, 'SULAMA_HATTI')) bonus += TARIM.sulamaHattiBonus;
  if (aktifYapiVar(yapilar, 'SERA')) bonus += TARIM.seraBonus;
  if ((await belediye.mahalleHizmetleri(p.region_id)).has('SULAMA_KANALI')) bonus += BELEDIYE.etki.hasatBonus;
  bonus += await require('./uretim').meslekBonusu(userId, 'CIFTCI');
  bonus += await require('./kooperatif').hasatPrimi(userId);
  bonus += await require('./koleksiyon').hasatBonusu(p.owner_user_id, p.il_id);   // yöre seti tamamsa
  const miktar = durum.tazelik === 'CURUDU' ? 0
    : Math.max(1, Math.round(u.verim * verimKati(p) * (0.4 + 0.6 * sulamaOrani) * (1 + bonus) * durum.verimOrani * (e.don ? HAVA.donVerimKati : 1) * (e.afet_kati ?? 1) * (e.gubre ? 1 + CARSI.etki.gubreBonus : 1)));
  // Çift hasat engeli: yalnızca GROWING durumdaki kayıt güncellenir
  const r = await db.run(`UPDATE crops SET status = 'HARVESTED', harvested_qty = ? WHERE id = ? AND status = 'GROWING'`, miktar, e.id);
  if (r.changes !== 1) throw new OyunHatasi(409, 'Bu ekin zaten hasat edildi');
  const tx = L.yeniTx();
  if (!miktar) {
    await L.denetim({ anahtar: `CROP_ROTTED:${e.id}`, aktor: userId, eylem: 'CROP_ROTTED', varlik: id, sonra: { urun: e.crop_type }, bolge: p.region_id });
    return { tamam: true, urun: e.crop_type, miktar: 0, curudu: true, mesaj: `${u.ad} tarlada çürümüş; tarla temizlendi, yeniden ekebilirsin.` };
  }
  // Ürün ekenin envanterine gider (kira bitmişse de kiracının ekini kendisine); sahibin ekininden ortaklar payını alır
  const pay = await require('./kira').hasatPaylastir(p, e.user_id, miktar, e.crop_type, tx);
  await L.envanterDegis(e.user_id, e.crop_type, pay.sahibe, `Hasat ${id}`, tx);
  if (e.user_id !== userId) await bildir(e.user_id, `${id} parselindeki ekinin hasat edildi: ${pay.sahibe} ${u.ad} envanterine eklendi.`, `parsel:${id}`);
  await L.denetim({ anahtar: `CROP_HARVESTED:${e.id}`, aktor: userId, eylem: 'CROP_HARVESTED', varlik: id,
    sonra: { urun: e.crop_type, miktar }, bolge: p.region_id, herkese: true });
  const gorev = await gorevTamamla(userId, 'ILK_HASAT', tx);
  return { tamam: true, urun: e.crop_type, miktar: pay.sahibe, toplam: miktar, ortakPaylari: pay.paylar, sulamaOrani, bonus, verimOrani: durum.verimOrani, gorev };
});

// ---------- Yapı bakımı (§4.4) ----------
const bakimYap = (userId, id) => db.tx(async () => {
  // Parsel kilidi: eşzamanlı iki bakım aynı yıpranmayı iki kez ücretlendirmesin
  const p = await parselGetir(id, { kilit: true });
  sahibiOlmali(p, userId);
  const t = simdi();
  const yapilar = (await q.yapilar.all(id)).filter((s) => s.status === 'ACTIVE' && saglik(s, t) < 100);
  if (!yapilar.length) throw new OyunHatasi(409, 'Bakım gerektiren yapı yok');
  const tx = L.yeniTx();
  const bedel = Math.max(1, L.yuvarla(yapilar.reduce((a, s) => a + bakimMaliyeti(s, t), 0) * await require('./koy-meydani').oran(userId, 'SAGLIK_OCAGI')));
  // Nalburdan alınan bakım kiti bakımı ücretsiz yapar; yalnızca bedel kitin fiyatını aşıyorsa harcanır
  const kit = bedel > CARSI.urunler.BAKIM_KITI.fiyat && await require('./carsi').stoktanKullan(userId, 'BAKIM_KITI', `Bakım kiti (${id})`, tx);
  const tutar = kit ? 0 : bedel;
  if (!kit) {
    await L.harca(userId, tutar, `Yapı bakımı (${id})`, tx);
    await belediye.belediyePayi(p.ilce_id, tutar, 'ruhsatPayi', 'bakım ruhsat payı', tx);
  }
  const guncelle = db.sorgu(`UPDATE structures SET bakim_at = ? WHERE id = ?`);
  // Bakımsız dönemde kira birikmez: eşiğin altındaki kira yapısının sayacı bakımla yeniden başlar
  const kiraSifirla = db.sorgu(`UPDATE structures SET gelir_at = ? WHERE id = ?`);
  for (const s of yapilar) {
    if (YAPILAR[s.type]?.gelir && saglik(s, t) < BAKIM.etkisizEsik) await kiraSifirla.run(t, s.id);
    await guncelle.run(t, s.id);
  }
  await L.denetim({ aktor: userId, eylem: 'STRUCTURES_MAINTAINED', varlik: id, sonra: { adet: yapilar.length, tutar }, bolge: p.region_id });
  return { tamam: true, tutar, adet: yapilar.length, kit };
});

// ---------- NPC pazarı (§5.2: sınırlı taban talep) ----------
const talepOku = db.sorgu(`SELECT sold FROM npc_demand WHERE day = ? AND item_id = ?`);
const talepYaz = db.sorgu(`INSERT INTO npc_demand (day, item_id, sold) VALUES (?, ?, ?)
                             ON CONFLICT(day, item_id) DO UPDATE SET sold = npc_demand.sold + excluded.sold`);
function birimFiyat(urun, satilan) {
  const u = URUNLER[urun];
  const oran = Math.min(1, satilan / NPC_PAZAR.gunlukTalep);
  return u.tabanFiyat * (NPC_PAZAR.fiyatUst - (NPC_PAZAR.fiyatUst - NPC_PAZAR.fiyatAlt) * oran);
}
async function pazarDurumu() {
  const gun = bugun();
  const satilanlar = new Map((await db.all(`SELECT item_id, sold FROM npc_demand WHERE day = ?`, gun)).map((r) => [r.item_id, r.sold]));
  return Object.entries(URUNLER).map(([kod, u]) => {
    const satilan = satilanlar.get(kod) || 0;
    return { kod, ad: u.ad, ikon: u.ikon, fiyat: L.yuvarla(birimFiyat(kod, satilan)),
      kalanTalep: Math.max(0, NPC_PAZAR.gunlukTalep - satilan), gunlukTalep: NPC_PAZAR.gunlukTalep };
  });
}
const npcSat = (userId, urun, miktar) => db.tx(async () => {
  if (!bul(URUNLER, urun)) throw new OyunHatasi(400, 'Bilinmeyen ürün');
  if (URUNLER[urun].dukkan) throw new OyunHatasi(422, `${URUNLER[urun].ad} dükkân ürünüdür; NPC tüccar almaz`);
  await require('./ekonomi').envanterBozulmasi(userId);
  if (!Number.isInteger(miktar) || miktar < 1 || miktar > 10000) throw new OyunHatasi(400, 'Geçersiz miktar');
  const gun = bugun();
  // Günlük talep sayaçları (ortak ve kişisel): eşzamanlı satışlar aynı kalan talebi iki kez kullanamasın
  await db.kilit(`npc-talep:${gun}:${urun}`);
  const satilan = (await talepOku.get(gun, urun))?.sold || 0;
  const kisisel = (await db.get(`SELECT sold FROM npc_kisisel WHERE day = ? AND user_id = ? AND item_id = ?`, gun, userId, urun))?.sold || 0;
  // Ortak limit ya da oyuncunun kişisel tabanı (hangisi büyükse)
  const kalan = Math.max(NPC_PAZAR.gunlukTalep - satilan, (NPC_PAZAR.kisiselTaban || 0) - kisisel);
  if (kalan <= 0) throw new OyunHatasi(409, 'NPC tüccarın bugünkü alım limiti doldu; yarın tekrar dene', 'TALEP_DOLDU');
  const adet = Math.min(miktar, kalan);
  // Ortalama fiyat: satış ilerledikçe fiyat düşer (sınırsız geri alım yok)
  const ort = (birimFiyat(urun, satilan) + birimFiyat(urun, satilan + adet)) / 2;
  const pazarYeri = await belediye.pazarBonusu(userId);   // belediyenin semt pazarı olan mahallede parseli varsa
  const koopPrimi = await require('./kooperatif').satisPrimi(userId);
  const tutar = L.yuvarla(ort * adet * (pazarYeri ? 1 + BELEDIYE.etki.pazarBonus : 1) * (1 + koopPrimi) * await require('./koy-meydani').oran(userId, 'PAZAR_YERI') * require('./mini-etkinlik').tuccarKat());   // kuruş hassasiyeti (defter 2 basamak)
  if (tutar < 0.01) throw new OyunHatasi(409, 'Tüccarın bugünkü fiyatı bu miktara bir kuruş bile etmiyor; daha çok ürünle ya da yarın dene', 'DEGERSIZ');
  const tx = L.yeniTx();
  await L.envanterDegis(userId, urun, -adet, 'NPC pazar satışı', tx);
  await L.aktar({ kaynak: 'SYS:NPC', hedef: L.hesap(userId), tutar, sebep: `${adet} ${URUNLER[urun].ad} satışı`, tx });
  await talepYaz.run(gun, urun, adet);
  await db.run(`INSERT INTO npc_kisisel (day, user_id, item_id, sold) VALUES (?, ?, ?, ?)
              ON CONFLICT(day, user_id, item_id) DO UPDATE SET sold = npc_kisisel.sold + excluded.sold`, gun, userId, urun, adet);
  await L.denetim({ anahtar: `TRADE_SETTLED:${tx}`, aktor: userId, eylem: 'TRADE_SETTLED', varlik: urun,
    sonra: { adet, tutar, karsi: 'NPC' }, herkese: false });
  const gorev = await gorevTamamla(userId, 'ILK_SATIS', tx);
  return { tamam: true, adet, tutar, birimFiyat: L.yuvarla(ort), kismi: adet < miktar, pazarYeri, koopPrimi, gorev };
});

// ---------- Ziyaret (§7.1) ----------
const ziyaret = (userId, id) => db.tx(async () => {
  const p = await parselGetir(id);
  if (!p.owner_user_id) throw new OyunHatasi(409, 'Boş parsel ziyaret edilemez');
  if (p.owner_user_id === userId) throw new OyunHatasi(409, 'Kendi parselini ziyaret edemezsin');
  // Günde bir ziyaret: eşzamanlı iki istek ikisi de "bugün yok" görmesin
  await db.kilit(`ziyaret:${userId}:${id}`);
  const dahaOnce = await db.get(`SELECT 1 FROM visits WHERE visitor_id = ? AND parcel_id = ? AND created_at >= ?`, userId, id, gunBasiMetni());
  if (dahaOnce) throw new OyunHatasi(409, 'Bu parseli bugün zaten ziyaret ettin');
  await db.run(`INSERT INTO visits (visitor_id, parcel_id) VALUES (?, ?)`, userId, id);
  const sahip = await q.kullanici.get(p.owner_user_id);
  await L.denetim({ aktor: userId, eylem: 'PARCEL_VISITED', varlik: id, sonra: { sahip: sahip.display_name }, bolge: p.region_id, herkese: true });
  const gorev = await gorevTamamla(userId, 'KOMSU_ZIYARET', L.yeniTx());
  return { tamam: true, sahip: sahip.display_name, gorev };
});

// ---------- Oyuncu özeti ----------
async function oyuncuOzeti(userId) {
  await bekleyenleriIsle();
  const bozulma = await require('./ekonomi').envanterBozulmasi(userId);
  const u = await db.get(`SELECT id, email, display_name, created_at FROM users WHERE id = ?`, userId);
  const parseller = await db.all(`SELECT p.id, p.zoning_type, p.area_m2, p.centroid_lon AS lon, p.centroid_lat AS lat, p.grid_x, p.grid_y,
                                  p.region_id AS mahalleId, p.il_id AS ilId, r.name AS mahalle, ri.name AS ilce, rl.name AS il
                                FROM parcels p JOIN regions r ON r.id = p.region_id JOIN regions ri ON ri.id = p.ilce_id JOIN regions rl ON rl.id = p.il_id
                                WHERE p.owner_user_id = ? ORDER BY p.acquired_at`, userId);
  const t = simdi();
  const portfoy = [];
  for (const p of parseller) {
    const yapilar = await q.yapilar.all(p.id);
    const e = await q.ekin.get(p.id);
    portfoy.push({ ...p, adaParsel: adaParsel(p.grid_x, p.grid_y), imarAd: IMAR[p.zoning_type].ad, yapiSayisi: yapilar.filter((s) => s.status === 'ACTIVE').length,
      insaatta: yapilar.filter((s) => s.status === 'BUILDING').length, ekin: e && ekinDurumu(e, yapilar, t) });
  }
  const ciftlik = require('./ciftlik');
  return {
    kullanici: { id: u.id, ad: u.display_name, email: u.email, katilim: u.created_at },
    bakiye: await L.bakiye(userId),
    portfoy,
    envanter: (await L.envanter(userId)).map((i) => ({ ...i, ad: URUNLER[i.item_id]?.ad || i.item_id, ikon: URUNLER[i.item_id]?.ikon || '📦',
      gunlukBozulma: bozulma.oranlar[i.item_id] ?? 0 })),
    ambar: bozulma.ambar,
    gorevler: await gorevler(userId),
    seviye: (({ tp, seviye, esik, sonraki, odulBekleyen }) => ({ tp, seviye, esik, sonraki, odulBekleyen: odulBekleyen.length }))(await ciftlik.seviyeBilgisi(userId)),
    gunlukOdul: (await ciftlik.gunlukDurum(userId)).alinabilir,
    limitler: { maxParsel: HESAP.maxParsel, maxParselMahalle: HESAP.maxParselMahalle },
    baslangicTarlasi: await require('./baslangic').hakVar(userId),   // istemci "Tarlamı al" düğmesini gösterir
    sihirbaz: await require('./sihirbaz').aktifMi(userId),   // ilk giriş sihirbazı sürüyor mu
    // Seçimlerde aday olmuş ya da makam taşımış oyuncuya köy yönetimi seviyeden bağımsız açık kalır
    siyasette: !!(await db.get(`SELECT 1 FROM adaylar WHERE user_id = ? UNION SELECT 1 FROM muhtarlar WHERE user_id = ? UNION SELECT 1 FROM belediye_uyeleri WHERE user_id = ? LIMIT 1`, userId, userId, userId)),
    simdi: t,
  };
}

function cuzdanHareketleri(userId) {
  return db.all(`SELECT created_at, reason, credit - debit AS tutar FROM wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 40`, userId);
}

// region_id mahalle düzeyindedir; ilçe ve il adları üst bölgelerden gelir. ilId verilirse yalnızca o il.
async function haberAkisi({ ilId = null, limit = 30 } = {}) {
  const satirlar = await db.all(`
    SELECT * FROM (
      SELECT a.id, a.action, a.entity, a.after_json, a.created_at, u.display_name AS aktor,
        CASE r.type WHEN 'MAHALLE' THEN r.name END AS mahalle,
        CASE r.type WHEN 'MAHALLE' THEN ri.name WHEN 'ILCE' THEN r.name END AS ilce,
        CASE r.type WHEN 'MAHALLE' THEN rl.name WHEN 'ILCE' THEN ri.name WHEN 'IL' THEN r.name END AS il,
        CASE r.type WHEN 'MAHALLE' THEN rl.id WHEN 'ILCE' THEN ri.id WHEN 'IL' THEN r.id END AS il_id
      FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN regions r ON r.id = a.region_id
        LEFT JOIN regions ri ON ri.id = r.parent_id LEFT JOIN regions rl ON rl.id = ri.parent_id
      WHERE a.public = 1 ${OZELLIK.siyaset ? '' : `AND a.action NOT IN (${SIYASI_EYLEMLER.map((x) => `'${x}'`).join(',')})`} ORDER BY a.id DESC LIMIT 400
    ) son ${ilId ? 'WHERE il_id = ?' : ''} ORDER BY id DESC LIMIT ?`, ...(ilId ? [ilId, limit] : [limit]));
  return satirlar.map((s) => ({ ...s, after: s.after_json ? JSON.parse(s.after_json) : null, after_json: undefined }));
}

// ---------- Harita katmanları (görünür alan) ----------
// Yalnızca sahipli ya da ilandaki parseller döner; boş hücrelerin imarı istemciye karo görüntüsü olarak gider.
const MAKS_HUCRE_KENARI = 600;   // ≈ 18 km — daha geniş alanlar istenmez (§2.4)
// Parselin harita geometrisi: deneme ilçesinin tarlalarında gerçek tarla şekli, diğerlerinde hücre karesi
async function parselGeometrisi(p) {
  if (p.geom_version === 'tarla-v1') { const T = require('./harita/tarla'), t = await T.tarlaGetir(p.id); if (t) return T.geometri(t); }
  return I.hucrePoligonu(p.grid_x, p.grid_y);
}
async function tarlaBilgisi(p) {
  if (p.geom_version !== 'tarla-v1') return null;
  const t = await require('./harita/tarla').tarlaGetir(p.id);
  return t ? { yon: t.yon, alan: t.alan_m2, hucre: t.uye } : null;
}

async function haritaParselleri(userId, bbox) {
  await bekleyenleriIsle();
  const { x0, x1, y0, y1 } = I.kutuHucreleri(bbox);
  if (x1 - x0 > MAKS_HUCRE_KENARI || y1 - y0 > MAKS_HUCRE_KENARI) throw new OyunHatasi(400, 'Alan çok geniş; yakınlaşın');
  const t = simdi();
  const satirlar = await db.all(`
    SELECT p.id, p.zoning_type, p.owner_user_id, p.grid_x, p.grid_y, p.geom_version, p.centroid_lon, p.centroid_lat, u.is_npc, u.display_name AS sahip,
      EXISTS (SELECT 1 FROM listings l WHERE l.parcel_id = p.id AND l.status = 'ACTIVE') AS ilanda
    FROM parcels p LEFT JOIN users u ON u.id = p.owner_user_id
    WHERE p.grid_x BETWEEN ? AND ? AND p.grid_y BETWEEN ? AND ?
      AND (p.owner_user_id IS NOT NULL OR EXISTS (SELECT 1 FROM listings l WHERE l.parcel_id = p.id AND l.status = 'ACTIVE'))
    LIMIT 5000`, x0, x1, y0, y1);
  // Yapılar ve ekinler alan için toplu okunur (parsel başına ayrı sorgu yerine)
  const yapiMap = new Map(), ekinMap = new Map();
  for (const y of await db.all(`SELECT s.parcel_id, s.type, s.status, s.completes_at FROM structures s JOIN parcels p ON p.id = s.parcel_id
                                WHERE p.grid_x BETWEEN ? AND ? AND p.grid_y BETWEEN ? AND ? ORDER BY s.id`, x0, x1, y0, y1)) {
    if (!yapiMap.has(y.parcel_id)) yapiMap.set(y.parcel_id, []);
    yapiMap.get(y.parcel_id).push({ type: y.type, status: y.status, completes_at: y.completes_at });
  }
  for (const e of await db.all(`SELECT c.* FROM crops c JOIN parcels p ON p.id = c.parcel_id
                                WHERE p.grid_x BETWEEN ? AND ? AND p.grid_y BETWEEN ? AND ? AND c.status = 'GROWING' ORDER BY c.id`, x0, x1, y0, y1)) {
    if (!ekinMap.has(e.parcel_id)) ekinMap.set(e.parcel_id, e);
  }
  const ciftlik = require('./ciftlik');
  const features = [];
  for (const s of satirlar) {
    const yapilar = yapiMap.get(s.id) || [];
    const e = ekinMap.get(s.id);
    features.push({
      type: 'Feature',
      geometry: await parselGeometrisi(s),
      properties: {
        id: s.id, z: s.zoning_type, gx: s.grid_x, gy: s.grid_y,
        // tarla (deneme): 3B katman parseli tarla merkezine ve şekline oturtur
        ...(s.geom_version === 'tarla-v1' ? { tg: 1, mlon: s.centroid_lon, mlat: s.centroid_lat, yon: (await tarlaBilgisi(s))?.yon ?? 0 } : {}),
        // s: 1 benim, 2 başka oyuncu, 0 sahipsiz (yalnızca ilan varsa gelir)
        s: s.owner_user_id ? (s.owner_user_id === userId ? 1 : 2) : 0,
        sahip: s.sahip, npc: s.is_npc ? 1 : 0,
        y: yapilar.filter((x) => x.status === 'ACTIVE').length, i: yapilar.filter((x) => x.status === 'BUILDING').length,
        e: e ? (e.ready_at <= t ? 2 : 1) : 0,
        l: s.ilanda ? 1 : 0,   // Postgres EXISTS mantıksal döner; yanıt SQLite'taki gibi 0/1
        // çiftlik göstergeleri: su = sulanmayı bekliyor, hh = hayvan ürünü hazır, ss = süsler (tür:yuva)
        su: e && e.ready_at > t && !yapilar.some((x) => x.type === 'SULAMA_HATTI' && x.status === 'ACTIVE')
          && e.waterings < (URUNLER[e.crop_type]?.sulama || 0) && (!e.last_watered_at || t - e.last_watered_at > TARIM.sulamaAraligiMs) ? 1 : 0,
        hh: s.owner_user_id ? (await ciftlik.parselHayvanHazir(s.id, t) ? 1 : 0) : 0,
        ss: s.owner_user_id ? await ciftlik.susKodu(s.id) : '',
        or: e && e.ortu_bitis > t ? 1 : 0,   // tarla örtüsü (3B tünel)
        // 3B sahne için yapı ve ekin özeti (istemci yapilar3d.js)
        yp: yapilar.map((x) => `${x.type}:${x.status === 'ACTIVE' ? 1 : 0}`).join(','),
        kz: s.owner_user_id && !s.is_npc ? await kozmetikKodu(s.owner_user_id) : '',
        ek: e ? `${e.crop_type}:${Math.min(1, (t - e.planted_at) / (e.ready_at - e.planted_at)).toFixed(2)}` : '',
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

// İl ve ilçe listesi (geometrisiz; harita sınırları istemciye ayrı dosyayla gider)
async function bolgeler() {
  return (await db.all(`SELECT id, parent_id, type, code, name, plaka, center_lon, center_lat, bbox, attractiveness
                     FROM regions WHERE type IN ('ULKE','IL','ILCE') ORDER BY id`))
    .map((r) => ({ ...r, bbox: r.bbox ? JSON.parse(r.bbox) : null }));
}

// Ülke görünümü için il bazında oyun istatistikleri
function ilIstatistikleri() {
  return db.all(`
    SELECT rl.plaka, rl.name AS ad,
      COUNT(p.id) AS parsel, COUNT(DISTINCT p.owner_user_id) AS oyuncu,
      (SELECT COUNT(*) FROM listings l JOIN parcels pp ON pp.id = l.parcel_id WHERE pp.il_id = rl.id AND l.status = 'ACTIVE') AS ilan,
      (SELECT COUNT(*) FROM structures s JOIN parcels pp ON pp.id = s.parcel_id WHERE pp.il_id = rl.id) AS yapi,
      (SELECT COUNT(*) FROM secimler x JOIN regions rm ON rm.id = x.region_id JOIN regions rc ON rc.id = rm.parent_id
        WHERE rc.parent_id = rl.id AND x.asama IN ('DUYURU','ADAYLIK','KAMPANYA','OYLAMA','ITIRAZ')) AS secim
    FROM regions rl LEFT JOIN parcels p ON p.il_id = rl.id AND p.owner_user_id IS NOT NULL
    WHERE rl.type = 'IL' GROUP BY rl.id, rl.plaka, rl.name ORDER BY rl.plaka`);
}

module.exports = {
  gorevTamamla,
  parselKarti, parselEdin, insaatBaslat, ek, sula, hasat, bakimYap, npcSat, ziyaret, saglik, aktifYapiVar, birimFiyat,
  oyuncuOzeti, cuzdanHareketleri, haberAkisi, haritaParselleri, bolgeler, ilIstatistikleri, pazarDurumu,
  insaatUygunluk, imarKullanimi, birincilBedel, tahsisFiyati, parseliBosalt, bekleyenleriIsle, tahminiDeger, parselDegeri,
  parselGetir, sahibiOlmali, gelismislikSkoru, ekinDurumu, bul, verimKati, bugun,
};
