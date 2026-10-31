import { spawnSync } from "node:child_process";
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const REAL_NODE = process.execPath;
const DAILY_SCRIPT = process.env.BENCH_GREEN_CRON_DAILY ?? join(HARNESS, "cron-daily.sh");
const DAY = "2026-10-26";
const STEPS = ["recost-1", "rescore-all", "guard-10", "batch-build", "guard-81", "rescore-week", "recost-2", "python-export-site-data.py", "python-generate-model-pages.py", "cleanup"];

type Fixture = { root: string; repo: string; log: string; home: string; bin: string; runs: string; days: string; pricing: string; catalog: string; served: string };

function script(path: string, body: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o755 });
}

function fixture(failCompare = false): Fixture {
  const root = mkdtempSync(join(tmpdir(), "daily-green-"));
  const repo = join(root, "repo");
  const harness = join(repo, "harness");
  const home = join(root, "home");
  const bin = join(root, "bin");
  const runs = join(root, "runs");
  const days = join(root, "reports", "daily");
  const pricing = join(root, "pricing.json");
  const catalog = join(root, "catalog.json");
  const served = join(root, "served.txt");
  const log = join(root, "steps.log");
  mkdirSync(harness, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(runs, { recursive: true });
  mkdirSync(days, { recursive: true });
  writeFileSync(join(harness, "cron-daily.sh"), readFileSync(DAILY_SCRIPT));
  for (const name of ["daily-pick.ts", "go-cost.ts", "candidate-contract.ts"])
    symlinkSync(join(HARNESS, name), join(harness, name));
  symlinkSync(join(HARNESS, "node_modules"), join(harness, "node_modules"), "dir");
  writeFileSync(join(harness, "provenance.ts"), "process.stdout.write('green-test-hash');\n");
  writeFileSync(pricing, JSON.stringify({
    schema: 1, source: "test", retrieved: DAY, provider: "opencode-go",
    high_usage_min_requests_per_month: 1, deepseek_rate: "off-peak", aliases: {},
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
    models: { "glm-5.2": {
      name: "glm-5.2", api: "openai-completions", high_usage: true, batch: true,
      requests_per_month: 100, monthly_usage_usd: 15,
      rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
    } },
  }));
  writeFileSync(catalog, JSON.stringify({ live: ["glm-5.2"] }));
  writeFileSync(served, "opencode-go/glm-5.2\n");
  writeFileSync(log, "");

  script(join(bin, "node"), `#!/usr/bin/env bash
if [ "${failCompare ? "1" : "0"}" = 1 ] && [ "\${1:-}" = -e ] && [[ "\${2:-}" == *DAILY_GUARD_VALUE* ]]; then exit 88; fi
exec ${JSON.stringify(REAL_NODE)} "$@"
`);
  script(join(bin, "python3"), `#!/usr/bin/env bash
printf 'python-%s\\n' "$(basename "$1")" >> "$STEP_LOG"
exit 0
`);

  script(join(harness, "recost.sh"), `#!/usr/bin/env bash
n=0; [ ! -f "$RECOST_COUNT" ] || n=$(cat "$RECOST_COUNT"); n=$((n + 1)); printf '%s' "$n" > "$RECOST_COUNT"; printf 'recost-%s\\n' "$n" >> "$STEP_LOG"
`);
  script(join(harness, "rescore-doctor.sh"), `#!/usr/bin/env bash
if [ "\${WEEK:-}" = all ]; then printf 'rescore-all\\n' >> "$STEP_LOG"; else printf 'rescore-week\\n' >> "$STEP_LOG"; fi
`);
  script(join(harness, "cleanup.sh"), "#!/usr/bin/env bash\nprintf 'cleanup\\n' >> \"$STEP_LOG\"\n");
  const chrome = join(home, ".cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell");
  script(chrome, "#!/usr/bin/env bash\nexit 0\n");
  return { root, repo, log, home, bin, runs, days, pricing, catalog, served };
}

function job(f: Fixture, quota: number[], post: boolean) {
  const counter = join(f.root, "quota.count");
  script(join(f.root, "quota.cjs"), `#!/usr/bin/env node
const fs = require('node:fs');
const n = fs.existsSync(${JSON.stringify(counter)}) ? Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) : 0;
fs.writeFileSync(${JSON.stringify(counter)}, String(n + 1));
const values = ${JSON.stringify(quota)};
const value = values[Math.min(n, values.length - 1)];
fs.appendFileSync(process.env.STEP_LOG, value > 80 ? 'guard-81\\n' : 'guard-10\\n');
process.stdout.write(JSON.stringify({usage:{windows:{weekly:{usedPercent:value},monthly:{usedPercent:10}}}}));
`);
  script(join(f.root, "batch.cjs"), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const track = process.env.BENCH_TRACK;
const marker = process.env.BENCH_SELFCHECK_MARKER;
const exists = marker ? fs.existsSync(marker) : false;
fs.appendFileSync(process.env.STEP_LOG, 'batch-' + track + '\\n');
if (marker) {
  fs.appendFileSync(process.env.STEP_LOG, 'marker-' + track + '-' + exists + '\\n');
  if (!exists) fs.writeFileSync(marker, 'pass\\n');
}
if (track === 'build') {
  const id = 'a-glm-5-2-' + process.env.WEEK + '-r1';
  const artifacts = path.join(process.env.BENCH_RUNS_ROOT, id, 'artifacts');
  fs.mkdirSync(artifacts, {recursive:true});
  fs.writeFileSync(path.join(artifacts, 'provenance.json'), JSON.stringify({executor:{kind:'opencode'}, model:'opencode-go/glm-5.2', arm:'a', track}));
}
`);
  const env = {
    PATH: `${f.bin}:${dirname(REAL_NODE)}:/usr/local/bin:/usr/bin:/bin`,
    HOME: f.home, TMPDIR: f.root, TSX_DISABLE_CACHE: "1", _BENCH_ENV_LOADED: "1",
    STEP_LOG: f.log, RECOST_COUNT: join(f.root, "recost.count"),
    BENCH_RUNS_ROOT: f.runs, BENCH_PRICING_PATH: f.pricing, BENCH_DAILY_DIR: f.days,
    BENCH_DAILY_DATE: DAY, BENCH_DAILY_CATALOG: f.catalog, BENCH_DAILY_SERVED: f.served,
    BENCH_DAILY_QUOTA_CMD: join(f.root, "quota.cjs"), BENCH_DAILY_BATCH: join(f.root, "batch.cjs"),
    BENCH_DAILY_PUBLISH: "0", BENCH_DAILY_POST: post ? "1" : "0", BENCH_DAILY_LOCK: join(f.root, "lock"),
  };
  return spawnSync("bash", [join(f.repo, "harness/cron-daily.sh")], { cwd: f.repo, env, encoding: "utf8", timeout: 30_000 });
}

function events(f: Fixture) { return readFileSync(f.log, "utf8").trim().split(/\r?\n/).filter(Boolean); }
function clean(f: Fixture) { rmSync(f.root, { recursive: true, force: true }); }

describe("daily schedule Green regressions", () => {
  it("bounds the service and live quota commands", () => {
    const service = readFileSync(join(HARNESS, "systemd/lending-desk-daily.service"), "utf8");
    const scriptText = readFileSync(join(HARNESS, "cron-daily.sh"), "utf8");
    expect(service).toContain("Environment=PATH=%h/.local/share/pnpm/bin:%h/.local/bin:%h/.nvm/versions/node/v24.19.0/bin:/usr/local/bin:/usr/bin:/bin");
    expect(service).toContain("TimeoutStartSec=16h");
    expect(scriptText).toContain("timeout 10s openchamber status --json");
    expect(scriptText).toContain("curl --max-time 10 --noproxy '*' -fsS");
  });

  it("stops with read failed when the quota compare process fails", () => {
    const f = fixture(true);
    try {
      const r = job(f, [10], false);
      const output = `${r.stdout}\n${r.stderr}`;
      expect(r.status).toBe(0);
      expect(output).toContain("DAILY SKIP go-guard: read failed");
      expect(output).not.toContain("DAILY GO-GUARD");
      expect(events(f)).not.toContain("batch-build");
      expect(JSON.parse(readFileSync(join(f.days, `${DAY}.json`), "utf8")).go_guard_stop).toBe("read failed");
    } finally { clean(f); }
  });

  it("runs D12 steps 5 to 9 after a stop before batch 2", () => {
    const f = fixture();
    try {
      const r = job(f, [10, 81], true);
      const output = `${r.stdout}\n${r.stderr}`;
      expect(r.status).toBe(0);
      expect(output).toContain("DAILY SKIP go-guard: weekly used 81 percent");
      expect(events(f).filter(line => !line.startsWith("marker-"))).toEqual(STEPS);
      const record = JSON.parse(readFileSync(join(f.days, `${DAY}.json`), "utf8"));
      expect(record.go_guard_stop).toBe("weekly used 81 percent");
      expect(record.run_ids).toEqual([`a-glm-5-2-2026w44-r1`]);
      expect(readdirSync(join(f.repo, ".tmp")).some(name => name.startsWith("selfcheck-pass-"))).toBe(false);
    } finally { clean(f); }
  });

  it("passes one self-check marker to all four batches", () => {
    const f = fixture();
    try {
      const r = job(f, [10, 10, 10, 10], false);
      expect(r.status).toBe(0);
      const markers = events(f).filter(line => line.startsWith("marker-"));
      expect(markers.map(line => line.split("-")[1])).toEqual(["build", "bugfix", "tests", "change"]);
      expect(markers.map(line => line.endsWith("-true"))).toEqual([false, true, true, true]);
      expect(events(f).filter(line => line.startsWith("marker-")).map(line => line.slice(line.lastIndexOf("-") + 1))).toEqual(["false", "true", "true", "true"]);
      expect(events(f).filter(line => line.startsWith("batch-"))).toEqual(["batch-build", "batch-bugfix", "batch-tests", "batch-change"]);
    } finally { clean(f); }
  });
});
