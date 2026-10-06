/* צלחת — core: state, helpers, router and the shared bottom sheets
   (food, confirm list, picker, manual food, quick kcal, barcode, entry edit,
   planning basket). The screens themselves live in screens.js. */

const $ = (s, el = document) => el.querySelector(s);
const VIEW = $('#view');
const C = window.Calc;
const S = window.Search;

const APP = {
  profile: null, ui: {}, device: null,
  lib: [], libById: new Map(), recipes: [], meals: [],
  moh: null, mohP: null,
  basket: [], planMode: false,
  results: [], draft: null,
};
window.APP = APP;   // cloud.js reads it; top-level const is not a window property

/* ================= helpers ================= */
const DAY_FULL = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const today = () => C.ymd();
const nowSlot = () => C.slotForHour(new Date().getHours());
const fmt = C.fmt, fmt1 = C.fmt1;
function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function icon(name, cls = '') { return `<svg class="ic ${cls}"><use href="#i-${name}"/></svg>`; }
function dot(k100, liquid) { return `<span class="dot ${C.density(k100, liquid)}"></span>`; }
function num(v) { const x = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(x) ? x : null; }
function vibrate(ms = 12) { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) {} }
function online() { return navigator.onLine !== false; }
function reducedMotion() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
/* One spring, in Apple's two terms: damping (1 = settles without overshoot,
   lower = a little bounce) and response (seconds to get there; not a fixed
   duration). s = {x, v, raf}: it always starts from where the thing is and
   how fast it is moving, so motion can be grabbed and turned around mid-way. */
function spring(s, to, { damping = 1, response = 0.35, velocity, onUpdate, onDone } = {}) {
  cancelAnimationFrame(s.raf);
  s.to = to;
  if (velocity != null) s.v = velocity;
  const k = (2 * Math.PI / response) ** 2, c = 4 * Math.PI * damping / response;
  let last = performance.now();
  const step = (now) => {
    let dt = Math.min(0.064, Math.max(0, now - last) / 1000);
    last = now;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      s.v += (-k * (s.x - s.to) - c * s.v) * h;
      s.x += s.v * h;
      dt -= h;
    }
    if (Math.abs(s.x - s.to) < 0.5 && Math.abs(s.v) < 10) {
      s.x = s.to; s.v = 0; s.raf = 0;
      onUpdate(s.x);
      if (onDone) onDone();
      return;
    }
    onUpdate(s.x);
    s.raf = requestAnimationFrame(step);
  };
  s.raf = requestAnimationFrame(step);
}
/* iOS only applies :active (the press feedback) when a touch listener exists. */
document.addEventListener('touchstart', () => {}, { passive: true });
/* The line under the title appears only once the page is scrolled under it. */
window.addEventListener('scroll', () => document.body.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
function fmtDateShort(d) { return d.slice(8, 10) + '.' + d.slice(5, 7); }
function fmtDateLong(d) { return 'יום ' + DAY_FULL[C.parseYmd(d).getDay()] + ', ' + fmtDateShort(d); }
function relDay(d) {
  const diff = C.diffDays(d, today());
  return diff === 0 ? 'היום' : diff === 1 ? 'אתמול' : fmtDateLong(d);
}
const PLURAL = { 'ביצה': 'ביצים' };
/* "2 ביצים" rather than "2 × ביצה" where Hebrew has a plain plural. */
function countLabel(name, c) {
  if (c === 1) return name === 'ביצה' ? 'ביצה אחת' : name;
  return PLURAL[name] && Number.isInteger(c) ? `${fmt(c)} ${PLURAL[name]}` : `${c === 0.5 ? 'חצי ' : fmt1(c) + ' × '}${name}`;
}
function amountLabel(e) {
  if (e.quick) return 'הוספה מהירה';
  if (e.portion && e.portion.name && e.per100 && e.per100.once) return countLabel(e.portion.name, e.portion.count);
  if (e.portion && e.portion.name) {
    const c = e.portion.count;
    const cnt = c === 1 ? '' : c === 0.5 ? 'חצי ' : fmt1(c) + ' × ';
    return `${cnt}${e.portion.name} · ${fmt(e.grams)} ${e.liquid ? 'מ״ל' : 'ג׳'}`;
  }
  return `${fmt(e.grams)} ${e.liquid ? 'מ״ל' : 'גרם'}`;
}
function setTitle(t) { $('#title').textContent = t; document.title = t === 'צלחת' ? 'צלחת' : t + ' · צלחת'; }
/* A re-render after an edit (route(true)) keeps the screen still; only real
   navigation plays the entry fade. */
let quietView = false;
function setView(html) { VIEW.innerHTML = `<div class="vwrap${quietView ? ' still' : ''}">${html}</div>`; }
function setTopAction(iconName, label, fn) {
  const b = $('#topaction');
  if (!iconName) { b.hidden = true; b.onclick = null; return; }
  b.innerHTML = icon(iconName); b.setAttribute('aria-label', label); b.hidden = false; b.onclick = fn;
}
function goHome() {
  if (parseHash().parts.length) go('#/'); else rerender();
}
function goBack() {
  if (history.length > 1) history.back(); else location.hash = '#/';
}

/* ---------------- toast (with optional undo) ---------------- */
let toastTimer = null;
function toast(msg, action) {
  $('#toastmsg').textContent = msg;
  const b = $('#toastbtn');
  if (action) {
    b.textContent = action.label; b.hidden = false;
    b.onclick = () => { hideToast(); action.fn(); };
  } else { b.hidden = true; b.onclick = null; }
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 5000 : 2600);
}
function hideToast() { if (window.Tour && Tour.holdsToast()) return; $('#toast').classList.remove('show'); }

/* ---------------- day-close celebration ----------------
   Two party horns, a short confetti fall, the evening's title and note, and
   one button. No sound (Daniel's call). Static under reduced motion. */
const HORN = `<svg viewBox="0 0 64 64" aria-hidden="true"><g class="blow">
  <path d="M6 58 L30 26 L40 36 Z" fill="#e9b949"/>
  <path d="M18 42 L23 47 M24 34 L31.5 41.5" stroke="#1f5a48" stroke-width="3.2" stroke-linecap="round"/>
  <ellipse cx="35" cy="31" rx="3.2" ry="7.4" transform="rotate(45 35 31)" fill="#c9941a"/></g>
  <g class="blast" stroke="#2f8068" stroke-width="3" stroke-linecap="round">
  <path d="M43 23 L51 15"/><path d="M47 31 L57 29"/><path d="M36 19 L37 9"/></g></svg>`;
function celebrate({ title, note, badge }) {
  closeCelebrate(true);
  const colors = ['#1f5a48', '#2f8068', '#e9b949', '#b98a14', '#8cc9a8', '#e08a4a'];
  let bits = '';
  for (let i = 0; i < 60; i++) {
    const w = 6 + (i * 7) % 7, h = i % 3 ? w * 1.8 : w;
    bits += `<i style="left:${(i * 37) % 100}%;width:${w}px;height:${h}px;background:${colors[i % colors.length]};`
      + `animation-delay:${((i * 13) % 20) / 20}s;animation-duration:${2.4 + ((i * 11) % 14) / 10}s;--r:${(i * 97) % 720 - 360}deg;${i % 4 === 0 ? 'border-radius:50%;' : ''}"></i>`;
  }
  const el = document.createElement('div');
  el.id = 'party';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', title || 'היום נסגר');
  el.innerHTML = `<div class="confetti">${bits}</div>
    <div class="pcard">
      <div class="horns"><span class="horn l">${HORN}</span><span class="horn r">${HORN}</span></div>
      ${badge ? `<div class="pill gold pbadge">${icon('trophy', 'sm')}${esc(badge)}</div>` : ''}
      <h2>${esc(title || 'עוד יום יפה מאחורייך')}</h2>
      <p>${esc(note || '')}</p>
      <button class="btn block goodbtn" data-act="night">${icon('moon')}לילה טוב</button>
    </div>`;
  el.onclick = (ev) => { if (ev.target.closest('[data-act="night"]') || ev.target === el) closeCelebrate(); };
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  window.addEventListener('hashchange', closeCelebrate, { once: true });
  setTimeout(() => { const b = el.querySelector('[data-act="night"]'); if (b) b.focus({ preventScroll: true }); }, 50);
}
/* Fades out the way it faded in; now=true removes it at once (a new one is
   about to take its place). */
function closeCelebrate(now) {
  const el = $('#party');
  if (!el) return;
  if (now === true) { el.remove(); return; }
  el.classList.remove('show');
  el.style.pointerEvents = 'none';
  setTimeout(() => el.remove(), 260);
}

/* ---------------- bottom sheet ----------------
   Opening pushes one history entry so the Android back button closes the
   sheet instead of leaving the screen. Chained sheets replace content. */
let modalPushed = false, ignorePop = false, modalOnClose = null;
let backDone = null, backResolve = null;
/* Navigate after a sheet closed: its history.back() is asynchronous, and a
   hash set before it lands would be undone by it. */
function go(hash) {
  if (backDone) backDone.then(() => { location.hash = hash; });
  else location.hash = hash;
}
/* The sheet moves on a spring (sheet.x = px below its resting place, 0 = open).
   Closing removes .show at once, so the app and tour.js see it closed, and
   .closing keeps it on screen while it slides away; the content is cleared
   only when it is out of sight. Opening again mid-slide turns it around from
   wherever it is. Under reduced motion it fades instead of sliding. */
const sheet = { x: 0, v: 0, raf: 0, h: 0, fadeT: 0 };
function sheetPaint(y) {
  const p = $('#modalbody');
  p.style.transform = y ? `translateY(${y.toFixed(1)}px)` : '';
  $('#modal').style.setProperty('--dim', Math.max(0, Math.min(1, 1 - y / (sheet.h || 1))).toFixed(3));
}
function sheetTo(y, opts = {}) {
  const m = $('#modal');
  clearTimeout(sheet.fadeT);
  if (reducedMotion()) {
    cancelAnimationFrame(sheet.raf); sheet.raf = 0; sheet.x = y; sheet.v = 0;
    if (!y) { $('#modalbody').style.transform = ''; m.style.setProperty('--dim', '1'); }
    m.style.transition = 'opacity .2s ease';
    m.style.opacity = y ? '0' : '1';
    sheet.fadeT = setTimeout(() => { m.style.transition = ''; if (opts.onDone) opts.onDone(); }, y ? 200 : 210);
    return;
  }
  m.style.transition = ''; m.style.opacity = '';
  spring(sheet, y, { ...opts, onUpdate: sheetPaint });
}
function sheetGone() {
  const m = $('#modal'), body = $('#modalbody');
  if (!m.classList.contains('closing')) return;
  m.classList.remove('closing');
  body.innerHTML = ''; body.inert = false; body.style.transform = '';
  m.style.removeProperty('--dim'); m.style.opacity = '';
}
function modalOpen() { return $('#modal').classList.contains('show'); }
function openModal(html, onClose) {
  const m = $('#modal');
  const body = $('#modalbody');
  body.innerHTML = '<div class="grab"></div>' + html;
  body.onclick = null; body.oninput = null; body.onchange = null;
  body.scrollTop = 0;
  if (!modalOpen()) {
    const sliding = m.classList.contains('closing');
    m.classList.remove('closing'); body.inert = false;
    m.classList.add('show');
    if (!sliding) {                       // from nothing: start just below the screen edge
      sheet.h = body.offsetHeight; sheet.x = sheet.h; sheet.v = 0;
      if (reducedMotion()) { m.style.opacity = '0'; m.style.setProperty('--dim', '1'); void m.offsetWidth; }
      else sheetPaint(sheet.x);
    }
    sheetTo(0, { damping: 1, response: 0.35 });
    history.pushState({ sheet: 1 }, '');
    modalPushed = true;
  }
  modalOnClose = onClose || null;
  return body;
}
function closeModal(silent) {
  if (!modalOpen()) return;
  const m = $('#modal'), body = $('#modalbody');
  m.classList.remove('show'); m.classList.add('closing');
  stopCamera();
  body.inert = true; body.onclick = null; body.oninput = null; body.onchange = null;
  body.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));   // the next screen owns its ids
  sheet.h = Math.max(body.offsetHeight, sheet.x + 1);
  sheetTo(sheet.h + 24, { damping: 1, response: 0.3, onDone: sheetGone });   // keeps a flick's speed (sheet.v)
  const f = modalOnClose; modalOnClose = null;
  if (modalPushed && !silent) {
    ignorePop = true;
    backDone = new Promise((res) => { backResolve = res; });
    setTimeout(() => { if (backResolve) { ignorePop = false; backResolve(); backResolve = null; backDone = null; } }, 400);
    history.back();
  }
  modalPushed = false;
  if (f) f();
  if (APP.reloadPending) { const go = APP.reloadPending; APP.reloadPending = null; go(); }
}
window.addEventListener('popstate', () => {
  if (ignorePop) {
    ignorePop = false;
    if (backResolve) { const r = backResolve; backResolve = null; backDone = null; r(); }
    return;
  }
  if (modalOpen()) { modalPushed = false; closeModal(true); }
});

/* Pull the sheet down to close it. It starts from the grab bar, or from
   anywhere once the sheet is scrolled to its top; pulling up, sideways (chips)
   or inside a field stays a normal scroll or edit. The first downward move is
   claimed right away (otherwise the browser starts its own scroll and keeps
   it), and the sheet follows after 10px, glued to the finger. On release the
   finger's speed is projected forward, the way a flick keeps going: past
   about a third of the sheet it closes, otherwise it springs back, at the
   finger's speed in both cases. Touch events give the implicit capture we
   need (the touch stays with the sheet even when the finger leaves it). */
(function sheetDrag() {
  const p = $('#modalbody');
  const project = (v, rate = 0.995) => (v / 1000) * rate / (1 - rate);
  const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
  let d = null;
  p.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { end(); return; }   // a second finger ends the pull cleanly
    d = null;
    if (!modalOpen()) return;
    if (window.Tour && Tour.active()) return;   // a guided tour is pointing at a button in this sheet
    const grab = !!e.target.closest('.grab');
    if (!grab && e.target.closest('input,textarea,select,video')) return;
    const t = e.touches[0];
    d = { x0: t.clientX, y0: t.clientY, grab, live: false, claimed: false, hist: [] };
  }, { passive: true });
  p.addEventListener('touchmove', (e) => {
    if (!d) return;
    if (e.touches.length !== 1 || !modalOpen()) { end(); return; }   // second finger, or the app closed it
    const t = e.touches[0];
    const dx = t.clientX - d.x0, dy = t.clientY - d.y0;
    if (!d.claimed) {
      if (!dx && !dy) return;
      // only a downward pull at the top belongs to the sheet
      if (Math.abs(dx) > Math.abs(dy) || dy < 0 || (!d.grab && p.scrollTop > 0)) { d = null; return; }
      d.claimed = true;
    }
    if (e.cancelable) e.preventDefault();
    if (!d.live) {
      if (dy < 10) return;
      d.live = true; d.y0 = t.clientY;
      cancelAnimationFrame(sheet.raf); sheet.raf = 0; sheet.v = 0;
      sheet.h = p.offsetHeight; d.from = sheet.x;
      p.classList.add('dragging');
    }
    let y = d.from + (t.clientY - d.y0);
    if (y < 0) y = -rubberband(-y, sheet.h);
    sheet.x = y; sheetPaint(y);
    d.hist.push([e.timeStamp, t.clientY]);
    if (d.hist.length > 8) d.hist.shift();
  }, { passive: false });
  function end() {
    if (!d) return;
    const g = d; d = null;
    if (!g.live) return;
    p.classList.remove('dragging');
    // speed over the last ~100ms of the pull, in px/s
    let v = 0;
    const last = g.hist[g.hist.length - 1];
    const first = last && (g.hist.find((h) => last[0] - h[0] <= 100) || last);
    if (last && last[0] > first[0]) v = (last[1] - first[1]) / ((last[0] - first[0]) / 1000);
    sheet.v = v;
    const land = sheet.x + project(v);
    if (!modalOpen()) sheetTo(sheet.h + 24, { onDone: sheetGone });   // closed by the app mid-pull: finish leaving
    else if (v > -100 && land > Math.min(sheet.h * 0.35, 200)) closeModal();   // continues at sheet.v
    else sheetTo(0, { damping: 0.8, response: 0.35, velocity: v });
  }
  p.addEventListener('touchend', end);
  p.addEventListener('touchcancel', end);
})();

/* ================= settings ================= */
async function saveUi(patch) { APP.ui = { ...APP.ui, ...patch }; await DB.saveSetting('ui', APP.ui); }
async function saveProfile(patch) { APP.profile = { ...APP.profile, ...patch }; await DB.saveSetting('profile', APP.profile); }
function applyTextSize() {
  const size = { m: '18px', l: '20px', xl: '23px' }[(APP.profile && APP.profile.textSize) || 'm'] || '18px';
  document.documentElement.style.setProperty('--fs', size);
}

/* ================= food library ================= */
async function loadLibrary() {
  APP.lib = await DB.all('foods');
  APP.libById = new Map(APP.lib.map((f) => [f.id, f]));
  APP.recipes = await DB.all('recipes');
  APP.meals = await DB.all('meals');
}
/* Foods the app keeps in her library. An omelette is counted by eggs, and the
   spray of olive oil is counted once per pan (per100.once): the ministry's
   "ביצה או חביתה מטוגנת בשמן זית" has only small/large portions and oil that
   grows with the portion, which is not how she cooks. Egg values: ministry 1573
   (fried without oil), 50 g an egg. Spray: about 1 g oil. */
const BUILTIN_FOODS = [{
  builtin: 'omelet-spray', name: 'חביתה עם תרסיס שמן זית',
  per100: { k: 162, p: 14.2, f: 10.8, c: 0.8, once: { k: 9, p: 0, f: 1, c: 0 } },
  portions: [{ name: 'ביצה', grams: 50 }], replaces: [1570],
}];
const REPLACED_MOH = new Set(BUILTIN_FOODS.flatMap((b) => b.replaces));
/* Adds missing built-in foods; a ministry food they replace is hidden, and its
   history (use counts, favourite) and her saved meals move to the new food. */
async function ensureBuiltins() {
  for (const b of BUILTIN_FOODS) {
    let food = APP.lib.find((f) => f.builtin === b.builtin);
    const old = APP.lib.filter((f) => !f.hidden && b.replaces.includes(f.mohCode));
    if (food && !old.length) continue;
    const unit = b.portions[0];
    const units = (grams) => Math.max(1, Math.round((grams || 0) / 60));
    if (!food) {
      const o = [...old].sort((x, y) => (y.useCount || 0) - (x.useCount || 0))[0];
      const slotCounts = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
      for (const x of old) for (const s of C.SLOTS) slotCounts[s] += (x.slotCounts && x.slotCounts[s]) || 0;
      const count = o && o.lastGrams ? units(o.lastGrams) : 1;
      food = newFood({
        name: b.name, per100: { ...b.per100, once: { ...b.per100.once } }, portions: b.portions.map((p) => ({ ...p })),
        source: 'builtin', builtin: b.builtin, slotCounts,
        useCount: old.reduce((a, x) => a + (x.useCount || 0), 0), fav: old.some((x) => x.fav),
        lastUsed: Math.max(0, ...old.map((x) => x.lastUsed || 0)),
        lastGrams: unit.grams * count, lastPortion: { name: unit.name, grams: unit.grams, count },
      });
      await putFood(food);
    }
    const oldIds = new Set(old.map((x) => x.id));
    for (const m of APP.meals) {
      if (!m.items.some((it) => oldIds.has(it.foodId))) continue;
      m.items = m.items.map((it) => {
        if (!oldIds.has(it.foodId)) return it;
        const count = units(it.grams);
        return { foodId: food.id, name: food.name, grams: unit.grams * count, portion: { name: unit.name, grams: unit.grams, count } };
      });
      await DB.put('meals', m);
    }
    for (const x of old) { x.hidden = true; await putFood(x); }
  }
}
function libFoods() { return APP.lib.filter((f) => !f.hidden); }
function libViews() { return libFoods().map(S.viewLib); }
function loadMoh() {
  if (APP.moh) return Promise.resolve(APP.moh);
  if (!APP.mohP) {
    APP.mohP = fetch('foods.json?v=' + CFG.VERSION)
      .then((r) => { if (!r.ok) throw new Error('המאגר לא נטען'); return r.json(); })
      .then((d) => (APP.moh = d.foods.filter((m) => !REPLACED_MOH.has(m.i))))
      .catch((e) => { APP.mohP = null; throw e; });
  }
  return APP.mohP;
}
function newFood(fields) {
  return {
    id: uid('f'), name: '', per100: { k: 0, p: 0, f: 0, c: 0 }, portions: [], liquid: false,
    source: 'manual', mohCode: null, barcode: null, brand: null, recipeId: null,
    fav: false, useCount: 0, slotCounts: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
    lastUsed: 0, lastGrams: null, lastPortion: null, createdAt: Date.now(), ...fields,
  };
}
async function putFood(f) {
  await DB.put('foods', f);
  if (!APP.libById.has(f.id)) APP.lib.push(f);
  APP.libById.set(f.id, f);
  return f;
}
/* Turn any food view into a food in her library (reusing an existing one). */
async function ensureLibFood(view) {
  if (view.src === 'lib') return view.ref;
  if (view.mohCode) {
    const ex = APP.lib.find((f) => f.mohCode === view.mohCode && f.source === 'moh');
    if (ex) { if (ex.hidden) { ex.hidden = false; await putFood(ex); } return ex; }
  }
  if (view.barcode) {
    const ex = APP.lib.find((f) => f.barcode === view.barcode);
    if (ex) return ex;
  }
  return putFood(newFood({
    name: view.name, per100: { ...view.per100 }, portions: view.portions || [], liquid: !!view.liquid,
    source: view.srcType || (view.mohCode ? 'moh' : 'manual'), mohCode: view.mohCode || null,
    barcode: view.barcode || null, brand: view.brand || null,
  }));
}

/* ================= logging ================= */
function makeEntry(food, { grams, portion, slot, date, mealId, mealName }) {
  const n = C.nutrition(food.per100, grams);
  return {
    id: uid('e'), date: date || today(), time: C.hhmm(), slot: slot || nowSlot(),
    foodId: food.id, name: food.name, grams: Math.round(grams),
    portion: portion ? { name: portion.name, count: portion.count, grams: portion.grams } : null,
    k: n.k, p: n.p, f: n.f, c: n.c, per100: { ...food.per100 }, liquid: !!food.liquid,
    quick: false, mealId: mealId || null, mealName: mealName || null,
  };
}
async function bumpFood(food, slot, grams, portion) {
  food.useCount = (food.useCount || 0) + 1;
  food.slotCounts = food.slotCounts || { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
  food.slotCounts[slot] = (food.slotCounts[slot] || 0) + 1;
  food.lastUsed = Date.now();
  food.lastGrams = Math.round(grams);
  food.lastPortion = portion ? { name: portion.name, grams: portion.grams, count: portion.count } : null;
  await putFood(food);
}
/* Entries that were merged into instead of created, with their state before
   the merge, so "ביטול" puts them back rather than deleting them. */
const MERGED = new WeakMap();
async function logFoods(list, { slot, date, mealId, mealName } = {}) {
  const entries = [];
  const d = date || today(), s = slot || nowSlot();
  // a food with a once-per-pan part (omelette) is one pan per meal: more eggs
  // go into the entry already there, so the oil is not counted again
  const pans = list.some((it) => it.food.per100 && it.food.per100.once)
    ? (await DB.range('entries', 'date', d, d)).filter((e) => e.slot === s && !e.quick) : [];
  for (const it of list) {
    const pan = it.food.per100 && it.food.per100.once && [...entries, ...pans].find((e) => e.foodId === it.food.id);
    if (pan) {
      if (!MERGED.has(pan) && !entries.includes(pan)) MERGED.set(pan, { ...pan, portion: pan.portion && { ...pan.portion } });
      const grams = pan.grams + Math.round(it.grams);
      const portion = pan.portion && it.portion && pan.portion.name === it.portion.name
        ? { ...pan.portion, count: pan.portion.count + it.portion.count } : null;
      const n = C.nutrition(it.food.per100, grams);
      Object.assign(pan, { grams, portion, k: n.k, p: n.p, f: n.f, c: n.c, per100: { ...it.food.per100 } });
      if (!entries.includes(pan)) entries.push(pan);
      continue;
    }
    entries.push(makeEntry(it.food, { grams: it.grams, portion: it.portion, slot, date, mealId, mealName }));
  }
  await DB.putMany('entries', entries);
  for (const it of list) await bumpFood(it.food, slot || nowSlot(), it.grams, it.portion);
  afterDataChange(date || today());
  return entries;
}
async function undoEntries(entries) {
  await DB.delMany('entries', entries.filter((e) => !MERGED.has(e)).map((e) => e.id));
  const restore = entries.filter((e) => MERGED.has(e)).map((e) => MERGED.get(e));
  if (restore.length) await DB.putMany('entries', restore);
  for (const e of entries) {
    const f = APP.libById.get(e.foodId);
    if (f) {
      f.useCount = Math.max(0, (f.useCount || 1) - 1);
      if (f.slotCounts && f.slotCounts[e.slot]) f.slotCounts[e.slot] -= 1;
      await putFood(f);
    }
  }
  afterDataChange(entries[0] && entries[0].date);
  rerender();
}
function afterDataChange(date) {
  APP.lastChange = Date.now();
  if (window.Cloud && Cloud.enabled()) { Cloud.heartbeat().catch(() => {}); Cloud.save(); }
}
async function copyEntries(src, { date, slot }) {
  const copies = src.map((e) => ({ ...e, id: uid('e'), date: date || today(), time: C.hhmm(), slot: slot || e.slot }));
  await DB.putMany('entries', copies);
  for (const e of copies) {
    const f = APP.libById.get(e.foodId);
    if (f) { f.lastUsed = Date.now(); f.useCount = (f.useCount || 0) + 1; await putFood(f); }
  }
  afterDataChange(date);
  return copies;
}

/* ================= router ================= */
const TOP_ROUTES = new Set(['', 'recipes', 'add', 'progress', 'more']);
const NAV_OF = { '': 'today', recipes: 'recipes', recipe: 'recipes', meal: 'recipes', add: 'add', progress: 'progress',
  more: 'more', history: 'more', insights: 'more', settings: 'more', backup: 'more', day: 'more', food: 'recipes',
  guide: 'more', requests: 'more' };
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { parts: path.split('/').filter(Boolean), params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
let routing = 0;
async function route(keepScroll) {
  closeModal(true);
  const my = ++routing;
  APP.rendering = true;              // tour.js waits for the screen before deciding a button is missing
  const { parts, params } = parseHash();
  let r = parts[0] || '';
  if (!APP.profile || !APP.ui.onboarded) {
    if (r !== 'setup' && r !== 'backup') { location.replace('#/setup'); return; }
  }
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === NAV_OF[r]));
  $('#backbtn').hidden = TOP_ROUTES.has(r) || r === 'setup';
  $('#nav').hidden = r === 'setup' || (r === 'backup' && !APP.ui.onboarded);
  setTopAction(null);
  $('#helpbtn').hidden = !(window.Tour && Tour.forRoute(r).length) || !APP.ui.onboarded;
  VIEW.onclick = null; VIEW.oninput = null; VIEW.onchange = null;
  quietView = !!keepScroll;
  if (!keepScroll) setView('<div class="sk"></div><div class="sk" style="height:80px"></div><div class="sk" style="height:200px"></div>');
  renderBasket();
  try {
    const fn = ROUTES[r] || ROUTES[''];
    await fn(parts, params);
  } catch (e) {
    console.error(e);
    if (my === routing) setView(`<div class="empty">${icon('x', 'lg')}<br>משהו השתבש: ${esc(e.message)}<br><br><button class="btn ghost" onclick="route()">לנסות שוב</button></div>`);
  }
  if (!keepScroll) window.scrollTo(0, 0);
  if (my === routing) { APP.rendering = false; APP.renderedAt = Date.now(); }
}
function rerender() {
  const y = window.scrollY;
  return route(true).then(() => window.scrollTo(0, y));
}

/* ================= food sheet ================= */
/* mode: 'log' (default) → writes an entry; 'plan' → basket;
   'pick' → returns {view, grams, portion} to opts.onDone (recipes, meals). */
function openFoodSheet(view, opts = {}) {
  const mode = opts.mode || (APP.planMode ? 'plan' : 'log');
  const portions = view.portions || [];
  const st = { slot: opts.slot || nowSlot(), grams: 100, portion: null, count: 1 };
  if (opts.grams) {
    st.grams = opts.grams;
    if (opts.portion) { st.portion = portions.find((p) => p.name === opts.portion.name) || opts.portion; st.count = opts.portion.count || 1; }
  } else if (view.lastPortion && view.lastPortion.grams) {
    st.portion = portions.find((p) => p.name === view.lastPortion.name) || view.lastPortion;
    st.count = view.lastPortion.count || 1; st.grams = st.portion.grams * st.count;
  } else if (view.lastGrams) {
    st.grams = view.lastGrams;
  } else {
    const unitP = Parse.matchPortion(portions, 'יחידה') || Parse.matchPortion(portions, 'פרוסה')
      || Parse.matchPortion(portions, 'מנה') || (portions.length === 1 ? portions[0] : null);
    if (unitP) { st.portion = unitP; st.count = 1; st.grams = unitP.grams; }
  }
  const unit = view.liquid ? 'מ״ל' : 'גרם';
  // a food with a once-per-pan part is counted only in its unit (eggs), in whole numbers
  const pan = !!(view.per100.once && portions.length);
  if (pan && !st.portion) { st.portion = portions[0]; st.count = Math.max(1, Math.round(st.grams / st.portion.grams)); st.grams = st.portion.grams * st.count; }

  const render = () => {
    const n = C.nutrition(view.per100, st.grams);
    const favOn = view.src === 'lib' && view.ref.fav;
    const btnLabel = mode === 'plan' ? 'להוסיף לסל' : mode === 'pick' ? (opts.pickLabel || 'להוסיף') : `להוסיף ל${C.SLOT_HE[st.slot]}`;
    const body = openModal(`
      <h3 class="row">${dot(view.per100.k, view.liquid)}<span class="grow">${esc(view.name)}</span>
        ${view.src === 'lib' ? `<button class="iconbtn" data-act="fav" aria-label="מועדף" style="color:${favOn ? 'var(--gold)' : 'var(--faint)'}">${icon(favOn ? 'starf' : 'star')}</button>` : ''}</h3>
      ${pan ? `<div class="faint">${esc(portions[0].name)}: <span class="n">${fmt(view.per100.k * portions[0].grams / 100)}</span> קלוריות · תרסיס השמן <span class="n">${fmt(view.per100.once.k)}</span>, פעם אחת בכל טיגון</div>`
        : `<div class="faint">ל-100 ${unit}: <span class="n">${fmt(view.per100.k)}</span> קלוריות · <span class="n">${fmt1(view.per100.p)}</span> גרם חלבון</div>`}
      <div class="preview"><span class="dnum" id="fsk">${fmt(n.k)}</span><span class="muted bold">קלוריות</span></div>
      <div class="macros" id="fsm">${macrosHtml(n)}</div>
      <div class="divider"></div>
      ${portions.length && !pan ? `<div class="chips wrap">
        ${portions.map((p, i) => `<button class="chip ${st.portion && st.portion.name === p.name ? 'on' : ''}" data-act="portion" data-i="${i}">${esc(p.name)} <span class="sub n">${fmt(p.grams)}</span></button>`).join('')}
        <button class="chip ${!st.portion ? 'on' : ''}" data-act="gmode">${unit}</button>
      </div>` : ''}
      ${st.portion ? `
        <div class="stepper" style="margin-top:8px">
          <button data-act="cminus" aria-label="פחות">${icon('minus')}</button>
          <input class="num" id="fscount" inputmode="decimal" value="${fmt1(st.count)}">
          <button data-act="cplus" aria-label="יותר">${icon('plus')}</button>
        </div>
        <div class="center faint" id="fsg" style="margin-top:4px">${pan ? esc(countLabel(st.portion.name, st.count)) : `${esc(st.portion.name)} · סה״כ <span class="n">${fmt(st.grams)}</span> ${unit}`}</div>`
      : `
        <div class="stepper" style="margin-top:8px">
          <button data-act="gminus" aria-label="פחות">${icon('minus')}</button>
          <input class="num" id="fsgrams" inputmode="numeric" value="${Math.round(st.grams)}">
          <button data-act="gplus" aria-label="יותר">${icon('plus')}</button>
        </div>
        <div class="center faint" style="margin-top:4px">${unit}</div>`}
      ${mode === 'log' ? `<div class="divider"></div><div class="seg" id="fsslot">
        ${C.SLOTS.map((s) => `<button class="${s === st.slot ? 'on' : ''}" data-act="slot" data-s="${s}">${C.SLOT_HE[s]}</button>`).join('')}</div>` : ''}
      <button class="btn block" data-act="save" style="margin-top:16px">${icon(mode === 'plan' ? 'basket' : 'check')}${btnLabel}</button>
      ${view.src === 'lib' && mode !== 'pick' ? `<div class="center"><button class="linkbtn" data-act="edit">${icon('pen', 'sm')}עריכת המאכל</button></div>` : ''}
      ${opts.extraHtml ? opts.extraHtml() : ''}
    `);
    body.onclick = onClick;
    body.oninput = onInput;
    if (window.Tour && mode !== 'pick') Tour.tip('qty', '#modalbody .stepper', 'כאן משנים כמות. פלוס מוסיף, מינוס מוריד.');
  };
  const refresh = () => {
    const n = C.nutrition(view.per100, st.grams);
    const k = $('#fsk'); if (k) k.textContent = fmt(n.k);
    const m = $('#fsm'); if (m) m.innerHTML = macrosHtml(n);
    const g = $('#fsg'); if (g && st.portion) g.innerHTML = pan ? esc(countLabel(st.portion.name, st.count)) : `${esc(st.portion.name)} · סה״כ <span class="n">${fmt(st.grams)}</span> ${unit}`;
  };
  const onInput = (ev) => {
    if (ev.target.id === 'fsgrams') { st.grams = Math.max(0, num(ev.target.value) || 0); refresh(); }
    if (ev.target.id === 'fscount') { st.count = Math.max(0, num(ev.target.value) || 0); st.grams = st.portion.grams * st.count; refresh(); }
  };
  const onClick = async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act.startsWith('x-')) { if (opts.onExtra) opts.onExtra(act, b); return; }
    if (act === 'portion') { st.portion = portions[+b.dataset.i]; st.count = 1; st.grams = st.portion.grams; render(); }
    else if (act === 'gmode') { st.portion = null; st.grams = Math.round(st.grams); render(); }
    else if (act === 'cminus' || act === 'cplus') {
      const step = pan ? 1 : st.count < 1 || (act === 'cminus' && st.count <= 1) ? 0.5 : 1;
      st.count = Math.max(pan ? 1 : 0.5, st.count + (act === 'cplus' ? step : -step));
      st.grams = st.portion.grams * st.count; $('#fscount').value = fmt1(st.count); refresh();
    } else if (act === 'gminus' || act === 'gplus') {
      st.grams = Math.max(0, Math.round(st.grams) + (act === 'gplus' ? 10 : -10)); $('#fsgrams').value = st.grams; refresh();
    } else if (act === 'slot') { st.slot = b.dataset.s; render(); }
    else if (act === 'fav') { view.ref.fav = !view.ref.fav; await putFood(view.ref); render(); }
    else if (act === 'edit') { openManualFood({ food: view.ref, onSaved: (f) => openFoodSheet(S.viewLib(f), opts) }); }
    else if (act === 'save') {
      if (!(st.grams > 0)) { toast('כמה אכלת? צריך כמות'); return; }
      const portion = st.portion ? { name: st.portion.name, grams: st.portion.grams, count: st.count } : null;
      if (mode === 'pick') { closeModal(); opts.onDone && opts.onDone({ view, grams: st.grams, portion }); return; }
      const food = await ensureLibFood(view);
      if (mode === 'plan') {
        APP.basket.push({ foodId: food.id, grams: st.grams, portion });
        saveBasket(); closeModal(); renderBasket(); vibrate(); toast('נוסף לסל');
        return;
      }
      const entries = await logFoods([{ food, grams: st.grams, portion }], { slot: st.slot, date: opts.date });
      closeModal(); vibrate();
      const e0 = entries[0];
      toast(MERGED.has(e0) && e0.portion ? `נוסף לחביתה שכבר רשומה: ${countLabel(e0.portion.name, e0.portion.count)} · ${fmt(e0.k)}`
        : `נרשם: ${food.name.split(',')[0]} · ${fmt(e0.k)}`, { label: 'ביטול', fn: () => undoEntries(entries) });
      if (opts.onDone) opts.onDone(entries); else if (opts.returnTo) go(opts.returnTo); else rerender();
    }
  };
  render();
}
function macrosHtml(n) {
  return `חלבון <b class="n">${fmt1(n.p)}</b> · שומן <b class="n">${fmt1(n.f)}</b> · פחמימות <b class="n">${fmt1(n.c)}</b>`;
}

/* ================= confirm list ================= */
/* items: [{food: view|null, grams, portion, raw, estimated}] — used by free
   text, speech, smart help, evening suggestions, ready meals and basket. */
/* opts.checklist: a fixed meal. Every item starts ticked; untick what she
   didn't eat this time (the meal itself is not changed). */
function openConfirmList(items, opts = {}) {
  const mode = opts.mode || 'log';          // 'log' | 'pick'
  const checklist = !!opts.checklist;
  const st = { slot: opts.slot || nowSlot(), items: items.map((x) => ({ on: true, ...x })) };
  const live = () => st.items.filter((x) => x.on && x.food && x.grams > 0);
  const render = () => {
    const resolved = live();
    const total = resolved.reduce((a, x) => a + C.nutrition(x.food.per100, x.grams).k, 0);
    const body = openModal(`
      <h3>${esc(opts.title || 'לבדוק ולהוסיף')}</h3>
      ${opts.note ? `<div class="note" style="margin:-6px 0 8px">${opts.note}</div>` : ''}
      ${checklist ? '<div class="note" style="margin:-6px 0 8px">מה שלא אכלת הפעם, מורידים את הסימון. הארוחה הקבועה לא משתנה.</div>' : ''}
      <div id="clrows">${st.items.map((x, i) => rowHtml(x, i)).join('')}</div>
      ${opts.refine ? `<button class="btn ghost block" data-act="refine" style="margin-top:10px">${icon('sparkle')}${esc(opts.refineLabel || 'משהו שלא ראיתי? לכתוב במילים')}</button>` : ''}
      <div class="spread" style="margin:12px 2px">
        <button class="linkbtn" data-act="addrow">${icon('plus', 'sm')}עוד מאכל</button>
        <span class="bold">סה״כ <span class="dnum big" id="cltotal">${fmt(total)}</span> קלוריות</span>
      </div>
      ${mode === 'log' ? `<div class="seg">${C.SLOTS.map((s) => `<button class="${s === st.slot ? 'on' : ''}" data-act="slot" data-s="${s}">${C.SLOT_HE[s]}</button>`).join('')}</div>` : ''}
      <button class="btn block" data-act="save" style="margin-top:14px" ${resolved.length ? '' : 'disabled'}>${icon('check')}${esc(opts.saveLabel || (mode === 'log' ? 'להוסיף הכול' : 'להוסיף'))}</button>
    `);
    body.onclick = onClick;
    body.oninput = onInput;
    if (window.Tour && checklist) Tour.tip('untick', '#clrows .tick', 'מה שלא אכלת הפעם, לוחצים על הסימון והוא יורד.');
  };
  const rowHtml = (x, i) => {
    if (!x.food) {
      return `<div class="confirmrow unres"><span class="dot none"></span>
        <div class="nm" data-act="pick" data-i="${i}"><div class="t">${esc(x.raw || 'מאכל')}</div><div class="s" style="color:var(--accent)">לא זוהה. לחצי לבחירה</div></div>
        <button class="iconbtn" data-act="del" data-i="${i}" aria-label="הסרה">${icon('x')}</button></div>`;
    }
    const n = C.nutrition(x.food.per100, x.grams || 0);
    const sub = x.portion ? `${esc(countLabel(x.portion.name, x.portion.count))}` : (x.estimated ? 'כמות משוערת' : (x.note || ''));
    const tick = checklist
      ? `<button class="tick ${x.on ? 'on' : ''}" data-act="toggle" data-i="${i}" aria-label="${x.on ? 'לא אכלתי הפעם' : 'אכלתי'}" aria-pressed="${x.on}">${icon('check')}</button>`
      : dot(x.food.per100.k, x.food.liquid);
    return `<div class="confirmrow ${x.on ? '' : 'off'}">${tick}
      <div class="nm" data-act="${checklist ? 'toggle' : 'pick'}" data-i="${i}"><div class="t">${esc(x.food.name)}</div><div class="s">${x.on ? sub + (x.estimated && x.portion ? ' · משוער' : '') : 'לא הפעם'}</div></div>
      <input class="num" inputmode="numeric" data-i="${i}" value="${Math.round(x.grams || 0)}" aria-label="גרמים" ${x.on ? '' : 'disabled'}>
      <span class="k n" id="clk${i}">${fmt(n.k)}</span>
      ${checklist ? '' : `<button class="iconbtn" data-act="del" data-i="${i}" aria-label="הסרה">${icon('x')}</button>`}</div>`;
  };
  const updateTotal = () => {
    const total = st.items.filter((x) => x.on && x.food).reduce((a, x) => a + C.nutrition(x.food.per100, x.grams || 0).k, 0);
    $('#cltotal').textContent = fmt(total);
  };
  const onInput = (ev) => {
    const i = ev.target.dataset.i;
    if (i == null) return;
    const x = st.items[+i];
    x.grams = Math.max(0, num(ev.target.value) || 0);
    x.portion = null; x.estimated = false;
    const sub = ev.target.closest('.confirmrow').querySelector('.nm .s');
    if (sub) sub.textContent = '';
    $('#clk' + i).textContent = fmt(C.nutrition(x.food.per100, x.grams).k);
    updateTotal();
  };
  const onClick = async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'slot') { st.slot = b.dataset.s; render(); }
    else if (act === 'del') { st.items.splice(+b.dataset.i, 1); render(); }
    else if (act === 'toggle') { const x = st.items[+b.dataset.i]; x.on = !x.on; vibrate(8); render(); }
    /* Her words beat the photo. Published work puts image-only calorie error
       near a third, and roughly halves it once the model is told what is
       actually in the dish, so this is the cheapest accuracy we can buy. */
    else if (act === 'refine') {
      const prev = st.items.filter((x) => x.on).map((x) => (x.food ? x.food.name : x.raw)).filter(Boolean);
      const box = openModal(`
        <h3>מה עוד יש בצלחת?</h3>
        <div class="note" style="margin:-6px 0 10px">אפשר לכתוב מה שלא רואים בתמונה — שמן, רוטב, סוכר — או לתקן מאכל שזיהיתי לא נכון. אני אחשב הכול מחדש.</div>
        <textarea id="rfn" placeholder="למשל: הסלט עם כף טחינה, והאורז בושל בשתי כפות שמן"></textarea>
        <button class="btn block" data-act="rfngo" style="margin-top:12px">${icon('check')}לחשב מחדש</button>
        <div class="center"><button class="linkbtn" data-act="rfnback" style="color:var(--muted)">חזרה בלי שינוי</button></div>
      `);
      box.onclick = async (e2) => {
        const t = e2.target.closest('[data-act]');
        if (!t) return;
        if (t.dataset.act === 'rfnback') { render(); return; }
        if (t.dataset.act !== 'rfngo') return;
        const note = ($('#rfn') ? $('#rfn').value : '').trim();
        if (!note) { render(); return; }
        openModal('<h3>מחשבת מחדש…</h3><div class="sk" style="height:90px"></div>');
        try {
          const fresh = await opts.refine(note, prev);
          if (fresh && fresh.length) st.items = fresh.map((x) => ({ on: true, ...x }));
          else toast('לא הצלחתי לעדכן, הרשימה נשארה כמו שהייתה');
        } catch (err) {
          toast(typeof aiErrorText === 'function' ? aiErrorText(err) : 'העזרה החכמה לא זמינה כרגע');
        }
        render();
      };
      setTimeout(() => { const i = $('#rfn'); if (i) i.focus(); }, 250);
    }
    else if (act === 'pick' || act === 'addrow') {
      const idx = act === 'pick' ? +b.dataset.i : -1;
      const query = idx >= 0 ? (st.items[idx].query || (st.items[idx].food ? st.items[idx].food.name.split(',')[0] : st.items[idx].raw) || '') : '';
      openPicker({
        query,
        onPick: (view) => openFoodSheet(view, {
          mode: 'pick', pickLabel: 'לבחור',
          grams: idx >= 0 && st.items[idx].food ? st.items[idx].grams : null,
          onDone: ({ view: v, grams, portion }) => {
            const item = { food: v, grams, portion, raw: v.name, on: true };
            if (idx >= 0) st.items[idx] = item; else st.items.push(item);
            render();
          },
        }),
        onCancel: render,
      });
    } else if (act === 'save') {
      const list = live();
      if (!list.length) return;
      if (mode === 'pick') { closeModal(); opts.onDone && opts.onDone(list); return; }
      const foods = [];
      for (const x of list) foods.push({ food: await ensureLibFood(x.food), grams: x.grams, portion: x.portion });
      const entries = await logFoods(foods, { slot: st.slot, date: opts.date, mealId: opts.mealId, mealName: opts.mealName });
      closeModal(); vibrate();
      const kc = entries.reduce((a, e) => a + e.k, 0);
      toast(`נרשמו ${entries.length} מאכלים · ${fmt(kc)} קלוריות`, { label: 'ביטול', fn: () => undoEntries(entries) });
      if (opts.onSaved) opts.onSaved(entries); else if (opts.returnTo) go(opts.returnTo); else rerender();
    }
  };
  render();
}

/* ================= picker (search in a sheet) ================= */
function openPicker({ query = '', onPick, onCancel, title = 'איזה מאכל?' }) {
  let results = [];
  const body = openModal(`
    <h3>${esc(title)}</h3>
    <div class="searchbox">${icon('search')}<input type="search" id="pkq" placeholder="לחפש מאכל" value="${esc(query)}" autocomplete="off"></div>
    <div id="pkres" style="margin-top:10px"></div>
    <div class="center"><button class="linkbtn" data-act="manual">${icon('pen', 'sm')}לא מצאתי, להוסיף ידנית</button></div>
    ${onCancel ? `<div class="center"><button class="linkbtn" data-act="cancel" style="color:var(--muted)">חזרה</button></div>` : ''}
  `);
  const draw = async () => {
    const q = $('#pkq') ? $('#pkq').value : '';
    results = await searchFoods(q, { libLimit: 8, mohLimit: 25 });
    const box = $('#pkres');
    if (box) box.innerHTML = resultsHtml(results, q);
  };
  let t = null;
  body.oninput = () => { clearTimeout(t); t = setTimeout(draw, 140); };
  body.onclick = (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'res') onPick(results[+b.dataset.i]);
    else if (b.dataset.act === 'manual') openManualFood({ prefill: { name: $('#pkq').value }, onSaved: (f) => onPick(S.viewLib(f)) });
    else if (b.dataset.act === 'cancel') onCancel();
  };
  draw();
  setTimeout(() => { const i = $('#pkq'); if (i && !query) i.focus(); }, 250);
}

/* Library first, then the ministry DB. Returns food views. */
async function searchFoods(q, { libLimit = 8, mohLimit = 25, emptyLib = 15 } = {}) {
  const lib = libViews();
  if (!q || !q.trim()) {
    return lib.sort((a, b) => (b.fav - a.fav) || ((b.ref.lastUsed || 0) - (a.ref.lastUsed || 0)))
      .slice(0, emptyLib).map((v) => Object.assign(v, { _sec: 'lib' }));
  }
  const libHits = S.search(lib, q, { limit: libLimit, nameOf: (x) => x.name, englishOf: () => '' });
  let mohHits = [];
  try {
    const moh = await loadMoh();
    const have = new Set(libHits.map((v) => v.mohCode).filter(Boolean));
    mohHits = S.search(moh, q, { limit: mohLimit + have.size }).filter((m) => !have.has(m.i)).slice(0, mohLimit).map(S.viewMoh);
  } catch (e) { mohHits = [{ _err: true }]; }
  return [...libHits.map((v) => Object.assign(v, { _sec: 'lib' })), ...mohHits.map((v) => Object.assign(v, { _sec: 'moh' }))];
}
function resultsHtml(results, q) {
  if (!results.length) {
    return q ? `<div class="empty small">לא נמצא "${esc(q)}".<br>אפשר לנסות מילה אחרת, או להוסיף ידנית.</div>`
      : `<div class="empty small">${icon('search', 'lg')}<br>כתבי שם של מאכל</div>`;
  }
  let html = '', sec = null;
  results.forEach((v, i) => {
    if (v._err) { html += '<div class="note center">המאגר לא נטען. בדקי חיבור לאינטרנט.</div>'; return; }
    if (v._sec !== sec) {
      sec = v._sec;
      html += `<div class="faint bold" style="margin:10px 4px 6px">${sec === 'lib' ? (q ? 'המאכלים שלי' : 'מועדפים ואחרונים') : 'מהמאגר של משרד הבריאות'}</div>`;
    }
    let sub;
    if (v.src === 'lib' && (v.lastPortion || v.lastGrams)) {
      const g = v.lastPortion ? v.lastPortion.grams * (v.lastPortion.count || 1) : v.lastGrams;
      sub = `${v.lastPortion ? esc(v.lastPortion.name) : fmt(g) + ' גרם'} · ${fmt(C.nutrition(v.per100, g).k)} קלוריות`;
    } else {
      sub = `ל-100 ${v.liquid ? 'מ״ל' : 'גרם'}: ${fmt(v.per100.k)} קלוריות`;
    }
    html += `<div class="item ${sec === 'moh' ? 'flat' : ''}" data-act="res" data-i="${i}">${dot(v.per100.k, v.liquid)}
      <div class="nm"><div class="t">${esc(v.name)}</div><div class="s">${sub}</div></div>
      ${v.src === 'lib' && v.fav ? `<span style="color:var(--gold)">${icon('starf', 'sm')}</span>` : ''}</div>`;
  });
  return html;
}

/* ================= manual food / edit food ================= */
function openManualFood({ food, prefill = {}, note, onSaved }) {
  const f = food || null;
  const v = f ? { name: f.name, ...f.per100, liquid: f.liquid, portion: (f.portions || [])[0] }
    : { name: prefill.name || '', k: prefill.k ?? '', p: prefill.p ?? '', f: prefill.f ?? '', c: prefill.c ?? '', liquid: !!prefill.liquid, portion: prefill.portion };
  const unitWord = (liq) => (liq ? 'מ״ל' : 'גרם');
  const body = openModal(`
    <h3>${f ? 'עריכת מאכל' : 'מאכל חדש'}</h3>
    ${note ? `<div class="card soft note">${note}</div>` : ''}
    <label class="field"><span>שם</span><input id="mfname" value="${esc(v.name)}" placeholder="למשל: קרקר אורז של עלית"></label>
    <div class="faint bold" style="margin:-4px 2px 8px" id="mfunit">הערכים ל-100 ${unitWord(v.liquid)}, כמו בטבלה על האריזה</div>
    <div class="grid2">
      <label class="field"><span>קלוריות</span><input class="num" id="mfk" inputmode="decimal" value="${esc(v.k)}"></label>
      <label class="field"><span>חלבון</span><input class="num" id="mfp" inputmode="decimal" value="${esc(v.p)}"></label>
      <label class="field"><span>שומן</span><input class="num" id="mff" inputmode="decimal" value="${esc(v.f)}"></label>
      <label class="field"><span>פחמימות</span><input class="num" id="mfc" inputmode="decimal" value="${esc(v.c)}"></label>
    </div>
    <label class="row" style="min-height:48px"><input type="checkbox" id="mfliq" ${v.liquid ? 'checked' : ''} style="width:24px;height:24px"> זה משקה</label>
    <div class="divider"></div>
    <div class="faint bold" style="margin:0 2px 8px">מנה רגילה (לא חובה)</div>
    <div class="grid2">
      <label class="field"><span>שם הארוחה</span><input id="mfpn" value="${esc(v.portion ? v.portion.name : '')}" placeholder="יחידה / פרוסה"></label>
      <label class="field"><span>משקל המנה</span><input class="num" id="mfpg" inputmode="decimal" value="${esc(v.portion ? v.portion.grams : '')}"></label>
    </div>
    <button class="btn block" data-act="save">${icon('check')}שמירה</button>
    ${f ? `<div class="center"><button class="linkbtn" data-act="hide" style="color:var(--bad)">${icon('trash', 'sm')}להסיר מהמאכלים שלי</button></div>` : ''}
  `);
  body.onchange = (ev) => { if (ev.target.id === 'mfliq') $('#mfunit').textContent = `הערכים ל-100 ${unitWord(ev.target.checked)}, כמו בטבלה על האריזה`; };
  body.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'hide') {
      f.hidden = true; await putFood(f); closeModal(); toast('הוסר מהמאכלים שלך'); rerender(); return;
    }
    const name = $('#mfname').value.trim();
    const k = num($('#mfk').value);
    if (!name) { toast('צריך שם למאכל'); return; }
    if (k == null) { toast('צריך לפחות קלוריות'); return; }
    const per100 = { k: Math.round(k), p: C.r1(num($('#mfp').value) || 0), f: C.r1(num($('#mff').value) || 0), c: C.r1(num($('#mfc').value) || 0) };
    const pn = $('#mfpn').value.trim(), pg = num($('#mfpg').value);
    const liquid = $('#mfliq').checked;
    let saved;
    if (f) {
      const others = (f.portions || []).slice(1);
      if (f.per100 && f.per100.once) per100.once = { ...f.per100.once };
      Object.assign(f, { name, per100, liquid, portions: pn && pg ? [{ name: pn, grams: pg }, ...others] : others });
      saved = await putFood(f);
    } else {
      saved = await putFood(newFood({
        name, per100, liquid, portions: pn && pg ? [{ name: pn, grams: pg }] : [],
        source: prefill.source || 'manual', barcode: prefill.barcode || null, brand: prefill.brand || null,
      }));
    }
    toast('נשמר');
    if (onSaved) onSaved(saved); else closeModal();
  };
}

/* ================= quick kcal ================= */
function openQuickKcal({ slot, date } = {}) {
  let s = slot || nowSlot();
  const render = () => {
    const body = openModal(`
      <h3>רק קלוריות</h3>
      <div class="note" style="margin-bottom:10px">לארוחה בחוץ או כשאין זמן. הערכה גסה עדיפה על כלום.</div>
      <label class="field"><span>כמה קלוריות בערך?</span><input class="num" id="qkk" inputmode="numeric" placeholder="600"></label>
      <label class="field"><span>מה זה היה? (לא חובה)</span><input id="qkn" placeholder="ארוחה במסעדה"></label>
      <div class="seg">${C.SLOTS.map((x) => `<button class="${x === s ? 'on' : ''}" data-s="${x}">${C.SLOT_HE[x]}</button>`).join('')}</div>
      <button class="btn block" id="qksave" style="margin-top:14px">${icon('check')}להוסיף</button>`);
    body.onclick = async (ev) => {
      const sb = ev.target.closest('[data-s]');
      if (sb) { s = sb.dataset.s; const k = $('#qkk').value, n = $('#qkn').value; render(); $('#qkk').value = k; $('#qkn').value = n; return; }
      if (ev.target.closest('#qksave')) {
        const k = num($('#qkk').value);
        if (!(k > 0)) { toast('כמה קלוריות?'); return; }
        const e = { id: uid('e'), date: date || today(), time: C.hhmm(), slot: s, foodId: null,
          name: $('#qkn').value.trim() || 'הוספה מהירה', grams: 0, portion: null,
          k: Math.round(k), p: 0, f: 0, c: 0, per100: null, liquid: false, quick: true, mealId: null, mealName: null };
        await DB.put('entries', e);
        afterDataChange(e.date);
        closeModal(); vibrate();
        toast(`נרשמו ${fmt(e.k)} קלוריות`, { label: 'ביטול', fn: () => undoEntries([e]) });
        goHome();
      }
    };
    setTimeout(() => $('#qkk') && $('#qkk').focus(), 250);
  };
  render();
}

/* ================= barcode ================= */
let camStream = null, camTimer = null;
function stopCamera() {
  clearTimeout(camTimer); camTimer = null;
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

/* EAN-13 / EAN-8 / UPC-A check digit, so a half-read barcode never looks
   up the wrong product. */
function validBarcode(code) {
  if (!/^\d{6,14}$/.test(code)) return false;
  if (![8, 12, 13].includes(code.length)) return true;          // UPC-E and friends: no check here
  const d = code.split('').map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('load ' + src));
    document.head.appendChild(s);
  });
}
/* Chrome on most Android phones has a built-in barcode detector. Where it
   doesn't, load the ZXing fallback from this site (vendor/), once. */
let detectorP = null;
function getDetector() {
  if (detectorP) return detectorP;
  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
  detectorP = (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const supported = await BarcodeDetector.getSupportedFormats();
        if (supported.includes('ean_13')) return { det: new BarcodeDetector({ formats }), native: true };
      } catch (_) {}
    }
    await loadScript('vendor/barcode.js?v=' + CFG.VERSION);
    return { det: new window.ZXingBarcodeDetector({ formats }), native: false };
  })().catch((e) => { detectorP = null; throw e; });
  return detectorP;
}

async function openBarcode(opts = {}) {
  const hasCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const body = openModal(`
    <h3>סריקת ברקוד</h3>
    ${hasCamera ? `<div class="scanbox" id="bcbox">
        <video id="bcvideo" playsinline muted autoplay></video>
        <div class="scanframe"></div>
        <button class="scantorch" data-act="torch" id="bctorch" hidden aria-label="פנס">${icon('bulb')}</button>
      </div>
      <div class="center bold" id="bcstatus" style="margin:10px 0 2px">פותחת מצלמה…</div>
      <div class="center faint">מכניסים את הברקוד למסגרת, בערך כף יד מהטלפון</div>` : ''}
    <div id="bcmanual" ${hasCamera ? 'hidden' : ''} style="margin-top:12px">
      <label class="field"><span>המספר שמתחת לברקוד</span>
        <input class="num" id="bccode" inputmode="numeric" placeholder="7290000000000"></label>
      <button class="btn block" data-act="go">${icon('search')}לחפש</button>
    </div>
    ${hasCamera ? `<div class="center"><button class="linkbtn" data-act="type" id="bctype">${icon('pen', 'sm')}להקליד את המספר במקום</button></div>` : ''}`);

  const status = (txt) => { const s = $('#bcstatus'); if (s) s.textContent = txt; };
  const showManual = (msg) => {
    const m = $('#bcmanual'); if (m) m.hidden = false;
    const t = $('#bctype'); if (t) t.hidden = true;
    if (msg) status(msg);
    setTimeout(() => { const i = $('#bccode'); if (i) i.focus(); }, 150);
  };
  let torchOn = false;
  body.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'type') showManual();
    else if (b.dataset.act === 'torch') {
      const track = camStream && camStream.getVideoTracks()[0];
      if (!track) return;
      torchOn = !torchOn;
      try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); b.classList.toggle('on', torchOn); } catch (_) {}
    } else if (b.dataset.act === 'go') {
      const code = ($('#bccode').value || '').replace(/\D/g, '');
      if (code.length < 8) { toast('מספר ברקוד קצר מדי'); return; }
      if (!validBarcode(code)) { toast('נראה שיש טעות באחת הספרות'); return; }
      stopCamera(); lookupBarcode(code, opts);
    }
  };
  if (!hasCamera) return;

  let found;
  try { found = await getDetector(); }
  catch (e) { const box = $('#bcbox'); if (box) box.hidden = true; showManual('הסורק לא נטען (אולי אין אינטרנט). אפשר להקליד את המספר'); return; }
  const { det, native } = found;

  try {
    camStream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    const box = $('#bcbox'); if (box) box.hidden = true;
    showManual(e.name === 'NotAllowedError' ? 'צריך לאשר גישה למצלמה. בינתיים אפשר להקליד' : 'לא נמצאה מצלמה. אפשר להקליד את המספר');
    return;
  }
  const video = $('#bcvideo');
  if (!video || !modalOpen()) { stopCamera(); return; }
  video.srcObject = camStream;
  try { await video.play(); } catch (_) {}
  const track = camStream.getVideoTracks()[0];
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) $('#bctorch').hidden = false;
    if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  } catch (_) {}
  status('מחפשת ברקוד…');

  const started = Date.now();
  const tick = async () => {
    if (!camStream || !$('#bcvideo')) return;
    try {
      if (video.readyState >= 2) {
        const codes = await det.detect(video);
        const hit = codes.map((c) => String(c.rawValue || '').trim()).find(validBarcode);
        if (hit) {
          vibrate(40); stopCamera(); status('נמצא ' + hit);
          lookupBarcode(hit, opts);
          return;
        }
      }
    } catch (_) {}
    if (Date.now() - started > 20000) status('לא נקלט? להתקרב קצת, להוסיף אור, או להקליד את המספר');
    camTimer = setTimeout(tick, native ? 180 : 260);
  };
  tick();
}
async function lookupBarcode(code, opts) {
  const mine = APP.lib.find((f) => f.barcode === code && !f.hidden);
  if (mine) { openFoodSheet(S.viewLib(mine), opts); return; }
  openModal(`<h3>מחפשת את המוצר…</h3><div class="sk" style="height:60px"></div>`);
  let found = null;
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=product_name,product_name_he,brands,nutriments,serving_size&app_name=mom-food`;
    const r = await fetch(url);
    if (r.ok) {
      const d = await r.json();
      if (d.status === 1 && d.product) {
        const p = d.product, n = p.nutriments || {};
        const kcal = n['energy-kcal_100g'] != null ? n['energy-kcal_100g'] : (n.energy_100g != null ? n.energy_100g / 4.184 : null);
        const brand = (p.brands || '').split(',')[0].trim();
        found = { name: [p.product_name_he || p.product_name, brand].filter(Boolean).join(', '),
          k: kcal != null ? Math.round(kcal) : '', p: n.proteins_100g ?? '', f: n.fat_100g ?? '', c: n.carbohydrates_100g ?? '' };
      }
    }
  } catch (_) {
    if (!online()) toast('אין אינטרנט כרגע. אפשר להוסיף ידנית');
  }
  const onSaved = (f) => openFoodSheet(S.viewLib(f), opts);
  if (found) {
    openManualFood({
      prefill: { ...found, source: 'off', barcode: code, brand: null },
      note: 'המוצר נמצא. כדאי להציץ בתווית ולוודא שהמספרים נכונים, ואז לשמור. זה נשמר לתמיד.',
      onSaved,
    });
  } else {
    openManualFood({
      prefill: { source: 'manual', barcode: code },
      note: `הברקוד לא נמצא במאגר. ${window.AI && AI.enabled() ? 'אפשר לצלם את טבלת הערכים, או להקליד' : 'מקלידים פעם אחת מהטבלה שעל האריזה'}, והוא יישמר לתמיד.`,
      onSaved,
    });
  }
}

/* ================= entry edit ================= */
async function openEntrySheet(entry) {
  if (entry.quick) {
    const body = openModal(`
      <h3>${esc(entry.name)}</h3>
      <label class="field"><span>קלוריות</span><input class="num" id="eqk" inputmode="numeric" value="${entry.k}"></label>
      <label class="field"><span>שם</span><input id="eqn" value="${esc(entry.name)}"></label>
      <button class="btn block" data-act="save">${icon('check')}שמירה</button>
      <button class="btn block danger" data-act="del" style="margin-top:10px">${icon('trash')}מחיקה</button>`);
    body.onclick = async (ev) => {
      const b = ev.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'del') return removeEntry(entry);
      entry.k = Math.round(num($('#eqk').value) || 0); entry.name = $('#eqn').value.trim() || entry.name;
      await DB.put('entries', entry); afterDataChange(entry.date); closeModal(); rerender();
    };
    return;
  }
  const lib = APP.libById.get(entry.foodId);
  const view = {
    src: 'entry', name: entry.name, liquid: entry.liquid,
    per100: entry.per100 || (lib && lib.per100) || { k: entry.grams ? entry.k * 100 / entry.grams : 0, p: 0, f: 0, c: 0 },
    portions: (lib && lib.portions) || [],
  };
  openFoodSheet(view, {
    mode: 'pick', pickLabel: 'שמירת שינוי', grams: entry.grams, portion: entry.portion,
    extraHtml: () => `<div class="divider"></div>
      <div class="faint bold" style="margin:0 2px 6px">להעביר לארוחה אחרת</div>
      <div class="seg">${C.SLOTS.map((s) => `<button class="${s === entry.slot ? 'on' : ''}" data-act="x-move" data-s="${s}">${C.SLOT_HE[s]}</button>`).join('')}</div>
      <button class="btn block danger" data-act="x-remove" style="margin-top:12px">${icon('trash')}מחיקה</button>`,
    onExtra: async (act, b) => {
      if (act === 'x-remove') { removeEntry(entry); return; }
      entry.slot = b.dataset.s;
      await DB.put('entries', entry);
      closeModal(); toast('הועבר ל' + C.SLOT_HE[entry.slot]); rerender();
    },
    onDone: async ({ grams, portion }) => {
      const n = C.nutrition(view.per100, grams);
      Object.assign(entry, { grams: Math.round(grams), portion, k: n.k, p: n.p, f: n.f, c: n.c });
      await DB.put('entries', entry);
      afterDataChange(entry.date);
      toast('עודכן'); rerender();
    },
  });
}
async function removeEntry(entry) {
  await DB.del('entries', entry.id);
  afterDataChange(entry.date);
  closeModal();
  toast('נמחק', { label: 'ביטול', fn: async () => { await DB.put('entries', entry); afterDataChange(entry.date); rerender(); } });
  rerender();
}

/* ================= planning basket ================= */
function saveBasket() { try { sessionStorage.setItem('mf.basket', JSON.stringify({ items: APP.basket, plan: APP.planMode })); } catch (_) {} }
function restoreBasket() {
  try {
    const d = JSON.parse(sessionStorage.getItem('mf.basket') || '{}');
    APP.basket = (d.items || []).filter((x) => APP.libById.has(x.foodId));
    APP.planMode = !!d.plan;
  } catch (_) { APP.basket = []; }
}
async function renderBasket() {
  const bar = $('#basketbar');
  const r = parseHash().parts[0] || '';
  const show = APP.basket.length > 0 && !$('#nav').hidden && ['', 'add', 'day'].includes(r);
  // rises from the bottom edge when it appears and sinks back the same way
  const was = !bar.hidden && !bar.classList.contains('sink');
  clearTimeout(bar.sinkT);
  bar.classList.remove('sink');
  if (!show) {
    if (was && !reducedMotion()) {
      bar.classList.add('sink');
      bar.sinkT = setTimeout(() => { bar.classList.remove('sink'); bar.hidden = true; }, 220);
    } else bar.hidden = true;
    document.body.classList.remove('has-basket');
    return;
  }
  bar.hidden = false;
  bar.classList.toggle('rise', !was);
  document.body.classList.add('has-basket');
  const items = APP.basket.map((x) => ({ food: APP.libById.get(x.foodId), ...x })).filter((x) => x.food);
  const kc = items.reduce((a, x) => a + C.nutrition(x.food.per100, x.grams).k, 0);
  const eaten = C.sum(await DB.byIndex('entries', 'date', today())).k;
  const weights = await DB.all('weights');
  const target = C.targetFor(APP.profile, C.kgNow(APP.profile, weights, today()), today());
  const left = target - eaten - kc;
  bar.innerHTML = `<div class="in">${icon('basket')}
    <div class="grow" data-act="edit"><b>בסל ${items.length}</b> · <span class="n">${fmt(kc)}</span> קלוריות<br>
      <span style="opacity:.8">${left >= 0 ? `יישארו <span class="n">${fmt(left)}</span>` : `מעל היעד ב-<span class="n">${fmt(-left)}</span>`}</span></div>
    <button class="btn small soft" data-act="clear">לנקות</button>
    <button class="btn small" data-act="eat">אכלתי</button></div>`;
  bar.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'clear') { APP.basket = []; saveBasket(); renderBasket(); }
    else if (b.dataset.act === 'edit' || b.dataset.act === 'eat') {
      openConfirmList(items.map((x) => ({ food: S.viewLib(x.food), grams: x.grams, portion: x.portion })), {
        title: 'הסל', saveLabel: 'אכלתי את זה',
        onSaved: () => { APP.basket = []; APP.planMode = false; saveBasket(); renderBasket(); goHome(); },
      });
    }
  };
}

/* ================= help: "תראי לי איך" ================= */
function openHelpSheet() {
  const r = parseHash().parts[0] || '';
  const tours = Tour.forRoute(r);
  const body = openModal(`<h3>במה לעזור?</h3>
    <p class="note" style="margin:-4px 0 10px">בוחרים, והאפליקציה מראה על המסך איפה ללחוץ.</p>
    ${tours.map((t) => `<button class="action" data-tour="${t.id}">${icon(t.icon)}<span class="grow"><b>${esc(t.title)}</b><br><span class="faint small">${esc(t.sub)}</span></span>${icon('chev', 'chev')}</button>`).join('')}
    <a class="btn block ghost" href="#/guide" style="margin-top:10px">${icon('list')}כל ההדרכות</a>`);
  body.onclick = (ev) => {
    const b = ev.target.closest('[data-tour]');
    if (b) Tour.start(b.dataset.tour);
    else if (ev.target.closest('a[href="#/guide"]')) closeModal(true);
  };
}

/* ================= speech ================= */
function speechSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
function dictate(onText, btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('הדפדפן לא תומך בדיבור'); return; }
  const rec = new SR();
  rec.lang = 'he-IL'; rec.interimResults = false; rec.maxAlternatives = 1;
  if (btn) btn.classList.add('on');
  rec.onresult = (e) => onText(e.results[0][0].transcript);
  rec.onerror = (e) => toast(e.error === 'not-allowed' ? 'צריך לאשר שימוש במיקרופון' : 'לא נקלט, אפשר לנסות שוב');
  rec.onend = () => { if (btn) btn.classList.remove('on'); };
  try { rec.start(); toast('מקשיבה… אפשר לדבר'); } catch (_) {}
}

/* ================= service worker ================= */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const go = () => { sessionStorage.setItem('mf.updated', '1'); location.reload(); };
    if (modalOpen()) APP.reloadPending = go; else go();
  });
  // safety net: page running a different version than the installed cache → reload once
  if (location.hostname !== 'localhost' && window.caches) {
    navigator.serviceWorker.ready.then(() => caches.keys()).then((keys) => {
      const cur = keys.find((k) => k.startsWith('mom-'));
      if (cur && cur !== 'mom-' + CFG.VERSION && !sessionStorage.getItem('mf.vfix')) {
        sessionStorage.setItem('mf.vfix', '1');
        if (!modalOpen()) location.reload();
      } else if (cur === 'mom-' + CFG.VERSION) {
        sessionStorage.removeItem('mf.vfix');
      }
    }).catch(() => {});
  }
}

/* ================= boot ================= */
async function boot() {
  try {
    const s = await DB.loadSettings();
    APP.profile = s.profile || null;
    APP.ui = s.ui || {};
    APP.device = s.device || null;
  } catch (e) {
    setView(`<div class="empty">${icon('x', 'lg')}<br>הדפדפן לא מאפשר שמירה של נתונים.<br>אולי חלון גלישה בסתר?</div>`);
    return;
  }
  applyTextSize();
  /* Before anything reads the library: if the identity came back but the
     journal did not, pull her own backup silently. She never sees a recovery
     code, she just finds her app the way she left it. */
  if (window.Cloud && Cloud.enabled()) {
    DB.onWrite = () => Cloud.save();
    try { if (await Cloud.autoRestore()) setTimeout(() => toast('הנתונים שלך חזרו מהגיבוי'), 900); } catch (_) {}
  }
  await loadLibrary();
  try { await ensureBuiltins(); } catch (e) { console.error(e); }
  restoreBasket();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}
  window.addEventListener('hashchange', () => route());
  if (sessionStorage.getItem('mf.updated')) {
    sessionStorage.removeItem('mf.updated');
    setTimeout(() => toast('האפליקציה התעדכנה'), 700);
  }
  registerSW();
  await route();
  if (window.Cloud && Cloud.enabled() && APP.ui.onboarded) Cloud.onBoot().catch(() => {});
}
window.addEventListener('DOMContentLoaded', boot);
