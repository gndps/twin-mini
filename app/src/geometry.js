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

// Border proportions of the half-sheet frame, relative to the half's width
// (9 mm on a 74 mm postcard half). The chin takes whatever height is left.
const SIDE_RATIO = 9 / 74;

const r = (n) => Math.round(n * 1000) / 1000;

/**
 * The sheet is split into two equal halves; each half is one Instax-style card:
 * equal side and top borders, a 46:62 photo window, and the rest of the height as the chin.
 * @returns {{paper, cutX, cards: Array<{x,y,w,h,win,chin,top,left,right}>}}
 */
export function computeLayout(paperId = DEFAULT_PAPER) {
  const paper = PAPERS[paperId] || PAPERS[DEFAULT_PAPER];
  const cw = paper.w / 2, ch = paper.h;
  const side = cw * SIDE_RATIO;
  const winW = cw - 2 * side;
  const winH = winW / MINI_ASPECT;
  const cards = [0, 1].map((i) => {
    const x = i * cw;
    const win = { x: r(x + side), y: r(side), w: r(winW), h: r(winH) };
    return {
      x: r(x), y: 0, w: r(cw), h: r(ch), win,
      // Border bands that captions can sit in.
      top: { x: r(x), y: 0, w: r(cw), h: win.y },
      chin: { x: r(x), y: r(win.y + win.h), w: r(cw), h: r(ch - win.y - win.h) },
      left: { x: r(x), y: 0, w: r(side), h: r(ch) },
      right: { x: r(x + cw - side), y: 0, w: r(side), h: r(ch) },
    };
  });
  return { paper, cutX: cw, cards };
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
