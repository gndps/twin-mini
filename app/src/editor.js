// The print editor: one print almost full screen, edited directly on the canvas like a story.
// Drag, pinch and twist text, the date, emoji and stickers; drag one onto the bin to delete it;
// pinch or drag the photo to crop it; tap a text to retype it and a date to change its style.
// Mouse users get a selection box with a corner handle (scale and rotate), the wheel and keys.
import { ASPECTS, CORNER, clamp, cropRect } from './geometry.js';
import { drawCard, contrastInk } from './render.js';
import { FONT_GROUPS, fontCss, loadFonts } from './fonts.js';
import { nextDateStyle } from './captions.js';
import {
  FRAME_COLORS, TEXT_COLORS, TEXT_BGS, TEXT_ALIGNS, SIZE, textEl, dateEl, emojiEl, stickerEl, imageEl,
  chinSpot, defaultLayout, newId, remapElements,
} from './model.js';
import { STICKERS, EMOJI, stickerById, stickerSvg } from './stickers.js';

const $ = (s, el = document) => el.querySelector(s);
const ALL_FONTS = FONT_GROUPS.flatMap((g) => g.fonts);

const I = {
  back: '<path d="m12 5-5 5 5 5"/>',
  text: '<path d="M3.5 15.5 7.5 5h1l4 10.5M5 11.5h6"/><path d="M13.5 15.5v-5M12 11.3c.6-.6 1.3-.8 2-.8 1.4 0 2.2.8 2.2 2.2v2.8"/><path d="M16.2 13.2c-2.5 0-3.3.6-3.3 1.3 0 .6.5 1.1 1.3 1.1 1.2 0 2-.9 2-2.4"/>',
  sticker: '<path d="M16.5 10.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v10A1.5 1.5 0 0 0 5 16.5h5.5z"/><path d="M10.5 16.5c0-3.3 2.7-6 6-6"/><path d="M7 8.2v.3M12.5 8.2v.3"/>',
  date: '<rect x="3" y="4.5" width="14" height="12" rx="2"/><path d="M3 8.5h14M7 3v3M13 3v3"/>',
  layout: '<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M7.5 3v14M12.5 3v14M3 6.5h14M3 13h14"/>',
  portrait: '<rect x="5.5" y="3" width="9" height="14" rx="1"/><path d="M7.5 5h5v6.5h-5z"/>',
  landscape: '<rect x="3" y="5.5" width="14" height="9" rx="1"/><path d="M5 7.5h7v5H5z"/>',
  frame: '<rect x="3.5" y="2.5" width="13" height="15" rx="1"/><path d="M6 5h8v8H6z"/>',
  photo: '<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M3 13.5 7 9.5l3 3 3.5-4 3.5 4"/><circle cx="13" cy="7" r="1"/>',
  edit: '<path d="M4 16h3.5L16 7.5 12.5 4 4 12.5z"/><path d="m11 5.5 3.5 3.5"/>',
  font: '<path d="M5 16 9.2 4h1.6L15 16M6.6 12h6.8"/>',
  color: '<path d="M10 2.8s5.2 5.6 5.2 9.2a5.2 5.2 0 0 1-10.4 0c0-3.6 5.2-9.2 5.2-9.2Z"/>',
  style: '<rect x="3" y="4" width="14" height="12" rx="2.5"/><path d="M7 13.5 10 6.5l3 7M8 11.2h4"/>',
  'align-left': '<path d="M3 5h14M3 9h9M3 13h12M3 17h7"/>',
  'align-center': '<path d="M3 5h14M5.5 9h9M4 13h12M6.5 17h7"/>',
  'align-right': '<path d="M3 5h14M8 9h9M5 13h12M10 17h7"/>',
  size: '<path d="M3 17 17 3M11 3h6v6M9 17H3v-6"/>',
  dup: '<rect x="6.5" y="6.5" width="10" height="10" rx="1.5"/><path d="M13.5 6.5V4.5A1 1 0 0 0 12.5 3.5h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2"/>',
  trash: '<path d="M5 6h10M8 6V4.5h4V6M6.5 6l.7 9.5h5.6l.7-9.5"/>',
  format: '<path d="M4 6h12M4 10h8M4 14h10"/><circle cx="15.5" cy="13.5" r="2.2"/>',
  rotl: '<path d="M4 8a6.5 6.5 0 1 1 1.6 6.4"/><path d="M4 3.5V8h4.5"/>',
  rotr: '<path d="M16 8a6.5 6.5 0 1 0-1.6 6.4"/><path d="M16 3.5V8h-4.5"/>',
  flip: '<path d="M10 3v14M6 13l4 4 4-4M6 7l4-4 4 4"/>',
  replace: '<path d="M4 8a6 6 0 0 1 10.5-3.5L16 6M16 3v3h-3M16 12a6 6 0 0 1-10.5 3.5L4 14M4 17v-3h3"/>',
  reset: '<path d="M4 10a6 6 0 1 0 2-4.5"/><path d="M4 3v3.5h3.5"/>',
  link: '<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2L10 5.8"/><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1.1-1.1"/>',
  turn: '<rect x="3" y="6" width="9" height="11" rx="1"/><path d="M10 3.5h3.5A3 3 0 0 1 16.5 6.5V10M14.5 8l2 2 2-2"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  picture: '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3.5 13 7.5 9l3 3 2-2 3.5 3.5"/>',
};
const svg = (k) => `<svg viewBox="0 0 20 20" aria-hidden="true">${I[k]}</svg>`;

export function createEditor(app) {
  const root = $('#editor'), stage = $('#edStage'), cv = $('#edCanvas');
  const sel = $('#edSel'), grid = $('#edGrid'), trash = $('#edTrash'), deck = $('#edDeck'), panel = $('#edPanel');
  const gv = $('#guideV'), gh = $('#guideH'), addPhotoBtn = $('#edAddPhoto'), hint = $('#edHint');
  const te = { root: $('#textEdit'), input: $('#teInput'), size: $('#teSize'), fonts: $('#teFonts'), colors: $('#teColors') };

  let open = false, idx = 0, selId = null, tool = null, editing = null;
  let view = { k: 1, left: 0, top: 0, dpr: 1 };
  const boxes = new Map();
  let guides = { v: null, h: null };
  let frame = 0;

  const prints = () => app.prints();
  const print = () => prints()[idx];
  const slotOf = () => app.sheet().slots[idx];
  const card = () => slotOf().card;
  const photo = () => app.photos[idx];
  const selected = () => print()?.elements.find((e) => e.id === selId) || null;

  /* ---------------- open / close ---------------- */
  function openEditor(i) {
    idx = clamp(i, 0, app.count() - 1);
    selId = null; tool = null;
    open = true;
    root.hidden = false;
    document.body.classList.add('editing');
    history.pushState({ twinminiEditor: true }, '');
    loadFonts(app.fontsInUse()).then(draw);
    refresh();
    flashHint(photo() ? 'Tap to add text · Pinch or drag the photo to crop it' : 'Add a photo, or tap anywhere to add text');
  }
  function closeEditor(fromHistory = false) {
    if (!open) return;
    if (editing) finishText();
    open = false;
    root.hidden = true;
    document.body.classList.remove('editing');
    if (!fromHistory && history.state?.twinminiEditor) history.back();
  }
  window.addEventListener('popstate', () => { if (open) closeEditor(true); });
  $('#edDone').addEventListener('click', () => closeEditor());
  $('#edPrev').addEventListener('click', () => switchPrint(-1));
  $('#edNext').addEventListener('click', () => switchPrint(1));
  function switchPrint(d) {
    if (app.count() < 2) return;
    idx = (idx + d + 2) % 2;
    selId = null;
    if (tool !== 'layout' && tool !== 'frame' && tool !== 'photo') tool = null;
    refresh();
  }
  $('#edUndo').addEventListener('click', () => { if (app.undo()) afterHistory(); });
  $('#edRedo').addEventListener('click', () => { if (app.redo()) afterHistory(); });
  function afterHistory() { if (!selected()) selId = null; refresh(); }

  /** Rebuild everything (after a print, format, history or theme change). */
  function refresh() {
    if (!open) return;
    if (idx >= app.count()) idx = 0;
    if (selId && !selected()) selId = null;
    $('#edPager').classList.toggle('single', app.count() < 2);
    $('#edTitle').textContent = app.count() < 2 ? 'Print' : `Print ${idx + 1} of 2`;
    $('#edUndo').disabled = !app.canUndo();
    $('#edRedo').disabled = !app.canRedo();
    buildDeck();
    buildPanel();
    fit();
    draw();
  }
  /** Small changes: save, update history buttons and redraw. */
  function changed() {
    app.commit();
    $('#edUndo').disabled = !app.canUndo();
    $('#edRedo').disabled = !app.canRedo();
    draw();
  }

  /* ---------------- canvas ---------------- */
  function fit() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const c = card();
    const pad = r.width < 600 ? 14 : 28;
    const k = Math.max(0.5, Math.min((r.width - pad * 2) / c.w, (r.height - pad * 2) / c.h));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    view = { k, dpr, left: Math.round((r.width - c.w * k) / 2), top: Math.round((r.height - c.h * k) / 2) };
    Object.assign(cv.style, { left: `${view.left}px`, top: `${view.top}px`, width: `${c.w * k}px`, height: `${c.h * k}px` });
    cv.width = Math.round(c.w * k * dpr);
    cv.height = Math.round(c.h * k * dpr);
  }
  new ResizeObserver(() => { if (open) { fit(); draw(); } }).observe(stage);
  function draw() {
    if (!open) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(paint);
  }
  function paint() {
    const c = card(), p = print();
    if (!p) return;
    const want = Math.round(c.w * view.k * view.dpr);
    if (cv.width !== want) fit();
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    const s = view.k * view.dpr;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    boxes.clear();
    drawCard(ctx, c, p, photo(), {
      scale: s, sourceFor: app.previewSource, photoDate: app.photoDate(idx), assets: app.assets,
      skip: editing?.id || (g.over ? g.target?.id : null), boxes,
    });
    paintOverlay();
  }

  const toMm = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.k, y: (e.clientY - r.top) / view.k };
  };
  const px = (mm) => mm * view.k;

  /* ---------------- overlay: selection, guides, layout lines ---------------- */
  function boxCenter(b) {
    const a = (b.rot * Math.PI) / 180;
    return { x: b.ax + Math.cos(a) * b.ox, y: b.ay + Math.sin(a) * b.ox };
  }
  function paintOverlay() {
    const el = selected(), b = el && boxes.get(el.id);
    const showSel = b && !editing && !g.active && tool !== 'layout';
    sel.hidden = !showSel;
    if (showSel) {
      const c = boxCenter(b);
      Object.assign(sel.style, {
        left: `${view.left + px(c.x)}px`, top: `${view.top + px(c.y)}px`,
        width: `${px(b.w) + 14}px`, height: `${px(b.h) + 14}px`,
        transform: `translate(-50%, -50%) rotate(${b.rot}deg)`,
      });
    }
    gv.hidden = guides.v == null;
    gh.hidden = guides.h == null;
    if (guides.v != null) Object.assign(gv.style, { left: `${view.left + px(guides.v)}px`, top: `${view.top}px`, height: `${px(card().h)}px` });
    if (guides.h != null) Object.assign(gh.style, { top: `${view.top + px(guides.h)}px`, left: `${view.left}px`, width: `${px(card().w)}px` });
    paintGrid();
    const { win } = card();
    addPhotoBtn.hidden = !!photo() || tool === 'layout' || !!editing;
    Object.assign(addPhotoBtn.style, { left: `${view.left + px(win.x + win.w / 2)}px`, top: `${view.top + px(win.y + win.h / 2)}px` });
  }
  addPhotoBtn.addEventListener('click', () => app.pickFiles(idx));

  // Layout lines: the photo's edges extended across the card, each dragged to set one value.
  const LINES = ['left', 'right', 'top', 'bottom'];
  function paintGrid() {
    grid.hidden = tool !== 'layout';
    if (grid.hidden) return;
    if (!grid.children.length) {
      grid.innerHTML = LINES.map((n) => `<div class="gl ${n}" data-line="${n}"><i></i></div>`).join('')
        + '<span class="gl-tag tw"></span><span class="gl-tag tt"></span><span class="gl-tag th"></span>';
    }
    const c = card(), { win } = c;
    const L = view.left, T = view.top;
    const set = (n, st) => Object.assign(grid.querySelector(`.${n}`).style, st);
    set('left', { left: `${L + px(win.x)}px`, top: `${T}px`, height: `${px(c.h)}px` });
    set('right', { left: `${L + px(win.x + win.w)}px`, top: `${T}px`, height: `${px(c.h)}px` });
    set('top', { top: `${T + px(win.y)}px`, left: `${L}px`, width: `${px(c.w)}px` });
    set('bottom', { top: `${T + px(win.y + win.h)}px`, left: `${L}px`, width: `${px(c.w)}px` });
    for (const n of LINES) grid.querySelector(`.${n}`).classList.toggle('active', g.line === n);
    const tag = (cls, text, x, y) => Object.assign(grid.querySelector(cls), { textContent: text }).style.cssText = `left:${x}px;top:${y}px`;
    tag('.tw', `Width ${win.w.toFixed(1)} mm`, L + px(win.x + win.w / 2), T + px(win.y) + 26);
    tag('.tt', `Top ${win.y.toFixed(1)} mm`, L + px(win.x + win.w / 2), T + px(win.y / 2));
    tag('.th', `Height ${win.h.toFixed(1)} mm · chin ${c.chin.h.toFixed(1)} mm`, L + px(win.x + win.w / 2), T + px(win.y + win.h) - 26);
  }

  /* ---------------- hit testing ---------------- */
  function hitElement(p, extraPx = 0) {
    const els = print().elements;
    for (let i = els.length - 1; i >= 0; i--) {
      const b = boxes.get(els[i].id);
      if (!b) continue;
      const c = boxCenter(b), a = (-b.rot * Math.PI) / 180;
      const dx = p.x - c.x, dy = p.y - c.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      const min = (22 + extraPx) / view.k;
      if (Math.abs(lx) <= Math.max(b.w / 2 + 4 / view.k, min) && Math.abs(ly) <= Math.max(b.h / 2 + 4 / view.k, min)) return els[i];
    }
    return null;
  }
  function handleHit(p) {
    const el = selected(), b = el && boxes.get(el.id);
    if (!b) return false;
    const c = boxCenter(b), a = (b.rot * Math.PI) / 180;
    const hx = b.w / 2 + 7 / view.k, hy = b.h / 2 + 7 / view.k;
    const x = c.x + hx * Math.cos(a) - hy * Math.sin(a), y = c.y + hx * Math.sin(a) + hy * Math.cos(a);
    return Math.hypot(p.x - x, p.y - y) < 20 / view.k;
  }
  function gridHit(p) {
    const { win } = card();
    const d = { left: Math.abs(p.x - win.x), right: Math.abs(p.x - win.x - win.w), top: Math.abs(p.y - win.y), bottom: Math.abs(p.y - win.y - win.h) };
    const best = LINES.reduce((a, n) => (d[n] < d[a] ? n : a));
    return d[best] < 18 / view.k ? best : null;
  }
  const inWindow = (p) => { const { win } = card(); return p.x >= win.x && p.x <= win.x + win.w && p.y >= win.y && p.y <= win.y + win.h; };

  /* ---------------- gestures ---------------- */
  // mode: element (move / pinch / twist), handle (corner: scale + rotate), photo (pan / pinch),
  // grid (a layout line), blank (a tap on empty space).
  const g = { pts: new Map(), mode: null, target: null, wasSelected: false, moved: false, active: false, start: null, line: null, over: false };
  const ptList = () => [...g.pts.values()];
  function rebase() {
    const el = g.target;
    g.start = {
      pts: new Map([...g.pts].map(([k, v]) => [k, { ...v }])),
      el: el && { x: el.x, y: el.y, size: el.size, rot: el.rot },
      crop: { ...print().crop },
    };
  }
  stage.addEventListener('pointerdown', (e) => {
    if (editing || e.button > 0 || e.target.closest('button')) return;
    stage.setPointerCapture(e.pointerId);
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = toMm(e);
    if (g.pts.size === 1) {
      g.moved = false; g.over = false; g.line = null; g.target = null;
      g.down = { x: e.clientX, y: e.clientY };
      if (tool === 'layout') { g.line = gridHit(p); g.mode = g.line ? 'grid' : 'none'; }
      else if (handleHit(p)) { g.mode = 'handle'; g.target = selected(); }
      else {
        const el = hitElement(p);
        if (el) { g.mode = 'element'; g.target = el; g.wasSelected = el.id === selId; }
        else g.mode = inWindow(p) ? 'photo' : 'blank';
      }
    } else if (g.pts.size === 2) {
      if (g.mode === 'element' || g.mode === 'handle') g.mode = 'element';
      else if (g.mode === 'photo' || g.mode === 'blank') {
        const [a, b] = ptList();
        const r = cv.getBoundingClientRect();
        const mid = { x: ((a.x + b.x) / 2 - r.left) / view.k, y: ((a.y + b.y) / 2 - r.top) / view.k };
        const el = hitElement(mid, 30);
        if (el) { g.mode = 'element'; g.target = el; }
        else g.mode = photo() ? 'photo' : 'none';
      }
      if (!g.moved) beginGesture();
      g.moved = true;
    }
    rebase();
  });
  function beginGesture() {
    g.active = true;
    if (g.mode === 'element' || g.mode === 'handle') {
      const els = print().elements;
      // The element being handled comes to the top, like a story.
      const i = els.indexOf(g.target);
      if (i >= 0 && i < els.length - 1) { els.splice(i, 1); els.push(g.target); }
      selId = g.target.id;
      if (g.mode === 'element') root.classList.add('dragging');
    }
    if (g.mode === 'photo') root.classList.add('panning');
  }
  stage.addEventListener('pointermove', (e) => {
    if (!g.pts.has(e.pointerId)) return;
    g.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!g.moved) {
      if (Math.hypot(e.clientX - g.down.x, e.clientY - g.down.y) < 6) return;
      g.moved = true;
      beginGesture();
    }
    if (g.mode === 'element') moveElement(e);
    else if (g.mode === 'handle') turnByHandle(e);
    else if (g.mode === 'photo') movePhoto();
    else if (g.mode === 'grid') moveLine(toMm(e));
    draw();
  });
  const finish = (e) => {
    if (!g.pts.delete(e.pointerId)) return;
    if (g.pts.size) { rebase(); return; }
    const { mode, target, moved, over } = g;
    g.active = false;
    root.classList.remove('dragging', 'panning');
    trash.classList.remove('show', 'over');
    guides = { v: null, h: null };
    g.line = null;
    if (e.type === 'pointercancel' && !moved) { draw(); return; }
    if (!moved) tap(mode, target, toMm(e));
    else if (mode === 'element' && over) { removeElement(target); g.over = false; }
    else { changed(); if (mode === 'grid' || mode === 'photo') buildPanel(); }
    g.over = false;
    buildDeck();
    draw();
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);

  function moveElement(e) {
    const el = g.target, s = g.start, c = card();
    const pts = ptList(), spts = [...s.pts.values()];
    if (pts.length >= 2 && spts.length >= 2) {
      const [a, b] = pts, [a0, b0] = spts;
      const d = Math.hypot(b.x - a.x, b.y - a.y), d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
      el.size = clamp(s.el.size * (d / d0), SIZE.min, SIZE.max);
      el.rot = snapAngle(s.el.rot + ((Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)) * 180) / Math.PI);
      const mx = ((a.x + b.x) - (a0.x + b0.x)) / 2 / view.k, my = ((a.y + b.y) - (a0.y + b0.y)) / 2 / view.k;
      el.x = s.el.x + mx / c.w; el.y = s.el.y + my / c.h;
      trash.classList.remove('show');
      return;
    }
    const p0 = spts[0], p = pts[0];
    const ax = s.el.x * c.w + (p.x - p0.x) / view.k, ay = s.el.y * c.h + (p.y - p0.y) / view.k;
    const snapped = snapMove(el, ax, ay);
    el.x = snapped.ax / c.w; el.y = snapped.ay / c.h;
    // The bin: drop an element on it to delete it.
    trash.classList.add('show');
    const t = trash.getBoundingClientRect();
    const over = Math.hypot(p.x - (t.left + t.width / 2), p.y - (t.top + t.height / 2)) < 48;
    if (over !== g.over) { g.over = over; trash.classList.toggle('over', over); if (over) buzz(); }
  }
  function turnByHandle(e) {
    const el = g.target, s = g.start, c = card();
    const r = cv.getBoundingClientRect();
    const ax = r.left + px(s.el.x * c.w), ay = r.top + px(s.el.y * c.h);
    const p0 = [...s.pts.values()][0];
    const v0 = { x: p0.x - ax, y: p0.y - ay }, v = { x: e.clientX - ax, y: e.clientY - ay };
    el.size = clamp(s.el.size * (Math.hypot(v.x, v.y) / (Math.hypot(v0.x, v0.y) || 1)), SIZE.min, SIZE.max);
    el.rot = snapAngle(s.el.rot + ((Math.atan2(v.y, v.x) - Math.atan2(v0.y, v0.x)) * 180) / Math.PI);
  }
  let lastSnap = '';
  function buzz() { navigator.vibrate?.(8); }
  function snapAngle(deg) {
    const d = ((deg % 360) + 360) % 360;
    const near = Math.round(d / 90) * 90;
    return Math.abs(d - near) < 4 ? near % 360 : d;
  }
  /** Snap an element's box to the card centre, the photo's edges and the middle of each border. */
  function snapMove(el, ax, ay) {
    const b = boxes.get(el.id), c = card(), { win } = c;
    guides = { v: null, h: null };
    if (!b) return { ax, ay };
    const th = 7 / view.k;
    const r = ((el.rot % 360) + 360) % 360;
    const a = (r * Math.PI) / 180;
    const cx = ax + Math.cos(a) * b.ox, cy = ay + Math.sin(a) * b.ox;
    const flat = r % 180 === 0, upright = r % 180 === 90;
    const halfX = flat ? b.w / 2 : upright ? b.h / 2 : null;
    const halfY = flat ? b.h / 2 : upright ? b.w / 2 : null;
    const xs = [[c.w / 2, 0, c.w / 2]];
    if (halfX != null) xs.push([win.x, -halfX, win.x], [win.x + win.w, halfX, win.x + win.w]);
    const ys = [[c.h / 2, 0, c.h / 2], [win.y + win.h / 2, 0, win.y + win.h / 2]];
    if (c.chin.h > 3) ys.push([(win.y + win.h + c.h) / 2, 0, (win.y + win.h + c.h) / 2]);
    if (win.y > 3) ys.push([win.y / 2, 0, win.y / 2]);
    if (halfY != null) ys.push([win.y + win.h, -halfY, win.y + win.h]);
    let dx = 0, dy = 0;
    for (const [t, off, line] of xs) { const e = t - (cx + off); if (Math.abs(e) < th) { dx = e; guides.v = line; break; } }
    for (const [t, off, line] of ys) { const e = t - (cy + off); if (Math.abs(e) < th) { dy = e; guides.h = line; break; } }
    const key = `${guides.v}|${guides.h}`;
    if (key !== lastSnap && (guides.v != null || guides.h != null)) buzz();
    lastSnap = key;
    return { ax: ax + dx, ay: ay + dy };
  }

  function movePhoto() {
    const p = photo();
    if (!p) return;
    const s = g.start, crop = print().crop, { win } = card();
    const pts = ptList(), spts = [...s.pts.values()];
    let zoom = s.crop.zoom, mx, my;
    if (pts.length >= 2 && spts.length >= 2) {
      const [a, b] = pts, [a0, b0] = spts;
      zoom = clamp(s.crop.zoom * (Math.hypot(b.x - a.x, b.y - a.y) / (Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1)), 1, 5);
      mx = ((a.x + b.x) - (a0.x + b0.x)) / 2; my = ((a.y + b.y) - (a0.y + b0.y)) / 2;
    } else { mx = pts[0].x - spts[0].x; my = pts[0].y - spts[0].y; }
    const c0 = cropRect(p.width, p.height, s.crop.rot, win.w / win.h, s.crop.zoom, s.crop.cx, s.crop.cy);
    const k = c0.w / px(win.w); // source px per screen px
    const c1 = cropRect(p.width, p.height, s.crop.rot, win.w / win.h, zoom, s.crop.cx, s.crop.cy);
    const x = c0.x + c0.w / 2 - mx * k, y = c0.y + c0.h / 2 - my * k;
    crop.zoom = zoom;
    crop.cx = clamp(x / c1.W, c1.w / 2 / c1.W, 1 - c1.w / 2 / c1.W);
    crop.cy = clamp(y / c1.H, c1.h / 2 / c1.H, 1 - c1.h / 2 / c1.H);
  }

  /** Drag a layout line: sides = photo width, top = top border, bottom = photo height. */
  function moveLine(p) { relayout(() => setLine(p)); }
  function setLine(p) {
    const L = print().layout, c = card();
    if (L.w == null) L.w = c.fw;
    if (L.top == null) L.top = c.ftop;
    if (g.line === 'left' || g.line === 'right') {
      if (L.aspect === 'custom' && L.h == null) L.h = c.fh;
      L.w = clamp((2 * Math.abs(p.x - c.w / 2)) / c.w, 0.15, 1);
    } else if (g.line === 'top') {
      if (L.aspect === 'custom' && L.h == null) L.h = c.fh;
      let top = clamp(p.y / c.h, 0, Math.max(0, 1 - c.fh));
      // Snap the top border to the side border (the Instax look).
      const side = (c.w - c.win.w) / 2 / c.h;
      if (Math.abs(top - side) * c.h < 6 / view.k) { top = side; if (lastSnap !== 'side') buzz(); lastSnap = 'side'; } else lastSnap = '';
      L.top = top;
    } else if (g.line === 'bottom') {
      L.aspect = 'custom';
      L.h = clamp((p.y - c.win.y) / c.h, 0.08, 1 - c.ftop);
    }
  }
  /** Linked prints (Two Minis facing the same way) share the edited layout. */
  function linkLayouts() {
    if (app.count() === 2 && app.linked()) prints()[1 - idx].layout = { ...print().layout };
  }
  /** Change the layout, keeping every element in the same part of its print. */
  function relayout(fn) {
    const before = app.sheet().slots.map((s) => s.card);
    fn();
    linkLayouts();
    const after = app.sheet().slots.map((s) => s.card);
    prints().forEach((p, i) => remapElements(p, before[i], after[i]));
  }

  function tap(mode, el, p) {
    if (mode === 'element' && el) {
      if (g.wasSelected) activate(el);
      else { selId = el.id; if (!['font', 'color', 'style', 'size'].includes(tool)) tool = null; }
      buildPanel();
      return;
    }
    if (mode === 'photo' || mode === 'blank') {
      if (selId || tool) { selId = null; tool = null; buildPanel(); return; }
      addText(p);
    }
  }
  /** A tap on a selected element: retype a text, change a date's style. */
  function activate(el) {
    if (el.type === 'text') openText(el);
    else if (el.type === 'date') { el.fmt = nextDateStyle(el.fmt); changed(); }
  }

  stage.addEventListener('wheel', (e) => {
    if (editing || tool === 'layout') return;
    e.preventDefault();
    const p = toMm(e);
    const el = hitElement(p) || (selected() && hitElement(p, 40) === selected() ? selected() : null);
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    if (el) { el.size = clamp(el.size * f, SIZE.min, SIZE.max); selId = el.id; }
    else if (inWindow(p) && photo()) { const c = print().crop; c.zoom = clamp(c.zoom * f, 1, 5); }
    else return;
    draw();
    clearTimeout(stage._wheelT);
    stage._wheelT = setTimeout(() => { changed(); buildDeck(); }, 300);
  }, { passive: false });

  /* ---------------- elements ---------------- */
  function addElement(el, { edit = false } = {}) {
    print().elements.push(el);
    selId = el.id;
    tool = null;
    if (edit) { openText(el, true); return; }
    changed();
    buildDeck(); buildPanel();
    loadFonts(app.fontsInUse()).then(draw);
  }
  function addText(p) {
    const c = card();
    const last = [...print().elements].reverse().find((e) => e.type === 'text');
    const at = p ? { x: clamp(p.x / c.w, 0.05, 0.95), y: clamp(p.y / c.h, 0.05, 0.95) } : chinSpot(c);
    addElement(textEl({ ...(last ? { font: last.font, size: last.size, color: last.color, bg: last.bg } : {}), ...at, align: 'center' }), { edit: true });
  }
  function addDate() {
    const existing = print().elements.find((e) => e.type === 'date');
    if (existing) { selId = existing.id; tool = null; buildDeck(); buildPanel(); draw(); return; }
    addElement(dateEl(chinSpot(card(), 'right')));
  }
  function centreSpot() { const { win } = card(), c = card(); return { x: (win.x + win.w / 2) / c.w, y: (win.y + win.h / 2) / c.h }; }
  function removeElement(el) {
    const p = print();
    p.elements = p.elements.filter((e) => e !== el);
    if (selId === el.id) selId = null;
    tool = null;
    changed();
    buildDeck(); buildPanel();
  }
  function duplicate(el) {
    const c = card();
    const copy = { ...JSON.parse(JSON.stringify(el)), id: newId(), x: el.x + 3 / c.w, y: el.y + 3 / c.h };
    addElement(copy);
  }

  /* ---------------- the deck ---------------- */
  function deckBtn(key, label, onClick, { pressed, cls } = {}) {
    const b = document.createElement('button');
    b.className = `deck-btn${cls ? ` ${cls}` : ''}`;
    b.innerHTML = `${svg(key)}<span>${label}</span>`;
    if (pressed != null) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  }
  const toggleTool = (t) => () => { tool = tool === t ? null : t; buildDeck(); buildPanel(); fit(); draw(); };
  function buildDeck() {
    const el = selected();
    let btns;
    if (!el) {
      const p = print();
      btns = [
        deckBtn('text', 'Text', () => addText()),
        deckBtn('sticker', 'Stickers', openStickers),
        deckBtn('date', 'Date', addDate),
        deckBtn('layout', 'Layout', toggleTool('layout'), { pressed: tool === 'layout' }),
        deckBtn(p.orientation === 'portrait' ? 'portrait' : 'landscape', p.orientation === 'portrait' ? 'Portrait' : 'Landscape', toggleOrientation),
        deckBtn('frame', 'Frame', toggleTool('frame'), { pressed: tool === 'frame' }),
        deckBtn('photo', 'Photo', toggleTool('photo'), { pressed: tool === 'photo' }),
      ];
    } else {
      const isText = el.type === 'text' || el.type === 'date';
      btns = [deckBtn('back', 'Done', () => { selId = null; tool = null; buildDeck(); buildPanel(); fit(); draw(); }, { cls: 'deck-back' })];
      if (el.type === 'text') btns.push(deckBtn('edit', 'Edit', () => openText(el)));
      if (el.type === 'date') btns.push(deckBtn('format', 'Format', () => app.openDateFormat(el, draw)));
      if (isText) {
        btns.push(
          deckBtn('font', 'Font', toggleTool('font'), { pressed: tool === 'font' }),
          deckBtn('color', 'Colour', toggleTool('color'), { pressed: tool === 'color' }),
          deckBtn('style', 'Background', () => { el.bg = TEXT_BGS[(TEXT_BGS.indexOf(el.bg) + 1) % TEXT_BGS.length]; changed(); }),
          deckBtn(`align-${el.align}`, 'Align', () => cycleAlign(el)),
        );
      }
      if (el.type === 'sticker' && stickerById(el.sticker)?.tint) btns.push(deckBtn('color', 'Colour', toggleTool('color'), { pressed: tool === 'color' }));
      btns.push(
        deckBtn('size', 'Size', toggleTool('size'), { pressed: tool === 'size' }),
        deckBtn('dup', 'Duplicate', () => duplicate(el)),
        deckBtn('trash', 'Delete', () => removeElement(el), { cls: 'danger' }),
      );
    }
    deck.replaceChildren(...btns);
  }
  /** Change alignment without moving the text: keep its box where it is. */
  function cycleAlign(el) {
    const b = boxes.get(el.id), c = card();
    const next = TEXT_ALIGNS[(TEXT_ALIGNS.indexOf(el.align) + 1) % TEXT_ALIGNS.length];
    if (b) {
      const ctr = boxCenter(b), a = (el.rot * Math.PI) / 180;
      const ox = next === 'left' ? -b.w / 2 : next === 'right' ? b.w / 2 : 0;
      el.x = (ctr.x + Math.cos(a) * ox) / c.w; el.y = (ctr.y + Math.sin(a) * ox) / c.h;
    }
    el.align = next;
    changed();
    buildDeck();
  }
  function toggleOrientation() {
    const p = print(), before = card();
    p.orientation = p.orientation === 'portrait' ? 'landscape' : 'portrait';
    // Sizes differ between orientations; start from the default for the new one.
    p.layout = { ...defaultLayout(app.doc.format), aspect: p.layout.aspect, h: null, corner: p.layout.corner };
    if (p.layout.aspect === 'custom') p.layout.aspect = defaultLayout(app.doc.format).aspect;
    if (app.count() === 2 && app.linked()) p.layout = { ...prints()[1 - idx].layout };
    remapElements(p, before, card());
    changed();
    refresh();
  }

  /* ---------------- panels (above the deck) ---------------- */
  function buildPanel() {
    const el = selected();
    if (el && !['font', 'color', 'size'].includes(tool)) tool = null;
    if (!el && ['font', 'color', 'size'].includes(tool)) tool = null;
    panel.hidden = !tool;
    root.classList.toggle('with-panel', !!tool);
    panel.replaceChildren();
    if (!tool) return;
    ({ layout: layoutPanel, frame: framePanel, photo: photoPanel, font: fontPanel, color: colorPanel, size: sizePanel })[tool]?.(el);
  }
  const row = (cls = 'pn-row') => Object.assign(document.createElement('div'), { className: cls });
  function chip(label, onClick, { pressed, html } = {}) {
    const b = document.createElement('button');
    b.className = 'pn-chip';
    if (html) b.innerHTML = html; else b.textContent = label;
    if (pressed != null) b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onClick);
    return b;
  }
  function slider(label, { min, max, step, value, fmt, onInput, onDone, extra }) {
    const wrap = row('pn-slider');
    wrap.innerHTML = `<span class="pn-label">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" aria-label="${label}"><span class="pn-val"></span>`;
    const input = wrap.querySelector('input'), val = wrap.querySelector('.pn-val');
    input.value = value;
    val.textContent = fmt(value);
    input.addEventListener('input', () => { const v = Number(input.value); val.textContent = fmt(v); onInput(v); draw(); });
    input.addEventListener('change', () => onDone?.());
    if (extra) wrap.append(extra);
    return wrap;
  }

  function layoutPanel() {
    const p = print(), L = p.layout, c = card();
    const shapes = row('pn-row pn-scroll');
    const turned = (c.w > c.h) !== !!L.turn;
    for (const a of ASPECTS) {
      const [w, h] = turned ? [a.h, a.w] : [a.w, a.h];
      const k = 18 / Math.max(w, h);
      shapes.append(chip(a.label, () => { relayout(() => { L.aspect = a.id; L.h = null; }); changed(); buildPanel(); },
        { pressed: L.aspect === a.id, html: `<i class="shape" style="width:${w * k}px;height:${h * k}px"></i><span>${turned && a.label.includes(':') ? a.label.split(' : ').reverse().join(' : ') : a.label}</span>` }));
    }
    if (L.aspect === 'custom') shapes.prepend(chip('Custom', () => {}, { pressed: true }));
    const tools = row('pn-row');
    tools.append(
      chip('', () => { relayout(() => { L.turn = !L.turn; L.h = null; if (L.aspect === 'custom') L.aspect = defaultLayout(app.doc.format).aspect; }); changed(); buildPanel(); }, { pressed: !!L.turn, html: `${svg('turn')}<span>Turn shape</span>` }),
      chip('', () => { relayout(() => { print().layout = { ...defaultLayout(app.doc.format), aspect: L.aspect === 'custom' ? defaultLayout(app.doc.format).aspect : L.aspect, turn: L.turn, corner: L.corner }; }); changed(); buildPanel(); }, { html: `${svg('reset')}<span>Reset size</span>` }),
    );
    if (app.count() === 2) {
      const same = app.doc.two[0].orientation === app.doc.two[1].orientation;
      tools.append(chip('', () => {
        if (!same) return app.toast('One print is portrait and one landscape, so each has its own layout');
        relayout(() => { app.doc.linked = !app.doc.linked; });
        changed(); buildPanel();
        app.toast(app.doc.linked ? 'Both prints share this layout' : 'Each print has its own layout');
      }, { pressed: same && app.doc.linked, html: `${svg('link')}<span>${same ? 'Same on both' : 'Own layouts'}</span>` }));
    }
    const short = Math.min(c.win.w, c.win.h);
    const corner = slider('Corners', {
      min: 0, max: CORNER.max, step: 0.0005, value: L.corner ?? CORNER.instax,
      fmt: (v) => `${(v * short).toFixed(2)} mm${Math.abs(v - CORNER.instax) < 0.0003 ? ' · Instax' : v === 0 ? ' · square' : ''}`,
      onInput: (v) => { L.corner = Math.abs(v - CORNER.instax) < 0.0004 ? null : v; linkLayouts(); },
      onDone: changed,
    });
    const note = Object.assign(document.createElement('p'), { className: 'pn-note', textContent: 'Drag the lines on the print: sides for width, top for the top border, bottom for the height.' });
    panel.append(shapes, tools, corner, note);
  }

  function framePanel() {
    const p = print();
    const sw = row('pn-row pn-swatches');
    for (const c of FRAME_COLORS) {
      const b = document.createElement('button');
      b.className = 'pn-swatch';
      b.style.background = c.fill;
      b.title = c.label;
      b.setAttribute('aria-label', c.label);
      b.setAttribute('aria-pressed', String(p.color === c.id));
      b.addEventListener('click', () => { p.color = c.id; changed(); buildPanel(); });
      sw.append(b);
    }
    panel.append(sw);
    if (app.count() === 2) {
      const r = row('pn-row');
      const other = prints()[1 - idx];
      r.append(chip('', () => { other.color = p.color; changed(); app.toast('Both prints use this frame'); buildPanel(); }, { pressed: other.color === p.color, html: '<span>Use on both prints</span>' }));
      panel.append(r);
    }
  }

  function photoPanel() {
    const p = print(), ph = photo();
    const r = row('pn-row pn-scroll');
    if (!ph) {
      r.append(chip('', () => app.pickFiles(idx), { html: `${svg('plus')}<span>Add photo</span>` }));
      panel.append(r);
      return;
    }
    const turn = (deg) => () => { p.crop.rot = (p.crop.rot + deg + 360) % 360; p.crop.cx = 0.5; p.crop.cy = 0.5; changed(); buildPanel(); };
    r.append(
      chip('', () => app.pickFiles(idx), { html: `${svg('replace')}<span>Replace</span>` }),
      chip('', turn(-90), { html: `${svg('rotl')}<span>Turn left</span>` }),
      chip('', turn(90), { html: `${svg('rotr')}<span>Turn right</span>` }),
      chip('', turn(180), { html: `${svg('flip')}<span>Flip</span>` }),
      chip('', () => { Object.assign(p.crop, { zoom: 1, cx: 0.5, cy: 0.5 }); changed(); buildPanel(); }, { html: `${svg('reset')}<span>Fit</span>` }),
      chip('', () => { app.removePhoto(idx); tool = null; changed(); refresh(); }, { html: `${svg('trash')}<span>Remove</span>` }),
    );
    const { dpi, crop } = app.photoDpi(idx);
    const q = app.quality(dpi);
    const note = Object.assign(document.createElement('p'), { className: 'pn-note' });
    note.innerHTML = `<span class="q ${q.cls}">${q.label}</span> · ${Math.round(dpi)} dpi · using ${Math.round(crop.w)} × ${Math.round(crop.h)} of ${ph.width} × ${ph.height} px. Pinch or drag the photo to crop it.`;
    panel.append(r, note);
  }

  function fontPanel(el) {
    const r = row('pn-row pn-scroll pn-fonts');
    fillFonts(r, el, () => { changed(); });
    panel.append(r);
    requestAnimationFrame(() => r.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }
  function fillFonts(r, el, onPick) {
    loadFonts(ALL_FONTS).then(() => { draw(); });
    r.replaceChildren(...ALL_FONTS.map((f) => {
      const b = document.createElement('button');
      b.className = 'font-pill';
      b.style.fontFamily = fontCss(f);
      b.textContent = f;
      b.setAttribute('aria-pressed', String(el.font === f));
      b.addEventListener('click', () => {
        el.font = f;
        r.querySelectorAll('.font-pill').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        loadFonts([f]).then(draw);
        onPick();
      });
      return b;
    }));
  }
  function colorPanel(el) {
    const r = row('pn-row pn-scroll pn-swatches');
    fillColors(r, el, () => { changed(); });
    panel.append(r);
  }
  function fillColors(r, el, onPick) {
    const isSticker = el.type === 'sticker';
    const list = isSticker ? [null, ...TEXT_COLORS.filter((c) => c !== 'auto')] : TEXT_COLORS;
    const ink = () => (isSticker ? el.color : el.color);
    const btns = list.map((c) => {
      const b = document.createElement('button');
      b.className = 'pn-swatch';
      const auto = c === 'auto' || c == null;
      if (auto) { b.classList.add('auto'); b.textContent = 'A'; b.title = isSticker ? 'Original' : 'Auto (frame ink)'; }
      else b.style.background = c;
      b.setAttribute('aria-label', b.title || c);
      b.setAttribute('aria-pressed', String(ink() === c));
      b.addEventListener('click', () => {
        el.color = c;
        r.querySelectorAll('.pn-swatch').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        onPick();
      });
      return b;
    });
    // Any colour: the system colour picker.
    const pick = document.createElement('label');
    pick.className = 'pn-swatch pn-custom';
    pick.title = 'Any colour';
    pick.innerHTML = '<input type="color" aria-label="Any colour">';
    const input = pick.querySelector('input');
    input.value = /^#/.test(el.color || '') ? el.color : '#E0662F';
    input.addEventListener('input', () => { el.color = input.value; draw(); te.root.hidden || styleTextarea(); });
    input.addEventListener('change', () => onPick());
    r.replaceChildren(...btns, pick);
  }
  function sizePanel(el) {
    const isText = el.type === 'text' || el.type === 'date';
    panel.append(slider(isText ? 'Text size' : 'Size', {
      min: isText ? 1.5 : 4, max: isText ? 30 : 80, step: 0.1, value: el.size,
      fmt: (v) => `${v.toFixed(1)} mm`,
      onInput: (v) => { el.size = v; },
      onDone: changed,
    }));
  }

  /* ---------------- typing text ---------------- */
  function openText(el, isNew = false) {
    editing = el;
    editing.isNew = isNew;
    tool = null;
    buildPanel();
    te.root.hidden = false;
    root.classList.add('typing');
    te.input.value = el.text;
    te.size.value = el.size;
    fillFonts(te.fonts, el, styleTextarea);
    fillColors(te.colors, el, styleTextarea);
    te.fonts.hidden = false; te.colors.hidden = true;
    styleTextarea();
    draw();
    fitToKeyboard();
    te.input.focus({ preventScroll: true });
    te.input.setSelectionRange(te.input.value.length, te.input.value.length);
  }
  function styleTextarea() {
    const el = editing;
    if (!el) return;
    const ink = el.color === 'auto' ? '#FFFFFF' : el.color;
    const pxSize = clamp(el.size * view.k, 18, 64);
    Object.assign(te.input.style, {
      fontFamily: fontCss(el.font), fontSize: `${pxSize}px`, textAlign: el.align,
      color: el.bg === 'none' ? ink : contrastInk(ink),
      background: el.bg === 'solid' ? ink : el.bg === 'soft' ? `${ink}73` : 'transparent',
    });
    $('#teAlign').innerHTML = svg(`align-${el.align}`);
    $('#teBg').innerHTML = `<span class="te-a ${el.bg}">A</span>`;
    $('#teColorBtn i').style.background = ink;
    autosize();
  }
  function autosize() {
    te.input.style.height = 'auto';
    te.input.style.height = `${te.input.scrollHeight}px`;
  }
  te.input.addEventListener('input', () => { if (editing) { editing.text = te.input.value; autosize(); } });
  te.size.addEventListener('input', () => { if (editing) { editing.size = Number(te.size.value); styleTextarea(); } });
  $('#teAlign').addEventListener('click', () => { if (!editing) return; editing.align = TEXT_ALIGNS[(TEXT_ALIGNS.indexOf(editing.align) + 1) % 3]; styleTextarea(); te.input.focus(); });
  $('#teBg').addEventListener('click', () => { if (!editing) return; editing.bg = TEXT_BGS[(TEXT_BGS.indexOf(editing.bg) + 1) % 3]; styleTextarea(); te.input.focus(); });
  $('#teColorBtn').addEventListener('click', () => { te.colors.hidden = !te.colors.hidden; te.fonts.hidden = !te.colors.hidden; te.input.focus(); });
  $('#teDone').addEventListener('click', () => finishText());
  te.root.addEventListener('pointerdown', (e) => { if (e.target === te.root || e.target.classList.contains('te-body')) { e.preventDefault(); finishText(); } });
  te.input.addEventListener('keydown', (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishText(); } });
  function finishText() {
    const el = editing;
    if (!el) return;
    editing = null;
    te.root.hidden = true;
    root.classList.remove('typing');
    te.input.blur();
    delete el.isNew;
    el.text = el.text.replace(/\s+$/, '');
    if (!el.text.trim()) {
      // Done on empty text removes it, like a story.
      print().elements = print().elements.filter((e) => e !== el);
      if (selId === el.id) selId = null;
    } else selId = el.id;
    changed();
    buildDeck(); buildPanel();
    loadFonts(app.fontsInUse()).then(draw);
  }
  // Keep the text tools above the on-screen keyboard.
  function fitToKeyboard() {
    const vv = window.visualViewport;
    if (!vv || te.root.hidden) return;
    Object.assign(te.root.style, { top: `${vv.offsetTop}px`, height: `${vv.height}px` });
  }
  window.visualViewport?.addEventListener('resize', fitToKeyboard);
  window.visualViewport?.addEventListener('scroll', fitToKeyboard);

  /* ---------------- stickers tray ---------------- */
  const tray = $('#stickerDlg');
  let trayBuilt = false;
  function openStickers() {
    if (!trayBuilt) buildTray();
    tray.showModal();
  }
  function buildTray() {
    trayBuilt = true;
    const special = $('#traySpecial');
    const mk = (html, label, onClick) => {
      const b = document.createElement('button');
      b.className = 'tray-big';
      b.innerHTML = `${html}<span>${label}</span>`;
      b.addEventListener('click', onClick);
      return b;
    };
    special.replaceChildren(
      mk(svg('date'), 'Date', () => { tray.close(); addElement(dateEl(chinSpot(card(), 'right'))); }),
      mk(svg('date'), 'Date & time', () => { tray.close(); addElement(dateEl({ ...chinSpot(card(), 'right'), fmt: { show: 'datetime' } })); }),
      mk(svg('text'), 'Text', () => { tray.close(); addText(); }),
      mk(svg('picture'), 'Picture / GIF', () => $('#stickerFile').click()),
    );
    $('#stickerGrid').replaceChildren(...STICKERS.map((s) => {
      const b = document.createElement('button');
      b.className = 'tray-sticker';
      b.title = s.label;
      b.setAttribute('aria-label', s.label);
      b.innerHTML = stickerSvg(s);
      b.addEventListener('click', () => { tray.close(); addElement(stickerEl(s.id, { ...centreSpot(), size: Math.min(16, card().win.h * 0.3) })); });
      return b;
    }));
    $('#emojiGroups').replaceChildren(...EMOJI.flatMap((grp) => {
      const h = Object.assign(document.createElement('h4'), { className: 'emoji-label', textContent: grp.label });
      const wrap = Object.assign(document.createElement('div'), { className: 'emoji-grid' });
      wrap.append(...grp.list.map((ch) => {
        const b = document.createElement('button');
        b.textContent = ch;
        b.addEventListener('click', () => { tray.close(); addEmoji(ch); });
        return b;
      }));
      return [h, wrap];
    }));
  }
  function addEmoji(ch) { addElement(emojiEl(ch, { ...centreSpot(), size: Math.min(14, card().win.h * 0.25) })); }
  $('#emojiForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#emojiInput').value.trim();
    if (!v) return;
    $('#emojiInput').value = '';
    tray.close();
    addEmoji([...v].slice(0, 4).join(''));
  });
  $('#stickerFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    tray.close();
    try {
      const { id, ratio } = await app.addAsset(file);
      addElement(imageEl(id, ratio, { ...centreSpot(), size: Math.min(28, card().win.h * 0.45) }));
    } catch { app.toast('Couldn’t open that picture.'); }
  });

  /* ---------------- keyboard ---------------- */
  window.addEventListener('keydown', (e) => {
    if (!open || editing || document.querySelector('dialog[open]')) return;
    if (e.target.closest?.('input, textarea')) return;
    const el = selected();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey ? app.redo() : app.undo()) afterHistory(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); if (app.redo()) afterHistory(); return; }
    if (e.key === 'Escape') { if (el || tool) { selId = null; tool = null; buildDeck(); buildPanel(); fit(); draw(); } else closeEditor(); return; }
    if (!el) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeElement(el); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(el); return; }
    if (e.key === 'Enter') { e.preventDefault(); activate(el); return; }
    const step = (e.shiftKey ? 2 : 0.5);
    const c = card();
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { e.preventDefault(); el.x += mv[0] / c.w; el.y += mv[1] / c.h; draw(); clearTimeout(stage._keyT); stage._keyT = setTimeout(changed, 400); }
  });

  let hintT;
  function flashHint(text) {
    hint.textContent = text;
    hint.classList.add('show');
    clearTimeout(hintT);
    hintT = setTimeout(() => hint.classList.remove('show'), 3800);
  }

  return {
    open: openEditor, close: closeEditor, refresh, isOpen: () => open, index: () => idx,
  };
}
