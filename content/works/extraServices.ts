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
  // ───── 2026秋クール（2026-10-02追加） ─────
  // Annictに配信サービスの登録が1件も無かった作品のうち、配信サービス自身・作品公式・
  // 公式発表を報じた大手ニュースで配信先を確認できたもの。独占配信（Netflix・Prime Video・
  // Disney+・FODの配信オリジナル/独占見放題）はAnnictに番組表（programs）が載らないまま
  // 配信日を迎えることが多く、放置すると「配信情報なし」と表示され続ける。
  // 確認方法: この作業環境はWebFetchが遮断されていたため、出典ドメインに絞った検索で
  // **ページの題名そのものに**サービス名（と独占の旨）が書かれていることを確認した。
  // 配信の曜日・時刻は一次情報に明記されていたものだけ schedule に入れる。
  // サイバーパンク: エッジランナーズ2: Netflix独占。10月20日配信（全10話）。
  14032: [
    {
      key: "netflix",
      sourceUrl: "https://natalie.mu/comic/news/686028",
      confirmedDate: "2026-10-02",
    },
  ],
  // Bass X Machina: バスXマキナ: Netflix世界独占。11月3日配信。
  17862: [
    {
      key: "netflix",
      sourceUrl: "https://www.animatetimes.com/news/details.php?id=1787215731",
      confirmedDate: "2026-10-02",
    },
  ],
  // フールナイト: Netflix世界独占。11月26日（木）全話一挙配信（制作会社サンライズの発表）。
  17818: [
    {
      key: "netflix",
      sourceUrl: "https://www.sunrise-inc.co.jp/work/topics.php?id=24109",
      confirmedDate: "2026-10-02",
    },
  ],
  // リリスとシンデレラのおとぎの王国: Netflix映画。11月20日（金）世界独占配信。
  18210: [
    {
      key: "netflix",
      sourceUrl: "https://eiga.com/news/20260917/29/",
      confirmedDate: "2026-10-02",
    },
  ],
  // デモンズ・クレスト: Prime Video世界独占。11月6日（金）から配信（PR TIMESの公式発表）。
  16796: [
    {
      key: "prime",
      sourceUrl: "https://prtimes.jp/main/html/rd/p/000002152.000004612.html",
      confirmedDate: "2026-10-02",
    },
  ],
  // ディズニー ツイステッドワンダーランド ザ アニメーション ～エピソード オブ サバナクロー～:
  // ディズニープラス独占。2026年12月から（日付は未発表なので schedule は付けない）。
  14745: [
    {
      key: "disney",
      sourceUrl: "https://disneyplus.disney.co.jp/news/2026/0727_twst-animation_s2",
      confirmedDate: "2026-10-02",
    },
  ],
  // おじさんはカワイイものがお好き。: FOD独占見放題。10月4日（日）22時から毎週日曜22時
  // （フジテレビのPR TIMES発表）。
  16703: [
    {
      key: "fod",
      sourceUrl: "https://prtimes.jp/main/html/rd/p/000002185.000000084.html",
      confirmedDate: "2026-10-02",
      schedule: { weekday: 0, time: "22:00", startDate: "2026-10-04" }, // 日曜22:00、初回10/4
    },
  ],
  // ヤンキーハムスター！: dアニメストア自身の「秋アニメ新着」告知。見放題最速・毎週金曜7時更新。
  // 初回の日付は一次情報で確認できなかったので schedule は付けない。
  18192: [
    {
      key: "d_anime",
      sourceUrl: "https://animestore.docomo.ne.jp/animestore/CQ/notice-13569",
      confirmedDate: "2026-10-02",
    },
  ],
  // 僕らが選んだベストアドベンチャー（デジモン）: フジテレビ系放送直後の毎週日曜9:30から
  // FOD・TVerで見逃し配信（TVerはSERVICES外なので載せない）。
  17997: [
    {
      key: "fod",
      sourceUrl: "https://animeanime.jp/article/2026/08/03/101686.html",
      confirmedDate: "2026-10-02",
      schedule: { weekday: 0, time: "09:30", startDate: "2026-10-04" }, // 日曜9:30、初回10/4
    },
  ],
  // ちょこっとヤバシティ: YouTube「まじめにヤバシティ」公式チャンネルで配信（毎月1回のため
  // 週次の schedule は付けない）。
  18160: [
    {
      key: "youtube",
      sourceUrl: "https://prtimes.jp/main/html/rd/p/000000005.000186018.html",
      confirmedDate: "2026-10-02",
    },
  ],
  // カードファイト!! ヴァンガード Divinez 運命星戦編: 11月7日（土）放送開始。公式サイトの
  // 放送情報ページに配信サービスが列挙されている（SERVICESにある10社だけを載せる）。
  17433: (
    ["abema", "dmm", "d_anime", "fod", "lemino", "telasa", "prime", "unext", "bandai", "niconico"] as const
  ).map((key) => ({
    key,
    sourceUrl: "https://anime.cf-vanguard.com/vgd/onair/",
    confirmedDate: "2026-10-02",
  })),
};
