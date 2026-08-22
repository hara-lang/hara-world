(() => {
  "use strict";

  let clearing = false;
  addEventListener("hara:identity-change", async (event) => {
    if (clearing) return;
    const central = event.detail?.profile || event.detail?.user;
    const centralId = event.detail?.authenticated && central?.id ? String(central.id) : null;
    clearing = true;
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const local = response.ok ? await response.json() : null;
      const localId = local?.authenticated && local?.profile?.id ? String(local.profile.id) : null;
      if (!localId || localId === centralId) return;

      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "X-Hara-Request": "central-sign-out" },
      });
      dispatchEvent(new CustomEvent("hara:learn-session-change", {
        detail: { authenticated: false, profile: null },
      }));
    } catch {
      // The host-only Learn session expires independently if synchronization is unavailable.
    } finally {
      clearing = false;
    }
  });
})();
