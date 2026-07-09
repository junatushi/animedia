// ───────────────────────────────────────────────────────────────
// 収集エージェント（①）の中核
//   Annict の GraphQL API を叩いて、指定シーズンの作品＋放送/配信
//   チャンネルを取得する。トークンを使うので必ずサーバー側で実行する。
// ───────────────────────────────────────────────────────────────
import type { AnnictWork, RawCastNode, RawStaffNode } from "./types";

const ENDPOINT = "https://api.annict.com/graphql";

// 1リクエストあたりの作品数。250あれば通常シーズン（実測: 2026-summer
// 111件、2022-winter 175件）は1リクエストで収まる。以前は50件区切り×
// 複数ページを直列取得しており、ページ数に比例して待ち時間が積み上がる
// （実測: 4ページ×約1.6秒=6.4秒）のが表示遅延の主因だった（2026-07-09計測）。
// pageInfo は残すので、250件を超える大きなシーズンでも hasNextPage で
// 正しく追いページングされる（暴走防止の上限は MAX_PAGES）。
const PAGE_SIZE = 250;
const MAX_PAGES = 20;

// programs は「エピソード×チャンネル」の放送/配信記録。startedAt 昇順で並ぶため、
// 放送（電波）が先頭に固まり、配信サービスは放送より後の日時にずれて後方に来る。
// ここを小さく切ると配信欄が丸ごと欠落する（実測: 才女のお世話は programs 全210件、
// dアニメストアは 127 番目に初出）。まず大きめに一括取得し、それでも hasNextPage が
// 残る作品だけ programs を追いページングして“チャンネルの集合”を漏れなく揃える。
//
// シーズン一覧クエリは50作品前後を1リクエストにまとめるため、1作品あたりの
// programs 上限が応答時間に直結する（実測: 500件→300件で応答が約2〜3割短縮、
// 追いページング発生率も低いまま）。作品個別ページは1作品だけの取得なので、
// 完全性を優先して上限を高いまま維持する。
const PROGRAMS_PER_WORK_LIST = 300;
const PROGRAMS_PER_WORK_DETAIL = 500;
// 1作品あたりの programs 追いページング上限（暴走防止。500×12=6000件まで）。
const MAX_PROGRAM_PAGES = 12;

interface ProgramConn {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: { channel: { name: string | null } | null; startedAt: string | null }[];
}

interface RawWork {
  annictId: number;
  title: string;
  watchersCount: number | null;
  officialSiteUrl: string | null;
  image: { recommendedImageUrl: string | null } | null;
  media: string | null;
  programs: ProgramConn | null;
  casts: { nodes: RawCastNode[] } | null;
  staffs: { nodes: RawStaffNode[] } | null;
}

interface SearchWorksPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: RawWork[];
}

// キャスト/スタッフは声優・スタッフ名での検索（一覧）と作品個別ページの
// クレジット表示の両方で使う。casts は sortNumber 昇順（主要キャストが先頭）で返る。
// 一覧（検索用）は主要5件で足りるが、作品ページは声優を「全員」出したいので多めに取る。
const CASTS_LIST = 5;
const CASTS_DETAIL = 40;
// staffs は「監督」「原作」「アニメーション制作」を探すための件数。多くの作品は
// 数件〜20件程度に収まるが、余裕を持って40件まで見る（それでも無ければ省略）。
// シーズン一覧クエリは声優・スタッフ名検索のマッチ用途のみ（監督・製作会社等の
// 表示は個別ページ専用）なので15件で十分実用に足り、応答時間短縮を優先する。
const STAFFS_LIST = 15;
const STAFFS_DETAIL = 40;

function creditsFields(castsCount: number, staffsCount: number): string {
  return `
      casts(first: ${castsCount}) {
        nodes { name character { name } }
      }
      staffs(first: ${staffsCount}) {
        nodes {
          name
          roleText
          resource {
            __typename
            ... on Organization { name }
            ... on Person { name }
          }
        }
      }`;
}
const CREDITS_FIELDS = creditsFields(CASTS_LIST, STAFFS_LIST);
const CREDITS_FIELDS_DETAIL = creditsFields(CASTS_DETAIL, STAFFS_DETAIL);

// シーズンの作品一覧＋各作品の programs（最大 PROGRAMS_PER_WORK_LIST 件）＋
// casts/staffs（声優・スタッフ名の検索用）を取る。
const SEASON_QUERY = `
query ($season: String!, $after: String) {
  searchWorks(seasons: [$season], first: ${PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      annictId
      title
      watchersCount
      officialSiteUrl
      media
      image { recommendedImageUrl }
      programs(first: ${PROGRAMS_PER_WORK_LIST}) {
        pageInfo { hasNextPage endCursor }
        nodes { channel { name } startedAt }
      }
${CREDITS_FIELDS}
    }
  }
}`;

// 一括取得で programs が切れた作品だけ、残りの programs を追い取りするクエリ。
// シーズン一覧・作品個別ページ両方から呼ばれるため、完全性を優先し上限は高いまま。
const PROGRAMS_QUERY = `
query ($id: Int!, $after: String) {
  searchWorks(annictIds: [$id], first: 1) {
    nodes {
      programs(first: ${PROGRAMS_PER_WORK_DETAIL}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { channel { name } startedAt }
      }
    }
  }
}`;

// 作品個別ページ（/anime/[id]）用に、1作品だけをIDで取得するクエリ。
// 取得対象は1作品だけなので、programs/staffsの上限を一覧クエリより高く保っても
// 応答時間への影響は小さい（完全性を優先）。
const WORK_QUERY = `
query ($id: Int!) {
  searchWorks(annictIds: [$id], first: 1) {
    nodes {
      annictId
      title
      watchersCount
      officialSiteUrl
      media
      image { recommendedImageUrl }
      programs(first: ${PROGRAMS_PER_WORK_DETAIL}) {
        pageInfo { hasNextPage endCursor }
        nodes { channel { name } startedAt }
      }
${CREDITS_FIELDS_DETAIL}
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
  // 対象作品ごとに直列でawaitすると対象数に比例して待ち時間が積み上がる
  // （実測: キャッシュ切れ直後で8秒超）ため、並列に投げる。
  await Promise.all(
    deduped.map(async (w) => {
      const pi = w.programs?.pageInfo;
      if (w.programs && pi?.hasNextPage && pi.endCursor) {
        const extra = await fetchRemainingPrograms(w.annictId, pi.endCursor, token);
        w.programs!.nodes.push(...extra);
      }
    })
  );

  // API 窓口（route.ts）が使う AnnictWork 形へ整形（programs は nodes だけ渡す）。
  return deduped.map((w) => ({
    annictId: w.annictId,
    title: w.title,
    watchersCount: w.watchersCount,
    officialSiteUrl: w.officialSiteUrl,
    media: w.media,
    image: w.image,
    programs: w.programs ? { nodes: w.programs.nodes } : null,
    casts: w.casts?.nodes ?? [],
    staffs: w.staffs?.nodes ?? [],
  }));
}

// 作品個別ページ（/anime/[id]）用。annictId 1件だけを取得する。
// 存在しないIDの場合は null を返す（呼び出し側で 404 にする）。
export async function fetchWorkById(id: number, token: string): Promise<AnnictWork | null> {
  const data = await gql<{ searchWorks: { nodes: RawWork[] } }>(
    { query: WORK_QUERY, variables: { id } },
    token
  );
  const w = data.searchWorks?.nodes?.[0];
  if (!w) return null;

  const pi = w.programs?.pageInfo;
  if (w.programs && pi?.hasNextPage && pi.endCursor) {
    const extra = await fetchRemainingPrograms(w.annictId, pi.endCursor, token);
    w.programs.nodes.push(...extra);
  }

  return {
    annictId: w.annictId,
    title: w.title,
    watchersCount: w.watchersCount,
    officialSiteUrl: w.officialSiteUrl,
    media: w.media,
    image: w.image,
    programs: w.programs ? { nodes: w.programs.nodes } : null,
    casts: w.casts?.nodes ?? [],
    staffs: w.staffs?.nodes ?? [],
  };
}

// クール横断キーワード検索用の軽量インデックス。programs/casts/staffs のような重い
// フィールドは取らず、annictId・タイトル・読み仮名・年・季節だけを複数シーズン分まとめて
// 取得する（1リクエストで複数 seasons を指定できる）。呼び出し側で日次キャッシュする前提。
const SEASON_NAME_TO_KEY: Record<string, string> = {
  WINTER: "winter",
  SPRING: "spring",
  SUMMER: "summer",
  AUTUMN: "autumn",
};

const INDEX_QUERY = `
query ($seasons: [String!], $after: String) {
  searchWorks(seasons: $seasons, first: ${PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { annictId title titleKana seasonYear seasonName }
  }
}`;

interface RawIndexNode {
  annictId: number;
  title: string;
  titleKana: string | null;
  seasonYear: number | null;
  seasonName: string | null;
}

export async function fetchWorksIndex(
  seasons: string[],
  token: string
): Promise<import("./types").SearchIndexEntry[]> {
  const byId = new Map<number, import("./types").SearchIndexEntry>();
  let after: string | null = null;

  // seasons が空だと全作品を舐めてしまうので、その場合は何もしない。
  if (seasons.length === 0) return [];

  // MAX_PAGES × 対象シーズン数までは辿る（暴走防止のため十分大きめに取る）。
  const maxPages = MAX_PAGES * Math.max(seasons.length, 1);
  for (let page = 0; page < maxPages; page++) {
    const data: { searchWorks: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawIndexNode[] } } =
      await gql<{ searchWorks: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawIndexNode[] } }>(
        { query: INDEX_QUERY, variables: { seasons, after } },
        token
      );
    const conn = data.searchWorks;
    if (!conn) break;
    for (const n of conn.nodes) {
      if (byId.has(n.annictId)) continue;
      byId.set(n.annictId, {
        id: n.annictId,
        title: n.title,
        kana: n.titleKana || "",
        year: n.seasonYear ?? null,
        season: n.seasonName ? SEASON_NAME_TO_KEY[n.seasonName] ?? null : null,
      });
    }
    if (!conn.pageInfo.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return [...byId.values()];
}
