import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getWorkData } from "@/lib/getWorkData";
import { getSeasonData } from "@/lib/getSeasonData";
import { splitRentalServices, getServiceKana, sortServicesForMetadata } from "@/lib/services";
import { buildWorkTitle } from "@/lib/workTitle";
import { seasonKeyForMonth, SEASON_LABEL } from "@/lib/resolveSeasonParams";
import {
  airingStatus,
  jstToday,
  buildWatchAnswer,
  buildWatchDescription,
  availabilityLabel,
  buildStreamingProperties,
  buildDataProvenance,
} from "@/lib/workAvailability";
import { PERSON_PAGE_MIN_APPEARANCES } from "@/lib/personPage";
import { hasCreditPage, type StudioIndex } from "@/lib/studioIndex";
import studioIndexJson from "@/content/archive/studios.json";
import { WORK_DETAILS } from "@/content/works";
import { WORK_IMAGE_IDS } from "@/content/works/imageIds";
import { RENTAL_SERVICES } from "@/content/works/rentalServices";
import { seriesFor } from "@/content/works/series";
import FollowLinks from "@/components/FollowLinks";
import ServiceMarks from "@/components/ServiceMarks";
import EmbedSnippet from "@/components/EmbedSnippet";
import { buildEmbedSnippet, buildEmbedIframeSnippet } from "@/lib/embed";

const STUDIO_INDEX = studioIndexJson as unknown as StudioIndex;

const AI_IMAGE_NOTE = "AIがタイトルのみから独断と偏見で作成した画像です。本作品との関連性はありません。";

const WEEKDAY_SHORT = ["日", "月", "火", "水", "木", "金", "土"];

// "YYYY-MM-DD"（JSTの日付）→「2026年8月28日(金)」。
// 曜日は Date.UTC で「日付そのもの」として組み立てて求める
// （`new Date("2026-08-28T00:00:00+09:00")` をUTCで読むと前日になり曜日が1日ずれる）。
function formatJpDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${y}年${m}月${d}日(${wd})`;
}

import { siteUrl } from "@/lib/siteUrl";

type Params = { id: string };

// 作品ページのISR（2026-07-21にトップページへ入れたのと同じ考え方・2026-07-27導入）。
// これ以前はrevalidate未指定＝毎リクエストで動的描画しており、本番の実測でも
// x-vercel-cache: MISS が続き0.42〜0.82秒（Annictのデータキャッシュが切れた直後は数秒）
// サーバー側で待たされていた。App Routerのクライアント遷移はこの間まったく画面が
// 変わらないため、スマホでは「タップしたのに進まない」ように見えていた。
// 放送中の配信情報は分単位で変わるものではないので、ページHTMLごとエッジに載せる。
// 15分はgetSeasonDataのキャッシュ（900s）と揃えてある。
// 効果（ローカル本番ビルド実測）: 初回0.81秒 → 2回目以降0.010秒（x-nextjs-cache: HIT）。
export const revalidate = 900;

// generateStaticParams が無いと revalidate を書いてもルートが prerender-manifest に
// 載らず、毎リクエスト動的描画のまま（実測: ビルド出力で /anime/[id] だけ ƒ のままで
// manifest の dynamicRoutes に現れない）。空配列を返して「ビルド時には1件も焼かないが、
// アクセスされたIDから順にISRキャッシュに載せる」構成にする。作品数は数千件あるので
// ビルド時に全部焼くのは現実的でなく、実際にタップされたものだけキャッシュすれば足りる。
//
// 副次効果（Next.jsの仕様。実機での計測は未実施）: ルートが静的扱い（ビルド出力の ●）に
// なると <Link> が画面内に入ったカードのRSCペイロードを先読みするようになる。動的ルートの
// ままだと loading.tsx が無い限り一切先読みしないので、この点でも体感が変わるはず。
//
// なお、ここに loading.tsx を置くとタップ直後に骨組みを出せるが、ストリーミングで
// ヘッダが先に確定するため notFound() が 404 ではなく 200（ソフト404）で返るように
// なる（実測: /anime/88888888 の .meta が status:200 になり、loading.tsx を消すと
// 404 に戻る）。存在しない作品IDが200で返るのは検索エンジンに対して有害なので、
// loading.tsx は置かず、ISR＋先読みで速さを担保する方針にした。
export async function generateStaticParams() {
  return [];
}

// Annictから取れなかったときに返すメタデータ（2026-08-05追加）。
// 作品が存在しない場合は下のページ本体が notFound() を呼ぶので404になるが、
// Annict側の障害・トークン切れの場合はページ本体が「データを取得できませんでした」を
// **HTTP 200で**返す。何もしないとレイアウトの robots: { index: true } を継いで
// このエラー画面がそのまま索引に載りうるので、明示的に noindex にしておく。
// （このプロジェクトは loading.tsx を置かない判断もソフト404を避けるためで、同じ考え方。）
const UNAVAILABLE_METADATA: Metadata = { robots: { index: false, follow: false } };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return UNAVAILABLE_METADATA;

  let item;
  try {
    item = await getWorkData(id);
  } catch {
    item = null;
  }
  if (!item) return UNAVAILABLE_METADATA;

  const { streaming } = splitRentalServices(item.services, RENTAL_SERVICES[item.id]);
  // 2026-07-26のSearch Console実測では、表示回数を集めているクエリが
  // 「{作品名} 第二期 ユーネクスト」「{作品名} 配信」のように「どこで見られるか」を
  // 直接問う形だった（平均掲載順位19.8位＝2ページ目、上位ページはCTR 0%）。
  // titleを「〜の配信状況」から検索語に近い「〜はどこで配信？」に寄せ、
  // 主要な配信サービス名を前方に置いてスニペットでの一致を上げる。
  // Annict由来の並び順は作品ごとにばらつく（先頭がFOD等になり、実際に検索されている
  // 主要サービスがtitleから漏れる）ため、実クエリの多い順（sortServicesForMetadata）に揃える。
  const serviceShorts = sortServicesForMetadata(streaming).map((s) => s.short);
  // 検索結果で切り捨てられない幅に収める（buildWorkTitle のコメント参照）。
  const title = buildWorkTitle(item.title, serviceShorts);
  // 配信が1件も無い作品に「配信中」と読める説明文を出すと誤誘導になるため、
  // 「まだ確認できていない」と正直に書く（CLAUDE.mdの推測で埋めない方針と同じ）。
  const descServices =
    serviceShorts.slice(0, 5).join("・") + (serviceShorts.length > 5 ? "ほか" : "");
  // 劇場公開日が判明している作品（＝配信がまだ無い劇場作品が大半）は、公開日を
  // description の先頭に出す。「{作品名} 公開日」は劇場作品で最も検索される問いで、
  // 配信の有無だけを書いた説明文よりスニペットが検索意図に一致する。
  const releaseLead = item.releaseDate ? `${formatJpDate(item.releaseDate.date)}劇場公開。` : "";
  // 放送が終わったクールの作品に「配信している」と現在形で書かない（lib/workAvailability.ts）。
  // Annictのデータは放送当時の番組表であって、いま配信中である確認ではない。
  const status = airingStatus(item.broadcastStartDate ?? item.releaseDate?.date ?? null, jstToday());
  const description = serviceShorts.length
    ? buildWatchDescription({ title: item.title, descServices, releaseLead, status })
    : `${releaseLead}「${item.title}」の配信サービスは現時点で確認できていません。判明し次第このページに反映します。今期アニメの配信状況はアニメ視聴ガイドで確認できます。`;
  const url = `${siteUrl}/anime/${id}`;

  return {
    // absolute にしてレイアウトの template（"%s | アニメ視聴ガイド"）を効かせない。
    // ブランド名は全角11文字ぶん幅を食うのに、「{作品名} 配信」で探している人に対する
    // 関連性は持たない（サイト名は検索結果でtitleとは別に表示される）。
    // その11文字を実際に検索されている配信サービス名に使う。
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

// 「作品名 配信」のようなロングテール検索の受け皿になる、作品単位の個別ページ。
// サーバーコンポーネントとして完全にHTML化するため、クロール・共有カード双方で
// 内容がそのまま見える。
export default async function AnimeDetailPage({ params }: { params: Params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let item;
  try {
    item = await getWorkData(id);
  } catch (e) {
    return (
      <div className="wrap">
        <div className="state error">
          <h2>データを取得できませんでした</h2>
          <p>{e instanceof Error ? e.message : "取得に失敗しました。"}</p>
        </div>
      </div>
    );
  }
  if (!item) notFound();

  const content = WORK_DETAILS[item.id];
  const { credits } = item;

  // 生成AI検索・検索エンジンに作品の事実（あらすじ・声優・監督・製作会社・原作・配信先）を
  // 機械可読な形で渡すための構造化データ（JSON-LD）。人手で用意したあらすじがあればそれを、
  // 無ければ配信サービス一覧から生成した説明文を description に入れる。
  // レンタル/都度課金扱いのサービスは「配信中（見放題）」から除外し、別枠で扱う。
  const { streaming: streamingServices, rental: rentalServices } = splitRentalServices(
    item.services,
    RENTAL_SERVICES[item.id]
  );
  const serviceNames = [...streamingServices.map((s) => s.short), ...item.otherServices];
  // 点線バッジ（Annict未登録・公式サイト/報道記事で人力確認）の出典。バッジ内には置かず
  // （2026-07-28の誤タップ事故対応）、「配信情報の確認日」の下に簡略表示で1回だけ出す。
  const manualSources = streamingServices.filter((s) => s.manualSourceUrl);
  // 検索する人はサービス名をカタカナで書くことが多い（2026-07-26のSearch Console実測で
  // 「ユーネクスト」「ネットフリックス」を含むクエリが表示回数の上位を占めていた）。
  // ページ内に英字表記しか無いとこの表記ゆれを拾えないため、FAQの回答文でだけ
  // 「U-NEXT（ユーネクスト）」と一度併記する（title・descriptionには入れず、詰め込みはしない）。
  const serviceLabels = [
    ...streamingServices.map((s) => {
      const kana = getServiceKana(s.key);
      return kana ? `${s.short}（${kana}）` : s.short;
    }),
    ...item.otherServices,
  ];
  // 配信情報はAnnictからライブ取得（revalidateの範囲）なので、取得日を鮮度シグナルとして出す。
  // JSTの日付にする（toISOString()はUTCのため、JSTの朝9時までは前日の日付になってしまう）。
  const checkedDate = jstToday();
  // 放送が終わったクールの作品は「いま配信中」と断定しない（lib/workAvailability.ts の
  // 冒頭コメント参照）。Annictのprogramsは放送当時の番組表であって、現在の配信可否の
  // 確認ではないため、過去作に現在形を使うと未確認の主張になる。
  const status = airingStatus(
    item.broadcastStartDate ?? item.releaseDate?.date ?? null,
    checkedDate
  );
  const jsonLdDescription =
    content?.synopsis ||
    (serviceNames.length > 0
      ? status === "finished"
        ? `「${item.title}」の配信情報（${serviceNames.join("・")}）。${checkedDate}時点のAnnictデータ。`
        : `「${item.title}」は ${serviceNames.join("・")} で配信中。`
      : `「${item.title}」の配信状況をアニメ視聴ガイドで確認できます。`);
  const workLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": item.media === "MOVIE" ? "Movie" : "TVSeries",
    name: item.title,
    url: `${siteUrl}/anime/${id}`,
    inLanguage: "ja",
    description: jsonLdDescription,
  };
  if (credits.casts.length > 0) {
    workLd.actor = credits.casts.map((c) => ({
      "@type": "Person",
      name: c.personName,
      ...(c.characterName ? { characterName: c.characterName } : {}),
    }));
  }
  if (credits.director) {
    workLd.director = { "@type": "Person", name: credits.director };
  }
  if (credits.productionCompany) {
    workLd.productionCompany = { "@type": "Organization", name: credits.productionCompany };
  }
  if (credits.originalCreators.length > 0) {
    workLd.author = credits.originalCreators.map((name) => ({ "@type": "Person", name }));
  }
  if (content?.publisher) {
    workLd.publisher = { "@type": "Organization", name: content.publisher };
  }
  if (content?.sourceUrl) {
    workLd.sameAs = content.sourceUrl;
  }
  // 劇場公開日（人力補完。content/works/releaseDates.ts）。Annictは劇場公開日を持たず
  // （GraphQLに該当フィールドが無く、REST v1のreleased_onも新作映画では空）、programsも
  // 0件のため、これが無いと劇場作品のページには日付が一切出ない。一次情報で確認できた
  // 作品にだけ入る。
  const release = item.releaseDate ?? null;

  workLd.dateModified = checkedDate;
  if (release) {
    // schema.org の Movie/TVSeries が持つ公開日。生成AI・検索エンジンに
    // 「いつ公開か」を機械可読な形で渡す。
    workLd.datePublished = release.date;
  }

  // 「どこで配信されているか」を機械可読にする（2026-08-13追加）。
  // ここまでの JSON-LD は声優・監督・製作会社・原作者を持っていたのに、このサイトの
  // 中心的な事実である配信先だけは可視テキスト（watchAnswer・FAQPage）にしか無く、
  // AI検索・生成AIが読む層から落ちていた。
  // 組み立ては lib/workAvailability.ts に集約する（ここに直書きすると
  // node scripts/check.ts の検査をすり抜ける）。渡すのは表示名だけで URL は渡さない＝
  // **アフィリエイトリンクを混ぜる口が無い**（構造化データは第三者の機械に配られるので、
  // lib/embed.ts と同じ原則が働く）。WatchAction を使わない理由は同ファイルの注記を参照。
  // レンタル（都度課金）と「その他配信」（未正規化の生の名前）は渡さない。
  const streamingProperties = buildStreamingProperties(
    streamingServices.map((s) => ({ name: s.name }))
  );
  if (streamingProperties.length > 0) {
    workLd.additionalProperty = streamingProperties;
  }
  // データの出所（Annict）と、そこから取得した日。「確認日」ではない
  // （誰かが配信の可否を確認した日ではなく、データを取った日）。
  // **作品ノードには混ぜない**。citation は「その作品が参照している著作物」の意味なので、
  // TVSeries に付けると「この作品がAnnictを引用している」という嘘になる（理由は
  // lib/workAvailability.ts の注記）。参照しているのはページなので WebPage ノードで出す。
  const provenanceLd = buildDataProvenance(checkedDate, `${siteUrl}/anime/${id}`);

  // 放送開始日（JST, "YYYY-MM-DD"）から、この作品がどのクールに属するかを逆算する。
  // 「シーズン別ページ」への内部リンクを作ることで、そのクールの他の作品にも
  // 回遊させる（＝シーズンページへの内部被リンクが増え、クロール・回遊双方にプラス）。
  // 放送開始日が未定の作品（broadcastStartDateがnull）はリンクを出さない。
  // 劇場公開作品はprogramsが無く放送開始日も出ないため、公開日をクール逆算にも使う
  // （これが無いと劇場作品だけシーズンページへの内部リンク・パンくずが消える）。
  const seasonBaseDate = item.broadcastStartDate ?? release?.date ?? null;
  const workSeason = seasonBaseDate
    ? (() => {
        const [y, m] = seasonBaseDate.split("-").map(Number);
        const seasonKey = seasonKeyForMonth(m);
        return { year: y, key: seasonKey, label: SEASON_LABEL[seasonKey] };
      })()
    : null;

  // 声優名から /person/[name]/[year]/[season] へのリンクを張るための対象集合。
  // そのクールで2作品以上に出演している声優だけがページ化されている
  // （PERSON_PAGE_MIN_APPEARANCES。lib/personPage.ts参照）ため、それ未満の声優に
  // リンクを張るとリンク切れ（404）になる。ここで同じシーズンのAnnictデータ
  // （getSeasonDataは10分/24時間キャッシュ済みなので追加負荷は小さい）を見て、
  // 実際にページが存在する声優だけを事前に絞り込む。
  const linkableCastNames = new Set<string>();
  // 同じクールの他作品（「関連作品」欄に出す候補）。上の声優リンク判定で既に
  // 取得しているシーズンデータを使い回すので、ここに追加のフェッチは発生しない。
  let seasonItems: Awaited<ReturnType<typeof getSeasonData>>["items"] = [];
  if (workSeason) {
    try {
      const seasonData = await getSeasonData(String(workSeason.year), workSeason.key);
      seasonItems = seasonData.items;
      const counts = new Map<string, number>();
      for (const it of seasonData.items) {
        for (const castName of it.castNames) counts.set(castName, (counts.get(castName) ?? 0) + 1);
      }
      for (const [castName, count] of counts) {
        if (count >= PERSON_PAGE_MIN_APPEARANCES) linkableCastNames.add(castName);
      }
    } catch {
      // 取得に失敗しても声優名をプレーンテキストで出すだけなので、ページ全体は壊さない。
    }
  }

  // シリーズの他の作品（2026-08-11追加）。対応表は content/works/series.ts。
  // Annictへの追加取得は発生しない（リポジトリ同梱の静的データのみ）。
  const series = seriesFor(id);
  const seriesOthers = series ? series.works.filter((w) => w.id !== id) : [];

  // 関連作品（2026-08-05追加）。
  // これを入れる前、作品ページから他の作品ページへのリンクは1本も無く、
  // /anime/{id} は完全なリンクの葉だった（出ていく先はトップ・シーズン・声優・公式サイトのみ）。
  // 作品ページ同士が繋がっていないと、内部リンクの評価が作品ページ間を巡らず、
  // 利用者も「この作品はここに無かった」で離脱して終わる。
  // 並びは「同じ声優が出ている作品」を優先し、同点なら注目度順にする。
  // 声優の重なりは同じ制作座組・同じ客層を指すことが多く、機械的な人気順の羅列より
  // 実際に見に行きたくなる並びになる（＝回遊率が上がり、リンク自体の価値も上がる）。
  const ownCastNames = new Set(credits.casts.map((c) => c.personName));
  const relatedWorks = seasonItems
    .filter((it) => it.id !== item.id)
    .map((it) => ({
      it,
      sharedCasts: it.castNames.filter((n) => ownCastNames.has(n)).length,
    }))
    .sort((a, b) => b.sharedCasts - a.sharedCasts || b.it.watchers - a.it.watchers)
    .slice(0, 8);

  // パンくず（Home → シーズン → 作品名）。AI・検索エンジンにサイト構造を伝える。
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "アニメ視聴ガイド", item: siteUrl },
      ...(workSeason
        ? [
            {
              "@type": "ListItem",
              position: 2,
              name: `${workSeason.year}年${workSeason.label}アニメ`,
              item: `${siteUrl}/season/${workSeason.year}/${workSeason.key}`,
            },
          ]
        : []),
      {
        "@type": "ListItem",
        position: workSeason ? 3 : 2,
        name: item.title,
        item: `${siteUrl}/anime/${id}`,
      },
    ],
  };

  // 「『作品名』はどこで配信されている？」というQ&AをFAQPageとして機械可読にする。
  // これは生成AIに投げられる典型質問で、引用されればそのまま流入につながる。
  const rentalNote =
    rentalServices.length > 0
      ? `${rentalServices.map((s) => s.short).join("・")}ではレンタル（都度課金）での視聴となります。`
      : "";
  const watchAnswer =
    serviceNames.length > 0
      ? buildWatchAnswer({
          title: item.title,
          serviceLabels,
          rentalNote,
          checkedDate,
          status,
        })
      : rentalServices.length > 0
        ? `「${item.title}」は見放題配信は現時点で確認できませんが、${rentalNote}（${checkedDate}時点）`
        : // 劇場公開日が判明している作品は「配信が無い」だけで終わらせず、公開前／公開済みの
          // どちらなのかまで書く（劇場公開前の作品に配信が無いのは当然で、それを伏せると
          // 「取り扱いが無い作品」に見えてしまう）。上映終了は確認できないため「公開中」とは書かない。
          release
          ? `「${item.title}」は${formatJpDate(release.date)}${release.date > checkedDate ? "に劇場公開予定です" : "に劇場公開された作品です"}。配信サービスは現時点でAnnictに登録がなく確認できません（${checkedDate}時点）。判明し次第このページに反映されます。`
          : `「${item.title}」の配信サービスは現時点でAnnictに登録がなく確認できません（${checkedDate}時点）。判明し次第このページに反映されます。`;
  // 「どこで配信？」に加えて、content/works/{id}.json に人力で用意したQ&A
  // （「2期から見ても大丈夫？」「どの順番で見る？」等）も同じFAQPageに載せる。
  // 配信先だけでなく視聴前の判断材料まで1ページで揃うと、検索結果からの離脱が減る。
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `「${item.title}」はどこで配信されている？`,
        acceptedAnswer: { "@type": "Answer", text: watchAnswer },
      },
      // 「{作品名} 公開日」は劇場作品で最も検索される問いのひとつなので、
      // 公開日が確認できている作品にはQ&Aとしても載せる（可視テキストは下の
      // 「劇場公開日」行と対応する）。
      ...(release
        ? [
            {
              "@type": "Question",
              name: `「${item.title}」の劇場公開日はいつ？`,
              acceptedAnswer: {
                "@type": "Answer",
                text: `「${item.title}」の劇場公開日は${formatJpDate(release.date)}です（公式サイト等の発表より、${release.confirmedDate}確認）。公開日は変更されることがあるため、最新情報は公式サイトもご確認ください。`,
              },
            },
          ]
        : []),
      ...(content?.faq ?? []).map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    ],
  };

  return (
    <div className="wrap">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([workLd, provenanceLd, breadcrumbLd, faqLd]),
        }}
      />
      <header className="masthead">
        <span className="eyebrow" aria-hidden="true">
          LINK START :: 作品データ照会
        </span>
        <div className="brandrow">
          <h1 className="brand">{item.title}</h1>
        </div>
        <div className="meta">
          <Link href="/" className="official">
            ← アニメ視聴ガイドのトップに戻る
          </Link>
          {workSeason && (
            <Link href={`/season/${workSeason.year}/${workSeason.key}`} className="official">
              {workSeason.year}年{workSeason.label}アニメ一覧を見る
            </Link>
          )}
        </div>
      </header>

      <div className="detail-page">
        {WORK_IMAGE_IDS.has(item.id) && (
          <figure className="detail-hero">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/works/${item.id}.jpg`} alt="" className="detail-hero-img" />
            <figcaption className="detail-hero-note">※ {AI_IMAGE_NOTE}</figcaption>
          </figure>
        )}
        {/* 「どこで配信されているか」の答えを、あらすじ・声優などの補足情報より先に置く
            （2026-07-27に並びを変更）。このページに来る検索クエリは
            「{作品名} 配信」「{作品名} ユーネクスト」のように視聴先を直接問う形が大半で
            （2026-07-26のSearch Console実測）、答えが下にあるとスマホでは
            あらすじ→見どころ→よくある質問→声優グリッドを全部スクロールしないと届かず、
            戻られてしまう。検索意図に対する答えを最初の画面に入れる。 */}
        <article className="card">
          <div className="card-body">
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px", color: "var(--ink)" }}>
              「{item.title}」はどこで配信されている？
            </h2>
            {/* 劇場公開日（人力補完）。Annictは公開日を持たないため、確認できた作品にだけ出る。
                出典リンクと確認日を必ず添える（延期・変更されうるため）。 */}
            {release && (
              <p className="detail-release">
                劇場公開日: <strong>{formatJpDate(release.date)}</strong>{" "}
                <a href={release.sourceUrl} target="_blank" rel="noopener noreferrer">
                  出典 ↗
                </a>
                <span className="detail-sub">（{release.confirmedDate}確認・変更の可能性あり）</span>
              </p>
            )}
            {/* 見出しの問いに対する答えを、まず1文の可視テキストで返す（2026-07-26追加）。
                以前はバッジだけを置き、回答文はJSON-LD（FAQPage）の中にしか無かったが、
                検索結果のスニペットに使われるのは可視テキストのため、同じ文をここにも出す。
                サービス名の正式名称はバッジ内にも .sr-only で保持している。
                レンタル/都度課金扱いのサービスはここには含めず、下の「レンタル作品」欄に分ける。 */}
            <p style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.7, color: "var(--ink)" }}>
              {watchAnswer}
            </p>
            <ServiceMarks
              services={streamingServices}
              otherServices={item.otherServices}
              hasBroadcastData={item.hasBroadcastData}
            />

            {item.officialSiteUrl && (
              <a
                className="official"
                href={item.officialSiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginTop: 14 }}
              >
                公式サイト ↗
              </a>
            )}
            {/* 「確認日」だと「その日に配信されていることを確認した」と読めてしまうが、
                実際はAnnictからデータを取得した日でしかない（配信の現在の可否は誰も
                確認していない）。放送中の作品でも同じ誤解を招くので、全作品で
                「取得日」と書く。 */}
            <p className="detail-updated">配信情報の取得日: {checkedDate}（Annictより自動取得）</p>
            {manualSources.length > 0 && (
              <p className="svc-manual-note">
                出典:{" "}
                {manualSources.map((s, i) => (
                  <span key={s.key}>
                    {i > 0 && "・"}
                    <a href={s.manualSourceUrl} target="_blank" rel="noopener noreferrer">
                      {s.short}の記事 ↗
                    </a>
                  </span>
                ))}
              </p>
            )}
          </div>
        </article>

        {rentalServices.length > 0 && (
          <article className="card">
            <div className="card-body">
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px", color: "var(--ink)" }}>
                レンタル作品
              </h2>
              <p className="detail-text" style={{ margin: "0 0 10px" }}>
                以下のサービスでは「見放題」ではなく、レンタル（都度課金）での視聴となります。
              </p>
              <ServiceMarks services={rentalServices} otherServices={[]} hideDisclosure />
            </div>
          </article>
        )}

        {(content || credits.casts.length > 0 || credits.director || credits.productionCompany || credits.originalCreators.length > 0) && (
          <article className="card">
            <div className="card-body detail-body">
              {content && (
                <>
                  <section className="detail-section">
                    <h2 className="detail-heading">あらすじ</h2>
                    <p className="detail-text">{content.synopsis}</p>
                  </section>
                  <section className="detail-section">
                    <h2 className="detail-heading">見どころ</h2>
                    <ul className="detail-list">
                      {content.highlights.map((h, i) => (
                        <li key={i}>{h}</li>
                      ))}
                    </ul>
                  </section>
                  {content.faq && content.faq.length > 0 && (
                    <section className="detail-section">
                      <h2 className="detail-heading">よくある質問</h2>
                      <div className="detail-faq">
                        {content.faq.map((f, i) => (
                          <div key={i}>
                            <h3 className="detail-faq-q">{f.question}</h3>
                            <p className="detail-text">{f.answer}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}

              {credits.casts.length > 0 && (
                <section className="detail-section">
                  <h2 className="detail-heading">声優</h2>
                  {/* 人数が多いので2〜3列のグリッドで縦を抑える。役名は声優名の上に小さく置き、
                      1行に詰め込まず可読性を確保する。 */}
                  <ul className="detail-cast-grid">
                    {credits.casts.map((c, i) => (
                      <li key={i} className="detail-cast">
                        {c.characterName && <span className="detail-cast-role">{c.characterName}</span>}
                        {workSeason && linkableCastNames.has(c.personName) ? (
                          <Link
                            href={`/person/${encodeURIComponent(c.personName)}/${workSeason.year}/${workSeason.key}`}
                            className="detail-cast-name"
                          >
                            {c.personName}
                          </Link>
                        ) : (
                          <span className="detail-cast-name">{c.personName}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* 監督・製作会社は、横断ページ（/director/[name]・/studio/[name]）が
                  ある名前だけリンクにする。索引（content/archive/studios.json）は
                  2作品以上の名前しか持たないので、hasCreditPage で門番しないと
                  404へのリンクを配ることになる（声優リンクを
                  PERSON_PAGE_MIN_APPEARANCES で門番しているのと同じ）。
                  sitemapに載せるページはサイト内からも辿れること
                  ＝ここが唯一の入口なので消さないこと（scripts/check.ts の
                  「孤立ページを作らない」節が見張っている）。 */}
              {credits.director && (
                <section className="detail-section">
                  <h2 className="detail-heading">監督</h2>
                  <p className="detail-text">
                    {hasCreditPage(STUDIO_INDEX, "director", credits.director) ? (
                      <Link href={`/director/${encodeURIComponent(credits.director)}`}>
                        {credits.director}
                      </Link>
                    ) : (
                      credits.director
                    )}
                  </p>
                </section>
              )}

              {credits.productionCompany && (
                <section className="detail-section">
                  <h2 className="detail-heading">製作会社</h2>
                  <p className="detail-text">
                    {hasCreditPage(STUDIO_INDEX, "studio", credits.productionCompany) ? (
                      <Link href={`/studio/${encodeURIComponent(credits.productionCompany)}`}>
                        {credits.productionCompany}
                      </Link>
                    ) : (
                      credits.productionCompany
                    )}
                  </p>
                </section>
              )}

              {(credits.originalCreators.length > 0 || content?.publisher) && (
                <section className="detail-section">
                  <h2 className="detail-heading">原作</h2>
                  <p className="detail-text">
                    {credits.originalCreators.length > 0 ? credits.originalCreators.join("、") : "―"}
                    {content?.publisher && <span className="detail-sub">（{content.publisher}）</span>}
                  </p>
                </section>
              )}

              {content?.sourceUrl && (
                <p className="detail-source">
                  参照:{" "}
                  <a href={content.sourceUrl} target="_blank" rel="noopener noreferrer">
                    公式サイト等の情報 ↗
                  </a>
                </p>
              )}
            </div>
          </article>
        )}
        {/* シリーズの他の作品（2026-08-11追加）。
            GSCの実測で、逃げ上手の若君は2期（/anime/14132）が184表示・0クリック・15.9位、
            1期（/anime/10591）は**表示回数ゼロ**で、しかも互いにリンクが1本も無かった。
            同じ作品名の需要を分け合う2ページが繋がっていない状態だったので、双方向に繋ぐ。
            対応表は content/works/series.ts（一次情報・出典明示の人力補完）。
            **放送が終わったシリーズ作品に「いま配信中」とは書かない**（CLAUDE.mdの基本ルール）。
            ここは作品ページへのリンクと、シリーズ内での位置（第1期など）を出すだけにして、
            配信の現在の可否には触れない。 */}
        {series && seriesOthers.length > 0 && (
          <article className="card">
            <div className="card-body">
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px", color: "var(--ink)" }}>
                「{series.title}」シリーズの他の作品
              </h2>
              <ul className="related-works">
                {seriesOthers.map((w) => (
                  <li key={w.id} className="related-work">
                    <Link href={`/anime/${w.id}`} className="related-work-title">
                      {series.title}（{w.label}）
                    </Link>
                    <span className="related-work-sub">配信情報を見る</span>
                  </li>
                ))}
              </ul>
              <p className="related-works-more" style={{ color: "var(--muted)" }}>
                シリーズの構成は{" "}
                <a href={series.sourceUrl} target="_blank" rel="noopener noreferrer">
                  公式サイト
                </a>{" "}
                で確認（{series.confirmedDate}時点）
              </p>
            </div>
          </article>
        )}
        {/* 関連作品（同じクール）。作品ページ同士を繋ぐ唯一の導線なので、
            配信サービスのバッジを添えて「次に見る作品もここで配信先が分かる」ことを
            その場で示す。バッジは出さずサービス名の短縮表記だけを文字で置く
            （ServiceMarksはリンクを持つため、作品ページへ飛ぶこの一覧に入れると
            CLAUDE.mdの「リンクの中に別行き先のリンクを入れない」に反する）。 */}
        {relatedWorks.length > 0 && workSeason && (
          <article className="card">
            <div className="card-body">
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px", color: "var(--ink)" }}>
                {workSeason.year}年{workSeason.label}アニメの他の作品
              </h2>
              <ul className="related-works">
                {relatedWorks.map(({ it, sharedCasts }) => {
                  const names = [...it.services.map((s) => s.short), ...it.otherServices];
                  return (
                    <li key={it.id} className="related-work">
                      <Link href={`/anime/${it.id}`} className="related-work-title">
                        {it.title}
                      </Link>
                      <span className="related-work-sub">
                        {names.length > 0
                          ? `${names.slice(0, 3).join("・")}${names.length > 3 ? `ほか${names.length - 3}件` : ""}で配信`
                          : "配信情報は未登録"}
                        {sharedCasts > 0 && "・共通の出演声優あり"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="related-works-more">
                <Link href={`/season/${workSeason.year}/${workSeason.key}`}>
                  {workSeason.year}年{workSeason.label}アニメの配信情報をすべて見る →
                </Link>
              </p>
              {/* 配信サービス別ページへの導線（2026-08-07追加）。
                  /service/[key]/[year]/[season] はsitemapにしか載っておらず、
                  サイト内リンクがどこにも無い孤立ページだった。
                  「この作品はABEMAか。ABEMAには他に何がある？」という
                  加入判断の流れをそのまま繋ぐ。ここはバッジ列の外なので
                  「バッジの中に別行き先のリンクを入れない」ルールには触れない
                  （文言つきのテキストリンクにしてあり、記号だけのリンクにもしない）。 */}
              {streamingServices.length > 0 && (
                <p className="related-works-more">
                  {streamingServices.map((s, i) => (
                    <span key={s.key}>
                      {i > 0 && " ・ "}
                      <Link href={`/service/${s.key}/${workSeason.year}/${workSeason.key}`}>
                        {s.short}で見られる{workSeason.year}年{workSeason.label}アニメ
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </div>
          </article>
        )}
        {/* 配信先ウィジェットの貼り付けコード（2026-08-06導入）。
            被リンク・外部言及がゼロに近いことが順位（19.8位）のボトルネックという判断で、
            「アニメ感想ブログが記事末に貼りたい情報」を1行で配れるようにした。
            リンク先は自サイトの作品ページのみ（アフィリエイトリンクは入れない）。
            生成は lib/embed.ts、検査は scripts/check.ts。詳細は docs/operations.md ⑯。 */}
        <EmbedSnippet
          title={item.title}
          snippet={buildEmbedSnippet(item)}
          iframeSnippet={buildEmbedIframeSnippet(item)}
        />
      </div>

      <FollowLinks />

      <p className="footnote">
        データ元: Annict（コミュニティ更新ベース）。配信情報は網羅率100%ではなく、
        新作は反映が遅れることがあります。視聴前に各サービスの最新情報もご確認ください。
        「その他配信」は未登録サービスの可能性があり、点線で表示しています。
        {" "}
        <Link href="/developers">配信先ウィジェット・公開API</Link>
        {" ・ "}
        <Link href="/about">運営者情報</Link>
        {" ・ "}
        <Link href="/privacy">プライバシーポリシー・広告掲載について</Link>
      </p>
    </div>
  );
}
