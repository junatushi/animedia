// 配信状況の年次推移を集計して表示する（2026-08-07導入）。
//
//   node scripts/streaming-trends.ts          … 表を出す
//   node scripts/streaming-trends.ts --post   … SNS投稿用の下書きも出す
//
// content/snapshots/ を読むだけでネットワークには出ない。
// 集計ロジックと「使ってよい年」の判定は lib/streamingTrends.ts（そちらの冒頭に
// なぜ上位N作品に絞るのかの経緯がある。要約: 全作品で集計すると Annict の収録改善と
// 実際の市場変化が区別できず、実際に誤った結論〈Netflixの後退〉が出たため）。
//
// 【使うときの注意】ここが出す数字は「Annictに記録された配信社数」であって
// 「実際に配信された社数」ではない。投稿文に写すときも主語を変えないこと。
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  aggregateYear,
  usableYears,
  currentState,
  pct,
  TOP_N,
  COVERAGE_FLOOR,
  type TrendWork,
  type YearTrend,
} from "../lib/streamingTrends.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapDir = path.join(root, "content", "snapshots");

// 表に出すサービス（掲載率を見たい主要どころ）。
const WATCH_SERVICES: [string, string][] = [
  ["d_anime", "dアニメ"],
  ["abema", "ABEMA"],
  ["netflix", "Netflix"],
  ["prime", "Prime"],
  ["unext", "U-NEXT"],
];

function loadByYear(): Map<string, TrendWork[][]> {
  const byYear = new Map<string, TrendWork[][]>();
  for (const file of readdirSync(snapDir).filter((f) => f.endsWith(".json")).sort()) {
    const year = file.split("-")[0];
    const raw = JSON.parse(readFileSync(path.join(snapDir, file), "utf8"));
    const items: TrendWork[] = (raw.items ?? []).map((w: any) => ({
      watchers: w.watchers ?? 0,
      hasBroadcastData: !!w.hasBroadcastData,
      services: w.services ?? [],
    }));
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(items);
  }
  return byYear;
}

const trends: YearTrend[] = [...loadByYear()].map(([year, seasons]) => aggregateYear(year, seasons));
const usable = usableYears(trends);

console.log(`各クールの注目度上位${TOP_N}作品で集計（配信率${pct(COVERAGE_FLOOR)}未満の年は比較に使わない）\n`);
const head = ["年", "対象", "配信あり", "配信率", "平均社数", "独占率", ...WATCH_SERVICES.map(([, n]) => n)];
console.log(head.join("\t"));
for (const t of trends) {
  const mark = t.coverage >= COVERAGE_FLOOR ? " " : "×";
  console.log(
    [
      `${mark}${t.year}`,
      t.works,
      t.withServices,
      pct(t.coverage),
      t.avgServices.toFixed(1),
      pct(t.exclusiveRate),
      ...WATCH_SERVICES.map(([k]) => pct(t.serviceRate[k] ?? 0)),
    ].join("\t")
  );
}

console.log(
  [
    ``,
    `⚠ 年次の増減はこのデータでは主張できない。上位${TOP_N}作品への絞り込みが補正するのは`,
    `  「作品に配信情報があるか」までで、「その作品の配信社が漏れなく記録されているか」は`,
    `  補正されていない。実例として U-NEXT の掲載率は 2021年=0% → 2023年=79% と出るが、`,
    `  U-NEXTが2021年にアニメを配信していなかったはずはなく、これは記録漏れである。`,
    `  同じ疑いが ABEMA の推移にも平均配信社数の増加にも掛かる（サービスが記録漏れすると`,
    `  作品は実際より「独占」に見え、社数は少なく出る＝収録改善だけで同じ形の結論が出る）。`,
    `  外に出してよいのは、記録が濃い直近年の**現状**だけ。`,
  ].join("\n")
);

const state = currentState(trends);
if (!state) {
  console.log("\n集計が成り立つ年が無い。");
  process.exit(0);
}

console.log(`\n── 外向けに使える形: ${state.year}年の現状 ──`);
console.log(`対象            各クール上位${TOP_N}作品 × 4クール ＝ ${state.works}作品`);
console.log(`配信情報あり     ${state.withServices}作品（${pct(state.coverage)}）`);
console.log(`平均配信社数     ${state.avgServices.toFixed(1)}社`);
console.log(`1社独占         ${pct(state.exclusiveRate)}`);
for (const [k, name] of WATCH_SERVICES) {
  console.log(`${name.padEnd(14)} ${pct(state.serviceRate[k] ?? 0)}`);
}

if (!process.argv.includes("--post")) process.exit(0);

// ── SNS投稿の下書き ────────────────────────────────────────────
// 数字は上の集計から埋める（手打ちしない）。断定と、年次の増減を足さないこと。
console.log("\n──────── 投稿下書き（コピー用） ────────\n");
console.log(
  [
    `「今のアニメは配信がバラバラで、何本も契約しないと見られない」と言われますが、`,
    `${state.year}年の注目作を数えたら逆でした。`,
    ``,
    `各クールの注目作${TOP_N}本（計${state.works}作品）のうち:`,
    `・1作品あたり平均 ${state.avgServices.toFixed(1)}社 で配信`,
    `・1社でしか見られない作品は ${pct(state.exclusiveRate)} だけ`,
    `・dアニメストア ${pct(state.serviceRate["d_anime"] ?? 0)} / ABEMA ${pct(state.serviceRate["abema"] ?? 0)} / Prime Video ${pct(state.serviceRate["prime"] ?? 0)}`,
    ``,
    `どれか1つ入っていれば大体見られる、という状況になっています。`,
    `※Annictに記録された配信情報の集計です`,
  ].join("\n")
);
console.log("\n────────────────────────────────────────");
