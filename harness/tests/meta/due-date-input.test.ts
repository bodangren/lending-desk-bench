import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { dueDateInput, fillDueDate } from "../e2e/_forms.js";

const CASES = [
  {
    name: "a labelled text input with no name",
    html: '<label for="due">Due date</label><input id="due" type="text">',
    value: "2026-04-30",
  },
  {
    name: "a date input with no label or name",
    html: '<input type="date">',
    value: "2026-04-30",
  },
  {
    name: "a datetime-local input with no label or name",
    html: '<input type="datetime-local">',
    value: "2026-04-30T00:00",
  },
  {
    name: "a text input named dueAt with no label",
    html: '<input type="text" name="dueAt">',
    value: "2026-04-30",
  },
];

describe("due-date form helper", () => {
  it("finds each accepted control and fills its native value", async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      for (const entry of CASES) {
        await page.setContent(entry.html);
        const input = dueDateInput(page);
        expect(await input.count(), entry.name).toBe(1);
        await fillDueDate(page, "2026-04-30");
        expect(await input.inputValue(), entry.name).toBe(entry.value);
      }
    } finally {
      await browser.close();
    }
  });
});
