const lab = document.querySelector("[data-koan]");
if (lab) {
  const koan = JSON.parse(lab.dataset.koan);
  const source = lab.querySelector("textarea");
  const status = lab.querySelector("[data-status]");
  const checks = [...lab.querySelectorAll(".koan-tests li")];
  const storageKey = `hara-koan:${koan.id}:v${koan.version}`;
  source.value = localStorage.getItem(storageKey) ?? koan.starter;
  source.addEventListener("input", () => localStorage.setItem(storageKey, source.value));
  lab.querySelector("[data-reset]").addEventListener("click", () => { source.value = koan.starter; localStorage.removeItem(storageKey); });

  let sessionPromise;
  async function session() {
    if (!sessionPromise) sessionPromise = import("/docs-assets/javascripts/kernel.js")
      .then(async ({ createDocsKernel }) => {
        status.textContent = "Loading the capability-free Hara kernel…";
        const manifest = await fetch("/runtime/kernel-manifest.json").then((response) => response.json());
        const kernel = await createDocsKernel({
          wasmUrl: manifest.variants.core.url, workerUrl: "/runtime/hta-worker.js", manifest,
          resources: {}, fetchAsset: fetch,
        });
        return kernel.createSession(`koan-${koan.id}`);
      });
    return sessionPromise;
  }

  async function revealPeers() {
    const response = await fetch(`/api/koans/${koan.id}/solutions`);
    if (!response.ok) return;
    const body = await response.json();
    const panel = document.querySelector("[data-peers]");
    const list = panel.querySelector("[data-peer-list]");
    list.replaceChildren(...body.solutions.map((solution) => {
      const article = document.createElement("article");
      const heading = document.createElement("h3");
      heading.textContent = solution.display_name || `@${solution.github_login}`;
      const pre = document.createElement("pre"); const code = document.createElement("code");
      code.textContent = solution.solution_source; pre.append(code); article.append(heading, pre); return article;
    }));
    panel.hidden = false;
  }

  lab.querySelector("[data-run]").addEventListener("click", async () => {
    const candidate = source.value.trim();
    if (!candidate) { status.textContent = "Write an expression first."; return; }
    try {
      const active = await session();
      let passed = true;
      for (let index = 0; index < koan.tests.length; index += 1) {
        const expression = koan.tests[index].replaceAll("__", `(${candidate})`);
        const result = await active.evalRaw(expression);
        const ok = result === true;
        checks[index].classList.toggle("is-passed", ok);
        checks[index].querySelector("span").textContent = ok ? "passed" : "not yet";
        passed &&= ok;
      }
      if (!passed) { status.textContent = "Not yet. Nothing was sent or stored."; return; }
      const solved = new Set(JSON.parse(localStorage.getItem("hara-koans:solved") || "[]"));
      solved.add(koan.id); localStorage.setItem("hara-koans:solved", JSON.stringify([...solved]));
      status.textContent = "Passed in this browser. Saving if you have enabled a World session…";
      const response = await fetch(`/api/koans/${koan.id}/completion`, {
        method: "POST", headers: { "content-type": "application/json", "x-hara-request": "koan-completion" },
        body: JSON.stringify({ koanId: koan.id, version: koan.version, source: candidate, passed: true }),
      });
      status.textContent = response.ok ? "Passed and saved to your World account." : "Passed locally. Sign in to sync and compare solutions.";
      if (response.ok) revealPeers();
    } catch (error) { status.textContent = `Could not run this koan: ${error.message}`; }
  });
  if (new Set(JSON.parse(localStorage.getItem("hara-koans:solved") || "[]")).has(koan.id)) revealPeers().catch(() => {});
}
