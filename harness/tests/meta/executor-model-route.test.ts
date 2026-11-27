import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activeApiRow,
  catalogComment,
  HARNESS,
  IMAGE,
  podmanRecorderScript,
  ROOT,
  type ExecutorCatalog,
} from "./opencode-run-fixtures";
import { createFakeOpencode, TEST_MODEL } from "./schema4-fixtures";

const PROVIDER = "opencode-go";
const PRESENT_MODEL = TEST_MODEL;
const MISSING_MODEL = "hungerg-free";
const PRESENT_REF = `${PROVIDER}/${PRESENT_MODEL}`;
const MISSING_REF = `${PROVIDER}/${MISSING_MODEL}`;
const LIMIT = { context: 1000000, input: 1000000, output: 65536 };
// N1: the real Console API entries for catalog-listed Go models carry only
// context and output. The OpenCode config accepts input as an optional key.
const TWO_KEY_LIMIT = { context: 1000000, output: 384000 };

const DENIES = [
  { action: "question", resource: "*", effect: "deny" },
  { action: "websearch", resource: "*", effect: "deny" },
  { action: "subagent", resource: "*", effect: "deny" },
  { action: "read", resource: "/tmp/data/**", effect: "deny" },
  { action: "edit", resource: "/tmp/data/**", effect: "deny" },
  { action: "skill", resource: "*", effect: "deny" },
];

function expectedConfigBytes(modelRef: string, providers?: Record<string, unknown>): string {
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    model: modelRef,
    permissions: DENIES,
  };
  if (providers !== undefined) config.providers = providers;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function entryValue(model: string, name?: string): Record<string, unknown> {
  return { modelID: model, name: name ?? `${model} Name`, limit: { ...LIMIT } };
}

/** N1: the entry printed for a limit that omits optional input. */
function entryValueWithLimit(model: string, limit: Record<string, number>): Record<string, unknown> {
  return { modelID: model, name: `${model} Name`, limit: { ...limit } };
}

function providersBlock(provider: string, model: string, entry: unknown): Record<string, unknown> {
  return { [provider]: { models: { [model]: entry } } };
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function realPython3(): string {
  return spawnSync("bash", ["-c", "command -v python3"], { encoding: "utf8" }).stdout.trim();
}

/** Counts every helper call through a PATH shim that delegates to real python3. */
function installPythonCounter(run: { repo: string; env: NodeJS.ProcessEnv }): string {
  const shimDir = resolve(run.repo, "pyshim");
  mkdirSync(shimDir, { recursive: true });
  const log = resolve(run.repo, "python3-calls.jsonl");
  writeFileSync(
    resolve(shimDir, "python3"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realPython3())} "$@"\n`,
  );
  chmodSync(resolve(shimDir, "python3"), 0o755);
  run.env.PATH = `${shimDir}:${run.env.PATH}`;
  return log;
}

function helperCalls(log: string): string[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter((line) => line.includes("model-api-refs.py"));
}

function entryCalls(log: string): string[] {
  return helperCalls(log).filter((line) => line.includes(`${PROVIDER}/`));
}

type TempRun = {
  repo: string;
  harness: string;
  bin: string;
  runtime: string;
  fake: { path: string; capture: string; control: string };
  apiFile: string;
  podmanControl: string;
  podmanCapture: string;
  podmanCalls: string;
  id: string;
  out: string;
  env: NodeJS.ProcessEnv;
  cleanup(): void;
};

/**
 * Stages a temp repo that stands in for the project root: the harness
 * scripts, a node_modules link, the fixture app, a fake binary with a catalog
 * comment, a local API seam, and the fake Podman recorder. Every run.sh path
 * (runs, .tmp, port locks, job folders) resolves under this repo. Nothing
 * here touches the real ROOT/runs, ROOT/reports, or ROOT/.tmp.
 */
function stageTempRepo(opts: {
  model?: string;
  catalog?: ExecutorCatalog;
  apiData?: unknown[];
}): TempRun {
  const repo = makeTempRoot();
  const harness = resolve(repo, "harness");
  mkdirSync(harness, { recursive: true });
  for (const entry of readdirSync(HARNESS, { withFileTypes: true })) {
    if (entry.isFile() && /\.(sh|ts|json|cjs|py)$/.test(entry.name)) {
      copyFileSync(resolve(HARNESS, entry.name), resolve(harness, entry.name));
    } else if (entry.isDirectory() && entry.name === "node_modules") {
      symlinkSync(resolve(HARNESS, entry.name), resolve(harness, entry.name), "dir");
    }
  }
  // F15: the provenance step resolves track bindings through the bugfix,
  // tests-track, change, docs-and-ops, and tests trees. Copy those small
  // trees so the temp run reaches the leak gate instead of aborting on a
  // missing module.
  for (const tree of ["bugfix", "tests-track", "change", "docs-and-ops", "tests"]) {
    cpSync(resolve(HARNESS, tree), resolve(harness, tree), { recursive: true });
  }
  // F15: provenance hashes the reference overlays from the repo root. Copy
  // those small trees so the temp run reaches the leak gate instead of
  // aborting on a missing directory.
  for (const tree of ["reference", "reference-variant", "reference-change"]) {
    cpSync(resolve(ROOT, tree), resolve(repo, tree), { recursive: true });
  }
  // F15: the temp fixture root is a real directory. The candidate contract
  // rejects a symlinked fixture root ("fixture root must be a real
  // directory") before the leak gate, which misattributes the exit-3 abort.
  // The copy skips node_modules (plus .next and .git); the seeder tar and
  // the contract walk skip those names too, so a node_modules symlink keeps
  // the staging fast without tripping either check.
  const fixtureDir = resolve(repo, "fixture");
  mkdirSync(fixtureDir, { recursive: true });
  const fixtureSrc = resolve(ROOT, "fixture");
  cpSync(fixtureSrc, fixtureDir, {
    recursive: true,
    filter: (src) => {
      const rel = relative(fixtureSrc, src);
      return rel === "" || !/^(node_modules|\.next|\.git)(\/|$)/.test(rel);
    },
  });
  symlinkSync(resolve(fixtureSrc, "node_modules"), resolve(fixtureDir, "node_modules"), "dir");
  const bin = resolve(repo, "bin");
  mkdirSync(bin, { recursive: true });
  const fake = createFakeOpencode(repo);
  const model = opts.model ?? TEST_MODEL;
  appendFileSync(fake.path, catalogComment(opts.catalog ?? "present", PROVIDER, model));
  const apiFile = resolve(repo, "model-api.json");
  writeFileSync(apiFile, JSON.stringify({
    location: { directory: "fake" },
    data: opts.apiData ?? [activeApiRow(PROVIDER, model)],
  }));
  const podmanControl = resolve(repo, "podman-control.json");
  writeFileSync(podmanControl, JSON.stringify({ mode: "entry" }));
  const podmanCapture = resolve(repo, "podman.json");
  const podmanCalls = resolve(repo, "podman-calls.jsonl");
  const id = `route-${process.pid}-${Date.now()}`;
  const out = resolve(repo, "runs", id, "artifacts");
  const runtime = resolve(repo, "runtime");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(resolve(bin, "podman"), podmanRecorderScript({
    temp: repo, out, runtime, podmanCapture, podmanControl,
    binDir: bin, nodePath: process.execPath,
  }));
  chmodSync(resolve(bin, "podman"), 0o755);
  const home = resolve(repo, "home");
  mkdirSync(home, { recursive: true });
  const skillRoot = resolve(repo, "skills");
  mkdirSync(skillRoot, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home, LANG: "C.UTF-8", _BENCH_ENV_LOADED: "1",
    BENCH_TRACK: "build", BENCH_IGNORE_LOAD: "1", BENCH_WAIT_FOR_IDLE: "0",
    BENCH_OPENCODE_BIN: fake.path, BENCH_SKILL_ROOT: skillRoot,
    BENCH_AGENT_IMAGE: IMAGE, BENCH_MODEL_API_BASE: apiFile,
    XDG_RUNTIME_DIR: runtime, AGENT_TIMEOUT: "2",
    MAX_LOAD_PER_CPU: "1000000", MIN_AVAIL_MB: "0", MAX_SWAP_USED_MB: "100000000",
    OPENCODE_API_KEY: "CANARY-ACCESS-99", THINKING: "xhigh",
  };
  return {
    repo, harness, bin, runtime, fake, apiFile, podmanControl, podmanCapture,
    podmanCalls, id, out, env,
    cleanup() { rmSync(repo, { recursive: true, force: true }); },
  };
}

type RouteResult = {
  run: TempRun;
  status: number | null;
  stdout: string;
  stderr: string;
  log: string;
  staging: string;
};

/** Stages a temp repo, installs the helper-call shim, applies the seam, and runs the real run.sh. */
async function runTempRoute(opts: {
  model?: string;
  catalog?: ExecutorCatalog;
  apiData?: unknown[];
  apiBase?: string;
  prep?: (run: TempRun) => void;
  execModel?: string;
}): Promise<RouteResult> {
  const run = stageTempRepo({ model: opts.model, catalog: opts.catalog, apiData: opts.apiData });
  const log = installPythonCounter(run);
  if (opts.apiBase !== undefined) run.env.BENCH_MODEL_API_BASE = opts.apiBase;
  if (opts.prep) opts.prep(run);
  const execModel = opts.execModel ?? opts.model ?? TEST_MODEL;
  const staging = resolve(run.runtime, "lending-desk-bench", run.id);
  const result = spawnSync("/bin/bash", [resolve(run.harness, "run.sh"), PROVIDER, execModel, "a", run.id], {
    cwd: run.harness, env: run.env, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  return { run, status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), log, staging };
}

const ROUTE_REASON = /model API|providerID\/modelID|OpenCode|opencode-go/;
const KNOWN_HOST_DIAGNOSTIC = [
  /HOST NOT READY/,
  /host busy/,
  /preflight exited/,
  /^\s{2}/,
];

/**
 * D3/F13: one short reason. An empty stderr never counts as a reason. Exactly
 * one line names the model-route failure; every other line must match the
 * explicit allow-list of known host diagnostics.
 */
function expectSingleRouteReason(stderr: string, label: string): void {
  const lines = stderr.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  expect(lines.length, `${label}: F1/D3 requires stderr, and an empty stderr is a failure`).toBeGreaterThan(0);
  const naming = lines.filter((line) => ROUTE_REASON.test(line));
  expect(naming.length, `${label}: F13/D3 requires exactly one line naming the model-route reason`).toBe(1);
  for (const line of lines) {
    if (naming.includes(line)) continue;
    expect(
      KNOWN_HOST_DIAGNOSTIC.some((known) => known.test(line)),
      `${label}: F13/D3 allows only the route reason and known host diagnostics (got: ${line})`,
    ).toBe(true);
  }
}

/**
 * The shared fixture's recorded session export carries canary texts, so every
 * full agent run ends in the NFR-1 leak gate after the route completes. The
 * route assertions below observe the config, identity, and cohort artifacts;
 * the status assertion pins that deterministic trap, not a route failure.
 */
function expectFullAgentTrap(r: RouteResult, label: string): void {  expect(r.status, `${label}: the route completes, then the fixture canary export trips the leak gate`).toBe(3);
  expect(r.stderr, `${label}: the NFR-1 gate names the credential leak`).toContain("Console credential reached run output");
  // F15: the final abort must name the leak gate. With a symlinked fixture
  // root the run aborted at the candidate contract instead, while the scan
  // line above still printed, so the status alone attributed exit 3 to the
  // wrong gate.
  expect(r.stderr, `${label}: the final abort names the leak gate, not the candidate contract`).toContain(
    "ABORT: Console credential reached run output",
  );
  expect(r.stderr, `${label}: the candidate contract accepts the real fixture root`).not.toContain(
    "candidate violates the filesystem contract",
  );
}

/**
 * F1/D3: the failure contract of the entry route through the real run.sh.
 * A catalog scan error exits before the entry, so no helper call happens;
 * every other failure attempts the entry first.
 */
/**
 * F13: a node shim that fails only the config-generator invocation. The shim
 * matches the generator by its distinctive environment (MODEL_ENTRY_PATH and
 * CONFIG_TMP are set only for that call) and delegates every other node call
 * to the real binary. It prints nothing, so the run.sh reason stays the only
 * stderr line. It works no matter how often run.sh recreates $WORK.
 */
function installFailingGeneratorShim(run: TempRun): void {
  const shimDir = resolve(run.repo, "nodeshim");
  mkdirSync(shimDir, { recursive: true });
  const realNode = resolve(dirname(process.execPath), "node");
  writeFileSync(
    resolve(shimDir, "node"),
    `#!/usr/bin/env bash\nif [ -n "\${MODEL_ENTRY_PATH:-}" ] && [ -n "\${CONFIG_TMP:-}" ]; then exit 1; fi\nexec ${JSON.stringify(realNode)} "$@"\n`,
  );
  chmodSync(resolve(shimDir, "node"), 0o755);
  run.env.PATH = `${shimDir}:${run.env.PATH}`;
}

function expectEntryFailure(r: RouteResult, label: string, entry: "attempted" | "none" = "attempted"): void {
  expect(r.status, `${label}: F1/D3 requires the script to exit 2, not continue into provenance and grading`).toBe(2);
  expectSingleRouteReason(r.stderr, label);
  expect(existsSync(resolve(r.run.out, "executor/opencode.json")), `${label}: F1/D3 writes no partial config`).toBe(false);
  expect(existsSync(resolve(r.run.out, "execution-identity.json")), `${label}: F1 builds no identity on the failure path`).toBe(false);
  expect(existsSync(resolve(r.run.out, "executor-cohort.json")), `${label}: F1 builds no cohort on the failure path`).toBe(false);
  expect(existsSync(resolve(r.run.out, "provenance.json")), `${label}: F1 exits before provenance`).toBe(false);
  expect(existsSync(resolve(r.run.out, "score.json")), `${label}: F1 exits before grading`).toBe(false);
  expect(existsSync(r.staging), `${label}: F1 leaves no credential staging under CRED_STAGING`).toBe(false);
  if (entry === "attempted") {
    expect(entryCalls(r.log).length, `${label}: F1 attempts the helper entry`).toBeGreaterThan(0);
  } else {
    expect(helperCalls(r.log).length, `${label}: F6/D2 a scan error makes no API call`).toBe(0);
  }
}

function configPath(run: TempRun): string {
  return resolve(run.out, "executor/opencode.json");
}

function disabledRow(): Record<string, unknown> {
  return { ...activeApiRow(PROVIDER, MISSING_MODEL), enabled: false };
}

function inactiveRow(): Record<string, unknown> {
  return { ...activeApiRow(PROVIDER, MISSING_MODEL), status: "inactive" };
}

describe("F2/FR2: the real run.sh keeps the catalog model unchanged", () => {
  it("a catalog-present model gets exact config bytes, no providers key, and no API call", async () => {
    const r = await runTempRoute({ model: PRESENT_MODEL, catalog: "present" });
    try {
      expectFullAgentTrap(r, "F2/FR2: the present-model run");
      const bytes = readFileSync(configPath(r.run), "utf8");
      expect(bytes, "F2/FR2: the generated config must equal the current bytes").toBe(expectedConfigBytes(PRESENT_REF));
      expect(JSON.parse(bytes), "F2/FR2: the present-model config has no providers key").not.toHaveProperty("providers");
      expect(helperCalls(r.log).length, "F2/FR2: a catalog-present model makes no API call").toBe(0);
      const identity = JSON.parse(readFileSync(resolve(r.run.out, "execution-identity.json"), "utf8"));
      const cohort = JSON.parse(readFileSync(resolve(r.run.out, "executor-cohort.json"), "utf8"));
      expect(identity.model_ref, "FR5: the identity records the run model").toBe(PRESENT_REF);
      expect(identity.config_sha256, "FR5: the identity hashes the generated config").toBe(sha256Hex(bytes));
      expect(cohort.config_sha256, "FR5: the cohort hashes the generated config").toBe(sha256Hex(bytes));
    } finally {
      r.run.cleanup();
    }
  }, 120_000);
});

describe("F2/FR1: the real run.sh routes a catalog-missing model through the helper", () => {
  it("a catalog-missing model gets the three-field provider block with exact bytes", async () => {
    const r = await runTempRoute({ model: MISSING_MODEL, catalog: "missing" });
    try {
      expectFullAgentTrap(r, "F2/FR1: the missing-model run");
      const entry = entryValue(MISSING_MODEL);
      const bytes = readFileSync(configPath(r.run), "utf8");
      expect(bytes, "F2/FR1: the missing-model config holds the three-field provider block").toBe(
        expectedConfigBytes(MISSING_REF, providersBlock(PROVIDER, MISSING_MODEL, entry)),
      );
      expect(entryCalls(r.log).length, "F2/FR1: the missing-model run resolves one helper entry").toBe(1);
      const identity = JSON.parse(readFileSync(resolve(r.run.out, "execution-identity.json"), "utf8"));
      const cohort = JSON.parse(readFileSync(resolve(r.run.out, "executor-cohort.json"), "utf8"));
      expect(identity.model_ref, "FR5: the identity records the missing model").toBe(MISSING_REF);
      expect(identity.config_sha256, "FR5: the identity hashes the provider-block config").toBe(sha256Hex(bytes));
      expect(cohort.model_ref, "FR5: the cohort records the missing model").toBe(MISSING_REF);
      expect(cohort.config_sha256, "FR5: the cohort hashes the provider-block config").toBe(sha256Hex(bytes));
      expect(cohort.id, "FR5: the derived cohort id names the executor family").toMatch(/^opencode-/);
      expect("BENCH_EXECUTOR_COHORT_ID" in r.run.env, "FR5: no role pins BENCH_EXECUTOR_COHORT_ID").toBe(false);
    } finally {
      r.run.cleanup();
    }
  }, 120_000);
});

describe("F1/F2: every failure class exits 2 through the real run.sh", () => {
  const cases: { name: string; opts: Parameters<typeof runTempRoute>[0] }[] = [
    { name: "a disabled entry", opts: { model: MISSING_MODEL, catalog: "missing", apiData: [disabledRow()] } },
    { name: "an inactive entry", opts: { model: MISSING_MODEL, catalog: "missing", apiData: [inactiveRow()] } },
    {
      name: "a missing active entry",
      opts: { model: MISSING_MODEL, catalog: "missing", apiData: [activeApiRow(PROVIDER, "other-model")] },
    },
    {
      name: "an unreachable local API base, so no leak can reach the real default API",
      opts: { model: MISSING_MODEL, catalog: "missing", apiBase: "http://127.0.0.1:1" },
    },
    {
      name: "malformed JSON",
      opts: {
        model: MISSING_MODEL, catalog: "missing",
        prep: (run) => writeFileSync(run.apiFile, "{not json"),
      },
    },
    {
      name: "a model ID with a space",
      opts: { model: MISSING_MODEL, catalog: "missing", execModel: "bad model" },
    },
    {
      name: "a model ID with a semicolon",
      opts: { model: MISSING_MODEL, catalog: "missing", execModel: "evil;id" },
    },
  ];
  for (const failure of cases) {
    it(`${failure.name} exits 2 with one reason and no config, staging, provenance, or score`, async () => {
      const r = await runTempRoute(failure.opts);
      try {
        expectEntryFailure(r, `F1/FR1: ${failure.name}`);
      } finally {
        r.run.cleanup();
      }
    }, 120_000);
  }

  function startRedirector(): Promise<{ port: number; hitsFile: string; kill: () => void }> {
    const dir = makeTempRoot();
    const hitsFile = resolve(dir, "hits.txt");
    writeFileSync(hitsFile, "");
    const payload = JSON.stringify({ location: { directory: "fake" }, data: [activeApiRow(PROVIDER, MISSING_MODEL)] });
    writeFileSync(resolve(dir, "redirector.cjs"), `
const http = require("node:http");
const fs = require("node:fs");
const server = http.createServer((req, res) => {
  if (req.url === "/redir/api/model") {
    res.writeHead(302, { location: "/real/api/model" });
    res.end();
  } else if (req.url === "/real/api/model") {
    fs.appendFileSync(${JSON.stringify(hitsFile)}, "HIT\\n");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(${JSON.stringify(payload)});
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(0, "127.0.0.1", () => console.log("REDIRECTOR_PORT=" + server.address().port));
setTimeout(() => process.exit(0), 25000).unref();
`);
    return new Promise((resolveDone, reject) => {
      const child = spawn(process.execPath, [resolve(dir, "redirector.cjs")], { stdio: ["ignore", "pipe", "inherit"] });
      child.stdout.setEncoding("utf8");
      let buf = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("the redirector did not start"));
      }, 10_000);
      child.stdout.on("data", (chunk: string) => {
        buf += chunk;
        const m = buf.match(/REDIRECTOR_PORT=(\d+)/);
        if (m) {
          clearTimeout(timer);
          resolveDone({ port: Number(m[1]), hitsFile, kill: () => { child.kill("SIGKILL"); } });
        }
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  it("a redirect exits 2 and never calls the valid redirect target", async () => {
    const redirector = await startRedirector();
    try {
      const r = await runTempRoute({
        model: MISSING_MODEL, catalog: "missing", apiBase: `http://127.0.0.1:${redirector.port}/redir`,
      });
      try {
        expectEntryFailure(r, "F1/FR1: a redirect");
        expect(readFileSync(redirector.hitsFile, "utf8"), "F2: the no-redirect rule keeps the valid target at zero calls").toBe("");
      } finally {
        r.run.cleanup();
      }
    } finally {
      redirector.kill();
    }
  }, 120_000);
});

describe("F6/D2: the catalog test is scoped to the requested provider object", () => {
  it("a model ID present only under another provider is a miss with the provider block", async () => {
    const r = await runTempRoute({ model: MISSING_MODEL, catalog: "missing-provider" });
    try {
      expectFullAgentTrap(r, "F6/D2: the other-provider run");
      const entry = entryValue(MISSING_MODEL);
      const bytes = readFileSync(configPath(r.run), "utf8");
      expect(bytes, "F6/D2: a global byte match does not count; the miss takes the entry route").toBe(
        expectedConfigBytes(MISSING_REF, providersBlock(PROVIDER, MISSING_MODEL, entry)),
      );
      expect(entryCalls(r.log).length, "F6/D2: the provider-scoped miss resolves one helper entry").toBe(1);
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a binary with no parseable catalog exits 2 instead of taking the miss path", async () => {
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => {
        const kept = readFileSync(run.fake.path, "utf8").split("\n").filter((line) => !line.includes("EXECUTOR_CATALOG"));
        writeFileSync(run.fake.path, kept.join("\n"));
      },
    });
    try {
      expectEntryFailure(r, "F6/D2: an unparsable binary", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a binary with a truncated catalog object exits 2 instead of taking the miss path", async () => {
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => {
        const kept = readFileSync(run.fake.path, "utf8").split("\n").filter((line) => !line.includes("EXECUTOR_CATALOG"));
        writeFileSync(run.fake.path, `${kept.join("\n")}\n// EXECUTOR_CATALOG {"${PROVIDER}":{"models":{"${MISSING_MODEL}":`);
      },
    });
    try {
      expectEntryFailure(r, "F6/D2: a truncated catalog", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a missing provider object is a miss, or exits 2 with one reason", async () => {
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => {
        const kept = readFileSync(run.fake.path, "utf8").split("\n").filter((line) => !line.includes("EXECUTOR_CATALOG"));
        writeFileSync(run.fake.path, `${kept.join("\n")}\n// EXECUTOR_CATALOG {"unrelated":{"models":{}}}\n`);
      },
    });
    try {
      const configExists = existsSync(configPath(r.run));
      const viaMiss = configExists
        && JSON.parse(readFileSync(configPath(r.run), "utf8")).providers?.[PROVIDER]?.models?.[MISSING_MODEL] !== undefined
        && entryCalls(r.log).length === 1;
      if (viaMiss) {
        expectFullAgentTrap(r, "F6/D2: the missing-provider run");
        return;
      }
      expectEntryFailure(r, "F6/D2: the missing provider object", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);
});

describe("F3/D9: the temp repo defaults to a present binary and a local seam", () => {
  it("the default fake binary is catalog-present and the default seam is a local file", () => {
    const run = stageTempRepo({ model: PRESENT_MODEL, catalog: "present" });
    try {
      const binary = readFileSync(run.fake.path, "utf8");
      expect(binary.includes(`"${PROVIDER}":{"models"`), "F3/D9: the default binary carries a provider catalog object").toBe(true);
      expect(binary.includes(`"${TEST_MODEL}":{"id":"${TEST_MODEL}"`), "F3/D9: the default catalog holds the run model").toBe(true);
      expect(run.env.BENCH_MODEL_API_BASE, "F3/FR3: the default seam is a local file, never the real default API").toBe(run.apiFile);
      expect(existsSync(run.apiFile), "F3/FR3: the default seam file exists").toBe(true);
    } finally {
      run.cleanup();
    }
  });

  it("a missing-model case is an explicit catalog option", () => {
    const run = stageTempRepo({ model: MISSING_MODEL, catalog: "missing" });
    try {
      const binary = readFileSync(run.fake.path, "utf8");
      expect(binary.includes(`"${MISSING_MODEL}":{"id":"${MISSING_MODEL}"`), "F3/D9: the missing option drops the model").toBe(false);
      expect(run.env.BENCH_MODEL_API_BASE, "F3/FR3: the explicit case keeps the local seam").toBe(run.apiFile);
    } finally {
      run.cleanup();
    }
  });
});

/** Copies the helper into a temp repo and runs the entry mode. No real API. */
function makeTempRoot(): string {
  mkdirSync(resolve(tmpdir(), "opencode"), { recursive: true });
  return mkdtempSync(resolve(tmpdir(), "opencode", "exec-route-"));
}

const HELPER = resolve(HARNESS, "model-api-refs.py");

function runEntryCopy(opts: {
  ref?: string;
  envBase?: string;
  unsetBase?: boolean;
  files?: Record<string, string>;
}): { status: number; stdout: string; stderr: string; root: string } {
  const root = makeTempRoot();
  const harness = resolve(root, "harness");
  mkdirSync(harness, { recursive: true });
  const helperCopy = resolve(harness, "model-api-refs.py");
  if (!existsSync(HELPER)) throw new Error("FR1: harness/model-api-refs.py is missing");
  copyFileSync(HELPER, helperCopy);
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    writeFileSync(resolve(root, name), content);
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.unsetBase) delete env.BENCH_MODEL_API_BASE;
  else if (opts.envBase !== undefined) env.BENCH_MODEL_API_BASE = opts.envBase;
  const args = opts.ref === undefined ? [] : [opts.ref];
  const result = spawnSync("python3", ["-I", helperCopy, ...args], {
    cwd: root, env, encoding: "utf8", timeout: 20_000,
  });
  return { status: result.status ?? 99, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), root };
}

function entryPayload(rows: unknown[]): string {
  return JSON.stringify({ location: { directory: "fake" }, data: rows });
}

function expectEntryRejects(ref: string, rows: unknown[], label: string): void {
  const apiFile = resolve(makeTempRoot(), "api.json");
  writeFileSync(apiFile, entryPayload(rows));
  const run = runEntryCopy({ ref, envBase: apiFile });
  expect(run.status, `${label}: F4/FR4 requires exit 2`).toBe(2);
  expect(run.stdout, `${label}: F4/FR4 requires empty stdout`).toBe("");
  expect(run.stderr.trim().length, `${label}: an empty stderr never counts as one reason`).toBeGreaterThan(0);
  expect(run.stderr.trim().split("\n").length, `${label}: F4/FR4 requires one short stderr reason`).toBe(1);
}

describe("F4/FR4: the helper validates the entry name and limit", () => {
  const ref = MISSING_REF;
  const good = () => activeApiRow(PROVIDER, MISSING_MODEL);

  it("a valid entry prints exactly modelID, name, and limit", () => {
    const apiFile = resolve(makeTempRoot(), "api.json");
    writeFileSync(apiFile, entryPayload([good()]));
    const run = runEntryCopy({ ref, envBase: apiFile });
    expect(run.status, "F4/FR4: a valid entry exits 0").toBe(0);
    expect(Object.keys(JSON.parse(run.stdout)).sort(), "F4/FR4: only modelID, name, and limit print").toEqual([
      "limit", "modelID", "name",
    ]);
  });

  it("a null, numeric, or empty name exits 2", () => {
    for (const name of [null, 42, ""]) {
      expectEntryRejects(ref, [{ ...good(), name }], `F4/FR4: name ${JSON.stringify(name)}`);
    }
  });

  it("a non-object limit exits 2", () => {
    for (const limit of ["big", null, ["context"]]) {
      expectEntryRejects(ref, [{ ...good(), limit }], `F4/FR4: limit ${JSON.stringify(limit)}`);
    }
  });

  it("an unexpected nested key exits 2", () => {
    for (const key of ["token", "baseURL", "header", "extra"]) {
      expectEntryRejects(ref, [{ ...good(), limit: { ...LIMIT, [key]: "x" } }], `F4/FR4: nested ${key}`);
    }
  });

  it("a negative, fractional, or non-numeric value exits 2", () => {
    expectEntryRejects(ref, [{ ...good(), limit: { ...LIMIT, context: -1 } }], "F4/FR4: negative context");
    expectEntryRejects(ref, [{ ...good(), limit: { ...LIMIT, input: 1.5 } }], "F4/FR4: fractional input");
    expectEntryRejects(ref, [{ ...good(), limit: { ...LIMIT, output: "65536" } }], "F4/FR4: string output");
    expectEntryRejects(ref, [{ ...good(), limit: { ...LIMIT, context: true } }], "F4/FR4: boolean context");
  });

  it("an oversized entry exits 2", () => {
    expectEntryRejects(ref, [{ ...good(), name: "n".repeat(262144) }], "F4/FR4: a 256 KiB name exceeds the transport bound");
  });
});

describe("F5/FR1: the ten-second deadline covers the whole read", () => {
  function dripServer(opts: { finite: boolean }): Promise<{ server: Server; url: string }> {
    const payload = entryPayload([activeApiRow(PROVIDER, MISSING_MODEL)]);
    const server = createServer((req, res) => {
      if (req.url !== "/api/model") {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      // The whole valid payload arrives first; whitespace drips follow and EOF
      // lands at 12 s. A reader that never checks the clock after EOF exits 0.
      if (opts.finite) res.write(payload);
      const timer = setInterval(() => res.write(" "), 3000);
      if (opts.finite) {
        setTimeout(() => {
          clearInterval(timer);
          res.end();
        }, 12_000);
      }
    });
    return new Promise((resolveListen) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        resolveListen({ server, url: `http://127.0.0.1:${port}` });
      });
    });
  }

  async function runEntryAsync(ref: string, base: string): Promise<{ status: number; stdout: string; stderr: string; ms: number }> {
    const root = makeTempRoot();
    const harness = resolve(root, "harness");
    mkdirSync(harness, { recursive: true });
    if (!existsSync(HELPER)) throw new Error("FR1: harness/model-api-refs.py is missing");
    copyFileSync(HELPER, resolve(harness, "model-api-refs.py"));
    const started = Date.now();
    return new Promise((resolveDone) => {
      const child = spawn("python3", ["-I", resolve(harness, "model-api-refs.py"), ref], {
        cwd: root, env: { ...process.env, BENCH_MODEL_API_BASE: base },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolveDone({ status: 99, stdout, stderr: `${stderr}F5: the bounded read timed out`, ms: Date.now() - started });
      }, 60_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolveDone({ status: code ?? 99, stdout, stderr, ms: Date.now() - started });
      });
    });
  }

  it("a finite slow response that ends after the deadline exits 2 within a bounded time", async () => {
    const { server, url } = await dripServer({ finite: true });
    try {
      const run = await runEntryAsync(MISSING_REF, url);
      expect(run.status, `F5/FR1: a response that ends after 10 s must exit 2 (got ${run.status})`).toBe(2);
      expect(run.ms, `F5/FR1: the deadline must stop the read promptly (took ${run.ms} ms)`).toBeLessThan(20_000);
      expect(run.stdout, "F5/FR1: a timed-out read prints nothing on stdout").toBe("");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }, 90_000);

  it("a never-ending drip exits 2", async () => {
    const { server, url } = await dripServer({ finite: false });
    try {
      const run = await runEntryAsync(MISSING_REF, url);
      expect(run.status, "F5/FR1: a never-ending response must exit 2").toBe(2);
      expect(run.stdout, "F5/FR1: a timed-out read prints nothing on stdout").toBe("");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }, 90_000);
});

describe("F7/FR1: duplicate rows select the first active and enabled match in both modes", () => {
  it("a disabled first row and an active later row agree, and the entry succeeds", () => {
    const rows = [disabledRow(), activeApiRow(PROVIDER, MISSING_MODEL)];
    const apiFile = resolve(makeTempRoot(), "api.json");
    writeFileSync(apiFile, entryPayload(rows));
    const entry = runEntryCopy({ ref: MISSING_REF, envBase: apiFile });
    expect(entry.status, "F7/FR1: the entry mode skips a disabled row for a later active row").toBe(0);
    const printed = JSON.parse(entry.stdout) as Record<string, unknown>;
    expect(Object.keys(printed).sort(), "F7/D1: the entry prints only modelID, name, and limit").toEqual([
      "limit", "modelID", "name",
    ]);
    expect(printed.name, "F7/FR1: the entry uses the active row").toBe(`${MISSING_MODEL} Name`);
    const listed = runEntryCopy({ envBase: apiFile });
    expect(listed.status, "F9: the zero-argument mode lists the active refs").toBe(0);
    expect(listed.stdout.split("\n").filter((line) => line.length > 0), "F9: ref-list mode prints the active ref").toEqual([
      MISSING_REF,
    ]);
  });

  it("an inactive first row and an active later row agree, and the entry succeeds", () => {
    const rows = [inactiveRow(), activeApiRow(PROVIDER, MISSING_MODEL)];
    const apiFile = resolve(makeTempRoot(), "api.json");
    writeFileSync(apiFile, entryPayload(rows));
    const entry = runEntryCopy({ ref: MISSING_REF, envBase: apiFile });
    expect(entry.status, "F7/FR1: the entry mode skips an inactive row for a later active row").toBe(0);
    expect((JSON.parse(entry.stdout) as Record<string, unknown>).name, "F7/FR1: the entry uses the active row").toBe(
      `${MISSING_MODEL} Name`,
    );
  });

  it("two active rows use the first", () => {
    const first = { ...activeApiRow(PROVIDER, MISSING_MODEL), name: "First Row" };
    const second = { ...activeApiRow(PROVIDER, MISSING_MODEL), name: "Second Row" };
    const apiFile = resolve(makeTempRoot(), "api.json");
    writeFileSync(apiFile, entryPayload([first, second]));
    const entry = runEntryCopy({ ref: MISSING_REF, envBase: apiFile });
    expect(entry.status, "F7/FR1: two active rows exit 0").toBe(0);
    expect((JSON.parse(entry.stdout) as Record<string, unknown>).name, "F7/FR1: the first active row wins").toBe("First Row");
  });
});

describe("F2/FR1: the entry read keeps the no-redirect rule against a valid target", () => {
  it("a redirect to a valid payload exits 2 and the target sees no request", async () => {
    let targetHits = 0;
    const payload = entryPayload([activeApiRow(PROVIDER, MISSING_MODEL)]);
    const server = createServer((req, res) => {
      if (req.url === "/api/model") {
        res.writeHead(302, { location: "/api/v2/model" });
        res.end();
      } else if (req.url === "/api/v2/model") {
        targetHits += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(payload);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const root = makeTempRoot();
      const harness = resolve(root, "harness");
      mkdirSync(harness, { recursive: true });
      if (!existsSync(HELPER)) throw new Error("FR1: harness/model-api-refs.py is missing");
      copyFileSync(HELPER, resolve(harness, "model-api-refs.py"));
      const run: { status: number; stdout: string; stderr: string } = await new Promise((resolveDone) => {
        const child = spawn("python3", ["-I", resolve(harness, "model-api-refs.py"), MISSING_REF], {
          cwd: root, env: { ...process.env, BENCH_MODEL_API_BASE: `http://127.0.0.1:${port}` },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolveDone({ status: 99, stdout, stderr });
        }, 20_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolveDone({ status: code ?? 99, stdout, stderr });
        });
      });
      expect(run.status, "F2/FR1: a redirect exits 2").toBe(2);
      expect(run.stdout, "F2/FR1: a redirect prints nothing on stdout").toBe("");
      expect(run.stderr.trim().length, "F2/FR1: an empty stderr never counts as one reason").toBeGreaterThan(0);
      expect(run.stderr.trim().split("\n").length, "F2/FR1: a redirect writes one reason").toBe(1);
      expect(targetHits, "F2: the valid redirect target sees no request").toBe(0);
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });
});

describe("FR1: the helper keeps the ID grammar of the ref-list mode", () => {
  it("catalog ID classes resolve: tilde alias, multi-segment, bracketed, and _ : @ +", () => {
    const refs = [
      MISSING_REF,
      "openrouter/~anthropic/claude-opus-latest",
      "nvidia/google/google-paligemma",
      "openrouter/vendor/claude-opus-5-5[1m]",
      "test_provider/a+b:c@d_e",
    ];
    for (const ref of refs) {
      const [provider, ...rest] = ref.split("/");
      const apiFile = resolve(makeTempRoot(), "api.json");
      writeFileSync(apiFile, entryPayload([{ ...activeApiRow(provider, rest.join("/")) }]));
      const run = runEntryCopy({ ref, envBase: apiFile });
      expect(run.status, `FR1: the ID class ${ref} resolves with exit 0`).toBe(0);
      expect(Object.keys(JSON.parse(run.stdout)).sort(), `FR1/D4: ${ref} returns only the three fields`).toEqual([
        "limit", "modelID", "name",
      ]);
    }
  });

  it("a malformed provider ID or model ID exits 2", () => {
    for (const ref of ["opencode go/hungerg-free", "opencode-go/bad\tmodel", "opencode-go/bad\nmodel", "/hungerg-free", "opencode-go/"]) {
      const apiFile = resolve(makeTempRoot(), "api.json");
      writeFileSync(apiFile, entryPayload([activeApiRow(PROVIDER, MISSING_MODEL)]));
      const run = runEntryCopy({ ref, envBase: apiFile });
      expect(run.status, `FR1: the malformed ref ${JSON.stringify(ref)} exits 2`).toBe(2);
      expect(run.stdout, `FR1: the malformed ref ${JSON.stringify(ref)} prints nothing`).toBe("");
    }
  });
});

function listNames(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

const watchedRoots = [resolve(ROOT, "runs"), resolve(ROOT, "reports"), resolve(ROOT, ".tmp")];
let rootsBefore = "";

beforeAll(() => {
  rootsBefore = JSON.stringify(watchedRoots.map((dir) => [dir, listNames(dir)]));
});

afterAll(() => {
  const after = JSON.stringify(watchedRoots.map((dir) => [dir, listNames(dir)]));
  expect(after, "F9/FR3: the suite adds no entries under the real ROOT runs, reports, or .tmp").toBe(rootsBefore);
});

describe("F9/FR3: the route runs in a temp repo with a Podman tripwire", () => {
  it("a missing-model run writes its run, config, and Podman record under the temp repo", async () => {
    const r = await runTempRoute({ model: MISSING_MODEL, catalog: "missing" });
    try {
      expectFullAgentTrap(r, "F9/FR3: the temp-repo run completes the route");
      const entry = entryValue(MISSING_MODEL);
      expect(readFileSync(configPath(r.run), "utf8"), "F9/FR3: the temp run writes the provider-block config").toBe(
        expectedConfigBytes(MISSING_REF, providersBlock(PROVIDER, MISSING_MODEL, entry)),
      );
      expect(existsSync(resolve(r.run.repo, "runs", r.run.id)), "F9/FR3: the temp repo holds the run").toBe(true);
      expect(existsSync(r.run.podmanCalls), "F9/FR3: the fake-Podman tripwire records the agent call").toBe(true);
      expect(existsSync(r.run.podmanCapture), "F9/FR3: the tripwire captures the agent argv").toBe(true);
    } finally {
      r.run.cleanup();
    }
  }, 120_000);
});

describe("F5/FR1: a slow-header response ends at the ten-second deadline", () => {
  it("exits 2 in about 10 s, not about 12 s", async () => {
    const payload = entryPayload([activeApiRow(PROVIDER, MISSING_MODEL)]);
    const server = createTcpServer((socket) => {
      socket.once("data", () => {
        socket.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n");
        let n = 0;
        const timer = setInterval(() => {
          n += 1;
          socket.write(`X-Drip-${n}: yes\r\n`);
        }, 3000);
        setTimeout(() => {
          clearInterval(timer);
          socket.write(`\r\n${payload}`);
          socket.end();
        }, 12_000);
        socket.on("error", () => { clearInterval(timer); });
      });
      socket.on("error", () => {});
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const root = makeTempRoot();
      const harness = resolve(root, "harness");
      mkdirSync(harness, { recursive: true });
      if (!existsSync(HELPER)) throw new Error("FR1: harness/model-api-refs.py is missing");
      copyFileSync(HELPER, resolve(harness, "model-api-refs.py"));
      const run: { status: number; stdout: string; stderr: string; ms: number } = await new Promise((resolveDone) => {
        const started = Date.now();
        const child = spawn("python3", ["-I", resolve(harness, "model-api-refs.py"), MISSING_REF], {
          cwd: root, env: { ...process.env, BENCH_MODEL_API_BASE: `http://127.0.0.1:${port}` },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolveDone({ status: 99, stdout, stderr, ms: Date.now() - started });
        }, 60_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolveDone({ status: code ?? 99, stdout, stderr, ms: Date.now() - started });
        });
      });
      expect(run.status, "F5/FR1: a slow-header response must exit 2").toBe(2);
      expect(run.ms, `F5/FR1: the whole read ends at 10 s, not 12 s (took ${run.ms} ms)`).toBeLessThan(11_000);
      expect(run.stdout, "F5/FR1: a timed-out read prints nothing on stdout").toBe("");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }, 60_000);
});

describe("F10/D2: the catalog scan validates the provider object", () => {
  function setCatalogComment(run: TempRun, catalogJson: string): void {
    const kept = readFileSync(run.fake.path, "utf8").split("\n").filter((line) => !line.includes("EXECUTOR_CATALOG"));
    writeFileSync(run.fake.path, `${kept.join("\n")}\n// EXECUTOR_CATALOG ${catalogJson}\n`);
  }

  const otherEntry = '{"id":"x","name":"x","limit":{"context":1,"input":1,"output":1}}';

  it("a null provider object with an unrelated models object exits 2", async () => {
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing", apiData: [activeApiRow(PROVIDER, "other-model")],
      prep: (run) => setCatalogComment(run, `{"opencode-go":null,"other":{"models":{"x":${otherEntry}}}}`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a null provider object", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("an empty requested provider object exits 2", async () => {
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing", apiData: [activeApiRow(PROVIDER, "other-model")],
      prep: (run) => setCatalogComment(run, `{"other":{"models":{"x":${otherEntry}}},"opencode-go":{}}`),
    });
    try {
      expectEntryFailure(r, "F10/D2: an empty provider object", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a truncated provider value after a valid unrelated object exits 2", async () => {
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing", apiData: [activeApiRow(PROVIDER, "other-model")],
      prep: (run) => setCatalogComment(run, `{"other":{"models":{"x":${otherEntry}}},"opencode-go":`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a truncated provider value", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a nested settings object holding the provider and models keys is not the catalog", async () => {
    const entry = entryValue(MISSING_MODEL);
    const nested = `{"settings":{"opencode-go":{"models":{"${MISSING_MODEL}":{"id":"${MISSING_MODEL}","name":"${MISSING_MODEL} Name","limit":{"context":1000000,"input":1000000,"output":65536}}}}}}`;
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => setCatalogComment(run, nested),
    });
    try {
      const configExists = existsSync(configPath(r.run));
      const viaMiss = configExists
        && (JSON.parse(readFileSync(configPath(r.run), "utf8")) as Record<string, Record<string, Record<string, unknown>>>)
          .providers?.[PROVIDER]?.models?.[MISSING_MODEL] !== undefined
        && entryCalls(r.log).length === 1;
      const viaError = !configExists && r.status === 2;
      expect(viaMiss || viaError, "F10/D2: nested provider and models keys never count as the catalog").toBe(true);
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a valid provider object split across the 64 KiB chunk boundary reads present", async () => {
    const entry = entryValue(MISSING_MODEL);
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => {
        const script = readFileSync(run.fake.path, "utf8").split("\n").filter((line) => !line.includes("EXECUTOR_CATALOG")).join("\n");
        const unrelated = `{"other":{"models":{"x":${otherEntry}}}}`;
        const fillerLen = 65478 - script.length - unrelated.length;
        const providerObj = `{"models":{"${MISSING_MODEL}":{"id":"${MISSING_MODEL}","name":"${MISSING_MODEL} Name","limit":{"context":1000000,"input":1000000,"output":65536}}}}`;
        // Structure: a complete unrelated root, filler bytes, then a closed requested-provider root straddling the 64 KiB chunk boundary; reads present.
        const catalog = `${unrelated}${"x".repeat(Math.max(fillerLen, 0))}{${" ".repeat(60)}"${PROVIDER}":${providerObj}}`;
        writeFileSync(run.fake.path, `${script}\n// EXECUTOR_CATALOG ${catalog}\n`);
      },
    });
    try {
      expectFullAgentTrap(r, "F10/D2: the chunk-boundary present model");
      const bytes = readFileSync(configPath(r.run), "utf8");
      expect(bytes, "F10/D2: the split provider object still reads present").toBe(expectedConfigBytes(MISSING_REF));
      expect(JSON.parse(bytes), "F10/D2: the present model gets no providers key").not.toHaveProperty("providers");
      expect(helperCalls(r.log).length, "F10/D2: a present model makes no API call").toBe(0);
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a valid provider object split across the chunk boundary reads missing", async () => {
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => {
        const script = readFileSync(run.fake.path, "utf8").split("\n").filter((line) => !line.includes("EXECUTOR_CATALOG")).join("\n");
        const unrelated = `{"other":{"models":{"x":${otherEntry}}}}`;
        const fillerLen = 65478 - script.length - unrelated.length;
        const providerObj = `{"models":{"unrelated-model":{"id":"unrelated-model"}}}`;
        // Structure: a complete unrelated root, filler bytes, then a closed provider root without the model straddling the 64 KiB chunk boundary; reads missing.
        const catalog = `${unrelated}${"x".repeat(Math.max(fillerLen, 0))}{${" ".repeat(60)}"${PROVIDER}":${providerObj}}`;
        writeFileSync(run.fake.path, `${script}\n// EXECUTOR_CATALOG ${catalog}\n`);
      },
    });
    try {
      expectFullAgentTrap(r, "F10/D2: the chunk-boundary missing model");
      const bytes = readFileSync(configPath(r.run), "utf8");
      expect(JSON.parse(bytes).providers, "F10/D2: the split provider object still reads missing").toEqual(
        providersBlock(PROVIDER, MISSING_MODEL, entryValue(MISSING_MODEL)),
      );
      expect(entryCalls(r.log).length, "F10/D2: the missing model resolves one helper entry").toBe(1);
    } finally {
      r.run.cleanup();
    }
  }, 120_000);
  it("a complete provider with a missing final root brace exits 2 for a present model", async () => {
    // Structure: a single root holding the complete requested provider object with the final root brace removed, so the root never closes; exits 2.
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => setCatalogComment(run,
        `{"opencode-go":{"models":{"${MISSING_MODEL}":{"id":"${MISSING_MODEL}","name":"${MISSING_MODEL} Name","limit":{"context":1000000,"input":1000000,"output":65536}}}}`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a missing final root brace", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a complete provider with a missing final root brace exits 2 for a missing model", async () => {
    // Structure: a single root holding the unrelated-model provider object with the final root brace removed, so the root never closes; exits 2.
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing", apiData: [],
      prep: (run) => setCatalogComment(run,
        `{"opencode-go":{"models":{"unrelated-model":{"id":"unrelated-model"}}}`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a missing final root brace for a missing model", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a root that never closes exits 2 for a present model", async () => {
    // Structure: a single root holding the complete requested provider object plus a truncated "other" value, so the root never closes; exits 2.
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => setCatalogComment(run,
        `{"opencode-go":{"models":{"${MISSING_MODEL}":{"id":"${MISSING_MODEL}","name":"${MISSING_MODEL} Name","limit":{"context":1000000,"input":1000000,"output":65536}}}},"other":{"models":{"x":`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a root that never closes", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a root that never closes exits 2 for a missing model", async () => {
    // Structure: a single root holding the unrelated-model provider object plus a truncated "other" value, so the root never closes; exits 2.
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing", apiData: [],
      prep: (run) => setCatalogComment(run,
        `{"opencode-go":{"models":{"unrelated-model":{"id":"unrelated-model"}}},"other":{"models":{"x":`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a root that never closes for a missing model", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a root that closes early exits 2 for a present model", async () => {
    // Structure: a single root holding the unrelated object first and the complete requested provider object second, with the final root brace removed, so the root never closes; exits 2.
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => setCatalogComment(run,
        `{"unrelated":{"models":{"x":${otherEntry}}},"opencode-go":{"models":{"${MISSING_MODEL}":{"id":"${MISSING_MODEL}","name":"${MISSING_MODEL} Name","limit":{"context":1000000,"input":1000000,"output":65536}}}}`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a root that closes early", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a root that closes early exits 2 for a missing model", async () => {
    // Structure: a single root holding the unrelated object and the requested provider object with the final root brace removed, so the root never closes; exits 2.
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing", apiData: [],
      prep: (run) => setCatalogComment(run,
        `{"unrelated":{"models":{"x":${otherEntry}}},"opencode-go":{"models":{"unrelated-model":{"id":"unrelated-model"}}}`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a root that closes early for a missing model", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a root with a trailing comma exits 2 for a present model", async () => {
    // Structure: a single root holding the complete requested provider object
    // with a comma after the final member. The comma must not close the root.
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing", apiData: [activeApiRow(PROVIDER, "other-model")],
      prep: (run) => setCatalogComment(run,
        `{"opencode-go":{"models":{"${MISSING_MODEL}":{"id":"${MISSING_MODEL}","name":"${MISSING_MODEL} Name","limit":{"context":1000000,"input":1000000,"output":65536}}}},}`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a trailing comma for a present model", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a root with a trailing comma exits 2 for a missing model", async () => {
    // Structure: a single root holding the unrelated-model provider object
    // with a comma after the final member. The comma must not close the root.
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing", apiData: [activeApiRow(PROVIDER, "other-model")],
      prep: (run) => setCatalogComment(run,
        `{"opencode-go":{"models":{"unrelated-model":{"id":"unrelated-model"}}},}`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a trailing comma for a missing model", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a valid unrelated root followed by a truncated requested root exits 2 for a present model", async () => {
    // Structure: a complete unrelated root, then a requested-provider root
    // cut off mid-entry. The truncation is a parse error, not a miss.
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing", apiData: [activeApiRow(PROVIDER, "other-model")],
      prep: (run) => setCatalogComment(run,
        `{"other":{"models":{"x":${otherEntry}}}}` +
        `{"opencode-go":{"models":{"${MISSING_MODEL}":{"id":"${MISSING_MODEL}",`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a truncated requested root after a valid root for a present model", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a valid unrelated root followed by a truncated requested root exits 2 for a missing model", async () => {
    // Structure: a complete unrelated root, then an unrelated-model provider
    // root cut off mid-entry. The truncation is a parse error, not a miss.
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing", apiData: [activeApiRow(PROVIDER, "other-model")],
      prep: (run) => setCatalogComment(run,
        `{"other":{"models":{"x":${otherEntry}}}}` +
        `{"opencode-go":{"models":{"unrelated-model":{"id":"unrelated-model",`),
    });
    try {
      expectEntryFailure(r, "F10/D2: a truncated requested root after a valid root for a missing model", "none");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a root closed before the requested provider member is a miss for a present model", async () => {
    // F10/D2 decision: the requested provider member sits outside every
    // complete catalog root, so no closed root contains the provider. Every
    // root that opens also closes, so this is a missing provider object (a
    // miss, exit 1), not a truncated parse error (exit 2).
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => setCatalogComment(run,
        `{"unrelated":{"models":{"x":${otherEntry}}}}` +
        `,"opencode-go":{"models":{"${MISSING_MODEL}":{"id":"${MISSING_MODEL}","name":"${MISSING_MODEL} Name","limit":{"context":1000000,"input":1000000,"output":65536}}}}`),
    });
    try {
      expectFullAgentTrap(r, "F10/D2: the closed-before-member present model");
      const entry = entryValue(MISSING_MODEL);
      expect(readFileSync(configPath(r.run), "utf8"), "F10/D2: the closed-before-member miss takes the entry route").toBe(
        expectedConfigBytes(MISSING_REF, providersBlock(PROVIDER, MISSING_MODEL, entry)),
      );
      expect(entryCalls(r.log).length, "F10/D2: the closed-before-member miss resolves one helper entry").toBe(1);
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a root closed before the requested provider member is a miss for a missing model", async () => {
    // F10/D2 decision: as above, the trailing provider object is outside any
    // complete catalog root, so the provider object is missing (exit 1).
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => setCatalogComment(run,
        `{"unrelated":{"models":{"x":${otherEntry}}}}` +
        `,"opencode-go":{"models":{"unrelated-model":{"id":"unrelated-model"}}}}`),
    });
    try {
      expectFullAgentTrap(r, "F10/D2: the closed-before-member missing model");
      const entry = entryValue(MISSING_MODEL);
      expect(readFileSync(configPath(r.run), "utf8"), "F10/D2: the closed-before-member miss takes the entry route").toBe(
        expectedConfigBytes(MISSING_REF, providersBlock(PROVIDER, MISSING_MODEL, entry)),
      );
      expect(entryCalls(r.log).length, "F10/D2: the closed-before-member miss resolves one helper entry").toBe(1);
    } finally {
      r.run.cleanup();
    }
  }, 120_000);
});

describe("F11/FR4: the helper and the config keep integer limits exact", () => {
  function rawPayload(limitJson: string): string {
    return `{"location":{"directory":"fake"},"data":[{"id":"x","providerID":"${PROVIDER}","modelID":"${MISSING_MODEL}","type":"language","name":"n","enabled":true,"status":"active","limit":${limitJson}}]}`;
  }

  function expectEntryRejectsRaw(limitJson: string, label: string): void {
    const apiFile = resolve(makeTempRoot(), "api.json");
    writeFileSync(apiFile, rawPayload(limitJson));
    const run = runEntryCopy({ ref: MISSING_REF, envBase: apiFile });
    expect(run.status, `${label}: F11/FR4 requires exit 2`).toBe(2);
    expect(run.stdout, `${label}: F11/FR4 requires empty stdout`).toBe("");
    expect(run.stderr.trim().length, `${label}: an empty stderr never counts as one reason`).toBeGreaterThan(0);
    expect(run.stderr.trim().split("\n").length, `${label}: F11/FR4 requires one short stderr reason`).toBe(1);
  }

  function expectEntryPrintsRaw(limitJson: string, expectedLimit: Record<string, number>, label: string): void {
    const apiFile = resolve(makeTempRoot(), "api.json");
    writeFileSync(apiFile, rawPayload(limitJson));
    const run = runEntryCopy({ ref: MISSING_REF, envBase: apiFile });
    expect(run.status, `${label}: a range-valid entry exits 0`).toBe(0);
    expect((JSON.parse(run.stdout) as Record<string, unknown>).limit, `${label}: the printed limit is exact`).toEqual(expectedLimit);
  }

  it("a 10^400 context exits 2", () => {
    expectEntryRejectsRaw(`{"context":${"1" + "0".repeat(400)},"input":1000000,"output":65536}`, "F11/FR4: context 10^400");
  });

  it("an input of 2^53+1 exits 2", () => {
    expectEntryRejectsRaw(`{"context":1000000,"input":9007199254740993,"output":65536}`, "F11/FR4: input 2^53+1");
  });

  it("the boundary 2^53-1 prints exactly", () => {
    expectEntryPrintsRaw(
      `{"context":9007199254740991,"input":9007199254740991,"output":9007199254740991}`,
      { context: 9007199254740991, input: 9007199254740991, output: 9007199254740991 },
      "F11/FR4: boundary 2^53-1",
    );
  });

  it("zero limits print exactly", () => {
    expectEntryPrintsRaw(`{"context":0,"input":0,"output":0}`, { context: 0, input: 0, output: 0 }, "F11/FR4: zero limits");
  });

  it("the generated config limit equals the entry values exactly", async () => {
    const limit = { context: 9007199254740991, input: 9007199254740991, output: 9007199254740991 };
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      apiData: [{ ...activeApiRow(PROVIDER, MISSING_MODEL), limit }],
    });
    try {
      expectFullAgentTrap(r, "F11/FR4: the boundary config run");
      const config = JSON.parse(readFileSync(configPath(r.run), "utf8")) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
      expect(config.providers?.[PROVIDER]?.models?.[MISSING_MODEL], "F11/FR4: the provider block holds the entry").toEqual({
        modelID: MISSING_MODEL, name: `${MISSING_MODEL} Name`, limit,
      });
      expect(config.providers?.[PROVIDER]?.models?.[MISSING_MODEL], "F11/FR4: the limit equals the entry values exactly").toMatchObject({ limit });
    } finally {
      r.run.cleanup();
    }
  }, 120_000);
});

describe("N1/FR4: a model API limit without input is accepted end to end", () => {
  // The former contract rejected a limit that held only context and output.
  // The new contract accepts that shape and prints it unchanged: the helper
  // invents no input key and writes no null, and run.sh copies the same two
  // keys into the generated config. A three-key limit keeps all three keys.

  it("entry mode accepts a context-and-output-only limit and prints exactly those keys", () => {
    const apiFile = resolve(makeTempRoot(), "api.json");
    writeFileSync(apiFile, entryPayload([{ ...activeApiRow(PROVIDER, MISSING_MODEL), limit: TWO_KEY_LIMIT }]));
    const run = runEntryCopy({ ref: MISSING_REF, envBase: apiFile });
    expect(run.status, "N1/FR4: a two-key limit is accepted in entry mode").toBe(0);
    const printed = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(Object.keys(printed).sort(), "N1/FR4: the entry still prints only modelID, name, and limit").toEqual([
      "limit", "modelID", "name",
    ]);
    expect(printed.limit, "N1/FR4: the printed limit holds exactly context and output").toEqual(TWO_KEY_LIMIT);
    expect(Object.keys(printed.limit as object).sort(), "N1/FR4: the printed limit invents no input key").toEqual([
      "context", "output",
    ]);
    expect(run.stdout, "N1/FR4: the printed limit writes no null input key").not.toContain("null");
  });

  it("entry mode keeps a three-key limit exactly", () => {
    const limit = { context: 1000000, input: 7, output: 384000 };
    const apiFile = resolve(makeTempRoot(), "api.json");
    writeFileSync(apiFile, entryPayload([{ ...activeApiRow(PROVIDER, MISSING_MODEL), limit }]));
    const run = runEntryCopy({ ref: MISSING_REF, envBase: apiFile });
    expect(run.status, "N1/FR4: a three-key limit is still accepted").toBe(0);
    const printed = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(Object.keys(printed.limit as object).sort(), "N1/FR4: all three limit keys stay").toEqual([
      "context", "input", "output",
    ]);
    expect(printed.limit, "N1/FR4: the three limit values stay exact").toEqual(limit);
  });

  it("a missing required key, an extra key, or an invalid value exits 2 with one reason", () => {
    const cases: { name: string; limit: unknown }[] = [
      { name: "a limit with only output", limit: { output: 384000 } },
      { name: "a limit with only context", limit: { context: 1000000 } },
      { name: "context and input without output", limit: { context: 1000000, input: 1 } },
      { name: "an extra key beside all three keys", limit: { context: 1000000, input: 1, output: 384000, extra: 0 } },
      { name: "an extra key beside context and output", limit: { context: 1000000, output: 384000, extra: 0 } },
      { name: "a non-object limit", limit: "big" },
      { name: "a boolean context", limit: { context: true, output: 384000 } },
      { name: "a fractional output", limit: { context: 1000000, output: 1.5 } },
      { name: "a string context", limit: { context: "1000000", output: 384000 } },
      { name: "a negative output", limit: { context: 1000000, output: -1 } },
      { name: "a 2^53 context", limit: { context: 9007199254740992, output: 384000 } },
      { name: "an invalid input beside context and output", limit: { context: 1000000, output: 384000, input: false } },
    ];
    for (const item of cases) {
      expectEntryRejects(MISSING_REF, [{ ...activeApiRow(PROVIDER, MISSING_MODEL), limit: item.limit }], `N1/FR4: ${item.name}`);
    }
  });

  it("ref-list mode still lists the ref for a two-key limit", () => {
    const apiFile = resolve(makeTempRoot(), "api.json");
    writeFileSync(apiFile, entryPayload([{ ...activeApiRow(PROVIDER, MISSING_MODEL), limit: TWO_KEY_LIMIT }]));
    const run = runEntryCopy({ envBase: apiFile });
    expect(run.status, "N1/FR1: zero-argument mode is unchanged").toBe(0);
    expect(run.stdout.split("\n").filter((line) => line.length > 0), "N1/FR1: the active ref is still listed").toEqual([MISSING_REF]);
  });

  it("run.sh routes a two-key limit and the config holds exactly those keys", async () => {
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      apiData: [{ ...activeApiRow(PROVIDER, MISSING_MODEL), limit: TWO_KEY_LIMIT }],
    });
    try {
      expect(existsSync(configPath(r.run)), "N1/FR1: a two-key limit must let the route reach config generation").toBe(true);
      expectFullAgentTrap(r, "N1/FR1: the two-key limit route");
      const entry = entryValueWithLimit(MISSING_MODEL, TWO_KEY_LIMIT);
      const bytes = readFileSync(configPath(r.run), "utf8");
      expect(bytes, "N1/FR1: the config holds the exact two-key provider block").toBe(
        expectedConfigBytes(MISSING_REF, providersBlock(PROVIDER, MISSING_MODEL, entry)),
      );
      const config = JSON.parse(bytes) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
      const written = config.providers?.[PROVIDER]?.models?.[MISSING_MODEL];
      expect(Object.keys((written as { limit: object }).limit).sort(), "N1/FR1: the config limit invents no input key").toEqual([
        "context", "output",
      ]);
      expect(written, "N1/FR1: the provider block holds only the two-key limit").toEqual(entry);
      expect(entryCalls(r.log).length, "N1/FR1: the run resolves one helper entry").toBe(1);
      const identity = JSON.parse(readFileSync(resolve(r.run.out, "execution-identity.json"), "utf8"));
      expect(identity.config_sha256, "N1/FR5: the identity hashes the exact two-key config").toBe(sha256Hex(bytes));
    } finally {
      r.run.cleanup();
    }
  }, 120_000);
});

describe("F12/FR1: a malformed HTTP response exits 2 without a traceback", () => {
  // F12: the sent body is always valid JSON. complete declares its exact
  // length; half declares twice the sent length (the sent body is exactly
  // half the declared length); short20 declares the sent length plus 20 but
  // sends 20 bytes short; shortlen declares short and sends long. chunkedok
  // and closedelim carry the same valid body without Content-Length framing.
  function startFramingServer(mode: "badsize" | "trunc" | "shortlen" | "complete" | "half" | "short20" | "chunkedok" | "closedelim"): Promise<{ port: number; kill: () => void }> {
    const dir = makeTempRoot();
    const shortPayload = JSON.stringify({ location: { directory: "fake" }, data: [activeApiRow(PROVIDER, MISSING_MODEL)] });
    writeFileSync(resolve(dir, "framing.cjs"), `
const net = require("node:net");
const mode = ${JSON.stringify(mode)};
const shortPayload = ${JSON.stringify(shortPayload)};
const server = net.createServer((socket) => {
  socket.once("data", () => {
    if (mode === "shortlen") {
      const head = "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: " + (Buffer.byteLength(shortPayload) + 20) + "\\r\\nConnection: close\\r\\n\\r\\n";
      socket.write(head + shortPayload);
      setTimeout(() => socket.destroy(), 500);
      socket.on("error", () => {});
      return;
    }
    if (mode === "complete" || mode === "half" || mode === "short20") {
      const sent = mode === "short20" ? shortPayload.slice(0, shortPayload.length - 20) : shortPayload;
      const declared = mode === "complete" ? Buffer.byteLength(shortPayload) : mode === "half" ? 2 * Buffer.byteLength(shortPayload) : Buffer.byteLength(shortPayload) + 20;
      const head = "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nContent-Length: " + declared + "\\r\\nConnection: close\\r\\n\\r\\n";
      if (mode === "short20") {
        socket.write(head + sent);
        setTimeout(() => socket.destroy(), 500);
      } else {
        socket.end(head + sent);
      }
      socket.on("error", () => {});
      return;
    }
    if (mode === "chunkedok" || mode === "closedelim") {
      if (mode === "chunkedok") {
        const head = "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nTransfer-Encoding: chunked\\r\\nConnection: close\\r\\n\\r\\n";
        socket.end(head + Buffer.byteLength(shortPayload).toString(16) + "\\r\\n" + shortPayload + "\\r\\n0\\r\\n\\r\\n");
      } else {
        socket.end("HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nConnection: close\\r\\n\\r\\n" + shortPayload);
      }
      socket.on("error", () => {});
      return;
    }
    const head = "HTTP/1.1 200 OK\\r\\nContent-Type: application/json\\r\\nTransfer-Encoding: chunked\\r\\nConnection: close\\r\\n\\r\\n";
    if (mode === "badsize") {
      socket.write(head + "ZZZ\\r\\nboom\\r\\n0\\r\\n\\r\\n");
      socket.end();
    } else {
      socket.write(head + "64\\r\\n0123456789");
      setTimeout(() => socket.destroy(), 500);
    }
    socket.on("error", () => {});
  });
  socket.on("error", () => {});
});
server.listen(0, "127.0.0.1", () => console.log("FRAMING_PORT=" + server.address().port));
setTimeout(() => process.exit(0), 25000).unref();
`);
    return new Promise((resolveDone, reject) => {
      const child = spawn(process.execPath, [resolve(dir, "framing.cjs")], { stdio: ["ignore", "pipe", "inherit"] });
      child.stdout.setEncoding("utf8");
      let buf = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("the framing server did not start"));
      }, 10_000);
      child.stdout.on("data", (chunk: string) => {
        buf += chunk;
        const m = buf.match(/FRAMING_PORT=(\d+)/);
        if (m) {
          clearTimeout(timer);
          resolveDone({ port: Number(m[1]), kill: () => { child.kill("SIGKILL"); } });
        }
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async function runHelperRaw(ref: string | undefined, base: string): Promise<{ status: number; stdout: string; stderr: string }> {
    const root = makeTempRoot();
    const harness = resolve(root, "harness");
    mkdirSync(harness, { recursive: true });
    if (!existsSync(HELPER)) throw new Error("FR1: harness/model-api-refs.py is missing");
    copyFileSync(HELPER, resolve(harness, "model-api-refs.py"));
    return new Promise((resolveDone) => {
      const args = ref === undefined ? [] : [ref];
      const child = spawn("python3", ["-I", resolve(harness, "model-api-refs.py"), ...args], {
        cwd: root, env: { ...process.env, BENCH_MODEL_API_BASE: base },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolveDone({ status: 99, stdout, stderr });
      }, 20_000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolveDone({ status: code ?? 99, stdout, stderr });
      });
    });
  }

  function expectCleanFailure(run: { status: number; stdout: string; stderr: string }, label: string): void {
    expect(run.status, `${label}: F12/D1 requires exit 2, not a traceback exit`).toBe(2);
    expect(run.stdout, `${label}: F12/D1 requires empty stdout`).toBe("");
    expect(run.stderr.trim().length, `${label}: an empty stderr never counts as one reason`).toBeGreaterThan(0);
    expect(run.stderr.trim().split("\n").length, `${label}: F12/D1 requires one short reason`).toBe(1);
  }

  function expectCompleteEntry(run: { status: number; stdout: string; stderr: string }, label: string): void {
    expect(run.status, `${label}: F12/FR1 requires a complete response to exit 0`).toBe(0);
    expect(Object.keys(JSON.parse(run.stdout)).sort(), `${label}: F12/FR1 requires the complete response to print only the entry fields`).toEqual([
      "limit", "modelID", "name",
    ]);
  }

  function expectCompleteRefList(run: { status: number; stdout: string; stderr: string }, label: string): void {
    expect(run.status, `${label}: F12/FR1 requires a complete response to exit 0`).toBe(0);
    expect(run.stdout.split("\n").filter((line) => line.length > 0), `${label}: F12/FR1 requires the complete response to list the active ref`).toEqual([
      MISSING_REF,
    ]);
  }

  const modeLabel = { badsize: "chunk size", trunc: "truncated chunk", shortlen: "short Content-Length body" } as const;
  for (const mode of ["badsize", "trunc", "shortlen"] as const) {
    it(`an invalid ${modeLabel[mode]} exits 2 in entry mode`, async () => {
      const framing = await startFramingServer(mode);
      try {
        const run = await runHelperRaw(MISSING_REF, `http://127.0.0.1:${framing.port}`);
        expectCleanFailure(run, `F12/FR1: ${mode} entry`);
      } finally {
        framing.kill();
      }
    });

    it(`an invalid ${modeLabel[mode]} exits 2 in ref-list mode`, async () => {
      const framing = await startFramingServer(mode);
      try {
        const run = await runHelperRaw(undefined, `http://127.0.0.1:${framing.port}`);
        expectCleanFailure(run, `F12/FR1: ${mode} ref-list`);
      } finally {
        framing.kill();
      }
    });
  }

  // F12 regression: HTTPResponse.length is the remaining length after the
  // read, so the current check rejects a complete Content-Length response
  // and accepts a half-length one. The complete and half cases fail on the
  // current code; short20 fails on every code; the two controls succeed.
  const lengthLabel = { complete: "complete Content-Length body", half: "half-length body", short20: "body 20 bytes short" } as const;
  for (const mode of ["complete", "half", "short20"] as const) {
    const check = mode === "complete" ? "succeeds" : "exits 2";
    it(`a ${lengthLabel[mode]} ${check} in entry mode`, async () => {
      const framing = await startFramingServer(mode);
      try {
        const run = await runHelperRaw(MISSING_REF, `http://127.0.0.1:${framing.port}`);
        if (mode === "complete") expectCompleteEntry(run, `F12/FR1: ${mode} entry`);
        else expectCleanFailure(run, `F12/FR1: ${mode} entry`);
      } finally {
        framing.kill();
      }
    });

    it(`a ${lengthLabel[mode]} ${check} in ref-list mode`, async () => {
      const framing = await startFramingServer(mode);
      try {
        const run = await runHelperRaw(undefined, `http://127.0.0.1:${framing.port}`);
        if (mode === "complete") expectCompleteRefList(run, `F12/FR1: ${mode} ref-list`);
        else expectCleanFailure(run, `F12/FR1: ${mode} ref-list`);
      } finally {
        framing.kill();
      }
    });
  }

  const framingLabel = { chunkedok: "valid chunked body", closedelim: "close-delimited body" } as const;
  for (const mode of ["chunkedok", "closedelim"] as const) {
    it(`a ${framingLabel[mode]} succeeds in entry mode`, async () => {
      const framing = await startFramingServer(mode);
      try {
        const run = await runHelperRaw(MISSING_REF, `http://127.0.0.1:${framing.port}`);
        expectCompleteEntry(run, `F12/FR1: ${mode} entry`);
      } finally {
        framing.kill();
      }
    });

    it(`a ${framingLabel[mode]} succeeds in ref-list mode`, async () => {
      const framing = await startFramingServer(mode);
      try {
        const run = await runHelperRaw(undefined, `http://127.0.0.1:${framing.port}`);
        expectCompleteRefList(run, `F12/FR1: ${mode} ref-list`);
      } finally {
        framing.kill();
      }
    });
  }

  it("a malformed response exits 2 through the real run.sh with one reason", async () => {
    const framing = await startFramingServer("badsize");
    try {
      const r = await runTempRoute({ model: MISSING_MODEL, catalog: "missing", apiBase: `http://127.0.0.1:${framing.port}` });
      try {
        expectEntryFailure(r, "F12/FR1: malformed response through run.sh");
      } finally {
        r.run.cleanup();
      }
    } finally {
      framing.kill();
    }
  }, 120_000);

  it("a short Content-Length body exits 2 through the real run.sh with one reason", async () => {
    const framing = await startFramingServer("shortlen");
    try {
      const r = await runTempRoute({ model: MISSING_MODEL, catalog: "missing", apiBase: `http://127.0.0.1:${framing.port}` });
      try {
        expectEntryFailure(r, "F12/FR1: short Content-Length through run.sh");
      } finally {
        r.run.cleanup();
      }
    } finally {
      framing.kill();
    }
  }, 120_000);

  it("a complete Content-Length response succeeds through the real run.sh", async () => {
    const framing = await startFramingServer("complete");
    try {
      const r = await runTempRoute({ model: MISSING_MODEL, catalog: "missing", apiBase: `http://127.0.0.1:${framing.port}` });
      try {
        expectFullAgentTrap(r, "F12/FR1: complete response through run.sh");
        const entry = entryValue(MISSING_MODEL);
        expect(readFileSync(configPath(r.run), "utf8"), "F12/FR1: the complete response takes the entry route").toBe(
          expectedConfigBytes(MISSING_REF, providersBlock(PROVIDER, MISSING_MODEL, entry)),
        );
        expect(entryCalls(r.log).length, "F12/FR1: the complete response resolves one helper entry").toBe(1);
      } finally {
        r.run.cleanup();
      }
    } finally {
      framing.kill();
    }
  }, 120_000);

  it("a half-length body exits 2 through the real run.sh with one reason", async () => {
    const framing = await startFramingServer("half");
    try {
      const r = await runTempRoute({ model: MISSING_MODEL, catalog: "missing", apiBase: `http://127.0.0.1:${framing.port}` });
      try {
        expectEntryFailure(r, "F12/FR1: half-length body through run.sh");
      } finally {
        r.run.cleanup();
      }
    } finally {
      framing.kill();
    }
  }, 120_000);
});

describe("F13/D3: a config generator failure exits 2 with no artifacts", () => {
  it("a failing config generator exits 2 with absent config, staging, identity, and provenance", async () => {
    const r = await runTempRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => installFailingGeneratorShim(run),
    });
    try {
      expectEntryFailure(r, "F13/D3: the config generator");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);
});
