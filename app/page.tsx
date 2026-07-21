import { Suspense } from "react";
import SeasonExplorer from "@/components/SeasonExplorer";
import { getSeasonData } from "@/lib/getSeasonData";
import { currentSeasonKey } from "@/lib/resolveSeasonParams";
import type { SeasonResponse } from "@/lib/types";

// ISR化（2026-07-21）。以前は searchParams（?year=&season=）をサーバー側で読んでいたため、
// Next.js はこのページを動的レンダリング（no-store）にせざるを得ず、毎リクエストをサーバー
// 関数で描画していた（実測: X-Vercel-Cache: MISS/no-store、warmでも0.5〜1s、関数コールドで
// 2.8s）。/season/[year]/[season] は searchParams を使わないため ISR でエッジHIT（0.1s級）
// なのに、実際に多くの人が開く "/" だけがこの動的描画のコストを踏み続けていた。
// トップは大多数が「今期」を見るので、サーバー側は searchParams を読まず常に今期を初期
// 表示し、revalidate を付けて /season 系と同じ ISR（エッジHTMLキャッシュ＋再検証）にする。
// これで実訪問者は関数を実行せず即時HITになる。別クール/過去年へのディープリンク
// （?year=&season=）はクライアント側で解決してフェッチする（SeasonExplorer が initialData と
// 表示クールが食い違う時だけ再フェッチ。/api/season はCDN・スナップショットで高速）。
// 年・季節は revalidate ごとにサーバー再実行で再計算され、クール切替にも自動追従する。
export const revalidate = 900;

export default async function Page() {
  const year = new Date().getFullYear();
  const season = currentSeasonKey();

  let data: SeasonResponse | undefined;
  try {
    data = await getSeasonData(String(year), season);
  } catch {
    // 取得失敗時は initialData なしで渡し、SeasonExplorer自身のクライアント側
    // フェッチ・エラー表示に委ねる（真っ白なページにしない）。
    data = undefined;
  }

  return (
    <Suspense fallback={<div className="wrap" />}>
      <SeasonExplorer initialData={data} />
    </Suspense>
  );
}
