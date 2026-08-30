/**
 * Axis 3 — code quality via react-doctor.
 *
 * Pinned to 0.9.2. Scored as a weighted penalty for diagnostics ABOVE the reference
 * baseline, not as the raw 0-100 health score (an empty repo scores ~100, so the raw
 * score rewards writing nothing). Category weights follow the same blast-radius
 * ordering as the tiers: security and correctness outrank tidiness.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const DOCTOR_VERSION = "0.9.2";
const LOCAL_DOCTOR = resolve(import.meta.dirname, "node_modules/.bin/react-doctor");

const SEVERITY_WEIGHT: Record<string, number> = { error: 3, warning: 1, info: 0 };
const CATEGORY_WEIGHT: Record<string, number> = {
  Security: 2.0,
  Bugs: 1.5,
  Performance: 1.0,
  Accessibility: 1.0,
  Maintainability: 0.5,
};
/** Penalty at which quality scores zero. */
export const PENALTY_FULL = 30;

export type Diagnostic = {
  rule: string; severity: string; category: string; filePath: string; line?: number;
};

/**
 * react-doctor's ESLint file discovery skips git-ignored paths (it shells out to
 * `git check-ignore` against the enclosing repo). Graded candidates live in
 * runs/<id>/candidate, and the benchmark repo ignores `runs/`, so an in-place
 * scan lints nothing and returns zero diagnostics in ~0.5s. Copying the
 * candidate source to a fresh temp dir (outside every repo) makes the source
 * visible again; node_modules is symlinked so resolution still works.
 */
function prepareScanDir(candidate: string): { dir: string; cleanup: () => void } {
  const scan = mkdtempSync(join(tmpdir(), "rd-scan-"));
  // Copy only the source tree. node_modules and .next are large; symlink the
  // former and skip the latter (no build output is needed for static analysis).
  cpSync(candidate, scan, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(candidate.length);
      if (rel === "" ) return true;
      return !/(^|\/)node_modules(\/|$)/.test(rel) && !/(^|\/)\.next(\/|$)/.test(rel);
    },
  });
  const nm = join(candidate, "node_modules");
  if (existsSync(nm)) symlinkSync(nm, join(scan, "node_modules"), "dir");
  return { dir: scan, cleanup: () => rmSync(scan, { recursive: true, force: true }) };
}
export type DoctorReport = {
  ok: boolean;
  errors: number;
  warnings: number;
  byCategory: Record<string, number>;
  byRule: Record<string, number>;
  diagnostics: Diagnostic[];
  raw?: unknown;
};

export function runDoctor(dir: string, rawOut?: string): DoctorReport {
  const empty: DoctorReport = {
    ok: false, errors: 0, warnings: 0, byCategory: {}, byRule: {}, diagnostics: [],
  };
  // Scan a relocated copy: an in-place scan under the git-ignored runs/ tree
  // returns zero diagnostics because the analyzer's file discovery honors .gitignore.
  const { dir: scanDir, cleanup } = prepareScanDir(dir);
  let stdout: string;
  try {
    stdout = execFileSync(
      LOCAL_DOCTOR,
      ["--json", "--no-supply-chain", "--no-dead-code", "--no-score", "--scope", "full"],
      { cwd: scanDir, stdio: ["ignore", "pipe", "pipe"], timeout: 900_000,
        maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: "1", DO_NOT_TRACK: "1", NO_TELEMETRY: "1", REACT_DOCTOR_PARALLEL: "2", REACT_DOCTOR_TELEMETRY: "0", npm_config_offline: "true" } },
    ).toString();
  } catch (e: any) {
    // A non-zero exit still emits a usable report when --blocking trips.
    stdout = (e.stdout ?? "").toString();
    cleanup();
    if (!stdout.trim()) return empty;
  }

  const start = stdout.indexOf("{");
  if (start < 0) { cleanup(); return empty; }
  let j: any;
  try { j = JSON.parse(stdout.slice(start)); } catch { cleanup(); return empty; }
  cleanup();
  if (rawOut) writeFileSync(rawOut, JSON.stringify(j, null, 2));

  const diagnostics: Diagnostic[] = (j.diagnostics ?? []).map((d: any) => ({
    rule: d.rule, severity: d.severity, category: d.category,
    filePath: d.normalizedFilePath ?? d.filePath, line: d.line,
  }));

  const byCategory: Record<string, number> = {};
  const byRule: Record<string, number> = {};
  for (const d of diagnostics) {
    byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
    byRule[d.rule] = (byRule[d.rule] ?? 0) + 1;
  }

  return {
    ok: true,
    // Count the merged list. react-doctor reports a summary of 0 for every candidate,
    // so trusting its counters would hide every source signal added above.
    errors: diagnostics.filter((d) => d.severity === "error").length,
    warnings: diagnostics.filter((d) => d.severity === "warning").length,
    byCategory, byRule, diagnostics,
  };
}

/** Weighted penalty for diagnostics the candidate added over the reference baseline. */
export function penaltyOver(candidate: DoctorReport, baseline: DoctorReport): number {
  const base = { ...baseline.byRule };
  let penalty = 0;
  for (const d of candidate.diagnostics) {
    if (base[d.rule] > 0) { base[d.rule] -= 1; continue; } // already present in the reference
    penalty +=
      (SEVERITY_WEIGHT[d.severity] ?? 1) * (CATEGORY_WEIGHT[d.category] ?? 1);
  }
  return penalty;
}

export function loadBaseline(path: string): DoctorReport {
  if (!existsSync(path)) {
    return { ok: false, errors: 0, warnings: 0, byCategory: {}, byRule: {}, diagnostics: [] };
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

if (process.argv[1]?.endsWith("doctor.ts")) {
  const dir = process.argv[2] ?? ".";
  const out = process.argv[3];
  const r = runDoctor(dir);
  if (out) writeFileSync(out, JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ ...r, diagnostics: r.diagnostics.length }, null, 2));
}
