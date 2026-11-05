#!/usr/bin/env node
"use strict";
// 自動補完のPRが「データのリテラルだけ」を変えているかを確かめるCLI（2026-11-05導入）。
// 判定は scripts/lib/data-literal-guard.js が持つ（なぜ要るかもそちら）。
//
// 使い方（カレントディレクトリのgitリポジトリに対して）:
//   node scripts/check-data-only-pr.js --base <ref> --head <ref>
// 終了コード: 0 … 2ファイルとも変更なし、またはデータのリテラルだけの変更 / 1 … 1件でも不合格
// 標準出力はMarkdown（PRのコメントにそのまま貼る）。
// PRのファイルは `git show` で文字列として読むだけで、import / require / 実行はしない。
// **このCLIは、PRのファイルを import する工程より前に走らせること**（.github/workflows/coverage-autofill.yml）。

const { execFileSync } = require("node:child_process");
const { checkDataOnlyChange } = require("./lib/data-literal-guard.js");

const TARGETS = [
  { path: "content/works/extraServices.ts", marker: "export const EXTRA_SERVICES: Record<number, ExtraServiceEntry[]> = " },
  { path: "scripts/lib/coverage-acknowledged.js", marker: "const ACKNOWLEDGED = " },
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const base = arg("--base");
const head = arg("--head");
if (!base || !head) {
  console.error("使い方: node scripts/check-data-only-pr.js --base <ref> --head <ref>");
  process.exit(2);
}

const git = (args) => execFileSync("git", args, { maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
function resolves(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
/** ファイルが無ければ null。ref自体が壊れている等の失敗は上で弾いてあるので、ここでの失敗は「無い」。 */
function show(ref, path) {
  try {
    git(["cat-file", "-e", `${ref}:${path}`]);
  } catch {
    return null;
  }
  return git(["show", `${ref}:${path}`]).toString("utf8");
}

const out = ["### データのみの変更か（コードの混入検査）", ""];
let failed = 0;
for (const r of [base, head]) {
  if (!resolves(r)) {
    console.log(`${out.join("\n")}\n- ✗ 参照 \`${r}\` を解決できません。確かめられないので不合格にします。`);
    process.exit(1);
  }
}
for (const t of TARGETS) {
  const b = show(base, t.path);
  const h = show(head, t.path);
  if (b === null && h === null) {
    out.push(`- ✓ \`${t.path}\`: どちらの版にも無い（変更なし）`);
    continue;
  }
  if (b === null || h === null) {
    failed++;
    out.push(`- ✗ \`${t.path}\`: ${b === null ? "変更前に無く変更後に有る" : "変更前に有り変更後に無い"}（ファイルの追加・削除は自動では通しません）`);
    continue;
  }
  if (b === h) {
    out.push(`- ✓ \`${t.path}\`: 変更なし`);
    continue;
  }
  const r = checkDataOnlyChange({ base: b, head: h, marker: t.marker });
  if (r.ok) out.push(`- ✓ \`${t.path}\`: データのリテラルだけの変更（コード・import・リテラルの外は無変更）`);
  else {
    failed++;
    out.push(`- ✗ \`${t.path}\`: データ以外の変更が含まれています`);
    for (const e of r.errors) out.push(`  - ${e}`);
  }
}
out.push("");
out.push(failed === 0 ? "**データのみの変更です。**" : `**${failed}件が不合格。** コードやデータ以外の記述が混ざっているため、自動ではマージしません。人が確かめてください。`);
console.log(out.join("\n"));
process.exit(failed === 0 ? 0 : 1);
