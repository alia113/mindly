/* Mindly module: Quick capture as a recorder (v79). Save stores the text at once as a raw input (visible in Inbox), then sorts it in the background:
   AI extraction first, local rules if the AI fails or finds nothing, plain note if neither finds facts. The raw input is the same record the sorted items link to,
   so nothing is duplicated and nothing typed is ever dropped. Kill switch: localStorage "mindly.quick.off"="1" restores the old chat-style Quick capture. */
(function () {
  "use strict";
  if (window.MindlyQuick) return;
  const off = () => { try { return localStorage.getItem("mindly.quick.off") === "1"; } catch (e) { return false; } };
  const hasFacts = ex => !!(ex && ((ex.people || []).length || (ex.commitments || []).length || (ex.tasks || []).length || (ex.events || []).length || (ex.memories || []).length || (ex.prefs || []).length || (ex.done || []).length));
  const cnt = () => [DB.commitments.length, DB.tasks.length, DB.events.length, DB.memories.length, DB.people.length];
  const find = id => DB.inputs.find(i => i.id === id);
  function names(n0, n1) { const nm = [S("Commitments", "الالتزامات"), S("Tasks", "المهام"), S("Events", "المواعيد"), S("Memory", "الذاكرة"), S("People", "الأشخاص")], got = []; for (let i = 0; i < 5; i++) if (n1[i] > n0[i]) got.push(nm[i]); return got; }
  function localSort(inp) { try { const ex = extract(inp.text, {}); if (hasFacts(ex)) { applyExtraction(inp.text, ex, "quick", inp); return true; } } catch (e) {} return false; }
  async function aiExtract(text) {
    if (typeof AI_URL === "undefined" || !AI_URL || DB.settings.noAI) return null;
    const ctx = { people: DB.people.map(p => ({ name: p.name, relation: p.relation, profession: p.profession, project: p.project, comm: p.comm })), commitments: DB.commitments.filter(c => c.status !== "done").map(c => ({ title: c.title, person: c.personName, owner: c.owner, due: c.due, status: c.status, inputId: c.inputId })), tasks: DB.tasks.filter(t => t.status !== "done").map(t => ({ title: t.title, due: t.due })), events: DB.events.map(e => ({ title: e.title, date: e.date })), memories: DB.memories.slice(-60).map(m => ({ type: m.type, text: m.text, inputId: m.inputId })) };
    for (let at = 0; at < 2; at++) {
      const c = new AbortController(), tm = setTimeout(() => c.abort(), 20000); let r = null;
      try { r = await fetch(AI_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, today: today(), ctx, lang: DB.settings.lang === "ar" ? "ar" : "en" }), signal: c.signal }); } catch (er) { r = null; } finally { clearTimeout(tm); }
      if (r && r.ok) { try { const j = await r.json(); if (j.intent === "save" && j.extraction) { const e = j.extraction; const ex = Object.assign({ people: [], commitments: [], tasks: [], events: [], memories: [], prefs: [], done: [], interactionPerson: null, isPast: false, date: today() }, e);
          ex.commitments = (ex.commitments || []).map(x => ({ kind: "confirmed", status: x.owner === "them" ? "waiting" : "pending", due: null, ...x })); ex.tasks = (ex.tasks || []).map(x => ({ kind: "confirmed", due: null, ...x })); ex.memories = (ex.memories || []).map(x => ({ kind: "confirmed", ...x }));
          ex.prefs = (ex.prefs || []).map(x => ({ kind: "confirmed", ...x })); ex.people = (ex.people || []).filter(x => x && x.name); ex.interactionPerson = ex.interactionPerson || (ex.people[0] && ex.people[0].name) || null; ex.done = ex.done || []; return ex; } } catch (er) {} return null; }
      if (r && r.status < 500) return null;
    }
    return null;
  }
  async function sortInput(inp) {
    const n0 = cnt(); let done = false;
    try { const ex = await aiExtract(inp.text); if (ex && hasFacts(ex) && find(inp.id) && inp.sorting) { applyExtraction(inp.text, ex, "quick", inp); done = true; } } catch (e) {}
    if (!done && find(inp.id) && inp.sorting) done = localSort(inp);
    delete inp.sorting; try { save(); } catch (e) {}
    return names(n0, cnt());
  }
  function handle(st) {
    const ta = document.querySelector("#qct"); const text = ((ta && ta.value) || "").trim(); if (!text) return;
    if (DB.settings.paused) { st(S("Memory is paused. Nothing was saved.", "الذاكرة متوقفة. ما انحفظ شي.")); return; }
    const inp = { id: uid("in"), text, ts: Date.now(), source: "quick", sorting: true }; DB.inputs.push(inp); save();
    ta.value = ""; st(S("Saved ✓  Sorting in the background…", "انحفظ ✓  عم ارتبها بالخلفية…")); setTimeout(() => { const t = document.querySelector("#qct"); t && t.focus(); }, 50);
    sortInput(inp).then(got => { const el = document.querySelector("#qcst"); if (el) el.textContent = got.length ? S("Saved ✓  Sorted into: ", "انحفظ ✓  انرتب في: ") + got.join(", ") : S("Saved ✓  Kept in Inbox, unsorted.", "انحفظ ✓  انحفظ في الوارد بدون ترتيب."); try { render(); } catch (e) {} }).catch(() => {});
  }
  setTimeout(() => { try { let ch = false; DB.inputs.forEach(i => { if (i.sorting && Date.now() - i.ts > 20000) { localSort(i); delete i.sorting; ch = true; } }); if (ch) save(); } catch (e) {} }, 3000);
  window.MindlyQuick = { handle, off, sortInput };
})();

/* ---- v80: Quick capture type picker + per-section forms. Wraps quickCapture(): the v79 recorder stays intact behind "Quick note".
   Forms write records straight into the existing sections (no AI, works offline). Kill switch: localStorage "mindly.quickforms.off"="1". ---- */
(function () {
  "use strict";
  const foff = () => { try { return localStorage.getItem("mindly.quickforms.off") === "1"; } catch (e) { return false; } };
  const E = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  if (!document.getElementById("qfcss")) { const st = document.createElement("style"); st.id = "qfcss"; st.textContent = ".qfg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.qft{border:1px solid var(--line);background:rgba(128,128,128,.14);color:inherit;border-radius:14px;padding:8px 6px;text-align:center;font-size:14px;min-height:56px}.qft b{display:block;font-size:19px;font-weight:400;margin-bottom:1px}.qft.n{grid-column:1/-1;min-height:48px}.qfl{font-size:12px;opacity:.75;margin:8px 0 3px}.qff input,.qff select{width:100%;font-size:16px;box-sizing:border-box}.qfr{display:flex;gap:8px}.qfr>div{flex:1;min-width:0}.qfch{display:flex;flex-wrap:wrap;gap:6px}.qfch button{padding:7px 11px;border-radius:99px;border:1px solid var(--line);background:rgba(128,128,128,.14);color:inherit;font-size:13px}.qfch button.on{background:var(--acc);color:#fff;border-color:transparent}.qff input[type=date],.qff input[type=time],.qff input[type=datetime-local]{-webkit-appearance:none;appearance:none;display:block;width:100%;min-width:0;max-width:100%;box-sizing:border-box;min-height:46px;margin:0;text-align:start}.qff input::-webkit-date-and-time-value{text-align:start;min-height:1.4em;margin:0}.qff input::-webkit-datetime-edit{padding:0}.qfw{position:relative;min-width:0;max-width:100%}.qfph{position:absolute;inset-inline-start:14px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.55;font-size:16px;white-space:nowrap;overflow:hidden;max-width:calc(100% - 28px)}.qfw.has .qfph{display:none}.qfw:not(.has) input{color:transparent}.qfw:not(.has) input::-webkit-datetime-edit{opacity:0}.qfr{min-width:0}.qfs{position:sticky;bottom:0;padding:8px 0 4px;background:#121316}html[data-theme=light] .dlg.qc-theme .qfs{background:#fff}"; document.head.appendChild(st); }
  const T0 = () => DB.people.map(p => p.name);
  const nk = s => (typeof norm === "function" ? norm(String(s).toLowerCase()) : String(s).toLowerCase()).trim();
  function personByName(name, create, inpId) {
    name = (name || "").trim(); if (!name) return null; const k = nk(name);
    let p = DB.people.find(x => nk(x.name) === k) || DB.people.find(x => nk(x.name.split(" ")[0]) === k && DB.people.filter(y => nk(y.name.split(" ")[0]) === k).length === 1);
    if (!p && create) { p = { id: uid("p"), name, relation: "", profession: "", comm: "", project: "", interests: [], dates: [], extra: {}, created: Date.now(), srcs: [inpId] }; DB.people.push(p); }
    return p || null;
  }
  const TYPES = () => [
    { k: "note", ic: "✎", l: S("Quick note (free text)", "ملاحظة سريعة (نص حر)") },
    { k: "event", ic: "▦", l: S("Appointment", "موعد") },
    { k: "task", ic: "✓", l: S("Task", "مهمة") },
    { k: "commit", ic: "⇄", l: S("Commitment / promise", "التزام / وعد") },
    { k: "person", ic: "◉", l: S("Person", "شخص") },
    { k: "memory", ic: "✎", l: S("Memory", "ذاكرة") },
    { k: "goal", ic: "★", l: S("Goal", "هدف") },
    { k: "remind", ic: "🔔", l: S("Reminder", "تذكير") },
    { k: "alarm", ic: "⏰", l: S("Alarm", "منبّه") }];
  const fld = (id, lab, html) => '<div class="qfl">' + lab + "</div>" + html;
  const PH = { date: () => S("Pick a date", "اختر التاريخ"), time: () => S("Pick a time", "اختر الوقت"), "datetime-local": () => S("Pick date and time", "اختر التاريخ والوقت") };
  const inp = (id, ph, ty, v) => { const h = '<input id="' + id + '" type="' + (ty || "text") + '" dir="auto" placeholder="' + E(ph || "") + '" value="' + E(v || "") + '" autocomplete="off">'; return PH[ty] ? '<div class="qfw' + (v ? " has" : "") + '">' + h + '<span class="qfph">' + E(PH[ty]()) + "</span></div>" : h; };
  const p2 = n => String(n).padStart(2, "0");
  const nextHour = () => { const d = new Date(Date.now() + 36e5); return { t: p2(d.getHours()) + ":00", dt: d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":00" }; };
  const OPT = () => S(" (optional)", " (اختياري)");
  const pplist = () => '<datalist id="qfpl">' + T0().map(n => '<option value="' + E(n) + '">').join("") + "</datalist>";
  const pfield = () => fld("qp", S("Person", "الشخص") + OPT(), '<input id="qp" list="qfpl" dir="auto" autocomplete="off" placeholder="' + S("Pick or type a name", "اختر أو اكتب اسم") + '">' + pplist());
  const FORMS = {
    event: () => fld("", S("Name", "الاسم"), inp("qa", "")) + '<div class="qfr"><div>' + fld("", S("Date", "التاريخ"), inp("qb", "", "date", today())) + "</div><div>" + fld("", S("Time", "الوقت") + OPT(), inp("qc", "", "time")) + "</div></div>" + pfield() + fld("", S("Place", "المكان") + OPT(), inp("qd", S("Where?", "وين؟"))),
    task: () => fld("", S("Title", "العنوان"), inp("qa", "")) + fld("", S("Due", "الموعد النهائي") + OPT(), inp("qb", "", "date")) + pfield(),
    commit: () => fld("", S("Who promised?", "مين وعد؟"), '<div class="qfch" id="qo"><button type="button" data-o="me" class="on">' + S("I promised", "أنا وعدت") + '</button><button type="button" data-o="them">' + S("They promised me", "هو وعدني") + "</button></div>") + fld("", S("What", "شو الوعد"), inp("qa", "")) + pfield() + fld("", S("Due", "الموعد") + OPT(), inp("qb", "", "date")),
    person: () => fld("", S("Name", "الاسم"), inp("qa", "")) + fld("", S("Relationship", "العلاقة") + OPT(), inp("qb", S("friend, client…", "صديق، عميل…"))) + fld("", S("Profession", "المهنة") + OPT(), inp("qc", "")),
    memory: () => fld("", S("Type", "النوع"), '<div class="qfch" id="qo">' + ["Note", "Decision", "Idea", "Discussion", "Preference / habit", "Important date"].map((t, i) => '<button type="button" data-o="' + E(t) + '"' + (i === 0 ? ' class="on"' : "") + ">" + E(typeof tType === "function" ? tType(t) : t) + "</button>").join("") + "</div>") + fld("", S("Text", "النص"), '<textarea id="qa" dir="auto" rows="3" style="width:100%;font-size:16px;box-sizing:border-box"></textarea>') + pfield(),
    goal: () => fld("", S("Title", "العنوان"), inp("qa", "")) + fld("", S("Due", "الموعد") + OPT(), inp("qb", "", "date")),
    alarm: () => fld("", S("Time", "الوقت"), inp("qc", "", "time", nextHour().t)) + fld("", S("Label", "الاسم") + OPT(), inp("qa", "")) + fld("", S("Repeat", "التكرار") + S(" (none = once)", " (بدون = مرة وحدة)"), '<div class="qfch" id="qdays">' + (A() ? ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).map((n, i) => '<button type="button" data-d="' + i + '">' + n + "</button>").join("") + "</div>") + '<div class="m" style="margin-top:8px;font-size:12px;opacity:.75">' + S("Default sound and snooze. It rings only while Mindly is open on screen.", "صوت وغفوة افتراضية. بيرن فقط والتطبيق مفتوح على الشاشة.") + '</div><div class="m" style="margin-top:6px"><button type="button" class="btn" id="qfalarm">' + S("Advanced options (full alarm screen)", "خيارات متقدمة (شاشة المنبّه الكاملة)") + "</button></div>",
    remind: () => fld("", S("Remind me to…", "ذكرني بـ…"), inp("qa", "")) + fld("", S("When", "متى"), inp("qb", "", "datetime-local", nextHour().dt))
  };
  function saveForm(k, q) {
    const v = id => { const e = q("#" + id); return e ? (e.value || "").trim() : ""; };
    const own = (q("#qo .on") || {}).dataset; const o = own && own.o;
    const a = v("qa"), b = v("qb"), c = v("qc"), d = v("qd"), pn = v("qp");
    if (k === "alarm") {
      if (!c) return { err: S("Pick a time.", "اختر وقت.") }; if (!(window.MindlyAlarm && MindlyAlarm.quickAdd)) return { err: S("Alarms are unavailable.", "المنبّه غير متاح.") };
      const t = c.split(":"), days = [...document.querySelectorAll("#qdays .on")].map(x => +x.dataset.d); let dk = null, when = "";
      if (!days.length) { const n = new Date(), tg = new Date(n.getFullYear(), n.getMonth(), n.getDate(), +t[0], +t[1]); if (tg.getTime() <= Date.now() + 5000) tg.setDate(tg.getDate() + 1); dk = tg.getFullYear() + "-" + String(tg.getMonth() + 1).padStart(2, "0") + "-" + String(tg.getDate()).padStart(2, "0"); when = (dk === today() ? S("today", "اليوم") : S("tomorrow", "بكرة")); } else when = S("repeating", "متكرر");
      MindlyAlarm.quickAdd(a, +t[0], +t[1], days, dk); return { ok: S("Alarm ", "منبّه ") + c + " " + when };
    }
    if (!a) return { err: S("Fill in the first field.", "عبّي الحقل الأول.") };
    if (k === "event" && !b) return { err: S("Pick a date.", "اختر تاريخ.") };
    if (k === "remind") { if (!b) return { err: S("Pick a time.", "اختر وقت.") }; if (!(new Date(b).getTime() > Date.now())) return { err: S("Pick a time in the future.", "اختر وقت بالمستقبل.") }; }
    if (k === "person" && DB.people.some(x => nk(x.name) === nk(a))) return { err: S("This person already exists.", "هذا الشخص موجود.") };
    if (DB.settings.paused) return { err: S("Memory is paused. Nothing was saved.", "الذاكرة متوقفة. ما انحفظ شي.") };
    const kl = TYPES().find(t => t.k === k).l; const text = kl + ": " + a + (b ? " · " + b : "") + (pn ? " · " + pn : "");
    const inpR = { id: uid("in"), text, ts: Date.now(), source: "quick-form" }; DB.inputs.push(inpR);
    const p = k === "person" ? null : personByName(pn, true, inpR.id); const created = [];
    if (p && !created.some(x => x.id === p.id) && p.srcs && p.srcs[0] === inpR.id) created.push({ t: "people", id: p.id });
    let rec;
    if (k === "event") { rec = { id: uid("e"), title: a, personId: p ? p.id : null, date: b, time: c, inputId: inpR.id }; if (d) rec.place = d; DB.events.push(rec); created.push({ t: "events", id: rec.id }); }
    else if (k === "task") { rec = { id: uid("t"), title: a, personId: p ? p.id : null, due: b || null, status: "open", kind: "confirmed", inputId: inpR.id, commitmentId: null, created: Date.now() }; DB.tasks.push(rec); created.push({ t: "tasks", id: rec.id }); }
    else if (k === "commit") { const ow = o === "them" ? "them" : "me"; rec = { id: uid("c"), title: a, personId: p ? p.id : null, personName: p ? p.name : pn, owner: ow, due: b || null, status: ow === "them" ? "waiting" : "pending", kind: "confirmed", inputId: inpR.id, interactionId: null, created: Date.now() }; DB.commitments.push(rec); created.push({ t: "commitments", id: rec.id }); }
    else if (k === "person") { rec = { id: uid("p"), name: a, relation: b, profession: c, comm: "", project: "", interests: [], dates: [], extra: {}, created: Date.now(), srcs: [inpR.id] }; DB.people.push(rec); created.push({ t: "people", id: rec.id }); }
    else if (k === "memory") { rec = { id: uid("m"), type: o || "Note", text: a, kind: "confirmed", personId: p ? p.id : null, projectId: null, date: today(), important: false, inputId: inpR.id, created: Date.now() }; DB.memories.push(rec); created.push({ t: "memories", id: rec.id }); }
    else if (k === "goal") { if (!Array.isArray(DB.goals)) DB.goals = []; rec = { id: uid("g"), title: a, due: b || "", progress: 0, done: false, created: Date.now() }; DB.goals.push(rec); }
    else if (k === "remind") { const at = new Date(b).getTime(); if (typeof addReminder === "function") addReminder(a, at); else { DB.reminders = DB.reminders || []; DB.reminders.push({ id: "r" + Date.now().toString(36), text: a.slice(0, 120), at }); } }
    DB.lastCreated = created; save(); try { render(); } catch (e) {}
    return { ok: kl };
  }
  const prev = window.quickCapture;
  if (typeof prev !== "function") return;
  window.quickCapture = quickCapture = function () {
    prev.apply(this, arguments);
    if (foff()) return;
    try {
      const sh = document.querySelector("#dlg .sheet"); if (!sh) return; const head = sh.querySelector(".shead");
      const note = document.createElement("div"); note.id = "qfnote"; note.style.display = "none";
      [...sh.children].forEach(ch => { if (ch !== head) note.appendChild(ch); }); sh.appendChild(note);
      const area = document.createElement("div"); area.id = "qfarea"; sh.appendChild(area);
      const q = s => area.querySelector(s); let msg = "";
      const picker = () => { note.style.display = "none"; area.innerHTML = '<div class="m"><b>' + S("What do you want to record?", "شو بدك تسجّل؟") + '</b></div><div class="qfg">' + TYPES().map(t => '<button type="button" class="qft' + (t.k === "note" ? " n" : "") + '" data-t="' + t.k + '"><b>' + t.ic + "</b>" + E(t.l) + "</button>").join("") + '</div><div class="m" id="qfmsg" style="margin-top:10px">' + E(msg) + '</div><div class="m" style="text-align:center;font-size:11px;opacity:.5;margin-top:6px">build v82</div>'; msg = ""; area.querySelectorAll("[data-t]").forEach(b => b.onclick = () => open(b.dataset.t)); };
      const back = () => '<div class="m" style="margin-bottom:6px"><button type="button" class="btn" id="qfback">‹ ' + S("Back", "رجوع") + "</button></div>";
      const open = k => {
        if (k === "note") { area.innerHTML = back(); note.style.display = ""; area.querySelector("#qfback").onclick = picker; setTimeout(() => { const t = document.querySelector("#qct"); t && t.focus(); }, 50); return; }
        const kl = TYPES().find(t => t.k === k).l;
        area.innerHTML = '<div class="qff">' + back() + '<div class="m"><b>' + E(kl) + "</b></div>" + FORMS[k]() + '<div class="acts qfs" style="margin-top:12px"><button class="btn p" id="qfsave" type="button">' + S("Save", "حفظ") + '</button></div><div class="m" id="qfe" style="margin-top:8px;color:var(--warn)"></div></div>';
        area.querySelector("#qfback").onclick = picker;
        area.querySelectorAll(".qfw").forEach(w => { const i = w.querySelector("input"), f = () => w.classList.toggle("has", !!i.value); i.addEventListener("input", f); i.addEventListener("change", f); f(); });
        area.querySelectorAll("#qdays button").forEach(b => b.onclick = () => b.classList.toggle("on"));
        const al = q("#qfalarm"); if (al) al.onclick = () => { try { closeSheet(); } catch (e) {} MindlyAlarm && MindlyAlarm.open(); };
        area.querySelectorAll("#qo button").forEach(b => b.onclick = () => { area.querySelectorAll("#qo button").forEach(x => x.classList.remove("on")); b.classList.add("on"); });
        q("#qfsave").onclick = () => { const r = saveForm(k, q); if (r.err) { q("#qfe").textContent = r.err; return; } msg = S("Saved ✓ ", "انحفظ ✓ ") + r.ok; picker(); };
        setTimeout(() => { const f = q("#qa"); f && f.focus(); }, 60);
      };
      picker();
    } catch (e) { /* on any failure the v79 box stays visible */ try { const n = document.querySelector("#qfnote"); if (n) { n.style.display = ""; } } catch (e2) {} }
  };
  /* app.js bound the + button with `b.onclick = quickCapture` (the original function), so rebind it to the wrapper. */
  const rebind = () => { try { const b = document.getElementById("qcBtn"); if (b) b.onclick = window.quickCapture; } catch (e) {} };
  rebind(); setTimeout(rebind, 500); setTimeout(rebind, 3000);
  window.MINDLY_BUILD = "v82";
  window.MindlyQuickForms = { off: foff, saveForm };
})();
