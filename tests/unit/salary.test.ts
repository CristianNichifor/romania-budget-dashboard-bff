import { describe, expect, it } from "vitest";
import { staticTaxRates } from "../../src/modules/salary/shell/repo";
import { calculateSalaryBreakdown } from "../../src/modules/salary/core/use-cases/calculate-salary";

const rates = staticTaxRates.get();

describe("calculateSalaryBreakdown", () => {
  it("rejects invalid inputs with INVALID_INPUT", () => {
    for (const input of [
      "",
      "0",
      "-100",
      "abc",
      "Infinity",
      "1e10000000",
      "9".repeat(65),
    ]) {
      const result = calculateSalaryBreakdown(input, rates);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe("INVALID_INPUT");
      }
    }
  });

  it("keeps the supported salary range inclusive", () => {
    expect(calculateSalaryBreakdown("1e15", rates).isOk()).toBe(true);
  });

  it("computes CAS/CASS/income tax on the standard 2026 rates", () => {
    const result = calculateSalaryBreakdown("10000", rates);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      return;
    }

    expect(result.value.cas.toNumber()).toBeCloseTo(2500, 8);
    expect(result.value.cass.toNumber()).toBeCloseTo(1000, 8);
    expect(result.value.incomeTax.toNumber()).toBeCloseTo(650, 8);
    expect(result.value.net.toNumber()).toBeCloseTo(5850, 8);
  });

  it("computes the employer contribution on top of gross", () => {
    const result = calculateSalaryBreakdown("10000", rates);
    if (result.isErr()) {
      return;
    }

    expect(result.value.employerContribution.toNumber()).toBeCloseTo(225, 8);
    expect(result.value.employerCost.toNumber()).toBeCloseTo(10225, 8);
  });

  it("keeps the state share between 50% and 60% at 9427 lei", () => {
    const result = calculateSalaryBreakdown("9427", rates);
    if (result.isErr()) {
      return;
    }

    const percent = result.value.statePercent.toNumber();
    expect(percent).toBeGreaterThan(50);
    expect(percent).toBeLessThan(60);
  });

  it("produces exactly 7 waterfall entries", () => {
    const result = calculateSalaryBreakdown("9427", rates);
    if (result.isErr()) {
      return;
    }

    expect(result.value.entries).toHaveLength(7);
  });
});
