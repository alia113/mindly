/* Mindly module: Follow-up statuses + classification (Phase 2).
   Additive fields on existing commitments/tasks:
     status: adds "clarify" and "postponed" next to pending/waiting/open/done. Never removes old values.
     postponedUntil: YYYY-MM-DD when status is "postponed".
     strength: "promise" | "intention" | null (null = ambiguous, shows in the review list).
     dupOf: id of the kept copy when an item is merged as a duplicate (item is marked done, not deleted).
   All data stays in the normal DB, so it travels with the existing whole-DB encrypted sync. */
(function () {
  "use strict";
  if (window.MindlyFollow) return;
  const DAY = 86400000;
  const ACTIVE = { pending: 1, waiting: 1, open: 1 };
  const isActive = x => x && x.status !== "done" && !x.dupOf;
  const norm = s => String(s || "").toLowerCase().replace(/[ً-ْ]/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

  const PROMISE_EN = /\b(will|i'?ll|i promise|promise[sd]?|definitely|for sure|by (tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
  const INTENT_EN = /\b(try|trying|might|maybe|hopefully|hope to|want to|thinking of|plan to|probably)\b/i;
  const PROMISE_AR = /(رح |راح |هـ|هوعد|بوعد|وعدت|أكيد|اكيد|لازم|ضروري)/;
  const INTENT_AR = /(حاول|بحاول|يمكن|يمكننى|ان شاء الله|إن شاء الله|انشالله|إنشالله|ممكن|خليني أشوف|نشوف|بدي أحاول|نيتي)/;

  /* Promise vs intention classification. Returns "promise", "intention" or null (ambiguous). */
  function classify(c) {
    const t = String((c && c.title) || "");
    const p = PROMISE_EN.test(t) || PROMISE_AR.test(t);
    const i = INTENT_EN.test(t) || INTENT_AR.test(t);
    if (p && !i) return "promise";
    if (i && !p) return "intention";
    if (!p && !i && c && c.due) return "promise"; // a concrete date is a real commitment signal
    return null;
  }
  function ensureStrength() {
    for (const c of DB.commitments) if (c.strength === undefined) c.strength = classify(c);
  }

  /* Duplicate detection: same normalized title + same person among active items. */
  function findDups(items) {
    const seen = {}, groups = [];
    for (const c of items) {
      if (!isActive(c)) continue;
      const k = norm(c.title) + "|" + (c.personId || "");
      if (!k.trim() || k[0] === "|") continue;
      if (seen[k]) { if (!seen[k]._dups) { seen[k]._dups = [seen[k]]; groups.push(seen[k]._dups); } seen[k]._dups.push(c); }
      else seen[k] = c;
    }
    return groups;
  }

  const allItems = () => DB.commitments.map(c => ({ c, tt: "commitments" })).concat(DB.tasks.map(c => ({ c, tt: "tasks" })));
  function setStatus(tt, id, st, until) {
    const a = tt === "tasks" ? DB.tasks : DB.commitments;
    const c = byId(a, id); if (!c) return;
    c.status = st;
    if (st === "done") c.doneAt = Date.now(); else delete c.doneAt;
    if (st === "postponed") c.postponedUntil = until || iso(Date.now() + 7 * DAY); else delete c.postponedUntil;
    save();
  }
  function mergeDup(tt, keepId, dropId) {
    const a = tt === "tasks" ? DB.tasks : DB.commitments;
    const drop = byId(a, dropId); if (!drop) return;
    drop.status = "done"; drop.dupOf = keepId; drop.doneAt = Date.now(); save();
  }

  function badge(c) {
    const s = c.strength;
    if (s === "promise") return ' <span style="color:#6aa9ff;font-size:11px">' + S("promise", "وعد") + "</span>";
    if (s === "intention") return ' <span style="color:#9aa;font-size:11px">' + S("intention", "نية") + "</span>";
    return "";
  }
  function statusLabel(c) {
    if (c.status === "postponed") return S("postponed to ", "مؤجل لـ ") + esc(fmtDate(c.postponedUntil || ""));
    if (c.status === "clarify") return S("needs clarification", "بحاجة توضيح");
    if (c.status === "waiting") return S("waiting", "منتظر");
    return S("open", "مفتوح");
  }
  function card(x, acts) {
    const c = x.c, p = c.personId ? byId(DB.people, c.personId) : null;
    return '<div class="card"><div class="t" dir="auto">' + esc(c.title) + badge(c) + '</div><div class="m">' +
      (p ? esc(p.name) + " · " : "") + statusLabel(c) + (c.due ? " · " + esc(fmtDate(c.due)) : "") + '</div><div class="acts">' + acts(x) + "</div></div>";
  }
  const bDone = x => '<button class="btn p" data-fd="' + x.tt + ":" + esc(x.c.id) + '">' + S("Done", "خلصت") + "</button>";
  const bPost = x => '<button class="btn" data-fp="' + x.tt + ":" + esc(x.c.id) + '">' + S("Postpone", "أجّل") + "</button>";
  const bClar = x => '<button class="btn" data-fc="' + x.tt + ":" + esc(x.c.id) + '">' + S("Clarify", "توضيح") + "</button>";
  const bBack = x => '<button class="btn" data-fb="' + x.tt + ":" + esc(x.c.id) + '">' + S("Reopen", "ارجع") + "</button>";

  function open() {
    ensureStrength();
    const t = today(), soon = iso(Date.now() + 2 * DAY), items = allItems();
    const overdue = items.filter(x => isActive(x.c) && ACTIVE[x.c.status] && x.c.due && x.c.due < t);
    const dueSoon = items.filter(x => isActive(x.c) && ACTIVE[x.c.status] && x.c.due && x.c.due >= t && x.c.due <= soon);
    const waiting = items.filter(x => x.tt === "commitments" && x.c.status === "waiting" && !x.c.dupOf);
    const postponed = items.filter(x => x.c.status === "postponed");
    const clarify = items.filter(x => x.c.status === "clarify");
    const review = items.filter(x => isActive(x.c) && ACTIVE[x.c.status] && x.tt === "commitments" && x.c.strength === null);
    const dups = findDups(DB.commitments).concat(findDups(DB.tasks));
    let h = '<h3 style="margin:0 0 6px">' + S("Follow-ups", "المتابعات") + "</h3>";
    if (overdue.length) h += '<div class="sec"><h2>' + S("Check in: past due", "تحقق: فات موعدها") + "</h2></div>" + overdue.map(x => card(x, y => bDone(y) + bPost(y) + bClar(y))).join("");
    if (dueSoon.length) h += '<div class="sec"><h2>' + S("Due soon", "قريب") + "</h2></div>" + dueSoon.map(x => card(x, y => bDone(y) + bPost(y))).join("");
    if (waiting.length) h += '<div class="sec"><h2>' + S("Waiting on others", "منتظر من الناس") + "</h2></div>" + waiting.map(x => card(x, y => bDone(y) + bPost(y) + bClar(y))).join("");
    if (clarify.length) h += '<div class="sec"><h2>' + S("Needs clarification", "بحاجة توضيح") + "</h2></div>" + clarify.map(x => card(x, y => bBack(y) + bDone(y))).join("");
    if (postponed.length) h += '<div class="sec"><h2>' + S("Postponed", "مؤجل") + "</h2></div>" + postponed.map(x => card(x, y => bBack(y) + bDone(y))).join("");
    if (review.length) h += '<div class="sec"><h2>' + S("Promise or intention?", "وعد ولا نية؟") + '</h2></div><div class="m" style="margin-bottom:6px">' + S("I was not sure how real these are. Tap once and I will remember.", "مش متأكد قد إيه هذي حقيقية. اضغط مرة وبفتكر.") + "</div>" + review.map(x => card(x, y => '<button class="btn" data-fsp="' + esc(y.c.id) + '">' + S("Promise", "وعد") + '</button><button class="btn" data-fsi="' + esc(y.c.id) + '">' + S("Intention", "نية") + "</button>")).join("");
    if (dups.length) h += '<div class="sec"><h2>' + S("Possible duplicates", "تكرار محتمل") + "</h2></div>" + dups.map(g => '<div class="card">' + g.map(c => '<div class="t" dir="auto">' + esc(c.title) + "</div>").join("") + '<div class="acts"><button class="btn" data-fm="' + esc(g[0].id) + ":" + esc(g[g.length - 1].id) + '">' + S("Keep first, merge rest", "خلّي الأول وادمج الباقي") + "</button></div></div>").join("");
    if (!overdue.length && !dueSoon.length && !waiting.length && !clarify.length && !postponed.length && !review.length && !dups.length) h += '<div class="empty">' + S("Nothing to follow up on.", "ما في شي للمتابعة.") + "</div>";
    sheet(h, () => {
      const pick = (el, name) => { const [tt, id] = el.dataset[name].split(":"); return { tt, id }; };
      document.querySelectorAll("[data-fd]").forEach(b => b.onclick = () => { const { tt, id } = pick(b, "fd"); setStatus(tt, id, "done"); open(); });
      document.querySelectorAll("[data-fp]").forEach(b => b.onclick = () => { const { tt, id } = pick(b, "fp"); setStatus(tt, id, "postponed"); open(); });
      document.querySelectorAll("[data-fc]").forEach(b => b.onclick = () => { const { tt, id } = pick(b, "fc"); setStatus(tt, id, "clarify"); open(); });
      document.querySelectorAll("[data-fb]").forEach(b => b.onclick = () => { const { tt, id } = pick(b, "fb"); const a = tt === "tasks" ? DB.tasks : DB.commitments; const c = byId(a, id); setStatus(tt, id, tt === "tasks" ? "open" : (c && c.owner === "them" ? "waiting" : "pending")); open(); });
      document.querySelectorAll("[data-fsp]").forEach(b => b.onclick = () => { const c = byId(DB.commitments, b.dataset.fsp); if (c) { c.strength = "promise"; save(); } open(); });
      document.querySelectorAll("[data-fsi]").forEach(b => b.onclick = () => { const c = byId(DB.commitments, b.dataset.fsi); if (c) { c.strength = "intention"; save(); } open(); });
      document.querySelectorAll("[data-fm]").forEach(b => b.onclick = () => { const [keep, drop] = b.dataset.fm.split(":"); mergeDup(DB.commitments.some(c => c.id === drop) ? "commitments" : "tasks", keep, drop); open(); });
    });
  }
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-follow="1">' + S("Follow-ups", "المتابعات") + "</button></div>" + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-follow]"); if (b) { e.preventDefault(); open(); } });
  try { render(); } catch (e) {}
  window.MindlyFollow = { open, classify, findDups, setStatus, mergeDup, norm };
})();
