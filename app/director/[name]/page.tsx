import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { CreditPage } from "@/components/CreditPage";
import { creditPageTitle, creditPageDescription } from "@/lib/pageMeta";
import { titleText } from "@/lib/pageTitle";
import { creditMap, creditWorks, type StudioIndex } from "@/lib/studioIndex";
import studioIndexJson from "@/content/archive/studios.json";

// 監督ページ（2026-08-12導入）。/director/[name]
// 設計の理由は app/studio/[name]/page.tsx のコメントと共通（静的JSONだけで完結する・
// クールで割らない・全件事前生成・loading.tsx を置かない）。中身は
// components/CreditPage.tsx が持つ。

const INDEX = studioIndexJson as unknown as StudioIndex;

type Params = { name: string };

export function generateStaticParams(): Params[] {
  return Object.keys(creditMap(INDEX, "director")).map((name) => ({
    name: encodeURIComponent(name),
  }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const name = decodeURIComponent(params.name);
  const works = creditWorks(INDEX, "director", name);
  if (works.length === 0) return {};

  const title = creditPageTitle("director", name);
  const description = creditPageDescription("director", name, works.length);
  const url = `${siteUrl}/director/${encodeURIComponent(name)}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title: titleText(title), description, url, type: "website" },
    twitter: { card: "summary_large_image", title: titleText(title), description },
  };
}

export default function DirectorPage({ params }: { params: Params }) {
  const name = decodeURIComponent(params.name);
  const works = creditWorks(INDEX, "director", name);
  if (works.length === 0) notFound();

  return <CreditPage role="director" name={name} works={works} />;
}
