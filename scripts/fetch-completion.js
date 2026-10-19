#!/usr/bin/env node
"use strict";
// ───────────────────────────────────────────────────────────────
// 「完結」の明示的な印の取得（2026-10-19導入・重大度高）
//
// 【なぜ要るか】
// 画面の「完結」とX投稿の「今日の配信」の除外は、以前「Annictに登録された最後の放送枠が
// 過ぎたら完結」と推定していた。Annictは枠を「済んだ分＋数週先」しか登録しないので、
// 12話の作品が第4話の後に完結扱いになった（生徒会にも穴はある！ほか開始3〜4週目の7作品。
// 2026-10-18）。話数の下限・期間・停滞日数で縛る案は利用者に却下された
// （1〜2話完結の作品があり、7週間・21日待つのは遅すぎる）。
// そこで**完結したら表記が変わる情報源**の印だけを集める（推定はしない）。
//
// 【集める印】ロジックは scripts/lib/completion-signals.js
//   ① しょぼいカレンダーの最終回の「終」フラグ。作品の対応は Annict の syobocalTid
//      （サイトの公開API /api/season が返す）。放送前に付くことが多いので、
//      最終話の時刻ちょうどにサイトの表示が切り替わる（デプロイを待たない）。
//   ② dアニメストアの作品ページの「（全N話）」。dアニメが完結と判断した作品にだけ付く。
//      作品の対応は**そのクールのdアニメの一覧の中で、題名が完全一致するものだけ**。
//      一度見えたら記録を消さない（続編が同じ作品IDで始まると表記が消えるため）。
//   どちらも無い作品は書かない＝サイトは完結を出さない（「分からない」を「終わった」にしない）。
//   時刻をAnnictの配信に合わせる・矛盾したら捨てるのはサイト側（lib/completion.ts）。
//
// 【Vercelの無料枠】Vercelの関数は外へ出ない。ここ（GitHub Actions）が取って
// content/works/completion.json にコミットする。**中身が変わった日だけ**コミットする
// （＝デプロイが起きる）。最終回の枠は事前に入ることが多いので、完結の瞬間にデプロイは要らない。
// 呼ぶのは fetch-upcoming.yml（1日1回）で、予定日と同じコミットに載せる＝デプロイを増やさない。
//
// 【相手への配慮】
//   しょぼいカレンダー: https://docs.cal.syoboi.jp/spec/rate_limit/ ・ /rule/bot/
//     db.php を1秒1回未満・独自のUser-Agent・TIDはまとめて引く（1日10回前後）。
//     公式は自動取得を認めている（/about/）。robots.txt の Disallow /db は巡回ロボット向け。
//     「1週間以上先のデータは間違っている可能性が高い」（/about/）ので、未来の「終」は
//     毎回取り直して上書きする（記録を固定しない）。
//   dアニメストア: robots.txt が禁止していない作品ページ（/animestore/ci_pc）と一覧だけを
//     1件ずつ間を空けて読む。保存するのは作品ID・話数・時刻だけ（あらすじ・画像は持たない）。
//
// 使い方:
//   node scripts/fetch-completion.js                  … 今期と前期
//   node scripts/fetch-completion.js 2026-summer ...  … クールを明示
// 環境変数（テスト用。判断の分岐は変えない）:
//   COMPLETION_SITE_URL / COMPLETION_SYOBOI_URL / COMPLETION_DANIME_URL … 取得元
//   COMPLETION_OUT_PATH … 書き出し先 / COMPLETION_TODAY … JSTの基準日 "YYYY-MM-DD"
//   COMPLETION_NOW … 「初めて見た時刻」に使う現在時刻（ISO）
//   COMPLETION_RETRY_BASE_MS / COMPLETION_PACE_MS … 待ち時間
// ───────────────────────────────────────────────────────────────

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("node:fs");
const { join, dirname } = require("node:path");
const {
  parseSyoboiPrograms,
  syoboiFinal,
  danimeCandidates,
  parseDanimeEpisodes,
  danimeCours,
} = require("./lib/completion-signals.js");

const SITE_URL = process.env.COMPLETION_SITE_URL || "https://animedia-khaki.vercel.app";
const SYOBOI_URL = process.env.COMPLETION_SYOBOI_URL || "https://cal.syoboi.jp/db.php";
const DANIME_URL = process.env.COMPLETION_DANIME_URL || "https://animestore.docomo.ne.jp/animestore";
const OUT_PATH =
  process.env.COMPLETION_OUT_PATH || join(__dirname, "..", "content", "works", "completion.json");
const RETRY_BASE_MS = Number(process.env.COMPLETION_RETRY_BASE_MS || 3000);
const PACE_MS = Number(process.env.COMPLETION_PACE_MS || 1500);
const USER_AGENT = "animedia-completion (+https://animedia-khaki.vercel.app/about)";
const SYOBOI_BATCH = 20;
// dアニメの作品ページを1回の実行で読む上限（相手への配慮。超えた分は翌日に回し、黙らずに出す）。
const DANIME_PAGE_CAP = 200;

const SEASONS = ["winter", "spring", "summer", "autumn"];

function jstToday(now = new Date()) {
  if (process.env.COMPLETION_TODAY) return process.env.COMPLETION_TODAY;
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 今期と前期（2クール作品・dアニメの表記が遅れて付く作品のため前期も見る）。
function targetSeasons(today) {
  const [y, m] = today.split("-").map(Number);
  const idx = Math.floor((m - 1) / 3);
  const prev = idx === 0 ? `${y - 1}-autumn` : `${y}-${SEASONS[idx - 1]}`;
  return [prev, `${y}-${SEASONS[idx]}`];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function temporary(message) {
  const e = new Error(message);
  e.retryable = true;
  return e;
}

async function withRetry(label, fn, attempt = 0) {
  try {
    return await fn();
  } catch (e) {
    if (!e.retryable || attempt >= 3) throw e;
    const wait = RETRY_BASE_MS * 2 ** attempt;
    console.warn(`  ${label}: ${e.message} のため ${wait}ms 後に再試行します（${attempt + 1}/3）`);
    await sleep(wait);
    return withRetry(label, fn, attempt + 1);
  }
}

async function request(label, url) {
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  } catch (e) {
    throw temporary(`${label}: 接続できませんでした（${e.message}）`);
  }
  if (res.status === 429 || res.status >= 500) throw temporary(`${label}: HTTP ${res.status}`);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.text();
}

async function fetchSiteSeason(seasonStr) {
  const [year, season] = seasonStr.split("-");
  const label = `site/${seasonStr}`;
  const text = await withRetry(label, () =>
    request(label, `${SITE_URL}/api/season?year=${year}&season=${season}`)
  );
  const body = JSON.parse(text);
  if (!Array.isArray(body.items)) throw new Error(`${label}: items 配列が返りませんでした`);
  return body.items;
}

// TIDごとの番組。取れなかったバッチのTIDは Map に入らない（＝前回の記録を残す）。
async function fetchSyoboi(tids) {
  const byTid = new Map();
  let failed = 0;
  for (let i = 0; i < tids.length; i += SYOBOI_BATCH) {
    const batch = tids.slice(i, i + SYOBOI_BATCH);
    const label = `syoboi/${batch[0]}..`;
    try {
      const xml = await withRetry(label, () =>
        request(label, `${SYOBOI_URL}?Command=ProgLookup&TID=${batch.join(",")}`)
      );
      if (!/<ProgLookupResponse/.test(xml)) throw new Error(`${label}: 応答の形が違います`);
      for (const tid of batch) byTid.set(tid, []);
      for (const p of parseSyoboiPrograms(xml)) {
        if (byTid.has(p.tid)) byTid.get(p.tid).push(p);
      }
    } catch (e) {
      failed++;
      console.error(`  ${e.message}（このバッチの作品は前回の記録を残します）`);
    }
    await sleep(PACE_MS);
  }
  return { byTid, failed };
}

async function fetchDanimeList(seasonStr) {
  const cours = danimeCours(seasonStr);
  const label = `danime/list/${cours}`;
  const text = await withRetry(label, () =>
    request(
      label,
      `${DANIME_URL}/rest/WS000118?cours=${cours}&includeOthersFlag=1&tvProgramFlag=1&vodTypeList=svod_tvod`
    )
  );
  const body = JSON.parse(text);
  const list = body?.data?.workList;
  if (body?.resultCd !== "00" || !Array.isArray(list)) throw new Error(`${label}: 一覧が返りませんでした（resultCd=${body?.resultCd}）`);
  return list
    .filter((w) => w && /^\d+$/.test(String(w.workId)) && w.workInfo?.workTitle)
    .map((w) => ({
      workId: String(w.workId),
      title: w.workInfo.workTitle,
      latestPartPublicDate: w.workInfo.latestPartPublicDate || null,
    }));
}

// dアニメの latestPartPublicDate（"2026-10-17T15:30:00.0Z"）→ ISO。読めなければ null。
function danimeTimeToIso(s) {
  if (!s) return null;
  const ms = Date.parse(String(s));
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function loadStore() {
  if (!existsSync(OUT_PATH)) return { works: {} };
  try {
    const parsed = JSON.parse(readFileSync(OUT_PATH, "utf8"));
    return { works: parsed.works && typeof parsed.works === "object" ? parsed.works : {} };
  } catch (e) {
    // 壊れていたら上書きせずに落ちる（黙って作り直すと、取り返せない「初めて見た時刻」が消える）。
    throw new Error(`${OUT_PATH} を読めませんでした（${e.message}）。手で確認してください。`);
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => /^\d{4}-(winter|spring|summer|autumn)$/.test(a));
  const today = jstToday();
  const nowIso = process.env.COMPLETION_NOW || new Date().toISOString();
  const targets = args.length > 0 ? args : targetSeasons(today);
  console.log(`基準日（JST）: ${today}`);
  console.log(`対象クール: ${targets.join(", ")}`);

  const store = loadStore();
  const works = { ...store.works };
  let failures = 0;

  // ── サイトの作品（＝Annict）を集める ──
  const tracked = []; // { item, season }
  for (const season of targets) {
    try {
      for (const item of await fetchSiteSeason(season)) tracked.push({ item, season });
    } catch (e) {
      failures++;
      console.error(`  ${season}: サイトから取れませんでした: ${e.message}`);
    }
  }
  if (tracked.length === 0) {
    console.error("どのクールの作品も取れませんでした。ファイルは変更しません。");
    process.exitCode = 1;
    return;
  }

  // ── ① しょぼいカレンダー ──
  // 1つのTIDに複数のAnnict作品が紐付いていたら、どれにも使わない（Re:ゼロ 4th の喪失編と
  // 奪還編が同じTID＝前の作品は後の作品の最終回まで完結にならない／先に完結になる）。
  const tidOwners = new Map();
  for (const { item } of tracked) {
    const tid = Number(item.syobocalTid);
    if (!Number.isInteger(tid) || tid <= 0) continue;
    if (!tidOwners.has(tid)) tidOwners.set(tid, new Set());
    tidOwners.get(tid).add(String(item.id));
  }
  const usableTids = [...tidOwners.entries()].filter(([, ids]) => ids.size === 1).map(([tid]) => tid);
  const sharedTids = [...tidOwners.entries()].filter(([, ids]) => ids.size > 1);
  if (tidOwners.size === 0) {
    // サイトがまだ syobocalTid を返していない（このスクリプトより先にサイトのデプロイが要る）。
    console.warn("  しょぼいカレンダー: /api/season が syobocalTid を返していません（サイトのデプロイ待ち）。今回は見ません。");
  }
  for (const [tid, ids] of sharedTids) {
    console.log(`  しょぼいカレンダー: TID ${tid} を複数の作品が共有（${[...ids].join(", ")}）。使いません`);
  }
  const { byTid, failed: syoboiFailed } = await fetchSyoboi(usableTids);
  if (syoboiFailed > 0) failures++;

  let syoboiFinals = 0;
  const reasons = {};
  for (const { item, season } of tracked) {
    const id = String(item.id);
    const tid = Number(item.syobocalTid);
    const prev = works[id] || {};
    let syoboi = prev.syoboi;
    if (Number.isInteger(tid) && tidOwners.get(tid)?.size === 1 && byTid.has(tid)) {
      const { final, reason } = syoboiFinal(byTid.get(tid));
      syoboi = final ? { tid, finalCount: final.finalCount, finalAt: final.finalAt } : undefined;
      if (final) syoboiFinals++;
      else reasons[reason] = (reasons[reason] || 0) + 1;
    } else if (Number.isInteger(tid) && tidOwners.get(tid)?.size > 1) {
      syoboi = undefined; // 共有TIDになった＝以前の記録も信じない
    }
    // TIDが無い・取れなかった作品は前回の記録をそのまま残す。
    const next = { ...prev, title: item.title, season };
    if (syoboi) next.syoboi = syoboi;
    else delete next.syoboi;
    works[id] = next;
  }
  console.log(`  しょぼいカレンダー: 最終回の印 ${syoboiFinals}件 / ` +
    Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(" / "));

  // ── ② dアニメストア ──
  const lists = new Map();
  for (const season of targets) {
    try {
      lists.set(season, await fetchDanimeList(season));
    } catch (e) {
      failures++;
      console.error(`  ${e.message}（このクールのdアニメは今回は見ません）`);
    }
    await sleep(PACE_MS);
  }
  const pageCache = new Map(); // workId → 話数 | null
  let pagesRead = 0;
  let skippedByCap = 0;
  let danimeNew = 0;
  for (const { item, season } of tracked) {
    const id = String(item.id);
    if (works[id]?.danime) continue; // 一度見えた印は消さない（冒頭の②）
    if (item.broadcastStartDate && item.broadcastStartDate > today) continue; // まだ始まっていない
    const list = lists.get(season);
    if (!list) continue;
    const cands = danimeCandidates(item.title, list);
    if (cands.length === 0) continue;
    const episodes = [];
    for (const c of cands) {
      if (!pageCache.has(c.workId)) {
        if (pagesRead >= DANIME_PAGE_CAP) {
          skippedByCap++;
          break;
        }
        pagesRead++;
        try {
          const html = await withRetry(`danime/${c.workId}`, () =>
            request(`danime/${c.workId}`, `${DANIME_URL}/ci_pc?workId=${c.workId}`)
          );
          pageCache.set(c.workId, parseDanimeEpisodes(html));
        } catch (e) {
          failures++;
          console.error(`  ${e.message}`);
          pageCache.set(c.workId, undefined);
        }
        await sleep(PACE_MS);
      }
      episodes.push(pageCache.get(c.workId));
    }
    // 候補（【規制解除版】【TV放送版】など）が**全部**「（全N話）」を持つときだけ。
    if (episodes.length !== cands.length || !episodes.every((n) => typeof n === "number")) continue;
    const times = cands.map((c) => danimeTimeToIso(c.latestPartPublicDate)).filter(Boolean).sort();
    works[id] = {
      ...works[id],
      danime: {
        workIds: cands.map((c) => c.workId).sort(),
        episodes: Math.max(...episodes),
        finalAt: times[0] ?? null,
        seenAt: nowIso,
      },
    };
    danimeNew++;
  }
  console.log(`  dアニメストア: 作品ページ ${pagesRead}件を確認 / 新しく「全N話」 ${danimeNew}件`);
  if (skippedByCap > 0) {
    console.log(`  dアニメストア: 1回の上限（${DANIME_PAGE_CAP}件）を超えた ${skippedByCap}作品は次回に回しました`);
  }

  // 印が1つも無くなった作品は消す（題名だけ残さない）。
  // 前年より古いクールの作品も消す: サイトが completedAt を出すのは今年のクール（ライブ取得）だけで、
  // 過去年はスナップショットから描くので読まれない。消さないと1クール150件ずつ増え続ける。
  const oldestYear = Number(today.slice(0, 4)) - 1;
  for (const [id, w] of Object.entries(works)) {
    const year = Number(String(w.season || "").slice(0, 4));
    if ((!w.syoboi && !w.danime) || (year && year < oldestYear)) delete works[id];
  }

  const next = {
    updatedAt: today,
    source:
      "しょぼいカレンダー（https://cal.syoboi.jp）の最終回の「終」フラグ・dアニメストアの「（全N話）」 — " +
      "scripts/fetch-completion.js が生成。手で編集しない",
    works: Object.fromEntries(Object.entries(works).sort((a, b) => Number(a[0]) - Number(b[0]))),
  };
  const before = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, "utf8") : "";
  // updatedAt だけの差分ではコミットしない（デプロイが起きるので、中身が変わった日だけ）。
  const sameWorks = before !== "" && JSON.stringify(JSON.parse(before).works ?? {}) === JSON.stringify(next.works);
  if (sameWorks) {
    console.log(`変更なし（${Object.keys(next.works).length}件）。ファイルは更新しません。`);
  } else {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`${OUT_PATH} を更新しました（${Object.keys(next.works).length}件）`);
  }
  // 部分失敗でも取れた分は書いたうえで、失敗は終了コードで知らせる（Windowsで exit() は使わない）。
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
