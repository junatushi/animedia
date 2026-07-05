# CLAUDE.md — アニメ視聴ガイド

Claude Code はこのファイルを毎セッション最初に読みます。ここに書いたことは前提として扱ってください。

## このプロジェクト
シーズンごとのアニメを、観られる**国内配信サービス**で一覧できる Web アプリ。
配信情報は Annict の GraphQL API から**サーバー側で**リアルタイム取得する。

## スタック
- Next.js 14（App Router）/ React 18 / TypeScript
- データベースなし（外部APIのみ）
- 外部API: Annict GraphQL `https://api.annict.com/graphql`（要トークン）

## よく使うコマンド
- `npm install` … 依存をインストール（初回のみ）
- `npm run dev` … 開発サーバー起動 → http://localhost:3000
- `npm run build` … 本番ビルド
- `node scripts/check.ts` … 配信判定ロジックのテスト（全件OKになること）

## 環境変数
- `ANNICT_TOKEN` … Annict の個人用アクセストークン（Read 権限）。`.env.local` に置く。
  - 取得: https://annict.com/settings/tokens
  - **`.env.local` は絶対にコミットしない**（`.gitignore` 済み）。
  - **トークンはサーバー側だけで使う**。クライアント（ブラウザ）に渡すコードは書かない。

## 構成（設計したエージェント → コードの対応）
| エージェント | 役割 | 実体 |
|---|---|---|
| ① 収集 | シーズン作品＋チャンネルを Annict から取得 | `lib/annict.ts` |
| ② 配信正規化 | チャンネル名→国内配信サービスに変換、TVは除外、未知は「その他配信」 | `lib/services.ts` |
| （窓口） | ①②をつなぎ整形JSONを返す API | `app/api/season/route.ts` |
| ③ UI | シーズン選択・検索・絞り込み・一覧表示 | `app/page.tsx` |
| ④ 検証/更新 | 新シーズンの再取得・差分・配信欠損の洗い出し | `.claude/agents/season-updater.md` |
| 保守 | 未対応の配信サービスを洗い出し SERVICES に追加提案 | `.claude/agents/service-mapper.md` |
| SNS運用 | 更新告知の投稿文案・共有導線・SEO・興味付け | `.claude/agents/sns-marketer.md` |

## 運用（定期作業）
- 定期点検・SNS投稿のサイクルは `docs/operations.md` にまとめてある（新クール開始時と2〜3週間後の点検＋告知）。
- Xへの投稿は**ブラウザから手動**（2026-07-05〜）。X APIが2026年2月に無料枠廃止・従量課金制（投稿1件$0.015、リンク付き$0.20）になったため、API自動投稿（`.github/workflows/post-to-x.yml`）は保留中でGitHub Secrets未登録。文案は `docs/sns-templates.md`。詳細は `docs/operations.md`。
- ユーザー行動は Vercel Web Analytics のカスタムイベントで計測（`docs/operations.md` の「計測の見かた」参照）。

## 主要ファイル
- `lib/services.ts` … 配信サービスの正準リスト `SERVICES` と判定 `classifyChannel`
- `lib/annict.ts` … Annict GraphQL クエリ（サーバー側専用）
- `app/api/season/route.ts` … `GET /api/season?year=2026&season=spring`
- `app/page.tsx` … 画面（"use client"）
- `app/globals.css` … テーマ（濃紺×ゴールド）

## 作業ルール
- 配信サービスを増やすときは `lib/services.ts` の `SERVICES` に1エントリ追加し、`match` は
  正規化後（小文字・半角・空白除去）の名前に対する正規表現で書く。追加後は必ず
  `node scripts/check.ts` を実行して回帰がないか確認する。
- リアルタイム度は `lib/annict.ts` の `next: { revalidate: 600 }` で調整（0=常に最新）。
- 配信網羅率は Annict のコミュニティ更新依存で100%ではない。新作は配信欄が空になりうる。
  「配信情報なし」は仕様であり、勝手に推測データで埋めない。
- 返答は日本語で。

## ネットワークの注意（サンドボックス等で動かす場合）
- 通信先 `api.annict.com`（GraphQL）と、サムネイル画像のCDNドメインへの外向き通信が必要。
