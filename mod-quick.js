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
