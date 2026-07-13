// 声優個人ページ（app/person/[name]/[year]/[season]/page.tsx）が表示する「代表作＋役名」を
// 人力で補完するデータ。Annict GraphQL APIには「声優→出演作品」の逆引きクエリが存在せず
// （Person型にcastsCount等はあるが作品一覧を返すフィールドが無い）、全出演作品を機械的に
// 集計しようとすると全クール分のAnnictデータを舐める必要がありAnnictへの負荷が大きい
// （docs/operations.mdの「⑪」、および[[annict-load-consideration]]の方針に反する）。
// そのため「今期の出演作品」はこれまでどおりAnnictのリアルタイムデータで自動表示し、
// 「代表作＋役名」だけをWikipedia等の一次情報から人力で確認・追記する運用にした
// （content/works/{id}.json の人力コンテンツと同じ思想）。
//
// キーはAnnictのcasts.nameと完全一致させる（app/person/[name]/... のnameパラメータと同じ文字列）。
export interface PersonFilmographyEntry {
  works: { title: string; character: string }[];
  // 出典（Wikipedia記事等）のURL。CLAUDE.mdの「一次情報のみ・出典明示」方針に従い必須とする。
  sourceUrl: string;
  // 確認日（"YYYY-MM-DD"）。データが古くなっていないかの目安。
  confirmedDate: string;
}

export const PERSON_FILMOGRAPHY: Record<string, PersonFilmographyEntry> = {
  豊口めぐみ: {
    sourceUrl: "https://ja.wikipedia.org/wiki/豊口めぐみ",
    confirmedDate: "2026-07-13",
    works: [
      { title: "アリスSOS", character: "アリス" },
      { title: "デュアル！ぱられルンルン物語", character: "羅螺みつき / ミス・ラー" },
      { title: "超GALS！寿蘭", character: "寿蘭" },
      { title: "ポケットモンスター ダイヤモンド&パール", character: "ヒカリ" },
      { title: "鋼の錬金術師", character: "ウィンリィ・ロックベル" },
      { title: "マリア様がみてる", character: "佐藤聖" },
      { title: "いちご100%", character: "西野つかさ" },
      { title: "BLACK LAGOON", character: "レヴィ" },
      { title: "マクロスF", character: "クラン・クラン" },
      { title: "スイートプリキュア♪", character: "黒川エレン / キュアビート" },
      { title: "IS〈インフィニット・ストラトス〉", character: "織斑千冬" },
      { title: "Fate/Zero", character: "ソラウ・ヌァザレ・ソフィアリ" },
      { title: "ダンガンロンパ", character: "江ノ島盾子" },
      { title: "転生したらスライムだった件", character: "大賢者 / 智慧之王" },
      { title: "ウマ娘 プリティーダービー", character: "東条ハナ" },
    ],
  },
  早見沙織: {
    sourceUrl: "https://ja.wikipedia.org/wiki/早見沙織",
    confirmedDate: "2026-07-14",
    works: [
      { title: "俺の妹がこんなに可愛いわけがない", character: "新垣あやせ" },
      { title: "あの日見た花の名前を僕達はまだ知らない。", character: "鶴見知利子（つるこ）" },
      { title: "やはり俺の青春ラブコメはまちがっている。", character: "雪ノ下雪乃" },
      { title: "アイドルマスター シンデレラガールズ", character: "高垣楓" },
      { title: "魔法科高校の劣等生", character: "司波深雪" },
      { title: "魔法つかいプリキュア！", character: "花海ことは／キュアフェリーチェ" },
      { title: "鬼滅の刃", character: "胡蝶しのぶ" },
      { title: "SPY×FAMILY", character: "ヨル・フォージャー" },
      { title: "そらのおとしもの", character: "イカロス" },
      { title: "セキレイ", character: "結" },
      { title: "ワンパンマン", character: "地獄のフブキ" },
      { title: "賭ケグルイ", character: "蛇喰夢子" },
    ],
  },
  関根明良: {
    sourceUrl: "https://ja.wikipedia.org/wiki/関根明良",
    confirmedDate: "2026-07-14",
    works: [
      { title: "プリンセス・プリンシパル", character: "プリンセス" },
      { title: "アイカツ！", character: "藤原みやび" },
      { title: "魔法少女特殊戦あすか", character: "夢源くるみ" },
      { title: "旗揚！けものみち", character: "シグレ" },
      { title: "神之塔 -Tower of God-", character: "アナク・ザハード" },
      { title: "その着せ替え人形は恋をする", character: "山内瑠音" },
      { title: "明日ちゃんのセーラー服", character: "谷川景" },
      { title: "BIRDIE WING -Golf Girls' Story-", character: "リリィ・リップマン" },
      { title: "ひろがるスカイ！プリキュア", character: "ソラ・ハレワタール／キュアスカイ" },
      { title: "先輩はおとこのこ", character: "蒼井咲" },
      { title: "杖と剣のウィストリア", character: "エルファリア・アルヴィス・セルフォルト" },
    ],
  },
  阿座上洋平: {
    sourceUrl: "https://ja.wikipedia.org/wiki/阿座上洋平",
    confirmedDate: "2026-07-14",
    works: [
      { title: "クロムクロ", character: "青馬剣之介時貞" },
      { title: "ピアシェ〜私のイタリアン〜", character: "近野桐秀" },
      { title: "ようこそ実力至上主義の教室へ", character: "橋本正義" },
      { title: "新サクラ大戦 the Animation", character: "神山誠十郎" },
      { title: "ゴジラ S.P〈シンギュラポイント〉", character: "佐藤隼也" },
      { title: "白い砂のアクアトープ", character: "屋嘉間志空也" },
      { title: "D_CIDE TRAUMEREI THE ANIMATION", character: "織田龍平" },
      { title: "ラブオールプレー", character: "榊翔平" },
      { title: "それでも歩は寄せてくる", character: "田中歩" },
      { title: "虫かぶり姫", character: "アーヴィン・オランザ" },
      { title: "機動戦士ガンダム 水星の魔女", character: "グエル・ジェターク" },
      { title: "鴨乃橋ロンの禁断推理", character: "鴨乃橋ロン" },
      { title: "青のミブロ", character: "土方歳三" },
    ],
  },
  安済知佳: {
    sourceUrl: "https://ja.wikipedia.org/wiki/安済知佳",
    confirmedDate: "2026-07-14",
    works: [
      { title: "あにゃまる探偵 キルミンずぅ", character: "御子神ナギサ" },
      { title: "棺姫のチャイカ", character: "チャイカ・トラバント" },
      { title: "響け！ユーフォニアム", character: "高坂麗奈" },
      { title: "クズの本懐", character: "安楽岡花火" },
      { title: "灰と幻想のグリムガル", character: "メリイ" },
      { title: "同居人はひざ、時々、頭のうえ。", character: "押守なな" },
      { title: "地縛少年花子くん", character: "七峰桜" },
      { title: "リコリス・リコイル", character: "錦木千束" },
      { title: "進撃の巨人", character: "ミーナ・カロライナ" },
      { title: "SSSS.DYNAZENON", character: "飛鳥川ちせ" },
      { title: "ぐらんぶる", character: "古手川千紗" },
    ],
  },
  石川由依: {
    sourceUrl: "https://ja.wikipedia.org/wiki/石川由依",
    confirmedDate: "2026-07-14",
    works: [
      { title: "進撃の巨人", character: "ミカサ・アッカーマン" },
      { title: "ヴァイオレット・エヴァーガーデン", character: "ヴァイオレット・エヴァーガーデン" },
      { title: "トロピカル〜ジュ！プリキュア", character: "一之瀬みのり／キュアパパイア" },
      { title: "アイカツ！", character: "新条ひなき" },
      { title: "ガンダムビルドファイターズ", character: "コウサカ・チナ" },
      { title: "エロマンガ先生", character: "高砂智恵" },
      { title: "蒼穹のファフナー EXODUS", character: "水鏡美三香" },
      { title: "クオリディア・コード", character: "宇多良カナリア" },
      { title: "ガーリッシュ ナンバー", character: "片倉京" },
      { title: "けものフレンズ2", character: "キュルル" },
      { title: "聖女の魔力は万能です", character: "セイ／小鳥遊聖" },
      { title: "NieR:Automata Ver1.1a", character: "2B" },
    ],
  },
  水瀬いのり: {
    sourceUrl: "https://ja.wikipedia.org/wiki/水瀬いのり",
    confirmedDate: "2026-07-14",
    works: [
      { title: "ご注文はうさぎですか？", character: "香風智乃（チノ）" },
      { title: "心が叫びたがってるんだ。", character: "成瀬順" },
      { title: "ダンジョンに出会いを求めるのは間違っているだろうか", character: "ヘスティア" },
      { title: "Re:ゼロから始める異世界生活", character: "レム" },
      { title: "五等分の花嫁", character: "中野五月" },
      { title: "がっこうぐらし！", character: "丈槍由紀" },
      { title: "戦姫絶唱シンフォギア", character: "キャロル・マールス・ディーンハイム" },
      { title: "恋愛ラボ", character: "棚橋鈴音" },
      { title: "ViVid Strike!", character: "フーカ・レヴェントン" },
      { title: "少女終末旅行", character: "チト" },
      { title: "宇宙よりも遠い場所", character: "玉木マリ" },
      { title: "政宗くんのリベンジ", character: "小岩井吉乃" },
      { title: "キラキラ☆プリキュアアラモード", character: "キラ星シエル／キュアパルフェ" },
      { title: "青春ブタ野郎シリーズ", character: "牧之原翔子" },
    ],
  },
  東山奈央: {
    sourceUrl: "https://ja.wikipedia.org/wiki/東山奈央",
    confirmedDate: "2026-07-14",
    works: [
      { title: "神のみぞ知るセカイ", character: "中川かのん" },
      { title: "異国迷路のクロワーゼ The Animation", character: "湯音" },
      { title: "戦姫絶唱シンフォギア", character: "寺島詩織" },
      { title: "咲-Saki- 阿知賀編", character: "新子憧" },
      { title: "ラブライブ！", character: "高坂雪穂" },
      { title: "やはり俺の青春ラブコメはまちがっている。", character: "由比ヶ浜結衣" },
      { title: "きんいろモザイク", character: "九条カレン" },
      { title: "蒼き鋼のアルペジオ", character: "八月一日静" },
      { title: "ニセコイ", character: "桐崎千棘" },
      { title: "マクロスΔ", character: "レイナ・プラウラー" },
      { title: "ゆるキャン△", character: "志摩リン" },
      { title: "響け！ユーフォニアム", character: "傘木希美" },
      { title: "彼女、お借りします", character: "更科瑠夏" },
    ],
  },
  "M・A・O": {
    sourceUrl: "https://ja.wikipedia.org/wiki/M・A・O",
    confirmedDate: "2026-07-14",
    works: [
      { title: "クッキンアイドル アイ！マイ！まいん！", character: "キラキラ" },
      { title: "帰宅部活動記録", character: "あざらし" },
      { title: "サムライフラメンコ", character: "三澤瑞希" },
      { title: "DD北斗の拳", character: "リン" },
      { title: "愛・天地無用！", character: "沙流葉七" },
      { title: "俺、ツインテールになります。", character: "桜川尊" },
      { title: "極黒のブリュンヒルデ", character: "カズミ＝シュリーレンツァウアー" },
      { title: "がっこうぐらし！", character: "若狭悠里" },
      { title: "機動戦士ガンダム 鉄血のオルフェンズ", character: "ジュリエッタ・ジュリス" },
      { title: "クラシカロイド", character: "バダジェフスカ" },
      { title: "競女!!!!!!!!", character: "宮田さやか" },
      { title: "クロムクロ", character: "白羽由希奈" },
      { title: "転生したらスライムだった件", character: "シオン" },
      { title: "ようこそ実力至上主義の教室へ", character: "佐倉愛里" },
      { title: "からかい上手の高木さん", character: "天川ユカリ" },
      { title: "炎炎ノ消防隊", character: "アイリス" },
    ],
  },
};
