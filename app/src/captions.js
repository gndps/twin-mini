// What is written on the frame borders: text captions plus one optional date per print,
// and the templates that bundle them. Pure data + formatting; no DOM.

export const EDGES = ['bottom', 'top', 'left', 'right'];
// Distance from the centred spot in the border, in mm: negative moves toward the photo
// (and can overlap it), positive moves away.
export const SHIFT = { min: -15, max: 15 };
export const ALIGNS = ['start', 'center', 'end'];

/**
 * Where a caption sits across its border band when the photo changes size. `shift` was set
 * while the band was `ref` mm thick: a caption pulled toward the photo keeps its distance from
 * the photo edge, one pushed away keeps its distance from the outer paper edge, and a centred
 * one stays centred. Returns the shift (from the band centre) to use for a band `band` mm thick.
 */
export function effectiveShift(l, band) {
  const s = l.shift || 0;
  if (!s || !Number.isFinite(l.ref)) return s;
  return s < 0 ? s + (l.ref - band) / 2 : s + (band - l.ref) / 2;
}

export const CAPTION_COLORS = [
  { id: 'auto', label: 'Auto', value: null },
  { id: 'ink', label: 'Ink', value: '#1C1B19' },
  { id: 'grey', label: 'Grey', value: '#8C867E' },
  { id: 'stamp', label: 'Date-stamp orange', value: '#E0662F' },
  { id: 'navy', label: 'Navy', value: '#2E3F66' },
  { id: 'red', label: 'Red', value: '#B23A3A' },
  { id: 'white', label: 'White', value: '#FFFFFF' },
];

/* ---------------- date formatting: composable options ---------------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const p2 = (n) => String(n).padStart(2, '0');

/** Every choice the date formatter understands, with its allowed values (first = default). */
export const DATE_OPTIONS = {
  show: ['date', 'datetime'],
  order: ['ymd', 'dmy', 'mdy'],
  month: ['num', 'short', 'long'],
  year: ['full', 'short', 'none'],
  sep: ['.', '/', '-', ' '],
  weekday: ['none', 'short', 'long'],
  clock: ['24', '12'],
  seconds: [false, true],
};
export const defaultDateFormat = () => Object.fromEntries(Object.entries(DATE_OPTIONS).map(([k, v]) => [k, v[0]]));

function sanitizeFormat(f) {
  const out = defaultDateFormat();
  for (const [k, allowed] of Object.entries(DATE_OPTIONS)) if (f && allowed.includes(f[k])) out[k] = f[k];
  return out;
}

/**
 * Build the date text from independent choices:
 *  numeric month → parts joined by the separator (2026.10.17, 17/10/26, '26 10 17);
 *  named month → written style (17 Oct 2026, Oct 17, 2026, 2026 October 17);
 *  optional weekday in front, optional time (24 h or 12 h AM/PM, with or without seconds) after.
 */
export function formatDate(d, fmt) {
  const f = sanitizeFormat(fmt);
  const day = String(d.getDate());
  const year = f.year === 'full' ? String(d.getFullYear()) : f.year === 'short' ? `'${p2(d.getFullYear() % 100)}` : '';
  let date;
  if (f.month === 'num') {
    const parts = { y: year, m: p2(d.getMonth() + 1), d: p2(d.getDate()) };
    date = [...f.order].map((k) => parts[k]).filter(Boolean).join(f.sep);
  } else {
    const mon = (f.month === 'short' ? MONTHS : MONTHS_LONG)[d.getMonth()];
    if (f.order === 'mdy') date = year ? `${mon} ${day}, ${year}` : `${mon} ${day}`;
    else if (f.order === 'ymd') date = [year, mon, day].filter(Boolean).join(' ');
    else date = [day, mon, year].filter(Boolean).join(' ');
  }
  if (f.weekday !== 'none') date = `${(f.weekday === 'short' ? DAYS : DAYS_LONG)[d.getDay()]}, ${date}`;
  if (f.show === 'datetime') {
    const h = d.getHours();
    const sec = f.seconds ? `:${p2(d.getSeconds())}` : '';
    const time = f.clock === '12'
      ? `${h % 12 || 12}:${p2(d.getMinutes())}${sec} ${h < 12 ? 'AM' : 'PM'}`
      : `${p2(h)}:${p2(d.getMinutes())}${sec}`;
    date = `${date}  ${time}`;
  }
  return date;
}

/** Where the date's timestamp comes from. */
export const TIME_SOURCES = [
  { id: 'photo', label: 'Photo', detail: 'When the photo was taken (or its file date)' },
  { id: 'now', label: 'Now', detail: 'Today’s date and the current time' },
];

/* ---------------- captions and the date ---------------- */
let seq = 0;
const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

const STYLE_DEFAULTS = { font: 'Caveat', size: 6, edge: 'bottom', align: 'center', color: 'auto', shift: 0 };

/** A free-text caption; by default each photo gets its own text. */
export function textLayer(over = {}) {
  return { id: uid(), kind: 'text', same: false, text: '', texts: ['', ''], ...STYLE_DEFAULTS, ...over };
}
/** The one date per print: on by default, the photo's own timestamp, bottom right. */
export function dateSettings(over = {}) {
  const { fmt, ...rest } = over;
  return { id: 'date', kind: 'date', on: true, source: 'photo', ...STYLE_DEFAULTS, size: 4.6, align: 'end', ...rest, fmt: { ...defaultDateFormat(), ...fmt } };
}

// A fresh sheet: no text captions, the date on.
export const defaultCaptions = () => [];
export const defaultDate = () => dateSettings();

/** Copy captions with fresh ids (templates must never share objects with the sheet). */
export const cloneLayers = (layers) => layers.map((l) => ({ ...l, texts: l.texts ? [...l.texts] : undefined, id: uid() }));
export const cloneDate = (d) => ({ ...d, fmt: { ...d.fmt } });

/**
 * Concrete lines for one frame: its text captions, then the date if it is on.
 * @param {Date} photoDate the photo's timestamp; @param {Date} [now] used when the date source is "now"
 */
export function resolveCaptions(layers, date, i, photoDate, now = new Date(), { keepEmpty = false } = {}) {
  const lines = layers.map((l) => ({ ...l, text: ((l.same ? l.text : l.texts?.[i]) || '').trim() }));
  if (date?.on) lines.push({ ...date, text: formatDate(date.source === 'now' ? now : photoDate, date.fmt) });
  // keepEmpty: the preview still lays out empty text captions so they can be tapped and typed into.
  return lines.filter((l) => l.text || (keepEmpty && l.kind === 'text'));
}

function sanitizeStyle(l, base) {
  return {
    ...base, ...l,
    edge: EDGES.includes(l.edge) ? l.edge : base.edge,
    align: ALIGNS.includes(l.align) ? l.align : base.align,
    size: Number.isFinite(l.size) ? Math.min(14, Math.max(1.5, l.size)) : base.size,
    shift: Number.isFinite(l.shift) ? Math.min(SHIFT.max, Math.max(SHIFT.min, l.shift)) : 0,
    ref: Number.isFinite(l.ref) && l.ref >= 0 ? l.ref : undefined,
  };
}

/** Text captions from storage or template text; date entries are dropped (see migrateDate). */
export function sanitizeLayers(layers) {
  if (!Array.isArray(layers)) return null;
  return layers.filter((l) => l?.kind === 'text').map((l) => {
    const t = sanitizeStyle(l, textLayer());
    return { ...t, texts: [t.texts?.[0] ?? '', t.texts?.[1] ?? ''] };
  });
}

// Older versions stored dates as caption layers with a named format; map them across.
const LEGACY_FORMATS = {
  dots: {}, iso: { sep: '-' }, slash: { order: 'dmy', sep: '/' }, us: { order: 'mdy', sep: '/' },
  stamp: { year: 'short', sep: ' ' }, dmy: { order: 'dmy', month: 'short' }, mdy: { order: 'mdy', month: 'short' },
  month: { order: 'dmy', month: 'long' }, weekday: { order: 'dmy', month: 'short', year: 'none', weekday: 'short' },
  long: { order: 'dmy', month: 'long', weekday: 'long' }, year: {},
  t24: { show: 'datetime' }, t12: { show: 'datetime', clock: '12' }, t24s: { show: 'datetime', seconds: true }, tdot: { show: 'datetime' },
  'dots-t24': { show: 'datetime' }, 'stamp-t24': { show: 'datetime', year: 'short', sep: ' ' }, 'iso-t24': { show: 'datetime', sep: '-' },
  'dmy-t12': { show: 'datetime', order: 'dmy', month: 'short', clock: '12' }, 'mdy-t12': { show: 'datetime', order: 'mdy', month: 'short', clock: '12' },
  'weekday-t24': { show: 'datetime', order: 'dmy', month: 'short', year: 'none', weekday: 'short' },
};

/** The date settings from stored data: a `date` object, or the first legacy date caption, or off. */
export function migrateDate(date, legacyLayers) {
  if (date && typeof date === 'object') {
    const s = sanitizeStyle(date, dateSettings());
    return { ...s, id: 'date', kind: 'date', on: date.on !== false, source: date.source === 'now' ? 'now' : 'photo', fmt: sanitizeFormat({ ...defaultDateFormat(), ...date.fmt }) };
  }
  const old = Array.isArray(legacyLayers) ? legacyLayers.find((l) => l?.kind === 'date') : null;
  if (!old) return null;
  const { dateFormat, ...style } = old;
  return migrateDate({ ...style, on: true, fmt: LEGACY_FORMATS[dateFormat] || {} });
}

/* ---------------- template text format (export / import / site templates) ---------------- */
// One template:  {"twinmini":"caption-template","version":2,"name":"…","captions":[…],"date":{…}}
// Several: an array of those, or {"templates":[…]}.
// Caption fields: font, size (mm), edge, align, color, shift (mm, − = toward the photo),
//   ref (border thickness in mm when shift was set; anchors the caption, see effectiveShift),
//   same + text, or texts (one per photo).
// Date fields: on, source ("photo" | "now"), the same style fields, and fmt:
//   { show, order, month, year, sep, weekday, clock, seconds } (see DATE_OPTIONS).
export const TEMPLATE_FORMAT = 'caption-template';
const STYLE_KEYS = ['font', 'size', 'edge', 'align', 'color', 'shift', 'ref'];

export function templateToJson(name, layers, date) {
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return {
    twinmini: TEMPLATE_FORMAT, version: 2, name,
    captions: layers.map((l) => ({ kind: 'text', ...pick(l, [...STYLE_KEYS, 'same', 'text', 'texts']) })),
    date: date ? { on: !!date.on, source: date.source, ...pick(date, STYLE_KEYS), fmt: { ...date.fmt } } : { on: false },
  };
}
export const exportTemplatesText = (list) =>
  JSON.stringify(list.length === 1 ? templateToJson(list[0].name, list[0].layers, list[0].date) : list.map((t) => templateToJson(t.name, t.layers, t.date)), null, 2);

/** Parse exported text back into [{name, layers, date}]; throws a readable Error on bad input. */
export function parseTemplatesText(text) {
  let data;
  try { data = JSON.parse(String(text).trim()); } catch { throw new Error('That isn’t template text (invalid JSON).'); }
  const list = Array.isArray(data) ? data : Array.isArray(data?.templates) ? data.templates : [data];
  const out = list.map((t) => {
    if (!t || typeof t !== 'object' || !Array.isArray(t.captions)) throw new Error('Missing "captions" list.');
    return {
      name: String(t.name || 'Imported').slice(0, 30),
      layers: sanitizeLayers(t.captions),
      date: migrateDate(t.date, t.captions) || dateSettings({ on: false }),
    };
  });
  if (!out.length) throw new Error('No templates found.');
  return out;
}
