// The editable document: one or two prints per format, each with its own orientation, layout,
// frame colour and free-floating elements (text, date, emoji, stickers, picture stickers), plus
// the theme text format that bundles a whole document. Pure data; no DOM.
import { ASPECTS, FORMATS, PAPERS, OTHER_PAPERS, DEFAULT_PAPER, CORNER, sheetLayout, clamp } from './geometry.js';
import {
  CAPTION_COLORS, defaultDateFormat, sanitizeFormat, formatDate, effectiveShift, sanitizeLayers, migrateDate,
} from './captions.js';
import { isKnownFont } from './fonts.js';
import { stickerById } from './stickers.js';

export const FRAME_COLORS = [
  { id: 'white', label: 'White', fill: '#FFFFFF', ink: '#2E2B28' },
  { id: 'cream', label: 'Cream', fill: '#F6F1E6', ink: '#3A3631' },
  { id: 'blush', label: 'Blush', fill: '#F3DCD6', ink: '#4A3330' },
  { id: 'sage', label: 'Sage', fill: '#DCE4D6', ink: '#2F3A2C' },
  { id: 'sky', label: 'Sky', fill: '#D9E3EC', ink: '#2C3540' },
  { id: 'butter', label: 'Butter', fill: '#F5EAC2', ink: '#4A4128' },
  { id: 'ink', label: 'Black', fill: '#1B1A19', ink: '#EDE8DF' },
];
export const frameColor = (id) => FRAME_COLORS.find((c) => c.id === id) || FRAME_COLORS[0];

// Text colours offered in the colour row ('auto' = the frame's own ink colour).
export const TEXT_COLORS = ['auto', '#FFFFFF', '#1C1B19', '#8C867E', '#E0662F', '#B23A3A', '#E5484D', '#E86FA5', '#8E5BD8', '#2E3F66', '#2E7DD7', '#3F8A57', '#F2B53A'];
export const TEXT_BGS = ['none', 'solid', 'soft'];
export const TEXT_ALIGNS = ['left', 'center', 'right'];
export const ELEMENT_TYPES = ['text', 'date', 'emoji', 'sticker', 'image'];
export const SIZE = { min: 1.2, max: 80 }; // mm: text height, or a sticker's height

let seq = 0;
export const newId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/* ---------------- elements ----------------
 * Every element has an anchor (x, y as fractions of the card's width and height), a rotation
 * in degrees about that anchor and a size in mm. Text and dates are anchored on their aligned
 * side (left / centre / right), so a date set flush with the photo's right edge stays flush when
 * its text changes length. */
const base = (type, over) => ({ id: newId(), type, x: 0.5, y: 0.5, rot: 0, ...over });
export const textEl = (over = {}) => base('text', { text: '', font: 'Caveat', size: 6, color: 'auto', align: 'center', bg: 'none', ...over });
export function dateEl(over = {}) {
  const { fmt, ...rest } = over;
  return base('date', { source: 'photo', font: 'Caveat', size: 4.6, color: 'auto', align: 'right', bg: 'none', ...rest, fmt: { ...defaultDateFormat(), ...fmt } });
}
export const emojiEl = (char, over = {}) => base('emoji', { char, size: 12, ...over });
export const stickerEl = (sticker, over = {}) => base('sticker', { sticker, size: 14, color: null, ...over });
export const imageEl = (asset, ratio, over = {}) => base('image', { asset, ratio, size: 24, ...over });

/** Where new text and the date go on a card: the middle of the chin (or the card centre). */
export function chinSpot(card, align = 'center') {
  const { win } = card;
  const y = card.chin.h >= 5 ? (win.y + win.h + card.h) / 2 : card.h / 2;
  const x = align === 'right' ? win.x + win.w : align === 'left' ? win.x : card.w / 2;
  return { x: x / card.w, y: y / card.h };
}

const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const finite = (v, lo, hi, d) => (Number.isFinite(v) ? clamp(v, lo, hi) : d);

export function sanitizeElement(e) {
  if (!e || typeof e !== 'object' || !ELEMENT_TYPES.includes(e.type)) return null;
  const out = {
    id: typeof e.id === 'string' && e.id ? e.id.slice(0, 40) : newId(), type: e.type,
    x: finite(e.x, -0.5, 1.5, 0.5), y: finite(e.y, -0.5, 1.5, 0.5),
    rot: Number.isFinite(e.rot) ? ((e.rot % 360) + 360) % 360 : 0,
    size: finite(e.size, SIZE.min, SIZE.max, 6),
  };
  if (e.type === 'text' || e.type === 'date') {
    Object.assign(out, {
      font: isKnownFont(e.font) ? e.font : 'Caveat',
      color: e.color === 'auto' || isColor(e.color) ? e.color : 'auto',
      align: TEXT_ALIGNS.includes(e.align) ? e.align : 'center',
      bg: TEXT_BGS.includes(e.bg) ? e.bg : 'none',
    });
    if (e.type === 'text') out.text = String(e.text ?? '').slice(0, 400);
    else { out.source = e.source === 'now' ? 'now' : 'photo'; out.fmt = sanitizeFormat(e.fmt); }
  } else if (e.type === 'emoji') {
    if (typeof e.char !== 'string' || !e.char.trim()) return null;
    out.char = e.char.trim().slice(0, 16);
  } else if (e.type === 'sticker') {
    if (!stickerById(e.sticker)) return null;
    out.sticker = e.sticker;
    out.color = isColor(e.color) ? e.color : null;
  } else {
    if (typeof e.asset !== 'string' && typeof e.src !== 'string') return null;
    out.asset = typeof e.asset === 'string' ? e.asset.slice(0, 60) : null;
    out.ratio = finite(e.ratio, 0.05, 20, 1);
    if (typeof e.src === 'string' && e.src.startsWith('data:image/')) out.src = e.src; // themes carry the picture
  }
  return out;
}

/* ---------------- prints and the document ---------------- */
export const defaultLayout = (format) => ({ aspect: FORMATS[format].aspect, turn: false, w: null, h: null, top: null, corner: null });
export const defaultCrop = () => ({ rot: 0, zoom: 1, cx: 0.5, cy: 0.5 });

function sanitizeLayout(L, format) {
  const out = defaultLayout(format);
  if (!L || typeof L !== 'object') return out;
  if (L.aspect === 'custom' || ASPECTS.some((a) => a.id === L.aspect)) out.aspect = L.aspect;
  out.turn = L.turn === true;
  for (const k of ['w', 'h', 'top']) if (Number.isFinite(L[k])) out[k] = clamp(L[k], 0, 1);
  if (Number.isFinite(L.corner)) out.corner = clamp(L.corner, 0, CORNER.max);
  if (out.aspect === 'custom' && (out.w == null || out.h == null)) out.aspect = FORMATS[format].aspect;
  return out;
}
function sanitizeCrop(c) {
  const out = defaultCrop();
  if (!c || typeof c !== 'object') return out;
  if ([0, 90, 180, 270].includes(c.rot)) out.rot = c.rot;
  out.zoom = finite(c.zoom, 1, 5, 1);
  out.cx = finite(c.cx, 0, 1, 0.5);
  out.cy = finite(c.cy, 0, 1, 0.5);
  return out;
}
export function sanitizePrint(p, format, fallback) {
  const out = fallback ? clonePrint(fallback) : blankPrint(format, 'portrait');
  if (!p || typeof p !== 'object') return out;
  if (p.orientation === 'portrait' || p.orientation === 'landscape') out.orientation = p.orientation;
  out.layout = sanitizeLayout(p.layout, format);
  if (FRAME_COLORS.some((c) => c.id === p.color)) out.color = p.color;
  out.crop = sanitizeCrop(p.crop);
  if (Array.isArray(p.elements)) out.elements = p.elements.map(sanitizeElement).filter(Boolean).slice(0, 80);
  return out;
}
const blankPrint = (format, orientation) => ({ orientation, layout: defaultLayout(format), color: 'white', crop: defaultCrop(), elements: [] });
export const clonePrint = (p) => JSON.parse(JSON.stringify(p));

/** The card a print gets on the default-sized sheet of a document (for placing elements). */
export function cardOf(doc, format, i) {
  const prints = doc[format];
  return sheetLayout({ paperId: doc.paperId, customPaper: doc.customPaper, format, prints }).slots[i].card;
}

/** A fresh print: the format's default layout with the date in the bottom right of the chin. */
export function defaultPrint(format, orientation, paper = {}) {
  const p = blankPrint(format, orientation);
  const card = sheetLayout({ ...paper, format, prints: [p, p] }).slots[0].card;
  p.elements.push(dateEl(chinSpot(card, 'right')));
  return p;
}
export function defaultDoc() {
  const paper = { paperId: DEFAULT_PAPER, customPaper: { w: 148, h: 100 } };
  return {
    format: 'two', ...paper, marks: true, linked: true,
    two: [defaultPrint('two', 'portrait', paper), defaultPrint('two', 'portrait', paper)],
    one: [defaultPrint('one', 'landscape', paper)],
    templateId: null,
  };
}
export function sanitizeDoc(raw) {
  const d = defaultDoc();
  if (!raw || typeof raw !== 'object') return d;
  if (raw.format === 'one' || raw.format === 'two') d.format = raw.format;
  if (PAPERS[raw.paperId] || OTHER_PAPERS[raw.paperId] || raw.paperId === 'custom') d.paperId = raw.paperId;
  if (Number.isFinite(raw.customPaper?.w) && Number.isFinite(raw.customPaper?.h)) d.customPaper = { w: raw.customPaper.w, h: raw.customPaper.h };
  if (typeof raw.marks === 'boolean') d.marks = raw.marks;
  if (typeof raw.linked === 'boolean') d.linked = raw.linked;
  for (const f of ['two', 'one']) {
    if (!Array.isArray(raw[f])) continue;
    d[f] = d[f].map((fb, i) => sanitizePrint(raw[f][i], f, fb));
  }
  if (typeof raw.templateId === 'string') d.templateId = raw.templateId;
  return d;
}
/** In Two Minis, prints facing the same way share one layout unless the user unlinks them. */
export const layoutsLinked = (doc) => doc.linked && doc.two[0].orientation === doc.two[1].orientation;

/* ---------------- theme text format ----------------
 * A theme is a whole document without the photos:
 *   {"twinmini":"theme","version":4,"name":"…","sheet":{format, paperId, customPaper, marks, linked},
 *    "two":[print, print],"one":[print]}
 * print: { orientation, layout: {aspect, turn, w, h, top, corner}, color, elements: [...] }
 * element: { type, x, y, rot, size, … } — text: text, font, color, align, bg; date: fmt, source and
 *   the text style; emoji: char; sticker: sticker id, color; image: ratio and src (a data: URL).
 * Several themes: an array of those, or {"templates":[…]}. Caption templates from older versions
 * (version 1–3: border captions by edge, an optional "look") still import. */
export const THEME_FORMAT = 'theme';
const themePrint = ({ orientation, layout, color, elements }) => JSON.parse(JSON.stringify({ orientation, layout, color, elements }));

export function themeToJson(name, doc) {
  return {
    twinmini: THEME_FORMAT, version: 4, name,
    sheet: { format: doc.format, paperId: doc.paperId, customPaper: { ...doc.customPaper }, marks: doc.marks, linked: doc.linked },
    two: doc.two.map(themePrint), one: doc.one.map(themePrint),
  };
}
export const exportThemesText = (list) =>
  JSON.stringify(list.length === 1 ? themeToJson(list[0].name, list[0].doc) : list.map((t) => themeToJson(t.name, t.doc)), null, 2);

/** Parse theme text into [{name, doc, elementsOnly}]; throws a readable Error on bad input.
 *  `elementsOnly` marks old caption-only templates, which change the writing but keep the look. */
export function parseThemesText(text) {
  let data;
  try { data = JSON.parse(String(text).trim()); } catch { throw new Error('That isn’t theme text (invalid JSON).'); }
  const list = Array.isArray(data) ? data : Array.isArray(data?.templates) ? data.templates : [data];
  const out = list.map((t) => {
    if (!t || typeof t !== 'object') throw new Error('No theme found.');
    const name = String(t.name || 'Imported').slice(0, 30);
    if (Array.isArray(t.two) || Array.isArray(t.one)) {
      return { name, doc: sanitizeDoc({ ...t.sheet, two: t.two, one: t.one }), elementsOnly: false };
    }
    if (!Array.isArray(t.captions)) throw new Error('Missing "captions" list.');
    return { name, doc: legacyDoc(t.look, t.captions, t.date), elementsOnly: !t.look };
  });
  if (!out.length) throw new Error('No themes found.');
  return out;
}

/* ---------------- older versions: border captions and a shared look ---------------- */
const LINE = 1.22;
const ALIGN_OF = { start: 'left', center: 'center', end: 'right' };

/**
 * Turn border captions (placed by edge, alignment and shift) into free elements at the same
 * spot on a card, matching how the old renderer stacked them across each border.
 */
function captionElements(lines, card) {
  const { win } = card;
  const out = [];
  for (const edge of ['bottom', 'top', 'left', 'right']) {
    const group = lines.filter((l) => l.edge === edge);
    if (!group.length) continue;
    const vertical = edge === 'left' || edge === 'right';
    const side = win.x;
    const band = {
      bottom: { cx: win.x + win.w / 2, cy: (win.y + win.h + card.h) / 2, across: card.h - win.y - win.h, rot: 0 },
      top: { cx: win.x + win.w / 2, cy: win.y / 2, across: win.y, rot: 0 },
      left: { cx: side / 2, cy: win.y + win.h / 2, across: side, rot: -90 },
      right: { cx: card.w - side / 2, cy: win.y + win.h / 2, across: side, rot: 90 },
    }[edge];
    const length = vertical ? win.h : win.w;
    const away = edge === 'bottom' ? 1 : -1;
    let y = -group.reduce((s, l) => s + l.size * LINE, 0) / 2;
    for (const l of group) {
      const lh = l.size * LINE;
      const ly = y + lh / 2 + away * effectiveShift(l, band.across);
      const lx = l.align === 'start' ? -length / 2 : l.align === 'end' ? length / 2 : 0;
      const [X, Y] = band.rot === 0 ? [band.cx + lx, band.cy + ly] : band.rot === -90 ? [band.cx + ly, band.cy - lx] : [band.cx - ly, band.cy + lx];
      const color = CAPTION_COLORS.find((c) => c.id === l.color)?.value || 'auto';
      // The old renderer shrank a line that ran past the card; estimate its width and do the same.
      const reach = Math.max(length / 2, (vertical ? Math.min(band.cy, card.h - band.cy) : card.w / 2) - 2.5);
      const room = l.align === 'center' ? 2 * reach : length / 2 + reach;
      const wide = String(l.kind === 'date' ? formatDate(new Date(2026, 9, 17, 22, 22), l.fmt) : l.text).length * l.size * 0.42;
      const size = wide > room ? Math.max(l.size * 0.35, l.size * (room / wide)) : l.size;
      const common = { x: X / card.w, y: Y / card.h, rot: (band.rot + 360) % 360, size: +size.toFixed(2), font: l.font, color, align: ALIGN_OF[l.align] || 'center', bg: 'none' };
      out.push(l.kind === 'date' ? dateEl({ ...common, fmt: l.fmt, source: l.source }) : textEl({ ...common, text: l.text }));
      y += lh;
    }
  }
  return out;
}

/** A document from an old look ({format, layout{two, one}, color, marks, paperId, customPaper}) and captions. */
export function legacyDoc(look, captions, date) {
  const doc = defaultDoc();
  const lk = look && typeof look === 'object' ? look : {};
  const color = FRAME_COLORS.some((c) => c.id === lk.color) ? lk.color : 'white';
  Object.assign(doc, sanitizeDoc({ format: lk.format, paperId: lk.paperId, customPaper: lk.customPaper, marks: lk.marks }));
  const two = lk.layout?.two || {}, one = lk.layout?.one || {};
  const port = one.orientation === 'portrait';
  const layouts = {
    two: sanitizeLayout({ aspect: two.aspect, w: two.w, h: two.h, top: two.top }, 'two'),
    one: sanitizeLayout({ aspect: one.aspect, w: one.w, h: one.h, top: one.top, turn: !port && one.flip === false }, 'one'),
  };
  const layers = sanitizeLayers(captions) || [];
  const d = migrateDate(date, captions);
  for (const f of ['two', 'one']) {
    doc[f] = doc[f].map((p, i) => ({ ...p, orientation: f === 'one' && port ? 'portrait' : f === 'one' ? 'landscape' : 'portrait', layout: { ...layouts[f] }, color }));
    doc[f].forEach((p, i) => {
      const card = cardOf(doc, f, i);
      const lines = layers.map((l) => ({ ...l, text: ((l.same ? l.text : l.texts?.[i]) || '').trim() })).filter((l) => l.text);
      if (d?.on) lines.push(d);
      p.elements = captionElements(lines, card);
    });
  }
  return doc;
}

/** The saved state of version 2 (one look, border captions) as a document. */
export const migrateV2State = (saved) => legacyDoc(saved, saved.layers, saved.date);

/**
 * Keep elements in the same part of the print when its layout changes: text in the chin stays
 * in the chin, a sticker on the photo stays on the same spot of the photo. Each axis is mapped
 * piecewise through the borders and the photo window of the old and new card.
 */
export function remapElements(print, from, to) {
  const axis = (v, a0, a1, A, b0, b1, B) => {
    if (v <= a0) return a0 > 0 ? (v / a0) * b0 : v - a0 + b0;
    if (v <= a1) return b0 + ((v - a0) / ((a1 - a0) || 1)) * (b1 - b0);
    return A > a1 ? b1 + ((v - a1) / (A - a1)) * (B - b1) : b1 + (v - a1);
  };
  for (const el of print.elements) {
    const x = axis(el.x * from.w, from.win.x, from.win.x + from.win.w, from.w, to.win.x, to.win.x + to.win.w, to.w);
    const y = axis(el.y * from.h, from.win.y, from.win.y + from.win.h, from.h, to.win.y, to.win.y + to.win.h, to.h);
    el.x = x / to.w;
    el.y = y / to.h;
  }
}
