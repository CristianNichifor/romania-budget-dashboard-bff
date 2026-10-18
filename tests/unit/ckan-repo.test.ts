import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/infra/config";
import { CkanAdoptedSource } from "../../src/modules/budget-adopted/shell/ckan-repo";

const config = loadConfig({ NODE_ENV: "test" });
const annexUrl = "https://data.gov.ro/dataset/2025/anexa1_bs_2025.xml";

function mockResources(urls: string[]) {
  const fetchMock = vi.fn(async (..._args: unknown[]) => {
    if (fetchMock.mock.calls.length === 1) {
      return new Response(
        JSON.stringify({
          success: true,
          result: { resources: urls.map((url) => ({ url })) },
        })
      );
    }
    return new Response("<xml />");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CkanAdoptedSource resource URLs", () => {
  it("does not fetch untrusted metadata destinations", async () => {
    const fetchMock = mockResources([
      "http://127.0.0.1/anexa1_bs_2025.xml",
      "https://data.gov.ro.evil.test/anexa1_bs_2025.xml",
      "https://user:pass@data.gov.ro/anexa1_bs_2025.xml",
      "https://data.gov.ro/anexa1_bs_2025.xml?redirect=1",
    ]);

    await new CkanAdoptedSource(config).getAdopted("2025");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches same-origin HTTPS annexes without following redirects", async () => {
    const fetchMock = mockResources([
      "http://127.0.0.1/anexa1_bs_2025.xml",
      annexUrl,
    ]);

    await new CkanAdoptedSource(config).getAdopted("2025");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(annexUrl);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).redirect).toBe(
      "error"
    );
  });
});
