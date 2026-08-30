/** Deterministic source mutations for calibration runs. Apply to a temporary candidate only. */
export type SourceReplacement = {
  from: string;
  to: string;
};

export type NegativeControl = {
  id: string;
  target: string;
  from: string;
  to: string;
  replacements?: readonly SourceReplacement[];
  allowedCollateral?: readonly string[];
  expectedFailures: readonly string[];
};

/**
 * Fixture for the mutation engine, not a second control suite.
 *
 * applyNegativeControl below is the engine every sensitivity control runs through
 * (verify-controls.ts:268). This array exercises it in tests/meta/negative-controls.test.ts.
 * Three of its four entries duplicate a live control in sensitivity-controls.ts on
 * purpose: a mutation that the live suite already depends on is the right regression
 * fixture. Do not read this list as calibration evidence — it grades no candidate.
 */
export const NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "catalogue-cap",
    target: "app/items/page.tsx",
    from: "const filtered = items.filter(",
    to: "const filtered = items.slice(0, 12).filter(",
    expectedFailures: ["C.renders-all"],
  },
  {
    id: "literal-regex",
    target: "app/items/page.tsx",
    from: "i.name.toLowerCase().includes(needle)",
    to: "new RegExp(needle, \"i\").test(i.name)",
    expectedFailures: ["P.filter-literal"],
  },
  {
    id: "detail-dedup",
    target: "app/items/[id]/page.tsx",
    from: "const loadItem = cache(getItem);",
    to: "const loadItem = getItem;",
    expectedFailures: ["P.dedup-item"],
  },
  {
    id: "staff-key-leak",
    target: "app/items/[id]/checkout-form.tsx",
    from: "<form action={formAction} className=\"space-y-3 rounded-lg border border-neutral-200 p-4\">",
    to: "<p>staff-key-7f3a</p><form action={formAction} className=\"space-y-3 rounded-lg border border-neutral-200 p-4\">",
    expectedFailures: ["P.no-key-leak"],
  },
];

export function applyNegativeControl(source: string, control: NegativeControl): string {
  const replacements = control.replacements ?? [{ from: control.from, to: control.to }];
  if (replacements.length === 0) {
    throw new Error(`${control.id} must declare at least one source replacement`);
  }

  const anchors = new Set<string>();
  for (const replacement of replacements) {
    const first = source.indexOf(replacement.from);
    if (
      replacement.from === replacement.to ||
      first < 0 ||
      first !== source.lastIndexOf(replacement.from) ||
      anchors.has(replacement.from)
    ) {
      throw new Error(`${control.id} requires distinct, exactly-once, non-noop anchors in ${control.target}`);
    }
    anchors.add(replacement.from);
  }

  let mutated = source;
  for (const replacement of replacements) {
    mutated = mutated.replace(replacement.from, replacement.to);
  }
  return mutated;
}
