// Canvas renderer: draws prints (cards) and the whole print sheet at any scale (px per mm).
import { cropRect } from './geometry.js';
import { fontCss } from './fonts.js';
import { formatDate } from './captions.js';
import { frameColor } from './model.js';
import { stickerById } from './stickers.js';

// Cut guide: short, sparse hairline dashes down the whole centre line, evenly spaced from the
// top edge to the bottom. Light warm grey, one 300-dpi printer dot wide (≈ 0.085 mm).
const HINT = { color: '#CFCAC2', width: 0.09, dash: 0.6, gap: 1.8 };
export const LINE = 1.22; // text line height as a multiple of the font size
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/**
 * Draw the sheet: each print in its slot, turned a quarter when it faces the other way.
 * @param layout result of sheetLayout()
 * @param items [{ print, photo }] per slot; a missing item leaves that half blank
 * @param opts { scale, marks, sourceFor, photoDate(i), assets, keepBackground }
 */
export function renderSheet(ctx, layout, items, opts) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!opts.keepBackground) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.scale(opts.scale, opts.scale);
  layout.slots.forEach((slot, i) => {
    const item = items[i];
    if (!item) return;
    ctx.save();
    if (slot.rot) { ctx.translate(slot.x + slot.w, slot.y); ctx.rotate(Math.PI / 2); } else ctx.translate(slot.x, slot.y);
    drawCard(ctx, slot.card, item.print, item.photo, { ...opts, photoDate: item.photoDate });
    ctx.restore();
  });
  if (opts.marks && layout.cutX != null) drawCutHint(ctx, layout, opts.scale);
  ctx.restore();
}

/**
 * Draw one print at the origin in its own mm (the caller sets the scale).
 * opts: { scale (device px per mm), sourceFor, photoDate, assets, skip (element id to leave out),
 *         boxes (Map filled with each element's box), placeholder (colour for an empty window) }
 */
export function drawCard(ctx, card, print, photo, opts) {
  const color = frameColor(print.color);
  ctx.fillStyle = color.fill;
  ctx.fillRect(0, 0, card.w, card.h);
  const { win } = card;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(win.x, win.y, win.w, win.h, card.radius) : ctx.rect(win.x, win.y, win.w, win.h);
  ctx.clip();
  if (photo) drawPhoto(ctx, photo, print.crop, win, opts.scale, opts.sourceFor);
  else {
    ctx.fillStyle = opts.placeholder || (color.id === 'ink' ? '#2A2826' : '#EFEDE9');
    ctx.fillRect(win.x, win.y, win.w, win.h);
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, card.w, card.h);
  ctx.clip();
  for (const el of print.elements) {
    const box = drawElement(ctx, el, card, color.ink, opts, el.id === opts.skip);
    if (box) opts.boxes?.set(el.id, box);
  }
  ctx.restore();
}

function drawPhoto(ctx, photo, crop, win, scale, sourceFor) {
  const c = cropRect(photo.width, photo.height, crop.rot, win.w / win.h, crop.zoom, crop.cx, crop.cy);
  const pxPerSrc = (win.w * scale) / c.w; // device px per source px
  const { img } = sourceFor(photo, pxPerSrc);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Map rotated-image space → window.
  ctx.translate(win.x, win.y);
  ctx.scale(win.w / c.w, win.h / c.h);
  ctx.translate(-c.x, -c.y);
  // Map original-image space → rotated space (clockwise rotation, never mirrored).
  const W = photo.width, H = photo.height;
  switch (crop.rot) {
    case 90: ctx.translate(H, 0); ctx.rotate(Math.PI / 2); break;
    case 180: ctx.translate(W, H); ctx.rotate(Math.PI); break;
    case 270: ctx.translate(0, W); ctx.rotate(-Math.PI / 2); break;
  }
  ctx.drawImage(img, 0, 0, W, H);
  ctx.restore();
}

/** The text an element shows (dates are formatted from the photo's time or now). */
export function elementText(el, photoDate) {
  if (el.type === 'text') return el.text;
  if (el.type === 'date') return formatDate(el.source === 'now' ? new Date() : photoDate || new Date(), el.fmt);
  return '';
}

/** Readable text on a coloured box: black or white, whichever contrasts more. */
export function contrastInk(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#1C1B19' : '#FFFFFF';
}

/**
 * Draw one element (unless `hidden`) and return its box in card mm:
 * { ax, ay (anchor), w, h, ox (box centre along the element's own x from the anchor), rot (deg) }.
 */
export function drawElement(ctx, el, card, autoInk, opts = {}, hidden = false) {
  const ax = el.x * card.w, ay = el.y * card.h;
  const rad = (el.rot * Math.PI) / 180;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(rad);
  let box;
  if (el.type === 'text' || el.type === 'date') {
    const text = elementText(el, opts.photoDate) || '';
    const lines = text.split('\n');
    const size = el.size, lh = size * LINE;
    ctx.font = `${size}px ${fontCss(el.font)}`;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const bw = Math.max(size * 0.5, ...widths), bh = lines.length * lh;
    const ox = el.align === 'left' ? bw / 2 : el.align === 'right' ? -bw / 2 : 0;
    const color = el.color === 'auto' ? autoInk : el.color;
    const padX = size * 0.32, padY = size * 0.08;
    box = { w: bw + (el.bg !== 'none' ? padX * 2 : 0), h: bh + (el.bg !== 'none' ? padY * 2 : 0), ox };
    if (!hidden && text.trim()) {
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      lines.forEach((line, k) => {
        const w = widths[k];
        const cx = el.align === 'left' ? w / 2 : el.align === 'right' ? -w / 2 : 0;
        const cy = -bh / 2 + lh * (k + 0.5);
        if (el.bg !== 'none' && line.trim()) {
          // Like a story's text background: one rounded box per line.
          ctx.fillStyle = color;
          ctx.globalAlpha = el.bg === 'soft' ? 0.45 : 1;
          ctx.beginPath();
          const rx = cx - w / 2 - padX, ry = cy - lh / 2 - padY;
          ctx.roundRect ? ctx.roundRect(rx, ry, w + padX * 2, lh + padY * 2, size * 0.28) : ctx.rect(rx, ry, w + padX * 2, lh + padY * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = el.bg === 'solid' ? contrastInk(color) : el.bg === 'soft' ? contrastInk(color) : color;
        ctx.fillText(line, cx, cy);
      });
    }
  } else if (el.type === 'emoji') {
    ctx.font = `${el.size}px ${EMOJI_FONT}`;
    const w = ctx.measureText(el.char).width || el.size;
    box = { w, h: el.size * 1.1, ox: 0 };
    if (!hidden) {
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      ctx.fillText(el.char, 0, el.size * 0.06);
    }
  } else if (el.type === 'sticker') {
    const s = stickerById(el.sticker);
    if (!s) { ctx.restore(); return null; }
    const k = el.size / s.vh;
    box = { w: s.vw * k, h: el.size, ox: 0 };
    if (!hidden) {
      ctx.scale(k, k);
      ctx.translate(-s.vw / 2, -s.vh / 2);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const ink = el.color || s.tint;
      for (const part of s.parts) {
        const path = new Path2D(part.d);
        ctx.globalAlpha = part.alpha ?? 1;
        if (part.fill) { ctx.fillStyle = part.fill === 'tint' ? ink : part.fill; ctx.fill(path); }
        if (part.stroke) { ctx.strokeStyle = part.stroke === 'tint' ? ink : part.stroke; ctx.lineWidth = part.width; ctx.stroke(path); }
      }
      ctx.globalAlpha = 1;
    }
  } else if (el.type === 'image') {
    const w = el.size * el.ratio;
    box = { w, h: el.size, ox: 0 };
    const a = opts.assets?.get(el.asset);
    if (!hidden && a?.img) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(a.img, -w / 2, -el.size / 2, w, el.size);
    }
  }
  ctx.restore();
  return box && { ...box, ax, ay, rot: el.rot };
}

function drawCutHint(ctx, layout, scale) {
  const { paper, cutX } = layout;
  const step = HINT.dash + HINT.gap;
  // Centre the dash pattern so both paper edges end the same way.
  const n = Math.floor((paper.h + HINT.gap) / step);
  const y0 = (paper.h - (n * step - HINT.gap)) / 2;
  ctx.save();
  ctx.strokeStyle = HINT.color;
  ctx.lineWidth = Math.max(HINT.width, 1 / scale); // ≥ one printer dot and ≥ one device pixel
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const y = y0 + k * step;
    ctx.moveTo(cutX, y); ctx.lineTo(cutX, y + HINT.dash);
  }
  ctx.stroke();
  ctx.restore();
}

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
