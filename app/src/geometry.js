// Pure layout math. Everything is in millimetres; the renderer converts to pixels.
// No DOM access here so it can be unit-tested in Node.

export const MM_PER_INCH = 25.4;

// Instax image window aspect (46 × 62 mm on real Mini film).
export const MINI_ASPECT = 46 / 62;
export const WIDE_ASPECT = 99 / 62;

export const PAPERS = {
  postcard: { id: 'postcard', label: 'SELPHY Postcard', detail: '148 × 100 mm · KP-108IN', w: 148, h: 100 },
  '4x6': { id: '4x6', label: '4 × 6 in', detail: '152.4 × 101.6 mm', w: 152.4, h: 101.6 },
};

// Frame specs: window size + margins. Card = window + margins.
// `fill: true` means the card grows to fill its half of the sheet (only cut the middle).
export const FRAMES = {
  mini: {
    'true': { label: 'True Mini', detail: '54 × 86 mm · real film size', winW: 46, winH: 62, top: 6, side: 4, chin: 18 },
    large: { label: 'Large', detail: '59 × 95 mm · +10%', winW: 50.6, winH: 68.2, top: 6.6, side: 4.4, chin: 19.8 },
    compact: { label: 'Compact', detail: '2 × 3 in · 50.8 × 76.2 mm', winW: 42.33, winH: 57.07, top: 4.83, side: 4.23, chin: 14.3 },
    half: { label: 'Half sheet', detail: 'Cut the middle only', fill: true, side: 9, top: 9 },
  },
  wide: {
    'true': { label: 'True Wide', detail: '108 × 86 mm · real film size', winW: 99, winH: 62, top: 6, side: 4.5, chin: 18 },
    large: { label: 'Large', detail: '119 × 95 mm · +10%', winW: 108.9, winH: 68.2, top: 6.6, side: 4.95, chin: 19.8 },
  },
};

export function frameSpec(layout, frameId, paper, custom) {
  if (frameId === 'custom') {
    const winW = custom.winW;
    const winH = layout === 'wide' ? winW / WIDE_ASPECT : winW / MINI_ASPECT;
    return { winW, winH, top: custom.top, side: custom.side, chin: custom.chin };
  }
  const f = FRAMES[layout][frameId] || FRAMES[layout]['true'];
  if (!f.fill) return f;
  const cell = cellSize(layout, paper);
  const winW = cell.w - 2 * f.side;
  const winH = winW / MINI_ASPECT;
  return { winW, winH, top: f.top, side: f.side, chin: cell.h - f.top - winH };
}

export function cellSize(layout, paper) {
  return layout === 'wide' ? { w: paper.w, h: paper.h } : { w: paper.w / 2, h: paper.h };
}

const r = (n) => Math.round(n * 1000) / 1000;

/**
 * Compute every rectangle on the sheet.
 * @returns {{paper, cards: Array<{x,y,w,h,win:{x,y,w,h},chin:{x,y,w,h}}>, cutX: number|null, fits: boolean, overflow: number}}
 */
export function computeLayout({ layout = 'mini', frame = 'true', paperId = 'postcard', custom } = {}) {
  const paper = PAPERS[paperId] || PAPERS.postcard;
  const spec = frameSpec(layout, frame, paper, custom || { winW: 46, top: 6, side: 4, chin: 18 });
  const cardW = spec.winW + 2 * spec.side;
  const cardH = spec.top + spec.winH + spec.chin;
  const cell = cellSize(layout, paper);
  const count = layout === 'wide' ? 1 : 2;
  const cards = [];
  for (let i = 0; i < count; i++) {
    const x = i * cell.w + (cell.w - cardW) / 2;
    const y = (cell.h - cardH) / 2;
    cards.push({
      x: r(x), y: r(y), w: r(cardW), h: r(cardH),
      win: { x: r(x + spec.side), y: r(y + spec.top), w: r(spec.winW), h: r(spec.winH) },
      chin: { x: r(x), y: r(y + spec.top + spec.winH), w: r(cardW), h: r(spec.chin) },
    });
  }
  const overflow = Math.max(cardW - cell.w, cardH - cell.h, 0);
  return { paper, cards, cutX: count === 2 ? paper.w / 2 : null, fits: overflow < 0.01, overflow: r(overflow), spec };
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
 * Pick the output dpi. 'auto' matches the sharpest photo (so no source pixel is thrown away),
 * bounded below by the printer's native 300 dpi and above by 1200 dpi and the canvas pixel budget.
 */
export function chooseDpi(mode, photoDpis, paper, maxPixels) {
  const budget = Math.floor(Math.sqrt(maxPixels / (paper.w * paper.h)) * MM_PER_INCH);
  let dpi = mode === 'auto'
    ? clamp(Math.ceil(Math.max(300, ...photoDpis)), 300, 1200)
    : Number(mode);
  return Math.min(dpi, budget);
}
