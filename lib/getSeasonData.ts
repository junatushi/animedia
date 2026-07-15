// シーズン一覧データの取得ロジック。
// app/api/season/route.ts（クライアント側フェッチ用）と
// app/season/[year]/[season]/page.tsx（SEO用のサーバーレンダリング）の
// 両方から共有する。
import { unstable_cache } from "next/cache";
import { fetchSeasonWorks } from "./annict";
import { toAnimeItem } from "./services";
import { EXTRA_SERVICES } from "@/content/works/extraServices";
import type { SeasonResponse } from "./types";

export const VALID_SEASONS = new Set(["winter", "spring", "summer", "autumn"]);

export function isValidYear(year: string): boolean {
  return /^\d{4}$/.test(year);
}

export function isValidSeason(season: string): boolean {
  return VALID_SEASONS.has(season);
}

// lib/annict.ts の gql() は Annict への生クエリを next.revalidate 付き fetch でキャッシュ
// しようとするが、Vercel の Fetch Cache は約2MBを超える応答をキャッシュしない。
// programs（エピソード×チャンネル）を多く積んだクール（例: 既に全話放送済みのクール）は
// 生のGraphQL応答がこれを超え、実測でキャッシュされず毎回Annictへの生アクセスが発生し
// 5〜10秒かかっていた（他クールは0.4〜0.7秒。2026-07-11計測）。
// 生データではなく、整形後の小さいJSON（SeasonResponse、実測100〜130KB）自体を
// ここでキャッシュすることで、クールの規模によらず確実にキャッシュがヒットするようにする。
async function fetchAndBuild(year: string, season: string): Promise<SeasonResponse> {
  const token = process.env.ANNICT_TOKEN;
  if (!token) {
    throw new Error("ANNICT_TOKEN が未設定です。プロジェクト直下に .env.local を作り、トークンを設定してください。");
  }

  const seasonStr = `${year}-${season}`;
  const works = await fetchSeasonWorks(seasonStr, token);
  const items = works
    .map((w) => toAnimeItem(w, EXTRA_SERVICES[w.annictId]))
    .sort((a, b) => b.watchers - a.watchers);

  return { season: seasonStr, count: items.length, items };
}

// 年セレクタは2010年〜今年まで選べるが（lib/resolveSeasonParams.ts）、
// 8分おきのキャッシュ温め（.github/workflows/warm-cache.yml）が対象にするのは
// 今年の4シーズンだけ（Annictへの負荷を増やしすぎないため、過去年は対象外）。
// そのため過去年に切り替えると誰かが観測するまで必ずコールドで、生のAnnict取得
// （実測5〜10秒）を待たされる。ただし過去クールは既に放送が終わっており内容が
// 動くことはほぼ無いので、現在年と同じ10分でキャッシュを切らす必要はない。
// 過去年は24時間キャッシュにして、1日のうちで同じ年に複数人が訪れても
// 2人目以降はコールドを踏まないようにする（1人目の初回コールドだけは避けられない）。
const CURRENT_YEAR_REVALIDATE = 600;
const PAST_YEAR_REVALIDATE = 60 * 60 * 24;

const getCachedCurrentYearSeasonData = unstable_cache(fetchAndBuild, ["season-data-current"], {
  revalidate: CURRENT_YEAR_REVALIDATE,
});
const getCachedPastYearSeasonData = unstable_cache(fetchAndBuild, ["season-data-past"], {
  revalidate: PAST_YEAR_REVALIDATE,
});

// 過去年（放送終了済み）のシーズンは content/snapshots/{year}-{season}.json に確定値を
// 固定しておき（scripts/snapshot-past-seasons.ts で生成）、それを即返す。
// 理由: 過去年をライブ取得＋Vercelデータキャッシュに頼っていた時期は、温めCronが成功した
// 翌日でもキャッシュが追い出されて初回5〜10秒のコールドを踏んでいた（2026-07-15計測で
// 2024夏9.4s/2020冬5.1s）。放送済みで内容がほぼ動かないデータは取り直す必要がないため、
// リポジトリ同梱のJSONを読むことでキャッシュ追い出しの影響を受けず常時0.1s未満にする。
// webpackは `../content/snapshots/*.json` を各シーズン個別のチャンクに分割するため、
// リクエストされた年季のJSONだけが読み込まれる（全件がバンドルに載って肥大することはない）。
// スナップショット未生成の過去年（年またぎ直後など）は従来のライブ取得へフォールバックする。
async function loadPastYearSnapshot(
  year: string,
  season: string
): Promise<SeasonResponse | null> {
  try {
    const mod = await import(`../content/snapshots/${year}-${season}.json`);
    return (mod.default ?? mod) as SeasonResponse;
  } catch {
    return null;
  }
}

export async function getSeasonData(year: string, season: string): Promise<SeasonResponse> {
  const isCurrentYear = Number(year) === new Date().getFullYear();
  if (isCurrentYear) {
    return getCachedCurrentYearSeasonData(year, season);
  }
  const snapshot = await loadPastYearSnapshot(year, season);
  if (snapshot) return snapshot;
  // スナップショットが無い過去年はライブ取得（＋24時間キャッシュ）にフォールバック。
  return getCachedPastYearSeasonData(year, season);
}
