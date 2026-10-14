import type { Context, MiddlewareHandler } from "hono";

import {
  attributionHeader,
  withAttribution,
  type Attribution,
} from "../src/common/attribution";
import { CACHEABLE, NO_STORE } from "../src/infra/http-cache";

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://budget.cristian-nichifor.com",
  "https://budget-dev.cristian-nichifor.com",
];

/** Origins allowed to read the API cross-origin; `CORS_ORIGIN` overrides. */
export function allowedOrigins(corsOrigin: string | undefined): string[] {
  if (corsOrigin === undefined || corsOrigin.trim() === "") {
    return DEFAULT_ALLOWED_ORIGINS;
  }
  return corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

function edgeCache(): EdgeCache | undefined {
  return (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
}

function isCacheableRequest(c: Context): boolean {
  return (
    c.req.method === "GET" &&
    c.req.path.startsWith("/api/") &&
    c.req.path !== "/api/health"
  );
}

function runInBackground(c: Context, task: Promise<unknown>): Promise<void> {
  const settled = task.then(
    () => undefined,
    () => undefined
  );
  try {
    c.executionCtx.waitUntil(settled);
    return Promise.resolve();
  } catch {
    // No execution context (tests, plain fetch calls): finish inline.
    return settled;
  }
}

/**
 * Sets Cache-Control on every response and, where the Workers runtime offers
 * `caches.default`, answers repeated data requests from the edge cache. The
 * stored copy has no CORS headers, so one entry serves every allowed origin;
 * the CORS middleware runs outside this one and decorates each answer.
 */
export function httpCaching(): MiddlewareHandler {
  return async (c, next) => {
    const cacheable = isCacheableRequest(c);
    const cache = cacheable ? edgeCache() : undefined;
    const key = new Request(c.req.url, { method: "GET" });

    if (cache !== undefined) {
      const hit = await cache.match(key);
      if (hit !== undefined) {
        return new Response(hit.body, hit);
      }
    }

    await next();

    const ok = cacheable && c.res.status === 200;
    c.res.headers.set("Cache-Control", ok ? CACHEABLE : NO_STORE);

    if (ok && cache !== undefined) {
      const stored = c.res.clone();
      const headers = new Headers(stored.headers);
      headers.delete("Access-Control-Allow-Origin");
      headers.delete("Vary");
      await runInBackground(
        c,
        cache.put(
          key,
          new Response(stored.body, { status: stored.status, headers })
        )
      );
    }
  };
}

/**
 * Credits the publishers behind each data response: an `attribution` field
 * on JSON objects, the `X-Data-Attribution` header on JSON arrays.
 */
export function dataAttribution(
  sourcesFor: (c: Context) => Attribution[]
): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (
      c.res.status !== 200 ||
      !(c.res.headers.get("Content-Type") ?? "").includes("application/json")
    ) {
      return;
    }
    const sources = sourcesFor(c);
    if (sources.length === 0) {
      return;
    }
    const body: unknown = await c.res.clone().json();
    if (Array.isArray(body)) {
      c.res.headers.set("X-Data-Attribution", attributionHeader(sources));
      return;
    }
    const headers = new Headers(c.res.headers);
    headers.delete("Content-Length");
    // Clear first so Hono does not merge the stale headers back in.
    c.res = undefined;
    c.res = new Response(JSON.stringify(withAttribution(body, sources)), {
      status: 200,
      headers,
    });
  };
}
