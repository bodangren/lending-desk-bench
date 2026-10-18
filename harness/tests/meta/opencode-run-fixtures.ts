import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createFakeOpencode, TEST_MODEL } from "./schema4-fixtures";

export const ROOT = resolve(import.meta.dirname, "../../..");
export const HARNESS = resolve(ROOT, "harness");
export const IMAGE = "docker.io/library/node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3";
export const SKILLS = ["measure", "next-best-practices", "vercel-react-best-practices", "vercel-composition-patterns", "build-graph"];

export function jsonIfPresent(path: string): any {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

/** Runs the real runner with canaries and a Podman recorder. No container starts. */
export function captureOpencodeRun(arm: "a" | "b") {
  mkdirSync("/tmp/opencode", { recursive: true });
  const temp = mkdtempSync("/tmp/opencode/executor-red-");
  const fake = createFakeOpencode(temp);
  const id = `meta-opencode-${arm}-${process.pid}-${Date.now()}`;
  const work = resolve(ROOT, "runs", id);
  const out = resolve(work, "artifacts");
  const podmanCapture = resolve(temp, "podman.json");
  const piHit = resolve(temp, "PI-HIT");
  const runtime = resolve(temp, "runtime");
  const skillRoot = resolve(temp, "skills");
  mkdirSync(runtime);
  mkdirSync(resolve(temp, "home"));
  for (const skill of SKILLS) {
    mkdirSync(resolve(skillRoot, skill), { recursive: true });
    writeFileSync(resolve(skillRoot, skill, "SKILL.md"), `# ${skill}\n`);
  }
  const pi = resolve(temp, "bin", "pi");
  writeFileSync(pi, `#!${process.execPath}
require("node:fs").writeFileSync(${JSON.stringify(piHit)}, "hit");
if (process.argv[2] === "--version") console.log("pi tripwire 0.0.0");
else process.exitCode = 97;
`);
  chmodSync(pi, 0o755);
  const podman = resolve(temp, "bin", "podman");
  writeFileSync(podman, `#!${process.execPath}
const fs = require("node:fs"), crypto = require("node:crypto");
const stdin = fs.readFileSync(0), argv = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(podmanCapture)}, JSON.stringify({argv,
  env: Object.entries(process.env).map(([k,v]) => k+"="+v).sort(),
  stdin_sha256: crypto.createHash("sha256").update(stdin).digest("hex"),
  agents_exists: fs.existsSync(${JSON.stringify(resolve(work, "candidate", "AGENTS.md"))})}));
process.exitCode = 97;
`);
  chmodSync(podman, 0o755);
  // Start from an explicit environment. Never read a host credential or .env file.
  const env = {
    PATH: `${resolve(temp, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: resolve(temp, "home"), LANG: "C.UTF-8", _BENCH_ENV_LOADED: "1",
    BENCH_TRACK: "build", BENCH_IGNORE_LOAD: "1", BENCH_WAIT_FOR_IDLE: "0",
    BENCH_OPENCODE_BIN: fake.path, BENCH_PI_ROOT: temp, BENCH_SKILL_ROOT: skillRoot,
    BENCH_AGENT_IMAGE: IMAGE, XDG_RUNTIME_DIR: runtime, AGENT_TIMEOUT: "2",
    // A canary exercises the old API-key forwarding path without a real credential.
    OPENCODE_API_KEY: "CANARY-ACCESS-99", THINKING: "xhigh",
  };
  const result = spawnSync(resolve(HARNESS, "run.sh"), ["opencode-go", TEST_MODEL, arm, id], {
    cwd: HARNESS, env, encoding: "utf8", timeout: 25_000, maxBuffer: 8 * 1024 * 1024,
  });
  return {
    arm, temp, fake, id, work, out, runtime, skillRoot, piHit, podmanCapture, result,
    podman: jsonIfPresent(podmanCapture),
    cleanup() { rmSync(work, { recursive: true, force: true }); rmSync(temp, { recursive: true, force: true }); },
  };
}
