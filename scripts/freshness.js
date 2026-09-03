#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────
// 収集の欠測検知（2026-08-31導入）
//
//   node scripts/freshness.js
//
// 【なぜ要るか】
// このリポジトリには「毎日 GitHub Actions が取ってきてコミットする」データが3系列ある。
// ところが**収集が止まっても誰も気づけない**。集計する側（seo-report.js など）は
// ディレクトリにある最新のファイルを読むだけなので、収集が何日止まっていても
// 平然と動き、それらしい数字を出し続けるからである。
//
// 実際、2026-08-31 に調べたところ**3系列すべてに欠測があった**（実測）:
//
//   content/coverage/first-seen.json   annict側の3クール全部で 2026-08-25 が欠測
//                                      （anilist側は欠測なし）
//   content/analytics/gsc/             2026-08-23 が欠測
//   content/analytics/site/            2026-08-25 が欠測
//
// 推測: 8/24〜25 は本番が HTTP 402 で停止していた日で、annict側の情報源は
// **デプロイ済みサイト自身の公開API**（/api/season）なので取りに行けなかった。
// `check-track-season.js` は「1情報源の失敗で残りを巻き添えにしない」ことを
// 正しく固定しているが、**失われたことを報告する相手が居なかった**。
//
// 【失敗と警告の分け方】
// 系列ごとに「後から取り返せるか」で扱いを変える。
//   ・取り返せない（first-seen）… 欠測1日でも**失敗**。毎日の変化そのものが
//     測定対象なので、その日の値はもう存在しない。
//   ・取り返せる（GSC・行動ログ）… 欠測は**警告**。ただし最新が古すぎる場合は
//     「1日落ちた」ではなく「収集が止まっている」なので失敗にする。
//
// ネットワークには出ない（コミット済みのファイルを読むだけ）。回帰テストは
// scripts/check-freshness.js。
// ───────────────────────────────────────────────────────────────
const fs = require("node:fs");
const path = require("node:path");

// テストが差し替えるための入口。既定はリポジトリのルートと「今日（JST）」。
const ROOT = process.env.FRESHNESS_ROOT || path.join(__dirname, "..");
const TODAY =
  process.env.FRESHNESS_TODAY ||
  new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

// ── 系列の登録 ───────────────────────────────────────────────
//
// **ここに登録されていない収集先が現れたら落ちる**（下の「登録漏れ」検査）。
// 収集を1本増やしたのに見張りを足し忘れる、という漏れ方を構造的に防ぐ。
// これは app/ の走査（scripts/lib/app-routes.js）と同じ考え方をデータ側へ当てたもの。
const SERIES = [
  {
    key: "gsc",
    label: "GSC検索パフォーマンス",
    kind: "dir",
    rel: "content/analytics/gsc",
    script: "scripts/fetch-gsc.js",
    // **ファイル名はGSCのデータ終了日**（実行日ではない）。GSCは3日ラグがあるので
    // 最新ファイルが今日より数日古いのは正常。ここを「今日でないと異常」にすると
    // 毎日必ず警告が出て、そのうち誰も読まなくなる。
    staleDays: 6,
    recoverable: true,
    recoverNote: "GSCは16ヶ月保持＝後から取り直せる",
  },
  {
    key: "site",
    label: "サイト自身の行動ログ",
    kind: "dir",
    rel: "content/analytics/site",
    script: "scripts/fetch-site-analytics.js",
    staleDays: 2,
    recoverable: true,
    recoverNote: "直近30日の移動集計なので翌日のファイルが同じ期間を覆う",
  },
  {
    key: "first-seen",
    label: "クール別の初出日",
    kind: "first-seen",
    rel: "content/coverage/first-seen.json",
    script: "scripts/track-season.js",
    staleDays: 2,
    recoverable: false,
    recoverNote: "毎日の変化そのものが測定対象で、後追いで取り返せない",
  },
];

// 収集先が置かれる場所。ここを走査して、登録漏れを見つける。
const COLLECTION_DIRS = ["content/analytics"];
const COLLECTION_FILES = ["content/coverage"];

// ── 既知の欠測（記録済み）─────────────────────────────────────
//
// 取り返せない欠測は**直しようがない**ので、放っておくとこの検査は毎日必ず失敗する。
// 毎日赤い検査は数日で読まれなくなり、そのうち新しい欠測も一緒に見逃す
// （このリポジトリでは実際に2件の検査が数セッション赤いまま放置されている＝
// docs/operations.md の㉔）。そこで**理由つきで記録したものだけ**を失敗から外す。
//
// **消すためのリストではなく、残すためのリスト。** 出力には「既知」として毎回出る。
// ここに足すのは「原因が分かっていて、かつ取り返せないと確認できたとき」だけにすること。
const ACKNOWLEDGED = [
  {
    series: "first-seen",
    arm: /^annict /,
    dates: ["2026-08-25"],
    reason:
      "2026-08-24〜25の本番停止（HTTP 402／docs/operations.md の㉝）。annict側の情報源は" +
      "デプロイ済みサイト自身の公開API（/api/season）なので、本番が止まると取りに行けない",
  },
];

function acknowledgedFor(seriesKey, arm, date) {
  return ACKNOWLEDGED.find(
    (a) =>
      a.series === seriesKey &&
      (a.arm instanceof RegExp ? a.arm.test(arm) : a.arm === arm) &&
      a.dates.includes(date)
  );
}

// ── 日付の道具 ───────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
const fromDay = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const diffDays = (a, b) => toDay(a) - toDay(b);

/** 日付の並びから、最初〜最後の間で欠けている日を返す。 */
function gapsIn(dates) {
  const sorted = [...new Set(dates)].sort();
  if (sorted.length < 2) return [];
  const out = [];
  for (let d = toDay(sorted[0]) + 1; d < toDay(sorted[sorted.length - 1]); d++) {
    if (!sorted.includes(fromDay(d))) out.push(fromDay(d));
  }
  return out;
}

// ── 系列ごとの「日付の並び」の取り出し ─────────────────────────
// 1系列が複数の「腕」を持つことがある（first-seen は 情報源×クール）。
function armsOf(series) {
  const abs = path.join(ROOT, series.rel);
  if (!fs.existsSync(abs)) return null; // 未収集（下で報告する）

  if (series.kind === "dir") {
    const dates = fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .filter((d) => DATE_RE.test(d));
    return [{ arm: series.label, dates }];
  }

  if (series.kind === "first-seen") {
    const json = JSON.parse(fs.readFileSync(abs, "utf8"));
    const arms = [];
    for (const [source, cours] of Object.entries(json.sources || {})) {
      for (const [cour, rec] of Object.entries(cours || {})) {
        const dates = (rec.daily || []).map((d) => d.date).filter((d) => DATE_RE.test(d));
        arms.push({ arm: `${source} ${cour}`, dates });
      }
    }
    return arms;
  }
  throw new Error(`未知の kind: ${series.kind}`);
}

// ── 本体 ─────────────────────────────────────────────────
let fail = 0;
let warn = 0;
let acked = 0;
const line = (mark, name, detail) => console.log(`${mark}  ${String(name).padEnd(34)} → ${detail}`);

function checkRegistration() {
  console.log("── 収集先の登録漏れ ──");
  const registered = new Set(SERIES.map((s) => s.rel.replace(/\\/g, "/")));
  const found = [];
  for (const dir of COLLECTION_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.isDirectory()) found.push(`${dir}/${ent.name}`);
    }
  }
  for (const dir of COLLECTION_FILES) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith(".json")) found.push(`${dir}/${f}`);
    }
  }
  const missing = found.filter((f) => !registered.has(f));
  if (missing.length) fail++;
  line(
    missing.length ? "✗" : "✓",
    "収集先がすべて登録されている",
    missing.length
      ? `未登録: ${missing.join(" / ")}（止まっても誰も気づけない）`
      : `${found.length} 件すべて登録済み`
  );
  // 逆に、登録したのに実物が無い（改名・移動）ことも見る。
  const ghosts = [...registered].filter((r) => !fs.existsSync(path.join(ROOT, r)));
  if (ghosts.length) fail++;
  line(
    ghosts.length ? "✗" : "✓",
    "登録した収集先が実在する",
    ghosts.length ? `見つからない: ${ghosts.join(" / ")}` : "欠けなし"
  );
}

function checkSeries(s) {
  const arms = armsOf(s);
  if (arms === null) {
    fail++;
    line("✗", s.label, `${s.rel} が無い（${s.script} が一度も成功していない）`);
    return;
  }
  for (const { arm, dates } of arms) {
    if (dates.length === 0) {
      fail++;
      line("✗", arm, "日付が1件も無い");
      continue;
    }
    const latest = [...dates].sort().at(-1);
    const lag = diffDays(TODAY, latest);
    const gaps = gapsIn(dates);

    // ①最新が古すぎる＝「1日落ちた」ではなく収集が止まっている。取り返せるかに関わらず失敗。
    if (lag > s.staleDays) {
      fail++;
      line("✗", arm, `最新が ${latest}（${lag}日前・許容${s.staleDays}日）＝収集が止まっている / ${s.script}`);
      continue;
    }
    // ②欠測。既知として記録済みのものは分けて数える（下げるのではなく、毎回出す）。
    const known = gaps.filter((d) => acknowledgedFor(s.key, arm, d));
    const fresh = gaps.filter((d) => !acknowledgedFor(s.key, arm, d));
    if (fresh.length) {
      if (s.recoverable) {
        warn++;
        line("⚠", arm, `欠測 ${fresh.join(", ")}（${s.recoverNote}）`);
      } else {
        fail++;
        line("✗", arm, `欠測 ${fresh.join(", ")}（${s.recoverNote}）`);
      }
      continue;
    }
    if (known.length) {
      acked += known.length;
      line("・", arm, `既知の欠測 ${known.join(", ")}（記録済み）／他は欠測なし・最新 ${latest}`);
      continue;
    }
    line("✓", arm, `${dates.length}日分・最新 ${latest}（${lag}日前）・欠測なし`);
  }
}

function main() {
  console.log(`収集の欠測検知（基準日 ${TODAY}）\n`);
  checkRegistration();
  for (const s of SERIES) {
    console.log(`\n── ${s.label}（${s.rel}）──`);
    checkSeries(s);
  }
  console.log(
    `\n結果: ${fail === 0 ? "失敗なし" : `${fail} 件の失敗`} / ${warn} 件の警告 / ${acked} 件の既知の欠測`
  );
  if (acked > 0) {
    console.log("既知の欠測は scripts/freshness.js の ACKNOWLEDGED に理由つきで記録してあります。");
  }
  if (fail > 0) {
    console.log("docs/operations.md の「収集の欠測」を確認してください。");
    process.exitCode = 1;
  }
}

main();
