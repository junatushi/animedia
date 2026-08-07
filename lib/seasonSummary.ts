// ───────────────────────────────────────────────────────────────
// シーズンページ（/season/{year}/{season}）の冒頭に置く「そのクールの要約」。
//
// なぜ要るか（2026-08-07）:
//   シーズンページは h1 のあとがいきなり絞り込みUIと作品カードの並びで、
//   **文章が1文も無かった**。64クールぶんのページが、機械から見ると
//   「見出し＋作品名のリスト」でしか区別できない状態だった。
//
//   一方このサイトは、他所がまず持っていないデータを既に手元に持っている:
//   「そのクールの作品のうち、どの配信サービスが何本カバーしていたか」。
//   実測では2025年の各クールでdアニメストア1社が74〜82%をカバーし、
//   1社独占は13〜21作品しかなかった、といった数字が出る。
//
//   2025〜2026年の実測研究では、統計・数値を含むページはAI検索での可視性が
//   最大40%上がり（Princeton発のGEO研究, KDD 2024）、独自データは
//   被リンクを最も集めやすいコンテンツ類型とされる。このサイトの最大の弱点は
//   被リンクがほぼゼロであることなので、既に持っている数字を文章にして出す。
//
//   ハブ＆スポーク構造でも「ハブページ自体に説明文を置き、単なるリンク集に
//   しない」ことが効果の条件とされている。
//
// 方針:
//   - 数字はすべて実データから算出する。推測・創作はしない（CLAUDE.md）。
//   - 放送が終わったクールに「配信している」と現在形を使わない
//     （lib/workAvailability.ts と同じ理由。Annictのデータは当時の番組表であって
//     現在の配信可否ではない）。
//
// 素の .ts に置いてあるのは scripts/check.ts から import して検査するため。
// ───────────────────────────────────────────────────────────────

import type { AnimeItem, ServiceTag } from "./types.ts";
import { splitRentalServices } from "./services.ts";
import type { AiringStatus } from "./workAvailability.ts";

export interface SeasonServiceShare {
  name: string;
  count: number;
  // そのクールの「配信サービスが1件以上ある作品」に対する割合（%、小数点以下切り捨て）。
  share: number;
}

export interface SeasonSummary {
  total: number;
  // 見放題の配信サービスが1件以上ある作品数。
  withStreaming: number;
  // 見放題カバー本数の多い順（上位3件）。
  topServices: SeasonServiceShare[];
  // 見放題が1社だけの作品数（＝独占配信）。
  exclusiveCount: number;
}

export function buildSeasonSummary(
  items: AnimeItem[],
  rentalKeysFor: (id: number) => string[] | undefined
): SeasonSummary {
  const counts = new Map<string, { tag: ServiceTag; count: number }>();
  let withStreaming = 0;
  let exclusiveCount = 0;

  for (const it of items) {
    const { streaming } = splitRentalServices(it.services, rentalKeysFor(it.id));
    if (streaming.length === 0) continue;
    withStreaming++;
    if (streaming.length === 1) exclusiveCount++;
    for (const s of streaming) {
      const cur = counts.get(s.key);
      if (cur) cur.count += 1;
      else counts.set(s.key, { tag: s, count: 1 });
    }
  }

  const topServices = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((c) => ({
      name: c.tag.name,
      count: c.count,
      share: withStreaming > 0 ? Math.floor((c.count / withStreaming) * 100) : 0,
    }));

  return { total: items.length, withStreaming, topServices, exclusiveCount };
}

// 要約を1〜2文の日本語にする。放送が終わったクールでは現在形で断定しない。
export function buildSeasonSummaryText(params: {
  year: string | number;
  label: string;
  summary: SeasonSummary;
  status: AiringStatus;
}): string {
  const { year, label, summary, status } = params;
  const { total, withStreaming, topServices, exclusiveCount } = summary;
  if (total === 0) return "";

  const head = `${year}年${label}アニメは全${total}作品です。`;
  if (withStreaming === 0 || topServices.length === 0) {
    // 配信データが1件も無いクール（古いクールに実在する）。
    // 「配信されていない」と書くのは未確認なので、データが無いとだけ述べる。
    return `${head}このクールは見放題配信の登録データがまだありません。`;
  }

  const ranked = topServices
    .map((s, i) => `${i + 1}位が${s.name}（${s.count}作品・${s.share}%）`)
    .join("、");

  // 「カバー率」の母数は「見放題データがある作品」であることを明示する
  // （全作品を母数にした割合だと、未登録作品のぶん一律に低く見えて誤解を招く）。
  return status === "finished"
    ? `${head}このうち見放題の配信データがあるのは${withStreaming}作品で、そのカバー本数は${ranked}でした。見放題が1社だけの独占配信は${exclusiveCount}作品です。数値は放送当時のAnnictデータに基づくもので、現在の配信状況は各サービスでご確認ください。`
    : `${head}このうち見放題で配信されているのは${withStreaming}作品で、そのカバー本数は${ranked}です。見放題が1社だけの独占配信は${exclusiveCount}作品あります。`;
}

// ───────────────────────────────────────────────────────────────
// 配信サービス別ページ（/service/{key}/{year}/{season}）の要約（2026-08-07追加）
//
// なぜ要るか:
//   このページは「dアニメストア 2026年夏アニメ」のようなロングテール検索の受け皿だが、
//   本文は「〜で配信されている作品を人気順でまとめています」という、どのサービス・
//   どのクールでも同じ定型文1つだけだった。サービス数×クール数ぶんのページが、
//   機械から見るとタイトル以外ほぼ同一になる。
//
//   ハブ＆スポーク構造では「ハブページ自体に説明文を置き、単なるリンク集にしない」
//   ことが効果の条件とされている。ここでも実データの数字を出す
//   （統計の追加でAI検索での可視性が最大+40%）。
// ───────────────────────────────────────────────────────────────

export interface ServiceSeasonStats {
  // そのクールの総作品数。
  total: number;
  // 見放題データがある作品数（カバー率の母数）。
  withStreaming: number;
  // このサービスが見放題で配信している作品数。
  count: number;
  // 見放題カバー本数での順位（1始まり）。データが無ければ 0。
  rank: number;
  // 見放題を出しているサービスの総数。
  serviceCount: number;
  // このサービスだけが見放題配信している作品数（独占）。
  exclusiveCount: number;
}

export function buildServiceSeasonStats(
  items: AnimeItem[],
  rentalKeysFor: (id: number) => string[] | undefined,
  serviceKey: string
): ServiceSeasonStats {
  const counts = new Map<string, number>();
  let withStreaming = 0;
  let exclusiveCount = 0;

  for (const it of items) {
    const { streaming } = splitRentalServices(it.services, rentalKeysFor(it.id));
    if (streaming.length === 0) continue;
    withStreaming++;
    if (streaming.length === 1 && streaming[0].key === serviceKey) exclusiveCount++;
    for (const s of streaming) counts.set(s.key, (counts.get(s.key) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const idx = ranked.findIndex(([k]) => k === serviceKey);

  return {
    total: items.length,
    withStreaming,
    count: counts.get(serviceKey) ?? 0,
    rank: idx >= 0 ? idx + 1 : 0,
    serviceCount: ranked.length,
    exclusiveCount,
  };
}

export function buildServiceSummaryText(params: {
  year: string | number;
  label: string;
  serviceName: string;
  stats: ServiceSeasonStats;
  status: AiringStatus;
}): string {
  const { year, label, serviceName, stats, status } = params;
  const { total, withStreaming, count, rank, serviceCount, exclusiveCount } = stats;
  if (total === 0 || count === 0) return "";

  const share = withStreaming > 0 ? Math.floor((count / withStreaming) * 100) : 0;
  const rankText = rank > 0 ? `配信サービス${serviceCount}社中${rank}位` : "";
  const exclusiveText =
    exclusiveCount > 0
      ? `うち${exclusiveCount}作品は${serviceName}だけで見放題配信されている独占作品です。`
      : "";

  // 放送が終わったクールでは現在形で断定しない（このファイル冒頭の方針）。
  return status === "finished"
    ? `${year}年${label}アニメ全${total}作品のうち、${serviceName}での見放題配信データがあるのは${count}作品です。見放題データのある${withStreaming}作品に対するカバー率は${share}%で、${rankText}でした。${exclusiveText}数値は放送当時のAnnictデータに基づくもので、現在の配信状況は${serviceName}でご確認ください。`
    : `${year}年${label}アニメ全${total}作品のうち、${serviceName}で見放題配信されているのは${count}作品です。見放題データのある${withStreaming}作品に対するカバー率は${share}%で、${rankText}です。${exclusiveText}`;
}
