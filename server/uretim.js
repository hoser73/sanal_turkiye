// Üretim zinciri ve meslekler (§5.7, §7.4). Tesis (değirmen, fırın, fabrika, ambar) reçeteye göre girdileri mamule çevirir.
// Meslek bonusları açık formülle hesaplanır: bonus = taban + (seviye − 1) × seviyeBonusu; seviye = 1 + ⌊√(xp / basamak)⌋ (en çok 5).
const db = require('./db');
const L = require('./lib/ledger');
const { metin, sayi } = require('./lib/girdi');
const { yol } = require('./lib/olaylar');
const { URUNLER, RECETELER, YAPILAR, MESLEKLER, MESLEK } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const bul = (tablo, kod) => (typeof kod === 'string' && Object.hasOwn(tablo, kod) ? tablo[kod] : null);

// ---------- Meslek
const seviye = (xp) => Math.min(MESLEK.maxSeviye, 1 + Math.floor(Math.sqrt((xp || 0) / MESLEK.xpBasamak)));
function meslekBonusu(userId, kod) {
  if (!userId) return 0;
  const u = db.prepare(`SELECT meslek, meslek_xp FROM users WHERE id = ?`).get(userId);
  if (!u || u.meslek !== kod) return 0;
  const m = MESLEKLER[kod];
  return Math.round((m.bonus + (seviye(u.meslek_xp) - 1) * m.seviyeBonus) * 1000) / 1000;
}
function meslekBilgisi(userId) {
  const u = db.prepare(`SELECT meslek, meslek_xp, meslek_at FROM users WHERE id = ?`).get(userId);
  const sv = seviye(u.meslek_xp);
  const sonraki = sv < MESLEK.maxSeviye ? sv * sv * MESLEK.xpBasamak : null;
  return {
    meslek: u.meslek, xp: u.meslek_xp, seviye: sv, sonrakiSeviyeXp: sonraki, bonus: u.meslek ? meslekBonusu(userId, u.meslek) : 0,
    degisebilir: !u.meslek_at || simdi() - u.meslek_at >= MESLEK.degisimBeklemeMs, degisimTarihi: u.meslek_at ? u.meslek_at + MESLEK.degisimBeklemeMs : null,
    secenekler: Object.entries(MESLEKLER).map(([kod, m]) => ({ kod, ad: m.ad, ikon: m.ikon, aciklama: m.aciklama, bonus: m.bonus, seviyeBonus: m.seviyeBonus })),
  };
}
function meslekSec(userId, kod) {
  if (!bul(MESLEKLER, kod)) throw new OyunHatasi(400, 'Geçersiz meslek');
  const u = db.prepare(`SELECT meslek, meslek_at FROM users WHERE id = ?`).get(userId);
  if (u.meslek === kod) return { tamam: true };
  if (u.meslek_at && simdi() - u.meslek_at < MESLEK.degisimBeklemeMs) throw new OyunHatasi(409, 'Mesleğini haftada bir değiştirebilirsin');
  db.prepare(`UPDATE users SET meslek = ?, meslek_xp = 0, meslek_at = ? WHERE id = ?`).run(kod, simdi(), userId);
  L.denetim({ aktor: userId, eylem: 'PROFESSION_CHOSEN', sonra: { meslek: kod } });
  return { tamam: true };
}
// Meslekle ilgili her eylem 1 deneyim puanı (olay yolu üzerinden, işlem bittikten sonra)
const meslekEylemi = new Map(Object.entries(MESLEKLER).flatMap(([kod, m]) => m.eylemler.map((e) => [e, kod])));
yol.on('eylem', ({ eylem, aktor }) => {
  const kod = meslekEylemi.get(eylem);
  if (aktor && kod) db.prepare(`UPDATE users SET meslek_xp = meslek_xp + 1 WHERE id = ? AND meslek = ?`).run(aktor, kod);
});

// ---------- Üretim
// Reçetenin yapılabildiği tesis türleri (tek tür ya da liste)
const tesisleri = (r) => [].concat(r.tesis);
function tesisSec(p, userId, recete) {
  const oyun = require('./oyun');
  const t = simdi();
  const tipler = tesisleri(recete);
  const yapilar = db.prepare(`SELECT * FROM structures WHERE parcel_id = ? AND type IN (${tipler.map(() => '?').join(',')}) AND status = 'ACTIVE'`).all(p.id, ...tipler);
  const s = yapilar.find((y) => oyun.saglik(y, t) >= require('./config/rules').BAKIM.etkisizEsik);
  if (!yapilar.length) throw new OyunHatasi(409, `Bu üretim için parselde ${tipler.map((x) => YAPILAR[x].ad).join(' ya da ')} olmalı`);
  if (!s) throw new OyunHatasi(409, `${YAPILAR[yapilar[0].type].ad} bakımsız; önce bakım yap`);
  return s;
}

const uretimBaslat = db.transaction((userId, parcelId, govde = {}) => {
  const oyun = require('./oyun');
  const p = oyun.parselGetir(parcelId);
  oyun.sahibiOlmali(p, userId);
  const kod = metin(govde?.recete);
  const r = bul(RECETELER, kod);
  if (!r) throw new OyunHatasi(400, 'Geçersiz reçete');
  const parti = sayi(govde?.parti ?? 1);
  if (!Number.isInteger(parti) || parti < 1 || parti > 10) throw new OyunHatasi(400, 'Parti sayısı 1–10 olmalı');
  const s = tesisSec(p, userId, r);
  if (db.prepare(`SELECT 1 FROM uretimler WHERE structure_id = ? AND durum = 'URETIMDE'`).get(s.id)) throw new OyunHatasi(409, 'Bu tesiste süren bir üretim var');
  require('./ekonomi').envanterBozulmasi(userId);
  const tx = L.yeniTx();
  for (const [girdi, adet] of Object.entries(r.girdi)) L.envanterDegis(userId, girdi, -adet * parti, `Üretim girdisi: ${URUNLER[kod].ad}`, tx);
  const yapilar = db.prepare(`SELECT * FROM structures WHERE parcel_id = ?`).all(p.id);
  const enerji = r.enerji * parti * (oyun.aktifYapiVar(yapilar, 'GUNES_PANELI') ? 0.5 : 1);
  if (enerji > 0) L.harca(userId, enerji, `Üretim enerjisi: ${URUNLER[kod].ad}`, tx);
  const t = simdi();
  // Rüzgârlı havada (ilin gerçek ölçümü) değirmen daha hızlı öğütür
  const ruzgar = s.type === 'DEGIRMEN' ? require('./iklim').ruzgarKati(p.plaka, t) : 1;
  const sure = Math.round(r.sureMs * parti * (1 - meslekBonusu(userId, 'ZANAATKAR')) * ruzgar);
  const id = db.prepare(`INSERT INTO uretimler (user_id, parcel_id, structure_id, recete, parti, cikti, baslangic, bitis) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, p.id, s.id, kod, parti, r.cikti * parti, t, t + sure).lastInsertRowid;
  L.denetim({ aktor: userId, eylem: 'PRODUCTION_STARTED', varlik: p.id, sonra: { recete: kod, parti }, bolge: p.region_id });
  return { tamam: true, id, bitis: t + sure, enerji, ruzgarli: ruzgar < 1 };
});

const uretimTopla = db.transaction((userId, uretimId) => {
  const u = db.prepare(`SELECT * FROM uretimler WHERE id = ?`).get(Number(uretimId));
  if (!u || u.user_id !== userId) throw new OyunHatasi(404, 'Üretim bulunamadı');
  if (u.durum !== 'URETIMDE') throw new OyunHatasi(409, 'Bu üretim zaten toplandı');
  // Parsel devredildiyse (pazar devri üretimi alıcıya geçirir; Hazine'ye satışta tesis Hazine'nindir) eski sahip toplayamaz
  if (db.prepare(`SELECT owner_user_id FROM parcels WHERE id = ?`).get(u.parcel_id)?.owner_user_id !== userId) throw new OyunHatasi(409, 'Bu tesis artık senin değil', 'DEVREDILDI');
  if (simdi() < u.bitis) throw new OyunHatasi(409, 'Üretim henüz bitmedi');
  if (db.prepare(`UPDATE uretimler SET durum = 'TOPLANDI' WHERE id = ? AND durum = 'URETIMDE'`).run(u.id).changes !== 1) throw new OyunHatasi(409, 'Eşzamanlı işlem');
  const tx = L.yeniTx();
  L.envanterDegis(userId, u.recete, u.cikti, `Üretim: ${URUNLER[u.recete].ad}`, tx);
  const p = db.prepare(`SELECT region_id FROM parcels WHERE id = ?`).get(u.parcel_id);
  L.denetim({ anahtar: `PRODUCTION_COLLECTED:${u.id}:${u.baslangic}`, aktor: userId, eylem: 'PRODUCTION_COLLECTED', varlik: u.parcel_id,
    sonra: { urun: u.recete, miktar: u.cikti }, bolge: p.region_id, herkese: true });
  return { tamam: true, urun: u.recete, miktar: u.cikti };
});

// Parsel kartı için: bu parseldeki tesislerin yapabileceği reçeteler ve süren üretimler
function parselUretimi(parcelId, userId) {
  const tesisler = new Set(db.prepare(`SELECT type FROM structures WHERE parcel_id = ? AND status = 'ACTIVE'`).all(parcelId).map((s) => s.type));
  const receteler = Object.entries(RECETELER).map(([kod, r]) => [kod, r, tesisleri(r).find((x) => tesisler.has(x))]).filter(([, , tesis]) => tesis).map(([kod, r, tesis]) => ({
    kod, ad: URUNLER[kod].ad, ikon: URUNLER[kod].ikon, tesis, tesisAd: YAPILAR[tesis].ad, cikti: r.cikti, sureMs: r.sureMs, enerji: r.enerji,
    girdi: Object.entries(r.girdi).map(([g, adet]) => ({ kod: g, ad: URUNLER[g].ad, ikon: URUNLER[g].ikon, adet, stok: userId ? L.envanterMiktar(userId, g) : 0 })),
  }));
  const surenler = db.prepare(`SELECT u.id, u.recete, u.parti, u.cikti, u.baslangic, u.bitis, u.structure_id, s.type AS tesis FROM uretimler u
      JOIN structures s ON s.id = u.structure_id WHERE u.parcel_id = ? AND u.durum = 'URETIMDE'`).all(parcelId)
    .map((u) => ({ ...u, ad: URUNLER[u.recete].ad, ikon: URUNLER[u.recete].ikon }));
  return receteler.length || surenler.length ? { receteler, surenler, zanaatkarBonusu: meslekBonusu(userId, 'ZANAATKAR') } : null;
}

function rotalar(app, { h, auth, hazir }) {
  app.get('/api/meslek', auth.girisGerekli, h((req) => meslekBilgisi(req.kullanici.id)));
  app.post('/api/meslek', auth.girisGerekli, h((req) => meslekSec(req.kullanici.id, req.body?.meslek)));
  app.post('/api/parsel/:id/uretim', auth.girisGerekli, hazir((req) => uretimBaslat(req.kullanici.id, String(req.params.id), req.body)));
  app.post('/api/uretim/:id/topla', auth.girisGerekli, h((req) => uretimTopla(req.kullanici.id, req.params.id)));
}

module.exports = { rotalar, meslekBonusu, meslekBilgisi, meslekSec, seviye, uretimBaslat, uretimTopla, parselUretimi };
