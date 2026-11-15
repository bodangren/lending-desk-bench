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
 *             `errors` is missing, or a route result is unreadable
 *   errors    `errors` is not an array of exactly 52 rows
 * Spec D17 (finding F13) drops the size check and the schema-key check for
 * this file.
 *
 * The output holds the 52 rows with the fields id, severity, type,
 * checklist (a code and a text), and results; the error types with their
 * counts; the two route results as `11 of 13` style text; the summary; and
 * the bias note. No key `pages`, `text`, or `file` sits outside a checklist
 * item, so no page and no file name reaches the page.
 *
 * Two hand-off shapes are accepted (spec OD6, D17):
 *   rows   a row holds `type` and `results`, as the Red fixture does; else
 *          the row `severity` is the error type and the values under the
 *          route keys are the results of the runs
 *   routes a route maps to `{ blockers_total, blockers_resolved }`; else it
 *          maps to a route name and `summary` holds the blocker counts
 * The hand-off of OD6 holds no row type. There the severity class is the
 * one per-row classification of the file, so it is the error type.
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

/** The one classification of a row: its own `type`, else its severity. */
function rowType(row: Record<string, any>): string {
  if (typeof row.type === "string") return row.type;
  if (typeof row.severity === "string") return row.severity;
  return "no type";
}

function rowChecklist(row: Record<string, any>): Array<{ code: string; text: string }> {
  const items = Array.isArray(row.checklist) ? row.checklist : [];
  return items
    .filter((item: unknown) => isObject(item))
    .map((item: Record<string, any>) => ({
      code: String(item.code ?? item.item ?? ""),
      text: String(item.text ?? ""),
    }));
}

/** The results of the runs: the row `results`, else the value under each
 * route key in route order (the shape of the OD6 hand-off). */
function rowResults(row: Record<string, any>, routeKeys: string[]): string[] {
  if (Array.isArray(row.results)) return row.results.map((value: unknown) => String(value));
  return routeKeys.map((key) => String(row[key] ?? ""));
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

  const rows: unknown[] = Array.isArray(doc.errors) ? doc.errors : [];
  if (rows.length !== ROW_COUNT) refuse("errors");
  if (!rows.every((row) => isObject(row))) refuse("errors");

  const routeKeys = isObject(doc.routes) ? Object.keys(doc.routes) : [];
  if (routeKeys.length === 0) refuse("keys");
  const summary = isObject(doc.summary) ? doc.summary : {};

  const routes: Record<string, string> = {};
  for (const key of routeKeys) {
    const value = doc.routes[key];
    let name = key;
    let resolved: unknown;
    let total: unknown;
    if (typeof value === "string") {
      name = value;
      const entry = isObject(summary[key]) ? summary[key] : {};
      resolved = entry.blockers_found;
      total = isObject(summary.key) ? summary.key.blockers : undefined;
    } else if (isObject(value)) {
      resolved = value.blockers_resolved;
      total = value.blockers_total;
    }
    if (!Number.isSafeInteger(resolved) || !Number.isSafeInteger(total)) refuse("keys");
    routes[name] = `${resolved} of ${total}`;
  }

  const types = new Map<string, number>();
  const errors = (rows as Array<Record<string, any>>).map((row) => {
    const type = rowType(row);
    types.set(type, (types.get(type) ?? 0) + 1);
    return {
      id: String(row.id ?? ""),
      severity: String(row.severity ?? ""),
      type,
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
