/**
 * The review runner of task 4.1 (spec D13, D14, D15, D22; FR-11).
 *
 * The runner under test is `harness/model-guide/review-run.sh`. It does not
 * exist yet, so every case of this file fails at the phase base. The file
 * stays red until the Green task 4.7.
 *
 * The contract of this file, which the Green task 4.7 implements:
 *
 *   Usage:
 *     harness/model-guide/review-run.sh --route <route> --set <set_id> \
 *       --private <dir> [--date <YYYY-MM-DD>]
 *
 *   - `--route`, `--set`, and `--private` are required. `--date` is optional.
 *   - `--set` takes a plain set id: it starts with a letter or a digit, holds
 *     only letters, digits, `.`, `_`, and `-`, and holds no `..`. A value with
 *     a slash or a parent segment is refused.
 *   - `--route` takes a route of `harness/model-guide/routes.json`. A value
 *     with a parent segment is refused.
 *   - `--private` names the private root. The default is
 *     `$HOME/.local/share/lending-desk-bench/model-guide`.
 *   - Exit 2 is a refusal: one line `review-run: <check>` on stdout, no pass
 *     record, and no call.
 *   - Every other run writes one pass record in the private folder. Its
 *     `state` is one of `complete`, `open`, `wait`, or `region-blocked`.
 *   - The pass record holds `set_id`, `route`, `pass`, `date`, `state`,
 *     `diffs`, `outputs`, `errors`, `tokens`, and `tokens_complete`. Each
 *     entry of `diffs` holds its `id` and its own `tokens` object (spec
 *     D13, Tokens, PM 2026-11-18). It holds no `complete` field and no
 *     `rank` field.
 *   - `--probe` runs the probe mode of spec D14 (PM 2026-11-18). The block
 *     above the probe cases pins its line, its exit codes, and the probe
 *     record.
 *   - The raw output of each diff is stored in the private folder only.
 *   - Each model call is `run --standalone --format json --model <route>`.
 *   - The job config of the call denies `read`, `edit`, `bash`, `webfetch`,
 *     `websearch`, `question`, `subagent`, and `skill`. The runner points
 *     `OPENCODE_CONFIG` at that file for the call.
 *   - The seams are `BENCH_QUOTA_BASE`, `OPENCODE_CONFIG`,
 *     `MG_CALL_TIMEOUT_S`, and `MG_RUN_RETRY_WAIT_MS`.
 *
 * The set of the run is `<private>/sets/<set_id>/`, and its diffs are the
 * `src/<diff_id>.diff` files of that folder, in the order of their names.
 *
 * The test uses no network, no model, no real home folder, and no real
 * `opencode`. The only socket is the loopback server of the quota case. The
 * fake `opencode` of `fixtures/fakes/fake-opencode` is the only binary the
 * spawn can reach.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(HARNESS, "..");

/** The module under test. Its path is fixed, so a gate cannot point the
 * test at a file outside the repository. */
const RUNNER_SOURCE = join(HARNESS, "model-guide", "review-run.sh");
const PROMPT_SOURCE = join(HARNESS, "model-guide", "review-prompt.md");
const QUOTA_SOURCE = join(HARNESS, "model-guide", "quota.ts");
const HOST_SOURCE = join(HARNESS, "opencode-host.sh");
const CREDENTIAL_SOURCE = join(HARNESS, "opencode-credential.sh");
const FAKE_SOURCE = join(HARNESS, "model-guide-tests", "fixtures", "fakes", "fake-opencode");
const TSX_BIN = join(HARNESS, "node_modules", ".bin", "tsx");

/** The tools of the job config of D14. */
const DENY_TOOLS = ["read", "edit", "bash", "webfetch", "websearch", "question", "subagent", "skill"];

/** The credential value of the provider. The fake export and the value scan of
 * the stub helper both hold it. */
const SECRET = "sk-test-credential-value-0123456789";

/** The region error of spec D22. The runner marks a Go route that returns it
 * as `region-blocked`. */
const REGION_ERROR = "Error: the model is not available in your region";

const ROUTE = "opencode-go/muse-spark-1.3-contributor#high";
const METERED_ROUTE = "deepseek/deepseek-flash#high";
const UNKNOWN_ROUTE = "opencode-go/not-in-routes#high";
const SET_ID = "mg-test-set";

const TWO_MIB = 2 * 1024 * 1024;

// --- the PM load watch: this file leaves no server and no temp folder ----
/** The quota servers this file started. */
const startedServers = new Set<ChildProcess>();
/** The exit of each server this file started. */
const serverExits = new Set<Promise<void>>();
/** The temp folders this file created. */
const tempRoots = new Set<string>();

/** Kills every server this file started, without waiting. */
function killStartedServers(): void {
  for (const server of startedServers) {
    try {
      server.kill("SIGKILL");
    } catch {
      // The server is already gone.
    }
  }
  startedServers.clear();
}

/** Removes every temp folder this file created and did not remove yet. */
function sweepTempRoots(): void {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
}

/** Kills every server, waits for each exit, and removes the temp folders. */
async function stopStartedServers(): Promise<void> {
  killStartedServers();
  await Promise.all([...serverExits]);
  serverExits.clear();
  sweepTempRoots();
}

process.on("exit", () => {
  killStartedServers();
  sweepTempRoots();
});
process.on("SIGINT", () => {
  killStartedServers();
  sweepTempRoots();
  process.exit(130);
});
process.on("SIGTERM", () => {
  killStartedServers();
  sweepTempRoots();
  process.exit(143);
});

/** The lines of one command of the orphan scan. */
function commandLines(args: string[]): string[] {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 20_000 });
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

afterEach(async () => {
  await stopStartedServers();
});

/** The load watch of the PM: no server and no fake child of this run may
 * stay alive after the file. The scan keeps the lines that hold a temp
 * folder of this suite (`mg-`). */
afterAll(async () => {
  await stopStartedServers();
  const quotaOrphans = commandLines(["pgrep", "-f", "mg-.*quota-server"]);
  const fakeOrphans = commandLines(["bash", "-c", "ps -eo pid,args | grep '[f]ake-opencode'"]);
  const mine = [...quotaOrphans, ...fakeOrphans].filter((line) => line.includes("mg-"));
  expect(mine, "an orphan process of this run stays alive").toEqual([]);
});

interface CallSpec {
  exit?: number;
  stderr?: string;
  stdout_bytes?: number;
  pad_bytes?: number;
  sleep?: number;
  value?: string;
  tokens?: Record<string, unknown>;
}

interface Scenario {
  route?: string;
  family?: string;
  kind?: string;
  quotaProvider?: string | null;
  quotaSource?: string | null;
  diffs?: string[];
  calls?: CallSpec[];
  quotaPercent?: number;
  quotaStopPercent?: number;
  quotaStopAfter?: number;
  setId?: string;
  routes?: unknown[];
}

interface Fixture {
  root: string;
  fakeRoot: string;
  repo: string;
  privateDir: string;
  home: string;
  tmp: string;
  logPath: string;
  specPath: string;
  pidPath: string;
  fakePath: string;
  fakeDir: string;
  requestPath: string;
  setId: string;
  route: string;
  diffs: string[];
  quotaBase: string;
  runCounter: number;
  close: () => void;
}

/** The runner is the module under test. Its absence is the Red reason. */
function assertRunnerExists(): void {
  expect(
    existsSync(RUNNER_SOURCE),
    `the review runner is missing: ${RUNNER_SOURCE}`,
  ).toBe(true);
}

/** One synthetic source diff of the set. */
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

/** The stub of the provider credential helper. The real helper is the file of
 * the Green task 4.6, and its own test file proves it. The runner test needs
 * one provider and one value, so the stub serves both. */
const CREDENTIAL_STUB = `#!/usr/bin/env bash
set -uo pipefail
case "\${1:-}" in
  seed) exit 0 ;;
  scan-values) printf '%s\\n' "\${MG_TEST_SECRET_VALUE:-}"; exit 0 ;;
  *) echo "provider-credential: unknown mode" >&2; exit 2 ;;
esac
`;

/** The stub of the quota helper is the real file of the Green task 4.4. The
 * runner reads the quota through the seam `BENCH_QUOTA_BASE`, so the case
 * needs the real file when it exists. */
function copyIfPresent(source: string, target: string, mode?: number): void {
  if (!existsSync(source)) return;
  writeFileSync(target, readFileSync(source));
  if (mode !== undefined) chmodSync(target, mode);
}

/** The names and the bytes of every file of one tree. */
function snapshotTree(dir: string, skip: string[] = []): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (prefix === "" && skip.includes(name)) continue;
      const full = join(current, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const info = lstatSync(full);
      if (info.isSymbolicLink()) {
        out.push(`link ${rel} ${readlinkSync(full)}`);
        continue;
      }
      if (info.isDirectory()) {
        out.push(`dir ${rel}`);
        walk(full, rel);
        continue;
      }
      const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
      out.push(`file ${rel} ${hash} ${info.size}`);
    }
  };
  walk(dir, "");
  return out;
}

/** Every file of one tree. */
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
      const info = lstatSync(full);
      if (info.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** The files of one tree that hold a text. */
function filesHolding(dir: string, needle: string): string[] {
  return filesUnder(dir).filter((file) => {
    try {
      return readFileSync(file, "utf8").includes(needle);
    } catch {
      return false;
    }
  });
}

/** One log line of the fake `opencode`. */
interface LogEntry {
  argv0: string;
  argv: string;
  config: string;
  job: string;
  stdin: string;
}

/** The log lines of the fake. */
function logEntries(logPath: string): LogEntry[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const fields: Record<string, string> = {};
      for (const part of line.split("\t")) {
        const at = part.indexOf("=");
        if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1);
      }
      return {
        argv0: fields.argv0 ?? "",
        argv: fields.argv ?? "",
        config: fields.config ?? "",
        job: fields.job ?? "",
        stdin: fields.stdin ?? "",
      };
    });
}

/** The log lines of the model calls. */
function modelCalls(entries: LogEntry[]): LogEntry[] {
  return entries.filter((entry) => entry.argv.startsWith("run "));
}

/** The pass records of the private folder. A pass record is a JSON file with
 * a `state` field. */
function passRecords(privateDir: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const file of filesUnder(privateDir)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.trim().startsWith("{")) continue;
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      continue;
    }
    if (doc && typeof doc === "object" && typeof (doc as { state?: unknown }).state === "string") {
      out.push(doc as Record<string, unknown>);
    }
  }
  return out;
}

/** The named lines of the runner. */
function namedLines(result: { stdout: string | null }): string[] {
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^review-run/.test(line));
}

/** The stdout lines of the runner. */
function stdoutLines(result: { stdout: string | null }): string[] {
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The fields of the pass record that name a completion. */
function completionMarkers(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => key === "complete" || key === "completed");
}

/** The quota source of the case. It is a temp script that the test writes.
 * It answers `GET /api/quota/<id>` with the windows of spec D15, and it logs
 * every request path. */
const QUOTA_SERVER_SOURCE = `const fs = require("node:fs");
const http = require("node:http");
const logPath = process.env.QUOTA_LOG || "";
const percent = Number(process.env.QUOTA_PERCENT || "10");
const stopText = process.env.QUOTA_STOP_PERCENT || "";
const stopPercent = stopText === "" ? null : Number(stopText);
const stopAfter = Number(process.env.QUOTA_STOP_AFTER || "2");
const requestLog = process.env.QUOTA_REQUEST_LOG || "";

// The number of the model calls of the fake log.
const modelCalls = () => {
  let text = "";
  try { text = fs.readFileSync(logPath, "utf8"); } catch (error) { return 0; }
  let count = 0;
  for (const line of text.split("\\n")) {
    const at = line.indexOf("argv=");
    if (at < 0) continue;
    const rest = line.slice(at + 5);
    const end = rest.indexOf("\\t");
    const argv = end < 0 ? rest : rest.slice(0, end);
    if (argv.startsWith("run ")) count += 1;
  }
  return count;
};

const server = http.createServer((req, res) => {
  const url = req.url || "";
  if (requestLog !== "") fs.appendFileSync(requestLog, url + "\\n");
  let value = percent;
  if (stopPercent !== null && modelCalls() >= stopAfter) value = stopPercent;
  const body = JSON.stringify({
    usage: {
      windows: {
        "5h": { usedPercent: value },
        day: { usedPercent: value },
        week: { usedPercent: value },
      },
    },
  });
  res.writeHead(200, { "content-type": "application/json", connection: "close" });
  res.end(body);
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("PORT " + server.address().port + "\\n");
});
`;

/** The routes file of a temp repo: the route of the case, and the metered
 * route of the refusal case. A case that needs a route the file does not
 * hold passes its own list, so the file never holds that route.
 *
 * A no-source row keeps the shape of the committed `routes.json`: the
 * `quota_provider` is not empty and `quota_source` is `null`. `quotaSource`
 * distinguishes `undefined` (the default source) from `null` (no source). */
function routesFile(
  route: string,
  options: {
    family?: string;
    kind?: string;
    quotaProvider?: string | null;
    quotaSource?: string | null;
  } = {},
): unknown[] {
  return [
    {
      family: options.family ?? "Go",
      route,
      kind: options.kind ?? "plan",
      quota_provider: options.quotaProvider ?? "opencode-go",
      quota_source: options.quotaSource === undefined ? "opencode-go" : options.quotaSource,
      ranked: true,
    },
    {
      family: "DeepSeek Flash",
      route: METERED_ROUTE,
      kind: "metered",
      quota_provider: "deepseek",
      quota_source: null,
      ranked: false,
    },
  ];
}

/** Builds the temp repo, the private folder, the fake, and the quota server. */
async function buildFixture(scenario: Scenario = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "mg-review-run-"));
  const fakeRoot = mkdtempSync(join(tmpdir(), "mg-review-fake-"));
  tempRoots.add(root);
  tempRoots.add(fakeRoot);
  const repo = join(root, "repo");
  const privateDir = join(root, "private");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const guideDir = join(repo, "harness", "model-guide");
  const binDir = join(repo, "bin");
  const fakeDir = join(binDir, "fake-opencode.d");
  const fakePath = join(binDir, "fake-opencode");
  const logPath = join(fakeRoot, "opencode.log");
  const specPath = join(fakeRoot, "opencode-spec.json");
  const pidPath = join(fakeRoot, "opencode-pids.txt");

  for (const dir of [guideDir, binDir, fakeDir, home, tmp, privateDir]) {
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(join(repo, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(repo, "docs", "assets", "data"), { recursive: true });

  // The scripts that the runner runs sit in the temp repo, so the runner
  // never touches the real repository.
  copyIfPresent(RUNNER_SOURCE, join(guideDir, "review-run.sh"), 0o755);
  copyIfPresent(PROMPT_SOURCE, join(guideDir, "review-prompt.md"));
  copyIfPresent(QUOTA_SOURCE, join(guideDir, "quota.ts"));
  copyIfPresent(HOST_SOURCE, join(repo, "harness", "opencode-host.sh"), 0o755);
  copyIfPresent(CREDENTIAL_SOURCE, join(repo, "harness", "opencode-credential.sh"), 0o755);
  writeFileSync(join(guideDir, "provider-credential.sh"), CREDENTIAL_STUB, { mode: 0o755 });

  // The fake `opencode`. The path of the file holds the text `fake-opencode`,
  // and the directory of the PATH entry holds it too, so a resolved
  // `opencode` is the fake.
  writeFileSync(fakePath, readFileSync(FAKE_SOURCE), { mode: 0o755 });
  writeFileSync(join(fakeDir, "opencode"), readFileSync(FAKE_SOURCE), { mode: 0o755 });

  // A local `tsx`, so a runner that calls `quota.ts` finds no network.
  if (existsSync(TSX_BIN)) {
    mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
    symlinkSync(TSX_BIN, join(repo, "node_modules", ".bin", "tsx"));
  }

  // The routes of the temp repo. The file is a JSON array of route objects.
  const route = scenario.route ?? ROUTE;
  const routes = scenario.routes ??
    routesFile(route, {
      family: scenario.family,
      kind: scenario.kind,
      quotaProvider: scenario.quotaProvider,
      quotaSource: scenario.quotaSource,
    });
  writeFileSync(join(guideDir, "routes.json"), `${JSON.stringify(routes, null, 2)}\n`);

  // A synthetic docs tree. It must stay byte-identical.
  writeFileSync(join(repo, "docs", "index.html"), "<!doctype html>\n<title>Index</title>\n");
  writeFileSync(join(repo, "docs", "assets", "css", "site.css"), "body { color: #222; }\n");
  writeFileSync(join(repo, "docs", "assets", "data", "benchmark.json"), '{"runs":0}\n');

  // The set of the run.
  const setId = scenario.setId ?? SET_ID;
  const diffs = scenario.diffs ?? ["d-01", "d-02", "d-03"];
  const srcDir = join(privateDir, "sets", setId, "src");
  const seededDir = join(privateDir, "sets", setId, "diffs");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(seededDir, { recursive: true });
  for (const diff of diffs) {
    writeFileSync(join(srcDir, `${diff}.diff`), diffText(diff));
    writeFileSync(join(seededDir, `${diff}.diff`), diffText(diff));
  }

  // The spec of the fake.
  const secret = SECRET;
  writeFileSync(
    specPath,
    `${JSON.stringify(
      {
        calls: scenario.calls ?? [],
        auth_export: JSON.stringify([
          {
            integrationID: "opencode",
            active: true,
            value: {
              access: secret,
              refresh: "inert",
              expires: 9999999999999,
              metadata: { orgID: "org-test-0123456789" },
            },
          },
        ]),
        auth_export_exit: 0,
        auth_import_exit: 0,
      },
      null,
      2,
    )}\n`,
  );

  // The quota server of the case. It is the only socket of the file.
  //
  // The server runs in its own process. A server of the test process would
  // not answer while the test waits for the runner, because the test blocks
  // in `spawnSync` and the event loop of the process stops.
  const requestPath = join(fakeRoot, "quota-requests.txt");
  const serverPath = join(fakeRoot, "quota-server.js");
  writeFileSync(serverPath, QUOTA_SERVER_SOURCE);
  const percent = scenario.quotaPercent ?? 10;
  const stopPercent = scenario.quotaStopPercent;
  const stopAfter = scenario.quotaStopAfter ?? 2;
  const server = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      QUOTA_LOG: logPath,
      QUOTA_PERCENT: String(percent),
      QUOTA_STOP_PERCENT: stopPercent === undefined ? "" : String(stopPercent),
      QUOTA_STOP_AFTER: String(stopAfter),
      QUOTA_REQUEST_LOG: requestPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The load watch: the file waits for this exit in the afterEach, and the
  // process handlers kill it when a test stops before its finally block.
  startedServers.add(server);
  serverExits.add(
    new Promise<void>((done) => {
      server.once("close", () => done());
    }),
  );
  const port = await new Promise<number>((done, failed) => {
    let buffer = "";
    const timer = setTimeout(() => failed(new Error("the quota server did not start")), 10_000);
    server.stdout.on("data", (chunk: Buffer) => {
      buffer += String(chunk);
      const match = /PORT (\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        done(Number(match[1]));
      }
    });
    server.on("error", (error) => {
      clearTimeout(timer);
      failed(error);
    });
  });

  return {
    root,
    fakeRoot,
    repo,
    privateDir,
    home,
    tmp,
    logPath,
    specPath,
    pidPath,
    fakePath,
    fakeDir,
    requestPath,
    setId,
    route,
    diffs,
    quotaBase: `http://127.0.0.1:${port}`,
    runCounter: 0,
    close: () => {
      server.kill("SIGKILL");
    },
  };
}

/** The quota requests that the server received. */
function quotaRequests(fixture: Fixture): string[] {
  if (!existsSync(fixture.requestPath)) return [];
  return readFileSync(fixture.requestPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** Removes the temp trees of a case. */
function dropFixture(fixture: Fixture): void {
  fixture.close();
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fixture.fakeRoot, { recursive: true, force: true });
  tempRoots.delete(fixture.root);
  tempRoots.delete(fixture.fakeRoot);
}

/** The environment of a spawn. Every path is inside the temp tree. */
function spawnEnv(fixture: Fixture, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: fixture.home,
    XDG_CONFIG_HOME: join(fixture.home, ".config"),
    XDG_DATA_HOME: join(fixture.home, ".local", "share"),
    XDG_STATE_HOME: join(fixture.home, ".local", "state"),
    XDG_CACHE_HOME: join(fixture.home, ".cache"),
    XDG_RUNTIME_DIR: join(fixture.home, "run"),
    TMPDIR: fixture.tmp,
    TZ: "UTC",
    PATH: `${fixture.fakeDir}:${join(HARNESS, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
    BENCH_OPENCODE_BIN: fixture.fakePath,
    FAKE_OPENCODE_SPEC: fixture.specPath,
    FAKE_OPENCODE_LOG: fixture.logPath,
    FAKE_OPENCODE_PID_FILE: fixture.pidPath,
    BENCH_QUOTA_BASE: fixture.quotaBase,
    MG_TEST_SECRET_VALUE: SECRET,
    MG_CALL_TIMEOUT_S: "600",
    MG_RUN_RETRY_WAIT_MS: "0",
    ...extra,
  };
  delete env.BENCH_TRACK;
  delete env.OPENCODE_CONFIG;
  return env;
}

/** Runs the runner of the temp repo.
 *
 * The output goes to two files of the temp folder, not to a pipe. A runner
 * that leaves a child process behind holds the pipe open, and the read of the
 * pipe would wait for that child. */
function runRunner(
  fixture: Fixture,
  args: string[],
  extra: Record<string, string> = {},
): { status: number | null; signal: string | null; stdout: string; stderr: string; error?: Error } {
  const stdoutPath = join(fixture.tmp, `run-${process.pid}-${fixture.runCounter}.out`);
  const stderrPath = join(fixture.tmp, `run-${process.pid}-${fixture.runCounter}.err`);
  fixture.runCounter += 1;
  const outFd = openSync(stdoutPath, "w");
  const errFd = openSync(stderrPath, "w");
  let result;
  try {
    result = spawnSync(
      "bash",
      [join(fixture.repo, "harness", "model-guide", "review-run.sh"), ...args],
      {
        cwd: fixture.repo,
        env: spawnEnv(fixture, extra),
        encoding: "utf8",
        timeout: 20_000,
        stdio: ["ignore", outFd, errFd],
      },
    );
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  return {
    status: result.status,
    signal: result.signal,
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
    error: result.error,
  };
}

/** The args of one run of the set. */
function runArgs(fixture: Fixture, route?: string, setId?: string): string[] {
  return [
    "--route",
    route ?? fixture.route,
    "--set",
    setId ?? fixture.setId,
    "--private",
    fixture.privateDir,
  ];
}

/** The pid of a process that is alive. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits until a pid is gone. */
async function waitForDeath(pid: number, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return !isAlive(pid);
}

/** The live processes whose command line holds the text. */
function liveFakeProcesses(): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return out;
  }
  for (const name of names) {
    if (!/^[0-9]+$/.test(name)) continue;
    let cmdline: string;
    try {
      cmdline = readFileSync(`/proc/${name}/cmdline`, "utf8");
    } catch {
      continue;
    }
    if (cmdline.includes("fake-opencode")) out.push(`${name} ${cmdline.replace(/\0/g, " ").trim()}`);
  }
  return out;
}

describe("P4 R1 the pass shape of the review runner", () => {
  it("R1 calls the fake once for each diff, stores one raw output per diff in the private folder, and writes one pass record", async () => {
    const fixture = await buildFixture({
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const before = snapshotTree(fixture.repo, [".tmp"]);
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(modelCalls(logEntries(fixture.logPath))).toHaveLength(3);
      for (const diff of fixture.diffs) {
        const stored = filesHolding(fixture.privateDir, `RAW-${diff}`);
        expect(stored, `no stored raw output for ${diff}`).toHaveLength(1);
      }
      expect(filesHolding(fixture.repo, "RAW-"), "a raw output left the private folder").toEqual([]);
      const records = passRecords(fixture.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(["complete", "open"]).toContain(records[0].state);
      expect(snapshotTree(fixture.repo, [".tmp"])).toEqual(before);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R2 calls the model with run --standalone --format json --model <route>", async () => {
    const fixture = await buildFixture({
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
      diffs: ["d-01"],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls).toHaveLength(1);
      expect(calls[0].argv).toBe(`run --standalone --format json --model ${ROUTE}`);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R3 writes a job config that denies read, edit, bash, webfetch, websearch, question, subagent, and skill", async () => {
    const fixture = await buildFixture({
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
      diffs: ["d-01"],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.config, "the call got no job config").not.toBe("");
        let config: unknown = null;
        try {
          config = JSON.parse(call.config);
        } catch {
          config = null;
        }
        expect(config, `the job config is not JSON: ${call.config}`).not.toBeNull();
        const permission = (config as { permission?: Record<string, string> } | null)?.permission ?? {};
        const missing = DENY_TOOLS.filter((tool) => permission[tool] !== "deny");
        expect(missing.join(", "), `the job config does not deny: ${missing.join(", ")}`).toBe("");
      }
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R4 the route refusal", () => {
  it("R4 refuses a route that routes.json does not hold before any call", async () => {
    // The route of the run is not in the temp routes.json: the file holds
    // the plan route of the case, and the run names another route.
    const fixture = await buildFixture({
      route: UNKNOWN_ROUTE,
      routes: routesFile(ROUTE),
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(logEntries(fixture.logPath), "the fake log is not empty").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0]).toMatch(/route/);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R4 refuses a route whose kind is metered before any call", async () => {
    const fixture = await buildFixture({ route: METERED_ROUTE, kind: "metered" });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(logEntries(fixture.logPath), "the fake log is not empty").toEqual([]);
      expect(passRecords(fixture.privateDir), "the runner wrote a pass record").toEqual([]);
      const named = namedLines(result);
      expect(named, `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(named[0]).toMatch(/kind|metered/);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R5 the quota start rule", () => {
  it("R5 starts no pass at a window of 70 % and starts the pass at 69.9 %", async () => {
    const wait = await buildFixture({
      quotaPercent: 70,
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(wait, runArgs(wait));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(wait.logPath)), "the runner called the model at 70 %").toEqual([]);
      expect(filesHolding(wait.privateDir, "RAW-"), "the runner stored a raw output at 70 %").toEqual([]);
      const records = passRecords(wait.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("wait");
      expect(
        quotaRequests(wait).filter((path) => path.startsWith("/api/quota/")),
        "the runner read no quota through BENCH_QUOTA_BASE",
      ).not.toEqual([]);
    } finally {
      dropFixture(wait);
    }

    const ready = await buildFixture({
      quotaPercent: 69.9,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      const result = runRunner(ready, runArgs(ready));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(modelCalls(logEntries(ready.logPath)), "the runner started no pass at 69.9 %").toHaveLength(3);
    } finally {
      dropFixture(ready);
    }
  });
});

describe("P4 R6 the quota stop rule", () => {
  it("R6 stops the pass at 80 % and leaves the pass open with the two stored outputs", async () => {
    const fixture = await buildFixture({
      quotaStopPercent: 80,
      quotaStopAfter: 2,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      const records = passRecords(fixture.privateDir);
      expect(records, "the runner wrote no pass record").toHaveLength(1);
      expect(records[0].state).toBe("open");
      expect(records[0].outputs ?? [], "the pass record holds no stored output").toHaveLength(2);
      expect(completionMarkers(records[0]), "the pass record holds a complete marker").toEqual([]);
      expect(filesHolding(fixture.privateDir, "RAW-"), "the runner stored three raw outputs").toHaveLength(2);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R6 runs the pass to the end at 79 %", async () => {
    // The window starts at 69.9 %, so the pass starts (D15: a window of
    // 70 % at the start gives no pass). It rises to 79 % after the second
    // diff, and the pass still runs to the end: the stop rule fires at
    // 80 % only.
    const fixture = await buildFixture({
      quotaPercent: 69.9,
      quotaStopPercent: 79,
      quotaStopAfter: 2,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("complete");
      expect(filesHolding(fixture.privateDir, "RAW-")).toHaveLength(3);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R7 the transient retry", () => {
  it("R7 retries a transport error twice and completes the pass", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(fixture.logPath)), "the runner did not retry the diff").toHaveLength(3);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("complete");
    } finally {
      dropFixture(fixture);
    }
  });

  it("R7 leaves the pass open after three transport errors", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(fixture.logPath)), "the runner retried a fourth time").toHaveLength(3);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("open");
      expect(completionMarkers(records[0]), "the pass record holds a complete marker").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R8 the bad retry wait value", () => {
  for (const bad of ["NaN", "Infinity", "-1", "1e999"]) {
    it(`R8 ends the run inside the timeout with MG_RUN_RETRY_WAIT_MS=${bad}`, async () => {
      const fixture = await buildFixture({
        diffs: ["d-01"],
        calls: [
          { exit: 1, stderr: "provider: transport error" },
          { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        ],
      });
      try {
        assertRunnerExists();
        const started = Date.now();
        const result = runRunner(fixture, runArgs(fixture), { MG_RUN_RETRY_WAIT_MS: bad });
        const elapsed = Date.now() - started;
        expect(result.error, "the spawn hit the 20 s timeout").toBeUndefined();
        expect(elapsed, "the run did not end inside 20 s").toBeLessThan(20_000);
        if (result.status === 2) {
          expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
        } else {
          const records = passRecords(fixture.privateDir);
          expect(records).toHaveLength(1);
          expect(["complete", "open"]).toContain(records[0].state);
        }
      } finally {
        dropFixture(fixture);
      }
    });
  }
});

describe("P4 R9 the value scan", () => {
  it("R9 deletes a raw output that holds a credential value and stops the pass", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ value: JSON.stringify({ type: "result", text: SECRET }) }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(filesHolding(fixture.privateDir, SECRET), "the credential value stayed in the private folder").toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the credential value stayed in the repository").toEqual([]);
      expect(readFileSync(fixture.logPath, "utf8").includes(SECRET), "the credential value stayed in the log").toBe(false);
      const named = namedLines(result);
      expect(
        named.filter((line) => /value|scan|credential/i.test(line)),
        `the runner printed no named line: ${result.stdout}`,
      ).toHaveLength(1);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("open");
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R10 the large raw output", () => {
  it("R10 stores a 2 MiB raw output whole", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ stdout_bytes: TWO_MIB, value: "TAIL-MARKER" }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const stored = filesHolding(fixture.privateDir, "TAIL-MARKER");
      expect(stored, "the runner stored no raw output").toHaveLength(1);
      expect(statSync(stored[0]).size, "the raw output was cut").toBeGreaterThan(TWO_MIB - 1024);
    } finally {
      dropFixture(fixture);
    }
  });

  it("R10 finds a credential value in the last 1000 bytes of a 2 MiB raw output", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ stdout_bytes: TWO_MIB, value: SECRET }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(filesHolding(fixture.privateDir, SECRET), "the scan missed the tail value").toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the tail value stayed in the repository").toEqual([]);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("open");
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R11 the region rule", () => {
  it("R11 marks a Go route with the region error as region-blocked", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ exit: 1, stderr: REGION_ERROR }],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(fixture.logPath)), "the runner retried the region error").toHaveLength(1);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state).toBe("region-blocked");
      expect(records[0].rank ?? null, "the pass record holds a rank").toBeNull();
      const errors = (records[0].errors ?? []) as unknown[];
      expect(errors, "the pass record holds no stored error line").toHaveLength(1);
      expect(String(errors[0])).toContain("region");
      expect(filesHolding(fixture.privateDir, "RAW-"), "the runner stored a raw output").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R12 the trap of the job folder", () => {
  it("R12 stops the fake child, removes the job folder, and leaves no fake process", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ sleep: 30, value: "" }],
    });
    try {
      assertRunnerExists();
      const started = Date.now();
      const result = runRunner(fixture, runArgs(fixture), { MG_CALL_TIMEOUT_S: "2" });
      const elapsed = Date.now() - started;
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(elapsed, "the run did not end inside 15 s").toBeLessThan(15_000);
      const pids = readFileSync(fixture.pidPath, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => Number(line));
      expect(pids.length, "the fake wrote no pid").toBeGreaterThan(0);
      for (const pid of pids) {
        expect(await waitForDeath(pid), `the fake child ${pid} is still alive`).toBe(true);
      }
      const tmpDir = join(fixture.repo, ".tmp");
      const folders = existsSync(tmpDir)
        ? readdirSync(tmpDir).filter((name) => name.startsWith("opencode-host-"))
        : [];
      expect(folders, "a job folder stayed in the temp repo").toEqual([]);
      expect(liveFakeProcesses(), "a fake process is still alive").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R13 the no write rule", () => {
  it("R13 writes no file in the temp repo and no file under docs", async () => {
    const fixture = await buildFixture({
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const before = snapshotTree(fixture.repo, [".tmp"]);
      const docsBefore = snapshotTree(join(fixture.repo, "docs"));
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(snapshotTree(join(fixture.repo, "docs")), "the run wrote under docs").toEqual(docsBefore);
      expect(snapshotTree(fixture.repo, [".tmp"]), "the run wrote in the temp repo").toEqual(before);
      expect(filesHolding(fixture.privateDir, "RAW-").length, "the private folder holds no output").toBe(3);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R14 the call timeout", () => {
  it("R14 ends the call at MG_CALL_TIMEOUT_S", async () => {
    const fixture = await buildFixture({
      diffs: ["d-01"],
      calls: [{ sleep: 30, value: "" }],
    });
    try {
      assertRunnerExists();
      const started = Date.now();
      const result = runRunner(fixture, runArgs(fixture), { MG_CALL_TIMEOUT_S: "2" });
      const elapsed = Date.now() - started;
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(elapsed, "the call did not end inside 10 s").toBeLessThan(10_000);
      const records = passRecords(fixture.privateDir);
      expect(records).toHaveLength(1);
      expect(records[0].state, "the pass record is not open").not.toBe("complete");
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 R15 the path safety", () => {
  it("R15 refuses a set id with a slash and a route value with a parent segment", async () => {
    const cases: Array<[string, string[]]> = [
      ["set", ["--set", "../x"]],
      ["set", ["--set", "a/b"]],
      ["route", ["--route", "mega/../x"]],
    ];
    for (const [kind, override] of cases) {
      const fixture = await buildFixture({
        calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
        diffs: ["d-01"],
      });
      try {
        assertRunnerExists();
        const args = runArgs(fixture);
        const index = args.indexOf(override[0]);
        args.splice(index, 2, override[0], override[1]);
        const before = snapshotTree(fixture.repo, [".tmp"]);
        const result = runRunner(fixture, args);
        expect(result.status, `${kind} ${override[1]}: ${result.stdout}\n${result.stderr}`).toBe(2);
        const named = namedLines(result);
        expect(named, `${kind} ${override[1]}: no named line`).toHaveLength(1);
        expect(named[0]).toMatch(new RegExp(kind));
        expect(snapshotTree(fixture.repo, [".tmp"]), `${kind} ${override[1]}: the run wrote in the temp repo`).toEqual(before);
        expect(
          filesHolding(fixture.privateDir, "RAW-"),
          `${kind} ${override[1]}: the runner stored a raw output`,
        ).toEqual([]);
      } finally {
        dropFixture(fixture);
      }
    }
  });
});

describe("P4 the fake binary of every spawn", () => {
  it("resolves the opencode of the spawn to the fake and leaves no fake process", async () => {
    const fixture = await buildFixture({
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
      diffs: ["d-01"],
    });
    try {
      assertRunnerExists();
      const resolved = spawnSync("bash", ["-c", "command -v opencode"], {
        env: spawnEnv(fixture),
        encoding: "utf8",
      });
      const path = (resolved.stdout ?? "").trim();
      expect(path, "the spawn has no opencode on the PATH").not.toBe("");
      expect(path, "the resolved opencode is not the fake").toContain("fake-opencode");
      expect(path, "the resolved opencode is not in the temp tree").toContain(fixture.repo);
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.argv0, "the model call ran another binary").toContain("fake-opencode");
        expect(call.argv0, "the model call ran a binary outside the temp tree").toContain(fixture.repo);
      }
      expect(liveFakeProcesses(), "a fake process is still alive").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

// --- the check 4.9 fixes: F1 the one-pass rule, F2 the stopped read ------
//
// F1 (spec D15): "A route with no quota source runs at most 1 pass per
// night." The row of the committed `routes.json` says "no source" with
// `quota_source: null` and a non-empty `quota_provider` (`nvidia`), and
// `quota.ts` returns `ready` with the cap 1 for that row. The guard must
// key on the empty source, not on an empty provider.
//
// Refusal contract of F1. Spec D15 gives no exit code and no line. The
// runner's own refusal of a second run under the exclusive lock
// (`review-run.sh`, ADV-R-8) is exit 2 with one line on stderr, so the
// one-pass refusal follows it: exit 2, exactly one line on stderr that
// starts with `review-run:` and names the one-pass rule, an empty stdout,
// no call, and no second pass record.
//
// F2 (spec D15): a quota read that gives `stopped` before the first diff
// leaves the pass `open`, writes one record that holds the quota reason,
// and makes no call.

describe("P4 the check 4.9 fixes F1 and F2", () => {
  const NO_SOURCE_ROUTE = "nvidia/stepfun-ai/step-5-preview#high";
  const RUN_DATE = "2026-11-20";

  it("F1 a route with no quota source runs at most one pass per night, and the second run refuses before any call", async () => {
    const fixture = await buildFixture({
      route: NO_SOURCE_ROUTE,
      family: "StepFun",
      kind: "free",
      quotaProvider: "nvidia",
      quotaSource: null,
      calls: [
        { value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-04" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-05" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-06" }) },
      ],
    });
    try {
      assertRunnerExists();
      const args = [...runArgs(fixture), "--date", RUN_DATE];

      const first = runRunner(fixture, args);
      expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
      expect(modelCalls(logEntries(fixture.logPath)), "the first run made no call").toHaveLength(3);
      expect(passRecords(fixture.privateDir), "the first run wrote no pass record").toHaveLength(1);
      expect(
        quotaRequests(fixture),
        "a provider with no quota source sent a quota request",
      ).toEqual([]);

      const second = runRunner(fixture, args);
      expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(2);
      const errLines = (second.stderr ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
      expect(
        errLines,
        `the second run must print one line on stderr: ${second.stderr}`,
      ).toHaveLength(1);
      expect(errLines[0], "the refusal line must start with review-run:").toMatch(/^review-run:/);
      expect(errLines[0], "the refusal line must name the one-pass rule").toMatch(
        /one pass per night/,
      );
      expect(second.stdout, "the refusal line must not go to stdout").toBe("");
      expect(
        modelCalls(logEntries(fixture.logPath)),
        "the second run called the model",
      ).toHaveLength(3);
      expect(
        passRecords(fixture.privateDir),
        "the second run wrote a second pass record",
      ).toHaveLength(1);
    } finally {
      dropFixture(fixture);
    }
  });

  it("F2 a stopped quota read before the pass leaves the pass open with no call", async () => {
    const fixture = await buildFixture({
      calls: [{ value: JSON.stringify({ type: "result", text: "RAW-d-01" }) }],
    });
    try {
      assertRunnerExists();
      // A base with no listener gives the read failure of spec D15, so the
      // quota state is `stopped` before the first diff.
      const result = runRunner(fixture, runArgs(fixture), {
        BENCH_QUOTA_BASE: "http://127.0.0.1:1",
      });
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].state, "a stopped quota read must leave the pass open").toBe("open");
      expect(records[0].outputs ?? [], "no output may be stored").toEqual([]);
      const errors = (records[0].errors ?? []) as unknown[];
      expect(errors.length, "the record holds no quota reason").toBeGreaterThan(0);
      expect(String(errors[0]), "the record must name the quota reason").toContain("quota");
      expect(modelCalls(logEntries(fixture.logPath)), "the run called the model").toHaveLength(0);
      expect(filesHolding(fixture.privateDir, "RAW-"), "the run stored a raw output").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });
});

// --- task 4.9a: probe mode, the token log, and the new routes.json ------
//
// Probe mode (spec D14, "Probe mode (PM 2026-11-18)"). `review-run.sh
// --probe` makes exactly one model call on the first control diff of the
// set (a diff with no plant), writes no pass record and no stored raw
// output beyond the probe record, prints one line
// `<route> reachable|unreachable|region-blocked <error line or ->` on
// stdout, and gives exit 0 for `reachable`, exit 3 for `unreachable` or
// `region-blocked`, and exit 2 for a refusal. The probe uses the same
// lock, quota rules, job isolation, credential scan, and trap as a pass.
//
// Contracts this file pins where the spec is silent:
//   - The probe record lives in `<private>/probes/<set_id>/`. It holds
//     `set_id`, `route`, `date`, `state`, `tokens`, and `tokens_complete`,
//     and it names the diff of the call. The pass records stay in
//     `<private>/passes/`.
//   - A probe blocked by the quota rule (a window at 70 %) or by the
//     credential scan is a refusal: exit 2, one `review-run:` line on
//     stdout, and no pass record. A probe that finds the lock held follows
//     the lock refusal of `review-run.sh`: exit 2 and one `review-run:`
//     line on stderr.
//   - `unreachable` and `region-blocked` print the first line of the
//     error of the call after the state word.
//
// Token shape (spec D13, "Tokens (PM 2026-11-18)"). The fake emits one
// json event per call that holds tokens, in the shape of an
// `opencode run --format json` step-finish event:
//
//   {"type":"step-finish","tokens":{"input":10,"output":20,"reasoning":5,
//     "cache":{"read":100,"write":7}}}
//
// The record holds the flat sums, and `total` is the sum of the five
// components:
//
//   "tokens": {"input","output","reasoning","cache_read","cache_write",
//              "total"}
//
// Each entry of `diffs` holds its `id` and its own `tokens` object in the
// same shape. `tokens_complete` is `true` when every call held a token
// field and `false` when one call did not; a call with no token field
// adds 0.
//
// routes.json (spec D12, PM 2026-11-18): three routes leave the committed
// file, and the pilot routes stay.
//
// Every case keeps the orphan nets of the PM load watch, uses only the
// fake `opencode`, and never runs the real `opencode` CLI.

describe("P4 probe mode, the token log, and routes.json (task 4.9a)", () => {
  const PROBE_DATE = "2026-11-20";

  const TOKENS_A = { input: 10, output: 20, reasoning: 5, cache: { read: 100, write: 7 } };
  const TOKENS_B = { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } };
  const TOKENS_C = { input: 11, output: 12, reasoning: 13, cache: { read: 14, write: 15 } };
  const FLAT_A = { input: 10, output: 20, reasoning: 5, cache_read: 100, cache_write: 7, total: 142 };
  const FLAT_B = { input: 1, output: 2, reasoning: 3, cache_read: 4, cache_write: 5, total: 15 };
  const FLAT_C = { input: 11, output: 12, reasoning: 13, cache_read: 14, cache_write: 15, total: 65 };
  const ZERO_TOKENS = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, total: 0 };

  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((done) => {
      setTimeout(done, ms);
    });

  /** Waits until one check holds, or until the bound runs out. */
  async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (check()) return true;
      if (Date.now() >= deadline) return check();
      await sleep(50);
    }
  }

  function probeArgs(fixture: Fixture): string[] {
    return [...runArgs(fixture), "--probe", "--date", PROBE_DATE];
  }

  /** The keys of the temp set. `d-02` is the first control diff: it holds
   * no plant, and the two other diffs hold one each. */
  function writeControlKeys(fixture: Fixture): void {
    const keysDir = join(fixture.privateDir, "sets", fixture.setId, "keys");
    mkdirSync(keysDir, { recursive: true });
    for (const diff of fixture.diffs) {
      const plants = diff === "d-02"
        ? []
        : [
            {
              id: `P-${diff}`,
              new_lines: [3, 5],
              file: `src/${diff}.ts`,
              class: "C1",
              severity: "blocker",
              title: "planted",
              reason: "the test plant",
              witness: "witness",
              weight: 5,
            },
          ];
      writeFileSync(
        join(keysDir, `${diff}.json`),
        `${JSON.stringify(
          { schema: "model-guide-key/1", set_id: fixture.setId, diff_id: diff, plants },
          null,
          2,
        )}\n`,
      );
    }
  }

  /** The pass records of a run. They live under `passes/`; a probe record
   * lives under `probes/` and is not one. */
  function passRecordsOf(fixture: Fixture): Array<Record<string, unknown>> {
    return passRecords(join(fixture.privateDir, "passes"));
  }

  /** The probe records of a run: one json file under `probes/`. */
  function probeRecords(fixture: Fixture): Array<Record<string, any>> {
    return filesUnder(join(fixture.privateDir, "probes"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => JSON.parse(readFileSync(file, "utf8")));
  }

  it("P1 the probe calls the first control diff once, prints reachable, and writes a probe record with the tokens", async () => {
    const fixture = await buildFixture({
      calls: [{ tokens: TOKENS_A, value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout, "the probe prints one line").toBe(`${ROUTE} reachable -\n`);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls, "the probe must make exactly one call").toHaveLength(1);
      expect(calls[0].stdin, "the call must hold the first control diff").toContain("src/d-02");
      expect(calls[0].stdin, "the call must hold no other diff").not.toContain("src/d-01");
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
      const records = probeRecords(fixture);
      expect(records, "the probe wrote no probe record").toHaveLength(1);
      expect(records[0].state, "the state of the probe record").toBe("reachable");
      expect(JSON.stringify(records[0]), "the probe record must name the diff").toContain("d-02");
      expect(records[0].tokens, "the probe record holds the token sums").toEqual(FLAT_A);
      expect(records[0].tokens_complete, "every call held a token field").toBe(true);
      expect(
        filesHolding(fixture.privateDir, "PROBE-d-02"),
        "the probe stored a raw output",
      ).toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("P2 the probe prints unreachable with the error line and exits 3", async () => {
    const fixture = await buildFixture({
      calls: [
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
        { exit: 1, stderr: "provider: transport error" },
      ],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      const lines = stdoutLines(result);
      expect(lines, "the probe prints one line").toHaveLength(1);
      expect(
        lines[0].startsWith(`${ROUTE} unreachable `),
        `wrong probe line: ${lines[0]}`,
      ).toBe(true);
      expect(lines[0], "the line must hold the error line").toContain("transport error");
      expect(
        modelCalls(logEntries(fixture.logPath)).length,
        "the probe made no call",
      ).toBeGreaterThan(0);
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("P3 the probe prints region-blocked with the D22 error line and exits 3", async () => {
    const fixture = await buildFixture({
      calls: [
        { exit: 1, stderr: REGION_ERROR },
        { exit: 1, stderr: REGION_ERROR },
        { exit: 1, stderr: REGION_ERROR },
      ],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      const lines = stdoutLines(result);
      expect(lines, "the probe prints one line").toHaveLength(1);
      expect(
        lines[0].startsWith(`${ROUTE} region-blocked `),
        `wrong probe line: ${lines[0]}`,
      ).toBe(true);
      expect(lines[0], "the line must hold the region error").toContain("not available in your region");
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("P4 the probe refuses an unknown route and a metered route before any call", async () => {
    const unknownFixture = await buildFixture({
      route: UNKNOWN_ROUTE,
      routes: routesFile(ROUTE),
    });
    try {
      assertRunnerExists();
      const unknown = runRunner(unknownFixture, probeArgs(unknownFixture));
      expect(unknown.status, `${unknown.stdout}\n${unknown.stderr}`).toBe(2);
      const unknownNamed = namedLines(unknown);
      expect(unknownNamed, `the refusal must name the route: ${unknown.stdout}`).toHaveLength(1);
      expect(unknownNamed[0], "the refusal line must name the route").toMatch(/route/);
      expect(logEntries(unknownFixture.logPath), "the probe called the model").toEqual([]);
      expect(passRecordsOf(unknownFixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(unknownFixture);
    }

    const meteredFixture = await buildFixture({ route: METERED_ROUTE, kind: "metered" });
    try {
      const metered = runRunner(meteredFixture, probeArgs(meteredFixture));
      expect(metered.status, `${metered.stdout}\n${metered.stderr}`).toBe(2);
      const meteredNamed = namedLines(metered);
      expect(meteredNamed, `the refusal must name the kind: ${metered.stdout}`).toHaveLength(1);
      expect(meteredNamed[0], "the refusal line must name the metered kind").toMatch(/kind|metered/);
      expect(logEntries(meteredFixture.logPath), "the probe called the model").toEqual([]);
      expect(passRecordsOf(meteredFixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(meteredFixture);
    }
  });

  it("P5 the probe takes the lock of the route, the set, and the date", async () => {
    const fixture = await buildFixture({
      calls: [{ sleep: 30, value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeControlKeys(fixture);
    let holder: ChildProcess | null = null;
    let holderOut = "";
    let holderErr = "";
    try {
      assertRunnerExists();
      const child = spawn(
        "bash",
        [join(fixture.repo, "harness", "model-guide", "review-run.sh"), ...probeArgs(fixture)],
        { cwd: fixture.repo, env: spawnEnv(fixture), stdio: ["ignore", "pipe", "pipe"] },
      );
      holder = child;
      // The orphan net kills this child when a test stops before its
      // finally block, and the afterEach waits for its exit.
      startedServers.add(child);
      serverExits.add(
        new Promise<void>((done) => {
          child.once("close", () => done());
        }),
      );
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        holderOut += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        holderErr += chunk;
      });

      const lockDir = join(fixture.privateDir, ".locks");
      const hasLock = (): boolean =>
        existsSync(lockDir) &&
        readdirSync(lockDir).some((name) => name.endsWith(".lock"));
      const lockSeen = await waitFor(() => hasLock() || child.exitCode !== null, 10_000);
      expect(
        lockSeen && hasLock(),
        `the first probe took no lock (exit ${child.exitCode}, stdout=${holderOut}, stderr=${holderErr})`,
      ).toBe(true);
      expect(
        await waitFor(() => modelCalls(logEntries(fixture.logPath)).length >= 1, 10_000),
        "the first probe made no call",
      ).toBe(true);

      const second = runRunner(fixture, probeArgs(fixture));
      expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(2);
      const errLines = (second.stderr ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
      expect(
        errLines,
        `the second probe must print one line on stderr: ${second.stderr}`,
      ).toHaveLength(1);
      expect(errLines[0], "the line must start with review-run:").toMatch(/^review-run:/);
      expect(errLines[0], "the line must name the lock").toMatch(/lock/);
      expect(
        modelCalls(logEntries(fixture.logPath)),
        "the second probe called the model",
      ).toHaveLength(1);
      expect(passRecordsOf(fixture), "a probe wrote a pass record").toEqual([]);
    } finally {
      if (holder !== null) holder.kill("SIGKILL");
      dropFixture(fixture);
    }
  });

  it("P6 the probe obeys the 70 % quota rule and makes no call", async () => {
    const fixture = await buildFixture({
      quotaPercent: 70,
      calls: [{ tokens: TOKENS_A, value: JSON.stringify({ type: "result", text: "PROBE-d-02" }) }],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const lines = stdoutLines(result);
      expect(lines, `the probe must print one refusal line: ${result.stdout}`).toHaveLength(1);
      expect(lines[0], "the line must start with review-run:").toMatch(/^review-run:/);
      expect(lines[0], "the line must name the quota rule").toMatch(/quota/i);
      expect(
        modelCalls(logEntries(fixture.logPath)),
        "the probe called the model at 70 %",
      ).toEqual([]);
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("P7 the probe runs the credential scan and stores no value", async () => {
    const fixture = await buildFixture({
      calls: [{ value: JSON.stringify({ type: "result", text: SECRET }) }],
    });
    writeControlKeys(fixture);
    try {
      assertRunnerExists();
      const result = runRunner(fixture, probeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      const lines = stdoutLines(result);
      expect(lines, `the probe must print one refusal line: ${result.stdout}`).toHaveLength(1);
      expect(lines[0], "the line must start with review-run:").toMatch(/^review-run:/);
      expect(lines[0], "the line must name the credential scan").toMatch(/credential|value/i);
      expect(
        filesHolding(fixture.privateDir, SECRET),
        "the credential value stayed in the private folder",
      ).toEqual([]);
      expect(
        filesHolding(fixture.repo, SECRET),
        "the credential value stayed in the repository",
      ).toEqual([]);
      expect(
        readFileSync(fixture.logPath, "utf8").includes(SECRET),
        "the credential value stayed in the log",
      ).toBe(false);
      expect(passRecordsOf(fixture), "the probe wrote a pass record").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("T1 the pass record holds the token sums and each diff entry holds its own tokens", async () => {
    const fixture = await buildFixture({
      calls: [
        { tokens: TOKENS_A, value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { tokens: TOKENS_B, value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { tokens: TOKENS_C, value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens, "the token sums of the pass").toEqual({
        input: 22,
        output: 34,
        reasoning: 21,
        cache_read: 118,
        cache_write: 27,
        total: 222,
      });
      expect(records[0].tokens_complete, "every call held a token field").toBe(true);
      const diffs = records[0].diffs as any[];
      expect(Array.isArray(diffs), "the record must hold diff entries").toBe(true);
      expect(diffs.map((entry) => entry.id)).toEqual(["d-01", "d-02", "d-03"]);
      expect(diffs[0].tokens, "the tokens of d-01").toEqual(FLAT_A);
      expect(diffs[1].tokens, "the tokens of d-02").toEqual(FLAT_B);
      expect(diffs[2].tokens, "the tokens of d-03").toEqual(FLAT_C);
    } finally {
      dropFixture(fixture);
    }
  });

  it("T2 a call with no token field adds 0 and sets tokens_complete false", async () => {
    const fixture = await buildFixture({
      calls: [
        { tokens: TOKENS_A, value: JSON.stringify({ type: "result", text: "RAW-d-01" }) },
        { value: JSON.stringify({ type: "result", text: "RAW-d-02" }) },
        { tokens: TOKENS_C, value: JSON.stringify({ type: "result", text: "RAW-d-03" }) },
      ],
    });
    try {
      assertRunnerExists();
      const result = runRunner(fixture, runArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const records = passRecords(fixture.privateDir);
      expect(records, "the run wrote no pass record").toHaveLength(1);
      expect(records[0].tokens, "the call without tokens adds 0").toEqual({
        input: 21,
        output: 32,
        reasoning: 18,
        cache_read: 114,
        cache_write: 22,
        total: 207,
      });
      expect(records[0].tokens_complete, "one call held no token field").toBe(false);
      const diffs = records[0].diffs as any[];
      expect(diffs.map((entry) => entry.id)).toEqual(["d-01", "d-02", "d-03"]);
      expect(diffs[1].tokens, "the call without tokens adds zero").toEqual(ZERO_TOKENS);
    } finally {
      dropFixture(fixture);
    }
  });

  it("J1 the committed routes.json holds none of the three removed routes and holds the pilot routes", () => {
    const file = join(HARNESS, "model-guide", "routes.json");
    expect(existsSync(file), `routes.json is missing: ${file}`).toBe(true);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const rows = Array.isArray(doc) ? doc : (doc.routes ?? []);
    const routes = rows.map((row: { route?: unknown }) => row.route);
    const gone = [
      "kimi-code-plan-cn/kimi-for-coding#high",
      "bailian-token-plan/glm-5.3#high",
      "nvidia/stepfun-ai/step-5-preview#high",
    ];
    for (const route of gone) {
      expect(routes, `${route} must leave routes.json (spec D12, PM 2026-11-18)`).not.toContain(
        route,
      );
    }
    const kept = [
      "opencode/hy4-flash-free",
      "opencode-go/deepseek-v4.1-flash",
      "opencode-go/mimo-v2.6-flash",
    ];
    for (const route of kept) {
      expect(routes, `${route} must stay in routes.json`).toContain(route);
    }
  });
});
