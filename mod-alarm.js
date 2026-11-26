/* Mindly module: Smart Alarm, FOREGROUND WEB PROTOTYPE.
   Rings only while Mindly is open in the foreground with the screen on. It is NOT a native alarm: no background, locked-screen, Silent-mode or Focus behavior.
   Data (additive, AlarmKit-shaped so a native app can read the same fields):
     DB.alarms   [{schema:1,id,label,hour,minute,weekdays:[0-6 Sun..Sat],oneTimeDate:"YYYY-MM-DD"|"",enabled,soundId:1-6,snooze:{minutes:5,max:3},
                   retry:{rings:5,intervalMinutes:2},challenge:{count:0|1|3|5,difficulty:"easy|medium|hard",types:[...]},routineId,linkedTaskId,qrCode,createdAt}]
     DB.alarmLog [{id,alarmId,date,scheduledAt,outcome:"completed|skipped|incomplete|missed",rings,snoozes,challengeCount,challengeDone,difficulty,test,source:"web-foreground",finishedAt,note}]
     DB.routines [{id,title,steps:[{id,taskId|text}],checks:{date:[stepId]}}]  (a step with taskId points at an existing DB.tasks record, nothing is copied)
   Rules (plan v7): 5 rings 2 minutes apart, then stop and record "incomplete" (neutral). Skip needs one confirmation and is neutral. Snooze 5 min, max 3, separate from the rings.
   Linked tasks and practical challenges mark the EXISTING task done, never create a copy. */
(function () {
  "use strict";
  if (window.MindlyAlarm) return;
  const RING_MS = 120000, MAX_RINGS = 5, SNOOZE_MIN = 5, SNOOZE_MAX = 3, WINDOW_MS = 120000;
  const LS_FIRED = "mindly.alarmfired", LS_TICK = "mindly.alarmtick", LS_STATE = "mindly.alarmstate";
  const pad = n => String(n).padStart(2, "0"), dkey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const arr = k => { if (!Array.isArray(DB[k])) DB[k] = []; return DB[k]; };
  const uidp = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const rnd = (a, b, r) => a + Math.floor((r || Math.random)() * (b - a + 1));
  const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") || d; } catch (e) { return d; } };
  const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  /* ---------- schedule (pure) ---------- */
  function fireTimeOn(a, day) {
    if (!a || a.hour == null) return null;
    const k = dkey(day), wd = a.weekdays || [];
    if (wd.length) { if (wd.indexOf(day.getDay()) < 0) return null; } else if (a.oneTimeDate !== k) return null;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), a.hour, a.minute || 0, 0, 0).getTime();
  }
  function nextFire(a, now) {
    if (!a.enabled) return null;
    for (let i = 0; i < 8; i++) { const d = new Date(now + i * 864e5), t = fireTimeOn(a, d); if (t && t > now) return t; }
    return null;
  }
  function dueOn(alarms, day) { return alarms.some(a => a.enabled && fireTimeOn(a, day) !== null); }

  /* ---------- streak and achievements (pure, counts only) ---------- */
  function streak(logs, alarms, todayKey) {
    const real = logs.filter(l => !l.test), by = {};
    real.forEach(l => (by[l.date] = by[l.date] || []).push(l));
    const base = new Date(todayKey + "T12:00:00");
    let run = 0;
    for (let i = 0; i < 400; i++) {
      const d = new Date(base.getTime() - i * 864e5), k = dkey(d), es = by[k] || [];
      if (es.some(e => e.outcome === "completed")) run++;
      else if (es.length) continue;
      else if (i > 0 && dueOn(alarms, d)) break;
    }
    return run;
  }
  function achievements(logs) {
    const real = logs.filter(l => !l.test), done = real.filter(l => l.outcome === "completed");
    const days = new Set(done.map(l => l.date)).size;
    return [
      ["first", "First alarm completed", "أول منبه خلصته", done.length >= 1],
      ["ten", "10 alarms completed", "10 منبهات خلصتها", done.length >= 10],
      ["hard", "Finished a Hard challenge", "خلصت تحدي صعب", done.some(l => l.difficulty === "hard" && l.challengeCount > 0)],
      ["five", "Finished a 5-task challenge", "خلصت تحدي 5 مهام", done.some(l => l.challengeCount === 5)],
      ["days7", "7 days with a completed alarm", "7 أيام فيها منبه مكتمل", days >= 7]
    ];
  }

  /* ---------- sensors (pure detectors) ---------- */
  function makeShake(cb, th) {
    th = th || 8; let ax = 0, ay = 0, az = 9.81, last = 0;
    return s => { ax = ax * 0.9 + s.x * 0.1; ay = ay * 0.9 + s.y * 0.1; az = az * 0.9 + s.z * 0.1; const h = Math.hypot(s.x - ax, s.y - ay, s.z - az); if (h > th && s.t - last > 250) { last = s.t; cb(); } };
  }
  /* Approximate step counter from motion peaks. NOT a pedometer. */
  function makeSteps(cb) {
    let g = 9.81, up = false, last = 0;
    return s => { const m = Math.hypot(s.x, s.y, s.z); g = g * 0.98 + m * 0.02; const v = m - g; if (!up && v > 1.5 && s.t - last > 300) { up = true; last = s.t; cb(); } else if (up && v < 0.5) up = false; };
  }

  /* ---------- challenge generators (pure) ---------- */
  const COUNTS = { easy: [8, 4, 4], medium: [15, 6, 6], hard: [25, 8, 8] };
  function genMath(d, r) {
    let a, b, q, ans;
    if (d === "easy") { a = rnd(3, 19, r); b = rnd(3, 19, r); q = a + " + " + b; ans = a + b; }
    else if (d === "medium") { if (rnd(0, 1, r)) { a = rnd(3, 12, r); b = rnd(3, 12, r); q = a + " × " + b; ans = a * b; } else { a = rnd(40, 99, r); b = rnd(11, 39, r); q = a + " − " + b; ans = a - b; } }
    else { a = rnd(12, 29, r); b = rnd(3, 9, r); const c = rnd(11, 59, r); q = a + " × " + b + " + " + c; ans = a * b + c; }
    return { q, ans: String(ans) };
  }
  function genMem(d, r) { const n = COUNTS[d][2]; let s = ""; for (let i = 0; i < n; i++) s += rnd(i ? 0 : 1, 9, r); return { digits: s }; }
  function genSeq(d, r) {
    let t = [], ans;
    if (d === "easy") { const s = rnd(1, 20, r), k = rnd(2, 9, r); for (let i = 0; i < 5; i++) t.push(s + i * k); }
    else if (d === "medium") { const s = rnd(1, 5, r), m = rnd(2, 3, r); for (let i = 0; i < 5; i++) t.push(s * Math.pow(m, i)); }
    else { const a = rnd(1, 4, r), b = rnd(1, 4, r); t = [a, b]; for (let i = 2; i < 6; i++) t.push(t[i - 1] + t[i - 2]); }
    ans = t.pop(); return { shown: t, ans: String(ans) };
  }
  function genOrder(d, r) { const n = COUNTS[d][1] === 4 ? 4 : d === "medium" ? 6 : 9, set = new Set(); while (set.size < n) set.add(rnd(1, 40, r)); const a = [...set]; for (let i = a.length - 1; i > 0; i--) { const j = rnd(0, i, r); [a[i], a[j]] = [a[j], a[i]]; } return { nums: a }; }
  const PRACTICAL = [["Drink a glass of water", "اشرب كاسة مي"], ["Stand up and stretch for 10 seconds", "قف ومدّد جسمك 10 ثواني"], ["Wash your face", "اغسل وجهك"], ["Open the curtains or turn on a light", "افتح الستاير أو شغّل ضوء"]];
  const MOTION = typeof DeviceMotionEvent !== "undefined";
  const QRCAP = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  /* QR scanning: native BarcodeDetector when present, otherwise jsQR (Apache-2.0), loaded lazily on first scan. */
  let jsqrP = null;
  function loadJsQR() { if (window.jsQR) return Promise.resolve(); if (!jsqrP) jsqrP = new Promise((res, rej) => { const el = document.createElement("script"); el.src = "jsqr.min.js"; el.onload = res; el.onerror = () => { jsqrP = null; rej(new Error("jsqr")); }; document.head.appendChild(el); }); return jsqrP; }
  async function makeScanner() {
    if (typeof window.BarcodeDetector !== "undefined") { const det = new BarcodeDetector({ formats: ["qr_code"] }); return async v => { const r = await det.detect(v); return r.length ? r[0].rawValue : null; }; }
    await loadJsQR(); const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
    return async v => { const w = v.videoWidth, h = v.videoHeight; if (!w || !h) return null; const sc = Math.min(1, 640 / w); cv.width = Math.round(w * sc); cv.height = Math.round(h * sc); cx.drawImage(v, 0, 0, cv.width, cv.height); const im = cx.getImageData(0, 0, cv.width, cv.height); const r = window.jsQR(im.data, cv.width, cv.height, { inversionAttempts: "dontInvert" }); return r ? r.data : null; };
  }
  const ALLTYPES = ["math", "memory", "puzzle", "practical", "qr", "shake", "steps"];
  const typeOk = t => t === "shake" || t === "steps" ? MOTION : t === "qr" ? QRCAP : true;
  const TNAME = { math: ["Math", "حساب"], memory: ["Memory", "ذاكرة"], puzzle: ["Puzzle", "ألغاز"], practical: ["Practical", "عملي"], qr: ["QR code", "رمز QR"], shake: ["Shake", "هز"], steps: ["Steps (approx.)", "خطوات (تقريبي)"] };
  function pickTypes(alarm, n, r) {
    let ok = (alarm.challenge.types || []).filter(typeOk); if (alarm.challenge.types.indexOf("qr") >= 0 && !alarm.qrCode) ok = ok.filter(t => t !== "qr");
    if (!ok.length) ok = ["math"]; const out = []; let prev = null;
    for (let i = 0; i < n; i++) { const pool = ok.length > 1 ? ok.filter(t => t !== prev) : ok; prev = pool[rnd(0, pool.length - 1, r)]; out.push(prev); } return out;
  }

  /* ---------- sound engine: six original generated sounds ---------- */
  let ctx = null, master = null, soundTimer = null, soundStop = null;
  const SOUNDS = [[1, "Dawn", "فجر"], [2, "Pulse", "نبض"], [3, "Bell", "جرس"], [4, "Sunrise", "شروق"], [5, "Marimba", "ماريمبا"], [6, "Siren", "صفارة"]];
  function ac() { if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); master = ctx.createGain(); master.connect(ctx.destination); } return ctx; }
  function unlock() { const c = ac(); if (!c) return false; try { if (c.state !== "running") c.resume(); const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch (e) {} return c.state === "running"; }
  const audioReady = () => !!ctx && ctx.state === "running";
  function tone(f, t, dur, type, g, f2) {
    const o = ctx.createOscillator(), e = ctx.createGain(); o.type = type || "sine"; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.linearRampToValueAtTime(f2, t + dur);
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(g, t + 0.02); e.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(e); e.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function bell(f, t, g) { const c = ctx.createOscillator(), m = ctx.createOscillator(), mg = ctx.createGain(), e = ctx.createGain(); c.frequency.value = f; m.frequency.value = f * 3.5; mg.gain.setValueAtTime(f * 2, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.2); m.connect(mg); mg.connect(c.frequency); e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.0001, t + 1.3); c.connect(e); e.connect(master); c.start(t); m.start(t); c.stop(t + 1.4); m.stop(t + 1.4); }
  const PATTERNS = {
    1: t => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.3, 0.9, "sine", 0.3)); },
    2: t => { for (let i = 0; i < 4; i++) tone(880, t + i * 0.2, 0.1, "square", 0.12); },
    3: t => { bell(660, t, 0.35); bell(660, t + 0.7, 0.3); bell(880, t + 1.4, 0.3); },
    4: t => { tone(300, t, 1.9, "sine", 0.3, 900); tone(305, t, 1.9, "triangle", 0.15, 910); },
    5: t => { [392, 523.25, 587.33, 784, 587.33, 523.25].forEach((f, i) => tone(f, t + i * 0.25, 0.35, "triangle", 0.3)); },
    6: t => { for (let i = 0; i < 6; i++) tone(i % 2 ? 900 : 600, t + i * 0.3, 0.28, "sawtooth", 0.1); }
  };
  function stopSound() { clearInterval(soundTimer); soundTimer = null; clearTimeout(soundStop); try { if (master) { master.gain.cancelScheduledValues(0); master.gain.value = 0; } } catch (e) {} }
  function playSound(id, ringNo, once) {
    stopSound(); const c = ac(); if (!c) return false; if (c.state !== "running") { try { c.resume(); } catch (e) {} }
    master.gain.value = Math.min(1, 0.3 + 0.15 * (ringNo || 1)); const p = PATTERNS[id] || PATTERNS[1];
    const go = () => { try { p(ctx.currentTime + 0.05); } catch (e) {} }; go();
    if (once) soundStop = setTimeout(stopSound, 2400); else soundTimer = setInterval(go, 2000);
    return audioReady();
  }

  /* ---------- wake lock (keeps the screen on while armed and visible; not a background mechanism) ---------- */
  let wl = null;
  async function keepAwake() { try { if (!navigator.wakeLock || document.hidden || wl) return; wl = await navigator.wakeLock.request("screen"); wl.addEventListener("release", () => { wl = null; }); } catch (e) { wl = null; } }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && armed()) keepAwake(); });
  const armed = () => arr("alarms").some(a => a.enabled);

  /* ---------- ring state machine ---------- */
  let ring = null, ov = null, cleanup = null, skipArm = 0;
  const find = id => arr("alarms").find(a => a.id === id);
  const persist = () => { if (ring) jset(LS_STATE, { alarmId: ring.alarmId, dateKey: ring.dateKey, scheduledAt: ring.scheduledAt, n: ring.n, snoozes: ring.snoozes, phase: ring.phase, ringStart: ring.ringStart, snoozeUntil: ring.snoozeUntil, test: ring.test, done: ring.done }); else try { localStorage.removeItem(LS_STATE); } catch (e) {} };
  function startRing(a, dateKey, scheduledAt, test) {
    if (ring) return false;
    ring = { alarmId: a.id, dateKey, scheduledAt, n: 1, snoozes: 0, phase: "ringing", ringStart: Date.now(), snoozeUntil: 0, test: !!test, done: 0, seq: null, cur: 0, swaps: 0 };
    persist(); paint(); playSound(a.soundId, 1); return true;
  }
  function finish(outcome, note) {
    if (!ring) return; const a = find(ring.alarmId) || { challenge: { count: 0, difficulty: "easy" } }, r = ring;
    stopSound(); if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    arr("alarmLog").push({ id: uidp("al"), alarmId: r.alarmId, date: r.dateKey, scheduledAt: r.scheduledAt, outcome, rings: r.n, snoozes: r.snoozes, challengeCount: a.challenge.count, challengeDone: r.done, difficulty: a.challenge.difficulty, test: r.test, source: "web-foreground", finishedAt: Date.now(), note: note || "" });
    if (!r.test && a.id && !(a.weekdays && a.weekdays.length)) a.enabled = false;
    ring = null; persist(); save(); if (ov) { ov.remove(); ov = null; }
    try { toast(outcome === "completed" ? S("Alarm completed.", "خلص المنبه.") : outcome === "skipped" ? S("Alarm skipped. Neutral day.", "تم تخطي المنبه. يوم محايد.") : S("Alarm ended without completion. Neutral day.", "انتهى المنبه بدون إكمال. يوم محايد.")); } catch (e) {}
    if (outcome === "completed" && !r.test) afterDone(a);
    try { render(); } catch (e) {}
  }
  function afterDone(a) {
    const t = a.linkedTaskId && DB.tasks.find(x => x.id === a.linkedTaskId && x.status !== "done"), rt = a.routineId && arr("routines").find(x => x.id === a.routineId);
    if (!t && !rt) return;
    let h = '<h3 style="margin:0 0 6px">' + S("Good morning", "صباح الخير") + "</h3>";
    if (t) h += '<div class="card"><div class="t" dir="auto">' + esc(t.title) + '</div><div class="acts"><button class="btn p" id="ald">' + S("Mark this task done", "علّم المهمة خلصت") + "</button></div></div>";
    if (rt) h += '<div class="card"><div class="t" dir="auto">' + esc(rt.title) + '</div><div class="acts"><button class="btn p" id="alr">' + S("Start routine", "ابدأ الروتين") + "</button></div></div>";
    sheet(h, () => { const d = document.querySelector("#ald"); if (d) d.onclick = () => { t.status = "done"; t.doneAt = Date.now(); save(); closeSheet(); try { render(); } catch (e) {} }; const r = document.querySelector("#alr"); if (r) r.onclick = () => runRoutine(rt.id); });
  }
  function advance(now) {
    if (!ring) return; const a = find(ring.alarmId); if (!a) { finish("incomplete", "alarm removed"); return; }
    if (ring.phase === "snoozed") { if (now >= ring.snoozeUntil) { ring.phase = "ringing"; ring.ringStart = now; persist(); paint(); playSound(a.soundId, ring.n); } else tickText(now); return; }
    if (now >= ring.ringStart + RING_MS) {
      if (ring.n >= MAX_RINGS) { finish("incomplete", "5 rings"); return; }
      ring.n++; ring.phase = "ringing"; ring.ringStart = now; persist(); paint(); playSound(a.soundId, ring.n); return;
    }
    tickText(now);
  }
  function tickText(now) { const el = ov && ov.querySelector("#alcd"); if (!el) return; const t = ring.phase === "snoozed" ? ring.snoozeUntil : ring.ringStart + RING_MS; el.textContent = Math.max(0, Math.ceil((t - now) / 1000)) + "s"; }

  /* ---------- scheduler ---------- */
  function tick() {
    const now = Date.now(), last = +localStorage.getItem(LS_TICK) || 0; localStorage.setItem(LS_TICK, String(now));
    try {
      const fired = jget(LS_FIRED, {}); let ch = false;
      for (const a of arr("alarms")) {
        if (!a.enabled) continue; const f = fireTimeOn(a, new Date(now)); if (f === null || now < f) continue;
        const key = a.id + "|" + dkey(new Date(f)); if (fired[key]) continue;
        if (now - f <= WINDOW_MS) { if (!ring) { fired[key] = now; ch = true; startRing(a, dkey(new Date(f)), f, false); } }
        else if (now - f < 12 * 36e5 && (a.createdAt || 0) <= f) { fired[key] = now; ch = true; arr("alarmLog").push({ id: uidp("al"), alarmId: a.id, date: dkey(new Date(f)), scheduledAt: f, outcome: "missed", rings: 0, snoozes: 0, challengeCount: a.challenge.count, challengeDone: 0, difficulty: a.challenge.difficulty, test: false, source: "web-foreground", finishedAt: now, note: "Mindly was not running in the foreground at this time" }); if (!(a.weekdays && a.weekdays.length)) a.enabled = false; save(); }
      }
      if (ch) { for (const k in fired) if (now - fired[k] > 3 * 864e5) delete fired[k]; jset(LS_FIRED, fired); }
    } catch (e) {}
    advance(now);
  }

  /* ---------- overlay UI ---------- */
  const OVST = "position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;color:#fff;background:linear-gradient(160deg,#10213f,#3a1d52);overflow:auto";
  const BTN = "font-size:20px;padding:16px 28px;border-radius:16px;border:0;min-width:200px;";
  function paint() {
    if (!ring) return; const a = find(ring.alarmId); if (!a) return;
    if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
    if (!ov) { ov = document.createElement("div"); ov.id = "alarmOv"; ov.setAttribute("role", "alertdialog"); document.body.appendChild(ov); }
    ov.style.cssText = OVST; ov.dir = A() ? "rtl" : "ltr";
    const head = '<div style="font-size:12px;opacity:.7">' + S("Foreground prototype: rings only while Mindly is open and the screen is on", "نموذج بالواجهة: بيرن بس والتطبيق مفتوح والشاشة شغالة") + '</div><div style="font-size:56px;font-weight:700">' + pad(a.hour) + ":" + pad(a.minute) + '</div><div style="font-size:22px" dir="auto">' + esc(a.label || S("Alarm", "منبه")) + (ring.test ? " · " + S("test", "تجربة") : "") + "</div>";
    if (ring.phase === "snoozed") {
      ov.innerHTML = head + '<div>' + S("Snoozed. Rings again in ", "مؤجل. بيرن بعد ") + '<b id="alcd"></b></div><button id="alwake" style="' + BTN + 'background:#6aa9ff;color:#000">' + S("Wake now", "صحيت") + '</button><button id="alskip" style="' + BTN + 'background:rgba(255,255,255,.15);color:#fff">' + S("Skip today", "تخطّي اليوم") + "</button>";
      ov.querySelector("#alwake").onclick = () => { ring.phase = "ringing"; ring.ringStart = Date.now(); persist(); paint(); playSound(a.soundId, ring.n); };
      bindSkip(); tickText(Date.now()); return;
    }
    if (ring.phase === "challenge") { challengeUI(a, head); return; }
    const left = SNOOZE_MAX - ring.snoozes, blocked = !audioReady();
    ov.innerHTML = head + '<div>' + S("Ring ", "الرنة ") + ring.n + " / " + MAX_RINGS + " · " + S("next ring in ", "الرنة الجاية بعد ") + '<b id="alcd"></b></div>' +
      (blocked ? '<button id="alsnd" style="' + BTN + 'background:#ffb454;color:#000">' + S("Tap to start sound", "اضغط لتشغيل الصوت") + "</button>" : "") +
      '<button id="alstop" style="' + BTN + 'background:#ff5d5d;color:#fff">' + (a.challenge.count ? S("Stop and start challenge", "أوقف وابدأ التحدي") : S("Stop", "إيقاف")) + "</button>" +
      (left > 0 ? '<button id="alsnz" style="' + BTN + 'background:#6aa9ff;color:#000">' + S("Snooze 5 min", "غفوة 5 دقائق") + " (" + left + ")</button>" : "") +
      '<button id="alskip" style="' + BTN + 'background:rgba(255,255,255,.15);color:#fff">' + S("Skip today", "تخطّي اليوم") + "</button>";
    const sb = ov.querySelector("#alsnd"); if (sb) sb.onclick = () => { unlock(); playSound(a.soundId, ring.n); paint(); };
    ov.querySelector("#alstop").onclick = () => { stopSound(); if (!a.challenge.count) finish("completed"); else { ring.phase = "challenge"; persist(); paint(); } };
    const sn = ov.querySelector("#alsnz"); if (sn) sn.onclick = () => { stopSound(); ring.snoozes++; ring.phase = "snoozed"; ring.snoozeUntil = Date.now() + SNOOZE_MIN * 60000; persist(); paint(); };
    bindSkip(); tickText(Date.now());
  }
  function bindSkip() {
    const b = ov.querySelector("#alskip"); if (!b) return;
    b.onclick = () => { if (Date.now() - skipArm < 4000) { finish("skipped"); return; } skipArm = Date.now(); b.textContent = S("Tap again to skip today", "اضغط مرة ثانية للتخطي"); setTimeout(() => { if (ov && ov.contains(b) && Date.now() - skipArm >= 3900) b.textContent = S("Skip today", "تخطّي اليوم"); }, 4100); };
  }

  /* ---------- challenge UI ---------- */
  function openTask() { return (DB.tasks || []).filter(t => t.status !== "done").sort((x, y) => String(x.due || "9").localeCompare(String(y.due || "9")))[0] || null; }
  function challengeUI(a, head) {
    if (!ring.seq) ring.seq = pickTypes(a, a.challenge.count).map(t => ({ type: t, data: null }));
    const i = ring.done, n = a.challenge.count; if (i >= n) { finish("completed"); return; }
    const cur = ring.seq[i], d = a.challenge.difficulty;
    ov.innerHTML = head + '<div style="width:100%;max-width:420px"><div style="height:8px;background:rgba(255,255,255,.2);border-radius:4px"><div style="height:8px;width:' + Math.round(i / n * 100) + '%;background:#6aa9ff;border-radius:4px"></div></div><div style="margin-top:6px">' + S("Task ", "المهمة ") + (i + 1) + " / " + n + " · " + S("next ring in ", "الرنة الجاية بعد ") + '<b id="alcd"></b></div></div><div id="alch" style="width:100%;max-width:420px"></div><div class="m" style="font-size:12px;opacity:.7">' + S("Stuck on this task? You can swap it once or twice, or snooze or skip.", "عالق بالمهمة؟ فيك تبدلها مرة أو مرتين، أو تغفى أو تتخطى.") + '</div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' + (ring.swaps < 2 ? '<button id="alswap" style="padding:10px 16px;border-radius:12px;border:0">' + S("Swap task", "بدّل المهمة") + "</button>" : "") + (SNOOZE_MAX - ring.snoozes > 0 ? '<button id="alsnz2" style="padding:10px 16px;border-radius:12px;border:0">' + S("Snooze", "غفوة") + "</button>" : "") + '<button id="alskip" style="padding:10px 16px;border-radius:12px;border:0">' + S("Skip today", "تخطّي اليوم") + "</button></div>";
    const box = ov.querySelector("#alch"), ok = () => { ring.done++; persist(); paint(); };
    cleanup = RUN[cur.type](box, cur, d, a, ok) || null;
    const sw = ov.querySelector("#alswap"); if (sw) sw.onclick = () => { ring.swaps++; cur.type = pickTypes({ challenge: { types: (a.challenge.types || []).filter(t => t !== cur.type) }, qrCode: a.qrCode }, 1)[0]; cur.data = null; paint(); };
    const sn = ov.querySelector("#alsnz2"); if (sn) sn.onclick = () => { ring.snoozes++; ring.phase = "snoozed"; ring.snoozeUntil = Date.now() + SNOOZE_MIN * 60000; persist(); paint(); };
    bindSkip(); tickText(Date.now());
  }
  const inpStyle = "font-size:26px;padding:12px;width:100%;border-radius:12px;border:0;text-align:center;color:#000";
  const bigBtn = "font-size:18px;padding:12px 22px;border-radius:14px;border:0;background:#6aa9ff;color:#000;margin-top:8px";
  function typed(box, prompt, ans, ok, regen) {
    box.innerHTML = '<div style="font-size:34px;margin-bottom:10px" dir="ltr">' + prompt + '</div><input id="alin" inputmode="numeric" autocomplete="off" style="' + inpStyle + '"><button id="alok" style="' + bigBtn + '">' + S("Check", "تحقق") + '</button><div id="alerr" style="color:#ffb4b4;min-height:20px"></div>';
    const go = () => { const v = box.querySelector("#alin").value.trim(); if (v === ans) ok(); else { box.querySelector("#alerr").textContent = S("Not right, try again", "مش صح، جرب مرة ثانية"); box.querySelector("#alin").value = ""; if (regen) regen(); } };
    box.querySelector("#alok").onclick = go; box.querySelector("#alin").onkeydown = e => { if (e.key === "Enter") go(); };
  }
  const RUN = {
    math(box, cur, d, a, ok) { cur.data = cur.data || genMath(d); typed(box, esc(cur.data.q) + " = ?", cur.data.ans, ok); },
    puzzle(box, cur, d, a, ok) {
      if (!cur.data) cur.data = Math.random() < 0.5 ? Object.assign({ k: "seq" }, genSeq(d)) : Object.assign({ k: "order" }, genOrder(d));
      if (cur.data.k === "seq") { typed(box, cur.data.shown.join(", ") + ", ?", cur.data.ans, ok); return; }
      const sorted = cur.data.nums.slice().sort((x, y) => x - y); let nxt = 0;
      box.innerHTML = '<div style="margin-bottom:8px">' + S("Tap the numbers from smallest to largest", "اضغط الأرقام من الأصغر للأكبر") + '</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' + cur.data.nums.map(x => '<button data-n="' + x + '" style="font-size:26px;padding:16px;border-radius:14px;border:0">' + x + "</button>").join("") + "</div>";
      box.querySelectorAll("[data-n]").forEach(b => b.onclick = () => { if (+b.dataset.n === sorted[nxt]) { b.disabled = true; b.style.opacity = ".3"; nxt++; if (nxt === sorted.length) ok(); } else { nxt = 0; box.querySelectorAll("[data-n]").forEach(x => { x.disabled = false; x.style.opacity = "1"; }); } });
    },
    memory(box, cur, d, a, ok) {
      cur.data = cur.data || genMem(d); const dig = cur.data.digits; let t;
      box.innerHTML = '<div>' + S("Memorize this number", "احفظ هذا الرقم") + '</div><div style="font-size:48px;letter-spacing:6px;margin:10px" dir="ltr">' + dig + '</div><div id="alm">3</div>'; let s = 3;
      t = setInterval(() => { s--; const el = box.querySelector("#alm"); if (el) el.textContent = s; if (s <= 0) { clearInterval(t); typed(box, S("What was the number?", "شو كان الرقم؟"), dig, ok, () => { cur.data = null; setTimeout(() => { if (ov && ring && ring.phase === "challenge") paint(); }, 600); }); } }, 1000);
      return () => clearInterval(t);
    },
    practical(box, cur, d, a, ok) {
      if (!cur.data) { const t = (a.linkedTaskId && DB.tasks.find(x => x.id === a.linkedTaskId && x.status !== "done")) || (Math.random() < 0.5 ? openTask() : null); cur.data = t ? { taskId: t.id, text: t.title } : { text: (A() ? PRACTICAL[rnd(0, 3)][1] : PRACTICAL[rnd(0, 3)][0]) }; }
      const wait = d === "hard" ? 10 : d === "medium" ? 3 : 0; let s = wait, t;
      box.innerHTML = '<div style="font-size:24px;margin-bottom:6px" dir="auto">' + esc(cur.data.text) + '</div><div class="m">' + (cur.data.taskId ? S("This is one of your Mindly tasks. Doing it marks it done.", "هذي من مهامك بمندلي. لما تنفذها بتنعلّم خلصت.") : S("Do it for real, then confirm.", "نفذها فعلاً وبعدين أكّد.")) + '</div><button id="alpr" style="' + bigBtn + '">' + (wait ? S("Wait ", "انتظر ") + wait + "s" : S("I did it", "نفذتها")) + "</button>";
      const b = box.querySelector("#alpr"); if (wait) { b.disabled = true; t = setInterval(() => { s--; if (s <= 0) { clearInterval(t); b.disabled = false; b.textContent = S("I did it", "نفذتها"); } else b.textContent = S("Wait ", "انتظر ") + s + "s"; }, 1000); }
      b.onclick = () => { if (cur.data.taskId) { const tk = DB.tasks.find(x => x.id === cur.data.taskId); if (tk && tk.status !== "done") { tk.status = "done"; tk.doneAt = Date.now(); save(); } } ok(); };
      return () => clearInterval(t);
    },
    shake(box, cur, d, a, ok) { return motionTask(box, COUNTS[d][0], S("Shake the phone", "هز الجوال"), makeShake, ok); },
    steps(box, cur, d, a, ok) { return motionTask(box, Math.round(COUNTS[d][0] * 1.3), S("Walk with the phone in your hand. This counts motion peaks, it is an approximation, not a real pedometer.", "امشي والجوال بإيدك. هذا بيعد قمم الحركة، تقريبي مش عداد خطوات حقيقي."), makeSteps, ok); },
    qr(box, cur, d, a, ok) { return qrTask(box, a.qrCode, ok); }
  };
  function motionTask(box, target, label, mk, ok) {
    let c = 0, got = 0, h = null, nodata;
    const draw = () => { box.innerHTML = '<div style="margin-bottom:8px">' + label + '</div><div style="font-size:48px"><span id="alc">' + c + "</span> / " + target + '</div><div id="alms" class="m"></div>'; };
    const det = mk(() => { c++; const el = box.querySelector("#alc"); if (el) el.textContent = c; if (c >= target) { stop(); ok(); } });
    const stop = () => { if (h) window.removeEventListener("devicemotion", h); clearTimeout(nodata); h = null; };
    const start = () => { h = e => { const g = e.accelerationIncludingGravity; if (!g || g.x == null) return; got++; det({ x: g.x, y: g.y, z: g.z, t: Date.now() }); }; window.addEventListener("devicemotion", h); nodata = setTimeout(() => { if (!got) { const m = box.querySelector("#alms"); if (m) m.textContent = S("No motion data from this device or browser. Use Swap task.", "ما وصلت بيانات حركة من هذا الجهاز أو المتصفح. استخدم بدّل المهمة."); } }, 3000); };
    draw();
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      box.insertAdjacentHTML("beforeend", '<button id="almo" style="' + bigBtn + '">' + S("Allow motion access", "اسمح بالوصول للحركة") + "</button>");
      box.querySelector("#almo").onclick = async () => { try { const r = await DeviceMotionEvent.requestPermission(); if (r === "granted") { box.querySelector("#almo").remove(); start(); } else box.querySelector("#alms").textContent = S("Motion access was denied. Use Swap task.", "تم رفض الحركة. استخدم بدّل المهمة."); } catch (e) { box.querySelector("#alms").textContent = S("Could not ask for motion access. Use Swap task.", "ما قدرت اطلب إذن الحركة. استخدم بدّل المهمة."); } };
    } else start();
    return stop;
  }
  function qrTask(box, code, ok) {
    let stream = null, run = true; box.innerHTML = '<div style="margin-bottom:8px">' + S("Scan your registered QR code", "امسح رمز QR المسجّل") + '</div><video id="alv" playsinline muted style="width:100%;border-radius:12px"></video><div id="alq" class="m"></div>';
    (async () => {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); const v = box.querySelector("#alv"); v.srcObject = stream; await v.play(); const scan = await makeScanner();
        while (run) { const r = await scan(v); if (r && r === code) { ok(); return; } await new Promise(x => setTimeout(x, 300)); }
      } catch (e) { const q = box.querySelector("#alq"); if (q) q.textContent = S("Camera or QR scanning is not available. Use Swap task.", "الكاميرا أو مسح QR مش متاح. استخدم بدّل المهمة."); }
    })();
    return () => { run = false; if (stream) stream.getTracks().forEach(t => t.stop()); };
  }

  /* ---------- screens ---------- */
  const DAYN = [["Sun", "أحد"], ["Mon", "اثنين"], ["Tue", "ثلاثاء"], ["Wed", "أربعاء"], ["Thu", "خميس"], ["Fri", "جمعة"], ["Sat", "سبت"]];
  const bannerHtml = () => '<div class="card" style="border-color:#ffb454"><div class="t">' + S("Foreground web prototype", "نموذج ويب بالواجهة") + '</div><div class="m">' + S("Alarms ring only while Mindly is open on screen. If the app is closed, the phone is locked, or the tab is in the background, nothing rings. Silent mode and Focus are not bypassed. The real alarm needs the native iOS app.", "المنبهات بترن بس والتطبيق مفتوح على الشاشة. إذا التطبيق مسكّر أو الجوال مقفل أو بالخلفية ما رح يرن شي. وضع الصامت وFocus ما بيتجاوزوا. المنبه الحقيقي بدو تطبيق iOS الأصلي.") + "</div></div>";
  function fmtNext(a) { const t = nextFire(a, Date.now()); if (!t) return a.enabled ? S("No upcoming time", "ما في وقت جاي") : S("Off", "مطفي"); const d = new Date(t); return d.toLocaleString(A() ? "ar" : "en", { weekday: "short", hour: "2-digit", minute: "2-digit" }); }
  function listScreen() {
    const al = arr("alarms").slice().sort((x, y) => x.hour * 60 + x.minute - (y.hour * 60 + y.minute));
    const rows = al.map(a => '<div class="card"><div class="row"><div class="grow"><div class="t" dir="auto">' + pad(a.hour) + ":" + pad(a.minute) + " · " + esc(a.label || S("Alarm", "منبه")) + '</div><div class="m">' + esc(fmtNext(a)) + " · " + (a.weekdays && a.weekdays.length ? a.weekdays.map(d => S(DAYN[d][0], DAYN[d][1])).join(" ") : S("one time", "مرة وحدة")) + " · " + S("challenge ", "تحدي ") + a.challenge.count + (a.challenge.count ? " " + S(a.challenge.difficulty, { easy: "سهل", medium: "متوسط", hard: "صعب" }[a.challenge.difficulty]) : "") + '</div></div><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-aon="' + esc(a.id) + '"' + (a.enabled ? " checked" : "") + "></label></div>" +
      '<div class="acts"><button class="btn" data-aed="' + esc(a.id) + '">' + S("Edit", "تعديل") + '</button><button class="btn" data-ate="' + esc(a.id) + '">' + S("Test now", "جرّب هلأ") + '</button><button class="btn" data-adl="' + esc(a.id) + '" style="color:#ff6b6b">' + S("Delete", "حذف") + "</button></div></div>").join("");
    const next = al.map(a => nextFire(a, Date.now())).filter(Boolean).sort()[0];
    sheet('<h3 style="margin:0 0 6px">' + S("Smart Alarm (prototype)", "المنبه الذكي (نموذج)") + "</h3>" + bannerHtml() +
      '<div class="card"><div class="m">' + S("Sound: ", "الصوت: ") + (audioReady() ? S("ready", "جاهز") : S("not enabled yet", "مش مفعّل بعد")) + " · " + S("Screen kept on: ", "إبقاء الشاشة: ") + (wl ? S("yes", "نعم") : armed() ? S("requested", "مطلوب") : S("no alarms on", "ما في منبهات شغالة")) + " · " + S("Next: ", "الجاي: ") + (next ? esc(new Date(next).toLocaleString(A() ? "ar" : "en", { weekday: "short", hour: "2-digit", minute: "2-digit" })) : "-") + '</div><div class="acts"><button class="btn" id="aens">' + S("Enable sound", "فعّل الصوت") + '</button></div></div>' +
      (rows || '<div class="empty">' + S("No alarms yet.", "ما في منبهات لسا.") + "</div>") +
      '<div class="acts" style="flex-wrap:wrap"><button class="btn p" id="anew">' + S("New alarm", "منبه جديد") + '</button><button class="btn" id="ahis">' + S("History", "السجل") + '</button><button class="btn" id="arou">' + S("Routines", "الروتين") + "</button></div>", () => {
      const q = s => document.querySelector(s);
      q("#aens").onclick = () => { unlock(); playSound(1, 1, true); setTimeout(listScreen, 500); };
      q("#anew").onclick = () => editor(); q("#ahis").onclick = history; q("#arou").onclick = routinesScreen;
      document.querySelectorAll("[data-aon]").forEach(b => b.onchange = () => { const a = find(b.dataset.aon); a.enabled = b.checked; a.updatedAt = Date.now(); save(); if (b.checked) { unlock(); keepAwake(); } listScreen(); });
      document.querySelectorAll("[data-aed]").forEach(b => b.onclick = () => editor(b.dataset.aed));
      document.querySelectorAll("[data-ate]").forEach(b => b.onclick = () => { const a = find(b.dataset.ate); unlock(); closeSheet(); startRing(a, dkey(new Date()), Date.now(), true); });
      document.querySelectorAll("[data-adl]").forEach(b => b.onclick = () => { if (b.dataset.sure) { const i = arr("alarms").findIndex(x => x.id === b.dataset.adl); if (i >= 0) { arr("alarms").splice(i, 1); save(); } listScreen(); } else { b.dataset.sure = 1; b.textContent = S("Tap again to delete", "اضغط مرة ثانية للحذف"); } });
    });
  }
  function editor(id) {
    const ex = id && find(id), now = new Date(Date.now() + 120000), a = ex || { schema: 1, id: uidp("a"), label: "", hour: now.getHours(), minute: now.getMinutes(), weekdays: [], oneTimeDate: dkey(now), enabled: true, soundId: 1, snooze: { minutes: SNOOZE_MIN, max: SNOOZE_MAX }, retry: { rings: MAX_RINGS, intervalMinutes: 2 }, challenge: { count: 0, difficulty: "easy", types: ["math", "memory", "puzzle", "practical"] }, routineId: "", linkedTaskId: "", qrCode: "", createdAt: Date.now() };
    const wd = new Set(a.weekdays), ty = new Set(a.challenge.types), tasks = (DB.tasks || []).filter(t => t.status !== "done").slice(0, 40), rts = arr("routines");
    const why = t => t === "shake" || t === "steps" ? (MOTION ? S("needs motion permission", "بدو إذن الحركة") : S("not available here", "مش متاح هون")) : t === "qr" ? (QRCAP ? S("camera; register a code first", "كاميرا؛ سجّل رمز أول") : S("not available: no camera access in this browser", "مش متاح: ما في وصول للكاميرا بهالمتصفح")) : "";
    sheet('<h3 style="margin:0 0 6px">' + (ex ? S("Edit alarm", "تعديل المنبه") : S("New alarm", "منبه جديد")) + "</h3>" +
      '<div class="card"><input id="al-l" dir="auto" placeholder="' + S("Label", "الاسم") + '" value="' + esc(a.label) + '"><div class="row" style="margin-top:8px"><input id="al-t" type="time" value="' + pad(a.hour) + ":" + pad(a.minute) + '"><input id="al-d" type="date" value="' + esc(a.oneTimeDate || "") + '"></div><div class="m">' + S("Repeat (leave empty for one time on the date)", "التكرار (اتركه فاضي لمرة وحدة بالتاريخ)") + '</div><div class="acts" style="flex-wrap:wrap">' + DAYN.map((d, i) => '<button class="btn' + (wd.has(i) ? " p" : "") + '" data-ad="' + i + '">' + S(d[0], d[1]) + "</button>").join("") + "</div></div>" +
      '<div class="card"><div class="t">' + S("Sound", "الصوت") + '</div><div class="acts" style="flex-wrap:wrap">' + SOUNDS.map(s => '<button class="btn' + (a.soundId === s[0] ? " p" : "") + '" data-as="' + s[0] + '">' + S(s[1], s[2]) + "</button>").join("") + '</div><div class="m">' + S("Tap a sound to hear it. These six sounds are generated by the app.", "اضغط صوت لتسمعه. هالأصوات الستة مولّدة من التطبيق.") + "</div></div>" +
      '<div class="card"><div class="t">' + S("Challenge before the alarm counts as done", "تحدي قبل ما يُحسب المنبه منجز") + '</div><div class="acts">' + [0, 1, 3, 5].map(n => '<button class="btn' + (a.challenge.count === n ? " p" : "") + '" data-ac="' + n + '">' + (n || S("None", "بدون")) + "</button>").join("") + '</div><div class="acts">' + ["easy", "medium", "hard"].map(d => '<button class="btn' + (a.challenge.difficulty === d ? " p" : "") + '" data-adf="' + d + '">' + S(d, { easy: "سهل", medium: "متوسط", hard: "صعب" }[d]) + "</button>").join("") + "</div>" +
      ALLTYPES.map(t => '<label style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" data-aty="' + t + '"' + (ty.has(t) ? " checked" : "") + (typeOk(t) ? "" : " disabled") + "><span>" + S(TNAME[t][0], TNAME[t][1]) + (why(t) ? ' <span class="m">(' + why(t) + ")</span>" : "") + "</span></label>").join("") +
      (QRCAP && ex ? '<div class="acts"><button class="btn" id="aqr">' + (a.qrCode ? S("QR registered. Replace", "تم تسجيل QR. استبدال") : S("Register QR code", "سجّل رمز QR")) + "</button></div>" : "") + "</div>" +
      '<div class="card"><div class="t">' + S("Link to existing Mindly items (no copies are made)", "ربط بعناصر مندلي الموجودة (ما بنعمل نسخ)") + '</div><select id="al-k" style="width:100%;margin-top:6px"><option value="">' + S("No linked task", "بدون مهمة مرتبطة") + "</option>" + tasks.map(t => '<option value="' + esc(t.id) + '"' + (a.linkedTaskId === t.id ? " selected" : "") + ">" + esc(String(t.title).slice(0, 50)) + "</option>").join("") + '</select><select id="al-r" style="width:100%;margin-top:6px"><option value="">' + S("No routine", "بدون روتين") + "</option>" + rts.map(r => '<option value="' + esc(r.id) + '"' + (a.routineId === r.id ? " selected" : "") + ">" + esc(r.title) + "</option>").join("") + "</select></div>" +
      '<div class="acts"><button class="btn p" id="asv">' + S("Save", "حفظ") + '</button><button class="btn" id="acn">' + S("Back", "رجوع") + "</button></div>", () => {
      const q = s => document.querySelector(s);
      document.querySelectorAll("[data-ad]").forEach(b => b.onclick = () => { const i = +b.dataset.ad; wd.has(i) ? wd.delete(i) : wd.add(i); b.classList.toggle("p"); });
      document.querySelectorAll("[data-as]").forEach(b => b.onclick = () => { a.soundId = +b.dataset.as; unlock(); playSound(a.soundId, 1, true); document.querySelectorAll("[data-as]").forEach(x => x.classList.toggle("p", x === b)); });
      document.querySelectorAll("[data-ac]").forEach(b => b.onclick = () => { a.challenge.count = +b.dataset.ac; document.querySelectorAll("[data-ac]").forEach(x => x.classList.toggle("p", x === b)); });
      document.querySelectorAll("[data-adf]").forEach(b => b.onclick = () => { a.challenge.difficulty = b.dataset.adf; document.querySelectorAll("[data-adf]").forEach(x => x.classList.toggle("p", x === b)); });
      document.querySelectorAll("[data-aty]").forEach(b => b.onchange = () => { b.checked ? ty.add(b.dataset.aty) : ty.delete(b.dataset.aty); });
      const qb = q("#aqr"); if (qb) qb.onclick = () => registerQr(a, () => editorKeep(a, wd, ty));
      q("#acn").onclick = listScreen;
      q("#asv").onclick = () => {
        const t = q("#al-t").value.split(":"); if (t.length < 2) return; a.hour = +t[0]; a.minute = +t[1]; a.label = q("#al-l").value.trim(); a.weekdays = [...wd].sort(); a.oneTimeDate = a.weekdays.length ? "" : (q("#al-d").value || dkey(new Date()));
        a.challenge.types = ALLTYPES.filter(x => ty.has(x) && typeOk(x)); if (a.challenge.count && !a.challenge.types.length) a.challenge.types = ["math"]; a.linkedTaskId = q("#al-k").value; a.routineId = q("#al-r").value; a.enabled = true; a.updatedAt = Date.now();
        if (!ex) arr("alarms").push(a); save(); unlock(); keepAwake(); listScreen();
      };
    });
  }
  function editorKeep(a, wd, ty) { if (!find(a.id)) { /* unsaved new alarm: keep in memory only */ } listScreen(); }
  function registerQr(a, back) {
    let stream = null, run = true;
    sheet('<h3 style="margin:0 0 6px">' + S("Register QR code", "تسجيل رمز QR") + '</h3><video id="rqv" playsinline muted style="width:100%;border-radius:12px"></video><div id="rqs" class="m"></div><div class="acts"><button class="btn" id="rqc">' + S("Cancel", "إلغاء") + "</button></div>", () => {
      const stop = () => { run = false; if (stream) stream.getTracks().forEach(t => t.stop()); };
      document.querySelector("#rqc").onclick = () => { stop(); back(); };
      (async () => { try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); const v = document.querySelector("#rqv"); v.srcObject = stream; await v.play(); const scan = await makeScanner();
        while (run) { const r = await scan(v); if (r) { a.qrCode = r; const ex = find(a.id); if (ex) { ex.qrCode = a.qrCode; save(); } stop(); document.querySelector("#rqs").textContent = S("Registered.", "تم التسجيل."); setTimeout(back, 600); return; } await new Promise(x => setTimeout(x, 300)); }
      } catch (e) { const s = document.querySelector("#rqs"); if (s) s.textContent = S("Camera or QR scanning is not available.", "الكاميرا أو مسح QR مش متاح."); } })();
    });
  }
  function history() {
    const logs = arr("alarmLog"), real = logs.filter(l => !l.test), done = real.filter(l => l.outcome === "completed").length, st = streak(logs, arr("alarms"), dkey(new Date())), ach = achievements(logs);
    const week = real.filter(l => Date.now() - l.finishedAt < 7 * 864e5), c = o => week.filter(l => l.outcome === o).length;
    const OUT = { completed: ["Completed", "مكتمل"], skipped: ["Skipped (neutral)", "تخطي (محايد)"], incomplete: ["Not completed (neutral)", "غير مكتمل (محايد)"], missed: ["App was not open (neutral)", "التطبيق مش مفتوح (محايد)"] };
    sheet('<h3 style="margin:0 0 6px">' + S("Alarm history", "سجل المنبهات") + "</h3>" +
      '<div class="card"><div class="t">' + S("Days in a row with a completed alarm: ", "أيام متتالية بمنبه مكتمل: ") + st + '</div><div class="m">' + S("Skipped, not-completed and app-not-open days are neutral: they do not reset it.", "الأيام المتخطاة وغير المكتملة وأيام التطبيق مسكّر محايدة: ما بتصفّر العدّاد.") + '</div><div class="m">' + S("This week: ", "هالأسبوع: ") + c("completed") + " " + S("completed", "مكتمل") + ", " + c("skipped") + " " + S("skipped", "متخطى") + ", " + c("incomplete") + " " + S("not completed", "غير مكتمل") + ", " + c("missed") + " " + S("app not open", "التطبيق مش مفتوح") + " · " + S("total completed: ", "إجمالي المكتمل: ") + done + "</div></div>" +
      '<div class="card"><div class="t">' + S("Achievements", "الإنجازات") + "</div>" + ach.map(x => '<div class="m">' + (x[3] ? "✅ " : "▫️ ") + S(x[1], x[2]) + "</div>").join("") + "</div>" +
      (logs.slice().reverse().slice(0, 40).map(l => { const al = find(l.alarmId); return '<div class="card"><div class="t" dir="auto">' + esc(l.date) + " · " + esc((al && al.label) || S("Alarm", "منبه")) + (l.test ? " · " + S("test", "تجربة") : "") + '</div><div class="m">' + S(OUT[l.outcome][0], OUT[l.outcome][1]) + " · " + S("rings ", "رنات ") + l.rings + " · " + S("snoozes ", "غفوات ") + l.snoozes + (l.challengeCount ? " · " + S("tasks ", "مهام ") + l.challengeDone + "/" + l.challengeCount : "") + "</div></div>"; }).join("") || '<div class="empty">' + S("No history yet.", "ما في سجل لسا.") + "</div>") +
      '<div class="acts"><button class="btn" id="hbk">' + S("Back", "رجوع") + "</button></div>", () => { document.querySelector("#hbk").onclick = listScreen; });
  }
  function routinesScreen() {
    const rs = arr("routines");
    sheet('<h3 style="margin:0 0 6px">' + S("Morning routines", "روتين الصباح") + '</h3><div class="m">' + S("A routine is a checklist. A step can point at one of your existing Mindly tasks (checking it marks that task done) or be a quick step that lives only in the routine.", "الروتين قائمة. الخطوة ممكن تشير لمهمة موجودة بمندلي (تأشيرها بتعلّم المهمة خلصت) أو تكون خطوة سريعة بس بالروتين.") + "</div>" +
      (rs.map(r => '<div class="card"><div class="t" dir="auto">' + esc(r.title) + '</div><div class="m">' + r.steps.length + " " + S("steps", "خطوات") + '</div><div class="acts"><button class="btn p" data-rr="' + esc(r.id) + '">' + S("Run", "شغّل") + '</button><button class="btn" data-re="' + esc(r.id) + '">' + S("Edit", "تعديل") + '</button><button class="btn" data-rd="' + esc(r.id) + '" style="color:#ff6b6b">' + S("Delete", "حذف") + "</button></div></div>").join("") || '<div class="empty">' + S("No routines yet.", "ما في روتين لسا.") + "</div>") +
      '<div class="acts"><button class="btn p" id="rnew">' + S("New routine", "روتين جديد") + '</button><button class="btn" id="rbk">' + S("Back", "رجوع") + "</button></div>", () => {
      const q = s => document.querySelector(s); q("#rbk").onclick = listScreen; q("#rnew").onclick = () => routineEditor();
      document.querySelectorAll("[data-rr]").forEach(b => b.onclick = () => runRoutine(b.dataset.rr)); document.querySelectorAll("[data-re]").forEach(b => b.onclick = () => routineEditor(b.dataset.re));
      document.querySelectorAll("[data-rd]").forEach(b => b.onclick = () => { if (b.dataset.sure) { const i = rs.findIndex(x => x.id === b.dataset.rd); if (i >= 0) { rs.splice(i, 1); arr("alarms").forEach(a => { if (a.routineId === b.dataset.rd) a.routineId = ""; }); save(); } routinesScreen(); } else { b.dataset.sure = 1; b.textContent = S("Tap again to delete", "اضغط مرة ثانية للحذف"); } });
    });
  }
  function routineEditor(id) {
    const ex = id && arr("routines").find(r => r.id === id), r = ex || { id: uidp("r"), title: "", steps: [], checks: {} }, tasks = (DB.tasks || []).filter(t => t.status !== "done").slice(0, 40);
    const stepName = s => s.taskId ? ((DB.tasks.find(t => t.id === s.taskId) || {}).title || S("(task removed)", "(المهمة انحذفت)")) : s.text;
    const draw = () => sheet('<h3 style="margin:0 0 6px">' + (ex ? S("Edit routine", "تعديل الروتين") : S("New routine", "روتين جديد")) + '</h3><div class="card"><input id="rt-t" dir="auto" placeholder="' + S("Routine name", "اسم الروتين") + '" value="' + esc(r.title) + '"></div>' +
      r.steps.map((s, i) => '<div class="card"><div class="t" dir="auto">' + esc(stepName(s)) + '</div><div class="m">' + (s.taskId ? S("existing Mindly task", "مهمة موجودة بمندلي") : S("quick step", "خطوة سريعة")) + '</div><div class="acts"><button class="btn" data-sx="' + i + '" style="color:#ff6b6b">' + S("Remove", "إزالة") + "</button></div></div>").join("") +
      '<div class="card"><input id="rt-s" dir="auto" placeholder="' + S("Add a quick step", "ضيف خطوة سريعة") + '"><div class="acts"><button class="btn" id="rt-a">' + S("Add step", "ضيف خطوة") + '</button></div><select id="rt-k" style="width:100%"><option value="">' + S("Or pick an existing task", "أو اختر مهمة موجودة") + "</option>" + tasks.map(t => '<option value="' + esc(t.id) + '">' + esc(String(t.title).slice(0, 50)) + "</option>").join("") + '</select></div><div class="acts"><button class="btn p" id="rt-v">' + S("Save", "حفظ") + '</button><button class="btn" id="rt-b">' + S("Back", "رجوع") + "</button></div>", () => {
      const q = s => document.querySelector(s), keep = () => { r.title = q("#rt-t").value.trim(); };
      q("#rt-a").onclick = () => { keep(); const t = q("#rt-s").value.trim(), k = q("#rt-k").value; if (k) r.steps.push({ id: uidp("s"), taskId: k }); else if (t) r.steps.push({ id: uidp("s"), text: t }); draw(); };
      document.querySelectorAll("[data-sx]").forEach(b => b.onclick = () => { keep(); r.steps.splice(+b.dataset.sx, 1); draw(); });
      q("#rt-b").onclick = routinesScreen; q("#rt-v").onclick = () => { keep(); if (!r.title) r.title = S("Morning routine", "روتين الصباح"); if (!ex) arr("routines").push(r); save(); routinesScreen(); };
    });
    draw();
  }
  function runRoutine(id) {
    const r = arr("routines").find(x => x.id === id); if (!r) return; const k = dkey(new Date()); r.checks = r.checks || {}; const ch = new Set(r.checks[k] || []);
    const isDone = s => s.taskId ? (DB.tasks.find(t => t.id === s.taskId) || {}).status === "done" : ch.has(s.id);
    sheet('<h3 style="margin:0 0 6px" dir="auto">' + esc(r.title) + "</h3>" + r.steps.map(s => '<label class="card" style="display:flex;gap:10px;align-items:center"><input type="checkbox" data-rc="' + esc(s.id) + '"' + (isDone(s) ? " checked" : "") + '><span dir="auto">' + esc(s.taskId ? ((DB.tasks.find(t => t.id === s.taskId) || {}).title || "") : s.text) + "</span></label>").join("") + '<div class="acts"><button class="btn" id="rrc">' + S("Close", "إغلاق") + "</button></div>", () => {
      document.querySelectorAll("[data-rc]").forEach(b => b.onchange = () => { const s = r.steps.find(x => x.id === b.dataset.rc); if (s.taskId) { const t = DB.tasks.find(x => x.id === s.taskId); if (t) { t.status = b.checked ? "done" : "open"; if (b.checked) t.doneAt = Date.now(); else delete t.doneAt; } } else { b.checked ? ch.add(s.id) : ch.delete(s.id); r.checks[k] = [...ch]; } save(); try { render(); } catch (e) {} });
      document.querySelector("#rrc").onclick = () => { closeSheet(); };
    });
  }

  /* ---------- boot ---------- */
  function restore() {
    const s = jget(LS_STATE, null); if (!s) return; const a = find(s.alarmId), now = Date.now();
    if (!a) { try { localStorage.removeItem(LS_STATE); } catch (e) {} return; }
    const alive = s.phase === "snoozed" ? now < s.snoozeUntil + RING_MS : now < s.ringStart + RING_MS;
    if (alive) { ring = Object.assign({ seq: null, cur: 0, swaps: 0 }, s); paint(); if (ring.phase === "ringing") playSound(a.soundId, ring.n); }
    else { ring = Object.assign({ seq: null, cur: 0, swaps: 0 }, s); finish("incomplete", "Mindly was closed while ringing"); }
  }
  ["pointerdown", "touchend", "keydown"].forEach(ev => document.addEventListener(ev, function once() { unlock(); if (audioReady()) document.removeEventListener(ev, once, true); }, true));
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-alarm="1">' + S("Smart Alarm (prototype)", "المنبه الذكي (نموذج)") + "</button></div>" + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-alarm]"); if (b) { e.preventDefault(); unlock(); listScreen(); } });
  setInterval(tick, 1000);
  try { restore(); if (armed()) keepAwake(); render(); } catch (e) {}
  /* v80: Quick capture adds an alarm with the same defaults as the alarm screen (sound 1, snooze 5x3, 5 rings 2 min apart, no challenge). */
  function quickAdd(label, hour, minute, weekdays, dateKey) {
    const a = { schema: 1, id: uidp("a"), label: String(label || "").trim(), hour: +hour, minute: +minute || 0, weekdays: (weekdays || []).map(Number).sort(), oneTimeDate: (weekdays && weekdays.length) ? "" : (dateKey || dkey(new Date())), enabled: true, soundId: 1, snooze: { minutes: SNOOZE_MIN, max: SNOOZE_MAX }, retry: { rings: MAX_RINGS, intervalMinutes: 2 }, challenge: { count: 0, difficulty: "easy", types: ["math", "memory", "puzzle", "practical"] }, routineId: "", linkedTaskId: "", qrCode: "", createdAt: Date.now(), updatedAt: Date.now() };
    arr("alarms").push(a); save(); unlock(); keepAwake(); return a;
  }
  window.MindlyAlarm = { open: listScreen, startRing, quickAdd, _t: { fireTimeOn, nextFire, streak, achievements, makeShake, makeSteps, genMath, genMem, genSeq, genOrder, pickTypes, dueOn, ring: () => ring, tick } };
})();
