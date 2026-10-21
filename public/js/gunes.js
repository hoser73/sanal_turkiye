// Güneşin konumu (NOAA basitleştirilmiş formülü, ±1° yeterli): harita ve 3B sahne ışığı gerçek saat ve konuma göre ayarlanır.
const R = Math.PI / 180;

export function gunesKonumu(lon, lat, t = Date.now()) {
  const d = new Date(t);
  const gun = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const saat = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const g = (2 * Math.PI / 365) * (gun - 1 + (saat - 12) / 24);
  const denklem = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const sapma = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const gercekSaat = saat * 60 + denklem + 4 * lon;          // dakika
  const saatAcisi = (gercekSaat / 4 - 180) * R;
  const enlem = lat * R;
  const cosZenit = Math.sin(enlem) * Math.sin(sapma) + Math.cos(enlem) * Math.cos(sapma) * Math.cos(saatAcisi);
  const zenit = Math.acos(Math.min(1, Math.max(-1, cosZenit)));
  const yukseklik = 90 - zenit / R;
  let azimut = Math.acos(Math.min(1, Math.max(-1, (Math.sin(enlem) * Math.cos(zenit) - Math.sin(sapma)) / (Math.cos(enlem) * Math.sin(zenit))))) / R;
  azimut = saatAcisi > 0 ? (azimut + 180) % 360 : (540 - azimut) % 360;   // kuzeyden saat yönünde
  return { azimut, yukseklik };
}

// Işık ayarı: gündüz sıcak beyaz, alacakaranlıkta turuncu, gece loş mavi
export function isikRengi(yukseklik) {
  if (yukseklik > 12) return { renk: '#fff3dc', siddet: 1, gok: '#e3f0fb' };
  if (yukseklik > 0) return { renk: '#ffc58a', siddet: 0.55 + yukseklik / 30, gok: '#f6d3b5' };
  if (yukseklik > -8) return { renk: '#c48bd1', siddet: 0.35, gok: '#7d78a8' };
  return { renk: '#8fa7d6', siddet: 0.22, gok: '#3b4a6b' };
}
