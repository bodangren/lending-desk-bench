import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ADVISORY, CRITERIA, PROBES } from "../criteria";
import { createCurrentAgentRuntime, currentSchema4Provenance } from "./schema4-fixtures";
import { freshnessInProcess, scoreInProcess } from "./score-helpers";

const ROOT = resolve(import.meta.dirname, "../../..");
const HARNESS = resolve(ROOT, "harness");
const FIXTURE = resolve(ROOT, "fixture");
const MODEL = "meta/selfcheck-env";
const ARM = "a" as const;

type Json = Record<string, unknown>;

let FAILED = 0;
let PASS_COUNT = 0;
let FAIL_COUNT = 0;
const RESULTS: string[] = [];

function pass(label: string): void {
  PASS_COUNT += 1;
  RESULTS.push(`PASS: ${label}`);
}

function fail(label: string, error: unknown): void {
  FAILED = 1;
  FAIL_COUNT += 1;
  const message = error instanceof Error ? error.message : String(error);
  RESULTS.push(`FAIL: ${label} — ${message}`);
}

async function check(label: string, assertion: () => Promise<void> | void): Promise<void> {
  console.log(`=== ${label} ===`);
  try {
    await assertion();
    pass(label);
  } catch (error) {
    fail(label, error);
    throw error;
  }
}

function copyCandidate(parent: string): string {
  const candidate = resolve(parent, "candidate");
  cpSync(FIXTURE, candidate, {
    recursive: true,
    filter: (source) => {
      const name = basename(source);
      return ![".git", "node_modules", ".next"].includes(name) && !source.endsWith(".tsbuildinfo");
    },
  });
  return candidate;
}

function allResults(): Json {
  return Object.fromEntries(
    [...Object.keys(CRITERIA), ...Object.keys(PROBES), ...ADVISORY].map((id) => [id, false]),
  );
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

afterAll(() => {
  for (const result of RESULTS) console.log(result);
  console.log(`=== Total: ${PASS_COUNT + FAIL_COUNT} checks (PASS=${PASS_COUNT}, FAIL=${FAIL_COUNT}) ===`);
  if (FAILED !== (FAIL_COUNT > 0 ? 1 : 0)) {
    throw new Error("self-check environment test counters are inconsistent");
  }
});

describe("self-check environment hermeticity", () => {
  it("runs the batch self-check with BENCH_TRACK unset", async () => {
    await check("batch self-check invocation removes BENCH_TRACK", () => {
      const batch = readFileSync(resolve(HARNESS, "batch.sh"), "utf8");
      const invocation = batch
        .split(/\r?\n/)
        .find((line) => line.includes('npm run --silent "$meta_script"'));

      expect(invocation, "batch.sh self-check npm invocation is missing").toBeDefined();
      expect(invocation, "self-check invocation must unset ambient BENCH_TRACK").toMatch(
        /\benv\s+(?:-u\s+BENCH_TRACK|--unset(?:=|\s+)BENCH_TRACK)(?:\s|$)/,
      );
    });
  });

  it("keeps a build score trusted when ambient BENCH_TRACK is poisoned", async () => {
    await check("build score remains trusted with BENCH_TRACK=change", async () => {
      const previousTrack = process.env.BENCH_TRACK;
      const work = mkdtempSync(resolve(tmpdir(), "lending-desk-selfcheck-env-"));
      const runId = basename(work);
      const candidate = copyCandidate(work);
      const artifacts = resolve(work, "artifacts");
      const live = createCurrentAgentRuntime({ root: work, arm: ARM, model: MODEL });

      try {
        process.env.BENCH_TRACK = "change";
        mkdirSync(artifacts);
        writeJson(resolve(artifacts, "gate.json"), { typecheck: true, build: true });
        writeJson(resolve(artifacts, "collection.json"), { valid: true, status: "collected" });
        writeJson(resolve(artifacts, "results.json"), allResults());
        writeJson(
          resolve(artifacts, "provenance.json"),
          currentSchema4Provenance({ fixture: FIXTURE, candidate, runId, model: MODEL, arm: ARM, live, artifacts }),
        );

        const score = await scoreInProcess({
          candidate,
          artifacts,
          runId,
          model: MODEL,
          arm: ARM,
          environment: live.environment,
        });
        writeJson(resolve(artifacts, "score.json"), score);
        const freshness = freshnessInProcess(artifacts, live.environment);

        expect(score).toMatchObject({
          track: "build",
          valid: true,
          trusted: true,
          publishable: true,
          rankable: true,
          candidate_contract: { valid: true },
        });
        expect(score.provenance).toMatchObject({ track: "build" });
        expect(freshness).toMatchObject({
          state: "TRUSTED",
          rankable: true,
          score_current: true,
          candidate_contract_valid: true,
          provenance_current: true,
        });
      } finally {
        if (previousTrack === undefined) delete process.env.BENCH_TRACK;
        else process.env.BENCH_TRACK = previousTrack;
        rmSync(work, { recursive: true, force: true });
      }
    });
  });
});
