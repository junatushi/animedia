#!/usr/bin/env node
"use strict";
// 本番依存の脆弱性（npm audit --omit=dev）を、GitHub Issueの本文（Markdown）として標準出力に出す
// （2026-11-05導入）。対応が要るもの（critical/high で、確認済みでないもの）が0件なら
// **何も出さない**（ワークフローはそれを見てIssueを閉じる）。ネットワークには npm audit が出る。
//
// なぜ要るか: Next.js 14系はサポート終了で、今後の脆弱性は14系では直らない。
// 新しい勧告が出たことに早く気づくための見張り。確認済みの勧告は
// scripts/lib/security-acknowledged.js が理由と期日つきで持つ。
//
// 終了コード: 0＝正常（出力が空なら対応不要）／2＝監査が取れていない
// （「取れていない」を「脆弱性ゼロ」として静かに成功させない）。
//
// 環境変数（テスト用。運用では未設定）:
//   SECURITY_AUDIT_INPUT … npm audit --json の出力ファイル（指定時は npm を起動しない）
//   SECURITY_AUDIT_TODAY … JSTの基準日 "YYYY-MM-DD"

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { ACKNOWLEDGED, validateAcknowledged } = require("./lib/security-acknowledged.js");

try {
  validateAcknowledged(ACKNOWLEDGED);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

function jstToday() {
  if (process.env.SECURITY_AUDIT_TODAY) return process.env.SECURITY_AUDIT_TODAY;
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fail(msg) {
  console.error(`✗ 脆弱性の監査が取れていません: ${msg}`);
  console.error("  （取れていないことは「脆弱性ゼロ」ではない。Issueを閉じずに調べること）");
  process.exit(2);
}

function readAudit() {
  if (process.env.SECURITY_AUDIT_INPUT) {
    try {
      return readFileSync(process.env.SECURITY_AUDIT_INPUT, "utf8");
    } catch (e) {
      fail(`入力ファイルを読めません（${e.message}）`);
    }
  }
  // 脆弱性があると npm audit は非0で終わるので、終了コードでは判定せず標準出力を読む。
  const r = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: join(__dirname, ".."),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (r.error) fail(`npm を起動できません（${r.error.message}）`);
  return r.stdout || "";
}

const SEVERITY_RANK = { critical: 4, high: 3, moderate: 2, low: 1 };

/** npm audit v2 の JSON を、勧告（GHSA）単位の一覧にする。 */
function collectAdvisories(audit) {
  const byId = new Map();
  for (const [pkg, v] of Object.entries(audit.vulnerabilities)) {
    for (const via of v.via || []) {
      if (!via || typeof via !== "object") continue; // 文字列は他パッケージ経由の連鎖
      const m = /(GHSA(?:-[a-z0-9]{4}){3})/i.exec(via.url || "");
      if (!m) continue;
      const id = m[1].toLowerCase().replace(/^ghsa/, "GHSA");
      if (byId.has(id)) continue;
      byId.set(id, {
        id,
        package: via.name || pkg,
        severity: via.severity || "low",
        title: via.title || "",
        url: via.url,
        range: via.range || "",
        fix: v.fixAvailable,
      });
    }
  }
  return [...byId.values()];
}

function fixText(fix) {
  if (fix === true) return "あり（semver-major ではない更新で解消）";
  if (!fix) return "なし";
  const major = fix.isSemVerMajor ? "semver-major（破壊的変更を含む）" : "semver-major ではない";
  return `あり: ${fix.name}@${fix.version}（${major}）`;
}

function main() {
  const raw = readAudit();
  let audit;
  try {
    audit = JSON.parse(raw);
  } catch (e) {
    fail(`npm audit の出力がJSONではありません（先頭: ${JSON.stringify(raw.slice(0, 120))}）`);
  }
  if (!audit || typeof audit !== "object") fail("npm audit の出力がオブジェクトではありません");
  if (audit.error && typeof audit.error === "object") {
    fail(`npm audit がエラーを返しました（${audit.error.code || ""} ${audit.error.summary || ""}）`.trim());
  }
  if (!audit.vulnerabilities || typeof audit.vulnerabilities !== "object" || !audit.metadata) {
    fail("npm audit の出力に vulnerabilities / metadata がありません（形が想定と違います）");
  }

  const today = jstToday();
  const advisories = collectAdvisories(audit);
  const ackById = new Map(ACKNOWLEDGED.map((a) => [a.id, a]));

  const todo = []; // { adv, previousAck }
  let ackActive = 0;
  const lowerCount = { moderate: 0, low: 0 };
  for (const adv of advisories) {
    if ((SEVERITY_RANK[adv.severity] || 0) < SEVERITY_RANK.high) {
      if (adv.severity in lowerCount) lowerCount[adv.severity]++;
      continue;
    }
    const ack = ackById.get(adv.id);
    if (ack && ack.recheckOn > today) {
      ackActive++;
      continue;
    }
    todo.push({ adv, previousAck: ack || null });
  }
  todo.sort(
    (a, b) =>
      SEVERITY_RANK[b.adv.severity] - SEVERITY_RANK[a.adv.severity] ||
      a.adv.package.localeCompare(b.adv.package) ||
      a.adv.id.localeCompare(b.adv.id),
  );

  // 監査に出なくなった確認済みの行（情報。失敗にしない）
  const seen = new Set(advisories.map((a) => a.id));
  const resolved = ACKNOWLEDGED.filter((a) => !seen.has(a.id));
  if (resolved.length > 0) {
    console.error(
      `解消済みなので行を消してよい（scripts/lib/security-acknowledged.js）: ${resolved.map((a) => `${a.id}（${a.package}）`).join(", ")}`,
    );
  }
  console.error(
    `脆弱性（本番依存）: 対応待ち ${todo.length}件（critical/high）・確認済み ${ackActive}件・moderate ${lowerCount.moderate}件・low ${lowerCount.low}件（${today}時点）`,
  );

  if (todo.length === 0) return;

  const lines = [];
  lines.push(`本番依存（\`npm audit --omit=dev\`）に、**未対応の critical/high の脆弱性が${todo.length}件**あります（${today}時点）。`);
  lines.push("");
  lines.push("Next.js 14系はサポート終了で、14系には修正版が出ません。新しい勧告は自然には直らないので、影響を読んで判断してください。");
  lines.push("");
  for (const { adv, previousAck } of todo) {
    lines.push(`### ${adv.package}: [${adv.id}](${adv.url})`);
    lines.push("");
    lines.push(`- 重大度: **${adv.severity}**`);
    lines.push(`- 内容: ${adv.title}`);
    lines.push(`- 影響を受ける範囲: \`${adv.range}\``);
    lines.push(`- 修正: ${fixText(adv.fix)}`);
    if (previousAck) {
      lines.push(
        `- **再確認の期日（${previousAck.recheckOn}）が来ました。** 前回の確認: ${previousAck.reason}${previousAck.note ? `（${previousAck.note}）` : ""}`,
      );
    }
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push("直し方:");
  lines.push("- 依存を更新して解消する（Next.js は 15/16 系への更新）。");
  lines.push(
    "- いまは直さないと判断したら、`scripts/lib/security-acknowledged.js` の `ACKNOWLEDGED` に **理由と再確認の期日（`recheckOn`）つきで** 足す。期日が来ると前回の理由つきでこのIssueに戻る。",
  );
  lines.push("- 手で確かめるには `node scripts/security-audit.js`（npm レジストリへの通信が要る）。");
  process.stdout.write(lines.join("\n") + "\n");
}

main();
