import { Suspense } from "react";
import SeasonExplorer from "@/components/SeasonExplorer";
import { getSeasonData } from "@/lib/getSeasonData";
import { resolveYearSeason } from "@/lib/resolveSeasonParams";
import type { SeasonResponse } from "@/lib/types";

// トップページは以前、完全にクライアント側フェッチのSPA（"use client"）だった。
// マウント後に /api/season を叩いてから描画するため、Annictへの問い合わせが
// キャッシュ切れ直後（実測7〜8秒、lib/annict.tsのコメント参照）だと、真っ白な
// 読み込み中表示のまま長く待たされていた。
// サーバー側で（/season/[year]/[season] と同じ要領で）先に1回データ取得し
// initialData として渡すことで、その待ち時間をサーバー側に移す
// （キャッシュ済みなら実質ゼロ、コールドでも少なくとも見た目の白画面は消える）。
// 年・シーズンの選択自体はクエリ文字列（?year=&season=）ベースのままなので、
// クライアント側の解決ロジック（lib/resolveSeasonParams.ts）と完全に同じ関数で
// 揃え、SSRで取得したデータと表示する年・シーズンがズレないようにしている。
export default async function Page({
  searchParams,
}: {
  searchParams: { year?: string; season?: string };
}) {
  const { year, season } = resolveYearSeason(searchParams);

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
