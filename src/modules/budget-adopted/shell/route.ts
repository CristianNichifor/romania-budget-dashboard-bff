import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import type { Decimal } from "decimal.js";
import type { AppError } from "../../../common/errors";
import type { BudgetDataSource } from "../../budget/core/ports";
import type { AdoptedBudgetDataSource } from "../core/ports";
import { ADOPTED_SCOPE_NOTE } from "../core/types";
import { compareBudgetYears } from "./comparison";

const AdoptedFundResponseSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  revenue: Type.String(),
  expenditure: Type.String(),
  deficit: Type.String(),
});

const AdoptedResponseSchema = Type.Object({
  year: Type.Integer(),
  revenue: Type.String(),
  expenditure: Type.String(),
  deficit: Type.String(),
  funds: Type.Array(AdoptedFundResponseSchema),
  warnings: Type.Array(Type.String()),
  note: Type.String(),
});

const YearQuerySchema = Type.Object({
  year: Type.Optional(Type.String({ pattern: "^[0-9]{4}$" })),
});

const ComparisonQuerySchema = Type.Object({
  years: Type.Optional(Type.String({ pattern: "^[0-9]{4}(,[0-9]{4})*$" })),
});

const ComparisonSideSchema = Type.Object({
  revenue: Type.String(),
  expenditure: Type.String(),
  deficit: Type.String(),
});

const ComparisonExecutedSchema = Type.Object({
  revenue: Type.String(),
  expenditure: Type.String(),
  deficit: Type.String(),
  deficitPercentGdp: Type.String(),
});

const ComparisonPointSchema = Type.Object({
  year: Type.Integer(),
  adopted: ComparisonSideSchema,
  executed: Type.Union([ComparisonExecutedSchema, Type.Null()]),
  deficitDelta: Type.Union([Type.String(), Type.Null()]),
  note: Type.String(),
});

const ComparisonResponseSchema = Type.Object({
  points: Type.Array(ComparisonPointSchema),
});

const ErrorResponseSchema = Type.Object({
  code: Type.String(),
  message: Type.String(),
});

const ErrorResponses = {
  400: ErrorResponseSchema,
  404: ErrorResponseSchema,
  500: ErrorResponseSchema,
  502: ErrorResponseSchema,
} as const;

interface AdoptedRouteDependencies {
  adoptedSource: AdoptedBudgetDataSource;
  budgetSource: BudgetDataSource;
}

function statusFor(error: AppError): 400 | 404 | 500 | 502 {
  if (error.code === "NOT_FOUND") {
    return 404;
  }
  if (error.code === "UPSTREAM_UNAVAILABLE") {
    return 502;
  }
  if (error.code === "INVALID_INPUT") {
    return 400;
  }
  return 500;
}

function money(value: Decimal): string {
  return value.toFixed(0);
}

export const budgetAdoptedRoutes: FastifyPluginAsync<{
  dependencies: AdoptedRouteDependencies;
}> = async (app, options) => {
  const { adoptedSource, budgetSource } = options.dependencies;

  app.get(
    "/adopted",
    {
      schema: {
        querystring: YearQuerySchema,
        response: { 200: AdoptedResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      const year =
        (request.query as { year?: string }).year ??
        String(adoptedSource.supportedYears().at(-1) ?? 2025);
      const result = await adoptedSource.getAdopted(year);
      if (result.isErr()) {
        return reply.code(statusFor(result.error)).send(result.error);
      }
      const totals = result.value;
      return {
        year: totals.year,
        revenue: money(totals.revenue),
        expenditure: money(totals.expenditure),
        deficit: money(totals.deficit),
        funds: totals.funds.map((fund) => ({
          id: fund.id,
          name: fund.name,
          revenue: money(fund.revenue),
          expenditure: money(fund.expenditure),
          deficit: money(fund.deficit),
        })),
        warnings: totals.warnings,
        note: ADOPTED_SCOPE_NOTE,
      };
    }
  );

  app.get(
    "/comparison",
    {
      schema: {
        querystring: ComparisonQuerySchema,
        response: { 200: ComparisonResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      const result = await compareBudgetYears(
        adoptedSource,
        budgetSource,
        (request.query as { years?: string }).years
      );
      if (result.isErr()) {
        return reply.code(statusFor(result.error)).send(result.error);
      }
      return result.value;
    }
  );
};
