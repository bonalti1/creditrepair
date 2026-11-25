/* Credalti staff phone alerts (docs/CONTROL.md, "Phone alerts").
 *
 * Registered only from /equipo/alertas, scoped to /equipo/, and only when a
 * member turns phone alerts on. A push carries no payload: on a push this
 * worker asks the app for the member's new alerts, with the member's own
 * session, and shows them. Nothing about a lead or a client goes through the
 * push service. It caches nothing and intercepts no request. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let alerts = [];
      try {
        const res = await fetch("/api/staff/alerts?pending=1", { credentials: "same-origin", cache: "no-store" });
        if (res.ok) alerts = (await res.json()).alerts || [];
      } catch (_) {
        alerts = [];
      }
      if (alerts.length === 0) alerts = [{ id: "credalti", title: "Credalti", body: "Something in the console needs you.", url: "/equipo/control" }];
      await Promise.all(
        alerts.slice(0, 3).map((alert) =>
          self.registration.showNotification(alert.title, {
            body: alert.body || "",
            tag: alert.id,
            data: { url: typeof alert.url === "string" && alert.url.startsWith("/equipo") ? alert.url : "/equipo/control" },
            icon: "/brand/icons/icon-192.png",
          }),
        ),
      );
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/equipo/control";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (client.url.includes("/equipo") && "focus" in client) {
          await client.navigate(url).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
