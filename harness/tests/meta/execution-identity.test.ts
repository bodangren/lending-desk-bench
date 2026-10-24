import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("resolved executor identity", () => {
  it("derives immutable image, Pi, Arm-B skill-tree, runtime, and CLI evidence from actual inputs", async () => {
    const temp = mkdtempSync(resolve(tmpdir(), "lending-desk-executor-identity-"));
    const opencode = resolve(temp, "opencode");
    const rg = resolve(temp, "rg");
    const config = resolve(temp, "opencode.json");
    const entry = resolve(temp, "opencode-entry.sh");
    const measure = resolve(temp, "skills", "measure");
    const next = resolve(temp, "skills", "next-best-practices");
    const react = resolve(temp, "skills", "vercel-react-best-practices");
    const composition = resolve(temp, "skills", "vercel-composition-patterns");
    const graph = resolve(temp, "skills", "build-graph");
    try {
      writeFileSync(opencode, `#!${process.execPath}\nif (process.argv[2] === "--version") console.log("opencode v2.0.32");\n`);
      chmodSync(opencode, 0o755);
      writeFileSync(rg, "#!/bin/sh\necho ripgrep 15.1.0\n");
      chmodSync(rg, 0o755);
      writeFileSync(config, '{"model":"opencode-go/meta/executor"}\n');
      writeFileSync(entry, "#!/bin/sh\nexit 0\n");
      mkdirSync(measure, { recursive: true });
      mkdirSync(next, { recursive: true });
      mkdirSync(react, { recursive: true });
      mkdirSync(composition, { recursive: true });
      mkdirSync(graph, { recursive: true });
      writeFileSync(resolve(measure, "SKILL.md"), "# Measure\n");
      writeFileSync(resolve(next, "SKILL.md"), "# Next\n");
      writeFileSync(resolve(react, "SKILL.md"), "# React\n");
      writeFileSync(resolve(composition, "SKILL.md"), "# Composition\n");
      writeFileSync(resolve(graph, "SKILL.md"), "# Graph\n");

      const { executionIdentityFingerprint, resolveExecutionIdentity, validateExecutionIdentity } = await import("../../execution-identity");
      const input = {
        runId: "meta-executor-identity",
        arm: "b" as const,
        mode: "agent" as const,
        imageReference: `docker.io/library/node@sha256:${"a".repeat(64)}`,
        opencodePath: opencode,
        modelRef: "opencode-go/meta/executor",
        configPath: config,
        entryPath: entry,
        rgPath: rg,
        skillRoots: { measure, "next-best-practices": next, "vercel-react-best-practices": react, "vercel-composition-patterns": composition, "build-graph": graph },
        runtimeFlags: ["--read-only", "--network=slirp4netns:allow_host_loopback=false"],
        cliFlags: ["run", "--standalone", "--format", "json", "--auto", "--model", "opencode-go/meta/executor"],
      };
      const identity = resolveExecutionIdentity(input);

      expect(identity).toMatchObject({
        schema: 2,
        kind: "opencode",
        run_id: input.runId,
        arm: "b",
        image_reference: input.imageReference,
        image_identity: "a".repeat(64),
        opencode: { path: opencode, version: "opencode v2.0.32", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
        model_ref: "opencode-go/meta/executor",
        variant: null,
        config_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        entry_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        helpers: { rg: { path: rg, version: "ripgrep 15.1.0", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) } },
        skills: {
          measure: expect.stringMatching(/^[a-f0-9]{64}$/),
          "next-best-practices": expect.stringMatching(/^[a-f0-9]{64}$/),
          "vercel-react-best-practices": expect.stringMatching(/^[a-f0-9]{64}$/),
          "vercel-composition-patterns": expect.stringMatching(/^[a-f0-9]{64}$/),
          "build-graph": expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        skill_tree_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        runtime_flags: input.runtimeFlags,
        runtime_flags_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        cli_flags: input.cliFlags,
        cli_flags_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        credential: { integration: "opencode", method: "oauth", refresh_token_delivered: false },
      });
      expect(validateExecutionIdentity(identity, { runId: input.runId, arm: "b", mode: "agent" })).toEqual([]);
      expect(executionIdentityFingerprint(identity)).toMatch(/^[a-f0-9]{64}$/);

      const differentFlags = resolveExecutionIdentity({ ...input, cliFlags: [...input.cliFlags, "--thinking", "max"] });
      expect(differentFlags.cli_flags_sha256).not.toBe(identity.cli_flags_sha256);
      expect(executionIdentityFingerprint(differentFlags)).not.toBe(executionIdentityFingerprint(identity));
      writeFileSync(resolve(measure, "extra.md"), "this changes the mounted skill tree\n");
      const differentSkills = resolveExecutionIdentity(input);
      expect(differentSkills.skills.measure).not.toBe(identity.skills.measure);
      expect(differentSkills.skill_tree_sha256).not.toBe(identity.skill_tree_sha256);
      expect(executionIdentityFingerprint(differentSkills)).not.toBe(executionIdentityFingerprint(identity));
      expect(validateExecutionIdentity({ ...identity, run_id: "other-run" }, { runId: input.runId, arm: "b", mode: "agent" })).not.toEqual([]);
      expect(validateExecutionIdentity({ ...identity, image_reference: "docker.io/library/node:latest" }, { runId: input.runId, arm: "b", mode: "agent" })).not.toEqual([]);
      expect(validateExecutionIdentity({ ...identity, opencode: { ...identity.opencode, sha256: "" } }, { runId: input.runId, arm: "b", mode: "agent" })).not.toEqual([]);
      expect(validateExecutionIdentity({ ...identity, skills: {}, skill_tree_sha256: "" }, { runId: input.runId, arm: "b", mode: "agent" })).not.toEqual([]);
      expect(validateExecutionIdentity({ ...identity, skills: { ...identity.skills, "build-graph": "" } }, { runId: input.runId, arm: "b", mode: "agent" })).not.toEqual([]);
      expect(validateExecutionIdentity({ ...identity, skills: { ...identity.skills, unexpected: "0".repeat(64) } }, { runId: input.runId, arm: "b", mode: "agent" })).not.toEqual([]);
      expect(validateExecutionIdentity({ ...identity, runtime_flags_sha256: "" }, { runId: input.runId, arm: "b", mode: "agent" })).not.toEqual([]);
      expect(validateExecutionIdentity({ ...identity, runtime_flags: [...identity.runtime_flags, "--unsafe"] }, { runId: input.runId, arm: "b", mode: "agent" })).not.toEqual([]);
      expect(validateExecutionIdentity({ ...identity, cli_flags_sha256: "" }, { runId: input.runId, arm: "b", mode: "agent" })).not.toEqual([]);
      expect(validateExecutionIdentity({ ...identity, cli_flags: [...identity.cli_flags, "--no-session"] }, { runId: input.runId, arm: "b", mode: "agent" })).not.toEqual([]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, 15_000);
});
