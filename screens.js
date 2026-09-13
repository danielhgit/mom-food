/* צלחת — screens. Each view renders into #view and wires its own delegated
   listeners on VIEW (the router clears them between screens). */

const ROUTES = {
  '': () => viewDay(today()),
  day: (p) => viewDay(p[1] || today()),
  add: viewAdd,
  recipes: viewRecipes,
  recipe: viewRecipe,
  meal: viewMeal,
  progress: viewProgress,
  history: viewHistory,
  insights: viewInsights,
  more: viewMore,
  settings: viewSettings,
  backup: viewBackup,
  setup: viewSetup,
};

/* ================= shared context ================= */
async function loadContext() {
  const t = today();
  const [weights, measurements, days, recent] = await Promise.all([
    DB.all('weights'), DB.all('measurements'), DB.all('days'),
    DB.range('entries', 'date', C.addDays(t, -120), t),
  ]);
  const totals = C.dayTotals(recent);
  const closedSet = new Set(days.filter((d) => d.closed).map((d) => d.date));
  const kg = C.kgNow(APP.profile, weights, t);
  const target = C.targetFor(APP.profile, kg, t);
  const pGoal = C.proteinTarget(APP.profile, kg);
  return { t, weights, measurements, days, recent, totals, closedSet, kg, target, pGoal };
}
function portionGrams(f) {
  if (f.lastPortion && f.lastPortion.grams) return f.lastPortion.grams * (f.lastPortion.count || 1);
  return f.lastGrams || 100;
}
function shortName(name) { return String(name).split(',')[0]; }
/* "דג סלמון אפוי ללא תוספת שומן בבישול" → "דג סלמון אפוי" for tight spots. */
function compactName(name) {
  const words = shortName(name).trim().split(/\s+/);
  return words.length > 3 ? words.slice(0, 3).join(' ') : words.join(' ');
}
function ringSvg(pct, color) {
  const r = 62, c = 2 * Math.PI * r, p = Math.min(1, Math.max(0, pct));
  return `<svg viewBox="0 0 150 150" aria-hidden="true">
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--inset)" stroke-width="13"/>
    ${p > 0 ? `<circle cx="75" cy="75" r="${r}" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}"/>` : ''}
  </svg>`;
}
function pickImage() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
    inp.onchange = () => resolve(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}

/* ================= today / day ================= */
async function viewDay(date) {
  const ctx = await loadContext();
  if (date > ctx.t) { location.replace('#/'); return; }
  const isToday = date === ctx.t;
  const entries = (await DB.byIndex('entries', 'date', date)).sort((a, b) => (a.time < b.time ? -1 : 1));
  const dayRec = ctx.days.find((d) => d.date === date);
  const closed = !!(dayRec && dayRec.closed);
  setTitle(isToday ? 'היום' : fmtDateLong(date));
  const tot = C.sum(entries);
  const target = ctx.target;
  const remaining = target - tot.k;
  const hour = new Date().getHours();
  const evening = isToday && hour >= 16 && !closed && remaining > 0;
  const dinnerLogged = entries.some((e) => e.slot === 'dinner');
  let html = '';

  /* --- one-tap re-log --- */
  const slotNow = nowSlot();
  let quick = [];
  if (isToday && !closed) {
    quick = libFoods().filter((f) => f.useCount > 0 || (f.slotCounts && f.slotCounts[slotNow] > 0))
      .sort((a, b) => ((b.slotCounts?.[slotNow] || 0) - (a.slotCounts?.[slotNow] || 0)) || ((b.lastUsed || 0) - (a.lastUsed || 0)))
      .slice(0, 6);
    if (quick.length) {
      html += `<div class="spread" style="margin:0 4px 6px"><span class="bold">לרשום שוב ל${C.SLOT_HE[slotNow]}</span><span class="faint">לחיצה אחת</span></div>
        <div class="chips" style="margin-bottom:6px">${quick.map((f) => {
          const g = portionGrams(f);
          const sub = f.lastPortion ? `${f.lastPortion.count && f.lastPortion.count !== 1 ? fmt1(f.lastPortion.count) + ' × ' : ''}${esc(f.lastPortion.name)}` : `${fmt(g)} ${f.liquid ? 'מ״ל' : 'גרם'}`;
          return `<button class="chip quick" data-act="quick" data-id="${f.id}">
            <span class="t">${dot(f.per100.k, f.liquid)}<span class="tt">${esc(compactName(f.name))}</span></span>
            <span class="sub">${sub} · ${fmt(C.nutrition(f.per100, g).k)}</span></button>`;
        }).join('')}</div>`;
    } else if (!entries.length) {
      html += `<div class="card soft"><h3>שמחה שאת כאן</h3>
        <p class="note">מתחילים פשוט: רושמים את מה שאוכלים היום. כל מאכל שתרשמי נשמר, ובפעם הבאה הוא יופיע כאן ללחיצה אחת.</p>
        <a class="btn block" href="#/add" style="margin-top:10px">${icon('plus')}לרשום את הארוחה הראשונה</a></div>`;
    }
  }

  /* --- hero --- */
  const pct = tot.k / target;
  const color = pct > 1 ? 'var(--accent2)' : pct > 0.9 ? 'var(--dens-y)' : 'var(--good)';
  let mid;
  if (remaining < 0) mid = `<span class="dnum" style="color:var(--accent)">+${fmt(-remaining)}</span><span class="lbl">מעל היעד</span>`;
  else if (evening) mid = `<span class="dnum">${fmt(remaining)}</span><span class="lbl">נשאר לערב</span>`;
  else mid = `<span class="dnum">${fmt(remaining)}</span><span class="lbl">נשארו</span>`;
  const weekAvg = C.weekAverage(ctx.totals, ctx.closedSet, date, ctx.t);
  const streakDays = C.streak(C.loggedSet(ctx.totals, ctx.closedSet), ctx.t);
  html += `<div class="card hero">
    <div class="ringwrap">
      <div class="ring">${ringSvg(pct, color)}<div class="mid">${mid}</div></div>
      <div class="heroside">
        <div class="line"><span class="muted">אכלת</span> <b class="dnum big">${fmt(tot.k)}</b> <span class="muted">מתוך</span> <b class="n">${fmt(target)}</b></div>
        <div class="line small muted">חלבון <b class="n" style="color:var(--text)">${fmt(tot.p)}</b> מתוך <span class="n">${fmt(ctx.pGoal)}</span> גרם</div>
        <div class="bar" style="margin:4px 0 10px"><div style="width:${Math.min(100, tot.p / ctx.pGoal * 100)}%"></div></div>
        <div class="row wrap" style="gap:6px">
          ${weekAvg ? `<span class="pill ${weekAvg.avg <= target ? 'good' : ''}">${icon('calendar')}השבוע <span class="n">${fmt(weekAvg.avg)}</span></span>` : ''}
          ${isToday && streakDays >= 2 ? `<span class="pill gold">${icon('flame')}<span class="n">${streakDays}</span> ימים ברצף</span>` : ''}
        </div>
      </div>
    </div>
    ${remaining < 0 ? `<p class="note" style="margin-top:10px">${isToday ? 'מעל היעד היום. מחר יום חדש, ומה שקובע הוא הממוצע של השבוע.' : 'באותו יום היית מעל היעד.'}</p>` : ''}
    <div id="combos"></div>
  </div>`;

  /* --- weighing --- */
  if (isToday) {
    const todayW = ctx.weights.find((w) => w.date === ctx.t);
    const waists = ctx.measurements.filter((m) => m.waistCm).sort((a, b) => (a.date < b.date ? -1 : 1));
    const lastWaist = waists[waists.length - 1];
    const measureDay = APP.profile.measureDay ?? 0;
    if (new Date().getDay() === measureDay && (!todayW || !lastWaist || C.diffDays(lastWaist.date, ctx.t) >= 6)) {
      html += `<div class="card gold"><h3 class="row">${icon('tape')}היום יום המדידה</h3>
        <p class="note">פעם בשבוע, בבוקר ולפני האוכל. ההיקף מראה ירידה בשומן גם כשהמשקל מתעקש.</p>
        <div class="grid2" style="margin-top:8px">
          <label class="field"><span>משקל (ק״ג)</span><input class="num" id="mw" inputmode="decimal" value="${todayW ? todayW.kg : ''}"></label>
          <label class="field"><span>מותניים (ס״מ)</span><input class="num" id="mwaist" inputmode="decimal" value="${lastWaist && lastWaist.date === ctx.t ? lastWaist.waistCm : ''}"></label>
        </div>
        <button class="btn block" data-act="measure">${icon('check')}לשמור</button></div>`;
    } else if (!todayW && hour < 13) {
      html += `<div class="linkrow" data-act="weigh" style="border:none">${icon('scale')}<span>לרשום משקל בוקר</span><span class="faint">(לא חובה)</span>${icon('chev', 'chev')}</div>`;
    }
  }

  /* --- meals --- */
  const prevBySlot = {};
  for (const s of C.SLOTS) {
    const prev = ctx.recent.filter((e) => e.slot === s && e.date < date && C.diffDays(e.date, date) <= 14);
    if (prev.length) {
      const d = prev.reduce((m, e) => (e.date > m ? e.date : m), '');
      prevBySlot[s] = { date: d, entries: prev.filter((e) => e.date === d) };
    }
  }
  for (const s of C.SLOTS) {
    const list = entries.filter((e) => e.slot === s);
    if (s === 'snack' && !list.length && (!isToday || closed)) continue;
    const st = C.sum(list);
    const prev = prevBySlot[s];
    const canAdd = !closed;
    html += `<div class="card slot ${list.length ? '' : 'empty-slot'}">
      <div class="slothead">
        <span class="name">${C.SLOT_HE[s]}</span>
        ${list.length ? `<span class="kc n">${fmt(st.k)}</span>` : ''}
        ${st.p >= (APP.profile.proteinPerMeal || 25) ? `<span class="pill good">${icon('check')}חלבון</span>` : ''}
        <span class="grow"></span>
        ${canAdd && prev ? `<button class="linkbtn" data-act="copyslot" data-s="${s}">${icon('copy', 'sm')}${C.diffDays(prev.date, date) === 1 ? 'כמו אתמול' : 'כמו ב' + fmtDateShort(prev.date)}</button>` : ''}
        ${canAdd ? `<a class="iconbtn" href="#/add?slot=${s}${isToday ? '' : '&date=' + date}" aria-label="להוסיף ל${C.SLOT_HE[s]}" style="color:var(--accent)">${icon('plus')}</a>` : ''}
      </div>
      ${list.length ? entriesHtml(list) : ''}
      ${list.length >= 2 && !list.every((e) => e.mealId) ? `<button class="linkbtn small" data-act="savemeal" data-s="${s}">${icon('book', 'sm')}לשמור כמנה קבועה</button>` : ''}
    </div>`;
  }

  /* --- end of day --- */
  if (isToday && entries.length && !closed) {
    html += `<button class="btn block ghost" data-act="close" style="margin-top:4px">${icon('moon')}סיימתי את היום</button>`;
  } else if (closed) {
    html += `<div class="card good"><h3 class="row">${icon('check')}${isToday ? 'היום סגור' : 'היום נסגר'}</h3>
      ${dayRec.coachNote ? `<p class="note" style="color:var(--text)">${esc(dayRec.coachNote)}</p>` : ''}
      ${isToday ? `<button class="linkbtn" data-act="reopen">לפתוח מחדש</button>` : ''}</div>`;
  }
  if (!isToday && entries.length) {
    html += `<button class="btn block ghost" data-act="copyday" style="margin-top:4px">${icon('copy')}להעתיק את כל היום להיום</button>`;
  }
  setView(html);

  /* --- evening suggestions --- */
  let combos = [];
  if (evening && !dinnerLogged) {
    const dinnerFoods = libFoods().filter((f) => (f.slotCounts?.dinner || 0) > 0)
      .sort((a, b) => b.slotCounts.dinner - a.slotCounts.dinner)
      .map((f) => { const g = portionGrams(f); const n = C.nutrition(f.per100, g); return { id: f.id, name: compactName(f.name), k: n.k, p: n.p, grams: g, food: f }; });
    combos = C.eveningCombos(dinnerFoods, remaining);
    if (combos.length) {
      $('#combos').innerHTML = `<div class="divider"></div><div class="bold small" style="margin-bottom:6px">מה נכנס הערב</div>
        <div class="chips wrap">${combos.map((c, i) => `<button class="chip" data-act="combo" data-i="${i}">${c.items.map((x) => esc(x.name)).join(' + ')} <span class="sub n">${fmt(c.k)}</span></button>`).join('')}</div>`;
    }
  }

  VIEW.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'quick') {
      const f = APP.libById.get(b.dataset.id);
      const g = portionGrams(f);
      const es = await logFoods([{ food: f, grams: g, portion: f.lastPortion }], { slot: slotNow });
      vibrate();
      toast(`נרשם: ${shortName(f.name)} · ${fmt(es[0].k)}`, { label: 'ביטול', fn: () => undoEntries(es) });
      rerender();
    } else if (act === 'entry') {
      const e = entries.find((x) => x.id === b.dataset.id);
      if (e) openEntrySheet(e);
    } else if (act === 'copyslot') {
      const prev = prevBySlot[b.dataset.s];
      const copies = await copyEntries(prev.entries, { date, slot: b.dataset.s });
      vibrate();
      toast(`הועתקו ${copies.length} מאכלים`, { label: 'ביטול', fn: () => undoEntries(copies) });
      rerender();
    } else if (act === 'combo') {
      const c = combos[+b.dataset.i];
      openConfirmList(c.items.map((x) => ({ food: S.viewLib(x.food), grams: x.grams, portion: x.food.lastPortion })), { title: 'ארוחת ערב', slot: 'dinner' });
    } else if (act === 'measure') {
      const kg = num($('#mw').value), waist = num($('#mwaist').value);
      if (kg != null && (kg < 30 || kg > 300)) { toast('המשקל נראה לא נכון'); return; }
      if (kg != null) await DB.put('weights', { date: ctx.t, kg: C.r1(kg) });
      if (waist != null) await DB.put('measurements', { date: ctx.t, waistCm: C.r1(waist) });
      afterDataChange(ctx.t); vibrate(); toast('נשמר. אפשר לראות את המגמה במסך ההתקדמות');
      rerender();
    } else if (act === 'weigh') {
      openWeighSheet(ctx);
    } else if (act === 'savemeal') {
      const list = entries.filter((e) => e.slot === b.dataset.s && e.foodId);
      openSaveMealSheet(list, C.SLOT_HE[b.dataset.s]);
    } else if (act === 'close') {
      openCloseDay(ctx, date, entries);
    } else if (act === 'reopen') {
      await DB.put('days', { ...dayRec, closed: false });
      rerender();
    } else if (act === 'copyday') {
      const copies = await copyEntries(entries, { date: ctx.t });
      toast(`הועתקו ${copies.length} מאכלים להיום`, { label: 'ביטול', fn: () => undoEntries(copies) });
      location.hash = '#/';
    }
  };
}

function entriesHtml(list) {
  let html = '', lastMeal = null;
  for (const e of list) {
    if (e.mealId && e.mealId !== lastMeal) {
      html += `<div class="mealtag">${icon('book', 'sm')}${esc(e.mealName || 'מנה קבועה')}</div>`;
    }
    lastMeal = e.mealId || null;
    const k100 = e.per100 ? e.per100.k : (e.grams ? e.k * 100 / e.grams : null);
    html += `<div class="entry ${e.mealId ? 'sub' : ''}" data-act="entry" data-id="${e.id}">
      ${e.quick ? `<span style="color:var(--faint)">${icon('bolt', 'sm')}</span>` : dot(k100, e.liquid)}
      <div class="nm"><div class="t">${esc(e.name)}</div><div class="s">${amountLabel(e)}</div></div>
      <span class="k n">${fmt(e.k)}</span></div>`;
  }
  return html;
}

function openWeighSheet(ctx) {
  const last = [...ctx.weights].sort((a, b) => (a.date < b.date ? -1 : 1)).pop();
  const body = openModal(`<h3>משקל הבוקר</h3>
    <p class="note">כדאי אחרי השירותים ולפני האוכל. המספר של יום אחד קופץ, הממוצע השבועי הוא מה שחשוב.</p>
    <label class="field"><span>ק״ג</span><input class="num" id="wkg" inputmode="decimal" placeholder="${last ? last.kg : ''}"></label>
    <button class="btn block" data-act="save">${icon('check')}לשמור</button>`);
  setTimeout(() => $('#wkg') && $('#wkg').focus(), 250);
  body.onclick = async (ev) => {
    if (!ev.target.closest('[data-act="save"]')) return;
    const kg = num($('#wkg').value);
    if (kg == null || kg < 30 || kg > 300) { toast('המשקל נראה לא נכון'); return; }
    await DB.put('weights', { date: ctx.t, kg: C.r1(kg) });
    afterDataChange(ctx.t);
    closeModal(); vibrate();
    const note = C.scaleNote({ weights: [...ctx.weights.filter((w) => w.date !== ctx.t), { date: ctx.t, kg: C.r1(kg) }], measurements: ctx.measurements, today: ctx.t });
    toast(note && note.startsWith('השקילה') ? 'נשמר. השקילה קצת גבוהה, זה מים. הממוצע קובע' : 'נשמר');
    rerender();
  };
}

function openSaveMealSheet(entries, slotName) {
  const body = openModal(`<h3>לשמור כמנה קבועה</h3>
    <p class="note">בפעם הבאה תוכלי לרשום את כל ${entries.length} המאכלים בלחיצה אחת.</p>
    <label class="field"><span>שם המנה</span><input id="mname" value="${esc(slotName + ' רגיל')}"></label>
    <button class="btn block" data-act="save">${icon('check')}לשמור</button>`);
  body.onclick = async (ev) => {
    if (!ev.target.closest('[data-act="save"]')) return;
    const name = $('#mname').value.trim();
    if (!name) { toast('צריך שם'); return; }
    const meal = { id: uid('m'), name, items: entries.map((e) => ({ foodId: e.foodId, name: e.name, grams: e.grams, portion: e.portion })), useCount: 0, lastUsed: 0 };
    await DB.put('meals', meal);
    APP.meals.push(meal);
    closeModal(); toast('נשמר במנות הקבועות');
  };
}

function openCloseDay(ctx, date, entries) {
  const tot = C.sum(entries);
  const closedPlus = new Set([...ctx.closedSet, date]);
  const weekAvg = C.weekAverage(ctx.totals, closedPlus, date, ctx.t);
  const streakDays = C.streak(C.loggedSet(ctx.totals, [...closedPlus]), ctx.t);
  const tdee = C.currentTdee(APP.profile, ctx.kg, ctx.t);
  const avg7 = C.avgWindow(ctx.weights, ctx.t, 7) ?? ctx.kg;
  let note = C.coachLocal({ kcal: tot.k, target: ctx.target, protein: tot.p, proteinGoal: ctx.pGoal, weekAvg, streakDays });
  // only for a fully logged day: a half-logged 900 kcal day would promise a fantasy
  const forecast = entries.length >= 3 && tot.k >= ctx.target * 0.8 && tot.k < tdee ? C.forecast(avg7, tdee, tot.k) : null;
  const body = openModal(`<h3>סיכום היום</h3>
    <div class="card flat" style="margin-bottom:10px">
      <div class="kv"><span>קלוריות</span><b><span class="n">${fmt(tot.k)}</span> מתוך <span class="n">${fmt(ctx.target)}</span></b></div>
      <div class="kv"><span>חלבון</span><b><span class="n">${fmt(tot.p)}</span> גרם</b></div>
      ${weekAvg ? `<div class="kv"><span>ממוצע השבוע</span><b class="n">${fmt(weekAvg.avg)}</b></div>` : ''}
      ${streakDays >= 2 ? `<div class="kv"><span>ימים ברצף</span><b class="n">${streakDays}</b></div>` : ''}
    </div>
    ${forecast != null && forecast < avg7 ? `<div class="card good note" style="color:var(--text)">אם כל יום ייראה כמו היום, בעוד 5 שבועות המשקל יהיה בערך <b class="n">${fmt1(forecast)}</b> ק״ג.</div>` : ''}
    <div class="card gold"><div class="row" style="align-items:flex-start">${icon('sparkle')}<span id="coach" class="grow">${esc(note)}</span></div></div>
    <button class="btn block goodbtn" data-act="close">${icon('check')}לסגור את היום</button>`);
  if (window.AI && AI.enabled() && APP.ui.aiEnabled !== false && online()) {
    AI.coach({ kind: 'day', kcal: tot.k, target: ctx.target, protein: tot.p, proteinGoal: ctx.pGoal,
      weekAvg: weekAvg && weekAvg.avg, streak: streakDays,
      weightTrend: C.avgWindow(ctx.weights, C.addDays(ctx.t, -7), 7) != null ? C.r1(avg7 - C.avgWindow(ctx.weights, C.addDays(ctx.t, -7), 7)) : null,
      slots: C.dayTotals(entries).get(date)?.slots,
    }).then((txt) => { if (txt && $('#coach')) { note = txt; $('#coach').textContent = txt; } }).catch(() => {});
  }
  body.onclick = async (ev) => {
    if (!ev.target.closest('[data-act="close"]')) return;
    await DB.put('days', { date, closed: true, closedAt: Date.now(), coachNote: note });
    afterDataChange(date);
    if (window.Cloud && Cloud.enabled()) Cloud.backup(true).catch(() => {});
    closeModal(); vibrate([20, 40, 20]);
    toast('לילה טוב. היום נשמר');
    rerender();
  };
}

/* ================= add ================= */
async function viewAdd(parts, params) {
  const date = params.date && params.date <= today() ? params.date : today();
  let slot = params.slot || nowSlot();
  const aiOn = !!(window.AI && AI.enabled() && APP.ui.aiEnabled !== false);
  setTitle(date === today() ? 'הוספה' : 'הוספה ל' + relDay(date));
  const dayEntries = await DB.byIndex('entries', 'date', date);
  const slotSum = () => C.sum(dayEntries.filter((e) => e.slot === slot)).k;

  setView(`
    <div class="seg" id="aslot">${C.SLOTS.map((s) => `<button class="${s === slot ? 'on' : ''}" data-act="slot" data-s="${s}">${C.SLOT_HE[s]}</button>`).join('')}</div>
    <div class="faint center" id="asum" style="margin:6px 0 10px"></div>

    <div class="searchbox">${icon('search')}<input type="search" id="q" placeholder="לחפש מאכל" autocomplete="off"></div>

    <div id="extras">
      <div class="card" style="margin-top:12px">
        <div class="bold" style="margin-bottom:6px">או לכתוב או להגיד כמה מאכלים</div>
        <textarea id="ft" rows="2" placeholder="2 ביצים, פרוסת חלה, 30 גרם בולגרית"></textarea>
        <div class="row" style="margin-top:8px">
          ${speechSupported() ? `<button class="btn ghost" data-act="mic" aria-label="להגיד בקול" style="padding:0 16px">${icon('mic')}להגיד</button>` : ''}
          <button class="btn grow" data-act="ft">${icon('check')}להמשיך</button>
        </div>
      </div>
      <div class="actions">${[
        `<button class="action" data-act="barcode">${icon('barcode')}לסרוק ברקוד</button>`,
        aiOn ? `<button class="action" data-act="plate">${icon('camera')}לצלם צלחת</button>` : '',
        aiOn ? `<button class="action" data-act="label">${icon('label')}לצלם תווית</button>` : '',
        `<button class="action" data-act="quickk">${icon('bolt')}רק קלוריות</button>`,
        APP.meals.length ? `<button class="action" data-act="meals">${icon('book')}מנה קבועה</button>` : '',
        `<button class="action" data-act="manual">${icon('pen')}מאכל חדש</button>`,
      ].filter(Boolean).map((h, i, arr) => (arr.length % 2 && i === arr.length - 1 ? h.replace('class="action"', 'class="action wide"') : h)).join('')}</div>
      <label class="row small muted" style="min-height:44px;margin:0 4px">
        <input type="checkbox" id="plan" ${APP.planMode ? 'checked' : ''} style="width:22px;height:22px">
        לתכנן לפני שאוכלים (מוסיפים לסל ורואים כמה יישאר)</label>
    </div>
    <div id="res" style="margin-top:6px"></div>
  `);
  const updSum = () => {
    const k = slotSum();
    $('#asum').textContent = k ? `ב${C.SLOT_HE[slot]} ${date === today() ? 'היום' : ''} כבר נרשמו ${fmt(k)} קלוריות` : `מוסיפים ל${C.SLOT_HE[slot]}`;
  };
  updSum();
  const draw = async () => {
    const q = $('#q').value;
    const ex = $('#extras'); if (ex) ex.hidden = !!q.trim();
    APP.results = await searchFoods(q, { libLimit: 8, mohLimit: 25 });
    if ($('#res')) $('#res').innerHTML = resultsHtml(APP.results, q);
  };
  draw();
  const afterLog = (es) => { dayEntries.push(...es); updSum(); };

  let t = null;
  VIEW.oninput = (ev) => { if (ev.target.id === 'q') { clearTimeout(t); t = setTimeout(draw, 140); } };
  VIEW.onchange = (ev) => { if (ev.target.id === 'plan') { APP.planMode = ev.target.checked; saveBasket(); } };
  VIEW.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const sheetOpts = { slot, date, onDone: afterLog };
    if (act === 'slot') {
      slot = b.dataset.s;
      document.querySelectorAll('#aslot button').forEach((x) => x.classList.toggle('on', x.dataset.s === slot));
      updSum();
    } else if (act === 'res') {
      openFoodSheet(APP.results[+b.dataset.i], sheetOpts);
    } else if (act === 'mic') {
      dictate((txt) => { $('#ft').value = ($('#ft').value ? $('#ft').value + ', ' : '') + txt; freeText(); }, b);
    } else if (act === 'ft') {
      freeText();
    } else if (act === 'barcode') {
      openBarcode(sheetOpts);
    } else if (act === 'manual') {
      openManualFood({ onSaved: (f) => openFoodSheet(S.viewLib(f), sheetOpts) });
    } else if (act === 'quickk') {
      openQuickKcal({ slot, date });
    } else if (act === 'meals') {
      openMealsPicker({ slot, date });
    } else if (act === 'plate') {
      const file = await pickImage(); if (!file) return;
      openModal(`<h3>מסתכלת על הצלחת…</h3><div class="sk" style="height:90px"></div>`);
      try {
        const items = await AI.plate(file, libFoods());
        if (!items.length) { closeModal(); toast('לא הצלחתי לזהות. אפשר לכתוב במילים'); return; }
        openConfirmList(items, { title: 'זה מה שראיתי', note: 'הערכה בלבד. כדאי לתקן כמויות אם צריך.', slot, date, onSaved: () => goHome() });
      } catch (e) { closeModal(); toast(aiErrorText(e)); }
    } else if (act === 'label') {
      const file = await pickImage(); if (!file) return;
      openModal(`<h3>קוראת את התווית…</h3><div class="sk" style="height:90px"></div>`);
      try {
        const v = await AI.label(file);
        openManualFood({ prefill: { ...v, source: 'label' }, note: 'אלה המספרים שקראתי מהתווית. כדאי להשוות ואז לשמור.', onSaved: (f) => openFoodSheet(S.viewLib(f), sheetOpts) });
      } catch (e) { closeModal(); toast(aiErrorText(e)); }
    }
  };

  async function freeText() {
    const text = $('#ft').value.trim();
    if (!text) { toast('כתבי מה אכלת'); $('#ft').focus(); return; }
    openModal(`<h3>רגע, מסדרת…</h3><div class="sk" style="height:90px"></div>`);
    let items = null, note = '';
    if (aiOn && online()) {
      try { items = await AI.describe(text, libFoods()); } catch (e) { note = 'העזרה החכמה לא זמינה כרגע, זה פענוח בסיסי.'; }
    }
    if (!items || !items.length) {
      const moh = await loadMoh().catch(() => []);
      items = Parse.parse(text, { lib: libViews(), moh });
    }
    if (!items.length) { closeModal(); toast('לא הבנתי. אפשר לנסות לחפש מאכל'); return; }
    openConfirmList(items, { title: 'זה מה שהבנתי', note, slot, date, onSaved: (es) => { $('#ft').value = ''; afterLog(es); } });
  }
}
function aiErrorText(e) {
  if (e && (e.status === 429 || e.status === 503)) return 'העזרה החכמה עמוסה, אפשר לנסות שוב בעוד דקה';
  if (!online()) return 'אין אינטרנט כרגע';
  return 'לא הצלחתי. אפשר לנסות שוב או לכתוב במילים';
}
function openMealsPicker({ slot, date }) {
  const meals = [...APP.meals].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  const body = openModal(`<h3>מנה קבועה</h3>
    ${meals.map((m, i) => `<div class="item" data-i="${i}">${icon('book')}<div class="nm"><div class="t">${esc(m.name)}</div>
      <div class="s">${m.items.length} מאכלים · <span class="n">${fmt(mealKcal(m))}</span> קלוריות</div></div></div>`).join('')}`);
  body.onclick = (ev) => {
    const it = ev.target.closest('[data-i]'); if (!it) return;
    logMealFlow(meals[+it.dataset.i], { slot, date });
  };
}
function mealItems(m) {
  return m.items.map((x) => ({ food: APP.libById.get(x.foodId), grams: x.grams, portion: x.portion }))
    .filter((x) => x.food).map((x) => ({ ...x, food: S.viewLib(x.food) }));
}
function mealKcal(m) { return mealItems(m).reduce((a, x) => a + C.nutrition(x.food.per100, x.grams).k, 0); }
function logMealFlow(m, { slot, date } = {}) {
  openConfirmList(mealItems(m), {
    title: m.name, slot, date, mealId: m.id, mealName: m.name,
    onSaved: async () => { m.useCount = (m.useCount || 0) + 1; m.lastUsed = Date.now(); await DB.put('meals', m); goHome(); },
  });
}

/* ================= recipes & ready meals ================= */
async function viewRecipes(parts, params) {
  const tab = params.tab === 'meals' ? 'meals' : 'recipes';
  setTitle('מתכונים ומנות');
  let html = `<div class="seg" style="margin-bottom:12px">
    <button class="${tab === 'recipes' ? 'on' : ''}" data-act="tab" data-t="recipes">מתכונים</button>
    <button class="${tab === 'meals' ? 'on' : ''}" data-act="tab" data-t="meals">מנות קבועות</button></div>`;
  if (tab === 'recipes') {
    html += `<p class="note" style="margin:0 4px 10px">מתכון הוא מאכל שבישלת בעצמך, כמו הדג שלך. כותבים אותו פעם אחת, ואחר כך רק רושמים כמה גרם אכלת.</p>
      <a class="btn block soft" href="#/recipe/new" style="margin-bottom:12px">${icon('plus')}מתכון חדש</a>`;
    const rs = [...APP.recipes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    html += rs.length ? rs.map((r) => {
      const f = APP.lib.find((x) => x.recipeId === r.id && !x.hidden);
      return `<div class="item" data-act="open" data-id="${r.id}">${dot(r.per100.k, false)}
        <div class="nm"><div class="t">${esc(r.name)}</div><div class="s">ל-100 גרם: <span class="n">${fmt(r.per100.k)}</span> קלוריות · ${r.ingredients.length} רכיבים</div></div>
        ${f ? `<button class="btn small soft" data-act="log" data-id="${f.id}">לרשום</button>` : ''}</div>`;
    }).join('') : `<div class="empty">${icon('book', 'lg')}<br>עוד אין מתכונים</div>`;
  } else {
    html += `<p class="note" style="margin:0 4px 10px">מנה קבועה היא כמה מאכלים שאוכלים יחד, כמו ארוחת הבוקר הרגילה. נרשמת בלחיצה אחת. אפשר גם לשמור מנה ישר ממסך היום.</p>
      <a class="btn block soft" href="#/meal/new" style="margin-bottom:12px">${icon('plus')}מנה חדשה</a>`;
    const ms = [...APP.meals].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
    html += ms.length ? ms.map((m) => `<div class="item" data-act="openmeal" data-id="${m.id}">${icon('book')}
        <div class="nm"><div class="t">${esc(m.name)}</div><div class="s">${m.items.length} מאכלים · <span class="n">${fmt(mealKcal(m))}</span> קלוריות</div></div>
        <button class="btn small soft" data-act="logmeal" data-id="${m.id}">לרשום</button></div>`).join('')
      : `<div class="empty">${icon('book', 'lg')}<br>עוד אין מנות קבועות</div>`;
  }
  setView(html);
  VIEW.onclick = (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'tab') location.replace('#/recipes?tab=' + b.dataset.t);
    else if (act === 'log') { ev.stopPropagation(); openFoodSheet(S.viewLib(APP.libById.get(b.dataset.id)), { returnTo: '#/' }); }
    else if (act === 'open') location.hash = '#/recipe/' + b.dataset.id;
    else if (act === 'openmeal') location.hash = '#/meal/' + b.dataset.id;
    else if (act === 'logmeal') { ev.stopPropagation(); logMealFlow(APP.meals.find((m) => m.id === b.dataset.id)); }
  };
}

async function viewRecipe(parts) {
  const id = parts[1] || 'new';
  if (!APP.draft || APP.draft.kind !== 'recipe' || APP.draft.id !== id) {
    if (id === 'new') {
      APP.draft = { kind: 'recipe', id, name: '', ingredients: [], cookedWeight: '', portionGrams: '' };
    } else {
      const r = APP.recipes.find((x) => x.id === id);
      if (!r) { location.replace('#/recipes'); return; }
      APP.draft = { kind: 'recipe', id, name: r.name, ingredients: r.ingredients.map((x) => ({ ...x })),
        cookedWeight: r.cookedWeight || '', portionGrams: r.portion ? r.portion.grams : '' };
    }
  }
  const d = APP.draft;
  setTitle(id === 'new' ? 'מתכון חדש' : 'עריכת מתכון');
  const summary = () => {
    const rn = C.recipeNutrition(d.ingredients, d.cookedWeight);
    if (!d.ingredients.length) return '<div class="faint center">מוסיפים רכיבים ורואים כאן את הערכים</div>';
    return `<div class="spread"><span class="bold">בכל המתכון</span><span><b class="n">${fmt(rn.total.k)}</b> קלוריות · <span class="n">${fmt(rn.weight)}</span> גרם</span></div>
      <div class="preview">${dot(rn.per100.k, false)}<span class="dnum">${fmt(rn.per100.k)}</span><span class="muted bold">קלוריות ל-100 גרם</span></div>
      <div class="macros">${macrosHtml(rn.per100)}</div>
      ${num(d.portionGrams) ? `<div class="center small" style="margin-top:6px">מנה של <span class="n">${fmt(num(d.portionGrams))}</span> גרם = <b class="n">${fmt(rn.per100.k * num(d.portionGrams) / 100)}</b> קלוריות</div>` : ''}
      ${!num(d.cookedWeight) ? '<div class="faint center" style="margin-top:6px">בלי משקל אחרי בישול, החישוב לפי משקל הרכיבים</div>' : ''}`;
  };
  const ingHtml = () => d.ingredients.map((x, i) => `<div class="confirmrow">${dot(x.per100.k, x.liquid)}
      <div class="nm"><div class="t">${esc(x.name)}</div><div class="s">${x.portion ? `${x.portion.count === 1 ? '' : fmt1(x.portion.count) + ' × '}${esc(x.portion.name)}` : ''}</div></div>
      <input class="num" inputmode="numeric" data-ing="${i}" value="${Math.round(x.grams)}" aria-label="גרמים">
      <span class="k n" id="ik${i}">${fmt(C.nutrition(x.per100, x.grams).k)}</span>
      <button class="iconbtn" data-act="rm" data-i="${i}" aria-label="הסרה">${icon('x')}</button></div>`).join('');
  setView(`
    <label class="field"><span>שם המתכון</span><input id="rname" value="${esc(d.name)}" placeholder="למשל: דג ברוטב עגבניות"></label>
    <div class="card">
      <h3>רכיבים</h3>
      <div id="ings">${ingHtml() || '<div class="faint">עוד אין רכיבים</div>'}</div>
      <button class="btn block soft" data-act="adding" style="margin-top:10px">${icon('plus')}להוסיף רכיב</button>
      <div class="divider"></div>
      <div class="bold small" style="margin-bottom:6px">או לכתוב כמה רכיבים ביחד</div>
      <textarea id="rtext" rows="2" placeholder="600 גרם דניס, 4 עגבניות, 2 כפות שמן זית"></textarea>
      <button class="btn block ghost" data-act="rtext" style="margin-top:8px">להוסיף מהטקסט</button>
    </div>
    <div class="card">
      <label class="field"><span>משקל כל המתכון אחרי הבישול (גרם)</span>
        <input class="num" id="rcook" inputmode="numeric" value="${esc(d.cookedWeight)}">
        <small>לא חובה, אבל מדויק יותר: בבישול מים מתאדים. שוקלים את הסיר המלא ומורידים את משקל הסיר.</small></label>
      <label class="field"><span>כמה שוקלת מנה רגילה שלך (גרם)</span>
        <input class="num" id="rportion" inputmode="numeric" value="${esc(d.portionGrams)}">
        <small>לא חובה. אם ממלאים, אפשר לרשום "מנה" בלחיצה.</small></label>
    </div>
    <div class="card gold" id="rsum">${summary()}</div>
    <button class="btn block" data-act="save">${icon('check')}לשמור את המתכון</button>
    ${id !== 'new' ? `<div class="center"><button class="linkbtn" data-act="remove" style="color:var(--bad)">${icon('trash', 'sm')}להסיר את המתכון</button></div>` : ''}
  `);
  const refreshSum = () => { $('#rsum').innerHTML = summary(); };
  VIEW.oninput = (ev) => {
    const el = ev.target;
    if (el.id === 'rname') d.name = el.value;
    else if (el.id === 'rcook') { d.cookedWeight = el.value; refreshSum(); }
    else if (el.id === 'rportion') { d.portionGrams = el.value; refreshSum(); }
    else if (el.dataset.ing != null) {
      const x = d.ingredients[+el.dataset.ing];
      x.grams = Math.max(0, num(el.value) || 0); x.portion = null;
      $('#ik' + el.dataset.ing).textContent = fmt(C.nutrition(x.per100, x.grams).k);
      refreshSum();
    }
  };
  const toIng = (view, grams, portion) => ({ foodId: view.src === 'lib' ? view.id : null, mohCode: view.mohCode || null,
    name: view.name, grams: Math.round(grams), per100: { ...view.per100 }, liquid: !!view.liquid, portion: portion || null });
  VIEW.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'rm') { d.ingredients.splice(+b.dataset.i, 1); rerender(); }
    else if (act === 'adding') {
      openPicker({ title: 'איזה רכיב?', onPick: (view) => openFoodSheet(view, { mode: 'pick', pickLabel: 'להוסיף למתכון',
        onDone: ({ view: v, grams, portion }) => { d.ingredients.push(toIng(v, grams, portion)); rerender(); } }) });
    } else if (act === 'rtext') {
      const text = $('#rtext').value.trim(); if (!text) { toast('כתבי רכיבים'); return; }
      let items = null;
      if (window.AI && AI.enabled() && APP.ui.aiEnabled !== false && online()) { try { items = await AI.describe(text, libFoods()); } catch (_) {} }
      if (!items || !items.length) items = Parse.parse(text, { lib: libViews(), moh: await loadMoh().catch(() => []) });
      openConfirmList(items, { mode: 'pick', title: 'רכיבים', saveLabel: 'להוסיף למתכון',
        onDone: (list) => { list.forEach((x) => d.ingredients.push(toIng(x.food, x.grams, x.portion))); d.rtextDone = true; rerender(); } });
    } else if (act === 'save') {
      if (!d.name.trim()) { toast('צריך שם למתכון'); $('#rname').focus(); return; }
      if (!d.ingredients.length) { toast('צריך לפחות רכיב אחד'); return; }
      const rn = C.recipeNutrition(d.ingredients, d.cookedWeight);
      const portion = num(d.portionGrams) ? { name: 'מנה', grams: num(d.portionGrams) } : null;
      const rid = id === 'new' ? uid('r') : id;
      const recipe = { id: rid, name: d.name.trim(), ingredients: d.ingredients, cookedWeight: num(d.cookedWeight) || null,
        portion, per100: rn.per100, updatedAt: Date.now() };
      await DB.put('recipes', recipe);
      APP.recipes = APP.recipes.filter((r) => r.id !== rid).concat(recipe);
      let food = APP.lib.find((f) => f.recipeId === rid);
      if (food) Object.assign(food, { name: recipe.name, per100: rn.per100, portions: portion ? [portion] : [], hidden: false });
      else food = newFood({ name: recipe.name, per100: rn.per100, portions: portion ? [portion] : [], source: 'recipe', recipeId: rid });
      await putFood(food);
      APP.draft = null;
      toast('המתכון נשמר. הוא מופיע עכשיו במאכלים שלך');
      location.hash = '#/recipes';
    } else if (act === 'remove') {
      const body = openModal(`<h3>להסיר את "${esc(d.name)}"?</h3><p class="note">רישומים קודמים יישארו כמו שהם.</p>
        <button class="btn block danger" data-x="yes">${icon('trash')}כן, להסיר</button>
        <button class="btn block ghost" data-x="no" style="margin-top:8px">ביטול</button>`);
      body.onclick = async (e2) => {
        const x = e2.target.closest('[data-x]'); if (!x) return;
        if (x.dataset.x === 'no') { closeModal(); return; }
        await DB.del('recipes', id);
        APP.recipes = APP.recipes.filter((r) => r.id !== id);
        const food = APP.lib.find((f) => f.recipeId === id);
        if (food) { food.hidden = true; await putFood(food); }
        APP.draft = null; closeModal(); toast('הוסר'); go('#/recipes');
      };
    }
  };
}

async function viewMeal(parts) {
  const id = parts[1] || 'new';
  if (!APP.draft || APP.draft.kind !== 'meal' || APP.draft.id !== id) {
    if (id === 'new') APP.draft = { kind: 'meal', id, name: '', items: [] };
    else {
      const m = APP.meals.find((x) => x.id === id);
      if (!m) { location.replace('#/recipes?tab=meals'); return; }
      APP.draft = { kind: 'meal', id, name: m.name, items: m.items.map((x) => ({ ...x })) };
    }
  }
  const d = APP.draft;
  setTitle(id === 'new' ? 'מנה קבועה חדשה' : 'עריכת מנה');
  const rows = d.items.map((x, i) => {
    const f = APP.libById.get(x.foodId);
    if (!f) return '';
    return `<div class="confirmrow">${dot(f.per100.k, f.liquid)}
      <div class="nm"><div class="t">${esc(f.name)}</div><div class="s">${x.portion ? `${x.portion.count === 1 ? '' : fmt1(x.portion.count) + ' × '}${esc(x.portion.name)}` : ''}</div></div>
      <input class="num" inputmode="numeric" data-it="${i}" value="${Math.round(x.grams)}">
      <span class="k n" id="mk${i}">${fmt(C.nutrition(f.per100, x.grams).k)}</span>
      <button class="iconbtn" data-act="rm" data-i="${i}" aria-label="הסרה">${icon('x')}</button></div>`;
  }).join('');
  const total = () => d.items.reduce((a, x) => { const f = APP.libById.get(x.foodId); return a + (f ? C.nutrition(f.per100, x.grams).k : 0); }, 0);
  setView(`
    <label class="field"><span>שם המנה</span><input id="mname" value="${esc(d.name)}" placeholder="למשל: ארוחת בוקר רגילה"></label>
    <div class="card"><h3>מה יש בה</h3>${rows || '<div class="faint">עוד ריקה</div>'}
      <button class="btn block soft" data-act="add" style="margin-top:10px">${icon('plus')}להוסיף מאכל</button>
      <div class="spread" style="margin-top:12px"><span class="bold">סה״כ</span><b><span class="dnum big" id="mtot">${fmt(total())}</span> קלוריות</b></div></div>
    <button class="btn block" data-act="save">${icon('check')}לשמור</button>
    ${id !== 'new' ? `<button class="btn block ghost" data-act="lognow" style="margin-top:10px">${icon('plus')}לרשום עכשיו</button>
      <div class="center"><button class="linkbtn" data-act="remove" style="color:var(--bad)">${icon('trash', 'sm')}להסיר את המנה</button></div>` : ''}
  `);
  VIEW.oninput = (ev) => {
    if (ev.target.id === 'mname') d.name = ev.target.value;
    if (ev.target.dataset.it != null) {
      const x = d.items[+ev.target.dataset.it]; x.grams = Math.max(0, num(ev.target.value) || 0); x.portion = null;
      const f = APP.libById.get(x.foodId);
      $('#mk' + ev.target.dataset.it).textContent = fmt(C.nutrition(f.per100, x.grams).k);
      $('#mtot').textContent = fmt(total());
    }
  };
  const persist = async () => {
    if (!d.name.trim()) { toast('צריך שם למנה'); return null; }
    if (!d.items.length) { toast('צריך לפחות מאכל אחד'); return null; }
    const old = APP.meals.find((m) => m.id === id);
    const meal = { id: id === 'new' ? uid('m') : id, name: d.name.trim(), items: d.items, useCount: old ? old.useCount : 0, lastUsed: old ? old.lastUsed : 0 };
    await DB.put('meals', meal);
    APP.meals = APP.meals.filter((m) => m.id !== meal.id).concat(meal);
    return meal;
  };
  VIEW.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'rm') { d.items.splice(+b.dataset.i, 1); rerender(); }
    else if (act === 'add') {
      openPicker({ onPick: (view) => openFoodSheet(view, { mode: 'pick', pickLabel: 'להוסיף למנה',
        onDone: async ({ view: v, grams, portion }) => { const f = await ensureLibFood(v); d.items.push({ foodId: f.id, name: f.name, grams: Math.round(grams), portion }); rerender(); } }) });
    } else if (act === 'save') {
      const m = await persist(); if (!m) return;
      APP.draft = null; toast('נשמר'); location.hash = '#/recipes?tab=meals';
    } else if (act === 'lognow') {
      const m = await persist(); if (!m) return;
      APP.draft = null; logMealFlow(m);
    } else if (act === 'remove') {
      await DB.del('meals', id);
      APP.meals = APP.meals.filter((m) => m.id !== id);
      APP.draft = null; toast('המנה הוסרה'); location.hash = '#/recipes?tab=meals';
    }
  };
}

/* ================= progress ================= */
async function viewProgress() {
  const ctx = await loadContext();
  const t = ctx.t;
  setTitle('התקדמות');
  const base = { today: t, weights: ctx.weights, measurements: ctx.measurements, totalsMap: ctx.totals, closedSet: ctx.closedSet, profile: APP.profile };
  const wins = C.wins({ ...base, target: ctx.target, proteinGoal: ctx.pGoal }).slice(0, 2);
  const ms = C.milestones(base);
  const seen = new Set(APP.ui.milestonesSeen || []);
  const fresh = ms.filter((m) => !seen.has(m.id));
  const scaleNote = C.scaleNote(base);
  const todayW = ctx.weights.find((w) => w.date === t);
  const waists = ctx.measurements.filter((m) => m.waistCm).sort((a, b) => (a.date < b.date ? -1 : 1));
  const avg7 = C.avgWindow(ctx.weights, t, 7);
  const avg28 = C.avgWindow(ctx.weights, C.addDays(t, -28), 7);
  const avgPrev = C.avgWindow(ctx.weights, C.addDays(t, -7), 7);
  const from = [APP.profile.startDate || t, C.addDays(t, -44)].sort().pop();
  const series = C.weightSeries(ctx.weights, from, t);
  const cal = C.calibration({ totalsMap: ctx.totals, weights: ctx.weights, profile: APP.profile, today: t, kg: ctx.kg });
  const showCal = cal && cal.newTdee && (!APP.ui.lastCalibrationAt || C.diffDays(APP.ui.lastCalibrationAt, t) >= 14);
  const expected = C.expectedWeeklyLoss(C.effectiveDeficit(APP.profile, ctx.kg, t));

  let html = '';
  if (fresh.length) {
    html += `<div class="card gold center"><div style="color:var(--gold)">${icon('trophy', 'lg')}</div>
      <h3 style="margin:6px 0">${fresh.map((m) => esc(m.text)).join(' · ')}</h3>
      <p class="note">זה לא מקרה. זה מה שקורה כשרושמים ומתמידים.</p></div>`;
  }
  html += `<div class="card gold"><h3 class="row">${icon('trophy')}הניצחון של השבוע</h3>
    ${wins.map((w) => `<div class="win">${icon(w.icon)}<div class="t">${esc(w.text)}</div></div>`).join('')}</div>`;
  if (scaleNote) html += `<div class="card flat"><div class="row" style="align-items:flex-start">${icon('bulb')}<span class="note grow" style="color:var(--text)">${esc(scaleNote)}</span></div></div>`;

  html += `<div class="card"><h3>מדידה</h3>
    <div class="grid2">
      <label class="field"><span>משקל היום (ק״ג)</span><input class="num" id="pw" inputmode="decimal" value="${todayW ? todayW.kg : ''}"></label>
      <label class="field"><span>מותניים (ס״מ)</span><input class="num" id="pwaist" inputmode="decimal" value="${waists.length && waists[waists.length - 1].date === t ? waists[waists.length - 1].waistCm : ''}"></label>
    </div>
    <button class="btn block" data-act="save">${icon('check')}לשמור</button>
    <div class="faint center" style="margin-top:6px">היקף מספיק פעם בשבוע, בגובה הטבור</div></div>`;

  html += `<div class="card"><h3>המשקל</h3>
    ${series.length >= 2 ? `<div class="chartbox" dir="ltr">${weightChartSvg(series)}</div>
      <div class="row small muted" style="justify-content:center;gap:16px;margin-top:4px">
        <span class="row" style="gap:5px"><span class="dot" style="background:var(--line)"></span>שקילה</span>
        <span class="row" style="gap:5px"><span class="dot" style="background:var(--accent)"></span>ממוצע שבועי</span></div>`
      : `<div class="empty small">${icon('scale', 'lg')}<br>אחרי שתי שקילות יופיע כאן גרף</div>`}
    <div class="grid3" style="margin-top:12px">
      <div class="stat"><div class="l">ממוצע שבועי</div><div class="v dnum">${avg7 != null ? avg7.toFixed(1) : '—'}</div><div class="s">ק״ג</div></div>
      <div class="stat"><div class="l">השבוע</div><div class="v dnum">${avg7 != null && avgPrev != null ? signed(avg7 - avgPrev) : '—'}</div><div class="s">צפוי ${fmt1(-expected)}</div></div>
      <div class="stat"><div class="l">4 שבועות</div><div class="v dnum">${avg7 != null && avg28 != null ? signed(avg7 - avg28) : '—'}</div><div class="s">ק״ג</div></div>
    </div></div>`;

  if (waists.length) {
    const first = waists[0], last = waists[waists.length - 1];
    html += `<div class="card"><h3 class="row">${icon('tape')}היקף מותניים</h3>
      <div class="spread"><span>עכשיו <b class="dnum big">${fmt1(last.waistCm)}</b> ס״מ</span>
      ${waists.length > 1 ? `<span class="pill ${first.waistCm > last.waistCm ? 'good' : ''}">מאז ההתחלה <span class="n">${signed(last.waistCm - first.waistCm)}</span></span>` : ''}</div>
      <div class="chips wrap" style="margin-top:8px">${waists.slice(-5).reverse().map((m) => `<span class="pill"><bdi>${fmtDateShort(m.date)}</bdi><b class="n">${fmt1(m.waistCm)}</b></span>`).join('')}</div></div>`;
  }

  if (showCal) {
    const lower = cal.newTdee < cal.cur;
    const atFloor = cal.newTarget === ctx.target;
    html += `<div class="card soft"><h3 class="row">${icon('bulb')}כיול לפי הגוף שלך</h3>
      <p class="note" style="color:var(--text)">לפי מה שרשמת והמשקל ב-14 הימים האחרונים, הגוף שלך שורף בערך <b class="n">${fmt(cal.tdeeActual)}</b> קלוריות ביום.
      ${lower ? 'זה פחות ממה שהנוסחה חשבה. זה לא כישלון, זה מידע, והוא יכול להסביר האטה בירידה.' : 'זה יותר ממה שחשבנו, כלומר אפשר לאכול קצת יותר ועדיין לרדת.'}</p>
      ${atFloor
        ? `<p class="note" style="color:var(--text)">היעד כבר במינימום של <span class="n">1,200</span>, אז לא מורידים אותו. מה שכן עוזר: חלבון בכל ארוחה, הרבה ירקות, ולרשום גם את הקטנים (שמן, רטבים, ביס מהצלחת).</p>
          <button class="btn block ghost" data-act="calno" style="margin-top:8px">הבנתי</button>`
        : `<p class="note" style="color:var(--text)">מומלץ יעד יומי חדש: <b class="n">${fmt(cal.newTarget)}</b> (במקום <span class="n">${fmt(ctx.target)}</span>).</p>
          <div class="row" style="margin-top:8px"><button class="btn grow" data-act="calok">לעדכן יעד</button><button class="btn ghost" data-act="calno">לא עכשיו</button></div>`}
    </div>`;
  }

  html += `<div class="card flat"><h3 class="row">${icon('bulb')}למה המשקל קופץ?</h3>
    <p class="note">בשבועיים הראשונים יורדים בעיקר מים, ולכן זה מהיר. אחר כך יורד שומן, בערך חצי קילו בשבוע. המשקל של יום אחד יכול לקפוץ בקילו בגלל מלח, אוכל שעוד בבטן או מים, ולכן מסתכלים על הממוצע השבועי ועל ההיקף.</p></div>`;
  if (ms.length) {
    html += `<h2 class="section">${icon('trophy')}אבני דרך</h2><div class="chips wrap">${ms.map((m) => `<span class="pill gold">${esc(m.text)}</span>`).join('')}</div>`;
  }
  html += `<div style="margin-top:16px">
    <a class="linkrow" href="#/history">${icon('calendar')}היסטוריה${icon('chev', 'chev')}</a>
    <a class="linkrow" href="#/insights">${icon('bulb')}תובנות${icon('chev', 'chev')}</a></div>`;
  setView(html);
  if (fresh.length) { vibrate([30, 50, 30]); saveUi({ milestonesSeen: [...seen, ...fresh.map((m) => m.id)] }); }

  VIEW.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'save') {
      const kg = num($('#pw').value), waist = num($('#pwaist').value);
      if (kg == null && waist == null) { toast('אין מה לשמור'); return; }
      if (kg != null && (kg < 30 || kg > 300)) { toast('המשקל נראה לא נכון'); return; }
      if (kg != null) await DB.put('weights', { date: t, kg: C.r1(kg) });
      if (waist != null) await DB.put('measurements', { date: t, waistCm: C.r1(waist) });
      afterDataChange(t); vibrate(); toast('נשמר'); rerender();
    } else if (b.dataset.act === 'calok') {
      await saveProfile({ tdeeActual: cal.newTdee, targetOverride: null });
      await saveUi({ lastCalibrationAt: t });
      toast('היעד עודכן ל-' + fmt(cal.newTarget)); rerender();
    } else if (b.dataset.act === 'calno') {
      await saveUi({ lastCalibrationAt: t }); rerender();
    }
  };
}
function signed(x) {
  const v = Math.round(x * 10) / 10;
  if (v === 0) return '0';
  return (v > 0 ? '+' : '−') + fmt1(Math.abs(v));
}
function weightChartSvg(series) {
  const W = 340, H = 170, L = 34, R = 10, T = 12, B = 24;
  const d0 = series[0].date, d1 = series[series.length - 1].date;
  const span = Math.max(1, C.diffDays(d0, d1));
  const vals = series.flatMap((s) => [s.kg, s.avg]).filter((v) => v != null);
  let lo = Math.min(...vals) - 0.4, hi = Math.max(...vals) + 0.4;
  if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
  const x = (d) => L + (C.diffDays(d0, d) / span) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];
  const avgPath = series.filter((s) => s.avg != null).map((s, i) => `${i ? 'L' : 'M'}${x(s.date).toFixed(1)},${y(s.avg).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="גרף משקל">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--hair)" stroke-width="1"/>
      <text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--faint)" font-family="Heebo">${v.toFixed(1)}</text>`).join('')}
    ${series.map((s) => `<circle cx="${x(s.date).toFixed(1)}" cy="${y(s.kg).toFixed(1)}" r="3.2" fill="var(--line)"/>`).join('')}
    <path d="${avgPath}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="${L}" y="${H - 6}" font-size="11" fill="var(--faint)" font-family="Heebo">${fmtDateShort(d0)}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--faint)" font-family="Heebo">${fmtDateShort(d1)}</text>
  </svg>`;
}

/* ================= history ================= */
async function viewHistory() {
  const ctx = await loadContext();
  const t = ctx.t;
  setTitle('היסטוריה');
  let html = '';
  for (let w = 0; w < 8; w++) {
    const ws = C.addDays(C.weekStart(t), -7 * w);
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = C.addDays(ws, i); if (d <= t) days.push(d); }
    const wa = C.weekAverage(ctx.totals, ctx.closedSet, days[0], t);
    const any = days.some((d) => ctx.totals.has(d));
    if (!any && w > 1) continue;
    html += `<h2 class="section" style="justify-content:space-between"><span>${fmtDateShort(ws)}–${fmtDateShort(C.addDays(ws, 6))}</span>
      ${wa ? `<span class="pill ${wa.avg <= ctx.target ? 'good' : ''}">ממוצע <span class="n">${fmt(wa.avg)}</span></span>` : ''}</h2>`;
    for (const d of days) {
      const tt = ctx.totals.get(d);
      html += `<a class="item" href="#/day/${d}" style="text-decoration:none;color:inherit">
        <div class="nm"><div class="t">${relDay(d)}</div>
        ${tt ? `<div class="bar ${tt.k > ctx.target ? 'soft' : 'kcal'}" style="margin-top:6px;height:8px"><div style="width:${Math.min(100, tt.k / ctx.target * 100)}%;${tt.k <= ctx.target ? 'background:var(--good)' : ''}"></div></div>` : '<div class="s">לא נרשם</div>'}</div>
        <div class="end">${tt ? `<b class="n">${fmt(tt.k)}</b>` : ''}${ctx.closedSet.has(d) ? ` <span style="color:var(--good)">${icon('check', 'sm')}</span>` : ''}</div></a>`;
    }
  }
  setView(html || `<div class="empty">${icon('calendar', 'lg')}<br>עוד אין היסטוריה</div>`);
}

/* ================= insights ================= */
async function viewInsights() {
  const t = today();
  setTitle('תובנות');
  const from = C.addDays(t, -29);
  const [entries, days] = await Promise.all([DB.range('entries', 'date', from, t), DB.all('days')]);
  const totals = C.dayTotals(entries);
  const logged = [...totals.keys()].filter((d) => d !== t);
  if (logged.length < 3) {
    setView(`<div class="empty">${icon('bulb', 'lg')}<br>אחרי כמה ימים של רישום יופיעו כאן תובנות: באיזו ארוחה הולכות רוב הקלוריות, איזה יום בשבוע כבד, ומה המאכלים הכי "יקרים".</div>`);
    return;
  }
  const allK = logged.reduce((a, d) => a + totals.get(d).k, 0);
  const bySlot = C.SLOTS.map((s) => [s, logged.reduce((a, d) => a + (totals.get(d).slots[s] || 0), 0)]);
  const wd = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const ds = logged.filter((d) => C.parseYmd(d).getDay() === i);
    return [i, ds.length ? ds.reduce((a, d) => a + totals.get(d).k, 0) / ds.length : null];
  });
  const maxWd = Math.max(...wd.map((x) => x[1] || 0));
  const byFood = new Map();
  for (const e of entries) { if (e.date === t) continue; const key = e.foodId || e.name; const cur = byFood.get(key) || { name: e.name, k: 0, n: 0 }; cur.k += e.k; cur.n += 1; byFood.set(key, cur); }
  const top = [...byFood.values()].sort((a, b) => b.k - a.k).slice(0, 10);
  const notes = days.filter((d) => d.coachNote && d.date >= from).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
  const bigSlot = bySlot.slice().sort((a, b) => b[1] - a[1])[0];

  setView(`
    <div class="card"><h3>ב-30 הימים האחרונים</h3>
      <div class="spread"><span>ימי רישום</span><b><span class="n">${logged.length}</span> מתוך 30</b></div>
      <div class="spread"><span>ממוצע ביום</span><b class="n">${fmt(allK / logged.length)}</b></div></div>
    <div class="card"><h3>איפה הולכות הקלוריות</h3>
      ${bySlot.map(([s, k]) => `<div class="hbar"><span class="l">${C.SLOT_HE[s]}</span><div class="b"><div style="width:${allK ? k / allK * 100 : 0}%"></div></div><span class="v n">${allK ? Math.round(k / allK * 100) : 0}%</span></div>`).join('')}
      ${bigSlot && allK && bigSlot[1] / allK >= 0.45 ? `<p class="note" style="margin-top:8px">${Math.round(bigSlot[1] / allK * 100)}% מהקלוריות הולכות ל${C.SLOT_HE[bigSlot[0]]}. כאן השינוי הקטן ביותר ישפיע הכי הרבה.</p>` : ''}</div>
    <div class="card"><h3>לפי יום בשבוע</h3>
      ${wd.map(([i, k]) => `<div class="hbar"><span class="l">${DAY_FULL[i]}</span><div class="b"><div style="width:${k ? k / maxWd * 100 : 0}%"></div></div><span class="v n">${k ? fmt(k) : '—'}</span></div>`).join('')}</div>
    <div class="card"><h3>המאכלים שתורמים הכי הרבה</h3>
      ${top.map((f) => `<div class="hbar"><span class="l" style="width:auto;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(shortName(f.name))}</span><span class="v n">${fmt(f.k)}</span></div>`).join('')}
      <p class="faint" style="margin-top:6px">סה״כ קלוריות מכל מאכל בחודש</p></div>
    ${notes.length ? `<div class="card gold"><h3 class="row">${icon('sparkle')}מה נאמר לאחרונה</h3>${notes.map((n) => `<p class="note" style="color:var(--text)"><b>${fmtDateShort(n.date)}</b> ${esc(n.coachNote)}</p>`).join('')}</div>` : ''}
  `);
}

/* ================= more / settings / backup ================= */
async function viewMore() {
  setTitle('עוד');
  setView(`<div class="card" style="padding:4px 14px">
    <a class="linkrow" href="#/history">${icon('calendar')}היסטוריה${icon('chev', 'chev')}</a>
    <a class="linkrow" href="#/insights">${icon('bulb')}תובנות${icon('chev', 'chev')}</a>
    <a class="linkrow" href="#/recipes?tab=meals">${icon('book')}מנות קבועות${icon('chev', 'chev')}</a>
    <a class="linkrow" href="#/settings">${icon('gear')}הגדרות ויעד${icon('chev', 'chev')}</a>
    <a class="linkrow" href="#/backup" style="border:none">${icon('cloud')}גיבוי ושחזור${icon('chev', 'chev')}</a></div>
    <p class="faint center">צלחת · גרסה <span class="n">${esc(CFG.VERSION)}</span></p>`);
}

async function viewSettings() {
  setTitle('הגדרות');
  const p = APP.profile;
  const weights = await DB.all('weights');
  const t = today();
  const kg = C.kgNow(p, weights, t);
  const bmr = C.bmr({ kg, cm: p.heightCm, age: C.ageOn(p.birthYear, t) });
  const tdee = C.currentTdee(p, kg, t);
  const target = C.targetFor(p, kg, t);
  const aiAvail = !!(window.AI && AI.enabled());
  const pushAvail = !!(window.Cloud && Cloud.enabled() && Cloud.pushSupported());
  setView(`
    <div class="card gold"><h3>היעד שלך</h3>
      <div class="kv"><span>הגוף שורף במנוחה</span><b class="n">${fmt(bmr)}</b></div>
      <div class="kv"><span>ביום רגיל ${p.tdeeActual ? '(לפי הכיול)' : ''}</span><b class="n">${fmt(tdee)}</b></div>
      <div class="kv"><span>יעד יומי</span><b class="dnum big">${fmt(target)}</b></div>
      <div class="kv"><span>קצב צפוי</span><b>בערך <span class="n">${fmt1(C.expectedWeeklyLoss(C.effectiveDeficit(p, kg, t)))}</span> ק״ג בשבוע</b></div>
      <div class="kv"><span>חלבון ביום</span><b><span class="n">${C.proteinTarget(p, kg)}</span> גרם</b></div>
      <p class="note" style="margin-top:8px">החישוב לפי גיל, גובה ומשקל, בלי ספורט. אחרי שלושה שבועות של רישום, האפליקציה בודקת מה קורה בפועל ומציעה לתקן.${target === C.FLOOR ? ' לא יורדים מתחת ל-1,200 ביום.' : ''}</p></div>

    <div class="card"><h3>קצב</h3>
      <div class="seg"><button class="${(p.deficit || 500) === 250 ? 'on' : ''}" data-act="deficit" data-v="250">רגוע</button>
        <button class="${(p.deficit || 500) === 500 ? 'on' : ''}" data-act="deficit" data-v="500">מהיר יותר</button></div>
      <label class="field" style="margin-top:12px"><span>יעד ידני (לא חובה)</span>
        <input class="num" id="sover" inputmode="numeric" value="${p.targetOverride || ''}" placeholder="${fmt(target)}">
        <small>למשל אם דיאטנית נתנה מספר. ריק = חישוב אוטומטי.</small></label>
      ${p.tdeeActual ? `<button class="linkbtn" data-act="uncal">לבטל את הכיול ולחזור לנוסחה</button>` : ''}</div>

    <div class="card"><h3>פרטים</h3>
      <div class="grid2">
        <label class="field"><span>שנת לידה</span><input class="num" id="sby" inputmode="numeric" value="${p.birthYear}"></label>
        <label class="field"><span>גובה (ס״מ)</span><input class="num" id="sh" inputmode="numeric" value="${p.heightCm}"></label>
      </div>
      <div class="faint">משקל התחלה: <span class="n">${fmt1(p.startWeight)}</span> ק״ג, ${fmtDateShort(p.startDate)}</div>
      <label class="field" style="margin-top:12px"><span>יום המדידה השבועי</span>
        <select id="smd">${DAY_FULL.map((d, i) => `<option value="${i}" ${i === (p.measureDay ?? 0) ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <div class="bold" style="margin-bottom:6px">גודל טקסט</div>
      <div class="seg">${[['m', 'רגיל'], ['l', 'גדול'], ['xl', 'ענק']].map(([v, l]) => `<button class="${(p.textSize || 'm') === v ? 'on' : ''}" data-act="text" data-v="${v}">${l}</button>`).join('')}</div></div>

    ${aiAvail || pushAvail ? `<div class="card"><h3>תוספות</h3>
      ${aiAvail ? `<label class="row" style="min-height:52px"><input type="checkbox" id="sai" ${APP.ui.aiEnabled !== false ? 'checked' : ''} style="width:24px;height:24px"><span class="grow"><b>עזרה חכמה</b><br><span class="faint">צילום צלחת, קריאת תוויות והבנת טקסט. התמונות והטקסט נשלחים ל-Google לעיבוד.</span></span></label>` : ''}
      ${pushAvail ? `<label class="row" style="min-height:52px"><input type="checkbox" id="spush" ${APP.ui.pushEnabled ? 'checked' : ''} style="width:24px;height:24px"><span class="grow"><b>תזכורות</b><br><span class="faint">בערב, רק אם עוד לא רשמת ארוחת ערב. ובבוקר של יום המדידה.</span></span></label>` : ''}
    </div>` : ''}
    <a class="linkrow" href="#/backup">${icon('cloud')}גיבוי ושחזור${icon('chev', 'chev')}</a>
  `);
  const saved = () => { toast('נשמר'); rerender(); };
  VIEW.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'deficit') { await saveProfile({ deficit: +b.dataset.v }); saved(); }
    else if (b.dataset.act === 'text') { await saveProfile({ textSize: b.dataset.v }); applyTextSize(); saved(); }
    else if (b.dataset.act === 'uncal') { await saveProfile({ tdeeActual: null }); saved(); }
  };
  VIEW.onchange = async (ev) => {
    const el = ev.target;
    if (el.id === 'sover') { const v = num(el.value); await saveProfile({ targetOverride: v && v >= 800 ? Math.round(v) : null }); saved(); }
    else if (el.id === 'sby') { const v = num(el.value); if (v > 1920 && v < new Date().getFullYear() - 15) { await saveProfile({ birthYear: v }); saved(); } else toast('שנה לא נכונה'); }
    else if (el.id === 'sh') { const v = num(el.value); if (v > 120 && v < 220) { await saveProfile({ heightCm: v }); saved(); } else toast('גובה לא נכון'); }
    else if (el.id === 'smd') { await saveProfile({ measureDay: +el.value }); saved(); }
    else if (el.id === 'sai') { await saveUi({ aiEnabled: el.checked }); toast(el.checked ? 'עזרה חכמה פועלת' : 'עזרה חכמה כבויה'); }
    else if (el.id === 'spush') {
      try {
        if (el.checked) { await Cloud.subscribe(); await saveUi({ pushEnabled: true }); toast('תזכורות פועלות'); }
        else { await Cloud.unsubscribe(); await saveUi({ pushEnabled: false }); toast('תזכורות כבויות'); }
      } catch (e) { el.checked = !el.checked; toast(e.message || 'לא הצלחתי להפעיל תזכורות'); }
    }
  };
}

async function viewBackup() {
  setTitle('גיבוי ושחזור');
  const cloudOn = !!(window.Cloud && Cloud.enabled());
  const onboarded = !!APP.ui.onboarded;
  setView(`
    ${!onboarded ? `<p class="note" style="margin:0 4px 12px">כבר השתמשת בצלחת בטלפון אחר? אפשר להחזיר את כל הנתונים.</p>` : ''}
    ${cloudOn && onboarded ? `<div class="card"><h3 class="row">${icon('cloud')}גיבוי אוטומטי</h3>
      <p class="note">הנתונים מגובים בענן פעם ביום ובכל פעם שסוגרים יום. הגיבוי מוצפן, ורק קוד השחזור פותח אותו.</p>
      <div class="kv"><span>גיבוי אחרון</span><b>${APP.ui.lastCloudBackupAt ? relDay(C.ymd(new Date(APP.ui.lastCloudBackupAt))) : 'עוד לא'}</b></div>
      <button class="btn block ghost" data-act="cloudnow" style="margin-top:8px">${icon('upload')}לגבות עכשיו</button>
      <button class="btn block ghost" data-act="code" style="margin-top:8px">${icon('share')}קוד השחזור</button>
      <p class="faint" style="margin-top:6px">את הקוד כדאי לשלוח לדניאל. בלעדיו אי אפשר לשחזר טלפון חדש.</p></div>` : ''}
    ${cloudOn ? `<div class="card"><h3>שחזור מקוד</h3>
      <label class="field"><span>קוד השחזור</span><input id="rcode" dir="ltr" autocomplete="off" placeholder="XXXX-XXXX-…"></label>
      <button class="btn block" data-act="restorecode">להחזיר את הנתונים</button></div>` : ''}
    <div class="card"><h3 class="row">${icon('share')}קובץ גיבוי</h3>
      ${onboarded ? `<p class="note">קובץ עם כל הנתונים. אפשר לשלוח בוואטסאפ ולשמור.</p>
        <button class="btn block" data-act="export">${icon('share')}לשלוח קובץ גיבוי</button>
        ${APP.ui.lastBackupAt ? `<p class="faint center" style="margin-top:6px">קובץ אחרון: ${relDay(C.ymd(new Date(APP.ui.lastBackupAt)))}</p>` : ''}
        <div class="divider"></div>` : ''}
      <p class="note">להחזיר נתונים מקובץ גיבוי. זה מחליף את כל מה שיש כרגע בטלפון.</p>
      <button class="btn block ghost" data-act="import">${icon('upload')}לבחור קובץ גיבוי</button></div>
    ${!onboarded ? `<a class="btn block soft" href="#/setup">חזרה להתחלה</a>` : ''}
  `);
  VIEW.onclick = async (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'export') exportBackup();
    else if (act === 'import') importBackupFile();
    else if (act === 'cloudnow') { try { await Cloud.backup(true); toast('גובה'); rerender(); } catch (e) { toast('הגיבוי נכשל. אולי אין אינטרנט'); } }
    else if (act === 'code') showRecoveryCode();
    else if (act === 'restorecode') {
      const code = $('#rcode').value.trim();
      if (!code) { toast('הדביקי את הקוד'); return; }
      try {
        const data = await Cloud.fetchBackup(code);
        confirmImport(data, async () => { await Cloud.adoptCode(code); });
      } catch (e) { toast(e.message || 'לא הצלחתי לשחזר'); }
    }
  };
}
async function exportBackup() {
  const data = await DB.exportAll();
  const json = JSON.stringify(data);
  const name = `tzalahat-backup-${today()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'גיבוי צלחת' });
      await saveUi({ lastBackupAt: Date.now() }); toast('הגיבוי נשלח'); rerender(); return;
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  await saveUi({ lastBackupAt: Date.now() }); toast('הקובץ נשמר בהורדות'); rerender();
}
function importBackupFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!DB.validateBackup(data)) throw new Error('זה לא קובץ גיבוי של צלחת');
      confirmImport(data);
    } catch (e) { toast(e.message.startsWith('זה') ? e.message : 'הקובץ לא נקרא'); }
  };
  inp.click();
}
function confirmImport(data, after) {
  const n = (data.entries || []).length;
  const body = openModal(`<h3>להחזיר את הנתונים?</h3>
    <p class="note">בגיבוי יש <b class="n">${fmt(n)}</b> רישומים ו-<b class="n">${fmt((data.foods || []).length)}</b> מאכלים, מ-${data.exportedAt ? fmtDateShort(C.ymd(new Date(data.exportedAt))) : 'תאריך לא ידוע'}.
    כל מה שיש כרגע בטלפון יוחלף.</p>
    <button class="btn block" data-x="yes">${icon('check')}כן, להחזיר</button>
    <button class="btn block ghost" data-x="no" style="margin-top:8px">ביטול</button>`);
  body.onclick = async (ev) => {
    const x = ev.target.closest('[data-x]'); if (!x) return;
    if (x.dataset.x === 'no') { closeModal(); return; }
    await DB.importAll(data);
    if (after) await after();
    sessionStorage.setItem('mf.restored', '1');
    location.hash = '#/';
    location.reload();
  };
}
async function showRecoveryCode() {
  const code = await Cloud.recoveryCode();
  const body = openModal(`<h3>קוד השחזור</h3>
    <p class="note">עם הקוד הזה אפשר להחזיר את כל הנתונים לטלפון חדש. כדאי לשלוח אותו לדניאל ולא לפרסם.</p>
    <div class="card flat" dir="ltr" style="font-family:monospace;font-size:1rem;word-break:break-all;text-align:center;user-select:all">${esc(code)}</div>
    <button class="btn block" data-x="share">${icon('share')}לשלוח</button>`);
  body.onclick = async (ev) => {
    if (!ev.target.closest('[data-x]')) return;
    try {
      if (navigator.share) await navigator.share({ text: 'קוד השחזור של צלחת:\n' + code });
      else { await navigator.clipboard.writeText(code); toast('הועתק'); }
    } catch (_) {}
  };
}

/* ================= setup wizard ================= */
async function viewSetup(parts, params) {
  const step = Math.min(3, Math.max(1, +params.step || 1));
  let d = {};
  try { d = JSON.parse(sessionStorage.getItem('mf.setup') || '{}'); } catch (_) {}
  const keep = () => sessionStorage.setItem('mf.setup', JSON.stringify(d));
  setTitle('צלחת');
  const dots = `<div class="steps">${[1, 2, 3].map((i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>`;
  if (APP.ui.onboarded) { location.replace('#/'); return; }

  if (step === 1) {
    setView(`${dots}
      <div class="center" style="color:var(--good);margin:8px 0">${icon('leaf', 'lg')}</div>
      <h2 class="center" style="margin:0 0 6px;font-weight:900">שלום, זו צלחת</h2>
      <p class="note center" style="margin:0 10px 18px">כמה פרטים כדי לחשב יעד אישי. זה נשאר רק בטלפון שלך.</p>
      <div class="card">
        <div class="grid2">
          <label class="field"><span>שנת לידה</span><input class="num" id="by" inputmode="numeric" value="${esc(d.birthYear || '')}" placeholder="1965"></label>
          <label class="field"><span>גובה (ס״מ)</span><input class="num" id="h" inputmode="numeric" value="${esc(d.heightCm || '')}" placeholder="162"></label>
          <label class="field"><span>משקל היום (ק״ג)</span><input class="num" id="w" inputmode="decimal" value="${esc(d.kg || '')}"></label>
          <label class="field"><span>מותניים (ס״מ)</span><input class="num" id="wa" inputmode="decimal" value="${esc(d.waist || '')}"><small>לא חובה. בגובה הטבור</small></label>
        </div>
        <button class="btn block" data-act="next">להמשיך</button>
      </div>
      <div class="center"><a class="linkbtn" href="#/backup">${icon('upload', 'sm')}יש לי כבר גיבוי</a></div>`);
    VIEW.onclick = (ev) => {
      if (!ev.target.closest('[data-act="next"]')) return;
      const by = num($('#by').value), h = num($('#h').value), w = num($('#w').value), wa = num($('#wa').value);
      const year = new Date().getFullYear();
      if (!(by > 1920 && by < year - 15)) { toast('שנת לידה לא נכונה'); return; }
      if (!(h > 120 && h < 220)) { toast('גובה בסנטימטרים, למשל 162'); return; }
      if (!(w > 35 && w < 250)) { toast('משקל בקילו, למשל 78.5'); return; }
      if (wa != null && !(wa > 50 && wa < 200)) { toast('היקף בסנטימטרים'); return; }
      Object.assign(d, { birthYear: by, heightCm: h, kg: C.r1(w), waist: wa ? C.r1(wa) : null, deficit: d.deficit || 500 });
      keep(); location.hash = '#/setup?step=2';
    };
    return;
  }

  if (!d.kg) { location.replace('#/setup'); return; }
  const prof = { sex: 'f', birthYear: d.birthYear, heightCm: d.heightCm, startWeight: d.kg, startDate: today(), activity: 1.2,
    deficit: d.deficit || 500, targetOverride: null, tdeeActual: null, proteinPerKg: 1.2, proteinPerMeal: 25,
    measureDay: new Date().getDay(), textSize: 'm' };

  if (step === 2) {
    const bmr = C.bmr({ kg: d.kg, cm: d.heightCm, age: C.ageOn(d.birthYear, today()) });
    const tdee = C.tdeeFormula(prof, d.kg, today());
    const target = C.targetFor(prof, d.kg, today());
    setView(`${dots}
      <div class="card gold center">
        <div class="muted bold">היעד היומי שלך</div>
        <div class="dnum" style="font-size:3.6rem;line-height:1.1;color:var(--accent)">${fmt(target)}</div>
        <div class="muted">קלוריות ביום</div></div>
      <div class="card">
        <p class="note" style="color:var(--text)">הגוף שלך שורף בערך <b class="n">${fmt(bmr)}</b> קלוריות במנוחה, ובערך <b class="n">${fmt(tdee)}</b> ביום רגיל בלי ספורט.
        אם אוכלים קצת פחות מזה, הגוף משלים מהשומן. בלי להרעיב ובלי לוותר על שום מאכל.</p>
        <div class="bold" style="margin:12px 0 6px">באיזה קצב?</div>
        <div class="seg"><button class="${prof.deficit === 250 ? 'on' : ''}" data-act="def" data-v="250">רגוע</button>
          <button class="${prof.deficit === 500 ? 'on' : ''}" data-act="def" data-v="500">מהיר יותר</button></div>
        <p class="note" style="margin-top:8px">בערך <b class="n">${fmt1(C.expectedWeeklyLoss(C.effectiveDeficit(prof, d.kg, today())))}</b> ק״ג בשבוע. ${target === C.FLOOR ? 'היעד לא יורד מתחת ל-1,200 ביום, גם אם החישוב נותן פחות.' : ''}</p>
        <p class="note">אחרי שלושה שבועות האפליקציה בודקת מה קורה בפועל ומתאימה את היעד לגוף שלך.</p>
      </div>
      <button class="btn block" data-act="next">להמשיך</button>`);
    VIEW.onclick = (ev) => {
      const b = ev.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'def') { d.deficit = +b.dataset.v; keep(); rerender(); }
      else if (b.dataset.act === 'next') location.hash = '#/setup?step=3';
    };
    return;
  }

  /* step 3: seed kit */
  let seed = null;
  try { const r = await fetch('seed.json?v=' + CFG.VERSION); if (r.ok) seed = await r.json(); } catch (_) {}
  const foods = (seed && seed.foods) || [];
  const recipes = (seed && seed.recipes) || [];
  setView(`${dots}
    ${foods.length ? `<div class="card"><h3>המאכלים הקבועים שלך</h3>
      <p class="note">דניאל הכין רשימה של מה שאת אוכלת בדרך כלל. אפשר להוריד סימון ממה שלא מתאים, ולהוסיף עוד בכל זמן.</p>
      <div style="margin-top:8px">${foods.map((f, i) => `<label class="confirmrow" style="cursor:pointer"><input type="checkbox" data-f="${i}" checked style="width:24px;height:24px;flex:none">
        ${dot(f.per100.k, f.liquid)}<div class="nm"><div class="t">${esc(f.name)}</div><div class="s">${f.lastPortion ? esc(f.lastPortion.name) : fmt(f.lastGrams || 100) + ' גרם'} · ${fmt(C.nutrition(f.per100, seedGrams(f)).k)} קלוריות</div></div></label>`).join('')}
      ${recipes.map((r, i) => `<label class="confirmrow" style="cursor:pointer"><input type="checkbox" data-r="${i}" checked style="width:24px;height:24px;flex:none">
        ${icon('book', 'sm')}<div class="nm"><div class="t">${esc(r.name)}</div><div class="s">מתכון · ${r.ingredients.length} רכיבים</div></div></label>`).join('')}</div></div>`
      : `<div class="card"><h3>כמעט סיימנו</h3><p class="note">כל מאכל שתרשמי יישמר, ובפעם הבאה יופיע ללחיצה אחת. אחרי יומיים-שלושה הרישום לוקח שניות.</p></div>`}
    <div class="card flat"><p class="note">שלושה דברים קטנים שעוזרים הכי הרבה: לרשום גם כשאוכלים יותר, לשקול בבוקר כשאפשר, ולמדוד מותניים פעם בשבוע.</p></div>
    <button class="btn block" data-act="finish">${icon('check')}להתחיל</button>`);
  VIEW.onclick = async (ev) => {
    if (!ev.target.closest('[data-act="finish"]')) return;
    const pickF = [...VIEW.querySelectorAll('input[data-f]')].filter((x) => x.checked).map((x) => foods[+x.dataset.f]);
    const pickR = [...VIEW.querySelectorAll('input[data-r]')].filter((x) => x.checked).map((x) => recipes[+x.dataset.r]);
    await DB.saveSetting('profile', prof);
    APP.profile = prof;
    await DB.put('weights', { date: today(), kg: d.kg });
    if (d.waist) await DB.put('measurements', { date: today(), waistCm: d.waist });
    await importSeed(pickF, pickR, (seed && seed.meals) || []);
    await saveUi({ onboarded: true, seeded: !!(pickF.length || pickR.length), milestonesSeen: [], aiEnabled: true });
    sessionStorage.removeItem('mf.setup');
    applyTextSize();
    location.hash = '#/';
    // connect to her server now, not only on the next app open
    if (window.Cloud && Cloud.enabled()) Cloud.onBoot().catch(() => {});
  };
}
function seedGrams(f) { return f.lastPortion ? f.lastPortion.grams * (f.lastPortion.count || 1) : (f.lastGrams || 100); }
async function importSeed(foods, recipes, meals) {
  const byName = new Map();
  for (const s of foods) {
    const slotCounts = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
    for (const sl of s.slots || []) if (sl in slotCounts) slotCounts[sl] = 1;
    const f = newFood({ name: s.name, per100: s.per100, portions: s.portions || [], liquid: !!s.liquid, mohCode: s.mohCode || null,
      source: 'seed', lastGrams: s.lastGrams || null, lastPortion: s.lastPortion || null, slotCounts,
      useCount: (s.slots || []).length ? 1 : 0 });
    await putFood(f);
    byName.set(s.name, f);
  }
  for (const r of recipes) {
    const rn = C.recipeNutrition(r.ingredients, r.cookedWeight);
    const rid = uid('r');
    const portion = r.portion && r.portion.grams ? { name: r.portion.name || 'מנה', grams: r.portion.grams } : null;
    const recipe = { id: rid, name: r.name, ingredients: r.ingredients, cookedWeight: r.cookedWeight || null, portion, per100: rn.per100, updatedAt: Date.now() };
    await DB.put('recipes', recipe);
    APP.recipes.push(recipe);
    const slotCounts = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
    for (const sl of r.slots || []) if (sl in slotCounts) slotCounts[sl] = 1;
    const f = newFood({ name: r.name, per100: rn.per100, portions: portion ? [portion] : [], source: 'recipe', recipeId: rid,
      lastPortion: portion ? { ...portion, count: 1 } : null, slotCounts, useCount: (r.slots || []).length ? 1 : 0 });
    await putFood(f);
    byName.set(r.name, f);
  }
  for (const m of meals) {
    const items = m.items.map((x) => { const f = byName.get(x.name); return f ? { foodId: f.id, name: f.name, grams: x.grams, portion: x.portion || null } : null; }).filter(Boolean);
    if (items.length) {
      const meal = { id: uid('m'), name: m.name, items, useCount: 0, lastUsed: 0 };
      await DB.put('meals', meal); APP.meals.push(meal);
    }
  }
}
