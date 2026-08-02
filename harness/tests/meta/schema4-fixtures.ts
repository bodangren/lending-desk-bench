import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assessCandidateContract } from "../../candidate-contract";
import { ARM_B_SKILLS, executionIdentityFingerprint, resolveExecutionIdentity } from "../../execution-identity";
import { currentHashes } from "../../provenance";

type Arm = "a" | "b";
type Mode = "agent" | "overlay";
const IMAGE = "docker.io/library/node@sha256:" + "a".repeat(64);
const COHORT_ID = "executor-cohort-schema4-test";

export type CurrentAgentRuntime = {
  imageReference: string;
  piPath: string;
  skillRoots: Partial<Record<(typeof ARM_B_SKILLS)[number], string>>;
  runtimeFlags: string[];
  cliFlags: string[];
  environment: NodeJS.ProcessEnv;
};

/** Creates the inspectable executor inputs used by a schema-4 agent fixture. */
export function createCurrentAgentRuntime({ root, arm, model }: { root: string; arm: Arm; model: string }): CurrentAgentRuntime {
  const executorRoot = resolve(root, "live-executor");
  const piRoot = resolve(executorRoot, "pi");
  const piPath = resolve(piRoot, "bin", "pi");
  mkdirSync(resolve(piRoot, "bin"), { recursive: true });
  writeFileSync(piPath, "#!/usr/bin/env sh\necho schema4-test-pi 1.0.0\n");
  chmodSync(piPath, 0o755);

  const skillRoot = resolve(executorRoot, "skills");
  const skillRoots = Object.fromEntries((arm === "b" ? ARM_B_SKILLS : []).map((skill) => {
    const skillPath = resolve(skillRoot, skill);
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(resolve(skillPath, "SKILL.md"), "# " + skill + "\n");
    return [skill, skillPath];
  })) as CurrentAgentRuntime["skillRoots"];
  const runtimeFlags = ["--read-only", "--network=slirp4netns:allow_host_loopback=false"];
  const cliFlags = ["--provider", "local", "--model", model, "--thinking", "xhigh"];
  return {
    imageReference: IMAGE,
    piPath,
    skillRoots,
    runtimeFlags,
    cliFlags,
    environment: {
      BENCH_AGENT_IMAGE: IMAGE,
      BENCH_PI_ROOT: piRoot,
      BENCH_SKILL_ROOT: skillRoot,
      BENCH_EXECUTOR_RUNTIME_FLAGS: JSON.stringify(runtimeFlags),
      BENCH_EXECUTOR_CLI_FLAGS: JSON.stringify(cliFlags),
    },
  };
}

export function currentSchema4Provenance({
  fixture,
  candidate,
  runId,
  model,
  arm,
  mode = "agent",
  live,
}: {
  fixture: string;
  candidate: string;
  runId: string;
  model: string;
  arm: Arm;
  mode?: Mode;
  live?: CurrentAgentRuntime;
}) {
  const contract = assessCandidateContract(fixture, candidate);
  if (!contract.valid) throw new Error("fixture candidate contract failed: " + contract.reasons.join("; "));
  const hashes = currentHashes();
  const executor = mode === "overlay"
    ? resolveExecutionIdentity({ runId, arm, mode })
    : (() => {
        if (!live) throw new Error("current schema-4 agent provenance requires live executor inputs");
        return resolveExecutionIdentity({
          runId,
          arm,
          imageReference: live.imageReference,
          piPath: live.piPath,
          skillRoots: live.skillRoots,
          runtimeFlags: live.runtimeFlags,
          cliFlags: live.cliFlags,
        });
      })();
  const executorCohort = "kind" in executor
    ? { schema: 1, id: COHORT_ID, kind: "not-invoked", arms: {} }
    : {
        schema: 1,
        id: COHORT_ID,
        image_reference: executor.image_reference,
        image_identity: executor.image_identity,
        pi: executor.pi,
        runtime_flags: executor.runtime_flags,
        cli_flags: executor.cli_flags,
        arms: { [arm]: { skills: executor.skills, skill_tree_sha256: executor.skill_tree_sha256 } },
      };
  return {
    schema: 4,
    run_id: runId,
    arm,
    model,
    mode,
    candidate_sha256: contract.candidate_sha256,
    fixture_protected_sha256: contract.fixture_protected_sha256,
    runner_sha256: hashes.runner_sha256,
    suite_sha256: hashes.suite_sha256,
    agent_isolated: mode === "agent",
    candidate_contract_schema: 1,
    cohort_id: executorCohort.id,
    executor_cohort: executorCohort,
    executor,
    execution_identity_sha256: executionIdentityFingerprint(executor),
  };
}
