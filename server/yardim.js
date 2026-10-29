// Kooperatif yardım istekleri: üye kooperatifinden bir ürün ister ("10 buğday lazım"); diğer üyeler envanterinden gönderir.
// Ürün doğrudan isteyenin envanterine geçer; yardım eden COOP_HELPED olayıyla TP, yol puanı ve hasat yarışı puanı alır
// (akçe aktarılmaz). Değer aktarmayı sınırlamak için YARDIM kuralları: tek istekte en çok maksAdet, üye başına tek açık
// istek ve istekler arasında bekleme, yardım edene günde en çok gunlukYardim gönderim; gönderen komşulukla aynı seviye eşiğini
// geçmeli (yan hesap ürün akıtamasın) ve ödül olayı bir istekte yardımcı başına bir kez. Dükkân, yöresel ve balık ürünleri istenmez.
const db = require('./db');
const L = require('./lib/ledger');
const { OyunHatasi } = L;
const { YARDIM: Y, URUNLER } = require('./config/rules');


const simdi = () => Date.now();
const istenebilir = (kod) => { const u = Object.hasOwn(URUNLER, kod) ? URUNLER[kod] : null; return !!u && !u.dukkan && !u.sarf && !u.balik && !u.yoresel; };
const gunBasi = (t) => Date.parse(`${new Date(t + 3 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`) - 3 * 3600_000;
const q = {
  uyelik: db.sorgu(`SELECT u.koop_id FROM kooperatif_uyeleri u JOIN kooperatifler k ON k.id = u.koop_id WHERE u.user_id = ? AND k.durum = 'AKTIF'`),
  istek: db.sorgu('SELECT * FROM yardim_istekleri WHERE id = ?'),
  istekKilitli: db.sorgu('SELECT * FROM yardim_istekleri WHERE id = ? FOR UPDATE'),
  ad: db.sorgu('SELECT display_name FROM users WHERE id = ?'),
  acikIstegim: db.sorgu(`SELECT id FROM yardim_istekleri WHERE user_id = ? AND durum = 'ACIK' AND bitis > ?`),
  sonIstegim: db.sorgu('SELECT MAX(created_at) AS t FROM yardim_istekleri WHERE user_id = ?'),
  bugunYardim: db.sorgu('SELECT COUNT(*) AS c FROM yardim_katkilari WHERE user_id = ? AND at >= ?'),
  katkimVar: db.sorgu('SELECT 1 FROM yardim_katkilari WHERE istek_id = ? AND user_id = ? LIMIT 1'),
  acik: db.sorgu(`SELECT i.*, u.display_name AS ad FROM yardim_istekleri i JOIN users u ON u.id = i.user_id
    WHERE i.koop_id = ? AND i.durum = 'ACIK' AND i.bitis > ? ORDER BY i.id DESC LIMIT 20`),
};

const iste = (userId, govde = {}) => db.tx(async () => {
  const u = await q.uyelik.get(userId);
  if (!u) throw new OyunHatasi(403, 'Yardım istemek için bir kooperatife üye olmalısın');
  const urun = String(govde.urun || ''), adet = Number(govde.adet), t = simdi();
  if (!istenebilir(urun)) throw new OyunHatasi(400, 'Bu ürün istenemez');
  if (!Number.isInteger(adet) || adet < 1 || adet > Y.maksAdet) throw new OyunHatasi(400, `Adet 1–${Y.maksAdet} olmalı`);
  await db.kilit(`yardim-iste:${userId}`);   // tek açık istek ve bekleme süresi eşzamanlı isteklerde de geçerli
  if (await q.acikIstegim.get(userId, t)) throw new OyunHatasi(409, 'Zaten açık bir isteğin var', 'ACIK_ISTEK');
  const son = (await q.sonIstegim.get(userId))?.t;
  if (son && t - son < Y.beklemeMs) throw new OyunHatasi(409, `Yeni istek için ${Math.ceil((son + Y.beklemeMs - t) / 60_000)} dakika bekle`, 'BEKLE');
  const id = Number((await db.run('INSERT INTO yardim_istekleri (koop_id, user_id, urun, adet, created_at, bitis) VALUES (?, ?, ?, ?, ?, ?)',
    u.koop_id, userId, urun, adet, t, t + Y.sureMs)).lastInsertRowid);
  const ad = (await q.ad.get(userId)).display_name;
  for (const m of await db.all('SELECT user_id FROM kooperatif_uyeleri WHERE koop_id = ? AND user_id <> ?', u.koop_id, userId)) {
    await require('./pazar').bildir(m.user_id, `🙋 ${ad} kooperatiften ${adet} ${URUNLER[urun].ad} istiyor`, 'arazilerim');
  }
  return { tamam: true, id };
});

const gonder = (userId, istekId, govde = {}) => db.tx(async () => {
  const i = await q.istekKilitli.get(Number(istekId)), t = simdi();   // aynı isteğe eşzamanlı gönderimler sıraya girer
  if (!i) throw new OyunHatasi(404, 'İstek bulunamadı');
  if (i.durum !== 'ACIK' || i.bitis <= t) throw new OyunHatasi(409, 'Bu istek kapandı');
  if (i.user_id === userId) throw new OyunHatasi(400, 'Kendi isteğine gönderemezsin');
  if ((await q.uyelik.get(userId))?.koop_id !== i.koop_id) throw new OyunHatasi(403, 'Yalnızca aynı kooperatifin üyeleri gönderebilir');
  await require('./komsuluk').gondericiSeviyesi(userId, 'Kooperatife ürün göndermek');
  await db.kilit(`yardim-gonder:${userId}`);
  if ((await q.bugunYardim.get(userId, gunBasi(t))).c >= Y.gunlukYardim) throw new OyunHatasi(409, `Bugün en çok ${Y.gunlukYardim} kez yardım gönderebilirsin`, 'GUNLUK');
  const adet = Math.min(Number(govde.adet) || (i.adet - i.gelen), i.adet - i.gelen);
  if (!Number.isInteger(adet) || adet < 1) throw new OyunHatasi(400, 'Geçersiz adet');
  if (await L.envanterMiktar(userId, i.urun) < adet) throw new OyunHatasi(409, `Envanterinde ${adet} ${URUNLER[i.urun].ad} yok`, 'MALZEME');
  const tx = L.yeniTx();
  await L.envanterDegis(userId, i.urun, -adet, `Kooperatif yardımı #${i.id}`, tx);
  await L.envanterDegis(i.user_id, i.urun, adet, `Kooperatif yardımı #${i.id}`, tx);
  const gelen = i.gelen + adet, tamam = gelen >= i.adet, ilkKatki = !await q.katkimVar.get(i.id, userId);
  await db.run('UPDATE yardim_istekleri SET gelen = ?, durum = ? WHERE id = ?', gelen, tamam ? 'TAMAM' : 'ACIK', i.id);
  await db.run('INSERT INTO yardim_katkilari (istek_id, user_id, adet, at) VALUES (?, ?, ?, ?)', i.id, userId, adet, t);
  const ad = (await q.ad.get(userId)).display_name;
  await require('./pazar').bildir(i.user_id, `🤝 ${ad} sana ${adet} ${URUNLER[i.urun].ad} gönderdi${tamam ? '; isteğin tamamlandı' : ''}`, 'arazilerim');
  // TP, yol, yarış ve imece puanı: aynı isteğe parça parça göndermek ödülü katlamasın
  if (ilkKatki) await L.denetim({ aktor: userId, eylem: 'COOP_HELPED', varlik: `YARDIM:${i.id}`, sonra: { urun: i.urun, adet } });
  return { tamam: true, adet, istekTamam: tamam };
});

const kapat = (userId, istekId) => db.tx(async () => {
  const i = await q.istekKilitli.get(Number(istekId));
  if (!i || i.user_id !== userId) throw new OyunHatasi(404, 'İstek bulunamadı');
  if (i.durum !== 'ACIK') throw new OyunHatasi(409, 'Bu istek zaten kapalı');
  await db.run(`UPDATE yardim_istekleri SET durum = 'KAPANDI' WHERE id = ?`, i.id);
  return { tamam: true };
});

// Kooperatifin açık istekleri, benim isteğim ve istenebilir ürünler (envanterdeki miktarlarla)
async function durumu(userId, t = simdi()) {
  const u = await q.uyelik.get(userId);
  if (!u) return { uye: false };
  const istekler = [];
  for (const i of await q.acik.all(u.koop_id, t)) {
    istekler.push({ id: i.id, ad: i.ad, ben: i.user_id === userId, urun: i.urun, urunAd: URUNLER[i.urun].ad,
      ikon: URUNLER[i.urun].ikon, adet: i.adet, gelen: i.gelen, kalanMs: i.bitis - t, eldeki: await L.envanterMiktar(userId, i.urun) });
  }
  const son = (await q.sonIstegim.get(userId))?.t;
  return {
    uye: true, istekler, bugunYardim: (await q.bugunYardim.get(userId, gunBasi(t))).c, gunlukYardim: Y.gunlukYardim, maksAdet: Y.maksAdet,
    beklemeMs: istekler.some((i) => i.ben) ? null : Math.max(0, (son || 0) + Y.beklemeMs - t),
    urunler: Object.entries(URUNLER).filter(([k]) => istenebilir(k)).map(([kod, x]) => ({ kod, ad: x.ad, ikon: x.ikon })),
  };
}

function rotalar(app, { h, auth }) {
  app.get('/api/yardim', auth.girisGerekli, h((req) => durumu(req.kullanici.id)));
  app.post('/api/yardim', auth.dogrulanmisGerekli, h((req) => iste(req.kullanici.id, req.body || {})));
  app.post('/api/yardim/:id/gonder', auth.dogrulanmisGerekli, h((req) => gonder(req.kullanici.id, req.params.id, req.body || {})));
  app.post('/api/yardim/:id/kapat', auth.girisGerekli, h((req) => kapat(req.kullanici.id, req.params.id)));
}

module.exports = { rotalar, durumu, iste, gonder, kapat, istenebilir };
