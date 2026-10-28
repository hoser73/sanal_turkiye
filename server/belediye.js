// İlçe belediyesi (plan §6.1, §6.3, §6.4, Senaryo C). Oyun içidir; gerçek belediye değildir.
//
// Kasa  : BEL:<ilçe> hesabı. Gelirler kuralla sabittir (başkan oran belirleyemez, para basamaz):
//         oyundan zaten çıkan tahsis bedeli / ruhsat / pazar masrafının payı + aktif sakin başına günlük devlet katkısı.
// Talep : muhtar mahallesi için belediyeye ihtiyaç bildirir.
// Proje : başkan meclise teklif eder → meclis AÇIK oylar (başkan meclise başkanlık eder, oy eşitliğinde belirleyicidir)
//         → kabul edilirse bütçe kasadan PROJE:<id> emanetine ayrılır → yapım süresi → tamamlanınca hedef mahallede etki.
// Çıkar çatışması (§3.4, Senaryo C): hedef mahallede parseli olan üye oy kullanamaz; başkanın çıkarı varsa ya da proje
//         büyükse nitelikli çoğunluk (2/3) gerekir.
const db = require('./db');
const { BELEDIYE, SECIM, REFERANDUM } = require('./config/rules');
const L = require('./lib/ledger');
const secim = require('./secim');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const kasa = (ilceId) => `BEL:${ilceId}`;
const emanet = (projeId) => `PROJE:${projeId}`;
const bul = (tablo, kod) => (typeof kod === 'string' && Object.hasOwn(tablo, kod) ? tablo[kod] : null);
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);
const OYLAR = ['EVET', 'HAYIR', 'CEKIMSER'];
const NITELIKLI_MIN_UYE = 2;   // nitelikli çoğunluk kararı tek kişiyle alınamaz

const q = {
  ilce: db.prepare(`SELECT r.*, rl.name AS il, rl.id AS il_id FROM regions r JOIN regions rl ON rl.id = r.parent_id WHERE r.id = ? AND r.type = 'ILCE'`),
  mahalle: db.prepare(`SELECT * FROM regions WHERE id = ? AND type = 'MAHALLE'`),
  uyeler: db.prepare(`SELECT b.*, u.display_name AS ad FROM belediye_uyeleri b JOIN users u ON u.id = b.user_id
                      WHERE b.region_id = ? AND b.baslangic <= ? AND b.bitis > ? ORDER BY (b.makam = 'BASKAN') DESC, b.id`),
  proje: db.prepare(`SELECT * FROM projeler WHERE id = ?`),
  cikarli: db.prepare(`SELECT 1 FROM parcels WHERE region_id = ? AND owner_user_id = ? LIMIT 1`),
  hizmetler: db.prepare(`SELECT tur FROM projeler WHERE hedef_region_id = ? AND durum = 'TAMAMLANDI'`),
};
const uyeler = (ilceId, t = simdi()) => q.uyeler.all(ilceId, t, t);
const cikarliMi = (userId, mahalleId) => !!q.cikarli.get(mahalleId, userId);

// ---------- Gelir (diğer modüllerin işlemleri içinde çağrılır) ----------
// Oyundan çıkan tutarın kuralla belirlenmiş payı ilçe kasasına aktarılır (oyuncudan ek kesinti yoktur)
function belediyePayi(ilceId, tutar, oranAdi, sebep, tx) {
  const pay = Math.floor(tutar * BELEDIYE.gelir[oranAdi]);
  if (ilceId && pay > 0) L.aktar({ kaynak: 'SYS:SINK', hedef: kasa(ilceId), tutar: pay, sebep: `Belediye geliri: ${sebep}`, tx });
}

// Aktif sakin başına günlük devlet katkısı: (ilçe, oyun günü) başına bir kez
let sonKatkiGunu = -1;
function gunlukKatki(t) {
  const gun = Math.floor(t / SECIM.gunMs);
  if (gun === sonKatkiGunu) return;   // gün değişmediyse tarama yok (bakım saniyede bir çalışır)
  sonKatkiGunu = gun;
  const ilceler = db.prepare(`
    SELECT p.ilce_id AS r, COUNT(DISTINCT p.owner_user_id) AS c FROM parcels p JOIN users u ON u.id = p.owner_user_id
    WHERE u.is_npc = 0 AND u.status = 'ACTIVE' GROUP BY p.ilce_id`).all();
  const isaretle = db.prepare(`INSERT OR IGNORE INTO belediye_katki_gunleri (region_id, gun, tutar) VALUES (?, ?, ?)`);
  db.transaction(() => {
    for (const { r, c } of ilceler) {
      const tutar = Math.min(BELEDIYE.gelir.gunlukTavan, c * BELEDIYE.gelir.sakinBasiGunluk);
      if (isaretle.run(r, gun, tutar).changes === 1) {
        L.aktar({ kaynak: 'SYS:MINT', hedef: kasa(r), tutar, sebep: `Belediye geliri: devlet katkısı (${c} aktif sakin)` });
      }
    }
  })();
}

// ---------- Etkiler (oyun motoru sorar) ----------
function mahalleHizmetleri(mahalleId) {
  return new Set(q.hizmetler.all(mahalleId).map((r) => r.tur));
}
function pazarBonusu(userId) {
  return !!db.prepare(`SELECT 1 FROM parcels p JOIN projeler j ON j.hedef_region_id = p.region_id
                       WHERE p.owner_user_id = ? AND j.tur = 'PAZAR_YERI' AND j.durum = 'TAMAMLANDI' LIMIT 1`).get(userId);
}

// ---------- Yetki kontrolleri ----------
function ilceGetir(ilceId) {
  const r = q.ilce.get(Number(ilceId));
  if (!r) throw new OyunHatasi(404, 'İlçe bulunamadı');
  return r;
}
function baskanOlmali(userId, ilceId) {
  const b = uyeler(ilceId).find((u) => u.makam === 'BASKAN');
  if (!b || b.user_id !== userId) throw new OyunHatasi(403, 'Bu işlem yalnızca görevdeki belediye başkanına açıktır');
  return b;
}
const kasaBakiye = (ilceId) => L.hesapBakiye(kasa(ilceId));
const bekleyenRezerv = (ilceId) => db.prepare(`SELECT COALESCE(SUM(maliyet), 0) AS s FROM projeler WHERE region_id = ? AND durum = 'MECLISTE'`).get(ilceId).s;

// ---------- Muhtar talebi ----------
const talepGonder = db.transaction((userId, mahalleId, govde) => {
  const m = q.mahalle.get(Number(mahalleId));
  if (!m) throw new OyunHatasi(404, 'Mahalle bulunamadı');
  const t = simdi();
  const muhtar = db.prepare(`SELECT * FROM muhtarlar WHERE region_id = ? AND baslangic <= ? AND bitis > ? ORDER BY id DESC LIMIT 1`).get(m.id, t, t);
  if (!muhtar || muhtar.user_id !== userId) throw new OyunHatasi(403, 'Belediyeye talep yalnızca mahallenin görevdeki muhtarı gönderebilir');
  const tur = bul(BELEDIYE.projeler, govde?.tur);
  if (!tur) throw new OyunHatasi(400, 'Geçersiz hizmet türü');
  const aciklama = secim.metin(govde?.aciklama, 'Açıklama', ...BELEDIYE.talep);
  if (db.prepare(`SELECT 1 FROM talepler WHERE mahalle_id = ? AND tur = ? AND durum = 'ACIK'`).get(m.id, govde.tur)) {
    throw new OyunHatasi(409, 'Bu hizmet için açık bir talebin zaten var');
  }
  const id = db.prepare(`INSERT INTO talepler (mahalle_id, ilce_id, user_id, tur, aciklama, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(m.id, m.parent_id, userId, govde.tur, aciklama, t).lastInsertRowid;
  L.denetim({ aktor: userId, eylem: 'MUHTAR_REQUEST', varlik: `TALEP:${id}`, bolge: m.id, herkese: true, sonra: { tur: govde.tur, ad: tur.ad } });
  const b = uyeler(m.parent_id).find((u) => u.makam === 'BASKAN');
  if (b) bildir(b.user_id, `${m.name} muhtarından talep: ${tur.ad}`, `belediye:${m.parent_id}`);
  return { tamam: true, talepId: id };
});

const talepKapat = db.transaction((userId, talepId, govde) => {
  const tl = db.prepare(`SELECT * FROM talepler WHERE id = ?`).get(Number(talepId));
  if (!tl) throw new OyunHatasi(404, 'Talep bulunamadı');
  baskanOlmali(userId, tl.ilce_id);
  if (tl.durum !== 'ACIK') throw new OyunHatasi(409, 'Talep açık değil');
  const gerekce = secim.metin(govde?.gerekce, 'Gerekçe', 10, 300);
  db.prepare(`UPDATE talepler SET durum = 'KAPANDI' WHERE id = ?`).run(tl.id);
  L.denetim({ aktor: userId, eylem: 'REQUEST_CLOSED', varlik: `TALEP:${tl.id}`, bolge: tl.mahalle_id, herkese: true, sonra: { gerekce } });
  bildir(tl.user_id, `Belediye talebini kapattı: ${gerekce}`, `belediye:${tl.ilce_id}`);
  return { tamam: true };
});

// ---------- Proje teklifi (başkan) ----------
const projeTeklif = db.transaction((userId, ilceId, govde) => {
  const ilce = ilceGetir(ilceId);
  baskanOlmali(userId, ilce.id);
  const tur = bul(BELEDIYE.projeler, govde?.tur);
  if (!tur) throw new OyunHatasi(400, 'Geçersiz proje türü');
  const hedef = q.mahalle.get(Number(govde?.hedefMahalleId));
  if (!hedef || hedef.parent_id !== ilce.id) throw new OyunHatasi(400, 'Hedef mahalle bu ilçede değil');
  const gerekce = secim.metin(govde?.gerekce, 'Gerekçe', ...BELEDIYE.gerekce);
  if (db.prepare(`SELECT 1 FROM projeler WHERE hedef_region_id = ? AND tur = ? AND durum IN ('MECLISTE','YAPIMDA','TAMAMLANDI')`).get(hedef.id, govde.tur)) {
    throw new OyunHatasi(409, `${hedef.name} için bu hizmet zaten var ya da süreçte`);
  }
  const kullanilabilir = kasaBakiye(ilce.id) - bekleyenRezerv(ilce.id);
  if (kullanilabilir < tur.maliyet) throw new OyunHatasi(409, `Kasa yetersiz: ₳${tur.maliyet} gerekli, kullanılabilir ₳${Math.max(0, Math.floor(kullanilabilir))}`, 'KASA_YETERSIZ');
  let talep = null;
  if (govde?.talepId) {
    talep = db.prepare(`SELECT * FROM talepler WHERE id = ? AND ilce_id = ? AND durum = 'ACIK'`).get(Number(govde.talepId), ilce.id);
    if (!talep) throw new OyunHatasi(400, 'Talep bulunamadı ya da açık değil');
  }
  const sebepler = [];
  if (cikarliMi(userId, hedef.id)) sebepler.push('başkanın hedef mahallede parseli var');
  if (tur.maliyet >= BELEDIYE.buyukProjeEsigi) sebepler.push('büyük proje');
  if (sebepler.length) {
    const uygun = uyeler(ilce.id).filter((u) => !cikarliMi(u.user_id, hedef.id)).length;
    if (uygun < NITELIKLI_MIN_UYE) {
      throw new OyunHatasi(409, `Bu proje nitelikli çoğunluk (2/3) gerektiriyor (${sebepler.join(', ')}). Bunun için hedef mahallede parseli olmayan en az ${NITELIKLI_MIN_UYE} meclis üyesi gerekir; şu an ${uygun}.`, 'NITELIKLI_UYE_YOK');
    }
  }
  const t = simdi();
  const id = db.prepare(`INSERT INTO projeler (region_id, hedef_region_id, tur, maliyet, gerekce, talep_id, teklif_eden_id, durum, nitelikli, nitelikli_sebep, oylama_bitis, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'MECLISTE', ?, ?, ?, ?)`)
    .run(ilce.id, hedef.id, govde.tur, tur.maliyet, gerekce, talep?.id ?? null, userId, sebepler.length ? 1 : 0, sebepler.join(', ') || null,
      t + BELEDIYE.meclisOylamaMs, t).lastInsertRowid;
  if (talep) db.prepare(`UPDATE talepler SET durum = 'TEKLIFE_DONUSTU', proje_id = ? WHERE id = ?`).run(id, talep.id);
  L.denetim({ aktor: userId, eylem: 'PROJECT_PROPOSED', varlik: `PROJE:${id}`, bolge: hedef.id, herkese: true,
    sonra: { tur: govde.tur, ad: tur.ad, maliyet: tur.maliyet, nitelikli: sebepler.length > 0 } });
  for (const u of uyeler(ilce.id)) if (u.user_id !== userId) bildir(u.user_id, `Meclis gündemi: ${hedef.name} için ${tur.ad} (₳${tur.maliyet})`, `belediye:${ilce.id}`);
  if (talep) bildir(talep.user_id, `Talebin meclis gündemine alındı: ${tur.ad}`, `belediye:${ilce.id}`);
  return { tamam: true, projeId: id, nitelikli: sebepler.length > 0 };
});

// ---------- Meclis oyu (açık) ----------
const meclisOyu = db.transaction((userId, projeId, govde) => {
  const p = q.proje.get(Number(projeId));
  if (!p) throw new OyunHatasi(404, 'Proje bulunamadı');
  if (p.durum !== 'MECLISTE' || simdi() >= p.oylama_bitis) throw new OyunHatasi(409, 'Bu proje için meclis oylaması kapalı');
  if (!uyeler(p.region_id).some((u) => u.user_id === userId)) throw new OyunHatasi(403, 'Yalnızca görevdeki meclis üyeleri ve başkan oy kullanabilir');
  if (cikarliMi(userId, p.hedef_region_id)) {
    throw new OyunHatasi(403, 'Çıkar çatışması: projenin hedef mahallesinde parselin var; bu kararda oy kullanamazsın', 'CIKAR_CATISMASI');
  }
  const oy = String(govde?.oy || '');
  if (!OYLAR.includes(oy)) throw new OyunHatasi(400, 'Oy EVET, HAYIR ya da CEKIMSER olmalı');
  db.prepare(`INSERT INTO proje_oylari (proje_id, user_id, oy, created_at) VALUES (?, ?, ?, ?)
              ON CONFLICT(proje_id, user_id) DO UPDATE SET oy = excluded.oy, created_at = excluded.created_at`).run(p.id, userId, oy, simdi());
  L.denetim({ aktor: userId, eylem: 'COUNCIL_VOTE', varlik: `PROJE:${p.id}`, bolge: p.hedef_region_id, herkese: true,
    sonra: { oy, tur: p.tur, ad: BELEDIYE.projeler[p.tur].ad } });
  return { tamam: true, oy };
});

// ---------- Karar ve yapım (tembel, idempotent) ----------
function kararVer(p, t) {
  const tur = BELEDIYE.projeler[p.tur];
  const hedef = q.mahalle.get(p.hedef_region_id);
  const uyelerSimdi = uyeler(p.region_id, p.oylama_bitis - 1);
  const uygun = uyelerSimdi.filter((u) => !cikarliMi(u.user_id, p.hedef_region_id));
  const cikarli = uyelerSimdi.filter((u) => cikarliMi(u.user_id, p.hedef_region_id)).map((u) => u.ad);
  const oylar = db.prepare(`SELECT user_id, oy FROM proje_oylari WHERE proje_id = ?`).all(p.id).filter((o) => uygun.some((u) => u.user_id === o.user_id));
  const say = (x) => oylar.filter((o) => o.oy === x).length;
  const evet = say('EVET'), hayir = say('HAYIR'), cekimser = say('CEKIMSER');
  const yeter = Math.floor(uygun.length / 2) + 1;
  const baskan = uygun.find((u) => u.makam === 'BASKAN');
  const baskanOyu = baskan && oylar.find((o) => o.user_id === baskan.user_id)?.oy;
  let kabul = false, sebep;
  if (!uygun.length) sebep = 'Karar yeter sayısı yok: tüm üyelerin hedef mahallede çıkarı var';
  else if (p.nitelikli && uygun.length < NITELIKLI_MIN_UYE) sebep = `Nitelikli çoğunluk için oy kullanabilecek en az ${NITELIKLI_MIN_UYE} üye gerekir (${uygun.length})`;
  else if (oylar.length < yeter) sebep = `Toplantı yeter sayısı sağlanamadı (${oylar.length}/${yeter})`;
  else if (p.nitelikli) {
    kabul = evet > 0 && evet >= Math.ceil(BELEDIYE.nitelikliOran * (evet + hayir));
    sebep = kabul ? `Nitelikli çoğunlukla kabul (${evet}/${evet + hayir})` : `Nitelikli çoğunluk (2/3) sağlanamadı (${evet}/${evet + hayir})`;
  } else if (evet !== hayir) {
    kabul = evet > hayir;
    sebep = `${kabul ? 'Kabul' : 'Ret'}: ${evet} evet, ${hayir} hayır`;
  } else {
    kabul = baskanOyu === 'EVET';
    sebep = `Oylar eşit (${evet}–${hayir}); başkanın bulunduğu taraf: ${kabul ? 'kabul' : 'ret'}`;
  }
  if (kabul && kasaBakiye(p.region_id) < p.maliyet) { kabul = false; sebep = `Kasa yetersiz (₳${p.maliyet} gerekli)`; }
  const karar = { uyeSayisi: uyelerSimdi.length, uygun: uygun.length, cikarli, evet, hayir, cekimser, katilan: oylar.length, yeter,
    nitelikli: !!p.nitelikli, kabul, sebep };

  if (kabul) {
    const u = db.prepare(`UPDATE projeler SET durum = 'YAPIMDA', yapim_bas = ?, yapim_bitis = ?, karar_json = ? WHERE id = ? AND durum = 'MECLISTE'`)
      .run(t, t + tur.sureMs, JSON.stringify(karar), p.id);
    if (u.changes !== 1) return;
    L.aktar({ kaynak: kasa(p.region_id), hedef: emanet(p.id), tutar: p.maliyet, sebep: `Proje bütçesi: ${tur.ad} (${hedef.name})` });
    L.denetim({ anahtar: `PROJECT_APPROVED:${p.id}`, eylem: 'PROJECT_APPROVED', varlik: `PROJE:${p.id}`, bolge: p.hedef_region_id, herkese: true,
      sonra: { tur: p.tur, ad: tur.ad, evet, hayir, maliyet: p.maliyet } });
    for (const s of secim.sakinler(SECIM.turler.MUHTAR, p.hedef_region_id)) bildir(s.id, `Meclis onayladı: mahallene ${tur.ad} yapılıyor`, `belediye:${p.region_id}`);
  } else {
    const u = db.prepare(`UPDATE projeler SET durum = 'REDDEDILDI', karar_json = ? WHERE id = ? AND durum = 'MECLISTE'`).run(JSON.stringify(karar), p.id);
    if (u.changes !== 1) return;
    // Reddedilen teklifin muhtar talebi yeniden açılır (aynı hizmet için başka açık talep yoksa)
    const tl = p.talep_id && db.prepare(`SELECT * FROM talepler WHERE id = ? AND durum = 'TEKLIFE_DONUSTU'`).get(p.talep_id);
    if (tl && !db.prepare(`SELECT 1 FROM talepler WHERE mahalle_id = ? AND tur = ? AND durum = 'ACIK'`).get(tl.mahalle_id, tl.tur)) {
      db.prepare(`UPDATE talepler SET durum = 'ACIK', proje_id = NULL WHERE id = ?`).run(tl.id);
      bildir(tl.user_id, `Meclis ${tur.ad} teklifini reddetti; talebin yeniden açıldı`, `belediye:${p.region_id}`);
    } else if (tl) db.prepare(`UPDATE talepler SET durum = 'KAPANDI' WHERE id = ?`).run(tl.id);
    L.denetim({ anahtar: `PROJECT_REJECTED:${p.id}`, eylem: 'PROJECT_REJECTED', varlik: `PROJE:${p.id}`, bolge: p.hedef_region_id, herkese: true,
      sonra: { tur: p.tur, ad: tur.ad, sebep } });
  }
  for (const uy of uyelerSimdi) bildir(uy.user_id, `Meclis kararı (${tur.ad}, ${hedef.name}): ${sebep}`, `belediye:${p.region_id}`);
}

function tamamla(p, t) {
  const tur = BELEDIYE.projeler[p.tur];
  const u = db.prepare(`UPDATE projeler SET durum = 'TAMAMLANDI' WHERE id = ? AND durum = 'YAPIMDA'`).run(p.id);
  if (u.changes !== 1) return;
  L.aktar({ kaynak: emanet(p.id), hedef: 'SYS:SINK', tutar: p.maliyet, sebep: `Proje harcaması: ${tur.ad}` });
  if (tur.cekicilik) {
    db.prepare(`UPDATE regions SET attractiveness = ROUND(attractiveness + ?, 2) WHERE id = ?`).run(tur.cekicilik, p.hedef_region_id);
  }
  L.denetim({ anahtar: `PROJECT_COMPLETED:${p.id}`, eylem: 'PROJECT_COMPLETED', varlik: `PROJE:${p.id}`, bolge: p.hedef_region_id, herkese: true,
    sonra: { tur: p.tur, ad: tur.ad, etki: tur.etki } });
  for (const s of secim.sakinler(SECIM.turler.MUHTAR, p.hedef_region_id)) bildir(s.id, `${tur.ad} tamamlandı: ${tur.etki}`, `belediye:${p.region_id}`);
}

let sonKatki = 0;
function belediyeBakim({ zorla = false } = {}) {
  const t = simdi();
  for (const p of db.prepare(`SELECT * FROM projeler WHERE durum = 'MECLISTE' AND oylama_bitis <= ?`).all(t)) db.transaction(() => kararVer(p, t))();
  for (const p of db.prepare(`SELECT * FROM projeler WHERE durum = 'YAPIMDA' AND yapim_bitis <= ?`).all(t)) db.transaction(() => tamamla(p, t))();
  if (zorla || t - sonKatki > 10000) { sonKatki = t; gunlukKatki(t); }
}

// ---------- Okuma: faaliyet panosu (§6.4) ----------
function kasaRaporu(ilceId) {
  const hesap = kasa(ilceId);
  const kalemler = db.prepare(`SELECT reason, SUM(credit) AS gelir, SUM(debit) AS gider FROM wallet_ledger WHERE account = ? GROUP BY reason`).all(hesap);
  const kategori = (r) => (/devlet katkısı/.test(r) ? 'Devlet katkısı' : /tahsis/.test(r) ? 'Tahsis payı' : /ruhsat/.test(r) ? 'Ruhsat harcı'
    : /pazar/.test(r) ? 'Pazar işlem payı' : /Proje bütçesi/.test(r) ? 'Projeler' : 'Diğer');
  const gelir = {}, gider = {};
  for (const k of kalemler) {
    if (k.gelir) gelir[kategori(k.reason)] = (gelir[kategori(k.reason)] || 0) + k.gelir;
    if (k.gider) gider[kategori(k.reason)] = (gider[kategori(k.reason)] || 0) + k.gider;
  }
  const emanette = db.prepare(`SELECT COALESCE(SUM(maliyet), 0) AS s FROM projeler WHERE region_id = ? AND durum = 'YAPIMDA'`).get(ilceId).s;
  const harcanan = db.prepare(`SELECT COALESCE(SUM(maliyet), 0) AS s FROM projeler WHERE region_id = ? AND durum = 'TAMAMLANDI'`).get(ilceId).s;
  return { bakiye: L.yuvarla(L.hesapBakiye(hesap)), gundemde: bekleyenRezerv(ilceId), emanette, harcanan, gelir, gider };
}

function projeListesi(ilceId, userId) {
  const t = simdi();
  const uyeListe = uyeler(ilceId);
  return db.prepare(`SELECT p.*, m.name AS mahalle, u.display_name AS teklif_eden FROM projeler p JOIN regions m ON m.id = p.hedef_region_id
                     JOIN users u ON u.id = p.teklif_eden_id WHERE p.region_id = ? ORDER BY (p.durum IN ('MECLISTE','YAPIMDA')) DESC, p.id DESC LIMIT 30`)
    .all(ilceId).map((p) => {
      const oylar = db.prepare(`SELECT o.oy, o.user_id, u.display_name AS ad FROM proje_oylari o JOIN users u ON u.id = o.user_id WHERE o.proje_id = ? ORDER BY o.created_at`).all(p.id);
      const benUyeyim = !!userId && uyeListe.some((u) => u.user_id === userId);
      const benCikarli = !!userId && cikarliMi(userId, p.hedef_region_id);
      return {
        id: p.id, tur: p.tur, ...BELEDIYE.projeler[p.tur], maliyet: p.maliyet, mahalle: p.mahalle, hedefMahalleId: p.hedef_region_id,
        gerekce: p.gerekce, teklifEden: p.teklif_eden, durum: p.durum, nitelikli: !!p.nitelikli, nitelikliSebep: p.nitelikli_sebep,
        oylamaBitis: p.oylama_bitis, yapimBas: p.yapim_bas, yapimBitis: p.yapim_bitis, talepId: p.talep_id,
        oylar: oylar.map((o) => ({ ad: o.ad, oy: o.oy, cikarli: cikarliMi(o.user_id, p.hedef_region_id) })),
        karar: p.karar_json ? JSON.parse(p.karar_json) : null,
        ben: { uye: benUyeyim, cikarli: benCikarli, oyum: oylar.find((o) => o.user_id === userId)?.oy || null,
          oyKullanabilir: benUyeyim && !benCikarli && p.durum === 'MECLISTE' && t < p.oylama_bitis },
        simdi: t,
      };
    });
}

function belediyeBilgisi(ilceId, userId) {
  const ilce = ilceGetir(ilceId);
  const t = simdi();
  const uyeListe = uyeler(ilce.id, t);
  const baskan = uyeListe.find((u) => u.makam === 'BASKAN');
  const tur = SECIM.turler.BELEDIYE;
  const sakin = secim.sakinler(tur, ilce.id);
  const aktifSecim = db.prepare(`SELECT 1 FROM secimler WHERE region_id = ? AND asama IN ('DUYURU','ADAYLIK','KAMPANYA','OYLAMA','ITIRAZ')`).get(ilce.id);
  const uyeOzet = (u) => ({ id: u.id, userId: u.user_id, ad: u.ad, demo: !!db.prepare(`SELECT is_npc FROM users WHERE id = ?`).get(u.user_id)?.is_npc, makam: u.makam, ben: u.user_id === userId, bitis: u.bitis,
    vaatler: db.prepare(`SELECT id, sira, metin, durum, aciklama FROM gorev_vaatleri WHERE uye_id = ? ORDER BY sira`).all(u.id) });
  const mahalleler = db.prepare(`
    SELECT r.id, r.name AS ad, COUNT(DISTINCT u.id) AS sakin,
      EXISTS (SELECT 1 FROM muhtarlar m WHERE m.region_id = r.id AND m.baslangic <= ? AND m.bitis > ?) AS muhtarVar
    FROM regions r LEFT JOIN parcels p ON p.region_id = r.id AND p.owner_user_id IS NOT NULL
      LEFT JOIN users u ON u.id = p.owner_user_id AND u.is_npc = 0 AND u.status = 'ACTIVE'   -- Hazine ve demolar sakin sayılmaz
    WHERE r.parent_id = ? AND r.type = 'MAHALLE' GROUP BY r.id ORDER BY sakin DESC, r.name LIMIT 60`).all(t, t, ilce.id)
    .map((m) => ({ ...m, hizmetler: [...mahalleHizmetleri(m.id)] }));
  const muhtarlikMahallelerim = userId ? db.prepare(`SELECT r.id, r.name AS ad FROM muhtarlar m JOIN regions r ON r.id = m.region_id
    WHERE m.user_id = ? AND r.parent_id = ? AND m.baslangic <= ? AND m.bitis > ?`).all(userId, ilce.id, t, t) : [];
  const pano = db.prepare(`
    SELECT a.action, a.after_json, a.created_at, u.display_name AS aktor, r.name AS bolge FROM audit_events a
    LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN regions r ON r.id = a.region_id
    WHERE a.public = 1 AND (a.region_id = ? OR r.parent_id = ?)
      AND a.action IN ('PROJECT_PROPOSED','COUNCIL_VOTE','PROJECT_APPROVED','PROJECT_REJECTED','PROJECT_COMPLETED','MUHTAR_REQUEST','REQUEST_CLOSED','ELECTION_CLOSED','ELECTION_ANNULLED','OFFICE_VACATED','RECALL_STARTED','RECALL_SUCCEEDED','RECALL_FAILED','REFERENDUM_OPENED','REFERENDUM_CLOSED')
    ORDER BY a.id DESC LIMIT 25`).all(ilce.id, ilce.id).map((x) => ({ ...x, after: x.after_json ? JSON.parse(x.after_json) : null, after_json: undefined }));

  return {
    ilce: { id: ilce.id, ad: ilce.name, il: ilce.il, ilId: ilce.il_id, plaka: ilce.plaka, merkez: [ilce.center_lon, ilce.center_lat] },
    sakinSayisi: sakin.length, minSecmen: tur.minSecmen,
    demoSakin: secim.demoSakinler(tur, ilce.id).length, doldurma: secim.doldurmaKipi(tur, ilce.id),
    baskan: baskan ? uyeOzet(baskan) : null,
    meclis: uyeListe.filter((u) => u.makam === 'MECLIS').map(uyeOzet),
    ben: userId ? { sakin: sakin.some((s) => s.id === userId), baskan: baskan?.user_id === userId, uye: uyeListe.some((u) => u.user_id === userId),
      muhtarlikMahallelerim } : null,
    secim: secim.bolgeSecimi(ilce.id, userId),
    gecmis: secim.gecmisSecimler(ilce.id),
    yeniSecim: !aktifSecim && !baskan && sakin.length < tur.minSecmen
      ? `Belediye seçimi için ilçede en az ${tur.minSecmen} oyuncu sakin gerekir (şu an ${sakin.length}). O zamana dek geçici yönetim sürer.` : null,
    dilekceler: require('./moderasyon').dilekceler(ilce.id, userId),
    dilekceKurallari: require('./moderasyon').dilekceKurallari,
    referandumlar: require('./referandum').ilceReferandumlari(ilce.id, userId),
    kasa: kasaRaporu(ilce.id),
    projeler: projeListesi(ilce.id, userId),
    talepler: db.prepare(`SELECT t.id, t.tur, t.aciklama, t.durum, t.created_at, t.proje_id, r.name AS mahalle, r.id AS mahalle_id, u.display_name AS muhtar
                          FROM talepler t JOIN regions r ON r.id = t.mahalle_id JOIN users u ON u.id = t.user_id
                          WHERE t.ilce_id = ? ORDER BY (t.durum = 'ACIK') DESC, t.id DESC LIMIT 20`).all(ilce.id)
      .map((x) => ({ ...x, turAd: BELEDIYE.projeler[x.tur]?.ad })),
    mahalleler,
    pano,
    projeTurleri: Object.fromEntries(Object.entries(BELEDIYE.projeler).map(([k, v]) => [k, { ...v }])),
    kurallar: { meclisOylamaMs: BELEDIYE.meclisOylamaMs, buyukProjeEsigi: BELEDIYE.buyukProjeEsigi, gelir: BELEDIYE.gelir, nitelikliMinUye: NITELIKLI_MIN_UYE,
      referandum: { sureMs: REFERANDUM.sureMs, imzaOrani: REFERANDUM.imzaOrani, nisapOrani: REFERANDUM.nisapOrani } },
  };
}

function belediyelerim(userId) {
  const t = simdi();
  return db.prepare(`
    SELECT ri.id, ri.name AS ad, rl.name AS il, COUNT(p.id) AS parsel,
      (SELECT asama FROM secimler s WHERE s.region_id = ri.id AND s.asama IN ('DUYURU','ADAYLIK','KAMPANYA','OYLAMA','ITIRAZ')) AS secim,
      (SELECT makam FROM belediye_uyeleri b WHERE b.region_id = ri.id AND b.user_id = ? AND b.baslangic <= ? AND b.bitis > ?) AS makam
    FROM parcels p JOIN regions ri ON ri.id = p.ilce_id JOIN regions rl ON rl.id = ri.parent_id
    WHERE p.owner_user_id = ? GROUP BY ri.id ORDER BY ri.name`).all(userId, t, t, userId);
}

// Harita: belediyeler (ilçe merkezinde) ve projeler (hedef mahallede)
function haritaBelediyeleri([w, s, e, n]) {
  const t = simdi();
  const belediyeler = db.prepare(`
    SELECT r.id, r.name, r.center_lon AS lon, r.center_lat AS lat,
      (SELECT u.display_name FROM belediye_uyeleri b JOIN users u ON u.id = b.user_id WHERE b.region_id = r.id AND b.makam = 'BASKAN' AND b.baslangic <= ? AND b.bitis > ?) AS baskan,
      (SELECT asama FROM secimler x WHERE x.region_id = r.id AND x.asama IN ('DUYURU','ADAYLIK','KAMPANYA','OYLAMA','ITIRAZ')) AS secim
    FROM regions r WHERE r.type = 'ILCE' AND r.center_lon BETWEEN ? AND ? AND r.center_lat BETWEEN ? AND ?`).all(t, t, w, e, s, n)
    .filter((x) => x.baskan || x.secim);
  const projeler = db.prepare(`
    SELECT j.id, j.tur, j.durum, j.region_id, m.center_lon AS lon, m.center_lat AS lat, m.name FROM projeler j JOIN regions m ON m.id = j.hedef_region_id
    WHERE j.durum IN ('MECLISTE','YAPIMDA','TAMAMLANDI') AND m.center_lon BETWEEN ? AND ? AND m.center_lat BETWEEN ? AND ?`).all(w, e, s, n);
  const DURUM = { MECLISTE: 'mecliste', YAPIMDA: 'yapımda', TAMAMLANDI: 'hizmette' };
  return {
    type: 'FeatureCollection',
    features: [
      ...belediyeler.map((b) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
        properties: { tur: 'belediye', id: b.id, ad: b.name, etiket: b.baskan ? `BELEDİYE · ${b.baskan}` : `BELEDİYE SEÇİMİ · ${secim.ASAMA_AD[b.secim].toLocaleUpperCase('tr-TR')}` } })),
      ...projeler.map((p, i) => ({ type: 'Feature',
        // Aynı mahalledeki projeler üst üste binmesin: küçük açısal kaydırma
        geometry: { type: 'Point', coordinates: [p.lon + 0.0012 * Math.cos(i * 1.7), p.lat + 0.0009 * Math.sin(i * 1.7)] },
        properties: { tur: 'proje', id: p.region_id, proje: p.id, durum: p.durum, ikon: BELEDIYE.projeler[p.tur].ikon,
          etiket: `${BELEDIYE.projeler[p.tur].ad.toLocaleUpperCase('tr-TR')} · ${DURUM[p.durum]}` } })),
    ],
  };
}

module.exports = {
  belediyeBakim, belediyePayi, gunlukKatki, mahalleHizmetleri, pazarBonusu,
  talepGonder, talepKapat, projeTeklif, meclisOyu, belediyeBilgisi, belediyelerim, haritaBelediyeleri, kasa, emanet,
};
