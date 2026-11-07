#!/usr/bin/env node
"use strict";
// scripts/security-audit.js の回帰テスト（2026-11-05導入）。
// 仮の npm audit JSON を置いて CLI を実際に動かし、**出すべきときに出し、出してはいけないときに
// 出さない**ことと、**監査が取れていないときに静かに成功しない**ことを固定する。
// この道具は「何も出さない」方向に壊れると、新しい脆弱性が出ても毎日緑のまま誰も気づけない。
// ネットワークには出ない。

const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { ACKNOWLEDGED, validateAcknowledged } = require("./lib/security-acknowledged.js");

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(e.message).split("\n").join("\n      ")}`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "security-audit-"));
// 確認済みの一覧はテスト用の1件を渡す（本物の一覧は依存を上げると空になりうる。2026-11-06に
// Next.js 16へ上げて17件すべてが解消し、本物の一覧に頼っていたテストが試すものを失った）。
const KNOWN = {
  id: "GHSA-zzzz-yyyy-xxxx",
  package: "next",
  reason: "テスト用の確認済みの理由",
  recheckOn: "2026-12-05",
};
const ackFile = join(dir, "ack.json");
writeFileSync(ackFile, JSON.stringify([KNOWN]));
let seq = 0;
function run(content, today) {
  const p = join(dir, `audit-${seq++}.json`);
  writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content));
  return spawnSync(process.execPath, [join(__dirname, "security-audit.js")], {
    encoding: "utf8",
    env: { ...process.env, SECURITY_AUDIT_INPUT: p, SECURITY_AUDIT_TODAY: today || "2026-11-05", SECURITY_AUDIT_ACK: ackFile },
  });
}

const via = (id, severity, extra = {}) => ({
  source: 1,
  name: "next",
  dependency: "next",
  title: `テスト用の勧告 ${id}`,
  url: `https://github.com/advisories/${id}`,
  severity,
  range: ">=13.0.0 <15.0.8",
  ...extra,
});
const audit = (vias, fixAvailable = true) => ({
  auditReportVersion: 2,
  vulnerabilities: {
    next: { name: "next", severity: vias[0] ? vias[0].severity : "low", via: vias, effects: [], range: "*", fixAvailable },
  },
  metadata: { vulnerabilities: { total: vias.length } },
});


console.log("── Issue本文を出す／出さない ──");
test("未確認の critical は本文に GHSA ID と修正情報を出す", () => {
  const r = run(audit([via("GHSA-aaaa-bbbb-cccc", "critical")], { name: "next", version: "16.0.0", isSemVerMajor: true }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /GHSA-aaaa-bbbb-cccc/);
  assert.match(r.stdout, /critical/);
  assert.match(r.stdout, /next@16\.0\.0/);
  assert.match(r.stdout, /semver-major/);
});
test("未確認の high も出す", () => {
  const r = run(audit([via("GHSA-dddd-eeee-ffff", "high")]));
  assert.match(r.stdout, /GHSA-dddd-eeee-ffff/);
});
test("全部確認済みなら何も出さず終了コード0", () => {
  const r = run(audit([via(KNOWN.id, "high")]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, "");
});
test("確認済みと未確認が混ざれば未確認だけ出す", () => {
  const r = run(audit([via(KNOWN.id, "high"), via("GHSA-gggg-hhhh-jjjj", "high")]));
  assert.match(r.stdout, /GHSA-gggg-hhhh-jjjj/);
  assert.ok(!r.stdout.includes(KNOWN.id));
});
test("再確認の期日が来た除外は、前回の理由つきで本文に戻る", () => {
  const r = run(audit([via(KNOWN.id, "high")]), KNOWN.recheckOn); // 当日から効かない
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(KNOWN.id));
  assert.ok(r.stdout.includes(KNOWN.reason), "前回の理由");
  assert.ok(r.stdout.includes(KNOWN.recheckOn));
  const before = run(audit([via(KNOWN.id, "high")]), "2026-12-04");
  assert.strictEqual(before.stdout, "", "期日の前日まではまだ効く");
});
test("moderate/low だけなら何も出さない（件数は標準エラー）", () => {
  const r = run(audit([via("GHSA-kkkk-llll-mmmm", "moderate"), via("GHSA-nnnn-pppp-qqqq", "low")]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, "");
  assert.match(r.stderr, /moderate 1件/);
});
test("同じ勧告が複数パッケージ経由で現れても1件にまとめる", () => {
  const a = audit([via("GHSA-rrrr-ssss-tttt", "high")]);
  a.vulnerabilities.other = { name: "other", via: [via("GHSA-rrrr-ssss-tttt", "high"), "next"], fixAvailable: false };
  const r = run(a);
  assert.strictEqual(r.stdout.split("\n").filter((l) => l.startsWith("### ")).length, 1, "見出しは1件だけ");
});
test("監査に出なくなった確認済みの行は標準エラーで知らせる（失敗にしない）", () => {
  const r = run(audit([]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stderr, /解消済みなので行を消してよい/);
});

console.log("\n── 監査が取れていないときは静かに成功しない ──");
test("JSONでない出力は終了コード2", () => {
  const r = run("npm ERR! something");
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /取れていません/);
});
test("空の出力は終了コード2", () => {
  assert.strictEqual(run("").status, 2);
});
test("トップレベルの error は終了コード2", () => {
  const r = run({ error: { code: "ENOAUDIT", summary: "registry down" } });
  assert.strictEqual(r.status, 2);
  assert.strictEqual(r.stdout, "");
});
test("vulnerabilities / metadata が無ければ終了コード2", () => {
  assert.strictEqual(run({ auditReportVersion: 2 }).status, 2);
  assert.strictEqual(run({ vulnerabilities: {} }).status, 2);
});
test("脆弱性0件の正常な応答は終了コード0・出力なし", () => {
  const r = run({ auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, "");
});

console.log("\n── ACKNOWLEDGED の検証 ──");
const good = { id: "GHSA-aaaa-bbbb-cccc", package: "x", reason: "理由", recheckOn: "2027-01-01" };
test("理由が無ければ例外", () => assert.throws(() => validateAcknowledged([{ ...good, reason: "" }]), /不正/));
test("recheckOn が無ければ例外", () => {
  const { recheckOn, ...rest } = good;
  assert.throws(() => validateAcknowledged([rest]), /不正/);
});
test("recheckOn の形が違えば例外", () => assert.throws(() => validateAcknowledged([{ ...good, recheckOn: "2027/01/01" }]), /不正/));
test("GHSA形式でない id は例外", () => assert.throws(() => validateAcknowledged([{ ...good, id: "CVE-2025-0001" }]), /不正/));
test("同じ id の重複は例外", () => assert.throws(() => validateAcknowledged([good, good]), /2回/));
test("正しい行は通る", () => assert.doesNotThrow(() => validateAcknowledged([good])));
test("本物の ACKNOWLEDGED が検証を通る（空でもよい）", () => {
  assert.doesNotThrow(() => validateAcknowledged(ACKNOWLEDGED));
  assert.ok(Array.isArray(ACKNOWLEDGED));
});
test("テスト用の確認済みの行も検証を通る", () => assert.doesNotThrow(() => validateAcknowledged([KNOWN])));

console.log(failed ? `\n${failed}件失敗` : "\n全件OK");
// process.exit() は使わない（Windowsで出力が切れる。scripts/check.ts 末尾の注記）
if (failed) process.exitCode = 1;
