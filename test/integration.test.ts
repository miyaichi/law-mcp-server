import assert from "node:assert";
import { MockAgent, setGlobalDispatcher } from "undici";
import { fetchLawData, searchLaws } from "../src/lawApi.js";
import { checkConsistency } from "../src/consistency.js";

const mockAgent = new MockAgent();
mockAgent.disableNetConnect();
const mockPool = mockAgent.get("https://laws.e-gov.go.jp");

mockPool
  .intercept({ path: "/api/2/lawdata/TEST-LAW", method: "GET" })
  .reply(200, {
    LawID: "TEST-LAW",
    LawName: "テスト法",
    LawBody: {
      MainProvision: {
        Article: [
          {
            ArticleNumber: "第1条",
            ArticleTitle: "（目的）",
            Paragraph: {
              ParagraphSentence: "この法律はテスト目的のために存在する。",
            },
          },
          {
            ArticleNumber: "第2条",
            ArticleTitle: "（定義）",
            Paragraph: { ParagraphSentence: "用語の定義を定める。" },
          },
        ],
      },
    },
  });

mockPool
  .intercept({
    path: "/api/2/lawsearch",
    method: "GET",
    query: { keyword: "テスト" },
  })
  .reply(200, {
    numberOfHits: 1,
    referencelaw: {
      LawID: "TEST-LAW",
      LawName: "テスト法",
      PromulgationDate: "2024-01-01",
    },
  });

setGlobalDispatcher(mockAgent);

const run = async () => {
  // fetchLawData returns structured law
  const law = await fetchLawData("TEST-LAW");
  assert.strictEqual(law.LawID, "TEST-LAW");
  assert.ok(law.LawBody?.MainProvision?.Article);

  // searchLaws returns the mocked hit
  const search = await searchLaws("テスト");
  assert.strictEqual(search.numberOfHits, 1);

  // consistency check aligns a segment with 第1条
  const doc = "この法律はテスト目的のために存在する。";
  const result = checkConsistency(doc, [law]);
  assert.strictEqual(result.findings.length, 1);
  const finding = result.findings[0];
  assert.notStrictEqual(finding.status, "not_found");
  assert.strictEqual(finding.articleNumber, "第1条");

  console.log("integration tests passed");
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
