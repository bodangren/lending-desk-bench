/**
 * The quota sources of task 4.2 (spec D15, FR-15).
 *
 * The tool under test is `harness/model-guide/quota.ts`. That file does not
 * exist at the base of Phase 4, so every case fails for the missing tool.
 * The Green task 4.4 implements the contract below.
 *
 * Pinned command-line interface:
 *   cd harness && npx tsx model-guide/quota.ts \
 *     --provider <quota_provider> [--base <http://127.0.0.1:port>]
 *
 * Contract:
 *   - `--provider` is required and takes the `quota_provider` of one row of
 *     `harness/model-guide/routes.json`.
 *   - The base is `--base`, else `BENCH_QUOTA_BASE`, else the port source.
 *   - The port source runs `openchamber status --json` from `PATH` and reads
 *     `instances[0].port`. An integer from 1 to 65535, or a digit string in
 *     that range, is a port. Any other value gives `stopped`.
 *   - The providers with a quota source of spec D15 read
 *     `GET /api/quota/<id>`:
 *
 *       claude-code            -> claude
 *       kimi-code-plan-cn      -> kimi-for-coding
 *       minimax-cn-coding-plan -> minimax-cn-coding-plan
 *       opencode-go            -> opencode-go
 *
 *   - `nvidia`, `bailian-token-plan`, `volcengine-agent-plan`, and `opencode`
 *     have no quota source. The tool sends no request, gives `ready`, and
 *     gives the cap 1 (one pass per night, spec D15). A provider with a
 *     source gives the cap 3 (N of spec D13).
 *   - stdout holds one JSON line:
 *
 *       {"provider":"...","source":"...","state":"...","cap":N,
 *        "windows":{"5h":V,"day":V,"week":V}}
 *
 *     `state` is `ready`, `wait`, or `stopped`. `ready` means every window is
 *     below 70. `wait` means a window is 70 or more. `windows` holds the
 *     labeled numbers of the answer.
 *   - On `stopped`, stderr holds exactly one line `quota: <reason>`.
 *   - The tool exits 0 for every state. Exit 2 is for a bad flag.
 *   - The read has a timeout of at most 10 s.
 *
 * The "no pass starts" half of the 70 % rule is R5 of
 * `review-run.test.ts`: the runner starts a pass only on `ready`.
 *
 * The test writes its own quota source: a `node:http` server on
 * `127.0.0.1:0` inside the test process (test-strategy 3.4 and 6.2 change
 * 1). It commits no fixture. It reads no credential, no real quota endpoint,
 * and no real home folder, and it never starts `opencode`.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const HARNESS = resolve(import.meta.dirname, "..");

/** The module under test. Its path is fixed, so a gate cannot point the
 * test at a file outside the repository. */
const QUOTA_SOURCE = join(HARNESS, "model-guide", "quota.ts");
const TSX_BIN = join(HARNESS, "node_modules", ".bin", "tsx");

/** The providers of spec D15 with a source, and the id of that source. */
const SOURCED: Array<[provider: string, id: string]> = [
  ["claude-code", "claude"],
  ["kimi-code-plan-cn", "kimi-for-coding"],
  ["minimax-cn-coding-plan", "minimax-cn-coding-plan"],
  ["opencode-go", "opencode-go"],
];

/** The providers of spec D15 with no quota source. */
const UNSOURCED = ["nvidia", "bailian-token-plan", "volcengine-agent-plan", "opencode"];

// --- the PM load watch: this file leaves no server and no child ----------
/** The in-process quota servers this file started. */
const liveQuotaServers = new Set<Server>();
/** The children this file spawned. */
const startedChildren = new Set<ChildProcess>();
/** The exit of each child this file spawned. */
const childExits = new Set<Promise<void>>();
/** The temp folders this file created. */
const tempRoots = new Set<string>();

/** Closes every quota server this file started, without waiting. */
function closeStartedServers(): void {
  for (const server of liveQuotaServers) {
    try {
      server.closeAllConnections();
      server.close();
    } catch {
      // The server is already closed.
    }
  }
  liveQuotaServers.clear();
}

/** Kills every child this file spawned, without waiting. */
function killStartedChildren(): void {
  for (const child of startedChildren) {
    try {
      child.kill("SIGKILL");
    } catch {
      // The child is already gone.
    }
  }
  startedChildren.clear();
}

/** Removes every temp folder this file created and did not remove yet. */
function sweepTempRoots(): void {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
}

/** Stops every server and child, waits for each exit, and removes the
 * temp folders. */
async function stopEverything(): Promise<void> {
  closeStartedServers();
  killStartedChildren();
  await Promise.all([...childExits]);
  childExits.clear();
  sweepTempRoots();
}

process.on("exit", () => {
  closeStartedServers();
  killStartedChildren();
  sweepTempRoots();
});
process.on("SIGINT", () => {
  closeStartedServers();
  killStartedChildren();
  sweepTempRoots();
  process.exit(130);
});
process.on("SIGTERM", () => {
  closeStartedServers();
  killStartedChildren();
  sweepTempRoots();
  process.exit(143);
});

/** The lines of one command of the orphan scan. */
function commandLines(args: string[]): string[] {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 20_000 });
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

afterEach(async () => {
  await stopEverything();
});

/** The load watch of the PM: no server and no child of this run may stay
 * alive after the file. The scan keeps the lines that hold a temp folder
 * of this suite (`mg-`). */
afterAll(async () => {
  await stopEverything();
  const quotaOrphans = commandLines(["pgrep", "-f", "mg-.*quota-server"]);
  const fakeOrphans = commandLines(["bash", "-c", "ps -eo pid,args | grep '[f]ake-opencode'"]);
  const mine = [...quotaOrphans, ...fakeOrphans].filter((line) => line.includes("mg-"));
  expect(mine, "an orphan process of this run stays alive").toEqual([]);
});

/** The result of one run of the tool. */
interface RunResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  elapsed: number;
}

/** The JSON line of the tool. */
interface QuotaDoc {
  provider?: unknown;
  source?: unknown;
  state?: unknown;
  cap?: unknown;
  windows?: Record<string, unknown>;
}

/** One temp tree of a case. Every path of the spawn lives inside it. */
interface Sandbox {
  root: string;
  bin: string;
  env: Record<string, string>;
  close(): void;
}

/** Builds the temp tree and the environment of one case. */
function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "mg-quota-"));
  tempRoots.add(root);
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const bin = join(root, "bin");
  for (const dir of [home, tmp, bin]) mkdirSync(dir, { recursive: true });
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_RUNTIME_DIR: join(home, "run"),
    TMPDIR: tmp,
    TZ: "UTC",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  };
  delete env.BENCH_TRACK;
  delete env.BENCH_QUOTA_BASE;
  delete env.OPENCODE_CONFIG;
  return {
    root,
    bin,
    env,
    close: () => {
      rmSync(root, { recursive: true, force: true });
      tempRoots.delete(root);
    },
  };
}

/** The handler of one answer of the quota source. */
type QuotaHandler = (req: IncomingMessage, res: ServerResponse) => void;

/** The temp quota source of a case. It runs inside the test process. */
interface QuotaServer {
  port: number;
  base: string;
  requests: string[];
  setHandler(handler: QuotaHandler): void;
  close(): Promise<void>;
}

/** Starts a `node:http` server on `127.0.0.1:0`. */
async function startQuotaServer(handler: QuotaHandler): Promise<QuotaServer> {
  const requests: string[] = [];
  let current = handler;
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? "");
    current(req, res);
  });
  await new Promise<void>((done, failed) => {
    const onError = (error: Error): void => failed(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      done();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  // The load watch: the afterEach closes this server when a test stops
  // before its finally block.
  liveQuotaServers.add(server);
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    requests,
    setHandler: (next: QuotaHandler) => {
      current = next;
    },
    close: () => {
      liveQuotaServers.delete(server);
      return new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      });
    },
  };
}

/** An answer with a JSON body and a status code. */
function jsonResponse(body: string, status = 200): QuotaHandler {
  return (_req, res) => {
    res.writeHead(status, { "content-type": "application/json", connection: "close" });
    res.end(body);
  };
}

/** An answer that never ends, for the read timeout of Q5. */
function neverAnswer(): QuotaHandler {
  return () => {};
}

/** The body of a source whose windows all hold one value. */
function windowsBody(value: number): string {
  return JSON.stringify({
    usage: {
      windows: {
        "5h": { usedPercent: value },
        day: { usedPercent: value },
        week: { usedPercent: value },
      },
    },
  });
}

/** Runs the tool. The spawn keeps the event loop free, so the in-process
 * quota source answers while the child runs. */
async function runQuota(
  sandbox: Sandbox,
  args: string[],
  timeoutMs = 15_000,
): Promise<RunResult> {
  expect(existsSync(QUOTA_SOURCE), `the quota tool is missing: ${QUOTA_SOURCE}`).toBe(true);
  const started = Date.now();
  return await new Promise<RunResult>((done) => {
    const child = spawn(TSX_BIN, [QUOTA_SOURCE, ...args], {
      cwd: HARNESS,
      env: sandbox.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // The load watch: the afterEach waits for this exit when a test stops
    // before it awaits the run, and the process handlers kill it.
    startedChildren.add(child);
    childExits.add(
      new Promise<void>((settle) => {
        let closed = false;
        const doneOnce = (): void => {
          if (closed) return;
          closed = true;
          startedChildren.delete(child);
          settle();
        };
        child.once("close", doneOnce);
        child.once("error", doneOnce);
      }),
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (status: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      done({ status, signal, stdout, stderr, elapsed: Date.now() - started });
    };
    const timer = setTimeout(() => {
      stderr += "\nquota-test: the spawn hit its timeout\n";
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      stderr += `${String(error)}\n`;
      finish(null, null);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      finish(status, signal);
    });
  });
}

/** The JSON line of the tool output. */
function quotaDoc(result: RunResult): QuotaDoc {
  const line = result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("{"));
  expect(line, `the tool printed no JSON line:\n${result.stdout}${result.stderr}`).toBeDefined();
  let doc: unknown;
  try {
    doc = JSON.parse(line as string);
  } catch {
    throw new Error(`the JSON line does not parse: ${line}`);
  }
  expect(doc, "the JSON line is not an object").toBeTypeOf("object");
  return doc as QuotaDoc;
}

/** The non-empty stderr lines of a run. */
function stderrLines(result: RunResult): string[] {
  return result.stderr
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/** The state of a run, checked with the shape of the contract. */
function expectState(result: RunResult, state: string, label: string): QuotaDoc {
  expect(result.status, `${label}: ${result.stdout}\n${result.stderr}`).toBe(0);
  const doc = quotaDoc(result);
  expect(doc.state, `${label}: wrong state`).toBe(state);
  return doc;
}

/** The shape of a `stopped` answer: one named line on stderr. */
function expectStopped(result: RunResult, label: string): QuotaDoc {
  const doc = expectState(result, "stopped", label);
  const lines = stderrLines(result);
  expect(lines, `${label}: stderr must hold exactly one line, got ${JSON.stringify(lines)}`).toHaveLength(1);
  expect(lines[0], `${label}: the line must start with "quota:"`).toMatch(/^quota:/);
  return doc;
}

/** A free port with no listener, for the read failure of Q3. */
async function closedPortBase(): Promise<string> {
  const server = await startQuotaServer(neverAnswer());
  const base = server.base;
  await server.close();
  return base;
}

describe("Q1 the source path of each provider", () => {
  it("Q1 reads GET /api/quota/<id> for the four providers of spec D15 and gives ready", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(windowsBody(10)));
    try {
      for (const [provider] of SOURCED) {
        const result = await runQuota(sandbox, ["--provider", provider, "--base", server.base]);
        const doc = expectState(result, "ready", provider);
        expect(doc.cap, `${provider}: the cap of a sourced provider is the N of spec D13`).toBe(3);
        expect(doc.windows?.["5h"], `${provider}: the window value is not labeled`).toBe(10);
      }
      expect(server.requests, "the server got the wrong request paths").toEqual([
        "/api/quota/claude",
        "/api/quota/kimi-for-coding",
        "/api/quota/minimax-cn-coding-plan",
        "/api/quota/opencode-go",
      ]);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q2 the 70 % rule", () => {
  it("Q2 gives ready below 70 and wait at 70, 70.1, and 100, with each window labeled", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(windowsBody(0)));
    try {
      for (const value of [0, 40, 69.9]) {
        server.setHandler(jsonResponse(windowsBody(value)));
        const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
        const doc = expectState(result, "ready", `window ${value}`);
        expect(doc.windows?.["5h"], `window ${value}: the value is not labeled`).toBe(value);
        expect(doc.windows?.["day"], `window ${value}: the day value is not labeled`).toBe(value);
        expect(doc.windows?.["week"], `window ${value}: the week value is not labeled`).toBe(value);
      }
      for (const value of [70, 70.1, 100]) {
        server.setHandler(jsonResponse(windowsBody(value)));
        const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
        const doc = expectState(result, "wait", `window ${value}`);
        expect(doc.windows?.["5h"], `window ${value}: the value is not labeled`).toBe(value);
      }
      expect(server.requests.length, "the tool sent no request").toBe(6);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q3 the stopped cases", () => {
  it("Q3 a 500 answer gives stopped with one named line", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(JSON.stringify({ error: "quota read failed" }), 500));
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(result, "500 answer");
    } finally {
      await server.close();
      sandbox.close();
    }
  });

  it("Q3 a limit error body gives stopped with one named line", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(JSON.stringify({ error: "limit" })));
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(result, "limit error body");
    } finally {
      await server.close();
      sandbox.close();
    }
  });

  it("Q3 a read failure on a closed port gives stopped with one named line", async () => {
    const sandbox = makeSandbox();
    try {
      const base = await closedPortBase();
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", base]);
      expectStopped(result, "closed port");
    } finally {
      sandbox.close();
    }
  });

  it("Q3 a source with no value gives stopped with one named line", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(JSON.stringify({ usage: { windows: {} } })));
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(result, "no value");
    } finally {
      await server.close();
      sandbox.close();
    }
  });

  it("Q3 a window with no usedPercent gives stopped with one named line", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(JSON.stringify({ usage: { windows: { "5h": {} } } })));
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(result, "missing field");
    } finally {
      await server.close();
      sandbox.close();
    }
  });

  it("Q3 a usedPercent that is a string gives stopped with one named line", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(
      jsonResponse(JSON.stringify({ usage: { windows: { "5h": { usedPercent: "50" } } } })),
    );
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(result, "string value");
    } finally {
      await server.close();
      sandbox.close();
    }
  });

  it("Q3 a usedPercent of 1e999 gives stopped with one named line", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(
      jsonResponse('{"usage":{"windows":{"5h":{"usedPercent":1e999}}}}'),
    );
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(result, "1e999 value");
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q4 a provider with no quota source", () => {
  it("Q4 gives ready with cap 1 and sends no request for the four providers with no source", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(windowsBody(10)));
    try {
      for (const provider of UNSOURCED) {
        const result = await runQuota(sandbox, ["--provider", provider, "--base", server.base]);
        const doc = expectState(result, "ready", provider);
        expect(doc.cap, `${provider}: the cap of a provider with no source is 1`).toBe(1);
        expect(doc.source, `${provider}: the source must be null`).toBeNull();
      }
      expect(server.requests, "a provider with no source sent a request").toEqual([]);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q5 the read timeout", () => {
  it("Q5 gives stopped with one named line inside 10 s when the source never answers", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(neverAnswer());
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base], 15_000);
      expectStopped(result, "never answers");
      expect(result.elapsed, "the read did not end inside 10 s").toBeLessThan(10_000);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q6 a large body", () => {
  it("Q6 parses a 2 MiB body with 200 windows and follows the highest window", async () => {
    const sandbox = makeSandbox();
    const windows: Record<string, { usedPercent: number }> = {};
    for (let index = 0; index < 200; index += 1) {
      windows[`w${index}`] = { usedPercent: 10 };
    }
    windows.w199 = { usedPercent: 75 };
    const body = JSON.stringify({
      usage: { windows },
      filler: "x".repeat(2 * 1024 * 1024),
    });
    expect(Buffer.byteLength(body, "utf8"), "the body is not 2 MiB").toBeGreaterThanOrEqual(2 * 1024 * 1024);
    const server = await startQuotaServer(jsonResponse(body));
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      const doc = expectState(result, "wait", "2 MiB body");
      expect(doc.windows?.["w0"], "the first window is not labeled").toBe(10);
      expect(doc.windows?.["w199"], "the highest window is not labeled").toBe(75);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

/** Writes the temp `openchamber` stub of Q7 and Q8. */
function writeOpenchamberStub(sandbox: Sandbox, output: string): void {
  const stub = join(sandbox.bin, "openchamber");
  writeFileSync(stub, '#!/usr/bin/env bash\nprintf "%s\\n" "$MG_TEST_OPENCHAMBER_OUTPUT"\n', {
    mode: 0o755,
  });
  chmodSync(stub, 0o755);
  sandbox.env.MG_TEST_OPENCHAMBER_OUTPUT = output;
}

describe("Q7 the port source", () => {
  it("Q7 reads the port from openchamber status --json when --base is absent", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(windowsBody(10)));
    try {
      writeOpenchamberStub(sandbox, JSON.stringify({ instances: [{ port: server.port }] }));
      const result = await runQuota(sandbox, ["--provider", "opencode-go"]);
      expectState(result, "ready", "port source");
      expect(server.requests, "the tool read no quota on the port of the stub").toEqual([
        "/api/quota/opencode-go",
      ]);
    } finally {
      await server.close();
      sandbox.close();
    }
  });

  it('Q7 gives stopped with one named line for a port of 0, "0", and 70000', async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(windowsBody(10)));
    try {
      for (const output of [
        JSON.stringify({ instances: [{ port: 0 }] }),
        JSON.stringify({ instances: [{ port: "0" }] }),
        JSON.stringify({ instances: [{ port: 70000 }] }),
      ]) {
        writeOpenchamberStub(sandbox, output);
        const result = await runQuota(sandbox, ["--provider", "opencode-go"]);
        expectStopped(result, `port ${output}`);
      }
      expect(server.requests, "a bad port sent a request").toEqual([]);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q8 bad port output", () => {
  it("Q8 gives stopped with one named line and no request for bad port output", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(windowsBody(10)));
    try {
      for (const output of ["", "not json", "[1,2]"]) {
        writeOpenchamberStub(sandbox, output);
        const result = await runQuota(sandbox, ["--provider", "opencode-go"]);
        expectStopped(result, `port output ${JSON.stringify(output)}`);
      }
      expect(server.requests, "bad port output sent a request").toEqual([]);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});
