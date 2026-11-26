/* Mindly module: IndexedDB MIRROR (phase 1 of the storage migration). COPY ONLY.
   localStorage stays the primary store and is never changed or removed by this module. It keeps a verified copy of the in-memory DB in IndexedDB,
   record by record, and reports whether localStorage still matches memory (quota failures in save() are silent in the app).
   The later switch (boot from IndexedDB, drop the localStorage payload) is NOT in this module and needs a separate approval after verification evidence.
   Never throws into the app. Writes nothing to DB. Disable by setting localStorage "mindly.idb.off" = "1". */
(function () {
  "use strict";
  if (window.MindlyIDB) return;
  const COLS = ["people", "interactions", "notes", "tasks", "events", "commitments", "memories", "projects", "inputs", "goals", "alarms", "alarmLog", "routines"];
  const NAME = "mindly-mirror", LSKEY = "mindly.v1";
  let lastStamp = null, busy = false, st = { ok: null, at: 0, err: "", counts: {}, bytes: 0 };
  const off = () => { try { return localStorage.getItem("mindly.idb.off") === "1"; } catch (e) { return true; } };
  const open = () => new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error("no indexedDB")); const r = indexedDB.open(NAME, 1); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("recs")) d.createObjectStore("recs"); if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta"); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || new Error("open")); });
  const tx = (d, stores, mode, fn) => new Promise((res, rej) => { const t = d.transaction(stores, mode); let out; try { out = fn(t); } catch (e) { rej(e); return; } t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("abort")); });
  const getAll = (d, store) => new Promise((res, rej) => { const t = d.transaction(store, "readonly"), s = t.objectStore(store), keys = s.getAllKeys(), vals = s.getAll(); t.oncomplete = () => res(keys.result.map((k, i) => [k, vals.result[i]])); t.onerror = () => rej(t.error); });
  function split(db) {
    const recs = new Map(), rest = {};
    for (const k in db) { if (COLS.includes(k) && Array.isArray(db[k])) { db[k].forEach((r, i) => { const id = r && r.id ? r.id : "#" + i; recs.set(k + "/" + id, JSON.stringify(r)); }); } else rest[k] = db[k]; }
    recs.set("_rest", JSON.stringify(rest)); return recs;
  }
  async function mirror() {
    if (busy || off() || typeof DB === "undefined") return; busy = true;
    try {
      const snap = JSON.parse(JSON.stringify(DB)), recs = split(snap), d = await open();
      await tx(d, ["recs", "meta"], "readwrite", t => { const s = t.objectStore("recs"); s.clear(); recs.forEach((v, k) => s.put(v, k)); t.objectStore("meta").put({ at: Date.now(), n: recs.size, stamp: DB.updatedAt || 0 }, "m"); });
      d.close(); lastStamp = DB.updatedAt || 0;
      const counts = {}; COLS.forEach(c => counts[c] = (snap[c] || []).length);
      st = { ok: true, at: Date.now(), err: "", counts, bytes: JSON.stringify(snap).length };
    } catch (e) { st = Object.assign({}, st, { ok: false, err: String(e && e.message || e) }); }
    busy = false;
  }
  /* Compare IndexedDB copy with the in-memory DB and with localStorage, record by record. Read only. */
  async function verify() {
    const out = { ok: false, missingInIDB: 0, extraInIDB: 0, differ: 0, lsMatchesMemory: null, records: 0, err: "" };
    try {
      const d = await open(), rows = await getAll(d, "recs"); d.close();
      const idb = new Map(rows), mem = split(JSON.parse(JSON.stringify(DB)));
      out.records = mem.size;
      mem.forEach((v, k) => { if (!idb.has(k)) out.missingInIDB++; else if (idb.get(k) !== v) out.differ++; });
      idb.forEach((v, k) => { if (!mem.has(k)) out.extraInIDB++; });
      let ls = null; try { ls = localStorage.getItem(LSKEY); } catch (e) {}
      out.lsMatchesMemory = ls === null ? false : (() => { try { const a = split(JSON.parse(ls)); if (a.size !== mem.size) return false; let same = true; mem.forEach((v, k) => { if (a.get(k) !== v) same = false; }); return same; } catch (e) { return false; } })();
      out.ok = !out.missingInIDB && !out.extraInIDB && !out.differ;
    } catch (e) { out.err = String(e && e.message || e); }
    return out;
  }
  async function status() {
    const s = Object.assign({}, st, { lsBytes: 0, quota: null });
    try { for (const k in localStorage) if (Object.prototype.hasOwnProperty.call(localStorage, k)) s.lsBytes += (localStorage[k].length + k.length) * 2; } catch (e) {}
    try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); s.quota = { usage: e.usage, quota: e.quota }; } } catch (e) {}
    return s;
  }
  function tick() { if (off() || typeof DB === "undefined") return; const s = DB.updatedAt || 0; if (s !== lastStamp && document.visibilityState !== "hidden" && !(window.V && window.V.active)) { const go = () => mirror(); if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 50); } }
  setTimeout(() => { tick(); setInterval(tick, 8000); }, 6000);
  window.MindlyIDB = { mirror, verify, status, _split: split };
})();
