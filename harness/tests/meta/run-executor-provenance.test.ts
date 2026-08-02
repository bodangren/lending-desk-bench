import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");
const REFERENCE = resolve(ROOT, "reference");
const AGENT_IMAGE = "docker.io/library/node@sha256:" + "a".repeat(64);
const ARM_B_SKILLS = [
  "measure",
  "next-best-practices",
  "vercel-react-best-practices",
  "vercel-composition-patterns",
  "build-graph",
] as const;

function runId(prefix: string): string {
  return prefix + "-" + process.pid + "-" + Date.now();
}

function run(provider: string, model: string, arm: "a" | "b", id: string, env: NodeJS.ProcessEnv) {
  return spawnSync(resolve(HARNESS, "run.sh"), [provider, model, arm, id], {
    cwd: HARNESS,
    encoding: "utf8",
    env,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function parseArtifact(runIdValue: string, name: string) {
  return JSON.parse(readFileSync(resolve(ROOT, "runs", runIdValue, "artifacts", name), "utf8"));
}

describe("run-level executor provenance", () => {
  it("records a skipped safe-reference overlay as a valid but explicitly nonrankable control", () => {
    const id = runId("meta-overlay-control");
    const work = resolve(ROOT, "runs", id);
    try {
      const result = run("local", "reference-control", "b", id, {
        ...process.env,
        AGENT_SKIP: "1",
        OVERLAY: REFERENCE,
        BENCH_IGNORE_LOAD: "1",
        THINKING: "xhigh",
      });
      expect(result.status, result.stdout + "\n" + result.stderr).toBe(0);

      const provenance = parseArtifact(id, "provenance.json");
      expect(provenance).toMatchObject({
        schema: 4,
        run_id: id,
        arm: "b",
        model: "local/reference-control",
        mode: "overlay",
        agent_isolated: false,
        executor: { schema: 1, kind: "not-invoked", run_id: id, arm: "b", reason: "AGENT_SKIP=1" },
      });

      const score = parseArtifact(id, "score.json");
      expect(score).toMatchObject({
        valid: true,
        provenance_valid: true,
        suite_current: true,
        trusted: false,
        publishable: false,
        rankable: false,
        host: { under_load: true },
      });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }, 300_000);

  it("writes the resolved normal-run runtime inputs before rejecting a missing provider credential", () => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-run-identity-"));
    const piRoot = resolve(temp, "pi");
    const skillRoot = resolve(temp, "skills");
    const bin = resolve(temp, "bin");
    const podmanLog = resolve(temp, "podman-invoked");
    const id = runId("meta-agent-identity");
    const work = resolve(ROOT, "runs", id);
    try {
      mkdirSync(resolve(piRoot, "bin"), { recursive: true });
      mkdirSync(bin, { recursive: true });
      writeFileSync(resolve(piRoot, "bin", "pi"), "#!/usr/bin/env sh\nif [ \"$1\" = \"--version\" ]; then echo pi 9.9.9; exit 0; fi\nexit 97\n");
      chmodSync(resolve(piRoot, "bin", "pi"), 0o755);
      writeFileSync(resolve(bin, "podman"), "#!/usr/bin/env sh\nprintf invoked > \"$PODMAN_LOG\"\nexit 97\n");
      chmodSync(resolve(bin, "podman"), 0o755);
      for (const skill of ARM_B_SKILLS) {
        const root = resolve(skillRoot, skill);
        mkdirSync(root, { recursive: true });
        writeFileSync(resolve(root, "SKILL.md"), "# " + skill + "\n");
      }

      const env = { ...process.env };
      delete env.AGENT_SKIP;
      env.BENCH_IGNORE_LOAD = "1";
      env.BENCH_PI_ROOT = piRoot;
      env.BENCH_SKILL_ROOT = skillRoot;
      env.BENCH_AGENT_IMAGE = AGENT_IMAGE;
      env.OPENAI_API_KEY = "";
      env.THINKING = "xhigh";
      env.PATH = bin + ":" + (env.PATH ?? "");
      env.PODMAN_LOG = podmanLog;
      const result = run("openai", "meta/no-credential", "b", id, env);
      expect(result.status, result.stdout + "\n" + result.stderr).not.toBe(0);
      expect(existsSync(podmanLog), "the runner must not start a model when its credential is absent").toBe(false);

      const identity = parseArtifact(id, "execution-identity.json");
      expect(identity).toMatchObject({
        schema: 1,
        run_id: id,
        arm: "b",
        image_reference: AGENT_IMAGE,
        image_identity: "a".repeat(64),
        pi: { path: resolve(piRoot, "bin", "pi"), version: "pi 9.9.9", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      });
      expect(Object.keys(identity.skills).sort()).toEqual([...ARM_B_SKILLS].sort());
      expect(identity.runtime_flags).toEqual(expect.arrayContaining([
        "run", "--pull=never", "--read-only", "--network", "slirp4netns:allow_host_loopback=false", "--entrypoint", "/usr/bin/timeout",
      ]));
      expect(identity.cli_flags).toEqual(expect.arrayContaining([
        "/opt/pi/bin/pi", "--provider", "openai", "--model", "meta/no-credential", "--thinking", "xhigh",
        "--skill", "/opt/skills/measure", "/opt/skills/next-best-practices", "/opt/skills/vercel-react-best-practices",
        "/opt/skills/vercel-composition-patterns", "/opt/skills/build-graph",
      ]));
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(temp, { recursive: true, force: true });
    }
  }, 30_000);
});
