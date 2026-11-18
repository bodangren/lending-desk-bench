/**
 * The provider credential of task 4.3 (spec D14, D15, D22; the secrecy rule
 * of test-strategy 9.4).
 *
 * The tool under test is `harness/model-guide/provider-credential.sh`. That
 * file does not exist at the base of Phase 4, so every case fails for the
 * missing script. The Green task 4.6 implements the contract below.
 *
 * Pinned command-line interface:
 *   bash harness/model-guide/provider-credential.sh seed <provider>
 *   bash harness/model-guide/provider-credential.sh scan-values <provider>
 *
 * Contract:
 *   - Every error is one line on stderr `provider-credential: <reason>` and
 *     exit 2. stdout holds no error text.
 *   - `seed <p>` reads the shared store with one `opencode auth export`
 *     call, retried on a transient failure with the waits of
 *     `BENCH_CREDENTIAL_SEED_DELAYS` (default `5 15 30 60`). It selects the
 *     active entry whose `provider` field is `<p>` and imports exactly that
 *     one entry into the job store with `opencode auth import`. stdout is
 *     empty. exit 0.
 *   - `scan-values <p>` reads the job store, selects the entry of `<p>`,
 *     and prints its values, one per line, in this order: the access value,
 *     then the orgID. The refresh value `inert` is not printed. exit 0.
 *   - A provider with no entry gives exit 2, one named line, no value on
 *     stdout, and no new entry in the job store.
 *   - `BENCH_CREDENTIAL_SEED_DELAYS` must be a list of whole seconds and
 *     `AGENT_TIMEOUT` must be a non-negative integer. A bad value gives exit
 *     2 and one named line before any `opencode` call.
 *   - The helper writes no credential value to any file (spec D14) and
 *     prints a value only on the stdout of `scan-values`.
 *
 * The shared export of the fake holds three entries: two providers and one
 * entry of another kind. The entry of a provider has these fields:
 *
 *   {"integrationID":"opencode","active":true,"provider":"<id>",
 *    "value":{"access":"...","refresh":"inert","expires":4102444800000,
 *             "metadata":{"orgID":"..."}}}
 *
 * The fake `opencode` is a temp script that the test writes:
 *
 *   - The path of the PATH entry ends in `fake-opencode.d/opencode`, and
 *     `BENCH_OPENCODE_BIN` names `fake-opencode`, so no call can reach the
 *     real `opencode` binary.
 *   - `auth export` prints the job store file when it holds entries, and the
 *     shared export file otherwise. `FAKE_OPENCODE_FAIL_FIRST=<n>` makes the
 *     first <n> shared exports exit 1 with a notice on stderr.
 *     `FAKE_OPENCODE_PAD=<bytes>` adds that many pad bytes to the first
 *     entry of the shared export.
 *   - `auth import` appends the payload of stdin to the job store file.
 *   - The job store file sits outside the job folder, so a grep of the whole
 *     job folder proves that the helper writes no value (case C6).
 *
 * Every case copies the scripts it runs into a temp repo, in the pattern of
 * `harness/schedule-tests/rescore-guard.test.ts`. The environment holds
 * HOME, XDG_CONFIG_HOME, XDG_DATA_HOME, XDG_STATE_HOME, XDG_CACHE_HOME,
 * XDG_RUNTIME_DIR, TMPDIR, and TZ inside the temp tree, and it clears
 * `BENCH_TRACK`. The test reads no real credential file, prints no real
 * value, and starts no `opencode` CLI.
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");

/** The module under test. Its path is fixed, so a gate cannot point the
 * test at a file outside the repository. */
const SCRIPT_SOURCE = join(HARNESS, "model-guide", "provider-credential.sh");
const HOST_SOURCE = join(HARNESS, "opencode-host.sh");

/** The providers of the fake shared export. The values are obvious fakes. */
const PROVIDER_A = "opencode-go";
const PROVIDER_B = "kimi-code-plan-cn";
const PROVIDER_NONE = "volcengine-agent-plan";
const ACCESS_A = "FAKE-ACCESS-OPENCODIGO-0001";
const ORG_A = "FAKE-ORGID-OPENCODIGO-0001";
const ACCESS_B = "FAKE-ACCESS-KIMICODECN-0002";
const ORG_B = "FAKE-ORGID-KIMICODECN-0002";
const ACCESS_C = "FAKE-ACCESS-OTHERKIND-0003";
const ORG_C = "FAKE-ORGID-OTHERKIND-0003";

/** Every fake value of the shared export. */
const VALUES = [ACCESS_A, ORG_A, ACCESS_B, ORG_B, ACCESS_C, ORG_C];

const TWO_MIB = 2 * 1024 * 1024;

// --- the PM load watch: this file leaves no server and no child ----------
// This file starts no quota server. Every child runs under `spawnSync`, so
// the run waits for each exit. The registry below removes a temp folder
// that a failing test left behind.
/** The temp folders this file created. */
const tempRoots = new Set<string>();

/** Removes every temp folder this file created and did not remove yet. */
function sweepTempRoots(): void {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
}

process.on("exit", sweepTempRoots);
process.on("SIGINT", () => {
  sweepTempRoots();
  process.exit(130);
});
process.on("SIGTERM", () => {
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

afterEach(() => {
  sweepTempRoots();
});

/** The load watch of the PM: no server and no fake child of this run may
 * stay alive after the file. The scan keeps the lines that hold a temp
 * folder of this suite (`mg-`). */
afterAll(() => {
  sweepTempRoots();
  const quotaOrphans = commandLines(["pgrep", "-f", "mg-.*quota-server"]);
  const fakeOrphans = commandLines(["bash", "-c", "ps -eo pid,args | grep '[f]ake-opencode'"]);
  const mine = [...quotaOrphans, ...fakeOrphans].filter((line) => line.includes("mg-"));
  expect(mine, "an orphan process of this run stays alive").toEqual([]);
});

/** The fake `opencode`. It is a temp script, never the real binary. */
const FAKE_SOURCE = `#!/usr/bin/env bash
set -uo pipefail
SHARED_FILE="$FAKE_OPENCODE_SHARED"
STORE_FILE="$FAKE_OPENCODE_STORE"
COUNTER_FILE="$FAKE_OPENCODE_COUNTER"
ARGV_FILE="$FAKE_OPENCODE_ARGV"
if [ -n "$ARGV_FILE" ]; then
  printf '%s\n' "$*" >> "$ARGV_FILE"
fi
if [ "$1" != "auth" ]; then
  echo "fake-opencode: only auth is supported" >&2
  exit 2
fi
case "$2" in
  export)
    if [ -s "$STORE_FILE" ]; then
      cat "$STORE_FILE"
      exit 0
    fi
    n=0
    if [ -f "$COUNTER_FILE" ]; then
      n="$(cat "$COUNTER_FILE")"
    fi
    case "$n" in ''|*[!0-9]*) n=0 ;; esac
    n=$((n + 1))
    echo "$n" > "$COUNTER_FILE"
    if [ "$FAKE_OPENCODE_FAIL_FIRST" -gt 0 ] && [ "$n" -le "$FAKE_OPENCODE_FAIL_FIRST" ]; then
      echo "plugin notice: the export did not finish" >&2
      exit 1
    fi
    cat "$SHARED_FILE"
    ;;
  import)
    payload="$(mktemp "$STORE_FILE.incoming.XXXXXX")" || exit 2
    cat > "$payload"
    node -e 'const fs=require("node:fs");const incoming=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const store=process.argv[2];let current=[];if(fs.existsSync(store)){try{current=JSON.parse(fs.readFileSync(store,"utf8"))}catch{}}fs.writeFileSync(store,JSON.stringify([...current,...incoming]));' "$payload" "$STORE_FILE" || {
      rm -f "$payload"
      exit 2
    }
    rm -f "$payload"
    ;;
  *)
    echo "fake-opencode: unknown auth subcommand" >&2
    exit 2
    ;;
esac
exit 0
`;

/** One temp tree of a case. */
interface Fixture {
  root: string;
  repo: string;
  job: string;
  bin: string;
  raw: string;
  shared: string;
  store: string;
  counter: string;
  argvLog: string;
  env: Record<string, string>;
  close(): void;
}

/** The shared export of the fake: two providers and one other kind. */
function sharedExport(pad = 0): string {
  const entries: Array<Record<string, unknown>> = [
    {
      integrationID: "opencode",
      active: true,
      provider: PROVIDER_A,
      value: {
        access: ACCESS_A,
        refresh: "inert",
        expires: 4102444800000,
        metadata: { orgID: ORG_A },
      },
    },
    {
      integrationID: "opencode",
      active: true,
      provider: PROVIDER_B,
      value: {
        access: ACCESS_B,
        refresh: "inert",
        expires: 4102444800000,
        metadata: { orgID: ORG_B },
      },
    },
    {
      integrationID: "anthropic",
      active: true,
      value: {
        access: ACCESS_C,
        refresh: "inert",
        expires: 4102444800000,
        metadata: { orgID: ORG_C },
      },
    },
  ];
  if (pad > 0) entries[0].pad = "x".repeat(pad);
  return `${JSON.stringify(entries, null, 2)}\n`;
}

/** Builds the temp repo, the job folder, the fake, and the env of a case. */
function buildFixture(options: { failFirst?: number; pad?: number } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "mg-cred-"));
  tempRoots.add(root);
  const repo = join(root, "repo");
  const guide = join(repo, "harness", "model-guide");
  const job = join(repo, ".tmp", "opencode-host-provider-credential-test");
  const bin = join(root, "bin");
  const fakeDir = join(bin, "fake-opencode.d");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const raw = join(root, "raw");
  const shared = join(root, "shared-export.json");
  const store = join(root, "job-store.json");
  const counter = join(root, "export-calls.txt");
  const argvLog = join(root, "opencode-argv.log");

  for (const dir of [guide, fakeDir, home, tmp, raw]) mkdirSync(dir, { recursive: true });
  for (const sub of ["home", "config", "data", "state", "cache", "runtime", "tmp"]) {
    mkdirSync(join(job, sub), { recursive: true });
  }

  // The scripts that the helper runs sit in the temp repo, so the helper
  // never touches the real repository.
  if (existsSync(HOST_SOURCE)) {
    writeFileSync(join(repo, "harness", "opencode-host.sh"), readFileSync(HOST_SOURCE), { mode: 0o755 });
  }
  if (existsSync(SCRIPT_SOURCE)) {
    writeFileSync(join(guide, "provider-credential.sh"), readFileSync(SCRIPT_SOURCE), { mode: 0o755 });
  }

  writeFileSync(shared, sharedExport(options.pad ?? 0));
  writeFileSync(join(fakeDir, "opencode"), FAKE_SOURCE, { mode: 0o755 });
  writeFileSync(join(bin, "fake-opencode"), FAKE_SOURCE, { mode: 0o755 });
  chmodSync(join(fakeDir, "opencode"), 0o755);
  chmodSync(join(bin, "fake-opencode"), 0o755);

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_RUNTIME_DIR: join(home, "run"),
    TMPDIR: tmp,
    TZ: "UTC",
    PATH: `${fakeDir}:${bin}:${process.env.PATH ?? ""}`,
    BENCH_OPENCODE_HOME: job,
    BENCH_OPENCODE_BIN: join(bin, "fake-opencode"),
    FAKE_OPENCODE_SHARED: shared,
    FAKE_OPENCODE_STORE: store,
    FAKE_OPENCODE_COUNTER: counter,
    FAKE_OPENCODE_ARGV: argvLog,
    FAKE_OPENCODE_FAIL_FIRST: String(options.failFirst ?? 0),
    BENCH_CREDENTIAL_SEED_DELAYS: "5 15 30 60",
    AGENT_TIMEOUT: "3600",
  };
  delete env.BENCH_TRACK;
  delete env.OPENCODE_CONFIG;

  return {
    root,
    repo,
    job,
    bin,
    raw,
    shared,
    store,
    counter,
    argvLog,
    env,
    close: () => {
      rmSync(root, { recursive: true, force: true });
      tempRoots.delete(root);
    },
  };
}

/** The result of one run of the helper. */
interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  elapsed: number;
  error?: Error;
}

/** Runs the helper of the temp repo. */
function runHelper(
  fixture: Fixture,
  args: string[],
  extra: Record<string, string> = {},
  timeoutMs = 20_000,
): RunResult {
  expect(existsSync(SCRIPT_SOURCE), `the provider credential script is missing: ${SCRIPT_SOURCE}`).toBe(true);
  const started = Date.now();
  const result = spawnSync(
    "bash",
    [join(fixture.repo, "harness", "model-guide", "provider-credential.sh"), ...args],
    {
      cwd: fixture.repo,
      env: { ...fixture.env, ...extra },
      encoding: "utf8",
      timeout: timeoutMs,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    elapsed: Date.now() - started,
    error: result.error,
  };
}

/** The named lines of the helper. */
function namedLines(result: RunResult): string[] {
  return result.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^provider-credential:/.test(line));
}

/** The non-empty stderr lines of a run. */
function stderrLines(result: RunResult): string[] {
  return result.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The shape of a refusal: exit 2, empty stdout, one named line. */
function expectRefusal(result: RunResult, label: string): void {
  expect(result.status, `${label}: ${result.stdout}\n${result.stderr}`).toBe(2);
  expect(result.stdout, `${label}: stdout must be empty`).toBe("");
  const lines = stderrLines(result);
  expect(lines, `${label}: stderr must hold exactly one line, got ${JSON.stringify(lines)}`).toHaveLength(1);
  expect(lines[0], `${label}: the line must start with "provider-credential:"`).toMatch(/^provider-credential:/);
}

/** The entries of the job store. An absent store holds no entry. */
function storeEntries(fixture: Fixture): Array<Record<string, any>> {
  if (!existsSync(fixture.store)) return [];
  const doc = JSON.parse(readFileSync(fixture.store, "utf8"));
  expect(Array.isArray(doc), "the job store is not an array").toBe(true);
  return doc as Array<Record<string, any>>;
}

/** The count of shared export calls of the fake. */
function exportCalls(fixture: Fixture): number {
  if (!existsSync(fixture.counter)) return 0;
  const text = readFileSync(fixture.counter, "utf8").trim();
  return /^\d+$/.test(text) ? Number(text) : 0;
}

/** The argv lines the fake recorded, one per opencode call. */
function argvLines(fixture: Fixture): string[] {
  if (!existsSync(fixture.argvLog)) return [];
  return readFileSync(fixture.argvLog, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The argv tokens of one recorded call line. */
function argvTokens(line: string): string[] {
  return line.split(/\s+/).filter((part) => part !== "");
}

/** The files of one tree. */
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
      if (statSync(full).isDirectory()) walk(full);
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

describe("C1 the seed", () => {
  it("C1 seeds exactly the entry of the provider into the job store and prints no value", () => {
    const fixture = buildFixture();
    try {
      const result = runHelper(fixture, ["seed", PROVIDER_A]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout, "seed printed a value").toBe("");
      expect(
        VALUES.filter((value) => result.stdout.includes(value) || result.stderr.includes(value)),
        "a value reached the output of the seed",
      ).toEqual([]);
      const entries = storeEntries(fixture);
      expect(entries, "the job store does not hold one entry").toHaveLength(1);
      expect(entries[0].provider, "the stored entry is not the entry of the provider").toBe(PROVIDER_A);
      expect(entries[0].value?.access, "the stored access value is wrong").toBe(ACCESS_A);
      const stored = JSON.stringify(entries);
      expect(stored.includes(ACCESS_B), "the entry of the second provider stayed in").toBe(false);
      expect(stored.includes(ORG_B), "the orgID of the second provider stayed in").toBe(false);
      expect(stored.includes(ACCESS_C), "the entry of the other kind stayed in").toBe(false);
      expect(stored.includes(ORG_C), "the orgID of the other kind stayed in").toBe(false);
      expect(exportCalls(fixture), "the seed read the shared store more than once").toBe(1);
    } finally {
      fixture.close();
    }
  });
});

describe("C2 the value scan", () => {
  it("C2 scan-values prints the access and orgID that a raw output holds", () => {
    const fixture = buildFixture();
    try {
      const seed = runHelper(fixture, ["seed", PROVIDER_A]);
      expect(seed.status, `${seed.stdout}\n${seed.stderr}`).toBe(0);

      const rawPath = join(fixture.raw, "raw-output-01.txt");
      writeFileSync(
        rawPath,
        `{"type":"result","text":"review output\n${ACCESS_A}\n${ORG_A}\nend"}\n`,
      );
      const otherPath = join(fixture.raw, "raw-output-02.txt");
      writeFileSync(otherPath, `{"type":"result","text":"review output\n${ACCESS_B}\n"}\n`);

      const result = runHelper(fixture, ["scan-values", PROVIDER_A]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const lines = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "");
      expect(lines, `scan-values must print two lines, got ${JSON.stringify(lines)}`).toHaveLength(2);
      expect(lines[0], "the first line must be the access value").toBe(ACCESS_A);
      expect(lines[1], "the second line must be the orgID").toBe(ORG_A);
      expect(lines, "the refresh value must not be printed").not.toContain("inert");
      expect(
        lines.filter((line) => line === ACCESS_B || line === ORG_B),
        "scan-values printed a value of another provider",
      ).toEqual([]);
      expect(filesHolding(fixture.raw, ACCESS_A), "the value is not in the raw output").toEqual([rawPath]);
      expect(
        lines.filter((line) => !readFileSync(rawPath, "utf8").includes(line)),
        "a printed value is not in the raw output",
      ).toEqual([]);
      expect(
        lines.filter((line) => readFileSync(otherPath, "utf8").includes(line)),
        "a printed value is in the output of another provider",
      ).toEqual([]);
    } finally {
      fixture.close();
    }
  });
});

describe("C3 a provider with no entry", () => {
  it("C3 a seed for a provider with no entry gives exit 2, one named line, no value, and no store entry", () => {
    const fixture = buildFixture();
    try {
      const result = runHelper(fixture, ["seed", PROVIDER_NONE]);
      expectRefusal(result, "seed");
      expect(existsSync(fixture.store), "the run wrote a job store").toBe(false);
      expect(storeEntries(fixture), "the run wrote a store entry").toHaveLength(0);
      expect(exportCalls(fixture), "the run made no export call").toBeGreaterThan(0);
    } finally {
      fixture.close();
    }
  });

  it("C3 scan-values for a provider with no entry gives exit 2 and no value", () => {
    const fixture = buildFixture();
    try {
      const seed = runHelper(fixture, ["seed", PROVIDER_A]);
      expect(seed.status, `${seed.stdout}\n${seed.stderr}`).toBe(0);
      const before = storeEntries(fixture);
      const result = runHelper(fixture, ["scan-values", PROVIDER_NONE]);
      expectRefusal(result, "scan-values");
      expect(storeEntries(fixture), "the run changed the job store").toHaveLength(before.length);
    } finally {
      fixture.close();
    }
  });
});

describe("C4 the transient export retry", () => {
  it("C4 retries a transient export failure and seeds after two calls", () => {
    const fixture = buildFixture({ failFirst: 1 });
    try {
      const result = runHelper(fixture, ["seed", PROVIDER_A], { BENCH_CREDENTIAL_SEED_DELAYS: "0" });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(exportCalls(fixture), "the helper did not retry the export").toBe(2);
      const entries = storeEntries(fixture);
      expect(entries).toHaveLength(1);
      expect(entries[0].provider).toBe(PROVIDER_A);
    } finally {
      fixture.close();
    }
  });
});

describe("C5 a bad environment value", () => {
  const cases: Array<[label: string, extra: Record<string, string>]> = [
    ["BENCH_CREDENTIAL_SEED_DELAYS=NaN", { BENCH_CREDENTIAL_SEED_DELAYS: "NaN" }],
    ["AGENT_TIMEOUT=Infinity", { AGENT_TIMEOUT: "Infinity" }],
    ["AGENT_TIMEOUT=-1", { AGENT_TIMEOUT: "-1" }],
  ];
  for (const [label, extra] of cases) {
    it(`C5 rejects ${label} before any export call`, () => {
      const fixture = buildFixture();
      try {
        const result = runHelper(fixture, ["seed", PROVIDER_A], extra);
        expectRefusal(result, label);
        expect(result.elapsed, `${label}: the run did not end inside 20 s`).toBeLessThan(20_000);
        expect(exportCalls(fixture), `${label}: the helper called the export before it validated`).toBe(0);
        expect(existsSync(fixture.store), `${label}: the run wrote a job store`).toBe(false);
      } finally {
        fixture.close();
      }
    });
  }
});

describe("C6 no value on disk or in the output", () => {
  it("C6 leaves no credential value in the job folder, in stdout, or in stderr", () => {
    const fixture = buildFixture();
    try {
      const result = runHelper(fixture, ["seed", PROVIDER_A]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      for (const value of VALUES) {
        expect(filesHolding(fixture.job, value), `the job folder holds ${value}`).toEqual([]);
        expect(result.stdout.includes(value), `stdout holds ${value}`).toBe(false);
        expect(result.stderr.includes(value), `stderr holds ${value}`).toBe(false);
      }
      const entries = storeEntries(fixture);
      expect(entries, "the job store holds no entry").toHaveLength(1);
      expect(
        filesHolding(fixture.job, "job-store"),
        "the job store file sits inside the job folder",
      ).toEqual([]);
    } finally {
      fixture.close();
    }
  });
});

describe("C7 a large export", () => {
  it("C7 seeds one entry from a 2 MiB export with a long unknown field", () => {
    const fixture = buildFixture({ pad: TWO_MIB });
    try {
      expect(statSync(fixture.shared).size, "the shared export is not 2 MiB").toBeGreaterThanOrEqual(TWO_MIB);
      const result = runHelper(fixture, ["seed", PROVIDER_A]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const entries = storeEntries(fixture);
      expect(entries, "the job store does not hold one entry").toHaveLength(1);
      expect(entries[0].provider).toBe(PROVIDER_A);
      expect(entries[0].value?.access).toBe(ACCESS_A);
      expect(result.stdout, "seed printed a value").toBe("");
    } finally {
      fixture.close();
    }
  });
});

describe("the fake binary of every call", () => {
  it("resolves opencode to the fake, seeds with it, and leaves no fake process", () => {
    const fixture = buildFixture();
    try {
      const resolved = spawnSync("bash", ["-c", "command -v opencode"], {
        env: fixture.env,
        encoding: "utf8",
      });
      const path = (resolved.stdout ?? "").trim();
      expect(path, "the spawn has no opencode on the PATH").not.toBe("");
      expect(path, "the resolved opencode is not the fake").toContain("fake-opencode");
      const result = runHelper(fixture, ["seed", PROVIDER_A]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(exportCalls(fixture), "the helper made no export call").toBe(1);
      expect(storeEntries(fixture), "the fake wrote no store entry").toHaveLength(1);
      expect(liveFakeProcesses(), "a fake process is still alive").toEqual([]);
    } finally {
      fixture.close();
    }
  });
});

describe("ST standalone credential calls (PM stop order 2026-11-19)", () => {
  it("ST1 every call that seed makes holds --standalone", () => {
    const fixture = buildFixture();
    try {
      const result = runHelper(fixture, ["seed", PROVIDER_A]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const lines = argvLines(fixture);
      expect(lines.length, "seed made no opencode call").toBeGreaterThan(0);
      for (const line of lines) {
        expect(argvTokens(line), `seed call holds no --standalone: ${line}`).toContain("--standalone");
      }
    } finally {
      fixture.close();
    }
  });

  it("ST2 every call that scan-values makes holds --standalone", () => {
    const fixture = buildFixture();
    try {
      const seed = runHelper(fixture, ["seed", PROVIDER_A]);
      expect(seed.status, `${seed.stdout}\n${seed.stderr}`).toBe(0);
      rmSync(fixture.argvLog, { force: true });
      const result = runHelper(fixture, ["scan-values", PROVIDER_A]);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const lines = argvLines(fixture);
      expect(lines.length, "scan-values made no opencode call").toBeGreaterThan(0);
      for (const line of lines) {
        expect(argvTokens(line), `scan-values call holds no --standalone: ${line}`).toContain(
          "--standalone",
        );
      }
    } finally {
      fixture.close();
    }
  });

  it("ST3 no credential call uses serve and no call runs with no subcommand", () => {
    const fixture = buildFixture();
    try {
      const seed = runHelper(fixture, ["seed", PROVIDER_A]);
      expect(seed.status, `${seed.stdout}\n${seed.stderr}`).toBe(0);
      const scan = runHelper(fixture, ["scan-values", PROVIDER_A]);
      expect(scan.status, `${scan.stdout}\n${scan.stderr}`).toBe(0);
      const lines = argvLines(fixture);
      expect(lines.length, "no opencode call was recorded").toBeGreaterThan(0);
      for (const line of lines) {
        const tokens = argvTokens(line);
        expect(tokens.length, `call runs with no subcommand: ${line}`).toBeGreaterThan(1);
        expect(tokens, `call uses serve: ${line}`).not.toContain("serve");
        expect(tokens[0], `call does not start with auth: ${line}`).toBe("auth");
      }
    } finally {
      fixture.close();
    }
  });

  it("ST4 every opencode call of review-run.sh holds --standalone and no call uses serve", () => {
    const text = readFileSync(join(HARNESS, "model-guide", "review-run.sh"), "utf8");
    const calls = text
      .split(/\r?\n/)
      .filter((line) => line.includes('"$OPENCODE_BIN" run') || line.includes('"$OPENCODE_BIN" auth'));
    expect(calls.length, "review-run.sh holds no opencode call").toBeGreaterThan(0);
    for (const line of calls) {
      expect(line, `review-run.sh call holds no --standalone: ${line}`).toContain("--standalone");
      expect(argvTokens(line), `review-run.sh call uses serve: ${line}`).not.toContain("serve");
    }
    expect(text.includes(" serve"), "review-run.sh holds a serve call").toBe(false);
  });

  it("ST5 every opencode call of judge-run.sh holds --standalone and no call uses serve", () => {
    const text = readFileSync(join(HARNESS, "model-guide", "judge-run.sh"), "utf8");
    const calls = text
      .split(/\r?\n/)
      .filter((line) => line.includes('"$OPENCODE_BIN" run') || line.includes('"$OPENCODE_BIN" auth'));
    expect(calls.length, "judge-run.sh holds no opencode call").toBeGreaterThan(0);
    for (const line of calls) {
      expect(line, `judge-run.sh call holds no --standalone: ${line}`).toContain("--standalone");
      expect(argvTokens(line), `judge-run.sh call uses serve: ${line}`).not.toContain("serve");
    }
    expect(text.includes(" serve"), "judge-run.sh holds a serve call").toBe(false);
  });
});
