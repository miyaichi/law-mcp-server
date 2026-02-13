# Law MCP Server Specification

This repository will host an MCP server that uses **法令API Version 2** (e-Gov) to fetch statute data and help check the consistency between internal documents and the referenced laws. The document below captures the target capabilities and operational expectations before implementation.

## Overview

- Provide MCP tools that surface law data from the official API and perform document-to-law consistency checks.
- Enable knowledge workers to verify whether policy drafts, contracts, or memos align with authoritative legal text.
- Favor transparent outputs that include sources (LawID, article numbers, URLs) and the reasoning steps used during checks.

## External Data Source

- Base: `https://laws.e-gov.go.jp/api/2/`
- Common endpoints (see swagger for full schema):
  - `GET /lawdata/{LawID}` – fetch law structure and articles.
  - `GET /lawsearch/{keyword}` – search laws by keyword.
- Response format: JSON (includes meta, LawName, Articles, etc.). Respect official rate limits; treat 429/503 as retryable with backoff.

## MCP Capabilities

- `search_laws` – Input: `keyword` (string). Output: list of LawID, title, and promulgation date.
- `fetch_law` – Input: `lawId` (string), optional `revisionDate`. Output: normalized law JSON.
- `check_consistency` – Input: `documentText`, `lawIds` (required). Output: matched citations, conflicting passages, and similarity scores.
- `summarize_law` – Input: `lawId`, optional `articles` list. Output: concise article summary with paragraph text.

## Consistency Check Workflow

- Normalize the incoming document (segment by sentence/section, detect cited articles like “第○条”).
- Resolve target laws: use `lawIds` provided or run `search_laws` to suggest candidates.
- Fetch required law texts via `fetch_law`; cache responses per `LawID` to reduce API load.
- Align document segments to law articles using string similarity and citation hints; note exact article numbers when present.
- Produce findings: for each segment, mark status (`aligned`, `potential_mismatch`, `not_found`), include article references, and show snippets from both sides.
- Provide remediation suggestions (e.g., cite correct article, adjust wording) without altering the source document automatically.

## Server Behavior & Error Handling

- Map API errors to MCP-friendly errors with actionable messages (e.g., missing `LawID`, upstream 429, malformed parameters).
- Use exponential backoff on 429/503 and surface retry-after hints when present.
- Validate inputs early: reject empty `documentText`, overly long queries, or unsupported `lawId` formats with clear guidance.
- Log tool calls and upstream URLs for debugging; avoid storing document contents longer than the session.

## Configuration

- Environment variables (to be wired during implementation):
  - `LAW_API_BASE` (default `https://laws.e-gov.go.jp/api/2/`)
  - `HTTP_TIMEOUT_MS` (default 15000)
  - `CACHE_TTL_SECONDS` (default 900)
- Add `.env.example` later with the above keys; do not commit secrets.

## Implementation Notes

- Suggested stack: Node.js with a lightweight stdio JSON-RPC bridge for MCP compatibility, `undici`/`node-fetch` for HTTP, and a lightweight in-memory cache (Map/LRU). TypeScript preferred for schema safety using the Swagger spec.
- Define TypeScript types for API responses (LawData, Article, SearchResult) to enforce strict parsing.
- Keep business logic pure and testable (e.g., citation extraction, alignment scoring) independent of I/O.
- Expose a health endpoint or MCP tool (e.g., `ping`) for quick readiness checks.

## Getting Started

- Requirements: Node.js 18+.
- Install dependencies: `npm install`.
- Build: `npm run build`.
- Copy `.env.example` to `.env` and adjust if needed.
- Run server over stdio (JSON-RPC): `npm start` (or `npm run dev` for ts-node).
- Configure via environment variables in `.env` (see Configuration section). The server registers tools `search_laws`, `fetch_law`, `check_consistency`, and `summarize_law`.
- Quality: `npm run lint` (ESLint) / `npm run format` (Prettier).

### Claude Desktop configuration

- Install globally: `npm install -g law-mcp-server`.
- Add to your `claude_desktop_config.json`:

```
{
  "mcpServers": {
    "law-mcp-server": {
      "command": "law-mcp-server"
    }
  }
}
```

If you are installing from a local clone instead of the published
package, run `npm install && npm run build` and then `npm link` so the
`law-mcp-server` command is available on your `PATH` for Claude Desktop.

## Usage Examples (conceptual)

- Search and fetch: “Search for 個人情報保護 and show the latest articles.” → calls `search_laws` then `fetch_law`.
- Consistency check: "Check this draft against 労働基準法 Articles 24 and 37; highlight mismatches." → calls `search_laws` to get LawID, then `check_consistency` with `lawIds=[...]`.

## Skills

This repository includes domain-specific skills that demonstrate effective usage patterns for law-mcp-server tools. Skills provide comprehensive guides on how to leverage the server's capabilities for specific use cases.

### Available Skills

#### Digital Marketing Law Skill (`skills/digital-marketing-law/`)

A comprehensive guide for using law-mcp-server to reference and verify compliance with laws related to digital marketing activities in Japan. This skill covers:

- **Display Regulations**: Misleading Representation Prevention Act (景品表示法), Specified Commercial Transactions Act (特商法), Consumer Contract Act
- **Personal Information & Tracking**: Personal Information Protection Act (個人情報保護法), Telecommunications Business Act (電気通信事業法), Specified Electronic Mail Act
- **Platform Regulations**: Digital Platform Transparency Act, Provider Liability Act
- **Industry-Specific Laws**: Pharmaceutical Affairs Act (薬機法), Financial Instruments and Exchange Act (金商法)
- **Intellectual Property**: Copyright Act, Trademark Act, Unfair Competition Prevention Act
- **Competition Law**: Antimonopoly Act (独占禁止法)

**Key Features**:

- Search patterns for formal names, abbreviations, and article numbers
- 5 practical workflows (privacy policy creation, ad review, email marketing, platform transactions, amendment tracking)
- Real-world use cases for JIAA/APTI activities, client proposals, and compliance checks
- Common Q&A (Cookie consent, influencer marketing, comparative advertising, AI-generated content, retargeting)

**Usage**:

1. Read the skill file: `skills/digital-marketing-law/digital-marketing-law-SKILL.md`
2. Reference the appropriate workflow for your task
3. Use the provided search keywords and tool sequences
4. Follow the best practices for law searches and consistency checks

### Using Skills with Claude

To enable Claude to use these skills effectively:

1. **With Claude Desktop**: Skills in this repository are automatically available when the law-mcp-server is configured
2. **With Claude API**: Include the skill content in your system prompts or as reference documentation
3. **Custom Integration**: Point Claude to the skills directory in your MCP server configuration

Skills enhance Claude's ability to:

- Choose the right tools for specific legal queries
- Use appropriate search keywords (formal names vs. abbreviations)
- Apply domain knowledge for effective law searches
- Structure multi-step legal compliance checks
- Provide context-aware recommendations

## Validation Plan (to implement)

- Unit tests for citation parsing, article alignment scoring, and API response normalization.
- Integration tests mocking the 法令API to cover success, 404, 429/503 retry, and malformed LawID cases.
- Integration test runner: `npm run test` (uses undici MockAgent; no network).
- Manual smoke: run MCP client (e.g., Claude Desktop) to issue `search_laws` and `check_consistency` commands.

---

This specification is the starting point; refine it as implementation details solidify while keeping parity with the official 法令API Version 2 documentation.
