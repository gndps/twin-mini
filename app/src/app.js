import { PAPERS, OTHER_PAPERS, CUSTOM_PAPER, resolvePaper, sheetLayout, cropRect, effectiveDpi, chooseDpi, sheetPixels, MM_PER_INCH } from './geometry.js';
import { renderSheet, makeSourceCache } from './render.js';
import { setPngDpi } from './dpi.js';
import { readExifDate } from './exif.js';
import { loadFonts } from './fonts.js';
import { DATE_OPTIONS, TIME_SOURCES, formatDate } from './captions.js';
import {
  defaultDoc, sanitizeDoc, migrateV2State, defaultCrop, newId, clonePrint, layoutsLinked,
  exportThemesText, parseThemesText, legacyDoc, cardOf, remapElements,
} from './model.js';
import { putBlob, deleteBlob, getBlob, allKeys } from './store.js';
import { createEditor } from './editor.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const PREVIEW_LONG_SIDE = 2400;
const STATE_KEY = 'twinmini:v3';
const OLD_STATE_KEY = 'twinmini:v2';
const TEMPLATES_KEY = 'twinmini:templates';

// Canvas pixel budget: iOS/Safari caps canvases at 16.7 MP; desktop browsers allow far more.
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent) || /iP(hone|ad|od)/.test(navigator.userAgent);
const MAX_PIXELS = isSafari ? 16_777_216 : 120_000_000;

/* ---------------- persistence (everything lives in this browser) ---------------- */
function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
function loadDoc() {
  const saved = readJson(STATE_KEY);
  if (saved) return sanitizeDoc(saved);
  const old = readJson(OLD_STATE_KEY);
  if (old) { try { return migrateV2State(old); } catch { /* start fresh */ } }
  return defaultDoc();
}
function loadTemplates() {
  const list = readJson(TEMPLATES_KEY);
  if (!Array.isArray(list)) return [];
  return list.filter((t) => t?.name).map((t) => {
    if (t.doc) return { id: t.id, name: t.name, doc: sanitizeDoc(t.doc), elementsOnly: !!t.elementsOnly };
    // Saved by an older version: captions, a date and maybe a look.
    return { id: t.id, name: t.name, doc: legacyDoc(t.look, t.layers, t.date), elementsOnly: !t.look };
  });
}

/* ---------------- state ---------------- */
let doc = loadDoc();
let templates = loadTemplates();
let siteTemplates = [];
const photos = [null, null];   // shared by both formats: photo 1 and photo 2
const assets = new Map();      // picture stickers: id → { img, dataUrl }
const today = new Date();

const fullSource = makeSourceCache();
const previewCache = makeSourceCache();
const previewSource = (p, pxPerSrc) => previewCache({ bitmap: p.preview }, pxPerSrc * (p.width / p.preview.width));

const count = () => (doc.format === 'two' ? 2 : 1);
const prints = () => doc[doc.format];
const sheet = () => sheetLayout({ paperId: doc.paperId, customPaper: doc.customPaper, format: doc.format, prints: prints() });
const photoDate = (i) => photos[i]?.date || today;
const docData = () => JSON.stringify({ ...doc, templateId: null });

/* Undo history: a snapshot after every finished change. */
let history = [docData()];
let future = [];
function save() { writeJson(STATE_KEY, doc); }
/** Record a finished change: save it, make it undoable and redraw the sheet. */
function commit({ keepTemplate = false } = {}) {
  if (!keepTemplate) doc.templateId = null;
  const snap = docData();
  if (snap !== history[history.length - 1]) {
    history.push(snap);
    if (history.length > 80) history.shift();
    future = [];
  }
  save();
  drawHome();
}
function restore(snap) {
  const templateId = doc.templateId;
  doc = sanitizeDoc(JSON.parse(snap));
  doc.templateId = templateId;
  save();
  drawHome();
}
const undo = () => { if (history.length < 2) return false; future.push(history.pop()); restore(history[history.length - 1]); return true; };
const redo = () => { if (!future.length) return false; const s = future.pop(); history.push(s); restore(s); return true; };

/* ---------------- photos ---------------- */
async function loadPhoto(file) {
  // An <img> applies the EXIF orientation, so phone photos come in upright.
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(/hei[cf]/i.test(file.type + file.name)
      ? 'This browser can’t open HEIC. Export the photo as JPEG, or use Safari.'
      : `Couldn’t open “${file.name}”.`);
  }
  const width = img.naturalWidth, height = img.naturalHeight;
  const s = Math.min(1, PREVIEW_LONG_SIDE / Math.max(width, height));
  const { img: small } = fullSource({ bitmap: img }, s);
  const pv = document.createElement('canvas');
  pv.width = Math.max(1, Math.round(width * s));
  pv.height = Math.max(1, Math.round(height * s));
  const pctx = pv.getContext('2d');
  pctx.imageSmoothingQuality = 'high';
  pctx.drawImage(small, 0, 0, pv.width, pv.height);
  let date = null;
  try { date = readExifDate(await file.slice(0, 256 * 1024).arrayBuffer()); } catch { /* not a JPEG */ }
  return { bitmap: img, preview: pv, url, width, height, name: file.name, date: date || new Date(file.lastModified || Date.now()) };
}
function releasePhoto(p) { if (p) URL.revokeObjectURL(p.url); }
/** Put a photo in slot i of both formats (each print keeps its own crop, reset for the new photo). */
async function setPhoto(i, file) {
  const p = await loadPhoto(file);
  releasePhoto(photos[i]);
  photos[i] = p;
  for (const f of ['two', 'one']) if (doc[f][i]) doc[f][i].crop = defaultCrop();
  putBlob('photos', i, file);
}
function removePhoto(i) {
  releasePhoto(photos[i]);
  photos[i] = null;
  deleteBlob('photos', i);
}

async function placeFiles(files, target, then) {
  const images = [...files].filter((f) => f.type.startsWith('image/') || /\.(hei[cf]|jpe?g|png|webp|avif)$/i.test(f.name));
  if (!images.length) return toast('Those files aren’t images.');
  const all = Array.from({ length: count() }, (_, i) => i);
  let order;
  if (target != null) order = [target, ...all.filter((i) => i !== target && !photos[i])];
  else {
    order = all.filter((i) => !photos[i]);
    if (!order.length) order = all;
  }
  if (images.length > order.length) toast(count() === 2 ? 'The sheet holds two photos.' : 'One Wide holds one photo.');
  const placed = [];
  await Promise.all(images.slice(0, order.length).map(async (file, k) => {
    try { await setPhoto(order[k], file); placed.push(order[k]); } catch (e) { toast(e.message); }
  }));
  commit();
  editor.refresh();
  if (placed.length) then?.(Math.min(...placed));
}

const fileInput = $('#fileInput');
let pickThen = null, pickTarget = null;
function pickFiles(i, then) {
  pickTarget = i;
  pickThen = then;
  fileInput.multiple = count() === 2 && (i == null || (!photos[0] && !photos[1]));
  fileInput.click();
}
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) placeFiles(fileInput.files, pickTarget, pickThen);
  fileInput.value = '';
});

/* ---------------- picture stickers ---------------- */
const blobToDataUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(blob); });
async function decodeAsset(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { img, dataUrl: await blobToDataUrl(blob), w: img.naturalWidth, h: img.naturalHeight };
}
/** Add a picture (PNG, GIF's first frame, …) as a sticker asset, at most 1200 px on its long side. */
async function addAsset(file) {
  const src = await decodeAsset(file);
  const k = Math.min(1, 1200 / Math.max(src.w, src.h));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(src.w * k));
  cv.height = Math.max(1, Math.round(src.h * k));
  const c = cv.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(src.img, 0, 0, cv.width, cv.height);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const id = newId();
  assets.set(id, await decodeAsset(blob));
  putBlob('assets', id, blob);
  return { id, ratio: cv.width / cv.height };
}
/** Theme text carries pictures as data: URLs; store each as an asset and point the element at it. */
async function ingestAssets(d) {
  for (const f of ['two', 'one']) for (const p of d[f]) for (const el of p.elements) {
    if (el.type !== 'image' || !el.src) continue;
    try {
      const blob = await (await fetch(el.src)).blob();
      const id = newId();
      assets.set(id, await decodeAsset(blob));
      putBlob('assets', id, blob);
      el.asset = id;
    } catch { /* unreadable picture: dropped below */ }
    delete el.src;
  }
  for (const f of ['two', 'one']) for (const p of d[f]) p.elements = p.elements.filter((el) => el.type !== 'image' || assets.has(el.asset));
  return d;
}
/** A copy of a document with its pictures inlined, for theme text. */
function withPictures(d) {
  const c = JSON.parse(JSON.stringify(d));
  for (const f of ['two', 'one']) for (const p of c[f]) {
    p.elements = p.elements.filter((el) => el.type !== 'image' || assets.get(el.asset)?.dataUrl);
    for (const el of p.elements) if (el.type === 'image') { el.src = assets.get(el.asset).dataUrl; delete el.asset; }
  }
  return c;
}
const assetIds = (d) => ['two', 'one'].flatMap((f) => d[f].flatMap((p) => p.elements.filter((e) => e.type === 'image').map((e) => e.asset)));

/* ---------------- home: the sheet ---------------- */
const sheetEl = $('#sheet');
const canvas = $('#preview');
const slotsEl = $('#slots');

const items = (only = false) => prints().map((print, i) => ((only && !photos[i]) ? null : { print, photo: photos[i], photoDate: photoDate(i) }));
function drawHome() {
  const layout = sheet();
  sheetEl.style.setProperty('--ar', String(layout.paper.w / layout.paper.h));
  const rect = sheetEl.getBoundingClientRect();
  if (rect.width) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    renderSheet(canvas.getContext('2d'), layout, items(), {
      scale: canvas.width / layout.paper.w, marks: doc.marks, sourceFor: previewSource, assets,
    });
  }
  buildSlots(layout);
  buildHomeTools();
  $$('#formatSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === doc.format)));
  $('#homeHint').textContent = photos.slice(0, count()).some(Boolean) ? 'Tap a print to edit it' : count() === 2 ? 'Add two photos, then tap a print to edit it' : 'Add a photo, then tap it to edit';
}
function buildSlots(layout) {
  const { paper } = layout;
  const key = JSON.stringify([layout.slots.map((s) => [s.x, s.w, s.h]), photos.map(Boolean), paper.w, paper.h]);
  if (slotsEl.dataset.key === key) return;
  slotsEl.dataset.key = key;
  slotsEl.replaceChildren(...layout.slots.map((slot, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    Object.assign(el.style, {
      left: `${(slot.x / paper.w) * 100}%`, top: `${(slot.y / paper.h) * 100}%`,
      width: `${(slot.w / paper.w) * 100}%`, height: `${(slot.h / paper.h) * 100}%`,
    });
    const name = count() === 2 ? `print ${i + 1}` : 'the print';
    if (photos[i]) {
      el.innerHTML = `<button class="slot-hit" aria-label="Edit ${name}"></button><span class="slot-pill">${icon('edit')}Edit</span>`;
      el.querySelector('.slot-hit').addEventListener('click', () => editor.open(i));
    } else {
      el.classList.add('empty');
      el.innerHTML = `<button class="slot-add" aria-label="Add a photo to ${name}"><span class="slot-plus">${icon('plus')}</span><span>Add photo</span></button>
        <button class="slot-edit">Edit frame</button>`;
      el.querySelector('.slot-add').addEventListener('click', () => pickFiles(i, (k) => editor.open(k)));
      el.querySelector('.slot-edit').addEventListener('click', () => editor.open(i));
    }
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop-target'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation();
      el.classList.remove('drop-target');
      document.body.classList.remove('dragging');
      if (e.dataTransfer.files.length) placeFiles(e.dataTransfer.files, i);
    });
    return el;
  }));
}

export const ICONS = {
  plus: '<path d="M10 4v12M4 10h12"/>',
  edit: '<path d="M4 16h3.5L16 7.5 12.5 4 4 12.5z"/><path d="m11 5.5 3.5 3.5"/>',
  paper: '<rect x="3" y="5" width="14" height="10" rx="1"/><path d="M10 5v10"/>',
  cut: '<circle cx="5.5" cy="14" r="2.2"/><circle cx="14.5" cy="14" r="2.2"/><path d="M7.3 12.6 15 4M12.7 12.6 5 4"/>',
  swap: '<path d="M6 4 3 7l3 3M3 7h11M14 10l3 3-3 3M17 13H6"/>',
  theme: '<path d="M10 3a7 7 0 1 0 0 14c1 0 1.6-.7 1.6-1.5 0-.5-.3-.8-.3-1.3 0-.8.6-1.4 1.4-1.4H14a3 3 0 0 0 3-3C17 6 14 3 10 3Z"/><circle cx="6.5" cy="9" r=".9"/><circle cx="9" cy="6.2" r=".9"/><circle cx="12.6" cy="6.6" r=".9"/>',
  check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
};
export const icon = (k) => `<svg viewBox="0 0 20 20" aria-hidden="true">${ICONS[k]}</svg>`;

const fmtMm = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const paperName = (p) => (p.id === 'custom' ? `Custom ${fmtMm(p.w)} × ${fmtMm(p.h)} mm` : PAPERS[p.id] ? p.id : p.kind);
function deckButton(key, label, onClick, { pressed, sub } = {}) {
  const b = document.createElement('button');
  b.className = 'deck-btn';
  b.innerHTML = `${icon(key)}<span>${label}</span>${sub ? `<small>${sub}</small>` : ''}`;
  if (pressed != null) b.setAttribute('aria-pressed', String(pressed));
  b.addEventListener('click', onClick);
  return b;
}
function buildHomeTools() {
  const paper = resolvePaper(doc.paperId, doc.customPaper);
  const tools = [deckButton('paper', 'Paper', () => { buildPaperList(); $('#paperDlg').showModal(); }, { sub: paper.id === 'custom' ? 'Custom' : PAPERS[paper.id] ? paper.id : paper.kind })];
  if (count() === 2) {
    tools.push(deckButton('cut', 'Cut guide', () => { doc.marks = !doc.marks; commit(); }, { pressed: doc.marks }));
    tools.push(deckButton('swap', 'Swap', swapPrints));
  }
  tools.push(deckButton('theme', 'Themes', () => { buildTemplateManager(); $('#themesDlg').showModal(); }));
  $('#homeTools').replaceChildren(...tools);
}
function swapPrints() {
  [photos[0], photos[1]] = [photos[1], photos[0]];
  [doc.two[0], doc.two[1]] = [doc.two[1], doc.two[0]];
  for (const i of [0, 1]) {
    // Keep the saved photos in their new slots.
    if (photos[i]) fetch(photos[i].url).then((r) => r.blob()).then((b) => putBlob('photos', i, b)).catch(() => {});
    else deleteBlob('photos', i);
  }
  commit();
}
$('#formatSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.value === doc.format) return;
  doc.format = b.dataset.value;
  commit({ keepTemplate: true });
  loadFonts(fontsInUse()).then(drawHome);
});

const fontsInUse = () => [...new Set(['two', 'one'].flatMap((f) => doc[f].flatMap((p) => p.elements.filter((e) => e.font).map((e) => e.font))))];

/* ---------------- paper ---------------- */
function paperRow(p) {
  const b = document.createElement('button');
  b.className = 'paper-row';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(doc.paperId === p.id));
  const title = PAPERS[p.id] ? p.id : p.kind;
  const sub = PAPERS[p.id] ? `${p.kind} · ${p.note}` : p.note;
  b.innerHTML = `<span><b>${title}</b><small>${sub}</small></span><span class="dims">${fmtMm(p.w)} × ${fmtMm(p.h)}</span><span class="check">${icon('check')}</span>`;
  // Picking a paper loads its size into the fields, so it can be tweaked into a custom size.
  b.addEventListener('click', () => { doc.paperId = p.id; doc.customPaper = { w: p.w, h: p.h }; commit(); buildPaperList(); });
  return b;
}
function buildPaperList() {
  const paper = resolvePaper(doc.paperId, doc.customPaper);
  $('#paperList').replaceChildren(...Object.values(PAPERS).map(paperRow));
  $('#otherPaperList').replaceChildren(...Object.values(OTHER_PAPERS).map(paperRow));
  for (const [id, v] of [['#paperW', paper.w], ['#paperH', paper.h]]) if (document.activeElement !== $(id)) $(id).value = fmtMm(v);
  $('#paperSizeNote').textContent = doc.paperId === 'custom'
    ? `Custom size, ${CUSTOM_PAPER.min}–${CUSTOM_PAPER.max} mm per side.`
    : `${paperName(paper)}. Pick another below, or type any size for a custom sheet.`;
}
for (const id of ['#paperW', '#paperH']) {
  $(id).addEventListener('change', () => {
    const w = parseFloat($('#paperW').value), h = parseFloat($('#paperH').value);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    const match = [...Object.values(PAPERS), ...Object.values(OTHER_PAPERS)]
      .find((p) => Math.abs(p.w - Math.max(w, h)) < 0.05 && Math.abs(p.h - Math.min(w, h)) < 0.05);
    doc.customPaper = { w, h };
    doc.paperId = doc.paperId !== 'custom' && match && resolvePaper(doc.paperId).w === match.w && resolvePaper(doc.paperId).h === match.h
      ? doc.paperId : match ? match.id : 'custom';
    commit();
    buildPaperList();
  });
}
$('#paperSize').addEventListener('submit', (e) => { e.preventDefault(); document.activeElement?.blur(); });

/* ---------------- themes ---------------- */
function allTemplates() {
  return [...siteTemplates.map((t, k) => ({ ...t, id: `s${k}`, site: true })), ...templates];
}
/** Templates shipped with the site: app/templates.json, in the same text format as Export. */
fetch('templates.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.text() : null))
  .then((text) => {
    if (!text) return;
    try { siteTemplates = parseThemesText(text); } catch { siteTemplates = []; }
    buildTemplateChips();
  })
  .catch(() => {});

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied as text`);
  } catch {
    // No async clipboard (older browsers, insecure context): copy through a temporary field
    // inside whichever dialog is open, so the selection is not blocked by the modal.
    const box = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    box.style.cssText = 'position:fixed;opacity:0;left:0;top:0';
    ($$('dialog[open]').pop() || document.body).append(box);
    box.select();
    const ok = document.execCommand?.('copy');
    box.remove();
    toast(ok ? `${what} copied as text` : 'Copy failed — use Save file instead');
  }
}
const freshIds = (els) => els.map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: newId() }));
/** Apply a theme: its whole look (keeping each print's photo crop), or only its writing for old caption templates. */
async function applyTemplate(t) {
  const d = await ingestAssets(JSON.parse(JSON.stringify(t.doc)));
  for (const f of ['two', 'one']) {
    d[f].forEach((p, i) => {
      if (t.elementsOnly) {
        // Writing only: keep this print's look and move the writing onto its layout.
        const moved = { elements: freshIds(p.elements) };
        if (doc[f][i].orientation === p.orientation) remapElements(moved, cardOf(d, f, i), cardOf(doc, f, i));
        doc[f][i].elements = moved.elements;
      }
      else doc[f][i] = { ...clonePrint(p), crop: doc[f][i].crop, elements: freshIds(p.elements) };
    });
  }
  if (!t.elementsOnly) Object.assign(doc, { format: d.format, paperId: d.paperId, customPaper: d.customPaper, marks: d.marks, linked: d.linked });
  doc.templateId = t.id;
  commit({ keepTemplate: true });
  buildTemplateChips();
  editor.refresh();
  loadFonts(fontsInUse()).then(() => { drawHome(); editor.refresh(); });
}
const newTemplateId = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const saveTemplates = () => writeJson(TEMPLATES_KEY, templates.map((t) => ({ id: t.id, name: t.name, doc: t.doc, elementsOnly: t.elementsOnly })));
/** Save parsed themes under their own names (replacing same-named ones); returns the saved list. */
async function storeTemplates(parsed) {
  const out = [];
  for (const t of parsed) {
    const existing = templates.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    const tpl = { id: existing?.id || newTemplateId(), name: t.name, doc: await ingestAssets(t.doc), elementsOnly: t.elementsOnly };
    templates = existing ? templates.map((x) => (x.id === tpl.id ? tpl : x)) : [...templates, tpl];
    out.push(tpl);
  }
  return out;
}
/** Import pasted theme text: save every theme by name and apply the first one. */
async function importTemplates(text) {
  let parsed;
  try { parsed = parseThemesText(text); } catch (err) { toast(err.message); return false; }
  const saved = await storeTemplates(parsed);
  saveTemplates();
  await applyTemplate(saved[0]);
  buildTemplateManager();
  toast(parsed.length === 1 ? `Imported “${parsed[0].name}”` : `Imported ${parsed.length} themes`);
  return true;
}
const currentThemeName = () => allTemplates().find((t) => t.id === doc.templateId)?.name || 'My theme';
const themeText = (name) => exportThemesText([{ name, doc: withPictures(doc) }]);
function buildTemplateChips() {
  $('#templateChips').replaceChildren(...allTemplates().map((t) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.setAttribute('role', 'listitem');
    b.setAttribute('aria-pressed', String(doc.templateId === t.id));
    b.textContent = t.name;
    b.addEventListener('click', () => applyTemplate(t));
    return b;
  }));
}
function buildTemplateManager() {
  buildTemplateChips();
  const list = $('#tplList');
  if (!templates.length) { list.innerHTML = '<p class="empty-note">No saved themes yet.</p>'; return; }
  list.replaceChildren(...templates.map((t) => {
    const row = document.createElement('div');
    row.className = 'tpl-row';
    row.innerHTML = `<span>${escapeHtml(t.name)}<small>${t.elementsOnly ? 'Writing only' : 'Full theme'}</small></span>
      <button class="apply">Use</button><button class="exp" aria-label="Copy ${escapeHtml(t.name)} as text">Copy</button><button class="del" aria-label="Delete ${escapeHtml(t.name)}">Delete</button>`;
    row.querySelector('.exp').addEventListener('click', () => copyText(exportThemesText([{ name: t.name, doc: withPictures(t.doc) }]), `“${t.name}”`));
    row.querySelector('.apply').addEventListener('click', () => { applyTemplate(t); $('#themesDlg').close(); });
    row.querySelector('.del').addEventListener('click', () => {
      templates = templates.filter((x) => x.id !== t.id);
      if (doc.templateId === t.id) doc.templateId = null;
      saveTemplates(); save();
      buildTemplateManager();
    });
    return row;
  }));
}
$('#copyCurrent').addEventListener('click', () => copyText(themeText(currentThemeName()), 'Current theme'));
$('#copyAll').addEventListener('click', () => {
  if (!templates.length) return toast('No saved themes yet');
  copyText(exportThemesText(templates.map((t) => ({ name: t.name, doc: withPictures(t.doc) }))), 'Themes');
});
for (const [form, box] of [['#importForm', '#importText'], ['#helpImport', '#helpImportText']]) {
  $(form).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(await importTemplates($(box).value))) return;
    $(box).value = '';
    if (form === '#helpImport') $('#help').close();
  });
}
$('#tplForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#tplName').value.trim();
  if (!name) return;
  const existing = templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
  const tpl = { id: existing?.id || newTemplateId(), name, doc: sanitizeDoc(JSON.parse(JSON.stringify(doc))), elementsOnly: false };
  templates = existing ? templates.map((t) => (t.id === tpl.id ? tpl : t)) : [...templates, tpl];
  doc.templateId = tpl.id;
  saveTemplates(); save();
  $('#tplName').value = '';
  buildTemplateManager();
  toast(existing ? `Updated “${name}”` : `Saved “${name}”`);
});
$('#helpImportFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (await importTemplates(await file.text())) $('#help').close();
});

/* ---------------- date format sheet (opened from a selected date) ---------------- */
let dateTarget = null;
function openDateFormat(el, onChange) {
  dateTarget = { el, onChange };
  fillDateDialog();
  $('#dateDlg').showModal();
}
function fillDateDialog() {
  const { el } = dateTarget || {};
  if (!el) return;
  const f = el.fmt;
  $('#datePreview').textContent = formatDate(el.source === 'now' ? new Date() : photoDate(editor.index()), f);
  $$('#dateBlock [data-opt]').forEach((seg) => {
    $$('button', seg).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === String(f[seg.dataset.opt]))));
  });
  $('#sepRow').hidden = f.month !== 'num';
  $('#clockRow').hidden = f.show !== 'datetime';
  $('#secondsRow').hidden = f.show !== 'datetime';
  $('#fSeconds').checked = !!f.seconds;
  $('#dtSource').replaceChildren(...TIME_SOURCES.map((src) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(el.source === src.id));
    b.textContent = src.label;
    b.addEventListener('click', () => { el.source = src.id; dateTarget.onChange(); fillDateDialog(); });
    return b;
  }));
  $('#dtSourceNote').textContent = TIME_SOURCES.find((x) => x.id === el.source).detail;
}
$$('#dateBlock [data-opt]').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !dateTarget) return;
  const opt = seg.dataset.opt;
  dateTarget.el.fmt[opt] = DATE_OPTIONS[opt].find((v) => String(v) === b.dataset.value);
  dateTarget.onChange();
  fillDateDialog();
}));
$('#fSeconds').addEventListener('change', (e) => { if (!dateTarget) return; dateTarget.el.fmt.seconds = e.target.checked; dateTarget.onChange(); fillDateDialog(); });
$('#dateDlg').addEventListener('close', () => { if (dateTarget) commit(); dateTarget = null; });

/* ---------------- export: highest-resolution PNG (lossless) ---------------- */
const exportDlg = $('#exportDlg');
let exportUrl = null;
function photoDpi(i) {
  const slot = sheet().slots[i];
  const p = photos[i], { win } = slot.card, c = prints()[i].crop;
  const crop = cropRect(p.width, p.height, c.rot, win.w / win.h, c.zoom, c.cx, c.cy);
  return { dpi: effectiveDpi(crop.w, win.w), crop };
}
export function quality(dpi) {
  if (dpi >= 290) return { cls: 'good', label: 'Excellent' };
  if (dpi >= 200) return { cls: 'ok', label: 'Good' };
  return { cls: 'low', label: 'Low' };
}
async function exportSheet() {
  const layout = sheet();
  const preview = $('#exportPreview');
  const dl = $('#downloadLink');
  const share = $('#shareBtn');
  $('#themeName').value = currentThemeName();
  const used = items(true);
  const hasPhoto = used.some(Boolean);
  $('#printActions').hidden = !hasPhoto;
  share.hidden = true;
  if (!hasPhoto) {
    // No photos yet: only the theme can be exported.
    preview.innerHTML = '<p class="empty-note">Add a photo to export a print.</p>';
    $('#exportStats').textContent = '';
    exportDlg.showModal();
    return;
  }
  preview.innerHTML = '<div class="spinner" aria-label="Rendering"></div>';
  dl.setAttribute('aria-disabled', 'true');
  $('#exportStats').textContent = 'Rendering at full resolution…';
  exportDlg.showModal();
  await loadFonts(fontsInUse());
  await new Promise((r) => setTimeout(r, 30));

  // Empty frames are left off the print entirely.
  const dpis = used.map((it, i) => (it ? photoDpi(i).dpi : 0)).filter(Boolean);
  let dpi = chooseDpi(dpis, layout.paper, MAX_PIXELS), blob = null;
  for (let attempt = 0; attempt < 5 && !blob; attempt++) {
    const px = sheetPixels(layout.paper, dpi);
    const cv = document.createElement('canvas');
    cv.width = px.w; cv.height = px.h;
    const ctx = cv.getContext('2d');
    if (ctx) {
      renderSheet(ctx, layout, used, { scale: dpi / MM_PER_INCH, marks: doc.marks && count() === 2, sourceFor: fullSource, assets });
      blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    }
    cv.width = cv.height = 0;
    if (!blob) dpi = Math.max(300, Math.floor(dpi * 0.8)); // out of memory: step down and retry
  }
  if (!blob) { exportDlg.close(); return toast('Export failed on this device.'); }

  const bytes = setPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
  const name = `twinmini-${layout.paper.id === 'custom' ? `${fmtMm(layout.paper.w)}x${fmtMm(layout.paper.h)}mm` : layout.paper.id}-${dpi}dpi.png`;
  const file = new File([bytes], name, { type: 'image/png' });
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = URL.createObjectURL(file);

  const px = sheetPixels(layout.paper, dpi);
  preview.innerHTML = `<img src="${exportUrl}" alt="Print sheet preview">`;
  dl.href = exportUrl;
  dl.download = name;
  dl.removeAttribute('aria-disabled');
  $('#exportStats').textContent = `${paperName(layout.paper)} · ${px.w} × ${px.h} px · ${dpi} dpi · ${(file.size / 1e6).toFixed(1)} MB`;
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  share.hidden = !canShare;
  dl.classList.toggle('secondary', canShare);
  if (canShare) share.onclick = () => navigator.share({ files: [file], title: 'Twin Mini print' }).catch(() => {});
}
$('#exportBtn').addEventListener('click', exportSheet);
$('#themeExport').addEventListener('submit', (e) => {
  e.preventDefault();
  copyText(themeText($('#themeName').value.trim() || 'My theme'), `“${$('#themeName').value.trim()}”`);
});
$('#themeFile').addEventListener('click', () => {
  const name = $('#themeName').value.trim() || 'My theme';
  const url = URL.createObjectURL(new Blob([themeText(name)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'theme'}.twinmini.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------------- bottom sheets: drag the handle (phones) ---------------- */
// On phones every dialog is a bottom sheet with a grab handle. Dragging the handle (or the
// title bar) down closes it, dragging up expands a half-height sheet to full height, and a
// short drag springs back.
const phone = matchMedia('(max-width: 860px)');
function attachSheetDrag(dlg) {
  const head = dlg.querySelector('.sheet-head');
  if (!head || !dlg.querySelector('.grabber')) return; // only sheets that show a handle
  let start = null;
  head.addEventListener('pointerdown', (e) => {
    if (!phone.matches || e.target.closest('button')) return;
    start = { y: e.clientY, t: performance.now() };
    head.setPointerCapture(e.pointerId);
    dlg.style.transition = 'none';
  });
  head.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    dlg.style.transform = `translateY(${dy > 0 ? dy : dy * 0.25}px)`; // resist upward pulls
  });
  const end = (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    const v = dy / Math.max(1, performance.now() - start.t); // px per ms
    start = null;
    dlg.style.transition = 'transform .28s cubic-bezier(.32,.72,0,1)';
    const h = dlg.getBoundingClientRect().height;
    if (dy > Math.min(140, h * 0.3) || v > 0.6) {
      dlg.style.transform = `translateY(${h}px)`;
      setTimeout(() => { dlg.close(); dlg.style.transform = ''; dlg.style.transition = ''; dlg.classList.remove('expanded'); }, 240);
      return;
    }
    if (dy < -50 || v < -0.6) dlg.classList.add('expanded');
    dlg.style.transform = '';
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
  dlg.addEventListener('close', () => { dlg.classList.remove('expanded'); dlg.style.transform = ''; });
}
$$('dialog').forEach(attachSheetDrag);

/* ---------------- dialogs, files, drag & drop ---------------- */
$$('[data-open]').forEach((b) => b.addEventListener('click', () => $(`#${b.dataset.open}`).showModal()));
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (e.dataTransfer.files.length) placeFiles(e.dataTransfer.files, editor.isOpen() ? editor.index() : null);
});
window.addEventListener('paste', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) placeFiles(files, editor.isOpen() ? editor.index() : null);
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------------- the editor ---------------- */
const editor = createEditor({
  get doc() { return doc; },
  photos, assets, today,
  count, prints, sheet, photoDate, previewSource,
  commit, undo, redo, canUndo: () => history.length > 1, canRedo: () => future.length > 0,
  pickFiles, removePhoto, addAsset, openDateFormat, toast, linked: () => layoutsLinked(doc),
  fontsInUse, photoDpi, quality, escapeHtml,
});

/* ---------------- start: restore saved photos and pictures ---------------- */
async function restoreSaved() {
  const keys = (await allKeys('photos')) || [];
  await Promise.all(keys.filter((k) => k === 0 || k === 1).map(async (k) => {
    const blob = await getBlob('photos', k);
    if (!blob) return;
    try { photos[k] = await loadPhoto(blob instanceof File ? blob : new File([blob], 'photo', { type: blob.type })); } catch { deleteBlob('photos', k); }
  }));
  const used = new Set([...assetIds(doc), ...templates.flatMap((t) => assetIds(t.doc))]);
  for (const id of (await allKeys('assets')) || []) {
    if (!used.has(id)) { deleteBlob('assets', id); continue; }
    try { assets.set(id, await decodeAsset(await getBlob('assets', id))); } catch { /* unreadable */ }
  }
  drawHome();
  editor.refresh();
}

new ResizeObserver(() => drawHome()).observe(sheetEl);
document.fonts?.ready.then(drawHome);
save();
drawHome();
loadFonts(fontsInUse()).then(drawHome);
restoreSaved();
