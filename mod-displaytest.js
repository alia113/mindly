/* Mindly module: dialog background match (Option A) and an opt-in Display test (Option B, steps 1 and 2). Layout diagnostics only, no data.
   A: while a dialog is open the page background behind it is the dialog colour, so a strip below the layout viewport on iPhone does not look like a light band under a dark sheet.
   B: Settings > Display test shows the numbers that matter and lets the user try candidate heights for #app for 20 seconds. Nothing is saved (no localStorage), reload or Reset or Close undoes it, and the nav bar and the header are never touched. */
(function () {
  "use strict";
  if (window.MindlyDisplayTest) return;
  const S2 = (en, ar) => (typeof S === "function" ? S(en, ar) : en);
  const st = document.createElement("style"); st.id = "mindly-displaytest";
  st.textContent =
    "html:has(.dlg){background:#121316!important}" +
    "#dt-panel{position:fixed;z-index:200;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 8px);max-width:520px;margin:0 auto;background:#121316;color:#f4f5f7;border:1px solid rgba(255,255,255,.2);border-radius:18px;padding:12px;font-size:13px;box-shadow:0 12px 40px rgba(0,0,0,.6);max-height:70vh;overflow:auto}" +
    "#dt-panel pre{white-space:pre-wrap;word-break:break-word;font:11px/1.45 ui-monospace,Menlo,monospace;margin:8px 0;color:#c9ccd3;direction:ltr;text-align:left}" +
    "#dt-panel .dt-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}#dt-panel .btn{min-height:44px;color:#f4f5f7;background:#24262a;border:1px solid #3a3d44}" +
    "#dt-panel .btn.p{background:#fff;color:#000}" +
    "html.dt-mark #app::after{content:'';position:absolute;left:0;right:0;bottom:0;height:10px;background:#ff2d2d;z-index:99;pointer-events:none}";
  document.head.appendChild(st);
  const VARIANTS = [
    ["100vh", "#app{bottom:auto!important;height:100vh!important}"],
    ["100lvh", "#app{bottom:auto!important;height:100lvh!important}"],
    ["100dvh", "#app{bottom:auto!important;height:100dvh!important}"],
    ["fill-available", "#app{bottom:auto!important;height:-webkit-fill-available!important}"],
    ["100% + top inset", "#app{bottom:auto!important;height:calc(100% + env(safe-area-inset-top,0px))!important}"]
  ];
  let vst = null, timer = null, cur = "none";
  const root = document.documentElement;
  function reset() { clearTimeout(timer); timer = null; if (vst) { vst.remove(); vst = null; } root.classList.remove("dt-mark"); cur = "none"; }
  function apply(i) {
    reset(); vst = document.createElement("style"); vst.id = "dt-variant"; vst.textContent = VARIANTS[i][1]; document.head.appendChild(vst);
    root.classList.add("dt-mark"); cur = VARIANTS[i][0]; timer = setTimeout(() => { reset(); refresh(); }, 20000);
  }
  function probeH(css) { const e = document.createElement("div"); e.style.cssText = "position:fixed;left:0;top:0;width:1px;visibility:hidden;pointer-events:none;" + css; document.body.appendChild(e); const h = e.getBoundingClientRect().height; e.remove(); return Math.round(h); }
  function readout() {
    const vv = window.visualViewport, app = document.getElementById("app"), nav = document.getElementById("nav");
    const r = app ? Math.round(app.getBoundingClientRect().bottom) : "-", nb = nav ? Math.round(nav.getBoundingClientRect().bottom) : "-";
    const u = [["vh", "100vh"], ["lvh", "100lvh"], ["svh", "100svh"], ["dvh", "100dvh"]].map(x => x[0] + " " + probeH("height:" + x[1])).join(" · ");
    return "variant: " + cur + "\ninner " + innerWidth + "x" + innerHeight + " · vv " + (vv ? Math.round(vv.height) + " (top " + Math.round(vv.offsetTop) + ")" : "-") + " · client " + root.clientHeight + "\n" + u + "\nscreen " + screen.width + "x" + screen.height + " · avail " + screen.availHeight + " · outer " + outerHeight + "\ninset top " + probeH("height:0;padding-top:env(safe-area-inset-top,0px)") + " bottom " + probeH("height:0;padding-bottom:env(safe-area-inset-bottom,0px)") + "\napp bottom " + r + " · nav bottom " + nb + " · standalone " + ((navigator.standalone || (matchMedia && matchMedia("(display-mode: standalone)").matches)) ? 1 : 0);
  }
  let pre = null;
  function refresh() { if (pre) pre.textContent = readout(); }
  function close() { reset(); const p = document.getElementById("dt-panel"); if (p) p.remove(); pre = null; }
  function open() {
    close(); const x = [...document.querySelectorAll(".dlg .sheet button")].find(b => (b.textContent || "").trim() === "✕"); if (x) x.click();
    const p = document.createElement("div"); p.id = "dt-panel";
    p.innerHTML = '<b>' + S2("Display test", "فحص الشاشة") + '</b><div class="m" style="margin-top:4px">' + S2("Tap a variant. A red bar shows where the page ends. It resets itself after 20 seconds. Then take a screenshot.", "اضغط على أي خيار. الشريط الأحمر بيبين فين الصفحة بتنتهي. بيرجع لوحده بعد 20 ثانية. بعدها خد سكرين شوت.") + '</div><pre></pre><div class="dt-row"></div><div class="dt-row"><button class="btn" data-dt="reset">' + S2("Reset", "رجوع") + '</button><button class="btn p" data-dt="close">' + S2("Close", "إغلاق") + '</button></div>';
    const row = p.querySelectorAll(".dt-row")[0];
    VARIANTS.forEach((v, i) => { const b = document.createElement("button"); b.className = "btn"; b.textContent = v[0]; b.setAttribute("data-dt", String(i)); row.appendChild(b); });
    document.body.appendChild(p); pre = p.querySelector("pre"); refresh();
    p.addEventListener("click", e => { const b = e.target.closest("[data-dt]"); if (!b) return; const k = b.getAttribute("data-dt"); if (k === "close") close(); else if (k === "reset") { reset(); refresh(); } else { apply(+k); setTimeout(refresh, 400); } });
  }
  function decorate(sheet) {
    if (sheet.getAttribute("data-dt")) return;
    const d = [...sheet.querySelectorAll(".m")].find(x => /^Build v\d+/.test(x.textContent || "")); if (!d) return;
    sheet.setAttribute("data-dt", "1");
    const row = document.createElement("div"); row.style.marginTop = "8px";
    const b = document.createElement("button"); b.className = "btn"; b.style.minHeight = "44px"; b.textContent = S2("Display test", "فحص الشاشة"); b.onclick = open;
    row.appendChild(b); d.after(row);
  }
  new MutationObserver(() => { document.querySelectorAll(".sheet:not([data-dt])").forEach(decorate); }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pagehide", reset);
  window.MindlyDisplayTest = { open, close, readout };
})();
