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

## MCP Capabilities (planned tools)

- `fetch_law` – Input: `lawId` (string), optional `revisionDate`. Output: normalized law JSON plus source URL.
- `search_laws` – Input: `keyword` (string), optional `lawType` filter. Output: list of LawID, title, promulgation date, and API URL.
- `list_revisions` – Input: `lawId`. Output: known revision dates/IDs when the API supplies them.
- `check_consistency` – Input: `documentText`, optional `lawIds`, optional `articleHints`, `strictness` (low/medium/high). Output: matched citations, conflicting passages, and a traceable reasoning summary.
- `summarize_law` – Input: `lawId`, optional `articles` list. Output: concise bullet summary suitable for grounding model responses.

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
- Configure via environment variables in `.env` (see Configuration section). The server registers tools `fetch_law`, `search_laws`, `list_revisions`, `check_consistency`, and `summarize_law`.
- Quality: `npm run lint` (ESLint) / `npm run format` (Prettier).

## Usage Examples (conceptual)

- Search and fetch: “Search for 個人情報保護 and show the latest articles.” → calls `search_laws` then `fetch_law`.
- Consistency check: “Check this draft against 労働基準法 Articles 24 and 37; highlight mismatches.” → calls `check_consistency` with `lawIds=[...]` and article hints.

## Validation Plan (to implement)

- Unit tests for citation parsing, article alignment scoring, and API response normalization.
- Integration tests mocking the 法令API to cover success, 404, 429/503 retry, and malformed LawID cases.
- Integration test runner: `npm run test` (uses undici MockAgent; no network).
- Manual smoke: run MCP client (e.g., Claude Desktop) to issue `search_laws` and `check_consistency` commands.

---

This specification is the starting point; refine it as implementation details solidify while keeping parity with the official 法令API Version 2 documentation.
