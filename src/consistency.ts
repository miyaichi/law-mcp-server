import {
  LawArticle,
  LawData,
  ConsistencyFinding,
  ConsistencyOutput,
} from "./types.js";

type FlattenedArticle = {
  lawId: string;
  articleNumber?: string;
  text: string;
};

const toArray = <T>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const paragraphText = (paragraph: unknown): string => {
  if (!paragraph || typeof paragraph !== "object") return "";
  const p = paragraph as { ParagraphSentence?: string | string[] };
  const sentences = toArray(p.ParagraphSentence);
  return sentences.join("\n");
};

const articleText = (article: LawArticle): string => {
  const paragraphs = toArray(article.Paragraph);
  const body = paragraphs.map(paragraphText).filter(Boolean).join("\n");
  const title = article.ArticleTitle || "";
  return [title, body].filter(Boolean).join("\n");
};

const flattenArticles = (law: LawData): FlattenedArticle[] => {
  const articles = toArray(law.LawBody?.MainProvision?.Article);
  return articles.map((article) => ({
    lawId: law.LawID,
    articleNumber: article.ArticleNumber,
    text: articleText(article),
  }));
};

const similarityScore = (a: string, b: string): number => {
  const tokenize = (value: string) =>
    value
      .replace(/[\s、。,．.\n\t]+/g, " ")
      .split(" ")
      .map((v) => v.trim())
      .filter(Boolean);
  const tokensA = tokenize(a.toLowerCase());
  const tokensB = tokenize(b.toLowerCase());
  if (!tokensA.length || !tokensB.length) return 0;
  const setB = new Set(tokensB);
  const intersection = tokensA.filter((token) => setB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
};

const extractArticleHint = (segment: string): string | undefined => {
  const match = segment.match(
    /第\s*([0-9０-９一二三四五六七八九十百千]+)\s*条/
  );
  return match ? match[1] : undefined;
};

const bestArticleMatch = (
  segment: string,
  articles: FlattenedArticle[]
): FlattenedArticle | undefined => {
  const hint = extractArticleHint(segment);
  if (hint) {
    const exact = articles.find(
      (a) => a.articleNumber && a.articleNumber.includes(hint)
    );
    if (exact) return exact;
  }
  let best: FlattenedArticle | undefined;
  let bestScore = 0;
  for (const article of articles) {
    const score = similarityScore(segment, article.text);
    if (score > bestScore) {
      best = article;
      bestScore = score;
    }
  }
  return best;
};

export const checkConsistency = (
  documentText: string,
  laws: LawData[]
): ConsistencyOutput => {
  const segments = documentText
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const flattened = laws
    .flatMap(flattenArticles)
    .filter((a) => a.text.trim().length > 0);

  const findings: ConsistencyFinding[] = segments.map((segment) => {
    const match = bestArticleMatch(segment, flattened);
    if (!match) {
      return { segment, status: "not_found" };
    }
    const score = similarityScore(segment, match.text);
    const status =
      score >= 0.6
        ? "aligned"
        : score >= 0.25
          ? "potential_mismatch"
          : "not_found";
    return {
      segment,
      status,
      lawId: match.lawId,
      articleNumber: match.articleNumber,
      lawSnippet: match.text.slice(0, 400),
      score: Number(score.toFixed(3)),
    };
  });

  const matchedLawIds = Array.from(
    new Set(findings.map((f) => f.lawId).filter(Boolean))
  ) as string[];

  return { findings, matchedLawIds };
};
