// Pure layout math. Everything is in millimetres; the renderer converts to pixels.
// No DOM access here so it can be unit-tested in Node.

export const MM_PER_INCH = 25.4;

// Instax Mini image window aspect (46 × 62 mm on real film).
export const MINI_ASPECT = 46 / 62;

// Canon ink/paper sets the SELPHY CP1500 accepts, by product code. Sizes are the printed
// sheet after the perforated tabs are removed (CP1500 manual, Specifications), laid out
// landscape so the two frames sit side by side. The 8-label sheet (KC-18IL, 22 × 17.3 mm
// labels) is left out: a label is too small to hold a frame.
export const PAPERS = {
  'RP-108': { id: 'RP-108', kind: 'Postcard', note: '108 sheets', w: 148, h: 100 },
  'KP-108IN': { id: 'KP-108IN', kind: 'Postcard', note: '108 sheets', w: 148, h: 100 },
  'RP-54': { id: 'RP-54', kind: 'Postcard', note: '54 sheets', w: 148, h: 100 },
  'KP-36IP': { id: 'KP-36IP', kind: 'Postcard', note: '36 sheets', w: 148, h: 100 },
  'KL-36IP': { id: 'KL-36IP', kind: 'L size', note: '36 sheets', w: 119, h: 89 },
  'KC-36IP': { id: 'KC-36IP', kind: 'Card size', note: '36 sheets', w: 86, h: 54 },
  'KC-18IF': { id: 'KC-18IF', kind: 'Card size', note: 'Full-size stickers', w: 86, h: 54 },
  'KC-18IS': { id: 'KC-18IS', kind: 'Square label', note: 'Square stickers', w: 54, h: 54 },
};
export const DEFAULT_PAPER = 'RP-108';

// Photo window shapes (W × H, portrait or square; One Wide can rotate them). Instant-camera
// film first (image areas in mm), then common photo ratios. Polaroid i-Type / 600 / Go are
// square; 2 × 3 ZINK (Kodak Printomatic / Smile, Polaroid Snap) is the same shape as 35 mm.
export const ASPECTS = [
  { id: 'mini', label: 'Instax Mini', cameras: 'Instax Mini, Leica Sofort', w: 46, h: 62 },
  { id: 'square', label: 'Square', cameras: 'Instax Square, Polaroid', w: 1, h: 1 },
  { id: '4x5', label: '4 : 5', cameras: 'Instagram portrait', w: 4, h: 5 },
  { id: '3x4', label: '3 : 4', cameras: 'Phone camera', w: 3, h: 4 },
  { id: '2x3', label: '2 : 3', cameras: '35 mm, ZINK', w: 2, h: 3 },
  { id: '5x7', label: '5 : 7', cameras: 'Photo print', w: 5, h: 7 },
  { id: '9x16', label: '9 : 16', cameras: 'Phone screen', w: 9, h: 16 },
];
export const aspectOf = (id) => ASPECTS.find((a) => a.id === id) || null;

export const FORMATS = {
  two: { label: 'Two Minis', aspect: 'mini', size: 56 / 74 },       // half sheet: 9 mm borders on a postcard half
  one: { label: 'One Wide', aspect: '2x3', size: 0.82 },
};
const PORTRAIT_ONE_SIZE = 0.75;

/** Width ÷ height of a preset shape (rotated on its side for landscape One Wide unless un-flipped). */
export function windowRatio({ format = 'two', orientation = 'landscape', aspect, flip } = {}) {
  const preset = aspectOf(aspect) || aspectOf(FORMATS[format].aspect);
  let a = preset.w / preset.h;
  if (format === 'one' && orientation === 'landscape' && (flip ?? true)) a = 1 / a;
  return a;
}

const r = (n) => Math.round(n * 1000) / 1000;

/** Default width (fraction of the largest preset window that fits) for a format/orientation. */
export function defaultSize(format, orientation) {
  return format === 'one' && orientation === 'portrait' ? PORTRAIT_ONE_SIZE : FORMATS[format].size;
}

/**
 * Lay out the sheet.
 * - two: the sheet is cut down the middle into two cards; one: a single card fills the sheet.
 * - The photo window is always centred left to right.
 *   `w` = window width as a fraction of the card width (grows symmetrically);
 *   `h` = window height as a fraction of the card height (custom shapes only; presets derive it
 *   from the width); `top` = top border as a fraction of the card height. Height changes keep the
 *   top border where it is. Nulls give the defaults: the preset at its default size with the
 *   Instax look (top border ≈ side border, the rest of the height is the chin).
 * - one + portrait: the sheet is used upright (the SELPHY app rotates it onto the paper).
 */
export function computeLayout({ paperId = DEFAULT_PAPER, format = 'two', orientation = 'landscape', aspect, flip, w = null, h = null, top = null } = {}) {
  const base = PAPERS[paperId] || PAPERS[DEFAULT_PAPER];
  const portrait = format === 'one' && orientation === 'portrait';
  const paper = { ...base, w: portrait ? base.h : base.w, h: portrait ? base.w : base.h, portrait };
  const count = format === 'one' ? 1 : 2;
  const W = paper.w / count, H = paper.h;

  const custom = aspect === 'custom';
  const a = windowRatio({ format, orientation, aspect: custom ? FORMATS[format].aspect : aspect, flip });
  let winW = w == null ? Math.min(W, H * a) * defaultSize(format, orientation) : clamp(w, 0.15, 1) * W;
  let winH = custom && h != null ? clamp(h, 0.08, 1) * H : winW / a;
  if (winH > H) { winH = H; if (!custom) winW = H * a; }

  let topMm;
  if (top == null) topMm = Math.min((W - winW) / 2, (H - winH) * 0.37);
  else {
    topMm = clamp(top * H, 0, H * 0.92);
    // The top border is the anchor: if the photo no longer fits below it, it gets shorter
    // (presets keep their shape, so they get narrower too).
    if (topMm + winH > H) { winH = H - topMm; if (!custom) winW = winH * a; }
  }
  const side = (W - winW) / 2;

  const cards = Array.from({ length: count }, (_, i) => {
    const x = i * W;
    const win = { x: r(x + side), y: r(topMm), w: r(winW), h: r(winH) };
    return {
      x: r(x), y: 0, w: r(W), h: r(H), win,
      // Border bands that captions can sit in.
      top: { x: r(x), y: 0, w: r(W), h: win.y },
      chin: { x: r(x), y: r(win.y + win.h), w: r(W), h: r(H - win.y - win.h) },
      left: { x: r(x), y: 0, w: r(side), h: r(H) },
      right: { x: r(x + W - side), y: 0, w: r(side), h: r(H) },
    };
  });
  return {
    paper, cutX: count === 2 ? W : null, cards,
    ratio: winW / winH, w: winW / W, h: winH / H, top: topMm / H, card: { w: W, h: H },
  };
}

export const mmToPx = (mm, dpi) => (mm / MM_PER_INCH) * dpi;

export function sheetPixels(paper, dpi) {
  return { w: Math.round(mmToPx(paper.w, dpi)), h: Math.round(mmToPx(paper.h, dpi)) };
}

/**
 * Crop rectangle (in the photo's *rotated* pixel space) for a window of the given aspect.
 * zoom ≥ 1, (cx, cy) is the crop centre in 0..1 of the rotated image; clamped so the crop
 * never leaves the image (no stretching, no empty edges).
 */
export function cropRect(imgW, imgH, rot, aspect, zoom = 1, cx = 0.5, cy = 0.5) {
  const swap = rot % 180 !== 0;
  const W = swap ? imgH : imgW;
  const H = swap ? imgW : imgH;
  let cw, ch;
  if (W / H > aspect) { ch = H; cw = H * aspect; } else { cw = W; ch = W / aspect; }
  cw /= zoom; ch /= zoom;
  const x = clamp(cx * W - cw / 2, 0, W - cw);
  const y = clamp(cy * H - ch / 2, 0, H - ch);
  return { x, y, w: cw, h: ch, W, H };
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/** Effective print resolution of a photo when its crop fills a window `winWmm` wide. */
export function effectiveDpi(cropW, winWmm) {
  return cropW / (winWmm / MM_PER_INCH);
}

/**
 * Output dpi: as high as the sharpest photo supports, so no source pixel is thrown away,
 * never below the printer's native 300 dpi, and within the browser's canvas pixel budget.
 */
export function chooseDpi(photoDpis, paper, maxPixels) {
  const budget = Math.floor(Math.sqrt(maxPixels / ((paper.w / MM_PER_INCH) * (paper.h / MM_PER_INCH))));
  return Math.max(1, Math.min(Math.ceil(Math.max(300, ...photoDpis)), budget));
}
