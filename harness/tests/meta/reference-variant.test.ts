import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WRITABLE_CANDIDATE_PATHS } from "../../candidate-contract.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const VARIANT = resolve(ROOT, "reference-variant");
const REFERENCE = resolve(ROOT, "reference");

function files(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return files(root, path);
    return entry.isFile() ? [relative(root, path)] : [];
  }).sort();
}

function source(path: string): string {
  return readFileSync(resolve(VARIANT, path), "utf8");
}

describe("reference variant self-check", () => {
  it("grades the variant through run.sh only in full self-check mode", () => {
    const batch = readFileSync(resolve(ROOT, "harness/batch.sh"), "utf8");
    const start = batch.indexOf("# ---- Harness self-check");
    const end = batch.indexOf("# ---- Executor preflight");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const selfCheck = batch.slice(start, end);
    const fullStart = selfCheck.indexOf('if [ "$SELFCHECK" = full ]; then');
    expect(fullStart).toBeGreaterThanOrEqual(0);
    expect(selfCheck.slice(0, fullStart), "default meta mode must not pay for a variant grade")
      .not.toContain("reference-variant");

    const fullBlock = selfCheck.slice(fullStart, selfCheck.indexOf('echo "SELF-CHECK PASS"'));
    expect(fullBlock).toMatch(
      /AGENT_SKIP=1\s+OVERLAY="\$PWD\/\.\.\/reference-variant"[\s\S]*?\.\/run\.sh local reference-variant a/,
    );
    expect(fullBlock).toContain("s.valid===true && s.total===100");
  });

  it("holds exactly the writable task files and differs from the reference", () => {
    expect(files(VARIANT)).toEqual([...WRITABLE_CANDIDATE_PATHS].sort());
    for (const path of WRITABLE_CANDIDATE_PATHS) {
      expect(source(path), `${path} must exercise a different implementation`)
        .not.toBe(readFileSync(resolve(REFERENCE, path), "utf8"));
    }
  });

  it("keeps the required incidental choices in the variant", () => {
    const form = source("app/items/[id]/checkout-form.tsx");
    expect(form).toContain('type="datetime-local"');
    expect(form).not.toContain("Select a member");
    expect(form).toContain("localeCompare");

    for (const path of ["app/items/page.tsx", "app/items/loading.tsx"]) {
      expect(source(path)).toMatch(/<h1[^>]*>\s*<span>Items<\/span>\s*<\/h1>/);
    }
    expect(source("app/items/page.tsx")).toMatch(
      /Promise\.all\(\[[\s\S]*?listItems\(\)[\s\S]*?listCategories\(\)/,
    );

    const card = source("src/components/item-card.tsx");
    expect(card.indexOf('"Available"')).toBeLessThan(card.indexOf("<Image"));
    expect(card.indexOf("<Image")).toBeLessThan(card.indexOf("<h3"));
  });
});
