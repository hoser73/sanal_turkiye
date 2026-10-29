// Moderasyon ve denetim (§10, §14): şikâyetler, iki kişi kuralıyla ağır işlemler (parsel dondurma, hesap askısı,
// görevden alma, seçim iptali), seçim/meclis denetim görünümü ve sakinlerin görevden alma (geri çağırma) dilekçesi.
const db = require('./db');
const L = require('./lib/ledger');
const { icerikDenetle } = require('./lib/icerik');
const { MODERASYON, GOREVDEN_ALMA, SECIM, ROLLER, OZELLIK } = require('./config/rules');
const { OyunHatasi } = L;

const simdi = () => Date.now();
const YETKILI = ['MODERATOR', 'DENETCI', 'ADMIN'];
const bildir = (userId, metin, link) => require('./pazar').bildir(userId, metin, link);
const metinAl = (v, ad, min, max) => {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) throw new OyunHatasi(400, `${ad} ${min}–${max} karakter olmalı`);
  return v.trim();
};
const rolu = (userId) => db.prepare(`SELECT rol FROM users WHERE id = ?`).get(userId)?.rol;
// Rol hiyerarşisi: yetkili bir hesaba yönelik işlemi yalnızca ondan üst roldeki biri önerir ve onaylar
const RUTBE = { OYUNCU: 0, MODERATOR: 1, DENETCI: 2, ADMIN: 3 };
const rutbe = (userId) => RUTBE[rolu(userId)] ?? 0;
const sqlMs = (s) => new Date(String(s).replace(' ', 'T') + 'Z').getTime();
const yetkililer = () => db.prepare(`SELECT id FROM users WHERE rol IN ('MODERATOR', 'DENETCI', 'ADMIN') AND status = 'ACTIVE'`).all();

// ---------- Şikâyet hedefleri
const GIZLENEBILIR = { DUYURU: 'mahalle_duyurulari', MESAJ: 'sohbet_mesajlari' };
function hedefOzeti(tur, id) {
  const tek = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch { return null; } };
  switch (tur) {
    case 'KULLANICI': { const u = tek(`SELECT id, display_name, status FROM users WHERE id = ? AND is_npc = 0`, Number(id)); return u && { baslik: u.display_name, durum: u.status }; }
    case 'PARSEL': { const p = tek(`SELECT p.id, p.status, u.display_name AS sahip FROM parcels p LEFT JOIN users u ON u.id = p.owner_user_id WHERE p.id = ?`, String(id)); return p && { baslik: `${p.id}${p.sahip ? ` · ${p.sahip}` : ''}`, durum: p.status, link: `parsel:${p.id}` }; }
    case 'DUYURU': { const d = tek(`SELECT d.metin, d.region_id, d.gizlendi, u.display_name AS ad FROM mahalle_duyurulari d JOIN users u ON u.id = d.user_id WHERE d.id = ?`, Number(id)); return d && { baslik: `${d.ad}: “${d.metin.slice(0, 140)}”`, durum: d.gizlendi ? 'GIZLI' : 'YAYINDA', link: `mahalle:${d.region_id}` }; }
    case 'MESAJ': { const m = tek(`SELECT m.metin, m.gizlendi, u.display_name AS ad FROM sohbet_mesajlari m JOIN users u ON u.id = m.user_id WHERE m.id = ?`, Number(id)); return m && { baslik: `${m.ad}: “${m.metin.slice(0, 140)}”`, durum: m.gizlendi ? 'GIZLI' : 'YAYINDA' }; }
    case 'ILAN': { const i = tek(`SELECT parcel_id, asking_price, status FROM listings WHERE id = ?`, Number(id)); return i && { baslik: `İlan #${id} · ${i.parcel_id} · ₳${i.asking_price}`, durum: i.status, link: `parsel:${i.parcel_id}` }; }
    case 'PROJE': { const p = tek(`SELECT tur, maliyet, durum, region_id FROM projeler WHERE id = ?`, Number(id)); return p && { baslik: `Proje #${id} · ${p.tur} · ₳${p.maliyet}`, durum: p.durum, link: `belediye:${p.region_id}` }; }
    default: return null;
  }
}
const hedefMetni = (tur, id) => {
  const t = GIZLENEBILIR[tur];
  if (!t) return '';
  try { return db.prepare(`SELECT metin FROM ${t} WHERE id = ?`).get(Number(id))?.metin || ''; } catch { return ''; }
};

function sikayetEt(userId, govde = {}) {
  const tur = String(govde.hedefTur || '');
  if (!MODERASYON.hedefTurleri.includes(tur)) throw new OyunHatasi(400, 'Geçersiz şikâyet hedefi');
  const hedefId = String(govde.hedefId ?? '').slice(0, 40);
  if (!hedefOzeti(tur, hedefId)) throw new OyunHatasi(404, 'Şikâyet edilen içerik bulunamadı');
  if (tur === 'KULLANICI' && Number(hedefId) === userId) throw new OyunHatasi(400, 'Kendini şikâyet edemezsin');
  const sebep = String(govde.sebep || '');
  if (!Object.hasOwn(MODERASYON.sebepler, sebep)) throw new OyunHatasi(400, 'Şikâyet sebebini seç');
  const aciklama = govde.aciklama ? metinAl(govde.aciklama, 'Açıklama', 0, 500) : null;
  if (db.prepare(`SELECT COUNT(*) c FROM sikayetler WHERE sikayetci_id = ? AND durum = 'ACIK'`).get(userId).c >= MODERASYON.acikSikayetSiniri) {
    throw new OyunHatasi(429, 'Açık şikâyetlerin incelenmeden yenisini gönderemezsin');
  }
  const tarama = icerikDenetle(hedefMetni(tur, hedefId));
  const onTarama = tarama.nedenler.length ? tarama.nedenler.map((n) => n.not).join(' · ') : null;
  let id;
  try {
    id = db.prepare(`INSERT INTO sikayetler (sikayetci_id, hedef_tur, hedef_id, sebep, aciklama, on_tarama, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, tur, hedefId, sebep, aciklama, onTarama, simdi()).lastInsertRowid;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new OyunHatasi(409, 'Bu içerik için açık bir şikâyetin zaten var');
    throw e;
  }
  require('./yz').arkaPlandaTara('sikayetler', id, hedefMetni(tur, hedefId) || aciklama, `şikâyet: ${MODERASYON.sebepler[sebep]}`);
  L.denetim({ aktor: userId, eylem: 'REPORT_FILED', varlik: `${tur}:${hedefId}`, sonra: { sebep }, herkese: false });
  for (const y of yetkililer()) bildir(y.id, `Yeni şikâyet: ${MODERASYON.sebepler[sebep]} (${tur})`, 'yonetim');
  return { tamam: true, id };
}

function sikayetKarar(modId, sikayetId, { karar, not } = {}) {
  if (!['KARARA_BAGLANDI', 'REDDEDILDI'].includes(karar)) throw new OyunHatasi(400, 'Karar KARARA_BAGLANDI ya da REDDEDILDI olmalı');
  const aciklama = metinAl(not || '', 'Karar notu', 5, 500);
  const s = db.prepare(`SELECT * FROM sikayetler WHERE id = ?`).get(Number(sikayetId));
  if (!s) throw new OyunHatasi(404, 'Şikâyet bulunamadı');
  if (s.durum !== 'ACIK') throw new OyunHatasi(409, 'Şikâyet zaten sonuçlandı');
  if (s.sikayetci_id === modId) throw new OyunHatasi(403, 'Kendi şikâyetini sonuçlandıramazsın');
  db.prepare(`UPDATE sikayetler SET durum = ?, karar = ?, karar_veren = ?, kapandi_at = ? WHERE id = ?`).run(karar, aciklama, modId, simdi(), s.id);
  L.denetim({ aktor: modId, eylem: 'REPORT_RESOLVED', varlik: `SIKAYET:${s.id}`, sonra: { karar }, herkese: false });
  bildir(s.sikayetci_id, `Şikâyetin incelendi: ${karar === 'REDDEDILDI' ? 'ihlal bulunmadı' : 'gerekli işlem yapıldı'}. Not: ${aciklama}`, null);
  return { tamam: true };
}

// ---------- Makam boşaltma (görevden alma, hesap silme, moderasyon)
function makamBosalt(regionId, makam, hedefId, sebep, aktor = null) {
  const t = simdi();
  const r = makam === 'MUHTAR'
    ? db.prepare(`UPDATE muhtarlar SET bitis = ? WHERE region_id = ? AND user_id = ? AND baslangic <= ? AND bitis > ?`).run(t, regionId, hedefId, t, t)
    : db.prepare(`UPDATE belediye_uyeleri SET bitis = ? WHERE region_id = ? AND user_id = ? AND makam = ? AND baslangic <= ? AND bitis > ?`).run(t, regionId, hedefId, makam, t, t);
  if (!r.changes) return false;
  L.denetim({ aktor, eylem: 'OFFICE_VACATED', varlik: `${makam}:${regionId}:${hedefId}`, bolge: regionId, herkese: true, sonra: { makam, sebep } });
  const secim = require('./secim');
  const tur = makam === 'MUHTAR' ? SECIM.turler.MUHTAR : SECIM.turler.BELEDIYE;
  const ad = { MUHTAR: 'Muhtarlık', BASKAN: 'Belediye başkanlığı', MECLIS: 'Bir meclis üyeliği' }[makam];
  const link = makam === 'MUHTAR' ? `mahalle:${regionId}` : `belediye:${regionId}`;
  const sonra = { MUHTAR: ' Yeni muhtarlık seçimi takvimi açılacak.', BASKAN: ' Meclis görevini sürdürür; başkanlık için ara seçim takvimi açılacak.',
    MECLIS: ' Koltuk dönem sonuna dek boş kalır.' }[makam];
  for (const s of secim.sakinler(tur, regionId)) bildir(s.id, `${ad} boşaldı: ${sebep}.${sonra}`, link);
  return true;
}
function tumMakamlariBosalt(userId, sebep, aktor = userId) {
  const t = simdi();
  for (const m of db.prepare(`SELECT region_id FROM muhtarlar WHERE user_id = ? AND baslangic <= ? AND bitis > ?`).all(userId, t, t)) makamBosalt(m.region_id, 'MUHTAR', userId, sebep, aktor);
  for (const b of db.prepare(`SELECT region_id, makam FROM belediye_uyeleri WHERE user_id = ? AND baslangic <= ? AND bitis > ?`).all(userId, t, t)) makamBosalt(b.region_id, b.makam, userId, sebep, aktor);
}

// Görevdeki makam sahibi (yoksa null)
function gorevdeki(regionId, makam, hedefId) {
  const t = simdi();
  if (makam === 'MUHTAR') return db.prepare(`SELECT m.*, u.display_name AS ad FROM muhtarlar m JOIN users u ON u.id = m.user_id WHERE m.region_id = ? AND m.baslangic <= ? AND m.bitis > ? ORDER BY m.id DESC LIMIT 1`).get(regionId, t, t) || null;
  const sql = `SELECT b.*, u.display_name AS ad FROM belediye_uyeleri b JOIN users u ON u.id = b.user_id WHERE b.region_id = ? AND b.makam = ? AND b.baslangic <= ? AND b.bitis > ?`;
  if (makam === 'BASKAN') return db.prepare(`${sql} ORDER BY b.id DESC LIMIT 1`).get(regionId, 'BASKAN', t, t) || null;
  return db.prepare(`${sql} AND b.user_id = ?`).get(regionId, 'MECLIS', t, t, Number(hedefId)) || null;
}

// ---------- İki kişi kuralı
function hedefCoz(tur, hedef) {
  const h = String(hedef || '');
  switch (tur) {
    case 'ICERIK_GIZLE': { const [t, id] = h.split(':'); if (!GIZLENEBILIR[t] || !hedefOzeti(t, id)) throw new OyunHatasi(404, 'İçerik bulunamadı (DUYURU:<id> / MESAJ:<id>)'); return { t, id: Number(id) }; }
    case 'PARSEL_DONDUR': case 'PARSEL_COZ': { if (!hedefOzeti('PARSEL', h)) throw new OyunHatasi(404, 'Parsel bulunamadı'); return { id: h }; }
    case 'HESAP_ASKI': case 'HESAP_AC': { if (!hedefOzeti('KULLANICI', h)) throw new OyunHatasi(404, 'Hesap bulunamadı'); return { id: Number(h) }; }
    case 'GOREVDEN_AL': {
      const [makam, r, u] = h.split(':');
      if (!['MUHTAR', 'BASKAN', 'MECLIS'].includes(makam)) throw new OyunHatasi(400, 'Hedef MAKAM:<bölge>:<kullanıcı> biçiminde olmalı');
      const g = gorevdeki(Number(r), makam, Number(u));
      if (!g || g.user_id !== Number(u)) throw new OyunHatasi(404, 'Bu makamda görevde böyle biri yok');
      return { makam, regionId: Number(r), userId: Number(u) };
    }
    case 'SECIM_IPTAL': { const s = db.prepare(`SELECT * FROM secimler WHERE id = ?`).get(Number(h)); if (!s) throw new OyunHatasi(404, 'Seçim bulunamadı'); if (s.asama === 'IPTAL') throw new OyunHatasi(409, 'Seçim zaten iptal'); return { secim: s }; }
    default: throw new OyunHatasi(400, 'Geçersiz işlem türü');
  }
}

function uygula(islem) {
  const tur = islem.tur;
  const x = hedefCoz(tur, islem.hedef);
  const t = simdi();
  const sebep = `Moderasyon kararı #${islem.id}: ${islem.gerekce}`;
  switch (tur) {
    case 'ICERIK_GIZLE': db.prepare(`UPDATE ${GIZLENEBILIR[x.t]} SET gizlendi = 1 WHERE id = ?`).run(x.id); break;
    case 'PARSEL_DONDUR': {
      db.prepare(`UPDATE parcels SET status = 'FROZEN', version = version + 1 WHERE id = ?`).run(x.id);
      const ilan = db.prepare(`SELECT id, seller_id FROM listings WHERE parcel_id = ? AND status = 'ACTIVE'`).get(x.id);
      if (ilan) require('./pazar').ilanIptal(ilan.seller_id, ilan.id);
      const sahip = db.prepare(`SELECT owner_user_id FROM parcels WHERE id = ?`).get(x.id).owner_user_id;
      if (sahip) bildir(sahip, `${x.id} parselin inceleme süresince donduruldu. Gerekçe: ${islem.gerekce}`, `parsel:${x.id}`);
      break;
    }
    case 'PARSEL_COZ': db.prepare(`UPDATE parcels SET status = 'ACTIVE', version = version + 1 WHERE id = ?`).run(x.id); break;
    case 'HESAP_ASKI':
      if (db.prepare(`UPDATE users SET status = 'SUSPENDED' WHERE id = ? AND status = 'ACTIVE'`).run(x.id).changes) tumMakamlariBosalt(x.id, sebep, islem.onaylayan_id);
      break;
    case 'HESAP_AC': db.prepare(`UPDATE users SET status = 'ACTIVE' WHERE id = ? AND status = 'SUSPENDED'`).run(x.id); break;
    case 'GOREVDEN_AL': makamBosalt(x.regionId, x.makam, x.userId, sebep, islem.onaylayan_id); break;
    case 'SECIM_IPTAL': {
      db.prepare(`UPDATE secimler SET asama = 'IPTAL', iptal_sebebi = ?, bitis_at = ? WHERE id = ?`).run(`Denetim kurulu: ${islem.gerekce}`, t, x.secim.id);
      // Sonuçlanmış seçim iptal edilirse o seçimle göreve gelenlerin görevi biter
      const tab = x.secim.tur === 'BELEDIYE' ? 'belediye_uyeleri' : 'muhtarlar';
      db.prepare(`UPDATE ${tab} SET bitis = ? WHERE secim_id = ? AND bitis > ?`).run(t, x.secim.id, t);
      L.denetim({ anahtar: `ELECTION_ANNULLED:${x.secim.id}`, aktor: islem.onaylayan_id, eylem: 'ELECTION_ANNULLED', varlik: `SECIM:${x.secim.id}`,
        bolge: x.secim.region_id, herkese: true, sonra: { tur: x.secim.tur, sebep: `Denetim kurulu: ${islem.gerekce}` } });
      break;
    }
  }
}

function rutbeDenetle(aktorId, tur, hedef) {
  if (tur !== 'HESAP_ASKI') return;
  if (rutbe(aktorId) <= rutbe(Number(hedef))) throw new OyunHatasi(403, 'Yetkili bir hesabı askıya alma işlemini yalnızca ondan üst roldeki biri önerebilir ya da onaylayabilir');
}

function islemOner(modId, govde = {}) {
  const tur = String(govde.tur || '');
  const tanim = Object.hasOwn(MODERASYON.islemler, tur) ? MODERASYON.islemler[tur] : null;
  if (!tanim) throw new OyunHatasi(400, 'Geçersiz işlem türü');
  const gerekce = metinAl(govde.gerekce || '', 'Gerekçe', 10, 500);
  const hedef = String(govde.hedef || '').slice(0, 80);
  hedefCoz(tur, hedef);
  if (tur === 'HESAP_ASKI' && Number(hedef) === modId) throw new OyunHatasi(400, 'Kendi hesabın için işlem öneremezsin');
  rutbeDenetle(modId, tur, hedef);
  const sikayetId = govde.sikayetId ? Number(govde.sikayetId) : null;
  const t = simdi();
  return db.transaction(() => {
    const id = db.prepare(`INSERT INTO moderasyon_islemleri (tur, hedef, gerekce, sikayet_id, oneren_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tur, hedef, gerekce, sikayetId, modId, t).lastInsertRowid;
    L.denetim({ aktor: modId, eylem: 'MOD_ACTION_PROPOSED', varlik: `MOD:${id}`, sonra: { tur, hedef }, herkese: false });
    if (!tanim.ikiKisi) {
      const islem = db.prepare(`UPDATE moderasyon_islemleri SET durum = 'UYGULANDI', onaylayan_id = ?, karar_at = ? WHERE id = ? RETURNING *`).get(modId, t, id);
      uygula(islem);
      L.denetim({ aktor: modId, eylem: 'MOD_ACTION_APPLIED', varlik: `MOD:${id}`, sonra: { tur, hedef }, herkese: tur !== 'ICERIK_GIZLE' });
      return { tamam: true, id, uygulandi: true };
    }
    for (const y of yetkililer()) if (y.id !== modId) bildir(y.id, `Onay bekleyen moderasyon işlemi: ${tanim.ad}`, 'yonetim');
    return { tamam: true, id, uygulandi: false, mesaj: 'İkinci bir yetkilinin onayı bekleniyor (iki kişi kuralı).' };
  })();
}

const islemKarar = db.transaction((modId, islemId, govde = {}) => {
  const onay = govde?.onay;
  if (typeof onay !== 'boolean') throw new OyunHatasi(400, 'Karar onay: true ya da onay: false olmalı');
  const i = db.prepare(`SELECT * FROM moderasyon_islemleri WHERE id = ?`).get(Number(islemId));
  if (!i) throw new OyunHatasi(404, 'İşlem bulunamadı');
  if (i.durum !== 'ONAY_BEKLIYOR') throw new OyunHatasi(409, 'İşlem zaten karara bağlandı');
  if (i.oneren_id === modId) throw new OyunHatasi(403, 'Önerdiğin işlemi sen onaylayamazsın (iki kişi kuralı)');
  const tanim = MODERASYON.islemler[i.tur];
  if (onay) rutbeDenetle(modId, i.tur, i.hedef);
  if (onay && tanim.denetciGerekli && ![rolu(i.oneren_id), rolu(modId)].some((r) => r === 'DENETCI' || r === 'ADMIN')) {
    throw new OyunHatasi(403, 'Bu işlem için iki kişiden biri denetçi ya da yönetici olmalı');
  }
  const t = simdi();
  const g = db.prepare(`UPDATE moderasyon_islemleri SET durum = ?, onaylayan_id = ?, karar_at = ? WHERE id = ? AND durum = 'ONAY_BEKLIYOR' RETURNING *`)
    .get(onay ? 'UYGULANDI' : 'REDDEDILDI', modId, t, i.id);
  if (onay) uygula(g);
  L.denetim({ aktor: modId, eylem: onay ? 'MOD_ACTION_APPLIED' : 'MOD_ACTION_REJECTED', varlik: `MOD:${i.id}`, sonra: { tur: i.tur, hedef: i.hedef }, herkese: !!onay });
  bildir(i.oneren_id, `${tanim.ad} önerin ${onay ? 'onaylandı ve uygulandı' : 'reddedildi'}.`, 'yonetim');
  return { tamam: true };
});

// ---------- Görevden alma dilekçesi (sakinler)
const dilekceBolgeTuru = (makam) => (makam === 'MUHTAR' ? SECIM.turler.MUHTAR : SECIM.turler.BELEDIYE);
function imzaSayisi(id) { return db.prepare(`SELECT COUNT(*) c FROM gorevden_alma_imzalar WHERE dilekce_id = ?`).get(id).c; }

function dilekceSonucla(d, t) {
  if (imzaSayisi(d.id) >= d.esik) {
    if (db.prepare(`UPDATE gorevden_alma SET durum = 'BASARILI', kapandi_at = ? WHERE id = ? AND durum = 'ACIK'`).run(t, d.id).changes !== 1) return;
    L.denetim({ anahtar: `RECALL_SUCCEEDED:${d.id}`, eylem: 'RECALL_SUCCEEDED', varlik: `GOREVDEN_ALMA:${d.id}`, bolge: d.region_id, herkese: true, sonra: { makam: d.makam, imza: imzaSayisi(d.id), esik: d.esik } });
    makamBosalt(d.region_id, d.makam, d.hedef_id, 'sakinlerin görevden alma dilekçesi imza eşiğini geçti');
  } else if (d.bitis <= t) {
    if (db.prepare(`UPDATE gorevden_alma SET durum = 'BASARISIZ', kapandi_at = ? WHERE id = ? AND durum = 'ACIK'`).run(t, d.id).changes !== 1) return;
    L.denetim({ anahtar: `RECALL_FAILED:${d.id}`, eylem: 'RECALL_FAILED', varlik: `GOREVDEN_ALMA:${d.id}`, bolge: d.region_id, herkese: true, sonra: { makam: d.makam, imza: imzaSayisi(d.id), esik: d.esik } });
  }
}
function gorevdenAlmaBakim() {
  const t = simdi();
  for (const d of db.prepare(`SELECT * FROM gorevden_alma WHERE durum = 'ACIK' AND bitis <= ?`).all(t)) db.transaction(() => dilekceSonucla(d, t))();
  // Hedef görevden başka yolla ayrıldıysa dilekçe düşer
  for (const d of db.prepare(`SELECT * FROM gorevden_alma WHERE durum = 'ACIK'`).all()) {
    if (gorevdeki(d.region_id, d.makam, d.hedef_id)?.user_id !== d.hedef_id) db.prepare(`UPDATE gorevden_alma SET durum = 'DUSTU', kapandi_at = ? WHERE id = ?`).run(t, d.id);
  }
}

const kutukVar = (id) => !!db.prepare(`SELECT 1 FROM gorevden_alma_kutuk WHERE dilekce_id = ? LIMIT 1`).get(id);
const kutukte = (id, userId) => !!db.prepare(`SELECT 1 FROM gorevden_alma_kutuk WHERE dilekce_id = ? AND user_id = ?`).get(id, userId);
// İmza kütüğü (dilekçe açılırken): bölgede parseli olan, hesabı yeterince eski sakinler; hedef hariç
function imzaKutugu(makam, regionId, hedefId, t) {
  const sinir = t - SECIM.secmenMinHesapYasiMs;
  return require('./secim').sakinler(dilekceBolgeTuru(makam), regionId).filter((s) => s.id !== hedefId && sqlMs(s.created_at) <= sinir);
}

function imzaHakki(userId, d) {
  const secim = require('./secim');
  if (userId === d.hedef_id) return 'Kendi görevden alma dilekçeni imzalayamazsın';
  if (d.id && kutukVar(d.id)) return kutukte(d.id, userId) ? null : 'Dilekçe açıldığında bu bölgenin imza kütüğünde değildin';
  if (!secim.sakinMi(dilekceBolgeTuru(d.makam), d.region_id, userId)) return d.makam === 'MUHTAR' ? 'Bu mahallede parselin olmalı' : 'Bu ilçede parselin olmalı';
  return null;
}

const dilekceBaslat = db.transaction((userId, govde = {}) => {
  const makam = String(govde.makam || '');
  if (!['MUHTAR', 'BASKAN', 'MECLIS'].includes(makam)) throw new OyunHatasi(400, 'Geçersiz makam');
  const regionId = Number(govde.bolgeId);
  const g = gorevdeki(regionId, makam, govde.hedefId);
  if (!g) throw new OyunHatasi(404, 'Bu makamda görevde kimse yok');
  const gerekce = metinAl(govde.gerekce || '', 'Gerekçe', GOREVDEN_ALMA.gerekceMin, 600);
  const tarama = icerikDenetle(gerekce);
  if (tarama.karar === 'ENGEL') throw new OyunHatasi(422, `Gerekçe yayımlanamaz: ${tarama.nedenler.map((n) => n.not).join(', ')}`);
  const d0 = { hedef_id: g.user_id, makam, region_id: regionId };
  const engel = imzaHakki(userId, d0);
  if (engel) throw new OyunHatasi(403, engel);
  const t = simdi();
  const kutuk = imzaKutugu(makam, regionId, g.user_id, t);
  if (!kutuk.some((s) => s.id === userId)) throw new OyunHatasi(403, `Dilekçe başlatmak için hesabın en az ${Math.max(1, Math.round(SECIM.secmenMinHesapYasiMs / SECIM.gunMs))} günlük olmalı`);
  if (t < g.baslangic + (g.bitis - g.baslangic) * GOREVDEN_ALMA.korumaOrani) throw new OyunHatasi(409, 'Görevin ilk döneminde (ilk %20) görevden alma dilekçesi başlatılamaz');
  const son = db.prepare(`SELECT kapandi_at FROM gorevden_alma WHERE region_id = ? AND makam = ? AND hedef_id = ? AND durum = 'BASARISIZ' ORDER BY id DESC LIMIT 1`).get(regionId, makam, g.user_id);
  if (son && son.kapandi_at + GOREVDEN_ALMA.beklemeMs > t) throw new OyunHatasi(409, 'Başarısız bir dilekçeden sonra bekleme süresi dolmadı');
  const uygun = kutuk.length;
  const esik = Math.max(GOREVDEN_ALMA.minImza, Math.ceil(uygun * GOREVDEN_ALMA.imzaOrani));
  if (esik > uygun) throw new OyunHatasi(409, `Dilekçe için en az ${esik} imza gerekir; bölgede imza atabilecek ${uygun} sakin var`);
  let id;
  try {
    id = db.prepare(`INSERT INTO gorevden_alma (region_id, makam, hedef_id, baslatan_id, gerekce, esik, bitis, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(regionId, makam, g.user_id, userId, gerekce, esik, t + GOREVDEN_ALMA.sureMs, t).lastInsertRowid;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new OyunHatasi(409, 'Bu makam için zaten açık bir dilekçe var');
    throw e;
  }
  const kutukEkle = db.prepare(`INSERT INTO gorevden_alma_kutuk (dilekce_id, user_id) VALUES (?, ?)`);
  for (const s of kutuk) kutukEkle.run(id, s.id);
  db.prepare(`INSERT INTO gorevden_alma_imzalar (dilekce_id, user_id, created_at) VALUES (?, ?, ?)`).run(id, userId, t);
  L.denetim({ anahtar: `RECALL_STARTED:${id}`, aktor: userId, eylem: 'RECALL_STARTED', varlik: `GOREVDEN_ALMA:${id}`, bolge: regionId, herkese: true, sonra: { makam, hedef: g.ad, esik } });
  const link = makam === 'MUHTAR' ? `mahalle:${regionId}` : `belediye:${regionId}`;
  for (const s of kutuk) if (s.id !== userId) bildir(s.id, `${g.ad} için görevden alma dilekçesi açıldı (${esik} imza gerekli).`, link);
  dilekceSonucla(db.prepare(`SELECT * FROM gorevden_alma WHERE id = ?`).get(id), t);
  return { tamam: true, id, esik };
});

const dilekceImzala = db.transaction((userId, dilekceId) => {
  const d = db.prepare(`SELECT * FROM gorevden_alma WHERE id = ?`).get(Number(dilekceId));
  if (!d) throw new OyunHatasi(404, 'Dilekçe bulunamadı');
  const t = simdi();
  if (d.durum !== 'ACIK' || d.bitis <= t) throw new OyunHatasi(409, 'Dilekçe imzaya kapalı');
  const engel = imzaHakki(userId, d);
  if (engel) throw new OyunHatasi(403, engel);
  if (db.prepare(`INSERT OR IGNORE INTO gorevden_alma_imzalar (dilekce_id, user_id, created_at) VALUES (?, ?, ?)`).run(d.id, userId, t).changes !== 1) {
    throw new OyunHatasi(409, 'Bu dilekçeyi zaten imzaladın');
  }
  L.denetim({ aktor: userId, eylem: 'RECALL_SIGNED', varlik: `GOREVDEN_ALMA:${d.id}`, bolge: d.region_id });
  dilekceSonucla(d, t);
  const g = db.prepare(`SELECT durum FROM gorevden_alma WHERE id = ?`).get(d.id);
  return { tamam: true, imza: imzaSayisi(d.id), esik: d.esik, durum: g.durum };
});

// Bölge sayfası için dilekçeler (açık olanlar + son kapananlar). İmza listesi açık değildir; yalnızca sayı.
function dilekceler(regionId, userId) {
  return db.prepare(`SELECT g.*, u.display_name AS hedef_ad, b.display_name AS baslatan_ad FROM gorevden_alma g
                     JOIN users u ON u.id = g.hedef_id JOIN users b ON b.id = g.baslatan_id
                     WHERE g.region_id = ? AND (g.durum = 'ACIK' OR g.kapandi_at > ?) ORDER BY g.id DESC LIMIT 5`)
    .all(Number(regionId), simdi() - GOREVDEN_ALMA.beklemeMs)
    .map((d) => ({ id: d.id, makam: d.makam, hedef: d.hedef_ad, baslatan: d.baslatan_ad, gerekce: d.gerekce, esik: d.esik, imza: imzaSayisi(d.id),
      durum: d.durum, bitis: d.bitis, imzaladim: !!userId && !!db.prepare(`SELECT 1 FROM gorevden_alma_imzalar WHERE dilekce_id = ? AND user_id = ?`).get(d.id, userId),
      imzaHakki: userId ? !imzaHakki(userId, d) : false }));
}

// ---------- Yönetim paneli
function panel(modId) {
  const t = simdi();
  const sikayet = db.prepare(`SELECT s.*, u.display_name AS sikayetci FROM sikayetler s JOIN users u ON u.id = s.sikayetci_id
                              ORDER BY (s.durum = 'ACIK') DESC, s.id DESC LIMIT 60`).all()
    .map((s) => ({ ...s, sebepAd: MODERASYON.sebepler[s.sebep], hedef: hedefOzeti(s.hedef_tur, s.hedef_id) }));
  const islemler = db.prepare(`SELECT m.*, o.display_name AS oneren, a.display_name AS onaylayan FROM moderasyon_islemleri m
                               JOIN users o ON o.id = m.oneren_id LEFT JOIN users a ON a.id = m.onaylayan_id ORDER BY (m.durum = 'ONAY_BEKLIYOR') DESC, m.id DESC LIMIT 40`).all()
    .map((m) => ({ ...m, ad: MODERASYON.islemler[m.tur]?.ad, benOnerdim: m.oneren_id === modId }));
  const secimler = db.prepare(`SELECT s.id, s.tur, s.asama, s.region_id, s.bitis_at, s.iptal_sebebi, s.ozet_hash, r.name AS bolge,
                                 (SELECT COUNT(*) FROM itirazlar i WHERE i.secim_id = s.id) AS itiraz,
                                 (SELECT COUNT(*) FROM secim_katilim k WHERE k.secim_id = s.id) AS katilim
                               FROM secimler s JOIN regions r ON r.id = s.region_id ORDER BY s.id DESC LIMIT 30`).all();
  const kararlar = db.prepare(`SELECT p.id, p.tur, p.maliyet, p.durum, p.nitelikli, p.karar_json, r.name AS ilce, u.display_name AS teklif_eden
                               FROM projeler p JOIN regions r ON r.id = p.region_id JOIN users u ON u.id = p.teklif_eden_id ORDER BY p.id DESC LIMIT 30`).all()
    .map((p) => ({ ...p, karar: JSON.parse(p.karar_json || 'null') }));
  const dilekce = db.prepare(`SELECT g.id, g.makam, g.durum, g.esik, g.bitis, r.name AS bolge, u.display_name AS hedef FROM gorevden_alma g
                              JOIN regions r ON r.id = g.region_id JOIN users u ON u.id = g.hedef_id ORDER BY g.id DESC LIMIT 20`).all()
    .map((d) => ({ ...d, imza: imzaSayisi(d.id) }));
  const isaretliMesajlar = db.prepare(`SELECT m.id, m.kanal, m.metin, m.on_tarama, m.created_at, u.display_name AS ad FROM sohbet_mesajlari m
                                       JOIN users u ON u.id = m.user_id WHERE m.on_tarama IS NOT NULL AND m.gizlendi = 0 ORDER BY m.id DESC LIMIT 40`).all();
  const say = (sql, ...p) => db.prepare(sql).get(...p).c;
  return {
    isaretliMesajlar,
    ben: { id: modId, rol: rolu(modId), rolAd: ROLLER[rolu(modId)] },
    ozet: {
      oyuncu: say(`SELECT COUNT(*) c FROM users WHERE is_npc = 0 AND status <> 'DELETED'`),
      aktif24: say(`SELECT COUNT(DISTINCT user_id) c FROM sessions WHERE son_gorulme > datetime('now', '-1 day')`),
      askida: say(`SELECT COUNT(*) c FROM users WHERE status = 'SUSPENDED'`),
      donmusParsel: say(`SELECT COUNT(*) c FROM parcels WHERE status = 'FROZEN'`),
      acikSikayet: say(`SELECT COUNT(*) c FROM sikayetler WHERE durum = 'ACIK'`),
      onayBekleyen: say(`SELECT COUNT(*) c FROM moderasyon_islemleri WHERE durum = 'ONAY_BEKLIYOR'`),
      supheliIslem: say(`SELECT COUNT(*) c FROM trades WHERE flags <> '[]' AND created_at > ?`, t - 7 * SECIM.gunMs),
    },
    sikayetler: sikayet, islemler, secimler, kararlar, dilekceler: dilekce,
    tanimlar: { sebepler: MODERASYON.sebepler, islemler: MODERASYON.islemler, roller: ROLLER },
  };
}

function rolDegistir(adminId, { userId, rol } = {}) {
  if (!Object.hasOwn(ROLLER, rol)) throw new OyunHatasi(400, 'Geçersiz rol');
  const hedef = Number(userId);
  if (hedef === adminId) throw new OyunHatasi(400, 'Kendi rolünü değiştiremezsin');
  const u = db.prepare(`SELECT id, rol FROM users WHERE id = ? AND is_npc = 0 AND status <> 'DELETED'`).get(hedef);
  if (!u) throw new OyunHatasi(404, 'Kullanıcı bulunamadı');
  db.prepare(`UPDATE users SET rol = ? WHERE id = ?`).run(rol, hedef);
  L.denetim({ aktor: adminId, eylem: 'ROLE_CHANGED', varlik: `USER:${hedef}`, once: { rol: u.rol }, sonra: { rol }, herkese: false });
  return { tamam: true };
}

function rotalar(app, { h, auth }) {
  const yetkili = auth.rolGerekli(...YETKILI);
  app.post('/api/sikayet', auth.dogrulanmisGerekli, h((req) => sikayetEt(req.kullanici.id, req.body)));
  app.get('/api/sikayet/tanimlar', h(() => ({ sebepler: MODERASYON.sebepler, hedefTurleri: MODERASYON.hedefTurleri })));
  if (OZELLIK.siyaset) {   // siyaset kapalıyken görevden alma uçları hiç kaydedilmez
    app.post('/api/gorevden-alma', auth.dogrulanmisGerekli, h((req) => dilekceBaslat(req.kullanici.id, req.body)));
    app.post('/api/gorevden-alma/:id/imza', auth.dogrulanmisGerekli, h((req) => dilekceImzala(req.kullanici.id, req.params.id)));
  }
  app.get('/api/yonetim/panel', yetkili, h((req) => panel(req.kullanici.id)));
  app.post('/api/yonetim/sikayet/:id', yetkili, h((req) => sikayetKarar(req.kullanici.id, req.params.id, req.body)));
  app.post('/api/yonetim/islem', yetkili, h((req) => islemOner(req.kullanici.id, req.body)));
  app.post('/api/yonetim/islem/:id', yetkili, h((req) => islemKarar(req.kullanici.id, req.params.id, req.body)));
  app.post('/api/yonetim/rol', auth.rolGerekli('ADMIN'), h((req) => rolDegistir(req.kullanici.id, req.body)));
}

// İstemci metinleri için dilekçe kuralları (sabit metin yerine)
const dilekceKurallari = { imzaOrani: GOREVDEN_ALMA.imzaOrani, minImza: GOREVDEN_ALMA.minImza, sureMs: GOREVDEN_ALMA.sureMs,
  korumaOrani: GOREVDEN_ALMA.korumaOrani, minHesapYasiMs: SECIM.secmenMinHesapYasiMs };

module.exports = {
  dilekceKurallari,
  rotalar, sikayetEt, sikayetKarar, islemOner, islemKarar, makamBosalt, tumMakamlariBosalt, gorevdeki,
  dilekceBaslat, dilekceImzala, dilekceler, gorevdenAlmaBakim, panel, rolDegistir, YETKILI,
};
