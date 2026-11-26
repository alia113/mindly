const V = "mindly-v63"; const CORE = ["./", "./index.html", "./app.js", "./mod-search.js", "./mod-timeline.js", "./mod-control.js", "./mod-brief.js", "./mod-weekly.js", "./mod-rel.js", "./mod-goals.js", "./mod-cal.js", "./mod-privacy.js", "./mod-theme.js", "./mod-onboard.js", "./mod-follow.js", "./mod-inbox.js", "./mod-activity.js", "./mod-widgets.js", "./mod-sync.js", "./mod-more.js", "./manifest.webmanifest"];
/* Only the static app shell is cached: no query strings, no API, no other paths. */
const isShell = u => { if (u.search) return false; const b = new URL(self.registration.scope).pathname; return u.pathname === b || u.pathname === b + "index.html" || u.pathname === b + "manifest.webmanifest" || (u.pathname.startsWith(b) && /^[\w-]+\.js$/.test(u.pathname.slice(b.length)) && u.pathname !== b + "sw.js"); };
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(V).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))).catch(() => {})); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  const nav = r.mode === "navigate", shell = isShell(u);
  if (!nav && !shell) return;   /* everything else goes straight to the network */
  e.respondWith(fetch(r, { cache: "no-store" }).then(res => { if (res.ok && shell) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r).then(m => m || caches.match("./index.html"))));
});
self.addEventListener("push", e => { let d = {}; try { d = e.data.json(); } catch (x) { d = { title: "Mindly", body: e.data ? e.data.text() : "" }; } e.waitUntil(self.registration.showNotification(d.title || "Mindly", { body: String(d.body || "").slice(0, 200), tag: d.tag || "mindly", data: { url: d.url || "./index.html" } })); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  let target; try { target = new URL((e.notification.data && e.notification.data.url) || "./index.html", self.registration.scope); } catch (x) { target = null; }
  if (!target || target.origin !== location.origin) target = new URL("./index.html", self.registration.scope);
  const norm = h => h.split("#")[0].replace(/index\.html$/, "");
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(async cs => {
    const c = cs[0];
    if (c) { try { await c.focus(); if (c.navigate && norm(c.url) !== norm(target.href)) await c.navigate(target.href); return; } catch (x) {} }
    return clients.openWindow(target.href);
  }));
});
