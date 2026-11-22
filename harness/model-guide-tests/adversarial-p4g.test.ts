/** Offline boundary tests for the Sol seat, score rows, and quota dispatch. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");
const FIXTURE_SET = join(import.meta.dirname, "fixtures/review/sets/mg-2026-11a");
const FIXTURE_OUTPUTS = join(import.meta.dirname, "fixtures/review/outputs");
const SET = "mg-2026-11a";
const DIFF_IDS = [
  "forge-01", "forge-02", "forge-03", "forge-04", "forge-05", "forge-06", "forge-c1",
  "mono-01", "mono-02", "mono-03", "mono-04", "mono-05", "mono-06", "mono-c1",
];
const roots: string[] = [];
let privateRoot: string | undefined;

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function temp(tag: string): string {
  const path = mkdtempSync(join(tmpdir(), `model-guide-p4g-${tag}-`));
  roots.push(path);
  return path;
}

function privateDir(): string {
  if (!privateRoot) {
    privateRoot = temp("private");
    mkdirSync(join(privateRoot, "sets"), { recursive: true });
    cpSync(FIXTURE_SET, join(privateRoot, "sets", SET), { recursive: true });
  }
  return privateRoot;
}

function outputs(first?: string): string {
  const dir = temp("outputs");
  for (const id of DIFF_IDS) writeFileSync(
    join(dir, `${id}.txt`),
    id === "forge-01" && first ? first : "```json\n{\"findings\": []}\n```\n",
  );
  return dir;
}

function runScore(tag: string, route: string, pass: number, pilotFile: string, reason: string) {
  const scores = temp(`scores-${tag}`);
  const home = temp(`home-${tag}`);
  const args = [
    "model-guide/review-score.ts", "score", "--private", privateDir(), "--set", SET,
    "--route", route, "--pass", String(pass), "--date", "2026-11-22",
    "--outputs", outputs(), "--scores", scores, "--pilot-routes", pilotFile,
    "--incomplete-reason", reason,
  ];
  const env = { ...process.env, HOME: home, TZ: "UTC", NO_COLOR: "1", npm_config_loglevel: "silent" };
  delete (env as NodeJS.ProcessEnv).BENCH_TRACK;
  const result = spawnSync(join(HARNESS, "node_modules/.bin/tsx"), args, {
    cwd: HARNESS, env, encoding: "utf8", timeout: 60_000,
  });
  const path = join(scores, `${SET}.json`);
  return { result, doc: existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null };
}

describe("Phase 4b adversarial score and quota edges", () => {
  it("deduplicates pilot routes, preserves a route with a pass, and adds an unrun hostile route once", () => {
    const escapedRoute = `hostile\"><script>alert(1)</script>\n雪`;
    const pilot = temp("pilot");
    const pilotFile = join(pilot, "routes.json");
    writeFileSync(pilotFile, JSON.stringify([
      { route: "route/with-pass" }, { route: "route/with-pass" },
      { route: escapedRoute }, { route: escapedRoute }, { route: "route/not-in-pilot-source" },
    ]));
    const reason = `night 1\n<svg onload=alert(1)>\"&\u2603`;
    const { result, doc } = runScore("pilot-edges", "route/with-pass", 1, pilotFile, reason);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(doc).not.toBeNull();
    const withPass = doc.routes.filter((item: any) => item.route === "route/with-pass");
    expect(withPass).toHaveLength(1);
    expect(withPass[0].passes).toHaveLength(1);
    const hostile = doc.routes.filter((item: any) => item.route === escapedRoute);
    expect(hostile).toHaveLength(1);
    expect(hostile[0]).toMatchObject({ state: "incomplete", passes: [], rank: null, incomplete_reason: reason });
    expect(doc.routes.some((item: any) => item.route === "route/not-in-pilot-source")).toBe(true);
  });

  it("uses the provisional pass as a completed run for the three-pass threshold", () => {
    const pilot = temp("pilot-threshold");
    const pilotFile = join(pilot, "routes.json");
    writeFileSync(pilotFile, JSON.stringify([{ route: "route/provisional" }]));
    const reason = "one run left open";
    const key = JSON.parse(readFileSync(join(FIXTURE_SET, "keys/forge-01.json"), "utf8"));
    const plant = key.plants[0];
    const claim = {
      file: plant.file, line: 60, severity: "major", class: "C2",
      title: "defect", reason: "the call returns success",
    };
    const canonical = JSON.stringify([
      "forge-01", claim.file, claim.line, claim.class, claim.severity, claim.title, claim.reason,
    ]);
    const claimId = `forge-01#C${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
    const outputDir = outputs(`\`\`\`json\n${JSON.stringify({ findings: [claim] })}\n\`\`\`\n`);
    const scores = temp("scores-threshold");
    const home = temp("home-threshold");
    const scoreArgs = (pass: number, unclear: boolean) => {
      const args = ["model-guide/review-score.ts", "score", "--private", privateDir(), "--set", SET,
        "--route", "route/provisional", "--pass", String(pass), "--date", "2026-11-22",
        "--outputs", outputDir, "--scores", scores, "--pilot-routes", pilotFile, "--incomplete-reason", reason];
      if (unclear) {
        const verdicts = join(temp(`verdicts-${pass}`), "verdicts.json");
        writeFileSync(verdicts, JSON.stringify({ [claimId]: "unclear" }));
        args.push("--verdicts", verdicts);
      }
      return spawnSync(join(HARNESS, "node_modules/.bin/tsx"), args, {
        cwd: HARNESS, env: { ...process.env, HOME: home, TZ: "UTC", NO_COLOR: "1" }, encoding: "utf8", timeout: 60_000,
      });
    };
    for (const pass of [1, 2, 3]) expect(scoreArgs(pass, pass === 2).status).toBe(0);
    const doc = JSON.parse(readFileSync(join(scores, `${SET}.json`), "utf8"));
    const row = doc.routes.find((item: any) => item.route === "route/provisional");
    expect(row.passes).toHaveLength(3);
    expect(row.passes.find((item: any) => item.pass === 2).state).toBe("provisional");
    expect(row.state).toBe("complete");
    expect(row.rank).toBe(1);
  });

  it("renders hostile route as escaped text and omits the incomplete reason", () => {
    const root = temp("preview");
    const repo = join(root, "repo");
    mkdirSync(join(repo, "harness"), { recursive: true });
    cpSync(join(HARNESS, "model-guide"), join(repo, "harness/model-guide"), {
      recursive: true,
      // The real approval record stays out of every fixture.
      filter: (source) => !source.endsWith("publish-approval.md"),
    });
    cpSync(join(HARNESS, "..", "docs"), join(repo, "docs"), { recursive: true });
    symlinkSync(join(HARNESS, "node_modules"), join(repo, "harness/node_modules"), "dir");
    const guide = join(repo, "harness/model-guide");
    const route = `hostile\\\"><script>alert(1)</script>\\n雪`;
    const reason = `night <svg onload=alert(1)>\\\"&\\n雪`;
    writeFileSync(join(guide, "data/review-scores/mg-2026-11a.json"), JSON.stringify({
      set_id: "mg-2026-11a", passes: [], routes: [{
        route, state: "incomplete", passes: [], worst: null, median: null, best: null,
        worst_blocker_recall: null, rank: null, incomplete_reason: reason,
      }],
    }));
    const preview = join(root, "preview");
    const result = spawnSync("bash", [
      join(guide, "preview.sh"), "--manifest", join(guide, "data/MANIFEST-2026-11-17.txt"),
      "--preview", preview,
    ], {
      cwd: repo, env: { ...process.env, HOME: temp("preview-home"), TZ: "UTC" },
      encoding: "utf8", timeout: 60_000,
    });
    expect(result.status, `${result.stdout}\\n${result.stderr}`).toBe(0);
    const html = readFileSync(join(preview, "review.html"), "utf8");
    expect(html).toContain("hostile");
    expect(html).toContain("&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("incomplete: 0 of 3 passes");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<svg onload=alert(1)>");
    // PM page look 2026-11-22 (task 5.3 Red r2): the public page never
    // renders incomplete_reason, raw or escaped.
    expect(html).not.toContain("&lt;svg onload=alert(1)&gt;");
  });

  it("refuses an unknown quota provider before any network request", () => {
    const result = spawnSync(join(HARNESS, "node_modules/.bin/tsx"), [
      "model-guide/quota.ts", "--provider", "attacker/unknown", "--base", "http://127.0.0.1:1",
    ], {
      cwd: HARNESS,
      env: { PATH: process.env.PATH, HOME: temp("quota-home"), TZ: "UTC", NO_COLOR: "1" },
      encoding: "utf8", timeout: 10_000,
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("the provider attacker/unknown is not in the spec D15 table");
  });
});
