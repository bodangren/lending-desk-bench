/** Map vitest + playwright reports onto criterion ids. Test titles ARE the ids. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const out: Record<string, boolean> = {};
const origins = new Map<string, string>();

function recordResult(id: string, passed: boolean, source: string) {
  const prior = origins.get(id);
  if (prior) throw new Error(`duplicate result id ${id}: ${prior} and ${source}`);
  origins.set(id, source);
  out[id] = passed;
}


function fromVitest(path: string) {
  if (!path || !existsSync(path)) throw new Error(`required Vitest report is missing: ${path}`);
  const j = JSON.parse(readFileSync(path, "utf8"));
  for (const file of j.testResults ?? []) {
    for (const a of file.assertionResults ?? []) {
      const id = (a.title ?? "").trim();
      if (id) {
        recordResult(id, a.status === "passed", `${path}:${file.name ?? "unknown"}`);
      }
    }
  }
}

function fromPlaywright(path: string) {
  if (!path || !existsSync(path)) throw new Error(`required Playwright report is missing: ${path}`);
  const j = JSON.parse(readFileSync(path, "utf8"));
  const walk = (s: any) => {
    for (const spec of s.specs ?? []) {
      const id = (spec.title ?? "").trim();
      if (id) {
        recordResult(id, spec.ok === true && spec.tests?.[0]?.status !== "skipped", path);
      }
    }
    for (const child of s.suites ?? []) walk(child);
  };
  for (const suite of j.suites ?? []) walk(suite);
}

const [, , unitPath, apiPath, e2ePath, e2eErrorPath, dest] = process.argv;
if (!dest) throw new Error("results destination is required");
fromVitest(unitPath);
fromVitest(apiPath);
fromPlaywright(e2ePath);
fromPlaywright(e2eErrorPath);
writeFileSync(dest, JSON.stringify(out, null, 2));
console.error(`collected ${Object.keys(out).length} results -> ${dest}`);
