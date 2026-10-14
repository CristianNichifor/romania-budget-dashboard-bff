import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import type { AppConfig } from "../../../infra/config";
import type { AppError } from "../../../common/errors";
import { upstreamUnavailable } from "../../../common/errors";
import type { BudgetDestination, BudgetSummary } from "../../../common/types";
import type { BudgetDataSource, BudgetInstitutions } from "../core/ports";
import {
  buildDestinations,
  buildInstitutions,
  buildSummary,
} from "../core/analytics-mapping";
import { availableBudgetYears, validateBudgetYear } from "../core/years";

/**
 * GraphQL client for hack-for-facts-eb-server (transparenta.eu server).
 *
 * Field mapping verified against the upstream schemas:
 * - executionAnalytics(inputs: [AnalyticsInput!]!) -> [AnalyticsSeries!]!
 * - aggregatedLineItems(filter, limit, offset) -> AggregatedLineItemConnection!
 * - entityAnalytics(filter, sort, limit, offset) -> EntityAnalyticsConnection!
 *
 * The route picks the year: the request's, else HACK_FOR_FACTS_YEAR, else the
 * latest complete year. Amounts arrive as GraphQL Float and become Decimal
 * strings at this boundary — the no-floats rule applies to arithmetic.
 */

const GraphQLResponseSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
});

const ExecutionAnalyticsSchema = z.object({
  executionAnalytics: z.array(
    z.object({
      seriesId: z.string(),
      data: z.array(z.object({ x: z.string(), y: z.number() })),
    })
  ),
});

const AggregatedLineItemsSchema = z.object({
  aggregatedLineItems: z.object({
    nodes: z.array(
      z.object({
        functional_code: z.string(),
        functional_name: z.string(),
        economic_code: z.string(),
        economic_name: z.string(),
        amount: z.number(),
        count: z.number(),
      })
    ),
  }),
});

const EntityAnalyticsSchema = z.object({
  entityAnalytics: z.object({
    nodes: z.array(
      z.object({
        entity_cui: z.string(),
        entity_name: z.string(),
        amount: z.number(),
      })
    ),
  }),
});

const SUMMARY_QUERY = /* GraphQL */ `
  query DashboardSummary($inputs: [AnalyticsInput!]!) {
    executionAnalytics(inputs: $inputs) {
      seriesId
      data {
        x
        y
      }
    }
  }
`;

const DESTINATIONS_QUERY = /* GraphQL */ `
  query BudgetDestinations($filter: AnalyticsFilterInput!, $limit: Int!) {
    aggregatedLineItems(filter: $filter, limit: $limit) {
      nodes {
        functional_code
        functional_name
        economic_code
        economic_name
        amount
        count
      }
    }
  }
`;

const INSTITUTIONS_QUERY = /* GraphQL */ `
  query CategoryInstitutions($filter: AnalyticsFilterInput!, $limit: Int!) {
    entityAnalytics(filter: $filter, limit: $limit) {
      nodes {
        entity_cui
        entity_name
        amount
      }
    }
  }
`;

const INSTITUTIONS_LIMIT = 50;
const DESTINATIONS_LIMIT = 500;

interface ReportPeriod {
  type: "YEAR";
  selection: { interval: { start: string; end: string } };
}

function reportPeriod(year: string): ReportPeriod {
  return {
    type: "YEAR",
    selection: { interval: { start: year, end: year } },
  };
}

/**
 * Base analytics filter. `report_type: PRINCIPAL_AGGREGATED` selects the
 * per-principal-ordonator execution reports; without it the upstream sums
 * every stored report type (principal + secondary + detailed + commitments),
 * which double/triple-counts each lei.
 */
function analyticsFilter(
  year: string,
  accountCategory: "vn" | "ch",
  normalization: "total" | "percent_gdp"
) {
  return {
    account_category: accountCategory,
    report_period: reportPeriod(year),
    normalization,
    report_type: "PRINCIPAL_AGGREGATED",
  };
}

async function postGraphQL(
  config: AppConfig,
  query: string,
  variables: Record<string, unknown>
): Promise<Result<unknown, AppError>> {
  try {
    const response = await fetch(`${config.hackForFactsBaseUrl}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(config.hackForFactsTimeoutMs),
    });

    if (!response.ok) {
      return err(
        upstreamUnavailable(`hack-for-facts responded with ${response.status}`)
      );
    }

    const parsed = GraphQLResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return err(upstreamUnavailable("unexpected GraphQL response shape"));
    }

    if (parsed.data.errors !== undefined && parsed.data.errors.length > 0) {
      return err(
        upstreamUnavailable(
          parsed.data.errors.map((item) => item.message).join("; ")
        )
      );
    }

    if (parsed.data.data === undefined || parsed.data.data === null) {
      return err(upstreamUnavailable("GraphQL response carried no data"));
    }

    return ok(parsed.data.data);
  } catch {
    return err(upstreamUnavailable("could not reach hack-for-facts-eb-server"));
  }
}

export class HackForFactsSource implements BudgetDataSource {
  constructor(private readonly config: AppConfig) {}

  getYears(): number[] {
    return availableBudgetYears();
  }

  async getSummary(year: string): Promise<Result<BudgetSummary, AppError>> {
    const validated = validateBudgetYear(year);
    if (validated.isErr()) {
      return err(validated.error);
    }

    const result = await postGraphQL(this.config, SUMMARY_QUERY, {
      inputs: [
        {
          seriesId: "revenue",
          filter: analyticsFilter(year, "vn", "total"),
        },
        {
          seriesId: "expenditure",
          filter: analyticsFilter(year, "ch", "total"),
        },
        {
          seriesId: "revenue_pct_gdp",
          filter: analyticsFilter(year, "vn", "percent_gdp"),
        },
        {
          seriesId: "expenditure_pct_gdp",
          filter: analyticsFilter(year, "ch", "percent_gdp"),
        },
      ],
    });
    if (result.isErr()) {
      return err(result.error);
    }

    const parsed = ExecutionAnalyticsSchema.safeParse(result.value);
    if (!parsed.success) {
      return err(upstreamUnavailable("unexpected executionAnalytics shape"));
    }

    return buildSummary(parsed.data.executionAnalytics, Number(year));
  }

  async getDestinations(
    year: string
  ): Promise<Result<BudgetDestination[], AppError>> {
    const validated = validateBudgetYear(year);
    if (validated.isErr()) {
      return err(validated.error);
    }

    const result = await postGraphQL(this.config, DESTINATIONS_QUERY, {
      filter: analyticsFilter(year, "ch", "total"),
      limit: DESTINATIONS_LIMIT,
    });
    if (result.isErr()) {
      return err(result.error);
    }

    const parsed = AggregatedLineItemsSchema.safeParse(result.value);
    if (!parsed.success) {
      return err(upstreamUnavailable("unexpected aggregatedLineItems shape"));
    }

    if (parsed.data.aggregatedLineItems.nodes.length === 0) {
      return err(
        upstreamUnavailable("aggregatedLineItems returned no line items")
      );
    }

    return ok(buildDestinations(parsed.data.aggregatedLineItems.nodes));
  }

  async getInstitutions(
    year: string,
    category: string
  ): Promise<Result<BudgetInstitutions, AppError>> {
    const validated = validateBudgetYear(year);
    if (validated.isErr()) {
      return err(validated.error);
    }

    const result = await postGraphQL(this.config, INSTITUTIONS_QUERY, {
      filter: {
        ...analyticsFilter(year, "ch", "total"),
        functional_codes: [category],
      },
      limit: INSTITUTIONS_LIMIT,
    });
    if (result.isErr()) {
      return err(result.error);
    }

    const parsed = EntityAnalyticsSchema.safeParse(result.value);
    if (!parsed.success) {
      return err(upstreamUnavailable("unexpected entityAnalytics shape"));
    }

    return ok(buildInstitutions(category, parsed.data.entityAnalytics.nodes));
  }
}
