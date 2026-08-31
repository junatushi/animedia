import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { CreditPage } from "@/components/CreditPage";
import { creditPageTitle, creditPageDescription } from "@/lib/pageMeta";
import { titleText } from "@/lib/pageTitle";
import { decodeParamName } from "@/lib/staticParams";
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
  // **名前はエンコードせずに渡す**（2026-08-31。lib/staticParams.ts に経緯）。
  // encodeURIComponent したものを渡すと成果物が `%E3%81%B4….html` というファイル名で
  // 焼かれ、Vercelはデコード後のパスで探すため本番だけ404になる（ローカルでは再現しない）。
  return Object.keys(creditMap(INDEX, "studio")).map((name) => ({ name }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const name = decodeParamName(params.name);
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
  const name = decodeParamName(params.name);
  const works = creditWorks(INDEX, "studio", name);
  if (works.length === 0) notFound();

  return <CreditPage role="studio" name={name} works={works} />;
}
