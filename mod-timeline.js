/* Mindly module: Memory Timeline + Detail (Phase 1). Local only. Loaded after app.js and mod-search.js.
   Reads memories, conversations (interactions) and events; the only write is an optional date correction
   stored as the additive field `date` on the record (never removes or renames anything). */
(function () {
  "use strict";
  if (window.MindlyTimeline) return;

  const KINDS = [
    { k: "all", en: "All", ar: "الكل" },
    { k: "memories", en: "Memories", ar: "الذكريات" },
    { k: "interactions", en: "Conversations", ar: "المحادثات" },
    { k: "events", en: "Events", ar: "المواعيد" }
  ];
  let st = { kind: "all", type: "all" };

  const dateOf = (kind, r) => r.date || (r.created ? iso(r.created) : "") || (r.ts ? iso(r.ts) : "") || "";
  const textOf = (kind, r) => kind === "memories" ? (r.text || "") : kind === "interactions" ? (r.summary || "") : (r.title || "");
  const pname = r => r.personName || ((byId(DB.people || [], r.personId) || {}).name || "");

  function items() {
    const out = [];
    for (const kd of KINDS.slice(1)) {
      if (st.kind !== "all" && st.kind !== kd.k) continue;
      for (const r of (DB[kd.k] || [])) {
        if (!r || !r.id) continue;
        if (kd.k === "memories" && st.type !== "all" && (r.type || "") !== st.type) continue;
        const d = dateOf(kd.k, r); const tx = textOf(kd.k, r); if (!tx) continue;
        out.push({ kind: kd.k, id: r.id, rec: r, date: d, text: tx, who: pname(r) });
      }
    }
    out.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return out;
  }

  const monthName = (y, m) => new Date(y, m - 1, 15).toLocaleDateString(DB.settings.lang === "ar" ? "ar" : "en", { month: "long" });
  const kindLabel = k => { const x = KINDS.find(z => z.k === k); return x ? S(x.en, x.ar) : k; };

  function timelineHTML() {
    const list = items();
    if (!list.length) return '<div class="m" style="margin-top:12px">' + S("Nothing on the timeline yet. Memories, conversations and events show up here by date.", "ما في شي على الخط الزمني بعد. الذكريات والمحادثات والمواعيد بتظهر هنا حسب التاريخ.") + "</div>";
    let h = "", lastY = "", lastM = "";
    for (const x of list) {
      const m = /^(\d{4})-(\d{2})/.exec(x.date || "");
      const y = m ? m[1] : "?", mo = m ? m[2] : "?";
      if (y !== lastY) { h += '<div class="m" style="margin:16px 0 2px;font-weight:800;font-size:15px">' + (y === "?" ? S("No date", "بدون تاريخ") : y) + "</div>"; lastY = y; lastM = ""; }
      if (mo !== lastM) { h += '<div class="m" style="margin:8px 0 4px">' + (mo === "?" ? "" : esc(monthName(+y, +mo))) + "</div>"; lastM = mo; }
      h += '<div class="card" data-tl="' + esc(x.kind) + "|" + esc(x.id) + '" style="cursor:pointer"><div class="t" dir="auto">' + esc(x.text.length > 140 ? x.text.slice(0, 140) + "…" : x.text) + '</div><div class="m" dir="auto">' + esc([x.date ? fmtDate(x.date) : "", kindLabel(x.kind), x.rec.type && x.kind === "memories" ? x.rec.type : "", x.who].filter(Boolean).join(" · ")) + "</div></div>";
    }
    return h;
  }

  function memTypes() { return [...new Set((DB.memories || []).map(m => m.type).filter(Boolean))]; }

  function open() {
    const chips = KINDS.map(k => '<button class="btn' + (st.kind === k.k ? " p" : "") + '" data-tlk="' + k.k + '" style="padding:6px 12px;font-size:13px">' + esc(S(k.en, k.ar)) + "</button>").join("");
    const tchips = (st.kind === "all" || st.kind === "memories") && memTypes().length ? '<div class="acts" style="flex-wrap:wrap;margin-top:6px">' + ["all"].concat(memTypes()).map(t => '<button class="btn' + (st.type === t ? " p" : "") + '" data-tlt="' + esc(t) + '" style="padding:5px 11px;font-size:12px">' + esc(t === "all" ? S("Any type", "أي نوع") : t) + "</button>").join("") + "</div>" : "";
    sheet('<h3 style="margin:0 0 8px">' + S("Timeline", "الخط الزمني") + '</h3><div class="acts" style="flex-wrap:wrap">' + chips + "</div>" + tchips + '<div id="tlbody">' + timelineHTML() + "</div>", () => {
      document.querySelectorAll("[data-tlk]").forEach(b => b.onclick = () => { st.kind = b.dataset.tlk; if (st.kind !== "all" && st.kind !== "memories") st.type = "all"; open(); });
      document.querySelectorAll("[data-tlt]").forEach(b => b.onclick = () => { st.type = b.dataset.tlt; open(); });
      document.querySelectorAll("[data-tl]").forEach(c => c.onclick = () => { const [k, id] = c.dataset.tl.split("|"); detail(k, id); });
    });
  }

  function detail(kind, id) {
    const r = (DB[kind] || []).find(x => x.id === id); if (!r) return;
    const d = dateOf(kind, r); const who = pname(r);
    let src = ""; if (r.inputId) { const i = byId(DB.inputs || [], r.inputId); if (i) src = '<div class="m" style="margin-top:12px">' + S("Source", "المصدر") + '</div><div class="t" dir="auto" style="opacity:.8">' + esc(i.text) + "</div>"; }
    let links = ""; if (r.personId) { const rel = []; for (const k of ["commitments", "tasks", "events", "memories"]) for (const z of (DB[k] || [])) if (z.personId === r.personId && z.id !== r.id) rel.push(z.title || z.text); if (rel.length) links = '<div class="m" style="margin-top:12px">' + S("Linked to ", "مرتبط بـ ") + esc(who) + "</div>" + rel.slice(0, 5).map(x => '<div class="t" dir="auto" style="font-size:14px;opacity:.85">• ' + esc(String(x).slice(0, 90)) + "</div>").join(""); }
    sheet('<h3 dir="auto" style="margin:0 0 6px">' + esc(textOf(kind, r)) + '</h3><div class="m">' + esc([kindLabel(kind), d ? fmtDate(d) : "", who, r.type || ""].filter(Boolean).join(" · ")) + "</div>" + src + links +
      '<div class="m" style="margin-top:14px">' + S("Correct the date", "صحّح التاريخ") + '</div><div class="acts"><input id="tld" type="date" value="' + esc(d) + '" style="flex:1"><button class="btn p" id="tlsave">' + S("Save date", "احفظ التاريخ") + "</button></div>" +
      '<div class="acts" style="margin-top:14px">' + (r.personId && byId(DB.people, r.personId) ? '<button class="btn" id="tlp">' + S("Open person", "افتح الشخص") + "</button>" : "") + '<button class="btn" id="tlb">' + S("Back to timeline", "رجوع للخط الزمني") + "</button></div>", () => {
      $("#tlb").onclick = open;
      const p = $("#tlp"); if (p) p.onclick = () => { closeSheet(); view = "people"; openPerson = r.personId; render(); };
      $("#tlsave").onclick = () => { const v = $("#tld").value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast(S("Pick a valid date.", "اختار تاريخ صحيح.")); return; } r.date = v; save(); toast(S("Date saved.", "انحفظ التاريخ.")); open(); };
    });
  }

  /* entry point: a button at the top of the Memory tab (delegated click so re-renders keep working) */
  if (typeof vMem === "function") { const _vm = vMem; vMem = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-mtl="1">' + S("Timeline", "الخط الزمني") + "</button></div>" + _vm(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-mtl]"); if (b) { e.preventDefault(); open(); } });

  window.MindlyTimeline = { open, detail, items };
})();
