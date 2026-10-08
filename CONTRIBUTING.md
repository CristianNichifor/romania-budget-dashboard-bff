# Contributing

Branch from `origin/dev` and open a PR to `dev`. Agents must never merge PRs or
deploy, even with administrator credentials. Production `main`, image publishing,
Cloudflare credentials and releases belong to maintainers.

## Local setup (no credentials)

Use Node 24 (`.nvmrc`) and pnpm `12.3.4` as pinned in `package.json`. Install public
packages without a private handbook, 1Password or deployment credentials. If your
personal npm config requires a token, use
`npm_config_userconfig=/dev/null pnpm install --frozen-lockfile`.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

The example selects `DATA_SOURCE=static` and `DATA_SOURCE_INS=static`. Salary,
budget, INS and investment endpoints work with local demo data. These switches
are scoped: macro, context, adopted budgets, state companies and other live
modules still call public upstreams when requested. They need no credentials but
are not offline fixtures. For a completely offline frontend use its
`VITE_DATA_MODE=static` setup. To inspect this BFF, use `VITE_DATA_MODE=remote` and
`VITE_API_BASE_URL=http://localhost:3000` in the frontend.

For example, `curl 'http://localhost:3000/api/salary/calculate?gross=9427.13'`
returns decimal strings without fetching any upstream data. Do not run
`pnpm smoke:live` during routine contribution checks; it is an explicit network
smoke test, scheduled separately from PR correctness checks.

Personal worktrees: `wt new <name> origin/dev` inside the repo creates
`<repo>/.worktrees/<name>`. Without `wt`, use a separate clone, fetch `origin`, and
`git switch -c <name> origin/dev`.

## Validation

```sh
pnpm check
pnpm build
cp .env.example .env
docker compose config --quiet
```

CI also builds the Docker image. The stable `verify` status requires the existing
`check & build` and `docker build` jobs to succeed. Failure, cancellation or skip
fails the aggregate. Publishing, deployment and scheduled live smoke are excluded.
`pnpm check` includes TypeScript, ESLint, Vitest and Prettier, including
`AGENTS.md`; format changed files before committing. No private service is needed.

## HTTP contract fixtures

`tests/integration/contract.test.ts` calls real Fastify `app.inject` and Hono
Worker handlers, with upstream fetch disabled. Both must exactly match
`tests/fixtures/api-contract.json`, including monetary strings, salary precision
(two decimals), percentage precision (four decimals), and error codes. The
frontend consumes the same fixture through its actual client functions.

When intentionally changing the contract:

```sh
node --import tsx scripts/export-contract-fixtures.ts
pnpm exec prettier --write tests/fixtures/api-contract.json
pnpm test
```

The generator uses static data and refuses network access. Review its diff, copy
the JSON to `romania-budget-dashboard/tests/fixtures/api-contract.json`, run that
repo's checks and link the paired PR. Do not hand-wave schema compatibility or
refresh fixtures from production. Monetary strings must never pass through
JavaScript numbers. Preserve the Functional Core / Imperative Shell split:
`src/modules/*/core` is pure; route serializers and repositories are in `shell`.
Keep Fastify response schemas and Worker serialization aligned. Edit source,
not generated `dist/`, coverage, Wrangler bundles or installed dependencies.

Issues should describe the endpoint/source, reproduction, expected behavior and
acceptance criteria. PRs should state the root cause, validation commands/results,
contract changes and remaining limitations. Check existing work for overlap.
Use focused Conventional Commits and preserve Husky hooks.
