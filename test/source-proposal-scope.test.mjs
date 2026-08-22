import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validator = path.join(root, "scripts", "validate-source-pr-scope.mjs");
const branch = "source-registry/github-6685337/example-journal";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function registry(status = "proposed") {
  return {
    version: 1,
    sources: [{
      id: "example-journal",
      name: "Example Lisp Journal",
      homepage: "https://example.com/",
      feed: "https://example.com/feed.xml",
      status,
      syndication: "excerpt",
      permission: "owner",
      contact: "https://example.com/contact",
      topics: ["hara", "lisp"],
      relevance: "Publishes practical work on Hara and Lisp runtimes.",
      registrantGithubId: "6685337",
      registrantGithubLogin: "zcaudate",
      registeredAt: "2026-08-17",
      updatedAt: "2026-08-17",
    }],
  };
}

async function fixture(status = "proposed") {
  const directory = await mkdtemp(path.join(tmpdir(), "hara-learn-source-scope-"));
  await mkdir(path.join(directory, "registry"), { recursive: true });
  git(directory, "init", "-b", "main");
  git(directory, "config", "user.name", "Hara Learn Test");
  git(directory, "config", "user.email", "test@hara-lang.org");
  await writeFile(path.join(directory, "registry", "sources.json"), `${JSON.stringify({ version: 1, sources: [] }, null, 2)}\n`);
  git(directory, "add", "registry/sources.json");
  git(directory, "commit", "-m", "base registry");
  const baseSha = git(directory, "rev-parse", "HEAD");
  git(directory, "update-ref", "refs/remotes/origin/main", baseSha);
  git(directory, "switch", "-c", branch);
  await writeFile(path.join(directory, "registry", "sources.json"), `${JSON.stringify(registry(status), null, 2)}\n`);
  git(directory, "add", "registry/sources.json");
  git(directory, "commit", "-m", "source proposal");
  const eventPath = path.join(directory, "event.json");
  await writeFile(eventPath, JSON.stringify({
    pull_request: {
      body: "<!-- hara-learn-source-proposal -->\n<!-- hara-learn-source:github:6685337:example-journal -->",
    },
  }));
  return { directory, eventPath };
}

function validate({ directory, eventPath }) {
  return execFileSync(process.execPath, [validator], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_HEAD_REF: branch,
      GITHUB_BASE_REF: "main",
      GITHUB_EVENT_PATH: eventPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("accepts one authenticated proposed source and its exact registry-only diff", async () => {
  const state = await fixture("proposed");
  try {
    assert.match(validate(state), /Verified authenticated source proposal example-journal for github:6685337/);
  } finally {
    await rm(state.directory, { recursive: true, force: true });
  }
});

test("rejects a new source proposal that tries to activate itself", async () => {
  const state = await fixture("active");
  try {
    assert.throws(() => validate(state), (error) => {
      assert.match(String(error.stderr), /new source must enter the registry with status proposed/i);
      return true;
    });
  } finally {
    await rm(state.directory, { recursive: true, force: true });
  }
});
