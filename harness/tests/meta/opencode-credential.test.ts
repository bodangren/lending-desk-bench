import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { captureOpencodeRun, jsonIfPresent, prepareOpencodeRun } from "./opencode-run-fixtures";
import { calls, CANARIES, leakHits, prepareCredentialBatch, REASON, setExports } from "./opencode-credential-fixtures";

describe("OpenCode credential delivery", () => {
  it("streams only the selected Console access payload to Podman stdin, with an inert refresh", () => {
    const run = captureOpencodeRun("a");
    try {
      expect(existsSync(run.podmanCapture), "the fake Podman must record credential delivery").toBe(true);
      const expected = structuredClone(run.fake.auth);
      expected[0].value.refresh = "inert";
      const expectedHash = createHash("sha256").update(JSON.stringify(expected) + "\n").digest("hex");
      expect(run.podman.stdin_sha256, "Podman stdin must carry the access-only Console payload, not empty input or a refresh token").toBe(expectedHash);
    } finally { run.cleanup(); }
  }, 30_000);

  it("the leak scanner detects planted canaries without printing their values", () => {
    const run = prepareOpencodeRun("a");
    try {
      mkdirSync(run.out, { recursive: true });
      writeFileSync(resolve(run.out,"planted.log"), CANARIES.join(" "));
      expect(leakHits(run,{stdout:"",stderr:""}), "a planted canary must make the scanner fail closed").toEqual([resolve(run.out,"planted.log")]);
    } finally { run.cleanup(); }
  });

  it("keeps Console canaries out of argv, environment, artifacts, logs, provenance, score, and the session export", () => {
    const run = prepareOpencodeRun("a");
    try {
      const result = run.execute();
      expect(calls(run.fake.capture).some(call => call.argv[0] === "auth" && call.argv[1] === "export"), "the runner must export the Console credential before the leak check").toBe(true);
      expect.soft(existsSync(run.podmanCapture), "the agent must start for the no-leak control").toBe(true);
      expect.soft(existsSync(resolve(run.out,"executor/session-export.json")), "the no-leak check must include a session export").toBe(true);
      expect(leakHits(run,result), "one remaining canary makes the run unsafe").toEqual([]);
    } finally { run.cleanup(); }
  }, 30_000);

  for (const mode of ["success", "failure", "timeout"] as const) {
    it(`removes credential staging after agent ${mode}`, () => {
      const run = prepareOpencodeRun("a");
      try {
        writeFileSync(run.podmanControl,JSON.stringify({mode}));
        run.execute();
        const capture = jsonIfPresent(run.podmanCapture);
        expect(capture, "the fake Podman must start before cleanup is checked").toBeDefined();
        expect(capture.staging.length, "credential staging must exist during the agent run").toBeGreaterThan(0);
        expect(readdirSync(run.runtime), "all credential staging must disappear after the agent returns").toEqual([]);
      } finally { run.cleanup(); }
    }, 30_000);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    it(`removes credential staging after ${signal} during the fake agent`, async () => {
      const run = prepareOpencodeRun("a");
      writeFileSync(run.podmanControl, JSON.stringify({mode:"hold"}));
      const child = run.start();
      const exited = once(child,"exit");
      try {
        const deadline = Date.now()+15_000;
        while (!existsSync(resolve(run.temp,"podman-started")) && Date.now()<deadline && child.exitCode === null) await new Promise(resolveDelay => setTimeout(resolveDelay,25));
        expect(existsSync(resolve(run.temp,"podman-started")), "the fake Podman must publish its start marker").toBe(true);
        expect(readdirSync(run.runtime).length, "staging must hold an entry before the signal is sent").toBeGreaterThan(0);
        expect(child.kill(signal), "the signal must reach the run process").toBe(true);
        await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error("credential cleanup did not finish after "+signal)),5000))]);
        expect(readdirSync(run.runtime), "interruption must remove every credential staging entry").toEqual([]);
      } finally {
        try { process.kill(-child.pid!,"SIGTERM"); } catch {}
        await new Promise(resolveDelay => setTimeout(resolveDelay,50));
        try { process.kill(-child.pid!,"SIGKILL"); } catch {}
        await exited;
        run.cleanup();
      }
    }, 30_000);
  }

  const expiryCases: [string, unknown][] = [["missing",undefined],["null",null],["string","4102444800000"],["negative",-1],["fractional",4102444800000.5],["non-finite",Infinity]];
  for (const [label,value] of expiryCases) {
    it(`rejects a ${label} expires value before Podman or an OpenCode run`, () => {
      const run = prepareOpencodeRun("a");
      try {
        const auth: any = structuredClone(run.fake.auth);
        if (value === undefined) delete auth[0].value.expires; else auth[0].value.expires = value;
        const raw = value === Infinity ? JSON.stringify(auth).replace('"expires":null','"expires":1e999') : JSON.stringify(auth);
        setExports(run,[raw]);
        const result = run.execute();
        expect.soft(result.status, "an invalid expiry must stop the run").not.toBe(0);
        expect(existsSync(run.podmanCapture), `a ${label} expiry must stop before the agent`).toBe(false);
        expect(calls(run.fake.capture).filter(call=>call.argv[0] === "run")).toEqual([]);
      } finally { run.cleanup(); }
    }, 30_000);
  }

  it("rejects two active Console connections before credential delivery", () => {
    const run = prepareOpencodeRun("a");
    try {
      const second = structuredClone(run.fake.auth[0]); second.id = "console-canary-2";
      second.value.access = "CANARY-ACCESS-2"; second.value.refresh = "CANARY-REFRESH-2";
      setExports(run,[JSON.stringify([...run.fake.auth,second])]);
      const result = run.execute();
      expect.soft(result.status).not.toBe(0);
      expect(existsSync(run.podmanCapture), "ambiguous active connections must stop before Podman").toBe(false);
      expect(existsSync(resolve(run.temp,"stdin-payload")), "an ambiguous connection must produce no container payload").toBe(false);
    } finally { run.cleanup(); }
  }, 30_000);

  it("keeps every other integration on the host and delivers only the active Console connection", () => {
    const run = prepareOpencodeRun("a");
    try {
      const other = structuredClone(run.fake.auth[0]); other.integrationID = "other"; other.id = "other-canary";
      other.value.access = "CANARY-ACCESS-2"; other.value.refresh = "CANARY-REFRESH-2"; other.value.metadata.orgID = "org_CANARY2";
      setExports(run,[JSON.stringify([...run.fake.auth,other])]);
      const result = run.execute();
      expect(existsSync(run.podmanCapture), "the selected Console connection must reach the fake Podman").toBe(true);
      const stdin = readFileSync(resolve(run.temp,"stdin-payload"),"utf8");
      expect(stdin.trim().length, "the selected Console payload must not be empty").toBeGreaterThan(0);
      const payload = JSON.parse(stdin);
      expect(payload).toHaveLength(1);
      expect(payload[0].integrationID).toBe("opencode");
      expect(payload[0].id).toBe(run.fake.auth[0].id);
      for (const canary of [other.value.access,other.value.refresh,other.value.metadata.orgID]) expect(stdin).not.toContain(canary);
      expect(leakHits(run,result,[other.value.access,other.value.refresh,other.value.metadata.orgID])).toEqual([]);
    } finally { run.cleanup(); }
  }, 30_000);

  it("batch preflight rejects a short credential before the first run directory", () => {
    const run = prepareOpencodeRun("a");
    try {
      const auth = structuredClone(run.fake.auth); auth[0].value.expires = Date.now()+60_000;
      setExports(run,[JSON.stringify(auth)]);
      const batch = prepareCredentialBatch(run);
      const result = batch.execute();
      expect.soft(String(result.stdout)+String(result.stderr), "the batch must report the FR-3 run-window reason").toContain(REASON);
      expect.soft(result.status).not.toBe(0);
      expect.soft(existsSync(run.podmanCapture), "preflight must stop before the first agent").toBe(false);
      expect(batch.runDirectories(), "preflight must create no run directory").toEqual([]);
    } finally { run.cleanup(); }
  }, 60_000);

  it("a serial batch checks the run window again before a later agent", () => {
    const run = prepareOpencodeRun("a");
    try {
      const short = structuredClone(run.fake.auth); short[0].value.expires = Date.now()+60_000;
      setExports(run,[JSON.stringify(run.fake.auth),JSON.stringify(run.fake.auth),JSON.stringify(short)]);
      writeFileSync(run.podmanControl,JSON.stringify({mode:"success"}));
      const batch = prepareCredentialBatch(run,2), result = batch.execute();
      const records = calls(resolve(run.temp,"podman-calls.jsonl"));
      expect.soft(records.length, "only the first run window is covered").toBe(1);
      expect.soft(records[0]?.candidate ?? "", "the first run must reach its agent").toContain("-r1/candidate");
      expect.soft(calls(run.fake.capture).filter(call=>call.argv[0] === "auth" && call.argv[1] === "export").length, "the batch and both runs must check the credential").toBeGreaterThanOrEqual(3);
      expect(String(result.stdout)+String(result.stderr), "the later run must report the same FR-3 reason").toContain(REASON);
    } finally { run.cleanup(); }
  }, 60_000);

  for (const [label,hours,warning] of [["near",167,true],["far",169,false]] as const) {
    it(`the weekly ${label}-side expiry warning preserves a covered batch`, () => {
      const run = prepareOpencodeRun("a");
      try {
        const auth = structuredClone(run.fake.auth); auth[0].value.expires = Date.now()+hours*3600_000;
        setExports(run,[JSON.stringify(auth)]);
        const batch = prepareCredentialBatch(run), result = batch.execute();
        const output = String(result.stdout)+String(result.stderr);
        expect.soft(calls(run.fake.capture).some(call=>call.argv[0] === "auth" && call.argv[1] === "export"), "the warning must inspect the exported expiry").toBe(true);
        const lines = output.split("\n").filter(line=>/warn/i.test(line) && /(?:Console|credential|token)/i.test(line) && /expir/i.test(line));
        expect.soft(lines.length, "only a credential within seven days needs a warning").toBe(warning ? 1 : 0);
        expect.soft(output).not.toContain(REASON);
        expect(calls(resolve(run.temp,"podman-calls.jsonl")).length, "the warning must not stop the covered batch").toBe(1);
      } finally { run.cleanup(); }
    }, 60_000);
  }

  it("redacts a canary from session output and the export and records an invalid credential-leak reason", () => {
    const run = prepareOpencodeRun("a");
    try {
      writeFileSync(run.podmanControl,JSON.stringify({mode:"leak"}));
      const result = run.execute(), score = jsonIfPresent(resolve(run.out,"score.json"));
      expect(existsSync(resolve(run.out,"executor/session-export.json")), "the fake must plant a canary in the export").toBe(true);
      expect.soft(score?.valid, "a credential leak makes the run invalid").toBe(false);
      expect.soft(score?.invalid_reasons, "the reason must name the credential leak").toContain("Console credential reached run output");
      expect(leakHits(run,result), "the runner must redact every planted canary from all output").toEqual([]);
    } finally { run.cleanup(); }
  }, 30_000);
});
