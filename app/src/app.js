import { computeLayout, PAPERS, OTHER_PAPERS, CUSTOM_PAPER, resolvePaper, DEFAULT_PAPER, ASPECTS, FORMATS, aspectOf, cropRect, effectiveDpi, chooseDpi, sheetPixels, clamp, MM_PER_INCH } from './geometry.js';
import { renderSheet, makeSourceCache, FRAME_COLORS } from './render.js';
import { setPngDpi } from './dpi.js';
import { readExifDate } from './exif.js';
import { FONT_GROUPS, fontCss, loadFonts } from './fonts.js';
import {
  CAPTION_COLORS, DATE_OPTIONS, TIME_SOURCES, formatDate, effectiveShift,
  cloneLayers, cloneDate, dateSettings, defaultCaptions, defaultDate, migrateDate,
  resolveCaptions, sanitizeLayers, textLayer, exportTemplatesText, parseTemplatesText,
} from './captions.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const PREVIEW_LONG_SIDE = 2400;
const STATE_KEY = 'twinmini:v2';
const TEMPLATES_KEY = 'twinmini:templates';

// Canvas pixel budget: iOS/Safari caps canvases at 16.7 MP; desktop browsers allow far more.
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent) || /iP(hone|ad|od)/.test(navigator.userAgent);
const MAX_PIXELS = isSafari ? 16_777_216 : 120_000_000;
const touchFirst = matchMedia('(hover: none)').matches;

// Each format keeps its own shape, size and position, saved independently.
const defaultLayoutFor = (f) => ({
  aspect: FORMATS[f].aspect, w: null, h: null, top: null,
  ...(f === 'one' ? { orientation: 'landscape', flip: true } : {}),
});
const defaultLayout = () => ({ two: defaultLayoutFor('two'), one: defaultLayoutFor('one') });
const defaults = () => ({
  format: 'two', layout: defaultLayout(),
  color: 'white', marks: true, paperId: DEFAULT_PAPER, customPaper: { w: 148, h: 100 }, templateId: null,
  layers: defaultCaptions(), // text captions
  date: defaultDate(),       // the one date per print
});
const state = loadState();
let templates = loadTemplates();
let siteTemplates = [];
const photos = [null, null];
let selected = null;

const fullSource = makeSourceCache();
const previewCache = makeSourceCache();
const previewSource = (p, pxPerSrc) => previewCache({ bitmap: p.preview }, pxPerSrc * (p.width / p.preview.width));

/* ---------------- persistence (everything lives in this browser) ---------------- */
function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
function loadState() {
  const s = defaults();
  const saved = readJson(STATE_KEY);
  if (!saved) return s;
  if (FRAME_COLORS.some((c) => c.id === saved.color)) s.color = saved.color;
  if (typeof saved.marks === 'boolean') s.marks = saved.marks;
  if (PAPERS[saved.paperId] || OTHER_PAPERS[saved.paperId] || saved.paperId === 'custom') s.paperId = saved.paperId;
  if (Number.isFinite(saved.customPaper?.w) && Number.isFinite(saved.customPaper?.h)) s.customPaper = { w: saved.customPaper.w, h: saved.customPaper.h };
  // Every session opens on Two Minis; any custom size/position is kept.
  for (const f of ['two', 'one']) {
    const L = saved.layout?.[f];
    if (!L) continue;
    if (L.aspect === 'custom' || aspectOf(L.aspect)) s.layout[f].aspect = L.aspect;
    if (f === 'one' && typeof L.flip === 'boolean') s.layout.one.flip = L.flip;
    for (const k of ['w', 'h', 'top']) if (Number.isFinite(L[k])) s.layout[f][k] = clamp(L[k], 0, 1);
    if (s.layout[f].aspect === 'custom' && (s.layout[f].w == null || s.layout[f].h == null)) s.layout[f].aspect = FORMATS[f].aspect;
    if (f === 'one' && (L.orientation === 'portrait' || L.orientation === 'landscape')) s.layout.one.orientation = L.orientation;
  }
  const layers = sanitizeLayers(saved.layers);
  if (layers) { s.layers = layers; s.templateId = saved.templateId ?? null; }
  s.date = migrateDate(saved.date, saved.layers) || s.date;
  return s;
}
const saveState = () => writeJson(STATE_KEY, state);
function loadTemplates() {
  const t = readJson(TEMPLATES_KEY);
  return Array.isArray(t) ? t.filter((x) => x?.name).map((x) => ({
    ...x, layers: sanitizeLayers(x.layers) || [], date: migrateDate(x.date, x.layers) || dateSettings({ on: false }),
  })) : [];
}
const saveTemplates = () => writeJson(TEMPLATES_KEY, templates);

/* ---------------- derived ---------------- */
const frameColor = () => FRAME_COLORS.find((c) => c.id === state.color) || FRAME_COLORS[0];
const lay = () => state.layout[state.format];
const currentLayout = () => computeLayout({ paperId: state.paperId, customPaper: state.customPaper, format: state.format, ...lay() });
const count = () => (state.format === 'two' ? 2 : 1);
const today = new Date();
function renderSlots({ keepEmpty = false } = {}) {
  return Array.from({ length: count() }, (_, i) => ({
    photo: photos[i],
    captions: resolveCaptions(state.layers, state.date, i, photos[i]?.date || today, new Date(), { keepEmpty }),
  }));
}
function photoDpi(photo, win) {
  const c = cropRect(photo.width, photo.height, photo.rot, win.w / win.h, photo.zoom, photo.cx, photo.cy);
  return { dpi: effectiveDpi(c.w, win.w), crop: c };
}
function quality(dpi) {
  if (dpi >= 290) return { cls: 'good', label: 'Excellent' };
  if (dpi >= 200) return { cls: 'ok', label: 'Good' };
  return { cls: 'low', label: 'Low' };
}
const slotName = (i) => (count() === 1 ? 'Photo' : `Photo ${i + 1}`);
const slotSide = (i) => (count() === 1 ? 'Whole sheet' : i === 0 ? 'Left half' : 'Right half');
const layerById = (id) => (id === 'date' ? state.date : state.layers.find((l) => l.id === id));
const fontsInUse = () => [...new Set([...state.layers.map((l) => l.font), ...(state.date.on ? [state.date.font] : [])])];

/** Any caption edit means the sheet no longer matches a template exactly. */
function captionsChanged({ rebuildList = false } = {}) {
  state.templateId = null;
  saveState();
  buildTemplateChips();
  if (rebuildList) buildLayerList();
  buildDateRow();
  loadFonts(fontsInUse()).then(drawPreview);
  drawPreview();
}

/* ---------------- photo loading ---------------- */
async function loadPhoto(file) {
  // An <img> applies the EXIF orientation (CSS image-orientation: from-image is the default
  // in every current browser), and drawImage() of it keeps that orientation, so phone
  // photos come in upright with naturalWidth/Height already swapped when needed.
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
  return {
    bitmap: img, preview: pv, url, width, height, rot: 0, zoom: 1, cx: 0.5, cy: 0.5,
    name: file.name, date: date || new Date(file.lastModified || Date.now()),
  };
}

async function placeFiles(files, target) {
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
  await Promise.all(images.slice(0, order.length).map(async (file, k) => {
    try {
      const p = await loadPhoto(file);
      releasePhoto(photos[order[k]]);
      photos[order[k]] = p;
    } catch (e) { toast(e.message); }
  }));
  update();
}
function releasePhoto(p) { if (p) URL.revokeObjectURL(p.url); }

/* ---------------- preview ---------------- */
const sheetEl = $('#sheet');
const canvas = $('#preview');
const slotsEl = $('#slots');

function drawPreview() {
  const layout = currentLayout();
  const rect = sheetEl.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const hits = [];
  renderSheet(canvas.getContext('2d'), layout, renderSlots({ keepEmpty: true }), {
    scale: canvas.width / layout.paper.w, color: frameColor(), marks: state.marks, sourceFor: previewSource,
    hits, skip: editingCaption,
  });
  syncCaptionEditors(hits, layout, rect.width / layout.paper.w);
  drawThumbs();
}

/* ---------------- text captions: edit in place on the preview ---------------- */
// Each text caption on the sheet gets a transparent input laid exactly over it: tap it and
// type. While one is focused the canvas leaves that line out and the input shows the text.
let editingCaption = null;
const capLayer = $('#capLayer');
function syncCaptionEditors(hits, layout, pxPerMm) {
  const live = new Set();
  for (const h of hits) {
    if (h.kind !== 'text') continue;
    const key = `${h.card}:${h.id}`;
    live.add(key);
    let inp = capLayer.querySelector(`[data-key="${key}"]`);
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'cap-edit';
      inp.maxLength = 60;
      inp.enterKeyHint = 'done';
      inp.placeholder = 'Write a caption…';
      inp.dataset.key = key;
      inp.setAttribute('aria-label', count() === 2 ? `Caption on photo ${h.card + 1}` : 'Caption');
      inp.addEventListener('focus', () => { editingCaption = { id: inp.dataset.id, card: Number(inp.dataset.card) }; drawPreview(); });
      inp.addEventListener('blur', () => { editingCaption = null; drawPreview(); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('input', () => {
        const l = layerById(inp.dataset.id);
        if (!l) return;
        if (l.same) l.text = inp.value; else l.texts[Number(inp.dataset.card)] = inp.value;
        captionsChanged({ rebuildList: true });
      });
      capLayer.append(inp);
    }
    inp.dataset.id = h.id;
    inp.dataset.card = h.card;
    const l = layerById(h.id);
    const value = l ? (l.same ? l.text : l.texts[h.card]) || '' : '';
    if (document.activeElement !== inp) inp.value = value;
    // 16 px text (so iOS doesn't zoom on focus), scaled down to the caption's real size.
    const k = (h.size * pxPerMm) / 16;
    Object.assign(inp.style, {
      left: `${(h.cx / layout.paper.w) * 100}%`, top: `${(h.cy / layout.paper.h) * 100}%`,
      width: `${(h.len * pxPerMm) / k}px`, height: `${(h.lh * pxPerMm) / k}px`,
      transform: `translate(-50%, -50%) rotate(${h.rot}deg) scale(${k})`,
      fontFamily: h.font, textAlign: h.align === 'start' ? 'left' : h.align === 'end' ? 'right' : 'center',
    });
    inp.style.setProperty('--cap-ink', h.color);
  }
  for (const inp of [...capLayer.children]) if (!live.has(inp.dataset.key) && document.activeElement !== inp) inp.remove();
}

const ICONS = {
  rotl: '<path d="M4 8a6.5 6.5 0 1 1 1.6 6.4"/><path d="M4 3.5V8h4.5"/>',
  rotr: '<path d="M16 8a6.5 6.5 0 1 0-1.6 6.4"/><path d="M16 3.5V8h-4.5"/>',
  flip: '<path d="M10 3v14M6 13l4 4 4-4M6 7l4-4 4 4"/>',
  adjust: '<path d="M5 2.5v12.5h12.5"/><path d="M2.5 5H15v12.5"/>',
  replace: '<path d="M3 13.5 7 9.5l3 3 3.5-4 3.5 4"/><rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/>',
  remove: '<path d="M5 6h10M8 6V4.5h4V6M6.5 6l.7 9.5h5.6l.7-9.5"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  date: '<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/>',
  text: '<path d="M4 5h12M10 5v11"/>',
  more: '<circle cx="5" cy="10" r=".9"/><circle cx="10" cy="10" r=".9"/><circle cx="15" cy="10" r=".9"/>',
  check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
};
const icon = (k) => `<svg viewBox="0 0 20 20" aria-hidden="true">${ICONS[k]}</svg>`;

function buildSlots() {
  const layout = currentLayout();
  const { paper } = layout;
  slotsEl.replaceChildren(...layout.cards.map((card, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    Object.assign(el.style, pct(card.win, paper));
    const p = photos[i];
    if (!p) {
      el.classList.add('empty');
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Add ${slotName(i).toLowerCase()}`);
      el.innerHTML = `<span class="slot-plus">${icon('plus')}</span>`;
      el.addEventListener('click', () => pickFiles(i));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFiles(i); } });
    } else {
      el.classList.add('filled');
      el.classList.toggle('selected', selected === i);
      el.innerHTML = `<div class="slot-tools" role="toolbar" aria-label="${slotName(i)}">
          ${toolBtn('rotl', 'Turn left')}${toolBtn('rotr', 'Turn right')}${toolBtn('flip', 'Flip 180°')}${toolBtn('adjust', 'Crop & zoom')}
        </div>`;
      el.querySelector('.slot-tools').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        e.stopPropagation();
        onTool(b.dataset.act, i);
      });
      // Mouse/pen: drag to pan right in the preview. Touch: the preview stays scrollable;
      // tap selects, tapping the selected photo opens the full-screen crop editor.
      attachPan(el, () => p, () => el.clientWidth, () => currentLayout().cards[i].win, drawPreview, buildPhotoList,
        () => (selected === i ? openAdjust(i) : select(i)), { touch: false });
      el.addEventListener('dblclick', () => openAdjust(i));
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
const toolBtn = (act, label) => `<button type="button" data-act="${act}" title="${label}" aria-label="${label}">${icon(act)}</button>`;
const pct = (r, paper) => ({
  left: `${(r.x / paper.w) * 100}%`, top: `${(r.y / paper.h) * 100}%`,
  width: `${(r.w / paper.w) * 100}%`, height: `${(r.h / paper.h) * 100}%`,
});

/** Tap on a photo in the preview: select it and bring its controls into view. */
function select(i) {
  selected = i;
  $$('.slot.filled').forEach((s) => s.classList.remove('selected'));
  slotsEl.children[i]?.classList.add('selected');
  $$('.photo-row').forEach((r) => r.classList.toggle('selected', Number(r.dataset.i) === i));
  if (touchFirst) $(`.photo-row[data-i="${i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------------- photos ---------------- */
const listEl = $('#photoList');

function buildPhotoList() {
  const layout = currentLayout();
  const rows = [];
  const n = count();
  if (!photos.slice(0, n).some(Boolean)) {
    rows.push(addRow(n === 2 ? 'Add photos' : 'Add photo', n === 2 ? 'Choose one or two' : 'Fills the whole sheet', null));
  } else {
    for (let i = 0; i < n; i++) {
      const p = photos[i];
      if (!p) { rows.push(addRow(`Add ${slotName(i).toLowerCase()}`, `${slotSide(i)} · or leave it blank`, i)); continue; }
      const { dpi } = photoDpi(p, layout.cards[i].win);
      const q = quality(dpi);
      const row = document.createElement('div');
      row.className = 'photo-row';
      row.dataset.i = i;
      row.classList.toggle('selected', selected === i);
      row.innerHTML = `
        <div class="photo-main">
          <button class="photo-thumb" data-act="replace" aria-label="Replace ${slotName(i).toLowerCase()}"><canvas width="88" height="112"></canvas></button>
          <div class="photo-text">
            <b>${slotName(i)}</b>
            <small>${slotSide(i)} · <span class="q ${q.cls}">${q.label}</span> · ${Math.round(dpi)} dpi</small>
          </div>
        </div>
        <div class="photo-actions">
          ${pa('rotl', 'Turn left')}${pa('rotr', 'Turn right')}${pa('flip', 'Flip')}${pa('adjust', 'Crop')}${pa('remove', 'Remove', 'danger')}
        </div>`;
      row.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (b) onTool(b.dataset.act, i);
      });
      rows.push(row);
    }
  }
  listEl.replaceChildren(...rows);
  $('#swapBtn').hidden = !(n === 2 && (photos[0] || photos[1]));
  drawThumbs();
}
const pa = (act, label, cls = '') => `<button class="pa ${cls}" data-act="${act}" aria-label="${label}">${icon(act)}<span>${label}</span></button>`;
function addRow(title, sub, i) {
  const b = document.createElement('button');
  b.className = 'add-row';
  b.innerHTML = `<span class="plus">${icon('plus')}</span><span>${title}${sub ? `<small>${sub}</small>` : ''}</span>`;
  b.addEventListener('click', () => pickFiles(i));
  return b;
}

function drawThumbs() {
  const layout = currentLayout();
  const slots = renderSlots();
  $$('.photo-row').forEach((row) => {
    const i = Number(row.dataset.i);
    const cv = row.querySelector('canvas');
    const card = layout.cards[i];
    if (!cv || !card) return;
    const ctx = cv.getContext('2d');
    const k = Math.min(cv.width / card.w, cv.height / card.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#F1F0EE';
    ctx.fillRect(0, 0, cv.width, cv.height);
    renderSheet(ctx, { ...layout, cards: [card] }, [slots[i]], {
      scale: k, origin: { x: card.x - (cv.width / k - card.w) / 2, y: card.y - (cv.height / k - card.h) / 2 },
      color: frameColor(), marks: false, sourceFor: previewSource, keepBackground: true,
    });
  });
}

function rotate(p, deg) {
  p.rot = (p.rot + deg + 360) % 360;
  p.cx = 0.5; p.cy = 0.5;
}
function onTool(act, i) {
  if (act === 'replace') return pickFiles(i);
  const p = photos[i];
  if (!p) return;
  if (act === 'rotl') rotate(p, -90);
  else if (act === 'rotr') rotate(p, 90);
  else if (act === 'flip') rotate(p, 180);
  else if (act === 'adjust') return openAdjust(i);
  else if (act === 'remove') { releasePhoto(p); photos[i] = null; if (selected === i) selected = null; }
  update();
}
$('#swapBtn').addEventListener('click', () => { [photos[0], photos[1]] = [photos[1], photos[0]]; update(); });

/**
 * Drag to pan, wheel / pinch to zoom, in any element showing a photo window.
 * A press that barely moves counts as a tap.
 */
function attachPan(el, getPhoto, winCssW, getWin, onMove, onEnd, onTap, { touch = true } = {}) {
  const pts = new Map();
  let start = null, moved = false;
  const snapshot = () => {
    const p = getPhoto(), win = getWin();
    return { p, crop: cropRect(p.width, p.height, p.rot, win.w / win.h, p.zoom, p.cx, p.cy), zoom: p.zoom };
  };
  const setCenter = (p, crop, x, y) => {
    p.cx = clamp(x / crop.W, crop.w / 2 / crop.W, 1 - crop.w / 2 / crop.W);
    p.cy = clamp(y / crop.H, crop.h / 2 / crop.H, 1 - crop.h / 2 / crop.H);
  };
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const begin = () => ({ ...snapshot(), pts: new Map([...pts].map(([k, v]) => [k, { ...v }])), d: pts.size === 2 ? dist() : 0 });
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    if (e.pointerType === 'touch' && !touch) {
      // Let the page scroll; treat a short, still touch as a tap.
      const x0 = e.clientX, y0 = e.clientY;
      el.addEventListener('pointerup', (u) => { if (Math.hypot(u.clientX - x0, u.clientY - y0) < 8) onTap?.(); }, { once: true });
      return;
    }
    el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) moved = false;
    start = begin();
  });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { p, crop } = start;
    if (pts.size === 2 && start.d) {
      moved = true;
      p.zoom = clamp(start.zoom * (dist() / start.d), 1, 5);
    } else {
      const s0 = start.pts.get(e.pointerId);
      if (!s0) return;
      const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      const k = crop.w / winCssW();
      setCenter(p, crop, crop.x + crop.w / 2 - dx * k, crop.y + crop.h / 2 - dy * k);
    }
    onMove();
  });
  const end = (e) => {
    if (!pts.delete(e.pointerId)) return;
    start = pts.size ? begin() : null;
    if (!pts.size) { if (moved) onEnd(); else if (e.type === 'pointerup') onTap?.(); }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = getPhoto();
    p.zoom = clamp(p.zoom * Math.exp(-e.deltaY * 0.0015), 1, 5);
    onMove();
    clearTimeout(el._wheelT);
    el._wheelT = setTimeout(onEnd, 250);
  }, { passive: false });
}

/* ---------------- adjust dialog ---------------- */
const adjustDlg = $('#adjust');
const adjCanvas = $('#adjustCanvas');
let adjIndex = 0;
let adjBackup = null;

const adjPhoto = () => photos[adjIndex];
function openAdjust(i) {
  adjIndex = i;
  const p = adjPhoto();
  if (!p) return;
  adjBackup = { rot: p.rot, zoom: p.zoom, cx: p.cx, cy: p.cy };
  $('#adjustTitle').textContent = slotName(i);
  adjustDlg.returnValue = '';
  adjustDlg.showModal();
  requestAnimationFrame(drawAdjust);
}
function drawAdjust() {
  const p = adjPhoto();
  if (!p) return;
  const layout = currentLayout();
  const card = layout.cards[adjIndex];
  const box = $('#adjustStage').getBoundingClientRect();
  const maxW = Math.max(160, box.width - 32);
  const maxH = Math.max(200, (box.height || window.innerHeight * 0.6) - 32);
  const cssScale = Math.min(maxW / card.w, Math.min(maxH, 640) / card.h);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  adjCanvas.style.width = `${card.w * cssScale}px`;
  adjCanvas.style.height = `${card.h * cssScale}px`;
  adjCanvas.width = Math.round(card.w * cssScale * dpr);
  adjCanvas.height = Math.round(card.h * cssScale * dpr);
  renderSheet(adjCanvas.getContext('2d'), { ...layout, cards: [card] }, [renderSlots()[adjIndex]], {
    scale: cssScale * dpr, origin: { x: card.x, y: card.y }, color: frameColor(), marks: false, sourceFor: previewSource,
  });
  $('#zoomRange').value = p.zoom;
  const { dpi, crop } = photoDpi(p, card.win);
  const q = quality(dpi);
  $('#adjustStats').innerHTML = `<span class="q ${q.cls}">${q.label}</span> · ${Math.round(dpi)} dpi · using ${Math.round(crop.w)} × ${Math.round(crop.h)} of ${p.width} × ${p.height} px`;
}
attachPan(adjCanvas, adjPhoto, () => {
  const card = currentLayout().cards[adjIndex];
  return adjCanvas.clientWidth * (card.win.w / card.w);
}, () => currentLayout().cards[adjIndex].win, drawAdjust, () => {});
$('#zoomRange').addEventListener('input', (e) => { adjPhoto().zoom = Number(e.target.value); drawAdjust(); });
$$('[data-rot]', adjustDlg).forEach((b) => b.addEventListener('click', () => { rotate(adjPhoto(), Number(b.dataset.rot)); drawAdjust(); }));
$('#adjustReset').addEventListener('click', () => { Object.assign(adjPhoto(), { rot: 0, zoom: 1, cx: 0.5, cy: 0.5 }); drawAdjust(); });
adjustDlg.addEventListener('close', () => {
  if (adjustDlg.returnValue !== 'done' && adjBackup && adjPhoto()) Object.assign(adjPhoto(), adjBackup);
  adjBackup = null;
  update();
});

/* ---------------- frame ---------------- */
function buildSwatches() {
  $('#swatches').replaceChildren(...FRAME_COLORS.map((c) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c.fill;
    b.title = c.label;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c.label);
    b.setAttribute('aria-checked', String(state.color === c.id));
    b.addEventListener('click', () => { state.color = c.id; update(); });
    return b;
  }));
}
$('#marksToggle').addEventListener('change', (e) => { state.marks = e.target.checked; saveState(); drawPreview(); });

/* ---------------- captions: templates ---------------- */
function allTemplates() {
  return [
    ...siteTemplates.map((t, k) => ({ id: `s${k}`, name: t.name, layers: () => t.layers, date: () => t.date })),
    ...templates.map((t) => ({ ...t, layers: () => t.layers, date: () => t.date })),
  ];
}
/** Templates shipped with the site: app/templates.json, in the same text format as Export. */
fetch('templates.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.text() : null))
  .then((text) => {
    if (!text) return;
    try { siteTemplates = parseTemplatesText(text); } catch { siteTemplates = []; }
    buildTemplateChips();
  })
  .catch(() => {});

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied as text`);
  } catch {
    const box = $('#importText');
    box.value = text;
    box.focus();
    box.select();
    toast('Select-all and copy the text below');
  }
}
function applyTemplate(t) {
  state.layers = cloneLayers(t.layers());
  state.date = cloneDate(t.date());
  state.templateId = t.id;
  saveState();
  buildTemplateChips();
  buildLayerList();
  buildDateRow();
  loadFonts(fontsInUse()).then(drawPreview);
  drawPreview();
}
function buildTemplateChips() {
  $('#templateChips').replaceChildren(...allTemplates().map((t) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.setAttribute('role', 'listitem');
    b.setAttribute('aria-pressed', String(state.templateId === t.id));
    b.textContent = t.name;
    b.addEventListener('click', () => applyTemplate(t));
    return b;
  }));
}
function buildTemplateManager() {
  const list = $('#tplList');
  if (!templates.length) { list.innerHTML = '<p class="empty-note">No saved templates yet.</p>'; return; }
  list.replaceChildren(...templates.map((t) => {
    const row = document.createElement('div');
    row.className = 'tpl-row';
    row.innerHTML = `<span>${escapeHtml(t.name)}<small>${t.layers.length} caption${t.layers.length === 1 ? '' : 's'} · date ${t.date?.on ? 'on' : 'off'}</small></span>
      <button class="apply">Use</button><button class="exp" aria-label="Copy ${escapeHtml(t.name)} as text">Copy</button><button class="del" aria-label="Delete ${escapeHtml(t.name)}">Delete</button>`;
    row.querySelector('.exp').addEventListener('click', () => copyText(exportTemplatesText([t]), `“${t.name}”`));
    row.querySelector('.apply').addEventListener('click', () => { applyTemplate({ ...t, layers: () => t.layers, date: () => t.date }); $('#templatesDlg').close(); });
    row.querySelector('.del').addEventListener('click', () => {
      templates = templates.filter((x) => x.id !== t.id);
      if (state.templateId === t.id) state.templateId = null;
      saveTemplates(); saveState();
      buildTemplateManager(); buildTemplateChips();
    });
    return row;
  }));
}
$('[data-open="templatesDlg"]').addEventListener('click', buildTemplateManager);
$('#copyCurrent').addEventListener('click', () => copyText(exportTemplatesText([{ name: 'My captions', layers: state.layers, date: state.date }]), 'Current captions'));
$('#copyAll').addEventListener('click', () => {
  if (!templates.length) return toast('No saved templates yet');
  copyText(exportTemplatesText(templates), 'Templates');
});
$('#importForm').addEventListener('submit', (e) => {
  e.preventDefault();
  let parsed;
  try { parsed = parseTemplatesText($('#importText').value); } catch (err) { return toast(err.message); }
  for (const t of parsed) {
    const existing = templates.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    const tpl = { id: existing?.id || `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: t.name, layers: t.layers, date: t.date };
    templates = existing ? templates.map((x) => (x.id === tpl.id ? tpl : x)) : [...templates, tpl];
  }
  saveTemplates();
  $('#importText').value = '';
  buildTemplateManager(); buildTemplateChips();
  toast(`Imported ${parsed.length} template${parsed.length === 1 ? '' : 's'}`);
});
$('#tplForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#tplName').value.trim();
  if (!name) return;
  const existing = templates.find((t) => t.name.toLowerCase() === name.toLowerCase());
  const tpl = { id: existing?.id || `u${Date.now().toString(36)}`, name, layers: cloneLayers(state.layers), date: cloneDate(state.date) };
  templates = existing ? templates.map((t) => (t.id === tpl.id ? tpl : t)) : [...templates, tpl];
  state.templateId = tpl.id;
  saveTemplates(); saveState();
  $('#tplName').value = '';
  buildTemplateManager(); buildTemplateChips();
  toast(existing ? `Updated “${name}”` : `Saved “${name}”`);
});

/* ---------------- captions: the date and text captions on the main screen ---------------- */
const firstPhotoDate = () => photos.find(Boolean)?.date || today;
const stampFor = (l) => (l.source === 'now' ? new Date() : firstPhotoDate());
function describe(l) {
  const where = { bottom: 'Bottom', top: 'Top', left: 'Left side', right: 'Right side' }[l.edge];
  const align = { start: 'start', center: 'centre', end: 'end' }[l.align];
  return `${where} · ${align}`;
}
function buildDateRow() {
  const d = state.date;
  $('#dateToggle').checked = d.on;
  $('#dateSummary').textContent = d.on
    ? `${formatDate(stampFor(d), d.fmt)}${d.source === 'now' ? ' · now' : ''} · ${describe(d)}`
    : 'Off';
}
$('#dateToggle').addEventListener('change', (e) => { state.date.on = e.target.checked; captionsChanged(); });
$('#dateEdit').addEventListener('click', () => openLayer('date'));

function buildLayerList() {
  const list = $('#layerList');
  if (!state.layers.length) { list.replaceChildren(); return; }
  list.replaceChildren(...state.layers.map((l) => {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.innerHTML = `
      <span class="layer-icon">${icon('text')}</span>
      <div class="layer-main">${textProxies(l)}</div>
      <button class="font-chip" style="font-family:${escapeHtml(fontCss(l.font))}" aria-label="Font: ${escapeHtml(l.font)}">${escapeHtml(l.font)}</button>
      <button class="edit-btn" aria-label="Caption options">${icon('more')}</button>`;
    bindProxies(row, l);
    row.querySelector('.font-chip').addEventListener('click', () => openFontPicker(l.id));
    row.querySelector('.edit-btn').addEventListener('click', () => openLayer(l.id));
    return row;
  }));
}
$('#addText').addEventListener('click', () => {
  const l = textLayer();
  state.layers.push(l);
  captionsChanged({ rebuildList: true });
  editInPlace(l.id, 0);
});

/**
 * Caption text is typed on the print itself. Elsewhere (the list, the caption sheet) the text is
 * shown read-only; tapping it jumps to the matching in-place editor on the preview.
 */
function textProxies(l) {
  const fields = l.same || count() === 1
    ? [[0, count() === 1 || l.same ? 'Caption' : 'Photo 1 caption', l.same ? l.text : l.texts[0]]]
    : [[0, 'Photo 1 caption', l.texts[0]], [1, 'Photo 2 caption', l.texts[1]]];
  return fields.map(([card, label, v]) =>
    `<button type="button" class="text-proxy${v ? '' : ' empty'}" data-card="${card}" aria-label="Edit ${label} on the print">${escapeHtml(v || label)}</button>`).join('');
}
function bindProxies(root, l) {
  $$('.text-proxy', root).forEach((b) => b.addEventListener('click', () => editInPlace(l.id, Number(b.dataset.card))));
}
function editInPlace(id, card) {
  for (const d of $$('dialog[open]')) d.close();
  requestAnimationFrame(() => {
    drawPreview();
    const inp = capLayer.querySelector(`[data-key="${card}:${id}"]`);
    if (!inp) return;
    $('.stage').scrollIntoView?.({ block: 'nearest' });
    inp.focus({ preventScroll: true });
    inp.setSelectionRange(inp.value.length, inp.value.length);
  });
}

/* ---------------- captions: style sheet ---------------- */
const layerDlg = $('#layerDlg');
let editId = null;

function openLayer(id) {
  editId = id;
  fillLayerDialog();
  layerDlg.showModal();
}
function fillLayerDialog() {
  const l = layerById(editId);
  if (!l) return;
  $('#layerTitle').textContent = l.kind === 'date' ? 'Date' : 'Caption';
  $('#layerDelete').style.visibility = l.kind === 'date' ? 'hidden' : ''; // the date is switched off, not deleted
  $('#layerTextBlock').hidden = l.kind !== 'text';
  $('#layerDateBlock').hidden = l.kind !== 'date';
  if (l.kind === 'text') {
    $('#layerSame').checked = !!l.same;
    $('#layerSame').closest('.list-row').hidden = count() === 1;
    $('#layerTexts').innerHTML = `${textProxies(l)}<p class="list-foot">Tap the text to edit it on the print.</p>`;
    bindProxies($('#layerTexts'), l);
  } else {
    const f = l.fmt;
    $('#datePreview').textContent = formatDate(stampFor(l), f);
    $('#datePreview').style.fontFamily = fontCss(l.font);
    $$('#layerDateBlock [data-opt]').forEach((seg) => {
      $$('button', seg).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === String(f[seg.dataset.opt]))));
    });
    $('#sepRow').hidden = f.month !== 'num';
    $('#clockRow').hidden = f.show !== 'datetime';
    $('#secondsRow').hidden = f.show !== 'datetime';
    $('#fSeconds').checked = !!f.seconds;
    $('#dtSource').replaceChildren(...TIME_SOURCES.map((src) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(l.source === src.id));
      b.textContent = src.label;
      b.addEventListener('click', () => { l.source = src.id; captionsChanged(); fillLayerDialog(); });
      return b;
    }));
    $('#dtSourceNote').textContent = TIME_SOURCES.find((x) => x.id === l.source).detail;
  }
  $('#layerFontName').textContent = l.font;
  $('#layerFontName').style.fontFamily = fontCss(l.font);
  $('#layerSize').value = l.size;
  $('#layerSizeVal').textContent = `${l.size.toFixed(1)} mm`;
  const shown = effectiveShift(l, bandThickness(l.edge));
  $('#layerShift').value = shown;
  $('#layerShiftVal').textContent = shiftLabel(shown);
  $('#layerColors').replaceChildren(...CAPTION_COLORS.map((c) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', c.label);
    b.title = c.label;
    b.setAttribute('aria-checked', String(l.color === c.id));
    if (c.value) b.style.background = c.value; else { b.textContent = 'A'; b.style.background = frameColor().fill; b.style.color = frameColor().ink; }
    b.addEventListener('click', () => { l.color = c.id; captionsChanged(); fillLayerDialog(); });
    return b;
  }));
  $$('#layerEdge button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === l.edge)));
  $$('#layerAlign button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === l.align)));
}
// Composable date format: each segmented control sets one option.
$$('#layerDateBlock [data-opt]').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const opt = seg.dataset.opt;
  state.date.fmt[opt] = DATE_OPTIONS[opt].find((v) => String(v) === b.dataset.value);
  captionsChanged();
  fillLayerDialog();
}));
$('#fSeconds').addEventListener('change', (e) => { state.date.fmt.seconds = e.target.checked; captionsChanged(); fillLayerDialog(); });
$('#layerSame').addEventListener('change', (e) => {
  const l = layerById(editId);
  if (e.target.checked) l.text = l.text || l.texts.find(Boolean) || '';
  else l.texts = [l.texts[0] || l.text || '', l.texts[1] || l.text || ''];
  l.same = e.target.checked;
  captionsChanged({ rebuildList: true });
  fillLayerDialog();
});
/** Thickness (mm) of the border band a caption on `edge` sits in, for the current layout. */
function bandThickness(edge) {
  const c = currentLayout().cards[0];
  return edge === 'bottom' ? c.chin.h : edge === 'top' ? c.top.h : c.left.w;
}
function shiftLabel(v) {
  if (Math.abs(v) < 0.25) return 'Centred';
  return `${Math.abs(v).toFixed(1)} mm ${v < 0 ? 'closer' : 'further'}`;
}
$('#layerShift').addEventListener('input', (e) => {
  const l = layerById(editId);
  let v = Number(e.target.value);
  if (Math.abs(v) < 0.4) v = 0; // snap to centred
  l.shift = v;
  l.ref = bandThickness(l.edge); // remember the border it was placed in, to anchor it later
  $('#layerShiftVal').textContent = shiftLabel(v);
  captionsChanged();
});
$('#layerSize').addEventListener('input', (e) => {
  const l = layerById(editId);
  l.size = Number(e.target.value);
  $('#layerSizeVal').textContent = `${l.size.toFixed(1)} mm`;
  captionsChanged();
});
for (const [id, key] of [['#layerEdge', 'edge'], ['#layerAlign', 'align']]) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const l = layerById(editId);
    if (key === 'edge' && l.edge !== b.dataset.value) {
      // Moving to another edge keeps the visible offset, measured in the new border.
      l.shift = effectiveShift(l, bandThickness(l.edge));
      l.ref = bandThickness(b.dataset.value);
    }
    l[key] = b.dataset.value;
    captionsChanged({ rebuildList: true });
    fillLayerDialog();
  });
}
$('#layerFontBtn').addEventListener('click', () => openFontPicker(editId));
$('#layerDelete').addEventListener('click', () => {
  state.layers = state.layers.filter((l) => l.id !== editId);
  layerDlg.close();
  captionsChanged({ rebuildList: true });
});

/* ---------------- captions: font picker ---------------- */
const fontDlg = $('#fontDlg');
let fontTarget = null;
let fontGroup = FONT_GROUPS[0].id;

function openFontPicker(layerId) {
  fontTarget = layerId;
  const current = layerById(layerId)?.font;
  fontGroup = FONT_GROUPS.find((g) => g.fonts.includes(current))?.id || FONT_GROUPS[0].id;
  buildFontPicker();
  fontDlg.showModal();
}
function buildFontPicker() {
  const l = layerById(fontTarget);
  $('#fontGroups').replaceChildren(...FONT_GROUPS.map((g) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(g.id === fontGroup));
    b.setAttribute('aria-pressed', String(g.id === fontGroup));
    b.textContent = g.label;
    b.addEventListener('click', () => { fontGroup = g.id; buildFontPicker(); });
    return b;
  }));
  const group = FONT_GROUPS.find((g) => g.id === fontGroup);
  const sample = l?.kind === 'text'
    ? (l.same ? l.text : l.texts.find(Boolean)) || 'Summer days'
    : formatDate(l ? stampFor(l) : today, l?.fmt);
  $('#fontList').replaceChildren(...group.fonts.map((f) => {
    const b = document.createElement('button');
    b.className = 'font-row';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(l?.font === f));
    b.innerHTML = `<span><span class="sample" style="font-family:${escapeHtml(fontCss(f))}">${escapeHtml(sample)}</span><small>${f}</small></span><span class="check">${icon('check')}</span>`;
    b.addEventListener('click', () => {
      const layer = layerById(fontTarget);
      if (!layer) return;
      layer.font = f;
      captionsChanged({ rebuildList: true });
      buildFontPicker();
      if (layerDlg.open) fillLayerDialog();
    });
    return b;
  }));
  loadFonts(group.fonts);
}

/* ---------------- layout: format, orientation, size & position ---------------- */
$('#formatSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.value === state.format) return;
  state.format = b.dataset.value;
  selected = null;
  update();
});
$('#orientSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.layout.one.orientation = b.dataset.value;
  Object.assign(state.layout.one, { w: null, h: null, top: null }); // sizes differ between orientations; start from the default
  update();
});
const flipActive = () => state.format === 'one' && state.layout.one.orientation === 'landscape' && state.layout.one.flip !== false;
const fmtRatio = (r) => {
  const pick = ASPECTS.flatMap((a) => [[a.w, a.h], [a.h, a.w]]).find(([w, h]) => Math.abs(w / h - r) < 0.01);
  if (pick) return pick[0] > 10 ? `${pick[0]} : ${pick[1]}` : `${+pick[0].toFixed(1)} : ${+pick[1].toFixed(1)}`;
  return r < 1 ? `1 : ${(1 / r).toFixed(2)}` : `${r.toFixed(2)} : 1`;
};
const mm = (v) => `${v.toFixed(1)} mm`;

function layoutSummary() {
  const L = lay();
  const geo = currentLayout();
  const name = L.aspect === 'custom' ? `Custom ${fmtRatio(geo.ratio)}` : aspectOf(L.aspect)?.label;
  return `${name}${flipActive() && L.aspect !== 'custom' ? ' · rotated' : ''}${L.w != null || L.top != null ? ' · custom fit' : ''}`;
}
function buildLayoutSheet() {
  const L = lay();
  const flipped = flipActive();
  $('#aspectList').replaceChildren(...ASPECTS.map((a) => {
    const b = document.createElement('button');
    b.className = 'aspect-tile';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(L.aspect === a.id));
    const [w, h] = flipped ? [a.h, a.w] : [a.w, a.h];
    const k = 30 / Math.max(w, h);
    const label = flipped && a.label.includes(':') ? a.label.split(' : ').reverse().join(' : ') : a.label;
    b.innerHTML = `<span class="shape"><i style="width:${w * k}px;height:${h * k}px"></i></span><b>${label}</b><small>${a.cameras}</small>`;
    // A preset keeps the current width and top border; its shape sets the height.
    b.addEventListener('click', () => { L.aspect = a.id; L.h = null; update(); });
    return b;
  }));
  $('#flipRow').hidden = !(state.format === 'one' && L.orientation === 'landscape');
  $('#flipToggle').checked = L.flip !== false;
  $('#layoutFoot').textContent = state.format === 'two'
    ? 'Always centred left to right, so the sheet is still cut straight down the middle.'
    : 'Always centred left to right on the sheet.';
  fitLabels();
  drawLayoutPreview();
}
function fitLabels() {
  const geo = currentLayout();
  const { win } = geo.cards[0];
  $('#widthRange').value = geo.w;
  $('#widthVal').textContent = mm(win.w);
  $('#heightRange').max = String(Math.max(0.08, 1 - geo.top));
  $('#heightRange').value = geo.h;
  $('#heightVal').textContent = mm(win.h);
  $('#topRange').max = String(Math.max(0, 1 - geo.h));
  $('#topRange').value = geo.top;
  $('#topVal').textContent = mm(win.y);
  $('#shapeNote').textContent = lay().aspect === 'custom' ? `· custom ${fmtRatio(geo.ratio)}` : '';
}
/** One frame, large, inside the sheet: the photo being sized (or the first one added). */
function drawLayoutPreview() {
  const cv = $('#layoutCanvas');
  if (!$('#layoutDlg').open) return;
  const layout = currentLayout();
  const slots = renderSlots();
  const i = Math.max(0, slots.findIndex((x) => x.photo));
  const card = layout.cards[i];
  const box = cv.parentElement.getBoundingClientRect();
  const maxH = Math.min(window.innerHeight * (window.innerWidth <= 860 ? 0.3 : 0.38), 320);
  const k = Math.min((box.width - 32) / card.w, maxH / card.h);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.style.width = `${card.w * k}px`;
  cv.style.height = `${card.h * k}px`;
  cv.width = Math.round(card.w * k * dpr);
  cv.height = Math.round(card.h * k * dpr);
  renderSheet(cv.getContext('2d'), { ...layout, cards: [card] }, [slots[i]], {
    scale: k * dpr, origin: { x: card.x, y: card.y }, color: frameColor(), marks: false, sourceFor: previewSource,
  });
}
$('[data-open="layoutDlg"]').addEventListener('click', () => requestAnimationFrame(buildLayoutSheet));
/** Slider drags only redraw; the full rebuild happens when the drag ends. */
function layoutLive() {
  saveState();
  buildSlots();
  drawPreview();
  fitLabels();
  drawLayoutPreview();
  $('#layoutValue').textContent = layoutSummary();
}
/** Pin the current geometry so one slider never moves what the others control. */
function pin(L, geo) {
  if (L.w == null) L.w = geo.w;
  if (L.top == null) L.top = geo.top;
}
$('#widthRange').addEventListener('input', (e) => {
  const L = lay();
  const geo = currentLayout();
  pin(L, geo);
  if (L.aspect === 'custom' && L.h == null) L.h = geo.h;
  L.w = Number(e.target.value);
  layoutLive();
});
$('#heightRange').addEventListener('input', (e) => {
  const L = lay();
  const geo = currentLayout();
  pin(L, geo);
  if (L.aspect !== 'custom') {
    L.aspect = 'custom';
    $$('#aspectList .aspect-tile').forEach((t) => t.setAttribute('aria-checked', 'false'));
  }
  L.h = Number(e.target.value);
  layoutLive();
});
$('#topRange').addEventListener('input', (e) => {
  const L = lay();
  const geo = currentLayout();
  pin(L, geo);
  if (L.aspect === 'custom' && L.h == null) L.h = geo.h;
  L.top = Number(e.target.value);
  layoutLive();
});
for (const id of ['#widthRange', '#heightRange', '#topRange']) $(id).addEventListener('change', update);
$('#flipToggle').addEventListener('change', (e) => { lay().flip = e.target.checked; update(); });
$('#layoutReset').addEventListener('click', () => {
  const keepOrientation = lay().orientation;
  state.layout[state.format] = { ...defaultLayoutFor(state.format), ...(keepOrientation ? { orientation: keepOrientation } : {}) };
  update();
});
window.addEventListener('resize', drawLayoutPreview);

/* ---------------- paper ---------------- */
const fmtMm = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const paperName = (p) => (p.id === 'custom' ? `Custom ${fmtMm(p.w)} × ${fmtMm(p.h)} mm` : PAPERS[p.id] ? p.id : p.kind);
function paperRow(p) {
  const b = document.createElement('button');
  b.className = 'paper-row';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', String(state.paperId === p.id));
  const title = PAPERS[p.id] ? p.id : p.kind;
  const sub = PAPERS[p.id] ? `${p.kind} · ${p.note}` : p.note;
  b.innerHTML = `<span><b>${title}</b><small>${sub}</small></span><span class="dims">${fmtMm(p.w)} × ${fmtMm(p.h)}</span><span class="check">${icon('check')}</span>`;
  // Picking a paper loads its size into the fields, so it can be tweaked into a custom size.
  b.addEventListener('click', () => { state.paperId = p.id; state.customPaper = { w: p.w, h: p.h }; update(); });
  return b;
}
function buildPaperList() {
  const paper = resolvePaper(state.paperId, state.customPaper);
  $('#paperValue').textContent = paperName(paper);
  $('#paperList').replaceChildren(...Object.values(PAPERS).map(paperRow));
  $('#otherPaperList').replaceChildren(...Object.values(OTHER_PAPERS).map(paperRow));
  for (const [id, v] of [['#paperW', paper.w], ['#paperH', paper.h]]) if (document.activeElement !== $(id)) $(id).value = fmtMm(v);
  $('#paperSizeNote').textContent = state.paperId === 'custom'
    ? `Custom size, ${CUSTOM_PAPER.min}–${CUSTOM_PAPER.max} mm per side.`
    : `${paperName(paper)}. Pick another below, or type any size for a custom sheet.`;
}
for (const id of ['#paperW', '#paperH']) {
  $(id).addEventListener('change', () => {
    const w = parseFloat($('#paperW').value), h = parseFloat($('#paperH').value);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    const match = [...Object.values(PAPERS), ...Object.values(OTHER_PAPERS)]
      .find((p) => Math.abs(p.w - Math.max(w, h)) < 0.05 && Math.abs(p.h - Math.min(w, h)) < 0.05);
    state.customPaper = { w, h };
    state.paperId = state.paperId !== 'custom' && match && resolvePaper(state.paperId).w === match.w && resolvePaper(state.paperId).h === match.h
      ? state.paperId : match ? match.id : 'custom';
    update();
  });
}
$('#paperSize').addEventListener('submit', (e) => { e.preventDefault(); document.activeElement?.blur(); });

/* ---------------- master update ---------------- */
function update() {
  saveState();
  const { paper } = currentLayout();
  sheetEl.style.setProperty('--ar', String(paper.w / paper.h));
  $('#marksToggle').checked = state.marks;
  $('#marksRow').hidden = count() !== 2;
  $$('#formatSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === state.format)));
  $('#orientSeg').hidden = state.format !== 'one';
  $$('#orientSeg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === state.layout.one.orientation)));
  $('#layoutValue').textContent = layoutSummary();
  const pname = PAPERS[paper.id] ? `${paper.id} · ${paper.kind}` : paperName(paper);
  $('#sheetMeta').textContent = state.format === 'two'
    ? `${pname} · cut down the middle`
    : `${pname} · one ${paper.portrait ? 'portrait' : 'landscape'} print`;
  buildLayoutSheet();
  buildSwatches();
  buildPaperList();
  buildTemplateChips();
  buildLayerList();
  buildDateRow();
  $('#exportBtn').disabled = !photos.slice(0, count()).some(Boolean);
  buildSlots();
  buildPhotoList();
  drawPreview();
  loadFonts(fontsInUse()).then(drawPreview);
}

/* ---------------- export: highest-resolution PNG (lossless) ---------------- */
const exportDlg = $('#exportDlg');
let exportUrl = null;

async function exportSheet() {
  const layout = currentLayout();
  const slots = renderSlots();
  const preview = $('#exportPreview');
  const dl = $('#downloadLink');
  const share = $('#shareBtn');
  preview.innerHTML = '<div class="spinner" aria-label="Rendering"></div>';
  dl.setAttribute('aria-disabled', 'true');
  share.hidden = true;
  $('#exportStats').textContent = 'Rendering at full resolution…';
  exportDlg.showModal();
  await loadFonts(fontsInUse());
  await new Promise((r) => setTimeout(r, 30));

  // Empty frames are left off the print entirely.
  const keep = slots.map((s) => !!s.photo);
  const sheet = { ...layout, cards: layout.cards.filter((_, i) => keep[i]) };
  const used = slots.filter((_, i) => keep[i]);
  const dpis = used.map((s, k) => photoDpi(s.photo, sheet.cards[k].win).dpi);

  let dpi = chooseDpi(dpis, layout.paper, MAX_PIXELS), blob = null;
  for (let attempt = 0; attempt < 5 && !blob; attempt++) {
    const px = sheetPixels(layout.paper, dpi);
    const cv = document.createElement('canvas');
    cv.width = px.w; cv.height = px.h;
    const ctx = cv.getContext('2d');
    if (ctx) {
      renderSheet(ctx, sheet, used, { scale: dpi / MM_PER_INCH, color: frameColor(), marks: state.marks, sourceFor: fullSource });
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

/* ---------------- dialogs, files, drag & drop ---------------- */
$$('[data-open]').forEach((b) => b.addEventListener('click', () => $(`#${b.dataset.open}`).showModal()));
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

const fileInput = $('#fileInput');
let pickTarget = null;
function pickFiles(i) {
  pickTarget = i;
  fileInput.multiple = count() === 2 && (i == null || (!photos[0] && !photos[1]));
  fileInput.click();
}
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) placeFiles(fileInput.files, pickTarget);
  fileInput.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (e.dataTransfer.files.length) placeFiles(e.dataTransfer.files, null);
});
window.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) placeFiles(files, null);
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

new ResizeObserver(() => drawPreview()).observe(sheetEl);
document.fonts?.ready.then(drawPreview);
update();
