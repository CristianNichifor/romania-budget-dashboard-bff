# AGENTS.md

Convenții pentru `romania-budget-dashboard-bff` (aliniate cu hack-for-facts-eb-server).

## Comenzi

- `pnpm dev` — tsx watch (necesită `.env`)
- `pnpm check` — typecheck + lint + test + format:check
- `pnpm test` — vitest (unit core + integration via `app.inject`)
- `pnpm smoke:live` — smoke test împotriva API-ului public transparenta.eu
- `pnpm worker:dev` — Cloudflare Worker local (Hono, aceleași surse; port 8787)
- `pnpm worker:deploy` — deploy Worker pe Cloudflare (https://api.buget.cristian-nichifor.com)
- Deploy: `cp .env.example .env && docker compose up -d --build` (stack BFF+frontend, sibling repo). CI publică imaginea pe GHCR la push pe `main`/tag-uri `v*`; smoke-ul live rulează săptămânal/manual.

## Reguli

1. **Functional Core / Imperative Shell**: `modules/*/core` = funcții pure (`decimal.js`, `neverthrow Result`, fără I/O, fără throw); `modules/*/shell` = adaptoare (route-uri Fastify, repo-uri de date, `worker/index.ts` Hono — aceleași surse, fără Fastify în bundle).
2. **No floats**: banii sunt `Decimal` în core și `string` în JSON. Serializare doar în shell (lei 2 zecimale, procente 4).
3. **Porturi peste implementări**: sursele de date implementează `*DataSource`; alege sursa prin `DATA_SOURCE` în config.
4. **TypeBox** pentru contractele HTTP; erorile mapate în coduri: 400/404/502/500.
5. **Conventional Commits** + Husky (lint-staged + commitlint).

## Convenții Fastify

- `response` schema declară TOATE codurile posibile (altfel `reply.code()` nu tipizează).
- Teste: `buildApp({ config })` + `app.inject()` — nu porni socket-ul în teste.

## Contribution workflow

- Read [CONTRIBUTING.md](CONTRIBUTING.md) for credential-free setup and exact checks.
- Target `dev`. Agents must never merge any PR (including `dev`) or deploy,
  even when their credentials could bypass GitHub rules. Maintainers review releases.
- CI exposes `verify`, requiring every correctness job to succeed. Publishing and
  deployment are separate; this document does not configure GitHub branch rules.
- Personal worktrees: `wt new <name> origin/dev`, under `<repo>/.worktrees/<name>`.
  Outside contributors without `wt` can use a separate clone and a feature branch.
- Keep Conventional Commits concise, imperative and lower case; do not bypass hooks.
- Preserve decimal strings at the HTTP boundary. Coordinate fixture changes with
  the companion repo; never refresh fixtures from production data.
- Edit source and checked-in fixtures; do not commit `dist/`, `coverage/`,
  `node_modules/`, `.env`, Playwright reports or Wrangler output.
