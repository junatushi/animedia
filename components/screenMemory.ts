// 一覧画面（トップ "/" と /season/**）の「さっきまで見ていた画面」を覚えておく仕組み
// （2026-10-05導入）。
//
// 【何をするか】作品ページへ行って戻ってきたとき、一覧を**離れた時点の見た目**
// （年・シーズン・絞り込み・並び順・表示形式・スクロール位置）に戻す。
//
// 【Vercelの無料枠を消費しない設計】ここにあるものは全部ブラウザの中で完結する。
//   - 画面の状態とスクロール位置 … sessionStorage（タブを閉じれば消える。数百バイト）
//   - 取得済みのクールのデータ   … モジュール変数（ソフト遷移のあいだ生きている）
//   - 戻る操作                    … Next.js のルーターキャッシュから描き直す（再取得しない）
// つまり「戻る」たびに /api/season や "/" のRSCを取り直すことはない。むしろ、以前は
// クールを行き来するたびに /api/season を叩き直していたので、呼び出し回数は減る。
//
// 【やらないこと】データ本体を sessionStorage に入れない（1クール最大180KB級で、
// 書き込みのたびに直列化コストがかかる。ソフト遷移中はモジュール変数で足り、
// 再読み込み時はエッジのキャッシュ（s-maxage）から取り直せば十分安い）。
import type { SeasonResponse } from "@/lib/types";

const KEY_PREFIX = "anime-haishin:screen:";
// 古い記憶で見当違いの位置へ飛ばさないための期限。翌日に開き直した人を
// 昨日の位置へ連れて行かない程度に短く、作品ページを読み込む時間よりは十分長く。
const MAX_AGE_MS = 30 * 60 * 1000;

export type ScreenSnapshot = {
  // 離れた時点のURLのクエリ（"?year=..." か ""）。開き直したURLとクエリが違えば
  // 別の画面を開きに来たとみなして使わない（共有リンクで来た人を上書きしない）。
  search: string;
  year: number;
  season: string;
  query: string;
  active: string[];
  activeCast: string[];
  sortKey: "popular" | "title";
  viewMode: "grid" | "calendar";
  calendarDay: string;
  rankingOpen: boolean;
  andMode: boolean;
  favoritesOnly: boolean;
  scrollY: number;
  savedAt: number;
};

export function saveScreen(pathname: string, snap: ScreenSnapshot) {
  try {
    sessionStorage.setItem(KEY_PREFIX + pathname, JSON.stringify(snap));
  } catch {
    // 保存できない環境（プライベートモード等）では、従来どおり先頭から表示されるだけ。
  }
}

export function loadScreen(pathname: string, search: string): ScreenSnapshot | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + pathname);
    if (!raw) return null;
    const snap = JSON.parse(raw) as ScreenSnapshot;
    if (typeof snap?.scrollY !== "number" || typeof snap.savedAt !== "number") return null;
    if (Date.now() - snap.savedAt > MAX_AGE_MS) return null;
    if (snap.search !== search) return null;
    return snap;
  } catch {
    return null;
  }
}

// 取得済みクールのデータ（キーは "2026-autumn"）。行き来や「戻る」で取り直さない。
// ページの再読み込みで消える＝古いデータを長く持ち続けることはない。
const seasonCache = new Map<string, SeasonResponse>();
const SEASON_CACHE_MAX = 6;

export function getCachedSeason(year: number, season: string) {
  return seasonCache.get(`${year}-${season}`);
}

export function putCachedSeason(year: number, season: string, data: SeasonResponse) {
  const k = `${year}-${season}`;
  seasonCache.delete(k);
  seasonCache.set(k, data);
  // 端末のメモリを食い続けないよう、古いものから捨てる。
  while (seasonCache.size > SEASON_CACHE_MAX) {
    const oldest = seasonCache.keys().next().value;
    if (oldest === undefined) break;
    seasonCache.delete(oldest);
  }
}

// 「一覧 → 作品ページ」と来たときに、どの一覧から来たかを覚えておく。
// 作品ページの「トップに戻る」リンクは、直前の履歴がその一覧なら**ブラウザの戻る**として動く
// （components/BackLink.tsx）。新しい履歴を積まない＝戻るボタンで作品ページに
// 戻ってしまう往復が起きず、"/" のRSCを取り直すこともない（Vercelへの要求が0件）。
//
// 「直前の履歴が一覧か」は history.length で判定する。一覧を離れた直後（作品ページの
// 履歴が積まれた後）の長さを記録し、いまの長さと一致するときだけ戻る。作品A→作品Bと
// 進めば長さが変わるので、Bの「トップに戻る」がAへ戻ってしまう誤作動は起きない。
// 判定できない形（Aから「戻る」で来た等）では**普通のリンクとして動く**＝安全側に倒す。
let cameFrom: { path: string; historyLength: number } | null = null;

export function markLeftExplorer(path: string) {
  cameFrom = { path, historyLength: window.history.length };
}

// 直前の履歴エントリが、この href の一覧なら true。
// 比較はパス部分だけ（トップを ?year= 付きで見ていた人も、戻れば元の表示に戻る）。
export function previousEntryIs(href: string): boolean {
  if (!cameFrom) return false;
  if (window.history.length !== cameFrom.historyLength) return false;
  const prevPath = cameFrom.path.split("?")[0];
  return prevPath === href.split("?")[0];
}
