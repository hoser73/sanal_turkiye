#!/usr/bin/env node
// Ekonomi simülasyonu: bot oyuncular geçici bir veritabanında N oyun günü oynar; saat yapay olarak ilerletilir.
// Gerçek veritabanına dokunmaz. Rapor: profil başına günlük gelir/gider kalemleri, bakiye, seviye, parsel, ilk yapı günleri.
// Kullanım: node scripts/ekonomi-sim.js [gün=30] [--seyrek]   (--seyrek: tüccarın ortak limiti dolmamış, az oyunculu sunucu)
const fs = require('fs');
const os = require('os');
const path = require('path');

const GUN = Number(process.argv[2]) || 30;
const SEYREK = process.argv.includes('--seyrek');
const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'st-ekosim-'));
Object.assign(process.env, {
  VERI_DIZINI: dizin, KARO_KAYNAGI: 'sahte', HAVA_KAYNAGI: 'sahte', SESSIZ: '1', GUNLUK_SESSIZ: '1', OTOMATIK_DOGRULA: '1',
  KIMLIK_HIZ_CARPANI: '1000', API_HIZ_SINIRI: '1000000', AGIR_HIZ_SINIRI: '1000000', BAKIM_ARALIGI_MS: '0', ONBELLEK: 'kapali',
  HATIRLATMA: 'kapali', YAPAY_ZEKA: 'kapali', SIYASET: 'kapali',
});

// Yapay saat: pazartesi 06.00 (Türkiye) başlar
let SAAT = Date.parse('2026-11-02T06:00:00+03:00');
Date.now = () => SAAT;

const app = require('../server/index');
const db = require('../server/db');
const L = require('../server/lib/ledger');
const oyun = require('../server/oyun');
const ciftlik = require('../server/ciftlik');
const gelisim = require('../server/gelisim');
const sandik = require('../server/sandik');
const bulmaca = require('../server/bulmaca');
const yol = require('../server/mevsim-yolu');
const sihirbaz = require('../server/sihirbaz');
const uretim = require('../server/uretim');
const { hucreAra, parselHazirla } = require('../server/harita/parsel');
const { URUNLER, YAPILAR, HAYVANLAR, HESAP, NPC_PAZAR, RECETELER } = require('../server/config/rules');

const PROFILLER = {
  aktif:    { oturumlar: [8, 11, 14, 17, 20, 23], dk: 20, bulmaca: 3, adet: 3 },
  gundelik: { oturumlar: [9, 21], dk: 12, bulmaca: 2, adet: 3 },
  haftalik: { oturumlar: [20], dk: 15, bulmaca: 1, adet: 2, gunler: [0, 3, 6] },   // pazar, çarşamba, cumartesi
};
// Yapı öncelik sırası (tarla başına tekil); seviye ve bakiye yetince kurulur
const YAPI_SIRASI = ['SULAMA_HATTI', 'KUMES', 'BAG_EVI', 'DEGIRMEN', 'INEK_AHIRI', 'ARI_KOVANI', 'AMBAR', 'SERA', 'SU_DEPOSU'];

const hata = {};
const dene = (ad, fn) => { try { return fn(); } catch (e) { const k = `${ad}: ${e.message}`.slice(0, 90); hata[k] = (hata[k] || 0) + 1; return null; } };
const tr = (t) => new Date(t + 3 * 3600_000);

async function kaydol(c, ad) {
  const r = await fetch(c.taban + '/api/kayit', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${ad}@sim.test`, sifre: 'parola123', ad, dogumYili: 1990, kosullarOnay: true, kvkkOnay: true }) });
  c.cerez = (r.headers.get('set-cookie') || '').split(';')[0];
  const ben = await (await fetch(c.taban + '/api/ben', { headers: { cookie: c.cerez } })).json();
  c.id = ben.kullanici.id;
  const t = await (await fetch(c.taban + '/api/baslangic/tarla', { method: 'POST', headers: { cookie: c.cerez, 'content-type': 'application/json' }, body: '{}' })).json();
  if (!t.parsel && !t.id) throw new Error('başlangıç tarlası yok: ' + JSON.stringify(t));
}

const parseller = (id) => db.prepare(`SELECT p.*, r.code il_kod FROM parcels p JOIN regions r ON r.id = p.il_id WHERE p.owner_user_id = ?`).all(id);
const yapilar = (pid) => db.prepare(`SELECT * FROM structures WHERE parcel_id = ?`).all(pid);
const envanter = (id) => Object.fromEntries(L.envanter(id).map((i) => [i.item_id, i.miktar]));

function ekinSec(c, p) {
  const plaka = p.il_kod.slice(3);
  const env = envanter(c.id);
  const uygun = Object.entries(URUNLER).filter(([, u]) => !u.mamul && (!u.bolgeler || u.bolgeler.includes(plaka)));
  // En az stoklu ürün (tüccar ürün başına sınırlı alır; çeşit gelir getirir)
  uygun.sort((a, b) => (env[a[0]] || 0) - (env[b[0]] || 0) || b[1].tabanFiyat - a[1].tabanFiyat);
  return uygun[0][0];
}

function tik(c) {
  const id = c.id;
  for (const p of parseller(id)) {
    if (p.zoning_type !== 'TARIM') continue;
    const e = db.prepare(`SELECT * FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(p.id);
    if (e && SAAT >= e.ready_at) dene('hasat', () => oyun.hasat(id, p.id));
    else if (e) {
      const u = URUNLER[e.crop_type];
      const hat = yapilar(p.id).some((y) => y.type === 'SULAMA_HATTI' && y.status === 'ACTIVE');
      if (!hat && e.waterings < u.sulama && (!e.last_watered_at || SAAT - e.last_watered_at > 31_000)) dene('sula', () => oyun.sula(id, p.id));
    }
    if (!db.prepare(`SELECT 1 FROM crops WHERE parcel_id = ? AND status = 'GROWING'`).get(p.id)) {
      const urun = ekinSec(c, p);
      // Akıllı oyuncu: deposu dolu ürünü ekmez (tüccar ve siparişler eritemiyor)
      if ((envanter(id)[urun] || 0) < 150 && L.bakiye(id) > URUNLER[urun].tohum * oyun.verimKati(p) + 20) dene('ek', () => oyun.ek(id, p.id, urun));
    }
    for (const s of yapilar(p.id)) {
      if (s.status !== 'ACTIVE') continue;
      if (HAYVANLAR[s.type]) {
        const d = ciftlik.hayvanDurumu(s, SAAT);
        if (d?.durum === 'HAZIR') dene('topla', () => ciftlik.topla(id, s.id));
        else if (d?.durum === 'AC' && L.bakiye(id) > 30 && (envanter(id)[HAYVANLAR[s.type].urun] || 0) < 150) dene('besle', () => ciftlik.besle(id, s.id));
      }
    }
  }
  // Üretim: değirmende buğday → un
  for (const p of parseller(id)) {
    const tip = new Set(yapilar(p.id).filter((s) => s.status === 'ACTIVE').map((s) => s.type));
    if (tip.has('DEGIRMEN') && (envanter(id).BUGDAY || 0) >= 40) dene('üretim', () => uretim.uretimBaslat(id, p.id, { recete: 'UN' }));
  }
  for (const r of db.prepare(`SELECT id FROM uretimler WHERE user_id = ? AND durum = 'URETIMDE' AND bitis <= ?`).all(id, SAAT)) dene('üretimTopla', () => uretim.uretimTopla(id, r.id));
}

function oturumSonu(c, prof) {
  const id = c.id;
  // Siparişler
  for (const s of ciftlik.siparisler(id).liste) if (s.hazir) dene('sipariş', () => ciftlik.siparisTeslim(id, s.id));
  // Tüccara sat: sipariş için her üründen 40 tut
  const env = envanter(id);
  for (const [kod, m] of Object.entries(env)) {
    const u = URUNLER[kod];
    if (!u || u.dukkan || kod === 'YEM' || kod === 'GUBRE') continue;
    const fazla = Math.floor(m - 40);
    if (fazla >= 1) dene('sat', () => oyun.npcSat(id, kod, Math.min(fazla, 10000)));
  }
  // Günlük şeyler
  dene('günlük', () => ciftlik.gunlukAl(id));
  dene('seviyeÖdül', () => ciftlik.seviyeOdulAl(id));
  dene('sandık', () => sandik.ac(id));
  dene('günlükGörev', () => gelisim.gunlukOdulAl(id));
  dene('yol', () => yol.odulAl(id));
  // Kira, bakım
  for (const p of parseller(id)) for (const s of yapilar(p.id)) {
    if (YAPILAR[s.type]?.gelir && s.status === 'ACTIVE') dene('kira', () => gelisim.kiraTopla(id, s.id));
  }
  for (const p of parseller(id)) if (yapilar(p.id).some((s) => s.status === 'ACTIVE' && oyun.saglik(s, SAAT) < 60)) dene('bakım', () => oyun.bakimYap(id, p.id));
  // Bulmaca: %80 kazanır
  for (let i = 0; i < prof.bulmaca; i++) {
    const b = dene('bulmacaBaşla', () => bulmaca.basla(id));
    if (!b) break;
    const hamle = Math.max(1, Math.round(b.bolum.hamle * 0.7));
    SAAT += 12_000 + hamle * 450 + 60_000;
    dene('bulmacaBitir', () => bulmaca.bitir(id, { oyunId: b.oyunId, kazandi: Math.random() < 0.8, hamle }));
  }
  yatirim(c);
}

function yatirim(c) {
  const id = c.id, sv = ciftlik.oyuncuSeviyesi(id);
  // Yapı: ilk uygun yapı (tarla başına tekil); bakiyenin 100 akçe üstünde kalacak kadar
  for (const p of parseller(id)) {
    if (p.zoning_type !== 'TARIM') continue;
    const var_ = new Set(yapilar(p.id).map((s) => s.type));
    for (const tip of YAPI_SIRASI) {
      const y = YAPILAR[tip];
      if (var_.has(tip) || (y.minSeviye || 1) > sv) continue;
      const u = oyun.insaatUygunluk(p, tip, yapilar(p.id));
      if (!u.uygun) continue;
      if (L.bakiye(id) - y.maliyet < 100) return;   // sıradakini biriktir
      if (dene('inşaat', () => oyun.insaatBaslat(id, p.id, tip))) { c.ilkler[tip] ??= c.gun; return; }
    }
  }
  // Köy meydanı binaları (seviyesi gelince, malzemesi varsa)
  const meydan = require('../server/koy-meydani');
  for (const b of dene('meydan', () => meydan.liste(id))?.binalar || []) {
    if (b.durum === 'YOK' && !b.eksik.length && L.bakiye(id) - b.akce > 200) dene('meydanİnşa', () => meydan.insaEt(id, b.kod));
  }
  // Tarlalar dolunca yapı yükseltme (500 akçe yedek kalır)
  if (parseller(id).length >= HESAP.maxParsel) {
    for (const p of parseller(id)) for (const s of yapilar(p.id)) {
      const b = gelisim.yukseltmeBedeli(s);
      if (s.status === 'ACTIVE' && b && L.bakiye(id) - b > 500) dene('yükselt', () => gelisim.yukselt(id, s.id));
    }
    return;
  }
  // Yeni tarla: tahsis bedelinin 1,3 katı birikince
  c.aday ??= null;
  if (!c.aday) return;   // aday async aranır (gün başında)
  const p = dene('adayGetir', () => oyun.parselGetir(c.aday));
  if (!p || p.owner_user_id) { c.aday = null; return; }
  const bedel = oyun.tahsisFiyati(p);
  if (L.bakiye(id) > bedel * 1.3 + 50 && dene('parselEdin', () => oyun.parselEdin(id, c.aday))) {
    c.ilkler[`PARSEL_${parseller(id).length}`] ??= c.gun; c.aday = null;
  }
}

async function adayBul(c) {
  if (c.aday || parseller(c.id).length >= HESAP.maxParsel) return;
  const ev = parseller(c.id)[0];
  const [lon, lat] = [ev.centroid_lon, ev.centroid_lat];
  if (lon == null) return;
  const ids = await hucreAra(lon, lat, ['TARIM'], 12, 2, 40);
  for (const h of ids) {
    const pid = await parselHazirla(h);
    const p = oyun.parselGetir(pid);
    if (p.owner_user_id || p.area_m2 > 1200) continue;
    if (db.prepare('SELECT COUNT(*) c FROM parcels WHERE owner_user_id = ? AND region_id = ?').get(c.id, p.region_id).c >= HESAP.maxParselMahalle) continue;
    c.aday = pid; return;
  }
}

// Kalabalık sunucu: tüccarın ortak günlük limiti başka oyuncularca dolmuş sayılır (yalnızca kişisel taban kalır)
function kalabalikPazar() {
  const gun = new Date(SAAT + 3 * 3600_000).toISOString().slice(0, 10);
  for (const kod of Object.keys(URUNLER)) {
    db.prepare(`INSERT INTO npc_demand (day, item_id, sold) VALUES (?, ?, ?) ON CONFLICT(day, item_id) DO UPDATE SET sold = MAX(sold, excluded.sold)`).run(gun, kod, NPC_PAZAR.gunlukTalep);
  }
}

// Gelir/gider kalemi: sebep metnindeki kimlik ve sayıları at
function kalem(sebep) {
  return sebep.replace(/\(.*?\)/g, '').replace(/TR-[\w-]+/g, '').replace(/:.*$/, '').replace(/\d+\.?/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^(.*) satışı$/, 'Tüccara satış').replace(/ kira geliri$/, ' kira').replace(/^İnşaat.*/, 'İnşaat').replace(/^Tohum.*/, 'Tohum');
}

(async () => {
  await app.hazir;
  const sunucu = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const taban = `http://127.0.0.1:${sunucu.address().port}`;
  const botlar = [];
  for (const [pad, prof] of Object.entries(PROFILLER)) {
    for (let i = 0; i < prof.adet; i++) {
      const c = { taban, profil: pad, ilkler: {}, gun: 0, gunluk: [] };
      await kaydol(c, `${pad}${i}`);
      sihirbaz.bitir(c.id);   // tur yerine görev ödülleri (toplam akçe yakın)
      botlar.push(c);
    }
  }
  const baslangic = SAAT;
  for (let g = 1; g <= GUN; g++) {
    const gunBas = baslangic + (g - 1) * 86_400_000;
    const haftaGunu = tr(gunBas).getUTCDay();
    const ledgerBas = db.prepare('SELECT COALESCE(MAX(id),0) m FROM wallet_ledger').get().m;
    // Oturumları saat sırasına diz
    const oturumlar = [];
    for (const c of botlar) {
      c.gun = g;
      const prof = PROFILLER[c.profil];
      if (prof.gunler && !prof.gunler.includes(haftaGunu)) continue;
      for (const s of prof.oturumlar) oturumlar.push({ c, prof, bas: gunBas + (s - 6) * 3600_000 + Math.floor(Math.random() * 20) * 60_000 });
    }
    oturumlar.sort((a, b) => a.bas - b.bas);
    if (!SEYREK) { SAAT = gunBas; kalabalikPazar(); }
    for (const c of botlar) await adayBul(c);
    for (const o of oturumlar) {
      SAAT = Math.max(SAAT, o.bas);
      if (!SEYREK) kalabalikPazar();
      dene('bekleyen', () => oyun.bekleyenleriIsle());
      const son = SAAT + o.prof.dk * 60_000;
      while (SAAT < son) { tik(o.c); SAAT += 30_000; dene('bekleyen', () => oyun.bekleyenleriIsle()); }
      oturumSonu(o.c, o.prof);
    }
    SAAT = gunBas + 86_400_000;
    dene('yarış', () => require('../server/hasat-yarisi').yarisBakim());
    dene('ihale', () => require('../server/ihale').ihaleBakim());
    // Günün defteri
    const satirlar = db.prepare(`SELECT user_id, reason, credit - debit net FROM wallet_ledger WHERE id > ? AND user_id IS NOT NULL AND account LIKE 'U:%'`).all(ledgerBas);
    for (const c of botlar) {
      const k = {};
      for (const s of satirlar) if (s.user_id === c.id) { const a = kalem(s.reason); k[a] = (k[a] || 0) + s.net; }
      c.gunluk.push({ gun: g, bakiye: L.bakiye(c.id), seviye: ciftlik.oyuncuSeviyesi(c.id), parsel: parseller(c.id).length, kalem: k,
        yapi: parseller(c.id).reduce((a, p) => a + yapilar(p.id).length, 0) });
    }
  }
  sunucu.close();

  // Rapor
  const r1 = (x) => Math.round(x);
  const satirlar = [];
  for (const pad of Object.keys(PROFILLER)) {
    const grup = botlar.filter((c) => c.profil === pad);
    const ort = (f) => grup.reduce((a, c) => a + f(c), 0) / grup.length;
    satirlar.push(`\n## ${pad} (${grup.length} bot, ${PROFILLER[pad].oturumlar.length} oturum/gün${PROFILLER[pad].gunler ? ', haftada 3 gün' : ''})`);
    for (const g of [1, 2, 3, 7, 14, 21, 30].filter((x) => x <= GUN)) {
      const d = (c) => c.gunluk[g - 1];
      const gelir = ort((c) => Object.values(d(c).kalem).filter((v) => v > 0).reduce((a, v) => a + v, 0));
      const gider = ort((c) => Object.values(d(c).kalem).filter((v) => v < 0).reduce((a, v) => a + v, 0));
      satirlar.push(`gün ${String(g).padStart(2)}: bakiye ${r1(ort((c) => d(c).bakiye))}  seviye ${ort((c) => d(c).seviye).toFixed(1)}  parsel ${ort((c) => d(c).parsel).toFixed(1)}  yapı ${ort((c) => d(c).yapi).toFixed(1)}  gelir +${r1(gelir)}  gider ${r1(gider)}`);
    }
    // Son 7 gün ortalama kalemler
    const son = Math.min(7, GUN), toplam = {};
    for (const c of grup) for (const d of c.gunluk.slice(-son)) for (const [k, v] of Object.entries(d.kalem)) toplam[k] = (toplam[k] || 0) + v / son / grup.length;
    const sirali = Object.entries(toplam).sort((a, b) => b[1] - a[1]);
    satirlar.push(`son ${son} gün ortalaması (günlük):`);
    satirlar.push('  gelir: ' + sirali.filter(([, v]) => v > 0.5).map(([k, v]) => `${k} ${r1(v)}`).join(' · '));
    satirlar.push('  gider: ' + sirali.filter(([, v]) => v < -0.5).reverse().map(([k, v]) => `${k} ${r1(v)}`).join(' · '));
    const ilk = {};
    for (const c of grup) for (const [k, v] of Object.entries(c.ilkler)) (ilk[k] ||= []).push(v);
    satirlar.push('  ilk kurulum günü: ' + Object.entries(ilk).map(([k, v]) => `${k} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)} (${v.length}/${grup.length})`).join(' · '));
  }
  console.log(`# Ekonomi simülasyonu — ${GUN} gün, ${SEYREK ? 'seyrek sunucu' : 'kalabalık sunucu (tüccar ortak limiti dolu)'}`);
  console.log(satirlar.join('\n'));
  const h = Object.entries(hata).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (h.length) console.log('\n## Bot engelleri (en sık)\n' + h.map(([k, v]) => `${v}× ${k}`).join('\n'));
  fs.rmSync(dizin, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error(e); fs.rmSync(dizin, { recursive: true, force: true }); process.exit(1); });
