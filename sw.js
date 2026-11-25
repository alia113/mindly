const V = "mindly-v27"; const CORE = ["./", "./index.html", "./manifest.webmanifest"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(V).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))).catch(() => {})); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("fetch", e => { const r = e.request; if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r, { cache: "no-store" }).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r).then(m => m || caches.match("./index.html")))); });
self.addEventListener("push", e => { let d = {}; try { d = e.data.json(); } catch (x) { d = { title: "Mindly", body: e.data ? e.data.text() : "" }; } e.waitUntil(self.registration.showNotification(d.title || "Mindly", { body: d.body || "", tag: d.tag || "mindly", data: { url: d.url || "./index.html" } })); });
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(clients.matchAll({ type: "window" }).then(cs => { for (const c of cs) { if ("focus" in c) return c.focus(); } return clients.openWindow(e.notification.data.url || "./index.html"); })); });
