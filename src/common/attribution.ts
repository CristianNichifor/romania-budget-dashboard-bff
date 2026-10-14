import type { AppConfig } from "../infra/config";

/**
 * Who published the data behind a response, and under which terms. Each
 * licence was read from the publisher's own terms page (see README,
 * "Atribuire"); `null` means the publisher states no licence.
 */
export interface Attribution {
  name: string;
  url: string;
  licence: string | null;
  licenceUrl: string | null;
}

export const ATTRIBUTION_SOURCES = {
  eurostat: {
    name: "Eurostat",
    url: "https://ec.europa.eu/eurostat",
    licence: "CC BY 4.0",
    licenceUrl: "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
  },
  ecb: {
    name: "European Central Bank",
    url: "https://data.ecb.europa.eu",
    licence: "ECB statistics usage policy",
    licenceUrl:
      "https://www.ecb.europa.eu/stats/ecb_statistics/governance_and_quality_framework/html/usage_policy.en.html",
  },
  bnr: {
    name: "Banca Națională a României",
    url: "https://www.bnr.ro",
    licence: "bnr.ro terms of use",
    licenceUrl: "https://www.bnr.ro/2281-termeni-si-conditii",
  },
  mfp: {
    name: "Ministerul Finanțelor (data.gov.ro)",
    url: "https://data.gov.ro",
    licence: "OGL-ROU-1.0",
    licenceUrl: "https://data.gov.ro/base/images/logoinst/OGL-ROU-1.0.pdf",
  },
  transparenta: {
    name: "transparenta.eu",
    url: "https://transparenta.eu",
    licence: null,
    licenceUrl: null,
  },
  companiidestat: {
    name: "companiidestat.ro",
    url: "https://companiidestat.ro",
    licence: "CC BY 4.0",
    licenceUrl: "https://companiidestat.ro/date/",
  },
  ins: {
    name: "Institutul Național de Statistică",
    url: "https://insse.ro",
    licence: null,
    licenceUrl: null,
  },
  seed: {
    name: "Demo data (romania-budget-dashboard-bff)",
    url: "https://github.com/CristianNichifor/romania-budget-dashboard-bff",
    licence: null,
    licenceUrl: null,
  },
} as const satisfies Record<string, Attribution>;

const S = ATTRIBUTION_SOURCES;

function budgetSource(config: AppConfig): Attribution {
  return config.dataSource === "hackforfacts" ? S.transparenta : S.seed;
}

function insSource(config: AppConfig): Attribution {
  if (config.insDataSource === "eurostat") {
    return S.eurostat;
  }
  return config.insDataSource === "insloader" ? S.ins : S.seed;
}

/** The publishers behind a route, in the order the response uses them. */
export function attributionFor(path: string, config: AppConfig): Attribution[] {
  if (path === "/api/budget/adopted") {
    return [S.mfp];
  }
  if (path === "/api/budget/comparison") {
    return [S.mfp, budgetSource(config)];
  }
  if (path.startsWith("/api/budget/")) {
    return [budgetSource(config)];
  }
  if (path.startsWith("/api/ins/")) {
    return [insSource(config)];
  }
  if (path.startsWith("/api/investments/")) {
    return [S.seed];
  }
  if (path.startsWith("/api/soe/")) {
    return [S.companiidestat];
  }
  if (path === "/api/macro/fx" || path === "/api/macro/rates") {
    return [S.ecb];
  }
  if (path === "/api/macro/inflation") {
    return [S.eurostat, S.bnr];
  }
  if (
    [
      "macro",
      "wages",
      "society",
      "energy",
      "labour",
      "justice",
      "context",
    ].some((module) => path.startsWith(`/api/${module}/`))
  ) {
    return [S.eurostat];
  }
  return [];
}

/** Adds `attribution` to a JSON object body; anything else passes through. */
export function withAttribution(
  body: unknown,
  sources: Attribution[]
): unknown {
  if (
    sources.length === 0 ||
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    "attribution" in body
  ) {
    return body;
  }
  return { ...body, attribution: sources };
}

/** JSON for the `X-Data-Attribution` header; headers carry ASCII only. */
export function attributionHeader(sources: Attribution[]): string {
  return JSON.stringify(sources).replace(
    /[^\x20-\x7e]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}
