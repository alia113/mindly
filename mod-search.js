/* Mindly module: Global Search (Phase 1). Local only: nothing leaves the device.
   Loaded after app.js. Uses globals from app.js: DB, S, esc, sheet, closeSheet, byId, fmtDate, view, openPerson, render, toast, $ . */
(function () {
  "use strict";
  if (window.MindlySearch) return;

  /* ---------- text normalization (Arabic + Latin) ---------- */
  const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;   /* diacritics + tatweel */
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(TASHKEEL, "")
      .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")   /* alef forms -> alef */
      .replace(/\u0649/g, "\u064A")                        /* alef maqsura -> ya */
      .replace(/\u0629/g, "\u0647")                        /* ta marbuta -> ha */
      .replace(/[\u06A9]/g, "\u0643").replace(/[\u06CC]/g, "\u064A")
      .replace(/[\u0660-\u0669]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))   /* arabic-indic digits */
      .replace(/[\u06F0-\u06F9]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 48));
  }
  const WORD = /[\p{L}\p{N}]+/gu;
  const tokens = s => (norm(s).match(WORD) || []);

  /* edit distance with an early cut-off */
  function within(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return false;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let best = i;
      for (let j = 1; j <= b.length; j++) { const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); cur.push(v); if (v < best) best = v; }
      if (best > max) return false; prev = cur;
    }
    return prev[b.length] <= max;
  }

  /* score of one query token against the word list of a record: exact 4, prefix 3, contains 2, fuzzy 1, none 0 */
  function tokScore(q, words) {
    let best = 0;
    for (const w of words) {
      if (w === q) return 4;
      if (best < 3 && w.startsWith(q)) best = 3;
      else if (best < 2 && q.length >= 3 && w.includes(q)) best = 2;
      else if (best < 1 && q.length >= 4 && w.length >= 4) { const mx = q.length >= 7 ? 2 : 1; if (within(q, w, mx)) best = 1; }
    }
    return best;
  }

  /* ---------- index over the existing collections (read only) ---------- */
  const TYPES = [
    { k: "people", en: "People", ar: "الأشخاص" },
    { k: "commitments", en: "Commitments", ar: "الالتزامات" },
    { k: "tasks", en: "Tasks", ar: "المهام" },
    { k: "events", en: "Events", ar: "المواعيد" },
    { k: "memories", en: "Memories", ar: "الذكريات" },
    { k: "interactions", en: "Conversations", ar: "المحادثات" },
    { k: "notes", en: "Notes", ar: "الملاحظات" },
    { k: "inputs", en: "Captures", ar: "الملتقطات" }
  ];
  const personName = id => { const p = id && byId(DB.people || [], id); return p ? p.name : ""; };

  function recText(type, r) {
    switch (type) {
      case "people": return [r.name, r.relation, r.profession, r.project, r.comm, (r.interests || []).join(" "), (r.dates || []).join(" ")].filter(Boolean).join(" ");
      case "commitments": case "tasks": case "events": return [r.title, r.personName || personName(r.personId)].filter(Boolean).join(" ");
      case "memories": return [r.text, r.type, personName(r.personId)].filter(Boolean).join(" ");
      case "interactions": return [r.summary, personName(r.personId)].filter(Boolean).join(" ");
      case "notes": return [r.title, r.text, r.body].filter(Boolean).join(" ");
      case "inputs": return r.text || "";
    }
    return "";
  }
  const recTitle = (type, r) => type === "people" ? r.name : (r.title || r.text || r.summary || r.name || "").toString();
  const recDate = (type, r) => {
    let d = r.date || r.due || null;
    if (!d && type === "inputs") d = r.ts ? iso(r.ts) : null;
    if (!d && r.created) d = iso(r.created);
    return d || "";
  };

  function buildIndex() {
    const out = [];
    for (const t of TYPES) {
      const arr = DB[t.k]; if (!Array.isArray(arr)) continue;
      for (const r of arr) {
        if (!r || typeof r !== "object") continue;
        const text = recText(t.k, r); if (!text) continue;
        out.push({ type: t.k, id: r.id, rec: r, text, words: tokens(text), date: recDate(t.k, r), pid: t.k === "people" ? r.id : (r.personId || "") });
      }
    }
    return out;
  }

  /* ---------- search ---------- */
  function search(query, opts) {
    opts = opts || {};
    const qs = tokens(query); if (!qs.length) return [];
    const res = [];
    for (const it of buildIndex()) {
      if (opts.type && opts.type !== "all" && it.type !== opts.type) continue;
      if (opts.person && it.pid !== opts.person) continue;
      if (opts.from && (!it.date || it.date < opts.from)) continue;
      if (opts.to && (!it.date || it.date > opts.to)) continue;
      let total = 0, ok = true;
      for (const q of qs) { const s = tokScore(q, it.words); if (!s) { ok = false; break; } total += s; }
      if (!ok) continue;
      /* title matches weigh more */
      const tw = tokens(recTitle(it.type, it.rec)); let tb = 0; for (const q of qs) if (tokScore(q, tw) >= 3) tb += 1;
      res.push({ it, score: total / qs.length + tb * 0.5 });
    }
    res.sort((a, b) => b.score - a.score || (b.it.date || "").localeCompare(a.it.date || ""));
    return res;
  }

  /* highlight whole words in the ORIGINAL text whose normalized form matches a query token */
  function hl(text, qs, max) {
    text = String(text || ""); let cut = text.length > (max || 140) ? text.slice(0, max || 140) + "…" : text;
    return esc(cut).replace(/[\p{L}\p{N}]+/gu, w => { const n = norm(w); return qs.some(q => n === q || n.startsWith(q) || (q.length >= 3 && n.includes(q)) || (q.length >= 4 && n.length >= 4 && within(q, n, q.length >= 7 ? 2 : 1))) ? "<mark>" + w + "</mark>" : w; });
  }

  /* ---------- UI ---------- */
  const tl = t => S(t.en, t.ar);
  let st = { q: "", type: "all", person: "", from: "", to: "" };

  function openDetail(type, id) {
    if (type === "people") { closeSheet(); try { view = "people"; openPerson = id; render(); } catch (e) {} return; }
    const arr = DB[type] || []; const r = arr.find(x => x.id === id); if (!r) return;
    const T = TYPES.find(x => x.k === type);
    const pn = r.personName || personName(r.personId);
    let src = ""; if (r.inputId) { const i = byId(DB.inputs || [], r.inputId); if (i) src = '<div class="m" style="margin-top:12px">' + S("Source", "المصدر") + '</div><div class="t" dir="auto" style="opacity:.8">' + esc(i.text) + "</div>"; }
    const meta = [tl(T), recDate(type, r) ? fmtDate(recDate(type, r)) : "", pn, r.status || "", r.type || ""].filter(Boolean).join(" · ");
    sheet('<h3 dir="auto" style="margin:0 0 6px">' + esc(recTitle(type, r)) + '</h3><div class="m">' + esc(meta) + "</div>" + (r.text && r.title ? '<div class="t" dir="auto" style="margin-top:10px">' + esc(r.text) + "</div>" : "") + src +
      '<div class="acts" style="margin-top:14px">' + (r.personId && byId(DB.people, r.personId) ? '<button class="btn" id="msopenp">' + S("Open person", "افتح الشخص") + "</button>" : "") + '<button class="btn" id="msback">' + S("Back to search", "رجوع للبحث") + "</button></div>",
      () => { const a = $("#msopenp"); if (a) a.onclick = () => openDetail("people", r.personId); const b = $("#msback"); if (b) b.onclick = openSearch; });
  }

  function resultsHTML() {
    const qs = tokens(st.q);
    if (!qs.length) return '<div class="m" style="margin-top:12px">' + S("Type to search your people, commitments, tasks, events and memories. Everything stays on this device.", "اكتب للبحث في أشخاصك والتزاماتك ومهامك ومواعيدك وذكرياتك. كل شي يبقى على جهازك.") + "</div>";
    const rs = search(st.q, st);
    if (!rs.length) return '<div class="m" style="margin-top:12px">' + S("No matches. Try fewer or different words.", "ما في نتائج. جرّب كلمات أقل أو مختلفة.") + "</div>";
    let h = '<div class="m" style="margin:10px 0 4px">' + rs.length + " " + S("results", "نتيجة") + "</div>";
    for (const t of TYPES) {
      const g = rs.filter(x => x.it.type === t.k).slice(0, 25); if (!g.length) continue;
      h += '<div class="m" style="margin:12px 0 4px;font-weight:700">' + esc(tl(t)) + " · " + rs.filter(x => x.it.type === t.k).length + "</div>";
      for (const x of g) {
        const it = x.it, pn = it.type === "people" ? "" : (it.rec.personName || personName(it.rec.personId));
        h += '<div class="card" data-ms="' + esc(it.type) + "|" + esc(it.id) + '" style="cursor:pointer"><div class="t" dir="auto">' + hl(recTitle(it.type, it.rec), qs) + '</div><div class="m" dir="auto">' + esc([it.date ? fmtDate(it.date) : "", pn].filter(Boolean).join(" · ")) + "</div></div>";
      }
    }
    return h;
  }

  function openSearch() {
    const peopleOpts = '<option value="">' + S("Any person", "أي شخص") + "</option>" + (DB.people || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(p => '<option value="' + esc(p.id) + '"' + (st.person === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>").join("");
    const chips = [{ k: "all", en: "All", ar: "الكل" }].concat(TYPES).map(t => '<button class="btn' + (st.type === t.k ? " p" : "") + '" data-mst="' + t.k + '" style="padding:6px 12px;font-size:13px">' + esc(tl(t)) + "</button>").join("");
    sheet('<h3 style="margin:0 0 8px">' + S("Search", "بحث") + '</h3><input id="msq" type="search" dir="auto" autocomplete="off" placeholder="' + esc(S("Search everything…", "ابحث في كل شي…")) + '" value="' + esc(st.q) + '" style="width:100%;box-sizing:border-box">' +
      '<div class="acts" style="flex-wrap:wrap;margin-top:8px">' + chips + "</div>" +
      '<div class="acts" style="margin-top:6px"><select id="msp" style="flex:1;min-width:0">' + peopleOpts + '</select><input id="msf" type="date" value="' + esc(st.from) + '" aria-label="from"><input id="mst" type="date" value="' + esc(st.to) + '" aria-label="to"></div>' +
      '<div id="msres">' + resultsHTML() + "</div>", bind);
  }

  function bind() {
    const q = $("#msq"), res = () => { const r = $("#msres"); if (r) r.innerHTML = resultsHTML(); wire(); };
    let tm = null; q.oninput = () => { st.q = q.value; clearTimeout(tm); tm = setTimeout(res, 120); };
    document.querySelectorAll("[data-mst]").forEach(b => b.onclick = () => { st.type = b.dataset.mst; openSearch(); const nq = $("#msq"); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
    $("#msp").onchange = e => { st.person = e.target.value; res(); };
    $("#msf").onchange = e => { st.from = e.target.value; res(); };
    $("#mst").onchange = e => { st.to = e.target.value; res(); };
    wire(); setTimeout(() => { try { q.focus(); } catch (e) {} }, 60);
  }
  function wire() { document.querySelectorAll("[data-ms]").forEach(c => c.onclick = () => { const [t, id] = c.dataset.ms.split("|"); openDetail(t, id); }); }

  /* entry points: header button + Home + Settings do not need changes elsewhere */
  function addButton() {
    const bar = document.querySelector("header.top > div:last-child"); if (!bar || document.getElementById("srchBtn")) return;
    const b = document.createElement("button"); b.className = "btn"; b.id = "srchBtn"; b.setAttribute("aria-label", "Search"); b.textContent = "\u{1F50D}\uFE0E"; b.style.minWidth = "44px"; b.onclick = openSearch;
    bar.insertBefore(b, bar.firstChild);
  }
  addButton();
  window.MindlySearch = { norm, tokens, search, within, open: openSearch, openDetail, buildIndex };
})();
