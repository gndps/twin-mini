// Built-in stickers: small vector drawings, so they print sharp at any resolution.
// Each is drawn in its own viewBox (vw × vh units) from parts: { d, fill?, stroke?, width?, alpha? }.
// A colour of 'tint' takes the sticker's chosen colour (stickers with `tint` can be recoloured).

const star = (cx, cy, n, R, r0, rot = -90) => {
  const pts = [];
  for (let k = 0; k < n * 2; k++) {
    const a = ((rot + (k * 180) / n) * Math.PI) / 180;
    const rr = k % 2 ? r0 : R;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
};
const circle = (cx, cy, rr) => `M${cx - rr} ${cy}a${rr} ${rr} 0 1 0 ${2 * rr} 0a${rr} ${rr} 0 1 0 ${-2 * rr} 0Z`;
const rays = (cx, cy, r1, r2, n) => Array.from({ length: n }, (_, k) => {
  const a = (k * 2 * Math.PI) / n;
  return `M${(cx + r1 * Math.cos(a)).toFixed(2)} ${(cy + r1 * Math.sin(a)).toFixed(2)}L${(cx + r2 * Math.cos(a)).toFixed(2)} ${(cy + r2 * Math.sin(a)).toFixed(2)}`;
}).join('');
const petals = (cx, cy, d, rr, n) => Array.from({ length: n }, (_, k) => {
  const a = (k * 2 * Math.PI) / n - Math.PI / 2;
  return circle(+(cx + d * Math.cos(a)).toFixed(2), +(cy + d * Math.sin(a)).toFixed(2), rr);
}).join('');
const dots = (x0, y0, cols, rows, step, rr) => {
  let s = '';
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) s += circle(x0 + i * step + (j % 2) * step / 2, y0 + j * step, rr);
  return s;
};
// Washi tape: a strip with torn (zig-zag) ends.
const TAPE = 'M6 4L114 4L110 10L115 16L110 22L115 28L110 34L114 36L6 36L10 30L5 24L10 18L5 12L10 6Z';

export const STICKERS = [
  { id: 'heart', label: 'Heart', vw: 100, vh: 90, tint: '#E5484D', parts: [{ d: 'M50 84C20 62 6 46 6 29C6 15 17 5 30 5C39 5 46 10 50 18C54 10 61 5 70 5C83 5 94 15 94 29C94 46 80 62 50 84Z', fill: 'tint' }] },
  { id: 'star', label: 'Star', vw: 100, vh: 96, tint: '#F2B53A', parts: [{ d: star(50, 52, 5, 46, 20), fill: 'tint' }] },
  { id: 'sparkle', label: 'Sparkle', vw: 100, vh: 100, tint: '#F2B53A', parts: [{ d: 'M50 4C53 34 66 47 96 50C66 53 53 66 50 96C47 66 34 53 4 50C34 47 47 34 50 4Z', fill: 'tint' }] },
  { id: 'sparkles', label: 'Sparkles', vw: 100, vh: 100, tint: '#F2B53A', parts: [
    { d: 'M38 14C40 38 50 48 74 50C50 52 40 62 38 86C36 62 26 52 2 50C26 48 36 38 38 14Z', fill: 'tint' },
    { d: 'M78 6C79 18 84 23 96 24C84 25 79 30 78 42C77 30 72 25 60 24C72 23 77 18 78 6Z', fill: 'tint' },
    { d: 'M80 62C81 71 84 74 93 75C84 76 81 79 80 88C79 79 76 76 67 75C76 74 79 71 80 62Z', fill: 'tint' },
  ] },
  { id: 'flower', label: 'Flower', vw: 100, vh: 100, parts: [{ d: petals(50, 50, 25, 20, 5), fill: '#F4A7B9' }, { d: circle(50, 50, 14), fill: '#F5C84C' }] },
  { id: 'sun', label: 'Sun', vw: 100, vh: 100, parts: [{ d: rays(50, 50, 31, 45, 12), stroke: '#F29D38', width: 6 }, { d: circle(50, 50, 22), fill: '#F7B733' }] },
  { id: 'moon', label: 'Moon', vw: 100, vh: 100, tint: '#F5C84C', parts: [{ d: 'M62 6A44 44 0 1 0 94 70A36 36 0 1 1 62 6Z', fill: 'tint' }] },
  { id: 'cloud', label: 'Cloud', vw: 120, vh: 76, parts: [{ d: 'M30 70C14 70 4 60 4 47C4 34 15 25 28 26C31 13 43 4 58 4C74 4 86 15 88 29C104 29 116 39 116 52C116 63 107 70 95 70Z', fill: '#FFFFFF', stroke: '#9AA5B1', width: 4 }] },
  { id: 'smile', label: 'Smiley', vw: 100, vh: 100, parts: [
    { d: circle(50, 50, 45), fill: '#F7C948' },
    { d: `${circle(35, 40, 6)}${circle(65, 40, 6)}`, fill: '#3B2F1E' },
    { d: 'M30 60C38 74 62 74 70 60', stroke: '#3B2F1E', width: 6 },
  ] },
  { id: 'arrow', label: 'Arrow', vw: 120, vh: 70, tint: '#1C1B19', parts: [{ d: 'M8 58C30 18 70 8 104 30M86 14L106 31L84 42', stroke: 'tint', width: 5 }] },
  { id: 'loop', label: 'Circle', vw: 120, vh: 80, tint: '#E0662F', parts: [{ d: 'M70 8C40 4 8 18 8 40C8 62 40 74 66 72C94 70 114 58 112 38C110 18 84 8 54 12', stroke: 'tint', width: 4 }] },
  { id: 'squiggle', label: 'Underline', vw: 140, vh: 36, tint: '#E0662F', parts: [{ d: 'M6 24C18 8 28 8 36 20S56 32 66 18S88 6 98 20S120 30 134 12', stroke: 'tint', width: 5 }] },
  { id: 'tape-pink', label: 'Pink tape', vw: 120, vh: 40, parts: [{ d: TAPE, fill: '#F4B6C2', alpha: 0.82 }, { d: dots(18, 13, 9, 2, 11, 2.2), fill: '#FFFFFF', alpha: 0.7 }] },
  { id: 'tape-mint', label: 'Mint tape', vw: 120, vh: 40, parts: [{ d: TAPE, fill: '#A8DCC8', alpha: 0.82 }, { d: 'M20 4L8 36M36 4L24 36M52 4L40 36M68 4L56 36M84 4L72 36M100 4L88 36M114 6L104 36', stroke: '#FFFFFF', width: 3, alpha: 0.5 }] },
  { id: 'tape-kraft', label: 'Kraft tape', vw: 120, vh: 40, parts: [{ d: TAPE, fill: '#D9B98C', alpha: 0.88 }] },
  { id: 'camera', label: 'Camera', vw: 100, vh: 84, tint: '#1C1B19', parts: [{ d: `M8 24H30L37 12H63L70 24H92V76H8Z${circle(50, 49, 16)}M78 34h4`, stroke: 'tint', width: 5 }] },
  { id: 'plane', label: 'Plane', vw: 100, vh: 100, tint: '#2E7DD7', parts: [{ d: 'M6 46L94 8L70 90L48 62L82 22L40 56Z', fill: 'tint' }] },
  { id: 'bolt', label: 'Lightning', vw: 70, vh: 100, tint: '#F2B53A', parts: [{ d: 'M42 4L6 58H32L24 96L64 38H38Z', fill: 'tint' }] },
];
export const stickerById = (id) => STICKERS.find((s) => s.id === id) || null;

/** Inline SVG for the sticker tray. */
export function stickerSvg(s, color) {
  const ink = color || s.tint;
  const parts = s.parts.map((p) => {
    const fill = p.fill ? (p.fill === 'tint' ? ink : p.fill) : 'none';
    const stroke = p.stroke ? (p.stroke === 'tint' ? ink : p.stroke) : 'none';
    return `<path d="${p.d}" fill="${fill}" stroke="${stroke}" stroke-width="${p.width || 0}" stroke-linecap="round" stroke-linejoin="round"${p.alpha ? ` opacity="${p.alpha}"` : ''}/>`;
  }).join('');
  return `<svg viewBox="-4 -4 ${s.vw + 8} ${s.vh + 8}" aria-hidden="true">${parts}</svg>`;
}

// Emoji for the tray, grouped like a phone keyboard.
export const EMOJI = [
  { label: 'Smileys', list: '😀 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 😉 😍 🥰 😘 😋 😛 😜 🤪 😎 🤩 🥳 😏 😌 😴 🥹 😭 😤 😱 🤯 🫶 🤗 🤭 🫣 🤫 🙈 🙉 🙊' },
  { label: 'Love', list: '❤️ 🧡 💛 💚 💙 💜 🤍 🖤 🤎 💕 💞 💓 💗 💖 💘 💝 💌 💋 💐 🌹 🌷 🌸 🌼 🌻' },
  { label: 'Nature', list: '☀️ 🌤️ 🌈 ☁️ 🌧️ ⛄ ❄️ 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌊 🌴 🌵 🍀 🍁 🍂 🌿 🐶 🐱 🐰 🦊 🐻 🐼 🐨 🐥 🦋 🐝 🐞 🐢 🐬' },
  { label: 'Food', list: '🍓 🍒 🍑 🍉 🍋 🍍 🥑 🍕 🍔 🍟 🌮 🍣 🍜 🍩 🍪 🎂 🍰 🧁 🍦 🍫 🍿 ☕ 🧋 🍵 🥂 🍷 🍹 🍺' },
  { label: 'Travel', list: '✈️ 🚗 🚲 🛵 🚂 ⛵ 🗺️ 🧭 🏖️ 🏝️ ⛰️ 🏔️ 🏕️ 🗽 🗼 🏰 🎡 🎢 📍 🧳 🎒 📸 📷 🎞️' },
  { label: 'Party', list: '🎉 🎊 🎈 🎁 🎀 🪩 🎂 🕯️ 🎶 🎵 🎤 🎧 🎸 🏆 🥇 ⚽ 🏀 🎾 💯 ✅ 👍 👏 🙌 ✌️ 🤞 👋 💪 🙏 👀 💫' },
].map((g) => ({ label: g.label, list: g.list.split(' ') }));
