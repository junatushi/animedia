#!/usr/bin/env node
"use strict";
// ───────────────────────────────────────────────────────────────
// クール別の「初出日」の記録（2026-08-12導入）
//
// 【なぜ要るか】
// 「作品名 ＋ ○年○月放送」という情報を、どの情報源が最初に持つのかが**どこにも
// 記録されていない**。`content/snapshots/` はクールが終わった後の最終状態しか持たず、
// `scripts/audit-coverage.ts` は実行した瞬間の値を標準出力に出すだけで消える。
// これは**後追いでは絶対に取れないデータ**（毎日の変化そのものが答えなので、記録を
// 始めた日より前には遡れない）なので、先に記録を始めるしかない。
//
// 【何を測るか】
//   ① 作品がそのクールの一覧に**初めて現れた日**（＝その情報源が「○年○月放送」を持った日）
//   ② その作品に配信サービスが**初めて現れた日**（サービスごと。Annict側のみ）
//   ③ 日ごとの総数＝クール前後の埋まり方の推移
// これを **Annict（＝いまのサイトのデータ源）と AniList の2つで並べて記録する**。
// 同じクールの同じ作品について、どちらが先に載せたかが日数で出る。
//
// 【なぜAniListを並べるか・2026-08-12調査】
// AniListは2026-08-12時点で**2027年冬クール（約5ヶ月先）の作品を既に持っている**ことが
// 確認できた。`season`/`seasonYear`/`status: NOT_YET_RELEASED` という構造化フィールドを
// 持ち、公式GraphQLが無料・APIキー不要。一方でAnnict側が未放送作品をどれだけ早く
// 登録するかは実測も評判も見つからなかった。**どちらが速いかは推測できないので測る。**
//
// 【AniListの利用規約について（重要）】
// AniListの規約はデータの大量収集・退蔵（mass collection / hoarding）を禁じており、
// 月$150超の商用利用は別途ライセンスが要る。ここでやるのは
// **1クールにつき1日1回の問い合わせ**で、保存するのも作品ID・タイトル・初出日だけ
// （＝データベースの複製ではなく計測の記録）。この線を越えないこと。
// 取得間隔を短くしたり、あらすじ・画像などの本文データを溜め込む方向に広げない。
// 規約: https://docs.anilist.co/guide/terms-of-use / レート制限: 90req/分
//
// 【なぜ ANNICT_TOKEN が要らないか】
// Annict側はデプロイ済みサイトの公開API `/api/season`（CORS許可・キー不要）から取る。
// x-growth.yml が既に採っている方針（「数字・作品名・配信先はデプロイ済みサイトの
// /api/season から取得する。ANNICT_TOKENの複製は不要」）にそのまま乗る。
//
// 【記録の原則】（lib/serviceAdditions.ts と同じ思想）
//   - **消えたことは扱わない**。編集で作品やサービスが一時的に見えなくなっても記録は
//     消さない（揺れをデータに持ち込まない）。
//   - **firstSeen は一度書いたら二度と上書きしない**。
//   - **初回観測には seeded: true を立てる**。記録を始めた日に既に在ったものは
//     「その日に現れた」のではなく「その日より前から在った」ので、遅れの計測には
//     **使えない**。この印が無いと初回の大量データを誤って初出と読んでしまう。
//
// 使い方:
//   node scripts/track-season.js              … 対象クールを自動で決めて記録
//   node scripts/track-season.js 2027 winter  … クールを明示
// 環境変数:
//   TRACK_SITE_URL    … Annict側の取得元（既定は本番サイト）
//   TRACK_ANILIST_URL … AniList GraphQLのURL（既定 https://graphql.anilist.co）
//   TRACK_OUT_PATH    … 書き出し先
//   TRACK_TODAY       … JSTの基準日を "YYYY-MM-DD" で固定（テスト用。運用では未設定）
// ───────────────────────────────────────────────────────────────

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("node:fs");
const { join, dirname } = require("node:path");

// 既定値は素の定数＋env上書き（scripts/fetch-gsc.js・lead-finder.js と同じ作法。
// plain .js から lib/siteUrl.ts を import できないため。独自ドメイン移行時は両方直す）。
const SITE_URL = process.env.TRACK_SITE_URL || "https://animedia-khaki.vercel.app";
const ANILIST_URL = process.env.TRACK_ANILIST_URL || "https://graphql.anilist.co";
// 差し替えられるのは**値だけ**で、判断の分岐はテストと本番で同じ経路を通る
// （CLAUDE.md「スタブ用の抜け道を本番でも通る分岐として書かない」）。
const OUT_PATH =
  process.env.TRACK_OUT_PATH || join(__dirname, "..", "content", "coverage", "first-seen.json");

const SEASONS = ["winter", "spring", "summer", "autumn"];
const ANILIST_SEASON = { winter: "WINTER", spring: "SPRING", summer: "SUMMER", autumn: "FALL" };

// JSTの日付。scripts/lib/build-digest.js の jstParts と同じ +9h 手動オフセット方式
// （Intl のタイムゾーンDB依存を避け、既存コードと書き方を揃える）。
function jstToday(now = new Date()) {
  if (process.env.TRACK_TODAY) return process.env.TRACK_TODAY;
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// 「いま」から見て記録すべきクールを決める。現在クール＋先の2クール。
// 先を2つ見るのは、狙いが「次クールの作品がいつ載るか」だから。例えば8月なら
// 2026-autumn（10月開始・発表が進行中）と 2027-winter（1月開始・これから発表が
// 始まる＝**まるごと観測できる**）の両方を最初から追える。現在クールも見るのは、
// 配信サービスの追加（②）が起きるのが主にそこだから。
function targetSeasons(today) {
  const [y, m] = today.split("-").map(Number);
  const idx = Math.floor((m - 1) / 3); // 1-3月=winter 4-6=spring 7-9=summer 10-12=autumn
  const out = [];
  for (let i = 0; i < 3; i++) {
    const n = idx + i;
    out.push(`${y + Math.floor(n / 4)}-${SEASONS[n % 4]}`);
  }
  return out;
}

// 一時的な失敗（429・5xx・ネットワーク断）だけ指数バックオフで再試行し、恒久的な
// 失敗（400・404 等）は即座に投げる。CLAUDE.md の基本ルール
// 「外部APIに投げる処理は一時的な失敗を前提に書く」に従う。待ち時間だけ env で
// 縮められるが、**判断の分岐はテストと本番で同じ経路**を通す。
const RETRY_BASE_MS = Number(process.env.TRACK_RETRY_BASE_MS || 2000);

async function withRetry(label, attempt, fn) {
  try {
    return await fn();
  } catch (e) {
    if (!e.retryable || attempt >= 3) throw e;
    const wait = RETRY_BASE_MS * 2 ** attempt;
    console.warn(`  ${label}: ${e.message} のため ${wait}ms 後に再試行します（${attempt + 1}/3）`);
    await new Promise((r) => setTimeout(r, wait));
    return withRetry(label, attempt + 1, fn);
  }
}

function temporary(message) {
  const e = new Error(message);
  e.retryable = true;
  return e;
}

async function request(label, url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw temporary(`通信エラー(${e.message})`);
  }
  if (res.status === 429 || res.status >= 500) throw temporary(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}（恒久的なエラーとして再試行しません）`);
  return res.json();
}

// ── 情報源①: Annict（デプロイ済みサイトの公開API経由） ────────────────
async function fetchAnnict(seasonStr) {
  const [year, season] = seasonStr.split("-");
  const url = `${SITE_URL}/api/season?year=${year}&season=${season}`;
  const body = await withRetry(`annict/${seasonStr}`, 0, () =>
    request(`annict/${seasonStr}`, url, { headers: { "User-Agent": "animedia-track-season" } })
  );
  if (!Array.isArray(body.items)) throw new Error(`annict/${seasonStr}: items 配列が返りませんでした`);
  return body.items.map((it) => ({
    id: String(it.id),
    title: it.title,
    rank: it.watchers ?? 0,
    startDate: it.broadcastStartDate ?? null,
    services: (it.services || []).map((s) => s.key),
  }));
}

// ── 情報源②: AniList（公式GraphQL・無料・キー不要） ────────────────
const ANILIST_QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
      id
      title { native romaji }
      startDate { year month day }
      popularity
    }
  }
}`;

async function fetchAniList(seasonStr) {
  const [year, season] = seasonStr.split("-");
  const label = `anilist/${seasonStr}`;
  const out = [];
  // ページングは上限を切る（無限ループと、規約が禁じる大量収集の両方を避ける）。
  for (let page = 1; page <= 6; page++) {
    const body = await withRetry(label, 0, () =>
      request(label, ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: ANILIST_QUERY,
          variables: { season: ANILIST_SEASON[season], seasonYear: Number(year), page },
        }),
      })
    );
    // GraphQLは200でエラーを返すことがある（scripts/probe-series.ts と同じ扱い）。
    if (body.errors?.length) throw new Error(`${label}: GraphQLエラー: ${body.errors[0]?.message}`);
    const pageData = body.data?.Page;
    if (!pageData || !Array.isArray(pageData.media)) throw new Error(`${label}: media 配列が返りませんでした`);
    for (const m of pageData.media) {
      const d = m.startDate || {};
      const startDate =
        d.year && d.month && d.day
          ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`
          : null;
      out.push({
        id: String(m.id),
        title: m.title?.native || m.title?.romaji || `(無題 ${m.id})`,
        rank: m.popularity ?? 0,
        startDate,
        services: [], // AniListは国内配信サービス名を持たない（2026-08-12調査）
      });
    }
    if (!pageData.pageInfo?.hasNextPage) break;
  }
  return out;
}

const SOURCES = { annict: fetchAnnict, anilist: fetchAniList };

function loadStore() {
  if (!existsSync(OUT_PATH)) return { updatedAt: null, sources: {} };
  try {
    const parsed = JSON.parse(readFileSync(OUT_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.sources !== "object") {
      throw new Error("形が違います");
    }
    return parsed;
  } catch (e) {
    // 壊れたファイルを黙って空で上書きすると、積み上げた記録が消える。
    throw new Error(`${OUT_PATH} を読めませんでした（${e.message}）。手で確認してください。`);
  }
}

// 1情報源×1クール分の観測を記録に反映する。既存の firstSeen は決して上書きしない。
function applySeason(container, seasonStr, items, today) {
  if (!container[seasonStr]) container[seasonStr] = { firstRecorded: today, works: {}, daily: [] };
  const rec = container[seasonStr];
  // 記録を始めた日の観測は「その日に現れた」ではなく「その日より前から在った」。
  // 遅れの計測に使えないので seeded 印を付ける。
  const seeding = rec.firstRecorded === today;

  let newWorks = 0;
  let newServices = 0;
  for (const it of items) {
    let w = rec.works[it.id];
    if (!w) {
      w = { title: it.title, firstSeen: today, services: {} };
      if (seeding) w.seeded = true;
      else newWorks++;
      rec.works[it.id] = w;
    }
    // 変動しうる値は毎回いまの値に更新する（firstSeen だけが不変）
    w.title = it.title;
    w.rank = it.rank;
    w.startDate = it.startDate;
    for (const key of it.services) {
      if (!w.services[key]) {
        w.services[key] = seeding ? { firstSeen: today, seeded: true } : { firstSeen: today };
        if (!seeding) newServices++;
      }
    }
    // 消えたサービス・消えた作品は触らない（揺れを持ち込まない）
  }

  const withServices = items.filter((it) => it.services.length > 0).length;
  // 同じ日に2回走っても行が増えないようにする（scheduleの重複起動・手動起動に耐える）
  const row = { date: today, works: items.length, withServices };
  const existing = rec.daily.find((d) => d.date === today);
  if (existing) Object.assign(existing, row);
  else rec.daily.push(row);
  rec.daily.sort((a, b) => a.date.localeCompare(b.date));

  return { seeding, total: items.length, withServices, newWorks, newServices };
}

async function main() {
  const today = jstToday();
  const argv = process.argv.slice(2);
  const targets = argv.length >= 2 ? [`${argv[0]}-${argv[1]}`] : targetSeasons(today);

  console.log(`基準日(JST): ${today}`);
  console.log(`対象クール: ${targets.join(", ")}\n`);

  const store = loadStore();
  const failures = [];

  // 情報源×クールで独立して try/catch する。1件の失敗で残りを巻き添えにしない
  // （CLAUDE.md の基本ルール）。片方の情報源が落ちても、もう片方の記録は続く。
  for (const [name, fetcher] of Object.entries(SOURCES)) {
    if (!store.sources[name]) store.sources[name] = {};
    for (const seasonStr of targets) {
      const label = `${name}/${seasonStr}`;
      try {
        const items = await fetcher(seasonStr);
        const r = applySeason(store.sources[name], seasonStr, items, today);
        const head = r.seeding ? "種まき（初回観測・遅れの計測には使えない）" : "更新";
        console.log(
          `${label}: ${head} / 作品 ${r.total}件（配信あり ${r.withServices}件）` +
            (r.seeding ? "" : ` / 新規作品 ${r.newWorks}件・新規サービス ${r.newServices}件`)
        );
      } catch (e) {
        console.error(`${label}: 失敗しました — ${e.message}`);
        failures.push(label);
      }
    }
  }

  // 取れた分だけでも必ず残す（部分成功を捨てない）。
  store.updatedAt = today;
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(store, null, 2) + "\n");
  console.log(`\n書き出し: ${OUT_PATH}`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} 件の取得に失敗しました: ${failures.join(", ")}`);
    process.exit(1);
  }
}

module.exports = { targetSeasons, applySeason, jstToday };

if (require.main === module) {
  main().catch((err) => {
    console.error("記録に失敗しました:", err);
    process.exit(1);
  });
}
