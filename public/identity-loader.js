(() => {
  "use strict";

  if (document.querySelector("script[data-hara-identity-client]")) return;

  const configured = document.querySelector('meta[name="hara-identity-origin"]')?.content?.trim();
  let identityOrigin = "";
  if (configured) {
    try { identityOrigin = new URL(configured, location.href).origin; }
    catch {}
  }

  if (!identityOrigin) {
    const testing = location.hostname === "world.testing.hara-lang.org"
      || location.hostname.endsWith(".testing.hara-lang.org");
    identityOrigin = testing
      ? "https://id.testing.hara-lang.org"
      : "https://id.hara-lang.org";
  }

  const sync = document.createElement("script");
  sync.src = "/world-session-sync.js";
  sync.async = false;
  sync.dataset.haraWorldSessionSync = "";
  document.head.append(sync);

  const client = document.createElement("script");
  client.src = `${identityOrigin}/identity-client.js`;
  client.async = false;
  client.dataset.haraIdentityClient = "";
  document.head.append(client);
})();
