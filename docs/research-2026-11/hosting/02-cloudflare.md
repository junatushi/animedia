# Cloudflare Workers / OpenNext（調査役・Sonnet・2026-11-08）
※公式ページは WebFetch の要約結果で、一部は原文そのものではない。

## 結論
- Workers Free は不成立のまま（CPU 10ms/リクエスト、実測120ms）。
- Paid $5 なら技術的には載りうる。ただし課金の上限なし。OpenNext の未検証点が3つ（edge runtime、next/og、事前生成の成果物）。
- 商用利用（アフィリエイト・広告）は規約上、禁止条項なし。

## 1. Workers の上限と単価（公式）[1][2]
- Free: 10万req/日、CPU 10ms/req、Cron 5本、サブリクエスト50/req、静的アセット2万ファイル。超過は止まる（1027・1102）。
- Paid: 月$5。1,000万req・CPU 3,000万msを含む。超過 $0.30/百万req、$0.02/百万CPU ms。CPU上限は既定30秒（最大5分）。静的アセット10万ファイル、サブリクエスト1万/req、Cron 250本。静的アセット配信は無料・無制限、egress課金なし。
- サイズ: 上限は非圧縮64MiB（Free/Paid共通）と limits ページ。OpenNext 公式は「圧縮3MiB/10MiB」と旧記述＝矛盾、実ビルドで確認が要る。[1][3]
- 支出ハードキャップ: Workers には確認できず（公式の支出上限は2026-06-05の AI Gateway のみ）。暴走対策は CPU 上限設定＋WAF＋キャッシュで組む。[2][4]

## 2. @opennextjs/cloudflare（Next.js 16）[3][5][6]
- Next 16 の全 minor、15・14 の最新 minor に対応（公式）。最新 1.20.15（2026-10-30、検索抜粋）。
- ISR、middleware、`after`、'use cache' に対応。revalidateTag/revalidatePath は対応（tag cache が要る）。Node middleware は未対応。
- incremental cache は R2 推奨（KV は非推奨）。tag cache は D1 または Durable Objects。時間ベース再検証は DO のキューが要る。
- キャッシュ自動パージはゾーン（独自ドメイン）でのみ動く（workers.dev 不可）。
- runtime=edge は未対応（宣言を外す。外した後の /api/sns-image・OG画像の動作は未検証）。next/og は公式の確認なし（第三者事例: ビルド時にPNG化した例）。[8][10]
- x-vercel-cache が無くなる → warm-revalidated.sh 等は cf-cache-status 等へ作り替え（推測）。
- 数千ページの事前生成の実績記述は見つからず（未確認）。.html と .rsc の2本立てでファイル数が膨らむ（推測）。

## 3. 無料枠 [7]
- R2: 10GB、書込100万/月、読取1,000万/月（egress無料）。KV: 書込1,000/日（ISRには不足）。D1: 読取500万/日、書込10万/日、5GB。DO: SQLite版のみ無料（10万req/日）。
- ISR Writes 26.1万単位/30日 ≒ 8.7千/日は R2 の書込100万/月に収まる見込み（推測）。

## 4. 商用利用（原文: cloudflare.com/terms）[11][12]
- 無料/有料で商用利用を区別する条項は見当たらない。無料サービスはクレジットカード情報の処理・収集禁止（2.2.1(h)）、動画・大容量ファイル配信はCDN特約で制限されうる、無料サービスは終了されうる（2.6）。Workers/Pages専用の特約は未確認。

## 5. Free のセキュリティ [13]〜[16]
- WAF は Free Managed Ruleset のみ（OWASP等は有料）。カスタムルール5本、レート制限1本（10秒窓・IPのみ）。Bot Fight Mode 可。Turnstile 可。DDoS は取得ページで未確認。

## 6. Paid $5 の試算（推測）
- リクエスト約14.4万/月＝含み枠の1.4%。CPU 120ms×14.4万＝1,728万ms＝含み枠の58% → 月$5のまま。ピーク395msでも超過約$0.5。
- ボットが3,000万req/月に増えても超過は約$6。キャッシュ設計に失敗すると CPU が膨らむので WAF での上限が必須。

## 出典
1. https://developers.cloudflare.com/workers/platform/limits/
2. https://developers.cloudflare.com/workers/platform/pricing/
3. https://opennext.js.org/cloudflare
4. https://developers.cloudflare.com/changelog/post/2026-06-05-spend-limits/
5. https://opennext.js.org/cloudflare/caching
6. https://opennext.js.org/cloudflare/get-started
7. https://developers.cloudflare.com/r2/pricing/ ／ /d1/platform/pricing/ ／ /durable-objects/platform/pricing/ ／ /kv/platform/pricing/
8. https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
9. https://github.com/opennextjs/opennextjs-cloudflare/releases/tag/@opennextjs%2Fcloudflare@1.20.15（検索抜粋）
10. https://github.com/happyhqdotcom/docs/pull/8（第三者・検索抜粋）
11. https://www.cloudflare.com/terms/
12. https://www.cloudflare.com/service-specific-terms-application-services/
13. https://developers.cloudflare.com/waf/managed-rules/
14. https://developers.cloudflare.com/waf/custom-rules/
15. https://developers.cloudflare.com/waf/rate-limiting-rules/
16. https://developers.cloudflare.com/turnstile/plans/ ／ https://developers.cloudflare.com/bots/get-started/bot-fight-mode/
