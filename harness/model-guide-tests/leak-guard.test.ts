import { lstatSync, readFileSync, readlinkSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Red test for plan task 1.10: the Phase 1 test folder leak guard.
 *
 * The guard scans every file under `harness/model-guide-tests/`.
 * It rejects the hand-off path context and the real export SHA-256.
 * Each needle is built from two parts, so this file does not match itself.
 *
 * A symlink entry resolves to its target text when the target is a plain
 * file, and the match ignores letter case (ADV-12, ADV-13).
 *
 * The test reads only committed test files and synthetic fixtures.
 */

const TEST_DIR = resolve(import.meta.dirname);
const HANDOFF_NEEDLE = ["hand", "off/real-work-outcomes"].join("");
const EXPORT_SHA_NEEDLE = [
  "dae855cad4bcd29b0623d8a0b8d4eb7",
  "5aa16a7ddd6688455735bf312df5464f2",
].join("");

interface Entry {
  rel: string;
  text: string;
}

function filesUnder(dir: string, prefix = ""): Entry[] {
  const out: Entry[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const info = lstatSync(full);
    if (info.isDirectory()) out.push(...filesUnder(full, rel));
    else if (info.isSymbolicLink()) {
      // ADV-12: the link line is scan text, never a path. A plain-file
      // target is read in place; a dangling or unreadable link scans the
      // link line only.
      const linkText = `link ${rel} ${readlinkSync(full)}`;
      let text = linkText;
      try {
        if (statSync(full).isFile()) text = `${linkText}\n${readFileSync(full, "utf8")}`;
      } catch {
        // keep the link line as the scan text
      }
      out.push({ rel, text });
    } else out.push({ rel, text: readFileSync(full, "utf8") });
  }
  return out;
}

function hits(needle: string): string[] {
  const lower = needle.toLowerCase();
  const found: string[] = [];
  for (const { rel, text } of filesUnder(TEST_DIR)) {
    // ADV-13: compare in lower case, so letter case hides no needle.
    if (text.toLowerCase().includes(lower)) found.push(rel);
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
