import fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "../infra/config";
import { CACHEABLE, NO_STORE } from "../infra/http-cache";
import { buildBudgetSource } from "../modules/budget/shell/repo";
import { budgetRoutes } from "../modules/budget/shell/route";
import { contextRoutes } from "../modules/context/shell/route";
import { buildContextSource } from "../modules/context/shell/repo";
import { buildInsSource } from "../modules/ins/shell/repo";
import { insRoutes } from "../modules/ins/shell/route";
import { investmentsRoutes } from "../modules/investments/shell/route";
import { buildInvestmentsSource } from "../modules/investments/shell/repo";
import { salaryRoutes } from "../modules/salary/shell/route";
import { staticTaxRates } from "../modules/salary/shell/repo";
import { soeRoutes } from "../modules/soe/shell/route";
import { buildSoeSource } from "../modules/soe/shell/repo";
import { macroRoutes } from "../modules/macro/shell/route";
import { buildMacroSource } from "../modules/macro/shell/repo";
import { buildAdoptedSource } from "../modules/budget-adopted/shell/repo";
import { budgetAdoptedRoutes } from "../modules/budget-adopted/shell/route";
import type { AdoptedBudgetDataSource } from "../modules/budget-adopted/core/ports";
import type { BudgetDataSource } from "../modules/budget/core/ports";
import type { ContextDataSource } from "../modules/context/core/ports";
import { buildWageSource } from "../modules/wages/shell/repo";
import { wageRoutes } from "../modules/wages/shell/route";
import { buildSocietySource } from "../modules/society/shell/repo";
import { societyRoutes } from "../modules/society/shell/route";
import { buildEnergySource } from "../modules/energy/shell/repo";
import { energyRoutes } from "../modules/energy/shell/route";
import { buildLabourSource } from "../modules/labour/shell/repo";
import { labourRoutes } from "../modules/labour/shell/route";
import { buildJusticeSource } from "../modules/justice/shell/repo";
import { justiceRoutes } from "../modules/justice/shell/route";

export interface AppDependencies {
  config: AppConfig;
  overrides?: {
    adoptedSource?: AdoptedBudgetDataSource;
    budgetSource?: BudgetDataSource;
    contextSource?: ContextDataSource;
  };
}

export function buildApp({
  config,
  overrides,
}: AppDependencies): FastifyInstance {
  const app = fastify({
    logger: config.nodeEnv === "test" ? false : { level: config.logLevel },
    disableRequestLogging: config.nodeEnv !== "development",
  });

  void app.register(cors, {
    origin: config.corsOrigin
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  });

  void app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const path = request.url.split("?")[0] ?? "";
    const cacheable =
      request.method === "GET" &&
      reply.statusCode === 200 &&
      path.startsWith("/api/") &&
      path !== "/api/health";
    void reply.header("Cache-Control", cacheable ? CACHEABLE : NO_STORE);
    return payload;
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => ({ status: "ready" }));

  const budgetSource = buildBudgetSource(config);
  const contextSource = overrides?.contextSource ?? buildContextSource(config);
  const insSource = buildInsSource(config);

  void app.register(salaryRoutes, {
    prefix: "/api/salary",
    dependencies: { taxRates: staticTaxRates },
  });

  void app.register(budgetRoutes, {
    prefix: "/api/budget",
    dependencies: {
      source: budgetSource,
      defaultYear: config.hackForFactsYear,
    },
  });

  void app.register(contextRoutes, {
    prefix: "/api/context",
    dependencies: { source: contextSource },
  });

  void app.register(insRoutes, {
    prefix: "/api/ins",
    dependencies: { source: insSource },
  });

  const investmentsSource = buildInvestmentsSource(config);
  void app.register(investmentsRoutes, {
    prefix: "/api/investments",
    dependencies: { source: investmentsSource },
  });

  const soeSource = buildSoeSource(config);
  void app.register(soeRoutes, {
    prefix: "/api/soe",
    dependencies: { source: soeSource },
  });

  const macroSource = buildMacroSource(config);
  void app.register(macroRoutes, {
    prefix: "/api/macro",
    dependencies: { source: macroSource },
  });

  const adoptedSource = overrides?.adoptedSource ?? buildAdoptedSource(config);
  void app.register(budgetAdoptedRoutes, {
    prefix: "/api/budget",
    dependencies: {
      adoptedSource,
      budgetSource: overrides?.budgetSource ?? budgetSource,
    },
  });

  const wageSource = buildWageSource(config);
  void app.register(wageRoutes, {
    prefix: "/api/wages",
    dependencies: { source: wageSource },
  });

  const societySource = buildSocietySource(config);
  void app.register(societyRoutes, {
    prefix: "/api/society",
    dependencies: { source: societySource },
  });

  const energySource = buildEnergySource(config);
  void app.register(energyRoutes, {
    prefix: "/api/energy",
    dependencies: { source: energySource },
  });

  const labourSource = buildLabourSource(config);
  void app.register(labourRoutes, {
    prefix: "/api/labour",
    dependencies: { source: labourSource },
  });

  const justiceSource = buildJusticeSource(config);
  void app.register(justiceRoutes, {
    prefix: "/api/justice",
    dependencies: { source: justiceSource },
  });

  return app;
}
