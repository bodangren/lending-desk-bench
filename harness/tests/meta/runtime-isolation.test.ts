import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");
const FIXTURE = resolve(ROOT, "fixture");
const AGENT_IMAGE = "docker.io/library/node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3";
const SYNTHETIC_CREDENTIAL = "phase6-synthetic-not-a-credential";
const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "XAI_API_KEY", "TOGETHER_API_KEY",
  "CEREBRAS_API_KEY", "FIREWORKS_API_KEY", "XIAOMI_API_KEY",
] as const;

function runId(prefix: string): string {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function safeEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of PROVIDER_ENV) delete env[key];
  delete env.BENCH_PROVIDER_ENV;
  return { ...env, ...overrides };
}

function requireRunProbe(mode: "container" | "ports", required: readonly string[] = []): void {
  const source = readFileSync(resolve(HARNESS, "run.sh"), "utf8");
  expect(source.includes("BENCH_RUNTIME_PROBE"), "run.sh needs an explicit, pre-grading BENCH_RUNTIME_PROBE path").toBe(true);
  expect(source.includes(mode), `run.sh must implement the ${mode} runtime probe`).toBe(true);
  for (const token of required) expect(source, `run.sh runtime probe is missing ${token}`).toContain(token);
}

function requireGradeProbe(): void {
  const source = readFileSync(resolve(HARNESS, "grade.sh"), "utf8");
  expect(source.includes("BENCH_RUNTIME_PROBE"), "grade.sh needs an explicit pre-suite BENCH_RUNTIME_PROBE path").toBe(true);
  expect(source.includes("server"), "grade.sh must implement the server runtime probe").toBe(true);
  expect(source, "server probe must retain evidence before its cleanup trap runs").toContain("runtime-server-probe.json");
}

function runProbe(id: string, env: NodeJS.ProcessEnv) {
  return spawnSync(resolve(HARNESS, "run.sh"), ["openai", "phase6-runtime-probe", "a", id], {
    cwd: HARNESS,
    encoding: "utf8",
    env,
    maxBuffer: 5 * 1024 * 1024,
  });
}

async function listenLoopback(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("could not allocate a loopback test port");
  return {
    port: address.port,
    close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}

async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

function fakePi(port: number, marker: string): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const net = require("node:net");
if (process.argv.includes("--version")) {
  process.stdout.write("phase6-fake-pi 1.0.0\\n");
  process.exit(0);
}
const attemptWrite = (path, value) => {
  try { fs.writeFileSync(path, value); return true; } catch { return false; }
};
const reachable = (host, port) => new Promise((resolveReachable) => {
  const socket = net.connect({ host, port });
  const done = (value) => { socket.destroy(); resolveReachable(value); };
  socket.setTimeout(700, () => done(false));
  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));
});
(async () => {
  const candidate = "/workspace/src/lib/loans.ts";
  const original = fs.readFileSync(candidate);
  const candidateWrite = attemptWrite(candidate, original);
  const probe = {
    kind: "phase6-isolation-probe",
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    candidate_write: candidateWrite,
    dependency_write: attemptWrite("/workspace/node_modules/.${marker}", "blocked"),
    pi_mount_write: attemptWrite("/opt/pi/.${marker}", "blocked"),
    root_write: attemptWrite("/.${marker}", "blocked"),
    tmp_write: attemptWrite("/tmp/${marker}", "allowed"),
    host_loopback_reachable: await reachable("10.0.2.2", ${port}),
  };
  process.stdout.write(JSON.stringify(probe) + "\\n");
})().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
`;
}

function createServerProbeCandidate(id: string): { work: string; candidate: string } {
  const work = resolve(ROOT, "runs", id);
  const candidate = resolve(work, "candidate");
  cpSync(FIXTURE, candidate, {
    recursive: true,
    filter: (source) => ![".git", "node_modules", ".next"].includes(basename(source)) && !source.endsWith(".tsbuildinfo"),
  });
  symlinkSync(resolve(FIXTURE, "node_modules"), resolve(candidate, "node_modules"), "dir");
  symlinkSync(resolve(FIXTURE, ".next"), resolve(candidate, ".next"), "dir");
  return { work, candidate };
}

describe("runtime isolation and lifecycle", () => {
  it("runs a real local Podman probe with enforced write, privilege, and host-loopback boundaries", async () => {
    requireRunProbe("container", ["BENCH_RUNTIME_PROBE_LABEL"]);
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-phase6-pi-"));
    const piRoot = resolve(temp, "pi");
    const id = runId("phase6-container");
    const work = resolve(ROOT, "runs", id);
    const label = runId("phase6-container-label");
    const loopback = await listenLoopback();
    try {
      mkdirSync(resolve(piRoot, "bin"), { recursive: true });
      writeFileSync(resolve(piRoot, "bin", "pi"), fakePi(loopback.port, label));
      chmodSync(resolve(piRoot, "bin", "pi"), 0o755);
      const result = runProbe(id, safeEnv({
        AGENT_TIMEOUT: "15",
        BENCH_AGENT_IMAGE: AGENT_IMAGE,
        BENCH_IGNORE_LOAD: "1",
        BENCH_PI_ROOT: piRoot,
        BENCH_PROVIDER_ENV: "OPENAI_API_KEY",
        BENCH_RUNTIME_PROBE: "container",
        BENCH_RUNTIME_PROBE_LABEL: label,
        OPENAI_API_KEY: SYNTHETIC_CREDENTIAL,
      }));
      expect(result.status, "real container probe failed").toBe(0);

      const session = readFileSync(resolve(work, "artifacts", "session.json"), "utf8");
      expect(session).not.toContain(SYNTHETIC_CREDENTIAL);
      const probe = JSON.parse(session);
      expect(probe).toMatchObject({
        kind: "phase6-isolation-probe",
        uid: process.getuid(),
        candidate_write: true,
        dependency_write: false,
        pi_mount_write: false,
        root_write: false,
        tmp_write: true,
        host_loopback_reachable: false,
      });
      expect(probe.uid).not.toBe(0);

      const lingering = spawnSync("podman", ["ps", "-aq", "--filter", `label=lending-desk.runtime-probe=${label}`], { encoding: "utf8" });
      expect(lingering.status, "could not inspect local Podman cleanup").toBe(0);
      expect(lingering.stdout.trim(), "probe container survived podman run --rm").toBe("");
    } finally {
      await loopback.close();
      rmSync(work, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    }
  }, 90_000);

  it("allocates runner ports concurrently, rejects occupied requests, and releases locks for recovery", async () => {
    requireRunProbe("ports", ["BENCH_RUNTIME_PROBE_HOLD_SECONDS", "runtime-port-probe.json"]);
    const first = runId("phase6-ports-a");
    const second = runId("phase6-ports-b");
    const recovery = runId("phase6-ports-recovery");
    const failed = runId("phase6-ports-occupied");
    const lockRoot = resolve(ROOT, "runs", ".port-locks");
    const probePath = (id: string) => resolve(ROOT, "runs", id, "artifacts", "runtime-port-probe.json");
    const launch = (id: string) => spawn(resolve(HARNESS, "run.sh"), ["openai", "phase6-port-probe", "a", id], {
      cwd: HARNESS,
      env: safeEnv({ BENCH_IGNORE_LOAD: "1", BENCH_RUNTIME_PROBE: "ports", BENCH_RUNTIME_PROBE_HOLD_SECONDS: "3" }),
      stdio: "ignore",
    });
    const children = [launch(first), launch(second)];
    let occupied: Awaited<ReturnType<typeof listenLoopback>> | undefined;
    try {
      await Promise.all([waitForFile(probePath(first)), waitForFile(probePath(second))]);
      const initial = [first, second].map((id) => JSON.parse(readFileSync(probePath(id), "utf8")));
      const allocated = initial.flatMap((probe) => [probe.api_port, probe.e2e_port]);
      expect(new Set(allocated).size, "concurrent runners received a duplicate port").toBe(4);
      for (const port of allocated) expect(existsSync(resolve(lockRoot, String(port))), `runner did not hold lock for ${port}`).toBe(true);

      await Promise.all(children.map(async (child) => {
        const [status] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
        expect(status, "port probe exited unsuccessfully").toBe(0);
      }));
      for (const port of allocated) expect(existsSync(resolve(lockRoot, String(port))), `lock leaked after ${port} probe`).toBe(false);

      occupied = await listenLoopback();
      const rejected = runProbe(failed, safeEnv({
        API_PORT: String(occupied.port),
        BENCH_IGNORE_LOAD: "1",
        BENCH_RUNTIME_PROBE: "ports",
      }));
      expect(rejected.status, "runner accepted a port already owned by another process").not.toBe(0);
      expect(existsSync(resolve(lockRoot, String(occupied.port))), "failed occupied-port claim leaked its lock").toBe(false);
      await occupied.close();
      occupied = undefined;

      const recovered = runProbe(recovery, safeEnv({ BENCH_IGNORE_LOAD: "1", BENCH_RUNTIME_PROBE: "ports" }));
      expect(recovered.status, "runner could not recover after an occupied-port failure").toBe(0);
      const probe = JSON.parse(readFileSync(probePath(recovery), "utf8"));
      expect(probe.api_port).not.toBe(probe.e2e_port);
      expect(existsSync(resolve(lockRoot, String(probe.api_port)))).toBe(false);
      expect(existsSync(resolve(lockRoot, String(probe.e2e_port)))).toBe(false);
    } finally {
      for (const child of children) child.kill("SIGTERM");
      if (occupied) await occupied.close();
      for (const id of [first, second, failed, recovery]) rmSync(resolve(ROOT, "runs", id), { recursive: true, force: true });
    }
  }, 60_000);

  it("starts a real Next server through the grader probe and leaves neither PID nor port behind", async () => {
    requireGradeProbe();
    const id = runId("phase6-server");
    const { work } = createServerProbeCandidate(id);
    const api = await listenLoopback();
    const e2e = await listenLoopback();
    await api.close();
    await e2e.close();
    try {
      const result = spawnSync(resolve(HARNESS, "grade.sh"), [id, "local/phase6-server", "a", "0"], {
        cwd: HARNESS,
        encoding: "utf8",
        env: safeEnv({
          API_PORT: String(api.port),
          E2E_PORT: String(e2e.port),
          BENCH_IGNORE_LOAD: "1",
          BENCH_RUNTIME_PROBE: "server",
          NEXT_TELEMETRY_DISABLED: "1",
        }),
        maxBuffer: 5 * 1024 * 1024,
      });
      expect(result.status, "real grade server probe failed").toBe(0);
      const probe = JSON.parse(readFileSync(resolve(work, "artifacts", "runtime-server-probe.json"), "utf8"));
      expect(probe).toMatchObject({ api_port: api.port, ready: true });
      expect(typeof probe.server_pid).toBe("number");
      const listeners = spawnSync("ss", ["-ltnp", `sport = :${api.port}`], { encoding: "utf8" });
      expect(listeners.status).toBe(0);
      expect(listeners.stdout, "grader leaked the Next server listener").not.toContain(`:${api.port}`);
      let alive = true;
      try { process.kill(probe.server_pid, 0); } catch { alive = false; }
      expect(alive, "grader leaked the Next server process").toBe(false);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 90_000);
});
