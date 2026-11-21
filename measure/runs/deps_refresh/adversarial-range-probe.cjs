const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = "/home/daniebo/Desktop/lending-desk-bench";
const semver = require(`${root}/harness/node_modules/semver`);
const before = require("./audit-before-b4c2e45.json");
const lock = require(`${root}/harness/package-lock.json`);
const base = JSON.parse(execFileSync("git", ["show", "b4c2e45:harness/package-lock.json"], { cwd: root }));
const names = ["brace-expansion", "fast-uri", "nanoid", "source-map-js", "vite", "zod"];
const result = {};
for (const name of names) {
  const advisory = before.vulnerabilities[name];
  const ranges = [...new Set([advisory.range, ...advisory.via.filter(x => typeof x === "object").map(x => x.range)])];
  const matches = Object.entries(lock.packages).filter(([p]) => p.endsWith(`/node_modules/${name}`) || p === `node_modules/${name}`);
  assert(matches.length > 0, `${name}: empty lock matches`);
  const paths = matches.map(([p, entry]) => {
    for (const range of ranges) assert(!semver.satisfies(entry.version, range), `${p}: ${entry.version} matches ${range}`);
    const installed = JSON.parse(fs.readFileSync(path.join(root, "harness", p, "package.json")));
    assert.equal(installed.version, entry.version, `${p}: installed version mismatch`);
    return { path: p, version: entry.version, installed_version: installed.version };
  });
  const old = Object.entries(base.packages).filter(([p]) => p.endsWith(`/node_modules/${name}`) || p === `node_modules/${name}`);
  assert(old.some(([, entry]) => ranges.some(range => semver.satisfies(entry.version, range))), `${name}: base lacks a vulnerable copy`);
  result[name] = { vulnerable_ranges: ranges, paths, base_versions: old.map(([p, e]) => ({ path: p, version: e.version })) };
}
console.log(JSON.stringify(result, null, 2));
