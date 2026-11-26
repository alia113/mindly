/* Mindly module: Goals (Phase 3). Stored in an additive DB.goals array [{id,title,due,progress,done,created}]. Local, travels with the normal encrypted sync of the whole DB. */
(function () {
  "use strict";
  if (window.MindlyGoals) return;
  const list = () => { if (!Array.isArray(DB.goals)) DB.goals = []; return DB.goals; };
  const gid = () => "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function add(title, due) { title = String(title || "").trim(); if (!title) return null; const g = { id: gid(), title, due: due || "", progress: 0, done: false, created: Date.now() }; list().push(g); save(); return g; }
  function setProgress(id, v) { const g = list().find(x => x.id === id); if (!g) return null; g.progress = Math.max(0, Math.min(100, Math.round(v))); g.done = g.progress >= 100; if (g.done) g.doneAt = Date.now(); else delete g.doneAt; save(); return g; }
  function remove(id) { const a = list(), i = a.findIndex(x => x.id === id); if (i < 0) return false; a.splice(i, 1); save(); return true; }
  function open() {
    const gs = list().slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || String(a.due || "9999").localeCompare(String(b.due || "9999")));
    const html = '<h3 style="margin:0 0 6px">' + S("Goals", "الأهداف") + "</h3>" +
      '<div class="card"><input id="gt" dir="auto" placeholder="' + S("New goal", "هدف جديد") + '"><div class="row" style="margin-top:8px"><input id="gd" type="date"><button class="btn p" id="gadd">' + S("Add", "إضافة") + "</button></div></div>" +
      (gs.length ? gs.map(g => '<div class="card"><div class="t" dir="auto"' + (g.done ? ' style="opacity:.6;text-decoration:line-through"' : "") + ">" + esc(g.title) + '</div><div class="m">' + (g.due ? esc(fmtDate(g.due)) + " · " : "") + g.progress + '%</div><div style="height:6px;background:rgba(255,255,255,.12);border-radius:3px;margin:6px 0"><div style="height:6px;width:' + g.progress + '%;background:#6aa9ff;border-radius:3px"></div></div><div class="acts"><button class="btn" data-gm="' + esc(g.id) + '">−10</button><button class="btn" data-gp="' + esc(g.id) + '">+10</button><button class="btn" data-gx="' + esc(g.id) + '" style="color:#ff6b6b">' + S("Delete", "حذف") + "</button></div></div>").join("") : '<div class="empty">' + S("No goals yet.", "ما في أهداف لسا.") + "</div>");
    sheet(html, () => {
      $("#gadd").onclick = () => { if (add($("#gt").value, $("#gd").value)) open(); };
      document.querySelectorAll("[data-gp]").forEach(b => b.onclick = () => { const g = list().find(x => x.id === b.dataset.gp); setProgress(b.dataset.gp, g.progress + 10); open(); });
      document.querySelectorAll("[data-gm]").forEach(b => b.onclick = () => { const g = list().find(x => x.id === b.dataset.gm); setProgress(b.dataset.gm, g.progress - 10); open(); });
      document.querySelectorAll("[data-gx]").forEach(b => b.onclick = () => { if (b.dataset.sure) { remove(b.dataset.gx); open(); } else { b.dataset.sure = 1; b.textContent = S("Tap again to delete", "اضغط مرة ثانية للحذف"); } });
    });
  }
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-goals="1">' + S("Goals", "الأهداف") + "</button></div>" + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-goals]"); if (b) { e.preventDefault(); open(); } });
  try { render(); } catch (e) {}
  window.MindlyGoals = { open, add, setProgress, remove, list };
})();
