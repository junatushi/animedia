// 作品の通称・略称を人力で登録する一覧。正式タイトルでは検索にヒットしない
// 「リゼロ」「シャンフロ」のような呼び方でも作品を見つけられるようにする。
//
// 方針（content/works/ 内の他ファイルと同じ。CLAUDE.md「推測で埋めない」に準拠）:
//  - Wikipedia・公式サイト/SNS等の一次〜信頼できる二次情報で「その呼び方が実際に
//    広く使われている」ことを確認できたものだけ登録する。思いつきや語感だけでは足さない。
//  - 各エントリに確認元（sourceUrl）と確認日（confirmedDate）を構造化データとして持つ
//    （series.ts / extraServices.ts と同じ形。コメントだけに置かない）。
//  - 対象は着手しやすい人気作から（全作品を追うのは非現実的。docs/growth-ideas.md参照）。
//
// key:   Annict の annictId（作品ID）
// value: WorkAlias（通称・略称の配列＋出典URL＋確認日）
//
// 使われ方:
//  - サイト内検索の部分一致（components/SeasonExplorer.tsx。表示中クール・クール横断の
//    両方で、タイトル・声優/スタッフ名と同じ扱いで使う）。
//  - 作品ページ（app/anime/[id]/page.tsx）の**可視テキスト**と、JSON-LD の
//    `alternateName`。
//
// 経緯（2026-08-19）: 実測で、登録済みの略称が**レンダリング後のHTMLに1回も出て
// いない**ことが判明した（/anime/9733 の本番HTMLで「シャングリラ」33回に対し
// 「シャンフロ」0回・「鳥頭」0回。JSON-LD の alternateName は0箇所）。つまり
// 検索エンジンから見ると略称の語彙が存在しないのと同じ状態で、サイト内検索でしか
// 効いていなかった。GSCには「逃げ若 2期 配信」14表示・平均31.6位のように略称
// クエリが実際に出ているため、略称をページに出す。
//
// 出すときは**可視テキストと機械可読（JSON-LD）の両方に同じことを書く**こと。
// 片方だけに出すのは、このリポジトリが WatchAction を撤回した理由（可視テキストに
// 無い主張が機械可読の層にだけ残る）と同じ壊れ方になる。
export type WorkAlias = {
  /** 通称・略称（複数可）。表示順もこの順。 */
  names: string[];
  /** 出典URL（一次〜信頼できる二次情報）。 */
  sourceUrl: string;
  /** 出典を確認した日（"YYYY-MM-DD"）。 */
  confirmedDate: string;
};

export const WORK_ALIASES: Record<number, WorkAlias> = {
  // Re:ゼロから始める異世界生活: 略称は「リゼロ」
  15787: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-07-11",
  }, // 4th season 喪失編（2026春）
  17197: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-07-11",
  }, // 4th season 奪還編（2026夏）

  // 転生したらスライムだった件: 略称は「転スラ」
  14066: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 第4期（2026春）
  14065: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 劇場版 蒼海の涙編（2026冬）

  // 呪術廻戦: 略称は「呪術」
  12323: {
    names: ["呪術"],
    sourceUrl: "https://ja.wikipedia.org/wiki/呪術廻戦",
    confirmedDate: "2026-07-11",
  }, // 死滅回游 前編（2026冬）

  // 僕のヒーローアカデミア: 略称は「ヒロアカ」（公式アニメアカウントの表記名にも使用）
  16266: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // ヴィジランテ -僕のヒーローアカデミア ILLEGALS- 第2期（2026冬）
  16901: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // More（2026春）
  17543: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // I am a hero too（2026夏）

  // シャングリラ・フロンティア〜クソゲーハンター、神ゲーに挑まんとす〜:
  // 略称は「シャンフロ」（公式Xアカウント名にも使用: @ShanFro_Comic）。
  // 主人公の見た目（鳥頭のアバター）も広く言及される通称的な呼ばれ方
  // （アニメ！アニメ！・RealSound等の記事見出しで使用）。
  // sourceUrl にはWikipediaを採用。「鳥頭」の裏付けは以下の2本（いずれも2026-07-11確認）:
  //   https://animeanime.jp/article/2023/10/08/80447.html
  //   https://realsound.jp/book/2020/11/post-653695.html
  9733: {
    names: ["シャンフロ", "鳥頭"],
    sourceUrl:
      "https://ja.wikipedia.org/wiki/シャングリラ・フロンティア〜クソゲーハンター、神ゲーに挑まんとす〜",
    confirmedDate: "2026-07-11",
  }, // 1st season（2023秋）
  12866: {
    names: ["シャンフロ", "鳥頭"],
    sourceUrl:
      "https://ja.wikipedia.org/wiki/シャングリラ・フロンティア〜クソゲーハンター、神ゲーに挑まんとす〜",
    confirmedDate: "2026-07-11",
  }, // 2nd season（2024秋）

  // 逃げ上手の若君: 略称は「逃げ若」
  // 出典に「「逃げ若」は漫画「逃げ上手の若君」の略称です」と明記
  14132: {
    names: ["逃げ若"],
    sourceUrl: "https://dic.pixiv.net/a/逃げ若",
    confirmedDate: "2026-07-12",
  }, // 第二期（2026夏）

  // 君のことが大大大大大好きな100人の彼女: 略称は「100カノ」
  // 出典の本文冒頭に「略称は「100カノ」」と明記
  16658: {
    names: ["100カノ"],
    sourceUrl:
      "https://ja.wikipedia.org/wiki/君のことが大大大大大好きな100人の彼女",
    confirmedDate: "2026-07-12",
  }, // 第3期（2026夏）

  // これ描いて死ね: 略称は「これ死ね」（出典に「略称は「これ死ね」。」と明記）
  15751: {
    names: ["これ死ね"],
    sourceUrl: "https://dic.nicovideo.jp/a/これ描いて死ね",
    confirmedDate: "2026-07-14",
  }, // 2026夏

  // 透明な夜に駆ける君と、目に見えない恋をした。: 略称は「かけ恋」
  16714: {
    names: ["かけ恋"],
    sourceUrl:
      "https://ja.wikipedia.org/wiki/透明な夜に駆ける君と、目に見えない恋をした。",
    confirmedDate: "2026-07-14",
  }, // 2026夏

  // きみが死ぬまで恋をしたい: 略称は「きみ死ぬ」（出典の脚注2で確認）
  15557: {
    names: ["きみ死ぬ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/きみが死ぬまで恋をしたい",
    confirmedDate: "2026-07-14",
  }, // 2026夏

  // ここから追加登録（2026-08-07）: 過去クール（2010〜2025年）の有名作を対象に、
  // content/snapshots/*.json から watchers（注目度）が高く services が1件以上ある
  // 作品を選び、略称の実在を出典で確認して追加。既に登録済みのシリーズは
  // 過去クールのIDにも同じ略称を紐づけている（sourceUrl は各シリーズの初出と同じ。
  // confirmedDate はこの追加登録日）。

  // Re:ゼロから始める異世界生活: 略称は「リゼロ」（出典は15787/17197の項と同じ）
  6582: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-08-07",
  }, // 2nd season（2020夏）
  7541: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-08-07",
  }, // 2nd season 第2部（2021冬）
  10627: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-08-07",
  }, // 3rd season 襲撃編（2024秋）
  13894: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-08-07",
  }, // 3rd season 反撃編（2025冬）

  // 転生したらスライムだった件: 略称は「転スラ」（出典は14066/14065の項と同じ）
  5789: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-08-07",
  }, // 1st season（2018秋）
  6617: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-08-07",
  }, // 第2期（2021冬）
  7411: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-08-07",
  }, // 第2期 第2部（2021夏）
  10176: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-08-07",
  }, // 第3期（2024春）

  // 呪術廻戦: 略称は「呪術」（出典は12323の項と同じ）
  7162: {
    names: ["呪術"],
    sourceUrl: "https://ja.wikipedia.org/wiki/呪術廻戦",
    confirmedDate: "2026-08-07",
  }, // 1st season（2020秋）
  9327: {
    names: ["呪術"],
    sourceUrl: "https://ja.wikipedia.org/wiki/呪術廻戦",
    confirmedDate: "2026-08-07",
  }, // 懐玉・玉折／渋谷事変（2023夏）

  // 僕のヒーローアカデミア: 略称は「ヒロアカ」（出典は16266/16901/17543の項と同じ）
  5083: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-08-07",
  }, // 第2期（2017春）
  7419: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-08-07",
  }, // 第5期（2021春）
  9123: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-08-07",
  }, // 第6期（2022秋）
  10634: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-08-07",
  }, // 第7期（2024春）

  // 魔法少女まどか☆マギカ: 略称は「まどマギ」
  2108: {
    names: ["まどマギ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/魔法少女まどか☆マギカ",
    confirmedDate: "2026-08-07",
  }, // TVアニメ（2011冬）

  // この素晴らしい世界に祝福を！: 略称は「このすば」
  4547: {
    names: ["このすば"],
    sourceUrl: "https://ja.wikipedia.org/wiki/この素晴らしい世界に祝福を!",
    confirmedDate: "2026-08-07",
  }, // 1st season（2016冬）
  4902: {
    names: ["このすば"],
    sourceUrl: "https://ja.wikipedia.org/wiki/この素晴らしい世界に祝福を!",
    confirmedDate: "2026-08-07",
  }, // 2nd season（2017冬）

  // ソードアート・オンライン: 略称は「SAO」
  4093: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // ソードアート・オンラインII（2014夏）
  6587: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // アリシゼーション War of Underworld（2019秋）

  // やはり俺の青春ラブコメはまちがっている。: 略称は「俺ガイル」
  6584: {
    names: ["俺ガイル"],
    sourceUrl:
      "https://ja.wikipedia.org/wiki/やはり俺の青春ラブコメはまちがっている。",
    confirmedDate: "2026-08-07",
  }, // 完（2020夏）

  // ダンジョンに出会いを求めるのは間違っているだろうか: 略称は「ダンまち」
  5752: {
    names: ["ダンまち"],
    sourceUrl:
      "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // Ⅱ（2019夏）

  // とある科学の超電磁砲: 略称は「レールガン」（「超電磁砲」も略称だが原題に含まれるため登録不要）
  6301: {
    names: ["レールガン"],
    sourceUrl: "https://ja.wikipedia.org/wiki/とある科学の超電磁砲",
    confirmedDate: "2026-08-07",
  }, // T（2020冬）

  // ようこそ実力至上主義の教室へ: 略称は「よう実」
  9385: {
    names: ["よう実"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ようこそ実力至上主義の教室へ",
    confirmedDate: "2026-08-07",
  }, // 2nd Season（2022夏）

  // 東京リベンジャーズ: 略称は「東リベ」
  7603: {
    names: ["東リベ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/東京卍リベンジャーズ",
    confirmedDate: "2026-08-07",
  }, // TVアニメ（2021春）

  // 約束のネバーランド: 略称は「約ネバ」
  6079: {
    names: ["約ネバ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/約束のネバーランド",
    confirmedDate: "2026-08-07",
  }, // 1st season（2019冬）

  // ゴブリンスレイヤー: 略称は「ゴブスレ」
  6077: {
    names: ["ゴブスレ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ゴブリンスレイヤー",
    confirmedDate: "2026-08-07",
  }, // 1st season（2018秋）

  // リコリス・リコイル: 略称は「リコリコ」
  9250: {
    names: ["リコリコ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/リコリス・リコイル",
    confirmedDate: "2026-08-07",
  }, // TVアニメ（2022夏）

  // ぼっち・ざ・ろっく！: 略称は「ぼざろ」
  8128: {
    names: ["ぼざろ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ぼっち・ざ・ろっく!_(アニメ)",
    confirmedDate: "2026-08-07",
  }, // TVアニメ（2022秋）

  // 負けヒロインが多すぎる！: 略称は「マケイン」
  12075: {
    names: ["マケイン"],
    sourceUrl: "https://ja.wikipedia.org/wiki/負けヒロインが多すぎる!",
    confirmedDate: "2026-08-07",
  }, // 1st season（2024夏）
  // ここから追加登録（2026-08-19）: **既に出典つきで登録済みのシリーズ**の、
  // まだ登録されていない作品IDに同じ略称を広げた（85件）。
  //
  // なぜ必要か: 略称は作品IDではなく**シリーズ**に付くものなのに、この表は
  // 作品IDごとの登録だった。そのため「リゼロ」は6作品に付いているのに
  // 劇場版・OVA・第1期には付いておらず、同じ検索語で来た人がどのページに
  // 着地するかで略称が出たり出なかったりしていた。
  //
  // 追加の手順（新しく外部を確認したものは1件も無い）:
  //  1. 登録済みシリーズごとに**人が基底タイトルを決める**（例:「リゼロ」→
  //     "Re:ゼロから始める異世界生活"）。作品名から「◯期」を推測して繋ぐことはしない
  //     （series.ts と同じ禁止事項）
  //  2. content/snapshots と content/coverage のタイトルから、その基底タイトルを
  //     含む作品IDを機械的に集める
  //  3. **出てきた一覧を1件ずつ目で見て**、独自の略称を持つスピンオフ
  //     （マギアレコード＝「マギレコ」）・コラボ企画・タイトルに既に略称が
  //     入っている作品（転スラ日記）を落とす
  //
  // そのため `sourceUrl` と `confirmedDate` は**初出のエントリのものをそのまま
  // 引き継いでいる**（今日確認したのは「この作品IDがそのシリーズか」だけで、
  // 「その略称が使われているか」を今日確認し直したわけではないため、
  // confirmedDate を今日の日付に書き換えない）。

  // Re:ゼロから始める異世界生活: 「リゼロ」
  4636: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-07-11",
  }, // Re:ゼロから始める異世界生活
  5485: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-07-11",
  }, // Re:ゼロから始める異世界生活 Memory Snow
  6457: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-07-11",
  }, // Re:ゼロから始める異世界生活 氷結の絆
  7187: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-07-11",
  }, // Re:ゼロから始める異世界生活 新編集版
  13150: {
    names: ["リゼロ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/Re:ゼロから始める異世界生活",
    confirmedDate: "2026-07-11",
  }, // Re:ゼロから始める異世界生活 3rd season 劇場型悪意

  // 転生したらスライムだった件: 「転スラ」
  6805: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 転生したらスライムだった件 OAD 外伝：Mの悲劇？
  7160: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 転生したらスライムだった件 OAD 外伝：HEY！尻！
  7161: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 転生したらスライムだった件 OAD 外伝：リムルの華麗な教師生活 その1
  7641: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 転生したらスライムだった件 OAD 外伝：リムルの華麗な教師生活 その2
  7642: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 転生したらスライムだった件 OAD 外伝：リムルの華麗な教師生活 その3
  8940: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 劇場版 転生したらスライムだった件 紅蓮の絆編
  10602: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 転生したらスライムだった件 コリウスの夢
  12819: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 転生したらスライムだった件 閑話：ディアブロ日記
  17632: {
    names: ["転スラ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/転生したらスライムだった件",
    confirmedDate: "2026-07-11",
  }, // 転生したらスライムだった件 ショートストーリー「救われるラミリス」

  // 呪術廻戦: 「呪術」
  8181: {
    names: ["呪術"],
    sourceUrl: "https://ja.wikipedia.org/wiki/呪術廻戦",
    confirmedDate: "2026-07-11",
  }, // 劇場版 呪術廻戦 0
  13831: {
    names: ["呪術"],
    sourceUrl: "https://ja.wikipedia.org/wiki/呪術廻戦",
    confirmedDate: "2026-07-11",
  }, // 劇場版総集編 呪術廻戦 懐玉・玉折
  16506: {
    names: ["呪術"],
    sourceUrl: "https://ja.wikipedia.org/wiki/呪術廻戦",
    confirmedDate: "2026-07-11",
  }, // 劇場版 呪術廻戦 渋谷事変 特別編集版 × 死滅回游 先行上映

  // 僕のヒーローアカデミア: 「ヒロアカ」
  4616: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア
  5642: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア (第3期)
  5643: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア THE MOVIE ～2人の英雄～
  5899: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア OVA
  6282: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア (第4期)
  6602: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア THE MOVIE ヒーローズ：ライジング
  7625: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア 生き残れ！決死のサバイバル訓練
  7820: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア THE MOVIE ワールド ヒーローズ ミッション
  9187: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア THE MOVIE ワールド ヒーローズ ミッション 《旅立ち》
  9687: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア 『ALL MIGHT：RISING』THE ANIMATION
  9688: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア HLB/笑え！地獄のように
  11079: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア THE MOVIE ユアネクスト
  11171: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア 雄英ヒーローズ・バトル
  12107: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア Memories
  14148: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア FINAL SEASON
  14795: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア THE MOVIE ヒーローズ・ライジング エピローグ・プラス《夢を現実に》
  14796: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // 僕のヒーローアカデミア THE MOVIE ユアネクスト 《A PIECE OF CAKE》
  14990: {
    names: ["ヒロアカ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/僕のヒーローアカデミア",
    confirmedDate: "2026-07-11",
  }, // ヴィジランテ -僕のヒーローアカデミア ILLEGALS-

  // シャングリラ・フロンティア: 「シャンフロ」「鳥頭」
  15804: {
    names: ["シャンフロ", "鳥頭"],
    sourceUrl: "https://ja.wikipedia.org/wiki/シャングリラ・フロンティア〜クソゲーハンター、神ゲーに挑まんとす〜",
    confirmedDate: "2026-07-11",
  }, // シャングリラ・フロンティア〜クソゲーハンター、神ゲーに挑まんとす〜 3rd season

  // 逃げ上手の若君: 「逃げ若」
  10591: {
    names: ["逃げ若"],
    sourceUrl: "https://dic.pixiv.net/a/逃げ若",
    confirmedDate: "2026-07-12",
  }, // 逃げ上手の若君

  // 君のことが大大大大大好きな100人の彼女: 「100カノ」
  10567: {
    names: ["100カノ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/君のことが大大大大大好きな100人の彼女",
    confirmedDate: "2026-07-12",
  }, // 君のことが大大大大大好きな100人の彼女
  12224: {
    names: ["100カノ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/君のことが大大大大大好きな100人の彼女",
    confirmedDate: "2026-07-12",
  }, // 君のことが大大大大大好きな100人の彼女 第2期

  // 魔法少女まどか☆マギカ: 「まどマギ」
  3697: {
    names: ["まどマギ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/魔法少女まどか☆マギカ",
    confirmedDate: "2026-08-07",
  }, // 劇場版 魔法少女まどか☆マギカ  [前編] 始まりの物語
  3698: {
    names: ["まどマギ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/魔法少女まどか☆マギカ",
    confirmedDate: "2026-08-07",
  }, // 劇場版 魔法少女まどか☆マギカ [後編] 永遠の物語 
  3699: {
    names: ["まどマギ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/魔法少女まどか☆マギカ",
    confirmedDate: "2026-08-07",
  }, // 劇場版 魔法少女まどか☆マギカ [新編] 叛逆の物語
  8410: {
    names: ["まどマギ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/魔法少女まどか☆マギカ",
    confirmedDate: "2026-08-07",
  }, // 劇場版 魔法少女まどか☆マギカ〈ワルプルギスの廻天〉
  16343: {
    names: ["まどマギ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/魔法少女まどか☆マギカ",
    confirmedDate: "2026-08-07",
  }, // 魔法少女まどか☆マギカ 始まりの物語／永遠の物語 TV Edition

  // この素晴らしい世界に祝福を！: 「このすば」
  5847: {
    names: ["このすば"],
    sourceUrl: "https://ja.wikipedia.org/wiki/この素晴らしい世界に祝福を!",
    confirmedDate: "2026-08-07",
  }, // この素晴らしい世界に祝福を！2 OVA
  6141: {
    names: ["このすば"],
    sourceUrl: "https://ja.wikipedia.org/wiki/この素晴らしい世界に祝福を!",
    confirmedDate: "2026-08-07",
  }, // この素晴らしい世界に祝福を！紅伝説
  8781: {
    names: ["このすば"],
    sourceUrl: "https://ja.wikipedia.org/wiki/この素晴らしい世界に祝福を!",
    confirmedDate: "2026-08-07",
  }, // この素晴らしい世界に祝福を！3
  13998: {
    names: ["このすば"],
    sourceUrl: "https://ja.wikipedia.org/wiki/この素晴らしい世界に祝福を!",
    confirmedDate: "2026-08-07",
  }, // この素晴らしい世界に祝福を！3 ーBONUS STAGEー

  // ソードアート・オンライン: 「SAO」
  1166: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // ソードアート・オンライン
  4027: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // ソードアート・オンライン Extra Edition
  4709: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // 劇場版 ソードアート・オンライン -オーディナル・スケール-
  5550: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // ソードアート・オンライン アリシゼーション
  5553: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // ソードアート・オンライン オルタナティブ ガンゲイル・オンライン
  7234: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // ソードアート・オンライン アリシゼーション War of Underworld ‐THE LAST SEASON‐
  7669: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // 劇場版 ソードアート・オンライン -プログレッシブ- 星なき夜のアリア
  9061: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // 劇場版 ソードアート・オンライン -プログレッシブ- 冥き夕闇のスケルツォ
  11027: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // ソードアート・オンライン オルタナティブ ガンゲイル・オンラインII
  14073: {
    names: ["SAO"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ソードアート・オンライン",
    confirmedDate: "2026-08-07",
  }, // ソードアート・オンライン オルタナティブ ガンゲイル･オンライン 12.5話「GALA」

  // やはり俺の青春ラブコメはまちがっている。: 「俺ガイル」
  2255: {
    names: ["俺ガイル"],
    sourceUrl: "https://ja.wikipedia.org/wiki/やはり俺の青春ラブコメはまちがっている。",
    confirmedDate: "2026-08-07",
  }, // やはり俺の青春ラブコメはまちがっている。
  4244: {
    names: ["俺ガイル"],
    sourceUrl: "https://ja.wikipedia.org/wiki/やはり俺の青春ラブコメはまちがっている。",
    confirmedDate: "2026-08-07",
  }, // やはり俺の青春ラブコメはまちがっている。続
  7919: {
    names: ["俺ガイル"],
    sourceUrl: "https://ja.wikipedia.org/wiki/やはり俺の青春ラブコメはまちがっている。",
    confirmedDate: "2026-08-07",
  }, // やはり俺の青春ラブコメはまちがっている。完 OVA「だから、思春期は終わらずに、青春は続いていく。」

  // ダンジョンに出会いを求めるのは間違っているだろうか: 「ダンまち」
  4247: {
    names: ["ダンまち"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // ダンジョンに出会いを求めるのは間違っているだろうか
  5137: {
    names: ["ダンまち"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // ソード・オラトリア ダンジョンに出会いを求めるのは間違っているだろうか外伝
  5253: {
    names: ["ダンまち"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // ダンジョンに出会いを求めるのは間違っているだろうか OVA
  5751: {
    names: ["ダンまち"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // 劇場版 ダンジョンに出会いを求めるのは間違っているだろうか  ─ オリオンの矢 ─
  6963: {
    names: ["ダンまち"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // ダンジョンに出会いを求めるのは間違っているだろうかⅡ OVA
  6964: {
    names: ["ダンまち"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // ダンジョンに出会いを求めるのは間違っているだろうかⅢ
  7875: {
    names: ["ダンまち"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // ダンジョンに出会いを求めるのは間違っているだろうかⅢ OVA「オラリオに温泉を求めるのは間違っているだろうか 〜おふろの神様フォーエバー〜」
  7906: {
    names: ["ダンまち"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // ダンジョンに出会いを求めるのは間違っているだろうかⅣ 新章 迷宮篇
  10107: {
    names: ["ダンまち"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // ダンジョンに出会いを求めるのは間違っているだろうかⅣ 深章 厄災篇
  11504: {
    names: ["ダンまち"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ダンジョンに出会いを求めるのは間違っているだろうか",
    confirmedDate: "2026-08-07",
  }, // ダンジョンに出会いを求めるのは間違っているだろうかⅤ 豊穣の女神篇

  // とある科学の超電磁砲: 「レールガン」
  1420: {
    names: ["レールガン"],
    sourceUrl: "https://ja.wikipedia.org/wiki/とある科学の超電磁砲",
    confirmedDate: "2026-08-07",
  }, // とある科学の超電磁砲S
  2870: {
    names: ["レールガン"],
    sourceUrl: "https://ja.wikipedia.org/wiki/とある科学の超電磁砲",
    confirmedDate: "2026-08-07",
  }, // とある科学の超電磁砲 OVA
  9545: {
    names: ["レールガン"],
    sourceUrl: "https://ja.wikipedia.org/wiki/とある科学の超電磁砲",
    confirmedDate: "2026-08-07",
  }, // とある科学の超電磁砲S OVA

  // ようこそ実力至上主義の教室へ: 「よう実」
  5322: {
    names: ["よう実"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ようこそ実力至上主義の教室へ",
    confirmedDate: "2026-08-07",
  }, // ようこそ実力至上主義の教室へ
  9413: {
    names: ["よう実"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ようこそ実力至上主義の教室へ",
    confirmedDate: "2026-08-07",
  }, // ようこそ実力至上主義の教室へ 3rd Season

  // 東京リベンジャーズ: 「東リベ」
  9220: {
    names: ["東リベ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/東京卍リベンジャーズ",
    confirmedDate: "2026-08-07",
  }, // 東京リベンジャーズ 聖夜決戦編
  10664: {
    names: ["東リベ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/東京卍リベンジャーズ",
    confirmedDate: "2026-08-07",
  }, // 東京リベンジャーズ 天竺編
  13286: {
    names: ["東リベ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/東京卍リベンジャーズ",
    confirmedDate: "2026-08-07",
  }, // 東京リベンジャーズ 三天戦争編

  // 約束のネバーランド: 「約ネバ」
  6592: {
    names: ["約ネバ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/約束のネバーランド",
    confirmedDate: "2026-08-07",
  }, // 約束のネバーランド Season 2

  // ゴブリンスレイヤー: 「ゴブスレ」
  6601: {
    names: ["ゴブスレ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ゴブリンスレイヤー",
    confirmedDate: "2026-08-07",
  }, // ゴブリンスレイヤー -GOBLIN’S CROWN-
  7904: {
    names: ["ゴブスレ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ゴブリンスレイヤー",
    confirmedDate: "2026-08-07",
  }, // ゴブリンスレイヤーⅡ

  // リコリス・リコイル: 「リコリコ」
  13720: {
    names: ["リコリコ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/リコリス・リコイル",
    confirmedDate: "2026-08-07",
  }, // リコリス・リコイル Friends are thieves of time.

  // ぼっち・ざ・ろっく！: 「ぼざろ」
  10865: {
    names: ["ぼざろ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ぼっち・ざ・ろっく!_(アニメ)",
    confirmedDate: "2026-08-07",
  }, // 劇場総集編ぼっち・ざ・ろっく！ Re:
  11308: {
    names: ["ぼざろ"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ぼっち・ざ・ろっく!_(アニメ)",
    confirmedDate: "2026-08-07",
  }, // 劇場総集編ぼっち・ざ・ろっく！ Re:Re:
  // ここから新しいシリーズの追加（2026-08-19。121件）。
  //
  // 【この回の確認方法と、その限界】この作業環境は外向きのページ取得が遮断されており
  // （ja.wikipedia.org も含めて egress proxy が 403）、**出典ページを開いて読むことが
  // できなかった**。確認に使えたのは検索そのものだけなので、次の3段で採否を決めている。
  //   1. 検索結果に「略称は『◯◯』」の明示か、独立した複数の結果で実際にその略称が
  //      その作品を指して使われていることが出ているものだけを候補にした
  //   2. 機械的に落とす: 正式タイトルに既にその略称が含まれる作品（「薬屋のひとりごと」→
  //      「薬屋」、「響け！ユーフォニアム」→「ユーフォ」）は、ページに既にその語が
  //      あるので登録しない
  //   3. 目で落とす: 独自の名前を持つ派生ブランド（アルゴナビス）とコラボ企画
  //      （トリコ×ONE PIECE×ドラゴンボールZ）を外した
  // 証拠が「どう略すのが正しいか」を尋ねる質問だけのもの（SAKAMOTO DAYS→「サカデイ」）と、
  // 投稿1件しか無いもの（塩対応の佐藤さん→「塩甘」）は**採用していない**。
  //
  // 出典ページを直接読めていない以上、ここは他の人力補完より確認が一段弱い。
  // 外向き通信のある環境（PC作業）で `sourceUrl` を開き直せるよう、URLは
  // **検索結果に実際に出てきたもの**だけを書いている（見ていないURLを書かない）。

  // 青春ブタ野郎: 「青ブタ」
  5792: {
    names: ["青ブタ"],
    sourceUrl: "https://otajo.jp/115348",
    confirmedDate: "2026-08-19",
  }, // 青春ブタ野郎はバニーガール先輩の夢を見ない
  6257: {
    names: ["青ブタ"],
    sourceUrl: "https://otajo.jp/115348",
    confirmedDate: "2026-08-19",
  }, // 青春ブタ野郎はゆめみる少女の夢を見ない
  10098: {
    names: ["青ブタ"],
    sourceUrl: "https://otajo.jp/115348",
    confirmedDate: "2026-08-19",
  }, // 青春ブタ野郎はおでかけシスターの夢を見ない
  10099: {
    names: ["青ブタ"],
    sourceUrl: "https://otajo.jp/115348",
    confirmedDate: "2026-08-19",
  }, // 青春ブタ野郎はランドセルガールの夢を見ない
  11852: {
    names: ["青ブタ"],
    sourceUrl: "https://otajo.jp/115348",
    confirmedDate: "2026-08-19",
  }, // 青春ブタ野郎はサンタクロースの夢を見ない
  16586: {
    names: ["青ブタ"],
    sourceUrl: "https://otajo.jp/115348",
    confirmedDate: "2026-08-19",
  }, // 青春ブタ野郎はディアフレンドの夢を見ない

  // ガールズ&パンツァー: 「ガルパン」
  424: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー
  4130: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー OVA これが本当のアンツィオ戦です!
  4377: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー 劇場版
  4874: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー 劇場版 OVA
  5534: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー 最終章 第1話
  6185: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー 最終章 第2話
  6186: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー 第63回戦車道全国高校生大会 総集編
  7681: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー 最終章 第3話
  8252: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー 最終章 第4話
  9038: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー OVA タイヤキ・ウォー！
  9039: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ＆パンツァーOVA ダイコン・ウォー！
  9536: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー 映像特典
  12828: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ＆パンツァー OVA タイチョウ･ウォー！
  12887: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ＆パンツァー 不肖・秋山優花里の戦車講座
  15713: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ＆パンツァー もっとらぶらぶ作戦です！第１幕
  16716: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ&パンツァー 最終章 第5話
  17851: {
    names: ["ガルパン"],
    sourceUrl: "https://www.weblio.jp/content/ガールズ%26パンツァー",
    confirmedDate: "2026-08-19",
  }, // ガールズ＆パンツァー もっとらぶらぶ作戦です！

  // ブラッククローバー: 「ブラクロ」
  5371: {
    names: ["ブラクロ"],
    sourceUrl: "https://news.ganma.jp/contents/bclover/",
    confirmedDate: "2026-08-19",
  }, // ブラッククローバー
  6784: {
    names: ["ブラクロ"],
    sourceUrl: "https://news.ganma.jp/contents/bclover/",
    confirmedDate: "2026-08-19",
  }, // むぎゅっと！ブラッククローバー
  8452: {
    names: ["ブラクロ"],
    sourceUrl: "https://news.ganma.jp/contents/bclover/",
    confirmedDate: "2026-08-19",
  }, // 劇場版 ブラッククローバー 魔法帝の剣
  14159: {
    names: ["ブラクロ"],
    sourceUrl: "https://news.ganma.jp/contents/bclover/",
    confirmedDate: "2026-08-19",
  }, // ブラッククローバー(ジャンプスペシャルアニメフェスタ2016)
  14161: {
    names: ["ブラクロ"],
    sourceUrl: "https://news.ganma.jp/contents/bclover/",
    confirmedDate: "2026-08-19",
  }, // ブラッククローバー オール魔法騎士感謝祭
  16301: {
    names: ["ブラクロ"],
    sourceUrl: "https://news.ganma.jp/contents/bclover/",
    confirmedDate: "2026-08-19",
  }, // ブラッククローバー 2nd Season

  // 乙女ゲー世界はモブに厳しい世界です: 「モブせか」
  9130: {
    names: ["モブせか"],
    sourceUrl: "https://gcnovels.jp/mobuseka/",
    confirmedDate: "2026-08-19",
  }, // 乙女ゲー世界はモブに厳しい世界です
  10352: {
    names: ["モブせか"],
    sourceUrl: "https://gcnovels.jp/mobuseka/",
    confirmedDate: "2026-08-19",
  }, // 乙女ゲー世界はモブに厳しい世界です2

  // 探偵はもう、死んでいる。: 「たんもし」
  7973: {
    names: ["たんもし"],
    sourceUrl: "https://www.animatetimes.com/tag/details.php?id=11589",
    confirmedDate: "2026-08-19",
  }, // 探偵はもう、死んでいる。
  9753: {
    names: ["たんもし"],
    sourceUrl: "https://www.animatetimes.com/tag/details.php?id=11589",
    confirmedDate: "2026-08-19",
  }, // 探偵はもう、死んでいる。Season2

  // BanG Dream!: 「バンドリ」
  4992: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream!
  5435: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! OVA
  6038: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! 2nd Season
  6039: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! 3rd Season
  6040: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! ガルパ☆ピコ
  6591: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! FILM LIVE
  7406: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! ガルパ☆ピコ～大盛り～
  7495: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! Episode of Roselia I:約束
  7496: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! Episode of Roselia II:Song I am.
  7497: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! ぽっぴん'どりーむ！
  8928: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! ガルパ☆ピコ ふぃーばー！
  9313: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! ガールズバンドパーティ！5th Anniversary Animation -CiRCLE THANKS PARTY!-
  9685: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! Morfonication
  10686: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! It's MyGO!!!!!
  11126: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! Ave Mujica
  12363: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // 劇場版 BanG Dream! It's MyGO!!!!! 前編 : 春の陽だまり、迷い猫
  12364: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // 劇場版 BanG Dream! It's MyGO!!!!! 後編 : うたう、僕らになれるうた & FILM LIVE
  14936: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! Ave Mujica 劇場先行上映
  15793: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // 「BanG Dream! It's MyGO!!!!! / BanG Dream! Ave Mujica」アニメ続編シリーズ
  16454: {
    names: ["バンドリ"],
    sourceUrl: "https://bang-dream.com/about/",
    confirmedDate: "2026-08-19",
  }, // BanG Dream! Ave Mujica prima aurora

  // 刀剣乱舞: 「とうらぶ」
  4809: {
    names: ["とうらぶ"],
    sourceUrl: "https://dic.pixiv.net/a/とうらぶ",
    confirmedDate: "2026-08-19",
  }, // 刀剣乱舞-花丸-
  5098: {
    names: ["とうらぶ"],
    sourceUrl: "https://dic.pixiv.net/a/とうらぶ",
    confirmedDate: "2026-08-19",
  }, // 活撃 刀剣乱舞
  5457: {
    names: ["とうらぶ"],
    sourceUrl: "https://dic.pixiv.net/a/とうらぶ",
    confirmedDate: "2026-08-19",
  }, // 続 刀剣乱舞-花丸-
  5543: {
    names: ["とうらぶ"],
    sourceUrl: "https://dic.pixiv.net/a/とうらぶ",
    confirmedDate: "2026-08-19",
  }, // 刀剣乱舞-花丸- ～幕間回想録～
  8132: {
    names: ["とうらぶ"],
    sourceUrl: "https://dic.pixiv.net/a/とうらぶ",
    confirmedDate: "2026-08-19",
  }, // 特「刀剣乱舞-花丸-」～雪月華～ 雪ノ巻
  9408: {
    names: ["とうらぶ"],
    sourceUrl: "https://dic.pixiv.net/a/とうらぶ",
    confirmedDate: "2026-08-19",
  }, // 特「刀剣乱舞-花丸-」～雪月華～ 月ノ巻
  9409: {
    names: ["とうらぶ"],
    sourceUrl: "https://dic.pixiv.net/a/とうらぶ",
    confirmedDate: "2026-08-19",
  }, // 特「刀剣乱舞-花丸-」～雪月華～ 華ノ巻
  12426: {
    names: ["とうらぶ"],
    sourceUrl: "https://dic.pixiv.net/a/とうらぶ",
    confirmedDate: "2026-08-19",
  }, // 刀剣乱舞 廻 -虚伝 燃ゆる本能寺-
  12427: {
    names: ["とうらぶ"],
    sourceUrl: "https://dic.pixiv.net/a/とうらぶ",
    confirmedDate: "2026-08-19",
  }, // わんぱく！刀剣乱舞
  13023: {
    names: ["とうらぶ"],
    sourceUrl: "https://dic.pixiv.net/a/とうらぶ",
    confirmedDate: "2026-08-19",
  }, // 刀剣乱舞 廻 -々伝 近し侍らうものら-

  // ONE PIECE: 「ワンピ」「ワンピース」
  3781: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE FILM Z
  4596: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE 〜アドベンチャー オブ ネブランディア〜
  4845: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE FILM GOLD
  5735: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE エピソードオブ東の海 〜ルフィと4人の仲間の大冒険!!〜
  6061: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE 3D 麦わらチェイス
  6395: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE STAMPEDE
  7136: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE 〜ハートオブゴールド〜
  7137: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE “3D2Y” エースの死を越えて! ルフィ仲間との誓い
  7138: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE エピソードオブサボ 〜3兄弟の絆 奇跡の再会と受け継がれる意志〜
  7139: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE エピソードオブナミ 〜航海士の涙と仲間の絆〜
  7140: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE エピソードオブルフィ 〜ハンドアイランドの冒険〜
  7141: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE エピソードオブ空島
  7142: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE エピソードオブメリー 〜もうひとりの仲間の物語〜
  9121: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE FILM RED
  11305: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE FILM STRONG WORLD EPISODE:0
  12123: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // THE ONE PIECE
  14192: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE 魚人島編 SPECIAL EDITED VERSION
  14193: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE FAN LETTER
  15815: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // 「ONE PIECE」オリジナルエピソード／ルフィ、ロー
  16440: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE HEROINES
  16921: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // ONE PIECE FILM Z GLORIOUS ISLAND
  17390: {
    names: ["ワンピ", "ワンピース"],
    sourceUrl: "https://dic.pixiv.net/a/ワンピ",
    confirmedDate: "2026-08-19",
  }, // LEGO ONE PIECE

  // 魔入りました！入間くん: 「魔入間」
  6542: {
    names: ["魔入間"],
    sourceUrl: "https://dic.pixiv.net/a/魔入間",
    confirmedDate: "2026-08-19",
  }, // 魔入りました！入間くん
  7374: {
    names: ["魔入間"],
    sourceUrl: "https://dic.pixiv.net/a/魔入間",
    confirmedDate: "2026-08-19",
  }, // 魔入りました！入間くん 第2シリーズ
  8883: {
    names: ["魔入間"],
    sourceUrl: "https://dic.pixiv.net/a/魔入間",
    confirmedDate: "2026-08-19",
  }, // 魔入りました！入間くん 第3シリーズ
  17091: {
    names: ["魔入間"],
    sourceUrl: "https://dic.pixiv.net/a/魔入間",
    confirmedDate: "2026-08-19",
  }, // 魔入りました！入間くん if Episode of 魔フィア

  // ラブライブ！虹ヶ咲学園スクールアイドル同好会: 「ニジガク」
  7204: {
    names: ["ニジガク"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ラブライブ!虹ヶ咲学園スクールアイドル同好会",
    confirmedDate: "2026-08-19",
  }, // ラブライブ！虹ヶ咲学園スクールアイドル同好会
  8478: {
    names: ["ニジガク"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ラブライブ!虹ヶ咲学園スクールアイドル同好会",
    confirmedDate: "2026-08-19",
  }, // ラブライブ！虹ヶ咲学園スクールアイドル同好会 (第2期)
  10200: {
    names: ["ニジガク"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ラブライブ!虹ヶ咲学園スクールアイドル同好会",
    confirmedDate: "2026-08-19",
  }, // ラブライブ！虹ヶ咲学園スクールアイドル同好会 NEXT SKY
  10962: {
    names: ["ニジガク"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ラブライブ!虹ヶ咲学園スクールアイドル同好会",
    confirmedDate: "2026-08-19",
  }, // 映画 ラブライブ！虹ヶ咲学園スクールアイドル同好会 完結編 第1章
  10963: {
    names: ["ニジガク"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ラブライブ!虹ヶ咲学園スクールアイドル同好会",
    confirmedDate: "2026-08-19",
  }, // 映画 ラブライブ！虹ヶ咲学園スクールアイドル同好会 完結編 第2章
  10964: {
    names: ["ニジガク"],
    sourceUrl: "https://ja.wikipedia.org/wiki/ラブライブ!虹ヶ咲学園スクールアイドル同好会",
    confirmedDate: "2026-08-19",
  }, // 映画 ラブライブ！虹ヶ咲学園スクールアイドル同好会 完結編 最終章

  // スーパーの裏でヤニ吸うふたり: 「ヤニすう」
  16391: {
    names: ["ヤニすう"],
    sourceUrl: "https://www.animatetimes.com/tag/details.php?id=26460",
    confirmedDate: "2026-08-19",
  }, // スーパーの裏でヤニ吸うふたり

  // ここは俺に任せて先に行けと言ってから10年がたったら伝説になっていた。: 「ここ俺」
  16606: {
    names: ["ここ俺"],
    sourceUrl: "https://www.animate-onlineshop.jp/animetitle/?aid=15665",
    confirmedDate: "2026-08-19",
  }, // ここは俺に任せて先に行けと言ってから10年がたったら伝説になっていた。

  // 転生したら剣でした: 「転剣」
  8946: {
    names: ["転剣"],
    sourceUrl: "https://renote.net/articles/331504",
    confirmedDate: "2026-08-19",
  }, // 転生したら剣でした
  10258: {
    names: ["転剣"],
    sourceUrl: "https://renote.net/articles/331504",
    confirmedDate: "2026-08-19",
  }, // 転生したら剣でしたII

  // ゴールデンカムイ: 「金カム」
  5407: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // ゴールデンカムイ
  6144: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // ゴールデンカムイ OAD 茨戸の用心棒/怪奇！謎の巨大鳥
  6145: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // ゴールデンカムイ 第2期
  6799: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // ゴールデンカムイ 第3期
  9186: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // ゴールデンカムイ 第4期
  16171: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // ゴールデンカムイ OAD 稲妻強盗と蝮のお銀/シマエナガ
  16345: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // 劇場先行版 ゴールデンカムイ 札幌ビール工場編【前編】
  16346: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // 劇場先行版 ゴールデンカムイ 札幌ビール工場編【後編】
  17000: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // ゴールデンカムイ OAD 恋をしたから脱獄することにした/恐怖の猛毒大死闘！北海道奥地に巨大蛇は存在した！
  17001: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // ゴールデンカムイ OAD モンスター
  17002: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // ゴールデンカムイ OAD 支遁動物記
  17365: {
    names: ["金カム"],
    sourceUrl: "https://dic.pixiv.net/a/金カム",
    confirmedDate: "2026-08-19",
  }, // ゴールデンカムイ 暴走列車編

  // メイドインアビス: 「メイアビ」
  5121: {
    names: ["メイアビ"],
    sourceUrl: "https://dic.pixiv.net/a/メイアビ",
    confirmedDate: "2026-08-19",
  }, // メイドインアビス
  5822: {
    names: ["メイアビ"],
    sourceUrl: "https://dic.pixiv.net/a/メイアビ",
    confirmedDate: "2026-08-19",
  }, // メイドインアビス 劇場版総集編 【前編】旅立ちの夜明け
  5823: {
    names: ["メイアビ"],
    sourceUrl: "https://dic.pixiv.net/a/メイアビ",
    confirmedDate: "2026-08-19",
  }, // メイドインアビス 劇場版総集編 【後編】放浪する黄昏
  6607: {
    names: ["メイアビ"],
    sourceUrl: "https://dic.pixiv.net/a/メイアビ",
    confirmedDate: "2026-08-19",
  }, // メイドインアビス 深き魂の黎明
  7266: {
    names: ["メイアビ"],
    sourceUrl: "https://dic.pixiv.net/a/メイアビ",
    confirmedDate: "2026-08-19",
  }, // メイドインアビス 烈日の黄金郷
  10404: {
    names: ["メイアビ"],
    sourceUrl: "https://dic.pixiv.net/a/メイアビ",
    confirmedDate: "2026-08-19",
  }, // メイドインアビス 目覚める神秘

  // 千歳くんはラムネ瓶のなか: 「チラムネ」
  13763: {
    names: ["チラムネ"],
    sourceUrl: "https://mahoyaku.net/archives/6962",
    confirmedDate: "2026-08-19",
  }, // 千歳くんはラムネ瓶のなか
  17367: {
    names: ["チラムネ"],
    sourceUrl: "https://mahoyaku.net/archives/6962",
    confirmedDate: "2026-08-19",
  }, // 千歳くんはラムネ瓶のなか 第2クール

  // 黒岩メダカに私の可愛いが通じない: 「メダかわ」
  12960: {
    names: ["メダかわ"],
    sourceUrl: "https://www.animate-onlineshop.jp/animetitle/?aid=17102",
    confirmedDate: "2026-08-19",
  }, // 黒岩メダカに私の可愛いが通じない
  15775: {
    names: ["メダかわ"],
    sourceUrl: "https://www.animate-onlineshop.jp/animetitle/?aid=17102",
    confirmedDate: "2026-08-19",
  }, // 黒岩メダカに私の可愛いが通じない Season2
};
