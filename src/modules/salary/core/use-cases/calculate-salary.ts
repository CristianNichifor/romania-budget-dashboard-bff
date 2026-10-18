import { Decimal } from "decimal.js";
import { err, ok, type Result } from "neverthrow";
import type { AppError } from "../../../../common/errors";
import type { SalaryBreakdown, TaxRates } from "../types";

const MAX_GROSS_INPUT_LENGTH = 64;
const MAX_GROSS = new Decimal("1e15");

/**
 * Computes the personal tax burden following the Open Budget 2026 model:
 * CAS (25%) + CASS (10%) + income tax (10% of gross − CAS − CASS)
 * + employer contribution (CAM 2.25%) + an estimated VAT burden on consumption.
 *
 * Pure function: no I/O, no floats (decimal.js only), errors via Result.
 */
export function calculateSalaryBreakdown(
  grossInput: string,
  rates: TaxRates
): Result<SalaryBreakdown, AppError> {
  if (grossInput.length > MAX_GROSS_INPUT_LENGTH) {
    return err({
      code: "INVALID_INPUT",
      message: "Gross salary is out of range",
    });
  }

  let gross: Decimal;
  try {
    gross = new Decimal(grossInput);
  } catch {
    return err({
      code: "INVALID_INPUT",
      message: "Gross salary must be a valid number",
    });
  }

  if (
    !gross.isFinite() ||
    gross.lessThanOrEqualTo(0) ||
    gross.greaterThan(MAX_GROSS)
  ) {
    return err({
      code: "INVALID_INPUT",
      message: "Gross salary must be a positive number",
    });
  }

  const cas = gross.mul(rates.cas);
  const cass = gross.mul(rates.cass);
  const taxableBase = gross.minus(cas).minus(cass);
  const incomeTax = taxableBase.mul(rates.incomeTax);
  const net = taxableBase.minus(incomeTax);

  const employerContribution = gross.mul(rates.employerContribution);
  const employerCost = gross.plus(employerContribution);

  const estimatedVat = net
    .mul(rates.vatConsumptionShare)
    .mul(rates.vat)
    .div(new Decimal(1).plus(rates.vat));

  const stateShare = employerCost.minus(net).plus(estimatedVat);
  const statePercent = stateShare.div(employerCost).mul(100);

  const entries = [
    { labelKey: "salary.entry.gross", amount: employerCost },
    {
      labelKey: "salary.entry.employerContribution",
      amount: employerContribution.negated(),
    },
    { labelKey: "salary.entry.cas", amount: cas.negated() },
    { labelKey: "salary.entry.cass", amount: cass.negated() },
    { labelKey: "salary.entry.incomeTax", amount: incomeTax.negated() },
    { labelKey: "salary.entry.estimatedVat", amount: estimatedVat.negated() },
    { labelKey: "salary.entry.net", amount: net },
  ];

  return ok({
    gross,
    cas,
    cass,
    incomeTax,
    employerContribution,
    estimatedVat,
    net,
    employerCost,
    stateShare,
    statePercent,
    entries,
  });
}
