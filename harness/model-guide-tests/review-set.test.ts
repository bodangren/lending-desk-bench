import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 3.2: the set lint and the public manifest
 * (spec D5 to D9, D13, FR-8). They start
 * `harness/model-guide/review-set.ts` as a subprocess on a copy of the
 * synthetic set in `fixtures/review/sets/mg-2026-11a/`. No test reads the
 * network, the real home, a real repository, or the real private folder.
 *
 * Pinned command-line interface:
 *   cd harness && npx tsx model-guide/review-set.ts lint <set_id> \
 *     --private <dir> --sets <dir> --created <YYYY-MM-DD>
 *
 * `--private`, `--sets`, and `--created` are required and take a value that
 * is not a flag token. A missing value gives exit 2, no manifest, and one
 * line on stdout: `lint: <flag> needs a value`. Exit 0 writes
 * `<sets>/<set_id>.json`. Exit 2 writes no manifest and prints one or more
 * `lint: <check>: <detail>` lines.
 *
 * The private set layout:
 *   <private>/sets/<set_id>/keys/<diff_id>.json   the key of D7
 *   <private>/sets/<set_id>/diffs/<diff_id>.diff  the seeded diff
 *   <private>/sets/<set_id>/src/<diff_id>.diff    the source diff
 *
 * The diff text holds one hunk. Each body line is
 * `L<n> +<text>` (an added line), `L--- -<text>` (a removed line), or
 * `L<n>  <text>` (a context line). The hunk header is
 * `@@ -<old_start>,<old_count> +<new_start>,<new_count> @@`. The lint
 * recomputes `new_start` (the first new-side number of the hunk),
 * `new_count` (the body lines that are not removed), and `old_count` (the
 * body lines that are not added). `old_start` is not derivable from this
 * format and stays free (spec D5, D10).
 *
 * The checks and their lines:
 *   seeded-sha256       the SHA-256 of the seeded diff file differs from
 *                       `seeded_diff_sha256` of the key
 *                       `lint: seeded-sha256: <diff_id>`
 *   hunk-header         a recomputed hunk value differs
 *                       `lint: hunk-header: <diff_id> hunk <n>`
 *   plant-removed-line  a plant range crosses a removed line
 *                       `lint: plant-removed-line: <diff_id> <plant_id>`
 *   plant-length        a plant spans more than 6 lines
 *                       `lint: plant-length: <diff_id> <plant_id>`
 *   plant-spacing       two plants start fewer than 8 lines apart
 *                       `lint: plant-spacing: <diff_id> <p1> <p2>`
 *   operator            an operator is not in the catalog of its class
 *                       (spec D6)
 *                       `lint: operator: <diff_id> <plant_id> <operator>
 *                       is not in <class>`
 *   counts              the set size is below its profile
 *                       `lint: counts: diffs <n>, needs <m>`
 *                       `lint: counts: blockers <n>, needs 14`
 *                       `lint: counts: class <C> has <n>, needs 3`
 *
 * Plant rules (spec D5): a plant lies on added lines only, spans 1 to 6
 * lines, and two plants of one diff start at least 8 lines apart. The set
 * profile (spec D8) binds `mg-2026-11a` only: 14 diffs, 12 seeded with 6
 * from each source repo, 2 controls with no plant, 3 to 5 plants per seeded
 * diff, 40 to 60 plants, 14 or more blockers, each class C1 to C7 with 3 or
 * more plants, and C8 and C9 with 1 or more. A `mg-2026-11p*` set uses the
 * D13 pilot profile: 6 diffs and 12 or more plants (assumption S4).
 *
 * The public manifest holds exactly the fields of spec D9 and no other:
 *   set_id        the `--set` value
 *   created       the `--created` value; never the wall clock
 *   diffs         sorted by id; each entry holds exactly `id`, `repo`,
 *                 `commit`, `parent`, `seeded_sha256`, `key_sha256`
 *   plant_counts  exactly `by_class` (C1 to C9) and `by_severity`
 *                 (blocker, major, minor)
 * It holds no `new_lines`, `witness`, `operator`, `file`, `line`, `title`,
 * `reason`, `plants`, or `accepted_classes` key at any depth.
 *
 * The fixture set `mg-2026-11a` holds 14 diffs and 48 plants: 16 blockers,
 * 20 majors, 12 minors; C1 6, C2 6, C3 6, C4 5, C5 5, C6 5, C7 5, C8 5,
 * C9 5. The key of `forge-01` has P1 [10, 15] and P2 [18, 19], so their
 * 3-line windows overlap: a finding at line 16 fits both and is nearer P1.
 * A removed line sits between new-side lines 19 and 20 in every diff.
 *
 * `fixtures/review/outputs/` holds the raw review outputs for tasks 3.3 and
 * 3.4 (a match, the two window edges, one line outside, a wrong class, the
 * nearer plant, two findings between two plants, a duplicate, 33 findings,
 * no block, invalid JSON, a finding without `line`, one without `file`, an
 * absolute path, unmatched findings, and a wrong line).
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "review-set.ts");
const FIXTURE_SET = join(import.meta.dirname, "fixtures", "review", "sets", "mg-2026-11a");
const SET = "mg-2026-11a";
const PILOT = "mg-2026-11p";
const CREATED = "2026-11-16";
const MANIFEST_KEYS = ["created", "diffs", "plant_counts", "set_id"];
const DIFF_KEYS = ["commit", "id", "key_sha256", "parent", "repo", "seeded_sha256"];
const FORBIDDEN = ["new_lines", "witness", "operator", "file", "line", "title", "reason", "plants", "accepted_classes"];
const MONO = "Reading-Advantage-Thailand/reading-advantage-monorepo";
const FORGE = "bodangren/advantage-forge";
const DIFF_IDS = [
  "forge-01", "forge-02", "forge-03", "forge-04", "forge-05", "forge-06", "forge-c1",
  "mono-01", "mono-02", "mono-03", "mono-04", "mono-05", "mono-06", "mono-c1",
];

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-review-set-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(TOOL)) {
    throw new Error(
      `production file is missing: ${TOOL} (Phase 2 has no review-set tool)`,
    );
  }
}

function env(fakeHome: string, extra: Record<string, string> = {}) {
  const copy: Record<string, string | undefined> = {
    ...process.env,
    HOME: fakeHome,
    TZ: "UTC",
    NO_COLOR: "1",
    npm_config_loglevel: "silent",
    ...extra,
  };
  if (!("BENCH_TRACK" in extra)) delete copy.BENCH_TRACK;
  return copy as NodeJS.ProcessEnv;
}

function lint(privateDir: string, setsDir: string, opts: { set?: string; extra?: string[]; created?: string; home?: string } = {}) {
  requireProduction();
  const args = [
    "model-guide/review-set.ts", "lint", opts.set ?? SET,
    "--private", privateDir, "--sets", setsDir,
    "--created", opts.created ?? CREATED,
    ...(opts.extra ?? []),
  ];
  return spawnSync(join(HARNESS, "node_modules", ".bin", "tsx"), args, {
    cwd: HARNESS,
    env: env(opts.home ?? tempDir("home")),
    encoding: "utf8",
    timeout: 60_000,
  });
}

interface Staged {
  privateDir: string;
  setsDir: string;
  manifest: string;
}

/** Copy the fixture set into a fresh private root. */
function staged(tag: string, set = SET): Staged {
  const privateDir = tempDir(`private-${tag}`);
  const target = join(privateDir, "sets", set);
  mkdirSync(join(privateDir, "sets"), { recursive: true });
  cpSync(FIXTURE_SET, target, { recursive: true });
  const setsDir = tempDir(`sets-${tag}`);
  return { privateDir, setsDir, manifest: join(setsDir, `${set}.json`) };
}

function keyFile(privateDir: string, diffId: string, set = SET): string {
  return join(privateDir, "sets", set, "keys", `${diffId}.json`);
}

function readKey(privateDir: string, diffId: string, set = SET): any {
  return JSON.parse(readFileSync(keyFile(privateDir, diffId, set), "utf8"));
}

function writeKey(privateDir: string, diffId: string, key: any, set = SET): void {
  writeFileSync(keyFile(privateDir, diffId, set), JSON.stringify(key, null, 2) + "\n");
}

function expectRefusal(stagedSet: Staged, line: string, set = SET) {
  const result = lint(stagedSet.privateDir, stagedSet.setsDir, { set });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
  expect(result.stdout.split("\n").map((item) => item.trim())).toContain(line);
  expect(existsSync(stagedSet.manifest), "a refusal writes no manifest").toBe(false);
}

function accept(tag: string, set = SET): { stagedSet: Staged; doc: any; text: string } {
  const stagedSet = staged(tag, set);
  const result = lint(stagedSet.privateDir, stagedSet.setsDir, { set });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(existsSync(stagedSet.manifest), `the lint writes ${stagedSet.manifest}`).toBe(true);
  const text = readFileSync(stagedSet.manifest, "utf8");
  return { stagedSet, doc: JSON.parse(text), text };
}

/** Every key name at any depth of `value`. */
function keyNames(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keyNames(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const [name, item] of Object.entries(value)) {
      found.push(name);
      keyNames(item, found);
    }
  }
  return found;
}

describe("S1 the lint accept and the public manifest", () => {
  it("S1 passes the D8 set and writes only the D9 fields", () => {
    const { doc } = accept("accept");
    expect(Object.keys(doc).sort()).toEqual(MANIFEST_KEYS);
    expect(doc.set_id).toBe(SET);
    expect(doc.created).toBe(CREATED);
    expect(doc.diffs.map((entry: any) => entry.id)).toEqual(DIFF_IDS);
    for (const entry of doc.diffs) {
      expect(Object.keys(entry).sort()).toEqual(DIFF_KEYS);
      expect(entry.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.parent).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.seeded_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.key_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(doc.diffs.filter((entry: any) => entry.repo === FORGE)).toHaveLength(7);
    expect(doc.diffs.filter((entry: any) => entry.repo === MONO)).toHaveLength(7);
    expect(doc.plant_counts).toEqual({
      by_class: { C1: 6, C2: 6, C3: 6, C4: 5, C5: 5, C6: 5, C7: 5, C8: 5, C9: 5 },
      by_severity: { blocker: 16, major: 20, minor: 12 },
    });
  });

  it("S5 holds no secret field and only 40 or 64 hex digests", () => {
    const { doc } = accept("secrecy");
    const names = keyNames(doc);
    for (const forbidden of FORBIDDEN) {
      expect(names, `the manifest holds no ${forbidden} key`).not.toContain(forbidden);
    }
    for (const entry of doc.diffs) {
      expect(entry.commit).toHaveLength(40);
      expect(entry.parent).toHaveLength(40);
      expect(entry.seeded_sha256).toHaveLength(64);
      expect(entry.key_sha256).toHaveLength(64);
    }
  });
});

describe("S3 the operator catalog", () => {
  it("S3 accepts a valid operator of each class of D6", () => {
    const { stagedSet } = accept("operators");
    const classes = new Set<string>();
    for (const diffId of DIFF_IDS) {
      for (const plant of readKey(stagedSet.privateDir, diffId).plants) classes.add(plant.class);
    }
    expect([...classes].sort()).toEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"]);
  });

  it("S3 rejects an operator that is not in the catalog of its class", () => {
    const stagedSet = staged("operator");
    const key = readKey(stagedSet.privateDir, "mono-01");
    const plant = key.plants[0];
    plant.operator = "C3-1 invert-condition";
    writeKey(stagedSet.privateDir, "mono-01", key);
    expectRefusal(stagedSet, `lint: operator: mono-01 P1 C3-1 invert-condition is not in ${plant.class}`);
  });
});

describe("S2 the plant refusals", () => {
  it("S2 rejects a plant in a removed line", () => {
    const stagedSet = staged("removed-line");
    const key = readKey(stagedSet.privateDir, "forge-04");
    key.plants[1].new_lines = [19, 20];
    writeKey(stagedSet.privateDir, "forge-04", key);
    expectRefusal(stagedSet, "lint: plant-removed-line: forge-04 P2");
  });
  it("S2 rejects plants fewer than 8 lines apart", () => {
    const stagedSet = staged("spacing");
    const key = readKey(stagedSet.privateDir, "forge-03");
    key.plants[1].new_lines = [16, 17];
    writeKey(stagedSet.privateDir, "forge-03", key);
    expectRefusal(stagedSet, "lint: plant-spacing: forge-03 P1 P2");
  });

  it("S2 rejects a plant over 6 lines", () => {
    const stagedSet = staged("length");
    const key = readKey(stagedSet.privateDir, "forge-02");
    key.plants[0].new_lines = [10, 17];
    writeKey(stagedSet.privateDir, "forge-02", key);
    expectRefusal(stagedSet, "lint: plant-length: forge-02 P1");
  });

  it("S2 rejects a wrong hunk header", () => {
    const stagedSet = staged("hunk");
    const file = join(stagedSet.privateDir, "sets", SET, "diffs", "forge-05.diff");
    const text = readFileSync(file, "utf8").replace("@@ -20,1 +10,63 @@", "@@ -20,1 +10,62 @@");
    writeFileSync(file, text);
    expectRefusal(stagedSet, "lint: hunk-header: forge-05 hunk 1");
  });

  it("S2 rejects a wrong seeded SHA-256", () => {
    const stagedSet = staged("sha");
    const key = readKey(stagedSet.privateDir, "forge-06");
    const digest = key.seeded_diff_sha256;
    key.seeded_diff_sha256 = (digest[0] === "0" ? "1" : "0") + digest.slice(1);
    writeKey(stagedSet.privateDir, "forge-06", key);
    expectRefusal(stagedSet, "lint: seeded-sha256: forge-06");
  });

  it("S2 rejects a class count below D8", () => {
    const stagedSet = staged("class-count");
    let removed = 0;
    for (const diffId of DIFF_IDS) {
      if (removed === 3) break;
      const key = readKey(stagedSet.privateDir, diffId);
      const before = key.plants.length;
      key.plants = key.plants.filter((plant: any) => {
        if (plant.class === "C7" && removed < 3) {
          removed += 1;
          return false;
        }
        return true;
      });
      if (key.plants.length !== before) writeKey(stagedSet.privateDir, diffId, key);
    }
    expect(removed).toBe(3);
    expectRefusal(stagedSet, "lint: counts: class C7 has 2, needs 3");
  });

  it("S2 rejects a blocker count below D8", () => {
    const stagedSet = staged("blocker-count");
    let changed = 0;
    for (const diffId of DIFF_IDS) {
      const key = readKey(stagedSet.privateDir, diffId);
      for (const plant of key.plants) {
        if (changed < 3 && plant.severity === "blocker") {
          plant.severity = "major";
          changed += 1;
        }
      }
      writeKey(stagedSet.privateDir, diffId, key);
    }
    expect(changed).toBe(3);
    expectRefusal(stagedSet, "lint: counts: blockers 13, needs 14");
  });
});

describe("S4 the count profile", () => {
  it("S4 passes a pilot set with 6 diffs and 12 or more plants", () => {
    const privateDir = tempDir("pilot-private");
    const setsDir = tempDir("pilot-sets");
    const dir = join(privateDir, "sets", PILOT);
    for (const sub of ["src", "diffs", "keys"]) mkdirSync(join(dir, sub), { recursive: true });
    for (const diffId of ["mono-01", "mono-02", "mono-03", "mono-04", "mono-05", "mono-06"]) {
      for (const sub of ["src", "diffs"]) {
        cpSync(join(FIXTURE_SET, sub, `${diffId}.diff`), join(dir, sub, `${diffId}.diff`));
      }
      const key = JSON.parse(readFileSync(join(FIXTURE_SET, "keys", `${diffId}.json`), "utf8"));
      key.set_id = PILOT;
      writeFileSync(join(dir, "keys", `${diffId}.json`), JSON.stringify(key, null, 2) + "\n");
    }
    const result = lint(privateDir, setsDir, { set: PILOT });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const manifest = JSON.parse(readFileSync(join(setsDir, `${PILOT}.json`), "utf8"));
    expect(manifest.set_id).toBe(PILOT);
    expect(manifest.diffs).toHaveLength(6);
    const plants = manifest.plant_counts.by_severity.blocker
      + manifest.plant_counts.by_severity.major
      + manifest.plant_counts.by_severity.minor;
    expect(plants).toBe(24);
  });

  it("S4 rejects a pilot set with 5 diffs", () => {
    const privateDir = tempDir("pilot-short-private");
    const setsDir = tempDir("pilot-short-sets");
    const dir = join(privateDir, "sets", PILOT);
    for (const sub of ["src", "diffs", "keys"]) mkdirSync(join(dir, sub), { recursive: true });
    for (const diffId of ["mono-01", "mono-02", "mono-03", "mono-04", "mono-05"]) {
      for (const sub of ["src", "diffs"]) {
        cpSync(join(FIXTURE_SET, sub, `${diffId}.diff`), join(dir, sub, `${diffId}.diff`));
      }
      const key = JSON.parse(readFileSync(join(FIXTURE_SET, "keys", `${diffId}.json`), "utf8"));
      key.set_id = PILOT;
      writeFileSync(join(dir, "keys", `${diffId}.json`), JSON.stringify(key, null, 2) + "\n");
    }
    const result = lint(privateDir, setsDir, { set: PILOT });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout.split("\n").map((item) => item.trim())).toContain("lint: counts: diffs 5, needs 6");
    expect(existsSync(join(setsDir, `${PILOT}.json`))).toBe(false);
  });
});

describe("the write flags", () => {
  it("each missing value exits 2 with one named line and writes nothing", () => {
    requireProduction();
    const stagedSet = staged("flags");
    const missingPrivate = spawnSync(
      join(HARNESS, "node_modules", ".bin", "tsx"),
      ["model-guide/review-set.ts", "lint", SET, "--sets", stagedSet.setsDir, "--created", CREATED, "--private"],
      { cwd: HARNESS, env: env(tempDir("home-flags")), encoding: "utf8", timeout: 60_000 },
    );
    expect(missingPrivate.status, `${missingPrivate.stdout}\n${missingPrivate.stderr}`).toBe(2);
    expect(missingPrivate.stdout.trim()).toBe("lint: --private needs a value");
    expect(existsSync(stagedSet.manifest)).toBe(false);

    const result = lint(stagedSet.privateDir, stagedSet.setsDir, { extra: ["--created"] });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout.trim()).toBe("lint: --created needs a value");
    expect(existsSync(stagedSet.manifest)).toBe(false);
  });
});

describe("G9 environment", () => {
  it("G9 gives the same manifest under BENCH_TRACK=change and a pinned TZ", () => {
    const base = accept("env-base");
    const stagedSet = staged("env-change");
    const home = tempDir("home-change");
    const result = spawnSync(
      join(HARNESS, "node_modules", ".bin", "tsx"),
      ["model-guide/review-set.ts", "lint", SET, "--private", stagedSet.privateDir, "--sets", stagedSet.setsDir, "--created", CREATED],
      {
        cwd: HARNESS,
        env: env(home, { BENCH_TRACK: "change", TZ: "America/New_York" }),
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(stagedSet.manifest, "utf8")).toBe(base.text);
    expect(existsSync(join(home, ".local", "share", "lending-desk-bench"))).toBe(false);
  });
});
