export const REQUIRED_PRIMARY_ROWS = [
  { id: "C.7", primary: "C.parallel-reads", testFile: "e2e/catalogue.spec.ts" },
  { id: "F.1", primary: "F.checkout-record", testFile: "e2e/detail.spec.ts" },
  { id: "F.2", primary: "F.return-record", testFile: "e2e/detail.spec.ts" },
  { id: "F.5", primary: "F.future-due-date", testFile: "e2e/detail.spec.ts" },
  { id: "F.7", primary: "F.post-mutation-state", testFile: "e2e/detail.spec.ts" },
] as const;

export const REQUIRED_PRIMARY_COLLATERAL: Readonly<Record<string, readonly string[]>> = {
  "F.checkout-record": ["F.lifecycle"],
  "F.return-record": ["F.lifecycle"],
  "F.future-due-date": ["E.error-shown"],
  "F.post-mutation-state": ["P.stale-after-mutate"],
};

/**
 * Criteria that carry no SPEC_MATRIX row.
 *
 * SCORING.md permits a criterion that splits a compound checkbox into independently
 * observable behavior, and a criterion that validates Measure closeout integrity.
 * It permits nothing else. Every entry here must name the checkbox it derives from,
 * so that M.criteria-provenance can prove the criterion has a contract basis.
 *
 * This list is the reverse direction of M.matrix-primary-ownership, which only ever
 * checked that a matrix primary exists in CRITERIA. The missing reverse check is why
 * C.summary survived: it graded one sentence of reference/app/items/page.tsx that no
 * checkbox states, and every model failed it.
 */
export const UNMAPPED_CRITERIA: Readonly<Record<string, string>> = {
  "B.image-response": "B.4 — split: the alt text is B.image-alt, the response is this",
  "C.filter-case": "C.3 — split: case-insensitive matching of the same q filter",
  "D.history-status": "D.2 — split: the order is D.history-order, the status is this",
  "F.auth-return": "F.3 — split: checkout auth is F.auth-checkout, return auth is this",
  "F.lifecycle": "F.1 and F.2 — split: the two records combined over one item",
  "G.post-fields": "G.5 — split: the status is G.post201, the record shape is this",
  "M.closeout": "AGENTS.md — Measure closeout integrity",
  "M.metadata-valid": "AGENTS.md — Measure closeout integrity",
  "M.plan-complete": "AGENTS.md — Measure closeout integrity",
};
