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
  // そのクールに存在する**全作品**のID（配信0件のものも含む）。2026-09-14追加。
  //
  // workIds（配信1件以上）と役割が違う。workIds は「sitemapに載せる価値がある
  // ページ」の集合で、こちらは「作品ID → どのスナップショットに載っているか」を
  // 逆引きするための集合。lib/getWorkData.ts が使う。
  //
  // なぜ要るか: 作品ページ（/anime/[id]）は放送終了済みの作品でも毎回 Annict へ
  // ライブ取得しており、その根拠は「スナップショットには credits が無いから」
  // だった。castCredits を持たせた（scripts/snapshot-past-seasons.ts）ことで
  // スナップショットだけで描けるようになったが、そのためには**配信0件の作品も
  // 含めて**どのファイルを開けばよいかを引ける必要がある。配信0件の作品ページも
  // シーズンページからリンクされていて実際にクロールされるので、ここを落とすと
  // その分だけ外部APIの往復とISRの書き込みが残る。
  allWorkIds: number[];
  // そのスナップショットの**全作品**が castCredits（声優×キャラ名）を持っているか。
  // 2026-09-14追加。
  //
  // これは「このクールはスナップショットだけで作品ページを描き切れるか」の印で、
  // lib/getWorkData.ts と app/anime/[id]/page.tsx の generateStaticParams が
  // **これだけを見て**切り替える。旧い形式のスナップショット（castCredits 無し）は
  // false になり、従来どおりライブ取得のままになる＝**表示が劣化することは無い**。
  // スナップショットを再生成（docs/snapshot-regenerate.md）すると自動で true になり、
  // そのクールの作品ページがビルド時に焼かれるようになる。
  castCreditsComplete: boolean;
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
      allWorkIds: data.items.map((it) => it.id),
      // 「1件でも欠けていたら false」。部分的に揃った状態で切り替えると、
      // 同じクールの中で声優欄が出る作品と出ない作品が混ざる。
      castCreditsComplete:
        data.items.length > 0 &&
        data.items.every((it) =>
          Array.isArray((it as { castCredits?: unknown }).castCredits)
        ),
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
  const complete = index.seasons.filter((s) => s.castCreditsComplete);
  const completeWorks = complete.reduce((n, s) => n + s.allWorkIds.length, 0);
  console.log(
    `✓ ${OUT_PATH}\n` +
      `  シーズン ${index.seasons.length} 件 / 総作品 ${totalWorks} 件 / ` +
      `sitemap掲載対象（配信1件以上）${listedWorks} 件\n` +
      `  スナップショットだけで作品ページを描けるクール ${complete.length}/${index.seasons.length} 件` +
      `（作品 ${completeWorks} 件）` +
      (complete.length === index.seasons.length
        ? ""
        : "\n  ※ castCredits を持たないクールは従来どおりAnnictへライブ取得します。" +
          "docs/snapshot-regenerate.md の手順で再生成すると静的化されます。")
  );
}

// check.ts から import されたときは main を走らせない。
if (process.argv[1] && process.argv[1].endsWith("build-archive-index.ts")) {
  main();
}
