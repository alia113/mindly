/* Mindly module: screen fit for the iPhone Home Screen app. Layout only, no data.
   Problem: in the installed iPhone app the layout viewport (innerHeight) can be shorter than the real screen (measured: 894 of 956, gap 62), which leaves a strip below the content and puts the nav pill 62 px too high.
   Fix: when running standalone and the gap is 20-120 px, extend #app and dialogs down by the gap and lower the nav by the same amount, so the pill sits 12 px above the real bottom as designed.
   Does not change nav logic or the voice code (the voice screen is not touched). Kill switch: localStorage "mindly.screenfit.off" = "1", or the toggle at the bottom of Settings.
   Also: replaces the small text gear with an SVG gear, and shows the real build number in the Settings footer. */
(function () {
  "use strict";
  if (window.MindlySF) return;
  const KEY = "mindly.screenfit.off";
  const off = () => { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } };
  const root = document.documentElement;
  const st = document.createElement("style"); st.id = "mindly-screenfit";
  st.textContent =
    "html.sf-gap #app{bottom:calc(-1 * var(--sf-gap,0px))}" +
    "html.sf-gap .dlg{bottom:calc(-1 * var(--sf-gap,0px))}" +
    "html.sf-gap nav.bar{bottom:calc(var(--sb,0px) + 8px - var(--sf-gap,0px))!important}" +
    "#setBtn svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;display:block;margin:0 auto}" +
    ".sf-row{margin-top:8px;font-size:12px}.sf-row .btn{min-height:40px}";
  document.head.appendChild(st);
  let cur = 0;
  function measure() {
    const standalone = !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches));
    const ih = window.innerHeight, iw = window.innerWidth, vv = window.visualViewport;
    const portrait = ih >= iw, full = portrait ? Math.max(screen.height || 0, window.outerHeight || 0, ih) : ih;
    const gap = full - ih, kb = !!(vv && vv.height < ih - 100);
    const ok = standalone && portrait && !kb && gap >= 20 && gap <= 120 && Math.abs(iw - (screen.width || iw)) < 2;
    return { standalone, ih, iw, full, gap, kb, ok };
  }
  function apply() {
    try {
      const m = measure(), g = off() || !m.ok ? 0 : m.gap;
      if (g === cur) return; cur = g;
      if (g) { root.style.setProperty("--sf-gap", g + "px"); root.classList.add("sf-gap"); } else { root.style.removeProperty("--sf-gap"); root.classList.remove("sf-gap"); }
    } catch (e) {}
  }
  apply();
  ["resize", "orientationchange", "pageshow", "focusin", "focusout"].forEach(ev => addEventListener(ev, () => { apply(); setTimeout(apply, 350); }));
  if (window.visualViewport) { visualViewport.addEventListener("resize", apply); }
  [300, 1200, 3000].forEach(t => setTimeout(apply, t));
  /* SVG gear */
  try { const b = document.getElementById("setBtn"); if (b && !b.querySelector("svg")) b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'; } catch (e) {}
  /* Settings footer: real build number and the screen-fit toggle */
  async function version() { try { const ks = (await caches.keys()).map(k => /^mindly-v(\d+)$/.exec(k)).filter(Boolean).map(x => +x[1]); return ks.length ? "v" + Math.max.apply(null, ks) : ""; } catch (e) { return ""; } }
  const S2 = (en, ar) => (typeof S === "function" ? S(en, ar) : en);
  async function decorate(sheet) {
    if (sheet.getAttribute("data-sf")) return;
    const d = [...sheet.querySelectorAll(".m")].find(x => /^Build v\d+/.test(x.textContent || "")); if (!d) return;
    sheet.setAttribute("data-sf", "1");
    const v = await version(); if (v) d.textContent = d.textContent.replace(/^Build v\d+/, "Build " + v);
    const row = document.createElement("div"); row.className = "sf-row";
    const b = document.createElement("button"); b.className = "btn";
    const label = () => S2("Screen fit fix: ", "ضبط حجم الشاشة: ") + (off() ? S2("off", "مطفي") : S2("on", "شغال")) + (measure().ok ? "" : S2(" (not needed here)", " (مش محتاجه هنا)"));
    b.textContent = label();
    b.onclick = () => { try { if (off()) localStorage.removeItem(KEY); else localStorage.setItem(KEY, "1"); } catch (e) {} apply(); b.textContent = label(); };
    row.appendChild(b); d.after(row);
  }
  new MutationObserver(() => { document.querySelectorAll(".sheet:not([data-sf])").forEach(s => { decorate(s); }); }).observe(document.body, { childList: true, subtree: true });
  window.MindlySF = { measure, apply };
})();
