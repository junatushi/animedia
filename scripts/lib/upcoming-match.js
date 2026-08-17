"use strict";
// ───────────────────────────────────────────────────────────────
// 次クールの放送/公開予定日を、Annictの作品とAniListの作品で突き合わせるロジック
// （2026-08-17導入）。scripts/fetch-upcoming.js から使う純粋関数だけを置く。
// ネットワークにも時計にも触らない（"今日"は引数で渡す）ので、check.ts から
// そのままテストできる。
//
// 【なぜ突き合わせが必要か】
// AniListは次クールの日付を早く持つが、AnnictのIDを持たない。サイトのデータは
// annictId で引くので、「AniListのこの作品 = Annictのこの作品」を確定させないと
// 日付を運べない。**ここで誤マッチすると、無関係な作品の日付がサイトに出る**ため、
// 迷ったら採用しない側に倒す。
//
// 【突き合わせの3手段（この順に強い）】
//   1. mal … Annictの `malAnimeId` と AniListの `idMal`。どちらも同じMyAnimeListの
//            作品IDなので**推測が入らない**。2026-08-17実測で2026秋99作品中74件。
//   2. title … 正規化（NFKC・小文字・記号/空白除去）したタイトルの完全一致。+5件。
//   3. url … 公式サイトURL（AniListの externalLinks の "Official Site"）の
//            ホスト＋パス一致。+1件。
// 合計80件が一致し、**3手段の間で食い違った件は0件**だった。
//
// 【採用しない条件】
//   ・3手段の結果が別々のAniList作品を指した（conflict）
//   ・索引側で同じキーに2作品以上がぶら下がった（ambiguous。同名の別作品を
//     引き当てるのを避ける）
// ───────────────────────────────────────────────────────────────

// タイトルの正規化。全角/半角・大文字小文字・記号・空白の揺れだけを吸収する。
// 「Ⅱ」と「第2期」のような**表記の違いは吸収しない**（別作品を繋ぐ危険があるため。
// content/works/series.ts と同じ考え方＝機械的な期数推測はしない）。
function normalizeTitle(s) {
  return String(s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/[!-/:-@[-`{-~。、・「」『』…～ー－—–]/g, "");
}

// 公式サイトURLの比較キー（ホスト＋パス）。www・末尾スラッシュ・クエリ・
// 大文字小文字の揺れを落とす。壊れたURLは null（＝この手段では突き合わせない）。
function officialSiteKey(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return host + path;
  } catch {
    return null;
  }
}

// AniListの作品リストから索引を作る。同じキーに2作品以上が来たら、そのキーは
// **使わない**（Map の値を null にして「曖昧」と印を付ける）。
function buildAniListIndex(mediaList) {
  const byMal = new Map();
  const byTitle = new Map();
  const byUrl = new Map();

  const put = (map, key, media) => {
    if (!key) return;
    if (map.has(key) && map.get(key) && map.get(key).id !== media.id) {
      map.set(key, null); // 曖昧＝どちらとも決められない
      return;
    }
    if (!map.has(key)) map.set(key, media);
  };

  for (const m of mediaList || []) {
    if (!m || m.id == null) continue;
    if (m.idMal != null) put(byMal, String(m.idMal), m);
    for (const t of [m.title?.native, m.title?.romaji]) {
      const key = normalizeTitle(t);
      if (key) put(byTitle, key, m);
    }
    for (const link of m.externalLinks || []) {
      // AniListは公式サイトを type:"INFO" / site:"Official Site" で持つ
      // （2026-08-17実測。type:"OFFICIAL" は存在しない）。
      if (link?.site !== "Official Site") continue;
      put(byUrl, officialSiteKey(link.url), m);
    }
  }
  return { byMal, byTitle, byUrl };
}

// Annictの1作品に対応するAniList作品を決める。
// 戻り値: { media, matchedBy } / { conflict: true } / null（該当なし）
function matchWork(work, index) {
  const candidates = [];
  const add = (how, media) => {
    if (media) candidates.push({ how, media });
  };
  if (work?.malAnimeId != null) add("mal", index.byMal.get(String(work.malAnimeId)));
  add("title", index.byTitle.get(normalizeTitle(work?.title)));
  const urlKey = officialSiteKey(work?.officialSiteUrl);
  if (urlKey) add("url", index.byUrl.get(urlKey));

  if (candidates.length === 0) return null;
  const ids = new Set(candidates.map((c) => c.media.id));
  if (ids.size > 1) return { conflict: true };
  return { media: candidates[0].media, matchedBy: candidates[0].how };
}

// unix秒（UTC）→ JSTの日付・曜日・時刻。build-digest.js の jstParts と同じ
// 「+9時間してUTCとして読む」方式（タイムゾーンDB依存を避ける）。
function jstPartsOf(unixSeconds) {
  const d = new Date((Number(unixSeconds) + 9 * 3600) * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    weekday: d.getUTCDay(),
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

// "YYYY-MM-DD" の差（日数）。
function dayDiff(a, b) {
  const ms = (s) => Date.UTC(...s.split("-").map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  return Math.round((ms(a) - ms(b)) / 86400000);
}

// 突き合わせ済みのAniList作品から、サイトに渡す1件を組み立てる。
// 日付が全く分からなければ null（＝補完しない。「放送時期未定」のまま）。
function buildEntry(work, media, matchedBy, fetchedDate) {
  const sd = media.startDate || {};
  // 劇場作品は「放送枠」ではなく公開日。AniListの airingSchedule は劇場作品にも
  // 00:00 で入っていることがある（2026-08-17実測: メイドインアビスが 10/23 00:00）が、
  // それは上映時刻ではないので**曜日・時刻としては使わない**。
  const kind = work.media === "MOVIE" ? "release" : "broadcast";

  const startDay =
    sd.year && sd.month && sd.day
      ? `${sd.year}-${String(sd.month).padStart(2, "0")}-${String(sd.day).padStart(2, "0")}`
      : null;
  const startMonth = sd.year && sd.month ? `${sd.year}-${String(sd.month).padStart(2, "0")}` : null;

  const airingAt = media.airingSchedule?.nodes?.[0]?.airingAt ?? null;
  const air = kind === "broadcast" && airingAt != null ? jstPartsOf(airingAt) : null;

  const base = {
    kind,
    sourceUrl: `https://anilist.co/anime/${media.id}`,
    fetchedDate,
    matchedBy,
  };

  if (air) {
    // startDate と第1話の放送時刻が2日以上ずれていたら、どちらかが誤りなので
    // 時刻は捨てて日付だけにする（深夜アニメで1日ずれるのは正常なので許容する）。
    if (startDay && Math.abs(dayDiff(air.date, startDay)) > 1) {
      return { date: startDay, precision: "day", ...base };
    }
    return { date: air.date, precision: "day", weekday: air.weekday, time: air.time, ...base };
  }
  if (startDay) return { date: startDay, precision: "day", ...base };
  if (startMonth) return { date: startMonth, precision: "month", ...base };
  return null;
}

// その予定日が「まだ来ていない」か。過去の日付を「予定」として出すのは誤誘導なので、
// 記録する前にここで落とす（現在クールの作品は既に放送が始まっており、AniListの
// startDate は数週間前を指すことがある。2026-08-17実測で2026夏の9件が該当した）。
//   ・precision "day"   … その日を含めて未来なら true（初回放送日当日は出してよい）
//   ・precision "month" … その月を含めて未来なら true（月の途中なら true のまま。
//                         「10月放送予定」は10月中は成り立つ）
function isUpcoming(entry, today) {
  if (!entry || typeof entry.date !== "string") return false;
  if (entry.precision === "month") return entry.date >= today.slice(0, 7);
  return entry.date >= today;
}

// 前回の記録に今回の取得結果を重ねる。
//   ・今回取れた作品は**新しい値で置き換える**（放送日は延期されるため追従する）。
//   ・今回取れなかった作品は**消さない**（AniList側の一時的な編集・取得失敗で
//     サイトの表示が消えたり戻ったりしないように。lib/serviceAdditions.ts と
//     scripts/track-season.js と同じ「揺れを持ち込まない」原則）。
//   ・予定日が keepDays より前まで過ぎた作品は落とす（放送済みの作品はAnnictの
//     実データが入っているので、この層に残しておく意味が無い）。
function mergeWorks(previous, fresh, { today, keepDays = 180 }) {
  const out = { ...(previous || {}) };
  for (const [id, entry] of Object.entries(fresh || {})) out[id] = entry;
  for (const [id, entry] of Object.entries(out)) {
    const day = entry?.precision === "month" ? `${entry.date}-01` : entry?.date;
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      delete out[id];
      continue;
    }
    if (dayDiff(today, day) > keepDays) delete out[id];
  }
  return out;
}

module.exports = {
  isUpcoming,
  normalizeTitle,
  officialSiteKey,
  buildAniListIndex,
  matchWork,
  buildEntry,
  mergeWorks,
  jstPartsOf,
  dayDiff,
};
