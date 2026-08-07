# I: 隣接する未充足の検索需要（アニメ視聴の周辺質問）

調査日: 2026-08-07 / 手法: WebSearch（WebFetchは`detail.chiebukuro.yahoo.co.jp`・
`developers.annict.com`とも EGRESS_BLOCKED で使用不可。検索結果スニペット・タイトルのみで判断）
表記: 【事実】= 出典で確認できた記述、【推測】= 調査者の解釈

---

## 0. 結論の先取り（詳細は各節・末尾）

検索して分かったのは、「見放題いつまで」「サブスク解約すべきか」「原作何巻から」は
**既に専業サイトが埋めている**枠で、当サイトが今から入っても勝ち目が薄いということ。
一方で **Annictの`seriesList`（シリーズ関連作品）フィールドが今のコード
（`lib/annict.ts`）で一切使われていない** ことが分かった。視聴順（見る順番）は
知恵袋で繰り返し聞かれているが、有名フランチャイズは既にブログが埋めている一方、
マイナー作品・今期の続編は誰も書いていない。ここは機械的に量産できる数少ない枠。

---

## 1. 質問ごとの一覧表

| # | テーマ | 実在する質問文（引用） | 出典URL | 現在誰が答えているか | 手元データ（Annict経由）で答えられるか |
|---|---|---|---|---|---|
| 1 | 見放題期限の意味 | 「U-NEXTでアニメ見てると配信終了期限が表示されてるのに結局配信終了しなかった作品があることがありますがなぜですか？」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q13290137488 | 知恵袋のみ（回答は憶測ベース） | **答えられない**。Annictは「配信終了」を記録しない（放送/配信の実績記録＝programsのみ。詳細はCLAUDE.md⑰参照） |
| 2 | 見放題期限の表示 | 「アベマってたまに消えるアニメがありますけど消えるまに予告とかはどこで見れますか」（回答内に「作品ページに配信期間何年何月何日までな…」の引用あり） | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q13291114673 | 知恵袋のみ | **答えられない**（同上） |
| 3 | dアニメの配信期限 | 「最近dアニメストアでアニメを観るようになったのですが、配信終了とはどういうこと…」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q14308159669 | 知恵袋＋`animephilia.net`（後述） | **答えられない** |
| 4 | Netflix個別作品の終了時期 | 「Netflixで鬼滅の刃が10月9日で配信終了となっているのですが復活はす…」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q12319789277 | 知恵袋、個人ブログ（chino-markblog.com等） | **答えられない** |
| 5 | レンタル移行の分かりにくさ | 「dアニメストアのレンタル期間について分かりにくかったので解説お願いしたいです…」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q13267695058 | 知恵袋のみ | **答えられない**（見放題/レンタルの切替もAnnict管轄外） |
| 6 | シリーズの見る順番（一般） | 「アニメのとあるシリーズを全部見ようと思っているのですが、見る順番を教…」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q14308162574 | 知恵袋＋**有名作は**専業まとめブログ多数 | **一部答えられる**（後述2節） |
| 7 | 物語シリーズの順番 | 「物語シリーズの見る順番を知りたいです。そして、途中のシリーズか…」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q11304027991 | **飽和**（ABEMA公式特設ページ含め8サイト以上が上位表示） | 理論上は`seriesList`で可能だが、この作品は既に飽和しており参入価値なし |
| 8 | ガンダムの順番 | 「ガンダムはどの順番から見るべきなのでしょうか。全部見る予定です。宇…」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q13325902903 | 多数の専業ブログ | 同上（飽和） |
| 9 | ポケモンの順番 | 「ポケモンのアニメを見ているのですが、古い順番で見たいのですがどの順…」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q13302531343 | 知恵袋＋一部ブログ | `seriesList`があれば機械的に一覧化できる可能性あり（未検証） |
| 10 | 何話まで配信/1期は何巻分 | 「アニメ1期は基本12話で最終回を迎えますが例えば原作漫画が全15巻あったとしたら平均的に1期で何巻分進むのでしょうか？わかりに…」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q13317963693 | 知恵袋（回答は「作品ごとに違う」で終わる） | **答えられない**（Annictは話数↔巻数の対応を持たない） |
| 11 | アニメの続きは原作何巻から | 「【推しの子】続きは何巻から?アニメ3期の続き=原作13巻128話〜」 | https://note.com/anime_review_lab/n/nc4f838466425 | 人気作のみ個人ブログが個別に手書き（推しの子・呪術廻戦・コナン等） | **答えられない**（同上。人力で作品ごとに対応表を作るしかなく、`content/works/`の思想を流用しても継続更新コストが高い） |
| 12 | 無料視聴方法 | 「スマホで完全無料でかなり多くのアニメが見れるアプリ教えてください」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q14324020094 | 知恵袋＋大量のVODアフィ比較記事（vod.app-liv.jp等） | **部分的に答えられる**が価値は低い。TVer/ABEMAの「今期の無料見逃し配信」は`classifyChannel`のサービス判定で既に表現できているはずで新規性なし |
| 13 | 今期何を見るか決められない | 「今期のアニメで見るべきものを教えてください。」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q13317255418 | 知恵袋（回答は個人の主観推薦） | **部分的に答えられる**。`watchersCount`（Annictの視聴者数）でランキングは作れる（既にSNS投稿のTOP5枠で実施済み＝`content/sns/`）。「あなたに合う1本」のような趣味診断はAnnictにジャンル/タグ情報が無いため不可（本調査では未確認、下記5節参照） |
| 14 | サブスク解約すべきか/乗り換え | （chiebukuro個別の実例は本調査では特定できず。一般記事は多数ヒット） | https://dream.jp/douga/tips_d/article34750.html 等 | **飽和**（大手VOD比較アフィサイトが多数・価格比較が主戦場） | 答えられるが無価値。価格・パーソナル事情の話でAnnictのデータ範囲外 |
| 15 | 声優の別作品での役 | 「アニメの声優を一定数知ってしまったら違うアニメで同じ声優さんが演じたら…」 | https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q10277857315 | 知恵袋＋まとめサイト（rank1-media.com等・ランキング形式で汎用トリビア） | **答えられる**。`casts`は既に取得済み（`lib/annict.ts`のCREDITS_FIELDS）。ただし「同じ声優が演じた別キャラ」を横断検索する機能は未実装 |

---

## 2. 視聴順・シリーズ順を扱っているサイトの実例

### 日本語
- 物語シリーズ・青のエクソシスト・黒執事・転スラ・ウマ娘・ワンパンマンなど、**人気フランチャイズは
  ほぼ確実に複数の専業/個人ブログが「見る順番」記事を持つ**（例:
  https://subsc-hikaku.net/ao-no-exorcist-miru-junban/ 、
  https://www.entameyell.com/tensura-order/ 、ABEMA公式特設ページ
  https://abema.tv/lp/monogatari-viewingorder ）。多くは「放送順」「時系列順」の
  2軸＋対応VODサービス紹介（＝アフィリエイト導線）という同じ型。データは**手作業でまとめた表**で、
  APIやDBを持たない静的記事がほとんど（確認できた範囲）。
- コナン等「原作に追いついた/未読でも大丈夫か」系は個別ブログの手動更新
  （例: https://detective-conan-blog.com/11380 ）。

### 英語
- **Anime In Order**（animeinorder.com）: recommended/release/chronological/completionist/custom
  の複数軸で視聴順を提示。FateやMonogatari、Gundamなど複雑フランチャイズに特化。
- **I Crave Anime**（icraveanime.com/categories/watch-orders/）: One Piece・Naruto・鬼滅・進撃等、
  filler回のスキップ情報も含む。
- **MyAnimeList**（myanimelist.net/stacks/61691等）: フォーラムのユーザー投稿ガイド集（Stacks機能）。
  構造化データではなくコミュニティ投稿のリスト。
- いずれも**大手フランチャイズに人力で個別対応**する形で、Annictのような配信元データベースを
  自動連携させて視聴順を機械生成しているサービスは見つからなかった（本調査の範囲では未発見）。

### 示唆
「見る順番」需要自体は大きいが、**有名作品はすでに供給過多**。当サイトが勝ち筋を持つとすれば、
「マイナー作品・今期の続編（1期からN期まで）」のロングテール - 大手ブログが記事化する動機
（PV/アフィ収益）がない領域。ただしAnnictの`seriesList`を使っても、それが「見る順番」として
妥当な並び（劇場版を時系列のどこに挟むか等）を機械的に返せるかは**未検証**（本調査では
`developers.annict.com`がブロックされ、実際のレスポンス例を取得できなかった）。

---

## 3. Annictの`seriesList`フィールドについて（今回の発見）

- Annict Developers公式ブログ「GraphQL APIで作品に紐づくシリーズ情報が取得できるようになりました」
  （2019-04-14）によると、`Work.seriesList`でシリーズ名と、そのシリーズに属する関連作品
  （タイトル・`seasonYear`・`seasonName`・任意の`summary`＝劇場版かTV版かなどの区別）が取得できる。
  出典: https://developers.annict.com/blog/2019-04-14-series-list
- **現状のコード（`lib/annict.ts`のSEASON_QUERY/WORK_QUERY）はこのフィールドを一切クエリしていない**
  （grep確認済み。`series`という文字列はファイル内に0件）。
- `seasonYear`+`seasonName`があれば、同一シリーズ内の作品を放送時系列順に並べること自体は機械的に
  可能（＝「放送順」の視聴順リストは作れる）。ただし「劇場版をどこに挟むと分かりやすいか」
  「時系列順」まではAnnictのフィールドだけでは判定できない可能性が高い（`summary`が
  自由記述であれば構造化された順序情報ではないため）。
- **未検証事項（重要）**: 本調査環境では`developers.annict.com`・`api.annict.com`双方への
  WebFetch/curlが遮断されており、実際に`seriesList`クエリを打って戻り値を確認できていない。
  実装検討時は、このリポジトリの通常の実行環境（Annictへの疎通がある）で
  `ANNICT_TOKEN`を使い、まず数作品（例: 物語シリーズ、幼女戦記）で試験クエリを打ち、
  ①どの程度のシリーズに`seriesList`が付与されているか（Annictはコミュニティ更新なので
  網羅率が不明）、②`summary`の中身が構造化されているか、を確認してからでないと
  「データで答えられる」と断定できない。

---

## 4. 配信終了予定・見放題→レンタル移行の情報源

- **公式**: dアニメストアは作品個別ページに終了日を出さず、「お知らせ」ページに直近の終了予定作品を
  まとめて掲載（https://animestore.docomo.ne.jp/animestore/CN/CN00000001 、
  クエリ`q=配信終了`で絞り込み）。ただし構造化データやAPIではなく、告知文の羅列。
  バンダイチャンネルは`b-ch.com/subscription/end_soon.html`で終了間近作品の一覧ページを持つ
  （こちらも公式・構造化されたページだが自動取得を想定したAPIではない）。
- **非公式・第三者集計**: `animephilia.net`がdアニメストア・Netflix・Amazon Prime Video（＋
  dアニメ for Prime Video）それぞれの「配信終了予定カレンダー」を個別ページで運用している。
  X（旧Twitter）にも`@d_end_anime`（dアニメ配信終了専門アカウント）が存在する。
  出典: https://animephilia.net/danimestore-expired-animes-calendar/ ,
  https://animephilia.net/netflix-expiring-calendar/ ,
  https://x.com/d_end_anime
- **重要な留保**: 知恵袋の実例（#1・#2）が示す通り、**サービス側が表示する終了予定日自体が
  覆ることがある**（「配信終了期限が表示されてるのに結局配信終了しなかった」）。つまり
  この情報は一次情報として取得できても「事実」として断定しにくい性質を持つ。
  当サイトの「一次情報で確認できた事実だけを書く」方針・および放送終了作品の表現ルール
  （CLAUDE.md「放送が終わった作品に『いま配信中』と書かない」）と同じ理由で、**終了予定日の
  掲載は誤情報リスクが高く、現状のAnnict由来データからは導出不可能**と結論する。
- **結論**: Annict経由では一切取得できない。取得するとすれば各社の告知ページを人力または
  スクレイピングで巡回する必要があり、しかも表示自体が覆る不安定な情報 -
  `extraServices.ts`的な「一次情報のみ・出典明記」の運用にも馴染みにくい（終了予定は
  未来の予定であって確定事実ではないため）。

---

## 5. 未確認のまま残った点（正直な申告）

- Annict WorkにジャンルやタグのフィールドがあるかはWebSearchのみでは確証を得られなかった
  （`developers.annict.com`のスキーマ本文を取得できなかったため）。「今期何見るか迷う」への
  ジャンル別・雰囲気別のレコメンドは、ジャンル情報の有無次第で実現可否が変わる。実装前に
  Annict GraphQLスキーマを直接（このサンドボックス外の通常環境で）確認する必要がある。
- `seriesList`の網羅率・データ品質（3節参照）も同様に未検証。

---

## 6. 除外した/深掘りしなかった論点

- 「サブスク解約すべきか」「乗り換え」は完全に大手VOD比較アフィサイトの土俵で、Annictのデータ
  範囲（作品・配信・声優等）とも無関係なため対象外とした。
- 「無料で見る方法」は違法サイト誘導との境界が近く、かつTVer/ABEMAの無料見逃し配信は
  既存の`SERVICES`分類で表現済みのため新規コンテンツ化の価値が低いと判断した。
