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

/** Checklist tasks from plan.md, under any bullet character and either marker case. */
function planTasks(): { done: boolean; text: string }[] {
  const rows: { done: boolean; text: string }[] = [];
  for (const line of track("plan.md").split("\n")) {
    const match = /^\s*[-*+] \[([ xX])\] (.+?)\s*$/.exec(line);
    if (match) rows.push({ done: match[1] !== " ", text: match[2] });
  }
  return rows;
}

describe("Measure track closeout", () => {
  it("M.metadata-valid", () => {
    // The untouched fixture already satisfied every clause of this criterion, including
    // status "pending", so it discriminated nothing: all 19 valid runs passed it and 10
    // of them never opened the file. Keep the corruption check and let M.closeout own
    // the closeout values.
    const metadata = JSON.parse(track("metadata.json"));
    expect(metadata).toMatchObject({
      id: "lending_desk",
      title: "Lending Desk — items slice",
      type: "Feature",
    });
    expect(metadata.status, "status must stay one of the Measure states").toMatch(
      /^(pending|in_progress|complete)$/,
    );
    // The untouched fixture omits the key entirely, so absent is valid here. M.closeout
    // is the criterion that requires the closeout value.
    expect(
      metadata.actual_tasks == null || Number.isInteger(metadata.actual_tasks),
      "actual_tasks must be absent, null, or an integer",
    ).toBe(true);
  });

  it("M.plan-complete", () => {
    // Read the markers rather than searching for "- [ ]". The old form matched no line
    // in an emptied plan.md and then passed, and it rejected the valid GFM marker
    // "- [X]" and a "*" bullet, neither of which AGENTS.md forbids.
    const tasks = planTasks();
    expect(tasks, "plan.md holds no checklist tasks at all").toHaveLength(ORIGINAL_TASKS.length);
    const unchecked = tasks.filter((task) => !task.done).map((task) => task.text);
    expect(unchecked, `uncompleted track tasks:\n${unchecked.join("\n")}`).toEqual([]);
  });

  it("M.closeout", () => {
    // AGENTS.md states the metadata contract in plain words. It states nothing about
    // the bullet character or the marker case, so compare the task text alone.
    expect(planTasks().map((task) => task.text)).toEqual([...ORIGINAL_TASKS]);

    const metadata = JSON.parse(track("metadata.json"));
    expect(metadata.status).toBe("complete");
    expect(metadata.actual_tasks).toBe(24);
  });
});
