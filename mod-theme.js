/* Mindly module: design tokens + light theme (Phase 1 kit / Phase 5 personalization). Dark stays the default and is unchanged.
   Light theme is opt-in (DB.settings.theme = "light"), applied by overriding the existing CSS variables. */
(function () {
  "use strict";
  if (window.MindlyTheme) return;
  const st = document.createElement("style"); st.id = "mindly-theme";
  st.textContent = ":root{--r-sm:10px;--r-md:14px;--r-lg:20px;--sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px}" +
    "html[data-theme=light]{--bg:#f4f5f7;--card:#ffffff;--card2:#eceef2;--line:#d8dbe1;--tx:#15161a;--mut:#5f6368;--acc:#1a5fd0;--pink:#c2188f;--ok:#0b7a52;--warn:#b45309;color-scheme:light}" +
    "html[data-theme=light] .sheet,html[data-theme=light] details.sgrp{border-color:rgba(0,0,0,.12)!important}" +
    "html[data-theme=light] .btn.p{background:#15161a;color:#fff;border-color:#15161a}" +
    "html[data-theme=light] nav.bar{background:rgba(28,28,34,.78)!important}" +
    "html[data-theme=light] [style*='#cfd0d4']{color:#4a4d54!important}" +
    "html[data-theme=light] .toast,html[data-theme=light] .bub.u{background:#15161a;color:#fff}" +
    "html[data-theme=light] .lang{color:#444;border-color:rgba(0,0,0,.2)}" +
    /* the module shortcut buttons share one wrapping row instead of one row each */
    "#main>.acts:has(>[data-brief],>[data-weekly],>[data-goals],>[data-cal],>[data-theme-t],>[data-rel],>[data-mcc],>[data-mtl],>[data-priv]){display:inline-flex;margin:0 6px 8px 0!important}";
  document.head.appendChild(st);
  function apply() {
    const light = DB.settings && DB.settings.theme === "light";
    document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", light ? "#f4f5f7" : "#050505");
  }
  function toggle() { DB.settings.theme = DB.settings.theme === "light" ? "dark" : "light"; save(); apply(); try { render(); } catch (e) {} }
  apply();
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { return '<div class="acts" style="margin-bottom:8px"><button class="btn" data-theme-t="1">' + (DB.settings.theme === "light" ? S("Dark theme", "الوضع الداكن") : S("Light theme", "الوضع الفاتح")) + "</button></div>" + _vh(); }; }
  document.addEventListener("click", e => { const b = e.target.closest && e.target.closest("[data-theme-t]"); if (b) { e.preventDefault(); toggle(); } });
  try { render(); } catch (e) {}
  window.MindlyTheme = { apply, toggle };
})();
