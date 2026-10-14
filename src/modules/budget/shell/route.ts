import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import { notFound } from "../../../common/errors";
import type { AppError } from "../../../common/errors";
import type { BudgetDataSource } from "../core/ports";
import { defaultBudgetYear, isPartialYear } from "../core/years";

const BudgetSummaryResponseSchema = Type.Object({
  year: Type.Integer(),
  revenue: Type.String(),
  expenditure: Type.String(),
  deficit: Type.String(),
  deficitPercentGdp: Type.String(),
  partial: Type.Boolean(),
});

const BudgetSubDestinationSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  amount: Type.String(),
});

const BudgetDestinationSchema = Type.Intersect([
  BudgetSubDestinationSchema,
  Type.Object({
    percentOfTotal: Type.String(),
    subDestinations: Type.Optional(Type.Array(BudgetSubDestinationSchema)),
  }),
]);

const YearQuerySchema = Type.Object({
  year: Type.Optional(Type.String({ pattern: "^[0-9]{4}$" })),
});

const InstitutionsQuerySchema = Type.Intersect([
  YearQuerySchema,
  Type.Object({
    category: Type.String({ minLength: 1 }),
  }),
]);

const InstitutionsResponseSchema = Type.Object({
  category: Type.String(),
  total: Type.String(),
  institutions: Type.Array(BudgetSubDestinationSchema),
  partial: Type.Boolean(),
});

const YearsResponseSchema = Type.Object({
  years: Type.Array(Type.Integer()),
  defaultYear: Type.Integer(),
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

interface BudgetRouteDependencies {
  source: BudgetDataSource;
  /** Year override (HACK_FOR_FACTS_YEAR); unset means latest complete year. */
  yearOverride: string | undefined;
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

export const budgetRoutes: FastifyPluginAsync<{
  dependencies: BudgetRouteDependencies;
}> = async (app, options) => {
  const { source, yearOverride } = options.dependencies;
  const yearOf = (request: { query: unknown }): string =>
    (request.query as { year?: string }).year ??
    defaultBudgetYear(yearOverride, source.getYears());

  app.get(
    "/years",
    {
      schema: {
        response: { 200: YearsResponseSchema, ...ErrorResponses },
      },
    },
    async (_request, reply) => {
      const years = source.getYears();
      return reply.send({
        years,
        defaultYear: Number(defaultBudgetYear(yearOverride, years)),
      });
    }
  );

  app.get(
    "/summary",
    {
      schema: {
        querystring: YearQuerySchema,
        response: { 200: BudgetSummaryResponseSchema, ...ErrorResponses },
      },
    },
    async (request, reply) => {
      const result = await source.getSummary(yearOf(request));
      if (result.isErr()) {
        return reply.code(statusFor(result.error)).send(result.error);
      }
      return { ...result.value, partial: isPartialYear(result.value.year) };
    }
  );

  app.get(
    "/destinations",
    {
      schema: {
        querystring: YearQuerySchema,
        response: {
          200: Type.Array(BudgetDestinationSchema),
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const result = await source.getDestinations(yearOf(request));
      if (result.isErr()) {
        return reply.code(statusFor(result.error)).send(result.error);
      }
      return result.value;
    }
  );

  app.get(
    "/institutions",
    {
      schema: {
        querystring: InstitutionsQuerySchema,
        response: {
          200: InstitutionsResponseSchema,
          ...ErrorResponses,
        },
      },
    },
    async (request, reply) => {
      const { category } = request.query as { category: string };
      const year = yearOf(request);
      const result = await source.getInstitutions(year, category);
      if (result.isErr()) {
        return reply.code(statusFor(result.error)).send(result.error);
      }

      if (result.value.institutions.length === 0) {
        return reply.code(404).send(notFound(`unknown category: ${category}`));
      }

      return { ...result.value, partial: isPartialYear(Number(year)) };
    }
  );
};
