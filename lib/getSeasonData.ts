// シーズン一覧データの取得ロジック。
// app/api/season/route.ts（クライアント側フェッチ用）と
// app/season/[year]/[season]/page.tsx（SEO用のサーバーレンダリング）の
// 両方から共有する。
import { fetchSeasonWorks } from "./annict";
import { toAnimeItem } from "./services";
import type { SeasonResponse } from "./types";

export const VALID_SEASONS = new Set(["winter", "spring", "summer", "autumn"]);

export function isValidYear(year: string): boolean {
  return /^\d{4}$/.test(year);
}

export function isValidSeason(season: string): boolean {
  return VALID_SEASONS.has(season);
}

export async function getSeasonData(year: string, season: string): Promise<SeasonResponse> {
  const token = process.env.ANNICT_TOKEN;
  if (!token) {
    throw new Error("ANNICT_TOKEN が未設定です。プロジェクト直下に .env.local を作り、トークンを設定してください。");
  }

  const seasonStr = `${year}-${season}`;
  const works = await fetchSeasonWorks(seasonStr, token);
  const items = works.map(toAnimeItem).sort((a, b) => b.watchers - a.watchers);

  return { season: seasonStr, count: items.length, items };
}
