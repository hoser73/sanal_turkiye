// Süreç içi olay yolu: bildirimler ve herkese açık oyun olayları canlı bağlantılara (WebSocket) ve web push'a buradan akar.
// Olaylar işlem bittikten sonra (setImmediate) yayılır; istemci yalnızca "yenile" ipucu alır, veriyi API'den okur.
const { EventEmitter } = require('events');

const yol = new EventEmitter();
yol.setMaxListeners(50);
const yay = (tur, veri) => setImmediate(() => yol.emit(tur, veri));

module.exports = { yol, yay };
