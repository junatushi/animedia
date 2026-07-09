// トップページ（"/"）の「今どのシーズンを見るか」を、URLクエリ（?year=&season=）から
// 解決するロジック。サーバー側（app/page.tsx、SSR初期表示用のデータ取得）と
// クライアント側（components/SeasonExplorer.tsx、状態初期化）の両方が同じ結果を
// 返す必要がある（ズレるとSSRで取得したinitialDataと、クライアントが表示しようと
// する年・シーズンが食い違う）ため、1箇所に集約して両方から呼ぶ。

export const SEASON_KEYS = new Set(["winter", "spring", "summer", "autumn"]);

export function currentSeasonKey(): string {
  const m = new Date().getMonth() + 1;
  if (m <= 3) return "winter";
  if (m <= 6) return "spring";
  if (m <= 9) return "summer";
  return "autumn";
}

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
