export type LawArticleParagraph = {
  ParagraphTitle?: string;
  ParagraphSentence?: string | string[];
};

export type LawArticle = {
  ArticleNumber?: string;
  ArticleTitle?: string;
  Paragraph?: LawArticleParagraph | LawArticleParagraph[];
};

export type LawBody = {
  MainProvision?: {
    Article?: LawArticle | LawArticle[];
  };
};

export type LawData = {
  LawID: string;
  LawName?: string;
  LawBody?: LawBody;
  ApplProvision?: unknown;
  SupplProvision?: unknown;
};

export type LawSearchItem = {
  LawID: string;
  LawName?: string;
  PromulgationDate?: string;
};

export type LawSearchResponse = {
  numberOfHits?: number;
  referencelaw?: LawSearchItem | LawSearchItem[];
};

export type ToolResult = {
  contentType: string;
  data: unknown;
};

export type ConsistencyFinding = {
  segment: string;
  status: "aligned" | "potential_mismatch" | "not_found";
  lawId?: string;
  articleNumber?: string;
  lawSnippet?: string;
  score?: number;
};

export type ConsistencyOutput = {
  findings: ConsistencyFinding[];
  matchedLawIds: string[];
};
