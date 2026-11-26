/* Mindly module: Memory Control Center (Phase 1). Browse, edit and delete everything Mindly stored.
   Local only. Edits change only the main text/date fields. Deleting a person is relation-aware and every delete
   can be undone for 7 days (full record snapshot in localStorage "mindly.delundo"). Loaded after app.js. */
(function () {
  "use strict";
  if (window.MindlyControl) return;

  const COLS = [
    { k: "people", en: "People", ar: "الأشخاص", f: "name", date: false },
    { k: "commitments", en: "Commitments", ar: "الالتزامات", f: "title", date: false, status: true },
    { k: "tasks", en: "Tasks", ar: "المهام", f: "title", date: false, status: true },
    { k: "events", en: "Events", ar: "المواعيد", f: "title", date: true },
    { k: "memories", en: "Memories", ar: "الذكريات", f: "text", date: true },
    { k: "notes", en: "Notes", ar: "الملاحظات", f: "title", date: false },
    { k: "inputs", en: "Captures", ar: "الملتقطات", f: "text", date: false, readonly: true }
  ];
  const LINKED = ["commitments", "tasks", "events", "memories", "interactions", "notes"];
  const UNDO = "mindly.delundo";
  let cur = "people";
  const col = k => COLS.find(c => c.k === k);
  const label = c => S(c.en, c.ar);
  const mainOf = (c, r) => String(r[c.f] || r.text || r.title || r.summary || r.name || "");
  const clone = o => JSON.parse(JSON.stringify(o));

  function undoInfo() { try { const u = JSON.parse(localStorage.getItem(UNDO) || "null"); return u && Date.now() - u.at < 7 * 864e5 ? u : null; } catch (e) { return null; } }

  function deleteRecord(kind, id, mode) {   /* mode for people: "keep" (unlink items) or "all" (delete linked items) */
    const arr = DB[kind]; if (!Array.isArray(arr)) return false;
    const rec = arr.find(x => x.id === id); if (!rec) return false;
    const snap = { at: Date.now(), kind, rec: clone(rec), unlinked: [], removed: [], idx: arr.indexOf(rec) };
    if (kind === "people") {
      for (const k of LINKED) for (const r of (DB[k] || [])) if (r.personId === id) {
        if (mode === "all") snap.removed.push({ k, rec: clone(r) });
        else snap.unlinked.push({ k, id: r.id, pid: r.personId, pn: r.personName });
      }
      if (mode === "all") for (const x of snap.removed) DB[x.k] = DB[x.k].filter(r => r.id !== x.rec.id);
      else for (const x of snap.unlinked) { const r = DB[x.k].find(z => z.id === x.id); if (r) { r.personId = null; if (r.personName) r.personName = ""; } }
    }
    DB[kind] = DB[kind].filter(x => x.id !== id);
    try { localStorage.setItem(UNDO, JSON.stringify(snap)); } catch (e) { /* undo unavailable, delete still done by user's explicit choice */ }
    save(); return true;
  }

  function undoDelete() {
    const u = undoInfo(); if (!u) return false;
    if ((DB[u.kind] || []).some(x => x.id === u.rec.id)) return false;
    const arr = DB[u.kind]; if (!Array.isArray(arr)) return false;
    arr.splice(Math.min(u.idx || arr.length, arr.length), 0, u.rec);
    for (const x of (u.removed || [])) if (Array.isArray(DB[x.k]) && !DB[x.k].some(r => r.id === x.rec.id)) DB[x.k].push(x.rec);
    for (const x of (u.unlinked || [])) { const r = (DB[x.k] || []).find(z => z.id === x.id); if (r) { r.personId = x.pid; if (x.pn !== undefined) r.personName = x.pn; } }
    localStorage.removeItem(UNDO); save(); return true;
  }

  function listHTML() {
    const c = col(cur), arr = DB[c.k] || [];
    if (!arr.length) return '<div class="m" style="margin-top:12px">' + S("Nothing stored here.", "ما في شي محفوظ هنا.") + "</div>";
    return arr.slice().reverse().map(r => '<div class="card" data-mc="' + esc(c.k) + "|" + esc(r.id) + '" style="cursor:pointer"><div class="t" dir="auto">' + esc(mainOf(c, r).slice(0, 140)) + '</div><div class="m">' + esc([r.status || "", r.date || r.due || "", r.type || ""].filter(Boolean).join(" · ")) + "</div></div>").join("");
  }

  function open() {
    const u = undoInfo();
    const undo = u ? '<div class="card"><div class="t">' + S("Deleted: ", "انحذف: ") + esc(mainOf(col(u.kind) || { f: "text" }, u.rec).slice(0, 60)) + '</div><div class="acts"><button class="btn" id="mcundo">' + S("Undo delete", "تراجع عن الحذف") + "</button></div></div>" : "";
    const tabs = COLS.map(c => '<button class="btn' + (cur === c.k ? " p" : "") + '" data-mck="' + c.k + '" style="padding:6px 12px;font-size:13px">' + esc(label(c)) + " " + (DB[c.k] || []).length + "</button>").join("");
    sheet('<h3 style="margin:0 0 6px">' + S("Memory control", "التحكم بالذاكرة") + '</h3><div class="m">' + S("Everything Mindly stored is here. You can edit or delete any item. Deletes can be undone for 7 days.", "كل شي خزّنه Mindly هنا. بتقدر تعدّل أو تحذف أي عنصر. الحذف بتقدر تتراجع عنه 7 أيام.") + "</div>" + undo +
      '<div class="acts" style="flex-wrap:wrap;margin-top:8px">' + tabs + '</div><div id="mcbody">' + listHTML() + "</div>", () => {
      document.querySelectorAll("[data-mck]").forEach(b => b.onclick = () => { cur = b.dataset.mck; open(); });
      document.querySelectorAll("[data-mc]").forEach(c => c.onclick = () => { const [k, id] = c.dataset.mc.split("|"); edit(k, id); });
      const ub = $("#mcundo"); if (ub) ub.onclick = () => { toast(undoDelete() ? S("Restored.", "تم الاسترجاع.") : S("Couldn’t undo.", "ما قدرت أتراجع.")); open(); try { render(); } catch (e) {} };
    });
  }

  function counts(id) { const n = {}; for (const k of LINKED) { const c = (DB[k] || []).filter(r => r.personId === id).length; if (c) n[k] = c; } return n; }

  function edit(kind, id) {
    const c = col(kind), r = (DB[kind] || []).find(x => x.id === id); if (!r) return;
    const val = mainOf(c, r);
    sheet('<h3 style="margin:0 0 6px">' + esc(label(c)) + "</h3>" +
      (c.readonly ? '<div class="t" dir="auto">' + esc(val) + '</div><div class="m">' + S("Original captures can be deleted but not edited.", "الملتقطات الأصلية بتنحذف بس ما بتتعدّل.") + "</div>" : '<textarea id="mce" dir="auto" rows="4" style="width:100%;box-sizing:border-box">' + esc(val) + "</textarea>") +
      (c.date && !c.readonly ? '<div class="m" style="margin-top:8px">' + S("Date", "التاريخ") + '</div><input id="mcd" type="date" value="' + esc(r.date || "") + '">' : "") +
      (c.status ? '<div class="m" style="margin-top:8px">' + S("Status", "الحالة") + '</div><select id="mcs">' + ["open", "pending", "waiting", "done"].map(s => '<option value="' + s + '"' + (r.status === s ? " selected" : "") + ">" + s + "</option>").join("") + "</select>" : "") +
      '<div class="acts" style="margin-top:14px">' + (c.readonly ? "" : '<button class="btn p" id="mcsave">' + S("Save", "حفظ") + "</button>") + '<button class="btn" id="mcdel" style="color:#ff6b6b">' + S("Delete", "حذف") + '</button><button class="btn" id="mcback">' + S("Back", "رجوع") + "</button></div>", () => {
      $("#mcback").onclick = open;
      const sv = $("#mcsave"); if (sv) sv.onclick = () => {
        const t = $("#mce").value.trim(); if (!t) { toast(S("Text can’t be empty.", "النص ما بيصير فاضي.")); return; }
        r[c.f] = t; const d = $("#mcd"); if (d && d.value) r.date = d.value; const s = $("#mcs"); if (s) r.status = s.value;
        save(); toast(S("Saved.", "انحفظ.")); open(); try { render(); } catch (e) {}
      };
      $("#mcdel").onclick = () => {
        if (kind === "people") { personDelete(r); return; }
        if (!confirm(S("Delete this item? You can undo for 7 days.", "تحذف هذا العنصر؟ بتقدر تتراجع 7 أيام."))) return;
        deleteRecord(kind, id); toast(S("Deleted. Undo is in Memory control.", "انحذف. التراجع من التحكم بالذاكرة.")); open(); try { render(); } catch (e) {}
      };
    });
  }

  function personDelete(p) {
    const n = counts(p.id), tot = Object.values(n).reduce((a, b) => a + b, 0);
    const lines = Object.keys(n).map(k => n[k] + " " + label(col(k) || { en: k, ar: k })).join(", ");
    sheet('<h3 style="margin:0 0 6px">' + S("Delete “", "حذف «") + esc(p.name) + S("”?", "»؟") + '</h3><div class="m">' + (tot ? S("Linked items: ", "عناصر مرتبطة: ") + esc(lines) + "." : S("No linked items.", "ما في عناصر مرتبطة.")) + "</div>" +
      '<div class="acts" style="margin-top:14px;flex-wrap:wrap"><button class="btn p" id="pdk">' + S("Delete person, keep items", "احذف الشخص وخلّي العناصر") + "</button>" + (tot ? '<button class="btn" id="pda" style="color:#ff6b6b">' + S("Delete person and linked items", "احذف الشخص والعناصر المرتبطة") + "</button>" : "") + '<button class="btn" id="pdc">' + S("Cancel", "إلغاء") + "</button></div>" +
      '<div class="m" style="margin-top:8px">' + S("Either way you can undo for 7 days.", "بالحالتين بتقدر تتراجع 7 أيام.") + "</div>", () => {
      const done = m => { deleteRecord("people", p.id, m); toast(S("Deleted. Undo is in Memory control.", "انحذف. التراجع من التحكم بالذاكرة.")); try { openPerson = null; } catch (e) {} open(); try { render(); } catch (e) {} };
      $("#pdk").onclick = () => done("keep"); const a = $("#pda"); if (a) a.onclick = () => done("all"); $("#pdc").onclick = () => edit("people", p.id);
    });
  }

  /* entry points: Memory tab button + a button inside the first Settings section */
  if (typeof vMem === "function") { const _vm = vMem; vMem = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-mcc="1">' + S("Manage memory", "إدارة الذاكرة") + "</button></div>" + _vm(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-mcc]"); if (b) { e.preventDefault(); open(); } });
  window.MindlyControl = { open, deleteRecord, undoDelete };
})();
