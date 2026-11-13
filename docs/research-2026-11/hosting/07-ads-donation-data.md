# 広告・寄付・データ提供（調査役・Sonnet・2026-11-08）

## 結論
- 広告は Vercel Hobby 不可が先に効く。仮に可でも月収は数百円規模で運営費(1,000円)を賄えない。
- 寄付も実例データは見つからず、見込み額は「未確認」。
- データ提供(B2B)は市場の価格情報が無く、Annict 由来データの権利が未解決のため現時点で見込み額を置けない。
- 注意: 検索ツールは抜粋のみ。公式ページの原文を読めたのは AdSense の資格ページ1件だけ。他はすべて検索抜粋の二次情報。

## 1. Google AdSense
- 資格要件(公式・原文確認): 自分のコンテンツがあり、高品質・独創的で、読者がつくこと。HTMLソースにアクセスできること。18歳以上。 [1]
- 同ページは独自ドメインの要否もサブドメイン可否も書いていない。別ページ「Owning the site…」に分かれているが、そこは未確認。 [1]
- vercel.app が通らないという個人の報告はある(第三者)。筆者自身も「公式ルールとして見つからない」と認めている。 [2]
- 日本の解説では、初期登録でサブドメインのURLを入れるとエラーになる点は確認できる。ただし通す方法もあると書かれ、手順は途切れている。 [3]
- 結論は「独自ドメインが安全(第三者の見立て)」。公式の確定情報は未確認。
- 日本語記事の RPM 目安: 個人ブログ 200〜400円、特化型 600〜1,200円(2026年、一運営者の見解で統計の裏付けなし)。 [4]
- 月収の試算(推測): PV 619/月 × RPM で、悲観 約60円(RPM 100円)、中央 約190円(300円)、楽観 約370円(600円)。表示数の少なさから、実際は審査落ちの可能性も高い。
- Core Web Vitals への影響: 第三者の数値は確認できず未確認。軽減策の一般論(推測): 広告枠の高さを予約・遅延読み込み。

## 2. 国内の他広告
- 忍者AdMax: 登録時の審査がないとする解説あり(第三者)。広告の質・単価は低いとされる。 [5]
- i-mobile: スマホ向けクリック課金。審査基準・単価は未確認。 nend: 終了との記載あり、最新未確認。 Geniee: 未確認。 [5]
- 最大の制約はホスティング側。ネットワークを問わず、Hobby での広告掲載は不可。

## 3. 寄付
- GitHub Sponsors: 2019年時点で事業を行う全ての国で利用可（Stripe Connect 対象外の国は手動送金）。日本の現行条件・手数料は未確認。 [6]
- Ko-fi: 単発寄付は手数料0%（決済手数料のみ）との記述と3%との記述が食い違う。最低払い出し Stripe 1ドル、PayPal 15ドル。 [7]
- Buy Me a Coffee: 手数料5%＋Stripe手数料。 [7]
- 日本在住者の受け取り可否（Ko-fi・BMC）: 未確認。OFUSE: 「5%+30円、出金275円」と「10%」が食い違う。 [8]
- 小規模ツールでの寄付額の第三者実例: 見つからず。見込み額は置けない（0円の可能性も含む）。

## 4. データ提供(API/B2B)
- JustWatch はパートナー向けに API・データダンプ・ウィジェットを提供。大手向け（大規模な取引先とだけ組むとの開発者の話）。価格・契約条件は非公開。 [9]
- Watchmode など同種サービスあり、料金未確認。国内の類似事例は未確認。 [10]
- 個人が小規模にやる現実性（推測）: 相手探しと権利整理の手間に対し立ち上がりの収入は見込みにくい。Annict の再配布可否に依存。

## 5. 一覧表
| 手段 | 月の見込み額 | 必要条件 | 手間 |
|---|---|---|---|
| AdSense | 約60〜370円(推測) | 独自ドメインが事実上必要、Hobby不可 | 中 |
| 国内他社 | 未確認(AdMaxは低単価) | Hobby不可 | 小〜中 |
| 寄付 | 未確認(0円もありうる) | 可。対価を伴う特典は不可 | 小 |
| データ提供 | 未確認 | Annict の権利整理が前提 | 大 |

## 出典
1. https://support.google.com/adsense/answer/9724 (公式、原文確認)
2. https://dev.to/morinaga/why-google-adsense-will-not-approve-a-vercelapp-site (第三者、検索抜粋のみ。直接取得は404)
3. https://www.onamae.com/column/adsense/24/ (第三者、抜粋)
4. https://atsoho.com/blog/adsense-rpm-improvement-2026 (第三者、2026年、抜粋)
5. https://www.onamae.com/column/adsense/26/ ／ https://zenn.dev/glassonion1/articles/8ea7775a704588 (第三者、抜粋)
6. https://github.blog/2019-09-10-accelerating-the-github-sponsors-beta/ (公式、2019年、抜粋)
7. https://wpforms.com/ja/best-buy-me-a-coffee-alternatives/ ／ https://medium.com/write-a-catalyst/what-to-do-when-buy-me-a-coffee-is-not-available-in-your-country-f6c2b25d91ae (第三者、抜粋)
8. https://app-tatsujin.com/?p=61694 (第三者、抜粋)
9. https://apis.justwatch.com/docs/content_partner/ (公式、抜粋)
10. https://api.watchmode.com/ (公式、抜粋)
