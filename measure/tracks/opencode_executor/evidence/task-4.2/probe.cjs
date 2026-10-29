"use strict";
// Container probe for the OpenCode arm contract (task 4.2).
// It starts one OpenCode server in the container, creates one session with
// no prompt, and calls the session-skill activation endpoint for each id.
// The script sends no prompt and makes no model call.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const MODE = process.env.PROBE_MODE || "probe";
const ARM = process.env.PROBE_ARM || "a";
const OUT = process.env.PROBE_OUT || "/out";
const PORT = Number(process.env.PROBE_PORT || "4123");
const PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || "";
const IDS = (
  process.env.PROBE_IDS ||
  "measure,next-best-practices,vercel-react-best-practices,vercel-composition-patterns,build-graph,pdf,opencode,report"
).split(",");
const OPENCODE_BIN = process.env.PROBE_OPENCODE_BIN || "/usr/local/bin/opencode";

const out = (line) => process.stdout.write(line + "\n");

function request(method, urlPath, body) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { Accept: "application/json" };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(payload.length);
    }
    if (PASSWORD) {
      headers.Authorization = "Basic " + Buffer.from("opencode:" + PASSWORD).toString("base64");
    }
    const req = http.request(
      { host: "127.0.0.1", port: PORT, method, path: urlPath, headers, timeout: 60000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", (e) => resolve({ status: 0, text: String((e && e.message) || e) }));
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The error name only. A response body can hold skill text, so it stays out
// of the archived files.
function errorName(text) {
  try {
    const parsed = JSON.parse(text);
    const name = parsed && parsed.error && parsed.error.name;
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

async function waitForServer() {
  const deadline = Date.now() + 90000;
  let last = null;
  while (Date.now() < deadline) {
    const res = await request("GET", "/openapi.json");
    last = res.status;
    if (res.status === 200) return true;
    await sleep(1000);
  }
  out("probe: server not ready, last status " + String(last));
  return false;
}

(async () => {
  for (const dir of ["/tmp/home", "/tmp/config", "/tmp/data", "/tmp/state", "/tmp/cache"]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const logPath = path.join(OUT, "startup.log");
  const logStream = fs.createWriteStream(logPath);
  const serverArgs = ["serve", "--port", String(PORT), "--hostname", "127.0.0.1"];
  if (process.env.PROBE_LOG_FLAGS === "1") {
    serverArgs.push("--print-logs", "--log-level", "all");
  }
  const child = spawn(OPENCODE_BIN, serverArgs, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });
  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  if (MODE === "explore") {
    const help = spawn(OPENCODE_BIN, ["serve", "--help"], { env: process.env });
    let helpText = "";
    help.stdout.on("data", (c) => (helpText += c.toString()));
    await new Promise((r) => help.on("exit", r));
    out("probe: opencode serve --help");
    out(helpText.trim());
  }
  const version = spawn(OPENCODE_BIN, ["--version"], { env: process.env });
  let versionText = "";
  version.stdout.on("data", (c) => (versionText += c.toString()));
  await new Promise((r) => version.on("exit", r));
  out("probe: opencode --version");
  out(versionText.trim());

  const ready = await waitForServer();
  if (!ready) {
    out("probe: server did not start");
    child.kill("SIGTERM");
    await sleep(500);
    logStream.end();
    out("probe: startup log:");
    out(fs.readFileSync(logPath, "utf8"));
    process.exit(3);
  }
  out("probe: server ready on 127.0.0.1:" + String(PORT));

  if (MODE === "explore") {
    const spec = await request("GET", "/openapi.json");
    let paths = [];
    try {
      const parsed = JSON.parse(spec.text);
      paths = Object.keys(parsed.paths || {}).filter((p) => /skill|session/i.test(p));
    } catch {
      paths = [];
    }
    out("probe: openapi paths with skill or session:");
    for (const p of paths.sort()) out("probe:   " + p);
    const config = await request("GET", "/api/config");
    out("probe: GET /api/config status=" + String(config.status));
  }

  const created = await request("POST", "/api/session", {});
  out("probe: POST /api/session status=" + String(created.status));
  if (MODE === "explore") {
    out("probe: session body head: " + created.text.slice(0, 600).replace(/\s+/g, " "));
  }
  let sessionId = "";
  try {
    const parsed = JSON.parse(created.text);
    const candidates = [
      parsed && parsed.id,
      parsed && parsed.info && parsed.info.id,
      parsed && parsed.data && parsed.data.id,
      parsed && parsed.data && parsed.data.info && parsed.data.info.id,
      parsed && parsed.session && parsed.session.id,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.length > 0) {
        sessionId = candidate;
        break;
      }
    }
  } catch {
    sessionId = "";
  }
  if (!sessionId) {
    out("probe: no session id in the response");
    child.kill("SIGTERM");
    await sleep(500);
    logStream.end();
    process.exit(4);
  }
  out("probe: session created");

  const lines = [];
  const apiLines = ["api arm=" + ARM + " post-session status=" + String(created.status)];
  for (const id of IDS) {
    const res = await request("POST", "/api/experimental/session/" + sessionId + "/skill", {
      id,
      resume: null,
    });
    const name = res.status >= 400 ? errorName(res.text) : "";
    lines.push("skill-probe arm=" + ARM + " id=" + id + " status=" + String(res.status));
    apiLines.push(
      "api arm=" + ARM + " id=" + id + " status=" + String(res.status) + (name ? " error=" + name : "")
    );
    out(lines[lines.length - 1] + (name ? " error=" + name : ""));
  }
  fs.writeFileSync(path.join(OUT, "skill-probe-" + ARM + ".txt"), lines.join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, "api-" + ARM + ".txt"), apiLines.join("\n") + "\n");

  child.kill("SIGTERM");
  await sleep(1500);
  if (exited === null) child.kill("SIGKILL");
  await new Promise((r) => logStream.end(r));
  out("probe: done");
  process.exit(0);
})().catch((error) => {
  out("probe: error " + String((error && error.stack) || error));
  process.exit(5);
});
