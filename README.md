# Law MCP Server

このリポジトリは、**法令API Version 2**（e-Gov）を使用して法令データを取得し、内部ドキュメントと参照法令との整合性チェックを支援する MCP サーバーをホストします。

## 概要

- 公式 API から法令データを提供し、ドキュメントと法令の整合性チェックを行う MCP ツールを提供する。
- 政策草案・契約書・メモなどが権威ある法令テキストと整合しているかをナレッジワーカーが検証できるようにする。
- LawID・条番号・URL などの出典と、チェック時の推論ステップを含む透明性の高いアウトプットを重視する。

## 外部データソース

- ベース URL: `https://laws.e-gov.go.jp/api/2/`
- 主要エンドポイント（全スキーマは [swagger](https://laws.e-gov.go.jp/api/2/swagger-ui) 参照）:
  - `GET /law_data/{law_id_or_num_or_revision_id}` — 法令構造・条文を取得
  - `GET /keyword?keyword={keyword}` — キーワードで法令を検索
  - `GET /laws?law_title={title}` — タイトルで法令を検索
- レスポンス形式: JSON（meta・LawName・Articles 等を含む）。公式レート制限を遵守し、429/503 はバックオフを伴うリトライ対象とする。

## MCP ツール

- `search_laws` — 入力: `keyword`（文字列）。出力: LawID・タイトル・公布日のリスト。
- `fetch_law` — 入力: `lawId`（文字列）、オプション `revisionDate`。出力: 正規化された法令 JSON。
- `check_consistency` — 入力: `documentText`・`lawIds`（必須）。出力: 一致した引用・矛盾箇所・類似度スコア。
- `summarize_law` — 入力: `lawId`、オプション `articles` リスト。出力: 条文テキストを含む簡潔な要約。

## 整合性チェックのワークフロー

- 入力ドキュメントを正規化する（文・セクション単位で分割し、「第○条」のような引用条文を検出）。
- 対象法令の特定: 指定された `lawIds` を使用するか、`search_laws` で候補を提案する。
- `fetch_law` で必要な法令テキストを取得し、API 負荷軽減のため `LawID` 単位でレスポンスをキャッシュする。
- 文字列類似度と引用ヒントを使用してドキュメントのセグメントを法令条文に対応付け、条番号が明示されている場合は記録する。
- 調査結果の生成: 各セグメントについてステータス（`aligned`・`potential_mismatch`・`not_found`）を付与し、条文参照と双方のスニペットを含める。
- ソースドキュメントを自動変更せず、修正提案（正しい条文の引用・文言の調整など）を提示する。

## サーバー動作とエラー処理

- API エラーを実行可能なメッセージを持つ MCP フレンドリーなエラーにマッピングする（LawID 欠落・上流 429・不正なパラメータなど）。
- 429/503 は指数バックオフを使用し、Retry-After ヒントがある場合は通知する。
- 入力を早期バリデーション: 空の `documentText`・過度に長いクエリ・サポート外の `lawId` フォーマットを明確なガイダンスとともに拒否する。
- デバッグ用にツール呼び出しと上流 URL をログ出力し、セッションを超えたドキュメント内容の保存は避ける。

## 設定

- 環境変数:
  - `LAW_API_BASE`（デフォルト: `https://laws.e-gov.go.jp/api/2/`）
  - `HTTP_TIMEOUT_MS`（デフォルト: 15000）
  - `CACHE_TTL_SECONDS`（デフォルト: 900）
  - `TRANSPORT`（`stdio` | `sse` | `http`、デフォルト: `stdio`）
  - `PORT`（デフォルト: 3000。Cloud Run は `PORT=8080` を自動設定）
  - `API_KEY`（`TRANSPORT=sse` または `TRANSPORT=http` の場合に必須。stdio では不使用）
  - `ISSUER_URL`（OAuth / Claude.ai コネクタに必要。例: `https://law-mcp-server-xxx.run.app`）
  - `ALLOWED_ORIGIN`（HTTP/SSE トランスポート向けのオプション CORS 許可リスト）
- `.env` は `.gitignore` されているので、シークレットはコミットしないこと。

## 実装メモ

- 推奨スタック: MCP 互換のための軽量 stdio JSON-RPC ブリッジを持つ Node.js、HTTP には `undici`/`node-fetch`、軽量インメモリキャッシュ（Map/LRU）。スキーマ安全性のため TypeScript 推奨（Swagger 仕様を活用）。
- API レスポンス（LawData・Article・SearchResult）の TypeScript 型を定義し、厳格なパースを強制する。
- ビジネスロジック（引用抽出・整合スコアリングなど）は I/O に依存しない純粋でテスタブルな実装を維持する。
- 迅速な疎通確認のためにヘルスエンドポイントまたは MCP ツール（例: `ping`）を公開する。

## はじめに

- 要件: Node.js 18 以上。
- 依存関係インストール: `npm install`。
- ビルド: `npm run build`。
- `.env.example` を `.env` にコピーし、必要に応じて設定を調整する。
- stdio（JSON-RPC）でサーバーを起動: `npm start`（または ts-node の場合は `npm run dev`）。
- 設定は `.env` の環境変数で行う（設定セクションを参照）。サーバーは `search_laws`・`fetch_law`・`check_consistency`・`summarize_law` ツールを登録する。
- 品質管理: `npm run lint`（ESLint）/ `npm run format`（Prettier）。

## トランスポートモード

### stdio（ローカルデフォルト）

- `TRANSPORT=stdio`（デフォルト）。認証なしでローカル利用。
- `npm start` または `npm run dev` で起動。

### Streamable HTTP / http（Cloud Run 向け・推奨）

MCP 仕様 2025-06-18 準拠の Streamable HTTP トランスポート。Claude.ai のコネクタ登録に対応。

- `TRANSPORT=http` と `API_KEY` を設定し、`PORT` に Cloud Run のポート（通常 8080）を渡す。
- 認証: `Authorization: Bearer <API_KEY>` または `x-api-key: <API_KEY>`。
- エンドポイント:
  - `POST /mcp` — JSON-RPC リクエスト送信（メインエンドポイント）
  - `GET /mcp` — サーバー起点の SSE ストリーム（サーバー通知用）
  - `DELETE /mcp` — セッション終了
  - `GET /health` — ヘルスチェック
- セッション管理: `Mcp-Session-Id` レスポンスヘッダーで返却し、以降のリクエストでヘッダーに付与する。

動作確認例:
```bash
# 1. initialize（セッション作成）
curl -s -D - -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"test","version":"1.0"}}}' \
  https://<host>/mcp
# → Mcp-Session-Id: <session-id> がレスポンスヘッダーに返る

# 2. tools/list（セッションIDを使用）
curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  https://<host>/mcp
```

### Claude.ai コネクタ登録

Claude.ai の「コネクタ」機能から直接登録できます（`TRANSPORT=http` + `ISSUER_URL` 設定時）。

#### 初回デプロイ手順

1. Cloud Run に一度デプロイし、サービス URL（`https://law-mcp-server-xxx.run.app`）を確認。
2. GitHub Secrets に `ISSUER_URL` を追加（値: 確認したサービス URL）。
3. 再デプロイ（`ISSUER_URL` が環境変数に反映される）。

#### Claude.ai での登録手順

1. Claude.ai の設定 → **「コネクタ」** → **「カスタムコネクタを追加」**
2. MCP サーバー URL を入力: `https://<host>/mcp`
3. 「接続」をクリック → ブラウザが開き API キー入力画面が表示される
4. デプロイ時に設定した `API_KEY` を入力して「接続を許可」

> **「詳細設定」で OAuth Client ID / Secret を手動指定する場合**
> Dynamic Client Registration（DCR）を使わずに固定クレデンシャルを使いたい場合は、
> 事前に `POST /oauth/register` を呼び出してクライアントを登録し、
> 返却された `client_id` / `client_secret` を Claude.ai に入力してください。

### SSE（旧仕様・後方互換）

- `TRANSPORT=sse` で旧 SSE トランスポートを使用（Claude Desktop + mcp-remote 向け）。
- エンドポイント: `GET /events`（SSE ストリーム）、`POST /messages`（JSON-RPC リクエスト）。

### Claude Desktop 設定

- **ローカル（stdio トランスポート）**
  - グローバルインストール: `npm install -g law-mcp-server`。
  - `claude_desktop_config.json`:

  ```json
  {
    "mcpServers": {
      "law-mcp-server": {
        "command": "law-mcp-server"
      }
    }
  }
  ```

  公開パッケージではなくローカルクローンからインストールする場合は、`npm install && npm run build` を実行後、`npm link` で `law-mcp-server` コマンドを PATH に追加してから Claude Desktop で使用してください。

- **Cloud Run（Streamable HTTP トランスポート）**
  - Cloud Run が `TRANSPORT=http` と `API_KEY` を設定してデプロイされていることを確認する。
  - ローカルの stdio-to-HTTP ブリッジとして [mcp-remote](https://www.npmjs.com/package/mcp-remote) を使用する。
  - mcp-remote のインストール: `npm install -g mcp-remote`
  - `claude_desktop_config.json`:

  ```json
  {
    "mcpServers": {
      "law-mcp-server": {
        "command": "mcp-remote",
        "args": [
          "https://law-mcp-server-<hash>.asia-northeast1.run.app/mcp",
          "--header",
          "Authorization: Bearer <API_KEY>"
        ]
      }
    }
  }
  ```

  - `<hash>` を Cloud Run サービスのサフィックスに、`<API_KEY>` を Cloud Run に設定した同じキーに置き換えてください。

## 使用例（概念的）

- 検索・取得: 「個人情報保護を検索して最新の条文を表示して」→ `search_laws` を呼び出した後 `fetch_law` を呼び出す。
- 整合性チェック: 「この草案を労働基準法第24条・第37条と照合し、不一致箇所を強調表示して」→ `search_laws` で LawID を取得後、`lawIds=[...]` を指定して `check_consistency` を呼び出す。

## スキル

このリポジトリには、law-mcp-server ツールの効果的な使用パターンを示すドメイン固有のスキルが含まれています。スキルは、特定のユースケースに対してサーバーの機能を活用する方法の包括的なガイドを提供します。

### 利用可能なスキル

#### デジタルマーケティング法スキル（`skills/digital-marketing-law/`）

law-mcp-server を使用して日本のデジタルマーケティング活動に関連する法令を参照・コンプライアンス確認するための包括的なガイド。このスキルが対象とする法令:

- **表示規制**: 景品表示法・特定商取引法（特商法）・消費者契約法
- **個人情報・トラッキング**: 個人情報保護法・電気通信事業法・特定電子メール法
- **プラットフォーム規制**: デジタルプラットフォーム透明化法・プロバイダ責任法
- **業種別法律**: 薬機法・金融商品取引法（金商法）
- **知的財産**: 著作権法・商標法・不正競争防止法
- **競争法**: 独占禁止法

**主な機能**:

- 正式名称・略称・条番号による検索パターン
- 5つの実践的ワークフロー（プライバシーポリシー作成・広告審査・メールマーケティング・プラットフォーム取引・改正追跡）
- JIAA/APTI 活動・顧客提案・コンプライアンスチェックの実際のユースケース
- よくある Q&A（クッキー同意・インフルエンサーマーケティング・比較広告・AI 生成コンテンツ・リターゲティング）

**使い方**:

1. スキルファイルを読む: `skills/digital-marketing-law/digital-marketing-law-SKILL.md`
2. タスクに適したワークフローを参照する
3. 提供された検索キーワードとツールシーケンスを使用する
4. 法令検索と整合性チェックのベストプラクティスに従う

### Claude でスキルを使う

Claude がこれらのスキルを効果的に使用できるようにするには:

1. **Claude Desktop の場合**: law-mcp-server が設定されていれば、このリポジトリのスキルが自動的に利用可能になる
2. **Claude API の場合**: システムプロンプトや参考ドキュメントとしてスキルのコンテンツを含める
3. **カスタム統合**: MCP サーバー設定でスキルディレクトリを指定する

スキルによって Claude の能力が向上する:

- 特定の法律クエリに適したツールの選択
- 適切な検索キーワードの使用（正式名称 vs. 略称）
- 効果的な法令検索のためのドメイン知識の適用
- 多段階の法令コンプライアンスチェックの構造化
- コンテキストを考慮した推奨事項の提供

## Cloud Run デプロイ

- コンテナイメージは `Dockerfile` でビルド（デフォルト: `TRANSPORT=sse`、`PORT=8080`）。
- GitHub Actions ワークフロー: `.github/workflows/deploy.yml` が `main` への `push` でデプロイ。
- 必要な GitHub Secrets: `GCP_PROJECT_ID`・`GCP_WORKLOAD_IDENTITY_PROVIDER`・`GCP_SERVICE_ACCOUNT`・`API_KEY`（HTTP 認証キーとして使用）。
- Artifact Registry ターゲット: `asia-northeast1-docker.pkg.dev/<PROJECT_ID>/law-mcp-server/law-mcp-server`（PROJECT_ID は専用プロジェクト）。
- ワークフローの Cloud Run 設定: `min-instances=1`・`concurrency=10`、環境変数 `TRANSPORT=sse`・`API_KEY`（`PORT` は Cloud Run が自動設定）。
- `.env` は git で無視されるため、シークレットはローカルに保管してコミットしないこと。

## 検証計画（実装予定）

- 引用パース・条文整合スコアリング・API レスポンス正規化のユニットテスト。
- 成功・404・429/503 リトライ・不正な LawID のケースをカバーするため、法令 API をモックした統合テスト。
- 統合テストランナー: `npm run test`（undici MockAgent 使用、ネットワーク不要）。
- 手動スモークテスト: MCP クライアント（例: Claude Desktop）で `search_laws` と `check_consistency` コマンドを実行。

## ライセンス

- MIT License