// オンサイトSEOの定点観測。実データ（content/snapshots/）に対して、
// 「検索・生成AIから見たときのこのサイトの形」を毎日おなじ物差しで測る。
//
// 使い方: node scripts/seo-audit.ts [--markdown]
//   引数なし   … 人が読む形でターミナルに出す
//   --markdown … GitHub Issue に貼る Markdown で出す（.github/workflows/seo-daily.yml が使う）
//   ANNICT_TOKEN は不要（ネットワークに出ない。スナップショットとリポジトリ内の定数だけを読む）。
//
// なぜ「毎日」測るのか:
//   SEOの施策は、入れた直後は正しくても、データが増える・作品名が長くなる・
//   新しいクールが始まる、といった理由で**黙って壊れる**。実際このリポジトリでは
//   「titleにサービス名を入れたが幅を見ておらず、実データ335作品の99%で
//   表示前に切り捨てられていた」（2026-08-05に発覚）という事故が起きている。
//   画面を見ても気づけない種類の劣化なので、数字で見張る。
//
//   `node scripts/check.ts` が「壊れていたら赤にする不変条件」であるのに対し、
//   こちらは「赤ではないが悪化しているかもしれない傾向」を出す。だから
//   exit code は原則0で、CIを止めない（止めるべきものは check.ts 側に置く）。
import { readSnapshots } from "./build-archive-index.ts";
import { buildWorkTitle, displayWidth, TITLE_WIDTH_BUDGET } from "../lib/workTitle.ts";
import { buildDataFaq } from "../lib/workFaq.ts";
import { buildSeasonSummary, buildSeasonSummaryText } from "../lib/seasonSummary.ts";
import { splitRentalServices } from "../lib/services.ts";
import { RENTAL_SERVICES } from "../content/works/rentalServices.ts";
import ARCHIVE_INDEX from "../content/archive/index.json" with { type: "json" };
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// content/works/{id}.json（人力で書いた補足コンテンツ）を直接読む。
// content/works/index.ts 経由にできないのは、あちらが JSON を import attribute 無しで
// 読み込んでおり（Next のバンドラでは通るが Node の ESM では通らない）、
// このスクリプトが node から直接実行されるため。
function readManualFaqCounts(): Map<number, number> {
  const dir = join(process.cwd(), "content", "works");
  const counts = new Map<number, number>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const id = Number(f.replace(/\.json$/, ""));
    if (!Number.isInteger(id)) continue;
    try {
      const json = JSON.parse(readFileSync(join(dir, f), "utf8")) as { faq?: unknown[] };
      counts.set(id, json.faq?.length ?? 0);
    } catch {
      // 壊れたJSONはここでは無視する（node scripts/check.ts 側の責務）。
    }
  }
  return counts;
}
const MANUAL_FAQ = readManualFaqCounts();

const markdown = process.argv.includes("--markdown");

const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

interface Metric {
  label: string;
  value: string;
  // 目標に届いていないときだけ埋める。届いていれば undefined。
  gap?: string;
}

const metrics: Metric[] = [];
const findings: string[] = [];

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const snaps = readSnapshots();

// ─────────────────────────────────────────────
// ① 作品ページ title の幅
//
// 日本語の検索結果は概ね全角29〜32文字で打ち切られる（lib/workTitle.ts の
// TITLE_WIDTH_BUDGET のコメント参照）。予算を超えた分は「書いたのに読まれない」。
// 作品名だけで予算を超える作品は削れないので、それ以外の超過だけを問題として数える。
// ─────────────────────────────────────────────
{
  const widths: number[] = [];
  let avoidableOver = 0;
  let unavoidable = 0;
  let withServices = 0;
  let worst = { title: "", width: 0 };

  for (const { data } of snaps) {
    for (const it of data.items) {
      const { streaming } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
      const shorts = streaming.map((s) => s.short);
      const t = buildWorkTitle(it.title, shorts);
      const w = displayWidth(t);
      widths.push(w);
      if (shorts.length > 0) withServices++;
      if (w > TITLE_WIDTH_BUDGET) {
        // 作品名（主キーワード）だけで既に予算を超えているものは、削ると
        // 検索語と一致しなくなるので許容する。それ以外は詰め方の問題。
        if (displayWidth(it.title) >= TITLE_WIDTH_BUDGET) unavoidable++;
        else avoidableOver++;
        if (w > worst.width) worst = { title: t, width: w };
      }
    }
  }

  metrics.push({
    label: "title幅の中央値",
    value: `全角${median(widths)}文字（予算${TITLE_WIDTH_BUDGET}）`,
  });
  metrics.push({
    label: "予算超過（作品名を短くすれば収まるもの）",
    value: `${avoidableOver}件 / ${widths.length}件（${pct(avoidableOver, widths.length)}）`,
    gap: avoidableOver > 0 ? "0件にできるはず。buildWorkTitle の詰め方を見直す" : undefined,
  });
  metrics.push({
    label: "予算超過（作品名自体が長く、削れないもの）",
    value: `${unavoidable}件（${pct(unavoidable, widths.length)}）`,
  });
  metrics.push({
    label: "titleに配信サービス名が入っている作品",
    value: `${withServices}件（${pct(withServices, widths.length)}）`,
  });
  if (worst.width > 0) {
    findings.push(`最長のtitle: 「${worst.title}」（全角${worst.width}文字）`);
  }
  if (avoidableOver > 0) {
    findings.push(`**幅の予算を超えている作品が${avoidableOver}件ある**（詰め方の問題）`);
  }
}

// ─────────────────────────────────────────────
// ② 作品ページのQ&A数
//
// Q&A形式は同じ内容の文章よりAI検索での可視性が高く、質問が10件以上あるページは
// 引用可能性が大きく上がるという実測がある（lib/workFaq.ts の冒頭コメント参照）。
// 実データから作れる分だけで何問になっているかを測る。
//
// 母数は「実際に検索エンジンへ出している作品」だけにする。スナップショット全8,957作品で
// 数えると、sitemapに載せていない配信0件の作品（約7,000件）に引きずられて
// 「中央値1問」のような、施策の良し悪しと無関係な数字になる。
// ─────────────────────────────────────────────
const FAQ_TARGET = 10;
const INDEXED_IDS = new Set(ARCHIVE_INDEX.seasons.flatMap((s) => s.workIds));
{
  const counts: number[] = [];
  let zero = 0;
  let reachedTarget = 0;

  for (const { data } of snaps) {
    for (const it of data.items) {
      if (!INDEXED_IDS.has(it.id)) continue;
      const { streaming, rental } = splitRentalServices(it.services, RENTAL_SERVICES[it.id]);
      // スナップショットは credits を持たないため、声優・制作の2問はここでは数えない
      // （本番ではAnnictから取れるので実際はここに出る数より多くなる）。
      const faq = buildDataFaq({
        title: it.title,
        streamingNames: streaming.map((s) => s.name),
        rentalNames: rental.map((s) => s.name),
        otherServices: it.otherServices,
        broadcastStartDate: it.broadcastStartDate,
        broadcastWeekday: it.broadcastWeekday,
        broadcastTime: it.broadcastTime,
        castNames: [],
        director: null,
        productionCompany: null,
        originalCreators: [],
        status: "finished",
      });
      // ページ冒頭の「どこで配信？」＋人力の補足Q&Aを足したものが可視Q&Aの総数。
      const manual = MANUAL_FAQ.get(it.id) ?? 0;
      const total = faq.length + 1 + manual;
      counts.push(total);
      if (total <= 1) zero++;
      if (total >= FAQ_TARGET) reachedTarget++;
    }
  }

  metrics.push({
    label: "作品ページのQ&A数（中央値・索引済み作品／声優と制作を除く）",
    value: `${median(counts)}問`,
    gap:
      median(counts) < 4
        ? "実データから作れる問いが少ない。lib/workFaq.ts に追加できる観点がないか見る"
        : undefined,
  });
  metrics.push({
    label: `Q&Aが${FAQ_TARGET}問以上のページ（索引済み作品）`,
    value: `${reachedTarget}件（${pct(reachedTarget, counts.length)}）`,
  });
  metrics.push({
    label: "Q&Aが「どこで配信？」1問だけのページ（索引済み作品）",
    value: `${zero}件（${pct(zero, counts.length)}）`,
  });
  metrics.push({
    label: "人力の補足Q&Aがある作品",
    value: `${[...MANUAL_FAQ.values()].filter((n) => n > 0).length}件`,
  });
}

// ─────────────────────────────────────────────
// ③ 検索エンジンに出している在庫（sitemapに載る想定のURL）
//
// 「薄いページを送っていないか」を見る。配信0件の作品ページは
// 「配信情報なし」としか答えられないので載せない方針（app/sitemap.ts）。
// ─────────────────────────────────────────────
const RANKING_MIN_WORKS = 20;
{
  const seasons = ARCHIVE_INDEX.seasons;
  const workUrls = seasons.reduce((n, s) => n + s.workIds.length, 0);
  const rankingSeasons = seasons.filter((s) => s.workIds.length >= RANKING_MIN_WORKS).length;
  const emptySeasons = seasons.filter((s) => s.workIds.length === 0).length;

  metrics.push({ label: "過去クールのシーズンページ", value: `${seasons.length}件` });
  metrics.push({ label: "過去クールの作品ページ（配信1件以上）", value: `${workUrls}件` });
  metrics.push({
    label: "過去クールの勢力図・独占ページ",
    value: `${rankingSeasons * 2}件（${rankingSeasons}クール × 2）`,
  });
  metrics.push({
    label: "配信データが1件も無いクール",
    value: `${emptySeasons}件`,
    gap:
      emptySeasons > 0
        ? "そのシーズンページは全作品が「配信情報なし」になる。noindexにするか要検討"
        : undefined,
  });

  // 索引に入っているのに配信が0件の作品があってはならない（索引生成のバグ検知）。
  const idsWithStreaming = new Set<number>();
  for (const { data } of snaps) {
    for (const it of data.items) {
      if (it.services.length > 0 || it.otherServices.length > 0) idsWithStreaming.add(it.id);
    }
  }
  const thin = seasons.flatMap((s) => s.workIds).filter((id) => !idsWithStreaming.has(id));
  metrics.push({
    label: "索引に載っているが配信0件の作品",
    value: `${thin.length}件`,
    gap: thin.length > 0 ? "node scripts/build-archive-index.ts を再実行する" : undefined,
  });
  if (thin.length > 0) findings.push(`**薄いページを${thin.length}件 sitemap に送っている**`);
}

// ─────────────────────────────────────────────
// ④ シーズンページの要約文（そのクール固有の独自データ）
//
// 統計・数値を含むページはAI検索での可視性が上がる（lib/seasonSummary.ts参照）。
// 要約が空になるクール＝機械から見て他のクールと区別しにくいページ。
// ─────────────────────────────────────────────
{
  let withSummary = 0;
  const lengths: number[] = [];
  for (const { year, season, data } of snaps) {
    const text = buildSeasonSummaryText({
      year,
      label: SEASON_LABEL[season] ?? season,
      summary: buildSeasonSummary(data.items, (id) => RENTAL_SERVICES[id]),
      status: "finished",
    });
    if (text) {
      lengths.push([...text].length);
      // 「登録データがありません」で終わる要約は数字を持たない＝独自データにならない。
      if (!text.includes("まだありません")) withSummary++;
    }
  }
  metrics.push({
    label: "数字入りの要約が出せるクール",
    value: `${withSummary}件 / ${snaps.length}件（${pct(withSummary, snaps.length)}）`,
  });
  metrics.push({ label: "要約文の長さ（中央値）", value: `${median(lengths)}文字` });
}

// ─────────────────────────────────────────────
// ⑤ 今日の1手
//
// 数字だけ出しても手は動かないので、バックログから日替わりで1件出す。
// 日付でローテーションするので、同じ日に何度実行しても同じものが出る。
// 消化したらこの配列から消し、docs/seo-playbook.md の「実施済み」に移す。
// ─────────────────────────────────────────────
const BACKLOG = [
  "GSCで「平均掲載順位」と「表示回数」を先週と比べる。順位が上がって表示が増えていないなら、狙っている語がそもそも検索されていない",
  "GSCの「検索結果の外観」でリッチリザルトの表示状況を見る（FAQは2026-05に廃止済みなのでパンくずが出ているかを見る）",
  "`node scripts/audit-coverage.ts` を回し、(a)の注目作を content/works/extraServices.ts に足せないか見る",
  "上位10クエリのうち、着地ページのtitleに含まれていない語がないか確認する",
  "`?ref=embed` の流入と `embed_copy` イベントを見る。コピー0なら告知の問題、コピーはあるが流入0なら文言の問題",
  "検索で「{今期の注目作} 配信」を実際に引いて、自サイトが何位に出るか・上位が何を書いているかを見る",
  "ChatGPT/Perplexityに「{今期の注目作}はどこで配信されている？」と聞き、自サイトが引用されるか確認する",
  "content/works/{id}.json のFAQが未整備で、かつ表示回数の多い作品を1件埋める（一次情報のみ）",
  "PageSpeed Insightsでシーズンページのモバイルを測り、LCP/INP/CLSがしきい値内か見る",
  "docs/outreach-candidates.md の未接触ブログに1件、ウィジェットの案内を送る（人力）",
];
const dayIndex = Math.floor(Date.now() / 86400000) % BACKLOG.length;
const todaysAction = BACKLOG[dayIndex];

// ─────────────────────────────────────────────
// 出力
// ─────────────────────────────────────────────
const gaps = metrics.filter((m) => m.gap);

if (markdown) {
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`オンサイトSEOの定点観測（${today} JST）。`);
  lines.push("");
  lines.push("数字はすべて `content/snapshots/` の実データから算出しています（ネットワーク不要）。");
  lines.push("生成: `node scripts/seo-audit.ts --markdown`");
  lines.push("");
  lines.push("## 今日の1手");
  lines.push("");
  lines.push(`- [ ] ${todaysAction}`);
  lines.push("");
  lines.push("## 指標");
  lines.push("");
  lines.push("| 指標 | 値 | 気になる点 |");
  lines.push("|---|---|---|");
  for (const m of metrics) {
    lines.push(`| ${m.label} | ${m.value} | ${m.gap ?? ""} |`);
  }
  lines.push("");
  if (findings.length > 0) {
    lines.push("## 気づき");
    lines.push("");
    for (const f of findings) lines.push(`- ${f}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("方針と根拠は `docs/seo-playbook.md`。数字が悪化していたらまずそこを読むこと。");
  lines.push("不変条件の検査は `node scripts/check.ts`（こちらが赤ならCIも赤）。");
  console.log(lines.join("\n"));
} else {
  console.log("\n── オンサイトSEOの定点観測 ──\n");
  for (const m of metrics) {
    console.log(`  ${m.label.padEnd(44)} ${m.value}`);
    if (m.gap) console.log(`  ${"".padEnd(44)} ⚠ ${m.gap}`);
  }
  if (findings.length > 0) {
    console.log("\n  気づき:");
    for (const f of findings) console.log(`   - ${f.replace(/\*\*/g, "")}`);
  }
  console.log(`\n  今日の1手: ${todaysAction}`);
  console.log(`\n  要対応 ${gaps.length}件 / 指標 ${metrics.length}件\n`);
}
