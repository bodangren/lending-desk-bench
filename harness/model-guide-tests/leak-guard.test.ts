import { lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Red test for plan task 1.10: the Phase 1 test folder leak guard.
 *
 * The guard scans every file under `harness/model-guide-tests/`.
 * It rejects the hand-off path context and the real export SHA-256.
 * Each needle is built from two parts, so this file does not match itself.
 *
 * The test reads only committed test files and synthetic fixtures.
 */

const TEST_DIR = resolve(import.meta.dirname);
const HANDOFF_NEEDLE = ["hand", "off/real-work-outcomes"].join("");
const EXPORT_SHA_NEEDLE = [
  "dae855cad4bcd29b0623d8a0b8d4eb7",
  "5aa16a7ddd6688455735bf312df5464f2",
].join("");

function filesUnder(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const info = lstatSync(full);
    if (info.isDirectory()) out.push(...filesUnder(full, rel));
    else if (info.isSymbolicLink()) out.push(`link ${rel} ${readlinkSync(full)}`);
    else out.push(rel);
  }
  return out;
}

function hits(needle: string): string[] {
  const found: string[] = [];
  for (const rel of filesUnder(TEST_DIR)) {
    const text = readFileSync(join(TEST_DIR, rel), "utf8");
    if (text.includes(needle)) found.push(rel);
  }
  return found;
}

describe("the model-guide test folder leak guard", () => {
  it("B3 holds no hand-off path context", () => {
    expect(hits(HANDOFF_NEEDLE)).toEqual([]);
  });

  it("B3 holds no real export SHA-256", () => {
    expect(hits(EXPORT_SHA_NEEDLE)).toEqual([]);
  });
});
