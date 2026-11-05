import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * The browser record of D2 (spec FR-2).
 *
 * The browser check launches the system Chrome and returns its version. The
 * grade writes the record artifacts/grader-browser.json for each grade that
 * launches a browser. A tests-track grade launches no browser, so it writes no
 * record.
 *
 * The test uses a temp tree only. It never reads the real runs/ tree, it
 * launches no browser, and it calls no model.
 */

const fake = vi.hoisted(() => {
  const calls: unknown[] = [];
  return {
    calls,
    browser: {
      version: () => "153.0.8010.52",
      newPage: async () => ({
        setContent: async () => undefined,
        textContent: async () => "browser ready",
      }),
      close: async () => undefined,
    },
  };
});

vi.mock("@playwright/test", () => ({
  chromium: {
    launch: async (options: unknown) => {
      fake.calls.push(options);
      return fake.browser;
    },
  },
}));

const { checkBrowser, browserRecordLine } = await import("../browser-check");

const HARNESS = resolve(import.meta.dirname, "..");
const GRADE = join(HARNESS, "grade.sh");
const VERSION = "153.0.8010.52";
const RECORD_LINE = browserRecordLine(VERSION);

/** The stub of the harness tools. The grade stops at the gate and runs no suite. */
function tsxStub(): string {
  return `#!/usr/bin/env bash
case "$(basename "$1")" in
  browser-check.ts)
    echo "browser ready"
    echo '${RECORD_LINE}'
    ;;
  score.ts) printf '{"valid":true,"total":50,"axes":{"quality":1},"adherence":{"contract":1}}\\n' ;;
  *) exit 0 ;;
esac
`;
}

function fixture(track: string) {
  const root = mkdtempSync(join(tmpdir(), "grader-record-"));
  const repo = join(root, "repo");
  const harness = join(repo, "harness");
  const runId = track === "tests" ? "tt-a-test-model-2026w43-r1" : "a-test-model-2026w43-r1";
  const run = join(repo, "runs", runId);
  mkdirSync(join(harness, "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(repo, "fixture"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(run, "candidate", "node_modules", ".bin"), { recursive: true });
  mkdirSync(join(run, "variant"), { recursive: true });
  writeFileSync(join(harness, "grade.sh"), readFileSync(GRADE));
  writeFileSync(join(harness, "node_modules", ".bin", "tsx"), tsxStub(), { mode: 0o755 });
  writeFileSync(join(harness, "node_modules", ".bin", "vitest"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(harness, "node_modules", ".bin", "playwright"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(harness, "preflight.sh"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(run, "candidate", "node_modules", ".bin", "next"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  // The gate fails on purpose. The grade stops before any suite runs.
  writeFileSync(join(root, "bin", "npm"), "#!/usr/bin/env bash\nexit 1\n", { mode: 0o755 });
  return { root, repo, runId };
}

function grade(f: { root: string; repo: string; runId: string }, track: string) {
  return spawnSync("bash", [join(f.repo, "harness", "grade.sh"), f.runId, "opencode-go/test-model", "a", "10"], {
    cwd: f.repo,
    env: {
      ...process.env,
      PATH: `${join(f.root, "bin")}:${process.env.PATH ?? ""}`,
      API_PORT: "39251",
      E2E_PORT: "39252",
      BENCH_TRACK: track,
    },
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe("the browser check of D2", () => {
  it("launches the system Chrome and returns its version", async () => {
    fake.calls.length = 0;
    const result = await checkBrowser();
    expect(fake.calls).toEqual([{ channel: "chrome" }]);
    expect(result.ok).toBe(true);
    expect(result.version).toBe(VERSION);
  });

  it("holds one record format", () => {
    expect(RECORD_LINE).toBe(`{"schema":1,"channel":"chrome","version":"${VERSION}"}`);
  });
});

describe("the browser record of a grade", () => {
  it("writes the record for a grade that launches a browser", () => {
    const f = fixture("build");
    try {
      const result = grade(f, "build");
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const record = join(f.repo, "runs", f.runId, "artifacts", "grader-browser.json");
      expect(existsSync(record)).toBe(true);
      const text = readFileSync(record, "utf8");
      expect(text.trim()).toBe(RECORD_LINE);
      expect(JSON.parse(text)).toEqual({ schema: 1, channel: "chrome", version: VERSION });
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("writes no record for a tests-track grade", () => {
    const f = fixture("tests");
    try {
      const result = grade(f, "tests");
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const artifacts = join(f.repo, "runs", f.runId, "artifacts");
      expect(existsSync(join(artifacts, "grader-browser.json"))).toBe(false);
      expect(existsSync(join(artifacts, "browser-check.log"))).toBe(false);
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
