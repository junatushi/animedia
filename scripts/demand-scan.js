// アニメ配信の「需要シグナル」集計 CLI。
// 収集(WebSearch)→ 保存(content/demand/raw/<date>.jsonl)→ このスクリプトで集計、の2段運用の後段。
//
// 使い方:
//   node scripts/demand-scan.js [rawFile ...]   … 指定の生JSONLを集計（省略時は content/demand/raw の最新1本）
//   node scripts/demand-scan.js --print-queries  … 収集に使う正準クエリ集を表示（収集手順の入口）
//   オプション:
//     --days N     直近N日でフィルタ（既定7。dateが分かるヒットのみ古いと除外）
//     --top N      各ランキングの上位N件（既定20）
//     --json PATH  集計JSONの保存先（既定 content/demand/out/<今日>.json）
//     --now ISO    「現在時刻」を固定（テスト・再現用。既定は実行時のJST）
//     --titles PATH 作品タイトル辞書(JSON配列 or 改行区切り)。引用符無しでも作品名を拾える
//
// 出力: 標準出力に Markdown 表（サービス需要 / 作品の配信先困りごと）、
//       併せて集計JSONをファイル保存。日付が不明なヒットの件数など注意書きも出す。
const { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { analyze } = require("./lib/demand-analyze");
const queries = require("../content/demand/queries");

const ROOT = join(__dirname, "..");
const RAW_DIR = join(ROOT, "content", "demand", "raw");
const OUT_DIR = join(ROOT, "content", "demand", "out");

function parseArgs(argv) {
  const opts = { files: [], days: undefined, top: undefined, json: undefined, now: undefined, titles: undefined, printQueries: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--print-queries") opts.printQueries = true;
    else if (a === "--days") opts.days = Number(argv[++i]);
    else if (a === "--top") opts.top = Number(argv[++i]);
    else if (a === "--json") opts.json = argv[++i];
    else if (a === "--now") opts.now = argv[++i];
    else if (a === "--titles") opts.titles = argv[++i];
    else if (a.startsWith("--")) throw new Error(`未知のオプション: ${a}`);
    else opts.files.push(a);
  }
  return opts;
}

// JSTの YYYY-MM-DD を返す（実行環境のTZに依存しない）。
function jstDateStr(nowMs) {
  const jst = new Date(nowMs + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function printQueries() {
  const { SOURCES, WHERE_TO_WATCH_QUERIES, SERVICE_DEMAND_QUERIES, PER_QUERY_LIMIT, WINDOW_DAYS } = queries;
  console.log("# アニメ配信 需要シグナル 収集クエリ（WebSearchで実行し content/demand/raw/<日付>.jsonl に保存）\n");
  console.log(`直近 ${WINDOW_DAYS} 日 / 1クエリ上限 ${PER_QUERY_LIMIT} 件目安 / 検索エンジン経由のみ（直接スクレイピング禁止）\n`);
  console.log("## 対象ソース（生ヒットの source フィールド値 / site:ヒント）");
  for (const s of SOURCES) console.log(`- ${s.source.padEnd(11)} ${s.label}  ${s.siteHint}`);
  console.log("\n## (A) 作品の配信先の困りごと クエリ");
  WHERE_TO_WATCH_QUERIES.forEach((q) => console.log(`- ${q}`));
  console.log("\n## (B) 配信サービスへの需要 クエリ");
  SERVICE_DEMAND_QUERIES.forEach((q) => console.log(`- ${q}`));
  console.log("\n生ヒット1行の形: { source, url, title, snippet, date(YYYY-MM-DD|null), query }");
}

// content/demand/raw の中で名前順（=日付順）最新の .jsonl を返す。
function latestRawFile() {
  if (!existsSync(RAW_DIR)) return null;
  const files = readdirSync(RAW_DIR).filter((f) => f.endsWith(".jsonl")).sort();
  return files.length ? join(RAW_DIR, files[files.length - 1]) : null;
}

function readJsonl(path) {
  const out = [];
  const text = readFileSync(path, "utf8");
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      console.error(`  ! ${path}:${i + 1} をJSONとして読めずスキップ: ${e.message}`);
    }
  });
  return out;
}

function loadTitles(path) {
  if (!path || !existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8").trim();
  if (text.startsWith("[")) return JSON.parse(text);
  return text.split("\n").map((s) => s.trim()).filter(Boolean);
}

function mdTable(rows, kindLabel) {
  if (!rows.length) return `（該当なし）`;
  const lines = [`| # | ${kindLabel} | スコア | 言及数 | 主な出典 |`, `|---|---|---|---|---|`];
  rows.forEach((e, i) => {
    const src = e.hits.slice(0, 3).map((h) => `[${h.source}](${h.url})`).join(" ");
    lines.push(`| ${i + 1} | ${e.key} | ${e.score.toFixed(1)} | ${e.mentions} | ${src} |`);
  });
  return lines.join("\n");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.printQueries) {
    printQueries();
    return;
  }

  // 「現在時刻」: --now 指定があればそれ、無ければ実行時刻。
  const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
  if (Number.isNaN(nowMs)) throw new Error(`--now が解釈できません: ${opts.now}`);

  const files = opts.files.length ? opts.files : [latestRawFile()].filter(Boolean);
  if (!files.length) {
    console.error("集計対象の生JSONLがありません。まず --print-queries の手順で");
    console.error(`${RAW_DIR} に <日付>.jsonl を用意してください。`);
    process.exit(1);
  }

  const rawHits = files.flatMap((f) => {
    if (!existsSync(f)) {
      console.error(`  ! 見つかりません: ${f}`);
      return [];
    }
    return readJsonl(f);
  });

  const titlesDict = loadTitles(opts.titles);
  const result = analyze(rawHits, {
    windowDays: opts.days ?? queries.WINDOW_DAYS,
    nowMs,
    titlesDict,
    top: opts.top ?? 20,
  });

  // JSON保存
  const outPath = opts.json || join(OUT_DIR, `${jstDateStr(nowMs)}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  const payload = { generatedAt: new Date(nowMs).toISOString(), sourceFiles: files, ...result };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf8");

  // 標準出力にレポート
  console.log(`# アニメ配信 需要シグナル（直近${result.windowDays}日）\n`);
  console.log(
    `入力 ${result.totalRawHits} 件 → 採用 ${result.keptHits} 件` +
      `（重複除外 ${result.droppedDup} / 期間外除外 ${result.droppedOld} / 日付不明 ${result.unknownDateHits}）\n`
  );
  console.log("## 配信サービスへの需要（加入・解約・比較・おすすめ系）\n");
  console.log(mdTable(result.serviceDemand, "配信サービス"));
  console.log("\n## 作品の配信先の困りごと（どこで見れる／配信されてない系）\n");
  console.log(mdTable(result.workWhereToWatch, "作品"));
  if (result.unclassified.length) {
    console.log(`\n## 未分類（作品/サービスを特定できなかった需要シグナル）: ${result.unclassified.length} 件（JSON参照）`);
  }
  if (result.unknownDateHits) {
    console.log(
      `\n注: 日付不明のヒット ${result.unknownDateHits} 件は期間フィルタを通せず残しています` +
        `（WebSearchの抜粋に日付が無いため。推測で日付は補完しません）。`
    );
  }
  console.log(`\n→ 集計JSON: ${outPath}`);
}

try {
  main();
} catch (err) {
  console.error("集計に失敗しました:", err.message);
  process.exit(1);
}
