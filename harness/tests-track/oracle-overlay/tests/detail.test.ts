import { describe, expect, it } from "vitest";
import { STAFF_KEY } from "@/src/lib/auth";
import { seedItems, seedLoans, seedMembers } from "@/src/db/seed";

const site = process.env.BASE_URL ?? "http://127.0.0.1:3100";

async function load(path: string): Promise<string> {
  const response = await fetch(site + path, { cache: "no-store" });
  expect(response.ok, path).toBe(true);
  return response.text();
}

const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };
const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => entities[entity] ?? entity);

/** Rendered text only: no scripts (the flight payload), no member picker, no tags. */
function renderedText(html: string): string {
  return decode(html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<select[\s\S]*?<\/select>/g, " ")
    .replace(/<title>[\s\S]*?<\/title>/g, " ")
    .replace(/<[^>]+>/g, " "));
}

describe("item detail", () => {
  it("titles the page with the item name", async () => {
    for (const id of ["itm-001", "itm-016"]) {
      const item = seedItems.find((candidate) => candidate.id === id);
      const title = (await load(`/items/${id}`)).match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      expect(decode(title)).toBe(`${item?.name} — Lending Desk`);
    }
  });

  it("shows the name, category, and description", async () => {
    const text = renderedText(await load("/items/itm-001"));
    expect(text).toContain("Cordless Drill");
    expect(text).toContain("power-tool");
    expect(text).toContain("18V brushless drill with two batteries.");
  });

  it("lists the loan history newest first", async () => {
    const names = seedMembers.map((member) => member.name).sort((a, b) => b.length - a.length);
    const pattern = new RegExp(names.map((name) => name.replace(/ /g, "\\s+")).join("|"), "g");
    const shown = [...renderedText(await load("/items/itm-018")).matchAll(pattern)].map((match) => match[0].replace(/\s+/g, " "));
    const byId = new Map(seedMembers.map((member) => [member.id, member.name]));
    const expected = seedLoans
      .filter((loan) => loan.itemId === "itm-018")
      .sort((a, b) => Date.parse(b.borrowedAt) - Date.parse(a.borrowedAt))
      .map((loan) => byId.get(loan.memberId));
    expect(shown).toEqual(expected);
  });

  it("shows the status of an overdue loan", async () => {
    expect(renderedText(await load("/items/itm-003"))).toMatch(/\boverdue\b/i);
  });

  it("never sends the staff key to a browser", async () => {
    for (const path of ["/items", "/items/itm-001", "/items/itm-003"]) {
      expect(await load(path), path).not.toContain(STAFF_KEY);
    }
  });
});
