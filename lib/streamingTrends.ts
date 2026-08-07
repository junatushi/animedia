// ───────────────────────────────────────────────────────────────
// 配信状況の年次推移を、収録精度のバイアスを除いて集計する。
//
// なぜ作るか（2026-08-07 / docs/growth-strategy-2026-08.md の3章・7章）:
//   スナップショット（content/snapshots/）を全作品で集計すると、Annict側の収録が
//   年々良くなっている影響と、実際の市場の変化が区別できない。
//   実際、最初にこの集計を全作品で出したとき「Netflixの掲載率が31〜42%→16〜32%に
//   後退した」という誤った結論が出た。真相は**分母の変化**で、収録が良くなったぶん
//   Netflixに載らない小規模作品が大量に母数へ加わっただけだった。
//
//   そこで各クールの注目度（watchers）上位N作品だけを見る。この層は2021年以降
//   どのクールでも99〜100%が配信情報つきなので、収録精度の向上では差分を説明できない。
//   同じ層で見直すとNetflixは54%→47%のほぼ横ばいで、「後退」は消える。
//
// 【重要・2026-08-07に判明】年をまたぐ「推移」はこのデータでは主張できない。
//   上位N作品への絞り込みが補正できるのは**作品単位**の収録
//   （その作品に配信情報が1件でもあるか）だけで、**サービス単位**の収録
//   （その作品の配信社が漏れなく記録されているか）は補正できていない。
//
//   実例: U-NEXT はスナップショット上2018年から存在するのに、上位30作品での掲載率が
//   2021年=0%, 2022年=10%, 2023年=79% と出る。U-NEXTが2021年にアニメを
//   配信していなかったはずはなく、これはAnnict側の記録漏れである。
//   同じ疑いは ABEMA(21%→94%) にも、1作品あたりの平均配信社数(3.2→9.0)にも掛かる。
//   サービスが記録漏れしていれば、作品は実際より「独占」に見え、社数は少なく出る。
//   つまり「独占が減った」「マルチ配信化した」という向きの結論は、
//   **収録改善だけでも同じ形になる**ので区別できない。
//
//   したがって外向けに使ってよいのは「記録が濃い直近クールの**現状**」だけ。
//   年次の増減を外に出さないこと。currentState() がその用途の入口。
//
// 【この集計を使うときの約束】
//   ・配信率が COVERAGE_FLOOR 未満の年は集計自体が成り立たない（2019〜2020が該当）。
//   ・「Annictに記録された配信社数」であって「実際に配信された社数」ではない。
//     断定的な言い回しを足すときは lib/workAvailability.ts の方針と同じ慎重さで。
//   ・数字を文章に直書きしない。ここから生成する（CLAUDE.md の「件数は実測、
//     手で数えない」＝ scripts/lib/build-digest.js の buildCoverageReport と同じ思想）。
//
// 拡張子つき import なのは `node scripts/check.ts` から直接読めるようにするため。
// ───────────────────────────────────────────────────────────────

// 各クールで見る「常に収録されている層」の作品数。
// 30にしているのは、2021年以降この範囲なら配信率が99〜100%で安定するため。
export const TOP_N = 30;

// この配信率を下回る年は、収録が薄すぎて比較に使えない（2019=53%, 2020=89%）。
export const COVERAGE_FLOOR = 0.95;

export interface TrendWork {
  watchers: number;
  hasBroadcastData: boolean;
  services: { key: string }[];
}

export interface YearTrend {
  year: string;
  // 上位N×クール数のうち、配信情報が1件でもあった作品数の割合。
  coverage: number;
  works: number;
  withServices: number;
  // 配信情報がある作品の、1作品あたり平均配信社数。
  avgServices: number;
  // 配信情報がある作品のうち、見放題が1社だけの割合。
  exclusiveRate: number;
  // サービスkey → 掲載率。
  serviceRate: Record<string, number>;
}

// 1年ぶんの集計。seasons は同じ年の各クールの作品配列。
export function aggregateYear(year: string, seasons: TrendWork[][]): YearTrend {
  let works = 0;
  let withServices = 0;
  let serviceSum = 0;
  let exclusive = 0;
  const serviceHits: Record<string, number> = {};

  for (const items of seasons) {
    const top = items
      .filter((w) => w.hasBroadcastData)
      .sort((a, b) => (b.watchers ?? 0) - (a.watchers ?? 0))
      .slice(0, TOP_N);
    for (const w of top) {
      works++;
      const keys = (w.services ?? []).map((s) => s.key);
      if (keys.length === 0) continue;
      withServices++;
      serviceSum += keys.length;
      if (keys.length === 1) exclusive++;
      for (const k of new Set(keys)) serviceHits[k] = (serviceHits[k] ?? 0) + 1;
    }
  }

  const serviceRate: Record<string, number> = {};
  for (const [k, n] of Object.entries(serviceHits)) {
    serviceRate[k] = withServices ? n / withServices : 0;
  }

  return {
    year,
    works,
    withServices,
    coverage: works ? withServices / works : 0,
    avgServices: withServices ? serviceSum / withServices : 0,
    exclusiveRate: withServices ? exclusive / withServices : 0,
    serviceRate,
  };
}

// 集計が成り立つ年だけを返す（収録が薄すぎる年を落とす）。
// **これを通っても年次比較に使ってよいことにはならない**（冒頭の注意参照）。
export function usableYears(trends: YearTrend[]): YearTrend[] {
  return trends.filter((t) => t.coverage >= COVERAGE_FLOOR);
}

// 外向けに使ってよい唯一の形＝「記録が濃い直近年の現状」。
// 年次の増減ではなく、その年のスナップショットとしてのみ述べる。
export function currentState(trends: YearTrend[]): YearTrend | null {
  const usable = usableYears(trends);
  return usable.length ? usable[usable.length - 1] : null;
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
