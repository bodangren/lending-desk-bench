import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The seed failure classes test of FR-12 (spec D16, amendment 2755349).
 *
 * The round-2 rule splits the selection failures of the seed. A retryable
 * failure retries until N calls: a non-zero `opencode` exit, an empty output,
 * or a selection pass whose stderr holds `did not print` (no JSON array or no
 * valid JSON). That no-JSON report is the known transient fault: the export
 * exits 0, prints a plugin notice, and prints no JSON. Every other selection
 * failure names a fixed state of the shared store (no active Console
 * connection, two or more active connections, a missing or invalid `expires`
 * value): it writes its reason line, then the seed-failed line, and exits 2
 * after that one call.
 *
 * The test copies the helper and the host wrapper into a temp repo, so the
 * job folder sits under the temp repo. No test writes under the real
 * `.tmp/`, `runs/`, or `reports/`. No test starts the real `opencode`
 * binary, Podman, a browser, or a model. The fake file name holds
 * `fake-opencode`, so a `ps` check finds a rest.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TIMEOUT = 120_000;

/** The scripts that the test copies into the temp repo. */
const SCRIPTS = ["opencode-credential.sh", "opencode-host.sh"];

/** The fake credential values. They must never reach stderr or stdout. */
const FAKE_ACCESS = "fake-access-T0KEN-43";
const FAKE_REFRESH = "fake-refresh-43";
const FAKE_ORG = "fake-org-43";
const FAKE_ACCESS_2 = "fake-access-T0KEN-44";

/** The delays of every case: four whole-second waits, so N = 5 (spec D16). */
const SEED_DELAYS = "0 0 0 0";

type Fixture = {
  root: string;
  repo: string;
  harness: string;
  bin: string;
  sharedHome: string;
  fake: string;
  count: string;
};

/**
 * The fake `opencode`. It starts no server and calls no model. It counts
 * its `auth export` calls in a count file. Its behavior per call comes
 * from `FAKE_OPENCODE_PLAN` (a comma list of kinds) with the kind
 * `FAKE_OPENCODE_AFTER` once the list is done. The kinds:
 * - `notice-stdout`: print the plugin notice on stdout, no JSON, exit 0;
 * - `two`: print a valid array with two active opencode connections, exit 0;
 * - `none`: print a valid array with no active opencode connection, exit 0;
 * - `good`: print the good export, exit 0.
 * On `auth import --standalone` it reads stdin and exits 0.
 */
function fakeOpencode(bin: string): string {
  const path = join(bin, "fake-opencode");
  writeFileSync(path, `#!${process.execPath}
const fs = require("node:fs");
const argv = process.argv.slice(2);
const countFile = process.env.FAKE_OPENCODE_COUNT || "";
function entry(access) {
  const expires = Date.now() + 30 * 24 * 3600 * 1000;
  return { integrationID: "opencode", active: true,
    value: { access: access, refresh: "${FAKE_REFRESH}",
      expires: expires, metadata: { orgID: "${FAKE_ORG}" } } };
}
function payload() {
  return JSON.stringify([entry("${FAKE_ACCESS}")]) + "\\n";
}
function readCount() {
  try { return Number(fs.readFileSync(countFile, "utf8").trim() || "0"); } catch { return 0; }
}
if (argv[0] === "auth" && argv[1] === "export") {
  const n = readCount() + 1;
  fs.writeFileSync(countFile, String(n));
  const plan = (process.env.FAKE_OPENCODE_PLAN || "").split(",").filter(Boolean);
  const kind = n <= plan.length ? plan[n - 1] : (process.env.FAKE_OPENCODE_AFTER || "good");
  if (kind === "notice-stdout") { process.stdout.write("Location plugins did not finish activating\\n"); process.exit(0); }
  if (kind === "two") { process.stdout.write(JSON.stringify([entry("${FAKE_ACCESS}"), entry("${FAKE_ACCESS_2}")]) + "\\n"); process.exit(0); }
  if (kind === "none") { process.stdout.write(JSON.stringify([{ integrationID: "other", active: true, value: { access: "${FAKE_ACCESS_2}", refresh: "${FAKE_REFRESH}", expires: Date.now() + 30 * 24 * 3600 * 1000, metadata: { orgID: "${FAKE_ORG}" } } }]) + "\\n"); process.exit(0); }
  if (kind === "good") { process.stdout.write(payload()); process.exit(0); }
  process.exit(96);
}
if (argv[0] === "auth" && argv[1] === "import") {
  fs.readFileSync(0, "utf8");
  process.exit(0);
}
process.exit(0);
`);
  chmodSync(path, 0o755);
  return path;
}

/** The temp repo of one case. */
function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "credential-seed-classes-"));
  const repo = join(root, "repo");
  const harness = join(repo, "harness");
  const bin = join(root, "bin");
  const sharedHome = join(root, "shared-home");
  mkdirSync(harness, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(sharedHome, { recursive: true });
  mkdirSync(join(root, "tmp"), { recursive: true });
  for (const name of SCRIPTS) {
    writeFileSync(join(harness, name), readFileSync(join(HARNESS, name)), { mode: 0o644 });
  }
  const fake = fakeOpencode(bin);
  return { root, repo, harness, bin, sharedHome, fake, count: join(root, "export-count.txt") };
}

/** The environment of one seed run. It holds no BENCH_OPENCODE_HOME. */
function seedEnv(f: Fixture, plan: string, after: string, fake: string): Record<string, string> {
  return {
    PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    HOME: f.sharedHome,
    LANG: "C.UTF-8",
    TMPDIR: join(f.root, "tmp"),
    USER: process.env.USER ?? "tester",
    LOGNAME: process.env.LOGNAME ?? "tester",
    BENCH_OPENCODE_BIN: fake,
    BENCH_CREDENTIAL_SEED_DELAYS: SEED_DELAYS,
    FAKE_OPENCODE_COUNT: f.count,
    FAKE_OPENCODE_PLAN: plan,
    FAKE_OPENCODE_AFTER: after,
  };
}

/** Run the helper mode `seed` of the copied script. */
function runSeed(f: Fixture, plan: string, after: string, fake: string) {
  return spawnSync("bash", [join(f.harness, "opencode-credential.sh"), "seed"], {
    cwd: f.repo, env: seedEnv(f, plan, after, fake), encoding: "utf8",
    timeout: 100_000, maxBuffer: 8 * 1024 * 1024,
  });
}

/** The export calls of the fake. */
function exportCount(f: Fixture): number {
  if (!existsSync(f.count)) return 0;
  return Number(readFileSync(f.count, "utf8").trim() || "0");
}

type Attempt = { n: string; total: string; reason: string };

/** The seed attempt lines on stderr, in order. */
function attempts(stderr: string): Attempt[] {
  const out: Attempt[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const m = /^opencode-credential: seed attempt ([0-9]+)\/([0-9]+) failed: (.*)$/.exec(line);
    if (m) out.push({ n: m[1], total: m[2], reason: m[3] });
  }
  return out;
}

/** The leftover job folders under the temp repo. */
function leftoverJobFolders(f: Fixture): string[] {
  const tmp = join(f.repo, ".tmp");
  if (!existsSync(tmp)) return [];
  return readdirSync(tmp).filter((name) => name.startsWith("opencode-host-"));
}

/** The last stderr line that starts with the helper prefix. */
function lastHelperLine(stderr: string): string | undefined {
  return stderr.split(/\r?\n/).filter((line) => line.startsWith("opencode-credential: ")).at(-1);
}

/** The assertions every case shares: no credential value on stderr or
 * stdout, no leftover job folder. */
function expectNoLeak(f: Fixture, result: { stdout: string; stderr: string; status: number | null }) {
  for (const value of [FAKE_ACCESS, FAKE_ACCESS_2, FAKE_REFRESH, FAKE_ORG]) {
    expect(result.stderr, `the seed stderr holds the credential value ${value}`).not.toContain(value);
    expect(result.stdout, `the seed stdout holds the credential value ${value}`).not.toContain(value);
  }
  expect(leftoverJobFolders(f), "a job folder stayed under the temp repo").toEqual([]);
}

describe("the seed failure classes of FR-12", () => {
  it("retries a no-JSON export that exits 0 and seeds on the second call", () => {
    const f = fixture();
    try {
      const result = runSeed(f, "notice-stdout", "good", f.fake);
      expect(result.status, `the seed exited ${result.status}\n${result.stdout}\n${result.stderr}`).toBe(0);
      expect(exportCount(f), "the seed did not make 2 export calls").toBe(2);
      const got = attempts(result.stderr);
      expect(got.length, `the seed wrote ${got.length} attempt lines instead of 1\n${result.stderr}`).toBe(1);
      expect(got[0]?.n, "the attempt line does not name call 1").toBe("1");
      expect(got[0]?.total, "the attempt line does not show N=5 with four waits (spec D16)").toBe("5");
      expect(got[0]?.reason, "the no-JSON export must report the reason no JSON array").toBe("no JSON array");
      expectNoLeak(f, result);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("fails closed after one call when two active Console connections exist", () => {
    const f = fixture();
    try {
      const result = runSeed(f, "", "two", f.fake);
      expect(result.status, `the seed exited ${result.status} instead of 2\n${result.stdout}\n${result.stderr}`).toBe(2);
      expect(exportCount(f), "a fixed state of the shared store must make exactly 1 export call").toBe(1);
      const got = attempts(result.stderr);
      expect(got.length, `the seed wrote ${got.length} attempt lines instead of 1\n${result.stderr}`).toBe(1);
      expect(got[0]?.n, "the attempt line does not name call 1").toBe("1");
      expect(got[0]?.total, "the attempt line does not show N=5").toBe("5");
      expect(got[0]?.reason, "the ambiguous state must report the reason selection failed").toBe("selection failed");
      expect(lastHelperLine(result.stderr), "the last opencode-credential line is not the seed-failed line")
        .toBe("opencode-credential: the Console credential seed failed");
      expectNoLeak(f, result);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("fails closed after one call when no active Console connection exists", () => {
    const f = fixture();
    try {
      const result = runSeed(f, "", "none", f.fake);
      expect(result.status, `the seed exited ${result.status} instead of 2\n${result.stdout}\n${result.stderr}`).toBe(2);
      expect(exportCount(f), "a fixed state of the shared store must make exactly 1 export call").toBe(1);
      const got = attempts(result.stderr);
      expect(got.length, `the seed wrote ${got.length} attempt lines instead of 1\n${result.stderr}`).toBe(1);
      expect(got[0]?.reason, "the missing connection must report the reason no active Console connection")
        .toBe("no active Console connection");
      expect(lastHelperLine(result.stderr), "the last opencode-credential line is not the seed-failed line")
        .toBe("opencode-credential: the Console credential seed failed");
      expectNoLeak(f, result);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);
});
