#!/usr/bin/env node
// Geliştirme hesabına akçe yükleme (yalnızca yerel geliştirme): npm run akce -- <e-posta> [tutar]
// Akçe SYS:MINT'ten çift kayıtlı defterle basılır ve denetim kaydına yazılır. Üretimde (NODE_ENV=production) çalışmaz.
if (process.env.NODE_ENV === 'production') { console.error('Bu komut üretimde çalışmaz.'); process.exit(1); }
const db = require('../server/db');
const L = require('../server/lib/ledger');

const [email, tutarArg = '10000000'] = process.argv.slice(2);
const tutar = Number(tutarArg);
if (!email || !Number.isFinite(tutar) || tutar <= 0 || tutar > 1e9) {
  console.error('Kullanım: npm run akce -- <e-posta> [tutar, varsayılan 10000000, en çok 1000000000]');
  process.exit(1);
}
(async () => {
  const u = await db.get(`SELECT id, is_npc FROM users WHERE email = ? AND silindi_at IS NULL`, email.trim().toLowerCase());
  if (!u || u.is_npc) { console.error('Bu e-postayla oyuncu hesabı yok'); process.exit(1); }
  await db.tx(async () => {
    await L.odul(u.id, tutar, 'Geliştirme bakiyesi (konsol)');
    await L.denetim({ eylem: 'DEV_FUNDS_GRANTED', varlik: `USER:${u.id}`, sonra: { tutar, kaynak: 'konsol' } });
  });
  console.log(`${email}: +₳${tutar.toLocaleString('tr-TR')} → bakiye ₳${(await L.bakiye(u.id)).toLocaleString('tr-TR')}`);
  await db.kapat();
})().catch((e) => { console.error(e.message); process.exit(1); });
