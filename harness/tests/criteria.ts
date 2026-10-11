/** Every scored criterion, with its tier. Test ids must match exactly. */
export type Tier = 0 | 1 | 2;

/**
 * Weight of a criterion that every competent model passes. On 29 real r1 runs, 21
 * of 71 checks passed 28 or more times: they separate a broken submission from a
 * working one, which the tier gate already does, but not one working model from
 * another. They keep a quarter of a normal criterion's weight inside completion.
 * Tier rates stay count-based, so the soft tier gate is unchanged.
 */
export const SATURATED_WEIGHT = 0.25;

export type Criterion = {
  tier: Tier;
  spec: string;
  /** Share of a normal criterion inside its axis. Default 1. */
  weight?: number;
  /**
   * "adherence": the criterion grades process instructions (Measure closeout),
   * not the product. It feeds the adherence axis and leaves completion.
   */
  axis?: "adherence";
  /**
   * Fixture revision whose spec first states this criterion (default 1). A record
   * made under an older revision is not scored on it: its agent never saw it.
   */
  since?: number;
};

export const criterionWeight = (criterion: Criterion): number => criterion.weight ?? 1;

// F has an executable UI surface for both actions. Authentication must be tested
// after the browser has received a real action token, then with its cookie removed:
// hiding an unauthenticated control is not authorization inside the action.
export const CRITERIA: Record<string, Criterion> = {
  // ---- Tier 0: silent security holes, absent features, silent wrong state ----
  "A.returned":        { tier: 0, spec: "A", weight: SATURATED_WEIGHT },
  "A.overdue":         { tier: 0, spec: "A", weight: SATURATED_WEIGHT },
  "A.due-soon":        { tier: 0, spec: "A", weight: SATURATED_WEIGHT },
  "A.ok":              { tier: 0, spec: "A", weight: SATURATED_WEIGHT },
  "A.boundary":        { tier: 0, spec: "A", weight: SATURATED_WEIGHT },
  "C.renders":         { tier: 0, spec: "C", weight: SATURATED_WEIGHT },
  "C.renders-all":     { tier: 0, spec: "C", weight: SATURATED_WEIGHT },
  "D.renders":         { tier: 0, spec: "D" },
  "F.auth-checkout":   { tier: 0, spec: "F" },
  "F.auth-return":     { tier: 0, spec: "F" },
  "F.checkout-record": { tier: 0, spec: "F" },
  "F.return-record":   { tier: 0, spec: "F" },
  "G.get200":          { tier: 0, spec: "G" },
  "G.401":             { tier: 0, spec: "G" },

  // ---- Tier 1: broken contracts, wrong answers ----
  "B.name-category":   { tier: 1, spec: "B", weight: SATURATED_WEIGHT },
  "B.badge":           { tier: 1, spec: "B", weight: SATURATED_WEIGHT },
  "B.link":            { tier: 1, spec: "B", weight: SATURATED_WEIGHT },
  "B.image-alt":       { tier: 1, spec: "B", weight: SATURATED_WEIGHT },
  "B.image-response":  { tier: 1, spec: "B", weight: SATURATED_WEIGHT },
  "C.filter-q":        { tier: 1, spec: "C", weight: SATURATED_WEIGHT },
  "C.filter-case":     { tier: 1, spec: "C", weight: SATURATED_WEIGHT },
  "C.filter-category": { tier: 1, spec: "C", weight: SATURATED_WEIGHT },
  "C.filter-both":     { tier: 1, spec: "C", weight: SATURATED_WEIGHT },
  "C.empty":           { tier: 1, spec: "C", weight: SATURATED_WEIGHT },
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
  "E.labels":          { tier: 1, spec: "E", since: 2 },
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
  "E.error-announced": { tier: 2, spec: "E", since: 2 },
  "C.parallel-reads":  { tier: 2, spec: "C" },
  "H.loading":         { tier: 2, spec: "H" },
  "H.error":           { tier: 2, spec: "H" },
  "M.plan-complete":   { tier: 2, spec: "AGENTS.md", axis: "adherence" },
  "M.metadata-valid":  { tier: 2, spec: "metadata.json", axis: "adherence" },
  "M.closeout":        { tier: 2, spec: "AGENTS.md", axis: "adherence" },
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
  // Fixture r2 probes.
  "P.auth-before-parse":  { tier: 1, catches: "request body parsed before the staff check" },
  "P.malformed-json":     { tier: 1, catches: "unguarded request.json() answers 500" },
  "P.action-race":        { tier: 1, catches: "losing concurrent checkout action throws" },
  "P.retry-after-error":  { tier: 2, catches: "form unusable after a rejected action" },
  "P.axe-clean":          { tier: 2, catches: "unnamed controls or invalid ARIA" },
};

/**
 * Change-track criteria (lending_desk_change). They grade change requests that
 * exist only in the change variant's spec, so the build and bugfix tracks never
 * run or declare them. `cr` names the request in harness/change/requests.ts.
 */
export const CHANGE_CRITERIA: Record<string, Criterion & { cr: string }> = {
  "X.status-available":    { tier: 1, spec: "CR-1", cr: "CR-1" },
  "X.status-on-loan":      { tier: 1, spec: "CR-1", cr: "CR-1" },
  "X.status-combined":     { tier: 1, spec: "CR-1", cr: "CR-1" },
  "X.api-member":          { tier: 1, spec: "CR-2", cr: "CR-2" },
  "X.api-member-combined": { tier: 1, spec: "CR-2", cr: "CR-2" },
  "X.due-limit-api":       { tier: 1, spec: "CR-3", cr: "CR-3" },
  "X.due-limit-boundary":  { tier: 1, spec: "CR-3", cr: "CR-3" },
  "X.due-limit-action":    { tier: 1, spec: "CR-3", cr: "CR-3" },
  "X.detail-borrower":     { tier: 1, spec: "CR-4", cr: "CR-4" },
};

/** Advisory only — never folded into the weighted total. */
export const ADVISORY = ["ADV.useActionState", "ADV.useOptimistic"];
