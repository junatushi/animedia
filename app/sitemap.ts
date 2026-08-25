import type { MetadataRoute } from "next";
import { getSeasonData } from "@/lib/getSeasonData";
import ARCHIVE_INDEX from "@/content/archive/index.json";
import STUDIO_INDEX from "@/content/archive/studios.json";
import { PERSON_PAGE_MIN_APPEARANCES } from "@/lib/personPage";

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
    // 配信先ウィジェット・公開APIの案内（2026-08-06追加）。外部から貼る/使う人が
    // 条件を確認する先であり、被リンクを受ける入口としても機能させたいので載せる。
    {
      url: `${siteUrl}/developers`,
      lastModified: new Date(),
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
      // 閾値は lib/personPage.ts の1箇所だけが持つ（ページ側・作品ページのリンク判定と
      // ズレるとsitemapに404を載せる／載せ漏らすことになるため、数値を直書きしない）。
      if (count < PERSON_PAGE_MIN_APPEARANCES) continue;
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

  // 過去クールの声優ページ（2026-08-11追加 → 2026-08-25に取り下げ）。
  //
  // 【いま載せていない理由】追加の根拠だった「声優ページは突出して強い」という実測は
  // **今期の声優ページ**のものだった。過去クールぶん4,483件が索引に載った直後（08-19〜20）の
  // GSC実測で、声優ページの平均掲載順位が 5.9位 → 47.0位 に崩れ、サイト全体の週次平均も
  // 17.88位 → 24.74位 に悪化した。悪化幅6.86のうち4.77（70%）がこの面由来で、
  // 表示回数の比率は12.2%・クリックへの寄与は1件だけだった。除くと週次平均は19.94位に戻り、
  // クリックは1件も減らない。実測と分析は docs/seo-2026-08-25/facts.md、
  // 判断の理由は lib/personPage.ts のコメントに書いた。
  //
  // ページ自体は残してある（404にしない・follow のまま）ので、そこから過去クールの
  // 作品ページへ渡る内部リンクは生きている。索引に載せるのをやめただけ。
  // 今期の声優ページは上の try 節が今までどおり載せる（サイト最大の資産がそこにある）。
  //
  // 声優の出演作索引そのものは、声優ページの「他のクールの出演作」欄で引き続き使っている。
  // 制作会社ページ・監督ページ（2026-08-12追加）。/studio/[name]・/director/[name]
  //
  // 【なぜ追加するか】content/archive/studios.json（制作会社165社・監督378人）は
  // 2026-08-07に索引だけ作って、ページが無いまま置かれていた。声優ページが実測で
  // 突出して強い（2026-08-08のGSCで平均5.8位・CTR9.5%。作品ページは22.3位・1.3%）ことから、
  // 同じ「人・組織の軸」である監督も見込みがあると考えて面を作った。
  // ただし**監督名・制作会社名での検索需要は未実測**であり、そこは推測。
  // 効果は weeklyByType（面ごとの週次推移）で後から判定する。
  //
  // 収録の基準は声優索引と同じで、索引の時点で絞られている:
  //   ・配信情報が1件以上ある作品だけ（content/archive/index.json と同じ方針）
  //   ・2作品以上の会社・監督だけ（lib/studioIndex.ts の MIN_WORKS。1作品だと
  //     作品ページと中身が同じ薄いページになる）
  // Annictへの追加取得は発生しない（リポジトリ同梱の静的JSONのみ）。
  // ページ側は全件を事前生成しているので、ここに載るURLは必ず200で返る。
  for (const name of Object.keys(STUDIO_INDEX.studios)) {
    entries.push({
      url: `${siteUrl}/studio/${encodeURIComponent(name)}`,
      changeFrequency: "monthly",
      priority: 0.4,
    });
  }
  for (const name of Object.keys(STUDIO_INDEX.directors)) {
    entries.push({
      url: `${siteUrl}/director/${encodeURIComponent(name)}`,
      changeFrequency: "monthly",
      priority: 0.4,
    });
  }

  return entries;
}
