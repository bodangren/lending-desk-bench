import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assessCandidateContract, WRITABLE_CANDIDATE_PATHS } from "../../candidate-contract";
import { canonicalPublicSurface } from "../../public-api";

const ROOT = resolve(import.meta.dirname, "../../..");
const FIXTURE = resolve(ROOT, "fixture");
const REFERENCE = resolve(ROOT, "reference");

const SPEC_NAMED_EXPORTS: Record<string, readonly string[]> = {
  "src/lib/loans.ts": ["computeLoanStatus"],
  "src/components/item-card.tsx": ["ItemCard"],
  "src/actions/loans.ts": ["checkoutItem", "returnItem"],
  "app/items/[id]/page.tsx": ["generateMetadata"],
  "app/items/[id]/checkout-form.tsx": ["CheckoutForm", "ReturnButton"],
  "app/api/loans/route.ts": ["GET", "POST", "PATCH", "dynamic"],
};

function copyFixture(parent: string): string {
  const candidate = resolve(parent, "candidate");
  cpSync(FIXTURE, candidate, {
    recursive: true,
    filter: (source) => {
      const name = basename(source);
      return ![".git", "node_modules", ".next"].includes(name) && !source.endsWith(".tsbuildinfo");
    },
  });
  return candidate;
}

/** Exported declaration names from the semantic public surface (single source of truth). */
function exportNames(path: string): string[] {
  const names: string[] = [];
  for (const entry of canonicalPublicSurface(path)) {
    if (entry.startsWith("type:") || entry.startsWith("interface:")) {
      names.push(entry.split(":")[1] ?? "");
    } else if (
      entry.startsWith("re-export:") ||
      entry.startsWith("export-assignment:") ||
      entry.startsWith("other:")
    ) {
      continue;
    } else {
      names.push(entry.split(":")[0] ?? "");
    }
  }
  return names.filter(Boolean).sort();
}

describe("candidate filesystem and public API contract", () => {
  it.each([
    "app/x/node_modules/evil.ts",
    "app/x/.next/evil.ts",
    "app/x/.git/evil.ts",
  ])("rejects nested runtime tree %s and includes it in the candidate identity hash", (nestedRuntimeFile) => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-nested-runtime-"));
    const candidate = copyFixture(temp);
    const baseline = assessCandidateContract(FIXTURE, candidate);
    try {
      expect(baseline.valid).toBe(true);
      const target = resolve(candidate, nestedRuntimeFile);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "export const attacker = true;\n");

      const contract = assessCandidateContract(FIXTURE, candidate);
      expect(contract.valid).toBe(false);
      expect(contract.candidate_sha256).not.toBe(baseline.candidate_sha256);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("explicitly rejects a root .git directory before any identity can be trusted", () => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-root-git-"));
    const candidate = copyFixture(temp);
    try {
      mkdirSync(resolve(candidate, ".git"));
      writeFileSync(resolve(candidate, ".git", "config"), "[core]\\nrepositoryformatversion = 0\\n");

      const contract = assessCandidateContract(FIXTURE, candidate);
      expect(contract.valid).toBe(false);
      expect(contract.reasons).toContain("candidate contains .git");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("makes the fixture expose every spec-named writable API, including ReturnButton, PATCH, and dynamic", () => {
    for (const [relativePath, expectedNames] of Object.entries(SPEC_NAMED_EXPORTS)) {
      expect(exportNames(resolve(FIXTURE, relativePath)), relativePath).toEqual(expect.arrayContaining(expectedNames));
    }
  });

  it("keeps the complete writable TypeScript public surface equal between fixture and reference", () => {
    const writableSourceFiles = WRITABLE_CANDIDATE_PATHS.filter((path) => /\.tsx?$/.test(path));
    for (const relativePath of writableSourceFiles) {
      expect(canonicalPublicSurface(resolve(FIXTURE, relativePath)), relativePath).toEqual(
        canonicalPublicSurface(resolve(REFERENCE, relativePath)),
      );
    }
  });

  it.each([
    {
      name: "type signature",
      relativePath: "src/actions/loans.ts",
      mutate: (source: string) => source.replace("itemId: string,", "itemId: number,"),
    },
    {
      name: "export name",
      relativePath: "src/actions/loans.ts",
      mutate: (source: string) => source.replace("returnItem", "returnLoan"),
    },
    {
      name: "dynamic configuration",
      relativePath: "app/api/loans/route.ts",
      mutate: (source: string) => source.replace("\"force-dynamic\"", "\"auto\""),
    },
    {
      name: "named re-export",
      relativePath: "src/actions/loans.ts",
      mutate: (source: string) => `${source}\nexport { checkoutItem as checkoutAlias };\n`,
    },
    {
      name: "star re-export",
      relativePath: "src/actions/loans.ts",
      mutate: (source: string) => `${source}\nexport * from "@/src/db";\n`,
    },
  ])("rejects writable candidate public %s drift", ({ relativePath, mutate }) => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-public-api-drift-"));
    const candidate = copyFixture(temp);
    const target = resolve(candidate, relativePath);
    const source = readFileSync(target, "utf8");
    try {
      const mutated = mutate(source);
      expect(mutated).not.toBe(source);
      writeFileSync(target, mutated);

      const contract = assessCandidateContract(FIXTURE, candidate);
      expect(contract.valid).toBe(false);
      expect(contract.reasons).toContain("candidate changed a writable public export or type signature");
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
