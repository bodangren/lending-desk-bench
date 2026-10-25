import { describe, expect, it } from "vitest";
import { seedItems, seedLoans } from "@/src/db/seed";

const origin = process.env.BASE_URL ?? "http://127.0.0.1:3100";

async function catalogue(query = ""): Promise<string> {
  const response = await fetch(`${origin}/items${query}`, { cache: "no-store" });
  expect(response.ok, `GET /items${query}`).toBe(true);
  return response.text();
}

/** Ids of the items the page links to. */
const linkedIds = (html: string) =>
  [...new Set([...html.matchAll(/href="\/items\/(itm-\d+)"/g)].map((match) => match[1]))].sort();

/** Visible text of the link to one item. */
function cardText(html: string, itemId: string): string {
  const link = html.match(new RegExp(`<a[^>]*href="/items/${itemId}"[^>]*>([\\s\\S]*?)</a>`));
  return (link?.[1] ?? "").replace(/<[^>]+>/g, " ");
}

describe("catalogue", () => {
  it("links every seeded item", async () => {
    expect(linkedIds(await catalogue())).toEqual(seedItems.map((item) => item.id).sort());
  });

  it("shows each item's availability", async () => {
    const html = await catalogue();
    const open = new Set(seedLoans.filter((loan) => loan.returnedAt === null).map((loan) => loan.itemId));
    for (const item of seedItems) {
      expect(cardText(html, item.id), item.id).toContain(open.has(item.id) ? "On loan" : "Available");
    }
  });

  it("filters by name case-insensitively, on both sides", async () => {
    expect(linkedIds(await catalogue("?q=tile%20cutter"))).toEqual(["itm-013", "itm-014"]);
    expect(linkedIds(await catalogue("?q=TILE%20CUTTER"))).toEqual(["itm-013", "itm-014"]);
  });

  it("matches the search text literally", async () => {
    expect(linkedIds(await catalogue(`?q=${encodeURIComponent("(150mm)")}`))).toEqual(["itm-015"]);
    const html = await catalogue(`?q=${encodeURIComponent(".*")}`);
    expect(linkedIds(html)).toEqual([]);
    expect(html).toContain("No items match your search.");
  });

  it("filters by category, alone and with a search", async () => {
    const safety = seedItems.filter((item) => item.category === "safety").map((item) => item.id).sort();
    expect(linkedIds(await catalogue("?category=safety"))).toEqual(safety);
    expect(linkedIds(await catalogue("?q=drill&category=power-tool"))).toEqual(["itm-001", "itm-012"]);
    expect(linkedIds(await catalogue("?q=drill&category=safety"))).toEqual([]);
  });
});
