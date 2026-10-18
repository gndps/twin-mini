import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetLayout, cropRect, effectiveDpi, chooseDpi, sheetPixels, PAPERS, DEFAULT_PAPER, MINI_ASPECT } from '../app/src/geometry.js';


// One layout for every print, cards in sheet coordinates (prints face their slot's way).
function computeLayout(o = {}) {
  if (typeof o === 'string') o = { paperId: o };
  const { paperId, customPaper, format = 'two', orientation = format === 'one' ? 'landscape' : 'portrait', aspect, flip, w = null, h = null, top = null } = o;
  const turn = format === 'one' && orientation === 'landscape' && flip === false;
  const print = { orientation, layout: { aspect, turn, w, h, top } };
  const L = sheetLayout({ paperId, customPaper, format, prints: [print, print] });
  const cards = L.slots.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, win: { ...s.card.win, x: s.x + s.card.win.x }, chin: s.card.chin }));
  const c = L.slots[0].card;
  return { paper: L.paper, cutX: L.cutX, cards, ratio: c.ratio, w: c.fw, h: c.fh, top: c.ftop };
}

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

test('frame window keeps the Instax 46:62 shape, top border no wider than the sides, and a chin', () => {
  for (const id of Object.keys(PAPERS)) {
    const { cards } = computeLayout(id);
    for (const c of cards) {
      near(c.win.w / c.win.h, MINI_ASPECT, 1e-3);
      const side = c.win.x - c.x;
      near(c.x + c.w - (c.win.x + c.win.w), side);
      assert.ok(c.win.y - c.y <= side + 1e-6, `${id}: top ${c.win.y} vs side ${side}`);
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

import { ASPECTS, FORMATS, defaultSize } from '../app/src/geometry.js';

test('shape presets: instant film plus common photo ratios, no Instax Wide', () => {
  assert.deepEqual(ASPECTS.map((a) => a.id), ['mini', 'square', '4x5', '3x4', '2x3', '5x7', '9x16']);
  for (const a of ASPECTS) assert.ok(a.w <= a.h, `${a.id} is portrait or square`);
  assert.equal(FORMATS.two.aspect, 'mini');
  assert.equal(FORMATS.one.aspect, '2x3');
});

test('defaults are unchanged: Two Minis = 56 mm window, 9 mm top and side borders', () => {
  const c = computeLayout().cards[0];
  near(c.win.w, 56); near(c.win.x, 9); near(c.win.y, 9);
});

test('width grows symmetrically and keeps the top border; presets keep their shape', () => {
  for (const aspect of ASPECTS.map((a) => a.id)) {
    for (const w of [0.4, 0.6, 0.8]) {
      const L = computeLayout({ aspect, w, top: 0.1 });
      const a = ASPECTS.find((x) => x.id === aspect);
      for (const c of L.cards) {
        near(c.win.x - c.x, c.x + c.w - (c.win.x + c.win.w));
        near(c.win.y, 10);
        near(c.win.w / c.win.h, a.w / a.h, 2e-3);
        assert.ok(c.win.y + c.win.h <= c.h + 1e-6);
      }
      near(L.cutX, 74);
    }
  }
});

test('custom height changes only the height and keeps the top border anchored', () => {
  const a = computeLayout({ aspect: 'custom', w: 0.7, h: 0.5, top: 0.12 }).cards[0];
  const b = computeLayout({ aspect: 'custom', w: 0.7, h: 0.6, top: 0.12 }).cards[0];
  near(a.win.y, 12); near(b.win.y, 12);
  near(a.win.w, b.win.w);
  near(a.win.h, 50); near(b.win.h, 60);
});

test('a photo that no longer fits below the top border gets shorter (presets also narrower)', () => {
  const c = computeLayout({ aspect: 'custom', w: 0.7, h: 0.9, top: 0.3 }).cards[0];
  near(c.win.y + c.win.h, 100);
  const p = computeLayout({ aspect: 'mini', w: 1, top: 0.4 }).cards[0];
  near(p.win.y + p.win.h, 100);
  near(p.win.w / p.win.h, 46 / 62, 2e-3);
});

test('One Wide: landscape rotates the shape on its side by default and can rotate it back', () => {
  const land = computeLayout({ format: 'one' });
  assert.equal(land.cards.length, 1);
  assert.equal(land.cutX, null);
  near(land.cards[0].w, 148);
  near(land.ratio, 3 / 2, 2e-3);
  assert.ok(land.cards[0].chin.h > land.cards[0].win.y, 'chin below the photo');
  near(computeLayout({ format: 'one', flip: false }).ratio, 2 / 3, 2e-3);
  near(computeLayout({ format: 'two' }).ratio, 46 / 62, 1e-3);
});

test('One Wide portrait: upright sheet, upright photo, flip ignored', () => {
  const port = computeLayout({ format: 'one', orientation: 'portrait', flip: true });
  near(port.paper.w, 100); near(port.paper.h, 148);
  near(port.ratio, 2 / 3, 2e-3);
  assert.ok(port.cards[0].chin.h > port.cards[0].win.y);
  near(defaultSize('one', 'portrait'), 0.75);
});

import { OTHER_PAPERS, resolvePaper } from '../app/src/geometry.js';

test('other printer paper sizes are landscape and standard', () => {
  assert.deepEqual([OTHER_PAPERS['4x6in'].w, OTHER_PAPERS['4x6in'].h], [152.4, 101.6]);
  assert.deepEqual([OTHER_PAPERS.A6.w, OTHER_PAPERS.A6.h], [148, 105]);
  for (const p of Object.values(OTHER_PAPERS)) assert.ok(p.w >= p.h, p.id);
  const L = computeLayout({ paperId: '5x7in' });
  near(L.cutX, 177.8 / 2);
});

test('custom paper: any size, normalised to landscape and clamped', () => {
  const p = resolvePaper('custom', { w: 90, h: 120 });
  assert.deepEqual([p.id, p.w, p.h], ['custom', 120, 90]);
  assert.equal(resolvePaper('custom', { w: 5, h: 9999 }).w, 420);
  assert.equal(resolvePaper('custom', { w: 5, h: 9999 }).h, 40);
  const L = computeLayout({ paperId: 'custom', customPaper: { w: 120, h: 90 } });
  near(L.paper.w, 120); near(L.cutX, 60);
  assert.equal(resolvePaper('nope').id, 'RP-108');
});

import { cardLayout, cardToSheet, CORNER } from '../app/src/geometry.js';

test('each print has its own orientation; a landscape print is turned a quarter in its half', () => {
  const L = sheetLayout({ format: 'two', prints: [{ orientation: 'portrait' }, { orientation: 'landscape' }] });
  assert.deepEqual(L.slots.map((s) => s.rot), [0, 90]);
  const [a, b] = L.slots;
  near(a.card.w, 74); near(a.card.h, 100);
  near(b.card.w, 100); near(b.card.h, 74);
  assert.ok(b.card.win.w > b.card.win.h, 'the shape turns with the card');
  // Card corners map back onto the right half of the sheet.
  const p = cardToSheet(b, 0, 0), q = cardToSheet(b, b.card.w, b.card.h);
  near(p.x, 148); near(p.y, 0); near(q.x, 74); near(q.y, 100);
});

test('turning the shape puts a portrait window on a landscape card', () => {
  const c = cardLayout({ W: 148, H: 100, aspect: '2x3', turn: true, size: 0.82 });
  assert.ok(c.win.h > c.win.w);
});

test('photo corners default to the measured Instax rounding and can be tuned', () => {
  const c = cardLayout({ W: 74, H: 100 });
  near(c.radius, CORNER.instax * c.win.w, 1e-3);
  assert.ok(c.radius > 0.2 && c.radius < 0.4, `${c.radius} mm`);
  near(cardLayout({ W: 74, H: 100, corner: 0 }).radius, 0);
  near(cardLayout({ W: 74, H: 100, corner: 0.05 }).radius, 0.05 * 56, 1e-2);
});
