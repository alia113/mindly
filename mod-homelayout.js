/* Mindly module: Home (Today) layout. Presentation only, no data is read or written.
   Order: greeting, search, quick actions, shortcuts under a collapsed "More", then the existing content.
   Earlier modules each prepend their own shortcut button above the greeting. This module moves those buttons into "More" (the click handlers are delegated, so they keep working).
   It does not touch the nav bar or the voice code. The quick action "Tell Mindly" only presses the same nav voice button the user already has.
   If anything fails, the original Home is shown unchanged. Disable by setting localStorage "mindly.homelayout.off" = "1". */
(function () {
  "use strict";
  if (window.MindlyHomeLayout) return;
  const off = () => { try { return localStorage.getItem("mindly.homelayout.off") === "1"; } catch (e) { return false; } };
  const st = document.createElement("style"); st.id = "mindly-homelayout";
  st.textContent =
    ".hl-search{display:flex;align-items:center;gap:10px;width:100%;min-height:48px;text-align:start;color:var(--mut);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:0 14px;margin:0 0 10px;font-size:15px}" +
    ".hl-q{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}.hl-q .btn{min-height:44px}" +
    "details.hl-more{margin:0 0 12px}details.hl-more>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--tx);font-size:14px}" +
    "details.hl-more>summary::-webkit-details-marker{display:none}details.hl-more>summary::after{content:'▾';color:var(--mut)}details.hl-more[open]>summary::after{content:'▴'}" +
    "details.hl-more .hl-grid{display:flex;flex-wrap:wrap;gap:8px;padding:10px 2px 2px}details.hl-more .hl-grid .btn{min-height:44px}";
  document.head.appendChild(st);
  const press = id => { const b = document.getElementById(id); if (b) b.click(); };
  document.addEventListener("click", e => {
    const t = e.target && e.target.closest ? e.target.closest("[data-hl]") : null; if (!t) return;
    e.preventDefault(); const k = t.getAttribute("data-hl");
    if (k === "search") press("srchBtn"); else if (k === "voice") press("openVoice"); else if (k === "add") press("qcBtn");
  });
  const MOVE = ["data-wprev", "data-alarm", "data-activity", "data-inbox", "data-follow", "data-theme-t", "data-cal", "data-goals", "data-weekly", "data-brief"];
  function layout(html) {
    const tpl = document.createElement("template"); tpl.innerHTML = html; const root = tpl.content;
    const sub = root.querySelector("p.sub"); if (!sub) return html;
    const btns = [];
    MOVE.forEach(a => { [...root.children].filter(d => d.classList && d.classList.contains("acts")).forEach(d => { const b = d.firstElementChild; if (b && b.hasAttribute(a)) { btns.push(b); d.remove(); } }); });
    if (btns.length < 3) return html;
    const strip = [...root.children].find(c => c.firstElementChild && c.firstElementChild.hasAttribute && c.firstElementChild.hasAttribute("data-wg"));
    if (strip) strip.remove();
    const S2 = (en, ar) => (typeof S === "function" ? S(en, ar) : en);
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<button class="hl-search" data-hl="search" aria-label="' + S2("Search", "بحث") + '"><span aria-hidden="true">🔍︎</span><span>' + S2("Search everything", "ابحث في كل شي") + "</span></button>" +
      '<div class="hl-q"><button class="btn p" data-hl="voice">' + S2("Tell Mindly", "احكي لـ Mindly") + '</button><button class="btn" data-hl="add">＋ ' + S2("Quick capture", "تسجيل سريع") + "</button></div>" +
      '<details class="hl-more"><summary>' + S2("More", "المزيد") + '</summary><div class="hl-grid"></div></details>';
    const grid = wrap.querySelector(".hl-grid"); btns.forEach(b => grid.appendChild(b));
    const frag = document.createDocumentFragment(); while (wrap.firstChild) frag.appendChild(wrap.firstChild);
    if (strip) frag.appendChild(strip);
    sub.after(frag);
    const o = document.createElement("div"); o.appendChild(root); return o.innerHTML;
  }
  if (typeof vHome === "function") { const _vh = vHome; vHome = function () { const h = _vh(); if (off()) return h; try { return layout(h); } catch (e) { return h; } }; }
  /* The app draws Home once before this module loads, so redraw once (Home only, not while voice is active). */
  setTimeout(() => { try { if (!off() && typeof view !== "undefined" && view === "home" && !(window.V && window.V.active) && typeof render === "function" && !document.querySelector("details.hl-more")) render(); } catch (e) {} }, 0);
  window.MindlyHomeLayout = { layout };
})();
