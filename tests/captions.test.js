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

import {
  formatDate, defaultDateFormat, DATE_OPTIONS, dateSettings, textLayer, resolveCaptions, sanitizeLayers,
  migrateDate, cloneLayers, defaultCaptions, defaultDate, exportTemplatesText, parseTemplatesText, SHIFT,
} from '../app/src/captions.js';

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

test('one date per print, independent of text captions; photo time by default, or now', () => {
  const photo = new Date(2020, 1, 3, 8, 0), now = new Date(2026, 9, 17, 21, 30);
  const notes = [textLayer({ texts: ['beach', 'us'] })];
  const d = dateSettings();
  assert.equal(d.on, true);
  assert.equal(d.source, 'photo');
  assert.deepEqual(resolveCaptions(notes, d, 0, photo, now).map((l) => l.text), ['beach', '2020.02.03']);
  assert.deepEqual(resolveCaptions(notes, { ...d, source: 'now' }, 1, photo, now).map((l) => l.text), ['us', '2026.10.17']);
  assert.deepEqual(resolveCaptions(notes, { ...d, on: false }, 0, photo, now).map((l) => l.text), ['beach']);
  assert.deepEqual(resolveCaptions([], d, 0, photo, now).map((l) => l.text), ['2020.02.03']);
});

test('text captions only; date layers from older saves become the single date setting', () => {
  const legacy = [{ kind: 'text', texts: ['a', 'b'] }, { kind: 'date', dateFormat: 'dmy-t12', edge: 'right', size: 3 }, { kind: 'date', dateFormat: 'dots' }];
  assert.equal(sanitizeLayers(legacy).length, 1);
  const d = migrateDate(undefined, legacy);
  assert.equal(d.on, true);
  assert.equal(d.edge, 'right');
  assert.deepEqual([d.fmt.show, d.fmt.order, d.fmt.month, d.fmt.clock], ['datetime', 'dmy', 'short', '12']);
  assert.equal(migrateDate(undefined, [{ kind: 'text' }]), null);
  const bad = migrateDate({ on: true, fmt: { order: 'xyz', clock: '25' }, shift: 99 });
  assert.equal(bad.fmt.order, 'ymd');
  assert.equal(bad.fmt.clock, '24');
  assert.equal(bad.shift, SHIFT.max);
});

test('a fresh sheet has no text captions and the date on', () => {
  assert.deepEqual(defaultCaptions(), []);
  assert.equal(defaultDate().on, true);
  assert.equal(defaultDate().kind, 'date');
});

test('template text round-trips captions and the date', () => {
  const layers = [textLayer({ texts: ['a', 'b'], font: 'Pacifico', edge: 'top', shift: -6.5 })];
  const date = dateSettings({ source: 'now', color: 'stamp', fmt: { show: 'datetime', clock: '12', weekday: 'short' } });
  const text = exportTemplatesText([{ name: 'Retro', layers, date }]);
  assert.match(text, /"twinmini": "theme"/);
  const [back] = parseTemplatesText(text);
  assert.equal(back.name, 'Retro');
  assert.deepEqual(back.layers[0].texts, ['a', 'b']);
  assert.equal(back.layers[0].shift, -6.5);
  assert.equal(back.date.source, 'now');
  assert.deepEqual([back.date.fmt.show, back.date.fmt.clock, back.date.fmt.weekday], ['datetime', '12', 'short']);
  const many = exportTemplatesText([{ name: 'A', layers, date }, { name: 'B', layers: [], date: { ...date, on: false } }]);
  assert.deepEqual(parseTemplatesText(many).map((t) => [t.name, t.date.on]), [['A', true], ['B', false]]);
  // version-1 text (date as a caption) still imports
  const v1 = '{"twinmini":"caption-template","version":1,"name":"Old","captions":[{"kind":"date","dateFormat":"stamp","color":"stamp"}]}';
  const [old] = parseTemplatesText(v1);
  assert.equal(old.layers.length, 0);
  assert.equal(formatDate(D, old.date.fmt), "'26 10 07");
});

test('a theme carries its name and whole look; caption-only templates have none', () => {
  const look = { format: 'one', layout: { two: { aspect: 'mini', w: 0.7, h: null, top: 0.1 }, one: { aspect: 'square', orientation: 'portrait', flip: false, w: null, h: null, top: null } }, color: 'cream', marks: false, paperId: 'custom', customPaper: { w: 120, h: 90 } };
  const text = exportTemplatesText([{ name: 'Mini-tiddu', layers: [], date: dateSettings(), look }]);
  const [back] = parseTemplatesText(text);
  assert.equal(back.name, 'Mini-tiddu');
  assert.deepEqual(back.look, look);
  assert.equal(JSON.parse(text).version, 3);
  const [v2] = parseTemplatesText('{"twinmini":"caption-template","version":2,"name":"Caps","captions":[]}');
  assert.equal(v2.look, null);
});

test('import rejects junk with a readable message', () => {
  assert.throws(() => parseTemplatesText('hello'), /invalid JSON/);
  assert.throws(() => parseTemplatesText('{"name":"x"}'), /captions/);
});

test('cloneLayers gives fresh ids', () => {
  const [a] = [textLayer()];
  assert.notEqual(cloneLayers([a])[0].id, a.id);
});

import { effectiveShift } from '../app/src/captions.js';

test('caption anchoring: toward the photo keeps the photo-edge gap, away keeps the paper-edge gap', () => {
  // Set in a 16 mm chin: line centre 8 mm from each side, shifted 3 mm.
  const closer = { shift: -3, ref: 16 }, further = { shift: 3, ref: 16 }, centred = { shift: 0, ref: 16 };
  for (const band of [10, 16, 30]) {
    const fromPhoto = (l) => band / 2 + effectiveShift(l, band);  // gap: photo edge → line centre
    const fromEdge = (l) => band / 2 - effectiveShift(l, band);   // gap: paper edge → line centre
    assert.equal(fromPhoto(closer), 5);
    assert.equal(fromEdge(further), 5);
    assert.equal(effectiveShift(centred, band), 0);
  }
  // Captions saved before anchoring existed behave as before.
  assert.equal(effectiveShift({ shift: -4 }, 30), -4);
});
