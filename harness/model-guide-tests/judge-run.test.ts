/**
 * The judge runner of task 4.13a (spec D11; plan task 4.13).
 *
 * The runner under test is `harness/model-guide/judge-run.sh`. It does not
 * exist yet, so every case of this file fails at the role base. The file
 * stays red until the Green task that writes the runner.
 *
 * The contract of this file, which the Green task implements:
 *
 *   Usage:
 *     harness/model-guide/judge-run.sh --set <set_id> --route <route> \
 *       --judge a|b [--private <dir>] [--start-test]
 *
 *   - `--set`, `--route`, and `--judge` are required. `--private` defaults
 *     to `$HOME/.local/share/lending-desk-bench/model-guide`, the default of
 *     `review-run.sh`.
 *   - Exit 2 is a refusal: one line `judge-run: <check>` on stdout, no model
 *     call, and no judge file.
 *   - The input is `<private>/sets/<set_id>/adjudication/queue.json`.
 *   - One model call per group of the queue. A group is one diff, one file,
 *     one 3-line window, and the claims of every route.
 *   - The prompt of a call holds the seeded diff of the group
 *     (`<private>/sets/<set_id>/diffs/<diff_id>.diff`) and the items of the
 *     group. It holds no route name, no slug of the route, and no text of any
 *     judge file. The second judge never reads the verdicts of the first
 *     judge, and neither judge sees a route name (spec D11).
 *   - The answer of the model is the last fenced json block that is a flat
 *     object. Only the ids of the group with a value of `real-defect`,
 *     `false-claim`, or `unclear` are kept. Any other id and any other value
 *     are dropped. A group with no valid block adds no verdict.
 *   - The output is `<private>/sets/<set_id>/adjudication/judge-<a|b>.json`,
 *     the flat map that `adjudicate.ts apply` reads, and the run record
 *     `<private>/sets/<set_id>/adjudication/judge-<a|b>-run.json`.
 *   - The run record holds `set_id`, `judge`, `route`, `date`, `state`
 *     (`complete` or `open`), `groups` (each with an `id`, a `state`, and a
 *     `tokens` object), `judged_by` (the finding id to the route that judged
 *     it), `tokens`, and `tokens_complete`.
 *   - `--start-test` makes exactly one call on a fixed built-in sample group
 *     and no set data. It prints `<route> ready|not-ready <error line or ->`
 *     and writes no judge file.
 *   - The safety rules of `review-run.sh` hold: the job folder of
 *     `opencode_host_begin`, the call
 *     `run --standalone --format json --model <route>`, the job config that
 *     denies every tool, the credential value scan, the flock lock of one
 *     set, one judge, and one date, the quota rules of spec D15, the watcher
 *     of the call, and the token log of the `step-finish` events.
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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(HARNESS, "..");

/** The module under test. Its path is fixed, so a gate cannot point the test
 * at a file outside the repository. */
const RUNNER_SOURCE = join(HARNESS, "model-guide", "judge-run.sh");
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

/** The judge route of the cases. It is outside the ranked families of spec
 * D12 (assumption A4-2 of the test strategy), and its text is distinctive,
 * so the "no route name in the prompt" check cannot pass by chance. */
const ROUTE = "bailian-token-plan/qwen3.8-max#high";
/** The slug of the route, as `review-run.sh` builds it. */
const ROUTE_SLUG = "bailian-token-plan-qwen3.8-max-high";

const SET_ID = "mg-judge-set";

/** The quota provider of the judge route. It has a quota source, so the
 * quota server of the case answers it. */
const QUOTA_PROVIDER = "opencode-go";

// --- the PM load watch: this file leaves no server and no temp folder ----
/** The quota servers and the holder children this file started. */
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

interface ItemSpec {
  id: string;
  line: number;
  claim: { class: string; severity: string; title: string; reason: string };
}

interface GroupSpec {
  id: string;
  diff_id: string;
  file: string;
  window: [number, number];
  items: ItemSpec[];
}

interface Scenario {
  route?: string;
  kind?: string;
  quotaProvider?: string | null;
  quotaSource?: string | null;
  calls?: CallSpec[];
  quotaPercent?: number;
  quotaStopPercent?: number;
  quotaStopAfter?: number;
  /** The week value of the fake quota server. It defaults to quotaPercent. */
  quotaWeek?: number;
  /** The week value after quotaStopAfter model calls. It defaults to
   * quotaStopPercent. It lets the week rise while 5h stays low. */
  quotaStopWeek?: number;
  /** The groups of the queue. An empty list writes an empty queue. */
  groups?: GroupSpec[];
  /** When true, the case holds no queue file at all. */
  queueMissing?: boolean;
  /** When true, the private folder is the default one of `review-run.sh`. */
  defaultPrivate?: boolean;
  /** A judge file that the case plants before the run. */
  plantedJudgeFile?: { judge: "a" | "b"; text: string };
  /** The judge routes of the temp `judges.json` (spec D11). When absent,
   * the fixture writes one entry for the fixture route, so every earlier
   * case reads its route from `judges.json`. */
  judgesRoutes?: Array<{ route: string; quota_provider: string | null; quota_source: string | null }>;
  /** When true, the case writes no temp `judges.json` at all. Only J17
   * uses it, to pin that a route from `routes.json` is refused without it. */
  judgesMissing?: boolean;
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
  groups: GroupSpec[];
  quotaBase: string;
  runCounter: number;
  close: () => void;
}

/** The runner is the module under test. Its absence is the Red reason. */
function assertRunnerExists(): void {
  expect(
    existsSync(RUNNER_SOURCE),
    `the judge runner is missing: ${RUNNER_SOURCE}`,
  ).toBe(true);
}

/** The first group of the queue: two claims of one file and one window. */
const GROUP_ONE: GroupSpec = {
  id: "d-01#G1",
  diff_id: "d-01",
  file: "src/d-01.ts",
  window: [4107, 4109],
  items: [
    {
      id: "d-01#C0a1b2c3d4e5f",
      line: 4107,
      claim: {
        class: "C1",
        severity: "major",
        title: "CLAIM-TITLE-ALPHA",
        reason: "CLAIM-REASON-ALPHA",
      },
    },
    {
      id: "d-01#C1f2e3d4c5b6a",
      line: 4108,
      claim: {
        class: "C2",
        severity: "minor",
        title: "CLAIM-TITLE-BETA",
        reason: "CLAIM-REASON-BETA",
      },
    },
  ],
};

/** The second group of the queue: one claim of another file. */
const GROUP_TWO: GroupSpec = {
  id: "d-02#G2",
  diff_id: "d-02",
  file: "src/d-02.ts",
  window: [5223, 5225],
  items: [
    {
      id: "d-02#C2a3b4c5d6e7f",
      line: 5223,
      claim: {
        class: "C3",
        severity: "blocker",
        title: "CLAIM-TITLE-GAMMA",
        reason: "CLAIM-REASON-GAMMA",
      },
    },
  ],
};

/** One synthetic diff of the set. */
function diffText(id: string): string {
  return [
    `--- a/src/${id}.ts`,
    `+++ b/src/${id}.ts`,
    "@@ -4100,7 +4100,7 @@",
    " export const value = 1;",
    "-export const other = 2;",
    "+export const other = 3;",
    " export const third = 4;",
    "",
  ].join("\n");
}

/** The text of `diffs/<id>.diff`: the seeded diff of spec D7. It holds the
 * marker `SEEDED-<id>`. */
function seededDiffText(id: string): string {
  return `${diffText(id)}+// SEEDED-${id} the seeded line of the diff\n`;
}

/** The text of `src/<id>.diff`: the source diff, without the plants. It holds
 * the marker `SRC-ONLY-<id>`. */
function sourceDiffText(id: string): string {
  return `${diffText(id)}+// SRC-ONLY-${id} the source line of the diff\n`;
}

/** One fenced json block of an answer. */
function jsonBlock(body: string): string {
  return "```json\n" + body + "\n```";
}

/** The answer text of a model call: prose and fenced json blocks. */
function answer(blocks: string[]): string {
  return ["The answer of the judge.", ...blocks].join("\n");
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

/** The named lines of the runner on stdout. */
function namedLines(result: { stdout: string | null }): string[] {
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^judge-run/.test(line));
}

/** The stdout lines of the runner. */
function stdoutLines(result: { stdout: string | null }): string[] {
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The stderr lines of the runner. */
function stderrLines(result: { stderr: string | null }): string[] {
  return (result.stderr ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
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
const weekText = process.env.QUOTA_WEEK || "";
const weekStart = weekText === "" ? percent : Number(weekText);
const stopWeekText = process.env.QUOTA_STOP_WEEK || "";

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
  let fiveH = percent;
  let day = percent;
  let week = weekStart;
  if (modelCalls() >= stopAfter && (stopPercent !== null || stopWeekText !== "")) {
    if (stopPercent !== null) {
      fiveH = stopPercent;
      day = stopPercent;
      week = stopPercent;
    }
    if (stopWeekText !== "") week = Number(stopWeekText);
  }
  // The opencode-go source serves the real window set of the live
  // endpoint (task 4.13i): "5h", "weekly", "monthly", and a null
  // "credits_balance". Every other source keeps "5h", "day", "week",
  // so the kimi cases pin the 70 % rule on the old names.
  const live = url.indexOf("/opencode-go") !== -1;
  const body = live
    ? JSON.stringify({
      usage: {
        windows: {
          "5h": { usedPercent: fiveH },
          weekly: { usedPercent: week },
          monthly: { usedPercent: day },
          credits_balance: { usedPercent: null },
        },
      },
    })
    : JSON.stringify({
      usage: {
        windows: {
          "5h": { usedPercent: fiveH },
          day: { usedPercent: day },
          week: { usedPercent: week },
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

/** The routes file of a temp repo: the judge route of the case, and the
 * metered route of the refusal case. */
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
      family: options.family ?? "Judge family",
      route,
      kind: options.kind ?? "plan",
      quota_provider: options.quotaProvider ?? QUOTA_PROVIDER,
      quota_source: options.quotaSource === undefined ? QUOTA_PROVIDER : options.quotaSource,
      ranked: false,
    },
    {
      family: "DeepSeek Flash",
      route: "deepseek/deepseek-flash#high",
      kind: "metered",
      quota_provider: "deepseek",
      quota_source: null,
      ranked: false,
    },
  ];
}

/** Builds the temp repo, the private folder, the fake, and the quota server. */
async function buildFixture(scenario: Scenario = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "mg-judge-run-"));
  const fakeRoot = mkdtempSync(join(tmpdir(), "mg-judge-fake-"));
  tempRoots.add(root);
  tempRoots.add(fakeRoot);
  const repo = join(root, "repo");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const guideDir = join(repo, "harness", "model-guide");
  const binDir = join(repo, "bin");
  const fakeDir = join(binDir, "fake-opencode.d");
  const fakePath = join(binDir, "fake-opencode");
  const logPath = join(fakeRoot, "opencode.log");
  const specPath = join(fakeRoot, "opencode-spec.json");
  const pidPath = join(fakeRoot, "opencode-pids.txt");

  for (const dir of [guideDir, binDir, fakeDir, home, tmp]) {
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(join(repo, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(repo, "docs", "assets", "data"), { recursive: true });

  // The scripts that the runner runs sit in the temp repo, so the runner
  // never touches the real repository.
  copyIfPresent(RUNNER_SOURCE, join(guideDir, "judge-run.sh"), 0o755);
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

  // The routes of the temp repo.
  const route = scenario.route ?? ROUTE;
  const routes = routesFile(route, {
    kind: scenario.kind,
    quotaProvider: scenario.quotaProvider,
    quotaSource: scenario.quotaSource,
  });
  writeFileSync(join(guideDir, "routes.json"), `${JSON.stringify(routes, null, 2)}\n`);
  // Spec D11: judge-run.sh accepts a route only from `judges.json`. The
  // fixture always writes one, holding the fixture route, so every earlier
  // case reads its route from it. Only J17 sets `judgesMissing`.
  if (scenario.judgesMissing !== true) {
    const judges = scenario.judgesRoutes ?? [
      {
        route,
        quota_provider: scenario.quotaProvider ?? QUOTA_PROVIDER,
        quota_source: scenario.quotaSource === undefined ? QUOTA_PROVIDER : scenario.quotaSource,
      },
    ];
    writeFileSync(join(guideDir, "judges.json"), `${JSON.stringify(judges, null, 2)}\n`);
  }

  // A synthetic docs tree. It must stay byte-identical.
  writeFileSync(join(repo, "docs", "index.html"), "<!doctype html>\n<title>Index</title>\n");
  writeFileSync(join(repo, "docs", "assets", "css", "site.css"), "body { color: #222; }\n");
  writeFileSync(join(repo, "docs", "assets", "data", "benchmark.json"), '{"runs":0}\n');

  // The private folder. The default private folder is the one of
  // `review-run.sh`.
  const privateDir = scenario.defaultPrivate
    ? join(home, ".local", "share", "lending-desk-bench", "model-guide")
    : join(root, "private");
  mkdirSync(privateDir, { recursive: true });

  const setId = SET_ID;
  const groups = scenario.groups ?? [GROUP_ONE, GROUP_TWO];
  const setDir = join(privateDir, "sets", setId);
  const diffDir = join(setDir, "diffs");
  const srcDir = join(setDir, "src");
  const adjudicationDir = join(setDir, "adjudication");
  for (const dir of [diffDir, srcDir, adjudicationDir]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const diff of ["d-01", "d-02"]) {
    writeFileSync(join(diffDir, `${diff}.diff`), seededDiffText(diff));
    writeFileSync(join(srcDir, `${diff}.diff`), sourceDiffText(diff));
  }
  if (scenario.queueMissing !== true) {
    writeFileSync(
      join(adjudicationDir, "queue.json"),
      `${JSON.stringify({ set_id: setId, groups }, null, 2)}\n`,
    );
  }
  if (scenario.plantedJudgeFile !== undefined) {
    writeFileSync(
      join(adjudicationDir, `judge-${scenario.plantedJudgeFile.judge}.json`),
      scenario.plantedJudgeFile.text,
    );
  }

  // The spec of the fake.
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
              access: SECRET,
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
  const requestPath = join(fakeRoot, "quota-requests.txt");
  const serverPath = join(fakeRoot, "quota-server.js");
  writeFileSync(serverPath, QUOTA_SERVER_SOURCE);
  const percent = scenario.quotaPercent ?? 10;
  const stopPercent = scenario.quotaStopPercent;
  const stopAfter = scenario.quotaStopAfter ?? 2;
  const week = scenario.quotaWeek;
  const stopWeek = scenario.quotaStopWeek;
  const server = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      QUOTA_LOG: logPath,
      QUOTA_PERCENT: String(percent),
      QUOTA_STOP_PERCENT: stopPercent === undefined ? "" : String(stopPercent),
      QUOTA_STOP_AFTER: String(stopAfter),
      QUOTA_WEEK: week === undefined ? "" : String(week),
      QUOTA_STOP_WEEK: stopWeek === undefined ? "" : String(stopWeek),
      QUOTA_REQUEST_LOG: requestPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
    groups,
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
function runJudge(
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
      [join(fixture.repo, "harness", "model-guide", "judge-run.sh"), ...args],
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

/** The args of one judge run. */
function judgeArgs(fixture: Fixture, judge: "a" | "b" = "a"): string[] {
  return [
    "--set",
    fixture.setId,
    "--route",
    fixture.route,
    "--judge",
    judge,
    "--private",
    fixture.privateDir,
  ];
}

/** The judge file of a run: the flat map that `adjudicate.ts apply` reads. */
function judgeFile(fixture: Fixture, judge: "a" | "b"): Record<string, string> | null {
  const path = join(
    fixture.privateDir,
    "sets",
    fixture.setId,
    "adjudication",
    `judge-${judge}.json`,
  );
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The run record of a run. */
function runRecord(fixture: Fixture, judge: "a" | "b"): Record<string, any> | null {
  const path = join(
    fixture.privateDir,
    "sets",
    fixture.setId,
    "adjudication",
    `judge-${judge}-run.json`,
  );
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The number of the model calls that the fake has counted. The counter
 * file of the fake sits next to its spec file. The case reads it, so a second
 * call never takes the entry of the first one. */
function callCounter(fixture: Fixture): number {
  const path = `${fixture.specPath}.calls`;
  if (!existsSync(path)) return 0;
  const value = Number(readFileSync(path, "utf8").trim());
  return Number.isFinite(value) ? value : 0;
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

/** The job folders that the run left under the temp repo. */
function jobFolders(fixture: Fixture): string[] {
  const dir = join(fixture.repo, ".tmp");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("opencode-host-"))
    .sort();
}

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
    await sleep(50);
  }
  return !isAlive(pid);
}

/** The token shape of the fake `opencode` (spec D13, Tokens). */
const TOKENS_A = { input: 10, output: 20, reasoning: 5, cache: { read: 100, write: 7 } };
const TOKENS_B = { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } };
const FLAT_A = { input: 10, output: 20, reasoning: 5, cache_read: 100, cache_write: 7, total: 142 };
const FLAT_B = { input: 1, output: 2, reasoning: 3, cache_read: 4, cache_write: 5, total: 15 };
const SUM_TOKENS = {
  input: 11,
  output: 22,
  reasoning: 8,
  cache_read: 104,
  cache_write: 12,
  total: 157,
};

describe("P4 J1 the judge runner calls one model per group and writes the two files", () => {
  it("J1 calls the fake once for each group, writes the judge file and the run record, and writes nothing in the repository", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const before = snapshotTree(fixture.repo, [".tmp"]);
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls, "the runner made no call for each group").toHaveLength(2);
      const judge = judgeFile(fixture, "a");
      expect(judge, "the runner wrote no judge file").not.toBeNull();
      expect(judge).toEqual({
        "d-01#C0a1b2c3d4e5f": "real-defect",
        "d-02#C2a3b4c5d6e7f": "false-claim",
      });
      const record = runRecord(fixture, "a");
      expect(record, "the runner wrote no run record").not.toBeNull();
      expect(snapshotTree(fixture.repo, [".tmp"]), "the runner wrote a file in the repository").toEqual(before);
    } finally {
      dropFixture(fixture);
    }
  });

  it("J1b uses the default private folder of review-run.sh when no --private flag is given", async () => {
    const fixture = await buildFixture({
      defaultPrivate: true,
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, [
        "--set",
        fixture.setId,
        "--route",
        fixture.route,
        "--judge",
        "a",
      ]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(
        judgeFile(fixture, "a"),
        "the runner wrote no judge file in the default private folder",
      ).toEqual({
        "d-01#C0a1b2c3d4e5f": "real-defect",
        "d-02#C2a3b4c5d6e7f": "false-claim",
      });
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 J2 the job isolation of the judge call", () => {
  it("J2 calls run --standalone --format json --model <route> in the job folder of opencode_host_begin with a job config that denies every tool", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.argv).toBe(`run --standalone --format json --model ${ROUTE}`);
        expect(call.job, "the call ran outside a job folder").toMatch(/opencode-host-/);
        expect(
          call.job.startsWith(fixture.repo),
          `the job folder is outside the temp repo: ${call.job}`,
        ).toBe(true);
        expect(call.config, "the call got no job config").not.toBe("");
        let config: any = null;
        try {
          config = JSON.parse(call.config);
        } catch {
          config = null;
        }
        expect(config, "the job config is not json").not.toBeNull();
        for (const tool of DENY_TOOLS) {
          expect(
            config.permission?.[tool],
            `the job config does not deny ${tool}: ${call.config}`,
          ).toBe("deny");
        }
      }
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 J3 the prompt of a judge call", () => {
  it("J3 holds the seeded diff of the group and its items, and no route name and no slug", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls, "the runner made no call for each group").toHaveLength(2);

      const first = calls[0].stdin;
      expect(first, "the call of the first group holds no seeded diff").toContain("SEEDED-d-01");
      expect(first, "the call of the first group holds the diff of the second group").not.toContain(
        "SEEDED-d-02",
      );
      expect(first, "the call of the first group holds no item id").toContain("d-01#C0a1b2c3d4e5f");
      expect(first, "the call of the first group holds no second item id").toContain(
        "d-01#C1f2e3d4c5b6a",
      );
      expect(first, "the call of the first group holds no item of the second group").not.toContain(
        "d-02#C2a3b4c5d6e7f",
      );
      expect(first, "the call of the first group holds no line of the item").toContain("4107");
      expect(first, "the call of the first group holds no title of the claim").toContain(
        "CLAIM-TITLE-ALPHA",
      );
      expect(first, "the call of the first group holds no reason of the claim").toContain(
        "CLAIM-REASON-ALPHA",
      );

      const second = calls[1].stdin;
      expect(second, "the call of the second group holds no seeded diff").toContain("SEEDED-d-02");
      expect(second, "the call of the second group holds the diff of the first group").not.toContain(
        "SEEDED-d-01",
      );
      expect(second, "the call of the second group holds no item id").toContain("d-02#C2a3b4c5d6e7f");

      for (const call of calls) {
        expect(call.stdin, "the prompt holds the route name").not.toContain(ROUTE);
        expect(call.stdin, "the prompt holds the slug of the route").not.toContain(ROUTE_SLUG);
        expect(call.stdin, "the prompt holds the provider of the route").not.toContain(
          "bailian-token-plan",
        );
      }
    } finally {
      dropFixture(fixture);
    }
  });

  it("J4 the prompt of the second judge holds no text of the judge file of the first judge", async () => {
    const planted = `${JSON.stringify(
      {
        "JUDGE-A-ONLY-MARKER": "unclear",
        "d-01#C0a1b2c3d4e5f": "real-defect",
      },
      null,
      2,
    )}\n`;
    const fixture = await buildFixture({
      plantedJudgeFile: { judge: "a", text: planted },
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture, "b"));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.stdin, "the prompt of the second judge holds a text of the judge file").not.toContain(
          "JUDGE-A-ONLY-MARKER",
        );
        expect(
          call.stdin,
          "the prompt of the second judge holds a verdict of the first judge",
        ).not.toMatch(/"d-01#C0a1b2c3d4e5f"\s*:\s*"real-defect"/);
        expect(call.stdin, "the prompt of the second judge holds the route name").not.toContain(ROUTE);
      }
      expect(
        judgeFile(fixture, "b"),
        "the runner wrote no judge file for the second judge",
      ).not.toBeNull();
      expect(
        judgeFile(fixture, "a"),
        "the runner overwrote the judge file of the first judge",
      ).toEqual({ "JUDGE-A-ONLY-MARKER": "unclear", "d-01#C0a1b2c3d4e5f": "real-defect" });
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 J5 the verdict parsing of a judge call", () => {
  it("J5 keeps the last flat json block and drops the ids of another group and the values outside the three verdicts", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([
            jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "false-claim" })),
            jsonBlock(
              JSON.stringify({
                "d-01#C0a1b2c3d4e5f": "real-defect",
                "d-01#C1f2e3d4c5b6a": "unclear",
                "d-02#C2a3b4c5d6e7f": "real-defect",
                "d-01#C9z9z9z9z9z9z": "real-defect",
                "d-01#C8y8y8y8y8y8y": "not-a-verdict",
              }),
            ),
          ]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(judgeFile(fixture, "a"), "the runner wrote no judge file").toEqual({
        "d-01#C0a1b2c3d4e5f": "real-defect",
        "d-01#C1f2e3d4c5b6a": "unclear",
        "d-02#C2a3b4c5d6e7f": "false-claim",
      });
    } finally {
      dropFixture(fixture);
    }
  });

  it("J6 adds no verdict for a group whose answer holds no valid json block", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify(["d-02#C2a3b4c5d6e7f"]))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const judge = judgeFile(fixture, "a");
      expect(judge, "the runner wrote no judge file").not.toBeNull();
      expect(judge, "the judge file holds a verdict of the group without a valid block").not.toHaveProperty(
        "d-02#C2a3b4c5d6e7f",
      );
      expect(Object.keys(judge ?? {}), "the judge file holds no verdict of the first group").toEqual([
        "d-01#C0a1b2c3d4e5f",
      ]);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 J7 the run record of a judge run", () => {
  it("J7 holds the set id, the judge, the route, the date, the state, the groups, the judged_by map, the tokens, and the tokens flag", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const record = runRecord(fixture, "a");
      expect(record, "the runner wrote no run record").not.toBeNull();
      expect(record?.set_id).toBe(SET_ID);
      expect(record?.judge).toBe("a");
      expect(record?.route).toBe(ROUTE);
      expect(String(record?.date), "the date of the run record").toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record?.state, "the state of the run record").toBe("complete");
      expect(Array.isArray(record?.groups), "the run record holds no groups").toBe(true);
      const groups = record?.groups ?? [];
      expect(groups.map((group: any) => group.id).sort()).toEqual(["d-01#G1", "d-02#G2"]);
      for (const group of groups) {
        expect(typeof group.state, `the group ${group.id} holds no state`).toBe("string");
        expect(["complete", "open"]).toContain(group.state);
      }
      const first = groups.find((group: any) => group.id === "d-01#G1");
      expect(first?.tokens, "the group d-01#G1 holds no tokens").toEqual(FLAT_A);
      expect(record?.judged_by, "the run record holds no judged_by map").toBeTruthy();
      expect(record?.judged_by?.["d-01#C0a1b2c3d4e5f"]).toBe(ROUTE);
      expect(record?.judged_by?.["d-02#C2a3b4c5d6e7f"]).toBe(ROUTE);
      expect(record?.tokens, "the token sums of the run record").toEqual(SUM_TOKENS);
      expect(record?.tokens_complete, "every call held a token field").toBe(true);
    } finally {
      dropFixture(fixture);
    }
  });

  it("J8 a call with no token field adds 0 and sets tokens_complete false", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const record = runRecord(fixture, "a");
      expect(record, "the runner wrote no run record").not.toBeNull();
      expect(record?.tokens, "the token sums of the run record").toEqual({
        input: 10,
        output: 20,
        reasoning: 5,
        cache_read: 100,
        cache_write: 7,
        total: 142,
      });
      expect(record?.tokens_complete, "every call held a token field").toBe(false);
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 J9 the refusals of the judge runner", () => {
  it("J9 refuses a missing queue, an empty queue, and a bad judge value with exit 2, one named line, no call, and no file", async () => {
    const missing = await buildFixture({
      queueMissing: true,
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(missing, judgeArgs(missing));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(missing.logPath)), "the runner called the model").toEqual([]);
      expect(judgeFile(missing, "a"), "the runner wrote a judge file").toBeNull();
      expect(runRecord(missing, "a"), "the runner wrote a run record").toBeNull();
    } finally {
      dropFixture(missing);
    }

    const empty = await buildFixture({
      groups: [],
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(empty, judgeArgs(empty));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(empty.logPath)), "the runner called the model").toEqual([]);
      expect(judgeFile(empty, "a"), "the runner wrote a judge file").toBeNull();
      expect(runRecord(empty, "a"), "the runner wrote a run record").toBeNull();
    } finally {
      dropFixture(empty);
    }

    const badJudge = await buildFixture({
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(badJudge, [
        "--set",
        badJudge.setId,
        "--route",
        badJudge.route,
        "--judge",
        "c",
        "--private",
        badJudge.privateDir,
      ]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(badJudge.logPath)), "the runner called the model").toEqual([]);
      expect(judgeFile(badJudge, "a"), "the runner wrote a judge file").toBeNull();
      expect(runRecord(badJudge, "a"), "the runner wrote a run record").toBeNull();
    } finally {
      dropFixture(badJudge);
    }
  });
});

describe("P4 J10 the lock of the judge runner", () => {
  it("J10 refuses a second run of the same set, judge, and date with exit 2, one line on stderr, and no call", async () => {
    const fixture = await buildFixture({
      calls: [
        { sleep: 30, value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]) },
        { value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]) },
        { value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]) },
        { value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]) },
      ],
    });
    let holder: ChildProcess | null = null;
    let holderOut = "";
    let holderErr = "";
    try {
      assertRunnerExists();
      const child = spawn(
        "bash",
        [join(fixture.repo, "harness", "model-guide", "judge-run.sh"), ...judgeArgs(fixture)],
        { cwd: fixture.repo, env: spawnEnv(fixture), stdio: ["ignore", "pipe", "pipe"] },
      );
      holder = child;
      // The orphan net kills this child when a test stops before its finally
      // block, and the afterEach waits for its exit.
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

      // The lock of the first run is taken before its first call, so the call
      // of the first run proves that the lock is held.
      const firstCall = await waitFor(
        () => modelCalls(logEntries(fixture.logPath)).length >= 1 && callCounter(fixture) >= 1,
        15_000,
      );
      expect(
        firstCall,
        `the first run made no call (exit ${child.exitCode}, stdout=${holderOut}, stderr=${holderErr})`,
      ).toBe(true);

      const second = runJudge(fixture, judgeArgs(fixture));
      expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(2);
      const errLines = stderrLines(second);
      expect(
        errLines,
        `the second run must print one line on stderr: ${second.stderr}`,
      ).toHaveLength(1);
      expect(errLines[0], "the line must start with judge-run:").toMatch(/^judge-run:/);
      expect(errLines[0], "the line must name the lock").toMatch(/lock/);
      expect(
        modelCalls(logEntries(fixture.logPath)),
        "the second run called the model",
      ).toHaveLength(1);

      // The lock is per set, judge, and date: the other judge of the same
      // set is not refused by it.
      const other = runJudge(fixture, judgeArgs(fixture, "b"));
      const otherLines = [...stdoutLines(other), ...stderrLines(other)];
      expect(
        otherLines.filter((line) => /lock/i.test(line)),
        `the lock refused the other judge: ${other.stdout}${other.stderr}`,
      ).toEqual([]);
      expect(
        modelCalls(logEntries(fixture.logPath)).length,
        "the other judge made no call",
      ).toBeGreaterThan(1);
    } finally {
      if (holder !== null) {
        holder.kill("SIGTERM");
        await waitFor(() => holder?.exitCode !== null, 5_000);
        if (holder.exitCode === null) holder.kill("SIGKILL");
      }
      dropFixture(fixture);
    }
  });
});

describe("P4 J11 the quota rules of the judge runner on a non-Go source", () => {
  it("J11 makes no call at a window of 70 %", async () => {
    const fixture = await buildFixture({
      quotaProvider: "kimi-code-plan-cn",
      quotaSource: "kimi-for-coding",
      quotaPercent: 70,
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model at 70 %").toEqual([]);
      expect(
        quotaRequests(fixture).filter((path) => path.startsWith("/api/quota/")),
        "the runner read no quota through BENCH_QUOTA_BASE",
      ).not.toEqual([]);
      const record = runRecord(fixture, "a");
      if (record !== null) {
        expect(record.state, "the run record of a stopped run").not.toBe("complete");
      }
    } finally {
      dropFixture(fixture);
    }
  });

  it("J11 stops the run at 80 % and leaves the run open with the verdict of the first group", async () => {
    const fixture = await buildFixture({
      quotaProvider: "kimi-code-plan-cn",
      quotaSource: "kimi-for-coding",
      quotaPercent: 69.9,
      quotaStopPercent: 80,
      quotaStopAfter: 1,
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model after 80 %").toHaveLength(1);
      const judge = judgeFile(fixture, "a");
      expect(judge, "the runner wrote no judge file").not.toBeNull();
      expect(Object.keys(judge ?? {}), "the judge file holds a verdict of the second group").toEqual([
        "d-01#C0a1b2c3d4e5f",
      ]);
      const record = runRecord(fixture, "a");
      expect(record, "the runner wrote no run record").not.toBeNull();
      expect(record?.state, "the state of the stopped run").toBe("open");
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 the Go plan thresholds of the judge runner (task 4.13g)", () => {
  it("G1 the judge starts on a Go route at week 97 % with a low 5h and refuses at week 100 %", async () => {
    const ready = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 97,
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(ready, judgeArgs(ready));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(ready.logPath)), "the runner made no call at week 97 %").toHaveLength(2);
      const record = runRecord(ready, "a");
      expect(record, "the runner wrote no run record").not.toBeNull();
      expect(record?.state, "the state of the run record").toBe("complete");
    } finally {
      dropFixture(ready);
    }

    const wait = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 100,
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(wait, judgeArgs(wait));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(wait.logPath)), "the runner called the model at week 100 %").toEqual([]);
      const record = runRecord(wait, "a");
      if (record !== null) {
        expect(record.state, "the run record of a stopped run").not.toBe("complete");
      }
    } finally {
      dropFixture(wait);
    }
  });

  it("G2 the judge stops before the next group at the Go thresholds but not at 80 %", async () => {
    const through = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 10,
      quotaStopWeek: 80,
      quotaStopAfter: 1,
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(through, judgeArgs(through));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(through.logPath)), "the runner stopped the Go run at 80 %").toHaveLength(2);
      const judge = judgeFile(through, "a");
      expect(judge, "the runner wrote no judge file").not.toBeNull();
      expect(Object.keys(judge ?? {}), "the judge file holds no verdict of the second group").toEqual([
        "d-01#C0a1b2c3d4e5f",
        "d-02#C2a3b4c5d6e7f",
      ]);
      const record = runRecord(through, "a");
      expect(record, "the runner wrote no run record").not.toBeNull();
      expect(record?.state, "the state of the run record").toBe("complete");
    } finally {
      dropFixture(through);
    }

    const stopped = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 10,
      quotaStopWeek: 100,
      quotaStopAfter: 1,
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(stopped, judgeArgs(stopped));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(modelCalls(logEntries(stopped.logPath)), "the runner called the model after week 100 %").toHaveLength(1);
      const judge = judgeFile(stopped, "a");
      expect(judge, "the runner wrote no judge file").not.toBeNull();
      expect(Object.keys(judge ?? {}), "the judge file holds a verdict of the second group").toEqual([
        "d-01#C0a1b2c3d4e5f",
      ]);
      const record = runRecord(stopped, "a");
      expect(record, "the runner wrote no run record").not.toBeNull();
      expect(record?.state, "the state of the stopped run").toBe("open");
    } finally {
      dropFixture(stopped);
    }
  });

  it("G3 the start test is ready on a Go route at week 97 % and not-ready at week 100 %", async () => {
    const ready = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 97,
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "sample#C0a1b2c3d4e5f": "real-defect" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(ready, [...judgeArgs(ready), "--start-test"]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const lines = stdoutLines(result);
      expect(lines, `the start test prints one line: ${result.stdout}`).toHaveLength(1);
      expect(lines[0], "the start test line").toBe(`${ROUTE} ready -`);
      expect(
        modelCalls(logEntries(ready.logPath)),
        "the start test made no call at week 97 %",
      ).toHaveLength(1);
    } finally {
      dropFixture(ready);
    }

    const wait = await buildFixture({
      quotaPercent: 10,
      quotaWeek: 100,
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "sample#C0a1b2c3d4e5f": "real-defect" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(wait, [...judgeArgs(wait), "--start-test"]);
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      const lines = stdoutLines(result);
      expect(lines, `the start test prints one line: ${result.stdout}`).toHaveLength(1);
      expect(lines[0], "the start test line must start with the route and not-ready").toMatch(
        new RegExp(`^${ROUTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} not-ready `),
      );
      expect(
        modelCalls(logEntries(wait.logPath)),
        "the start test called the model at week 100 %",
      ).toEqual([]);
    } finally {
      dropFixture(wait);
    }
  });
});

describe("P4 J12 the credential value scan of the judge runner", () => {
  it("J12 stops the run at a credential value and keeps the value out of the private folder, the repository, and the log", async () => {
    const fixture = await buildFixture({
      calls: [
        { tokens: TOKENS_A, value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": SECRET }))]) },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(
        filesHolding(fixture.privateDir, SECRET),
        "the credential value stayed in the private folder",
      ).toEqual([]);
      expect(filesHolding(fixture.repo, SECRET), "the credential value stayed in the repository").toEqual([]);
      expect(
        readFileSync(fixture.logPath, "utf8").includes(SECRET),
        "the credential value stayed in the log",
      ).toBe(false);
      expect(
        modelCalls(logEntries(fixture.logPath)),
        "the runner called the model after the value scan stopped the run",
      ).toHaveLength(1);
      const named = [...stdoutLines(result), ...stderrLines(result)].filter((line) =>
        /credential|value|scan/i.test(line),
      );
      expect(named, `the runner printed no line about the credential value: ${result.stdout}`).not.toEqual(
        [],
      );
      const judge = judgeFile(fixture, "a");
      if (judge !== null) {
        expect(Object.keys(judge), "the judge file holds a verdict of the group with the value").toEqual(
          [],
        );
      }
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 J13 the start test of the judge runner", () => {
  it("J13 makes one call on a built-in sample group, prints ready, and writes no judge file", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "sample#C0a1b2c3d4e5f": "real-defect" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, [...judgeArgs(fixture), "--start-test"]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const lines = stdoutLines(result);
      expect(lines, `the start test prints one line: ${result.stdout}`).toHaveLength(1);
      expect(lines[0], "the start test line").toBe(`${ROUTE} ready -`);
      const calls = modelCalls(logEntries(fixture.logPath));
      expect(calls, "the start test made no call").toHaveLength(1);
      expect(calls[0].stdin, "the start test prompt holds the diff of the set").not.toContain("SEEDED-d-01");
      expect(calls[0].stdin, "the start test prompt holds the item ids of the set").not.toContain(
        "d-01#C0a1b2c3d4e5f",
      );
      expect(judgeFile(fixture, "a"), "the start test wrote a judge file").toBeNull();
      expect(runRecord(fixture, "a"), "the start test wrote a run record").toBeNull();
    } finally {
      dropFixture(fixture);
    }
  });

  it("J13b prints not-ready with the error line and exits 3 when the call fails", async () => {
    const fixture = await buildFixture({
      calls: [{ exit: 1, stderr: "provider: transport error" }],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, [...judgeArgs(fixture), "--start-test"]);
      expect(result.error, "the spawn hit the timeout").toBeUndefined();
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(3);
      const lines = stdoutLines(result);
      expect(lines, `the start test prints one line: ${result.stdout}`).toHaveLength(1);
      expect(lines[0], "the start test line must start with the route and not-ready").toMatch(
        new RegExp(`^${ROUTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} not-ready `),
      );
      expect(lines[0], "the line must hold the error line").toContain("transport error");
      expect(
        modelCalls(logEntries(fixture.logPath)),
        "the start test made no call",
      ).toHaveLength(1);
      expect(judgeFile(fixture, "a"), "the start test wrote a judge file").toBeNull();
      expect(runRecord(fixture, "a"), "the start test wrote a run record").toBeNull();
    } finally {
      dropFixture(fixture);
    }
  });
});

describe("P4 J14 the watcher of the call and the trap of the job folder", () => {
  it("J14 ends the call at MG_CALL_TIMEOUT_S, stops the fake child, and removes the job folder", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          sleep: 30,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const started = Date.now();
      const result = runJudge(fixture, judgeArgs(fixture), { MG_CALL_TIMEOUT_S: "2" });
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
      const gone = await waitFor(() => jobFolders(fixture).length === 0, 10_000);
      expect(gone, `a job folder stays: ${jobFolders(fixture).join(" | ")}`).toBe(true);
      expect(liveFakeProcesses(), "a fake process is still alive").toEqual([]);
    } finally {
      dropFixture(fixture);
    }
  });

  it("J14b the watcher of the call stops the model call when the runner dies", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          sleep: 30,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const child = spawn(
        "bash",
        [join(fixture.repo, "harness", "model-guide", "judge-run.sh"), ...judgeArgs(fixture)],
        { cwd: fixture.repo, env: spawnEnv(fixture), stdio: ["ignore", "pipe", "pipe"] },
      );
      startedServers.add(child);
      serverExits.add(
        new Promise<void>((done) => {
          child.once("close", () => done());
        }),
      );
      const called = await waitFor(
        () => modelCalls(logEntries(fixture.logPath)).length >= 1,
        15_000,
      );
      expect(called, "the run made no call").toBe(true);
      // The runner dies without its trap. The watcher of the call stops the
      // child, so no model call outlives the runner.
      child.kill("SIGKILL");
      await waitFor(() => child.exitCode !== null, 5_000);
      const gone = await waitFor(() => liveFakeProcesses().length === 0, 15_000);
      expect(gone, `a fake child stays alive: ${liveFakeProcesses().join(" | ")}`).toBe(true);
    } finally {
      dropFixture(fixture);
    }
  });
});

// --- task 4.13c: the judge route list (spec D11, PM 2026-11-18) ---------------
//
// `judge-run.sh` accepts a route only from `harness/model-guide/judges.json`.
// A review-only route of `routes.json` and a route that neither file holds
// are refusals: exit 2, one `judge-run:` line on stdout, no call, and no
// judge file. `review-run.sh` never reads `judges.json`.
describe("P4 the judge route list (task 4.13c)", () => {
  /** The review runner. It must never read the judge route list. */
  const REVIEW_RUNNER_SOURCE = join(HARNESS, "model-guide", "review-run.sh");
  /** The three judge routes of spec D11, with their quota read of spec D15. */
  const JUDGE_ROUTES = [
    {
      route: "kimi-code-plan-cn/k3.1-pro#high",
      quota_provider: "kimi-code-plan-cn",
      quota_source: "kimi-for-coding",
    },
    {
      route: "opencode-go/muse-spark-1.3-contributor#high",
      quota_provider: "opencode-go",
      quota_source: "opencode-go",
    },
    {
      route: "claude-code/claude-sonnet-5-5#max",
      quota_provider: "claude-code",
      quota_source: "claude",
    },
  ];
  /** A review-only route of `routes.json` (spec D12). It is not a judge. */
  const REVIEW_ONLY_ROUTE = "opencode-go/deepseek-v4.1-flash";
  /** A route that neither `routes.json` nor `judges.json` holds. */
  const UNKNOWN_ROUTE = "opencode-go/not-a-route#high";

  /** The two answers of one judge run: one fenced block per group. */
  function judgeCalls(): CallSpec[] {
    return [
      {
        tokens: TOKENS_A,
        value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
      },
      {
        tokens: TOKENS_B,
        value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
      },
    ];
  }

  it("J15 accepts each route of judges.json and review-run.sh never reads judges.json", async () => {
    expect(
      readFileSync(REVIEW_RUNNER_SOURCE, "utf8"),
      "review-run.sh reads judges.json",
    ).not.toContain("judges.json");
    for (const judge of JUDGE_ROUTES) {
      const fixture = await buildFixture({
        route: REVIEW_ONLY_ROUTE,
        quotaProvider: "opencode-go",
        quotaSource: "opencode-go",
        judgesRoutes: JUDGE_ROUTES,
        calls: judgeCalls(),
      });
      try {
        assertRunnerExists();
        const result = runJudge(fixture, [
          "--set",
          fixture.setId,
          "--route",
          judge.route,
          "--judge",
          "a",
          "--private",
          fixture.privateDir,
        ]);
        expect(result.status, `${judge.route}: ${result.stdout}\n${result.stderr}`).toBe(0);
        expect(
          modelCalls(logEntries(fixture.logPath)),
          `${judge.route} made no call per group`,
        ).toHaveLength(2);
        expect(judgeFile(fixture, "a"), `${judge.route} wrote no judge file`).not.toBeNull();
        expect(runRecord(fixture, "a"), `${judge.route} wrote no run record`).not.toBeNull();
      } finally {
        dropFixture(fixture);
      }
    }
  });

  it("J16 refuses a review-only route of routes.json with exit 2, one named line, no call, and no file", async () => {
    const fixture = await buildFixture({
      route: REVIEW_ONLY_ROUTE,
      quotaProvider: "opencode-go",
      quotaSource: "opencode-go",
      judgesRoutes: JUDGE_ROUTES,
      calls: judgeCalls(),
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(judgeFile(fixture, "a"), "the runner wrote a judge file").toBeNull();
      expect(runRecord(fixture, "a"), "the runner wrote a run record").toBeNull();
    } finally {
      dropFixture(fixture);
    }
  });

  it("J16b refuses an unknown route with exit 2, one named line, no call, and no file", async () => {
    const fixture = await buildFixture({
      route: REVIEW_ONLY_ROUTE,
      quotaProvider: "opencode-go",
      quotaSource: "opencode-go",
      judgesRoutes: JUDGE_ROUTES,
      calls: judgeCalls(),
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, [
        "--set",
        fixture.setId,
        "--route",
        UNKNOWN_ROUTE,
        "--judge",
        "a",
        "--private",
        fixture.privateDir,
      ]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(judgeFile(fixture, "a"), "the runner wrote a judge file").toBeNull();
      expect(runRecord(fixture, "a"), "the runner wrote a run record").toBeNull();
    } finally {
      dropFixture(fixture);
    }
  });

  it("J17 refuses a route that routes.json holds when judges.json is missing, with exit 2, one named line, no call, and no file", async () => {
    const fixture = await buildFixture({
      route: REVIEW_ONLY_ROUTE,
      quotaProvider: "opencode-go",
      quotaSource: "opencode-go",
      judgesMissing: true,
      calls: judgeCalls(),
    });
    try {
      assertRunnerExists();
      expect(existsSync(join(fixture.repo, "harness", "model-guide", "judges.json")), "the case left a judges.json behind").toBe(false);
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(judgeFile(fixture, "a"), "the runner wrote a judge file").toBeNull();
      expect(runRecord(fixture, "a"), "the runner wrote a run record").toBeNull();
    } finally {
      dropFixture(fixture);
    }
  });
});

// --- task 4.13e: the judge row quota fields (spec D11, review B2) ---------------
//
// `judge-run.sh` refuses a `judges.json` row with an empty `quota_provider`
// or `quota_source`, or a tab in a field: exit 2, one `judge-run:` line on
// stdout, no call, and no judge file.
describe("P4 the judge row quota fields (task 4.13e)", () => {
  const JUDGE = "opencode-go/muse-spark-1.3-contributor#high";

  /** Two answered groups, so a run that is not refused makes two calls. */
  function okCalls(): CallSpec[] {
    return [
      {
        tokens: TOKENS_A,
        value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
      },
      {
        tokens: TOKENS_B,
        value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
      },
    ];
  }

  it("J18 refuses a judge row with an empty quota_provider, with exit 2, one named line, no call, and no file", async () => {
    const fixture = await buildFixture({
      route: JUDGE,
      judgesRoutes: [{ route: JUDGE, quota_provider: "", quota_source: "opencode-go" }],
      calls: okCalls(),
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(judgeFile(fixture, "a"), "the runner wrote a judge file").toBeNull();
      expect(runRecord(fixture, "a"), "the runner wrote a run record").toBeNull();
    } finally {
      dropFixture(fixture);
    }
  });

  it("J18b refuses a judge row with an empty quota_source, with exit 2, one named line, no call, and no file", async () => {
    const fixture = await buildFixture({
      route: JUDGE,
      judgesRoutes: [{ route: JUDGE, quota_provider: "opencode-go", quota_source: "" }],
      calls: okCalls(),
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(judgeFile(fixture, "a"), "the runner wrote a judge file").toBeNull();
      expect(runRecord(fixture, "a"), "the runner wrote a run record").toBeNull();
    } finally {
      dropFixture(fixture);
    }
  });

  it("J18c refuses a judge row with a tab in a field, with exit 2, one named line, no call, and no file", async () => {
    const fixture = await buildFixture({
      route: JUDGE,
      judgesRoutes: [{ route: JUDGE, quota_provider: "opencode-go", quota_source: "opencode\t-go" }],
      calls: okCalls(),
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(namedLines(result), `the runner printed no named line: ${result.stdout}`).toHaveLength(1);
      expect(modelCalls(logEntries(fixture.logPath)), "the runner called the model").toEqual([]);
      expect(judgeFile(fixture, "a"), "the runner wrote a judge file").toBeNull();
      expect(runRecord(fixture, "a"), "the runner wrote a run record").toBeNull();
    } finally {
      dropFixture(fixture);
    }
  });

  it("J18d the committed judges.json holds the three judge routes with both quota fields and no tab (guard: holds at HEAD)", () => {
    const file = join(REPO_ROOT, "harness", "model-guide", "judges.json");
    expect(existsSync(file), `judges.json is missing: ${file}`).toBe(true);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const rows = Array.isArray(doc) ? doc : (doc.routes ?? []);
    expect(
      rows.map((row: { route?: unknown }) => row.route).sort(),
      "judges.json holds the three judge routes of spec D11",
    ).toEqual(
      [
        "claude-code/claude-sonnet-5-5#max",
        "kimi-code-plan-cn/k3.1-pro#high",
        "opencode-go/muse-spark-1.3-contributor#high",
      ].sort(),
    );
    for (const row of rows) {
      for (const field of ["quota_provider", "quota_source"]) {
        const value = row[field];
        expect(typeof value, `${row.route} holds a ${field} string`).toBe("string");
        expect(value.length, `${row.route} holds a non-empty ${field}`).toBeGreaterThan(0);
        expect(value, `${row.route} holds no tab in ${field}`).not.toContain("\t");
      }
    }
  });
});

// --- task 4.13e: judged_by holds only verdicts (review C7) ----------------------
//
// `judged_by` holds only the finding ids that hold a verdict. A complete
// group whose answer drops an id leaves that id out of `judged_by`.
describe("P4 judged_by holds only verdicts (task 4.13e)", () => {
  it("J19 judged_by holds only the finding ids that hold a verdict", async () => {
    const fixture = await buildFixture({
      calls: [
        {
          tokens: TOKENS_A,
          value: answer([jsonBlock(JSON.stringify({ "d-01#C0a1b2c3d4e5f": "real-defect" }))]),
        },
        {
          tokens: TOKENS_B,
          value: answer([jsonBlock(JSON.stringify({ "d-02#C2a3b4c5d6e7f": "false-claim" }))]),
        },
      ],
    });
    try {
      assertRunnerExists();
      const result = runJudge(fixture, judgeArgs(fixture));
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const record = runRecord(fixture, "a");
      expect(record, "the runner wrote no run record").not.toBeNull();
      // The first group holds two finding ids, but its answer gives a
      // verdict to one of them only.
      expect(record?.judged_by, "judged_by holds only the ids that hold a verdict").toEqual({
        "d-01#C0a1b2c3d4e5f": ROUTE,
        "d-02#C2a3b4c5d6e7f": ROUTE,
      });
    } finally {
      dropFixture(fixture);
    }
  });
});
