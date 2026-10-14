import { Decimal } from "decimal.js";
import { err, ok, type Result } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { AppError } from "../../src/common/errors";
import {
  MAX_COMPARISON_YEARS,
  parseComparisonYears,
} from "../../src/modules/budget-adopted/core/parser";
import type { AdoptedBudgetDataSource } from "../../src/modules/budget-adopted/core/ports";
import type { AdoptedTotals } from "../../src/modules/budget-adopted/core/types";
import { compareBudgetYears } from "../../src/modules/budget-adopted/shell/comparison";
import type { BudgetDataSource } from "../../src/modules/budget/core/ports";
import type { BudgetSummary } from "../../src/common/types";

describe("parseComparisonYears", () => {
  it("dedupes and sorts the requested years", () => {
    expect(parseComparisonYears("2022,2020,2022,2021")._unsafeUnwrap()).toEqual(
      [2020, 2021, 2022]
    );
  });

  it("rejects malformed input", () => {
    const result = parseComparisonYears("2020,abc");
    expect(result._unsafeUnwrapErr().code).toBe("INVALID_INPUT");
  });

  it("caps the number of distinct years", () => {
    expect(MAX_COMPARISON_YEARS).toBe(10);
    const ten = Array.from({ length: 10 }, (_, i) => 2010 + i).join(",");
    expect(parseComparisonYears(ten).isOk()).toBe(true);
    const eleven = Array.from({ length: 11 }, (_, i) => 2010 + i).join(",");
    expect(parseComparisonYears(eleven)._unsafeUnwrapErr().code).toBe(
      "INVALID_INPUT"
    );
    // Duplicates do not count towards the cap.
    expect(parseComparisonYears(`${ten},2010,2011`).isOk()).toBe(true);
  });
});

function adoptedTotals(year: number): AdoptedTotals {
  const zero = new Decimal(0);
  return {
    year,
    revenue: zero,
    expenditure: zero,
    deficit: zero,
    funds: [],
    warnings: [],
  };
}

describe("compareBudgetYears", () => {
  it("reads every year concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const gate = async <T>(value: T): Promise<T> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return value;
    };
    const adopted: AdoptedBudgetDataSource = {
      supportedYears: () => [2020, 2021, 2022],
      getAdopted: (year) =>
        gate(
          ok(adoptedTotals(Number(year))) as Result<AdoptedTotals, AppError>
        ),
    };
    const budget = {
      getSummary: (year: string) =>
        gate(
          err({ code: "NOT_FOUND", message: year }) as Result<
            BudgetSummary,
            AppError
          >
        ),
    } as unknown as BudgetDataSource;

    const result = await compareBudgetYears(adopted, budget, undefined);

    expect(result._unsafeUnwrap().points.map((p) => p.year)).toEqual([
      2020, 2021, 2022,
    ]);
    expect(maxInFlight).toBeGreaterThanOrEqual(3);
  });

  it("returns the first upstream error", async () => {
    const adopted: AdoptedBudgetDataSource = {
      supportedYears: () => [2020],
      getAdopted: async () => err({ code: "NOT_FOUND", message: "missing" }),
    };
    const budget = {
      getSummary: async () => err({ code: "NOT_FOUND", message: "x" }),
    } as unknown as BudgetDataSource;

    const result = await compareBudgetYears(adopted, budget, "2020");

    expect(result._unsafeUnwrapErr().code).toBe("NOT_FOUND");
  });
});
