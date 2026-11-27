/**
 * Review for phase acceptance F-PA1 Red tests: the grader must recognise
 * documented FACTS, not oracle phrases.
 *
 * F-PA1: grade-docs-ops.ts requires phrases copied from the oracle runbook
 * instead of the facts in model-visible/track/spec.md:32-36. All four real
 * candidate runbooks state release restoration and loan record preservation
 * but lose D.sections.rollback; both Hy4 runbooks describe the returned,
 * overdue, and due-soon boundaries but lose D.loan.boundary through
 * Markdown emphasis or code formatting.
 *
 * Positive cases: runbook sections that state the spec facts in the real
 * candidates' own words (fixtures copied from the four local runs) keep
 * D.sections.rollback and D.loan.boundary.
 * Negative cases: empty bodies, missing instructions, and missing facts
 * still fail their exact IDs (a recogniser that accepts everything is
 * wrong). All fail on the current code, which matches oracle phrases.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "../..");
const FIXTURES = join(import.meta.dirname, "fixtures");
const ORACLE_RUNBOOK = join(HARNESS, "docs-and-ops", "oracle-overlay", "docs", "runbook.md");

async function grader(): Promise<{
  gradeRunbook: (text: string) => { passed: boolean; failed: string[]; reasons: string[] };
  declaredCheckIds: () => string[];
}> {
  return import("../../docs-and-ops/grade-docs-ops.js");
}

/** The named section body of a fixture file. */
function sectionBody(file: string, name: string): string {
  const text = readFileSync(join(FIXTURES, file), "utf8");
  const marker = `## ${name}\n`;
  const start = text.indexOf(marker);
  expect(start, `${file} holds a ${name} section`).toBeGreaterThanOrEqual(0);
  return text.slice(start + marker.length).trim();
}

/** The oracle runbook with one section body replaced by a fixture section. */
function oracleWithSection(name: string, body: string): string {
  const oracle = readFileSync(ORACLE_RUNBOOK, "utf8");
  const marker = `## ${name}\n`;
  const start = oracle.indexOf(marker);
  expect(start, `the oracle runbook has a ${name} section`).toBeGreaterThanOrEqual(0);
  const bodyStart = start + marker.length;
  const next = oracle.indexOf("\n## ", bodyStart);
  const end = next === -1 ? oracle.length : next + 1;
  return `${oracle.slice(0, bodyStart)}\n${body}\n${oracle.slice(end)}`;
}

describe("acceptance F-PA1: the grader recognises documented facts", () => {
  it.each([
    ["hy4 arm A wording", "docs-ops-rollback-hy4-a.md"],
    ["hy4 arm B wording", "docs-ops-rollback-hy4-b.md"],
    ["spark arm A wording", "docs-ops-rollback-spark-a.md"],
    ["spark arm B wording", "docs-ops-rollback-spark-b.md"],
  ])("F-PA1 rollback: %s keeps D.sections.rollback", async (_label, file) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection("Rollback", sectionBody(file, "Rollback")));
    expect(grade.failed, `F-PA1: valid rollback wording fails (${grade.failed.join(", ")})`)
      .not.toContain("D.sections.rollback");
  });

  it.each([
    ["restore the prior release tag", "Redeploy the prior release tag and keep every stored loan row."],
    ["roll back to the previous deployment", "Roll back to the previous deployment; stored loan data stays untouched."],
    ["records are kept", "Return to the last good release. Loan records are kept: nothing is deleted."],
    ["no data migration to undo", "Re-activate the previous release artifact; there is no data migration to undo."],
  ])("F-PA1 rollback: %s keeps D.sections.rollback", async (_label, body) => {
    const mod = await grader();
    const mutated = oracleWithSection("Rollback", body);
    expect(mutated, "F-PA1: the fixture body replaces the section").toContain(body);
    expect(mod.gradeRunbook(mutated).failed, `F-PA1: valid rollback wording fails`).not.toContain(
      "D.sections.rollback",
    );
  });

  it.each([
    ["hy4 arm A wording", "docs-ops-loanstate-hy4-a.md"],
    ["hy4 arm B wording", "docs-ops-loanstate-hy4-b.md"],
    ["spark arm A wording", "docs-ops-loanstate-spark-a.md"],
    ["spark arm B wording", "docs-ops-loanstate-spark-b.md"],
  ])("F-PA1 loan boundaries: %s keeps D.loan.boundary", async (_label, file) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection("Loan state", sectionBody(file, "Loan state")));
    expect(grade.failed, `F-PA1: valid boundary wording fails (${grade.failed.join(", ")})`)
      .not.toContain("D.loan.boundary");
  });

  it.each([
    ["bold boundaries in a table", "| status | rule |\n| `**returned**` | a **returned loan stays returned** after its due date |\n| `overdue` | strictly before `now()` |\n| `due-soon` | from `now()` through `48` hours |"],
    ["italic boundaries in bullets", "- *returned*: a returned loan stays returned\n- *overdue*: strictly before now\n- *due-soon*: from now through 48 hours"],
    ["code-formatted boundaries", "A `returned loan stays returned`. `strictly before` `now()`. `due-soon` from `now()` through `48` hours."],
  ])("F-PA1 loan boundaries: %s keeps D.loan.boundary", async (_label, body) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection("Loan state", body));
    expect(grade.failed, `F-PA1: formatted boundary wording fails (${grade.failed.join(", ")})`)
      .not.toContain("D.loan.boundary");
  });
});

describe("acceptance F-PA1: omissions still fail their exact checks", () => {
  it.each([
    ["empty Rollback body", "Rollback", "\n", "D.sections.rollback"],
    ["missing restoration alone", "Rollback", "Keep the existing data store and loan records.\n", "D.sections.rollback"],
    ["missing preservation alone", "Rollback", "Deploy the previous release.\n", "D.sections.rollback"],
    ["empty Loan state body", "Loan state", "\n", "D.loan.boundary"],
    ["missing statuses alone", "Loan state", "A returned loan stays returned. Strictly before now.\n", "D.loan.statuses"],
  ])("F-PA1 omission: %s fails %s", async (_label, section, body, id) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection(section, body));
    expect(grade.passed, `F-PA1: the omission passes`).toBe(false);
    expect(grade.failed, `F-PA1: the omission names its check`).toContain(id);
    for (const failed of grade.failed) {
      expect(mod.declaredCheckIds(), `F-PA1: failure ${failed} is a declared check`).toContain(failed);
    }
  });
});
