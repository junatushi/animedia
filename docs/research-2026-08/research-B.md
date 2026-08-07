# 領域B調査: 「どこで見れる」横断検索サービス（約20件）

調査日: 2026-08-07 / 手法: WebSearch中心（一部WebFetchは403でブロック）。数字が取れない箇所は「不明」と明記。

---

## 海外勢

### JustWatch（https://www.justwatch.com/）
- **規模**: 2014年創業・ベルリン本社。140ヶ国以上、月間利用者4,500万人超（自社発表）。ahrefs実測: **Domain Rating 82・被リンク元ドメイン26,400件**（2026-07時点、月718件ペースで増加）[ahrefs](https://ahrefs.com/websites/justwatch.com)。
- **クエリ族**: 「作品名 streaming」「where to watch」「作品名 justwatch」など。1作品1ページ（`/us/movie/xxx`, `/us/tv-show/xxx`）＋国別サブディレクトリで多言語展開。ジャンル/プロバイダ別の一覧ページも持つ。
- **被リンク獲得手段（最重要）**:
  1. **Partner API/データフィード提供**（`data-partner@justwatch.com`、[partners.justwatch.com](https://partners.justwatch.com/)）。250,000本の映画・60,000本のTV番組、3,900のローカル配信カタログ、500超のプロバイダーを100ヶ国以上で日次更新するデータを外部提供。
  2. **公式ウィジェット配布**（`apis.justwatch.com/docs/widget`）＋ **WordPressプラグイン**（[wordpress.org/plugins/justwatch-partner-integrations](https://wordpress.org/plugins/justwatch-partner-integrations/)）。中小メディアがそのまま自サイトに埋め込め、埋め込み元に必ず「Powered by JustWatch」的なクレジット＝被リンクが自動発生する設計。
  3. **非公式だが影響力のあるブラウザ拡張**（IMDb/Rotten Tomatoes/Letterboxd/TV.comにJustWatchデータを重ねて表示する拡張機能が多数存在。例: [Just Watch IMDB](https://chromewebstore.google.com/detail/just-watch-imdb/agjmddggghnclfclnikcophchlhogebk)、[Where to Stream](https://chromewebstore.google.com/detail/where-to-stream/pcdbmbdecdnghnipgeafhalajkhkpghk)）。公式提携ではなくJustWatchのAPI/データを使った有志開発だが、結果としてJustWatchブランドが映画レビューサイトの利用体験に常駐する。
  4. **四半期ごとの「ストリーミング市場シェアレポート」をメディアに提供**（下記4参照）。
- **収益モデル**: ①コンシューマー向け無料（アフィリエイト・フリーミアム・バナー広告）、②企業向けデータライセンス（B2Bで「where to watch」データを販売）、③JustWatch Media（Universal/Paramount/Sony/Disney/Prime Videoなどのトレーラー広告をYouTube/Meta/TikTokで運用するアドテク事業）。推定売上5,000万〜1億ドル。[出典](https://leadiq.com/c/justwatch/5a1da7142300005c009a7cff)
- **個人サイトが勝てない点/大手が構造的にできない点**: JustWatchはユーザーのウォッチリスト追加・クリックアウト・フィルタ行動から独自の「市場シェア指標」を算出し、Netflix vs Prime Videoの四半期順位という**メディアが定期的に欲しがるニュース素材**を無償で配布している。これは①140ヶ国×数十万タイトルの継続データ収集基盤、②何百万ユーザーの行動ログ、の両方が要る規模の経済で、個人サイトが真似できない。一方で個人サイトは「日本の配信サービスだけに特化した精度」「Annict由来の一次情報の速さ」でJustWatchが手薄な局所ニッチを取れる（JustWatchの日本カバレッジはd アニメストア等ローカルVODの粒度が粗い）。

### Reelgood（https://reelgood.com/）
- **クエリ族**: 「作品名 streaming」「where to watch」＋トラッカー系（ウォッチリスト）需要。1作品1ページ＋ジャンル一覧。
- **被リンク獲得手段**: **Reelgood Partner API**をB2B提供（REST API/S3バルクエクスポート、300超サービス・28.5万本の映画・7万本の番組をEIDR等の統一IDでマッピング）。さらに**Publisher's Widget**（WordPressプラグイン）を配布し、**メディア側の既存アフィリエイトコードをそのまま使える**設計にして導入障壁を下げている。実例: **New York Post傘下のDecider.comがReelgood Publisher Widgetを統合**（[NextTV記事](https://www.nexttv.com/news/ny-posts-decider-integrates-reelgood-publisher-widget)）。大手メディアへの導入実績がそのまま被リンク・ブランド露出になっている。
- **収益モデル**: B2Bデータ販売（Reelgood for Business）＋ウィジェット経由のアフィリエイト分配（自社と導入先で共有する設計）。
- **示唆**: 「ウィジェットに導入先の既存アフィリエイトコードを差し込める」設計は、導入メディア側の収益を奪わないためメディアが採用しやすい。個人サイトが埋め込みウィジェットを配る場合も同じ発想（相手の収益を奪わない）が有効（本サイトは既にCLAUDE.md方針で埋め込みに広告リンクを入れない設計＝方向性は近い）。

### uNoGS（unogs.com）
- 「Netflix全世界の国別ライブラリを横断検索」という**単機能特化**サービス。個人運営（"Brian"というオペレーター）。
- Netflixの非公開APIを叩く仕組みのため**Netflix側のブロックとのいたちごっこ**が続き、対応国が縮小。現在はユーザー投稿で欠損データを補う運用に移行（[出典](https://forum.uno.gs/topic/5/what-happened-to-unogs)）。
- 被リンク獲得策・収益モデル: 具体的な数字は**不明**（rapidapi経由のAPI提供はあるが規模不明）。
- 示唆: 単一プラットフォーム×国別ライブラリという狭いニッチでも個人運営で回る実例だが、**土台となるAPI（Netflix）に依存する構造は継続性リスクが高い**。本サイトのAnnict依存と同種のリスクとして参考になる。

### Flixable（flixable.com）
- 「Netflix USで今見られる全作品」を検索できる特化サービス。詳細な被リンク戦略・収益モデルは**不明**（検索結果からは概要のみ確認、一次情報の深掘りは未達）。

### PlayPilot（playpilot.com）
- 北欧発、25ヶ国で月間数百万ユーザー（自社発表）。**Gravity**というB2Bツールでストリーミング市場の可視化データを提供し、企業向け広告フォーマットも展開（[playpilot.com/business](https://www.playpilot.com/business)）。JustWatchと似た「B2Cは無料ガイド、B2Bはデータ/広告」の二階建てモデル。
- 被リンク獲得の具体策は検索結果から**不明**（データレポートをメディアに提供しているかは未確認）。

### Werstreamt.es
- ドイツ語圏の同種サービス。詳細（クエリ族・被リンク策・収益）は検索結果からほぼ取得できず**不明**。JustWatchと競合する地域特化サービスが多数存在すること自体が、「地域特化なら大手と共存できる」傾向の傍証。

### WhereToWatch.com
- **MPA（旧MPAA、Disney/Sony/Universal/Paramount/Warner Bros/Netflixの業界団体）が公式運営**する検索サイト（[PR Newswire](https://www.prnewswire.com/news-releases/introducing-wheretowatchcom-a-new-search-site-to-help-you-find-the-shows-and-movies-you-love-282403041.html)）。映画館の上映情報（郵便番号検索）も統合。広告なし。
- 被リンク・SEOで有利な点: **6大スタジオ自身が運営する「公式」という立場**そのものが権威性・被リンクを生む。個人・企業がどうやっても再現できないポジション（業界団体の権威）。
- 収益モデル: 広告なし・業界団体運営のためアフィリエイト等は不要（各スタジオの視聴促進が目的）。

### Decider（decider.com、New York Post傘下）
- **編集部主導のレビュー・キュレーションメディア**（「アルゴリズムへの人力の解毒剤」を標榜）。1作品1ページの網羅型ではなく、「今月Netflixで見るべき10本」等のリスト記事・レビューが主体。
- **トラフィック**: 2026年1月に713万訪問、平均滞在4:39。オーガニック検索が流入の68.15%（[Similarweb](https://www.similarweb.com/website/decider.com/)）。
- **被リンク獲得**: 既存の大手新聞社（New York Post）の**ドメイン権威をそのまま流用**＋Reelgood Partner Widget導入（配信情報の網羅性を外部データで補完）。新聞社の芸能記者が書く一次取材記事（インタビュー等）が自然な被リンクを生む構造。
- 示唆: 個人サイトには真似できない「既存大手メディアの傘下に入る」戦略。

### What's on Netflix
- Netflix専業のニュース・データサイト。新作リーク情報や独自の「今後追加予定作品」データベースで**Netflixファン・海外メディアからよく引用される**（一次情報源としてのポジション）。具体的な被リンク数・収益モデルは検索結果から**不明**（追加調査未達）。

### TV Time（Whip Media傘下）→ **2026年7月にサービス終了**
- 元は視聴トラッキングアプリ（バッジ・SNS的機能）。本質的価値は「どの作品をどう見たか」という**行動データそのもの**をエンタメ業界に販売するB2Bインテリジェンス事業（Whip Media Group、2020年に5,000万ドル調達）。
- 2026-07-02にTechCrunchが終了を報道、AI事業へ会社ごと軸足を移した（[TechCrunch](https://techcrunch.com/2026/07/02/popular-tv-tracking-app-tv-time-is-shutting-down-as-company-focuses-on-ai/)）。共同創業者が後継の"Bingers"を立ち上げ中（2026-08-04発表）。
- 示唆: 「視聴データを企業に売る」B2Bモデルは投資家の期待するスケールに届かないと単独では続かない好例。個人サイトが真似すべきモデルではない。

### Moviebase / StreamLocator
- **Moviebase**: TMDB+Trakt.tvのデータを組み合わせた視聴トラッカーアプリ。配信可否表示はTMDB由来のJustWatchデータを又借りしている可能性が高い（詳細不明）。フリーミアム。
- **StreamLocator**: 実態は**地域制限回避のプロキシサービス**（VPNではない）であり、本領域（横断検索）とは性質が異なる。「どこで見れるか探す」ではなく「見れない地域でも見られるようにする」商材。ユーザーリストにあったが**カテゴリが違う**点を明記しておく。

---

## 日本勢

### どこどこ動画（docovideo.com）
- 「37サービス横断検索」を謳うツール型サイト。作品タイトルを入力すると各VODの検索結果ページへのリンクボタンが並ぶ形式（**1作品1ページの独自コンテンツを持たず、外部検索へのリダイレクタ**に近い）。WebFetchが403で本文詳細は未取得、運営者情報・収益モデルは**不明**。

### Filmarks（filmarks.com）アニメ版含む
- 国内最大級の映画・ドラマ・アニメレビューサービス。**月間アクティブ利用者数約740万人・月間PV約1.5億・累計レビュー2億件超**（[PR TIMES](https://prtimes.jp/main/html/rd/p/000000213.000008641.html)）。
- 配信サービス検索は**レビューコミュニティのおまけ機能**（`/list-anime/vod`など）としてあり、単体の「どこで見れる」特化サイトではない。
- 収益: プレミアム課金（月550円）＋広告（メディアレーダー掲載あり）＋想定されるVODアフィリエイト。
- 示唆: **UGCレビューという強力なコンテンツ資産＋巨大MAU**が配信検索機能への回遊・SEO両方を支えている。個人サイトが対抗できない規模だが、Filmarksは「配信情報の一次性・鮮度」を主目的にしていないため、**「今期どこで見れるか」を最速・最新で当てにいく**ニッチは空いている可能性。

### アニしま（anime-song-info.com）
- 「今期アニメ動画配信サイトまとめ」を**1本のまとめ記事（クール単位の比較表）**として提供。1作品1ページ構成ではない。
- ズッカズの森（zukkazu.com）、りおぽんブログ（riopon.blog）、VODコンパス（vod.zekno.co.jp）、egosuke.com、anime-video-vod.com なども**同型の「クールまとめ表 or ジャンル別まとめ記事＋VODアフィリエイトリンク」構成**で、個人・小規模法人ブログが多数乱立している状態。
  - りおぽんブログは例外的に**1作品1記事**の形式も持つ（例: 「モノノ怪」「ブルーロック」個別ページ＋「Netflixしか見れないアニメ全一覧」「dアニメだけでしか見れないアニメ」等の独占配信切り口の記事群）。**「独占配信」という検索意図の強いテーマで記事を分けている**のが特徴的。
- 収益: 各VODサービスのアフィリエイト（ValueCommerce/A8.net等のASP経由、VOD案件は無料トライアル登録で1件1,000円前後の高単価と紹介されている）。
- 被リンク獲得手段: 確認できた範囲では**特に無い**（純粋なアフィリエイトSEO記事で、外部への配布物・データ提供・ウィジェットは持たない）。

### uzurea.net
- サブカル雑食メディア（20〜40代向け）。「動画配信サービス一括検索補助ツール（21サービス横断）」を1コンテンツとして掲載。運営は株式会社オルトスタック。
- 収益: 記事広告・PR記事・レビュー記事・バナー広告（[広告掲載ページ](https://uzurea.net/advertisers/)）。VOD横断検索は**サイト全体の集客コンテンツの一つ**であり主力事業ではない。

### VODコンパス（vod.zekno.co.jp）
- 「あなたに合う動画配信サービスが見つかる」比較ポータル。料金・作品数・無料期間の横並び比較が主眼で、**サービス選び（入口）の比較**に特化。個別作品がどこで見れるかの検索ではなく、**VOD自体の比較サイト**（本サイトの「作品→配信先」とは逆方向の導線）。

### スポカレ（spocale.com）
- 厳密には**スポーツ観戦の日程・放送/配信・チケット情報**に特化したサービスで、アニメではない。ただし「試合（コンテンツ）→放送/配信先→チケット」という導線構造は本領域と同型で、**同じ課題（どこで見れる）を隣接ジャンルで解いている参考事例**として意味がある。ブログ記事でVODアフィリエイトも扱う。

### ABEMA TIMES / アニメハック（eiga.com系）
- **ABEMA TIMES**: ABEMA公式のオウンドメディア。「アニメ放送情報」タグページ・番組表記事で自社サービスへの回遊を作る。配信元企業自身のメディアなので中立比較ではなく**自社訴求が前提**。
- **アニメハック（anime.eiga.com）**: 映画.com（カカクコム子会社）が2015年開設。全国のTV/BS番組表を1週間先まで掲載、作品ごとのキャスト・スタッフ検索、イベントカレンダー、「チェックイン」機能（お気に入り登録・通知）を持つ**総合アニメ情報サイト**の一部として配信・放送情報を提供。カカクコムという**大手が運営するドメイン権威**を背景に上位表示しやすい構造。

### その他（anime-vod.com / ズッカズの森 / riopon.blog等）
- 総じて「今期アニメ配信まとめ」「ジャンル別VODアフィリエイト記事」という**同型コンテンツの過当競争**状態。差別化軸は更新頻度・網羅性・SEOタイトルの工夫程度で、被リンク獲得のための能動的な仕組み（API配布・データ提供・ウィジェット）を持つ日本語サイトは**調査した範囲では見つからなかった**（＝日本語圏はJustWatch/Reelgoodのような「データを配って被リンクを稼ぐ」発想がほぼ空白）。

---

## 全体所見（このカテゴリの構造）

| 型 | 代表例 | 被リンク獲得の型 | 個人サイトとの関係 |
|---|---|---|---|
| データ配信基盤型 | JustWatch, Reelgood | API/ウィジェット配布、メディアへのデータレポート提供 | 規模の経済が必須。個人には再現不可 |
| 業界団体公式型 | WhereToWatch.com | 運営主体の権威そのもの | 再現不可（スタジオ連合という立場） |
| 大手メディア傘下型 | Decider | 親サイトのドメイン権威＋外部データ統合 | 再現不可 |
| B2Bデータ販売型 | TV Time(終了), PlayPilot Gravity | 直接の被リンクとは無関係。単独では脆い（TV Timeは終了） | 個人が目指す方向ではない |
| アフィリエイトSEO型 | アニしま, ズッカズの森, りおぽんブログ, VODコンパス等 | **能動的な被リンク獲得策なし**。純粋にコンテンツSEOのみ | **本サイトと同じ土俵**。差別化は一次情報の速さ・網羅性・UXのみ |
| コミュニティ/レビュー型 | Filmarks | UGC資産とMAUがSEOを牽引、配信検索は付随機能 | 規模で勝てないが「配信情報の専門性」で棲み分け可能 |

**個人サイトが同じ土俵で勝てない点**: データ配信基盤（API/ウィジェット配布で他サイトに埋め込ませる）・業界権威・大手メディアの傘・巨大UGC資産・広告営業チームによるB2Bデータ販売——これらは初期投資・組織・ブランドが必要で個人開発では正面から戦えない。

**逆に大手が構造的にできない/やらない点**:
- JustWatch/Reelgoodは世界中の全ジャンルを浅く広くカバーするため、**日本ローカルVOD（dアニメストア、DMM TV等）の粒度・鮮度**は手薄になりがち（現地化コストに見合わない）。
- VOD比較アフィサイト（ズッカズの森等）は「他社サイトに無料で貼れるウィジェット」を配る発想もインセンティブもない（自サイトへの直接アフィリエイト誘導が収益源なので、外部に無料で機能を渡すと自分のクリックを奪われる）。**本サイトは埋め込みウィジェットにアフィリエイトを入れない方針（CLAUDE.md記載）にしているため、この「他サイトが安心して貼れる」立ち位置を取れる唯一の日本語アニメ配信サイトになれる可能性がある**（推測: 競合调査の範囲では日本語圏に同種の無料ウィジェット配布事例が見当たらなかったため）。
- 業界団体系・大手メディア系はサイト単体のSEOよりブランド動線が主で、**「アニメ特化」という深さ**を持たない。

---

## 出典一覧（本文中リンクの再掲）
- https://ahrefs.com/websites/justwatch.com
- https://partners.justwatch.com/
- https://apis.justwatch.com/docs/widget
- https://wordpress.org/plugins/justwatch-partner-integrations/
- https://www.justwatch.com/us/press/netflix-paramount-warner-bros
- https://www.mediaplaynews.com/justwatch-netflix-prime-video-top-q2-svod-market-share/
- https://leadiq.com/c/justwatch/5a1da7142300005c009a7cff
- https://data.reelgood.com/products/reelgood-partner-api/
- https://www.nexttv.com/news/ny-posts-decider-integrates-reelgood-publisher-widget
- https://forum.uno.gs/topic/5/what-happened-to-unogs
- https://www.playpilot.com/business
- https://www.prnewswire.com/news-releases/introducing-wheretowatchcom-a-new-search-site-to-help-you-find-the-shows-and-movies-you-love-282403041.html
- https://www.similarweb.com/website/decider.com/
- https://techcrunch.com/2026/07/02/popular-tv-tracking-app-tv-time-is-shutting-down-as-company-focuses-on-ai/
- https://techcrunch.com/2026/08/04/tv-time-co-founder-launches-bingers-to-revive-the-beloved-tv-tracking-app/
- https://uzurea.net/advertisers/
- https://uzurea.net/video-distribution-service-cross-search/
- https://vod.zekno.co.jp/
- https://spocale.com/blog/vod-anime/
- https://anime.eiga.com/
- https://prtimes.jp/main/html/rd/p/000000399.000001455.html （アニメハック開設プレスリリース）
- https://prtimes.jp/main/html/rd/p/000000213.000008641.html （Filmarks 2億Mark突破）
- https://riopon.blog/vod/netflix-only/
- https://zukkazu.com/this-term-animation-distribution-service/
- https://anime-song-info.com/anime-vod-list/
- https://docovideo.com/
