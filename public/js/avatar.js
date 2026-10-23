// Oyuncu avatarı: kod "t{ten}-s{saç}-p{başlık}-g{giysi}" (sunucu AVATAR_RE ile aynı). SVG olarak çizilir; dış dosya yok.
export const TENLER = ['#f6d7b8', '#e8b98f', '#c98e63', '#9c6a43', '#6b4428'];
export const SACLAR = [
  { ad: 'Kısa', renk: '#3b2a1e' }, { ad: 'Uzun', renk: '#5a3a22' }, { ad: 'Kıvırcık', renk: '#2a1d14' },
  { ad: 'Kır', renk: '#b9b6b0' }, { ad: 'Kızıl', renk: '#a8481c' }, { ad: 'Yok', renk: null },
];
export const BASLIKLAR = ['Yok', 'Hasır şapka', 'Kasket', 'Yazma', 'Kep', 'Bere'];
export const GIYSILER = ['#3f7d3a', '#b5532a', '#2f6fa8', '#7a4a8c', '#c9a227', '#8a3b3b', '#4a5a66', '#d97a8a'];
export const VARSAYILAN = 't1-s0-p1-g0';

export function avatarCoz(kod) {
  const m = /^t([0-4])-s([0-5])-p([0-5])-g([0-7])$/.exec(kod || '') || /^t([0-4])-s([0-5])-p([0-5])-g([0-7])$/.exec(VARSAYILAN);
  return { t: +m[1], s: +m[2], p: +m[3], g: +m[4] };
}
export const avatarKod = ({ t, s, p, g }) => `t${t}-s${s}-p${p}-g${g}`;

export function avatarSVG(kod, boyut = 48, { baslik = '' } = {}) {
  const a = avatarCoz(kod), ten = TENLER[a.t], sac = SACLAR[a.s].renk, giysi = GIYSILER[a.g];
  const golge = 'rgba(0,0,0,.12)';
  const sacCiz = {
    0: `<path d="M17 27c0-9 6-15 15-15s15 6 15 15c-3-5-8-7-15-7s-12 2-15 7z" fill="${sac}"/>`,
    1: `<path d="M16 30c0-11 7-18 16-18s16 7 16 18v14c-2 0-4-1-5-3V30c-3-5-7-7-11-7s-8 2-11 7v11c-1 2-3 3-5 3z" fill="${sac}"/>`,
    2: `<g fill="${sac}">${[[19, 22], [24, 17], [31, 15], [38, 17], [44, 22], [46, 28], [17, 28]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.5"/>`).join('')}</g>`,
    3: `<path d="M17 27c0-9 6-15 15-15s15 6 15 15c-3-4-8-6-15-6s-12 2-15 6z" fill="${sac}"/>`,
    4: `<path d="M16 29c0-10 7-17 16-17s16 7 16 17c0 4-1 7-3 9 0-6-1-12-4-14-3 2-7 3-10 3s-6-1-9-3c-3 2-4 8-4 14-2-2-2-5-2-9z" fill="${sac}"/>`,
    5: '',
  }[a.s];
  const baslikCiz = {
    0: '',
    1: `<ellipse cx="32" cy="22" rx="24" ry="5.5" fill="#d9b25c"/><path d="M20 22c0-8 5-12 12-12s12 4 12 12z" fill="#e8c674"/><rect x="20" y="18.5" width="24" height="3.4" fill="#a2502c"/>`,
    2: `<path d="M16 24c1-8 8-13 16-13s15 4 17 11c-2 1-6 2-10 2H16z" fill="#5b4636"/><path d="M33 22c6 0 12 1 15 3-3 2-9 2-15 1z" fill="#4a382b"/>`,
    3: `<path d="M14 30c0-12 8-20 18-20s18 8 18 20c0 6-2 11-5 14-2-7-4-11-6-13-2 1-4 1-7 1s-5 0-7-1c-2 2-4 6-6 13-3-3-5-8-5-14z" fill="#c8402e"/>
        <g fill="#f4d7a1">${[[22, 17], [32, 14], [42, 17], [19, 26], [45, 26], [26, 22], [38, 22]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4"/>`).join('')}</g>`,
    4: `<path d="M17 25c0-8 7-13 15-13s15 5 15 13z" fill="#2f6fa8"/><path d="M33 23h17c0 3-4 4-9 4h-8z" fill="#245a8a"/><circle cx="32" cy="12.5" r="1.6" fill="#245a8a"/>`,
    5: `<path d="M17 26c0-9 7-15 15-15s15 6 15 15z" fill="#8a3b3b"/><rect x="16" y="23" width="32" height="5" rx="2" fill="#6f2e2e"/><circle cx="32" cy="10.5" r="3" fill="#6f2e2e"/>`,
  }[a.p];
  return `<svg class="oyuncu-avatar" viewBox="0 0 64 64" width="${boyut}" height="${boyut}" role="img" aria-label="${baslik || 'Oyuncu avatarı'}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="32" cy="32" r="31" fill="#f5e6c8"/><circle cx="32" cy="32" r="31" fill="none" stroke="${giysi}" stroke-width="2" opacity=".5"/>
    <clipPath id="ak${kod}"><circle cx="32" cy="32" r="30"/></clipPath>
    <g clip-path="url(#ak${kod})">
      <path d="M10 64c1-11 10-17 22-17s21 6 22 17z" fill="${giysi}"/><path d="M27 47h10l-5 7z" fill="${ten}"/>
      <rect x="28" y="38" width="8" height="10" rx="3" fill="${ten}"/>
      ${a.s === 1 || a.s === 4 ? sacCiz : ''}
      <ellipse cx="32" cy="30" rx="12.5" ry="14" fill="${ten}"/>
      <ellipse cx="19.5" cy="31" rx="2.2" ry="3.2" fill="${ten}"/><ellipse cx="44.5" cy="31" rx="2.2" ry="3.2" fill="${ten}"/>
      ${a.s !== 1 && a.s !== 4 ? sacCiz : ''}
      <circle cx="27.3" cy="31" r="1.6" fill="#2b2118"/><circle cx="36.7" cy="31" r="1.6" fill="#2b2118"/>
      <circle cx="25" cy="35.5" r="2.4" fill="#e08a7a" opacity=".35"/><circle cx="39" cy="35.5" r="2.4" fill="#e08a7a" opacity=".35"/>
      <path d="M28 37.5c2.4 2.4 5.6 2.4 8 0" stroke="#7a3b2a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
      <path d="M31 33.5c.6 1.2 1.4 1.2 2 0" stroke="${golge}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      ${baslikCiz}
    </g></svg>`;
}
