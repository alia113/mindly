/* Mindly module: assist + settings extras (Phase 4 non-voice, Phase 5, Phase 2 check-ins).
   1. Typed-capture review: ambiguous "me" commitments are held back and the user is asked before they are created. Also offers a reminder for dated promises.
      Skipped while a voice session is active (voice code untouched). Off if DB.settings.askAmbiguous === false.
   2. Completion check-in card on Home: one past-due follow-up per day, Done / Tomorrow / Not yet.
   3. Settings: "More" section (Home cards toggle, shortcuts), Integrations status screen (read-only), short in-app Guide.
   Writes only through existing records and the normal save(). No new connections. */
(function () {
  "use strict";
  if (window.MindlyMore) return;
  const DAY = 864e5, nz = s => String(s || "").toLowerCase().trim();
  const voiceOn = () => { try { return typeof V !== "undefined" && V && V.active; } catch (e) { return false; } };

  /* 1. Typed-capture review */
  function addHeld(c, strength, inputId) {
    const k = nz(c.person), p = k ? DB.people.find(x => nz(x.name) === k || nz(String(x.name).split(" ")[0]) === k) : null;
    const rec = { id: uid("c"), title: c.title, personId: p ? p.id : null, personName: c.person || "", owner: c.owner, due: c.due, status: c.status, kind: c.kind, inputId: inputId || null, created: Date.now(), strength };
    DB.commitments.push(rec); save(); return rec;
  }
  function addReminder(c) {
    const R = S("Reminder: ", "تذكير: ");
    if (DB.tasks.some(t => t.status !== "done" && t.title === R + c.title)) return false;
    DB.tasks.push({ id: uid("t"), title: R + c.title, personId: c.personId || null, due: c.due, status: "open", kind: "suggestion", inputId: c.inputId, created: Date.now(), approved: true }); save(); return true;
  }
  function review(held, created, inputId) {
    const rem = (created || []).filter(c => c.owner === "me" && c.due && !DB.tasks.some(t => t.status !== "done" && t.title === S("Reminder: ", "تذكير: ") + c.title));
    if (!held.length && !rem.length) return;
    let h = '<h3 style="margin:0 0 6px">' + S("Before I save", "قبل ما احفظ") + '</h3><div class="m" style="margin-bottom:6px">' + S("Nothing below is saved until you tap. Skip keeps only your original note.", "ما بنحفظ شي من هون إلا لما تضغط. تخطي بيخلي الملاحظة الأصلية بس.") + "</div>";
    held.forEach((c, i) => { h += '<div class="card"><div class="t" dir="auto">' + esc(c.title) + '</div><div class="m">' + S("Is this a promise, or just an intention?", "هذا وعد ولا بس نية؟") + '</div><div class="acts"><button class="btn p" data-ap="' + i + '">' + S("Promise", "وعد") + '</button><button class="btn" data-ai="' + i + '">' + S("Intention", "نية") + '</button><button class="btn" data-as="' + i + '">' + S("Skip", "تخطي") + "</button></div></div>"; });
    rem.forEach((c, i) => { h += '<div class="card"><div class="t" dir="auto">' + esc(c.title) + '</div><div class="m">' + S("Add a reminder task for ", "ضيف مهمة تذكير لـ ") + esc(fmtDate(c.due)) + '?</div><div class="acts"><button class="btn p" data-ar="' + i + '">' + S("Add reminder", "ضيف تذكير") + "</button></div></div>"; });
    sheet(h, () => {
      const done = (b, msg) => { const card = b.closest(".card"); if (card) card.remove(); if (msg) toast(msg); if (!document.querySelector("#dlg [data-ap],#dlg [data-ar]")) { try { closeSheet(); render(); } catch (e) {} } };
      document.querySelectorAll("[data-ap]").forEach(b => b.onclick = () => { addHeld(held[+b.dataset.ap], "promise", inputId); done(b, S("Saved as a promise.", "انحفظ كوعد.")); });
      document.querySelectorAll("[data-ai]").forEach(b => b.onclick = () => { addHeld(held[+b.dataset.ai], "intention", inputId); done(b, S("Saved as an intention.", "انحفظ كنية.")); });
      document.querySelectorAll("[data-as]").forEach(b => b.onclick = () => done(b, S("Skipped.", "تم التخطي.")));
      document.querySelectorAll("[data-ar]").forEach(b => b.onclick = () => { addReminder(rem[+b.dataset.ar]); done(b, S("Reminder added.", "انضاف تذكير.")); });
    });
  }
  if (typeof applyExtraction === "function") {
    const _ae = applyExtraction;
    applyExtraction = function (text, ex, source, reuse) {
      let held = [];
      try {
        if (!voiceOn() && ex && Array.isArray(ex.commitments) && window.MindlyFollow && !(DB.settings && DB.settings.askAmbiguous === false)) {
          const keep = [];
          for (const c of ex.commitments) { if (c.owner !== "me" || MindlyFollow.classify({ title: c.title, due: c.due }) === "promise") keep.push(c); else held.push(c); }
          if (held.length) ex = Object.assign({}, ex, { commitments: keep });
        }
      } catch (e) { held = []; }
      const r = _ae.call(this, text, ex, source, reuse);
      try { if (!voiceOn()) { const nc = (r && r.newCommit) || []; if (held.length || nc.some(c => c.owner === "me" && c.due)) { const go = () => review(held, nc, r && r.inputId); if (source === "quick") { let n = 0; const iv = setInterval(() => { if (!document.querySelector("#qct") || ++n > 600) { clearInterval(iv); go(); } }, 1000); } else setTimeout(go, 350); } } } catch (e) {}
      return r;
    };
  }

  /* 2. Completion check-in */
  const CK = "mindly.checkin";
  const seen = () => { try { return JSON.parse(localStorage.getItem(CK) || "{}"); } catch (e) { return {}; } };
  function pickCheckin() {
    const t = today(), s = seen();
    return (DB.commitments || []).filter(c => c.owner === "me" && (c.status === "pending" || c.status === "waiting") && !c.dupOf && c.due && c.due < t && s[c.id] !== t).sort((a, b) => a.due.localeCompare(b.due))[0] || null;
  }
  function checkinCard() {
    const c = pickCheckin(); if (!c) return "";
    return '<div class="card" style="border-color:#6aa9ff"><div class="m">' + S("Quick check-in", "سؤال سريع") + '</div><div class="t" dir="auto">' + S("Did you finish: ", "خلصت: ") + esc(c.title) + '?</div><div class="acts"><button class="btn p" data-cki="' + esc(c.id) + ':done">' + S("Done", "خلصت") + '</button><button class="btn" data-cki="' + esc(c.id) + ':tomorrow">' + S("Tomorrow", "بكرة") + '</button><button class="btn" data-cki="' + esc(c.id) + ':not">' + S("Not yet", "لسا") + "</button></div></div>";
  }
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-cki]"); if (!b) return; e.preventDefault();
    const i = b.dataset.cki.lastIndexOf(":"), id = b.dataset.cki.slice(0, i), act = b.dataset.cki.slice(i + 1), c = byId(DB.commitments, id); if (!c) return;
    const s = seen(); s[id] = today(); try { localStorage.setItem(CK, JSON.stringify(s)); } catch (x) {}
    if (act === "done") { c.status = "done"; c.doneAt = Date.now(); save(); toast(S("Marked done.", "تم الإنجاز.")); }
    else if (act === "tomorrow") { c.due = iso(Date.now() + DAY); save(); toast(S("Moved to tomorrow.", "انتقلت لبكرة.")); }
    try { render(); } catch (x) {}
  });
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { let c = ""; try { c = checkinCard(); } catch (e) {} return c + _vh(); }; }


  /* Local check-in notification: shown only when the app is opened or comes to the foreground, once per day, only if the user allowed notifications.
     No background or push delivery exists, so nothing fires while the app is closed. */
  async function notifyCheckin() {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const t = today(); if (localStorage.getItem("mindly.cknotif") === t) return;
      const c = pickCheckin(); if (!c) return;
      localStorage.setItem("mindly.cknotif", t);
      const title = S("Mindly check-in", "سؤال من Mindly"), body = S("Did you finish: ", "خلصت: ") + c.title + "?";
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) reg.showNotification(title, { body, tag: "mindly-checkin" }); else new Notification(title, { body, tag: "mindly-checkin" });
    } catch (e) {}
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) notifyCheckin(); });
  setTimeout(notifyCheckin, 2500);

  /* 3. Integrations (read-only status) and Guide */
  function integrations() {
    let host = "-"; try { host = new URL(AI_URL).host; } catch (e) {}
    const sync = (() => { try { const on = !!syncCode(), ok = +localStorage.getItem("mindly.syncok"); return on ? S("On", "شغال") + (ok ? " · " + S("last success ", "آخر نجاح ") + new Date(ok).toLocaleString(A() ? "ar" : "en") : "") : S("Off", "مطفي"); } catch (e) { return "-"; } })();
    const notif = typeof Notification === "undefined" ? S("Not supported", "غير مدعوم") : ({ granted: S("Allowed", "مسموح"), denied: S("Blocked", "محظور"), default: S("Not asked", "ما انسأل") }[Notification.permission] || Notification.permission);
    const inst = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone ? S("Installed on Home Screen", "مثبّت على الشاشة الرئيسية") : S("Running in the browser", "شغال بالمتصفح");
    let kb = 0; try { for (const k in localStorage) if (Object.prototype.hasOwnProperty.call(localStorage, k)) kb += (localStorage[k].length + k.length) * 2; kb = Math.round(kb / 1024); } catch (e) {}
    const aiOn = !(DB.settings.noAI || DB.settings.paused);
    const row = (a, b) => '<div class="card"><div class="t">' + a + '</div><div class="m" dir="auto">' + b + "</div></div>";
    sheet('<h3 style="margin:0 0 6px">' + S("Connections", "الاتصالات") + '</h3><div class="m" style="margin-bottom:6px">' + S("Status only. Nothing here connects a new service.", "للعرض بس. ما في شي هون بيربط خدمة جديدة.") + "</div>" +
      row(S("Cloud AI", "الذكاء السحابي"), (aiOn ? S("On", "شغال") : S("Off (paused or disabled in settings)", "مطفي (موقوف أو معطّل بالإعدادات)")) + " · " + esc(host)) +
      row(S("Encrypted sync", "المزامنة المشفرة"), sync) +
      row(S("Calendar", "التقويم"), S("Local events only. No Google Calendar connected.", "مواعيد محلية بس. ما في ربط مع Google Calendar.")) +
      row(S("Notifications", "الإشعارات"), notif + (typeof Notification !== "undefined" && Notification.permission === "default" ? '<div class="acts"><button class="btn" id="mnot">' + S("Allow check-in notifications", "اسمح بإشعارات المتابعة") + "</button></div>" : "") + '<div class="m">' + S("Shown only when the app is opened. Nothing is delivered while it is closed.", "بتظهر بس لما تفتح التطبيق. ما في إشعارات والتطبيق مسكّر.") + "</div>") + row(S("Install", "التثبيت"), inst) + row(S("Local storage used", "المساحة المحلية المستخدمة"), kb + " KB"), () => { const b = document.querySelector("#mnot"); if (b) b.onclick = async () => { try { await Notification.requestPermission(); } catch (e) {} integrations(); }; });
  }
  function guide() {
    const L = [
      ["Capture", "التقاط", "Tap the mic or type in Quick capture. Say or write what happened: “I met Sara, she will send the deck Friday.” Mindly saves only what you said.", "اضغط المايك أو اكتب بالالتقاط السريع. احكي شو صار: «قابلت سارة وبدها تبعتلي العرض الجمعة». Mindly بيحفظ اللي قلته بس."],
      ["Ask", "اسأل", "Ask in plain words: “What did Sara promise?” Answers come only from what you saved, with sources.", "اسأل بكلام عادي: «شو وعدتني سارة؟». الأجوبة من المحفوظ بس مع المصادر."],
      ["Follow-ups", "المتابعات", "Open Follow-ups on Home. Mark done, postpone, or ask for clarification. Mindly asks before saving anything unclear.", "افتح المتابعات من الرئيسية. أنجز، أجّل، أو اطلب توضيح. Mindly بيسألك قبل ما يحفظ شي مش واضح."],
      ["Your control", "تحكمك", "Memory control lets you edit or delete anything, and undo a delete for 7 days. Privacy Center shows what is stored and what AI may remember.", "التحكم بالذاكرة بيخليك تعدّل أو تحذف أي شي وتتراجع 7 أيام. مركز الخصوصية بيوريك شو محفوظ وشو مسموح للذكاء يتذكر."],
      ["Sync and backup", "المزامنة والنسخ", "Sync is encrypted on your device before it leaves. Export a backup file from Settings any time.", "المزامنة بتتشفر على جهازك قبل ما تطلع. فيك تصدّر نسخة احتياطية من الإعدادات بأي وقت."]
    ];
    sheet('<h3 style="margin:0 0 6px">' + S("Guide", "الدليل") + "</h3>" + L.map(x => '<div class="card"><div class="t">' + S(x[0], x[1]) + '</div><div class="m" dir="auto">' + S(x[2], x[3]) + "</div></div>").join(""), () => {});
  }
  const SHORT = [["MindlyPrivacy", "Privacy Center", "مركز الخصوصية"], ["MindlyControl", "Memory control", "التحكم بالذاكرة"], ["MindlyActivity", "Activity", "النشاط"], ["MindlyInbox", "Inbox", "الوارد"], ["MindlyFollow", "Follow-ups", "المتابعات"]];
  function moreSection() {
    const hidden = DB.settings && DB.settings.widgets === false, ask = !(DB.settings && DB.settings.askAmbiguous === false);
    const d = document.createElement("div");
    d.innerHTML = '<div class="sec"><h2>' + S("More", "المزيد") + '</h2></div><div class="card"><label class="row" style="gap:8px;align-items:center"><input type="checkbox" id="mw"' + (hidden ? "" : " checked") + '><span>' + S("Show cards on Home", "اعرض البطاقات بالرئيسية") + '</span></label><label class="row" style="gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="ma"' + (ask ? " checked" : "") + '><span>' + S("Ask me before saving unclear promises (typed notes)", "اسألني قبل حفظ وعود مش واضحة (الملاحظات المكتوبة)") + '</span></label></div><div class="acts" style="flex-wrap:wrap">' +
      SHORT.filter(x => window[x[0]] && window[x[0]].open).map(x => '<button class="btn" data-mo="' + x[0] + '">' + S(x[1], x[2]) + "</button>").join("") + '<button class="btn" data-mo="_int">' + S("Connections", "الاتصالات") + '</button><button class="btn" data-mo="_guide">' + S("Guide", "الدليل") + "</button></div>";
    return d;
  }
  if (typeof settingsSheet === "function") {
    const _ss = settingsSheet;
    settingsSheet = function () {
      _ss.apply(this, arguments);
      try {
        const dlg = document.querySelector("#dlg"), sh = dlg && dlg.querySelector(".sheet"); if (!sh || sh.querySelector("#mw")) return;
        const m = moreSection(), foot = [...sh.children].find(x => /Build v/.test(x.textContent || "")); sh.insertBefore(m, foot || null);
        sh.querySelector("#mw").onchange = e => { DB.settings.widgets = e.target.checked; save(); try { render(); } catch (x) {} };
        sh.querySelector("#ma").onchange = e => { DB.settings.askAmbiguous = e.target.checked; save(); };
        sh.querySelectorAll("[data-mo]").forEach(b => b.onclick = () => { const n = b.dataset.mo; if (n === "_int") integrations(); else if (n === "_guide") guide(); else window[n].open(); });
      } catch (e) {}
    };
    try { const a = document.querySelector("#setBtn"), b = document.querySelector("#vset"); if (a) a.onclick = settingsSheet; if (b) b.onclick = settingsSheet; } catch (e) {}
  }
  try { render(); } catch (e) {}
  window.MindlyMore = { review, integrations, guide, pickCheckin };
})();
