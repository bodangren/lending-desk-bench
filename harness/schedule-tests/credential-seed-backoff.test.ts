import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The seed back-off test of FR-12 (spec D16, EV16).
 *
 * The live day of 2026-11-08 01:00 failed at the seed: three calls 5 s
 * apart, no reason line (the stderr of `opencode` goes to /dev/null), and a
 * latent leak when `opencode` prints a valid JSON array and exits non-zero
 * (harness/opencode-credential.sh:179 prints $output to stderr).
 *
 * Spec D16 gives the rule: up to N calls with the waits of
 * `BENCH_CREDENTIAL_SEED_DELAYS` (a list of whole seconds, N = waits + 1),
 * one stderr line `opencode-credential: seed attempt <n>/<N> failed:
 * <reason>` after each failed call, the ordered reason list, and no print
 * of the opencode stdout or stderr text.
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

/** The fake credential values. They must never reach stderr (EV16 leak). */
const FAKE_ACCESS = "fake-access-T0KEN-41";
const FAKE_REFRESH = "fake-refresh-41";
const FAKE_ORG = "fake-org-41";

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
 * - `fail-stderr`: exit 1, stderr holds the transient plugin notice of EV15;
 * - `fail`: exit 1, no stderr, no stdout;
 * - `timeout`: exit 124;
 * - `good-fail`: print the good export, then exit 1 (the EV16 leak path);
 * - `good`: print the good export, exit 0.
 * On `auth import --standalone` it reads stdin and exits 0.
 */
function fakeOpencode(bin: string): string {
  const path = join(bin, "fake-opencode");
  writeFileSync(path, `#!${process.execPath}
const fs = require("node:fs");
const argv = process.argv.slice(2);
const countFile = process.env.FAKE_OPENCODE_COUNT || "";
function goodPayload() {
  const expires = Date.now() + 30 * 24 * 3600 * 1000;
  return JSON.stringify([{
    integrationID: "opencode", active: true,
    value: { access: "${FAKE_ACCESS}", refresh: "${FAKE_REFRESH}",
      expires: expires, metadata: { orgID: "${FAKE_ORG}" } },
  }]) + "\\n";
}
function readCount() {
  try { return Number(fs.readFileSync(countFile, "utf8").trim() || "0"); } catch { return 0; }
}
if (argv[0] === "auth" && argv[1] === "export") {
  const n = readCount() + 1;
  fs.writeFileSync(countFile, String(n));
  const plan = (process.env.FAKE_OPENCODE_PLAN || "").split(",").filter(Boolean);
  const kind = n <= plan.length ? plan[n - 1] : (process.env.FAKE_OPENCODE_AFTER || "good");
  if (kind === "fail-stderr") {
    process.stderr.write("ServiceUnavailableError: Location plugins did not finish activating\\n");
    process.exit(1);
  }
  if (kind === "fail") process.exit(1);
  if (kind === "timeout") process.exit(124);
  if (kind === "good-fail") { process.stdout.write(goodPayload()); process.exit(1); }
  if (kind === "good") { process.stdout.write(goodPayload()); process.exit(0); }
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
  const root = mkdtempSync(join(tmpdir(), "credential-seed-backoff-"));
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

/** The assertions every case shares: no credential value on stderr, no
 * leftover job folder. */
function expectNoLeak(f: Fixture, result: { stdout: string; stderr: string; status: number | null }) {
  for (const value of [FAKE_ACCESS, FAKE_REFRESH, FAKE_ORG]) {
    expect(result.stderr, `the seed stderr holds the credential value ${value} (the EV16 leak)`).not.toContain(value);
    expect(result.stdout, `the seed stdout holds the credential value ${value}`).not.toContain(value);
  }
  expect(leftoverJobFolders(f), "a job folder stayed under the temp repo").toEqual([]);
}

describe("the seed back-off of FR-12", () => {
  it("retries three failed exports and seeds on the fourth call", () => {
    const f = fixture();
    try {
      const result = runSeed(f, "fail-stderr,fail-stderr,fail-stderr", "good", f.fake);
      expect(result.status, `the seed exited ${result.status}\n${result.stdout}\n${result.stderr}`).toBe(0);
      expect(exportCount(f), "the seed did not make 4 export calls").toBe(4);
      const got = attempts(result.stderr);
      expect(got.length, `the seed wrote ${got.length} attempt lines instead of 3\n${result.stderr}`).toBe(3);
      for (const [i, attempt] of got.entries()) {
        expect(attempt.n, `the ${i + 1}. attempt line names the wrong call` + `\n${result.stderr}`).toBe(String(i + 1));
        expect(attempt.total, `the attempt line does not show N=5 with four waits (spec D16)\n${result.stderr}`).toBe("5");
        expect(attempt.reason, `the ${i + 1}. attempt line holds the wrong reason\n${result.stderr}`)
          .toBe("plugins did not finish activating");
      }
      expectNoLeak(f, result);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("fails after five calls when every export exits 1 with no stderr", () => {
    const f = fixture();
    try {
      const result = runSeed(f, "fail,fail,fail,fail,fail", "fail", f.fake);
      expect(result.status, `the seed exited ${result.status} instead of 2\n${result.stdout}\n${result.stderr}`).toBe(2);
      expect(exportCount(f), "the seed did not make 5 export calls").toBe(5);
      const got = attempts(result.stderr);
      expect(got.length, `the seed wrote ${got.length} attempt lines instead of 5\n${result.stderr}`).toBe(5);
      for (const [i, attempt] of got.entries()) {
        expect(attempt.n, `the ${i + 1}. attempt line names the wrong call`).toBe(String(i + 1));
        expect(attempt.total, `the attempt line does not show N=5`).toBe("5");
        expect(attempt.reason, `the ${i + 1}. attempt line holds the wrong reason`).toBe("exit 1");
      }
      const credentialLines = result.stderr.split(/\r?\n/).filter((line) => line.startsWith("opencode-credential: "));
      expect(credentialLines.at(-1), "the last opencode-credential line is not the seed-failed line")
        .toBe("opencode-credential: the Console credential seed failed");
      expectNoLeak(f, result);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("reports timeout for a 124 exit and seeds on the next call", () => {
    const f = fixture();
    try {
      const result = runSeed(f, "timeout", "good", f.fake);
      expect(result.status, `the seed exited ${result.status}\n${result.stdout}\n${result.stderr}`).toBe(0);
      expect(exportCount(f), "the seed did not make 2 export calls").toBe(2);
      const got = attempts(result.stderr);
      expect(got.length, `the seed wrote ${got.length} attempt lines instead of 1\n${result.stderr}`).toBe(1);
      expect(got[0]?.n, "the attempt line does not name call 1").toBe("1");
      expect(got[0]?.total, "the attempt line does not show N=5").toBe("5");
      expect(got[0]?.reason, "the 124 exit must report the reason timeout").toBe("timeout");
      expectNoLeak(f, result);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("reports exit 1 for a good print with a non-zero exit and does not leak", () => {
    const f = fixture();
    try {
      const result = runSeed(f, "good-fail", "good", f.fake);
      expect(result.status, `the seed exited ${result.status}\n${result.stdout}\n${result.stderr}`).toBe(0);
      expect(exportCount(f), "the seed did not make 2 export calls").toBe(2);
      const got = attempts(result.stderr);
      expect(got.length, `the seed wrote ${got.length} attempt lines instead of 1\n${result.stderr}`).toBe(1);
      expect(got[0]?.n, "the attempt line does not name call 1").toBe("1");
      expect(got[0]?.total, "the attempt line does not show N=5").toBe("5");
      expect(got[0]?.reason, "the exit-1 call with a good print must report the reason exit 1").toBe("exit 1");
      expectNoLeak(f, result);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  }, TIMEOUT);
});
