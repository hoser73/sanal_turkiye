// Olay yolu: bildirimler ve herkese açık oyun olayları canlı bağlantılara (WebSocket) ve web push'a buradan akar.
// Olay, onu doğuran işlem kaydedildikten sonra yayılır (geri alınan işlemin olayı hiç yayılmaz). İki dinleme noktası vardır:
//   yol   — yalnızca olayı doğuran sunucuda: yan etkisi olan dinleyiciler (TP, meslek puanı, web push, demo sakin yanıtı)
//           çok sunuculu kurulumda bir kez çalışsın diye.
//   yayin — bütün sunucularda: canlı bağlantılara iletim (server/canli.js). Postgres'te LISTEN/NOTIFY, SQLite'ta süreç içi.
// İstemci yalnızca "yenile" ipucu alır, veriyi API'den okur.
const { EventEmitter } = require('events');
const db = require('../db');

const yol = new EventEmitter();
const yayin = new EventEmitter();
yol.setMaxListeners(50);
yayin.setMaxListeners(50);
db.dinle(({ tur, veri }) => yayin.emit(tur, veri));
const yay = (tur, veri) => db.sonra(() => { yol.emit(tur, veri); db.yayinla({ tur, veri }); });

module.exports = { yol, yayin, yay };
