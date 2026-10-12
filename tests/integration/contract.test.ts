import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app/build-app";
import { loadConfig } from "../../src/infra/config";
import worker from "../../worker/index";
import fixtures from "../fixtures/api-contract.json";

const env = {
  NODE_ENV: "test",
  DATA_SOURCE: "static",
  DATA_SOURCE_INS: "static",
};
const app = buildApp({ config: loadConfig(env) });
const fetchSpy = vi.fn(() => {
  throw new Error("Unexpected upstream request");
});
beforeAll(() => {
  vi.stubGlobal("fetch", fetchSpy);
});
afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

describe("frontend contract fixtures through actual HTTP handlers", () => {
  for (const [path, expected] of Object.entries(fixtures)) {
    it(`Fastify and Worker serialize ${path} identically`, async () => {
      const response = await app.inject({ method: "GET", url: path });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expected);
      const edge = await worker.request(path, {}, env);
      expect(edge.status).toBe(200);
      expect(await edge.json()).toEqual(expected);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it("keeps money at two decimals and percentages at four", async () => {
    const response = await app.inject("/api/salary/calculate?gross=9427.13");
    const body = response.json();
    expect(body.gross).toBe("9427.13");
    for (const key of [
      "gross",
      "cas",
      "cass",
      "incomeTax",
      "employerContribution",
      "estimatedVat",
      "net",
      "employerCost",
      "stateShare",
    ]) {
      expect(body[key]).toMatch(/^\d+\.\d{2}$/);
    }
    expect(body.statePercent).toMatch(/^\d+\.\d{4}$/);
    for (const entry of body.entries)
      expect(entry.amount).toMatch(/^-?\d+\.\d{2}$/);
  });

  it.each([
    ["/api/salary/calculate?gross=abc", 400, "INVALID_INPUT"],
    ["/api/budget/institutions?category=missing&year=2026", 404, "NOT_FOUND"],
    ["/api/ins/metrics?code=missing", 404, "NOT_FOUND"],
  ])("preserves error contracts for %s", async (path, status, code) => {
    const response = await app.inject(path);
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code });
    const edge = await worker.request(path, {}, env);
    expect(edge.status).toBe(status);
    expect(await edge.json()).toMatchObject({ code });
  });
});
