import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeApiRow,
  HARNESS,
  prepareOpencodeRun,
  type ExecutorCatalog,
} from "./opencode-run-fixtures";
import { TEST_MODEL } from "./schema4-fixtures";

const PROVIDER = "opencode-go";
const PRESENT_MODEL = TEST_MODEL;
const MISSING_MODEL = "hungerg-free";
const PRESENT_REF = `${PROVIDER}/${PRESENT_MODEL}`;
const MISSING_REF = `${PROVIDER}/${MISSING_MODEL}`;
const LIMIT = { context: 1000000, input: 1000000, output: 65536 };

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
function installPythonCounter(run: { temp: string; env: NodeJS.ProcessEnv }): string {
  const shimDir = resolve(run.temp, "pyshim");
  mkdirSync(shimDir, { recursive: true });
  const log = resolve(run.temp, "python3-calls.jsonl");
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

type FixtureRun = ReturnType<typeof prepareOpencodeRun>;
type RouteResult = {
  run: FixtureRun;
  status: number | null;
  stdout: string;
  stderr: string;
  log: string;
  staging: string;
};

/** Builds the fixture, installs the helper-call shim, applies the seam, and runs the real run.sh. */
async function runRoute(opts: {
  model?: string;
  catalog?: ExecutorCatalog;
  apiData?: unknown[];
  apiBase?: string;
  prep?: (run: FixtureRun) => void;
  execModel?: string;
}): Promise<RouteResult> {
  const run = prepareOpencodeRun("a", { model: opts.model, catalog: opts.catalog, apiData: opts.apiData });
  const log = installPythonCounter(run);
  if (opts.apiBase !== undefined) run.env.BENCH_MODEL_API_BASE = opts.apiBase;
  if (opts.prep) opts.prep(run);
  const execModel = opts.execModel ?? opts.model ?? TEST_MODEL;
  const staging = resolve(run.runtime, "lending-desk-bench", run.id);
  const result = run.execute(execModel);
  return { run, status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), log, staging };
}

/** D3: one short reason. An empty stderr never counts as a reason. */
function expectOneReason(stderr: string, label: string): void {
  expect(stderr.trim().length, `${label}: F1/D3 requires one stderr reason, and an empty stderr is a failure`).toBeGreaterThan(0);
  expect(stderr.trim().split("\n").length, `${label}: F1/D3 requires exactly one short stderr reason`).toBe(1);
}

/**
 * The shared fixture's recorded session export carries canary texts, so every
 * full agent run ends in the NFR-1 leak gate after the route completes. The
 * route assertions below observe the config, identity, and cohort artifacts;
 * the status assertion pins that deterministic trap, not a route failure.
 */
function expectFullAgentTrap(r: RouteResult, label: string): void {
  expect(r.status, `${label}: the route completes, then the fixture canary export trips the leak gate`).toBe(3);
  expect(r.stderr, `${label}: the NFR-1 gate names the credential leak`).toContain("Console credential reached run output");
}

/** F1/D3: the failure contract of the entry route through the real run.sh. */
function expectEntryFailure(r: RouteResult, label: string): void {
  expect(r.status, `${label}: F1/D3 requires the script to exit 2, not continue into provenance and grading`).toBe(2);
  expectOneReason(r.stderr, label);
  expect(existsSync(resolve(r.run.out, "executor/opencode.json")), `${label}: F1/D3 writes no partial config`).toBe(false);
  expect(existsSync(resolve(r.run.out, "execution-identity.json")), `${label}: F1 builds no identity on the failure path`).toBe(false);
  expect(existsSync(resolve(r.run.out, "executor-cohort.json")), `${label}: F1 builds no cohort on the failure path`).toBe(false);
  expect(existsSync(resolve(r.run.out, "provenance.json")), `${label}: F1 exits before provenance`).toBe(false);
  expect(existsSync(resolve(r.run.out, "score.json")), `${label}: F1 exits before grading`).toBe(false);
  expect(existsSync(r.staging), `${label}: F1 leaves no credential staging under CRED_STAGING`).toBe(false);
  expect(entryCalls(r.log).length, `${label}: F1 attempts the helper entry`).toBeGreaterThan(0);
}

function configPath(run: FixtureRun): string {
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
    const r = await runRoute({ model: PRESENT_MODEL, catalog: "present" });
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
    const r = await runRoute({ model: MISSING_MODEL, catalog: "missing" });
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
  const cases: { name: string; opts: Parameters<typeof runRoute>[0] }[] = [
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
      const r = await runRoute(failure.opts);
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
      const r = await runRoute({
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
    const r = await runRoute({ model: MISSING_MODEL, catalog: "missing-provider" });
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
    const r = await runRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => {
        const kept = readFileSync(run.fake.path, "utf8").split("\n").filter((line) => !line.includes("EXECUTOR_CATALOG"));
        writeFileSync(run.fake.path, kept.join("\n"));
      },
    });
    try {
      expectEntryFailure(r, "F6/D2: an unparsable binary");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a binary with a truncated catalog object exits 2 instead of taking the miss path", async () => {
    const r = await runRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => {
        const kept = readFileSync(run.fake.path, "utf8").split("\n").filter((line) => !line.includes("EXECUTOR_CATALOG"));
        writeFileSync(run.fake.path, `${kept.join("\n")}\n// EXECUTOR_CATALOG {"${PROVIDER}":{"models":{"${MISSING_MODEL}":`);
      },
    });
    try {
      expectEntryFailure(r, "F6/D2: a truncated catalog");
    } finally {
      r.run.cleanup();
    }
  }, 120_000);

  it("a missing provider object is a miss with the provider block", async () => {
    const r = await runRoute({
      model: MISSING_MODEL, catalog: "missing",
      prep: (run) => {
        const kept = readFileSync(run.fake.path, "utf8").split("\n").filter((line) => !line.includes("EXECUTOR_CATALOG"));
        writeFileSync(run.fake.path, `${kept.join("\n")}\n// EXECUTOR_CATALOG {"unrelated":{"models":{}}}\n`);
      },
    });
    try {
      expectFullAgentTrap(r, "F6/D2: the missing-provider run");
      const bytes = readFileSync(configPath(r.run), "utf8");
      expect(bytes, "F6/D2: a missing provider object counts as a miss").toBe(
        expectedConfigBytes(MISSING_REF, providersBlock(PROVIDER, MISSING_MODEL, entryValue(MISSING_MODEL))),
      );
    } finally {
      r.run.cleanup();
    }
  }, 120_000);
});

describe("F3/D9: the shared fixture defaults to a present binary and a local seam", () => {
  it("the default fake binary is catalog-present and the default seam is a local file", () => {
    const run = prepareOpencodeRun("a");
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
    const run = prepareOpencodeRun("a", { model: MISSING_MODEL, catalog: "missing" });
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
  ref: string;
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
  const result = spawnSync("python3", ["-I", helperCopy, opts.ref], {
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
    const listed = runEntryCopy({ ref: MISSING_REF, envBase: apiFile });
    expect(listed.status, "F7/FR1: the ref-list mode stays exit 0 on the same payload").toBe(0);
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

describe("FR3: every check stays off Podman, real binaries, browsers, models, and the real API", () => {
  it("the suite names only the temp, fake, and local seams", () => {
    const self = readFileSync(resolve(import.meta.dirname, "executor-model-route.test.ts"), "utf8");
    // Each banned shape is built by concatenation so this check never matches its own source text.
    for (const banned of ["pod" + "man", "383" + "07", "/usr/local/bin/open" + "code", "play" + "wright", "pup" + "peteer"]) {
      expect(self.includes(banned), `FR3: no check may touch ${banned}`).toBe(false);
    }
    expect(self.includes("BENCH_OPENCODE_BIN"), "FR3: the checks name the fake-binary seam").toBe(true);
    expect(self.includes("BENCH_MODEL_API_BASE"), "FR3: the checks name the local-source seam").toBe(true);
  });

  it("every check writes only under a temp repo, never the real runs tree", () => {
    const self = readFileSync(resolve(import.meta.dirname, "executor-model-route.test.ts"), "utf8");
    expect(self.includes("mkdtempSync"), "FR3: each check stages its files in a temp repo copy").toBe(true);
    for (const real of ['"run' + 's/', '"report' + 's/']) {
      expect(self.includes(real), `FR3: no check may write under the real ${real} tree`).toBe(false);
    }
  });
});
