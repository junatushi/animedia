// ───────────────────────────────────────────────────────────────
// 収集エージェント（①）の中核
//   Annict の GraphQL API を叩いて、指定シーズンの作品＋放送/配信
//   チャンネルを取得する。トークンを使うので必ずサーバー側で実行する。
// ───────────────────────────────────────────────────────────────
import type { AnnictWork } from "./types";

const ENDPOINT = "https://api.annict.com/graphql";

const QUERY = `
query ($season: String!) {
  searchWorks(seasons: [$season], first: 100) {
    nodes {
      annictId
      title
      watchersCount
      officialSiteUrl
      image { recommendedImageUrl }
      programs(first: 80) {
        nodes { channel { name } }
      }
    }
  }
}`;

export async function fetchSeasonWorks(
  season: string,
  token: string
): Promise<AnnictWork[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: QUERY, variables: { season } }),
    // “できるだけリアルタイム” と Annict への負荷のバランス。
    // 常に最新が欲しければ 0 に、負荷を下げたければ大きくする。
    next: { revalidate: 600 },
  });

  if (res.status === 401) {
    throw new Error("Annict トークンが無効です（401）。.env.local の ANNICT_TOKEN を確認してください。");
  }
  if (!res.ok) {
    throw new Error(`Annict API がエラーを返しました（${res.status}）。`);
  }

  const json = (await res.json()) as {
    data?: { searchWorks?: { nodes: AnnictWork[] } };
    errors?: unknown;
  };

  if (json.errors) {
    throw new Error("Annict GraphQL エラー: " + JSON.stringify(json.errors));
  }
  return json.data?.searchWorks?.nodes ?? [];
}
