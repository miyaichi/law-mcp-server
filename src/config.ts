export type AppConfig = {
  apiBase: string;
  httpTimeoutMs: number;
  cacheTtlSeconds: number;
  userAgent: string;
};

const toNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config: AppConfig = {
  apiBase:
    process.env.LAW_API_BASE?.trim() || "https://laws.e-gov.go.jp/api/2/",
  httpTimeoutMs: toNumber(process.env.HTTP_TIMEOUT_MS, 15000),
  cacheTtlSeconds: toNumber(process.env.CACHE_TTL_SECONDS, 900),
  userAgent: "law-mcp-server/0.1.0",
};
