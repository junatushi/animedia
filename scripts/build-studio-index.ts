// 制作会社（アニメーション制作）・監督の横断索引を作る（2026-08-07導入）。
//
//   node scripts/build-studio-index.ts
//
// `content/snapshots/*.json` を読み、**配信情報が1件以上ある作品**に限って
// 「制作会社名 → 制作作品」「監督名 → 監督作品」の索引を
// `content/archive/studios.json` に書く。ネットワーク不要。
// **スナップショットを追加・再生成したら再実行する**。
//
// 【なぜ役割つきで区別できるのか】content/snapshots/*.json の従来フィールド
// （creditNames）は声優・制作会社・監督・原作者を役割の区別なく並べたフラットな配列で、
// 「カラー」（制作会社）と「鶴巻和哉」（監督）を機械的に区別する手段が無かった
// （名前の見た目からの推測はCLAUDE.mdで禁止）。2026-08-07に
// scripts/snapshot-past-seasons.ts が、lib/services.ts の deriveCredits（Annictの
// staffsをroleTextで役割判定するロジック。toAnimeDetailが内部で呼ぶ）の結果を
// `roleCredits`としてスナップショットへ保存するようにしたため、それを読むだけで
// 区別できる。判定ロジックはここでは新しく書かない（lib/services.tsの結果をそのまま使う）。
//
// 【古い形式のスナップショットしか無いとき】上記の roleCredits フィールドは
// 2026-08-07以降に（再）生成したスナップショットにしか無い。1件も無ければ
// エラーで落とさず、空の索引（studios: {} / directors: {}）を書いて
// 「再生成が必要」という旨を出力する（ANNICT_TOKEN が無い環境でも安全に実行できるように
// するため。CIやこのタスクのようにトークンが無いセッションでも check.ts 等から
// 呼べる状態を保つ）。
//
// 【なぜ配信情報がある作品だけか / なぜ2作品以上か】scripts/build-person-index.ts と
// 同じ方針（content/archive/index.json 参照）。配信0件の作品は「配信情報なし」としか
// 言えないので並べても読む人の役に立たない。1作品しか無い会社・監督は、その作品の
// クール別ページと中身が同じになる。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readSnapshots } from "./build-archive-index.ts";
import { MIN_WORKS, type StudioIndex, type StudioWork } from "../lib/studioIndex.ts";

const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "content",
  "archive",
  "studios.json"
);

// スナップショットが役割つきクレジット（roleCredits）を持っているか。
// 新旧のスナップショットが混在する移行期にも対応できるよう、1件でも持っていれば
// 「対応済み」とみなす（全件一致は要求しない。古いスナップショットの作品は単に
// roleCreditsが無いので下のループで自然にスキップされる）。
export function hasRoleCredits(
  snapshots: { year: number; season: string; data: { items: any[] } }[]
): boolean {
  return snapshots.some(({ data }) => (data.items ?? []).some((it) => it && it.roleCredits != null));
}

export function buildStudioIndex(
  snapshots: { year: number; season: string; data: { items: any[] } }[]
): { studios: StudioIndex["studios"]; directors: StudioIndex["directors"] } {
  const studioMap = new Map<string, StudioWork[]>();
  const directorMap = new Map<string, StudioWork[]>();
  // 入力の順序に結果が依存しないよう、クール順に固定してから積む（build-person-index.tsと同じ）。
  const ordered = [...snapshots].sort((a, b) => a.year - b.year || (a.season < b.season ? -1 : 1));
  for (const { year, season, data } of ordered) {
    for (const item of data.items ?? []) {
      // 配信情報が無い作品は載せない（上記方針）。
      if (!(item.services ?? []).length) continue;
      const rc = item.roleCredits;
      if (!rc) continue; // 古い形式のスナップショット（roleCredits無し）はここで自然にスキップされる
      if (typeof rc.productionCompany === "string" && rc.productionCompany) {
        if (!studioMap.has(rc.productionCompany)) studioMap.set(rc.productionCompany, []);
        studioMap.get(rc.productionCompany)!.push([item.id, item.title, year, season]);
      }
      if (typeof rc.director === "string" && rc.director) {
        if (!directorMap.has(rc.director)) directorMap.set(rc.director, []);
        directorMap.get(rc.director)!.push([item.id, item.title, year, season]);
      }
    }
  }

  function finalize(map: Map<string, StudioWork[]>): Record<string, StudioWork[]> {
    const out: Record<string, StudioWork[]> = {};
    for (const [name, works] of [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (works.length < MIN_WORKS) continue;
      // 新しいクールから順に。同じクール内は作品IDで安定させる
      // （並びが実行ごとに変わると差分がノイズだらけになる。build-person-index.tsと同じ）。
      works.sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      out[name] = works;
    }
    return out;
  }

  return { studios: finalize(studioMap), directors: finalize(directorMap) };
}

// 生成日はスナップショットの内容から決まらないので、一致検査を将来入れるときのために
// 中身が変わったときだけ日付を進める（build-person-index.tsと同じ扱い）。
function main(): void {
  const snapshots = readSnapshots();
  if (snapshots.length === 0) {
    console.error("スナップショットが1件も見つかりません");
    process.exit(1);
  }

  let studios: StudioIndex["studios"] = {};
  let directors: StudioIndex["directors"] = {};

  if (!hasRoleCredits(snapshots)) {
    console.warn(
      "⚠ content/snapshots/ に役割つきクレジット（roleCredits）を持つファイルが1件もありません。\n" +
        "  scripts/snapshot-past-seasons.ts の拡張（2026-08-07）より前に生成されたスナップショット" +
        "のため、制作会社・監督を区別できません（名前の見た目からの推測はCLAUDE.mdで禁止のため行いません）。\n" +
        "  ANNICT_TOKEN を用意し、node scripts/snapshot-past-seasons.ts --force で" +
        "スナップショットを再生成してから、もう一度このスクリプトを実行してください。\n" +
        "  空の索引（制作会社0件・監督0件）を content/archive/studios.json に書きます。"
    );
  } else {
    const built = buildStudioIndex(snapshots);
    studios = built.studios;
    directors = built.directors;
  }

  let generatedAt = new Date().toISOString().slice(0, 10);
  try {
    const prev = JSON.parse(readFileSync(OUT_PATH, "utf8")) as StudioIndex;
    if (
      JSON.stringify(prev.studios) === JSON.stringify(studios) &&
      JSON.stringify(prev.directors) === JSON.stringify(directors)
    ) {
      generatedAt = prev.generatedAt;
    }
  } catch {
    // 初回生成。今日の日付でよい。
  }
  // 機械生成物なので minify する（手編集・行単位レビューの対象ではない）。
  writeFileSync(
    OUT_PATH,
    JSON.stringify({ generatedAt, studios, directors } satisfies StudioIndex) + "\n"
  );

  const studioWorks = Object.values(studios).reduce((n, w) => n + w.length, 0);
  const directorWorks = Object.values(directors).reduce((n, w) => n + w.length, 0);
  console.log(
    `content/archive/studios.json を書きました: ` +
      `制作会社${Object.keys(studios).length}社/出演${studioWorks}件・` +
      `監督${Object.keys(directors).length}人/出演${directorWorks}件`
  );
}

if (process.argv[1] && process.argv[1].endsWith("build-studio-index.ts")) {
  main();
}
