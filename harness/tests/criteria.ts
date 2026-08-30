/** Every scored criterion, with its tier. Test ids must match exactly. */
export type Tier = 0 | 1 | 2;

// F has an executable UI surface for both actions. Authentication must be tested
// after the browser has received a real action token, then with its cookie removed:
// hiding an unauthenticated control is not authorization inside the action.
export const CRITERIA: Record<string, { tier: Tier; spec: string }> = {
  // ---- Tier 0: silent security holes, absent features, silent wrong state ----
  "A.returned":        { tier: 0, spec: "A" },
  "A.overdue":         { tier: 0, spec: "A" },
  "A.due-soon":        { tier: 0, spec: "A" },
  "A.ok":              { tier: 0, spec: "A" },
  "A.boundary":        { tier: 0, spec: "A" },
  "C.renders":         { tier: 0, spec: "C" },
  "C.renders-all":     { tier: 0, spec: "C" },
  "D.renders":         { tier: 0, spec: "D" },
  "F.auth-checkout":   { tier: 0, spec: "F" },
  "F.auth-return":     { tier: 0, spec: "F" },
  "F.checkout-record": { tier: 0, spec: "F" },
  "F.return-record":   { tier: 0, spec: "F" },
  "G.get200":          { tier: 0, spec: "G" },
  "G.401":             { tier: 0, spec: "G" },

  // ---- Tier 1: broken contracts, wrong answers ----
  "B.name-category":   { tier: 1, spec: "B" },
  "B.badge":           { tier: 1, spec: "B" },
  "B.link":            { tier: 1, spec: "B" },
  "B.image-alt":       { tier: 1, spec: "B" },
  "B.image-response":  { tier: 1, spec: "B" },
  "C.filter-q":        { tier: 1, spec: "C" },
  "C.filter-case":     { tier: 1, spec: "C" },
  "C.filter-category": { tier: 1, spec: "C" },
  "C.filter-both":     { tier: 1, spec: "C" },
  "C.empty":           { tier: 1, spec: "C" },
  "D.history-order":   { tier: 1, spec: "D" },
  "D.history-status":  { tier: 1, spec: "D" },
  "D.notfound":        { tier: 1, spec: "D" },
  "D.form-hidden":     { tier: 1, spec: "D" },
  "D.return-visible":  { tier: 1, spec: "D" },
  "E.submits":         { tier: 1, spec: "E" },
  "E.error-shown":     { tier: 1, spec: "E" },
  "E.member-options":  { tier: 1, spec: "E" },
  "E.return-submits":  { tier: 1, spec: "E" },
  "E.return-error":    { tier: 1, spec: "E" },
  "F.checkout-conflict": { tier: 1, spec: "F" },
  "F.return-not-on-loan": { tier: 1, spec: "F" },
  "F.future-due-date": { tier: 1, spec: "F" },
  "F.post-mutation-state": { tier: 1, spec: "F" },
  // Full checkout→return→catalogue path. Compound of record + post-mutation;
  // kept out of Tier 0 so one broken form path cannot double-lock the suite.
  "F.lifecycle":       { tier: 1, spec: "F" },
  "G.filter-item":     { tier: 1, spec: "G" },
  "G.filter-overdue":  { tier: 1, spec: "G" },
  "G.filter-both":     { tier: 1, spec: "G" },
  "G.post201":         { tier: 1, spec: "G" },
  "G.post-fields":     { tier: 1, spec: "G" },
  "G.400":             { tier: 1, spec: "G" },
  "G.409":             { tier: 1, spec: "G" },
  "G.fresh":           { tier: 1, spec: "G" },
  "G.patch200":        { tier: 1, spec: "G" },
  "G.patch409":        { tier: 1, spec: "G" },
  "G.patch400":        { tier: 1, spec: "G" },

  // ---- Tier 2: degradation and polish ----
  "D.metadata":        { tier: 2, spec: "D" },
  "E.pending":         { tier: 2, spec: "E" },
  "E.optimistic":      { tier: 2, spec: "E" },
  "E.return-pending":  { tier: 2, spec: "E" },
  "E.return-optimistic": { tier: 2, spec: "E" },
  "C.parallel-reads":  { tier: 2, spec: "C" },
  "H.loading":         { tier: 2, spec: "H" },
  "H.error":           { tier: 2, spec: "H" },
  "M.plan-complete":   { tier: 2, spec: "AGENTS.md" },
  "M.metadata-valid":  { tier: 2, spec: "metadata.json" },
  "M.closeout":        { tier: 2, spec: "AGENTS.md" },
};

/**
 * Adversarial probes. Not derived from spec.md — never shown to the test writer.
 * NOTE: "error.tsx must be a client component" was removed — Next's build enforces it,
 * so the gate already subsumes it and it discriminated nothing.
 */
export const PROBES: Record<string, { tier: Tier; catches: string }> = {
  "P.searchparams-async": { tier: 1, catches: "searchParams not awaited" },
  "P.no-key-leak":        { tier: 0, catches: "staff credential serialized to the client" },
  "P.stale-after-mutate": { tier: 1, catches: "missing revalidation" },
  "P.concurrent-checkout":{ tier: 1, catches: "check-then-write, losing write unhandled" },
  "P.concurrent-return":  { tier: 1, catches: "double return; the losing close unhandled" },
  "P.hydration-clean":    { tier: 1, catches: "nondeterministic render" },
  "P.filter-literal":     { tier: 1, catches: "search text compiled as a pattern" },
  "P.validate-before-io": { tier: 2, catches: "store reads before validating the request" },
  "P.n-plus-one":         { tier: 2, catches: "per-row query inside the list render" },
  "P.dedup-item":         { tier: 2, catches: "same record read twice in one request" },
  "P.streams-shell":      { tier: 2, catches: "no Suspense split around the slow region" },
};

/** Advisory only — never folded into the weighted total. */
export const ADVISORY = ["ADV.useActionState", "ADV.useOptimistic"];
