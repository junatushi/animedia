// 作品個別ページ（app/anime/[id]/page.tsx）用のデータ取得ロジック。
import { fetchWorkById } from "./annict";
import { toAnimeDetail } from "./services";
import { EXTRA_SERVICES } from "@/content/works/extraServices";
import { RELEASE_DATES } from "@/content/works/releaseDates";
import ARCHIVE_INDEX from "@/content/archive/index.json";
import type { AnimeDetail, SeasonResponse } from "./types";

// content/archive/index.json（sitemapに載せている「過去クール・配信1件以上」の
// 1,961作品の索引）から、作品ID→スナップショットファイル名（"{year}-{season}"）の
// 逆引きマップを1回だけ作る（モジュールスコープでキャッシュ。サーバーが温まっている
// 間は再構築しない）。
let idToSnapshotKey: Map<number, string> | null = null;
function getIdToSnapshotKey(): Map<number, string> {
  if (idToSnapshotKey) return idToSnapshotKey;
  const map = new Map<number, string>();
  for (const s of ARCHIVE_INDEX.seasons) {
    for (const id of s.workIds) {
      map.set(id, `${s.year}-${s.season}`);
    }
  }
  idToSnapshotKey = map;
  return map;
}

// Annictへのライブ取得（fetchWorkById）が失敗したとき、その作品が過去クールの
// スナップショット（sitemapに載せている1,961件のどれか）に含まれていれば、
// そこから得られる範囲の内容で作品ページを維持するためのフォールバック。
//
// なぜ必要か（2026-08-06導入）:
//   2026-08-05にこの1,961件をsitemapへ追加したが、/anime/[id] は年に関わらず
//   常にfetchWorkById（Annictへのライブ取得）に依存しており、getSeasonDataのように
//   過去年をスナップショットへ切り替える分岐が無かった。放送終了済みで内容が
//   二度と変わらないページのために、クロールのたびにAnnictへの外部APIコールが
//   必要になっていた。さらにAnnictが不調な時間帯に巡回されると、2026-08-05に入れた
//   「取得失敗時はnoindex」の分岐が効いて、開放したばかりのページが索引から
//   外れてしまう（sitemapに追加した意味が失われる）。
//
// なぜ全項目を復元できないか:
//   スナップショット（content/snapshots/{year}-{season}.json）は SeasonResponse
//   （AnimeItem[]）であり、作品ページが必要とする AnimeDetail の `credits`
//   （声優とキャラ名の対応・監督・製作会社・原作者）を持たない。
//   scripts/snapshot-past-seasons.ts の生成時に toAnimeItem までしか呼んでおらず
//   （casts/staffsを分解する deriveCredits は toAnimeDetail 側の処理のため）、
//   スナップショットJSONを実際に開いて確認済み（casts/staffs関連キーは無い。
//   creditNames/castNamesという検索用のフラットな名前配列のみ）。
//   そのため credits は「推測で埋めない」方針（CLAUDE.md）に従い空のまま返す。
//   声優・監督等の情報は欠けるが、配信サービス・放送日時・タイトル等の
//   「どこで配信されているか」という本サイトの主目的には十分な情報が残る。
async function loadFromSnapshot(id: number): Promise<AnimeDetail | null> {
  const key = getIdToSnapshotKey().get(id);
  if (!key) return null;
  try {
    // getSeasonData.ts の loadPastYearSnapshot と同じ相対パスの動的import。
    // webpackがcontent/snapshots/*.jsonをシーズン単位のチャンクに分割するため、
    // 該当シーズンのJSONだけが読み込まれる（全件がバンドルに乗ることはない）。
    const mod = await import(`../content/snapshots/${key}.json`);
    const data = (mod.default ?? mod) as SeasonResponse;
    const item = data.items.find((it) => it.id === id);
    if (!item) return null;
    return {
      ...item,
      // 劇場公開日はスナップショット生成時に注入されていない
      // （snapshot-past-seasons.ts参照）ため、releaseDates.tsから改めて当てる。
      releaseDate: RELEASE_DATES[id] ?? item.releaseDate ?? null,
      credits: { casts: [], director: null, productionCompany: null, originalCreators: [] },
    };
  } catch {
    return null;
  }
}

export async function getWorkData(id: number): Promise<AnimeDetail | null> {
  const token = process.env.ANNICT_TOKEN;
  let liveFetchFailed = false;

  if (token) {
    try {
      const w = await fetchWorkById(id, token);
      if (w) return toAnimeDetail(w, EXTRA_SERVICES[id], RELEASE_DATES[id]);
      // w === null: Annictにこのidが存在しない（確認済みの404）。
      // 下でスナップショットにも無ければ本当の404として扱う。
    } catch (e) {
      // 一時的なAnnict障害・レート制限・トークン失効などで取得自体に失敗した。
      // 過去クールのスナップショットで救えるか下で試す。救えなければこのエラーを
      // 再送出し、従来通り呼び出し側（page.tsx）がエラー画面＋noindexにする。
      liveFetchFailed = true;
    }
  }

  const fallback = await loadFromSnapshot(id);
  if (fallback) return fallback;

  if (!token) {
    throw new Error("ANNICT_TOKEN が未設定です。プロジェクト直下に .env.local を作り、トークンを設定してください。");
  }
  if (liveFetchFailed) {
    throw new Error("Annictからの取得に失敗しました（一時的な可能性があります）。");
  }
  // token はあり、Annictへの問い合わせも成功した上でこのidが存在しなかった。
  // スナップショットにも無いので本当に存在しない作品として404にする。
  return null;
}
