// E-posta gönderimi. SMTP_URL tanımlıysa gerçek gönderim (nodemailer); değilse geliştirme posta kutusuna yazılır
// (giden_postalar tablosu, /gelistirici/posta.html). Üretimde SMTP_URL zorunludur.
const db = require('./db');

const GONDEREN = process.env.POSTA_GONDEREN || 'Sanal Türkiye <bildirim@sanalturkiye.test>';
let tasiyici = null;
function smtp() {
  if (!process.env.SMTP_URL) return null;
  if (!tasiyici) tasiyici = require('nodemailer').createTransport(process.env.SMTP_URL);
  return tasiyici;
}

async function gonder(alici, konu, metin) {
  db.prepare(`INSERT INTO giden_postalar (alici, konu, govde, created_at) VALUES (?, ?, ?, datetime('now'))`).run(alici, konu, metin);
  const t = smtp();
  if (!t) {
    if (process.env.NODE_ENV === 'production') console.error('SMTP_URL tanımlı değil; e-posta gönderilemedi');
    else if (!process.env.SESSIZ) console.log(`✉️  [geliştirme posta kutusu] ${alici} — ${konu}`);
    return;
  }
  try { await t.sendMail({ from: GONDEREN, to: alici, subject: konu, text: metin }); } catch (e) { console.error('E-posta gönderilemedi:', e.message); }
}

function gelistirmeKutusu(limit = 30) {
  return db.prepare(`SELECT id, alici, konu, govde, created_at FROM giden_postalar ORDER BY id DESC LIMIT ?`).all(limit);
}

module.exports = { gonder, gelistirmeKutusu };
