// 通知を受け取るための小さなプログラム（サービスワーカー）
// ページの読み込みやデータには手を出さない。通知の表示とタップだけを担当する。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const url = typeof d.url === "string" && d.url.startsWith(self.registration.scope) ? d.url : self.registration.scope;
  e.waitUntil(self.registration.showNotification(String(d.title || "トレジャーカードマップ").slice(0, 60), {
    body: String(d.body || "").slice(0, 160),
    icon: "icons/icon-192.png",
    badge: "icons/favicon-48.png",
    tag: String(d.tag || "stock").slice(0, 60),
    data: { url },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) if (c.url.startsWith(self.registration.scope) && "focus" in c) { await c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  })());
});
