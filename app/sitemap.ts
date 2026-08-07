import type { MetadataRoute } from "next";
import { getSeasonData } from "@/lib/getSeasonData";
import ARCHIVE_INDEX from "@/content/archive/index.json";

import { siteUrl } from "@/lib/siteUrl";

// sitemap自体の再生成間隔。過去クール分（約2,000URL）を載せるようになったため、
// リクエストのたびに組み立て直さないよう明示する。中身の大半は
// スナップショット由来で動かないので1時間で十分。
export const revalidate = 3600;

// 過去クールの「勢力図・ランキング」「独占配信まとめ」をsitemapに載せる下限作品数。
// 集計ページとして読める母数の目安（下の該当箇所のコメント参照）。
const RANKING_MIN_WORKS = 20;

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
// lastModified の付け方（2026-08-07に見直し）
//
// それまでは「今日の日付」を、内容が何ヶ月も動いていない /about・/privacy・/developers や、
// 今期の全作品ページ（約250件）にまで毎日付けていた。これは事実ではない。
// Googleは lastmod を「一貫して正確なときだけ」使い、正確でないと判断すると
// **サイトの lastmod を丸ごと無視する**（Search Central のサイトマップ解説／
// Gary Illyes「lastmodが不正確なら付けない方がまし」2026-07-16）。
// つまり嘘の lastmod は、本当に毎日変わるページの鮮度シグナルまで道連れにする。
//
// そこで「その日のうちに中身が実際に変わりうるページ」だけに付ける:
//   - トップ / 今期のシーズン・独占・ランキング … Annictから再取得した結果が
//     そのまま反映される集計ページ。配信サービスの追加が日々起こりうる。
// 付けないもの:
//   - /about・/privacy・/developers … 正確な更新日を持っていないので申告しない
//   - 個別の作品ページ … 大半は日々変わらない。250件全部に「今日更新」は嘘になる
//   - 過去クール … 放送終了済みで動かない（従来どおり）
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
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${siteUrl}/privacy`,
      changeFrequency: "monthly",
      priority: 0.2,
    },
    // 配信先ウィジェット・公開APIの案内（2026-08-06追加）。外部から貼る/使う人が
    // 条件を確認する先であり、被リンクを受ける入口としても機能させたいので載せる。
    {
      url: `${siteUrl}/developers`,
      changeFrequency: "monthly",
      priority: 0.4,
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
    // 過去クールの「配信サービス勢力図・ランキング」と「独占配信まとめ」（2026-08-07追加）。
    //
    // これらは今期ぶんしかsitemapに載せていなかったが、実装は年季を問わず動き、
    // 過去年はスナップショット由来なので0.03秒級で開く（＝64クール×2＝128ページが
    // 存在するのに検索エンジンから見えていなかった）。
    // 中身は「2015年春アニメはdアニメストアが何本でシェア何%」のような集計で、
    // 他所が公開していない独自データにあたる。統計・数値を含むページはAI検索の
    // 引用率が上がる（Princeton発のGEO研究で統計の追加により可視性が最大40%向上）ほか、
    // 独自データは被リンクを最も集めやすいコンテンツ類型でもある。
    // このサイトの最大の弱点が被リンクゼロであることを踏まえ、既にあるものを見せる。
    //
    // シーズンページ本体からは以前からフッターでリンクしているので、リンク切れの
    // 心配は無い（クロール経路が sitemap にも増えるだけ）。
    //
    // ただし配信データのある作品が少ないクールは載せない。Annictの登録は古いクールほど
    // 薄く、実測で64クール中13クールは配信ありの作品が0件、25クールは10件未満しかない。
    // 「3作品の勢力図」は集計として意味を成さず、薄いページを大量に送ると
    // サイト全体の品質評価を下げうる（ヘルプフルコンテンツ系はサイト単位のシグナル）。
    // 集計として読めるだけの母数がある年季（RANKING_MIN_WORKS件以上）に絞る。
    if (s.workIds.length >= RANKING_MIN_WORKS) {
      entries.push({
        url: `${siteUrl}/rankings/${s.year}/${s.season}`,
        changeFrequency: "yearly",
        priority: 0.35,
      });
      entries.push({
        url: `${siteUrl}/exclusive/${s.year}/${s.season}`,
        changeFrequency: "yearly",
        priority: 0.35,
      });
    }
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
