# 裏取り: Annict API規約・GSCアドレス変更・寄付（裏取り役・Sonnet＋監督役の再取得・2026-11-08）

## 1. Annict API 利用規約（https://annict.com/terms/api）
- 所在: /terms の第1条・第6条から /terms/api へリンク（前回の404は別URL）。全17条。
- 制定 2026-10-25、**施行 2026-11-25**、改定前の版なし（監督役が WebFetch で再取得して確認）。
- 第3条（料金と商用利用・要旨）: 無料。本規約を守れば商用・非商用を問わず個別の許可なく利用できる。広告収益や有料機能のあるアプリも含む。個別許可が必要なのは「AI・機械学習に商用の目的で利用する場合」と「取得したデータをデータセットとして第三者に提供する場合」（原文の語句）。
- 第6条（取得したデータの取扱い・原文の文）:
  - 「開発者は、APIで取得したデータを、そのままの形で、またはまとまったデータとして第三者が取り出せるように提供してはいけません。」
  - 「ファイルでの配布、データセットとしての公開、自分のAPIでの再提供などがこれに当たります。」
  - 「まとまったデータを誰でも取得できるURLや公開のリポジトリに置くことは、第三者が取り出せるように提供することに当たります。」（一部省略）
  - 「Webアプリケーションでは、開発者のサーバーで検索するなどして、必要な分だけを返す形にしてください。」
  - 作品情報を画面やページに表示することは禁止に当たらない（要旨）。
- 第7条（要旨）: アプリの提供に必要な範囲で保存・キャッシュ可。作品情報は保存期間・件数の上限なし、利用終了後の消去も不要。
- 第13条（要旨）: 出典表示は任意（「示していただけるとうれしい」）。公式・提携と誤解させる表示は禁止。
- 第11条（要旨）: レート制限は開発者向けヘルプに掲載（数値は未取得）。
- 第9条（要旨）: AI・機械学習の商用利用は個別許可。第10条（要旨）: 画像の再配布・データセット化は禁止。
- 注意: WebFetch は小型モデルの要約を経由する。逐語の最終確認はブラウザで要。

## 2. Search Console のアドレス変更ツール
- 公式（抜粋）: 「You must be an owner of both the old and new properties」「can be used only on properties at the domain level」。例は example.com / m.example.com / http://example.com。パス付きは不可。
- 旧サイトのプロパティ種別（ドメイン／URLプレフィックス）の指定は無し。xxx.vercel.app から使えるかは未確認。

## 3. 寄付の受け取り（日本在住の個人）
- GitHub Sponsors（公式・抜粋）: 対応地域に Japan あり（逐語未確認）。個人からのスポンサーは手数料なし、組織経由は最大6%。受取にはオープンソース貢献が前提（収益サイトへの寄付に使えるかは未確認）。
- Ko-fi: 公式ヘルプ403。第三者では寄付は手数料0%（決済手数料は別）。日本での受取手段は未確認。
- Buy Me a Coffee: Stripe Express 対応130か国以上（公式）。日本が含まれるかは未確認。手数料5%（第三者）。
- OFUSE: 公式は429で未取得。第三者では手数料約10%、2026年以降に改定予定。

## 出典
- https://annict.com/terms ／ https://annict.com/terms/api
- https://support.google.com/webmasters/answer/9370220
- https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors
- https://help.buymeacoffee.com/en/articles/5777478-how-to-set-up-payouts-with-stripe-express
- https://zverok.space/blog/2024-08-08-bmac-snafu.html
- https://help.ko-fi.com/hc/en-us/articles/360002506494-Does-Ko-fi-take-a-fee（403）
- https://app-tatsujin.com/?p=59114（第三者）
