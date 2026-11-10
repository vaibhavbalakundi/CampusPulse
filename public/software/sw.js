/* Only these public, account-independent resources may enter Cache Storage. */
const CACHE_PREFIX = "campuspulse-public-";
const CACHE_NAME = CACHE_PREFIX + "20261109-security-hardening";
const PUBLIC_PATHS = ["/software/offline.html", "/software/offline.css", "/software/icons/icon-192.png", "/software/icons/icon-512.png", "/software/icons/maskable-512.png"];
const SAFE_NAVIGATIONS = new Set(["/software/", "/software/install/", "/software/help/"]);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const path of PUBLIC_PATHS) {
      const response = await fetch(new Request(path, { cache: "no-store", credentials: "same-origin", redirect: "error" }));
      if (!response.ok) throw new Error("Public offline resource unavailable");
      if (path.endsWith("offline.html") && !(await response.clone().text()).includes("data-campuspulse-offline")) throw new Error("Unexpected offline page");
      await cache.put(path, response);
    }
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type !== "ACTIVATE_UPDATE") return;
  // Pages post this from the update banner; accept same-origin clients without blocking on source shape.
  const sourceUrl = event.source && "url" in event.source ? String(event.source.url || "") : "";
  if (sourceUrl) {
    try { if (new URL(sourceUrl).origin !== self.location.origin) return; } catch { return; }
  }
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("notificationclick", event => {
  const data = event.notification.data || {};
  const action = event.action;
  event.notification.close();

  // Status actions never carry session secrets. Apply through the signed-in app window.
  if (data.kind === "status" && ["available", "busy", "away"].includes(action)) {
    event.waitUntil((async () => {
      const target = new URL("/software/", self.location.origin);
      target.searchParams.set("statusAction", action);
      if (data.nudgeId) target.searchParams.set("nudge", data.nudgeId);
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = open.find(client => client.url.startsWith(new URL("/software/", self.location.origin).href));
      if (existing) {
        existing.postMessage({ type: "APPLY_STATUS_ACTION", status: action, nudgeId: data.nudgeId || null });
        return existing.focus();
      }
      return self.clients.openWindow(target.href);
    })());
    return;
  }

  const target = new URL(typeof data.url === "string" ? data.url : "/software/", self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = open.find(client => client.url.startsWith(new URL("/software/", self.location.origin).href));
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search || request.headers.has("Authorization")) return;
  if (PUBLIC_PATHS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
    return;
  }
  if (request.mode === "navigate" && SAFE_NAVIGATIONS.has(url.pathname)) {
    // Never cache app HTML, API calls, sessions, recovery URLs, messages or audio.
    event.respondWith(fetch(request).catch(async () => {
      const response = await (await caches.open(CACHE_NAME)).match("/software/offline.html");
      return response || new Response("Connect to the internet to open CampusPulse.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }));
  }
});
