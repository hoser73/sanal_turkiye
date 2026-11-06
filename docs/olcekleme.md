# Ölçekleme: 100.000 eşzamanlı oyuncuya giden yol

Bu belge, v0.34'teki performans çalışmasından sonra oyunun bugünkü kapasitesini ve aynı anda 100.000 oyuncuya
çıkmak için gerekenleri özetler. Ölçümler `npm run yuk-oyuncu` (gerçekçi oyuncu yükü) ile, MacBook üzerinde tek
Node süreci ve SQLite ile yapıldı.

## Bugün (tek sunucu, tek süreç)

| Ölçüm | v0.33 | v0.34 |
|---|---|---|
| 200 oyuncu, istek/sn | ≈ 400 | — |
| 500 oyuncu, istek/sn | — | ≈ 1.050 (hata yok) |
| Harita/çiftlik/akış uçları p95 | 2–70 ms | 2 ms |
| Sunucu CPU (200 oyuncu) | %12 meşgul | daha düşük (bakım işleri isteklerden çıktı) |

Sanal oyuncular gerçek bir oyuncudan çok daha sık istek atar (200–800 ms'de bir). Gerçek bir oyuncu ortalama
5–10 saniyede bir istek atar; bu yüzden **tek süreç kabaca 3.000–5.000 eşzamanlı gerçek oyuncu** taşır.
Asıl sınır CPU değil, mimaridir:

- **SQLite tek yazıcıdır.** Bütün yazmalar (ekim, hasat, satış) sırayla yapılır ve aynı makinede olmak zorundadır.
- **Tek Node süreci tek çekirdek kullanır.** Birden fazla süreç çalıştırmak için ortak veritabanı ve ortak canlı kanal gerekir.
- **Canlı kanal (WebSocket) süreç içindedir.** Bir süreçteki olay, başka süreçteki oyunculara ulaşmaz.

## 100.000 eşzamanlı oyuncu için mimari

Kabaca hesap: 100.000 oyuncu × saniyede 0,1–0,2 istek ≈ 10.000–20.000 istek/sn, artı 100.000 açık WebSocket.

1. **PostgreSQL + PostGIS.** Geçiş hazırlığı `postgres-gecisi` dalında (`docs/postgres-gecisi.md`). Okumalar için
   1–2 okuma kopyası, bağlantı havuzu (PgBouncer). Bu adım bir karar ve sunucu maliyeti gerektirir.
2. **Durumsuz uygulama sunucuları.** Aynı kodla 8–20 Node süreci (çekirdek başına bir süreç), önlerinde yük
   dengeleyici (Caddy/nginx ya da bulut dengeleyici). Oturumlar veritabanında olduğu için yapışkan oturum gerekmez.
3. **Ortak canlı kanal.** Redis pub/sub (ya da NATS): bir süreçteki olay ve bildirim tüm süreçlerdeki bağlantılara
   ulaşır. Olaylar bölge bazında kanallara ayrılır (oyuncu yalnızca baktığı ilin/karonun olaylarını alır).
4. **Bakım işleri tek bir işçide.** Süresi dolan inşaat, ilan, ihale, borsa, kira, hava, NPC döngüsü gibi işler (bugün
   `server/index.js` `BAKIM_ISLERI`) ayrı bir süreçte çalışır; uygulama sunucuları yalnızca isteklere bakar.
5. **CDN.** `public/` (JS, CSS, görseller, emoji) ve harita karoları CDN'den; dosya adlarına sürüm eklenip uzun
   süreli önbellek verilir. Uygulama sunucusuna yalnızca `/api` ve `/canli` gelir.
6. **Önbellek.** Herkese aynı uçlar (`server/lib/onbellek.js`) Redis'e taşınır; harita parselleri karo bazında
   birkaç saniyelik önbellek alır.
7. **Gözlem.** İstek gecikmesi, olay döngüsü gecikmesi, veritabanı sorgu süreleri ve WebSocket sayısı için panolar;
   yük testi (`npm run yuk-oyuncu`) her sürümde tekrarlanır.

Tahmini başlangıç: 3–4 uygulama makinesi (8 çekirdek), 1 PostgreSQL birincil + 1 kopya, 1 Redis, CDN.

## v0.34'te yapılanlar

- Her `/api` isteğinde çalışan 12 bakım işi (tablo taramaları) en sık saniyede bire indi ve ayrı korumaya alındı.
- SQLite: `synchronous = NORMAL` (WAL'da güvenli; her yazmada disk beklenmez), 64 MB önbellek, 27 eksik dizin.
- Herkese aynı uçlar (bölgeler, kurallar, istatistik, hava, akış, pazar, şubeler, simgeler) kısa süreli önbellekten.
- Statik dosyalar için oturum sorgusu yapılmıyor; giriş ve kayıtta parola özeti olay döngüsünü kilitlemiyor.
- Canlı kanal: ileti bir kez metne çevriliyor; bildirim yalnızca o oyuncunun bağlantılarına; çevrimiçi sayıları
  3 sn'de bir toplu. Oyuncular ülkedeki her olayda haritayı yeniden indirmiyor (yalnızca ekrandaki olaylar).
- İstemci: çiftlik açıkken harita ve 3B köy duruyor; harita küçük kaydırmalarda yeniden indirilmiyor, değişmeyen
  veride 3B modeller yeniden kurulmuyor; 3B köy canlandırması 15 sn dokunulmazsa duruyor; çiftlik telefonda
  30/15 kare; rehber avatarı boştayken saniyede ~8 kare; ölü kod ve kullanılmayan dosyalar (≈3,4 MB) kaldırıldı.

## Bilinen kalan işler

- `/api/harita/parseller` parsel başına birkaç sorgu yapıyor (çok dolu bir görünümde yavaşlar); toplu sorguya
  çevrilmeli ve karo bazında önbelleğe alınmalı.
- İşçi turu (`gelisim.isciTuru`), NPC döngüsü (`nufus.js`) ve hava işlemesi (`dunya.havaBakim`) büyük tablolarda
  olay döngüsünü uzun süre tutabilir; parçalara bölünmeli (yukarıdaki 4. adımla birlikte ayrı işçiye).
- Bakiye ve envanter her seferinde defterin tamamından toplanıyor; özet tablolar (hesap bakiyesi, envanter) eklenmeli.
- İstemci açılışta tüm modülleri birden yüklüyor; sekme modülleri (pazar, borsa, çarşı…) ihtiyaç anında
  yüklenmeli, dosyalar paketlenmeli (esbuild) ve sürümlü önbellek verilmeli.
