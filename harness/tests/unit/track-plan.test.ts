import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const CANDIDATE = process.env.CANDIDATE ?? resolve(ROOT, "fixture");
const track = (...parts: string[]) =>
  readFileSync(resolve(CANDIDATE, "measure/tracks/lending_desk", ...parts), "utf8");

const ORIGINAL_TASKS = [
  "Implement `computeLoanStatus` in `src/lib/loans.ts` (spec A)",
  "Verify all five A criteria by inspection against `src/db/seed.ts`",
  "Implement `ItemCard` in `src/components/item-card.tsx` (spec B)",
  "Implement the catalogue in `app/items/page.tsx` (spec C)",
  "Confirm `/items` lists all 29 seeded items",
  "Add `?q=` and `?category=` handling to `app/items/page.tsx` (spec C)",
  "Add the empty-result message (spec C)",
  "Implement `app/items/[id]/page.tsx` including loan history and not-found (spec D)",
  "Implement `generateMetadata` (spec D)",
  "Implement `checkoutItem` and `returnItem` in `src/actions/loans.ts` (spec F)",
  "Ensure `/items` and the detail page reflect a mutation on the next visit (spec F)",
  "Implement `GET` in `app/api/loans/route.ts` with both filters (spec G)",
  "Implement `POST` with its status codes (spec G)",
  "Implement `PATCH` with its status codes (spec G)",
  "Implement `CheckoutForm` in `app/items/[id]/checkout-form.tsx` (spec E)",
  "Wire it into the detail page, hidden when the item is on loan (spec D)",
  "Implement `ReturnButton` in `app/items/[id]/checkout-form.tsx` (spec E)",
  "Wire it into the detail page, shown only when the item is on loan (spec D)",
  "Confirm returning an item makes the checkout form available again (spec F)",
  "Implement `app/items/loading.tsx` (spec H)",
  "Implement `app/items/error.tsx` (spec H)",
  "`npm run typecheck` passes",
  "`npm run build` passes",
  "Every checkbox in `spec.md` is satisfied",
] as const;

describe("Measure track closeout", () => {
  it("M.metadata-valid", () => {
    const metadata = JSON.parse(track("metadata.json"));
    expect(metadata).toMatchObject({
      id: "lending_desk",
      title: "Lending Desk — items slice",
      type: "Feature",
    });
    expect(["pending", "in_progress", "complete"]).toContain(metadata.status);
  });

  it("M.plan-complete", () => {
    const unchecked = track("plan.md").match(/^- \[ \] .+$/gm) ?? [];
    expect(unchecked, `uncompleted track tasks:\n${unchecked.join("\n")}`).toEqual([]);
  });

  it("M.closeout", () => {
    const taskLines = track("plan.md").match(/^- \[[ x]\] .+$/gm) ?? [];
    expect(taskLines.map((line) => line.replace(/^- \[[ x]\] /, ""))).toEqual(ORIGINAL_TASKS);
    expect(taskLines).toEqual(ORIGINAL_TASKS.map((task) => `- [x] ${task}`));

    const metadata = JSON.parse(track("metadata.json"));
    expect(metadata.status).toBe("complete");
    expect(metadata.actual_tasks).toBe(24);
  });
});
