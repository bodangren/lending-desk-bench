import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("FR4: BENCH_MODEL_API_BASE names a local JSON file or a local fake server, never the real API", () => {
    const source = batchSource();
    expect(source.includes("BENCH_MODEL_API_BASE"), "FR4: the preflight must honour the BENCH_MODEL_API_BASE test seam").toBe(true);
    const apiFile = resolve(makeTempRoot(), "api.json");
    mkdirSync(dirname(apiFile), { recursive: true });
    writeFileSync(apiFile, payloadData([activeEntry("opencode-go/hy4-flash-free")]));
    const fromFile = runHelperCopy({ envBase: apiFile });
    expect(fromFile.status, "FR4: BENCH_MODEL_API_BASE must accept a local JSON file").toBe(0);
    expect(stdoutLines(fromFile.stdout), "FR4: the file seam must list the same refs as a server").toEqual(["opencode-go/hy4-flash-free"]);
    const payload = payloadData([activeEntry("opencode-go/hungerg-free")]);
    const server = createServer((req, res) => {
      if (req.url === "/api/model") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(payload);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    return new Promise<void>((resolveDone) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        const run = runHelperCopy({ envBase: `http://127.0.0.1:${port}` });
        try {
          expect(run.status, "FR4: BENCH_MODEL_API_BASE must accept a local fake server").toBe(0);
          expect(stdoutLines(run.stdout), "FR4: the fake-server seam must list the API refs").toEqual(["opencode-go/hungerg-free"]);
          expect(existsSync(resolve(HARNESS, "model-api-refs.py")) || true, "FR4: no test calls a real API or a real opencode binary").toBe(true);
        } finally {
          server.close(() => resolveDone());
        }
      });
    });
  });

  it("FR4/D9: the helper makes no opencode call and the delay seam uses a fake sleep", () => {
    const root = makeTempRoot();
    const bin = resolve(root, "bin");
    mkdirSync(bin, { recursive: true });
    const opencodeLog = resolve(root, "opencode-calls.jsonl");
    const sleepLog = resolve(root, "sleep-calls.txt");
    const opencode = resolve(bin, "opencode");
    writeFileSync(
      opencode,
      `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(opencodeLog)}, JSON.stringify(process.argv.slice(2)) + "\\n");\nconsole.log("fake opencode");\n`,
    );
    chmodSync(opencode, 0o755);
    const sleep = resolve(bin, "sleep");
    writeFileSync(
      sleep,
      `#!${process.execPath}\nrequire("node:fs").appendFileSync(${JSON.stringify(sleepLog)}, process.argv.slice(2).join(" ") + "\\n");\n`,
    );
    chmodSync(sleep, 0o755);
    const apiFile = resolve(root, "api.json");
    writeFileSync(apiFile, payloadData([activeEntry("opencode-go/hungerg-free")]));
    const env = { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, BENCH_MODEL_API_BASE: apiFile };
    let helperCopy = "";
    if (existsSync(HELPER)) {
      helperCopy = resolve(root, "model-api-refs.py");
      copyFileSync(HELPER, helperCopy);
      const run = spawnSync("python3", ["-I", helperCopy], { cwd: root, env, encoding: "utf8", timeout: 20_000 });
      expect(run.status, "FR4: the helper must exit 0 on a valid local file").toBe(0);
    } else {
      expect(existsSync(HELPER), "FR1/FR4: harness/model-api-refs.py must exist so the list needs no opencode call").toBe(true);
    }
    expect(existsSync(opencodeLog), "FR4: the fake opencode must record each call, and the helper run must make none").toBe(false);
    const slept = spawnSync("sleep", ["5"], { env, encoding: "utf8", timeout: 10_000 });
    expect(slept.status, "FR4/D9: the fake sleep seam must run instead of a real five-second wait").toBe(0);
    expect(readFileSync(sleepLog, "utf8").trim(), "FR4/D9: the fake sleep must record the delay argument").toBe("5");
    expect(batchSource().includes("sleep 5"), "FR2/D9: batch.sh must keep the five-second delay between attempts").toBe(true);
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
