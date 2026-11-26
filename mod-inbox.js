/* Mindly module: Inbox states (Phase 2). Reads DB.inputs (raw captures). Adds optional input.state = "archived" | "review" (user choice, additive).
   Derived state when no user choice: "processed" if any record links to the input (inputId), otherwise "unsorted" (nothing was extracted). Nothing is deleted. */
(function () {
  "use strict";
  if (window.MindlyInbox) return;
  const COLS = ["people", "commitments", "tasks", "events", "memories", "notes", "interactions"];
  function linked(id) {
    let n = 0;
    for (const c of COLS) for (const r of (DB[c] || [])) if (r && (r.inputId === id || (Array.isArray(r.srcs) && r.srcs.indexOf(id) >= 0))) n++;
    return n;
  }
  function stateOf(i) {
    if (i.state === "archived" || i.state === "review") return i.state;
    return linked(i.id) ? "processed" : "unsorted";
  }
  const LBL = { processed: ["Processed", "تمت المعالجة"], unsorted: ["Unsorted", "غير مصنف"], review: ["Needs review", "للمراجعة"], archived: ["Archived", "مؤرشف"] };
  let filter = "all";
  function setState(id, st) { const i = byId(DB.inputs, id); if (!i) return; if (st) i.state = st; else delete i.state; save(); }
  function open() {
    const all = (DB.inputs || []).slice().sort((a, b) => b.ts - a.ts);
    const cnt = { all: 0, processed: 0, unsorted: 0, review: 0, archived: 0 };
    all.forEach(i => { cnt.all++; cnt[stateOf(i)]++; });
    const list = all.filter(i => filter === "all" ? stateOf(i) !== "archived" : stateOf(i) === filter).slice(0, 60);
    const tabs = ["all", "unsorted", "review", "processed", "archived"].map(k => '<button class="btn' + (filter === k ? " p" : "") + '" data-if="' + k + '">' + (k === "all" ? S("Active", "النشط") : S(LBL[k][0], LBL[k][1])) + " " + (k === "all" ? cnt.all - cnt.archived : cnt[k]) + "</button>").join("");
    const rows = list.map(i => { const st = stateOf(i); return '<div class="card"><div class="t" dir="auto">' + esc(String(i.text || "").slice(0, 160)) + '</div><div class="m">' + esc(fmtDate(iso(i.ts))) + " · " + S(LBL[st][0], LBL[st][1]) + '</div><div class="acts">' +
      (st === "archived" ? '<button class="btn" data-is="' + esc(i.id) + ':">' + S("Restore", "استرجاع") + "</button>" : '<button class="btn" data-is="' + esc(i.id) + ':archived">' + S("Archive", "أرشفة") + "</button>") +
      (st !== "review" && st !== "archived" ? '<button class="btn" data-is="' + esc(i.id) + ':review">' + S("Needs review", "للمراجعة") + "</button>" : "") +
      (st === "review" ? '<button class="btn" data-is="' + esc(i.id) + ':">' + S("Clear flag", "شيل العلامة") + "</button>" : "") + "</div></div>"; }).join("");
    sheet('<h3 style="margin:0 0 6px">' + S("Inbox", "الوارد") + '</h3><div class="acts" style="flex-wrap:wrap">' + tabs + "</div>" + (rows || '<div class="empty">' + S("Nothing here.", "ما في شي هون.") + "</div>"), () => {
      document.querySelectorAll("[data-if]").forEach(b => b.onclick = () => { filter = b.dataset.if; open(); });
      document.querySelectorAll("[data-is]").forEach(b => b.onclick = () => { const k = b.dataset.is.indexOf(":"); setState(b.dataset.is.slice(0, k), b.dataset.is.slice(k + 1)); open(); });
    });
  }
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-inbox="1">' + S("Inbox", "الوارد") + "</button></div>" + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-inbox]"); if (b) { e.preventDefault(); open(); } });
  try { render(); } catch (e) {}
  window.MindlyInbox = { open, stateOf, setState, linked };
})();
