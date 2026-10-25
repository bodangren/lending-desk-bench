/**
 * Mutants for the lending_desk_tests track (tests_bench FR-1).
 *
 * A mutant is the clean app with one anchored source change. Its definition
 * comes from the bug registry, from a sensitivity control, or from the short
 * local list below (defects no other registry holds). Every mutant in a set must
 * be observable over HTTP or by importing src/lib/loans.ts, because candidate
 * tests have no browser. verify-mutants.ts proves that with the oracle suite.
 */
import { createHash } from "node:crypto";
import { BUG_REGISTRY, type BugClass } from "../bugfix/registry.js";
import { SENSITIVITY_CONTROLS } from "../tests/sensitivity-controls.js";
import type { SourceReplacement } from "../tests/negative-controls.js";

export type MutantDefinition = {
  id: string;
  class: BugClass;
  source: "bug" | "control" | "local";
  target: string;
  replacements: readonly SourceReplacement[];
};

/** Tests-track defects that neither the bug registry nor the controls hold. */
const LOCAL_MUTANTS: readonly (Omit<MutantDefinition, "source">)[] = [
  {
    id: "MUT-sec-post-unguarded",
    class: "security",
    target: "app/api/loans/route.ts",
    replacements: [{
      from: "export async function POST(request: Request) {\n  if (!(await getStaffSession())) return unauthorized();\n",
      to: "export async function POST(request: Request) {\n",
    }],
  },
];

export function resolveMutant(id: string, declaredClass?: BugClass): MutantDefinition {
  const bug = BUG_REGISTRY.find((entry) => entry.id === id);
  if (bug) {
    return {
      id,
      class: bug.class,
      source: "bug",
      target: bug.target,
      replacements: bug.replacements ?? [{ from: bug.from, to: bug.to }],
    };
  }
  const local = LOCAL_MUTANTS.find((entry) => entry.id === id);
  if (local) return { ...local, source: "local" };
  const control = SENSITIVITY_CONTROLS.find((entry) => entry.id === id);
  if (control) {
    if (!declaredClass) throw new Error(`mutant ${id} is a control and needs a class in the set`);
    return {
      id,
      class: declaredClass,
      source: "control",
      target: control.target,
      replacements: control.replacements ?? [{ from: control.from, to: control.to }],
    };
  }
  throw new Error(`unknown mutant id: ${id}`);
}

/** Stable hash over the resolved definitions, independent of source formatting. */
export function mutantDefinitionsHash(mutants: readonly MutantDefinition[]): string {
  const rows = mutants
    .map((mutant) => JSON.stringify({
      id: mutant.id, class: mutant.class, source: mutant.source,
      target: mutant.target, replacements: mutant.replacements,
    }))
    .sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}
