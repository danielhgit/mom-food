/* צלחת — smart help client. Talks only to her own Worker (POST /ai), which
   holds the Gemini key. Every result ends in a confirmation list or a form;
   nothing is saved without her seeing the numbers. Disabled when
   CFG.API_URL is empty. */
(function (root) {
  const r1 = (x) => Math.round(x * 10) / 10;
  /* Needs her Worker AND a Gemini key on it (reported by /ping at boot). */
  function enabled() { return !!(root.CFG && root.CFG.API_URL && root.APP && root.APP.ui && root.APP.ui.aiReady === true); }

  async function call(kind, payload) {
    const auth = await root.Cloud.authHeader();
    const res = await fetch(root.CFG.API_URL.replace(/\/$/, '') + '/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ kind, payload }),
    });
    if (!res.ok) { const e = new Error('ai ' + res.status); e.status = res.status; throw e; }
    return res.json();
  }

  async function imageToB64(file, max) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
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
  async function plate(file, lib) {
    return toItems(await call('plate', { image: await imageToB64(file, 1024), library: libraryNames(lib) }), lib);
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
  async function coach(summary) {
    const r = await call('coach', summary);
    return r && r.text ? String(r.text).trim() : null;
  }

  root.AI = { enabled, describe, plate, label, coach };
})(window);
