/* צלחת — all the numbers. Pure functions (no DOM, no DB); loadable in Node
   for tests. Formulas are documented in SPEC.md section 5. */
(function (root) {
  const KCAL_PER_KG = 7700;
  const FLOOR = 1200;
  const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
  const SLOT_HE = { breakfast: 'בוקר', lunch: 'צהריים', dinner: 'ערב', snack: 'נשנוש' };

  /* ---------------- dates (local, 'YYYY-MM-DD') ---------------- */
  const pad = (n) => String(n).padStart(2, '0');
  function ymd(d = new Date()) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function diffDays(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 864e5); }
  function weekStart(s) { return addDays(s, -parseYmd(s).getDay()); }   // Sunday
  function hhmm(d = new Date()) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function slotForHour(h) {
    if (h >= 5 && h < 11) return 'breakfast';
    if (h >= 11 && h < 16) return 'lunch';
    if (h >= 16 && h < 22) return 'dinner';
    return 'snack';
  }

  /* ---------------- small math ---------------- */
  const r1 = (x) => Math.round(x * 10) / 10;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  function fmt(n) { return Math.round(n).toLocaleString('he-IL'); }
  function fmt1(n) { return (Math.round(n * 10) / 10).toLocaleString('he-IL', { maximumFractionDigits: 1 }); }

  /* ---------------- body & target ---------------- */
  function ageOn(birthYear, today) { return parseYmd(today).getFullYear() - birthYear; }
  function bmr({ kg, cm, age }) { return 10 * kg + 6.25 * cm - 5 * age - 161; }
  function tdeeFormula(profile, kg, today) {
    return bmr({ kg, cm: profile.heightCm, age: ageOn(profile.birthYear, today) }) * (profile.activity || 1.2);
  }
  function currentTdee(profile, kg, today) {
    return profile.tdeeActual ? profile.tdeeActual : tdeeFormula(profile, kg, today);
  }
  function targetFor(profile, kg, today) {
    if (profile.targetOverride) return Math.round(profile.targetOverride);
    return Math.max(FLOOR, Math.round(currentTdee(profile, kg, today) - (profile.deficit || 500)));
  }
  function proteinTarget(profile, kg) { return Math.round((profile.proteinPerKg || 1.2) * kg); }
  function expectedWeeklyLoss(deficit) { return (deficit * 7) / KCAL_PER_KG; }
  /* The deficit she actually gets: when the 1,200 floor (or a manual target)
     kicks in, it is smaller than the one she chose, and so is the pace. */
  function effectiveDeficit(profile, kg, today) {
    return Math.max(0, currentTdee(profile, kg, today) - targetFor(profile, kg, today));
  }

  /* ---------------- nutrition ---------------- */
  /* per100.once: a fixed part counted once per entry, however much of the food
     (the spray of oil in an omelette: two eggs in one pan still get one spray). */
  function nutrition(per100, grams) {
    const f = (Number(grams) || 0) / 100;
    const o = f > 0 && per100.once ? per100.once : { k: 0, p: 0, f: 0, c: 0 };
    return { k: Math.round(per100.k * f + o.k), p: r1(per100.p * f + o.p), f: r1(per100.f * f + o.f), c: r1(per100.c * f + o.c) };
  }
  function sum(entries) {
    const t = { k: 0, p: 0, f: 0, c: 0 };
    for (const e of entries) { t.k += e.k || 0; t.p += e.p || 0; t.f += e.f || 0; t.c += e.c || 0; }
    return { k: Math.round(t.k), p: r1(t.p), f: r1(t.f), c: r1(t.c) };
  }
  /* Calorie density colour. Drinks need their own thresholds, otherwise wine
     (≈85 kcal/100 ml) would come out green. */
  function density(k100, liquid) {
    if (k100 == null || isNaN(k100)) return 'none';
    if (liquid) return k100 <= 40 ? 'g' : k100 <= 50 ? 'y' : 'o';
    return k100 <= 100 ? 'g' : k100 <= 240 ? 'y' : 'o';
  }
  function recipeNutrition(ingredients, cookedWeight) {
    const tot = { k: 0, p: 0, f: 0, c: 0 };
    let raw = 0;
    for (const ing of ingredients) {
      const g = Number(ing.grams) || 0;
      raw += g;
      tot.k += ing.per100.k * g / 100; tot.p += ing.per100.p * g / 100;
      tot.f += ing.per100.f * g / 100; tot.c += ing.per100.c * g / 100;
      const o = g > 0 && ing.per100.once;
      if (o) { tot.k += o.k; tot.p += o.p; tot.f += o.f; tot.c += o.c; }
    }
    const weight = Number(cookedWeight) > 0 ? Number(cookedWeight) : raw;
    const per100 = weight > 0
      ? { k: Math.round(tot.k / weight * 100), p: r1(tot.p / weight * 100), f: r1(tot.f / weight * 100), c: r1(tot.c / weight * 100) }
      : { k: 0, p: 0, f: 0, c: 0 };
    return { total: { k: Math.round(tot.k), p: r1(tot.p), f: r1(tot.f), c: r1(tot.c) }, weight, rawWeight: raw, per100 };
  }

  /* ---------------- aggregates ---------------- */
  function dayTotals(entries) {
    const map = new Map();
    for (const e of entries) {
      let t = map.get(e.date);
      if (!t) { t = { k: 0, p: 0, n: 0, slots: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 }, slotP: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 } }; map.set(e.date, t); }
      t.k += e.k || 0; t.p += e.p || 0; t.n += 1;
      t.slots[e.slot] = (t.slots[e.slot] || 0) + (e.k || 0);
      t.slotP[e.slot] = (t.slotP[e.slot] || 0) + (e.p || 0);
    }
    return map;
  }
  function loggedSet(totalsMap, closedDates) {
    const s = new Set(totalsMap.keys());
    for (const d of closedDates || []) s.add(d);
    return s;
  }
  function streak(logged, today) {
    let d = logged.has(today) ? today : addDays(today, -1);
    let n = 0;
    while (logged.has(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  /* Average of the week's logged days (Sun–Sat). Today counts only once it is
     closed, otherwise a half-eaten day drags the average down. */
  function weekAverage(totalsMap, closedSet, date, today) {
    const ws = weekStart(date);
    let total = 0, n = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d > date) break;
      const t = totalsMap.get(d);
      if (!t) continue;
      if (d === today && !closedSet.has(d)) continue;
      total += t.k; n++;
    }
    return n ? { avg: Math.round(total / n), days: n } : null;
  }

  /* ---------------- weight ---------------- */
  function sortedWeights(weights) { return [...weights].sort((a, b) => (a.date < b.date ? -1 : 1)); }
  function avgWindow(weights, endDate, days = 7) {
    const lo = addDays(endDate, -(days - 1));
    const xs = weights.filter((w) => w.date >= lo && w.date <= endDate).map((w) => w.kg);
    return xs.length ? mean(xs) : null;
  }
  function kgNow(profile, weights, today) {
    const a = avgWindow(weights, today, 7);
    if (a != null) return a;
    const past = sortedWeights(weights).filter((w) => w.date <= today);
    return past.length ? past[past.length - 1].kg : profile.startWeight;
  }
  function weightSeries(weights, from, to) {
    const ws = sortedWeights(weights).filter((w) => w.date >= from && w.date <= to);
    return ws.map((w) => ({ date: w.date, kg: w.kg, avg: avgWindow(weights, w.date, 7) }));
  }
  function forecast(avg7, tdee, intakeToday, weeks = 5) {
    return avg7 - ((tdee - intakeToday) / KCAL_PER_KG) * 7 * weeks;
  }

  /* Every 14 days from week 3: real expenditure = logged intake + the energy
     implied by the change in average weight. Days under 500 kcal are treated
     as partially logged and ignored. Moves at most 150 kcal at a time. */
  function calibration({ totalsMap, weights, profile, today, kg }) {
    if (!profile.startDate || diffDays(profile.startDate, today) < 21) return null;
    const end = addDays(today, -1);
    const begin = addDays(end, -13);
    const intakes = [];
    for (let i = 0; i < 14; i++) {
      const t = totalsMap.get(addDays(begin, i));
      if (t && t.k >= 500) intakes.push(t.k);
    }
    const mid = addDays(begin, 6);
    const w1 = weights.filter((w) => w.date >= begin && w.date <= mid).map((w) => w.kg);
    const w2 = weights.filter((w) => w.date > mid && w.date <= end).map((w) => w.kg);
    if (intakes.length < 10 || w1.length < 3 || w2.length < 3 || w1.length + w2.length < 8) return null;
    const intake = mean(intakes);
    const lostPerDay = (mean(w1) - mean(w2)) / 7;
    const tdeeActual = Math.round(intake + lostPerDay * KCAL_PER_KG);
    const cur = Math.round(currentTdee(profile, kg, today));
    const base = { tdeeActual, cur, intake: Math.round(intake), change: r1(mean(w1) - mean(w2)), loggedDays: intakes.length };
    if (Math.abs(tdeeActual - cur) <= 150) return { ...base, newTdee: null };
    const newTdee = Math.round(cur + clamp(tdeeActual - cur, -150, 150));
    return { ...base, newTdee, newTarget: Math.max(FLOOR, newTdee - (profile.deficit || 500)) };
  }

  /* ---------------- evening suggestions ---------------- */
  /* Only meaningful once part of the day is eaten: with the whole budget
     still open, "what fits" is everything. */
  function eveningCombos(foods, remaining) {
    if (remaining < 150 || remaining > 1100) return [];
    const list = foods.slice(0, 12);
    const out = [];
    const consider = (items) => {
      const k = items.reduce((a, x) => a + x.k, 0);
      if (k >= remaining * 0.5 && k <= remaining) {
        out.push({ items, k, p: r1(items.reduce((a, x) => a + x.p, 0)) });
      }
    };
    const n = list.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        consider([list[i], list[j]]);
        for (let m = j + 1; m < n; m++) {
          consider([list[i], list[j], list[m]]);
          for (let q = m + 1; q < n; q++) consider([list[i], list[j], list[m], list[q]]);
        }
      }
    }
    out.sort((a, b) => b.p - a.p || Math.abs(a.k - remaining * 0.85) - Math.abs(b.k - remaining * 0.85));
    const picked = [];
    const used = new Map();
    for (const c of out) {
      // keep the three suggestions visibly different
      if (c.items.some((x) => (used.get(x.id) || 0) >= 2)) continue;
      picked.push(c);
      c.items.forEach((x) => used.set(x.id, (used.get(x.id) || 0) + 1));
      if (picked.length === 3) break;
    }
    return picked;
  }

  /* ---------------- encouragement ---------------- */
  /* Real, positive facts about the last 7 days, strongest first. There is
     always at least one. */
  function wins({ today, weights, measurements, totalsMap, closedSet, profile, target, proteinGoal }) {
    const out = [];
    const a0 = avgWindow(weights, today, 7);
    const a7 = avgWindow(weights, addDays(today, -7), 7);
    if (a0 != null && a7 != null && a7 - a0 >= 0.1) {
      out.push({ s: 6 + (a7 - a0) * 5, icon: 'scale', text: `ממוצע המשקל ירד ב-${fmt1(a7 - a0)} ק"ג השבוע` });
    }
    const ms = [...(measurements || [])].filter((m) => m.waistCm).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (ms.length >= 2) {
      const last = ms[ms.length - 1], prev = ms[ms.length - 2];
      if (diffDays(last.date, today) <= 7 && prev.waistCm - last.waistCm >= 0.5) {
        out.push({ s: 7, icon: 'tape', text: `היקף המותניים ירד ב-${fmt1(prev.waistCm - last.waistCm)} ס"מ` });
      } else if (ms[0].waistCm - last.waistCm >= 1) {
        out.push({ s: 3.5, icon: 'tape', text: `מאז ההתחלה: ${fmt1(ms[0].waistCm - last.waistCm)} ס"מ פחות במותניים` });
      }
    }
    if (a0 != null && profile.startWeight && profile.startWeight - a0 >= 0.5) {
      out.push({ s: 4, icon: 'trophy', text: `מאז שהתחלת: ${fmt1(profile.startWeight - a0)} ק"ג פחות` });
    }
    const days = [], prevDays = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, -i);
      const t = totalsMap.get(d);
      if (t && !(d === today && !closedSet.has(d))) days.push(t);
      const pd = totalsMap.get(addDays(today, -7 - i));
      if (pd) prevDays.push(pd);
    }
    const loggedCount = [0, 1, 2, 3, 4, 5, 6].filter((i) => totalsMap.has(addDays(today, -i))).length;
    if (days.length >= 3) {
      const avgK = mean(days.map((t) => t.k));
      if (avgK <= target) out.push({ s: 5, icon: 'check', text: 'הממוצע של השבוע בתוך התקציב' });
      if (prevDays.length >= 3) {
        const dn = mean(days.map((t) => t.slots.dinner || 0));
        const dp = mean(prevDays.map((t) => t.slots.dinner || 0));
        if (dp - dn >= 50) out.push({ s: 5.5, icon: 'moon', text: `ארוחות הערב קלות ב-${fmt(dp - dn)} קלוריות מהשבוע שעבר` });
        const pn = mean(days.map((t) => t.p)), pp = mean(prevDays.map((t) => t.p));
        if (pn - pp >= 5) out.push({ s: 2.5, icon: 'leaf', text: `יותר חלבון: ${fmt(pn)} גרם ביום בממוצע` });
      }
      if (proteinGoal && mean(days.map((t) => t.p)) >= proteinGoal) {
        out.push({ s: 3, icon: 'leaf', text: 'יעד החלבון הושג בממוצע השבוע' });
      }
    }
    if (loggedCount >= 4) out.push({ s: 3 + loggedCount / 7, icon: 'calendar', text: `רשמת ${loggedCount} ימים מתוך 7` });
    const st = streak(loggedSet(totalsMap, closedSet), today);
    if (st >= 3) out.push({ s: 3.2, icon: 'flame', text: `${st} ימים ברצף` });
    if (!out.length) {
      out.push(loggedCount
        ? { s: 1, icon: 'sparkle', text: `כל רישום הוא צעד. רשמת ${loggedCount === 1 ? 'יום אחד' : loggedCount + ' ימים'} השבוע` }
        : { s: 0, icon: 'sparkle', text: 'היום זה יום טוב להתחיל. רישום אחד וזהו' });
    }
    return out.sort((a, b) => b.s - a.s);
  }

  /* When the scale says something discouraging, explain it. */
  function scaleNote({ weights, measurements, today }) {
    const todayW = weights.find((w) => w.date === today);
    const a0 = avgWindow(weights, today, 7);
    if (todayW && a0 != null && todayW.kg - a0 >= 0.5) {
      const a7 = avgWindow(weights, addDays(today, -7), 7);
      const trend = a7 != null && a7 - a0 >= 0.1 ? ` הממוצע השבועי ירד ב-${fmt1(a7 - a0)}.` : ' הממוצע הוא מה שקובע.';
      return `השקילה היום גבוהה מהממוצע ב-${fmt1(todayW.kg - a0)} ק"ג. זה מים, לא שומן.${trend}`;
    }
    const a14 = avgWindow(weights, addDays(today, -14), 7);
    if (a0 != null && a14 != null && Math.abs(a14 - a0) < 0.25) {
      const ms = [...(measurements || [])].filter((m) => m.waistCm).sort((a, b) => (a.date < b.date ? -1 : 1));
      const waistDown = ms.length >= 2 && ms[0].waistCm - ms[ms.length - 1].waistCm >= 0.5;
      return 'המשקל מתאזן כבר שבועיים. זה קורה לכולם אחרי הירידה הראשונה, והגוף מתרגל.'
        + (waistDown ? ' ההיקף ממשיך לרדת, כלומר השומן יורד.' : ' ממשיכים לרשום, והכיול יתאים את היעד אם צריך.');
    }
    return null;
  }

  function milestones({ profile, weights, measurements, totalsMap, closedSet, today }) {
    const out = [];
    const a0 = avgWindow(weights, today, 7);
    if (a0 != null && profile.startWeight) {
      const lost = Math.floor(profile.startWeight - a0 + 1e-9);
      for (let k = 1; k <= lost; k++) out.push({ id: 'kg' + k, text: `${k} ק"ג פחות בממוצע` });
    }
    const ms = [...(measurements || [])].filter((m) => m.waistCm).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (ms.length >= 2) {
      const cm = Math.floor((ms[0].waistCm - ms[ms.length - 1].waistCm) / 2) * 2;
      for (let c = 2; c <= cm; c += 2) out.push({ id: 'waist' + c, text: `${c} ס"מ פחות במותניים` });
    }
    const st = streak(loggedSet(totalsMap, closedSet), today);
    for (const n of [7, 30, 100]) if (st >= n) out.push({ id: 'streak' + n, text: `${n} ימים ברצף` });
    if (profile.startDate) {
      const w = diffDays(profile.startDate, today);
      if (w >= 28) out.push({ id: 'month1', text: 'חודש שלם עם צלחת' });
      if (w >= 84) out.push({ id: 'month3', text: 'שלושה חודשים עם צלחת' });
    }
    return out;
  }

  /* What the day-close note is built from, besides today's numbers: how this
     day compares with her usual days, and what she already eats that has protein. */
  /* Foods the app must never SUGGEST. Logging them is always fine — the whole
     voice of the day-close note is that she writes down the wine too — this is
     only about what the app puts in her mouth as an idea.

     The seed is deliberately short. The guidelines are clear that no food has
     been shown to trigger flares for everyone (AGA 2024, NIDDK), so a long
     blanket list would be wrong and, for a woman in her 60s, actively harmful:
     stripping out food groups is how calcium and bone density go. What is here
     is (a) what Daniel says SHE cannot have, and (b) the few items with a
     UC-specific signal — alcohol and red/processed meat (Jowett 2004) — plus
     ultra-processed, sugary drinks, deep-fried and polyols. Editable in
     settings, because triggers are individual. */
  const AVOID_SEED = [
    'חלב', 'חלבי', 'גבינה', 'גבינת', 'גבינות', 'קוטג', 'יוגורט', 'שמנת', 'לבנה', 'חמאה', 'גלידה',
    'יין', 'בירה', 'וודקה', 'ויסקי', 'ערק', 'אלכוהול',
    'נקניק', 'נקניקיה', 'נקניקיות', 'סלמי', 'פסטרמה', 'קבב', 'בשר בקר', 'בקר', 'כבש', 'המבורגר',
    'מטוגן', 'מטוגנת', 'שניצל', "צ'יפס", 'ציפס', 'קולה', 'משקה מוגז', 'חטיף', 'חטיפים',
    'ללא סוכר', 'דיאט', 'מסטיק',
  ];
  /* Mediterranean, dairy-free, and gentle when cooked soft: what the note
     falls back on when nothing she already eats fits. */
  const SAFE_PROTEIN = ['ביצה', 'דג', 'עוף', 'טונה', 'טחינה', 'טופו', 'עדשים'];

  const PREFIX = 'בלכמשהו';
  function words(name) {
    return String(name || '').replace(/['׳"״]/g, '').split(/[^֐-׿\w%]+/).filter(Boolean)
      .flatMap((w) => (w.length > 3 && PREFIX.includes(w[0]) ? [w, w.slice(1)] : [w]));
  }
  /* Mentioning what she ate is fine and wanted — "רשמת גם את היין, ככה רואים
     את התמונה האמיתית" is one of the good lines. What must never happen is the
     app OFFERING one of these foods. The note is always two sentences, the
     first about today and the second the idea for tomorrow, so only the idea
     is held to the list. */
  function suggestsAvoided(text, avoid) {
    const parts = String(text || '').split(/(?<=\.)\s+/);
    return avoidsFood(parts.length > 1 ? parts.slice(1).join(' ') : text, avoid);
  }

  /* Word-level, not substring: "חלב" must not match "חלבון". */
  function avoidsFood(name, avoid) {
    const list = avoid && avoid.length ? avoid : AVOID_SEED;
    const clean = String(name || '').replace(/['׳"״]/g, '');
    const ws = new Set(words(name));
    return list.some((raw) => {
      const term = String(raw || '').replace(/['׳"״]/g, '').trim();
      if (!term) return false;
      return term.includes(' ') ? clean.includes(term) : ws.has(term);
    });
  }

  function coachFacts(entries, totalsMap, date, recentEntries, avoid) {
    const meals = { breakfast: [], lunch: [], dinner: [], snack: [] };
    for (const e of entries) {
      const list = meals[e.slot] || meals.snack;
      const same = list.find((x) => x.name === e.name);
      if (same) { same.kcal += e.k || 0; same.protein += e.p || 0; }
      else list.push({ name: e.name, kcal: e.k || 0, protein: e.p || 0 });
    }
    for (const list of Object.values(meals)) for (const x of list) { x.kcal = Math.round(x.kcal); x.protein = r1(x.protein); }
    const y = totalsMap.get(addDays(date, -1));
    const past = [];
    for (let i = 1; i <= 14; i++) { const t = totalsMap.get(addDays(date, -i)); if (t) past.push(t); }
    const dinners = past.map((t) => t.slots.dinner).filter((k) => k > 0);
    // her own protein foods: at least 10 g protein per 100 kcal, a normal portion, most eaten
    const count = new Map();
    for (const e of recentEntries || []) {
      if (!e.k || e.k < 40 || e.k > 250 || (e.p || 0) * 10 < e.k || e.liquid) continue;
      if (avoidsFood(e.name, avoid)) continue;   // she eats it, but the app never suggests it
      count.set(e.name, (count.get(e.name) || 0) + 1);
    }
    const proteinFood = [...count].sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || null;
    // what makes tonight different from her usual evenings
    const seen = new Set((recentEntries || []).filter((e) => e.date < date && e.date >= addDays(date, -14)).map((e) => e.name));
    const newFoods = [...new Set(entries.map((e) => e.name))].filter((n) => !seen.has(n)).slice(0, 6);
    const dinnerNow = meals.dinner.reduce((s, x) => s + x.kcal, 0);
    let dinnerLightestIn = null;
    if (dinnerNow > 0) {
      let n = 0;
      for (let i = 1; i <= 14; i++) {
        const t = totalsMap.get(addDays(date, -i));
        if (!t || !(t.slots.dinner > 0)) continue;
        if (t.slots.dinner <= dinnerNow) break;
        n = i;
      }
      if (n >= 3) dinnerLightestIn = n;
    }
    return {
      meals,
      yesterday: y ? { kcal: Math.round(y.k), dinner: Math.round(y.slots.dinner) } : null,
      dinnerAvg14: dinners.length >= 3 ? Math.round(mean(dinners)) : null,
      breakfastDays14: past.filter((t) => t.slots.breakfast > 0).length,
      proteinFood, newFoods, dinnerLightestIn,
      weekday: WEEKDAY_HE[parseYmd(date).getDay()],
    };
  }

  const WEEKDAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  /* Days left to the next streak milestone (7, 30, 100), or null past 100. */
  function toMilestone(streakDays) {
    const n = [7, 30, 100].find((m) => m > streakDays);
    return n ? n - streakDays : null;
  }
  /* Small stable hash so a day always gets the same pick (reopening the sheet
     shows the same local note), but consecutive days differ. */
  function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* What the note looks at tonight. Only angles the day has material for, and
     never the one used last time — the single biggest cause of "it always says
     the same thing". */
  function pickAngle({ date, meals, yesterday, dinnerAvg14, dinnerLightestIn, newFoods, streakDays, weekAvg, lastAngle }) {
    const dinner = ((meals && meals.dinner) || []).reduce((s, x) => s + x.kcal, 0);
    const ok = ['food', 'effort'];
    if (dinner > 0 && (dinnerLightestIn || (dinnerAvg14 && dinner <= dinnerAvg14 * 0.9) || (yesterday && yesterday.dinner && dinner <= yesterday.dinner * 0.9))) ok.push('dinner');
    if (streakDays >= 3) ok.push('streak');
    if (weekAvg) ok.push('week');
    if (newFoods && newFoods.length) ok.push('new');
    const pool = ok.filter((a) => a !== lastAngle);
    return pool[hashStr(date) % pool.length];
  }

  /* Warm lines for the evenings Gemini can't answer. Gemini refreshes a
     personal bank about once a week (ui.cheerBank); this starter set covers
     day one and a phone that never gets online. No numbers, no food offers. */
  const STARTER_BANK = {
    titles: [
      'עוד יום יפה מאחורייך', 'סגרנו עוד יום', 'יום שלם בספר', 'ערב טוב וגאה', 'עוד צעד קטן קדימה',
      'יום שנרשם עד הסוף', 'הנה עוד יום', 'ככה זה נראה', 'עוד דף במחברת', 'יום רגוע ויפה',
      'היום עשית את זה', 'עוד ערב של התמדה', 'יום טוב נסגר', 'שקט של סוף יום', 'עוד יום שלך',
      'לאט ובטוח', 'יום אחרי יום', 'ערב של סיפוק',
    ],
    lines: [
      'מחר מחכה יום חדש, ואת כבר יודעת איך עושים את זה.',
      'ככה בונים הרגל, ערב אחרי ערב.',
      'את עושה את זה בשביל עצמך, וזה מורגש.',
      'עוד ערב נרשם בשקט, בלי דרמות.',
      'התמונה נבנית מהימים הרגילים, והיום היה אחד מהם.',
      'לילה טוב, מחר ממשיכות מאותה נקודה.',
      'אין צורך בשלמות, מספיק להמשיך לרשום.',
      'כל יום רשום מלמד משהו על ההרגלים שלך.',
      'עוד יום שבו בחרת לשים לב, וזה הרבה.',
      'מחר עוד הזדמנות קטנה, בקצב שלך.',
      'לאט לאט, וזה בדיוק הקצב הנכון.',
      'יום אחרי יום, ככה זה עובד.',
      'הערב אפשר לנוח, עשית את החלק שלך.',
      'המחברת מתמלאת, ואיתה גם התמונה של ההרגלים.',
      'עוד ערב שנסגר בשקט ובמודעות.',
      'את מתמידה, וזה הדבר הכי חשוב כאן.',
    ],
  };
  /* The first line in a day-shuffled order that was not shown recently; when
     all were shown, start over. used = strings shown before (newest last). */
  function pickFresh(list, used, seed) {
    if (!list || !list.length) return null;
    const n = list.length, start = hashStr(seed) % n, recent = new Set((used || []).slice(-Math.max(1, n - 1)));
    for (let i = 0; i < n; i++) { const s = list[(start + i) % n]; if (!recent.has(s)) return s; }
    return list[start];
  }
  const MILESTONE_TITLE = { 7: 'שבוע שלם ברצף', 30: 'חודש שלם ברצף', 100: 'מאה ימים ברצף' };

  /* Offline fallback for the coach note, in the same voice as the Gemini one:
     one specific good thing from today, one small idea for tomorrow. No numbers
     (they are on the screen above it), never "חרגת". */
  /* date picks among 2-3 phrasings per case, recent (earlier notes) are
     skipped, and bankLine (from the Gemini bank) closes a day that has no
     idea for tomorrow. Without date it behaves as before: first phrasing. */
  function coachLocal({ protein, proteinGoal, streakDays, meals, yesterday, dinnerAvg14, proteinFood, newFoods, date, recent, bankLine }) {
    const m = meals || { breakfast: [], lunch: [], dinner: [], snack: [] };
    const total = (list) => list.reduce((s, x) => s + x.kcal, 0);
    const dinner = total(m.dinner);
    const lunchTop = [...m.lunch].sort((a, b) => b.protein - a.protein)[0];
    const fresh = (newFoods || []).find((n) => n.length <= 25);
    let firsts;
    if (dinner > 0 && dinnerAvg14 && dinner <= dinnerAvg14 * 0.85) firsts = ['ארוחת הערב הייתה קלה מהרגיל.', 'הערב יצא קליל יותר מהערבים הרגילים שלך.', 'ערב קל מהרגיל, וזה בדיוק המקום שבו זה נחשב.'];
    else if (dinner > 0 && yesterday && yesterday.dinner && dinner <= yesterday.dinner * 0.85) firsts = ['ארוחת הערב הייתה קלה יותר מאתמול.', 'הערב אכלת קל יותר מאתמול, בלי לוותר על ארוחה.'];
    else if (lunchTop && lunchTop.protein >= 20) firsts = [`בצהריים היה חלבון טוב, עם ${lunchTop.name}.`, `בצהריים בחרת ב${lunchTop.name}, וזה חלבון טוב באמצע היום.`];
    else if (m.dinner.some((x) => x.name.includes('יין'))) firsts = ['רשמת גם את היין, ככה רואים את התמונה האמיתית.', 'גם היין נכנס לרישום, וזה מה שהופך את התמונה לאמיתית.'];
    else if (fresh) firsts = [`הופיע היום משהו חדש בצלחת: ${fresh}.`, `יש היום חידוש ברשימה שלך: ${fresh}.`];
    else if (dinner > 0 && !m.snack.length) firsts = ['היום עבר בלי נשנושים בין הארוחות.', 'יום שלם בלי נשנושים בין הארוחות, יפה.'];
    else firsts = ['רשמת את כל היום, וזה מה שעושה את ההבדל.', 'עוד יום שנרשם מההתחלה ועד הסוף.', 'היום כולו רשום, וזה הבסיס של הכול.'];
    let seconds;
    if (proteinGoal && protein < proteinGoal * 0.8) {
      const f = proteinFood || 'ביצה או דג';
      seconds = [`מחר אפשר להוסיף ${f} לצהריים, זה מחזיק עד הערב.`, `רעיון למחר: ${f} בצהריים, כדי שהערב יהיה רגוע יותר.`];
    } else if (streakDays >= 3) seconds = ['עוד יום ברצף של רישום, ממשיכות ככה.', 'הרצף ממשיך להתארך, וזה שלך.'];
    else seconds = ['מחר ממשיכים באותה דרך.', 'לילה טוב, מחר ממשיכות.'];
    if (bankLine && !(proteinGoal && protein < proteinGoal * 0.8)) seconds = [bankLine, ...seconds];
    const seen = recent || [];
    const h = date ? hashStr(date) : 0;
    const combos = [];
    for (let i = 0; i < firsts.length; i++) for (let j = 0; j < seconds.length; j++) {
      combos.push(firsts[(h + i) % firsts.length] + ' ' + seconds[bankLine ? j : (h + j) % seconds.length]);
    }
    return combos.find((c) => !seen.some((r) => r === c || r.startsWith(c.split('. ')[0]))) || combos.find((c) => !seen.includes(c)) || combos[0];
  }

  const api = {
    KCAL_PER_KG, FLOOR, SLOTS, SLOT_HE,
    ymd, parseYmd, addDays, diffDays, weekStart, hhmm, slotForHour,
    r1, mean, clamp, fmt, fmt1,
    ageOn, bmr, tdeeFormula, currentTdee, targetFor, proteinTarget, expectedWeeklyLoss, effectiveDeficit,
    nutrition, sum, density, recipeNutrition,
    dayTotals, loggedSet, streak, weekAverage,
    avgWindow, kgNow, weightSeries, forecast, calibration,
    eveningCombos, wins, scaleNote, milestones, coachFacts, coachLocal,
    pickAngle, toMilestone, pickFresh, STARTER_BANK, MILESTONE_TITLE, WEEKDAY_HE,
    AVOID_SEED, SAFE_PROTEIN, avoidsFood, suggestsAvoided,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
