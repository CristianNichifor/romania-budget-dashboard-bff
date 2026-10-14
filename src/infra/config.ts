export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  logLevel: string;
  corsOrigin: string;
  dataSource: "static" | "hackforfacts";
  hackForFactsBaseUrl: string;
  hackForFactsTimeoutMs: number;
  /** Optional override; unset means the latest complete budget year. */
  hackForFactsYear: string | undefined;
  insDataSource: "static" | "insloader" | "eurostat";
  insLoaderBaseUrl: string;
  insLoaderTimeoutMs: number;
  soeBaseUrl: string;
  soeTimeoutMs: number;
  macroTimeoutMs: number;
  ckanBaseUrl: string;
  ckanTimeoutMs: number;
}

const DEFAULT_PORT = 3000;

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const port = Number(env.PORT ?? DEFAULT_PORT);

  if (Number.isNaN(port)) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  return {
    nodeEnv: env.NODE_ENV ?? "development",
    port,
    host: env.HOST ?? "127.0.0.1",
    logLevel: env.LOG_LEVEL ?? "info",
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:5173",
    dataSource: env.DATA_SOURCE === "hackforfacts" ? "hackforfacts" : "static",
    hackForFactsBaseUrl:
      env.HACK_FOR_FACTS_BASE_URL ?? "https://api.transparenta.eu",
    hackForFactsTimeoutMs: Number(env.HACK_FOR_FACTS_TIMEOUT_MS ?? 20000),
    hackForFactsYear:
      env.HACK_FOR_FACTS_YEAR === undefined || env.HACK_FOR_FACTS_YEAR === ""
        ? undefined
        : env.HACK_FOR_FACTS_YEAR,
    insDataSource:
      env.DATA_SOURCE_INS === "insloader"
        ? "insloader"
        : env.DATA_SOURCE_INS === "eurostat"
          ? "eurostat"
          : "static",
    insLoaderBaseUrl: env.INS_LOADER_BASE_URL ?? "http://localhost:3002",
    insLoaderTimeoutMs: Number(env.INS_LOADER_TIMEOUT_MS ?? 3000),
    soeBaseUrl: env.SOE_BASE_URL ?? "https://companiidestat.ro",
    soeTimeoutMs: Number(env.SOE_TIMEOUT_MS ?? 15000),
    macroTimeoutMs: Number(env.MACRO_TIMEOUT_MS ?? 15000),
    ckanBaseUrl: env.CKAN_BASE_URL ?? "https://data.gov.ro",
    ckanTimeoutMs: Number(env.CKAN_TIMEOUT_MS ?? 20000),
  };
}
