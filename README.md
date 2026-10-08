# romania-budget-dashboard-bff

Contributor setup and checks: [CONTRIBUTING.md](CONTRIBUTING.md).

Backend-for-frontend pentru [romania-budget-dashboard](https://github.com/CristianNichifor/romania-budget-dashboard): agreghează datele bugetare (Open Budget 2026 / hack-for-facts-eb-server) cu context INS și Eurostat/BCE, într-un contract tipizat consumat de frontend.

> **Status: P36.** Sursa implicită este `static` (seed-uri demo). Sursa `hackforfacts` servește datele live din API-ul public transparenta.eu (`https://api.transparenta.eu/graphql`) — vezi „Surse de date”. Module live: buget adoptat (MFP/data.gov.ro), macro extins (Eurostat/BCE), wages (context, estimare lunară, salariu real), context (trend sănătate COFOG), society, INS (Eurostat), energy și labour. Fiecare răspuns include `sourceUpdated` (data ultimei revizii Eurostat).

## Tech stack

Aliniat cu `hack-for-facts-eb-server` / `transparenta-eu-ins-loader`:

- **Fastify 5** (schema validation TypeBox, CORS, rate-limit)
- **TypeScript ESM strict**, Node ≥ 20.19, pnpm
- **neverthrow** — core-ul întoarce `Result<T, AppError>`, nu aruncă
- **decimal.js** — regula „no floats”: sumele trec granița API ca `string`
- **pino** logging
- Quality gates: ESLint (import-x) + Prettier + Husky + lint-staged + commitlint

## Endpoints

| Metodă | Path                                       | Descriere                                                                                    |
| ------ | ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| GET    | `/health/live`, `/health/ready`            | Probe                                                                                        |
| GET    | `/api/salary/calculate?gross=9427`         | Calcul povară fiscală (CAS/CASS/impozit/CAM/TVA)                                             |
| GET    | `/api/budget/summary`                      | Venituri / cheltuieli / deficit                                                              |
| GET    | `/api/budget/destinations`                 | Destinații cu sub-destinații (drill-down)                                                    |
| GET    | `/api/budget/institutions?category=pensii` | Detaliu categorie                                                                            |
| GET    | `/api/context/trends?metric=health-budget` | Cheltuieli publice pentru sănătate, mil. EUR (Eurostat COFOG, live)                          |
| GET    | `/api/ins/metrics?code=infant-mortality`   | Indicatori sociali (mortalitate infantilă, speranța de viață, paturi, beneficiari de pensii) |
| GET    | `/api/ins/catalog`                         | Catalogul indicatorilor sociali disponibili (P7)                                             |
| GET    | `/api/investments/by-county`               | Investiții publice pe județe (estimare 2026, marcată `estimated`)                            |
| GET    | `/api/soe/summary`                         | Companii de stat: statistici, topuri, emblematice                                            |
| GET    | `/api/soe/sector-trend`                    | Ponderea companiilor pe pierdere, 6 sectoare × 2019–2024                                     |
| GET    | `/api/soe/by-county`                       | Companii de stat pe județe (CA, profit, pierderi)                                            |
| GET    | `/api/soe/scatter`                         | Salariu vs. marjă netă per companie                                                          |
| GET    | `/api/soe/companies/:cui`                  | Fișa unei companii (finanțe, salarii, MFin, subvenții)                                       |
| GET    | `/api/soe/subsidies?year=2024\|2025`       | Subvenții locale către companiile de stat                                                    |
| GET    | `/api/soe/listed`                          | Companiile de stat listate la BVB                                                            |
| GET    | `/api/macro/inflation`                     | Inflația anuală IAPC (Eurostat) + ținta BNR                                                  |
| GET    | `/api/macro/unemployment`                  | Rata șomajului BIM, ajustată sezonier (Eurostat)                                             |
| GET    | `/api/macro/fx`                            | Cursul EUR/RON zilnic (BCE)                                                                  |
| GET    | `/api/macro/deficit`                       | Deficitul trimestrial % PIB (Eurostat GFS, `gov_10q_ggnfa`)                                  |
| GET    | `/api/macro/employment`                    | Rata de ocupare 20–64, ajustată sezonier (Eurostat)                                          |
| GET    | `/api/macro/current-account`               | Contul curent trimestrial, mil. EUR (Eurostat BPM6)                                          |
| GET    | `/api/macro/rates`                         | Dobânda BCE la facilitatea de depozit (punctele de schimbare)                                |
| GET    | `/api/macro/gdp-regions`                   | PIB pe locuitor pe cele 8 regiuni de dezvoltare (indice UE27=100)                            |
| GET    | `/api/budget/adopted?year=2024`            | Buget adoptat (legea bugetului, MFP via data.gov.ro): BS + BASS + BSAN + BSOM                |
| GET    | `/api/budget/comparison?years=2020,…,2025` | Adoptat vs. execuție pe ani, cu delta deficitului                                            |
| GET    | `/api/wages/context`                       | Context salarial: indicele costului muncii (LCI) + ancore SES (la 4 ani)                     |
| GET    | `/api/wages/monthly`                       | Salariul mediu brut lunar (estimare): nivel SES ajustat cu LCI, marcat ca estimat            |
| GET    | `/api/wages/real`                          | Salariul real: câștigul estimat deflatat cu indicele HICP (2015=100)                         |
| GET    | `/api/society/population`                  | Populația rezidentă anuală (Eurostat)                                                        |
| GET    | `/api/society/spending`                    | Cheltuieli publice sănătate/educație, % PIB (COFOG)                                          |
| GET    | `/api/society/education`                   | Părăsirea timpurie a școlii + studii terțiare (Eurostat)                                     |
| GET    | `/api/society/health`                      | Medici practicanți (număr, Eurostat)                                                         |
| GET    | `/api/society/demographics`                | Vârsta mediană + migrația netă (Eurostat)                                                    |
| GET    | `/api/energy/context`                      | Preț electricitate gospodării, energie regenerabilă, dependență de import                    |
| GET    | `/api/labour/context`                      | Rata NEET, șomajul tinerilor, rata locurilor vacante (Eurostat)                              |
| GET    | `/api/justice/context`                     | Omucideri intenționate, populație carcerală, efectiv polițiști (Eurostat)                    |

Coduri de eroare: `400 INVALID_INPUT`, `404 NOT_FOUND`, `502 UPSTREAM_UNAVAILABLE`, `500 INTERNAL`.

## Comenzi

```bash
pnpm install
cp .env.example .env
pnpm dev          # tsx watch, port 3000
pnpm check        # typecheck + lint + test + format:check
pnpm test         # unit (core) + integration (fastify inject)
pnpm build        # tsc + tsc-alias → dist/
pnpm start        # node dist/api.js
pnpm smoke:live                      # smoke test împotriva API-ului public transparenta.eu
```

## Arhitectura

Functional Core / Imperative Shell, ca în eb-server:

```
src/
├── api.ts                    # Entry point
├── app/build-app.ts          # Composition root (wiring)
├── common/                   # Tipuri + erori + seed-uri partajate
├── infra/                    # config, logger
└── modules/
    ├── salary/   core/ (types, ports, use-cases)  shell/ (route, repo)
    ├── budget/   core/ (types, ports)             shell/ (route, repos)
    ├── budget-adopted/ core/ (types, parser XML, comparație) shell/ (CKAN repo, route)
    ├── context/  core/ (types, ports)          shell/ (route, Eurostat repo)
    ├── wages/    core/ (types, ports, use-cases) shell/ (Eurostat repo, route)
    ├── society/  core/ (types, ports)             shell/ (Eurostat repo, route)
    ├── energy/   core/ (types, ports)             shell/ (Eurostat repo, route)
    ├── labour/   core/ (types, ports)             shell/ (Eurostat repo, route)
    ├── justice/  core/ (types, ports)             shell/ (Eurostat repo, route)
    └── macro/    core/ (types, parsers)           shell/ (Eurostat repo, route)
```

Reguli:

1. **Core-ul nu face I/O** — use-case-urile sunt pure (`decimal.js`, `Result`).
2. **Porturile** (`*DataSource`) separă sursele; `StaticBudgetSource` (demo) și `HackForFactsSource` (upstream) implementează același port.
3. **Banii sunt `string` la graniță**; serializarea (lei: 2 zecimale, procente: 4) se face doar în shell.

## Surse de date

| Sursă               | Status    | Note                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static` (implicit) | P2 ✓      | Seed-uri demo identice cu cele din frontend                                                                                                                                                                                                                                                                                                             |
| `hackforfacts`      | P8 ✓      | Client GraphQL cu mapare verificată pe schema upstream: `executionAnalytics` (sumar), `aggregatedLineItems` (destinații), `entityAnalytics` (instituții). Anul se setează prin `HACK_FOR_FACTS_YEAR`.                                                                                                                                                   |
| MFP / data.gov.ro   | P9 ✓      | Buget adoptat: CKAN `package_show` pe dataseturile „Bugetul de stat - {an}” (2014–2025), parcare tolerantă a XML-urilor anexa 1 (BS, BASS, BSAN, BSOM), cache 24h.                                                                                                                                                                                      |
| Eurostat / BCE      | P11/P12 ✓ | Macro extins: deficit trimestrial GFS, ocupare, cont curent, dobânda BCE. Module: `wages` (LCI + SES + salariu real), `society` (populație + COFOG), `context` (trend sănătate COFOG), `energy`, `labour` (NEET, șomaj tineri, locuri vacante) și `justice` (omucideri, penitenciar, polițiști) — aceleași tipare de cache, fiecare cu `sourceUpdated`. |
| INS / Eurostat      | P17 ✓     | Indicatori sociali live din Eurostat (`DATA_SOURCE_INS=eurostat`): mortalitate infantilă, speranța de viață, paturi de spital, beneficiari de pensii (`spr_pns_ben`). INS Tempo nu are API public curat — Eurostat e echivalentul onest. `static` rămâne fallback.                                                                                      |

### Date reale: API-ul public transparenta.eu

transparenta.eu rulează deja eb-server-ul public, fără autentificare: `https://api.transparenta.eu/graphql`. Nu e nevoie să hostezi nimic — setează `DATA_SOURCE=hackforfacts` (vezi `.env.example`) și BFF-ul servește datele live; frontend-ul păstrează fallback-ul static dacă API-ul nu răspunde. Verifică integrarea cu `pnpm smoke:live`.

Caveat-uri constatate pe instanța live:

- **Filtrele noastre trimit `report_type: PRINCIPAL_AGGREGATED`.** Fără el, upstream-ul însumează toate tipurile de raport stocate (principal + secundar + detaliat + angajamente) și fiecare leu apare de 2–3 ori (ex. cheltuieli 2024: 2,05 trn lei cu totul, 878 mld corect). Cu filtrul activ, deficitul %PIB 2024 iese 8,8% — față de 8,65% oficial.
- **Destinațiile live sunt agregate top-8 + „Alte destinații”** (`buildDestinations`): datasetul upstream are ~116 grupe funcționale, prea dense pentru un tablou lizibil; restul e pliat într-o singură destinație care se poate expanda prin drill-down.
- **Totalurile rămân „brute”, nu consolidate**: execuțiile la nivel de ordonator principal includ transferurile intra-bugetare, deci cheltuielile (~878 mld) și veniturile (~722 mld) ies peste execuția consolidată oficială (~752 / ~575 mld); deficitul și %PIB coincid fiindcă transferurile se anulează.
- Introspectarea GraphQL este dezactivată (maparea e verificată pe schema din repo + smoke test); unele valori ale enum-ului `ReportType` din repo dau eroare pe instanța live — live-ul pare în urma repo-ului.
- Latenta e de ordinul secundelor la prima cerere → `HACK_FOR_FACTS_TIMEOUT_MS` implicit 20000.
- Datele acoperă până la ~2024; nume fără diacritice în unele câmpuri.

## Companii de stat (companiidestat.ro)

Modulul `soe` servește datele despre companiile de stat din **API-ul public de date [companiidestat.ro](https://companiidestat.ro/date/)** (CC BY 4.0, JSON, fără cheie): statistici 2019–2024, scatter salariu × marjă, bilanțuri MFin, salarii, subvenții locale (2024–2025) și companiile listate la BVB. Endpoint-urile de mai sus expun contracte tipizate; snapshot-urile upstream sunt cache-uite în memorie (TTL 10 min). Config: `SOE_BASE_URL` / `SOE_TIMEOUT_MS` (vezi `.env.example`).

## Docker

Stack complet (BFF + frontend, frontend-ul e în repo-ul sibling):

```bash
cp .env.example .env
docker compose up -d --build   # http://localhost:8080
```

sau doar BFF-ul:

```bash
docker build -t romania-budget-dashboard-bff .
docker run -p 3000:3000 --env-file .env romania-budget-dashboard-bff
```

Imaginea de runtime conține doar dependențele de producție + `dist/` (entrypoint `node dist/api.js`).

CI: `.github/workflows/ci.yml` rulează `pnpm check` + build pe fiecare PR și publică imaginea pe GHCR la push pe `main`/tag-uri `v*`; `.github/workflows/smoke-live.yml` rulează `pnpm smoke:live` săptămânal/manual.

## Cloudflare Workers (deploy principal, gratis)

Același nucleu (surse, mapping, Decimal) rulează ca Worker pe Cloudflare — `worker/index.ts` (Hono) reutilizează modulele din `src/`, fără Fastify în bundle.

```bash
pnpm worker:dev      # local: http://localhost:8787
pnpm worker:deploy   # https://budget.cristian-nichifor.com/api/...
```

- API-ul răspunde la `https://budget.cristian-nichifor.com/api/...`, pe aceeași origine cu dashboard-ul: o rută Workers `budget.cristian-nichifor.com/api/*` în contul Cloudflare CN Webify Customers, legată de Terraform (`wrangler.toml` nu are `routes`). `/health/*` rămâne doar local/Docker.
- Config în `wrangler.toml`: `DATA_SOURCE` (`hackforfacts` live / `static` demo), URL-ul și timeout-urile upstream — editabile și din dashboard-ul Cloudflare.
- Free tier Workers: 100k invocări/zi (fiecare pagină face ~6 apeluri → ~16k pagini/zi).
- CI: `.github/workflows/deploy-worker.yml` — deploy la push pe `main` (necesită secretele `CLOUDFLARE_API_TOKEN` — token de cont Customers, _Workers Scripts Write_ — + `CLOUDFLARE_ACCOUNT_ID`).

## Git workflow

Conventional Commits; Husky rulează lint-staged + commitlint.
