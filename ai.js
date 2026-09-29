/* צלחת — smart help client. Talks only to her own Worker (POST /ai), which
   holds the Gemini key. Every result ends in a confirmation list or a form;
   nothing is saved without her seeing the numbers. Disabled when
   CFG.API_URL is empty. */
(function (root) {
  const r1 = (x) => Math.round(x * 10) / 10;
  /* Needs her Worker AND a Gemini key on it (reported by /ping at boot). */
  function enabled() { return !!(root.CFG && root.CFG.API_URL && root.APP && root.APP.ui && root.APP.ui.aiReady === true); }
  /* The camera button shows whenever the app has a Worker, and asks /ping on
     the spot. Hiding it until a boot-time ping had succeeded left it missing
     on her phone, with nothing to tell her why. */
  function configured() { return !!(root.CFG && root.CFG.API_URL); }
  async function ensureReady() {
    if (enabled()) return true;
    if (!configured()) return false;
    try {
      const st = await fetch(root.CFG.API_URL.replace(/\/$/, '') + '/ping').then((r) => r.json());
      if (st.ai) await root.saveUi({ aiReady: true });
      return !!st.ai;
    } catch (_) { return false; }
  }

  async function call(kind, payload) {
    const auth = await root.Cloud.authHeader();
    const res = await fetch(root.CFG.API_URL.replace(/\/$/, '') + '/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ kind, payload }),
    });
    if (!res.ok) {
      const e = new Error('ai ' + res.status); e.status = res.status;
      try { e.body = await res.json(); } catch (_) { /* no body */ }
      throw e;
    }
    return res.json();
  }

  /* Big phone photos (50–200 MP on some Samsungs) can make createImageBitmap
     fail for lack of memory, so fall back to a plain <img>. */
  async function decodeImage(file) {
    if (root.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  async function imageToB64(file, max) {
    const bmp = await decodeImage(file);
    const w = bmp.naturalWidth || bmp.width, h = bmp.naturalHeight || bmp.height;
    const scale = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function libraryNames(lib) {
    return lib.filter((f) => !f.hidden).sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).slice(0, 200).map((f) => f.name);
  }

  function toItems(res, lib) {
    const S = root.Search;
    const byName = new Map(lib.filter((f) => !f.hidden).map((f) => [S.norm(f.name), f]));
    return (res.items || []).map((it) => {
      const mine = it.matched_library_name && byName.get(S.norm(it.matched_library_name));
      if (mine && mine.per100 && mine.per100.once && mine.portions && mine.portions.length) {
        // an omelette is counted in eggs, whatever grams the model guessed
        const u = mine.portions[0], count = Math.max(1, Math.round((it.grams || u.grams) / u.grams));
        return { food: S.viewLib(mine), grams: u.grams * count, portion: { name: u.name, count, grams: u.grams }, raw: it.name_he };
      }
      if (mine) return { food: S.viewLib(mine), grams: Math.round(it.grams || mine.lastGrams || 100), raw: it.name_he };
      if (it.kcal100 == null) return { food: null, raw: it.name_he, query: it.name_he, grams: Math.round(it.grams || 100) };
      return {
        food: { src: 'ai', srcType: 'ai', name: it.name_he, liquid: !!it.liquid, portions: [],
          per100: { k: Math.round(it.kcal100), p: r1(it.p100 || 0), f: r1(it.f100 || 0), c: r1(it.c100 || 0) } },
        grams: Math.round(it.grams || 100), raw: it.name_he, estimated: it.confidence === 'low',
      };
    });
  }

  async function describe(text, lib) {
    return toItems(await call('describe', { text, library: libraryNames(lib) }), lib);
  }
  /* Returns the items AND the encoded photo, so that "משהו שלא ראיתי" can send
     her correction back with the same picture instead of asking her to shoot
     it again. note = what she typed, previous = what the model said last time. */
  async function plate(file, lib, { image, note = '', previous = [] } = {}) {
    const b64 = image || (await imageToB64(file, 1024));
    const res = await call('plate', { image: b64, library: libraryNames(lib), note, previous });
    return { items: toItems(res, lib), image: b64 };
  }
  async function label(file) {
    const r = await call('label', { image: await imageToB64(file, 1400) });
    let { kcal, protein, fat, carb } = r;
    if (r.per === 'serving' && r.serving_g > 0) {
      const m = 100 / r.serving_g;
      kcal = kcal != null ? kcal * m : kcal; protein = protein != null ? protein * m : protein;
      fat = fat != null ? fat * m : fat; carb = carb != null ? carb * m : carb;
    }
    const v = (x, round) => (x == null || isNaN(x) ? '' : round(x));
    return { name: r.product_name || '', k: v(kcal, Math.round), p: v(protein, r1), f: v(fat, r1), c: v(carb, r1), liquid: r.per === '100ml' };
  }
  /* The avoid list goes up with the day, and the answer is checked against it
     again here: a note that names something she must not be offered is dropped
     and the app's own note is shown instead. Belt and braces, because the
     Worker may be an older deploy than the app. */
  /* Returns {text, title} or throws with .why (what Settings reports:
     quota, busy, rejected:..., offline...). An older Worker sends no title;
     the app then takes one from the bank. */
  async function coach(summary) {
    const avoid = (root.APP.profile && root.APP.profile.avoid) || root.Calc.AVOID_SEED;
    let r;
    try { r = await call('coach', { ...summary, avoid }); } catch (e) { e.why = await whyOf(e); throw e; }
    const text = r && r.text ? String(r.text).trim() : null;
    if (!text) throw Object.assign(new Error('empty'), { why: 'empty' });
    if (root.Calc.suggestsAvoided(text, avoid)) throw Object.assign(new Error('avoid'), { why: 'rejected:avoid' });
    let title = r.title ? String(r.title).trim() : '';
    if (title && root.Calc.avoidsFood(title, avoid)) title = '';
    return { text, title };
  }
  async function whyOf(e) {
    if (e.body && e.body.error) return String(e.body.error).slice(0, 40);
    if (e.status) return 'http ' + e.status;
    return 'network';
  }

  /* About once a week: a fresh batch of warm titles and closing lines.
     Checked again here against her list. */
  async function bank() {
    const avoid = (root.APP.profile && root.APP.profile.avoid) || root.Calc.AVOID_SEED;
    const r = await call('bank', { avoid });
    const ok = (s) => typeof s === 'string' && s.trim() && !/[A-Za-z0-9!]/.test(s) && !root.Calc.avoidsFood(s, avoid);
    const titles = (r.titles || []).filter(ok), lines = (r.lines || []).filter(ok);
    if (titles.length < 6 || lines.length < 6) throw new Error('thin bank');
    return { titles, lines };
  }

  root.AI = { enabled, configured, ensureReady, describe, plate, label, coach, bank };
})(window);
