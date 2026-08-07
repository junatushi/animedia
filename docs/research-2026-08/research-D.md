# 領域D: 会話なしで届く配信チャネル — リサーチメモ（2026-08-07）

前提: リプライ・DM・フォロー営業は一切しない。予算ゼロ。GitHub Actions等での自動化を優先。
出典はすべてWebSearch/WebFetchで取得したもの。**確認できなかった/推測を含む箇所は「推測」と明記**。

---

## 1. Reddit r/anime（会員1,440万人 [gummysearch.com/r/anime](https://gummysearch.com/r/anime/)）

- r/animeは公開wikiを持つ（`wiki.r-anime.moe`、GitHubミラー [r-anime/public-wiki](https://github.com/r-anime/public-wiki)）。トップページの案内文言から、Reddit運用ルール・**合法配信/ダウンロードサイト一覧（Legal Streams/Downloads）**・サブレディットFAQ・モデレーター情報のセクションがあることが検索結果のスニペットで確認できた（[Welcome to /r/anime! | public-wiki](https://wiki.r-anime.moe/)）。ただし直接のページ取得はサイト側で403（WebFetch/クローラーブロック）となり、自己宣伝ルールの一次文言は今回**確認できなかった**（要ブラウザでの手動確認）。
- 類似の「合法配信リンク集」の実例として海外の `because.moe`（[Anime Inferno記事](https://www.animeinferno.com.au/2015/09/11/because-moe-anime-streaming-search-engine-that-could/)）がある。タイトルを入力するとCrunchyroll/Funimation/Huluなど主要配信先ロゴが光り、直接飛べる仕組み。**米国内配信限定**（日本語タイトル・別題では引っかからない弱点あり）。個人開発者がGoogleで合法配信サイトが見つけにくいという不満から作った、という経緯がアニメコミュニティに受け入れられた実例（[alternativeto.net](https://alternativeto.net/software/because-moe)）。→「配信先ID的な一覧サイト」自体はアニメファン層に需要があり得るというポジティブ材料。
- **推測**: r/animeは一般的なRedditの慣習（90/10ルール的な自己宣伝抑制、個人サイトの直接告知は基本NGでモデレーター許可制）に従っている可能性が高いが、これは一般論からの推測であり、r/anime固有の一次ルール文言は未確認。
- **規約上OKか**: 不明（要手動確認）。**自動化できるか**: 投稿行為自体はReddit ToS上、機械的な自動投稿は多くのサブレディットでスパム扱いされ**禁止**の可能性が高い。少なくとも「本人が定期的に手動でwikiの合法配信一覧への掲載申請を出す」程度の一回的な行為に留めるべき。
- **結論（禁止範囲の明記）**: 自己サイトへのリンクをr/animeの一般スレッドやコメント欄に自動/反復投稿するのは**禁止**（スパム・自己宣伝規約違反のリスク大）。唯一の現実的な入口は、モデレーターに一次情報として「合法配信リンク集wiki」への掲載を**1回だけ人力で依頼**すること（会話ではなく申請フォーム/modmailの投稿1通のみなら「絡み」に該当しないと解釈できる）。ただし本人の「リプライ・DM・絡み一切しない」方針とmodmail送信が抵触するかは判断が必要なため、実行するかはユーザー判断に委ねる。

## 2. Discord bot / bot listing

- top.gg には`anime`/`animes`/`streaming`タグでアニメ関連botが多数登録されている（[top.gg/tag/anime](https://top.gg/tag/anime)、[top.gg/tag/streaming](https://top.gg/tag/streaming)）。
- 実例:
  - **AniSearch**（[top.gg/bot/737236600878137363](https://top.gg/bot/737236600878137363)）: `watch`コマンドでAniList IDのアニメをサーバーのウォッチリストに追加、`set`コマンドで通知先チャンネルを指定 → 新エピソード配信時に自動通知。
  - **AniTrack**（[anitrack.co](https://anitrack.co/)）: MyAnimeList/AniList連携、カスタマイズ可能な通知頻度でエピソード配信を追跡。
  - **AniSchedule**（[GitHub: TehNut/AniSchedule](https://github.com/TehNut/AniSchedule)）: 新エピソードが出たら通知するDiscord bot。
  - **anime-notifier**（[GitHub](https://github.com/developerrahulofficial/anime-notifier)）: エピソード配信時に視聴用リンクをDiscord内に直接表示。
  - 日本語圏では Annict 公式連携ではないが、**naskya/annict-discord-bot**（[GitHub](https://github.com/naskya/annict-discord-bot)）のようにAnnictの視聴記録をDiscordに転送する個人製botが存在（配信情報そのものではなく視聴ログ転送だが「Annictデータ→Discord露出」という導線は同じ構造）。
- **会話なしで露出する仕組み**: これらのbotは「サーバーに追加すると自動でエピソード通知が流れる」形が主流で、通知メッセージ内に配信先へのリンクを含める設計が一般的。**自サイトが担えるのは「配信先アグリゲーター」としてのAPIデータソース**であり、既存の`/api/work/[id]`（CORS許可・APIキー不要、2026-08-06導入）や`/embed/anime/[id]`をこうしたbot作者に使ってもらえれば、bot経由の通知に自サイトのリンクが載る可能性がある。
- **規約上OKか**: 自分でDiscord botを作りサーバーに導入・top.ggに登録するのは規約上問題なし（Discord Developer Policy・top.gg利用規約の範囲内。営業目的の勧誘DMは別途Discord ToS違反になりうるので注意）。
- **自動化できるか**: bot自体（通知配信）は完全自動化可能。ただし「サーバーへの導入」は各サーバー管理者の手動操作が要る（=これも一種の営業だが、勧誘なしで「発見されて追加してもらう」なら会話なし施策として成立）。
- **難易度**: 中〜高（Discord bot開発・ホスティングの継続運用コストが発生。無料ホスティング先の確保が必要）。

## 3. X（Twitter）: 会話なしで伸びているアニメ情報bot

- **またアニメ見てる関東番組告知Bot**（[@MataAnimeMiteru](https://x.com/MataAnimeMiteru)）: しょぼいカレンダーからデータ取得し、放送5分前に番組告知・放送終了後に視聴者数情報を自動投稿。2008年開始、フォロワー1,596人（[Twilog](https://twilog.togetter.com/MataAnimeMiteru)）。**会話なし・機械的投稿のみで長期運用されている実例**として参考になる。ただしフォロワー規模自体は小さく、「botで自動投稿するだけ」では急成長しないことも同時に示している。
- 公式アニメ局アカウント（NHKアニメ [@nhk_animeworld](https://x.com/nhk_animeworld)、TBSアニメ [@tbs_animation](https://x.com/tbs_animation)、[アニメ！アニメ！ @animeanime_jp](https://x.com/animeanime_jp)）はニュース配信型で、bot色は薄いが「一方向の定期情報発信のみ」という運用スタイルは同じ。
- **推測**: 大きくフォロワーが伸びているアニメ情報botの多くは、(a) 独自ニュース速報性（新PV解禁・声優発表など一次情報の速さ）か、(b) キャラクター/画像bot的なエンタメ価値のどちらかを持つ。「配信先一覧の淡々とした告知」だけのbotが急成長した確証は今回の検索では見つからなかった（=御社の実測「70投稿・反応ゼロ」と整合的）。
- **規約上OKか**: 自動投稿自体はX ToS上問題なし（多くのbotが公然と運用されている）。ただし2026年のAPI従量課金化によりコストが発生する点はCLAUDE.mdに既出の通り。
- **自動化できるか**: 完全に自動化できる（GitHub Actionsで実装済み）。

## 4. Bluesky: カスタムフィード/スターターパック/ラベラー

- **カスタムフィード**: AT Protocolの機能で、購読すると相手のホーム画面に「フィード」として並ぶ（[docs.bsky.app/docs/starter-templates/custom-feeds](https://docs.bsky.app/docs/starter-templates/custom-feeds)）。スターターキット（[bluesky-social/feed-generator](https://github.com/bluesky-social/feed-generator)、Python版[MarshalX/bluesky-feed-generator](https://github.com/MarshalX/bluesky-feed-generator)）で自前ホスト可能。`langs:ja`指定で日本語投稿のみに絞るフィード実装例あり。
- ノーコードでも作れる**Bluesky Feed Creator**（[blueskyfeedcreator.com](https://blueskyfeedcreator.com/)）: お気に入り投稿をリスト化してフィードとして公開できるツール。
- **スターターパック**: 2024年6月導入（v1.87、[orefolder.jp](https://orefolder.jp/2024/06/bluesky-v187-starter-packs/)）。おすすめアカウント＋カスタムフィードをまとめて共有できる機能。ただし検索結果から、**日本語圏でアニメ関連のスターターパックはほぼ未整備**という言及があった（[nejimaki-radio.comのディレクトリ記事](https://nejimaki-radio.com/bluesky-starter-pack-directory-search/)）。→ 競合が少ない=空白地帯である可能性（推測）。
- **日本語アニメ層の実情**: 検索では日本語アニメ特化のBlueskyカスタムフィードの具体例は見つからなかった（英語圏の話題別フィードは多数存在するが、和アニメ特化は手薄という印象。推測含む）。
- **規約上OKか**: 完全にOK。Bluesky公式が推奨する使い方そのもの。
- **自動化できるか**: フィード生成ロジック（「今期アニメ」「配信情報」関連の投稿を集めるアルゴリズムフィード）はサーバー常駐が必要で、GitHub Actionsの単発実行だけでは完結しない（常時稼働のfeed generatorサーバーが必要 = 無料枠のホスティング先探しが課題）。スターターパック自体は一度作れば更新不要に近く、実装コストは低い。
- **難易度別の狙い目**: スターターパック作成（低コスト・弱い効果、推測）／カスタムフィード常時運用（中コスト・空白地帯ゆえ当たれば効果、推測）。

## 5. Misskey/Fediverse・ニコニコ・LINEオープンチャット・5ch/したらば・Telegram

- **Misskey.io**: 「アニメ・漫画・ラノベ総合部」チャンネル（[misskey.io/channels/9bei48zafq](https://misskey.io/channels/9bei48zafq)）、「配信すきー」チャンネル（[misskey.io/channels/9br8hbne76](https://misskey.io/channels/9br8hbne76)）などアニメ・配信視聴の話題チャンネルが存在。チャンネルへの投稿は「参加して投稿する」形が基本で、会話なし运用には向かない（チャンネルは会話の場）。ただしMisskeyもActivityPub（Mastodon等と相互接続）に対応しているため、**Mastodon自動投稿と同じ仕組みでMisskey.io向けにも投稿can可能**（現状Bluesky/Mastodon/Threadsのみ対応と記載があるため、Misskeyは未対応チャネル。追加コストは低いはず=既存のMastodon投稿ロジックを流用できる可能性、推測）。
- **LINEオープンチャット**: 匿名参加・最大1万人のコミュニティ機能（[LINEヘルプ](https://help.line.me/line/smartphone/sp?contentId=20005375&lang=ja)）。アニメ実況・ジャンル別ルームが多数存在するとの言及あり（[kuzen.io記事](https://kuzen.io/blogs/line-official-open-chat)）が、**公式Bot APIでの一方向投稿は仕組み上「トーク」への参加が前提**になりやすく、会話が発生しない形での定期投稿は事実上難しい（推測）。またオープンチャットは「その場に居る」ことが期待されるコミュニティ形式であり、無言の自動投稿だけの参加は場を荒らす扱いになりやすい。**低優先度**。
- **5ch/したらば**: アニメ実況板・番組chなどが存在（[itest.5ch.net](https://itest.5ch.net/subback/jasmine)、[kizuna.5ch.net/anime2](https://kizuna.5ch.net/anime2/)）。したらば掲示板にもアニメカテゴリあり（[jbbs.shitaraba.net/bbs/subject.cgi/anime](https://jbbs.shitaraba.net/bbs/subject.cgi/anime/3582/)）。これらは匿名掲示板でスレッド内発言（=会話）が前提のため、無言のリンク投稿は**スレ荒らし扱いされスパム認定・削除・アク禁のリスクが高い＝実質禁止**と判断すべき。**推奨しない**。
- **Telegram**: アニメ配信チャンネルの多くは違法視聴（無断アップロード）コミュニティが中心という検索結果だった（[telegrampick.com](https://telegrampick.com/best-anime-channels-on-telegram/)等）。合法配信情報の告知チャンネルという文脈での実例は見つからなかった。日本語ユーザー基盤も薄い。**低優先度**。
- **ニコニコ**: 今回の検索では直接的な実例は見つからず（時間の都合上深掘り未了）。ニコニコ生放送のタイムシフト/コミュニティ機能を使った定期情報番組化は一定の実例がある領域だが、配信告知単体での成功事例は未確認。

## 6. 「SNSではない」購読チャネル: iCalendar/RSS/IFTTT・Zapier/Googleカレンダー

- **しょぼいカレンダー**（[cal.syoboi.jp](https://cal.syoboi.jp/)）: 老舗のアニメ放送カレンダー。RSS 1.0・iCalendar・JSON等複数フォーマットでの取得に対応し、仕様が公開されている（[docs.cal.syoboi.jp/spec/feeds/](https://docs.cal.syoboi.jp/spec/feeds/)、[docs.cal.syoboi.jp/spec/rss.php/](https://docs.cal.syoboi.jp/spec/rss.php/)）。Annictも「しょぼいカレンダーのタイトルID(TID)」をAPIで取得できるようにする形で相互運用している（[Annict Developers Blog](https://developers.annict.com/blog/2019-02-09-syobocal-tid)）。→ **iCal/RSS購読は日本のアニメファン層で既に定着した文化**であることの裏付け。
- **Annict自身もGoogleカレンダー連携機能を持つ**（放送予定の作品・エピソードをGoogleカレンダーで閲覧可能。[Annict Forum投稿](https://annict.com/forum/posts/99)）。データソースが同じAnnictである自サイトも同様のiCal出力を追加する土台がある。
- **LiveChart.me**はRSSフィード提供（放送済みエピソード・ヘッドライン向け。[livechart.me/pages/rss](https://www.livechart.me/pages/rss)）だが、公開APIは無いと明記（[FAQ](https://livechart.me/pages/faq)）。iCal購読の明記は見当たらなかった。
- **映画.com**は一般映画公開日のiCal公開を提供（[eiga.com/info/ical](https://eiga.com/info/ical/)）。「公開スケジュールをiCalで配る」こと自体は日本の一般ユーザー向けサービスとして受け入れられている実例。
- **VTuber配信スケジュールをGoogleカレンダーへ自動同期するChrome拡張**（[note記事](https://note.com/alvis8039/n/n0368cf9c2080)）や、YouTube配信予定を.ics化する技術記事（[tech-note.info](https://tech-note.info/entry/youtube_calendar_sync)）が個人開発の実例として存在。
- **規約上OKか**: 完全にOK（自サイトが単に`.ics`/RSSエンドポイントを追加公開するだけで、外部規約は関係しない）。
- **自動化できるか**: 完全に自動化できる。既存の`/api/season`や`/api/work/[id]`のデータをiCalendar形式に変換するエンドポイントを1本追加するだけで実装可能（サーバーはNext.jsのRoute Handlerで完結、cron不要）。IFTTT/Zapierは「RSSフィードを検知してX/LINE等に転送」の橋渡しに使えるが、ユーザー側が個別に設定する前提のツールであり、こちらから自動化できる部分は「良いRSSフィードを用意すること」まで。
- **難易度**: 低（実装は小さい）。**効果は推測**だが、しょぼいカレンダー文化があるファン層に「布教」できれば継続利用者を静かに積み上げられる可能性がある。

## 7. Wikipedia/Wikidata

- **Wikidata**: 汎用の「公式サイト」プロパティ P856（[Property:P856](https://www.wikidata.org/wiki/Property_talk:P856)）に加え、MyAnimeList ID (P4086)・AniDB ID (P5646)・Kitsu ID (P11495) など**アニメ専用の外部データベースID用プロパティが多数整備**されている（[wikidata.org](https://www.wikidata.org/wiki/Property:P4086)）。しかし「配信サービス一覧サイト」向けの汎用プロパティは存在せず、あるとすれば汎用のP856（公式サイト）だが**それは作品公式サイト用**であり、非公式の第三者配信一覧サイトを個々の作品項目に載せる慣行は確認できなかった。**Wikidata経由の掲載は現実的でない**（対象外と判断）。
- **日本語版Wikipedia 外部リンクガイドライン**（[Wikipedia:外部リンク](https://ja.wikipedia.org/wiki/Wikipedia:%E5%A4%96%E9%83%A8%E3%83%AA%E3%83%B3%E3%82%AF)）: 中立的な観点・検証可能性・独自研究禁止が適用され、著作権侵害サイトやブラックリスト入り広告サイト、販売以外に特筆性のないサイトは禁止対象、との要約が得られた（一次条文の詳細取得は403で不可）。
- **英語版Wikipediaの外部リンクガイドライン(WP:ELNO)**: ファンサイトは「対象を公式にコントロールしていない」という理由で原則掲載対象外（[Wikipedia:ELNO](https://en.wikipedia.org/wiki/Wikipedia:ELNO)）。「generally avoid」であって絶対禁止ではなく、専門性が認められる場合の例外もあるとの記載。→ **広告収入があり第三者運営の配信情報サイトは、英語版・日本語版いずれのガイドラインに照らしても「外部リンク」節への追加は原則不可**と判断すべき。
- **規約上OKか**: **原則NG**。特に自分で自分の記事に追加する行為はWikipedia:自分自身の記事の編集（COI）方針にも抵触しうる。
- **自動化できるか**: 該当なし（そもそも推奨しない）。
- **結論**: この経路は**事実上使えない/推奨しない**。類似サイト（because.moe等）がWikipedia外部リンクに掲載されている確証も見つからなかった。

---

## 総括表（推測含む）

| # | チャネル | 実在の成功例 | 規約 | 自動化 | 優先度(推測) |
|---|---|---|---|---|---|
|1|Reddit r/anime|合法配信wiki(未確認), because.moe(海外)|投稿は要確認/自動投稿は概ね禁止|申請のみ手動|低〜中|
|2|Discord bot/top.gg|AniSearch, AniTrack, AniSchedule|OK|通知は自動、導入は手動|中|
|3|X 情報bot|またアニメ見てるBot(1,596F)|OK|完全自動(実装済)|低(既に実施・伸びず)|
|4|Blueskyフィード/SP|Bluesky公式機能|OK|フィード常駐要/SPは低コスト|中|
|5|Misskey/5ch/LINE/Telegram|Misskeyチャンネル/5ch実況板|5ch等は実質禁止、Misskeyは可能性あり|Misskeyは既存ロジック流用可、他は低実現性|低|
|6|iCal/RSS購読|しょぼいカレンダー、映画.com、Annict|OK|完全自動、実装小|**高**|
|7|Wikipedia/Wikidata|該当実例なし(WP:ELNOで原則不可)|原則NG|該当なし|対象外|
