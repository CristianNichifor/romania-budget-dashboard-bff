import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { AppError } from "../src/common/errors";
import { notFound } from "../src/common/errors";
import { loadConfig, type AppConfig } from "../src/infra/config";
import { buildBudgetSource } from "../src/modules/budget/shell/repo";
import type { BudgetDataSource } from "../src/modules/budget/core/ports";
import { buildContextSource } from "../src/modules/context/shell/repo";
import type { ContextDataSource } from "../src/modules/context/core/ports";
import { buildInsSource } from "../src/modules/ins/shell/repo";
import type { InsDataSource } from "../src/modules/ins/core/ports";
import { buildInvestmentsSource } from "../src/modules/investments/shell/repo";
import type { InvestmentsSource } from "../src/modules/investments/core/ports";
import { calculateSalaryBreakdown } from "../src/modules/salary/core/use-cases/calculate-salary";
import { staticTaxRates } from "../src/modules/salary/shell/repo";
import { serializeSalaryBreakdown } from "../src/modules/salary/shell/serialize";
import { buildSoeSource } from "../src/modules/soe/shell/repo";
import type { SoeDataSource } from "../src/modules/soe/core/ports";
import { buildMacroSource } from "../src/modules/macro/shell/repo";
import type { MacroDataSource } from "../src/modules/macro/core/ports";
import { buildAdoptedSource } from "../src/modules/budget-adopted/shell/repo";
import type { AdoptedBudgetDataSource } from "../src/modules/budget-adopted/core/ports";
import { compareBudgetYears } from "../src/modules/budget-adopted/shell/comparison";
import { ADOPTED_SCOPE_NOTE } from "../src/modules/budget-adopted/core/types";
import { buildWageSource } from "../src/modules/wages/shell/repo";
import type { WageDataSource } from "../src/modules/wages/core/ports";
import { buildSocietySource } from "../src/modules/society/shell/repo";
import type { SocietyDataSource } from "../src/modules/society/core/ports";
import { buildEnergySource } from "../src/modules/energy/shell/repo";
import type { EnergyDataSource } from "../src/modules/energy/core/ports";
import { buildLabourSource } from "../src/modules/labour/shell/repo";
import type { LabourDataSource } from "../src/modules/labour/core/ports";
import { buildJusticeSource } from "../src/modules/justice/shell/repo";
import type { JusticeDataSource } from "../src/modules/justice/core/ports";
import type { Decimal } from "decimal.js";

type Env = Record<string, string | undefined>;

interface Sources {
  budget: BudgetDataSource;
  context: ContextDataSource;
  ins: InsDataSource;
  investments: InvestmentsSource;
  soe: SoeDataSource;
  macro: MacroDataSource;
  adopted: AdoptedBudgetDataSource;
  wages: WageDataSource;
  society: SocietyDataSource;
  energy: EnergyDataSource;
  labour: LabourDataSource;
  justice: JusticeDataSource;
}

interface AppVariables {
  sources: Sources;
  config: AppConfig;
}

function buildSources(config: AppConfig): Sources {
  return {
    budget: buildBudgetSource(config),
    context: buildContextSource(config),
    ins: buildInsSource(config),
    investments: buildInvestmentsSource(config),
    soe: buildSoeSource(config),
    macro: buildMacroSource(config),
    adopted: buildAdoptedSource(config),
    wages: buildWageSource(config),
    society: buildSocietySource(config),
    energy: buildEnergySource(config),
    labour: buildLabourSource(config),
    justice: buildJusticeSource(config),
  };
}

// Sources hold per-instance TTL caches; building them per request threw those
// caches away. Keep one set per configuration for the life of the isolate.
let memo: { key: string; sources: Sources } | undefined;

function sourcesFor(config: AppConfig): Sources {
  const key = JSON.stringify(config);
  if (memo === undefined || memo.key !== key) {
    memo = { key, sources: buildSources(config) };
  }
  return memo.sources;
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

function errorReply(c: Context, error: AppError): Response {
  return c.json(error, statusFor(error) as 400 | 404 | 500 | 502);
}

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use("/api/*", cors({ origin: "*" }), async (c, next) => {
  const config = loadConfig(c.env);
  c.set("config", config);
  c.set("sources", sourcesFor(config));
  await next();
});

app.get("/health/live", (c) => c.json({ status: "ok" }));
app.get("/health/ready", (c) => c.json({ status: "ready" }));

app.get("/api/budget/years", (c) => {
  return c.json({ years: c.get("sources").budget.getYears() });
});

app.get("/api/budget/summary", async (c) => {
  const year = c.req.query("year") ?? c.get("config").hackForFactsYear;
  const result = await c.get("sources").budget.getSummary(year);
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/budget/destinations", async (c) => {
  const year = c.req.query("year") ?? c.get("config").hackForFactsYear;
  const result = await c.get("sources").budget.getDestinations(year);
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/budget/institutions", async (c) => {
  const category = c.req.query("category") ?? "";
  const year = c.req.query("year") ?? c.get("config").hackForFactsYear;
  const result = await c.get("sources").budget.getInstitutions(year, category);
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  if (result.value.institutions.length === 0) {
    return c.json(notFound(`unknown category: ${category}`), 404);
  }
  return c.json(result.value);
});

function money(value: Decimal): string {
  return value.toFixed(0);
}

app.get("/api/budget/adopted", async (c) => {
  const adopted = c.get("sources").adopted;
  const year =
    c.req.query("year") ?? String(adopted.supportedYears().at(-1) ?? 2025);
  if (!/^\d{4}$/.test(year)) {
    return c.json(
      { code: "INVALID_INPUT", message: `invalid year: ${year}` },
      400
    );
  }
  const result = await adopted.getAdopted(year);
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  const totals = result.value;
  return c.json({
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
  });
});

app.get("/api/budget/comparison", async (c) => {
  const { adopted, budget } = c.get("sources");
  const result = await compareBudgetYears(
    adopted,
    budget,
    c.req.query("years")
  );
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/context/trends", async (c) => {
  const metric = c.req.query("metric") ?? "";
  const result = await c.get("sources").context.getTrend(metric);
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  if (result.value.data.length === 0) {
    return c.json(notFound(`unknown metric: ${metric}`), 404);
  }
  return c.json(result.value);
});

app.get("/api/ins/catalog", async (c) => {
  const result = await c.get("sources").ins.getCatalog();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json({ metrics: result.value });
});

app.get("/api/ins/metrics", async (c) => {
  const code = c.req.query("code") ?? "";
  const result = await c.get("sources").ins.getMetric(code);
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  if (result.value.data.length === 0) {
    return c.json(notFound(`unknown metric: ${code}`), 404);
  }
  return c.json(result.value);
});

app.get("/api/investments/by-county", async (c) => {
  const result = await c.get("sources").investments.getByCounty();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/salary/calculate", (c) => {
  const gross = c.req.query("gross") ?? "";
  const result = calculateSalaryBreakdown(gross, staticTaxRates.get());
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(serializeSalaryBreakdown(result.value));
});

app.get("/api/soe/summary", async (c) => {
  const result = await c.get("sources").soe.getSummary();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/soe/sector-trend", async (c) => {
  const result = await c.get("sources").soe.getSectorTrend();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/soe/by-county", async (c) => {
  const result = await c.get("sources").soe.getByCounty();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/soe/scatter", async (c) => {
  const result = await c.get("sources").soe.getScatter();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/soe/companies/:cui", async (c) => {
  const cui = c.req.param("cui");
  if (!/^\d{1,12}$/.test(cui)) {
    return c.json({ code: "INVALID_INPUT", message: "invalid cui" }, 400);
  }
  const result = await c.get("sources").soe.getCompany(cui);
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/soe/subsidies", async (c) => {
  const year = c.req.query("year");
  const result = await c.get("sources").soe.getSubsidies(year);
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/soe/listed", async (c) => {
  const result = await c.get("sources").soe.getListed();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/inflation", async (c) => {
  const result = await c.get("sources").macro.getInflation();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/unemployment", async (c) => {
  const result = await c.get("sources").macro.getUnemployment();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/fx", async (c) => {
  const result = await c.get("sources").macro.getFx();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/gdp-growth", async (c) => {
  const result = await c.get("sources").macro.getGdpGrowth();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/gdp-per-capita", async (c) => {
  const result = await c.get("sources").macro.getGdpPerCapita();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/gdp-regions", async (c) => {
  const result = await c.get("sources").macro.getGdpRegions();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/debt", async (c) => {
  const result = await c.get("sources").macro.getDebt();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/trade", async (c) => {
  const result = await c.get("sources").macro.getTrade();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/demographics", async (c) => {
  const result = await c.get("sources").macro.getDemographics();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/deficit", async (c) => {
  const result = await c.get("sources").macro.getDeficit();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/employment", async (c) => {
  const result = await c.get("sources").macro.getEmployment();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/current-account", async (c) => {
  const result = await c.get("sources").macro.getCurrentAccount();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/macro/rates", async (c) => {
  const result = await c.get("sources").macro.getRates();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/wages/context", async (c) => {
  const result = await c.get("sources").wages.getContext();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/wages/monthly", async (c) => {
  const result = await c.get("sources").wages.getMonthly();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/wages/real", async (c) => {
  const result = await c.get("sources").wages.getReal();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/society/population", async (c) => {
  const result = await c.get("sources").society.getPopulation();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/society/spending", async (c) => {
  const result = await c.get("sources").society.getSpending();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/society/education", async (c) => {
  const result = await c.get("sources").society.getEducation();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/society/health", async (c) => {
  const result = await c.get("sources").society.getHealth();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/society/demographics", async (c) => {
  const result = await c.get("sources").society.getDemographics();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/energy/context", async (c) => {
  const result = await c.get("sources").energy.getContext();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/labour/context", async (c) => {
  const result = await c.get("sources").labour.getContext();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.get("/api/justice/context", async (c) => {
  const result = await c.get("sources").justice.getContext();
  if (result.isErr()) {
    return errorReply(c, result.error);
  }
  return c.json(result.value);
});

app.notFound((c) => c.json({ code: "NOT_FOUND", message: "not found" }, 404));

export default app;
