#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────
// Vercel利用量の「判定」レポート（2026-09-15導入）
//
//   node scripts/usage-report.js [--days 7]
//
// コミット済みの content/analytics/usage/*.json（scripts/fetch-vercel-usage.js が
// 毎日書く）を読み、**無料枠に収まるか**を1日あたりの予算に対して判定する。
// ネットワークには出ない。
//
// 【なぜ「1日あたり」で見るか】
// ダッシュボードが見せるのはローリング30日の合計なので、対策を打った直後は
// **対策前の分が窓に残っている間ずっと赤いまま**で、効いたかどうかが分からない。
// 実際にこれで一度誤読しており（30日窓で108%✗ → 対策後だけの9日窓では17%✓。
// docs/operations.md の㉝）、判断に使えるのは1日あたりの増え方だけ。
//
// 【静かに間違えないための約束】
//   ・**明細0件は「利用ゼロ」ではなく「取れていない」**と書く。Hobbyプランで
//     請求明細が返るかは未確認なので、0件を無料枠内と読み違えない
//   ・**単位が予期と違うときは判定しない**（保留と明記する）。請求APIの
//     PricingQuantity がダッシュボードと同じ単位かは実データを見るまで確定しない
//   ・**予算表に無いサービス名は必ず出す**。Vercelが名前を変えたときに
//     その指標が黙って消えるのを防ぐ
//   ・**当日は平均に入れない**（途中までしか集計されていない＝必ず低く見える）
//
// 回帰テストは scripts/check-vercel-usage.js。
// ───────────────────────────────────────────────────────────────
const fs = require("node:fs");
const path = require("node:path");
const { judge, PERIOD_DAYS } = require("./lib/vercel-usage.js");

const DIR =
  process.env.VERCEL_USAGE_OUT_DIR || path.join(__dirname, "..", "content", "analytics", "usage");

const argDays = (() => {
  const i = process.argv.indexOf("--days");
  return i >= 0 ? Number(process.argv[i + 1]) : 7;
})();

const fmt = (n, digits = 1) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? "—"
    : Math.abs(n) >= 1000
      ? Math.round(n).toLocaleString("en-US")
      : n.toFixed(digits).replace(/\.0+$/, "");

const MARK = { ok: "✓", warn: "⚠", over: "✗", missing: "・", balance: "・", nodata: "・" };

function latestFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

function main() {
  const file = latestFile(DIR);
  if (!file) {
    // **「まだ来ていない」と「来ることがない」を混ぜない**（2026-09-19）。
    // Hobbyには請求明細APIが無いと実測で確定したので、待っていれば入ると読める
    // 案内をそのまま出すと、毎回「そのうち取れる」と誤読させ続けることになる。
    console.log(`${DIR} にまだ1件もありません。`);
    console.log(
      "このアカウントが Hobby プランなら、**待っても入りません**" +
        "（請求明細APIが 404 Plan not found を返す＝Hobbyは請求サイクルを持たない。2026-09-19実測）。"
    );
    console.log(
      "その場合の利用量の確認は usage-check.yml が判定日に出すIssue（ダッシュボード目視）が担います。"
    );
    console.log("詳細と、有料プランに変えたときの挙動は docs/vercel-usage-setup.md。");
    return;
  }
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  const today = path.basename(file).replace(/\.json$/, "");
  const r = judge(snapshot, { days: argDays, today });
  // 直前の同じ幅の窓（推移を見るため）。窓が埋まっていなければ出さない。
  const prev = judge(snapshot, { days: argDays * 2, today });

  console.log(`Vercel利用量の判定（${path.basename(file)} / 取得 ${snapshot.fetchedAt ?? "?"}）\n`);

  if (r.empty) {
    console.log("✗  明細が0件です。**利用がゼロなのではなく、取れていません。**");
    console.log("   Hobbyプランで請求明細が返るかは未確認です。");
    console.log("   docs/vercel-usage-setup.md の「うまくいかないとき」を見てください。\n");
    process.exitCode = 1;
    return;
  }

  console.log(`対象: ${r.from} 〜 ${r.to}（完全な ${r.days} 日ぶん・明細 ${r.chargeCount} 件）`);
  console.log(`判定: 1日あたりの実測 × ${PERIOD_DAYS}日 を無料枠の上限と比べる`);
  console.log(`      （ダッシュボードのローリング30日合計は、対策前の分が残るので使わない）\n`);

  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `${pad("", 2)}${pad("指標", 26)}${pad("1日あたり", 14)}${pad("1日の予算", 14)}${pad("30日見込み", 14)}${pad("上限", 12)}比`
  );
  console.log("─".repeat(100));

  let over = 0;
  let pending = 0;
  for (const m of r.metrics) {
    if (m.status === "missing") continue;
    if (m.status === "over") over++;
    if (m.status === "unit-mismatch") pending++;
    const ratio = m.ratio === null ? "—" : `${(m.ratio * 100).toFixed(0)}%`;
    if (m.status === "unit-mismatch" || m.status === "balance" || m.status === "nodata") {
      console.log(`${pad(MARK[m.status] ?? "?", 2)}${pad(m.label, 26)}${m.reason}`);
      if (m.status === "balance" && m.total !== null) {
        console.log(`${pad("", 28)}期間内の合計 ${fmt(m.total)} ${m.unit}（上限 ${m.limit} ${m.unit}）`);
      }
      continue;
    }
    console.log(
      `${pad(MARK[m.status], 2)}${pad(m.label, 26)}${pad(fmt(m.perDay), 14)}${pad(fmt(m.perDayBudget), 14)}${pad(fmt(m.projected), 14)}${pad(fmt(m.limit, 0), 12)}${ratio}`
    );
    if (m.note) console.log(`${pad("", 28)}${m.note}`);
  }

  // 推移（同じ幅の1つ前の窓と比べる）。窓が足りなければ黙って省く。
  if (prev.days > r.days) {
    console.log("\n── 推移（1日あたり・直近の窓 / その前を含む広い窓）──");
    for (const m of r.metrics) {
      if (m.status !== "ok" && m.status !== "warn" && m.status !== "over") continue;
      const p = prev.metrics.find((x) => x.key === m.key);
      if (!p || p.perDay === null || !Number.isFinite(p.perDay) || p.perDay === 0) continue;
      const diff = ((m.perDay - p.perDay) / p.perDay) * 100;
      const arrow = diff <= -5 ? "↓" : diff >= 5 ? "↑" : "→";
      console.log(
        `${arrow}  ${String(m.label).padEnd(26)}${fmt(m.perDay)} / ${fmt(p.perDay)}（${diff >= 0 ? "+" : ""}${diff.toFixed(0)}%）`
      );
    }
  }

  if (r.unknownServices.length) {
    console.log("\n── 予算表に無いサービス名 ──");
    console.log("Vercelが名前を変えたか、新しい課金項目が増えています。");
    console.log("**放置するとその指標は判定から黙って消えます。**");
    console.log("scripts/lib/vercel-usage.js の BUDGET に aliases を足してください。");
    for (const s of r.unknownServices) console.log(`  ・${s.name}（合計 ${fmt(s.total)}）`);
  }

  console.log("");
  if (over > 0) {
    console.log(`✗ ${over} 件が上限を超える見込みです。docs/operations.md の㊻を見てください。`);
    process.exitCode = 1;
  } else if (pending > 0) {
    console.log(`⚠ ${pending} 件は単位が確認できず判定を保留しました（上の理由を参照）。`);
  } else {
    console.log("✓ 判定できた指標はすべて上限内の見込みです。");
  }
}

main();
