# 領域A: 海外アニメ情報・スケジュール・トラッキングサイト リサーチ

調査日: 2026-08-07 / WebSearch中心（WebFetchはAnnictフォーラムが403で不可）
数字が取れなかったものは「不明」と明記。SimilarWeb/Semrushの数値はスナップショット推定値であり誤差が大きい点に留意。

---

## 1. LiveChart.me
- URL: https://livechart.me
- 概要: 2013年8月開始。個人(wolfemm)開発＋少数ボランティアがデータキュレーション。シーズンチャート＋日次スケジュール＋カウントダウン＋通知が核。
- 流入源: SimilarWebでは**Direct流入が66.2%**と圧倒的（2.3M visits規模、推定値）。米国が最大流入国。オーガニック検索の比率は相対的に低い＝「ブックマークして毎週使う」定着型ツールであることを示唆。
- 初期ユーザー獲得: 具体的な経緯（Reddit投稿等）は検索で特定できず。「趣味プロジェクトが徐々に定番化した」という記述のみ（**不明**な点が多い）。
- 配布装置: RSS（直近アニメ話数のRSS、直近ヘッドラインRSS）あり。公開APIは**無し**（FAQに明記）。iCal/.ics、ブラウザ拡張は検索で確認できず。モバイルアプリ（Google Play）あり。
- 収益化: 検索では特定できず（広告と推測されるが未確認）。
- 出典: https://www.similarweb.com/website/livechart.me/ / https://livechart.me/pages/about / https://www.livechart.me/pages/rss / https://www.livechart.me/pages/faq

## 2. AniList / AniChart
- URL: https://anilist.co , https://anichart.net
- 流入源: SimilarWebで**Direct 76.84%**、2位がOrganic Social、3位がOrganic Search（2026年6月時点、5,554→5,654位に若干悪化）。米国系トラフィック中心。
- 初期ユーザー獲得: 検索では創業ストーリー・Reddit投稿の詳細は特定できず（**不明**）。ただしオープンな無料GraphQL APIを軸にサードパーティ製Discord bot（szric98, dhruvin771, Yuuko等）や拡張が多数生まれており、これが露出源の一つになっていると推測される。
- 配布装置: **無料の公開GraphQL API**（`graphql.anilist.co`、OAuth2対応）。これを使ったDiscord botが多数（コミュニティ製）。公式Discord検索bot（AniList/discord-search-bot）も提供。ウィジェット/RSS/.icsは検索で確認できず。
- 収益化: 広告＋Patreon（`patreon.com/ani_chart_list`、$1〜$20/月の投げ銭ティア。$1=バッジ+ベータアクセス、$20=統計更新頻度アップ等の非本質的特典）。「広告だけでは運営費を賄えない」と公式に説明。
- 示唆: **無料の公開APIをコミュニティに開放し、Discord bot等のサードパーティ実装が勝手に生まれる**という分散型の配布モデルが成立している。
- 出典: https://www.similarweb.com/website/anilist.co/ / https://www.patreon.com/ani_chart_list/about / https://github.com/AniList/discord-search-bot

## 3. MyAnimeList (MAL)
- URL: https://myanimelist.net
- 流入源: 圧倒的な規模。Semrushで**月間7,400万〜7,600万visits**（2026年4〜6月）、グローバル順位11位。米国・インドネシア・インドが上位流入国。
- 初期ユーザー獲得: 2004年11月、Garrett Gyssler（"Xinil"）が個人サイトとして開始。最初は"AnimeList"、後に"My"を追加（MySpace等のSNSブームに便乗した命名）。2006年に独自ドメイン化してユーザー基盤拡大。2006年時点で5万登録ユーザーに達し、**口コミ（word-of-mouth）**が主動力だったとされる。SNS広告・Reddit等の明示的な施策は検索では確認できず。
- 配布装置: 公式API v2（OAuth2、X-MAL-Client-Idヘッダ）。非公式のJikan API（後述）がMALデータをRESTでラップしオープンソース配布。プロフィール/フォーラムのバッジ・シグネチャ埋め込み文化（MAL-Badges, MAL Heatmap等サードパーティ製）がユーザー間の可視化・回遊を生んでいる。
- 収益化: 広告＋Premium（Supporterティア $2.99/月 or $29.99/年、広告非表示＋プロフィールカスタマイズ＋お気に入り枠拡張）。
- 出典: https://canvasbusinessmodel.com/blogs/brief-history/myanimelist-brief-history / https://www.semrush.com/website/myanimelist.net/overview/ / https://www.achriom.com/blog/myanimelist-vs-anilist-vs-kitsu/

## 4. Kitsu (旧Hummingbird)
- URL: https://kitsu.io
- 沿革: 2013年頃Hummingbird.meとして開始→2017年1月、VIZ Media等から$600k調達（評価額$2M）を経てKitsuへリブランド・全面リライト。旧ユーザーは同一アカウントで移行。
- 流入源: SimilarWebで**月間11.8万visits**（2026年2月、Semrushでは9.4万visitsで減少トレンド）。MALやAniListと比べ規模は大幅に小さい。米国が最大流入国。
- 初期ユーザー獲得: 検索では具体策（Reddit/PH等）を特定できず（**不明**）。VC出資を受けたスタートアップ型である点が他の個人開発サイトと異なる。
- 配布装置: 公開API（Apiary文書化、OpenAPI3へ移行中）。ブラウザ拡張・モバイルアプリあり。
- 収益化: 検索では明確化できず（広告・VC出資が主と推測）。
- 出典: https://medium.com/heykitsu/hummingbird-is-dead-long-live-kitsu-bda6ccfbbcce / https://www.similarweb.com/website/kitsu.io/

## 5. AnimeSchedule.net
- URL: https://animeschedule.net
- 流入源: Semrushで**米国ランク26,974位、月間127万visits**（2026年2月時点）、平均滞在6分6秒と長め。米国・ブラジル・インドが中心。
- 初期ユーザー獲得: 検索では詳細不明。だが**Discord bot「ZeroTsu」の裏側データソース**として使われており（ZeroTsuは5,679サーバーに導入）、Discordコミュニティ経由の間接流入があると推測される。
- 配布装置: **公開API（v3、ドキュメント完備）**。これをZeroTsu等のDiscord botが利用。.ics/RSS/ウィジェットの有無は検索で確証取れず（**不明**）。
- 収益化: 検索では特定できず。
- 出典: https://www.semrush.com/website/animeschedule.net/overview/ / https://github.com/apiks/ZeroTsu / https://animeschedule.net/api/v3/documentation

## 6. AnimeCountdown
- URL: animecountdown.com（Simklが開発）
- 概要: Simkl社が展開するアプリ。単独の創業ストーリーはなく、Simklのサブブランド的存在。
- 流入源/初期獲得: 不明（Simklの項参照）。
- 出典: https://www.appbrain.com/app/anime-countdown/com.animecountdown.twa

## 7. Simkl
- URL: https://simkl.com
- 流入源: SimilarWebで**月間約100万visits**（2025年11月時点）、Streaming&Online TVカテゴリ658位・グローバル33,396位。**Direct 49.32%**が最大、次いでOrganic Search、Referral。
- 初期ユーザー獲得: 検索では詳細不明。ただし**「他サービスからのインポート」機能（Trakt, MyAnimeList, TV Timeからの一括インポート）を強力な入口**にしているのが特徴的（乗り換えコストを下げてスイッチングを誘発）。
- 配布装置: **ブラウザ拡張（Netflix/Crunchyroll等のストリーミング視聴を自動scrobble）**、Android/iOS/Windows/Kodi/Plexアプリ、Chrome拡張多数（公式含む）。
- 収益化: 検索で明確化できず（広告＋プレミアムと推測）。
- 出典: https://www.similarweb.com/website/simkl.com/ / https://docs.simkl.org/how-to-use-simkl/faq/frequently-asked-questions/can-simkl-auto-sync-from-other-streaming-apps-like-primevideo-disney+-hulu-and-import-watch-history

## 8. Trakt.tv
- URL: https://trakt.tv
- 概要: 2010年創業。動画版「scrobbling」（Last.fmの音楽scrobblingを転用した概念）の先駆け。Plex/Kodi/Emby/Jellyfin等のメディアセンターと連携し**視聴を自動検知・自動記録**するのが核。
- 初期ユーザー獲得: **Plexプラグイン（Plex-Trakt-Scrobbler）等のサードパーティ連携ツールがオープンソースで多数生まれ**、それらがユーザー拡大の主軸になったと見られる（Trakt自身の直接プロモーションではなく、開発者エコシステムが牽引）。
- 配布装置: **オープンAPI**が中核戦略（"dozens of apps and services can connect to the same data"）。Plex/Kodi/VLC/MPV/MPC-HC向けスクロブラーが多数OSSで存在。
- 収益化: VIP会員（年額。2025年に$30→$60へ100%値上げし無料枠を厳格化）。
- 示唆: **「自分でクライアントを作らず、オープンAPIで外部開発者にクライアントを作らせる」**戦略の代表例。
- 出典: https://forums.trakt.tv/t/vip-membership-pricing/56942/41 / https://alternativeto.net/news/2025/2/trakt-tv-has-set-stricter-limits-for-free-users-and-raised-vip-subscription-prices-by-100-/ / https://github.com/rg9400/Plex-Trakt-Scrobbler

## 9. AniDB
- URL: https://anidb.net
- 沿革: 元は「AnimeReactor」というコミュニティ内の私的プロジェクト（メンバーが手持ちアニメをスプレッドシート管理していたのを置き換える目的）。**2002年末に一般公開**。非営利・広告なし・ボランティア運営。
- 初期ユーザー獲得: **ファイルハッシュ(ed2k)によるファイル同定機能**が核。fansubファイルの自動識別・MyList管理を軸に、当時のファイル共有コミュニティ内で自然に使われるようになったと推測される（明示的なマーケティング記録は検索で確認できず）。
- 配布装置: **UDP API**（読み書き両対応、ファイルハッシュ照合・MyList操作・通知）。これを使うサードパーティクライアントが多数（yumemi等のPythonライブラリ含む）。
- 収益化: 非営利・無広告（ボランティア運営、寄付ベースと推測）。
- 示唆: 「ファイル識別」という実用ユーティリティが接着剤となり、コミュニティ内で自然拡散した典型例。
- 出典: https://wiki.anidb.net/AniDB:About / https://forum.anidb.net/viewtopic.php?t=2328

## 10. Jikan API（MyAnimeList非公式API）
- URL: https://jikan.moe
- 概要: MAL公式APIの機能不足を補うオープンソースの非公式ラッパーAPI（スクレイピングベース、REST、無料）。v3は2022年10月に廃止、v4に移行。
- 流入源/獲得: MAL自体の巨大な知名度に**寄生する形でAPI利用者（開発者）を獲得**。RapidAPI等のAPIマーケットプレイスにも掲載され発見性を高めている。
- 配布装置: REST API本体がそのまま配布装置。GitHub OSS。
- 収益化: 無料（コミュニティ支援ベースと記載）。
- 示唆: **「巨大サイトの非公式API」というポジション自体が開発者コミュニティからの恒常的な被参照・被リンクを生む**モデル。
- 出典: https://jikan.moe/ / https://docs.api.jikan.moe/

## 11. Notify.moe
- URL: https://notify.moe
- 概要: オープンソース（MIT）の個人開発アニメトラッカー。GitHub `animenotifier`組織で開発。開発者が3年以上前から活動停止（プロジェクトは「事実上死んでいるが動作はしている」状態）。
- 配布装置: Webサイト＋Chrome拡張＋モバイルアプリ。
- 示唆: 個人開発OSSは開発停止後もサイト自体は残り続けるが、成長は止まる典型例。
- 出典: https://github.com/animenotifier/notify.moe

## 12. Anime-Planet
- URL: https://www.anime-planet.com
- 沿革: 2000年末〜2001年に個人の思いつきから開始、2007年にLLC化。**最古参のアニメ・マンガ「おすすめ」データベースの一つ**を自称。
- 流入源: 月間約50万人（記述ベース、時期不明）。小規模チーム（創業者含む）運営。
- 初期ユーザー獲得: 検索では詳細不明。
- 配布装置: 検索では特定できず。
- 収益化: Patreonあり（`patreon.com/animeplanet`）。
- 出典: https://www.otakujournalist.com/behind-the-scenes-at-anime-planet-with-sothis/ / https://www.patreon.com/animeplanet/about

## 13. aniSearch
- URL: https://www.anisearch.com（旧anisearch.de）
- 沿革: 2006年1月、Dominik Koziolがドイツ語版として創業。2013年11月に多言語対応・ドメイン統合。
- 流入源: ドイツが最大流入国（ドイツ発祥を反映）、米国が2位。
- 収益化/配布装置: 検索では特定できず。
- 出典: https://www.similarweb.com/website/anisearch.com/

## 14. Shikimori
- URL: https://shikimori.one（ロシア語圏最大手）
- 配布装置: GraphQL/REST API（v1/v2/graphql、graphql推奨）が公開されており、サードパーティ製の「関連作品ウィジェット」「新着ウィジェット」（`anime-db/shikimori-related-items-widget-bundle`等、埋め込み用OSSウィジェット）がコミュニティから生まれている。
- 流入源/収益化/初期獲得: 検索では具体的な数値・経緯を特定できず（ロシア語圏中心のため英語検索の情報が薄い）。
- 出典: https://github.com/anime-db/shikimori-related-items-widget-bundle / https://publicapi.dev/shikimori-api

## 15. MAL-Sync
- URL: https://malsync.moe
- 概要: MAL/AniList/Kitsu/Simkl/Shikimori等**複数トラッカーへの視聴進捗を、100以上のストリーミング/漫画サイト（Crunchyroll, Netflix, MangaDex, 9anime等）から自動同期**するブラウザ拡張・ユーザースクリプト。
- 配布装置: Chrome/Firefox/Opera拡張＋PWA。
- 示唆: 「複数の既存トラッカーすべてに対応する」ことでどのトラッカーのユーザーからも支持される横断ツールとして成立。
- 出典: https://github.com/MALSync/MALSync / https://chromewebstore.google.com/detail/mal-sync/kekjfbackdeiabghhcdklcdoekaanoel

## 16. Taiga
- URL: https://taiga.moe
- 概要: Windows向け軽量デスクトップアプリ（OSS、C++）。**視聴中の動画ファイルを自動検出**しAniList/Kitsu/MALへ進捗同期。多数のGitHubフォークが存在＝コミュニティの活発さを示唆。
- 配布装置: デスクトップアプリ本体がGitHub配布。
- 流入源/収益化: 検索では特定できず（非商用OSS）。
- 出典: https://github.com/erengy/taiga

## 17. AnimeThemes.moe
- URL: https://animethemes.moe
- 概要: アニメOP/ED動画（15,000本以上）のホスティング・データベース。r/AnimeThemesのWikiがルーツ。ボランティア運営、サーバー費用は自腹→Patreonへ移行。
- 配布装置: 公開API（`animethemes-server`、GitHub OSS）、Discordサーバー。
- 収益化: Patreon（`patreon.com/AnimeThemes`）。
- 出典: https://animethemes.moe/about/faq / https://www.patreon.com/AnimeThemes

## 18. Annict（自サービスが依拠するAPI元）
- URL: https://annict.com
- 沿革: 2014年頃公開、2026年時点で公開12年。個人開発者が運営。**あえて公式クライアントアプリを作らない方針**で、代わりに「Annict Userland」という**サードパーティ製アプリ・ライブラリの一覧掲載の場**を用意している（Androidアプリ「Annictter」、Pythonライブラリ`python-annict`等が並ぶ）。
- 流入源/初期獲得: 検索では詳細不明（フォーラム記事`annict.com/forum/posts/2089`はWebFetch 403で本文未取得）。
- 配布装置: **公開Web API（REST/GraphQL）を主軸に、サードパーティ開発者に配布装置を作らせる**モデル。「Annict Userland」で作品を掲載することで開発者コミュニティのモチベーションを可視化・維持。
- 収益化: サポーター制度（投げ銭、詳細不明）。
- 示唆: これはまさに本サイト（animedia）がAnnictのAPIを使って作られているのと**相似構造**。Annict自身は「自分で全部作らない」戦略で開発者を巻き込み露出を増やしている。
- 出典: https://developers.annict.com/ / https://en.annict.com/forum/posts/921 / https://www.tumblr.com/annict-blog/159359910633/annict-userland

## 19. AniCountdown / Senpai.moe（旧Senpai Anime Charts）
- URL: https://www.senpai.moe
- 配布装置: `senpai.moe/export.php` という**エクスポート機能ページ**が存在（.ics等のエクスポートと推測されるが詳細未確認）。
- その他: 検索では詳細情報が乏しい（**不明**多数）。
- 出典: https://www.senpai.moe/export.php

## 20. r/anime（Redditコミュニティ導線・横断的知見）
- r/animeを含む多くのsubredditは自由な自己宣伝を禁止し、**週次/月次の指定スレッド（Self-Promotion Sunday等）でのみ許可**するのが一般的なパターン。個別DM/リプライ営業ではなく、**コミュニティが用意した公式な自己紹介枠に沿って投稿する**のが「営業しない集客」の定石。
- r/anime固有の詳細ルールは検索で本文を特定できず（**不明**。実際に運用するなら公式wikiを直接確認する必要あり）。
- 出典: https://redship.io/blog/reddit-self-promotion-rules（一般論）

---

## 全体所見（表）

| 分類 | 該当サイト | 集客への含意 |
|---|---|---|
| 公開APIを主軸にした分散配布 | AniList, Trakt, Annict, AnimeSchedule, Shikimori, Jikan | 自分で全チャネルを作らず、外部開発者にDiscord bot/拡張/ウィジェットを作らせて露出を増やす |
| ブラウザ拡張がエントリーポイント | Simkl, MAL-Sync, Notify.moe | 「見ているその場」で自動記録という強い動機付けフックがある |
| ファイル/ストリーミング自動検出 | AniDB(ハッシュ), Trakt(scrobble), Simkl(scrobble), Taiga(ローカル検出), MAL-Sync(サイト検出) | 手入力ゼロの自動化が定着率を上げ、口コミの源泉になっている |
| 口コミ・Direct流入が主流 | MAL, AniList, LiveChart | いずれもDirect trafficの比率が高い＝ブックマーク化・習慣化された結果であり、SEOだけの成果ではない |
| Discordを配布・発見の場にする | AniList, AnimeSchedule(ZeroTsu bot), AnimeThemes | Botを介して非フォロワーにも機能が露出する（リプライ営業と異なり自動で回る） |
| 寄付/Patreon中心の収益 | AniList, Anime-Planet, AnimeThemes | 広告だけに頼らず、コアファンからの少額課金で持続 |

