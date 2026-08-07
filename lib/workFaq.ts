// ───────────────────────────────────────────────────────────────
// 作品ページの「よくある質問」を、Annictの実データだけから機械的に組み立てる。
//
// なぜ要るか（2026-08-07）:
//   これまで作品ページのQ&Aは「どこで配信？」＋（劇場作品のみ）「公開日は？」の
//   最大2件で、それ以外は content/works/{id}.json に人力で書いた作品だけが持っていた
//   （＝注目作の数件のみ。全作品の維持は続かないため意図的にそうしている）。
//
//   2025〜2026年のAI検索の実測研究では、ページの「形」が引用率を大きく左右する:
//     - 表形式のデータは平文に比べて抽出率が 81% 対 23%（mersel.ai 2026）
//     - Q&A形式は同じ内容の文章より AI可視性 +45%、質問が10件以上あるページは
//       引用可能性 +156%（serps.io 2026 / presenceai.app 2026）
//     - 統計・数値の追加でAI可視性が最大 +40%（Princeton発のGEO研究, KDD 2024）
//   一方で FAQPage のリッチリザルト表示は 2026-05-07 に終了している
//   （Search Engine Journal 2026）。つまり**構造化データのためではなく、
//   可視テキストとして**Q&Aを増やすことに意味がある、という状況になっている。
//
// 方針（CLAUDE.mdの基本ルールをそのまま踏襲する）:
//   - 実データにある事実だけを書く。フィールドが無い質問は**丸ごと出さない**
//     （「不明です」と書くための質問を作らない＝水増しをしない）。
//     Googleは文字数ではなく情報利得を見ており、中身の無い増量は評価されない。
//   - 放送が終わったクールの作品に「いま配信中」と書かない（lib/workAvailability.ts）。
//   - 曜日・時刻は「毎週その曜日にやっている」という前提の表示なので、
//     放送開始日とセットでしか書かない（放送開始1週間前ルールと同じ理由）。
//
// 素の .ts に置いてあるのは scripts/check.ts から import して検査するため
// （NodeはJSXを解釈しないので .tsx からは import できない）。
// ───────────────────────────────────────────────────────────────

import type { AiringStatus } from "./workAvailability.ts";

export interface FaqItem {
  question: string;
  answer: string;
}

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

// "YYYY-MM-DD"（JSTの日付）→「2026年8月28日(金)」。
// 曜日は Date.UTC で「日付そのもの」として組み立てて求める
// （`new Date("2026-08-28T00:00:00+09:00")` をUTCで読むと前日になり曜日が1日ずれる）。
export function formatJpDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${y}年${m}月${d}日(${wd})`;
}

export interface WorkFaqInput {
  title: string;
  // 見放題で配信しているサービスの表示名（正式名称）。
  streamingNames: string[];
  // レンタル（都度課金）扱いのサービスの表示名。
  rentalNames: string[];
  // Annictのチャンネル名のうち、SERVICESに未登録で「その他配信」に落ちたもの。
  otherServices: string[];
  // 放送/配信の開始日（"YYYY-MM-DD", JST）。未定なら null。
  broadcastStartDate: string | null;
  // 初回放送/配信から導出した曜日（0=日〜6=土）と時刻（"23:00"）。無ければ null。
  broadcastWeekday: number | null;
  broadcastTime: string | null;
  // 声優（キャラ名は使わず人物名のみ）。
  castNames: string[];
  director: string | null;
  productionCompany: string | null;
  originalCreators: string[];
  status: AiringStatus;
}

// 実データから作れるQ&Aだけを順に積む。作れないものは足さない。
export function buildDataFaq(input: WorkFaqInput): FaqItem[] {
  const {
    title,
    streamingNames,
    rentalNames,
    otherServices,
    broadcastStartDate,
    broadcastWeekday,
    broadcastTime,
    castNames,
    director,
    productionCompany,
    originalCreators,
    status,
  } = input;
  const items: FaqItem[] = [];
  const finished = status === "finished";

  // ① 配信サービスの「数」。「何個のサブスクで見られるのか」は、どのサービスに
  //    入るか迷っている人が最初に知りたい数字。数値を含む回答はAIに引用されやすい。
  if (streamingNames.length > 0 || rentalNames.length > 0) {
    const parts: string[] = [];
    if (streamingNames.length > 0) parts.push(`見放題が${streamingNames.length}サービス`);
    if (rentalNames.length > 0) parts.push(`レンタル（都度課金）が${rentalNames.length}サービス`);
    if (otherServices.length > 0) parts.push(`分類できていない配信枠が${otherServices.length}件`);
    items.push({
      question: `「${title}」は何社の配信サービスで見られる？`,
      answer: finished
        ? `Annictのデータでは${parts.join("、")}あります。放送終了作品のため現在も配信されているかは各サービスでご確認ください。`
        : `${parts.join("、")}あります。`,
    });
  }

  // ② 独占配信かどうか。「1社だけ」は加入判断に直結する情報で、検索でもよく問われる。
  //    2社以上のときに「独占ではない」とだけ言っても情報量が無いので、1社のときだけ出す。
  if (streamingNames.length === 1) {
    items.push({
      question: `「${title}」は独占配信？`,
      answer: finished
        ? `Annictのデータで見放題配信が登録されているのは${streamingNames[0]}の1サービスのみです（当時の記録のため、現在の配信状況は各サービスでご確認ください）。`
        : `見放題で配信しているのは${streamingNames[0]}の1サービスのみです。ほかの見放題サービスでは配信されていません。`,
    });
  }

  // ③ 放送/配信の開始日。
  if (broadcastStartDate) {
    items.push({
      question: `「${title}」の放送・配信はいつから？`,
      answer: `初回の放送/配信は${formatJpDate(broadcastStartDate)}です（Annictの番組表データより）。`,
    });
  }

  // ④ 曜日・時刻。「毎週その曜日」という前提の表示なので、放送開始日とセットでのみ出す
  //    （CLAUDE.mdの放送開始1週間前ルールと同じ理由。開始前の作品に曜日だけ見せない）。
  if (broadcastWeekday !== null && broadcastTime && broadcastStartDate) {
    const wd = WEEKDAY[broadcastWeekday];
    items.push({
      question: `「${title}」は何曜日の何時から？`,
      answer: `初回は${formatJpDate(broadcastStartDate)}${wd}曜日${broadcastTime}からでした。放送/配信の時刻は放送局・配信サービスごとに異なる場合があります。`,
    });
  }

  // ⑤ 声優。「{作品名} 声優」は作品名と並んでよく検索される。
  //    多すぎると回答として読めなくなるので主要キャストに絞る。
  if (castNames.length > 0) {
    const shown = castNames.slice(0, 8);
    const rest = castNames.length - shown.length;
    items.push({
      question: `「${title}」の声優（キャスト）は？`,
      answer: `${shown.join("、")}${rest > 0 ? `ほか${rest}名` : ""}が出演しています（Annictのクレジットより）。`,
    });
  }

  // ⑥ 制作。監督・制作会社・原作のうち、実際に取れているものだけを1文にまとめる。
  const staff: string[] = [];
  if (director) staff.push(`監督は${director}`);
  if (productionCompany) staff.push(`アニメーション制作は${productionCompany}`);
  if (originalCreators.length > 0) staff.push(`原作は${originalCreators.join("・")}`);
  if (staff.length > 0) {
    items.push({
      question: `「${title}」の監督・制作会社は？`,
      answer: `${staff.join("、")}です（Annictのクレジットより）。`,
    });
  }

  return items;
}

// ───────────────────────────────────────────────────────────────
// 配信サービスの一覧表（可視テキスト）。
//
// バッジ（components/ServiceMarks.tsx）は視覚的には分かりやすいが、機械にとっては
// 「リンクの並び」でしかなく、見放題なのかレンタルなのか・データがどこ由来なのかが
// 読み取れない。表にすると抽出率が大きく上がる（81% 対 23%）ため、同じ情報を
// 表としても置く。
//
// **表にはリンクを入れない**。配信サービスへのリンクはバッジ側が担っており、
// 同じ行き先のリンクを二重に置くと「どちらを押しても同じ」ことが分からず、
// バッジの遷移先ルール（CLAUDE.mdの基本ルール・重大度高）の趣旨に反する。
// 表は「事実の一覧」に徹する。
// ───────────────────────────────────────────────────────────────

export interface ServiceRow {
  name: string;
  // "見放題" / "レンタル（都度課金）" / "未分類"
  plan: string;
  // データの出所。Annict由来か、公式サイト等で人力確認したものか。
  source: string;
}

export function buildServiceRows(params: {
  streaming: { name: string; manualSourceUrl?: string }[];
  rental: { name: string }[];
  otherServices: string[];
}): ServiceRow[] {
  const rows: ServiceRow[] = [];
  for (const s of params.streaming) {
    rows.push({
      name: s.name,
      plan: "見放題",
      source: s.manualSourceUrl ? "公式サイト等で確認" : "Annict",
    });
  }
  for (const s of params.rental) {
    rows.push({ name: s.name, plan: "レンタル（都度課金）", source: "Annict" });
  }
  for (const name of params.otherServices) {
    // SERVICESに未登録のチャンネル名。見放題かレンタルかは判断できないので断定しない。
    rows.push({ name, plan: "未分類", source: "Annict" });
  }
  return rows;
}
