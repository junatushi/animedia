"use client";

import SeasonExplorer from "./SeasonExplorer";
import type { SeasonResponse } from "@/lib/types";

// トップページ（"/"）専用の薄いラッパー。
//
// 【2026-09-04変更・重大度高】useSearchParams() の使用をやめた。
//   Next.js 14 は useSearchParams() を呼ぶコンポーネントがあると、静的生成（ISR）される
//   ページでその Suspense 境界を丸ごとクライアント描画に退避させ、サーバーHTMLには
//   fallback しか出力しない。2026-08-05 に /season/** はこれを回避したが、
//   **トップページはこのラッパー経由で退避したままだった**。実測（本番ビルドを curl）:
//   "/" のHTMLは `<div class="wrap"></div>` だけで、h1が0個・作品への
//   <a href="/anime/..."> が0個・カードが0件。サイトの正面玄関（canonical の指す先）が
//   検索エンジンに対して空だった。
//   表示速度でも代償が大きく、本番のPageSpeed実測（モバイル）で
//   トップは Script Evaluation 802ms・HTMLパース 8ms、対するシーズンページは
//   Script Evaluation 469ms・HTMLパース 50ms。つまり「HTMLを読む」より
//   「JSで組み立て直す」ほうが桁違いに高い。観測FCPも 2813ms 対 2519ms でトップが遅い。
//
// 【代わりの方法】クエリはこのファイルの読み込み時（＝hydrationより前）に一度だけ
//   window.location.search から拾い、SeasonExplorer には props として渡す。
//   SeasonExplorer 側は**初期描画では使わず**マウント後の useEffect で反映するので、
//   サーバーHTMLとクライアント初回描画が一致し hydration が壊れない。
//   モジュール読み込み時に取るのは、SeasonExplorer の「既定表示ならURLからクエリを消す」
//   同期 useEffect より先に確定させるため（effectの中で読むと消された後になる）。
const INITIAL_SEARCH =
  typeof window === "undefined" ? "" : window.location.search.replace(/^\?/, "");

export default function TopPageExplorer({ initialData }: { initialData?: SeasonResponse }) {
  // サーバー描画では ""（window が無い）、クライアントでは実際のクエリになる。
  // SeasonExplorer はこれを**描画には使わない**ので、値が違ってもHTMLは一致する。
  return <SeasonExplorer initialData={initialData} urlQuery={INITIAL_SEARCH} />;
}
