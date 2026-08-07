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
// 構造化データの dateModified（2026-08-07追加）
//
// dateModified は「内容が実際に変わった日」でなければならない。ところがこのサイトは
// 全ページで「今日」を無条件に入れていた。過去クールのページは
// content/snapshots/ の確定データ由来で**中身が1文字も動かない**ので、
// 毎日「今日更新した」と申告するのは事実ではない。
//
// これは app/sitemap.ts の lastmod で直したのと同じ問題。Googleは日付シグナルを
// 「一貫して正確なときだけ使う」ので、嘘の日付は本当に毎日変わる今期ページの
// 鮮度まで巻き添えにする。しかもAI検索では鮮度の重み順が
// 「dateModified ＞ 画面上の更新日 ＞ 公開日」で最も重いシグナルなので、
// ここを汚すと損が大きい。
//
// スナップショットは生成日を持っていないため、正確な日付を出す手段が無い。
// **正確に出せないなら申告しない**（undefined を返すと JSON.stringify が
// フィールドごと落とす）。放送中・これからのクールは実際に毎日再取得していて
// 内容も動きうるので、従来どおり取得日を出す。
// ───────────────────────────────────────────────────────────────
export function structuredDateModified(
  status: AiringStatus,
  fetchedDate: string
): string | undefined {
  return status === "finished" ? undefined : fetchedDate;
}
