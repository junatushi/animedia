# 手元のビルド成果物の実測（監督役・2026-11-08）

対象: 作業ブランチ（Next.js 16.4.5）の `npm run build` 成果物（2026-11-06 12:48 UTC、BUILD_ID UaFfxW7WitwMxroS2_X19）。
数え方: `.next/prerender-manifest.json` と `.next/server/app` 以下のファイルを走査（node で集計）。

- 事前生成ルート: 4,968（prerender-manifest の routes）、動的ルート 8
- `.next/server/app` のファイル数: 30,093、合計 771MB
  - .html 4,962件 335MB
  - `.segments/` 内の .rsc 14,886件 284MB（1ページあたり約3ファイル）
  - ページの .rsc 4,962件 143MB
  - .meta 4,968件 6MB
- `.segments/` のぶんは html＋rsc（478MB）に対して約+59%のバイト。ISR Writes が「約1.7倍」という見積もりと同じ桁。

## ここから言えること
- 静的ファイルで配る案（完全静的化や Workers の静的アセット）は、**このままではファイル数が約3万**で、Cloudflare Free・Pages Free の上限2万を超える（Paid の10万には収まる）。
- OpenNext で R2 にキャッシュを置く場合、デプロイのたびに事前生成ぶんを書き込むと、オブジェクト数・保存量（1回あたり約0.8GB）がデプロイ回数に比例して増える（推測。OpenNext がルート単位で1オブジェクトにまとめるかは未確認）。
- Vercel Hobby の Deployment Storage 7.31GB は、保持6件 × 1件あたり約1.2GB（成果物全体）と整合する（推測）。
