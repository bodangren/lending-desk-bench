import { readFileSync } from "node:fs";

const EXPECTED_COMMANDS = {
  install: "npm ci",
  develop: "npm run dev",
  typecheck: "npm run typecheck",
  build: "npm run build",
  start: "npm run start",
};

const EXPECTED_ROUTES = {
  home: "/",
  catalogue: "/items",
  detail: "/items/[id]",
  members: "/members",
  loans: "/api/loans",
};

const EXPECTED_ENVIRONMENT = ["BENCH_NOW", "BENCH_LATENCY_MS"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validate(value: unknown): string[] {
  if (!isObject(value)) return ["manifest must be an object"];
  const errors: string[] = [];
  if (value.schema !== 1) errors.push("schema must be 1");
  if (value.service !== "lending-desk") errors.push("service must be lending-desk");
  if (isObject(value.commands)) {
    for (const [key, expected] of Object.entries(EXPECTED_COMMANDS)) {
      if (value.commands[key] !== expected) errors.push(`commands.${key} must equal ${expected}`);
    }
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_COMMANDS)) {
      errors.push(`commands.${key} must equal ${expected}`);
    }
  }
  if (isObject(value.routes)) {
    for (const [key, expected] of Object.entries(EXPECTED_ROUTES)) {
      if (value.routes[key] !== expected) errors.push(`routes.${key} must equal ${expected}`);
    }
  } else {
    for (const [key, expected] of Object.entries(EXPECTED_ROUTES)) {
      errors.push(`routes.${key} must equal ${expected}`);
    }
  }
  if (!Array.isArray(value.environment) || value.environment.join("\0") !== EXPECTED_ENVIRONMENT.join("\0")) {
    errors.push("environment must equal the fixed environment list");
  }
  return errors.sort();
}

function main(): void {
  const manifestPath = process.argv[2];
  if (!manifestPath || process.argv.length !== 3) {
    process.stderr.write("usage: tsx ops/verify.ts <manifest-path>\n");
    process.exitCode = 2;
    return;
  }
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    process.stdout.write(`${JSON.stringify(["manifest file could not be read"])}\n`);
    process.exitCode = 2;
    return;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    process.stdout.write(`${JSON.stringify(["manifest must be valid JSON"])}\n`);
    process.exitCode = 2;
    return;
  }
  const errors = validate(value);
  process.stdout.write(`${JSON.stringify(errors)}\n`);
  process.exitCode = errors.length === 0 ? 0 : 1;
}

main();
