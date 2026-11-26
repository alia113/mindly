/* Mindly module: Home widgets (Phase 5). In-app cards on Home only. Reads DB, writes nothing. No shared storage, no widget extension.
   Cards: Today, Follow-ups, Goals, Memory insight. Each card opens the matching module screen when present. User can hide the strip (DB.settings.widgets === false). */
(function () {
  "use strict";
  if (window.MindlyWidgets) return;
  const open = n => { const m = window[n]; if (m && m.open) m.open(); };
  function stats() {
    const t = today(), ev = (DB.events || []).filter(e => e.date === t).sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
    const act = x => x.status !== "done" && !x.dupOf && x.status !== "postponed";
    const fu = (DB.commitments || []).filter(act), over = fu.filter(c => c.due && c.due < t).length;
    const gs = (DB.goals || []).filter(g => !g.done), avg = gs.length ? Math.round(gs.reduce((a, g) => a + (g.progress || 0), 0) / gs.length) : null;
    const mem = (DB.memories || []).slice(-1)[0];
    return { ev, fu: fu.length, over, gs: gs.length, avg, mem };
  }
  function card(attr, title, big, sub) {
    return '<button class="card" ' + attr + ' style="text-align:start;min-width:132px;flex:0 0 auto;padding:10px;cursor:pointer"><div class="m">' + title + '</div><div class="t" style="font-size:20px" dir="auto">' + big + '</div><div class="m" dir="auto">' + sub + "</div></button>";
  }
  function strip() {
    if (DB.settings && DB.settings.widgets === false) return "";
    const s = stats();
    const next = s.ev[0];
    const cards = [
      card('data-wg="MindlyCal"', S("Today", "اليوم"), s.ev.length + " " + S("events", "مواعيد"), next ? esc((next.time || "") + " " + String(next.title || "").slice(0, 24)) : S("Nothing scheduled", "ما في شي")),
      card('data-wg="MindlyFollow"', S("Follow-ups", "المتابعات"), String(s.fu), s.over ? s.over + " " + S("past due", "متأخرة") : S("on track", "تمام")),
      card('data-wg="MindlyGoals"', S("Goals", "الأهداف"), s.avg === null ? "-" : s.avg + "%", s.gs + " " + S("active", "نشط")),
      card('data-wg="MindlyTimeline"', S("Latest memory", "آخر ذاكرة"), "", s.mem ? esc(String(s.mem.text || "").slice(0, 40)) : S("None yet", "لسا ما في"))
    ].join("");
    return '<div style="display:flex;gap:8px;overflow-x:auto;margin-bottom:8px;padding-bottom:2px">' + cards + "</div>";
  }
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return strip() + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-wg]"); if (b) { e.preventDefault(); open(b.dataset.wg); } });
  try { render(); } catch (e) {}
  window.MindlyWidgets = { stats, strip };
})();
