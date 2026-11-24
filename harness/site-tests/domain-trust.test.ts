import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CRITERIA, PROBES } from "../tests/criteria";
import { SPEC_MATRIX } from "../tests/spec-matrix";
import { UNMAPPED_CRITERIA } from "../tests/meta/spec-matrix-contract";

const REPO = resolve(import.meta.dirname, "../..");
const HARNESS = resolve(REPO, "harness");
const EXPORT_SCRIPT = resolve(HARNESS, "export-site-data.py");
const DOMAIN_TRUST_SRC = resolve(HARNESS, "domain_trust.py");
const PREVIEW = JSON.parse(readFileSync(resolve(REPO, "measure/tracks/domain_trust/preview.json"), "utf8")) as {
  n_min: number;
  probe_map: Record<string, { domain: string; kind: string }>;
};

type Json = Record<string, unknown>;

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function pyModule(code: string, stdinValue?: unknown): ReturnType<typeof spawnSync> {
  return spawnSync("python3", ["-c", code], {
    cwd: HARNESS,
    encoding: "utf8",
    input: stdinValue === undefined ? undefined : JSON.stringify(stdinValue),
    maxBuffer: 4 * 1024 * 1024,
  });
}

function requireProbeMap(): Record<string, { domain: string; kind: string }> {
  const res = pyModule(
    "import sys, json; sys.path.insert(0, sys.argv[1]); import domain_trust; print(json.dumps(domain_trust.PROBE_MAP, sort_keys=True))",
  );
  expect(
    res.status,
    `harness/domain_trust.py PROBE_MAP missing: status=${res.status} stderr=${res.stderr} stdout=${res.stdout}`,
  ).toBe(0);
  return JSON.parse(String(res.stdout)) as Record<string, { domain: string; kind: string }>;
}

function callDomainCells(checks: Json, records: Json[], nMin: number): Json {
  const code = [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(HARNESS)})`,
    "import domain_trust",
    "payload = json.load(sys.stdin)",
    "out = domain_trust.domain_cells(payload['checks'], payload['records'], payload['n_min'])",
    "print(json.dumps(out, sort_keys=True))",
  ].join("; ");
  const res = pyModule(code, { checks, records, n_min: nMin });
  expect(
    res.status,
    `harness/domain_trust.py domain_cells missing: status=${res.status} stderr=${res.stderr} stdout=${res.stdout}`,
  ).toBe(0);
  return JSON.parse(String(res.stdout)) as Json;
}

function check(id: string, kind: string, since = 1, text = `${id} text`): Json {
  return { id, kind, since, text };
}

function rec(results: Record<string, boolean | null | string>, revision = 1): Json {
  return { revision, results };
}

describe("domain trust probe map (FR-1)", () => {
  it("maps every PROBES id and no other id", () => {
    const map = requireProbeMap();
    expect(
      Object.keys(map).sort(),
      "harness/domain_trust.py PROBE_MAP keys must equal PROBES keys",
    ).toEqual(Object.keys(PROBES).sort());
  });

  it("uses valid domains and kinds and equals the golden probe map", () => {
    const map = requireProbeMap();
    for (const [id, entry] of Object.entries(map)) {
      expect("ABCDEFGH".includes(entry.domain), `harness/domain_trust.py PROBE_MAP domain of ${id}`).toBe(true);
      expect(["robustness", "performance"].includes(entry.kind), `harness/domain_trust.py PROBE_MAP kind of ${id}`).toBe(true);
    }
    expect(map, "harness/domain_trust.py PROBE_MAP must equal preview probe_map").toEqual(PREVIEW.probe_map);
  });

  it("gives every domain a check list of the registry size and no ADV/M/X id", () => {
    const map = requireProbeMap();
    const expectedSizes: Record<string, number> = { A: 5, B: 6, C: 12, D: 8, E: 12, F: 12, G: 18, H: 2 };
    for (const domain of "ABCDEFGH") {
      const criteriaCount = Object.keys(CRITERIA).filter((id) => id.startsWith(`${domain}.`)).length;
      const probeCount = Object.values(map).filter((e) => e.domain === domain).length;
      expect(
        criteriaCount + probeCount,
        `harness/domain_trust.py check list size of domain ${domain}`,
      ).toBe(expectedSizes[domain]);
      expect(criteriaCount + probeCount, `domain ${domain} needs a check`).toBeGreaterThan(0);
    }
    const allIds = [
      ...Object.keys(CRITERIA).filter((id) => /^[A-H]\./.test(id)),
      ...Object.keys(map),
    ];
    for (const id of allIds) {
      expect(id.startsWith("ADV."), `harness/domain_trust.py list must exclude ${id}`).toBe(false);
      expect(id.startsWith("M."), `harness/domain_trust.py list must exclude ${id}`).toBe(false);
      expect(id.startsWith("X."), `harness/domain_trust.py list must exclude ${id}`).toBe(false);
    }
    void SPEC_MATRIX;
    void UNMAPPED_CRITERIA;
  });
});

describe("domain trust verdicts (FR-2)", () => {
  it("is safe when every spec check passes twice", () => {
    const checks = { A: [check("A.returned", "spec"), check("A.ok", "spec")] };
    const records = [rec({ "A.returned": true, "A.ok": true }), rec({ "A.returned": true, "A.ok": true })];
    expect(callDomainCells(checks, records, 2), "harness/domain_trust.py domain_cells safe cell").toEqual({
      A: { verdict: "safe", min_coverage: 2, failures: [], gaps: [] },
      B: { verdict: "unproven", min_coverage: 0, failures: [], gaps: [] },
      C: { verdict: "unproven", min_coverage: 0, failures: [], gaps: [] },
      D: { verdict: "unproven", min_coverage: 0, failures: [], gaps: [] },
      E: { verdict: "unproven", min_coverage: 0, failures: [], gaps: [] },
      F: { verdict: "unproven", min_coverage: 0, failures: [], gaps: [] },
      G: { verdict: "unproven", min_coverage: 0, failures: [], gaps: [] },
      H: { verdict: "unproven", min_coverage: 0, failures: [], gaps: [] },
    });
  });

  it("is risk when one spec check fails once in three records", () => {
    const checks = { A: [check("A.returned", "spec"), check("A.ok", "spec")] };
    const records = [
      rec({ "A.returned": true, "A.ok": true }),
      rec({ "A.returned": false, "A.ok": true }),
      rec({ "A.returned": true, "A.ok": true }),
    ];
    const out = callDomainCells(checks, records, 2) as Record<string, Json>;
    expect((out.A as Json).verdict, "harness/domain_trust.py domain_cells risk-from-spec verdict").toBe("risk");
    expect((out.A as Json).failures, "harness/domain_trust.py domain_cells risk-from-spec failures").toEqual([
      { id: "A.returned", kind: "spec", text: "A.returned text", failed: 1, graded: 3 },
    ]);
  });

  it("is risk when a robustness probe fails", () => {
    const checks = { F: [check("F.auth-checkout", "spec"), check("P.action-race", "robustness")] };
    const records = [rec({ "F.auth-checkout": true, "P.action-race": true }), rec({ "F.auth-checkout": true, "P.action-race": false })];
    const out = callDomainCells(checks, records, 2) as Record<string, Json>;
    expect((out.F as Json).verdict, "harness/domain_trust.py domain_cells risk-from-robustness verdict").toBe("risk");
  });

  it("is unoptimized when only a performance check fails with full coverage", () => {
    const checks = { D: [check("D.renders", "spec"), check("P.dedup-item", "performance")] };
    const records = [rec({ "D.renders": true, "P.dedup-item": false }), rec({ "D.renders": true, "P.dedup-item": false })];
    const out = callDomainCells(checks, records, 2) as Record<string, Json>;
    expect((out.D as Json).verdict, "harness/domain_trust.py domain_cells unoptimized verdict").toBe("unoptimized");
    expect((out.D as Json).gaps, "harness/domain_trust.py domain_cells unoptimized gaps").toEqual([]);
  });

  it("prefers risk over unproven", () => {
    const checks = { F: [check("F.checkout-record", "spec"), check("F.lifecycle", "spec")] };
    const records = [rec({ "F.checkout-record": false }), rec({ "F.checkout-record": true, "F.lifecycle": true })];
    const out = callDomainCells(checks, records, 2) as Record<string, Json>;
    expect((out.F as Json).verdict, "harness/domain_trust.py domain_cells risk-before-unproven verdict").toBe("risk");
    expect((out.F as Json).gaps, "harness/domain_trust.py domain_cells risk-before-unproven gaps empty").toEqual([]);
  });

  it("prefers unproven over unoptimized", () => {
    const checks = { C: [check("C.renders", "spec"), check("P.n-plus-one", "performance")] };
    const records = [rec({ "C.renders": true, "P.n-plus-one": false }), rec({ "C.renders": true })];
    const out = callDomainCells(checks, records, 2) as Record<string, Json>;
    expect((out.C as Json).verdict, "harness/domain_trust.py domain_cells unproven-before-unoptimized verdict").toBe("unproven");
    expect((out.C as Json).failures, "harness/domain_trust.py domain_cells unproven-before-unoptimized failures listed").toEqual([
      { id: "P.n-plus-one", kind: "performance", text: "P.n-plus-one text", failed: 1, graded: 1 },
    ]);
  });

  it("applies the since rule and counts probes in every revision", () => {
    const checks = { E: [check("E.labels", "spec", 2), check("E.submits", "spec", 1)] };
    const records = [
      rec({ "E.labels": false, "E.submits": true }, 1),
      rec({ "E.labels": false, "E.submits": true }, 1),
      rec({ "E.labels": true, "E.submits": true }, 2),
      rec({ "E.labels": true, "E.submits": true }, 2),
    ];
    const out = callDomainCells(checks, records, 2) as Record<string, Json>;
    expect((out.E as Json).verdict, "harness/domain_trust.py domain_cells since-rule verdict").toBe("safe");

    const probeChecks = { G: [check("P.concurrent-return", "robustness")] };
    const probeRecords = [rec({ "P.concurrent-return": false }, 1), rec({ "P.concurrent-return": true }, 1)];
    const probeOut = callDomainCells(probeChecks, probeRecords, 2) as Record<string, Json>;
    expect((probeOut.G as Json).verdict, "harness/domain_trust.py domain_cells probe-counts-in-revision-1").toBe("risk");
  });

  it("is unproven on a missing key and ignores non-boolean values", () => {
    const checks = { A: [check("A.returned", "spec"), check("A.ok", "spec")] };
    const records = [rec({ "A.returned": true, "A.ok": true }), rec({ "A.returned": true })];
    const out = callDomainCells(checks, records, 2) as Record<string, Json>;
    expect((out.A as Json).verdict, "harness/domain_trust.py domain_cells missing-key verdict").toBe("unproven");
    expect((out.A as Json).gaps, "harness/domain_trust.py domain_cells missing-key gaps").toEqual([{ id: "A.ok", graded: 1 }]);

    const odd = { A: [check("A.returned", "spec")] };
    const oddRecords = [rec({ "A.returned": null }), rec({ "A.returned": "yes" })];
    const oddOut = callDomainCells(odd, oddRecords, 2) as Record<string, Json>;
    expect((oddOut.A as Json).verdict, "harness/domain_trust.py domain_cells non-boolean verdict").toBe("unproven");
    expect((oddOut.A as Json).failures, "harness/domain_trust.py domain_cells non-boolean never a failure").toEqual([]);
  });

  it("needs N_MIN coverage, is unproven on empty input, and sorts failures", () => {
    const checks = { A: [check("A.returned", "spec")] };
    const clean = [rec({ "A.returned": true }), rec({ "A.returned": true })];
    const high = callDomainCells(checks, clean, 3) as Record<string, Json>;
    expect((high.A as Json).verdict, "harness/domain_trust.py domain_cells higher-N_MIN verdict").toBe("unproven");
    expect((high.A as Json).min_coverage, "harness/domain_trust.py domain_cells higher-N_MIN coverage").toBe(2);

    const empty = callDomainCells({ A: [check("A.returned", "spec")] }, [], 2) as Record<string, Json>;
    for (const domain of "ABCDEFGH") {
      expect((empty[domain] as Json).verdict, `harness/domain_trust.py domain_cells empty input ${domain}`).toBe("unproven");
    }
    expect((empty.A as Json).min_coverage, "harness/domain_trust.py domain_cells empty min_coverage").toBe(0);

    const orderChecks = { G: [check("G.401", "spec"), check("G.400", "spec"), check("P.concurrent-return", "robustness")] };
    const orderRecords = [
      rec({ "G.401": false, "G.400": false, "P.concurrent-return": false }),
      rec({ "G.401": false, "G.400": true, "P.concurrent-return": true }),
      rec({ "G.401": true, "G.400": true, "P.concurrent-return": true }),
    ];
    const orderOut = callDomainCells(orderChecks, orderRecords, 2) as Record<string, Json>;
    expect(
      ((orderOut.G as Json).failures as Json[]).map((f) => f.id),
      "harness/domain_trust.py domain_cells failure order",
    ).toEqual(["G.401", "G.400", "P.concurrent-return"]);

    const shuffled = callDomainCells(checks, [...clean].reverse(), 2);
    expect(shuffled, "harness/domain_trust.py domain_cells determinism (NFR-4)").toEqual(callDomainCells(checks, clean, 2));
  });
});

// --- Export tests on a temporary root (FR-3, FR-4) ---

const BASE_KEYS = [
  "advisory_ids",
  "benchmark",
  "criteria_tiers",
  "domains",
  "experiments",
  "history",
  "models",
  "pricing",
  "probe_tiers",
  "reference",
  "schema",
];

function batchPricing(models: Record<string, Json>): Json {
  return {
    schema: 1,
    source: "synthetic",
    retrieved: "2026-10-25",
    high_usage_min_requests_per_month: 7000,
    deepseek_rate: "off-peak",
    provider: "opencode-go",
    apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
    aliases: {},
    models,
  };
}

function batchModel(name: string): Json {
  return {
    name,
    api: "openai-completions",
    high_usage: true,
    batch: true,
    requests_per_month: 10000,
    monthly_usage_usd: 15,
    rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
  };
}

function makeTrustRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "domain-trust-export-"));
  mkdirSync(join(root, "harness/tests/meta"), { recursive: true });
  mkdirSync(join(root, "runs"), { recursive: true });
  cpSync(EXPORT_SCRIPT, join(root, "harness/export-site-data.py"));
  if (existsSync(DOMAIN_TRUST_SRC)) cpSync(DOMAIN_TRUST_SRC, join(root, "harness/domain_trust.py"));
  cpSync(resolve(HARNESS, "tests/criteria.ts"), join(root, "harness/tests/criteria.ts"));
  cpSync(resolve(HARNESS, "tests/spec-matrix.ts"), join(root, "harness/tests/spec-matrix.ts"));
  cpSync(resolve(HARNESS, "tests/meta/spec-matrix-contract.ts"), join(root, "harness/tests/meta/spec-matrix-contract.ts"));
  writeJson(
    join(root, "harness/go-pricing.json"),
    batchPricing({ "trust-alpha": batchModel("Trust Alpha"), "trust-beta": batchModel("Trust Beta") }),
  );
  return root;
}

function writeRun(
  root: string,
  runId: string,
  opts: { model: string; arm: "a" | "b"; pi: boolean; revision: number; valid: boolean; total: number; results?: Record<string, boolean> },
): void {
  const artifacts = join(root, "runs", runId, "artifacts");
  mkdirSync(artifacts, { recursive: true });
  writeJson(join(artifacts, "score.json"), {
    schema: 3,
    track: "build",
    run_id: runId,
    model: opts.model,
    arm: opts.arm,
    valid: opts.valid,
    trusted: true,
    publishable: true,
    rankable: true,
    total: opts.total,
    fixture_revision: opts.revision,
  });
  if (opts.results !== undefined) writeJson(join(artifacts, "results.json"), opts.results);
  writeJson(
    join(artifacts, "provenance.json"),
    opts.pi
      ? { track: "build", fixture_revision: opts.revision, executor: { pi: { version: "test-pi" } } }
      : { track: "build", fixture_revision: opts.revision, executor: { kind: "opencode", opencode: { version: "test" } } },
  );
}

function seedTrustRoot(root: string): void {
  const base: Record<string, boolean> = {
    "A.returned": true,
    "F.auth-return": true,
    "P.no-key-leak": true,
  };
  // Revision 1 Pi record: unstated E.labels / E.error-announced must not count as failures.
  writeRun(root, "a-trust-alpha-2026w40-r1", {
    model: "trust-alpha",
    arm: "a",
    pi: false,
    revision: 1,
    valid: true,
    total: 70,
    results: { ...base, "E.labels": false, "E.error-announced": false },
  });
  // Revision 2 Pi record in the other arm: pooling keeps both executors.
  writeRun(root, "b-trust-alpha-2026w40-r1", {
    model: "trust-alpha",
    arm: "b",
    pi: true,
    revision: 2,
    valid: true,
    total: 72,
    results: { ...base, "E.labels": false, "E.error-announced": true },
  });
  // Invalid run and result-less run never count.
  writeRun(root, "a-trust-alpha-2026w40-r2", {
    model: "trust-alpha",
    arm: "a",
    pi: false,
    revision: 1,
    valid: false,
    total: 10,
    results: { ...base, "A.returned": false },
  });
  writeRun(root, "a-trust-alpha-2026w40-r9", {
    model: "trust-alpha",
    arm: "a",
    pi: false,
    revision: 1,
    valid: true,
    total: 71,
  });
  // Sibling slug and outside-catalog model never count.
  writeRun(root, "a-trust-alpha-pro-2026w40-r1", {
    model: "trust-alpha-pro",
    arm: "a",
    pi: false,
    revision: 1,
    valid: true,
    total: 99,
    results: { ...base, "A.returned": false },
  });
  // Second model with a higher score but a higher id: rows sort by id.
  writeRun(root, "b-trust-beta-2026w40-r1", {
    model: "trust-beta",
    arm: "b",
    pi: false,
    revision: 2,
    valid: true,
    total: 95,
    results: { ...base, "E.labels": true, "E.error-announced": true },
  });
}

function runExport(root: string): ReturnType<typeof spawnSync> {
  return spawnSync("python3", [join(root, "harness/export-site-data.py")], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
}

function exportPayload(root: string): Json {
  const first = runExport(root);
  expect(first.status, `domain_trust export must run: ${first.stderr}`).toBe(0);
  return JSON.parse(readFileSync(join(root, "docs/assets/data/benchmark.json"), "utf8")) as Json;
}

describe("domain trust export (FR-3, FR-4)", () => {
  it("applies the since rule in domains.E", () => {
    const root = makeTrustRoot();
    try {
      seedTrustRoot(root);
      const payload = exportPayload(root);
      const history = payload.history as Json;
      const models = history.models as Json[];
      expect(models.length, "domain_trust export history must list a model").toBeGreaterThan(0);
      const alpha = models.find((m) => m.id === "trust-alpha") as Json;
      const noSkills = alpha.no_skills as Json | null;
      const entry = (noSkills ?? alpha.skills) as Json;
      const domains = entry.domains as Record<string, Json>;
      expect(domains, "domain_trust export entry must hold a domains block").toBeDefined();
      const failed = (domains.E as Json).failed as string[];
      expect(
        failed.includes("E.labels") || failed.includes("E.error-announced"),
        "FR-3 since rule needs harness/domain_trust.py load_entry fix: revision 1 domains.E.failed must not list E.labels or E.error-announced",
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("counts only valid records with results for catalog models", () => {
    const root = makeTrustRoot();
    try {
      seedTrustRoot(root);
      const payload = exportPayload(root);
      const block = payload.domain_trust as Json;
      expect(block, "domain_trust export block field domain_trust is missing").toBeDefined();
      const models = (block as Json).models as Json[];
      expect(models.map((m) => m.id).sort(), "domain_trust models field").toEqual(["trust-alpha", "trust-beta"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("pools arms and executors and sorts rows by id", () => {
    const root = makeTrustRoot();
    try {
      seedTrustRoot(root);
      const payload = exportPayload(root);
      const block = payload.domain_trust as Json;
      expect(block, "domain_trust export block field domain_trust is missing").toBeDefined();
      const models = (block.models as Json[]) ?? [];
      expect(models.map((m) => m.id), "domain_trust rows field must sort by id, never by score").toEqual([
        "trust-alpha",
        "trust-beta",
      ]);
      const alpha = models.find((m) => m.id === "trust-alpha") as Json;
      const runs = alpha.runs as Json;
      expect(runs, "domain_trust runs field is missing").toMatchObject({
        total: 2,
        opencode: 1,
        pi: 1,
        arm_a: 1,
        arm_b: 1,
      });
      expect(runs.run_ids, "domain_trust run_ids field is missing").toEqual([
        "a-trust-alpha-2026w40-r1",
        "b-trust-alpha-2026w40-r1",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes the block shape and the check texts", () => {
    const root = makeTrustRoot();
    try {
      seedTrustRoot(root);
      const payload = exportPayload(root);
      const block = payload.domain_trust as Json;
      expect(block, "domain_trust export block field domain_trust is missing").toBeDefined();
      expect(block.schema, "domain_trust rule field schema is missing").toBe(1);
      const rule = block.rule as Json;
      expect(rule.n_min, "domain_trust rule field n_min is missing").toBe(2);
      expect(rule.verdicts, "domain_trust rule field verdicts is missing").toEqual(["risk", "unproven", "unoptimized", "safe"]);
      expect(Object.keys((rule.kinds as Json) ?? {}).sort(), "domain_trust rule field kinds is missing").toEqual([
        "performance",
        "robustness",
        "spec",
      ]);
      const checks = block.checks as Record<string, Json[]>;
      const byId = Object.fromEntries(Object.entries(checks ?? {}).flatMap(([d, list]) => list.map((c) => [c.id, { ...c, domain: d }])));
      expect(byId["A.returned"], "domain_trust checks field must list A.returned").toBeDefined();
      expect((byId["A.returned"] as Json).text, "domain_trust checks field text of A.returned").toContain("returned status");
      expect(byId["F.auth-return"], "domain_trust checks field must list F.auth-return").toBeDefined();
      expect(String((byId["F.auth-return"] as Json).text ?? ""), "domain_trust checks field text of F.auth-return").not.toBe("");
      expect(byId["P.no-key-leak"], "domain_trust checks field must list P.no-key-leak").toBeDefined();
      expect((byId["P.no-key-leak"] as Json).text, "domain_trust checks field text of P.no-key-leak").toContain("staff credential");
      for (const list of Object.values(checks ?? {})) {
        for (const c of list) expect(String(c.text ?? ""), `domain_trust checks field text of ${c.id}`).not.toBe("");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the other top-level keys and is deterministic", () => {
    const root = makeTrustRoot();
    try {
      seedTrustRoot(root);
      const payload = exportPayload(root);
      expect(Object.keys(payload).sort(), "domain_trust export must keep the base keys plus domain_trust").toEqual(
        [...BASE_KEYS, "domain_trust", "generated_at"].sort(),
      );
      const second = runExport(root);
      expect(second.status, `domain_trust export must run twice: ${second.stderr}`).toBe(0);
      const again = JSON.parse(readFileSync(join(root, "docs/assets/data/benchmark.json"), "utf8")) as Json;
      expect((again as Json).domain_trust, "domain_trust block field domain_trust is missing").toBeDefined();
      expect(
        JSON.stringify((again as Json).domain_trust),
        "domain_trust block must be deterministic (NFR-4)",
      ).toBe(JSON.stringify((payload as Json).domain_trust));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
