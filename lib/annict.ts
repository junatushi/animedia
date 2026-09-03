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
  // rebroadcast は作品個別取得（WORK_QUERY / PROGRAMS_QUERY_DETAIL）でのみ取得する。
  // SEASON_QUERY（一覧）では取得しないため、その場合は常にundefinedになる。
  // episode は「配信開始通知メールの話数表示」専用で、PROGRAMS_QUERY_EPISODE で
  // 別途取ってから mergeEpisodeInfo で重ねたときだけ入る（理由は PROGRAM_FIELDS_* の
  // コメント参照）。
  // なお episode を要求したクエリでは、未紐付けのprogramがAnnict側のnon-nullフィールド
  // 違反によりノード自体がnullで返ってくる（gql()が部分エラーとして許容するため）。
  // 呼び出し側は必ずnullを除外して扱う。
  nodes: ({
    channel: { name: string | null } | null;
    startedAt: string | null;
    rebroadcast?: boolean | null;
    episode?: { number: number | null; numberText: string | null } | null;
  } | null)[];
}

// programs.nodes の生の形。episode を要求したクエリでは要素が null になりうる
// （PROGRAM_FIELDS_* のコメント参照）ため、扱う側は必ず null を落とす。
// export はテスト用（scripts/check.ts が mergeEpisodeInfo を検査する）。
export type ProgramNodes = ProgramConn["nodes"];

interface RawWork {
  annictId: number;
  title: string;
  watchersCount: number | null;
  officialSiteUrl: string | null;
  // AniListとの突き合わせキー（lib/types.ts の AnnictWork.malAnimeId 参照）。
  malAnimeId: number | null;
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
//
// 【重大・2026-08-11】ここは長らく CASTS_LIST = 5 だった。「一覧（検索用）は主要5件で
// 足りる」という前提が誤りで、次の全部がこの5件だけを見ている:
//   ・検索欄の声優名マッチ（components/SeasonExplorer.tsx）
//   ・声優ページの出演作一覧（app/person/.../page.tsx の findWorks）
//   ・作品ページの声優リンクを出すか否かの判定（app/anime/[id]/page.tsx）
//   ・sitemapに載せる声優ページの選定（app/sitemap.ts）
//   ・過去クールの声優索引（content/archive/people.json）
// 実データでは **2025夏の172作品中87作品（50.6%）がちょうど5件＝上限で切られていた**。
// つまり6番目以降にクレジットされた声優は、そのクールに出演していないのと同じ扱いに
// なっていた（利用者からの指摘: 悠木碧が作品ページでリンクにならず、検索でも1作品しか
// 出てこない）。しかも「2作品以上」の閾値と噛み合って、リンクもページも消える。
// 一覧の castNames は /api/season の応答とSSRのHTMLに載るが、実測で **JSON全体119KBの
// うち3KB（3.3%）** しかなく、増やしても支配的にならない。件数をケチる理由が無い。
// なお一覧はキャラクター名を使わない（作品ページ専用）ので、一覧のクエリからは
// `character { name }` を落として増分を相殺する。
// `node scripts/check.ts` が「一覧クエリの casts が十分な件数か」を検査している。
const CASTS_LIST = 40;
const CASTS_DETAIL = 40;
// staffs は「監督」「原作」「アニメーション制作」を探すための件数。多くの作品は
// 数件〜20件程度に収まるが、余裕を持って40件まで見る（それでも無ければ省略）。
// シーズン一覧クエリは声優・スタッフ名検索のマッチ用途のみ（監督・製作会社等の
// 表示は個別ページ専用）なので15件で十分実用に足り、応答時間短縮を優先する。
const STAFFS_LIST = 15;
const STAFFS_DETAIL = 40;

// withCharacter=false のときキャラクター名を取らない。一覧は声優名しか使わない
// （キャラ名を出すのは作品個別ページだけ）ので、その分の転送量を節約する。
function creditsFields(
  castsCount: number,
  staffsCount: number,
  withCharacter = true
): string {
  return `
      casts(first: ${castsCount}) {
        nodes { name${withCharacter ? " character { name }" : ""} }
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
const CREDITS_FIELDS = creditsFields(CASTS_LIST, STAFFS_LIST, false);
const CREDITS_FIELDS_DETAIL = creditsFields(CASTS_DETAIL, STAFFS_DETAIL);

// ── programs のフィールド構成（2026-08-16 再設計） ──────────────────────────
// Annict の `Program.episode` は non-null なのに、話数がまだ紐付いていない program が
// 実在する。そこに episode を要求すると GraphQL の null 伝播で **program ノードが丸ごと
// null** になり、channel（＝配信サービス）ごと消える。
// 実測（2026-08-16・Annict本番。episode を外すと全部戻ることも同時に確認）:
//   ・17359 スティール・ボール・ラン … programs 11件が11件ともnull＝Netflixが消滅
//   ・17433 カードファイト!! ヴァンガード … 21件が21件ともnull＝放送7局が消滅
//   ・16468 ブチ切れ令嬢 … 252件中147件がnull＝UTYテレビ山梨が消滅
// 一方 rebroadcast は nullable なので、要求してもノードは消えない（同日実測）。
// したがって **配信サービスを数えるための取得では episode を要求しない**。
// 話数が要るのは配信開始通知メールだけなので、そこだけ PROGRAMS_QUERY_EPISODE で
// 別に取り、channel名＋startedAt で突き合わせて重ねる（mergeEpisodeInfo）。
// 2026-07-12 に一覧の追い取得だけを直したが、1ページ目を取る WORK_QUERY 自体が
// episode を要求したままだったため、300件以下の作品でも作品ページだけが
// 「配信情報なし」になっていた（一覧＝/api/season には出るのに、である）。
const PROGRAM_FIELDS_LIST = "channel { name } startedAt";
const PROGRAM_FIELDS_DETAIL = `${PROGRAM_FIELDS_LIST} rebroadcast`;
const PROGRAM_FIELDS_EPISODE = `${PROGRAM_FIELDS_DETAIL} episode { number numberText }`;

// シーズンの作品一覧＋各作品の programs（最大 PROGRAMS_PER_WORK_LIST 件）＋
// casts/staffs（声優・スタッフ名の検索用）を取る。
// export はテスト用（scripts/check.ts）。
export const SEASON_QUERY = `
query ($season: String!, $after: String) {
  searchWorks(seasons: [$season], first: ${PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      annictId
      title
      watchersCount
      officialSiteUrl
      malAnimeId
      media
      image { recommendedImageUrl }
      programs(first: ${PROGRAMS_PER_WORK_LIST}) {
        pageInfo { hasNextPage endCursor }
        nodes { ${PROGRAM_FIELDS_LIST} }
      }
${CREDITS_FIELDS}
    }
  }
}`;

// 作品個別取得（fetchWorkById）で programs が1ページに収まらなかったときの追い取得。
// episode は要求しない（要求するとノードごと消える。PROGRAM_FIELDS_* のコメント参照）。
// export はテスト用（scripts/check.ts が「episodeを要求しない」ことを固定する）。
export const PROGRAMS_QUERY_DETAIL = `
query ($id: Int!, $after: String) {
  searchWorks(annictIds: [$id], first: 1) {
    nodes {
      programs(first: ${PROGRAMS_PER_WORK_DETAIL}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${PROGRAM_FIELDS_DETAIL} }
      }
    }
  }
}`;

// 配信開始通知メールの「話数」専用クエリ（2026-08-16分離）。**これだけが episode を
// 要求してよい**。episode 未紐付けのprogramはノードごとnullで返るので、この応答は
// 「配信サービスの一覧」には決して使わず、mergeEpisodeInfo で話数だけを重ねる。
// export はテスト用（scripts/check.ts）。
export const PROGRAMS_QUERY_EPISODE = `
query ($id: Int!, $after: String) {
  searchWorks(annictIds: [$id], first: 1) {
    nodes {
      programs(first: ${PROGRAMS_PER_WORK_DETAIL}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${PROGRAM_FIELDS_EPISODE} }
      }
    }
  }
}`;

// シーズン一覧の追い取得専用（2026-07-12導入）。上と違い episode フィールドを要求しない。
// 理由: Annictはepisode未紐付けのprogramでnon-nullフィールド違反を返し、該当ノードが
// channel/startedAtごと丸ごとnullになる（gql()参照）。放送局数が多く1ページ(300件)に
// 収まらない作品（実例: 片田舎のおっさん、剣聖になるⅡ＝全国ネット24局+AT-X+BS朝日で
// 300件超）は追い取得が発生し、そこでepisodeを要求すると配信サービス側の番組ノードが
// 未紐付けのままnullになって丸ごと消え、「配信情報なし」に見えてしまっていた。
// シーズン一覧（toAnimeItem）はepisode/rebroadcastを使わないため、要求しないことで
// この事故を避ける。
export const PROGRAMS_QUERY_LIST = `
query ($id: Int!, $after: String) {
  searchWorks(annictIds: [$id], first: 1) {
    nodes {
      programs(first: ${PROGRAMS_PER_WORK_DETAIL}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${PROGRAM_FIELDS_LIST} }
      }
    }
  }
}`;

// 作品個別ページ（/anime/[id]）用に、1作品だけをIDで取得するクエリ。
// 取得対象は1作品だけなので、programs/staffsの上限を一覧クエリより高く保っても
// 応答時間への影響は小さい（完全性を優先）。
// **episode を足さないこと**（足すと配信サービスが丸ごと消える。PROGRAM_FIELDS_* 参照）。
// export はテスト用（scripts/check.ts）。
export const WORK_QUERY = `
query ($id: Int!) {
  searchWorks(annictIds: [$id], first: 1) {
    nodes {
      annictId
      title
      watchersCount
      officialSiteUrl
      malAnimeId
      media
      image { recommendedImageUrl }
      programs(first: ${PROGRAMS_PER_WORK_DETAIL}) {
        pageInfo { hasNextPage endCursor }
        nodes { ${PROGRAM_FIELDS_DETAIL} }
      }
${CREDITS_FIELDS_DETAIL}
    }
  }
}`;

// programs の追い取得を無制限に並列実行すると、1シーズンあたり数十〜百件規模の
// 同時リクエストがAnnictに飛び、レート制限（429）を誘発する（2026-07-09実測で発生）。
// 同時実行数を絞ってバーストを防ぐ。8は2026-07-21実測で429なし・追い取得1.39s→1.10s
// （追い対象13作品時）。追い対象が急増するシーズンで429が出たら4に戻す。
const PROGRAMS_FETCH_CONCURRENCY = 8;

/**
 * 作品1件ぶんのキャッシュタグ。
 *
 * 【なぜ作品ごとに分けるか・2026-09-03実測】
 * 以前は `gql()` の全クエリに一律で `["annict"]` を付けていた。`/api/revalidate` は
 * 1日2回 `revalidateTag("annict")` を呼ぶので、**過去クール1,961件を含む全作品ページの
 * ISRエントリが12時間ごとに捨てられていた**。下のコメントにある「過去クールは
 * そもそも内容が動かないので作り直さない」という意図と、コードが食い違っていた。
 *
 * 証拠（ローカル本番ビルド）: 過去クール作品を1回描画したあとの
 * `.next/server/app/anime/13180.meta` が `x-next-cache-tags: annict,...` を持つ
 * ＝ **revalidateTag はデータ層だけでなくページごと無効化する**。
 *
 * 影響（Vercel Observability・12時間の実測）: `/anime/[id]` が起動667回中476回（71%）・
 * Active CPU 1分00秒で全ルート中1位だった。cronはこの窓でちょうど1回動いている。
 *
 * これで `revalidate: 604800`（1週間）が作品ページに対して初めて効くようになり、
 * 鮮度が要るぶん（現在クール＋次クール）だけを /api/revalidate が名指しで古くする。
 * 逆戻りは `node scripts/check.ts` の「Annictのキャッシュタグ」節が機械的に禁じている。
 */
export function workCacheTag(id: number): string {
  return `annict-work-${id}`;
}

async function gql<T>(
  body: { query: string; variables: Record<string, unknown> },
  token: string,
  // このクエリの応答に付けるキャッシュタグ。既定はクール一括・索引などの
  // 「作品に紐づかない」問い合わせ用。作品1件の取得は workCacheTag(id) を渡す。
  tags: string[] = ["annict"]
): Promise<T> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      // “できるだけリアルタイム” と Annict への負荷のバランス。
      // 常に最新が欲しければ 0 に、負荷を下げたければ大きくする。
      // 【2026-08-25変更（2回目）】600 → 3600 → 604800（1週間）＋タグ。
      // App Routerではページの revalidate とこの fetch のTTLの低いほうが実効値になるため、
      // ここが短いままだとページ側を延ばしても意味が無い（1回目の3600はこの理由で入れた）。
      //
      // 3600でも足りなかった。実測（2026-08-24の超過時・30日）では Edge Requests 10,300件/日に
      // 対し ISR Writes 9,882件/日＝96%で、リクエストのほぼ全部が再生成を起こしていた。
      // sitemapの約7,051ページへ1日10,300リクエストが分散すると1ページあたりの再訪間隔は
      // 平均16.4時間になり、**3600秒はそれより遥かに短いので訪問のたびに必ず期限切れ**になる。
      // 時間で刻む限りこの構造は変わらないため、TTLを再訪間隔より十分長い1週間にして
      // 「時間による再生成」を実質止め、鮮度は下のタグで明示的に取りに行く方式へ変えた。
      //
      // タグは /api/revalidate（.github/workflows/revalidate.yml が1日2回叩く）が
      // revalidateTag で古くする。つまり現在クールの鮮度はcronが担保し、過去クールは
      // そもそも内容が動かないので作り直さない。**その意図をコードに一致させるため、
      // 作品1件の取得だけは作品ごとのタグを使う**（上の workCacheTag の説明を読むこと。
      // ここを一律 "annict" に戻すと過去クール1,961件が1日2回作り直される）。
      // 経緯は docs/operations.md の㉝。
      next: { revalidate: 604800, tags },
    });

    if (res.status === 401) {
      throw new Error("Annict トークンが無効です（401）。.env.local の ANNICT_TOKEN を確認してください。");
    }
    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new Error("Annict API がエラーを返しました（429）。しばらく待って再度お試しください。");
      }
      // レート制限。指数バックオフ＋ジッターで少し待って再試行する。
      const waitMs = 500 * 2 ** attempt + Math.random() * 300;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Annict API がエラーを返しました（${res.status}）。`);
    }

    const json = (await res.json()) as { data?: T; errors?: unknown };
    if (json.errors) {
      // Annict側は一部のprogramがepisode未紐付け等でnon-nullフィールド違反になることがあり、
      // その場合でもdataは（該当ノードだけnullになった状態で）返ってくる（GraphQLのnull伝播）。
      // dataが無い致命的なエラーの時だけ例外にし、部分的な失敗は警告に留めて処理を続行する
      // （呼び出し側はprograms.nodesの要素がnullになり得る前提でfilterする）。
      if (!json.data) {
        throw new Error("Annict GraphQL エラー: " + JSON.stringify(json.errors));
      }
      console.warn("Annict GraphQL 部分的エラー（続行）:", JSON.stringify(json.errors).slice(0, 500));
    }
    return (json.data ?? ({} as T));
  }
}

// 配列を同時実行数を絞りつつ全件処理する（Promise.allの全並列だとバーストしすぎるため）。
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// programs をページ送りで取得する。startAfter に endCursor を渡せば「上限で切れた
// 残り」を、null を渡せば1ページ目から取る（通知機能の話数取得で使う）。
// query に既定値は持たせない: episode を要求するクエリとしないクエリの取り違えが
// そのまま「配信情報なし」に化けるため、どちらで取るのかを呼び出し側に毎回書かせる
// （2026-08-16。既定値が PROGRAMS_QUERY＝episode付きだったことが取りこぼしの一因）。
// tags にも既定値を持たせない（query と同じ理由）。この関数はクール一括の追い取得
// （＝"annict"）と作品1件の追い取得（＝workCacheTag）の両方から呼ばれるので、
// 既定値を置くと呼び分けを間違えても静かに通る。1ページ目と追加ページで違うタグが
// 付くと、片方だけが古くなって配信サービスが欠けた状態がキャッシュに残る。
async function fetchProgramsPaged(
  annictId: number,
  token: string,
  query: string,
  startAfter: string | null,
  tags: string[]
): Promise<ProgramConn["nodes"]> {
  const collected: ProgramConn["nodes"] = [];
  let after: string | null = startAfter;

  for (let i = 0; i < MAX_PROGRAM_PAGES; i++) {
    if (i > 0 && !after) break;
    const data: { searchWorks: { nodes: { programs: ProgramConn | null }[] } } =
      await gql<{ searchWorks: { nodes: { programs: ProgramConn | null }[] } }>(
        { query, variables: { id: annictId, after } },
        token,
        tags
      );
    const conn = data.searchWorks?.nodes?.[0]?.programs;
    if (!conn) break;
    collected.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
    if (!after) break;
  }
  return collected;
}

// episode 付きで取り直した programs から「話数だけ」を、episode を要求せずに取った
// programs（＝配信サービスが欠けていない側）へ重ねる。突き合わせの鍵は
// チャンネル名＋startedAt（この2つで1つの番組が定まる）。
//
// 大事なのは **base 側のノードを絶対に減らさない** こと。episode 側で null になった
// ノードは「話数がまだ紐付いていない」だけであって、その番組が存在しないという意味
// ではない。base を episode 側で置き換えたり絞り込んだりすると、episode を直接
// 要求したのとまったく同じ事故（配信サービスの消滅）になる。
// export はテスト用（scripts/check.ts）。
export function mergeEpisodeInfo(base: ProgramNodes, withEpisode: ProgramNodes): void {
  const programKey = (p: NonNullable<ProgramConn["nodes"][number]>) =>
    `${p.channel?.name ?? ""}\u0000${p.startedAt ?? ""}`;

  const episodeByKey = new Map<string, NonNullable<ProgramConn["nodes"][number]>["episode"]>();
  for (const p of withEpisode) {
    if (!p || !p.episode) continue;
    const key = programKey(p);
    if (!episodeByKey.has(key)) episodeByKey.set(key, p.episode);
  }
  if (episodeByKey.size === 0) return;

  for (const p of base) {
    if (!p || p.episode) continue;
    const episode = episodeByKey.get(programKey(p));
    if (episode) p.episode = episode;
  }
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
  // （実測: キャッシュ切れ直後で8秒超）ため並列化するが、無制限並列（Promise.all）は
  // 対象作品数が多いシーズンでAnnictへの同時リクエストがバースト気味になり、
  // レート制限（429）を誘発した（2026-07-09実測）。同時実行数を絞って投げる。
  await mapWithConcurrency(deduped, PROGRAMS_FETCH_CONCURRENCY, async (w) => {
    const pi = w.programs?.pageInfo;
    if (w.programs && pi?.hasNextPage && pi.endCursor) {
      // クール一括の取得なので、1ページ目（SEASON_QUERY）と同じ "annict" を付ける。
      const extra = await fetchProgramsPaged(w.annictId, token, PROGRAMS_QUERY_LIST, pi.endCursor, [
        "annict",
      ]);
      w.programs!.nodes.push(...extra);
    }
  });

  // API 窓口（route.ts）が使う AnnictWork 形へ整形（programs は nodes だけ渡す）。
  return deduped.map((w) => ({
    annictId: w.annictId,
    title: w.title,
    watchersCount: w.watchersCount,
    officialSiteUrl: w.officialSiteUrl,
    malAnimeId: w.malAnimeId ?? null,
    media: w.media,
    image: w.image,
    programs: w.programs ? { nodes: w.programs.nodes } : null,
    casts: w.casts?.nodes ?? [],
    staffs: w.staffs?.nodes ?? [],
  }));
}

// 作品個別ページ（/anime/[id]）用。annictId 1件だけを取得する。
// 存在しないIDの場合は null を返す（呼び出し側で 404 にする）。
//
// withEpisode を立てると、話数（episode）を要求する2本目のクエリを追加で投げ、
// 取れた分だけ話数を重ねる（配信開始通知メールの「第N話」表示専用）。既定では
// 投げない: episode を要求した応答は program ノードが丸ごと欠けうるので、配信
// サービスの一覧に使ってはならず、通知以外の用途では追加リクエストの価値が無い。
export async function fetchWorkById(
  id: number,
  token: string,
  options: { withEpisode?: boolean } = {}
): Promise<AnnictWork | null> {
  // この作品だけのタグを付ける（一律の "annict" は付けない）。理由は workCacheTag の説明。
  // 追い取得も同じタグにすること（1ページ目と別のタグにすると、片方だけ古くなって
  // 配信サービスが欠けた状態がキャッシュに残る）。
  const tags = [workCacheTag(id)];

  const data = await gql<{ searchWorks: { nodes: RawWork[] } }>(
    { query: WORK_QUERY, variables: { id } },
    token,
    tags
  );
  const w = data.searchWorks?.nodes?.[0];
  if (!w) return null;

  const pi = w.programs?.pageInfo;
  if (w.programs && pi?.hasNextPage && pi.endCursor) {
    const extra = await fetchProgramsPaged(
      w.annictId,
      token,
      PROGRAMS_QUERY_DETAIL,
      pi.endCursor,
      tags
    );
    w.programs.nodes.push(...extra);
  }

  if (options.withEpisode && w.programs) {
    const withEpisode = await fetchProgramsPaged(
      w.annictId,
      token,
      PROGRAMS_QUERY_EPISODE,
      null,
      tags
    );
    mergeEpisodeInfo(w.programs.nodes, withEpisode);
  }

  return {
    annictId: w.annictId,
    title: w.title,
    watchersCount: w.watchersCount,
    officialSiteUrl: w.officialSiteUrl,
    malAnimeId: w.malAnimeId ?? null,
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
