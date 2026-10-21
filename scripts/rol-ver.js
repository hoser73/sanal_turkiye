#!/usr/bin/env node
// Yetkili rolü verme (sunucu konsolundan): npm run rol -- <e-posta> <OYUNCU|MODERATOR|DENETCI|ADMIN>
// İlk yöneticiyi atamanın tek yolu budur; sonraki roller panelden ADMIN tarafından da verilebilir.
const db = require('../server/db');
const L = require('../server/lib/ledger');
const { ROLLER } = require('../server/config/rules');

const [email, rol] = process.argv.slice(2);
if (!email || !Object.hasOwn(ROLLER, rol || '')) {
  console.error(`Kullanım: npm run rol -- <e-posta> <${Object.keys(ROLLER).join('|')}>`);
  process.exit(1);
}
const u = db.prepare(`SELECT id, rol, totp_aktif FROM users WHERE email = ? AND silindi_at IS NULL`).get(email.trim().toLowerCase());
if (!u) { console.error('Bu e-postayla hesap yok'); process.exit(1); }
db.prepare(`UPDATE users SET rol = ? WHERE id = ?`).run(rol, u.id);
L.denetim({ eylem: 'ROLE_CHANGED', varlik: `USER:${u.id}`, once: { rol: u.rol }, sonra: { rol, kaynak: 'konsol' } });
console.log(`${email}: ${u.rol} → ${rol}${rol !== 'OYUNCU' && !u.totp_aktif ? '\nNot: panele girebilmesi için hesabında iki adımlı doğrulamayı açması gerekir (YONETICI_2FA_ZORUNLU=0 yalnızca geliştirmede).' : ''}`);
