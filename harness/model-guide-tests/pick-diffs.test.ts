import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 3.1: the candidate diffs (spec D4, FR-8).
 *
 * They start `harness/model-guide/pick-diffs.ts` as a subprocess with the
 * fake `gh` of `fixtures/fakes/` first on `PATH`. No test reads the network,
 * the real `gh`, the real home, a local checkout, or a real repository.
 *
 * Pinned command-line interface:
 *   cd harness && npx tsx model-guide/pick-diffs.ts \
 *     --repo <owner/name> --set <set_id> --private <dir> [--limit <n>]
 *
 * `--repo`, `--set`, and `--private` are required and take a value that is
 * not a flag token. Each missing value gives exit 2, no output file, and
 * exactly one line on stdout:
 *   `pick-diffs: <flag> needs a value`
 * `--limit` is optional and is the count of D8 seeded diffs; the default is
 * 12. A successful run exits 0, even when some candidates are rejected.
 *
 * The tool calls `gh` with the `api` verb and the `GET` method only. The
 * fake appends `<verb> <method> <argument>...` to `$FAKE_GH_LOG`. One run
 * makes one list call and one detail call for each commit that passes the
 * list-visible rules (merge, date), in list order:
 *   api GET repos/<owner>/<name>/commits --paginate
 *   api GET repos/<owner>/<name>/commits/<sha>
 * The tool reads no local checkout and calls no other verb.
 *
 * Output: `<private>/candidates/<owner>__<name>.json` (owner and name joined
 * by two underscores). The file holds exactly these keys:
 *   schema          `model-guide-candidates/1`
 *   repo            `<owner>/<name>`
 *   set_id          the `--set` value
 *   qualified       the commits that meet every rule of D4, newest first by
 *                   committer date; each entry holds `sha`, `parent` (first
 *                   parent), `committer_date` (ISO 8601), `files`, `lines`
 *                   (added plus removed), and `code_share` (a number from 0
 *                   to 1)
 *   selected        the first `--limit` qualified SHAs in that order, less
 *                   each diff that the set already holds
 *   rejected        one entry per rejected commit, in the order of the gh
 *                   list; each entry holds `sha` and `reason`
 * No field holds a wall-clock value.
 *
 * A set holds a diff when `<private>/sets/<set_id>/keys/<diff_id>.json`
 * exists and its `source.commit` equals the commit SHA. A held diff stays
 * in `qualified` and is skipped by `selected`.
 *
 * The rule order is fixed; the first failed rule gives the reason:
 *   1. merge (two parents or more)         `merge commit`
 *   2. committer date outside             `committer date outside
 *      2026-08-01 to 2026-11-13            2026-08-01 to 2026-11-13`
 *   3. file count outside 1 to 8          `file count outside 1 to 8`
 *   4. a file over 2000 changed lines     `file over 2000 lines`
 *   5. line count outside 40 to 400       `line count outside 40 to 400`
 *   6. code share below 60 %              `code share below 60%`
 *   7. a lock file                        `lock file`
 *   8. a binary file                      `binary file`
 *   9. a path under dist/, build/, or     `build output path`
 *      generated/
 *
 * A file is a lock file when its base name is `package-lock.json`,
 * `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, or ends in `.lock`.
 * A file is binary when its commit-detail entry has no `patch` key. The
 * code extensions are `.ts`, `.tsx`, `.js`, `.py`, and `.sql`.
 *
 * Fixture: `fixtures/fakes/gh-commits.json` holds the canned bodies for the
 * two source repos of spec EV7. The bodies are synthetic. `advantage-forge`
 * holds 20 commits: 6 qualified and 14 rejected, one per rule. The
 * monorepo holds 13 qualified commits, so the default limit of 12 shows.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "pick-diffs.ts");
const FAKES = join(import.meta.dirname, "fixtures", "fakes");

const FORGE = "bodangren/advantage-forge";
const MONO = "Reading-Advantage-Thailand/reading-advantage-monorepo";
const SET = "mg-2026-11a";
const CANDIDATE_SCHEMA = "model-guide-candidates/1";

const P = "1".repeat(38);
const M = "3".repeat(38);
const sha = (prefix: string, n: number) => prefix + String(n).padStart(2, "0");

// advantage-forge qualified commits, newest first.
const Q = [sha(P, 2), sha(P, 3), sha(P, 5), sha(P, 7), sha(P, 18), sha(P, 19)];
// advantage-forge rejected commits, one per rule.
const R = {
  dateAfter: sha(P, 1),
  binary: sha(P, 4),
  lock: sha(P, 6),
  merge: sha(P, 8),
  fileOver: sha(P, 9),
  fileCount9: sha(P, 10),
  generated: sha(P, 11),
  dist: sha(P, 12),
  build: sha(P, 13),
  fileCount0: sha(P, 14),
  lines401: sha(P, 15),
  lines39: sha(P, 16),
  codeShare: sha(P, 17),
  dateBefore: sha(P, 20),
};
const ALL_FORGE = [
  R.dateAfter, Q[0], Q[1], R.binary, Q[2], R.lock, Q[3], R.merge, R.fileOver,
  R.fileCount9, R.generated, R.dist, R.build, R.fileCount0, R.lines401,
  R.lines39, R.codeShare, Q[4], Q[5], R.dateBefore,
];
// Detail calls happen for every commit that passes the merge and date rules,
// in list order.
const FORGE_DETAIL = ALL_FORGE.filter(
  (s) => ![R.dateAfter, R.dateBefore, R.merge].includes(s),
);
const MONO_SHAS = Array.from({ length: 13 }, (_, i) => sha(M, i + 1));

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-pick-diffs-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(TOOL)) {
    throw new Error(
      `production file is missing: ${TOOL} (Phase 2 has no pick-diffs tool)`,
    );
  }
}

function env(fakeHome: string, log: string, extra: Record<string, string> = {}) {
  const copy: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${FAKES}:${process.env.PATH ?? ""}`,
    FAKE_GH_LOG: log,
    HOME: fakeHome,
    TZ: "UTC",
    NO_COLOR: "1",
    npm_config_loglevel: "silent",
    ...extra,
  };
  if (!("BENCH_TRACK" in extra)) delete copy.BENCH_TRACK;
  return copy as NodeJS.ProcessEnv;
}

function run(args: string[], opts: { home?: string; log?: string; extra?: Record<string, string> } = {}) {
  requireProduction();
  const home = opts.home ?? tempDir("home");
  const log = opts.log ?? join(tempDir("log"), "gh.log");
  return spawnSync(
    join(HARNESS, "node_modules", ".bin", "tsx"),
    ["model-guide/pick-diffs.ts", ...args],
    { cwd: HARNESS, env: env(home, log, opts.extra), encoding: "utf8", timeout: 60_000 },
  );
}

function logLines(log: string): string[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter((line) => line !== "");
}

interface Accepted {
  result: ReturnType<typeof spawnSync>;
  privateDir: string;
  home: string;
  log: string;
  doc: any;
  candidateFile: string;
}

function accept(tag: string, opts: { repo?: string; limit?: number; extra?: Record<string, string>; setup?: (dir: string) => void } = {}): Accepted {
  const privateDir = tempDir(`private-${tag}`);
  const log = join(tempDir(`log-${tag}`), "gh.log");
  const home = tempDir(`home-${tag}`);
  if (opts.setup) opts.setup(privateDir);
  const args = ["--repo", opts.repo ?? FORGE, "--set", SET, "--private", privateDir];
  if (opts.limit !== undefined) args.push("--limit", String(opts.limit));
  const result = run(args, { home, log, extra: opts.extra });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const [owner, name] = (opts.repo ?? FORGE).split("/");
  const candidateFile = join(privateDir, "candidates", `${owner}__${name}.json`);
  expect(existsSync(candidateFile), `the tool writes ${candidateFile}`).toBe(true);
  const doc = JSON.parse(readFileSync(candidateFile, "utf8"));
  return { result, privateDir, home, log, doc, candidateFile };
}

const forgeDoc = (() => {
  let cached: any;
  return () => {
    if (!cached) cached = accept("shared").doc;
    return cached;
  };
})();

function rejected(doc: any, target: string): any[] {
  return doc.rejected.filter((entry: any) => entry.sha === target);
}

function expectRejected(doc: any, target: string, reason: string): void {
  const entries = rejected(doc, target);
  expect(entries, `${target} has one reason line`).toHaveLength(1);
  expect(entries[0].reason).toBe(reason);
  expect(doc.qualified.map((entry: any) => entry.sha)).not.toContain(target);
  expect(doc.selected).not.toContain(target);
}

describe("PK1 the candidate list", () => {
  it("PK1 lists the qualified commits, newest first", () => {
    const doc = forgeDoc();
    expect(doc.schema).toBe(CANDIDATE_SCHEMA);
    expect(doc.repo).toBe(FORGE);
    expect(doc.set_id).toBe(SET);
    expect(doc.qualified.map((entry: any) => entry.sha)).toEqual(Q);
    expect(doc.selected).toEqual(Q);
    expect(doc.rejected).toHaveLength(14);

    const entry = (target: string) => doc.qualified.find((item: any) => item.sha === target);
    expect(entry(Q[0])).toMatchObject({ files: 2, lines: 60, code_share: 1 });
    expect(entry(Q[1])).toMatchObject({ files: 2, lines: 120, code_share: 0.75 });
    expect(entry(Q[2])).toMatchObject({ files: 1, lines: 40, code_share: 1 });
    expect(entry(Q[3])).toMatchObject({ files: 8, lines: 400, code_share: 0.6 });
    expect(entry(Q[4])).toMatchObject({ files: 3, lines: 200, code_share: 1 });
    expect(entry(Q[5])).toMatchObject({ files: 1, lines: 100, code_share: 1 });
    for (const item of doc.qualified) {
      expect(item.parent).toMatch(/^[0-9a-f]{40}$/);
      expect(item.committer_date).toMatch(/^2026-/);
    }
  });

  it("PK1 calls gh api GET only, one list call and one detail call per candidate", () => {
    const accepted = accept("calls");
    expect(logLines(accepted.log)).toEqual([
      `api GET repos/${FORGE}/commits --paginate`,
      ...FORGE_DETAIL.map((target) => `api GET repos/${FORGE}/commits/${target}`),
    ]);
  });

  it("PK1 uses the repo of --repo and stops at the default limit of 12", () => {
    const accepted = accept("mono", { repo: MONO });
    expect(accepted.doc.repo).toBe(MONO);
    expect(accepted.doc.qualified.map((entry: any) => entry.sha)).toEqual(MONO_SHAS);
    expect(accepted.doc.selected).toEqual(MONO_SHAS.slice(0, 12));
    expect(accepted.doc.rejected).toEqual([]);
    expect(logLines(accepted.log)[0]).toBe(`api GET repos/${MONO}/commits --paginate`);
    expect(logLines(accepted.log)).toHaveLength(1 + MONO_SHAS.length);
  });
});

describe("PK2 each refusal", () => {
  it("PK2 rejects a merge commit", () => {
    expectRejected(forgeDoc(), R.merge, "merge commit");
  });

  it("PK2 rejects a committer date outside the range", () => {
    const doc = forgeDoc();
    expectRejected(doc, R.dateAfter, "committer date outside 2026-08-01 to 2026-11-13");
    expectRejected(doc, R.dateBefore, "committer date outside 2026-08-01 to 2026-11-13");
    expect(doc.qualified.map((entry: any) => entry.committer_date)).toContain(
      "2026-11-13T23:59:59Z",
    );
    expect(doc.qualified.map((entry: any) => entry.committer_date)).toContain(
      "2026-08-01T00:00:00Z",
    );
  });

  it("PK2 rejects a file count outside 1 to 8", () => {
    const doc = forgeDoc();
    expectRejected(doc, R.fileCount0, "file count outside 1 to 8");
    expectRejected(doc, R.fileCount9, "file count outside 1 to 8");
  });

  it("PK2 rejects a line count outside 40 to 400", () => {
    const doc = forgeDoc();
    expectRejected(doc, R.lines39, "line count outside 40 to 400");
    expectRejected(doc, R.lines401, "line count outside 40 to 400");
  });

  it("PK2 rejects a code share below 60 percent", () => {
    expectRejected(forgeDoc(), R.codeShare, "code share below 60%");
  });

  it("PK2 rejects a lock file", () => {
    expectRejected(forgeDoc(), R.lock, "lock file");
  });

  it("PK2 rejects a binary file", () => {
    expectRejected(forgeDoc(), R.binary, "binary file");
  });

  it("PK2 rejects a path under dist, build, or generated", () => {
    const doc = forgeDoc();
    expectRejected(doc, R.dist, "build output path");
    expectRejected(doc, R.build, "build output path");
    expectRejected(doc, R.generated, "build output path");
  });

  it("PK2 rejects a file over 2000 lines", () => {
    expectRejected(forgeDoc(), R.fileOver, "file over 2000 lines");
  });

  it("PK2 classifies every commit once and selects no rejected commit", () => {
    const doc = forgeDoc();
    expect(doc.rejected).toHaveLength(14);
    expect(doc.qualified.map((entry: any) => entry.sha)).toHaveLength(6);
    expect(
      [...doc.qualified.map((entry: any) => entry.sha), ...doc.rejected.map((entry: any) => entry.sha)].sort(),
    ).toEqual([...ALL_FORGE].sort());
    for (const entry of doc.rejected) expect(entry.reason).toBeTruthy();
  });
});

describe("PK3 selection", () => {
  it("PK3 takes the first qualified commits and skips a held diff", () => {
    const accepted = accept("held", {
      limit: 4,
      setup: (privateDir) => {
        const keys = join(privateDir, "sets", SET, "keys");
        mkdirSync(keys, { recursive: true });
        writeFileSync(
          join(keys, "held-01.json"),
          JSON.stringify({
            schema: "model-guide-key/1",
            set_id: SET,
            diff_id: "held-01",
            source: { repo: FORGE, commit: Q[1], parent: "9".repeat(40) },
            plants: [],
          }),
        );
      },
    });
    expect(accepted.doc.qualified.map((entry: any) => entry.sha)).toEqual(Q);
    expect(accepted.doc.selected).toEqual([Q[0], Q[2], Q[3], Q[4]]);
  });
});

describe("PK4 no other call", () => {
  it("PK4 logs api GET entries only, with no other verb", () => {
    const accepted = accept("shape");
    const lines = logLines(accepted.log);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const [verb, method] = line.split(" ");
      expect(verb).toBe("api");
      expect(method).toBe("GET");
    }
    expect(lines.filter((line) => line.includes("/commits --paginate"))).toHaveLength(1);
    expect(lines.some((line) => /^(pr|repo|clone|git)\b/.test(line))).toBe(false);
    expect(lines.some((line) => line.includes("--method") || line.includes("POST"))).toBe(false);
  });
});

describe("G9 environment", () => {
  it("G9 gives the same selection under BENCH_TRACK=change and a pinned TZ", () => {
    const accepted = accept("env", {
      extra: { BENCH_TRACK: "change", TZ: "America/New_York" },
    });
    expect(accepted.doc.selected).toEqual(Q);
    expect(existsSync(join(accepted.home, ".local", "share", "lending-desk-bench"))).toBe(false);
  });
});

describe("P3B1 the write target and the set id", () => {
  it("P3B1-2 refuses a symlink at the candidates target before any write", () => {
    const privateDir = tempDir("symlink-private");
    mkdirSync(join(privateDir, "candidates"), { recursive: true });
    const target = join(privateDir, "candidates", "bodangren__advantage-forge.json");
    const outside = join(tempDir("outside"), "outside.json");
    writeFileSync(outside, "keep\n");
    symlinkSync(outside, target);
    const result = run(["--repo", FORGE, "--set", SET, "--private", privateDir]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout.split("\n").map((item) => item.trim())).toContain(
      `pick-diffs: symlink: ${target}`,
    );
    expect(readFileSync(outside, "utf8")).toBe("keep\n");
  });

  it("P3B1-5 refuses a set id that is not a plain name", () => {
    const privateDir = tempDir("bad-id-private");
    const result = run(["--repo", FORGE, "--set", "../x", "--private", privateDir]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout.trim()).toBe("pick-diffs: set-id: ../x");
    expect(existsSync(join(privateDir, "candidates"))).toBe(false);
  });
});

describe("P3T1 the gh output buffer", () => {
  it("P3T1-1 reads a commits list output over 1 MiB", () => {
    const accepted = accept("large-list", { extra: { FAKE_GH_LIST_PAD: "31000000" } });
    expect(accepted.doc.qualified.map((entry: any) => entry.sha)).toEqual(Q);
    expect(accepted.doc.selected).toEqual(Q);
  });

  it("P3T1-2 reads a commit detail output over 1 MiB", () => {
    const accepted = accept("large-detail", { extra: { FAKE_GH_DETAIL_PAD: "1500000" } });
    expect(accepted.doc.qualified).toHaveLength(6);
    expect(accepted.doc.selected).toEqual(Q);
  });
});

describe("the write flags", () => {
  it("each missing value exits 2 with one named line and writes nothing", () => {
    const repoDir = tempDir("missing-repo");
    const setDir = tempDir("missing-set");
    const cases: Array<[string, string[], string | null]> = [
      ["repo", ["--set", SET, "--private", repoDir, "--repo"], repoDir],
      ["set", ["--repo", FORGE, "--private", setDir, "--set"], setDir],
      ["private", ["--repo", FORGE, "--set", SET, "--private"], null],
    ];
    for (const [flag, args, privateDir] of cases) {
      const log = join(tempDir(`log-missing-${flag}`), "gh.log");
      const result = run(args, { log });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(result.stdout.trim()).toBe(`pick-diffs: --${flag} needs a value`);
      expect(logLines(log)).toEqual([]);
      if (privateDir) expect(existsSync(join(privateDir, "candidates"))).toBe(false);
    }
  });
});
