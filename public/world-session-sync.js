(() => {
  "use strict";

  let clearing = false;
  addEventListener("hara:identity-change", async (event) => {
    if (event.detail?.authenticated !== false || clearing) return;
    clearing = true;
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "X-Hara-Request": "central-sign-out" },
      });
      dispatchEvent(new CustomEvent("hara:world-session-change", {
        detail: { authenticated: false, profile: null },
      }));
    } catch {
      // The host-only World session expires independently if local logout is unavailable.
    } finally {
      clearing = false;
    }
  });
})();
