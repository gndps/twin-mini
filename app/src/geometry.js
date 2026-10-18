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

// Common photo / printer paper sizes for other printers, landscape (W ≥ H), mm.
export const OTHER_PAPERS = {
  '4x6in': { id: '4x6in', kind: '4 × 6 in', note: 'Standard photo print', w: 152.4, h: 101.6 },
  '5x7in': { id: '5x7in', kind: '5 × 7 in', note: 'Large photo print', w: 177.8, h: 127 },
  '3.5x5in': { id: '3.5x5in', kind: '3.5 × 5 in', note: 'L size photo print', w: 127, h: 88.9 },
  '4x4in': { id: '4x4in', kind: '4 × 4 in', note: 'Square photo print', w: 101.6, h: 101.6 },
  '8x10in': { id: '8x10in', kind: '8 × 10 in', note: 'Enlargement', w: 254, h: 203.2 },
  A6: { id: 'A6', kind: 'A6', note: 'Postcard (ISO)', w: 148, h: 105 },
  A5: { id: 'A5', kind: 'A5', note: 'Half A4', w: 210, h: 148 },
  A4: { id: 'A4', kind: 'A4', note: 'Office printer', w: 297, h: 210 },
  letter: { id: 'letter', kind: 'US Letter', note: 'Office printer', w: 279.4, h: 215.9 },
};
export const CUSTOM_PAPER = { min: 40, max: 420 };

/**
 * The paper to lay out: a CP1500 set, another common size, or a custom W × H (mm).
 * Always returned landscape (W ≥ H) so two frames sit side by side.
 */
export function resolvePaper(paperId, custom) {
  if (PAPERS[paperId]) return PAPERS[paperId];
  if (OTHER_PAPERS[paperId]) return OTHER_PAPERS[paperId];
  if (paperId === 'custom' && custom) {
    const a = clamp(Number(custom.w) || 0, CUSTOM_PAPER.min, CUSTOM_PAPER.max);
    const b = clamp(Number(custom.h) || 0, CUSTOM_PAPER.min, CUSTOM_PAPER.max);
    const w = Math.max(a, b), h = Math.min(a, b);
    return { id: 'custom', kind: 'Custom', note: '', w, h };
  }
  return PAPERS[DEFAULT_PAPER];
}

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
  two: { label: 'Two Minis', aspect: 'mini', count: 2 },
  one: { label: 'One Wide', aspect: '2x3', count: 1 },
};
export const ORIENTATIONS = ['portrait', 'landscape'];

// Photo-window corner rounding, as a fraction of the window's short side. Instax film masks the
// picture with very slightly rounded corners: about 0.23 mm on the 46 mm side of a Mini image,
// measured from high-resolution scans of real Mini and Square prints (Fujifilm publishes no figure).
export const CORNER = { instax: 0.005, max: 0.12 };

/** Default photo width: a fraction of the largest window of this shape that fits the card. */
export function defaultSize(format, orientation) {
  if (format === 'one') return orientation === 'portrait' ? 0.75 : 0.82;
  return orientation === 'landscape' ? 0.82 : 56 / 74; // half sheet: 9 mm borders on a postcard half
}

/**
 * Width ÷ height of a preset shape on a card. A shape follows the card: upright on a portrait
 * card, on its side on a landscape one; `turn` turns it the other way.
 */
export function windowRatio(aspect, cardW, cardH, turn = false) {
  const preset = aspectOf(aspect) || ASPECTS[0];
  const a = preset.w / preset.h;
  return (cardW > cardH) !== !!turn ? 1 / a : a;
}

const r = (n) => Math.round(n * 1000) / 1000;

/**
 * Lay out one print (card) in its own upright frame, W × H mm.
 * - The photo window is always centred left to right.
 *   `w` = window width as a fraction of the card width (grows symmetrically);
 *   `h` = window height as a fraction of the card height (custom shapes only; presets derive it
 *   from the width); `top` = top border as a fraction of the card height. Height changes keep the
 *   top border where it is. Nulls give the defaults: the preset at its default size with the
 *   Instax look (top border ≈ side border, the rest of the height is the chin).
 * - `corner` rounds the window corners (fraction of its short side; null = Instax).
 */
export function cardLayout({ W, H, aspect = 'mini', turn = false, w = null, h = null, top = null, corner = null, size = 56 / 74 }) {
  const custom = aspect === 'custom';
  const a = windowRatio(custom ? 'mini' : aspect, W, H, turn);
  let winW = w == null ? Math.min(W, H * a) * size : clamp(w, 0.15, 1) * W;
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
  const win = { x: r(side), y: r(topMm), w: r(winW), h: r(winH) };
  const round = (corner == null ? CORNER.instax : clamp(corner, 0, CORNER.max)) * Math.min(win.w, win.h);
  return {
    w: r(W), h: r(H), win, radius: r(round),
    chin: { y: r(win.y + win.h), h: r(H - win.y - win.h) },
    ratio: winW / winH, fw: winW / W, fh: winH / H, ftop: topMm / H,
  };
}

/**
 * Lay out the sheet: `two` cuts it down the middle into two cards, `one` fills it with one.
 * Each print has its own orientation. A print whose orientation differs from its half of the
 * sheet is turned a quarter (rot 90) to fit; One Wide portrait uses the sheet upright instead
 * (the SELPHY app rotates it onto the paper).
 * Returns slots in sheet mm: { x, y, w, h, rot, card } where card is the print's own layout.
 */
export function sheetLayout({ paperId = DEFAULT_PAPER, customPaper, format = 'two', prints = [] } = {}) {
  const base = resolvePaper(paperId, customPaper);
  const n = format === 'one' ? 1 : 2;
  const upright = format === 'one' && prints[0]?.orientation === 'portrait';
  const paper = { ...base, w: upright ? base.h : base.w, h: upright ? base.w : base.h, portrait: upright };
  const SW = paper.w / n, SH = paper.h;
  const slots = Array.from({ length: n }, (_, i) => {
    const p = prints[i] || {};
    const land = p.orientation === 'landscape';
    const rot = SW !== SH && (SW > SH) !== land ? 90 : 0;
    const [W, H] = rot ? [SH, SW] : [SW, SH];
    const card = cardLayout({ W, H, ...(p.layout || {}), aspect: p.layout?.aspect || FORMATS[format].aspect, size: defaultSize(format, p.orientation) });
    return { x: r(i * SW), y: 0, w: r(SW), h: r(SH), rot, card };
  });
  return { paper, cutX: n === 2 ? SW : null, slots };
}

/** Map a point in a card's own mm to sheet mm (inverse of how renderSheet places the card). */
export function cardToSheet(slot, x, y) {
  return slot.rot ? { x: slot.x + slot.w - y, y: slot.y + x } : { x: slot.x + x, y: slot.y + y };
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
