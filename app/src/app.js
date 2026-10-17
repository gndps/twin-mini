import { computeLayout, FRAMES, PAPERS, OVERSCAN_MM, cropRect, effectiveDpi, chooseDpi, sheetPixels, clamp, MM_PER_INCH } from './geometry.js';
import { renderSheet, makeSourceCache, FRAME_COLORS, FONTS } from './render.js';
import { setPngDpi, setJpegDpi } from './dpi.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const PREVIEW_LONG_SIDE = 2400;
const STORE_KEY = 'twinmini:v1';

const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent) || /iP(hone|ad|od)/.test(navigator.userAgent);
const MAX_PIXELS = isSafari ? 16_777_216 : 48_000_000;
const touchFirst = matchMedia('(hover: none)').matches;

const defaults = {
  layout: 'mini',
  frame: { mini: 'half', wide: 'true' },
  custom: { mini: { winW: 46, top: 6, side: 4, chin: 18 }, wide: { winW: 99, top: 6, side: 4.5, chin: 18 } },
  paperId: 'postcard',
  color: 'white',
  font: 'hand',
  marks: true,
  repeat: false,
  dpiMode: 'auto',
  format: 'png',
  captions: ['', ''],
};
const state = loadState();
const photos = [null, null];
let selected = null;

const fullSource = makeSourceCache();
const previewCache = makeSourceCache();
const previewSource = (p, pxPerSrc) => previewCache({ bitmap: p.preview }, pxPerSrc * (p.width / p.preview.width));

/* ---------------- persistence ---------------- */
function loadState() {
  let s = structuredClone(defaults);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) s = { ...s, ...saved, frame: { ...s.frame, ...saved.frame }, custom: { ...s.custom, ...saved.custom } };
  } catch { /* storage unavailable */ }
  // Every session opens on two Minis, Half sheet: print, cut the middle, done.
  s.layout = 'mini';
  s.frame.mini = 'half';
  return s;
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/* ---------------- derived ---------------- */
const slotCount = () => (state.layout === 'wide' ? 1 : 2);
const frameColor = () => FRAME_COLORS.find((c) => c.id === state.color) || FRAME_COLORS[0];
function currentLayout() {
  return computeLayout({
    layout: state.layout,
    frame: state.frame[state.layout],
    paperId: state.paperId,
    custom: state.custom[state.layout],
  });
}
function renderSlots() {
  const n = slotCount();
  const placed = photos.slice(0, n).filter(Boolean);
  return Array.from({ length: n }, (_, i) => ({
    photo: photos[i] || (state.repeat && n === 2 && placed.length === 1 ? placed[0] : null),
    caption: state.captions[i] || '',
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
const slotName = (i) => (slotCount() === 1 ? 'Photo' : `Photo ${i + 1}`);
const slotSide = (i) => (slotCount() === 1 ? '' : i === 0 ? 'Left half' : 'Right half');

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
  return { bitmap: img, preview: pv, url, width, height, rot: 0, zoom: 1, cx: 0.5, cy: 0.5, name: file.name, bytes: file.size };
}

async function placeFiles(files, target) {
  const images = [...files].filter((f) => f.type.startsWith('image/') || /\.(hei[cf]|jpe?g|png|webp|avif)$/i.test(f.name));
  if (!images.length) return toast('Those files aren’t images.');
  const n = slotCount();
  const all = Array.from({ length: n }, (_, i) => i);
  let order;
  if (target != null) order = [target, ...all.filter((i) => i !== target && !photos[i])];
  else {
    order = all.filter((i) => !photos[i]);
    if (!order.length) order = all;
  }
  if (images.length > order.length) toast(`The sheet holds ${n === 2 ? 'two photos' : 'one photo'}.`);
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
  renderSheet(canvas.getContext('2d'), layout, renderSlots(), {
    scale: canvas.width / layout.paper.w,
    color: frameColor(), font: state.font, marks: state.marks, sourceFor: previewSource,
  });
  drawThumbs();
}

const ICONS = {
  rotl: '<path d="M4 8a6.5 6.5 0 1 1 1.6 6.4"/><path d="M4 3.5V8h4.5"/>',
  rotr: '<path d="M16 8a6.5 6.5 0 1 0-1.6 6.4"/><path d="M16 3.5V8h-4.5"/>',
  flip: '<path d="M10 3v14M6 13l4 4 4-4M6 7l4-4 4 4"/>',
  adjust: '<path d="M5 2.5v12.5h12.5"/><path d="M2.5 5H15v12.5"/>',
  replace: '<path d="M3 13.5 7 9.5l3 3 3.5-4 3.5 4"/><rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/>',
  remove: '<path d="M5 6h10M8 6V4.5h4V6M6.5 6l.7 9.5h5.6l.7-9.5"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
};
const icon = (k) => `<svg viewBox="0 0 20 20" aria-hidden="true">${ICONS[k]}</svg>`;

function buildSlots() {
  const layout = currentLayout();
  const { paper } = layout;
  const slots = renderSlots();
  slotsEl.replaceChildren(...layout.cards.map((card, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    Object.assign(el.style, pct(card.win, paper));
    const shown = slots[i].photo;
    if (!shown) {
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
      el.innerHTML = `<div class="slot-tools" role="toolbar" aria-label="${slotName(i)} photo">
          ${toolBtn('rotl', 'Rotate left')}${toolBtn('rotr', 'Rotate right')}${toolBtn('flip', 'Flip 180°')}${toolBtn('adjust', 'Crop & zoom')}
        </div>`;
      el.querySelector('.slot-tools').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        e.stopPropagation();
        onTool(b.dataset.act, i);
      });
      // Mouse/pen: drag to pan right in the preview. Touch: the preview stays scrollable;
      // tap selects, tapping the selected photo opens the full-screen crop editor.
      attachPan(el, () => shown, () => el.clientWidth, () => currentLayout().cards[i].win, drawPreview, buildPhotoList,
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

/* ---------------- photo list (primary controls) ---------------- */
const listEl = $('#photoList');

function buildPhotoList() {
  const layout = currentLayout();
  const slots = renderSlots();
  const n = slotCount();
  const rows = [];
  if (n === 2 && !photos[0] && !photos[1]) {
    rows.push(addRow('Add photos', 'Choose one or two', null));
  } else {
    for (let i = 0; i < n; i++) {
      const p = slots[i].photo;
      if (!p) { rows.push(addRow(n === 2 ? `Add photo ${i + 1}` : 'Add photo', n === 2 ? `${slotSide(i)} · or leave it blank` : '', i)); continue; }
      const repeated = !photos[i];
      const { dpi } = photoDpi(p, layout.cards[i].win);
      const q = quality(dpi);
      const row = document.createElement('div');
      row.className = 'photo-row';
      row.dataset.i = i;
      row.classList.toggle('selected', selected === i);
      row.innerHTML = `
        <div class="photo-main">
          <button class="photo-thumb" data-act="${repeated ? 'own' : 'replace'}" aria-label="Replace ${slotName(i).toLowerCase()} photo"><canvas width="88" height="112"></canvas></button>
          <div class="photo-text">
            <b>${slotName(i)}</b>
            <small>${slotSide(i) ? `${slotSide(i)} · ` : ''}${repeated ? 'repeats photo 1' : `<span class="q ${q.cls}">${q.label}</span> · ${Math.round(dpi)} dpi`}</small>
          </div>
        </div>
        <div class="photo-actions">
          ${pa('rotl', 'Turn left')}${pa('rotr', 'Turn right')}${pa('flip', 'Flip')}${pa('adjust', 'Crop')}
          ${repeated ? pa('own', 'Change', 'replace') : pa('remove', 'Remove', 'remove', 'danger')}
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
const pa = (act, label, ic = act, cls = '') => `<button class="pa ${cls}" data-act="${act}" aria-label="${label}">${icon(ic)}<span>${label}</span></button>`;
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
    const view = card.visible || card;
    const ctx = cv.getContext('2d');
    const k = Math.min(cv.width / view.w, cv.height / view.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ECE8E1';
    ctx.fillRect(0, 0, cv.width, cv.height);
    renderSheet(ctx, { ...layout, cards: [card] }, [slots[i]], {
      scale: k, origin: { x: view.x - (cv.width / k - view.w) / 2, y: view.y - (cv.height / k - view.h) / 2 },
      color: frameColor(), font: state.font, marks: false, sourceFor: previewSource, keepBackground: true,
    });
  });
}

function rotate(p, deg) {
  p.rot = (p.rot + deg + 360) % 360;
  p.cx = 0.5; p.cy = 0.5;
}
function onTool(act, i) {
  const p = renderSlots()[i]?.photo;
  if (act === 'own' || act === 'replace') return pickFiles(i);
  if (!p) return;
  if (act === 'rotl') rotate(p, -90);
  else if (act === 'rotr') rotate(p, 90);
  else if (act === 'flip') rotate(p, 180);
  else if (act === 'adjust') return openAdjust(i);
  else if (act === 'remove') { releasePhoto(photos[i]); photos[i] = null; if (selected === i) selected = null; }
  update();
}

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

const adjPhoto = () => renderSlots()[adjIndex]?.photo;
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
  const view = card.visible || card; // what survives the borderless trim
  const box = $('#adjustStage').getBoundingClientRect();
  const maxW = Math.max(160, box.width - 32);
  const maxH = Math.max(200, (box.height || window.innerHeight * 0.6) - 32);
  const cssScale = Math.min(maxW / view.w, Math.min(maxH, 640) / view.h);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  adjCanvas.style.width = `${view.w * cssScale}px`;
  adjCanvas.style.height = `${view.h * cssScale}px`;
  adjCanvas.width = Math.round(view.w * cssScale * dpr);
  adjCanvas.height = Math.round(view.h * cssScale * dpr);
  renderSheet(adjCanvas.getContext('2d'), { ...layout, cards: [card] }, [{ photo: p, caption: state.captions[adjIndex] }], {
    scale: cssScale * dpr, origin: { x: view.x, y: view.y },
    color: frameColor(), font: state.font, marks: false, sourceFor: previewSource,
  });
  $('#zoomRange').value = p.zoom;
  const { dpi, crop } = photoDpi(p, card.win);
  const q = quality(dpi);
  $('#adjustStats').innerHTML = `<span class="q ${q.cls}">${q.label}</span> · ${Math.round(dpi)} dpi · using ${Math.round(crop.w)} × ${Math.round(crop.h)} of ${p.width} × ${p.height} px`;
}
attachPan(adjCanvas, adjPhoto, () => {
  const card = currentLayout().cards[adjIndex];
  return adjCanvas.clientWidth * (card.win.w / (card.visible || card).w);
}, () => currentLayout().cards[adjIndex].win, drawAdjust, () => {});
$('#zoomRange').addEventListener('input', (e) => { adjPhoto().zoom = Number(e.target.value); drawAdjust(); });
$$('[data-rot]', adjustDlg).forEach((b) => b.addEventListener('click', () => { rotate(adjPhoto(), Number(b.dataset.rot)); drawAdjust(); }));
$('#adjustReset').addEventListener('click', () => { Object.assign(adjPhoto(), { rot: 0, zoom: 1, cx: 0.5, cy: 0.5 }); drawAdjust(); });
adjustDlg.addEventListener('close', () => {
  if (adjustDlg.returnValue !== 'done' && adjBackup && adjPhoto()) Object.assign(adjPhoto(), adjBackup);
  adjBackup = null;
  update();
});

/* ---------------- advanced settings ---------------- */
function bindSeg(id, get, set) {
  const seg = $(id);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    set(b.dataset.value);
    update();
  });
  return () => $$('button', seg).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === get())));
}
const syncers = [
  bindSeg('#layoutSeg', () => state.layout, (v) => { state.layout = v; selected = null; }),
  bindSeg('#fontSeg', () => state.font, (v) => { state.font = v; }),
  bindSeg('#paperSeg', () => state.paperId, (v) => { state.paperId = v; }),
  bindSeg('#dpiSeg', () => state.dpiMode, (v) => { state.dpiMode = v; }),
  bindSeg('#formatSeg', () => state.format, (v) => { state.format = v; }),
];

function buildFrameList() {
  const list = $('#frameList');
  const frames = { ...FRAMES[state.layout], custom: { label: 'Custom', detail: 'Set your own margins' } };
  const paper = PAPERS[state.paperId];
  list.replaceChildren(...Object.entries(frames).map(([id, f]) => {
    const b = document.createElement('button');
    b.className = 'option';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(state.frame[state.layout] === id));
    const c = computeLayout({ layout: state.layout, frame: id, paperId: state.paperId, custom: state.custom[state.layout] }).cards[0];
    const k = 34 / Math.max(paper.h, c.w * 0.9);
    const win = `left:${(c.win.x - c.x) * k - 1}px;top:${(c.win.y - c.y) * k - 1}px;width:${c.win.w * k}px;height:${c.win.h * k}px`;
    b.innerHTML = `<span class="option-glyph"><i style="width:${c.w * k}px;height:${c.h * k}px"><em style="${win}"></em></i></span>
      <span><b>${f.label}</b><small>${f.detail}</small></span>`;
    b.addEventListener('click', () => { state.frame[state.layout] = id; update(); });
    return b;
  }));
  const isCustom = state.frame[state.layout] === 'custom';
  $('#customFields').hidden = !isCustom;
  if (isCustom) $$('[data-custom]').forEach((inp) => { if (document.activeElement !== inp) inp.value = state.custom[state.layout][inp.dataset.custom]; });
}
$$('[data-custom]').forEach((inp) => inp.addEventListener('input', () => {
  const v = parseFloat(inp.value);
  if (!Number.isFinite(v) || v < 0) return;
  state.custom[state.layout][inp.dataset.custom] = v;
  update();
}));

$('#marksToggle').addEventListener('change', (e) => { state.marks = e.target.checked; update(); });
$('#repeatToggle').addEventListener('change', (e) => { state.repeat = e.target.checked; update(); });
$('#safeToggle').addEventListener('change', (e) => { $('#safeArea').hidden = !e.target.checked; });
$('#resetBtn').addEventListener('click', () => {
  Object.assign(state, structuredClone(defaults));
  $('#safeToggle').checked = false;
  $('#safeArea').hidden = true;
  $$('#captions input').forEach((inp) => { inp.value = ''; });
  update();
  toast('Settings reset');
});

/* ---------------- primary controls ---------------- */
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

function buildCaptions() {
  const el = $('#captions');
  const n = slotCount();
  if (el.children.length === n) return;
  el.replaceChildren(...Array.from({ length: n }, (_, i) => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 40;
    inp.enterKeyHint = 'done';
    inp.placeholder = n === 1 ? 'Write on the frame' : `Photo ${i + 1} caption`;
    inp.value = state.captions[i] || '';
    inp.addEventListener('input', () => { state.captions[i] = inp.value; saveState(); loadCaptionFont(); drawPreview(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    return inp;
  }));
}
function loadCaptionFont() {
  const f = FONTS[state.font];
  if (state.captions.some(Boolean)) document.fonts?.load(`${f.weight} 40px ${f.css}`).then(drawPreview, () => {});
}

$('#swapBtn').addEventListener('click', () => { [photos[0], photos[1]] = [photos[1], photos[0]]; update(); });

function outputPlan() {
  const layout = currentLayout();
  const slots = renderSlots();
  const dpis = slots.map((s, i) => (s.photo ? photoDpi(s.photo, layout.cards[i].win).dpi : 0)).filter(Boolean);
  const dpi = chooseDpi(state.dpiMode, dpis, layout.paper, MAX_PIXELS);
  return { layout, slots, dpi, px: sheetPixels(layout.paper, dpi), minPhotoDpi: dpis.length ? Math.min(...dpis) : null };
}

/* ---------------- master update ---------------- */
function update() {
  saveState();
  const layout = currentLayout();
  const { paper } = layout;
  sheetEl.style.setProperty('--ar', String(paper.w / paper.h));
  Object.assign($('#safeArea').style, {
    left: `${(OVERSCAN_MM / paper.w) * 100}%`, right: `${(OVERSCAN_MM / paper.w) * 100}%`,
    top: `${(OVERSCAN_MM / paper.h) * 100}%`, bottom: `${(OVERSCAN_MM / paper.h) * 100}%`,
  });
  syncers.forEach((s) => s());
  $('#marksToggle').checked = state.marks;
  $('#repeatToggle').checked = state.repeat;
  $('#repeatRow').hidden = slotCount() !== 2;
  buildFrameList();
  buildSwatches();
  buildCaptions();

  const fw = $('#fitWarn');
  fw.hidden = layout.fits;
  if (!layout.fits) fw.textContent = `This frame is ${layout.overflow} mm too big for its half of the sheet.`;

  const frameLabel = state.frame[state.layout] === 'custom' ? 'Custom' : FRAMES[state.layout][state.frame[state.layout]].label;
  const sizeTxt = `${fmt(paper.w)} × ${fmt(paper.h)} mm`;
  $('#sheetMeta').textContent = state.layout === 'wide'
    ? `${sizeTxt} · Instax Wide`
    : `${sizeTxt} · ${frameLabel}${state.frame.mini === 'half' ? ' · cut down the middle' : ''}`;
  $('#advSummary').textContent = [
    state.layout === 'wide' ? 'One Wide' : 'Two Minis', frameLabel,
    state.paperId === 'postcard' ? 'Postcard' : '4×6 in',
    state.marks ? 'Cut guides' : 'No guides',
  ].join(' · ');

  const plan = outputPlan();
  const hasPhoto = plan.slots.some((s) => s.photo);
  $('#exportBtn').disabled = !hasPhoto;
  $('#outInfo').textContent = hasPhoto
    ? `${state.dpiMode === 'auto' ? 'Auto: ' : ''}${plan.dpi} dpi · ${plan.px.w} × ${plan.px.h} px. The SELPHY prints at 300 dpi.`
    : 'Auto keeps every pixel of your sharpest photo (300–1200 dpi). The SELPHY prints at 300 dpi.';

  buildSlots();
  buildPhotoList();
  drawPreview();
  loadCaptionFont();
}
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/* ---------------- export ---------------- */
const exportDlg = $('#exportDlg');
let exportUrl = null;

async function exportSheet() {
  const plan = outputPlan();
  const preview = $('#exportPreview');
  const dl = $('#downloadLink');
  const share = $('#shareBtn');
  preview.innerHTML = '<div class="spinner" aria-label="Rendering"></div>';
  dl.setAttribute('aria-disabled', 'true');
  share.hidden = true;
  $('#exportStats').textContent = 'Rendering at full resolution…';
  exportDlg.showModal();
  await document.fonts.load(`${FONTS[state.font].weight} 40px ${FONTS[state.font].css}`).catch(() => {});
  await new Promise((r) => setTimeout(r, 30));

  // Empty frames are left off the print entirely.
  const keep = plan.slots.map((s) => !!s.photo);
  const layout = { ...plan.layout, cards: plan.layout.cards.filter((_, i) => keep[i]) };
  const slots = plan.slots.filter((_, i) => keep[i]);

  let dpi = plan.dpi, blob = null;
  for (let attempt = 0; attempt < 4 && !blob; attempt++) {
    const px = sheetPixels(layout.paper, dpi);
    const cv = document.createElement('canvas');
    cv.width = px.w; cv.height = px.h;
    const ctx = cv.getContext('2d');
    if (ctx) {
      renderSheet(ctx, layout, slots, { scale: dpi / MM_PER_INCH, color: frameColor(), font: state.font, marks: state.marks, sourceFor: fullSource });
      blob = await new Promise((r) => cv.toBlob(r, state.format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.97));
    }
    cv.width = cv.height = 0;
    if (!blob) { dpi = Math.max(300, Math.floor(dpi * 0.75)); toast(`Not enough memory, retrying at ${dpi} dpi`); }
  }
  if (!blob) { exportDlg.close(); return toast('Export failed on this device. Try 300 dpi in Advanced.'); }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const stamped = state.format === 'jpeg' ? setJpegDpi(bytes, dpi) : setPngDpi(bytes, dpi);
  const type = state.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = state.format === 'jpeg' ? 'jpg' : 'png';
  const name = `twinmini-${layout.paper.w}x${layout.paper.h}mm-${dpi}dpi.${ext}`;
  const file = new File([stamped], name, { type });
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = URL.createObjectURL(file);

  const px = sheetPixels(layout.paper, dpi);
  preview.innerHTML = `<img src="${exportUrl}" alt="Print sheet preview">`;
  dl.href = exportUrl;
  dl.download = name;
  dl.removeAttribute('aria-disabled');
  dl.textContent = `Download ${ext.toUpperCase()}`;
  $('#exportStats').textContent = `${px.w} × ${px.h} px · ${dpi} dpi · ${(file.size / 1e6).toFixed(1)} MB`;
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
  fileInput.multiple = i == null || (slotCount() === 2 && !photos[0] && !photos[1]);
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
