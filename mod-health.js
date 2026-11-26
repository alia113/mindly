/* Mindly module: storage safety (v83). READ-ONLY checks plus a warning when a save to this device fails. It never changes, repairs or deletes data.
   1) Banner when localStorage rejects a write (quota or private mode), because save() used to fail silently.
   2) Settings > "Database health": collection checks, localStorage vs memory vs IndexedDB mirror, write headroom test, backup export, and a backup-file check (preview only, nothing is restored here).
   Kill switch: localStorage "mindly.health.off" = "1" (the banner and the Settings button are not added). */
(function () {
  "use strict";
  if (window.MindlyHealth) return;
  const off = () => { try { return localStorage.getItem("mindly.health.off") === "1"; } catch (e) { return false; } };
  const L = (en, ar) => (typeof S === "function" ? S(en, ar) : en);
  const E = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLS = ["people", "interactions", "notes", "tasks", "events", "commitments", "memories", "projects", "inputs", "goals", "alarms", "alarmLog", "routines", "reminders"];
  const REFS = [["commitments", "personId", "people"], ["tasks", "personId", "people"], ["events", "personId", "people"], ["memories", "personId", "people"], ["interactions", "personId", "people"], ["tasks", "commitmentId", "commitments"]];
  async function sha(str) { try { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); } catch (e) { return ""; } }
  function checkCollections(db) {
    const out = { cols: [], problems: 0 };
    for (const c of COLS) {
      const v = db[c]; const row = { c, n: 0, bad: 0, noid: 0, dup: 0, notArray: false, absent: v === undefined };
      if (v !== undefined && !Array.isArray(v)) { row.notArray = true; row.bad = 1; }
      else if (Array.isArray(v)) { const seen = new Set(); row.n = v.length; for (const r of v) { if (!r || typeof r !== "object" || Array.isArray(r)) { row.bad++; continue; } if (typeof r.id !== "string" || !r.id) { row.noid++; continue; } if (seen.has(r.id)) row.dup++; else seen.add(r.id); } }
      out.problems += row.bad + row.noid + row.dup; out.cols.push(row);
    }
    out.orphans = 0; for (const [c, f, t] of REFS) { const ids = new Set((db[t] || []).map(x => x && x.id)); for (const r of (db[c] || [])) if (r && r[f] && !ids.has(r[f])) out.orphans++; }
    return out;
  }
  function lsUsage() { let n = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || "").length) * 2; } } catch (e) {} return n; }
  function headroom() { const k = "mindly.healthprobe"; try { localStorage.removeItem(k); localStorage.setItem(k, "x".repeat(262144)); localStorage.removeItem(k); return true; } catch (e) { try { localStorage.removeItem(k); } catch (e2) {} return false; } }
  async function run() {
    const r = { at: Date.now() };
    r.col = checkCollections(DB);
    let ls = null; try { ls = localStorage.getItem("mindly.v1"); } catch (e) {}
    const mem = JSON.stringify(DB); r.memBytes = mem.length; r.lsBytes = ls ? ls.length : 0;
    let lsDb = null; try { lsDb = ls ? JSON.parse(ls) : null; } catch (e) { r.lsParseError = true; }
    r.lsMatches = !!lsDb && (lsDb.updatedAt === DB.updatedAt) && ls.length === mem.length;
    r.usage = lsUsage(); r.headroom = headroom(); r.saveErr = window.__saveErr || null;
    r.idb = null; try { if (window.MindlyIDB) { r.idb = await MindlyIDB.verify(); if (!r.idb.ok && !r.idb.err) { try { await MindlyIDB.mirror(); r.idb = await MindlyIDB.verify(); r.idb.refreshed = true; } catch (e) {} } } } catch (e) { r.idb = { ok: false, err: String(e) }; }
    r.hash = await sha(mem); return r;
  }
  const kb = n => Math.round(n / 1024) + " KB";
  function render(r) {
    const ok = (b, t) => '<div class="m" style="margin:4px 0">' + (b ? "✓ " : "✗ ") + t + "</div>";
    let h = ok(!r.saveErr, L("Last save to this device: ", "آخر حفظ على هذا الجهاز: ") + (r.saveErr ? L("FAILED (", "فشل (") + E(r.saveErr.msg) + ")" : L("OK", "تمام")));
    h += ok(r.headroom, L("Free space to write (256 KB test): ", "مساحة فاضية للكتابة (اختبار 256 كيلوبايت): ") + (r.headroom ? L("OK", "تمام") : L("NOT ENOUGH", "ما في مساحة")));
    h += ok(r.lsMatches, L("Stored copy matches what is on screen", "النسخة المخزنة نفس اللي على الشاشة") + (r.lsMatches ? "" : L(" (differs)", " (مختلفة)")));
    h += '<div class="m" style="margin:4px 0">' + L("Size: ", "الحجم: ") + kb(r.lsBytes) + L(" of this app, ", " للتطبيق، ") + kb(r.usage) + L(" total site storage used", " إجمالي المساحة المستخدمة") + "</div>";
    try { const oc = JSON.parse(localStorage.getItem("mindly.oldclient") || "null"); if (oc && Date.now() - oc.at < 14 * 864e5) h += ok(false, L("Another device seems to run an older Mindly and removed " + oc.n + " reminder(s) from the cloud copy. They are safe on this device and were restored. Update that device.", "جهاز ثاني يبدو إنه على نسخة أقدم من Mindly وشال " + oc.n + " تذكير من نسخة السحابة. التذكيرات سليمة على هذا الجهاز واترجعت. حدّث الجهاز الثاني.")); } catch (e) {}
    if (r.idb) { const q = r.idb, cnt = q.records + L(" records, missing ", " سجل، ناقص ") + q.missingInIDB + L(", different ", "، مختلف ") + q.differ + L(", extra ", "، زيادة ") + q.extraInIDB; h += q.ok ? ok(true, L("Backup mirror (IndexedDB): ", "النسخة الداخلية (IndexedDB): ") + cnt) : q.err ? ok(false, L("Backup mirror (IndexedDB) could not be read: ", "النسخة الداخلية (IndexedDB) ما انقرت: ") + E(q.err)) : ok(false, L("Backup mirror (IndexedDB) is behind: ", "النسخة الداخلية (IndexedDB) متأخرة: ") + cnt + L(". Your main data is not affected; the mirror refreshes itself.", ". بياناتك الأساسية سليمة؛ النسخة بتتحدث لوحدها.")); }
    h += '<div class="m" style="margin:8px 0 4px"><b>' + L("Collections", "المجموعات") + "</b></div>";
    h += r.col.cols.map(c => '<div class="m" style="margin:2px 0;direction:ltr">' + (c.bad || c.noid || c.dup ? "✗ " : "✓ ") + E(c.c) + ": " + (c.absent ? "-" : c.n) + (c.notArray ? " NOT AN ARRAY" : "") + (c.bad && !c.notArray ? " bad:" + c.bad : "") + (c.noid ? " no-id:" + c.noid : "") + (c.dup ? " duplicate-ids:" + c.dup : "") + "</div>").join("");
    h += '<div class="m" style="margin:6px 0">' + L("Links to missing records: ", "روابط لسجلات ناقصة: ") + r.col.orphans + "</div>";
    h += '<div class="m" style="margin:6px 0;direction:ltr;font-size:11px;opacity:.7">sha256 ' + E(r.hash.slice(0, 16)) + "… · " + new Date(r.at).toLocaleString() + "</div>";
    return h;
  }
  async function verifyFile(f) {
    const box = document.querySelector("#mh-file"); if (!box) return;
    const rd = new FileReader(); rd.onload = async () => {
      let d = null; try { d = JSON.parse(rd.result); } catch (e) {}
      if (!d || typeof d !== "object" || (typeof validDB === "function" && !validDB(d))) { box.innerHTML = '<div class="m">✗ ' + L("Not a valid Mindly backup. Nothing was changed.", "مش نسخة Mindly صالحة. ما تغيّر شي.") + "</div>"; return; }
      const c = checkCollections(d); const rows = COLS.map(k => k + ": " + ((d[k] || []).length) + " (" + L("now ", "الحين ") + ((DB[k] || []).length) + ")").join(" · ");
      box.innerHTML = '<div class="m">✓ ' + L("Readable backup. Problems inside: ", "نسخة مقروءة. مشاكل داخلها: ") + c.problems + '</div><div class="m" style="direction:ltr;font-size:12px">' + E(rows) + '</div><div class="m">' + L("Preview only. Nothing was restored or changed. To restore, use Settings > Import, which keeps a safety copy of your current data.", "معاينة فقط. ما انسترجع ولا تغيّر شي. للاسترجاع استخدم الإعدادات > استيراد، وبيحفظ نسخة أمان من بياناتك الحالية.") + "</div>";
    }; rd.readAsText(f);
  }
  async function open() {
    sheet('<div class="m"><b>' + L("Database health", "سلامة البيانات") + '</b></div><div class="m">' + L("Read-only checks. Nothing is changed or repaired.", "فحوصات للقراءة فقط. ما بيتغيّر ولا بيتصلّح شي.") + '</div><div id="mh-out" class="m">…</div><div class="acts" style="margin-top:10px"><button class="btn" id="mh-re">' + L("Run again", "فحص مرة ثانية") + '</button><button class="btn" id="mh-ex">' + L("Export backup", "تصدير نسخة") + '</button><button class="btn" id="mh-vf">' + L("Check a backup file", "افحص ملف نسخة") + '</button></div><input type="file" id="mh-in" accept="application/json,.json" style="display:none"><div id="mh-file"></div>');
    const go = async () => { const o = document.querySelector("#mh-out"); o.textContent = "…"; try { o.innerHTML = render(await run()); } catch (e) { o.textContent = "Check failed: " + e; } };
    document.querySelector("#mh-re").onclick = go; document.querySelector("#mh-ex").onclick = () => { try { exportBackup(); } catch (e) {} };
    document.querySelector("#mh-vf").onclick = () => document.querySelector("#mh-in").click(); document.querySelector("#mh-in").onchange = e => { if (e.target.files[0]) verifyFile(e.target.files[0]); };
    go();
  }
  /* banner */
  function banner(on) {
    let b = document.getElementById("mh-banner");
    if (!on) { if (b) b.remove(); return; } if (b) return;
    b = document.createElement("div"); b.id = "mh-banner"; b.setAttribute("role", "alert");
    b.style.cssText = "position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 8px);z-index:99999;background:#b3261e;color:#fff;border-radius:14px;padding:10px 12px;font-size:14px;display:flex;gap:8px;align-items:center;box-shadow:0 4px 18px #0006";
    b.innerHTML = '<div style="flex:1">' + L("Could not save to this device (storage may be full). Recent changes may be lost. Export a backup now.", "ما قدرت احفظ على هذا الجهاز (المساحة يمكن ممتلئة). التغييرات الأخيرة ممكن تضيع. صدّر نسخة احتياطية هلأ.") + '</div><button id="mh-bx" style="background:#fff;color:#b3261e;border-radius:99px;padding:8px 12px;font-weight:700">' + L("Backup", "نسخة") + '</button>';
    document.body.appendChild(b); b.querySelector("#mh-bx").onclick = () => { try { exportBackup(); } catch (e) {} };
  }
  if (!off()) {
    addEventListener("mindly-savefail", () => banner(true)); addEventListener("mindly-saveok", () => banner(false));
    if (window.__saveErr) banner(true);
    /* the Settings buttons keep a direct reference to the original settingsSheet, so add the entry after any click on them */
    const inject = () => { try { const sh = document.querySelector("#dlg .sheet"); if (!sh || sh.querySelector("#mh-open") || sh.querySelector("#mh-out")) return; const foot = [...sh.children].find(x => /Build v/.test(x.textContent || "")); if (!foot) return; const w = document.createElement("div"); w.style.margin = "12px 0"; w.innerHTML = '<button class="btn" id="mh-open">' + L("Database health", "سلامة البيانات") + "</button>"; sh.insertBefore(w, foot); w.querySelector("#mh-open").onclick = open; } catch (e) {} };
    document.addEventListener("click", e => { if (e.target.closest && e.target.closest("#setBtn,#vset")) { setTimeout(inject, 80); setTimeout(inject, 600); } });
  }
  window.MindlyHealth = { run, checkCollections, open, verifyFile };
})();
