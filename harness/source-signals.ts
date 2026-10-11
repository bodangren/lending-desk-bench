/**
 * Deterministic source-quality signals for Axis 3.
 *
 * react-doctor 0.9.2 reports zero diagnostics on every candidate in this benchmark,
 * with linting and dead-code analysis both enabled — the tool has no resolution on a
 * twelve-file Next.js slice. That made `quality` an exact copy of `completion`.
 * These rules restore resolution. They are cheap, local, and deterministic, and they
 * emit the same Diagnostic shape as the doctor report, so the existing penalty and
 * baseline arithmetic is unchanged.
 *
 * Only the writable candidate paths are scanned. Protected fixture files hold the
 * same bytes for every candidate, so scanning them would add a constant to every
 * score.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WRITABLE_CANDIDATE_PATHS } from "./candidate-contract.js";

export type SourceDiagnostic = {
  rule: string;
  severity: "error" | "warning";
  category: string;
  filePath: string;
  line?: number;
};

/** Rule table. Category names match CATEGORY_WEIGHT in doctor.ts. */
const RULES = {
  "ts-suppression": { severity: "error", category: "Bugs" },
  "non-null-assertion": { severity: "warning", category: "Bugs" },
  "explicit-any": { severity: "warning", category: "Maintainability" },
  "eslint-disable": { severity: "warning", category: "Maintainability" },
  "unused-import": { severity: "warning", category: "Maintainability" },
  "leftover-todo": { severity: "warning", category: "Maintainability" },
  "console-statement": { severity: "warning", category: "Maintainability" },
  "duplicate-block": { severity: "warning", category: "Maintainability" },
} as const;

type RuleName = keyof typeof RULES;

function diagnostic(rule: RuleName, filePath: string, line: number): SourceDiagnostic {
  const spec = RULES[rule];
  return { rule, severity: spec.severity, category: spec.category, filePath, line };
}

/**
 * Replace comment bodies and string contents with spaces, keeping every byte offset
 * and newline. Code rules then cannot match prose, and comment rules run against the
 * original text.
 */
export function blankNonCode(source: string): string {
  const out = source.split("");
  const n = source.length;
  let i = 0;
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
      if (c === "/" && next === "*") { state = "block"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
      if (c === "'") { state = "single"; i += 1; continue; }
      if (c === '"') { state = "double"; i += 1; continue; }
      if (c === "`") { state = "template"; i += 1; continue; }
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; i += 1; continue; }
      out[i] = " ";
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") { state = "code"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
      if (c !== "\n") out[i] = " ";
      i += 1;
      continue;
    }
    if (c === "\\") {
      out[i] = " ";
      if (i + 1 < n && source[i + 1] !== "\n") out[i + 1] = " ";
      i += 2;
      continue;
    }
    if ((state === "single" && c === "'") || (state === "double" && c === '"') || (state === "template" && c === "`")) {
      state = "code";
      i += 1;
      continue;
    }
    if (c !== "\n") out[i] = " ";
    i += 1;
  }
  return out.join("");
}

const ANY_PATTERNS: RegExp[] = [
  /:\s*any\b/g,
  /\bas\s+any\b/g,
  /<\s*any\s*>/g,
  /\bany\s*\[\s*\]/g,
];

/** `x!.y`, `x!)`, `x!;` — never `!=` and never a leading logical not. */
const NON_NULL = /[A-Za-z0-9_)\]]!(?=\s*[.;,)\]])/g;
const CONSOLE = /\bconsole\s*\.\s*(?:log|debug|info|warn|error|table|dir)\s*\(/g;
const TS_SUPPRESSION = /@ts-(?:ignore|expect-error|nocheck)\b/g;
const ESLINT_DISABLE = /eslint-disable(?:-next-line|-line)?\b/g;
const TODO = /\b(?:TODO|FIXME|XXX|HACK)\b/g;

function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === "\n") line += 1;
  return line;
}

function collect(
  source: string,
  pattern: RegExp,
  rule: RuleName,
  filePath: string,
  out: SourceDiagnostic[],
): void {
  for (const match of source.matchAll(pattern)) {
    out.push(diagnostic(rule, filePath, lineOf(source, match.index ?? 0)));
  }
}

/** Imported bindings that never appear again in the file body. */
function unusedImports(code: string, filePath: string): SourceDiagnostic[] {
  const found: SourceDiagnostic[] = [];
  for (const statement of code.matchAll(/import\s+([\s\S]*?)\s+from\s/g)) {
    const clause = statement[1];
    if (!clause || clause.trim().startsWith("type ")) continue;
    const bindings: string[] = [];
    const braced = clause.match(/\{([\s\S]*?)\}/);
    if (braced) {
      for (const part of braced[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) bindings.push(name);
      }
    }
    const defaultBinding = clause.replace(/\{[\s\S]*?\}/, "").replace(/^\s*,|,\s*$/g, "").trim();
    if (/^[A-Za-z_$][\w$]*$/.test(defaultBinding)) bindings.push(defaultBinding);

    const bodyStart = (statement.index ?? 0) + statement[0].length;
    const body = code.slice(bodyStart);
    for (const name of bindings) {
      if (!new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(body)) {
        found.push(diagnostic("unused-import", filePath, lineOf(code, statement.index ?? 0)));
      }
    }
  }
  return found;
}

const DUPLICATE_WINDOW = 5;

/** Identical five-line runs repeated across the writable set. */
function duplicateBlocks(files: { path: string; code: string }[]): SourceDiagnostic[] {
  const seen = new Set<string>();
  const found: SourceDiagnostic[] = [];
  for (const file of files) {
    const lines = file.code.split("\n").map((line) => line.trim().replace(/\s+/g, " "));
    for (let i = 0; i + DUPLICATE_WINDOW <= lines.length; i += 1) {
      const window = lines.slice(i, i + DUPLICATE_WINDOW);
      // Runs of closing braces repeat everywhere, so require real content on every line.
      if (window.filter((line) => line.length > 12).length < DUPLICATE_WINDOW) continue;
      const key = window.join(" ");
      if (seen.has(key)) {
        found.push(diagnostic("duplicate-block", file.path, i + 1));
        continue;
      }
      seen.add(key);
    }
  }
  return found;
}

export function scanSourceSignals(
  dir: string,
  writablePaths: readonly string[] = WRITABLE_CANDIDATE_PATHS,
): SourceDiagnostic[] {
  const diagnostics: SourceDiagnostic[] = [];
  const codeFiles: { path: string; code: string }[] = [];

  for (const rel of writablePaths) {
    if (!/\.tsx?$/.test(rel)) continue;
    const absolute = join(dir, rel);
    if (!existsSync(absolute)) continue;
    let source: string;
    try {
      source = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }

    // Comment rules read the original text.
    collect(source, TS_SUPPRESSION, "ts-suppression", rel, diagnostics);
    collect(source, ESLINT_DISABLE, "eslint-disable", rel, diagnostics);
    collect(source, TODO, "leftover-todo", rel, diagnostics);

    // Code rules read the text with comments and string bodies blanked out.
    const code = blankNonCode(source);
    for (const pattern of ANY_PATTERNS) collect(code, pattern, "explicit-any", rel, diagnostics);
    collect(code, NON_NULL, "non-null-assertion", rel, diagnostics);
    collect(code, CONSOLE, "console-statement", rel, diagnostics);
    diagnostics.push(...unusedImports(code, rel));
    codeFiles.push({ path: rel, code });
  }

  diagnostics.push(...duplicateBlocks(codeFiles));
  diagnostics.sort((a, b) =>
    a.filePath === b.filePath
      ? (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule)
      : a.filePath.localeCompare(b.filePath));
  return diagnostics;
}

if (process.argv[1]?.endsWith("source-signals.ts")) {
  console.log(JSON.stringify(scanSourceSignals(process.argv[2] ?? "."), null, 2));
}
