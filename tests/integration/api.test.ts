import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ok, type Result } from "neverthrow";
import { buildApp } from "../../src/app/build-app";
import type { AppError } from "../../src/common/errors";
import { loadConfig } from "../../src/infra/config";
import type {
  ContextDataSource,
  ContextTrend,
} from "../../src/modules/context/core/ports";

class FakeContextSource implements ContextDataSource {
  async getTrend(metric: string): Promise<Result<ContextTrend, AppError>> {
    if (metric === "health-budget") {
      return ok({
        metric,
        source: "test",
        sourceUpdated: "2026-08-14",
        data: [
          { year: 2021, amount: "22000.0" },
          { year: 2022, amount: "24500.0" },
        ],
      });
    }
    return ok({ metric, source: "unknown", sourceUpdated: "", data: [] });
  }
}

let app: FastifyInstance | undefined;

async function getApp(): Promise<FastifyInstance> {
  if (app === undefined) {
    app = buildApp({
      config: loadConfig({ NODE_ENV: "test", PORT: "3000" }),
      overrides: { contextSource: new FakeContextSource() },
    });
    await app.ready();
  }
  return app;
}

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

describe("health", () => {
  it("responds to liveness and readiness probes", async () => {
    const instance = await getApp();

    const live = await instance.inject({ method: "GET", url: "/health/live" });
    const ready = await instance.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
  });
});

describe("GET /api/salary/calculate", () => {
  it("returns the breakdown with string amounts", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/salary/calculate?gross=9427",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.gross).toBe("9427.00");
    expect(body.net).toBe("5514.80");
    expect(Number(body.statePercent)).toBeCloseTo(50.2, 1);
    expect(body.entries).toHaveLength(7);
    expect(typeof body.entries[0].amount).toBe("string");

    const stateShare = Number(body.stateShare);
    const net = Number(body.net);
    const employerCost = Number(body.employerCost);
    const estimatedVat = Number(body.estimatedVat);
    expect(stateShare + net).toBeCloseTo(employerCost + estimatedVat, 1);
  });

  it("rejects an invalid gross with 400", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/salary/calculate?gross=abc",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_INPUT");
  });

  it("rejects an oversized gross with 400", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/salary/calculate?gross=1e10000000",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_INPUT");
  });
});

describe("GET /api/budget", () => {
  it("returns the summary", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/budget/summary",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.year).toBe(2026);
    expect(body.revenue).toBe("728990724000");
    expect(body.deficitPercentGdp).toBe("7.1");
  });

  it("returns destinations with sub-destinations", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/budget/destinations",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(6);
    expect(body[0].id).toBe("pensii");
    expect(body[0].subDestinations).toHaveLength(4);
  });

  it("drills down into a category", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/budget/institutions?category=pensii",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe("217814450000");
    expect(body.institutions[0].name).toBe("Pensii contributive");
  });

  it("returns 404 for an unknown category", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/budget/institutions?category=inexistenta",
    });

    expect(response.statusCode).toBe(404);
  });

  it("lists the supported years", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/budget/years",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.years)).toBe(true);
    expect(body.years).toContain(2026);
  });

  it("rejects a budget year before the supported range", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/budget/summary?year=1999",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_INPUT");
  });

  it("rejects a malformed budget year", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/budget/summary?year=abcd",
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/context", () => {
  it("returns the health budget trend", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/context/trends?metric=health-budget",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.metric).toBe("health-budget");
    expect(body.data).toHaveLength(2);
    expect(body.data[0].year).toBe(2021);
    expect(body.data[0].amount).toBe("22000.0");
  });

  it("returns 404 for an unknown metric", async () => {
    const instance = await getApp();
    const response = await instance.inject({
      method: "GET",
      url: "/api/context/trends?metric=inexistent",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("NOT_FOUND");
  });
});

describe("Cache-Control", () => {
  it("marks data responses as publicly cacheable", async () => {
    const instance = await getApp();
    const response = await instance.inject("/api/salary/calculate?gross=9427");

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400"
    );
  });

  it.each(["/api/salary/calculate?gross=abc", "/health/ready"])(
    "marks %s as no-store",
    async (url) => {
      const instance = await getApp();
      const response = await instance.inject(url);

      expect(response.headers["cache-control"]).toBe("no-store");
    }
  );
});
