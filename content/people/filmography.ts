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
};
