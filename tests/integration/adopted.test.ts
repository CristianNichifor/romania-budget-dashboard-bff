import { Decimal } from "decimal.js";
import { err, ok, type Result } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app/build-app";
import type { AppError } from "../../src/common/errors";
import { loadConfig } from "../../src/infra/config";
import type { AdoptedBudgetDataSource } from "../../src/modules/budget-adopted/core/ports";
import type { AdoptedTotals } from "../../src/modules/budget-adopted/core/types";
import type {
  BudgetDataSource,
  BudgetInstitutions,
} from "../../src/modules/budget/core/ports";
import type { BudgetDestination, BudgetSummary } from "../../src/common/types";

const FAKE_ADOPTED_2020: AdoptedTotals = {
  year: 2020,
  revenue: new Decimal("167702382000"),
  expenditure: new Decimal("215224161000"),
  deficit: new Decimal("-47521779000"),
  funds: [
    {
      id: "bs",
      name: "Bugetul de stat",
      revenue: new Decimal("167702382000"),
      expenditure: new Decimal("215224161000"),
      deficit: new Decimal("-47521779000"),
    },
  ],
  warnings: [],
};

class FakeAdoptedSource implements AdoptedBudgetDataSource {
  supportedYears(): number[] {
    return [2020, 2021];
  }

  async getAdopted(year: string): Promise<Result<AdoptedTotals, AppError>> {
    if (year === "2020") {
      return ok(FAKE_ADOPTED_2020);
    }
    return err({ code: "NOT_FOUND", message: `no dataset for ${year}` });
  }
}

const FAKE_EXECUTED_2020: BudgetSummary = {
  year: 2020,
  revenue: "331803000000",
  expenditure: "433324000000",
  deficit: "101521000000",
  deficitPercentGdp: "9.5",
};

class FakeExecutedSource implements BudgetDataSource {
  getYears(): number[] {
    return [2020];
  }

  async getSummary(year: string): Promise<Result<BudgetSummary, AppError>> {
    if (year === "2020") {
      return ok(FAKE_EXECUTED_2020);
    }
    return err({ code: "INVALID_INPUT", message: "out of range" });
  }

  async getDestinations(
    _year: string
  ): Promise<Result<BudgetDestination[], AppError>> {
    return err({ code: "INTERNAL", message: "unused" });
  }

  async getInstitutions(
    _year: string,
    _category: string
  ): Promise<Result<BudgetInstitutions, AppError>> {
    return err({ code: "INTERNAL", message: "unused" });
  }
}

let app: FastifyInstance | undefined;

async function getApp(): Promise<FastifyInstance> {
  if (app === undefined) {
    app = buildApp({
      config: loadConfig({ NODE_ENV: "test", PORT: "3000" }),
      overrides: {
        adoptedSource: new FakeAdoptedSource(),
        budgetSource: new FakeExecutedSource(),
      },
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

describe("GET /api/budget/adopted", () => {
  it("returns adopted totals with string amounts and funds detail", async () => {
    const response = await (
      await getApp()
    ).inject({ method: "GET", url: "/api/budget/adopted?year=2020" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.year).toBe(2020);
    expect(body.revenue).toBe("167702382000");
    expect(body.deficit).toBe("-47521779000");
    expect(body.funds).toHaveLength(1);
    expect(body.funds[0].id).toBe("bs");
    expect(typeof body.funds[0].revenue).toBe("string");
    expect(body.warnings).toEqual([]);
    expect(typeof body.note).toBe("string");
  });

  it("returns 400 for a malformed year", async () => {
    const response = await (
      await getApp()
    ).inject({ method: "GET", url: "/api/budget/adopted?year=abcd" });

    expect(response.statusCode).toBe(400);
  });

  it("returns 404 for a year without a dataset", async () => {
    const response = await (
      await getApp()
    ).inject({ method: "GET", url: "/api/budget/adopted?year=2021" });

    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/budget/comparison", () => {
  it("joins adopted with executed for the requested years", async () => {
    const response = await (
      await getApp()
    ).inject({ method: "GET", url: "/api/budget/comparison?years=2020" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.points).toHaveLength(1);
    const point = body.points[0];
    expect(point.year).toBe(2020);
    expect(point.adopted.deficit).toBe("-47521779000");
    expect(point.executed).not.toBeNull();
    expect(point.executed.deficit).toBe("101521000000");
    expect(point.executed.deficitPercentGdp).toBe("9.5");
    // |executed deficit| − |adopted deficit|
    expect(point.deficitDelta).toBe("53999221000");
    expect(typeof point.note).toBe("string");
    expect(point.partial).toBe(false);
  });

  it("serves adopted-only points when the execution year does not match", async () => {
    const response = await (
      await getApp()
    ).inject({ method: "GET", url: "/api/budget/comparison?years=2020,2021" });

    expect(response.statusCode).toBe(404);
  });

  it("serves one point per distinct year", async () => {
    const response = await (
      await getApp()
    ).inject({ method: "GET", url: "/api/budget/comparison?years=2020,2020" });

    expect(response.statusCode).toBe(200);
    expect(response.json().points).toHaveLength(1);
  });

  it("rejects more than ten distinct years", async () => {
    const years = Array.from({ length: 11 }, (_, i) => 2010 + i).join(",");
    const response = await (
      await getApp()
    ).inject({ method: "GET", url: `/api/budget/comparison?years=${years}` });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_INPUT");
  });
});
