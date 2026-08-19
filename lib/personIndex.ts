// 声優の出演作索引（2026-08-07導入）。
//
// 生成は `node scripts/build-person-index.ts`（`content/snapshots/` → `content/archive/people.json`）。
// **スナップショットを追加・再生成したら再実行する**（ズレは `node scripts/check.ts` が検出する）。
//
// 素の `.ts` に置いてあるのは `scripts/check.ts` から import して検査するため
// （NodeはJSXを解釈しないので `.tsx` からは import できない）。
//
// 【この索引が答えないこと】載っているのは「そのクールの番組表に配信の記録があった」
// という事実だけで、**いま配信されているかではない**（`lib/workAvailability.ts` と同じ扱い。
// Annictは配信終了を記録しないため、過去作について「配信中」と書いてはいけない）。
// 表示する側は「配信情報がある」までに留めること。

// [作品ID, タイトル, 年, 季節]
export type PersonWork = [string, string, number, string];

export type PersonIndex = {
  generatedAt: string;
  people: Record<string, PersonWork[]>;
};

// 索引に載せる最低出演数。1作品だけの人はクール別ページと中身が同じになるため載せない。
export const MIN_WORKS = 2;

// 1ページに出す上限。多作な声優（100作品超）でページが縦に伸びきるのを防ぐ。
// 注目度順ではなく新しい順に切るのは、古い作品ほど「いま見られるか」が怪しくなるため。
export const MAX_WORKS_SHOWN = 24;

// 指定した人の、指定クール**以外**の出演作を新しい順に返す。
// クール別ページ（/person/[name]/[year]/[season]）が既にそのクール分を出しているので、
// 同じ作品を2回並べない。
export function otherSeasonWorks(
  index: PersonIndex,
  name: string,
  excludeYear: number,
  excludeSeason: string
): PersonWork[] {
  const works = index.people[name];
  if (!works) return [];
  return works.filter(([, , year, season]) => !(year === excludeYear && season === excludeSeason));
}

// その人が「クール別ページを持っているクール」の一覧を新しい順に返す（2026-08-19追加）。
//
// 【なぜ要るか】GSC実測（2026-08-15・直近28日）で、声優ページは4ページで9クリック・
// 平均掲載順位5.7位・CTR8.3%。作品ページ（37ページ・10クリック・22.0位・1.4%）に対し
// **1ページあたり8倍**クリックを稼いでおり、サイトで唯一1ページ目に入れている面である。
// ところが sitemap に載せた過去クールの声優ページ4,483件への内部リンクは
// 「そのクールの作品ページの声優名リンク」1本しかなく、いちばん強いページ
// （/person/悠木碧/2026/summer＝93表示・5.7位）から**同じ人の他クールのページへ
// 一切リンクが無かった**。「他のクールの出演作」欄は作品ページとシーズンページには
// リンクするのに、声優ページ同士は繋いでいない。CLAUDE.mdの「孤立ページを作らない」が
// 想定している穴と同じ形（sitemapにあるのに導線が無い）。
//
// 【404を配らないための門番】クール別ページは「そのクールに2作品以上」でしか
// 生成されない（PERSON_PAGE_MIN_APPEARANCES／sitemap側と同じ閾値）。閾値を満たさない
// クールへリンクすると404になるため、ここで件数を数えて**ページが実在するクールだけ**を返す。
// 索引に無い名前を素のテキストに留める作品ページ側の`hasCreditPage`と同じ考え方。
//
// 【この門番は安全側に寄っている（意図的）】この索引は「配信情報が1件以上ある作品」
// だけで作られているのに対し、ページ側の判定は `getSeasonData`（そのクールの全作品）で
// 行う。つまり索引の件数 ⊆ ページ側の件数なので、**索引で2作品以上なら必ずページは実在する**
// （404は出ない）。逆に、配信情報が無い作品しか無いクールは実在しても除外される。
// 実測（KENN・2026-08-19）で他クール20件のうち8件を採用・12件を除外し、除外した中に
// 実在するページ（2025/summer）が1件混じっていた。取りこぼしを取りに行くには
// スナップショット全件をビルド時に読む必要があり、割に合わない。加えて、配信情報が
// 無いクールのページは中身が薄く、リンクを送る価値も小さい。**「404を出さない」を
// 優先してこの取りこぼしを許容している**。
//
// 閾値をこのファイルの定数にせず引数で受けるのは、`lib/personPage.ts` が持つ正準値を
// 呼び出し側から渡してもらうため（定義を2箇所に増やさない）。
export function otherSeasonPages(
  index: PersonIndex,
  name: string,
  excludeYear: number,
  excludeSeason: string,
  minAppearances: number
): { year: number; season: string; count: number }[] {
  const works = index.people[name];
  if (!works) return [];

  const counts = new Map<string, { year: number; season: string; count: number }>();
  for (const [, , year, season] of works) {
    if (year === excludeYear && season === excludeSeason) continue;
    const key = `${year}-${season}`;
    const cur = counts.get(key);
    if (cur) cur.count += 1;
    else counts.set(key, { year, season, count: 1 });
  }

  const SEASON_ORDER = ["winter", "spring", "summer", "autumn"];
  return [...counts.values()]
    .filter((c) => c.count >= minAppearances)
    .sort((a, b) =>
      a.year !== b.year
        ? b.year - a.year
        : SEASON_ORDER.indexOf(b.season) - SEASON_ORDER.indexOf(a.season)
    );
}
