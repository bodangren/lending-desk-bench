import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assessCandidateContract, WRITABLE_CANDIDATE_PATHS } from "../../candidate-contract";
import { canonicalPublicSurface } from "../../public-api";

const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");
const FIXTURE = resolve(ROOT, "fixture");
const REFERENCE = resolve(ROOT, "reference");
const WRITABLE_TYPESCRIPT_PATHS = WRITABLE_CANDIDATE_PATHS.filter((path) => /\.tsx?$/.test(path));

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

function withCandidate(
  mutate: (candidate: string) => void,
  assertion: (candidate: string) => void,
): void {
  const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-semantic-api-"));
  const candidate = copyFixture(temp);
  try {
    mutate(candidate);
    assertion(candidate);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function expectPublicContractRejected(candidate: string): void {
  const contract = assessCandidateContract(FIXTURE, candidate);
  expect(contract.valid).toBe(false);
  expect(contract.reasons).toContain("candidate changed a writable public export or type signature");
}

function expectCompilerSuppressionRejected(candidate: string): void {
  const contract = assessCandidateContract(FIXTURE, candidate);
  expect(contract.valid).toBe(false);
  expect(contract.reasons).toContain("candidate contains a TypeScript compiler suppression");
}

function sourceSurface(temp: string, name: string, text: string): string[] {
  const path = resolve(temp, name);
  writeFileSync(path, text);
  return canonicalPublicSurface(path);
}

describe("semantic writable public API protection", () => {
  it("keeps public-api inspection in the runner provenance hash", () => {
    expect(readFileSync(resolve(HARNESS, "provenance.ts"), "utf8")).toContain("harness/public-api.ts");
  });
  it("preserves the valid fixture/reference public contract without compiler suppressions", () => {
    withCandidate(
      () => undefined,
      (candidate) => {
        expect(assessCandidateContract(FIXTURE, candidate).valid).toBe(true);
        for (const relativePath of WRITABLE_TYPESCRIPT_PATHS) {
          const fixtureSource = readFileSync(resolve(FIXTURE, relativePath), "utf8");
          const referenceSource = readFileSync(resolve(REFERENCE, relativePath), "utf8");
          expect(fixtureSource, relativePath).not.toMatch(/@ts-(?:no)?check|@ts-ignore/i);
          expect(referenceSource, relativePath).not.toMatch(/@ts-(?:no)?check|@ts-ignore/i);
          expect(canonicalPublicSurface(resolve(FIXTURE, relativePath)), relativePath)
            .toEqual(canonicalPublicSurface(resolve(REFERENCE, relativePath)));
        }
      },
    );
  });

  it("rejects a private alias that changes an imported exported-signature type without changing its spelling", () => {
    withCandidate(
      (candidate) => {
        const path = resolve(candidate, "src/lib/loans.ts");
        const source = readFileSync(path, "utf8");
        const mutated = source.replace(
          'import type { Loan, LoanStatus } from "@/src/db/schema";\n',
          'import type { Loan as SchemaLoan, LoanStatus } from "@/src/db/schema";\n\ntype Loan = Omit<SchemaLoan, "id">;\n',
        );
        expect(mutated).not.toBe(source);
        writeFileSync(path, mutated);
      },
      expectPublicContractRejected,
    );
  });

  it("rejects removal of async from an exported action even when its written return type is unchanged", () => {
    withCandidate(
      (candidate) => {
        const path = resolve(candidate, "src/actions/loans.ts");
        const source = readFileSync(path, "utf8");
        const mutated = source.replace("export async function checkoutItem", "export function checkoutItem");
        expect(mutated).not.toBe(source);
        writeFileSync(path, mutated);
      },
      expectPublicContractRejected,
    );
  });

  it.each([
    {
      name: "generator modifier",
      fixture: "export function* entries(): Generator<number> { yield 1; }\n",
      candidate: "export function entries(): Generator<number> { return {} as Generator<number>; }\n",
    },
    {
      name: "export default versus export assignment route",
      fixture: "const route = () => 200;\nexport default route;\n",
      candidate: "const route = () => 200;\nexport = route;\n",
    },
  ])("distinguishes public %s semantics", ({ fixture, candidate }) => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-semantic-surface-"));
    try {
      expect(sourceSurface(temp, "fixture.ts", fixture)).not.toEqual(sourceSurface(temp, "candidate.ts", candidate));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("rejects declaration-kind drift from exported const to let", () => {
    withCandidate(
      (candidate) => {
        const path = resolve(candidate, "app/api/loans/route.ts");
        const source = readFileSync(path, "utf8");
        const mutated = source.replace('export const dynamic = "force-dynamic";', 'export let dynamic = "force-dynamic";');
        expect(mutated).not.toBe(source);
        writeFileSync(path, mutated);
      },
      expectPublicContractRejected,
    );
  });

  it.each(WRITABLE_TYPESCRIPT_PATHS.flatMap((relativePath) => [
    { relativePath, directive: "@ts-nocheck" },
    { relativePath, directive: "@ts-ignore" },
    { relativePath, directive: "@ts-expect-error" },
  ]))("rejects $directive in writable $relativePath", ({ relativePath, directive }) => {
    withCandidate(
      (candidate) => {
        const path = resolve(candidate, relativePath);
        writeFileSync(path, `// ${directive}\n${readFileSync(path, "utf8")}`);
      },
      expectCompilerSuppressionRejected,
    );
  });
});
