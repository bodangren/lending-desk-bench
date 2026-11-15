// DAILY_PICK: one model per day, untested first, then the stalest (track
// daily_model_schedule). The selection rule lives here so it stays pure: it
// reads only its flags and its files — no environment value, no network, and
// no write. cron-daily.sh owns every write; pick-oracle.py is the independent
// second implementation of the same contract, and the DAILY_PICK line must
// equal the PICK_ORACLE line for the same inputs.
//
//   Selection mode:
//     tsx daily-pick.ts --catalog <file> --served <file> --date <YYYY-MM-DD>
//        [--runs-root <dir>] [--pricing <file>] [--day-dir <dir>]
//        [--board <benchmark.json>] [--exclude <id1,id2,...>]
//     Defaults: <repo>/runs, harness/go-pricing.json, <repo>/reports/daily.
//   Run-list mode:
//     tsx daily-pick.ts --day-runs <id> --week <YYYYwWW>
//        [--runs-root <dir>] [--pricing <file>]
//
// The price table decides the rule. A table that declares
// `pick_min_requests_per_month` uses the pick list of spec D26 (the Go plan
// page): a model is on the list when `requests_unlimited` is true or
// `requests_per_month` is more than the minimum, and it holds no
// `superseded_by`. A `high_usage` or `batch` flag set to false keeps a model
// off the pick (D26 board filter, PM 2026-11-16). A table without the field
// keeps rule 4 and rule 5, so the synthetic tables of the older tests stay
// byte-for-byte.
//
// Exit 0 for a pick or a resume, 3 when no model is eligible, 2 for an input
// fault (one `daily-pick: <reason>` line on stderr, nothing on stdout).
// Ids compare in byte order (a < b).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPricing, resolveGoModelId, type GoPricing } from "./go-cost.js";
import { BENCH_TRACKS } from "./candidate-contract.js";

const REPO = resolve(fileURLToPath(import.meta.url), "../..");
const DEFAULT_RUNS = join(REPO, "runs");
const DEFAULT_PRICING = join(REPO, "harness", "go-pricing.json");
const DEFAULT_DAY_DIR = join(REPO, "reports", "daily");
const WEEK_TOKEN = /-(\d{4})w(\d{2})(?:-r\d+)?$/;

type Args = Record<string, string | undefined>;

function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function fault(reason: string): never {
  console.error(`daily-pick: ${reason}`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  let pending: string | null = null;
  for (const arg of argv) {
    if (pending !== null) {
      args[pending] = arg;
      pending = null;
      continue;
    }
    if (arg === "--catalog" || arg === "--served" || arg === "--date" || arg === "--runs-root"
      || arg === "--pricing" || arg === "--day-dir" || arg === "--day-runs" || arg === "--week"
      || arg === "--board" || arg === "--exclude") {
      pending = arg.slice(2).replaceAll("-", "_");
      continue;
    }
    fault(`unknown argument ${arg}`);
  }
  if (pending !== null) fault(`--${pending} requires a value`);
  return args;
}

// The ISO week token `<YYYY>w<WW>` of a UTC date, and the Sunday of one.
function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}w${String(week).padStart(2, "0")}`;
}

function sundayOfIsoWeek(week: string): string {
  const match = /^(\d{4})w(\d{2})$/.exec(week);
  if (!match) fault(`invalid week token ${week}`);
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() + 1 - day);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + (Number(match[2]) - 1) * 7 + 6);
  return sunday.toISOString().slice(0, 10);
}

function parseDay(value: string | undefined, flag: string): string {
  if (value === undefined) fault(`--${flag} is required`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fault(`invalid date ${value}`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) fault(`invalid date ${value}`);
  return value;
}

function requireDir(value: string | undefined, label: string, fallback: string): string {
  const dir = value ?? fallback;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fault(`${label} ${dir} is missing`);
  return dir;
}

// The board file of spec D23: the ranked ids (`models[].id`) and the history
// ids (`history.models[].id`). A board that does not exist yet counts as
// empty, so the job can pass the file before the first publish (D23).
type Board = { ranked: Set<string>; history: Set<string> };

function loadBoard(value: string | undefined): Board | null {
  if (value === undefined || value === "") return null;
  const board: Board = { ranked: new Set<string>(), history: new Set<string>() };
  if (!existsSync(value)) return board;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(value, "utf8"));
  } catch {
    fault(`the board file ${value} is not JSON`);
  }
  if (!isRecord(parsed)) return board;
  const ranked = Array.isArray(parsed.models) ? parsed.models : [];
  for (const entry of ranked) {
    if (isRecord(entry) && typeof entry.id === "string") board.ranked.add(entry.id);
  }
  const history = isRecord(parsed.history) ? parsed.history.models : undefined;
  const historyModels = Array.isArray(history) ? history : [];
  for (const entry of historyModels) {
    if (isRecord(entry) && typeof entry.id === "string") board.history.add(entry.id);
  }
  return board;
}

type DayRecord = { date: string; model?: string; run_ids: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Every *.json in the day directory must be a valid record (spec 5.4): an
// invalid record of any date is an input fault, so a broken write stops the
// job instead of silently changing the run dates.
function loadDayRecords(dayDir: string): DayRecord[] {
  if (!existsSync(dayDir)) return [];
  const records: DayRecord[] = [];
  for (const name of readdirSync(dayDir).sort(byteOrder)) {
    if (!name.endsWith(".json")) continue;
    const path = join(dayDir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      fault(`day record ${name} is not JSON`);
    }
    const rec = parsed as Record<string, unknown>;
    if (!isRecord(rec) || typeof rec.date !== "string" || !Array.isArray(rec.run_ids)
      || !rec.run_ids.every((id) => typeof id === "string")) {
      fault(`day record ${name} has no date string or run_ids array`);
    }
    records.push({ date: rec.date, model: rec.model as string | undefined, run_ids: rec.run_ids as string[] });
  }
  return records;
}

// The date of one OpenCode run: the latest day record that lists the run id,
// else the Sunday of the ISO week in the run id, else the zero date. A
// directory time is never a test date (spec EV6).
type RunScan = { last: Map<string, string>; weeks: Map<string, Set<string>> };

function scanRuns(runsRoot: string, pricing: GoPricing, rundate: Map<string, string>): RunScan {
  const last = new Map<string, string>();
  const weeks = new Map<string, Set<string>>();
  for (const name of readdirSync(runsRoot).sort(byteOrder)) {
    const provenancePath = join(runsRoot, name, "artifacts", "provenance.json");
    if (!existsSync(provenancePath) || !statSync(provenancePath).isFile()) continue;
    let provenance: unknown;
    try {
      provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    } catch {
      continue; // a run whose provenance.json is not JSON leaves its model untested
    }
    if (!isRecord(provenance)) continue;
    const executor = provenance.executor;
    if (!isRecord(executor) || executor.kind !== "opencode") continue;
    const model = typeof provenance.model === "string" ? resolveGoModelId(provenance.model, pricing) : null;
    if (model === null) continue;
    if (provenance.arm !== "a" && provenance.arm !== "b") continue;
    if (typeof provenance.track !== "string" || !BENCH_TRACKS.includes(provenance.track as never)) continue;
    const token = WEEK_TOKEN.exec(name);
    let date: string;
    if (rundate.has(name)) {
      date = rundate.get(name)!;
    } else if (token) {
      date = sundayOfIsoWeek(`${token[1]}w${token[2]}`);
    } else {
      date = "0000-00-00";
    }
    const previous = last.get(model) ?? "";
    if (date > previous) last.set(model, date);
    if (token) {
      const set = weeks.get(model) ?? new Set<string>();
      set.add(`${token[1]}w${token[2]}`);
      weeks.set(model, set);
    }
  }
  return { last, weeks };
}

// Run-list mode: the sorted run ids of the OpenCode runs of one model in one
// ISO week. Pi runs, local runs, and other weeks or models never appear.
function runList(args: Args): never {
  const week = args.week;
  if (week === undefined) fault("--week is required");
  if (!/^\d{4}w\d{2}$/.test(week)) fault(`invalid week token ${week}`);
  const runsRoot = requireDir(args.runs_root, "runs root", DEFAULT_RUNS);
  let pricing: GoPricing;
  try {
    pricing = loadPricing(args.pricing ?? DEFAULT_PRICING).pricing;
  } catch (error) {
    fault(`cannot read the price table: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  }
  const ids: string[] = [];
  for (const name of readdirSync(runsRoot).sort(byteOrder)) {
    const provenancePath = join(runsRoot, name, "artifacts", "provenance.json");
    if (!existsSync(provenancePath) || !statSync(provenancePath).isFile()) continue;
    let provenance: unknown;
    try {
      provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    } catch {
      continue;
    }
    if (!isRecord(provenance)) continue;
    const executor = provenance.executor;
    if (!isRecord(executor) || executor.kind !== "opencode") continue;
    const model = typeof provenance.model === "string" ? resolveGoModelId(provenance.model, pricing) : null;
    if (model !== args.day_runs) continue;
    if (provenance.arm !== "a" && provenance.arm !== "b") continue;
    if (typeof provenance.track !== "string" || !BENCH_TRACKS.includes(provenance.track as never)) continue;
    const token = WEEK_TOKEN.exec(name);
    if (token && `${token[1]}w${token[2]}` === week) ids.push(name);
  }
  ids.sort(byteOrder);
  console.log(JSON.stringify(ids));
  process.exit(0);
}

function selection(args: Args): never {
  const date = parseDay(args.date, "date");
  const week = isoWeek(date);
  const runsRoot = requireDir(args.runs_root, "runs root", DEFAULT_RUNS);
  const dayDir = args.day_dir ?? DEFAULT_DAY_DIR;
  // D26: `--exclude` keeps the tried models out of the pick and the order.
  const excluded = new Set(
    (args.exclude ?? "").split(",").map((id) => id.trim()).filter((id) => id !== ""),
  );

  let pricing: GoPricing;
  try {
    pricing = loadPricing(args.pricing ?? DEFAULT_PRICING).pricing;
  } catch (error) {
    fault(`cannot read the price table: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
  }
  const models = pricing.models;
  const provider = String(pricing.provider ?? "opencode-go");
  // The D26 pick list is active only when the table declares its minimum. A
  // synthetic or older table without the field keeps rule 4 and rule 5.
  const pickMinRaw = pricing.pick_min_requests_per_month;
  const pickMin = typeof pickMinRaw === "number" && Number.isFinite(pickMinRaw) ? pickMinRaw : null;

  let catalog: unknown;
  try {
    catalog = JSON.parse(readFileSync(requireFile(args.catalog, "catalog"), "utf8"));
  } catch {
    fault("the catalog is empty, not JSON, or has no live models");
  }
  const liveRaw = (catalog as Record<string, unknown>)?.live;
  if (!Array.isArray(liveRaw) || liveRaw.length === 0 || !liveRaw.every((id) => typeof id === "string")) {
    fault("the catalog is empty, not JSON, or has no live models");
  }
  const live = [...new Set(liveRaw as string[])];

  const served = new Set(
    readFileSync(requireFile(args.served, "served"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  if (served.size === 0) fault("the served list is empty");

  const records = loadDayRecords(dayDir);
  const today = records.find((record) => record.date === date);
  // D26: the selector resumes from the day record only when the exclude list
  // is empty. A day record with a non-empty exclude list gives a new choice.
  if (today && excluded.size === 0) {
    const resume = { schema: 1, date, week, model: today.model, reason: "resume" };
    console.log(JSON.stringify(resume));
    console.error(`DAILY_PICK date=${date} model=${today.model} reason=resume`);
    process.exit(0);
  }

  const rundate = new Map<string, string>();
  for (const record of records) {
    for (const runId of record.run_ids) {
      const previous = rundate.get(runId) ?? "";
      if (record.date > previous) rundate.set(runId, record.date);
    }
  }

  const { last, weeks } = scanRuns(runsRoot, pricing, rundate);

  // A served model matches an exact line <provider>/<id>; a substring is a
  // defect (case 6.1.11). The excluded lists sort in byte order.
  const unpriced = live.filter((id) => !models[id]).sort(byteOrder);
  const gone = Object.keys(models).filter((id) => !live.includes(id)).sort(byteOrder);
  const priced = live.filter((id) => models[id] && served.has(`${provider}/${id}`)).sort(byteOrder);
  const unservable = live.filter((id) => models[id] && !served.has(`${provider}/${id}`)).sort(byteOrder);
  const requests = (id: string): number => {
    const value = models[id]?.requests_per_month;
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  // Rule 4 order: requests highest first, then the id in byte order.
  const byRequests = (a: string, b: string): number => {
    const ra = requests(a);
    const rb = requests(b);
    if (ra !== rb) return rb - ra;
    return byteOrder(a, b);
  };
  // Rule 5 order: last test date oldest first, then requests highest first,
  // then the id in byte order.
  const byStalest = (a: string, b: string): number => {
    const la = last.get(a) ?? "0000-00-00";
    const lb = last.get(b) ?? "0000-00-00";
    if (la !== lb) return la < lb ? -1 : 1;
    return byRequests(a, b);
  };

  if (pickMin === null) {
    // Rule 4 and rule 5 stay apart. An untested candidate has no run at all,
    // so it has no last test date. A tested candidate whose run id has no week
    // token has the zero date. That candidate competes in the stalest set only.
    const candidates = priced;
    const thisWeek = candidates.filter((id) => weeks.get(id)?.has(week)).sort(byteOrder);
    const eligible = candidates.filter((id) => !weeks.get(id)?.has(week) && !excluded.has(id));
    const untested = eligible.filter((id) => !last.has(id));
    const tested = eligible.filter((id) => last.has(id));
    untested.sort(byRequests);
    tested.sort(byStalest);
    // The order holds every eligible candidate. The pick is the first one.
    const ranked = untested.length > 0 ? [...untested, ...tested] : tested;

    const order = ranked.map((id) => ({
      model: id,
      last_test: last.get(id) ?? null,
      requests_per_month: requests(id),
    }));

    const pick = ranked[0] ?? null;
    const reason = pick === null ? "none" : last.has(pick) ? "stalest" : "untested";
    const output = {
      schema: 1,
      date,
      week,
      model: pick,
      reason,
      last_test: pick === null ? null : last.get(pick) ?? null,
      counts: { live: live.length, candidates: candidates.length, eligible: eligible.length, untested: untested.length },
      excluded: { unpriced, gone, unservable, this_week: thisWeek },
      order,
    };
    console.log(JSON.stringify(output));
    console.error(`DAILY_PICK date=${date} model=${pick ?? "none"} reason=${reason}`
      + ` last_test=${output.last_test ?? "none"} candidates=${candidates.length}`
      + ` eligible=${eligible.length} untested=${untested.length}`);
    process.exit(pick === null ? 3 : 0);
  }

  // The pick list of D26. A model at or under the minimum is never on the
  // list, and a superseded model is never on the list.
  const onList = (id: string): boolean => {
    const spec = models[id];
    if (!spec) return false;
    if (spec.superseded_by) return false;
    if (spec.requests_unlimited === true) return true;
    const rpm = spec.requests_per_month;
    return typeof rpm === "number" && Number.isFinite(rpm) && rpm > pickMin;
  };
  // The board filter of D26 (PM 2026-11-16): a candidate is on the OpenCode
  // Go high-use list when `high_usage` and `batch` are set, the same filter as
  // `batch_models` in export-site-data.py. A missing flag counts as set, so
  // the synthetic tables of the older cases keep their candidates.
  const onHighUse = (id: string): boolean => {
    const spec = models[id];
    return spec?.high_usage !== false && spec?.batch !== false;
  };
  // The list order: unlimited models first in page order, then the counts
  // highest first, equal counts in page order, then the id in byte order.
  const listKey = (id: string): [number, number, number, number, string] => {
    const spec = models[id];
    const unlimited = spec?.requests_unlimited === true;
    const order = typeof spec?.page_order === "number" && Number.isFinite(spec.page_order)
      ? spec.page_order
      : null;
    return [
      unlimited ? 0 : 1,
      unlimited ? 0 : -requests(id),
      order === null ? 1 : 0,
      order ?? 0,
      id,
    ];
  };
  const byListKey = (a: string, b: string): number => {
    const ka = listKey(a);
    const kb = listKey(b);
    for (let index = 0; index < 4; index += 1) {
      const left = ka[index] as number;
      const right = kb[index] as number;
      if (left !== right) return left - right;
    }
    return byteOrder(a, b);
  };

  const board = loadBoard(args.board);
  const candidates = priced.filter((id) => onList(id) && onHighUse(id));
  const thisWeek = candidates.filter((id) => weeks.get(id)?.has(week)).sort(byteOrder);
  // Newness of D26: not in `models[].id` of the board. A history model counts
  // as new. Without the board flag every list candidate counts as new.
  const newCandidates = (board === null ? candidates : candidates.filter((id) => !board.ranked.has(id)))
    .filter((id) => !excluded.has(id));
  const eligible = newCandidates.filter((id) => !weeks.get(id)?.has(week));
  eligible.sort(byListKey);
  const untested = eligible.filter((id) => !last.has(id));

  const order = eligible.map((id) => ({
    model: id,
    last_test: last.get(id) ?? null,
    requests_per_month: requests(id),
  }));

  const pick = eligible[0] ?? null;
  const reason = pick === null ? "none" : last.has(pick) ? "stalest" : "untested";
  const group = pick === null || board === null
    ? 0
    : board.ranked.has(pick) ? 3 : board.history.has(pick) ? 2 : 1;
  const isNew = group === 1 || group === 2;
  const output: Record<string, unknown> = {
    schema: 1,
    date,
    week,
    model: pick,
    reason,
    last_test: pick === null ? null : last.get(pick) ?? null,
    counts: { live: live.length, candidates: candidates.length, eligible: eligible.length, untested: untested.length },
    excluded: { unpriced, gone, unservable, this_week: thisWeek },
    order,
  };
  if (board !== null) {
    output.group = group;
    output.new = isNew;
  }
  console.log(JSON.stringify(output));
  let line = `DAILY_PICK date=${date} model=${pick ?? "none"} reason=${reason}`
    + ` last_test=${output.last_test ?? "none"} candidates=${candidates.length}`
    + ` eligible=${eligible.length} untested=${untested.length}`;
  if (board !== null && pick !== null) {
    line += ` group=${group} new=${isNew ? "yes" : "no"}`;
  }
  console.error(line);
  process.exit(pick === null ? 3 : 0);
}

function requireFile(value: string | undefined, label: string): string {
  if (value === undefined) fault(`--${label} is required`);
  if (!existsSync(value)) fault(`the ${label} file ${value} is missing`);
  return value;
}

const args = parseArgs(process.argv.slice(2));
try {
  if (args.day_runs !== undefined) runList(args);
  else selection(args);
} catch (error) {
  fault(error instanceof Error ? error.message.split("\n")[0] : String(error));
}
