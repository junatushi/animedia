import type { MetadataRoute } from "next";
import { getSeasonData } from "@/lib/getSeasonData";

const siteUrl = "https://animedia-khaki.vercel.app";

function currentSeason(): { year: number; season: string } {
  const now = new Date();
  const year = now.getFullYear();
  const m = now.getMonth() + 1;
  const season = m <= 3 ? "winter" : m <= 6 ? "spring" : m <= 9 ? "summer" : "autumn";
  return { year, season };
}

// ルートURLに加え、現在のシーズンページ・作品個別ページをクロール対象に含める。
// 過去シーズン全件は取得コストが増えるため、まずは「今期」だけを対象にする。
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${siteUrl}/about`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];

  const { year, season } = currentSeason();
  try {
    const data = await getSeasonData(String(year), season);
    entries.push({
      url: `${siteUrl}/season/${year}/${season}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    });
    entries.push({
      url: `${siteUrl}/exclusive/${year}/${season}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.85,
    });
    for (const it of data.items) {
      entries.push({
        url: `${siteUrl}/anime/${it.id}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }

    // サービス別ページ（/service/[key]/[year]/[season]）は、実際にそのシーズンで
    // 配信作品があるサービスだけをサイトマップに含める（0件の薄いページを登録しない）。
    // ページ自体は見放題・レンタルの両方を含めて表示するため、ここでの集計も両方見る。
    const serviceKeys = new Set<string>();
    for (const it of data.items) {
      for (const s of it.services) serviceKeys.add(s.key);
    }
    for (const key of serviceKeys) {
      entries.push({
        url: `${siteUrl}/service/${key}/${year}/${season}`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  } catch {
    // Annictから取得できない場合はルートURLのみのサイトマップにフォールバックする
  }

  return entries;
}
