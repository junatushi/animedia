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
- `npm run check` … **コミット前はこれ1本**（2026-08-11導入）。下の検査スクリプトを
  CIと同じ順で全部回す（`tsc --noEmit` → `check.ts` → `check-threads.js` →
  `check-verify-production.js` → `check-gsc.js` → `check-probe-series.js` →
  `check-track-season.js` → `check-fetch-upcoming.js` → `check-site-analytics.js`）。
  検査が6コマンドに分かれていると実際には全部は回されず、2件が数セッション赤いまま
  放置された（`docs/operations.md`の㉔追記2）。CIの`run:`とこのコマンドが同じ検査を
  並べていることは`node scripts/check.ts`が突き合わせる。ネットワークには出ない
- `node scripts/check.ts` … 配信判定ロジックのテスト（全件OKになること）
- `node scripts/check-threads.js` … Threads自動投稿のテスト（2026-08-05導入）。APIのスタブを
  立てて`scripts/post-threads.js`を実際に動かし、コンテナの状態待ち・一時エラーの再試行・
  恒久エラーの即失敗を固定する。ネットワークには出ない。`post-threads.js`を触ったら必ず実行する
- `bash scripts/verify-production.sh` … **本番**SSRの実地検査（2026-08-07導入）。公開URLを実際に
  取ってHTMLを数える。`check.ts`はソースしか見ないため、ソースは正しいのに本番HTMLだけが空
  （`docs/operations.md`の⑦-10）という壊れ方を検知できない。毎日GitHub Actions
  （`.github/workflows/verify-production.yml`）が回すので**手で実行する必要は無い**。
  外向き通信のある環境でのみ動く（本番ドメインが遮断された環境では実行できない＝それが自動化した理由）
- `node scripts/check-verify-production.js` … 上のスクリプト自身の回帰テスト（2026-08-07導入）。
  スタブの本番サーバーを立てて`verify-production.sh`を実際に動かし、**落ちるべきときに落ちる**
  ことを固定する。シェルは「NGを出さなくなる」方向に壊れると毎日緑のまま無力化するため。
  ネットワークには出ない。`verify-production.sh`を触ったら必ず実行する
- `node scripts/build-archive-index.ts` … 過去クール索引の再生成（2026-08-05導入）。
  `content/snapshots/*.json`を読み、sitemapに載せる過去クール（シーズンページ＋配信1件以上の
  作品ページ）の索引を`content/archive/index.json`に書く。ネットワーク不要。
  **スナップショットを追加・再生成したら必ず実行する**（ズレは`node scripts/check.ts`が検出）
- `node scripts/build-person-index.ts` … 声優の出演作索引の再生成（2026-08-07導入）。
  `content/snapshots/*.json`から「配信情報が1件以上ある作品」だけを抜き、声優名→出演作の
  索引を`content/archive/people.json`に書く。ネットワーク不要。
  **スナップショットを追加・再生成したら必ず実行する**（ズレは`node scripts/check.ts`が検出）
- `node scripts/season-prep.js` … 次クール準備の「窓」判定（2026-08-07導入）。クール開始の
  約1〜1.5ヶ月前（8/11/2/5月の下旬）ならIssue本文をstdoutに出し、窓の外なら**何も出さない**。
  `.github/workflows/season-prep.yml`が毎日呼ぶ。窓の定義は`scripts/lib/build-season-prep.js`
  **だけ**が持ち、YAMLに月日を書かない（`node scripts/check.ts`が検査する）。ネットワーク不要
- `node scripts/build-studio-index.ts` … 制作会社・監督の索引。スナップショットの`roleCredits`から
  `content/archive/studios.json`を作る。ネットワーク不要。
  **スナップショットを追加・再生成したら必ず実行する**。
  2026-08-11のスナップショット再生成でデータが入った（制作会社165社・監督378人）。
  導入時（2026-08-07）は旧形式のスナップショットに`roleCredits`が無く空の索引だったが、
  **その状態はもう解消している**（`docs/operations.md`の⑱-11の「データ待ち」は済み）
- `node scripts/probe-series.ts` … Annictの`seriesList`が使えるかの「探り」（2026-08-11導入）。
  `content/works/series.ts`の人力対応表を自動化できるかを判断するための読み取り専用スクリプト。
  **本番のクエリ（`lib/annict.ts`）は一切触らない**。フィールド名を決め打ちせず、まず
  イントロスペクションで形を聞いてから問い合わせを組み立てるので、無いフィールドを指定して
  失敗することが無い。最後に人力の対応表と突き合わせ、**全一致したときだけ自動化を検討する**。
  要`ANNICT_TOKEN`＝PC作業。手順は`docs/annict-serieslist-probe.md`。
  **2026-08-11に実測済み＝結論は「使えない」**（`Series.works`が作品IDでない値を返し、
  `title`を要求すると500。人力の対応表との一致は6シリーズ中0）。**再実行の必要は無い**
- `node scripts/check-probe-series.js` … 上の探りスクリプト自身のテスト（2026-08-11導入）。
  GraphQLのスタブを立てて`probe-series.ts`を実際に動かし、`seriesList`が無いスキーマでも
  落ちないこと・`nodes`/`edges`どちらの形でも辿れること・食い違いを黙って通さないこと・
  200で返るGraphQLエラーを失敗として扱うことを固定する。ネットワークには出ない。
  `probe-series.ts`を触ったら必ず実行する
- `node scripts/check-gsc.js` … GSC取得スクリプトのテスト（2026-08-10導入）。APIのスタブを立てて
  `scripts/fetch-gsc.js`を実際に動かし、一時エラーの再試行・恒久エラーの即失敗・1件失敗で残りを
  巻き添えにしないこと・**書き出すJSONに鍵やトークンが混入しないこと**を固定する。
  ネットワークには出ない。`fetch-gsc.js`を触ったら必ず実行する
- `node scripts/fetch-gsc.js` … GSC検索パフォーマンスの取得（2026-08-10導入）。
  `.github/workflows/gsc-snapshot.yml`が毎日呼び、`content/analytics/gsc/<日付>.json`に保存する。
  **GSCはログインが要るためセッションからは読めない**（通知メールも節目と問題の検出しか届かない）
  ので、外向き通信ができるGitHub Actions側で取ってリポジトリに置き、セッションは
  コミット済みのJSONを読む。セットアップは`docs/gsc-setup.md`、要`GSC_SERVICE_ACCOUNT_JSON`。
  **2026-08-11に`weeklyByType`（面ごとの週次推移）を追加**。従来は date/query/page を別々の軸で
  取っており「面ごとの時系列」が存在しなかったため、「作品ページはクールの進行で落ちるが
  声優ページは落ちない」といった問いに答えられなかった。GSCは16ヶ月保持しているので
  `date`×`page`を長期（既定480日）で取り、`scripts/lib/gsc-page-type.js`が「週×面」へ畳んでから
  書き出す（生の行をそのままコミットするとファイルが肥大化するため）。面の分類は
  そのファイル**だけ**が持つ
- `node scripts/track-season.js` … クール別の「初出日」の記録（2026-08-12導入）。
  **AnnictとAniListを毎日並べて記録し、どちらが先に「作品名＋○年○月放送」を持つかを測る**。
  現在クール＋先の2クールが対象で、①作品がそのクールに初めて現れた日 ②配信サービスが
  初めて現れた日 ③日ごとの総数 を`content/coverage/first-seen.json`に書く。
  Annict側はデプロイ済みサイトの公開API`/api/season`、AniList側は公式GraphQL（キー不要）から
  取るので**`ANNICT_TOKEN`は要らない**（`x-growth.yml`と同じ方針）。毎日
  `.github/workflows/track-season.yml`が回すので手で実行する必要は無い。
  **落ちた日のデータは後追いで取り返せない**（毎日の変化そのものが測定対象）。
  詳細は`docs/next-season-coverage.md`の7章
- `node scripts/check-track-season.js` … 上の記録スクリプトのテスト（2026-08-12導入）。
  HTTPスタブ（Annict・AniListの両方）を立てて`track-season.js`を実際に動かし、
  **firstSeenを上書きしない・消えたものを消さない・初回に`seeded`印を付ける・
  1情報源の失敗で残りを巻き添えにしない**ことを固定する。ネットワークには出ない。
  `track-season.js`を触ったら必ず実行する
- `node scripts/fetch-upcoming.js` … 次クールの放送/公開予定日の取得（2026-08-17導入）。
  **AniListが既に持っている放送日をサイトへ運ぶ**。2026-08-17実測で、2026秋はAnnictに99作品が
  登録されているのに`programs`（番組表）を持つのは3件だけ（96件が「放送時期未定」）で、同じ日
  AniListは日まで判明した日付を38件・第1話の放送時刻を28件持っていた。人力補完
  （`extraServices.ts`/`releaseDates.ts`）は一次情報の確認が要るぶん速くならないので、
  **機械が毎日運ぶ層**を分けた。結果は`content/works/autoSchedule.json`に書く。
  情報源はデプロイ済みサイトの公開API`/api/season`とAniListの公式GraphQLだけなので
  **`ANNICT_TOKEN`は要らない**（`track-season.js`と同じ方針）。毎日
  `.github/workflows/fetch-upcoming.yml`が**1日2回**回すので手で実行する必要は無い。
  **配信サービス名は運ばない**（AniListのストリーミングリンクは言語・地域の情報を持たず
  国内配信の証明にならない。実測でCrunchyroll15件/HIDIVE4件/Netflix4件/Prime1件）。
  詳細は`docs/next-season-coverage.md`
- `node scripts/check-fetch-upcoming.js` … 上の取得スクリプトのテスト（2026-08-17導入）。
  HTTPスタブ（サイトのAPI・AniListの両方）を立てて`fetch-upcoming.js`を実際に動かし、
  **MAL IDでの突き合わせが最優先・食い違いは採用しない・月精度に曜日を付けない・
  過去の予定日を出さない・取れなかった作品を消さない・1情報源の失敗で残りを巻き添えに
  しない**ことを固定する。ネットワークには出ない。`fetch-upcoming.js`を触ったら必ず実行する
- `node scripts/fetch-site-analytics.js` … **サイト自身の行動ログ集計の取得**（2026-08-19導入）。
  自前計測（Supabaseの`analytics_events`）は`/admin/analytics?token=...`の**画面にしか無く、
  ブラウザで開く以外に読む方法が無かった**。そのためセッションは実測値を一度も読めず、
  `docs/affiliate-setup.md`の「未提携サービスへのクリックが多い順に提携する」という判断が
  ユーザーの手入力待ちで止まっていた。GSCと同じ形（外向き通信ができるGitHub Actionsから取り、
  リポジトリにJSONを置き、セッションはコミット済みのJSONを読む）に載せた。
  結果は`content/analytics/site/<日付>.json`。毎日`.github/workflows/site-analytics.yml`が
  回すので手で実行する必要は無い。要`ADMIN_DASHBOARD_TOKEN`（VercelとGitHub Secretsで**同じ値**）。
  集計本体は`lib/adminAnalytics.ts`にあり、**画面とJSON窓口（`app/api/admin/analytics/route.ts`）が
  同じ集計を通る**（どちらかに書き戻すと数字が2通りになる）。手順は`docs/operations.md`の「計測の見かた」
- `node scripts/check-site-analytics.js` … 上の取得スクリプトのテスト（2026-08-19導入）。
  HTTPスタブを立てて`fetch-site-analytics.js`を実際に動かし、**トークンをURLに載せない・
  書き出すJSONにトークンが混入しない・404（トークン不一致）は再試行せず即失敗・
  一時エラー（429/5xx）は再試行・未設定なら静かにスキップしてファイルを作らない・
  打ち切りを黙らない**ことを固定する。ネットワークには出ない。
  `fetch-site-analytics.js`を触ったら必ず実行する
- `node scripts/seo-report.js` … **SEOの「判定」レポート**（2026-08-19導入）。コミット済みの
  `content/analytics/gsc/*.json`を読み、①全体の推移 ②日次の前半/後半 ③**面別の効率
  （1ページあたりクリック）** ④面別の週次推移 ⑤手を入れる候補（11〜20位のクエリ・
  表示があるのにクリック0のページ）を出す。ネットワークには出ない。
  **毎日のSEO作業はまずこれを実行する**（手順は`docs/seo-operations.md`）。
  導入の経緯: 収集（`fetch-gsc.js`）は自動化されていたのに**JSONを読んで
  「改善したか・次に何をすべきか」を答える道具が無く**、面別の効率差
  （声優ページが作品ページの8倍）が2週間埋もれていた（`docs/operations.md`の㉜）。
  **数字をドキュメントに転記しないこと**（棚卸し時点で同じ断面が4箇所に写され、
  平均掲載順位が3つの値で語られていた）
- `node scripts/check-seo-report.js` … 上のレポートの回帰テスト（2026-08-19導入）。
  仮のGSC JSONを置いて`seo-report.js`を実際に動かし、**1ページあたりクリックの降順・
  CTRと順位の表示回数による重み付け・表示ゼロの面の警告・11〜20位の抽出**を固定する。
  落ちるのではなく数字を静かに間違える方向に壊れると、間違った面に投資し続けるため。
  ネットワークには出ない。`seo-report.js`を触ったら必ず実行する
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
- **日次巡回の手順は `docs/daily-ops.md`**（2026-08-19導入）。毎日のスケジュール実行が
  読む手順の**正本**。それまで手順はリポジトリ外（スケジュール実行の設定）にしか無く、
  CI・PRレビュー・`check.ts`のどれにもかからないため、実測と矛盾しても誰も気づけなかった
  （実際に「作品ページに投資する」という実測に否定された方針が毎日注入されていた）。
  **手順を変えるときはこのファイルを直してPRを出す**こと（設定側に写さない）。
- **毎日のSEO改善は `docs/seo-operations.md`**（2026-08-19導入）。`node scripts/seo-report.js`を
  実行し、①11〜20位のクエリ（1ページ目まであと一歩＝費用対効果が最大）②1ページあたり
  クリックが高い面 ③表示があるのにクリック0のページ の順で判断する。
  **2026-08-19時点の重点は声優ページ**（4ページで平均5.7位・CTR8.3%＝サイトで唯一1ページ目。
  作品ページは37ページで22.0位・CTR1.4%）。作品ページの「量を増やす」方向には投資しない。
  **「変化なし」と書く前に必ず`seo-report.js`を実行すること**（見ずに変化なしと書かない）。
  撤退判定の表（期日つき）も同書3節にある。経緯は`docs/operations.md`の㉜
- **集客戦略の方針は `docs/growth-strategy-2026-08.md`**（2026-08-07。世界の類似サービス約100件の
  調査に基づく）。要点は「SEOで順位を上げるより、**他人の道具が依存するデータ供給元になる**
  ほうがこの分野の生存者の実績と整合する」こと。既存の公開API・ウィジェットに
  **帰属義務（出典表記＋リンク）が無い**ため使われても被リンクが返らない、という設計上の穴も
  そこに書いてある。却下した施策（はてブ狙い・Wikipedia自リンク・Product Hunt等）も
  理由つきで載せてあるので、**再提案の前に読むこと**。出典URL付きの生データは
  `docs/research-2026-08/`。
- **AI検索・エージェント時代を見据えた追補は `docs/ai-era-strategy-2026-08-13.md`**（2026-08-13）。
  `docs/growth-strategy-2026-08.md`を踏まえ、収益規模の逆算・AI検索の実測・JustWatch型
  （消費者向け入口＋B2Bデータライセンス）を出典URL付きで検討している。却下・保留にした施策は
  `docs/growth-strategy-2026-08.md`6章の表に反映済みなので**再提案の前に読むこと**。
  関連調査は`docs/chatgpt-app-directory.md`（ChatGPT App Directoryの提出要件）。
  **導入した施策の効果はまだ未測定**（判定条件・時期は同書6章）。経緯は`docs/operations.md`の㉖
- **次クール準備の前倒し**（2026-08-07導入）: 検索需要はクール開始の約1ヶ月前から立ち上がり、
  山は年に4回しか来ない。`.github/workflows/season-prep.yml`が8/11/2/5月の下旬にGitHub Issueで
  チェックリスト（`audit-coverage`の点検→`extraServices.ts`の補完→`spotlight.js`の入れ替え→
  年またぎ時のスナップショット生成）を出す。同じクールで二重起票しない。
  **次クールの網羅は`docs/next-season-coverage.md`**（2026-08-12調査）。要点は
  ①注目作についてはAnnict単独でほぼ埋まり、人力で足すべきは「TV放送データはあるのに
  配信0件」のクールあたり4〜9件だけ（上位50作品の穴はほぼ劇場作品＝配信が存在しない）、
  ②**作品ごとに検索して公式サイトを当たるのは非効率**（Annictが`officialSiteUrl`を
  既に持っている＝探す作業が重複。かつ公式サイトに配信情報がある層＝継続作は
  Annictでも既に埋まっているので巡回の増分価値が小さい。**「公式サイトは配信欄が
  空だから遅い」という当初の説明は2026-08-12に誤りとして訂正済み**＝新作は遅いが
  継続作は8月中旬でも出ている。この節の証拠は弱いので断定に使わないこと）、
  ③代わりに**配信サービス側の
  クール別ラインナップページ**を見る（dアニメ単独で79%・5社で98.5%。サービス自身の
  発表なので`extraServices.ts`の`sourceUrl`に使える一次情報）、④配信先の発表は
  9月中旬〜10月上旬に集中するので8月下旬の窓だけでは終わらない。
  ⑤**新作の配信先を「もっと早く」知る情報源は無い**（2026-08-12調査）。最速の一次情報は
  配信サービス自身の個別プレスリリース（PR TIMES）だが、それでも**放送開始の1〜3週間前**
  （実測7〜16日前）。放送局・放送日は数ヶ月前に出るのに配信は数週間前という2段階構造で、
  情報源を替えても上限は動かない。しょぼいカレンダーは機械可読性が高いがAnnict自身が
  「配信が手薄」を理由に依存をやめた経緯があり、AniList/MALは国内配信サービス名を持たない。
  **動かせるのは「発表→サイトに載る」の遅れだけで、その実測はまだ無い**（測り方は同ドキュメント6章。
  `/api/season`を毎日記録するだけでよく`ANNICT_TOKEN`は不要。**窓は9月中旬〜10月上旬**）。
  ⑥**「作品名＋○月放送」の粒度なら、AniListが2027年冬＝約5ヶ月先の作品を既に持っている**
  （2026-08-12確認。公式GraphQL・無料・キー不要・`season`/`seasonYear`/`status`を持つ）。
  ただし**Annictが未放送作品をどれだけ早く登録するかは実測も評判も無く、優劣は不明**。
  推測できないので`scripts/track-season.js`で**両方を毎日記録して比べる計測を開始した**
  （2026-08-12〜）。結論が出るまで「AniListのほうが速い」と書かないこと。
  AniListの規約はデータの大量収集・退蔵を禁じているので、取得は1クール1日1回・
  保存はID/タイトル/初出日だけに留める（詳細は`docs/next-season-coverage.md`の7章）。
  ⑦**放送時期（○年○月）は放送開始の3〜11ヶ月前・中央値およそ8ヶ月前に出る**
  （2026-08-12実測。2026年10月期の注目作11本。同ドキュメント8章）。配信サービス名の
  7〜16日前と**桁が2つ違う**。だから**「次クールに何があるか」は今すぐ埋まり、「どこで
  見られるか」だけが直前まで埋まらない**。8月にやるべきは配信情報集めではなく作品の
  取りこぼし確認で、配信の窓は9月中旬に開く。発表の山は**AnimeJapan（3月下旬）と
  前作の最終回**が作っており、ニュースサイトは各社ほぼ同日に載せるので
  **どこを監視するかで速さは変わらない**（公式Xを見ても数時間）。
  ⑧**配信サービスのクール別ラインナップ特設ページは、8月時点では8社すべて未公開**
  （2026-08-12実測）。U-NEXTは5年連続で9月中〜下旬（09-16〜09-26）、DMM TVも9月下旬、
  ABEMAに至っては10月中旬＝クール開始後。③を実行できるのは9月中旬以降である。
  ⑨**しょぼいカレンダーを早期の情報源に使う案は不採用**（2026-08-12）。規約は最良
  （公式が自動取得を明示的に許容）だが、公式ヘルプ自身が**「1週間以上先のデータは
  間違っている可能性が高い」**と明記しており、数ヶ月前を扱うこの用途と前提が合わない。
  **再提案しないこと**（同ドキュメント8-4）。
  ⑩**放送時期を運ぶ経路は2026-08-17に自動化した**。⑦のとおり放送時期は早く出るのに、
  Annictの番組表に載るのは遅い（2026-08-17実測で2026秋99作品中3件）。そこで
  `scripts/fetch-upcoming.js`がAniListから予定日を1日2回運び、変化があればコミットして
  デプロイする（`content/works/autoSchedule.json`）。**8月の窓でやることは配信情報集めでも
  放送日の手入力でもなく、取りこぼしの確認だけ**になった。配信サービス名は依然として
  自動化できない（⑧のとおり各社の特設ページが9月中旬まで出ない）。
- **Annictへのデータ還元と再配布の相談**は `docs/annict-contribution.md`（2026-08-07導入）。
  `audit-coverage.ts`が出す「配信0件の注目作」「未知チャンネル名」を一次情報で確認してAnnictへ
  登録する手順と、作品データの再配布可否を尋ねる問い合わせ文面。**主目的はサイトの配信網羅率が
  上がること**で、再配布の相談はその後。機械的な一括投稿はしない。
- **アフィリエイト運用**（2026-07-18導入）: 提携・リンク登録・月次の報酬額更新（月1回・5分）は
  `docs/affiliate-setup.md`。報酬額を更新すれば採用リンク（最高報酬のASP）の切替は自動。
- **自動運用のモデル構成**: 監督役＝セッションのメインモデル（現在はFable。定額プランの対象から
  外れた場合はセッション起動時にOpusを選択すれば全体がそのまま追従する）。エージェント定義や
  スクリプトに監督役のモデル名を**ハードコードしない**こと。実行役は各エージェント定義
  （`.claude/agents/*.md` の `model:` — sonnet中心、品質重視のsns-marketerのみopus）で指定する。

## 主要ファイル
- `vercel.json` … **表示に使わないデータのコミットで本番デプロイを起こさないための門番**
  （2026-08-25導入）。`ignoreCommand`が「`content/analytics/`・`content/coverage/`・
  `content/demand/`・`docs/`しか変更していないコミット」を判定し、その場合はビルドをスキップする
  （終了コード0＝スキップ、非0＝ビルド）。Vercelはデプロイごとに独立したISRキャッシュを持つため、
  デプロイ＝キャッシュ実質全消去＝全ページの作り直しになる。mainへ自動コミットするcronは1日5本
  あるが、うち3本（`gsc-snapshot`・`site-analytics`・`track-season`）が書くのはサイトの表示に
  一切使われないデータで、それが毎日3回キャッシュを捨てていた。**`content/works/`は除外していない**
  （`autoSchedule.json`は画面に出るのでデプロイが必要）。**このファイルを消すとVercelが停止した
  ときの状態に戻る**。経緯は`docs/operations.md`の㉝
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
- `lib/annict.ts` … Annict GraphQL クエリ（サーバー側専用）。シーズン一括取得 `fetchSeasonWorks` と単一作品取得 `fetchWorkById`。どちらも programs（放送/配信）と casts/staffs（声優・スタッフ）を取得する。**【重要】どのクエリでも `episode` を要求しないこと**（2026-08-16修正・重大度高）。Annictの`Program.episode`はnon-nullなのに話数未紐付けのprogramが実在し、要求するとGraphQLのnull伝播で**programノードが丸ごとnullになりchannel＝配信サービスごと消える**。2026-07-12に「300件超の追い取得」だけを直したが、1ページ目を取る`WORK_QUERY`が要求したままで、**一覧（/api/season）には出るのに作品ページだけ「配信情報なし」**という食い違いが残っていた（実例: 17359 スティール・ボール・ランはprograms11件が11件ともnull）。programsのフィールドは用途別の3定数（`PROGRAM_FIELDS_LIST`／`PROGRAM_FIELDS_DETAIL`＝＋rebroadcast／`PROGRAM_FIELDS_EPISODE`＝＋episode）にまとめてあり、episodeを含むのは配信開始通知メールの話数表示専用の`PROGRAMS_QUERY_EPISODE`**だけ**。通知は`fetchWorkById(id, token, { withEpisode: true })`で2本目を投げ、`mergeEpisodeInfo`がchannel名＋startedAtを鍵に話数だけを重ねる（baseのノードは絶対に減らさない）。`node scripts/check.ts`が「episodeを書いてよいのは1箇所だけ」「withEpisodeを使うのは通知バッチだけ」を機械的に検査するので消さないこと。経緯は`docs/operations.md`の㉙
- `scripts/audit-coverage.ts` … 配信データ網羅率の点検スクリプト（`node scripts/audit-coverage.ts [year] [season]`）。season-updater/service-mapperエージェントが使う
- `scripts/demand-scan.js` + `scripts/lib/demand-analyze.js` + `content/demand/` … 配信の需要シグナル収集・集計（2026-07-16導入）。`queries.js`が収集用の正準クエリ、`raw/<日付>.jsonl`が入力（WebSearchで収集）、`out/`が集計JSON。集計ロジック（直近N日フィルタ・重複排除・需要分類・作品/サービス抽出・スコア）は`demand-analyze.js`に純粋関数で分離。詳細は`docs/demand-scan.md`
- `scripts/lead-finder.js` … 流入リード発掘（2026-07-16導入）。`demand-scan`と同じ`raw/<日付>.jsonl`（任意で`status:open|closed`付き）を入力に、ガイドを必要としている個人の投稿を抽出し、作品を`/api/search-index`で`/anime/{id}`に解決して返信下書き付きの`docs/leads-<日付>.md`を出力。分類は`demand-analyze.js`を流用。リンクの`?ref=<媒体>`で流入実測。開/閉判定はnodeから不可のため収集時にClaudeがWebFetchで`status`を記録する設計。本命は同エンジンのX リーチ枠への転用（`docs/x-growth-playbook.md`）。詳細は`docs/demand-scan.md`後半
- `content/works/extraServices.ts` … Annictにまだ登録されていない配信サービスを人力補完する一覧（2026-07-12導入。`rentalServices.ts`と同じ思想）。`{ key, sourceUrl, confirmedDate }`必須（一次情報のみ・出典明示。CLAUDE.mdの方針に準拠）。任意で`schedule: { weekday, time, startDate }`も指定でき、**Annictに配信の実データが1件も無いときだけ**曜日・時刻カレンダーのフォールバックとして使う（Annict実データがあれば必ずそちらを優先）。`getSeasonData`/`getWorkData`から`toAnimeItem`/`toAnimeDetail`の第2引数に注入され、`ServiceMarks`が通常のAnnict由来サービスとは違う見た目（点線枠）で表示し、出典はバッジ列の下の注記（`.svc-manual-note`。カード一覧では`hideManualNote`で省略）にリンクする。対象は`audit-coverage.ts`の(a)に出た注目作から都度追加する方針（全件を追う保守コストは避ける）
- `content/works/series.ts` … シリーズ（1期・2期・劇場版）の対応表（2026-08-11導入）。
  作品ページの「シリーズの他の作品」欄。**Annictの`seriesList`は使っていない**（この作業環境から
  応答を確認できず、未検証のフィールドを一覧クエリに足すと失敗時にサイト全部のデータ取得が
  壊れるため）。`extraServices.ts`と同じ人力補完＝一次情報のみ・`sourceUrl`と`confirmedDate`必須・
  **作品名から「◯期」を機械的に推測して繋がない**（同名の別作品やスピンオフを誤って繋ぐと
  無関係なページへ送ることになる）。全作品は追わず**GSCで需要が確認できた作品から都度追加**する。
  経緯は`docs/operations.md`の㉒
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
- `content/works/autoSchedule.json` + `lib/autoSchedule.ts` + `scripts/lib/upcoming-match.js` …
  **機械補完した放送/公開の予定日**（2026-08-17導入）。`extraServices.ts`・`releaseDates.ts`が
  「人が一次情報で確認して足す層」なのに対し、こちらは**GitHub Actionsが1日2回上書きして
  コミットする層**（生成は`scripts/fetch-upcoming.js`）。次クールの放送日はAnnictの番組表に
  載るのが遅く、これが無いと開始1〜2ヶ月前の作品は全部「放送時期未定」になる。
  外してはいけない点が5つある:
  ①**層の優先順位は Annict実データ > 人力補完 > 機械補完**（`toAnimeItem`の第4引数。上位が
  あれば`autoSchedule`は`null`になる＝確認済みの事実を未確認の推定で上書きしない）。
  ②**`broadcastWeekday`/`broadcastTime`/`broadcastStartDate`に流し込まない**。流すと
  カレンダー・ICS・SNSの「今日放送」に乗り、放送開始1週間前ルールを機械補完の側から破る。
  ③**JSON-LDに出さない**（`datePublished`もFAQPageも触らない）。撤回した`WatchAction`と同型の
  「可視テキストに無い主張が機械可読の層にだけ残る」壊れ方になるため。可視テキスト側は必ず
  「予定」と明示し、出典（AniListの作品ページ）と取得日を添える。
  ④**月精度（"2026-10"）には曜日・時刻を付けない**（確定した放送枠があるように見える）。
  ⑤**AniListとの突き合わせは推測でやらない**。`malAnimeId`↔`idMal`（同じMyAnimeListの作品ID）が
  主で、正規化タイトルの完全一致と公式サイトURL一致が補助。手段どうしが食い違った作品と、
  同じキーに2作品がぶら下がった曖昧なキーは**採用しない**（誤マッチ＝無関係な作品の日付が
  サイトに出る事故）。読み込み時に1件ずつ検証して壊れた件だけ捨てる（`lib/autoSchedule.ts`）。
  検査は`node scripts/check.ts`の「機械補完した放送予定日」節。経緯は`docs/operations.md`
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
- **【重要】声優データは「一覧クエリのキャスト件数」に全部ぶら下がっている**（2026-08-11）。
  `lib/annict.ts` の `CASTS_LIST` が、シーズン一覧で1作品あたり何人の声優を取るかを決める。
  ここが長らく **5** で、検索欄の声優名マッチ・声優ページの出演作一覧・作品ページの声優
  リンク判定・sitemapの選定・`content/archive/people.json` の**全部**が取りこぼしていた
  （実測: 2025夏172作品中87作品=50.6%がちょうど5件＝上限で切断）。「そのクールに2作品以上」
  の閾値と噛み合って、リンクも声優ページも**消える**形で壊れる。転送量はJSON全体の3.3%
  しかないので件数をケチらない。`node scripts/check.ts` の「声優データの取りこぼし」が下限を
  見張る。**既存の`content/snapshots/`は旧設定(5件)で作られているため、過去クール分は
  スナップショットを再生成するまで取りこぼしたまま**。再生成の手順は
  `docs/snapshot-regenerate.md`（PC作業・要`ANNICT_TOKEN`）、経緯は`docs/operations.md`の⑳。
  現状の切断率は`node scripts/check.ts`が毎回表示する（`ℹ スナップショットの切断率`）
- `lib/personIndex.ts` + `content/archive/people.json` + `scripts/build-person-index.ts` …
  声優の出演作索引（2026-08-07導入）。`/person/[name]/[year]/[season]`が持つ
  「他のクールの出演作」の元データ。**そのクールの出演作しか出せない**という制約を外す
  ためのもので、Annictへの追加取得はゼロ（スナップショットの`castNames`から作る）。
  収録は`content/archive/index.json`と同じ方針で**配信情報が1件以上ある作品だけ**、
  かつ出演2作品以上の人だけ（787人・出演7,721件）。**載っているのは「そのクールの番組表に
  配信の記録があった」事実であって、いま配信されているかではない**ので、表示側は
  「配信情報がある」までに留める（`lib/workAvailability.ts`と同じ扱い）。
  素の`.ts`なのは`scripts/check.ts`から検査するため
- `lib/serviceAdditions.ts` + `app/api/service-additions/**` … 「Annictに配信サービスが新しく
  登録された」ことの検知（2026-08-07導入・**Supabaseのテーブル作成待ち**）。**メール通知には
  繋がない**（既存の`/api/notify`は日付駆動で1日1通に収まるが、これは変更駆動でAnnict側の
  編集回数がそのまま届く。2026-08-07・利用者の指摘）。揺れを届けないための4つの保証
  （①消えたことは扱わない ②連続3日見えてから確定 ③報告済みの組は永久に再報告しない
  ④初回は種まき）は`node scripts/check.ts`が全部テストする。文面は「配信開始」と断定せず
  **「配信情報に◯◯が追加されました」**にすること。手順は`docs/service-additions-setup.md`
- `lib/discord.ts` + `app/api/discord/route.ts` … Discordスラッシュコマンド `/anime`（2026-08-07導入）。
  **Interactions Endpoint方式**（常時起動のプロセスが要らない＝既存のVercelに相乗りでき、
  ホスティング費用ゼロ）。署名検証は**必ず生のリクエストボディ**で行う（JSONに直して戻すと失敗する）。
  壊れた署名に401を返さないとDiscordがエンドポイント登録を拒否する。返信は**他人のサーバーに残る**
  ため、放送終了作品にはサービス名を並べず作品ページへ案内するに留める。3秒ルールがあるので
  遅延応答は使わず、今期のキャッシュ済みデータだけで即答する（間に合わなければリンクを返す）。
  セットアップは`docs/discord-setup.md`、環境変数は`DISCORD_PUBLIC_KEY`（未設定なら503を返すだけ）
- `lib/servicePlan.ts` … 「お気に入りの作品を全部見るには、どのサービスに入れば足りるか」を
  求める集合被覆の**厳密解**（2026-08-07導入。貪欲法だと1社多い答えを返す形があるため）。
  `components/SeasonExplorer.tsx`が折りたたみパネルで使う。**一覧の描画経路には足さない**
  （カードごとにマークアップを増やすとHTMLが作品数に比例して膨らむ）。計算は
  **パネルを開いたときだけ**走らせる（`planOpen`で門番）。料金は扱わない（改定の追従コストが
  継続的に発生するため。2026-08-07の判断）。速さは`node scripts/check.ts`が実データで上限
  200msを見張る（実測: 最大クール224作品で0.5ms）
- `lib/studioIndex.ts` + `content/archive/studios.json` + `scripts/build-studio-index.ts` …
  制作会社・監督の横断索引（2026-08-07導入）。`lib/personIndex.ts`と同じ流儀・同じ収録方針
  （配信情報が1件以上ある作品だけ・2作品以上の会社/監督だけ）で、表示側の表現の制約も同じ
  （「配信情報がある」までに留める）。`creditNames`から名前の見た目で
  制作会社と人名を推測して分けることは**しない**（誤判定が嘘のページになるため）
- `app/studio/[name]/page.tsx` + `app/director/[name]/page.tsx` + `components/CreditPage.tsx` …
  制作会社ページ・監督ページ（2026-08-12導入）。上の索引だけで完結する静的ページで、
  **クールで割らない**（声優ページがクール別なのは今期のライブ取得を使うためで、こちらは
  静的JSONだけなので割る理由が無い）。165社＋378人を**全件事前生成**するので`revalidate`は不要
  （`generateStaticParams`が索引のキーを返す）。中身は`CreditPage.tsx`が1箇所で持ち、
  2ページで表現がズレないようにしてある。**`loading.tsx`を置かないこと**（ソフト404になる）。
  作品ページの「監督」「製作会社」欄からのリンクが唯一の入口で、リンク側は`hasCreditPage`で
  門番する（索引に無い名前は素のテキストのまま＝404へのリンクを配らない）。
  `node scripts/check.ts`の「制作会社・監督ページ」「孤立ページを作らない」が検査する。
  **監督名・制作会社名での検索需要は未実測**（声優ページの実績からの推測で作った面）。
  効果は`weeklyByType`で後から判定する
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
- `lib/serviceDataset.ts` + `app/api/services/route.ts` … 配信サービス名寄せ表（`lib/services.ts`の
  `SERVICES`の正規化ロジック）を配布する公開API（2026-08-13導入。`GET /api/services`＝JSON既定・
  `?format=csv`＝RFC4180・BOM無し）。**作品ごとの配信実績（Annict由来）は含めない**
  （再配布可否が未確認。`docs/annict-contribution.md`）。帰属義務（出典表記・リンク）はJSON応答
  自体と`/developers`の両方に付ける。`.ts`に置いてあるのは`lib/embed.ts`と同じ理由で
  `node scripts/check.ts`から検査するため（`route.ts`は`next/server`依存でNodeから直接importできない）。
  検査は「配信サービス名寄せ表の公開」節。背景は`docs/operations.md`の㉖。
  外してはいけない点が4つある: ①**`SERVICES`だけでなく`TV_PATTERN`（放送局の除外）も
  `matching.broadcastPattern`として配る**。これが無いと二次利用側はTOKYO MX・AT-X・BS11を
  「その他配信」＝配信サービスとして扱い、本サイトの判定を再現できない（TVerが`^tv`で
  TV枠に入るのも**仕様どおり**。ここを弄らない）。②**出典表記にAnnictを出さない**
  （このAPIはAnnictに一度も触れないうえ、被リンクを得るための公開なのにクレジットが
  Annictへ流れる）。③**応答に日付を持たせない**（`s-maxage=86400`とズレる）。
  ④CSVの`Link: rel="license"`は`Access-Control-Expose-Headers: Link`が無いと
  ブラウザの`fetch`から読めない（`curl`では届くので気づけない）
- `lib/workAvailability.ts` … 「その作品が今も配信されているか」を断定してよい範囲で表現する
  ロジック（2026-08-06導入）。`airingStatus`（クール判定）と、作品ページ・ウィジェットが共用する
  文面生成（`buildWatchAnswer`/`buildWatchDescription`/`availabilityLabel`）を持つ。
  **文面を変えるときはここを直す**（`app/anime/[id]/page.tsx`や`lib/embed.ts`に直書きしない。
  直書きすると`node scripts/check.ts`の検査をすり抜ける）。素の`.ts`なのは検査から
  importするため。経緯は`docs/operations.md`の⑰。2026-08-13に`buildStreamingProperties`（作品ページ
  JSON-LDの`additionalProperty`）/`buildDataProvenance`（取得元・取得日の構造化データ）を追加。
  可視テキストと同じ制約（「確認日」と書かない・アフィリエイトリンクを渡す口を作らない）を
  機械可読側でも守る。検査は「配信情報の構造化データ」節。経緯は同書の㉖。
  **`WatchAction`/`potentialAction`は使わない（同日に一度実装してから撤回した。再提案しない）**:
  ①「ここで見られる」という現在形の主張なので、放送開始前の作品（`airingStatus`は`airing`）に
  出てしまい「放送開始1週間前ルール」を機械可読の層で破る、②`target`に入れられるのは各サービスの
  公式トップページだけで作品への直リンクが無い＝「リンクの見た目＝遷移先」を人の目に触れない層で
  犯す、③見放題かレンタルかを表す`Offer`を付けられない。代わりに`additionalProperty`
  （`PropertyValue`）で**事実だけ**（「このサービスの配信情報がある」）を述べる。事実は放送前・
  放送中・放送終了のどれでも真なので**状態で分岐しない**＝分岐の抜けで壊れる形が構造的に無い。
  URLを一切持たないので広告リンクの混入経路も存在しない。逆戻りは`node scripts/check.ts`が
  機械的に禁じている（生成箇所に`WatchAction`/`potentialAction`/`EntryPoint`/`urlTemplate`が
  現れないことを検査する）ので、この検査を消さないこと。
  **`buildDataProvenance`は作品ノードに混ぜず、独立した`WebPage`ノードとして出す**
  （2026-08-16修正）。`citation`は`CreativeWork`の「**その作品が**参照している著作物」という
  意味なので、`TVSeries`に付けると「このアニメがAnnictを引用している」という事実でない主張に
  なる＝可視テキストに無い嘘が機械可読の層にだけ残る（撤回した`WatchAction`と同じ型）。
  参照しているのは作品ではなくページ。`Object.assign(workLd, ...)`への逆戻りも検査済み
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
  サンドボックスで外向き通信が遮断されていても**`localhost`は遮断されない**ので、
  `npm run build && npx next start -p 3100` で本番ビルドを起動すれば同じ検査ができる
  （過去クールは`content/snapshots/`から返るのでトークン不要。現在クールは要
  `ANNICT_TOKEN`）。手順とリダイレクト検査は`docs/operations.md`の⑲。
  `node scripts/check.ts`に「SeasonExplorerが`useSearchParams`をimportしない」
  「シーズンページは`SeasonExplorer`を直接使う」の検査を入れてあるので消さないこと。
  **本番HTMLの確認は自動化済み**（2026-08-07）。`scripts/verify-production.sh`を毎日
  GitHub Actionsが回し、`<h1>`と作品リンクの件数を数える。この手順は3セッション連続で
  持ち越された＝手順書に書くだけでは実行されないと分かったため機械に移した。
  ローカルで確かめたいときも`bash scripts/verify-production.sh`が使える。
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
  **「貼る側自身のアフィリエイトIDを差し込めるようにする」案（Reelgood型）は2026-08-07に却下済み。
  再提案しない。** 「自分の広告リンクではないから趣旨に反しない」という理屈は成り立つが、
  実装すると上記①の機械的検査を外すことになる。得られるのは被リンクの見込み（推測）で、
  失うのは既にある防壁。交換として割に合わないという判断（`docs/growth-strategy-2026-08.md`の2章）。
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
- **【基本ルール】sitemapに載せるページは、サイト内からも辿れるようにする（2026-08-07導入）**:
  `/service/[key]/[year]/[season]`（サービス別ページ）は実装済みでsitemapにも載せていたのに、
  **サイト内からのリンクが1本も無い孤立ページ**だった。上部のサービス絞り込みは`<button>`で
  クライアント状態を変えるだけで`<a href>`を持たないため、**画面を見ている限り「リンクがある」と
  錯覚する**（2026-08-05に他クールへのリンクで踏んだのと同じ穴）。加入判断＝アフィリエイトの
  転換が起きる唯一の面が、人にもクローラーにも存在しないのと同じ状態になっていた。
  新しいページ種別を追加してsitemapに載せるときは、**どの既存ページから実リンクを張るかを
  同時に決める**こと。`node scripts/check.ts`の「孤立ページを作らない」節に検査があるので消さない。
- **【基本ルール】新しいページ種別は「面」にも登録する（2026-08-19導入）**: 上の孤立ページが
  「人とクローラーから辿れるか」なら、こちらは**投資判断の土俵に乗るか**。
  `scripts/lib/gsc-page-type.js`の`PAGE_TYPE_PREFIXES`に接頭辞を足さないと、そのページは
  `seo-report.js`の③（1ページあたりクリック）④（面別の週次推移）で黙って「その他」に
  落ち、**どの面に投資するかの表に一度も現れない**。表に出ない面は効果を測られず、
  作られたことすら忘れられる。面を増やしたくない場合も、増やさない理由を書いて
  `SITEMAP_OTHER_PATHS`に登録する。`node scripts/check.ts`の「面（ページ種別）の分類」節が
  sitemapと機械的に突き合わせ、どちらもしていないパスがあれば落ちる。
- **【基本ルール】ページのtitleは`lib/pageMeta.ts`で組み立てる（2026-08-19導入）**:
  `generateMetadata`の中でテンプレートリテラルを直書きしない。直書きすると
  ①幅の予算（`lib/pageTitle.ts`／全角32）が効かず ②`node scripts/check.ts`から検査できない
  （`.tsx`はNodeがimportできない）。実際、予算は2026-08-05に作ったのに作品ページにしか
  効いておらず、制作会社ページは165件中45件（27%）が予算超過していた。
  レイアウトの`template`（`| アニメ視聴ガイド`＝幅9.5）が自動で足されることを勘定に
  入れること。予算を超えるときは**ブランド名を先に落とす**（`fitPageTitle`が自動でやる）。
- **【基本ルール】ISRの再検証間隔と、それを叩く巡回の間隔はセットで決める（2026-08-25導入・重大度最高）**:
  2026-08-24にVercel Hobbyの利用上限（ISR Writes・Fluid Active CPU・Fluid Provisioned Memory）を
  超過し、**本番サイトが全ルートHTTP 402で丸一日以上停止した**。原因は「アクセスが多すぎた」ことでは
  なく（Function Invocations・Edge Requests・ISR Readsは全て上限内だった）、**同じ内容のページを
  何度も作り直していた**こと。外してはいけない点が4つある。
  ①**巡回の間隔が再検証の間隔より長いと、その巡回は「温め」ではなく「強制的な書き直し」になる**。
  `warm-cache.yml`が毎時なのにページの`revalidate`が900秒だったため、巡回は毎回キャッシュ期限切れに
  当たり67ページを確実に再生成していた（30日で約46,000 ISR Writes＝全体の16%）。
  ②**Vercelはデプロイごとに独立したISRキャッシュを持つ**＝mainへのpushは実質キャッシュ全消去。
  表示に使わないデータ（`content/analytics/`・`content/coverage/`）のコミットでデプロイを
  起こさないよう`vercel.json`の`ignoreCommand`で門番する。**この設定を消さないこと。**
  ③**sitemapにページを増やすときは1ページあたりの再検証頻度も見直す**（面の数×再生成頻度で効く）。
  8月上旬に約7,051ページを開放したのに`revalidate`が据え置きだったのが利用量急増の主因。
  ④**I/O待ちはActive CPUには出ないがProvisioned Memoryには出る**（メモリ課金は待機中も止まらない）。
  全リクエストで走る処理（`middleware.ts`）に外部への往復を置かない。認証Cookieの無いリクエストは
  `hasAuthCookie`で素通しする。経緯は`docs/operations.md`の㉝。
- **【基本ルール】revalidateを変えたら必ずビルドして実効値を確かめる（2026-08-25導入）**:
  App Routerの実効revalidateは「ページの`export const revalidate`」と「描画中に走る
  fetch／`unstable_cache`のTTL」の**低いほう**になる。ページ側だけ延ばしても、`lib/annict.ts`の
  `next.revalidate`や`lib/getSeasonData.ts`の`CURRENT_YEAR_REVALIDATE`が短いままだと**まったく効かない**。
  実際、2026-08-25にページ側を3600へ延ばしたのに実効値は900のままだった。
  確認方法は`npm run build`のあと`.next/prerender-manifest.json`の`initialRevalidateSeconds`を読む
  （画面を見ても分からない）。
- 配信網羅率は Annict のコミュニティ更新依存で100%ではない。新作は配信欄が空になりうる。
  「配信情報なし」は仕様であり、勝手に推測データで埋めない。
- `content/works/` のあらすじ・見どころ・出版社も同様に、公式サイト等の一次情報で確認できた
  事実だけを書く（創作しない）。未整備の作品はファイルを作らず省略表示に任せる。
  進め方は `docs/operations.md` の「⑧作品詳細コンテンツの追記」を参照。
- 返答は日本語で。

## ネットワークの注意（サンドボックス等で動かす場合）
- 通信先 `api.annict.com`（GraphQL）と、サムネイル画像のCDNドメインへの外向き通信が必要。
