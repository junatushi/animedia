import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { CreditPage } from "@/components/CreditPage";
import { creditPageTitle, creditPageDescription } from "@/lib/pageMeta";
import { titleText } from "@/lib/pageTitle";
import { canPrerenderParam, PREGEN_CANARY_STUDIOS } from "@/lib/staticParams";
import { creditMap, creditWorks, type StudioIndex } from "@/lib/studioIndex";
import studioIndexJson from "@/content/archive/studios.json";

// 制作会社ページ（2026-08-12導入）。/studio/[name]
//
// 【なぜクール別ではないか】声優ページ（/person/[name]/[year]/[season]）はクール別だが、
// あちらは今期のライブ取得（getSeasonData）を使うためクールが必要だった。こちらは
// content/archive/studios.json だけで完結する静的データなので、クールで割る理由が無い。
// 割ると1社あたり十数ページに薄まり、「この制作会社の作品」というまとまりも失われる。
//
// 【なぜ全ページを事前生成するか】データがリポジトリ同梱のJSONだけで、外部APIを
// 一切叩かない。ビルド時に確定するので revalidate も要らない（スナップショットを
// 再生成して studios.json が変わったときに、次のデプロイで作り直される）。
// 声優ページが generateStaticParams を空配列にしているのは4,483件あるためで、
// こちらは165社と少ない。
//
// 索引に無い名前でアクセスされた場合は下で notFound() を返す。**loading.tsx を
// 置かないこと**（ストリーミングでヘッダが先に確定し、404が200＝ソフト404になる。
// app/anime/[id]/page.tsx で実測済み）。

const INDEX = studioIndexJson as unknown as StudioIndex;

type Params = { name: string };

export function generateStaticParams(): Params[] {
  // 【2026-08-31・応急処置】非ASCIIの名前は事前生成に載せない。
  // 本番で日本語名の事前生成ページが全て404になっていた（lib/staticParams.ts に実測）。
  // 外した分はオンデマンドISRで描画され、日本語名でも200を返す。
  const names = Object.keys(creditMap(INDEX, "studio"));
  const params: Params[] = names
    .filter((name) => canPrerenderParam(name))
    .map((name) => ({ name: encodeURIComponent(name) }));

  // 原因究明のカナリア。**エンコードせず生の名前で**焼き、次の本番デプロイで
  // 200になるかを見る（仮説: Vercelはデコード後のパスで静的ファイルを探している）。
  for (const name of PREGEN_CANARY_STUDIOS) {
    if (names.includes(name)) params.push({ name });
  }
  return params;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const name = decodeURIComponent(params.name);
  const works = creditWorks(INDEX, "studio", name);
  if (works.length === 0) return {};

  const title = creditPageTitle("studio", name);
  const description = creditPageDescription("studio", name, works.length);
  const url = `${siteUrl}/studio/${encodeURIComponent(name)}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title: titleText(title), description, url, type: "website" },
    twitter: { card: "summary_large_image", title: titleText(title), description },
  };
}

export default function StudioPage({ params }: { params: Params }) {
  const name = decodeURIComponent(params.name);
  const works = creditWorks(INDEX, "studio", name);
  if (works.length === 0) notFound();

  return <CreditPage role="studio" name={name} works={works} />;
}
