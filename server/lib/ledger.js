// Ekonomi defteri: akçe (çift kayıt) + envanter + denetim kaydı.
// Bu fonksiyonlar her zaman bir db.transaction İÇİNDE çağrılmalıdır.
const crypto = require('crypto');
const { tl } = require('./para');
const db = require('../db');

class OyunHatasi extends Error {
  constructor(status, mesaj, kod) {
    super(mesaj);
    this.status = status;
    this.kod = kod;
  }
}

const yeniTx = () => crypto.randomUUID();
const hesap = (userId) => `U:${userId}`;

const stmt = {
  ekle: db.prepare(`INSERT INTO wallet_ledger (account, user_id, debit, credit, tx_group, reason) VALUES (?, ?, ?, ?, ?, ?)`),
  bakiye: db.prepare(`SELECT COALESCE(SUM(credit) - SUM(debit), 0) AS b FROM wallet_ledger WHERE user_id = ?`),
  hesapBakiye: db.prepare(`SELECT COALESCE(SUM(credit) - SUM(debit), 0) AS b FROM wallet_ledger WHERE account = ?`),
  envEkle: db.prepare(`INSERT INTO inventory_ledger (user_id, item_id, delta, reason, tx_group) VALUES (?, ?, ?, ?, ?)`),
  envMiktar: db.prepare(`SELECT COALESCE(SUM(delta), 0) AS m FROM inventory_ledger WHERE user_id = ? AND item_id = ?`),
  envTumu: db.prepare(`SELECT item_id, SUM(delta) AS miktar FROM inventory_ledger WHERE user_id = ? GROUP BY item_id HAVING miktar > 0`),
  denetim: db.prepare(`INSERT INTO audit_events (idempotency_key, actor_id, action, entity, before_json, after_json, region_id, public)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
};

const yuvarla = (n) => Math.round(n * 100) / 100;

function bakiye(userId) {
  return yuvarla(stmt.bakiye.get(userId).b);
}

function hesapBakiye(account) {
  return yuvarla(stmt.hesapBakiye.get(account).b);
}

// Hesaptan hesaba aktarım. Kaynak/hedef: "U:<id>" oyuncu, "ESCROW:..." emanet (kilitli teklif), "SYS:..." sistem.
function aktar({ kaynak, hedef, tutar, sebep, tx = yeniTx() }) {
  tutar = yuvarla(tutar);
  if (!(tutar > 0)) throw new OyunHatasi(400, 'Geçersiz tutar');
  const kaynakUser = kaynak.startsWith('U:') ? Number(kaynak.slice(2)) : null;
  const hedefUser = hedef.startsWith('U:') ? Number(hedef.slice(2)) : null;
  if (kaynakUser && bakiye(kaynakUser) < tutar) {
    throw new OyunHatasi(402, `Yetersiz bakiye: ${tl(tutar)} gerekli`, 'YETERSIZ_BAKIYE');
  }
  if (kaynak.startsWith('ESCROW:') && hesapBakiye(kaynak) < tutar) {
    throw new Error(`Emanet hesabı tutarsız: ${kaynak}`);   // olmamalı; işlemi geri alır
  }
  stmt.ekle.run(kaynak, kaynakUser, tutar, 0, tx, sebep);
  stmt.ekle.run(hedef, hedefUser, 0, tutar, tx, sebep);
  return tx;
}

const harca = (userId, tutar, sebep, tx) => aktar({ kaynak: hesap(userId), hedef: 'SYS:SINK', tutar, sebep, tx });
const odul = (userId, tutar, sebep, tx) => aktar({ kaynak: 'SYS:MINT', hedef: hesap(userId), tutar, sebep, tx });

function envanter(userId) {
  return stmt.envTumu.all(userId);
}
function envanterMiktar(userId, itemId) {
  return stmt.envMiktar.get(userId, itemId).m;
}
function envanterDegis(userId, itemId, delta, sebep, tx = yeniTx()) {
  if (!Number.isInteger(delta) || delta === 0) throw new OyunHatasi(400, 'Geçersiz miktar');
  // Ürün girmeden önce birikmiş depo bozulması işlenir: yeni gelen ürün geçmiş günlerin bozulmasına uğramaz
  if (delta > 0) require('../ekonomi').bozulmaGuncelle(userId, itemId);
  if (delta < 0 && envanterMiktar(userId, itemId) < -delta) {
    throw new OyunHatasi(409, 'Envanterde yeterli ürün yok', 'YETERSIZ_URUN');
  }
  stmt.envEkle.run(userId, itemId, delta, sebep, tx);
}

// Olay kaydı. idempotency_key verilirse aynı olay ikinci kez yazılamaz (UNIQUE).
function denetim({ anahtar = null, aktor = null, eylem, varlik = null, once = null, sonra = null, bolge = null, herkese = false }) {
  stmt.denetim.run(anahtar, aktor, eylem, varlik,
    once == null ? null : JSON.stringify(once),
    sonra == null ? null : JSON.stringify(sonra),
    bolge, herkese ? 1 : 0);
  const olaylar = require('./olaylar');
  if (herkese) olaylar.yay('olay', { eylem, bolge, varlik, aktor });   // aktor yalnızca sunucu içinde (canli.js 'ben' bayrağı için)
  if (aktor) olaylar.yay('eylem', { eylem, aktor, bolge, varlik });
}

module.exports = { OyunHatasi, yeniTx, hesap, bakiye, hesapBakiye, aktar, harca, odul, envanter, envanterMiktar, envanterDegis, denetim, yuvarla };
