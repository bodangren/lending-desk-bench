import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureOpencodeRun, jsonIfPresent, SKILLS } from "./opencode-run-fixtures";
import { hash, makeRecordedWorkspace, recordedPlan, recordedProbe } from "./opencode-recorded-fixtures";

type Workspace = Awaited<ReturnType<typeof makeRecordedWorkspace>>;
let workspace: Workspace;
let baselinePlan: ReturnType<typeof recordedPlan>;
let baselineProbe: ReturnType<typeof recordedProbe>;
let adversaries: [string,string,string][];

function parsed(result: ReturnType<typeof recordedPlan>) {
  expect(result.error, "the absolute Node and tsx paths must start the production check").toBeUndefined();
  expect(result.status, String(result.stderr)).toBe(0);
  return JSON.parse(String(result.stdout));
}

function nonVacuous(plan: any, probe: any) {
  expect.soft(new Set(plan.classifications.map((row: any)=>row.class)), "the matrix must contain new, failing, and current rows").toEqual(new Set(["new","failing","current"]));
  expect.soft(plan.classifications.find((row: any)=>row.track === "build" && row.arm === "b" && row.model === "matrix-current")?.class,
    "the recorded OpenCode snapshot must make the current control current").toBe("current");
  expect.soft(probe.attestation.eligible, "the recorded executor must attest without a live executor").toBe(true);
  expect.soft(probe.freshness, "the matrix control must be trusted before environment changes").toMatchObject({state:"TRUSTED",rankable:true});
}

describe("OpenCode recorded executor and environment matrix", () => {
  beforeAll(async()=>{
    workspace = await makeRecordedWorkspace();
    baselinePlan = recordedPlan(workspace); baselineProbe = recordedProbe(workspace);
    const changedSkills = resolve(workspace.root,"changed-skills");
    cpSync(workspace.sourceSkills,changedSkills,{recursive:true});
    writeFileSync(resolve(changedSkills,"measure/SKILL.md"),"# Changed source\n");
    const home = resolve(workspace.root,"changed-home");
    mkdirSync(resolve(home,".agents"),{recursive:true}); cpSync(changedSkills,resolve(home,".agents/skills"),{recursive:true});
    const fakePiRoot = resolve(workspace.root,"other-pi"), bin = resolve(fakePiRoot,"bin"); mkdirSync(bin,{recursive:true});
    for (const name of ["pi","opencode"]) {
      const path = resolve(bin,name);
      writeFileSync(path,`#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(resolve(workspace.root,"LIVE-HIT"))},"hit"); console.log(${JSON.stringify(name === "pi" ? "pi 9.99.0" : "opencode v2.99.0")});\n`);
      chmodSync(path,0o755);
    }
    const missing = resolve(workspace.root,"missing");
    adversaries = [
      ["BENCH_SKILL_ROOT","missing",missing],["BENCH_SKILL_ROOT","changed",changedSkills],
      ["BENCH_AGENT_IMAGE","another digest","docker.io/library/node@sha256:"+"b".repeat(64)],
      ["BENCH_EXECUTOR_RUNTIME_FLAGS","empty","[]"],["BENCH_EXECUTOR_RUNTIME_FLAGS","privileged",'["--privileged"]'],["BENCH_EXECUTOR_RUNTIME_FLAGS","invalid JSON","not-json"],
      ["BENCH_EXECUTOR_CLI_FLAGS","empty","[]"],["BENCH_EXECUTOR_CLI_FLAGS","thinking max",'["--thinking","max"]'],["BENCH_EXECUTOR_CLI_FLAGS","invalid JSON","not-json"],
      ["BENCH_OPENCODE_BIN","missing",missing],["BENCH_OPENCODE_BIN","other version",resolve(bin,"opencode")],
      ["BENCH_PI_ROOT","missing",missing],["BENCH_PI_ROOT","fake Pi",fakePiRoot],
      ["HOME","missing",missing],["HOME","ambient skills",home],["PATH","fake executors first",bin+":/usr/bin:/bin"],
    ];
  },60_000);
  afterAll(()=>workspace?.cleanup());

  it("the provenance writer emits schema 7 and preserves the complete recorded identity",()=>{
    expect(workspace.current.written.schema, "the provenance writer must advance from schema 6 to schema 7").toBe(7);
    expect(workspace.current.written.executor).toEqual(workspace.current.identity);
    expect(workspace.current.written.execution_identity_sha256).toBe(workspace.current.provenance.execution_identity_sha256);
  });

  it("the runner records identity schema 2, all OpenCode evidence, and only the credential descriptor",()=>{
    const run = captureOpencodeRun("b");
    try {
      const provenance = jsonIfPresent(resolve(run.out,"provenance.json"));
      expect.soft(provenance?.schema, "a new agent run must record schema 7").toBe(7);
      expect.soft(provenance?.executor, "the runner must record the OpenCode identity and the access-only credential descriptor").toMatchObject({
        schema:2,kind:"opencode",run_id:run.id,arm:"b",opencode:{path:run.fake.path,version:"opencode v2.0.32",sha256:hash(readFileSync(run.fake.path))},
        model_ref:"opencode-go/beam-free",variant:null,config_sha256:expect.stringMatching(/^[a-f0-9]{64}$/),entry_sha256:expect.stringMatching(/^[a-f0-9]{64}$/),
        helpers:{rg:{path:expect.any(String),sha256:expect.stringMatching(/^[a-f0-9]{64}$/),version:"15.1.0"}},
        credential:{integration:"opencode",method:"oauth",refresh_token_delivered:false},
      });
      expect.soft(provenance?.executor?.credential).toEqual({integration:"opencode",method:"oauth",refresh_token_delivered:false});
      expect(JSON.stringify(provenance), "provenance must contain no organization ID").not.toMatch(/orgID|org_CANARY/);
    } finally { run.cleanup(); }
  },30_000);

  it("the recorded snapshot control has new, failing, and current rows and trusted freshness",()=>{
    nonVacuous(parsed(baselinePlan),parsed(baselineProbe));
    expect(readdirSync(resolve(workspace.current.artifacts,"executor/skills")).sort()).toEqual([...SKILLS].sort());
  });

  it("an OpenCode upgrade at the recorded path preserves attestation and freshness",()=>{
    const before = parsed(recordedProbe(workspace)), path = workspace.fake.path, bytes = readFileSync(path);
    try {
      expect.soft(before.attestation.eligible, "the upgrade control must attest before the upgrade").toBe(true);
      expect.soft(before.freshness.state).toBe("TRUSTED");
      writeFileSync(path,`#!${process.execPath}\nconsole.log("opencode v2.99.0");\n`);
      expect(hash(readFileSync(path)), "the fake upgrade must change the binary bytes").not.toBe(hash(bytes));
      expect(parsed(recordedProbe(workspace)), "a live upgrade must not change a recorded verdict").toEqual(before);
    } finally { writeFileSync(path,bytes); }
  });

  for (const kind of ["config","skill"] as const) {
    it(`a changed ${kind} snapshot makes the recorded run invalid`,()=>{
      const path = kind === "config" ? workspace.current.configPath : resolve(workspace.current.artifacts,"executor/skills/measure/SKILL.md");
      const bytes = readFileSync(path), before = parsed(recordedProbe(workspace));
      try {
        expect.soft(before.attestation.eligible, "the unchanged snapshot must attest first").toBe(true);
        writeFileSync(path,kind === "config" ? '{"model":"opencode-go/changed"}\n' : "# Changed snapshot\n");
        const after = parsed(recordedProbe(workspace));
        expect.soft(after.attestation.eligible, "a corrupted snapshot must fail attestation").toBe(false);
        expect.soft(after.freshness.rankable).toBe(false);
        expect([...after.attestation.reasons,...after.freshness.reasons].join(" "), "the verdict must identify the changed snapshot").toMatch(kind === "config" ? /config|snapshot/i : /skill|snapshot/i);
      } finally { writeFileSync(path,bytes); }
    });
  }

  it("O5 keeps exactly five snapshot skills and ignores later changes to their source folders",()=>{
    const before = parsed(recordedProbe(workspace)), path = resolve(workspace.sourceSkills,"measure/SKILL.md"), bytes = readFileSync(path);
    try {
      expect.soft(before.attestation.eligible, "the snapshot must attest before source drift").toBe(true);
      expect(Object.keys(workspace.current.identity.skills).sort()).toEqual([...SKILLS].sort());
      expect(readdirSync(resolve(workspace.current.artifacts,"executor/skills")).sort()).toEqual([...SKILLS].sort());
      writeFileSync(path,"# Source changed after the run\n");
      expect(parsed(recordedProbe(workspace,{BENCH_SKILL_ROOT:workspace.sourceSkills})), "source drift must not change recorded attestation or freshness").toEqual(before);
    } finally { writeFileSync(path,bytes); }
  });

  it("the matrix sensitivity control changes classification after snapshot corruption",()=>{
    const before = parsed(recordedPlan(workspace)), path = workspace.current.configPath, bytes = readFileSync(path);
    try {
      expect.soft(before.classifications.find((row: any)=>row.track === "build" && row.arm === "b" && row.model === "matrix-current")?.class, "the sensitivity control starts current").toBe("current");
      writeFileSync(path,'{"model":"opencode-go/corrupt"}\n');
      const after = recordedPlan(workspace);
      expect(Buffer.from(String(after.stdout)), "corrupting a recorded snapshot must change the work list").not.toEqual(Buffer.from(String(baselinePlan.stdout)));
      expect(parsed(after).classifications.find((row: any)=>row.track === "build" && row.arm === "b" && row.model === "matrix-current")?.class).toBe("failing");
    } finally { writeFileSync(path,bytes); }
  });

  const cases = ["BENCH_SKILL_ROOT missing","BENCH_SKILL_ROOT changed","BENCH_AGENT_IMAGE another digest","BENCH_EXECUTOR_RUNTIME_FLAGS empty","BENCH_EXECUTOR_RUNTIME_FLAGS privileged","BENCH_EXECUTOR_RUNTIME_FLAGS invalid JSON","BENCH_EXECUTOR_CLI_FLAGS empty","BENCH_EXECUTOR_CLI_FLAGS thinking max","BENCH_EXECUTOR_CLI_FLAGS invalid JSON","BENCH_OPENCODE_BIN missing","BENCH_OPENCODE_BIN other version","BENCH_PI_ROOT missing","BENCH_PI_ROOT fake Pi","HOME missing","HOME ambient skills","PATH fake executors first"];
  for (const [index,label] of cases.entries()) {
    it(`classification and freshness ignore ${label}`,()=>{
      const [name,,value] = adversaries[index];
      expect(`${name} ${adversaries[index][1]}`).toBe(label);
      const beforePlan = parsed(baselinePlan), beforeProbe = parsed(baselineProbe);
      const changedPlan = recordedPlan(workspace,{[name]:value}), changedProbe = recordedProbe(workspace,{[name]:value});
      nonVacuous(beforePlan,beforeProbe);
      expect.soft(Buffer.from(String(changedPlan.stdout)), "one byte of work-list difference violates FR-6").toEqual(Buffer.from(String(baselinePlan.stdout)));
      expect.soft(parsed(changedProbe), "the complete freshness and attestation verdicts must ignore the ambient value").toEqual(beforeProbe);
      expect(existsSync(resolve(workspace.root,"LIVE-HIT")), "attestation must never execute a live binary").toBe(false);
    },60_000);
  }
});
