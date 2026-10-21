// Yaşayan nüfus (§7.7): gerçek oyuncusu olan ama nüfusu az mahallelerde boşluğu dolduran, açıkça "demo sakin" etiketli
// simüle vatandaşlar. Ayrı bir hile katmanı yoktur: oyuncularla AYNI işlevleri (parsel edinme, ekim, hasat, satış, borsa,
// bakım, seçim, meclis) aynı kurallar, aynı defter ve aynı sınırlarla çağırırlar. Kişilikleri kararlarını belirler.
// Mahallede gerçek oyuncu çoğaldığında parsellerini satışa çıkarıp taşınırlar; satılmayan parseller devlete döner.
const db = require('./db');
const L = require('./lib/ledger');
const { NUFUS, URUNLER, YAPILAR, SECIM, BELEDIYE } = require('./config/rules');
const { yol } = require('./lib/olaylar');

const simdi = () => Date.now();
const rastgele = (a, b) => a + Math.random() * (b - a);
const sec = (dizi) => dizi[Math.floor(Math.random() * dizi.length)];
const sessiz = (fn) => { try { return fn(); } catch { return null; } };   // kural reddi (bakiye, süre…) normaldir: sakin başka şey dener

// ---------- Kişilikler
const KISILIKLER = {
  CIFTCI:    { unvan: 'Çiftçi', imar: ['TARIM'], urunler: ['BUGDAY', 'DOMATES'], yapilar: ['TEL_CIT', 'SULAMA_HATTI', 'AMBAR'], siyaset: 0.3, satis: 0.7, borsaci: false,
    ton: 'samimi, toprağa bağlı, az ve öz konuşan', meslek: 'CIFTCI' },
  BAHCIVAN:  { unvan: 'Bahçıvan', imar: ['TARIM'], urunler: ['ELMA', 'DOMATES'], yapilar: ['SERA', 'PEYZAJ', 'SULAMA_HATTI'], siyaset: 0.2, satis: 0.6, borsaci: false,
    ton: 'neşeli, çiçek ve fidan meraklısı', meslek: 'CIFTCI' },
  OGRETMEN:  { unvan: 'Emekli Öğretmen', imar: ['KONUT', 'TARIM'], urunler: ['ELMA', 'BUGDAY'], yapilar: ['EV', 'PEYZAJ', 'TEL_CIT'], siyaset: 0.9, satis: 0.5, borsaci: false,
    ton: 'bilge, nazik, mahalleye düşkün, öğüt vermeyi seven', meslek: 'MIMAR' },
  TUCCAR:    { unvan: 'Tüccar', imar: ['TICARET', 'KARMA', 'KONUT', 'TARIM'], urunler: ['DOMATES', 'BUGDAY'], yapilar: ['DUKKAN', 'TEL_CIT'], siyaset: 0.5, satis: 0.9, borsaci: true,
    ton: 'hesapçı, esprili, pazarlığı seven', meslek: 'TUCCAR' },
  GIRISIMCI: { unvan: 'Girişimci', imar: ['TARIM', 'KONUT', 'KARMA'], urunler: ['DOMATES', 'ELMA'], yapilar: ['GUNES_PANELI', 'SERA', 'DEGIRMEN'], siyaset: 0.6, satis: 0.8, borsaci: true,
    ton: 'enerjik, yeniliklere açık, biraz telaşlı', meslek: 'ZANAATKAR' },
  NINE:      { unvan: 'Nine', imar: ['TARIM', 'KONUT'], urunler: ['DOMATES', 'ELMA'], yapilar: ['TEL_CIT', 'PEYZAJ'], siyaset: 0.4, satis: 0.4, borsaci: false,
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
  for (const id of adaylar) {
    await parselHazirla(id);
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
    const kart = sessiz(() => oyun.parselKarti(p.id, n.id));
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

// ---------- Siyaset (yalnızca doldurma kipinde: secim.adayUygunlugu bunu ayrıca denetler)
const VAATLER = ['Mahalleye sulama kanalı', 'Pazar yerine gölgelik', 'Yollara bakım', 'Çocuklar için park', 'Her ay mahalle toplantısı',
  'Gençlere tarım atölyesi', 'Yaşlılara yardım günü', 'Şeffaf bütçe panosu'];
function manifesto(k, ad) {
  return sec([
    `${ad} olarak komşularımla birlikte daha yeşil ve dayanışmacı bir mahalle için aday oluyorum.`,
    `Yıllardır bu topraklarda emek veriyorum; sözümü tutan, kapısı herkese açık bir yönetim istiyorum.`,
    `Mahallemizin sorunlarını yerinde dinleyip belediyeye taşıyacağım; bütçe her ay herkese açık olacak.`,
  ]) + (k.ton.includes('bilge') ? ' Önce dinlemek, sonra konuşmak.' : '');
}
function siyaset() {
  const secim = require('./secim');
  const t = simdi();
  const aktif = db.prepare(`SELECT * FROM secimler WHERE asama IN ('ADAYLIK', 'OYLAMA')`).all();
  for (const s of aktif) {
    const tur = SECIM.turler[s.tur] || SECIM.turler.MUHTAR;
    if (s.asama === 'ADAYLIK') {
      if (!secim.doldurmaKipi(tur, s.region_id)) continue;
      const demolar = secim.demoSakinler(tur, s.region_id).map((d) => db.prepare(`SELECT * FROM users WHERE id = ?`).get(d.id))
        .filter((d) => KISILIKLER[d.npc_kisilik]).sort((a, b) => KISILIKLER[b.npc_kisilik].siyaset - KISILIKLER[a.npc_kisilik].siyaset);
      for (const [makam, m] of Object.entries(tur.makamlar)) {
        const adayVar = db.prepare(`SELECT COUNT(*) c FROM adaylar WHERE secim_id = ? AND makam = ? AND durum = 'AKTIF'`).get(s.id, makam).c;
        const hedef = makam === 'MECLIS' ? Math.min(m.koltuk, 3) : 2;
        if (adayVar >= hedef) continue;
        const aday = demolar.find((d) => !db.prepare(`SELECT 1 FROM adaylar WHERE secim_id = ? AND user_id = ?`).get(s.id, d.id) && Math.random() < KISILIKLER[d.npc_kisilik].siyaset + 0.3);
        if (!aday) continue;
        const vaat = [...VAATLER].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
        sessiz(() => secim.adayOl(aday.id, s.id, { makam, manifesto: manifesto(KISILIKLER[aday.npc_kisilik], aday.display_name), vaatler: vaat }));
        break;   // bir turda bir adaylık: süreç doğal aksın
      }
    } else if (s.asama === 'OYLAMA' && s.doldurma) {
      // Kütükteki demo sakinler oyunu kullanır; tercih: vaat sayısı, itibar ve küçük bir rastlantı (gerçek adaylara karşı önyargı yok)
      const bekleyen = db.prepare(`SELECT k.user_id FROM secmen_kutugu k JOIN users u ON u.id = k.user_id
                                   WHERE k.secim_id = ? AND u.is_npc = 1 AND NOT EXISTS (SELECT 1 FROM secim_katilim c WHERE c.secim_id = k.secim_id AND c.user_id = k.user_id)`).all(s.id);
      const adaylar = db.prepare(`SELECT a.*, u.is_npc FROM adaylar a JOIN users u ON u.id = a.user_id WHERE a.secim_id = ? AND a.durum = 'AKTIF'`).all(s.id);
      for (const { user_id } of bekleyen.slice(0, 6)) {
        if (Math.random() < 0.15) continue;   // herkes ilk anda oy vermez
        const govde = { secimler: {} };
        for (const makam of new Set(adaylar.map((a) => a.makam || 'MUHTAR'))) {
          const liste = adaylar.filter((a) => (a.makam || 'MUHTAR') === makam && a.user_id !== user_id);
          if (!liste.length) continue;
          const agirlik = liste.map((a) => 1 + JSON.parse(a.vaatler).length * 0.3 + secim.itibar(a.user_id).toplam / 100 + Math.random() * 1.5);
          govde.secimler[makam] = liste[agirlik.indexOf(Math.max(...agirlik))].id;
        }
        if (!Object.keys(govde.secimler).length) continue;
        if (s.tur !== 'BELEDIYE') govde.adayId = Object.values(govde.secimler)[0];
        sessiz(() => secim.oyVer(user_id, s.id, govde, `npc:${user_id}`));   // demo sakinin "cihazı" kendine özgüdür
      }
    }
  }
  // Görevdeki demo muhtar: arada bir duyuru, vaatlerinde ilerleme
  for (const m of db.prepare(`SELECT m.*, u.display_name AS ad FROM muhtarlar m JOIN users u ON u.id = m.user_id WHERE u.is_npc = 1 AND m.baslangic <= ? AND m.bitis > ?`).all(t, t)) {
    if (Math.random() < 0.08) {
      const h = require('./dunya').ilHavasi(db.prepare(`SELECT rl.plaka FROM regions r JOIN regions ri ON ri.id = r.parent_id JOIN regions rl ON rl.id = ri.parent_id WHERE r.id = ?`).get(m.region_id)?.plaka);
      const metin = sec([
        'Komşular, bu hafta muhtarlıkta çay var; dertlerinizi dinlemeye hazırım.',
        h ? `Hava ${h.durum.toLocaleLowerCase('tr-TR')}, ${h.sicaklik}°. Tarlalarınızı ona göre sulayın.` : 'Tarlalarınızı sulamayı unutmayın.',
        'Belediyeye mahallemiz için hizmet talebinde bulunacağım; önerilerinizi bekliyorum.',
      ]);
      sessiz(() => secim.duyuruYap(m.user_id, m.region_id, { metin }));
    }
    if (Math.random() < 0.05) {
      const v = db.prepare(`SELECT * FROM vaat_takip WHERE muhtar_id = ? AND durum IN ('BEKLIYOR', 'BASLADI') ORDER BY sira LIMIT 1`).get(m.id);
      if (v) sessiz(() => secim.vaatGuncelle(m.user_id, v.id, { durum: v.durum === 'BEKLIYOR' ? 'BASLADI' : 'TAMAMLANDI', aciklama: 'Muhtarlık çalışması' }));
    }
  }
  // Belediye: demo başkan kasa yetince gerçek oyuncuların mahallesine proje önerir; demo üyeler meclis oyunu kullanır
  const belediye = require('./belediye');
  for (const b of db.prepare(`SELECT b.* FROM belediye_uyeleri b JOIN users u ON u.id = b.user_id WHERE u.is_npc = 1 AND b.makam = 'BASKAN' AND b.baslangic <= ? AND b.bitis > ?`).all(t, t)) {
    if (Math.random() > 0.15 || db.prepare(`SELECT 1 FROM projeler WHERE region_id = ? AND durum = 'MECLISTE'`).get(b.region_id)) continue;
    const hedef = db.prepare(`SELECT p.region_id AS id, COUNT(DISTINCT p.owner_user_id) c FROM parcels p JOIN users u ON u.id = p.owner_user_id
                              WHERE p.ilce_id = ? AND u.is_npc = 0 GROUP BY p.region_id ORDER BY c DESC LIMIT 1`).get(b.region_id);
    if (!hedef) continue;
    for (const tur of Object.keys(BELEDIYE.projeler).sort(() => Math.random() - 0.5)) {
      if (sessiz(() => belediye.projeTeklif(b.user_id, b.region_id, { tur, hedefMahalleId: hedef.id, gerekce: 'Mahalle sakinlerinin en çok dile getirdiği ihtiyaç; bütçe kasadan karşılanır.' }))) break;
    }
  }
  for (const p of db.prepare(`SELECT * FROM projeler WHERE durum = 'MECLISTE' AND oylama_bitis > ?`).all(t)) {
    for (const u of db.prepare(`SELECT b.user_id FROM belediye_uyeleri b JOIN users u ON u.id = b.user_id WHERE b.region_id = ? AND u.is_npc = 1 AND b.baslangic <= ? AND b.bitis > ?
                                AND NOT EXISTS (SELECT 1 FROM proje_oylari o WHERE o.proje_id = ? AND o.user_id = b.user_id)`).all(p.region_id, t, t, p.id)) {
      sessiz(() => belediye.meclisOyu(u.user_id, p.id, { oy: Math.random() < 0.75 ? 'EVET' : sec(['HAYIR', 'CEKIMSER']) }));
    }
  }
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
        const fiyat = Math.max(20, Math.round(oyun.birincilBedel(p) * 1.1));
        sessiz(() => pazar.ilanAc(n.id, p.id, { fiyat, gun: 3, kosul: 'HERKES' }));
      }
      L.denetim({ aktor: n.id, eylem: 'DEMO_RESIDENT_LEAVING', varlik: `MAHALLE:${m.id}`, bolge: m.id, herkese: true, sonra: { ad: n.display_name } });
    }
  }
  // Süresi dolan ya da tüm parselleri satılan taşınanlar ayrılır; kalan parseller devlete döner, makamları boşalır
  for (const n of db.prepare(`SELECT * FROM users WHERE is_npc = 1 AND npc_durum = 'TASINIYOR'`).all()) {
    const kalan = db.prepare(`SELECT id FROM parcels WHERE owner_user_id = ?`).all(n.id);
    if (kalan.length && n.npc_sonraki > t) continue;
    db.transaction(() => {
      for (const i of db.prepare(`SELECT id FROM listings WHERE seller_id = ? AND status = 'ACTIVE'`).all(n.id)) sessiz(() => pazar.ilanIptal(n.id, i.id));
      for (const p of kalan) {
        db.prepare(`DELETE FROM structures WHERE parcel_id = ?`).run(p.id);
        db.prepare(`UPDATE crops SET status = 'HARVESTED', harvested_qty = 0 WHERE parcel_id = ? AND status = 'GROWING'`).run(p.id);
        db.prepare(`UPDATE parcel_ownership SET end_at = datetime('now') WHERE parcel_id = ? AND end_at IS NULL`).run(p.id);
        db.prepare(`UPDATE parcels SET owner_user_id = NULL, acquired_at = NULL, version = version + 1 WHERE id = ?`).run(p.id);
      }
      for (const e of db.prepare(`SELECT id FROM urun_emirleri WHERE user_id = ? AND durum = 'ACIK'`).all(n.id)) sessiz(() => require('./ekonomi').emirIptal(n.id, e.id));
      db.prepare(`UPDATE adaylar SET durum = 'CEKILDI' WHERE user_id = ? AND durum = 'AKTIF'`).run(n.id);
      require('./moderasyon').tumMakamlariBosalt(n.id, 'Demo sakin mahalleden taşındı');
      db.prepare(`UPDATE users SET npc_durum = 'TASINDI' WHERE id = ?`).run(n.id);
    })();
  }
}

// ---------- Sohbet: gerçek oyuncunun mahalle mesajına yanıt, arada bir kendiliğinden söz
const sonYanit = new Map(), sonKendiliginden = new Map();
const KALIP = [
  [/(selam|merhaba|günaydın|iyi akşam|hayırlı)/i, ['Aleyküm selam komşu, hoş geldin!', 'Merhaba! Tarlalar nasıl gidiyor?', 'Selam! Mahallemize renk kattın.']],
  [/(hasat|ekin|tarla|tohum|sula)/i, ['Ekini olgunlaşınca bekletme, tarlada bozuluyor.', 'Sulama hattı kurarsan sulamakla uğraşmazsın, bir de verim artar.', 'Bu mevsim ne eksen bereketli olsun.']],
  [/(seçim|muhtar|oy|aday|belediye|meclis)/i, ['Seçim yaklaşınca adayların vaatlerine iyi bak derim.', 'Muhtarlık kolay iş değil, ama mahalle için değer.', 'Oy gizli, kimse kime verdiğini bilemez; içimiz rahat.']],
  [/(hava|yağmur|kar|soğuk|sıcak)/i, null],
  [/(pazar|fiyat|sat|borsa|akçe)/i, ['Borsada emir verirken tüccar fiyatına bir bak, aşağısına satma.', 'Pazarlık sünnettir derler, ilan fiyatına hemen razı olma!']],
  [/\?$/, ['Bilmem ki komşu, muhtara sormak lazım.', 'Güzel soru! Haberler sekmesinde mahallede olanlar yazıyor.', 'Bence denemek lazım, en kötü tecrübe olur.']],
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
    const secimVar = db.prepare(`SELECT asama FROM secimler WHERE region_id = ? AND asama IN ('ADAYLIK','KAMPANYA','OYLAMA')`).get(m.id);
    const metin = secimVar ? sec(['Seçim heyecanı başladı, adaylara bir göz atın.', 'Oylama açılınca herkes sandığa!', 'Adayların vaatlerini okudunuz mu?'])
      : sec(['Bugün hasat bereketliydi, şükür.', 'Komşular, akşam çay benden.', 'Pazarda domates fiyatları iyi bu ara.', 'Tarlaya yeni çit çektim, gelin görün.', kalipYanit('hava', m.id)]);
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
    sessiz(siyaset);
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

module.exports = { baslat, nufusDongusu, yerlestir, eylem, siyaset, tasinma, sohbetYanitla, kalipYanit, aktifMahalleler, mahalleNufusu, KISILIKLER };
