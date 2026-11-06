// Yaşayan nüfus (§7.7): gerçek oyuncusu olan ama nüfusu az mahallelerde boşluğu dolduran, açıkça "demo sakin" etiketli
// simüle vatandaşlar. Ayrı bir hile katmanı yoktur: oyuncularla AYNI işlevleri (parsel edinme, ekim, hasat, satış, borsa,
// bakım, seçim, meclis) aynı kurallar, aynı defter ve aynı sınırlarla çağırırlar. Kişilikleri kararlarını belirler.
// Mahallede gerçek oyuncu çoğaldığında parsellerini satışa çıkarıp taşınırlar; satılmayan parseller devlete döner.
const db = require('./db');
const L = require('./lib/ledger');
const { NUFUS, URUNLER, YAPILAR } = require('./config/rules');
const { yol } = require('./lib/olaylar');

const simdi = () => Date.now();
const rastgele = (a, b) => a + Math.random() * (b - a);
const sec = (dizi) => dizi[Math.floor(Math.random() * dizi.length)];
const sessiz = (fn) => { try { return fn(); } catch { return null; } };   // kural reddi (bakiye, süre…) normaldir: sakin başka şey dener

// ---------- Kişilikler
const KISILIKLER = {
  CIFTCI:    { unvan: 'Çiftçi', imar: ['TARIM'], urunler: ['BUGDAY', 'DOMATES'], yapilar: ['TEL_CIT', 'SULAMA_HATTI', 'AMBAR'], satis: 0.7, borsaci: false,
    ton: 'samimi, toprağa bağlı, az ve öz konuşan', meslek: 'CIFTCI' },
  BAHCIVAN:  { unvan: 'Bahçıvan', imar: ['TARIM'], urunler: ['ELMA', 'DOMATES'], yapilar: ['SERA', 'PEYZAJ', 'SULAMA_HATTI'], satis: 0.6, borsaci: false,
    ton: 'neşeli, çiçek ve fidan meraklısı', meslek: 'CIFTCI' },
  OGRETMEN:  { unvan: 'Emekli Öğretmen', imar: ['KONUT', 'TARIM'], urunler: ['ELMA', 'BUGDAY'], yapilar: ['EV', 'PEYZAJ', 'TEL_CIT'], satis: 0.5, borsaci: false,
    ton: 'bilge, nazik, mahalleye düşkün, öğüt vermeyi seven', meslek: 'MIMAR' },
  TUCCAR:    { unvan: 'Tüccar', imar: ['TICARET', 'KARMA', 'KONUT', 'TARIM'], urunler: ['DOMATES', 'BUGDAY'], yapilar: ['DUKKAN', 'TEL_CIT'], satis: 0.9, borsaci: true,
    ton: 'hesapçı, esprili, pazarlığı seven', meslek: 'TUCCAR' },
  GIRISIMCI: { unvan: 'Girişimci', imar: ['TARIM', 'KONUT', 'KARMA'], urunler: ['DOMATES', 'ELMA'], yapilar: ['GUNES_PANELI', 'SERA', 'DEGIRMEN'], satis: 0.8, borsaci: true,
    ton: 'enerjik, yeniliklere açık, biraz telaşlı', meslek: 'ZANAATKAR' },
  NINE:      { unvan: 'Nine', imar: ['TARIM', 'KONUT'], urunler: ['DOMATES', 'ELMA'], yapilar: ['TEL_CIT', 'PEYZAJ'], satis: 0.4, borsaci: false,
    ton: 'sevecen, "evladım" diye konuşan, eski günleri anlatan', meslek: 'CIFTCI' },
};
const ADLAR = ['Ayşe', 'Fatma', 'Emine', 'Hatice', 'Zeynep', 'Elif', 'Meryem', 'Şerife', 'Sultan', 'Hacer', 'Esra', 'Derya', 'Gül', 'Nihal', 'Selin', 'Songül',
  'Mehmet', 'Mustafa', 'Ahmet', 'Ali', 'Hüseyin', 'Hasan', 'İbrahim', 'İsmail', 'Osman', 'Yusuf', 'Murat', 'Ömer', 'Ramazan', 'Halil', 'Süleyman', 'Kemal',
  'Recep', 'Salih', 'Kadir', 'Burak', 'Emre', 'Deniz', 'Barış', 'Cemal', 'Nurettin', 'Şükrü', 'Yaşar', 'Nazmi'];
const kisilikSec = () => sec(['CIFTCI', 'CIFTCI', 'BAHCIVAN', 'OGRETMEN', 'TUCCAR', 'GIRISIMCI', 'NINE']);

// ---------- Mahalle durumu
function aktifMahalleler() {
  return db.prepare(`SELECT p.region_id AS id,
      COUNT(DISTINCT CASE WHEN u.is_npc = 0 AND u.status = 'ACTIVE' THEN u.id END) AS gercek,
      COUNT(DISTINCT CASE WHEN u.is_npc = 1 AND u.npc_kisilik IS NOT NULL AND u.npc_durum = 'AKTIF' THEN u.id END) AS demo
    FROM parcels p JOIN users u ON u.id = p.owner_user_id GROUP BY p.region_id HAVING gercek >= 1`).all();
}
const demoSayisi = () => db.prepare(`SELECT COUNT(*) c FROM users WHERE is_npc = 1 AND npc_kisilik IS NOT NULL AND npc_durum IN ('AKTIF', 'TASINIYOR')`).get().c;
const mahalleDemolari = (mahalleId) => db.prepare(`SELECT * FROM users WHERE is_npc = 1 AND npc_mahalle = ? AND npc_durum = 'AKTIF'`).all(mahalleId);

// ---------- Yerleşme: gerçek oyuncunun parseline yakın, aynı mahallede boş ve uygun bir hücre
async function yerlestir(mahalleId) {
  const { parselHazirla, hucreAra } = require('./harita/parsel');
  const oyun = require('./oyun');
  const merkez = db.prepare(`SELECT p.centroid_lon AS lon, p.centroid_lat AS lat FROM parcels p JOIN users u ON u.id = p.owner_user_id
                             WHERE p.region_id = ? AND u.is_npc = 0 ORDER BY RANDOM() LIMIT 1`).get(mahalleId);
  if (!merkez) return null;
  const kod = kisilikSec();
  const k = KISILIKLER[kod];
  const adaylar = await hucreAra(merkez.lon, merkez.lat, k.imar, 4, 2);
  for (const hucreId of adaylar) {
    const id = await parselHazirla(hucreId);   // deneme ilçesinde tarlanın kimliği
    const p = sessiz(() => oyun.parselGetir(id));
    if (!p || p.region_id !== mahalleId || p.owner_user_id) continue;
    const mevcut = new Set(mahalleDemolari(mahalleId).map((d) => d.display_name));
    let ad = `${k.unvan} ${sec(ADLAR)}`;
    for (let i = 0; i < 5 && mevcut.has(ad); i++) ad = `${k.unvan} ${sec(ADLAR)}`;
    const t = simdi();
    const uid = db.transaction(() => {
      const yeni = db.prepare(`INSERT INTO users (display_name, is_npc, npc_kisilik, npc_mahalle, npc_durum, npc_sonraki, meslek, ayarlar)
                               VALUES (?, 1, ?, ?, 'AKTIF', ?, ?, '{"sohbet":true}')`).run(ad, kod, mahalleId, t + rastgele(5_000, 60_000), k.meslek).lastInsertRowid;
      L.odul(yeni, NUFUS.baslangicBakiye, 'Demo sakin başlangıç bakiyesi');
      L.denetim({ aktor: yeni, eylem: 'DEMO_RESIDENT_ARRIVED', varlik: `MAHALLE:${mahalleId}`, bolge: mahalleId, herkese: true, sonra: { ad, unvan: k.unvan } });
      return yeni;
    })();
    if (!sessiz(() => oyun.parselEdin(uid, id))) {
      // Edinilemediyse (bakiye/limit/yarış) sakin yerleşmez
      db.prepare(`UPDATE users SET npc_durum = 'TASINDI' WHERE id = ?`).run(uid);
      continue;
    }
    return { id: uid, ad, parsel: id };
  }
  return null;
}

// ---------- Ekonomik eylem: bir demo sakinin bir "turu"
function eylem(n) {
  const oyun = require('./oyun');
  const k = KISILIKLER[n.npc_kisilik];
  if (!k) return;
  const t = simdi();
  const parseller = db.prepare(`SELECT id, zoning_type, region_id FROM parcels WHERE owner_user_id = ?`).all(n.id);
  const yapilanlar = [];
  for (const p of parseller) {
    const kart = sessiz(() => oyun.parselKarti(p.id, n.id, {}, { hafif: true }));
    if (!kart) continue;
    if (kart.tarimMi) {
      const e = kart.ekin;
      if (e && (e.olgun || e.tazelik === 'CURUDU')) { if (sessiz(() => oyun.hasat(n.id, p.id))) yapilanlar.push('hasat'); }
      else if (e && !e.otomatikSulama && e.sulama < e.gerekenSulama && !e.sonrakiSulamaMs) { if (sessiz(() => oyun.sula(n.id, p.id))) yapilanlar.push('sula'); }
      else if (!e) {
        const uygun = (kart.urunSecenekleri || []).filter((u) => u.uygun);
        const yoresel = uygun.find((u) => URUNLER[u.kod].bolgeler);   // bölgesinin ürününü sever
        const tercih = yoresel && Math.random() < 0.5 ? yoresel.kod : sec(k.urunler.filter((u) => uygun.some((x) => x.kod === u))) || uygun[0]?.kod;
        if (tercih && sessiz(() => oyun.ek(n.id, p.id, tercih))) yapilanlar.push(`ek:${tercih}`);
      }
    }
    // Bakım: sağlık yarının altına inen yapı
    if (kart.yapilar.some((y) => y.durum === 'ACTIVE' && y.saglik < 55)) { if (sessiz(() => oyun.bakimYap(n.id, p.id))) yapilanlar.push('bakim'); }
    // Yapı: bakiyesi rahatsa kişiliğine uygun bir geliştirme
    const bakiye = L.bakiye(n.id);
    if (bakiye > 260 && Math.random() < 0.25) {
      const secenek = (kart.insaatSecenekleri || []).filter((x) => x.uygun && k.yapilar.includes(x.tip) && x.maliyet < bakiye - 120);
      const y = sec(secenek);
      if (y && sessiz(() => oyun.insaatBaslat(n.id, p.id, y.tip))) yapilanlar.push(`insaat:${y.tip}`);
    }
  }
  // Satış: kişiliğin satış eğilimine göre; borsacı kişilik borsaya emir verir
  for (const i of L.envanter(n.id)) {
    if (i.miktar < 10 || Math.random() > k.satis) continue;
    const adet = Math.max(1, Math.floor(i.miktar * rastgele(0.4, 0.8)));
    if (k.borsaci && Math.random() < 0.6) {
      const fiyat = Math.round(URUNLER[i.item_id].tabanFiyat * rastgele(1.05, 1.3) * 100) / 100;
      if (sessiz(() => require('./ekonomi').emirVer(n.id, { urun: i.item_id, yon: 'SAT', fiyat, miktar: adet, gun: 3 }))) yapilanlar.push('borsa');
    } else if (sessiz(() => oyun.npcSat(n.id, i.item_id, adet))) yapilanlar.push('sat');
  }
  // Komşuluk: arada bir gerçek bir komşunun parselini ziyaret eder
  if (Math.random() < 0.12) {
    const komsu = db.prepare(`SELECT p.id FROM parcels p JOIN users u ON u.id = p.owner_user_id WHERE p.region_id = ? AND u.is_npc = 0 ORDER BY RANDOM() LIMIT 1`).get(n.npc_mahalle);
    if (komsu && sessiz(() => oyun.ziyaret(n.id, komsu.id))) yapilanlar.push('ziyaret');
  }
  db.prepare(`UPDATE users SET npc_sonraki = ? WHERE id = ?`).run(t + NUFUS.eylemAraligiMs * rastgele(0.6, 1.4), n.id);
  return yapilanlar;
}

// ---------- Taşınma: mahallede yeterince gerçek oyuncu olunca demo sakinler çekilir
function tasinma() {
  const pazar = require('./pazar');
  const oyun = require('./oyun');
  const t = simdi();
  for (const m of aktifMahalleler().filter((x) => x.gercek >= NUFUS.cekilmeEsigi && x.demo > 0)) {
    for (const n of mahalleDemolari(m.id)) {
      db.prepare(`UPDATE users SET npc_durum = 'TASINIYOR', npc_sonraki = ? WHERE id = ?`).run(t + NUFUS.tasinmaMs, n.id);
      for (const { id } of db.prepare(`SELECT id FROM parcels WHERE owner_user_id = ?`).all(n.id)) {
        const p = oyun.parselGetir(id);   // bedel hesabı mahalle çekiciliğini de ister
        const fiyat = Math.min(require('./config/rules').PAZAR.maxFiyat, Math.max(20, Math.round(oyun.parselDegeri(p).toplam * 1.1)));   // yapılarıyla bugünkü değeri
        sessiz(() => pazar.ilanAc(n.id, p.id, { fiyat, gun: 3, kosul: 'HERKES' }));
      }
      L.denetim({ aktor: n.id, eylem: 'DEMO_RESIDENT_LEAVING', varlik: `MAHALLE:${m.id}`, bolge: m.id, herkese: true, sonra: { ad: n.display_name } });
    }
  }
  // Süresi dolan ya da tüm parselleri satılan taşınanlar ayrılır; kalan parseller devlete döner
  for (const n of db.prepare(`SELECT * FROM users WHERE is_npc = 1 AND npc_durum = 'TASINIYOR'`).all()) {
    const kalan = db.prepare(`SELECT id FROM parcels WHERE owner_user_id = ?`).all(n.id);
    if (kalan.length && n.npc_sonraki > t) continue;
    db.transaction(() => {
      for (const i of db.prepare(`SELECT id FROM listings WHERE seller_id = ? AND status = 'ACTIVE'`).all(n.id)) sessiz(() => pazar.ilanIptal(n.id, i.id));
      for (const p of kalan) oyun.parseliBosalt(p.id);
      for (const e of db.prepare(`SELECT id FROM urun_emirleri WHERE user_id = ? AND durum = 'ACIK'`).all(n.id)) sessiz(() => require('./ekonomi').emirIptal(n.id, e.id));
      db.prepare(`UPDATE users SET npc_durum = 'TASINDI' WHERE id = ?`).run(n.id);
    })();
  }
}

// ---------- Sohbet: gerçek oyuncunun mahalle mesajına yanıt, arada bir kendiliğinden söz
const sonYanit = new Map(), sonKendiliginden = new Map();
const KALIP = [
  [/(selam|merhaba|günaydın|iyi akşam|hayırlı)/i, ['Aleyküm selam komşu, hoş geldin!', 'Merhaba! Tarlalar nasıl gidiyor?', 'Selam! Mahallemize renk kattın.']],
  [/(hasat|ekin|tarla|tohum|sula)/i, ['Ekini olgunlaşınca bekletme, tarlada bozuluyor.', 'Sulama hattı kurarsan sulamakla uğraşmazsın, bir de verim artar.', 'Bu mevsim ne eksen bereketli olsun.']],
  [/(arsa|parsel|tapu|ilan|değer|endeks)/i, ['Arsayı ucuzken al, mahalle gelişince değerlenir derler.', 'Ben tarlama yatırım yaptım, değeri epey arttı.', 'İlana koymadan önce mahalle endeksine bir bak.']],
  [/(hava|yağmur|kar|soğuk|sıcak)/i, null],
  [/(pazar|fiyat|sat|borsa|para|lira)/i, ['Borsada emir verirken tüccar fiyatına bir bak, aşağısına satma.', 'Pazarlık sünnettir derler, ilan fiyatına hemen razı olma!']],
  [/\?$/, ['Bilmem ki komşu, pazarda soran olur.', 'Güzel soru! Köy › Haberler bölümünde mahallede olanlar yazıyor.', 'Bence denemek lazım, en kötü tecrübe olur.']],
];
function kalipYanit(metin, mahalleId) {
  for (const [re, yanitlar] of KALIP) {
    if (!re.test(metin)) continue;
    if (!yanitlar) {
      const plaka = db.prepare(`SELECT rl.plaka FROM regions r JOIN regions ri ON ri.id = r.parent_id JOIN regions rl ON rl.id = ri.parent_id WHERE r.id = ?`).get(mahalleId)?.plaka;
      const h = require('./dunya').ilHavasi(plaka);
      return h ? `Bugün hava ${h.durum.toLocaleLowerCase('tr-TR')}, ${h.sicaklik} derece. ${h.yagis ? 'Yağmur tarlaları suluyor, ne güzel.' : 'Sulamayı ihmal etmeyin.'}` : 'Havayı bilmem ama içimiz sıcak!';
    }
    return sec(yanitlar);
  }
  return sec(['Haklısın komşu.', 'Ne güzel söyledin.', 'Öyle öyle, mahallede hayat devam ediyor.', 'Bir çay içelim de konuşalım.']);
}
async function sohbetYanitla(kanal, mesaj) {
  const m = /^mahalle:(\d+)$/.exec(kanal);
  if (!m || !NUFUS.etkin) return;
  const mahalleId = Number(m[1]);
  const t = simdi();
  if ((sonYanit.get(mahalleId) || 0) + NUFUS.sohbetYanitAraligiMs > t) return;
  const gonderen = db.prepare(`SELECT is_npc FROM users WHERE id = ?`).get(mesaj.userId);
  if (!gonderen || gonderen.is_npc) return;
  const demolar = mahalleDemolari(mahalleId);
  if (!demolar.length) return;
  sonYanit.set(mahalleId, t);
  const n = sec(demolar);
  const k = KISILIKLER[n.npc_kisilik];
  await new Promise((r) => setTimeout(r, rastgele(...NUFUS.sohbetYanitMs)));
  const mahalleAd = db.prepare(`SELECT name FROM regions WHERE id = ?`).get(mahalleId)?.name;
  const yz = await require('./yz').npcYanit({ ad: n.display_name, unvan: k.unvan, ton: k.ton, mahalle: mahalleAd, mesaj: mesaj.metin }).catch(() => null);
  sessizAsync(() => require('./sohbet').npcYaz(n.id, kanal, yz || kalipYanit(mesaj.metin, mahalleId)));
}
const sessizAsync = (fn) => { try { fn(); } catch { /* yok say */ } };
function kendiliginden() {
  const t = simdi();
  for (const m of aktifMahalleler().filter((x) => x.demo > 0)) {
    if ((sonKendiliginden.get(m.id) || 0) + NUFUS.sohbetKendiliginden > t) continue;
    if (!sonKendiliginden.has(m.id)) { sonKendiliginden.set(m.id, t - NUFUS.sohbetKendiliginden * Math.random()); continue; }   // hepsi aynı anda konuşmasın
    sonKendiliginden.set(m.id, t);
    const n = sec(mahalleDemolari(m.id));
    if (!n) continue;
    const metin = sec(['Bugün hasat bereketliydi, şükür.', 'Komşular, akşam çay benden.', 'Pazarda domates fiyatları iyi bu ara.', 'Tarlaya yeni çit çektim, gelin görün.', kalipYanit('hava', m.id)]);
    sessizAsync(() => require('./sohbet').npcYaz(n.id, `mahalle:${m.id}`, metin));
  }
}

// ---------- Döngü
let calisiyor = false;
async function nufusDongusu({ yerlestirmeSiniri = 2 } = {}) {
  if (!NUFUS.etkin || calisiyor) return { atlandi: true };
  calisiyor = true;
  const rapor = { yerlesen: 0, eylem: 0 };
  try {
    sessiz(tasinma);
    // Yerleştirme: en çok ihtiyacı olan mahalleler önce
    let kota = Math.min(yerlestirmeSiniri, NUFUS.maxToplam - demoSayisi());
    const ihtiyac = aktifMahalleler().filter((m) => m.gercek < NUFUS.cekilmeEsigi && m.gercek + m.demo < NUFUS.mahalleHedef)
      .sort((a, b) => (a.gercek + a.demo) - (b.gercek + b.demo));
    for (const m of ihtiyac) {
      let eksik = NUFUS.mahalleHedef - (m.gercek + m.demo);
      while (eksik > 0 && kota > 0) {
        const r = await yerlestir(m.id).catch(() => null);
        if (!r) break;   // uygun hücre bulunamadı: sonraki döngüde yeniden denenir
        rapor.yerlesen++; kota--; eksik--;
      }
      if (kota <= 0) break;
    }
    const t = simdi();
    for (const n of db.prepare(`SELECT * FROM users WHERE is_npc = 1 AND npc_durum = 'AKTIF' AND npc_kisilik IS NOT NULL AND (npc_sonraki IS NULL OR npc_sonraki <= ?)
                                ORDER BY npc_sonraki LIMIT ?`).all(t, NUFUS.turBasinaEylem)) {
      if (sessiz(() => eylem(n))) rapor.eylem++;
    }
    sessiz(kendiliginden);
  } finally { calisiyor = false; }
  return rapor;
}

let zamanlayici = null;
function baslat() {
  if (!NUFUS.etkin || zamanlayici) return;
  zamanlayici = setInterval(() => nufusDongusu().catch((e) => require('./lib/gunluk').gunluk.warn('nüfus döngüsü', { hata: e })), NUFUS.dongüMs);
  zamanlayici.unref();
  yol.on('sohbet', ({ kanal, mesaj }) => { sohbetYanitla(kanal, mesaj).catch(() => {}); });
}

function mahalleNufusu(mahalleId) {
  return mahalleDemolari(Number(mahalleId)).map((d) => ({ ad: d.display_name, unvan: KISILIKLER[d.npc_kisilik]?.unvan }));
}

module.exports = { baslat, nufusDongusu, yerlestir, eylem, tasinma, sohbetYanitla, kalipYanit, aktifMahalleler, mahalleNufusu, KISILIKLER };
