#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────
// 表示速度の「判定」レポート（2026-09-09導入）
//
//   node scripts/speed-report.js
//
// 【なぜ要るか】
// 収集だけ自動化して読む道具を作らないと、データはコミットされたまま誰にも読まれない。
// このリポジトリは同じ失敗を既に1回している（㉜: GSCの収集は自動化されていたのに
// 「改善したか・次に何をすべきか」を答える道具が無く、面別の効率差が2週間埋もれた）。
// 表示速度は2系統から来るので、1本のレポートに束ねる:
//
//   ・合成計測 … scripts/measure-production.js が毎日 content/analytics/speed/ に書く。
//     条件が固定なので**日々の比較ができる**。ただし実利用者の端末・回線ではない
//   ・RUM     … components/WebVitals.tsx → Supabase → content/analytics/site/ の vitals。
//     **実利用者の真値**だが、このサイトのトラフィックでは件数が溜まるのに時間が掛かる
//
// 【守っていること】
// ①**件数を必ず出し、少なければ「判定できない」と言う**。㉞・㊶で繰り返した
//   「少数からの一般化」をここで再発させない。
// ②**数字をこのファイルやドキュメントに転記しない**（CLAUDE.md の方針）。
//   読むたびに実データから出す。
// ③**目標は1箇所（下の GOALS）が持つ**。文中に 2000 と書き散らさない。
// 回帰テストは scripts/check-speed-report.js。
// ───────────────────────────────────────────────────────────────
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.join(__dirname, "..");
const SPEED_DIR = process.env.SPEED_DIR || path.join(REPO, "content/analytics/speed");
const SITE_DIR = process.env.SITE_DIR || path.join(REPO, "content/analytics/site");

// このサイトの目標と、参考にする外部基準。
// LCP を主指標にするのは「主要な中身が見えるまで」を表すため。
// 2000ms は利用者が掲げた「2秒未満」。2500ms は Google の Core Web Vitals の "good" 上限で、
// **SEO要件ではない**（CLAUDE.md の方針。速度への投資はUXと無料枠を根拠にする）。
const GOALS = { lcp: 2000, lcpReference: 2500 };
// RUM の p75 をこの件数未満で語らない。統計としてではなく「読み手が断定しないための線」。
const MIN_RUM_SAMPLES = 20;

function readDir(dir) {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      out.push({ date: f.replace(/\.json$/, ""), json: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) });
    } catch {
      // 壊れた1ファイルで全部を止めない。読めなかったことは下で数える。
      out.push({ date: f.replace(/\.json$/, ""), json: null });
    }
  }
  return out;
}

function fmtDelta(now, before) {
  if (before == null || now == null) return "";
  const d = now - before;
  if (d === 0) return "  ±0";
  return `  ${d > 0 ? "+" : ""}${d}ms`;
}

function main() {
  const speed = readDir(SPEED_DIR);
  const site = readDir(SITE_DIR);
  const broken = speed.filter((s) => s.json === null).map((s) => s.date);

  console.log("== 表示速度レポート ==\n");

  // ── ① 合成計測（条件固定・日々比較できる）
  const all = speed.filter((s) => s.json && Array.isArray(s.json.pages) && s.json.pages.length);
  // **計測元(base)が違う断面を並べて比較しない。** BASE=http://localhost:3100 で試すと
  // 同じディレクトリにファイルが落ちるので、放っておくと「本番が急に速くなった」に見える
  // （ローカルはネットワーク往復もコールドスタートも無いので必ず速く出る）。
  // 最新の base と同じものだけを時系列として扱い、混ざっていることは必ず告げる。
  const latestBase = all.at(-1)?.json.base ?? null;
  const usable = all.filter((s) => (s.json.base ?? null) === latestBase);
  const otherBases = [...new Set(all.filter((s) => (s.json.base ?? null) !== latestBase).map((s) => s.json.base))];
  if (usable.length === 0) {
    console.log("① 合成計測: **まだデータが無い**");
    console.log("   `node scripts/measure-production.js` が1日1回書く（.github/workflows/measure-speed.yml）。");
    console.log("   本番へ到達できる環境でしか動かないので、手元やサンドボックスでは BASE を指定して試す。\n");
  } else {
    const latest = usable[usable.length - 1];
    const prev = usable[usable.length - 2] ?? null;
    // 7日前に最も近い断面（無ければ最古）。
    const target = new Date(new Date(latest.date).getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const weekAgo = usable.filter((s) => s.date <= target).at(-1) ?? usable[0];
    const byFace = (snap, face) => snap?.json.pages.find((p) => p.face === face) ?? null;

    const c = latest.json.conditions ?? {};
    console.log(`① 合成計測（${latest.date}・${latest.json.base ?? "?"}）`);
    console.log(`   条件: CPU ${c.cpuThrottle ?? "?"}倍 / ${c.netKbps ?? "?"}kbps / ${c.runs ?? "?"}回の中央値 ／ 断面 ${usable.length} 日ぶん\n`);
    const rows = [...latest.json.pages].sort((a, b) => (b.lcp ?? 0) - (a.lcp ?? 0));
    console.log(
      "   面".padEnd(14) + "LCP".padStart(9) + "前回比".padStart(9) + "7日前比".padStart(10) +
        "FCP".padStart(8) + "TTFB".padStart(8) + "TBT".padStart(8) + "KB".padStart(7) + "  判定"
    );
    let over = 0;
    for (const p of rows) {
      const ok = p.lcp != null && p.lcp < GOALS.lcp;
      if (!ok) over++;
      console.log(
        "   " + String(p.face).padEnd(11) +
          `${p.lcp}ms`.padStart(9) +
          fmtDelta(p.lcp, byFace(prev, p.face)?.lcp).padStart(9) +
          fmtDelta(p.lcp, byFace(weekAgo, p.face)?.lcp).padStart(10) +
          `${p.fcp}ms`.padStart(8) + `${p.ttfb}ms`.padStart(8) +
          `${p.blockingMs}ms`.padStart(8) + `${p.loadKB}KB`.padStart(7) +
          (ok ? "  ✓" : `  ✗ 目標${GOALS.lcp}ms超`)
      );
    }
    console.log(
      `\n   → ${rows.length} 面中 ${rows.length - over} 面が目標（LCP ${GOALS.lcp}ms未満）を満たす` +
        `／Google基準(${GOALS.lcpReference}ms)なら ${rows.filter((p) => p.lcp < GOALS.lcpReference).length} 面`
    );
    // ㊴の逆戻り（画面内の先読みが復活すると、押してもいないページのために数MB飛ぶ）。
    const pf = rows.filter((p) => typeof p.scrollPrefetch === "number" && p.scrollPrefetch > 0);
    if (pf.length > 0) {
      console.log(`   ⚠ スクロールだけで先読みが飛んでいる面: ${pf.map((p) => `${p.face}(${p.scrollPrefetch}件/${p.scrollKB}KB)`).join(" ")}`);
      console.log("     `components/IntentLink.tsx` の素振り判定が壊れていないか見ること（㊴）。");
    }
    const missing = (latest.json.failures ?? []).concat(latest.json.skipped ?? []);
    if (missing.length > 0) console.log(`   ⚠ 測っていない: ${missing.join(" / ")}`);
    if (otherBases.length > 0) {
      console.log(`   ⚠ 別の計測元の断面が ${all.length - usable.length} 日ぶん混ざっている（${otherBases.join(", ")}）。`);
      console.log("     比較からは外してある。手元で試したファイルなら消すこと。");
    }
    if (/localhost|127\.0\.0\.1/.test(String(latest.json.base))) {
      console.log("   ⚠ これは**ローカルの計測**。本番の数字ではない（実データ・実画像が無いので");
      console.log("     LCPの候補が存在せず FCP と同じ値になる＝㊶と同じ落とし穴）。");
    }
    console.log("");
  }

  // ── ② RUM（実利用者の真値。件数が少ないうちは判定に使わない）
  const latestSite = site.filter((s) => s.json).at(-1);
  const vitals = latestSite?.json.vitals ?? [];
  console.log(`② 実利用者の実測（RUM${latestSite ? `・${latestSite.date} 時点の直近${latestSite.json.windowDays ?? "?"}日` : ""}）`);
  if (!latestSite) {
    console.log("   行動ログがまだ1件もコミットされていない。\n");
  } else if (vitals.length === 0) {
    console.log("   **まだ0件**。components/WebVitals.tsx は 2026-09-09 に本番投入したので、");
    console.log("   最初の値が載るのは翌日以降の site-analytics cron から。");
    console.log("   数日経っても0件のままなら、収集が静かに壊れている（送信は sendBeacon なので画面に出ない）。\n");
  } else {
    console.log("   面".padEnd(14) + "指標".padEnd(8) + "p75".padStart(9) + "件数".padStart(7) + "  判定");
    for (const v of vitals) {
      const enough = v.count >= MIN_RUM_SAMPLES;
      const judged =
        v.metric !== "LCP" ? "" : !enough ? `  — 件数不足（${MIN_RUM_SAMPLES}件未満）` : v.p75 < GOALS.lcp ? "  ✓" : `  ✗ 目標${GOALS.lcp}ms超`;
      console.log(
        "   " + String(v.face).padEnd(11) + String(v.metric).padEnd(8) +
          String(v.p75).padStart(9) + String(v.count).padStart(7) + judged
      );
    }
    const lcp = vitals.filter((v) => v.metric === "LCP");
    const enough = lcp.filter((v) => v.count >= MIN_RUM_SAMPLES);
    if (enough.length === 0 && lcp.length > 0) {
      console.log(`\n   → **まだ判定できない**（LCPの最大件数 ${Math.max(...lcp.map((v) => v.count))} 件 < ${MIN_RUM_SAMPLES} 件）。`);
      console.log("     検索からの流入は実測で1日数クリックなので、面ごとに溜まるには時間が掛かる。");
      console.log("     いま判断に使えるのは①の合成計測のほう。");
    }
    console.log("");
  }

  if (broken.length > 0) console.log(`⚠ 読めなかったファイル: ${broken.join(", ")}`);
  console.log("※ ここに出た数字をドキュメントへ転記しないこと（断面が固定されて実測とズレる）。");
}

main();
