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
const p2 = (n) => String(n).padStart(2, '0');

export const DATE_FORMATS = {
  dots: { label: '2026.10.17', fmt: (d) => `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())}` },
  stamp: { label: "'26 10 17", fmt: (d) => `'${p2(d.getFullYear() % 100)} ${p2(d.getMonth() + 1)} ${p2(d.getDate())}` },
  dmy: { label: '17 Oct 2026', fmt: (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` },
  mdy: { label: 'Oct 17, 2026', fmt: (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` },
  slash: { label: '17/10/2026', fmt: (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` },
  month: { label: 'October 2026', fmt: (d) => `${d.toLocaleString('en', { month: 'long' })} ${d.getFullYear()}` },
};

let seq = 0;
const uid = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A date caption: the photo's own date (EXIF, else file date). */
export function dateLayer(over = {}) {
  return { id: uid(), kind: 'date', dateFormat: 'dots', font: 'Caveat', size: 4.6, edge: 'bottom', align: 'end', color: 'auto', ...over };
}
/** A free-text caption; by default each photo gets its own text. */
export function textLayer(over = {}) {
  return { id: uid(), kind: 'text', same: false, text: '', texts: ['', ''], font: 'Caveat', size: 6, edge: 'bottom', align: 'center', color: 'auto', ...over };
}

export const BUILTIN_TEMPLATES = [
  { id: 'b-date', name: 'Date', layers: () => [dateLayer()] },
  { id: 'b-note', name: 'Note', layers: () => [textLayer()] },
  { id: 'b-note-date', name: 'Note + date', layers: () => [textLayer({ size: 5.6 }), dateLayer({ size: 3.6, font: 'Kalam', color: 'grey' })] },
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
 * @param {Date} date the photo's date for this frame
 */
export function resolveLayers(layers, i, date) {
  return layers.map((l) => {
    let text;
    if (l.kind === 'date') text = (DATE_FORMATS[l.dateFormat] || DATE_FORMATS.dots).fmt(date);
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
  }));
}

/* ---------------- template text format (export / import / site templates) ---------------- */
// One template:  {"twinmini":"caption-template","version":1,"name":"…","captions":[…]}
// Several: an array of those, or {"templates":[…]}. Caption fields: kind ("date" | "text"),
// font, size (mm), edge, align, color, dateFormat (date), same/text/texts (text).
export const TEMPLATE_FORMAT = 'caption-template';
const KEEP = ['kind', 'font', 'size', 'edge', 'align', 'color', 'dateFormat', 'same', 'text', 'texts'];

export function templateToJson(name, layers) {
  return {
    twinmini: TEMPLATE_FORMAT, version: 1, name,
    captions: layers.map((l) => Object.fromEntries(KEEP.filter((k) => l[k] !== undefined && !(l.kind === 'date' && ['same', 'text', 'texts'].includes(k))).map((k) => [k, l[k]]))),
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
