/* Mindly module: Weekly Reflection (Phase 2). Local summary of the last 7 days from existing records. No AI, no new stored data. */
(function () {
  "use strict";
  if (window.MindlyWeekly) return;
  const DAY = 864e5;
  const ms = d => { if (!d) return 0; if (typeof d === "number") return d; const t = Date.parse(d); return isNaN(t) ? 0 : t; };
  function compute(now) {
    now = now || Date.now(); const from = now - 7 * DAY, t = iso(now);
    const inW = x => { const v = ms(x); return v >= from && v <= now; };
    const doneItems = DB.commitments.concat(DB.tasks).filter(x => x.status === "done" && inW(x.doneAt));
    const newCommit = DB.commitments.filter(c => inW(c.created || c.createdAt));
    const newMem = DB.memories.filter(m => inW(m.created || m.createdAt || m.date));
    const touched = new Map();
    for (const i of DB.interactions) if (inW(i.date || i.ts || i.created)) { const k = i.personId || i.personName; if (k) touched.set(k, (touched.get(k) || 0) + 1); }
    const touchedNames = [...touched.keys()].map(k => { const p = DB.people.find(p => p.id === k); return p ? p.name : String(k); });
    const overdue = DB.commitments.filter(c => c.status !== "done" && c.owner === "me" && c.due && c.due < t);
    const waiting = DB.commitments.filter(c => c.owner === "them" && c.status === "waiting");
    const quiet = DB.people.filter(p => { const last = Math.max(0, ...DB.interactions.filter(i => i.personId === p.id).map(i => ms(i.date || i.ts || i.created)), ms(p.lastTouch)); return last && now - last > 30 * DAY; }).slice(0, 5);
    const dueNext = DB.commitments.filter(c => c.status !== "done" && c.due && c.due >= t && c.due <= iso(now + 7 * DAY));
    return { done: doneItems.length, newCommit: newCommit.length, newMem: newMem.length, touched: touchedNames, overdue, waiting, quiet, dueNext };
  }
  const row = (a, b) => '<div class="card"><div class="t" dir="auto">' + esc(a) + "</div>" + (b ? '<div class="m">' + esc(b) + "</div>" : "") + "</div>";
  function open() {
    const w = compute();
    const stats = [[w.done, S("completed", "منجز")], [w.newCommit, S("new commitments", "التزامات جديدة")], [w.newMem, S("new memories", "ذكريات جديدة")], [w.touched.length, S("people contacted", "أشخاص تواصلت معهم")]]
      .map(s => '<div class="card" style="flex:1;min-width:42%;text-align:center"><div class="t" style="font-size:22px">' + s[0] + '</div><div class="m">' + esc(s[1]) + "</div></div>").join("");
    const blk = (title, arr) => arr.length ? '<div class="sec"><h2>' + esc(title) + "</h2></div>" + arr.join("") : "";
    sheet('<h3 style="margin:0 0 4px">' + S("Weekly reflection", "مراجعة الأسبوع") + '</h3><div class="m">' + S("Last 7 days, from what you told Mindly.", "آخر 7 أيام، من اللي حكيته لـ Mindly.") + '</div><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">' + stats + "</div>" +
      blk(S("Still overdue", "لسا متأخر"), w.overdue.slice(0, 5).map(c => row(c.title + (c.personName ? " · " + c.personName : ""), fmtDate(c.due)))) +
      blk(S("Waiting on others", "بانتظار ناس"), w.waiting.slice(0, 5).map(c => row(c.title + (c.personName ? " · " + c.personName : ""), c.due ? fmtDate(c.due) : ""))) +
      blk(S("Due next 7 days", "مستحق الأسبوع الجاي"), w.dueNext.slice(0, 5).map(c => row(c.title, fmtDate(c.due)))) +
      blk(S("Haven't talked in 30+ days", "ما تواصلت معهم من 30+ يوم"), w.quiet.map(p => row(p.name, ""))) +
      '<div class="m" style="margin-top:10px">' + S("This only reflects what has been saved in Mindly.", "هذا يعكس بس اللي انحفظ في Mindly.") + "</div>", null);
  }
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-weekly="1">' + S("Weekly reflection", "مراجعة الأسبوع") + "</button></div>" + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-weekly]"); if (b) { e.preventDefault(); open(); } });
  try { render(); } catch (e) {}
  window.MindlyWeekly = { open, compute };
})();
