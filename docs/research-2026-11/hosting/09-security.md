# Next.js 脆弱性・サポート期間・ホスティング別の守り（調査役・Sonnet・2026-11-08）
【原文】WebFetchで原文 /【抜粋】検索抜粋のみ /【推測】

## 1. サポート期間【原文・公式】[1]
- 16.x: Active LTS（2025-10-21〜）。 15.x: Maintenance LTS、セキュリティ修正は2027-01-31まで（当初2026-10-21から延長）。 14.x以前: Unsupported（「重大度次第でまれにパッチ」）。
- 本番の14は既に対象外。16.4.5 ブランチはサポート内。

## 2. 主な脆弱性
- CVE-2025-29927（middleware認可バイパス、2025-03）【抜粋】: 14.2.25で修正。[13]
- CVE-2025-55182/66478（React2Shell、CVSS 10.0、RCE、2025-12-03）【原文】: 影響は15.x・16.x（App Router）と14.3.0-canary.77以降。13.x と 14.x stable は影響なし。[2]
- 2025-12-11 の追加2件（CVE-2025-55184/55183）: 14系への影響は未確認。
- 2026-05-07 Next.js May 2026 Security Release（13件）【原文・Vercel】: 13.x/14.x にパッチなし（修正は15.5.18/16.2.6）。高: middleware/proxy 認可バイパス4件、RSC DoS（前提は Server Functions）、SSRF（WebSocket upgrade）。中以下: キャッシュポイズニング、XSS、画像最適化DoS。[3][12]
- 見立て【推測】: Server Actions 不使用・next/image 不使用で一部は前提が薄い。「POST拒否」は GET 経路の認可バイパス系を防がない。14据え置きの根拠は2026-05以降ほぼ無い。

## 3. 基盤側の緩和
- Vercel【原文】: React2Shell は公開前に WAF ルールを全利用者へ配布、脆弱版の新規デプロイをブロック、警告バナー。2026-05 は「WAFでは確実に防げない」としてルール配布なし＝パッチ必須。[3][4]
- Cloudflare【抜粋】: 2025-12-03 に Free Managed Ruleset にも既定 Block ルール。Workers は「本質的に影響なし」と記載。[6]
- Netlify【原文】: 2026-05 は 13.x/14.x にパッチなし、バイパス系は影響あり。[5]
- Deno Deploy: 対応実例は未確認。 VPS自前: 利用者が自力で更新・遮断・鍵ローテーション。

## 4. denial-of-wallet 対策
- Vercel Hobby: Spend Management は Pro/Enterprise 限定。Hobby は無料枠超過で停止。Pro は上限到達で本番を自動 pause 可（数分遅れ）。[7]
- Cloudflare Workers Free: 1日10万リクエストで Error 1027、課金は発生しない。[11]
- Netlify Free: 月300クレジットのハードリミット、自動課金なし。[9]
- Cloud Run: `--max-instances` が主な上限、予算アラートは通知のみ。 VPS: 固定費。

## 5. DDoS・ボット対策
- Vercel: L3/4/7 の DDoS 緩和が全プラン、遮断分は課金されない、Attack Mode も全プラン無料。[8]
- Cloudflare: HTTP DDoS（L3-7）が Free でも無制限、Free Managed Ruleset あり。[10]

## 6. 優先順位の提言（調査役）
1. Next.js を 16.2.6 以上へ更新（サポート外の14は2026-05の13件に無防備）
2. 更新後に middleware の拒否条件を再確認。認可は middleware に頼らずページ側で確認
3. 無料枠超過＝停止を前提に Firewall の無料機能を準備し、ISR Writes 増を事前に実測
4. 移行するなら課金事故に強い先を（Cloudflare Free は上限超過で停止のみ。ただし CPU 10ms で本サイトは不成立）
5. 秘密情報のローテーション手順を用意

## 出典
1. https://nextjs.org/support-policy
2. https://nextjs.org/blog/CVE-2025-66478
3. https://vercel.com/changelog/next-js-may-2026-security-release
4. https://vercel.com/kb/bulletin/react2shell
5. https://www.netlify.com/changelog/2026-05-08-react-nextjs-security-vulnerabilities.md
6. https://blog.cloudflare.com/waf-rules-react-vulnerability/（抜粋）
7. https://vercel.com/docs/spend-management
8. https://vercel.com/docs/vercel-firewall/ddos-mitigation
9. https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
10. https://developers.cloudflare.com/ddos-protection/
11. https://developers.cloudflare.com/workers/platform/limits（抜粋）
12. https://lilting.ch/en/articles/nextjs-security-release-16-2-6-15-5-18（第三者・抜粋）
13. https://github.com/aydinnyunus/CVE-2025-29927（第三者・抜粋）
