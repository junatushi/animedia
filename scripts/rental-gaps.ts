// 「見放題ではなく課金」の配信先が、作品ページで見放題と同じ枠に並んでいないかを
// 公式サイトの配信情報と突き合わせ、GitHub Issueの本文（Markdown）を標準出力に出す
// （2026-10-10導入）。対応が要るものが0件なら**何も出さない**（ワークフローはそれを見て
// Issueを閉じる）。判定は scripts/lib/rental-scan.js が持つ（なぜ要るかもそちら）。
//
// 使い方:
//   node scripts/rental-gaps.ts                 # 今期と次期
//   node scripts/rental-gaps.ts 2026 autumn     # 指定のクールだけ
// 環境変数（テスト用。運用では未設定）:
//   RENTAL_GAPS_SITE   … 作品一覧を取るサイトの origin（既定は lib/siteUrl.ts）
//   RENTAL_GAPS_TODAY  … JSTの基準日 "YYYY-MM-DD"
//   RENTAL_GAPS_ORIGIN … 公式サイトの取得先の origin だけを差し替える（スタブ用。
//                        どのパスを取るかの判断は本番と同じ経路を通る）
//
// 【Vercelの無料枠に触れないこと】作品一覧は公開API /api/season をクールごとに1回だけ取る
// （エッジキャッシュ s-maxage=600 に乗る）。公式サイトの取得はGitHub Actions上で行い、
// Vercelの関数は1回も起動しない。結果はIssueに出すだけでコミットしない＝デプロイも起きない。

import { createRequire } from "node:module";
import { classifyChannel } from "../lib/services.ts";
import { siteUrl } from "../lib/siteUrl.ts";
import { RENTAL_SERVICES } from "../content/works/rentalServices.ts";

const require = createRequire(import.meta.url);
const S = require("./lib/rental-scan.js");
const { currentAndNextSeason } = require("./lib/coverage-gaps.js");
const { ACKNOWLEDGED, validateAcknowledged } = require("./lib/rental-acknowledged.js");
validateAcknowledged(ACKNOWLEDGED);

const UA = "animedia-rental-gaps (+https://github.com/junatushi/animedia)";
const TIMEOUT_MS = 15000;
const CONCURRENCY = 4;
const MAX_HTML = 2_000_000;

const today = process.env.RENTAL_GAPS_TODAY || new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const site = (process.env.RENTAL_GAPS_SITE || siteUrl).replace(/\/$/, "");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const seasons: string[] = args.length >= 2 ? [`${args[0]}-${args[1]}`] : currentAndNextSeason(today);

function classify(name: string): string | null {
  const c = classifyChannel(name);
  return c.kind === "service" ? c.def.key : null;
}

function redirectOrigin(url: string): string {
  const o = process.env.RENTAL_GAPS_ORIGIN;
  if (!o) return url;
  const u = new URL(url);
  return o.replace(/\/$/, "") + u.pathname + u.search;
}

async function getText(url: string): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(redirectOrigin(url), { headers: { "User-Agent": UA }, signal: ctl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (type && !/html|text/i.test(type)) throw new Error(`HTMLではない（${type}）`);
    const text = await res.text();
    // Cloudflareの確認画面は200で返ることがある。中身の無いページを「課金の区画なし」と
    // 読まないよう、読めなかったものとして扱う（薬屋のひとりごと 第3期で実際に返った）。
    if (/<title>\s*Just a moment|challenge-platform|cf-chl-/i.test(text)) throw new Error("Cloudflareの確認画面");
    return text.length > MAX_HTML ? text.slice(0, MAX_HTML) : text;
  } finally {
    clearTimeout(t);
  }
}

// 一覧の取得失敗は「0件」ではなく失敗として落とす（全作品が「問題なし」に見えるのを防ぐ）。
async function fetchSeason(season: string) {
  const [y, s] = season.split("-");
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${site}/api/season?year=${y}&season=${s}`, { headers: { "User-Agent": UA } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      const json = (await res.json()) as { items?: unknown[] };
      if (!Array.isArray(json.items)) throw Object.assign(new Error("items が無い応答"), { fatal: true });
      return json.items as {
        id: number;
        title: string;
        officialSiteUrl: string | null;
        services: { key: string }[];
      }[];
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw new Error(`/api/season（${season}）を取れませんでした: ${(lastErr as Error)?.message}`);
}

async function scanWork(w: { id: number; title: string; officialSiteUrl: string | null; services: string[] }) {
  if (!w.officialSiteUrl || !/^https?:\/\//.test(w.officialSiteUrl)) {
    return { kind: "unread", work: w, reason: "公式サイトのURLが無い" };
  }
  try {
    const top = await getText(w.officialSiteUrl);
    const lines: (string | null)[] = [...S.htmlToLines(top), null];
    for (const u of S.findStreamingPages(top, w.officialSiteUrl)) {
      try {
        lines.push(...S.htmlToLines(await getText(u)), null);
      } catch {
        // 下層ページの1枚が取れなくても、取れた分で判定する。
      }
    }
    return S.judgeWork(w, S.classifySections(lines, classify), RENTAL_SERVICES[w.id]);
  } catch (e) {
    return { kind: "unread", work: w, reason: (e as Error).name === "AbortError" ? "時間切れ" : (e as Error).message };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

const works: { id: number; title: string; officialSiteUrl: string | null; services: string[] }[] = [];
for (const season of seasons) {
  for (const it of await fetchSeason(season)) {
    // 配信サービスが2社未満の作品は「同じ枠に混ざる」ことが起きない（1社だけなら区別する相手が無い）。
    const services = (it.services || []).map((s) => s.key);
    if (services.length < 2 && !RENTAL_SERVICES[it.id]) continue;
    if (works.some((w) => w.id === it.id)) continue;
    works.push({ id: it.id, title: it.title, officialSiteUrl: it.officialSiteUrl, services });
  }
}

const results = await pool(works, CONCURRENCY, scanWork);
// 確認済みの除外（期日まで）。期日が過ぎたら前回の理由つきで候補に戻す。
const ackFor = (id: number) => (ACKNOWLEDGED as { id: number; reason: string; recheckOn: string }[]).find((a) => a.id === id);
const gaps = results
  .filter((r) => r.kind === "gap" && !(ackFor(r.work.id) && today < ackFor(r.work.id)!.recheckOn))
  .map((r) => (ackFor(r.work.id) ? { ...r, ackReason: ackFor(r.work.id)!.reason } : r));
const unread = results.filter((r) => r.kind === "unread");
// --json … 全作品の判定をそのまま出す（Issueに出ない「問題なし」の中身を人が点検するため）。
if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify(results, null, 1) + "\n");
  process.exit(0);
}
const body = S.renderIssue({ gaps, unread, scanned: works.length, seasons, today });
if (body) process.stdout.write(body + "\n");
console.error(
  `確認 ${works.length}作品（${seasons.join("／")}）: 要対応 ${gaps.length}・課金の区画あり問題なし ${
    results.filter((r) => r.kind === "ok-pay").length
  }・読めず ${unread.length}`
);
