#!/usr/bin/env node
"use strict";
// ───────────────────────────────────────────────────────────────
// 次クールの放送/公開予定日の自動補完（2026-08-17導入）
//
// 【なぜ要るか】
// 2026-08-17の実測で、2026秋クールはAnnictに99作品が登録されているのに
// **programs（番組表）を持つのは3件だけ**で、サイト上では96件が「放送時期未定」だった。
// 同じ日、AniListは同じクールについて38件の日付（日まで）と28件の放送時刻を持っていた。
// つまり**日付はもう公開されているのに、それをサイトへ運ぶ経路が無い**のが穴だった。
//
// 既存の人力補完（content/works/extraServices.ts / releaseDates.ts）は一次情報の
// 確認が必須で、窓（season-prep）も8月下旬・9月中旬に開く運用なので、
// 「公開されたらすぐ反映」にはならない。そこで**機械が1日2回運ぶ層**をここに置く。
//
// 【やること】
//   1. Annict側（＝サイトの現状）を公開API `/api/season` から取る
//   2. AniList側を公式GraphQL（キー不要）から取る
//   3. malAnimeId ↔ idMal / タイトル完全一致 / 公式サイトURL で突き合わせる
//      （食い違ったら採用しない。ロジックは scripts/lib/upcoming-match.js）
//   4. **サイトに日付が無い作品だけ** content/works/autoSchedule.json に書く
//
// 【やらないこと】
//   ・配信サービス名の取り込み。AniListの externalLinks は Crunchyroll 15件・
//     HIDIVE 4件が中心で、国内配信のNetflixは4件・Prime Videoは1件しか無く（2026-08-17実測）、
//     しかも言語・地域の情報が無い。**国内で観られる証拠にならない**ので手を出さない。
//     配信サービスは従来どおりAnnict＋人力補完（extraServices.ts）で埋める。
//   ・broadcastWeekday / broadcastTime / broadcastStartDate への書き込み。それらは
//     カレンダー・ICS配信・SNSの「今日放送」判定まで流れるので、二次情報を混ぜない
//     （lib/types.ts の AutoScheduleEntry のコメント参照）。
//
// 【AniListの利用規約】track-season.js と同じ線を守る。1クールにつき1実行あたり
// 数リクエスト、保存するのは作品ID・予定日・出典URLだけ（本文データは溜めない）。
// 規約: https://docs.anilist.co/guide/terms-of-use / レート制限: 90req/分
//
// 使い方:
//   node scripts/fetch-upcoming.js              … 対象クールを自動で決めて更新
//   node scripts/fetch-upcoming.js 2026 autumn  … クールを明示
// 環境変数:
//   UPCOMING_SITE_URL    … Annict側の取得元（既定は本番サイト）
//   UPCOMING_ANILIST_URL … AniList GraphQLのURL
//   UPCOMING_OUT_PATH    … 書き出し先
//   UPCOMING_TODAY       … JSTの基準日を "YYYY-MM-DD" で固定（テスト用）
//   UPCOMING_RETRY_BASE_MS … 再試行の待ち時間（テストで短縮するためだけ。判断の分岐は変えない）
// ───────────────────────────────────────────────────────────────

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("node:fs");
const { join, dirname } = require("node:path");
const {
  buildAniListIndex,
  matchWork,
  buildEntry,
  mergeWorks,
  isUpcoming,
} = require("./lib/upcoming-match.js");

const SITE_URL = process.env.UPCOMING_SITE_URL || "https://animedia-khaki.vercel.app";
const ANILIST_URL = process.env.UPCOMING_ANILIST_URL || "https://graphql.anilist.co";
const OUT_PATH =
  process.env.UPCOMING_OUT_PATH ||
  join(__dirname, "..", "content", "works", "autoSchedule.json");

const SEASONS = ["winter", "spring", "summer", "autumn"];
const ANILIST_SEASON = { winter: "WINTER", spring: "SPRING", summer: "SUMMER", autumn: "FALL" };

// JSTの日付（track-season.js の jstToday と同じ方式）。
function jstToday(now = new Date()) {
  if (process.env.UPCOMING_TODAY) return process.env.UPCOMING_TODAY;
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// 対象＝現在クール＋先の2クール（track-season.js と同じ範囲。狙いが「次クールの
// 日付をどれだけ早く出せるか」なので、先を2つ見て発表の立ち上がりを拾う）。
function targetSeasons(today) {
  const [y, m] = today.split("-").map(Number);
  const idx = Math.floor((m - 1) / 3);
  const out = [];
  for (let i = 0; i < 3; i++) {
    const n = idx + i;
    out.push(`${y + Math.floor(n / 4)}-${SEASONS[n % 4]}`);
  }
  return out;
}

// 一時的な失敗（429・5xx・ネットワーク断）だけ再試行し、恒久的な失敗は即座に投げる
// （CLAUDE.md「外部APIに投げる処理は一時的な失敗を前提に書く」）。
const RETRY_BASE_MS = Number(process.env.UPCOMING_RETRY_BASE_MS || 2000);

function temporary(message) {
  const e = new Error(message);
  e.retryable = true;
  return e;
}

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

async function request(label, url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw temporary(`${label}: 接続できませんでした（${e.message}）`);
  }
  if (res.status === 429 || res.status >= 500) {
    throw temporary(`${label}: HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (e) {
    throw new Error(`${label}: JSONとして読めませんでした（${e.message}）`);
  }
}

// ── 情報源①: サイトの公開API（＝Annictの現状） ──────────────────
async function fetchSiteSeason(seasonStr) {
  const [year, season] = seasonStr.split("-");
  const label = `site/${seasonStr}`;
  const body = await withRetry(label, 0, () =>
    request(label, `${SITE_URL}/api/season?year=${year}&season=${season}`, {
      headers: { "User-Agent": "animedia-fetch-upcoming" },
    })
  );
  if (!Array.isArray(body.items)) throw new Error(`${label}: items 配列が返りませんでした`);
  return body.items;
}

// ── 情報源②: AniList（公式GraphQL・無料・キー不要） ────────────────
// externalLinks は公式サイトURLでの突き合わせにだけ使う（配信リンクは使わない。
// 冒頭の「やらないこと」参照）。
const ANILIST_QUERY = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: POPULARITY_DESC) {
      id
      idMal
      title { native romaji }
      startDate { year month day }
      externalLinks { site url }
      airingSchedule(perPage: 1) { nodes { episode airingAt } }
    }
  }
}`;

async function fetchAniList(seasonStr) {
  const [year, season] = seasonStr.split("-");
  const label = `anilist/${seasonStr}`;
  const out = [];
  // ページングの上限を切る（無限ループと、規約が禁じる大量収集の両方を避ける）。
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
    // GraphQLは200でエラーを返すことがある（track-season.js と同じ扱い）。
    if (body.errors?.length) throw new Error(`${label}: GraphQLエラー: ${body.errors[0]?.message}`);
    const pageData = body.data?.Page;
    if (!pageData || !Array.isArray(pageData.media)) {
      throw new Error(`${label}: media 配列が返りませんでした`);
    }
    out.push(...pageData.media);
    if (!pageData.pageInfo?.hasNextPage) break;
  }
  return out;
}

// サイトに日付が無い作品だけを補完の対象にする。Annictの実データ・人力補完がある
// 作品はそちらが優先される（lib/services.ts の toAnimeItem）ので、書いても使われない。
function needsDate(item) {
  return !item.broadcastStartDate && !item.releaseDate;
}

function loadStore() {
  if (!existsSync(OUT_PATH)) return { updatedAt: null, source: null, works: {} };
  try {
    const parsed = JSON.parse(readFileSync(OUT_PATH, "utf8"));
    return {
      updatedAt: parsed.updatedAt ?? null,
      source: parsed.source ?? null,
      works: parsed.works && typeof parsed.works === "object" ? parsed.works : {},
    };
  } catch (e) {
    // 壊れていたら**上書きせずに落ちる**（黙って作り直すと、それまでの記録が消える）。
    throw new Error(`${OUT_PATH} を読めませんでした（${e.message}）。手で確認してください。`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const today = jstToday();
  const targets =
    args.length >= 2 ? [`${args[0]}-${args[1]}`] : targetSeasons(today);

  console.log(`基準日（JST）: ${today}`);
  console.log(`対象クール: ${targets.join(", ")}`);

  const store = loadStore();
  const fresh = {};
  let failures = 0;
  let matched = 0;
  let conflicts = 0;
  let duplicates = 0;

  for (const seasonStr of targets) {
    try {
      // 1クールずつ直列に処理する。1クールが落ちても残りは処理する
      // （CLAUDE.md「1件の失敗で残りを巻き添えにしない」）。
      const [items, media] = await Promise.all([
        fetchSiteSeason(seasonStr),
        fetchAniList(seasonStr),
      ]);
      const index = buildAniListIndex(media);

      let added = 0;
      const picks = [];
      let already = 0;
      let unmatched = 0;
      let noDate = 0;
      let past = 0;
      for (const item of items) {
        if (!needsDate(item)) {
          already++;
          continue;
        }
        const m = matchWork(item, index);
        if (!m) {
          unmatched++;
          continue;
        }
        if (m.conflict) {
          conflicts++;
          continue;
        }
        const entry = buildEntry(item, m.media, m.matchedBy, today);
        if (!entry) {
          noDate++;
          continue;
        }
        // 過ぎた日付を「予定」として出さない（isUpcoming のコメント参照）。
        if (!isUpcoming(entry, today)) {
          past++;
          continue;
        }
        picks.push({ id: String(item.id), mediaId: m.media.id, entry: { ...entry, title: item.title } });
      }

      // 逆向きの取り違えも防ぐ（2026-08-17）。索引側は「同じキーに2作品が来たキーは
      // 使わない」ようにしてあるが、**Annict側の2作品が同じAniList作品を指す**形は
      // 素通りしていた（同名のTVシリーズと総集編映画など）。どちらが本物かは機械には
      // 決められないので両方とも採用しない。本番の /api/season が malAnimeId を返し
      // 始めるまでは正規化タイトルの一致が主な手段になるため、ここは実際に効く。
      const byMedia = new Map();
      for (const p of picks) byMedia.set(p.mediaId, (byMedia.get(p.mediaId) ?? 0) + 1);
      for (const p of picks) {
        if (byMedia.get(p.mediaId) > 1) {
          duplicates++;
          continue;
        }
        fresh[p.id] = p.entry;
        added++;
      }

      matched += added;
      console.log(
        `  ${seasonStr}: 作品${items.length}件 / 既に日付あり${already} / 補完${added} / ` +
          `AniListに日付なし${noDate} / 予定日が過去${past} / 未マッチ${unmatched}`
      );
    } catch (e) {
      failures++;
      console.error(`  ${seasonStr}: 失敗しました: ${e.message}`);
    }
  }

  if (conflicts > 0) {
    console.log(`  突き合わせが食い違って採用しなかった件: ${conflicts}`);
  }
  if (duplicates > 0) {
    console.log(`  複数のAnnict作品が同じAniList作品を指し採用しなかった件: ${duplicates}`);
  }

  // 取得できたクールが1つも無いときは書き換えない（空の結果で既存の記録を
  // 痩せさせない）。
  if (failures === targets.length) {
    console.error("すべてのクールで取得に失敗しました。ファイルは変更しません。");
    // process.exit() ではなく exitCode。Windows では書き込み途中の stdout を
    // 巻き込んでプロセスが異常終了し、終了コードが 1 でなく 3221226505
    // (0xC0000409) になる（track-season.js と同じ罠い。scripts/check.ts の末尾にも
    // 同じ注記がある）。CI（ubuntu）では起きないので気づきにくい。
    process.exitCode = 1;
    return;
  }

  const works = mergeWorks(store.works, fresh, { today });
  const next = {
    updatedAt: today,
    source: "AniList (https://anilist.co) — scripts/fetch-upcoming.js が生成。手で編集しない",
    works: Object.fromEntries(
      Object.entries(works).sort((a, b) => Number(a[0]) - Number(b[0]))
    ),
  };

  const before = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, "utf8") : "";
  const after = `${JSON.stringify(next, null, 2)}\n`;
  // updatedAt だけの差分ではコミットしない（毎回コミットが増えても情報は増えない）。
  const sameWorks =
    before !== "" &&
    JSON.stringify(JSON.parse(before || "{}").works ?? {}) === JSON.stringify(next.works);
  if (sameWorks) {
    console.log(`変更なし（${Object.keys(next.works).length}件）。ファイルは更新しません。`);
  } else {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, after);
    console.log(`${OUT_PATH} を更新しました（${Object.keys(next.works).length}件、今回の補完${matched}件）`);
  }

  if (failures > 0) process.exitCode = 1; // 上と同じ理由で process.exit() は使わない
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
