import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, cropRect, effectiveDpi, chooseDpi, sheetPixels, PAPERS, MINI_ASPECT } from '../app/src/geometry.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('true Mini frame matches real film: 54×86 card, 46×62 window', () => {
  const L = computeLayout({ layout: 'mini', frame: 'true', paperId: 'postcard' });
  assert.equal(L.cards.length, 2);
  for (const c of L.cards) {
    near(c.w, 54); near(c.h, 86);
    near(c.win.w, 46); near(c.win.h, 62);
    near(c.win.x - c.x, 4); near(c.win.y - c.y, 6); near(c.chin.h, 18);
  }
  assert.ok(L.fits);
});

test('the two cards are mirror-centred on the cut line', () => {
  for (const paperId of Object.keys(PAPERS)) {
    const L = computeLayout({ layout: 'mini', frame: 'true', paperId });
    const [a, b] = L.cards;
    near(L.cutX - (a.x + a.w), b.x - L.cutX);
    near(a.y, (L.paper.h - a.h) / 2);
  }
});

test('compact preset reproduces the suggested 2×3 in / 300 dpi numbers', () => {
  const L = computeLayout({ layout: 'mini', frame: 'compact' });
  const px = (mm) => Math.round((mm / 25.4) * 300);
  const c = L.cards[0];
  assert.equal(px(c.w), 600);
  assert.equal(px(c.h), 900);
  assert.equal(px(c.win.w), 500);
  assert.equal(px(c.win.h), 674);
  assert.equal(px(c.win.x - c.x), 50);
  assert.equal(px(c.win.y - c.y), 57);
  assert.equal(px(c.chin.h), 169);
});

test('every preset fits inside its half of the sheet with ≥ 2 mm overscan room', () => {
  for (const layout of ['mini', 'wide']) {
    for (const frame of layout === 'mini' ? ['true', 'large', 'compact'] : ['true', 'large']) {
      for (const paperId of Object.keys(PAPERS)) {
        const L = computeLayout({ layout, frame, paperId });
        assert.ok(L.fits, `${layout}/${frame}/${paperId}`);
        for (const c of L.cards) assert.ok(c.y >= 2 && c.y + c.h <= L.paper.h - 2, `${layout}/${frame} vertical room`);
      }
    }
  }
});

test('half-sheet preset fills its cell and keeps the 46:62 window', () => {
  const L = computeLayout({ layout: 'mini', frame: 'half', paperId: 'postcard' });
  const c = L.cards[0];
  near(c.w, 74); near(c.h, 100);
  near(c.win.w / c.win.h, MINI_ASPECT, 1e-3);
});

test('custom frames that are too large are flagged', () => {
  const L = computeLayout({ layout: 'mini', frame: 'custom', custom: { winW: 80, top: 5, side: 5, chin: 20 } });
  assert.equal(L.fits, false);
  assert.ok(L.overflow > 0);
});

test('cropRect never stretches and stays inside the image', () => {
  const c = cropRect(4000, 3000, 0, MINI_ASPECT, 1, 0.5, 0.5);
  near(c.w / c.h, MINI_ASPECT, 1e-9);
  near(c.h, 3000);
  const z = cropRect(4000, 3000, 0, MINI_ASPECT, 2, 1, 1);
  assert.ok(z.x + z.w <= 4000 + 1e-9 && z.y + z.h <= 3000 + 1e-9);
});

test('rotation by 90° swaps the working dimensions; 180° does not', () => {
  const r90 = cropRect(4000, 3000, 90, MINI_ASPECT);
  assert.equal(r90.W, 3000); assert.equal(r90.H, 4000);
  const r180 = cropRect(4000, 3000, 180, MINI_ASPECT);
  assert.equal(r180.W, 4000);
});

test('auto dpi keeps the sharpest photo, bounded 300–1200 and by the pixel budget', () => {
  const p = PAPERS.postcard;
  assert.equal(chooseDpi('auto', [], p, 48e6), 300);
  assert.equal(chooseDpi('auto', [812.4], p, 48e6), 813);
  assert.equal(chooseDpi('auto', [5000], p, 48e6), 1200);
  const capped = chooseDpi('auto', [5000], p, 16_777_216);
  const px = sheetPixels(p, capped);
  assert.ok(px.w * px.h <= 16_777_216);
  assert.equal(chooseDpi('600', [5000], p, 48e6), 600);
});

test('effectiveDpi: 2268 px across 46 mm ≈ 1252 dpi', () => {
  near(effectiveDpi(2268, 46), 1252.3, 0.1);
});
