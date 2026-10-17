// Canvas renderer: draws the whole print sheet at any scale (px per mm).
import { cropRect } from './geometry.js';
import { fontCss } from './fonts.js';
import { CAPTION_COLORS, effectiveShift } from './captions.js';

export const FRAME_COLORS = [
  { id: 'white', label: 'White', fill: '#FFFFFF', ink: '#2E2B28' },
  { id: 'cream', label: 'Cream', fill: '#F6F1E6', ink: '#3A3631' },
  { id: 'blush', label: 'Blush', fill: '#F3DCD6', ink: '#4A3330' },
  { id: 'sage', label: 'Sage', fill: '#DCE4D6', ink: '#2F3A2C' },
  { id: 'sky', label: 'Sky', fill: '#D9E3EC', ink: '#2C3540' },
  { id: 'butter', label: 'Butter', fill: '#F5EAC2', ink: '#4A4128' },
  { id: 'ink', label: 'Black', fill: '#1B1A19', ink: '#EDE8DF' },
];

// Cut guide: short, sparse hairline dashes down the whole centre line, evenly spaced from the
// top edge to the bottom. Light warm grey, one 300-dpi printer dot wide (≈ 0.085 mm).
const HINT = { color: '#CFCAC2', width: 0.09, dash: 0.6, gap: 1.8 };

/**
 * Draw the sheet.
 * @param ctx CanvasRenderingContext2D sized paper.w*scale × paper.h*scale
 * @param layout result of computeLayout() (cards may be a subset)
 * @param slots [{photo, captions}] per card; captions are resolved layers (see resolveLayers)
 * @param opts {scale, color, marks, sourceFor(photo, pxPerSrc) -> {img}, origin?, keepBackground?}
 */
export function renderSheet(ctx, layout, slots, opts) {
  const { scale, color, marks } = opts;
  const { cards } = layout;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!opts.keepBackground) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.scale(scale, scale);
  if (opts.origin) ctx.translate(-opts.origin.x, -opts.origin.y);

  cards.forEach((card, i) => {
    const slot = slots[i] || {};
    ctx.fillStyle = color.fill;
    ctx.fillRect(card.x, card.y, card.w, card.h);
    const { win } = card;
    if (slot.photo) drawPhoto(ctx, slot.photo, win, scale, opts.sourceFor);
    else {
      ctx.fillStyle = color.id === 'ink' ? '#2A2826' : '#EFEDE9';
      ctx.fillRect(win.x, win.y, win.w, win.h);
    }
    if (slot.captions?.length) drawCaptions(ctx, card, slot.captions, color.ink, opts.hits && { list: opts.hits, card: i, skip: opts.skip });
  });

  if (marks && layout.cutX != null) drawCutHint(ctx, layout, scale);
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

const LINE = 1.22; // line height as a multiple of the font size

/**
 * Captions are grouped by edge and stacked in reading order, centred across the border band,
 * then nudged by their own `shift` (mm) toward the photo (may overlap it) or away from it,
 * anchored to the photo edge or the paper edge as the photo is resized (see effectiveShift).
 * Along the edge they align to the photo window (start / centre / end), like hand-written
 * notes on real film. Side captions are rotated: the left reads upwards, the right downwards.
 */
function drawCaptions(ctx, card, captions, autoInk, hits) {
  const { win } = card;
  for (const edge of ['bottom', 'top', 'left', 'right']) {
    const lines = captions.filter((c) => c.edge === edge);
    if (!lines.length) continue;
    const band = edge === 'bottom' ? card.chin : edge === 'top' ? card.top : card[edge];
    const vertical = edge === 'left' || edge === 'right';
    const across = vertical ? band.w : band.h;          // room across the band
    const length = vertical ? win.h : win.w;             // room along the edge
    const total = lines.reduce((s, l) => s + l.size * LINE, 0);
    const k = total > across * 0.92 ? (across * 0.92) / total : 1; // shrink to fit the band

    ctx.save();
    if (vertical) {
      ctx.translate(band.x + band.w / 2, win.y + win.h / 2);
      ctx.rotate(edge === 'left' ? -Math.PI / 2 : Math.PI / 2);
    } else {
      ctx.translate(win.x + win.w / 2, band.y + band.h / 2);
    }
    // +1 means "away from the photo" along the local y axis of this edge.
    const away = edge === 'bottom' ? 1 : -1;
    let y = -(total * k) / 2;
    for (const l of lines) {
      let size = l.size * k;
      const lh = size * LINE;
      const dy = away * effectiveShift(l, across);
      ctx.font = `${size}px ${fontCss(l.font)}`;
      // Too long for the edge: shrink this line to fit (down to 35 % of its size), so the
      // whole caption prints instead of being cut off; only past that is it shortened with "…".
      const wide = l.text ? ctx.measureText(l.text).width : 0;
      if (wide > length) {
        size = Math.max(size * 0.35, size * (length / wide) * 0.98);
        ctx.font = `${size}px ${fontCss(l.font)}`;
      }
      ctx.fillStyle = CAPTION_COLORS.find((c) => c.id === l.color)?.value || autoInk;
      ctx.textBaseline = 'middle';
      ctx.textAlign = l.align === 'start' ? 'left' : l.align === 'end' ? 'right' : 'center';
      const x = l.align === 'start' ? -length / 2 : l.align === 'end' ? length / 2 : 0;
      const cy = y + lh / 2 + dy;
      // Captions being edited in place (or still empty) are drawn by the overlay instead.
      const skipped = hits?.skip && hits.skip.id === l.id && hits.skip.card === hits.card;
      if (l.text && !skipped) ctx.fillText(fit(ctx, l.text, length), x, cy);
      if (hits) {
        // Where this line sits on the sheet (mm), so an editor can be laid exactly over it.
        const m = ctx.getTransform();
        const sc = Math.hypot(m.a, m.b);
        const ox = m.e / sc, oy = m.f / sc; // sheet mm of local (0,0); scale is uniform
        const ang = Math.atan2(m.b, m.a);
        const cx = ox + Math.cos(ang) * 0 - Math.sin(ang) * cy;
        const cyS = oy + Math.sin(ang) * 0 + Math.cos(ang) * cy;
        hits.list.push({
          card: hits.card, id: l.id, kind: l.kind, cx, cy: cyS, len: length, lh, rot: (ang * 180) / Math.PI,
          align: l.align, size, font: fontCss(l.font), color: ctx.fillStyle,
        });
      }
      y += lh;
    }
    ctx.restore();
  }
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
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
