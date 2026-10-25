import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateBugfixVariant, generateFromSetId, hashTreeOnDisk, writeVariant } from "../../bugfix/make-variant.js";
import { BUG_REGISTRY, registryHash } from "../../bugfix/registry.js";
import { setFileHash } from "../../bugfix/set-loader.js";
import { assessCandidateContract } from "../../candidate-contract.js";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("bugfix variant generation", () => {
  it("is deterministic for the same set", () => {
    const first = generateFromSetId("v1");
    const second = generateFromSetId("v1");
    expect(first.manifest.variant_sha256).toBe(second.manifest.variant_sha256);
    expect([...first.files.entries()]).toEqual([...second.files.entries()]);
  });

  it("binds the set, registry, and bug list in the manifest", () => {
    const { manifest } = generateFromSetId("v1");
    expect(manifest.track).toBe("bugfix");
    expect(manifest.bug_set_id).toBe("v1");
    expect(manifest.bug_set_sha256).toBe(setFileHash("v1").sha256);
    expect(manifest.registry_sha256).toBe(registryHash());
    expect(manifest.bugs).toHaveLength(11);
  });

  it("applies every seeded bug to the clean tree", () => {
    const clean = generateBugfixVariant({ bugs: [], setId: "clean", setSha256: "0".repeat(64) });
    const seeded = generateFromSetId("v1");
    expect(seeded.files.size).toBe(clean.files.size);
    const changed = new Set(
      [...seeded.files.keys()].filter((rel) => clean.files.get(rel) !== seeded.files.get(rel)),
    );
    expect(changed.size).toBeGreaterThan(0);
    // Every seeded bug's target file actually differs from the clean tree.
    const targets = new Set(
      seeded.manifest.bugs.map((id) => BUG_REGISTRY.find((entry) => entry.id === id)!.target),
    );
    for (const target of targets) {
      expect(changed.has(target), target).toBe(true);
    }
    expect(seeded.manifest.bugs).toHaveLength(11);
  });

  it("replaces the build Measure track and never leaks the completed plan", () => {
    const seeded = generateFromSetId("v1");
    expect([...seeded.files.keys()].some((rel) => rel.startsWith("measure/tracks/lending_desk/"))).toBe(false);
    expect(seeded.files.has("measure/tracks/lending_desk_bugfix/spec.md")).toBe(true);
    expect(seeded.files.has("AGENTS.md")).toBe(true);
    expect(seeded.files.get("AGENTS.md")).not.toContain("lending_desk/spec.md");
  });

  it("writes a tree whose on-disk hash matches the manifest", () => {
    const seeded = generateFromSetId("v1");
    const dir = mkdtempSync(join(tmpdir(), "bugfix-variant-"));
    try {
      writeVariant(seeded, dir);
      expect(existsSync(join(dir, "variant.json"))).toBe(false);
      expect(hashTreeOnDisk(dir)).toBe(seeded.manifest.variant_sha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the candidate contract variant-mode working", () => {
    const seeded = generateFromSetId("v1");
    const work = mkdtempSync(resolve(ROOT, "runs", "meta-bugfix-contract-"));
    try {
      const variantDir = join(work, "variant");
      writeVariant(seeded, variantDir);
      const candidate = join(work, "candidate");
      cpSync(variantDir, candidate, { recursive: true });
      // An untouched candidate satisfies the variant contract.
      const untouched = assessCandidateContract(variantDir, candidate, { track: "bugfix" });
      expect(untouched.valid).toBe(true);
      // A clean reference fix (the reference nine files) also satisfies it.
      for (const rel of [
        "src/lib/loans.ts",
        "src/components/item-card.tsx",
        "src/actions/loans.ts",
        "app/items/page.tsx",
        "app/items/[id]/page.tsx",
        "app/items/[id]/checkout-form.tsx",
        "app/api/loans/route.ts",
        "app/items/loading.tsx",
        "app/items/error.tsx",
      ]) {
        writeFileSync(join(candidate, rel), readFileSync(join(ROOT, "reference", rel), "utf8"));
      }
      const repaired = assessCandidateContract(variantDir, candidate, { track: "bugfix" });
      expect(repaired.valid).toBe(true);
      // A protected-file edit is still rejected in variant mode.
      writeFileSync(join(candidate, "src/db/index.ts"), readFileSync(join(candidate, "src/db/index.ts"), "utf8") + "\n// tamper\n");
      const tampered = assessCandidateContract(variantDir, candidate, { track: "bugfix" });
      expect(tampered.valid).toBe(false);
      expect(tampered.reasons).toContain("candidate modified protected fixture files");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 120_000);
});
