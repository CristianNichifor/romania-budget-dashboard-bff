import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";

const CACHEABLE =
  "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400";

const env = {
  NODE_ENV: "test",
  DATA_SOURCE: "static",
  DATA_SOURCE_INS: "static",
};

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
        index: { "2023": 0, "2024": 1 },
        label: { "2023": "2023", "2024": "2024" },
      },
    },
    geo: { label: "Geo", category: { index: { RO: 0 } } },
  },
};

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => jsonStat,
  text: async () => JSON.stringify(jsonStat),
}));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function routePaths(): string[] {
  const paths = new Set<string>();
  for (const route of worker.routes) {
    if (route.method !== "GET" || route.path.includes("*")) {
      continue;
    }
    paths.add(route.path.replace(":cui", "1234"));
  }
  return [...paths];
}

describe("Cache-Control", () => {
  it("covers every GET route", async () => {
    const paths = routePaths();
    expect(paths.length).toBeGreaterThan(40);
    for (const path of paths) {
      const response = await worker.request(path, {}, env);
      const isData = path.startsWith("/api/") && path !== "/api/health";
      const expected =
        response.status === 200 && isData ? CACHEABLE : "no-store";
      expect(response.headers.get("Cache-Control"), path).toBe(expected);
    }
  });

  it.each([
    "/api/budget/years",
    "/api/budget/summary?year=2026",
    "/api/budget/destinations?year=2026",
    "/api/salary/calculate?gross=9427",
    "/api/ins/catalog",
    "/api/investments/by-county",
    "/api/macro/inflation",
    "/api/society/health",
  ])("marks %s as publicly cacheable", async (path) => {
    const response = await worker.request(path, {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(CACHEABLE);
  });

  it.each([
    ["/api/salary/calculate?gross=abc", 400],
    ["/api/budget/institutions?category=missing&year=2026", 404],
    ["/api/nope", 404],
    ["/health/live", 200],
    ["/health/ready", 200],
    ["/api/health", 200],
  ])("marks %s as no-store", async (path, status) => {
    const response = await worker.request(path, {}, env);
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

interface StoredEntry {
  body: string;
  headers: Headers;
  status: number;
}

function fakeEdgeCache(): {
  store: Map<string, StoredEntry>;
  cache: {
    match: (request: Request) => Promise<Response | undefined>;
    put: (request: Request, response: Response) => Promise<void>;
  };
} {
  const store = new Map<string, StoredEntry>();
  return {
    store,
    cache: {
      async match(request) {
        const entry = store.get(request.url);
        if (entry === undefined) {
          return undefined;
        }
        return new Response(entry.body, {
          status: entry.status,
          headers: entry.headers,
        });
      },
      async put(request, response) {
        store.set(request.url, {
          body: await response.text(),
          headers: new Headers(response.headers),
          status: response.status,
        });
      },
    },
  };
}

describe("edge cache", () => {
  it("serves a repeated data request from caches.default", async () => {
    const { store, cache } = fakeEdgeCache();
    vi.stubGlobal("caches", { default: cache });
    const cacheEnv = { ...env, MACRO_TIMEOUT_MS: "15101" };
    const url = "https://budget.example/api/macro/unemployment";

    const first = await worker.request(
      url,
      { headers: { Origin: "https://budget.cristian-nichifor.com" } },
      cacheEnv
    );
    expect(first.status).toBe(200);
    expect(store.has(url)).toBe(true);
    // The stored copy is origin-neutral.
    expect(
      store.get(url)?.headers.get("Access-Control-Allow-Origin")
    ).toBeNull();

    // A cold isolate would refetch; the edge cache must answer instead.
    const second = await worker.request(
      url,
      { headers: { Origin: "https://budget-dev.cristian-nichifor.com" } },
      { ...cacheEnv, MACRO_TIMEOUT_MS: "15102" }
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(second.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://budget-dev.cristian-nichifor.com"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not store errors or health probes", async () => {
    const { store, cache } = fakeEdgeCache();
    vi.stubGlobal("caches", { default: cache });

    await worker.request(
      "https://budget.example/api/salary/calculate?gross=abc",
      {},
      env
    );
    await worker.request("https://budget.example/api/health", {}, env);

    expect(store.size).toBe(0);
  });
});

describe("GET /api/budget/comparison input", () => {
  it("rejects more than ten distinct years without calling upstream", async () => {
    const years = Array.from({ length: 11 }, (_, i) => 2010 + i).join(",");
    const response = await worker.request(
      `/api/budget/comparison?years=${years}`,
      {},
      env
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      "INVALID_INPUT"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  it("turns an unhandled exception into a JSON 500", async () => {
    const response = await worker.request(
      "/api/salary/calculate?gross=1",
      {},
      { ...env, PORT: "not-a-port" }
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "INTERNAL",
      message: "internal error",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("serves /api/health like /health/ready", async () => {
    const response = await worker.request("/api/health", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });
});

describe("CORS", () => {
  it.each([
    "https://budget.cristian-nichifor.com",
    "https://budget-dev.cristian-nichifor.com",
  ])("echoes the allowed origin %s", async (origin) => {
    const response = await worker.request(
      "/api/budget/years",
      { headers: { Origin: origin } },
      env
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("sends no allow-origin header to other origins", async () => {
    const response = await worker.request(
      "/api/budget/years",
      { headers: { Origin: "https://evil.example" } },
      env
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("lets CORS_ORIGIN override the list", async () => {
    const response = await worker.request(
      "/api/budget/years",
      { headers: { Origin: "http://localhost:5173" } },
      { ...env, CORS_ORIGIN: "http://localhost:5173" }
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173"
    );
  });
});
