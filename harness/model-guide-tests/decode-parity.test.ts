import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

/**
 * Parity of the three raw-output readers (task 4.13w, Review A
 * nonblocking 2).
 *
 * The same real event stream of `opencode run --format json` must give the
 * same decoded answer text in `review-score.ts`, `adjudicate.ts`, and
 * `judge-run.sh`: one `text` event per text block (possibly split over
 * several events), step and tool events mixed in, and one `step_finish`
 * event whose `part.tokens` holds the nested bundle object. The old AJ1
 * `result` event shape stays supported, but the pins below drive the real
 * shape only. Each reader is called through its public path (`score`,
 * `queue`, and the judge run); no decoder is imported, because Green keeps
 * no shared module (the committed adversarial fixture copies only
 * `judge-run.sh` and `quota.ts` into its temp repo).
 *
 * The stream carries the same framing for every tool: the fenced answer
 * split over two `text` events at a line boundary, a `step-start` and a
 * `tool` event mixed in, and one `step_finish` token event. The payload is
 * the findings list for the scorer and the queue, and the verdict map for
 * the judge runner. The verdict map of the judge run is the verdict map of
 * the scorer runs, so the three tools settle the same two claims.
 *
 * P1 and P2 are guards: they pass at the Red base because the 4.13t and
 * 4.13v decoders already join the real `text` events. P3 fails at the Red
 * base: the verdicts read fine, but the run record holds zero real tokens
 * with `tokens_complete` false, because `read_tokens` matches the fake
 * `step-finish` shape instead of the real `step_finish` event.
 *
 * The test uses no network, no model, no real home folder, and no real
 * `opencode`. The only sockets are the loopback quota servers of the judge
 * runs, and the only binary the spawns can reach is the fake `opencode`.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const SCORE_SOURCE = join(HARNESS, "model-guide", "review-score.ts");
const ADJ_SOURCE = join(HARNESS, "model-guide", "adjudicate.ts");
const RUNNER_SOURCE = join(HARNESS, "model-guide", "judge-run.sh");
const HOST_SOURCE = join(HARNESS, "opencode-host.sh");
const QUOTA_SOURCE = join(HARNESS, "model-guide", "quota.ts");
const FAKE_SOURCE = join(HARNESS, "model-guide-tests", "fixtures", "fakes", "fake-opencode");
const FIXTURE_SET = join(import.meta.dirname, "fixtures", "review", "sets", "mg-2026-11a");
const SET = "mg-2026-11a";
const TSX_BIN = join(HARNESS, "node_modules", ".bin", "tsx");
const EMPTY = "```json\n{\"findings\": []}\n```\n";
const DIFF_IDS = [
  "forge-01", "forge-02", "forge-03", "forge-04", "forge-05", "forge-06", "forge-c1",
  "mono-01", "mono-02", "mono-03", "mono-04", "mono-05", "mono-06", "mono-c1",
];

interface Finding {
  file: string;
  line: number;
  severity: string;
  class: string;
  title: string;
  reason: string;
}

const F1: Finding = {
  file: "src/forge-01.ts", line: 60, severity: "major", class: "C2",
  title: "First parity claim", reason: "the call returns success",
};
const F2: Finding = {
  file: "src/forge-01.ts", line: 61, severity: "major", class: "C2",
  title: "Second parity claim", reason: "the value is stale",
};

/** The route-blind claim id of a finding (spec D11, ruling P3A1-1). */
function claimId(diffId: string, finding: Finding): string {
  const canonical = JSON.stringify([
    diffId, finding.file, finding.line, finding.class,
    finding.severity, finding.title, finding.reason,
  ]);
  return `${diffId}#C${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
}

const ID1 = claimId("forge-01", F1);
const ID2 = claimId("forge-01", F2);

/** The verdict map that the judge run must produce and that the scorer
 * consumes, so the three tools settle the same two claims. */
const EXPECTED_VERDICTS: Record<string, string> = {
  [ID1]: "real-defect",
  [ID2]: "false-claim",
};

/** The nested token shape of the installed bundle (Review A 2fdb8f8):
 * `part.tokens` of a `step_finish` event. */
const REAL_TOKENS = { input: 7, output: 8, reasoning: 9, cache: { read: 10, write: 11 } };
const FLAT_REAL = {
  input: 7, output: 8, reasoning: 9, cache_read: 10, cache_write: 11, total: 45,
};

function fenced(findings: Finding[]): string {
  return "```json\n" + JSON.stringify({ findings }, null, 2) + "\n```\n";
}

/** One `--format json` text event in the real opencode shape. */
function textEvent(text: string, index: number): string {
  return JSON.stringify({
    type: "text",
    timestamp: 1795048839000 + index,
    sessionID: "ses_4_13w",
    part: { type: "text", text },
  });
}

/** The same framing for every tool: the fenced answer split over two
 * `text` events at a line boundary, with step, tool, and token events
 * mixed in. */
function sharedStream(answerText: string): string {
  const lines = answerText.split("\n");
  const half = Math.ceil(lines.length / 2);
  return (
    [
      JSON.stringify({ type: "step-start", timestamp: 1, sessionID: "ses_4_13w", part: { type: "step-start" } }),
      textEvent(lines.slice(0, half).join("\n"), 0),
      JSON.stringify({ type: "tool", timestamp: 2, sessionID: "ses_4_13w", part: { type: "tool", state: { status: "running" } } }),
      textEvent(lines.slice(half).join("\n"), 1),
      JSON.stringify({
        type: "step_finish",
        timestamp: 3,
        sessionID: "ses_4_13w",
        part: { type: "step-finish", timestamp: 3, tokens: REAL_TOKENS },
      }),
    ].join("\n") + "\n"
  );
}

// --- the PM load watch: this file leaves no server and no temp folder ----
const startedServers = new Set<ChildProcess>();
const serverExits = new Set<Promise<void>>();
const tempRoots = new Set<string>();

function killStartedServers(): void {
  for (const server of startedServers) {
    try {
      server.kill("SIGKILL");
    } catch {
      // The server is already gone.
    }
  }
  startedServers.clear();
}

function sweepTempRoots(): void {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
}

async function stopStartedServers(): Promise<void> {
  killStartedServers();
  await Promise.all([...serverExits]);
  serverExits.clear();
  sweepTempRoots();
}

process.on("exit", () => {
  killStartedServers();
  sweepTempRoots();
});
process.on("SIGINT", () => {
  killStartedServers();
  sweepTempRoots();
  process.exit(130);
});
process.on("SIGTERM", () => {
  killStartedServers();
  sweepTempRoots();
  process.exit(143);
});

afterEach(async () => {
  await stopStartedServers();
});

function commandLines(args: string[]): string[] {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 20_000 });
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The load watch of the PM: no server and no fake child of this run may
 * stay alive after the file. */
afterAll(async () => {
  await stopStartedServers();
  const quotaOrphans = commandLines(["pgrep", "-f", "mg-.*quota-server"]);
  const fakeOrphans = commandLines(["bash", "-c", "ps -eo pid,args | grep '[f]ake-opencode'"]);
  const mine = [...quotaOrphans, ...fakeOrphans].filter((line) => line.includes("mg-parity"));
  expect(mine, "an orphan process of this run stays alive").toEqual([]);
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `mg-parity-${tag}-`));
  tempRoots.add(dir);
  return dir;
}

function env(fakeHome: string): NodeJS.ProcessEnv {
  const copy: Record<string, string | undefined> = {
    ...process.env,
    HOME: fakeHome,
    TZ: "UTC",
    NO_COLOR: "1",
    npm_config_loglevel: "silent",
  };
  delete copy.BENCH_TRACK;
  return copy as NodeJS.ProcessEnv;
}

function copyIfPresent(source: string, target: string, mode?: number): void {
  if (!existsSync(source)) return;
  writeFileSync(target, readFileSync(source));
  if (mode !== undefined) chmodSync(target, mode);
}

// --- the scorer through its public path ----------------------------------
function scoreOutputs(tag: string, forgeText: string): string {
  const dir = tempDir(`outputs-${tag}`);
  for (const diffId of DIFF_IDS) {
    writeFileSync(join(dir, `${diffId}.txt`), diffId === "forge-01" ? forgeText : EMPTY);
  }
  return dir;
}

function scorePrivate(tag: string): string {
  const root = tempDir(`private-${tag}`);
  mkdirSync(join(root, "sets"), { recursive: true });
  cpSync(FIXTURE_SET, join(root, "sets", SET), { recursive: true });
  return root;
}

function scorePass(tag: string, forgeText: string): any {
  if (!existsSync(SCORE_SOURCE)) {
    throw new Error(`production file is missing: ${SCORE_SOURCE}`);
  }
  const scoresDir = tempDir(`scores-${tag}`);
  const outputsDir = scoreOutputs(tag, forgeText);
  const verdictsFile = join(tempDir(`verdicts-${tag}`), "verdicts.json");
  writeFileSync(verdictsFile, JSON.stringify(EXPECTED_VERDICTS));
  const result = spawnSync(
    join(HARNESS, "node_modules", ".bin", "tsx"),
    [
      "model-guide/review-score.ts", "score",
      "--private", scorePrivate(tag),
      "--set", SET,
      "--route", "parity/route",
      "--pass", "1",
      "--date", "2026-11-20",
      "--outputs", outputsDir,
      "--scores", scoresDir,
      "--verdicts", verdictsFile,
    ],
    { cwd: HARNESS, env: env(tempDir(`home-score-${tag}`)), encoding: "utf8", timeout: 60_000 },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const doc = JSON.parse(readFileSync(join(scoresDir, `${SET}.json`), "utf8"));
  return doc.passes.find((entry: any) => entry.route === "parity/route" && entry.pass === 1);
}

// --- the queue through its public path -----------------------------------
function queuePrivate(tag: string): string {
  const root = tempDir(`qprivate-${tag}`);
  mkdirSync(join(root, "sets"), { recursive: true });
  cpSync(FIXTURE_SET, join(root, "sets", SET), { recursive: true });
  return root;
}

function queueRaw(tag: string, forgeText: string): string {
  const dir = tempDir(`raw-${tag}`);
  mkdirSync(join(dir, "route"), { recursive: true });
  for (const diffId of DIFF_IDS) {
    writeFileSync(join(dir, "route", `${diffId}.txt`), diffId === "forge-01" ? forgeText : EMPTY);
  }
  return dir;
}

function queuedIds(tag: string, forgeText: string): string[] {
  if (!existsSync(ADJ_SOURCE)) {
    throw new Error(`production file is missing: ${ADJ_SOURCE}`);
  }
  const privateDir = queuePrivate(tag);
  const rawDir = queueRaw(tag, forgeText);
  const result = spawnSync(
    join(HARNESS, "node_modules", ".bin", "tsx"),
    ["model-guide/adjudicate.ts", "queue", SET, "--private", privateDir, "--raw", rawDir],
    { cwd: HARNESS, env: env(tempDir(`home-queue-${tag}`)), encoding: "utf8", timeout: 60_000 },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const doc = JSON.parse(
    readFileSync(join(privateDir, "sets", SET, "adjudication", "queue.json"), "utf8"),
  );
  return doc.groups.flatMap((group: any) => group.items.map((item: any) => item.id)).sort();
}

// --- the judge runner through its public path -----------------------------
const CREDENTIAL_STUB = `#!/usr/bin/env bash
set -uo pipefail
case "\${1:-}" in
  seed) exit 0 ;;
  scan-values) printf '%s\\n' "\${MG_TEST_SECRET_VALUE:-}"; exit 0 ;;
  *) echo "provider-credential: unknown mode" >&2; exit 2 ;;
esac
`;

const QUOTA_SERVER_SOURCE = `const http = require("node:http");
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json", connection: "close" });
  res.end(JSON.stringify({ usage: { windows: {
    "5h": { usedPercent: 10 },
    weekly: { usedPercent: 10 },
    monthly: { usedPercent: 10 },
    credits_balance: { usedPercent: null },
  } } }));
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("PORT " + server.address().port + "\\n");
});
`;

interface JudgeFixture {
  repo: string;
  privateDir: string;
  home: string;
  tmp: string;
  logPath: string;
  specPath: string;
  fakePath: string;
  fakeDir: string;
  quotaBase: string;
  setId: string;
  route: string;
  runCounter: number;
  close: () => void;
}

async function buildJudgeFixture(answerText: string): Promise<JudgeFixture> {
  const root = tempDir("judge");
  const fakeRoot = tempDir("fake");
  const repo = join(root, "repo");
  const privateDir = join(root, "private");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  const guideDir = join(repo, "harness", "model-guide");
  const binDir = join(repo, "bin");
  const fakeDir = join(binDir, "fake-opencode.d");
  const fakePath = join(binDir, "fake-opencode");
  const logPath = join(fakeRoot, "opencode.log");
  const specPath = join(fakeRoot, "opencode-spec.json");
  const pidPath = join(fakeRoot, "opencode-pids.txt");
  const daemonPath = join(fakeRoot, "opencode-daemons.txt");

  for (const dir of [guideDir, binDir, fakeDir, home, tmp, privateDir]) {
    mkdirSync(dir, { recursive: true });
  }
  copyIfPresent(RUNNER_SOURCE, join(guideDir, "judge-run.sh"), 0o755);
  copyIfPresent(QUOTA_SOURCE, join(guideDir, "quota.ts"));
  copyIfPresent(HOST_SOURCE, join(repo, "harness", "opencode-host.sh"), 0o755);
  writeFileSync(join(guideDir, "provider-credential.sh"), CREDENTIAL_STUB, { mode: 0o755 });
  writeFileSync(fakePath, readFileSync(FAKE_SOURCE), { mode: 0o755 });
  writeFileSync(join(fakeDir, "opencode"), readFileSync(FAKE_SOURCE), { mode: 0o755 });
  if (existsSync(TSX_BIN)) {
    mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
    symlinkSync(TSX_BIN, join(repo, "node_modules", ".bin", "tsx"));
  }

  const route = "kimi-code-plan-cn/parity-model#high";
  writeFileSync(
    join(guideDir, "judges.json"),
    `${JSON.stringify([{ route, quota_provider: "kimi-code-plan-cn", quota_source: "kimi-for-coding" }], null, 2)}\n`,
  );

  const setId = "parity-set";
  const setDir = join(privateDir, "sets", setId);
  mkdirSync(join(setDir, "diffs"), { recursive: true });
  mkdirSync(join(setDir, "adjudication"), { recursive: true });
  writeFileSync(
    join(setDir, "diffs", "forge-01.diff"),
    "--- a/src/forge-01.ts\n+++ b/src/forge-01.ts\n@@ -1,3 +1,3 @@\n context\n-old\n+new\n context\n",
  );
  writeFileSync(
    join(setDir, "adjudication", "queue.json"),
    `${JSON.stringify(
      {
        set_id: setId,
        groups: [
          {
            id: "forge-01#G1",
            diff_id: "forge-01",
            file: "src/forge-01.ts",
            window: [59, 61],
            items: [
              {
                id: ID1, line: 60,
                claim: { class: "C2", severity: "major", title: F1.title, reason: F1.reason },
              },
              {
                id: ID2, line: 61,
                claim: { class: "C2", severity: "major", title: F2.title, reason: F2.reason },
              },
            ],
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const streamLines = answerText.split("\n");
  const half = Math.ceil(streamLines.length / 2);
  writeFileSync(
    specPath,
    `${JSON.stringify(
      {
        calls: [
          {
            token_stream: {
              texts: [
                streamLines.slice(0, half).join("\n"),
                streamLines.slice(half).join("\n"),
              ],
              tokens: REAL_TOKENS,
            },
          },
        ],
        auth_export: "[]",
        auth_export_exit: 0,
        auth_import_exit: 0,
      },
      null,
      2,
    )}\n`,
  );

  const serverPath = join(fakeRoot, "quota-server.js");
  writeFileSync(serverPath, QUOTA_SERVER_SOURCE);
  const server = spawn(process.execPath, [serverPath], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  startedServers.add(server);
  serverExits.add(
    new Promise<void>((done) => {
      server.once("close", () => done());
    }),
  );
  const port = await new Promise<number>((done, failed) => {
    let buffer = "";
    const timer = setTimeout(() => failed(new Error("the quota server did not start")), 10_000);
    server.stdout.on("data", (chunk: Buffer) => {
      buffer += String(chunk);
      const match = /PORT (\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        done(Number(match[1]));
      }
    });
    server.on("error", (error) => {
      clearTimeout(timer);
      failed(error);
    });
  });

  return {
    repo,
    privateDir,
    home,
    tmp,
    logPath,
    specPath,
    fakePath,
    fakeDir,
    quotaBase: `http://127.0.0.1:${port}`,
    setId,
    route,
    runCounter: 0,
    close: () => {
      server.kill("SIGKILL");
    },
  };
}

function dropJudgeFixture(fixture: JudgeFixture): void {
  fixture.close();
}

function judgeEnv(fixture: JudgeFixture): NodeJS.ProcessEnv {
  const extra: Record<string, string> = {
    HOME: fixture.home,
    XDG_CONFIG_HOME: join(fixture.home, ".config"),
    XDG_DATA_HOME: join(fixture.home, ".local", "share"),
    XDG_STATE_HOME: join(fixture.home, ".local", "state"),
    XDG_CACHE_HOME: join(fixture.home, ".cache"),
    XDG_RUNTIME_DIR: join(fixture.home, "run"),
    TMPDIR: fixture.tmp,
    TZ: "UTC",
    PATH: `${fixture.fakeDir}:${join(HARNESS, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
    BENCH_OPENCODE_BIN: fixture.fakePath,
    FAKE_OPENCODE_SPEC: fixture.specPath,
    FAKE_OPENCODE_LOG: fixture.logPath,
    FAKE_OPENCODE_PID_FILE: join(fixture.tmp, "opencode-pids.txt"),
    FAKE_OPENCODE_DAEMON_FILE: join(fixture.tmp, "opencode-daemons.txt"),
    BENCH_QUOTA_BASE: fixture.quotaBase,
    MG_TEST_SECRET_VALUE: "sk-test-parity-value-0123456789",
    MG_CALL_TIMEOUT_S: "600",
    MG_RUN_RETRY_WAIT_MS: "0",
  };
  const out: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete out.BENCH_TRACK;
  delete out.OPENCODE_CONFIG;
  return out;
}

function runJudge(fixture: JudgeFixture): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const stdoutPath = join(fixture.tmp, `run-${process.pid}-${fixture.runCounter}.out`);
  const stderrPath = join(fixture.tmp, `run-${process.pid}-${fixture.runCounter}.err`);
  fixture.runCounter += 1;
  const outFd = openSync(stdoutPath, "w");
  const errFd = openSync(stderrPath, "w");
  let result;
  try {
    result = spawnSync(
      "bash",
      [
        join(fixture.repo, "harness", "model-guide", "judge-run.sh"),
        "--set", fixture.setId,
        "--route", fixture.route,
        "--judge", "a",
        "--private", fixture.privateDir,
      ],
      {
        cwd: fixture.repo,
        env: judgeEnv(fixture),
        encoding: "utf8",
        timeout: 60_000,
        stdio: ["ignore", outFd, errFd],
      },
    );
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  return {
    status: result.status,
    stdout: readFileSync(stdoutPath, "utf8"),
    stderr: readFileSync(stderrPath, "utf8"),
  };
}

function judgeFile(fixture: JudgeFixture): Record<string, string> | null {
  const path = join(fixture.privateDir, "sets", fixture.setId, "adjudication", "judge-a.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function judgeRunRecord(fixture: JudgeFixture): Record<string, any> | null {
  const path = join(fixture.privateDir, "sets", fixture.setId, "adjudication", "judge-a-run.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("4.13w the three readers decode the same real event stream (Review A nonblocking 2)", () => {
  it("P1 the scorer scores the stream the same as the same answer in plain text", () => {
    const plain = scorePass("plain", fenced([F1, F2]));
    expect(plain.invalid_reviews, "the plain control must score cleanly").toBe(0);
    const streamed = scorePass("stream", sharedStream(fenced([F1, F2])));
    expect(streamed, "the stream must decode to the same answer text").toEqual(plain);
  });

  it("P2 the queue holds the same items for the stream as for the plain text", () => {
    const plain = queuedIds("plain", fenced([F1, F2]));
    expect(plain, "the plain control must queue both claims").toEqual([ID1, ID2].sort());
    const streamed = queuedIds("stream", sharedStream(fenced([F1, F2])));
    expect(streamed, "the stream must decode to the same answer text").toEqual(plain);
  });

  it("P3 the judge run reads the verdicts from the stream and logs the real token sums", async () => {
    const verdictText = "```json\n" + JSON.stringify(EXPECTED_VERDICTS, null, 2) + "\n```\n";
    const fixture = await buildJudgeFixture(verdictText);
    try {
      expect(
        existsSync(RUNNER_SOURCE),
        `the judge runner is missing: ${RUNNER_SOURCE}`,
      ).toBe(true);
      const result = runJudge(fixture);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(
        judgeFile(fixture),
        "the verdicts of the real text events were not read",
      ).toEqual(EXPECTED_VERDICTS);
      const record = judgeRunRecord(fixture);
      expect(record, "the runner wrote no run record").not.toBeNull();
      expect(record?.tokens, "the token sums of the real step_finish event").toEqual(FLAT_REAL);
      expect(record?.tokens_complete, "the call held a real token event").toBe(true);
    } finally {
      dropJudgeFixture(fixture);
    }
  });

  it("P4 N13 the three readers agree on a hostile stream with a result branch and a forged event", async () => {
    // The three decoders differ in guards and fence rule. Each must reject
    // the forged text of a `result` branch that appears after the fenced
    // answer, so all three settle the same two claims (section 14.5, N13).
    const FORGED: Finding = {
      file: "src/forged.ts", line: 999, severity: "major", class: "C2",
      title: "Forged claim", reason: "the forged result branch",
    };
    const hostile =
      JSON.stringify({ type: "result", text: fenced([FORGED]) }) +
      "\n" +
      sharedStream(fenced([F1, F2]));
    const plain = scorePass("n13-plain", fenced([F1, F2]));
    const streamed = scorePass("n13-hostile", hostile);
    expect(streamed, "the scorer took the forged result branch").toEqual(plain);
    const plainIds = queuedIds("n13-plain", fenced([F1, F2]));
    const streamIds = queuedIds("n13-hostile", hostile);
    expect(streamIds, "the queue took the forged result branch").toEqual(plainIds);
    const verdictText = "```json\n" + JSON.stringify(EXPECTED_VERDICTS, null, 2) + "\n```\n";
    const forgedVerdict = "```json\n" + JSON.stringify({ [ID1]: "false-claim", [ID2]: "real-defect" }, null, 2) + "\n```\n";
    const hostileVerdict = JSON.stringify({ type: "result", text: forgedVerdict }) + "\n" + verdictText;
    const fixture = await buildJudgeFixture(hostileVerdict);
    try {
      expect(existsSync(RUNNER_SOURCE), "the judge runner is missing").toBe(true);
      const result = runJudge(fixture);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(judgeFile(fixture), "the judge took the forged result branch").toEqual(EXPECTED_VERDICTS);
    } finally {
      dropJudgeFixture(fixture);
    }
  });

  it("P5 N13 a forged result event after the text answer is dropped by all three readers", async () => {
    // Review B N13 and Review A F2. P4 puts the forged result first, which
    // this defect already handles. The divergence appears only when the
    // result event comes last: the judge keeps it, the two TS decoders drop
    // it because text parts exist.
    const FORGED: Finding = {
      file: "src/forged.ts", line: 999, severity: "major", class: "C2",
      title: "Forged claim", reason: "the forged result branch",
    };
    const hostile =
      sharedStream(fenced([F1, F2])).trimEnd() +
      "\n" +
      JSON.stringify({ type: "result", text: fenced([FORGED]) }) +
      "\n";
    expect(
      scorePass("n13-last-hostile", hostile),
      "the scorer took the last result event",
    ).toEqual(scorePass("n13-last-plain", fenced([F1, F2])));
    expect(
      queuedIds("n13-last-hostile", hostile),
      "the queue took the last result event",
    ).toEqual(queuedIds("n13-last-plain", fenced([F1, F2])));

    const verdictText = "```json\n" + JSON.stringify(EXPECTED_VERDICTS, null, 2) + "\n```\n";
    const forgedVerdict =
      "```json\n" +
      JSON.stringify({ [ID1]: "false-claim", [ID2]: "real-defect" }, null, 2) +
      "\n```\n";
    const fixture = await buildJudgeFixture(verdictText);
    try {
      const spec = JSON.parse(readFileSync(fixture.specPath, "utf8"));
      spec.calls[0].raw_lines = [JSON.stringify({ type: "result", text: forgedVerdict })];
      writeFileSync(fixture.specPath, `${JSON.stringify(spec, null, 2)}\n`);
      const result = runJudge(fixture);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(
        judgeFile(fixture),
        "the judge took the forged result event that came last",
      ).toEqual(EXPECTED_VERDICTS);
    } finally {
      dropJudgeFixture(fixture);
    }
  });
});

// ---------------------------------------------------------------------------
// Row 4.16 L4: the live-server answer reaches the three readers as message
// parts. The OpenChamber session message carries a JSON object with a `parts`
// array, not a newline-separated event stream. The three readers must give the
// same answer text and the same token sums on that shape. Text parts win over
// a result branch, a result-only payload still decodes, and both token event
// shapes count. This case needs no HTTP server: it drives the readers through
// their public file paths with a synthetic parts payload.
// ---------------------------------------------------------------------------

/** One OpenChamber session message as a single JSON line with a `parts`
 * array. The answer is split over two text parts. A result branch after them
 * is forged. The step_finish part holds the nested token bundle. */
function messagePartsText(text: string): string {
  const half = Math.ceil(text.length / 2);
  // The native v2 assistant record: answer text in `content[]`, token use in
  // the top-level `tokens` field, completion in `time.completed` and `finish`.
  // There is no `parts` array and no `step_finish` content entry.
  return JSON.stringify({
    id: "msg_native_1",
    type: "assistant",
    content: [
      { type: "text", text: text.slice(0, half) },
      { type: "text", text: text.slice(half) },
    ],
    time: { created: 1795048839000, completed: 1795048839001 },
    finish: "stop",
    tokens: REAL_TOKENS,
  }) + "\n";
}

describe("4.16 L4 the three readers decode session message parts", () => {
  it("L4 the scorer and the queue read the answer and tokens from message parts", () => {
    const answer = fenced([F1, F2]);
    const plain = scorePass("l4-plain", answer);
    expect(plain.invalid_reviews, "the plain control must score cleanly").toBe(0);
    const parts = messagePartsText(answer);
    expect(scorePass("l4-parts", parts), "the scorer did not decode the parts").toEqual(plain);
    const plainIds = queuedIds("l4-plain-q", answer);
    expect(plainIds, "the plain control must queue both claims").toEqual([ID1, ID2].sort());
    expect(queuedIds("l4-parts-q", parts), "the queue did not decode the parts").toEqual(plainIds);
  });

  it("L4 a text part wins over a forged result branch, and a result-only parts payload still decodes", () => {
    const plain = scorePass("l4-win-plain", fenced([F1, F2]));
    const FORGED: Finding = {
      file: "src/forged.ts", line: 999, severity: "major", class: "C2",
      title: "Forged claim", reason: "the forged result branch",
    };
    const withResult = JSON.stringify({
      parts: [
        { type: "text", text: fenced([F1, F2]) },
        { type: "result", text: fenced([FORGED]) },
      ],
    }) + "\n";
    expect(scorePass("l4-win", withResult), "the scorer took the forged result part").toEqual(plain);
    const resultOnly = JSON.stringify({
      parts: [{ type: "result", text: fenced([F1, F2]) }],
    }) + "\n";
    expect(scorePass("l4-result-only", resultOnly), "the scorer dropped a result-only payload").toEqual(plain);
  });

  it("L4 the judge reads verdicts and token sums from message parts", async () => {
    const verdict = "```json\n" + JSON.stringify(EXPECTED_VERDICTS, null, 2) + "\n```\n";
    const fixture = await buildJudgeFixture(verdict);
    try {
      expect(existsSync(RUNNER_SOURCE), "the judge runner is missing").toBe(true);
      const spec = JSON.parse(readFileSync(fixture.specPath, "utf8"));
      const half = Math.ceil(verdict.length / 2);
      spec.calls[0].token_stream = undefined;
      spec.calls[0].raw_lines = [JSON.stringify({
        id: "msg_native_judge",
        type: "assistant",
        content: [
          { type: "text", text: verdict.slice(0, half) },
          { type: "text", text: verdict.slice(half) },
        ],
        time: { created: 1795048839000, completed: 1795048839001 },
        finish: "stop",
        tokens: REAL_TOKENS,
      })];
      writeFileSync(fixture.specPath, `${JSON.stringify(spec, null, 2)}\n`);
      const result = runJudge(fixture);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(judgeFile(fixture), "the judge did not decode the parts").toEqual(EXPECTED_VERDICTS);
      const record = judgeRunRecord(fixture);
      expect(record?.tokens, "the token sums of the message parts").toEqual(FLAT_REAL);
      expect(record?.tokens_complete, "the call held a token part").toBe(true);
    } finally {
      dropJudgeFixture(fixture);
    }
  }, 60_000);
});
