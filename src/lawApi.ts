import { fetch } from "undici";
import { cache } from "./cache.js";
import { config } from "./config.js";
import { LawData, LawSearchResponse } from "./types.js";

class HttpError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`Request failed ${status}: ${body}`);
  }
}

const request = async <T>(url: string, context?: { lawId?: string }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);
  let res;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": config.userAgent,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404 && context?.lawId) {
      throw new Error(
        `Law not found for lawId "${context.lawId}". Use the official LawID (e.g., 平成十五年法律第五十七号 => H15HO57). Upstream: ${body}`
      );
    }
    throw new HttpError(res.status, body);
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
  const url = new URL(`law_data/${encodeURIComponent(lawId)}`, base);
  if (revisionDate) url.searchParams.set("revision", revisionDate);
  const data = await request<LawData>(url.toString(), { lawId });
  cache.set(cacheKey, data, config.cacheTtlSeconds);
  return data;
};

export const searchLaws = async (
  keyword: string
): Promise<LawSearchResponse> => {
  const cacheKey = `search:${keyword}`;
  const cached = cache.get(cacheKey) as LawSearchResponse | undefined;
  if (cached) return cached;

  const base = config.apiBase.endsWith("/")
    ? config.apiBase
    : `${config.apiBase}/`;
  const url = new URL(`keyword`, base);
  url.searchParams.set("keyword", keyword);

  try {
    const data = await request<LawSearchResponse>(url.toString());
    cache.set(cacheKey, data, config.cacheTtlSeconds);
    return data;
  } catch (error) {
    if (error instanceof HttpError) {
      throw new Error(
        `Law search failed for keyword "${keyword}". URL: ${url.toString()}, Status: ${error.status}, Body: ${error.body}. Ensure LAW_API_BASE is reachable and keyword is valid.`
      );
    }
    throw error;
  }
};
