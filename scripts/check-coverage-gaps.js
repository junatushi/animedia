#!/usr/bin/env node
"use strict";
// scripts/coverage-gaps.js の回帰テスト（2026-10-02導入）。
// 仮の first-seen.json / autoSchedule.json を置いて CLI を実際に動かし、
// **出すべき作品を出し、出してはいけない作品を出さない**ことを固定する。
// この道具は「静かに0件を返す」方向に壊れると、配信先の欠損が利用者に指摘されるまで
// 誰にも見えなくなる（導入の経緯そのもの）。ネットワークには出ない。

const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { findGaps, currentAndNextSeason } = require("./lib/coverage-gaps.js");

const ok = (name, note) => console.log(`  ✓ ${name}${note ? `（${note}）` : ""}`);

function run(store, auto, today) {
  const dir = mkdtempSync(join(tmpdir(), "coverage-gaps-"));
  const storePath = join(dir, "first-seen.json");
  const autoPath = join(dir, "autoSchedule.json");
  writeFileSync(storePath, JSON.stringify(store));
  if (auto) writeFileSync(autoPath, JSON.stringify(auto));
  return spawnSync(process.execPath, [join(__dirname, "coverage-gaps.js")], {
    encoding: "utf8",
    env: {
      ...process.env,
      COVERAGE_GAPS_STORE: storePath,
      COVERAGE_GAPS_AUTO: autoPath,
      COVERAGE_GAPS_TODAY: today,
    },
  });
}

const work = (title, extra = {}) => ({ title, firstSeen: "2026-08-12", services: {}, rank: 0, startDate: null, ...extra });

console.log("── クールの決め方 ──");
assert.deepStrictEqual(currentAndNextSeason("2026-10-02"), ["2026-autumn", "2027-winter"]);
ok("10月 → 秋・翌冬", "年またぎ");
assert.deepStrictEqual(currentAndNextSeason("2026-03-31"), ["2026-winter", "2026-spring"]);
ok("3月末 → 冬・春");

console.log("\n── 出すもの・出さないもの ──");
const store = {
  sources: {
    annict: {
      // 前のクールは見ない（終わったクールの欠損は対象外）
      "2026-summer": { works: { 1: work("夏の作品", { startDate: "2026-07-05", media: "TV" }) } },
      "2026-autumn": {
        works: {
          10: work("配信あり", { media: "TV", startDate: "2026-10-03", services: { d_anime: { firstSeen: "x" } } }),
          11: work("始まっているTV", { media: "TV", startDate: "2026-10-01", rank: 5 }),
          12: work("人気の始まっているTV", { media: "TV", startDate: "2026-09-30", rank: 500 }),
          13: work("劇場", { media: "MOVIE", startDate: "2026-10-01" }),
          14: work("予定日が劇場公開", { media: null }),
          15: work("開始日不明の配信オリジナル", { media: "WEB", rank: 50 }),
          16: work("延期", { media: "TV" }),
          17: work("予定日だけ分かる", { media: null, rank: 1 }),
          // scripts/coverage-gaps.js 本体の ACKNOWLEDGED に載っている実在の作品ID
          17228: work("本体で確認済みの作品", { media: "TV" }),
        },
      },
      "2027-winter": {
        works: {
          20: work("次期・まだ先", { media: "TV" }),
          21: work("次期・予定日が先", { media: null }),
        },
      },
    },
  },
};
const auto = {
  works: {
    14: { date: "2026-10-23", kind: "release" },
    17: { date: "2026-10-20", kind: "broadcast" },
    21: { date: "2027-01", kind: "broadcast" },
  },
};
const ack = [
  { id: "16", reason: "放送延期" },
  { id: "17228", reason: "本体の除外" },
];

const r = findGaps(store, "2026-10-02", ack, auto);
const ids = r.gaps.map((g) => g.id);
assert.deepStrictEqual(ids, ["12", "11", "17", "15"], `並び順: ${ids.join(",")}`);
ok("始まっている作品が先・同じ群は注目度の降順", ids.join(" → "));
assert.ok(!ids.includes("10"));
ok("配信が1件でもある作品は出さない");
assert.ok(!ids.includes("1"));
ok("前のクールは出さない");
assert.strictEqual(r.movies, 2);
assert.ok(!ids.includes("13") && !ids.includes("14"));
ok("劇場作品は出さず件数だけ数える", "media=MOVIE と autoSchedule の release の両方");
assert.deepStrictEqual(r.acknowledged.map((a) => a.id).sort(), ["16", "17228"]);
ok("確認済みの除外は理由つきで別に数える");
assert.strictEqual(r.later, 2);
ok("開始が30日より先の作品は出さない", "次期の開始日不明はクール初日で判定");
const g17 = r.gaps.find((g) => g.id === "17");
assert.strictEqual(g17.startDate, "2026-10-20");
assert.strictEqual(g17.urgency, 2);
ok("Annictに開始日が無ければ機械補完の予定日を使う");
assert.strictEqual(r.gaps.find((g) => g.id === "15").urgency, 3);
ok("開始日が全く分からない作品も落とさない", "独占配信の本命");

console.log("\n── 12月: 次期の開始日不明が30日以内に入る ──");
const dec = findGaps(store, "2026-12-15", ack, auto);
assert.ok(dec.gaps.some((g) => g.id === "20"), "次期の開始日不明が出ること");
assert.ok(dec.gaps.some((g) => g.id === "21"), "月精度の予定日は月初とみなすこと");
ok("次期が近づくと自動で対象に入る");

console.log("\n── CLI ──");
let p = run(store, auto, "2026-10-02");
assert.strictEqual(p.status, 0, p.stderr);
// CLIは本体の ACKNOWLEDGED だけを使う（テスト用の id 16 は除外されない）
assert.match(p.stdout, /配信サービスが1件も表示されていない作品が5件/);
assert.match(p.stdout, /人気の始まっているTV/);
assert.doesNotMatch(p.stdout, /本体で確認済みの作品|配信あり|夏の作品/);
assert.match(p.stdout, /extraServices\.ts/);
ok("Issue本文を出す", "直し方の案内つき・本体の確認済み除外が効く");

const clean = { sources: { annict: { "2026-autumn": { works: { 10: store.sources.annict["2026-autumn"].works[10] } }, "2027-winter": { works: {} } } } };
p = run(clean, auto, "2026-10-02");
assert.strictEqual(p.status, 0, p.stderr);
assert.strictEqual(p.stdout, "");
ok("欠損0件なら何も出さない", "ワークフローはそれを見てIssueを閉じる");

p = run(store, null, "2026-10-02");
assert.strictEqual(p.status, 0, p.stderr);
assert.match(p.stderr, /autoSchedule\.json を読めませんでした|を読めませんでした/);
assert.match(p.stdout, /始まっているTV/);
ok("予定日のファイルが無くても黙らずに動く");

p = run({ sources: {} }, auto, "2026-10-02");
assert.notStrictEqual(p.status, 0);
ok("記録の形が壊れていたら落ちる", "静かに0件にしない");

const noSeason = { sources: { annict: { "2026-autumn": store.sources.annict["2026-autumn"] } } };
p = run(noSeason, auto, "2026-10-02");
assert.match(p.stdout, /記録が無いクール: 2027-winter/);
ok("記録の無いクールを名指しする");

console.log("\n全件OK");
