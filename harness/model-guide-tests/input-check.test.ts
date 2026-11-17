import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 4.1e: the hand-off input check of the Data source
 * block (spec D16 "Data source (PM 2026-11-17)", Tool details, FR-1). They
 * call `harness/model-guide/real-work.ts`.
 *
 * Pinned command-line interface (spec Q-S1, section 13.13 default):
 *   cd harness && npx tsx model-guide/real-work.ts \
 *     --manifest <path of MANIFEST-<date>.txt> --out <folder>
 * Usage line: `usage: real-work.ts --manifest <file> --out <folder>`
 * The tool reads the three dated data files next to the manifest. The old
 * `--input` form is removed (Q-S12, no legacy flag).
 *
 * Refusal contract (spec Q-S3, FR-1): exit 2, no output file, and one line
 * on stderr:
 *   input-check: <check> <file name>
 * The check words are manifest, input, sha256, size, json, and schema.
 * A usage error gives exit 2, empty stdout, and one usage line on stderr.
 *
 * MANIFEST format (spec Q-S2): one line per file,
 * `<sha256>  <size>  <file name>`, for the three dated files only.
 * The read date and the export date come from the MANIFEST file name (Q-S4).
 *
 * Test groups (test-strategy 13.4): DS1 integrity, DS2 order and refusals,
 * DS3 no copy, FX1 the committed fixture agrees with its MANIFEST. FX3 is
 * the "no real data" guard. The fixtures live in `fixtures/page-b/`; no
 * test reads a real dated file, the real docs/, a model, the network, or
 * the private folder.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "real-work.ts");
const PAGE_B = join(import.meta.dirname, "fixtures", "page-b");

const DATE = "2026-10-20";
const OUTCOMES_NAME = `ra-outcomes-${DATE}.json`;
const AA_NAME = `aa-reliability-${DATE}.json`;
const ALLOWED_NAME = `allowed-routes-${DATE}.json`;
const MANIFEST_NAME = `MANIFEST-${DATE}.txt`;

const OUTCOMES_FIXTURE = join(PAGE_B, OUTCOMES_NAME);
const AA_FIXTURE = join(PAGE_B, AA_NAME);
const ALLOWED_FIXTURE = join(PAGE_B, ALLOWED_NAME);
const MANIFEST_FIXTURE = join(PAGE_B, MANIFEST_NAME);

const USAGE = "usage: real-work.ts --manifest <file> --out <folder>\n";
const THREE_FILES = [OUTCOMES_NAME, AA_NAME, ALLOWED_NAME] as const;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-input-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(TOOL)) throw new Error(`production file is missing: ${TOOL}`);
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
  delete copy.BENCH_TRACK;
  return copy;
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** One `<sha256>  <size>  <file name>` line for a written file. */
function manifestLine(file: string, name: string): string {
  const data = readFileSync(file);
  return `${createHash("sha256").update(data).digest("hex")}  ${data.length}  ${name}`;
}

/** The three manifest lines of a staged folder, in fixture order. */
function manifestOf(dir: string, names: readonly string[] = THREE_FILES): string {
  const lines: string[] = [];
  for (const name of names) {
    const file = join(dir, name);
    if (existsSync(file)) lines.push(manifestLine(file, name));
  }
  return `${lines.join("\n")}\n`;
}

interface StageOptions {
  /** Mutate the parsed outcomes array. */
  outcomes?: (rows: any[]) => void;
  aa?: (doc: any) => void;
  allowed?: (doc: any) => void;
  /** Raw text overrides that replace a fixture file. */
  outcomesText?: string;
  aaText?: string;
  allowedText?: string;
  /** File names to leave out of the folder. */
  omit?: string[];
  /** File names to leave out of the manifest only. */
  manifestOmit?: string[];
  /** File names to leave out of the folder but keep in the manifest, with
   * the SHA-256 and size of the fixture file (DS2 missing input). */
  manifestKeep?: string[];
  /** Build every manifest line from the committed fixture file, so a
   * changed staged file must fail the SHA-256 check (DS1, DS2). */
  manifestFromFixture?: boolean;
  /** Exact manifest text; replaces the generated one. */
  manifestText?: string;
}

/**
 * Stage the three page B files and the MANIFEST into one temp folder. A
 * manifest is rebuilt from the staged bytes, so a mutation stays valid
 * unless the case asks for a stale manifest.
 */
function stagePageB(tag: string, opts: StageOptions = {}): { dir: string; manifest: string } {
  const dir = tempDir(`page-b-${tag}`);
  const omit = opts.omit ?? [];
  if (!omit.includes(OUTCOMES_NAME)) {
    let text = readFileSync(OUTCOMES_FIXTURE, "utf8");
    if (opts.outcomesText !== undefined) text = opts.outcomesText;
    else if (opts.outcomes) {
      const rows = JSON.parse(text);
      opts.outcomes(rows);
      text = JSON.stringify(rows, null, 2) + "\n";
    }
    writeFileSync(join(dir, OUTCOMES_NAME), text);
  }
  if (!omit.includes(AA_NAME)) {
    let text = readFileSync(AA_FIXTURE, "utf8");
    if (opts.aaText !== undefined) text = opts.aaText;
    else if (opts.aa) {
      const doc = JSON.parse(text);
      opts.aa(doc);
      text = JSON.stringify(doc, null, 2) + "\n";
    }
    writeFileSync(join(dir, AA_NAME), text);
  }
  if (!omit.includes(ALLOWED_NAME)) {
    let text = readFileSync(ALLOWED_FIXTURE, "utf8");
    if (opts.allowedText !== undefined) text = opts.allowedText;
    else if (opts.allowed) {
      const doc = JSON.parse(text);
      opts.allowed(doc);
      text = JSON.stringify(doc, null, 2) + "\n";
    }
    writeFileSync(join(dir, ALLOWED_NAME), text);
  }
  const names = THREE_FILES.filter(
    (name) =>
      !omit.includes(name) ||
      (opts.manifestKeep ?? []).includes(name),
  ).filter((name) => !(opts.manifestOmit ?? []).includes(name));
  const lines = names.map((name) => {
    if (opts.manifestFromFixture) return manifestLine(join(PAGE_B, name), name);
    const staged = join(dir, name);
    if (existsSync(staged)) return manifestLine(staged, name);
    return manifestLine(join(PAGE_B, name), name);
  });
  if (!omit.includes(MANIFEST_NAME)) {
    writeFileSync(
      join(dir, MANIFEST_NAME),
      opts.manifestText ?? `${lines.join("\n")}\n`,
    );
  }
  return { dir, manifest: join(dir, MANIFEST_NAME) };
}

function run(manifest: string, out: string, extraArgs: string[] = []) {
  requireProduction();
  return spawnSync(
    join(HARNESS, "node_modules", ".bin", "tsx"),
    ["model-guide/real-work.ts", "--manifest", manifest, "--out", out, ...extraArgs],
    { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000 },
  );
}

/** Exit 2, the one `input-check:` line on stderr, and no output file. */
function expectRefusal(manifest: string, tag: string, line: string) {
  const out = tempDir(`out-${tag}`);
  const result = run(manifest, out);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
  expect(result.stderr).toBe(`${line}\n`);
  expect(result.stdout, "a refusal writes nothing on stdout").toBe("");
  expect(existsSync(join(out, "real-work.json"))).toBe(false);
}

describe("FX1 the committed page B fixture", () => {
  it("FX1: the committed MANIFEST holds the SHA-256 and the size of each fixture file", () => {
    const lines = readFileSync(MANIFEST_FIXTURE, "utf8").split("\n").filter((line) => line !== "");
    expect(lines, "the MANIFEST holds one line per file").toHaveLength(3);
    for (const name of THREE_FILES) {
      const line = lines.find((entry) => entry.endsWith(`  ${name}`));
      expect(line, `the MANIFEST names ${name}`).toBeDefined();
      const [sha, size] = line!.split("  ");
      const data = readFileSync(join(PAGE_B, name));
      expect(sha, `SHA-256 of ${name}`).toBe(sha256Text(data.toString("utf8")));
      expect(Number(size), `size of ${name}`).toBe(data.length);
    }
    expect(readFileSync(MANIFEST_FIXTURE, "utf8")).not.toContain("2026-11-17");
  });
});

describe("DS1 integrity of each staged file", () => {
  const flips: Array<[string, string, [string, string]]> = [
    [
      OUTCOMES_NAME,
      OUTCOMES_FIXTURE,
      ['"tasks": 10', '"tasks": 11'],
    ],
    [
      AA_NAME,
      AA_FIXTURE,
      ['"netScore": 40.4', '"netScore": 41.4'],
    ],
    [
      ALLOWED_NAME,
      ALLOWED_FIXTURE,
      ['"t1/gate-two[1m]"', '"t1/gate-two[1n]"'],
    ],
  ];

  it.each(flips)(
    "DS1: one flipped byte of %s with the size and the JSON shape intact gives sha256 and no output file",
    (name, fixture, [from, to]) => {
      const original = readFileSync(fixture, "utf8");
      const changed = original.replace(from, to);
      expect(changed, "the flip changes the bytes").not.toBe(original);
      expect(changed.length, "the flip keeps the byte size").toBe(original.length);
      expect(() => JSON.parse(changed), "the flip keeps the file valid JSON").not.toThrow();
      const opts: StageOptions =
        name === OUTCOMES_NAME
          ? { outcomesText: changed, manifestFromFixture: true }
          : name === AA_NAME
            ? { aaText: changed, manifestFromFixture: true }
            : { allowedText: changed, manifestFromFixture: true };
      const { dir } = stagePageB(`sha-${name}`, opts);
      expectRefusal(join(dir, MANIFEST_NAME), `sha-${name}`, `input-check: sha256 ${name}`);
    },
  );

  it("DS1: a MANIFEST size of plus or minus one with the right SHA-256 gives size", () => {
    const { dir } = stagePageB("size");
    const lines = manifestOf(dir)
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [sha, size, name] = line.split("  ");
        return `${sha}  ${name === OUTCOMES_NAME ? Number(size) + 1 : size}  ${name}`;
      });
    writeFileSync(join(dir, MANIFEST_NAME), `${lines.join("\n")}\n`);
    expectRefusal(join(dir, MANIFEST_NAME), "size", `input-check: size ${OUTCOMES_NAME}`);
  });
});

describe("DS2 order and refusals", () => {
  it("DS2: a flipped byte that also breaks the JSON gives sha256, not json", () => {
    const original = readFileSync(OUTCOMES_FIXTURE, "utf8");
    const changed = original.replace('"role":', '"role"~');
    expect(changed.length).toBe(original.length);
    expect(() => JSON.parse(changed), "the flip breaks the JSON").toThrow();
    const { dir } = stagePageB("integrity-first", {
      outcomesText: changed,
      manifestFromFixture: true,
    });
    expectRefusal(
      join(dir, MANIFEST_NAME),
      "integrity-first",
      `input-check: sha256 ${OUTCOMES_NAME}`,
    );
  });

  it("DS2: a right SHA-256 with invalid JSON gives json", () => {
    const broken = '[1, 2, "no closing bracket"\n';
    const { dir } = stagePageB("json", { outcomesText: broken });
    expect(sha256(join(dir, OUTCOMES_NAME)), "the manifest matches the broken bytes").toBe(
      sha256Text(broken),
    );
    expectRefusal(join(dir, MANIFEST_NAME), "json", `input-check: json ${OUTCOMES_NAME}`);
  });

  it("DS2: no MANIFEST gives manifest with the manifest file name", () => {
    const { dir } = stagePageB("no-manifest", { omit: [MANIFEST_NAME] });
    expect(existsSync(join(dir, MANIFEST_NAME))).toBe(false);
    expectRefusal(
      join(dir, MANIFEST_NAME),
      "no-manifest",
      `input-check: manifest ${MANIFEST_NAME}`,
    );
  });

  it("DS2: a MANIFEST with no line for one file gives manifest with the file name", () => {
    const { dir } = stagePageB("missing-line", { manifestOmit: [AA_NAME] });
    expectRefusal(
      join(dir, MANIFEST_NAME),
      "missing-line",
      `input-check: manifest ${AA_NAME}`,
    );
  });

  it.each(["../decoy.json", "sub/name.json"])(
    "DS2: a MANIFEST line that names %s gives manifest and the decoy is never read",
    (badName) => {
      const root = tempDir("decoy");
      const dir = join(root, "stage");
      mkdirSync(dir, { recursive: true });
      for (const name of THREE_FILES) {
        writeFileSync(join(dir, name), readFileSync(join(PAGE_B, name)));
      }
      // The decoy outside the folder holds valid data with a right hash, so
      // a tool that read it would pass the manifest check on it.
      const decoy = join(root, badName.startsWith("..") ? "decoy.json" : "name.json");
      copyInto(decoy, OUTCOMES_FIXTURE);
      const lines = manifestOf(dir).split("\n").filter((line) => line !== "");
      const rebuilt = lines.map((line) => {
        const [, , name] = line.split("  ");
        if (name !== OUTCOMES_NAME) return line;
        return `${sha256(decoy)}  ${readFileSync(decoy).length}  ${badName}`;
      });
      writeFileSync(join(dir, MANIFEST_NAME), `${rebuilt.join("\n")}\n`);
      const out = tempDir("decoy-out");
      requireProduction();
      const result = spawnSync(
        join(HARNESS, "node_modules", ".bin", "tsx"),
        ["model-guide/real-work.ts", "--manifest", join(dir, MANIFEST_NAME), "--out", out],
        { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000 },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
      expect(result.stderr).toMatch(/^input-check: manifest( |\n|$)/);
      expect(result.stdout).toBe("");
      expect(existsSync(join(out, "real-work.json"))).toBe(false);
    },
  );

  it("DS2: a missing data file gives input with the file name", () => {
    const { dir } = stagePageB("missing-input", {
      omit: [AA_NAME],
      manifestKeep: [AA_NAME],
    });
    expect(existsSync(join(dir, AA_NAME))).toBe(false);
    expect(
      readFileSync(join(dir, MANIFEST_NAME), "utf8"),
      "the manifest still names the missing file",
    ).toContain(AA_NAME);
    expectRefusal(
      join(dir, MANIFEST_NAME),
      "missing-input",
      `input-check: input ${AA_NAME}`,
    );
  });

  const SCHEMA_CASES: Array<[string, StageOptions, string]> = [
    ["an outcomes file that is not an array", { outcomesText: '{"rows": []}\n' }, OUTCOMES_NAME],
    [
      "an AA file with no models object",
      { aa: (doc) => { delete doc.models; } },
      AA_NAME,
    ],
    [
      "an allowed file that lacks an array",
      { allowed: (doc) => { delete doc.allowedRoutes; } },
      ALLOWED_NAME,
    ],
  ];

  it.each(SCHEMA_CASES)("DS2: %s gives schema with the file name", (_label, opts, name) => {
    const { dir } = stagePageB(`schema-${name}`, opts);
    expectRefusal(join(dir, MANIFEST_NAME), `schema-${name}`, `input-check: schema ${name}`);
  });

  it.each([
    ["no argument", [] as string[]],
    ["an empty manifest value", ["--manifest", ""]],
    ["an unknown flag", ["--unknown"]],
  ])("DS2: %s gives one usage line on stderr, empty stdout, and no file", (_label, args) => {
    stagePageB("usage");
    const out = tempDir("usage-out");
    requireProduction();
    const result = spawnSync(
      join(HARNESS, "node_modules", ".bin", "tsx"),
      ["model-guide/real-work.ts", ...args, ...(args.length ? ["--out", out] : [])],
      { cwd: HARNESS, env: env(), encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stderr).toBe(USAGE);
    expect(result.stdout).toBe("");
    expect(existsSync(join(out, "real-work.json"))).toBe(false);
  });
});

describe("DS3 no copy of an input file", () => {
  it("DS3: a passing run writes no input file name and no input bytes outside the staged folder", () => {
    const workspace = tempDir("ds3");
    const dir = join(workspace, "page-b");
    mkdirSync(dir, { recursive: true });
    for (const name of THREE_FILES) {
      writeFileSync(join(dir, name), readFileSync(join(PAGE_B, name)));
    }
    writeFileSync(join(dir, MANIFEST_NAME), manifestOf(dir));
    const out = join(workspace, "out");
    const result = run(join(dir, MANIFEST_NAME), out);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(out, "real-work.json"))).toBe(true);

    const inputBytes = THREE_FILES.map((name) => readFileSync(join(dir, name)));
    const walk = (current: string, rel: string): void => {
      for (const name of readdirSync(current)) {
        const full = join(current, name);
        const path = rel ? `${rel}/${name}` : name;
        if (path === "page-b") continue;
        const info = lstatSync(full);
        if (info.isDirectory()) {
          walk(full, path);
          continue;
        }
        const data = readFileSync(full);
        expect(
          THREE_FILES.includes(name as (typeof THREE_FILES)[number]),
          `DS3: the input file name ${name} appears at ${path}`,
        ).toBe(false);
        expect(
          inputBytes.some((input) => input.equals(data)),
          `DS3: the bytes of an input file appear at ${path}`,
        ).toBe(false);
      }
    };
    walk(workspace, "");
  });
});

describe("FX3 no real dated file name in a test", () => {
  it("FX3: no test file names a real dated data file or the real MANIFEST", () => {
    const needles = [
      "ra-outcomes-" + "2026-11-17.json",
      "aa-reliability-" + "2026-11-17.json",
      "allowed-routes-" + "2026-11-17.json",
      "MANIFEST-" + "2026-11-17.txt",
    ];
    const testsDir = import.meta.dirname;
    const offenders: string[] = [];
    const walk = (current: string): void => {
      for (const name of readdirSync(current)) {
        const full = join(current, name);
        if (lstatSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts")) continue;
        const text = readFileSync(full, "utf8");
        for (const needle of needles) {
          if (text.includes(needle)) offenders.push(`${name}: ${needle}`);
        }
      }
    };
    walk(testsDir);
    expect(offenders, "a test must build the real file names from two parts").toEqual([]);
  });
});

/** Copy a fixture file to a new path. */
function copyInto(target: string, source: string): void {
  writeFileSync(target, readFileSync(source));
}
