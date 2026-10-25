import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// One file at a time: the tests share one app server and its in-memory data.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    // Vite sets BASE_URL to "/" inside tests; pass the app's address through.
    env: { BASE_URL: process.env.BASE_URL || "http://127.0.0.1:3100" },
    include: ["tests/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
