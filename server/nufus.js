// Yaşayan nüfus (§7.7): gerçek oyuncusu olan ama nüfusu az mahallelerde boşluğu dolduran, açıkça "demo sakin" etiketli
// simüle vatandaşlar. Ayrı bir hile katmanı yoktur: oyuncularla AYNI işlevleri (parsel edinme, ekim, hasat, satış, borsa,
// bakım, seçim, meclis) aynı kurallar, aynı defter ve aynı sınırlarla çağırırlar. Kişilikleri kararlarını belirler.
// Mahallede gerçek oyuncu çoğaldığında parsellerini satışa çıkarıp taşınırlar; satılmayan parseller devlete döner.
const db = require('./db');
const L = require('./lib/ledger');
const { NUFUS, URUNLER, YAPILAR, SECIM, BELEDIYE, OZELLIK } = require('./config/rules');
const { yol } = require('./lib/olaylar');

const simdi = () => Date.now();
const rastgele = (a, b) => a + Math.random() * (b - a);
const sec = (dizi) => dizi[Math.floor(Math.random() * dizi.length)];
// Kural reddi (bakiye, süre…) normaldir: sakin başka şey dener. Postgres'te işlem içindeki hata işlemi bozar; işlem içinde
// çağrılan eylemler sessizIc ile kayıt noktasına (iç db.tx) sarılır.
const sessiz = async (fn) => { try { return await fn(); } catch { return null; } };
const sessizIc = (fn) => sessiz(() => db.tx(fn));

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
  return db.all(`SELECT p.region_id AS id,
      COUNT(DISTINCT CASE WHEN u.is_npc = 0 AND u.status = 'ACTIVE' THEN u.id END) AS gercek,
      COUNT(DISTINCT CASE WHEN u.is_npc = 1 AND u.npc_kisilik IS NOT NULL AND u.npc_durum = 'AKTIF' THEN u.id END) AS demo
    FROM parcels p JOIN users u ON u.id = p.owner_user_id GROUP BY p.region_id
    HAVING COUNT(DISTINCT CASE WHEN u.is_npc = 0 AND u.status = 'ACTIVE' THEN u.id END) >= 1`);
}
const demoSayisi = async () => (await db.get(`SELECT COUNT(*) c FROM users WHERE is_npc = 1 AND npc_kisilik IS NOT NULL AND npc_durum IN ('AKTIF', 'TASINIYOR')`)).c;
const mahalleDemolari = (mahalleId) => db.all(`SELECT * FROM users WHERE is_npc = 1 AND npc_mahalle = ? AND npc_durum = 'AKTIF'`, mahalleId);
const ilPlakasi = async (mahalleId) => (await db.get(`SELECT rl.plaka FROM regions r JOIN regions ri ON ri.id = r.parent_id JOIN regions rl ON rl.id = ri.parent_id WHERE r.id = ?`, mahalleId))?.plaka;

// ---------- Yerleşme: gerçek oyuncunun parseline yakın, aynı mahallede boş ve uygun bir hücre
async function yerlestir(mahalleId) {
  const { parselHazirla, hucreAra } = require('./harita/parsel');
  const oyun = require('./oyun');
  const merkez = await db.get(`SELECT p.centroid_lon AS lon, p.centroid_lat AS lat FROM parcels p JOIN users u ON u.id = p.owner_user_id
                             WHERE p.region_id = ? AND u.is_npc = 0 ORDER BY RANDOM() LIMIT 1`, mahalleId);
  if (!merkez) return null;
  const kod = kisilikSec();
  const k = KISILIKLER[kod];
  const adaylar = await hucreAra(merkez.lon, merkez.lat, k.imar, 4, 2);
  for (const hucreId of adaylar) {
    const id = await parselHazirla(hucreId);   // deneme ilçesinde tarlanın kimliği
    const p = await sessiz(() => oyun.parselGetir(id));
    if (!p || p.region_id !== mahalleId || p.owner_user_id) continue;
    const mevcut = new Set((await mahalleDemolari(mahalleId)).map((d) => d.display_name));
    let ad = `${k.unvan} ${sec(ADLAR)}`;
    for (let i = 0; i < 5 && mevcut.has(ad); i++) ad = `${k.unvan} ${sec(ADLAR)}`;
    const t = simdi();
    const uid = await db.tx(async () => {
      const yeni = (await db.run(`INSERT INTO users (display_name, is_npc, npc_kisilik, npc_mahalle, npc_durum, npc_sonraki, meslek, ayarlar)
                               VALUES (?, 1, ?, ?, 'AKTIF', ?, ?, '{"sohbet":true}')`, ad, kod, mahalleId, Math.round(t + rastgele(5_000, 60_000)), k.meslek)).lastInsertRowid;
      await L.odul(yeni, NUFUS.baslangicBakiye, 'Demo sakin başlangıç bakiyesi');
      await L.denetim({ aktor: yeni, eylem: 'DEMO_RESIDENT_ARRIVED', varlik: `MAHALLE:${mahalleId}`, bolge: mahalleId, herkese: true, sonra: { ad, unvan: k.unvan } });
      return yeni;
    });
    if (!await sessiz(() => oyun.parselEdin(uid, id))) {
      // Edinilemediyse (bakiye/limit/yarış) sakin yerleşmez
      await db.run(`UPDATE users SET npc_durum = 'TASINDI' WHERE id = ?`, uid);
      continue;
    }
    return { id: uid, ad, parsel: id };
  }
  return null;
}

// ---------- Ekonomik eylem: bir demo sakinin bir "turu"
async function eylem(n) {
  const oyun = require('./oyun');
  const k = KISILIKLER[n.npc_kisilik];
  if (!k) return;
  const t = simdi();
  const parseller = await db.all(`SELECT id, zoning_type, region_id FROM parcels WHERE owner_user_id = ?`, n.id);
  const yapilanlar = [];
  for (const p of parseller) {
    const kart = await sessiz(() => oyun.parselKarti(p.id, n.id, {}, { hafif: true }));
    if (!kart) continue;
    if (kart.tarimMi) {
      const e = kart.ekin;
      if (e && (e.olgun || e.tazelik === 'CURUDU')) { if (await sessiz(() => oyun.hasat(n.id, p.id))) yapilanlar.push('hasat'); }
      else if (e && !e.otomatikSulama && e.sulama < e.gerekenSulama && !e.sonrakiSulamaMs) { if (await sessiz(() => oyun.sula(n.id, p.id))) yapilanlar.push('sula'); }
      else if (!e) {
        const uygun = (kart.urunSecenekleri || []).filter((u) => u.uygun);
        const yoresel = uygun.find((u) => URUNLER[u.kod].bolgeler);   // bölgesinin ürününü sever
        const tercih = yoresel && Math.random() < 0.5 ? yoresel.kod : sec(k.urunler.filter((u) => uygun.some((x) => x.kod === u))) || uygun[0]?.kod;
        if (tercih && await sessiz(() => oyun.ek(n.id, p.id, tercih))) yapilanlar.push(`ek:${tercih}`);
      }
    }
    // Bakım: sağlık yarının altına inen yapı
    if (kart.yapilar.some((y) => y.durum === 'ACTIVE' && y.saglik < 55)) { if (await sessiz(() => oyun.bakimYap(n.id, p.id))) yapilanlar.push('bakim'); }
    // Yapı: bakiyesi rahatsa kişiliğine uygun bir geliştirme
    const bakiye = await L.bakiye(n.id);
    if (bakiye > 260 && Math.random() < 0.25) {
      const secenek = (kart.insaatSecenekleri || []).filter((x) => x.uygun && k.yapilar.includes(x.tip) && x.maliyet < bakiye - 120);
      const y = sec(secenek);
      if (y && await sessiz(() => oyun.insaatBaslat(n.id, p.id, y.tip))) yapilanlar.push(`insaat:${y.tip}`);
    }
  }
  // Satış: kişiliğin satış eğilimine göre; borsacı kişilik borsaya emir verir
  for (const i of await L.envanter(n.id)) {
    if (i.miktar < 10 || Math.random() > k.satis) continue;
    const adet = Math.max(1, Math.floor(i.miktar * rastgele(0.4, 0.8)));
    if (k.borsaci && Math.random() < 0.6) {
      const fiyat = Math.round(URUNLER[i.item_id].tabanFiyat * rastgele(1.05, 1.3) * 100) / 100;
      if (await sessiz(() => require('./ekonomi').emirVer(n.id, { urun: i.item_id, yon: 'SAT', fiyat, miktar: adet, gun: 3 }))) yapilanlar.push('borsa');
    } else if (await sessiz(() => oyun.npcSat(n.id, i.item_id, adet))) yapilanlar.push('sat');
  }
  // Komşuluk: arada bir gerçek bir komşunun parselini ziyaret eder
  if (Math.random() < 0.12) {
    const komsu = await db.get(`SELECT p.id FROM parcels p JOIN users u ON u.id = p.owner_user_id WHERE p.region_id = ? AND u.is_npc = 0 ORDER BY RANDOM() LIMIT 1`, n.npc_mahalle);
    if (komsu && await sessiz(() => oyun.ziyaret(n.id, komsu.id))) yapilanlar.push('ziyaret');
  }
  await db.run(`UPDATE users SET npc_sonraki = ? WHERE id = ?`, Math.round(t + NUFUS.eylemAraligiMs * rastgele(0.6, 1.4)), n.id);
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
async function siyaset() {
  const secim = require('./secim');
  const t = simdi();
  const aktif = await db.all(`SELECT * FROM secimler WHERE asama IN ('ADAYLIK', 'OYLAMA')`);
  for (const s of aktif) {
    const tur = SECIM.turler[s.tur] || SECIM.turler.MUHTAR;
    if (s.asama === 'ADAYLIK') {
      if (!await secim.doldurmaKipi(tur, s.region_id)) continue;
      const demolar = [];
      for (const d of await secim.demoSakinler(tur, s.region_id)) {
        const u = await db.get(`SELECT * FROM users WHERE id = ?`, d.id);
        if (u && KISILIKLER[u.npc_kisilik]) demolar.push(u);
      }
      demolar.sort((a, b) => KISILIKLER[b.npc_kisilik].siyaset - KISILIKLER[a.npc_kisilik].siyaset);
      for (const [makam, m] of Object.entries(tur.makamlar)) {
        const adayVar = (await db.get(`SELECT COUNT(*) c FROM adaylar WHERE secim_id = ? AND makam = ? AND durum = 'AKTIF'`, s.id, makam)).c;
        const hedef = makam === 'MECLIS' ? Math.min(m.koltuk, 3) : 2;
        if (adayVar >= hedef) continue;
        let aday = null;
        for (const d of demolar) {
          if (!await db.get(`SELECT 1 FROM adaylar WHERE secim_id = ? AND user_id = ?`, s.id, d.id) && Math.random() < KISILIKLER[d.npc_kisilik].siyaset + 0.3) { aday = d; break; }
        }
        if (!aday) continue;
        const vaat = [...VAATLER].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
        await sessiz(() => secim.adayOl(aday.id, s.id, { makam, manifesto: manifesto(KISILIKLER[aday.npc_kisilik], aday.display_name), vaatler: vaat }));
        break;   // bir turda bir adaylık: süreç doğal aksın
      }
    } else if (s.asama === 'OYLAMA' && s.doldurma) {
      // Kütükteki demo sakinler oyunu kullanır; tercih: vaat sayısı, itibar ve küçük bir rastlantı (gerçek adaylara karşı önyargı yok)
      const bekleyen = await db.all(`SELECT k.user_id FROM secmen_kutugu k JOIN users u ON u.id = k.user_id
                                   WHERE k.secim_id = ? AND u.is_npc = 1 AND NOT EXISTS (SELECT 1 FROM secim_katilim c WHERE c.secim_id = k.secim_id AND c.user_id = k.user_id)`, s.id);
      const adaylar = await db.all(`SELECT a.*, u.is_npc FROM adaylar a JOIN users u ON u.id = a.user_id WHERE a.secim_id = ? AND a.durum = 'AKTIF'`, s.id);
      const itibarlar = new Map();   // ağırlık hesabı (map içi) senkron kalsın diye önceden toplanır
      for (const a of adaylar) if (!itibarlar.has(a.user_id)) itibarlar.set(a.user_id, (await secim.itibar(a.user_id)).toplam);
      for (const { user_id } of bekleyen.slice(0, 6)) {
        if (Math.random() < 0.15) continue;   // herkes ilk anda oy vermez
        const govde = { secimler: {} };
        for (const makam of new Set(adaylar.map((a) => a.makam || 'MUHTAR'))) {
          const liste = adaylar.filter((a) => (a.makam || 'MUHTAR') === makam && a.user_id !== user_id);
          if (!liste.length) continue;
          const agirlik = liste.map((a) => 1 + JSON.parse(a.vaatler).length * 0.3 + itibarlar.get(a.user_id) / 100 + Math.random() * 1.5);
          govde.secimler[makam] = liste[agirlik.indexOf(Math.max(...agirlik))].id;
        }
        if (!Object.keys(govde.secimler).length) continue;
        if (s.tur !== 'BELEDIYE') govde.adayId = Object.values(govde.secimler)[0];
        await sessiz(() => secim.oyVer(user_id, s.id, govde, `npc:${user_id}`));   // demo sakinin "cihazı" kendine özgüdür
      }
    }
  }
  // Görevdeki demo muhtar: arada bir duyuru, vaatlerinde ilerleme
  for (const m of await db.all(`SELECT m.*, u.display_name AS ad FROM muhtarlar m JOIN users u ON u.id = m.user_id WHERE u.is_npc = 1 AND m.baslangic <= ? AND m.bitis > ?`, t, t)) {
    if (Math.random() < 0.08) {
      const h = await require('./dunya').ilHavasi(await ilPlakasi(m.region_id));
      const metin = sec([
        'Komşular, bu hafta muhtarlıkta çay var; dertlerinizi dinlemeye hazırım.',
        h ? `Hava ${h.durum.toLocaleLowerCase('tr-TR')}, ${h.sicaklik}°. Tarlalarınızı ona göre sulayın.` : 'Tarlalarınızı sulamayı unutmayın.',
        'Belediyeye mahallemiz için hizmet talebinde bulunacağım; önerilerinizi bekliyorum.',
      ]);
      await sessiz(() => secim.duyuruYap(m.user_id, m.region_id, { metin }));
    }
    if (Math.random() < 0.05) {
      const v = await db.get(`SELECT * FROM vaat_takip WHERE muhtar_id = ? AND durum IN ('BEKLIYOR', 'BASLADI') ORDER BY sira LIMIT 1`, m.id);
      if (v) await sessiz(() => secim.vaatGuncelle(m.user_id, v.id, { durum: v.durum === 'BEKLIYOR' ? 'BASLADI' : 'TAMAMLANDI', aciklama: 'Muhtarlık çalışması' }));
    }
  }
  // Belediye: demo başkan kasa yetince gerçek oyuncuların mahallesine proje önerir; demo üyeler meclis oyunu kullanır
  const belediye = require('./belediye');
  for (const b of await db.all(`SELECT b.* FROM belediye_uyeleri b JOIN users u ON u.id = b.user_id WHERE u.is_npc = 1 AND b.makam = 'BASKAN' AND b.baslangic <= ? AND b.bitis > ?`, t, t)) {
    if (Math.random() > 0.15 || await db.get(`SELECT 1 FROM projeler WHERE region_id = ? AND durum = 'MECLISTE'`, b.region_id)) continue;
    const hedef = await db.get(`SELECT p.region_id AS id, COUNT(DISTINCT p.owner_user_id) c FROM parcels p JOIN users u ON u.id = p.owner_user_id
                              WHERE p.ilce_id = ? AND u.is_npc = 0 GROUP BY p.region_id ORDER BY c DESC LIMIT 1`, b.region_id);
    if (!hedef) continue;
    for (const tur of Object.keys(BELEDIYE.projeler).sort(() => Math.random() - 0.5)) {
      if (await sessiz(() => belediye.projeTeklif(b.user_id, b.region_id, { tur, hedefMahalleId: hedef.id, gerekce: 'Mahalle sakinlerinin en çok dile getirdiği ihtiyaç; bütçe kasadan karşılanır.' }))) break;
    }
  }
  for (const p of await db.all(`SELECT * FROM projeler WHERE durum = 'MECLISTE' AND oylama_bitis > ?`, t)) {
    for (const u of await db.all(`SELECT b.user_id FROM belediye_uyeleri b JOIN users u ON u.id = b.user_id WHERE b.region_id = ? AND u.is_npc = 1 AND b.baslangic <= ? AND b.bitis > ?
                                AND NOT EXISTS (SELECT 1 FROM proje_oylari o WHERE o.proje_id = ? AND o.user_id = b.user_id)`, p.region_id, t, t, p.id)) {
      await sessiz(() => belediye.meclisOyu(u.user_id, p.id, { oy: Math.random() < 0.75 ? 'EVET' : sec(['HAYIR', 'CEKIMSER']) }));
    }
  }
}

// ---------- Taşınma: mahallede yeterince gerçek oyuncu olunca demo sakinler çekilir
async function tasinma() {
  const pazar = require('./pazar');
  const oyun = require('./oyun');
  const t = simdi();
  for (const m of (await aktifMahalleler()).filter((x) => x.gercek >= NUFUS.cekilmeEsigi && x.demo > 0)) {
    for (const n of await mahalleDemolari(m.id)) {
      await db.run(`UPDATE users SET npc_durum = 'TASINIYOR', npc_sonraki = ? WHERE id = ?`, Math.round(t + NUFUS.tasinmaMs), n.id);
      for (const { id } of await db.all(`SELECT id FROM parcels WHERE owner_user_id = ?`, n.id)) {
        const p = await oyun.parselGetir(id);   // bedel hesabı mahalle çekiciliğini de ister
        const fiyat = Math.min(require('./config/rules').PAZAR.maxFiyat, Math.max(20, Math.round((await oyun.parselDegeri(p)).toplam * 1.1)));   // yapılarıyla bugünkü değeri
        await sessiz(() => pazar.ilanAc(n.id, p.id, { fiyat, gun: 3, kosul: 'HERKES' }));
      }
      await L.denetim({ aktor: n.id, eylem: 'DEMO_RESIDENT_LEAVING', varlik: `MAHALLE:${m.id}`, bolge: m.id, herkese: true, sonra: { ad: n.display_name } });
    }
  }
  // Süresi dolan ya da tüm parselleri satılan taşınanlar ayrılır; kalan parseller devlete döner, makamları boşalır
  for (const n of await db.all(`SELECT * FROM users WHERE is_npc = 1 AND npc_durum = 'TASINIYOR'`)) {
    const kalan = await db.all(`SELECT id FROM parcels WHERE owner_user_id = ?`, n.id);
    if (kalan.length && n.npc_sonraki > t) continue;
    await db.tx(async () => {
      for (const i of await db.all(`SELECT id FROM listings WHERE seller_id = ? AND status = 'ACTIVE'`, n.id)) await sessizIc(() => pazar.ilanIptal(n.id, i.id));
      for (const p of kalan) {
        // Parsel yalnızca hâlâ bu sakindeyse devlete döner (bu arada satılmış olabilir)
        if (!await db.get(`SELECT 1 FROM parcels WHERE id = ? AND owner_user_id = ? FOR UPDATE`, p.id, n.id)) continue;
        await oyun.parseliBosalt(p.id);
      }
      for (const e of await db.all(`SELECT id FROM urun_emirleri WHERE user_id = ? AND durum = 'ACIK'`, n.id)) await sessizIc(() => require('./ekonomi').emirIptal(n.id, e.id));
      await db.run(`UPDATE adaylar SET durum = 'CEKILDI' WHERE user_id = ? AND durum = 'AKTIF'
      AND secim_id NOT IN (SELECT id FROM secimler WHERE asama IN ('OYLAMA', 'ITIRAZ'))`, n.id);
      await require('./moderasyon').tumMakamlariBosalt(n.id, 'Demo sakin mahalleden taşındı');
      await db.run(`UPDATE users SET npc_durum = 'TASINDI' WHERE id = ?`, n.id);
    });
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
  [/\?$/, ['Bilmem ki komşu, muhtara sormak lazım.', 'Güzel soru! Köy › Haberler bölümünde mahallede olanlar yazıyor.', 'Bence denemek lazım, en kötü tecrübe olur.']],
];
async function kalipYanit(metin, mahalleId) {
  for (const [re, yanitlar] of KALIP) {
    if (!re.test(metin)) continue;
    if (!yanitlar) {
      const h = await require('./dunya').ilHavasi(await ilPlakasi(mahalleId));
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
  sonYanit.set(mahalleId, t);   // denetimden hemen sonra: art arda gelen mesajlar beklerken ikinci yanıt hazırlanmaz
  const gonderen = await db.get(`SELECT is_npc FROM users WHERE id = ?`, mesaj.userId);
  const demolar = gonderen && !gonderen.is_npc ? await mahalleDemolari(mahalleId) : [];
  if (!demolar.length) { sonYanit.delete(mahalleId); return; }   // yanıt verilmedi: süre işlemesin
  const n = sec(demolar);
  const k = KISILIKLER[n.npc_kisilik];
  await new Promise((r) => setTimeout(r, rastgele(...NUFUS.sohbetYanitMs)));
  const mahalleAd = (await db.get(`SELECT name FROM regions WHERE id = ?`, mahalleId))?.name;
  const yz = await require('./yz').npcYanit({ ad: n.display_name, unvan: k.unvan, ton: k.ton, mahalle: mahalleAd, mesaj: mesaj.metin }).catch(() => null);
  const metin = yz || await sessiz(() => kalipYanit(mesaj.metin, mahalleId));
  if (metin) await sessiz(() => require('./sohbet').npcYaz(n.id, kanal, metin));
}
async function kendiliginden() {
  const t = simdi();
  for (const m of (await aktifMahalleler()).filter((x) => x.demo > 0)) {
    if ((sonKendiliginden.get(m.id) || 0) + NUFUS.sohbetKendiliginden > t) continue;
    if (!sonKendiliginden.has(m.id)) { sonKendiliginden.set(m.id, t - NUFUS.sohbetKendiliginden * Math.random()); continue; }   // hepsi aynı anda konuşmasın
    sonKendiliginden.set(m.id, t);
    const n = sec(await mahalleDemolari(m.id));
    if (!n) continue;
    const secimVar = await db.get(`SELECT asama FROM secimler WHERE region_id = ? AND asama IN ('ADAYLIK','KAMPANYA','OYLAMA')`, m.id);
    const metin = secimVar ? sec(['Seçim heyecanı başladı, adaylara bir göz atın.', 'Oylama açılınca herkes sandığa!', 'Adayların vaatlerini okudunuz mu?'])
      : sec(['Bugün hasat bereketliydi, şükür.', 'Komşular, akşam çay benden.', 'Pazarda domates fiyatları iyi bu ara.', 'Tarlaya yeni çit çektim, gelin görün.', await kalipYanit('hava', m.id)]);
    await sessiz(() => require('./sohbet').npcYaz(n.id, `mahalle:${m.id}`, metin));
  }
}

// ---------- Döngü
let calisiyor = false;
async function nufusDongusu({ yerlestirmeSiniri = 2 } = {}) {
  if (!NUFUS.etkin || calisiyor) return { atlandi: true };
  calisiyor = true;
  const rapor = { yerlesen: 0, eylem: 0 };
  try {
    await sessiz(tasinma);
    // Yerleştirme: en çok ihtiyacı olan mahalleler önce
    let kota = Math.min(yerlestirmeSiniri, NUFUS.maxToplam - await demoSayisi());
    const ihtiyac = (await aktifMahalleler()).filter((m) => m.gercek < NUFUS.cekilmeEsigi && m.gercek + m.demo < NUFUS.mahalleHedef)
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
    for (const n of await db.all(`SELECT * FROM users WHERE is_npc = 1 AND npc_durum = 'AKTIF' AND npc_kisilik IS NOT NULL AND (npc_sonraki IS NULL OR npc_sonraki <= ?)
                                ORDER BY npc_sonraki LIMIT ?`, t, NUFUS.turBasinaEylem)) {
      if (await sessiz(() => eylem(n))) rapor.eylem++;
    }
    if (OZELLIK.siyaset) await sessiz(siyaset);
    await sessiz(kendiliginden);
  } finally { calisiyor = false; }
  return rapor;
}

let zamanlayici = null;
function baslat() {
  if (!NUFUS.etkin || zamanlayici) return;
  // Çok sunuculu kurulumda demo sakinleri tek bir sunucu yürütür (db.tekOrnek: Postgres danışma kilidi)
  zamanlayici = setInterval(() => db.tekOrnek('nufus', () => nufusDongusu())
    .catch((e) => require('./lib/gunluk').gunluk.warn('nüfus döngüsü', { hata: e })), NUFUS.dongüMs);
  zamanlayici.unref();
  // Yanıt, mesajın yazıldığı sunucuda bir kez hazırlanır (yol: yalnızca olayı doğuran sunucu)
  yol.on('sohbet', ({ kanal, mesaj }) => { sohbetYanitla(kanal, mesaj).catch(() => {}); });
}

async function mahalleNufusu(mahalleId) {
  return (await mahalleDemolari(Number(mahalleId))).map((d) => ({ ad: d.display_name, unvan: KISILIKLER[d.npc_kisilik]?.unvan }));
}

module.exports = { baslat, nufusDongusu, yerlestir, eylem, siyaset, tasinma, sohbetYanitla, kalipYanit, aktifMahalleler, mahalleNufusu, KISILIKLER };
