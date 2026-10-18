import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import type { AppError } from "../../../common/errors";
import { notFound, upstreamUnavailable } from "../../../common/errors";
import type { AppConfig } from "../../../infra/config";
import type { AdoptedBudgetDataSource } from "../core/ports";
import { buildAdoptedTotals, parseFundTotals } from "../core/parser";
import {
  FUND_IDS,
  type AdoptedFundTotals,
  type AdoptedTotals,
  type FundId,
} from "../core/types";

/**
 * Live adopted-budget source: the MFP "Bugetul de stat" datasets published
 * on data.gov.ro (CKAN). Each year's dataset carries four "anexa 1" XML
 * files (bugetul de stat + BASS + BSAN + BSOM). Dataset UUIDs are stable;
 * the map covers 2014–2025. Responses are cached in memory (TTL 24h) — the
 * adopted law never changes.
 */

const CKAN_TIMEOUT_FALLBACK_MS = 20000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const DATASETS: Record<number, string> = {
  2014: "33cace24-b4e3-43de-b0a0-35353ffcd720",
  2015: "8631a37c-8195-402b-88c0-06d15b162237",
  2016: "894fdc9c-77e4-4073-8294-2a2c19a65ca3",
  2017: "8350f854-63bb-48e0-8163-d0c27f5c817c",
  2018: "f6cefeee-4a4a-487f-8eca-b5271670eb43",
  2019: "fc78ddbe-0b9e-46ed-b84b-c55a387ee98e",
  2020: "c57200b4-87dd-4cb2-b0ce-2b85dcf7f15c",
  2021: "bb3711ce-0e6e-42e0-9118-5fcf132580bd",
  2022: "63b1c7f7-de0e-4a95-b2e5-8d8d2825a765",
  2023: "319133ad-fb42-4ed1-b866-6cdb4fb24f5a",
  2024: "4a309d6e-e1f0-400e-962c-0abf44c07d2a",
  2025: "e78cd672-b097-4bbc-8056-b4e3c0c20b22",
};

const FUND_URL_PATTERNS: Record<FundId, RegExp> = {
  bs: /\/anexa1_bs(\.xml|_\d{4}\.xml)$/i,
  bass: /\/anexa1_bass(\.xml|_\d{4}\.xml)$/i,
  bsan: /\/anexa1_bsan(\.xml|_\d{4}\.xml)$/i,
  bsom: /\/anexa1_bsom(aj)?(\.xml|_\d{4}\.xml)$/i,
};

const PackageShowSchema = z.object({
  success: z.boolean(),
  result: z.object({
    resources: z.array(
      z.object({
        url: z.string(),
        format: z.string().nullable().optional(),
        size: z.number().nullable().optional(),
      })
    ),
  }),
});

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface CkanResource {
  url: string;
  format: string;
}

export class CkanAdoptedSource implements AdoptedBudgetDataSource {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(config: AppConfig) {
    this.baseUrl = config.ckanBaseUrl;
    this.timeoutMs = config.ckanTimeoutMs || CKAN_TIMEOUT_FALLBACK_MS;
  }

  supportedYears(): number[] {
    return Object.keys(DATASETS)
      .map(Number)
      .sort((a, b) => a - b);
  }

  private async getCached<T>(
    key: string,
    loader: () => Promise<Result<T, AppError>>
  ): Promise<Result<T, AppError>> {
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return ok(cached.value);
    }
    const result = await loader();
    if (result.isOk()) {
      this.cache.set(key, {
        value: result.value,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
    }
    return result;
  }

  private async getResources(
    year: number
  ): Promise<Result<CkanResource[], AppError>> {
    const datasetId = DATASETS[year];
    if (datasetId === undefined) {
      return err(
        notFound(`no adopted-budget dataset on data.gov.ro for ${year}`)
      );
    }
    return this.getCached(`ckan-resources-${year}`, async () => {
      try {
        const response = await fetch(
          `${this.baseUrl}/api/3/action/package_show?id=${datasetId}`,
          {
            signal: AbortSignal.timeout(this.timeoutMs),
            headers: { Accept: "application/json" },
          }
        );
        if (!response.ok) {
          return err(
            upstreamUnavailable(`CKAN responded with ${response.status}`)
          );
        }
        const parsed = PackageShowSchema.safeParse(await response.json());
        if (!parsed.success) {
          return err(upstreamUnavailable("unexpected CKAN response shape"));
        }
        return ok(
          parsed.data.result.resources.map((resource) => ({
            url: resource.url,
            format: resource.format ?? "",
          }))
        );
      } catch {
        return err(upstreamUnavailable("could not reach data.gov.ro"));
      }
    });
  }

  private resolveFundUrl(
    resources: CkanResource[],
    fund: FundId
  ): string | null {
    const pattern = FUND_URL_PATTERNS[fund];
    const ckanOrigin = new URL(this.baseUrl).origin;
    for (const resource of resources) {
      try {
        const url = new URL(resource.url);
        if (
          url.protocol === "https:" &&
          url.origin === ckanOrigin &&
          url.username === "" &&
          url.password === "" &&
          url.search === "" &&
          url.hash === "" &&
          pattern.test(url.pathname)
        ) {
          return url.href;
        }
      } catch {
        // Ignore malformed resource URLs from CKAN metadata.
      }
    }
    return null;
  }

  private async getFundXml(
    url: string,
    year: number,
    fund: FundId
  ): Promise<Result<string, AppError>> {
    return this.getCached(`anexa-${fund}-${year}`, async () => {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { Accept: "application/xml,text/xml,*/*" },
          redirect: "error",
        });
        if (!response.ok) {
          return err(
            upstreamUnavailable(
              `anexa 1 ${fund} ${year}: HTTP ${response.status}`
            )
          );
        }
        return ok(await response.text());
      } catch {
        return err(upstreamUnavailable(`anexa 1 ${fund} ${year} unreachable`));
      }
    });
  }

  async getAdopted(year: string): Promise<Result<AdoptedTotals, AppError>> {
    if (!/^\d{4}$/.test(year)) {
      return err(notFound(`invalid adopted-budget year: ${year}`));
    }
    const numericYear = Number(year);
    if (DATASETS[numericYear] === undefined) {
      return err(
        notFound(`no adopted-budget dataset on data.gov.ro for ${year}`)
      );
    }

    const resources = await this.getResources(numericYear);
    if (resources.isErr()) {
      return err(resources.error);
    }

    const funds: (AdoptedFundTotals | null)[] = [];
    for (const fund of FUND_IDS) {
      const url = this.resolveFundUrl(resources.value, fund);
      if (url === null) {
        funds.push(null);
        continue;
      }
      const xml = await this.getFundXml(url, numericYear, fund);
      if (xml.isErr()) {
        return err(xml.error);
      }
      const parsed = parseFundTotals(xml.value, numericYear, fund);
      if (parsed.isErr()) {
        return err(parsed.error);
      }
      funds.push(parsed.value);
    }

    return buildAdoptedTotals(numericYear, funds);
  }
}
