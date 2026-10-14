# Production readiness

Scope: the Cloudflare Worker serving `https://budget.cristian-nichifor.com/api/*`
(`worker/index.ts`) and, where the frontend contract is shared, the Fastify app
(`src/app/build-app.ts`). Contract changes are additive: existing fields keep
their names, types and meaning.

Status legend: `todo`, `done`, `blocked`, `needs-human`.

## Theme A — performance

### B1 — data sources live for the isolate, not the request (`done`)

The Worker rebuilt every data source per request, so the in-memory TTL caches
in the Eurostat, ECB, CKAN, companiidestat and wages repositories never held a
value past one request.

- Given a Worker isolate with one configuration
- When two requests hit the same Eurostat-backed endpoint
- Then the upstream is fetched once and both responses are 200
- And a different configuration builds its own sources

Test: `tests/integration/worker-cache.test.ts`.

### B2 — HTTP caching (`done`)

- Given any successful `GET /api/*` data response
- Then it carries `Cache-Control: public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400`
- Given any 4xx/5xx response (and the health probes)
- Then it carries `Cache-Control: no-store`
- Given the Worker runs where `caches.default` exists
- When a cacheable data response is produced
- Then it is stored in the edge cache keyed by URL (without CORS headers) and
  a later identical request is answered from the cache without calling the handler

Test: `tests/integration/worker-http.test.ts` (header assertions across every
route, edge cache with a fake `caches.default`), `tests/integration/api.test.ts`
(Fastify parity).

### B3 — bounded comparison input (`done`)

- Given `GET /api/budget/comparison?years=2021,2021,2020`
- Then the response holds one point per distinct year, in ascending order
- Given more than 10 distinct years
- Then the response is `400 INVALID_INPUT`
- And the per-year upstream reads run concurrently (`Promise.all`)

Test: `tests/unit/comparison-years.test.ts`, `tests/integration/worker-http.test.ts`,
`tests/integration/adopted.test.ts`.

## Theme B — robustness

### B4 — JSON 500 and `/api/health` (`done`)

- Given a handler throws
- Then the Worker answers `500 {"code":"INTERNAL","message":"internal error"}` with `no-store`
- Given `GET /api/health`
- Then it answers like `/health/ready`: `200 {"status":"ready"}`

Test: `tests/integration/worker-http.test.ts`.

### B6 — CORS allow-list (`done`)

- Given `Origin: https://budget.cristian-nichifor.com` or `https://budget-dev.cristian-nichifor.com`
- Then `Access-Control-Allow-Origin` echoes that origin and `Vary: Origin` is set
- Given any other origin
- Then no `Access-Control-Allow-Origin` header is sent
- `CORS_ORIGIN` (comma-separated) overrides the list for local `wrangler dev`

Test: `tests/integration/worker-http.test.ts`.

### B11 — compatibility date (`done`)

- Given `wrangler.toml` `compatibility_date` is bumped to a current date
- Then `wrangler deploy --dry-run` bundles and the Worker serves health and
  static-data routes under `wrangler dev` (manual check, recorded in the PR)
- Bumped to `2026-09-01`, the newest date the pinned workerd (1.20260926) accepts.
  The Worker uses no compatibility flags; `wrangler dev` served health, static
  and live (Eurostat, CKAN, transparenta.eu) routes.

## Theme C — data correctness

### B5 — default year is the latest complete year (`todo`)

- Given no `year` query and no `HACK_FOR_FACTS_YEAR`
- Then budget summary/destinations/institutions use the latest complete year
  from `availableBudgetYears()` (the current calendar year is in progress)
- Given `HACK_FOR_FACTS_YEAR` is set
- Then it overrides the default
- Summary, institutions and comparison points carry additive `partial: boolean`,
  true for the in-progress year; `/api/budget/years` adds `defaultYear`

Test: `tests/unit/budget-years.test.ts`, `tests/integration/worker-http.test.ts`,
`tests/integration/contract.test.ts` (fixture refreshed with a pinned clock).

### B7 — source and licence metadata (`todo`)

- Given a 200 JSON object response from a data route
- Then it carries additive `attribution: [{ name, url, licence, licenceUrl }]`
  naming every upstream that fed it
- Array responses carry the same data in the `X-Data-Attribution` header (JSON)
- README has an attribution table with each licence verified from the source's terms

Test: `tests/unit/attribution.test.ts`, `tests/integration/worker-http.test.ts`,
`tests/integration/contract.test.ts`.

## Maintainer-only (workflow files; the agent cannot push them)

- B9 — gate the Cloudflare deploy on CI: a `verify` job inside
  `deploy-cloudflare.yml` that the deploy `needs` (a `workflow_run` trigger would
  change the event the token broker sees). Diff in the PR body. `needs-human`
- B10 — daily live smoke (upstream and deployed API) that opens or updates an
  issue on failure. Diff in the PR body. `needs-human`

## Needs human

- B8 — rate limiting on the Worker (Cloudflare WAF rule or rate-limit binding). `needs-human`
