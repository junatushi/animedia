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
- `node scripts/check-threads.js` … Threads自動投稿のテスト（2026-08-05導入）。APIのスタブを
  立てて`scripts/post-threads.js`を実際に動かし、コンテナの状態待ち・一時エラーの再試行・
  恒久エラーの即失敗を固定する。ネットワークには出ない。`post-threads.js`を触ったら必ず実行する
- `node scripts/build-archive-index.ts` … 過去クール索引の再生成（2026-08-05導入）。
  `content/snapshots/*.json`を読み、sitemapに載せる過去クール（シーズンページ＋配信1件以上の
  作品ページ）の索引を`content/archive/index.json`に書く。ネットワーク不要。
  **スナップショットを追加・再生成したら必ず実行する**（ズレは`node scripts/check.ts`が検出）
- `node scripts/audit-coverage.ts [year] [season]` … 配信データ網羅率の点検（2026-07-12導入）。
  引数省略時は現在のクール。(a)TV放送データはあるが配信サービス0件の作品（注目度順。
  Annict側の登録待ちの疑い）、(b)「その他配信」に落ちた未知チャンネル名（`SERVICES`
  追加候補）を出す。`ANNICT_TOKEN`が要る（`.env.local`から自動で読む）
- `node scripts/demand-scan.js` … 配信の「需要シグナル」集計（2026-07-16導入）。SNS/知恵袋/掲示板から
  拾った需要（作品の配信先困りごと＋配信サービス需要）をランキング化。収集はClaude(WebSearch)が
  `content/demand/raw/<日付>.jsonl`に保存→本CLIが集計。`--print-queries`で収集クエリを表示。
  手順は`docs/demand-scan.md`
- `node scripts/lead-finder.js` … 流入リード発掘（2026-07-16導入）。「アニメ視聴ガイドを今必要としている
  個人の投稿」を`content/demand/raw/`から拾い、作品を`/api/search-index`で`/anime/{id}`に解決して
  **貼れる返信下書き**を`docs/leads-<日付>.md`に出す。接触は手動。リンクに`?ref=<媒体>`を付け流入実測。
  週次Xキットのリーチ枠への転用が狙い。手順は`docs/demand-scan.md`の後半

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
- **CI**（2026-08-06導入）: `.github/workflows/ci.yml` がPRとmainへのpushで
  `tsc --noEmit` → `node scripts/check.ts` → `node scripts/check-threads.js` → `npm run build`
  を回す。**Node 22 必須**（`check.ts`は`.ts`を直接実行＝型ストリッピング依存。他のワークフローの
  Node 20 では動かない）。シークレット不要で外向き通信にも依存しないので、Annict障害で赤くならない。
  詳細は`docs/operations.md`の⑭。
- SNS自動投稿の**Bluesky/Threads**は**1日3枠の時間帯**に分けて出す（2026-08-05〜）:
  7〜10時＝注目作TOP5、11〜12時＝【どこで見れる？】スポットライト（昼休みの12時台に
  確実に届かせるため1時間手前から窓を開ける）、18〜21時＝その曜日の放送・配信。
  **Mastodonだけは1日1回・5〜7時台にその日の分をまとめて**投稿する（`BATCH_SLOTS`。
  2026-08-06に21時台から朝へ変更＝利用者の指定。日付が変わるまでの余裕が3→19時間に延び、
  scheduleの遅延で1日ぶん取りこぼす事故が起きにくくなる副次効果もある。
  `SLOTS`と違い`kinds`を持たない＝内容を絞らない）。
  GitHub Actionsのscheduleは数時間遅れるため「予定時刻に1回起動」では時刻を守れない。
  そこで**1時間おきに起動し、いまがどの時間帯かを自分で判定して未投稿ならそこで投稿する**
  方式にしている（二重投稿はキャッシュで防止／全滅時は次の起動が自動リトライ）。
  さらにGitHubはscheduleを大量に間引く（実測: 5分おき指定が実際は2.5時間おき・最大13時間の
  空き）ため、時間帯を丸ごと逃す日が約6日に1日ある。逃した枠は**その日のうちなら時間帯を
  過ぎても投げる**（`dueSlots`）。
  時間帯の定義は`scripts/lib/build-digest.js`の`SLOTS`**だけ**が持ち、ワークフローのYAMLには
  時刻を書かない（`node scripts/check.ts`がハードコードの逆戻りを検査する）。詳細は
  `docs/operations.md`の⑦-9。
- Xへの投稿は**ブラウザから手動**（2026-07-05〜）。X APIが2026年2月に無料枠廃止・従量課金制（投稿1件$0.015、リンク付き$0.20）になったため、API自動投稿（`.github/workflows/post-to-x.yml`）は保留中でGitHub Secrets未登録。文案は `docs/sns-templates.md`。詳細は `docs/operations.md`。
- Xアカウント成長（フォロワー獲得）は**週次X成長キット**（`x-growth.yml`が毎週月曜20:00 JSTに起票するGitHub Issue）で運用。投稿ドラフト4本＋見込み客への検索クエリ/リプ下書き＋週次チェックを自動生成し、投稿・リプ・フォローは手動で行う（自動投稿・自動フォロー・スクレイピングはしない）。生成は `scripts/lib/build-growth-kit.js`。考え方は `docs/x-growth-playbook.md`、運用は `docs/operations.md`の⑫。
- 流入リード発掘（demand-scan/lead-finder、2026-07-16導入・検証中）は「配信どこ？」で困っている個人の投稿を見つけ返信下書きを作る仕組み。2〜3週に1回、Claudeに「流入リードを集めて」と依頼して回す。手順は `docs/operations.md`の⑬、技術詳細は `docs/demand-scan.md`。
- ユーザー行動は Vercel Web Analytics のカスタムイベントで計測（`docs/operations.md` の「計測の見かた」参照）。
- 集客最大化・サイト改良の構想メモは `docs/growth-ideas.md` にまとめてある（次回セッションの着手候補）。
- **集客戦略の方針は `docs/growth-strategy-2026-08.md`**（2026-08-07。世界の類似サービス約100件の
  調査に基づく）。要点は「SEOで順位を上げるより、**他人の道具が依存するデータ供給元になる**
  ほうがこの分野の生存者の実績と整合する」こと。既存の公開API・ウィジェットに
  **帰属義務（出典表記＋リンク）が無い**ため使われても被リンクが返らない、という設計上の穴も
  そこに書いてある。却下した施策（はてブ狙い・Wikipedia自リンク・Product Hunt等）も
  理由つきで載せてあるので、**再提案の前に読むこと**。出典URL付きの生データは
  `docs/research-2026-08/`。
- **アフィリエイト運用**（2026-07-18導入）: 提携・リンク登録・月次の報酬額更新（月1回・5分）は
  `docs/affiliate-setup.md`。報酬額を更新すれば採用リンク（最高報酬のASP）の切替は自動。
- **自動運用のモデル構成**: 監督役＝セッションのメインモデル（現在はFable。定額プランの対象から
  外れた場合はセッション起動時にOpusを選択すれば全体がそのまま追従する）。エージェント定義や
  スクリプトに監督役のモデル名を**ハードコードしない**こと。実行役は各エージェント定義
  （`.claude/agents/*.md` の `model:` — sonnet中心、品質重視のsns-marketerのみopus）で指定する。

## 主要ファイル
- `lib/siteUrl.ts` … サイト正準URLの一元定義（2026-07-18導入）。canonical・OGP・sitemap・JSON-LD・
  メール内リンクの全てがここを参照する。独自ドメイン移行時はこの1行＋`docs/domain-migration.md`の手順
- `content/affiliate/programs.ts` + `lib/affiliate.ts` … アフィリエイトのリンク・報酬額データ
  （2026-07-18導入）。サービスごとに複数ASPのリンクを登録し、`pickAffiliate`が報酬額最大の
  activeなリンクを自動選択する。運用は`docs/affiliate-setup.md`
- `lib/services.ts` の `officialUrl`（SERVICESの各エントリ、2026-07-19追加） … 配信サービスの
  公式トップページURL。バッジのリンク先でアフィリエイトが無いときのフォールバックに使う
- `components/ServiceMarks.tsx` … 配信バッジ本体。**バッジ自体がリンク**（2026-07-19変更）で、
  リンク先は`pickAffiliate`が返す提携リンク（あれば）→ 無ければ`officialUrl`（公式サイト）の順。
  アフィリエイトの有無でバッジの表示・非表示は変えない（表示件数は常に一定）。ステマ規制対応は
  バッジの`title`属性（「〜（広告リンク）」）＋開示文（`.svc-disclosure`）で行う（バッジ上のPRタグは
  2026-07-27廃止）。`hideDisclosure`propでカード一覧など反復表示箇所の重複を抑制できるが、その画面は
  呼び出し側が1回だけ開示文を出す責任を持つ。**バッジの中に別のリンクを入れないこと**（2026-07-28:
  人力補完の出典を「✓」でバッジ内に置いていたところ、バッジ本体＝配信サービスへのリンクと押し
  間違えて無関係な記事に飛ぶ事故になった。出典はバッジ列の下の注記`.svc-manual-note`に文言付きで
  出し、カード一覧では`hideManualNote`で省く）。単一サービスのCTA用途にも再利用できる
  （`app/service/[key]/...`が使用）
- `app/privacy/page.tsx` … プライバシーポリシー・広告掲載方針（2026-07-18導入。ステマ規制・ASP/AdSense
  審査対応）。実際に行っていることだけを書く方針。計測・ログイン情報の記載を変えたら実装と同期させる
- `lib/logEvent.ts` … クライアント行動ログの共通ヘルパー（SeasonExplorer/ServiceMarksが使用。
  イベント名は`app/api/track/route.ts`のALLOWED_EVENTSで許可制）
- `lib/services.ts` … 配信サービスの正準リスト `SERVICES` と判定 `classifyChannel`、`AnnictWork`→`AnimeItem`変換 `toAnimeItem`、`AnnictWork`→`AnimeDetail`変換 `toAnimeDetail`（声優・監督・製作会社・原作者を導出）。`AnimeItem.hasBroadcastData`はAnnictにprograms（TV含む）が1件でもあるかのフラグで、配信サービス0件のときUI（`ServiceMarks`）が「配信情報なし」（データ自体なし）と「TV放送のみ（配信情報は未登録の可能性）」を出し分けるのに使う
- `lib/annict.ts` … Annict GraphQL クエリ（サーバー側専用）。シーズン一括取得 `fetchSeasonWorks` と単一作品取得 `fetchWorkById`。どちらも programs（放送/配信）と casts/staffs（声優・スタッフ）を取得する。programsが1ページ(300件)を超える作品の追い取得は、一覧用（`PROGRAMS_QUERY_LIST`、episodeフィールド無し）と作品個別/通知機能用（`PROGRAMS_QUERY`、episode/rebroadcast付き）を分けている（後者だとepisode未紐付けprogramがnon-nullフィールド違反で丸ごと消えるため）
- `scripts/audit-coverage.ts` … 配信データ網羅率の点検スクリプト（`node scripts/audit-coverage.ts [year] [season]`）。season-updater/service-mapperエージェントが使う
- `scripts/demand-scan.js` + `scripts/lib/demand-analyze.js` + `content/demand/` … 配信の需要シグナル収集・集計（2026-07-16導入）。`queries.js`が収集用の正準クエリ、`raw/<日付>.jsonl`が入力（WebSearchで収集）、`out/`が集計JSON。集計ロジック（直近N日フィルタ・重複排除・需要分類・作品/サービス抽出・スコア）は`demand-analyze.js`に純粋関数で分離。詳細は`docs/demand-scan.md`
- `scripts/lead-finder.js` … 流入リード発掘（2026-07-16導入）。`demand-scan`と同じ`raw/<日付>.jsonl`（任意で`status:open|closed`付き）を入力に、ガイドを必要としている個人の投稿を抽出し、作品を`/api/search-index`で`/anime/{id}`に解決して返信下書き付きの`docs/leads-<日付>.md`を出力。分類は`demand-analyze.js`を流用。リンクの`?ref=<媒体>`で流入実測。開/閉判定はnodeから不可のため収集時にClaudeがWebFetchで`status`を記録する設計。本命は同エンジンのX リーチ枠への転用（`docs/x-growth-playbook.md`）。詳細は`docs/demand-scan.md`後半
- `content/works/extraServices.ts` … Annictにまだ登録されていない配信サービスを人力補完する一覧（2026-07-12導入。`rentalServices.ts`と同じ思想）。`{ key, sourceUrl, confirmedDate }`必須（一次情報のみ・出典明示。CLAUDE.mdの方針に準拠）。任意で`schedule: { weekday, time, startDate }`も指定でき、**Annictに配信の実データが1件も無いときだけ**曜日・時刻カレンダーのフォールバックとして使う（Annict実データがあれば必ずそちらを優先）。`getSeasonData`/`getWorkData`から`toAnimeItem`/`toAnimeDetail`の第2引数に注入され、`ServiceMarks`が通常のAnnict由来サービスとは違う見た目（点線枠）で表示し、出典はバッジ列の下の注記（`.svc-manual-note`。カード一覧では`hideManualNote`で省略）にリンクする。対象は`audit-coverage.ts`の(a)に出た注目作から都度追加する方針（全件を追う保守コストは避ける）
- `content/works/releaseDates.ts` … 劇場公開日の人力補完（2026-07-27導入）。**Annictは劇場公開日を持たない**
  （GraphQLのWork型に該当フィールドが無く、REST v1の`released_on`も新作映画では空。実例:劇場版まどマギ
  〈ワルプルギスの廻天〉はAnnict側の日付情報が`season_name="2026-summer"`だけ）。サイトの日付は
  programsの`startedAt`から導出しているため、programsが0件の劇場作品は曜日・時刻・開始日が全てnullになり、
  一覧カードは「放送時期未定」・作品ページは日付なしになっていた。`{ date, sourceUrl, confirmedDate }`必須で
  `extraServices.ts`と同じ思想（一次情報のみ・出典明示・推測禁止）。`getSeasonData`/`getWorkData`から
  `toAnimeItem`/`toAnimeDetail`の**第3引数**で注入する。表示は①カードの`airLabel`＝「8/28(金)公開」、
  ②作品ページの「劇場公開日」行（出典リンク＋確認日）、③JSON-LDの`datePublished`とFAQ「公開日はいつ？」、
  ④公開日からのクール逆算（劇場作品にもシーズンページへの内部リンクが出る）。公開日は延期されるため
  `confirmedDate`を必ず入れ、注目度の高い劇場作品から都度追加する（全作品は追わない）
- `lib/getSeasonData.ts` / `lib/getWorkData.ts` … シーズン一覧・作品個別データの取得ロジック（API route と SSR ページの両方から共有）。`getSeasonData`は**今年**はライブ取得＋`unstable_cache`（15分=900s。cron遅延吸収のため2026-07-21に10分から延長）だが、**過去年**は`content/snapshots/{year}-{season}.json`があればそれを即返す（無ければライブ取得へフォールバック）。API窓口（`app/api/season/route.ts`）はさらに応答に`s-maxage=600, stale-while-revalidate=86400`を付けCDNエッジにもキャッシュする（2026-07-21）。`getWorkData`は年に関わらず常にAnnictへのライブ取得（`fetchWorkById`）を優先するが、それが失敗し、かつ対象作品が`content/archive/index.json`（配信1件以上の過去クール1,961件）に載っていれば、`content/snapshots/`から`credits`（声優のキャラ名対応・監督・製作会社・原作者。スナップショット生成時に作られておらず持っていない）だけ空にした縮退版`AnimeDetail`にフォールバックする（2026-08-06導入。詳細は`docs/operations.md`の⑦-12）。平常時（Annictが生きている間）は今まで通りフルの`credits`つきで返る。
- `content/snapshots/{year}-{season}.json` + `scripts/snapshot-past-seasons.ts` … 過去年（放送終了済み）シーズンの確定データを固定した静的スナップショット（2026-07-15導入）。過去年をライブ取得＋Vercelデータキャッシュに頼っていた時期は、温めCron成功の翌日でもキャッシュ追い出しで初回5〜10秒コールドを踏んでいた（実測2024夏9.4s/2020冬5.1s）ため、放送済みで動かないデータをリポジトリ同梱JSONに固定し常時0.03秒程度にした。生成は`node scripts/snapshot-past-seasons.ts [fromYear] [toYear] [--force]`（省略で2010〜昨年・既存スキップ）。**年またぎ時は前年分を1回生成する**（例:2027年になったら`node scripts/snapshot-past-seasons.ts 2026 2026`）。詳細は`docs/operations.md`の⑦-4
- `content/works/{annictId}.json` + `content/works/index.ts` … 作品個別ページの「あらすじ・見どころ・出版社」と、任意の`faq`（「2期から見ても大丈夫？」等のよくある質問。2026-07-27追加。可視テキストとFAQPage構造化データの両方に出る）。Annictに無いデータのため人力で追記する補足コンテンツ（`docs/operations.md`の「⑧作品詳細コンテンツの追記」参照）。`faq`は実測で需要が確認できた作品にだけ付ける（全作品分の維持は続かないため）。未整備の作品は単純に省略表示される
- `app/api/sns-image/route.tsx` … SNS投稿に添付する公開PNG（2026-07-27導入）。`?kind=ranking` と `?kind=airing&day=月`。**Threadsは画像のバイナリ投稿に対応せず公開URL（`image_url`）しか受け付けない**ため、Playwrightのスクリーンショットを添付できない。その回避としてサイト自身が同等の画像を配信する。既存OG画像2本と同じ`runtime="edge"`（nodejs runtimeにすると`next/og`がWindowsのローカル開発機で必ず例外になり手元で検証できなくなる）。データはedgeで`fs`が使えないため`/api/season`から取る。Threads固有の注意点は`docs/threads-setup.md`の⑦
- `content/sns/spotlight.js` … SNS投稿の「スポットライト枠」で日替わりに紹介する作品リスト（2026-07-27導入）。GSC・Vercel Analyticsの実測で需要が確認できた作品だけを載せ、推測で足さない。`hashtag`は作品名タグで、タイトルからの自動生成はせず手で書く（期数・記号を落とす。`☆`等はSNS側のタグ解析を壊すため使わない）。生成は`scripts/lib/build-digest.js`の`buildSpotlight`
- `scripts/gen-thumbnails.js` + `public/works/{annictId}.jpg` + `content/works/imageIds.ts` … AI独断解釈サムネ。権利者の画像は使わず、Pollinations（無料・APIキー不要）でタイトルから連想した**本作品と無関係な創作イラスト**を事前生成し静的ファイルとして保存（表示コスト・キー・レート制限ゼロ）。カード左タイル・作品ページに表示し、必ず「本作品との関連性はありません」の注釈を添える。画像がある作品IDは`imageIds.ts`の`WORK_IMAGE_IDS`で判定。未生成の作品はモノグラムタイルにフォールバック
- `lib/workTitle.ts` … 作品ページの`<title>`組み立て（2026-08-05導入）。検索結果で切り捨てられない
  幅（`TITLE_WIDTH_BUDGET`）に収まる分だけ配信サービス名を入れる。`.tsx`だと
  `node scripts/check.ts`からimportできない（NodeはJSXを解釈しない）ので素の`.ts`に置いてある
- `components/TopPageExplorer.tsx` … トップページ（"/"）専用の薄いラッパー（2026-08-05導入）。
  `useSearchParams()`を呼ぶのはここだけにして、`SeasonExplorer`本体をサーバー描画できる状態に
  保つ（理由は作業ルールの「SSRページの中身が空になっていないか」参照）。**シーズンページから
  これを経由してはいけない**（経由するとSSRが空に戻る）
- `content/archive/index.json` + `scripts/build-archive-index.ts` … 過去クールの索引（2026-08-05導入）。
  `content/snapshots/`から「配信サービスが1件以上ある作品」だけを抜いた軽い索引（14KB）で、
  `app/sitemap.ts`が過去クールのシーズンページ・作品ページを載せるのに使う。
  配信0件の作品は「配信情報なし」としか答えられない薄いページなので意図的に載せない
  （実測: 過去8,957作品中、配信ありは1,961作品）
- `lib/embed.ts` + `app/embed/anime/[id]/route.ts` + `components/EmbedSnippet.tsx` + `app/developers/page.tsx`
  … 配信先ウィジェット（2026-08-06導入）。他サイトに貼ってもらうための埋め込み。作品ページの
  「ブログ・サイトに貼る」からHTML/iframeの貼り付けコードをコピーできる。**被リンク獲得が目的**
  （平均掲載順位19.8位の原因は被リンクゼロという判断。詳細は`docs/operations.md`の⑯）。
  `.ts`に置いてあるのは`node scripts/check.ts`から検査するため。iframe側をReactのページではなく
  Route Handlerにしているのは、ルートレイアウト（globals.css・Supabaseの認証・Analytics）を
  他人のサイトに持ち込まないため
- `app/api/work/[id]/route.ts` … 作品1件の配信情報を返す公開API（2026-08-06導入。CORS許可・
  APIキー不要）。`/api/season`・`/api/search-index`にもCORSヘッダを追加して公開API化した。
  `airingStatus`（`airing`/`finished`）も返し、二次利用側が過去作を「配信中」と書かずに
  済むようにしている。仕様と利用条件は`/developers`
- `lib/workAvailability.ts` … 「その作品が今も配信されているか」を断定してよい範囲で表現する
  ロジック（2026-08-06導入）。`airingStatus`（クール判定）と、作品ページ・ウィジェットが共用する
  文面生成（`buildWatchAnswer`/`buildWatchDescription`/`availabilityLabel`）を持つ。
  **文面を変えるときはここを直す**（`app/anime/[id]/page.tsx`や`lib/embed.ts`に直書きしない。
  直書きすると`node scripts/check.ts`の検査をすり抜ける）。素の`.ts`なのは検査から
  importするため。経緯は`docs/operations.md`の⑰
- `app/api/season/route.ts` … `GET /api/season?year=2026&season=spring`（トップページのクライアント側フェッチ用）
- `app/api/search-index/route.ts` … クール横断キーワード検索用の軽量インデックス（直近数年分の作品ID・タイトル・読み仮名・年・季節のみ。programs/castsは含めない）。日次キャッシュ（`revalidate=86400`）。検索欄で表示中クール以外の作品もヒットさせるのに使う
- `app/page.tsx` … トップページ（サーバーコンポーネント。2026-07-21にISR化＝`revalidate=900`。
  searchParams非依存で常に今期を初期表示し、/season系と同じくページHTMLがエッジキャッシュに
  載る〈以前はsearchParamsを読むため毎回動的描画=no-storeで0.5〜2.8s掛かっていた〉。年・季節の
  切替やディープリンク〈?year=&season=〉の解決はクライアント側=SeasonExplorerが担う）
- `app/season/[year]/[season]/page.tsx` … シーズン別のSSRページ（SEO用。シーズン名でのタイトル/OGPを動的生成）
- `app/anime/[id]/page.tsx` … 作品個別のSSRページ（SEO用。「作品名 配信」検索の受け皿。声優/監督/製作会社/原作＋あらすじ等も表示）。2026-07-27にISR化（`revalidate=900` ＋ `generateStaticParams`が**空配列**。後者が無いと`revalidate`を書いてもprerender-manifestに載らず動的のまま）。ここに`loading.tsx`を置くと`notFound()`が200（ソフト404）になるため置かない。詳細は`docs/operations.md`の⑦-6
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
- **【基本ルール】カードのタップ領域（2026-07-27導入）**: 一覧カード・カレンダー行は
  タイトルのリンクを`::after`でカード/行の全面に引き伸ばしている（stretched link。
  `app/globals.css`の`.card-title a::after`／`.calendar-title::after`）。カード内に
  リンクやボタンを追加するときは、そのリンク**要素そのもの**にだけ`position:relative`＋
  `z-index`を付けて上に出すこと。列や行ごと`z-index`を上げると、要素同士の隙間や
  ただのテキストがタップ領域から抜け落ちる。カード側の`position:relative`を外したり、
  タイトルとカードの間の要素に`position`を付けたりすると引き伸ばしが効かなくなる。
  経緯は`docs/operations.md`の⑦-6。
- **【基本ルール】配信バッジの遷移先（2026-07-28導入・重大度高）**: 配信サービスのバッジを
  押したら、**必ずそのサービス自身**（`pickAffiliate`の提携リンク → 無ければ`officialUrl`の
  公式サイト）に行くこと。バッジの中に、行き先の違うリンクを**絶対に入れない**。
  経緯: 人力補完の出典（ニュース記事）を「✓」でバッジ内に置いていたため、Prime Videoの
  バッジのつもりで無関係な記事に飛ぶ事故になった（利用者の信頼と広告の成果計上を同時に
  壊すため、インシデント級の扱い）。出典・補足情報はバッジ列の外（`.svc-manual-note`のような
  注記）に、**何のリンクか分かる文言を付けて**置く。記号だけのリンクにしない。
  `node scripts/check.ts` に機械的な検査（バッジ列の中に現れる`href`は1つだけ・中身は`href`変数）
  を入れてあるので、**この検査を消したり目印を外したりしない**。詳細は`docs/operations.md`の⑦-7。
- **【基本ルール】バッジ上の「PR」表記は復活させない（2026-07-28確認）**: ステマ規制対応は
  バッジの`title`属性＋ページ下部の開示文（`.svc-disclosure`）で行う方針で確定している。
  事故が起きない限り「PRタグを付ける」提案はしない（2026-07-27に廃止済み。再提案も不要）。
- **【基本ルール】SSRページの中身が空になっていないか、HTMLを取って確かめる（2026-08-05導入・重大度高）**:
  `useSearchParams()`を呼ぶクライアントコンポーネントがあると、Next.js 14は静的生成（ISR）される
  ページでそのSuspense境界を**丸ごとクライアント描画に退避**させ、サーバーHTMLには`fallback`しか
  出力しない。`components/SeasonExplorer.tsx`がこれを呼んでいたため、SEOのために作った
  `/season/[year]/[season]`の本番HTMLは**h1が0個・作品への`<a href="/anime/..">`が0個・
  可視テキスト0文字**（中身はJSON-LDのみ）だった。ブラウザではクライアント描画で正常に
  見えるので、**画面を見る限り絶対に気づけない**。
  対策として、クエリを読むのはトップページ専用の薄いラッパー（`components/TopPageExplorer.tsx`）
  だけにし、`SeasonExplorer`本体は`urlQuery`propで受け取る形にした。
  SSR/ISRページを追加・変更したときは、**必ずビルドして`curl`でHTMLを取り、狙った見出し・
  リンクが入っているかを数える**こと（ブラウザの表示は当てにならない）。
  `node scripts/check.ts`に「SeasonExplorerが`useSearchParams`をimportしない」
  「シーズンページは`SeasonExplorer`を直接使う」の検査を入れてあるので消さないこと。
- **【基本ルール】検索結果のtitleは幅の予算内に収める（2026-08-05導入）**:
  日本語の検索結果のtitleは概ね全角30〜33文字で打ち切られる。作品ページのtitleは
  `lib/workTitle.ts`の`buildWorkTitle`が予算（`TITLE_WIDTH_BUDGET`）に収まる分だけ
  配信サービス名を入れる。作品名は主キーワードなので予算を超えても削らない。
  経緯: 2026-07-27に「検索語に近づける」ためサービス名をtitleへ入れたが幅を見ておらず、
  実データ335作品で中央値47文字・99%が30文字超になり、**入れたはずのサービス名が
  ほぼ全作品で表示前に切り捨てられていた**。配信社数が多い人気作ほど長くなるため、
  いちばんCTRを取りたい作品ほど切られる逆相関にもなっていた。
  作品ページは`title: { absolute: ... }`でレイアウトの`template`（`| アニメ視聴ガイド`）を
  効かせない（ブランド名は全角11文字ぶん幅を食うのに検索語との関連性を持たないため）。
- **【基本ルール】GitHub Actionsのscheduleは「予定通りに発火しない」前提で書く（2026-08-05導入）**:
  scheduleは予定より数時間遅れて発火する（このリポジトリの実測で最大6.4時間）。
  そのため**発火時刻（`new Date()`）をそのまま「今日」として使うと日付がズレる**。実際、
  21:00 JSTのcronが日をまたぎ、2日続けて同じJST日付の内容をSNSに投稿する事故が起きた。
  JSTの日付に依存する定期処理を書くときは、①JSTの日付が変わるまで十分な余裕がある時刻に
  cronを置く、②「実行は予定より早くは始まらない」性質を使い、いまのJST時刻が予定時刻より
  前なら日付をまたいだ遅延実行＝前日の枠、と判定して基準日を固定する
  （`scripts/lib/build-digest.js`の`anchorToSlotDate`）、③**時刻の定義をコード側1箇所に
  まとめ、cronは「毎時起動」にしてYAMLに時刻を書かない**（両方に書くとズレたときに
  気づけない。`node scripts/check.ts`に検査あり）。
  そもそも**「何時に投稿する」をcronで実現しようとしない**こと。実測遅延は2.1〜6.4時間・
  中央値約5時間あり、cronの時刻はまったく当てにならない。狙った時間帯に出したいなら、
  1時間おきに起動して「いまがその時間帯か」をコード側で判定する
  （`slotForNow`）。経緯は`docs/operations.md`の⑦-9。
- **【基本ルール】外部SNS APIに投げる処理は「一時的な失敗」を前提に書く（2026-08-05導入）**:
  Threads自動投稿が2週間で4回、`Media Not Found`（コンテナがまだ見えていないだけの一時的な
  エラー）で丸ごと落ちていた。外部APIを叩くスクリプトを書く/直すときは、①一時的なエラー
  （HTTP 429・5xx・APIごとの「まだ準備できていない」系エラー）だけを指数バックオフで再試行し、
  恒久的なエラー（認証失敗・本文不正）は即座に失敗させる、②複数件を投げるループは1件ずつ
  try/catchで独立させ、1件目の失敗で残りを巻き添えにしない、③失敗はログだけで終わらせず
  運用動線（GitHub Issue）に出す、の3点を必ず入れる。
  また、**スタブ/テスト用の抜け道を本番でも通る分岐として書かないこと**。今回の直接原因は
  「statusが返らなければ待たずに進む」というスタブ向けの分岐が本番でも効いていたことだった。
  差し替えてよいのは待ち時間などの数値だけで、判断の分岐はテストと本番で同じ経路を通す。
  経緯は`docs/operations.md`の⑦-8。
- **【基本ルール】埋め込み（配信先ウィジェット）に広告リンクを入れない（2026-08-06導入・重大度高）**:
  `lib/embed.ts`が作るHTMLは**他人のサイトの中で表示される**ため、事故の影響が自サイトに閉じない。
  ①リンク先は自サイト（`siteUrl`）配下だけにする（アフィリエイトリンクを混ぜない。他人のブログに
  自分の広告リンクを埋めるのはステマ規制・ASP規約の両面で事故になり、貼る側の信頼も壊す）、
  ②`<script>`を含めない（他人のサイトで実行されるJSを配らない）、③作品名は必ずエスケープする、
  ④リンクに`?ref=embed`を付ける（流入の実測）。`node scripts/check.ts`に機械的な検査を
  入れてあるので消さないこと。
  また、埋め込みのアンカーテキストは**作品名とサイト名だけ**にする。Googleは「ウィジェット経由の
  キーワード詰め込みリンク」をリンクスパムとして扱うため、検索語を詰めたアンカーに変えない。
  詳細は`docs/operations.md`の⑯。
- **【基本ルール】放送が終わった作品に「いま配信中」と書かない（2026-08-06導入・重大度高）**:
  Annictのprogramsは**放送/配信の番組表の記録**であって、配信の現在の可否ではない。Annictは
  「配信が終了した」ことを記録しない（コミュニティ更新ベース）ため、過去作のデータに
  サービスが並んでいても、それは当時の記録が残っているだけ。にもかかわらず作品ページは
  全作品に「『X』は dアニメストア・U-NEXT で視聴できます（{今日}時点）」と現在形で断定して
  おり、2026-08-05に過去クール1,961ページを検索エンジンへ開放した結果、**誰も確認していない
  主張が索引に載り始めていた**。
  判定と文面は`lib/workAvailability.ts`に集約してある。現在クールより前の作品
  （`airingStatus`が`finished`）では「視聴できます」「配信中」と言い切らず、事実である
  「配信情報がある」だけを述べて各サービスでの確認を促す。**逆に「もう配信されていません」と
  書くのも同じく未確認なので禁止**。ウィジェット（他人のブログの過去作記事に貼られる）と
  公開API（`airingStatus`を返す）も同じ扱いにすること。
  「配信情報の取得日」は**Annictからデータを取った日**であって配信を確認した日ではないので、
  「確認日」と書かない。`node scripts/check.ts`の「放送終了作品の表現」節が機械的に
  検査しているので消さないこと。詳細は`docs/operations.md`の⑰。
- 配信網羅率は Annict のコミュニティ更新依存で100%ではない。新作は配信欄が空になりうる。
  「配信情報なし」は仕様であり、勝手に推測データで埋めない。
- `content/works/` のあらすじ・見どころ・出版社も同様に、公式サイト等の一次情報で確認できた
  事実だけを書く（創作しない）。未整備の作品はファイルを作らず省略表示に任せる。
  進め方は `docs/operations.md` の「⑧作品詳細コンテンツの追記」を参照。
- 返答は日本語で。

## ネットワークの注意（サンドボックス等で動かす場合）
- 通信先 `api.annict.com`（GraphQL）と、サムネイル画像のCDNドメインへの外向き通信が必要。
