/**
 * Prove that Playwright's Chromium can launch before any browser suite runs.
 *
 * A missing browser binary used to fail every browser-graded criterion (B, C,
 * D, E, F) inside a record that stayed valid, so the run scored ~20 on the build
 * track and ~49 on the bugfix track. That is a harness failure, not candidate
 * evidence. grade.sh calls this first and writes an invalid record on exit 1.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

export async function checkBrowser(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent("<p id='probe'>browser ready</p>");
      const text = await page.textContent("#probe");
      if (text !== "browser ready") return { ok: false, reason: "browser rendered no content" };
    } finally {
      await browser.close();
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await checkBrowser();
  if (result.ok) {
    console.log("browser ready");
  } else {
    console.error(`browser unavailable: ${result.reason}`);
    process.exitCode = 1;
  }
}
