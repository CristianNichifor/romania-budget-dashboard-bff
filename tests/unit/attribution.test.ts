import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_SOURCES,
  attributionFor,
  attributionHeader,
  withAttribution,
} from "../../src/common/attribution";
import { loadConfig } from "../../src/infra/config";

const live = loadConfig({
  DATA_SOURCE: "hackforfacts",
  DATA_SOURCE_INS: "eurostat",
});
const demo = loadConfig({ DATA_SOURCE: "static", DATA_SOURCE_INS: "static" });

const names = (path: string, config = live): string[] =>
  attributionFor(path, config).map((source) => source.name);

describe("attributionFor", () => {
  it("credits transparenta.eu for live execution data", () => {
    expect(names("/api/budget/summary")).toEqual([
      ATTRIBUTION_SOURCES.transparenta.name,
    ]);
  });

  it("credits the demo seeds when the budget source is static", () => {
    expect(names("/api/budget/summary", demo)).toEqual([
      ATTRIBUTION_SOURCES.seed.name,
    ]);
    expect(names("/api/investments/by-county", live)).toEqual([
      ATTRIBUTION_SOURCES.seed.name,
    ]);
  });

  it("credits every source a comparison joins", () => {
    expect(names("/api/budget/comparison")).toEqual([
      ATTRIBUTION_SOURCES.mfp.name,
      ATTRIBUTION_SOURCES.transparenta.name,
    ]);
    expect(names("/api/budget/adopted")).toEqual([
      ATTRIBUTION_SOURCES.mfp.name,
    ]);
  });

  it("credits the ECB for exchange and policy rates", () => {
    expect(names("/api/macro/fx")).toEqual([ATTRIBUTION_SOURCES.ecb.name]);
    expect(names("/api/macro/rates")).toEqual([ATTRIBUTION_SOURCES.ecb.name]);
  });

  it("credits Eurostat and the BNR target for inflation", () => {
    expect(names("/api/macro/inflation")).toEqual([
      ATTRIBUTION_SOURCES.eurostat.name,
      ATTRIBUTION_SOURCES.bnr.name,
    ]);
  });

  it.each([
    "/api/macro/debt",
    "/api/wages/real",
    "/api/society/health",
    "/api/energy/context",
    "/api/labour/context",
    "/api/justice/context",
    "/api/context/trends",
    "/api/ins/catalog",
  ])("credits Eurostat for %s", (path) => {
    expect(names(path)).toEqual([ATTRIBUTION_SOURCES.eurostat.name]);
  });

  it("credits companiidestat.ro for state companies", () => {
    expect(names("/api/soe/companies/123")).toEqual([
      ATTRIBUTION_SOURCES.companiidestat.name,
    ]);
  });

  it("credits nobody for computed or unknown routes", () => {
    expect(names("/api/salary/calculate")).toEqual([]);
    expect(names("/api/health")).toEqual([]);
    expect(names("/health/ready")).toEqual([]);
  });

  it("gives every source an https url", () => {
    for (const source of Object.values(ATTRIBUTION_SOURCES)) {
      expect(source.url).toMatch(/^https:\/\//);
      if (source.licenceUrl !== null) {
        expect(source.licenceUrl).toMatch(/^https?:\/\//);
      }
    }
  });
});

describe("withAttribution", () => {
  const sources = [ATTRIBUTION_SOURCES.eurostat];

  it("adds the field to a JSON object", () => {
    expect(withAttribution({ a: 1 }, sources)).toEqual({
      a: 1,
      attribution: sources,
    });
  });

  it("leaves arrays, primitives and existing fields alone", () => {
    expect(withAttribution([1], sources)).toEqual([1]);
    expect(withAttribution("x", sources)).toBe("x");
    expect(withAttribution({ attribution: "own" }, sources)).toEqual({
      attribution: "own",
    });
  });
});

describe("attributionHeader", () => {
  it("is ASCII-only JSON", () => {
    const header = attributionHeader([ATTRIBUTION_SOURCES.bnr]);
    expect(header).toMatch(/^[\x20-\x7e]*$/);
    expect(JSON.parse(header)).toEqual([ATTRIBUTION_SOURCES.bnr]);
  });
});
