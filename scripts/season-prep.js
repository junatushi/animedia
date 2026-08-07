#!/usr/bin/env node
// クール開始「前倒し準備」チェックリストのIssue本文をstdoutに出すCLI（2026-08-07導入）。
// .github/workflows/season-prep.yml から毎日1回呼ばれる。
//
// 窓の外（＝いま準備を始める時期ではない）なら**何も出力せず**終了コード0で終わる。
// ワークフロー側はstdoutが空ならIssueを起票しない、という作りにしてあるので、
// 「今日は起票しない」を判定するロジックはこのスクリプトの中だけで完結する。
//
// 出力フォーマット（窓の中のときだけ）:
//   1行目 … "TITLE: <Issueタイトル>"
//   2行目 … 空行
//   3行目以降 … Issue本文（Markdown）
// ワークフロー側はこれを1行目と3行目以降に分割して `gh issue create --title/--body-file` に渡す。
"use strict";

const { findPrepWindow, buildSeasonPrepIssue } = require("./lib/build-season-prep");

function main() {
  const window = findPrepWindow(new Date());
  if (!window) {
    // 窓の外。何も出力しない（ワークフロー側はこれを見て起票をスキップする）。
    return;
  }
  const { title, body } = buildSeasonPrepIssue(window);
  process.stdout.write(`TITLE: ${title}\n\n${body}\n`);
}

// require.main チェック: テストからこのファイルをimportしても main() が走らないようにする
// （scripts/print-digest.js と同じ作法）。
if (require.main === module) {
  main();
}

module.exports = { main };
