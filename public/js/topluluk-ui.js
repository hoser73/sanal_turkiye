// Meslek, kooperatif ve koleksiyon albümü (Arazilerim sekmesinin alt bölümleri).
import { api, esc, sayi, akce, zamanOnce, sure } from './yardimci.js';

export async function meslekBolumu() {
  const m = await api('/api/meslek');
  const sec = m.secenekler.find((x) => x.kod === m.meslek);
  const ilerleme = m.sonrakiSeviyeXp ? Math.min(100, (m.xp / m.sonrakiSeviyeXp) * 100) : 100;
  return `${sec ? `<div class="kutu vurgulu"><div class="satir"><div><span style="font-size:28px">${sec.ikon}</span> <b>${esc(sec.ad)}</b> · seviye ${m.seviye}</div>
      <span class="cip yesil">${esc(sec.aciklama)} %${Math.round(m.bonus * 100)}</span></div>
      <div class="cubuk"><span style="width:${ilerleme}%"></span></div>
      <p class="kucuk" style="margin:0">${m.sonrakiSeviyeXp ? `${m.xp} / ${m.sonrakiSeviyeXp} deneyim · sonraki seviyede bonus +%${Math.round(sec.seviyeBonus * 100)}` : 'En yüksek seviye'}</p></div>`
    : '<p>Bir meslek seç: ilgili eylemlerin deneyim kazandırır, seviye arttıkça bonusun büyür.</p>'}
    <ul class="liste" style="margin-top:12px">${m.secenekler.map((x) => `<li class="liste-oge"><span class="ikon">${x.ikon}</span>
      <div class="govde"><b>${esc(x.ad)}</b><span class="kucuk">${esc(x.aciklama)} %${Math.round(x.bonus * 100)} (+%${Math.round(x.seviyeBonus * 100)}/seviye)</span></div>
      ${x.kod === m.meslek ? '<span class="cip yesil">mesleğin</span>' : `<button class="dugme ince" data-eylem="meslek-sec" data-meslek="${x.kod}" ${m.degisebilir ? '' : 'disabled'}>Seç</button>`}</li>`).join('')}</ul>
    ${!m.degisebilir ? `<p class="kucuk">Mesleğini ${zamanOnce(m.degisimTarihi) === 'az önce' ? 'yakında' : new Date(m.degisimTarihi).toLocaleDateString('tr-TR')} tarihinde değiştirebilirsin. Değişimde deneyim sıfırlanır.</p>` : '<p class="kucuk">Meslek haftada bir değiştirilebilir; değişimde deneyim sıfırlanır.</p>'}`;
}

// Hasat yarışı kartı: kooperatifin takım puanı, üç sandık, Türkiye sıralaması, üyelerin katkısı ve il sıralaması (hasat-yarisi.js)
const EYLEM_AD = { ORDER_DELIVERED: 'Sipariş teslim', DAILY_QUESTS_REWARDED: 'Günlük görevler', GI_PRODUCED: 'Yöresel ürün', CROP_HARVESTED: 'Hasat',
  PRODUCTION_COLLECTED: 'Üretim', ANIMAL_PRODUCE_COLLECTED: 'Hayvan ürünü', NEIGHBOR_HELPED: 'Komşuya yardım' };
export function yarisKarti(y) {
  const b = y.benim, son = 1500;
  const sandiklar = b ? b.sandiklar : [];
  const enBuyuk = sandiklar.at(-1)?.esik || son;
  return `<div class="yaris-kart">
      <div class="yaris-ust"><span class="yaris-ikon">🏁</span><div><b>Hasat yarışı</b><small>Haftalık yarış · bitişe <span data-bitis="${y.bitis}">${sure(y.kalanMs)}</span></small></div>
        ${b ? `<div class="yaris-puan"><b>${sayi(b.puan)}</b><small>${b.sira ? `Türkiye ${b.sira}.` : 'puan'}</small></div>` : ''}</div>
      ${b ? `<div class="yaris-yol"><div class="yaris-cubuk"><b style="width:${Math.min(100, (b.puan / enBuyuk) * 100)}%"></b></div>
          ${sandiklar.map((s) => `<span class="yaris-sandik${s.acik ? ' acik' : ''}" style="left:${(s.esik / enBuyuk) * 100}%" title="${esc(s.ad)}: ${s.esik} puan">${s.acik ? '🎁' : '📦'}<small>${s.esik}</small></span>`).join('')}</div>
        <p class="kucuk yaris-not">Her sandık, haftada en az ${y.minKatki} puan katan üyeye ${sandiklar.map((s) => akce(s.odul)).join(' / ')} verir. Senin katkın: <b>${sayi(b.katkim)}</b>${b.katkim < y.minKatki ? ` (${y.minKatki - b.katkim} puan daha)` : ' ✓'}</p>
        ${b.aktif ? '' : `<p class="kucuk uyari-metin">Sıralamaya girmek için kooperatifte en az ${y.minUye} üye olmalı.</p>`}
        ${b.uyeler.length ? `<ul class="yaris-uyeler">${b.uyeler.map((u) => `<li${u.ben ? ' class="ben"' : ''}><span>${esc(u.ad)}${u.ben ? ' (sen)' : ''}</span><b>${sayi(u.puan)}</b></li>`).join('')}</ul>` : ''}`
      : '<p class="kucuk">Bir kooperatife katıl ya da kur: üyelerin hasadı, siparişi ve üretimi takım puanına eklenir; sandıklar ve haftanın ilk üçüne kasa bonusu var.</p>'}
      ${y.siralama.length ? `<h4 class="yaris-baslik">🏆 Bu hafta Türkiye</h4><ol class="yaris-siralama">${y.siralama.slice(0, 5).map((t) => `<li${t.ben ? ' class="ben"' : ''}>
          <span class="yaris-sira">${t.sira <= 3 ? ['🥇', '🥈', '🥉'][t.sira - 1] : t.sira}</span><span class="yaris-ad"><b>${esc(t.ad)}</b><small>${esc(t.il)} · ${t.uye} üye</small></span><b>${sayi(t.puan)}</b></li>`).join('')}</ol>
        <p class="kucuk">İlk üç kooperatifin kasasına ${y.kasaBonusu.map((x) => akce(x)).join(' / ')} bonus.</p>` : ''}
      ${y.gecenHafta.length ? `<p class="kucuk">Geçen haftanın birincisi: <b>${esc(y.gecenHafta[0].ad)}</b> (${sayi(y.gecenHafta[0].puan)} puan)</p>` : ''}
      <h4 class="yaris-baslik">🗺️ İller</h4>
      ${y.benimIl ? `<p class="kucuk yaris-not">İlin <b>${esc(y.benimIl.il)}</b>${y.benimIl.sira ? `, bu hafta Türkiye ${y.benimIl.sira}.` : ''} · senin katkın <b>${sayi(y.benimIl.katkim)}</b>${y.benimIl.katkim < y.minKatki ? ` (ödül için ${y.minKatki - y.benimIl.katkim} puan daha)` : ' ✓'}</p>` : ''}
      ${y.iller.length ? `<ol class="yaris-siralama">${y.iller.slice(0, 5).map((t) => `<li${t.ben ? ' class="ben"' : ''}>
          <span class="yaris-sira">${t.sira <= 3 ? ['🥇', '🥈', '🥉'][t.sira - 1] : t.sira}</span><span class="yaris-ad"><b>${esc(t.il)}</b><small>${t.oyuncu} oyuncu · ${sayi(t.puan)} puan</small></span><b>${sayi(t.ilPuani)}</b></li>`).join('')}</ol>`
        : '<p class="kucuk">Bu hafta henüz il puanı yok.</p>'}
      <p class="kucuk">İl puanı = toplam ÷ √oyuncu (kalabalık il kazanmasın). İlk üç ilde en az ${y.minKatki} puan katanlara ${y.ilOdulu.map((x) => akce(x)).join(' / ')}. Puanın memleketine yazılır; seçmediysen ilk tarlanın iline.</p>
      ${y.gecenIller.length ? `<p class="kucuk">Geçen haftanın birinci ili: <b>${esc(y.gecenIller[0].il)}</b></p>` : ''}
      <details class="acilir"><summary>Puan nasıl kazanılır?</summary><ul class="yol-kaynak">${y.puanlar.map((p) => `<li><span>${esc(EYLEM_AD[p.eylem] || p.eylem)}</span><b>+${p.puan}</b></li>`).join('')}</ul></details>
    </div>`;
}

export async function kooperatifBolumu({ ben, konum }) {
  const ilId = ben.portfoy[0] ? null : konum?.ilId;
  const [l, y] = await Promise.all([api(`/api/kooperatifler${ilId ? `?il=${ilId}` : ''}`), api('/api/hasat-yarisi').catch(() => null)]);
  const yaris = y ? yarisKarti(y) : '';
  if (l.benim) {
    const k = l.benim;
    return `${yaris}<div class="kutu vurgulu"><div class="satir"><b>🤝 ${esc(k.ad)}</b><span class="cip ${k.aktif ? 'yesil' : ''}">${k.aktif ? `aktif · satış primi %${Math.round(k.satisPrimi * 100)}` : `${k.minAktifUye} üyede aktifleşir`}</span></div>
      <p class="kucuk" style="margin:4px 0 0">${esc(k.il)} · ${k.uyeler.length}/${k.maxUye} üye · kasa <b>${akce(k.kasa)}</b></p>${k.aciklama ? `<p class="kucuk">${esc(k.aciklama)}</p>` : ''}</div>
      <h3 class="bolum">Üyeler</h3><ul class="madde">${k.uyeler.map((u) => `<li>${esc(u.ad)}${u.baskan ? ' · <b>başkan</b>' : ''}${u.ben ? ' (sen)' : ''}</li>`).join('')}</ul>
      <form class="form satir koop-aidat"><label>Ortak kasaya aidat (₳)<input name="tutar" type="number" min="1" value="20"></label><button class="dugme ince">Yatır</button></form>
      ${k.ben.baskan ? `<button class="dugme ince birincil" data-eylem="koop-dagit" ${k.kasa >= 0.01 * k.uyeler.length ? '' : 'disabled'}>Kasayı üyelere eşit dağıt</button>` : ''}
      ${k.hareketler?.length ? `<h3 class="bolum">Kasa hareketleri</h3><table class="tablo">${k.hareketler.map((h) => `<tr><td>${esc(h.reason)}<div class="kucuk">${zamanOnce(h.created_at)}</div></td>
        <td class="${h.credit ? 'arti' : 'eksi'}">${h.credit ? '+' : '−'}${sayi(h.credit || h.debit)}</td></tr>`).join('')}</table>` : ''}
      <p><button type="button" class="bag tehlike" data-eylem="koop-ayril">Kooperatiften ayrıl</button></p>`;
  }
  const iller = [...new Map(ben.portfoy.map((p) => [p.il, p])).values()];
  return `${yaris}<p>Kooperatif, aynı ildeki oyuncuların ortak kasası ve dayanışmasıdır. ${3} ve üzeri üyeli kooperatifin üyeleri tüccara satışta fiyat primi ve küçük bir hasat primi alır.</p>
    ${l.kooperatifler.length ? `<ul class="liste">${l.kooperatifler.map((k) => `<li class="liste-oge"><span class="ikon">🤝</span><div class="govde"><b>${esc(k.ad)}</b>
      <span class="kucuk">${esc(k.il)} · ${k.uye} üye${k.aciklama ? ` · ${esc(k.aciklama)}` : ''}</span></div>
      <button class="dugme ince" data-eylem="koop-katil" data-id="${k.id}">Katıl</button></li>`).join('')}</ul>` : '<p class="kucuk">Henüz kooperatif yok.</p>'}
    ${iller.length ? `<details class="acilir"><summary>Kooperatif kur (${akce(l.kurulusBedeli)})</summary>
      <form class="form koop-kur"><label>İl<select name="ilId">${iller.map((p) => `<option value="${p.ilId}">${esc(p.il)}</option>`).join('')}</select></label>
      <label>Ad<input name="ad" minlength="3" maxlength="40" required placeholder="ör. Ova Üreticileri"></label>
      <label>Kısa açıklama<input name="aciklama" maxlength="300" placeholder="Ne üretiyorsunuz?"></label>
      <button class="dugme birincil">Kur</button></form></details>` : '<p class="kucuk">Kooperatif kurmak ya da katılmak için o ilde parselin olmalı.</p>'}`;
}

export async function albumBolumu() {
  const a = await api('/api/album');
  return `<div class="satir"><p style="margin:0">Türkiye’nin miras alanları haritada <b>🏛️ simge parsel</b> olarak işaretli. Git, kartını topla: her kart ${akce(a.odul)}, bir bölgeyi tamamlamak rozet kazandırır.</p></div>
    <div class="cubuk altin" style="margin:10px 0"><span style="width:${(a.toplanan / a.toplam) * 100}%"></span></div>
    <p class="kucuk">${a.toplanan} / ${a.toplam} kart · günde en çok ${a.gunluk} kart</p>
    ${a.bolgeler.map((b) => `<h3 class="bolum">${esc(b.ad)} <span class="kucuk">${b.toplanan}/${b.toplam}</span></h3>
      <div class="album">${b.simgeler.map((s) => `<button type="button" class="album-kart ${s.toplandi ? 'toplandi' : ''}" data-eylem="simgeye-git" data-parsel="${esc(s.parsel)}" title="${esc(s.not)}">
        <span class="ikon">${s.toplandi ? s.ikon : '❔'}</span><b>${esc(s.ad)}</b><small>${s.toplandi ? 'toplandı' : 'haritada bul'}</small></button>`).join('')}</div>`).join('')}`;
}
