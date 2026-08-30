import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRICING_PATH = resolve(HERE, "go-pricing.json");

export type TokenUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

export type GoRates = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  inputTokensAbove?: number;
};

export type GoApi = "openai-completions" | "openai-responses" | "anthropic-messages";

export type GoModel = {
  name: string;
  api: GoApi;
  high_usage: boolean;
  batch: boolean;
  requests_per_month: number;
  monthly_usage_usd: number;
  rates: GoRates;
  tiers?: GoRates[];
  peak_rates?: GoRates;
  max_tokens?: number;
  context_window?: number;
};

export type GoPricing = {
  schema: 1;
  source: string;
  retrieved: string;
  high_usage_min_requests_per_month: number;
  deepseek_rate: string;
  provider: string;
  apis: Record<GoApi, { baseUrl: string }>;
  aliases: Record<string, string>;
  models: Record<string, GoModel>;
};

export type GoCost = {
  model_id: string | null;
  pricing_sha256: string;
  usd: number | null;
  monthly_usage_usd: number | null;
  monthly_pct: number | null;
  unmapped: boolean;
  rate: string | null;
};

export type TrendPoint = { week: string; total: number };
export type Trend = { ema: number; min: number; max: number; n: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function slugifyModelId(id: string): string {
  return id.replaceAll(".", "-");
}

export function pricingSha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function loadPricing(path: string = DEFAULT_PRICING_PATH): { pricing: GoPricing; sha256: string; raw: string } {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as GoPricing;
  if (parsed.schema !== 1 || !isRecord(parsed.models)) {
    throw new Error("go-pricing.json is malformed");
  }
  return { pricing: parsed, sha256: pricingSha256(raw), raw };
}

export function resolveGoModelId(model: string | undefined, pricing: GoPricing): string | null {
  if (!model) return null;
  if (pricing.models[model]) return model;
  if (pricing.aliases[model]) return pricing.aliases[model];
  const slash = model.lastIndexOf("/");
  if (slash >= 0) {
    const tail = model.slice(slash + 1);
    if (pricing.models[tail]) return tail;
    if (pricing.aliases[tail]) return pricing.aliases[tail];
  }
  return null;
}

function selectRates(model: GoModel, usage: TokenUsage): GoRates {
  const inputTokens = num(usage.input) + num(usage.cacheRead) + num(usage.cacheWrite);
  let rates = model.rates;
  if (model.tiers) {
    for (const tier of model.tiers) {
      if (tier.inputTokensAbove != null && inputTokens > tier.inputTokensAbove) rates = tier;
    }
  }
  return rates;
}

export function goUsd(usage: TokenUsage, rates: GoRates): number {
  const usd =
    (num(usage.input) / 1e6) * rates.input +
    (num(usage.output) / 1e6) * rates.output +
    (num(usage.cacheRead) / 1e6) * rates.cacheRead +
    (num(usage.cacheWrite) / 1e6) * rates.cacheWrite;
  return Math.round(usd * 1e6) / 1e6;
}

export function recostUsage(
  usage: TokenUsage,
  model: string | undefined,
  loaded: { pricing: GoPricing; sha256: string } = loadPricing(),
): GoCost {
  const modelId = resolveGoModelId(model, loaded.pricing);
  const empty: GoCost = {
    model_id: modelId,
    pricing_sha256: loaded.sha256,
    usd: null,
    monthly_usage_usd: null,
    monthly_pct: null,
    unmapped: true,
    rate: null,
  };
  if (!modelId) return empty;
  const spec = loaded.pricing.models[modelId];
  if (!spec) return empty;
  const usd = goUsd(usage, selectRates(spec, usage));
  const monthly = spec.monthly_usage_usd;
  const monthlyPct = monthly > 0 ? Math.round((100 * usd) / monthly * 1000) / 1000 : null;
  return {
    model_id: modelId,
    pricing_sha256: loaded.sha256,
    usd,
    monthly_usage_usd: monthly,
    monthly_pct: monthlyPct,
    unmapped: false,
    rate: loaded.pricing.deepseek_rate,
  };
}

export function batchModels(pricing: GoPricing = loadPricing().pricing): string[] {
  return Object.entries(pricing.models)
    .filter(([, spec]) => spec.high_usage && spec.batch)
    .sort((a, b) => b[1].requests_per_month - a[1].requests_per_month)
    .map(([id]) => id);
}

export function batchLines(pricing: GoPricing = loadPricing().pricing): string[] {
  const provider = pricing.provider;
  return batchModels(pricing).map((id) => `${provider}|${id}|${slugifyModelId(id)}`);
}

export function ema(values: number[], halfLifeWeeks = 2): number | null {
  if (values.length === 0) return null;
  const alpha = 1 - 0.5 ** (1 / halfLifeWeeks);
  let acc = values[0];
  for (let i = 1; i < values.length; i++) acc = alpha * values[i] + (1 - alpha) * acc;
  return Math.round(acc * 10) / 10;
}

export function trend(points: TrendPoint[], halfLifeWeeks = 2): Trend | null {
  if (points.length === 0) return null;
  const ordered = points.slice().sort((a, b) => a.week.localeCompare(b.week));
  const values = ordered.map((p) => p.total);
  const last4 = values.slice(-4);
  return {
    ema: ema(values, halfLifeWeeks) ?? values[values.length - 1],
    min: Math.min(...last4),
    max: Math.max(...last4),
    n: values.length,
  };
}

export function emitPiModelsJson(pricing: GoPricing = loadPricing().pricing): unknown {
  const models = Object.entries(pricing.models).map(([id, spec]) => {
    const apiBase = pricing.apis[spec.api];
    const cost: Record<string, unknown> = {
      input: spec.rates.input,
      output: spec.rates.output,
      cacheRead: spec.rates.cacheRead,
      cacheWrite: spec.rates.cacheWrite,
    };
    if (spec.tiers?.length) {
      cost.tiers = spec.tiers.map((tier) => ({
        inputTokensAbove: tier.inputTokensAbove,
        input: tier.input,
        output: tier.output,
        cacheRead: tier.cacheRead,
        cacheWrite: tier.cacheWrite,
      }));
    }
    const row: Record<string, unknown> = {
      id,
      name: spec.name,
      api: spec.api,
      reasoning: true,
      cost,
    };
    if (apiBase?.baseUrl) row.baseUrl = apiBase.baseUrl;
    // Pi defaults to 16384 max output tokens. hy3 spends its whole budget on
    // thinking at --thinking max and dies with stopReason "length" before any
    // write, which the runner then voids as "agent produced no changes".
    // The Go endpoint accepts larger budgets, so pin hy3's real one here.
    if (spec.max_tokens) row.maxTokens = spec.max_tokens;
    if (spec.context_window) row.contextWindow = spec.context_window;
    return row;
  });
  const defaultApi = pricing.apis["openai-completions"];
  return {
    providers: {
      [pricing.provider]: {
        baseUrl: defaultApi.baseUrl,
        api: "openai-completions",
        authHeader: true,
        apiKey: "$OPENCODE_API_KEY",
        models,
      },
    },
  };
}

export function patchScoreGo(scorePath: string, loaded = loadPricing()): GoCost {
  const score = JSON.parse(readFileSync(scorePath, "utf8")) as Record<string, unknown>;
  const usage = isRecord(score.usage) ? (score.usage as TokenUsage) : {};
  const model = typeof score.model === "string" ? score.model : undefined;
  const go = recostUsage(usage, model, loaded);
  score.go = go;
  writeFileSync(scorePath, JSON.stringify(score, null, 2) + "\n");
  return go;
}

async function catalogDiff(pricing: GoPricing): Promise<{ live: string[]; missing: string[]; extra: string[] }> {
  const response = await fetch("https://opencode.ai/zen/go/v1/models");
  if (!response.ok) throw new Error(`Go catalog HTTP ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  const live = (payload.data ?? []).map((row) => row.id).filter((id): id is string => typeof id === "string");
  const known = Object.keys(pricing.models);
  const liveSet = new Set(live);
  const knownSet = new Set(known);
  return {
    live,
    missing: known.filter((id) => !liveSet.has(id)),
    extra: live.filter((id) => !knownSet.has(id)),
  };
}

async function main(argv: string[]): Promise<void> {
  const loaded = loadPricing();
  if (argv.includes("--hash")) {
    console.log(loaded.sha256);
    return;
  }
  if (argv.includes("--models-json")) {
    console.log(JSON.stringify(emitPiModelsJson(loaded.pricing), null, 2));
    return;
  }
  if (argv.includes("--batch-lines")) {
    for (const line of batchLines(loaded.pricing)) console.log(line);
    return;
  }
  if (argv.includes("--ids")) {
    for (const id of batchModels(loaded.pricing)) console.log(id);
    return;
  }
  const recostIdx = argv.indexOf("--recost");
  if (recostIdx >= 0) {
    const model = argv[recostIdx + 1];
    const usage = JSON.parse(readFileSync(0, "utf8")) as TokenUsage;
    console.log(JSON.stringify(recostUsage(usage, model, loaded), null, 2));
    return;
  }
  const patchIdx = argv.indexOf("--patch-score");
  if (patchIdx >= 0) {
    const path = argv[patchIdx + 1];
    if (!path || !existsSync(path)) throw new Error("score.json path is required");
    console.log(JSON.stringify(patchScoreGo(path, loaded), null, 2));
    return;
  }
  if (argv.includes("--catalog")) {
    console.log(JSON.stringify(await catalogDiff(loaded.pricing), null, 2));
    return;
  }
  console.log(JSON.stringify({ sha256: loaded.sha256, batch: batchModels(loaded.pricing) }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main(process.argv.slice(2));
}
