/** Boundary tests for the Phase 5 review preview and publish path. */
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");
const SOURCE = join(HARNESS, "model-guide");
const FIXTURE_B = join(import.meta.dirname, "fixtures", "page-b");
const DATE = "2026-10-20";
const MANIFEST = `MANIFEST-${DATE}.txt`;
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function temp(tag: string): string {
  const root = mkdtempSync(join(tmpdir(), `model-guide-p5-${tag}-`));
  roots.push(root);
  return root;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function repo(tag: string): string {
  const root = temp(tag);
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), {
    recursive: true,
    // The real approval record stays out of every fixture; a case that
    // needs consent writes its own record after the copy.
    filter: (source) => !source.endsWith("publish-approval.md"),
  });
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"), "dir");
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"), "<!doctype html><html><body>synthetic</body></html>\n");
  writeFileSync(join(root, "docs", "assets", "css", "site.css"), "body{}\n");
  writeFileSync(join(root, "docs", "assets", "data", "benchmark.json"), '{"schema":1}\n');
  mkdirSync(join(root, "measure", "tracks", "model_guide"), { recursive: true });
  const staged = join(root, "fixture-b");
  mkdirSync(staged, { recursive: true });
  for (const name of [MANIFEST, `ra-outcomes-${DATE}.json`, `aa-reliability-${DATE}.json`, `allowed-routes-${DATE}.json`]) {
    cpSync(join(FIXTURE_B, name), join(staged, name));
  }
  return root;
}

function previewPath(root: string): string {
  return join(root, ".tmp", "model-guide-preview");
}

function runPreview(root: string) {
  return spawnSync(
    "bash",
    [join(root, "harness", "model-guide", "preview.sh"), "--manifest", join(root, "fixture-b", MANIFEST),
      "--preview", previewPath(root)],
    { cwd: root, env: { ...process.env, NO_COLOR: "1", TZ: "UTC" }, encoding: "utf8", timeout: 120_000 },
  );
}

function writeScore(root: string, routes: any[], passes: any[]): void {
  const dir = join(root, "harness", "model-guide", "data", "review-scores");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mg-2026-11a.json"), JSON.stringify({
    set_id: "mg-2026-11a", passes, routes,
  }, null, 2) + "\n");
  const setDir = join(root, "harness", "model-guide", "data", "sets");
  mkdirSync(setDir, { recursive: true });
  writeFileSync(join(setDir, "mg-2026-11a.json"), JSON.stringify({
    set_id: "mg-2026-11a", diffs: [], plant_counts: { by_severity: { blocker: 0 } },
  }) + "\n");
}

function emptyPass(route: string): any {
  const byClass = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
    `C${index + 1}`, { found: 0, missed: 0 },
  ]));
  return {
    route, pass: 1, date: "2026-11-22", state: "complete", score: 0,
    false_claims: 0, real_defects: 0,
    by_class: byClass,
    by_severity: { blocker: { found: 0, missed: 0 }, major: { found: 0, missed: 0 }, minor: { found: 0, missed: 0 } },
  };
}

function approval(root: string, rows: Array<[string, string]>): void {
  const text = [
    "approved_by: synthetic owner", "date: 2026-11-22", "files:",
    ...rows.map(([hash, path]) => `${hash}  ${path}`), "",
  ].join("\n");
  // Both paths: the stable path the tools read (after the harness copy, so
  // the fixture rows win over any copied real record) and the old track
  // path the previous contract used.
  writeFileSync(join(root, "harness", "model-guide", "publish-approval.md"), text);
  writeFileSync(join(root, "measure", "tracks", "model_guide", "publish-approval.md"), text);
}

function runPublish(root: string) {
  return spawnSync(
    join(root, "harness", "node_modules", ".bin", "tsx"),
    ["model-guide/publish.ts", "--preview", previewPath(root)],
    { cwd: join(root, "harness"), env: { ...process.env, NO_COLOR: "1" }, encoding: "utf8", timeout: 60_000 },
  );
}

describe("Phase 5 adversarial preview and publish boundaries", () => {
  it("shows real zero counts for a route with a pass, not zero-pass dashes", () => {
    const root = repo("real-zero");
    const route = "route/real-zero";
    const pass = emptyPass(route);
    writeScore(root, [{
      route, state: "incomplete", passes: [pass], worst: 0, median: 0, best: 0,
      worst_blocker_recall: 0, rank: null,
    }], [pass]);
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const html = readFileSync(join(previewPath(root), "review.html"), "utf8");
    expect(html).toContain('data-route="route/real-zero" data-class="C1"><td>C1</td><td class="num">0</td><td class="num">0</td>');
    expect(html).toContain('data-route="route/real-zero" data-severity="blocker"><td>blocker</td><td class="num">0</td><td class="num">0</td>');
    expect(html).toContain('data-mg="review-false-claims">0</td>');
    expect(html).toContain('data-mg="review-real-defects">0</td>');
  });

  it("renders an open hostile route as escaped text and does not render its internal reason", () => {
    const root = repo("hostile-open");
    const route = `bad"><br><script>alert(1)</script>`;
    const reason = `never publish <img src=x onerror=alert(1)> sk-live-secret-looking`;
    writeScore(root, [{
      route, state: "incomplete", passes: [], worst: null, median: null, best: null,
      worst_blocker_recall: null, rank: null, incomplete_reason: reason,
    }], []);
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const html = readFileSync(join(previewPath(root), "review.html"), "utf8");
    expect(html).toContain("bad&quot;&gt;&lt;br&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain('<span class="mark">incomplete: 0 of 3 passes</span>');
    expect(html).not.toContain("<br><script>");
    expect(html).not.toContain("sk-live-secret-looking");
    expect(html).not.toContain("&lt;img");
  });

  it("overwrites a stale nested review.json mirror during a preview rebuild", () => {
    const root = repo("stale-mirror");
    const empty = { set_id: "mg-2026-11a", passes: [], routes: [] };
    writeScore(root, [], []);
    const stale = join(previewPath(root), "assets", "data");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "review.json"), '{"stale":true}\n');
    const result = runPreview(root);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const rootCopy = join(previewPath(root), "review.json");
    expect(existsSync(rootCopy)).toBe(true);
    expect(sha256(join(stale, "review.json"))).toBe(sha256(rootCopy));
    expect(readFileSync(join(stale, "review.json"), "utf8")).toBe(JSON.stringify(empty, null, 2) + "\n");
  });

  it.each(["assets/data/../x", "assets/data"])("refuses an unsafe or folder approval path %s without docs writes", (path) => {
    const root = repo("bad-approval-path");
    writeScore(root, [], []);
    const built = runPreview(root);
    expect(built.status, `${built.stdout}\n${built.stderr}`).toBe(0);
    approval(root, [["0".repeat(64), path]]);
    const before = readFileSync(join(root, "docs", "index.html"), "utf8");
    const result = runPublish(root);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain(`publish: bad path ${path}`);
    expect(readFileSync(join(root, "docs", "index.html"), "utf8")).toBe(before);
  });
});
