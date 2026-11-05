#!/usr/bin/env node
"use strict";
// scripts/verify-extra-services.ts の回帰テスト（2026-10-04導入）。
// スタブのHTTPサーバーを出典に見立てて検証スクリプトを実際に動かし、
// **通してはいけないものを通さない**ことを固定する。この検査は自動マージの門番なので、
// 「何でも合格にする」方向に壊れると、誤った配信先が人の目を通らずに本番へ出る。
// ネットワークには出ない（127.0.0.1 だけ）。

const assert = require("node:assert");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const ok = (name, note) => console.log(`  ✓ ${name}${note ? `（${note}）` : ""}`);
const TODAY = "2026-10-04";
const dir = mkdtempSync(join(tmpdir(), "verify-extra-check-"));

// Shift_JIS の符号化（Nodeは復号しか持たないので、2バイト符号を総当たりで復号して逆引き表を作る）
function toShiftJis(str) {
  const dec = new TextDecoder("shift_jis");
  const table = new Map();
  for (let hi = 0x81; hi <= 0xfc; hi++) {
    if (hi > 0x9f && hi < 0xe0) continue;
    for (let lo = 0x40; lo <= 0xfc; lo++) {
      const ch = dec.decode(Uint8Array.of(hi, lo));
      if (ch.length === 1 && !table.has(ch)) table.set(ch, [hi, lo]);
    }
  }
  const bytes = [];
  for (const ch of str) {
    if (ch.charCodeAt(0) < 0x80) bytes.push(ch.charCodeAt(0));
    else bytes.push(...table.get(ch));
  }
  return Buffer.from(bytes);
}

// 出典に見立てたページ
const far = "あ".repeat(3000);
let flaky = 0;
const PAGES = {
  "/good": "<html><body><h1>テスト作品A 第2期</h1><p>配信情報 10月5日(日)より dアニメストア・Prime Video にて配信</p></body></html>",
  "/other-season": "<html><body><h1>テスト作品A</h1><p>第1期 配信情報 dアニメストア にて配信</p></body></html>",
  "/far": `<html><body><h1>テスト作品A 第2期</h1>${far}<p>U-NEXTにて独占配信</p></body></html>`,
  "/script-only": "<html><head><script>var s='テスト作品A 第2期 dアニメストアにて配信';</script></head><body>準備中</body></html>",
};
const server = http.createServer((req, res) => {
  if (req.url === "/flaky") {
    flaky++;
    if (flaky === 1) {
      res.writeHead(503);
      return res.end("busy");
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(PAGES["/good"]);
  }
  if (req.url === "/sjis") {
    // 「テスト作品A 第2期 ABEMAにて配信」を Shift_JIS で返す（TextDecoder が読めるか）
    const sjis = toShiftJis("<html><body>テスト作品A 第2期 ABEMAにて配信</body></html>");
    res.writeHead(200, { "content-type": "text/html; charset=Shift_JIS" });
    return res.end(sjis);
  }
  const page = PAGES[req.url];
  if (!page) {
    res.writeHead(404);
    return res.end("not found");
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
});

const store = {
  sources: {
    annict: {
      "2026-autumn": {
        works: {
          100: { title: "テスト作品A 第2期", services: {} },
          101: { title: "Annictに配信がある作品", services: { d_anime: { firstSeen: "2026-09-01" } } },
        },
      },
      "2027-winter": { works: {} },
    },
  },
};
const storePath = join(dir, "first-seen.json");
writeFileSync(storePath, JSON.stringify(store));

const BASE_EXTRA = { 200: [{ key: "netflix", sourceUrl: "https://example.org/x", confirmedDate: "2026-10-01" }] };
const ACK_OK = { id: "300", title: "延期作", reason: "放送延期（https://example.org/news）", recheckOn: "2026-11-01" };

function writeExtra(name, obj) {
  const p = join(dir, `${name}.ts`);
  writeFileSync(p, `export const EXTRA_SERVICES = ${JSON.stringify(obj)};\n`);
  return p;
}
function writeAck(name, list) {
  const p = join(dir, `${name}.js`);
  writeFileSync(p, `module.exports = { ACKNOWLEDGED: ${JSON.stringify(list)} };\n`);
  return p;
}
const entry = (path, extra = {}) => ({
  key: "d_anime",
  sourceUrl: `https://official.example.jp${path}`,
  confirmedDate: TODAY,
  evidence: "10月5日(日)より dアニメストア・Prime Video にて配信",
  ...extra,
});

function run(headExtra, { baseAck = [], headAck = baseAck } = {}) {
  const env = {
    ...process.env,
    VERIFY_EXTRA_BASE: writeExtra(`base-${Math.random()}`, BASE_EXTRA),
    VERIFY_EXTRA_HEAD: writeExtra(`head-${Math.random()}`, headExtra),
    VERIFY_ACK_BASE: writeAck(`base-ack-${Math.random()}`, baseAck),
    VERIFY_ACK_HEAD: writeAck(`head-ack-${Math.random()}`, headAck),
    COVERAGE_GAPS_STORE: storePath,
    VERIFY_TODAY: TODAY,
    VERIFY_FETCH_ORIGIN: `http://127.0.0.1:${server.address().port}`,
  };
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--no-warnings", join(__dirname, "verify-extra-services.ts")], { env });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}
const withAdded = (workId, e) => ({ ...BASE_EXTRA, [workId]: [e] });


// ───── データのリテラルだけの変更か（scripts/lib/data-literal-guard.js・2026-11-05導入） ─────
// この門番が「何でも通す」方向に壊れると、PRのコードが検証の中で動く（process.exit(0)で合格を偽装）／
// 本番のサーバーコードに混ざる。通してはいけない形を1つずつ固定する。
async function guardTests() {
  const { checkDataOnlyChange } = require("./lib/data-literal-guard.js");
  const { readFileSync } = require("node:fs");
  const { execFileSync } = require("node:child_process");
  const root = join(__dirname, "..");
  const EX_MARK = "export const EXTRA_SERVICES: Record<number, ExtraServiceEntry[]> = ";
  const AK_MARK = "const ACKNOWLEDGED = ";
  // 改行はLFに揃えてから使う。Windowsのチェックアウトは CRLF になり（core.autocrlf）、下の
  // 置き換え（"\n" を含む）が黙って空振りして「通さない」はずの検査が同じ文字列どうしの比較になる
  // （2026-11-05、CIのWindowsで実際に落ちた）。本番の門番は `git show` の中身＝LFを読む。
  const lf = (s) => s.replace(/\r\n/g, "\n");
  const exText = lf(readFileSync(join(root, "content/works/extraServices.ts"), "utf8"));
  const akText = lf(readFileSync(join(root, "scripts/lib/coverage-acknowledged.js"), "utf8"));
  const NEW_EX = `  99999: [\n    { key: "youtube", sourceUrl: "https://example.org/a", confirmedDate: "2026-11-05", evidence: "配信 }] 情報" },\n  ],\n`;
  const exWith = (ins) => exText.replace("  18160: [", ins + "  18160: [");
  const check = (base, head, marker) => checkDataOnlyChange({ base, head, marker });
  const rejects = (name, r, re) => {
    assert.strictEqual(r.ok, false, `${name}: 通ってしまった`);
    if (re) assert.match(r.errors.join("\n"), re, `${name}: ${r.errors.join(" / ")}`);
    ok(name, r.errors[0]);
  };

  console.log("\n── データのみの変更か（通すもの） ──");
  let r = check(exText, exText, EX_MARK);
  assert.strictEqual(r.ok, true, r.errors.join("\n"));
  ok("実際の extraServices.ts は自分自身と比べて通る", "main の版がデータだけで書かれている（2026-11-05に `.map()` を撤去）");
  r = check(exText, exWith(NEW_EX), EX_MARK);
  assert.strictEqual(r.ok, true, r.errors.join("\n"));
  ok("extraServices.ts にデータの行を1件足しても通る", "文字列の中の `}]` に惑わされない");
  r = check(exText, exWith(`  // コメントの中の }] や ( ) も気にしない /* \n  99998: [],\n`), EX_MARK);
  assert.strictEqual(r.ok, true, r.errors.join("\n"));
  ok("コメントの中の `}]` や `(` は無視する");
  const ak2 = akText.replace("  {\n    id: \"16806\"", `  { id: '1', title: "t", reason: "a'b }] c", recheckOn: "2026-12-01", n: -1.5, f: false, z: null },\n  {\n    id: "16806"`);
  assert.notStrictEqual(ak2, akText);
  r = check(akText, ak2, AK_MARK);
  assert.strictEqual(r.ok, true, r.errors.join("\n"));
  ok("coverage-acknowledged.js に除外を1件足しても通る", "単一引用符・負の小数・true/false/null・文字列中の `}]`");
  r = check(akText, akText, AK_MARK);
  assert.strictEqual(r.ok, true);

  console.log("\n── データのみの変更か（通さないもの） ──");
  rejects("値に process.exit(0) を入れたら通さない", check(exText, exWith("  99999: process.exit(0),\n"), EX_MARK), /process|許可されていない/);
  rejects("リテラルの後ろにコードを足したら通さない", check(exText, exText + "\nprocess.exit(0);\n", EX_MARK), /後ろの部分が変更/);
  rejects("import を足したら通さない", check(exText, 'import fs from "node:fs";\n' + exText, EX_MARK), /前の部分が変更/);
  rejects("リテラルを早く閉じて後ろへコードを続けても通さない", check(akText, akText.replace('recheckOn: "2026-12-28",\n  },', 'recheckOn: "2026-12-28",\n  }];\nrequire("fs");\n[{'), AK_MARK), /./);
  rejects("テンプレートリテラルは通さない", check(akText, akText.replace('title: "ジャンケットバンク"', "title: `x${process.exit(0)}`"), AK_MARK), /バッククォート/);
  rejects("スプレッド ... は通さない", check(akText, akText.replace("const ACKNOWLEDGED = [", "const ACKNOWLEDGED = [\n  ...evil,"), AK_MARK), /許可されていない文字 `\.`/);
  rejects("関数呼び出しは通さない", check(akText, akText.replace('title: "ジャンケットバンク"', 'title: f("x")'), AK_MARK), /識別子|`\(`/);
  rejects("即時実行関数 (()=>{})() は通さない", check(akText, akText.replace("const ACKNOWLEDGED = [", "const ACKNOWLEDGED = [\n  (() => { process.exit(0); })(),"), AK_MARK), /`\(`/);
  rejects("キー __proto__ は通さない", check(akText, akText.replace("const ACKNOWLEDGED = [", 'const ACKNOWLEDGED = [\n  { __proto__: { x: 1 } },'), AK_MARK), /__proto__/);
  rejects("文字列キー \"constructor\" は通さない", check(akText, akText.replace("const ACKNOWLEDGED = [", 'const ACKNOWLEDGED = [\n  { "constructor": 1 },'), AK_MARK), /constructor/);
  rejects("エスケープで綴った \"__pro\\u0074o__\" も通さない", check(akText, akText.replace("const ACKNOWLEDGED = [", 'const ACKNOWLEDGED = [\n  { "__pro\\u0074o__": 1 },'), AK_MARK), /__proto__/);
  rejects("値の位置の識別子は通さない", check(akText, akText.replace('title: "ジャンケットバンク"', "title: evil"), AK_MARK), /識別子 `evil`/);
  rejects("代入・演算子は通さない", check(akText, akText.replace('title: "ジャンケットバンク"', 'title: "a" + "b"'), AK_MARK), /許可されていない文字 `\+`/);
  rejects("正規表現リテラルは通さない", check(akText, akText.replace('title: "ジャンケットバンク"', "title: /x/"), AK_MARK), /許可されていない文字 `\/`/);
  rejects("閉じていない文字列は通さない", check(akText, akText.replace('title: "ジャンケットバンク"', 'title: "abc'), AK_MARK), /閉じていない文字列|括弧が閉じていません/);
  rejects("文字列の中の改行は通さない", check(akText, akText.replace('title: "ジャンケットバンク"', 'title: "a\nb"'), AK_MARK), /閉じていない文字列/);
  rejects("16進・指数の数値は通さない", check(akText, akText.replace('id: "17228"', "id: 0x10"), AK_MARK), /数値リテラル/);
  rejects("行コメントを U+2028 で抜けるコードは通さない", check(akText, akText.replace("const ACKNOWLEDGED = [", "const ACKNOWLEDGED = [\n  // x process.exit(0)\n"), AK_MARK), /U\+2028/);
  rejects("validateAcknowledged の本体を書き換えたら通さない", check(akText, akText.replace("function validateAcknowledged(list) {", "function validateAcknowledged(list) {\n  return list;"), AK_MARK), /後ろの部分が変更/);
  rejects("データに .map(...) の呼び出しを足したら通さない", check(exText, exWith("  99999: [1].map((k) => k),\n"), EX_MARK), /./);
  {
    // main 側にコードが混ざっていたら、比べる土台が無いので自動では通さない（人の確認へ）。
    const tainted = exWith("  99998: [\"a\"].map((key) => ({ key })),\n");
    rejects("変更前（main）にコードがあれば自動では通さない", check(tainted, tainted, EX_MARK), /変更前（main）の版のリテラルにデータ以外の字句/);
  }
  rejects("マーカーが無ければ通さない", check(exText, exText.replace("EXTRA_SERVICES", "OTHER"), EX_MARK), /見つかりません/);
  rejects("最上位の種類が変わったら通さない", check(akText, akText.replace("const ACKNOWLEDGED = [", "const ACKNOWLEDGED = {").replace(/\n\];\n\n\/\*\* 期日/, "\n};\n\n/** 期日"), AK_MARK), /./);

  console.log("\n── check-data-only-pr.js をgitの一時リポジトリで実際に動かす ──");
  const repo = mkdtempSync(join(tmpdir(), "data-only-pr-"));
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  const put = (rel, text) => {
    const full = join(repo, rel);
    require("node:fs").mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  };
  git("init", "-q");
  git("config", "user.email", "t@example.org");
  git("config", "user.name", "t");
  put("content/works/extraServices.ts", exText);
  put("scripts/lib/coverage-acknowledged.js", akText);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const baseSha = git("rev-parse", "HEAD");
  const cli = (a, b) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [join(__dirname, "check-data-only-pr.js"), "--base", a, "--head", b], { cwd: repo });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      p.on("close", (code) => resolve({ code, out }));
    });
  let c = await cli(baseSha, baseSha);
  assert.strictEqual(c.code, 0, c.out);
  ok("変更が無ければ終了コード0");

  put("content/works/extraServices.ts", exWith(NEW_EX));
  git("commit", "-q", "-am", "data");
  const dataSha = git("rev-parse", "HEAD");
  c = await cli(baseSha, dataSha);
  assert.strictEqual(c.code, 0, c.out);
  assert.match(c.out, /データのリテラルだけの変更/);
  ok("データだけの変更は終了コード0", "Markdownで報告する");

  put("content/works/extraServices.ts", exWith("  99999: process.exit(0),\n"));
  git("commit", "-q", "-am", "code in literal");
  c = await cli(baseSha, git("rev-parse", "HEAD"));
  assert.strictEqual(c.code, 1, c.out);
  assert.match(c.out, /✗ `content\/works\/extraServices\.ts`/);
  ok("リテラルの中のコードは終了コード1");

  put("content/works/extraServices.ts", exWith(NEW_EX));
  put("scripts/lib/coverage-acknowledged.js", akText.replace("function validateAcknowledged(list) {", "function validateAcknowledged(list) {\n  return list;"));
  git("commit", "-q", "-am", "code outside literal");
  c = await cli(baseSha, git("rev-parse", "HEAD"));
  assert.strictEqual(c.code, 1, c.out);
  assert.match(c.out, /coverage-acknowledged\.js/);
  ok("リテラルの外のコードの変更は終了コード1");

  c = await cli(baseSha, "no-such-ref");
  assert.strictEqual(c.code, 1, c.out);
  ok("解決できない参照は静かに通さず終了コード1");
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    console.log("── 通すもの ──");
    let r = await run(withAdded(100, entry("/good")));
    assert.strictEqual(r.code, 0, r.out + r.err);
    assert.match(r.out, /✓ \*\*#100 テスト作品A 第2期 → dアニメストア/);
    ok("抜き書きが実在し、サービス名を含み、近くに作品名の全文がある");

    r = await run({ ...BASE_EXTRA, 100: [entry("/good"), entry("/good", { key: "prime" })] });
    assert.strictEqual(r.code, 0, r.out + r.err);
    ok("同じ抜き書きで複数のサービス", "同じページは1回だけ取る");

    r = await run(withAdded(100, entry("/flaky")));
    assert.strictEqual(r.code, 0, r.out + r.err);
    ok("一時的な失敗（503）は再試行する");

    r = await run(withAdded(100, entry("/sjis", { key: "abema", evidence: "ABEMAにて配信" })));
    assert.strictEqual(r.code, 0, r.out + r.err);
    ok("Shift_JISのページも読める");

    r = await run(BASE_EXTRA, { baseAck: [], headAck: [ACK_OK] });
    assert.strictEqual(r.code, 0, r.out + r.err);
    ok("確認済みの除外: 出典URLと62日以内の期日があれば通す");

    console.log("\n── 通さないもの ──");
    const rejects = [
      ["別シーズンの配信欄（作品名の全文がページに無い）", entry("/other-season", { evidence: "第1期 配信情報 dアニメストア にて配信" }), /作品名の全文/],
      ["作品名と抜き書きが離れすぎている", entry("/far", { key: "unext", evidence: "U-NEXTにて独占配信" }), /離れすぎ/],
      ["抜き書きがページに無い（写し間違い・創作）", entry("/good", { evidence: "dアニメストアにて独占配信決定" }), /見つからない/],
      ["抜き書きにサービス名が無い", entry("/good", { key: "netflix" }), /Netflix」の名前が無い/],
      ["scriptの中にしか無い文字列", entry("/script-only", { evidence: "dアニメストアにて配信" }), /見つからない|作品名の全文/],
      ["出典が取れない（404）", entry("/missing"), /取得できなかった/],
      ["出典がX", entry("/good", { sourceUrl: "https://x.com/foo/status/1" }), /x\.com/],
      ["出典がhttp", entry("/good", { sourceUrl: "http://official.example.jp/good" }), /https/],
      ["曜日・時刻つき", entry("/good", { schedule: { weekday: 0, time: "23:00", startDate: "2026-10-05" } }), /schedule/],
      ["抜き書きが無い", entry("/good", { evidence: undefined }), /evidence/],
      ["確認日が古い", entry("/good", { confirmedDate: "2026-09-01" }), /confirmedDate/],
    ];
    for (const [name, e, re] of rejects) {
      r = await run(withAdded(100, e));
      assert.strictEqual(r.code, 1, `${name}: ${r.out}${r.err}`);
      assert.match(r.out, re, name);
      ok(name);
    }

    r = await run(withAdded(101, entry("/good")));
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /既にある作品/);
    ok("Annictに配信先が既にある作品は触らない");

    r = await run(withAdded(999, entry("/good")));
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /今期・次期の作品として記録されていない/);
    ok("今期・次期に無い作品は触らない");

    r = await run({});
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /既存の行の削除・書き換え/);
    ok("既存の行を消すPRは通さない");

    r = await run({ 200: [{ ...BASE_EXTRA[200][0], sourceUrl: "https://example.org/y" }] });
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /既存の行の削除・書き換え/);
    ok("既存の行を書き換えるPRは通さない");

    r = await run({ ...BASE_EXTRA, 100: [entry("/good"), entry("/good", { key: "netflix" })] });
    assert.strictEqual(r.code, 1);
    ok("1件でも不合格なら全体を通さない");

    r = await run(BASE_EXTRA, { headAck: [{ ...ACK_OK, reason: "放送延期" }] });
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /出典URLが無い/);
    ok("確認済みの除外: 出典URLの無い理由は通さない");

    r = await run(BASE_EXTRA, { headAck: [{ ...ACK_OK, recheckOn: "2027-06-01" }] });
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /62日以内/);
    ok("確認済みの除外: 期日が遠すぎるものは通さない", "長く隠すと欠損を見落とす");

    console.log("\n── 確かめるものが無い ──");
    r = await run(BASE_EXTRA);
    assert.strictEqual(r.code, 3, r.out + r.err);
    ok("差分が無ければ終了コード3", "合格（0）と区別する＝空のPRを自動マージしない");

    await guardTests();

    console.log("\n全件OK");
  } finally {
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
