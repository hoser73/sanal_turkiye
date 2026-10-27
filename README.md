# Sanal Türkiye — prototip (v0.23, ulusal)

Yaşayan dijital ülke simülasyonu. **81 ilin tamamı açık**: gerçek Türkiye haritası üzerinde herhangi bir köye, mahalleye yakınlaşıp parsel edinebilir, tarla ekip yapı kurabilir, oyuncular arası pazarda alım satım yapabilirsin. Harita 2B ve 3B görünümlüdür.

> Sanal parseller gerçek tapu değildir; oyun içi kullanım hakkıdır. Akçe (₳) nakde çevrilemez. İmar türleri gerçek arazi kullanımından türetilmiş oyun kuralıdır, resmî imar planı değildir.

## Çalıştırma

```bash
npm install
npm start            # http://localhost:3400
npm run dev          # geliştirme: dosya değişince yeniden başlar, seçim takvimi hızlı (aşağıya bakın)
npm test             # kabul testleri (155; ağ ve gerçek yapay zekâ kullanmaz; PostgreSQL testi gömülü PGlite ile)
npm run rol -- e-posta ADMIN   # yetkili rolü ver (MODERATOR / DENETCI / ADMIN; panel için 2FA zorunlu)
npm run yedek        # çevrimiçi yedek (data/yedekler, gzip, bütünlük denetimi, 14 yedek döndürme)
npm run geri-yukle -- data/yedekler/<dosya>.db.gz [--onayla]   # sunucu durdurulmuşken
npm run yuk-testi -- --taban http://localhost:3400 --es 20 --sure 20
npm run postgres-aktar -- --sema | --disa-aktar <dizin>        # PostgreSQL + PostGIS geçişi (docs/postgres-gecisi.md)
npm run posta-dene -- adres@ornek.com   # SMTP ile HTML deneme e-postası
npm run veri         # il/ilçe sınır verisini yeniden hazırla (server/veri/kaynak → server/veri, public/veri)
npm run reset-db     # oyun veritabanını sıfırla (karo önbelleği korunur)
```

İlk çalıştırmada `data/sanalturkiye-tr.db` oluşur; 81 il ve 973 ilçe yüklenir, 10 demo komşu arka planda Türkiye'nin farklı yerlerine yerleşir (internet gerekir).

**Yerel test hesabı** (yalnızca `NODE_ENV` production değilken): `demo@sanalturkiye.test` / `demo1234`

Ortam değişkenleri (v0.7 eklemeleri): `NUFUS=kapali` (demo sakinleri kapatır), `SMTP_URL` artık gerçek gönderim + yeniden deneme kuyruğu; `NODE_ENV=production` iken eksik/güvensiz ayarla sunucu başlamaz (`server/yapilandirma.js`).

Ortam değişkenleri (v0.6 eklemeleri): `TABAN_URL` (e-posta bağlantıları; üretimde zorunlu), `SMTP_URL` (yoksa iletiler geliştirme posta kutusuna düşer: `/gelistirici/posta.html`), `POSTA_GONDEREN`, `SIFRELEME_ANAHTARI` (64 hex; 2FA sırlarını şifreler, üretimde zorunlu), `OTOMATIK_DOGRULA=1` (yalnız geliştirme), `YONETICI_2FA_ZORUNLU` (varsayılan açık), `KIMLIK_HIZ_CARPANI`, `API_HIZ_SINIRI` (dakikada IP başı, 600), `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_KONU` (web push; yoksa geliştirmede üretilir), `HAVA_KAYNAGI` (open-meteo / sahte / kapali), `LIG_HIZI`, `ANTHROPIC_API_KEY` + `YAPAY_ZEKA` (kapali ile devre dışı) + `YZ_MODEL` (varsayılan claude-opus-5-5), `VEKTOR_TILEJSON` / `YUKSELTI_KARO` / `HARF_KARO` / `EK_KARO_KOKENLERI` (kendi karo sunucusu: docs/karo-sunucusu.md), `GUNLUK_DUZEYI`.

Önceki ortam değişkenleri: `PORT` (3400), `OYUN_HIZI` (1 = tasarım süreleri), `SECIM_HIZI` (1 = gerçek seçim takvimi; 1440 = 1 gün 1 dakika), `SECIM_MIN_SECMEN` (muhtarlık seçimi için en az oyuncu sakin, varsayılan 3), `BELEDIYE_MIN_SECMEN` (belediye seçimi için ilçede en az oyuncu sakin, varsayılan 5), `VERI_DIZINI`, `KARO_KAYNAGI=sahte` (ağsız geliştirme/test: imar deseni deterministik, sınırlar gerçek), `NODE_ENV`.

`npm run dev` seçimleri tek başına denemek için `SECIM_HIZI=1440 SECIM_MIN_SECMEN=1 BELEDIYE_MIN_SECMEN=1` ile çalışır (1 oyun günü = 1 dakika): muhtarlık seçimi ≈ 8 dakika, belediye seçimi ≈ 12 dakika, meclis oylaması 1 dakika, proje yapımı 2–4 dakika, muhtarlık dönemi 30, belediye dönemi 90 dakika; günlük devlet katkısı dakikada bir işler. `npm start` gerçek süreleri kullanır.

> Not: v0.1–0.2'nin Meram ızgarası ulusal ızgarayla uyumsuz olduğundan eski `data/sanalturkiye.db` dosyası kullanılmaz (silinmedi).

## v0.43 — sade harita, oyun düğmesi sekmeler, her yerden balık

- **Harita sadeleşti:** üstteki hava şeridi ("Konya 18°") ve bayram/etkinlik şeridi kalktı. Hava penceresi Çiftlik sekmesindeki "🌦️ Çiftliğinin havası ve uyarılar"dan açılır; riskli hava yine bildirim olarak gelir. Etkinlikler Çiftlik → Etkinlik'te.
- **Panel sekmeleri (Çiftlik · Pazar · Köy · Ben):** çiftlikteki eylem çubuğuyla aynı aile; kabarık krem kartlar, renkli ikon kareleri, seçili sekme parlak yeşil ve yükselmiş.
- **Balık tutma her yerden:** 🎣'a basınca oyun hemen açılır; haritada su aramak gerekmez. Olta oyuncunun bölgesinin suyuna atılır (ilk tarlasının ili, yoksa memleketi; kıyı ilinde deniz, değilse göl/nehir). Belirli bir suya ait nokta gelirse yine oraya.

## v0.42 — rakip oyun araştırmasından: yöre setleri, İmece, yardım istekleri, pazar gazetesi; fazlalık temizliği

Tür oyunları (kasaba/çiftlik kurma, harita üzerinde arazi oyunları) ve kendi özellik dökümümüz karşılaştırıldı; aşağıdakiler uygulandı.

- **Yöre setleri** (`koleksiyon.js`, Ben → Arazilerim): 11 tarım yöresi, her biri üç il (Kapadokya, Çay ve fındık kıyısı, Ege zeytinliği…). Setin her ilinde arazin varsa o illerdeki hasadın %10 artar; set ilk tamamlanınca 120 akçe ve rozet. 8 parsel sınırı yüzünden hangi seti kovalayacağın bir yatırım kararı.
- **İmece** (`imece.js`, Çiftlik → Komşular): bir komşunla haftalık ortak hedef. İkinizin işleri ortak puana yazar; 150/400/800 puanda ödül (en az 30 puan katana). Pasif ortak bırakılabilir, haftada en çok 2 imece; demo komşuyla da yapılır (yalnız oynayan da imece yapsın).
- **Kooperatif yardım istekleri** (`yardim.js`, Ben → Kooperatif): "10 buğday lazım" isteği; üyeler envanterinden gönderir, yardım eden TP, yol ve yarış puanı alır (akçe aktarılmaz). Tek istekte en çok 20, üye başına tek açık istek ve 4 saat bekleme, günde en çok 5 gönderim.
- **Pazar gazetesi** (`gazete.js`, Pazar → 📰 Bugün, artık Pazar'ın ilk sayfası): Türkiye endeksi, en çok değer kazanan mahalleler, yöre setini tamamlayacak illerdeki ilanlar, kooperatifte bekleyen istekler, tüccarın iyi fiyat verdiği ürünler, yeni ilanlar ve son satışlar.
- **Fazlalık temizliği:** mahalle köy yarışması kalktı (tek haftalık yarış hasat yarışı; Çiftlik sekmesinde kısa özeti); çarşı marketinin tüccarla aynı ürün alımı kalktı (Pazar → Tüccara sat'a yönlendirir); il ligi rozeti isteyen altın çatı ve "İl Şampiyonu" unvanı artık hasat yarışında ilk üç ilin rozetiyle açılır; tanıtım sayfası, e-posta ve bildirim metinlerindeki kredi/seçim/il ligi sözleri güncellendi; balık (3) ve çarşı (4) seviye kilitleri sunucuda da denetlenir.

## v0.41 — sadeleştirme: siyaset ayarla, kredi yok, tek haftalık yarış

- **Siyaset ayarla açılır** (`OZELLIK.siyaset`, ortam değişkeni `SIYASET=acik`): muhtarlık ve belediye seçimleri, meclis projeleri, referandum ve görevden alma yeterince gerçek oyuncu olunca anlam kazanır. Kapalıyken (varsayılan) seçim/proje/referandum döngüleri ve demo sakinlerin siyaseti durur, uçlar 404 döner, Köy sekmesinde Yönetim yok, haritada seçim ve belediye işaretleri yok, haber akışında siyasi olay görünmez, "Mahalle seçiminde oy kullan" başlangıç görevi listelenmez. Daha önce tamamlanmış belediye hizmetleri (sulama kanalı, yol bakımı…) etkisini sürdürür. Testler siyaseti açık çalıştırır; kapalı hâli `test/siyaset.test.js` sınar.
- **Banka kredisi kaldırıldı:** değer aktarma açıkları üretiyordu ve oyuna katkısı azdı. Banka yalnızca vadeli hesap; gecikmiş kredi engelleri ve kredi bakımı da gitti.
- **İl ligi hasat yarışına katıldı:** ayrı 28 günlük il ligi yerine tek haftalık yarış. Oyuncunun işleri hem kooperatifine hem iline (memleketi; seçmediyse ilk tarlasının ili) puan yazar; kooperatifi olmayan da yarışır. İl puanı = toplam ÷ √oyuncu; ilk üç ilde en az 30 puan katanlara 40/25/15 akçe. Haberler → 🏁 Hasat yarışı.

## v0.40 — köy meydanı, sezon yolu, hasat yarışı, motif bulmacası, gece-gündüz

Tür özellikleri (kasaba büyütme, takım yarışı, ödül yolu, eşleştirme bulmacası) kendi Türkiye temamızla uyarlandı.

- **Köy meydanı** (`koy-meydani.js`, Çiftlik → 🏛️ Meydan): çeşme, kahvehane, köy pazarı, okul, sağlık ocağı, halk kütüphanesi ve postane. Her bina oyuncu seviyesiyle açılır, akçe ve çiftlik ürünüyle kurulur, inşaat süresi dolunca kalıcı bonus verir (ucuz sulama, sipariş ve görev ödülü, tüccar satışı, TP, bakım indirimi, sipariş panosuna +1 müşteri). Kurulan binalar çiftliğin güneyindeki meydanda 3B görünür; meydan açılınca kamera oraya kayar.
- **Sezon yolu** (`mevsim-yolu.js`, Çiftlik → 🛤️ Yol): her mevsim ücretsiz 30 kademe. Oyun işleri yol puanı verir (aynı işten günde en çok 15); kademelerde akçe, yem, kalıp seti, bakım kiti, tarla örtüsü ve yalnızca yolda kazanılan bayrak, bakır çatı ve unvan.
- **Kooperatif hasat yarışı** (`hasat-yarisi.js`): haftalık takım yarışı; üyelerin işleri takım puanına eklenir, bakır/gümüş/altın sandıklar en az 30 puan veren üyelere dağıtılır, Türkiye'de ilk üç kooperatifin kasasına bonus.
- **Motif bulmacası** (`bulmaca.js`, Çiftlik → 🧩 Bulmaca): nar, lale, çini, başak, nazar ve fındık taşlarıyla 3'lü eşleştirme. Dörtlü eşleşme şerit, L/T biçimi bohça, beşli rozet bırakır; 4. bölümden sonra otlu kareler temizlenir. Bölümler sırayla açılır; sunucu en kısa süreyi ve hamle sınırını denetler, günde 8 bölüm ödül verir (akçe, her 5. bölümde gübre, her 10. bölümde kalıp seti) ve sezon yoluna puan yazar.
- **Çiftlikte gece-gündüz:** Türkiye saatine göre gündüz, altın saat, alacakaranlık ve gece; gökyüzü, ışık, sis, yıldızlar ve ay değişir, gece fenerler yanar (`?saat=21` ile denenebilir). Tarladaki Türk bayrağı dalgalanır.

## v0.39 — yayın öncesi uçtan uca denetim

Yeni bir oyuncuyla kayıttan ilk yapıya kadar telefon boyutunda oynandı; sunucu ve istemci kodu üç ayrı incelemeyle tarandı.

- **Yeni oyuncu akışı:** kayıt 2. adımda bitince kayıt penceresi ve açılış artık kapanıyor (eskiden telefon adımı sihirbazın ve çiftlik turunun altında açık kalıyor, oyuncu takılıyordu); adım çubuğu "Hesap · Profil · Çiftlik", telefon ve memleket isteğe bağlı (Ben → Hesabım). Tur: hedef listede ekran dışındaysa kendiliğinden kaydırılır (inşaat atölyesinde tel çit görünmüyordu), alt çubuğu örten sayfa kapanır, ekin olgunlaşınca Hasat düğmesi yenilemeden gelir, çiftlik açılamazsa tur 5 denemede kapanır; tur ödülü ayrı bildirim yerine kartta rozet. Görev şeridinin 7. adımı "Bir komşuyu ziyaret et" (komşuluk seviye 3'te açıldığı için eski adım tamamlanamıyordu); "Komşu bul" yakındaki bir oyuncunun tarlasını açar.
- **Ekonomi açıkları kapandı:** dükkân ürünleri (ucuz yem paketi) sevkiyatla il pazarlarına satılamaz (sınırsız akçe); Hazine teklifinde satış sinyali yok ve endekse yalnızca değerin 0,5–2 katı satışlar girer (başka hesaplar arası yıkama işlemleriyle endeks şişirme); gelişme oranı mahallenin bütün arsasına bölünür ve yalnızca biten yapılar sayılır; talep yalnızca e-postası doğrulanmış oyunculardan; yapı yükseltmeleri değere yansır (`seviye`); başlangıç hediyesi en çok 25.000 m² ve Hazine'ye ancak 30 gün sonra satılır (`BASLANGIC`); Hazine ilanları pazarlık kabul etmez ve 100.000 üstü değerle ilana çıkmaz; bakımsız ev kira getirmez, devirde kira sayacı sıfırlanır; aynı eylem türünden günde en çok 20 TP kaydı; işçi en çok 7 gün; vadesi geçmiş kredisi olan oyuncu borcunu kapatmadan kira/parsel/ürün alımıyla değer aktaramaz; Hazine ile komşu olunmaz; sipariş ödülleri tam akçe.
- **Güvenlik ve KVKK:** passkey ekleme, Google/Apple bağlama ve 2FA kurma son 15 dakikada açılmış oturum ister; parolasız hesaplar taze oturumla hesabını silebilir; hesap silme hayvan/üretim/süs kaydı olan oyuncuda 500 veriyordu (`oyun.parseliBosalt`); kiradaki tarlanın sahibi silinince kiracıya kalan kira iade edilir; veri dışa aktarımına telefon, bağlı hesaplar, passkey, banka, balık, kozmetik, imzalar eklendi; çerez sayfası bütün depolama anahtarlarını listeler; oylama başladıktan sonra hesap silme ya da demo taşınması oy pusulasını değiştirmez.
- **Dayanıklılık ve hız:** imar/tarla karoları yalnızca Türkiye kutusunda hesaplanır (dünyanın her karosu diske yazılıyordu); giriş hız sınırı yalnızca kimlik gönderen isteklerde (açılıştaki GET sınırı tüketmiyordu); il ligi 60 sn, ürün borsası 5 sn önbellekte, yeniden sayım ağır sınırda; WebSocket IP başına 8, toplam 20.000 bağlantı; seçim ve belediye bakım taramaları daraltıldı; arka plan işleri hafif parsel kartı kullanır; Hazine hesabı açılışta oluşur. İstemci: `/api/ben` yalnızca 401'de çıkış sayar (ağ kesintisi oturumu kapatmıyordu), ağ hatası Türkçe, panel çizimi sıralı ve hatada "Tekrar dene", çiftlik açılamazsa parsel kartı açılır, memleket doğru alandan okunur, sulama bekleme süresi düğmede.
- **Metin ve görünüm:** "Seviye 2'de / 3'te" sayı ekleri (`sayiBulunma`), "Ahmet'in çiftliği" iyelik eki, cüzdanda okunur tanıtım ödülü adları, "aday çıkmadı" duyuruları haber akışını doldurmuyor, bildirimler en çok 3 ve çiftlikte eylem çubuğunun üstünde, tapu mührü ve geri düğmesi çakışmıyor, büyük dokunma hedefleri (40 px), erişilebilir giriş alanları, Hasan Dayı ağzıyla kalan metinler temizlendi, eksik çevrimdışı dosyalar önbellekte.

## v0.38 — Hazine alım teklifi (kâr her zaman akçeye döner)

- **Hazine'ye sat:** oyun, sahibine her parsel için **tahmini değerin %85'i** kadar anında alım teklifi verir (parsel kartında "🏛️ Hazine alım teklifi", "Satarsan kâr/zarar ₳X", onaylı "Hazine'ye sat"). Akçe hemen hesaba geçer (`SYS:MINT`), parsel yapıları ve süsleriyle "Sanal Türkiye Hazinesi" hesabına geçer ve Hazine onu **bugünkü değeriyle** 7 günlük ilana koyar (süresi dolan Hazine ilanları bakımda yeniden açılır; teklifler demo kuralıyla %90'dan kabul). Aradaki fark oyundan çıkar. `POST /api/parsel/:id/hazineye-sat {teklif}` (görülen teklif değiştiyse 409), kartta `hazine` alanı, portföyde Hazine satışları gerçekleşen kâr olarak; fiyat geçmişinde "🏛️ Hazine aldı".
- **Kötüye kullanıma karşı:** parsel en az 3 gündür sahibinde olmalı; oyuncu günde en çok 1 parsel satabilir; ilanda, kirada, ekili ya da inşaatı süren parsel satılamaz. Teklifteki mahalle çarpanı **satıcının kendi parselleri, yapıları ve işlemleri hariç** hesaplanır (kendi çıkış fiyatını şişiremez). Hazine'nin elindeki parseller talep sayılmaz.
- **Tahsis artık güncel endeksle fiyatlanır:** boş parselin tahsis fiyatı = taban bedel × mahalle çarpanı (`oyun.tahsisFiyati`; başlangıç hediyesi de). Böylece "ucuz tahsis + 3 gün sonra Hazine'ye sat" bedava akçe üretmez; kazanç mahalle senden sonra değerlenirse ya da yatırımın değer katarsa gelir. Kurallar `rules.js` → `PIYASA.hazine`.

## v0.37 — oyun içi yatırım: endeks, fiyat geçmişi, portföy kâr/zarar

Parsel bir yatırım varlığı gibi oynanır: al, işle, değerlensin, sat. Akçe yine **nakde çevrilmez**; bunlar oyun içi göstergelerdir (`server/piyasa.js`, kurallar `rules.js` → `PIYASA`).

- **Değer artışı:** arsa değeri = tahsis bedeli × **mahalle çarpanı**. Çarpan üç sinyalden çıkar: talep (mahallede sahipli parsel + son 30 günde edinilenler), gelişme (mahalledeki yapı yatırımı / arsa bedeli) ve gerçek satışlar (son 30 günde işaretsiz satışların fiyat / satış anındaki değer medyanı; en az 3 satışta tam ağırlık, tek uç işlem endeksi oynatamaz). Sınır 0,6–3. Tahmini değer = arsa + yapılar (bakımla aşınır) + süsler. Boş parselde "edinirsen değeri bugün +₳X üstünde" notu: erken giren kazanır.
- **Bölge endeksi:** endeks = 100 × çarpan (100 = tahsis seviyesi). `deger_endeksi` tablosunda mahalle, ilçe, il ve Türkiye için günlük kare (ilçe/il/TR arsa bedeliyle ağırlıklı). Bakım işi bugünün karesini 10 dakikada bir tazeler; tablo boşsa son 30 gün sahiplik, yapı ve satış kayıtlarından yeniden hesaplanır (uydurma veri yok). **Pazar → 📈 Endeksler** (artık varsayılan): Türkiye endeksi grafiği, haftalık değişim, 30 günlük satış/hacim, portföy özeti, bu hafta en çok yükselen ve en değerli mahalleler, "nasıl hesaplanıyor".
- **Fiyat geçmişi:** parsel kartında mahalle endeksi grafiği ve tahsis/satış olayları (`/api/parsel/:id` → `piyasa`); satışta `trades.deger_ani` ve `carpan_ani` saklanır. Olağandışı fiyat işareti artık satış anındaki tahmini değere göre (yapılı parsel tahsis bedelinin çok üstüne satılabilir).
- **Portföy kâr/zarar:** maliyet = alış (sahiplik kaydındaki bedel) + o sahiplik boyunca yapılan yatırım (inşaat, yükseltme, süs); getiri = bugünkü değer + toplanan kira − maliyet. Arazilerim'de portföy değeri, toplam kâr/zarar ve parsel başına değer/getiri; satılan parseller için gerçekleşen kâr ("Satışlarım"). Kendi parselinin kartında alış/yatırım/kâr satırı (`getirim`). Uçlar: `GET /api/piyasa`, `GET /api/piyasa/endeks?tur=MAHALLE|ILCE|IL|TR&id=`, `GET /api/portfoy`.
- Çiftlikte komşu parsel sayfasında mahalle endeksi, haftalık değişim, mini grafik ve son satış. Grafikler kütüphanesiz SVG (`public/js/grafik.js`).

## v0.36 — görev şeridi (Hasan Dayı kalktı)

- **Rehber artık bir görev şeridi** (`public/js/rehber.js`, CSS `ciftlik.css` "görev şeridi"): sol alttaki 3B Hasan Dayı ve konuşma balonu kaldırıldı. Haritanın üstünde ince bir şerit sıradaki adımı söyler: ikon, "Adım 3/8 · +30 ₳", kısa eylem başlığı, **Göster ›** (spot ışığı aynen) ve 8 parçalı ilerleme çizgisi. Şeride dokununca adımın açıklaması, ödülü ve bütün **Başlangıç yolculuğu** listesi açılır. Adım bitince şerit 2 sn "✓ Adım tamam +ödül" gösterip sonrakine geçer. ✕ şeridi küçük bir "🐔 8/8" rozetine indirir (yeni adımda yeniden açılır). Başlangıç bitince şerit yalnızca okunmamış bir ipucu olduğunda görünür (✕ = anladım).
- Telefonda şerit varken 2B/3B seçici, hava ve etkinlik rozetleri onun altına iner (`body.gs-var`, `--gs`); masaüstünde şerit sol üstte durur.
- İlk giriş sihirbazındaki karakter yerine kendi çiftlik çizimimiz (SVG) geldi; metinler doğrudan oyuncuya hitap eder. `rehber3d.js` silindi.

## v0.35 — Ev ve keyif

- **Yeni yapılar** (inşaat atölyesinde "Ev ve keyif" bölümü en üstte): **Bağ evi** (tarım arazisine de yapılabilir, asmalı çardaklı), **Ahşap dağ evi** (A-çatı, seviye 2), **Villa** (iki katlı modern, teraslı, seviye 3), **Yüzme havuzu** (şezlong ve şemsiyeli), **Çardak** (tarıma da), **Oyun parkı** (kaydırak, salıncak, kum havuzu). Modeller `sevimli3d-yapi.js`; yerleşim `modeller.yerlesim` (tarım parselinde avluya, küçük yapılar köşelere).
- **Kira geliri:** konutlar (müstakil ev, bağ evi, dağ evi, villa, apartman, pansiyon) turistlere kiralanır; günlük kira birikir (en çok 2 gün), çiftlikten toplanır (`POST /api/yapi/:id/kira`, `gelisim.kiraDurumu`). Havuz kirayı %50, her yapı seviyesi %50 artırır. Çiftlik alt çubuğunda "💰 Kira" düğmesi, yapı sayfasında birikmiş kira.
- **Tek çiftlik gibi oynama:** çiftliğin çevresindeki oyuncuya ait araziler kayıtta ayrı kalır ama çiftlikte tek parça oynanır: alt çubuktaki Hasat / Sula / Ek hepsine birden işler ("Ek (2)": bütün boş arazilere aynı ürün, toplam bedel); komşu araziye dokununca o arazi yerinde açılır (hasat, sula, ek), başka araziye geçmek gerekmez. Uzaktaki arazilerde iş varsa "Tümü (n)".
- **Parsel sahibi ve tahmini değer:** çiftlikte başkasının ya da sahipsiz bir komşu araziye dokununca sahibinin adı, Ada/Parsel, alan, imar, **tahmini değer** (arsa + yapılar + süsler dökümü), satış ilanı, yapılar ve ekin görünür; "👋 Çiftliğini gez" ile o çiftliğe gidilir. Haritadaki parsel panelinde de aynı değer kutusu var. Değer `oyun.tahminiDeger`: arsa = birincil tahsis bedeli; her yapı inşaat maliyeti + seviye yükseltme bedelleri, bakım durumuna göre en çok %50 düşer; süsler (çit, yol, çiçek…) satın alma fiyatıyla. Kartta `deger` alanı.
- **Atölye düzeni:** yapılar türlerine göre bölümlü; **Peyzaj** atölyeden kalktı (Süsle menüsü aynı işi yapıyor; var olanlar durur, `gizli`).

## v0.34 — hız ve sağlamlık taraması

Ayrıntılar ve 100.000 oyuncu planı: `docs/olcekleme.md`. Yeni oyuncu yük testi: `npm run yuk-oyuncu -- <taban> <oyuncu> <sn>`.

- **Sunucu:** bakım işleri her istekten çıktı (`BAKIM_ARALIGI_MS`, varsayılan 1 sn; her iş ayrı korunur); SQLite `synchronous=NORMAL` + 27 dizin (`db.indeksleriKur`); herkese aynı uçlar kısa önbellekte (`server/lib/onbellek.js`, testte `ONBELLEK=kapali`); oturum yalnızca `/api` isteklerinde okunur; giriş/kayıt parola özeti eşzamansız; seviye atlamada boş bildirim gitmiyor.
- **Canlı kanal:** ileti bir kez metne çevrilir, bildirim yalnızca ilgili oyuncunun bağlantılarına, çevrimiçi sayıları toplu; istemci yalnızca ekrandaki olaylarda haritayı tazeler (4–6 sn birikimli); eski bağlantının kapanışı yenisini çevrimdışı göstermiyor.
- **İstemci:** çiftlik açıkken harita veri yüklemez ve 3B köy kurulmaz; harita %50 taşan alanı yükler, küçük kaydırmada yeniden istemez, değişmeyen yanıtta yeniden kurmaz; 3B köy canlandırması 15 sn dokunulmazsa durur; çiftlik telefonda 30/15 kare, masaüstünde 60/30; telefonda bulanık cam paneller yok; rehber avatarı boştayken ~8 kare; WebGL bağlamları kapanınca serbest; ortak geometriler sahne yenilenirken atılmıyor; biten sayaç sonsuz tazeleme döngüsü başlatmıyor; `/api/ben` yoklaması 2 dk; ülke ölçeği verisi (il sınırları, maske) köy görünümünde indirilmiyor; güneş/ışık yalnızca belirgin kaydırmada güncellenir.
- **Komşu arazi birleşimi:** parsel kartındaki komşular gerçek tarla hücrelerini (`tarla_hucreleri`) de hesaba katar: bir hücreyi oyuncunun gerçek tarlası kaplıyorsa orada "+" çıkmaz; tam sayfa çiftlikte o hücreler çiftliğin devamı olarak boşluksuz tarla çizilir (`cevre`: 5 × 5'in dış halkası). Çiftlik başlığına dokununca **Arazilerim** listesi açılır, araziler arasında geçilir.
- **Kaldırılan ölü kod/dosyalar:** eski gerçekçi açılış sahnesi (`tanitim3d*.js`), eski parsel modeli (`parsel3d.js`; tarla yardımcıları `tarla-geo.js`'e taşındı), 18 fotoğraf dokusu, `turkiye.jpg`, `turkiye.geojson`, `/deneme` sayfası, kullanılmayan CSS kuralları (≈3,4 MB).

## v0.33 — parsel panelinde 3B maket yok

- Paneldeki dönen 3B parsel maketi (`sahne3d.js`) kaldırıldı: telefonda haritayla birlikte ikinci bir 3B sahne çiziliyordu. Panel artık "Çiftliğime gir" / "… çiftliğini gez" düğmesi, Ada/Parsel no ve bilgilerle başlar.
- Fotoğraf ve paylaşım kartı tam sayfa çiftliğe taşındı (üst çubuktaki 📸). Maketteki "zaman yolculuğu" oynatması kaldırıldı (sunucudaki `/api/parsel/:id/zaman` ucu duruyor).

## v0.32 — ilk giriş sihirbazı, Çiftliğim ana ekran

- **Arsa sihirbazı** (`public/js/sihirbaz.js`, `css/sihirbaz.css`): yeni oyuncu (parseli yok) tam ekran karşılanır → il / ilçe / köy seçer (ya da "Sen seç") → o köyde 3 boş tarla (şekil önizlemesi, Ada/Parsel, alan, hediye değeri) → seçtiği arsa hediye olur → oyun içi tapu belgesi → çiftliğe gider.
- **Kilitli çiftlik turu**: yalnızca sıradaki düğme dokunulabilir (perde + halka + parmak): ek → sula → bekle (ilk ekin 1 dakikada) → hasat → pazarda sat (yarısı) → ilk yapı → günlük görevler → bitiş ekranı. Her adımın ödülü sunucudan; "Atla" her zaman var; sayfa yenilense de kalınan yerden sürer.
- **Sunucu** (`server/sihirbaz.js`): `GET /api/sihirbaz`, `POST /api/sihirbaz/odul` (adım denetim kaydından doğrulanır, bir kez), `POST /api/sihirbaz/bitir`; `users.sihirbaz_bitti_at`, `sihirbaz_odulleri`. Sütun ilk eklendiğinde parseli olan eski oyuncular sihirbazı görmez. `GET /api/baslangic/adaylar?ilce=&yer=` (3 aday, oyuncu için 1 saat hatırlanır) ve `POST /api/baslangic/tarla {parsel}` yalnızca bu adaylardan birini hediye eder.
- **Oyun içi Ada/Parsel no** (`server/harita/ada.js`): 16×16 hücrelik bloklar ada, bloktaki sıra parsel; kartta (`adaParsel`) ve portföyde. Gerçek tapu değildir.
- **İmar haritası kaldırıldı**: haritadaki renkli imar hücreleri (`imar-karo`) ve "İmar haritası" lejant kartı yok; parselin imar türü kartında yazar. Sunucudaki imar sınıflandırması ve `/api/karo/imar` ucu oyun kuralları için durur.
- **Sesler kapalı**: `public/js/ses.js` içinde `SESLER_KAPALI = true` — efektler, müzik ve ortam sesleri çalmaz, ses bağlamı kurulmaz, ayarlardaki Ses/Müzik seçenekleri gizli (yeni ses tasarımı gelene kadar). Telefondaki titreşim sürer; açmak için bayrak `false` yapılır ve `index.html`'deki `data-ses-ayari` satırlarından `hidden` kaldırılır.
- **Telefonda hız**: çiftlik açıkken harita ve 3B köy katmanı duraklatılır (`harita.duraklat`); çiftliğe girerken harita uçmaz, parsel maketi çiftlikten çıkınca kurulur. Telefonda (dokunmatik + dar ekran) çiftlik 1,5× piksel yoğunluğu, yumuşak gölgelenme (GTAO) yok, 1024 gölge haritası ve %45 çevre süsüyle çizilir (`MOBIL`, `sevimli-efekt.js`); harita "Dengeli" ayarı telefonda daha az ağaç/bina/araç ve saniyede 10 kare canlandırma kullanır (`TELEFON_DENGELI`, `dunya3d.js`).
- **Ana ekran Çiftliğim**: parseli olan oyuncu her girişte çiftliğinde açılır; çiftlikteki "Köy" düğmesi haritayı oyuncunun köyünde açar. Türkiye görünümü ana ekrandan kalktı (harita köy ölçeğinin altına, zoom 11'e, uzaklaşmaz); ileride ayrı bölüm olacak.

## v0.31 — iOS uygulaması (Flutter)

- `mobil/`: oyunu tam ekran WebView'de açan Flutter iOS uygulaması (açılış ekranı, çevrimdışı ekranı, dokunsal geri bildirim, kenardan kaydırınca geri, dış bağlantılar Safari'de). Ayrıntı: `mobil/README.md`.
- Web tarafı: `public/js/uygulama.js` uygulamayı tanır (`html.uygulama`), `ses()` efektleri telefonda titreşim de verir.
- **Emoji yedeği** (`public/js/emoji.js`): cihaz emoji yazı tipini çizemiyorsa (iOS Simülatörü, bazı eski Android/Windows) arayüzdeki emojiler, harita simgeleri ve 3B tabelalardaki emojiler `public/emoji/` altındaki Twemoji SVG'leriyle (CC-BY 4.0, atıf alt bilgide) değiştirilir; çizebilen cihazda hiçbir şey değişmez. Yeni emoji eklenirse dosyası aynı sürümden indirilmeli (`public/emoji/BENIOKU.txt`). Elle deneme: `localStorage['st-emoji-yedek']='1'`.
- Sunucu: HSTS ve `upgrade-insecure-requests` yalnızca `TABAN_URL` https ise gönderilir (http geliştirmede Safari/WKWebView CSS ve JS'i https'e yükseltip yükleyemiyordu).

## v0.30 — zenginleşen çiftlik sahnesi

- **Çevre:** düz zemin yerine lekeli, uzakta tepelere yükselen çayır; hücreler arasında toprak patikalar; boş şeritlerde ot tutamları, papatya/gelincik, taş ve çalılar; tepelerde korular, uzakta yavaş dönen bulutlar; ufka karışan uzaklık sisi ve yumuşak köşe kararması.
- **Ekinler ve tarlalar:** gür buğday (eğik saplar, iki tonlu uzun başak, dip örtüsü); tarlalarda toprak kesekleri ve kenar otları; gölette kumlu kıyı, derin su, nilüfer ve sazlar.
- **Yapılar:** evde panjur, denizlik, köşe taşları, mahya, kapı lambası; ambarda tahta kaplama ve rüzgârgülü; serada taban kirişi, kapı ve domatesler (yarım silindir örtü düzeltildi); su kulesinde çapraz destek ve merdiven.
- **Genişletme:** "+" rozetleri ekranda hep aynı küçük boyda; boş komşu tarlanın tamamına dokununca satın alma sayfası açılır, para yetmezse ne kadar gerektiği yazar. Komşu süs ekinleri "+N" tepkisi vermez.
- **Kır hayvanları (abartısız):** çiftliğin çevresindeki çimende iki tavşan (sekerek) ve bir kirpi dolaşır; yakında gölet varsa iki ördek yüzer. Dokununca kalp çıkar.
- **Harita = Çiftliğim:** haritadaki sahipli parseller artık Çiftliğim'deki gibi yuvarlak köşeli çimen yastık üstünde, kenarında ot tutamlarıyla çizilir (kahverengi dokulu kalın plaka ve ayrı harita çiti kalktı; çit yalnızca oyuncu tel çit kurduysa görünür). Izgara parseli de yamaçta arazi eğimine yatırılır.
- Haritadaki rüzgâr salınımı nesnenin kendi tabanına göre (arazi yüksekliğinde yeşil şeritler oluşmaz).

## v0.28–0.29 — sadeleştirme, görsel bütünlük, tutundurma

**Sadeleştirme**
- *Başlangıç tarlası* (`server/baslangic.js`, `POST /api/baslangic/tarla`): hiç parseli olmayan yeni oyuncuya hesap başına bir kez, memleketinin il merkezine (yoksa Konya Meram) en yakın boş tarla hediye edilir (tahsis bedeli kadar hediye akçe + olağan tahsis; ILK_PARSEL görevi biter). Hasan Dayı "Tarlamı al 🎁" der.
- *Çiftliğim ana ekran*: parseli olan oyuncu oturumun başında doğrudan tam sayfa çiftliğinde açılır; haritadayken sağ altta "🏡 Çiftliğim" düğmesi, çiftlikte "🌍 Dünya" düğmesi.
- *4 bölüm*: Çiftlik · Pazar (pazar + çarşı) · Köy (haberler + yönetim) · Ben; seçili parsel varsa başta "Parsel". Bölüm içinde alt sekmeler.
- *Seviyeyle açılanlar*: balık ve komşuluk 3, çarşı 4, köy yönetimi 5 (aday olmuş/makam taşımış oyuncuya açık); kilitli bölümde ilerleme çubuğu. Seviye atlayınca konfetili kutlama ve açılanlar.
- *Toplu işler*: çiftlikte birden çok tarla hasada/sulamaya hazırsa "Hepsi" düğmesi; hasattan sonra "aynısını yeniden ek".
- *Bildirimler*: "Senin için" ve "Köyden haberler" ayrı başlıklarda.

**Görsel bütünlük**: haritadaki 3B oyuncu parselleri de sevimli modellerle çizilir (`dunya-bina.js`); açılış ekranı sevimli 3B çiftlik (`tanitim-sevimli.js`; eski gerçekçi sahne `tanitim3d.js` duruyor); üst çubuk, alt şerit ve harita araç kutusu yeşil-beyaz oyun arayüzünde. Çiftlikte gerçek saate göre gündüz/akşam/gece (pencereler yanar), kışın kar yağar; arada kuş, horoz ve inek sesleri.

**Tutundurma** (`server/gelisim.js`)
- *Yapı yükseltme* (`POST /api/yapi/:id/yukselt`): 3 seviye, bedel = maliyet × hedef seviye × 1,5; barınaklar her seviyede +%50 ürün; yapının üstünde yıldız rozeti.
- *İşçi* (`/api/isci`, `POST /api/isci/tut {gun}`): gün başına ücret; süresince bütün tarlalarda olgun ekini hasat eder, susuz ekini sular, hayvanları yemler ve ürünü toplar (30 sn'lik sunucu döngüsü). Çiftlikte turuncu tulumlu ikinci çalışan dolaşır.
- *Günlük görevler* (`/api/gunluk-gorevler`): oyuncuya ve güne özgü 3 görev (hasat, ekim, sulama, hayvan ürünü, satış, sipariş; denetim kayıtlarından sayılır); hepsi bitince akçe + TP ödülü (günde bir kez). Çiftlik sekmesinin başında ve çiftlikte "🎯 Günlük".
- *Çiftlik genişletme*: çiftlikte yandaki boş tarım hücrelerinde zıplayan "+" işareti; dokununca tahsis bedeliyle çiftliğe katılır, komşu tarlaların yan yana çizilir ve aralarında geçilir.
- *Üretim zinciri çiftlikte*: değirmen, fırın, fabrika gibi tesislere dokununca reçeteler (Üret) ve süren partiler (Topla).
- *Komşu çiftliğini gezme*: başkasının parsel kartında "🏡 Çiftliğini gez"; ziyarette selam verilir, ekinine yardım edilir.
- *Koleksiyon haritası*: yöresel albümde Türkiye haritası (albümde altın, elinde yeşil, toplanacak açık yeşil).

## v0.27 — tam sayfa çiftlik (kendi parselinin içi)

Haritada kendi parseline dokununca kamera parselin içine girer ve tam sayfa, sevimli 3B bir çiftlik açılır (`public/js/ciftlik-ici.js`); başkasının parselinde eskisi gibi kart açılır. İçeriden oynanır: ekine dokun → sula / hasat et, boş tarlaya dokun → tohum seç ve ek, yapıya dokun → durumu, hayvan ürünü topla / yemle, bakım; boş alana dokun → inşaat atölyesi; süs dükkânı. Çiftçi dokunulan yere yürüyüp işi yapar, sonuç gelince "+N", uçuşan ürünler ve parıltı çıkar. Üstte geri düğmesi, parsel adı, seviye, bakiye ve ürün sayaçları; altta duruma göre değişen eylem çubuğu (hasat hazırsa nabız atar). Sürükle → döndür, tekerlek/çimdik → yakınlaş; Esc ya da telefonda geri tuşu haritaya döner. Eylemler paneldeki ortak dağıtıcıdan (`eylemDagit`, app.js) geçer; kurallar ve sonuçlar sunucudadır.

## v0.26 — yeni rehber: 3B Hasan Dayı

Sol alttaki rehber yenilendi (`public/js/rehber.js`, `public/js/rehber3d.js`, `public/css/ciftlik.css`): Hasan Dayı artık sevimli tarzda 3B bir karakter (kasket, gür beyaz bıyık, yelek); göz kırpar, nefes alır, konuşurken ağzı oynar, yeni adımda el sallar, adım bitince sevinip zıplar (WebGL yoksa eski çizim). Konuşma kartı: isim etiketi, yazılıyormuş gibi beliren metin (dokununca tamamlanır), 8 adımlık ilerleme çubuğu, adımın ödülü, büyük "Göster" düğmesi. "Göster" ekranı loşlaştırır, hedefi nabız atan altın halka ve zıplayan elle "Buraya dokun" diye gösterir. Hasan Dayı'ya dokununca görev listesi (tikli adımlar, ödüller, ilerleme). Başlangıç bitince akıllı ipuçları: olgun hasat, sulama bekleyen tarla, günlük ödül, seviye ödülü, boş tarla (önemliler kartı kendiliğinden açar, diğerleri kırmızı noktayla haber verir; her ipucu bir kez).

## v0.25 — sevimli çiftlik tarzı (panel maketi)

Sağ üstteki dönen parsel maketi sevimli, düşük poligonlu ve dokusuz bir çizgi film tarzına geçti: yeşil üstlü yuvarlak toprak ada, parlak düz renkler, sıcak güneş, yumuşak (VSM) gölgeler, yakın kadraj. Modeller sıfırdan bizim: `public/js/sevimli3d.js` (zemin, tarla, çilek/domates/mısır, ağaçlar, kasa, çit, tezgâh, çiftçi, traktör, ambar), `public/js/sevimli3d-yapi.js` (ev, apartman, pansiyon, dükkân, restoran, depo, fabrika, fırın, yel değirmeni, sera, su kulesi, güneş paneli, inşaat iskelesi, inek, koyun, tavuk, kümes, buğday/çay/pamuk/bağ/meyve ağaçları, süsler), `public/js/sevimli-parsel.js` (parseli yapı, ekin, süs, kozmetik ve gerçek tarla sınırıyla kurar; komşu hücreler). Sahipli parselde çiftçi bekler, yel değirmeni döner, bacalardan duman çıkar.

Üst seviye (v0.25.1): son işleme (`sevimli-efekt.js`: yumuşak gölgelenme GTAO, maket hissi veren tilt-shift, gökyüzü fonu, çok örneklemeli kenar yumuşatma); ayrıntılı modeller (kiremitli çatı, saksılı pencere, yuvarlak çatı penceresi, yüzü, askıları ve sallanan kol-bacakları olan çiftçi, ambar pervazları); canlılık (`sevimli-canli.js`: rüzgârda sallanan ekin ve ağaçlar, tarlada yürüyüp iş yapan çiftçi, dolaşan/otlayan inek ve koyunlar, gagalayan tavuklar, kelebekler, süzülen bulut gölgeleri); dokununca tepki (ekin, yapı, hayvan ya da çiftçi zıplar; "+N", uçuşan ürünler, parıltı ve ses — yalnızca görsel, oyun eylemi yapmaz). Haritadaki 3B dünya ve açılış ekranı henüz eski tarzda.

## v0.24 — gerçek tarlalar (deneme: Meram)

Deneme ilçesinde kare hücreler yerine uydudan görünen gerçek tarlalar parsel olur. Kaynak: [Fields of the World](https://fieldsofthe.world) (CC-BY-4.0) — Sentinel-2 görüntülerinden 10 m çözünürlükte çıkarılmış tarla sınırları. **Tapu/kadastro parseli değildir** (TKGM parsel sorgusu izinsiz otomatik erişimi ve ticari kullanımı yasaklar); bir tapu parseli birkaç tarlaya bölünmüş ya da birkaç parsel tek tarla görünebilir. Atıf haritanın köşesinde.

- Aktarım: `npm run tarla-aktar [-- 42:Meram,42:Selçuklu]` (varsayılan `TARLA_ILCELERI`, yoksa `42:Meram`). Türkiye PMTiles dosyasından yalnızca ilçeyi örten z13 karoları HTTP aralık istekleriyle indirilir (Meram: 306 karo, 10,6 MB; `data/ftw` önbelleği), işlenip veritabanına yazılır (Meram ≈ 20 sn, 44.079 tarla, ortanca ≈ 2.000 m²). Sunucu açıkken çalıştırılabilir.
- İşleme (`server/harita/tarla-ftw.js`, saf): karo sınırında bölünen tarlalar tampon bölgelerden birleştirilir (sınırları birleşik maskeden yeniden izlenir); her hücre merkezini içeren tarlaya atanır, merkezi tarlada olmayan hücreler kare parsel kalır; 10 m piksel basamakları Douglas–Peucker (≈ 7,5 m) ile düz kenara döner, köşeler en çok ≈ 6 m yuvarlanır (Chaikin); 400 m² altı ve 50 ha üstü (hatalı) alanlar atılır.
- Yeniden aktarımda üzerinde iş olan (sahipli, ekili, yapılı, ilanlı) tarlalar ve kare parseller korunur; tarlası kalmayan sahipsiz tarla parselleri hücre karesine döner.
- Oyun motoru değişmez: tarla bir parseldir; kimliği merkeze en yakın hücresinin kimliği, alanı tarla alanıdır (verim, fiyat ve TAKS alanla ölçeklenir). Tarlanın herhangi bir hücresine yapılan istek tarlaya yönlenir (`parselHazirla` asıl kimliği döndürür).
- Harita: tarlalar ekili/anız/sürülmüş/nadas tonlarında yama deseniyle çizilir, tarla hücrelerinde ızgara ve imar karosu boş kalır; üzerine gelince ve seçince tarlanın kendi sınırı vurgulanır. Tarla verisi sıkıştırılmış karolar hâlinde gelir (`/api/harita/tarla/:kx/:ky`), birden çok karoya yayılan tarla bir kez çizilir.
- 3B: tarla modeli tarlanın uzun kenarına döndürülür ve arazi eğimine (köşe yüksekliklerine uydurulan düzlem) yatırılır; toprak, ekin sıraları, bağ telleri ve sahip çiti sınırı izler. Panel maketi tarlayı kendi biçimiyle gösterir.

## v0.23 — oyun paneli yeniden tasarım

Sağ panelin yedi sekmesi (Parsel, Arazi, Yönetim, Çiftliğim, Çarşı, Pazar, Haberler) giriş penceresiyle aynı modern oyun arayüzüne geçti (`public/css/panel.css`, yalnızca `.panel` içini etkiler): ikonlu ve tek satıra sığan sekme çubuğu, açık yeşil-gri zemin, beyaz yuvarlak kartlar, ikon kutucuklu liste satırları, Lilita One başlıklar, sade bölüm başlıkları, yeşil oyun düğmeleri (altın: satış/ödül), hap biçimli alt sekmeler, istatistik kutucukları, tablolar, açılır bölümler, formlar, ilerleme çubukları; çarşı işletme kartları, haber akışı, süs dükkânı, sipariş panosu, günlük ödül, köy yarışması ve banka özeti aynı dile çekildi.

## v0.22 — ayrıntılı parsel modelleri (harita ve panel maketi)

- `public/js/parsel3d.js`: paneldeki dönen maket ve haritadaki 3B dünya aynı ayrıntılı modeli çizer. Ekinler gerçek bitki modelleriyle, büyümeye göre boy atar ve olgunlaştıkça renk değiştirir: sıra sıra buğday, kazıklı domates, düz kesilmiş çay çitleri, pamuk kozaları, telli bağ ve üzüm salkımları, meyveli elma/kayısı/fındık/zeytin ağaçları. Tarla zemini sürülmüş toprak dokusu (karık normal haritalı). Yapılar: cumbalı köy evi, ahır, oluklu silo (su deposu), alüminyum çerçeveli cam sera (içinde fide sıraları), eğik güneş panelleri, tel çit, damla sulama boruları ve pompa, kümes ve tavuklar, ağıl ve koyunlar, inek ahırı ve inekler, peyzaj ağaçları. Ayrıntılı modeli olmayan yapılar ve süsler eski parça tanımlarıyla çizilir.
- Panel maketi: komşu hücrelerde rastgele ekinli tarlalar, ağaçlı orman/park, köy evli konut; kaidede katmanlı toprak kesiti; gerçek gökyüzü ışığı (HDRI), 2048 gölge haritası.
- Harita 3B katmanına da gökyüzü ışığı (HDRI ortam haritası çizim sırasında üretilir; MapLibre'nin GL durumu bozulmaz).

## v0.21 — tam ekran harita, katlanır panel

- Masaüstünde sağ panel haritanın üstünde kayan, katlanır bir çekmece (sağ kenardaki "Oyun paneli" tutamacı). Kapalıyken Türkiye bütün pencereyi kaplar; bir yer seçilince ya da sekme açılınca panel kendiliğinden açılır. Elle açma/kapama tercihi hatırlanır (`st-panel`), varsayılan kapalı. Harita sığdırmaları açık panelin payını hesaba katar.
- Ülke ölçeğinde Türkiye harita alanını kenardan kenara doldurur; imar lejantı yalnızca yakın planda (z ≥ 11) görünür.
- Açılış sayfasındaki "gerçek harita uçuşu" bölümü (v0.16) kaldırıldı: oyunun 3B haritasını sayfa içinde çalıştırmak ağırdı ve takılıyordu.
- Açılış sahnesinde ön planda, yol kenarında 22 m'lik gönderde Türk bayrağı: resmî ölçülerle 2400×1600 doku (uçkur, dikiş izi), dokuma normal haritası ve kumaş parlaklığı (sheen). Dalgalanma gerçek kumaş fiziği (Verlet: yapısal/çapraz/bükülme bağları, rüzgâr basıncı, hava sürüklemesi, ileri giden girdap, yer çekimi); rüzgâr gücü Konya'nın gerçek rüzgârından. Gönderde makara, altın alem, halat ve iki basamaklı taş kaide. Masaüstünde sol tarafta, telefonda orta bantta görünür; kamera salınımı bayrak kadrajda kalacak kadar daraltıldı.

## v0.20 — dallı ağaçlar, leylekler, uçak; yalnızca Türkiye haritası

- **Ağaçlar** (`agacUret` in tanitim3d-model.js): gövde ve dallar özyinelemeli üretilir (kabuk dokulu konik silindirler), dal uçlarında yaprak kümeleri; ceviz, meyve, söğüt (sarkık), kavak (sütun, ekimde sararır), karaçam (katlı). Her türün üç ayrıntılı ve bir uzak çeşidi; uzaktakiler sade çizilir. Yaprak saydamlığı uzaklıkla (mip) korunur, taç seyrelmez.
- **Gökyüzü yaşamı:** termikte süzülen leylek sürüsü (beyaz gövde, siyah kanat uçları, kırmızı gaga ve bacaklar), elektrik direğinde leylek yuvası ve gagasını takırdatan leylek, arada bir geçen markasız yolcu uçağı ve iz bulutları (gece kırmızı ışık).
- **Oyun haritası yalnızca Türkiye:** ülke ölçeğinde Türkiye dışı tamamen örtülür (Türkiye denizle çevrili bir ada gibi), yakına inince örtü açılır; harita dünyaya kaydırılamaz (`maxBounds`, en düşük yakınlık 4). Adres çubuğunda ülke ölçeğinde kalmış eski `#konum` açılışı bozmaz; açılıştan oyuna dönünce Türkiye ekrana yeniden sığdırılır ve görünüm düz 2B başlar.

## v0.19 — sinematik açılış sahnesi

- **Son işleme** (`public/js/tanitim3d-efekt.js`): MSAA'lı HDR çizim, güneş ve parıltılarda ışıma, renk derecelendirme, köşe kararması, film greni, ön planda alan derinliği. three.js ekleri sunucuda `/vendor/three-ek/` altından, yalın `'three'` içe aktarımı mutlak yola çevrilerek servis edilir.
- **Bulutlar:** güneşe doğru örneklenen ışık geçirgenliğiyle hacimli görünen kümülüs (koyu taban, gümüş kenar), yüksek sirrus tülleri; gün batımında sıcak ufuk bandı.
- **Fotoğraf dokuları** (`public/img/doku/`, Poly Haven, CC0; 1024 px renk + 512 px normal ve AO/pürüzlülük, toplam ~2,4 MB): sıva, moloz taş, kil kiremit, boyalı tahta (ahır), oluklu sac (ahır çatısı, silo), zeminde yakın ayrıntı. Gündüz ortam ışığı ve yansımalar "Autumn Field" HDRI'sinden. Dosyalar yüklenene kadar prosedürel dokular görünür.
- **Ön plan:** buğday arasında gelincik ve peygamber çiçekleri, kelebekler, elektrik telinde serçeler.
- **Hareketi azalt** tercihinde de 3B sahne çizilir; yalnızca kamera sabit durur. Yerel geliştirmede `?tn_saat=17.5` ile günün saati denenebilir.

## v0.18 — gerçekçi 3B açılış sahnesi

`public/js/tanitim3d-model.js`: tuvalde üretilen dokular ve normal haritaları (sıva, moloz taş, alaturka kiremit, boyalı tahta, oluklu sac, yaprak atlası); cumbalı Anadolu köy evi (taş zemin kat, sıvalı üst kat, ahşap kiriş ve payandalar, kırma kiremit çatı, güneş enerjili su ısıtıcısı, çiçekli pencereler, uydu çanağı), tahta ahır ve sac çatı, oluklu silo, kanat profilli ve bükümlü kanatlı rüzgâr türbinleri (gece kırmızı ikaz ışığı), yaprak kartlı ağaç taçları (kavaklar sonbaharda sararır). Dağlar sırtlı gürültüyle ve eğime göre bozkır/orman/kaya/kar renkli. Gökyüzü ortam yansıması (PMREM) camlarda ve metalde görünür. Masaüstünde kamera çiftliği OYNA düğmesinin sağında tutar; telefonda logo üstte, düğmeler altta.

## v0.17 — oyun açılış ekranı

İlk ekran artık bir oyun açılışı: tam ekran canlı 3B çiftlik, ortada büyük "Sanal Türkiye" logosu (Lilita One, kurdeleli), kocaman yeşil **OYNA** düğmesi, altında "Giriş yap · Kayıt ol". Giriş/kayıt kartı (giris-ui.js) ayrı, beyaz, sade bir pencerede açılır (`.tn-giris-modal`): ✕, dışına tık ya da Esc ile kapanır. İlk ziyarette yalnızca açılış ekranı görünür (`ac(…, { kartGizli: true })`); oyunun içinden açılan giriş (`{ oyundan: true }`) kapatılınca oyuna döner. Giriş yapmış biri OYNA'ya basınca doğrudan oyuna geçer. Üst çubuk sayfa kaydırılınca belirir.

## v0.16 — gerçek zamanlı 3B açılış

- **3B kahraman** (`public/js/tanitim3d.js`, three.js, dış doku/model yok): Anadolu ovasında bir çiftlik. Rüzgârda dalga dalga eğilen buğday tarlası (42 bin öbek, telefonda 11 bin), salınan kavak, ceviz, söğüt ve karaçamlar, akan dere (kendi su gölgelendiricisi), sürülmüş/anız/yonca tarla yamaları, köy evi, ahır, silo, saman balyaları, otlakta inek ve koyunlar (otlar, dolaşır), yolda römorklu traktör ve tozu, bacadan duman, elektrik telleri, rüzgâr türbinleri, uzakta köy ve camii, karlı dağlar, kuş sürüsü, tarlalarda kayan bulut gölgeleri. Güneş Konya'nın gerçek güneş konumundan, bulut/yağmur/rüzgâr Konya'nın gerçek havasından (`/api/tanitim` artık `kod` ve `ruzgar` da verir); gece pencereler ve kapı lambası yanar. Kamera drone gibi süzülür; fare ve kaydırmayla kayar. Yavaş cihazda çözünürlük ve buğday kendiliğinden düşer; WebGL yoksa ya da hareket azaltılmışsa SVG manzara kalır.
- ~~Gerçek harita uçuşu~~ (v0.21'de kaldırıldı).

## v0.15 — zengin açılış sayfası

Giriş yapmamış ziyaretçi artık kaydırılabilir, tam bir tanıtım sayfası görür (`#acilis`, `public/js/tanitim-ui.js`, `public/css/tanitim.css`):

- **Kahraman:** elle çizilmiş katmanlı SVG çiftlik manzarası (dönen yel değirmeni, bacadan duman, uçan kuşlar, yürüyen traktör, hayvanlar); fareyle ve kaydırmayla derinlik efekti; İstanbul saatine göre gündüz / akşam / gece gökyüzü. Dönen başlık ("çiftliğini kur. / tarlanı ek. / göle olta at. …"), sayan sayaçlar, büyük şehirlerin anlık havası; sağda hesap kartı (giris-ui.js).
- **Canlı veriler:** `GET /api/tanitim` (server/tanitim.js, 60 sn önbellek, kişisel veri yok): 24 saatlik hasat/ekim/balık sayıları, son olaylar (yalnızca yer + eylem, oyuncu adı yok), 8 büyük şehrin havası, süren etkinlik, yöresel ürünler, sponsorlar.
- **Bölümler:** "Şu an Türkiye'de" kayan şeridi, 4 adımda nasıl oynanır, oyun içi ekran görüntüleriyle vitrin (`public/img/tanitim/`), etkileşimli 81 il haritası (üstüne gelince yöresel ürün, hava, çiftçi/tarla sayısı; "Bu ilde başla" kayıtta memleketi önceden seçer), özellikler, yöresel ürün şeridi, sponsorlar (varsa), SSS, kapanış çağrısı.
- Kaydırınca beliren bölümler, `prefers-reduced-motion` desteği, telefonda tek sütun.

## v0.14 — giriş ve üyelik

- **Tam sayfa açılış:** canlı çiftlik sahnesi + kart; Google, Apple, passkey ya da e-postayla devam; "önce haritayı gez".
- **Adım adım kayıt:** (1) hesap — e-posta + parola (güç göstergesi) ya da şifresiz passkey, (2) profil — oyuncu adı (anlık
  uygunluk; Türkçe büyük/küçük harf duyarsız benzersiz), avatar oluşturucu (ten, saç, başlık, giysi), doğum yılı, onaylar,
  (3) telefon doğrulama (isteğe bağlı), (4) memleket (liste ya da konum). Google/Apple/passkey ile ilk gelen oyuncu bir kayıt
  taslağıyla 2. adımdan devam eder.
- **Google ve Apple** (OpenID Connect, state + nonce + tarayıcı bağı, Google'da PKCE, JWKS imza denetimi), **passkey**
  (`@simplewebauthn/server`), **telefon** (SMS kodu; geliştirmede kod ekranda, üretimde Netgsm). Hesabım → Güvenlik → Giriş
  yolları: Google/Apple bağla, passkey ekle/sil, telefon doğrula, parolasız hesapta parola belirle; Oyun ayarları → avatar.
- Önceden ele geçirmeye karşı: doğrulanmamış hesabın e-postasının sahibi (Google/Apple ya da sıfırlama bağlantısıyla) hesabı
  devralınca diğer giriş yolları ve oturumlar silinir.
- Kurulum: `docs/giris-yollari.md`. Sağlayıcı ayarları yoksa o düğmeler görünmez; üretim denetimi eksikleri uyarır.

## v0.13 — Çarşı: banka, nalbur, market, zirai bayi (sponsorluğa hazır)

Gerçek hayattaki gibi işletmeler; **her türden oyunda tek işletme** vardır (sponsorluk anlaşması için). Anlaşma yapılana kadar
varsayılan adla çalışır (Sanal Banka, Usta Nalbur, Mahalle Market, Bereket Zirai Bayi). Sözleşme imzalanınca yönetici
**/yonetim.html → Sponsorlar** sekmesinden markanın adını, simgesini, logosunu (PNG/JPEG/WebP ≤150 KB; SVG kabul edilmez),
renklerini, sloganını, web adresini ve sözleşme başlangıç/bitiş tarihlerini girer; "Sponsor" işaretliyse oyunda **Sponsor**
etiketiyle görünür, bitiş tarihi geçince kendiliğinden varsayılan adına döner. Sponsorun gerçek şube listesi (`ad;enlem;boylam`)
yüklenebilir; yüklenene kadar her il başkentinin merkezinde bir şube (koordinatlar `server/harita/il-merkezleri.js`, il sınırında doğrulanır).

| İşletme | Ne var | Oyundaki etkisi |
|---|---|---|
| Banka | 7 günlük vadeli hesap (%2,5, toplam ≤ ₳10.000; bozdurursan getirisiz), 7 günlük kredi (%6; limit seviye + parsel + ödeme geçmişi; gecikmede günlük %1, en çok %20; vade geçince bakiyeden tahsil), kredi notu | 18 yaş altı ve 3 günden yeni hesap kredi alamaz; e-posta doğrulaması gerekir. Akçe nakde çevrilmez; gerçek bankacılık hizmeti değildir |
| Nalbur / hırdavat | Kalıp seti, bakım kiti, tarla örtüsü, karbon kamış, örgü misina, sahte yem (rapala) | İnşaat %30 kısa; bakım ücretsiz; örtü stoktan; mücadelede sarma %20 hızlı; misina dayanımı +%12; sahte yemle atış ücretsiz (misina koparsa yem gider) |
| Market | Hayvan yemi (20), karides yem (10), mısır yem (10); ürününü markete sat | Paketler tek tek almaktan ucuz; satış NPC pazarının günlük sınırlarıyla |
| Zirai bayi + veteriner | Gübre, bitki koruma ilacı, hayvan aşısı | Hasat +%20; ekin don/dolu/sağanaktan korunur; barınak 7 gün her toplamada +1 ürün |

Dükkân ürünleri envantere girer, bozulmaz, NPC tüccara satılmaz. Çarşı sekmesi ve haritada şube simgeleri (tıklayınca dükkân açılır).
Uçlar: `GET /api/carsi`, `/api/carsi/:kategori`, `/api/carsi/subeler`, `POST /api/carsi/satin-al`, `/api/carsi/kullan`,
`/api/banka` (+ `vadeli`, `vadeli/:id/kapat`, `kredi`, `kredi/ode`), yönetici: `GET /api/yonetim/isletmeler`, `PUT /api/yonetim/isletme/:kategori` (+ `/subeler`).
Hukuki notlar: `docs/hukuk-kontrol-listesi.md` madde 11.

## v0.11 — gerçek hava oyunun içinde

v0.6'dan beri her ilin anlık havası (Open-Meteo) çekiliyor; yağmur açık tarlayı suluyor, don hassas ekine zarar veriyor, fırtına/sağanak/dolu/aşırı sıcak afet sayılıyor. v0.11 bunu oyuncunun önlem alabildiği bir döngüye çevirir:

| Alan | Ne var | Nerede |
|---|---|---|
| Tahmin ve erken uyarı | Aynı Open-Meteo isteğiyle önümüzdeki 12 saat (saatlik) ve yarın (günlük) çekilir. 12 saatte don, dolu ya da sağanak bekleniyorsa o ilde etkilenecek ekini olan oyuncuya tek bildirim gider (aynı risk 12 saatte bir; sera ya da örtü varsa gitmez; don yalnızca hassas ürün için). Haritada il sıcaklığının yanında risk simgesi | `server/iklim.js` → `uyarilariGonder`, `server/dunya.js` → `tahminCikar` |
| Tarla örtüsü | ⛺ 4 akçe × verim katı; 12 gerçek saat dona, doluya ve sağanağa karşı korur; seralı tarlada gerekmez; 3B'de tarlanın üstünde beyaz tünel | `POST /api/parsel/:id/ortu` |
| Güneş | Açık/az bulutlu, 12–32° bir gündüzde ekilen açık tarla %15 hızlı büyür (ilin taze ölçümü) | `dunya.buyumeKati(…, plaka)` |
| Rüzgâr | İl merkezinde rüzgâr 20 km/s'yi geçince değirmen %25 hızlı öğütür | `server/uretim.js` |
| Kuraklık dengesi | Son 7 günde ölçümlerin %10'undan azı yağışlıysa ilde elle sulama %30 ucuz (yağmur bedava suladığından kurak il geride kalmasın); ölçüm geçmişi `hava_gecmisi` | `iklim.kuraklik` |
| Afet desteği | 7 günde ikinci kez afetten etkilenen, e-postası doğrulanmış ve en az 7 günlük hesaba haftada bir ₳40 | `iklim.afetEtkilenenleri` |
| Arayüz | Haritanın üstünde çiftliğinin ilinin havası ve "N tarla risk altında" şeridi; tıklayınca iller, riskler, tehdit altındaki tarlalar (örtü ser / git) ve kurallar; parsel kartında 12 saatlik risk, yarın, güneş/kuraklık rozetleri ve örtü satırı; açık gece güneş yerine ay | `hava-ui.js` |

Hava verisi alınamazsa oyun tahminsiz devam eder: uyarı gitmez, güneş/rüzgâr bonusu verilmez, kimse ceza almaz.

Aynı sürümde arayüz:
- Oyun dünya küresi uçuşu olmadan doğrudan düz (2B) Türkiye görünümüyle açılır; kayıtlı 3B tercihi yalnızca konumlu bağlantıda uygulanır.
- Ülke haritasında 25 ilin coğrafi işaretli ürün simgesi (il adının üstünde); il kartında yöresel ürün ve anlık hava.
- Canlı dünya baloncukları: başka bir oyuncunun (demo sakinler dahil) görünür alandaki ekim, hasat, parsel edinme, yapı, üretim, komşu yardımı ve yöresel üretimi o parselde 3 saniyelik balonla görünür (aynı anda en çok 6; DOM işaretçisi, haritayı yeniden çizdirmez). Canlı olay parsel kimliğini taşır, eylemi yapanı taşımaz (`ben` yalnızca alıcının kendisi mi).
- Balık tutma 3B (v0.12): iskeleden göl ya da deniz (three.js; su ve gökyüzü kendi gölgelendiricilerimizle: dalga normalleri, Fresnel yansıma, güneş parıltısı, şamandıra/balık halkaları). Gökyüzü yerin gerçek güneş konumuna göre gündüz/alacakaranlık/gece (ay, yıldız, iskele feneri), bulut, yağmur, kar ve sis ilin gerçek havasından. Türlere göre 3B balık modelleri (sazan pullu altın, alabalık benekli-pembe bantlı, levrek, lüfer, çipura altın alınlı, hamsi, kefal, altın balık). Takım: yem (solucan, mısır ₳1, karides ₳3, sahte yem ₳5), derinlik ve misina (ince: çok vurur ama kolay kopar; kalın: dayanıklı ama balık ürker); tür olasılığı ve vuruş hızı seçilen takıma göre önceden gösterilir. Balık aktivitesi gerçek saat (şafak/akşam iyi, öğle/gece durgun) ve havaya göre. Basılı tutup bırakarak atış gücü; türün davranışı mücadeleyi değiştirir (inatçı, kaçak, sıçrayan, çevik). WebGL yoksa 2B yedek (`balik-2b.js`). Sunucu: `GET /api/balik/ortam`, `GET /api/balik/takim`, atışta `yem/derinlik/misina` (`server/balik.js`, `rules.js` → `BALIK`).
- Balık tutma yeniden: göl/deniz sahnesi, su altında yüzen balıklar, olta atışı, yalancı vuruşlar, ısırınca "Çek!" ile oltaya takma ve makara mücadelesi (basılı tut = sar; gerginlik yeşilde kalmalı, kırmızıda misina kopar, gevşekte balık kaçar; güçlü tür daha sert çırpınır), balık sudan sıçrayarak çıkar, tür/kg/kişisel rekor kartı. Sunucu: `cek` artık balığı oltaya takar (TAKILDI, yalnızca güç söylenir), `POST /api/balik/:id/cikar` mücadele sonucunu alır; en kısa mücadele süresi (taban + güç × adım) ve 60 sn üst sınır sunucuda; tür ve ağırlık çıkınca söylenir (`balik-ui.js`, `server/balik.js`).
- E-posta doğrulama şeridi üst çubukta küçük bir "📧 E-postanı doğrula" rozetine dönüştü; tıklayınca açıklama ve yeniden gönder açılır.

## v0.10 — rehber, komşuluk, yöresel ürünler, etkinlikler, balık

| Alan | Ne var | Nerede |
|---|---|---|
| Rehber | Görev şeridi yeni oyuncuya 8 adımda yol gösterir; adım ilk görevlerin durumundan çıkar, "Göster" haritayı uçurup ilgili düğmeyi ışıkla vurgular; yakındaki boş tarlayı önerir (`/api/oneri/tarla`); Hesabım → Oyun ayarları'ndan yeniden başlatılır | `rehber.js`, `server/hatirlatma.js` |
| Hatırlatmalar | Hasat hazır, hayvan ürünü birikti, sipariş bitiyor: olay başına bir kez, oyuncu başına tek iletide; 23.00–08.00 sessiz; kapatılabilir; canlı bağlantı + web push | `server/hatirlatma.js` (`HATIRLATMA=kapali` zamanlayıcıyı kapatır) |
| Komşuluk | Arkadaşlık (istek → kabul; demo sakinler hemen kabul eder ve arada hediye yollar), komşunun tarlasına yardım (sulama sayılır ya da olgunlaşma %10 kısalır; günlük sınırlar), günlük hediye, arkadaşa ürün gönderme | `server/komsuluk.js`, `komsuluk-ui.js` |
| Yöresel ürünler | 25 coğrafi işaretli ürün (Malatya kayısısı, Rize çayı, Afyon kaymağı…), yalnızca kendi ilinde parseli olan günde bir parti üretir; 7 bölgelik albüm (ürün ve bölge ödülleri); borsada ve komşular arasında takas; üretim il ligine puan | `server/yoresel.js`, `rules.js` → `YORESEL` |
| Etkinlikler | Her yıl aynı günlerde: Cumhuriyet Bayramı, Hıdırellez, Dünya Çiftçiler Günü, Hasat Şenliği, Yeni Yıl; kişisel görevler, Türkiye geneli ortak hedef, etkinliğe özel süs; ilerleme denetim kaydından sayılır; harita üstünde şerit | `server/etkinlik.js`, `rules.js` → `ETKINLIKLER` |
| Balık tutma | 🎣 → göle, nehre ya da kıyıya dokun → şamandıra gömülünce "Çek!"; ısırma anı sunucuda belirlenir; tür yöreye göre (hamsi, lüfer, çipura, levrek, sazan, alabalık, Van'da inci kefali), nadiren altın balık; günde 20 atış | `server/balik.js`, `komsuluk-ui.js` |

"Görevler" sekmesi **Çiftliğim** oldu: Çiftlik · Komşular · Yöresel · Etkinlik alt bölümleri.

**Kötüye kullanım önlemleri** (güvenlik incelemesi sonrası):
- Değer aktaran ya da başkasına bildirim gönderen işlemler (komşuluk isteği, yardım, hediye, ürün gönderme) doğrulanmış e-posta ister; hediye ve ürün gönderme seviye 3'ten itibaren.
- Yardım yalnızca komşuya (arkadaşa); kiracı kendi ekinine yardım edemez. Aynı kişiye komşuluk isteği haftada bir, günde en çok 20 istek.
- Köy yarışmasında yalnızca o mahallede parseli olanların, yardım/hediye/ödül dışı TP'si sayılır; ödül için en az 3 gerçek katılımcı gerekir.
- İlçe mahalle taraması ve mahalle açma uçları IP başına dakikada 20 istekle sınırlı (`AGIR_HIZ_SINIRI`); tarama aynı anda tek ilçe, sonuç kalıcı önbellekte; ziyaretçi tıklaması veritabanına yazmaz. Tarla önerisi giriş ister ve yalnızca Türkiye içinde arar.
- Balık tutmada suya düşmeyen atış da günlük hakkı tüketir; sayım ve kayıt tek işlemde.
- NPC pazarı: ortak günlük limit dolsa da her oyuncudan ürün başına günde 25 adet alınır (yeni oyuncu ilk satışını yapabilsin).
- Yeni sürüm yayımlanınca açık sekmeler kendiliğinden yenilenir (servis çalışanı devri); uzun açık sekmeler yarım saatte bir sürüm denetler.

## v0.9 — çiftlik oyunu

| Alan | Ne var | Nerede |
|---|---|---|
| İl → ilçe → mahalle | İle tıklayınca yakınlaşır ve ilçe sınırları renkli görünür; ilçeye tıklayınca mahalle ve köy alanları; mahalleye tıklayınca yakınlaşır, mahalle paneli açılır. Mahalle alanı oyunun kendi kuralıyla çıkarılır (hücre en yakın yerleşim noktasına, sınıf ağırlıklı uzaklıkla bağlanır), yani haritadaki sınır parsellerin gerçekten bağlandığı mahalleyle aynıdır | `server/harita/bolgeler.js`, `harita.js` |
| Tarla geri bildirimi | Kendi parselinde süzülen baloncuklar: 🧺 hasat hazır, 💧 sulama bekliyor, 🥚 hayvan ürünü hazır. Ekimde fide, sulamada damla, hasatta ürün parçacıkları | `dunya-efekt.js` |
| Hayvancılık | Kümes (sv 2, yumurta), inek ahırı (sv 3, süt), ağıl (sv 4, yün), mandıra (sv 5, peynir, tereyağı); yemle → bekle → topla; yem değirmende buğdaydan üretilir ya da eksikse satın alınır. Haritada ve parsel kartında hayvanlı 3B modeller | `server/ciftlik.js`, `modeller.js` |
| Seviye | Eylemler tecrübe puanı (TP) kazandırır; seviye n için toplam TP = 20 × n × (n − 1). Yeni yapılar ve süsler seviyeyle açılır; her seviyede akçe ödülü | `rules.js` → `SEVIYE` |
| Günlük ödül | Art arda gelinen günlerde artan akçe + TP (İstanbul tarihi) | `GUNLUK_ODUL` |
| Sipariş panosu | Köylüler (Ayşe Teyze, Fırıncı Rıza…) yetiştirebildiğin ürünleri ister; teslim edince taban fiyatın üstünde akçe + TP; 20 dakikada bir yeni müşteri, en çok 4 açık sipariş | `SIPARIS` |
| Köy yarışması | Mahallede bu hafta en çok TP kazanan üç oyuncu ödül alır (demo sakinler ödül almaz; dağıtım bir kez) | `YARISMA` |
| Süsler | Çiçek tarhı, korkuluk, taş yol, bank, kuyu, odun yığını, yel değirmeni, çeşme; parsel kenarındaki 8 yuvaya yerleşir, haritada 3B görünür | `SUSLER` |
| Ses | Web Audio ile anında üretilen efektler (hasat, sulama, para, seviye…) ve isteğe bağlı çiftlik ezgisi; ⚙️ menüsünden açılır/kapanır; ses dosyası yok | `ses.js` |
| Telefon | Dokunmatik boyutlu düğmeler, çakışmasız üst düzen, alt çekmece panel | `css/ciftlik.css` |

## v0.8 — çiftlik oyunu görünümü

Haritanın varsayılan görünümü **Çiftlik**: tarayıcı çiftlik oyunlarının (ör. My Free Farm) sıcak, elle boyanmış havası.
Dokular ve modeller kendi çizimimizdir (tuvalde üretilir); hiçbir oyunun görseli kullanılmaz. ⚙️ menüsünden eski
**Harita** görünümüne dönülebilir (tercih `st-gorunum`).

| Ne | Nasıl | Nerede |
|---|---|---|
| Boyanmış zemin | Yakında çiçekli çimen; tarlalar sürülmüş toprak / yeşil ekin / olgun buğday; orman tacı; köy aralarında aşınmış toprak; ara yollar toprak patika, ana yollar arnavut kaldırımı; boyanmış su ve kumsal kıyı. Uzakta yüksekliğe göre renk (kıyı yeşili → bozkır sarısı → dağ kahvesi → karlı zirve) | `ciftlik-doku.js`, `stil.js`, `tema.js` |
| 3B dünya | Haritanın WebGL bağlamında three.js sahnesi (MapLibre özel katmanı); içerik OSM vektör karolarından | `dunya3d.js` |
| Ağaçlar | Gür, yuvarlak, yumuşak gölgeli taçlar; yöreye göre tür, gerçek tarihe göre mevsim rengi; suya dikilmez | `dunya-bitki.js` |
| Evler | OSM tabanlarından sıvalı, ahşap çerçeveli ve panjurlu, saksılı cepheler; kiremit dokulu kırma çatılar; gece yanan pencereler; güneşe göre gölge | `dunya-bina.js` |
| Oyuncu parselleri | Çitle çevrili, hafif yükseltilmiş sürülmüş tarla (tarım) ya da çimenli avlu; kendi parselinin çiti bal rengi; yapılar ve ekinler parsel kartıyla aynı modeller | `dunya-bina.js`, `model3d.js` |
| Hareketli öğeler | Araçlar, kuşlar, koyun ve inek sürüleri, gerçek havaya göre bulutlar; ⚙️ menüsünden kapatılabilir | `dunya-hayat.js`, `dunya-bulut.js` |
| Arayüz | Ahşap üst çubuk ve sekmeler, parşömen panel ve kartlar, altın düğmeler, Baloo 2 başlıklar, çiftlik kartpostalı karşılama | `css/ciftlik.css` |
| Sinema | Uzaydan giriş uçuşu (oturumda bir kez), 🎬 Türkiye turu | `sinematik.js` |
| Grafik | ⚙️ Ultra / Yüksek / Dengeli / Hafif (Hafif: 3B dünya kapalı) | `dunya3d.js` → `GRAFIK` |

**Akıcılık kuralları** (bozulursa harita takılır):
- Harita boştayken baştan çizilmez. Hareketli öğeler varken ~20 kare/sn `triggerRepaint` (her karede değil), harita hareket
  ederken hiç istenmez. Boya özelliğini sürekli canlandırmak (`setPaintProperty` döngüsü) geçiş başlatır ve haritayı her
  karede çizdirir: yapılmaz.
- Görünür alan değişince 3B katmanlar ayrı karelerde kurulur (her biri ~10–40 ms); yeni katman eski çizim kökenine göre
  kaydırılmış grubunda doğru yerde görünür.
- `stil.js`'deki görünmez "veri tutucu" katmanlar silinmemeli: MapLibre yakın ölçekte karoları dilimlerken yalnızca görünür
  katmanların OSM katmanlarını saklar.
- Sahne ölçeği MapLibre'nin ortalama Dünya yarıçapıyla (6 371 008,8 m) hesaplanır; WGS84 yarıçapı nesneleri ~%0,1 gömer.

## v0.7 — yaşayan nüfus ve yayına hazırlık

| Alan | Ne var | Nerede |
|---|---|---|
| Yaşayan nüfus | Gerçek oyuncu olan mahallelerde 4'e kadar **demo sakin** (çiftçi, bahçıvan, emekli öğretmen, tüccar, girişimci, nine). Aynı kurallarla oynarlar: parsel edinir, eker, sular, hasat eder, yapı kurar, pazarda ve borsada satar, komşuyu ziyaret eder. Her yerde **DEMO** rozetiyle işaretlidir; kendini insan gibi tanıtmaz. Mahalle sohbetinde komşuya yanıt verir (Claude, saatte en çok 30 çağrı; anahtar yoksa şablon). Gerçek sakin sayısı 4'e ulaşınca ilanla parsellerini satıp **taşınırlar**; satılmayan parsel devlete döner, görevleri boşalır | `server/nufus.js`, `server/config/rules.js` → `NUFUS` |
| Doldurma kipi | Gerçek sakin `SECIM_MIN_SECMEN` altındayken demo sakinler seçmen ve aday sayılır; böyle bir seçim `doldurma` olarak işaretlenir ve arayüzde açıkça yazılır. Her demo kendi cihaz izini kullanır (ortak cihaz şüphesi doğmaz). Demo muhtar duyuru yapar, demo başkan proje önerir, demo meclis üyesi oy verir | `server/secim.js`, `server/belediye.js` |
| E-posta | nodemailer ile gerçek SMTP, düz metin + HTML şablon (kaçışlı), başarısız iletiler için kuyruk (1 dk / 5 dk / 30 dk / 2 sa, sonra HATA), `npm run posta-dene`, yönetim panelinde kuyruk durumu | `server/posta.js` |
| Yayına alma | Üretim yapılandırma denetimi (https `TABAN_URL`, `SIFRELEME_ANAHTARI`, `SMTP_URL`, geliştirme kısayolları kapalı), SIGTERM ile düzgün kapanma, Dockerfile (root olmayan kullanıcı, sağlık denetimi), docker-compose + Caddy (otomatik HTTPS, WebSocket), systemd birimi, yedek cron | `Dockerfile`, `docker-compose.yml`, `deploy/*`, `docs/yayina-alma.md` |
| PostgreSQL | Dışa aktarım gerçek PostgreSQL 18 + PostGIS 3.6 üzerinde (PGlite) test edilir: şema, yükleme, defter dengesi, değiştirilemez denetim kaydı, uzamsal sorgu. Para sütunları `NUMERIC(14,2)`, ikili veri `BYTEA`, yabancı anahtarlar ertelenebilir. Uygulamanın kendisi hâlâ SQLite'ta çalışır | `scripts/postgres-aktar.js`, `test/postgres.test.js` |
| Hukuk | Koşullar ve KVKK taslak-2 (demo sakinler §4a, yurt dışı aktarım tablosu); sürüm değiştiği için oyunculardan yeniden onay istenir. Hukukçu için kontrol listesi | `public/yasal/*`, `docs/hukuk-kontrol-listesi.md` |

> `npm run dev` `SECIM_MIN_SECMEN=1` kullandığından tek gerçek oyuncu eşiği zaten karşılar; doldurma kipini görmek için `SECIM_MIN_SECMEN=3` ile başlatın.

## v0.6 — hepsi bir arada

| Alan | Ne var | Nerede |
|---|---|---|
| Hesap güvenliği | E-posta doğrulama (pazar/seçim/belediye için şart), parola sıfırlama (hesap varlığını sızdırmaz, tüm oturumları kapatır), TOTP 2FA (QR, 10 kurtarma kodu, aynı kodun tekrar kullanımı engelli, 5 hatalı denemede kilit), oturum listesi ve kapatma, yaş beyanı (13 altı kayıt yok; 13–17 genç hesap: sohbet kapalı başlar, süre hatırlatıcısı kapatılamaz, aday olunamaz), mola hatırlatıcısı | `server/auth.js`, `server/lib/totp.js`, `server/lib/sifreleme.js`, `public/js/hesap-ui.js` |
| KVKK | Sürümlü onay kayıtları (sürüm değişince yeniden onay), pazarlama izni geri çekme, makinece okunur veri dışa aktarma (oy içeriği hariç), hesap silme (kimlik silinir, defter anonim kalır), taslak yasal metinler | `server/hesap.js`, `public/yasal/*` (**TASLAK — hukukçu incelemesi gerekir**) |
| Moderasyon ve denetim | Şikâyet, iki kişi kuralı (parsel dondurma, askı, görevden alma, seçim iptali; ikincisi denetçi/yönetici olmalı), içerik gizleme, kural tabanlı ön tarama (kimlik no/telefon/IBAN yayımlanmaz), görevden alma dilekçesi (%40 imza, ilk %20 dönem korumalı), yönetim paneli (şikâyet, işlem, seçim yeniden sayımı, meclis kararları, dilekçe, ekonomi, sistem) | `server/moderasyon.js`, `server/lib/icerik.js`, `/yonetim.html` |
| Ekonomi | Ekin tazeliği/çürüme, depoda bozulma (ambar yavaşlatır), yapı yıpranması ve ücretli bakım, ürün borsası (emir defteri, fiyat-zaman önceliği, emanet, kendi emriyle eşleşmeme, fiyat bandı), ekonomi gözlemi (arz, basım/yakım, Gini) | `server/ekonomi.js` |
| Canlılık | WebSocket (`/canli`; çerezle kimlik, Origin denetimi), anlık bildirim, web push (VAPID), PWA (servis çalışanı, çevrimdışı sayfa), mahalle/il/memleket sohbeti (hız sınırı, kişisel veri engeli) | `server/canli.js`, `server/push.js`, `server/sohbet.js`, `public/sw.js` |
| Yaşayan dünya | Gerçek hava (Open-Meteo, 81 il; yağmur sular, don hassas ürüne zarar), mevsim çarpanı, 6 yöresel ürün, il ligi ve 28 günlük sezonlar (açık formül, gurbetçi memleketine yarım puan), memleket/hemşehri, rozetler, 3B'de gerçek güneş konumu | `server/dunya.js`, `public/js/gunes.js`, `public/js/lig-ui.js` |
| Üretim ve topluluk | Değirmen/fırın/fabrika/ambar reçeteleri (9 mamul), meslekler (çiftçi, zanaatkâr, tüccar, mimar; seviye 1–5), kooperatifler (ortak kasa, eşit dağıtım, satış primi), 27 simge parsel ve koleksiyon albümü | `server/uretim.js`, `server/kooperatif.js`, `server/simge.js` |
| Yapay zekâ | Claude (`claude-opus-5-5`, düşük çaba, JSON şeması, sunucu tarafı ret yedeği): Mahalle Gazetesi (6 saat önbellek), tarla danışmanı (saatte 10), şikâyet ve şüpheli mesaj ön taraması (karar insanda). Anahtar yoksa kural tabanlı yerel yedek | `server/yz.js` |
| Görünüm | Kozmetikler (çatı rengi, flama, unvan; akçeyle ya da rozetle), fotoğraf modu ve 1200×630 paylaşım kartı, parsel ve ülke zaman yolculuğu | `server/kozmetik.js`, `server/zaman.js`, `public/js/foto.js` |
| Coğrafya | İller arası sevkiyat (kara her yere, deniz limanlar arası; il talebi, büyükşehir primi, yöresel ürün uzakta değerli, fırtına gecikmesi), tarla kiralama ve hasat ortaklığı, hava kaynaklı afetler (fırtına, sağanak, dolu, aşırı sıcak — deprem oyunlaştırılmaz), ilçe referandumu (gizli oy, makbuz, %30 nisap, danışma niteliğinde) | `server/lojistik.js`, `server/kira.js`, `server/referandum.js` |
| Altyapı | Yapılandırılmış JSON günlük (istek kimliği, hassas alan gizleme, hata dosyası, istemci hata raporu), `/api/saglik`, yedek/geri yükleme, yapılandırılabilir karo kaynakları, PostGIS şeması ve dışa aktarım, yük testi | `server/lib/gunluk.js`, `scripts/*`, `db/postgres/sema.sql`, `docs/*` |

Yük testi (geçici, boş bir dünya üzerinde, MacBook): 20 eşzamanlı istemci, 12 sn → ≈3.200 istek/sn, p50 5 ms, p95 13 ms, %0 hata.
Dolu bir dünyada (on binlerce parsel) yeniden ölçülmelidir.

## Ulusal mimari

### Izgara
Türkiye'nin tamamı Web Mercator **z20 hücrelerine** bölünür (Türkiye enlemlerinde ≈ 28–32 m kenar, ≈ 800–1.000 m²). Yaklaşık **870 milyon** olası parsel vardır; hiçbiri önceden üretilmez. Bir hücre ilk kez açıldığında imarı, ilçesi ve mahallesiyle veritabanına yazılır.
Parsel kimliği hücre koordinatıdır ve değişmez: `TR-0618754-0405037`.

### Gerçek arazi kullanımından imar (`server/harita/imar.js`)
Her z14 karosu (64 × 64 = 4.096 hücre) OpenMapTiles katmanlarından sınıflandırılır:

| Kaynak katman | Oyun imarı |
|---|---|
| landuse residential / yerleşim yarıçapı / bina | Konut |
| landuse commercial, retail | Ticaret · dükkân POI'si → Karma |
| landcover farmland, grass / haritalanmamış kırsal | Tarım |
| landuse industrial, railway, garages | Sanayi |
| poi lodging, theme_park, zoo | Turizm |
| landcover wood, wetland, sand · park (milli park, koruma) | Koruma (satışa kapalı) |
| okul, hastane, mezarlık, stadyum, havalimanı | Kamu (satışa kapalı) |
| water | Su (parsel değil) |
| ana yollar ve demiryolu | Yol (parsel değil) |

Sonuç `imar_karolari` tablosunda önbelleklenir ve haritaya 64×64 PNG imar karosu olarak gider (`/api/karo/imar/{x}/{y}.png`). İlk hesaplama ≈ 0,1–0,35 sn (ağ dahil), sonrası ≈ 2–3 ms. Edinilen parselin imarı kayda sabitlenir; OSM sonradan değişse de değişmez.

### Bölgeler
- **İl / ilçe**: geoBoundaries (OSM tabanlı) sınırları; `server/veri/hazirla.js` sadeleştirir, ilçeyi çoğunluk oyuyla ile bağlar, merkez ilçe adlarını düzeltir. Bellekte 0,25° kova indeksiyle nokta-poligon araması.
- **Mahalle**: OSM yerleşim noktaları (`place`: mahalle, köy, mezra…). Hücre, aynı ilçedeki en yakın noktanın mahallesine atanır. Noktalar `yerler` tablosunda birikir ve aramayı besler.
- **Çekicilik** = il katsayısı (İstanbul 1,6 … diğerleri 0,95) × yerleşim türü katsayısı. Birincil tahsis bedelini etkiler; fiyat tahmini değildir.

### Harita ve tasarım
- **Kendi 2B stilimiz** (`public/js/stil.js`): sıcak parşömen kara, rölyef gölgelendirme, sakin su; il etiketleri plaka kodlarıyla.
- **Ülke görünümü**: 81 il oyun etkinliğine göre renklenir, üzerine gelince il kartı (parsel, oyuncu, ilan), tıklayınca ile uçuş; Türkiye dışı maskelenir.
- **Parsel ölçeği (z ≥ 14)**: keskin imar hücreleri, z ≥ 16'da ızgara çizgileri, imleç altındaki hücre vurgusu; boş hücreler dahil her hücre tıklanabilir.
- **3B kip**: AWS Terrain Tiles ile arazi yükseltisi, gerçek OSM binaları (render_height), oyuncu yapıları için alçak poligonlu modeller (kırma çatılı evler, kat kat apartmanlar, bacalı fabrika, sera, ambar, güneş paneli, ağaçlar, ekin sıraları).
- **Parsel sahnesi** (`public/js/sahne3d.js`, three.js): kartın başında seçili parselin döndürülebilir izometrik maketi; 8 komşu hücre imarına göre canlanır (orman, mahalle, tarla, yol, su), fabrika bacası tüter.
- Ortak model tablosu `public/js/modeller.js` hem haritayı hem sahneyi besler.
- **Arama**: il, ilçe, mahalle ve köy (Türkçe karakter duyarsız). **Kırıntı**: Türkiye › İl › İlçe, harita gezildikçe güncellenir. **Bağlantı**: konum adres çubuğunda (`#konum=…`), parsel `?parsel=TR-…` ile paylaşılır.

### Mahalle muhtarlığı seçimi (plan §6, §14.3) — `server/secim.js`
| Aşama | Süre | Ne olur |
|---|---|---|
| Duyuru | 1 gün | Mahallede ≥ 3 oyuncu sakin olunca ve görevde muhtar yokken seçim kendiliğinden açılır; sakinlere bildirim |
| Adaylık | 2 gün | Ücretsiz. Şartlar: mahallede parsel, hesap ≥ 7 gün, itibar ≥ 25, son 30 günde ≥ 5 oyun eylemi. Manifesto, en fazla 5 vaat, tahmini bütçe |
| Kampanya | 2 gün | **Seçmen kütüğü dondurulur** (o anda mahallede parseli olan, hesabı ≥ 1 gün olanlar); sonradan parsel alarak oy kazanılamaz |
| Oylama | 2 gün | Tek hesap tek oy. Aday sırası her seçmene rastgele (eşit görünürlük) |
| İtiraz | 1 gün | Sayım, katılım, sayım özeti ve denetim bulguları açıklanır; seçmen ve adaylar itiraz eder; herkes bağımsız yeniden sayım yapabilir |
| Sonuç / devir | — | Yeniden sayım + denetim kararı: kesinleşir (muhtar 30 gün görev alır, vaatleri takip listesine geçer) ya da iptal edilip yenilenir |

**Gizli oy tasarımı**
- `secim_katilim` *kim* oy kullandı (tekil oy), `secim_oylari` *ne* oylandı: oy kaydında kullanıcı kimliği ve zaman yok; ROWID'siz tablo ve rastgele birincil anahtar sayesinde ekleme sırasından eşleştirme yapılamaz. Oylar ve katılım kayıtları tetikleyicilerle değiştirilemez / silinemez; denetim günlüğünde tercih tutulmaz.
- Seçmen bir **makbuz** alır: makbuz yalnızca oyunun sayıma *girdiğini* doğrular, *kime* verildiğini değil (oy satın alana kanıt gösterilemez).
- **Sayım özeti**: tüm pusulaların sıralı listesinin SHA-256 özeti; itiraz sonunda ve herkesin isteğiyle bağımsız yeniden sayımla karşılaştırılır.
- **Çoklu hesap denetimi** (§20.1): katılımda tuzlanmış IP + tarayıcı özeti tutulur; aynı cihazdan oy kullanan hesap kümeleri bulgu olarak açıklanır. Oylar gizli olduğundan şüpheli oylar ayıklanamaz; şüpheli sayısı kazanan ile ikinci arasındaki farka eşit ya da büyükse **seçim iptal edilir ve yenilenir**.
- Eşitlikte açık kura (seçim ve aday kimliğinden türetilen, herkesin doğrulayabileceği sıra).

**Muhtar yetkileri**: mahalleye duyuru, vaat takip ekranında vaat durumlarını güncelleme. Bütçe ve proje yetkileri belediye modülüyle gelecek; seçilmiş oyuncular kendi varlıklarına ayrıcalık yaratamaz (§1.3).
**Oyuncu azsa**: seçim açılmaz, "geçici yönetim" sürer (§23).

**İtibar** (herkese açık formül): görev × 5 + parsel × 4 + aktif yapı × 3 + hasat × 2 + işaretsiz pazar işlemi × 3 + hesap günü × 1, en fazla 100.

### İlçe belediyesi (plan §6.1, §6.3, §6.4, Senaryo C) — `server/belediye.js`
**Seçim**: başkan (1 koltuk) ve meclis (5 koltuk) aynı yerel seçimde, 90 günlük dönem için seçilir; aynı motor (`server/secim.js`, `SECIM.turler`). Bir seçimde tek makama aday olunur. Başkan şartı: hesap ≥ 14 gün, itibar ≥ 40, son 30 günde ≥ 10 eylem; meclis: muhtarlıkla aynı. Pusula iki bölümlüdür (başkan + meclis) ama **tek makbuz** verir; makama aday çıkmazsa o bölüm pusulada yer almaz. İptal kuralı her makamın belirleyici farkına (başkan: 1.–2. farkı; meclis: son koltuk ile ilk dışarıda kalan farkı) bakar.

**Kasa** (`BEL:<ilçe>` hesabı) — gelir oranları kuralla sabittir; başkan para basamaz, oran değiştiremez:
| Kaynak | Pay |
|---|---|
| Birincil tahsis bedeli (zaten oyundan çıkan tutar) | %10 |
| İnşaat ruhsatı (yapı maliyeti) | %10 |
| Oyuncular arası pazar işlem masrafı | %50 |
| Devlet katkısı: ilçede parseli olan aktif oyuncu başına | 4 akçe / gün (tavan 200) |

**Proje akışı (Senaryo C)**: muhtar → *talep* → başkan → *meclis gündemi* (1 gün) → açık oylama → **yapım** (bütçe kasadan `PROJE:<id>` emanetine) → **hizmette** (emanet harcanır, etki başlar).
- **Meclis kararı**: başkan meclise başkanlık eder ve oy kullanır. Toplantı yeter sayısı = oy kullanabilen üyelerin salt çoğunluğu. Evet > hayır; eşitlikte başkanın bulunduğu taraf. Meclis oyları **açıktır** (kamu kararı); vatandaş oyu gizlidir.
- **Çıkar çatışması** (§3.4): hedef mahallede parseli olan üye o kararda oy kullanamaz. Başkanın hedef mahallede parseli varsa ya da proje ≥ 800 akçe ise **nitelikli çoğunluk (2/3)** gerekir. Tüm üyeler çıkarlıysa karar alınamaz.

| Proje | Maliyet | Süre | Etki (hedef mahallede) |
|---|---|---|---|
| 💧 Sulama kanalı | 600 | 3 gün | Sulama maliyeti %50 düşer, hasat verimi %10 artar |
| 🛣️ Yol bakımı | 500 | 3 gün | İnşaatlar %25 kısa sürer |
| 🌳 Mahalle parkı | 400 | 2 gün | Mahalle çekiciliği +0,08 (tahsis bedeli, gelişmişlik skoru) |
| 🧺 Semt pazarı | 900 | 4 gün | Mahallede parseli olanlar NPC pazarında %8 daha yüksek fiyat alır (nitelikli çoğunluk) |

**Faaliyet panosu** (§6.4): kasa ve gelir kalemleri, gündemdeki / emanetteki / harcanan tutar, projeler ve isim isim meclis oyları, karar gerekçeleri, muhtar talepleri, mahalle hizmetleri, idari kararlar zaman çizelgesi ve yetki sınırları herkese açıktır. Haritada ilçe merkezinde belediye, hedef mahallede proje işaretleri görünür.

### Oyun ve pazar (v0.1–0.2'den)
İmar motoru (TAKS/KAKS, izin matrisi), inşaat, tarla döngüsü, NPC taban talebi, 7 görev, oyuncular arası pazar (ilan, teklif + emanet kilidi, hemen al, atomik devir, manipülasyon işaretleri, bildirimler). Pazar ve haber akışı il bazında süzülebilir.

```
server/
  config/rules.js     oyun kuralları (imar, yapılar, ürünler, pazar, çekicilik)
  harita/izgara.js    ulusal z20 ızgara matematiği (public/js/izgara.js ile senkron)
  harita/sinirlar.js  il/ilçe bulma
  harita/karolar.js   vektör karo önbelleği (OpenFreeMap)
  harita/imar.js      gerçek arazi kullanımı → oyun imarı, PNG imar karosu
  harita/parsel.js    hücreyi parsel olarak hazırlama, mahalle ataması
  veri/               işlenmiş il/ilçe sınırları + kaynak dosyalar
  oyun.js · pazar.js · auth.js · arama.js · npc.js · seed.js · index.js
public/js/
  stil.js · harita.js · izgara.js · modeller.js · sahne3d.js · app.js · pazar-ui.js
```

## Veri kaynakları ve lisanslar

| Veri | Kaynak | Lisans |
|---|---|---|
| Altlık harita ve arazi kullanımı | OpenFreeMap / OpenMapTiles, © OpenStreetMap katkıcıları | ODbL 1.0 (atıf haritada) |
| İl ve ilçe sınırları | geoBoundaries gbOpen TUR ADM0/1/2 (kaynak: OSM) | ODbL 1.0 / CC BY-SA |
| Yükselti | AWS Terrain Tiles (Mapzen terrarium) | açık veri, atıf |
| Tarla sınırları (deneme ilçeleri) | Fields of the World (Sentinel-2'den çıkarılmış), source.coop/ftw | CC-BY-4.0 (atıf haritada) |
| 3B motor | MapLibre GL JS 6, three.js | BSD-3 / MIT |
| Gerçek hava | Open-Meteo.com | CC BY 4.0 (ücretsiz uç nokta ticari olmayan kullanım için) |
| Simge alanları | Kamuya açık konum bilgisi; açıklamalar özgün | — |
| Yapay zekâ (isteğe bağlı) | Anthropic Claude API | Anthropic ticari koşulları; oyuncu metni API'ye gider (KVKK metninde belirtilmeli) |

**Hukuk kapısı (plan §15.1 "Harita lisansı")**: OSM'den türetilen imar ve mahalle verisi ODbL kapsamında "türetilmiş veritabanı" sayılabilir; ticari yayından önce lisans uzmanı görüşü alınmalı. Üretimde karolar kendi sunucumuzdan (ör. planet PMTiles) verilmeli; prototip OpenFreeMap'in ücretsiz uç noktasını kullanır ve sonuçları önbellekler.

## Sonraki adımlar

1. **Hukuk**: yasal metinlerin hukukçu incelemesi (docs/hukuk-kontrol-listesi.md): veri sorumlusu bilgileri, VERBİS, yurt dışı aktarım dayanakları, demo sakinlerin bilgilendirmesi, OSM türetilmiş veri lisansı.
2. **PostgreSQL'e geçiş (çalışma zamanı)**: şema ve veri aktarımı doğrulandı; kalan iş uygulama katmanının eşzamanlı better-sqlite3'ten `pg`'ye taşınması, çok sunuculu WebSocket köprüsü (LISTEN/NOTIFY), tembel bakım işleri için danışma kilidi (docs/postgres-gecisi.md).
3. **İmar değişikliği önerileri** (§3.4) ve bağlayıcı referandum türleri; **parsel birleştirme**.
4. Kendi karo sunucumuz (PMTiles, docs/karo-sunucusu.md) ve Open-Meteo ticari aboneliği.
5. Dolu dünyada yük testi; yavaş sorgular için indeks gözden geçirmesi.
