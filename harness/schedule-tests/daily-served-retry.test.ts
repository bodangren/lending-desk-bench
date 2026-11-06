import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The served-list retry test of FR-11 (spec D15).
 *
 * The test puts a fake `opencode` on the PATH and in `BENCH_OPENCODE_BIN`. The
 * fake records one JSON line per call. It can fail the first `models` calls
 * with the transient notice of spec EV15.
 *
 * The served-list call of `cron-daily.sh` retries a transient failure: up to 3
 * calls in total, 5 s apart, while the call exits non-zero or writes an empty
 * list. Each retry keeps `--standalone` and the job store.
 *
 * The test copies the scripts that it runs into a temp repo. The temp repo is
 * the `$ROOT` of every script. No test writes under the real `.tmp/`, `runs/`,
 * or `reports/`. No test starts the real `opencode` binary, Podman, a
 * browser, or a model.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TIMEOUT = 120_000;

const MODEL = "fake-model";
const MODEL_REF = `opencode-go/${MODEL}`;
const FAKE_ACCESS = "fake-access";
const FAKE_REFRESH = "fake-refresh";
const FAKE_ORG = "fake-org";

/** The scripts that the test copies into the temp repo. */
const SCRIPTS = [
  "cron-daily.sh", "env.sh", "toolchain.sh", "opencode-credential.sh",
  "opencode-host.sh",
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
  modelsCount: string;
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

/**
 * The fake `opencode`. It starts no server and calls no model.
 *
 * The file name holds `fake-opencode`, so a `ps` check finds a rest. The PATH
 * name calls the same fake, so every child holds `fake-opencode` in its
 * command line.
 *
 * The fake fails the first `FAKE_OPENCODE_MODELS_FAIL` `models` calls with the
 * transient notice of spec EV15. The next `FAKE_OPENCODE_MODELS_EMPTY` calls
 * exit 0 and write no list. The call count lives in its own file, so the fake
 * holds no state between calls.
 */
function fakeOpencode(bin: string): string {
  const path = join(bin, "fake-opencode");
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
if (has("models")) {
  const countFile = process.env.FAKE_OPENCODE_MODELS_COUNT || "";
  let count = 0;
  if (countFile) {
    try { count = Number(fs.readFileSync(countFile, "utf8").trim() || "0"); } catch { count = 0; }
    count += 1;
    fs.writeFileSync(countFile, String(count));
  }
  const failCount = Number(process.env.FAKE_OPENCODE_MODELS_FAIL || "0");
  const emptyCount = Number(process.env.FAKE_OPENCODE_MODELS_EMPTY || "0");
  if (count <= failCount) {
    process.stderr.write("ServiceUnavailableError: Location plugins did not finish activating\\n");
    process.exit(1);
  }
  // The empty-list clause of D15: the call exits 0 and writes no list.
  if (count <= failCount + emptyCount) process.exit(0);
  console.log("${MODEL_REF}");
  process.exit(0);
}
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
  const alias = join(bin, "opencode");
  writeFileSync(alias, `#!/usr/bin/env bash
# fake-opencode
exec "${path}" "$@"
`);
  chmodSync(alias, 0o755);
  return path;
}

/** The stub of `tsx`. It starts no test and calls no model. */
function tsxStub(harness: string): void {
  const path = join(harness, "node_modules", ".bin", "tsx");
  writeFileSync(path, `#!/usr/bin/env bash
# fake-tsx
case "\$(basename "\${1:-}")" in
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
  const root = mkdtempSync(join(tmpdir(), "daily-served-retry-"));
  const repo = join(root, "repo");
  const harness = join(repo, "harness");
  const bin = join(root, "bin");
  const sharedHome = join(root, "shared-home");
  mkdirSync(join(harness, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(repo, "reports"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(sharedHome, ".local", "share", "opencode"), { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  for (const name of SCRIPTS) {
    const source = join(HARNESS, name);
    if (!existsSync(source)) continue;
    writeFileSync(join(harness, name), readFileSync(source), { mode: 0o755 });
    chmodSync(join(harness, name), 0o755);
  }
  tsxStub(harness);
  fakeOpencode(bin);
  writeFileSync(join(sharedHome, ".local", "share", "opencode", "fake-auth.json"), fakeExport());
  writeFileSync(join(root, "catalog.json"), JSON.stringify({ live: [MODEL_REF] }) + "\n");
  writeFileSync(join(root, "pricing.json"), JSON.stringify({ provider: "opencode-go", models: { [MODEL]: {} } }) + "\n");
  shellStub(bin, "quota", `printf '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":20}}}}\\n'`);
  shellStub(bin, "select", `printf '{"model":"${MODEL_REF}","run_ids":[],"reason":"new"}\\n'`);
  shellStub(bin, "batch", `printf '[1/1] DRY-RUN START ${MODEL}\\n'`);
  return {
    root, repo, harness, bin, sharedHome,
    record: join(root, "calls.jsonl"),
    modelsCount: join(root, "models-count.txt"),
  };
}

/**
 * The environment of one case. It holds no XDG variable.
 *
 * The seam `BENCH_DAILY_SERVED` stays unset, so the job reaches the served
 * list and calls `opencode models --standalone` itself.
 */
function testEnv(f: Fixture, extra: Record<string, string>): Record<string, string> {
  return {
    PATH: `${f.bin}:${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    HOME: f.sharedHome,
    LANG: "C.UTF-8",
    TMPDIR: join(f.root, "tmp"),
    USER: process.env.USER ?? "tester",
    LOGNAME: process.env.LOGNAME ?? "tester",
    BENCH_OPENCODE_BIN: join(f.bin, "fake-opencode"),
    FAKE_OPENCODE_RECORD: f.record,
    FAKE_OPENCODE_MODELS_COUNT: f.modelsCount,
    BENCH_DAILY_CATALOG: join(f.root, "catalog.json"),
    BENCH_DAILY_QUOTA_CMD: join(f.bin, "quota"),
    BENCH_DAILY_BATCH: join(f.bin, "batch"),
    BENCH_DAILY_SELECT: join(f.bin, "select"),
    BENCH_DAILY_LOCK: join(f.root, "daily.lock"),
    BENCH_DAILY_DIR: join(f.root, "daily"),
    BENCH_RUNS_ROOT: join(f.root, "runs"),
    BENCH_DAILY_POST: "0",
    BENCH_DAILY_PUBLISH: "0",
    BENCH_PRICING_PATH: join(f.root, "pricing.json"),
    ...extra,
  };
}

/** The dry run of the daily job. */
function runDaily(f: Fixture, extra: Record<string, string>) {
  return spawnSync("bash", [join(f.harness, "cron-daily.sh"), "--dry-run"], {
    cwd: f.repo, env: testEnv(f, extra), encoding: "utf8", timeout: 100_000, maxBuffer: 16 * 1024 * 1024,
  });
}

function readCalls(record: string): Call[] {
  if (!existsSync(record)) return [];
  return readFileSync(record, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Call);
}

/** The calls of the served list. */
function modelsCalls(calls: Call[]): Call[] {
  return calls.filter((call) => call.argv.includes("models"));
}

/** The data folder of a call. */
function dataFolder(call: Call): string {
  return call.XDG_DATA_HOME ? call.XDG_DATA_HOME : join(call.HOME, ".local", "share");
}

describe("the served-list retry of the daily job of FR-11", () => {
  it("retries the served list once and reaches the dry-run plan", () => {
    const f = fixture();
    try {
      const result = runDaily(f, { FAKE_OPENCODE_MODELS_FAIL: "1" });
      const calls = readCalls(f.record);
      const models = modelsCalls(calls);
      expect(models.length,
        `the served list made ${models.length} models calls instead of 2\n${result.stdout}\n${result.stderr}`)
        .toBe(2);
      for (const call of models) {
        expect(call.argv.includes("--standalone"),
          `the models call ${call.argv.join(" ")} has no --standalone flag`).toBe(true);
        expect(dataFolder(call).startsWith(join(f.repo, ".tmp", "opencode-host-")),
          `the models call ${call.argv.join(" ")} does not use the job store of the temp repo`)
          .toBe(true);
      }
      expect(result.status, `the daily job exited ${result.status}\n${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout, "the daily job printed no dry-run plan").toMatch(/^DAILY DRY-RUN planned=[1-9][0-9]*$/m);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("fails the daily job after three served-list calls", () => {
    const f = fixture();
    try {
      const result = runDaily(f, { FAKE_OPENCODE_MODELS_FAIL: "99" });
      const calls = readCalls(f.record);
      const models = modelsCalls(calls);
      expect(models.length,
        `the served list made ${models.length} models calls instead of 3\n${result.stdout}\n${result.stderr}`)
        .toBe(3);
      expect(result.stderr, "the daily job printed no served failure line")
        .toContain("DAILY FAIL served: opencode models failed");
      expect(result.status, `the daily job exited ${result.status}\n${result.stdout}\n${result.stderr}`).toBe(1);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("retries the served list after an empty list and reaches the dry-run plan", () => {
    const f = fixture();
    try {
      // The first call exits 0 and writes no list. The second call writes the
      // model line (spec D15, the empty-list clause).
      const result = runDaily(f, { FAKE_OPENCODE_MODELS_EMPTY: "1" });
      const calls = readCalls(f.record);
      const models = modelsCalls(calls);
      expect(models.length,
        `the served list made ${models.length} models calls instead of 2\n${result.stdout}\n${result.stderr}`)
        .toBe(2);
      for (const call of models) {
        expect(call.argv.includes("--standalone"),
          `the models call ${call.argv.join(" ")} has no --standalone flag`).toBe(true);
        expect(dataFolder(call).startsWith(join(f.repo, ".tmp", "opencode-host-")),
          `the models call ${call.argv.join(" ")} does not use the job store of the temp repo`)
          .toBe(true);
      }
      expect(result.status, `the daily job exited ${result.status}\n${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout, "the daily job printed no dry-run plan").toMatch(/^DAILY DRY-RUN planned=[1-9][0-9]*$/m);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);
});
