import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The isolation test of FR-7.
 *
 * The test puts a fake `opencode` on the PATH and in `BENCH_OPENCODE_BIN`.
 * The fake records one JSON line per call. Each line holds the arguments and
 * the folders of the call.
 *
 * The test copies the scripts that it runs into a temp repo. The temp repo is
 * the `$ROOT` of every script. No test writes under the real `.tmp/`, `runs/`,
 * or `reports/`. No test starts the real `opencode` binary, Podman, a
 * browser, or a model.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TIMEOUT = 120_000;

const FAKE_ACCESS = "fake-access";
const FAKE_REFRESH = "fake-refresh";
const FAKE_ORG = "fake-org";
const MODEL = "fake-model";
const MODEL_REF = `opencode-go/${MODEL}`;

/** The scripts that the test copies into the temp repo. */
const SCRIPTS = [
  "cron-daily.sh", "batch.sh", "run.sh", "env.sh", "toolchain.sh",
  "preflight.sh", "opencode-credential.sh", "opencode-entry.sh",
  "summarize.sh", "opencode-host.sh",
];

type Call = {
  argv: string[];
  HOME: string;
  XDG_DATA_HOME: string;
  XDG_STATE_HOME: string;
  XDG_CONFIG_HOME: string;
  XDG_CACHE_HOME: string;
  TMPDIR: string;
  opencode_db: boolean;
};

type Fixture = {
  root: string;
  repo: string;
  harness: string;
  bin: string;
  sharedHome: string;
  record: string;
};

/** The fake Console export. The values are inert strings. */
function fakeExport(): string {
  return JSON.stringify([{
    id: "fake-console-1", integrationID: "opencode", label: "Fake Console", active: true,
    value: {
      type: "oauth", methodID: "device", access: FAKE_ACCESS, refresh: FAKE_REFRESH,
      expires: 4102444800000, metadata: { orgID: FAKE_ORG, server: "https://opencode.ai/console" },
    },
  }]) + "\n";
}

/** The fake `opencode`. It keeps its store in the resolved data folder. */
function fakeOpencode(bin: string): string {
  const path = join(bin, "opencode");
  writeFileSync(path, `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const argv = process.argv.slice(2);
const home = process.env.HOME || "";
const data = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
const line = { argv, HOME: home,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME || "",
  XDG_STATE_HOME: process.env.XDG_STATE_HOME || "",
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || "",
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || "",
  TMPDIR: process.env.TMPDIR || "",
  opencode_db: Object.prototype.hasOwnProperty.call(process.env, "OPENCODE_DB") };
if (process.env.FAKE_OPENCODE_RECORD) {
  fs.appendFileSync(process.env.FAKE_OPENCODE_RECORD, JSON.stringify(line) + "\\n");
}
const store = path.join(data, "opencode", "fake-auth.json");
const has = (flag) => argv.includes(flag);
if (has("--version")) { console.log("opencode v2.2.4"); process.exit(0); }
if (has("models")) { console.log("${MODEL_REF}"); process.exit(0); }
if (argv[0] === "auth") {
  if (has("export")) {
    if (!fs.existsSync(store)) process.exit(1);
    process.stdout.write(fs.readFileSync(store, "utf8"));
    process.exit(0);
  }
  if (has("import")) {
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, fs.readFileSync(0));
    console.log("Imported 1 credential");
    process.exit(0);
  }
}
process.exit(96);
`);
  chmodSync(path, 0o755);
  return path;
}

/** The fake `rg`. Its version is the version that the batch only warns about. */
function fakeRg(bin: string): string {
  const path = join(bin, "rg");
  writeFileSync(path, `#!/usr/bin/env bash
# fake-rg
if [ "\${1:-}" = "--version" ]; then printf 'ripgrep 15.1.0\\n'; exit 0; fi
exit 0
`);
  chmodSync(path, 0o755);
  return path;
}

/** The fake `podman`. It records the argument list and reads the payload. */
function fakePodman(bin: string): string {
  const path = join(bin, "podman");
  writeFileSync(path, `#!${process.execPath}
const fs = require("node:fs");
const stdin = fs.readFileSync(0);
if (process.env.FAKE_PODMAN_RECORD) {
  fs.writeFileSync(process.env.FAKE_PODMAN_RECORD,
    JSON.stringify({ argv: process.argv.slice(2), stdin_bytes: stdin.length }) + "\\n");
}
process.exit(0);
`);
  chmodSync(path, 0o755);
  return path;
}

/** The stub of `tsx`. It starts no test and calls no model. */
function tsxStub(harness: string): void {
  const path = join(harness, "node_modules", ".bin", "tsx");
  // The stub of score-freshness.ts exits 0. The batch then skips the agent
  // runs, so no agent run starts in the batch case.
  writeFileSync(path, `#!/usr/bin/env bash
# fake-tsx
case "\$(basename "\${1:-}")" in
  candidate-contract.ts)
    if [ "\${2:-}" = "--writable-paths" ]; then printf 'src/app/page.tsx\\n'; else printf '{}\\n'; fi ;;
  revisions.ts) printf 'r1\\n' ;;
  usage.ts) printf '{"output":0}\\n' ;;
  score-freshness.ts) printf '{}\\n' ;;
  plan-work.ts)
    if [ "\${2:-}" = "--work-list" ]; then printf '[]\\n'; else printf 'opencode-go|${MODEL}|${MODEL}\\n'; fi ;;
  daily-pick.ts)
    if [ "\${2:-}" = "--day-runs" ]; then printf '[{"run_id":"fake-run-1"}]\\n'; else printf '{"model":"${MODEL_REF}","run_ids":[]}\\n'; fi ;;
  *) printf '{}\\n' ;;
esac
`);
  chmodSync(path, 0o755);
}

/** A shell stub of the test seam. */
function shellStub(bin: string, name: string, body: string): string {
  const path = join(bin, name);
  writeFileSync(path, `#!/usr/bin/env bash
# fake-${name}
${body}
`);
  chmodSync(path, 0o755);
  return path;
}

/** The temp repo of one case. */
function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "opencode-host-isolation-"));
  const repo = join(root, "repo");
  const harness = join(repo, "harness");
  const bin = join(root, "bin");
  const sharedHome = join(root, "shared-home");
  mkdirSync(join(harness, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(repo, "reports"), { recursive: true });
  mkdirSync(join(repo, "fixture", "node_modules"), { recursive: true });
  mkdirSync(join(repo, "fixture", "src", "app"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(sharedHome, ".local", "share", "opencode"), { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  for (const name of SCRIPTS) {
    const source = join(HARNESS, name);
    if (!existsSync(source)) continue;
    writeFileSync(join(harness, name), readFileSync(source), { mode: 0o755 });
    chmodSync(join(harness, name), 0o755);
  }
  writeFileSync(join(repo, "fixture", "AGENTS.md"), "# fake candidate\n");
  writeFileSync(join(repo, "fixture", "src", "app", "page.tsx"), "export default function Page() { return null; }\n");
  tsxStub(harness);
  fakeOpencode(bin);
  fakeRg(bin);
  fakePodman(bin);
  writeFileSync(join(sharedHome, ".local", "share", "opencode", "fake-auth.json"), fakeExport());
  return { root, repo, harness, bin, sharedHome, record: join(root, "calls.jsonl") };
}

/**
 * The environment of one case. It holds no XDG variable.
 *
 * It sets OPENCODE_DB to a path under the temp shared home. Every call that
 * keeps the variable then fails the check of spec D2. The seed call removes it
 * too, so the seed is checked as well.
 */
function testEnv(f: Fixture, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: `${f.bin}:${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    HOME: f.sharedHome,
    LANG: "C.UTF-8",
    TMPDIR: join(f.root, "tmp"),
    USER: process.env.USER ?? "tester",
    LOGNAME: process.env.LOGNAME ?? "tester",
    BENCH_OPENCODE_BIN: join(f.bin, "opencode"),
    FAKE_OPENCODE_RECORD: f.record,
    OPENCODE_DB: join(f.sharedHome, ".local", "share", "opencode", "opencode.db"),
    ...extra,
  };
}

/** The seams of the daily job. */
function dailySeams(f: Fixture): Record<string, string> {
  return {
    BENCH_DAILY_CATALOG: join(f.root, "catalog.json"),
    BENCH_DAILY_QUOTA_CMD: join(f.bin, "quota"),
    BENCH_DAILY_BATCH: join(f.bin, "batch"),
    BENCH_DAILY_SELECT: join(f.bin, "select"),
    BENCH_DAILY_LOCK: join(f.root, "daily.lock"),
    BENCH_DAILY_DIR: join(f.root, "daily"),
    BENCH_RUNS_ROOT: join(f.root, "runs"),
    BENCH_DAILY_PUBLISH: "0",
    BENCH_DAILY_NOTIFY_CMD: join(f.bin, "notify"),
    FAKE_NOTIFY_RECORD: join(f.root, "notify-sink.txt"),
    BENCH_PRICING_PATH: join(f.root, "pricing.json"),
  };
}

/** The temp files that the daily job and the batch read. */
function dailyFiles(f: Fixture): void {
  writeFileSync(join(f.root, "catalog.json"), JSON.stringify({ live: [MODEL_REF] }) + "\n");
  writeFileSync(join(f.root, "pricing.json"), JSON.stringify({ provider: "opencode-go", models: { [MODEL]: {} } }) + "\n");
  shellStub(f.bin, "quota", `printf '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":20}}}}\\n'`);
  shellStub(f.bin, "select", `printf '{"model":"${MODEL_REF}","run_ids":[],"reason":"new"}\\n'`);
  shellStub(f.bin, "batch", `printf '[1/1] DRY-RUN START ${MODEL}\\n'`);
  // The notice sink of D20. It keeps the test away from the PM session.
  shellStub(f.bin, "notify", `printf '%s\\n' "$1" >> "$FAKE_NOTIFY_RECORD"`);
}

function runScript(script: string, args: string[], env: Record<string, string>, cwd: string) {
  return spawnSync("bash", [script, ...args], {
    cwd, env, encoding: "utf8", timeout: 100_000, maxBuffer: 16 * 1024 * 1024,
  });
}

function readCalls(record: string): Call[] {
  if (!existsSync(record)) return [];
  return readFileSync(record, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Call);
}

function dataFolder(call: Call): string {
  return call.XDG_DATA_HOME ? call.XDG_DATA_HOME : join(call.HOME, ".local", "share");
}

function stateFolder(call: Call): string {
  return call.XDG_STATE_HOME ? call.XDG_STATE_HOME : join(call.HOME, ".local", "state");
}

function under(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent + "/");
}

/** The argument list of the seed call of D4. The spec D3 gives a second order. */
function isSeedArgv(call: Call): boolean {
  return call.argv[0] === "auth" && call.argv.includes("export")
    && call.argv.includes("--standalone") && call.argv.includes("opencode");
}

/** The seed read of D4. It is the one call that reads the shared store. */
function isSeed(call: Call, sharedHome: string): boolean {
  return isSeedArgv(call) && under(dataFolder(call), sharedHome);
}

function sharedCalls(calls: Call[], sharedHome: string): Call[] {
  return calls.filter((call) => under(dataFolder(call), sharedHome) || under(stateFolder(call), sharedHome));
}

/**
 * Every call but the seed read stays out of the shared home.
 *
 * The seed read is the one shared read of the job folder. The test finds it by
 * its count, so a job store read that resolves under the shared home is not
 * exempt and fails the count.
 */
function expectIsolated(calls: Call[], f: Fixture, label: string): void {
  const shared = sharedCalls(calls, f.sharedHome);
  const seedCalls = shared.filter(isSeedArgv);
  expect(seedCalls.length, `${label}: the job folder made ${seedCalls.length} seed reads of the shared store`)
    .toBe(1);
  const seed = seedCalls[0];
  for (const call of calls) {
    if (call === seed) continue;
    const name = call.argv.join(" ");
    expect(under(dataFolder(call), f.sharedHome),
      `${label}: the ${name} call resolves its data folder under the shared home`).toBe(false);
    expect(under(stateFolder(call), f.sharedHome),
      `${label}: the ${name} call resolves its state folder under the shared home`).toBe(false);
  }
  for (const call of calls) {
    if (call === seed) continue;
    expect(dataFolder(call).startsWith(join(f.repo, ".tmp", "opencode-host-")),
      `${label}: the ${call.argv.join(" ")} call does not use a job folder of the temp repo`).toBe(true);
  }
  // Every call removes OPENCODE_DB. The seed call does it too (spec D2).
  for (const call of calls) {
    expect(call.opencode_db,
      `${label}: the ${call.argv.join(" ")} call sets OPENCODE_DB`).toBe(false);
  }
}

/** Each models and auth call carries the flag of D3. */
function expectStandalone(calls: Call[], label: string): void {
  for (const call of calls) {
    const relevant = call.argv.includes("models") || call.argv[0] === "auth";
    if (!relevant) continue;
    expect(call.argv.includes("--standalone"),
      `${label}: the ${call.argv.join(" ")} call has no --standalone flag`).toBe(true);
  }
}

describe("the OpenCode host isolation of FR-7", () => {
  it("keeps every daily job call out of the shared home", () => {
    const f = fixture();
    try {
      dailyFiles(f);
      const env = testEnv(f, dailySeams(f));
      const result = runScript(join(f.harness, "cron-daily.sh"), ["--dry-run"], env, f.repo);
      const calls = readCalls(f.record);
      expect(calls.length, `the daily job made no OpenCode call\n${result.stdout}\n${result.stderr}`)
        .toBeGreaterThan(0);
      expectIsolated(calls, f, "the daily dry run");
      expectStandalone(calls, "the daily dry run");
      const shared = sharedCalls(calls, f.sharedHome);
      expect(shared.length, "the daily job read the shared store more than once").toBe(1);
      expect([["auth", "export", "--standalone", "opencode"], ["auth", "export", "opencode", "--standalone"]],
        "the shared read of the daily job is not a seed call of spec D3").toContainEqual(shared[0].argv);
      expect(calls.filter((call) => call.argv.includes("models")).length,
        "the daily job made no models call").toBeGreaterThan(0);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("keeps every batch call out of the shared home", () => {
    const f = fixture();
    try {
      dailyFiles(f);
      const env = testEnv(f, {
        BENCH_SELFCHECK: "skip", BENCH_CANARY: "0", ARMS: "", REPS: "1", WEEK: "2026w45",
        BENCH_PRICING_PATH: join(f.root, "pricing.json"),
      });
      const result = runScript(join(f.harness, "batch.sh"), ["--model", MODEL], env, f.repo);
      const calls = readCalls(f.record);
      expect(calls.length, `the batch made no OpenCode call\n${result.stdout}\n${result.stderr}`)
        .toBeGreaterThan(0);
      expectIsolated(calls, f, "the batch");
      expectStandalone(calls, "the batch");
      expect(calls.some((call) => call.argv.length === 1 && call.argv[0] === "--version"),
        "the batch made no --version call").toBe(true);
      expect(calls.filter((call) => isSeed(call, f.sharedHome)).length, "the batch made no seed call").toBe(1);
      expect(calls.some((call) => call.argv.includes("models")),
        "the batch made no models call").toBe(true);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  for (const mode of ["seed", "export", "check-window", "warn", "preflight", "scan-values"]) {
    it(`keeps every ${mode} call out of the shared home`, () => {
      const f = fixture();
      try {
        const env = testEnv(f, {});
        const result = runScript(join(f.harness, "opencode-credential.sh"), [mode], env, f.repo);
        expect(result.status, `the ${mode} mode exited ${result.status}\n${result.stdout}\n${result.stderr}`)
          .toBe(0);
        const calls = readCalls(f.record);
        expect(calls.length, `the ${mode} mode made no OpenCode call\n${result.stdout}\n${result.stderr}`)
          .toBeGreaterThan(0);
        expectIsolated(calls, f, `the ${mode} mode`);
        expectStandalone(calls, `the ${mode} mode`);
        expect(sharedCalls(calls, f.sharedHome).length,
          `the ${mode} mode read the shared store more than once`).toBe(1);
        expect(calls.filter((call) => isSeed(call, f.sharedHome)).length, `the ${mode} mode made no seed call`).toBe(1);
        if (mode === "scan-values") {
          const lines = result.stdout.split(/\r?\n/).filter(Boolean);
          expect(lines, "the scan values do not hold the access value").toContain(FAKE_ACCESS);
          expect(lines, "the scan values do not hold the org value").toContain(FAKE_ORG);
          expect(lines, "the scan values hold the refresh value").not.toContain(FAKE_REFRESH);
          expect(lines, "the scan values hold the inert value").not.toContain("inert");
        }
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    }, TIMEOUT);
  }

  it("keeps every run call out of the shared home", () => {
    const f = fixture();
    try {
      const env = testEnv(f, {
        XDG_RUNTIME_DIR: join(f.root, "runtime"),
        BENCH_WAIT_FOR_IDLE: "0",
        FAKE_PODMAN_RECORD: join(f.root, "podman.json"),
      });
      mkdirSync(join(f.root, "runtime"), { recursive: true });
      const result = runScript(join(f.harness, "run.sh"),
        ["opencode-go", MODEL, "a", "fake-run-1"], env, f.repo);
      const calls = readCalls(f.record);
      expect(calls.length, `the run made no OpenCode call\n${result.stdout}\n${result.stderr}`)
        .toBeGreaterThan(0);
      expectIsolated(calls, f, "the run");
      expectStandalone(calls, "the run");
      const version = calls.findIndex((call) => call.argv.length === 1 && call.argv[0] === "--version");
      expect(version, "the run made no --version call").toBeGreaterThan(-1);
      const exportCall = (call: Call) => call.argv[0] === "auth" && call.argv.includes("export");
      expect(calls.slice(0, version).some(exportCall),
        "the run made no check-window read before the version call").toBe(true);
      expect(calls.slice(version + 1).some(exportCall),
        "the run made no export read after the version call").toBe(true);
      // The job folder holds one shared read. The two helper reads use the job store.
      expect(sharedCalls(calls, f.sharedHome).length,
        "the run read the shared store more than once").toBe(1);
      expect(calls.filter(exportCall).length,
        "the run made fewer than two auth export calls").toBeGreaterThanOrEqual(2);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("reads the shared store once for two helper runs in one job folder", () => {
    const f = fixture();
    try {
      // A nested job uses the folder of its owner (spec D1).
      const folder = join(f.repo, ".tmp", "opencode-host-credential-4194306");
      mkdirSync(folder, { recursive: true });
      const env = testEnv(f, { BENCH_OPENCODE_HOME: folder });
      const first = runScript(join(f.harness, "opencode-credential.sh"), ["export"], env, f.repo);
      expect(first.status, `the first export exited ${first.status}\n${first.stdout}\n${first.stderr}`).toBe(0);
      const second = runScript(join(f.harness, "opencode-credential.sh"), ["export"], env, f.repo);
      expect(second.status, `the second export exited ${second.status}\n${second.stdout}\n${second.stderr}`).toBe(0);
      const calls = readCalls(f.record);
      expect(calls.length, `the two helper runs made no OpenCode call\n${first.stdout}\n${first.stderr}`)
        .toBeGreaterThan(1);
      // The seed of the first run reads the shared store. The second run reads the job store.
      expect(sharedCalls(calls, f.sharedHome).length,
        "the two helper runs read the shared store more than once").toBe(1);
      const exportCall = (call: Call) => call.argv[0] === "auth" && call.argv.includes("export");
      expect(calls.filter(exportCall).length,
        "the two helper runs made fewer than two auth export calls").toBeGreaterThanOrEqual(2);
      const jobStoreReads = calls.filter((call) =>
        dataFolder(call).startsWith(join(f.repo, ".tmp", "opencode-host-")));
      expect(jobStoreReads.length, "the two helper runs made no job store read").toBeGreaterThanOrEqual(1);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("prints the cleanup line of the owner on stderr", () => {
    const f = fixture();
    try {
      // The helper owns the job folder when no job folder exists (spec D1).
      const env = testEnv(f, {});
      const result = runScript(join(f.harness, "opencode-credential.sh"), ["export"], env, f.repo);
      expect(result.status, `the export exited ${result.status}\n${result.stdout}\n${result.stderr}`).toBe(0);
      const lines = result.stdout.split(/\r?\n/).filter(Boolean);
      expect(lines.length, `the export stdout holds ${lines.length} lines\n${result.stdout}`).toBe(1);
      expect(() => JSON.parse(lines[0] ?? ""), "the export stdout holds no JSON payload").not.toThrow();
      expect(result.stderr, "the export stderr holds no cleanup line")
        .toMatch(/^OPENCODE_HOME CLEANUP stopped=\d+ path=/m);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);
});
