import type { ExtraServiceEntry } from "@/lib/services";

// Annictにまだ登録されていない配信サービスを人力で補完する一覧。
// 対象は「Annictのprogramsに配信サービスが1件も無く、配信情報が実質空に見える作品」
// のうち、公式サイト・公式発表記事等の一次情報で確認できたものだけ（推測で埋めない。
// CLAUDE.mdの方針に準拠）。全作品を追うのは非現実的なので、注目度が高い作品から
// scripts/audit-coverage.ts の(a)（TV放送データはあるが配信サービス0件）を見て判断する。
//
// key:   Annict の annictId（作品ID）
// value: ExtraServiceEntry の配列（sourceUrl・confirmedDate必須）
//
// 過去の経緯（Lemino配信を全作品に補完しようとした試み、2026-07-11）は保守コストを
// 理由に保留した。今回はその設計を再利用しつつ、対象を「都度、確認できた注目作」に
// 限定することで保守コストを抑える（[[lemino-manual-fill-deferred]]参照）。
export const EXTRA_SERVICES: Record<number, ExtraServiceEntry[]> = {
  // 片田舎のおっさん、剣聖になるⅡ: Annictに配信サービスの登録が無い
  // （TV放送28局分のデータはあるが配信は0件）。GAME Watchの記事で
  // 「Prime Videoにて世界独占」と明記されており確認済み。配信スケジュールは
  // 公式サイトのON AIRページ（https://ossan-kensei.com/onair/）で
  // 「Prime Video: 7月9日（木）より 毎週木曜 午前0時15分～」と確認（2026-07-12）。
  16248: [
    {
      key: "prime",
      sourceUrl: "https://game.watch.impress.co.jp/docs/news/2119740.html",
      confirmedDate: "2026-07-12",
      schedule: { weekday: 4, time: "00:15", startDate: "2026-07-09" }, // 木曜0:15、初回7/9
    },
  ],
  // トミカとトム シーズン2: Annictに配信サービスの登録が無い（TV放送データはあるが
  // 配信は0件）。タカラトミー公式サイトのライセンス情報ページで「dアニメストア」が
  // 配信パートナーとして明記されている。dアニメ側の具体的な配信曜日・時刻は
  // 確認できなかったためscheduleは付けない（TV放送＝テレ東系列日曜朝8:30とは別の
  // タイミングの可能性があり、誤った時刻を創作しないため）。
  17642: [
    {
      key: "d_anime",
      sourceUrl: "https://www.takaratomy.co.jp/products/license/tomica_tom/anime/",
      confirmedDate: "2026-07-12",
    },
  ],
  // ラブル＆クルー（2026冬）: Annictに配信サービスの登録が無い（TV放送データはあるが
  // 配信は0件）。U-NEXT公式プレスルームで「U-NEXT独占配信」「2026年1月10日（土）より
  // 毎週土曜日正午に1話ずつ配信」と明記されており確認済み。
  16739: [
    {
      key: "unext",
      sourceUrl: "https://www.unext.co.jp/en/press-room/pawpatrol-announce-2026-01-10",
      confirmedDate: "2026-07-12",
      schedule: { weekday: 6, time: "12:00", startDate: "2026-01-10" }, // 土曜正午、初回1/10
    },
  ],
};
