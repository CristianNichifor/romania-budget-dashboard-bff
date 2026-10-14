import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import { loadConfig } from "../../src/infra/config";

const staticEnv = {
  NODE_ENV: "test",
  DATA_SOURCE: "static",
  DATA_SOURCE_INS: "static",
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["Date"],
    now: new Date("2026-10-14T12:00:00Z"),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HACK_FOR_FACTS_YEAR", () => {
  it("is optional", () => {
    expect(loadConfig({}).hackForFactsYear).toBeUndefined();
    expect(loadConfig({ HACK_FOR_FACTS_YEAR: "" }).hackForFactsYear).toBe(
      undefined
    );
    expect(loadConfig({ HACK_FOR_FACTS_YEAR: "2023" }).hackForFactsYear).toBe(
      "2023"
    );
  });
});

describe("default budget year", () => {
  it("queries the latest complete year when no year is given", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        bodies.push(init?.body ?? "");
        return { ok: false, status: 503, json: async () => ({}) };
      })
    );

    await worker.request(
      "/api/budget/summary",
      {},
      { DATA_SOURCE: "hackforfacts", HACK_FOR_FACTS_TIMEOUT_MS: "20001" }
    );

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("2025");
    expect(bodies[0]).not.toContain("2026");
  });

  it("reports the default year next to the year list", async () => {
    const live = await worker.request(
      "/api/budget/years",
      {},
      { DATA_SOURCE: "hackforfacts" }
    );
    expect(await live.json()).toMatchObject({ defaultYear: 2025 });

    const pinned = await worker.request(
      "/api/budget/years",
      {},
      { DATA_SOURCE: "hackforfacts", HACK_FOR_FACTS_YEAR: "2023" }
    );
    expect(await pinned.json()).toMatchObject({ defaultYear: 2023 });
  });
});

describe("partial flag", () => {
  it("marks the in-progress year as partial", async () => {
    const response = await worker.request(
      "/api/budget/summary?year=2026",
      {},
      staticEnv
    );
    expect(await response.json()).toMatchObject({ year: 2026, partial: true });

    const institutions = await worker.request(
      "/api/budget/institutions?category=pensii&year=2026",
      {},
      staticEnv
    );
    expect(await institutions.json()).toMatchObject({ partial: true });
  });

  it("marks complete years as not partial", async () => {
    const institutions = await worker.request(
      "/api/budget/institutions?category=pensii&year=2025",
      {},
      staticEnv
    );
    expect(await institutions.json()).toMatchObject({ partial: false });
  });
});
