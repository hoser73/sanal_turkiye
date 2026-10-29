// Yöre setleri: Türkiye'nin tarım yörelerinden üçer illik setler (KOLEKSIYON, config/rules.js). Setin her ilinde en az bir
// parselin varsa set tamamdır ve tamam olduğu sürece o illerdeki parsellerinin hasadı hasatBonus kadar artar (oyun.js
// hasatEt). Set ilk kez tamamlanınca bir kerelik akçe ödülü ve rozet verilir; parsel satılıp set bozulursa bonus durur,
// ödül geri alınmaz. Tamamlanma parsel edinilince ve satın alınınca (olay yolu) ve set listesi açılınca denetlenir.
const db = require('./db');
const L = require('./lib/ledger');
const { KOLEKSIYON: K } = require('./config/rules');
const { yol } = require('./lib/olaylar');

const q = {
  iller: db.sorgu(`SELECT DISTINCT r.plaka FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ?`),
  plaka: db.sorgu(`SELECT plaka FROM regions WHERE id = ?`),
  odul: db.sorgu('INSERT OR IGNORE INTO koleksiyon_odulleri (user_id, kod, at) VALUES (?, ?, ?)'),
  odullu: db.sorgu('SELECT kod FROM koleksiyon_odulleri WHERE user_id = ?'),
  ilAdlari: db.sorgu(`SELECT plaka, name FROM regions WHERE type = 'IL'`),
};
// İl adları bir kez yüklenir; ilAdiBul senkron kalsın diye kullanmadan önce ilAdlariYukle beklenir
let ilAdi = null;
const ilAdlariYukle = async () => (ilAdi ??= new Map((await q.ilAdlari.all()).map((r) => [r.plaka, r.name])));
const ilAdiBul = (plaka) => ilAdi?.get(plaka) || plaka;
const sahipIller = async (userId) => new Set((await q.iller.all(userId)).map((r) => r.plaka));
const tamamlar = (iller) => Object.entries(K.setler).filter(([, s]) => s.iller.every((p) => iller.has(p))).map(([kod]) => kod);

// Parselin ilinde, sahibinin tamamlanmış bir seti varsa hasat bonusu
async function hasatBonusu(sahipId, ilId) {
  if (!sahipId) return 0;
  const plaka = (await q.plaka.get(ilId))?.plaka;
  if (!plaka || !Object.values(K.setler).some((s) => s.iller.includes(plaka))) return 0;
  const iller = await sahipIller(sahipId);
  return Object.values(K.setler).some((s) => s.iller.includes(plaka) && s.iller.every((p) => iller.has(p))) ? K.hasatBonus : 0;
}

// Yeni tamamlanan setlere bir kerelik ödül
const denetle = (userId) => db.tx(async () => {
  const yeni = [];
  for (const kod of tamamlar(await sahipIller(userId))) {
    if ((await q.odul.run(userId, kod, Date.now())).changes !== 1) continue;
    const s = K.setler[kod];
    await ilAdlariYukle();
    await L.odul(userId, K.odul, `Yöre seti: ${s.ad}`, L.yeniTx());
    await require('./dunya').rozetVer(userId, `SET_${kod}`, `${s.ad} seti`, s.ikon, `${s.iller.map(ilAdiBul).join(', ')} illerinin hepsinde arazisi oldu.`);
    await require('./pazar').bildir(userId, `${s.ikon} ${s.ad} setini tamamladın! +${K.odul} akçe; bu illerdeki hasadın %${K.hasatBonus * 100} fazla.`, 'arazilerim');
    await L.denetim({ aktor: userId, eylem: 'COLLECTION_COMPLETED', varlik: `SET:${kod}`, sonra: { odul: K.odul } });
    yeni.push(kod);
  }
  return yeni;
});
yol.on('eylem', ({ eylem, aktor }) => {
  if (!['PARCEL_ACQUIRED', 'PARCEL_TRADED'].includes(eylem) || !aktor) return;
  denetle(aktor).catch(() => { /* kullanıcı silinmiş olabilir */ });
});

async function liste(userId) {
  await denetle(userId);
  await ilAdlariYukle();
  const iller = await sahipIller(userId), odullu = new Set((await q.odullu.all(userId)).map((r) => r.kod));
  const setler = Object.entries(K.setler).map(([kod, s]) => {
    const durum = s.iller.map((p) => ({ plaka: p, ad: ilAdiBul(p), var: iller.has(p) }));
    const sahip = durum.filter((x) => x.var).length;
    return { kod, ad: s.ad, ikon: s.ikon, iller: durum, sahip, toplam: s.iller.length, tamam: sahip === s.iller.length, odulAlindi: odullu.has(kod) };
  }).sort((a, b) => b.tamam - a.tamam || b.sahip - a.sahip);
  return { setler, hasatBonus: K.hasatBonus, odul: K.odul, tamam: setler.filter((s) => s.tamam).length };
}

function rotalar(app, { h, auth }) {
  app.get('/api/koleksiyon', auth.girisGerekli, h((req) => liste(req.kullanici.id)));
}

module.exports = { rotalar, liste, denetle, hasatBonusu };
