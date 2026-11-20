/** Offline attacks for task 4.16. Each case runs the real shell entry point.
 * The HTTP fake uses an ephemeral loopback port. No case reads a host store.
 * Skipped cases name defects that the PM cap leaves nonblocking. */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");
const CACHE = process.env.XDG_CACHE_HOME || "/home/daniebo/.cache/opencode";
const roots = new Set<string>();
const servers = new Set<Server>();
const children = new Set<ChildProcess>();
const timers = new Set<ReturnType<typeof setTimeout>>();
const REVIEW = "opencode-go/hy4-flash-free#high";
const JUDGE = "opencode-go/muse-spark-1.3-contributor#high";
const SET = "mg-synthetic-p4e";
const FINDING = "d-01#C0a1b2c3d4e5f";
const KEY = "sk-" + "synthetic_adversarial_credential_0123456789";
type Kind = "review" | "judge";
type Message = Record<string, any>;
type Request = { method: string; path: string; body: any; at: number };
type Scenario = {
  messages?: Message[];
  location?: "foreign" | "symlink";
  malformed?: "create" | "messages";
  redirect?: "create" | "prompt" | "messages";
  redirectTarget?: string;
  delayMs?: number;
  endless?: boolean;
  padding?: number;
  base?: (base: string) => string;
  timeout?: number;
};

afterEach(async () => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  for (const child of children) {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* The group already exited. */ }
  }
  children.clear();
  await Promise.all([...servers].map((server) => new Promise<void>((done) => {
    server.closeAllConnections();
    server.close(() => done());
  })));
  servers.clear();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

function answer(kind: Kind): string {
  return "```json\n" + JSON.stringify(kind === "review" ? { findings: [] } : { [FINDING]: "false-claim" }) + "\n```";
}

function assistant(text: string, extra: Message = {}): Message {
  return {
    id: "msg_synthetic_answer", sessionID: "ses_p4e", type: "assistant",
    content: [{ type: "text", text }],
    time: { created: Date.now(), completed: Date.now() }, finish: "stop",
    tokens: { input: 3, output: 5, reasoning: 7, cache: { read: 11, write: 13 } },
    ...extra,
  };
}

function allFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? allFiles(path) : entry.isFile() ? [path] : [];
  });
}

function digest(root: string): string {
  const hash = createHash("sha256");
  for (const file of allFiles(root).sort()) hash.update(file.slice(root.length)).update(readFileSync(file));
  return hash.digest("hex");
}

async function fixture(kind: Kind, scenario: Scenario = {}) {
  mkdirSync(CACHE, { recursive: true });
  const root = mkdtempSync(join(CACHE, "mg-p4e-"));
  roots.add(root);
  const repo = join(root, "repo");
  const guide = join(repo, "harness/model-guide");
  const privateDir = join(root, "private");
  const setDir = join(privateDir, "sets", SET);
  const job = join(root, "job");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const bin = join(root, "bin");
  for (const dir of [guide, privateDir, job, home, tmp, bin, join(repo, "node_modules/.bin"), join(repo, "docs")]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const file of ["review-run.sh", "judge-run.sh", "quota.ts", "provider-credential.sh", "review-prompt.md"]) {
    copyFileSync(join(HARNESS, "model-guide", file), join(guide, file));
  }
  for (const file of ["opencode-host.sh", "opencode-credential.sh"]) {
    copyFileSync(join(HARNESS, file), join(repo, "harness", file));
  }
  symlinkSync(join(HARNESS, "node_modules/.bin/tsx"), join(repo, "node_modules/.bin/tsx"));
  // An accidental binary call fails and leaves proof. The test never runs a host CLI.
  const callLog = join(root, "binary-calls.txt");
  const fake = join(bin, "fake-opencode");
  writeFileSync(fake, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$P4E_BINARY_LOG"\nexit 93\n', { mode: 0o755 });
  symlinkSync(fake, join(bin, "opencode"));
  symlinkSync(fake, join(bin, "openchamber"));
  // A redirect regression fails before any packet can leave loopback.
  // Other requests still use the real curl binary and the real HTTP fake.
  const redirectLog = join(root, "redirect-flags.txt");
  writeFileSync(join(bin, "curl"), '#!/bin/sh\nfor arg do\n  case "$arg" in -L|--location|--location-trusted) printf "%s\\n" "$arg" >> "$P4E_REDIRECT_LOG"; exit 94;; esac\ndone\nexec /usr/bin/curl "$@"\n', { mode: 0o755 });
  const route = kind === "review" ? REVIEW : JUDGE;
  const rows = [{ route, kind: "plan", quota_provider: "opencode-go", quota_source: "opencode-go" }];
  writeFileSync(join(guide, "routes.json"), JSON.stringify(rows));
  writeFileSync(join(guide, "judges.json"), JSON.stringify(rows));
  writeFileSync(join(job, "opencode.json"), JSON.stringify({ permission: Object.fromEntries(
    ["read", "edit", "bash", "webfetch", "websearch", "question", "subagent", "skill"].map((tool) => [tool, "deny"]),
  ) }));
  writeFileSync(join(repo, "docs/index.html"), "<!doctype html><title>Synthetic p4e</title>\n");
  for (const dir of ["diffs", "src", "messages", "adjudication"]) mkdirSync(join(setDir, dir), { recursive: true });
  for (const dir of ["diffs", "src"]) writeFileSync(join(setDir, dir, "d-01.diff"), "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\nL1 +const x = 1;\n");
  writeFileSync(join(setDir, "messages/d-01.txt"), "Synthetic change\n");
  writeFileSync(join(setDir, "adjudication/queue.json"), JSON.stringify({ set_id: SET, groups: [{
    id: "d-01#G1", diff_id: "d-01", file: "a.ts", window: [1, 3],
    items: [{ id: FINDING, line: 1, claim: { class: "C3", severity: "major", title: "Synthetic claim", reason: "Synthetic reason" } }],
  }] }));
  const init = spawnSync("git", ["init", "-q", repo], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });
  expect(init.status).toBe(0);
  const requests: Request[] = [];
  const reply = (res: ServerResponse, doc: unknown) => {
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify(doc));
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let body: any = null;
      try { body = JSON.parse(raw); } catch { /* A GET has no body. */ }
      const path = req.url || "";
      requests.push({ method: req.method || "", path, body, at: Date.now() });
      if (path === "/api/quota/opencode-go") {
        reply(res, { usage: { windows: { "5h": { usedPercent: 10 }, weekly: { usedPercent: 10 } } } });
        return;
      }
      const stage = path === "/api/session" ? "create" : path.endsWith("/prompt") ? "prompt" : path.endsWith("/message") ? "messages" : "other";
      if (scenario.redirect === stage) {
        res.writeHead(307, { location: scenario.redirectTarget || "/api/session/ses_foreign?method=DELETE", allow: "DELETE", connection: "close" });
        res.end();
        return;
      }
      if (scenario.malformed === stage) { res.writeHead(200); res.end('{"broken":'); return; }
      if (stage === "create") {
        let directory = body?.location?.directory;
        if (scenario.location === "foreign") directory = join(root, "foreign");
        if (scenario.location === "symlink") {
          directory = join(root, "job-alias");
          if (!existsSync(directory)) symlinkSync(job, directory);
        }
        reply(res, { id: "ses_p4e", location: { directory } });
      } else if (stage === "prompt") reply(res, { messageID: "msg_synthetic_prompt" });
      else if (stage === "messages") {
        if (scenario.endless) {
          res.writeHead(200, { "content-type": "application/json", connection: "close" });
          res.write('{"data":[');
          const tick = () => {
            if (res.destroyed) return;
            res.write(" ".repeat(64 * 1024));
            const timer = setTimeout(() => { timers.delete(timer); tick(); }, 20);
            timers.add(timer);
          };
          tick();
          return;
        }
        const send = () => reply(res, { data: scenario.messages ?? [assistant(answer(kind))], cursor: {}, padding: "x".repeat(scenario.padding || 0) });
        if (scenario.delayMs) {
          const timer = setTimeout(() => { timers.delete(timer); if (!res.destroyed) send(); }, scenario.delayMs);
          timers.add(timer);
        } else send();
      } else { res.writeHead(404); res.end(); }
    });
  });
  servers.add(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The fake has no port.");
  const base = `http://127.0.0.1:${address.port}`;
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:${join(HARNESS, "node_modules/.bin")}:${process.env.PATH}`,
    HOME: home, TMPDIR: tmp, TZ: "UTC", LANG: "C", LC_ALL: "C",
    XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"), XDG_CACHE_HOME: join(home, "cache"), XDG_RUNTIME_DIR: join(home, "runtime"),
    BENCH_OPENCODE_BIN: fake, P4E_BINARY_LOG: callLog, P4E_REDIRECT_LOG: redirectLog, BENCH_OPENCODE_HOME: job,
    BENCH_SERVER_BASE: scenario.base ? scenario.base(base) : base, BENCH_QUOTA_BASE: base,
    MG_CALL_TIMEOUT_S: String(scenario.timeout || 15), MG_RUN_RETRY_WAIT_MS: "0",
  };
  const run = async () => {
    const before = digest(repo);
    const args = [join(guide, `${kind}-run.sh`), "--route", route, "--set", SET, "--private", privateDir];
    if (kind === "review") args.push("--date", "2026-11-20");
    if (kind === "judge") args.push("--judge", "a");
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string; elapsed: number }>((done, failed) => {
      const started = Date.now();
      const child = spawn("bash", args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      children.add(child);
      let stdout = "", stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => {
        try { process.kill(-child.pid!, "SIGKILL"); } catch { /* The child already exited. */ }
        failed(new Error("The runner exceeded the test timeout."));
      }, 30_000);
      child.once("error", (error) => { clearTimeout(timer); failed(error); });
      child.once("close", (status) => {
        clearTimeout(timer);
        children.delete(child);
        done({ status, stdout, stderr, elapsed: Date.now() - started });
      });
    });
    expect(digest(repo), "The runner changed its repository.").toBe(before);
    expect(existsSync(callLog) ? readFileSync(callLog, "utf8") : "", "The live path called a local binary.").toBe("");
    expect(existsSync(redirectLog) ? readFileSync(redirectLog, "utf8") : "", "The runner enabled redirects.").toBe("");
    expect(requests.filter((request) => request.method === "DELETE")).toEqual([]);
    return result;
  };
  const outputs = () => allFiles(privateDir).filter((file) => file.endsWith("/d-01.txt") && !file.includes("/messages/"));
  const verdictPath = join(setDir, "adjudication/judge-a.json");
  const published = () => kind === "review" ? outputs().map((file) => readFileSync(file, "utf8")) : existsSync(verdictPath) ? [readFileSync(verdictPath, "utf8")] : [];
  const complete = () => allFiles(privateDir).filter((file) => file.endsWith(".json")).some((file) => {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    return doc.state === "complete";
  });
  return { root, repo, privateDir, job, base, requests, run, outputs, published, complete };
}

describe.each<Kind>(["review", "judge"])("P4E %s live runner", (kind) => {
  it("accepts one native answer and stores its own token fields", async () => {
    const f = await fixture(kind);
    const result = await f.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.complete()).toBe(true);
    expect(f.published()).toHaveLength(1);
    if (kind === "review") expect(f.published()).toEqual([answer(kind)]);
    else expect(JSON.parse(f.published()[0])).toEqual({ [FINDING]: "false-claim" });
    const create = f.requests.filter((request) => request.path === "/api/session");
    expect(create).toHaveLength(1);
    expect(create[0].body.location.directory).toBe(f.job);
    expect(f.requests.map((request) => request.method + " " + request.path).filter((line) => !line.includes("/quota/"))).toEqual([
      "POST /api/session", "POST /api/session/ses_p4e/prompt", "GET /api/session/ses_p4e/message",
    ]);
    const records = allFiles(f.privateDir).filter((file) => file.endsWith(".json")).map((file) => JSON.parse(readFileSync(file, "utf8")));
    expect(records.find((doc) => doc.state === "complete")?.tokens).toEqual({ input: 3, output: 5, reasoning: 7, cache_read: 11, cache_write: 13, total: 39 });
  }, 40_000);

  it("keeps a concurrent second run behind the exclusive lock", async () => {
    const f = await fixture(kind, { delayMs: 1500 });
    const results = await Promise.all([f.run(), f.run()]);
    expect(results.map((result) => result.status).sort()).toEqual([0, 2]);
    const loser = results.find((result) => result.status === 2)!;
    expect(loser.stdout).toBe("");
    expect(loser.stderr).toMatch(new RegExp(`^${kind}-run: the lock for .+ is held\\n$`));
    expect(f.requests.filter((request) => request.path === "/api/session")).toHaveLength(1);
    expect(f.complete()).toBe(true);
    expect(f.published()).toHaveLength(1);
  }, 40_000);

  it.each(["foreign", "symlink"] as const)("refuses a returned %s location before sending a prompt", async (location) => {
    const f = await fixture(kind, { location });
    const result = await f.run();
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe(`${kind}-run: the session location is not the job root`);
    expect(f.requests.filter((request) => request.path.endsWith("/prompt"))).toEqual([]);
    expect(f.published()).toEqual([]);
  }, 40_000);

  it("refuses a missing bash deny before any HTTP request", async () => {
    const f = await fixture(kind);
    const path = join(f.job, "opencode.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    delete config.permission.bash;
    writeFileSync(path, JSON.stringify(config));
    const result = await f.run();
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe(`${kind}-run: the project config does not deny every tool: bash`);
    expect(f.requests.filter((request) => !request.path.includes("/quota/"))).toEqual([]);
    expect(f.published()).toEqual([]);
  }, 40_000);

  it.each(["create", "messages"] as const)("refuses malformed JSON at %s without a result", async (malformed) => {
    const f = await fixture(kind, { malformed });
    await f.run();
    expect(f.requests.some((request) => request.path === "/api/session")).toBe(true);
    expect(f.complete()).toBe(false);
    expect(f.published()).toEqual([]);
  }, 40_000);

  it.each(["create", "prompt", "messages"] as const)("does not follow a %s redirect or issue DELETE", async (redirect) => {
    const f = await fixture(kind, { redirect });
    await f.run();
    const suffix = redirect === "create" ? "/api/session" : redirect === "prompt" ? "/prompt" : "/message";
    expect(f.requests.some((request) => request.path.endsWith(suffix))).toBe(true);
    expect(f.requests.filter((request) => request.path.includes("ses_foreign"))).toEqual([]);
    expect(f.complete()).toBe(false);
    expect(f.published()).toEqual([]);
  }, 40_000);

  it("does not follow a redirect to a non-loopback host", async () => {
    const f = await fixture(kind, { redirect: "create", redirectTarget: "http://192.0.2.1:9/forbidden" });
    await f.run();
    expect(f.requests.some((request) => request.path === "/api/session")).toBe(true);
    expect(f.complete()).toBe(false);
    expect(f.published()).toEqual([]);
    expect(f.requests.filter((request) => !request.path.includes("/quota/")).every((request) => request.path === "/api/session")).toBe(true);
  }, 40_000);

  it.each(["[::1]", "localhost.evil", "127.0.0.1.nip.io", "localhost."])("refuses the base host %s before any HTTP request", async (host) => {
    const f = await fixture(kind, { base: (base) => base.replace("127.0.0.1", host) });
    const result = await f.run();
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe(`${kind}-run: BENCH_SERVER_BASE must be a loopback http URL`);
    expect(f.requests).toEqual([]);
  }, 40_000);

  it("normalizes an uppercase loopback origin", async () => {
    const f = await fixture(kind, { base: (base) => base.replace("http://127.0.0.1", "HTTP://LOCALHOST") });
    const result = await f.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.complete()).toBe(true);
  }, 40_000);

  it("refuses a base path before any HTTP request", async () => {
    const f = await fixture(kind, { base: (base) => base + "/other" });
    expect((await f.run()).status).toBe(2);
    expect(f.requests).toEqual([]);
  }, 40_000);

  it("does not forward a base query to the API", async () => {
    const f = await fixture(kind, { base: (base) => base + "/?method=DELETE" });
    expect((await f.run()).status).toBe(0);
    expect(f.requests.every((request) => !request.path.includes("?"))).toBe(true);
  }, 40_000);

  it("A7 refuses a credential shape beside filter words before storing text", async () => {
    const text = "Never publish this; do not keep it: " + KEY + "\n" + answer(kind);
    const f = await fixture(kind, { messages: [assistant(text)] });
    const result = await f.run();
    expect(result.stdout + result.stderr).not.toContain(KEY);
    expect(f.requests.some((request) => request.path.endsWith("/message"))).toBe(true);
    expect(f.complete()).toBe(false);
    expect(f.published()).toEqual([]);
    expect(allFiles(f.root).filter((file) => readFileSync(file, "utf8").includes(KEY))).toEqual([]);
  }, 40_000);

  it("joins text fragments before scanning the credential shape", async () => {
    const split = 12;
    const message = assistant(answer(kind));
    message.content = [{ type: "text", text: KEY.slice(0, split) }, { type: "text", text: KEY.slice(split) + answer(kind) }];
    const f = await fixture(kind, { messages: [message] });
    const result = await f.run();
    expect(result.stdout + result.stderr).not.toContain(KEY);
    expect(f.requests.some((request) => request.path.endsWith("/message"))).toBe(true);
    expect(f.complete()).toBe(false);
    expect(f.published()).toEqual([]);
    expect(allFiles(f.root).filter((file) => readFileSync(file, "utf8").includes(KEY))).toEqual([]);
  }, 40_000);

  it("waits on a newest partial instead of accepting an older final", async () => {
    const f = await fixture(kind, { timeout: 3, messages: [assistant("partial", { finish: undefined, time: { created: Date.now() } }), assistant(answer(kind))] });
    const result = await f.run();
    expect(result.status).toBe(2);
    expect(result.elapsed).toBeLessThan(10_000);
    expect(f.requests.some((request) => request.path.endsWith("/message"))).toBe(true);
    expect(f.published()).toEqual([]);
  }, 40_000);

  it("bounds a never-ending message response by the call deadline", async () => {
    const f = await fixture(kind, { endless: true, timeout: 3 });
    const result = await f.run();
    expect(result.elapsed).toBeLessThan(10_000);
    expect(f.requests.some((request) => request.path.endsWith("/message"))).toBe(true);
    expect(f.complete()).toBe(false);
    expect(f.published()).toEqual([]);
  }, 40_000);

  it("handles an 8 MiB page without truncating the selected answer", async () => {
    const f = await fixture(kind, { padding: 8 * 1024 * 1024 });
    expect((await f.run()).status).toBe(0);
    expect(f.complete()).toBe(true);
    expect(f.published()).toHaveLength(1);
    if (kind === "review") expect(f.published()).toEqual([answer(kind)]);
    else expect(JSON.parse(f.published()[0])).toEqual({ [FINDING]: "false-claim" });
  }, 40_000);

  it("rejects a message response that crosses the deadline", async () => {
    const f = await fixture(kind, { delayMs: 3500, timeout: 3 });
    const result = await f.run();
    expect(result.elapsed).toBeLessThan(10_000);
    expect(f.complete()).toBe(false);
    expect(f.requests.some((request) => request.path.endsWith("/message"))).toBe(true);
    expect(f.published()).toEqual([]);
  }, 40_000);

  // P4E-1 to P4E-3 failed in both real runners on 2bdf5cb. Red r7 enables
  // them so the Red gate fails until Green rejects the foreign session, the
  // stale answer, and the tool-calls step. The asserts stay unchanged.
  // P4E-2 binds freshness to time.created, a field of the native message.
  it("P4E-1 rejects a completed message of another session", async () => {
    const f = await fixture(kind, { messages: [assistant(answer(kind), { sessionID: "ses_foreign" })] });
    await f.run();
    expect(f.requests.some((request) => request.path.endsWith("/message"))).toBe(true);
    expect(f.complete(), "A foreign session supplied the answer.").toBe(false);
    expect(f.published()).toEqual([]);
  }, 40_000);

  it("P4E-2 rejects an old terminal answer that predates this prompt", async () => {
    const f = await fixture(kind, { timeout: 3, messages: [assistant(answer(kind), { time: { created: 1, completed: 2 } })] });
    await f.run();
    expect(f.requests.some((request) => request.path.endsWith("/message"))).toBe(true);
    expect(f.complete(), "An old message supplied the answer.").toBe(false);
    expect(f.published()).toEqual([]);
  }, 40_000);

  it("P4E-3 waits after a completed tool-calls step", async () => {
    const f = await fixture(kind, { timeout: 3, messages: [assistant(answer(kind), { finish: "tool-calls" })] });
    await f.run();
    expect(f.requests.some((request) => request.path.endsWith("/message"))).toBe(true);
    expect(f.complete(), "A tool-calls step supplied the final answer.").toBe(false);
    expect(f.published()).toEqual([]);
  }, 40_000);
});
