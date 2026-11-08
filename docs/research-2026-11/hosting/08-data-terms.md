# データ源・素材の規約と収益化（調査役・Sonnet・2026-11-08）
> 【2026-11-08 追記】Annict API 利用規約の本文は https://annict.com/terms/api にあった（施行 2026-11-25）。下の「1. Annict」は未到達の時点の記録。確認結果は 12-factcheck-terms.md。

※規約文言の整理であり法的助言ではない。読めた原文は Annict 利用規約、AniList ToU、しょぼいカレンダーbotルールの3件。dアニメ・AI Horde・Annict API規約は本文を取得できなかった。

## 1. Annict（判定: 不明〜条件付き。最大の未確認点）
- 公式（原文、WebFetchの要約経由）: 利用規約に「商用利用」「データ保存」「クレジット表記」に直接当たる条項は見当たらない。
- 第6条の禁止事項に「運営者が認めていない宣伝・広告・勧誘・営業」。文脈は投稿・ユーザー行為とみられ、サイトの広告掲載への適用は未確認。
- 同じく第6条: 「API利用規約で認める範囲を超えて…APIから情報を機械的に取得する行為」。第1条はAPI利用時に「本規約に加えて」と定め、API利用規約の存在を示す。
- 第8条: 第三者（APIを利用するアプリ開発者など）への投稿データの再許諾に言及。Annictがユーザー投稿を扱う話で、再配布の許可ではない。
- 未確認: API利用規約の本文（annict.com/api_terms と developers.annict.com の規約URLは404）。
- 結論: 商用・スナップショット保存・公開API（/api/season, /api/work）での再配布の可否はすべて未確認。API利用規約を人が直接読むのが先決。

## 2. AniList（判定: 条件付き）
- 公式（原文）: 月収$150未満の商用サービスは無償・個別許可不要。それ以上は商用ライセンスが必要（contact@anilist.co）。
- 「Using the AniList API as a backup or data storage service is strictly prohibited」。大量収集も禁止。帰属表記・レート制限は記載なし。
- 対応: 現行の取得（ID・タイトル・日付のみ、1日2回）は範囲内と思われる。収益が月$150を超えたら契約が必要。

## 3. しょぼいカレンダー（判定: 条件付き）
- 公式（原文、botルール）: 「HTMLのスクレイピングは行わず、データ取得用のAPIやフィードを利用してください」「最低1秒以上空けて次のリクエストを開始」。並列不可、IP/UA切替による回避不可、「取得結果を再利用してください」。商用利用の条項は記載なし。
- 対応: 取得方法がAPI/フィードで、間隔が1秒以上かを確認する。

## 4. dアニメストア（判定: 不明）
- 公式のドコモ規約PDFは本文を読めず、禁止事項・スクレイピング条項は未確認。
- 対応: 規約PDFの禁止事項を人が確認。許諾が取れなければ、しょぼいカレンダーの「終」フラグへ一本化する案。

## 5. AI Horde（判定: 不明）
- 公式の利用規約（aihorde.net/terms）は本文を取得できず。ソフトのコードはAGPL-3.0（画像の権利ではない）。CC0とする記述は派生アプリのもの。
- 対応: 規約本文または運営者への確認。確認できるまで収益化面での依存を避けるのが無難。

## 総合判定
- 収益化を止める明文の禁止は、読めた範囲では見つからなかった。ただし最重要の Annict API 規約、dアニメ、AI Horde は原文未確認＝「問題なし」とは言えない。
- 次の一手: Annict API利用規約の原文確認（最優先）→ dアニメ禁止事項 → AI Horde規約。

## 出典
- 公式（原文）: https://annict.com/terms
- 公式（原文）: https://anilist.gitbook.io/anilist-apiv2-docs/docs/guide/terms-of-use ／ https://docs.anilist.co/guide/terms-of-use
- 公式（原文）: https://docs.cal.syoboi.jp/rule/bot/
- 公式（本文読めず）: https://www.docomo.ne.jp/binary/pdf/service/regulation/regulation_danime_app.pdf
- 公式（本文なし）: https://aihorde.net/terms
- 公式（認証のみ）: https://developers.annict.com/docs/authentication
- 第三者: https://providers.apis.io/providers/anilist/ ／ https://dbzer0.itch.io/lucid-creations ／ https://github.com/AIPowerGrid/system-core
