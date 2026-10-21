# Kendi karo sunucusu

Sanal Türkiye varsayılan olarak üç dış kaynak kullanır:

| Kaynak | Varsayılan | Ortam değişkeni |
|---|---|---|
| Vektör altlık (OpenMapTiles şeması) | `https://tiles.openfreemap.org/planet` (TileJSON) | `VEKTOR_TILEJSON` |
| Yükselti (terrarium PNG) | AWS Terrain Tiles | `YUKSELTI_KARO` |
| Harita yazı tipleri (glyph) | OpenFreeMap | `HARF_KARO` |

Sunucu imar sınıflandırması için de aynı vektör karoları okur (`server/harita/karolar.js`), bu yüzden
`VEKTOR_TILEJSON` hem istemciyi hem sunucuyu yönlendirir. CSP izinleri bu adreslerin kökenlerinden otomatik üretilir;
TileJSON karoları başka bir alan adından sunuyorsa `EK_KARO_KOKENLERI=https://karo.ornek.com` ekleyin.

## PMTiles ile Türkiye karoları (önerilen)

1. Türkiye kesitini indirin (Protomaps günlük gezegen dosyasından, yaklaşık 1–2 GB):
   ```bash
   pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles turkiye.pmtiles --bbox=25.5,35.7,45,42.2
   ```
   Not: Protomaps şeması OpenMapTiles değildir. Mevcut imar sınıflandırması ve harita stili OpenMapTiles katman adlarına
   (`landuse`, `landcover`, `park`, `water`, `transportation`, `building`, `place`) göre yazıldı. OpenMapTiles şemalı
   PMTiles için OpenFreeMap'in yayımladığı `planet` dosyasından Türkiye kesiti alın ya da `planetiler` ile kendiniz üretin:
   ```bash
   java -jar planetiler.jar --download --area=turkey --output=turkiye.pmtiles
   ```
2. Bir karo sunucusuyla yayımlayın, ör. [martin](https://github.com/maplibre/martin):
   ```bash
   martin turkiye.pmtiles
   ```
   martin `http://localhost:3000/turkiye` adresinde TileJSON verir.
3. Sanal Türkiye'yi bu adresle başlatın:
   ```bash
   VEKTOR_TILEJSON=http://localhost:3000/turkiye npm start
   ```

Büyük dosyaların indirilmesi ve barındırma maliyeti işletmeciye aittir; OpenFreeMap ücretsizdir ancak yoğun trafik için
kendi kopyanızı barındırmanız önerilir. Atıf metinleri (© OpenStreetMap katkıcıları, OpenMapTiles) korunmalıdır.

## Hava verisi

Gerçek hava Open-Meteo'dan gelir (`HAVA_KAYNAGI=open-meteo`, varsayılan). Ücretsiz uç nokta ticari olmayan kullanım içindir
ve CC BY 4.0 atfı gerektirir; ticari yayında Open-Meteo aboneliği ya da kendi örneğiniz gerekir. `HAVA_KAYNAGI=kapali`
gerçek hava etkilerini kapatır, `sahte` testler içindir.
