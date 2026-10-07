#!/usr/bin/env node
"use strict";
// 配信先が未登録の作品を、GitHub Issueの本文（Markdown）として標準出力に出す
// （2026-10-02導入）。欠損が0件なら**何も出さない**（ワークフローはそれを見てIssueを閉じる）。
// 判定は scripts/lib/coverage-gaps.js が持つ。ネットワークには出ない。
//
// 使い方:
//   node scripts/coverage-gaps.js
// 環境変数（テスト用。運用では未設定）:
//   COVERAGE_GAPS_STORE … first-seen.json の場所
//   COVERAGE_GAPS_TODAY … JSTの基準日 "YYYY-MM-DD"
//   COVERAGE_GAPS_AUTO  … autoSchedule.json の場所

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { findGaps, renderIssue } = require("./lib/coverage-gaps.js");

// 確認済みの除外は scripts/lib/coverage-acknowledged.js が持つ（自動補完の検証も同じ一覧を読む）。
// 期日の無い除外・形の壊れた除外は、黙って効かせずに起動時に落とす。
const { ACKNOWLEDGED, validateAcknowledged } = require("./lib/coverage-acknowledged.js");
try {
  validateAcknowledged(ACKNOWLEDGED);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

function jstToday() {
  if (process.env.COVERAGE_GAPS_TODAY) return process.env.COVERAGE_GAPS_TODAY;
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const storePath =
  process.env.COVERAGE_GAPS_STORE || join(__dirname, "..", "content", "coverage", "first-seen.json");
const autoPath =
  process.env.COVERAGE_GAPS_AUTO || join(__dirname, "..", "content", "works", "autoSchedule.json");
const store = JSON.parse(readFileSync(storePath, "utf8"));
// 機械補完の予定日は無くても動く（開始日がクールの初日扱いになるだけ）。黙らずに言う。
let autoSchedule = null;
try {
  autoSchedule = JSON.parse(readFileSync(autoPath, "utf8"));
} catch (e) {
  console.error(`⚠ ${autoPath} を読めませんでした（${e.message}）。開始日はクールの初日で代用します`);
}
const result = findGaps(store, jstToday(), ACKNOWLEDGED, autoSchedule);
const body = renderIssue(result);
if (body) process.stdout.write(body + "\n");
// 件数は標準エラーへ（標準出力はIssue本文だけにする）
console.error(
  `配信先0件: ${result.gaps.length}件（劇場除外 ${result.movies}・先の作品除外 ${result.later}・確認済み除外 ${result.acknowledged.length}）`
);
