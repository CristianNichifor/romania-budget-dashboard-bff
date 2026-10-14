import { Decimal } from "decimal.js";
import { err, ok, type Result } from "neverthrow";
import type { AppError } from "../../../common/errors";
import { upstreamUnavailable } from "../../../common/errors";
import type {
  BudgetDestination,
  BudgetSubDestination,
  BudgetSummary,
} from "../../../common/types";
import { normalizeCategoryName } from "./category-names";
import type { BudgetInstitutions } from "./ports";

/**
 * Pure mapping from hack-for-facts-eb-server GraphQL payloads to the
 * dashboard contract. No I/O, no throw — the shell fetches and parses,
 * these functions turn the parsed shapes into domain types with Decimal.
 */

export interface AnalyticsPoint {
  x: string;
  y: number;
}

export interface AnalyticsSeries {
  seriesId: string;
  data: AnalyticsPoint[];
}

export interface AggregatedLineItemNode {
  functional_code: string;
  functional_name: string;
  economic_code: string;
  economic_name: string;
  amount: number;
  count: number;
}

export interface EntityAnalyticsNode {
  entity_cui: string;
  entity_name: string;
  amount: number;
}

const MAX_SUB_DESTINATIONS = 12;

/**
 * Latest value of a time series as a decimal string. Periods (x) are
 * PeriodDate strings — YYYY sorts lexically, so the last entry is the
 * most recent period.
 */
export function latestSeriesValue(
  points: AnalyticsPoint[]
): string | undefined {
  if (points.length === 0) {
    return undefined;
  }
  const last = [...points].sort((a, b) => a.x.localeCompare(b.x)).at(-1);
  return last === undefined
    ? undefined
    : new Decimal(String(last.y)).toString();
}

function seriesById(
  series: AnalyticsSeries[],
  seriesId: string
): AnalyticsSeries | undefined {
  return series.find((entry) => entry.seriesId === seriesId);
}

export function buildSummary(
  series: AnalyticsSeries[],
  year: number
): Result<BudgetSummary, AppError> {
  const revenue = latestSeriesValue(seriesById(series, "revenue")?.data ?? []);
  const expenditure = latestSeriesValue(
    seriesById(series, "expenditure")?.data ?? []
  );
  const revenuePctGdp = latestSeriesValue(
    seriesById(series, "revenue_pct_gdp")?.data ?? []
  );
  const expenditurePctGdp = latestSeriesValue(
    seriesById(series, "expenditure_pct_gdp")?.data ?? []
  );

  if (revenue === undefined || expenditure === undefined) {
    return err(
      upstreamUnavailable(
        "executionAnalytics returned no revenue/expenditure data"
      )
    );
  }

  const deficit = new Decimal(expenditure).minus(revenue);
  const deficitPercentGdp =
    revenuePctGdp !== undefined && expenditurePctGdp !== undefined
      ? new Decimal(expenditurePctGdp)
          .minus(revenuePctGdp)
          .toDecimalPlaces(1)
          .toString()
      : "0";

  return ok({
    year,
    revenue,
    expenditure,
    deficit: deficit.toString(),
    deficitPercentGdp,
  });
}

/**
 * Groups line items by functional classification (destination), keeping the
 * top economic classifications as sub-destinations. The upstream dataset
 * has ~100+ functional groups — too noisy for a readable dashboard — so
 * only the top N are kept as individual destinations and the rest is folded
 * into a single "Alte destinații" group.
 */
export const TOP_DESTINATIONS = 8;
export const REST_DESTINATION_ID = "rest";
export const REST_DESTINATION_NAME = "Alte destinații";

export function buildDestinations(
  nodes: AggregatedLineItemNode[]
): BudgetDestination[] {
  const groups = new Map<
    string,
    { name: string; amount: Decimal; subs: BudgetSubDestination[] }
  >();

  for (const node of nodes) {
    const group = groups.get(node.functional_code) ?? {
      name: normalizeCategoryName(node.functional_name),
      amount: new Decimal(0),
      subs: [],
    };
    group.amount = group.amount.plus(node.amount);
    group.subs.push({
      id: `${node.functional_code}:${node.economic_code}`,
      name: normalizeCategoryName(node.economic_name),
      amount: new Decimal(node.amount).toString(),
    });
    groups.set(node.functional_code, group);
  }

  const total = [...groups.values()].reduce(
    (acc, group) => acc.plus(group.amount),
    new Decimal(0)
  );

  const toDestination = ([code, group]: [
    string,
    { name: string; amount: Decimal; subs: BudgetSubDestination[] },
  ]): BudgetDestination => ({
    id: code,
    name: group.name,
    amount: group.amount.toString(),
    percentOfTotal: total.isZero()
      ? "0"
      : group.amount.div(total).times(100).toDecimalPlaces(1).toString(),
    subDestinations: group.subs
      .sort((a, b) => new Decimal(b.amount).cmp(a.amount))
      .slice(0, MAX_SUB_DESTINATIONS),
  });

  const sorted = [...groups.entries()].sort((a, b) =>
    b[1].amount.cmp(a[1].amount)
  );

  const destinations = sorted.slice(0, TOP_DESTINATIONS).map(toDestination);

  const rest = sorted.slice(TOP_DESTINATIONS);
  if (rest.length > 0) {
    const restAmount = rest.reduce(
      (acc, [, group]) => acc.plus(group.amount),
      new Decimal(0)
    );
    destinations.push({
      id: REST_DESTINATION_ID,
      name: REST_DESTINATION_NAME,
      amount: restAmount.toString(),
      percentOfTotal: total.isZero()
        ? "0"
        : restAmount.div(total).times(100).toDecimalPlaces(1).toString(),
      subDestinations: rest.map(([code, group]) => ({
        id: code,
        name: group.name,
        amount: group.amount.toString(),
      })),
    });
  }

  return destinations;
}

export function buildInstitutions(
  category: string,
  nodes: EntityAnalyticsNode[]
): BudgetInstitutions {
  const total = nodes.reduce(
    (acc, node) => acc.plus(node.amount),
    new Decimal(0)
  );

  return {
    category,
    total: total.toString(),
    institutions: nodes
      .map((node) => ({
        id: node.entity_cui,
        name: node.entity_name,
        amount: new Decimal(node.amount).toString(),
      }))
      .sort((a, b) => new Decimal(b.amount).cmp(a.amount)),
  };
}
