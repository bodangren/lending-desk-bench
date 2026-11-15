/** Print-audit data tool (spec D17, OD6, FR-5).
 *
 * Usage:
 *   npx tsx model-guide/print-audit.ts --input <file> --out <folder>
 *
 * Exit 0 writes `<folder>/print-audit-2026-11.json` with schema
 * `model-guide-print-audit/1`. Exit 2 writes no output file and prints one
 * line `input-check: <check>` on stdout. The checks run in this order:
 * input, manifest, sha256, json, keys, errors.
 *   input     the path is missing or is not a regular file
 *   manifest  `MANIFEST.txt` is missing next to the file, or it holds no
 *             SHA-256 line
 *   sha256    the SHA-256 of the file differs from the manifest line
 *   json      the file text is not JSON
 *   keys      a top key of `source`, `note`, `routes`, `summary`, or
 *             `errors` is missing, or a route value is not a string, or
 *             `summary.key.blockers` or a route `blockers_found` is not an
 *             integer
 *   errors    `errors` is not an array of exactly 52 valid rows; a valid row
 *             holds `id`, `severity`, `checklist`, and one string per route
 *             short key, and no `type` and no `results` key; a checklist item
 *             holds `item` and `text`
 * Spec D17 (finding F13) drops the size check and the schema-key check for
 * this file.
 *
 * The output holds the 52 rows with the fields id, severity, checklist (a
 * code and a text), and results; the error types with their counts; the two
 * route results as `11 of 13` style text; the summary; and the bias note.
 * No key `pages`, `text`, or `file` sits outside a checklist item, so no
 * page and no file name reaches the page.
 *
 * The tool reads one hand-off shape only (spec OD6, D17):
 *   rows   a row holds `id`, `severity`, `checklist`, and one string per
 *          route short key; the severity class is the error type and the
 *          values under the route keys are the results of the runs
 *   routes a route short key maps to a route name string and
 *          `summary[key].blockers_found` over `summary.key.blockers` is the
 *          route result
 * The old shape (a row `type` key, a row `results` list, a checklist item
 * without `item`, or a route value that is not a string) is refused.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const OUTPUT_NAME = "print-audit-2026-11.json";
const SCHEMA = "model-guide-print-audit/1";
const TOP_KEYS = ["source", "note", "routes", "summary", "errors"];
const ROW_COUNT = 52;

function refuse(check: string): never {
  process.stdout.write(`input-check: ${check}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]): { input: string; out: string } {
  let input = "";
  let out = "";
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === "--input") {
      input = argv[i + 1] ?? "";
      i += 2;
    } else if (argv[i] === "--out") {
      out = argv[i + 1] ?? "";
      i += 2;
    } else {
      process.stderr.write("usage: print-audit.ts --input <file> --out <folder>\n");
      process.exit(2);
    }
  }
  if (!input || !out) {
    process.stderr.write("usage: print-audit.ts --input <file> --out <folder>\n");
    process.exit(2);
  }
  return { input, out };
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The SHA-256 of `MANIFEST.txt`: a `sha256:` line, or a sum line that
 * starts with the 64 hex characters (spec D17). The size line is ignored. */
function manifestSha(text: string): string | null {
  const direct = text.match(/^sha256: ([0-9a-f]{64})$/m);
  if (direct) return direct[1];
  const sum = text.match(/^([0-9a-f]{64})\s+\S+/m);
  return sum ? sum[1] : null;
}

/** A checklist item of the real shape holds `item` and `text`, both strings. */
function validChecklist(value: unknown): value is Array<Record<string, any>> {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item: unknown) =>
      isObject(item) && typeof item.item === "string" && typeof item.text === "string",
  );
}

/** A valid row holds id, severity, checklist, and one string per route key.
 * The old shape (`type` or `results`) is refused. */
function validRow(row: unknown, routeKeys: string[]): row is Record<string, any> {
  if (!isObject(row)) return false;
  if (Object.hasOwn(row, "type") || Object.hasOwn(row, "results")) return false;
  if (typeof row.id !== "string" || typeof row.severity !== "string") return false;
  if (!validChecklist(row.checklist)) return false;
  return routeKeys.every((key) => typeof row[key] === "string");
}

function rowChecklist(row: Record<string, any>): Array<{ code: string; text: string }> {
  return (row.checklist as Array<Record<string, any>>).map((item) => ({
    code: item.item,
    text: item.text,
  }));
}

/** The results of the runs: the row value under each route short key, in
 * route order. */
function rowResults(row: Record<string, any>, routeKeys: string[]): string[] {
  return routeKeys.map((key) => row[key]);
}

function main(): void {
  const { input, out } = parseArgs(process.argv.slice(2));

  if (!existsSync(input) || !statSync(input).isFile()) refuse("input");

  const manifestPath = join(dirname(input), "MANIFEST.txt");
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) refuse("manifest");
  const expected = manifestSha(readFileSync(manifestPath, "utf8"));
  if (expected === null) refuse("manifest");

  const text = readFileSync(input, "utf8");
  const sha256 = createHash("sha256").update(readFileSync(input)).digest("hex");
  if (sha256 !== expected) refuse("sha256");

  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    refuse("json");
  }
  if (!isObject(doc)) refuse("keys");
  for (const key of TOP_KEYS) {
    if (!(key in doc)) refuse("keys");
  }

  const routeKeys = isObject(doc.routes) ? Object.keys(doc.routes) : [];
  if (routeKeys.length === 0) refuse("keys");
  const summary = isObject(doc.summary) ? doc.summary : {};
  const total = isObject(summary.key) ? summary.key.blockers : undefined;
  if (!Number.isSafeInteger(total)) refuse("keys");

  const entries: Array<[string, string]> = [];
  for (const key of routeKeys) {
    const name = doc.routes[key];
    if (typeof name !== "string") refuse("keys");
    const entry = summary[key];
    const found = isObject(entry) ? entry.blockers_found : undefined;
    if (!Number.isSafeInteger(found)) refuse("keys");
    entries.push([name, `${found} of ${total}`]);
  }
  const routes: Record<string, string> = Object.fromEntries(entries);

  const rows: unknown[] = Array.isArray(doc.errors) ? doc.errors : [];
  if (rows.length !== ROW_COUNT) refuse("errors");
  if (!rows.every((row) => validRow(row, routeKeys))) refuse("errors");

  const types = new Map<string, number>();
  const errors = (rows as Array<Record<string, any>>).map((row) => {
    types.set(row.severity, (types.get(row.severity) ?? 0) + 1);
    return {
      id: row.id,
      severity: row.severity,
      checklist: rowChecklist(row),
      results: rowResults(row, routeKeys),
    };
  });
  const errorTypes = Object.fromEntries(
    [...types.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );

  const audit = {
    schema: SCHEMA,
    source: { sha256 },
    totals: {
      errors: errors.length,
      blockers: errors.filter((row) => row.severity === "blocker").length,
    },
    routes,
    error_types: errorTypes,
    errors,
    summary: doc.summary,
    note: doc.note,
  };

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, OUTPUT_NAME), `${JSON.stringify(audit, null, 2)}\n`);
}

main();
