// クール単位のページ（/season /rankings /exclusive /service/[key] /person/[name]）を
// 検索エンジンの索引に載せてよいかの判定。
//
// ───────────────────────────────────────────────────────────────
// 【なぜこのファイルがあるか・2026-08-31の見回りで見つけた事故】
//
// 本番を面ごとに叩いて回ったところ、**取得に失敗したページが HTTP 200 ＋
// `index, follow` で返っていた**。実測:
//
//   /rankings/2099/winter        → 200 / index,follow / 本文「Annict API がエラーを返しました（500）。」
//   /exclusive/2099/winter       → 200 / index,follow / 同上
//   /service/netflix/2099/winter → 200 / index,follow / 同上
//   /person/悠木碧/2099/winter    → 200 / index,follow / 同上
//   /season/2099/winter          → 200 / index,follow / 作品リンク0件（中身が空）
//
// 2099年は極端な例だが、**この経路は年に依存しない**。5つのページはどれも
// `try { getSeasonData() } catch { fetchError = ... }` で失敗を握って
// エラーUIを描くので、**Annictが落ちている間に Googlebot が来ると、今期の
// /season/2026/summer までが「エラー」本文つきで 200 ＋ index として索引されうる**。
// しかもISRはそのHTMLを最大1週間キャッシュに焼く（revalidate=604800）。
//
// 【なぜ404にしないか】
// 一時的な取得失敗で404を返すと、復旧後に再クロールされるまで検索結果から
// 消える。HTTPは200のまま「索引だけ止める」noindex, follow が正しい。
// follow を残すのは、そのページから出ている内部リンクを殺さないため。
//
// 【中身が0件のページも同じ扱いにする理由】
// 作品0件のクールページは「配信情報なし」としか答えられない薄いページで、
// Googleはこれを soft 404 として扱う。年の範囲を絞っても（lib/resolveSeasonParams.ts の
// isSeasonYearInRange）、まだデータが入っていない先のクールでは0件が起こりうる。
// データが入れば自動的に index に戻る（毎回計算しているので手当ては要らない）。
//
// 検査は `node scripts/check.ts` の「取得に失敗したページを索引に載せない」節と、
// `scripts/verify-production.sh` の H 節（本番のHTMLを実際に取って確かめる）。
// 経緯は docs/operations.md の㊲。
// ───────────────────────────────────────────────────────────────

/**
 * Next.js の Metadata.robots にそのまま渡す値。
 * `index: false` で索引だけ止め、`follow: true` で内部リンクは辿らせる。
 */
export const NOINDEX_FOLLOW = { index: false, follow: true } as const;

/**
 * クール単位のページを索引に載せてよいか。
 *
 * @param failed     データ取得が失敗したか（catch に落ちたか）
 * @param itemCount  そのページが実際に並べる作品数
 */
export function shouldIndexSeasonScopedPage(failed: boolean, itemCount: number): boolean {
  if (failed) return false;
  return itemCount > 0;
}

/**
 * generateMetadata の戻り値に混ぜる robots 断片を作る。
 * 索引してよいときは**何も足さない**（既定の index, follow のまま）。
 */
export function robotsFor(failed: boolean, itemCount: number): { robots?: typeof NOINDEX_FOLLOW } {
  return shouldIndexSeasonScopedPage(failed, itemCount) ? {} : { robots: NOINDEX_FOLLOW };
}
