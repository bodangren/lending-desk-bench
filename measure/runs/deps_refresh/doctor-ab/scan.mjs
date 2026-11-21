import fs from "node:fs";
import { pathToFileURL } from "node:url";
const [root, out, side] = process.argv.slice(2);
const { runDoctor, loadBaseline, penaltyOver, PENALTY_FULL, DOCTOR_VERSION } =
  await import(pathToFileURL(`${root}/harness/doctor.ts`).href);
const candidate = `${root}/runs/a-deepseek-v4-1-flash-2026w43-r1/candidate`;
const report = runDoctor(candidate, `${out}/${side}-raw.json`, "build");
const baseline = loadBaseline(`${root}/reference/doctor.json`);
const penalty = penaltyOver(report, baseline);
const scored = {
  version: DOCTOR_VERSION,
  ran: report.ok,
  errors: report.errors,
  warnings: report.warnings,
  by_category: report.byCategory,
  penalty_over_reference: Math.round(penalty * 100) / 100,
  penalty_full: PENALTY_FULL,
  reference_errors: baseline.errors,
  reference_warnings: baseline.warnings,
  quality_at_full_completion: report.ok ? Math.max(0, 1 - penalty / PENALTY_FULL) : 0,
};
fs.writeFileSync(`${out}/${side}-report.json`, JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(`${out}/${side}-scored.json`, JSON.stringify(scored, null, 2) + "\n");
console.log(JSON.stringify({ side, ...scored }, null, 2));
if (!report.ok || !baseline.ok) process.exitCode = 1;
