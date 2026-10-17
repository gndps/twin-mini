import { computeLayout, FRAMES, PAPERS, cropRect, effectiveDpi, chooseDpi, sheetPixels, clamp, MM_PER_INCH } from './geometry.js';
import { renderSheet, makeSourceCache, FRAME_COLORS, FONTS } from './render.js';
import { setPngDpi, setJpegDpi } from './dpi.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// Borderless SELPHY prints over-scan slightly; shown as the "safe area" overlay.
const OVERSCAN_MM = 2;
const PREVIEW_LONG_SIDE = 2400;
const STORE_KEY = 'twinmini:v1';

const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent) || /iP(hone|ad|od)/.test(navigator.userAgent);
const MAX_PIXELS = isSafari ? 16_777_216 : 48_000_000;

const defaults = {
  layout: 'mini',
  frame: { mini: 'true', wide: 'true' },
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

const fullSource = makeSourceCache();
const previewCache = makeSourceCache();
const previewSource = (p, pxPerSrc) => previewCache({ bitmap: p.preview }, pxPerSrc * (p.width / p.preview.width));

/* ---------------- persistence ---------------- */
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) return { ...structuredClone(defaults), ...saved, frame: { ...defaults.frame, ...saved.frame }, custom: { ...defaults.custom, ...saved.custom } };
  } catch { /* storage unavailable */ }
  return structuredClone(defaults);
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

/* ---------------- derived ---------------- */
const slotCount = () => (state.layout === 'wide' ? 1 : 2);
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
  let order;
  if (target != null) order = [target, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== target && !photos[i])];
  else {
    order = Array.from({ length: n }, (_, i) => i).filter((i) => !photos[i]);
    if (!order.length) order = Array.from({ length: n }, (_, i) => i);
  }
  const jobs = images.slice(0, order.length);
  if (images.length > order.length) toast(`Placed ${order.length} — the sheet holds ${n === 2 ? 'two photos' : 'one photo'}.`);
  await Promise.all(jobs.map(async (file, k) => {
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
  const ctx = canvas.getContext('2d');
  renderSheet(ctx, layout, renderSlots(), {
    scale: canvas.width / layout.paper.w,
    color: FRAME_COLORS.find((c) => c.id === state.color) || FRAME_COLORS[0],
    font: state.font,
    marks: state.marks,
    sourceFor: previewSource,
  });
}

function buildSlots() {
  const layout = currentLayout();
  const { paper } = layout;
  const slots = renderSlots();
  slotsEl.replaceChildren(...layout.cards.map((card, i) => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.index = i;
    Object.assign(el.style, pct(card.win, paper));
    const own = photos[i];
    const shown = slots[i].photo;
    if (!own && !shown) {
      el.classList.add('empty');
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Add photo to frame ${i + 1}`);
      el.innerHTML = `<span class="slot-cta"><span class="slot-plus"><svg viewBox="0 0 20 20"><path d="M10 4v12M4 10h12"/></svg></span>
        <span>Add photo</span><small>or drop it here</small></span>`;
      el.addEventListener('click', () => pickFiles(i));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFiles(i); } });
    } else {
      const p = own || shown;
      el.classList.add('filled');
      const q = quality(photoDpi(p, card.win).dpi);
      el.innerHTML = `<span class="slot-badge ${q.cls === 'low' ? 'low' : ''}">${Math.round(photoDpi(p, card.win).dpi)} dpi · ${q.label}</span>
        <div class="slot-tools" role="toolbar" aria-label="Photo ${i + 1} tools">
          ${tool('rotl', 'Rotate left', '<path d="M4 8a6.5 6.5 0 1 1 1.6 6.4"/><path d="M4 3.5V8h4.5"/>')}
          ${tool('rotr', 'Rotate right', '<path d="M16 8a6.5 6.5 0 1 0-1.6 6.4"/><path d="M16 3.5V8h-4.5"/>')}
          ${tool('flip', 'Flip 180°', '<path d="M10 3v14M6 13l4 4 4-4M6 7l4-4 4 4"/>')}
          ${tool('adjust', 'Adjust crop', '<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3"/>')}
          ${own ? tool('replace', 'Replace photo', '<path d="M3 13.5 7 9.5l3 3 3.5-4 3.5 4"/><rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/>') : tool('own', 'Use a different photo here', '<path d="M10 4v12M4 10h12"/>')}
          ${own ? tool('remove', 'Remove photo', '<path d="M5 6h10M8 6V4.5h4V6M6.5 6l.7 9.5h5.6l.7-9.5"/>') : ''}
        </div>`;
      el.querySelector('.slot-tools').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        e.stopPropagation();
        onTool(b.dataset.act, i, p);
      });
      attachPan(el, () => p, () => el.clientWidth, () => currentLayout().cards[i].win, drawPreview, () => buildSlots());
      el.addEventListener('dblclick', () => openAdjust(i));
    }
    // per-slot file drop
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

  const swap = $('#swapBtn');
  swap.hidden = !(slotCount() === 2 && (photos[0] || photos[1]));
}
const tool = (act, label, path) => `<button type="button" data-act="${act}" title="${label}" aria-label="${label}"><svg viewBox="0 0 20 20">${path}</svg></button>`;
const pct = (r, paper) => ({
  left: `${(r.x / paper.w) * 100}%`, top: `${(r.y / paper.h) * 100}%`,
  width: `${(r.w / paper.w) * 100}%`, height: `${(r.h / paper.h) * 100}%`,
});

function rotate(p, deg) {
  p.rot = (p.rot + deg + 360) % 360;
  p.cx = 0.5; p.cy = 0.5;
}

function onTool(act, i, p) {
  if (act === 'rotl') rotate(p, -90);
  else if (act === 'rotr') rotate(p, 90);
  else if (act === 'flip') rotate(p, 180);
  else if (act === 'adjust') return openAdjust(i);
  else if (act === 'replace' || act === 'own') return pickFiles(i);
  else if (act === 'remove') { releasePhoto(photos[i]); photos[i] = null; }
  update();
}

/**
 * Drag to pan, wheel / pinch to zoom, in any element showing a photo window.
 * winCssW() is the on-screen width of the window in CSS px.
 */
function attachPan(el, getPhoto, winCssW, getWin, onMove, onEnd) {
  const pts = new Map();
  let start = null;
  const snapshot = () => {
    const p = getPhoto(), win = getWin();
    return { p, win, crop: cropRect(p.width, p.height, p.rot, win.w / win.h, p.zoom, p.cx, p.cy), zoom: p.zoom };
  };
  const setCenter = (p, crop, x, y) => {
    p.cx = clamp(x / crop.W, crop.w / 2 / crop.W, 1 - crop.w / 2 / crop.W);
    p.cy = clamp(y / crop.H, crop.h / 2 / crop.H, 1 - crop.h / 2 / crop.H);
  };
  const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start = { ...snapshot(), pts: new Map([...pts].map(([k, v]) => [k, { ...v }])), d: pts.size === 2 ? dist() : 0 };
  });
  el.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { p, crop } = start;
    if (pts.size === 2 && start.d) {
      p.zoom = clamp(start.zoom * (dist() / start.d), 1, 5);
    } else {
      const s0 = start.pts.get(e.pointerId);
      if (!s0) return;
      const k = crop.w / winCssW();
      setCenter(p, crop, crop.x + crop.w / 2 - (e.clientX - s0.x) * k, crop.y + crop.h / 2 - (e.clientY - s0.y) * k);
    }
    onMove();
  });
  const end = (e) => {
    if (!pts.delete(e.pointerId)) return;
    start = pts.size ? { ...snapshot(), pts: new Map([...pts].map(([k, v]) => [k, { ...v }])), d: 0 } : null;
    if (!pts.size) onEnd();
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

function adjPhoto() { return photos[adjIndex] || renderSlots()[adjIndex].photo; }
function openAdjust(i) {
  adjIndex = i;
  const p = adjPhoto();
  if (!p) return;
  adjBackup = { rot: p.rot, zoom: p.zoom, cx: p.cx, cy: p.cy };
  $('#adjustTitle').textContent = slotCount() === 2 ? `Adjust ${i === 0 ? 'left' : 'right'} photo` : 'Adjust photo';
  adjustDlg.showModal();
  drawAdjust();
}
function drawAdjust() {
  const p = adjPhoto();
  const layout = currentLayout();
  const card = layout.cards[adjIndex];
  const box = $('#adjustStage').getBoundingClientRect();
  const maxW = Math.max(200, box.width - 48), maxH = Math.max(240, Math.min(window.innerHeight * 0.62, 640));
  const cssScale = Math.min(maxW / card.w, maxH / card.h);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  adjCanvas.style.width = `${card.w * cssScale}px`;
  adjCanvas.style.height = `${card.h * cssScale}px`;
  adjCanvas.width = Math.round(card.w * cssScale * dpr);
  adjCanvas.height = Math.round(card.h * cssScale * dpr);
  renderSheet(adjCanvas.getContext('2d'), { ...layout, cards: [card] }, [{ photo: p, caption: state.captions[adjIndex] }], {
    scale: cssScale * dpr, origin: { x: card.x, y: card.y },
    color: FRAME_COLORS.find((c) => c.id === state.color), font: state.font, marks: false, sourceFor: previewSource,
  });
  $('#zoomRange').value = p.zoom;
  const { dpi, crop } = photoDpi(p, card.win);
  const q = quality(dpi);
  $('#adjustStats').innerHTML = `
    <dt>Original</dt><dd>${p.width} × ${p.height} px</dd>
    <dt>Used in frame</dt><dd>${Math.round(crop.w)} × ${Math.round(crop.h)} px</dd>
    <dt>Rotation</dt><dd>${p.rot}°</dd>
    <dt>Print sharpness</dt><dd>${Math.round(dpi)} dpi <span class="pill ${q.cls}">${q.label}</span></dd>`;
}
attachPan(adjCanvas, adjPhoto, () => {
  const card = currentLayout().cards[adjIndex];
  return adjCanvas.clientWidth * (card.win.w / card.w);
}, () => currentLayout().cards[adjIndex].win, drawAdjust, () => {});
$('#zoomRange').addEventListener('input', (e) => { adjPhoto().zoom = Number(e.target.value); drawAdjust(); });
$$('[data-rot]', adjustDlg).forEach((b) => b.addEventListener('click', () => { rotate(adjPhoto(), Number(b.dataset.rot)); drawAdjust(); }));
$('#adjustReset').addEventListener('click', () => { Object.assign(adjPhoto(), { rot: 0, zoom: 1, cx: 0.5, cy: 0.5 }); drawAdjust(); });
adjustDlg.addEventListener('close', () => {
  if (adjustDlg.returnValue === 'cancel' && adjBackup) Object.assign(adjPhoto(), adjBackup);
  adjBackup = null;
  update();
});
adjustDlg.addEventListener('cancel', () => { adjustDlg.returnValue = 'cancel'; });

/* ---------------- inspector ---------------- */
function bindSeg(id, get, set) {
  const seg = $(id);
  const sync = () => $$('button', seg).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === get())));
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    set(b.dataset.value);
    update();
  });
  return sync;
}
const syncers = [
  bindSeg('#layoutSeg', () => state.layout, (v) => { state.layout = v; }),
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
    const L = computeLayout({ layout: state.layout, frame: id, paperId: state.paperId, custom: state.custom[state.layout] });
    const c = L.cards[0];
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

function buildSwatches() {
  const el = $('#swatches');
  el.replaceChildren(...FRAME_COLORS.map((c) => {
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
    inp.placeholder = n === 1 ? 'Write on the chin…' : i === 0 ? 'Left frame caption…' : 'Right frame caption…';
    inp.value = state.captions[i] || '';
    inp.addEventListener('input', () => { state.captions[i] = inp.value; saveState(); drawPreview(); });
    return inp;
  }));
}

$('#marksToggle').addEventListener('change', (e) => { state.marks = e.target.checked; update(); });
$('#repeatToggle').addEventListener('change', (e) => { state.repeat = e.target.checked; update(); });
$('#safeToggle').addEventListener('change', (e) => { $('#safeArea').hidden = !e.target.checked; });
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
  if (!layout.fits) fw.textContent = `This frame is ${layout.overflow} mm too big for its half of the sheet. Reduce the photo width or margins.`;

  const sizeTxt = `${fmt(paper.w)} × ${fmt(paper.h)} mm`;
  $('#sheetMeta').textContent = state.layout === 'wide'
    ? `${sizeTxt} · one Instax Wide frame`
    : `${sizeTxt} · two Instax Mini frames · cut down the middle`;

  const plan = outputPlan();
  const hasPhoto = plan.slots.some((s) => s.photo);
  $('#exportBtn').disabled = !hasPhoto;
  const mp = (plan.px.w * plan.px.h) / 1e6;
  $('#outInfo').innerHTML = hasPhoto
    ? `${state.dpiMode === 'auto' ? 'Auto → ' : ''}<b>${plan.dpi} dpi</b> · ${plan.px.w} × ${plan.px.h} px · ${mp.toFixed(1)} MP`
    : 'Auto keeps every pixel of your sharpest photo (300–1200 dpi). The SELPHY prints at 300 dpi.';
  $('#stageHint').textContent = hasPhoto
    ? (matchMedia('(hover: none)').matches
      ? 'Drag a photo to reposition · pinch to zoom · use the toolbar to rotate'
      : 'Drag a photo to reposition · scroll to zoom · double-click for more')
    : 'Drop one or two photos, or tap a frame to add one.';

  buildSlots();
  drawPreview();
  const f = FONTS[state.font];
  if (state.captions.some(Boolean)) document.fonts?.load(`${f.weight} 40px ${f.css}`).then(drawPreview, () => {});
}
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/* ---------------- export ---------------- */
const exportDlg = $('#exportDlg');
let exportUrl = null;

async function exportSheet() {
  const plan = outputPlan();
  const color = FRAME_COLORS.find((c) => c.id === state.color) || FRAME_COLORS[0];
  const preview = $('#exportPreview');
  const dl = $('#downloadLink');
  preview.innerHTML = '<div class="spinner" aria-label="Rendering"></div>';
  dl.setAttribute('aria-disabled', 'true');
  $('#shareBtn').hidden = true;
  $('#exportStats').innerHTML = '<dt>Rendering</dt><dd>full resolution…</dd>';
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
      renderSheet(ctx, layout, slots, { scale: dpi / MM_PER_INCH, color, font: state.font, marks: state.marks, sourceFor: fullSource });
      const type = state.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      blob = await new Promise((r) => cv.toBlob(r, type, 0.97));
    }
    cv.width = cv.height = 0;
    if (!blob) { dpi = Math.max(300, Math.floor(dpi * 0.75)); toast(`Not enough memory — retrying at ${dpi} dpi.`); }
  }
  if (!blob) { exportDlg.close(); return toast('Export failed on this device. Try 300 dpi.'); }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const stamped = state.format === 'jpeg' ? setJpegDpi(bytes, dpi) : setPngDpi(bytes, dpi);
  const type = state.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = state.format === 'jpeg' ? 'jpg' : 'png';
  const name = `twinmini-${state.layout}-${layout.paper.w}x${layout.paper.h}mm-${dpi}dpi.${ext}`;
  const file = new File([stamped], name, { type });
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = URL.createObjectURL(file);

  const px = sheetPixels(layout.paper, dpi);
  preview.innerHTML = `<img src="${exportUrl}" alt="Print sheet preview">`;
  dl.href = exportUrl;
  dl.download = name;
  dl.removeAttribute('aria-disabled');
  dl.textContent = `Download ${ext.toUpperCase()}`;
  const q = plan.minPhotoDpi ? quality(plan.minPhotoDpi) : null;
  $('#exportStats').innerHTML = `
    <dt>Size</dt><dd>${px.w} × ${px.h} px</dd>
    <dt>Print size</dt><dd>${fmt(layout.paper.w)} × ${fmt(layout.paper.h)} mm @ ${dpi} dpi</dd>
    <dt>Frames</dt><dd>${slots.length}</dd>
    <dt>File</dt><dd>${(file.size / 1e6).toFixed(1)} MB · ${ext.toUpperCase()}</dd>
    ${q ? `<dt>Photo sharpness</dt><dd><span class="pill ${q.cls}">${q.label}</span></dd>` : ''}`;
  const share = $('#shareBtn');
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    share.hidden = false;
    share.onclick = () => navigator.share({ files: [file], title: 'Twin Mini print' }).catch(() => {});
  }
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
  toastT = setTimeout(() => t.classList.remove('show'), 3600);
}

new ResizeObserver(() => drawPreview()).observe(sheetEl);
document.fonts?.ready.then(drawPreview);
update();
