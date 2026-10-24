import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { assessCandidateContract } from "../../candidate-contract";
import { executionIdentityFingerprint } from "../../execution-identity";
import { buildProvenance } from "../../provenance-record";
import { buildScoreRecord } from "../../score";
import { ADVISORY, CRITERIA, PROBES } from "../criteria";
import { createFakeOpencode } from "./schema4-fixtures";
import { HARNESS, IMAGE, ROOT, SKILLS } from "./opencode-run-fixtures";

export const MATRIX_VARIABLES = ["BENCH_SKILL_ROOT","BENCH_AGENT_IMAGE","BENCH_EXECUTOR_RUNTIME_FLAGS","BENCH_EXECUTOR_CLI_FLAGS","BENCH_OPENCODE_BIN","BENCH_PI_ROOT","HOME","PATH"];
export const NODE = process.execPath;
export const TSX = realpathSync(resolve(HARNESS,"node_modules/.bin/tsx"));
export const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export const writeJson = (path: string, value: unknown) => writeFileSync(path,JSON.stringify(value,null,2)+"\n");

/** Matches the recorded tree hash without resolving a live skill source. */
function skillHash(id: string) { return hash(`${hash(`# ${id}\n`)}  SKILL.md\n`); }

/** Makes schema-7 input records with real candidate bindings and local snapshots. */
export async function makeRecordedWorkspace() {
  mkdirSync("/tmp/opencode",{recursive:true});
  const root = mkdtempSync("/tmp/opencode/recorded-red-"), runs = resolve(root,"runs");
  mkdirSync(runs);
  const fake = createFakeOpencode(resolve(root,"recorded-binary"));
  const sourceSkills = resolve(root,"source-skills");
  for (const skill of SKILLS) { mkdirSync(resolve(sourceSkills,skill),{recursive:true}); writeFileSync(resolve(sourceSkills,skill,"SKILL.md"),`# ${skill}\n`); }
  const pricing = resolve(root,"go-pricing.json");
  writeJson(pricing,{schema:1,provider:"opencode-go",aliases:{},apis:{"openai-completions":{baseUrl:"https://example.invalid"}},models:Object.fromEntries(["matrix-new","matrix-failing","matrix-current"].map(model=>[model,{name:model,api:"openai-completions",high_usage:true,batch:true,requests_per_month:10000,monthly_usage_usd:15,rates:{input:0.1,output:0.2,cacheRead:0,cacheWrite:0}}]))});
  const environment: NodeJS.ProcessEnv = {PATH:"/usr/bin:/bin",HOME:resolve(root,"clean-home"),BENCH_TRACK:"build",REPS:"1"};
  mkdirSync(environment.HOME!);
  const saved = {...process.env};
  const records: any[] = [];
  try {
    for (const name of MATRIX_VARIABLES) delete process.env[name];
    Object.assign(process.env,environment);
    for (const [model,trusted] of [["matrix-failing",false],["matrix-current",true]] as const) {
      const id = `b-${model}-2099w01-r1`, work = resolve(runs,id), artifacts = resolve(work,"artifacts"), candidate = resolve(work,"candidate");
      mkdirSync(resolve(artifacts,"executor"),{recursive:true});
      cpSync(resolve(ROOT,"fixture"),candidate,{recursive:true,filter:source=>!["node_modules",".git",".next"].includes(basename(source))&&!source.endsWith(".tsbuildinfo")});
      cpSync(sourceSkills,resolve(artifacts,"executor/skills"),{recursive:true});
      const configPath = resolve(artifacts,"executor/opencode.json");
      writeJson(configPath,{$schema:"https://opencode.ai/config.json",model:`opencode-go/${model}`,skills:{paths:["/opt/skills"]},instructions:["/workspace/AGENTS.md"],permissions:[
        ...["question","websearch","subagent"].map(action=>({action,resource:"*",effect:"deny"})),
        ...["read","edit"].map(action=>({action,resource:"/tmp/data/**",effect:"deny"})),
        {action:"skill",resource:"*",effect:"deny"},...SKILLS.map(resource=>({action:"skill",resource,effect:"allow"})),
      ]});
      const rg = resolve(artifacts,"rg"), entry = resolve(artifacts,"executor/entry.sh");
      writeFileSync(rg,"#!/bin/sh\necho ripgrep 15.1.0\n"); chmodSync(rg,0o755);
      writeFileSync(entry,"#!/bin/sh\nexit 0\n");
      const runtimeFlags = ["run","--rm","-i","--pull=never","--read-only"], cliFlags = ["run","--standalone","--format","json","--auto","--model",`opencode-go/${model}`,"prompt"];
      const skillRows = Object.fromEntries(SKILLS.map(id=>[id,skillHash(id)]));
      const identity = {
        schema:2,kind:"opencode",run_id:id,arm:"b",opencode:{path:fake.path,sha256:hash(readFileSync(fake.path)),version:"opencode v2.0.32"},
        image_reference:IMAGE,image_identity:IMAGE.split("@sha256:")[1],model_ref:`opencode-go/${model}`,variant:null,
        config_sha256:hash(readFileSync(configPath)),entry_sha256:hash(readFileSync(entry)),helpers:{rg:{path:rg,sha256:hash(readFileSync(rg)),version:"15.1.0"}},
        skills:skillRows,skill_tree_sha256:hash(JSON.stringify(skillRows)),
        runtime_flags:runtimeFlags,runtime_flags_sha256:hash(JSON.stringify(runtimeFlags)),cli_flags:cliFlags,cli_flags_sha256:hash(JSON.stringify(cliFlags)),
        credential:{integration:"opencode",method:"oauth",refresh_token_delivered:false},
      };
      const cohort = {schema:1,id:"opencode-recorded-red",image_reference:identity.image_reference,image_identity:identity.image_identity,opencode:identity.opencode,
        model_ref:identity.model_ref,variant:identity.variant,config_sha256:identity.config_sha256,entry_sha256:identity.entry_sha256,helpers:identity.helpers,credential:identity.credential,
        runtime_flags:runtimeFlags,cli_flags:cliFlags,arms:{b:{skills:identity.skills,skill_tree_sha256:identity.skill_tree_sha256}}};
      const contract = assessCandidateContract(resolve(ROOT,"fixture"),candidate,{track:"build"});
      writeJson(resolve(artifacts,"candidate-contract.json"),contract);
      writeJson(resolve(artifacts,"execution-identity.json"),identity); writeJson(resolve(artifacts,"executor-cohort.json"),cohort);
      writeJson(resolve(artifacts,"executor/session-export.json"),{info:{id:"matrix",model:{id:model,providerID:"opencode-go"},cost:0,tokens:{input:10,output:20,reasoning:5,cache:{read:0,write:0}}},messages:[]});
      const input = {artifacts,runId:id,arm:"b",model:`opencode-go/${model}`,mode:"agent",track:"build" as const};
      const written = buildProvenance(input);
      const provenance = {...written,schema:7,executor:identity,executor_cohort:cohort,execution_identity_sha256:executionIdentityFingerprint(identity)};
      writeJson(resolve(artifacts,"provenance.json"),provenance);
      writeJson(resolve(artifacts,"gate.json"),{typecheck:true,build:true}); writeJson(resolve(artifacts,"collection.json"),{valid:true,status:"collected"});
      writeJson(resolve(artifacts,"results.json"),Object.fromEntries([...Object.keys(CRITERIA),...Object.keys(PROBES),...ADVISORY].map(id=>[id,false])));
      const score: any = await buildScoreRecord({candidate,artifacts,runId:id,model:`opencode-go/${model}`,arm:"b"});
      if (!trusted) { score.trusted=false; score.publishable=false; score.rankable=false; }
      writeJson(resolve(artifacts,"score.json"),score);
      records.push({id,work,artifacts,candidate,identity,provenance,configPath,scorePath:resolve(artifacts,"score.json"),input,written});
    }
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env,saved);
  }
  return {root,runs,pricing,fake,sourceSkills,environment,records,current:records[1],cleanup(){rmSync(root,{recursive:true,force:true});}};
}

/** Starts Node and tsx by absolute path, with no inherited executor environment. */
export function recordedCommand(workspace: Awaited<ReturnType<typeof makeRecordedWorkspace>>, script: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(NODE,[TSX,resolve(HARNESS,script),...args],{cwd:HARNESS,encoding:"utf8",env:{...workspace.environment,...extra},timeout:30_000,maxBuffer:8*1024*1024});
}

export function recordedPlan(workspace: Awaited<ReturnType<typeof makeRecordedWorkspace>>, extra: NodeJS.ProcessEnv = {}) {
  return recordedCommand(workspace,"plan-work.ts",["--all","--runs-root",workspace.runs,"--pricing",workspace.pricing],extra);
}

export function recordedProbe(workspace: Awaited<ReturnType<typeof makeRecordedWorkspace>>, extra: NodeJS.ProcessEnv = {}) {
  return recordedCommand(workspace,"tests/meta/opencode-recorded-probe.ts",[workspace.current.artifacts],extra);
}
