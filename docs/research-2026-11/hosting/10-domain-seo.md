# 独自ドメインの費用と vercel.app からの移転（調査役・Haiku・2026-11-08）

## 費用（USD/年。表示日が不明なものが多く要再確認）
- .com: Porkbun $11.81（初年・更新同額）[8]。Cloudflare 約$10.44〜10.46（第三者比較。公式価格表では未確認）[7][10]
- .net: Porkbun $12.52 [8]、Cloudflare 約$11.86（第三者）[10]
- .app: Porkbun 初年$8.75（セール）→更新$14.93。 .dev: 初年$8.75→更新$12.87 [8]
- .jp: Xserver（2024-10-16掲載）で更新 日本語1,298円／ローマ字3,102円 [9]
- WHOIS代理公開: Porkbun 無料 [8]。Cloudflare は原価＝上乗せなし [7]
- 更新額で比べる（初年の安値に釣られない）

## Google の移転手順（公式）
- 301/308 の恒久リダイレクト、チェーンは短く [1]。維持期間は「可能な限り最低1年」[1] と「最低180日」[2] が併記＝1年を基準に。
- アドレス変更ツールはドメインまたはサブドメイン単位（パス単位は不可）[2]。xxx.vercel.app から使えるかは未確認（調査役はドメインプロパティを作れないので使えない可能性と推測）。
- 旧新の全バリアントを Search Console で確認 [1]。順位回復は中規模サイトで「数週間以上」、期限の明記なし [1]。

## vercel.app と PSL
- Vercel公式KBは vercel.app が PSL に載っていると明記（Cookie を親ドメインに置けない理由）[5]。PSL は Cookie 境界の仕組みで検索順位の仕組みではない（推測を含む）[6]。

## Vercel Hobby
- 独自ドメインは無料で追加可能、1プロジェクト50件まで [3]。旧URL→新URL は Domains の Redirect to で設定 [4]（第三者記事では vercel.app 自体も転送可 [11]）。

## 移転タイミング
- 「小さいうちに移るほど損が少ない」という根拠は見つからず＝未確認。

## 出典
1. https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes
2. https://support.google.com/webmasters/answer/9370220
3. https://vercel.com/docs/domains/working-with-domains/add-a-domain
4. https://vercel.com/docs/domains/working-with-domains/deploying-and-redirecting
5. https://vercel.com/kb/guide/can-i-set-a-cookie-from-my-vercel-project-subdomain-to-vercel-app（抜粋）
6. https://publicsuffix.org/list/
7. https://www.cloudflare.com/products/registrar/
8. https://porkbun.com/products/domains
9. https://www.xserver.ne.jp/domain/
10. https://domainoffer.net/tld/net/cloudflare
11. https://johnkavanagh.co.uk/articles/redirect-a-default-vercel-subdomain-to-your-custom-domain/
