/**
 * Standing rules for a frozen board row. Vitest, pure logic.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boardStanding, BOARD_FROZEN_NOTE } from "../../../docs/assets/js/site.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// The published board date. Its ISO week is 2026w47.
const BOARD_NOW = "2026-11-16T13:26:29";
// A date in the next ISO year. Its ISO week is 2027w01.
const NEXT_YEAR = "2027-01-05T00:00:00";

const FROZEN_NOTE =
  "This board is frozen. The current task no longer separates the top models. A harder test on real code from our own repositories will replace it.";

describe("boardStanding", () => {
  it("ranks a fresh, repeated row", () => {
    expect(boardStanding({ week: "2026w47", n: 3 }, BOARD_NOW)).toEqual({
      provisional: false,
      reason: "",
    });
    // two weeks old is still inside the window
    expect(boardStanding({ week: "2026w45", n: 3 }, BOARD_NOW)).toEqual({
      provisional: false,
      reason: "",
    });
  });

  it("marks an old row provisional", () => {
    expect(boardStanding({ week: "2026w44", n: 3 }, BOARD_NOW).provisional).toBe(true);
  });

  it("marks a single run provisional", () => {
    const standing = boardStanding({ week: "2026w47", n: 1 }, BOARD_NOW);
    expect(standing.provisional).toBe(true);
    expect(standing.reason).toContain("1 run");
  });

  it("marks a row without repeats provisional", () => {
    expect(boardStanding(undefined, BOARD_NOW).provisional).toBe(true);
  });

  it("marks a bad week text provisional", () => {
    const standing = boardStanding({ week: "bad", n: 3 }, BOARD_NOW);
    expect(standing.provisional).toBe(true);
    expect(standing.reason).toBe("no run week");
  });

  it("handles the ISO year boundary", () => {
    // 2026 has 53 ISO weeks
    expect(boardStanding({ week: "2026w53", n: 3 }, NEXT_YEAR).provisional).toBe(false);
    expect(boardStanding({ week: "2026w52", n: 3 }, NEXT_YEAR).provisional).toBe(false);
    expect(boardStanding({ week: "2026w51", n: 3 }, NEXT_YEAR).provisional).toBe(true);
  });

  it("marks the four frozen rows of the published board", () => {
    const data = JSON.parse(
      readFileSync(resolve(ROOT, "docs/assets/data/benchmark.json"), "utf8"),
    );
    const provisional = data.models
      .filter((m: { id: string; repeats?: { week: string; n: number } }) =>
        boardStanding(m.repeats, data.generated_at).provisional,
      )
      .map((m: { id: string }) => m.id)
      .sort();
    expect(provisional).toEqual([
      "claude-haiku-5-5",
      "deepseek-v4.1-flash",
      "gpt-6-luna",
      "minimax-m3.1-flash",
    ]);
  });
});

describe("BOARD_FROZEN_NOTE", () => {
  it("keeps the frozen note exact", () => {
    expect(BOARD_FROZEN_NOTE).toBe(FROZEN_NOTE);
  });

  it("is imported by both pages", () => {
    for (const page of ["docs/results.html", "docs/index.html"]) {
      const html = readFileSync(resolve(ROOT, page), "utf8");
      expect(html).toContain("boardStanding");
      expect(html).toContain("BOARD_FROZEN_NOTE");
    }
  });
});
