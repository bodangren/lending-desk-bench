import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Red tests for plan task 4.9f: the message backfill tool (spec D10 ruling
 * 2026-11-18).
 *
 * No tool writes the sets today; pick-diffs.ts writes only candidates. The
 * new tool is `harness/model-guide/seed-messages.ts`, run from `harness/`:
 *
 *   npx tsx model-guide/seed-messages.ts <set_id> --private <dir> [--gh <path>]
 *
 * `--gh` defaults to `gh`. For each `<private>/sets/<set_id>/diffs/*.diff`
 * the tool reads `keys/<diff_id>.json` for `source.commit` and
 * `source.repo`, runs
 * `<gh> api repos/<owner>/<repo>/commits/<sha> --jq .commit.message`, and
 * writes the first line of the message to `messages/<diff_id>.txt` with a
 * trailing newline and no other text.
 *
 * Exit 0 prints exactly one line on stdout: `seed-messages: <n> written`.
 * A missing key, a key with no commit or no repo, a gh failure, or an empty
 * first line gives exit 2 with exactly one line on stdout,
 * `seed-messages: <diff_id> <check>`, and NO message file is written for the
 * whole run (all files go out only after every one is known). The tool reads
 * no file in `src/` and writes nothing outside `messages/`.
 *
 * The tests use only a fake `gh` in a temp dir: no network, no real `gh`,
 * no real home folder. Every case fails while the tool is missing.
 */

const HARNESS = resolve(import.meta.dirname, "..");
const TOOL = join(HARNESS, "model-guide", "seed-messages.ts");

const SET = "mg-seed-msg";
const REPO = "Reading-Advantage-Thailand/reading-advantage-monorepo";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempDir(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `model-guide-seed-messages-${tag}-`));
  roots.push(dir);
  return dir;
}

function requireProduction(): void {
  if (!existsSync(TOOL)) {
    throw new Error(`production file is missing: ${TOOL}`);
  }
}

/** The fake `gh`: prints the canned message of the commit SHA, logs the call. */
const FAKE_GH = `#!/usr/bin/env bash
set -uo pipefail
printf '%s\\n' "$*" >> "\${FAKE_GH_LOG:?}"
sha=""
for arg in "$@"; do
  case "$arg" in
    */commits/*) sha="\${arg##*/commits/}" ;;
  esac
done
file="\${FAKE_GH_MSGS:?}/\${sha}.txt"
if [ -z "$sha" ] || [ ! -f "$file" ]; then
  echo "fake gh: unknown commit \${sha}" >&2
  exit 1
fi
cat "$file"
`;

function shaOf(seed: string): string {
  return (seed.repeat(40 / seed.length + 1)).slice(0, 40);
}

const COMMIT_A = shaOf("a1");
const COMMIT_B = shaOf("b2");

interface SeedOpts {
  diffs?: string[];
  commits?: Record<string, string>;
  messages?: Record<string, string>;
  keys?: Record<string, unknown>;
  extraSrc?: string[];
}

interface SeedFixture {
  privateDir: string;
  ghPath: string;
  ghLog: string;
  msgsDir: string;
  setId: string;
  diffs: string[];
  commits: Record<string, string>;
}

/** One temp private folder with diffs, keys, and a fake gh with messages. */
function setup(tag: string, opts: SeedOpts = {}): SeedFixture {
  const privateDir = tempDir(`private-${tag}`);
  const binDir = tempDir(`bin-${tag}`);
  const ghPath = join(binDir, "gh");
  writeFileSync(ghPath, FAKE_GH, { mode: 0o755 });
  const ghLog = join(binDir, "gh.log");
  const msgsDir = join(binDir, "msgs");
  mkdirSync(msgsDir, { recursive: true });

  const setId = SET;
  const diffs = opts.diffs ?? ["mono-01", "forge-01"];
  const commits: Record<string, string> = {};
  diffs.forEach((diff, index) => {
    commits[diff] = (opts.commits ?? {})[diff] ?? (index === 0 ? COMMIT_A : COMMIT_B);
  });
  for (const [commit, message] of Object.entries(opts.messages ?? {})) {
    writeFileSync(join(msgsDir, `${commit}.txt`), message);
  }

  const setDir = join(privateDir, "sets", setId);
  mkdirSync(join(setDir, "diffs"), { recursive: true });
  mkdirSync(join(setDir, "keys"), { recursive: true });
  mkdirSync(join(setDir, "src"), { recursive: true });
  for (const diff of diffs) {
    writeFileSync(join(setDir, "diffs", `${diff}.diff`), `--- a/${diff}.ts\n+++ b/${diff}.ts\n@@ -1 +1 @@\n-old\n+new ${diff}\n`);
    if (diff in (opts.keys ?? {})) {
      const key = (opts.keys as Record<string, unknown>)[diff];
      if (key !== null) {
        writeFileSync(join(setDir, "keys", `${diff}.json`), `${JSON.stringify(key, null, 2)}\n`);
      }
    } else {
      writeFileSync(
        join(setDir, "keys", `${diff}.json`),
        `${JSON.stringify({ schema: "model-guide-key/1", set_id: setId, diff_id: diff, source: { repo: REPO, commit: commits[diff], parent: shaOf("p0") }, plants: [] }, null, 2)}\n`,
      );
    }
  }
  for (const extra of opts.extraSrc ?? []) {
    writeFileSync(join(setDir, "src", `${extra}.diff`), `source-only ${extra}\n`);
  }
  return { privateDir, ghPath, ghLog, msgsDir, setId, diffs, commits };
}

function runSeed(fx: SeedFixture, args: string[] = []) {
  requireProduction();
  return spawnSync("npx", ["tsx", "model-guide/seed-messages.ts", fx.setId, "--private", fx.privateDir, "--gh", fx.ghPath, ...args], {
    cwd: HARNESS,
    env: {
      ...process.env,
      FAKE_GH_LOG: fx.ghLog,
      FAKE_GH_MSGS: fx.msgsDir,
      NO_COLOR: "1",
      TZ: "UTC",
    } as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 60_000,
  });
}

/** The non-empty stdout lines of a run. */
function stdoutLines(result: { stdout: unknown }): string[] {
  return String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The files under a dir, relative to it, sorted. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (lstatSync(join(current, name)).isDirectory()) walk(join(current, name), rel);
      else out.push(rel);
    }
  };
  walk(dir, "");
  return out;
}

describe("SM1 the message files and the success line", () => {
  it("SM1 writes the first line of each commit message with a trailing newline and prints the count", () => {
    const fx = setup("ok", {
      messages: {
        [COMMIT_A]: "Add the guard for an empty cart\n\nBody of A.",
        [COMMIT_B]: "Fix the total\nBody of B.",
      },
    });
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const lines = stdoutLines(result);
    expect(lines, "the tool printed no single success line").toHaveLength(1);
    const count = Number(/^seed-messages:\s*(\d+)\s*written$/.exec(lines[0])?.[1]);
    expect(count, `the success line holds no count: ${lines[0]}`).toBe(2);
    for (const [diff, commit] of Object.entries(fx.commits)) {
      const path = join(fx.privateDir, "sets", fx.setId, "messages", `${diff}.txt`);
      expect(existsSync(path), `the tool wrote no message file for ${diff}`).toBe(true);
      const first = commit === COMMIT_A ? "Add the guard for an empty cart" : "Fix the total";
      expect(readFileSync(path, "utf8"), `the message file of ${diff} holds more than the first line`).toBe(`${first}\n`);
    }
  });

  it("SM1 calls gh with the commit path of each key", () => {
    const fx = setup("calls", {
      messages: { [COMMIT_A]: "First A\nBody.", [COMMIT_B]: "First B\nBody." },
    });
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(existsSync(fx.ghLog), "the tool made no gh call").toBe(true);
    const log = readFileSync(fx.ghLog, "utf8");
    for (const commit of Object.values(fx.commits)) {
      expect(log, `the tool asked gh for no message of ${commit}`).toContain(`api repos/${REPO}/commits/${commit}`);
    }
  });
});

describe("SM2 the refusals write nothing", () => {
  it("SM2 refuses a missing key with one named line and writes no message file", () => {
    const fx = setup("missing-key", {
      messages: { [COMMIT_A]: "First A\nBody.", [COMMIT_B]: "First B\nBody." },
      keys: { "mono-01": null },
    });
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    const lines = stdoutLines(result);
    expect(lines, "the tool printed no single refusal line").toHaveLength(1);
    expect(lines[0], "the refusal line names no diff").toMatch(/^seed-messages:\s*mono-01\s+\S/);
    expect(filesUnder(join(fx.privateDir, "sets", fx.setId)), "the run wrote a message file").not.toContain("messages/forge-01.txt");
  });

  it("SM2 refuses a key with no commit with one named line and writes nothing", () => {
    const fx = setup("no-commit", {
      messages: { [COMMIT_A]: "First A\nBody." },
      keys: {
        "mono-01": { schema: "model-guide-key/1", set_id: SET, diff_id: "mono-01", source: { repo: REPO, parent: shaOf("p0") }, plants: [] },
      },
    });
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(stdoutLines(result), "the tool printed no single refusal line").toHaveLength(1);
    expect(filesUnder(join(fx.privateDir, "sets", fx.setId)), "the run wrote a message file").not.toContain("messages/forge-01.txt");
  });

  it("SM2 refuses a key with no repo with one named line and writes nothing", () => {
    const fx = setup("no-repo", {
      messages: { [COMMIT_A]: "First A\nBody." },
      keys: {
        "mono-01": { schema: "model-guide-key/1", set_id: SET, diff_id: "mono-01", source: { commit: COMMIT_A, parent: shaOf("p0") }, plants: [] },
      },
    });
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(stdoutLines(result), "the tool printed no single refusal line").toHaveLength(1);
    expect(filesUnder(join(fx.privateDir, "sets", fx.setId)), "the run wrote a message file").not.toContain("messages/forge-01.txt");
  });

  it("SM2 refuses a gh failure with one named line and writes nothing", () => {
    const fx = setup("gh-fail", {
      messages: { [COMMIT_A]: "First A\nBody." },
    });
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    const lines = stdoutLines(result);
    expect(lines, "the tool printed no single refusal line").toHaveLength(1);
    expect(lines[0], "the refusal line names no diff").toMatch(/^seed-messages:\s*forge-01\s+\S/);
    expect(filesUnder(join(fx.privateDir, "sets", fx.setId)), "the run wrote a message file").not.toContain("messages/mono-01.txt");
  });

  it("SM2 refuses an empty first line with one named line and writes nothing", () => {
    const fx = setup("empty-line", {
      messages: { [COMMIT_A]: "First A\nBody.", [COMMIT_B]: "\nBody without a subject." },
    });
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    const lines = stdoutLines(result);
    expect(lines, "the tool printed no single refusal line").toHaveLength(1);
    expect(lines[0], "the refusal line names no diff").toMatch(/^seed-messages:\s*forge-01\s+\S/);
    expect(filesUnder(join(fx.privateDir, "sets", fx.setId)), "the run wrote a message file").not.toContain("messages/mono-01.txt");
  });
});

describe("SM3 the set boundary", () => {
  it("SM3 reads no file in src/: an extra source-only diff with no key still exits 0", () => {
    const fx = setup("src", {
      messages: { [COMMIT_A]: "First A\nBody.", [COMMIT_B]: "First B\nBody." },
      extraSrc: ["zzz-only"],
    });
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(filesUnder(join(fx.privateDir, "sets", fx.setId)), "the tool read src/").not.toContain("messages/zzz-only.txt");
  });

  it("SM3 writes nothing outside messages/: keys and diffs stay byte-identical", () => {
    const fx = setup("boundary", {
      messages: { [COMMIT_A]: "First A\nBody.", [COMMIT_B]: "First B\nBody." },
    });
    const setDir = join(fx.privateDir, "sets", fx.setId);
    const before = new Map<string, string>();
    for (const file of filesUnder(setDir)) {
      before.set(file, readFileSync(join(setDir, file), "utf8"));
    }
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const after = filesUnder(setDir);
    for (const file of after) {
      if (file.startsWith("messages/")) continue;
      expect(before.has(file), `the tool added a file outside messages/: ${file}`).toBe(true);
      expect(readFileSync(join(setDir, file), "utf8"), `the tool changed ${file}`).toBe(before.get(file));
    }
    expect(after.filter((file) => file.startsWith("messages/")).sort()).toEqual(["messages/forge-01.txt", "messages/mono-01.txt"]);
  });
});

describe("SM4 the arg-level refusals (task 4.13e; guards: hold at HEAD)", () => {
  /** Runs the tool with an explicit set id and extra args. */
  function runWithId(fx: SeedFixture, setId: string, args: string[] = []) {
    requireProduction();
    return spawnSync(
      "npx",
      ["tsx", "model-guide/seed-messages.ts", setId, "--private", fx.privateDir, "--gh", fx.ghPath, ...args],
      {
        cwd: HARNESS,
        env: {
          ...process.env,
          FAKE_GH_LOG: fx.ghLog,
          FAKE_GH_MSGS: fx.msgsDir,
          NO_COLOR: "1",
          TZ: "UTC",
        } as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: 60_000,
      },
    );
  }

  /** A fixture with gh messages for every commit. */
  function ready(tag: string): SeedFixture {
    return setup(`sm4-${tag}`, {
      messages: { [COMMIT_A]: "First A\nBody.", [COMMIT_B]: "First B\nBody." },
    });
  }

  it("SM4 refuses the set id ../x with exit 2, no gh call, and no file", () => {
    const fx = ready("parent");
    const before = readdirSync(fx.privateDir).sort();
    const result = runWithId(fx, "../x");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(stdoutLines(result), "the tool printed no single refusal line").toHaveLength(1);
    expect(stdoutLines(result)[0], "the refusal names the set id").toMatch(/set-id/);
    expect(existsSync(fx.ghLog), "the tool called gh").toBe(false);
    expect(readdirSync(fx.privateDir).sort(), "the tool wrote a file").toEqual(before);
  });

  it("SM4 refuses the set id a/b with exit 2, no gh call, and no file", () => {
    const fx = ready("slash");
    const result = runWithId(fx, "a/b");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(stdoutLines(result), "the tool printed no single refusal line").toHaveLength(1);
    expect(stdoutLines(result)[0], "the refusal names the set id").toMatch(/set-id/);
    expect(existsSync(fx.ghLog), "the tool called gh").toBe(false);
  });

  it("SM4 refuses a linked messages/ folder with exit 2 and no write", () => {
    const fx = ready("link");
    const outside = join(fx.privateDir, "outside");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(fx.privateDir, "sets", fx.setId, "messages"));
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(stdoutLines(result), "the tool printed no single refusal line").toHaveLength(1);
    expect(stdoutLines(result)[0], "the refusal names the link").toMatch(/link/);
    expect(readdirSync(outside), "the tool wrote through the link").toEqual([]);
  });

  it("SM4 refuses the set id given twice with exit 2, no gh call, and no file", () => {
    const fx = ready("twice");
    const result = runSeed(fx, [fx.setId]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(stdoutLines(result), "the tool printed no single refusal line").toHaveLength(1);
    expect(stdoutLines(result)[0], "the refusal names the double set id").toMatch(/twice/);
    expect(existsSync(fx.ghLog), "the tool called gh").toBe(false);
    expect(
      filesUnder(join(fx.privateDir, "sets", fx.setId)),
      "the tool wrote a message file",
    ).not.toContain(`messages/${fx.diffs[0]}.txt`);
  });

  it("SM4 refuses an unknown flag with exit 2, no gh call, and no file", () => {
    const fx = ready("unknown");
    const result = runSeed(fx, ["--bogus", "x"]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(stdoutLines(result), "the tool printed no single refusal line").toHaveLength(1);
    expect(stdoutLines(result)[0], "the refusal names the flag").toMatch(/unknown flag/);
    expect(existsSync(fx.ghLog), "the tool called gh").toBe(false);
  });

  it("SM4 refuses a flag with no value with exit 2, no gh call, and no file", () => {
    const fx = ready("novalue");
    const result = runSeed(fx, ["--private"]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(stdoutLines(result), "the tool printed no single refusal line").toHaveLength(1);
    expect(stdoutLines(result)[0], "the refusal names the flag").toMatch(/needs a value/);
    expect(existsSync(fx.ghLog), "the tool called gh").toBe(false);
  });

  it("SM4 refuses a missing set folder with exit 2, no gh call, and no file", () => {
    const fx = ready("missing");
    const before = readdirSync(fx.privateDir).sort();
    const result = runWithId(fx, "mg-no-such-set");
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(stdoutLines(result), "the tool printed no single refusal line").toHaveLength(1);
    expect(stdoutLines(result)[0], "the refusal names the missing folder").toMatch(/set folder is missing/);
    expect(existsSync(fx.ghLog), "the tool called gh").toBe(false);
    expect(readdirSync(fx.privateDir).sort(), "the tool wrote a file").toEqual(before);
  });

  it("SM4 refuses a set with no diff with exit 2, no gh call, and no file", () => {
    const fx = ready("nodiff");
    const diffDir = join(fx.privateDir, "sets", fx.setId, "diffs");
    for (const name of readdirSync(diffDir)) rmSync(join(diffDir, name));
    const result = runSeed(fx);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(2);
    expect(stdoutLines(result), "the tool printed no single refusal line").toHaveLength(1);
    expect(stdoutLines(result)[0], "the refusal names the empty set").toMatch(/no diff/);
    expect(existsSync(fx.ghLog), "the tool called gh").toBe(false);
    expect(
      filesUnder(join(fx.privateDir, "sets", fx.setId)),
      "the tool wrote a message file",
    ).not.toContain(`messages/${fx.diffs[0]}.txt`);
  });
});
