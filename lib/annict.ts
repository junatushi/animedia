// ───────────────────────────────────────────────────────────────
// 収集エージェント（①）の中核
//   Annict の GraphQL API を叩いて、指定シーズンの作品＋放送/配信
//   チャンネルを取得する。トークンを使うので必ずサーバー側で実行する。
// ───────────────────────────────────────────────────────────────
import type { AnnictWork } from "./types";

const ENDPOINT = "https://api.annict.com/graphql";

// 1リクエストあたりの作品数。1シーズンは100件を超えることがある
// （実測: 2026-summer は 105 件）ので、pageInfo で必ずページ送りする。
const PAGE_SIZE = 50;
// 暴走防止の上限（PAGE_SIZE × MAX_PAGES 件まで）。通常シーズンは十分収まる。
const MAX_PAGES = 20;

// programs は「エピソード×チャンネル」の放送/配信記録。startedAt 昇順で並ぶため、
// 放送（電波）が先頭に固まり、配信サービスは放送より後の日時にずれて後方に来る。
// ここを小さく切ると配信欄が丸ごと欠落する（実測: 才女のお世話は programs 全210件、
// dアニメストアは 127 番目に初出）。まず大きめに一括取得し、それでも hasNextPage が
// 残る作品だけ programs を追いページングして“チャンネルの集合”を漏れなく揃える。
const PROGRAMS_PER_WORK = 500;
// 1作品あたりの programs 追いページング上限（暴走防止。500×12=6000件まで）。
const MAX_PROGRAM_PAGES = 12;

interface ProgramConn {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: { channel: { name: string | null } | null }[];
}

interface RawWork {
  annictId: number;
  title: string;
  watchersCount: number | null;
  officialSiteUrl: string | null;
  image: { recommendedImageUrl: string | null } | null;
  programs: ProgramConn | null;
}

interface SearchWorksPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: RawWork[];
}

// シーズンの作品一覧＋各作品の programs（最大 PROGRAMS_PER_WORK 件）を取る。
const SEASON_QUERY = `
query ($season: String!, $after: String) {
  searchWorks(seasons: [$season], first: ${PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      annictId
      title
      watchersCount
      officialSiteUrl
      image { recommendedImageUrl }
      programs(first: ${PROGRAMS_PER_WORK}) {
        pageInfo { hasNextPage endCursor }
        nodes { channel { name } }
      }
    }
  }
}`;

// 一括取得で programs が切れた作品だけ、残りの programs を追い取りするクエリ。
const PROGRAMS_QUERY = `
query ($id: Int!, $after: String) {
  searchWorks(annictIds: [$id], first: 1) {
    nodes {
      programs(first: ${PROGRAMS_PER_WORK}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { channel { name } }
      }
    }
  }
}`;

async function gql<T>(
  body: { query: string; variables: Record<string, unknown> },
  token: string
): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
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

  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error("Annict GraphQL エラー: " + JSON.stringify(json.errors));
  }
  return (json.data ?? ({} as T));
}

// programs が上限で切れた作品について、残りの programs を全ページ取得する。
async function fetchRemainingPrograms(
  annictId: number,
  startAfter: string,
  token: string
): Promise<ProgramConn["nodes"]> {
  const extra: ProgramConn["nodes"] = [];
  let after: string | null = startAfter;

  for (let i = 0; i < MAX_PROGRAM_PAGES && after; i++) {
    const data: { searchWorks: { nodes: { programs: ProgramConn | null }[] } } =
      await gql<{ searchWorks: { nodes: { programs: ProgramConn | null }[] } }>(
        { query: PROGRAMS_QUERY, variables: { id: annictId, after } },
        token
      );
    const conn = data.searchWorks?.nodes?.[0]?.programs;
    if (!conn) break;
    extra.push(...conn.nodes);
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  }
  return extra;
}

export async function fetchSeasonWorks(
  season: string,
  token: string
): Promise<AnnictWork[]> {
  const raws: RawWork[] = [];
  let after: string | null = null;

  // hasNextPage が false になるまで endCursor で辿り、1シーズンを漏れなく取得する。
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: { searchWorks: SearchWorksPage } = await gql<{ searchWorks: SearchWorksPage }>(
      { query: SEASON_QUERY, variables: { season, after } },
      token
    );
    const conn = data.searchWorks;
    if (!conn) break;
    raws.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }

  // Annict のデフォルト並び順は watchersCount 等の変動しうる値に基づくため、
  // ページ送りの最中に順位が変わるとページ境界で同じ作品が2ページにまたがって
  // 重複取得されることがある（実例: 端末によって同一作品が2件表示された）。
  // annictId で1件に統合し、programs（配信チャンネル）は両方分を合算しておく。
  const byId = new Map<number, RawWork>();
  for (const w of raws) {
    const existing = byId.get(w.annictId);
    if (!existing) {
      byId.set(w.annictId, w);
    } else if (w.programs) {
      if (existing.programs) {
        existing.programs.nodes.push(...w.programs.nodes);
        if (w.programs.pageInfo.hasNextPage) existing.programs.pageInfo = w.programs.pageInfo;
      } else {
        existing.programs = w.programs;
      }
    }
  }
  const deduped = [...byId.values()];

  // programs が PROGRAMS_PER_WORK でも足りない作品だけ、残りを追い取りして完全化する。
  // （大半の作品は追加リクエスト0。放送局が多い一部の作品のみ数リクエスト増える）
  for (const w of deduped) {
    const pi = w.programs?.pageInfo;
    if (w.programs && pi?.hasNextPage && pi.endCursor) {
      const extra = await fetchRemainingPrograms(w.annictId, pi.endCursor, token);
      w.programs.nodes.push(...extra);
    }
  }

  // API 窓口（route.ts）が使う AnnictWork 形へ整形（programs は nodes だけ渡す）。
  return deduped.map((w) => ({
    annictId: w.annictId,
    title: w.title,
    watchersCount: w.watchersCount,
    officialSiteUrl: w.officialSiteUrl,
    image: w.image,
    programs: w.programs ? { nodes: w.programs.nodes } : null,
  }));
}
