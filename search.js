/* צלחת — local Hebrew food search over her library and the MOH database.
   Pure functions; also loadable in Node for tests. */
(function (root) {
  const FIN = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFKD')
      .replace(/[֑-ׇ]/g, '')          // niqqud and cantillation
      .replace(/[ךםןףץ]/g, (c) => FIN[c])
      .replace(/יי/g, 'י').replace(/וו/g, 'ו')   // עגבנייה == עגבניה
      .replace(/["'״׳`.,()\/\-–—:;%+*!?]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  /* Portion words carry no food identity: "פרוסת חלה" searches "חלה". */
  const UNIT_WORDS = new Set(('פרוסה פרוסת פרוסות כף כפות כפית כפיות כוס כוסות יחידה יחידות '
    + 'חתיכה חתיכת חתיכות מנה מנת מנות גביע גביעים גרם גר ג גרמים קערה קערת צלחת מל '
    + 'קופסה קופסת שקית').split(' ').map((w) => norm(w)));

  /* Hebrew plural → a stem that still prefix-matches the singular:
     ביצים → ביצ (ביצה), עגבניות → עגבני (עגבניה), פטריות → פטרי. */
  function stem(tok) {
    if (tok.length > 4 && (tok.endsWith('ימ') || tok.endsWith('ות'))) return tok.slice(0, -2);
    if (tok.length > 3 && tok.endsWith('ה')) return tok.slice(0, -1);
    return null;
  }

  /* Cache normalised forms on the object as non-enumerable properties, so
     they never leak into IndexedDB; recompute if the name changed. */
  function hidden(obj, key, value) {
    Object.defineProperty(obj, key, { value, enumerable: false, writable: true, configurable: true });
  }
  function prep(item, name, english) {
    if (item._nsrc === name) return item;
    const nn = norm(name);
    hidden(item, '_nsrc', name);
    hidden(item, '_nn', nn);
    hidden(item, '_head', norm(String(name).split(',')[0]));
    hidden(item, '_words', nn.split(' '));
    hidden(item, '_ne', norm(english || ''));
    return item;
  }

  function tokMatchesWords(tok, words) {
    const st = stem(tok);
    return words.some((w) => w.startsWith(tok) || (st && w.startsWith(st)));
  }

  /* Lower score = better. -1 = no match. */
  function score(item, qn, toks) {
    const nn = item._nn;
    if (nn === qn || item._head === qn) return 0;
    if (nn.startsWith(qn)) return 1;
    const headWords = item._head.split(' ');
    if (toks.every((t) => tokMatchesWords(t, headWords))) return 2;
    if (toks.every((t) => tokMatchesWords(t, item._words))) return 3;
    if (toks.every((t) => nn.includes(t) || (stem(t) && nn.includes(stem(t))))) return 4;
    if (item._ne && toks.every((t) => tokMatchesWords(t, item._ne.split(' ')))) return 5;
    return -1;
  }

  function searchScored(items, query, { limit = 30, nameOf = (x) => x.n, englishOf = (x) => x.e } = {}) {
    let toks = norm(query).split(' ').filter(Boolean);
    const foodToks = toks.filter((t) => !UNIT_WORDS.has(t));
    if (foodToks.length) toks = foodToks;
    const qn = toks.join(' ');
    if (!qn) return [];
    const hits = [];
    for (const it of items) {
      prep(it, nameOf(it), englishOf(it));
      let sc = score(it, qn, toks);
      if (sc < 0) continue;
      const staple = it.b ? 1 : 0;
      // a staple jumps two levels when the query names its first word
      // ("ביצים" → ביצה שלמה), only one when it matches a later word
      // ("זיתים" must not become שמן זית)
      if (staple && sc > 0 && sc < 5) {
        const w0 = it._words[0] || '';
        const firstHit = toks.some((t) => w0.startsWith(t) || (stem(t) && w0.startsWith(stem(t))));
        sc = Math.max(0, sc - (firstHit ? 2 : 1));
      }
      hits.push({ item: it, score: sc, staple, len: it._nn.length });
    }
    hits.sort((a, b) => a.score - b.score || b.staple - a.staple || a.len - b.len);
    return hits.slice(0, limit);
  }

  function search(items, query, opts) {
    return searchScored(items, query, opts).map((h) => h.item);
  }

  /* One shape for "a food" wherever it came from, so the sheets and the
     parser do not care whether it is hers or from the ministry DB. */
  function viewMoh(m) {
    return {
      src: 'moh', mohCode: m.i, name: m.n, liquid: !!m.l,
      per100: { k: m.k, p: m.p, f: m.f, c: m.c },
      portions: (m.u || []).map(([name, grams]) => ({ name, grams })),
      ref: m,
    };
  }
  function viewLib(f) {
    return {
      src: 'lib', id: f.id, mohCode: f.mohCode, name: f.name, liquid: !!f.liquid,
      per100: f.per100, portions: f.portions || [], lastGrams: f.lastGrams,
      lastPortion: f.lastPortion, fav: f.fav, ref: f,
    };
  }

  const api = { norm, stem, search, searchScored, UNIT_WORDS, viewMoh, viewLib };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Search = api;
})(typeof window !== 'undefined' ? window : globalThis);
