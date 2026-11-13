# リポジトリから見た移行の作業量（調査役・Sonnet・読み取りのみ・2026-11-08）

## 結論
- 総合最小は (iv) VPS、次いで (i) CF Workers。(ii) 静的出力は L〜XL、(iii) Deno Deploy は (i) より劣る（推測）。
- 本体コードのVercel固有は薄い。重いのは検査・運用スクリプト（約9,600行の check.ts を含む）と「画面に出ない門番」の作り直し。

## 1. Vercel固有の棚卸し
- vercel.json 5行: `regions:["hnd1"]`、`ignoreCommand`（preview停止＋content/analytics等除外の門番）。
- `@vercel/analytics`: package.json:19、app/layout.tsx、components/WebVitals.tsx、lib/logEvent.ts。
- `x-vercel-cache`／`VERCEL_*` を見るもの: scripts/warm-revalidated.sh:133-150、scripts/check-warm-revalidated.js、scripts/lib/measure-page.js:116-132、scripts/speed-report.js、scripts/check-speed-report.js、scripts/check-build-size.js（Hobby 10GB・保持日数の式）、.github/workflows/revalidate.yml、warm-cache.yml。
- 利用量系: scripts/fetch-vercel-usage.js、usage-report.js、check-vercel-usage.js、vercel-usage.yml（Hobbyでは元データが取れず休眠）。
- scripts/check.ts（9,576行）に Vercel前提の節が多数（ignoreCommand、プレビュー停止、ISR頻度、prerender-manifest、vercel.app ハードコード）。
- docs/security.md 内の Vercel Firewall 前提は6箇所。

## 2. 実行時機能
- edge runtime: app/opengraph-image.tsx:7、app/apple-icon.tsx:5、app/api/sns-image/route.tsx:28（app/anime/[id]/opengraph-image.tsx も edge 前提）。
- route handler 20本（api/{admin/analytics, discord, notify, notify/run, notify/unsubscribe, revalidate, search-index, season, service-additions, service-additions/run, services, sns-image, track, watched, work/[id]}、auth/callback、calendar.ics、embed/anime/[id]、feed.xml、llms.txt）。
- ページ種別13。`revalidateTag`／`revalidatePath`: app/api/revalidate/route.ts:132-145（`{expire:0}`）。`unstable_cache`: lib/getSeasonData.ts:150。`revalidate/dynamic` 指定は約23箇所。
- middleware.ts 155行（308、Server Actions／POST拒否、embed不正ID、認証Cookie判定）。cookies は lib/supabase/server.ts のみ。
- content/ は実行時に fs で読まず `import()`（lib/getSeasonData.ts:194、lib/getWorkData.ts:126）＝サーバーバンドルに入る。

## 3. 静的出力で作り替えが要る箇所
- route handler の大半、middleware、ISR、revalidate*、unstable_cache が使えない。
- 動的にしか成立しない: /api/track、/api/discord、/api/revalidate、/api/notify*、/api/service-additions*、Supabaseログイン・auth/callback、admin、/api/watched、/api/season・/api/work（クエリ分岐）、sns-image・OG画像、middlewareの防壁。
- 今期のライブ取得は毎ビルドになり、鮮度が日次ビルド頼みになる。

## 4. 規模
- content/ 19MB（snapshots 11MB・64ファイル、works 0.7MB、archive: index 66KB・people 1.3MB・studios 148KB）、public/works 6.3MB、手元の .next 1.1GB。
- Worker上限（推測）: snapshots は import() でバンドルされ、JSON 11MB は gzip で数MB見込み＝無料3MB・有料10MBの境界に近い。R2/KVへの外出しが要る可能性が高い。

## 5. 候補別の作業量
- (i) CF Workers + OpenNext: L（ISR/タグをR2/KV/DOへ、edge撤去、snapshots外出し、ignoreCommand相当、x-vercel-cache→cf-cache-status 等）。
- (ii) 静的出力: XL（実質、設計の作り直し）。
- (iii) Deno Deploy: L〜XL（推測）。
- (iv) VPS で next start: M（単一インスタンス前提。Analytics代替、温め検査、usage系廃止、デプロイCI新設、TLS・監視の自前化）。
- 共通の「画面に出ない」危険: 温め確認の判定ヘッダ、ignoreCommand相当の門番、check.ts が緑のまま無意味化、ワークフローのBASE URL。

## 6. ドメイン変更の書き換え箇所
- `animedia-khaki.vercel.app` は lib/siteUrl.ts:3 以外にも scripts 約17箇所・check.ts・workflows 4本にハードコード（多くは環境変数で上書き可だが既定値が旧URL）。
- 独自ドメインへの移行はホスティング移行と独立して先にやれる（S〜M）。
