import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const CANDIDATE = process.env.CANDIDATE ?? resolve(import.meta.dirname, "../fixture");

// Product suites (unit/api) stay fast. Meta tests copy fixtures, hash the suite, and
// may spawn grade.sh / Podman — they need longer budgets and less fan-out so they do
// not timeout under self-contention (the classic agent thrash loop).
const isMeta = process.env.BENCH_META === "1";

export default defineConfig({
  resolve: { alias: { "@candidate": CANDIDATE, "@": CANDIDATE } },
  test: {
    environment: "node",
    env: {
      BASE_URL: process.env.BASE_URL || "http://127.0.0.1:3000",
    },
    testTimeout: isMeta ? 180_000 : 30_000,
    hookTimeout: isMeta ? 180_000 : 30_000,
    // Meta suite is disk- and process-spawn heavy; parallel workers create false failures.
    ...(isMeta ? { maxWorkers: 1, fileParallelism: false } : {}),
    reporters: ["default", ["json", { outputFile: process.env.RESULT_FILE ?? "results.json" }]],
  },
});
