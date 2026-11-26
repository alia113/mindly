/* Mindly module: per-record merge for sync (Phase 6). Additive fields: record.updatedAt (ms) and DB.tomb {id: deletedAt}.
   The sync blob format and encryption are unchanged (still the whole DB), old clients read it fine and ignore the new fields.
   Merge rule per record id: newest of record.updatedAt / tombstone wins. A record missing on one side with no tombstone is kept (never lose data).
   Legacy records without updatedAt count as 0, ties fall back to the side whose DB.updatedAt is newer. */
(function () {
  "use strict";
  if (window.MindlyMerge) return;
  const COLS = ["people", "interactions", "notes", "tasks", "events", "commitments", "memories", "projects", "inputs", "goals"];
  const TOMB_TTL = 90 * 864e5;
  const strip = r => { const o = Object.assign({}, r); delete o.updatedAt; return JSON.stringify(o); };

  function mergeDB(local, remote) {
    const lNew = (local.updatedAt || 0) >= (remote.updatedAt || 0);
    const base = JSON.parse(JSON.stringify(lNew ? local : remote)); /* scalars, settings, dismissed come from the newer side */
    const other = lNew ? remote : local;
    const tomb = Object.assign({}, remote.tomb || {}, local.tomb || {});
    for (const k in (remote.tomb || {})) tomb[k] = Math.max(tomb[k] || 0, remote.tomb[k]);
    for (const k in (local.tomb || {})) tomb[k] = Math.max(tomb[k] || 0, local.tomb[k]);
    for (const c of COLS) {
      const m = new Map();
      for (const r of (lNew ? remote : local)[c] || []) if (r && r.id) m.set(r.id, r);
      const a = (lNew ? local : remote)[c] || [], out = [], seen = new Set();
      const pick = (x, y) => { /* x from newer-DB side, y from the other side (may be undefined) */
        if (!y) return x; if (!x) return y;
        const tx = x.updatedAt || 0, ty = y.updatedAt || 0; return ty > tx ? y : x;
      };
      for (const r of a) { if (!r || !r.id) { out.push(r); continue; } seen.add(r.id); out.push(pick(r, m.get(r.id))); }
      for (const [id, r] of m) if (!seen.has(id)) out.push(r);
      base[c] = out.filter(r => { if (!r || !r.id) return true; const t = tomb[r.id]; return !(t && t >= (r.updatedAt || 0)); }).map(r => JSON.parse(JSON.stringify(r)));
    }
    const now = Date.now(); for (const k in tomb) if (now - tomb[k] > TOMB_TTL) delete tomb[k];
    base.tomb = tomb;
    base.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
    return base;
  }

  /* Stamp changed records and record deletions. Runs before every save(). */
  let shadow = null, shadowDB = null;
  function snapshot() { const s = {}; for (const c of COLS) for (const r of (DB[c] || [])) if (r && r.id) s[r.id] = strip(r); return s; }
  function stamp() {
    if (!shadow || shadowDB !== DB) { shadow = snapshot(); shadowDB = DB; if (!DB.tomb) DB.tomb = {}; return; } /* baseline: no stamping on first sight or after adopting a DB */
    if (!DB.tomb) DB.tomb = {};
    const now = Date.now(), cur = {};
    for (const c of COLS) for (const r of (DB[c] || [])) {
      if (!r || !r.id) continue; const s = strip(r); cur[r.id] = s;
      if (shadow[r.id] !== s) { r.updatedAt = now; }
      if (DB.tomb[r.id]) { delete DB.tomb[r.id]; r.updatedAt = now; } /* record came back (undo) */
    }
    for (const id in shadow) if (!(id in cur)) DB.tomb[id] = now;
    shadow = cur;
  }
  function rebase() { shadow = null; shadowDB = null; }

  try { shadow = snapshot(); shadowDB = DB; } catch (e) {}
  if (typeof save === "function") { const _s = save; save = function () { try { stamp(); } catch (e) {} return _s.apply(this, arguments); }; }
  window.MindlyMerge = { mergeDB, stamp, rebase, COLS };
})();
