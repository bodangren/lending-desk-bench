// Daily real-world ingest (queue item 1), after the independent review.
//
// Every database is a fixture under the system temp folder. The jobs folder is
// the only external checkout path, and it comes from INGEST_OUTCOMES_JOBS.
// The live outcomes database is never read. The cases check the row schema,
// metric values, each leak gate, a same-day repeat, read-only database bytes,
// and that --no-commit makes no commit in a temp repo copy.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const HARNESS = join(ROOT, "harness");
const SOURCE = join(HARNESS, "model-guide");
const INGEST_PY = join(SOURCE, "ingest.py");
const INGEST_SH = join(SOURCE, "ingest.sh");
const REAL_WORK = join(SOURCE, "real-work.ts");
const TSX = join(HARNESS, "node_modules/.bin/tsx");
// The one external checkout path. The test passes it through the env seam.
const JOBS = "/home/daniebo/Desktop/advantage-pr/scripts/jobs";
const REFERENCE = join(SOURCE, "data/ra-outcomes-2026-11-17.json");
const DATE = "2026-11-25";
const GOOD_ROUTE = "opencode-go/test-model#high";
const CONTEXT_ROUTE = "claude-code/claude-opus-5-5[1m]";
const LEGACY_ROUTE = "claude-sonnet-5-5";
const CANONICAL_ROUTE = "claude-code/claude-sonnet-5-5";
const SKIPPED_ROUTE = "legacy-private-marker";
const NOTE_ROUTE = `${GOOD_ROUTE} (free-text note /home/private/operator@example.invalid)`;
const DEFAULT_RUNS: Run[] = [
  { role: "coder", route: NOTE_ROUTE, result: "pass", axis: "test_mean" },
  { role: "coder", route: NOTE_ROUTE, result: "pass" },
  { role: "coder", route: NOTE_ROUTE, result: "fail" },
  { role: "coder", route: NOTE_ROUTE, result: "error" },
  { role: "coder", route: NOTE_ROUTE, result: "pass" },
  { role: "review-a", route: NOTE_ROUTE, result: "pass" },
  { role: "review-a", route: NOTE_ROUTE, result: "pass" },
  { role: "review-a", route: NOTE_ROUTE, result: "fail" },
  { role: "review-a", route: NOTE_ROUTE, result: "error" },
];

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function folder(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ingest-${tag}-`));
  roots.push(dir);
  return dir;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

type Run = { role: string; route: string; result: string; axis?: string };

/** Build a tiny database through outcomes_db itself. No live file is read. */
function newDb(path: string, runs: Run[]): void {
  const code = `
import json, sys
sys.path.insert(0, sys.argv[2])
import outcomes_db
con = outcomes_db.connect(sys.argv[1])
for index, item in enumerate(json.loads(sys.argv[3])):
    cur = con.execute(
        "INSERT INTO runs (started_at, role, route, result) VALUES (?,?,?,?)",
        ("2026-11-20T00:00:%02dZ" % index, item["role"], item["route"], item["result"]))
    if item.get("axis"):
        con.execute(
            "INSERT INTO ratings (run_id, rater_route, axis, score) VALUES (?,?,?,?)",
            (cur.lastrowid, ${JSON.stringify(GOOD_ROUTE)}, item["axis"], 4))
con.commit()
con.close()
`;
  const r = spawnSync("python3", ["-c", code, path, JOBS, JSON.stringify(runs)],
    { encoding: "utf8", timeout: 30_000 });
  expect(r.status, `fixture database: ${r.stderr}`).toBe(0);
}

function aaDoc(url?: string): string {
  return JSON.stringify({
    schema: 1,
    models: { "test-model": { netScore: 1, aliases: [], source: url ?? "local" } },
  }) + "\n";
}

function routesDoc(route = GOOD_ROUTE): string {
  return JSON.stringify({
    allowedRoutes: [route], orchestratorRoutes: [route],
  }) + "\n";
}

function fixture(tag: string, runs: Run[] = DEFAULT_RUNS): {
  root: string; db: string; aa: string; routes: string; noDb: string;
} {
  const root = folder(tag);
  const db = join(root, "outcomes.sqlite");
  const noDb = join(root, "missing-opencode.sqlite");
  const aa = join(root, "aa.json");
  const routes = join(root, "routes.json");
  newDb(db, runs);
  writeFileSync(aa, aaDoc());
  writeFileSync(routes, routesDoc());
  return { root, db, aa, routes, noDb };
}

function envFor(f: ReturnType<typeof fixture>, values: Record<string, string> = {}) {
  return {
    ...process.env,
    RA_QUOTA_OUTCOMES: f.db,
    OUTCOMES_OPENCODE_DB: f.noDb,
    INGEST_OUTCOMES_JOBS: JOBS,
    INGEST_AA_SOURCE: f.aa,
    INGEST_ROUTES_CONFIG: f.routes,
    INGEST_SCHEMA_REFERENCE: REFERENCE,
    INGEST_DATE: DATE,
    INGEST_ENABLED: "1",
    ...values,
  };
}

function runIngest(f: ReturnType<typeof fixture>, out: string,
                   values: Record<string, string> = {}) {
  return spawnSync("python3", [INGEST_PY, "--dry-run", "--out", out], {
    env: envFor(f, values), encoding: "utf8", timeout: 90_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** The production path: stage in the destination parent, then move. */
function runIngestFull(f: ReturnType<typeof fixture>, out: string,
                       values: Record<string, string> = {}) {
  return spawnSync("python3", [INGEST_PY, "--date", DATE, "--out", out], {
    env: envFor(f, values), encoding: "utf8", timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function gateOf(rows: any[]): any {
  return rows.find((row) => row.kind === "gate");
}

function producerOf(rows: any[]): any {
  return rows.find((row) => row.kind === "producer");
}

function keySet(rows: unknown[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const key of Object.keys(row)) keys.add(key);
    }
  }
  return [...keys].sort();
}

function refusalCase(label: string, mutation: (f: ReturnType<typeof fixture>) => void) {
  it(label, () => {
    const f = fixture(label.replace(/\W+/g, "-"));
    mutation(f);
    const out = join(f.root, "refuse-out");
    const r = runIngest(f, out);
    expect(r.status, `${label}: ${r.stdout}\n${r.stderr}`).toBe(2);
    expect(r.stdout.trim().split("\n"), `${label}: one refusal line`).toHaveLength(1);
    expect(existsSync(join(out, `ra-outcomes-${DATE}.json`)),
      `${label}: no output file`).toBe(false);
    expect(existsSync(join(out, `MANIFEST-${DATE}.txt`)),
      `${label}: no manifest`).toBe(false);
  }, 90_000);
}

function seededPrivate(root: string): string {
  const dir = join(root, "private");
  const set = join(dir, "sets", "mg-2026-11a");
  mkdirSync(join(set, "diffs"), { recursive: true });
  mkdirSync(join(set, "src"), { recursive: true });
  writeFileSync(join(set, "diffs", "seed-01.diff"),
    "@@ -1,1 +1,1 @@\nL1 +  synthetic ingest seed line one;\n");
  writeFileSync(join(set, "src", "seed-01.diff"),
    "@@ -1,1 +1,1 @@\nL1 -  synthetic base content only;\n");
  return dir;
}

describe("daily real-world ingest", () => {
  it("writes the trio with the pinned schema and metric values", () => {
    const f = fixture("happy");
    const before = sha256(f.db);
    const out = join(f.root, "out");
    const r = runIngest(f, out);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(sha256(f.db), "the outcomes database is read-only").toBe(before);

    expect(readdirSync(out).sort()).toEqual([
      `MANIFEST-${DATE}.txt`,
      `aa-reliability-${DATE}.json`,
      `allowed-routes-${DATE}.json`,
      `ra-outcomes-${DATE}.json`,
    ]);
    const rows = JSON.parse(readFileSync(join(out, `ra-outcomes-${DATE}.json`), "utf8"));
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(2);
    const reference = JSON.parse(readFileSync(REFERENCE, "utf8"));
    expect(keySet([gateOf(rows)]), "the gate key set matches the 11-17 export")
      .toEqual(keySet(reference.filter((row: any) => row.kind === "gate")));
    expect(keySet([producerOf(rows)]), "the producer key set matches the 11-17 export")
      .toEqual(keySet(reference.filter((row: any) => row.kind === "producer")));

    const producer = producerOf(rows);
    const gate = gateOf(rows);
    expect(producer).toMatchObject({
      route: NOTE_ROUTE, role: "coder", kind: "producer",
      runs: 5, pass: 3, fail: 1, error: 1, decided: 4, coverage: 0.8,
      tasks: 0, accepted: 0, ratings: { test_mean: 4 },
    });
    expect(gate).toMatchObject({
      route: NOTE_ROUTE, role: "review-a", kind: "gate",
      runs: 4, pass: 2, fail: 1, error: 1, decided: 3, coverage: 0.75,
      recorded_rate: null, escapes: 0, findings: 0,
    });
    expect(readFileSync(join(out, `ra-outcomes-${DATE}.json`), "utf8"),
      "the raw note stays in the dated private export").toContain("free-text note");
    expect(readFileSync(join(out, `ra-outcomes-${DATE}.json`), "utf8"),
      "the private note text stays in the dated private export")
      .toContain("/home/private/operator@example.invalid");

    const allowed = JSON.parse(readFileSync(join(out, `allowed-routes-${DATE}.json`), "utf8"));
    expect(Object.keys(allowed).sort()).toEqual(["allowedRoutes", "orchestratorRoutes"]);
    expect(allowed.allowedRoutes).toEqual([GOOD_ROUTE]);

    const manifest = readFileSync(join(out, `MANIFEST-${DATE}.txt`), "utf8");
    const lines = manifest.trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line).toMatch(/^[0-9a-f]{64}  \d+  \S+$/);

    // The same manifest mode update.sh runs before the render.
    const rwOut = join(f.root, "real-work");
    const check = spawnSync(TSX,
      [REAL_WORK, "--manifest", join(out, `MANIFEST-${DATE}.txt`), "--out", rwOut],
      { cwd: HARNESS, encoding: "utf8", timeout: 90_000 });
    expect(check.status, `real-work.ts: ${check.stdout}\n${check.stderr}`).toBe(0);
    expect(existsSync(join(rwOut, "real-work.json"))).toBe(true);
    const publicJson = readFileSync(join(rwOut, "real-work.json"), "utf8");
    expect(publicJson, "the renderer strips the conventional note").toContain("test-model");
    expect(publicJson, "the note is absent from the public JSON").not.toContain("free-text note");
    expect(publicJson, "the private note text is absent from the public JSON")
      .not.toContain("/home/private/operator@example.invalid");

    const again = join(f.root, "again");
    const second = runIngest(f, again);
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
    for (const name of readdirSync(out)) {
      expect(sha256(join(again, name)), `same-day repeat: ${name}`)
        .toBe(sha256(join(out, name)));
    }
  }, 180_000);

  it("accepts every route in the committed reference", () => {
    const code = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("ingest", sys.argv[1])
ingest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest)
with open(sys.argv[2], encoding="utf-8") as handle:
    rows = json.load(handle)
kept, skipped, mapped = ingest.normalize_routes(rows)
ingest.check_rows(kept)
print(json.dumps({"rows": len(rows), "kept": len(kept),
                  "skipped": skipped, "mapped": mapped}))
`;
    const r = spawnSync("python3", ["-c", code, INGEST_PY, REFERENCE], {
      env: { ...process.env, INGEST_SCHEMA_REFERENCE: REFERENCE },
      encoding: "utf8", timeout: 30_000,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const reference = JSON.parse(readFileSync(REFERENCE, "utf8"));
    const legacy = /^(?:claude-sonnet-5-5|muse-spark-1\.3-contributor)(?:\[1m\])?(?:#[a-z0-9]{1,12})?$/;
    const mappedCount = reference.filter((row: any) => legacy.test(row.route)).length;
    expect(JSON.parse(r.stdout)).toEqual({
      rows: reference.length, kept: reference.length, skipped: 0,
      mapped: mappedCount,
    });
  }, 30_000);

  it("bounds the route length and the provider-aware segment grammar", () => {
    const code = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("ingest", sys.argv[1])
ingest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest)
provider = "a" * 33
last = ingest.ROUTE_MAX - 33 - 1 - 49 - 1
core = provider + "/" + "b" * 49 + "/" + "c" * last
assert len(core) == ingest.ROUTE_MAX, len(core)
assert ingest.valid_route(core), "the boundary length is valid"
assert not ingest.valid_route(core + "d"), "one more character is too long"
for bad in ("Opencode-go/model", "opencode-go/a/b/c", "opencode-go/model@x",
            "opencode-go/"):
    assert not ingest.valid_route(bad), bad
rows = [dict(route=core, role="coder"),
        dict(route=core + "d", role="coder"),
        dict(route="Opencode-go/model", role="coder"),
        dict(route="opencode-go/a/b/c", role="coder")]
kept, skipped, mapped = ingest.normalize_routes(rows)
assert (len(kept), skipped, mapped) == (1, 3, 0), (len(kept), skipped, mapped)
ingest.check_rows(kept)
print(json.dumps({"max": ingest.ROUTE_MAX, "kept": len(kept)}))
`;
    const r = spawnSync("python3", ["-c", code, INGEST_PY], {
      env: { ...process.env, INGEST_SCHEMA_REFERENCE: REFERENCE },
      encoding: "utf8", timeout: 30_000,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ max: 128, kept: 1 });
  }, 30_000);

  it("refuses an allowed route beyond the length boundary", () => {
    const f = fixture("long-allowed-route");
    writeFileSync(f.routes, routesDoc("z".repeat(200)));
    const out = join(f.root, "out");
    const r = runIngest(f, out);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(2);
    expect(r.stdout).toBe("ingest: invalid allowedRoutes\n");
    expect(existsSync(join(out, `ra-outcomes-${DATE}.json`))).toBe(false);
  }, 90_000);

  it("accepts a context suffix and the unknown route", () => {
    const f = fixture("context-unknown");
    newDb(f.db, [
      { role: "review-a", route: CONTEXT_ROUTE, result: "pass" },
      { role: "review-a", route: "unknown", result: "fail" },
    ]);
    const out = join(f.root, "out");
    const r = runIngest(f, out);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const rows = JSON.parse(readFileSync(join(out, `ra-outcomes-${DATE}.json`), "utf8"));
    expect(rows.map((row: any) => row.route)).toContain(CONTEXT_ROUTE);
    expect(rows.map((row: any) => row.route)).toContain("unknown");
  }, 90_000);

  it("skips a legacy row and continues with the valid rows", () => {
    const f = fixture("skip-legacy");
    newDb(f.db, [{ role: "review-a", route: SKIPPED_ROUTE, result: "pass" }]);
    const out = join(f.root, "out");
    const r = runIngest(f, out);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const rows = JSON.parse(readFileSync(join(out, `ra-outcomes-${DATE}.json`), "utf8"));
    expect(rows.map((row: any) => row.route)).toContain(NOTE_ROUTE);
    expect(rows.map((row: any) => row.route)).not.toContain(SKIPPED_ROUTE);
    expect(readFileSync(join(out, `ingest-${DATE}.log`), "utf8")).toBe(
      "ingest: skipped routes 1; mapped legacy routes 0\n");
    expect(r.stdout + r.stderr).not.toContain("skipped routes");
  }, 90_000);

  it("maps a known legacy route to its canonical route", () => {
    const f = fixture("map-legacy");
    newDb(f.db, [{ role: "review-a", route: LEGACY_ROUTE, result: "pass" }]);
    const out = join(f.root, "out");
    const r = runIngest(f, out);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const rows = JSON.parse(readFileSync(join(out, `ra-outcomes-${DATE}.json`), "utf8"));
    const routes = rows.map((row: any) => row.route);
    expect(routes).toContain(CANONICAL_ROUTE);
    expect(routes).not.toContain(LEGACY_ROUTE);
    expect(readFileSync(join(out, `ingest-${DATE}.log`), "utf8")).toBe(
      "ingest: skipped routes 0; mapped legacy routes 1\n");
  }, 90_000);

  it("associates metrics by the original route before legacy normalization", () => {
    const code = `
import importlib.util, json, sys
sys.path.insert(0, sys.argv[2])
spec = importlib.util.spec_from_file_location("ingest", sys.argv[1])
ingest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest)
import outcomes_tasks
legacy, canon = "claude-sonnet-5-5", "claude-code/claude-sonnet-5-5"
def metrics(tasks):
    return {"tasks": tasks, "accepted": tasks, "first_round_rate": 0.5,
            "mean_rework_rounds": 1.0, "cleanup_share": 0.25,
            "tokens_per_accepted": 100}
rows = [
    {"route": legacy, "role": "coder", "recorded_rate": 0.5, "decided": 4},
    {"route": canon, "role": "coder", "recorded_rate": 0.5, "decided": 4},
    {"route": legacy, "role": "review-a", "recorded_rate": 0.5, "decided": 4},
    {"route": canon, "role": "review-a", "recorded_rate": 0.5, "decided": 4},
]
downstream = {(legacy, "coder"): metrics(7), (canon, "coder"): metrics(9)}
escapes = {(legacy, "review-a"): 3, (canon, "review-a"): 5}
kept, skipped, mapped = ingest.merge_then_normalize(
    outcomes_tasks, rows, downstream, escapes)
assert (skipped, mapped) == (0, 2), (skipped, mapped)
producers = [row for row in kept if row["kind"] == "producer"]
gates = [row for row in kept if row["kind"] == "gate"]
assert producers[0]["tasks"] == 7, producers[0]
assert producers[1]["tasks"] == 9, producers[1]
assert gates[0]["escapes"] == 3, gates[0]
assert gates[1]["escapes"] == 5, gates[1]
assert all(row["route"] == canon for row in kept)
print(json.dumps({"mapped": mapped, "producer": producers[0]["tasks"],
                  "gate": gates[0]["escapes"]}))
`;
    const r = spawnSync("python3", ["-c", code, INGEST_PY, JOBS], {
      env: { ...process.env, INGEST_SCHEMA_REFERENCE: REFERENCE },
      encoding: "utf8", timeout: 30_000,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ mapped: 2, producer: 7, gate: 3 });
  }, 30_000);

  it("succeeds when every outcome row is skipped", () => {
    const f = fixture("only-skipped", [
      { role: "review-a", route: SKIPPED_ROUTE, result: "pass" },
    ]);
    const out = join(f.root, "out");
    const r = runIngest(f, out);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(JSON.parse(readFileSync(join(out, `ra-outcomes-${DATE}.json`), "utf8"))).toEqual([]);
    expect(readFileSync(join(out, `ingest-${DATE}.log`), "utf8")).toBe(
      "ingest: skipped routes 1; mapped legacy routes 0\n");
  }, 90_000);

  it("keeps a skipped route out of the public files", () => {
    const f = fixture("skip-public");
    newDb(f.db, [{ role: "review-a", route: SKIPPED_ROUTE, result: "pass" }]);
    const out = join(f.root, "out");
    const r = runIngest(f, out);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const publicOut = join(f.root, "public");
    const render = spawnSync(TSX,
      [REAL_WORK, "--manifest", join(out, `MANIFEST-${DATE}.txt`), "--out", publicOut],
      { cwd: HARNESS, encoding: "utf8", timeout: 90_000 });
    expect(render.status, `${render.stdout}\n${render.stderr}`).toBe(0);
    expect(readFileSync(join(publicOut, "real-work.json"), "utf8"))
      .not.toContain(SKIPPED_ROUTE);
    expect(readFileSync(join(out, `ingest-${DATE}.log`), "utf8"))
      .not.toContain(SKIPPED_ROUTE);
  }, 120_000);

  it("uses the real defaults when path overrides are empty", () => {
    const f = fixture("empty-overrides");
    const home = join(f.root, "home");
    const config = join(home, ".config", "ra-quota");
    const state = join(home, ".local", "state", "ra-quota");
    mkdirSync(config, { recursive: true });
    mkdirSync(state, { recursive: true });
    cpSync(f.db, join(state, "outcomes.sqlite"));
    cpSync(f.aa, join(config, "aa-reliability.json"));
    cpSync(f.routes, join(config, "routes.json"));
    const out = join(f.root, "out");
    const r = runIngest(f, out, {
      HOME: home,
      INGEST_OUTCOMES_JOBS: "", INGEST_SCHEMA_REFERENCE: "",
      INGEST_AA_SOURCE: "", INGEST_ROUTES_CONFIG: "",
      RA_QUOTA_OUTCOMES: "", OUTCOMES_OPENCODE_DB: "", TASK_COST_DB: "",
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(existsSync(join(out, `ra-outcomes-${DATE}.json`))).toBe(true);
  }, 90_000);

  it("replaces an existing output set and keeps the manifest consistent", () => {
    const f = fixture("replace");
    const out = join(f.root, "out");
    const first = runIngest(f, out);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const before = sha256(join(out, `ra-outcomes-${DATE}.json`));
    const firstManifest = readFileSync(join(out, `MANIFEST-${DATE}.txt`), "utf8");

    // Changed source data: one more producer run of the same route and role.
    newDb(f.db, [{ role: "coder", route: GOOD_ROUTE, result: "pass" }]);
    const second = runIngest(f, out);
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0);
    expect(sha256(join(out, `ra-outcomes-${DATE}.json`)),
      "the second run replaces the first").not.toBe(before);
    const manifest = readFileSync(join(out, `MANIFEST-${DATE}.txt`), "utf8");
    expect(manifest).not.toBe(firstManifest);
    for (const line of manifest.trim().split("\n")) {
      const match = /^([0-9a-f]{64})  (\d+)  (\S+)$/.exec(line);
      expect(match, `manifest line: ${line}`).not.toBeNull();
      const [, hash, size, name] = match!;
      const body = readFileSync(join(out, name));
      expect(createHash("sha256").update(body).digest("hex")).toBe(hash);
      expect(String(body.length)).toBe(size);
    }
  }, 180_000);

  it("stages inside the destination parent and leaves no stage folder", () => {
    const f = fixture("stage");
    const out = join(f.root, "out");
    const report = join(f.root, "stage.txt");
    const ok = runIngestFull(f, out, { INGEST_STAGE_REPORT: report });
    expect(ok.status, `${ok.stdout}\n${ok.stderr}`).toBe(0);
    expect(existsSync(report), "the stage-report override is gone").toBe(false);
    expect(readdirSync(f.root).filter((name) => name.startsWith(".ingest-stage-")),
      "the stage is removed after success").toEqual([]);
    expect(readdirSync(dirname(out)).sort()).toContain("out");

    const bad = fixture("stage-refuse");
    newDb(bad.db, [{ role: "bad@role", route: GOOD_ROUTE, result: "pass" }]);
    const badOut = join(bad.root, "out");
    const refused = runIngestFull(bad, badOut);
    expect(refused.status, `${refused.stdout}\n${refused.stderr}`).toBe(2);
    expect(readdirSync(bad.root).filter((name) => name.startsWith(".ingest-stage-")),
      "the stage is removed after refusal").toEqual([]);
    expect(existsSync(badOut), "no destination after refusal").toBe(false);
  }, 240_000);

  it("writes private files with owner-only modes", () => {
    const f = fixture("modes");
    const out = join(f.root, "out");
    const r = runIngestFull(f, out);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(statSync(out).mode & 0o777, "the destination is 0700").toBe(0o700);
    const names = readdirSync(out);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(statSync(join(out, name)).mode & 0o777, `${name} is 0600`)
        .toBe(0o600);
    }
  }, 180_000);

  it("refuses a destination that permits group or other access", () => {
    const f = fixture("loose-out");
    const out = join(f.root, "out");
    mkdirSync(out, { recursive: true, mode: 0o777 });
    chmodSync(out, 0o777);
    const r = runIngestFull(f, out);
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(2);
    expect(r.stdout).toBe("ingest: output path must be private\n");
    expect(readdirSync(out), "no file is written").toEqual([]);
  }, 90_000);

  refusalCase("a leaking role refuses", (f) => {
    newDb(f.db, [{ role: "bad@role", route: GOOD_ROUTE, result: "pass" }]);
  });

  refusalCase("a leaking rating key refuses", (f) => {
    newDb(f.db, [{ role: "coder", route: GOOD_ROUTE, result: "pass", axis: "bad@axis" }]);
  });

  refusalCase("an aa url refuses", (f) => {
    writeFileSync(f.aa, aaDoc("https://evil.example/x"));
  });

  it("a duplicate aa key gives one fixed diagnostic and no output files", () => {
    const cases = [
      ["top", '{"SECRET_TOP":1,"SECRET_TOP":2,"models":{}}\n'],
      ["nested", '{"models":{"SECRET_NEST":{"netScore":1,"netScore":2}}}\n'],
    ];
    for (const [tag, raw] of cases) {
      const f = fixture(`dup-${tag}`);
      writeFileSync(f.aa, raw);
      const out = join(f.root, "out");
      const r = runIngest(f, out);
      expect(r.status, `${tag}: ${r.stdout}\n${r.stderr}`).toBe(2);
      expect(r.stdout, `${tag}: fixed diagnostic`).toBe(
        "ingest: aa reliability duplicate key\n");
      expect(r.stdout + r.stderr, `${tag}: no key text`).not.toContain("SECRET_");
      for (const name of [`ra-outcomes-${DATE}.json`, `aa-reliability-${DATE}.json`,
        `allowed-routes-${DATE}.json`, `MANIFEST-${DATE}.txt`]) {
        expect(existsSync(join(out, name)), `${tag}: no ${name}`).toBe(false);
      }
    }
  }, 90_000);

  refusalCase("a leaking allowed route refuses", (f) => {
    writeFileSync(f.routes, routesDoc("https://evil.example/x"));
  });

/** A temp repo copy for the full ingest. The script under test lives here. */
function noCommitRepo(f: ReturnType<typeof fixture>, tag: string): {
  root: string; git: (args: string[]) => string;
} {
  const root = join(f.root, tag);
  mkdirSync(join(root, "harness"), { recursive: true });
  cpSync(SOURCE, join(root, "harness", "model-guide"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "css"), { recursive: true });
  mkdirSync(join(root, "docs", "assets", "data"), { recursive: true });
  writeFileSync(join(root, "docs", "index.html"),
    "<!doctype html><html><head><link rel=\"stylesheet\" href=\"./assets/css/site.css\"></head><body><main><h1>Overview</h1></main></body></html>\n");
  writeFileSync(join(root, "docs", "real-work.html"),
    "<!doctype html><html><body><main>Real work</main></body></html>\n");
  writeFileSync(join(root, "docs", "methodology.html"),
    "<!doctype html><html><body><main>Method</main></body></html>\n");
  writeFileSync(join(root, "docs", "assets", "css", "site.css"),
    "body { font-family: sans-serif; }\n");
  cpSync(join(ROOT, "docs/assets/data/benchmark.json"),
    join(root, "docs", "assets", "data", "benchmark.json"));
  cpSync(join(ROOT, "docs/assets/data/tracks.json"),
    join(root, "docs", "assets", "data", "tracks.json"));
  writeFileSync(join(root, "harness", "model-guide", "publish-approval.md"),
    "approved_by: Daniel\ndate: 2026-11-15\n");
  symlinkSync(join(HARNESS, "node_modules"), join(root, "harness", "node_modules"));
  const git = (args: string[]): string => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 60_000 });
    expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
    return r.stdout.trim();
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "ingest-test@example.invalid"]);
  git(["config", "user.name", "Ingest Test"]);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "initial"]);
  return { root, git };
}

  it("--no-commit writes the guide and leaves git HEAD unchanged", () => {
    const f = fixture("no-commit");
    const { root, git } = noCommitRepo(f, "repo");
    const head = git(["rev-parse", "HEAD"]);
    const privateDir = seededPrivate(f.root);

    const r = spawnSync("bash", [join(root, "harness", "model-guide", "ingest.sh")], {
      cwd: root,
      env: {
        ...envFor(f),
        MODEL_GUIDE_PRIVATE_DIR: privateDir,
        INGEST_NO_COMMIT: "1",
      },
      encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout, "one written line per published path").toContain(
      "update: written docs/assets/data/real-work.json");
    expect(r.stdout).toContain("update: written docs/assets/data/model-guide.json");
    expect(git(["rev-parse", "HEAD"]), "no commit from the ingest").toBe(head);
    expect(git(["status", "--short"]), "the daily publish still owns the changes")
      .toContain("docs/assets/data/real-work.json");
    expect(existsSync(join(privateDir, "input", `ra-outcomes-${DATE}.json`)),
      "the raw export lives in the private input").toBe(true);
    expect(existsSync(join(root, "harness", "model-guide", "data",
      `ra-outcomes-${DATE}.json`)), "the raw export stays out of the repo").toBe(false);
    for (const rel of ["docs/assets/data/real-work.json", "docs/assets/data/model-guide.json",
      "docs/index.html", "docs/real-work.html", "docs/review.html"]) {
      if (!existsSync(join(root, rel))) continue;
      expect(readFileSync(join(root, rel), "utf8"),
        `the note is absent from the public ${rel}`).not.toContain("free-text note");
      expect(readFileSync(join(root, rel), "utf8"),
        `the private note text is absent from the public ${rel}`)
        .not.toContain("/home/private/operator@example.invalid");
    }
  }, 240_000);

  it("--no-commit succeeds when every outcome row is skipped", () => {
    const f = fixture("only-skipped-shell", [
      { role: "review-a", route: SKIPPED_ROUTE, result: "pass" },
    ]);
    const { root, git } = noCommitRepo(f, "repo");
    const privateDir = seededPrivate(f.root);
    const head = git(["rev-parse", "HEAD"]);

    const r = spawnSync("bash", [join(root, "harness", "model-guide", "ingest.sh")], {
      cwd: root,
      env: {
        ...envFor(f),
        MODEL_GUIDE_PRIVATE_DIR: privateDir,
        INGEST_NO_COMMIT: "1",
      },
      encoding: "utf8", timeout: 240_000, maxBuffer: 8 * 1024 * 1024,
    });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(git(["rev-parse", "HEAD"])).toBe(head);
    expect(JSON.parse(readFileSync(join(privateDir, "input",
      `ra-outcomes-${DATE}.json`), "utf8"))).toEqual([]);
    expect(readFileSync(join(root, "docs/assets/data/real-work.json"), "utf8"))
      .not.toContain(SKIPPED_ROUTE);
    for (const rel of ["docs/assets/data/real-work.json", "docs/assets/data/model-guide.json",
      "docs/index.html", "docs/real-work.html", "docs/review.html"]) {
      if (!existsSync(join(root, rel))) continue;
      expect(readFileSync(join(root, rel), "utf8"),
        `the skipped route is absent from the public ${rel}`).not.toContain(SKIPPED_ROUTE);
    }
  }, 300_000);

  it("resolves every path when called by absolute path from an empty cwd", () => {
    const f = fixture("empty-cwd");
    const { root, git } = noCommitRepo(f, "repo");
    const empty = folder("empty-cwd-caller");
    expect(readdirSync(empty), "the caller folder is empty").toEqual([]);
    const script = join(root, "harness", "model-guide", "ingest.sh");

    const dry = spawnSync("bash", [script, "--dry-run"], {
      cwd: empty, env: envFor(f), encoding: "utf8", timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    expect(dry.status, `${dry.stdout}\n${dry.stderr}`).toBe(0);
    expect(dry.stdout).toContain("ingest: rows 2");
    expect(readdirSync(empty), "the dry run writes nothing into the cwd").toEqual([]);

    const head = git(["rev-parse", "HEAD"]);
    const privateDir = seededPrivate(f.root);
    const full = spawnSync("bash", [script], {
      cwd: empty,
      env: {
        ...envFor(f),
        MODEL_GUIDE_PRIVATE_DIR: privateDir,
        INGEST_NO_COMMIT: "1",
      },
      encoding: "utf8", timeout: 240_000, maxBuffer: 8 * 1024 * 1024,
    });
    expect(full.status, `${full.stdout}\n${full.stderr}`).toBe(0);
    expect(full.stdout).toContain("update: written docs/assets/data/real-work.json");
    expect(full.stdout).toContain("update: written docs/assets/data/model-guide.json");
    expect(git(["rev-parse", "HEAD"])).toBe(head);
    expect(git(["status", "--short"]), "the same repo is updated from the empty cwd")
      .toContain("docs/assets/data/real-work.json");
    expect(readdirSync(empty), "the full run writes nothing into the cwd").toEqual([]);
  }, 300_000);

  it("enables the ingest at the daily call and refuses by default", () => {
    const cron = readFileSync(join(HARNESS, "cron-daily.sh"), "utf8");
    expect(cron).toContain(
      'if [ "$DRY_RUN" != "1" ] && [ "$INGEST_DONE" -eq 0 ] && [ -f "$H/model-guide/ingest.sh" ]; then');
    expect(cron).toContain(
      'INGEST_LOG="$(INGEST_ENABLED=1 INGEST_NO_COMMIT=1 bash "$H/model-guide/ingest.sh" 2>&1)"');

    const f = fixture("disabled");
    const env: NodeJS.ProcessEnv = { ...envFor(f) };
    delete env.INGEST_ENABLED;
    const privateDir = join(f.root, "private");
    const refused = spawnSync("bash", [INGEST_SH], {
      cwd: f.root,
      env: { ...env, MODEL_GUIDE_PRIVATE_DIR: privateDir },
      encoding: "utf8", timeout: 30_000,
    });
    expect(refused.status, `${refused.stdout}\n${refused.stderr}`).toBe(2);
    expect(refused.stdout).toBe("ingest: set INGEST_ENABLED=1\n");
    expect(refused.stderr).toBe("");
    expect(existsSync(privateDir)).toBe(false);
  }, 30_000);

  it("refuses relative path overrides with a fixed diagnostic", () => {
    const f = fixture("relative");
    const out = join(f.root, "out");
    const names = [
      "INGEST_OUTCOMES_JOBS", "INGEST_SCHEMA_REFERENCE", "INGEST_AA_SOURCE",
      "INGEST_ROUTES_CONFIG", "MODEL_GUIDE_PRIVATE_DIR",
      "RA_QUOTA_OUTCOMES", "OUTCOMES_OPENCODE_DB", "TASK_COST_DB", "TMPDIR",
    ];
    for (const name of names) {
      const r = runIngest(f, out, { [name]: "relative-value" });
      expect(r.status, `${name}: ${r.stdout}\n${r.stderr}`).toBe(2);
      expect(r.stdout, `${name}: fixed diagnostic`).toBe(
        `ingest: ${name} must be absolute\n`);
      expect(existsSync(join(out, `ra-outcomes-${DATE}.json`)), `${name}: no write`).toBe(false);
    }
    const relativeOut = spawnSync("python3", [INGEST_PY, "--dry-run", "--out", "relative-out"], {
      env: envFor(f), encoding: "utf8", timeout: 90_000,
    });
    expect(relativeOut.status).toBe(2);
    expect(relativeOut.stdout).toBe("ingest: output path must be absolute\n");

    const shell = spawnSync("bash", [INGEST_SH, "--dry-run"], {
      cwd: f.root, env: { ...envFor(f), TMPDIR: "relative-tmp" },
      encoding: "utf8", timeout: 90_000,
    });
    expect(shell.status).toBe(2);
    expect(shell.stdout.trim()).toBe("ingest: TMPDIR must be absolute");
  }, 180_000);
});
