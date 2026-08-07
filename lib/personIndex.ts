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
