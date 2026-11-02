// Parsel birleştirme (tevhit): aynı sahibin, aynı mahalle ve imardaki yan yana kare parselleri tek parsel olur.
// Kayıtta katılan parsel 'BIRLESIK' durumuna geçer, sahipsiz görünür ve asıl parsele bağlanır (birlesik_id); hücresine
// yapılan her istek asıl parsele yönlenir (harita/parsel.js parselHazirla). Asıl parselin alanı toplam alandır: TAKS/KAKS,
// en az alan, verim ve arsa değeri buna göre hesaplanır. Katılan parselin yapıları, süsleri ve süren üretimi asıl parsele
// geçer; alış bedeli ve yatırımı asıl parselin maliyetine eklenir (portföy kâr/zararı bozulmasın).
// Parsel sınırı (HESAP.maxParsel) hücre sayısıyla sayılır (SUM(1 + uye_sayisi)): birleştirme sınırı aşmanın yolu değildir.
// Gerçek tarlalar (deneme ilçesi) birleştirilmez: zaten kendi sınırlarıyla tek parseldir.
const db = require('./db');
const L = require('./lib/ledger');
const I = require('./harita/izgara');
const { BIRLESTIRME, SUS_MAKS, IMAR } = require('./config/rules');
const { OyunHatasi } = L;
const oyun = () => require('./oyun');

// Hazır sorgular ilk kullanımda (süs ve kira tabloları kendi modüllerinde kurulur)
let hazirSorgular = null;
const sorgu = () => (hazirSorgular ??= {
  uyeler: db.prepare(`SELECT id, grid_x, grid_y, area_m2 FROM parcels WHERE birlesik_id = ? ORDER BY grid_y, grid_x`),
  hucrede: db.prepare(`SELECT p.id, p.birlesik_id, p.owner_user_id, p.geom_version, p.uye_sayisi FROM parcels p WHERE p.grid_x = ? AND p.grid_y = ?`),
  ilan: db.prepare(`SELECT 1 FROM listings WHERE parcel_id = ? AND status = 'ACTIVE'`),
  ekin: db.prepare(`SELECT 1 FROM crops WHERE parcel_id = ? AND status = 'GROWING'`),
  ortak: db.prepare(`SELECT 1 FROM ortaklar WHERE parcel_id = ? AND durum IN ('DAVET', 'AKTIF')`),
  susler: db.prepare(`SELECT id, yuva FROM parsel_susleri WHERE parcel_id = ? ORDER BY yuva`),
  sahiplik: db.prepare(`SELECT id, price, start_at FROM parcel_ownership WHERE parcel_id = ? AND user_id = ? AND end_at IS NULL ORDER BY id DESC LIMIT 1`),
});

// Parselin hücreleri: kendisi ve katılan parseller
const hucreler = (p) => [{ x: p.grid_x, y: p.grid_y }, ...(p.uye_sayisi ? sorgu().uyeler.all(p.id).map((u) => ({ x: u.grid_x, y: u.grid_y })) : [])];
const uyeler = (anaId) => sorgu().uyeler.all(anaId);
const DORT = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const bitisikMi = (liste, x, y) => liste.some((h) => DORT.some(([dx, dy]) => h.x + dx === x && h.y + dy === y));

// Birleşik parselin dış sınırı: hücre kümesinin kenarları zincirlenir (en çok 4 hücre, 4-bağlı: delik ya da tek köşede
// değen parça oluşmaz). Ara köşeler atılır; koordinatlar hucrePoligonu ile aynı yuvarlamada.
function geometri(liste) {
  const var_ = new Set(liste.map((h) => `${h.x},${h.y}`));
  const sonraki = new Map();
  for (const { x, y } of liste) {
    if (!var_.has(`${x},${y - 1}`)) sonraki.set(`${x},${y}`, [x + 1, y]);
    if (!var_.has(`${x + 1},${y}`)) sonraki.set(`${x + 1},${y}`, [x + 1, y + 1]);
    if (!var_.has(`${x},${y + 1}`)) sonraki.set(`${x + 1},${y + 1}`, [x, y + 1]);
    if (!var_.has(`${x - 1},${y}`)) sonraki.set(`${x},${y + 1}`, [x, y]);
  }
  const bas = sonraki.keys().next().value.split(',').map(Number);
  const halka = [bas];
  for (let k = sonraki.get(bas.join(',')); k && k.join(',') !== bas.join(',') && halka.length <= sonraki.size; k = sonraki.get(k.join(','))) halka.push(k);
  const sade = halka.filter((n, i) => {
    const a = halka[(i - 1 + halka.length) % halka.length], b = halka[(i + 1) % halka.length];
    return (n[0] - a[0]) * (b[1] - n[1]) !== (n[1] - a[1]) * (b[0] - n[0]);
  });
  const r = (v) => Math.round(v * 1e7) / 1e7;
  const koseler = sade.map(([x, y]) => [r(I.xLon(x)), r(I.yLat(y))]);
  return { type: 'Polygon', coordinates: [[...koseler, koseler[0]]] };
}

// ana parsele uye katılabilir mi? { uygun, sebep }
function uygunluk(userId, ana, uye) {
  const red = (sebep) => ({ uygun: false, sebep });
  if (ana.id === uye.id) return red('Parsel kendisiyle birleştirilemez');
  if (ana.owner_user_id !== userId || uye.owner_user_id !== userId) return red('İki parsel de senin olmalı');
  if (ana.status !== 'ACTIVE' || uye.status !== 'ACTIVE') return red('Parsel geçici olarak dondurulmuş');
  if (ana.geom_version !== 'z20-v1' || uye.geom_version !== 'z20-v1') return red('Gerçek tarlalar birleştirilemez; zaten kendi sınırlarıyla tek parseldir');
  if (uye.uye_sayisi) return red('Bu parsel zaten birleşik; onu açıp bu parseli ona kat');
  if (ana.zoning_type !== uye.zoning_type) return red(`İmarları farklı (${IMAR[ana.zoning_type].ad} / ${IMAR[uye.zoning_type].ad})`);
  if (ana.region_id !== uye.region_id) return red('Parseller aynı mahallede olmalı');
  if (!bitisikMi(hucreler(ana), uye.grid_x, uye.grid_y)) return red('Parseller yan yana olmalı (kenardan bitişik)');
  if (2 + ana.uye_sayisi > BIRLESTIRME.maksParca) return red(`Birleşik parsel en çok ${BIRLESTIRME.maksParca} parçadan oluşur`);
  for (const p of [ana, uye]) {
    if (sorgu().ilan.get(p.id)) return red('İlandaki parsel birleştirilemez; önce ilanı kaldır');
    if (require('./kira').acikKira(p.id)) return red('Kirada (ya da kira teklifinde) olan parsel birleştirilemez');
    if (sorgu().ortak.get(p.id)) return red('Ortaklığı olan parsel birleştirilemez');
    if (sorgu().ekin.get(p.id)) return red('Tarlada ekin var; önce hasat et');
  }
  // Tekil yapılar (sulama hattı, kümes…) iki parselde de varsa ikisi de taşınır: ikinci kopya birleşmeden önce de
  // üretiyordu, yeni bir kazanç doğmaz; aynı türden yenisi yine yapılamaz (oyun.insaatUygunluk)
  if (sorgu().susler.all(ana.id).length + sorgu().susler.all(uye.id).length > SUS_MAKS) return red(`Süsler ${SUS_MAKS} sınırını aşar; önce birkaç süsü kaldır`);
  if (L.bakiye(userId) < BIRLESTIRME.harc) return red('Bakiye yetersiz');
  return { uygun: true, sebep: null };
}

// Parsel kartı (sahibine): birleşik parçalar ve kenardan bitişik kendi parselleri (birleştirilebilir mi, neden değil)
function kartBilgisi(ana, userId) {
  if (ana.geom_version !== 'z20-v1') return null;
  const liste = hucreler(ana), goruldu = new Set();
  const adaylar = [];
  for (const h of liste) {
    for (const [dx, dy] of DORT) {
      const x = h.x + dx, y = h.y + dy;
      if (liste.some((c) => c.x === x && c.y === y)) continue;
      const r = sorgu().hucrede.get(x, y);
      if (!r || goruldu.has(r.id)) continue;
      goruldu.add(r.id);
      if (r.birlesik_id || r.owner_user_id !== userId) continue;
      const p = oyun().parselGetir(r.id);
      adaylar.push({ id: p.id, adaParsel: require('./harita/ada').adaParsel(p.grid_x, p.grid_y), alan: p.area_m2,
        dx: p.grid_x - ana.grid_x, dy: p.grid_y - ana.grid_y, ...uygunluk(userId, ana, p) });
    }
  }
  return {
    parca: 1 + ana.uye_sayisi, maksParca: BIRLESTIRME.maksParca, harc: BIRLESTIRME.harc,
    uyeler: uyeler(ana.id).map((u) => ({ id: u.id, alan: u.area_m2, adaParsel: require('./harita/ada').adaParsel(u.grid_x, u.grid_y) })),
    adaylar,
  };
}

const birlestir = db.transaction((userId, anaId, uyeId) => {
  const O = oyun();
  O.bekleyenleriIsle();
  const ana = O.parselGetir(anaId), uye = O.parselGetir(uyeId);
  const u = uygunluk(userId, ana, uye);
  if (!u.uygun) throw new OyunHatasi(409, u.sebep, 'BIRLESTIRILEMEZ');
  L.harca(userId, BIRLESTIRME.harc, `Parsel birleştirme harcı (${ana.id})`);
  // Yapılar (ve süren üretimleri), süsler asıl parsele geçer; süsler boş yuvalara dizilir
  db.prepare(`UPDATE structures SET parcel_id = ? WHERE parcel_id = ?`).run(ana.id, uye.id);
  db.prepare(`UPDATE uretimler SET parcel_id = ? WHERE parcel_id = ? AND durum = 'URETIMDE'`).run(ana.id, uye.id);
  const dolu = new Set(sorgu().susler.all(ana.id).map((s) => s.yuva));
  for (const s of sorgu().susler.all(uye.id)) {
    let yuva = 0;
    while (dolu.has(yuva)) yuva++;
    dolu.add(yuva);
    db.prepare(`UPDATE parsel_susleri SET parcel_id = ?, yuva = ? WHERE id = ?`).run(ana.id, yuva, s.id);
  }
  // Maliyet: katılan parselin alışı ve o sahiplikteki yatırımı + harç, asıl parselin alış bedeline eklenir
  const so = sorgu().sahiplik.get(uye.id, userId);
  const yatirim = so ? require('./piyasa').yatirimVeGelir(userId, uye.id, so.start_at).yatirim : 0;
  const ekMaliyet = Math.round((so?.price || 0) + yatirim + BIRLESTIRME.harc);
  db.prepare(`UPDATE parcel_ownership SET price = COALESCE(price, 0) + ? WHERE id = ?`).run(ekMaliyet, sorgu().sahiplik.get(ana.id, userId)?.id ?? -1);
  db.prepare(`UPDATE parcel_ownership SET end_at = datetime('now') WHERE parcel_id = ? AND end_at IS NULL`).run(uye.id);
  db.prepare(`UPDATE parcels SET owner_user_id = NULL, acquired_at = NULL, status = 'BIRLESIK', birlesik_id = ?, version = version + 1 WHERE id = ?`).run(ana.id, uye.id);
  db.prepare(`UPDATE parcels SET area_m2 = area_m2 + ?, uye_sayisi = uye_sayisi + 1, version = version + 1 WHERE id = ?`).run(uye.area_m2, ana.id);
  const alan = ana.area_m2 + uye.area_m2;
  L.denetim({ aktor: userId, eylem: 'PARCELS_MERGED', varlik: ana.id, once: { alan: ana.area_m2 }, sonra: { uye: uye.id, alan, harc: BIRLESTIRME.harc }, bolge: ana.region_id });
  return { tamam: true, id: ana.id, alan, parca: 2 + ana.uye_sayisi, harc: BIRLESTIRME.harc };
});

// Birleşimi çöz (parsel devlete dönerken, oyun.parseliBosalt): katılan parseller kendi alanlarıyla sahipsiz parsele döner
function coz(anaId) {
  const liste = uyeler(anaId);
  if (!liste.length) return;
  db.prepare(`UPDATE parcels SET status = 'ACTIVE', birlesik_id = NULL, version = version + 1 WHERE birlesik_id = ?`).run(anaId);
  db.prepare(`UPDATE parcels SET area_m2 = area_m2 - ?, uye_sayisi = 0, version = version + 1 WHERE id = ?`).run(liste.reduce((t, u) => t + u.area_m2, 0), anaId);
}

function rotalar(app, { auth, hazir }) {
  // :id asıl parsel (parselHazirla birleşik hücreyi asıl parsele yönlendirir); gövdede katılacak parsel (onun da herhangi bir hücresi)
  app.post('/api/parsel/:id/birlestir', auth.dogrulanmisGerekli, hazir(async (req) => {
    const uyeId = await require('./harita/parsel').parselHazirla(typeof req.body?.uye === 'string' ? req.body.uye : '');
    if (uyeId === req.params.id) throw new OyunHatasi(409, 'Bu hücre zaten bu parselin parçası', 'BIRLESIK');
    return birlestir(req.kullanici.id, req.params.id, uyeId);
  }));
}

module.exports = { rotalar, birlestir, uygunluk, kartBilgisi, geometri, hucreler, uyeler, coz };
