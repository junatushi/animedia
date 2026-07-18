// /llms.txt — 生成AI（LLM）向けにサイトの構造と主要URLを簡潔に伝えるファイル。
// llms.txt の慣習（https://llmstxt.org/）に沿って、AIがサイト内容を正確に要約・引用
// しやすいように、Markdownで「何のサイトか」「どこに何があるか」を明示する。
import { siteUrl } from "@/lib/siteUrl";

function currentSeason(): { year: number; season: string; label: string } {
  const now = new Date();
  const m = now.getMonth() + 1;
  const season = m <= 3 ? "winter" : m <= 6 ? "spring" : m <= 9 ? "summer" : "autumn";
  const label = m <= 3 ? "冬" : m <= 6 ? "春" : m <= 9 ? "夏" : "秋";
  return { year: now.getFullYear(), season, label };
}

export function GET() {
  const { year, season, label } = currentSeason();
  const body = `# アニメ視聴ガイド

> シーズンごとの日本のTVアニメを、国内のどの配信サービス（dアニメストア・ABEMA・Netflix・U-NEXT・Prime Video 等）で視聴できるかを一覧できるサイト。配信データは Annict の公開APIからリアルタイムに取得している。

## このサイトでわかること
- ある年・季節（クール）のアニメ作品の一覧
- 各作品を視聴できる国内の配信サービス
- 各作品のあらすじ・声優・監督・製作会社・原作（一部作品は編集部が公式サイト等の一次情報を確認して掲載）
- 各作品の初回放送/配信の曜日・時刻の目安（カレンダー表示）

## 主要ページ
- [トップページ](${siteUrl}/): 現在のクールの作品一覧・検索・配信サービス別の絞り込み
- [${year}年${label}アニメ 配信情報一覧](${siteUrl}/season/${year}/${season}): 今クールのシーズン別ページ（作品ごとの個別ページへリンク）
- 作品個別ページ: ${siteUrl}/anime/{Annictの作品ID} — 作品のあらすじ・配信サービス・声優・監督・製作会社・原作を掲載
- [更新履歴フィード (RSS)](${siteUrl}/feed.xml)
- [サイトマップ](${siteUrl}/sitemap.xml)

## データについて
- 配信情報の元データは Annict（コミュニティ更新ベース）のため網羅率は100%ではなく、新作は配信欄が反映待ちになることがある。
- あらすじ・見どころ・出版社は各作品の公式サイト等の一次情報を確認して掲載しており、各作品ページに参照元を明記している。
- 引用・要約する際は、配信状況が変わりうる点に留意し、視聴前に各サービスの最新情報を確認するよう案内することが望ましい。
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // ページビューほど頻繁に変わらないので長めにキャッシュ。
      "Cache-Control": "public, max-age=0, s-maxage=86400",
    },
  });
}
