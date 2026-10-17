// Canvas renderer: draws the whole print sheet at any scale (px per mm).
import { cropRect } from './geometry.js';

export const FRAME_COLORS = [
  { id: 'white', label: 'Classic white', fill: '#FFFFFF', ink: '#3A3631' },
  { id: 'cream', label: 'Cream', fill: '#F6F1E6', ink: '#3A3631' },
  { id: 'blush', label: 'Blush', fill: '#F3DCD6', ink: '#4A3330' },
  { id: 'sage', label: 'Sage', fill: '#DCE4D6', ink: '#2F3A2C' },
  { id: 'sky', label: 'Sky', fill: '#D9E3EC', ink: '#2C3540' },
  { id: 'butter', label: 'Butter', fill: '#F5EAC2', ink: '#4A4128' },
  { id: 'ink', label: 'Ink black', fill: '#1B1A19', ink: '#EDE8DF' },
];

export const FONTS = {
  hand: { label: 'Handwritten', css: '"Caveat", "Bradley Hand", cursive', weight: 500, size: 6.2 },
  serif: { label: 'Serif', css: '"Fraunces", Georgia, serif', weight: 400, size: 3.6 },
  sans: { label: 'Sans', css: '"Inter", system-ui, sans-serif', weight: 500, size: 3.0 },
};

// Light warm grey: faint on white paper but still visible after cutting.
const GUIDE = '#C9C4BC';
// Thinnest line the CP1500 reliably prints: one 300-dpi dot ≈ 0.085 mm.
const HAIRLINE_MM = 0.09;

/**
 * Draw the sheet.
 * @param ctx CanvasRenderingContext2D sized paper.w*scale × paper.h*scale
 * @param layout result of computeLayout()
 * @param slots [{photo, caption}] per card (photo may be null)
 * @param opts {scale, color, font, marks, sourceFor(photo, scale) -> {img, factor}}
 */
export function renderSheet(ctx, layout, slots, opts) {
  const { scale, color, font, marks } = opts;
  const { paper, cards } = layout;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.scale(scale, scale);
  if (opts.origin) ctx.translate(-opts.origin.x, -opts.origin.y);

  cards.forEach((card, i) => {
    const slot = slots[i] || {};
    ctx.fillStyle = color.fill;
    ctx.fillRect(card.x, card.y, card.w, card.h);
    const { win } = card;
    if (slot.photo) {
      drawPhoto(ctx, slot.photo, win, scale, opts.sourceFor);
    } else if (opts.placeholder) {
      opts.placeholder(ctx, win, i);
    } else {
      // Blank frame: a soft neutral window so an empty card still reads as a frame.
      ctx.fillStyle = color.id === 'ink' ? '#2A2826' : '#EFEBE4';
      ctx.fillRect(win.x, win.y, win.w, win.h);
    }
    if (slot.caption) drawCaption(ctx, card, slot.caption, FONTS[font] || FONTS.hand, color.ink);
  });

  if (marks) drawMarks(ctx, layout, scale);
  ctx.restore();
}

function drawPhoto(ctx, photo, win, scale, sourceFor) {
  const aspect = win.w / win.h;
  const c = cropRect(photo.width, photo.height, photo.rot, aspect, photo.zoom, photo.cx, photo.cy);
  const pxPerSrc = (win.w * scale) / c.w; // device px per source px
  const { img } = sourceFor(photo, pxPerSrc);
  ctx.save();
  ctx.beginPath();
  ctx.rect(win.x, win.y, win.w, win.h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Map rotated-image space → window.
  ctx.translate(win.x, win.y);
  ctx.scale(win.w / c.w, win.h / c.h);
  ctx.translate(-c.x, -c.y);
  // Map original-image space → rotated space (clockwise rotation, never mirrored).
  const W = photo.width, H = photo.height;
  switch (photo.rot) {
    case 90: ctx.translate(H, 0); ctx.rotate(Math.PI / 2); break;
    case 180: ctx.translate(W, H); ctx.rotate(Math.PI); break;
    case 270: ctx.translate(0, W); ctx.rotate(-Math.PI / 2); break;
  }
  ctx.drawImage(img, 0, 0, W, H);
  ctx.restore();
}

function drawCaption(ctx, card, text, font, ink) {
  const { chin } = card;
  const size = Math.min(font.size, chin.h * 0.42);
  ctx.save();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${font.weight} ${size}px ${font.css}`;
  let t = text;
  const maxW = chin.w - 8;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  if (t !== text) t = t.trimEnd() + '…';
  ctx.fillText(t, chin.x + chin.w / 2, chin.y + chin.h * 0.5);
  ctx.restore();
}

function drawMarks(ctx, layout, scale) {
  const { paper, cards, cutX } = layout;
  const lw = Math.max(HAIRLINE_MM, 1 / scale); // ≥ one printer dot and ≥ one device pixel
  ctx.save();
  ctx.strokeStyle = GUIDE;
  ctx.lineWidth = lw;
  const gap = 1.2, len = 3.5;
  for (const c of cards) {
    const corners = [[c.x, c.y, -1, -1], [c.x + c.w, c.y, 1, -1], [c.x, c.y + c.h, -1, 1], [c.x + c.w, c.y + c.h, 1, 1]];
    ctx.beginPath();
    for (const [x, y, dx, dy] of corners) {
      // horizontal tick (outside the card, along its top/bottom edge line)
      if (inside(paper, x + dx * gap, y) && !nearCut(x + dx * gap, cutX)) {
        ctx.moveTo(x + dx * gap, y); ctx.lineTo(x + dx * (gap + len), y);
      }
      if (inside(paper, x, y + dy * gap)) {
        ctx.moveTo(x, y + dy * gap); ctx.lineTo(x, y + dy * (gap + len));
      }
    }
    ctx.stroke();
  }
  if (cutX != null) {
    // Centre cut line, dashed, only where it does not run over a card.
    ctx.setLineDash([1.6, 1.2]);
    ctx.beginPath();
    const top = Math.min(...cards.map((c) => c.y));
    const bottom = Math.max(...cards.map((c) => c.y + c.h));
    const touches = cards.some((c) => c.x < cutX + 0.01 && c.x + c.w > cutX - 0.01);
    if (!touches) { ctx.moveTo(cutX, 0); ctx.lineTo(cutX, paper.h); }
    else { ctx.moveTo(cutX, 0); ctx.lineTo(cutX, top); ctx.moveTo(cutX, bottom); ctx.lineTo(cutX, paper.h); }
    ctx.stroke();
  }
  ctx.restore();
}

const inside = (p, x, y) => x >= 0 && x <= p.w && y >= 0 && y <= p.h;
const nearCut = (x, cutX) => cutX != null && Math.abs(x - cutX) < 0.01;

/**
 * Build a cache of progressively halved copies of a bitmap so large downscales stay sharp
 * (browsers' single-pass downscale aliases badly below ~0.5×).
 */
export function makeSourceCache() {
  const cache = new WeakMap();
  return function sourceFor(photo, pxPerSrc) {
    if (pxPerSrc >= 0.5) return { img: photo.bitmap, factor: 1 };
    let entry = cache.get(photo.bitmap);
    if (!entry) { entry = [{ img: photo.bitmap, factor: 1 }]; cache.set(photo.bitmap, entry); }
    let last = entry[entry.length - 1];
    while (pxPerSrc / last.factor < 0.5 && last.img.width > 64) {
      const w = Math.max(1, Math.round(last.img.width / 2));
      const h = Math.max(1, Math.round(last.img.height / 2));
      const cv = makeCanvas(w, h);
      const cx = cv.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(last.img, 0, 0, w, h);
      last = { img: cv, factor: last.factor / 2 };
      entry.push(last);
    }
    // Pick the smallest copy that still keeps the final step ≥ 0.5×.
    let best = entry[0];
    for (const e of entry) if (pxPerSrc / e.factor <= 1 && pxPerSrc / e.factor >= 0.5) best = e;
    if (best === entry[0] && pxPerSrc < 0.5) best = entry[entry.length - 1];
    return best;
  };
}

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
