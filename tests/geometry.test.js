import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, cropRect, effectiveDpi, chooseDpi, sheetPixels, PAPERS, DEFAULT_PAPER, MINI_ASPECT } from '../app/src/geometry.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('RP-108 is the default paper; only CP1500 sets are offered', () => {
  assert.equal(DEFAULT_PAPER, 'RP-108');
  assert.deepEqual(Object.keys(PAPERS), ['RP-108', 'KP-108IN', 'RP-54', 'KP-36IP', 'KL-36IP', 'KC-36IP', 'KC-18IF', 'KC-18IS']);
  assert.deepEqual([PAPERS['RP-108'].w, PAPERS['RP-108'].h], [148, 100]);
  assert.deepEqual([PAPERS['KL-36IP'].w, PAPERS['KL-36IP'].h], [119, 89]);
  assert.deepEqual([PAPERS['KC-36IP'].w, PAPERS['KC-36IP'].h], [86, 54]);
});

test('every paper splits into two equal halves cut down the middle', () => {
  for (const id of Object.keys(PAPERS)) {
    const L = computeLayout(id);
    const [a, b] = L.cards;
    near(L.cutX, L.paper.w / 2);
    near(a.x, 0); near(a.w, L.paper.w / 2); near(b.x, L.cutX); near(b.x + b.w, L.paper.w);
    near(a.h, L.paper.h);
  }
});

test('frame window keeps the Instax 46:62 shape with equal side and top borders and a chin', () => {
  for (const id of Object.keys(PAPERS)) {
    const { cards } = computeLayout(id);
    for (const c of cards) {
      near(c.win.w / c.win.h, MINI_ASPECT, 1e-3);
      const side = c.win.x - c.x;
      near(c.x + c.w - (c.win.x + c.win.w), side);
      near(c.win.y - c.y, side);
      assert.ok(c.chin.h > side * 0.5, `${id}: chin ${c.chin.h} vs side ${side}`);
      near(c.chin.y + c.chin.h, c.h);
    }
  }
});

test('RP-108 half sheet: 9 mm borders, 56 mm wide window', () => {
  const c = computeLayout('RP-108').cards[0];
  near(c.win.x, 9); near(c.win.y, 9); near(c.win.w, 56);
  near(c.chin.h, 100 - 9 - 56 / MINI_ASPECT);
});

test('cropRect never stretches and stays inside the image', () => {
  const c = cropRect(4000, 3000, 0, MINI_ASPECT, 1, 0.5, 0.5);
  near(c.w / c.h, MINI_ASPECT, 1e-9);
  near(c.h, 3000);
  const z = cropRect(4000, 3000, 0, MINI_ASPECT, 2, 1, 1);
  assert.ok(z.x + z.w <= 4000 + 1e-9 && z.y + z.h <= 3000 + 1e-9);
});

test('rotation by 90° swaps the working dimensions; 180° does not', () => {
  assert.equal(cropRect(4000, 3000, 90, MINI_ASPECT).W, 3000);
  assert.equal(cropRect(4000, 3000, 180, MINI_ASPECT).W, 4000);
});

test('output dpi follows the sharpest photo with no fixed ceiling, only the pixel budget', () => {
  const p = PAPERS['RP-108'];
  assert.equal(chooseDpi([], p, 120e6), 300);
  assert.equal(chooseDpi([150], p, 120e6), 300);
  assert.equal(chooseDpi([1407.2], p, 120e6), 1408);
  assert.equal(chooseDpi([1407.2, 2000], p, 120e6), 2000);
  assert.equal(chooseDpi([5000], p, 120e6), 2287); // 120 MP budget on a 148 × 100 mm sheet
  const capped = chooseDpi([9000], p, 16_777_216);
  const px = sheetPixels(p, capped);
  assert.ok(px.w * px.h <= 16_777_216 * 1.002, `${px.w}x${px.h}`);
  assert.ok(capped > 850); // iOS canvas limit still allows ~855 dpi on a postcard
});

test('effectiveDpi: 2268 px across 46 mm ≈ 1252 dpi', () => {
  near(effectiveDpi(2268, 46), 1252.3, 0.1);
});
