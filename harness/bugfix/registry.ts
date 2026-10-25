/**
 * Bug registry for the lending_desk_bugfix track.
 *
 * Each entry is a realistic, anchored mutation of the clean tree (fixture +
 * reference overlay). Detectors are existing suite ids that pass on the clean
 * tree and fail on the single bug — proven by the admission executor
 * (verify-bugs.ts), never assumed.
 *
 * Skill rules cite vercel-react-best-practices / vercel-composition-patterns
 * rule ids. Null means product logic with no skill counterpart.
 */
import { createHash } from "node:crypto";
import type { NegativeControl, SourceReplacement } from "../tests/negative-controls.js";
import { CRITERIA, PROBES } from "../tests/criteria.js";

export type BugClass = "functional" | "security" | "performance" | "reliability";

/** A registry bug is an anchored mutation; its detectors replace a control's expected failures. */
export type BugEntry = Omit<NegativeControl, "expectedFailures"> & {
  id: string;
  class: BugClass;
  skill_rule: string | null;
  detectors: readonly string[];
  collateral: readonly string[];
  realism: string;
};

const bug = (entry: BugEntry): BugEntry => entry;

export const BUG_REGISTRY: readonly BugEntry[] = [
  bug({
    id: "BUG-fn-status-precedence",
    class: "functional",
    skill_rule: null,
    target: "src/lib/loans.ts",
    from: '  if (loan.returnedAt) return "returned";\n  const due = Date.parse(loan.dueAt);\n  const delta = due - now.getTime();\n  if (delta < 0) return "overdue";',
    to: '  const due = Date.parse(loan.dueAt);\n  const delta = due - now.getTime();\n  if (delta < 0) return "overdue";\n  if (loan.returnedAt) return "returned";',
    detectors: ["A.returned"],
    collateral: ["D.history-status", "G.filter-overdue", "G.filter-both"],
    realism: "The returned check moves below the overdue check, so a returned loan with a past due date reports overdue.",
  }),
  bug({
    id: "BUG-fn-boundary",
    class: "functional",
    skill_rule: null,
    target: "src/lib/loans.ts",
    from: '  if (delta < 0) return "overdue";',
    to: '  if (delta <= 0) return "overdue";',
    detectors: ["A.boundary"],
    collateral: [],
    realism: "An off-by-one on the due-soon boundary: a loan due exactly now is reported overdue.",
  }),
  bug({
    id: "BUG-fn-history-order",
    class: "functional",
    skill_rule: null,
    target: "app/items/[id]/page.tsx",
    from: "    (a, b) => Date.parse(b.borrowedAt) - Date.parse(a.borrowedAt),",
    to: "    (a, b) => Date.parse(a.borrowedAt) - Date.parse(b.borrowedAt),",
    detectors: ["D.history-order"],
    collateral: [],
    realism: "The history sort comparator is reversed, so the oldest loans render first.",
  }),
  bug({
    id: "BUG-fn-filter-case",
    class: "functional",
    skill_rule: null,
    target: "app/items/page.tsx",
    from: "  const needle = q?.toLowerCase();",
    to: "  const needle = q;",
    detectors: ["C.filter-case"],
    collateral: [],
    realism: "The search normalisation is dropped, so the catalogue filter turns case-sensitive.",
  }),
  bug({
    id: "BUG-fn-contract-400",
    class: "functional",
    skill_rule: null,
    target: "app/api/loans/route.ts",
    from: '      { error: "itemId, memberId and dueAt are required strings" },\n      { status: 400 },',
    to: '      { error: "itemId, memberId and dueAt are required strings" },\n      { status: 422 },',
    detectors: ["G.400"],
    collateral: ["P.validate-before-io"],
    realism: "A validation failure answers 422 where the API contract states 400.",
  }),
  bug({
    id: "BUG-sec-action-auth",
    class: "security",
    skill_rule: "server-auth-actions",
    target: "src/actions/loans.ts",
    from: '  // Authorise inside the action: it is reachable independently of any page.\n  const session = await getStaffSession();\n  if (!session) return { ok: false, error: "Not authorized" };\n\n  const due = Date.parse(dueAt);',
    to: "  const due = Date.parse(dueAt);",
    detectors: ["F.auth-checkout"],
    collateral: [],
    realism: "The staff check is deleted from checkoutItem, leaving the server action unauthenticated.",
  }),
  bug({
    id: "BUG-sec-route-401",
    class: "security",
    skill_rule: "server-auth-actions",
    target: "app/api/loans/route.ts",
    from: 'export async function GET(request: Request) {\n  if (!(await getStaffSession())) return unauthorized();\n\n  const url = new URL(request.url);',
    to: "export async function GET(request: Request) {\n  const url = new URL(request.url);",
    detectors: ["G.401"],
    collateral: [],
    realism: "The route guard is applied only to the write methods, leaving staff loan data readable without a session.",
  }),
  bug({
    id: "BUG-perf-waterfall",
    class: "performance",
    skill_rule: "async-parallel",
    target: "app/items/page.tsx",
    from: "    searchParams,\n    countItems(),\n    listCategories(),",
    to: "    searchParams,\n    await countItems(),\n    listCategories(),",
    detectors: ["C.parallel-reads"],
    collateral: [],
    realism: "One read is awaited inside the Promise.all array, serialising two independent requests.",
  }),
  bug({
    id: "BUG-perf-dedup",
    class: "performance",
    skill_rule: "server-cache-react",
    target: "app/items/[id]/page.tsx",
    from: "const loadItem = cache(getItem);",
    to: "const loadItem = getItem;",
    detectors: ["P.dedup-item"],
    collateral: [],
    realism: "React.cache is removed, so the metadata and page renders read the same item twice per request.",
  }),
  bug({
    id: "BUG-rel-race",
    class: "reliability",
    skill_rule: null,
    target: "app/api/loans/route.ts",
    from: '  try {\n    const loan = await insertLoan({\n      itemId,\n      memberId,\n      borrowedAt: now().toISOString(),\n      dueAt: new Date(due).toISOString(),\n      returnedAt: null,\n    });\n    return NextResponse.json({ loan }, { status: 201 });\n  } catch (error) {\n    // The findOpenLoan above is a read. Concurrent requests all pass it and then\n    // race for the write; every loser has to come back as a conflict, not a 500.\n    if (error instanceof ItemOnLoanError) {\n      return NextResponse.json({ error: "Item is already on loan" }, { status: 409 });\n    }\n    throw error;\n  }',
    to: '  const loan = await insertLoan({\n    itemId,\n    memberId,\n    borrowedAt: now().toISOString(),\n    dueAt: new Date(due).toISOString(),\n    returnedAt: null,\n  });\n  return NextResponse.json({ loan }, { status: 201 });',
    detectors: ["P.concurrent-checkout"],
    collateral: [],
    realism: "The conflict catch is deleted because the pre-check looks sufficient; concurrent checkouts then fail with a 500 instead of a 409.",
  }),
  bug({
    id: "BUG-rel-return-unguarded",
    class: "reliability",
    skill_rule: null,
    target: "src/actions/loans.ts",
    from: '  const open = await findOpenLoan(itemId);\n  if (!open) return { ok: false, error: "Item is not on loan" };\n',
    to: "  const open = (await findOpenLoan(itemId))!;\n",
    detectors: ["F.return-not-on-loan"],
    collateral: [],
    realism: "The open-loan guard is replaced by a non-null assertion because the button is only rendered for open loans; a stale view returning a closed item then crashes instead of returning the contract error.",
  }),
  // Rotation headroom: registry entries beyond the active set v1.
  bug({
    id: "BUG-fn-notfound",
    class: "functional",
    skill_rule: null,
    target: "app/items/[id]/page.tsx",
    from: "  if (!item) notFound();",
    to: "  if (!item) return <p>Unknown item</p>;",
    detectors: ["D.notfound"],
    collateral: [],
    realism: "An unknown item renders an inline paragraph with a 200 status instead of the app's not-found page.",
  }),
  bug({
    id: "BUG-fn-metadata-title",
    class: "functional",
    skill_rule: null,
    target: "app/items/[id]/page.tsx",
    from: '  return { title: `${item.name} — Lending Desk` };',
    to: '  return { title: `${item.id} — Lending Desk` };',
    detectors: ["D.metadata"],
    collateral: [],
    realism: "The metadata title falls back to the raw item id instead of the item name.",
  }),
];

const KNOWN_IDS = new Set([...Object.keys(CRITERIA), ...Object.keys(PROBES)]);

export function validateRegistry(entries: readonly BugEntry[]): string[] {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) reasons.push(`duplicate bug id: ${entry.id}`);
    seen.add(entry.id);
    if (!entry.detectors.length) reasons.push(`${entry.id} declares no detectors`);
    for (const detector of entry.detectors) {
      if (!KNOWN_IDS.has(detector)) reasons.push(`${entry.id} names unknown detector: ${detector}`);
    }
    for (const collateralId of entry.collateral) {
      if (!KNOWN_IDS.has(collateralId)) reasons.push(`${entry.id} names unknown collateral: ${collateralId}`);
      if (entry.detectors.includes(collateralId)) {
        reasons.push(`${entry.id} lists ${collateralId} as both detector and collateral`);
      }
    }
    const replacements: readonly SourceReplacement[] = entry.replacements ?? [
      { from: entry.from, to: entry.to },
    ];
    if (!replacements.length) reasons.push(`${entry.id} declares no replacements`);
    for (const replacement of replacements) {
      if (replacement.from === replacement.to) {
        reasons.push(`${entry.id} declares a no-op replacement`);
      }
    }
    if (!entry.realism.trim()) reasons.push(`${entry.id} lacks a realism rationale`);
  }
  return reasons;
}

/** Pairwise detector disjointness for one set, outside declared collateral. */
export function detectorConflicts(entries: readonly BugEntry[]): string[] {
  const reasons: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      const overlap = a.detectors.filter((id) => b.detectors.includes(id));
      const aAllows = a.collateral.some((id) => b.detectors.includes(id));
      const bAllows = b.collateral.some((id) => a.detectors.includes(id));
      if (overlap.length && !aAllows && !bAllows) {
        reasons.push(`${a.id} and ${b.id} share detector(s) ${overlap.join(", ")} without declared collateral`);
      }
    }
  }
  return reasons;
}

export function getBug(id: string): BugEntry {
  const entry = BUG_REGISTRY.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`unknown bug id: ${id}`);
  return entry;
}

/** Stable hash over the registry contents, independent of source formatting. */
export function registryHash(): string {
  const rows = [...BUG_REGISTRY]
    .map((entry) => JSON.stringify({
      id: entry.id,
      class: entry.class,
      skill_rule: entry.skill_rule,
      target: entry.target,
      replacements: entry.replacements ?? [{ from: entry.from, to: entry.to }],
      detectors: entry.detectors,
      collateral: entry.collateral,
      realism: entry.realism,
    }))
    .sort();
  return createHash("sha256").update(rows.join("\n")).digest("hex");
}
