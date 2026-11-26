/* Mindly module: Activity / Undo screen (Phase 2). Read-only view built from timestamps already stored on records (created, doneAt, input ts).
   Offers the existing 7-day delete undo (MindlyControl.undoDelete) when one is pending. Writes nothing itself. */
(function () {
  "use strict";
  if (window.MindlyActivity) return;
  const KINDS = [["inputs", "ts", "Captured", "التقاط"], ["commitments", "created", "Follow-up added", "متابعة انضافت"], ["tasks", "created", "Task added", "مهمة انضافت"], ["memories", "created", "Memory saved", "ذاكرة انحفظت"], ["people", "created", "Person added", "شخص انضاف"], ["notes", "created", "Note added", "ملاحظة انضافت"], ["events", "created", "Event added", "موعد انضاف"]];
  function label(r) { return String(r.title || r.text || r.name || "").slice(0, 90); }
  function collect() {
    const out = [];
    for (const [col, f, en, ar] of KINDS) for (const r of (DB[col] || [])) { if (r && +r[f] > 0) out.push({ at: +r[f], en, ar, t: label(r) }); }
    for (const col of ["commitments", "tasks"]) for (const r of (DB[col] || [])) if (r && r.doneAt) out.push({ at: +r.doneAt, en: "Marked done", ar: "تم إنجازها", t: label(r) });
    return out.sort((a, b) => b.at - a.at).slice(0, 50);
  }
  function undoPending() { try { const u = JSON.parse(localStorage.getItem("mindly.delundo") || "null"); return u && Date.now() - u.at < 7 * 864e5 ? u : null; } catch (e) { return null; } }
  function open() {
    const items = collect(), u = undoPending();
    const undo = u && window.MindlyControl ? '<div class="card"><div class="t">' + S("Last delete can be undone", "آخر حذف ممكن التراجع عنه") + '</div><div class="acts"><button class="btn p" id="actundo">' + S("Undo delete", "تراجع عن الحذف") + "</button></div></div>" : "";
    const rows = items.map(x => '<div class="card"><div class="t" dir="auto">' + esc(x.t || "-") + '</div><div class="m">' + S(x.en, x.ar) + " · " + esc(new Date(x.at).toLocaleString(A() ? "ar" : "en")) + "</div></div>").join("");
    sheet('<h3 style="margin:0 0 6px">' + S("Activity", "النشاط") + "</h3>" + undo + (rows || '<div class="empty">' + S("No activity yet.", "ما في نشاط لسا.") + "</div>"), () => {
      const b = $("#actundo"); if (b) b.onclick = () => { toast(MindlyControl.undoDelete() ? S("Restored.", "تم الاسترجاع.") : S("Couldn’t undo.", "ما قدرت أتراجع.")); open(); try { render(); } catch (e) {} };
    });
  }
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-activity="1">' + S("Activity", "النشاط") + "</button></div>" + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-activity]"); if (b) { e.preventDefault(); open(); } });
  try { render(); } catch (e) {}
  window.MindlyActivity = { open, collect };
})();
