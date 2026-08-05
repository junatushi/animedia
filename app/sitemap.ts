import type { MetadataRoute } from "next";
import { getSeasonData } from "@/lib/getSeasonData";
import ARCHIVE_INDEX from "@/content/archive/index.json";

import { siteUrl } from "@/lib/siteUrl";

// sitemap自体の再生成間隔。過去クール分（約2,000URL）を載せるようになったため、
// リクエストのたびに組み立て直さないよう明示する。中身の大半は
// スナップショット由来で動かないので1時間で十分。
export const revalidate = 3600;

function currentSeason(): { year: number; season: string } {
  const now = new Date();
  const year = now.getFullYear();
  const m = now.getMonth() + 1;
  const season = m <= 3 ? "winter" : m <= 6 ? "spring" : m <= 9 ? "summer" : "autumn";
  return { year, season };
}

// ルートURLに加え、現在のシーズンページ・作品個別ページ、および過去クールの
// シーズンページ・作品ページをクロール対象に含める。
//
// 過去クールを載せる理由（2026-08-05に追加）:
//   /season/{過去年}/{季節} と、そこに並ぶ /anime/{id} は実装としてはすべて存在し、
//   スナップショット（content/snapshots/）のおかげで0.03秒級で開くのに、
//   このsitemapが今期しか載せていなかったため、検索エンジンには1ページも
//   知られていなかった。年・季節の切替はクライアント側の <button> で
//   <a href> が無く、クロールで辿ることもできない状態だった（=64シーズン・
//   8,957作品ページが完全に不可視）。
//   「作品名 配信」系の検索需要は放送中の作品だけでなく旧作にも広くあり、
//   旧作のほうが競合が薄い。既にあるページを見つけてもらうだけで在庫が増える。
//
// ただし全8,957作品を載せることはしない。配信サービスが1件も無い作品ページは
// 「配信情報なし」としか答えられない薄いページで、これを大量に送るとサイト全体の
// 評価を下げうる。content/archive/index.json は「配信1件以上」の作品IDだけを
// 持っており（1,961件。生成は node scripts/build-archive-index.ts）、それを載せる。
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
    {
      url: `${siteUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.2,
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
    entries.push({
      url: `${siteUrl}/rankings/${year}/${season}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.8,
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

    // 声優別ページ（/person/[name]/[year]/[season]）は、今期2作品以上に出演している
    // 声優だけをサイトマップに含める（app/person/.../page.tsx のMIN_APPEARANCESと同じ閾値。
    // 競合が強い領域のため、薄いページを大量に登録して低品質判定されるのを避ける）。
    const castCounts = new Map<string, number>();
    for (const it of data.items) {
      for (const castName of it.castNames) {
        castCounts.set(castName, (castCounts.get(castName) ?? 0) + 1);
      }
    }
    for (const [castName, count] of castCounts) {
      if (count < 2) continue;
      entries.push({
        url: `${siteUrl}/person/${encodeURIComponent(castName)}/${year}/${season}`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.5,
      });
    }
  } catch {
    // Annictから取得できない場合はルートURLのみのサイトマップにフォールバックする
  }

  // 過去クール（content/snapshots/ に確定値があるもの）。今期の取得が失敗しても
  // こちらは静的JSONだけで組めるので、try の外に置いて必ず載せる。
  //
  // lastModified は付けない。放送終了済みで内容が動かないものに毎回「今日更新」と
  // 申告すると鮮度シグナルとして嘘になり、本当に動く今期ページの信頼度まで下げる。
  for (const s of ARCHIVE_INDEX.seasons) {
    // 今期と同じ年季が万一入っていても二重登録しない（年またぎ直後の保険）。
    if (s.year === year && s.season === season) continue;
    entries.push({
      url: `${siteUrl}/season/${s.year}/${s.season}`,
      changeFrequency: "yearly",
      priority: 0.4,
    });
    for (const id of s.workIds) {
      entries.push({
        url: `${siteUrl}/anime/${id}`,
        changeFrequency: "monthly",
        priority: 0.3,
      });
    }
  }

  return entries;
}
