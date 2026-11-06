// Moderasyon ve denetim (§10, §14): şikâyetler ve iki kişi kuralıyla ağır işlemler (parsel dondurma, hesap askısı).
const db = require('./db');
const L = require('./lib/ledger');
const { icerikDenetle } = require('./lib/icerik');
const { MODERASYON, ROLLER } = require('./config/rules');
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
const yetkililer = () => db.prepare(`SELECT id FROM users WHERE rol IN ('MODERATOR', 'DENETCI', 'ADMIN') AND status = 'ACTIVE'`).all();

// ---------- Şikâyet hedefleri
const GIZLENEBILIR = { MESAJ: 'sohbet_mesajlari' };
function hedefOzeti(tur, id) {
  const tek = (sql, ...p) => { try { return db.prepare(sql).get(...p); } catch { return null; } };
  switch (tur) {
    case 'KULLANICI': { const u = tek(`SELECT id, display_name, status FROM users WHERE id = ? AND is_npc = 0`, Number(id)); return u && { baslik: u.display_name, durum: u.status }; }
    case 'PARSEL': { const p = tek(`SELECT p.id, p.status, u.display_name AS sahip FROM parcels p LEFT JOIN users u ON u.id = p.owner_user_id WHERE p.id = ?`, String(id)); return p && { baslik: `${p.id}${p.sahip ? ` · ${p.sahip}` : ''}`, durum: p.status, link: `parsel:${p.id}` }; }
    case 'MESAJ': { const m = tek(`SELECT m.metin, m.gizlendi, u.display_name AS ad FROM sohbet_mesajlari m JOIN users u ON u.id = m.user_id WHERE m.id = ?`, Number(id)); return m && { baslik: `${m.ad}: “${m.metin.slice(0, 140)}”`, durum: m.gizlendi ? 'GIZLI' : 'YAYINDA' }; }
    case 'ILAN': { const i = tek(`SELECT parcel_id, asking_price, status FROM listings WHERE id = ?`, Number(id)); return i && { baslik: `İlan #${id} · ${i.parcel_id} · ₳${i.asking_price}`, durum: i.status, link: `parsel:${i.parcel_id}` }; }
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

// ---------- İki kişi kuralı
function hedefCoz(tur, hedef) {
  const h = String(hedef || '');
  switch (tur) {
    case 'ICERIK_GIZLE': { const [t, id] = h.split(':'); if (!GIZLENEBILIR[t] || !hedefOzeti(t, id)) throw new OyunHatasi(404, 'İçerik bulunamadı (MESAJ:<id>)'); return { t, id: Number(id) }; }
    case 'PARSEL_DONDUR': case 'PARSEL_COZ': { if (!hedefOzeti('PARSEL', h)) throw new OyunHatasi(404, 'Parsel bulunamadı'); return { id: h }; }
    case 'HESAP_ASKI': case 'HESAP_AC': { if (!hedefOzeti('KULLANICI', h)) throw new OyunHatasi(404, 'Hesap bulunamadı'); return { id: Number(h) }; }
    default: throw new OyunHatasi(400, 'Geçersiz işlem türü');
  }
}

function uygula(islem) {
  const tur = islem.tur;
  const x = hedefCoz(tur, islem.hedef);
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
    case 'HESAP_ASKI': db.prepare(`UPDATE users SET status = 'SUSPENDED' WHERE id = ? AND status = 'ACTIVE'`).run(x.id); break;
    case 'HESAP_AC': db.prepare(`UPDATE users SET status = 'ACTIVE' WHERE id = ? AND status = 'SUSPENDED'`).run(x.id); break;
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

// ---------- Yönetim paneli
function panel(modId) {
  const t = simdi();
  const sikayet = db.prepare(`SELECT s.*, u.display_name AS sikayetci FROM sikayetler s JOIN users u ON u.id = s.sikayetci_id
                              ORDER BY (s.durum = 'ACIK') DESC, s.id DESC LIMIT 60`).all()
    .map((s) => ({ ...s, sebepAd: MODERASYON.sebepler[s.sebep], hedef: hedefOzeti(s.hedef_tur, s.hedef_id) }));
  const islemler = db.prepare(`SELECT m.*, o.display_name AS oneren, a.display_name AS onaylayan FROM moderasyon_islemleri m
                               JOIN users o ON o.id = m.oneren_id LEFT JOIN users a ON a.id = m.onaylayan_id ORDER BY (m.durum = 'ONAY_BEKLIYOR') DESC, m.id DESC LIMIT 40`).all()
    .map((m) => ({ ...m, ad: MODERASYON.islemler[m.tur]?.ad, benOnerdim: m.oneren_id === modId }));
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
      supheliIslem: say(`SELECT COUNT(*) c FROM trades WHERE flags <> '[]' AND created_at > ?`, t - 7 * 24 * 3600_000),
    },
    sikayetler: sikayet, islemler,
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
  app.get('/api/yonetim/panel', yetkili, h((req) => panel(req.kullanici.id)));
  app.post('/api/yonetim/sikayet/:id', yetkili, h((req) => sikayetKarar(req.kullanici.id, req.params.id, req.body)));
  app.post('/api/yonetim/islem', yetkili, h((req) => islemOner(req.kullanici.id, req.body)));
  app.post('/api/yonetim/islem/:id', yetkili, h((req) => islemKarar(req.kullanici.id, req.params.id, req.body)));
  app.post('/api/yonetim/rol', auth.rolGerekli('ADMIN'), h((req) => rolDegistir(req.kullanici.id, req.body)));
}

module.exports = { rotalar, sikayetEt, sikayetKarar, islemOner, islemKarar, panel, rolDegistir, YETKILI };
