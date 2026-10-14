/** Data changes at most daily upstream: browsers keep it an hour, the edge six. */
export const CACHEABLE =
  "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400";
export const NO_STORE = "no-store";
