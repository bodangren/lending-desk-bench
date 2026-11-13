import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The self-check test of FR-9.
 *
 * The test runs `cron-daily.sh` with a fake `BENCH_DAILY_BATCH`. The fake
 * records the value of `BENCH_SELFCHECK` of each batch. The daily job must
 * give each batch the value `logic` when the caller sets no value. An
 * explicit caller value stays.
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

/** The scripts that the test copies into the temp repo. */
const SCRIPTS = [
  "cron-daily.sh", "env.sh", "toolchain.sh", "opencode-credential.sh",
  "opencode-host.sh",
];

type Fixture = {
  root: string;
  repo: string;
  harness: string;
  bin: string;
  sharedHome: string;
  record: string;
  selfcheck: string;
};

/** The fake `opencode`. It starts no server and calls no model. */
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
  const root = mkdtempSync(join(tmpdir(), "daily-selfcheck-default-"));
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
  writeFileSync(join(sharedHome, ".local", "share", "opencode", "fake-auth.json"), JSON.stringify([{
    id: "fake-console-1", integrationID: "opencode", label: "Fake Console", active: true,
    value: {
      type: "oauth", methodID: "device", access: "fake-access", refresh: "fake-refresh",
      expires: 4102444800000, metadata: { orgID: "fake-org", server: "https://opencode.ai/console" },
    },
  }]) + "\n");
  writeFileSync(join(root, "catalog.json"), JSON.stringify({ live: [MODEL_REF] }) + "\n");
  writeFileSync(join(root, "pricing.json"), JSON.stringify({ provider: "opencode-go", models: { [MODEL]: {} } }) + "\n");
  writeFileSync(join(root, "served.txt"), `${MODEL_REF}\n`);
  shellStub(bin, "quota", `printf '{"usage":{"windows":{"weekly":{"usedPercent":10},"monthly":{"usedPercent":20}}}}\\n'`);
  shellStub(bin, "select", `printf '{"model":"${MODEL_REF}","run_ids":[],"reason":"new"}\\n'`);
  // The notice sink of D17. It keeps the test away from the PM session.
  shellStub(bin, "notify", `printf '%s\\n' "$1" >> ${JSON.stringify(join(root, "notify-sink.txt"))}`);
  return { root, repo, harness, bin, sharedHome, record: join(root, "calls.jsonl"), selfcheck: join(root, "selfcheck.txt") };
}

/** The environment of one case. It holds no XDG variable and no OPENCODE_DB. */
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
    FAKE_SELFCHECK_RECORD: f.selfcheck,
    BENCH_DAILY_CATALOG: join(f.root, "catalog.json"),
    BENCH_DAILY_SERVED: join(f.root, "served.txt"),
    BENCH_DAILY_QUOTA_CMD: join(f.bin, "quota"),
    BENCH_DAILY_BATCH: join(f.bin, "batch"),
    BENCH_DAILY_SELECT: join(f.bin, "select"),
    BENCH_DAILY_LOCK: join(f.root, "daily.lock"),
    BENCH_DAILY_DIR: join(f.root, "daily"),
    BENCH_RUNS_ROOT: join(f.root, "runs"),
    BENCH_DAILY_POST: "0",
    BENCH_DAILY_PUBLISH: "0",
    BENCH_DAILY_NOTIFY_CMD: join(f.bin, "notify"),
    BENCH_PRICING_PATH: join(f.root, "pricing.json"),
    ...extra,
  };
}

/** The fake batch. It records the value of `BENCH_SELFCHECK`. */
function fakeBatch(f: Fixture): string {
  return shellStub(f.bin, "batch", `printf '%s\\n' "\${BENCH_SELFCHECK-<unset>}" >> "$FAKE_SELFCHECK_RECORD"`);
}

function readSelfcheck(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
}

describe("the self-check of the daily job of FR-9", () => {
  it("gives each batch the logic self-check when the caller sets no value", () => {
    const f = fixture();
    try {
      fakeBatch(f);
      const env = testEnv(f, {});
      const result = spawnSync("bash", [join(f.harness, "cron-daily.sh")], {
        cwd: f.repo, env, encoding: "utf8", timeout: 100_000, maxBuffer: 16 * 1024 * 1024,
      });
      const values = readSelfcheck(f.selfcheck);
      expect(values.length, `the daily job ran no batch\n${result.stdout}\n${result.stderr}`)
        .toBeGreaterThan(0);
      expect(values, "the daily job did not give each batch the logic self-check")
        .toEqual(values.map(() => "logic"));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("keeps the self-check of an explicit caller value", () => {
    const f = fixture();
    try {
      fakeBatch(f);
      const env = testEnv(f, { BENCH_SELFCHECK: "meta" });
      const result = spawnSync("bash", [join(f.harness, "cron-daily.sh")], {
        cwd: f.repo, env, encoding: "utf8", timeout: 100_000, maxBuffer: 16 * 1024 * 1024,
      });
      const values = readSelfcheck(f.selfcheck);
      expect(values.length, `the daily job ran no batch\n${result.stdout}\n${result.stderr}`)
        .toBeGreaterThan(0);
      expect(values, "the daily job did not keep the self-check of the caller")
        .toEqual(values.map(() => "meta"));
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);
});
