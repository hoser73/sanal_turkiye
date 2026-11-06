// Arsa konum değeri (server/harita/konum.js): gerçek hayattaki gibi denize, şehir merkezine yakın ve düz arazi pahalı;
// dağda, yamaçta, merkezden uzakta ucuz. Değer = il seviyesi × ilçe farkı × kıyı × merkez × arazi × yol (bkz. KONUM).
//
// İl seviyesi: Türkiye ortalaması = 1. 2025 civarı il ortalama konut m² satış fiyatlarının (TCMB konut birim fiyatları,
// emlak endeksleri) YAKLAŞIK oranlarından derlenmiştir; resmî ya da güncel değerleme değildir, oyun dengesi için yuvarlanmıştır.
// İlçe farkı: ilin ortalamasına göre bilinen pahalı (sahil, turizm, merkez) ve ucuz (iç, dağlık) ilçeler; listede olmayan 1.
// Adlar sınır verisindeki yazımla aksansız karşılaştırılır (Ayvacık = Ayvacik). Kıyıya ve merkeze yakınlık ayrıca hesaplandığından ilçe farkları ölçülüdür (Bodrum'un tamamı değil, ilçe genelinin primi).

const IL_FIYAT = {
  '01': 0.62, '02': 0.42, '03': 0.5, '04': 0.36, '05': 0.5, '06': 0.92, '07': 1.35, '08': 0.62, '09': 1.1, '10': 0.95,
  '11': 0.55, '12': 0.4, '13': 0.36, '14': 0.75, '15': 0.58, '16': 0.9, '17': 0.98, '18': 0.42, '19': 0.48, '20': 0.7,
  '21': 0.5, '22': 0.75, '23': 0.5, '24': 0.48, '25': 0.5, '26': 0.78, '27': 0.62, '28': 0.68, '29': 0.45, '30': 0.33,
  '31': 0.6, '32': 0.6, '33': 0.78, '34': 1.65, '35': 1.35, '36': 0.36, '37': 0.6, '38': 0.62, '39': 0.75, '40': 0.42,
  '41': 0.92, '42': 0.6, '43': 0.5, '44': 0.5, '45': 0.7, '46': 0.5, '47': 0.45, '48': 1.95, '49': 0.36, '50': 0.55,
  '51': 0.45, '52': 0.7, '53': 0.85, '54': 0.78, '55': 0.7, '56': 0.38, '57': 0.72, '58': 0.48, '59': 0.85, '60': 0.45,
  '61': 0.85, '62': 0.42, '63': 0.45, '64': 0.55, '65': 0.45, '66': 0.4, '67': 0.6, '68': 0.48, '69': 0.38, '70': 0.5,
  '71': 0.45, '72': 0.42, '73': 0.38, '74': 0.65, '75': 0.33, '76': 0.4, '77': 1.0, '78': 0.52, '79': 0.4, '80': 0.48,
  '81': 0.72,
};

const ILCE_FIYAT = {
  '34': { Beşiktaş: 2.4, Sarıyer: 2.2, Kadıköy: 2.1, Bakırköy: 1.8, Şişli: 1.7, Beykoz: 1.7, Üsküdar: 1.5, Ataşehir: 1.4,
    Beyoğlu: 1.3, Fatih: 1.2, Maltepe: 1.2, Eyüpsultan: 1.1, Zeytinburnu: 1.1, Kağıthane: 1.1, Kartal: 1.0, Başakşehir: 1.0, Tuzla: 0.9,
    Pendik: 0.85, Beylikdüzü: 0.85, Küçükçekmece: 0.85, Şile: 0.85, Büyükçekmece: 0.8, Güngören: 0.8, Avcılar: 0.75, Sancaktepe: 0.75,
    Bağcılar: 0.7, Esenler: 0.65, Silivri: 0.65, Sultangazi: 0.6, Arnavutköy: 0.6, Esenyurt: 0.55, Sultanbeyli: 0.55, Çatalca: 0.55 },
  '06': { Çankaya: 1.6, Yenimahalle: 1.15, Gölbaşı: 1.1, Etimesgut: 1.05, Keçiören: 0.85, Sincan: 0.75, Pursaklar: 0.75, Mamak: 0.7,
    Altındağ: 0.7, Kahramankazan: 0.6, Akyurt: 0.6, Çubuk: 0.55, Elmadağ: 0.5, Polatlı: 0.45, Beypazarı: 0.45, Kızılcahamam: 0.45,
    Haymana: 0.3, Nallıhan: 0.3 },
  '35': { Çeşme: 2.6, Urla: 2.0, Güzelbahçe: 1.7, Narlıdere: 1.4, Foça: 1.4, Karşıyaka: 1.35, Balçova: 1.3, Seferihisar: 1.3,
    Karaburun: 1.2, Bornova: 1.15, Konak: 1.15, Bayraklı: 1.1, Çiğli: 1.0, Gaziemir: 1.0, Dikili: 1.0, Buca: 0.95, Menderes: 0.95,
    Selçuk: 0.9, Karabağlar: 0.85, Aliağa: 0.8, Torbalı: 0.75, Kemalpaşa: 0.75, Menemen: 0.7, Ödemiş: 0.55, Tire: 0.55, Bergama: 0.55,
    Bayındır: 0.5, Kınık: 0.45, Kiraz: 0.4, Beydağ: 0.4 },
  '48': { Bodrum: 2.0, Datça: 1.3, Marmaris: 1.25, Fethiye: 1.2, Ortaca: 0.75, Dalaman: 0.75, Menteşe: 0.75, Köyceğiz: 0.65, Milas: 0.6,
    Ula: 0.6, Seydikemer: 0.55, Yatağan: 0.45, Kavaklıdere: 0.35 },
  '07': { Kaş: 1.6, Konyaaltı: 1.45, Kemer: 1.35, Muratpaşa: 1.3, Alanya: 1.15, Döşemealtı: 0.9, Manavgat: 0.85, Serik: 0.8, Aksu: 0.8,
    Gazipaşa: 0.8, Kepez: 0.75, Kumluca: 0.75, Finike: 0.75, Demre: 0.7, Korkuteli: 0.45, Elmalı: 0.4, Gündoğmuş: 0.35, Akseki: 0.3,
    İbradı: 0.3 },
  '09': { Kuşadası: 1.5, Didim: 1.15, Efeler: 0.85, Söke: 0.75, Nazilli: 0.6, Karacasu: 0.45, Bozdoğan: 0.45, Karpuzlu: 0.4 },
  '10': { Ayvalık: 1.5, Edremit: 1.35, Burhaniye: 1.15, Erdek: 1.1, Gömeç: 1.0, Marmara: 1.0, Bandırma: 0.9, Karesi: 0.85, Altıeylül: 0.8,
    İvrindi: 0.45, Dursunbey: 0.4, Sındırgı: 0.4, Kepsut: 0.4 },
  '17': { Bozcaada: 2.0, Ayvacık: 1.0 },
  '16': { Nilüfer: 1.4, Mudanya: 1.25, Osmangazi: 1.0, Gemlik: 0.9, Yıldırım: 0.8, Orhangazi: 0.75, Keles: 0.35, Büyükorhan: 0.35, Harmancık: 0.35 },
  '41': { Kartepe: 1.1, Başiskele: 1.05, İzmit: 1.0, Gebze: 0.95, Kandıra: 0.6 },
  '33': { Yenişehir: 1.3, Mezitli: 1.2, Erdemli: 0.8, Silifke: 0.7, Çamlıyayla: 0.5, Mut: 0.4, Gülnar: 0.4 },
  '61': { Ortahisar: 1.3, Akçaabat: 1.0, Çaykara: 0.8 },
};

// Etken eğrileri (uzaklıklar metre). Her biri 1 etrafında çarpan verir; ürün KONUM.alt–KONUM.ust aralığına sıkıştırılır.
const KONUM = {
  surum: 1,                                    // formül değişince artar: eski parsellerin değeri yeniden hesaplanır
  deniz: { prim: 1.8, olcek: 700 },            // kıyıda ×2,8; 500 m ×1,9; 1 km ×1,4; 3 km'de etkisiz
  gol: { prim: 0.3, olcek: 500 },              // göl kıyısı ×1,3
  sehir: { prim: 0.6, olcek: 5000 },           // il ya da büyük şehir merkezi ×1,6 (+ kasaba payı)
  kasaba: { prim: 0.3, olcek: 2000 },          // ilçe/kasaba merkezi ×1,3
  uzak: { esik: 12000, adim: 60000, taban: 0.7 },   // en yakın kasabaya 12 km'den uzaksa yavaşça ucuzlar (en çok ×0,7)
  egim: { esik: 8, oran: 0.015, taban: 0.6 },  // %8 üstü her eğim puanı %1,5 ucuzlatır (en çok ×0,6)
  dag: { esik: 120, oran: 0.0007, taban: 0.55 },    // çevresinden 120 m'den yüksekte her metre %0,07 (sırt/yamaç; en çok ×0,55)
  yol: 1.08,                                   // ana yola 2 hücre (≈ 60 m) içinde
  alt: 0.1, ust: 15,
};

module.exports = { IL_FIYAT, ILCE_FIYAT, KONUM };
