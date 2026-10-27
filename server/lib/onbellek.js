// Herkese aynı olan uçlar için kısa süreli bellek önbelleği. Yanıt bir kez hesaplanıp JSON metni olarak saklanır;
// süre içinde gelen istekler hazır metni alır (veritabanı ve JSON.stringify tekrarlanmaz). Tarayıcıya da aynı süre
// için Cache-Control gönderilir. anahtar: aynı uçta farklı parametreler (ör. il) için ayrı kayıt.
function ortakYanit(ms, hesapla, anahtar = () => '') {
  if (process.env.ONBELLEK === 'kapali') ms = 0;   // testler değişikliği hemen görmeli
  const kayitlar = new Map();
  return (req, res) => {
    const k = anahtar(req), t = Date.now();
    let kayit = kayitlar.get(k);
    if (!kayit || t - kayit.t > ms) {
      kayit = { t, govde: Buffer.from(JSON.stringify(hesapla(req))) };
      kayitlar.set(k, kayit);
      if (kayitlar.size > 500) kayitlar.delete(kayitlar.keys().next().value);   // sınırsız büyümesin
    }
    res.set('Cache-Control', `public, max-age=${Math.max(0, Math.floor(ms / 1000))}`).type('json').send(kayit.govde);
  };
}

module.exports = { ortakYanit };
