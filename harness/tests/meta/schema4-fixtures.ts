import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assessCandidateContract, type BenchTrack } from "../../candidate-contract";
import { ARM_B_SKILLS, executionIdentityFingerprint, resolveExecutionIdentity } from "../../execution-identity";
import { currentHashes } from "../../provenance";
import { PROVENANCE_SCHEMA } from "../../provenance-check";
import { FIXTURE_REVISION } from "../../revisions";

export const OPENCODE_FIXTURES = resolve(import.meta.dirname, "fixtures");
export const TEST_MODEL = "beam-free";
export const TEST_SESSION = "session CANARY; one";

const IMAGE = "docker.io/library/node@sha256:" + "a".repeat(64);
const COHORT_ID = "executor-cohort-schema4-test";

type Arm = "a" | "b";
type Mode = "agent" | "overlay";

export type CurrentAgentRuntime = {
  imageReference: string;
  opencodePath: string;
  rgPath: string;
  configPath: string;
  entryPath: string;
  skillRoot: string;
  skillRoots: Partial<Record<(typeof ARM_B_SKILLS)[number], string>>;
  runtimeFlags: string[];
  cliFlags: string[];
  environment: NodeJS.ProcessEnv;
};

/** Creates the inspectable executor inputs a schema-7 agent fixture records. */
export function createCurrentAgentRuntime({ root, arm, model }: { root: string; arm: Arm; model: string }): CurrentAgentRuntime {
  const executorRoot = resolve(root, "live-executor");

  const opencodePath = resolve(executorRoot, "opencode", "bin", "opencode");
  mkdirSync(resolve(executorRoot, "opencode", "bin"), { recursive: true });
  writeFileSync(opencodePath, `#!${process.execPath}
const arg = process.argv[2];
if (arg === "--version") console.log("opencode v2.0.32");
else if (arg === "models") console.log("opencode-go/${model}");
`);
  chmodSync(opencodePath, 0o755);

  const rgPath = resolve(executorRoot, "rg");
  writeFileSync(rgPath, "#!/bin/sh\necho ripgrep 15.1.0\n");
  chmodSync(rgPath, 0o755);

  const configPath = resolve(executorRoot, "opencode.json");
  writeFileSync(configPath, JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    model: `opencode-go/${model}`,
    permissions: [],
  }) + "\n");

  const entryPath = resolve(executorRoot, "opencode-entry.sh");
  writeFileSync(entryPath, "#!/bin/sh\nexit 0\n");

  const skillRoot = resolve(executorRoot, "skills");
  const skillRoots = Object.fromEntries((arm === "b" ? ARM_B_SKILLS : []).map((skill) => {
    const skillPath = resolve(skillRoot, skill);
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(resolve(skillPath, "SKILL.md"), "# " + skill + "\n");
    return [skill, skillPath];
  })) as CurrentAgentRuntime["skillRoots"];

  const runtimeFlags = ["--read-only", "--network=slirp4netns:allow_host_loopback=false"];
  const cliFlags = ["run", "--standalone", "--format", "json", "--auto", "--model", `opencode-go/${model}`];
  return {
    imageReference: IMAGE,
    opencodePath,
    rgPath,
    configPath,
    entryPath,
    skillRoot,
    skillRoots,
    runtimeFlags,
    cliFlags,
    environment: {
      BENCH_AGENT_IMAGE: IMAGE,
      BENCH_OPENCODE_BIN: opencodePath,
      BENCH_SKILL_ROOT: skillRoot,
      BENCH_EXECUTOR_RUNTIME_FLAGS: JSON.stringify(runtimeFlags),
      BENCH_EXECUTOR_CLI_FLAGS: JSON.stringify(cliFlags),
    },
  };
}

/**
 * Makes a schema-7 provenance record with real candidate bindings and the
 * recorded OpenCode identity. When `artifacts` is given for an agent run, the
 * fixture also stages the run's own snapshots (the generated config, the Arm-B
 * skill snapshot, and the session export) so attestation and scoring read the
 * recorded evidence only, never a live executor.
 */
export function currentSchema4Provenance({
  fixture,
  candidate,
  runId,
  model,
  arm,
  mode = "agent",
  live,
  track = "build",
  artifacts,
}: {
  fixture: string;
  candidate: string;
  runId: string;
  model: string;
  arm: Arm;
  mode?: Mode;
  live?: CurrentAgentRuntime;
  track?: BenchTrack;
  artifacts?: string;
}) {
  const contract = assessCandidateContract(fixture, candidate, { track });
  if (!contract.gradeable) throw new Error("fixture candidate contract failed: " + contract.reasons.join("; "));
  const hashes = currentHashes();
  const executor = mode === "overlay"
    ? resolveExecutionIdentity({ runId, arm, mode })
    : (() => {
        if (!live) throw new Error("current schema-7 agent provenance requires recorded executor inputs");
        return resolveExecutionIdentity({
          runId,
          arm,
          mode,
          imageReference: live.imageReference,
          opencodePath: live.opencodePath,
          modelRef: `opencode-go/${model}`,
          configPath: live.configPath,
          entryPath: live.entryPath,
          rgPath: live.rgPath,
          skillRoots: live.skillRoots,
          runtimeFlags: live.runtimeFlags,
          cliFlags: live.cliFlags,
        });
      })();
  const executorCohort = executor.kind === "not-invoked"
    ? { schema: 1, id: COHORT_ID, kind: "not-invoked", arms: {} }
    : {
        schema: 1,
        id: COHORT_ID,
        image_reference: executor.image_reference,
        image_identity: executor.image_identity,
        opencode: executor.opencode,
        model_ref: executor.model_ref,
        variant: executor.variant,
        config_sha256: executor.config_sha256,
        entry_sha256: executor.entry_sha256,
        helpers: executor.helpers,
        credential: executor.credential,
        runtime_flags: executor.runtime_flags,
        cli_flags: executor.cli_flags,
        arms: { [arm]: { skills: executor.skills, skill_tree_sha256: executor.skill_tree_sha256 } },
      };
  if (artifacts && mode === "agent") {
    if (executor.kind === "not-invoked" || !live) throw new Error("agent snapshot staging requires an OpenCode identity");
    const executorDir = resolve(artifacts, "executor");
    mkdirSync(executorDir, { recursive: true });
    writeFileSync(resolve(executorDir, "opencode.json"), readFileSync(live.configPath));
    if (arm === "b") cpSync(live.skillRoot, resolve(executorDir, "skills"), { recursive: true });
    writeFileSync(resolve(executorDir, "session-export.json"), JSON.stringify({
      info: {
        id: runId,
        model: { id: model, providerID: "opencode-go" },
        cost: 0,
        tokens: { input: 12, output: 7, reasoning: 3, cache: { read: 0, write: 0 } },
      },
      messages: [],
    }));
  }
  return {
    schema: PROVENANCE_SCHEMA,
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

/** Creates an offline OpenCode executable with an append-only call record. */
export function createFakeOpencode(root: string) {
  const bin = resolve(root, "bin");
  mkdirSync(bin, { recursive: true });
  const path = resolve(bin, "opencode");
  const capture = resolve(root, "opencode-calls.jsonl");
  const control = resolve(root, "opencode-control.json");
  const auth = [{
    id: "console-canary-1", integrationID: "opencode", label: "Canary", active: true,
    value: {
      type: "oauth", methodID: "device", access: "CANARY-ACCESS-1", refresh: "CANARY-REFRESH-1",
      expires: 4102444800000, metadata: { orgID: "org_CANARY1", server: "https://opencode.ai/console" },
    },
  }];
  writeFileSync(control, JSON.stringify({ exports: [JSON.stringify(auth)] }));
  writeFileSync(path, `#!${process.execPath}
const fs = require("node:fs"), crypto = require("node:crypto");
const argv = process.argv.slice(2);
const stdin = fs.readFileSync(0);
const control = JSON.parse(fs.readFileSync(${JSON.stringify(control)}, "utf8"));
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({argv, env: Object.entries(process.env).map(([k,v]) => k+"="+v).sort(), stdin_sha256: crypto.createHash("sha256").update(stdin).digest("hex")})+"\\n");
if (argv[0] === "--version") console.log("opencode v2.0.32");
else if (argv[0] === "models") console.log("opencode-go/${TEST_MODEL}");
else if (argv[0] === "auth" && argv[1] === "export") {
  const counter = ${JSON.stringify(resolve(root, "export-count"))};
  const count = fs.existsSync(counter) ? Number(fs.readFileSync(counter,"utf8")) : 0;
  fs.writeFileSync(counter, String(count+1));
  console.log(control.exports[Math.min(count,control.exports.length-1)]);
}
else if (argv[0] === "auth" && argv[1] === "list") console.log("opencode Console oauth active");
else if (argv[0] === "auth" && argv[1] === "import") console.log("Imported 1 credential");
else if (argv[0] === "run") process.stdout.write(fs.readFileSync(${JSON.stringify(resolve(OPENCODE_FIXTURES, "opencode-events.jsonl"))}));
else if (argv[0] === "session" && argv[1] === "list") console.log(JSON.stringify([{id:${JSON.stringify(TEST_SESSION)}}]));
else if (argv[0] === "session" && argv[1] === "export") process.stdout.write(fs.readFileSync(${JSON.stringify(resolve(OPENCODE_FIXTURES, "opencode-session-export.json"))}));
else process.exitCode = 96;
`);
  chmodSync(path, 0o755);
  return { path, capture, auth, control };
}
