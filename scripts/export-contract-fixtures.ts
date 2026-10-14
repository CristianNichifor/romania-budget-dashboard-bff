import { writeFile } from "node:fs/promises";
import { buildApp } from "../src/app/build-app";
import { loadConfig } from "../src/infra/config";

// DEMO NOTE: versioned static API examples shared with romania-budget-dashboard.
const paths = [
  "/api/budget/years",
  "/api/budget/summary?year=2026",
  "/api/budget/destinations?year=2026",
  "/api/budget/institutions?category=pensii&year=2026",
  "/api/salary/calculate?gross=9427.13",
  "/api/ins/metrics?code=infant-mortality",
  "/api/ins/catalog",
  "/api/investments/by-county",
];
// `partial` and the default year depend on the clock; pin it so a refresh
// is reproducible. Keep in step with FIXTURE_NOW in contract.test.ts.
const FIXTURE_NOW = Date.parse("2026-10-14T12:00:00Z");
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(value?: string | number | Date) {
    super(value ?? FIXTURE_NOW);
  }
  static override now(): number {
    return FIXTURE_NOW;
  }
} as DateConstructor;

const app = buildApp({ config: loadConfig({ NODE_ENV: "test" }) });
// A fixture refresh must never collect live production data.
globalThis.fetch = async () => {
  throw new Error("Network disabled for fixtures");
};
try {
  const fixtures: Record<string, unknown> = {};
  for (const path of paths) {
    const response = await app.inject({ method: "GET", url: path });
    if (response.statusCode !== 200)
      throw new Error(`${path}: ${response.statusCode}`);
    fixtures[path] = response.json();
  }
  await writeFile(
    new URL("../tests/fixtures/api-contract.json", import.meta.url),
    JSON.stringify(fixtures, null, 2) + "\n"
  );
} finally {
  await app.close();
}
