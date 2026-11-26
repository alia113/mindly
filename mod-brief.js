/* Mindly module: Daily Briefing screen + Ask Your Memory source chips (Phase 1). Local only, no AI calls.
   Briefing reads existing records. Chips use keyword retrieval from MindlySearch (tapping opens the item). */
(function () {
  "use strict";
  if (window.MindlyBrief) return;
  const STOP = new Set(("what when where who whom how why which does did the and for with about from that this have has was were are you your tell remember know any all say said ماذا ماذا شو وش ايش اي إيش عن على من الى إلى هل كل عندي عندك قلت قال احكيلي خبرني").split(/\s+/));
  const li = (t, m) => '<div class="card"><div class="t" dir="auto">' + esc(t) + "</div>" + (m ? '<div class="m">' + esc(m) + "</div>" : "") + "</div>";
  const block = (title, items) => items.length ? '<div class="sec"><h2>' + esc(title) + "</h2></div>" + items.join("") : "";

  function data() {
    const t = today(), d = DB;
    const open = d.commitments.filter(c => c.status !== "done");
    return {
      overdue: open.filter(c => c.owner === "me" && c.due && c.due < t),
      dueToday: open.filter(c => c.owner === "me" && c.due === t),
      waiting: d.commitments.filter(c => c.owner === "them" && c.status === "waiting"),
      tasks: d.tasks.filter(k => k.status === "open" && k.due && k.due <= t),
      events: d.events.filter(e => e.date === t).sort((a, b) => (a.time || "").localeCompare(b.time || "")),
      soon: d.events.filter(e => e.date > t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3),
      follow: (typeof suggestions === "function" ? suggestions() : []).filter(s => s.kind === "follow").slice(0, 3)
    };
  }

  function open() {
    const x = data();
    const who = c => c.personName ? " · " + c.personName : "";
    const html = '<h3 style="margin:0 0 4px">' + S("Daily briefing", "ملخص اليوم") + '</h3><div class="m">' + esc(fmtDate(today())) + "</div>" +
      block(S("Today's events", "مواعيد اليوم"), x.events.map(e => li(e.title, e.time || ""))) +
      block(S("Overdue", "متأخر"), x.overdue.map(c => li(c.title + who(c), fmtDate(c.due)))) +
      block(S("Due today", "مستحق اليوم"), x.dueToday.map(c => li(c.title + who(c), ""))) +
      block(S("Tasks due", "مهام مستحقة"), x.tasks.map(k => li(k.title, fmtDate(k.due)))) +
      block(S("Waiting on others", "بانتظار ناس"), x.waiting.slice(0, 5).map(c => li(c.title + who(c), c.due ? fmtDate(c.due) : ""))) +
      block(S("Coming up", "قريباً"), x.soon.map(e => li(e.title, fmtDate(e.date)))) +
      block(S("Worth a follow-up", "يستاهل متابعة"), x.follow.map(f => li(String(f.text || f.title || f.t || f.name || ""), ""))) +
      ((x.events.length + x.overdue.length + x.dueToday.length + x.tasks.length + x.waiting.length + x.soon.length + x.follow.length) ? "" : '<div class="empty">' + S("Nothing needs you today.", "ما في شي مستعجل اليوم.") + "</div>");
    sheet(html, null);
  }

  /* source chips under each AI/local answer in the Ask box */
  function sources(q) {
    const S_ = window.MindlySearch; if (!S_) return [];
    const toks = S_.tokens(q).filter(w => w.length > 2 && !STOP.has(w));
    const agg = new Map();
    for (const w of toks) for (const r of S_.search(w).slice(0, 12)) { const k = r.it.type + "|" + r.it.id; const e = agg.get(k) || { it: r.it, s: 0 }; e.s += r.score; agg.set(k, e); }
    return [...agg.values()].sort((a, b) => b.s - a.s).slice(0, 4).map(e => e.it);
  }
  const TL = { people: ["Person", "شخص"], commitments: ["Commitment", "التزام"], tasks: ["Task", "مهمة"], events: ["Event", "موعد"], memories: ["Memory", "ذكرى"], notes: ["Note", "ملاحظة"] };
  function addChips(bub) {
    if (bub.dataset.chips) return; bub.dataset.chips = "1";
    let q = ""; for (let p = bub.previousElementSibling; p; p = p.previousElementSibling) if (p.classList.contains("u")) { q = p.textContent; break; }
    const its = sources(q); if (!its.length) return;
    const w = document.createElement("div"); w.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:8px";
    its.forEach(it => { const b = document.createElement("button"); b.className = "btn"; b.style.cssText = "padding:4px 10px;font-size:12px"; const tl = TL[it.type] || [it.type, it.type]; b.textContent = S(tl[0], tl[1]) + ": " + String(it.text).slice(0, 28); b.onclick = () => { try { window.MindlySearch.openDetail(it.type, it.id); } catch (e) {} }; w.appendChild(b); });
    bub.appendChild(w);
  }
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { const bs = n.matches && n.matches(".bub.a") ? [n] : (n.querySelectorAll ? [...n.querySelectorAll(".bub.a")] : []); bs.forEach(addChips); } }).observe(document.body, { childList: true, subtree: true });
  /* the Ask box appends via innerHTML, which re-creates earlier bubbles: only the newest one lacks chips, others get them too, harmless */

  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-brief="1">' + S("Daily briefing", "ملخص اليوم") + "</button></div>" + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-brief]"); if (b) { e.preventDefault(); open(); } });
  window.MindlyBrief = { open, data, sources };
})();
