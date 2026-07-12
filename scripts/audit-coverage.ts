// 配信データの網羅率を点検する常設スクリプト。season-updater/service-mapper エージェントが
// 毎回一時スクリプトを書いていた作業を1本化する。Annictへ実際に問い合わせるため
// ANNICT_TOKEN が要る（.env.local から読む。トークンの中身は出力しない）。
//
// 使い方: node scripts/audit-coverage.ts [year] [season]
//   引数省略時は現在の年・クールを対象にする。
//   例: node scripts/audit-coverage.ts 2026 summer
//
// 出力する2つのリストの意味:
//   (a) 配信サービス0件の作品のうち、TV放送データはある（hasBroadcastData=true）もの。
//       Annictにデータが無いのではなく「配信サービスの登録だけが未反映」の可能性が高く、
//       Annict側への手動更新（コミュニティ更新）の優先候補になる。注目数が多い順。
//   (b) 「その他配信」(otherServices) に落ちた未知チャンネル名。lib/services.ts の
//       SERVICES に追加すべき新サービスが無いか確認する材料（service-mapper参照）。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fetchSeasonWorks } from "../lib/annict.ts";
import { toAnimeItem } from "../lib/services.ts";
import { EXTRA_SERVICES } from "../content/works/extraServices.ts";

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

function currentSeasonByMonth(month: number): string {
  if (month <= 3) return "winter";
  if (month <= 6) return "spring";
  if (month <= 9) return "summer";
  return "autumn";
}

async function main() {
  loadEnvLocal();
  const token = process.env.ANNICT_TOKEN;
  if (!token) {
    console.error("ANNICT_TOKEN が未設定です（.env.local を確認してください）。");
    process.exit(1);
  }

  const now = new Date();
  const year = process.argv[2] ?? String(now.getFullYear());
  const season = process.argv[3] ?? currentSeasonByMonth(now.getMonth() + 1);
  const seasonStr = `${year}-${season}`;

  console.log(`対象: ${seasonStr}\n`);
  const works = await fetchSeasonWorks(seasonStr, token);
  // .map(toAnimeItem) と書くと Array.map が (item, index, array) を渡すため、
  // indexがtoAnimeItemの第2引数(extra)に入り壊れる。単項のアロー関数で明示的に渡す。
  const items = works.map((w) => toAnimeItem(w));

  // (a) 配信サービス0件だがTV放送データはある作品。注目度（watchers）が高い順。
  // extraServices.tsで既に人力補完済みの作品は除外する（毎回同じ通知が出るのを防ぐ）。
  const tvOnlyAll = items.filter(
    (it) => it.services.length === 0 && it.otherServices.length === 0 && it.hasBroadcastData
  );
  const alreadyCovered = tvOnlyAll.filter((it) => (EXTRA_SERVICES[it.id]?.length ?? 0) > 0);
  const tvOnly = tvOnlyAll
    .filter((it) => (EXTRA_SERVICES[it.id]?.length ?? 0) === 0)
    .sort((a, b) => b.watchers - a.watchers);

  console.log(`(a) 配信サービス未登録の疑い（TV放送データあり・配信サービス0件）: ${tvOnly.length} 件`);
  for (const it of tvOnly) {
    console.log(`  - [${it.id}] ${it.title}（注目 ${it.watchers}人）`);
  }
  if (alreadyCovered.length > 0) {
    console.log(`  （うち content/works/extraServices.ts で人力補完済み: ${alreadyCovered.length} 件、表示から除外）`);
  }

  // (b) 「その他配信」に落ちた未知チャンネル名（SERVICESへの追加候補）。
  const otherNames = new Set<string>();
  for (const it of items) {
    for (const name of it.otherServices) otherNames.add(name);
  }
  console.log(`\n(b) 「その他配信」扱いの未知チャンネル名: ${otherNames.size} 件`);
  for (const name of [...otherNames].sort()) {
    console.log(`  - ${name}`);
  }

  console.log(
    `\n合計 ${items.length} 作品中、配信サービス0件は ${items.filter((it) => it.services.length === 0 && it.otherServices.length === 0).length} 件` +
      `（うちTV放送データあり ${tvOnly.length} 件／programsデータ自体なし ${items.filter((it) => it.services.length === 0 && it.otherServices.length === 0 && !it.hasBroadcastData).length} 件）`
  );
}

main().catch((err) => {
  console.error("監査に失敗しました:", err);
  process.exit(1);
});
