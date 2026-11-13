# Deno Deploy・Netlify・Cloud Run ほか（調査役・Sonnet・2026-11-08）
注意: WebFetchは要約経由で逐語引用は取れず、規約の商用可否は原文で確認できていない。

## 1. Deno Deploy
- 料金（公式 pricing、2026-11-08）: Free $0＝リクエスト1M/月・送信20GiB・Active CPU 10h・メモリ150GiB-h・保存10GiB。Pro $20/月＝5M・200GiB・CPU 50h・750GiB-h・50GiB（超過単価あり）。[1]
- このサイトでの比率（推測）: リクエスト約144K（約14%）、CPU 3.6h（約36%）。ISR書き込みの扱いは未確認。
- 超過時: 料金ページに記載なし。docsに「ハード上限・アラートを課金画面で設定可」（Pro文脈か）。無料超過で停止するかは未確認。[2]
- 商用可否: 規約は「internal business purposes」での利用を許諾、競合製品の構築は禁止。個人サイトの商用利用の記載はなく未確認。要書面確認。[3]
- Next.js: frameworks文書に ISR・SSG・SSR・PPR・"use cache" 対応と記載。revalidateTag/revalidatePath、middleware、next/og、edge runtime は記載なし＝未確認。Next 16明記なし。第三者報告に `expireTags is not a function`（Next 16の `revalidateTag(…,{expire:0})` が動かない可能性）。[4][5]
- 東京リージョン: 掲載ありの抜粋と、2025年に廃止との第三者記事が矛盾。要確認。[6]
- 判定: 利用量は収まる見込み／商用可否は未確認／移行難度は高。

## 2. Netlify
- Free 300クレジット/月、Personal $9/月で1,000。本番デプロイ15/回、帯域20/GB、コンピュート10/GB-h。[7]
- 試算（推測）: デプロイ34回×15=510で Free を単独超過。Personalでも境界。
- 判定: Free不成立、Personal($9)も境界。

## 3. Firebase App Hosting / Cloud Run
- Blaze（従量課金）必須。無料枠: Cloud Run 180k vCPU秒・360k GiB秒・2Mリクエスト、送信10GiB、Cloud Build 2,500分 等。[8]
- 上限: 予算アラート推奨。App Hostingのスペンドキャップはハード上限ではない（第三者・未確認）。
- このサイト（推測）: CPU・リクエストは無料枠内。ISRのキャッシュ共有・コールドスタート・東京の無料枠適用は未確認。
- 判定: コストは収まる見込み／商用可（一般論）／移行難度は中〜高。

## 4. その他PaaS（第三者のみ、公式未確認）
- Render Starter $7/月（スリープなし）、Railway Hobby $5/月（従量）、Koyeb 無料1アプリ/有料$5〜、Zeabur Developer $5/月。商用可否は未確認。
- 常駐Node（next start）なら ISR・revalidateTag・middleware・next/og は原則そのまま動く（推測・1インスタンス前提）。[9]

## 出典
1. https://deno.com/deploy/pricing
2. https://docs.deno.com/deploy/usage/
3. https://docs.deno.com/deploy/terms_and_conditions/
4. https://docs.deno.com/deploy/reference/frameworks/
5. https://questions.deno.com/m/1426649576986640384
6. https://docs.deno.com/deploy/manual/regions
7. https://www.netlify.com/pricing/
8. https://firebase.google.com/docs/app-hosting/costs
9. https://dev.to/devtoolpicks/railway-vs-render-vs-flyio-for-solo-developers-in-2026-5ddf
10. https://docs.deno.com/deploy/acceptable_use_policy/
