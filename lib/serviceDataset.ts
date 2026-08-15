// ───────────────────────────────────────────────────────────────
// 配信サービス名寄せ表の公開データセット（2026-08-13導入）
//
// なぜ作るか（docs/growth-strategy-2026-08.md の4章・5章①）:
//   世界の類似サービス約100件の調査の結論は「一覧そのものには差別化余地が無く、
//   差別化があるのは正規化のほう」だった。lib/services.ts が持つ
//   「Annictの生チャンネル名 → 国内配信サービス」への名寄せ（表記ゆれの吸収・
//   放送局の除外・未知チャンネルの扱い）は本サイトが自前で書いた資産で、Annictは持たない。
//   Annictは生の名前のまま持つのが正しく、JustWatch/Reelgoodは日本のVODの粒度が粗いうえ
//   データをB2Bで売る商材にしており、VOD比較のアフィリエイトサイトはデータを開くと
//   自分のクリック収益が消える。つまり「機械可読で無料公開する枠」が空いている。
//   駅データ.jp が利用規約でクレジット表記＋URL掲示を義務付けて被リンクを構造に
//   組み込んだのと同じ型で、使われるほど出典リンクが増える置き方にする。
//
// 【法務上の切り分け（重要）】
//   名寄せ表そのものは本サイトの著作物なので公開できる。一方 Annict 由来の
//   「作品ごとの配信実績」は再配布の可否が未確認（Annictの利用規約はサービス外への
//   再配布可否が曖昧。docs/annict-contribution.md）なので、**このデータセットには
//   一切含めない**。確認が取れるまでこの線を動かさないこと。
//   scripts/check.ts の「配信サービス名寄せ表の公開」節が機械的に見張る。
//
// 【広告を混ぜない】
//   埋め込みウィジェット（lib/embed.ts）と同じ重大度で、このデータセットに
//   アフィリエイトリンクを入れない。第三者のアプリの中に自分の広告リンクを
//   紛れ込ませることになり、ステマ規制・ASP規約の両面で事故になる。
//   content/affiliate/programs.ts を参照しないこと（これも check.ts が見張る）。
//
// 拡張子つき import なのは `node scripts/check.ts` から直接読めるようにするため
// （lib/embed.ts と同じ。tsconfig.json の allowImportingTsExtensions と対）。
// ───────────────────────────────────────────────────────────────
import {
  attributionUrl,
  datasetAttributionHtml,
  datasetAttributionMarkdown,
  datasetAttributionText,
  SITE_NAME,
} from "./attribution.ts";
import { SERVICES, TV_PATTERN, type ServiceDef } from "./services.ts";
import { siteUrl } from "./siteUrl.ts";

export const DATASET_NAME = "アニメ配信サービス名寄せ表（Annictチャンネル名 → 国内配信サービス）";

export const DATASET_DESCRIPTION =
  "Annictが持つ放送・配信チャンネルの生の名前から、国内の見放題配信サービスを特定するための" +
  "名寄せ表。サービスごとの正準キー・表示名・公式サイトURL・判定に使っている正規表現を" +
  "JSONとCSVで公開する。表記ゆれ（全角/半角・長音・空白）を吸収したうえで判定する。" +
  "作品ごとの配信実績は含まない。";

// 利用条件の置き場は /developers（既存の公開API・ウィジェットと同じ条件）。
// 名前と行き先を1箇所に持ち、APIの応答・ページの構造化データの両方がここを参照する。
export const DATASET_LICENSE = {
  name: "アニメ視聴ガイド 利用条件（出典表記が必要）",
  url: `${siteUrl}/developers`,
} as const;

export const DATASET_JSON_URL = `${siteUrl}/api/services`;
export const DATASET_CSV_URL = `${siteUrl}/api/services?format=csv`;

// チャンネル名の正規化手順。lib/services.ts の norm() と同じ順序で並べる
// （publishした手順どおりに前処理しないと channelPattern が当たらないため、
//  「使う側が再現できる形」で書き出すのがこのデータセットの肝）。
export const CHANNEL_NORMALIZATION = [
  "小文字にする",
  "空白文字をすべて取り除く",
  "長音・ダッシュ類（ー／－／―／‐）を半角ハイフン - に統一する",
  "全角の英数字を半角にする",
] as const;

// 判定の順序。①サービス → ②放送局（除外） → ③その他配信、の3段で、
// ②を省くと TOKYO MX / AT-X / BS11 / テレビ東京 がすべて「その他配信」＝配信サービスとして
// 残ってしまう（Annictの生チャンネル名は放送局が大半なので、ほぼ全作品で地上波局を
// 配信サービスとして表示することになる）。手順を publish するのがこのデータセットの肝なので、
// 除外の段も順序込みで書き出す（2026-08-13にbroadcastPatternごと追加）。
export const MATCHING_NOTE =
  "正規化したチャンネル名に channelPattern を配列の先頭から順に試し、最初に一致した" +
  "サービスを採用する（配列の順序＝判定の優先順）。どのサービスにも一致しなかったときは" +
  "次に broadcastPattern（放送局の判定）を試し、当たれば放送局として除外する" +
  "（国内の見放題配信だけを残すため）。サービスにも broadcastPattern にも当たらない名前だけを" +
  "「その他配信」として元の名前のまま扱う。";

// 放送局の除外パターン（lib/services.ts の TV_PATTERN そのもの）についての注記。
export const BROADCAST_PATTERN_NOTE =
  "地上波・BS・CSの放送局を判定して落とすための正規表現。channelPattern と同じく" +
  "正規化後のチャンネル名に当てる。サービス判定より後に試すこと" +
  "（例: 「DMM TV」は tv で終わるが配信サービスなので、先に channelPattern が当たる必要がある）。";

export const DATASET_NOTE =
  "この表は本サイトが作成したもので、作品ごとの配信実績（どの作品がどこで配信されたか）は" +
  "含まない。Annict由来のデータは再配布の可否が未確認のため公開していない。";

export interface ServiceDatasetEntry {
  /** 本サイト内で一貫して使う正準キー（公開APIの services[].key と同じもの）。 */
  key: string;
  /** 表示名（フル）。 */
  name: string;
  /** バッジ等に使う短い表示名。 */
  short: string;
  /** カタカナ表記。無いサービスは null。 */
  kana: string | null;
  /** 公式トップページURL。 */
  officialUrl: string;
  /** 正規化後のチャンネル名に対して当てる正規表現（本体）。 */
  channelPattern: string;
  /** 上の正規表現のフラグ（現状はすべて空文字）。 */
  channelPatternFlags: string;
}

// CSVの列。JSONのフィールドと1対1に対応させる（形式が違うだけで中身は同じ）。
export const CSV_COLUMNS: readonly (keyof ServiceDatasetEntry)[] = [
  "key",
  "name",
  "short",
  "kana",
  "officialUrl",
  "channelPattern",
  "channelPatternFlags",
];

export function serviceDatasetEntries(defs: ServiceDef[] = SERVICES): ServiceDatasetEntry[] {
  return defs.map((d) => ({
    key: d.key,
    name: d.name,
    short: d.short,
    kana: d.kana ?? null,
    officialUrl: d.officialUrl,
    channelPattern: d.match.source,
    channelPatternFlags: d.match.flags,
  }));
}

// 応答は SERVICES と TV_PATTERN だけから決まる＝日付を持たない（2026-08-13修正）。
// 以前は /api/work/[id]・/api/season と同じ source: apiSource(checkedAt) を載せていたが、
//   ・このAPIは Annict に一切触れないのに「データ元: Annict」と名乗っていた（事実として誤り）
//   ・checkedAt は「Annictから取得した日」の意味なのに、ここでは何も取得していない
//   ・s-maxage=86400 でCDNに載るため、その日付は最大8日ずれた値が配られる
// の3点が同時に壊れていた。生成日を入れる手もあるが、中身が完全に決定的である以上
// 日付そのものが不要（キャッシュとも整合する）。
export function buildServiceDataset(defs: ServiceDef[] = SERVICES) {
  const services = serviceDatasetEntries(defs);
  return {
    dataset: DATASET_NAME,
    description: DATASET_DESCRIPTION,
    note: DATASET_NOTE,
    // 利用条件と、そのまま貼れる出典表記。lib/attribution.ts の正準定義を使う
    // （文面を増やさない。使う側が書くのを省くのは「書きたくない」からではなく
    //  「自分で組み立てる手間がある」からなので、コピーできる形で渡す）。
    // ここで使うのは **名寄せ表専用** の datasetAttribution*（Annictを名乗らない版）。
    // この表に Annict のデータは1件も入っていないため。
    license: DATASET_LICENSE,
    attribution: {
      text: datasetAttributionText(),
      html: datasetAttributionHtml(),
      markdown: datasetAttributionMarkdown(),
      url: attributionUrl(),
    },
    creator: { name: SITE_NAME, url: siteUrl },
    matching: {
      note: MATCHING_NOTE,
      normalization: [...CHANNEL_NORMALIZATION],
      // 放送局の除外パターン。これが無いと公開手順どおりに実装しても本サイトの判定を
      // 再現できない（放送局が全部「その他配信」に落ちる）。
      broadcastPattern: TV_PATTERN.source,
      broadcastPatternFlags: TV_PATTERN.flags,
      broadcastPatternNote: BROADCAST_PATTERN_NOTE,
    },
    count: services.length,
    services,
  };
}

// ?format= の解釈（2026-08-13追加）。route.ts に直書きすると検査から呼べないのでここに置く
// （lib/workAvailability.ts と同じ流儀）。
// 元の実装は `searchParams.get("format") ?? "json"` で、`??` は空文字を弾かないため
// `?format=`（値なし）が400になっていた。大文字（`?format=CSV`）も同様。
// 未指定・空文字は既定の json、大小文字は無視する。それ以外は null＝400。
export type DatasetFormat = "json" | "csv";
export function parseFormat(raw: string | null | undefined): DatasetFormat | null {
  const v = (raw || "json").toLowerCase();
  return v === "json" || v === "csv" ? v : null;
}

// RFC4180: 区切りのカンマ・引用符・改行を含む値だけを二重引用符で囲み、
// 値の中の引用符は "" に重ねる。BOMは付けない（付けると先頭列名がBOM込みで
// 読まれるパーサがあり、機械可読性が落ちる）。改行はCRLF。
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: ServiceDatasetEntry[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map((col) => {
        const v = row[col];
        return csvField(v == null ? "" : String(v));
      }).join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}
