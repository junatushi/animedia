// トップページ（"/"）の「今どのシーズンを見るか」を、URLクエリ（?year=&season=）から
// 解決するロジック。サーバー側（app/page.tsx、SSR初期表示用のデータ取得）と
// クライアント側（components/SeasonExplorer.tsx、状態初期化）の両方が同じ結果を
// 返す必要がある（ズレるとSSRで取得したinitialDataと、クライアントが表示しようと
// する年・シーズンが食い違う）ため、1箇所に集約して両方から呼ぶ。

export const SEASON_KEYS = new Set(["winter", "spring", "summer", "autumn"]);

export function currentSeasonKey(): string {
  return seasonKeyForMonth(new Date().getMonth() + 1);
}

/**
 * 今期の「年」と「クール」を組で返す。
 *
 * 【なぜこの関数が要るか・2026-08-11】
 * `currentSeasonKey()` が返すのは **クール名だけ**（"summer"）で、"2026-summer" ではない。
 * ところが `currentSeasonKey().split("-")` と書いて `[year, season]` に分解している箇所が
 * **4つ**あった。この書き方では year に "summer"、season に undefined が入り、
 * `getSeasonData("summer", undefined)` を呼ぶ。実害は次のとおりだった:
 *   ・Discordの `/anime` … 常に「見つかりませんでした」
 *   ・`/calendar.ics` … 中身が空
 *   ・配信サービス追加の検知 … Annictが不正なクール指定に500を返し毎回スキップ
 *     （「Annictの障害」に見えていたが、実際はこちらの呼び出しが原因）
 *   ・サービス別ページ … `currentSeasonKey() === "2026-summer"` が常にfalseで、
 *     今期でもカレンダー購読の案内が出ない
 * どれも「エラーにならず、静かに何も出ない」形で壊れるため画面からは気づけない。
 * 年込みで欲しいときは必ずこちらを使うこと。
 * `node scripts/check.ts` が `currentSeasonKey().split(` の再発を検査している。
 */
export function currentYearSeason(): { year: string; season: string } {
  const now = new Date();
  return {
    year: String(now.getFullYear()),
    season: seasonKeyForMonth(now.getMonth() + 1),
  };
}

// 任意の月（1〜12）からクールキーを求める。作品の放送開始月から「どのクールの
// 作品か」を逆算する用途（例: app/anime/[id]/page.tsx のシーズンページへの内部リンク）。
export function seasonKeyForMonth(month: number): string {
  if (month <= 3) return "winter";
  if (month <= 6) return "spring";
  if (month <= 9) return "summer";
  return "autumn";
}

export const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

// 年セレクタが表示する選択肢と同じ範囲（2010年〜今年）。範囲外の年が
// クエリに来た場合は今年にフォールバックする。
export function validYears(thisYear: number): number[] {
  return Array.from({ length: thisYear - 2009 }, (_, i) => thisYear - i);
}

export function resolveYearSeason(searchParams: {
  year?: string;
  season?: string;
}): { year: number; season: string } {
  const thisYear = new Date().getFullYear();
  const years = validYears(thisYear);

  const y = Number(searchParams.year);
  const year = years.includes(y) ? y : thisYear;

  const s = searchParams.season;
  const season = s && SEASON_KEYS.has(s) ? s : currentSeasonKey();

  return { year, season };
}
