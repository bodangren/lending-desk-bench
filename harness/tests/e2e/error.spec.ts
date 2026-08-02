/**
 * Spec H, error half. Runs against a second server boot with BENCH_FAIL_ITEMS=1,
 * which makes listItems throw. Excluded from the main pass by --grep-invert.
 */
import { expect, test } from "@playwright/test";

test("H.error", async ({ page }) => {
  await page.goto("/items");
  await expect(page.getByText("Could not load items.")).toBeVisible();
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();

  // "Retries without a full page reload": the control must be wired to the
  // boundary's reset, not to location.reload().
  let reloaded = false;
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) reloaded = true;
  });
  await retry.click();
  await page.waitForTimeout(500);
  expect(reloaded, "Try again triggered a document navigation").toBe(false);
});
