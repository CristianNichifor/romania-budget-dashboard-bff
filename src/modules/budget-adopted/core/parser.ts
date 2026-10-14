import { Decimal } from "decimal.js";
import { err, ok, type Result } from "neverthrow";
import type { AppError } from "../../../common/errors";
import { invalidInput, upstreamUnavailable } from "../../../common/errors";
import type { BudgetSummary } from "../../../common/types";
import {
  COMPARISON_SCOPE_NOTE,
  FUND_IDS,
  FUND_NAMES,
  type AdoptedFundTotals,
  type AdoptedTotals,
  type BudgetComparisonPoint,
  type FundId,
} from "./types";

/**
 * Pure parsing of the MFP "anexa 1" XML files (Oracle Reports export,
 * ISO-8859-2). Each `<G_TITLU_RAPORT>` row carries a `<DENUMIRE>` label and
 * per-year columns `<PROGRAM_YYYY>` (the adopted budget year) plus
 * `<ESTIMARIYYYY+1..N>`. Amounts are thousands of lei with thousand
 * separators (e.g. "308.204.963").
 *
 * Total rows by fund:
 * - bs:   "VENITURI - TOTAL", "DEFICIT" (negative)
 * - bass: "VENITURI - TOTAL", "EXCEDENT/DEFICIT" (may be positive)
 * - bsan: "VENITURI - TOTAL" only — the fund is legally balanced, deficit 0
 * - bsom: "VENITURI - TOTAL", "EXCEDENT/DEFICIT"
 *
 * No I/O, no throw — malformed input becomes an AppError.
 */

interface AnexaRow {
  label: string;
  values: Map<string, string>;
}

const ROW_PATTERN = /<G_TITLU_RAPORT>([\s\S]*?)<\/G_TITLU_RAPORT>/g;
const LABEL_PATTERN = /<DENUMIRE>([^<]*)<\/DENUMIRE>/;
const VALUE_PATTERN = /<([A-Z_]+[0-9]{4})>([^<]*)<\/[A-Z_]+[0-9]{4}>/g;

const REVENUE_LABEL = "VENITURI - TOTAL";
const DEFICIT_LABEL = "DEFICIT";
const SURPLUS_LABEL = "EXCEDENT/DEFICIT";

const FUND_DEFICIT_LABELS: Record<FundId, string[] | null> = {
  bs: [DEFICIT_LABEL],
  bass: [SURPLUS_LABEL],
  bsan: null,
  bsom: [SURPLUS_LABEL],
};

const THOUSANDS = new Decimal(1000);

export function extractRows(xml: string): AnexaRow[] {
  const rows: AnexaRow[] = [];
  for (const match of xml.matchAll(ROW_PATTERN)) {
    const block = match[1];
    if (block === undefined) {
      continue;
    }
    const labelMatch = LABEL_PATTERN.exec(block);
    if (labelMatch === null || labelMatch[1] === undefined) {
      continue;
    }
    const values = new Map<string, string>();
    for (const valueMatch of block.matchAll(VALUE_PATTERN)) {
      const column = valueMatch[1];
      const value = valueMatch[2];
      if (column !== undefined && value !== undefined) {
        values.set(column, value);
      }
    }
    rows.push({ label: labelMatch[1].trim(), values });
  }
  return rows;
}

/**
 * Parses a single amount cell: thousands of lei, thousand separators
 * ("." or " "), optional sign. Returns lei as Decimal.
 */
export function parseAmount(raw: string): Result<Decimal, AppError> {
  const normalized = raw.replace(/[^0-9-]/g, "");
  if (normalized === "" || normalized === "-") {
    return err(upstreamUnavailable(`unparsable amount: "${raw}"`));
  }
  try {
    return ok(new Decimal(normalized).times(THOUSANDS));
  } catch {
    return err(upstreamUnavailable(`unparsable amount: "${raw}"`));
  }
}

/**
 * Extracts the adopted totals of one fund from its anexa 1 XML. The BSAN
 * file carries no deficit row — its budget is balanced by law, so a missing
 * deficit row is treated as zero for that fund only.
 */
export function parseFundTotals(
  xml: string,
  year: number,
  fund: FundId
): Result<AdoptedFundTotals, AppError> {
  const column = `PROGRAM_${year}`;
  const rows = extractRows(xml);

  const revenueRow = rows.find((row) => row.label === REVENUE_LABEL);
  if (revenueRow === undefined) {
    return err(
      upstreamUnavailable(
        `anexa 1 ${fund} ${year}: missing "${REVENUE_LABEL}" row`
      )
    );
  }

  const rawRevenue = revenueRow.values.get(column) ?? "";
  const revenue = parseAmount(rawRevenue);
  if (revenue.isErr()) {
    return err(revenue.error);
  }

  const deficitLabels = FUND_DEFICIT_LABELS[fund];
  if (deficitLabels === null) {
    return ok({
      id: fund,
      name: FUND_NAMES[fund],
      revenue: revenue.value,
      expenditure: revenue.value,
      deficit: new Decimal(0),
    });
  }

  const deficitRow = rows.find((row) => deficitLabels.includes(row.label));
  if (deficitRow === undefined) {
    return err(
      upstreamUnavailable(`anexa 1 ${fund} ${year}: missing deficit row`)
    );
  }

  const deficit = parseAmount(deficitRow.values.get(column) ?? "");
  if (deficit.isErr()) {
    return err(deficit.error);
  }

  const expenditure = revenue.value.minus(deficit.value);

  return ok({
    id: fund,
    name: FUND_NAMES[fund],
    revenue: revenue.value,
    expenditure,
    deficit: deficit.value,
  });
}

/**
 * Aggregates the four funds into the adopted totals served by the API.
 * The BS fund is required; a missing non-BS fund is tolerated and reported
 * in `warnings` (schema drifts between years).
 */
export function buildAdoptedTotals(
  year: number,
  funds: (AdoptedFundTotals | null)[]
): Result<AdoptedTotals, AppError> {
  const present = funds.filter(
    (fund): fund is AdoptedFundTotals => fund !== null
  );
  const warnings = funds
    .map((fund, index) => ({ fund, index }))
    .filter(
      (entry): entry is { fund: null; index: number } => entry.fund === null
    )
    .map(({ index }) => {
      const id = FUND_IDS[index];
      const name = id === undefined ? "necunoscut" : FUND_NAMES[id];
      return `fondul ${name} lipsește din datasetul ${year} — totalurile îl exclud`;
    });

  const bs = present.find((fund) => fund.id === "bs");
  if (bs === undefined) {
    return err(
      upstreamUnavailable(`anexa 1 bs ${year}: state budget totals missing`)
    );
  }

  const revenue = present.reduce(
    (acc, fund) => acc.plus(fund.revenue),
    new Decimal(0)
  );
  const expenditure = present.reduce(
    (acc, fund) => acc.plus(fund.expenditure),
    new Decimal(0)
  );
  const deficit = present.reduce(
    (acc, fund) => acc.plus(fund.deficit),
    new Decimal(0)
  );

  return ok({
    year,
    revenue,
    expenditure,
    deficit,
    funds: present,
    warnings,
  });
}

/**
 * Joins adopted totals with the execution summary for the same year.
 * `executed === null` when the execution source is unavailable (e.g. the
 * static demo source, which only carries the 2026 seed). The deficit delta
 * is the honest comparison — transfers cancel out on both sides.
 */
export function buildBudgetComparison(
  year: number,
  adopted: AdoptedTotals,
  executed: BudgetSummary | null
): BudgetComparisonPoint {
  const adoptedSide = {
    revenue: adopted.revenue,
    expenditure: adopted.expenditure,
    deficit: adopted.deficit,
  };

  const executedSide =
    executed === null
      ? null
      : {
          revenue: new Decimal(executed.revenue),
          expenditure: new Decimal(executed.expenditure),
          deficit: new Decimal(executed.deficit),
          deficitPercentGdp: new Decimal(executed.deficitPercentGdp),
        };

  return {
    year,
    adopted: adoptedSide,
    executed: executedSide,
    // The adopted law reports the deficit as revenue − expenditure (negative)
    // and the execution as expenditure − revenue (positive). Compare
    // magnitudes: |executed| − |adopted|, positive when the executed deficit
    // exceeds the planned one.
    deficitDelta:
      executedSide === null
        ? null
        : executedSide.deficit.abs().minus(adopted.deficit.abs()),
    note: COMPARISON_SCOPE_NOTE,
  };
}

/** Upper bound on distinct years one comparison request may ask for. */
export const MAX_COMPARISON_YEARS = 10;

/**
 * Validates a `years=2020,2021` query: distinct years in ascending order,
 * at most {@link MAX_COMPARISON_YEARS} of them.
 */
export function parseComparisonYears(
  param: string
): Result<number[], AppError> {
  if (!/^\d{4}(,\d{4})*$/.test(param)) {
    return err(invalidInput(`invalid years: ${param}`));
  }
  const years = [...new Set(param.split(",").map(Number))].sort(
    (a, b) => a - b
  );
  if (years.length > MAX_COMPARISON_YEARS) {
    return err(
      invalidInput(`at most ${MAX_COMPARISON_YEARS} years per comparison`)
    );
  }
  return ok(years);
}
