/* Mindly module: Privacy Center (Phase 5). Plain-language statement of where data lives and goes, live counts, and the two existing switches (pause saving, turn AI off). Never deletes anything. */
(function () {
  "use strict";
  if (window.MindlyPrivacy) return;
  const row = (t, m) => '<div class="card"><div class="t" dir="auto">' + esc(t) + "</div>" + (m ? '<div class="m" dir="auto">' + esc(m) + "</div>" : "") + "</div>";
  function sw(id, label, on) { return '<div class="card" style="display:flex;align-items:center;gap:10px"><div class="t" style="flex:1" dir="auto">' + esc(label) + '</div><button class="btn' + (on ? " p" : "") + '" id="' + id + '">' + (on ? S("On", "شغّال") : S("Off", "مطفي")) + "</button></div>"; }
  function open() {
    const cnt = ["people", "commitments", "tasks", "events", "memories", "notes", "interactions"].map(k => (DB[k] || []).length + " " + k).join(" · ");
    const syncOn = !!localStorage.getItem("mindly.sync") || !!(DB.settings && DB.settings.sync);
    sheet('<h3 style="margin:0 0 4px">' + S("Privacy center", "مركز الخصوصية") + "</h3>" +
      row(S("Where your data lives", "وين بياناتك"), S("Everything you save is stored on this device, in this browser. Mindly has no account system and no server copy unless you turn on sync.", "كل شي بتحفظه مخزّن على هذا الجهاز وفي هذا المتصفح. ما في حسابات ولا نسخة على سيرفر إلا إذا شغّلت المزامنة.")) +
      row(S("What you have saved", "شو محفوظ عندك"), cnt) +
      row(S("When AI is used", "متى بنستخدم الذكاء الاصطناعي"), S("To understand what you write or say, the text (or audio) is sent through Mindly's server to Google Gemini. Turn AI off below to keep everything on the device.", "لفهم اللي بتكتبه أو بتحكيه، النص (أو الصوت) بينرسل عبر سيرفر Mindly إلى Google Gemini. أطفئ الذكاء أدناه لتبقى كل البيانات على الجهاز.")) +
      row(S("Sync", "المزامنة"), (syncOn ? S("Sync looks active. ", "المزامنة شكلها شغّالة. ") : "") + S("If you use sync, your data is encrypted in this browser before upload. The server only stores the encrypted copy.", "إذا استخدمت المزامنة، البيانات بتتشفّر في المتصفح قبل الرفع. السيرفر بيخزّن النسخة المشفّرة فقط.")) +
      row(S("Limits you should know", "حدود لازم تعرفها"), S("Data on the device itself is not separately encrypted at rest. Anyone who can open this browser profile can read it.", "البيانات على الجهاز نفسه مش مشفّرة بشكل منفصل. أي شخص بيفتح هذا المتصفح بيقدر يقرأها.")) +
      sw("pvpause", S("Pause saving new memories", "إيقاف حفظ الذكريات الجديدة"), !!DB.settings.paused) + sw("pvnoai", S("Keep AI off (device only)", "إطفاء الذكاء (على الجهاز فقط)"), !!DB.settings.noAI) +
      '<div class="acts" style="margin-top:10px;flex-wrap:wrap"><button class="btn" id="pvmanage">' + S("Manage memory", "إدارة الذاكرة") + '</button><button class="btn" id="pvexp">' + S("Export backup", "تصدير نسخة احتياطية") + "</button></div>", () => {
      $("#pvpause").onclick = () => { DB.settings.paused = !DB.settings.paused; save(); open(); };
      $("#pvnoai").onclick = () => { DB.settings.noAI = !DB.settings.noAI; save(); open(); };
      $("#pvmanage").onclick = () => { if (window.MindlyControl) MindlyControl.open(); };
      $("#pvexp").onclick = () => { try { exportBackup(); } catch (e) { toast(S("Export unavailable.", "التصدير مش متاح.")); } };
    });
  }
  if (typeof vMem === "function") { const _vm = vMem; vMem = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-priv="1">' + S("Privacy center", "مركز الخصوصية") + "</button></div>" + _vm(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-priv]"); if (b) { e.preventDefault(); open(); } });
  try { render(); } catch (e) {}
  window.MindlyPrivacy = { open };
})();
