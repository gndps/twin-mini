import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExifDate, parseExifDate } from '../app/src/exif.js';

/** Build a minimal big- or little-endian JPEG with Exif DateTimeOriginal. */
function jpegWithDate(s, le = false) {
  const tiff = [];
  const u16 = (v) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  // header(8) | IFD0 at 8: 1 entry (ExifIFD ptr) -> 2+12+4 = 18 -> Exif IFD at 26: 1 entry -> 18 -> data at 44
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(44), ...u32(0));
  tiff.push(...[...s].map((c) => c.charCodeAt(0)), 0);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2]).buffer;
}

test('reads DateTimeOriginal from big- and little-endian EXIF', () => {
  for (const le of [false, true]) {
    const d = readExifDate(jpegWithDate('2025:07:04 18:30:05', le));
    assert.ok(d, `le=${le}`);
    assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()], [2025, 7, 4, 18]);
  }
});

test('non-JPEG or missing EXIF gives null', () => {
  assert.equal(readExifDate(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer), null);
  assert.equal(readExifDate(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), null);
  assert.equal(parseExifDate('0000:00:00 00:00:00'), null);
});

import { formatDate, defaultDateFormat, DATE_OPTIONS, migrateDate, sanitizeLayers, SHIFT, nextDateStyle, DATE_STYLES, effectiveShift } from '../app/src/captions.js';

const D = new Date(2026, 9, 7, 16, 5, 9); // Wed 7 Oct 2026, 16:05:09
const fmt = (o) => formatDate(D, { ...defaultDateFormat(), ...o });

test('date format is composed from independent options', () => {
  assert.equal(fmt({}), '2026.10.07');
  assert.equal(fmt({ order: 'dmy', sep: '/' }), '07/10/2026');
  assert.equal(fmt({ order: 'mdy', sep: '-' }), '10-07-2026');
  assert.equal(fmt({ year: 'short', sep: ' ' }), "'26 10 07");
  assert.equal(fmt({ year: 'none' }), '10.07');
  assert.equal(fmt({ order: 'dmy', month: 'short' }), '7 Oct 2026');
  assert.equal(fmt({ order: 'mdy', month: 'long' }), 'October 7, 2026');
  assert.equal(fmt({ order: 'mdy', month: 'short', year: 'none' }), 'Oct 7');
  assert.equal(fmt({ order: 'ymd', month: 'short' }), '2026 Oct 7');
  assert.equal(fmt({ weekday: 'short' }), 'Wed, 2026.10.07');
  assert.equal(fmt({ order: 'dmy', month: 'long', weekday: 'long' }), 'Wednesday, 7 October 2026');
});

test('date & time: 24 h or 12 h AM/PM, seconds optional', () => {
  assert.equal(fmt({ show: 'datetime' }), '2026.10.07  16:05');
  assert.equal(fmt({ show: 'datetime', clock: '12' }), '2026.10.07  4:05 PM');
  assert.equal(fmt({ show: 'datetime', seconds: true }), '2026.10.07  16:05:09');
  assert.equal(formatDate(new Date(2026, 0, 1, 0, 7), { show: 'datetime', clock: '12' }), '2026.01.01  12:07 AM');
  assert.deepEqual(DATE_OPTIONS.show, ['date', 'datetime']);
});

test('tapping a date cycles through its styles and wraps around', () => {
  let f = defaultDateFormat();
  const seen = [];
  for (let k = 0; k < DATE_STYLES.length; k++) { f = nextDateStyle(f); seen.push(formatDate(D, f)); }
  assert.equal(new Set(seen).size, DATE_STYLES.length);
  assert.equal(seen.at(-1), '2026.10.07');
  assert.equal(formatDate(D, nextDateStyle({ order: 'xyz', month: 'long', weekday: 'long' })), formatDate(D, DATE_STYLES[0]));
});

test('older saves: date layers become a date, junk is cleaned', () => {
  const legacy = [{ kind: 'text', texts: ['a', 'b'] }, { kind: 'date', dateFormat: 'dmy-t12', edge: 'right', size: 3 }];
  assert.equal(sanitizeLayers(legacy).length, 1);
  const d = migrateDate(undefined, legacy);
  assert.equal(d.edge, 'right');
  assert.deepEqual([d.fmt.show, d.fmt.order, d.fmt.month, d.fmt.clock], ['datetime', 'dmy', 'short', '12']);
  const bad = migrateDate({ on: true, fmt: { order: 'xyz', clock: '25' }, shift: 99 });
  assert.equal(bad.fmt.order, 'ymd');
  assert.equal(bad.shift, SHIFT.max);
  assert.equal(effectiveShift({ shift: -4 }, 30), -4);
});

import {
  defaultDoc, sanitizeDoc, exportThemesText, parseThemesText, legacyDoc, layoutsLinked, textEl, cardOf,
} from '../app/src/model.js';

test('a fresh document: two portrait Minis and a landscape One Wide, each with the date in its chin', () => {
  const d = defaultDoc();
  assert.deepEqual(d.two.map((p) => p.orientation), ['portrait', 'portrait']);
  assert.equal(d.one[0].orientation, 'landscape');
  for (const p of [...d.two, ...d.one]) {
    assert.equal(p.elements.length, 1);
    assert.equal(p.elements[0].type, 'date');
    assert.equal(p.elements[0].align, 'right');
    assert.ok(p.elements[0].y > 0.8, 'in the chin');
  }
  assert.equal(layoutsLinked(d), true);
  d.two[1].orientation = 'landscape';
  assert.equal(layoutsLinked(d), false, 'prints facing different ways never share a layout');
});

test('a theme round-trips both formats, their prints and elements, without photo crops', () => {
  const d = defaultDoc();
  d.two[0].elements.push(textEl({ text: 'beach', font: 'Pacifico', x: 0.3, y: 0.88, rot: 12, bg: 'solid', color: '#E5484D' }));
  d.two[1].color = 'sage';
  d.two[0].crop.zoom = 3;
  d.one[0].layout = { ...d.one[0].layout, aspect: 'square', corner: 0.02, w: 0.5 };
  const text = exportThemesText([{ name: 'Mini-tiddu', doc: d }]);
  assert.equal(JSON.parse(text).version, 4);
  const [t] = parseThemesText(text);
  assert.equal(t.name, 'Mini-tiddu');
  assert.equal(t.elementsOnly, false);
  const el = t.doc.two[0].elements.at(-1);
  assert.deepEqual([el.text, el.font, el.rot, el.bg, el.color], ['beach', 'Pacifico', 12, 'solid', '#E5484D']);
  assert.equal(t.doc.two[1].color, 'sage');
  assert.equal(t.doc.two[0].crop.zoom, 1);
  assert.deepEqual([t.doc.one[0].layout.aspect, t.doc.one[0].layout.corner, t.doc.one[0].layout.w], ['square', 0.02, 0.5]);
});

test('older caption templates import as elements placed where the border captions were', () => {
  const v2 = { twinmini: 'caption-template', version: 2, name: 'Caps', captions: [{ kind: 'text', same: true, text: 'hello', edge: 'bottom', align: 'start', size: 5 }], date: { on: true, edge: 'left', align: 'end', size: 3 } };
  const [t] = parseThemesText(JSON.stringify(v2));
  assert.equal(t.elementsOnly, true);
  const card = cardOf(t.doc, 'two', 0);
  const [txt, date] = t.doc.two[0].elements;
  assert.equal(txt.text, 'hello');
  assert.equal(txt.align, 'left');
  assert.ok(Math.abs(txt.x * card.w - card.win.x) < 1e-6, 'starts at the photo edge');
  assert.ok(txt.y * card.h > card.win.y + card.win.h, 'in the chin');
  assert.equal(date.type, 'date');
  assert.equal(date.rot, 270);
  assert.ok(date.x * card.w < card.win.x, 'in the left border');
  const look = { format: 'one', layout: { one: { orientation: 'portrait', aspect: 'square' } }, color: 'cream', paperId: 'KL-36IP' };
  const d = legacyDoc(look, [], { on: false });
  assert.deepEqual([d.format, d.paperId, d.one[0].orientation, d.one[0].layout.aspect, d.one[0].color], ['one', 'KL-36IP', 'portrait', 'square', 'cream']);
  assert.equal(d.one[0].elements.length, 0);
});

test('import rejects junk with a readable message; sanitizing drops bad elements', () => {
  assert.throws(() => parseThemesText('hello'), /invalid JSON/);
  assert.throws(() => parseThemesText('{"name":"x"}'), /captions/);
  const d = sanitizeDoc({ two: [{ elements: [{ type: 'nope' }, { type: 'emoji', char: '🌸', size: 999 }, { type: 'sticker', sticker: 'missing' }] }] });
  assert.equal(d.two[0].elements.length, 1);
  assert.equal(d.two[0].elements[0].size, 80);
});

import { remapElements } from '../app/src/model.js';
import { cardLayout } from '../app/src/geometry.js';

test('elements keep their place when the layout changes: chin text stays in the chin', () => {
  const from = cardLayout({ W: 74, H: 100 });
  const to = cardLayout({ W: 74, H: 100, w: 0.9, top: 0.03 });
  const chinY = (c) => (c.win.y + c.win.h + c.h) / 2;
  const print = { elements: [{ x: 0.5, y: chinY(from) / 100 }, { x: (from.win.x + from.win.w) / 74, y: 0.5 }] };
  remapElements(print, from, to);
  assert.ok(Math.abs(print.elements[0].y * 100 - chinY(to)) < 1e-6);
  assert.ok(Math.abs(print.elements[1].x * 74 - (to.win.x + to.win.w)) < 1e-6, 'on the photo edge');
  const land = cardLayout({ W: 100, H: 74, size: 0.82 });
  remapElements(print, to, land);
  assert.ok(print.elements[0].y * 74 > land.win.y + land.win.h, 'still in the chin after turning landscape');
});
