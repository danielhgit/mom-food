/* צלחת — local free-text parser: "2 ביצים, פרוסת חלה, 30 גרם בולגרית, כוס יין".
   Works offline and on speech transcripts that have no commas: a quantity or
   a unit word starts a new item once the current item already has a food.
   Everything it returns goes to a confirmation list; nothing is saved blind. */
(function (root) {
  const S = root.Search || (typeof require !== 'undefined' ? require('./search.js') : null);
  const { norm } = S;

  const NUM_WORDS = {
    'אחד': 1, 'אחת': 1, 'שתי': 2, 'שני': 2, 'שתיים': 2, 'שניים': 2, 'זוג': 2,
    'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4, 'חמש': 5, 'חמישה': 5,
    'שש': 6, 'שישה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9,
    'עשר': 10, 'עשרה': 10, 'חצי': 0.5, 'רבע': 0.25, 'שליש': 0.33,
  };
  const UNITS = {
    'גרם': 'g', 'גר': 'g', 'ג': 'g', 'גרמים': 'g', 'מל': 'g', 'מיליליטר': 'g',
    'פרוסה': 'פרוסה', 'פרוסת': 'פרוסה', 'פרוסות': 'פרוסה',
    'כף': 'כף', 'כפות': 'כף',
    'כפית': 'כפית', 'כפיות': 'כפית',
    'כוס': 'כוס', 'כוסות': 'כוס',
    'יחידה': 'יחידה', 'יחידות': 'יחידה', 'יח': 'יחידה',
    'חתיכה': 'חתיכה', 'חתיכת': 'חתיכה', 'חתיכות': 'חתיכה',
    'מנה': 'מנה', 'מנת': 'מנה', 'מנות': 'מנה',
    'גביע': 'גביע', 'גביעים': 'גביע',
    'קערה': 'קערה', 'קערת': 'קערה', 'צלחת': 'צלחת',
  };
  const FILLER = new Set(['של', 'עם', 'בערך', 'כמעט', 'קצת', 'אכלתי', 'שתיתי', 'היום', 'גם']);
  /* A segment made only of these ("סלט", "ארוחת ערב") describes the meal,
     not a food, when other items follow. */
  const GENERIC = new Set(['סלט', 'ארוחה', 'ארוחת', 'בוקר', 'צהריים', 'ערב', 'נשנוש']);
  /* Used only when the food has no matching portion in the DB. */
  const DEFAULT_GRAMS = { 'כף': 15, 'כפית': 5, 'כוס': 200, 'פרוסה': 30, 'יחידה': 100,
    'חתיכה': 50, 'מנה': 150, 'גביע': 200, 'קערה': 250, 'צלחת': 300 };

  const N_NUM = new Map(Object.entries(NUM_WORDS).map(([w, v]) => [norm(w), v]));
  const N_UNIT = new Map(Object.entries(UNITS).map(([w, v]) => [norm(w), v]));
  const N_FILLER = new Set([...FILLER].map(norm));
  const N_GENERIC = new Set([...GENERIC].map(norm));
  const N_MEAL = new Set(['ארוחה', 'ארוחת', 'בוקר', 'צהריים', 'ערב', 'נשנוש'].map(norm));

  function qtyOf(tok) {
    if (/^\d+(\.\d+)?$/.test(tok)) return parseFloat(tok);
    if (N_NUM.has(tok)) return N_NUM.get(tok);
    return null;
  }
  const unitOf = (tok) => N_UNIT.get(tok) || null;

  /* ---- step 1: split into item segments ---- */
  function segments(text, isStrongFood) {
    const prepared = String(text || '')
      .replace(/(\d)\s*(גר?'?|ג׳|גרם)(?=\s|,|$)/g, '$1 גרם')     // "30ג" → "30 גרם"
      .replace(/(\d),(\d)/g, '$1.$2')                              // 1,5 → 1.5
      .replace(/[\n;،]+/g, ',')
      .replace(/\s+-\s+|\s+ו-/g, ' , ');
    const out = [];
    let cur = null;
    const close = () => { if (cur && (cur.words.length || cur.qty != null || cur.unit)) out.push(cur); cur = null; };
    const start = () => { cur = { qty: null, unit: null, words: [] }; };
    for (const chunk of prepared.split(',')) {
      close();
      start();
      for (const raw of chunk.split(/\s+/).filter(Boolean)) {
        let tok = norm(raw);
        if (!tok) continue;
        // "ו" prefix: "ופרוסת", "ו30", "ועגבניה"
        if (tok.length > 1 && tok[0] === 'ו') {
          const rest = tok.slice(1);
          if (rest === 'חצי') { if (cur.qty != null) { cur.qty += 0.5; continue; } }
          const restIsFood = isStrongFood && isStrongFood(rest) && !isStrongFood(tok);
          if (qtyOf(rest) != null || unitOf(rest) || restIsFood) {
            if (cur.words.length || (restIsFood && (cur.qty != null || cur.unit))) { close(); start(); }
            tok = rest;
          }
        }
        if (N_FILLER.has(tok)) continue;
        const q = qtyOf(tok);
        const u = unitOf(tok);
        if (q != null) {
          if (cur.words.length) { close(); start(); }
          cur.qty = q;
          continue;
        }
        if (u) {
          if (cur.words.length) { close(); start(); }
          cur.unit = u;
          continue;
        }
        cur.words.push(tok);
      }
    }
    close();
    // a trailing amount belongs to the food before it: "דג סלמון 150 גרם", "חלה פרוסה אחת"
    for (let i = 1; i < out.length; i++) {
      const seg = out[i], prev = out[i - 1];
      if (!seg.words.length && prev.words.length && prev.qty == null && !prev.unit) {
        prev.qty = seg.qty; prev.unit = seg.unit; seg.merged = true;
      }
    }
    const withFood = out.filter((s) => s.words.length && !s.merged);
    const specific = withFood.filter((s) => !(s.qty == null && !s.unit && s.words.every((w) => N_GENERIC.has(w))));
    return specific.length ? specific : withFood;
  }

  /* ---- step 2: pick a food and grams ---- */
  /* Whole-word match on the first word of the portion name, so "כוס" never
     picks "כוסית" (a shot glass) and "כף" never picks "כפית". */
  function matchPortion(portions, unit) {
    const u = norm(unit);
    const hits = (portions || []).filter((p) => norm(p.name).split(' ')[0] === u);
    if (!hits.length) return null;
    return hits.find((p) => norm(p.name) === u)
      || hits.find((p) => p.name.includes('בינונית'))
      || hits[Math.floor((hits.length - 1) / 2)];
  }

  /* Her own foods win when the query names them from the first word
     ("בולגרית" → "בולגרית 5% של אמא"), but a loose match on a later word
     must not steal the query ("זיתים" is not "שמן זית"). A ministry pick
     she already has in her library is swapped for her copy. */
  function firstWordMatches(name, query) {
    const first = norm(name).split(' ')[0] || '';
    const tok = norm(query).split(' ')[0] || '';
    const st = S.stem(tok);
    return !!tok && (first.startsWith(tok) || tok.startsWith(first) || (!!st && first.startsWith(st)));
  }
  function pickFood(query, lib, moh, unit) {
    if (lib && lib.length) {
      const r = S.searchScored(lib, query, { limit: 3, nameOf: (x) => x.name, englishOf: () => '' });
      if (r.length && (r[0].score <= 1 || (r[0].score <= 3 && firstWordMatches(r[0].item.name, query)))) {
        return { view: r[0].item, score: r[0].score };
      }
    }
    if (moh && moh.length) {
      const r = S.searchScored(moh, query, { limit: 8 });
      if (r.length) {
        const best = r.filter((h) => h.score === r[0].score);
        const withUnit = unit && unit !== 'g' ? best.find((h) => matchPortion((h.item.u || []).map(([name, grams]) => ({ name, grams })), unit)) : null;
        const chosen = withUnit || best.find((h) => h.item.u) || best[0];
        const mine = (lib || []).find((v) => v.mohCode && v.mohCode === chosen.item.i);
        return { view: mine || S.viewMoh(chosen.item), score: chosen.score };
      }
    }
    return null;
  }

  function resolve(seg, lib, moh) {
    const foodWords = seg.words.filter((w) => !N_MEAL.has(w));
    const query = (foodWords.length ? foodWords : seg.words).join(' ');
    const hit = pickFood(query, lib, moh, seg.unit);
    const item = { raw: [seg.qty, seg.unit, query].filter((x) => x != null).join(' '), query, food: null,
      grams: null, portion: null, estimated: false, confidence: 'low' };
    if (!hit) return item;
    item.confidence = hit.score <= 1 ? 'high' : 'mid';
    applyAmount(item, seg, hit.view);
    // "זיתים" with no number: plural, but how many is anyone's guess
    const last = seg.words[seg.words.length - 1] || '';
    if (seg.qty == null && !seg.unit && /(ימ|ות)$/.test(last) && last.length > 3) item.estimated = true;
    return item;
  }

  /* Grams and portion for a known food, from a segment's quantity and unit. */
  function applyAmount(item, seg, food) {
    const qty = seg.qty != null ? seg.qty : 1;
    item.food = food;
    item.grams = null; item.portion = null; item.estimated = false;
    if (seg.unit === 'g') {
      item.grams = Math.round(qty);
    } else if (seg.unit) {
      const p = matchPortion(food.portions, seg.unit);
      if (p) { item.grams = Math.round(p.grams * qty); item.portion = { name: p.name, count: qty, grams: p.grams }; }
      else {
        const base = seg.unit === 'כוס' && food.name.includes('יין') ? 150 : (DEFAULT_GRAMS[seg.unit] || 100);
        item.grams = Math.round(base * qty);
        item.estimated = true;
      }
    } else {
      const unitP = matchPortion(food.portions, 'יחידה');
      if (food.lastPortion && food.lastPortion.grams) {
        item.grams = Math.round(food.lastPortion.grams * qty);
        item.portion = { name: food.lastPortion.name, count: qty, grams: food.lastPortion.grams };
      } else if (food.lastGrams) {
        item.grams = Math.round(food.lastGrams * qty);
      } else if (unitP) {
        item.grams = Math.round(unitP.grams * qty);
        item.portion = { name: unitP.name, count: qty, grams: unitP.grams };
      } else {
        item.grams = Math.round(100 * qty);
        item.estimated = true;
      }
    }
    return item;
  }

  function parse(text, { lib = [], moh = [] } = {}) {
    const strong = (tok) => {
      const probe = (arr, opts) => {
        const r = S.searchScored(arr, tok, { limit: 1, ...opts });
        return r.length && r[0].score <= 1;
      };
      return probe(lib, { nameOf: (x) => x.name, englishOf: () => '' }) || probe(moh, {});
    };
    return segments(text, strong).map((seg) => resolve(seg, lib, moh));
  }

  /* "30 גרם" / "פרוסה" / "2 כפות" → {qty, unit} without a food. */
  function amount(text) {
    const seg = { qty: null, unit: null, words: [] };
    for (const raw of String(text || '').replace(/(\d)\s*(גר?'?|ג׳)(?=\s|$)/g, '$1 גרם').split(/\s+/)) {
      const tok = norm(raw);
      if (!tok) continue;
      const q = qtyOf(tok), u = unitOf(tok);
      if (q != null) seg.qty = q; else if (u) seg.unit = u;
    }
    return seg;
  }

  const api = { parse, segments, resolve, applyAmount, amount, matchPortion, DEFAULT_GRAMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Parse = api;
})(typeof window !== 'undefined' ? window : globalThis);
