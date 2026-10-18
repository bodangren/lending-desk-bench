import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { HARNESS, prepareOpencodeRun, ROOT } from "./opencode-run-fixtures";
import { TEST_MODEL } from "./schema4-fixtures";

export type CredentialRun = ReturnType<typeof prepareOpencodeRun>;
export const REASON = "Console credential does not cover the run window";
export const CANARIES = ["CANARY-ACCESS-1", "CANARY-REFRESH-1", "org_CANARY1"];

export function setExports(run: CredentialRun, exports: string[]) {
  writeFileSync(run.fake.control, JSON.stringify({ exports }));
}

export function calls(path: string): any[] {
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
}

export function files(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(root, entry.name);
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : [];
  });
}

/** Returns only file names and labels when a synthetic secret remains. */
export function leakHits(run: CredentialRun, result: { stdout: string | Buffer | null; stderr: string | Buffer | null }, canaries = CANARIES): string[] {
  const samples: [string, string][] = files(run.work).map(path => [path, path.endsWith(".gz") ? gunzipSync(readFileSync(path)).toString() : readFileSync(path, "utf8")]);
  samples.push(["stdout", String(result.stdout)], ["stderr", String(result.stderr)]);
  for (const call of calls(resolve(run.temp, "podman-calls.jsonl"))) samples.push(["argv", JSON.stringify(call.argv)], ["environment", JSON.stringify(call.env)]);
  for (const call of calls(run.fake.capture)) samples.push(["OpenCode argv", JSON.stringify(call.argv)], ["OpenCode environment", JSON.stringify(call.env)]);
  return samples.filter(([,text]) => canaries.some(value => text.includes(value))).map(([label]) => label);
}

/** Copies the actual batch and runner into a private tree. No model or network starts. */
export function prepareCredentialBatch(run: CredentialRun, reps = 1) {
  const root = resolve(run.temp, "batch-root"), harness = resolve(root, "harness");
  mkdirSync(harness, { recursive: true });
  for (const entry of readdirSync(HARNESS, { withFileTypes: true })) {
    if (entry.isFile() && /\.(sh|ts|json|cjs)$/.test(entry.name)) cpSync(resolve(HARNESS, entry.name), resolve(harness, entry.name));
    else if (entry.isDirectory() && ["node_modules", "tests", "bugfix", "tests-track", "change"].includes(entry.name)) symlinkSync(resolve(HARNESS, entry.name), resolve(harness, entry.name), "dir");
  }
  cpSync(resolve(ROOT,"fixture"),resolve(root,"fixture"),{recursive:true,filter:source=>!["node_modules",".next",".git"].includes(basename(source)) && !source.endsWith(".tsbuildinfo")});
  symlinkSync(resolve(ROOT,"fixture/node_modules"),resolve(root,"fixture/node_modules"),"dir");
  for (const name of ["reference", "reference-variant", "reference-change"]) symlinkSync(resolve(ROOT, name), resolve(root, name), "dir");
  const pricing = resolve(harness, "go-pricing.json");
  writeFileSync(pricing, JSON.stringify({ schema: 1, provider: "opencode-go", aliases: {}, apis:{"openai-completions":{baseUrl:"https://example.invalid"}}, models: {
    [TEST_MODEL]: { name: TEST_MODEL, api: "openai-completions", high_usage: true, batch: true, requests_per_month: 10000, monthly_usage_usd: 15,
      rates: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 } },
  } }));
  return {
    root, harness,
    execute() { return spawnSync("/bin/bash", [resolve(harness, "batch.sh")], {
      cwd: harness, encoding: "utf8", timeout: 45_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...run.env, BENCH_PRICING_PATH: pricing, BENCH_SELFCHECK: "skip", BENCH_CANARY: "0", FORCE: "1", ARMS: "a", REPS: String(reps), WEEK: "2099w01" },
    }); },
    runDirectories() { const path = resolve(root, "runs"); return existsSync(path) ? readdirSync(path).filter(name => name !== ".port-locks") : []; },
  };
}
