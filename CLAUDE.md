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
- `node scripts/audit-coverage.ts [year] [season]` … 配信データ網羅率の点検（2026-07-12導入）。
  引数省略時は現在のクール。(a)TV放送データはあるが配信サービス0件の作品（注目度順。
  Annict側の登録待ちの疑い）、(b)「その他配信」に落ちた未知チャンネル名（`SERVICES`
  追加候補）を出す。`ANNICT_TOKEN`が要る（`.env.local`から自動で読む）
- `node scripts/demand-scan.js` … 配信の「需要シグナル」集計（2026-07-16導入）。SNS/知恵袋/掲示板から
  拾った需要（作品の配信先困りごと＋配信サービス需要）をランキング化。収集はClaude(WebSearch)が
  `content/demand/raw/<日付>.jsonl`に保存→本CLIが集計。`--print-queries`で収集クエリを表示。
  手順は`docs/demand-scan.md`

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
| 見込みユーザー発掘 | アニメ系Discord/まとめサイト/困りごとシグナルの候補を発掘（接触は人力） | `.claude/agents/outreach-scout.md` |

## 運用（定期作業）
- 定期点検・SNS投稿のサイクルは `docs/operations.md` にまとめてある（新クール開始時と2〜3週間後の点検＋告知）。
- Xへの投稿は**ブラウザから手動**（2026-07-05〜）。X APIが2026年2月に無料枠廃止・従量課金制（投稿1件$0.015、リンク付き$0.20）になったため、API自動投稿（`.github/workflows/post-to-x.yml`）は保留中でGitHub Secrets未登録。文案は `docs/sns-templates.md`。詳細は `docs/operations.md`。
- Xアカウント成長（フォロワー獲得）は**週次X成長キット**（`x-growth.yml`が毎週月曜20:00 JSTに起票するGitHub Issue）で運用。投稿ドラフト4本＋見込み客への検索クエリ/リプ下書き＋週次チェックを自動生成し、投稿・リプ・フォローは手動で行う（自動投稿・自動フォロー・スクレイピングはしない）。生成は `scripts/lib/build-growth-kit.js`。考え方は `docs/x-growth-playbook.md`、運用は `docs/operations.md`の⑫。
- ユーザー行動は Vercel Web Analytics のカスタムイベントで計測（`docs/operations.md` の「計測の見かた」参照）。
- 集客最大化・サイト改良の構想メモは `docs/growth-ideas.md` にまとめてある（次回セッションの着手候補）。

## 主要ファイル
- `lib/services.ts` … 配信サービスの正準リスト `SERVICES` と判定 `classifyChannel`、`AnnictWork`→`AnimeItem`変換 `toAnimeItem`、`AnnictWork`→`AnimeDetail`変換 `toAnimeDetail`（声優・監督・製作会社・原作者を導出）。`AnimeItem.hasBroadcastData`はAnnictにprograms（TV含む）が1件でもあるかのフラグで、配信サービス0件のときUI（`ServiceMarks`）が「配信情報なし」（データ自体なし）と「TV放送のみ（配信情報は未登録の可能性）」を出し分けるのに使う
- `lib/annict.ts` … Annict GraphQL クエリ（サーバー側専用）。シーズン一括取得 `fetchSeasonWorks` と単一作品取得 `fetchWorkById`。どちらも programs（放送/配信）と casts/staffs（声優・スタッフ）を取得する。programsが1ページ(300件)を超える作品の追い取得は、一覧用（`PROGRAMS_QUERY_LIST`、episodeフィールド無し）と作品個別/通知機能用（`PROGRAMS_QUERY`、episode/rebroadcast付き）を分けている（後者だとepisode未紐付けprogramがnon-nullフィールド違反で丸ごと消えるため）
- `scripts/audit-coverage.ts` … 配信データ網羅率の点検スクリプト（`node scripts/audit-coverage.ts [year] [season]`）。season-updater/service-mapperエージェントが使う
- `scripts/demand-scan.js` + `scripts/lib/demand-analyze.js` + `content/demand/` … 配信の需要シグナル収集・集計（2026-07-16導入）。`queries.js`が収集用の正準クエリ、`raw/<日付>.jsonl`が入力（WebSearchで収集）、`out/`が集計JSON。集計ロジック（直近N日フィルタ・重複排除・需要分類・作品/サービス抽出・スコア）は`demand-analyze.js`に純粋関数で分離。詳細は`docs/demand-scan.md`
- `content/works/extraServices.ts` … Annictにまだ登録されていない配信サービスを人力補完する一覧（2026-07-12導入。`rentalServices.ts`と同じ思想）。`{ key, sourceUrl, confirmedDate }`必須（一次情報のみ・出典明示。CLAUDE.mdの方針に準拠）。任意で`schedule: { weekday, time, startDate }`も指定でき、**Annictに配信の実データが1件も無いときだけ**曜日・時刻カレンダーのフォールバックとして使う（Annict実データがあれば必ずそちらを優先）。`getSeasonData`/`getWorkData`から`toAnimeItem`/`toAnimeDetail`の第2引数に注入され、`ServiceMarks`が通常のAnnict由来サービスとは違う見た目（点線枠＋出典リンクの✓マーク）で表示する。対象は`audit-coverage.ts`の(a)に出た注目作から都度追加する方針（全件を追う保守コストは避ける）
- `lib/getSeasonData.ts` / `lib/getWorkData.ts` … シーズン一覧・作品個別データの取得ロジック（API route と SSR ページの両方から共有）。`getSeasonData`は**今年**はライブ取得＋`unstable_cache`（10分）だが、**過去年**は`content/snapshots/{year}-{season}.json`があればそれを即返す（無ければライブ取得へフォールバック）
- `content/snapshots/{year}-{season}.json` + `scripts/snapshot-past-seasons.ts` … 過去年（放送終了済み）シーズンの確定データを固定した静的スナップショット（2026-07-15導入）。過去年をライブ取得＋Vercelデータキャッシュに頼っていた時期は、温めCron成功の翌日でもキャッシュ追い出しで初回5〜10秒コールドを踏んでいた（実測2024夏9.4s/2020冬5.1s）ため、放送済みで動かないデータをリポジトリ同梱JSONに固定し常時0.03秒程度にした。生成は`node scripts/snapshot-past-seasons.ts [fromYear] [toYear] [--force]`（省略で2010〜昨年・既存スキップ）。**年またぎ時は前年分を1回生成する**（例:2027年になったら`node scripts/snapshot-past-seasons.ts 2026 2026`）。詳細は`docs/operations.md`の⑦-4
- `content/works/{annictId}.json` + `content/works/index.ts` … 作品個別ページの「あらすじ・見どころ・出版社」。Annictに無いデータのため人力で追記する補足コンテンツ（`docs/operations.md`の「⑧作品詳細コンテンツの追記」参照）。未整備の作品は単純に省略表示される
- `scripts/gen-thumbnails.js` + `public/works/{annictId}.jpg` + `content/works/imageIds.ts` … AI独断解釈サムネ。権利者の画像は使わず、Pollinations（無料・APIキー不要）でタイトルから連想した**本作品と無関係な創作イラスト**を事前生成し静的ファイルとして保存（表示コスト・キー・レート制限ゼロ）。カード左タイル・作品ページに表示し、必ず「本作品との関連性はありません」の注釈を添える。画像がある作品IDは`imageIds.ts`の`WORK_IMAGE_IDS`で判定。未生成の作品はモノグラムタイルにフォールバック
- `app/api/season/route.ts` … `GET /api/season?year=2026&season=spring`（トップページのクライアント側フェッチ用）
- `app/api/search-index/route.ts` … クール横断キーワード検索用の軽量インデックス（直近数年分の作品ID・タイトル・読み仮名・年・季節のみ。programs/castsは含めない）。日次キャッシュ（`revalidate=86400`）。検索欄で表示中クール以外の作品もヒットさせるのに使う
- `app/page.tsx` … トップページ（"use client"、常に現在時点のクエリ/現在シーズン基準のSPA）
- `app/season/[year]/[season]/page.tsx` … シーズン別のSSRページ（SEO用。シーズン名でのタイトル/OGPを動的生成）
- `app/anime/[id]/page.tsx` … 作品個別のSSRページ（SEO用。「作品名 配信」検索の受け皿。声優/監督/製作会社/原作＋あらすじ等も表示）
- `components/SeasonExplorer.tsx` … 上記3ページが共有する画面本体（"use client"）。`initialData`を渡すとSSR結果をそのまま使い、再フェッチしない。検索欄は作品名に加え声優・スタッフ名（`creditNames`）にもマッチし、さらに `/api/search-index` を使って表示中クール以外の作品も「他のクールの作品」枠でヒットさせる（年数・季節セレクタは検索の絞り込みには使わず、閲覧クールの切替のみ。各カードに放送クールを表示）。一覧/カレンダー（曜日別配信スケジュール）の表示切替もここ
- `components/ThemeToggle.tsx` … ライト/ダークのテーマ切替（SAOモチーフ。ダーク＝黒の剣士キリト基調、ライト＝閃光のアスナ基調）。`localStorage`に保存
- `app/globals.css` … テーマ本体。ダーク/ライトの2テーマをCSS変数で切替

## 作業ルール
- 配信サービスを増やすときは `lib/services.ts` の `SERVICES` に1エントリ追加し、`match` は
  正規化後（小文字・半角・空白除去）の名前に対する正規表現で書く。追加後は必ず
  `node scripts/check.ts` を実行して回帰がないか確認する。
- リアルタイム度は `lib/annict.ts` の `next: { revalidate: 600 }` で調整（0=常に最新）。
- **【基本ルール】放送開始1週間前ルール（2026-07-11導入）**: 放送/配信の曜日・時刻
  （`broadcastWeekday`/`broadcastTime`）は「毎週その曜日に配信される」という前提の表示。
  まだ放送開始前の作品にこれを出すと「今週の水曜22:30」のように見えてしまい、実際は
  1話も配信されていないのにアクセスしてしまう誤誘導になる（実例: Re:ゼロ4期奪還編、
  8月開始なのに7月から曜日・時刻付きでカレンダー/カードに出ていた）。そのため
  `broadcastStartDate`（放送/配信開始日、"YYYY-MM-DD" JST）を基準に、放送開始の
  1週間より前は①カレンダー（曜日別グリッド）に出さない、②カードは曜日+時刻ではなく
  日付表示（例:「8/12(水)〜」）にする（`components/SeasonExplorer.tsx` の
  `isFarBeforePremiere`/`airLabel`）。SNS投稿下書き（`scripts/lib/build-digest.js` の
  `buildTodayAiring`）など、`broadcastWeekday` で「今日放送」を判定する箇所は同様に
  `broadcastStartDate` で放送開始済みかを確認すること。曜日・時刻を使った新機能を
  追加するときは、この「放送開始前は出さない」ルールを必ず踏襲する。
- 配信網羅率は Annict のコミュニティ更新依存で100%ではない。新作は配信欄が空になりうる。
  「配信情報なし」は仕様であり、勝手に推測データで埋めない。
- `content/works/` のあらすじ・見どころ・出版社も同様に、公式サイト等の一次情報で確認できた
  事実だけを書く（創作しない）。未整備の作品はファイルを作らず省略表示に任せる。
  進め方は `docs/operations.md` の「⑧作品詳細コンテンツの追記」を参照。
- 返答は日本語で。

## ネットワークの注意（サンドボックス等で動かす場合）
- 通信先 `api.annict.com`（GraphQL）と、サムネイル画像のCDNドメインへの外向き通信が必要。
