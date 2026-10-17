// Caption layers: what is written on the frame borders, and the templates that bundle them.
// Pure data + formatting; no DOM.

export const EDGES = ['bottom', 'top', 'left', 'right'];
export const ALIGNS = ['start', 'center', 'end'];

export const CAPTION_COLORS = [
  { id: 'auto', label: 'Auto', value: null },
  { id: 'ink', label: 'Ink', value: '#1C1B19' },
  { id: 'grey', label: 'Grey', value: '#8C867E' },
  { id: 'stamp', label: 'Date-stamp orange', value: '#E0662F' },
  { id: 'navy', label: 'Navy', value: '#2E3F66' },
  { id: 'red', label: 'Red', value: '#B23A3A' },
  { id: 'white', label: 'White', value: '#FFFFFF' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const p2 = (n) => String(n).padStart(2, '0');

// Building blocks, combined below into date, time, and date-and-time formats.
const D = {
  dots: (d) => `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())}`,
  stamp: (d) => `'${p2(d.getFullYear() % 100)} ${p2(d.getMonth() + 1)} ${p2(d.getDate())}`,
  iso: (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
  dmy: (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  mdy: (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
};
const T = {
  t24: (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`,
  t12: (d) => `${d.getHours() % 12 || 12}:${p2(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`,
};

/** Every format has a group: what it shows (date, time, or both). Ids are stored, so never rename. */
export const DATE_FORMATS = {
  // date
  dots: { group: 'date', fmt: D.dots },
  stamp: { group: 'date', fmt: D.stamp },
  iso: { group: 'date', fmt: D.iso },
  dmy: { group: 'date', fmt: D.dmy },
  mdy: { group: 'date', fmt: D.mdy },
  slash: { group: 'date', fmt: (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` },
  us: { group: 'date', fmt: (d) => `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${d.getFullYear()}` },
  month: { group: 'date', fmt: (d) => `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` },
  weekday: { group: 'date', fmt: (d) => `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}` },
  long: { group: 'date', fmt: (d) => `${DAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` },
  year: { group: 'date', fmt: (d) => String(d.getFullYear()) },
  // time
  t24: { group: 'time', fmt: T.t24 },
  t12: { group: 'time', fmt: T.t12 },
  t24s: { group: 'time', fmt: (d) => `${T.t24(d)}:${p2(d.getSeconds())}` },
  tdot: { group: 'time', fmt: (d) => `${p2(d.getHours())}.${p2(d.getMinutes())}` },
  // date & time
  'dots-t24': { group: 'datetime', fmt: (d) => `${D.dots(d)} ${T.t24(d)}` },
  'stamp-t24': { group: 'datetime', fmt: (d) => `${D.stamp(d)}  ${T.t24(d)}` },
  'iso-t24': { group: 'datetime', fmt: (d) => `${D.iso(d)} ${T.t24(d)}` },
  'dmy-t12': { group: 'datetime', fmt: (d) => `${D.dmy(d)}, ${T.t12(d)}` },
  'mdy-t12': { group: 'datetime', fmt: (d) => `${D.mdy(d)} · ${T.t12(d)}` },
  'weekday-t24': { group: 'datetime', fmt: (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${T.t24(d)}` },
};
export const FORMAT_GROUPS = [
  { id: 'date', label: 'Date' },
  { id: 'time', label: 'Time' },
  { id: 'datetime', label: 'Date & time' },
];
export const formatFn = (id) => (DATE_FORMATS[id] || DATE_FORMATS.dots).fmt;
export const groupLabel = (id) => FORMAT_GROUPS.find((g) => g.id === (DATE_FORMATS[id] || DATE_FORMATS.dots).group).label;

/** Where a date caption's timestamp comes from. */
export const TIME_SOURCES = [
  { id: 'photo', label: 'Photo', detail: 'When the photo was taken (or its file date)' },
  { id: 'now', label: 'Now', detail: 'Today’s date and the current time' },
];

let seq = 0;
const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A date/time caption: by default the photo's own timestamp (EXIF capture time, else file time). */
export function dateLayer(over = {}) {
  return { id: uid(), kind: 'date', dateFormat: 'dots', source: 'photo', font: 'Caveat', size: 4.6, edge: 'bottom', align: 'end', color: 'auto', ...over };
}
/** A free-text caption; by default each photo gets its own text. */
export function textLayer(over = {}) {
  return { id: uid(), kind: 'text', same: false, text: '', texts: ['', ''], font: 'Caveat', size: 6, edge: 'bottom', align: 'center', color: 'auto', ...over };
}

export const BUILTIN_TEMPLATES = [
  { id: 'b-date', name: 'Date', layers: () => [dateLayer()] },
  { id: 'b-note', name: 'Note', layers: () => [textLayer()] },
  { id: 'b-note-date', name: 'Note + date', layers: () => [textLayer({ size: 5.6 }), dateLayer({ size: 3.6, font: 'Kalam', color: 'grey' })] },
  { id: 'b-datetime', name: 'Date & time', layers: () => [dateLayer({ dateFormat: 'dots-t24', size: 4.2 })] },
  { id: 'b-stamp', name: 'Date stamp', layers: () => [dateLayer({ dateFormat: 'stamp', font: 'VT323', size: 4.4, color: 'stamp', align: 'end' })] },
  { id: 'b-typed', name: 'Typed', layers: () => [textLayer({ font: 'Special Elite', size: 3.8, align: 'start' }), dateLayer({ font: 'Special Elite', size: 3, align: 'end', color: 'grey', dateFormat: 'dmy' })] },
  { id: 'b-side', name: 'Side date', layers: () => [dateLayer({ edge: 'right', align: 'end', size: 3.4, font: 'IBM Plex Mono', color: 'grey', dateFormat: 'dots' })] },
  { id: 'b-none', name: 'None', layers: () => [] },
];

export const defaultLayers = () => BUILTIN_TEMPLATES[0].layers();

/** Copy layers with fresh ids (templates must never share layer objects with the sheet). */
export const cloneLayers = (layers) => layers.map((l) => ({ ...l, texts: l.texts ? [...l.texts] : undefined, id: uid() }));

/**
 * Turn layers into concrete text for one frame.
 * @param {number} i frame index
 * @param {Date} date the photo's timestamp for this frame
 * @param {Date} [now] the moment used by "Now" captions (defaults to the current time)
 */
export function resolveLayers(layers, i, date, now = new Date()) {
  return layers.map((l) => {
    let text;
    if (l.kind === 'date') text = formatFn(l.dateFormat)(l.source === 'now' ? now : date);
    else text = l.same ? l.text : (l.texts?.[i] ?? '');
    return { ...l, text: (text || '').trim() };
  }).filter((l) => l.text);
}

/** Keep stored layers valid when loading from storage written by an older version. */
export function sanitizeLayers(layers) {
  if (!Array.isArray(layers)) return null;
  return layers.filter((l) => l && (l.kind === 'date' || l.kind === 'text')).map((l) => ({
    ...(l.kind === 'date' ? dateLayer() : textLayer()), ...l,
    edge: EDGES.includes(l.edge) ? l.edge : 'bottom',
    align: ALIGNS.includes(l.align) ? l.align : 'center',
    size: Number.isFinite(l.size) ? Math.min(14, Math.max(1.5, l.size)) : 4.5,
    ...(l.kind === 'date' ? {
      dateFormat: DATE_FORMATS[l.dateFormat] ? l.dateFormat : 'dots',
      source: l.source === 'now' ? 'now' : 'photo',
    } : {}),
  }));
}

/* ---------------- template text format (export / import / site templates) ---------------- */
// One template:  {"twinmini":"caption-template","version":1,"name":"…","captions":[…]}
// Several: an array of those, or {"templates":[…]}. Caption fields: kind ("date" | "text"),
// font, size (mm), edge, align, color, dateFormat + source ("photo" | "now") (date),
// same/text/texts (text).
export const TEMPLATE_FORMAT = 'caption-template';
const KEEP = ['kind', 'font', 'size', 'edge', 'align', 'color', 'dateFormat', 'source', 'same', 'text', 'texts'];

export function templateToJson(name, layers) {
  return {
    twinmini: TEMPLATE_FORMAT, version: 1, name,
    captions: layers.map((l) => Object.fromEntries(KEEP.filter((k) => l[k] !== undefined
      && !(l.kind === 'date' && ['same', 'text', 'texts'].includes(k))
      && !(l.kind === 'text' && ['dateFormat', 'source'].includes(k))).map((k) => [k, l[k]]))),
  };
}
export const exportTemplatesText = (list) =>
  JSON.stringify(list.length === 1 ? templateToJson(list[0].name, list[0].layers) : list.map((t) => templateToJson(t.name, t.layers)), null, 2);

/** Parse exported text back into [{name, layers}]; throws a readable Error on bad input. */
export function parseTemplatesText(text) {
  let data;
  try { data = JSON.parse(String(text).trim()); } catch { throw new Error('That isn’t template text (invalid JSON).'); }
  const list = Array.isArray(data) ? data : Array.isArray(data?.templates) ? data.templates : [data];
  const out = list.map((t) => {
    if (!t || typeof t !== 'object' || !Array.isArray(t.captions)) throw new Error('Missing "captions" list.');
    const layers = sanitizeLayers(t.captions);
    return { name: String(t.name || 'Imported').slice(0, 30), layers };
  });
  if (!out.length) throw new Error('No templates found.');
  return out;
}
