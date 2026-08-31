import type { MetadataRoute } from "next";
import { getSeasonData } from "@/lib/getSeasonData";
import ARCHIVE_INDEX from "@/content/archive/index.json";
import PEOPLE_INDEX from "@/content/archive/people.json";
import STUDIO_INDEX from "@/content/archive/studios.json";
import {
  PERSON_PAGE_MIN_APPEARANCES,
  shouldIndexPersonSeasonPage,
} from "@/lib/personPage";

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

// 次のクール。冬→春→夏→秋→(翌年)冬。
const SEASON_ORDER = ["winter", "spring", "summer", "autumn"];
function nextYearSeason(year: number, season: string): { year: number; season: string } {
  const i = SEASON_ORDER.indexOf(season);
  if (i < 0) return { year, season };
  return i === SEASON_ORDER.length - 1
    ? { year: year + 1, season: SEASON_ORDER[0] }
    : { year, season: SEASON_ORDER[i + 1] };
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
  // 次クール（2026-08-31追加）。
  //
  // 【なぜ要るか】このsitemapは長らく「今期」しか載せていなかった。ところが
  // docs/next-season-coverage.md の実測どおり、放送時期（○年○月）は放送開始の
  // 3〜11ヶ月前・中央値およそ8ヶ月前に判明しており、検索需要はクール開始の約1ヶ月前から
  // 立ち上がる。つまり「9月に2026年秋アニメを探している人」が最も多い時期に、
  // 秋クールのページが検索エンジンに1件も知られていない状態だった
  // （/season/2026/autumn も /anime/{秋の作品} も未送信）。需要の山は年に4回しか来ない。
  //
  // 声優・サービス別ページはここでは載せない。次クールはキャストも配信サービスも
  // まだ埋まっておらず、薄いページを先回りで送ることになるため。作品ページと
  // シーズンページだけにする（中身は autoSchedule の放送予定日で成立している）。
  //
  // 今期の取得が失敗しても次クールは載せたい（逆も同じ）ので try を分ける。
  const next = nextYearSeason(year, season);
  try {
    const nextData = await getSeasonData(String(next.year), next.season);
    entries.push({
      url: `${siteUrl}/season/${next.year}/${next.season}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    });
    for (const it of nextData.items) {
      entries.push({
        url: `${siteUrl}/anime/${it.id}`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.6,
      });
    }
  } catch {
    // 次クールが取れなくても今期・過去クールのsitemapは出す
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

  // 過去年の声優ページ（2026-08-11に4,483件を追加 → 2026-08-31に条件つきへ絞り込み）。
  //
  // 【経緯】追加の根拠だった「声優ページは突出して強い（5.9位・CTR9.5%）」という実測は
  // 今期のページのものだった。過去クールぶんが索引に載ったあと、声優面の平均掲載順位は
  // 38〜40位まで落ちている（08-17週 363表示@38.24位 / 08-24週 316表示@40.02位）。
  //
  // ただし**全部外すのは行き過ぎ**だと実測で分かった。28日のページ別実測で、過去年の
  // 声優ページは37表示・6クリック・平均20.84位を取っている（前野智昭/2017/winter 4.0位、
  // 斉藤壮馬/2024/summer 8.0位、櫻井孝宏/2023/summer 43.5位ほか）。全部外すと
  // 28日あたり4〜6クリック＝全体の5〜7%を確実に失う。
  //
  // そこで「今年のクールは全部／過去年は出演作の多い声優だけ」に絞る。判定は
  // lib/personPage.ts の shouldIndexPersonSeasonPage が1箇所で持ち、ページ側の
  // noindex 判定とここが必ず同じ答えを出すようにする（ズレるとsitemapに noindex の
  // URLを載せることになる）。約4,483 → 約2,374件。
  // 実測と経緯は docs/seo-2026-08-25/ と docs/operations.md の㉟。
  //
  // 収録の基準（上の絞り込みに加えて、従来どおり）:
  //   ・そのクールに PERSON_PAGE_MIN_APPEARANCES 作品以上出ている人だけ
  //   ・people.json 自体が「配信情報が1件以上ある作品」だけで作られている
  // 声優名には空白を含むもの（例: "田中理恵 (声優)"）があるため、キー文字列を
  // 後から split で3つ組に戻すことはしない。値のほうに元の値を持たせる。
  const personCounts = new Map<
    string,
    { name: string; year: number; season: string; count: number }
  >();
  for (const [name, works] of Object.entries(PEOPLE_INDEX.people)) {
    // 索引に載っているその人の総出演数＝知名度の代理指標。上のクリックを取っている
    // 4人は 83 / 98 / 70 / 97 作品なので、閾値50なら全員残る。
    const totalWorks = works.length;
    for (const w of works) {
      const workYear = w[2] as number;
      const workSeason = w[3] as string;
      // 今期は上の try 節が担当するので二重登録しない。
      if (workYear === year && workSeason === season) continue;
      if (!shouldIndexPersonSeasonPage(workYear, totalWorks)) continue;
      const key = `${workYear}/${workSeason}/${name}`;
      const cur = personCounts.get(key);
      if (cur) cur.count++;
      else personCounts.set(key, { name, year: workYear, season: workSeason, count: 1 });
    }
  }
  for (const p of personCounts.values()) {
    if (p.count < PERSON_PAGE_MIN_APPEARANCES) continue;
    entries.push({
      url: `${siteUrl}/person/${encodeURIComponent(p.name)}/${p.year}/${p.season}`,
      changeFrequency: "yearly",
      priority: 0.4,
    });
  }
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
