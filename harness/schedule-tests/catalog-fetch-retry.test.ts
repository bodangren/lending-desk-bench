import { describe, expect, it, vi } from "vitest";

/**
 * The catalog fetch retry test of FR-13 (spec D17).
 *
 * The live day of 2026-11-08 01:00 lost the day at the catalog fetch with
 * no retry (spec EV16). Spec D17 gives the rule: `fetchCatalogIds(token,
 * fetchImpl, delaysSeconds)` makes up to `delaysSeconds.length + 1` calls
 * of `GO_CATALOG_URL` with the header `authorization: Bearer <token>`. It
 * retries a throw or a status of 429 or 500-599. Any other non-ok status
 * throws `Go catalog HTTP <status>` at once. After each failed call it
 * writes one `console.error` line `go-cost: catalog attempt <n>/<N> failed:
 * HTTP <status>` or `... failed: network error`. After the last failed
 * call it throws `Go catalog HTTP <status>` or `Go catalog network error`.
 * It never prints the token.
 *
 * The test passes a fake `fetchImpl`. It calls no network. No test writes
 * under the real `.tmp/`, `runs/`, or `reports/`.
 */

import { fetchCatalogIds } from "../go-cost";

const TIMEOUT = 120_000;
const TOKEN = "fake-token-C5-42";
const DELAYS = [0, 0];

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function okResponse(ids: string[]): FakeResponse {
  return { ok: true, status: 200, json: async () => ({ data: ids.map((id) => ({ id })) }) };
}

function statusResponse(status: number): FakeResponse {
  return { ok: false, status, json: async () => ({}) };
}

/** A fake fetch that plays the listed steps in order and records the inits. */
function fakeFetch(steps: Array<FakeResponse | Error>, inits: Array<Record<string, unknown>>) {
  let call = 0;
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    call += 1;
    inits.push({ ...(init ?? {}) });
    const step = steps[call - 1] ?? steps.at(-1);
    if (step instanceof Error) throw step;
    return step;
  }) as unknown as typeof fetch;
}

/** The console.error lines captured during one call. */
function errorLines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((args) => args.map(String).join(" "));
}

describe("the catalog fetch retry of FR-13", () => {
  it("retries a network throw once and returns the ids", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const inits: Array<Record<string, unknown>> = [];
      const fetchImpl = fakeFetch([new TypeError("fetch failed"), okResponse(["a", "b"])], inits);
      const ids = await fetchCatalogIds(TOKEN, fetchImpl, DELAYS);
      expect(ids).toEqual(["a", "b"]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const lines = errorLines(spy);
      expect(lines, `the fetch wrote ${lines.length} lines instead of 1: ${JSON.stringify(lines)}`)
        .toEqual(["go-cost: catalog attempt 1/3 failed: network error"]);
    } finally { spy.mockRestore(); }
  }, TIMEOUT);

  it("retries two 5xx statuses and returns the ids on the third call", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const inits: Array<Record<string, unknown>> = [];
      const fetchImpl = fakeFetch([statusResponse(503), statusResponse(502), okResponse(["a", "b"])], inits);
      const ids = await fetchCatalogIds(TOKEN, fetchImpl, DELAYS);
      expect(ids).toEqual(["a", "b"]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      const lines = errorLines(spy);
      expect(lines, `the fetch wrote the wrong attempt lines: ${JSON.stringify(lines)}`)
        .toEqual([
          "go-cost: catalog attempt 1/3 failed: HTTP 503",
          "go-cost: catalog attempt 2/3 failed: HTTP 502",
        ]);
    } finally { spy.mockRestore(); }
  }, TIMEOUT);

  it("throws Go catalog HTTP 503 after three failed calls", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const inits: Array<Record<string, unknown>> = [];
      const fetchImpl = fakeFetch([statusResponse(503), statusResponse(503), statusResponse(503)], inits);
      await expect(fetchCatalogIds(TOKEN, fetchImpl, DELAYS)).rejects.toThrow(/Go catalog HTTP 503/);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally { spy.mockRestore(); }
  }, TIMEOUT);

  it("throws Go catalog HTTP 401 at once on a non-retryable status", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const inits: Array<Record<string, unknown>> = [];
      const fetchImpl = fakeFetch([statusResponse(401)], inits);
      await expect(fetchCatalogIds(TOKEN, fetchImpl, DELAYS)).rejects.toThrow(/Go catalog HTTP 401/);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  }, TIMEOUT);

  it("carries the authorization header on every call and never prints the token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const inits: Array<Record<string, unknown>> = [];
      const fetchImpl = fakeFetch([statusResponse(503), okResponse(["a", "b"])], inits);
      const ids = await fetchCatalogIds(TOKEN, fetchImpl, DELAYS);
      expect(ids).toEqual(["a", "b"]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      for (const [i, init] of inits.entries()) {
        const header = (init.headers ?? {}) as Record<string, string>;
        expect(header.authorization, `the call ${i + 1} does not carry the bearer header`)
          .toBe(`Bearer ${TOKEN}`);
      }
      for (const line of errorLines(spy)) {
        expect(line, "a console.error line holds the token").not.toContain(TOKEN);
      }
    } finally { spy.mockRestore(); }
  }, TIMEOUT);
});
