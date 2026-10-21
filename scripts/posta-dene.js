#!/usr/bin/env node
// SMTP ayarını dener: npm run posta-dene -- adres@ornek.com  (SMTP_URL ve POSTA_GONDEREN ortamdan okunur)
const alici = process.argv[2];
if (!alici || !alici.includes('@')) { console.error('Kullanım: npm run posta-dene -- adres@ornek.com'); process.exit(1); }
if (!process.env.SMTP_URL) { console.error('SMTP_URL tanımlı değil'); process.exit(1); }
const posta = require('../server/posta');
posta.gonder(alici, 'Sanal Türkiye — SMTP denemesi', 'Bu bir deneme iletisidir. SMTP ayarların çalışıyor.',
  { baslik: 'SMTP çalışıyor 🎉', paragraflar: ['Bu bir deneme iletisidir.', 'Doğrulama ve parola sıfırlama e-postaları bu ayarlarla gönderilecek.'] })
  .then((r) => { console.log(JSON.stringify(r)); process.exit(r.gonderildi ? 0 : 1); });
