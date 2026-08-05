"use client";

import { useSearchParams } from "next/navigation";
import SeasonExplorer from "./SeasonExplorer";
import type { SeasonResponse } from "@/lib/types";

// トップページ（"/"）専用の薄いラッパー（2026-08-05追加）。
//
// なぜ分けたか:
//   useSearchParams() を呼ぶコンポーネントがあると、Next.js 14 は静的生成（ISR）される
//   ページでその Suspense 境界を丸ごとクライアント描画に退避させ、サーバーHTMLには
//   fallback しか出力しなくなる。SeasonExplorer 自身がこれを呼んでいたため、
//   /season/[year]/[season]（SEOのために作ったSSRページ）まで巻き込まれて
//   中身が空のHTMLを返していた。
//   クエリを読む必要があるのはトップページのディープリンク（?year=&season=）と
//   スクリーンショット用のクエリ（?view=&day=&ranking=）だけなので、その読み取りを
//   この薄いラッパーに閉じ込め、SeasonExplorer 本体はサーバーで描画できる状態に保つ。
//   結果、/season/... はHTMLに作品一覧とリンクが載るようになり、トップページは
//   従来どおりの挙動（クエリでの初期状態復元）を維持できる。
export default function TopPageExplorer({ initialData }: { initialData?: SeasonResponse }) {
  const searchParams = useSearchParams();
  return <SeasonExplorer initialData={initialData} urlQuery={searchParams.toString()} />;
}
