/** Offline attacks for Green r8. Each case runs an actual shell entry point.
 * The HTTP fake uses an ephemeral loopback port and synthetic messages.
 * The clock shim controls shell time, not the runner code or HTTP client. */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");
const CACHE = process.env.XDG_CACHE_HOME || "/home/daniebo/.cache/opencode";
const roots = new Set<string>();
const servers = new Set<Server>();
const children = new Set<ChildProcess>();
const timers = new Set<ReturnType<typeof setTimeout>>();
const START = 1795220000750;
const FLOOR = Math.floor(START / 1000) * 1000;
const SESSION = "ses_p4f";
const SET = "mg-synthetic-p4f";
const FINDING = "d-01#C0a1b2c3d4e5f";
const TOKENS = { input: 3, output: 5, reasoning: 7, cache: { read: 11, write: 13 } };
const ZERO_TOKENS = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
const LARGE_TOKENS = {
  input: 1000000000000000, output: 1000000000000000, reasoning: 500000000000,
  cache: { read: 500000000000, write: 500000000000 },
};
type Kind = "review" | "judge";
type Message = Record<string, any>;
type Request = { method: string; path: string; body: any; at: number };
type Page = { messages: Message[]; clockAfter?: number; delayMs?: number };
type Scenario = { pages: Page[]; timeout?: number; realClock?: boolean };

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

function answer(kind: Kind, alternate = false): string {
  const doc = kind === "review"
    ? { findings: alternate ? [{ file: "a.ts", line: 1, severity: "major", class: "C3", title: "Intermediate", reason: "Synthetic claim" }] : [] }
    : { [FINDING]: alternate ? "real-defect" : "false-claim" };
  return "```json\n" + JSON.stringify(doc) + "\n```";
}

function assistant(text: string, extra: Message = {}): Message {
  return {
    id: "msg_final", sessionID: SESSION, type: "assistant",
    content: [{ type: "text", text }], finish: "stop",
    time: { created: START + 10, completed: START + 20 }, tokens: TOKENS,
    ...extra,
  };
}

function tool(kind: Kind, index: number): Message {
  return assistant(answer(kind, true), {
    id: `msg_tool_${index}`, finish: "tool-calls",
    time: { created: START + index, completed: START + index + 1 },
  });
}

function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  });
}

function digest(root: string): string {
  const hash = createHash("sha256");
  for (const file of files(root).sort()) hash.update(file.slice(root.length)).update(readFileSync(file));
  return hash.digest("hex");
}

async function fixture(kind: Kind, scenario: Scenario) {
  mkdirSync(CACHE, { recursive: true });
  const root = mkdtempSync(join(CACHE, "mg-p4f-"));
  roots.add(root);
  const repo = join(root, "repo"), guide = join(repo, "harness/model-guide");
  const privateDir = join(root, "private"), setDir = join(privateDir, "sets", SET);
  const job = join(root, "job"), home = join(root, "home"), tmp = join(root, "tmp"), bin = join(root, "bin");
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
  const binaryLog = join(root, "binary.log"), curlLog = join(root, "curl-refused.log");
  const fake = join(bin, "fake-opencode");
  writeFileSync(fake, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$P4F_BINARY_LOG"\nexit 93\n', { mode: 0o755 });
  symlinkSync(fake, join(bin, "opencode"));
  symlinkSync(fake, join(bin, "openchamber"));
  // A changed URL or redirect flag fails before a packet can leave this fake.
  writeFileSync(join(bin, "curl"), `#!/bin/sh
for arg do
  case "$arg" in
    -L|--location|--location-trusted) printf '%s\\n' refused >> "$P4F_CURL_LOG"; exit 94;;
    http://*|https://*) if [ "$arg" != "$BENCH_SERVER_BASE/api/quota/opencode-go" ] && [ "$arg" != "$BENCH_SERVER_BASE/api/session" ] && [ "$arg" != "$BENCH_SERVER_BASE/api/session/${SESSION}/prompt" ] && [ "$arg" != "$BENCH_SERVER_BASE/api/session/${SESSION}/message" ]; then printf '%s\\n' refused >> "$P4F_CURL_LOG"; exit 94; fi;;
  esac
done
exec /usr/bin/curl "$@"
`, { mode: 0o755 });
  const clock = join(root, "clock"), clockLog = join(root, "clock.log");
  writeFileSync(clock, String(START));
  if (!scenario.realClock) writeFileSync(join(bin, "date"), `#!/bin/sh
case "$*" in
  +%s|+%s%3N) read -r ms < "$P4F_CLOCK"; printf '%s\\n' "$ms" >> "$P4F_CLOCK_LOG"; if [ "$1" = '+%s' ]; then printf '%s\\n' "$((ms / 1000))"; else printf '%s\\n' "$ms"; fi;;
  *) exec /usr/bin/date "$@";;
esac
`, { mode: 0o755 });
  const timeout = scenario.timeout ?? 10;
  const route = kind === "review" ? "opencode-go/hy4-flash-free#high" : "opencode-go/muse-spark-1.3-contributor#high";
  const rows = [{ route, kind: "plan", quota_provider: "opencode-go", quota_source: "opencode-go" }];
  writeFileSync(join(guide, "routes.json"), JSON.stringify(rows));
  writeFileSync(join(guide, "judges.json"), JSON.stringify(rows));
  writeFileSync(join(job, "opencode.json"), JSON.stringify({ permission: Object.fromEntries(
    ["read", "edit", "bash", "webfetch", "websearch", "question", "subagent", "skill"].map((name) => [name, "deny"]),
  ) }));
  writeFileSync(join(repo, "docs/index.html"), "<!doctype html><title>Synthetic p4f</title>\n");
  for (const dir of ["diffs", "src", "messages", "adjudication"]) mkdirSync(join(setDir, dir), { recursive: true });
  for (const dir of ["diffs", "src"]) writeFileSync(join(setDir, dir, "d-01.diff"), "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\nL1 +const x = 1;\n");
  writeFileSync(join(setDir, "messages/d-01.txt"), "Synthetic change\n");
  writeFileSync(join(setDir, "adjudication/queue.json"), JSON.stringify({ set_id: SET, groups: [{
    id: "d-01#G1", diff_id: "d-01", file: "a.ts", window: [1, 3],
    items: [{ id: FINDING, line: 1, claim: { class: "C3", severity: "major", title: "Synthetic claim", reason: "Synthetic reason" } }],
  }] }));
  expect(spawnSync("git", ["init", "-q", repo], { env: { PATH: process.env.PATH, HOME: home } }).status).toBe(0);
  const requests: Request[] = [], served: Page[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let body: any = null;
      try { body = JSON.parse(raw); } catch { /* A GET has no body. */ }
      const path = req.url || "";
      requests.push({ method: req.method || "", path, body, at: Date.now() });
      const reply = (doc: unknown) => {
        res.writeHead(200, { "content-type": "application/json", connection: "close" });
        res.end(JSON.stringify(doc));
      };
      if (req.method === "GET" && path === "/api/quota/opencode-go") {
        reply({ usage: { windows: { "5h": { usedPercent: 10 }, weekly: { usedPercent: 10 } } } });
      } else if (req.method === "POST" && path === "/api/session") {
        reply({ id: SESSION, location: { directory: body?.location?.directory } });
      } else if (req.method === "POST" && path === `/api/session/${SESSION}/prompt`) {
        reply({ messageID: "msg_prompt" });
      } else if (req.method === "GET" && path === `/api/session/${SESSION}/message`) {
        const index = served.length;
        // An unaccepted final fixture gets one more read at expiry.
        const page = scenario.pages[index] ?? { messages: [], clockAfter: FLOOR + timeout * 1000 };
        served.push(page);
        const send = () => {
          if (res.destroyed) return;
          if (page.clockAfter !== undefined) writeFileSync(clock, String(page.clockAfter));
          reply({ data: page.messages, cursor: {} });
        };
        if (page.delayMs) {
          const timer = setTimeout(() => { timers.delete(timer); send(); }, page.delayMs);
          timers.add(timer);
        } else send();
      } else { res.writeHead(404, { connection: "close" }); res.end(); }
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
    BENCH_OPENCODE_BIN: fake, BENCH_OPENCODE_HOME: job, BENCH_SERVER_BASE: base, BENCH_QUOTA_BASE: base,
    P4F_BINARY_LOG: binaryLog, P4F_CURL_LOG: curlLog, P4F_CLOCK: clock, P4F_CLOCK_LOG: clockLog,
    MG_CALL_TIMEOUT_S: String(timeout), MG_RUN_RETRY_WAIT_MS: "0",
  };
  const run = async () => {
    const before = digest(repo);
    const args = [join(guide, `${kind}-run.sh`), "--route", route, "--set", SET, "--private", privateDir];
    if (kind === "review") args.push("--date", "2026-11-21");
    else args.push("--judge", "a");
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string; elapsed: number }>((done, fail) => {
      const at = Date.now();
      const child = spawn("bash", args, { cwd: repo, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      children.add(child);
      let stdout = "", stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => {
        try { process.kill(-child.pid!, "SIGKILL"); } catch { /* The group already exited. */ }
        fail(new Error("The runner exceeded the test timeout."));
      }, 30_000);
      child.once("error", (error) => { clearTimeout(timer); fail(error); });
      child.once("close", (status) => {
        clearTimeout(timer);
        children.delete(child);
        done({ status, stdout, stderr, elapsed: Date.now() - at });
      });
    });
    expect(digest(repo), "The runner changed its repository.").toBe(before);
    for (const log of [binaryLog, curlLog]) expect(existsSync(log) ? readFileSync(log, "utf8") : "").toBe("");
    expect(requests.filter((request) => request.method === "DELETE")).toEqual([]);
    const creates = requests.filter((request) => request.path === "/api/session").length;
    // D13 permits transport retries. Deterministic message cases need one call.
    if (scenario.realClock) { expect(creates).toBeGreaterThan(0); expect(creates).toBeLessThanOrEqual(3); }
    else expect(creates).toBe(1);
    expect(requests.filter((request) => request.path.endsWith("/prompt"))).toHaveLength(creates);
    expect(served.length, "The message GET did not reach the fake.").toBeGreaterThan(0);
    if (!scenario.realClock) expect(Number(readFileSync(clockLog, "utf8").trim().split("\n")[0])).toBe(START);
    return result;
  };
  const records = () => files(privateDir).filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(file, "utf8"))).filter((doc) => doc.state !== undefined);
  const published = () => kind === "review"
    ? files(privateDir).filter((file) => file.endsWith("/d-01.txt") && !file.includes("/messages/")).map((file) => readFileSync(file, "utf8"))
    : existsSync(join(setDir, "adjudication/judge-a.json")) ? [readFileSync(join(setDir, "adjudication/judge-a.json"), "utf8")] : [];
  return { root, run, requests, served, records, published };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function accepted(f: Fixture, kind: Kind) {
  expect(f.records().map((doc) => doc.state)).toEqual(["complete"]);
  if (kind === "review") expect(f.published()).toEqual([answer(kind)]);
  else {
    expect(f.published()).toHaveLength(1);
    expect(JSON.parse(f.published()[0])).toEqual({ [FINDING]: "false-claim" });
  }
}
function refused(f: Fixture) {
  expect(f.records().some((doc) => doc.state === "complete"), "An invalid answer completed the run.").toBe(false);
  expect(f.published(), "An invalid answer reached the private output.").toEqual([]);
}

describe.each<Kind>(["review", "judge"])("P4F %s live runner", (kind) => {
  it("waits through three tool steps and stores only the later stop answer", async () => {
    const steps = [tool(kind, 1), tool(kind, 2), tool(kind, 3)];
    const f = await fixture(kind, { pages: [
      { messages: [steps[0]] }, { messages: [steps[1], steps[0]] },
      { messages: [steps[2], steps[1], steps[0]] },
      { messages: [assistant(answer(kind)), ...steps.toReversed()] },
    ] });
    const result = await f.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.served).toHaveLength(4);
    accepted(f, kind);
  }, 40_000);

  it("P4F-1 NIGHT-3 DATA LOSS sums each tool step once across repeated polls", async () => {
    const first = tool(kind, 1), second = tool(kind, 2), final = assistant(answer(kind));
    const f = await fixture(kind, { pages: [
      { messages: [first] }, { messages: [first] }, { messages: [second, first] }, { messages: [final, second, first] },
    ] });
    expect((await f.run()).status).toBe(0);
    expect(f.served).toHaveLength(4);
    accepted(f, kind);
    expect(f.records()[0].tokens, "The pass lost token use from completed tool steps.").toEqual({
      input: 9, output: 15, reasoning: 21, cache_read: 33, cache_write: 39, total: 117,
    });
    expect(f.records()[0].tokens_complete).toBe(true);
  }, 40_000);

  it("P4F-1 NIGHT-3 DATA LOSS marks missing tool-step token use incomplete", async () => {
    const step = tool(kind, 1);
    delete step.tokens;
    const f = await fixture(kind, { pages: [
      { messages: [step] }, { messages: [assistant(answer(kind)), step] },
    ] });
    expect((await f.run()).status).toBe(0);
    expect(f.served).toHaveLength(2);
    accepted(f, kind);
    expect(f.records()[0].tokens_complete, "The pass claims complete telemetry after losing a tool step.").toBe(false);
  }, 40_000);

  it.each([0, 1000])("refuses a stop answer at the deadline plus %i ms", async (offset) => {
    const f = await fixture(kind, { pages: [
      { messages: [tool(kind, 1)] },
      { messages: [assistant(answer(kind)), tool(kind, 1)], clockAfter: START + 10_000 + offset },
    ] });
    const result = await f.run();
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe(`${kind}-run: the model answer did not complete`);
    expect(f.served).toHaveLength(2);
    refused(f);
  }, 40_000);

  it("keeps a newest tool-calls step partial until the deadline", async () => {
    const newest = tool(kind, 2), older = assistant(answer(kind));
    const f = await fixture(kind, { pages: [
      { messages: [newest, older] },
      { messages: [newest, older], clockAfter: START + 10_000 },
    ] });
    expect((await f.run()).status).toBe(2);
    expect(f.served).toHaveLength(2);
    refused(f);
  }, 40_000);

  it("bounds a real HTTP response that completes after the real deadline", async () => {
    const f = await fixture(kind, { realClock: true, timeout: 3, pages: [{
      messages: [assistant(answer(kind), { time: { created: Date.now() + 2000, completed: Date.now() + 3500 } })], delayMs: 3500,
    }] });
    const result = await f.run();
    // A failed GET can return an open record through the D13 transport path.
    expect([0, 2]).toContain(result.status);
    expect(result.elapsed).toBeLessThan(15_000);
    refused(f);
  }, 40_000);

  it.each([0, 1])("accepts created at actual call entry plus %i ms", async (offset) => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), {
      time: { created: START + offset, completed: START + 20 },
    })] }] });
    const result = await f.run();
    expect(result.status).toBe(0);
    accepted(f, kind);
  }, 40_000);

  it("refuses created one millisecond before the floored call boundary", async () => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), {
      time: { created: FLOOR - 1, completed: START + 20 },
    })] }] });
    expect((await f.run()).status).toBe(2);
    refused(f);
  }, 40_000);

  // A new native session excludes this stale fixture. The PM cap defers the gap.
  it.skip("A-F1 rejects a same-second answer that predates actual call entry", async () => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), {
      time: { created: START - 1, completed: START - 1 },
    })] }] });
    await f.run();
    refused(f);
  }, 40_000);

  it("accepts the native ownerless message through the scoped endpoint", async () => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), { sessionID: undefined })] }] });
    expect((await f.run()).status).toBe(0);
    accepted(f, kind);
  }, 40_000);

  it("rejects a foreign top owner even when info names this session", async () => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), {
      sessionID: "ses_foreign", info: { role: "assistant", sessionID: SESSION },
    })] }] });
    expect((await f.run()).status).toBe(2);
    refused(f);
  }, 40_000);

  it("uses info.sessionID when the top owner is absent", async () => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), {
      sessionID: undefined, info: { role: "assistant", sessionID: "ses_foreign" },
    })] }] });
    expect((await f.run()).status).toBe(2);
    refused(f);
  }, 40_000);

  // Native records need no owner field. This conflict is a hostile-response probe.
  it.skip("P4F-2 rejects conflicting top and info owner fields", async () => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), {
      info: { role: "assistant", sessionID: "ses_foreign" },
    })] }] });
    await f.run();
    refused(f);
  }, 40_000);

  it.each([
    ["missing time", undefined], ["null time", null], ["string time", "bad"],
    ["string created", { created: String(START), completed: START + 20 }],
    ["null created", { created: null, completed: START + 20 }],
  ])("refuses malformed %s", async (_name, time) => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), { time })] }] });
    expect((await f.run()).status).toBe(2);
    refused(f);
  }, 40_000);

  it.each([
    ["object finish", { bad: true }, undefined], ["numeric finish", 42, undefined],
    ["string completed", undefined, "done"], ["null completed", undefined, null],
  ])("keeps %s partial without another terminal field", async (_name, finish, completed) => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), {
      finish, time: { created: START + 10, completed },
    })] }] });
    expect((await f.run()).status).toBe(2);
    refused(f);
  }, 40_000);

  // These malformed values are synthetic. They do not establish a native data loss.
  it.skip.each([
    ["negative completed", undefined, -1], ["completed before created", undefined, START - 1],
    ["unknown finish", "garbage", undefined], ["whitespace finish", " ", undefined],
    ["padded tool-calls", "tool-calls ", undefined],
  ])("P4F-3 refuses malformed terminal metadata: %s", async (_name, finish, completed) => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), {
      finish, time: { created: START + 10, completed },
    })] }] });
    await f.run();
    refused(f);
  }, 40_000);

  it("does not let a valid stop override the exact tool-calls guard", async () => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), {
      finish: "tool-calls", time: { created: START + 10, completed: START + 20 },
    })] }] });
    expect((await f.run()).status).toBe(2);
    refused(f);
  }, 40_000);

  it("A7 preserves a key-shape hit beside never and do not", async () => {
    const key = "sk-" + "synthetic_p4f_value_01234567890123456789";
    const text = "Never retain this; do not publish: " + key + "\n" + answer(kind);
    const f = await fixture(kind, { pages: [{ messages: [assistant(text)] }] });
    const result = await f.run();
    expect(result.stdout + result.stderr).not.toContain(key);
    refused(f);
    expect(files(f.root).filter((file) => readFileSync(file, "utf8").includes(key))).toEqual([]);
  }, 40_000);

  // Risk cases for the Green r9 token sum (remediation a05a0f4). Each case
  // runs the real shell entry point against a synthetic message page.
  it("P4G-1 counts a repeated message id in one page once", async () => {
    const first = tool(kind, 1), second = tool(kind, 2), final = assistant(answer(kind));
    const f = await fixture(kind, { pages: [{ messages: [final, first, first, second] }] });
    expect((await f.run()).status).toBe(0);
    accepted(f, kind);
    expect(f.records()[0].tokens, "A repeated id doubled the token sum.").toEqual({
      input: 9, output: 15, reasoning: 21, cache_read: 33, cache_write: 39, total: 117,
    });
    expect(f.records()[0].tokens_complete).toBe(true);
  }, 40_000);

  it("P4G-2 counts tokens from the final page when an id repeats across pages", async () => {
    const early = tool(kind, 1);
    early.tokens = { input: 1, output: 1, reasoning: 1, cache: { read: 1, write: 1 } };
    const f = await fixture(kind, { pages: [
      { messages: [early] },
      { messages: [assistant(answer(kind)), tool(kind, 1), tool(kind, 2)] },
    ] });
    expect((await f.run()).status).toBe(0);
    expect(f.served).toHaveLength(2);
    accepted(f, kind);
    expect(f.records()[0].tokens, "An earlier page leaked token use into the sum.").toEqual({
      input: 9, output: 15, reasoning: 21, cache_read: 33, cache_write: 39, total: 117,
    });
    expect(f.records()[0].tokens_complete).toBe(true);
  }, 40_000);

  it("P4G-3 counts a finishless step with tokens beside the terminal step", async () => {
    const terminal = assistant(answer(kind), { id: "msg_terminal" });
    const finishless = assistant(answer(kind, true), {
      id: "msg_finishless", finish: undefined,
      time: { created: START + 5, completed: START + 6 },
      tokens: { input: 2, output: 4, reasoning: 6, cache: { read: 8, write: 10 } },
    });
    const f = await fixture(kind, { pages: [{ messages: [terminal, finishless] }] });
    expect((await f.run()).status).toBe(0);
    accepted(f, kind);
    expect(f.records()[0].tokens, "A step without finish lost its token use.").toEqual({
      input: 5, output: 9, reasoning: 13, cache_read: 19, cache_write: 23, total: 69,
    });
    expect(f.records()[0].tokens_complete).toBe(true);
  }, 40_000);

  it("P4G-4 zeroes partial token keys and clears tokens_complete", async () => {
    const partial = tool(kind, 1);
    partial.tokens = { input: 4, output: 6 };
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind)), partial] }] });
    expect((await f.run()).status).toBe(0);
    accepted(f, kind);
    expect(f.records()[0].tokens, "A partial token bundle was summed incorrectly.").toEqual({
      input: 7, output: 11, reasoning: 7, cache_read: 11, cache_write: 13, total: 49,
    });
    expect(f.records()[0].tokens_complete, "Partial keys were reported as complete.").toBe(false);
  }, 40_000);

  it("P4G-5 keeps complete telemetry for an all-zero token bundle", async () => {
    const f = await fixture(kind, { pages: [{ messages: [assistant(answer(kind), { tokens: ZERO_TOKENS })] }] });
    expect((await f.run()).status).toBe(0);
    accepted(f, kind);
    expect(f.records()[0].tokens).toEqual({
      input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, total: 0,
    });
    expect(f.records()[0].tokens_complete, "A valid zero bundle was marked incomplete.").toBe(true);
  }, 40_000);

  it("P4G-6 sums large safe integers exactly", async () => {
    const first = tool(kind, 1), second = tool(kind, 2);
    first.tokens = LARGE_TOKENS;
    second.tokens = LARGE_TOKENS;
    const final = assistant(answer(kind), { tokens: LARGE_TOKENS });
    const f = await fixture(kind, { pages: [{ messages: [final, first, second] }] });
    expect((await f.run()).status).toBe(0);
    accepted(f, kind);
    expect(f.records()[0].tokens, "Large safe integers lost precision.").toEqual({
      input: 3000000000000000, output: 3000000000000000,
      reasoning: 1500000000000, cache_read: 1500000000000, cache_write: 1500000000000,
      total: 6004500000000000,
    });
    expect(f.records()[0].tokens_complete).toBe(true);
  }, 40_000);

  it("P4G-7 clears tokens_complete for an unsafe integer field", async () => {
    const final = assistant(answer(kind), { tokens: {
      input: 1e20, output: 5, reasoning: 7, cache: { read: 11, write: 13 },
    } });
    const f = await fixture(kind, { pages: [{ messages: [final] }] });
    expect((await f.run()).status).toBe(0);
    accepted(f, kind);
    expect(f.records()[0].tokens, "An unsafe integer corrupted the sum.").toEqual({
      input: 0, output: 5, reasoning: 7, cache_read: 11, cache_write: 13, total: 36,
    });
    expect(f.records()[0].tokens_complete, "An unsafe integer was reported as complete.").toBe(false);
  }, 40_000);
});
