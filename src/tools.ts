import { fetchLawData, searchLaws } from "./lawApi.js";
import { checkConsistency } from "./consistency.js";
import { ConsistencyOutput } from "./types.js";

export const usageInstructions = `Usage guidelines:\n\n- To find laws by Japanese name/keyword, call search_laws first. It returns canonical e-Gov LawID values (e.g., 個人情報保護法 -> H15HO57).\n- Always pass the canonical LawID to fetch_law and check_consistency (lawIds). Do not pass the Japanese title string.\n- fetch_law accepts optional revisionDate when you need a specific revision.\n- check_consistency requires at least one LawID in lawIds. Use search_laws to discover the IDs before calling.\n- summarize_law can take an optional articles array of article numbers to limit the summary.`;

type ToolContent = { type: "text"; text: string };
type ToolHandler = (input: Record<string, unknown>) => Promise<ToolContent[]>;

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
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
  description:
    "Fetch a law by canonical e-Gov LawID (e.g., H15HO57) and optional revision date. Use search_laws to look up the LawID first.",
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
    return [{ type: "text", text: JSON.stringify(data, null, 2) }];
  },
};

const search: Tool = {
  name: "search_laws",
  description:
    "Search laws by Japanese keyword/name and return canonical LawID values for use with other tools.",
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
    return [{ type: "text", text: JSON.stringify(results, null, 2) }];
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
    const toArray = <T>(v: T | T[] | undefined): T[] =>
      !v ? [] : Array.isArray(v) ? v : [v];
    const body = filtered
      .slice(0, 10)
      .map((article) => {
        const heading =
          `${article.ArticleNumber || ""} ${article.ArticleTitle || ""}`.trim();
        const paragraphs = toArray(article.Paragraph)
          .map((p) => {
            const sentences = toArray(
              (p as { ParagraphSentence?: string | string[] }).ParagraphSentence
            );
            return sentences.join("");
          })
          .filter(Boolean)
          .join("\n");
        return [heading, paragraphs].filter(Boolean).join("\n");
      })
      .join("\n\n");
    return [{ type: "text", text: body || "No articles available" }];
  },
};

const check: Tool = {
  name: "check_consistency",
  description:
    "Check a document against one or more laws (lawIds must be canonical LawIDs from search_laws).",
  inputSchema: {
    type: "object",
    properties: {
      documentText: { type: "string" },
      lawIds: { type: "array", items: { type: "string" } },
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
    return [{ type: "text", text: JSON.stringify(output, null, 2) }];
  },
};

export const tools: Tool[] = [fetchLaw, search, check, summarize];

export const resolveTool = (name: string) =>
  tools.find((tool) => tool.name === name);
