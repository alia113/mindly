/* Mindly module: Calendar views + conflict detection (Phase 3). Reads DB.events only (date YYYY-MM-DD, optional time HH:MM, optional dur minutes, default 60). Local, no external calendar. */
(function () {
  "use strict";
  if (window.MindlyCal) return;
  const mins = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? +m[1] * 60 + +m[2] : null; };
  function conflicts(events) {
    const out = [], by = {};
    for (const e of events) if (e && e.date) (by[e.date] = by[e.date] || []).push(e);
    for (const d in by) { const a = by[d].filter(e => mins(e.time) !== null).sort((x, y) => mins(x.time) - mins(y.time));
      for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { const s1 = mins(a[i].time), e1 = s1 + (+a[i].dur || 60); if (mins(a[j].time) < e1) out.push([a[i], a[j]]); else break; } }
    return out;
  }
  let mode = "agenda", cursor = new Date();
  const pad = n => String(n).padStart(2, "0"), key = (y, m, d) => y + "-" + pad(m + 1) + "-" + pad(d);
  function clash(e, cs) { return cs.some(p => p[0] === e || p[1] === e); }
  function agenda(cs) {
    const t = today(), ev = DB.events.filter(e => e.date >= t).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || ""))).slice(0, 40);
    if (!ev.length) return '<div class="empty">' + S("No upcoming events.", "ما في مواعيد جاية.") + "</div>";
    let last = "", h = "";
    for (const e of ev) { if (e.date !== last) { last = e.date; h += '<div class="sec"><h2>' + esc(fmtDate(e.date)) + "</h2></div>"; }
      h += '<div class="card"><div class="t" dir="auto">' + esc(e.title) + (clash(e, cs) ? ' <span style="color:#ff9f43">⚠</span>' : "") + '</div><div class="m">' + esc(e.time || S("all day", "طول اليوم")) + "</div></div>"; }
    return h;
  }
  function month(cs) {
    const y = cursor.getFullYear(), m = cursor.getMonth(), first = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate(), t = today();
    const names = new Intl.DateTimeFormat(A() ? "ar" : "en", { month: "long", year: "numeric" }).format(cursor);
    let cells = ""; for (let i = 0; i < first; i++) cells += "<div></div>";
    for (let d = 1; d <= n; d++) { const k = key(y, m, d), es = DB.events.filter(e => e.date === k), bad = es.some(e => clash(e, cs));
      cells += '<button class="btn" data-cd="' + k + '" style="padding:6px 0;min-height:40px;' + (k === t ? "border-color:#6aa9ff;" : "") + '">' + d + (es.length ? '<div style="font-size:10px;color:' + (bad ? "#ff9f43" : "#6aa9ff") + '">' + (bad ? "⚠" : "●") + es.length + "</div>" : "") + "</button>"; }
    return '<div class="acts" style="justify-content:space-between"><button class="btn" id="cprev">‹</button><b>' + esc(names) + '</b><button class="btn" id="cnext">›</button></div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:8px">' + cells + '</div><div id="cday"></div>';
  }
  function open() {
    const cs = conflicts(DB.events);
    const warn = cs.length ? '<div class="card" style="border-color:#ff9f43"><div class="t">⚠ ' + S(cs.length + " scheduling conflict(s)", cs.length + " تعارض بالمواعيد") + "</div>" + cs.slice(0, 4).map(p => '<div class="m" dir="auto">' + esc(fmtDate(p[0].date) + " · " + p[0].title + " / " + p[1].title) + "</div>").join("") + "</div>" : "";
    sheet('<h3 style="margin:0 0 6px">' + S("Calendar", "التقويم") + '</h3><div class="acts"><button class="btn' + (mode === "agenda" ? " p" : "") + '" id="cma">' + S("Agenda", "قائمة") + '</button><button class="btn' + (mode === "month" ? " p" : "") + '" id="cmm">' + S("Month", "شهر") + "</button></div>" + warn + (mode === "agenda" ? agenda(cs) : month(cs)), () => {
      $("#cma").onclick = () => { mode = "agenda"; open(); }; $("#cmm").onclick = () => { mode = "month"; open(); };
      const pv = $("#cprev"); if (pv) { pv.onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); open(); }; $("#cnext").onclick = () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); open(); }; }
      document.querySelectorAll("[data-cd]").forEach(b => b.onclick = () => { const es = DB.events.filter(e => e.date === b.dataset.cd); $("#cday").innerHTML = '<div class="sec"><h2>' + esc(fmtDate(b.dataset.cd)) + "</h2></div>" + (es.length ? es.map(e => '<div class="card"><div class="t" dir="auto">' + esc(e.title) + '</div><div class="m">' + esc(e.time || "") + "</div></div>").join("") : '<div class="m">' + S("Nothing scheduled.", "ما في شي.") + "</div>"); });
    });
  }
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-cal="1">' + S("Calendar", "التقويم") + "</button></div>" + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-cal]"); if (b) { e.preventDefault(); open(); } });
  try { render(); } catch (e) {}
  window.MindlyCal = { open, conflicts };
})();
