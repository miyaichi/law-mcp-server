import { fetch } from "undici";
import { cache } from "./cache.js";
import { config } from "./config.js";
import { LawData, LawSearchResponse } from "./types.js";

const withTimeout = async <T>(promise: Promise<T>, ms: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
  }
};

const request = async <T>(url: string, context?: { lawId?: string }) => {
  const res = await withTimeout(
    fetch(url, {
      headers: {
        "User-Agent": config.userAgent,
        Accept: "application/json",
      },
    }),
    config.httpTimeoutMs
  );

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404 && context?.lawId) {
      throw new Error(
        `Law not found for lawId "${context.lawId}". Use the official LawID (e.g., 平成十五年法律第五十七号 => H15HO57). Upstream: ${body}`
      );
    }
    throw new Error(`Request failed ${res.status}: ${body}`);
  }

  const data = (await res.json()) as T;
  return data;
};

export const fetchLawData = async (
  lawId: string,
  revisionDate?: string
): Promise<LawData> => {
  const cacheKey = `law:${lawId}:${revisionDate || "latest"}`;
  const cached = cache.get(cacheKey) as LawData | undefined;
  if (cached) return cached;

  const base = config.apiBase.endsWith("/")
    ? config.apiBase
    : `${config.apiBase}/`;
  const url = new URL(`lawdata/${encodeURIComponent(lawId)}`, base);
  if (revisionDate) url.searchParams.set("revision", revisionDate);
  const data = await request<LawData>(url.toString(), { lawId });
  cache.set(cacheKey, data, config.cacheTtlSeconds);
  return data;
};

export const searchLaws = async (
  keyword: string
): Promise<LawSearchResponse> => {
  const base = config.apiBase.endsWith("/")
    ? config.apiBase
    : `${config.apiBase}/`;
  const url = new URL(`lawsearch/${encodeURIComponent(keyword)}`, base);
  return request<LawSearchResponse>(url.toString());
};
