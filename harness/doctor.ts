/**
 * Axis 3 — code quality via react-doctor.
 *
 * Pinned to 0.9.2. Scored as a weighted penalty for diagnostics ABOVE the reference
 * baseline, not as the raw 0-100 health score (an empty repo scores ~100, so the raw
 * score rewards writing nothing). Category weights follow the same blast-radius
 * ordering as the tiers: security and correctness outrank tidiness.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
  let stdout: string;
  try {
    stdout = execFileSync(
      LOCAL_DOCTOR,
      ["--json", "--no-supply-chain", "--no-dead-code", "--no-score", "--scope", "full"],
      { cwd: dir, stdio: ["ignore", "pipe", "pipe"], timeout: 900_000,
        maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: "1", DO_NOT_TRACK: "1", NO_TELEMETRY: "1", REACT_DOCTOR_PARALLEL: "2", REACT_DOCTOR_TELEMETRY: "0", npm_config_offline: "true" } },
    ).toString();
  } catch (e: any) {
    // A non-zero exit still emits a usable report when --blocking trips.
    stdout = (e.stdout ?? "").toString();
    if (!stdout.trim()) return empty;
  }

  const start = stdout.indexOf("{");
  if (start < 0) return empty;
  let j: any;
  try { j = JSON.parse(stdout.slice(start)); } catch { return empty; }
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
    errors: j.summary?.errorCount ?? diagnostics.filter((d) => d.severity === "error").length,
    warnings: j.summary?.warningCount ?? diagnostics.filter((d) => d.severity === "warning").length,
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
