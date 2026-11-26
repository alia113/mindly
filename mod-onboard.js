/* Mindly module: first-run onboarding (Phase 5). Shown once, only when the app holds no data and onboarding was never completed. Never shown to existing users. */
(function () {
  "use strict";
  if (window.MindlyOnboard) return;
  const FLAG = "mindly.onboarded";
  const empty = () => ["people", "commitments", "tasks", "events", "memories", "notes", "inputs"].every(k => !(DB[k] || []).length);
  const need = () => !localStorage.getItem(FLAG) && !(DB.settings && DB.settings.onboarded) && empty();
  function done() { try { localStorage.setItem(FLAG, "1"); } catch (e) {} DB.settings.onboarded = true; save(); closeSheet(); }
  let step = 0;
  const steps = () => [
    [S("Tell Mindly what happens", "احكي لـ Mindly شو صار"), S("Type or speak in your own words, like “I met Sara, she prefers email” or “I promised Omar the deck by Friday”. Mindly saves the people, promises and dates.", "اكتب أو احكي بكلامك، مثل «قابلت سارة وبتفضل الإيميل» أو «وعدت عمر بالعرض يوم الجمعة». Mindly بيحفظ الناس والوعود والمواعيد.")],
    [S("Ask it later", "اسأله بعدين"), S("Ask “What did I promise Omar?” or search everything with the magnifier. Answers show which saved items they came from.", "اسأل «شو وعدت عمر؟» أو دوّر بكل شي بالعدسة. الإجابات بتبيّن من أي عناصر محفوظة جت.")],
    [S("Your data, your control", "بياناتك بإيدك"), S("Everything is stored on this device. You can pause saving, turn AI off, edit or delete anything in Memory. The Privacy center explains it in detail.", "كل شي مخزّن على هذا الجهاز. بتقدر توقّف الحفظ وتطفي الذكاء وتعدّل أو تحذف أي شي من الذاكرة. مركز الخصوصية بيشرحها بالتفصيل.")]];
  function show() {
    const st = steps(), s = st[step];
    sheet('<h3 style="margin:0 0 6px">' + S("Welcome to Mindly", "أهلاً في Mindly") + '</h3><div class="m">' + (step + 1) + " / " + st.length + '</div><div class="card"><div class="t" dir="auto">' + esc(s[0]) + '</div><div class="m" dir="auto" style="margin-top:6px">' + esc(s[1]) + '</div></div><div class="acts" style="margin-top:12px"><button class="btn p" id="obn">' + (step < st.length - 1 ? S("Next", "التالي") : S("Start", "ابدأ")) + '</button><button class="btn" id="obs">' + S("Skip", "تخطّي") + "</button></div>", () => {
      $("#obn").onclick = () => { if (step < st.length - 1) { step++; show(); } else done(); }; $("#obs").onclick = done;
    });
  }
  if (need()) setTimeout(() => { if (need()) { step = 0; show(); } }, 800);
  window.MindlyOnboard = { show: () => { step = 0; show(); }, need };
})();
