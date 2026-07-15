// 過去年（今年より前）のシーズンデータを content/snapshots/{year}-{season}.json に
// 静的スナップショットとして書き出すスクリプト。
//
// なぜ必要か:
//   過去のクールは放送終了済みで配信情報がほぼ動かないのに、これまでは過去年ページも
//   Annictからのライブ取得＋Vercelデータキャッシュに頼っていた。だがそのキャッシュは
//   1日以内に追い出される（実測: 温めCronが成功した翌日でも 2024夏 9.4s / 2020冬 5.1s の
//   コールドを踏んだ）ため、過去年の初回アクセスが5〜10秒かかっていた。
//   放送済みで動かないデータは「その都度取る」のをやめ、確定値をリポジトリに固定して
//   即返す（getSeasonData がこのJSONを読む）。これでキャッシュ追い出しの影響を受けず
//   常時0.1s未満になる。
//
// 使い方: node scripts/snapshot-past-seasons.ts [fromYear] [toYear] [--force]
//   引数省略時は 2010 〜 (今年-1) の全過去年×4季節を対象にする。
//   既存ファイルは既定でスキップ（途中失敗時に再開しやすいように）。--force で上書き。
//   例: node scripts/snapshot-past-seasons.ts            # 全過去年を生成
//       node scripts/snapshot-past-seasons.ts 2025 2025  # 昨年分だけ生成（年またぎ時）
//       node scripts/snapshot-past-seasons.ts 2024 2024 --force  # 2024を再取得して上書き
//
// ANNICT_TOKEN が要る（.env.local から読む。トークンの中身は出力しない）。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fetchSeasonWorks } from "../lib/annict.ts";
import { toAnimeItem } from "../lib/services.ts";
import { EXTRA_SERVICES } from "../content/works/extraServices.ts";
import type { SeasonResponse } from "../lib/types.ts";

const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
const SNAPSHOT_DIR = join(process.cwd(), "content", "snapshots");

// .env.local を最小限だけ読み込む（dotenv非依存。process.envに無いキーだけ補う）。
function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  }
}

// lib/getSeasonData.ts の fetchAndBuild と同じ整形をする（next/cache に依存しない形で複製）。
// ここを変えたら getSeasonData 側の整形も合わせること。
async function buildSeason(year: string, season: string, token: string): Promise<SeasonResponse> {
  const seasonStr = `${year}-${season}`;
  const works = await fetchSeasonWorks(seasonStr, token);
  const items = works
    .map((w) => toAnimeItem(w, EXTRA_SERVICES[w.annictId]))
    .sort((a, b) => b.watchers - a.watchers);
  return { season: seasonStr, count: items.length, items };
}

async function main() {
  loadEnvLocal();
  const token = process.env.ANNICT_TOKEN;
  if (!token) {
    console.error("ANNICT_TOKEN が未設定です（.env.local を確認してください）。");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const nums = args.filter((a) => /^\d{4}$/.test(a)).map(Number);
  const thisYear = new Date().getFullYear();
  const fromYear = nums[0] ?? 2010;
  const toYear = nums[1] ?? thisYear - 1;

  if (toYear >= thisYear) {
    console.error(
      `対象は過去年（今年 ${thisYear} より前）のみです。toYear=${toYear} は今年以降のため中止します。` +
        `\n今年分はライブ取得＋温めCronが担うため、スナップショットは作りません。`
    );
    process.exit(1);
  }

  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  let written = 0;
  let skipped = 0;
  let failed = 0;

  for (let year = fromYear; year <= toYear; year++) {
    for (const season of SEASONS) {
      const outPath = join(SNAPSHOT_DIR, `${year}-${season}.json`);
      if (!force && existsSync(outPath)) {
        skipped++;
        continue;
      }
      try {
        const data = await buildSeason(String(year), season, token);
        // 機械生成の確定スナップショット（手編集・行単位レビューの対象ではない）ので
        // minifyしてリポジトリ・デプロイを軽くする。再生成はスクリプトで丸ごと差し替える。
        writeFileSync(outPath, JSON.stringify(data) + "\n", "utf8");
        written++;
        console.log(`✓ ${year}-${season}: ${data.count} 作品 → ${outPath}`);
      } catch (err) {
        failed++;
        console.error(`✗ ${year}-${season}: ${err instanceof Error ? err.message : err}`);
      }
      // Annict へのバースト（過去に429経験あり）を避けるため1件ごとに少し待つ。
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  console.log(
    `\n完了: 生成 ${written} / スキップ（既存）${skipped} / 失敗 ${failed}` +
      (failed > 0 ? "（失敗分は再実行すると未生成のものだけ取り直せます）" : "")
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("スナップショット生成に失敗しました:", err);
  process.exit(1);
});
