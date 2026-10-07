// 配信先の自動補完を、マージ前に機械で裏取りする（2026-10-04導入）。
// 判定は scripts/lib/verify-extra-services.js が持つ（なぜ要るか・何を確かめるかもそちら）。
// ここは「比べる2つの版を読む → 出典ページを取り直す → 判定 → 報告」だけ。
//
// 使い方:
//   node scripts/verify-extra-services.ts            # origin/main と作業ツリーを比べる
//   node scripts/verify-extra-services.ts --base <ref>
// 終了コード:
//   0 … 追加・変更が1件以上あり、全部合格（自動マージしてよい）
//   1 … 1件でも不合格（自動マージしない。人が見る）
//   3 … 確かめるものが無い（追加も変更も無い）
// 標準出力はMarkdownの報告（PRのコメントにそのまま貼る）。
//
// 環境変数（テスト用。運用では未設定）:
//   VERIFY_EXTRA_BASE / VERIFY_EXTRA_HEAD … extraServices.ts の前後の版のファイル
//   VERIFY_ACK_BASE / VERIFY_ACK_HEAD     … coverage-acknowledged.js の前後の版のファイル
//   COVERAGE_GAPS_STORE                   … first-seen.json の場所
//   VERIFY_TODAY                          … JSTの基準日 "YYYY-MM-DD"
//   VERIFY_FETCH_ORIGIN                   … 出典の取得先の origin だけを差し替える（スタブ用）。
//                                           出典URLそのもの（httpsか・どこか）の判定は本番と同じ経路を通る。

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { SERVICES } from "../lib/services.ts";

const require = createRequire(import.meta.url);
const V = require("./lib/verify-extra-services.js");
const { currentAndNextSeason } = require("./lib/coverage-gaps.js");
const { validateAcknowledged } = require("./lib/coverage-acknowledged.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTRA_PATH = "content/works/extraServices.ts";
const ACK_PATH = "scripts/lib/coverage-acknowledged.js";

const argBase = process.argv.indexOf("--base");
const baseRef = argBase > 0 ? process.argv[argBase + 1] : "origin/main";
const today = process.env.VERIFY_TODAY || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const work = mkdtempSync(join(tmpdir(), "verify-extra-"));

/** 指定の版のファイルを一時ディレクトリへ書き出して、そのパスを返す。 */
function fileAt(envName: string, repoPath: string, ref: string | null, name: string): string {
  if (process.env[envName]) return resolve(process.env[envName] as string);
  const out = join(work, name);
  if (ref === null) copyFileSync(join(ROOT, repoPath), out);
  else {
    try {
      writeFileSync(out, execFileSync("git", ["show", `${ref}:${repoPath}`], { cwd: ROOT, maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] }));
    } catch (e) {
      // 比較元にまだファイルが無い（このファイルを足したPRそのもの）ときだけ「空」とみなす。
      // ref自体が無いなどの失敗まで空にすると、全行が「追加」に見えてしまうので落とす。
      if (!/exists on disk, but not in|does not exist in/.test(String((e as { stderr?: Buffer }).stderr ?? ""))) throw e;
      writeFileSync(out, repoPath.endsWith(".ts") ? "export const EXTRA_SERVICES = {};\n" : "module.exports = { ACKNOWLEDGED: [] };\n");
    }
  }
  return out;
}

async function loadExtra(path: string) {
  const m = await import(pathToFileURL(path).href + `?t=${Date.now()}`);
  return m.EXTRA_SERVICES as Record<string, Array<Record<string, unknown> & { key: string; sourceUrl: string }>>;
}
function loadAck(path: string) {
  const m = require(path);
  return validateAcknowledged(m.ACKNOWLEDGED) as Array<{ id: string; title?: string; reason: string; recheckOn: string }>;
}

/** 出典ページを取り直す。一時的な失敗（429・5xx・通信断）だけ再試行する。文字コードはヘッダーとmetaから決める。 */
async function fetchText(url: string): Promise<{ text: string | null; note: string }> {
  let target = url;
  if (process.env.VERIFY_FETCH_ORIGIN) {
    const u = new URL(url);
    target = process.env.VERIFY_FETCH_ORIGIN + u.pathname + u.search;
  }
  const waits = [2000, 6000];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(target, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; animedia-verify/1.0; +https://animedia-khaki.vercel.app/about)", "accept-language": "ja" },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < waits.length) {
        await new Promise((r) => setTimeout(r, waits[attempt]));
        continue;
      }
      if (!res.ok) return { text: null, note: `HTTP ${res.status}` };
      const buf = Buffer.from(await res.arrayBuffer());
      const head = buf.subarray(0, 4096).toString("latin1");
      const cs = (/charset=["']?([\w-]+)/i.exec(res.headers.get("content-type") || "")?.[1] ||
        /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ||
        "utf-8").toLowerCase();
      let html: string;
      try {
        html = new TextDecoder(cs).decode(buf);
      } catch {
        html = new TextDecoder("utf-8").decode(buf);
      }
      return { text: V.htmlToText(html), note: `HTTP ${res.status}` };
    } catch (e) {
      if (attempt < waits.length) {
        await new Promise((r) => setTimeout(r, waits[attempt]));
        continue;
      }
      return { text: null, note: (e as Error).message };
    }
  }
}

const storePath = process.env.COVERAGE_GAPS_STORE || join(ROOT, "content", "coverage", "first-seen.json");
const store = JSON.parse(readFileSync(storePath, "utf8"));
const works = new Map<string, { title: string; services?: Record<string, unknown> }>();
for (const season of currentAndNextSeason(today)) {
  for (const [id, w] of Object.entries(store?.sources?.annict?.[season]?.works || {})) works.set(id, w as never);
}

const baseExtra = await loadExtra(fileAt("VERIFY_EXTRA_BASE", EXTRA_PATH, baseRef, "base-extra.ts"));
const headExtra = await loadExtra(fileAt("VERIFY_EXTRA_HEAD", EXTRA_PATH, null, "head-extra.ts"));
const baseAck = loadAck(fileAt("VERIFY_ACK_BASE", ACK_PATH, baseRef, "base-ack.js"));
const headAck = loadAck(fileAt("VERIFY_ACK_HEAD", ACK_PATH, null, "head-ack.js"));

const ex = V.diffExtraServices(baseExtra, headExtra);
const ak = V.diffAcknowledged(baseAck, headAck);
const lines: string[] = [];
let failed = 0;

for (const { workId, entry } of [...ex.removed, ...ex.changed]) {
  failed++;
  lines.push(`- ✗ **#${workId} ${entry.key}**: 既存の行の削除・書き換え（自動では通さない。人が確かめる）`);
}

const pages = new Map<string, Promise<{ text: string | null; note: string }>>();
for (const { workId, entry } of ex.added) {
  const w = works.get(workId) || null;
  const svc = SERVICES.find((s) => s.key === entry.key) || null;
  const urlProblems = V.checkSourceUrl(entry.sourceUrl);
  let page = { text: null as string | null, note: "取得していない（URLの時点で不合格）" };
  if (urlProblems.length === 0) {
    if (!pages.has(entry.sourceUrl)) pages.set(entry.sourceUrl, fetchText(entry.sourceUrl));
    page = await pages.get(entry.sourceUrl)!;
  }
  const problems = V.checkAddedEntry({ workId, entry, work: w, svc, pageText: page.text, today });
  const name = `#${workId} ${w?.title ?? "（今期・次期に無い作品）"} → ${svc?.name ?? entry.key}`;
  if (problems.length === 0) lines.push(`- ✓ **${name}**（${entry.sourceUrl}）`);
  else {
    failed++;
    lines.push(`- ✗ **${name}**（${entry.sourceUrl}・${page.note}）`);
    for (const p of problems) lines.push(`  - ${p}`);
  }
}

for (const a of [...ak.added, ...ak.changed]) {
  const problems = V.checkAck(a, today);
  const name = `確認済みの除外 #${a.id} ${a.title ?? ""}（期日 ${a.recheckOn}）`;
  if (problems.length === 0) lines.push(`- ✓ **${name}**: ${a.reason}`);
  else {
    failed++;
    lines.push(`- ✗ **${name}**: ${a.reason}`);
    for (const p of problems) lines.push(`  - ${p}`);
  }
}
for (const a of ak.removed) lines.push(`- ✓ 確認済みの除外を外した #${a.id}（一覧に戻るだけなので安全側）`);

const total = ex.added.length + ex.removed.length + ex.changed.length + ak.added.length + ak.changed.length + ak.removed.length;
if (total === 0) {
  console.log(`確かめるもの無し（${baseRef} との差分に配信先の追加・確認済みの除外の変更が無い）`);
  process.exit(3);
}
console.log(`### 配信先の自動補完の機械検証（${today}・比較元 ${baseRef}）`);
console.log("");
console.log(...[lines.join("\n")]);
console.log("");
console.log(
  failed === 0
    ? `**全${total}件合格。** 出典ページを取り直し、抜き書きの実在・サービス名・作品名の全文（近く）を確かめました。`
    : `**${failed}件が不合格。** 自動ではマージしません。不合格の行を直すか、人が出典を確かめてください。`
);
process.exit(failed === 0 ? 0 : 1);
