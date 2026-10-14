import type { Decimal } from "decimal.js";
import { err, ok, type Result } from "neverthrow";
import type { AppError } from "../../../common/errors";
import type { BudgetDataSource } from "../../budget/core/ports";
import { buildBudgetComparison, parseComparisonYears } from "../core/parser";
import type { AdoptedBudgetDataSource } from "../core/ports";

export interface ComparisonPointJson {
  year: number;
  adopted: { revenue: string; expenditure: string; deficit: string };
  executed: {
    revenue: string;
    expenditure: string;
    deficit: string;
    deficitPercentGdp: string;
  } | null;
  deficitDelta: string | null;
  note: string;
}

function money(value: Decimal): string {
  return value.toFixed(0);
}

/** Execution data exists from 2020 onward; older adopted years stay out of the default range. */
const FIRST_COMPARISON_YEAR = 2020;

/**
 * Adopted vs executed budget for each requested year (default: every
 * supported year from 2020). Years are read concurrently; the first failing
 * adopted read decides the error.
 */
export async function compareBudgetYears(
  adoptedSource: AdoptedBudgetDataSource,
  budgetSource: BudgetDataSource,
  yearsParam: string | undefined
): Promise<Result<{ points: ComparisonPointJson[] }, AppError>> {
  const parsed = parseComparisonYears(
    yearsParam ??
      adoptedSource
        .supportedYears()
        .filter((year) => year >= FIRST_COMPARISON_YEAR)
        .join(",")
  );
  if (parsed.isErr()) {
    return err(parsed.error);
  }

  const reads = await Promise.all(
    parsed.value.map(async (year) => {
      const [adopted, executed] = await Promise.all([
        adoptedSource.getAdopted(String(year)),
        budgetSource.getSummary(String(year)),
      ]);
      return { year, adopted, executed };
    })
  );

  const points: ComparisonPointJson[] = [];
  for (const { year, adopted, executed: executedResult } of reads) {
    if (adopted.isErr()) {
      return err(adopted.error);
    }
    // The static demo source answers every year with the 2026 seed — only
    // accept an execution summary whose year matches the request.
    const executed =
      executedResult.isOk() && executedResult.value.year === year
        ? executedResult.value
        : null;
    const comparison = buildBudgetComparison(year, adopted.value, executed);
    points.push({
      year: comparison.year,
      adopted: {
        revenue: money(comparison.adopted.revenue),
        expenditure: money(comparison.adopted.expenditure),
        deficit: money(comparison.adopted.deficit),
      },
      executed:
        comparison.executed === null
          ? null
          : {
              revenue: money(comparison.executed.revenue),
              expenditure: money(comparison.executed.expenditure),
              deficit: money(comparison.executed.deficit),
              deficitPercentGdp:
                comparison.executed.deficitPercentGdp.toFixed(1),
            },
      deficitDelta:
        comparison.deficitDelta === null
          ? null
          : money(comparison.deficitDelta),
      note: comparison.note,
    });
  }
  return ok({ points });
}
