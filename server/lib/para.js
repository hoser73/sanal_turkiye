// Oyun parası: gerçekçi TL görünümü. Tutarlar defterde ve kurallarda küçük oyun biriminde tutulur (denge, kuruş
// hassasiyeti, geçmiş kayıtlar değişmez); oyuncuya her yerde BIRIM.kat ile çarpılıp tam TL olarak gösterilir.
// İstemcide aynı katsayı public/js/yardimci.js TL_KAT'tadır (ikisi eşit tutulmalı). Oyun TL'si gerçek para değildir.
const { BIRIM } = require('../config/rules');

const tlDegeri = (n) => Math.round((Number(n) || 0) * BIRIM.kat);
const tl = (n) => `${BIRIM.sembol}${tlDegeri(n).toLocaleString('tr-TR')}`;

module.exports = { tl, tlDegeri };
