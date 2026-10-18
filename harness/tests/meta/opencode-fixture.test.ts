import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeOpencode, OPENCODE_FIXTURES, TEST_SESSION } from "./schema4-fixtures";
import { captureOpencodeRun } from "./opencode-run-fixtures";

describe("OpenCode fixture contract", () => {
  it("captures every fake call, environment, and stdin hash without network access", () => {
    mkdirSync("/tmp/opencode", { recursive: true });
    const temp = mkdtempSync("/tmp/opencode/fixture-");
    try {
      const fake = createFakeOpencode(temp);
      const commands = [["--version"], ["models"], ["auth", "export", "opencode"], ["auth", "import"],
        ["run", "--standalone", "--format", "json", "--auto", "--model", "opencode-go/beam-free", "prompt"],
        ["session", "list"], ["session", "export", TEST_SESSION]];
      const outputs = commands.map(argv => {
        const result = spawnSync(fake.path, argv, { input: "CANARY-ACCESS-2", encoding: "utf8", env: { FIXTURE_CANARY: "org_CANARY2" } });
        expect(result.status, result.stderr).toBe(0);
        return result.stdout;
      });
      expect(existsSync(fake.capture), "the fake must write its capture file").toBe(true);
      const calls = readFileSync(fake.capture, "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(calls.map(call => call.argv)).toEqual(commands);
      for (const call of calls) {
        expect(call.env).toContain("FIXTURE_CANARY=org_CANARY2");
        expect(call.stdin_sha256).toBe(createHash("sha256").update("CANARY-ACCESS-2").digest("hex"));
      }
      expect(outputs[0].trim()).toBe("opencode v2.0.32");
      expect(JSON.parse(outputs[2])).toEqual(fake.auth);
      expect(outputs[4]).toBe(readFileSync(resolve(OPENCODE_FIXTURES, "opencode-events.jsonl"), "utf8"));
      expect(JSON.parse(outputs[5])).toEqual([{ id: TEST_SESSION }]);
      expect(outputs[6]).toBe(readFileSync(resolve(OPENCODE_FIXTURES, "opencode-session-export.json"), "utf8"));
      expect(gunzipSync(readFileSync(resolve(OPENCODE_FIXTURES, "opencode-session-export.json.gz"))).toString()).toBe(outputs[6]);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it("the runner invokes the fake OpenCode and creates its capture file", () => {
    const run = captureOpencodeRun("a");
    try {
      expect(existsSync(run.fake.capture), "run.sh must invoke OpenCode instead of Pi and write the fake capture file").toBe(true);
      const calls = readFileSync(run.fake.capture, "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(calls.length, "the capture must contain at least one OpenCode call").toBeGreaterThan(0);
      expect(calls.some(call => call.argv[0] === "--version"), "the runner must resolve the OpenCode version").toBe(true);
    } finally { run.cleanup(); }
  }, 30_000);
});
