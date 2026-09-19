// 作品個別ページ（app/anime/[id]/page.tsx）用のデータ取得ロジック。
import { fetchWorkById } from "./annict";
import { toAnimeDetail, overlayManualData } from "./services";
import { EXTRA_SERVICES } from "@/content/works/extraServices";
import { RELEASE_DATES } from "@/content/works/releaseDates";
// 機械補完した放送/公開の予定日（AniList由来。scripts/fetch-upcoming.js が1日2回更新）。
import AUTO_SCHEDULE_FILE from "@/content/works/autoSchedule.json";
import { parseAutoSchedules } from "./autoSchedule";
import ARCHIVE_INDEX from "@/content/archive/index.json";
import type { AnimeDetail, SeasonResponse, WorkCastCredit, WorkCredits } from "./types";
import type { RoleCredits } from "./studioIndex";
import { jstToday } from "./workAvailability";

// 読み込み時に1回だけ検証する（lib/getSeasonData.ts と同じ）。
const AUTO_SCHEDULES = parseAutoSchedules(AUTO_SCHEDULE_FILE);

// content/archive/index.json から、作品ID→スナップショットファイル名（"{year}-{season}"）
// の逆引きマップを1回だけ作る（モジュールスコープでキャッシュ。サーバーが温まっている
// 間は再構築しない）。
//
// 【2026-09-14変更】workIds（配信1件以上の1,961件）ではなく allWorkIds（9,002件）を使う。
// 配信0件の作品ページもシーズンページからリンクされていて実際にクロールされるので、
// ここを絞ると「sitemapには無いがクロールはされる」7,041ページだけが従来どおり
// Annictへのライブ取得を続けることになる（外部APIの往復・Fluid CPU・ISR Writesが残る）。
let idToSnapshotKey: Map<number, string> | null = null;
function getIdToSnapshotKey(): Map<number, string> {
  if (idToSnapshotKey) return idToSnapshotKey;
  const map = new Map<number, string>();
  for (const s of ARCHIVE_INDEX.seasons) {
    for (const id of s.allWorkIds) {
      map.set(id, `${s.year}-${s.season}`);
    }
  }
  idToSnapshotKey = map;
  return map;
}

// 「このクールはスナップショットだけで作品ページを描き切れるか」。
// 判定は content/archive/index.json の castCreditsComplete **だけ**が持つ
// （生成は scripts/build-archive-index.ts が実データから導出する＝手で並べない）。
let completeSnapshotKeys: Set<string> | null = null;
function getCompleteSnapshotKeys(): Set<string> {
  if (completeSnapshotKeys) return completeSnapshotKeys;
  const set = new Set<string>();
  for (const s of ARCHIVE_INDEX.seasons) {
    if (s.castCreditsComplete) set.add(`${s.year}-${s.season}`);
  }
  completeSnapshotKeys = set;
  return set;
}

// 作品ページをスナップショットだけで描けるか（＝Annictに出なくてよいか）。
// app/anime/[id]/page.tsx の generateStaticParams もこの関数を通す。
// **ここと焼く対象がズレると、焼いたのに中身が違う／焼けるのに焼いていない、が起きる。**
export function isStaticWork(id: number): boolean {
  const key = getIdToSnapshotKey().get(id);
  return key !== undefined && getCompleteSnapshotKeys().has(key);
}

// ビルド時に焼く過去クールの作品ID。旧形式のスナップショットしか無い間は空配列＝
// 従来の挙動（オンデマンド生成）のまま。再生成すると自動で埋まる。
export function staticWorkIds(): number[] {
  const complete = getCompleteSnapshotKeys();
  const ids: number[] = [];
  for (const s of ARCHIVE_INDEX.seasons) {
    if (!complete.has(`${s.year}-${s.season}`)) continue;
    // 焼くのは sitemap に載せている「配信1件以上」だけ。配信0件の作品ページは
    // 「配信情報なし」としか答えられず、焼くと成果物（Deployment Storage）だけが
    // 増える。これらはオンデマンドのままでよい（スナップショット由来なので
    // Annictには出ず、出力も毎回同じ＝2回目以降はISR Writeが発生しない）。
    for (const id of s.workIds) ids.push(id);
  }
  return ids;
}

// スナップショットの1件（AnimeItem＋スナップショット専用の追加フィールド）。
type SnapshotWorkItem = SeasonResponse["items"][number] & {
  roleCredits?: RoleCredits;
  castCredits?: WorkCastCredit[];
};

// スナップショットの1件から AnimeDetail.credits を組み立てる。
// castCredits（新形式）があればそれを使い、無ければ roleCredits と castNames から
// 「役名は分からないが声優名は分かる」形に落とす（推測でキャラ名を埋めない）。
function creditsFromSnapshot(item: SnapshotWorkItem): WorkCredits {
  const role = item.roleCredits;
  return {
    casts:
      item.castCredits ??
      item.castNames.map((personName) => ({ personName, characterName: "" })),
    director: role?.director ?? null,
    productionCompany: role?.productionCompany ?? null,
    originalCreators: role?.originalCreators ?? [],
  };
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
// 【2026-09-14】この関数は「Annictが落ちたときの保険」から「過去クールの正規の
// データ源」へ格上げした。castCredits を持つスナップショット（castCreditsComplete）
// なら、作品ページはネットワークに一切出ずに描け、ビルド時に焼ける。
// 旧形式のスナップショットしか無いクールは従来どおり保険のままで、その場合だけ
// credits.casts の characterName が空になる（推測で埋めない）。
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
    // 人力補完（extraServices.ts / releaseDates.ts）をあとから重ねる。
    // シーズンページ（lib/getSeasonData.ts）と**同じ関数**を通す
    // ＝同じ作品について一覧と作品ページで答えが食い違わない。
    const merged = overlayManualData(item, EXTRA_SERVICES[id], RELEASE_DATES[id]);
    return {
      ...merged,
      releaseDate: merged.releaseDate ?? null,
      // スナップショットは過去クール（放送終了済み）なので、予定日の補完は要らない。
      // 生成時期によってはキー自体が無いため、明示的に null を入れて型と実体を揃える。
      autoSchedule: item.autoSchedule ?? null,
      malAnimeId: item.malAnimeId ?? null,
      // 【2026-09-14変更】credits を空で返すのをやめた。
      // スナップショットは roleCredits（監督・制作会社・原作者）を2026-08-07から、
      // castCredits（声優×キャラ名）を2026-09-14から持っている。空を返していたのは
      // 導入当時それらが無かったからで、**いまは持っているデータを捨てていた**。
      // 旧形式のスナップショットでも roleCredits と castNames は使える。
      credits: creditsFromSnapshot(item as SnapshotWorkItem),
      // スナップショットは放送終了済みの確定データ。「いつ取得したか」を名乗る資格が
      // 無いので null にする。ページ側はこれを見て日付ごと出さない（lib/dataFreshness.ts）。
      fetchedAt: null,
    };
  } catch {
    return null;
  }
}

export async function getWorkData(id: number): Promise<AnimeDetail | null> {
  // ① スナップショットだけで描き切れる過去クールは、Annictに問い合わせない。
  //
  // 【なぜ「まず問い合わせて、失敗したらスナップショット」ではないか】
  //   放送終了済みのクールのデータは二度と動かない。動かないものを毎回取りに行くと、
  //   ①外部APIの往復（Annictへの負荷とこちらの待ち時間）②Fluid Active CPU と
  //   Provisioned Memory（I/O待ちの間もメモリ課金は止まらない）③ISR Writes
  //   （デプロイのたびにキャッシュが消えるので、クロールのたびに書き直しになる）
  //   の3つが、得るもの無しに毎日発生する。しかも**ビルド時に焼けなくなる**
  //   （ビルドが外部APIの生死に依存してしまう）ので、恒久的に費用ゼロにできない。
  // 判定は isStaticWork が1箇所で持ち、焼く対象（generateStaticParams）と同じ関数を通す。
  if (isStaticWork(id)) {
    const staticDetail = await loadFromSnapshot(id);
    if (staticDetail) return staticDetail;
    // 索引には載っているのにファイルから引けなかった（破損・生成漏れ）。
    // 黙って古いデータを出すより、下のライブ取得へ落とす。
  }

  const token = process.env.ANNICT_TOKEN;
  let liveFetchError: unknown = null;

  if (token) {
    try {
      const w = await fetchWorkById(id, token);
      if (w) {
        return {
          ...toAnimeDetail(w, EXTRA_SERVICES[id], RELEASE_DATES[id], AUTO_SCHEDULES[id]),
          // ライブ取得したので「取得日」を名乗ってよい。粒度は日（時刻にすると
          // 再検証のたびに出力が変わり、中身が同じでもISR Writeが課金される）。
          fetchedAt: jstToday(),
        };
      }
      // w === null: Annictにこのidが存在しない（確認済みの404）。
      // 下でスナップショットにも無ければ本当の404として扱う。
    } catch (e) {
      // 一時的なAnnict障害・レート制限・トークン失効などで取得自体に失敗した。
      // 過去クールのスナップショットで救えるか下で試す。救えなければこのエラーを
      // 再送出し、従来通り呼び出し側（page.tsx）がエラー画面＋noindexにする。
      // 【原因を握りつぶさない】ここで独自のErrorに差し替えると、レート制限なのか
      // トークン失効なのかネットワーク断なのかがログから消える。元のエラーを保持して
      // cause に付け直す（切り分けにかかる時間が段違いになる）。
      liveFetchError = e;
    }
  }

  const fallback = await loadFromSnapshot(id);
  if (fallback) return fallback;

  if (!token) {
    throw new Error("ANNICT_TOKEN が未設定です。プロジェクト直下に .env.local を作り、トークンを設定してください。");
  }
  if (liveFetchError) {
    throw new Error("Annictからの取得に失敗しました（一時的な可能性があります）。", {
      cause: liveFetchError,
    });
  }
  // token はあり、Annictへの問い合わせも成功した上でこのidが存在しなかった。
  // スナップショットにも無いので本当に存在しない作品として404にする。
  return null;
}
