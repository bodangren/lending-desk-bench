import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createFakeOpencode, TEST_MODEL } from "./schema4-fixtures";

export const ROOT = resolve(import.meta.dirname, "../../..");
export const HARNESS = resolve(ROOT, "harness");
export const IMAGE = "docker.io/library/node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3";
export const SKILLS = ["measure", "next-best-practices", "vercel-react-best-practices", "vercel-composition-patterns", "build-graph"];

export function jsonIfPresent(path: string): any {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

/** A catalog state of the fake binary. The default is catalog-present. */
export type ExecutorCatalog = "present" | "missing" | "missing-provider";

export type ExecutorFixtureOptions = {
  /** The model the fixture runs. Defaults to TEST_MODEL. */
  model?: string;
  /** The catalog state of the fake binary. A missing-model case is explicit. */
  catalog?: ExecutorCatalog;
  /** Full control of the local API data array. Defaults to one active row. */
  apiData?: unknown[];
};

function catalogEntry(model: string): string {
  return `"${model}":{"id":"${model}","name":"${model}","limit":{"context":1000000,"input":1000000,"output":65536}}`;
}

/**
 * The fake-binary catalog object, per spec D2. The fake binary stays an
 * executable script; the catalog object rides in one comment line, so the
 * bytes carry a provider-scoped models map in the shape of the installed
 * catalog: {"<provider>":{"models":{"<model>":{"id":...},...}}}.
 */
export function catalogComment(mode: ExecutorCatalog, provider: string, model: string): string {
  let catalog: string;
  if (mode === "present") catalog = `{"${provider}":{"models":{${catalogEntry(model)}}}}`;
  else if (mode === "missing") catalog = `{"${provider}":{"models":{"unrelated-model":{"id":"unrelated-model"}}}}`;
  else catalog = `{"other-provider":{"models":{${catalogEntry(model)}}}}`;
  return `\n// EXECUTOR_CATALOG ${catalog}\n`;
}

export function activeApiRow(provider: string, model: string): Record<string, unknown> {
  return {
    id: `id-${model}`,
    modelID: model,
    providerID: provider,
    type: "language",
    name: `${model} Name`,
    limit: { context: 1000000, input: 1000000, output: 65536 },
    enabled: true,
    status: "active",
  };
}

/** Runs the real runner with canaries and a Podman recorder. No container starts. */
export function prepareOpencodeRun(arm: "a" | "b", opts: ExecutorFixtureOptions = {}) {
  mkdirSync("/tmp/opencode", { recursive: true });
  const temp = mkdtempSync("/tmp/opencode/executor-red-");
  const fake = createFakeOpencode(temp);
  const model = opts.model ?? TEST_MODEL;
  const provider = "opencode-go";
  // D9: the default fake binary is catalog-present for the run model, so the
  // route stays off unless the case asks for a miss. The comment keeps the
  // fake executable; the bytes also satisfy the legacy global needle.
  appendFileSync(fake.path, catalogComment(opts.catalog ?? "present", provider, model));
  // FR3: a local API seam is the default. No fixture run touches the real API.
  const apiFile = resolve(temp, "model-api.json");
  writeFileSync(apiFile, JSON.stringify({
    location: { directory: "fake" },
    data: opts.apiData ?? [activeApiRow(provider, model)],
  }));
  const id = `meta-opencode-${arm}-${process.pid}-${Date.now()}`;
  const work = resolve(ROOT, "runs", id);
  const out = resolve(work, "artifacts");
  const podmanCapture = resolve(temp, "podman.json");
  const podmanControl = resolve(temp, "podman-control.json");
  writeFileSync(podmanControl, JSON.stringify({ mode: "entry" }));
  const opencodeHit = resolve(temp, "OPENCODE-HIT");
  const runtime = resolve(temp, "runtime");
  const skillRoot = resolve(temp, "skills");
  mkdirSync(runtime);
  mkdirSync(resolve(temp, "home"));
  for (const skill of SKILLS) {
    mkdirSync(resolve(skillRoot, skill), { recursive: true });
    writeFileSync(resolve(skillRoot, skill, "SKILL.md"), `# ${skill}\n`);
  }
  // OpenCode tripwire: a PATH-resolved opencode proves the runner resolves the
  // binary from BENCH_OPENCODE_BIN and never falls back to PATH.
  const tripwireBin = resolve(temp, "tripwire-bin");
  mkdirSync(tripwireBin, { recursive: true });
  const tripwire = resolve(tripwireBin, "opencode");
  writeFileSync(tripwire, `#!${process.execPath}
require("node:fs").writeFileSync(${JSON.stringify(opencodeHit)}, "hit");
if (process.argv[2] === "--version") console.log("opencode tripwire 0.0.0");
else process.exitCode = 97;
`);
  chmodSync(tripwire, 0o755);
  const podman = resolve(temp, "bin", "podman");
  writeFileSync(podman, `#!${process.execPath}
const fs = require("node:fs"), crypto = require("node:crypto");
const stdin = fs.readFileSync(0), argv = process.argv.slice(2);
const control = JSON.parse(fs.readFileSync(${JSON.stringify(podmanControl)},"utf8"));
const mounts = argv.flatMap((arg,i) => arg === "--mount" ? [Object.fromEntries(argv[i+1].split(",").map(part => part.split("=")))] : []);
const candidate = mounts.find(mount => mount.dst === "/workspace")?.src;
const out = candidate ? require("node:path").resolve(candidate,"../artifacts") : ${JSON.stringify(out)};
const staging = fs.readdirSync(${JSON.stringify(runtime)});
const record = {argv,
  env: Object.entries(process.env).map(([k,v]) => k+"="+v).sort(),
  stdin_sha256: crypto.createHash("sha256").update(stdin).digest("hex"),
  agents_exists: fs.existsSync(candidate+"/AGENTS.md"), staging, candidate};
fs.writeFileSync(${JSON.stringify(podmanCapture)}, JSON.stringify(record));
fs.appendFileSync(${JSON.stringify(resolve(temp, "podman-calls.jsonl"))},JSON.stringify(record)+"\\n");
fs.writeFileSync(${JSON.stringify(resolve(temp, "stdin-payload"))},stdin);
fs.writeFileSync(${JSON.stringify(resolve(temp, "podman-started"))},"started");
if(control.mode !== "entry") {
  if(control.mode === "leak") {
    fs.mkdirSync(out+"/executor",{recursive:true});
    fs.writeFileSync(out+"/executor/session-export.json",JSON.stringify({info:{tokens:{output:211}},messages:[{text:"CANARY-ACCESS-1 CANARY-REFRESH-1 org_CANARY1"}]}));
    fs.appendFileSync(candidate+"/src/lib/loans.ts","\\n// CANARY-ACCESS-1 CANARY-REFRESH-1 org_CANARY1\\n");
    console.log("CANARY-ACCESS-1 CANARY-REFRESH-1 org_CANARY1");
    console.error("CANARY-ACCESS-1 CANARY-REFRESH-1 org_CANARY1");
  }
  if(control.mode === "hold") setTimeout(()=>{},60000);
  else process.exitCode = control.mode === "failure" ? 17 : control.mode === "timeout" ? 124 : 0;
} else {
const entry = mounts.find(mount => mount.dst === "/entry/opencode-entry.sh");
if (!entry) process.exitCode = 97;
else {
  // Translate the container paths only. Run the actual mounted entry script.
  const privateRoot = ${JSON.stringify(resolve(temp, "container"))};
  fs.mkdirSync(privateRoot, {recursive:true});
  const paths = mounts.map(mount => [mount.dst,mount.src]).concat([["/run/opencode",privateRoot+"/run/opencode"],["/tmp",privateRoot+"/tmp"]]).sort((a,b) => b[0].length-a[0].length);
  const pathPattern = new RegExp(paths.map(([from]) => from.replaceAll(".","[.]")).join("|"),"g");
  const translate = text => text.replace(pathPattern,match => paths.find(([from]) => from === match)[1]);
  const env = {PATH:${JSON.stringify(`${resolve(temp, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`)}};
  argv.forEach((arg,i) => { if(arg === "--env") { const value=argv[i+1],eq=value.indexOf("="); if(eq !== -1) env[value.slice(0,eq)]=translate(value.slice(eq+1)); } });
  const script = privateRoot+"/entry.sh";
  fs.writeFileSync(script,translate(fs.readFileSync(entry.src,"utf8")));
  const child = require("node:child_process").spawnSync("/bin/bash",[script],{cwd:candidate,env,input:stdin,timeout:10000,maxBuffer:8*1024*1024});
  if(child.stdout) process.stdout.write(child.stdout);
  if(child.stderr) process.stderr.write(child.stderr);
  process.exitCode = child.status === null ? 97 : child.status;
}
}
`);
  chmodSync(podman, 0o755);
  // Start from an explicit environment. Never read a host credential or .env file.
  const env = {
    PATH: `${tripwireBin}:${resolve(temp, "bin")}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: resolve(temp, "home"), LANG: "C.UTF-8", _BENCH_ENV_LOADED: "1",
    BENCH_TRACK: "build", BENCH_IGNORE_LOAD: "1", BENCH_WAIT_FOR_IDLE: "0",
    BENCH_OPENCODE_BIN: fake.path, BENCH_SKILL_ROOT: skillRoot,
    BENCH_AGENT_IMAGE: IMAGE, XDG_RUNTIME_DIR: runtime, AGENT_TIMEOUT: "2",
    BENCH_MODEL_API_BASE: apiFile,
    // Quiet the busy-host preflight so failure-path stderr is deterministic.
    // The thresholds make any host read as quiet; the "host ok" line goes to
    // stdout and never names a credential, so no assertion can match it.
    MAX_LOAD_PER_CPU: "1000000", MIN_AVAIL_MB: "0", MAX_SWAP_USED_MB: "100000000",
    // A canary exercises the old API-key forwarding path without a real credential.
    OPENCODE_API_KEY: "CANARY-ACCESS-99", THINKING: "xhigh",
  };
  return {
    arm, temp, fake, id, work, out, runtime, skillRoot, opencodeHit, podmanCapture, podmanControl, env,
    model, apiFile,
    execute(execModel: string = model) { return spawnSync(resolve(HARNESS, "run.sh"), [provider, execModel, arm, id], {
      cwd: HARNESS, env, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    }); },
    start(execModel: string = model) { return spawn(resolve(HARNESS, "run.sh"), [provider, execModel, arm, id], {
      cwd: HARNESS, env, detached: true, stdio: "ignore",
    }); },
    cleanup() { rmSync(work, { recursive: true, force: true }); rmSync(temp, { recursive: true, force: true }); },
  };
}

/** Runs the prepared fixture without changing the existing capture contract. */
export function captureOpencodeRun(arm: "a" | "b") {
  const fixture = prepareOpencodeRun(arm);
  const result = fixture.execute();
  return { ...fixture, result, podman: jsonIfPresent(fixture.podmanCapture) };
}
