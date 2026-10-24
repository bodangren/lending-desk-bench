// Legacy schema-6 Pi evidence for the history path (FR-8).
//
// The harness never writes this shape again: provenance-record.ts emits
// schema 7 only, and execution-identity.ts no longer resolves a Pi binary.
// These literals keep a legacy Pi run readable so the harness can label its
// history without ranking it. No function here resolves a live binary,
// image, or skill folder.
import { createHash } from "node:crypto";
import { assessCandidateContract, type BenchTrack } from "../../candidate-contract";
import { ARM_B_SKILLS, executionIdentityFingerprint } from "../../execution-identity";
import { currentHashes } from "../../provenance";
import { FIXTURE_REVISION } from "../../revisions";

type Arm = "a" | "b";
type Mode = "agent" | "overlay";

const IMAGE = "docker.io/library/node@sha256:" + "a".repeat(64);
const COHORT_ID = "executor-cohort-schema4-test";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * A recorded legacy Pi run, verbatim readable. This is the history path: the
 * record labels a Pi run and is never attested eligible or ranked as a Go
 * result under the OpenCode contract.
 */
export function legacyPiProvenance({
  fixture,
  candidate,
  runId,
  model,
  arm,
  mode = "agent",
  track = "build",
}: {
  fixture: string;
  candidate: string;
  runId: string;
  model: string;
  arm: Arm;
  mode?: Mode;
  track?: BenchTrack;
}) {
  const contract = assessCandidateContract(fixture, candidate, { track });
  if (!contract.gradeable) throw new Error("fixture candidate contract failed: " + contract.reasons.join("; "));
  const hashes = currentHashes();
  const pi = { path: "/opt/pi/bin/pi", sha256: sha256("legacy-pi-binary"), version: "pi 0.53.1" };
  const skills: Record<string, string> = arm === "b"
    ? Object.fromEntries(ARM_B_SKILLS.map((skill) => [skill, sha256("legacy-skill-" + skill)]))
    : {};
  const skillTreeSha256 = sha256(JSON.stringify(skills));
  const runtimeFlags = ["--read-only", "--network=slirp4netns:allow_host_loopback=false"];
  const runtimeFlagsSha256 = sha256(JSON.stringify(runtimeFlags));
  const cliFlags = ["/opt/pi/bin/pi", "--print", "--mode", "json", "--no-session"];
  const cliFlagsSha256 = sha256(JSON.stringify(cliFlags));
  const executor = mode === "overlay"
    ? { schema: 1, kind: "not-invoked", run_id: runId, arm, reason: "AGENT_SKIP=1" }
    : {
        schema: 1,
        kind: "pi",
        run_id: runId,
        arm,
        pi,
        image_reference: IMAGE,
        image_identity: IMAGE.split("@sha256:")[1],
        skills,
        skill_tree_sha256: skillTreeSha256,
        runtime_flags: runtimeFlags,
        runtime_flags_sha256: runtimeFlagsSha256,
        cli_flags: cliFlags,
        cli_flags_sha256: cliFlagsSha256,
      };
  const executorCohort = executor.kind === "not-invoked"
    ? { schema: 1, id: COHORT_ID, kind: "not-invoked", arms: {} }
    : {
        schema: 1,
        id: COHORT_ID,
        image_reference: IMAGE,
        image_identity: IMAGE.split("@sha256:")[1],
        pi,
        runtime_flags: runtimeFlags,
        cli_flags: cliFlags,
        arms: { [arm]: { skills, skill_tree_sha256: skillTreeSha256 } },
      };
  return {
    schema: 6,
    track,
    fixture_revision: FIXTURE_REVISION,
    bug_set_id: null,
    bug_set_sha256: null,
    mutant_set_id: null,
    mutant_set_sha256: null,
    change_set_id: null,
    change_set_sha256: null,
    registry_sha256: null,
    variant_sha256: null,
    contract_violation_sha256: null,
    graft: null,
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
    cohort_id: COHORT_ID,
    executor_cohort: executorCohort,
    executor,
    execution_identity_sha256: executionIdentityFingerprint(executor),
  };
}
