/* צלחת — her own small server (Cloudflare Worker): device identity,
   encrypted daily backup, recovery code, and evening reminders.
   The Worker never sees her journal in the clear: backups are encrypted here
   with a key derived from the device secret, and the reminder heartbeat only
   carries dates. Disabled when CFG.API_URL is empty. */
(function (root) {
  const enc = new TextEncoder();
  const enabled = () => !!(root.CFG && root.CFG.API_URL);
  const url = (p) => root.CFG.API_URL.replace(/\/$/, '') + p;

  function b64uEnc(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDec(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

  /* ---------------- identity ---------------- */
  async function device() {
    const APP = root.APP;
    if (APP.device && APP.device.id && APP.device.secret) return APP.device;
    APP.device = { id: b64uEnc(rand(16)), secret: b64uEnc(rand(32)), registered: false };
    await root.DB.saveSetting('device', APP.device);
    return APP.device;
  }
  async function register(d) {
    const r = await fetch(url('/register'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: d.id, secret: d.secret }) });
    if (!r.ok) throw new Error('register ' + r.status);
    d.registered = true;
    await root.DB.saveSetting('device', d);
  }
  async function authHeader() {
    const d = await device();
    if (!d.registered) await register(d);
    return 'Bearer ' + d.id + '.' + d.secret;
  }
  async function recoveryCode() {
    const d = await device();
    if (!d.registered) await register(d);
    return 'TZ1.' + d.id + '.' + d.secret;
  }
  function parseCode(code) {
    const parts = String(code || '').trim().replace(/\s+/g, '').split('.');
    if (parts.length !== 3 || parts[0] !== 'TZ1' || !parts[1] || !parts[2]) throw new Error('הקוד לא נראה נכון');
    return { id: parts[1], secret: parts[2] };
  }

  /* ---------------- encrypted backup ---------------- */
  async function deriveKey(d) {
    const base = await crypto.subtle.importKey('raw', enc.encode(d.secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('tzalahat:' + d.id), iterations: 150000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function gzip(str) {
    if (!root.CompressionStream) return { z: false, bytes: enc.encode(str) };
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
    return { z: true, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) };
  }
  async function gunzip(bytes, z) {
    if (!z) return new TextDecoder().decode(bytes);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  async function backup(force) {
    const APP = root.APP;
    if (!enabled() || !APP.ui.onboarded) return;
    if (!force && APP.ui.lastCloudBackupAt && Date.now() - APP.ui.lastCloudBackupAt < 20 * 3600e3) return;
    const d = await device();
    const { z, bytes } = await gzip(JSON.stringify(await root.DB.exportAll()));
    const iv = rand(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(d), bytes));
    const r = await fetch(url('/backup'), {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
      body: JSON.stringify({ v: 1, z, iv: b64uEnc(iv), ct: b64uEnc(ct), at: Date.now() }),
    });
    if (!r.ok) throw new Error('backup ' + r.status);
    await root.saveUi({ lastCloudBackupAt: Date.now() });
  }
  async function fetchBackup(code) {
    const d = parseCode(code);
    const r = await fetch(url('/backup'), { headers: { Authorization: 'Bearer ' + d.id + '.' + d.secret } });
    if (r.status === 401 || r.status === 404) throw new Error('לא נמצא גיבוי עם הקוד הזה');
    if (!r.ok) throw new Error('השרת לא זמין כרגע');
    const box = await r.json();
    let plain;
    try {
      const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uDec(box.iv) }, await deriveKey(d), b64uDec(box.ct)));
      plain = await gunzip(bytes, box.z);
    } catch (_) { throw new Error('הקוד לא פותח את הגיבוי'); }
    const data = JSON.parse(plain);
    if (!root.DB.validateBackup(data)) throw new Error('הגיבוי פגום');
    return data;
  }
  async function adoptCode(code) {
    const d = parseCode(code);
    await root.DB.saveSetting('device', { id: d.id, secret: d.secret, registered: true });
  }

  /* ---------------- reminders ---------------- */
  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in root && 'Notification' in root && !!root.CFG.VAPID_PUBLIC;
  }
  async function subscribe() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('צריך לאשר התראות בדפדפן');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uDec(root.CFG.VAPID_PUBLIC) });
    const r = await fetch(url('/subscribe'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
      body: JSON.stringify({ subscription: sub.toJSON(), tz: 'Asia/Jerusalem', measureDay: root.APP.profile.measureDay ?? 0 }),
    });
    if (!r.ok) throw new Error('השרת לא זמין כרגע');
    await heartbeat(true);
  }
  async function unsubscribe() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (_) {}
    await fetch(url('/subscribe'), { method: 'DELETE', headers: { Authorization: await authHeader() } }).catch(() => {});
  }
  let lastBeat = 0;
  async function heartbeat(force) {
    const APP = root.APP;
    if (!enabled() || !APP.ui.pushEnabled) return;
    if (!force && Date.now() - lastBeat < 30e3) return;
    lastBeat = Date.now();
    const C = root.Calc, t = C.ymd();
    const recent = await root.DB.range('entries', 'date', C.addDays(t, -7), t);
    const weights = await root.DB.range('weights', null, C.addDays(t, -14), t);
    const maxDate = (xs) => xs.reduce((m, x) => (x.date > m ? x.date : m), '');
    await fetch(url('/heartbeat'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: await authHeader() },
      body: JSON.stringify({ last_log_date: maxDate(recent), last_dinner_date: maxDate(recent.filter((e) => e.slot === 'dinner')),
        last_weigh_date: maxDate(weights), measureDay: APP.profile.measureDay ?? 0 }),
    });
  }

  async function onBoot() {
    await authHeader();
    await backup(false).catch(() => {});
    await heartbeat(true).catch(() => {});
  }

  root.Cloud = { enabled, authHeader, recoveryCode, backup, fetchBackup, adoptCode, pushSupported, subscribe, unsubscribe, heartbeat, onBoot };
})(window);
