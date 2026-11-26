/* Mindly module: Settings as a full-screen page that follows the theme. Presentation only, no data and no Settings logic change.
   Only the Settings sheet is affected (found by its footer line "Build v..."); every other dialog is unchanged.
   The sheet's own close button still does the closing, so back/close behaviour is the app's own.
   Kill switch: localStorage "mindly.settingspage.off" = "1". */
(function () {
  "use strict";
  if (window.MindlySettingsPage) return;
  const off = () => { try { return localStorage.getItem("mindly.settingspage.off") === "1"; } catch (e) { return false; } };
  const S2 = (en, ar) => (typeof S === "function" ? S(en, ar) : en);
  const st = document.createElement("style"); st.id = "mindly-settingspage";
  st.textContent =
    "html:has(.dlg.sp-full){background:var(--bg)!important}" +
    ".dlg.sp-full{background:var(--bg);align-items:stretch}" +
    ".dlg.sp-full .sheet{max-width:none;width:100%;height:100%;max-height:none;border-radius:0;border:0;margin:0;background:var(--bg);color:var(--tx);padding:0 16px calc(24px + env(safe-area-inset-bottom,0px));box-sizing:border-box}" +
    ".dlg.sp-full .shead{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;margin:0 -16px 8px;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 8px;background:var(--bg);border-radius:0;pointer-events:auto;border-bottom:1px solid var(--line)}" +
    ".dlg.sp-full .shead .sx{display:none}" +
    ".dlg.sp-full .sp-back{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border-radius:99px;background:var(--card2);border:1px solid var(--line);color:var(--tx);font-size:15px}" +
    ".dlg.sp-full .sp-title{font-weight:600;font-size:17px;color:var(--tx)}" +
    ".dlg.sp-full details.sgrp{border-color:var(--line)!important;background:var(--card)}" +
    ".dlg.sp-full details.sgrp>summary{color:var(--tx)}" +
    ".dlg.sp-full h3,.dlg.sp-full .t{color:var(--tx)}.dlg.sp-full .m{color:var(--mut)}" +
    ".dlg.sp-full .card{background:var(--card);border-color:var(--line)}" +
    ".dlg.sp-full input[type=checkbox]{width:22px;height:22px;min-height:0;flex:none}" +
    ".dlg.sp-full input,.dlg.sp-full select,.dlg.sp-full textarea{color:var(--tx)}";
  document.head.appendChild(st);
  function decorate(dlg) {
    if (off() || dlg.classList.contains("sp-full")) return;
    const sheet = dlg.querySelector(".sheet"); if (!sheet) return;
    if (![...sheet.querySelectorAll(".m")].some(x => /^Build v\d+/.test(x.textContent || ""))) return;
    const head = sheet.querySelector(".shead"), x = sheet.querySelector(".sx"); if (!head || !x) return;
    dlg.classList.add("sp-full");
    const back = document.createElement("button"); back.className = "sp-back"; back.type = "button";
    back.textContent = S2("‹ Back", "رجوع ›"); back.onclick = () => x.click();
    const title = document.createElement("span"); title.className = "sp-title"; title.textContent = S2("Settings", "الإعدادات");
    head.insertBefore(title, head.firstChild); head.insertBefore(back, head.firstChild);
    try { sheet.scrollTop = 0; } catch (e) {}
  }
  new MutationObserver(() => { document.querySelectorAll(".dlg:not(.sp-full)").forEach(decorate); }).observe(document.body, { childList: true, subtree: true });
  window.MindlySettingsPage = { decorate };
})();
