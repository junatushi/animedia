# Vercel Hobby / Pro（調査役・Sonnet・2026-11-08）
vercel.com/docs を WebFetch で原文確認（最終更新2026-08〜09）。一部は WebSearch 抜粋のみ。

## 1. Hobby の上限と超過時
- 公式 Hobby 表: Fast Data Transfer 100GB、Fast Origin Transfer 10GB、CDN Requests 100万、Active CPU 4h、Provisioned Memory 360GB-hr、Function Invocations 100万、Deployment Storage 10GB。[1][2]
- ISR Reads/Writes の Hobby 無料枠は docs の表に載っていない（ダッシュボードの200Kは文書で裏取りできず・未確認）。
- 超過時（公式）: 「30日経つまで再利用不可」。猶予や3倍枠の記載なし。一時停止後は 503 DEPLOYMENT_PAUSED、再開はプロジェクトごとに手動。[2][3]（2026-08-24の402は文書に記載なし＝実績として扱う）
- 2026-09-16の変更（公式）: Hobby は各プロジェクトで直近の本番3件と直近3件のデプロイだけ保持。Storage 10GB 超過時は即時削除。[4]
- 非商用のみ。1日のデプロイは Hobby 100 / Pro 6,000。[2]

## 2. 「商用」の定義（公式 Fair Use、2026-09-14更新）[2]
- プロジェクト制作に関わる誰かの金銭的利益を目的とする Deployment。例: 支払いの要求・処理、有償での制作・運用、「主目的がアフィリエイトリンク」のサイト、AdSense 等の広告の掲載。
- 「Asking for Donations does not fall under commercial usage」と明記。2026年に条件を緩める改定は確認できず。

## 3. Pro の料金と試算
- $20/月で席1つと$20の使用クレジット（月末失効）。Flat Rate CDN として100万リクエストと1TB。[5]
- hnd1 の従量単価（公式）: ISR Writes $5.20/百万、ISR Reads $0.52/百万、Active CPU $0.202/h、Provisioned Memory $0.0167/GB-hr、Fast Origin Transfer $0.27/GB、Fast Data Transfer $0.16/GB、CDN Requests $2.60/百万。[6] Deployment Storage $0.10/GB月。[4]
- Spend Management（Pro）: 既定は$200の通知のみ。「Pause Production Deployments」は自分で有効化、停止は数分遅れ、ストレージ課金は止まらない。[7]
- 試算（推測）: ISR Writes 261K×1.7≒44万→約$2.3、Active CPU 3.6h→約$0.7、FOT 4.5GB→約$1.2、Storage 7.3GB→約$0.7 ＝ 約$5（クレジット内）。月額は$20でほぼ固定＝約¥2,800〜3,200。
- 消費税: 2026-04-01から登録のある法域で徴収。日本の扱いは未確認（課税なら約¥3,300）。[8]
- 予算¥1,000では Pro の基本料金が収まらない。

## 4. Firewall（公式）[9][10]
- Hobby / Pro: カスタムルール 3 / 40、IPブロック 10 / 40、レート制限ルール 1（Hobbyは3本のうち1） / 40。窓10秒〜10分、キーは IP か JA4。Hobby のレート制限は許可100万まで無料、Pro は従量（$0.65/百万、hnd1）。永続アクションは Pro のみ。DDoS 緩和は両方で既定オン。Bot Protection の差は未確認。

## 5. Vercel 上のセキュリティ上の利点
- CVE-2025-29927: Vercel ホスト分は影響なし（二次報道）。
- React2Shell（CVE-2025-55182）: 公表前に全ユーザーへ WAF ルールを配布、実行時の緩和層がトラフィックの96%をカバー、数週間で600万件超をブロック。WAFは完全防御ではない（Vercel自身）。[11]

## 出典
1. https://vercel.com/docs/plans/hobby
2. https://vercel.com/docs/limits/fair-use-guidelines
3. https://vercel.com/kb/guide/why-is-my-account-deployment-blocked
4. https://vercel.com/changelog/hobby-projects-now-retain-fewer-deployments-to-free-up-storage
5. https://vercel.com/docs/plans/pro-plan
6. https://vercel.com/docs/pricing/regional-pricing/hnd1
7. https://vercel.com/docs/spend-management
8. https://vercel.com/docs/pricing/taxes
9. https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
10. https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules
11. https://vercel.com/kb/bulletin/react2shell
12. https://vercel.com/docs/incremental-static-regeneration/limits-and-pricing
