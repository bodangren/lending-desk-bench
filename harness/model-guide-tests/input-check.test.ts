import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 1.2: the input check of page B (spec D16, EV1,
 * EV2, FR-1). They call the planned tool `harness/model-guide/real-work.ts`.
 *
 * Pinned command-line interface:
 *   cd harness && npx tsx model-guide/real-work.ts --input <export.json> --out <folder>
 * Exit 0: writes `<folder>/real-work.json`. Exit 2: writes no output file,
 * and prints exactly one line on stdout: `input-check: <check>`.
 *
 * The checks and their order:
 *   manifest  the file MANIFEST.txt is missing next to the input file, or a
 *             sum line names another file
 *   sha256    the SHA-256 differs from the `sha256:` line of MANIFEST.txt
 *   size      the byte size differs from the `size:` line of MANIFEST.txt
 *   schema    `schema` is not `real-work-outcomes/1`
 *   run-sum   coverage.runs differs from the sum of `weekly[].runs` or from
 *             the sum of `all_time[].runs`
 *
 * Pinned MANIFEST.txt format (one value on each of these lines):
 *   sha256: <64 hex>
 *   size: <decimal bytes>
 *
 * The PM sum-line format is also accepted:
 *   <sha256>  <size>  <file name>
 * The file name must equal the base name of the input file. A wrong file name
 * gives `input-check: manifest`.
 *
 * A usage error gives exit 2 and this exact line on stderr:
 *   usage: real-work.ts --input <file> --out <folder>
 * An unknown flag gives the same usage error. The tool writes no output file.
 *
 * A passing check writes `real-work.json` with schema
 * `model-guide-real-work/1` and these source fields:
 *   source.file        the base name of the input file
 *   source.sha256      the SHA-256 of the input file
 *   source.generated_on the `generated_on` value of the input file
 *
 * The tests use a temp copy of the synthetic fixture. No test reads the real
 * export, the real docs/, a model, the network, or the private folder.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "real-work.ts");
const FIXTURE = join(import.meta.dirname, "fixtures", "real-work-mini.json");
const MANIFEST = join(import.meta.dirname, "fixtures", "MANIFEST.txt");
const USAGE = "usage: real-work.ts --input <file> --out <folder>\n";

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

function run(input: string, out: string, extraArgs: string[] = []) {
  requireProduction();
  return spawnSync(
    join(HARNESS, "node_modules", ".bin", "tsx"),
    ["model-guide/real-work.ts", "--input", input, "--out", out, ...extraArgs],
    {
      cwd: HARNESS,
      env: env(),
      encoding: "utf8",
      timeout: 60_000,
    },
  );
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function manifestFor(sha: string, size: number): string {
  return [
    `sha256: ${sha}`,
    `size: ${size}`,
    "source-commit: none (synthetic fixture, 2026-11-14)",
    "row-counts: weekly_rows 55, all_time_rows 11",
    "",
  ].join("\n");
}

function sumManifestFor(sha: string, size: number, fileName: string): string {
  return `${sha}  ${size}  ${fileName}\n`;
}

/** Copy the fixture into a temp folder, mutate the JSON, and write a matching manifest. */
function staged(tag: string, mutate: (doc: any) => void): { dir: string; json: string } {
  const dir = tempDir(tag);
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8"));
  mutate(doc);
  const json = join(dir, "real-work-mini.json");
  const text = JSON.stringify(doc);
  writeFileSync(json, text);
  writeFileSync(join(dir, "MANIFEST.txt"), manifestFor(sha256(json), Buffer.byteLength(text)));
  return { dir, json };
}

/** Copy the fixture without a mutation and write a chosen manifest. */
function stagedWithManifest(tag: string, manifest: (json: string) => string): { dir: string; json: string } {
  const dir = tempDir(tag);
  const json = join(dir, "real-work-mini.json");
  writeFileSync(json, readFileSync(FIXTURE));
  writeFileSync(join(dir, "MANIFEST.txt"), manifest(json));
  return { dir, json };
}

function expectRefusal(input: string, tag: string, check: string) {
  const out = tempDir(tag);
  const result = run(input, out);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
  expect(result.stdout.trim()).toBe(`input-check: ${check}`);
  expect(existsSync(join(out, "real-work.json"))).toBe(false);
}

describe("page B input check", () => {
  it("passes on the fixture and keeps the file name, the SHA-256, and generated_on", () => {
    const out = tempDir("accept");
    const result = run(FIXTURE, out);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const page = JSON.parse(readFileSync(join(out, "real-work.json"), "utf8"));
    expect(page.schema).toBe("model-guide-real-work/1");
    expect(page.source.file).toBe("real-work-mini.json");
    expect(page.source.sha256).toBe(sha256(FIXTURE));
    expect(page.source.generated_on).toBe("2026-11-14");
    expect(page.source.sha256).toBe(
      readFileSync(MANIFEST, "utf8").match(/^sha256: ([0-9a-f]{64})$/m)?.[1],
    );
  });

  it("refuses a changed byte with exit 2 and writes no output file", () => {
    const dir = tempDir("sha");
    const json = join(dir, "real-work-mini.json");
    const changed = readFileSync(FIXTURE, "utf8")
      .replace('"generated_on": "2026-11-14"', '"generated_on": "2026-11-15"');
    expect(changed).not.toBe(readFileSync(FIXTURE, "utf8"));
    writeFileSync(json, changed);
    writeFileSync(join(dir, "MANIFEST.txt"), readFileSync(MANIFEST));
    expectRefusal(json, "sha-out", "sha256");
  });

  it("refuses a wrong size with exit 2 and writes no output file", () => {
    const size = Number(readFileSync(MANIFEST, "utf8").match(/^size: ([0-9]+)$/m)?.[1]);
    const stagedPair = stagedWithManifest("size", (json) => manifestFor(sha256(json), size + 1));
    expectRefusal(stagedPair.json, "size-out", "size");
  });

  it("refuses a wrong schema with exit 2 and writes no output file", () => {
    const stagedPair = staged("schema", (doc) => {
      doc.schema = "real-work-outcomes/2";
    });
    expectRefusal(stagedPair.json, "schema-out", "schema");
  });

  it("refuses a run sum that differs from coverage.runs with exit 2", () => {
    const stagedPair = staged("run-sum", (doc) => {
      doc.coverage.runs = 286;
    });
    expectRefusal(stagedPair.json, "run-sum-out", "run-sum");
  });

  it("refuses a missing MANIFEST.txt with exit 2 and writes no output file", () => {
    const dir = tempDir("manifest");
    const json = join(dir, "real-work-mini.json");
    writeFileSync(json, readFileSync(FIXTURE));
    expect(readdirSync(dir).sort()).toEqual(["real-work-mini.json"]);
    expectRefusal(json, "manifest-out", "manifest");
  });

  it("A3 accepts a good PM sum-line manifest", () => {
    const dir = tempDir("sum-accept");
    const json = join(dir, "real-work-mini.json");
    writeFileSync(json, readFileSync(FIXTURE));
    const text = readFileSync(json);
    writeFileSync(
      join(dir, "MANIFEST.txt"),
      sumManifestFor(sha256(json), text.length, basename(json)),
    );
    const out = tempDir("sum-accept-out");
    const result = run(json, out);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(join(out, "real-work.json"))).toBe(true);
  });

  it("A3 refuses a changed byte with the sha256 line for a PM sum-line manifest", () => {
    const dir = tempDir("sum-sha");
    const json = join(dir, "real-work-mini.json");
    const original = readFileSync(FIXTURE);
    writeFileSync(json, original);
    const originalSha = sha256(json);
    const changed = readFileSync(FIXTURE, "utf8")
      .replace('"generated_on": "2026-11-14"', '"generated_on": "2026-11-15"');
    writeFileSync(json, changed);
    writeFileSync(
      join(dir, "MANIFEST.txt"),
      sumManifestFor(originalSha, original.length, basename(json)),
    );
    expectRefusal(json, "sum-sha-out", "sha256");
  });

  it("A3 refuses a wrong size with the size line for a PM sum-line manifest", () => {
    const dir = tempDir("sum-size");
    const json = join(dir, "real-work-mini.json");
    writeFileSync(json, readFileSync(FIXTURE));
    const text = readFileSync(json);
    writeFileSync(
      join(dir, "MANIFEST.txt"),
      sumManifestFor(sha256(json), text.length + 1, basename(json)),
    );
    expectRefusal(json, "sum-size-out", "size");
  });

  it("A3 refuses a PM sum line that names another file with the manifest line", () => {
    const dir = tempDir("sum-name");
    const json = join(dir, "real-work-mini.json");
    writeFileSync(json, readFileSync(FIXTURE));
    const text = readFileSync(json);
    writeFileSync(
      join(dir, "MANIFEST.txt"),
      sumManifestFor(sha256(json), text.length, "other-export.json"),
    );
    expectRefusal(json, "sum-name-out", "manifest");
  });

  it("C4 refuses an unknown real-work flag with a usage line and writes no output file", () => {
    const dir = tempDir("unknown-flag");
    const json = join(dir, "real-work-mini.json");
    writeFileSync(json, readFileSync(FIXTURE));
    writeFileSync(join(dir, "MANIFEST.txt"), readFileSync(MANIFEST));
    const out = tempDir("unknown-flag-out");
    const result = run(json, out, ["--unknown"]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(USAGE);
    expect(readdirSync(out)).toEqual([]);
  });

  const A32_CASES: Array<[string, (doc: any) => void]> = [
    ["a null coverage runs value", (doc) => { doc.coverage.runs = null; }],
    ["a number in coverage first_run_date", (doc) => { doc.coverage.first_run_date = 20260928; }],
    ["a string in coverage share_known_route", (doc) => { doc.coverage.share_known_route = "0.568"; }],
    ["a missing generated_on", (doc) => { delete doc.generated_on; }],
  ];

  it.each(A32_CASES)(
    "A3-2 refuses %s with the schema line and no output file",
    (_label, mutate) => {
      const pair = staged("a3-2", mutate);
      expectRefusal(pair.json, "a3-2-out", "schema");
    },
  );
});
