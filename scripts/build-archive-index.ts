// content/snapshots/*.json から、検索エンジンに出す「過去クールの索引」を作るスクリプト。
// 出力: content/archive/index.json
//
// 使い方: node scripts/build-archive-index.ts
//   引数なし。content/snapshots/ にある全スナップショットを読み直して丸ごと作り直す。
//   ANNICT_TOKEN は不要（ネットワークに出ない。既存のスナップショットを読むだけ）。
//   スナップショットを追加・再生成したら必ずこれも実行する
//   （ズレは `node scripts/check.ts` が検出する）。
//
// なぜ必要か:
//   過去クールのページ（/season/{year}/{season} と、そこに並ぶ /anime/{id}）は
//   実装としては存在し、スナップショットのおかげで高速に開くのに、
//   (a) sitemap.xml が今期しか載せておらず、
//   (b) 年・季節の切替がクライアント側の <button>（<a href> ではない）
//   だったため、検索エンジンからは1ページも到達できない状態だった（2026-08-05に判明）。
//   sitemap に過去クールを載せるために、64シーズン×全作品のスナップショット（計5MB超）を
//   その都度読むのは重いので、sitemap が必要とする最小限（作品IDだけ）に絞った
//   軽い索引をここで先に作っておく。
//
// 収録の方針:
//   「配信サービスが1件以上ある作品」だけを workIds に入れる。
//   このサイトの作品ページの存在価値は「どこで配信されているか」に答えることなので、
//   配信0件の作品ページは答えを持たない＝内容の薄いページになる。
//   実測でも過去クール8,957作品のうち配信ありは1,961作品で、残り約7,000は
//   「配信情報なし」表示になる。薄いページを大量に sitemap へ送ると
//   サイト全体の評価を下げうるため、答えを持つページだけを載せる。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SeasonResponse } from "../lib/types.ts";

const SNAPSHOT_DIR = join(process.cwd(), "content", "snapshots");
const OUT_DIR = join(process.cwd(), "content", "archive");
const OUT_PATH = join(OUT_DIR, "index.json");

const SEASON_ORDER: Record<string, number> = { winter: 0, spring: 1, summer: 2, autumn: 3 };

export interface ArchiveSeason {
  year: number;
  season: string;
  // そのクールの総作品数（配信0件も含む）。索引の網羅性を人が確認するための参考値。
  total: number;
  // 配信サービスが1件以上ある作品のID（＝sitemapに載せる対象）。
  workIds: number[];
}

export interface ArchiveIndex {
  seasons: ArchiveSeason[];
}

// スナップショット群から索引を組み立てる純粋関数（check.ts からも呼んで
// content/archive/index.json とのズレを検査する）。
export function buildArchiveIndex(
  snapshots: { year: number; season: string; data: SeasonResponse }[]
): ArchiveIndex {
  const seasons = snapshots
    .map(({ year, season, data }) => ({
      year,
      season,
      total: data.items.length,
      workIds: data.items.filter((it) => it.services.length > 0).map((it) => it.id),
    }))
    .sort((a, b) => a.year - b.year || SEASON_ORDER[a.season] - SEASON_ORDER[b.season]);
  return { seasons };
}

// content/snapshots/*.json を読み込む（ファイル名 "{year}-{season}.json" から年季を取る）。
export function readSnapshots(): { year: number; season: string; data: SeasonResponse }[] {
  const out: { year: number; season: string; data: SeasonResponse }[] = [];
  for (const file of readdirSync(SNAPSHOT_DIR)) {
    const m = file.match(/^(\d{4})-(winter|spring|summer|autumn)\.json$/);
    if (!m) continue;
    const data = JSON.parse(readFileSync(join(SNAPSHOT_DIR, file), "utf8")) as SeasonResponse;
    out.push({ year: Number(m[1]), season: m[2], data });
  }
  return out;
}

function main(): void {
  const snapshots = readSnapshots();
  if (snapshots.length === 0) {
    console.error(`スナップショットが1件も見つかりません: ${SNAPSHOT_DIR}`);
    process.exit(1);
  }

  const index = buildArchiveIndex(snapshots);
  mkdirSync(OUT_DIR, { recursive: true });
  // 機械生成物なので minify する（手編集・行単位レビューの対象ではない）。
  writeFileSync(OUT_PATH, JSON.stringify(index) + "\n", "utf8");

  const totalWorks = index.seasons.reduce((n, s) => n + s.total, 0);
  const listedWorks = index.seasons.reduce((n, s) => n + s.workIds.length, 0);
  console.log(
    `✓ ${OUT_PATH}\n` +
      `  シーズン ${index.seasons.length} 件 / 総作品 ${totalWorks} 件 / ` +
      `sitemap掲載対象（配信1件以上）${listedWorks} 件`
  );
}

// check.ts から import されたときは main を走らせない。
if (process.argv[1] && process.argv[1].endsWith("build-archive-index.ts")) {
  main();
}
