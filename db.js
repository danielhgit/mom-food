/* צלחת — IndexedDB layer. Everything she logs lives here, on her phone.
   Schema changes only ever ADD stores/indexes in onupgradeneeded, so an app
   update can never wipe data. */
(function (root) {
  const DB_NAME = 'momfood';
  const DB_VER = 1;
  const STORES = {
    settings:     { keyPath: 'key' },
    foods:        { keyPath: 'id', idx: ['name', 'barcode', 'mohCode', 'lastUsed'] },
    recipes:      { keyPath: 'id' },
    meals:        { keyPath: 'id' },
    entries:      { keyPath: 'id', idx: ['date'] },
    days:         { keyPath: 'date' },
    weights:      { keyPath: 'date' },
    measurements: { keyPath: 'date' },
  };
  const LS_KEY = 'mf.settings';

  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, cfg] of Object.entries(STORES)) {
          const store = db.objectStoreNames.contains(name)
            ? req.transaction.objectStore(name)
            : db.createObjectStore(name, { keyPath: cfg.keyPath });
          for (const ix of cfg.idx || []) {
            if (!store.indexNames.contains(ix)) store.createIndex(ix, ix);
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    return dbp;
  }

  const wrap = (req) => new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

  async function run(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let out;
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('abort'));
      try { out = fn(t); } catch (e) { reject(e); t.abort(); }
    });
  }

  const DB = {
    STORES: Object.keys(STORES),

    async get(store, key) {
      const db = await open();
      return wrap(db.transaction(store).objectStore(store).get(key));
    },
    async all(store) {
      const db = await open();
      return wrap(db.transaction(store).objectStore(store).getAll());
    },
    async byIndex(store, index, value) {
      const db = await open();
      return wrap(db.transaction(store).objectStore(store).index(index).getAll(IDBKeyRange.only(value)));
    },
    async range(store, index, lo, hi) {
      const db = await open();
      const os = db.transaction(store).objectStore(store);
      const src = index ? os.index(index) : os;
      return wrap(src.getAll(IDBKeyRange.bound(lo, hi)));
    },
    put(store, obj) {
      return run([store], 'readwrite', (t) => { t.objectStore(store).put(obj); });
    },
    putMany(store, arr) {
      return run([store], 'readwrite', (t) => {
        const os = t.objectStore(store);
        for (const o of arr) os.put(o);
      });
    },
    del(store, key) {
      return run([store], 'readwrite', (t) => { t.objectStore(store).delete(key); });
    },
    delMany(store, keys) {
      return run([store], 'readwrite', (t) => {
        const os = t.objectStore(store);
        for (const k of keys) os.delete(k);
      });
    },

    /* ---- settings: kept in memory, mirrored to localStorage ---- */
    async loadSettings() {
      const out = {};
      try {
        for (const row of await DB.all('settings')) out[row.key] = row.value;
      } catch (e) {
        try { Object.assign(out, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (_) {}
      }
      return out;
    },
    async saveSetting(key, value) {
      await DB.put('settings', { key, value });
      try {
        const mirror = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        mirror[key] = value;
        localStorage.setItem(LS_KEY, JSON.stringify(mirror));
      } catch (_) {}
    },

    /* ---- backup ---- */
    async exportAll() {
      const data = { app: 'mom-food', schema: 1, exportedAt: new Date().toISOString() };
      for (const s of DB.STORES) data[s] = await DB.all(s);
      return data;
    },
    validateBackup(data) {
      return data && data.app === 'mom-food' && data.schema === 1
        && DB.STORES.every((s) => Array.isArray(data[s]));
    },
    async importAll(data) {
      if (!DB.validateBackup(data)) throw new Error('קובץ גיבוי לא תקין');
      await run(DB.STORES, 'readwrite', (t) => {
        for (const s of DB.STORES) {
          const os = t.objectStore(s);
          os.clear();
          for (const row of data[s]) os.put(row);
        }
      });
      try { localStorage.removeItem(LS_KEY); } catch (_) {}
    },
  };

  root.DB = DB;
})(window);
