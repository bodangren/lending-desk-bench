import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 2.1, re-pinned by task 2.4a to the real OD6 key
 * shape: the print-audit input check and the print-audit data file
 * (spec D17, OD6, FR-5). They call the tool
 * `harness/model-guide/print-audit.ts`.
 *
 * Pinned command-line interface:
 *   cd harness && npx tsx model-guide/print-audit.ts --input <file> --out <folder>
 * Exit 0 writes `<folder>/print-audit-2026-11.json`. Exit 2 writes no
 * output file, and prints exactly one line on stdout:
 * `input-check: <check>`.
 *
 * Fixture shape (the real OD6 key shape, synthetic values only):
 *   top keys   `source` (string), `note` (string), `routes` (short key ->
 *              route name string), `summary` (object), `errors` (52 rows)
 *   summary    `key` holds `blockers`, `majors`, `minors`; one object per
 *              route short key holds `blockers_found` and the other
 *              counts; `bias_note` is a string
 *   row        `id` (string), `severity` (`blocker` | `major` | `minor`),
 *              `checklist` (0 to 3 objects with `item` and `text`, both
 *              strings), and one string per route short key
 *   the row has no `type`, no `results` list, and no checklist `code`
 *
 * Ruling (spec D17, orchestrator 2026-11-15): the error types are the
 * severity classes `blocker`, `major`, `minor` with the count of rows of
 * each; the checklist code is the `item` value; a run result is the row
 * value under the route short key; a route result is `blockers_found` of
 * that route over `summary.key.blockers`.
 *
 * The checks and their order:
 *   input     the path is missing or is not a regular file
 *   manifest  MANIFEST.txt is missing next to the input file, or its
 *             `sha256:` line is not 64 hex characters
 *   sha256    the SHA-256 differs from the `sha256:` line of MANIFEST.txt
 *   json      the input text is not JSON
 *   keys      a top key of `source`, `note`, `routes`, `summary`, or
 *             `errors` is missing, or a route value is not a string
 *   errors    `errors` is not an array of exactly 52 valid rows; a valid
 *             row holds `id`, `severity`, `checklist`, and one string per
 *             route short key, and no `type` and no `results` key; a
 *             checklist item holds `item` and `text`
 *
 * Spec D17 (finding F13) drops the size check and the schema-key check for
 * this file. No test asserts a size field or a schema key of the hand-off.
 *
 * Pinned MANIFEST.txt format (one value on each of these lines):
 *   sha256: <64 hex>
 *   size: <decimal bytes>
 * The PM sum line `<sha256>  <size>  <file name>` is accepted too.
 *
 * Pinned output shape of `print-audit-2026-11.json`:
 *   schema                       `model-guide-print-audit/1`
 *   source.sha256                the `sha256:` value of MANIFEST.txt
 *   totals.errors                52
 *   totals.blockers              13
 *   routes                       each route name to `11 of 13` style text
 *   error_types                  `blocker`, `major`, `minor` to the row
 *                                count of that severity class
 *   errors                       the 52 input rows, in order, with the
 *                                fields `id`, `severity`, `checklist`
 *                                (`code` and `text`), and `results` (one
 *                                value per route, in route order)
 *   summary                      the input `summary`
 *   note                         the input `note` (the bias note)
 *
 * The output holds no key `pages`, `text`, or `file` at any depth outside
 * a `checklist` item, and no line that the input does not hold (spec D17:
 * no book text, no page, no file name). A `checklist` item holds exactly a
 * `code` and a `text`.
 *
 * The tests use the synthetic fixture pair of `fixtures/print-audit/`. No
 * test reads the real hand-off file, the real docs/, a model, the network,
 * or the private folder.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "print-audit.ts");
const FIXTURE_DIR = join(import.meta.dirname, "fixtures", "print-audit");
const FIXTURE = join(FIXTURE_DIR, "print-audit-mini.json");
const MANIFEST = join(FIXTURE_DIR, "MANIFEST.txt");
const OUTPUT_NAME = "print-audit-2026-11.json";
const PLACEHOLDER = "Error types: not yet received.";
const TOP_KEYS = ["source", "note", "routes", "summary", "errors"];
const ROW_KEYS = ["id", "severity", "checklist", "results"];

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-print-audit-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(TOOL)) {
    throw new Error(
      `production file is missing: ${TOOL} (Phase 1 has no print-audit tool)`,
    );
  }
}

function env(): NodeJS.ProcessEnv {
  const copy = { ...process.env, NO_COLOR: "1", npm_config_loglevel: "silent" };
  delete copy.BENCH_TRACK;
  return copy;
}

function run(input: string, out: string) {
  requireProduction();
  return spawnSync(
    join(HARNESS, "node_modules", ".bin", "tsx"),
    ["model-guide/print-audit.ts", "--input", input, "--out", out],
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

function manifestSha(): string {
  const match = readFileSync(MANIFEST, "utf8").match(/^sha256: ([0-9a-f]{64})$/m);
  if (!match) throw new Error("the fixture MANIFEST.txt has no sha256 line");
  return match[1];
}

function manifestFor(sha: string, size: number): string {
  return [
    `sha256: ${sha}`,
    `size: ${size}`,
    "source-commit: none (synthetic fixture, 2026-11-15)",
    "row-counts: errors_rows 52, blocker_rows 13, checklist_rows 43, no_checklist_rows 9",
    "",
  ].join("\n");
}

/** Copy the fixture into a temp folder, mutate the JSON, and write a
 * matching manifest, so the run reaches the check under test. */
function staged(tag: string, mutate: (doc: any) => void): { dir: string; json: string } {
  const dir = tempDir(tag);
  const doc = JSON.parse(readFileSync(FIXTURE, "utf8"));
  mutate(doc);
  const json = join(dir, "print-audit-mini.json");
  const text = JSON.stringify(doc);
  writeFileSync(json, text);
  writeFileSync(join(dir, "MANIFEST.txt"), manifestFor(sha256(json), Buffer.byteLength(text)));
  return { dir, json };
}

function expectRefusal(input: string, tag: string, check: string) {
  const out = tempDir(tag);
  const result = run(input, out);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
  expect(result.stdout.trim()).toBe(`input-check: ${check}`);
  expect(readdirSync(out)).toEqual([]);
}

/** Run the tool on the untouched fixture and return the written file. */
function accept(): { out: string; text: string; data: any } {
  const out = tempDir("accept");
  const result = run(FIXTURE, out);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const file = join(out, OUTPUT_NAME);
  expect(existsSync(file), `the tool writes ${OUTPUT_NAME}`).toBe(true);
  const text = readFileSync(file, "utf8");
  return { out, text, data: JSON.parse(text) };
}

/** Every string value of `value` at any depth. */
function stringValues(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) stringValues(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) stringValues(item, found);
  }
  return found;
}

/** Keys named `pages`, `text`, or `file` at any depth. A `checklist` item
 * is terminal: it holds only `code` and `text` (spec D17, anti-pattern A7). */
function forbiddenKeys(value: unknown, path: string[] = []): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    const inChecklist = path.at(-1) === "checklist";
    for (const [index, item] of value.entries()) {
      if (inChecklist) {
        const keys = Object.keys(item ?? {}).sort();
        if (keys.join(",") !== "code,text") {
          found.push(`${path.join(".")}[${index}] keys ${keys.join(",")}`);
        }
        continue;
      }
      found.push(...forbiddenKeys(item, [...path, String(index)]));
    }
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  for (const [key, item] of Object.entries(value)) {
    if (["pages", "text", "file"].includes(key)) {
      found.push([...path, key].join("."));
      continue;
    }
    found.push(...forbiddenKeys(item, [...path, key]));
  }
  return found;
}

function histogram(rows: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.severity] = (out[row.severity] ?? 0) + 1;
  return out;
}

describe("print-audit input check (spec D17)", () => {
  it("N1: passes on the fixture pair and writes the D17 facts into the output file", () => {
    const { text, data } = accept();
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

    expect(data.schema).toBe("model-guide-print-audit/1");
    expect(data.source.sha256, "the SHA-256 comes from MANIFEST.txt").toBe(manifestSha());
    expect(data.totals.errors).toBe(52);
    expect(data.totals.blockers).toBe(13);
    expect(data.routes["k3.1-pro"]).toBe("11 of 13");
    expect(data.routes["Sonnet 5.5"]).toBe("13 of 13");

    // Ruling D17: a route result is blockers_found over summary.key.blockers.
    const routeKeys = Object.keys(fixture.routes);
    for (const key of routeKeys) {
      const name = fixture.routes[key];
      expect(data.routes[name], `route ${name}`).toBe(
        `${fixture.summary[key].blockers_found} of ${fixture.summary.key.blockers}`,
      );
    }
    expect(Object.keys(data.routes).sort()).toEqual(
      Object.values(fixture.routes).slice().sort(),
    );

    // Ruling D17: the error types are the severity classes with the count
    // of rows of each.
    expect(Object.keys(data.error_types).sort()).toEqual(["blocker", "major", "minor"]);
    expect(data.error_types).toEqual(histogram(fixture.errors));
    const typeTotal = Object.values(data.error_types).reduce(
      (sum: number, n: number) => sum + n,
      0,
    );
    expect(typeTotal).toBe(52);

    expect(data.errors).toHaveLength(52);
    expect(data.errors.map((row: any) => row.id)).toEqual(
      fixture.errors.map((row: any) => row.id),
    );
    for (const [index, row] of data.errors.entries()) {
      expect(Object.keys(row).sort(), `row ${index} fields`).toEqual([...ROW_KEYS].sort());
      const source = fixture.errors[index];
      expect(row.severity, `row ${index} severity`).toBe(source.severity);
      expect(row.results, `row ${index} results`).toEqual(
        routeKeys.map((key) => source[key]),
      );
      expect(row.checklist, `row ${index} checklist`).toHaveLength(source.checklist.length);
      for (const [i, item] of row.checklist.entries()) {
        expect(Object.keys(item).sort(), `row ${index} item ${i} fields`).toEqual(
          ["code", "text"],
        );
        expect(item.code, `row ${index} item ${i} code`).toBe(source.checklist[i].item);
        expect(item.text, `row ${index} item ${i} text`).toBe(source.checklist[i].text);
      }
    }
    const withItems = data.errors.filter((row: any) => row.checklist.length > 0);
    const withoutItems = data.errors.filter((row: any) => row.checklist.length === 0);
    expect(withItems).toHaveLength(43);
    expect(withoutItems).toHaveLength(9);

    expect(JSON.stringify(data.summary)).toBe(JSON.stringify(fixture.summary));
    expect(data.note).toBe(fixture.note);
    expect(text).not.toContain(PLACEHOLDER);
  });

  it("N2: a changed byte gives exit 2, one named line, and no output file", () => {
    const dir = tempDir("changed-byte");
    const json = join(dir, "print-audit-mini.json");
    const original = readFileSync(FIXTURE, "utf8");
    const changed = original.replace("synthetic print-audit", "synthetic print-aud1t");
    expect(changed, "the byte really changed").not.toBe(original);
    writeFileSync(json, changed);
    expect(sha256(json)).not.toBe(manifestSha());
    writeFileSync(join(dir, "MANIFEST.txt"), readFileSync(MANIFEST));
    expectRefusal(json, "changed-byte-out", "sha256");
  });

  it("N2: a wrong SHA-256 in MANIFEST.txt gives exit 2, one named line, and no output file", () => {
    const dir = tempDir("wrong-manifest");
    const json = join(dir, "print-audit-mini.json");
    writeFileSync(json, readFileSync(FIXTURE));
    const wrong = "0".repeat(64);
    expect(wrong).not.toBe(sha256(json));
    writeFileSync(
      join(dir, "MANIFEST.txt"),
      manifestFor(wrong, Buffer.byteLength(readFileSync(FIXTURE))),
    );
    expectRefusal(json, "wrong-manifest-out", "sha256");
  });

  it("N2: a missing top key gives exit 2, one named line, and no output file", () => {
    const pair = staged("missing-key", (doc) => {
      delete doc.routes;
    });
    expectRefusal(pair.json, "missing-key-out", "keys");
  });

  it("N2: 51 errors rows give exit 2, one named line, and no output file", () => {
    const pair = staged("row-count", (doc) => {
      doc.errors.pop();
      expect(doc.errors).toHaveLength(51);
    });
    expectRefusal(pair.json, "row-count-out", "errors");
  });

  it("N5: a row with a type key gives exit 2, one named line, and no output file", () => {
    const pair = staged("row-type", (doc) => {
      doc.errors[0].type = "missing content";
    });
    expectRefusal(pair.json, "row-type-out", "errors");
  });

  it("N5: a row with a results list gives exit 2, one named line, and no output file", () => {
    const pair = staged("row-results", (doc) => {
      doc.errors[0].results = ["found", "found", "missed"];
    });
    expectRefusal(pair.json, "row-results-out", "errors");
  });

  it("N5: a checklist item with code instead of item gives exit 2, one named line, and no output file", () => {
    const pair = staged("item-code", (doc) => {
      const item = doc.errors[0].checklist[0];
      item.code = item.item;
      delete item.item;
    });
    expectRefusal(pair.json, "item-code-out", "errors");
  });

  it("N5: a route value in the old object shape gives exit 2, one named line, and no output file", () => {
    const pair = staged("route-object", (doc) => {
      for (const key of Object.keys(doc.routes)) {
        doc.routes[key] = { blockers_total: 13, blockers_resolved: 11 };
      }
    });
    expectRefusal(pair.json, "route-object-out", "keys");
  });

  it("N3: the output holds no pages, text, or file key outside the checklist", () => {
    const { text, data } = accept();
    const found = forbiddenKeys(data);
    expect(found, `forbidden keys: ${found.join(", ")}`).toEqual([]);
    expect(text).not.toMatch(/"pages"\s*:/);
    expect(text).not.toMatch(/"file"\s*:/);
  });

  it("N3: every string value of the output comes from the fixture or from a computed label", () => {
    const { data } = accept();
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
    // Ruling D17: a route result is blockers_found over summary.key.blockers.
    const routeResults = Object.keys(fixture.routes).map(
      (key) => `${fixture.summary[key].blockers_found} of ${fixture.summary.key.blockers}`,
    );
    const allowed = new Set([
      ...stringValues(fixture),
      "model-guide-print-audit/1",
      ...routeResults,
      manifestSha(),
    ]);
    const stray = stringValues(data).filter((value) => !allowed.has(value));
    expect(stray, `strings the fixture does not hold: ${stray.join(" | ")}`).toEqual([]);
  });

  it("N3: each checklist item holds exactly a code and a text", () => {
    const { data } = accept();
    for (const row of data.errors) {
      for (const item of row.checklist) {
        expect(Object.keys(item).sort()).toEqual(["code", "text"]);
        expect(typeof item.code).toBe("string");
        expect(typeof item.text).toBe("string");
      }
    }
  });

  it("N4: the tool output holds every error type with its count and no placeholder line", () => {
    const { text, data } = accept();
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(text).not.toContain(PLACEHOLDER);
    const expected = histogram(fixture.errors);
    expect(Object.keys(data.error_types).sort()).toEqual(Object.keys(expected).sort());
    for (const [type, count] of Object.entries(expected)) {
      expect(data.error_types[type], `type ${type}`).toBe(count);
      expect(count).toBeGreaterThan(0);
    }
  });
});
