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
    ["records are kept", "Return to the last good release. Loan records are kept and preserved: nothing is deleted."],
    ["no data migration to undo", "Re-activate the previous release artifact; loan records are preserved and there is no data migration to undo."],
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

describe("review-a r5 F10: contradictory rollback instructions fail", () => {
  it.each([
    ["negated restoration", "Do not return to the previous release. Keep the existing data store and loan records."],
    ["new release instead", "Deploy the new release. The previous release is obsolete. Keep the existing data store and loan records."],
    ["unrelated release noun", "Restore the previous settings. A release has a build number. Keep loan records."],
    ["contradictory releases", "Deploy the previous release. Then deploy the new release instead and abandon the old artifact. Keep the existing data store and loan records."],
  ])("F10 contradiction: %s fails D.sections.rollback", async (_label, body) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection("Rollback", body));
    expect(grade.passed, `F10: a contradictory rollback passes`).toBe(false);
    expect(grade.failed, `F10: the contradiction fails D.sections.rollback`).toContain("D.sections.rollback");
  });
});

describe("review-a r5 F11: contradictory preservation instructions fail", () => {
  it.each([
    ["explicit deletion", "Deploy the previous release. Keep the server port unchanged. Delete the loan records."],
    ["unrelated port keep", "Deploy the previous release. Keep the server port unchanged. The data store contains loan records."],
    ["explicit truncation", "Restore the previous release. Truncate the loan records table before serving traffic."],
    ["explicit reset", "Roll back to the previous deployment. Reset the loan records to the empty seed."],
  ])("F11 contradiction: %s fails D.sections.rollback", async (_label, body) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection("Rollback", body));
    expect(grade.passed, `F11: a contradictory preservation passes`).toBe(false);
    expect(grade.failed, `F11: the contradiction fails D.sections.rollback`).toContain("D.sections.rollback");
  });
});

describe("review-a r6 F13: the contract rollback sentence keeps its check", () => {
  it.each([
    ["contract sentence", "Rollback restores the previous release and does not delete loan records."],
    ["contract sentence with never", "Rollback restores the previous release and never deletes loan records."],
    ["restore joined with and", "Restore the previous release and do not delete loan records."],
  ])("F13 restoration: %s keeps D.sections.rollback", async (_label, body) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection("Rollback", body));
    expect(grade.failed, `F13: the contract rollback wording fails (${grade.failed.join(", ")})`)
      .not.toContain("D.sections.rollback");
  });

  it.each([
    ["current release kept", "Keep the current release and do not delete loan records."],
    ["restoration denied", "Rollback does not restore the previous release and does not delete loan records."],
    ["bare denial", "Do not restore the previous release."],
    ["restore by deleting", "Restore the previous release by deleting the loan records."],
    ["new release deployed", "Deploy the new release and do not delete loan records."],
  ])("F13 guard: %s still fails D.sections.rollback", async (_label, body) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection("Rollback", body));
    expect(grade.passed, `F13: the guarded inversion passes`).toBe(false);
    expect(grade.failed, `F13: the guarded inversion names its check`).toContain("D.sections.rollback");
  });
});

describe("review-a 1.2b r1 F1-F3", () => {
  it.each([
    {
      label: "F1 negated restoration with modifiers",
      body: "Do not, under any circumstance, restore the previous release. Keep the loan records.",
      failed: ["D.sections.rollback"],
    },
    {
      label: "F1 shared negation across coordinated verbs",
      body: "Do not roll back and restore the previous release. Keep the loan records.",
      failed: ["D.sections.rollback"],
    },
    {
      label: "F1 shared negation across a comma",
      body: "Do not restore, or redeploy the previous release. Keep the loan records.",
      failed: ["D.sections.rollback"],
    },
    {
      label: "F2 release object keeps its comma",
      body: "Restore the previous, known-good release. Keep the loan records.",
      failed: [],
    },
    {
      label: "F3 unrelated negated destruction does not preserve loans",
      body: "Restore the previous release and do not drop the logs, but delete loan records.",
      failed: ["D.sections.rollback"],
    },
    {
      label: "control contract sentence",
      body: "Rollback restores the previous release and does not delete loan records.",
      failed: [],
    },
    {
      label: "control never deletes loan records",
      body: "Rollback restores the previous release and never deletes loan records.",
      failed: [],
    },
    {
      label: "control do not delete loan records",
      body: "Restore the previous release and do not delete loan records.",
      failed: [],
    },
    {
      label: "control separate no-deletion sentence",
      body: "Restore the previous release. No, do not delete loan records.",
      failed: [],
    },
    {
      label: "control do not reset the loan records",
      body: "Restore the previous release and do not reset the loan records.",
      failed: [],
    },
    {
      label: "control do not wipe loan records",
      body: "Restore the previous release and do not wipe loan records.",
      failed: [],
    },
  ])("$label", async ({ body, failed }) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection("Rollback", body));
    expect(grade.failed).toEqual(failed);
  });
});

describe("review-a r5: the review mutations that already behave stay pinned", () => {
  it.each([
    ["restoration sentence without any release object", "Rollback", "Restore everything quickly. Keep the existing data store and loan records.\n", "D.sections.rollback"],
    ["deletion-only control without an unrelated keep sentence", "Rollback", "Deploy the previous release. Delete the loan records.\n", "D.sections.rollback"],
    ["direct negation of the returned-state rule", "Loan state", "A returned loan does not stay returned after its due date. Overdue is strictly before now. Due-soon from now through 48 hours.\n", "D.loan.boundary"],
  ])("r5 guard: %s still fails %s", async (_label, section, body, id) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection(section, body));
    expect(grade.passed, `r5: the guarded mutation passes`).toBe(false);
    expect(grade.failed, `r5: the guarded mutation names its check`).toContain(id);
  });
});

describe("review-a r5 F12: contradictory loan boundaries fail", () => {
  it.each([
    ["returned classified as overdue", "A returned loan is overdue strictly before now. Due-soon runs from now through 48 hours."],
    ["24-hour due-soon window", "A returned loan stays returned after its due date. Overdue is strictly before now. Due-soon runs from now through the next 24 hours."],
    ["denied returned-state rule", "It is false that a returned loan stays returned after its due date. Overdue is strictly before now. Due-soon runs from now through 48 hours."],
    ["negated returned-state rule", "A returned loan does not stay returned after its due date. Overdue is strictly before now. Due-soon runs from now through 48 hours."],
    ["wrong comparison", "A returned loan stays returned after its due date. Overdue is strictly after now. Due-soon runs from now through 48 hours."],
    ["status comparison split apart", "A returned loan stays returned after its due date. The comparison is strictly before now. Due-soon mentions 48 hours elsewhere."],
    ["24-hour due-soon with 48 elsewhere", "A returned loan stays returned after its due date. Overdue is strictly before now. Due-soon runs from now through the next 24 hours. Later than 48 hours is ok."],
    ["overdue classification beside the true rule", "A returned loan stays returned after its due date. A returned loan is overdue strictly before now. Due-soon from now through 48 hours."],
  ])("F12 contradiction: %s fails D.loan.boundary", async (_label, body) => {
    const mod = await grader();
    const grade = mod.gradeRunbook(oracleWithSection("Loan state", body));
    expect(grade.passed, `F12: a contradictory boundary passes`).toBe(false);
    expect(grade.failed, `F12: the contradiction fails D.loan.boundary`).toContain("D.loan.boundary");
  });
});
