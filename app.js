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
function fmtDateShort(d) { return d.slice(8, 10) + '.' + d.slice(5, 7); }
function fmtDateLong(d) { return 'יום ' + DAY_FULL[C.parseYmd(d).getDay()] + ', ' + fmtDateShort(d); }
function relDay(d) {
  const diff = C.diffDays(d, today());
  return diff === 0 ? 'היום' : diff === 1 ? 'אתמול' : fmtDateLong(d);
}
function amountLabel(e) {
  if (e.quick) return 'הוספה מהירה';
  if (e.portion && e.portion.name) {
    const c = e.portion.count;
    const cnt = c === 1 ? '' : c === 0.5 ? 'חצי ' : fmt1(c) + ' × ';
    return `${cnt}${e.portion.name} · ${fmt(e.grams)} ${e.liquid ? 'מ״ל' : 'ג׳'}`;
  }
  return `${fmt(e.grams)} ${e.liquid ? 'מ״ל' : 'גרם'}`;
}
function setTitle(t) { $('#title').textContent = t; document.title = t === 'צלחת' ? 'צלחת' : t + ' · צלחת'; }
function setView(html) { VIEW.innerHTML = `<div class="vwrap">${html}</div>`; }
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
function hideToast() { $('#toast').classList.remove('show'); }

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
function modalOpen() { return $('#modal').classList.contains('show'); }
function openModal(html, onClose) {
  const m = $('#modal');
  const body = $('#modalbody');
  body.innerHTML = '<div class="grab"></div>' + html;
  body.onclick = null; body.oninput = null; body.onchange = null;
  body.scrollTop = 0;
  if (!modalOpen()) {
    m.classList.add('show');
    history.pushState({ sheet: 1 }, '');
    modalPushed = true;
  }
  modalOnClose = onClose || null;
  return body;
}
function closeModal(silent) {
  if (!modalOpen()) return;
  $('#modal').classList.remove('show');
  stopCamera();
  $('#modalbody').innerHTML = '';
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
function libFoods() { return APP.lib.filter((f) => !f.hidden); }
function libViews() { return libFoods().map(S.viewLib); }
function loadMoh() {
  if (APP.moh) return Promise.resolve(APP.moh);
  if (!APP.mohP) {
    APP.mohP = fetch('foods.json?v=' + CFG.VERSION)
      .then((r) => { if (!r.ok) throw new Error('המאגר לא נטען'); return r.json(); })
      .then((d) => (APP.moh = d.foods))
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
async function logFoods(list, { slot, date, mealId, mealName } = {}) {
  const entries = [];
  for (const it of list) {
    const e = makeEntry(it.food, { grams: it.grams, portion: it.portion, slot, date, mealId, mealName });
    entries.push(e);
  }
  await DB.putMany('entries', entries);
  for (const it of list) await bumpFood(it.food, slot || nowSlot(), it.grams, it.portion);
  afterDataChange(date || today());
  return entries;
}
async function undoEntries(entries) {
  await DB.delMany('entries', entries.map((e) => e.id));
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
  if (window.Cloud && Cloud.enabled()) Cloud.heartbeat().catch(() => {});
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
  more: 'more', history: 'more', insights: 'more', settings: 'more', backup: 'more', day: 'more', food: 'recipes' };
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { parts: path.split('/').filter(Boolean), params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
let routing = 0;
async function route(keepScroll) {
  closeModal(true);
  const my = ++routing;
  const { parts, params } = parseHash();
  let r = parts[0] || '';
  if (!APP.profile || !APP.ui.onboarded) {
    if (r !== 'setup' && r !== 'backup') { location.replace('#/setup'); return; }
  }
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === NAV_OF[r]));
  $('#backbtn').hidden = TOP_ROUTES.has(r) || r === 'setup';
  $('#nav').hidden = r === 'setup' || (r === 'backup' && !APP.ui.onboarded);
  setTopAction(null);
  VIEW.onclick = null; VIEW.oninput = null; VIEW.onchange = null;
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

  const render = () => {
    const n = C.nutrition(view.per100, st.grams);
    const favOn = view.src === 'lib' && view.ref.fav;
    const btnLabel = mode === 'plan' ? 'להוסיף לסל' : mode === 'pick' ? (opts.pickLabel || 'להוסיף') : `להוסיף ל${C.SLOT_HE[st.slot]}`;
    const body = openModal(`
      <h3 class="row">${dot(view.per100.k, view.liquid)}<span class="grow">${esc(view.name)}</span>
        ${view.src === 'lib' ? `<button class="iconbtn" data-act="fav" aria-label="מועדף" style="color:${favOn ? 'var(--gold)' : 'var(--faint)'}">${icon(favOn ? 'starf' : 'star')}</button>` : ''}</h3>
      <div class="faint">ל-100 ${unit}: <span class="n">${fmt(view.per100.k)}</span> קלוריות · <span class="n">${fmt1(view.per100.p)}</span> גרם חלבון</div>
      <div class="preview"><span class="dnum" id="fsk">${fmt(n.k)}</span><span class="muted bold">קלוריות</span></div>
      <div class="macros" id="fsm">${macrosHtml(n)}</div>
      <div class="divider"></div>
      ${portions.length ? `<div class="chips wrap">
        ${portions.map((p, i) => `<button class="chip ${st.portion && st.portion.name === p.name ? 'on' : ''}" data-act="portion" data-i="${i}">${esc(p.name)} <span class="sub n">${fmt(p.grams)}</span></button>`).join('')}
        <button class="chip ${!st.portion ? 'on' : ''}" data-act="gmode">${unit}</button>
      </div>` : ''}
      ${st.portion ? `
        <div class="stepper" style="margin-top:8px">
          <button data-act="cminus" aria-label="פחות">${icon('minus')}</button>
          <input class="num" id="fscount" inputmode="decimal" value="${fmt1(st.count)}">
          <button data-act="cplus" aria-label="יותר">${icon('plus')}</button>
        </div>
        <div class="center faint" id="fsg" style="margin-top:4px">${esc(st.portion.name)} · סה״כ <span class="n">${fmt(st.grams)}</span> ${unit}</div>`
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
  };
  const refresh = () => {
    const n = C.nutrition(view.per100, st.grams);
    const k = $('#fsk'); if (k) k.textContent = fmt(n.k);
    const m = $('#fsm'); if (m) m.innerHTML = macrosHtml(n);
    const g = $('#fsg'); if (g && st.portion) g.innerHTML = `${esc(st.portion.name)} · סה״כ <span class="n">${fmt(st.grams)}</span> ${unit}`;
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
      const step = st.count < 1 || (act === 'cminus' && st.count <= 1) ? 0.5 : 1;
      st.count = Math.max(0.5, st.count + (act === 'cplus' ? step : -step));
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
      toast(`נרשם: ${food.name.split(',')[0]} · ${fmt(entries[0].k)}`, { label: 'ביטול', fn: () => undoEntries(entries) });
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
function openConfirmList(items, opts = {}) {
  const mode = opts.mode || 'log';          // 'log' | 'pick'
  const st = { slot: opts.slot || nowSlot(), items: items.map((x) => ({ ...x })) };
  const render = () => {
    const resolved = st.items.filter((x) => x.food && x.grams > 0);
    const total = resolved.reduce((a, x) => a + C.nutrition(x.food.per100, x.grams).k, 0);
    const body = openModal(`
      <h3>${esc(opts.title || 'לבדוק ולהוסיף')}</h3>
      ${opts.note ? `<div class="note" style="margin:-6px 0 8px">${opts.note}</div>` : ''}
      <div id="clrows">${st.items.map((x, i) => rowHtml(x, i)).join('')}</div>
      <div class="spread" style="margin:12px 2px">
        <button class="linkbtn" data-act="addrow">${icon('plus', 'sm')}עוד מאכל</button>
        <span class="bold">סה״כ <span class="dnum big" id="cltotal">${fmt(total)}</span> קלוריות</span>
      </div>
      ${mode === 'log' ? `<div class="seg">${C.SLOTS.map((s) => `<button class="${s === st.slot ? 'on' : ''}" data-act="slot" data-s="${s}">${C.SLOT_HE[s]}</button>`).join('')}</div>` : ''}
      <button class="btn block" data-act="save" style="margin-top:14px" ${resolved.length ? '' : 'disabled'}>${icon('check')}${esc(opts.saveLabel || (mode === 'log' ? 'להוסיף הכול' : 'להוסיף'))}</button>
    `);
    body.onclick = onClick;
    body.oninput = onInput;
  };
  const rowHtml = (x, i) => {
    if (!x.food) {
      return `<div class="confirmrow unres"><span class="dot none"></span>
        <div class="nm" data-act="pick" data-i="${i}"><div class="t">${esc(x.raw || 'מאכל')}</div><div class="s" style="color:var(--accent)">לא זוהה. לחצי לבחירה</div></div>
        <button class="iconbtn" data-act="del" data-i="${i}" aria-label="הסרה">${icon('x')}</button></div>`;
    }
    const n = C.nutrition(x.food.per100, x.grams || 0);
    const sub = x.portion ? `${x.portion.count === 1 ? '' : fmt1(x.portion.count) + ' × '}${esc(x.portion.name)}` : (x.estimated ? 'כמות משוערת' : (x.note || ''));
    return `<div class="confirmrow">${dot(x.food.per100.k, x.food.liquid)}
      <div class="nm" data-act="pick" data-i="${i}"><div class="t">${esc(x.food.name)}</div><div class="s">${sub}${x.estimated && x.portion ? ' · משוער' : ''}</div></div>
      <input class="num" inputmode="numeric" data-i="${i}" value="${Math.round(x.grams || 0)}" aria-label="גרמים">
      <span class="k n" id="clk${i}">${fmt(n.k)}</span>
      <button class="iconbtn" data-act="del" data-i="${i}" aria-label="הסרה">${icon('x')}</button></div>`;
  };
  const updateTotal = () => {
    const total = st.items.filter((x) => x.food).reduce((a, x) => a + C.nutrition(x.food.per100, x.grams || 0).k, 0);
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
    else if (act === 'pick' || act === 'addrow') {
      const idx = act === 'pick' ? +b.dataset.i : -1;
      const query = idx >= 0 ? (st.items[idx].query || (st.items[idx].food ? st.items[idx].food.name.split(',')[0] : st.items[idx].raw) || '') : '';
      openPicker({
        query,
        onPick: (view) => openFoodSheet(view, {
          mode: 'pick', pickLabel: 'לבחור',
          grams: idx >= 0 && st.items[idx].food ? st.items[idx].grams : null,
          onDone: ({ view: v, grams, portion }) => {
            const item = { food: v, grams, portion, raw: v.name };
            if (idx >= 0) st.items[idx] = item; else st.items.push(item);
            render();
          },
        }),
        onCancel: render,
      });
    } else if (act === 'save') {
      const list = st.items.filter((x) => x.food && x.grams > 0);
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
      <label class="field"><span>שם המנה</span><input id="mfpn" value="${esc(v.portion ? v.portion.name : '')}" placeholder="יחידה / פרוסה"></label>
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
async function barcodeSupported() {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices) return false;
  try { const f = await BarcodeDetector.getSupportedFormats(); return f.includes('ean_13'); } catch (_) { return false; }
}
async function openBarcode(opts = {}) {
  const canScan = await barcodeSupported();
  const body = openModal(`
    <h3>סריקת ברקוד</h3>
    ${canScan ? `<video class="scan" id="bcvideo" playsinline muted></video>
      <div class="center faint" style="margin:6px 0 12px">מכוונים את המצלמה לברקוד שעל האריזה</div>` : ''}
    <label class="field"><span>${canScan ? 'או להקליד את המספר' : 'המספר שמתחת לברקוד'}</span>
      <input class="num" id="bccode" inputmode="numeric" placeholder="7290000000000"></label>
    <button class="btn block" data-act="go">${icon('search')}לחפש</button>`);
  body.onclick = (ev) => {
    if (ev.target.closest('[data-act="go"]')) {
      const code = ($('#bccode').value || '').replace(/\D/g, '');
      if (code.length < 8) { toast('מספר ברקוד קצר מדי'); return; }
      stopCamera(); lookupBarcode(code, opts);
    }
  };
  if (canScan) {
    try {
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      const video = $('#bcvideo');
      if (!video) { stopCamera(); return; }
      video.srcObject = camStream;
      await video.play();
      const tick = async () => {
        if (!camStream) return;
        try {
          const codes = await det.detect(video);
          if (codes.length && codes[0].rawValue) { const c = codes[0].rawValue; vibrate(30); stopCamera(); lookupBarcode(c, opts); return; }
        } catch (_) {}
        camTimer = setTimeout(tick, 220);
      };
      tick();
    } catch (e) {
      stopCamera();
      const v = $('#bcvideo'); if (v) v.remove();
      toast('אין גישה למצלמה. אפשר להקליד את המספר');
    }
  }
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
  bar.hidden = !show;
  document.body.classList.toggle('has-basket', show);
  if (!show) return;
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
  await loadLibrary();
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
