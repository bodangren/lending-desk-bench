import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Existing assertions still verify legacy Pi records during Red.
export { createCurrentAgentRuntime, currentSchema4Provenance, type CurrentAgentRuntime } from "./legacy-pi-fixtures";

export const OPENCODE_FIXTURES = resolve(import.meta.dirname, "fixtures");
export const TEST_MODEL = "beam-free";
export const TEST_SESSION = "session CANARY; one";

/** Creates an offline OpenCode executable with an append-only call record. */
export function createFakeOpencode(root: string) {
  const bin = resolve(root, "bin");
  mkdirSync(bin, { recursive: true });
  const path = resolve(bin, "opencode");
  const capture = resolve(root, "opencode-calls.jsonl");
  const auth = [{
    id: "console-canary-1", integrationID: "opencode", label: "Canary", active: true,
    value: {
      type: "oauth", methodID: "device", access: "CANARY-ACCESS-1", refresh: "CANARY-REFRESH-1",
      expires: 4102444800000, metadata: { orgID: "org_CANARY1", server: "https://opencode.ai/console" },
    },
  }];
  writeFileSync(path, `#!${process.execPath}
const fs = require("node:fs"), crypto = require("node:crypto");
const argv = process.argv.slice(2);
const stdin = fs.readFileSync(0);
fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({argv, env: Object.entries(process.env).map(([k,v]) => k+"="+v).sort(), stdin_sha256: crypto.createHash("sha256").update(stdin).digest("hex")})+"\\n");
if (argv[0] === "--version") console.log("opencode v2.0.32");
else if (argv[0] === "models") console.log("opencode-go/${TEST_MODEL}");
else if (argv[0] === "auth" && argv[1] === "export") console.log(JSON.stringify(${JSON.stringify(auth)}));
else if (argv[0] === "auth" && argv[1] === "list") console.log("opencode Console oauth active");
else if (argv[0] === "auth" && argv[1] === "import") console.log("Imported 1 credential");
else if (argv[0] === "run") process.stdout.write(fs.readFileSync(${JSON.stringify(resolve(OPENCODE_FIXTURES, "opencode-events.jsonl"))}));
else if (argv[0] === "session" && argv[1] === "list") console.log(JSON.stringify([{id:${JSON.stringify(TEST_SESSION)}}]));
else if (argv[0] === "session" && argv[1] === "export") process.stdout.write(fs.readFileSync(${JSON.stringify(resolve(OPENCODE_FIXTURES, "opencode-session-export.json"))}));
else process.exitCode = 96;
`);
  chmodSync(path, 0o755);
  return { path, capture, auth };
}
