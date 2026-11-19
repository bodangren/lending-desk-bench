/**
 * Adversarial tests for the runner block (plan tasks 4.1 to 4.8).
 *
 * This file attacks `review-run.sh`, `quota.ts`, `provider-credential.sh`,
 * `routes.json`, and the `review.html` render of `preview.sh`. Each case
 * checks the spec (D12 to D15, D22, and the secrecy rule). Each case uses
 * only the fake opencode. No case starts the real CLI. No case reads the
 * real shared store, the real quota endpoint, or the private folder.
 *
 * A failing case in this file shows an implementation defect. The case name
 * holds the id ADV-R-n of the finding.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");
const RUNNER_SOURCE = join(HARNESS, "model-guide", "review-run.sh");
const PROMPT_SOURCE = join(HARNESS, "model-guide", "review-prompt.md");
const QUOTA_SOURCE = join(HARNESS, "model-guide", "quota.ts");
const HOST_SOURCE = join(HARNESS, "opencode-host.sh");
const CRED_SOURCE = join(HARNESS, "opencode-credential.sh");
const LEAK_SOURCE = join(HARNESS, "model-guide", "leak-check.ts");
const PREVIEW_SOURCE = join(HARNESS, "model-guide", "preview.sh");
const FAKE_SOURCE = join(HARNESS, "model-guide-tests", "fixtures", "fakes", "fake-opencode");
const PAGE_B = join(import.meta.dirname, "fixtures", "page-b");
const TSX_BIN = join(HARNESS, "node_modules", ".bin", "tsx");

/** The secret of the stub provider. The stub scan prints only this value. */
const SECRET_A = "sk-adv-runner-secret-aaaaaaaa-0123456789";
/** The secret of another provider. The stub scan never prints this value. */
const SECRET_B = "sk-adv-runner-other-bbbbbbbb-9876543210";

const GO_ROUTE = "opencode-go/muse-spark-1.3-contributor#high";
const SET_ID = "mg-adv-runner";

const roots: string[] = [];

/** Every quota server this file starts. A process handler kills each entry
 * when the test process exits or takes a signal, so no server outlives the
 * run even when a case throws before its own finally block. */
const quotaChildren = new Set<ChildProcess>();

function trackServer(child: ChildProcess): void {
  quotaChildren.add(child);
  child.on("exit", () => {
    quotaChildren.delete(child);
  });
}

function killAllServers(): void {
  for (const child of [...quotaChildren]) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* the child is already gone */
    }
  }
}

if (!process.env.MG_ADV_R_CLEANUP_INSTALLED) {
  process.env.MG_ADV_R_CLEANUP_INSTALLED = "1";
  process.on("exit", killAllServers);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      killAllServers();
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
    });
  }
}

/** Stops one quota server and waits for its exit, up to a bounded wait. */
async function stopServer(child: ChildProcess, timeoutMs = 5000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    quotaChildren.delete(child);
    return;
  }
  const exited = new Promise<void>((done) => {
    const timer = setTimeout(done, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
  try {
    child.kill("SIGKILL");
  } catch {
    /* the child is already gone */
  }
  await exited;
  quotaChildren.delete(child);
}

/** The quota server processes of this run that still answer pgrep. */
function quotaServerOrphans(): string[] {
  // The exact probe the gate uses. The checker line holds the pattern text
  // too, so it is dropped; a real orphan never holds "pgrep -af".
  const result = spawnSync("sh", ["-c", "pgrep -af 'mg-adv-r-.*quota-server' || true"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return String(result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.includes("pgrep -af"));
}

afterAll(async () => {
  killAllServers();
  for (const child of [...quotaChildren]) {
    await stopServer(child);
  }
  expect(quotaServerOrphans(), "no quota server from this run stays alive").toEqual([]);
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `mg-adv-r-${tag}-`));
  roots.push(dir);
  return dir;
}

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...process.env, ...extra, NO_COLOR: "1", TZ: "UTC" };
  delete copy.BENCH_TRACK;
  return copy;
}

/** The stub of the provider credential helper. It seeds nothing and its
 * scan prints only the value of the route provider. */
const CREDENTIAL_STUB = `#!/usr/bin/env bash
set -uo pipefail
case "\${1:-}" in
  seed) exit 0 ;;
  scan-values) printf '%s\\n' "\${MG_TEST_SECRET_VALUE:-}"; exit 0 ;;
  *) echo "provider-credential: unknown mode" >&2; exit 2 ;;
esac
`;

/** The quota server of the cases. It answers GET /api/quota/<id> and logs
 * each request path. QUOTA_MODE selects the body: fixed, sequence, slow,
 * html, string, or huge. */
const QUOTA_SERVER = `const http = require("node:http");
const fs = require("node:fs");
const log = process.env.QUOTA_REQUEST_LOG || "";
const mode = process.env.QUOTA_MODE || "fixed";
const values = String(process.env.QUOTA_VALUES || "10").split(",").map(Number);
let n = 0;
const server = http.createServer((req, res) => {
  if (log !== "") fs.appendFileSync(log, (req.url || "") + "\\n");
  if (mode === "slow") return;
  if (mode === "html") {
    res.writeHead(200, { "content-type": "text/html", connection: "close" });
    res.end("<html><body>no quota here</body></html>");
    return;
  }
  if (mode === "string") {
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify({ usage: { windows: { "5h": { usedPercent: "50" } } } }));
    return;
  }
  if (mode === "huge") {
    const windows = {};
    for (let i = 0; i < 200; i += 1) windows["w" + i] = { usedPercent: i === 199 ? 85 : 10 };
    res.writeHead(200, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify({ usage: { windows } }));
    return;
  }
  const value = values[Math.min(n, values.length - 1)];
  n += 1;
  // The opencode-go source serves the real window set of the live endpoint
  // (task 4.13i): "5h", "weekly", "monthly", and a null "credits_balance".
  // Every other source keeps "5h", "day", "week".
  const live = (req.url || "").indexOf("/opencode-go") !== -1;
  const body = live
    ? JSON.stringify({ usage: { windows: {
      "5h": { usedPercent: value }, weekly: { usedPercent: value },
      monthly: { usedPercent: value }, credits_balance: { usedPercent: null } } } })
    : JSON.stringify({ usage: { windows: {
      "5h": { usedPercent: value }, day: { usedPercent: value }, week: { usedPercent: value } } } });
  res.writeHead(200, { "content-type": "application/json", connection: "close" });
  res.end(body);
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("PORT " + server.address().port + "\\n");
});
`;

function diffText(id: string): string {
  return [
    `--- a/src/${id}.ts`,
    `+++ b/src/${id}.ts`,
    "@@ -1,6 +1,6 @@",
    " export const value = 1;",
    "-export const other = 2;",
    "+export const other = 3;",
    " export const third = 4;",
    "",
  ].join("\n");
}

function copyIfPresent(source: string, target: string, mode?: number): void {
  if (!existsSync(source)) return;
  writeFileSync(target, readFileSync(source));
  if (mode !== undefined) chmodSync(target, mode);
}

interface RunnerOptions {
  route?: string;
  kind?: string;
  quotaProvider?: string | null;
  quotaSource?: string | null;
  routes?: unknown[];
  diffs?: string[];
  calls?: Array<Record<string, unknown>>;
  authExport?: string;
  fakeBin?: string;
}

interface RunnerFixture {
  root: string;
  repo: string;
  privateDir: string;
  specPath: string;
  logPath: string;
  requestPath: string;
  quotaBase: string;
  quotaChild: ChildProcess | null;
  closeQuota: () => Promise<void>;
}

/** Starts one quota server for one temp dir and waits for its PORT line.
 * The child is tracked, spawned with detached false, and killed by
 * stopServer. On a start failure the child is stopped before the throw, so
 * no path leaves a server behind. */
async function startQuotaServer(
  dir: string,
  options: { mode?: string; values?: string; requestLog?: string } = {},
): Promise<{ child: ChildProcess; port: string }> {
  const serverFile = join(dir, "quota-server.cjs");
  writeFileSync(serverFile, QUOTA_SERVER);
  const child = spawn("node", [serverFile], {
    cwd: dir,
    detached: false,
    env: env({
      QUOTA_MODE: options.mode ?? process.env.MG_ADV_QUOTA_MODE ?? "fixed",
      QUOTA_VALUES: options.values ?? process.env.MG_ADV_QUOTA_VALUES ?? "10",
      QUOTA_REQUEST_LOG: options.requestLog ?? "",
    }),
    stdio: ["ignore", "pipe", "ignore"],
  });
  trackServer(child);
  let port = "";
  const seen: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    seen.push(String(chunk));
    const m = seen.join("").match(/PORT (\d+)/);
    if (m) port = m[1];
  });
  // The server writes one line at start; poll with real sleeps so the
  // event loop can deliver the pipe data.
  const startAt = Date.now();
  while (port === "" && Date.now() - startAt < 8000) {
    await new Promise((done) => setTimeout(done, 25));
  }
  if (port === "") {
    await stopServer(child);
  }
  expect(port, "the quota server prints its port").not.toBe("");
  return { child, port };
}

/** Stops the quota server of one fixture and removes its /tmp folder. */
async function closeFixture(fx: RunnerFixture): Promise<void> {
  await fx.closeQuota();
  rmSync(fx.root, { recursive: true, force: true });
}

/** One temp repo with the runner, the quota server, and the fake opencode. */
async function buildRunner(options: RunnerOptions = {}): Promise<RunnerFixture> {
  const root = tempDir("run");
  const repo = join(root, "repo");
  const privateDir = join(root, "private");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const guideDir = join(repo, "harness", "model-guide");
  const binDir = join(repo, "bin");
  mkdirSync(guideDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(privateDir, { recursive: true });

  copyIfPresent(RUNNER_SOURCE, join(guideDir, "review-run.sh"), 0o755);
  copyIfPresent(PROMPT_SOURCE, join(guideDir, "review-prompt.md"));
  copyIfPresent(QUOTA_SOURCE, join(guideDir, "quota.ts"));
  copyIfPresent(HOST_SOURCE, join(repo, "harness", "opencode-host.sh"), 0o755);
  copyIfPresent(CRED_SOURCE, join(repo, "harness", "opencode-credential.sh"), 0o755);
  writeFileSync(join(guideDir, "provider-credential.sh"), CREDENTIAL_STUB, { mode: 0o755 });
  if (options.fakeBin) {
    writeFileSync(join(binDir, "fake-opencode"), readFileSync(options.fakeBin), { mode: 0o755 });
  } else {
    writeFileSync(join(binDir, "fake-opencode"), readFileSync(FAKE_SOURCE), { mode: 0o755 });
  }
  if (existsSync(TSX_BIN)) {
    mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
    symlinkSync(TSX_BIN, join(repo, "node_modules", ".bin", "tsx"));
  }

  const route = options.route ?? GO_ROUTE;
  const routes =
    options.routes ??
    [
      {
        family: "Go",
        route,
        kind: options.kind ?? "plan",
        quota_provider: options.quotaProvider ?? "opencode-go",
        quota_source: options.quotaSource ?? "opencode-go",
        ranked: true,
      },
    ];
  writeFileSync(join(guideDir, "routes.json"), `${JSON.stringify(routes, null, 2)}\n`);

  // The review input is the seeded diff of the set (spec D7). The `src/`
  // folder holds the source diffs without the plants, so the runner never
  // reads it. The message line of each diff (spec D10 ruling 2026-11-18)
  // lives in `messages/<id>.txt`; the runner refuses a set with a missing
  // or empty message file, so the fixture writes one non-empty line per
  // diff (the same fixture-only pattern as commit 193c4c2).
  const setDir = join(privateDir, "sets", SET_ID, "diffs");
  const messagesDir = join(privateDir, "sets", SET_ID, "messages");
  mkdirSync(setDir, { recursive: true });
  mkdirSync(messagesDir, { recursive: true });
  for (const id of options.diffs ?? ["a", "b"]) {
    writeFileSync(join(setDir, `${id}.diff`), diffText(id));
    writeFileSync(join(messagesDir, `${id}.txt`), `message line of ${id}\n`);
  }

  const specPath = join(root, "spec.json");
  writeFileSync(
    specPath,
    JSON.stringify({ calls: options.calls ?? [], auth_export: options.authExport ?? "[]" }),
  );
  const logPath = join(root, "opencode.log");
  const requestPath = join(root, "quota-requests.log");

  const { child, port } = await startQuotaServer(root, { requestLog: requestPath });
  return {
    root,
    repo,
    privateDir,
    specPath,
    logPath,
    requestPath,
    quotaBase: `http://127.0.0.1:${port}`,
    quotaChild: child,
    closeQuota: () => stopServer(child),
  };
}

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runReview(
  fx: RunnerFixture,
  args: string[],
  extraEnv: Record<string, string> = {},
): RunResult {
  const result = spawnSync("bash", [join(fx.repo, "harness", "model-guide", "review-run.sh"), ...args], {
    cwd: fx.repo,
    env: env({
      BENCH_OPENCODE_BIN: join(fx.repo, "bin", "fake-opencode"),
      BENCH_QUOTA_BASE: fx.quotaBase,
      BENCH_OPENCODE_HOME: "",
      FAKE_OPENCODE_SPEC: fx.specPath,
      FAKE_OPENCODE_LOG: fx.logPath,
      HOME: join(fx.root, "home"),
      XDG_CONFIG_HOME: join(fx.root, "xdg-config"),
      XDG_DATA_HOME: join(fx.root, "xdg-data"),
      XDG_STATE_HOME: join(fx.root, "xdg-state"),
      XDG_CACHE_HOME: join(fx.root, "xdg-cache"),
      XDG_RUNTIME_DIR: join(fx.root, "xdg-runtime"),
      TMPDIR: join(fx.root, "tmp"),
      MG_TEST_SECRET_VALUE: SECRET_A,
      MG_RUN_RETRY_WAIT_MS: "0",
      ...extraEnv,
    }),
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    let names: string[];
    try {
      names = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(current, name);
      try {
        if (readdirSync(full)) walk(full);
      } catch {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function filesHolding(dir: string, needle: string): string[] {
  return filesUnder(dir).filter((file) => {
    try {
      return readFileSync(file, "utf8").includes(needle);
    } catch {
      return false;
    }
  });
}

function passRecords(privateDir: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const file of filesUnder(privateDir)) {
    let doc: unknown = null;
    try {
      doc = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (doc && typeof doc === "object" && typeof (doc as { state?: unknown }).state === "string") {
      out.push({ ...((doc as Record<string, unknown>)), __file: file });
    }
  }
  return out;
}

function modelCallCount(logPath: string): number {
  if (!existsSync(logPath)) return 0;
  let count = 0;
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    const at = line.indexOf("argv=");
    if (at < 0) continue;
    const rest = line.slice(at + 5);
    const end = rest.indexOf("\t");
    if ((end < 0 ? rest : rest.slice(0, end)).startsWith("run ")) count += 1;
  }
  return count;
}

function liveFakeOpencode(): string[] {
  // The second grep drops the checker pipeline itself, so only a real
  // leftover fake child matches.
  const result = spawnSync("sh", ["-c", "ps -eo pid,args | grep '[f]ake-opencode' | grep -v grep || true"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return String(result.stdout ?? "")
    .split("\n")
    .filter((line) => /fake-opencode/.test(line));
}

describe("ADV-R runner block: route safety, quota shapes, and the mid-pass stop", () => {
  it("ADV-R-1: a route with shell metacharacters or spaces runs as one literal value, and .. values are refused", async () => {
    const hostile = "opencode-go/evil;id $(touch pwned) #high";
    const fx = await buildRunner({ route: hostile, diffs: ["a"], calls: [{ exit: 0, value: '{"findings":[]}' }] });
    try {
      const run = runReview(fx, ["--route", hostile, "--set", SET_ID, "--private", fx.privateDir, "--date", "2026-11-20"]);
      expect(run.status, `the literal route runs: ${run.stdout}${run.stderr}`).toBe(0);
      expect(modelCallCount(fx.logPath), "A4: one model call happened").toBe(1);
      const log = readFileSync(fx.logPath, "utf8");
      expect(log, "the model value stays one literal").toContain(`--model ${hostile}`);
      expect(existsSync(join(fx.repo, "pwned")), "no shell expansion wrote a file").toBe(false);
      const traces = filesHolding(fx.repo, "pwned").filter((file) => !file.endsWith("routes.json"));
      expect(traces, "no expansion trace outside routes.json").toEqual([]);
    } finally {
      await closeFixture(fx);
    }

    const fx2 = await buildRunner({ diffs: ["a"] });
    try {
      const badRoute = runReview(fx2, ["--route", "x;touch pwned", "--set", SET_ID, "--private", fx2.privateDir]);
      expect(badRoute.status, "an unknown route is refused").toBe(2);
      expect(modelCallCount(fx2.logPath), "no call on refusal").toBe(0);
      const badSet = runReview(fx2, ["--route", GO_ROUTE, "--set", "../x", "--private", fx2.privateDir]);
      expect(badSet.status, "a parent set id is refused").toBe(2);
      const badRoutePath = runReview(fx2, ["--route", "mega/../x", "--set", SET_ID, "--private", fx2.privateDir]);
      expect(badRoutePath.status, "a parent route value is refused").toBe(2);
      expect(filesUnder(fx2.privateDir).filter((f) => f.includes("..")), "no folder outside the root").toEqual([]);
    } finally {
      await closeFixture(fx2);
    }
  });

  it("ADV-R-2: a slow, huge, HTML, or string quota answer stops the route instead of hanging or passing", async () => {
    const runQuota = async (mode: string, provider = "opencode-go"): Promise<{ status: number | null; out: string; err: string }> => {
      const dir = tempDir("quota");
      const { child, port } = await startQuotaServer(dir, { mode, values: "10" });
      try {
        const result = spawnSync(
          join(HARNESS, "node_modules", ".bin", "tsx"),
          [join(HARNESS, "model-guide", "quota.ts"), "--provider", provider, "--base", `http://127.0.0.1:${port}`],
          { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 9000 },
        );
        return { status: result.status, out: String(result.stdout ?? ""), err: String(result.stderr ?? "") };
      } finally {
        await stopServer(child);
      }
    };

    const slow = await runQuota("slow");
    expect(slow.status, `a silent source stops: ${slow.out}${slow.err}`).toBe(0);
    expect(JSON.parse(slow.out.split("\n").find((l) => l.trim().startsWith("{")) ?? "{}").state).toBe("stopped");

    const huge = await runQuota("huge", "kimi-code-plan-cn");
    expect(huge.status, `a 2 MiB body parses: ${huge.out}${huge.err}`).toBe(0);
    expect(JSON.parse(huge.out.split("\n").find((l) => l.trim().startsWith("{")) ?? "{}").state).toBe("wait");

    const html = await runQuota("html");
    expect(html.status, `an HTML body stops: ${html.out}${html.err}`).toBe(0);
    expect(JSON.parse(html.out.split("\n").find((l) => l.trim().startsWith("{")) ?? "{}").state).toBe("stopped");

    const text = await runQuota("string");
    expect(text.status, `a string value stops: ${text.out}${text.err}`).toBe(0);
    expect(JSON.parse(text.out.split("\n").find((l) => l.trim().startsWith("{")) ?? "{}").state).toBe("stopped");
  });

  it("ADV-R-3: a window that jumps from 69 % to 100 % mid-pass stops the pass open with one stored output", async () => {
    process.env.MG_ADV_QUOTA_VALUES = "69,69,100";
    const fx = await buildRunner({
      diffs: ["a", "b"],
      calls: [
        { exit: 0, value: '{"findings":[]}' },
        { exit: 0, value: '{"findings":[]}' },
      ],
    });
    delete process.env.MG_ADV_QUOTA_VALUES;
    try {
      const run = runReview(fx, ["--route", GO_ROUTE, "--set", SET_ID, "--private", fx.privateDir, "--date", "2026-11-20"]);
      expect(run.status, `the pass ends: ${run.stdout}${run.stderr}`).toBe(0);
      const records = passRecords(fx.privateDir);
      expect(records, "A4: one pass record exists").toHaveLength(1);
      expect(records[0].state, "the jumped window stops the pass").toBe("open");
      expect(records[0].outputs, "one stored output").toHaveLength(1);
      expect(Object.keys(records[0]).filter((k) => k === "complete" || k === "rank"), "no completion marker").toEqual([]);
    } finally {
      await closeFixture(fx);
    }
  });
});

describe("ADV-R runner block: the trap, the value scan, and the region error", () => {
  it("ADV-R-4: a fake child that ignores TERM still dies, and the job folder is removed", async () => {
    const root = tempDir("term");
    const ignoreBin = join(root, "fake-opencode-ignore");
    writeFileSync(
      ignoreBin,
      `#!/usr/bin/env bash\ntrap "" TERM INT\nsleep 60 &\nwait $! 2>/dev/null || true\nprintf '%s' '{"findings":[]}'\nexit 0\n`,
      { mode: 0o755 },
    );
    const fx = await buildRunner({ diffs: ["a"], calls: [{ exit: 0, value: '{"findings":[]}' }], fakeBin: ignoreBin });
    try {
      const run = runReview(
        fx,
        ["--route", GO_ROUTE, "--set", SET_ID, "--private", fx.privateDir, "--date", "2026-11-20"],
        { MG_CALL_TIMEOUT_S: "3" },
      );
      expect(run.status, `the run ends despite the TERM trap: ${run.stdout}${run.stderr}`).toBe(0);
      const records = passRecords(fx.privateDir);
      expect(records, "A4: one pass record exists").toHaveLength(1);
      expect(records[0].state, "three killed calls leave the pass open").toBe("open");
      const leftovers = filesUnder(fx.repo).filter((f) => f.includes("opencode-host-"));
      expect(leftovers, "the trap removed the job folder").toEqual([]);
      expect(liveFakeOpencode(), "no fake child stays alive").toEqual([]);
    } finally {
      await closeFixture(fx);
    }
  });

  it("ADV-R-5: an exact credential value stops the pass, while a near miss and another provider value do not", async () => {
    const nearMiss = `${SECRET_A.slice(0, -1)}X`;
    const fxHit = await buildRunner({ diffs: ["a"], calls: [{ exit: 0, value: `{"findings":[]} ${SECRET_A}` }] });
    try {
      const run = runReview(fxHit, ["--route", GO_ROUTE, "--set", SET_ID, "--private", fxHit.privateDir, "--date", "2026-11-20"]);
      expect(run.status, `a hit ends the run: ${run.stdout}${run.stderr}`).toBe(0);
      expect(run.stdout, "one named line names the stop").toMatch(/^review-run: .*credential value/m);
      const records = passRecords(fxHit.privateDir);
      expect(records, "A4: one pass record exists").toHaveLength(1);
      expect(records[0].state, "a hit stops the pass").toBe("open");
      expect(filesHolding(fxHit.privateDir, SECRET_A), "no copy of the value stays in the private folder").toEqual([]);
      expect(filesHolding(fxHit.repo, SECRET_A), "no copy of the value stays in the repo").toEqual([]);
    } finally {
      await closeFixture(fxHit);
    }

    const fxMiss = await buildRunner({ diffs: ["a"], calls: [{ exit: 0, value: `{"findings":[]} ${nearMiss}` }] });
    try {
      const run = runReview(fxMiss, ["--route", GO_ROUTE, "--set", SET_ID, "--private", fxMiss.privateDir, "--date", "2026-11-20"]);
      expect(run.status, `a near miss completes: ${run.stdout}${run.stderr}`).toBe(0);
      const records = passRecords(fxMiss.privateDir);
      expect(records[0]?.state, "a one-char change is not a hit").toBe("complete");
    } finally {
      await closeFixture(fxMiss);
    }

    const fxOther = await buildRunner({ diffs: ["a"], calls: [{ exit: 0, value: `{"findings":[]} ${SECRET_B}` }] });
    try {
      const run = runReview(fxOther, ["--route", GO_ROUTE, "--set", SET_ID, "--private", fxOther.privateDir, "--date", "2026-11-20"]);
      expect(run.status, `another provider value completes: ${run.stdout}${run.stderr}`).toBe(0);
      const records = passRecords(fxOther.privateDir);
      expect(records[0]?.state, "the scan covers only the route provider").toBe("complete");
    } finally {
      await closeFixture(fxOther);
    }
  });

  it("ADV-R-6: a credential value in the last bytes of a 2 MiB output is still found", async () => {
    const fx = await buildRunner({
      diffs: ["a"],
      calls: [{ exit: 0, stdout_bytes: 2 * 1024 * 1024, value: `tail ${SECRET_A}` }],
    });
    try {
      const run = runReview(fx, ["--route", GO_ROUTE, "--set", SET_ID, "--private", fx.privateDir, "--date", "2026-11-20"]);
      expect(run.status, `the large output is scanned: ${run.stdout}${run.stderr}`).toBe(0);
      const records = passRecords(fx.privateDir);
      expect(records[0]?.state, "the tail value stops the pass").toBe("open");
      expect(filesHolding(fx.privateDir, SECRET_A), "no copy of the value stays").toEqual([]);
    } finally {
      await closeFixture(fx);
    }
  });

  it("ADV-R-7: a region error in another case or inside JSON still blocks a Go route, and never a non-Go route", async () => {
    const fxUpper = await buildRunner({
      diffs: ["a"],
      calls: [{ exit: 1, stderr: "ERROR: MODEL NOT AVAILABLE IN YOUR REGION" }],
    });
    try {
      const run = runReview(fxUpper, ["--route", GO_ROUTE, "--set", SET_ID, "--private", fxUpper.privateDir, "--date", "2026-11-20"]);
      expect(run.status).toBe(0);
      const records = passRecords(fxUpper.privateDir);
      expect(records[0]?.state, "another case still blocks").toBe("region-blocked");
      expect(modelCallCount(fxUpper.logPath), "no retry on a region error").toBe(1);
      expect(records[0]?.outputs, "no raw output stays").toHaveLength(0);
    } finally {
      await closeFixture(fxUpper);
    }

    const fxJson = await buildRunner({
      diffs: ["a"],
      calls: [{ exit: 1, stderr: '{"error":"model not supported in your region","code":403}' }],
    });
    try {
      const run = runReview(fxJson, ["--route", GO_ROUTE, "--set", SET_ID, "--private", fxJson.privateDir, "--date", "2026-11-20"]);
      expect(run.status).toBe(0);
      expect(passRecords(fxJson.privateDir)[0]?.state, "an error inside JSON still blocks").toBe("region-blocked");
    } finally {
      await closeFixture(fxJson);
    }

    const fxFree = await buildRunner({
      route: "nvidia/stepfun-ai/step-5-preview#high",
      kind: "free",
      quotaProvider: "nvidia",
      quotaSource: null,
      diffs: ["a"],
      calls: [
        { exit: 1, stderr: "the model is not available in your region" },
        { exit: 1, stderr: "the model is not available in your region" },
        { exit: 1, stderr: "the model is not available in your region" },
      ],
    });
    try {
      const run = runReview(fxFree, [
        "--route",
        "nvidia/stepfun-ai/step-5-preview#high",
        "--set",
        SET_ID,
        "--private",
        fxFree.privateDir,
        "--date",
        "2026-11-20",
      ]);
      expect(run.status).toBe(0);
      const records = passRecords(fxFree.privateDir);
      expect(records[0]?.state, "a non-Go route retries as transport").toBe("open");
      expect(modelCallCount(fxFree.logPath), "three tries on a non-Go route").toBe(3);
    } finally {
      await closeFixture(fxFree);
    }
  });
});

describe("ADV-R runner block: concurrency, hostile review data, and filter words", () => {
  it("ADV-R-8: two runs at the same time with the same job name leave one pass record under the lock", async () => {
    const fx = await buildRunner({
      diffs: ["a"],
      calls: [
        { exit: 0, sleep: 2, value: '{"findings":[]}' },
        { exit: 0, sleep: 2, value: '{"findings":[]}' },
      ],
    });
    try {
      const args = ["--route", GO_ROUTE, "--set", SET_ID, "--private", fx.privateDir, "--date", "2026-11-20"];
      const baseEnv = {
        BENCH_OPENCODE_BIN: join(fx.repo, "bin", "fake-opencode"),
        BENCH_QUOTA_BASE: fx.quotaBase,
        FAKE_OPENCODE_SPEC: fx.specPath,
        FAKE_OPENCODE_LOG: fx.logPath,
        MG_TEST_SECRET_VALUE: SECRET_A,
        MG_RUN_RETRY_WAIT_MS: "0",
        NO_COLOR: "1",
        TZ: "UTC",
      };
      const runOne = () =>
        new Promise<RunResult>((done) => {
          const child = spawn("bash", [join(fx.repo, "harness", "model-guide", "review-run.sh"), ...args], {
            cwd: fx.repo,
            env: env(baseEnv),
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (c: Buffer) => (stdout += c));
          child.stderr.on("data", (c: Buffer) => (stderr += c));
          child.on("close", (status: number | null) => done({ status, stdout, stderr }));
        });
      const [first, second] = await Promise.all([runOne(), runOne()]);
      const byStatus = [first, second].sort((a, b) => (a.status ?? 99) - (b.status ?? 99));
      const winner = byStatus[0];
      const loser = byStatus[1];
      expect(winner.status, `one run proceeds: ${winner.stdout}${winner.stderr}`).toBe(0);
      expect(loser.status, `the other run refuses: ${loser.stdout}${loser.stderr}`).toBe(2);
      const lockLines = String(loser.stderr ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      expect(lockLines, "one stderr line names the lock").toHaveLength(1);
      expect(lockLines[0], "the refusal names the lock").toMatch(/lock/i);
      const records = passRecords(fx.privateDir);
      expect(records.length, "A4: one pass record exists").toBe(1);
      expect(records[0].pass, "the winner leaves pass 1").toBe(1);
      expect(records[0].state, "the winner completes").toBe("complete");
      expect(modelCallCount(fx.logPath), "one run worth of model calls").toBe(1);
      expect(
        filesUnder(fx.privateDir).filter((file) => file.includes("-p2")),
        "the refused run writes no pass-2 file",
      ).toEqual([]);
      const third = runReview(fx, [...args]);
      expect(third.status, `the lock is released: ${third.stdout}${third.stderr}`).toBe(0);
      const after = passRecords(fx.privateDir);
      expect(after.map((record) => record.pass).sort(), "the third run gets pass 2").toEqual([1, 2]);
      expect(modelCallCount(fx.logPath), "the third run adds its own call").toBe(2);
      expect(liveFakeOpencode(), "no fake child stays alive").toEqual([]);
    } finally {
      await closeFixture(fx);
    }
  }, 120_000);

  it("ADV-R-9: a hostile route name in the score file reaches review.html escaped, and a missing field hides the rank", async () => {
    const root = tempDir("review");
    const repo = join(root, "repo");
    const guideDir = join(repo, "harness", "model-guide");
    mkdirSync(guideDir, { recursive: true });
    copyIfPresent(PREVIEW_SOURCE, join(guideDir, "preview.sh"), 0o755);
    for (const name of readdirSync(join(HARNESS, "model-guide"))) {
      if (["sets", "data"].includes(name)) continue;
      const from = join(HARNESS, "model-guide", name);
      const to = join(guideDir, name);
      try {
        cpSync(from, to, { recursive: true });
      } catch {
        /* a folder the case does not need */
      }
    }
    mkdirSync(join(repo, "docs", "assets", "css"), { recursive: true });
    mkdirSync(join(repo, "docs", "assets", "data"), { recursive: true });
    writeFileSync(join(repo, "docs", "assets", "data", "benchmark.json"), '{"schema":1,"rows":[]}\n');
    writeFileSync(join(repo, "docs", "assets", "css", "site.css"), "body{}\n");
    writeFileSync(
      join(repo, "docs", "index.html"),
      "<!doctype html><html><head><title>t</title></head><body><nav></nav><main><h1>t</h1></main></body></html>\n",
    );
    mkdirSync(join(repo, "harness", "node_modules", ".bin"), { recursive: true });
    symlinkSync(TSX_BIN, join(repo, "harness", "node_modules", ".bin", "tsx"));
    const dataDir = join(guideDir, "data");
    mkdirSync(dataDir, { recursive: true });
    const date = "2026-10-20";
    for (const name of [`ra-outcomes-${date}.json`, `aa-reliability-${date}.json`, `allowed-routes-${date}.json`, `MANIFEST-${date}.txt`]) {
      writeFileSync(join(dataDir, name), readFileSync(join(PAGE_B, name)));
    }
    const setId = "mg-adv-hostile";
    const hostileRoute = 'opencode-go/evil"><img src=x onerror=alert(1)>#high';
    mkdirSync(join(dataDir, "sets"), { recursive: true });
    mkdirSync(join(dataDir, "review-scores"), { recursive: true });
    writeFileSync(
      join(dataDir, "sets", `${setId}.json`),
      JSON.stringify({
        schema: "model-guide-set/1",
        set_id: setId,
        created: date,
        diffs: [{ id: "mono-01", repo: "o/r", commit: "a".repeat(40), parent: "b".repeat(40), seeded_diff_sha256: "c".repeat(64), key_sha256: "d".repeat(64) }],
        counts: { diffs: 1, plants: 2, blockers: 1 },
      }),
    );
    writeFileSync(
      join(dataDir, "review-scores", `${setId}.json`),
      JSON.stringify({
        schema: "model-guide-review-scores/1",
        set_id: setId,
        passes: [
          { route: hostileRoute, date, score: 80, state: "complete", found: 1, missed: 1, false_claims: 0 },
          { route: "opencode-go/plain#high", date, state: "complete", found: 0, missed: 2, false_claims: 1 },
        ],
        routes: [
          { route: hostileRoute, state: "complete", worst: 80, median: 80, best: 80, worst_blocker_recall: 50 },
          { route: "opencode-go/plain#high", state: "complete", median: 70, best: 70, worst_blocker_recall: 0 },
        ],
      }),
    );
    const manifest = join(dataDir, `MANIFEST-${date}.txt`);
    const result = spawnSync("bash", [join(guideDir, "preview.sh"), "--manifest", manifest], {
      cwd: repo,
      env: env(),
      encoding: "utf8",
      timeout: 120_000,
    });
    if (result.status !== 0) {
      expect(result.status, `a missing field is refused with exit 2: ${result.stdout}${result.stderr}`).toBe(2);
      expect(String(result.stdout ?? "").trim().split("\n").filter((l) => l !== ""), "one named refusal line").toHaveLength(1);
      return;
    }
    const page = readFileSync(join(repo, ".tmp", "model-guide-preview", "review.html"), "utf8");
    expect(page, "no raw tag from the route name").not.toContain("<img");
    expect(page, "the escaped name shows").toContain("&lt;img");
    expect(page, "A4: the hostile row exists").toContain("opencode-go/evil");
    const reviewJson = readFileSync(join(repo, ".tmp", "model-guide-preview", "review.json"), "utf8");
    expect(reviewJson, "no private field leaks").not.toMatch(/new_lines|witness|operator/);
  }, 120_000);

  it("ADV-R-10: filter words in a note hide neither a real key field nor the private path (A7)", async () => {
    const privateDir = tempDir("leak-private");
    const leakRun = (rows: unknown[]): RunResult => {
      const repo = tempDir("leak-repo");
      spawnSync("git", ["init", "-q"], { cwd: repo });
      const name = `ra-outcomes-2026-10-20.json`;
      writeFileSync(join(repo, name), `${JSON.stringify(rows, null, 2)}\n`);
      spawnSync("git", ["add", "--", name], { cwd: repo });
      const result = spawnSync(join(HARNESS, "node_modules", ".bin", "tsx"), [join(HARNESS, "model-guide", "leak-check.ts"), "--private", privateDir, "--repo", repo], {
        cwd: HARNESS,
        env: env(),
        encoding: "utf8",
        timeout: 60_000,
      });
      return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
    };
    const prose = {
      route: "p1/leak-a#high (never use the operator; do not witness new_lines)",
      role: "green",
      tasks: 6,
    };
    const control = leakRun([prose]);
    expect(control.status, `prose alone passes: ${control.stdout}${control.stderr}`).toBe(0);
    const withKey = leakRun([{ ...prose, operator: "C3-1 invert-condition" }]);
    expect(withKey.status, "a real key field still fails").toBe(2);
    const withPath = leakRun([{ route: `p1/leak-c (do not copy; never share ${privateDir}/sets)`, role: "green", tasks: 6 }]);
    expect(withPath.status, "the private path still fails").toBe(2);
  }, 120_000);

  it("ADV-R-11: a metered kind and a substring route name are refused before any call (A7)", async () => {
    const fx = await buildRunner({
      route: "a/b#high",
      diffs: ["a"],
      routes: [
        { family: "T", route: "a/b#high", kind: "plan", quota_provider: "opencode-go", quota_source: "opencode-go", ranked: true },
        { family: "M", route: "deepseek/deepseek-flash#high", kind: "metered", quota_provider: "deepseek", quota_source: null, ranked: false },
      ],
      calls: [{ exit: 0, value: '{"findings":[]}' }],
    });
    try {
      const metered = runReview(fx, ["--route", "deepseek/deepseek-flash#high", "--set", SET_ID, "--private", fx.privateDir]);
      expect(metered.status, "a metered kind is refused").toBe(2);
      const sub = runReview(fx, ["--route", "a/b#highx", "--set", SET_ID, "--private", fx.privateDir]);
      expect(sub.status, "a substring name is refused").toBe(2);
      const prefix = runReview(fx, ["--route", "xa/b#high", "--set", SET_ID, "--private", fx.privateDir]);
      expect(prefix.status, "a superstring name is refused").toBe(2);
      expect(modelCallCount(fx.logPath), "no call on any refusal").toBe(0);
      expect(passRecords(fx.privateDir), "no pass record on refusal").toEqual([]);
    } finally {
      await closeFixture(fx);
    }
  });

  it("ADV-R-12: no fake-opencode process stays alive after this file", async () => {
    expect(liveFakeOpencode(), "the file leaves no fake child").toEqual([]);
  });
});

describe("P4b row 4.15: the process-table guard scopes to its own run (Review C, F2, N15)", () => {
  it("P4B-C1 a fake process of another session does not fail this run's guard", async () => {
    // The guard must scope to this run's own temp root. A planted process
    // whose path sits outside that root belongs to another session and is
    // not a signal for this run (test strategy section 14.5, Review C and
    // F2 and N15). Falsification: an unscoped guard fails on the plant.
    const foreign = spawn(
      "bash",
      ["-c", "exec -a '/tmp/mg-foreign-session-4b15/fake-opencode serve --service foreign' sleep 20"],
      { stdio: "ignore", detached: true },
    );
    foreign.unref();
    try {
      let seen = false;
      for (let i = 0; i < 100; i += 1) {
        if (liveFakeOpencode().some((line) => line.includes("mg-foreign-session-4b15"))) {
          seen = true;
          break;
        }
        await new Promise((done) => setTimeout(done, 20));
      }
      expect(seen, "the planted foreign fake never appeared in the process table").toBe(true);
      expect(
        liveFakeOpencode().filter((line) => line.includes("mg-foreign-session-4b15")),
        "a fake of another session failed this run's process-table guard",
      ).toEqual([]);
    } finally {
      try {
        process.kill(-(foreign.pid as number), "SIGKILL");
      } catch {
        try {
          foreign.kill("SIGKILL");
        } catch {
          // The child is already gone.
        }
      }
    }
  });
});

describe("ADV-R runner block: lock isolation between routes", () => {
  function slugOf(route: string): string {
    return route.replace(/[^A-Za-z0-9._-]+/g, "-");
  }

  it("ADV-R-13: two different routes that map to one slug must not lock each other out", async () => {
    const routeA = "t/one#c";
    const routeB = "t-one#c";
    expect(slugOf(routeA), "the slugs collide").toBe(slugOf(routeB));
    const fx = await buildRunner({
      route: routeA,
      diffs: ["a"],
      routes: [
        { family: "T", route: routeA, kind: "plan", quota_provider: "opencode-go", quota_source: "opencode-go", ranked: true },
        { family: "T", route: routeB, kind: "plan", quota_provider: "opencode-go", quota_source: "opencode-go", ranked: true },
      ],
      calls: [
        { exit: 0, sleep: 3, value: '{"findings":[]}' },
        { exit: 0, value: '{"findings":[]}' },
      ],
    });
    try {
      const baseEnv = {
        BENCH_OPENCODE_BIN: join(fx.repo, "bin", "fake-opencode"),
        BENCH_QUOTA_BASE: fx.quotaBase,
        FAKE_OPENCODE_SPEC: fx.specPath,
        FAKE_OPENCODE_LOG: fx.logPath,
        MG_TEST_SECRET_VALUE: SECRET_A,
        MG_RUN_RETRY_WAIT_MS: "0",
        NO_COLOR: "1",
        TZ: "UTC",
      };
      const runAsync = (route: string) =>
        new Promise<RunResult>((done) => {
          const child = spawn("bash", [join(fx.repo, "harness", "model-guide", "review-run.sh"), "--route", route, "--set", SET_ID, "--private", fx.privateDir, "--date", "2026-11-20"], {
            cwd: fx.repo,
            env: env(baseEnv),
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (c: Buffer) => (stdout += c));
          child.stderr.on("data", (c: Buffer) => (stderr += c));
          child.on("close", (status: number | null) => done({ status, stdout, stderr }));
        });
      const slow = runAsync(routeA);
      await new Promise((done) => setTimeout(done, 1200));
      const fast = await runAsync(routeB);
      const slowResult = await slow;
      expect(slowResult.status, `route A proceeds: ${slowResult.stdout}${slowResult.stderr}`).toBe(0);
      expect(fast.status, `route B is not locked by route A: ${fast.stdout}${fast.stderr}`).toBe(0);
    } finally {
      await closeFixture(fx);
    }
  }, 120_000);
});

describe("ADV-R runner block: pass records of colliding-slug routes", () => {
  it("ADV-R-14: concurrent colliding-slug routes keep one pass record per route", async () => {
    const routeA = "t/one#c";
    const routeB = "t-one#c";
    const fx = await buildRunner({
      route: routeA,
      diffs: ["a"],
      routes: [
        { family: "T", route: routeA, kind: "plan", quota_provider: "opencode-go", quota_source: "opencode-go", ranked: true },
        { family: "T", route: routeB, kind: "plan", quota_provider: "opencode-go", quota_source: "opencode-go", ranked: true },
      ],
      calls: [
        { exit: 0, sleep: 3, value: '{"findings":[]}' },
        { exit: 0, sleep: 3, value: '{"findings":[]}' },
      ],
    });
    try {
      const baseEnv = {
        BENCH_OPENCODE_BIN: join(fx.repo, "bin", "fake-opencode"),
        BENCH_QUOTA_BASE: fx.quotaBase,
        FAKE_OPENCODE_SPEC: fx.specPath,
        FAKE_OPENCODE_LOG: fx.logPath,
        MG_TEST_SECRET_VALUE: SECRET_A,
        MG_RUN_RETRY_WAIT_MS: "0",
        NO_COLOR: "1",
        TZ: "UTC",
      };
      const runAsync = (route: string) =>
        new Promise<RunResult>((done) => {
          const child = spawn("bash", [join(fx.repo, "harness", "model-guide", "review-run.sh"), "--route", route, "--set", SET_ID, "--private", fx.privateDir, "--date", "2026-11-20"], {
            cwd: fx.repo,
            env: env(baseEnv),
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (c: Buffer) => (stdout += c));
          child.stderr.on("data", (c: Buffer) => (stderr += c));
          child.on("close", (status: number | null) => done({ status, stdout, stderr }));
        });
      const [a, b] = await Promise.all([runAsync(routeA), runAsync(routeB)]);
      expect(a.status, `route A exits 0: ${a.stdout}${a.stderr}`).toBe(0);
      expect(b.status, `route B exits 0: ${b.stdout}${b.stderr}`).toBe(0);
      const records = passRecords(fx.privateDir);
      expect(records.length, "A4: one pass record per route").toBe(2);
      expect(records.map((r) => r.route).sort()).toEqual([routeA, routeB].sort());
    } finally {
      await closeFixture(fx);
    }
  }, 120_000);
});
