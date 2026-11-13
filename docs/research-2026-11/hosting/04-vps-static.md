# VPS と完全静的化（調査役・Sonnet・2026-11-08）
区分: 【公式】原文をWebFetchで確認 /【第三者】/【推測】/【未確認】

## (A) VPS
- さくらのVPS【公式】[1]（転送無制限、100Mbps共有、SLAなし）: 512MB・1コア・25GB 月643円（石狩）〜698円（東京）、12か月前払いで月590〜641円。1GB・2コア・50GB 月880円（石狩）〜990円（東京）、12か月前払いで月807〜908円。
- Xserver VPS 2GB は「830円〜/月」【第三者】[2]。ConoHa は公式403で現行の1,000円以内プラン【未確認】。KAGOYA・Indigo・ABLENET は未調査。
- 1GB機での `next build` の成否は【未確認】。公式のメモリ削減策あり【公式】[3]。現実解は GitHub Actions でビルドして standalone 成果物だけを送る【推測】。`preloadEntriesOnStart:false` で起動時メモリを抑えられる【公式】[3]。
- 自前ISR【公式】[4]: 既定はローカルディスクのキャッシュ。単一インスタンス＋永続ディスクなら追加設定なしで動く。revalidateTag はそのインスタンスだけを無効化（複数台なら共有ストアが要る）。前段にリバースプロキシ推奨。
- Coolify 等は2GB/2vCPU以上が目安【第三者】[5]。
- Cloudflare 無料プロキシを前段に置くこと自体は可。動画・大容量ファイル中心の配信は制限されうる【公式】[6][7]。
- 保守負担の第三者実測値は見つからず【未確認】。Hetzner＋Coolifyで侵害された事例あり（SSH鍵認証・パスワード認証無効化が必要）【第三者】[5]。OSパッチ・Next.js脆弱性対応・監視・復旧が全部運営者側【推測】。

## (B) 完全静的化
- `output:'export'` で使えない【公式・2026-08-09更新】[8]: ISR、Proxy（旧middleware）、Cookies、Server Actions、Draft Mode、Rewrites/Redirects/Headers、既定の画像最適化、Intercepting Routes、`dynamicParams:true`、generateStaticParams の無い動的ルート、Request依存の Route Handler。GET の Route Handler は `dynamic='force-static'` で静的化できる。
- Cloudflare Workers 静的アセット【公式】[9][10]: 配信は無料・無制限。1バージョンの上限は Free 20,000 / Paid 100,000 ファイル、1ファイル25MiB。HTML＋.rsc でファイル数が2万を超える可能性が高い【推測・未計測】。
- Cloudflare Pages Free【公式】[11]: 20,000ファイル、ビルド月500回。
- GitHub Pages【公式】[12][13]: 「オンラインビジネスを運営する無料ホスティング」としての利用は不可、「主に商取引またはSaaS」も不可。寄付ボタン等は可。アフィリエイト・広告はグレー以上【推測】。
- 動的部分の逃がし先: Workers Free（10万req/日・CPU 10ms・超過は1027）【公式】[10]、Supabase Edge Functions Free（CPU 2秒/req）【公式】[15]。/api/discord の ed25519 検証が10msに収まるかは【未確認】。
- 静的化すると今期の鮮度は再ビルド頻度が上限になる。

## 出典
1. https://vps.sakura.ad.jp/specification/
2. https://atsoho.com/apps/compare/conoha-vps-vs-xserver（第三者・抜粋）
3. https://nextjs.org/docs/app/guides/memory-usage
4. https://nextjs.org/docs/app/guides/self-hosting
5. https://blog.jakesaunders.dev/self-host-coolify-on-hetzner/ ／ https://noqta.tn/en/tutorials/coolify-v4-self-hosted-deployment-nextjs-2026（第三者・抜粋）
6. https://www.cloudflare.com/service-specific-terms-application-services/
7. https://blog.cloudflare.com/updated-tos/（抜粋）
8. https://nextjs.org/docs/app/guides/static-exports
9. https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
10. https://developers.cloudflare.com/workers/platform/limits/
11. https://developers.cloudflare.com/pages/platform/limits/
12. https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
13. https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features
14. https://www.netlify.com/pricing/
15. https://supabase.com/docs/guides/functions/limits
