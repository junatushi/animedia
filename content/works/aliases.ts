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
};
