import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");
const FIXTURE = resolve(ROOT, "fixture");
const REFERENCE = resolve(ROOT, "reference");
const AGENT_IMAGE = "docker.io/library/node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3";
const SYNTHETIC_CREDENTIAL = "phase9-synthetic-not-a-credential";
const ARM_B_SKILLS = [
  "measure",
  "next-best-practices",
  "vercel-react-best-practices",
  "vercel-composition-patterns",
  "build-graph",
] as const;
const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "XAI_API_KEY", "TOGETHER_API_KEY",
  "CEREBRAS_API_KEY", "FIREWORKS_API_KEY", "XIAOMI_API_KEY", "OPENCODE_API_KEY",
] as const;

type Json = Record<string, unknown>;

function runId(prefix: string): string {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEnv(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of PROVIDER_ENV) delete env[key];
  delete env.BENCH_PROVIDER_ENV;
  return { ...env, ...overrides };
}

function runProbe(arm: "a" | "b", id: string, env: NodeJS.ProcessEnv) {
  return spawnSync(resolve(HARNESS, "run.sh"), ["openai", "phase9-runtime-probe", arm, id], {
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

function writeTempPi(
  temp: string,
  marker: string,
  loopbackPort: number,
  paths: { hostHome: string; otherRun: string },
): string {
  const pi = resolve(temp, "pi", "bin", "pi");
  mkdirSync(resolve(temp, "pi", "bin"), { recursive: true });
  writeFileSync(pi, `#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
if (process.argv.includes("--version")) {
  process.stdout.write("phase9-fake-pi 1.0.0\\n");
  process.exit(0);
}
const marker = ${JSON.stringify(marker)};
const paths = ${JSON.stringify(paths)};
const digest = (path) => fs.existsSync(path) ? crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex") : null;
const attemptWrite = (path, value) => {
  try { fs.writeFileSync(path, value); fs.rmSync(path, { force: true }); return true; } catch { return false; }
};
const rewriteCandidate = (path) => {
  try { const original = fs.readFileSync(path); fs.writeFileSync(path, original); return true; } catch { return false; }
};
const reachable = (host, port) => new Promise((resolveReachable) => {
  const socket = net.connect({ host, port });
  const done = (value) => { socket.destroy(); resolveReachable(value); };
  socket.setTimeout(700, () => done(false));
  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));
});
(async () => {
  const skillsRoot = "/opt/skills";
  const skills = fs.existsSync(skillsRoot) ? fs.readdirSync(skillsRoot).sort() : [];
  const skillWritable = Object.fromEntries(skills.map((skill) => [skill, attemptWrite(skillsRoot + "/" + skill + "/." + marker, "blocked")]));
  const probe = {
    schema: 1,
    kind: "phase9-runtime-isolation-probe",
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    candidate_writable: rewriteCandidate("/workspace/src/lib/loans.ts"),
    fixture_dependencies_writable: attemptWrite("/workspace/node_modules/." + marker, "blocked"),
    pi_writable: attemptWrite("/opt/pi/." + marker, "blocked"),
    skills_writable: skillWritable,
    tmp_writable: attemptWrite("/tmp/" + marker, "allowed"),
    root_writable: attemptWrite("/." + marker, "blocked"),
    agents_exists: fs.existsSync("/workspace/AGENTS.md"),
    agents_sha256: digest("/workspace/AGENTS.md"),
    skills,
    harness_available: fs.existsSync("/harness"),
    reference_available: fs.existsSync("/reference"),
    host_home_available: fs.existsSync(paths.hostHome),
    sibling_run_available: fs.existsSync(paths.otherRun),
    host_loopback_reachable: await reachable("10.0.2.2", ${loopbackPort}),
  };
  process.stdout.write(JSON.stringify(probe) + "\\n");
})().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
`);
  chmodSync(pi, 0o755);
  return resolve(temp, "pi");
}

function writeArmBSkills(temp: string): string {
  const root = resolve(temp, "skills");
  for (const skill of ARM_B_SKILLS) {
    const skillRoot = resolve(root, skill);
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(resolve(skillRoot, "SKILL.md"), "# " + skill + "\n");
  }
  return root;
}

function writePodmanInvocationRecorder(temp: string): { bin: string; log: string } {
  const bin = resolve(temp, "bin");
  const log = resolve(temp, "podman-invocation.json");
  const podman = resolve(bin, "podman");
  mkdirSync(bin, { recursive: true });
  writeFileSync(podman, `#!/usr/bin/env node
const fs = require("node:fs");
const providerNames = ${JSON.stringify(PROVIDER_ENV)};
const providerEnvironment = Object.fromEntries(providerNames
  .filter((name) => process.env[name] !== undefined)
  .map((name) => [name, process.env[name]]));
fs.writeFileSync(process.env.PHASE9B_PODMAN_LOG, JSON.stringify({
  argv: process.argv.slice(2),
  provider_environment: providerEnvironment,
}));
`);
  chmodSync(podman, 0o755);
  return { bin, log };
}

function writePiInvocationTrap(temp: string): { root: string; invocation: string } {
  const root = resolve(temp, "pi-trap");
  const pi = resolve(root, "bin", "pi");
  const invocation = resolve(temp, "pi-invocation.json");
  mkdirSync(resolve(root, "bin"), { recursive: true });
  writeFileSync(pi, [
    "#!/usr/bin/env node",
    "const fs = require(\"node:fs\");",
    "if (process.argv.includes(\"--version\")) { process.stdout.write(\"phase9b-pi-trap 1.0.0\\n\"); process.exit(0); }",
    "fs.writeFileSync(process.env.PHASE9B_PI_TRAP_LOG, JSON.stringify(process.argv.slice(2)));",
    "process.stderr.write(\"runtime probe must not invoke Pi\\n\");",
    "process.exit(98);",
  ].join("\n"));
  chmodSync(pi, 0o755);
  return { root, invocation };
}

function writeProbePiRoot(temp: string): { root: string; sentinel: string } {
  const root = resolve(temp, "probe-pi");
  const sentinel = resolve(root, "probe-pi-sentinel.txt");
  const pi = resolve(root, "bin", "pi");
  mkdirSync(resolve(root, "bin"), { recursive: true });
  writeFileSync(sentinel, "probe Pi mount sentinel\n");
  writeFileSync(pi, "#!/usr/bin/env sh\nexit 98\n");
  chmodSync(pi, 0o755);
  return { root, sentinel };
}

function expectSharedIsolation(probe: Json): void {
  expect(probe).toMatchObject({
    schema: 1,
    kind: "phase9-runtime-isolation-probe",
    uid: process.getuid(),
    candidate_writable: true,
    fixture_dependencies_writable: false,
    pi_writable: false,
    tmp_writable: true,
    root_writable: false,
    harness_available: false,
    reference_available: false,
    host_home_available: false,
    sibling_run_available: false,
    host_loopback_reachable: false,
  });
  expect(probe.uid).not.toBe(0);
  expect(Object.values(probe.skills_writable as Json)).toEqual(expect.arrayContaining([]));
  expect(Object.values(probe.skills_writable as Json)).not.toContain(true);
}

function assertNoProbeContainer(label: string): void {
  const lingering = spawnSync("podman", ["ps", "-aq", "--filter", `label=lending-desk.runtime-probe=${label}`], { encoding: "utf8" });
  expect(lingering.status, "could not inspect local Podman cleanup").toBe(0);
  expect(lingering.stdout.trim(), "probe container survived podman run --rm").toBe("");
}

describe("runtime isolation completion", () => {

  it.each(["container", "dependency-copy"] as const)("runs the %s probe without selecting a provider or invoking Pi", (probeMode) => {
    const temp = mkdtempSync(resolve(tmpdir(), `lending-desk-phase9b-${probeMode}-`));
    const id = runId(`phase9b-${probeMode}`);
    const work = resolve(ROOT, "runs", id);
    try {
      const pi = writePiInvocationTrap(temp);
      const recorder = writePodmanInvocationRecorder(temp);
      const result = runProbe("a", id, safeEnv({
        AGENT_TIMEOUT: "5",
        BENCH_AGENT_IMAGE: AGENT_IMAGE,
        BENCH_IGNORE_LOAD: "1",
        BENCH_PI_ROOT: pi.root,
        BENCH_PROVIDER_ENV: "OPENAI_API_KEY",
        BENCH_RUNTIME_PROBE: probeMode,
        ...(probeMode === "container" ? { BENCH_RUNTIME_PROBE_LABEL: runId("phase9b-label") } : {}),
        PATH: `${recorder.bin}:${process.env.PATH ?? ""}`,
        PHASE9B_PODMAN_LOG: recorder.log,
        PHASE9B_PI_TRAP_LOG: pi.invocation,
      }));

      const sessionErrorPath = resolve(work, "artifacts", "session.err");
      const sessionError = existsSync(sessionErrorPath) ? readFileSync(sessionErrorPath, "utf8") : "";
      expect(result.status, result.stdout + "\n" + result.stderr + "\n" + sessionError).toBe(0);
      expect(existsSync(pi.invocation), "runtime probe invoked Pi").toBe(false);
      if (existsSync(recorder.log)) {
        const invocation = JSON.parse(readFileSync(recorder.log, "utf8")) as {
          argv: string[];
          provider_environment: Record<string, string>;
        };
        const providerMounts = invocation.argv.filter((argument, index) =>
          argument === "--env" && PROVIDER_ENV.includes(invocation.argv[index + 1] as typeof PROVIDER_ENV[number]),
        );
        expect(invocation.provider_environment).toEqual({});
        expect(providerMounts).toEqual([]);
        expect(invocation.argv).not.toContain("/opt/pi/bin/pi");
        expect(invocation.argv).not.toContain("--provider");
        expect(invocation.argv).not.toContain("--model");
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    }
  }, 90_000);


  it("binds real probe-only sentinels while keeping the container provider- and Pi-free", async () => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-phase10-runtime-probe-"));
    const id = runId("phase10-runtime-probe");
    const work = resolve(ROOT, "runs", id);
    const label = runId("phase10-runtime-probe-label");
    const hostHome = resolve(temp, "host-home");
    const siblingRun = resolve(temp, "sibling-run");
    const loopback = await listenLoopback();
    try {
      mkdirSync(hostHome, { recursive: true });
      mkdirSync(siblingRun, { recursive: true });
      writeFileSync(resolve(hostHome, "host-home-sentinel.txt"), "host home sentinel\n");
      writeFileSync(resolve(siblingRun, "sibling-run-sentinel.txt"), "sibling run sentinel\n");
      const probePi = writeProbePiRoot(temp);
      const result = runProbe("a", id, safeEnv({
        BENCH_AGENT_IMAGE: AGENT_IMAGE,
        BENCH_IGNORE_LOAD: "1",
        BENCH_PI_ROOT: probePi.root,
        BENCH_RUNTIME_PROBE: "container",
        BENCH_RUNTIME_PROBE_LABEL: label,
        BENCH_RUNTIME_PROBE_LOOPBACK_PORT: String(loopback.port),
        BENCH_RUNTIME_PROBE_HOST_HOME_PATH: hostHome,
        BENCH_RUNTIME_PROBE_SIBLING_RUN_PATH: siblingRun,
      }));
      expect(result.status, result.stdout + "\n" + result.stderr).toBe(0);
      const probe = JSON.parse(readFileSync(resolve(work, "artifacts", "session.json"), "utf8")) as Json;
      expect(probe).toMatchObject({
        schema: 1,
        kind: "phase9-runtime-isolation-probe",
        probe_inputs_valid: true,
        probe_loopback_port: loopback.port,
        probe_host_home_path: hostHome,
        probe_sibling_run_path: siblingRun,
        host_home_available: false,
        sibling_run_available: false,
        host_loopback_reachable: false,
        probe_pi_mounted: true,
        probe_pi_writable: false,
      });
      expect(probe.probe_pi_sentinel_sha256).toBe(sha256(readFileSync(probePi.sentinel)));
      assertNoProbeContainer(label);
    } finally {
      await loopback.close();
      rmSync(work, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    }
  }, 90_000);

  it.each(["a", "b"] as const)("proves the complete real Podman mount boundary for Arm %s", async (arm) => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-phase9-container-"));
    const id = runId(`phase9-container-${arm}`);
    const otherRun = resolve(ROOT, "runs", runId("phase9-sibling"));
    const work = resolve(ROOT, "runs", id);
    const label = runId(`phase9-container-label-${arm}`);
    const loopback = await listenLoopback();
    try {
      mkdirSync(otherRun, { recursive: true });
      writeFileSync(resolve(otherRun, "must-not-mount.txt"), "private sibling run\n");
      const piRoot = writeTempPi(temp, label, loopback.port, {
        hostHome: process.env.HOME ?? "/home/daniel-bo",
        otherRun,
      });
      const result = runProbe(arm, id, safeEnv({
        AGENT_TIMEOUT: "15",
        BENCH_AGENT_IMAGE: AGENT_IMAGE,
        BENCH_IGNORE_LOAD: "1",
        BENCH_PI_ROOT: piRoot,
        BENCH_SKILL_ROOT: writeArmBSkills(temp),
        BENCH_PROVIDER_ENV: "OPENAI_API_KEY",
        BENCH_RUNTIME_PROBE: "container",
        BENCH_RUNTIME_PROBE_LABEL: label,
        OPENAI_API_KEY: SYNTHETIC_CREDENTIAL,
      }));
      expect(result.status, result.stdout + "\n" + result.stderr).toBe(0);
      const session = readFileSync(resolve(work, "artifacts", "session.json"), "utf8");
      expect(session).not.toContain(SYNTHETIC_CREDENTIAL);
      const probe = JSON.parse(session) as Json;
      expectSharedIsolation(probe);
      if (arm === "a") {
        expect(probe).toMatchObject({ agents_exists: false, agents_sha256: null, skills: [], skills_writable: {} });
      } else {
        expect(probe.agents_exists).toBe(true);
        expect(probe.agents_sha256).toBe(sha256(readFileSync(resolve(FIXTURE, "AGENTS.md"))));
        expect(probe.skills).toEqual([...ARM_B_SKILLS].sort());
        expect(Object.keys(probe.skills_writable as Json).sort()).toEqual([...ARM_B_SKILLS].sort());
      }
      assertNoProbeContainer(label);
    } finally {
      await loopback.close();
      rmSync(work, { recursive: true, force: true });
      rmSync(otherRun, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    }
  }, 90_000);

  it("gives the host grader a physical private dependency copy after the real agent phase", () => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-phase9-dependency-copy-"));
    const id = runId("phase9-dependency-copy");
    const work = resolve(ROOT, "runs", id);
    const marker = ".phase9-private-dependency";
    try {
      const piRoot = writeTempPi(temp, marker, 9, { hostHome: process.env.HOME ?? "/home/daniel-bo", otherRun: resolve(ROOT, "runs", "missing") });
      const result = runProbe("b", id, safeEnv({
        AGENT_TIMEOUT: "15",
        BENCH_AGENT_IMAGE: AGENT_IMAGE,
        BENCH_IGNORE_LOAD: "1",
        BENCH_PI_ROOT: piRoot,
        BENCH_SKILL_ROOT: writeArmBSkills(temp),
        BENCH_PROVIDER_ENV: "OPENAI_API_KEY",
        BENCH_RUNTIME_PROBE: "dependency-copy",
        OPENAI_API_KEY: SYNTHETIC_CREDENTIAL,
      }));
      expect(result.status, result.stdout + "\n" + result.stderr).toBe(0);
      const candidateDependencies = resolve(work, "candidate", "node_modules");
      const fixtureDependencies = resolve(FIXTURE, "node_modules");
      const candidateStat = lstatSync(candidateDependencies);
      const fixtureStat = lstatSync(fixtureDependencies);
      expect(candidateStat.isSymbolicLink()).toBe(false);
      expect(fixtureStat.isSymbolicLink()).toBe(false);
      expect(`${candidateStat.dev}:${candidateStat.ino}`).not.toBe(`${fixtureStat.dev}:${fixtureStat.ino}`);
      writeFileSync(resolve(candidateDependencies, marker), "candidate-only\n");
      expect(existsSync(resolve(fixtureDependencies, marker))).toBe(false);
      rmSync(resolve(candidateDependencies, marker));
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    }
  }, 90_000);

  it("reclaims a stale mkdir port lock only after its PID/token owner is killed", async () => {
    const id = runId("phase9-stale-owner");
    const recovery = runId("phase9-stale-recovery");
    const work = resolve(ROOT, "runs", id);
    const recoveryWork = resolve(ROOT, "runs", recovery);
    const lockRoot = resolve(ROOT, "runs", ".port-locks");
    const probePath = resolve(work, "artifacts", "runtime-port-probe.json");
    const reserved = await listenLoopback();
    await reserved.close();
    const port = reserved.port;
    const child = spawn(resolve(HARNESS, "run.sh"), ["openai", "phase9-stale-lock", "a", id], {
      cwd: HARNESS,
      env: safeEnv({
        API_PORT: String(port),
        BENCH_IGNORE_LOAD: "1",
        BENCH_RUNTIME_PROBE: "ports",
        BENCH_RUNTIME_PROBE_HOLD_SECONDS: "60",
      }),
      stdio: "ignore",
    });
    try {
      await waitForFile(probePath);
      const lock = resolve(lockRoot, String(port));
      const ownerPath = resolve(lock, "owner.json");
      const owner = existsSync(ownerPath) ? JSON.parse(readFileSync(ownerPath, "utf8")) : undefined;
      expect.soft(owner).toMatchObject({ schema: 1, pid: child.pid, token: expect.stringMatching(/^[a-f0-9]{16,}$/), port });

      child.kill("SIGKILL");
      const [status, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
      expect.soft(status).toBeNull();
      expect.soft(signal).toBe("SIGKILL");
      expect.soft(existsSync(lock)).toBe(true);

      const recovered = runProbe("a", recovery, safeEnv({
        API_PORT: String(port),
        BENCH_IGNORE_LOAD: "1",
        BENCH_RUNTIME_PROBE: "ports",
      }));
      expect.soft(recovered.status, recovered.stdout + "\n" + recovered.stderr).toBe(0);
      expect.soft(existsSync(lock)).toBe(false);
    } finally {
      child.kill("SIGKILL");
      rmSync(work, { recursive: true, force: true });
      rmSync(recoveryWork, { recursive: true, force: true });
      rmSync(resolve(lockRoot, String(port)), { recursive: true, force: true });
    }
  }, 90_000);
});
