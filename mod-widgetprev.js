/* Mindly module: widget PREVIEWS (web). These are in-app previews of how the planned iOS Lock Screen and Home Screen widgets could look.
   They are NOT real iOS widgets and do not appear on the Lock Screen or Home Screen. Read-only on the existing DB (settings are the only write).
   Lock-style previews hide sensitive titles by default. Customize in the preview screen (DB.settings.wp). */
(function () {
  "use strict";
  if (window.MindlyWidgetPrev) return;
  const KEYS = ["tasks", "event", "progress", "briefing", "capture"];
  const cfg = () => Object.assign({ hideLock: true, showTitlesHome: true, tasks: true, event: true, progress: true, briefing: true, capture: true, max: 3 }, (DB.settings && DB.settings.wp) || {});
  const setCfg = (k, v) => { DB.settings = DB.settings || {}; DB.settings.wp = Object.assign(cfg(), DB.settings.wp || {}); DB.settings.wp[k] = v; save(); };
  function data() {
    const t = today(), now = new Date(), hm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    const items = [];
    (DB.tasks || []).forEach(x => { if (!x.dupOf && (!x.due || x.due <= t)) items.push({ id: x.id, title: x.title, done: x.status === "done", sens: !!x.sensitive || !!x.private }); });
    (DB.commitments || []).forEach(c => { if (c.owner === "me" && !c.dupOf && c.due && c.due <= t) items.push({ id: c.id, title: c.title, done: c.status === "done", sens: !!c.sensitive || !!c.private }); });
    const open = items.filter(x => !x.done), done = items.length - open.length;
    const ev = (DB.events || []).filter(e => e.date === t).sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
    const next = ev.find(e => !e.time || e.time >= hm) || null;
    let mins = null; if (next && next.time) { const [h, m] = next.time.split(":").map(Number); mins = h * 60 + m - (now.getHours() * 60 + now.getMinutes()); }
    const fu = (DB.commitments || []).filter(c => c.status !== "done" && !c.dupOf && c.status !== "postponed").length;
    return { open, done, total: items.length, next, mins, evCount: ev.length, fu };
  }
  const cd = m => m === null ? "" : m <= 0 ? S("now", "هلأ") : m < 60 ? S("in " + m + " min", "بعد " + m + " دقيقة") : S("in " + Math.floor(m / 60) + "h " + (m % 60) + "m", "بعد " + Math.floor(m / 60) + "س " + (m % 60) + "د");
  const title = (x, show, c) => show ? esc(String(x).slice(0, 28)) : S("Private item", "عنصر خاص");
  const W = "background:#1a1d24;border-radius:18px;padding:10px 12px;color:#fff;box-sizing:border-box;";
  function lock(d, c) {
    const hide = c.hideLock, show = x => !hide && !x.sens;
    const out = [];
    if (c.tasks) out.push(["Daily Tasks", "المهام اليومية", '<div style="font-weight:600">' + d.open.length + " " + S("open", "مفتوحة") + "</div>" + d.open.slice(0, c.max).map(x => '<div class="m" dir="auto">• ' + title(x.title, show(x), c) + "</div>").join("")]);
    if (c.event) out.push(["Next Event", "الموعد القادم", d.next ? '<div style="font-weight:600" dir="auto">' + (hide ? S("Event", "موعد") : esc(String(d.next.title || "").slice(0, 24))) + '</div><div class="m">' + esc(d.next.time || "") + " " + cd(d.mins) + "</div>" : '<div class="m">' + S("Nothing scheduled", "ما في شي") + "</div>"]);
    if (c.progress) { const p = d.total ? Math.round(d.done / d.total * 100) : 0; out.push(["Daily Progress", "تقدم اليوم", '<div style="font-size:26px;font-weight:700">' + p + '%</div><div class="m">' + d.done + "/" + d.total + "</div>"]); }
    if (c.briefing) out.push(["Smart Briefing", "الملخص الذكي", '<div class="m" dir="auto">' + S(d.evCount + " events, " + d.open.length + " open tasks, " + d.fu + " follow-ups.", d.evCount + " مواعيد، " + d.open.length + " مهام مفتوحة، " + d.fu + " متابعات.") + "</div>"]);
    if (c.capture) out.push(["Quick Capture", "التقاط سريع", '<button class="btn" data-wpcap="1">' + S("Capture", "التقط") + "</button>"]);
    return out;
  }
  function render(d, c) {
    const card = (t, ta, body) => '<div style="' + W + 'min-width:150px;flex:1 1 150px"><div class="m" style="opacity:.7">' + S(t, ta) + "</div>" + body + "</div>";
    const L = lock(d, c).map(x => card(x[0], x[1], x[2])).join("");
    const homeTasks = d.open.slice(0, c.max * 2).map(x => '<div class="m" dir="auto">' + (x.done ? "✓" : "○") + " " + title(x.title, c.showTitlesHome && !x.sens, c) + "</div>").join("");
    const big = '<div style="' + W + 'flex:1 1 100%"><div class="m" style="opacity:.7">' + S("Home large (preview)", "الشاشة الرئيسية كبير (معاينة)") + "</div>" +
      '<div style="font-weight:600;margin:4px 0" dir="auto">' + (d.next ? esc(String(d.next.title || "")) + " · " + esc(d.next.time || "") + " " + cd(d.mins) : S("No event today", "ما في موعد اليوم")) + "</div>" + (homeTasks || '<div class="m">' + S("No open tasks", "ما في مهام") + "</div>") + "</div>";
    const lab = x => '<div class="m" style="opacity:.7">' + x + "</div>";
    const small = '<div style="' + W + 'width:150px;height:150px;overflow:hidden">' + lab(S("Home small", "رئيسية صغير")) + '<div style="font-size:26px;font-weight:700">' + d.open.length + '</div><div class="m">' + S("open tasks", "مهام مفتوحة") + '</div><div class="m" dir="auto">' + (d.next ? esc(d.next.time || "") + " " + cd(d.mins) : S("No event", "ما في موعد")) + "</div></div>";
    const medium = '<div style="' + W + 'flex:1 1 100%;min-height:110px">' + lab(S("Home medium", "رئيسية متوسط")) + '<div style="display:flex;gap:12px"><div style="flex:1"><div style="font-weight:600" dir="auto">' + (d.next ? esc(String(d.next.title || "").slice(0, 24)) : S("No event today", "ما في موعد اليوم")) + '</div><div class="m">' + (d.next ? esc(d.next.time || "") + " " + cd(d.mins) : "") + '</div></div><div style="flex:1">' + (homeTasks.split("</div>").slice(0, 3).join("</div>") || '<div class="m">' + S("No open tasks", "ما في مهام") + "</div>") + "</div></div></div>";
    return '<div style="display:flex;flex-wrap:wrap;gap:8px"><div class="m" style="flex:1 1 100%">' + S("Lock Screen style (sensitive titles " + (c.hideLock ? "hidden" : "shown") + ")", "نمط شاشة القفل (العناوين الحساسة " + (c.hideLock ? "مخفية" : "ظاهرة") + ")") + "</div>" + L + '<div class="m" style="flex:1 1 100%">' + S("Home Screen sizes (preview)", "أحجام الشاشة الرئيسية (معاينة)") + "</div>" + small + medium + big + "</div>";
  }
  function open() {
    const c = cfg(), d = data();
    const chk = (id, on, lab) => '<label style="display:flex;gap:8px;align-items:center;justify-content:flex-start;margin:6px 0;text-align:start"><input type="checkbox" style="width:22px;height:22px;flex:none;margin:0" data-wk="' + id + '"' + (on ? " checked" : "") + "><span style=\"flex:1\">" + lab + "</span></label>";
    sheet('<h3 style="margin:0 0 6px">' + S("Widget previews", "معاينة الويدجت") + '</h3><div class="card" style="border-color:#f5a623"><div class="t">' + S("Previews only", "معاينة فقط") + '</div><div class="m">' + S("These are in-app previews. They are not real iOS widgets and will not appear on your Lock Screen or Home Screen. Real widgets need the native app.", "هاي معاينات داخل التطبيق. مش ويدجت iOS حقيقية وما رح تظهر على شاشة القفل أو الرئيسية. الويدجت الحقيقية بدها التطبيق الأصلي.") + "</div></div>" +
      render(d, c) + '<h4 style="margin:12px 0 4px">' + S("What to show", "شو يظهر") + "</h4>" +
      chk("hideLock", c.hideLock, S("Hide sensitive titles on lock-style previews (recommended)", "إخفاء العناوين الحساسة بنمط القفل (مفضل)")) + chk("showTitlesHome", c.showTitlesHome, S("Show task titles on Home sizes", "إظهار عناوين المهام بأحجام الرئيسية")) +
      KEYS.map(k => chk(k, c[k], ({ tasks: S("Daily Tasks", "المهام اليومية"), event: S("Next Event", "الموعد القادم"), progress: S("Daily Progress", "تقدم اليوم"), briefing: S("Smart Briefing", "الملخص الذكي"), capture: S("Quick Capture", "التقاط سريع") })[k])).join(""), () => {});
    const dlg = document.querySelector("#dlg") || document;
    dlg.querySelectorAll("[data-wk]").forEach(i => i.onchange = () => { setCfg(i.dataset.wk, i.checked); open(); });
    dlg.querySelectorAll("[data-wpcap]").forEach(b => b.onclick = () => { closeSheet(); try { const k = document.querySelector("#vkb"); if (k) k.click(); } catch (e) {} });
  }
  /* entry button on Home, next to the other module buttons */
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-wprev="1">' + S("Widget previews", "معاينة الويدجت") + "</button></div>" + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-wprev]"); if (b) { e.preventDefault(); open(); } });
  try { render0(); } catch (e) {}
  function render0() { if (typeof window.render === "function") window.render(); }
  window.MindlyWidgetPrev = { open, data };
})();
