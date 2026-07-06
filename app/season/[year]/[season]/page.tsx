import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SeasonExplorer from "@/components/SeasonExplorer";
import { getSeasonData, isValidYear, isValidSeason } from "@/lib/getSeasonData";
import type { SeasonResponse } from "@/lib/types";

const siteUrl = "https://animedia-khaki.vercel.app";
const SEASON_LABEL: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

type Params = { year: string; season: string };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) return {};

  const label = SEASON_LABEL[season];
  const title = `${year}年${label}アニメ 配信情報一覧`;
  const description = `${year}年${label}アニメが、dアニメ・ABEMA・Netflix等どの配信サービスで見られるか一覧。アニメ視聴ガイドでサービス別に絞り込みできます。`;
  const url = `${siteUrl}/season/${year}/${season}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

// 現状トップページ（"/"）はクライアント側フェッチのSPAのため、Googleに
// 「2026年夏アニメ 配信」のようなロングテール検索で拾われにくい。
// このページはサーバー側で事前にデータ取得しHTMLに含めることで、
// シーズン名での検索流入を狙う（SeasonExplorer自体はそのままクライアント
// コンポーネントとして再利用し、初期データを渡すことでもう一度取得しない）。
export default async function SeasonPage({ params }: { params: Params }) {
  const { year, season } = params;
  if (!isValidYear(year) || !isValidSeason(season)) notFound();

  let data: SeasonResponse | undefined;
  try {
    data = await getSeasonData(year, season);
  } catch {
    // 取得失敗時は initialData なしで渡し、SeasonExplorer自身のクライアント側
    // フェッチ・エラー表示に委ねる（真っ白なページにしない）。
    data = undefined;
  }

  return (
    <Suspense fallback={<div className="wrap" />}>
      <SeasonExplorer initialYear={Number(year)} initialSeason={season} initialData={data} />
    </Suspense>
  );
}
