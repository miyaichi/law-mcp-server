# 修正プラン（SSE対応・Cloud Runデプロイ）

## 目的
- Stdio ベースの MCP サーバーを維持しつつ、SSE 経由でも同一の JSON-RPC ハンドラを利用できるようにする。
- SSE/HTTP トランスポートに API Key 認証を追加して Cloud Run で安全に公開できる状態にする。
- main ブランチ更新時に Cloud Run へデプロイする GitHub Actions を用意し、README を最新化する。

## 対応方針
1. **トランスポート分離**: 既存のハンドラ登録・処理を共有化し、`StdioJsonRpcServer` に加えて `SSEJsonRpcServer` を実装。環境変数または CLI フラグで `TRANSPORT=stdio|sse` を選択できるようエントリポイントを修正。
2. **SSE エンドポイント**: `POST /messages`（クライアント→サーバー）と `GET /events`（SSE ストリーム）で JSON-RPC メッセージをやり取り。`event: message` でレスポンス/通知を返し、接続クリーンアップと簡易ハートビートを実装。
3. **API Key 認証**: SSE/HTTP 経由のみ認証を必須化（ヘッダー `Authorization: Bearer <API_KEY>` または `x-api-key`）。`API_KEY` 未設定なら起動時にエラー。stdio は認証不要のまま。
4. **Cloud Run 用設定**: `PORT` 環境変数に従って HTTP サーバーを起動。デフォルトで `min-instances=1`、`concurrency` を低め（例: 10）にする前提を README/ワークフローに反映。
5. **GitHub Actions**: `push` to `main` で Artifact Registry へビルド＆ Cloud Run デプロイ（Workload Identity Federation を前提）。`PROJECT_ID`/`REGION`/`SERVICE`/`IMAGE` を入力パラメータ化し、API Key は Secret Manager 連携または Cloud Run 環境変数で注入。
6. **README 更新**: トランスポート選択方法、SSE 利用例（curl）、必要な環境変数、Cloud Run デプロイ手順/前提を追記。

## 追加で確認したいこと
- Cloud Run で使用する Artifact Registry リポジトリ名（例: `asia-northeast1-docker.pkg.dev/<project>/law-mcp-server`）。
- API Key を Secret Manager から渡すか、GitHub Actions のシークレットから直接渡すかの運用方針。

## 補足（ユーザー回答反映）
- Artifact Registry リージョン: `asia-northeast1`。イメージ名は `asia-northeast1-docker.pkg.dev/<PROJECT_ID>/law-mcp-server/law-mcp-server` を想定（PROJECT_ID は新規作成予定の専用プロジェクト）。
- API Key 管理: GitHub Actions のシークレットを使用。.env は `.gitignore` 済みのままローカルのみで利用し、リポジトリには含めない。
