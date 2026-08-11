// 声優の出演作索引を作る（2026-08-07導入）。
//
//   node scripts/build-person-index.ts
//
// `content/snapshots/*.json` を読み、**配信情報が1件以上ある作品**に限って
// 「声優名 → 出演作（作品ID・タイトル・年・季節）」の索引を
// `content/archive/people.json` に書く。ネットワーク不要。
// **スナップショットを追加・再生成したら再実行する**（ズレは `node scripts/check.ts` が検出）。
//
// 【なぜ作るか】`/person/[name]/[year]/[season]` は**そのクールの出演作しか出せない**。
// ところが「この声優の出演作、どれがどこで見られるのか」は1クールに閉じた問いではない
// （調査は `docs/research-2026-08/research-I.md`）。手元のスナップショットは
// `castNames` を持っているので、Annictへの追加取得なしで作れる。
//
// 【なぜ配信情報がある作品だけか】`content/archive/index.json` と同じ方針。
// 配信0件の作品は「配信情報なし」としか言えないので、並べても読む人の役に立たない
// （実測: 過去8,957作品のうち配信ありは1,961作品）。
//
// 【なぜ2作品以上に絞るか】1作品しか無い人は、クール別ページと中身が同じになる。
// 薄いページを増やさない方針（`app/person/.../page.tsx` のコメント）に合わせる。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readSnapshots } from "./build-archive-index.ts";
import { MIN_WORKS, type PersonIndex, type PersonWork } from "../lib/personIndex.ts";

const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "content",
  "archive",
  "people.json"
);

export function buildPersonIndex(
  snapshots: { year: number; season: string; data: { items: any[] } }[]
): PersonIndex["people"] {
  const byName = new Map<string, PersonWork[]>();
  // 入力の順序に結果が依存しないよう、クール順に固定してから積む。
  const ordered = [...snapshots].sort((a, b) => a.year - b.year || (a.season < b.season ? -1 : 1));
  for (const { year, season, data } of ordered) {
    for (const item of data.items ?? []) {
      // 配信情報が無い作品は載せない（上記）。
      if (!(item.services ?? []).length) continue;
      for (const name of item.castNames ?? []) {
        if (typeof name !== "string" || !name) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name)!.push([item.id, item.title, year, season]);
      }
    }
  }

  const people: PersonIndex["people"] = {};
  for (const [name, works] of [...byName.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (works.length < MIN_WORKS) continue;
    // 新しいクールから順に。同じクール内は作品IDで安定させる
    // （並びが実行ごとに変わると差分がノイズだらけになる）。
    works.sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    people[name] = works;
  }
  return people;
}

// 生成日はスナップショットの内容から決まらないので、一致検査（check.ts）では
// 比較対象から外す。ここでは既存ファイルの値を引き継ぐ（毎回書き換えて
// 巨大な差分が出るのを避けるため、中身が変わったときだけ日付を進める）。
function main(): void {
  const snapshots = readSnapshots();
  if (snapshots.length === 0) {
    console.error("スナップショットが1件も見つかりません");
    process.exit(1);
  }
  const people = buildPersonIndex(snapshots);
  let generatedAt = new Date().toISOString().slice(0, 10);
  try {
    const prev = JSON.parse(readFileSync(OUT_PATH, "utf8")) as PersonIndex;
    if (JSON.stringify(prev.people) === JSON.stringify(people)) generatedAt = prev.generatedAt;
  } catch {
    // 初回生成。今日の日付でよい。
  }
  // 機械生成物なので minify する（手編集・行単位レビューの対象ではない）。
  writeFileSync(OUT_PATH, JSON.stringify({ generatedAt, people } satisfies PersonIndex) + "\n");

  const total = Object.values(people).reduce((n, w) => n + w.length, 0);
  console.log(
    `content/archive/people.json を書きました: ${Object.keys(people).length}人 / 出演${total}件`
  );
}

if (process.argv[1] && process.argv[1].endsWith("build-person-index.ts")) {
  main();
}
