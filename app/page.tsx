import type { Metadata } from "next";
import TopPageExplorer from "@/components/TopPageExplorer";
import { getSeasonData } from "@/lib/getSeasonData";
import { currentSeasonKey } from "@/lib/resolveSeasonParams";
import { siteUrl } from "@/lib/siteUrl";
import type { SeasonResponse } from "@/lib/types";

// トップは同じ内容が複数URLで存在しうる（?year=&season= のディープリンク、SNS/リード
// 発掘で配る ?ref=、スクリーンショット用の ?view=&day=&ranking= など）。canonical を
// 宣言していなかったため、Search Console で「重複しています。ユーザーにより、正規ページ
// として選択されていません」（Duplicate without user-selected canonical）が発生していた
// （2026-07-28）。他のページ（/season/** /anime/** など）は各 page.tsx で canonical 済み。
export const metadata: Metadata = {
  alternates: { canonical: siteUrl },
};

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
// 【2026-08-25変更】900秒 → 3600秒（1時間）。Vercel Hobbyの ISR Writes 上限
// （30日で200,000）を296,449件で超過しプロジェクトがPausedになったため。再検証の間隔を
// 延ばすと、①再生成の回数がそのまま減る（ISR Writes・Fluid CPU・Provisioned Memoryの
// 3指標すべてに効く）②キャッシュが効いている時間が長くなるので**表示はむしろ速くなる**。
// ISRは期限切れ後も stale-while-revalidate で古いHTMLを即座に返しつつ裏で作り直すので、
// 期限を延ばしても訪問者が待たされる場面は増えない。Annictの配信情報はコミュニティ更新で
// 分単位に動くものではなく、1時間の鮮度で困る用途がこのサイトには無い。経緯はdocs/operations.md。
export const revalidate = 3600;

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

  // 【2026-09-04変更】Suspense 境界を外した。以前は TopPageExplorer が useSearchParams()
  // を呼んでいたため、Next.js 14 がこの境界の内側を丸ごとクライアント描画に退避させ、
  // **トップページのHTMLが `<div class="wrap"></div>` だけ**になっていた（h1・作品リンク
  // ともに0件）。いまはクエリをマウント後に反映する方式（components/TopPageExplorer.tsx）
  // なので境界は要らず、"/" も /season/** と同じくサーバー描画のHTMLを返す。
  // ここに Suspense を戻すと同じ壊れ方に逆戻りする（node scripts/check.ts が検査する）。
  return <TopPageExplorer initialData={data} />;
}
