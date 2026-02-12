import { fetchLawData, searchLaws } from "./lawApi.js";
import { checkConsistency } from "./consistency.js";
import { ConsistencyOutput } from "./types.js";

type ToolContent = { type: string; text?: string; data?: unknown };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolContent[]>;

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  handler: ToolHandler;
};

const requireString = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Field ${field} is required`);
  }
  return value.trim();
};

const requireArrayOfStrings = (value: unknown, field: string) => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`Field ${field} must be an array of strings`);
  }
  return value as string[];
};

const fetchLaw: Tool = {
  name: "fetch_law",
  description: "Fetch a law by LawID and optional revision date",
  inputSchema: {
    type: "object",
    properties: {
      lawId: { type: "string" },
      revisionDate: { type: "string" },
    },
    required: ["lawId"],
  },
  handler: async (input) => {
    const lawId = requireString(input.lawId, "lawId");
    const revisionDate =
      typeof input.revisionDate === "string" ? input.revisionDate : undefined;
    const data = await fetchLawData(lawId, revisionDate);
    return [{ type: "json", data }];
  },
};

const search: Tool = {
  name: "search_laws",
  description: "Search laws by keyword",
  inputSchema: {
    type: "object",
    properties: {
      keyword: { type: "string" },
    },
    required: ["keyword"],
  },
  handler: async (input) => {
    const keyword = requireString(input.keyword, "keyword");
    const results = await searchLaws(keyword);
    return [{ type: "json", data: results }];
  },
};

const summarize: Tool = {
  name: "summarize_law",
  description: "Summarize a law or selected articles",
  inputSchema: {
    type: "object",
    properties: {
      lawId: { type: "string" },
      articles: { type: "array", items: { type: "string" } },
    },
    required: ["lawId"],
  },
  handler: async (input) => {
    const lawId = requireString(input.lawId, "lawId");
    const articlesFilter = Array.isArray(input.articles)
      ? requireArrayOfStrings(input.articles, "articles")
      : undefined;
    const data = await fetchLawData(lawId);
    const articles = Array.isArray(data.LawBody?.MainProvision?.Article)
      ? data.LawBody?.MainProvision?.Article
      : data.LawBody?.MainProvision?.Article
        ? [data.LawBody.MainProvision.Article]
        : [];
    const filtered = articlesFilter
      ? articles.filter(
          (article) =>
            article.ArticleNumber &&
            articlesFilter.includes(article.ArticleNumber)
        )
      : articles;
    const body = filtered
      .map((article) =>
        `${article.ArticleNumber || ""} ${article.ArticleTitle || ""}`.trim()
      )
      .slice(0, 10)
      .join("\n");
    return [{ type: "text", text: body || "No articles available" }];
  },
};

const listRevisions: Tool = {
  name: "list_revisions",
  description: "List known revisions for a law if provided by the API",
  inputSchema: {
    type: "object",
    properties: {
      lawId: { type: "string" },
    },
    required: ["lawId"],
  },
  handler: async (input) => {
    const lawId = requireString(input.lawId, "lawId");
    const data = await fetchLawData(lawId);
    const revisions = Array.isArray((data as Record<string, unknown>).revisions)
      ? ((data as Record<string, unknown>).revisions as string[])
      : [];
    return [{ type: "json", data: { lawId, revisions } }];
  },
};

const check: Tool = {
  name: "check_consistency",
  description: "Check a document against one or more laws",
  inputSchema: {
    type: "object",
    properties: {
      documentText: { type: "string" },
      lawIds: { type: "array", items: { type: "string" } },
      articleHints: { type: "array", items: { type: "string" } },
      strictness: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["documentText"],
  },
  handler: async (input) => {
    const documentText = requireString(input.documentText, "documentText");
    const lawIds = Array.isArray(input.lawIds)
      ? requireArrayOfStrings(input.lawIds, "lawIds")
      : [];
    if (!lawIds.length) {
      throw new Error("At least one lawId is required for consistency checks");
    }
    const laws = await Promise.all(lawIds.map((lawId) => fetchLawData(lawId)));
    const output: ConsistencyOutput = checkConsistency(documentText, laws);
    return [{ type: "json", data: output }];
  },
};

export const tools: Tool[] = [
  fetchLaw,
  search,
  listRevisions,
  check,
  summarize,
];

export const resolveTool = (name: string) =>
  tools.find((tool) => tool.name === name);
