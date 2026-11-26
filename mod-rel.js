/* Mindly module: Relationship map + priority people (Phase 2). Uses the existing people.relation text; adds an optional boolean people.priority (additive, sync-compatible). */
(function () {
  "use strict";
  if (window.MindlyRel) return;
  const KEY = p => String(p.relation || "").trim().toLowerCase();
  function groups() {
    const m = new Map();
    for (const p of DB.people) { const k = KEY(p) || ""; if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
    return [...m.entries()].sort((a, b) => (a[0] === "") - (b[0] === "") || b[1].length - a[1].length);
  }
  function open() {
    const gs = groups();
    const html = '<h3 style="margin:0 0 4px">' + S("Relationships", "العلاقات") + '</h3><div class="m">' + S("People grouped by the relationship you told Mindly. Tap ★ to prioritize someone. Tap the label to change it.", "الناس حسب العلاقة اللي حكيتها. اضغط ★ لتعطي أولوية. اضغط على العلاقة لتغييرها.") + "</div>" +
      (DB.people.length ? gs.map(([k, ps]) => '<div class="sec"><h2>' + esc(k || S("No relationship set", "بدون علاقة")) + " · " + ps.length + "</h2></div>" +
        ps.slice().sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0) || String(a.name).localeCompare(String(b.name))).map(p =>
          '<div class="card" style="display:flex;align-items:center;gap:8px"><button class="btn" data-rstar="' + esc(p.id) + '" style="padding:4px 10px">' + (p.priority ? "★" : "☆") + '</button><div class="t" dir="auto" style="flex:1">' + esc(p.name) + '</div><button class="btn" data-rset="' + esc(p.id) + '" style="padding:4px 10px;font-size:12px">' + S("Set", "تعديل") + "</button></div>").join("")).join("")
        : '<div class="empty">' + S("No people yet.", "ما في ناس لسا.") + "</div>");
    sheet(html, () => {
      document.querySelectorAll("[data-rstar]").forEach(b => b.onclick = () => { const p = DB.people.find(x => x.id === b.dataset.rstar); if (p) { p.priority = !p.priority; save(); open(); } });
      document.querySelectorAll("[data-rset]").forEach(b => b.onclick = () => { const p = DB.people.find(x => x.id === b.dataset.rset); if (!p) return; const v = prompt(S("Relationship for ", "العلاقة لـ ") + p.name, p.relation || ""); if (v !== null) { p.relation = v.trim(); save(); open(); try { render(); } catch (e) {} } });
    });
  }
  if (typeof vPeople === "function") { const _vp = vPeople; vPeople = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-rel="1">' + S("Relationships", "العلاقات") + "</button></div>" + _vp(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-rel]"); if (b) { e.preventDefault(); open(); } });
  try { render(); } catch (e) {}
  window.MindlyRel = { open, groups };
})();
