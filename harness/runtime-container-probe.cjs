const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");

const marker = ".runtime-isolation-probe";
const loopbackPort = Number(process.env.BENCH_RUNTIME_PROBE_LOOPBACK_PORT);
const hostHomePath = process.env.BENCH_RUNTIME_PROBE_HOST_HOME_PATH;
const siblingRunPath = process.env.BENCH_RUNTIME_PROBE_SIBLING_RUN_PATH;
const legacy = process.env.BENCH_RUNTIME_PROBE_CONTRACT === "phase6";

const attemptWrite = (path, value) => {
  try {
    fs.writeFileSync(path, value);
    fs.rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
};
const rewriteCandidate = (path) => {
  try {
    const original = fs.readFileSync(path);
    fs.writeFileSync(path, original);
    return true;
  } catch {
    return false;
  }
};
const digest = (path) => fs.existsSync(path)
  ? crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex")
  : null;
const reachable = (host, port) => new Promise((resolveReachable) => {
  const socket = net.connect({ host, port });
  const done = (value) => { socket.destroy(); resolveReachable(value); };
  socket.setTimeout(700, () => done(false));
  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));
});

(async () => {
  const inputsValid = Number.isInteger(loopbackPort) && loopbackPort >= 1 && loopbackPort <= 65535
    && typeof hostHomePath === "string" && hostHomePath.startsWith("/")
    && typeof siblingRunPath === "string" && siblingRunPath.startsWith("/");
  if (!inputsValid) throw new Error("runtime probe inputs are invalid");
  const skillsRoot = "/opt/skills";
  const skills = fs.existsSync(skillsRoot) ? fs.readdirSync(skillsRoot).sort() : [];
  const skillsWritable = Object.fromEntries(skills.map((skill) => [
    skill,
    attemptWrite(`${skillsRoot}/${skill}/.${marker}`, "blocked"),
  ]));
  const candidateWritable = rewriteCandidate("/workspace/src/lib/loans.ts");
  const dependencyWritable = attemptWrite(`/workspace/node_modules/.${marker}`, "blocked");
  const piWritable = attemptWrite(`/opt/pi/.${marker}`, "blocked");
  const tmpWritable = attemptWrite(`/tmp/${marker}`, "allowed");
  const rootWritable = attemptWrite(`/.${marker}`, "blocked");
  const probe = {
    schema: 1,
    kind: legacy ? "phase6-isolation-probe" : "phase9-runtime-isolation-probe",
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    candidate_write: candidateWritable,
    dependency_write: dependencyWritable,
    pi_mount_write: piWritable,
    root_write: rootWritable,
    tmp_write: tmpWritable,
    candidate_writable: candidateWritable,
    fixture_dependencies_writable: dependencyWritable,
    pi_writable: piWritable,
    skills_writable: skillsWritable,
    tmp_writable: tmpWritable,
    root_writable: rootWritable,
    agents_exists: fs.existsSync("/workspace/AGENTS.md"),
    agents_sha256: digest("/workspace/AGENTS.md"),
    skills,
    harness_available: fs.existsSync("/harness"),
    reference_available: fs.existsSync("/reference"),
    probe_inputs_valid: inputsValid,
    probe_loopback_port: loopbackPort,
    probe_host_home_path: hostHomePath,
    probe_sibling_run_path: siblingRunPath,
    host_home_available: fs.existsSync(hostHomePath),
    sibling_run_available: fs.existsSync(siblingRunPath),
    host_loopback_reachable: await reachable("10.0.2.2", loopbackPort),
    probe_pi_mounted: fs.existsSync("/opt/pi"),
    probe_pi_writable: piWritable,
    probe_pi_sentinel_sha256: digest("/opt/pi/probe-pi-sentinel.txt"),
  };
  process.stdout.write(JSON.stringify(probe) + "\n");
})().catch((error) => {
  process.stderr.write(String(error));
  process.exitCode = 1;
});
