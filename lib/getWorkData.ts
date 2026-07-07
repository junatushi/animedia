// 作品個別ページ（app/anime/[id]/page.tsx）用のデータ取得ロジック。
import { fetchWorkById } from "./annict";
import { toAnimeDetail } from "./services";
import type { AnimeDetail } from "./types";

export async function getWorkData(id: number): Promise<AnimeDetail | null> {
  const token = process.env.ANNICT_TOKEN;
  if (!token) {
    throw new Error("ANNICT_TOKEN が未設定です。プロジェクト直下に .env.local を作り、トークンを設定してください。");
  }

  const w = await fetchWorkById(id, token);
  if (!w) return null;
  return toAnimeDetail(w);
}
