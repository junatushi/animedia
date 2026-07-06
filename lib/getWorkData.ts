// 作品個別ページ（app/anime/[id]/page.tsx）用のデータ取得ロジック。
import { fetchWorkById } from "./annict";
import { toAnimeItem } from "./services";
import type { AnimeItem } from "./types";

export async function getWorkData(id: number): Promise<AnimeItem | null> {
  const token = process.env.ANNICT_TOKEN;
  if (!token) {
    throw new Error("ANNICT_TOKEN が未設定です。プロジェクト直下に .env.local を作り、トークンを設定してください。");
  }

  const w = await fetchWorkById(id, token);
  if (!w) return null;
  return toAnimeItem(w);
}
