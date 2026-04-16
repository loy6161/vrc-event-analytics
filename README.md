# VRChat Event Analytics

VRChatイベントの参加ログを解析・可視化するフルスタック Webアプリケーション。
YouTube ライブ配信との連携、リアルタイムログ監視、CSV/XLSX エクスポートをサポートします。

## 機能一覧

| 機能 | 説明 |
|------|------|
| **ダッシュボード** | KPIカード・月次比較・最近のイベント一覧 |
| **イベント管理** | イベントの作成・編集・削除、ワールドID/タグ管理 |
| **ログ解析** | VRChatログからプレイヤーの入退場を自動解析 |
| **リアルタイム監視** | chokidar + SSE によるログディレクトリ自動監視 |
| **アナリティクス** | ピーク同時接続数・滞在時間分布・再入場率など |
| **YouTube連携** | Data API v3 でチャット・視聴者数を取得・グラフ化 |
| **エクスポート** | イベント/ユーザーデータを XLSX・CSV 出力 |
| **ユーザー管理** | 表示名履歴・スタッフ管理・タグ付け |
| **ランキング** | 参加回数・滞在時間ランキング |
| **設定** | API Key・ログディレクトリ設定（localStorage保存） |

## 技術スタック

### フロントエンド
- **React 18** + TypeScript — UI
- **Recharts** — グラフ描画
- **TanStack Table v8** — データテーブル
- **Vite 5** — 開発サーバー・ビルド

### バックエンド
- **Node.js v22** + **Express 4** — REST API
- **better-sqlite3** — SQLite（ネイティブバインディング必須）
- **googleapis** — YouTube Data API v3
- **chokidar 3** — ファイル監視
- **xlsx** — Excel エクスポート

## セットアップ

### 前提条件

- **Node.js v20+**（推奨: v22 LTS）
- **Visual Studio Build Tools 2022**
  - ワークロード: 「C++ によるデスクトップ開発」を選択
  - better-sqlite3 のコンパイルに必須

### インストール

```bash
# 依存パッケージをインストール
npm install

# better-sqlite3 のネイティブバインディングをコンパイル
npm rebuild better-sqlite3
```

### 開発サーバー起動

```bash
npm run dev
```

| サービス | URL |
|---------|-----|
| フロントエンド (Vite) | http://localhost:5173 |
| バックエンド API | http://localhost:3000 |

### 本番起動

```bash
# フロントエンドをビルド（型チェック込み）
npm run build:full

# サーバー起動（/api/* + 静的ファイルを単一ポートで配信）
npm start
# または PowerShell スクリプトを使用
.\start.ps1
.\start.ps1 -Port 8080
```

## 設定

Settings ページ（サイドバー `⚙️ Settings`）から設定します。設定は `localStorage` に保存されます。

| 設定項目 | 説明 |
|---------|------|
| **YouTube API Key** | Google Cloud Console で取得した YouTube Data API v3 キー |
| **Log Directory** | VRChat ログの保存先パス |

**VRChat ログのデフォルトパス（Windows）**
```
%AppData%\..\LocalLow\VRChat\VRChat
```

**YouTube API Key の取得**
1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「APIとサービス」→「ライブラリ」→ **YouTube Data API v3** を有効化
3. 「認証情報」→「APIキー」を作成

## API リファレンス

全エンドポイントは以下の JSON エンベロープ形式を返します。

```json
{ "success": true,  "data": <T>,        "timestamp": "2025-03-01T20:00:00.000Z" }
{ "success": false, "error": "message", "timestamp": "2025-03-01T20:00:00.000Z" }
```

### ヘルスチェック
```
GET /api/health
→ { status: "ok", dbAvailable: true, timestamp }
```

### イベント (`/api/events`)
```
GET    /                        全イベント一覧
POST   /                        イベント作成
GET    /:id                     イベント詳細
PUT    /:id                     イベント更新
DELETE /:id                     イベント削除（プレイヤーイベントもカスケード削除）
GET    /:id/player-events       プレイヤーイベント一覧
```

### ログ解析 (`/api/logs`)
```
GET  /directory                 デフォルトログディレクトリ
GET  /files                     ログファイル一覧
POST /parse                     ログファイルを解析してプレビュー
POST /import                    ログをDBに取り込む（重複チェック付き）
GET  /imported                  取り込み済みログ一覧
```

### アナリティクス (`/api/analytics`)
```
GET /events/:id                 イベント統計（ピーク・平均滞在時間・再入場率）
GET /events/:id/timeline        同時接続タイムライン（1分刻み）
GET /events/:id/hourly          時間帯別参加者数
GET /users/top-attendees        参加回数ランキング
GET /users/top-duration         滞在時間ランキング
GET /dashboard                  ダッシュボード用サマリー
```

### YouTube (`/api/youtube`)
```
POST   /init                            APIキー初期化
GET    /streams                         配信一覧（?eventId= でフィルタ）
POST   /streams                         配信登録（メタデータ自動取得）
GET    /streams/:id                     配信詳細
PUT    /streams/:id/refresh             メタデータ再取得
PUT    /streams/:id/link                イベントにリンク
DELETE /streams/:id                     配信削除（チャットデータもカスケード）
POST   /streams/:id/fetch-chat          全チャット取得・DB保存
GET    /streams/:id/chat-stats          チャット統計
GET    /streams/:id/chat-users          チャット参加者（?limit=N）
GET    /streams/:id/chat-messages       チャットメッセージ（?type=&limit=&offset=）
POST   /streams/:id/poll-viewers        同時視聴者数ポーリング（ライブ中のみ）
GET    /streams/:id/concurrent-log      視聴者数履歴ログ
```

### エクスポート (`/api/export`)
```
GET /events/:id/xlsx                    イベントデータ Excel（3シート）
GET /events/:id/csv/player-events       プレイヤーイベント CSV
GET /users/csv                          全ユーザー CSV
GET /youtube/streams/:id/xlsx           配信データ Excel（3シート）
GET /youtube/streams/:id/csv/chat-users チャット参加者 CSV
```

### ファイル監視 / SSE (`/api/watcher`)
```
GET  /status        監視状態取得
POST /start         監視開始（Body: { directory?: string }）
POST /stop          監視停止
GET  /events        SSE ストリーム接続（EventSource）
```

**SSE イベント形式**
```json
data: { "type": "file_added", "file": "output_log_2025-03-01.txt", "result": { ... } }
data: { "type": "heartbeat", "ts": "2025-03-01T20:00:00.000Z" }
```

## テスト

```bash
npm test
```

Node.js 組み込みテストランナー（`node:test`）を使用。better-sqlite3 ネイティブバインディングが利用できない場合、DB 依存テストは自動スキップされます。

```
tests 23 | pass 23 | fail 0 | skip 0
```

| テストスイート | テスト内容 |
|-------------|-----------|
| **Log Parser** | parseLine (7), parseLogFile, segmentIntoSessions, calculatePlayerStays |
| **Database Layer** | Events CRUD, Player Events, Users, Imported Logs（要 native bindings） |
| **Analytics Computation** | sweep-line peak, FIFO pairing, re-entry rate, hourly attendance |
| **YouTube Service** | extractVideoId (6), computeChatStats (3) |

## プロジェクト構造

```
event-analytics/
├── server/
│   ├── db/
│   │   ├── schema.ts            DBスキーマ定義・初期化・マイグレーション
│   │   ├── queries.ts           イベント/ユーザー/ログのCRUD
│   │   └── youtube-queries.ts   YouTube関連テーブルのCRUD
│   ├── routes/
│   │   ├── events.ts            イベントCRUD
│   │   ├── logs.ts              ログ解析・取り込み
│   │   ├── analytics.ts         統計計算エンドポイント
│   │   ├── users.ts             ユーザー管理
│   │   ├── youtube.ts           YouTube API連携
│   │   ├── export.ts            XLSX/CSVエクスポート
│   │   └── watcher.ts           ファイル監視 + SSE
│   ├── services/
│   │   ├── log-parser.ts        VRChatログ解析エンジン
│   │   ├── youtube.ts           YouTube Data API v3 ラッパー
│   │   └── watcher.ts           chokidar監視サービス・SSE配信
│   ├── utils/
│   │   └── response.ts          共通レスポンスヘルパー (ok / fail / toMessage)
│   └── index.ts                 Express サーバーエントリポイント
├── src/
│   ├── components/
│   │   ├── charts/
│   │   │   ├── ConcurrentTimelineChart.tsx
│   │   │   ├── HourlyAttendanceChart.tsx
│   │   │   ├── PeriodTrendChart.tsx
│   │   │   └── YouTubeChatTimeline.tsx
│   │   ├── Dashboard.tsx
│   │   ├── ErrorBoundary.tsx    Reactエラーバウンダリ
│   │   ├── EventAnalyticsPanel.tsx
│   │   ├── EventForm.tsx
│   │   ├── EventList.tsx
│   │   ├── Layout.tsx
│   │   ├── RankingPage.tsx
│   │   ├── ReportsPage.tsx
│   │   ├── Settings.tsx
│   │   ├── UserDetail.tsx
│   │   ├── UserTable.tsx
│   │   ├── WatcherStatus.tsx    ヘッダー監視ウィジェット
│   │   └── YouTubePage.tsx
│   ├── styles/                  コンポーネント対応CSS
│   ├── types/
│   │   └── index.ts             共通型定義
│   └── App.tsx                  ハッシュベースルーティング
├── tests/
│   ├── fixtures/
│   │   └── sample-log.txt       テスト用VRChatログ
│   └── integration.test.mjs     統合テストスイート
├── vite.config.ts               Vite設定（プロキシ・チャンク分割）
├── package.json
├── start.ps1                    Windows 本番起動スクリプト
└── README.md
```

## npm スクリプト

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動（Vite + Express、ホットリロード） |
| `npm run build` | フロントエンドをビルド（dist/） |
| `npm run build:full` | 型チェック + ビルド |
| `npm start` | 本番サーバー起動（NODE_ENV=production） |
| `npm run server` | Express サーバーのみ起動 |
| `npm run type-check` | TypeScript 型チェック |
| `npm test` | 統合テスト実行 |

## トラブルシューティング

### `Could not locate the bindings file` (better-sqlite3)

Visual Studio Build Tools 2022 をインストール後:
```bash
npm rebuild better-sqlite3
```

### ポートが既に使用されている

```bash
PORT=3001 node --import tsx server/index.ts
# または
.\start.ps1 -Port 3001
```

### YouTube API エラー

- Settings で API キーが設定されているか確認
- Google Cloud Console で YouTube Data API v3 が有効か確認
- クォータ残量を確認（1日 10,000 ユニット）

### VRChat ログが見つからない

- Settings でログディレクトリのパスが正しいか確認
- VRChatが一度以上起動されているか確認（ログは初回起動時に生成）

## ライセンス

MIT
