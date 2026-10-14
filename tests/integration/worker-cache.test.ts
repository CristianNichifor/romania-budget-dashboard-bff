import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";

const jsonStat = {
  version: "2.0",
  class: "dataset",
  id: ["freq", "unit", "geo", "time"],
  size: [1, 1, 1, 2],
  value: { 0: 2.9, 1: 3.0 },
  updated: "2026-08-14T09:00:00+0200",
  dimension: {
    time: {
      label: "Time",
      category: {
        index: { "2026-01": 0, "2026-02": 1 },
        label: { "2026-01": "2026-01", "2026-02": "2026-02" },
      },
    },
    geo: { label: "Geo", category: { index: { RO: 0 } } },
  },
};

function stubUpstream(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => jsonStat,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("worker data sources", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reuses the source caches across requests in one isolate", async () => {
    const fetchMock = stubUpstream();
    // A configuration no other test uses, so the isolate memo starts cold.
    const env = { MACRO_TIMEOUT_MS: "15001" };

    const first = await worker.request("/api/macro/inflation", {}, env);
    const second = await worker.request("/api/macro/inflation", {}, env);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds separate sources for a different configuration", async () => {
    const fetchMock = stubUpstream();

    await worker.request(
      "/api/macro/inflation",
      {},
      { MACRO_TIMEOUT_MS: "15002" }
    );
    await worker.request(
      "/api/macro/inflation",
      {},
      { MACRO_TIMEOUT_MS: "15003" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
