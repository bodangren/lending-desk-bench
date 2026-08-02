import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const CANDIDATE = process.env.CANDIDATE ?? resolve(import.meta.dirname, "../fixture");
const PW_PORT = Number(process.env.PW_PORT);
if (!Number.isInteger(PW_PORT) || PW_PORT < 1024 || PW_PORT > 65535) {
  throw new Error("PW_PORT must be an assigned unprivileged port");
}
const BASE_URL = process.env.PW_BASE_URL ?? `http://127.0.0.1:${PW_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  // Detail flows mutate the shared in-memory store; retries would reuse that state.
  retries: 0,
  reporter: [["json", { outputFile: process.env.E2E_RESULT_FILE ?? "e2e-results.json" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    // Browsers authenticate as staff via cookie. The auth probe clears it.
    storageState: {
      cookies: [{
        name: "staff_key", value: "staff-key-7f3a",
        domain: "127.0.0.1", path: "/", expires: -1,
        httpOnly: false, secure: false, sameSite: "Lax" as const,
      }],
      origins: [],
    },
  },
  webServer: {
    command: `./node_modules/.bin/next start --port ${PW_PORT}`,
    cwd: CANDIDATE,
    url: `${BASE_URL}/members`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { BENCH_NOW: "2026-03-15T12:00:00.000Z", BENCH_LATENCY_MS: "300",
      BENCH_TRACE_FILE: process.env.BENCH_TRACE_FILE ?? "/tmp/ldb-trace.jsonl",
      // Set only for the error-path pass, which boots its own server.
      ...(process.env.BENCH_FAIL_ITEMS ? { BENCH_FAIL_ITEMS: "1" } : {}) },
  },
});
