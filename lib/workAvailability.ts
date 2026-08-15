// ───────────────────────────────────────────────────────────────
// 「その作品が今も配信されているか」を、断定してよい範囲で表現するためのロジック。
//
// なぜ要るか（2026-08-06）:
//   2026-08-05に過去クール64件・作品1,961ページを検索エンジンへ開放した。ところが
//   作品ページは全作品に対して「『X』は dアニメストア・U-NEXT で視聴できます
//   （2026-08-06時点）」と**現在形で断定**していた。
//
//   Annictのprogramsは「放送/配信の番組表の記録」であって、配信の**現在の可否**では
//   ない。放送終了作品でも当時の配信枠がそのままデータに残るだけで、Annictは
//   「配信が終了した」ことを記録しない（コミュニティ更新ベース）。つまり2015年冬の
//   作品ページに出る「2026-08-06時点で視聴できます」は、誰も確認していない主張だった。
//
//   CLAUDE.mdの「配信情報なしは仕様であり、勝手に推測データで埋めない」と同じ問題で、
//   こちらは「無いものを書く」ではなく「確認していないことを確認済みのように書く」型。
//   開放直後（＝索引に載り始めた直後）なので、傷が浅いうちに直す。
//
// どう直すか:
//   放送中／これからの作品は従来どおり現在形で書き、**放送が終了したクールの作品は
//   断定をやめる**。「もう見られない」と書くのも同じく未確認なので、事実である
//   「配信情報がある」だけを述べ、確認を促す。
// ───────────────────────────────────────────────────────────────

import { SITE_NAME, DATA_PROVIDER, DATA_PROVIDER_URL } from "./attribution.ts";
import { siteUrl } from "./siteUrl.ts";

// "airing"   … 現在クール以降（放送中・これから放送）。従来どおり現在形で書いてよい。
// "finished" … 放送が終了したクールの作品。現在の配信可否は未確認なので断定しない。
export type AiringStatus = "airing" | "finished";

// JSTの「今日」を "YYYY-MM-DD" で返す。
// toISOString() はUTCなので、そのまま使うとJSTの朝9時までは前日の日付になる。
export function jstToday(nowMs: number = Date.now()): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 年と月から、クールを単調増加する整数にする（比較のためだけの内部表現）。
// 月の区切りは lib/resolveSeasonParams.ts の seasonKeyForMonth と同じ
// （1-3=冬 / 4-6=春 / 7-9=夏 / 10-12=秋）。
function seasonIndex(year: number, month: number): number {
  return year * 4 + Math.floor((month - 1) / 3);
}

// 作品の基準日（放送開始日、劇場作品は公開日）と「今日」から、放送が終わったクールの
// 作品かを判定する。
//
// 基準日が無い作品（放送日未定の新作など）は "airing" として扱う。判定できないものを
// 「終了した」側に倒すと、これから始まる作品にまで「配信が終了していることがあります」と
// 出てしまうため。放送が終わった作品は必ずprogramsを持つ＝基準日があるので、
// この既定値で取りこぼしは起きない。
export function airingStatus(baseDate: string | null, today: string): AiringStatus {
  if (!baseDate) return "airing";
  const [by, bm] = baseDate.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  if (!by || !bm || !ty || !tm) return "airing";
  return seasonIndex(by, bm) < seasonIndex(ty, tm) ? "finished" : "airing";
}

// 放送終了作品に添える但し書き。「終わったかもしれない」と脅すためではなく、
// 未確認であることを明示して各サービスでの確認に送るための文。
export const FINISHED_NOTE =
  "放送が終了した作品は配信も終了していることがあるため、視聴前に各サービスの最新情報をご確認ください。";

// 放送中・これから放送の作品に添える但し書き（従来の文言）。
export const AIRING_NOTE =
  "配信状況は変わることがあるため、視聴前に各サービスの最新情報もご確認ください。";

// 作品ページの見出し「『X』はどこで配信されている？」に対する、可視テキストと
// FAQPage（JSON-LD）で共用する回答文。
//
// status が "finished" のときに現在形（「視聴できます」）を使わないことが、この関数の
// 存在理由そのもの。scripts/check.ts が機械的に検査している。
export function buildWatchAnswer(params: {
  title: string;
  serviceLabels: string[];
  rentalNote: string;
  checkedDate: string;
  status: AiringStatus;
}): string {
  const { title, serviceLabels, rentalNote, checkedDate, status } = params;
  const names = serviceLabels.join("・");
  return status === "finished"
    ? `「${title}」の配信情報があるのは ${names} です（${checkedDate}時点のAnnictデータ）。${rentalNote}${FINISHED_NOTE}`
    : `「${title}」は ${names} で視聴できます（${checkedDate}時点）。${rentalNote}${AIRING_NOTE}`;
}

// 検索結果のスニペットに使われる description。作品ページの metadata から呼ぶ。
export function buildWatchDescription(params: {
  title: string;
  descServices: string;
  releaseLead: string;
  status: AiringStatus;
}): string {
  const { title, descServices, releaseLead, status } = params;
  return status === "finished"
    ? `${releaseLead}「${title}」の配信情報があるのは ${descServices}。放送終了作品のため、視聴前に各サービスで最新の配信状況をご確認ください。`
    : `${releaseLead}「${title}」を見放題で配信している動画配信サービスは ${descServices}。どのサービスで見られるかをアニメ視聴ガイドが最新データで一覧にしています。`;
}

// 埋め込みウィジェット・作品ページのバッジ列に付ける見出しラベル。
// ウィジェットは他人のブログの**過去作の感想記事**に貼られる可能性が高く、そこで
// 「配信中のサービス」と言い切ると、貼った側の記事の信頼まで巻き添えにする。
export function availabilityLabel(status: AiringStatus): string {
  return status === "finished" ? "配信情報" : "配信中のサービス";
}

// ───────────────────────────────────────────────────────────────
// 配信情報を構造化データ（JSON-LD）で機械可読にする（2026-08-13追加）
//
// なぜ要るか:
//   作品ページのJSON-LDは声優・監督・製作会社・原作者を持っていたのに、このサイトの
//   中心的な事実である「どこで配信されているか」は可視テキストにしか無かった。
//   AI検索・生成AIが引用するのは機械可読の層なので、いちばん引用してほしい事実だけが
//   そこから落ちていたことになる。
//
// 生成をこのファイルに置く理由（＝作品ページに直書きしない理由）は、可視テキストで
// 既に守っている制約（放送終了作品に「いま配信中」と書かない／第三者に配るものに広告リンクを
// 入れない）を、機械可読の層でも同じ場所・同じ強さで守るため。機械はそのまま事実として
// 再配布するので、可視テキストより影響が広い。
// scripts/check.ts の「配信情報の構造化データ」節が機械的に検査する。
//
// 【WatchAction は使わない（2026-08-13。一度実装してから取り下げた）】
//   最初の実装は potentialAction に schema.org の WatchAction を並べていた。実装後の
//   レビューで、可視テキスト側で守っているルールを機械可読側で3つ破ると分かったので撤回した。
//   同じ設計を再提案しないために記録を残す:
//     ①WatchAction は「ここで見られる」という現在形の主張そのもの。放送終了クールは
//       弾いていたが、**放送開始前**の作品は airing 扱いなので素通りしていた。まだ1話も
//       配信されていない作品に「見られる」と機械可読で配ることになり、CLAUDE.md の
//       「放送開始1週間前ルール」の趣旨を機械可読の層で破る。
//     ②target.urlTemplate に入れられるのは各サービスの公式トップページだけで、作品への
//       直リンクは持っていない。「この作品を見る」と名乗って行き先がトップページなのは
//       「リンクの見た目＝遷移先」（配信バッジの事故と同じ型）を人の目に触れない層で犯す。
//     ③見放題かレンタルかを表す Offer を付けられない。
//   代わりに additionalProperty（PropertyValue）で**事実だけ**を述べる。「この作品には
//   これらのサービスの配信情報がある」は放送中でも終了後でも真で、行為も行き先も主張しない。
//   だから status で分岐する必要が無く、分岐が無いぶん「放送終了に現在形を出す」壊れ方が
//   構造的に起こらない。URL を一切持たないので、広告リンクが混入する経路も存在しない。

// additionalProperty に載せる property の名前。可視テキスト側の
// availabilityLabel("finished") と同じ「配信情報」の語で、配信の現在の可否は主張しない。
export const STREAMING_PROPERTY_NAME = "配信情報のあるサービス";

// 作品ページの JSON-LD に載せる additionalProperty（PropertyValue の配列）を作る。
//
// ・渡すのは表示名だけ。URL は受け取らないし組み立てもしない（広告リンクを渡す口を作らない）。
// ・重複は落とす。0件のときは空配列を返し、呼び出し側は additionalProperty ごと出さない。
// ・「その他配信」（正準リストに無い未知チャンネル名）は呼び出し側で渡さない。正規化できて
//   いない生の名前を機械可読で配ると、二次利用側がそれをサービス名として扱ってしまう。
// ・レンタル（都度課金）も呼び出し側で除いてから渡す（見放題と混ぜない）。
export function buildStreamingProperties(
  services: Array<{ name: string }>
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const s of services) {
    const name = (s?.name ?? "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      "@type": "PropertyValue",
      name: STREAMING_PROPERTY_NAME,
      value: name,
    });
  }
  return out;
}

// 構造化データの「出所」を機械可読にする。**作品（TVSeries/Movie）ではなく
// ページ（WebPage）に付ける独立したノードを返す**。
//
// retrievedDate は **Annict からデータを取得した日**（JST, "YYYY-MM-DD"）であって、
// 配信の可否を誰かが確認した日ではない。だから可視テキストと同じく「確認日」という語を
// 使わない（docs/operations.md の⑰・CLAUDE.md の基本ルール）。
// schema.org の語彙で言うと sdDatePublished が
// "the date on which the current structured data was generated/published" と定義されており、
// 「この構造化データを作った日」という意味にちょうど一致する。
//   ・sdDatePublished … 構造化データを生成した日
//   ・sdPublisher     … その構造化データを出しているのは誰か（＝本サイト）
//   ・citation        … 何を参照しているか（＝Annict）
//
// 2026-08-16修正: これを作品ノードに Object.assign していたが、citation は CreativeWork の
// プロパティ＝「**その作品が**参照している別の著作物」という意味なので、TVSeries に
// 置くと機械可読の層でだけ「アニメ『◯◯』はAnnictを引用している」という事実でない主張に
// なっていた（可視テキストには無い嘘が構造化データにだけ残る＝⑰・WatchActionと同じ型の
// 事故）。参照しているのは作品ではなくこのページなので、WebPage ノードに移した。
// sdDatePublished/sdPublisher は「構造化データそのもの」にスコープされた語彙なので
// どちらのノードでも正しいが、出所一式は1ノードにまとめる。
// 名前とURLは lib/attribution.ts（出典表記の正準定義）を使い回す。
export function buildDataProvenance(
  retrievedDate: string,
  pageUrl: string
): Record<string, unknown> {
  return {
    "@type": "WebPage",
    "@id": pageUrl,
    url: pageUrl,
    sdDatePublished: retrievedDate,
    sdPublisher: { "@type": "Organization", name: SITE_NAME, url: siteUrl },
    citation: { "@type": "WebSite", name: DATA_PROVIDER, url: DATA_PROVIDER_URL },
  };
}
