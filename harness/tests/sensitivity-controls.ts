import type { NegativeControl, SourceReplacement } from "./negative-controls";

export type SensitivityControl = NegativeControl & {
  readonly allowedCollateral: readonly string[];
  /**
   * The track the control grades on. Default build: the mutation applies to
   * reference/. "change": it applies to reference-change/ and grades the X.* ids.
   */
  readonly track?: "change";
};

const control = (expectedFailure: string, target: string, from: string, to: string, allowedCollateral: readonly string[] = []): SensitivityControl => ({
  id: `sensitivity-${expectedFailure}`,
  target,
  from,
  to,
  expectedFailures: [expectedFailure],
  allowedCollateral,
});

const multiControl = (
  expectedFailure: string,
  target: string,
  replacements: readonly SourceReplacement[],
  allowedCollateral: readonly string[] = [],
): SensitivityControl => {
  const first = replacements[0];
  if (!first) throw new Error(`sensitivity-${expectedFailure} must declare replacements`);
  return {
    id: `sensitivity-${expectedFailure}`,
    target,
    from: first.from,
    to: first.to,
    replacements,
    expectedFailures: [expectedFailure],
    allowedCollateral,
  };
};

export const SENSITIVITY_CONTROLS: readonly SensitivityControl[] = [
  control("A.returned", "src/lib/loans.ts", "if (loan.returnedAt) return \"returned\";", "if (loan.returnedAt) return \"ok\";", ["D.history-status"]),
  control("A.overdue", "src/lib/loans.ts", "if (delta < 0) return \"overdue\";", "if (delta < 0) return \"due-soon\";", ["D.history-status", "G.filter-overdue", "G.filter-both"]),
  control("A.due-soon", "src/lib/loans.ts", "if (delta <= DUE_SOON_MS) return \"due-soon\";", "if (delta < 24 * 3600_000) return \"due-soon\";", ["A.boundary"]),
  control("A.ok", "src/lib/loans.ts", "return \"ok\";", "return \"due-soon\";", ["D.history-status"]),
  control("A.boundary", "src/lib/loans.ts", "const delta = due - now.getTime();\n  if (delta < 0) return \"overdue\";", "const delta = due - now.getTime();\n  if (delta <= 0) return \"overdue\";"),
  control("C.renders", "app/items/page.tsx", "<h1 className=\"text-2xl font-semibold\">Items</h1>", "<h1 className=\"text-2xl font-semibold\">Inventory</h1>", ["H.loading"]),
  control("C.renders-all", "app/items/page.tsx", "const filtered = items.filter(", "const filtered = items.slice(0, 12).filter(", ["B.badge", "B.image-alt", "C.filter-case", "C.filter-category", "F.lifecycle", "F.post-mutation-state", "P.filter-literal"]),
  control("D.renders", "app/items/[id]/page.tsx", "<p>{item.description}</p>", "<p>{item.id}</p>"),
  control("F.auth-checkout", "src/actions/loans.ts", "// Authorise inside the action: it is reachable independently of any page.\n  const session = await getStaffSession();\n  if (!session) return { ok: false, error: \"Not authorized\" };", "const session = await getStaffSession();\n  if (!session && false) return { ok: false, error: \"Not authorized\" };"),
  control("F.auth-return", "src/actions/loans.ts", "export async function returnItem(itemId: string): Promise<ActionResult> {\n  const session = await getStaffSession();\n  if (!session) return { ok: false, error: \"Not authorized\" };", "export async function returnItem(itemId: string): Promise<ActionResult> {\n  const session = await getStaffSession();\n  if (!session && false) return { ok: false, error: \"Not authorized\" };", ["E.return-error", "E.error-announced"]),
  control("F.lifecycle", "src/actions/loans.ts", "borrowedAt: at.toISOString(),", "borrowedAt: new Date(0).toISOString(),", ["F.checkout-record"]),
  control("F.checkout-record", "src/actions/loans.ts", "borrowedAt: at.toISOString(),", "borrowedAt: new Date(0).toISOString(),", ["F.lifecycle"]),
  control("F.return-record", "src/actions/loans.ts", "await closeLoan(open.id, now().toISOString());", "await closeLoan(open.id, new Date(0).toISOString());", ["F.lifecycle"]),
  control("F.future-due-date", "src/actions/loans.ts", "if (due <= at.getTime()) return { ok: false, error: \"Due date must be in the future\" };", "if (false) return { ok: false, error: \"Due date must be in the future\" };", ["E.error-shown", "E.error-announced", "P.retry-after-error"]),
  // A wrong revalidatePath target cannot fail these: /items and /items/[id] are
  // dynamic, so a full navigation always renders them fresh. A loans read held at
  // module level is stale for the life of the server, as a careless cache would be.
  multiControl("F.post-mutation-state", "app/items/page.tsx", [
    { from: "import { ItemCard } from \"@/src/components/item-card\";", to: "import { ItemCard } from \"@/src/components/item-card\";\n\nconst staleLoans = listLoans();" },
    { from: "const [items, loans] = await Promise.all([listItems(), listLoans()]);", to: "const [items, loans] = await Promise.all([listItems(), staleLoans]);" },
  ], ["P.stale-after-mutate"]),
  control("G.get200", "app/api/loans/route.ts", "return NextResponse.json({ loans });", "return NextResponse.json({ records: loans });", ["G.filter-item", "G.filter-overdue", "G.filter-both", "G.fresh", "G.patch200"]),
  control("G.401", "app/api/loans/route.ts", "NextResponse.json({ error: \"Unauthorized\" }, { status: 401 })", "NextResponse.json({ error: \"Unauthorized\" }, { status: 403 })", ["P.auth-before-parse"]),
  control("B.name-category", "src/components/item-card.tsx", "<p className=\"text-sm text-neutral-600\">{item.category}</p>", "<p className=\"text-sm text-neutral-600\">{item.id}</p>"),
  control("B.badge", "src/components/item-card.tsx", "{openLoan ? \"On loan\" : \"Available\"}", "{openLoan ? \"Checked out\" : \"Available\"}", ["F.post-mutation-state", "P.stale-after-mutate"]),
  control("B.link", "src/components/item-card.tsx", "href={`/items/${item.id}`}", "href={item.id === \"itm-001\" ? \"/items/itm-002\" : `/items/${item.id}`}"),
  control("B.image-alt", "src/components/item-card.tsx", "alt={item.name}", "alt={item.id}", ["B.image-response"]),
  control("B.image-response", "src/components/item-card.tsx", "src={item.imageUrl}", "src=\"/missing-image.png\""),
  control("C.filter-q", "app/items/page.tsx", "(!needle || i.name.toLowerCase().includes(needle)) &&", "(!needle || false) &&"),
  control("C.filter-case", "app/items/page.tsx", "const needle = q?.toLowerCase();", "const needle = q;"),
  control("C.filter-category", "app/items/page.tsx", "i.category === category", "false"),
  control("C.filter-both", "app/items/page.tsx", "(!category || i.category === category),", "(!category || i.category === category || needle === \"drill\"),"),
  control("C.empty", "app/items/page.tsx", "No items match your search.", "Nothing matched.", ["P.searchparams-async", "P.filter-literal"]),
  control("C.parallel-reads", "app/items/page.tsx", "    countItems(),", "    await countItems(),"),
  control("D.history-order", "app/items/[id]/page.tsx", "(a, b) => Date.parse(b.borrowedAt) - Date.parse(a.borrowedAt),", "(a, b) => Date.parse(a.borrowedAt) - Date.parse(b.borrowedAt),"),
  control("D.history-status", "app/items/[id]/page.tsx", "{computeLoanStatus(loan, at)}", "{\"ok\"}"),
  control("D.notfound", "app/items/[id]/page.tsx", "if (!item) notFound();", "if (!item) return <p>Unknown item</p>;"),
  control("D.form-hidden", "app/items/[id]/page.tsx", "{openLoan ? (", "{false ? (", ["D.return-visible", "E.return-submits", "E.return-pending", "E.return-optimistic", "E.return-error", "F.auth-return", "F.return-not-on-loan", "F.lifecycle", "F.return-record", "F.post-mutation-state", "E.error-announced"]),
  control("D.return-visible", "app/items/[id]/page.tsx", "<ReturnButton itemId={item.id} />", "<p>Unavailable</p>", ["E.return-submits", "E.return-pending", "E.return-optimistic", "E.return-error", "F.auth-return", "F.return-not-on-loan", "F.lifecycle", "F.return-record", "F.post-mutation-state", "E.error-announced"]),
  control("D.metadata", "app/items/[id]/page.tsx", "return { title: `${item.name} — Lending Desk` };", "return { title: `${item.id} — Lending Desk` };"),
  control("E.submits", "app/items/[id]/checkout-form.tsx", "const result = await checkoutItem(itemId, memberId, new Date(dueAt).toISOString());", "const result = { ok: false as const, error: \"Checkout disabled\" };", ["E.error-shown", "E.optimistic", "F.lifecycle", "F.checkout-record", "F.future-due-date", "F.post-mutation-state", "P.stale-after-mutate", "E.error-announced", "P.action-race", "P.retry-after-error"]),
  control("E.error-shown", "app/items/[id]/checkout-form.tsx", "{state.error && <p role=\"alert\" className=\"text-sm text-red-600\">{state.error}</p>}\n    </form>\n  );\n}\n\nexport function ReturnButton", "{null}\n    </form>\n  );\n}\n\nexport function ReturnButton", ["F.auth-checkout", "F.checkout-conflict", "F.future-due-date", "E.error-announced", "P.action-race", "P.retry-after-error"]),
  control("E.member-options", "app/items/[id]/checkout-form.tsx", "<option key={m.id} value={m.id}>{m.name}</option>", "<option key={m.id} value={m.id}>{m.id}</option>", ["E.submits", "E.pending", "E.optimistic", "E.error-shown", "F.auth-checkout", "F.checkout-conflict", "F.lifecycle", "F.checkout-record", "F.future-due-date", "F.post-mutation-state", "P.stale-after-mutate", "E.error-announced", "P.action-race", "P.retry-after-error"]),
  control("E.return-submits", "app/items/[id]/checkout-form.tsx", "const result = await returnItem(itemId);", "const result = { ok: true as const };", ["F.lifecycle", "F.return-record", "F.post-mutation-state"]),
  control("E.return-error", "app/items/[id]/checkout-form.tsx", "</button>\n\n      {state.error && <p role=\"alert\" className=\"text-sm text-red-600\">{state.error}</p>}\n    </form>\n  );\n}", "</button>\n\n      {null}\n    </form>\n  );\n}", ["F.auth-return", "F.return-not-on-loan", "E.error-announced"]),
  // F.checkout-conflict submits a stale form after the item went on loan, so the
  // action's own read answers it before any write. Removing only the race catch
  // left that read in place and never failed the target; remove both.
  multiControl("F.checkout-conflict", "src/actions/loans.ts", [
    { from: "  if (await findOpenLoan(itemId)) return { ok: false, error: \"Item is already on loan\" };\n", to: "" },
    { from: "if (error instanceof ItemOnLoanError) {\n      return { ok: false, error: \"Item is already on loan\" };\n    }", to: "if (false) {\n      return { ok: false, error: \"Item is already on loan\" };\n    }" },
  ], ["P.action-race"]),
  control("F.return-not-on-loan", "src/actions/loans.ts", "if (error instanceof LoanAlreadyClosedError) {\n      return { ok: false, error: \"Item is not on loan\" };\n    }", "if (false) {\n      return { ok: false, error: \"Item is not on loan\" };\n    }"),
  control("G.filter-item", "app/api/loans/route.ts", "if (itemId) loans = loans.filter((l) => l.itemId === itemId);", "if (itemId) loans = loans.filter((l) => false);", ["G.filter-both"]),
  control("G.filter-overdue", "app/api/loans/route.ts", "if (overdue) loans = loans.filter((l) => computeLoanStatus(l, at) === \"overdue\");", "if (overdue) loans = loans.filter((l) => false);", ["G.filter-both"]),
  control("G.filter-both", "app/api/loans/route.ts", "loans = loans.filter((l) => l.itemId === itemId);", "loans = loans.filter((l) => l.itemId === itemId && itemId !== \"itm-003\");"),
  control("G.post201", "app/api/loans/route.ts", "return NextResponse.json({ loan }, { status: 201 });", "return NextResponse.json({ loan }, { status: 200 });", ["G.fresh"]),
  control("G.post-fields", "app/api/loans/route.ts", "borrowedAt: now().toISOString(),", "borrowedAt: new Date(0).toISOString(),"),
  control("G.400", "app/api/loans/route.ts", "{ error: \"itemId, memberId and dueAt are required strings\" },\n      { status: 400 },", "{ error: \"itemId, memberId and dueAt are required strings\" },\n      { status: 422 },", ["P.validate-before-io"]),
  control("G.409", "app/api/loans/route.ts", "if (await findOpenLoan(itemId)) {\n    return NextResponse.json({ error: \"Item is already on loan\" }, { status: 409 });\n  }", "if (await findOpenLoan(itemId)) {\n    return NextResponse.json({ error: \"Item is already on loan\" }, { status: 400 });\n  }"),
  control("G.fresh", "app/api/loans/route.ts", "export const dynamic = \"force-dynamic\";", "export const dynamic = \"force-static\";"),
  control("G.patch200", "app/api/loans/route.ts", "return NextResponse.json({ loan });", "return NextResponse.json({ loan }, { status: 202 });", ["P.concurrent-return"]),
  control("G.patch409", "app/api/loans/route.ts", "if (!open) {\n    return NextResponse.json({ error: \"Item is not on loan\" }, { status: 409 });\n  }", "if (!open) {\n    return NextResponse.json({ error: \"Item is not on loan\" }, { status: 400 });\n  }"),
  control("G.patch400", "app/api/loans/route.ts", "return NextResponse.json({ error: \"itemId is required and must be a string\" }, { status: 400 });", "return NextResponse.json({ error: \"itemId is required and must be a string\" }, { status: 422 });"),
  control("E.pending", "app/items/[id]/checkout-form.tsx", "{pending ? \"Checking out…\" : \"Check out\"}", "{pending ? \"Check out\" : \"Check out\"}"),
  control("E.optimistic", "app/items/[id]/checkout-form.tsx", "startTransition(() => setOptimisticOnLoan(true));", "startTransition(() => setOptimisticOnLoan(false));"),
  control("E.return-pending", "app/items/[id]/checkout-form.tsx", "{pending ? \"Returning…\" : \"Return\"}", "{pending ? \"Return\" : \"Return\"}"),
  control("E.return-optimistic", "app/items/[id]/checkout-form.tsx", "startTransition(() => setOptimisticReturned(true));", "startTransition(() => setOptimisticReturned(false));"),
  control("H.loading", "app/items/loading.tsx", "<h1 className=\"text-2xl font-semibold\">Items</h1>", "<h1 className=\"text-2xl font-semibold\">Inventory</h1>"),
  control("H.error", "app/items/error.tsx", "Could not load items.", "Something went wrong."),
  control("M.plan-complete", "measure/tracks/lending_desk/plan.md", "- [x] Implement `computeLoanStatus` in `src/lib/loans.ts` (spec A)", "- [ ] Implement `computeLoanStatus` in `src/lib/loans.ts` (spec A)", ["M.closeout"]),
  control("M.metadata-valid", "measure/tracks/lending_desk/metadata.json", "\"title\": \"Lending Desk — items slice\"", "\"title\": \"Wrong title\""),
  control("M.closeout", "measure/tracks/lending_desk/metadata.json", "\"actual_tasks\": 24", "\"actual_tasks\": 23"),
  control("P.searchparams-async", "app/items/page.tsx", "    searchParams,\n    countItems(),", "    Promise.resolve({} as { q?: string; category?: string }),\n    countItems(),"),
  // Inside the form: a sibling of the form's root element would not compile.
  control("P.no-key-leak", "app/items/[id]/checkout-form.tsx", "<form action={formAction} className=\"space-y-3 rounded-lg border border-neutral-200 p-4\">\n      {optimisticOnLoan", "<form action={formAction} className=\"space-y-3 rounded-lg border border-neutral-200 p-4\">\n      <p>staff-key-7f3a</p>\n      {optimisticOnLoan"),
  multiControl("P.stale-after-mutate", "app/items/page.tsx", [
    { from: "import { ItemCard } from \"@/src/components/item-card\";", to: "import { ItemCard } from \"@/src/components/item-card\";\n\nconst staleLoans = listLoans();" },
    { from: "const [items, loans] = await Promise.all([listItems(), listLoans()]);", to: "const [items, loans] = await Promise.all([listItems(), staleLoans]);" },
  ], ["F.post-mutation-state"]),
  control("P.concurrent-checkout", "app/api/loans/route.ts", "if (error instanceof ItemOnLoanError) {\n      return NextResponse.json({ error: \"Item is already on loan\" }, { status: 409 });\n    }", "if (false) {\n      return NextResponse.json({ error: \"Item is already on loan\" }, { status: 409 });\n    }"),
  control("P.concurrent-return", "app/api/loans/route.ts", "if (error instanceof LoanAlreadyClosedError) {\n      return NextResponse.json({ error: \"Item is not on loan\" }, { status: 409 });\n    }", "if (false) {\n      return NextResponse.json({ error: \"Item is not on loan\" }, { status: 409 });\n    }"),
  control("P.hydration-clean", "app/items/[id]/checkout-form.tsx", "<form action={formAction} className=\"space-y-3 rounded-lg border border-neutral-200 p-4\">", "<form action={formAction} data-hydration={Math.random()} className=\"space-y-3 rounded-lg border border-neutral-200 p-4\">"),
  control("P.filter-literal", "app/items/page.tsx", "i.name.toLowerCase().includes(needle)", "new RegExp(needle, \"i\").test(i.name)"),
  control("P.validate-before-io", "app/api/loans/route.ts", "const { itemId, memberId, dueAt } = (body ?? {}) as Record<string, unknown>;\n  if (typeof itemId !== \"string\" || typeof memberId !== \"string\" || typeof dueAt !== \"string\") {\n    return NextResponse.json(\n      { error: \"itemId, memberId and dueAt are required strings\" },\n      { status: 400 },\n    );\n  }", "const { itemId, memberId, dueAt } = (body ?? {}) as Record<string, unknown>;\n  if (typeof itemId !== \"string\" || typeof memberId !== \"string\" || typeof dueAt !== \"string\") {\n    await Promise.all([getItem(\"\"), getMember(\"\")]);\n    return NextResponse.json(\n      { error: \"itemId, memberId and dueAt are required strings\" },\n      { status: 400 },\n    );\n  }"),
  control("P.n-plus-one", "app/items/page.tsx", "  if (filtered.length === 0) {", "  await Promise.all(filtered.map(() => listItems()));\n\n  if (filtered.length === 0) {"),
  control("P.dedup-item", "app/items/[id]/page.tsx", "const loadItem = cache(getItem);", "const loadItem = getItem;"),
  // Fixture r2 checks.
  control("E.labels", "app/items/[id]/checkout-form.tsx", "<select name=\"memberId\" aria-label=\"Member\" defaultValue=\"\"", "<select name=\"memberId\" defaultValue=\"\"", ["P.axe-clean"]),
  control("E.error-announced", "app/items/[id]/checkout-form.tsx", "{state.error && <p role=\"alert\" className=\"text-sm text-red-600\">{state.error}</p>}\n    </form>\n  );\n}\n\nexport function ReturnButton", "{state.error && <p className=\"text-sm text-red-600\">{state.error}</p>}\n    </form>\n  );\n}\n\nexport function ReturnButton"),
  control("P.auth-before-parse", "app/api/loans/route.ts", "export async function POST(request: Request) {\n  if (!(await getStaffSession())) return unauthorized();\n\n  let body: unknown;\n  try {\n    body = await request.json();\n  } catch {\n    return NextResponse.json({ error: \"Malformed JSON body\" }, { status: 400 });\n  }\n", "export async function POST(request: Request) {\n  let body: unknown;\n  try {\n    body = await request.json();\n  } catch {\n    return NextResponse.json({ error: \"Malformed JSON body\" }, { status: 400 });\n  }\n  if (!(await getStaffSession())) return unauthorized();\n"),
  control("P.malformed-json", "app/api/loans/route.ts", "  let body: unknown;\n  try {\n    body = await request.json();\n  } catch {\n    return NextResponse.json({ error: \"Malformed JSON body\" }, { status: 400 });\n  }\n\n  const { itemId, memberId, dueAt }", "  const body: unknown = await request.json();\n\n  const { itemId, memberId, dueAt }"),
  control("P.action-race", "src/actions/loans.ts", "if (error instanceof ItemOnLoanError) {\n      return { ok: false, error: \"Item is already on loan\" };\n    }", "if (false) {\n      return { ok: false, error: \"Item is already on loan\" };\n    }"),
  control("P.retry-after-error", "app/items/[id]/checkout-form.tsx", "<button type=\"submit\" disabled={pending} className=", "<button type=\"submit\" disabled={pending || Boolean(state.error)} className="),
  multiControl("P.axe-clean", "app/items/[id]/page.tsx", [
    { from: "<li key={loan.id} className=\"flex justify-between py-2\">", to: "<div key={loan.id} className=\"flex justify-between py-2\">" },
    { from: "</li>\n      ))}\n    </ul>", to: "</div>\n      ))}\n    </ul>" },
  ]),
  // Remove the boundary itself. Renaming the fallback to the probe's own marker only
  // proved the marker is read; it never proved the Suspense boundary is graded.

  multiControl(
    "ADV.useActionState",
    "app/items/[id]/checkout-form.tsx",
    [
      {
        from: "import { useActionState, useOptimistic, useTransition } from \"react\";",
        to: "import { use\\u0041ctionState as actionState, useOptimistic, useTransition } from \"react\";",
      },
      {
        from: "const [state, formAction, pending] = useActionState<State, FormData>(\n    async (_prev, formData) => {",
        to: "const [state, formAction, pending] = actionState<State, FormData>(\n    async (_prev, formData) => {",
      },
      {
        from: "const [state, formAction, pending] = useActionState<State, FormData>(async () => {",
        to: "const [state, formAction, pending] = actionState<State, FormData>(async () => {",
      },
    ],
  ),
  multiControl(
    "ADV.useOptimistic",
    "app/items/[id]/checkout-form.tsx",
    [
      {
        from: "import { useActionState, useOptimistic, useTransition } from \"react\";",
        to: "import { useActionState, use\\u004Fptimistic as optimisticState, useTransition } from \"react\";",
      },
      {
        from: "const [optimisticOnLoan, setOptimisticOnLoan] = useOptimistic(false);",
        to: "const [optimisticOnLoan, setOptimisticOnLoan] = optimisticState(false);",
      },
      {
        from: "const [optimisticReturned, setOptimisticReturned] = useOptimistic(false);",
        to: "const [optimisticReturned, setOptimisticReturned] = optimisticState(false);",
      },
      {
        from: "      {/* Shown before the server has answered; useOptimistic drops it again if",
        to: "      {/* Shown before the server has answered; the optimistic state drops it again if",
      },
    ],
  ),
];

const changeControl = (expectedFailure: string, target: string, from: string, to: string, allowedCollateral: readonly string[] = []): SensitivityControl => ({
  ...control(expectedFailure, target, from, to, allowedCollateral),
  track: "change",
});

/** Change-track controls (change_bench FR-2): mutations of reference-change/. */
export const CHANGE_CONTROLS: readonly SensitivityControl[] = [
  changeControl("X.status-available", "app/items/page.tsx", "(status !== \"available\" || !onLoan.has(i.id)) &&", "(status !== \"available\" || true) &&"),
  changeControl("X.status-on-loan", "app/items/page.tsx", "(status !== \"on-loan\" || onLoan.has(i.id)),", "(status !== \"on-loan\" || true),", ["X.status-combined"]),
  changeControl("X.status-combined", "app/items/page.tsx", "(!needle || i.name.toLowerCase().includes(needle)) &&", "(!needle || Boolean(status) || i.name.toLowerCase().includes(needle)) &&"),
  changeControl("X.api-member", "app/api/loans/route.ts", "if (memberId) loans = loans.filter((l) => l.memberId === memberId);", "if (memberId && false) loans = loans.filter((l) => l.memberId === memberId);", ["X.api-member-combined"]),
  changeControl("X.api-member-combined", "app/api/loans/route.ts", "if (memberId) loans = loans.filter((l) => l.memberId === memberId);", "if (memberId && !itemId) loans = loans.filter((l) => l.memberId === memberId);"),
  changeControl("X.due-limit-api", "app/api/loans/route.ts", "if (due - now().getTime() > MAX_LOAN_MS) {", "if (false) {", ["X.due-limit-boundary"]),
  changeControl("X.due-limit-boundary", "app/api/loans/route.ts", "if (due - now().getTime() > MAX_LOAN_MS) {", "if (due - now().getTime() >= MAX_LOAN_MS) {"),
  changeControl("X.due-limit-action", "src/actions/loans.ts", "if (due - at.getTime() > MAX_LOAN_MS) return", "if (false) return"),
  changeControl("X.detail-borrower", "app/items/[id]/page.tsx", "On loan to {member?.name ?? loan.memberId}, due", "On loan to {loan.memberId}, due"),
];
