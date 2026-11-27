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
 *     labeled numbers of the answer. For `opencode-go` the PM order of
  *     2026-11-19 moves the thresholds: `ready` means 5h below 95 % and
  *     week below 100 % (Q9, Q10 of task 4.13g).
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
  ["claude-agent", "claude"],
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
  delete env.BENCH_RA_QUOTA;
  delete env.RA_QUOTA_LASTGOOD;
  delete env.RA_QUOTA_API_PORT;
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

/** The body of the live opencode-go window set (task 4.13i, Review A
 * cc8afbd F1, F2). The live endpoint GET /api/quota/opencode-go names the
 * week window "weekly" and holds "monthly" and a null "credits_balance"
 * beside it. Every opencode-go fake of this file serves this set; the
 * windowsBody fake keeps "day" and "week" for the non-Go sources only. */
function liveGoBody(fiveH: number, weekly: number, monthly: number): string {
  return JSON.stringify({
    usage: {
      windows: {
        "5h": { usedPercent: fiveH },
        weekly: { usedPercent: weekly },
        monthly: { usedPercent: monthly },
        credits_balance: { usedPercent: null },
      },
    },
  });
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

/** An answer after a delay, for the timeout seam of Q5b. */
function delayedResponse(body: string, delayMs: number): QuotaHandler {
  return (_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json", connection: "close" });
      res.end(body);
    }, delayMs);
  };
}

/** The body of a source whose windows all hold one value. Non-Go fakes
 * keep these key names. The opencode-go fakes use liveGoBody (task 4.13i):
 * the live endpoint has no "day" or "week" key. */
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
  it("Q1 reads GET /api/quota/<id> for each sourced provider and gives ready", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(windowsBody(10)));
    try {
      for (const [provider] of SOURCED) {
        // The opencode-go source serves the live window set; the other
        // sources keep the old key names (task 4.13i).
        server.setHandler(
          jsonResponse(provider === "opencode-go" ? liveGoBody(10, 10, 10) : windowsBody(10)),
        );
        const result = await runQuota(sandbox, ["--provider", provider, "--base", server.base]);
        const doc = expectState(result, "ready", provider);
        expect(doc.cap, `${provider}: the cap of a sourced provider is the N of spec D13`).toBe(3);
        expect(doc.windows?.["5h"], `${provider}: the window value is not labeled`).toBe(10);
      }
      expect(server.requests, "the server got the wrong request paths").toEqual([
        "/api/quota/claude",
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

describe("Q2 the 70 % rule of a non-Go source", () => {
  it("Q2 gives ready below 70 and wait at 70, 70.1, and 100 for kimi-code-plan-cn, with each window labeled", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(windowsBody(0)));
    try {
      for (const value of [0, 40, 69.9]) {
        server.setHandler(jsonResponse(windowsBody(value)));
        const result = await runQuota(sandbox, ["--provider", "kimi-code-plan-cn", "--base", server.base]);
        const doc = expectState(result, "ready", `window ${value}`);
        expect(doc.windows?.["5h"], `window ${value}: the value is not labeled`).toBe(value);
        expect(doc.windows?.["day"], `window ${value}: the day value is not labeled`).toBe(value);
        expect(doc.windows?.["week"], `window ${value}: the week value is not labeled`).toBe(value);
      }
      for (const value of [70, 70.1, 100]) {
        server.setHandler(jsonResponse(windowsBody(value)));
        const result = await runQuota(sandbox, ["--provider", "kimi-code-plan-cn", "--base", server.base]);
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

describe("Q9 the Go 5h threshold", () => {
  it("Q9 gives ready for opencode-go at 5h 94 % and wait at 5h 95 %", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(liveGoBody(80, 10, 10)));
    try {
      // A window of 80 % is still ready on a Go route (PM order
      // 2026-11-19: the Go 5h threshold is 95 %, not 70 %).
      for (const fiveH of [80, 94]) {
        server.setHandler(jsonResponse(liveGoBody(fiveH, 10, 10)));
        const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
        const doc = expectState(result, "ready", `5h ${fiveH}`);
        expect(doc.windows?.["5h"], `5h ${fiveH}: the value is not labeled`).toBe(fiveH);
        expect(doc.windows?.["weekly"], `5h ${fiveH}: the weekly value is not labeled`).toBe(10);
      }
      server.setHandler(jsonResponse(liveGoBody(95, 10, 10)));
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      const doc = expectState(result, "wait", "5h 95");
      expect(doc.windows?.["5h"], "5h 95: the value is not labeled").toBe(95);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q10 the Go week threshold", () => {
  it("Q10 gives ready for opencode-go at week 99 % and wait at week 100 %", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(liveGoBody(10, 90, 10)));
    try {
      // A week of 90 % is still ready on a Go route (PM order
      // 2026-11-19: the Go week threshold is 100 %, not 70 %).
      for (const week of [90, 99]) {
        server.setHandler(jsonResponse(liveGoBody(10, week, 10)));
        const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
        const doc = expectState(result, "ready", `week ${week}`);
        expect(doc.windows?.["weekly"], `week ${week}: the weekly value is not labeled`).toBe(week);
        expect(doc.windows?.["5h"], `week ${week}: the 5h value is not labeled`).toBe(10);
      }
      server.setHandler(jsonResponse(liveGoBody(10, 100, 10)));
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      const doc = expectState(result, "wait", "week 100");
      expect(doc.windows?.["weekly"], "week 100: the weekly value is not labeled").toBe(100);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q11 the live Go window set (task 4.13i, Review A cc8afbd F1)", () => {
  it("Q11 gives ready for opencode-go at 5h 50, weekly 97, and monthly 89 with a null credits_balance", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(liveGoBody(50, 97, 89)));
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      const doc = expectState(result, "ready", "live set 50/97/89");
      expect(doc.windows?.["5h"], "live set: the 5h value is not labeled").toBe(50);
      expect(doc.windows?.["weekly"], "live set: the weekly value is not labeled").toBe(97);
      expect(doc.windows?.["monthly"], "live set: the monthly value is not labeled").toBe(89);
    } finally {
      await server.close();
      sandbox.close();
    }
  });

  it("Q11 gives wait for opencode-go at weekly 100 with the live window set", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(liveGoBody(10, 100, 10)));
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      const doc = expectState(result, "wait", "live set weekly 100");
      expect(doc.windows?.["weekly"], "live set weekly 100: the weekly value is not labeled").toBe(100);
    } finally {
      await server.close();
      sandbox.close();
    }
  });

  it("Q11 gives wait for opencode-go at 5h 95 with the live window set", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(liveGoBody(95, 10, 10)));
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      const doc = expectState(result, "wait", "live set 5h 95");
      expect(doc.windows?.["5h"], "live set 5h 95: the 5h value is not labeled").toBe(95);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q12 a null window is skipped (task 4.13i, Review A cc8afbd F2)", () => {
  it("Q12 skips a null window; an answer with no usable window gives stopped (Q15 adds the Go required-window rule)", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(liveGoBody(50, 97, 89)));
    try {
      // A null credits_balance beside usable windows gives ready, not stopped.
      const ready = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectState(ready, "ready", "null beside usable windows");
      // No usable window at all still gives stopped: every window is null.
      server.setHandler(
        jsonResponse(
          JSON.stringify({
            usage: {
              windows: {
                "5h": { usedPercent: null },
                weekly: { usedPercent: null },
              },
            },
          }),
        ),
      );
      const allNull = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(allNull, "every window null");
      // No window at all still gives stopped.
      server.setHandler(jsonResponse(JSON.stringify({ usage: { windows: {} } })));
      const noWindow = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(noWindow, "no window");
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q13 usable 5h and weekly for opencode-go (task 4.13k, Review B e9e7d36 B2)", () => {
  it("Q13 gives stopped for opencode-go when weekly is negative, a string, or null beside a usable 5h", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(
      jsonResponse(
        JSON.stringify({
          usage: {
            windows: {
              "5h": { usedPercent: 50 },
              weekly: { usedPercent: -1 },
              monthly: { usedPercent: 10 },
            },
          },
        }),
      ),
    );
    try {
      // A negative weekly beside a usable 5h is not usable: the Go week
      // threshold cannot be evaluated, so the answer is stopped.
      const negative = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(negative, "negative weekly beside usable 5h");
      // A string weekly beside a usable 5h is not usable either.
      server.setHandler(
        jsonResponse(
          JSON.stringify({
            usage: {
              windows: {
                "5h": { usedPercent: 50 },
                weekly: { usedPercent: "50" },
                monthly: { usedPercent: 10 },
              },
            },
          }),
        ),
      );
      const stringy = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(stringy, "string weekly beside usable 5h");
      // A null weekly beside a usable 5h is not usable either.
      server.setHandler(
        jsonResponse(
          JSON.stringify({
            usage: {
              windows: {
                "5h": { usedPercent: 50 },
                weekly: { usedPercent: null },
                monthly: { usedPercent: 10 },
              },
            },
          }),
        ),
      );
      const nulled = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(nulled, "null weekly beside usable 5h");
    } finally {
      await server.close();
      sandbox.close();
    }
  });

  it("Q13 gives stopped for opencode-go when 5h is unusable beside a usable weekly", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(
      jsonResponse(
        JSON.stringify({
          usage: {
            windows: {
              "5h": { usedPercent: -1 },
              weekly: { usedPercent: 10 },
              monthly: { usedPercent: 10 },
            },
          },
        }),
      ),
    );
    try {
      // A negative 5h beside a usable weekly is not usable.
      const negative = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(negative, "negative 5h beside usable weekly");
      // A string 5h beside a usable weekly is not usable.
      server.setHandler(
        jsonResponse(
          JSON.stringify({
            usage: {
              windows: {
                "5h": { usedPercent: "50" },
                weekly: { usedPercent: 10 },
                monthly: { usedPercent: 10 },
              },
            },
          }),
        ),
      );
      const stringy = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(stringy, "string 5h beside usable weekly");
      // A null 5h beside a usable weekly is not usable.
      server.setHandler(
        jsonResponse(
          JSON.stringify({
            usage: {
              windows: {
                "5h": { usedPercent: null },
                weekly: { usedPercent: 10 },
                monthly: { usedPercent: 10 },
              },
            },
          }),
        ),
      );
      const nulled = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(nulled, "null 5h beside usable weekly");
    } finally {
      await server.close();
      sandbox.close();
    }
  });

  it("Q13 skips an unusable window beside usable windows for kimi-code-plan-cn", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(
      jsonResponse(
        JSON.stringify({
          usage: {
            windows: {
              "5h": { usedPercent: 50 },
              weekly: { usedPercent: 10 },
              credits_balance: { usedPercent: "50" },
            },
          },
        }),
      ),
    );
    try {
      // A string value beside usable windows is skipped on a non-Go source.
      // NaN serializes to null over JSON, so Q12 pins the NaN case.
      const ready = await runQuota(sandbox, ["--provider", "kimi-code-plan-cn", "--base", server.base]);
      expectState(ready, "ready", "string beside usable windows");
      // A negative value beside usable windows is skipped too.
      server.setHandler(
        jsonResponse(
          JSON.stringify({
            usage: {
              windows: {
                "5h": { usedPercent: 50 },
                weekly: { usedPercent: -1 },
                monthly: { usedPercent: 10 },
              },
            },
          }),
        ),
      );
      const negative = await runQuota(sandbox, ["--provider", "kimi-code-plan-cn", "--base", server.base]);
      expectState(negative, "ready", "negative beside usable windows");
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q14 the 70 % rule of a non-Go source with the real key names (task 4.13i)", () => {
  it("Q14 gives ready below 70 and wait at 70 for kimi-code-plan-cn on 5h, weekly, and monthly with a null credits_balance", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(liveGoBody(10, 10, 10)));
    try {
      for (const value of [10, 69.9]) {
        const body = JSON.stringify({
          usage: {
            windows: {
              "5h": { usedPercent: value },
              weekly: { usedPercent: value },
              monthly: { usedPercent: value },
              credits_balance: { usedPercent: null },
            },
          },
        });
        server.setHandler(jsonResponse(body));
        const result = await runQuota(sandbox, [
          "--provider",
          "kimi-code-plan-cn",
          "--base",
          server.base,
        ]);
        const doc = expectState(result, "ready", `real keys window ${value}`);
        expect(doc.windows?.["weekly"], `real keys window ${value}: the weekly value is not labeled`).toBe(
          value,
        );
      }
      for (const value of [70, 100]) {
        server.setHandler(jsonResponse(liveGoBody(value, value, value)));
        const result = await runQuota(sandbox, [
          "--provider",
          "kimi-code-plan-cn",
          "--base",
          server.base,
        ]);
        const doc = expectState(result, "wait", `real keys window ${value}`);
        expect(doc.windows?.["5h"], `real keys window ${value}: the 5h value is not labeled`).toBe(value);
      }
      expect(server.requests.length, "the tool sent no request").toBe(4);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});

describe("Q15 the required Go windows (task 4.13i, Review B cc8afbd B2)", () => {
  it("Q15 gives stopped for opencode-go when 5h or weekly is absent, even beside a usable window", async () => {
    const sandbox = makeSandbox();
    const server = await startQuotaServer(
      jsonResponse(JSON.stringify({ usage: { windows: { "5h": { usedPercent: 10 } } } })),
    );
    try {
      // Spec D15: a missing field is stopped. Both 5h and weekly must be
      // finite numbers on a Go route; a usable 5h alone is not enough.
      const noWeekly = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(noWeekly, "5h with no weekly");
      server.setHandler(
        jsonResponse(JSON.stringify({ usage: { windows: { weekly: { usedPercent: 10 } } } })),
      );
      const noFiveH = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(noFiveH, "weekly with no 5h");
      // The old fake key "day" is not a required window: day alone stops.
      server.setHandler(
        jsonResponse(JSON.stringify({ usage: { windows: { day: { usedPercent: 10 } } } })),
      );
      const dayOnly = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(dayOnly, "day only");
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

  it("N32 a loopback error reason never reaches the quota reason line (Review B c0a26d7 N32)", async () => {
    // The quota reason is not a credential edge. A provider's loopback answer
    // can carry an `error` string. The tool must print a fixed text from a
    // closed list, never that string (test strategy section 14.5, N32).
    // Falsification: print the raw reason; this case must fail.
    const RAW = "mg-n32-raw-quota-reason-0123456789";
    const sandbox = makeSandbox();
    const server = await startQuotaServer(jsonResponse(JSON.stringify({ error: RAW })));
    try {
      const result = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      expectStopped(result, "N32 raw reason");
      const lines = stderrLines(result);
      expect(lines[0], "the raw quota reason reached stderr").not.toContain(RAW);
      expect(lines[0], "the fixed quota reason text is missing").toContain(
        "the quota source reported an error",
      );
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

describe("Q5b the quota read timeout seam", () => {
  it("Q5b BENCH_QUOTA_TIMEOUT_MS=8000 lets a 2 s answer give ready, and the unset env times out a 6 s answer", async () => {
    const raised = makeSandbox();
    raised.env.BENCH_QUOTA_TIMEOUT_MS = "8000";
    const slow = await startQuotaServer(delayedResponse(windowsBody(50), 2_000));
    try {
      const result = await runQuota(raised, ["--provider", "kimi-code-plan-cn", "--base", slow.base]);
      expectState(result, "ready", "an 8 s bound lets the 2 s answer through");
      expect(quotaDoc(result).source, "the source is named").toBe("kimi-for-coding");
    } finally {
      await slow.close();
      raised.close();
    }

    const plain = makeSandbox();
    delete plain.env.BENCH_QUOTA_TIMEOUT_MS;
    const later = await startQuotaServer(delayedResponse(windowsBody(50), 6_000));
    try {
      const result = await runQuota(plain, ["--provider", "kimi-code-plan-cn", "--base", later.base]);
      expectStopped(result, "the default 5 s bound times out the 6 s answer");
      expect(stderrLines(result)[0], "the named line").toBe("quota: the quota read timed out");
    } finally {
      await later.close();
      plain.close();
    }

    const bad = makeSandbox();
    bad.env.BENCH_QUOTA_TIMEOUT_MS = "abc";
    const never = await startQuotaServer(neverAnswer());
    try {
      const result = await runQuota(bad, ["--provider", "kimi-code-plan-cn", "--base", never.base]);
      expectStopped(result, "an invalid value keeps the 5 s default");
      expect(stderrLines(result)[0], "the named line").toBe("quota: the quota read timed out");
    } finally {
      await never.close();
      bad.close();
    }
  }, 90_000);
});

describe("Q6 a large body on a non-Go source", () => {
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
      const result = await runQuota(sandbox, ["--provider", "kimi-code-plan-cn", "--base", server.base]);
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
    const server = await startQuotaServer(jsonResponse(liveGoBody(10, 10, 10)));
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

describe("Q16 the Go quota through ra-quota (task 4.13q point 8, PM order 2026-11-19)", () => {
  /** The fake `ra-quota` double of a case. It attempts the hanging API
   * with a short timeout, then falls back to the last-good file at
   * `$RA_QUOTA_LASTGOOD`: a fresh reading (< 6 h) prints the opencode-go
   * entry with those windows, a stale or missing reading prints `{}`. */
  const FAKE_RA_QUOTA_SOURCE = `#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const SIX_H = 6 * 3600;
function fetchApi(port) {
  return new Promise((done) => {
    const req = http.get(
      \`http://127.0.0.1:\${port}/api/quota/opencode-go\`,
      { timeout: 1500 },
      (res) => {
        res.resume();
        res.on("end", () => done(true));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      done(false);
    });
    req.on("error", () => done(false));
  });
}
async function main() {
  const port = Number(process.env.RA_QUOTA_API_PORT || "0");
  await fetchApi(port);
  let entry = null;
  try {
    const doc = JSON.parse(fs.readFileSync(process.env.RA_QUOTA_LASTGOOD || "", "utf8"));
    if (doc && typeof doc.fetchedAt === "number" && doc.windows && typeof doc.windows === "object") {
      entry = doc;
    }
  } catch {
    entry = null;
  }
  const nowSec = Date.now() / 1000;
  if (entry && nowSec - entry.fetchedAt < SIX_H && Object.keys(entry.windows).length > 0) {
    const label = new Date(entry.fetchedAt * 1000).toISOString();
    process.stdout.write(
      JSON.stringify({
        "opencode-go": {
          state: "GO",
          windows: entry.windows,
          reason: \`last good reading \${label} (fetch failed: timeout)\`,
        },
      }) + "\\n",
    );
  } else {
    process.stdout.write("{}\\n");
  }
}
void main();
`;

  /** Writes the last-good file of a case: the fetched epoch seconds and
   * the window percents in the ra-quota windows shape. */
  function writeLastgood(path: string, fetchedAtSec: number, windows: Record<string, number>): void {
    const shaped: Record<string, { percent: number }> = {};
    for (const [name, percent] of Object.entries(windows)) shaped[name] = { percent };
    writeFileSync(path, `${JSON.stringify({ fetchedAt: fetchedAtSec, windows: shaped })}\n`);
  }

  /** Points the sandbox at the fake ra-quota double and its last-good. */
  function pointAtFakeRaQuota(
    sandbox: Sandbox,
    api: QuotaServer,
    lastgoodPath: string,
  ): string {
    const fakePath = join(sandbox.bin, "ra-quota");
    writeFileSync(fakePath, FAKE_RA_QUOTA_SOURCE, { mode: 0o755 });
    chmodSync(fakePath, 0o755);
    sandbox.env.BENCH_RA_QUOTA = fakePath;
    sandbox.env.RA_QUOTA_LASTGOOD = lastgoodPath;
    sandbox.env.RA_QUOTA_API_PORT = String(api.port);
    return fakePath;
  }

  it("Q16a a fetch timeout with a fresh last-good reading gives the state of that reading", async () => {
    const sandbox = makeSandbox();
    const api = await startQuotaServer(neverAnswer());
    try {
      const lastgoodPath = join(sandbox.root, "lastgood.json");
      writeLastgood(lastgoodPath, Date.now() / 1000 - 3600, { "5h": 50, weekly: 40 });
      pointAtFakeRaQuota(sandbox, api, lastgoodPath);
      const result = await runQuota(sandbox, ["--provider", "opencode-go"]);
      expect(api.requests, "the fake ra-quota never attempted the hanging API").toEqual([
        "/api/quota/opencode-go",
      ]);
      const doc = expectState(result, "ready", "fresh last-good 5h 50, weekly 40");
      expect(doc.cap, "the cap of the Go provider is the N of spec D13").toBe(3);
      expect(doc.windows?.["5h"], "the 5h value is not labeled").toBe(50);
      expect(doc.windows?.["weekly"], "the weekly value is not labeled").toBe(40);
    } finally {
      await api.close();
      sandbox.close();
    }
  });

  it("Q16b a fetch timeout with a fresh last-good reading at 5h 96 gives wait", async () => {
    const sandbox = makeSandbox();
    const api = await startQuotaServer(neverAnswer());
    try {
      const lastgoodPath = join(sandbox.root, "lastgood.json");
      writeLastgood(lastgoodPath, Date.now() / 1000 - 60, { "5h": 96, weekly: 40 });
      pointAtFakeRaQuota(sandbox, api, lastgoodPath);
      const result = await runQuota(sandbox, ["--provider", "opencode-go"]);
      expect(api.requests, "the fake ra-quota never attempted the hanging API").toEqual([
        "/api/quota/opencode-go",
      ]);
      const doc = expectState(result, "wait", "fresh last-good 5h 96");
      expect(doc.windows?.["5h"], "the 5h value is not labeled").toBe(96);
      expect(doc.windows?.["weekly"], "the weekly value is not labeled").toBe(40);
    } finally {
      await api.close();
      sandbox.close();
    }
  });

  it("Q16c a stale last-good reading gives stopped naming the stale reading", async () => {
    const sandbox = makeSandbox();
    const api = await startQuotaServer(neverAnswer());
    try {
      const lastgoodPath = join(sandbox.root, "lastgood.json");
      writeLastgood(lastgoodPath, Date.now() / 1000 - 7 * 3600, { "5h": 10, weekly: 10 });
      pointAtFakeRaQuota(sandbox, api, lastgoodPath);
      const result = await runQuota(sandbox, ["--provider", "opencode-go"]);
      expect(api.requests, "the fake ra-quota never attempted the hanging API").toEqual([
        "/api/quota/opencode-go",
      ]);
      expectStopped(result, "stale last-good");
      expect(result.stderr, "the stop must name the stale reading").toMatch(/stale/i);
    } finally {
      await api.close();
      sandbox.close();
    }
  });

  it("Q16d a missing last-good reading gives stopped naming the missing reading", async () => {
    const sandbox = makeSandbox();
    const api = await startQuotaServer(neverAnswer());
    try {
      const lastgoodPath = join(sandbox.root, "lastgood-missing.json");
      pointAtFakeRaQuota(sandbox, api, lastgoodPath);
      const result = await runQuota(sandbox, ["--provider", "opencode-go"]);
      expect(api.requests, "the fake ra-quota never attempted the hanging API").toEqual([
        "/api/quota/opencode-go",
      ]);
      expectStopped(result, "missing last-good");
      expect(result.stderr, "the stop must name the missing reading").toMatch(/last-?good|missing/i);
    } finally {
      await api.close();
      sandbox.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Row 4.16 L9 (quota part): the quota rules are unchanged by the live-server
// path. BENCH_SERVER_BASE carries the session address and BENCH_QUOTA_BASE
// carries the quota address. This is a GUARD. It passes at the role base,
// because quota.ts already reads only BENCH_QUOTA_BASE. Its proof is the
// falsification below: change the Go 5h boundary in quota.ts and the case
// fails. The review-run L9 case is the Red case of this group; it fails at the
// base because no live session is created.
// ---------------------------------------------------------------------------
describe("4.16 L9 guard the quota rules stay off the live-server seam", () => {
  it("L9-G a pilot opencode-go route reads quota at 94 ready and 95 wait while BENCH_SERVER_BASE is set", async () => {
    const sandbox = makeSandbox();
    sandbox.env.BENCH_SERVER_BASE = "http://127.0.0.1:1";
    const server = await startQuotaServer(jsonResponse(liveGoBody(94, 10, 10)));
    try {
      const ready = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      const readyDoc = expectState(ready, "ready", "L9-G 5h 94 with a server seam set");
      expect(readyDoc.windows?.["5h"], "L9-G 5h is not labeled").toBe(94);
      server.setHandler(jsonResponse(liveGoBody(95, 10, 10)));
      const waited = await runQuota(sandbox, ["--provider", "opencode-go", "--base", server.base]);
      const waitDoc = expectState(waited, "wait", "L9-G 5h 95 with a server seam set");
      expect(waitDoc.windows?.["5h"], "L9-G 5h is not labeled").toBe(95);
      expect(server.requests.length, "L9-G read no quota through BENCH_QUOTA_BASE").toBeGreaterThan(0);
    } finally {
      await server.close();
      sandbox.close();
    }
  });
});
