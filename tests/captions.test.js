import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExifDate, parseExifDate } from '../app/src/exif.js';
import { BUILTIN_TEMPLATES, DATE_FORMATS, defaultLayers, resolveLayers, sanitizeLayers, textLayer, cloneLayers } from '../app/src/captions.js';

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

test('date formats', () => {
  const d = new Date(2026, 9, 7);
  assert.equal(DATE_FORMATS.dots.fmt(d), '2026.10.07');
  assert.equal(DATE_FORMATS.stamp.fmt(d), "'26 10 07");
  assert.equal(DATE_FORMATS.dmy.fmt(d), '7 Oct 2026');
  assert.equal(DATE_FORMATS.mdy.fmt(d), 'Oct 7, 2026');
});

test('default captions are a single date caption', () => {
  const layers = defaultLayers();
  assert.equal(layers.length, 1);
  assert.equal(layers[0].kind, 'date');
  assert.equal(BUILTIN_TEMPLATES[0].name, 'Date');
});

test('resolveLayers: per-photo text, shared text, date per photo, empties dropped', () => {
  const per = textLayer({ texts: ['beach', ''] });
  const shared = textLayer({ same: true, text: 'us' });
  const [date] = defaultLayers();
  const d1 = new Date(2024, 0, 2), d2 = new Date(2025, 5, 6);
  const a = resolveLayers([per, shared, date], 0, d1).map((l) => l.text);
  const b = resolveLayers([per, shared, date], 1, d2).map((l) => l.text);
  assert.deepEqual(a, ['beach', 'us', '2024.01.02']);
  assert.deepEqual(b, ['us', '2025.06.06']);
});

test('sanitizeLayers repairs stored data; cloneLayers gives fresh ids', () => {
  const s = sanitizeLayers([{ kind: 'date', edge: 'diagonal', size: 99 }, { kind: 'bogus' }, null]);
  assert.equal(s.length, 1);
  assert.equal(s[0].edge, 'bottom');
  assert.equal(s[0].size, 14);
  assert.equal(sanitizeLayers('nope'), null);
  const c = cloneLayers(s);
  assert.notEqual(c[0].id, s[0].id);
});

import { exportTemplatesText, parseTemplatesText, dateLayer as dl, textLayer as tl } from '../app/src/captions.js';

test('template text round-trips through export and import', () => {
  const layers = [tl({ texts: ['a', 'b'], font: 'Pacifico', edge: 'top' }), dl({ dateFormat: 'stamp', color: 'stamp' })];
  const one = exportTemplatesText([{ name: 'Retro', layers }]);
  assert.match(one, /"twinmini": "caption-template"/);
  const [back] = parseTemplatesText(one);
  assert.equal(back.name, 'Retro');
  assert.deepEqual(back.layers.map((l) => [l.kind, l.font, l.edge, l.dateFormat ?? null]), [['text', 'Pacifico', 'top', null], ['date', 'Caveat', 'bottom', 'stamp']]);
  assert.deepEqual(back.layers[0].texts, ['a', 'b']);
  assert.ok(!('texts' in JSON.parse(one).captions[1]), 'date captions carry no text fields');
  const many = exportTemplatesText([{ name: 'A', layers }, { name: 'B', layers: [] }]);
  assert.deepEqual(parseTemplatesText(many).map((t) => t.name), ['A', 'B']);
  assert.deepEqual(parseTemplatesText(JSON.stringify({ templates: JSON.parse(many) })).map((t) => t.name), ['A', 'B']);
});

test('import rejects junk with a readable message', () => {
  assert.throws(() => parseTemplatesText('hello'), /invalid JSON/);
  assert.throws(() => parseTemplatesText('{"name":"x"}'), /captions/);
});

import { DATE_FORMATS as F, FORMAT_GROUPS, groupLabel, resolveLayers as resolve, dateLayer as mkDate, sanitizeLayers as clean, exportTemplatesText as exp, parseTemplatesText as imp } from '../app/src/captions.js';

test('date, time and date-and-time formats', () => {
  const d = new Date(2026, 9, 7, 16, 5, 9);
  const f = (id) => F[id].fmt(d);
  assert.equal(f('iso'), '2026-10-07');
  assert.equal(f('us'), '10/07/2026');
  assert.equal(f('weekday'), 'Wed, 7 Oct');
  assert.equal(f('long'), 'Wednesday, 7 October 2026');
  assert.equal(f('t24'), '16:05');
  assert.equal(f('t12'), '4:05 PM');
  assert.equal(f('t24s'), '16:05:09');
  assert.equal(f('dots-t24'), '2026.10.07 16:05');
  assert.equal(f('dmy-t12'), '7 Oct 2026, 4:05 PM');
  assert.equal(F.t12.fmt(new Date(2026, 0, 1, 0, 7)), '12:07 AM');
  assert.deepEqual(FORMAT_GROUPS.map((g) => g.id), ['date', 'time', 'datetime']);
  for (const k of Object.keys(F)) assert.ok(['date', 'time', 'datetime'].includes(F[k].group), k);
  assert.equal(groupLabel('t24'), 'Time');
  assert.equal(groupLabel('nope'), 'Date');
});

test('timestamp source: photo by default, or now', () => {
  const photo = new Date(2020, 1, 3, 8, 0), now = new Date(2026, 9, 17, 21, 30);
  assert.equal(mkDate().source, 'photo');
  assert.equal(resolve([mkDate({ dateFormat: 'dots-t24' })], 0, photo, now)[0].text, '2020.02.03 08:00');
  assert.equal(resolve([mkDate({ dateFormat: 'dots-t24', source: 'now' })], 0, photo, now)[0].text, '2026.10.17 21:30');
});

test('stored date captions are repaired and keep their source through template text', () => {
  const [a] = clean([{ kind: 'date', dateFormat: 'bogus', source: 'tomorrow' }]);
  assert.equal(a.dateFormat, 'dots');
  assert.equal(a.source, 'photo');
  const [t] = imp(exp([{ name: 'N', layers: [mkDate({ dateFormat: 't12', source: 'now' })] }]));
  assert.equal(t.layers[0].dateFormat, 't12');
  assert.equal(t.layers[0].source, 'now');
});
