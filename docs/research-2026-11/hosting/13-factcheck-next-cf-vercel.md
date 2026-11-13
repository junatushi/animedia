# 裏取り: Next.js の .segments・Workers のサイズ・消費税・Hobby の停止条件（裏取り役・Sonnet＋監督役・2026-11-08）

## 1. `.segments/` は止められるか
- Next.js 16.4.5（手元の node_modules を読み取り）: `config-shared.js`・`config-schema.js` に `clientSegmentCache` が無い。`app-render.js`（6045・6385行）は `collectSegmentData(...)` を条件なしで呼ぶ。コメントは「All of the segments for a page are generated simultaneously, including during revalidations」。`file-system-cache.js` は `segmentData` があれば `.segments/` へ書く。止める設定は見つからず（公式docs・discussionにも記述なし）。
- **Next.js 15.5.29（npm pack で取得したソース）**: `collectSegmentData` は呼び出し側では `shouldGenerateStaticFlightData`（事前生成のとき真）でしか守られていないが、**関数の中（2929〜2938行）で `renderOpts.experimental.clientSegmentCache !== true` なら何もせず戻る**。既定は `clientSegmentCache: false`（config-shared.js 149行）。＝**15.5 は既定で `.segments` を書かない**見込み（実ビルドでは未確認）。
  - 【訂正】監督役は最初「15.5 でも書く」と読んだが、関数内の早期 return を見落としていた。反証役（Opus）の指摘で読み直して訂正。
  - 反証役が使い捨てのロックファイルで `npm audit` を回した結果: next@15.5.29 本体への勧告は無し。15.x のセキュリティ修正は 2027-01-31 まで（nextjs.org/support-policy）。
- `experimental.prefetchInlining`（既定 true）は実在するが、collect の呼び出し条件には使われていない（false にしても消えないと推測・未検証）。

## 2. Workers のスクリプトサイズ上限
- 公式（原文）limits（2026-10-29更新）: Free・Paid とも **64 MiB（非圧縮）**、「There is no compressed size limit.」
- 公式 changelog 2026-09-04「increased worker size limit」で圧縮上限（Free 3MB / Paid 10MB）を撤廃。opennext.js.org の「3MiB/10MiB」は追随していない古い記述。
- OpenNext docs: Edge ランタイムは全機能に対応せず Node.js ランタイム推奨。`next/og` の記述なし。第三者1件: ImageResponse のルートが Cloudflare で動かずビルド時に PNG 化して回避。

## 3. Cloudflare の日本向け消費税（JCT）
- 未確認（課税ページ404）。請求通貨も未確認。

## 4. Vercel Hobby の ISR Writes と停止条件
- Hobby の Included Usage 表・limits・ISR・fair-use のどこにも ISR Writes 200K/月の数値は無い（ダッシュボードだけの表示）。
- 公式（原文）Hobby: 「if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again」（Web Analytics は7日）。
- 公式（原文）KB: 「sustained usage past these limits can lead to a paused deployment」、停止時は `503 DEPLOYMENT_PAUSED`。
- 公式（原文）fair-use: 「We will notify you if your usage is an outlier」「reach out before taking action」。猶予・倍率の記述は無し。
- 公式（原文）ISR: 書き込みは8KB単位。再生成で内容が変わらなければ write unit は発生しない。

## 出典
- https://nextjs.org/blog/next-16 ／ https://nextjs.org/blog/next-15-5 ／ https://nextjs.org/docs/app/guides/prefetching
- https://github.com/opennextjs/opennextjs-aws/issues/1212
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/
- https://opennext.js.org/cloudflare ／ https://opennext.js.org/cloudflare/known-issues
- https://github.com/cloudflare/cloudflare-docs/pull/31067
- https://dev.classmethod.jp/articles/cloudflare-workers-64mib-size-limit/
- https://github.com/happyhqdotcom/docs/pull/8
- https://vercel.com/docs/plans/hobby ／ https://vercel.com/docs/limits ／ https://vercel.com/docs/limits/fair-use-guidelines
- https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing
- https://vercel.com/kb/guide/why-is-my-account-deployment-blocked
- ローカル: node_modules/next（16.4.5）の dist/server/app-render/app-render.js・lib/incremental-cache/file-system-cache.js・config-schema.js
- npm: next@15.5.29 の dist/server/app-render/app-render.js（1934行 shouldGenerateStaticFlightData、2421・2580・2728・2836行 collectSegmentData）・config-shared.js（149行 clientSegmentCache: false）
