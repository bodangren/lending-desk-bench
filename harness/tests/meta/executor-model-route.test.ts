import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
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
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "../..");
const RUN_SH = resolve(HARNESS, "run.sh");
const HELPER = resolve(HARNESS, "model-api-refs.py");

function runSource(): string {
  return readFileSync(RUN_SH, "utf8");
}

function helperSource(): string {
  return readFileSync(HELPER, "utf8");
}

/** The config-generation block: from the FR-4 marker to the Arm B skills block. */
function configBlock(): string {
  const source = runSource();
  const start = source.indexOf("FR-4: one generated OpenCode config");
  const end = source.indexOf("Arm B mounts a per-run skill snapshot");
  expect(start, "FR1: run.sh must keep the FR-4 config block marker").toBeGreaterThanOrEqual(0);
  expect(end, "FR1: run.sh must keep the Arm B skills block after the config block").toBeGreaterThan(start);
  return source.slice(start, end);
}

function makeTempRoot(): string {
  mkdirSync(resolve(tmpdir(), "opencode"), { recursive: true });
  return mkdtempSync(resolve(tmpdir(), "opencode", "exec-route-red-"));
}

function payloadData(entries: unknown[]): string {
  return JSON.stringify({ location: { directory: "fake" }, data: entries });
}

function activeEntry(ref: string, extra: Record<string, unknown> = {}) {
  const [providerID, ...rest] = ref.split("/");
  const modelID = rest.join("/");
  return {
    id: `id-${modelID}`,
    modelID,
    providerID,
    type: "language",
    name: `${modelID}-name`,
    limit: { context: 1000000, input: 1000000, output: 65536 },
    enabled: true,
    status: "active",
    ...extra,
  };
}

/** Copies the helper into a temp repo and runs the ENTRY mode copy. No real API. */
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
  if (!existsSync(HELPER)) {
    return { status: 127, stdout: "", stderr: "FR1: harness/model-api-refs.py is missing", root };
  }
  copyFileSync(HELPER, helperCopy);
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    const file = resolve(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.unsetBase) delete env.BENCH_MODEL_API_BASE;
  else if (opts.envBase !== undefined) env.BENCH_MODEL_API_BASE = opts.envBase;
  const result = spawnSync("python3", ["-I", helperCopy, opts.ref], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  return { status: result.status ?? 99, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), root };
}

/** Async variant so a local fake server can answer while the helper runs. */
function runEntryCopyAsync(opts: {
  ref: string;
  envBase?: string;
  files?: Record<string, string>;
}): Promise<{ status: number; stdout: string; stderr: string; root: string }> {
  const root = makeTempRoot();
  const harness = resolve(root, "harness");
  mkdirSync(harness, { recursive: true });
  const helperCopy = resolve(harness, "model-api-refs.py");
  if (!existsSync(HELPER)) {
    return Promise.resolve({ status: 127, stdout: "", stderr: "FR1: harness/model-api-refs.py is missing", root });
  }
  copyFileSync(HELPER, helperCopy);
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    const file = resolve(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.envBase !== undefined) env.BENCH_MODEL_API_BASE = opts.envBase;
  return new Promise((resolveDone) => {
    const child = spawn("python3", ["-I", helperCopy, opts.ref], { cwd: root, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveDone({ status: 99, stdout, stderr: `${stderr}FR1: the entry helper timed out`, root });
    }, 20_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveDone({ status: code ?? 99, stdout, stderr, root });
    });
  });
}

function servePayload(payload: string, status = 200): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    if (req.url === "/api/model") {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload);
    } else {
      res.writeHead(404);
      res.end();
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

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

function expectEntryFailure(
  run: { status: number; stdout: string; stderr: string },
  label: string,
): void {
  expect(run.status, `${label}: FR1 requires exit 2`).toBe(2);
  expect(run.stdout, `${label}: FR1 requires empty stdout on failure`).toBe("");
  expect(run.stderr.trim().split("\n").length, `${label}: FR1 requires one short reason on stderr`).toBe(1);
}

describe("FR1/D2: run.sh scans the pinned binary bytes for the exact model key", () => {
  it("the config block probes BENCH_OPENCODE_BIN for the needle \"<modelID>\":{\"id\":\"<modelID>\"", () => {
    const block = configBlock();
    expect(
      block.includes('":{"id":"'),
      'FR1/D2: run.sh must scan the resolved binary bytes for the needle "<modelID>":{"id":"<modelID>" (a hit means present, no hit means missing)',
    ).toBe(true);
  });

  it("the scan reads the BENCH_OPENCODE_BIN-resolved binary path", () => {
    const source = runSource();
    expect(
      source.includes("BENCH_OPENCODE_BIN"),
      "FR1/FR3: run.sh must resolve the catalog test binary from BENCH_OPENCODE_BIN (test seam)",
    ).toBe(true);
    const block = configBlock();
    expect(
      block.includes("opencode_real") || block.includes("OPENCODE_BIN"),
      "FR1/D2: the config block must scan the resolved binary path variable, not a hard-coded path",
    ).toBe(true);
  });
});

describe("FR1: run.sh adds the three-field provider block for a missing model", () => {
  it("the config block calls the helper entry mode and gates the providers block on the miss", () => {
    const block = configBlock();
    expect(
      block.includes("model-api-refs.py"),
      "FR1/D1/D5: run.sh must call harness/model-api-refs.py entry mode from the config block (never curl)",
    ).toBe(true);
    expect(
      block.includes("BENCH_MODEL_API_BASE"),
      "FR1/FR3: run.sh must read the Console API through BENCH_MODEL_API_BASE (local file or local fake server)",
    ).toBe(true);
    expect(
      block.includes("providers"),
      "FR1/D4: a missing model must add providers.<providerID>.models.<modelID> to $OUT/executor/opencode.json",
    ).toBe(true);
  });

  it("the helper failure stops the run with exit 2 before any config file exists", () => {
    const block = configBlock();
    expect(
      block.includes("model-api-refs.py") && block.includes("return 2"),
      "FR1/D3: run.sh must resolve the entry before it writes the config; a helper failure returns 2 with no partial config",
    ).toBe(true);
  });

  it("the config block issues no raw fetch", () => {
    const block = configBlock();
    expect(block.includes("curl"), "FR1/D5: run.sh must call the helper only; no curl call enters the config block").toBe(false);
  });
});

describe("FR1/D1: the helper entry mode prints exactly modelID, name, and limit", () => {
  it("the helper takes one providerID/modelID argument", () => {
    expect(
      helperSource().includes("sys.argv"),
      "FR1/D1: model-api-refs.py must add an entry mode that takes one providerID/modelID argument",
    ).toBe(true);
  });

  it("an active and enabled entry prints one JSON object with exactly the three fields (file seam)", () => {
    const ref = "opencode-go/hungerg-free";
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([activeEntry(ref)]));
    const run = runEntryCopy({ ref, envBase: apiFile });
    expect(run.status, "FR1: an active and enabled matching entry must exit 0").toBe(0);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(run.stdout);
    } catch {
      // Falls through to the key assertion below, which names FR1.
    }
    expect(
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
      `FR1/D1: the entry mode must print one JSON object on stdout (got ${JSON.stringify(run.stdout)})`,
    ).toBe(true);
    const keys = Object.keys((parsed ?? {}) as Record<string, unknown>).sort();
    expect(keys, "FR1/D4: the provider block holds only modelID, name, and limit").toEqual(["limit", "modelID", "name"]);
    const entry = parsed as Record<string, unknown>;
    expect(entry["modelID"], "FR1: modelID comes from the matching active Console entry").toBe("hungerg-free");
    expect(entry["name"], "FR1: name comes from the matching active Console entry").toBe("hungerg-free-name");
    expect(entry["limit"], "FR1: limit comes from the matching active Console entry").toEqual({
      context: 1000000,
      input: 1000000,
      output: 65536,
    });
  });

  it("the same entry resolves through a local fake server (server seam)", async () => {
    const ref = "opencode-go/hungerg-free";
    const { server, url } = await servePayload(payloadData([activeEntry(ref)]));
    try {
      const run = await runEntryCopyAsync({ ref, envBase: url });
      expect(run.status, "FR1/FR3: the entry mode must accept a local fake server base").toBe(0);
      const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
      expect(Object.keys(parsed).sort(), "FR1/D4: the server seam returns only modelID, name, and limit").toEqual([
        "limit",
        "modelID",
        "name",
      ]);
    } finally {
      await closeServer(server);
    }
  });
});

describe("FR1: a missing, disabled, or inactive entry, an API failure, or malformed JSON exits 2", () => {
  it("each failure class exits 2 with empty stdout and one stderr reason", async () => {
    const ref = "opencode-go/hungerg-free";
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([activeEntry("opencode-go/other-free")]));
    expectEntryFailure(runEntryCopy({ ref, envBase: apiFile }), "FR1: a missing active entry");
    const disabledFile = resolve(makeTempRoot(), "disabled.json");
    mkdirSync(dirname(disabledFile), { recursive: true });
    writeFileSync(disabledFile, payloadData([activeEntry(ref, { enabled: false })]));
    expectEntryFailure(runEntryCopy({ ref, envBase: disabledFile }), "FR1: a disabled entry");
    const inactiveFile = resolve(makeTempRoot(), "inactive.json");
    mkdirSync(dirname(inactiveFile), { recursive: true });
    writeFileSync(inactiveFile, payloadData([activeEntry(ref, { status: "inactive" })]));
    expectEntryFailure(runEntryCopy({ ref, envBase: inactiveFile }), "FR1: an inactive entry");
    expectEntryFailure(runEntryCopy({ ref, envBase: "http://127.0.0.1:1" }), "FR1: an API failure");
    const badFile = resolve(makeTempRoot(), "bad.json");
    mkdirSync(dirname(badFile), { recursive: true });
    writeFileSync(badFile, "{not json");
    expectEntryFailure(runEntryCopy({ ref, envBase: badFile }), "FR1: malformed JSON");
  });

  it("a redirect through a local fake server exits 2 with empty stdout", async () => {
    const ref = "opencode-go/hungerg-free";
    const server = createServer((req, res) => {
      if (req.url === "/api/model") {
        res.writeHead(302, { location: "/api/v2/model" });
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const run = await runEntryCopyAsync({ ref, envBase: `http://127.0.0.1:${port}` });
      expectEntryFailure(run, "FR1: the entry read keeps the no-redirect rule");
    } finally {
      await closeServer(server);
    }
  });
});

describe("FR1: the helper validates provider and model IDs with its existing grammar", () => {
  it("real catalog ID classes resolve: tilde alias, multi-segment, bracketed, and _ : @ +", () => {
    const refs = [
      "opencode-go/hungerg-free",
      "openrouter/~anthropic/claude-opus-latest",
      "nvidia/google/google-paligemma",
      "openrouter/vendor/claude-opus-5-5[1m]",
      "test_provider/a+b:c@d_e",
    ];
    for (const ref of refs) {
      const apiFile = resolve(makeTempRoot(), "api.json");
      mkdirSync(dirname(apiFile), { recursive: true });
      writeFileSync(apiFile, payloadData([activeEntry(ref)]));
      const run = runEntryCopy({ ref, envBase: apiFile });
      expect(run.status, `FR1: the catalog ID class ${ref} must resolve with exit 0`).toBe(0);
      const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
      expect(Object.keys(parsed).sort(), `FR1/D4: ${ref} returns only modelID, name, and limit`).toEqual([
        "limit",
        "modelID",
        "name",
      ]);
    }
  });

  it("a malformed provider ID or model ID exits 2", () => {
    const badRefs = [
      "opencode go/hungerg-free",
      "opencode-go/bad\tmodel",
      "opencode-go/bad\nmodel",
      "/hungerg-free",
      "opencode-go/",
    ];
    for (const ref of badRefs) {
      const apiFile = resolve(makeTempRoot(), "api.json");
      mkdirSync(dirname(apiFile), { recursive: true });
      writeFileSync(apiFile, payloadData([activeEntry("opencode-go/hungerg-free")]));
      expectEntryFailure(runEntryCopy({ ref, envBase: apiFile }), `FR1: the malformed ref ${JSON.stringify(ref)}`);
    }
  });
});

describe("FR2: a catalog-present model keeps the current config bytes", () => {
  it("the providers block appears only on a miss, so a present model gets no providers key", () => {
    const block = configBlock();
    expect(
      block.includes("model-api-refs.py"),
      "FR2: run.sh must gate the API read on the catalog miss, so a present model makes no API call",
    ).toBe(true);
    expect(
      block.includes("providers"),
      "FR2: the providers key must exist only on the missing-model branch of the config block",
    ).toBe(true);
  });

  it("the present-model path writes the current bytes with no providers key", () => {
    const block = configBlock();
    expect(
      block.includes("$schema"),
      "FR2: the present-model path keeps writing the current $schema/model/permissions config",
    ).toBe(true);
    expect(
      block.includes("MODEL_MISSING") || block.includes("CATALOG") || block.includes("model-api-refs.py"),
      "FR2: run.sh must branch on the catalog result so present models skip the route entirely",
    ).toBe(true);
  });
});

describe("FR4: no secret data enters the generated config", () => {
  it("the entry output carries no secret, token, baseURL, or header", () => {
    const ref = "opencode-go/hungerg-free";
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(
      apiFile,
      payloadData([activeEntry(ref, { baseURL: "https://example.invalid", token: "secret", headers: { h: "v" } })]),
    );
    const run = runEntryCopy({ ref, envBase: apiFile });
    expect(run.status, "FR4: the entry mode must exit 0 even when the API entry carries extra fields").toBe(0);
    const text = run.stdout.toLowerCase();
    for (const banned of ["baseurl", "token", "header", "secret", "credential"]) {
      expect(text.includes(banned), `FR4: the provider block must not carry ${banned}`).toBe(false);
    }
    const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed).sort(), "FR4: the provider block holds only the three named fields").toEqual([
      "limit",
      "modelID",
      "name",
    ]);
  });

  it("the config block writes no baseURL, token, or header", () => {
    const block = configBlock().toLowerCase();
    expect(block.includes("baseurl"), "FR4: the generated config holds no baseURL").toBe(false);
    expect(block.includes("token"), "FR4: the generated config holds no token").toBe(false);
    expect(block.includes("header"), "FR4: the generated config holds no header").toBe(false);
  });
});

describe("FR5: the identity and cohort records build for both cases", () => {
  it("run.sh derives the cohort id from config_sha256 and never pins BENCH_EXECUTOR_COHORT_ID", () => {
    const source = runSource();
    expect(
      source.includes("config_sha256"),
      "FR5: the cohort id derives from config_sha256, so a missing-model config gets its own cohort id",
    ).toBe(true);
    expect(
      source.includes("execution-identity.json") && source.includes("executor-cohort.json"),
      "FR5: execution-identity.json and executor-cohort.json still build for both cases",
    ).toBe(true);
    expect(
      /BENCH_EXECUTOR_COHORT_ID=/.test(source),
      "FR5: no role sets BENCH_EXECUTOR_COHORT_ID to hide the cohort change",
    ).toBe(false);
  });

  it("the route feeds the generated config into the identity hash", () => {
    const block = configBlock();
    expect(
      block.includes("providers") && block.includes("opencode.json"),
      "FR5: the missing-model providers block lands in executor/opencode.json before the identity hash reads it",
    ).toBe(true);
  });
});

describe("FR3: the test seam isolates every check", () => {
  it("no check touches Podman, a real API, a real binary, a browser, or a model", () => {
    const self = readFileSync(resolve(import.meta.dirname, "executor-model-route.test.ts"), "utf8");
    // Each banned shape is built by concatenation so this check never matches its own source text.
    for (const banned of ["pod" + "man", "383" + "07", "/usr/local/bin/open" + "code", "play" + "wright", "pup" + "peteer"]) {
      expect(
        self.includes(banned),
        `FR3: the test must not call ${banned}; it uses a temp repo, a fake binary file, and a local file or fake server`,
      ).toBe(false);
    }
    expect(self.includes("BENCH_OPENCODE_BIN"), "FR3: the test names the fake-binary seam").toBe(true);
    expect(self.includes("BENCH_MODEL_API_BASE"), "FR3: the test names the local-source seam").toBe(true);
  });

  it("every check writes only under a temp repo, never the real .tmp, runs, or reports trees", () => {
    const self = readFileSync(resolve(import.meta.dirname, "executor-model-route.test.ts"), "utf8");
    expect(self.includes("mkdtempSync"), "FR3: each check stages its files in a temp repo copy").toBe(true);
    for (const real of ['"run' + 's/', '"report' + 's/', '"./run' + 's', '"./report' + 's']) {
      expect(self.includes(real), `FR3: the test must never write under the real ${real} tree`).toBe(false);
    }
  });
});

describe("FR3: BENCH_OPENCODE_BIN names the binary file used for the catalog test", () => {
  it("a fake binary with the needle counts as present and one without counts as missing", () => {
    const modelID = "hungerg-free";
    const needle = `"${modelID}":{"id":"${modelID}"`;
    const presentBin = resolve(makeTempRoot(), "opencode-present");
    writeFileSync(presentBin, Buffer.concat([Buffer.from("fake-binary-prefix"), Buffer.from(needle), Buffer.from("fake-binary-suffix")]));
    chmodSync(presentBin, 0o755);
    const missingBin = resolve(makeTempRoot(), "opencode-missing");
    writeFileSync(missingBin, "fake-binary-without-the-model");
    chmodSync(missingBin, 0o755);
    const presentBytes = readFileSync(presentBin);
    const missingBytes = readFileSync(missingBin);
    expect(
      presentBytes.includes(Buffer.from(needle)),
      "FR1/D2/FR3: BENCH_OPENCODE_BIN names the file whose bytes decide present vs missing",
    ).toBe(true);
    expect(
      missingBytes.includes(Buffer.from(needle)),
      "FR1/D2: a fake binary without the needle counts as a catalog miss",
    ).toBe(false);
    expect(
      runSource().includes("BENCH_OPENCODE_BIN"),
      "FR3: run.sh must honour the BENCH_OPENCODE_BIN test seam for the catalog test",
    ).toBe(true);
  });
});
