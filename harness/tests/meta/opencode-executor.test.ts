import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureOpencodeRun, HARNESS, IMAGE, jsonIfPresent, ROOT, SKILLS } from "./opencode-run-fixtures";
import { TEST_MODEL } from "./schema4-fixtures";

type Run = ReturnType<typeof captureOpencodeRun>;
const runs: Run[] = [];
const PROMPT = 'Read measure/tracks/lending_desk/spec.md and measure/tracks/lending_desk/plan.md, then implement the plan. Mark each plan task complete as you finish it. Run "npm run typecheck" and "npm run build" and make sure both pass before you stop.';
const DENIES = [
  { action: "question", resource: "*", effect: "deny" },
  { action: "websearch", resource: "*", effect: "deny" },
  { action: "subagent", resource: "*", effect: "deny" },
  { action: "read", resource: "/tmp/data/**", effect: "deny" },
  { action: "edit", resource: "/tmp/data/**", effect: "deny" },
  { action: "skill", resource: "*", effect: "deny" },
];
const CONTAINER_ENV = [
  "HOME=/tmp/home", "XDG_CONFIG_HOME=/tmp/config", "XDG_DATA_HOME=/tmp/data",
  "XDG_STATE_HOME=/tmp/state", "XDG_CACHE_HOME=/tmp/cache",
  "OPENCODE_CONFIG=/config/opencode.json", "OPENCODE_DISABLE_PROJECT_CONFIG=1",
  "OPENCODE_DISABLE_CLAUDE_CODE=1", "OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1",
  "OPENCODE_DISABLE_AUTOUPDATE=1", "OPENCODE_DISABLE_MODELS_FETCH=1",
];

function values(argv: string[], flag: string): string[] {
  return argv.flatMap((value, index) => value === flag ? [argv[index + 1]] : []);
}

function invocation(run: Run): string[] {
  expect(run.result.error, "the fake run must finish without a spawn error").toBeUndefined();
  expect(existsSync(run.podmanCapture), "run.sh must reach the fake Podman with the Console credential").toBe(true);
  return run.podman.argv;
}

function config(run: Run) {
  const path = resolve(run.out, "executor/opencode.json");
  expect(existsSync(path), `Arm ${run.arm} must write its generated OpenCode config`).toBe(true);
  return JSON.parse(readFileSync(path, "utf8"));
}

function mounts(run: Run): string[] {
  return [
    `type=bind,src=${resolve(run.work, "candidate")},dst=/workspace,rw`,
    `type=bind,src=${resolve(ROOT, "fixture/node_modules")},dst=/workspace/node_modules,ro`,
    `type=bind,src=${run.fake.path},dst=/usr/local/bin/opencode,ro`,
    `type=bind,src=${resolve(run.out, "rg")},dst=/usr/local/bin/rg,ro`,
    `type=bind,src=${resolve(HARNESS, "opencode-entry.sh")},dst=/entry/opencode-entry.sh,ro`,
    `type=bind,src=${resolve(run.out, "executor/opencode.json")},dst=/config/opencode.json,ro`,
    ...(run.arm === "b" ? [`type=bind,src=${resolve(run.out, "executor/skills")},dst=/opt/skills,ro`] : []),
  ];
}

function expectedPodman(run: Run): string[] {
  return [
    "run", "--rm", "-i", "--pull=never", "--read-only",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=512m",
    "--tmpfs", "/run/opencode:rw,nosuid,nodev,size=64m",
    "--cap-drop=ALL", "--security-opt=no-new-privileges", "--userns=keep-id",
    "--user", `${process.getuid!()}:${process.getgid!()}`,
    "--network", "slirp4netns:allow_host_loopback=false",
    ...mounts(run).flatMap(mount => ["--mount", mount]),
    ...CONTAINER_ENV.flatMap(value => ["--env", value]),
    "--workdir", "/workspace", IMAGE, "/entry/opencode-entry.sh",
  ];
}

describe("OpenCode executor and isolation contract", () => {
  beforeAll(() => {
    runs.push(captureOpencodeRun("a"), captureOpencodeRun("b"));
  }, 60_000);
  afterAll(() => { for (const run of runs) run.cleanup(); });

  for (const arm of ["a", "b"] as const) {
    const current = () => runs[arm === "a" ? 0 : 1];

    it(`Arm ${arm}: the whole Podman argv equals design 1.2, in order, including -i`, () => {
      const run = current();
      expect(invocation(run), "the Podman argv must match the exact OpenCode contract").toEqual(expectedPodman(run));
    });

    it(`Arm ${arm}: the mount set equals FR-4 without any extra host mount`, () => {
      const run = current();
      expect(values(invocation(run), "--mount").sort(), "only the FR-4 host paths may enter the container").toEqual(mounts(run).sort());
    });

    it(`Arm ${arm}: the container uses private HOME and XDG paths and the confirmed disable flags`, () => {
      expect(values(invocation(current()), "--env").sort(), "both arms need the private OpenCode environment").toEqual([...CONTAINER_ENV].sort());
    });

    it(`Arm ${arm}: the container never receives OPENCODE_API_KEY`, () => {
      const names = values(invocation(current()), "--env").map(value => value.split("=")[0]);
      expect(names, "Console OAuth replaces the OPENCODE_API_KEY container path").not.toContain("OPENCODE_API_KEY");
    });

    it(`Arm ${arm}: the runner resolves OpenCode from BENCH_OPENCODE_BIN, never from a PATH tripwire, including its version command`, () => {
      expect(existsSync(current().opencodeHit), "the OpenCode tripwire must stay unhit").toBe(false);
    });

    it(`Arm ${arm}: the whole run argv uses standalone JSON auto mode and the default model variant`, () => {
      const run = current();
      expect(existsSync(run.fake.capture), "the entry script must invoke the fake OpenCode, not Pi").toBe(true);
      const calls = readFileSync(run.fake.capture, "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect(calls.filter(call => call.argv[0] === "run").map(call => call.argv), "OpenCode must receive the exact run argv, without #variant or --thinking").toEqual([[
        "run", "--standalone", "--format", "json", "--auto",
        "--model", `opencode-go/${TEST_MODEL}`, PROMPT,
      ]]);
    });

    it(`Arm ${arm}: score.json records thinking_requested as default`, () => {
      const score = jsonIfPresent(resolve(current().out, "score.json"));
      expect(score?.thinking_requested, "O1 requires default even when THINKING=xhigh enters the host environment").toBe("default");
    });

    it(`Arm ${arm}: config denies question, websearch, and subagent but not webfetch`, () => {
      const rules = config(current()).permissions;
      expect(Array.isArray(rules), "OpenCode permissions must use the confirmed rule list").toBe(true);
      for (const action of ["question", "websearch", "subagent"]) {
        expect(rules.filter((rule: any) => rule.action === action), `${action} must have one deny and no allow`).toEqual([
          { action, resource: "*", effect: "deny" },
        ]);
      }
      expect(rules.filter((rule: any) => rule.action === "webfetch"), "O2 keeps webfetch available").toEqual([]);
    });

    it(`Arm ${arm}: config contains exactly the arm rules, skill paths, and instruction entry`, () => {
      const run = current();
      expect(config(run), "the generated config must contain no MCP server, plugin, reference, or extra rule").toEqual({
        $schema: "https://opencode.ai/config.json", model: `opencode-go/${TEST_MODEL}`,
        ...(arm === "b" ? { skills: { paths: ["/opt/skills"] }, instructions: ["/workspace/AGENTS.md"] } : {}),
        permissions: [...DENIES, ...(arm === "b" ? SKILLS.map(resource => ({ action: "skill", resource, effect: "allow" })) : [])],
      });
    });

    it(`Arm ${arm}: AGENTS.md presence and the five skill snapshots match the arm`, () => {
      const run = current();
      invocation(run);
      expect(run.podman.agents_exists, "only Arm B may expose the fixture AGENTS.md during the agent run").toBe(arm === "b");
      const snapshot = resolve(run.out, "executor/skills");
      if (arm === "a") expect(existsSync(snapshot), "Arm A must have no skill snapshot").toBe(false);
      else {
        expect(existsSync(snapshot), "Arm B must copy its five skills before the run").toBe(true);
        expect(readdirSync(snapshot).sort()).toEqual([...SKILLS].sort());
        for (const skill of SKILLS) expect(readFileSync(resolve(snapshot, skill, "SKILL.md"), "utf8")).toBe(readFileSync(resolve(run.skillRoot, skill, "SKILL.md"), "utf8"));
      }
    });
  }

  it("the arms differ only in the skill rules, skills.paths, instructions, and skill mount", () => {
    const [a, b] = runs;
    const ca = config(a), cb = config(b);
    expect(Object.hasOwn(ca, "instructions"), "Arm A must omit instructions").toBe(false);
    expect(cb.instructions, "Arm B must load only the fixture AGENTS.md").toEqual(["/workspace/AGENTS.md"]);
    expect(Object.hasOwn(ca, "skills"), "Arm A must omit skills.paths").toBe(false);
    expect(cb.skills).toEqual({ paths: ["/opt/skills"] });
    const commonB = { ...cb };
    delete commonB.instructions;
    delete commonB.skills;
    commonB.permissions = cb.permissions.filter((rule: any) => !(rule.action === "skill" && rule.effect === "allow"));
    expect(cb.permissions.length - commonB.permissions.length, "all five skill rules must differ").toBe(5);
    expect(commonB, "no other config difference is permitted").toEqual(ca);
    const normalize = (run: Run) => invocation(run)
      .flatMap((arg, index, argv) => arg === "--mount" && argv[index + 1]?.endsWith("dst=/opt/skills,ro") ? [] :
        arg.endsWith("dst=/opt/skills,ro") ? [] : [arg])
      .map(arg => arg.replaceAll(run.work, "<run>").replaceAll(run.temp, "<temp>"));
    expect(normalize(b), "the arms must share all other runtime arguments").toEqual(normalize(a));
  });
});
