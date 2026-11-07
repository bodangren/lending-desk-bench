import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The quiet environ read test of FR-14 (spec D18).
 *
 * Spec EV16: the line `/proc/<pid>/environ: Permission denied` sits in all
 * 7 preflight logs and in `reports/cron-daily.log`. `[ -r ]` passes for
 * `/proc/1571/environ` (systemd --user), but the open fails, and the shell
 * prints the error.
 *
 * Spec D18: `opencode_host_marked_pids` reads the process table from
 * `${BENCH_OPENCODE_PROC:-/proc}`. A read fault of one `environ` file
 * writes nothing to stderr and skips that pid. The marker rule and the
 * `$$`/`$BASHPID` skip do not change.
 *
 * No test writes under the real `.tmp/`, `runs/`, or `reports/`. No test
 * starts the real `opencode` binary, Podman, a browser, or a model.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const HOST_SH = join(HARNESS, "opencode-host.sh");
const TIMEOUT = 120_000;

/**
 * Run `opencode_host_marked_pids <jobFolder>` in a fresh bash that sources
 * the production file. The extra environment is passed as-is.
 */
function runMarkedPids(jobFolder: string, extra: Record<string, string>) {
  const script = `source "${HOST_SH}"; opencode_host_marked_pids "$1"`;
  return spawnSync("bash", ["-c", script, "_", jobFolder], {
    env: {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
      ...extra,
    },
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

describe("the quiet environ read of FR-14", () => {
  it("skips an unreadable environ in the fake proc root and prints the marker match alone", () => {
    const root = mkdtempSync(join(tmpdir(), "quiet-environ-"));
    try {
      const job = join(root, "job");
      const proc = join(root, "proc");
      mkdirSync(job, { recursive: true });
      // 4242: environ is a folder. `[ -r ]` passes, but the read fails.
      // 4243: environ holds the marker line for the job folder.
      mkdirSync(join(proc, "4242", "environ"), { recursive: true });
      mkdirSync(join(proc, "4243"), { recursive: true });
      writeFileSync(join(proc, "4243", "environ"), `FOO=1\0BENCH_OPENCODE_JOB=${job}\0`);
      const result = runMarkedPids(job, { BENCH_OPENCODE_PROC: proc });
      expect(result.stdout, `the marked pids printed the wrong pids (stderr: ${result.stderr})`)
        .toBe("4243\n");
      expect(result.stderr, "a read fault wrote text to stderr").toBe("");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, TIMEOUT);

  it("reads the real proc table with no environ text on stderr", () => {
    const root = mkdtempSync(join(tmpdir(), "quiet-environ-"));
    try {
      // A folder that no process uses. On this host, pid 1571 (systemd
      // --user) makes the current code print `Permission denied` for its
      // environ (spec EV16), so the stderr check fails on Red. On a host
      // without such a pid, this case passes trivially.
      const job = join(root, "no-such-job-folder");
      const result = runMarkedPids(job, {});
      expect(result.stdout, `no process may carry the marker of ${job}`).toBe("");
      expect(result.stderr, "the real proc scan wrote environ text to stderr").not.toMatch(/environ/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, TIMEOUT);
});
