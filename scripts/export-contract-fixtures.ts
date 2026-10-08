import { writeFile } from "node:fs/promises";
import { buildApp } from "../src/app/build-app";
import { loadConfig } from "../src/infra/config";

// DEMO NOTE: versioned static API examples shared with romania-budget-dashboard.
const paths = [
  "/api/budget/summary?year=2026",
  "/api/budget/destinations?year=2026",
  "/api/budget/institutions?category=pensii&year=2026",
  "/api/salary/calculate?gross=9427.13",
  "/api/ins/metrics?code=infant-mortality",
  "/api/ins/catalog",
  "/api/investments/by-county",
];
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
