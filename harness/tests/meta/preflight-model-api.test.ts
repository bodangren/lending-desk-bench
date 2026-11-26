import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareOpencodeRun, ROOT } from "./opencode-run-fixtures";

const HARNESS = resolve(import.meta.dirname, "../..");
const BATCH = resolve(HARNESS, "batch.sh");
const HELPER = resolve(HARNESS, "model-api-refs.py");
const DEFAULT_BASE = "http://127.0.0.1:38307";
const FR2_PREFIX = "executor preflight failed: the model API does not list ";
const D6_PREFIX = "executor preflight failed: the model API is unreachable at ";

function batchSource(): string {
  return readFileSync(BATCH, "utf8");
}

function makeTempRoot(): string {
  mkdirSync("/tmp/opencode", { recursive: true });
  return mkdtempSync("/tmp/opencode/preflight-red-");
}

function payloadData(entries: unknown[]): string {
  return JSON.stringify({ location: { directory: "fake" }, data: entries });
}

function activeEntry(ref: string, extra: Record<string, unknown> = {}) {
  const [providerID, modelID] = ref.split("/");
  return {
    id: `id-${modelID}`,
    modelID,
    providerID,
    type: "language",
    name: modelID,
    enabled: true,
    status: "active",
    ...extra,
  };
}

/** Copies the scripts under test into a temp repo and runs the helper copy. No real API. */
function runHelperCopy(opts: {
  envBase?: string;
  unsetBase?: boolean;
  files?: Record<string, string>;
}): { status: number; stdout: string; stderr: string; root: string } {
  const root = makeTempRoot();
  const harness = resolve(root, "harness");
  mkdirSync(harness, { recursive: true });
  copyFileSync(BATCH, resolve(harness, "batch.sh"));
  const helperCopy = resolve(harness, "model-api-refs.py");
  if (!existsSync(HELPER)) {
    return { status: 127, stdout: "", stderr: "FR1: harness/model-api-refs.py is missing", root };
  }
  copyFileSync(HELPER, helperCopy);
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    writeFileSync(resolve(root, name), content);
  }
  // A fake opencode on the PATH records each call. The helper must never call it (FR4).
  const bin = resolve(root, "bin");
  mkdirSync(bin, { recursive: true });
  const opencodeLog = resolve(root, "opencode-calls.jsonl");
  const opencode = resolve(bin, "opencode");
  writeFileSync(
    opencode,
    `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(opencodeLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");\nconsole.log("fake opencode");\n`,
  );
  chmodSync(opencode, 0o755);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
  };
  if (opts.unsetBase) delete env.BENCH_MODEL_API_BASE;
  else if (opts.envBase !== undefined) env.BENCH_MODEL_API_BASE = opts.envBase;
  const result = spawnSync("python3", ["-I", helperCopy], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  return { status: result.status ?? 99, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? ""), root };
}

function stdoutLines(stdout: string): string[] {
  return stdout.split("\n").filter((line) => line.length > 0);
}

/** Stages a temp repo with copies of the scripts under test and a fake opencode on the PATH. */
function stageHelperRun(opts: {
  envBase?: string;
  unsetBase?: boolean;
  files?: Record<string, string>;
}): { root: string; helperCopy: string; env: NodeJS.ProcessEnv } {
  const root = makeTempRoot();
  const harness = resolve(root, "harness");
  mkdirSync(harness, { recursive: true });
  copyFileSync(BATCH, resolve(harness, "batch.sh"));
  const helperCopy = resolve(harness, "model-api-refs.py");
  if (existsSync(HELPER)) copyFileSync(HELPER, helperCopy);
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    writeFileSync(resolve(root, name), content);
  }
  // A fake opencode on the PATH records each call. The helper must never call it (FR4).
  const bin = resolve(root, "bin");
  mkdirSync(bin, { recursive: true });
  const opencodeLog = resolve(root, "opencode-calls.jsonl");
  const opencode = resolve(bin, "opencode");
  writeFileSync(
    opencode,
    `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(opencodeLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");\nconsole.log("fake opencode");\n`,
  );
  chmodSync(opencode, 0o755);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
  };
  if (opts.unsetBase) delete env.BENCH_MODEL_API_BASE;
  else if (opts.envBase !== undefined) env.BENCH_MODEL_API_BASE = opts.envBase;
  return { root, helperCopy, env };
}

/**
 * Async variant of runHelperCopy for cases where a local fake server must answer
 * while the helper runs. spawnSync blocks the event loop, so a node:http fake server
 * in the same process can never reply; async spawn keeps the loop alive.
 */
function runHelperCopyAsync(opts: {
  envBase?: string;
  unsetBase?: boolean;
  files?: Record<string, string>;
}): Promise<{ status: number; stdout: string; stderr: string; root: string }> {
  const { root, helperCopy, env } = stageHelperRun(opts);
  if (!existsSync(HELPER)) {
    return Promise.resolve({ status: 127, stdout: "", stderr: "FR1: harness/model-api-refs.py is missing", root });
  }
  return new Promise((resolveDone) => {
    const child = spawn("python3", ["-I", helperCopy], { cwd: root, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveDone({ status: 99, stdout, stderr: `${stderr}FR2/D3: the helper timed out`, root });
    }, 20_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveDone({ status: code ?? 99, stdout, stderr, root });
    });
  });
}

describe("preflight model list from the OpenChamber API (spec FR1 to FR4)", () => {
  it("FR1: the helper exists and the preflight reads the list through it", () => {
    expect(existsSync(HELPER), "FR1: harness/model-api-refs.py must exist (D1)").toBe(true);
    const source = batchSource();
    expect(source.includes("model-api-refs.py"), "FR1: batch.sh must call harness/model-api-refs.py").toBe(true);
    expect(source.includes("python3 -I"), "FR1: batch.sh must run the helper as python3 -I (D1)").toBe(true);
    expect(source.includes("BENCH_MODEL_API_BASE"), "FR1: batch.sh must read BENCH_MODEL_API_BASE").toBe(true);
    expect(source.includes(DEFAULT_BASE), `FR1: the default base URL must be ${DEFAULT_BASE} (D2)`).toBe(true);
  });

  it("FR1: one listed active ref passes with refs only on stdout", () => {
    const ref = "opencode-go/hungerg-free";
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([activeEntry(ref)]));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "FR1: an active listed ref must exit 0").toBe(0);
    expect(stdoutLines(run.stdout), "FR1: the helper must print one providerID/modelID ref per line and no other stdout text").toEqual([ref]);
  });

  it("FR2/D5: a ref with enabled:false is omitted", () => {
    const ref = "opencode-go/hungerg-free";
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([activeEntry(ref, { enabled: false })]));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "FR2: a disabled entry is still a valid list, so the helper must exit 0 (D3)").toBe(0);
    expect(stdoutLines(run.stdout).includes(ref), "FR2/D5: enabled:false must omit the ref").toBe(false);
  });

  it("FR2/D5: a ref with a non-active status is omitted", () => {
    const ref = "opencode-go/hungerg-free";
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([activeEntry(ref, { status: "disabled" })]));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "FR2: a payload with a non-active entry is still a valid list, so the helper must exit 0 (D3)").toBe(0);
    expect(stdoutLines(run.stdout).includes(ref), "FR2/D5: status != active must omit the ref").toBe(false);
  });

  it("FR2/D4: a reachable API without the ref stops with the FR2 message and an exact match", () => {
    const source = batchSource();
    expect(
      source.includes(FR2_PREFIX),
      "FR2: a reachable API without the ref must stop with `executor preflight failed: the model API does not list <ref>`",
    ).toBe(true);
    expect(
      source.includes('grep -qFx "$FIRST_MODEL_REF"'),
      "FR2/D4: the match must be exact via grep -qFx, so a substring must not pass",
    ).toBe(true);
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([activeEntry("opencode-go/other-free")]));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "FR2: a reachable valid list without the ref must exit 0 (the batch, not the helper, stops with exit 3)").toBe(0);
    expect(stdoutLines(run.stdout).includes("opencode-go/hungerg-free"), "FR2: the missing ref must not appear in the helper output").toBe(false);
  });

  it("FR2/D7: a transient helper failure retries up to three times with a five-second delay", () => {
    const source = batchSource();
    expect(source.includes("for attempt in 1 2 3"), "FR2: the preflight must retry a transient helper failure up to three times").toBe(true);
    expect(source.includes("sleep 5"), "FR2/D9: the preflight must wait five seconds between attempts").toBe(true);
    // The retry applies only to helper exit 2: a successful empty list stops at once (D7).
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([]));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "FR2/D7: an empty list is a valid list, so the helper must exit 0 and stop the retry at once").toBe(0);
    expect(run.stdout, "FR2/D7: an empty valid list must print no refs").toBe("");
    // A broken payload is transient: exit 2, nothing on stdout, one short reason on stderr (D3).
    const badFile = resolve(makeTempRoot(), "bad.json");
    mkdirSync(dirname(badFile), { recursive: true });
    writeFileSync(badFile, "{not json");
    const bad = runHelperCopy({ envBase: badFile });
    expect(bad.status, "FR2/D3: a fetch, parse, or payload failure must exit 2").toBe(2);
    expect(bad.stdout, "FR2/D3: the helper must print nothing on stdout when it exits 2").toBe("");
    expect(bad.stderr.trim().split("\n").length, "FR2/D3: the helper must write one short reason to stderr").toBe(1);
  });

  it("FR2/D6: a failed API after the retries stops with the distinct D6 message", () => {
    const source = batchSource();
    expect(
      source.includes(D6_PREFIX),
      "FR2/D6: an unreachable API must stop with `executor preflight failed: the model API is unreachable at <base>`",
    ).toBe(true);
    const run = runHelperCopy({ envBase: "http://127.0.0.1:1" });
    expect(run.status, "FR2: an unreachable API must surface as helper exit 2 for the retry loop").toBe(2);
    expect(run.stdout, "FR2/D3: an unreachable API must print nothing on stdout").toBe("");
  });

  it("FR3: no opencode models call; the version, ripgrep, and credential checks stay", () => {
    const source = batchSource();
    expect(source.includes("opencode_host_run models"), "FR3: batch.sh must never call `opencode_host_run models`").toBe(false);
    expect(source.includes("opencode_host_run --version"), "FR3: the opencode_host_run --version check must stay unchanged").toBe(true);
    expect(source.includes("RG_PINNED_SHA256"), "FR3: the pinned ripgrep check must stay unchanged").toBe(true);
    expect(source.includes("opencode-credential.sh") && source.includes("preflight"), "FR3: the opencode-credential.sh preflight call must stay unchanged").toBe(true);
    expect(source.includes("opencode-credential.sh") && source.includes("seed"), "FR3: the opencode-credential.sh seed call must stay unchanged").toBe(true);
  });

  it("FR4: BENCH_MODEL_API_BASE names a local JSON file or a local fake server, never the real API", async () => {
    const source = batchSource();
    expect(source.includes("BENCH_MODEL_API_BASE"), "FR4: the preflight must honour the BENCH_MODEL_API_BASE test seam").toBe(true);
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([activeEntry("opencode-go/hy4-flash-free")]));
    const fromFile = runHelperCopy({ envBase: apiFile });
    expect(fromFile.status, "FR4: BENCH_MODEL_API_BASE must accept a local JSON file").toBe(0);
    expect(stdoutLines(fromFile.stdout), "FR4: the file seam must list the same refs as a server").toEqual(["opencode-go/hy4-flash-free"]);
    const payload = payloadData([activeEntry("opencode-go/hungerg-free")]);
    // Requests are recorded here and asserted after the run: no assertion may
    // throw inside the server callback.
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(String(req.url));
      if (req.url === "/api/model") {
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
      // Async spawn keeps the event loop alive, so the fake server answers while the helper runs (FR4).
      const run = await runHelperCopyAsync({ envBase: `http://127.0.0.1:${port}` });
      expect(run.status, "FR4: BENCH_MODEL_API_BASE must accept a local fake server").toBe(0);
      expect(stdoutLines(run.stdout), "FR4: the fake-server seam must list the API refs").toEqual(["opencode-go/hungerg-free"]);
      expect(requests, "FR4: the helper must read the list from the local fake server").toContain("/api/model");
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("FR4: the helper makes no opencode call", () => {
    const root = makeTempRoot();
    const bin = resolve(root, "bin");
    mkdirSync(bin, { recursive: true });
    const opencodeLog = resolve(root, "opencode-calls.jsonl");
    const opencode = resolve(bin, "opencode");
    writeFileSync(
      opencode,
      `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(opencodeLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");\nconsole.log("fake opencode");\n`,
    );
    chmodSync(opencode, 0o755);
    const apiFile = resolve(root, "api.json");
    writeFileSync(apiFile, payloadData([activeEntry("opencode-go/hungerg-free")]));
    const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, BENCH_MODEL_API_BASE: apiFile };
    if (existsSync(HELPER)) {
      const helperCopy = resolve(root, "model-api-refs.py");
      copyFileSync(HELPER, helperCopy);
      const run = spawnSync("python3", ["-I", helperCopy], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
      expect(run.status, "FR4: the helper must exit 0 on a valid local file").toBe(0);
    } else {
      expect(existsSync(HELPER), "FR1/FR4: harness/model-api-refs.py must exist so the list needs no opencode call").toBe(true);
    }
    expect(existsSync(opencodeLog), "FR4: the fake opencode must record each call, and the helper run must make none").toBe(false);
  });

  it("AC6: a batch pinned to opencode-go/hungerg-free passes when the API lists it active and enabled", () => {
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([activeEntry("opencode-go/hungerg-free"), activeEntry("opencode-go/hy4-flash-free")]));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "AC6: the API list with hungerg-free active and enabled must exit 0").toBe(0);
    const lines = stdoutLines(run.stdout);
    expect(lines.includes("opencode-go/hungerg-free"), "AC6: the helper must list opencode-go/hungerg-free").toBe(true);
    expect(batchSource().includes('grep -qFx "$FIRST_MODEL_REF"'), "AC6/FR2: the preflight must accept the pinned ref through the exact helper-output match").toBe(true);
  });

  it("FR1/D2: an unset base falls back to the default and a missing payload fails closed", () => {
    const source = batchSource();
    expect(source.includes(DEFAULT_BASE), "FR1/D2: an unset or empty BENCH_MODEL_API_BASE must use http://127.0.0.1:38307").toBe(true);
    const helperSource = existsSync(HELPER) ? readFileSync(HELPER, "utf8") : "";
    expect(helperSource.includes(DEFAULT_BASE), "FR1/D2: the helper must carry the same default base URL").toBe(true);
    const noDataFile = resolve(makeTempRoot(), "nodata.json");
    mkdirSync(dirname(noDataFile), { recursive: true });
    writeFileSync(noDataFile, JSON.stringify({ location: {} }));
    const run = runHelperCopy({ envBase: noDataFile });
    expect(run.status, "FR2/D3: a payload without a data list must fail with exit 2").toBe(2);
    expect(run.stdout, "FR2/D3: a payload failure must print nothing on stdout").toBe("");
  });
});

const ALLOWED_LINE = /^[A-Za-z0-9._:@+~-]+\/[A-Za-z0-9._:@+~\/\[\]-]+$/;

/** A fake server that always answers one fixed payload on /api/model. */
function servePayload(payload: string, status = 200): Promise<{ server: Server; url: string; hits: () => number }> {
  let hits = 0;
  const server = createServer((req, res) => {
    if (req.url === "/api/model") {
      hits += 1;
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
      resolveListen({ server, url: `http://127.0.0.1:${port}`, hits: () => hits });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

describe("Review A F1: the helper accepts only a regular file or an http(s) base URL", () => {
  it("a redirect from a local fake server must exit 2 with empty stdout", async () => {
    const valid = payloadData([activeEntry("opencode-go/hungerg-free")]);
    // A single redirect to a valid payload: a follower would exit 0, so exit 2
    // proves the helper rejects redirects instead of following them.
    const server = createServer((req, res) => {
      if (req.url === "/api/model") {
        res.writeHead(302, { location: "/api/v2/model" });
        res.end();
      } else if (req.url === "/api/v2/model") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(valid);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const run = await runHelperCopyAsync({ envBase: `http://127.0.0.1:${port}` });
      expect(run.status, "F1: an HTTP redirect must exit 2, never follow to a 200").toBe(2);
      expect(run.stdout, "F1: a redirect must print nothing on stdout").toBe("");
      expect(run.stderr.trim().split("\n").length, "F1: a redirect must write one short reason to stderr").toBe(1);
    } finally {
      await closeServer(server);
    }
  });

  it("an ftp base URL must exit 2 with empty stdout", () => {
    const run = runHelperCopy({ envBase: "ftp://127.0.0.1:21/api/model" });
    expect(run.status, "F1: an ftp source is not a regular file or http(s) and must exit 2").toBe(2);
    expect(run.stdout, "F1: a rejected scheme must print nothing on stdout").toBe("");
    expect(run.stderr.trim().split("\n").length, "F1: a rejected scheme must write one short reason to stderr").toBe(1);
  });

  it("a file: URL must exit 2 even when it names a valid payload", () => {
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([activeEntry("opencode-go/hungerg-free")]));
    const run = runHelperCopy({ envBase: `file://${apiFile}` });
    expect(run.status, "F1: a file: URL is not a plain file path and must exit 2").toBe(2);
    expect(run.stdout, "F1: a file: URL must print nothing on stdout").toBe("");
    expect(run.stderr.trim().split("\n").length, "F1: a file: URL must write one short reason to stderr").toBe(1);
  });

  it("a data: URL must exit 2 even when it carries a valid payload", () => {
    const payload = encodeURIComponent(payloadData([activeEntry("opencode-go/hungerg-free")]));
    const run = runHelperCopy({ envBase: `data:application/json,${payload}` });
    expect(run.status, "F1: a data: URL is not a regular file or http(s) and must exit 2").toBe(2);
    expect(run.stdout, "F1: a data: URL must print nothing on stdout").toBe("");
    expect(run.stderr.trim().split("\n").length, "F1: a data: URL must write one short reason to stderr").toBe(1);
  });
});

describe("Review A F2: the helper bounds the payload size and the total fetch time", () => {
  const FOUR_MIB = 4 * 1024 * 1024;

  function bigPayload(bytes: number): string {
    return JSON.stringify({
      location: { directory: "fake" },
      pad: "x".repeat(bytes),
      data: [activeEntry("opencode-go/hungerg-free")],
    });
  }

  it("an HTTP payload over 4 MiB must exit 2 with empty stdout", async () => {
    const { server, url } = await servePayload(bigPayload(5 * 1024 * 1024));
    try {
      const run = await runHelperCopyAsync({ envBase: url });
      expect(run.status, "F2: a payload over the 4 MiB limit must exit 2").toBe(2);
      expect(run.stdout, "F2: an oversize payload must print nothing on stdout").toBe("");
      expect(run.stderr.trim().split("\n").length, "F2: an oversize payload must write one short reason to stderr").toBe(1);
    } finally {
      await closeServer(server);
    }
  });

  it("a file payload over 4 MiB must exit 2 with empty stdout", () => {
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, bigPayload(5 * 1024 * 1024));
    expect(bigPayload(100).length, "F2: test sanity").toBeGreaterThan(0);
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "F2: a file over the 4 MiB limit must exit 2").toBe(2);
    expect(run.stdout, "F2: an oversize file must print nothing on stdout").toBe("");
    expect(run.stderr.trim().split("\n").length, "F2: an oversize file must write one short reason to stderr").toBe(1);
    expect(FOUR_MIB, "F2: the documented size limit is 4 MiB").toBe(4 * 1024 * 1024);
  });

  it("a slow-drip server that never ends must exit 2 within the total deadline", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/api/model") {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"location":{}, "data":[');
        const timer = setInterval(() => {
          if (!res.write(" ")) {
            // Keep dripping: backpressure never ends this response.
          }
        }, 200);
        const stop = () => clearInterval(timer);
        res.on("close", stop);
        req.on("close", stop);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const started = Date.now();
      const run = await runHelperCopyAsync({ envBase: `http://127.0.0.1:${port}` });
      const elapsed = Date.now() - started;
      expect(run.status, `F2: a never-ending response must stop with exit 2 inside the total deadline (got ${run.status})`).toBe(2);
      expect(elapsed, `F2: the bounded fetch must finish well under ~15 s (took ${elapsed} ms)`).toBeLessThan(20_000);
      expect(run.stdout, "F2: a timed-out fetch must print nothing on stdout").toBe("");
    } finally {
      await closeServer(server);
    }
  }, 60_000);

  it("a small valid payload still exits 0", async () => {
    const { server, url } = await servePayload(bigPayload(100 * 1024));
    try {
      const run = await runHelperCopyAsync({ envBase: url });
      expect(run.status, "F2: a payload under the limit must exit 0").toBe(0);
      expect(stdoutLines(run.stdout), "F2: a payload under the limit must list its refs").toEqual(["opencode-go/hungerg-free"]);
    } finally {
      await closeServer(server);
    }
  });
});

describe("Review A F3: provider and model IDs are validated before print", () => {
  it("a newline, carriage return, control char, or whitespace ID is skipped, never printed", () => {
    const hostile = [
      activeEntry("opencode-go/ok-free"),
      { ...activeEntry("opencode-go/x1"), providerID: "opencode-go\nopencode-go/evil-free" },
      { ...activeEntry("opencode-go/x2"), modelID: "bad\rmodel" },
      { ...activeEntry("opencode-go/x3"), modelID: "badmodel" },
      { ...activeEntry("opencode-go/x4"), providerID: "opencode go" },
      { ...activeEntry("opencode-go/x5"), modelID: "bad\tmodel" },
    ];
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData(hostile));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "F3: skipping a hostile entry is not fatal, so the helper must exit 0").toBe(0);
    const lines = stdoutLines(run.stdout);
    expect(lines, "F3: only the valid entry may print").toEqual(["opencode-go/ok-free"]);
    for (const line of lines) {
      expect(ALLOWED_LINE.test(line), `F3: every printed line must match the allowed pattern (got ${JSON.stringify(line)})`).toBe(true);
    }
  });

  it("an empty provider or model ID is skipped, never printed", () => {
    const hostile = [
      activeEntry("opencode-go/ok-free"),
      { ...activeEntry("opencode-go/x1"), providerID: "" },
      { ...activeEntry("opencode-go/x2"), modelID: "" },
    ];
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData(hostile));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "F3: skipping an empty ID is not fatal, so the helper must exit 0").toBe(0);
    expect(stdoutLines(run.stdout), "F3: only the valid entry may print").toEqual(["opencode-go/ok-free"]);
  });

  it("a provider ID with a slash is skipped, but a slash inside the model ID is allowed", () => {
    const entries = [
      activeEntry("opencode-go/ok-free"),
      { ...activeEntry("opencode-go/x1"), providerID: "a/b", modelID: "c" },
      { ...activeEntry("openrouter/x"), providerID: "openrouter", modelID: "vendor/part" },
    ];
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData(entries));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "F3: skipping an ambiguous provider is not fatal, so the helper must exit 0").toBe(0);
    expect(stdoutLines(run.stdout), "F3: the ambiguous provider must not print but vendor/part stays").toEqual([
      "opencode-go/ok-free",
      "openrouter/vendor/part",
    ]);
  });

  it("a hostile entry cannot make the requested ref appear", () => {
    const ref = "opencode-go/hungerg-free";
    const entries = [
      activeEntry("opencode-go/other-free"),
      { ...activeEntry("opencode-go/x"), providerID: "opencode-go", modelID: `other\n${ref}` },
      { ...activeEntry("opencode-go/y"), providerID: `x\n${ref}`, modelID: "other" },
    ];
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData(entries));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "F3: skipping hostile entries is not fatal, so the helper must exit 0").toBe(0);
    const lines = stdoutLines(run.stdout);
    expect(lines.includes(ref), "F3: a hostile entry must never make the requested ref appear").toBe(false);
    expect(lines, "F3: only the genuine entry may print").toEqual(["opencode-go/other-free"]);
  });
});

describe("Review A r2 F8: the helper prints the real catalog ID classes", () => {
  it("a tilde alias, a multi-segment model, a bracketed model, and the batch refs each print once", () => {
    // Character classes observed live on 2026-11-26 (470 entries): providers use
    // letters, digits, and . _ : @ + -; models add / and ~ (18 openrouter
    // aliases such as ~anthropic/claude-opus-latest) and may carry [ ] (for
    // example claude-opus-5-5[1m]). The synthetic last entry covers _ : @ +.
    const entries = [
      activeEntry("opencode-go/hungerg-free"),
      activeEntry("opencode-go/hy4-flash-free"),
      { ...activeEntry("minimax-cn-coding-plan/x"), providerID: "minimax-cn-coding-plan", modelID: "MiniMax-M3.1-Flash" },
      { ...activeEntry("openrouter/x"), providerID: "openrouter", modelID: "~anthropic/claude-opus-latest" },
      { ...activeEntry("nvidia/x"), providerID: "nvidia", modelID: "google/google-paligemma" },
      { ...activeEntry("openrouter/y"), providerID: "openrouter", modelID: "vendor/claude-opus-5-5[1m]" },
      { ...activeEntry("test_provider/x"), providerID: "test_provider", modelID: "a+b:c@d_e" },
    ];
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData(entries));
    const run = runHelperCopy({ envBase: apiFile });
    expect(run.status, "F8: catalog IDs are valid, so the helper must exit 0").toBe(0);
    const expected = [
      "opencode-go/hungerg-free",
      "opencode-go/hy4-flash-free",
      "minimax-cn-coding-plan/MiniMax-M3.1-Flash",
      "openrouter/~anthropic/claude-opus-latest",
      "nvidia/google/google-paligemma",
      "openrouter/vendor/claude-opus-5-5[1m]",
      "test_provider/a+b:c@d_e",
    ];
    expect(stdoutLines(run.stdout), "F8: every real catalog ID class must print once as provider/model").toEqual(expected);
    for (const line of stdoutLines(run.stdout)) {
      expect(ALLOWED_LINE.test(line), `F8: every printed line keeps the delimiter validation (got ${JSON.stringify(line)})`).toBe(true);
    }
  });
});

describe("Review A r2 F9: a malformed base URL fails closed with exit 2", () => {
  for (const base of ["http://[::1", "http://[bad]/"]) {
    it(`the helper rejects ${base} with exit 2, empty stdout, and one stderr line`, () => {
      const run = runHelperCopy({ envBase: base });
      expect(run.status, `F9: the malformed base ${base} must exit 2, not traceback`).toBe(2);
      expect(run.stdout, `F9: the malformed base ${base} must print nothing on stdout`).toBe("");
      expect(run.stderr.trim().split("\n").length, `F9: the malformed base ${base} must write one short reason to stderr`).toBe(1);
    });
  }
});

describe("Review A F4: read, parse, and print failures exit 2 with one short line", () => {
  function d3(run: { status: number; stdout: string; stderr: string }, label: string): void {
    expect(run.status, `${label}: the failure must exit 2`).toBe(2);
    expect(run.stdout, `${label}: the failure must print nothing on stdout`).toBe("");
    expect(run.stderr.trim().split("\n").length, `${label}: the failure must write one short reason to stderr`).toBe(1);
  }

  it("a file with invalid UTF-8 exits 2 with empty stdout", () => {
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d]));
    d3(runHelperCopy({ envBase: apiFile }), "F4: invalid UTF-8");
  });

  it("deeply nested JSON exits 2 with empty stdout", () => {
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, `[${"[".repeat(300_000)}`);
    d3(runHelperCopy({ envBase: apiFile }), "F4: deeply nested JSON");
  });

  it("an output encoding failure exits 2 and prints nothing, not even earlier refs", () => {
    const entries = [activeEntry("opencode-go/ok-free"), { ...activeEntry("opencode-go/x"), modelID: "\ud800" }];
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData(entries));
    d3(runHelperCopy({ envBase: apiFile }), "F4: an unprintable ID");
  });
});

/**
 * Review A F6: exercise the REAL batch preflight block.
 *
 * The fixture copies batch.sh and its prerequisites into a temp repo with fake
 * binaries: the proven opencode/podman/credential doubles from
 * opencode-run-fixtures, a fake sleep that records each delay argument, and a
 * fake python3 that records helper invocations and scripts the helper exit
 * code (delegate runs the real helper). No test calls sleep itself; the batch
 * calls the fake sleep. Nothing touches the real .tmp/, runs/, or reports/.
 */
type PreflightBatch = {
  run: ReturnType<typeof prepareOpencodeRun>;
  root: string;
  harness: string;
  helperCalls: string;
  sleepLog: string;
  execute: (extraEnv: Record<string, string>) => SpawnSyncReturns<string>;
  runDirs: () => string[];
};

function preparePreflightBatch(model: string, helperMode = "delegate"): PreflightBatch {
  const run = prepareOpencodeRun("a");
  const root = resolve(run.temp, "batch-root");
  const harness = resolve(root, "harness");
  const bin = resolve(root, "bin");
  mkdirSync(harness, { recursive: true });
  mkdirSync(bin, { recursive: true });
  for (const entry of readdirSync(HARNESS, { withFileTypes: true })) {
    if (entry.isFile() && /\.(sh|ts|json|cjs|py)$/.test(entry.name)) {
      cpSync(resolve(HARNESS, entry.name), resolve(harness, entry.name));
    } else if (entry.isDirectory() && ["node_modules", "tests", "bugfix", "tests-track", "change"].includes(entry.name)) {
      symlinkSync(resolve(HARNESS, entry.name), resolve(harness, entry.name), "dir");
    }
  }
  cpSync(resolve(ROOT, "fixture"), resolve(root, "fixture"), {
    recursive: true,
    filter: (source) => !["node_modules", ".next", ".git"].includes(basename(source)) && !source.endsWith(".tsbuildinfo"),
  });
  symlinkSync(resolve(ROOT, "fixture/node_modules"), resolve(root, "fixture/node_modules"), "dir");
  for (const name of ["reference", "reference-variant", "reference-change"]) {
    symlinkSync(resolve(ROOT, name), resolve(root, name), "dir");
  }
  const pricing = resolve(harness, "go-pricing.json");
  writeFileSync(pricing, JSON.stringify({
    schema: 1, provider: "opencode-go", aliases: {}, apis: { "openai-completions": { baseUrl: "https://example.invalid" } },
    models: {
      [model]: {
        name: model, api: "openai-completions", high_usage: true, batch: true,
        requests_per_month: 10000, monthly_usage_usd: 15,
        rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
    },
  }));
  // A fake sleep on the PATH. The batch calls it between retries; the test
  // never calls it directly.
  const sleepLog = resolve(root, "sleep-calls.txt");
  writeFileSync(bin + "/sleep", `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(sleepLog)}
`);
  chmodSync(bin + "/sleep", 0o755);
  // A fake python3 on the PATH. It records every call, scripts the helper
  // exit code through HELPER_MODE, and delegates everything else (including
  // the real helper run in delegate mode) to the real python3.
  const helperCalls = resolve(root, "python3-calls.jsonl");
  const helperCount = resolve(root, "python3-helper-count");
  writeFileSync(helperCount, "0");
  const realPython3 = spawnSync("bash", ["-c", "command -v python3"], { encoding: "utf8" }).stdout.trim();
  writeFileSync(bin + "/python3", `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(helperCalls)}
if [[ " $* " == *"model-api-refs.py"* ]]; then
  n="\$(cat ${JSON.stringify(helperCount)})"
  echo "\$((n + 1))" > ${JSON.stringify(helperCount)}
  case "\${HELPER_MODE:-delegate}" in
    exit1) exit 1 ;;
    exit3) exit 3 ;;
    flaky-once)
      if [ "$n" -lt 1 ]; then exit 2; fi ;;
  esac
fi
exec "${realPython3}" "\$@"
`);
  chmodSync(bin + "/python3", 0o755);
  return {
    run, root, harness, helperCalls, sleepLog,
    execute(extraEnv) {
      return spawnSync("/bin/bash", [resolve(harness, "batch.sh")], {
        cwd: harness, encoding: "utf8", timeout: 150_000, maxBuffer: 16 * 1024 * 1024,
        env: {
          ...run.env,
          PATH: `${bin}:${run.env.PATH}`,
          HELPER_MODE: helperMode,
          BENCH_PRICING_PATH: pricing,
          BENCH_SELFCHECK: "skip",
          FORCE: "1", ARMS: "a", REPS: "1", WEEK: "2099w01",
          ...extraEnv,
        },
      });
    },
    runDirs() {
      const path = resolve(root, "runs");
      return existsSync(path) ? readdirSync(path).filter((name) => name !== ".port-locks") : [];
    },
  };
}

function helperAttempts(batch: PreflightBatch): number {
  if (!existsSync(batch.helperCalls)) return 0;
  return readFileSync(batch.helperCalls, "utf8").split("\n").filter((line) => line.includes("model-api-refs.py")).length;
}

function sleepArgs(batch: PreflightBatch): string[] {
  if (!existsSync(batch.sleepLog)) return [];
  return readFileSync(batch.sleepLog, "utf8").split("\n").filter(Boolean);
}

function outputLines(result: SpawnSyncReturns<string>): string[] {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

describe("Review A F6: the real batch preflight block", () => {
  it("a reachable API without the ref stops with exit 3 and the exact FR2 message, with no run and no canary", () => {
    const batch = preparePreflightBatch("fake-model");
    try {
      const apiFile = resolve(batch.root, "api.json");
      writeFileSync(apiFile, payloadData([activeEntry("opencode-go/other-free")]));
      const result = batch.execute({ BENCH_MODEL_API_BASE: apiFile });
      const lines = outputLines(result);
      expect(result.status, `F6: a reachable API without the ref must stop with exit 3\n${result.stdout}\n${result.stderr}`).toBe(3);
      expect(lines, "F6: the batch must print the exact FR2 message").toContain(
        "executor preflight failed: the model API does not list opencode-go/fake-model",
      );
      expect(lines.some((line) => line.includes("EXECUTOR PREFLIGHT PASS")), "F6: the preflight must not pass").toBe(false);
      expect(helperAttempts(batch), "F6: a reachable list without the ref needs exactly one helper call").toBe(1);
      expect(sleepArgs(batch), "F6: a non-transient miss needs no delay").toEqual([]);
      expect(batch.runDirs(), "F6: a failed preflight must create no run directory").toEqual([]);
      expect(existsSync(resolve(batch.run.temp, "podman-calls.jsonl")), "F6: a failed preflight must start no agent").toBe(false);
      expect(existsSync(resolve(batch.harness, "canary.log")), "F6: a failed preflight must start no canary").toBe(false);
      expect(lines.some((line) => line.startsWith("CANARY")), "F6: a failed preflight must print no canary line").toBe(false);
    } finally {
      batch.run.cleanup();
    }
  }, 120_000);

  it("an unreachable API retries the helper three times with two five-second delays, then exit 3 and the D6 message", () => {
    const batch = preparePreflightBatch("fake-model");
    try {
      const base = "http://127.0.0.1:1";
      const result = batch.execute({ BENCH_MODEL_API_BASE: base });
      const lines = outputLines(result);
      expect(result.status, `F6: an unreachable API must stop with exit 3\n${result.stdout}\n${result.stderr}`).toBe(3);
      expect(lines, "F6: the batch must print the exact D6 message with the effective base").toContain(
        `executor preflight failed: the model API is unreachable at ${base}`,
      );
      expect(helperAttempts(batch), "F6: a transient helper failure must be retried up to three times").toBe(3);
      expect(sleepArgs(batch), "F6: the batch itself must record two five-second delays between three attempts").toEqual(["5", "5"]);
      expect(batch.runDirs(), "F6: a failed preflight must create no run directory").toEqual([]);
      expect(existsSync(resolve(batch.run.temp, "podman-calls.jsonl")), "F6: a failed preflight must start no agent").toBe(false);
    } finally {
      batch.run.cleanup();
    }
  }, 120_000);

  it("only helper exit 2 is retried: exit 1 stops at once with no delay and a distinct exit-3 message", () => {
    const batch = preparePreflightBatch("fake-model", "exit1");
    try {
      const apiFile = resolve(batch.root, "api.json");
      writeFileSync(apiFile, payloadData([activeEntry("opencode-go/fake-model")]));
      const result = batch.execute({ BENCH_MODEL_API_BASE: apiFile, BENCH_CANARY: "0" });
      const lines = outputLines(result);
      expect(result.status, `F6: a non-transient helper failure must stop with exit 3\n${result.stdout}\n${result.stderr}`).toBe(3);
      expect(helperAttempts(batch), "F6/F5: a non-exit-2 helper failure must be attempted exactly once").toBe(1);
      expect(sleepArgs(batch), "F6/F5: a non-exit-2 helper failure must cause no delay").toEqual([]);
      const failLines = lines.filter((line) => line.includes("executor preflight failed"));
      expect(failLines.length, "F6/F5: the batch must print one short preflight failure line").toBe(1);
      expect(failLines[0].includes("does not list"), "F6/F5: the message must not be the reachable-API FR2 message").toBe(false);
      expect(failLines[0].includes("unreachable at"), "F6/F5: the message must not be the unreachable D6 message").toBe(false);
      expect(batch.runDirs(), "F6: a failed preflight must create no run directory").toEqual([]);
    } finally {
      batch.run.cleanup();
    }
  }, 120_000);

  it("a first transient failure then a listed ref passes the preflight and lists hungerg-free (AC6)", () => {
    // The shim fails the first helper call with exit 2 and delegates the rest
    // to the real helper, so the real batch block performs a successful retry.
    // (A blocking batch run cannot share the loop with an in-process server.)
    const batch = preparePreflightBatch("hungerg-free", "flaky-once");
    try {
      const apiFile = resolve(batch.root, "api.json");
      writeFileSync(apiFile, payloadData([activeEntry("opencode-go/hungerg-free")]));
      const result = batch.execute({ BENCH_MODEL_API_BASE: apiFile, BENCH_CANARY: "0" });
      const lines = outputLines(result);
      expect(helperAttempts(batch), "F6: one transient failure then success needs two helper calls").toBe(2);
      const sleeps = sleepArgs(batch);
      expect(sleeps.filter((arg) => arg === "5").length, "F6: the batch itself must record one five-second delay after the transient failure").toBe(1);
      expect(sleeps[0], "F6: the first recorded delay must be the five-second preflight retry").toBe("5");
      expect(result.status, `F6/AC6: the preflight must pass when the API lists hungerg-free\n${result.stdout}\n${result.stderr}`).toBe(0);
      expect(lines.some((line) => line.includes("EXECUTOR PREFLIGHT PASS")), "F6/AC6: the batch must print EXECUTOR PREFLIGHT PASS").toBe(true);
    } finally {
      batch.run.cleanup();
    }
  }, 150_000);

  it("F9: a malformed base URL retries the helper three times, then exit 3 and the D6 message", () => {
    const batch = preparePreflightBatch("fake-model");
    try {
      const base = "http://[bad]/";
      const result = batch.execute({ BENCH_MODEL_API_BASE: base });
      const lines = outputLines(result);
      expect(result.status, `F9: a malformed base must stop with exit 3\n${result.stdout}\n${result.stderr}`).toBe(3);
      expect(lines, "F9: a malformed base is a fetch failure, so the batch must print the D6 message").toContain(
        `executor preflight failed: the model API is unreachable at ${base}`,
      );
      expect(helperAttempts(batch), "F9: a malformed base normalizes to exit 2, so the batch retries three times").toBe(3);
      expect(sleepArgs(batch), "F9: the batch itself must record two five-second delays between three attempts").toEqual(["5", "5"]);
      expect(batch.runDirs(), "F9: a failed preflight must create no run directory").toEqual([]);
      expect(existsSync(resolve(batch.run.temp, "podman-calls.jsonl")), "F9: a failed preflight must start no agent").toBe(false);
    } finally {
      batch.run.cleanup();
    }
  }, 120_000);
});
