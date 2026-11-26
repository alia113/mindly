"use strict";
/* ============================================================
   DATA LAYER — relational store (contacts, interactions, notes,
   tasks, events, commitments, memories) linked by persistent ids.
   ============================================================ */
const KEY = "mindly.v1";
const uid = p => p + "_" + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
const DAY = 864e5;
const iso = d => { const x = new Date(d); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
const today = () => iso(Date.now());
const blank = () => ({
  inputs: [], people: [], interactions: [], notes: [], tasks: [], events: [], commitments: [], memories: [], projects: [],
  dismissed: {}, settings: { allow: { people: true, commitments: true, tasks: true, events: true, memories: true, preferences: true }, lang: "en", mute: false, paused: false, evening: "20:00", name: "", gender: "" }
});
let DB;
try { DB = JSON.parse(localStorage.getItem(KEY)) || blank(); } catch (e) { DB = blank(); }
{ const b = blank(); for (const k in b) if (!(k in DB)) DB[k] = b[k]; for (const k in b.settings) if (!(k in DB.settings)) DB.settings[k] = b.settings[k]; }
/* ---- Schema version + additive, reversible migration (Phase 0) ----
   Rules: only ADD missing fields, never remove/rename. A full raw copy of the stored data is written
   to "mindly.premig" BEFORE any migration runs. restoreMigrationBackup() puts it back. Unknown fields are kept. */
const SCHEMA = 2, PREMIG = "mindly.premig";
const MIGRATIONS = {
  // v1 -> v2: make sure every known collection exists and has the expected shape. Purely additive.
  2: d => { const b = blank(); for (const k in b) if (!(k in d) || (Array.isArray(b[k]) && !Array.isArray(d[k]))) d[k] = b[k]; if (!d.settings || typeof d.settings !== "object") d.settings = b.settings; for (const k in b.settings) if (!(k in d.settings)) d.settings[k] = b.settings[k]; if (!d.dismissed || typeof d.dismissed !== "object") d.dismissed = {}; return d; }
};
function migrateDB(d, raw) {
  const from = +d.v || 1;
  if (from >= SCHEMA) return { d, ran: false, from };
  try { if (raw != null) { localStorage.setItem(PREMIG, raw); localStorage.setItem(PREMIG + ".meta", JSON.stringify({ from, to: SCHEMA, at: Date.now(), n: raw.length })); } } catch (e) { return { d, ran: false, from, err: "backup-failed" }; }
  const snap = JSON.stringify(d);
  try { for (let v = from + 1; v <= SCHEMA; v++) if (MIGRATIONS[v]) d = MIGRATIONS[v](d); d.v = SCHEMA; return { d, ran: true, from }; }
  catch (e) { return { d: JSON.parse(snap), ran: false, from, err: String(e) }; }
}
function restoreMigrationBackup() { const raw = localStorage.getItem(PREMIG); if (!raw) return false; try { const d = JSON.parse(raw); if (!validDB(d)) return false; localStorage.setItem(KEY, raw); return true; } catch (e) { return false; } }
{ const raw = localStorage.getItem(KEY); const r = migrateDB(DB, raw); DB = r.d; window._mig = { from: r.from, ran: r.ran, err: r.err || "", to: DB.v || 1 }; if (r.ran) { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) {} } }
const save = () => { DB.updatedAt = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) {} if (window.syncSoon) window.syncSoon(); };
const byId = (arr, id) => arr.find(x => x.id === id);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isAr = s => /[\u0600-\u06FF]/.test(s || "");
let RESP = null;
const A = () => RESP !== null ? RESP : DB.settings.lang === "ar";
const S = (en, ar) => A() ? ar : en;
const fmtDate0 = d => { if (!d) return "no date"; const t = today(); if (d === t) return "today"; if (d === iso(Date.now() + DAY)) return "tomorrow"; if (d === iso(Date.now() - DAY)) return "yesterday"; return new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
const fmtDate = d => { if (!A()) return fmtDate0(d); if (!d) return "بدون موعد"; const t = today(); if (d === t) return "اليوم"; if (d === iso(Date.now() + DAY)) return "بكرة"; if (d === iso(Date.now() - DAY)) return "امبارح"; return new Date(d + "T12:00:00").toLocaleDateString("ar-u-nu-latn", { month: "short", day: "numeric" }); };

/* ============================================================
   EXTRACTION ENGINE — turns what the user says into linked records.
   Local, rule-based (English + Arabic / Egyptian). Everything saved
   keeps a pointer to the original input so it can be shown as source.
   ============================================================ */
const AR_DIG = "٠١٢٣٤٥٦٧٨٩";
const norm = s => s.replace(/[٠-٩]/g, c => AR_DIG.indexOf(c)).replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[\u064B-\u0652]/g, "");
const WD = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, "الاحد": 0, "الاثنين": 1, "الاتنين": 1, "الثلاثاء": 2, "التلات": 2, "الاربعاء": 3, "الخميس": 4, "الجمعه": 5, "السبت": 6 };
function nextWd(n, strictNext) { const d = new Date(); let diff = (n - d.getDay() + 7) % 7; if (diff === 0 && strictNext) diff = 7; return iso(Date.now() + diff * DAY); }
function parseDate(text) {
  const t = norm(text.toLowerCase());
  if (/\b(today|tonight)\b|اليوم|النهارده|الليله/.test(t)) return today();
  if (/\btomorrow\b|بكره|بكرا|غدا/.test(t)) return iso(Date.now() + DAY);
  if (/\byesterday\b|امبارح|امس/.test(t)) return iso(Date.now() - DAY);
  if (/next week|الاسبوع الجاي|الاسبوع القادم/.test(t)) return iso(Date.now() + 7 * DAY);
  if (/next month|الشهر الجاي|الشهر القادم/.test(t)) return iso(Date.now() + 30 * DAY);
  if (/this week|الاسبوع ده|هالاسبوع|هذا الاسبوع/.test(t)) return iso(Date.now() + 3 * DAY);
  for (const k in WD) { const re = new RegExp("(next |by |on |this |يوم |ال)?" + (/[a-z]/.test(k) ? "\\b" + k + "\\b" : k)); const m = t.match(re); if (m) return nextWd(WD[k], /next/.test(m[0])); }
  const m = t.match(/\b(\d{4}-\d{2}-\d{2})\b/); if (m) return m[1];
  return null;
}
const STOP = new Set("I He She They We You It The A An My Our Your His Her Their This That Today Tomorrow Yesterday Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Mindly And But Or So If When Then Also".split(" "));
const AR_STOP = new Set("انا هو هي هم احنا انت ده دي هاد هاي هذا هذه اليوم بكره امبارح الاحد الاثنين الثلاثاء الاربعاء الخميس الجمعه السبت مشروع اجتماع".split(" "));
function findNames(text) {
  const names = [];
  const add = n => { n = n.trim(); if (!n) return; if (!names.some(x => norm(x.toLowerCase()) === norm(n.toLowerCase()))) names.push(n); };
  for (const p of DB.people) if (norm(text.toLowerCase()).includes(norm(p.name.toLowerCase()))) add(p.name);
  const en = /(?:\b(?:met|meet|meeting with|met with|with|told|tell|call|called|email|emailed|from|to|ask|asked|promised|about|and)\s+)([A-Z][a-z]{1,}(?:\s[A-Z][a-z]{1,})?)/g; let m;
  while ((m = en.exec(text))) { const first = m[1].split(" ")[0]; if (!STOP.has(first)) add(STOP.has(m[1].split(" ")[1] || "") ? first : m[1]); }
  const en2 = /\b([A-Z][a-z]{2,})\b(?=\s+(?:will|works|work|prefers|said|asked|promised|is|has|requested|sent|wants|mentioned|can|should))/g;
  while ((m = en2.exec(text))) if (!STOP.has(m[1])) add(m[1]);
  const t = text.replace(/[،,.؟?!]/g, " ");
  const ar = /(?:قابلت|التقيت ب|التقيت بـ|كلمت|اتصلت ب|اتصلت بـ|وعدت|وعدني|قلت ل|قلت لـ|مع|عند|من)\s*([\u0600-\u06FF]{2,})/g;
  while ((m = ar.exec(t))) { const n = m[1]; if (!AR_STOP.has(norm(n)) && !/^(ال|هاد|هاي|ده|دي|هو|هي)/.test(n) && n.length < 12) add(n); }
  const arS = /(?:^|[\s،,.])([\u0600-\u06FF]{2,})\s+(?:بتشتغل|بيشتغل|شغاله على|رح|راح|هتبعت|هيبعت|حتبعت|بتفضل|بيفضل|قالت|قال|طلبت|طلب|وعدت|وعد|بعتت|بعت|طلبوا)(?=\s)/g;
  while ((m = arS.exec(t))) { const n = m[1]; if (!AR_STOP.has(norm(n)) && !/^(ال|هاد|هاي|ده|دي|هو|هي|انا|انت|وانا|وهو|وهي)/.test(n) && n.length < 12) add(n); }
  return names;
}
function pickPerson(names, sentence) { for (const n of names) if (norm(sentence.toLowerCase()).includes(norm(n.toLowerCase()))) return n; return names[0] || null; }
function splitSentences(text) { return text.split(/(?<=[.!?؟])\s+|\n+|[;؛]|\s+(?=and (?:I|he|she|we|they)\b)|\s+و(?=(?:وعدت|هو|هي|انا)\s)/).map(s => s.trim()).filter(s => s.length > 2); }
function cleanAct(s) { return s.replace(/^(to|that|him|her|them)\s+/i, "").replace(/\b(by|on|before|until)?\s*(next\s+|this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/ig, "").replace(/\b(by|on|before)?\s*(tomorrow|today|tonight|next (week|month))\b/ig, "").replace(/(بكره|بكرا|بكرة|اليوم|غدا)/g, "").replace(/[.,\s]+$/, "").replace(/\s{2,}/g, " ").trim(); }
const hedge = s => /\b(i think|maybe|probably|i guess|might|perhaps|not sure)\b|اظن|يمكن|يمكن|يمكن|ممكن يكون|مش متاكد|اعتقد/.test(norm(s.toLowerCase()));

function extract(text, ctx) {
  const out = { people: [], commitments: [], tasks: [], events: [], memories: [], prefs: [], done: [] };
  const sents = splitSentences(text);
  const names = findNames(text);
  const when = parseDate(text) || today();
  const whenOnly = s => parseDate(s);
  const isPast = /\b(met|had|talked|discussed|called|spoke|saw|sent)\b|قابلت|التقيت|كلمت|ناقشنا|اتكلمنا|بعتت|ارسلت/.test(norm(text.toLowerCase()));
  for (const n of names) out.people.push({ name: n });
  let interactionPerson = names[0] || null;
  for (const s of sents) {
    const sl = norm(s.toLowerCase());
    const person = pickPerson(names, s);
    const d = whenOnly(s);
    let m;
    const kind = hedge(s) ? "assumption" : "confirmed";
    // done / completion
    if ((m = s.match(/\b(?:i\s+)?(?:finished|completed|sent|delivered|reviewed|done with)\s+(?:the\s+)?(.+)/i)) && /\b(finished|completed|sent|delivered|reviewed|done)\b/i.test(s) && !/\b(will|promise|going to|need to)\b/i.test(s)) out.done.push({ text: cleanAct(m[1]), person });
    else if ((m = sl.match(/(?:خلصت|كملت|بعتت|ارسلت)\s+(.+)/))) out.done.push({ text: m[1], person });
    // Arabic commitments (raw text, Levantine / Egyptian)
    const nC0 = out.commitments.length, nE0 = out.events.length; let arDone = false; const rs = s.replace(/[\u064B-\u0652]/g, "");
    if (isAr(s)) {
      if ((m = rs.match(/(?:وعدت|قلت\s*ل|قلتله|حكيت\s*ل)\s*([\u0600-\u06FF]+?)\s+(?:اني|إني|إنّي|انو|إنو|ان|أن)?\s*(?:رح|راح|هـ|حـ|حا|هـ|ها)?\s*([\u0600-\u06FF][^،,.؛]*)$/)) && !/^(ال)/.test(m[1])) {
        const who = names.find(n => norm(n.toLowerCase()) === norm(m[1].toLowerCase())) || m[1];
        out.commitments.push({ title: cleanAct(m[2]), person: who, owner: "me", due: d, status: "pending", kind }); arDone = true;
      } else if ((m = rs.match(/([\u0600-\u06FF]{2,})\s+(?:رح|راح|هـ|حـ|حا)?\s*(يبعتلي|تبعتلي|يرسللي|ترسللي|يبعت|تبعت|يرسل|ترسل|يجيبلي|تجيبلي|هيبعتلي|هتبعتلي|حيبعتلي|حتبعتلي|يسلمني|تسلمني|هيسلمني|هتسلمني)\s*(.*)$/)) && (/^(هو|هي)$/.test(m[1]) || names.some(n => norm(n.toLowerCase()) === norm(m[1].toLowerCase())))) {
        const who = /^(هو|هي)$/.test(m[1]) ? names[0] : names.find(n => norm(n.toLowerCase()) === norm(m[1].toLowerCase()));
        out.commitments.push({ title: "استلام " + cleanAct(m[3]), person: who, owner: "them", due: d, status: "waiting", kind }); arDone = true;
      }
    }
    // I promised (user -> other)
    if (arDone) { } else if ((m = s.match(/I\s+(?:told|promised|said to)\s+([A-Z][a-z]+)\s+(?:that\s+)?I\s*(?:would|will|'ll|'d)\s+(.+)/i)) || (m = s.match(/I\s+promised\s+(?:to\s+)?(.+?)(?:\s+to\s+([A-Z][a-z]+))?$/i)) && /promise/i.test(s)) {
      let who = /^[A-Z][a-z]+$/.test(m[1]) && m[2] ? m[1] : (m[2] || person); let act = /^[A-Z][a-z]+$/.test(m[1]) && m[2] ? m[2] : m[1];
      if (/^[A-Z][a-z]+$/.test(m[1]) && !m[2]) { who = m[1]; act = m[1]; }
      out.commitments.push({ title: cleanAct(act), person: who || person, owner: "me", due: d, status: "pending", kind });
    } else if ((m = sl.match(/وعدت\s+(\S+)\s+(?:اني|انو|اني|ان)?\s*(.+)/))) {
      out.commitments.push({ title: m[2].replace(/(بكره|بكرا|اليوم)/, "").trim(), person: (names.find(n => norm(n.toLowerCase()) === m[1]) || m[1]), owner: "me", due: d, status: "pending", kind });
    } else if ((m = s.match(/I\s+(?:also\s+)?(?:promised|promise)\s+(?:to\s+)?(.+)/i)) || (m = s.match(/I\s*(?:'ll|will|would)\s+(review|send|call|email|prepare|share|follow up)\s*(.*)/i)) && /promis|told|committed|I will|I'll/i.test(s) && names.length) {
      const act = m[2] !== undefined && /^(review|send|call|email|prepare|share|follow up)$/i.test(m[1]) ? m[1] + " " + m[2] : m[1];
      out.commitments.push({ title: cleanAct(act), person, owner: "me", due: d, status: "pending", kind });
    }
    // They promised (other -> user)
    else if ((m = s.match(/\b([A-Z][a-z]+)\s+(?:will|promised to|is going to|said (?:he|she) would|is gonna)\s+(send|share|give|deliver|call|email|review|get back|bring|finish)\s*(.*)/)) && !STOP.has(m[1])) {
      out.commitments.push({ title: cleanAct(m[2] + " " + m[3]), person: m[1], owner: "them", due: d, status: "waiting", kind });
    } else if ((m = s.match(/\b(he|she)\s+(?:will|promised to)\s+(send|share|give|deliver|call|email|review|get back|bring|finish)\s*(.*)/i)) && names.length) {
      out.commitments.push({ title: cleanAct(m[2] + " " + m[3]), person: names[0], owner: "them", due: d, status: "waiting", kind });
    } else if ((m = sl.match(/(\S+)\s+(?:رح|راح|هيبعت|حيبعت|هيرسل)\s*(?:يبعتلي|يرسللي|يجيبلي|يبعت|يرسل)?\s*(.*)/)) && names.some(n => norm(n.toLowerCase()) === m[1])) {
      out.commitments.push({ title: ("receive " + m[2]).trim(), person: names.find(n => norm(n.toLowerCase()) === m[1]), owner: "them", due: d, status: "waiting", kind });
    }
    // Follow-up task from "need to / have to"
    if ((m = s.match(/\bI\s+(?:need|have|must|should|gotta|got)\s+to\s+(.+)/i)) || (m = rs.match(/(?:لازم|لازمني|بدي|محتاج|لازم اني|لازم إني)\s+(?:اني\s+|إني\s+)?([^،,.؛]+)/))) {
      out.tasks.push({ title: cleanAct(m[1]), person: names.find(n => norm(m[1].toLowerCase()).includes(norm(n.toLowerCase()))) || null, due: d, kind });
    }
    // review after receiving
    if (/\bI\s+promised\s+to\s+review|promised.*review|and I promised\b/i.test(s) || (/review/i.test(s) && /I\s+(promised|will|'ll)/i.test(s))) {
      const prop = (text.match(/(?:send|sends?)\s+(?:me\s+)?(?:the\s+)?([a-z ]+?)\s+(?:by|on|tomorrow|before|$)/i) || [])[1];
      out.tasks.push({ title: "Review " + (prop ? "the " + prop : "what " + (person || "they") + " sends"), person, due: null, after: "commitment", kind });
    }
    // Meetings
    if ((m = s.match(/\b(?:meeting|call|lunch|dinner|coffee)\s+with\s+([A-Z][a-z]+)\s*(.*)/i)) && /\b(have|got|scheduled|schedule|set|upcoming|plan)|tomorrow|next|on\b/i.test(s) && !/\bI (met|had)\b/i.test(s)) {
      const tm = s.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
      out.events.push({ title: S("Meeting with ", "اجتماع مع ") + m[1], person: m[1], date: d || today(), time: tm ? tm[1] : "" });
    } else if (/(?:اجتماع|ميتنج|موعد|لقاء)\s+مع/.test(sl)) {
      const mm = sl.match(/(?:اجتماع|ميتنج|موعد|لقاء)\s+مع\s+(\S+)/); const tp = names.find(n => mm && norm(n.toLowerCase()) === mm[1]) || (mm && mm[1]);
      out.events.push({ title: S("Meeting with ", "اجتماع مع ") + tp, person: tp, date: d || today(), time: "" });
    }
    // person facts
    if (person && isAr(s)) {
      if ((m = rs.match(/(?:بتشتغل|بيشتغل|تشتغل|يشتغل|شغاله|شغال|بتعمل)\s+(?:في|ب|فى)\s*([\u0600-\u06FF ]+?)(?=\s+و\s*(?:بت|بي|حال)|[،,.؛]|$)/))) out.prefs.push({ person, field: "Profession", value: m[1].trim(), kind });
      if ((m = rs.match(/(?:بتفضل|بيفضل|تفضل|يفضل)\s+(?:التواصل\s+)?(?:عبر|بال|على|ب|من خلال)?\s*([\u0600-\u06FF]+)/))) out.prefs.push({ person, field: "Communication preference", value: m[1].trim(), kind });
      if ((m = rs.match(/(?:بتشتغل|بيشتغل|تشتغل|يشتغل|شغاله|شغال)\s+(?:حاليا|حالياً)?\s*على\s+([\u0600-\u06FF ]+?)(?=[،,.؛]|$)/))) out.prefs.push({ person, field: "Current project", value: m[1].trim(), kind });
      if ((m = rs.match(/(?:هو|هي)?\s*(?:صديقي|صديقتي|زميلي|زميلتي|مورّدي|موردي|عميلي|شريكي)/))) { const mm = m[0].replace(/هو|هي/g, "").trim(); out.prefs.push({ person, field: "Relationship", value: mm, kind }); }
    }
    if (person) {
      if ((m = s.match(/works?\s+(?:in|at|as|for)\s+([^,.;]+)/i))) out.prefs.push({ person, field: "Profession", value: m[1].replace(/\s+and\s+.*/i, "").trim(), kind });
      else if ((m = sl.match(/(?:بتشتغل|بيشتغل|يشتغل|شغلها|شغله)\s+(?:في|ب|فى)?\s*(.+)/))) out.prefs.push({ person, field: "Profession", value: m[1], kind });
      if ((m = s.match(/prefers?\s+(?:communicating\s+)?(?:through|via|by|over|on)?\s*([A-Za-z ]+?)(?:[,.;]| and |$)/i))) out.prefs.push({ person, field: "Communication preference", value: m[1].trim(), kind });
      if ((m = s.match(/(?:currently\s+)?working\s+on\s+(?:a\s+|an\s+|the\s+)?([^,.;]+)/i))) out.prefs.push({ person, field: "Current project", value: m[1].trim(), kind });
      if ((m = s.match(/birthday\s+(?:is\s+)?(?:on\s+)?([A-Za-z]+\s+\d{1,2}|\d{1,2}\s+[A-Za-z]+)/i))) out.prefs.push({ person, field: "Important date", value: "Birthday " + m[1], kind });
      if ((m = s.match(/(?:likes?|loves?|is into|interested in)\s+([^,.;]+)/i)) && !/^I\s/.test(s)) out.prefs.push({ person, field: "Shared interest", value: m[1].trim(), kind });
      if ((m = s.match(/\b(?:is|'s)\s+(?:my|our)\s+(friend|colleague|client|supplier|partner|investor|manager|brother|sister|cousin|boss|mentor)\b/i))) out.prefs.push({ person, field: "Relationship", value: m[1].toLowerCase(), kind });
      if ((m = s.match(/(supplier|client|colleague|investor|partner)\b/i)) && /\b(my|our|the)\s+(supplier|client|colleague|investor|partner)/i.test(s)) out.prefs.push({ person, field: "Relationship", value: m[1].toLowerCase(), kind });
    }
    // Memories: decisions, ideas, discussions, preferences/habits, dates
    if (out.commitments.length > nC0 && !/decid|قررت|قررنا/.test(sl)) { /* a commitment sentence is not also a discussion memory */ }
    else if (out.events.length > nE0) { /* a meeting is an event, not a memory */ }
    else if (/\b(decided|decision|i('| a)?m going with|we agreed|agreed)\b/i.test(s) || /قررت|قررنا|اتفقنا/.test(sl)) out.memories.push({ type: "Decision", text: s, kind, person });
    else if (/\b(idea|what if|we could|i want to launch|launch(ing)?|start(ing)? a)\b/i.test(s) || /فكره|فكرة|ناوي/.test(sl)) out.memories.push({ type: "Idea", text: s, kind, person });
    else if (/\b(discussed|talked about|we talked|spoke about|proposal|supplier|deal|contract|pricing|budget)\b/i.test(s) || /ناقشنا|اتكلمنا|مورد|عرض|عقد/.test(sl)) out.memories.push({ type: "Discussion", text: s, kind, person });
    else if (/\bI\s+(always|usually|prefer|like|love|hate|never)\b/i.test(s) || /\bmy\s+(birthday|anniversary|wife|husband|mother|father|kid|son|daughter)\b/i.test(s) || /دايما|عادةً|عادة|بحب|ما بحب/.test(sl)) out.memories.push({ type: /\bmy\s+(birthday|anniversary)/i.test(s) ? "Important date" : "Preference / habit", text: s, kind, person: null });
    else if (/\b(remember|note|important|don't forget|dont forget)\b/i.test(s) || /تذكر|خليك فاكر|مهم/.test(sl)) out.memories.push({ type: "Note", text: s, kind, person });
    else if (names.length && !out.commitments.length && !/\b(meeting|call|lunch|dinner|coffee)\s+with\b/i.test(s) && sents.length === 1 && s.split(" ").length > 3) out.memories.push({ type: "Interaction", text: s, kind, person });
  }
  // a discussion line implied by the whole input when a person was met
  if (interactionPerson && isPast && !out.memories.some(x => x.type === "Discussion" || x.type === "Interaction") && /discuss|talk|ناقش|اتكلم/.test(norm(text.toLowerCase())) ) out.memories.push({ type: "Discussion", text, kind: hedge(text) ? "assumption" : "confirmed", person: interactionPerson });
  out.date = when; out.interactionPerson = interactionPerson; out.isPast = isPast;
  return out;
}

/* Apply extraction → persistent linked records. Respects "what AI may remember". */
function applyExtraction(text, ex, source) {
  const ALW = DB.settings.allow; const created = []; const log = [];
  const inp = { id: uid("in"), text, ts: Date.now(), source: source || "text" }; DB.inputs.push(inp);
  const person = name => {
    if (!name || !ALW.people) return null; const k = norm(name.toLowerCase());
    let p = DB.people.find(x => norm(x.name.toLowerCase()) === k || norm(x.name.toLowerCase().split(" ")[0]) === k);
    if (!p) { p = { id: uid("p"), name, relation: "", profession: "", comm: "", project: "", interests: [], dates: [], extra: {}, created: Date.now(), srcs: [inp.id] }; DB.people.push(p); created.push({ t: "people", id: p.id }); log.push(S("New contact: ", "جهة اتصال جديدة: ") + name); }
    return p;
  };
  for (const n of ex.people) person(n.name);
  let inter = null;
  const ip = ex.interactionPerson && person(ex.interactionPerson);
  if (ip && (ex.isPast || ex.memories.length || ex.commitments.length) && !(ex.events.length && !ex.isPast && !ex.commitments.length)) {
    inter = { id: uid("i"), personId: ip.id, date: today(), summary: text.length > 140 ? text.slice(0, 137) + "…" : text, inputId: inp.id, links: [] };
    DB.interactions.push(inter); created.push({ t: "interactions", id: inter.id }); log.push(S("Interaction with " + ip.name + " recorded", "سجّلت تفاعل مع " + ip.name));
  }
  for (const f of ex.prefs) {
    if (!ALW.preferences) continue; const p = person(f.person); if (!p) continue;
    const mp = { Profession: "profession", "Communication preference": "comm", "Current project": "project", Relationship: "relation" };
    if (mp[f.field]) p[mp[f.field]] = f.value; else if (f.field === "Shared interest") { if (!p.interests.includes(f.value)) p.interests.push(f.value); } else if (f.field === "Important date") { if (!p.dates.includes(f.value)) p.dates.push(f.value); }
    p.facts = p.facts || {}; p.facts[f.field] = f.kind; p.srcs = (p.srcs || []).concat(inp.id);
    log.push(p.name + ": " + (A() ? ({ Profession: "المهنة", "Communication preference": "طريقة التواصل", "Current project": "المشروع الحالي", Relationship: "العلاقة", "Shared interest": "اهتمام مشترك", "Important date": "تاريخ مهم" }[f.field] || f.field) : f.field) + " = " + f.value);
    if (f.field === "Current project" && ALW.memories) { let pr = DB.projects.find(x => x.name.toLowerCase() === f.value.toLowerCase()); if (!pr) { pr = { id: uid("pr"), name: f.value, personIds: [p.id] }; DB.projects.push(pr); } else if (!pr.personIds.includes(p.id)) pr.personIds.push(p.id); }
  }
  const newCommit = [];
  if (ALW.commitments) for (const c of ex.commitments) {
    const p = person(c.person); const rec = { id: uid("c"), title: c.title, personId: p ? p.id : null, personName: c.person || "", owner: c.owner, due: c.due, status: c.status, kind: c.kind, inputId: inp.id, interactionId: inter ? inter.id : null, created: Date.now() };
    DB.commitments.push(rec); created.push({ t: "commitments", id: rec.id }); newCommit.push(rec);
    log.push((c.owner === "me" ? S("You promised ", "وعدت ") : (c.person || S("They", "هو")) + S(" promised: ", " وعدك: ")) + c.title + (c.due ? " (" + fmtDate(c.due) + ")" : ""));
  }
  if (ALW.tasks) for (const t of ex.tasks) {
    if (DB.tasks.some(x => x.status !== "done" && x.title.toLowerCase() === t.title.toLowerCase())) continue;
    const p = person(t.person); const rec = { id: uid("t"), title: t.title, personId: p ? p.id : null, due: t.due, status: "open", kind: t.kind, inputId: inp.id, commitmentId: t.after && newCommit.length ? (newCommit.find(c => c.owner === "them") || newCommit[0]).id : null, created: Date.now() };
    DB.tasks.push(rec); created.push({ t: "tasks", id: rec.id }); log.push(S("Task: ", "مهمة: ") + t.title);
  }
  if (ALW.events) for (const e of ex.events) {
    const p = person(e.person); const rec = { id: uid("e"), title: e.title, personId: p ? p.id : null, date: e.date, time: e.time, inputId: inp.id };
    DB.events.push(rec); created.push({ t: "events", id: rec.id }); log.push(S("Event: ", "موعد: ") + e.title + " (" + fmtDate(e.date) + ")");
  }
  if (ALW.memories) for (const mm of ex.memories) {
    const p = person(mm.person); const proj = DB.projects.find(x => norm(mm.text.toLowerCase()).includes(norm(x.name.toLowerCase())));
    const rec = { id: uid("m"), type: mm.type, text: mm.text, kind: mm.kind, personId: p ? p.id : null, projectId: proj ? proj.id : null, date: ex.date, important: false, inputId: inp.id, created: Date.now() };
    DB.memories.push(rec); created.push({ t: "memories", id: rec.id }); log.push(S("Memory (" + mm.type + ")", "ذاكرة (" + tType(mm.type) + ")"));
  }
  for (const d of ex.done) { // mark completions
    const k = norm(d.text.toLowerCase()).split(/\s+/).filter(w => w.length > 3);
    const pool = DB.commitments.filter(c => c.status === "pending" || c.status === "waiting").map(c => ({ c, tt: "commitments" })).concat(DB.tasks.filter(t => t.status === "open").map(c => ({ c, tt: "tasks" })));
    const hit = pool.find(x => k.some(w => norm(x.c.title.toLowerCase()).includes(w)));
    if (hit) { hit.c.status = "done"; hit.c.doneAt = Date.now(); log.push(S("Marked done: ", "علّمتها منجزة: ") + hit.c.title); }
  }
  if (inter) { inter.links = created.filter(x => x.t !== "people" && x.t !== "interactions"); }
  DB.lastCreated = created; save();
  return { log, created, inputId: inp.id, newCommit };
}
function undoLast() { const L = DB.lastCreated || []; for (const x of L) DB[x.t] = DB[x.t].filter(r => r.id !== x.id); DB.lastCreated = []; save(); }

/* ============================================================
   RETRIEVAL — memory questions with original sources. Never fabricates:
   if nothing matches it says so.
   ============================================================ */
const kindLabel = k => (A() ? { confirmed: "مؤكد", assumption: "افتراض منك", suggestion: "اقتراح من الذكاء" } : { confirmed: "confirmed", assumption: "your assumption", suggestion: "AI suggestion" })[k] || k;
const TYPES = { Decision: "قرار", Idea: "فكرة", Discussion: "نقاش", "Preference / habit": "تفضيل / عادة", "Important date": "تاريخ مهم", Note: "ملاحظة", Interaction: "تفاعل" };
const tType = x => A() ? (TYPES[x] || x) : x;
function srcText(id) { const i = byId(DB.inputs, id); return i ? i : null; }
function srcLine(inputId) { const i = srcText(inputId); return i ? S("Source: ", "المصدر: ") + "“" + (i.text.length > 90 ? i.text.slice(0, 87) + "…" : i.text) + "” · " + new Date(i.ts).toLocaleDateString(A() ? "ar-u-nu-latn" : undefined) : ""; }
const personByQuery = q => { const n = norm(q.toLowerCase()); return DB.people.find(p => n.includes(norm(p.name.toLowerCase()))) || DB.people.find(p => n.includes(norm(p.name.toLowerCase().split(" ")[0]))); };
const tokens = q => norm(q.toLowerCase()).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(w => w.length > 2 && !/^(what|when|did|the|about|that|was|name|and|you|have|for|with|and|which|who|how|لي|ماذا|شو|ايش|ما|اللي|عن|كان)$/.test(w));
function ask(q) {
  const n = norm(q.toLowerCase()); const ar = A(); const srcs = []; let reply = "";
  const P = personByQuery(q);
  const say = (en, arr) => ar ? arr : en;
  const none = () => say("I don’t have anything saved about that yet. Tell me and I’ll remember it.", "ما عندي شي محفوظ عن هذا لسا. احكيلي وأنا بحفظه.");
  if (/promise|owe|unfulfilled|وعد|وعود|وفيت|وفيت/.test(n) && !/waiting|from|منتظر|مستني|بنتظر|ناطر/.test(n) || /not fulfilled|pending commit/.test(n)) {
    let l = DB.commitments.filter(c => c.owner === "me" && c.status === "pending"); if (P) l = l.filter(c => c.personId === P.id);
    if (!l.length) return { text: say("No open promises on record" + (P ? " for " + P.name : "") + ". That only reflects what you’ve told me.", "ما في وعود مفتوحة مسجلة عندي."), srcs };
    l.forEach(c => srcs.push(c.inputId)); return { text: say("You have " + l.length + " open promise" + (l.length > 1 ? "s" : "") + ":\n", "عندك " + l.length + " وعود مفتوحة:\n") + l.map(c => "• " + (c.personName ? c.personName + ": " : "") + c.title + (c.due ? " (" + fmtDate(c.due) + ")" : "")).join("\n"), srcs };
  }
  if (/waiting|expect|they promised|owe me|ينتظر|منتظر|مستني|بنتظر|ناطر|انتظر|بانتظار/.test(n)) {
    let l = DB.commitments.filter(c => c.owner === "them" && c.status === "waiting"); if (P) l = l.filter(c => c.personId === P.id);
    if (!l.length) return { text: say("You’re not waiting on anything that I know of" + (P ? " from " + P.name : "") + ".", "مش مستني شي من حدا حسب اللي عندي."), srcs };
    l.forEach(c => srcs.push(c.inputId)); return { text: say("You’re waiting for:\n", "إنت مستني:\n") + l.map(c => "• " + c.personName + ": " + c.title + (c.due ? S(" (due ", " (موعده ") + fmtDate(c.due) + ")" : "")).join("\n"), srcs };
  }
  if (/who.*(haven|have not|didn).*(contact|talk|call)|follow up with|follow-up|مين.*(ما كلمت|لازم)/.test(n)) {
    const s = suggestions().filter(x => x.kind === "follow").slice(0, 5);
    if (!s.length) return { text: say("Nothing stands out. I won’t assume you’ve neglected anyone just because nothing is recorded.", "ما في شي واضح."), srcs };
    return { text: say("People you might want to reach out to:\n", "ناس ممكن تتواصل معهم:\n") + s.map(x => "• " + x.text).join("\n"), srcs };
  }
  if (/last month|الشهر الماضي|الشهر اللي فات/.test(n)) {
    const d = new Date(); const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 1);
    const l = DB.memories.filter(m => { const t = new Date(m.date + "T12:00:00"); return t >= a && t < b; });
    if (!l.length) return { text: say("I have no memories dated last month.", "ما عندي ذكريات من الشهر الماضي."), srcs };
    l.forEach(m => srcs.push(m.inputId)); return { text: l.map(m => "• " + m.type + ": " + m.text).join("\n"), srcs };
  }
  if (/when did i last|last (discuss|talk)|اخر مره/.test(n)) {
    const tk = tokens(q).filter(w => !/last|discuss|talk|topic|about|when/.test(w)); const l = DB.memories.concat(DB.interactions.map(i => ({ text: i.summary, date: i.date, inputId: i.inputId }))).filter(m => tk.some(w => norm(m.text.toLowerCase()).includes(w))).sort((a, b) => b.date.localeCompare(a.date));
    if (!l.length) return { text: none(), srcs }; srcs.push(l[0].inputId); return { text: say("Last time was " + fmtDate(l[0].date) + ": " + l[0].text, "آخر مرة كانت " + fmtDate(l[0].date) + ": " + l[0].text), srcs };
  }
  if (P && /remember|know|about|discuss|talk|عن|تعرف|تذكر|ناقش|اتكلم/.test(n)) {
    const bits = personSummary(P); if (!bits.length) return { text: say("I know " + P.name + " exists but nothing else yet.", "بعرف " + P.name + " بس ما عندي تفاصيل."), srcs };
    (P.srcs || []).forEach(s => srcs.push(s)); DB.memories.filter(m => m.personId === P.id).forEach(m => srcs.push(m.inputId)); DB.commitments.filter(m => m.personId === P.id).forEach(m => srcs.push(m.inputId));
    return { text: P.name + ":\n" + bits.join("\n"), srcs };
  }
  if (/decide|decision|قررت/.test(n)) {
    const tk = tokens(q); let l = DB.memories.filter(m => m.type === "Decision"); const f = l.filter(m => tk.some(w => norm(m.text.toLowerCase()).includes(w))); if (f.length) l = f;
    if (!l.length) return { text: none(), srcs }; l.slice(-3).forEach(m => srcs.push(m.inputId)); return { text: l.slice(-3).map(m => "• " + m.text + " (" + kindLabel(m.kind) + ")").join("\n"), srcs };
  }
  // generic search across memories, inputs, commitments, tasks
  const tk = tokens(q); if (!tk.length) return { text: none(), srcs };
  const hits = DB.inputs.map(i => ({ i, s: tk.filter(w => norm(i.text.toLowerCase()).includes(w)).length })).filter(x => x.s).sort((a, b) => b.s - a.s || b.i.ts - a.i.ts).slice(0, 3);
  if (!hits.length) return { text: none(), srcs };
  hits.forEach(h => srcs.push(h.i.id));
  return { text: say("Here’s what you told me:\n", "هاد اللي حكيتلي:\n") + hits.map(h => "• " + h.i.text + " (" + new Date(h.i.ts).toLocaleDateString() + ")").join("\n"), srcs };
}
function personSummary(P) {
  const b = []; if (P.relation) b.push(S("Relationship: ", "العلاقة: ") + P.relation); if (P.profession) b.push(S("Works: ", "الشغل: ") + P.profession); if (P.comm) b.push(S("Prefers: ", "بيفضّل: ") + P.comm); if (P.project) b.push(S("Current project: ", "المشروع الحالي: ") + P.project);
  if (P.interests && P.interests.length) b.push(S("Interests: ", "اهتمامات: ") + P.interests.join(", ")); if (P.dates && P.dates.length) b.push(S("Dates: ", "تواريخ: ") + P.dates.join(", "));
  const last = DB.interactions.filter(i => i.personId === P.id).sort((a, b) => b.date.localeCompare(a.date))[0]; if (last) b.push(S("Last conversation: ", "آخر محادثة: ") + fmtDate(last.date));
  DB.commitments.filter(c => c.personId === P.id && c.status !== "done").forEach(c => b.push((c.owner === "me" ? S("You promised: ", "وعدت: ") : S("Waiting: ", "منتظر: ")) + c.title + (c.due ? " (" + fmtDate(c.due) + ")" : "")));
  DB.memories.filter(m => m.personId === P.id).slice(-3).forEach(m => b.push(tType(m.type) + ": " + m.text));
  return b;
}

/* ============================================================
   PROACTIVE ENGINE — suggestions only. Nothing is changed or sent
   without the user pressing approve.
   ============================================================ */
function suggestions() {
  const out = []; const t = today(); const tom = iso(Date.now() + DAY); const add = o => { if (!DB.dismissed[o.id]) out.push(o); };
  const sh = (x, n) => x.length > n ? x.slice(0, n - 3) + "…" : x;
  for (const c of DB.commitments) {
    if (c.status === "done") continue;
    const who = c.personName || S("someone", "حدا");
    if (c.owner === "me" && c.due && c.due < t) add({ id: "od_" + c.id, kind: "follow", text: S("Your promise to " + who + " (“" + c.title + "”) was due " + fmtDate(c.due) + ". Still pending?", "وعدك لـ " + who + " (“" + c.title + "”) كان موعده " + fmtDate(c.due) + ". لسا معلّق؟"), ref: c.id, act: "reminder" });
    else if (c.owner === "me" && c.due && c.due <= tom) add({ id: "soon_" + c.id, kind: "soon", text: S("Due " + fmtDate(c.due) + ": " + c.title + (c.personName ? " for " + c.personName : "") + ". Want a reminder?", "موعده " + fmtDate(c.due) + ": " + c.title + (c.personName ? " لـ " + c.personName : "") + ". بدك تذكير؟"), ref: c.id, act: "reminder" });
    if (c.owner === "them" && c.due && c.due < t) add({ id: "wait_" + c.id, kind: "follow", text: S("You were expecting “" + c.title + "” from " + c.personName + " by " + fmtDate(c.due) + ". Would you like to check in gently?", "كنت متوقع “" + c.title + "” من " + c.personName + " لحد " + fmtDate(c.due) + ". بدك تطمّن عليه بلطف؟"), ref: c.id, act: "draft" });
  }
  for (const k of DB.tasks) { if (k.status !== "open") continue; if (k.commitmentId) { const c = byId(DB.commitments, k.commitmentId); if (c && c.status === "done") continue; } if (Date.now() - k.created > 2 * DAY) add({ id: "task_" + k.id, kind: "pending", text: S("“" + k.title + "” is still open. Would you like to schedule a reminder?", "“" + k.title + "” لسا مفتوحة. بدك أحط تذكير؟"), ref: k.id, act: "reminder" }); }
  for (const e of DB.events) { if (e.date >= t && e.date <= tom && e.personId) { const p = byId(DB.people, e.personId); const rel = DB.commitments.filter(c => c.personId === e.personId && c.status !== "done"); const mem = DB.memories.filter(m => m.personId === e.personId).slice(-1)[0]; if (rel.length || mem) add({ id: "prep_" + e.id, kind: "prep", text: S("You have a meeting with " + (p ? p.name : "them") + " " + fmtDate(e.date) + ". " + (mem ? "You previously noted: “" + sh(mem.text, 70) + "”. " : "") + "Add it to your meeting preparation notes?", "عندك اجتماع مع " + (p ? p.name : "الشخص") + " " + fmtDate(e.date) + ". " + (mem ? "سبق وسجلت: “" + sh(mem.text, 70) + "”. " : "") + "بدك أضيفه لملاحظات التحضير للاجتماع؟"), ref: e.id, act: "prep" }); } }
  for (const p of DB.people) { const last = DB.interactions.filter(i => i.personId === p.id).sort((a, b) => b.date.localeCompare(a.date))[0]; if (last && (Date.now() - new Date(last.date + "T12:00:00")) > 21 * DAY && /friend|client|colleague|partner|supplier|investor|mentor|brother|sister|boss|manager|صديق|زميل|عميل|شريك|مورد/.test(p.relation || "")) add({ id: "quiet_" + p.id + "_" + last.date, kind: "follow", text: S("It’s been a while since you and " + p.name + " spoke (" + fmtDate(last.date) + "). Only if it feels right: want a nudge to say hi?", "صار فترة من آخر مرة حكيت فيها مع " + p.name + " (" + fmtDate(last.date) + "). بس إذا حاسس إنه مناسب: بدك تنبيه تسلّم عليه؟"), ref: p.id, act: "reminder" }); }
  const days = {}; DB.events.filter(e => e.date >= t).forEach(e => { if (e.time) { const k = e.date + e.time.toLowerCase().replace(/\s/g, ""); (days[k] = days[k] || []).push(e); } });
  Object.values(days).filter(a => a.length > 1).forEach(a => add({ id: "conf_" + a.map(x => x.id).join(""), kind: "conflict", text: S("Possible clash " + fmtDate(a[0].date) + " at " + a[0].time + ": " + a.map(x => x.title).join(" and "), "احتمال تعارض " + fmtDate(a[0].date) + " الساعة " + a[0].time + ": " + a.map(x => x.title).join(" و ")), ref: a[0].id, act: "none" }));
  return out;
}
function approveSuggestion(s) {
  const R = S("Reminder: ", "تذكير: ");
  if (s.act === "reminder") { const base = byId(DB.commitments, s.ref) || byId(DB.tasks, s.ref); if (base) { DB.tasks.push({ id: uid("t"), title: R + base.title, personId: base.personId || null, due: iso(Date.now() + DAY), status: "open", kind: "suggestion", inputId: base.inputId, created: Date.now(), approved: true }); } else { const p = byId(DB.people, s.ref); if (p) DB.tasks.push({ id: uid("t"), title: S("Say hi to ", "سلّم على ") + p.name, personId: p.id, due: iso(Date.now() + DAY), status: "open", kind: "suggestion", created: Date.now(), approved: true }); } DB.dismissed[s.id] = 1; save(); return S("Reminder added for tomorrow.", "انضاف تذكير لبكرة."); }
  if (s.act === "prep") { const e = byId(DB.events, s.ref); if (e) { const rel = DB.commitments.filter(c => c.personId === e.personId && c.status !== "done").map(c => c.title); const mem = DB.memories.filter(m => m.personId === e.personId).slice(-2).map(m => m.text); DB.notes.push({ id: uid("n"), title: S("Prep: ", "تحضير: ") + e.title, text: mem.concat(rel).join("\n"), personId: e.personId, eventId: e.id, kind: "suggestion", created: Date.now() }); } DB.dismissed[s.id] = 1; save(); return S("Added to meeting notes.", "انضاف لملاحظات الاجتماع."); }
  if (s.act === "draft") { const c = byId(DB.commitments, s.ref); const msg = S("Hi " + c.personName + ", just checking in on " + c.title + ". No rush, whenever you can.", "مرحبا " + c.personName + "، بس بطمّن عن " + c.title + ". بدون استعجال، وقت ما تقدر."); navigator.clipboard && navigator.clipboard.writeText(msg).catch(() => {}); DB.dismissed[s.id] = 1; save(); return S("Draft copied. Nothing was sent.", "انسخت المسودة. ما انبعت شي."); }
  DB.dismissed[s.id] = 1; save(); return S("Done.", "تمام.");
}
function briefing() {
  const t = today(); const L = [];
  const ev = DB.events.filter(e => e.date === t).sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  L.push(ev.length ? S("Today: ", "اليوم: ") + ev.map(e => e.title + (e.time ? S(" at ", " الساعة ") + e.time : "")).join("; ") + "." : S("No appointments saved for today.", "ما في مواعيد محفوظة لليوم."));
  const dl = DB.commitments.filter(c => c.status !== "done" && c.due && c.due <= iso(Date.now() + 2 * DAY)).concat(DB.tasks.filter(k => k.status === "open" && k.due && k.due <= iso(Date.now() + 2 * DAY)));
  if (dl.length) L.push(S("Coming up: ", "قريباً: ") + dl.slice(0, 4).map(x => x.title + " (" + fmtDate(x.due) + ")").join("; ") + ".");
  const f = suggestions().filter(s => s.kind === "follow").slice(0, 3); if (f.length) L.push(S("People you might reach out to: ", "ناس ممكن تتواصل معهم: ") + f.map(x => x.text.split(" (")[0]).join("; ") + ".");
  const w = DB.commitments.filter(c => c.owner === "them" && c.status === "waiting").length; if (w) L.push(S("You’re waiting on " + w + " thing" + (w > 1 ? "s" : "") + " from others.", "إنت منتظر " + w + " من الناس."));
  const cf = suggestions().filter(s => s.kind === "conflict"); if (cf.length) L.push(cf[0].text + ".");
  const pr = DB.commitments.filter(c => c.owner === "me" && c.status === "pending").sort((a, b) => (a.due || "9").localeCompare(b.due || "9")).slice(0, 3); if (pr.length) L.push(S("Suggested priorities: ", "أولويات مقترحة: ") + pr.map((c, i) => (i + 1) + ") " + c.title).join(" "));
  return L.join("\n");
}
function evening() {
  const t = today(); const open = DB.commitments.filter(c => c.owner === "me" && c.status === "pending" && c.due && c.due <= t).concat(DB.tasks.filter(k => k.status === "open" && k.due && k.due <= t));
  const doneToday = DB.commitments.concat(DB.tasks).filter(x => x.status === "done" && x.doneAt && iso(x.doneAt) === t).length;
  const tom = DB.commitments.filter(c => c.status !== "done" && c.due === iso(Date.now() + DAY)).concat(DB.tasks.filter(k => k.status === "open" && k.due === iso(Date.now() + DAY)));
  return { open, doneToday, tom };
}

/* ============================================================
   CONVERSATION — one entry point used by voice and text.
   ============================================================ */
const QUESTION = /^\s*(what|when|who|which|how|do you|did|show|list|tell me|summar|remind me what|where|is there|are there)\b|\?\s*$|؟\s*$|^\s*(شو|ايش|مين|متى|امتى|وين|كم|ماذا|من|هل|اعرض|وريني)\b/i;
const AI_URL = "https://mindly-ai.abd88926.workers.dev";
const isCmd = t => /resume memory|pause|stop.*(memory|remember)|forget|undo|briefing|evening review|لا تحفظ|وقف|اوقف|انسى|تراجع|ملخص|كمل الحفظ|استمر|رجع الحفظ|صباح الخير|مراجعة|مراجعه/i.test(t);
async function respondAI(text) {
  if (!AI_URL || DB.settings.paused || DB.settings.noAI || isCmd(text)) return respond(text);
  try {
    const ctx = { people: DB.people.map(p => ({ name: p.name, relation: p.relation, profession: p.profession, project: p.project, comm: p.comm })), commitments: DB.commitments.filter(c => c.status !== "done").map(c => ({ title: c.title, person: c.personName, owner: c.owner, due: c.due, status: c.status, inputId: c.inputId })), tasks: DB.tasks.filter(t => t.status !== "done").map(t => ({ title: t.title, due: t.due })), events: DB.events.map(e => ({ title: e.title, date: e.date })), memories: DB.memories.slice(-60).map(m => ({ type: m.type, text: m.text, inputId: m.inputId })) };
    let r = null;
    for (let at = 0; at < 4; at++) {
      const c = new AbortController(); const tm = setTimeout(() => c.abort(), 12000);
      try { r = await fetch(AI_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, today: today(), ctx, lang: DB.settings.lang === "ar" ? "ar" : "en" }), signal: c.signal }); } catch (er) { r = null; } finally { clearTimeout(tm); }
      if (r && r.ok) break; if (r && r.status < 500) break; await new Promise(z => setTimeout(z, 700));
    }
    if (!r || !r.ok) throw new Error("ai"); const j = await r.json(); RESP = isAr(text) || (DB.settings.lang === "ar" && !/[A-Za-z]{3}/.test(text));
    try {
      if (j.intent === "save" && j.extraction) {
        const e = j.extraction; const ex = Object.assign({ people: [], commitments: [], tasks: [], events: [], memories: [], prefs: [], done: [], interactionPerson: null, isPast: false, date: today() }, e);
        ex.commitments = (ex.commitments || []).map(x => ({ kind: "confirmed", status: x.owner === "them" ? "waiting" : "pending", due: null, ...x })); ex.tasks = (ex.tasks || []).map(x => ({ kind: "confirmed", due: null, ...x })); ex.memories = (ex.memories || []).map(x => ({ kind: "confirmed", ...x }));
        ex.prefs = (ex.prefs || []).map(x => ({ kind: "confirmed", ...x })); ex.people = (ex.people || []).filter(x => x && x.name); ex.interactionPerson = ex.interactionPerson || (ex.people[0] && ex.people[0].name) || null;
        const r2 = applyExtraction(text, ex, "voice/text+ai"); return { text: j.reply || (S("Saved: ", "حفظت: ") + r2.log.join(". ")), srcs: [r2.inputId], saved: true, ai: true };
      }
      return { text: j.reply || "", srcs: (j.sources || []).filter(s => byId(DB.inputs, s)), ai: true };
    } finally { RESP = null; }
  } catch (e) { return respond(text); }
}
function respond(text) { RESP = isAr(text) || (DB.settings.lang === "ar" && !/[A-Za-z]{3}/.test(text)); try { return respond0(text); } finally { RESP = null; } }
function respond0(text) {
  const ar = A(); const n = norm(text.toLowerCase());
  if (/resume memory|استمر بالحفظ|كمل الحفظ|رجع الحفظ/.test(n)) { DB.settings.paused = false; save(); return { text: S("Memory resumed.", "رجعت الذاكرة تشتغل."), srcs: [] }; }
  if (/(pause|stop).*(memory|remember)|لا تحفظ|وقف الحفظ|اوقف الحفظ|وقف الذاكره/.test(n)) { DB.settings.paused = true; save(); return { text: S("Okay, I’ve paused memory. Nothing new will be saved.", "تمام، أوقفت الحفظ. ما رح انحفظ شي جديد."), srcs: [] }; }
  if (DB.settings.paused) return { text: S("Memory is paused. Say “resume memory” to continue saving.", "الذاكرة متوقفة مؤقتاً. قول “كمل الحفظ” لأكمل."), srcs: [] };
  if (/forget (that|the last)|undo|انسى هاد|انسى اخر|تراجع/.test(n)) { undoLast(); return { text: S("Done. I removed what I last saved.", "تم، حذفت آخر شي حفظته."), srcs: [] }; }
  if (/briefing|morning|my day|today.?s plan|ملخص اليوم|خطة اليوم|شو عندي اليوم|ملخص الصباح|صباح الخير/.test(n)) return { text: briefing(), srcs: [] };
  if (/evening review|end of day|how did (my )?day|مراجعة المساء|مراجعه المساء|ملخص المساء/.test(n)) { const e = evening(); return { text: (e.doneToday ? S(e.doneToday + " completed today. ", "أنجزت " + e.doneToday + " اليوم. ") : "") + (e.open.length ? S("Still open: ", "لسا مفتوح: ") + e.open.map(x => x.title).join("; ") + S(". Did you finish any?", ". خلصت شي منهم؟") : S(S("Nothing overdue today.", "ما في شي متأخر اليوم."), "ما في شي متأخر اليوم.")) + (e.tom.length ? S(" Tomorrow: ", " بكرة: ") + e.tom.map(x => x.title).join("; ") + "." : ""), srcs: [] }; }
  if (QUESTION.test(text) && !/^\s*I\b/.test(text)) return ask(text);
  const ex = extract(text, {});
  const has = ex.people.length || ex.commitments.length || ex.tasks.length || ex.events.length || ex.memories.length || ex.prefs.length || ex.done.length;
  if (!has) { const a = ask(text); if (a.srcs.length) return a; return { text: S("Got it. I didn’t find a specific fact to save. Want me to keep it as a note?", "سمعتك. ما لقيت شي واضح أحفظه. بتحب أحفظه كملاحظة؟"), srcs: [], offerNote: text }; }
  const r = applyExtraction(text, ex, "voice/text");
  const first = r.log.length ? r.log.slice(0, 5).join(". ") + "." : S("Noted.", "تمام.");
  let extra = ""; const c = r.newCommit.find(x => x.owner === "them"); if (c) extra = S(" Want a reminder if it hasn’t arrived by then?", " بدك أذكرك إذا ما وصل بالموعد؟");
  return { text: S("Saved: ", "حفظت: ") + first + extra, srcs: [r.inputId], saved: true };
}

/* ============================================================
   UI — dashboard, commitments, relationship insights, memory
   ============================================================ */
let view = "home", tab = "me", openPerson = null, memFilter = "";
const $ = s => document.querySelector(s);
const ICON = { home: '<path d="M3 11l9-8 9 8M5 10v10h14V10"/>', commit: '<path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>', people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>', mem: '<path d="M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3zM9 21h6"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>' };
function renderNav() {
  const b = (v, l, ic) => '<button data-v="' + v + '" class="' + (view === v ? "on" : "") + '"><svg viewBox="0 0 24 24">' + ICON[ic] + "</svg>" + l + "</button>";
  $("#nav").innerHTML = b("home", "Today", "home") + b("commit", "Commitments", "commit") + '<button class="vb" id="openVoice" aria-label="Voice"><span><svg viewBox="0 0 24 24" style="width:22px;height:22px;stroke:#fff;fill:none;stroke-width:1.8;stroke-linecap:round">' + ICON.mic + "</svg></span></button>" + b("people", "People", "people") + b("mem", "Memory", "mem");
  $("#nav").querySelectorAll("[data-v]").forEach(x => x.onclick = () => { view = x.dataset.v; openPerson = null; render(); });
  $("#openVoice").onclick = openVoiceScreen;
}
const kindChip = k => '<span class="chip ' + k + '">' + kindLabel(k) + "</span>";
function render() { renderNav(); const m = $("#main"); m.innerHTML = ({ home: vHome, commit: vCommit, people: vPeople, mem: vMem })[view](); bind(m); tr(document.body); m.scrollTop = 0; }
function vHome() {
  const t = today(); const sg = suggestions();
  const focus = []; DB.commitments.filter(c => c.status !== "done" && c.owner === "me" && c.due && c.due <= t).forEach(c => focus.push({ t: c.title + (c.personName ? " · " + c.personName : ""), m: c.due < t ? S("overdue", "متأخر") : S("due today", "مستحق اليوم"), id: c.id, k: "commitments" }));
  DB.tasks.filter(k => k.status === "open" && k.due && k.due <= t).forEach(c => focus.push({ t: c.title, m: S("task · ", "مهمة · ") + fmtDate(c.due), id: c.id, k: "tasks" }));
  DB.events.filter(e => e.date === t).forEach(e => focus.push({ t: e.title + (e.time ? " · " + e.time : ""), m: S("event today", "موعد اليوم") }));
  const fol = sg.filter(s => s.kind === "follow"); const pend = DB.commitments.filter(c => c.owner === "me" && c.status === "pending"); const wait = DB.commitments.filter(c => c.owner === "them" && c.status === "waiting");
  const up = DB.events.filter(e => e.date >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4); const rec = DB.memories.slice(-4).reverse();
  const hr = new Date().getHours();
  const cm = c => '<div class="card"><div class="row"><div class="grow"><div class="t" dir="auto">' + esc(c.title) + '</div><div class="m">' + esc(c.personName || "") + (c.due ? " · " + fmtDate(c.due) : "") + "</div></div>" + (c.status === "done" ? "" : '<button class="btn" data-done="' + c.id + '">Done</button>') + "</div></div>";
  const e = hr >= 18 ? evening() : null;
  return "<h1>" + (hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening") + "</h1><p class=sub>Your mind, organized.</p>" +
    (DB.settings.paused ? '<div class="card" style="border-color:#5a3a1a">Memory is paused. <button class="btn" id="resume">Resume</button></div>' : "") +
    '<div class="card"><div class="row"><div class="grow t">' + (hr >= 18 ? "Evening review" : "Daily briefing") + '</div><button class="btn p" id="speakBrief">▶ Hear it</button></div><div class="m" style="white-space:pre-wrap;margin-top:8px;font-size:13px;color:#cfd0d4" dir="auto">' + esc(hr >= 18 && e ? (e.open.length ? S("Still open today:\n", "لسا مفتوح اليوم:\n") + e.open.map(x => "• " + x.title).join("\n") : S("Nothing overdue today.", "ما في شي متأخر اليوم.")) + (e.tom.length ? S("\n\nTomorrow:\n", "\n\nبكرة:\n") + e.tom.map(x => "• " + x.title).join("\n") : "") : briefing()) + "</div></div>" +
    sec("Today’s Focus") + (focus.length ? focus.map(f => '<div class="card"><div class="row"><div class="grow"><div class="t" dir="auto">' + esc(f.t) + '</div><div class="m">' + f.m + "</div></div>" + (f.id ? '<button class="btn" data-done="' + f.id + '">Done</button>' : "") + "</div></div>").join("") : empty("Nothing due today.")) +
    sec("AI Suggestions") + (sg.length ? sg.slice(0, 5).map(sgCard).join("") : empty("No suggestions right now. I only suggest things based on what you’ve saved.")) +
    sec("People to Follow Up With") + (fol.length ? fol.slice(0, 4).map(sgCard).join("") : empty("No one comes to mind.")) +
    sec("Pending Commitments") + (pend.length ? pend.slice(0, 4).map(cm).join("") : empty("No open promises.")) +
    sec("Waiting for Others") + (wait.length ? wait.slice(0, 4).map(cm).join("") : empty("You’re not waiting on anyone.")) +
    sec("Upcoming Meetings") + (up.length ? up.map(e => '<div class="card"><div class="t" dir="auto">' + esc(e.title) + '</div><div class="m">' + fmtDate(e.date) + (e.time ? " · " + esc(e.time) : "") + "</div></div>").join("") : empty("No meetings saved.")) +
    sec("Recently Added Memories") + (rec.length ? rec.map(memCard).join("") : empty("Nothing yet. Tap the mic and tell me about your day."));
}
const sec = t => '<div class="sec"><h2>' + t + "</h2></div>"; const empty = t => '<div class="empty">' + t + "</div>";
const sgCard = s => '<div class="card"><div class="t" dir="auto">' + esc(s.text) + '</div><div class="acts">' + (s.act !== "none" ? '<button class="btn p" data-sg="' + s.id + '">' + (s.act === "draft" ? "Draft check-in" : s.act === "prep" ? "Add to notes" : "Remind me") + "</button>" : "") + '<button class="btn" data-dis="' + s.id + '">Dismiss</button></div></div>';
function memCard(m) { const p = m.personId ? byId(DB.people, m.personId) : null; return '<div class="card" data-mem="' + m.id + '"><div class="m">' + (m.important ? "★ " : "") + esc(tType(m.type)) + (p ? " · " + esc(p.name) : "") + " · " + fmtDate(m.date) + '</div><div class="t" dir="auto" style="margin-top:3px">' + esc(m.text) + '</div><div style="margin-top:6px">' + kindChip(m.kind) + '</div><div class="src">' + esc(srcLine(m.inputId)) + '</div><div class="acts"><button class="btn" data-star="' + m.id + '">' + (m.important ? "★ Important" : "☆ Mark important") + '</button><button class="btn" data-edit="' + m.id + '">Edit</button><button class="btn d" data-del="' + m.id + '">Delete</button></div></div>'; }
function vCommit() {
  const mine = tab === "me"; const l = DB.commitments.filter(c => c.owner === (mine ? "me" : "them")).sort((a, b) => (a.status === "done") - (b.status === "done") || (a.due || "9").localeCompare(b.due || "9"));
  return "<h1>My Commitments</h1><p class=sub>Promises & Commitments</p>" + '<div class="tabs"><button data-tab="me" class="' + (mine ? "on" : "") + '">I Promised</button><button data-tab="them" class="' + (!mine ? "on" : "") + '">They Promised</button></div>' +
    (l.length ? l.map(c => '<div class="card"><div class="row"><div class="grow"><div class="t" dir="auto" style="' + (c.status === "done" ? "text-decoration:line-through;color:#777" : "") + '">' + esc(c.title) + '</div><div class="m">' + esc(c.personName || "—") + " · " + (c.due ? S("due ", "موعده ") + fmtDate(c.due) : S("no date", "بدون موعد")) + " · " + (c.status === "done" ? S("done", "منجز") : c.status === "waiting" ? S("waiting", "بانتظار") : S("pending", "معلّق")) + "</div>" + kindChip(c.kind) + '</div></div><div class="src">' + esc(srcLine(c.inputId)) + '</div><div class="acts">' + (c.status !== "done" ? '<button class="btn p" data-done="' + c.id + '">Mark done</button>' : '<button class="btn" data-reopen="' + c.id + '">Reopen</button>') + '<button class="btn d" data-delc="' + c.id + '">Delete</button></div></div>').join("") : empty(mine ? "No promises recorded. Try: “I told Ahmed I would send him the documents tomorrow.”" : "Nothing recorded. Try: “Sarah will send me the final design next Monday.”")) +
    '<div class="sec"><h2>Add manually</h2></div><div class="card"><input id="nc" placeholder="Commitment" dir="auto"><div class="row" style="margin-top:8px"><input id="np" placeholder="Person"><input id="nd" type="date"></div><div class="acts"><button class="btn p" id="addc">Add to ' + (mine ? "I Promised" : "They Promised") + "</button></div></div>";
}
function vPeople() {
  if (openPerson) { const p = byId(DB.people, openPerson); if (!p) { openPerson = null; return vPeople(); }
    const tl = DB.interactions.filter(i => i.personId === p.id).sort((a, b) => b.date.localeCompare(a.date)); const cs = DB.commitments.filter(c => c.personId === p.id); const ms = DB.memories.filter(m => m.personId === p.id); const ev = DB.events.filter(e => e.personId === p.id && e.date >= today()); const nt = DB.notes.filter(n => n.personId === p.id);
    const kv = (k, v) => v ? '<div class="kv">' + k + ": <b dir=auto>" + esc(v) + "</b></div>" : "";
    return '<button class="btn" id="back">← People</button><h1>' + esc(p.name) + "</h1>" + '<div class="card">' + kv("Relationship", p.relation) + kv("Profession", p.profession) + kv("Communication", p.comm) + kv("Current project", p.project) + kv("Interests", (p.interests || []).join(", ")) + kv("Important dates", (p.dates || []).join(", ")) + kv("Last conversation", tl[0] ? fmtDate(tl[0].date) : "") + kv("Upcoming", ev.map(e => e.title + " " + fmtDate(e.date)).join("; ")) + (!(p.relation || p.profession || p.comm || p.project) ? '<div class="empty">No details yet.</div>' : "") + '<div class="acts"><button class="btn" data-pedit="' + p.id + '">Edit</button><button class="btn d" data-pdel="' + p.id + '">Delete contact</button></div></div>' +
      sec("Open commitments") + (cs.filter(c => c.status !== "done").map(c => '<div class="card"><div class="t" dir="auto">' + (c.owner === "me" ? S("You → ", "أنت ← ") : S("← ", "→ ")) + esc(c.title) + '</div><div class="m">' + (c.due ? fmtDate(c.due) : "no date") + "</div></div>").join("") || empty("None.")) +
      sec("Interaction history") + (tl.length ? '<div class="tl">' + tl.map(i => '<div class="it"><div class="m">' + fmtDate(i.date) + '</div><div class="t" dir="auto">' + esc(i.summary) + '</div><div class="m">' + (i.links || []).length + S(" linked record(s)", " سجل مرتبط") + "</div></div>").join("") + "</div>" : empty("No interactions yet.")) +
      sec("Memories & notes") + (ms.map(memCard).join("") + nt.map(n => '<div class="card"><div class="m">' + S('Note · ', 'ملاحظة · ') + kindLabel(n.kind) + '</div><div class="t" style="white-space:pre-wrap" dir="auto">' + esc(n.title + "\n" + n.text) + "</div></div>").join("") || empty("None.")); }
  const sg = suggestions().filter(s => s.kind === "follow");
  const rows = DB.people.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => { const last = DB.interactions.filter(i => i.personId === p.id).sort((a, b) => b.date.localeCompare(a.date))[0]; const open = DB.commitments.filter(c => c.personId === p.id && c.status !== "done").length; return '<div class="card" data-p="' + p.id + '"><div class="row"><div class="grow"><div class="t" dir="auto">' + esc(p.name) + '</div><div class="m">' + esc([p.relation, p.profession].filter(Boolean).join(" · ") || S("Contact", "جهة اتصال")) + (last ? S(" · last ", " · آخر مرة ") + fmtDate(last.date) : "") + "</div></div>" + (open ? '<span class="chip">' + open + S(" open", " مفتوح") + "</span>" : "") + "</div></div>"; }).join("");
  return "<h1>Relationship Insights</h1><p class=sub>People, history and gentle follow-ups.</p>" + (sg.length ? sec("Follow-up suggestions") + sg.map(sgCard).join("") : "") + sec("Everyone") + (rows || empty("No contacts yet. Say “I met Sarah today…” and she’ll appear.")) + '<div class="card"><input id="npn" placeholder="Add a contact" dir="auto"><div class="acts"><button class="btn p" id="addp">Add</button></div></div>';
}
function vMem() {
  const q = memFilter.toLowerCase(); const l = DB.memories.filter(m => !q || (m.text + m.type).toLowerCase().includes(q)).slice().reverse();
  return "<h1>Memory</h1><p class=sub>Everything is traceable to what you said.</p>" + '<input id="msearch" placeholder="Search memories" value="' + esc(memFilter) + '" dir="auto">' +
    '<div class="sec"><h2>Ask Mindly</h2></div><div class="row"><input id="qa" placeholder="What do you remember about Sarah?" dir="auto"><button class="btn p" id="qgo">Ask</button></div><div class="chat" id="chat" style="margin-top:10px"></div>' +
    sec(S("Saved memories (" + l.length + ")", "الذكريات المحفوظة (" + l.length + ")")) + (l.map(memCard).join("") || empty("No memories yet.")) +
    '<div class="sec"><h2>Quick add</h2></div><div class="card"><textarea id="qadd" rows="3" placeholder="I met Sarah today. She works in marketing, prefers email, and is working on a new beauty brand." dir="auto"></textarea><div class="acts"><button class="btn p" id="qsave">Save</button></div></div>';
}
function bind(m) {
  m.querySelectorAll("[data-done]").forEach(b => b.onclick = e => { e.stopPropagation(); const id = b.dataset.done; const r = byId(DB.commitments, id) || byId(DB.tasks, id); if (r) { r.status = "done"; r.doneAt = Date.now(); save(); render(); toast("Marked done"); } });
  m.querySelectorAll("[data-reopen]").forEach(b => b.onclick = () => { const r = byId(DB.commitments, b.dataset.reopen); r.status = r.owner === "me" ? "pending" : "waiting"; save(); render(); });
  m.querySelectorAll("[data-delc]").forEach(b => b.onclick = () => { if (b.dataset.sure) { DB.commitments = DB.commitments.filter(c => c.id !== b.dataset.delc); save(); render(); } else { b.dataset.sure = 1; b.textContent = T("Tap again to delete"); } });
  m.querySelectorAll("[data-sg]").forEach(b => b.onclick = () => { const s = suggestions().find(x => x.id === b.dataset.sg); if (s) toast(approveSuggestion(s)); render(); });
  m.querySelectorAll("[data-dis]").forEach(b => b.onclick = () => { DB.dismissed[b.dataset.dis] = 1; save(); render(); });
  m.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
  m.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { openPerson = b.dataset.p; render(); });
  m.querySelectorAll("[data-star]").forEach(b => b.onclick = () => { const r = byId(DB.memories, b.dataset.star); r.important = !r.important; save(); render(); });
  m.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { if (b.dataset.sure) { DB.memories = DB.memories.filter(x => x.id !== b.dataset.del); save(); render(); } else { b.dataset.sure = 1; b.textContent = T("Tap again to delete"); } });
  m.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editMemory(b.dataset.edit));
  m.querySelectorAll("[data-pedit]").forEach(b => b.onclick = () => editPerson(b.dataset.pedit));
  m.querySelectorAll("[data-pdel]").forEach(b => b.onclick = () => { if (b.dataset.sure) { const id = b.dataset.pdel; DB.people = DB.people.filter(p => p.id !== id); DB.commitments.forEach(c => { if (c.personId === id) c.personId = null; }); openPerson = null; save(); render(); } else { b.dataset.sure = 1; b.textContent = T("Tap again to delete"); } });
  const on = (id, f) => { const e = $(id); if (e) e.onclick = f; };
  on("#back", () => { openPerson = null; render(); }); on("#resume", () => { DB.settings.paused = false; save(); render(); });
  on("#speakBrief", () => { const t = briefing(); speak(t, isAr(t) ? "ar-EG" : "en-US", true); });
  on("#addc", () => { const t = $("#nc").value.trim(); if (!t) return; const pn = $("#np").value.trim(); let p = pn && DB.people.find(x => x.name.toLowerCase() === pn.toLowerCase()); if (pn && !p) { p = { id: uid("p"), name: pn, relation: "", profession: "", comm: "", project: "", interests: [], dates: [], extra: {}, created: Date.now(), srcs: [] }; DB.people.push(p); } const inp = { id: uid("in"), text: "Added manually: " + t, ts: Date.now(), source: "manual" }; DB.inputs.push(inp); DB.commitments.push({ id: uid("c"), title: t, personId: p ? p.id : null, personName: pn, owner: tab, due: $("#nd").value || null, status: tab === "me" ? "pending" : "waiting", kind: "confirmed", inputId: inp.id, created: Date.now() }); save(); render(); });
  on("#addp", () => { const n = $("#npn").value.trim(); if (!n) return; DB.people.push({ id: uid("p"), name: n, relation: "", profession: "", comm: "", project: "", interests: [], dates: [], extra: {}, created: Date.now(), srcs: [] }); save(); render(); });
  const ms = $("#msearch"); if (ms) { ms.oninput = () => { memFilter = ms.value; const pos = ms.selectionStart; render(); const n = $("#msearch"); n.focus(); n.setSelectionRange(pos, pos); }; }
  const qa = async () => { const q = $("#qa").value.trim(); if (!q) return; const r = await respondAI(q); const c = $("#chat"); c.innerHTML += '<div class="bub u" dir="auto">' + esc(q) + '</div><div class="bub a" dir="auto">' + esc(r.text) + (r.srcs.length ? '<div class="src">' + r.srcs.filter(Boolean).map(s => esc(srcLine(s))).filter(Boolean).slice(0, 3).join("<br>") + "</div>" : "") + "</div>"; $("#qa").value = ""; };
  on("#qgo", qa); const qi = $("#qa"); if (qi) qi.onkeydown = e => { if (e.key === "Enter") qa(); };
  on("#qsave", async () => { const t = $("#qadd").value.trim(); if (!t) return; const r = await respondAI(t); toast(r.text.slice(0, 120)); view = "mem"; render(); });
}
function editMemory(id) { const r = byId(DB.memories, id); sheet('<h3 style="margin:0 0 10px">Edit memory</h3><textarea id="et" rows="4" dir="auto">' + esc(r.text) + '</textarea><div class="m" style="margin:10px 0 4px">Type</div><select id="ek"><option value="confirmed">Confirmed fact</option><option value="assumption">My assumption</option></select><div class="acts"><button class="btn p" id="es">Save correction</button><button class="btn" id="ex">Cancel</button></div>', () => { $("#ek").value = r.kind === "suggestion" ? "assumption" : r.kind; $("#es").onclick = () => { r.text = $("#et").value.trim() || r.text; r.kind = $("#ek").value; save(); closeSheet(); render(); }; $("#ex").onclick = closeSheet; }); }
function editPerson(id) { const p = byId(DB.people, id); const f = (l, k) => '<div class="m" style="margin:8px 0 3px">' + l + '</div><input data-k="' + k + '" value="' + esc(p[k] || "") + '" dir="auto">'; sheet('<h3 style="margin:0">' + S("Edit ", "تعديل ") + esc(p.name) + "</h3>" + f("Name", "name") + f("Relationship", "relation") + f("Profession", "profession") + f("Communication preference", "comm") + f("Current project", "project") + '<div class="acts"><button class="btn p" id="es">Save</button><button class="btn" id="ex">Cancel</button></div>', () => { $("#es").onclick = () => { document.querySelectorAll(".sheet [data-k]").forEach(i => { if (i.value.trim() || i.dataset.k !== "name") p[i.dataset.k] = i.value.trim(); }); save(); closeSheet(); render(); }; $("#ex").onclick = closeSheet; }); }
function sheet(html, after) { closeSheet(); const d = document.createElement("div"); d.className = "dlg"; d.id = "dlg"; d.innerHTML = '<div class="sheet"><div class="shead"><button class="sx" id="sx" aria-label="Close">\u2715</button></div>' + html + "</div>"; d.onclick = e => { if (e.target === d) closeSheet(); }; d.querySelector("#sx").onclick = closeSheet; document.body.appendChild(d); after && after(); tr(d); }
function closeSheet() { const d = $("#dlg"); if (d) d.remove(); }
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
function settingsSheet() { const ALW = DB.settings.allow; const L = { people: "People & relationships", commitments: "Promises & commitments", tasks: "Tasks", events: "Meetings & dates", memories: "Ideas, decisions, discussions", preferences: "Preferences & personal details" };
  sheet('<h3 style="margin:0 0 6px">What Mindly may remember</h3><div class="m">Turning a category off stops new saving there. Existing items stay until you delete them.</div>' + Object.keys(L).map(k => '<label class="sw"><span>' + L[k] + '</span><input type="checkbox" data-a="' + k + '" ' + (ALW[k] ? "checked" : "") + "></label>").join("") + '<label class="sw"><span>Language</span><select id="lg" style="width:auto"><option value="en">English</option><option value="ar">العربية</option></select></label><label class="sw"><span>Visual quality</span><select id="ql" style="width:auto"><option value="high">High</option><option value="balanced">Balanced</option><option value="low">Low (saves battery)</option></select></label><label class="sw"><span>Pause all memory</span><input type="checkbox" id="pz" ' + (DB.settings.paused ? "checked" : "") + '></label><label class="sw"><span>Mute voice replies</span><input type="checkbox" id="mt" ' + (DB.settings.mute ? "checked" : "") + '></label><div class="acts"><button class="btn p" id="es">Done</button><button class="btn d" id="wipe">Erase everything</button></div>', () => {
    { const mob = /iphone|ipad|ipod|android/i.test(navigator.userAgent); $("#ql").value = DB.settings.quality || (mob ? "balanced" : "high"); $("#ql").onchange = e => { DB.settings.quality = e.target.value; save(); try { GL.setQuality(); } catch (x) {} }; } $("#lg").value = DB.settings.lang; $("#lg").onchange = e => setLang(e.target.value); document.querySelectorAll("[data-a]").forEach(c => c.onchange = () => { ALW[c.dataset.a] = c.checked; save(); }); $("#pz").onchange = e => { DB.settings.paused = e.target.checked; save(); }; $("#mt").onchange = e => { DB.settings.mute = e.target.checked; save(); syncMute(); };
    $("#es").onclick = () => { closeSheet(); render(); }; $("#wipe").onclick = e => { if (e.target.dataset.s) { DB = blank(); save(); closeSheet(); render(); } else { e.target.dataset.s = 1; e.target.textContent = T("Tap again: erase all data"); } }; }); }
function toast(t) { const e = $("#toast"); e.textContent = T(t); e.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove("on"), 2600); }
$("#langBtn").onclick = () => setLang(DB.settings.lang === "ar" ? "en" : "ar"); $("#setBtn").onclick = settingsSheet; $("#vset").onclick = settingsSheet;

/* ============================================================
   LANGUAGE — full English / Arabic (RTL) switch.
   Static UI strings are translated through this dictionary; every
   sentence the assistant itself generates uses S(en, ar).
   ============================================================ */
const AR = {
  "Today": "اليوم", "Commitments": "الالتزامات", "People": "الناس", "Memory": "الذاكرة",
  "What Mindly may remember": "شو مسموح لمايندلي يتذكّر", "Turning a category off stops new saving there. Existing items stay until you delete them.": "إيقاف أي فئة بيوقف الحفظ الجديد فيها. اللي انحفظ قبل بيضل لحد ما تحذفه.",
  "People & relationships": "الناس والعلاقات", "Promises & commitments": "الوعود والالتزامات", "Tasks": "المهام", "Meetings & dates": "الاجتماعات والتواريخ", "Ideas, decisions, discussions": "الأفكار والقرارات والنقاشات", "Preferences & personal details": "التفضيلات والتفاصيل الشخصية",
  "Pause all memory": "إيقاف الذاكرة مؤقتاً", "Mute voice replies": "كتم الرد الصوتي", "Done": "تم", "Erase everything": "مسح كل شي", "Tap again: erase all data": "اضغط مرة ثانية: مسح كل البيانات", "Language": "اللغة", "Visual quality": "جودة الرسوم", "High": "عالية", "Balanced": "متوازنة", "Low (saves battery)": "منخفضة (توفر البطارية)", "Tap again to delete": "اضغط مرة ثانية للحذف",
  "Good morning": "صباح الخير", "Good afternoon": "مساء الخير", "Good evening": "مساء الخير", "Your mind, organized.": "عقلك، منظّم.", "Memory is paused.": "الذاكرة متوقفة مؤقتاً.", "Resume": "استئناف",
  "Daily briefing": "الملخص اليومي", "Evening review": "مراجعة المساء", "▶ Hear it": "▶ اسمعه", "Today’s Focus": "تركيز اليوم", "AI Suggestions": "اقتراحات الذكاء", "People to Follow Up With": "ناس تتابع معهم", "Pending Commitments": "التزامات معلّقة", "Waiting for Others": "بانتظار الآخرين", "Upcoming Meetings": "اجتماعات قادمة", "Recently Added Memories": "ذكريات أُضيفت مؤخراً",
  "Nothing due today.": "ما في شي مستحق اليوم.", "No suggestions right now. I only suggest things based on what you’ve saved.": "ما في اقتراحات هلأ. بقترح بس بناءً على اللي حفظته.", "No one comes to mind.": "ما في حدا بخطر ببالي.", "No open promises.": "ما في وعود مفتوحة.", "You’re not waiting on anyone.": "مش منتظر حدا.", "No meetings saved.": "ما في اجتماعات محفوظة.", "Nothing yet. Tap the mic and tell me about your day.": "ما في شي لسا. اضغط المايك واحكيلي عن يومك.",
  "Dismiss": "تجاهل", "Remind me": "ذكّرني", "Draft check-in": "جهّز رسالة تطمين", "Add to notes": "أضف للملاحظات",
  "My Commitments": "التزاماتي", "Promises & Commitments": "الوعود والالتزامات", "I Promised": "أنا وعدت", "They Promised": "هم وعدوا", "Mark done": "تم الإنجاز", "Reopen": "إعادة فتح", "Delete": "حذف", "Add manually": "إضافة يدوية", "Commitment": "الالتزام", "Person": "الشخص", "Add to I Promised": "أضف إلى «أنا وعدت»", "Add to They Promised": "أضف إلى «هم وعدوا»",
  "No promises recorded. Try: “I told Ahmed I would send him the documents tomorrow.”": "ما في وعود مسجلة. جرّب: «قلت لأحمد إني رح ابعتله الملفات بكرة».", "Nothing recorded. Try: “Sarah will send me the final design next Monday.”": "ما في شي مسجل. جرّب: «سارة رح تبعتلي التصميم النهائي يوم الاثنين الجاي».",
  "Relationship Insights": "رؤى العلاقات", "People, history and gentle follow-ups.": "الناس والتاريخ ومتابعات لطيفة.", "Follow-up suggestions": "اقتراحات المتابعة", "Everyone": "الجميع", "No contacts yet. Say “I met Sarah today…” and she’ll appear.": "ما في جهات اتصال لسا. قول «قابلت سارة اليوم…» وبتظهر.", "Add a contact": "أضف جهة اتصال", "Add": "إضافة", "← People": "→ الناس", "Edit": "تعديل", "Delete contact": "حذف جهة الاتصال", "Open commitments": "الالتزامات المفتوحة", "None.": "لا شي.", "Interaction history": "سجل التفاعل", "No interactions yet.": "ما في تفاعلات لسا.", "Memories & notes": "ذكريات وملاحظات", "No details yet.": "ما في تفاصيل لسا.", "Contact": "جهة اتصال",
  "Relationship:": "العلاقة:", "Profession:": "المهنة:", "Communication:": "التواصل:", "Current project:": "المشروع الحالي:", "Interests:": "الاهتمامات:", "Important dates:": "تواريخ مهمة:", "Last conversation:": "آخر محادثة:", "Upcoming:": "قادم:",
  "Name": "الاسم", "Relationship": "العلاقة", "Profession": "المهنة", "Communication preference": "طريقة التواصل المفضلة", "Current project": "المشروع الحالي", "Save": "حفظ", "Cancel": "إلغاء",
  "Everything is traceable to what you said.": "كل شي بيرجع لمصدره: اللي إنت قلته.", "Search memories": "ابحث في الذكريات", "Ask Mindly": "اسأل مايندلي", "Ask": "اسأل", "What do you remember about Sarah?": "شو بتتذكّر عن سارة؟", "No memories yet.": "ما في ذكريات لسا.", "Quick add": "إضافة سريعة",
  "I met Sarah today. She works in marketing, prefers email, and is working on a new beauty brand.": "قابلت سارة اليوم. بتشتغل في التسويق وبتفضل الإيميل، وبتشتغل على براند تجميل جديد.",
  "Edit memory": "تعديل الذاكرة", "Confirmed fact": "معلومة مؤكدة", "My assumption": "افتراض مني", "Type": "النوع", "Save correction": "حفظ التصحيح", "☆ Mark important": "☆ علّم كمهم", "★ Important": "★ مهم",
  "Ready when you are.": "جاهز وقت ما تحب.", "Listening…": "عم سمعك…", "Thinking…": "عم فكّر…", "Speaking…": "عم احكي…", "End conversation": "إنهاء المحادثة", "Type to Mindly…": "اكتب لمايندلي…", "Send": "إرسال", "voice ready": "الصوت جاهز", "text only": "كتابة فقط", "offline": "غير متصل",
  "Marked done": "تم تعليمها منجزة", "Speech recognition isn’t supported in this browser. Type instead.": "المتصفح ما بدعم التعرف على الصوت. اكتب بدل.", "Microphone blocked. Allow it in the browser, or type instead.": "المايك محجوب. اسمح فيه من المتصفح أو اكتب.", "Microphone permission denied.": "تم رفض إذن المايك.", "Speech output isn’t supported here.": "الصوت المنطوق غير مدعوم هون.", "WebGL isn’t available on this device.": "WebGL مش متوفر على هالجهاز.",
  "Settings": "الإعدادات", "Text": "نص", "Microphone": "المايك", "Mute voice": "كتم الصوت", "Voice": "صوت",
  "Still here. Tap the mic to talk again.": "لسا هون. اضغط المايك لنكمل حكي.", "Speech recognition needs an internet connection.": "التعرف على الصوت بدو إنترنت.", "Couldn’t use the microphone. Tap the mic to try again.": "ما قدرت استخدم المايك. اضغط المايك وجرّب.", "No Arabic voice found on this phone. Install one in your phone’s text-to-speech settings.": "ما لقيت صوت عربي بجوالك. نزّل واحد من إعدادات النطق (Text-to-speech).", "Couldn’t play the voice. The reply is on screen.": "ما اشتغل الصوت. الرد مكتوب على الشاشة."
};
const T = s => (DB.settings.lang === "ar" && AR[s]) || s;
function tr(root) {
  const ar = DB.settings.lang === "ar";
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) {
    const cur = n.nodeValue; const en = n.__en !== undefined ? n.__en : cur; const s = en.trim(); if (!s) continue;
    if (ar && AR[s]) { n.__en = en; n.nodeValue = en.replace(s, AR[s]); } else if (!ar && n.__en !== undefined) { n.nodeValue = n.__en; n.__en = undefined; }
  }
  root.querySelectorAll("[placeholder],[aria-label]").forEach(e => { for (const a of ["placeholder", "aria-label"]) { if (!e.hasAttribute(a)) continue; const k = "en_" + a.replace("-", "_"); if (e.dataset[k] === undefined) e.dataset[k] = e.getAttribute(a); const en = e.dataset[k]; e.setAttribute(a, ar && AR[en] ? AR[en] : en); } });
}
function applyLang() {
  const ar = DB.settings.lang === "ar"; document.documentElement.lang = ar ? "ar" : "en"; document.documentElement.dir = ar ? "rtl" : "ltr";
  V.lang = ar ? "ar-EG" : "en-US"; $("#vlang").textContent = ar ? "عربي" : "EN"; $("#langBtn").textContent = ar ? "EN" : "عربي";
  const vs = $("#vstat"); if (vs) vs.textContent = T(({ idle: "Ready when you are.", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" })[V.state] || "Ready when you are.");
  $("#conn span").textContent = T(SR ? "voice ready" : "text only");
  render(); tr(document.body);
}
function setLang(l) { DB.settings.lang = l; save(); applyLang(); }

/* ============================================================
   VOICE — mic → live transcript → engine → reply → speech.
   The bubble reads real mic amplitude (listening) and a speech-rhythm
   envelope (speaking; browsers don't expose TTS audio samples).
   ============================================================ */
const V = { state: "idle", amp: 0, target: 0, lang: "en-US", rec: null, stream: null, an: null, ac: null, buf: null, speaking: false, pulse: 0, active: false, shown: "" };
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function setState(s) { V.state = s; const L = { idle: "Ready when you are.", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" }; $("#vstat").textContent = T(L[s]); $("#vmic").classList.toggle("rec", s === "listening"); }
function setTx(t) { const e = $("#vtx"); e.textContent = t; e.dir = "auto"; }
function syncMute() { $("#vmute").classList.toggle("off", DB.settings.mute); if (DB.settings.mute && "speechSynthesis" in window) speechSynthesis.cancel(); }
function openVoiceScreen() { $("#voice").classList.add("on"); V.active = true; V.lang = DB.settings.lang === "ar" ? "ar-EG" : "en-US"; $("#vlang").textContent = V.lang === "ar-EG" ? "عربي" : "EN"; tr($("#voice")); $("#conn").className = SR ? "ok" : ""; $("#conn span").textContent = T(SR ? "voice ready" : "text only"); syncMute(); setState("idle"); setTx(""); GL.start(); }
function closeVoiceScreen() { V.active = false; if (typeof setConvo === "function") setConvo(false); stopListen(true); if ("speechSynthesis" in window) speechSynthesis.cancel(); $("#voice").classList.remove("on"); GL.stop(); setState("idle"); render(); }
const MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
V.convo = false; V.turn = 0; V.empty = 0; V.wl = null; V.wd = 0;
function setConvo(on) {
  V.convo = on; V.turn++; V.empty = 0;
  if (on) { try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then(l => { V.wl = l; }).catch(() => {}); } catch (e) {} }
  else { try { if (V.wl) V.wl.release(); } catch (e) {} V.wl = null; }
  $("#vmic").classList.toggle("convo", on);
}
function unlockSpeech() { if (!("speechSynthesis" in window) || V.unlocked) return; try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); V.unlocked = true; } catch (e) {} }
function pickVoice(lang) {
  const vs = speechSynthesis.getVoices(); const p = lang.slice(0, 2);
  return vs.find(x => x.lang === lang) || vs.find(x => x.lang.replace("_", "-") === lang) || vs.find(x => x.lang.toLowerCase().startsWith(p)) || null;
}
function backToListening(delay) {
  if (!V.convo || !V.active) { if (V.active) setState("idle"); return; }
  const t = V.turn; setState("idle"); setTimeout(() => { if (V.convo && V.active && V.turn === t && V.state === "idle") startListen(); }, delay || 400);
}
function endConvo() { setConvo(false); stopListen(true); if ("speechSynthesis" in window) speechSynthesis.cancel(); V.speaking = false; setState("idle"); }
async function startListen() {
  if ("speechSynthesis" in window) speechSynthesis.cancel(); V.speaking = false;
  if (!SR) { setConvo(false); $("#vtext").classList.add("on"); $("#vin").focus(); toast("Speech recognition isn’t supported in this browser. Type instead."); return; }
  try {
    if (!V.stream && !V.permOk) {
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (MOBILE) { st.getTracks().forEach(t => t.stop()); V.permOk = true; }
      else { V.stream = st; V.ac = new (window.AudioContext || window.webkitAudioContext)(); const src = V.ac.createMediaStreamSource(st); V.an = V.ac.createAnalyser(); V.an.fftSize = 512; V.an.smoothingTimeConstant = .6; src.connect(V.an); V.buf = new Uint8Array(V.an.fftSize); }
    }
    if (V.ac && V.ac.state === "suspended") V.ac.resume();
  } catch (e) { setConvo(false); setState("idle"); toast("Microphone blocked. Allow it in the browser, or type instead."); $("#vtext").classList.add("on"); return; }
  const turn = V.turn; const r = new SR(); r.lang = V.lang; r.interimResults = true; r.continuous = false; V.rec = r; let finalT = "", fatal = false;
  r.onresult = ev => { let it = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const x = ev.results[i]; if (x.isFinal) finalT += x[0].transcript; else it += x[0].transcript; } V.pulse = 1; setTx(finalT + it); };
  r.onerror = ev => { if (ev.error === "not-allowed" || ev.error === "service-not-allowed") { fatal = true; setConvo(false); toast("Microphone permission denied."); } else if (ev.error === "audio-capture" || ev.error === "network" || ev.error === "language-not-supported") { fatal = true; setConvo(false); toast(ev.error === "network" ? "Speech recognition needs an internet connection." : "Couldn’t use the microphone. Tap the mic to try again."); } };
  r.onend = () => {
    if (V.rec === r) V.rec = null; if (V.turn !== turn && !V.convo) { if (V.state === "listening") setState("idle"); return; }
    if (V.state !== "listening") return;
    const t = (finalT || $("#vtx").textContent).trim();
    if (t) { V.empty = 0; handle(t); return; }
    setState("idle");
    if (fatal || !V.convo) return;
    if (++V.empty >= 4) { setConvo(false); toast("Still here. Tap the mic to talk again."); return; }
    backToListening(150);
  };
  setState("listening"); setTx(""); try { r.start(); } catch (e) { setState("idle"); if (V.convo) backToListening(600); }
}
function stopListen(silent) { if (V.rec) { try { silent ? V.rec.abort() : V.rec.stop(); } catch (e) {} } if (silent && V.state === "listening") setState("idle"); }
function handle(text) {
  const turn = ++V.turn; setState("thinking"); setTx(text);
  setTimeout(async () => { let r; try { r = await respondAI(text); } catch (e) { r = { text: "Sorry, something went wrong on my side. Nothing was changed." }; } if (V.turn !== turn || !V.active) return; showReply(r, text); }, 60);
}
function showReply(r, q) {
  const ar = (r.text.match(/[\u0600-\u06FF]/g) || []).length > (r.text.match(/[A-Za-z]/g) || []).length; setTx(r.text);
  if (DB.settings.mute || !("speechSynthesis" in window)) { backToListening(1500); return; }
  speak(r.text, ar ? "ar-EG" : "en-US", false, () => backToListening(350));
}
function speak(text, lang, fromHome, done) {
  if (!("speechSynthesis" in window)) { toast("Speech output isn’t supported here."); if (done) done(); return; }
  speechSynthesis.cancel(); const myTurn = ++V.wd;
  const clean = text.replace(/[•*_#]/g, " ").replace(/\s+/g, " ").trim();
  const parts = (clean.match(/[^.!?؟۔\n]+[.!?؟۔]*/g) || [clean]).map(s => s.trim()).filter(Boolean); const chunks = []; let cur = "";
  for (const p of parts) { if ((cur + " " + p).length > 160 && cur) { chunks.push(cur); cur = p; } else cur = cur ? cur + " " + p : p; } if (cur) chunks.push(cur);
  const v = pickVoice(lang); if (!v && lang.startsWith("ar") && !V.warned) { V.warned = true; toast("No Arabic voice found on this phone. Install one in your phone’s text-to-speech settings."); }
  let i = 0, started = false, finished = false;
  const finish = () => { if (finished || V.wd !== myTurn) return; finished = true; clearInterval(keep); V.speaking = false; if (done) done(); else if (V.active && !fromHome) setState("idle"); };
  const next = () => {
    if (V.wd !== myTurn) return; if (i >= chunks.length) { finish(); return; }
    const u = new SpeechSynthesisUtterance(chunks[i++]); u.lang = v ? v.lang : lang; if (v) u.voice = v; u.rate = 1; u.volume = 1;
    u.onstart = () => { started = true; V.speaking = true; if (V.active && !fromHome) setState("speaking"); };
    u.onboundary = () => { V.pulse = 1; };
    u.onend = () => next();
    u.onerror = ev => { if (ev && (ev.error === "canceled" || ev.error === "interrupted")) return; next(); };
    speechSynthesis.speak(u);
  };
  const keep = setInterval(() => { if (V.wd !== myTurn) { clearInterval(keep); return; } try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch (e) {} }, 4000);
  next();
  setTimeout(() => { if (!started && !finished && V.wd === myTurn) { try { speechSynthesis.cancel(); } catch (e) {} if (lang.startsWith("ar")) toast("Couldn’t play the voice. The reply is on screen."); finish(); } }, 4500);
}
$("#vmic").onclick = () => {
  unlockSpeech();
  if (V.state === "speaking") { V.wd++; speechSynthesis.cancel(); V.speaking = false; if (!V.convo) setConvo(true); startListen(); return; }
  if (V.convo) { endConvo(); return; }
  setConvo(true); startListen();
};
$("#vend").onclick = () => { endConvo(); closeVoiceScreen(); }; $("#vmute").onclick = () => { DB.settings.mute = !DB.settings.mute; save(); syncMute(); };
/* ---- natural voice: cloud TTS + cloud STT via the Worker, loop kept; falls back to browser speech ---- */
V.cloud = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
V.cloudBroken = false; V.ttsBroken = false; V.sttFail = 0; V.ttsFail = 0; V.rc = null; V.mic = null; V.msrc = null; V.cp = 0; V.out = null;
function ensureOut() {
  if (!V.out) { V.out = new (window.AudioContext || window.webkitAudioContext)(); V.oan = V.out.createAnalyser(); V.oan.fftSize = 512; V.oan.connect(V.out.destination); V.obuf = new Uint8Array(512); }
  if (V.out.state !== "running") V.out.resume().catch(() => {}); return V.out;
}
const _unlock = unlockSpeech;
unlockSpeech = function () { if (V.cloud) { try { ensureOut(); if (!V.cunlocked) { const b = V.out.createBuffer(1, 1, 22050), s = V.out.createBufferSource(); s.buffer = b; s.connect(V.out.destination); s.start(0); V.cunlocked = true; } } catch (e) { V.cloud = false; } } _unlock(); };
async function getMic() {
  if (V.mic && V.mic.getTracks().some(t => t.readyState === "live")) { ensureOut(); return V.mic; }
  V.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  ensureOut(); try { if (V.msrc) V.msrc.disconnect(); } catch (e) {}
  V.msrc = V.out.createMediaStreamSource(V.mic); V.an = V.out.createAnalyser(); V.an.fftSize = 512; V.an.smoothingTimeConstant = .5; V.msrc.connect(V.an); V.buf = new Uint8Array(V.an.fftSize); return V.mic;
}
function releaseMic() { try { if (V.mic) V.mic.getTracks().forEach(t => t.stop()); } catch (e) {} V.mic = null; try { if (V.msrc) V.msrc.disconnect(); } catch (e) {} V.msrc = null; V.an = null; }
function stopRec() { if (V.rc && V.rc.stop) V.rc.stop(true); V.rc = null; }
function stopCloudPlay() { V.cp++; if (V.csrc) { try { V.csrc.onended = null; V.csrc.stop(); } catch (e) {} V.csrc = null; } clearInterval(V.ptick); V.speaking = false; }
const _stl2 = stopListen; stopListen = function (s) { stopRec(); _stl2(s); };
const _sc = setConvo; setConvo = function (on) { _sc(on); if (!on) { stopRec(); stopCloudPlay(); releaseMic(); } };
const _ec2 = endConvo; endConvo = function () { stopRec(); stopCloudPlay(); _ec2(); };
const _sl = startListen; startListen = function () { if (V.cloud && !V.cloudBroken) return listenCloud(); return _sl(); };
const _sp = speak; speak = function (text, lang, fromHome, done) { if (V.cloud && !V.ttsBroken) return speakCloud(text, lang, fromHome, done); return _sp(text, lang, fromHome, done); };
function b64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
function toWav16k(parts, sr) {
  let n = 0; for (const p of parts) n += p.length; const all = new Float32Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  const r = sr / 16000, m = Math.floor(n / r), pcm = new Int16Array(m);
  for (let i = 0; i < m; i++) { let a = Math.floor(i * r), b = Math.max(a + 1, Math.floor((i + 1) * r)), s = 0; for (let k = a; k < b && k < n; k++) s += all[k]; let v = s / (b - a); v = Math.max(-1, Math.min(1, v)); pcm[i] = v < 0 ? v * 32768 : v * 32767; }
  const h = new DataView(new ArrayBuffer(44)), w = (p, t) => { for (let i = 0; i < t.length; i++) h.setUint8(p + i, t.charCodeAt(i)); };
  w(0, "RIFF"); h.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVEfmt "); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, 16000, true); h.setUint32(28, 32000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, "data"); h.setUint32(40, pcm.length * 2, true);
  const out = new Uint8Array(44 + pcm.length * 2); out.set(new Uint8Array(h.buffer)); out.set(new Uint8Array(pcm.buffer), 44); return out;
}
async function sttCloud(wav) {
  for (let a = 0; a < 2; a++) {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), 15000);
    try { const r = await fetch(AI_URL + "/stt", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audio: b64(wav), mime: "audio/wav", lang: DB.settings.lang === "ar" ? "ar" : "en" }), signal: c.signal }); if (r.ok) { const j = await r.json(); return String(j.text || "").trim(); } } catch (e) {} finally { clearTimeout(tm); }
    await new Promise(z => setTimeout(z, 400));
  }
  return null;
}
async function listenCloud() {
  const turn = V.turn; stopCloudPlay(); if ("speechSynthesis" in window) speechSynthesis.cancel();
  try { await getMic(); } catch (e) { setConvo(false); setState("idle"); toast("Microphone blocked. Allow it in the browser, or type instead."); $("#vtext").classList.add("on"); return; }
  if (V.turn !== turn || !V.active) return;
  const ctx = V.out, sp = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
  V.msrc.connect(sp); sp.connect(mute); mute.connect(ctx.destination);
  const sr = ctx.sampleRate; let parts = [], started = false, voiced = 0, lastV = 0, t0 = performance.now(), floor = 0, calMs = 0, fin = false;
  const ctl = { stop: null }; V.rc = ctl; setState("listening"); setTx("");
  const finish = async discard => {
    if (fin) return; fin = true; sp.onaudioprocess = null; try { V.msrc.disconnect(sp); } catch (e) {} try { sp.disconnect(); mute.disconnect(); } catch (e) {} if (V.rc === ctl) V.rc = null;
    if (discard || V.turn !== turn || !V.active) return;
    const empty = () => { setState("idle"); if (!V.convo) return; if (++V.empty >= 4) { setConvo(false); toast("Still here. Tap the mic to talk again."); return; } backToListening(100); };
    if (!started) { empty(); return; }
    setState("thinking"); setTx("…");
    const text = await sttCloud(toWav16k(parts, sr)); parts = [];
    if (V.turn !== turn || !V.active) return;
    if (text === null) { if (++V.sttFail >= 2) { V.cloudBroken = true; toast("Switching to your phone’s built-in recognition."); } else toast("Couldn’t hear that. Try again."); backToListening(300); return; }
    V.sttFail = 0; if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) { empty(); return; }
    V.empty = 0; handle(text);
  };
  ctl.stop = finish;
  sp.onaudioprocess = e => {
    if (fin) return; const d = e.inputBuffer.getChannelData(0), now = performance.now(), dur = d.length / sr * 1000; parts.push(new Float32Array(d));
    let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; const rms = Math.sqrt(s / d.length);
    if (calMs < 500) { floor = (floor * calMs + rms * dur) / (calMs + dur); calMs += dur; } const thr = Math.max(.02, floor * 3);
    if (!started && parts.length > 5) parts.shift();
    if (rms > thr && calMs >= 300) { voiced += dur; lastV = now; if (voiced >= 170 && !started) { started = true; setTx("…"); } }
    if ((started && now - lastV > 1300) || now - t0 > 25000 || (!started && now - t0 > 10000)) finish(false);
  };
}
function startPulse() { clearInterval(V.ptick); V.ptick = setInterval(() => { try { V.oan.getByteTimeDomainData(V.obuf); let s = 0; for (let i = 0; i < V.obuf.length; i++) { const x = (V.obuf[i] - 128) / 128; s += x * x; } V.pulse = Math.min(1, Math.sqrt(s / V.obuf.length) * 5); } catch (e) {} }, 50); }
async function ttsFetch(text) {
  const c = new AbortController(), tm = setTimeout(() => c.abort(), 20000);
  try {
    const r = await fetch(AI_URL + "/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: (/[\u0600-\u06FF]/.test(text) ? "Speak in a warm, relaxed, friendly Levantine Arabic conversational tone, like a close friend chatting, natural pace, no diacritics reading. Say: " : "Speak in a warm, relaxed, friendly, natural conversational tone, like a close friend chatting. Say: ") + text, voice: "Sulafat", model: V.ttsModel === false ? undefined : "gemini-3.8-flash-tts" }), signal: c.signal }); if (!r.ok) { if (V.ttsModel !== false) { V.ttsModel = false; clearTimeout(tm); return ttsFetch(text); } return null; } const j = await r.json(); if (!j.audio) return null;
    const bin = atob(j.audio), off = bin.slice(0, 4) === "RIFF" ? 44 : 0, n = (bin.length - off) >> 1, f = new Float32Array(n);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(off + 2 * i) | (bin.charCodeAt(off + 2 * i + 1) << 8); if (v >= 32768) v -= 65536; f[i] = v / 32768; }
    const m = /rate=(\d+)/i.exec(j.mime || ""), sr = m ? +m[1] : 24000; let end = n; const W = Math.round(sr * 0.01), rms = (a, z) => { let q = 0; for (let k = a; k < z; k++) q += f[k] * f[k]; return Math.sqrt(q / Math.max(1, z - a)); };
    for (let p = Math.max(4 * W, n - Math.round(sr * 0.6)); p < n - 3 * W; p += W) { const r0 = rms(p, p + W); if (r0 > 0.3 && rms(p - W, p) < 0.01 && rms(p - 3 * W, p - 2 * W) < 0.01 && Math.abs(rms(p + W, p + 2 * W) - r0) < 0.1 && Math.abs(rms(p + 2 * W, p + 3 * W) - r0) < 0.1) { end = p - 2 * W; break; } }
    for (let p = end - W; p > end - sr * 0.12 && p > 0; p -= W) { if (rms(p, p + W) < 0.004) { end = p + W; break; } }
    const fd = Math.min(end, Math.round(sr * 0.03)); for (let k = 0; k < fd; k++) f[end - 1 - k] *= k / fd; const fi = Math.min(end, Math.round(sr * 0.005)); for (let k = 0; k < fi; k++) f[k] *= k / fi;
    const buf = V.out.createBuffer(1, Math.max(1, end), sr); buf.copyToChannel(f.subarray(0, Math.max(1, end)), 0); return buf;
  } catch (e) { return null; } finally { clearTimeout(tm); }
}
function splitSpeech(text) {
  const clean = text.replace(/[•*_#]/g, " ").replace(/\s+/g, " ").trim(); const parts = (clean.match(/[^.!?؟۔\n]+[.!?؟۔]*/g) || [clean]).map(s => s.trim()).filter(Boolean); const ch = []; let cur = "";
  for (const p of parts) { if (!ch.length && !cur) { cur = p; if (cur.length > 90 || true) { ch.push(cur); cur = ""; } continue; } if ((cur + " " + p).length > 230 && cur) { ch.push(cur); cur = p; } else cur = cur ? cur + " " + p : p; } if (cur) ch.push(cur); return ch;
}
function speakCloud(text, lang, fromHome, done) {
  ensureOut(); if ("speechSynthesis" in window) speechSynthesis.cancel(); stopCloudPlay(); const my = V.cp; V.wd++;
  const chunks = splitSpeech(text), jobs = []; const start = i => { if (i < chunks.length && !jobs[i]) jobs[i] = ttsFetch(chunks[i]); }; start(0); start(1);
  (async () => {
    for (let i = 0; i < chunks.length; i++) {
      const buf = await jobs[i]; start(i + 2); if (V.cp !== my) return;
      if (!buf) { if (++V.ttsFail >= 3) V.ttsBroken = true; if (i === 0) toast("Using the phone’s built-in voice this time."); return _sp(chunks.slice(i).join(" "), lang, fromHome, done); }
      V.ttsFail = 0;
      await new Promise(res => { const s = V.out.createBufferSource(); s.buffer = buf; s.connect(V.oan); V.csrc = s; s.onended = () => res(); V.speaking = true; if (V.active && !fromHome) setState("speaking"); startPulse(); s.start(); });
      if (V.cp !== my) return;
    }
    V.speaking = false; clearInterval(V.ptick); V.csrc = null; if (done) done(); else if (V.active && !fromHome) setState("idle");
  })();
}
$("#vmic").onclick = () => {
  unlockSpeech();
  if (V.state === "speaking" || V.state === "thinking" && V.speaking) { V.wd++; stopCloudPlay(); if ("speechSynthesis" in window) speechSynthesis.cancel(); V.speaking = false; if (!V.convo) setConvo(true); startListen(); return; }
  if (V.convo) { endConvo(); return; }
  setConvo(true); startListen();
};
$("#vkb").onclick = () => { $("#vtext").classList.toggle("on"); if ($("#vtext").classList.contains("on")) $("#vin").focus(); };
const sendText = () => { const t = $("#vin").value.trim(); if (!t) return; $("#vin").value = ""; handle(t); }; $("#vsend").onclick = sendText; $("#vin").onkeydown = e => { if (e.key === "Enter") sendText(); };
$("#vlang").onclick = () => setLang(DB.settings.lang === "ar" ? "en" : "ar");
/* ---- Gemini Live real-time voice (falls back to the classic loop) ---- */
V.liveBroken = false; V.liveOn = false; V.ls = null;
const LIVE_WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=";
function liveCtx() {
  let o = []; const P = DB.people.slice(0, 40).map(p => p.name + (p.relation ? " (" + p.relation + ")" : "") + (p.profession ? ", " + p.profession : "")); if (P.length) o.push("People: " + P.join("; "));
  const C = DB.commitments.filter(c => c.status !== "done").slice(0, 30).map(c => (c.owner === "them" ? "waiting on " : "I owe ") + (c.personName || "") + ": " + c.title + (c.due ? " (due " + c.due + ")" : "")); if (C.length) o.push("Open commitments: " + C.join("; "));
  const T = DB.tasks.filter(t => t.status !== "done").slice(0, 20).map(t => t.title + (t.due ? " (due " + t.due + ")" : "")); if (T.length) o.push("Tasks: " + T.join("; "));
  const t0 = today(), E = DB.events.filter(e => e.date >= t0).slice(0, 15).map(e => e.date + " " + e.title); if (E.length) o.push("Upcoming events: " + E.join("; "));
  const M = DB.memories.slice(-20).map(m => String(m.text || "").slice(0, 120)); if (M.length) o.push("Recent notes: " + M.join("; "));
  return o.length ? (" Today is " + t0 + ". Saved Mindly data about the user (use it naturally when relevant, do not recite it unprompted): " + o.join(". ")).slice(0, 5000) : " Today is " + t0 + ". No data saved yet.";
}
const _LIVE_FILLER = /^(ok|okay|yes|yeah|yep|no|nope|thanks|thank you|thx|hi|hello|hey|bye|good|great|cool|nice|sure|hmm+|uh+|um+|اوكي|أوكي|تمام|اي|ايوه|أيوه|لا|شكرا|شكراً|مرحبا|هلا|اهلا|أهلا|يعطيك العافية|طيب|ماشي)[\s.!؟?،,]*$/i;
let _lastLive = { t: "", at: 0 };
function liveWorthSaving(t) { t = (t || "").trim(); if (!t) return false; if (_LIVE_FILLER.test(t)) return false; const words = t.split(/\s+/).length; if (words >= 3 || t.length >= 14) return true; /* short but may be an important fact: keep if it has a digit or looks like a statement about the user */ return /\d|\b(i am|i'm|my|allergic|vegan|born)\b|(^|\s)(انا|أنا|عندي|اسمي|حساسية)(\s|$)/i.test(t) || words === 2; }
function liveSave(t) { try { t = (t || "").trim(); if (!liveWorthSaving(t)) return; const key = t.toLowerCase().replace(/[\s.!؟?،,]+/g, " "); if (_lastLive.t === key && Date.now() - _lastLive.at < 120000) return; _lastLive = { t: key, at: Date.now() }; respondAI(t).then(r => { if (r && r.saved) { toast(S("Saved to Mindly.", "انحفظ في Mindly.")); try { if (!V.active) render(); } catch (e) {} } }).catch(() => {}); } catch (e) {} }
function liveLangRule() { return DB.settings.lang === "ar" ? "LANGUAGE RULE (highest priority): The app language is Arabic. Speak ONLY Arabic, in a natural Egyptian or Levantine dialect matching the user, and never reply in any other language such as Spanish, French or English, even if the audio is unclear, short, noisy or sounds like another language. Only switch to English if the user clearly speaks full English sentences to you. If you could not understand, say in Arabic that you did not catch it and ask to repeat." : "LANGUAGE RULE (highest priority): The app language is English. Reply in English, or in Arabic only if the user clearly speaks Arabic to you. Never reply in Spanish, French or any other language, even if the audio is unclear, short or noisy. If you could not understand, say so in English and ask to repeat."; }
function liveSystem() {
  return liveLangRule() + " " + liveCtx() + " " + "You are Mindly, the personal voice assistant of " + profileTxt() + " and second brain, speaking out loud in a live conversation. The user speaks casually, in Egyptian or Levantine (Shami) Arabic dialect, Modern Standard Arabic, or English, and often mixes them. Names and words may be pronounced informally or with a strong accent; listen carefully and use context to understand what was meant. Always reply in the language and dialect the user just used (Arabic dialect for dialect speech, English for English). Sound natural, warm and relaxed like a smart friend: short sentences, no lists, no reading out symbols or markdown, usually one to three sentences. If you truly did not catch something, ask briefly to repeat the specific part. Do not say you are an AI model unless asked. Things the user tells you about people, promises, tasks, events or ideas are saved automatically into Mindly in the background, so when the user asks you to remember something, just say briefly that you will." + " " + liveLangRule();
}
function liveSetState(s) { if (V.liveOn && V.state !== s) setState(s); }
async function startLive() {
  const turn = V.turn; unlockSpeech(); ensureOut(); const ctx = V.out;
  setState("thinking"); setTx("…");
  let token; try { const r = await fetch(AI_URL + "/live-token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); const j = await r.json(); token = j.token; if (!token) throw 0; } catch (e) { return false; }
  try { await getMic(); } catch (e) { setConvo(false); setState("idle"); toast("Microphone blocked. Allow it in the browser, or type instead."); $("#vtext").classList.add("on"); return "denied"; }
  if (!V.active) return "denied";
  const ws = new WebSocket(LIVE_WS + encodeURIComponent(token)); const S = { ws, ready: false, src: [], lt: 0, sp: null, mute: null, gate: false, lastUser: Date.now(), outTx: "", inTx: "", closed: false, opened: Date.now() }; V.ls = S;
  const ok = await new Promise(res => {
    const to = setTimeout(() => res(false), 9000);
    ws.onopen = () => { ws.send(JSON.stringify({ setup: { model: "models/gemini-3.8-live", generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Sulafat" } } } }, systemInstruction: { parts: [{ text: liveSystem() }] }, inputAudioTranscription: {}, outputAudioTranscription: {}, realtimeInputConfig: { automaticActivityDetection: { startOfSpeechSensitivity: "START_SENSITIVITY_HIGH", endOfSpeechSensitivity: "END_SENSITIVITY_LOW", prefixPaddingMs: 300, silenceDurationMs: 900 } } } })); };
    ws.onmessage = async e => { let d = e.data; if (d instanceof Blob) d = await d.text(); let m; try { m = JSON.parse(d); } catch (x) { return; } if (m.setupComplete) { clearTimeout(to); res(true); } else liveMsg(S, m); S.first = true; };
    ws.onerror = () => { clearTimeout(to); res(false); }; ws.onclose = () => { clearTimeout(to); res(false); };
  });
  if (!ok || V.turn !== turn || !V.active) { try { ws.close(); } catch (e) {} V.ls = null; return ok ? "denied" : false; }
  S.ready = true; V.liveOn = true; V.empty = 0;
  ws.onmessage = async e => { let d = e.data; if (d instanceof Blob) d = await d.text(); let m; try { m = JSON.parse(d); } catch (x) { return; } liveMsg(S, m); };
  ws.onclose = () => { if (S.closed) return; S.closed = true; const was = V.liveOn && V.ls === S; liveCleanup(); if (was && V.active) { if (Date.now() - S.opened < 4000) { V.liveBroken = true; toast("Live voice isn’t available right now. Using the classic voice."); setConvo(true); startListen(); } else if (!V.reconnTried && !document.hidden) { V.reconnTried = true; toast("Reconnecting…"); V.starting = true; startLive().then(r => { V.starting = false; if (r !== true) { setConvo(false); setState("idle"); toast("Live session ended. Tap the mic to continue."); } }).catch(() => { V.starting = false; setConvo(false); setState("idle"); }); } else { setConvo(false); setState("idle"); toast("Live session ended. Tap the mic to continue."); } } };
  ws.onerror = () => {};
  const sp = ctx.createScriptProcessor(2048, 1, 1), mute = ctx.createGain(); mute.gain.value = 0; S.sp = sp; S.mute = mute; V.msrc.connect(sp); sp.connect(mute); mute.connect(ctx.destination);
  const sr = ctx.sampleRate, ratio = sr / 16000;
  sp.onaudioprocess = e => {
    if (!S.ready || S.closed || V.ls !== S || ws.readyState !== 1 || ws.bufferedAmount > 262144) return; const d = e.inputBuffer.getChannelData(0); let q = 0; for (let i = 0; i < d.length; i++) q += d[i] * d[i]; const rms = Math.sqrt(q / d.length);
    const playing = S.lt > ctx.currentTime + 0.02; const quiet = playing && rms < 0.12; if (!playing && rms > 0.02) S.lastUser = Date.now();
    const m = Math.floor(d.length / ratio), pcm = new Int16Array(m);
    if (!quiet) for (let i = 0; i < m; i++) { const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio)); let s = 0; for (let k = a; k < b && k < d.length; k++) s += d[k]; let v = Math.max(-1, Math.min(1, s / (b - a))); pcm[i] = v < 0 ? v * 32768 : v * 32767; }
    try { ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64(new Uint8Array(pcm.buffer)), mimeType: "audio/pcm;rate=16000" } } })); } catch (x) {}
  };
  S.tick = setInterval(() => {
    if (!V.liveOn) return; const playing = S.lt > ctx.currentTime + 0.02; if (playing) liveSetState("speaking"); else if (V.state === "speaking") liveSetState("listening");
    if (!playing && Date.now() - S.lastUser > 120000) { toast("Still here. Tap the mic to talk again."); endLive(); }
  }, 250);
  setConvo(true); setState("listening"); setTx(""); startPulse(); return true;
}
function liveMsg(S, m) {
  const ctx = V.out; if (m.goAway) { toast("Live session is ending soon."); }
  const sc = m.serverContent; if (!sc) return;
  if (sc.interrupted) { liveFlush(S); }
  if (sc.inputTranscription && sc.inputTranscription.text) { if (S.saved) { S.outTx = ""; S.inTx = ""; S.saved = false; } S.inTx += sc.inputTranscription.text; S.lastUser = Date.now(); setTx(S.inTx.trim()); if (V.state !== "speaking") liveSetState("listening"); }
  if (sc.outputTranscription && sc.outputTranscription.text) { S.outTx += sc.outputTranscription.text; setTx(S.outTx.trim()); }
  if (sc.modelTurn) for (const p of sc.modelTurn.parts || []) if (p.inlineData && p.inlineData.data) {
    const bin = atob(p.inlineData.data), n = bin.length >> 1, f = new Float32Array(n); for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 32768) v -= 65536; f[i] = v / 32768; }
    const b = ctx.createBuffer(1, n, 24000); b.copyToChannel(f, 0); const s = ctx.createBufferSource(); s.buffer = b; s.connect(V.oan); const t = Math.max(S.lt, ctx.currentTime + 0.06); s.start(t); S.lt = t + b.duration; S.src.push(s); s.onended = () => { S.src = S.src.filter(x => x !== s); };
    V.speaking = true; liveSetState("speaking"); if (!S.saved && S.inTx.trim()) { S.saved = true; liveSave(S.inTx.trim()); }
  }
  if (sc.turnComplete) { S.inTx = S.inTx; }
}
function liveFlush(S) { for (const s of S.src) { try { s.onended = null; s.stop(); } catch (e) {} } S.src = []; S.lt = 0; V.speaking = false; liveSetState("listening"); }
function liveCleanup() { const S = V.ls; if (!S) return; clearInterval(S.tick); try { if (S.sp) { S.sp.onaudioprocess = null; V.msrc && V.msrc.disconnect(S.sp); S.sp.disconnect(); S.mute.disconnect(); } } catch (e) {} for (const s of S.src) { try { s.onended = null; s.stop(); } catch (e) {} } S.src = []; V.liveOn = false; V.ls = null; V.speaking = false; clearInterval(V.ptick); }
function endLive() { const S = V.ls; if (S) { S.closed = true; try { S.ws.close(); } catch (e) {} } liveCleanup(); setConvo(false); setState("idle"); }
let _hidAt = 0;
document.addEventListener("visibilitychange", () => { if (document.hidden) _hidAt = Date.now(); else if (V.liveOn && _hidAt && Date.now() - _hidAt > 20000) { toast("Live session paused while the app was in the background."); endLive(); } });
const _vmicClassic = $("#vmic").onclick;
$("#vmic").onclick = async () => {
  if (V.starting) return; V.reconnTried = false;
  if (V.liveOn) { const S = V.ls; if (S && S.lt > V.out.currentTime + 0.02) { liveFlush(S); try { S.ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } })); } catch (e) {} } else endLive(); return; }
  if (V.convo || V.state === "thinking" && V.ls) { return _vmicClassic(); }
  if (V.liveBroken || !V.cloud || !window.WebSocket) return _vmicClassic();
  V.starting = true; const r = await startLive(); V.starting = false;
  if (r === true || r === "denied") return;
  V.liveBroken = true; setState("idle"); toast("Live voice isn’t available right now. Using the classic voice."); _vmicClassic();
};
const _sendClassic = sendText;
const sendLive = () => { const t = $("#vin").value.trim(); if (V.liveOn && V.ls && V.ls.ws.readyState === 1) { if (!t) return; $("#vin").value = ""; V.ls.inTx = t; V.ls.outTx = ""; setTx(t); V.ls.ws.send(JSON.stringify({ realtimeInput: { text: t } })); return; } _sendClassic(); };
$("#vsend").onclick = sendLive; $("#vin").onkeydown = e => { if (e.key === "Enter") sendLive(); };
/* ---- Backup, restore and cross-device sync ---- */
const SYNCKEY = "mindly.sync"; const syncCode = () => localStorage.getItem(SYNCKEY) || "";
let _syncT = null, _lastPush = 0, _lastPull = 0;
function genSyncCode() { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", b = new Uint8Array(20); crypto.getRandomValues(b); let s = ""; for (let i = 0; i < 20; i++) { s += A[b[i] % 32]; if (i % 5 === 4 && i < 19) s += "-"; } return s; }
function fillDefaults(d) { const b = blank(); for (const k in b) if (!(k in d)) d[k] = b[k]; for (const k in b.settings) if (!(k in d.settings)) d.settings[k] = b.settings[k]; return d; }
function validDB(d) { return d && typeof d === "object" && Array.isArray(d.people) && Array.isArray(d.commitments) && d.settings && typeof d.settings === "object"; }
function backupLocal() { try { localStorage.setItem("mindly.prev", JSON.stringify(DB)); } catch (e) {} }
function adoptDB(d, ts) { backupLocal(); DB = fillDefaults(d); if ((+DB.v || 1) < SCHEMA) { const r = migrateDB(DB, null); DB = r.d; } DB.updatedAt = ts || Date.now(); try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) {} try { applyLang(); render(); } catch (e) {} }
async function syncPush(force) { const code = syncCode(); if (!code) return false; const ts = DB.updatedAt || Date.now(); if (!force && ts === _lastPush) return true; const r = await syncCall("/sync-put", { code, ts, data: DB }); if (r && r.ok) { _lastPush = ts; localStorage.setItem("mindly.syncok", String(Date.now())); return true; } return false; }
window.syncSoon = function () { if (!syncCode()) return; clearTimeout(_syncT); _syncT = setTimeout(() => syncPush(false), 6000); };
async function syncPull(manual) { const code = syncCode(); if (!code || Date.now() - _lastPull < 15000 && !manual) return null; _lastPull = Date.now(); const r = await syncCall("/sync-get", { code }); if (!r) return null; if (r.ts && r.data && validDB(r.data) && r.ts > (DB.updatedAt || 0) + 500) { adoptDB(r.data, r.ts); _lastPush = r.ts; localStorage.setItem("mindly.syncok", String(Date.now())); return "pulled"; } if ((DB.updatedAt || 0) > (r.ts || 0)) { await syncPush(true); return "pushed"; } return "same"; }
function exportBackup() { const blob = new Blob([JSON.stringify(DB, null, 1)], { type: "application/json" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "mindly-backup-" + today() + ".json"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); toast(S("Backup file created.", "تم إنشاء ملف النسخة الاحتياطية.")); }
function importBackupFile(f) { const rd = new FileReader(); rd.onload = () => { let d; try { d = JSON.parse(rd.result); } catch (e) { d = null; } if (!validDB(d)) { toast(S("That file is not a Mindly backup.", "هذا الملف مش نسخة Mindly.")); return; } if (!confirm(S("Replace the data on this device with the backup? Your current data is kept as a safety copy.", "تستبدل بيانات هذا الجهاز بالنسخة؟ بياناتك الحالية بتنحفظ كنسخة أمان."))) return; adoptDB(d, Date.now()); save(); toast(S("Backup restored.", "تم استرجاع النسخة.")); closeSheet(); }; rd.readAsText(f); }
function syncBlock() {
  const code = syncCode(), ok = +localStorage.getItem("mindly.syncok") || 0;
  return '<div class="m" style="margin-top:14px"><b>' + S("Backup & sync", "النسخ الاحتياطي والمزامنة") + '</b></div>' +
    (code ? '<div class="m">' + S("Sync is ON. Your sync code (keep it private, it is the key to your data):", "المزامنة شغالة. كود المزامنة (خليه سري، هو مفتاح بياناتك):") + '</div><div style="font:600 15px ui-monospace,monospace;letter-spacing:1px;margin:6px 0;user-select:all" dir="ltr" id="scode">' + code + '</div><div class="m" id="sst">' + (ok ? S("Last synced ", "آخر مزامنة ") + new Date(ok).toLocaleTimeString() : "") + '</div><div class="acts"><button class="btn" id="scp">' + S("Copy code", "نسخ الكود") + '</button><button class="btn" id="snow">' + S("Sync now", "زامن الآن") + '</button><button class="btn" id="sdel">' + S("Delete cloud copy", "حذف النسخة السحابية") + '</button><button class="btn" id="srot">' + S("New code", "كود جديد") + '</button><button class="btn d" id="soff">' + S("Turn off", "إيقاف") + '</button></div>'
      : '<div class="m">' + S("Keep your data safe and use it on other devices. No account: a private code is the key.", "احفظ بياناتك واستخدمها على أجهزة تانية. بدون حساب: كود خاص هو المفتاح.") + '</div><div class="acts"><button class="btn p" id="son">' + S("Turn on sync", "تشغيل المزامنة") + '</button></div><div class="m" style="margin-top:8px">' + S("Already have a code from another device?", "عندك كود من جهاز تاني؟") + '</div><div class="acts"><input id="sin" dir="ltr" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" style="flex:1;min-width:0"><button class="btn" id="sgo">' + S("Connect", "اتصال") + '</button></div>') +
    '<div class="acts" style="margin-top:10px"><button class="btn" id="bex">' + S("Export backup file", "تصدير نسخة احتياطية") + '</button><button class="btn" id="bim">' + S("Import backup file", "استيراد نسخة") + '</button><input type="file" id="bfile" accept=".json,application/json" style="display:none"></div>';
}
function bindSync() {
  const d = $("#dlg"); if (!d) return; const box = d.querySelector("#syncbox"); const re = () => { box.innerHTML = syncBlock(); bindSync(); };
  const q = s => box.querySelector(s);
  if (q("#son")) q("#son").onclick = async () => { localStorage.setItem(SYNCKEY, genSyncCode()); re(); const ok = await syncPush(true); toast(ok ? S("Sync is on. Save your code somewhere safe.", "المزامنة شغالة. احفظ الكود بمكان آمن.") : S("Couldn’t reach the server. Will retry.", "ما قدرت أوصل للسيرفر. رح أعيد المحاولة.")); re(); };
  if (q("#sgo")) q("#sgo").onclick = async () => { const c = q("#sin").value.trim().toUpperCase().replace(/[^A-Z2-7]/g, "").replace(/(.{5})(?=.)/g, "$1-"); if (c.length < 23) { toast(S("That code looks too short.", "الكود قصير.")); return; } const r = await syncCall("/sync-get", { code: c }); if (!r) { toast(S("Couldn’t reach the server.", "ما قدرت أوصل للسيرفر.")); return; } if (!r.ts || !r.data || !validDB(r.data)) { toast(S("No data found for that code.", "ما لقيت بيانات لهذا الكود.")); return; } if (!confirm(S("Replace the data on this device with the synced copy? Your current data is kept as a safety copy.", "تستبدل بيانات هذا الجهاز بالنسخة المتزامنة؟ بياناتك الحالية بتنحفظ كنسخة أمان."))) return; localStorage.setItem(SYNCKEY, c); adoptDB(r.data, r.ts); _lastPush = r.ts; localStorage.setItem("mindly.syncok", String(Date.now())); toast(S("Connected. Data loaded.", "تم الاتصال وتحميل البيانات.")); closeSheet(); };
  if (q("#scp")) q("#scp").onclick = () => { const t = syncCode(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(S("Code copied.", "تم النسخ.")), () => toast(S("Select the code and copy it.", "حدد الكود وانسخه."))); };
  if (q("#snow")) q("#snow").onclick = async () => { q("#sst").textContent = "…"; const r = await syncPull(true); await syncPush(true); toast(r ? S("Synced.", "تمت المزامنة.") : S("Couldn’t reach the server.", "ما قدرت أوصل للسيرفر.")); re(); };
  if (q("#sdel")) q("#sdel").onclick = async () => { if (!confirm(S("Delete the synced copy from the server and turn sync off on this device?", "تحذف نسخة المزامنة من السيرفر وتوقف المزامنة على هذا الجهاز؟"))) return; const r = await syncCall("/sync-del", { code: syncCode() }); if (r && r.ok) { localStorage.removeItem(SYNCKEY); toast(S("Cloud copy deleted.", "انحذفت النسخة السحابية.")); } else toast(S("Couldn’t reach the server. Nothing changed.", "ما قدرت أوصل للسيرفر. ما تغير شي.")); re(); };
  if (q("#srot")) q("#srot").onclick = async () => { if (!confirm(S("Create a new sync code? Your other devices stop syncing until you enter the new code. The old cloud copy is deleted.", "تعمل كود مزامنة جديد؟ أجهزتك الثانية بتوقف عن المزامنة لحد ما تدخل الكود الجديد. النسخة القديمة على السيرفر بتنحذف."))) return; const old = syncCode(); localStorage.setItem(SYNCKEY, genSyncCode()); const ok = await syncPush(true); if (ok) { await syncCall("/sync-del", { code: old }); toast(S("New code is active. Save it.", "الكود الجديد شغال. احفظه.")); } else { localStorage.setItem(SYNCKEY, old); toast(S("Couldn’t reach the server. Nothing changed.", "ما قدرت أوصل للسيرفر. ما تغير شي.")); } re(); };
  if (q("#soff")) q("#soff").onclick = () => { if (confirm(S("Turn off sync on this device? Your data stays here and on the server.", "توقف المزامنة على هذا الجهاز؟ بياناتك تبقى هنا وعلى السيرفر."))) { localStorage.removeItem(SYNCKEY); re(); } };
  ["#son", "#sgo", "#snow", "#srot", "#sdel"].forEach(id => { const b = q(id); if (!b || !b.onclick) return; const f = b.onclick; b.onclick = async ev => { if (b.disabled) return; b.disabled = true; b.style.opacity = ".55"; b.setAttribute("aria-busy", "true"); try { await f.call(b, ev); } finally { if (b.isConnected) { b.disabled = false; b.style.opacity = ""; b.removeAttribute("aria-busy"); } } }; });
  q("#bex").onclick = exportBackup; q("#bim").onclick = () => q("#bfile").click(); q("#bfile").onchange = e => { if (e.target.files[0]) importBackupFile(e.target.files[0]); };
}
const _settings0 = settingsSheet;
settingsSheet = function () { _settings0(); const d = $("#dlg"); if (!d) return; const acts = d.querySelector(".acts"); const box = document.createElement("div"); box.id = "syncbox"; acts.parentNode.insertBefore(box, acts); box.innerHTML = syncBlock(); bindSync(); };
$("#setBtn").onclick = settingsSheet; $("#vset").onclick = settingsSheet;
if (syncCode()) { syncPull(true); document.addEventListener("visibilitychange", () => { if (!document.hidden) syncPull(false); }); window.addEventListener("pagehide", () => { if (syncCode()) syncPush(false); }); }
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};

/* ============================================================
   WEBGL — iridescent liquid-glass sculpture.
   Ray-marched, domain-warped hollow SDF (asymmetric, folded — not a
   sphere), thin-film iridescence, Fresnel, 3-channel dispersion refraction,
   interior thickness absorption, studio-strip reflections. Rendered at a
   reduced internal resolution and paused when hidden to save battery.
   ============================================================ */
const GL = (() => {
  const cv = $("#gl"); let gl, prog, U = {}, raf = 0, t0 = performance.now(), energy = .15, warp = .3, ampS = 0, run = false, scale = .62, lastT = 0, slow = 0, lastDraw = 0; const RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; const qScale = () => { const mob = /iphone|ipad|ipod|android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1); const q = DB.settings.quality || (mob ? "balanced" : "high"); return { high: .85, balanced: .62, low: .42 }[q] || .62; }; scale = qScale();
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = `precision highp float;uniform vec2 R;uniform float T,A,E,W;
float h(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float map(vec3 p){
  float t=T*.22;
  vec3 q=p;
  q+=.34*sin(q.yzx*1.55+vec3(t*1.3,t*.9,t*1.1))*(.55+W*.6);
  q+=.18*sin(q.zxy*2.9+vec3(t*1.9,-t*1.4,t*1.2))*(.4+W*.7);
  q.x*=.86; q.y*=1.12; q.z*=.94;
  float d=length(q)-.92;
  d+=.05*sin(7.*p.y+T*2.6)*sin(5.*p.x-T*1.8)*A*1.6;
  d+=.035*sin(9.*p.x+p.z*4.+T*3.4)*E;
  d-=.1*A;
    return d*.72;
}
vec3 nrm(vec3 p){vec2 e=vec2(.002,-.002);return normalize(e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx));}
vec3 pal(float x){return .5+.5*cos(6.28318*(vec3(.0,.33,.67)+x));}
vec3 spec(float x){x=fract(x);vec3 c=mix(vec3(.05,.35,1.),vec3(.0,.9,1.),smoothstep(.0,.2,x));c=mix(c,vec3(.55,.25,1.),smoothstep(.2,.42,x));c=mix(c,vec3(1.,.15,.8),smoothstep(.42,.62,x));c=mix(c,vec3(1.,.45,.7),smoothstep(.62,.78,x));c=mix(c,vec3(1.,.55,.15),smoothstep(.78,.9,x));c=mix(c,vec3(.05,.35,1.),smoothstep(.9,1.,x));return c;}
vec3 env(vec3 d){
  float t=T*.12;
  vec3 c=vec3(.004,.004,.008);
  float s1=smoothstep(.93,.985,dot(d,normalize(vec3(.55,.75,.45))));
  float s2=smoothstep(.22,.0,abs(d.y-.15+.1*sin(t)))*smoothstep(-.2,.7,d.x);
  float s3=smoothstep(.9,.99,dot(d,normalize(vec3(-.8,.1,.55))));
  float s4=smoothstep(.2,.0,abs(d.x+.45+.12*cos(t*1.3)))*smoothstep(-.3,.6,d.z)*.8;
  c+=vec3(1.,.97,.95)*(s1*3.2+s3*2.2);
  c+=spec(d.x*.5+d.y*.3+t*.2)*(s2*1.5+s4*1.3);
  c+=spec(d.y*.6-d.z*.4+.3)*.18*smoothstep(-.4,1.,d.z);
  return c;
}
float thick(vec3 p,vec3 rd){float t=.04,s=0.;for(int i=0;i<14;i++){float d=-map(p+rd*t);if(d<.003)break;t+=max(d,.03);}return t;}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*R)/min(R.x,R.y*.82);
  uv.y-=.04;
  float rot=T*.11; mat2 m=mat2(cos(rot),-sin(rot),sin(rot),cos(rot));
  vec3 ro=vec3(0.,0.,5.0),rd=normalize(vec3(uv*1.0,-1.9));
  ro.xz=m*ro.xz; rd.xz=m*rd.xz; ro.y+=.28*sin(T*.19)+.0;
  float fl=.04*sin(T*.5); ro.y+=fl;
  vec3 bg=vec3(.0196)+.02*vec3(.1,.12,.2)*(1.-length(uv)*.9);
  vec3 col=bg;
  float b=dot(ro,rd),c0=dot(ro,ro)-3.4,hh=b*b-c0;
  if(hh>0.){
    float t=max(-b-sqrt(hh),0.),hit=0.;
    for(int i=0;i<64;i++){vec3 p=ro+rd*t;float d=map(p);if(d<.0015){hit=1.;break;}t+=d;if(t>6.)break;}
    if(hit>.5){
      vec3 p=ro+rd*t,n=nrm(p);
      float ndv=clamp(dot(n,-rd),0.,1.);
      float fr=pow(1.-ndv,2.6);
      vec3 rf=reflect(rd,n);
      vec3 refl=env(rf);
      float th=thick(p,refract(rd,n,.8));
      float film=ndv*1.6+th*.9+.25*sin(p.y*3.+T*.25)+T*.03+length(p.xy)*.2;
      vec3 irid=spec(film);
      vec3 tr;
      vec3 rr=refract(rd,n,.78),rg=refract(rd,n,.74),rb=refract(rd,n,.70);
      tr.r=env(rr).r;tr.g=env(rg).g;tr.b=env(rb).b;
      float abs_=exp(-th*1.1);
      vec3 inner=tr*abs_*.55;
      inner*=mix(vec3(1.),irid*2.0,.8);
      inner+=irid*irid*.38*(1.-fr)*smoothstep(.1,.9,1.-ndv)*(.4+E);
      vec3 body=mix(inner,refl*(.5+irid*.9),clamp(fr*1.25+.12,0.,1.));
      body+=irid*fr*(1.1+.6*E);
      float keyl=pow(max(dot(rf,normalize(vec3(.55,.75,.45))),0.),90.);
      body+=vec3(1.)*keyl*1.6;
      body*=mix(.55,1.,smoothstep(.0,.35,ndv)+fr);
      col=body;
      float edge=smoothstep(.0,.9,fr);
      col=mix(col,col*vec3(.85,.9,1.2),edge*.3);
    } else {
      float g=exp(-pow(max(hh,0.),1.)*.0);
    }
  }
  float vg=smoothstep(1.35,.2,length(uv));
  col=mix(bg,col,1.);
  col*=.55+.45*vg;
  col=col/(1.+col*.55);
  col=pow(col,vec3(.92));
  col+=(h(vec3(gl_FragCoord.xy,T))-.5)*.012;
  gl_FragColor=vec4(max(col,vec3(.0196)),1.);
}`;
  function sh(t, s) { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(o)); return null; } return o; }
  function init() {
    if (gl) return true; gl = cv.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" }) || cv.getContext("experimental-webgl"); if (!gl) return false;
    const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS); if (!v || !f) { gl = null; return false; }
    prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog); gl.useProgram(prog);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const l = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
    ["R", "T", "A", "E", "W"].forEach(n => U[n] = gl.getUniformLocation(prog, n)); return true;
  }
  function size() { const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale; const w = Math.max(2, Math.round(cv.clientWidth * dpr)), h = Math.max(2, Math.round(cv.clientHeight * dpr)); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); } }
  function micAmp() { if (!V.an || V.state !== "listening") return 0; V.an.getByteTimeDomainData(V.buf); let s = 0; for (let i = 0; i < V.buf.length; i++) { const x = (V.buf[i] - 128) / 128; s += x * x; } return Math.min(1, Math.sqrt(s / V.buf.length) * 5); }
  function frame(now) {
    if (!run) return; raf = requestAnimationFrame(frame); const dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
    if (dt > .045) { slow++; if (slow > 25 && scale > .4) { scale -= .07; slow = 0; } } else slow = Math.max(0, slow - 1);
    if (RM && now - lastDraw < 500) return; lastDraw = now;
    size();
    let targetE = .12, targetW = .3, a = 0;
    if (V.state === "listening") { targetE = .45; targetW = .55; a = micAmp(); }
    else if (V.state === "thinking") { targetE = .75; targetW = 1; a = .15 + .1 * Math.sin(now * .004); }
    else if (V.state === "speaking") { targetE = .6; targetW = .7; V.pulse *= Math.pow(.02, dt); a = .12 + .55 * V.pulse + .12 * Math.abs(Math.sin(now * .011)) * (V.speaking ? 1 : 0); }
    const k = 1 - Math.pow(.06, dt); energy += (targetE - energy) * k * .8; warp += (targetW - warp) * k * .8; ampS += (a - ampS) * (a > ampS ? .35 : .08);
    gl.uniform2f(U.R, cv.width, cv.height); gl.uniform1f(U.T, (now - t0) / 1000); gl.uniform1f(U.A, ampS * .5); gl.uniform1f(U.E, energy); gl.uniform1f(U.W, warp); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  cv.addEventListener("webglcontextlost", e => { e.preventDefault(); run = false; cancelAnimationFrame(raf); gl = null; prog = null; });
  cv.addEventListener("webglcontextrestored", () => { gl = null; if (V.active && init()) { run = true; lastT = performance.now(); raf = requestAnimationFrame(frame); } });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { run = false; cancelAnimationFrame(raf); } else if (V.active && gl) { run = true; raf = requestAnimationFrame(frame); } });
  return { start() { if (!init()) { $("#vstat").textContent = "WebGL isn’t available on this device."; return; } run = true; lastT = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }, stop() { run = false; cancelAnimationFrame(raf); }, setQuality() { scale = qScale(); slow = 0; } };
})();

/* boot */
applyLang();
if (location.hash === "#voice") openVoiceScreen();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) { navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => { const up = () => { try { reg.update(); } catch (e) {} }; document.addEventListener("visibilitychange", () => { if (!document.hidden) up(); }); addEventListener("pageshow", up); setInterval(up, 60000); let first = !navigator.serviceWorker.controller; navigator.serviceWorker.addEventListener("controllerchange", () => { if (first) { first = false; return; } if (!window._reloaded) { window._reloaded = true; location.reload(); } }); }).catch(() => {}); }
/* share target / quick capture via URL: ?text=...&title=...&url=... */
(function () { try { const q = new URLSearchParams(location.search), t = [q.get("title"), q.get("text"), q.get("url")].filter(Boolean).join(" ").trim(); if (t) { history.replaceState(null, "", location.pathname); setTimeout(() => { respondAI(t).then(r => { toast(r && r.saved ? S("Saved to Mindly.", "انحفظ في Mindly.") : S("Captured, nothing to save.", "تم الاستلام، ما في شي للحفظ.")); render(); }).catch(() => {}); }, 800); } } catch (e) {} })();
/* ---- v11: profile, privacy, encrypted sync, app lock ---- */
function profileTxt() { const n = (DB.settings.name || "").trim().slice(0, 40), g = DB.settings.gender; const who = n ? "the user, whose name is " + n : "the user"; const gt = g === "m" ? " (a man: in Arabic always address him with masculine forms)" : g === "f" ? " (a woman: in Arabic always address her with feminine forms)" : " (gender unknown: in Arabic prefer neutral phrasing)"; return who + gt; }
const _te = new TextEncoder();
const _b64e = u => { let s = ""; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
const _b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const _keyCache = {};
async function encKey(code) { if (_keyCache[code]) return _keyCache[code]; const base = await crypto.subtle.importKey("raw", _te.encode("enc:" + code), "PBKDF2", false, ["deriveKey"]); return _keyCache[code] = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: _te.encode("mindly-sync-v1"), iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
async function authOf(code) { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", _te.encode("auth:" + code))); const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let s = ""; for (let i = 0; i < 20; i++) { s += A[h[i] % 32]; if (i % 5 === 4 && i < 19) s += "-"; } return s; }
async function encData(code, data) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encKey(code), _te.encode(JSON.stringify(data)))); return { enc: 1, iv: _b64e(iv), ct: _b64e(ct) }; }
async function decData(code, o) { const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: _b64d(o.iv) }, await encKey(code), _b64d(o.ct)); return JSON.parse(new TextDecoder().decode(pt)); }
async function syncCall(path, body) { const c = new AbortController(), tm = setTimeout(() => c.abort(), 20000); try { const code = body.code, b2 = Object.assign({}, body, { code: await authOf(code) }); if (path === "/sync-put" && body.data) b2.data = await encData(code, body.data); const r = await fetch(AI_URL + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b2), signal: c.signal }); if (!r.ok) return null; const j = await r.json(); if (path === "/sync-get" && j && j.data && j.data.enc) { try { j.data = await decData(code, j.data); } catch (e) { j.data = null; } } return j; } catch (e) { return null; } finally { clearTimeout(tm); } }
/* app lock */
const LK = "mindly.lock";
const lockCfg = () => { try { return JSON.parse(localStorage.getItem(LK) || "null"); } catch (e) { return null; } };
async function pinHash(pin, saltB) { const base = await crypto.subtle.importKey("raw", _te.encode(pin), "PBKDF2", false, ["deriveBits"]); return _b64e(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: _b64d(saltB), iterations: 100000, hash: "SHA-256" }, base, 256))); }
let _lockFails = 0, _hiddenAt = 0;
function showLock() {
  const cfg = lockCfg(); if (!cfg || document.getElementById("lockov")) return;
  const o = document.createElement("div"); o.id = "lockov"; o.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0b0c10;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;font-family:inherit";
  o.innerHTML = '<div style="font-size:22px;font-weight:700">Mindly</div><div class="m" style="color:#aaa">' + S("Enter your PIN", "أدخل الرقم السري") + '</div><input id="lkpin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" style="text-align:center;font-size:24px;letter-spacing:8px;width:180px;padding:10px;border-radius:12px;border:1px solid #444;background:#15161c;color:#fff"><div id="lkmsg" style="color:#f77;min-height:18px;font-size:13px"></div><div style="display:flex;gap:10px"><button class="btn p" id="lkgo">' + S("Unlock", "فتح") + '</button>' + (cfg.bio ? '<button class="btn" id="lkbio">' + S("Face ID / Touch ID", "البصمة / الوجه") + '</button>' : "") + '</div><button class="btn d" id="lkforgot" style="margin-top:20px;font-size:12px">' + S("Forgot PIN", "نسيت الرقم") + '</button>';
  document.body.appendChild(o); const msg = t => o.querySelector("#lkmsg").textContent = t, pin = o.querySelector("#lkpin"); const done = () => { o.remove(); _lockFails = 0; };
  const tryPin = async () => { if (_lockFails >= 5) { msg(S("Too many tries. Wait 30 seconds.", "محاولات كثيرة. انتظر 30 ثانية.")); return; } const h = await pinHash(pin.value, cfg.s); if (h === cfg.h) done(); else { _lockFails++; pin.value = ""; msg(S("Wrong PIN", "رقم غلط")); if (_lockFails >= 5) setTimeout(() => { _lockFails = 0; msg(""); }, 30000); } };
  o.querySelector("#lkgo").onclick = tryPin; pin.onkeydown = e => { if (e.key === "Enter") tryPin(); };
  const bioGo = async () => { try { const r = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ id: _b64d(cfg.bio), type: "public-key" }], userVerification: "required", timeout: 60000 } }); if (r) done(); } catch (e) { msg(S("Biometric failed. Use your PIN.", "فشلت البصمة. استخدم الرقم.")); } };
  if (cfg.bio) { o.querySelector("#lkbio").onclick = bioGo; }
  o.querySelector("#lkforgot").onclick = () => { if (confirm(S("Remove the lock? This erases Mindly data on THIS device only. You can restore from sync or a backup file.", "إزالة القفل؟ هذا يمسح بيانات Mindly من هذا الجهاز فقط. تقدر ترجعها من المزامنة أو ملف النسخة."))) { localStorage.removeItem(LK); localStorage.removeItem(KEY); localStorage.removeItem("mindly.prev"); location.reload(); } };
  pin.focus();
}
document.addEventListener("visibilitychange", () => { if (document.hidden) _hiddenAt = Date.now(); else if (lockCfg() && _hiddenAt && Date.now() - _hiddenAt > 45000) showLock(); });
showLock();
const _settings1 = settingsSheet;
settingsSheet = function () {
  _settings1(); const d = $("#dlg"); if (!d) return; const anchor = d.querySelector("#syncbox") || d.querySelector(".acts"); const box = document.createElement("div"); box.id = "profbox"; anchor.parentNode.insertBefore(box, anchor);
  const draw = () => { const cfg = lockCfg(), st = DB.settings;
    box.innerHTML = '<div class="m" style="margin-top:14px"><b>' + S("About you", "عنك") + '</b></div><div class="acts"><input id="pname" placeholder="' + S("Your name", "اسمك") + '" value="' + (st.name || "").replace(/"/g, "&quot;") + '" style="flex:1;min-width:0"><select id="pgen"><option value="">' + S("Gender (for Arabic grammar)", "الجنس (للصياغة العربية)") + '</option><option value="m"' + (st.gender === "m" ? " selected" : "") + '>' + S("Male", "ذكر") + '</option><option value="f"' + (st.gender === "f" ? " selected" : "") + '>' + S("Female", "أنثى") + '</option></select></div>' +
      '<div class="m" style="margin-top:14px"><b>' + S("App lock", "قفل التطبيق") + '</b></div>' + (cfg ? '<div class="m">' + S("Lock is ON (locks when you come back after 45 seconds away).", "القفل شغال (يقفل لما ترجع بعد 45 ثانية).") + '</div><div class="acts">' + (cfg.bio ? "" : '<button class="btn" id="lbio">' + S("Add Face ID / Touch ID", "إضافة البصمة") + '</button>') + '<button class="btn" id="lnow">' + S("Lock now", "اقفل الآن") + '</button><button class="btn d" id="loff">' + S("Turn off", "إيقاف") + '</button></div>' : '<div class="acts"><input id="lpin" type="password" inputmode="numeric" maxlength="8" placeholder="' + S("New PIN (4 to 8 digits)", "رقم سري (4-8 أرقام)") + '" style="flex:1;min-width:0"><button class="btn p" id="lset">' + S("Set PIN", "تعيين") + '</button></div>') +
      '<div class="m" style="margin-top:14px"><b>' + S("Privacy", "الخصوصية") + '</b></div><div class="m" style="line-height:1.5">' + S("Your memory is stored on this device. When you chat or talk, your text and voice are sent through Mindly’s server to Google Gemini to answer you (on the free tier Google may use them to improve its models). Nothing is sold, there are no accounts or ads. If you turn on sync, your data is encrypted on your device before upload, so the server cannot read it. If you lose the sync code, the synced copy cannot be recovered. If you turn on reminders, the reminder text and time are stored on Mindly’s server (not encrypted) until delivered, together with your browser’s push address. The app lock hides the app, it does not encrypt data stored on the device. The server also keeps short-lived request counters tied to a hashed network address to prevent abuse. To delete: \"Erase everything\" clears this device, \"Delete cloud copy\" removes the synced copy, and turning reminders off removes them from the server.", "ذاكرتك محفوظة على هذا الجهاز. لما تكتب أو تحكي، النص والصوت بينرسلوا عبر سيرفر Mindly إلى Google Gemini ليجاوبك (بالنسخة المجانية ممكن Google تستخدمهم لتحسين نماذجها). ما في بيع بيانات ولا حسابات ولا إعلانات. لو شغلت المزامنة، بياناتك بتتشفر على جهازك قبل الرفع فالسيرفر ما يقدر يقرأها. لو ضاع كود المزامنة ما فيه استرجاع للنسخة. لو شغلت التذكيرات، نص التذكير ووقته بينحفظوا على سيرفر Mindly (بدون تشفير) لحد ما يوصلوا، مع عنوان الإشعارات للمتصفح. قفل التطبيق يخفي التطبيق لكنه ما يشفر البيانات المخزنة على الجهاز. السيرفر بيحتفظ بعدادات قصيرة مرتبطة بعنوان شبكة مشفّر (hash) لمنع الإساءة. للحذف: \"مسح كل شي\" بيمسح بيانات هذا الجهاز، \"حذف النسخة السحابية\" بيمسح نسخة المزامنة، وإيقاف التذكيرات بيمسحها من السيرفر.") + '</div><label class="sw"><span>' + S("Hide details in notifications (the server then stores no reminder text)", "إخفاء التفاصيل في الإشعارات (السيرفر ما بيخزّن نص التذكير)") + '</span><input type="checkbox" id="ppriv" ' + (DB.settings.pushPrivate ? "checked" : "") + '></label>';
    const q = s => box.querySelector(s);
    q("#ppriv").onchange = e => { DB.settings.pushPrivate = e.target.checked; save(); try { pushSyncNow(true); } catch (x) {} };
    q("#pname").onchange = e => { DB.settings.name = e.target.value.trim().slice(0, 40); save(); }; q("#pgen").onchange = e => { DB.settings.gender = e.target.value; save(); };
    if (q("#lset")) q("#lset").onclick = async () => { const p = q("#lpin").value; if (!/^\d{4,8}$/.test(p)) { toast(S("PIN must be 4 to 8 digits.", "الرقم لازم 4 إلى 8 أرقام.")); return; } const s = _b64e(crypto.getRandomValues(new Uint8Array(16))); localStorage.setItem(LK, JSON.stringify({ s, h: await pinHash(p, s), bio: null })); toast(S("Lock is on.", "تم تشغيل القفل.")); draw(); };
    if (q("#loff")) q("#loff").onclick = () => { if (confirm(S("Turn off the app lock?", "إيقاف قفل التطبيق؟"))) { localStorage.removeItem(LK); draw(); } };
    if (q("#lnow")) q("#lnow").onclick = () => { closeSheet(); showLock(); };
    if (q("#lbio")) q("#lbio").onclick = async () => { try { const cr = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: "Mindly" }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "mindly", displayName: "Mindly" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" }, timeout: 60000 } }); const c = lockCfg(); c.bio = _b64e(new Uint8Array(cr.rawId)); localStorage.setItem(LK, JSON.stringify(c)); toast(S("Biometric added.", "تمت إضافة البصمة.")); draw(); } catch (e) { toast(S("Biometrics not available here.", "البصمة غير متاحة هنا.")); } };
  }; draw();
};
$("#setBtn").onclick = settingsSheet; $("#vset").onclick = settingsSheet;
/* ---- v16: reminders (web push + local) ---- */
const VAPID_KEY = "BGLkBR7M2gpL__vt7ftUHlkwQs8pG3FYIfAA5mTdrXkgDMaBFzgimJDUxjZ2h99Ct6c73o9-VFSlXZ5Hjw6_bD4";
const PUSHK = "mindly.push";
const pushSub = () => { try { return JSON.parse(localStorage.getItem(PUSHK) || "null"); } catch (e) { return null; } };
function parseHM(t) { if (!t) return null; const m = String(t).match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|ص|م)?/i); if (!m) return null; let h = +m[1], mi = +(m[2] || 0); const ap = (m[3] || "").toLowerCase(); if ((ap === "pm" || ap === "م") && h < 12) h += 12; if ((ap === "am" || ap === "ص") && h === 12) h = 0; return h > 23 || mi > 59 ? null : [h, mi]; }
function atLocal(date, hm) { const p = String(date).split("-").map(Number); if (p.length < 3 || p.some(isNaN)) return 0; return new Date(p[0], p[1] - 1, p[2], hm[0], hm[1]).getTime(); }
function reminderItems() {
  const now = Date.now(), out = []; const add = (id, at, b) => { if (at > now - 60000 && at < now + 120 * 864e5) out.push({ id: id + ":" + at, at, b: String(b).slice(0, 140) }); };
  DB.commitments.filter(c => c.status !== "done" && c.due).forEach(c => add("c" + c.id, atLocal(c.due, [9, 0]), (c.owner === "me" ? S("Due today: ", "موعده اليوم: ") : S("Expected today: ", "متوقع اليوم: ")) + c.title + (c.personName ? " · " + c.personName : "")));
  DB.tasks.filter(k => k.status === "open" && k.due).forEach(k => add("t" + k.id, atLocal(k.due, [9, 0]), S("Task due today: ", "مهمة موعدها اليوم: ") + k.title));
  DB.events.forEach(e => { if (!e.date) return; const hm = parseHM(e.time); if (hm) add("e" + e.id, atLocal(e.date, hm) - 30 * 60000, S("In 30 min: ", "بعد 30 دقيقة: ") + e.title); else add("e" + e.id, atLocal(e.date, [9, 0]), S("Today: ", "اليوم: ") + e.title); });
  (DB.reminders || []).forEach(r => add("r" + r.id, r.at, r.text));
  if (DB.settings.pushPrivate) out.forEach(o => { o.b = S("You have a reminder in Mindly", "عندك تذكير في Mindly"); });
  return out.sort((a, b) => a.at - b.at).slice(0, 100);
}
async function pushPost(path, body) { try { const r = await fetch(AI_URL + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
let _pushT = null, _pushH = "";
function pushSoon() { if (!pushSub()) return; clearTimeout(_pushT); _pushT = setTimeout(() => pushSyncNow(false), 20000); }
async function pushSyncNow(force) { const sub = pushSub(); if (!sub) return false; const items = reminderItems(); const h = JSON.stringify(items.map(i => i.id + i.b)); if (!force && h === _pushH) return true; const r = await pushPost("/push-set", { sub, items }); if (r && r.ok) { _pushH = h; return true; } return false; }
{ const _ss = window.syncSoon; window.syncSoon = function () { try { pushSoon(); } catch (e) {} if (_ss) return _ss.apply(this, arguments); }; }
const _u8 = b => { const s = (b + "=".repeat((4 - b.length % 4) % 4)).split("-").join("+").split("_").join("/"); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
async function ensurePushSub(reg) {
  let sub = await reg.pushManager.getSubscription();
  if (sub) { try { const k = sub.options && sub.options.applicationServerKey; const cur = _u8(VAPID_KEY); const same = k && k.byteLength === cur.length && new Uint8Array(k).every((v, i) => v === cur[i]); if (!same) { await sub.unsubscribe(); sub = null; } } catch (e) {} }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _u8(VAPID_KEY) });
  return sub;
}
setTimeout(async () => { try { if (localStorage.getItem(PUSHK) && "Notification" in window && Notification.permission === "granted") { const reg = await navigator.serviceWorker.ready; const sub = await ensurePushSub(reg); const j = JSON.stringify(sub.toJSON()); if (j !== localStorage.getItem(PUSHK)) { localStorage.setItem(PUSHK, j); await pushSyncNow(true); } } } catch (e) {} }, 4000);
async function enablePush() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  if (ios && !standalone) return "install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const perm = await Notification.requestPermission(); if (perm !== "granted") return "denied";
  try { const reg = await navigator.serviceWorker.ready; const sub = await ensurePushSub(reg); localStorage.setItem(PUSHK, JSON.stringify(sub.toJSON())); } catch (e) { return "error"; }
  return (await pushSyncNow(true)) ? "ok" : "server";
}
async function disablePush() { const sub = pushSub(); try { const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch (e) {} if (sub) await pushPost("/push-off", { sub }); localStorage.removeItem(PUSHK); }
/* local fallback while the app is open (same tag as push, so no duplicates) */
setInterval(async () => { try { if (!("Notification" in window) || Notification.permission !== "granted") return; const shown = JSON.parse(localStorage.getItem("mindly.shown") || "{}"), now = Date.now(); let ch = false; for (const it of reminderItems()) { if (it.at <= now && !shown[it.id]) { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.showNotification("Mindly", { body: it.b, tag: it.id, data: { url: "./index.html" } }); shown[it.id] = now; ch = true; } } for (const k in shown) if (shown[k] < now - 3 * 864e5) { delete shown[k]; ch = true; } if (ch) localStorage.setItem("mindly.shown", JSON.stringify(shown)); } catch (e) {} }, 30000);
function addReminder(text, at) { DB.reminders = DB.reminders || []; DB.reminders.push({ id: "r" + Date.now().toString(36), text: String(text).slice(0, 120), at }); save(); }
const _settings2 = settingsSheet;
settingsSheet = function () {
  _settings2(); const d = $("#dlg"); if (!d) return; const anchor = d.querySelector("#profbox") || d.querySelector("#syncbox") || d.querySelector(".acts"); const box = document.createElement("div"); box.id = "rembox"; anchor.parentNode.insertBefore(box, anchor);
  const draw = (msg) => { const on = !!pushSub(), perm = ("Notification" in window) ? Notification.permission : "n/a", n = reminderItems().length;
    box.innerHTML = '<div class="m" style="margin-top:14px"><b>' + S("Reminders", "التذكيرات") + '</b></div><div class="m">' + (on ? S("Notifications are ON. You get a reminder at 9:00 on the due date, and 30 minutes before a meeting that has a time. Upcoming reminders: ", "الإشعارات شغالة. بوصلك تذكير الساعة 9:00 يوم الموعد، وقبل الاجتماع بنص ساعة إذا إله وقت. تذكيرات جاية: ") + n : S("Get a notification when something is due. On iPhone this works from the Home Screen app (Share, Add to Home Screen).", "استلم إشعار لما يحين موعد شي. على الآيفون بيشتغل من تطبيق الشاشة الرئيسية (مشاركة، إضافة إلى الشاشة الرئيسية).")) + '</div>' + (msg ? '<div class="m" style="color:#fdba74">' + msg + '</div>' : "") +
      '<div class="acts">' + (on ? '<button class="btn" id="rtest">' + S("Send test", "إشعار تجريبي") + '</button><button class="btn d" id="roff">' + S("Turn off", "إيقاف") + '</button>' : '<button class="btn p" id="ron">' + S("Turn on notifications", "تشغيل الإشعارات") + '</button>') + '</div>' +
      '<div class="acts"><input id="rtext" placeholder="' + S("Remind me to…", "ذكرني بـ…") + '" style="flex:1;min-width:100%"><input id="rwhen" type="datetime-local" style="flex:1"><button class="btn" id="radd">' + S("Add", "إضافة") + '</button></div>';
    const q = s => box.querySelector(s);
    if (q("#ron")) q("#ron").onclick = async () => { const r = await enablePush(); draw({ ok: "", install: S("On iPhone, first add Mindly to your Home Screen, then open it from there and try again.", "على الآيفون: أضف Mindly للشاشة الرئيسية أولاً، افتحه من هناك وجرب مرة ثانية."), unsupported: S("This browser does not support push notifications.", "هذا المتصفح ما بيدعم الإشعارات."), denied: S("Notifications are blocked. Allow them in your phone settings for Mindly.", "الإشعارات محظورة. اسمح بها من إعدادات الجوال لـ Mindly."), error: S("Could not subscribe. Try again.", "ما قدرت أفعّل. جرب مرة ثانية."), server: S("Subscribed, but the server could not be reached. It will retry.", "تم التفعيل لكن ما قدرت أوصل للسيرفر. رح أعيد المحاولة.") }[r] || ""); };
    if (q("#roff")) q("#roff").onclick = async () => { await disablePush(); draw(); };
    if (q("#rtest")) q("#rtest").onclick = async () => { const r = await pushPost("/push-test", { sub: pushSub(), text: S("Notifications work.", "الإشعارات شغالة.") }); draw(r && r.ok ? S("Test sent. It should arrive in a few seconds.", "انرسل إشعار تجريبي، لازم يوصل خلال ثواني.") : S("Test failed (status " + (r ? r.status : "no connection") + ").", "فشل الاختبار.")); };
    if (q("#radd")) q("#radd").onclick = () => { const t = q("#rtext").value.trim(), w = q("#rwhen").value; if (!t || !w) { toast(S("Add text and a time.", "اكتب النص والوقت.")); return; } const at = new Date(w).getTime(); if (!(at > Date.now())) { toast(S("Pick a time in the future.", "اختر وقت بالمستقبل.")); return; } addReminder(t, at); q("#rtext").value = ""; draw(S("Reminder added.", "تمت إضافة التذكير.")); if (!pushSub()) toast(S("Turn on notifications to receive it.", "شغّل الإشعارات لتستلمه.")); };
  }; draw();
};
$("#setBtn").onclick = settingsSheet; $("#vset").onclick = settingsSheet;
if (pushSub()) pushSyncNow(true);
/* ---- v17 nav: bottom anchoring + spring lens ---- */
document.body.appendChild($("#nav"));
function fixInset() {
  try {
    const mk = (id, css) => { let e = document.getElementById(id); if (!e) { e = document.createElement("div"); e.id = id; e.style.cssText = "position:fixed;left:0;width:1px;visibility:hidden;pointer-events:none;" + css; document.body.appendChild(e); } return e; };
    const pi = mk("insetProbe", "top:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px)"), pb = mk("pageProbe", "bottom:0;height:0");
    const inset = pi.offsetHeight || 0, vv = window.visualViewport, ih = window.innerHeight, iw = window.innerWidth;
    const pageBottom = pb.getBoundingClientRect().bottom || ih;
    const portrait = ih >= iw, st = !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches));
    const full = portrait ? Math.max(screen.height || 0, window.outerHeight || 0, ih) : ih;
    const gap = Math.min(220, Math.max(0, full - pageBottom));
    const remaining = Math.max(0, inset - gap);
    const nb0 = remaining > 0 && !st ? Math.max(10, remaining - 4) : 12;
    const root = document.documentElement, nb = nb0;
    root.style.setProperty("--sb", (nb - 8) + "px");
    const kb = !!(vv && vv.height < Math.min(ih, pageBottom) - 150);
    const nav = document.getElementById("nav"); if (nav) nav.classList.toggle("kb", kb);
    window._diag = "inner " + iw + "x" + ih + " · vv " + (vv ? Math.round(vv.height) : "-") + " · pageBottom " + Math.round(pageBottom) + " · screen " + screen.width + "x" + screen.height + " · outer " + window.outerHeight + " · inset " + inset + " · gap " + Math.round(gap) + " · bottom " + nb + " · standalone " + (st ? 1 : 0) + " · kb " + (kb ? 1 : 0);
  } catch (e) {}
}
fixInset(); ["resize", "orientationchange", "pageshow", "focusin", "focusout"].forEach(ev => addEventListener(ev, () => { fixInset(); setTimeout(fixInset, 350); }));
if (window.visualViewport) { visualViewport.addEventListener("resize", fixInset); visualViewport.addEventListener("scroll", fixInset); }
[300, 1200, 3000].forEach(t => setTimeout(fixInset, t));
let _lensPrev = null;
function moveLens(anim) { const nav = $("#nav"); if (!nav) return; let l = nav.querySelector(".lens"); if (!l) { l = document.createElement("i"); l.className = "lens"; nav.insertBefore(l, nav.firstChild); const lc = document.createElement("div"); lc.className = "lc"; lc.setAttribute("aria-hidden", "true"); lc.style.width = nav.clientWidth + "px"; lc.style.height = nav.clientHeight + "px"; lc.innerHTML = [...nav.querySelectorAll("button")].map(b => b.outerHTML.replace(/ id="[^"]*"/g, "").replace(/ data-v="[^"]*"/g, "").replace(/ class="on"/, ' class=""')).join(""); l.appendChild(lc); } const on = nav.querySelector("button.on:not(.vb)"); if (!on) { l.style.opacity = 0; return; } const cur = { left: on.offsetLeft - 2, width: on.offsetWidth + 4 }; const set = r => { l.style.left = r.left + "px"; l.style.width = r.width + "px"; l.style.opacity = 1; const lc = l.querySelector(".lc"); if (lc) { lc.style.width = nav.clientWidth + "px"; lc.style.height = nav.clientHeight + "px"; lc.style.transition = l.style.transition || "none"; lc.style.left = -(r.left + 1) + "px"; } trackLens(900); }; if (_lensPrev && anim && (Math.abs(_lensPrev.left - cur.left) > 2)) { const lo = Math.min(_lensPrev.left, cur.left), hi = Math.max(_lensPrev.left + _lensPrev.width, cur.left + cur.width); l.style.transition = "left .16s ease-out,width .16s ease-out"; set({ left: lo, width: hi - lo }); clearTimeout(l._t); l._t = setTimeout(() => { l.style.transition = "left .5s cubic-bezier(.34,1.56,.5,1),width .5s cubic-bezier(.34,1.56,.5,1)"; set(cur); }, 150); } else { l.style.transition = "none"; set(cur); } _lensPrev = cur; }
{ const _rn = renderNav; renderNav = function () { const nav = $("#nav"), k = DB.settings.lang + "|" + (nav.querySelector("[data-v]") ? 1 : 0); if (nav.dataset.k !== k) { const keep = nav.querySelector(".lens"); _rn(); nav.dataset.k = DB.settings.lang + "|1"; _lensPrev = _lensPrev; } else nav.querySelectorAll("[data-v]").forEach(x => x.classList.toggle("on", x.dataset.v === view)); try { tr(nav); } catch (e) {} moveLens(true); }; }
$("#nav").addEventListener("pointerdown", e => { const b = e.target.closest("button[data-v]"), l = $("#nav .lens"); if (b && l && b.classList.contains("on")) l.classList.add("press"); });
["pointerup", "pointercancel", "pointerleave"].forEach(ev => $("#nav").addEventListener(ev, () => { const l = $("#nav .lens"); if (l) l.classList.remove("press"); }));
addEventListener("resize", () => moveLens(false)); renderNav(); setTimeout(() => moveLens(false), 300);

function fadeBase() { const nav = $("#nav"), l = nav && nav.querySelector(".lens"); if (!l) return; const lr = l.getBoundingClientRect(), hid = l.style.opacity === "0"; nav.querySelectorAll(":scope>button").forEach(b => { if (b.classList.contains("vb")) return; const r = b.getBoundingClientRect(); const ov = hid ? 0 : Math.max(0, Math.min(r.right, lr.right) - Math.max(r.left, lr.left)) / (r.width || 1); b.style.opacity = String(Math.max(0, 1 - Math.min(1, ov * 1.2))); }); }
function trackLens(ms) { window._fe = Math.max(window._fe || 0, performance.now() + ms); if (window._fr) return; window._fr = true; const tick = () => { fadeBase(); if (performance.now() < window._fe) requestAnimationFrame(tick); else window._fr = false; }; requestAnimationFrame(tick); }
/* drag the lens across tabs */
(function () { const nav = $("#nav"); let dg = null;
  const L = () => nav.querySelector(".lens");
  nav.addEventListener("pointerdown", e => { const b = e.target.closest("button[data-v]"); const l = L(); if (!b || !l) return; dg = { x0: e.clientX, moved: false, lx: e.clientX, v: 0 }; l.classList.add("press"); try { nav.setPointerCapture(e.pointerId); } catch (z) {} });
  nav.addEventListener("pointermove", e => { if (!dg) return; const l = L(); if (!l) return; if (!dg.moved && Math.abs(e.clientX - dg.x0) > 6) { dg.moved = true; l.classList.add("drag"); } if (!dg.moved) return; const r = nav.getBoundingClientRect(), w = l.offsetWidth; let x = e.clientX - r.left - w / 2; x = Math.max(3, Math.min(r.width - w - 3, x)); const v = Math.min(Math.abs(e.clientX - dg.lx), 30); dg.lx = e.clientX; l.style.left = x + "px"; trackLens(400); { const lc = l.querySelector(".lc"); if (lc) { lc.style.width = nav.clientWidth + "px"; lc.style.transition = "none"; lc.style.left = -(x + 1) + "px"; } } l.style.transform = "scale(" + (1.08 + v * 0.004) + "," + (1.05 - v * 0.0015) + ")"; });
  const end = e => { if (!dg) return; const l = L(), d = dg; dg = null; if (!l) return; l.classList.remove("press"); l.style.transform = ""; if (!d.moved) { l.classList.remove("drag"); return; } l.classList.remove("drag"); const lc = l.offsetLeft + l.offsetWidth / 2; let best = null, bd = 1e9; nav.querySelectorAll("button[data-v]").forEach(b => { const dd = Math.abs(b.offsetLeft + b.offsetWidth / 2 - lc); if (dd < bd) { bd = dd; best = b; } }); _lensPrev = { left: l.offsetLeft, width: l.offsetWidth }; if (best) { if (best.dataset.v !== view) best.click(); else moveLens(true); } window._noClick = true; setTimeout(() => window._noClick = false, 400); };
  nav.addEventListener("pointerup", end); nav.addEventListener("pointercancel", end);
  nav.addEventListener("click", e => { if (window._noClick) { e.stopPropagation(); e.preventDefault(); } }, true);
})();
/* ---- v17: quick capture, prep, nudges, merge ---- */
const _i = s => esc(s);
function quickCapture() {
  sheet('<div class="m"><b>' + S("Quick capture", "تسجيل سريع") + '</b></div><textarea id="qct" dir="auto" rows="2" placeholder="' + S("Type or dictate: who, what, when…", "اكتب أو املي: مين، شو، ومتى…") + '" style="width:100%;font-size:16px;min-height:0;height:64px;max-height:120px;resize:none;padding:8px 10px;margin-top:4px"></textarea><div class="acts" style="margin-top:8px"><button class="btn p" id="qcs">' + S("Save", "حفظ") + '</button><button class="btn" id="qcm">🎤 ' + S("Voice note", "ملاحظة صوتية") + '</button></div><div class="m" id="qcst"></div>');
  const st = t => { $("#qcst").textContent = T(t); }; setTimeout(() => { const t = $("#qct"); t && t.focus(); }, 250);
  $("#qcs").onclick = async () => { const t = $("#qct").value.trim(); if (!t) return; st(S("Saving…", "عم احفظ…")); try { const r = await respondAI(t); closeSheet(); toast(r.text.slice(0, 120)); render(); } catch (e) { st(S("Could not save. Try again.", "ما قدرت احفظ. جرب مرة ثانية.")); } };
  let rec = null;
  $("#qcm").onclick = async () => {
    if (rec) { rec.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition; const lang = DB.settings.lang === "ar" ? "ar-SA" : "en-US";
    const done = txt => { if (txt) { const t = $("#qct"); t.value = (t.value + " " + txt).trim(); st(S("Check the text, then Save.", "راجع النص ثم احفظ.")); } else st(S("Heard nothing. Try again.", "ما سمعت شي. جرب مرة ثانية.")); $("#qcm").textContent = "🎤 " + S("Voice note", "ملاحظة صوتية"); rec = null; };
    try {
      if (navigator.mediaDevices && window.MediaRecorder) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mr = new MediaRecorder(stream), ch = []; mr.ondataavailable = e => ch.push(e.data);
        mr.onstop = async () => { stream.getTracks().forEach(t => t.stop()); st(S("Transcribing…", "عم احول لنص…")); try { const buf = await new Blob(ch).arrayBuffer(); const ac = new (window.AudioContext || window.webkitAudioContext)(); const ab = await new Promise((ok, no) => ac.decodeAudioData(buf, ok, no)); const txt = await sttCloud(toWav16k([ab.getChannelData(0)], ab.sampleRate)); ac.close(); done(txt); } catch (e) { done(""); st(S("Could not transcribe. You can type instead.", "ما قدرت احول لنص. فيك تكتب.")); } };
        mr.start(); rec = { stop: () => mr.stop() }; $("#qcm").textContent = "⏹ " + S("Stop", "إيقاف"); st(S("Recording… tap again to stop.", "عم سجّل… اضغط مرة ثانية للإيقاف.")); return;
      }
      if (SR) { const r = new SR(); r.lang = lang; r.onresult = e => done(e.results[0][0].transcript); r.onerror = () => done(""); r.start(); rec = { stop: () => r.stop() }; $("#qcm").textContent = "⏹ " + S("Stop", "إيقاف"); }
      else st(S("Voice capture is not supported here.", "التسجيل الصوتي مش مدعوم هون."));
    } catch (e) { st(S("Microphone is blocked or unavailable.", "المايك محظور أو مش متاح.")); }
  };
}
(function () { const g = $("#langBtn"); if (g && !$("#qcBtn")) { const b = document.createElement("button"); b.className = "btn"; b.id = "qcBtn"; b.setAttribute("aria-label", "Quick capture"); b.style.cssText = "min-width:44px;font-weight:700"; b.textContent = "＋"; b.onclick = quickCapture; g.parentNode.insertBefore(b, g); } })();
const _DAYMS = 864e5; const nk = s => norm(String(s || "").toLowerCase()).replace(/\s+/g, " ").trim();
function lastTouch(p) { let t = p.created || 0; const inp = id => { const i = id && byId(DB.inputs, id); return i ? i.ts : 0; }; (p.srcs || []).forEach(id => t = Math.max(t, inp(id))); (DB.interactions || []).forEach(i => { if (i.personId === p.id) { const ts = i.ts || (i.date ? new Date(i.date + "T12:00:00").getTime() : 0) || inp(i.inputId); if (ts > t) t = ts; } }); ["commitments", "tasks", "memories", "events"].forEach(k => (DB[k] || []).forEach(r => { if (r.personId === p.id) t = Math.max(t, inp(r.inputId), r.doneAt || 0); })); return t; }
function lev(a, b) { const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9; let d = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { let pr = d[0]; d[0] = i; for (let j = 1; j <= n; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, pr + (a[i - 1] === b[j - 1] ? 0 : 1)); pr = t; } } return d[n]; }
function mergePairs() { const out = [], P = DB.people || [], no = DB.noMerge || []; for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const a = P[i], b = P[j], k = a.id + "|" + b.id; if (no.includes(k)) continue; const x = nk(a.name), y = nk(b.name); if (!x || !y) continue; const fx = x.split(" ")[0], fy = y.split(" ")[0]; const same = x === y || (fx.length >= 4 && fy.length >= 4 && (lev(fx, fy) <= 1 || (lev(fx, fy) <= 2 && Math.min(fx.length, fy.length) >= 5 && fx[0] === fy[0])) && (x.split(" ").length === 1 || y.split(" ").length === 1 || lev(x, y) <= 2)) || (x.split(" ").length === 1 && y.split(" ")[0] === x) || (y.split(" ").length === 1 && x.split(" ")[0] === y); if (same) out.push([a, b, k]); } return out.slice(0, 3); }
function mergePreview(a, b) { const n = k => (DB[k] || []).filter(r => r.personId === b.id).length; const parts = [[n("commitments"), S("commitments", "التزامات")], [n("tasks"), S("tasks", "مهام")], [n("memories"), S("memories", "ذكريات")], [n("events"), S("events", "مواعيد")], [(DB.interactions || []).filter(i => i.personId === b.id).length, S("interactions", "تفاعلات")]].filter(x => x[0]).map(x => x[0] + " " + x[1]).join(", "); return S("Merge “" + b.name + "” into “" + a.name + "”?", "دمج «" + b.name + "» في «" + a.name + "»؟") + "\n" + (parts ? S("Moves: ", "رح ينتقل: ") + parts + "." : S("No linked items to move.", "ما في عناصر مرتبطة للنقل.")) + "\n" + S("You can undo this right after.", "بتقدر تتراجع مباشرة بعدها."); }
function undoMergeInfo() { try { const u = JSON.parse(localStorage.getItem("mindly.mergeundo") || "null"); return u && Date.now() - u.at < 7 * 864e5 ? u : null; } catch (e) { return null; } }
function undoMerge() { const u = undoMergeInfo(); if (!u) return false; const a = byId(DB.people, u.a.id); if (!a || byId(DB.people, u.b.id)) return false; Object.keys(a).forEach(k => delete a[k]); Object.assign(a, u.a); DB.people.push(u.b); (u.moved || []).forEach(m => { const r = (DB[m.k] || []).find(x => x.id === m.id); if (r) { r.personId = m.pid; if (m.pn !== undefined) r.personName = m.pn; else delete r.personName; } }); (u.imoved || []).forEach(m => { const r = (DB.interactions || []).find(x => x.id === m.id); if (r) r.personId = m.pid; }); localStorage.removeItem("mindly.mergeundo"); save(); return true; }
function doMerge(a, b) { try { const moved = []; ["commitments", "tasks", "memories", "events"].forEach(k => (DB[k] || []).forEach(r => { if (r.personId === b.id) moved.push({ k, id: r.id, pid: r.personId, pn: r.personName }); })); const imoved = (DB.interactions || []).filter(i => i.personId === b.id).map(i => ({ id: i.id, pid: i.personId })); localStorage.setItem("mindly.mergeundo", JSON.stringify({ at: Date.now(), a: JSON.parse(JSON.stringify(a)), b: JSON.parse(JSON.stringify(b)), moved, imoved })); } catch (e) {} (DB.interactions || []).forEach(i => { if (i.personId === b.id) i.personId = a.id; }); ["commitments", "tasks", "memories", "events"].forEach(k => (DB[k] || []).forEach(r => { if (r.personId === b.id) { r.personId = a.id; if (r.personName) r.personName = a.name; } })); ["relation", "profession", "comm", "project"].forEach(f => { if (!a[f] && b[f]) a[f] = b[f]; }); a.interests = [...new Set([...(a.interests || []), ...(b.interests || [])])]; a.dates = [...new Set([...(a.dates || []), ...(b.dates || [])])]; a.srcs = [...(a.srcs || []), ...(b.srcs || [])]; if (b.name.length > a.name.length) a.name = b.name; DB.people = DB.people.filter(x => x.id !== b.id); save(); }
function nudgeList() { const now = Date.now(), dm = DB.nudged || {}; return (DB.people || []).map(p => ({ p, d: Math.floor((now - lastTouch(p)) / _DAYMS) })).filter(x => x.d >= 21 && !(dm[x.p.id] && now - dm[x.p.id] < 14 * _DAYMS)).sort((a, b) => b.d - a.d).slice(0, 2); }
function prepList() { const t = today(), tm = iso(Date.now() + _DAYMS); return (DB.events || []).filter(e => e.personId && (e.date === t || e.date === tm)).slice(0, 2); }
function extrasHTML() {
  let h = ""; const card = (cls, inner, acts) => '<div class="card" ' + cls + '><div class="t" dir="auto">' + inner + '</div><div class="acts">' + acts + '</div></div>';
  prepList().forEach(e => { const P = byId(DB.people, e.personId); if (!P) { h += '<div class="card"><div class="m">' + S("Meeting prep · ", "تحضير اجتماع · ") + (e.date === today() ? S("today", "اليوم") : S("tomorrow", "بكرة")) + (e.time ? " " + esc(e.time) : "") + '</div><div class="t" dir="auto" style="margin-top:3px"><b>' + _i(e.title || "") + '</b></div><div class="m" style="margin-top:6px">' + S("No saved profile for this person yet.", "ما في ملف محفوظ لهذا الشخص بعد.") + '</div></div>'; return; } const open = DB.commitments.filter(c => c.personId === P.id && c.status !== "done").slice(0, 3).map(c => "• " + esc(c.title)).join("<br>"); const mem = DB.memories.filter(m => m.personId === P.id).slice(-2).map(m => "• " + esc(m.text)).join("<br>"); h += '<div class="card"><div class="m">' + S("Meeting prep · ", "تحضير اجتماع · ") + (e.date === today() ? S("today", "اليوم") : S("tomorrow", "بكرة")) + (e.time ? " " + esc(e.time) : "") + '</div><div class="t" dir="auto" style="margin-top:3px"><b>' + _i(e.title) + '</b></div><div class="m" dir="auto" style="margin-top:6px">' + _i(personSummary(P) || "") + (open ? '<br><b>' + S("Open with them:", "المعلّق معه:") + '</b><br>' + open : "") + (mem ? '<br><b>' + S("Remember:", "تذكّر:") + '</b><br>' + mem : "") + '</div></div>'; });
  { const u = undoMergeInfo(); if (u) h += card('', S("Merged “", "تم دمج «") + _i(u.b.name) + S("” into “", "» في «") + _i(u.a.name) + S("”.", "»."), '<button class="btn" data-undomg="1">' + S("Undo merge", "تراجع عن الدمج") + '</button>'); }
  mergePairs().forEach(([a, b, k]) => { h += card('', S("Are “", "هل “") + _i(a.name) + S("” and “", "” و“") + _i(b.name) + S("” the same person?", "” نفس الشخص؟"), '<button class="btn p" data-mg="' + k + '">' + S("Merge", "دمج") + '</button><button class="btn" data-nomg="' + k + '">' + S("Not the same", "مش نفسه") + '</button>'); });
  nudgeList().forEach(x => { h += card('', S("It has been ", "صار ") + x.d + S(" days since you connected with ", " يوم من آخر تواصل مع ") + '<b>' + _i(x.p.name) + '</b>.', '<button class="btn p" data-nv="' + x.p.id + '">' + S("Got it", "تمام") + '</button><button class="btn" data-nz="' + x.p.id + '">' + S("Not now", "مش هلأ") + '</button>'); });
  return h;
}
{ const _vh = vHome; vHome = function () { const s = _vh(); const ex = extrasHTML(); if (!ex) return s; const i = s.indexOf('<div class="card"'); return i < 0 ? s + ex : s.slice(0, i) + ex + s.slice(i); }; }
document.addEventListener("click", e => { const t = e.target.closest && e.target.closest("[data-mg],[data-nomg],[data-nv],[data-nz],[data-undomg]"); if (!t) return; const d = t.dataset; if (d.mg) { const [a, b] = d.mg.split("|").map(id => byId(DB.people, id)); if (a && b && confirm(mergePreview(a, b))) { doMerge(a, b); toast(S("Merged. You can undo it from Home.", "تم الدمج. تقدر تتراجع من الرئيسية.")); } } else if (d.undomg !== undefined) { toast(undoMerge() ? S("Merge undone.", "تم التراجع عن الدمج.") : S("Couldn’t undo.", "ما قدرت أتراجع.")); } else if (d.nomg) { DB.noMerge = (DB.noMerge || []).concat(d.nomg); save(); } else if (d.nv || d.nz) { DB.nudged = DB.nudged || {}; DB.nudged[d.nv || d.nz] = Date.now(); save(); } render(); });
{ const _sd = settingsSheet; settingsSheet = function () { _sd(); fixInset(); const d = $("#dlg"); if (!d) return; const x = document.createElement("div"); x.className = "m"; x.style.cssText = "font-size:10px;opacity:.5;margin-top:10px;direction:ltr"; x.textContent = "Display: " + (window._diag || ""); x.textContent = "Build v55 · " + x.textContent; const sh = d.querySelector(".sheet"); sh && sh.appendChild(x); }; $("#setBtn").onclick = settingsSheet; $("#vset").onclick = settingsSheet; }

/* ---- Turnstile (INACTIVE until a site key is configured) ----
   Set window.MINDLY_TS_SITEKEY (or localStorage "mindly.tskey") to the public site key to turn it on.
   With no key this block does nothing: fetch is not wrapped and no external script is loaded. Failures never block a request. */
(function () {
  let key = ""; try { key = window.MINDLY_TS_SITEKEY || localStorage.getItem("mindly.tskey") || ""; } catch (e) {}
  if (!key || !/^[0-9A-Za-z_-]{8,80}$/.test(key) || window._tsOn) return; window._tsOn = true;
  let tok = "", tokAt = 0, wid = null, loading = null;
  const load = () => loading || (loading = new Promise(res => { const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); }));
  async function getTok() {
    if (tok && Date.now() - tokAt < 240000) return tok;
    if (!(await Promise.race([load(), new Promise(r => setTimeout(() => r(false), 5000))])) || !window.turnstile) return "";
    return new Promise(res => { let el = document.getElementById("ts-box"); if (!el) { el = document.createElement("div"); el.id = "ts-box"; el.style.cssText = "position:fixed;left:-9999px;top:0"; document.body.appendChild(el); } const done = v => { tok = v || ""; tokAt = Date.now(); res(tok); }; try { if (wid !== null) { window.turnstile.reset(wid); } else { wid = window.turnstile.render(el, { sitekey: key, size: "invisible", callback: done, "error-callback": () => done(""), "expired-callback": () => { tok = ""; } }); } } catch (e) { done(""); } setTimeout(() => done(tok), 8000); });
  }
  const _f = window.fetch.bind(window);
  window.fetch = async function (input, init) { try { const u = typeof input === "string" ? input : (input && input.url) || ""; if (u.indexOf(AI_URL) === 0) { const tk = await getTok(); if (tk) { init = Object.assign({}, init); const h = new Headers(init.headers || (typeof input !== "string" && input.headers) || {}); h.set("x-turnstile-token", tk); init.headers = h; } } } catch (e) {} return _f(input, init); };
})();

/* ---- Settings grouping (Phase 0): moves existing nodes into collapsible sections, keeps every handler.
   If the sheet layout is not the expected one, nothing is changed. ---- */
{ const _sg = settingsSheet; settingsSheet = function () { _sg(); try {
  const sh = document.querySelector("#dlg .sheet"); if (!sh || sh.querySelector(".sgrp")) return;
  const labels = [...sh.children].filter(c => c.tagName === "LABEL" && c.classList.contains("sw")); if (labels.length !== 10) return;
  const rem = sh.querySelector(":scope > #rembox"), prof = sh.querySelector(":scope > #profbox"), syn = sh.querySelector(":scope > #syncbox"), acts = sh.querySelector(":scope > .acts"); if (!rem || !prof || !syn || !acts) return;
  const mk = (title, nodes, open) => { const d = document.createElement("details"); d.className = "sgrp"; d.style.cssText = "margin:10px 0;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:2px 12px"; if (open) d.open = true; const s = document.createElement("summary"); s.style.cssText = "padding:11px 0;font-weight:700;cursor:pointer"; s.textContent = title; d.appendChild(s); nodes.forEach(n => d.appendChild(n)); return d; };
  const mem = [0, 1, 2, 3, 4, 5, 8].map(i => labels[i]), gen = [6, 7, 9].map(i => labels[i]);
  const g1 = mk(S("What Mindly remembers", "شو بتتذكّر مايندلي"), mem, true), g2 = mk(S("General", "عام"), gen, false), g3 = mk(S("Reminders", "التذكيرات"), [rem], false), g4 = mk(S("Profile & security", "الملف والأمان"), [prof], false), g5 = mk(S("Backup & sync", "النسخ الاحتياطي والمزامنة"), [syn], false);
  [g1, g2, g3, g4, g5].forEach(g => sh.insertBefore(g, acts));
} catch (e) {} }; $("#setBtn").onclick = settingsSheet; $("#vset").onclick = settingsSheet; }

/* ---- Busy state for sync network actions (Phase 0): buttons in the sync box are disabled while a request runs,
   so a double tap cannot fire two requests. Always restored, even on error. ---- */
{ const _sc = syncCall; let _n = 0; const setB = on => { try { document.querySelectorAll("#syncbox button, #syncbox .btn").forEach(b => { if (on) { if (!b.disabled) { b.disabled = true; b.dataset.busyoff = "1"; } } else if (b.dataset.busyoff) { b.disabled = false; delete b.dataset.busyoff; } }); const bx = document.getElementById("syncbox"); if (bx) bx.setAttribute("aria-busy", on ? "true" : "false"); } catch (e) {} };
  syncCall = async function () { _n++; setB(true); try { return await _sc.apply(this, arguments); } finally { _n--; if (_n <= 0) { _n = 0; setB(false); } } }; }
