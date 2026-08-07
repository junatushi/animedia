// 制作会社（アニメーション制作）・監督の横断索引（2026-08-07導入）。
//
// 生成は `node scripts/build-studio-index.ts`（`content/snapshots/` → `content/archive/studios.json`）。
// **スナップショットを追加・再生成したら再実行する**（ズレの機械検査は未導入。末尾のコメント参照）。
//
// 素の `.ts` に置いてあるのは `scripts/check.ts`（将来この索引の検査を足すとき）や
// ビルドスクリプトから import するため（NodeはJSXを解釈しないので `.tsx` からは import できない。
// `lib/personIndex.ts` と同じ理由）。
//
// 【なぜ声優索引（lib/personIndex.ts）と別ファイルにしたか】役割ごとに素性が違う
// （声優は「誰が演じたか」、制作会社・監督は「誰が作ったか」）ため、利用側の意図を
// 混同しないよう型・索引を分けた。ただし考え方（配信1件以上の作品だけ／2作品以上の
// 人・会社だけを載せる）は完全に揃えている。
//
// 【この索引が答えないこと】`lib/personIndex.ts` と同じ注意点。載っているのは
// 「そのクールの番組表に配信の記録があった」という事実だけで、**いま配信されているか
// ではない**（`lib/workAvailability.ts` と同じ扱い。Annictは配信終了を記録しないため、
// 過去作について「配信中」「いまも見られる」と書いてはいけない）。この索引を使う画面が
// できるときは「配信情報がある」までに留めること。
//
// 【この索引の前提】`content/snapshots/*.json` の各作品が `roleCredits`
// （監督・制作会社・原作者を役割つきで持つオブジェクト。下記 RoleCredits 型）を
// 持っていることを前提にする。`roleCredits` は 2026-08-07 に `scripts/snapshot-past-seasons.ts`
// へ追加したフィールドで、それより前に生成されたスナップショットには無い。
// 無い場合の挙動は `scripts/build-studio-index.ts` 側の責務（エラーで落とさず空の索引を書く）。

// 制作会社・監督・原作者（役割つき）。判定ロジックの実体は `lib/services.ts` の
// `deriveCredits`（Annict の staffs の roleText を見て分類する）で、ここでは型だけを持つ
// （ロジックを重複させない。CLAUDE.mdの「判定を新しく書き起こさない」方針）。
export type RoleCredits = {
  director: string | null;
  productionCompany: string | null;
  originalCreators: string[];
};

// [作品ID, タイトル, 年, 季節]。`lib/personIndex.ts` の PersonWork と揃えた形。
// 作品IDは AnimeItem.id（number）をそのまま使う。
export type StudioWork = [number, string, number, string];

export type StudioIndex = {
  generatedAt: string;
  // 制作会社名 → 制作作品
  studios: Record<string, StudioWork[]>;
  // 監督名 → 監督作品
  directors: Record<string, StudioWork[]>;
};

// 索引に載せる最低作品数。1作品だけの会社・監督はクール別ページと中身が同じになるため
// 載せない（`lib/personIndex.ts` の MIN_WORKS と同じ理由）。
export const MIN_WORKS = 2;

// 1ページに出す上限の目安（ページ実装時に使う想定。人物索引と揃えておく）。
export const MAX_WORKS_SHOWN = 24;

// 指定した名前（制作会社名 or 監督名）の、指定クール**以外**の作品を新しい順に返す。
// `map` には StudioIndex.studios か StudioIndex.directors のどちらかを渡す
// （役割が違うものを1つの Record に混ぜていないため、呼び出し側でどちらの索引かを選ぶ）。
export function otherSeasonWorks(
  map: Record<string, StudioWork[]>,
  name: string,
  excludeYear: number,
  excludeSeason: string
): StudioWork[] {
  const works = map[name];
  if (!works) return [];
  return works.filter(([, , year, season]) => !(year === excludeYear && season === excludeSeason));
}
