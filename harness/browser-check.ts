/**
 * Prove that the system Chrome can launch before any browser suite runs.
 *
 * A missing browser binary used to fail every browser-graded criterion (B, C,
 * D, E, F) inside a record that stayed valid, so the run scored ~20 on the build
 * track and ~49 on the bugfix track. That is a harness failure, not candidate
 * evidence. grade.sh calls this first and writes an invalid record on exit 1.
 *
 * The check launches the system Chrome through the Playwright chrome channel
 * (spec D1). It also returns the version of the launched browser (spec D2). The
 * version is a record, not a freshness input.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

/** The record of one grade (spec D2). grade.sh writes it to artifacts/grader-browser.json. */
export function browserRecordLine(version: string): string {
  return JSON.stringify({ schema: 1, channel: "chrome", version });
}

export async function checkBrowser(): Promise<{ ok: boolean; reason?: string; version?: string }> {
  try {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent("<p id='probe'>browser ready</p>");
      const text = await page.textContent("#probe");
      if (text !== "browser ready") return { ok: false, reason: "browser rendered no content" };
      return { ok: true, version: browser.version() };
    } finally {
      await browser.close();
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.split("\n")[0] : String(error) };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = await checkBrowser();
  if (result.ok) {
    console.log("browser ready");
    // The version of the launched browser. grade.sh reads this line.
    console.log(browserRecordLine(result.version ?? ""));
  } else {
    console.error(`browser unavailable: ${result.reason}`);
    process.exitCode = 1;
  }
}
