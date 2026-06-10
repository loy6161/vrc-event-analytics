# VRC Event Analytics

registry: vrc-event-analytics

## スタック
- バックエンド: Express + TypeScript（server/）
- DB: libSQL（Turso）
- フロントエンド: Vite + React + recharts + @tanstack/react-table
- 外部連携: Google API（googleapis）
- デプロイ: Railway

## 起動
```
cd VRC_User_Loger/event-analytics && npm run dev
# concurrently で vite + server が同時起動
```

## 連携
- produces: `vrchat.events`
- consumes: なし

## 流儀・制約
- DB は libSQL（VRC_Analytics の Postgres とは別。統合する場合は要検討）
- Google API 認証は .env で管理（credentials は絶対コミットしない）
- テスト: tests/integration.test.mjs（node --test）

## Notion
（設計書 URL を後で追記）
