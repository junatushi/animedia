#!/usr/bin/env node
// 判定日の窓の中なら Issue のタイトルと本文を stdout に出す。窓の外なら**何も出さない**
// （season-prep.js と同じ約束。ワークフローは出力が空かどうかだけを見る）。
const { buildUsageCheck } = require("./lib/build-usage-check.js");

const result = buildUsageCheck();
if (!result) process.exit(0);

process.stdout.write(`TITLE: ${result.title}\n\n${result.body}`);
