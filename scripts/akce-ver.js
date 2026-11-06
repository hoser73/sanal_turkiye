#!/usr/bin/env node
// Geliştirme hesabına oyun parası yükleme (yalnızca yerel geliştirme): npm run akce -- <e-posta> [tutar ₺]
// Tutar TL olarak verilir, defterde oyun birimine çevrilir (BIRIM.kat); para SYS:MINT'ten çift kayıtlı defterle basılır ve
// denetim kaydına yazılır. Üretimde (NODE_ENV=production) çalışmaz. Oyun parası gerçek para değildir.
if (process.env.NODE_ENV === 'production') { console.error('Bu komut üretimde çalışmaz.'); process.exit(1); }
const db = require('../server/db');
const L = require('../server/lib/ledger');
const { tl } = require('../server/lib/para');
const { BIRIM } = require('../server/config/rules');

const [email, tutarArg = '3000000000'] = process.argv.slice(2);
const tutarTl = Number(tutarArg);
if (!email || !Number.isFinite(tutarTl) || tutarTl <= 0 || tutarTl > 3e11) {
  console.error('Kullanım: npm run akce -- <e-posta> [tutar ₺, varsayılan 3.000.000.000, en çok 300.000.000.000]');
  process.exit(1);
}
const tutar = tutarTl / BIRIM.kat;
const u = db.prepare(`SELECT id, is_npc FROM users WHERE email = ? AND silindi_at IS NULL`).get(email.trim().toLowerCase());
if (!u || u.is_npc) { console.error('Bu e-postayla oyuncu hesabı yok'); process.exit(1); }
L.odul(u.id, tutar, 'Geliştirme bakiyesi (konsol)');
L.denetim({ eylem: 'DEV_FUNDS_GRANTED', varlik: `USER:${u.id}`, sonra: { tutar, kaynak: 'konsol' } });
console.log(`${email}: +${tl(tutar)} → bakiye ${tl(L.bakiye(u.id))}`);
