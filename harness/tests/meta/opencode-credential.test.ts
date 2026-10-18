import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captureOpencodeRun } from "./opencode-run-fixtures";

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
});
