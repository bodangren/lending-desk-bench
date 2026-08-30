import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  batchModels,
  ema,
  emitPiModelsJson,
  goUsd,
  loadPricing,
  patchScoreGo,
  recostUsage,
  resolveGoModelId,
  slugifyModelId,
  trend,
  type GoPricing,
  type TokenUsage,
} from "../../go-cost";

const ROOT = resolve(import.meta.dirname, "../../..");
const PRICING_PATH = resolve(ROOT, "harness/go-pricing.json");

function clonePricing(): GoPricing {
  return JSON.parse(readFileSync(PRICING_PATH, "utf8")) as GoPricing;
}

describe("OpenCode Go recost", () => {
  it("loads the pinned table and selects High Usage batch models", () => {
    const { pricing } = loadPricing(PRICING_PATH);
    expect(pricing.schema).toBe(1);
    expect(pricing.high_usage_min_requests_per_month).toBe(7000);
    const batch = batchModels(pricing);
    expect(batch).toContain("mimo-v2.5");
    expect(batch).toContain("gpt-5.6-luna");
    expect(batch).toContain("muse-spark-1.2-contributor");
    expect(batch).toContain("deepseek-v4-flash-vision-exp");
    expect(batch).toContain("hy3");
    expect(batch).toContain("deepseek-v4-flash");
    expect(batch).not.toContain("kimi-k2.7-code");
    for (const id of batch) {
      expect(pricing.models[id].requests_per_month).toBeGreaterThan(7000);
    }
  });

  it("maps historical provider/model ids onto Go ids", () => {
    const { pricing } = loadPricing(PRICING_PATH);
    expect(resolveGoModelId("xiaomi/mimo-v2.5", pricing)).toBe("mimo-v2.5");
    expect(resolveGoModelId("opencode-go/mimo-v2.5", pricing)).toBe("mimo-v2.5");
    expect(resolveGoModelId("openrouter/inclusionai/ling-3.0-flash:free", pricing)).toBeNull();
  });

  it("computes percent of monthly usage from tokens", () => {
    const loaded = loadPricing(PRICING_PATH);
    const usage: TokenUsage = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    const go = recostUsage(usage, "mimo-v2.5", loaded);
    expect(go.unmapped).toBe(false);
    expect(go.usd).toBe(0.14);
    expect(go.monthly_usage_usd).toBe(60);
    expect(go.monthly_pct).toBe(0.233);
  });

  it("recalculates percent when the price table changes", () => {
    const loaded = loadPricing(PRICING_PATH);
    const usage: TokenUsage = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
    const before = recostUsage(usage, "mimo-v2.5", loaded);
    const mutated = clonePricing();
    mutated.models["mimo-v2.5"].rates.input = 1.4;
    mutated.models["mimo-v2.5"].monthly_usage_usd = 30;
    const after = recostUsage(usage, "mimo-v2.5", { pricing: mutated, sha256: "test" });
    expect(after.usd).not.toBe(before.usd);
    expect(after.monthly_pct).not.toBe(before.monthly_pct);
    expect(after.monthly_usage_usd).toBe(30);
  });

  it("uses the context-length tier when total input exceeds the threshold", () => {
    const { pricing } = loadPricing(PRICING_PATH);
    const luna = pricing.models["gpt-5.6-luna"];
    const low = goUsd({ input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }, luna.rates);
    const highRates = luna.tiers![0];
    const high = goUsd({ input: 300000, output: 0, cacheRead: 0, cacheWrite: 0 }, highRates);
    expect(high).toBeGreaterThan(low);
    const loaded = loadPricing(PRICING_PATH);
    const recosted = recostUsage({ input: 300000, output: 0, cacheRead: 0, cacheWrite: 0 }, "gpt-5.6-luna", loaded);
    expect(recosted.usd).toBe(high);
  });

  it("returns an unmapped record for models that are not on Go", () => {
    const loaded = loadPricing(PRICING_PATH);
    const go = recostUsage({ input: 10, output: 10 }, "openrouter/inclusionai/ling-3.0-flash:free", loaded);
    expect(go.unmapped).toBe(true);
    expect(go.usd).toBeNull();
    expect(go.monthly_pct).toBeNull();
  });

  it("emits a Pi models.json with per-model API and Anthropic base URL", () => {
    const { pricing } = loadPricing(PRICING_PATH);
    const doc = emitPiModelsJson(pricing) as {
      providers: { "opencode-go": { models: Array<{ id: string; api: string; baseUrl?: string }> } };
    };
    const models = doc.providers["opencode-go"].models;
    const luna = models.find((m) => m.id === "gpt-5.6-luna");
    const qwen = models.find((m) => m.id === "qwen3.8-flash");
    const mimo = models.find((m) => m.id === "mimo-v2.5");
    expect(luna?.api).toBe("openai-responses");
    expect(qwen?.api).toBe("anthropic-messages");
    expect(qwen?.baseUrl).toBe("https://opencode.ai/zen/go");
    expect(mimo?.api).toBe("openai-completions");
    expect(mimo?.baseUrl).toBe("https://opencode.ai/zen/go/v1");
  });

  it("slugifies dotted model ids for run ids", () => {
    expect(slugifyModelId("gpt-5.6-luna")).toBe("gpt-5-6-luna");
    expect(slugifyModelId("mimo-v2.5")).toBe("mimo-v2-5");
  });

  it("computes EMA and a 4-week range", () => {
    expect(ema([10, 20], 2)).toBe(12.9);
    const t = trend([
      { week: "2026w36", total: 40 },
      { week: "2026w35", total: 20 },
      { week: "2026w37", total: 50 },
    ]);
    expect(t?.n).toBe(3);
    expect(t?.min).toBe(20);
    expect(t?.max).toBe(50);
  });

  it("patches go onto an existing score without changing total", () => {
    const dir = mkdtempSync(join(tmpdir(), "go-recost-"));
    const path = join(dir, "score.json");
    writeFileSync(
      path,
      JSON.stringify({
        total: 71.2,
        model: "opencode-go/mimo-v2.5",
        usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    );
    const go = patchScoreGo(path, loadPricing(PRICING_PATH));
    const written = JSON.parse(readFileSync(path, "utf8")) as { total: number; go: { usd: number } };
    expect(written.total).toBe(71.2);
    expect(written.go.usd).toBe(go.usd);
    expect(go.usd).toBe(0.14);
    rmSync(dir, { recursive: true, force: true });
  });
});
