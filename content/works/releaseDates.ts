import type { ReleaseDateEntry } from "@/lib/types";

// 劇場公開日を人力で補完する一覧（2026-07-27導入）。
//
// なぜ必要か: Annict の API は劇場公開日を持たない。GraphQL の Work 型には
// released_on 相当のフィールドが無く（introspectionで確認）、REST v1 の
// `released_on` も新作映画では空文字のことが多い（実例: 8410 劇場版まどマギ
// 〈ワルプルギスの廻天〉は released_on="" で、Annict側の日付情報は
// season_name="2026-summer"（＝2026年夏）だけ）。
// サイトの日付表示は programs（放送/配信記録）の startedAt から導出しているため、
// programs が0件の劇場公開作品は曜日・時刻・開始日がすべて null になり、
// 一覧カードは「放送時期未定」、作品ページは日付表記なしになっていた。
// ＝ Annict側が公開時期を更新しても、具体的な公開日はサイトに出しようがなかった。
//
// 方針は content/works/extraServices.ts と同じ。公式サイト等の一次情報で確認できた
// 作品にだけ日付を与え、確認できない作品は載せない（推測で埋めない。CLAUDE.md準拠）。
// 公開日は延期・変更されることがあるため confirmedDate を必ず入れ、古くなったら
// 出典を見直す。対象は注目度の高い劇場公開作品から都度追加する（全作品は追わない）。
//
// key:   Annict の annictId（作品ID）
export const RELEASE_DATES: Record<number, ReleaseDateEntry> = {
  // 劇場版 魔法少女まどか☆マギカ〈ワルプルギスの廻天〉
  // 公式サイトのタイトル・トップに「2026年8月28日(金)公開」。
  // （当初は2026年2月公開と発表され、後に8月28日へ変更された経緯がある）
  8410: {
    date: "2026-08-28",
    sourceUrl: "https://www.madoka-magica.com/wr/",
    confirmedDate: "2026-07-27",
  },
  // 最終楽章 響け！ユーフォニアム 後編: 公式サイトに「2026年9月11日(金)公開」。
  17519: {
    date: "2026-09-11",
    sourceUrl: "https://anime-eupho.com/",
    confirmedDate: "2026-07-27",
  },
  // 死亡遊戯で飯を食う。 44:CLOUDY BEACH: 映画.comの作品情報に「劇場公開日：2026年7月10日」。
  17354: {
    date: "2026-07-10",
    sourceUrl: "https://eiga.com/movie/105933/",
    confirmedDate: "2026-07-27",
  },
  // 君と花火と約束と: 公開告知記事に「2026年7月17日（金）公開」。
  17069: {
    date: "2026-07-17",
    sourceUrl: "https://tower.jp/article/news/2026/01/29/tg021",
    confirmedDate: "2026-07-27",
  },
  // 映画ちいかわ 人魚の島のひみつ: 公開当日の報道に「本日7月24日より公開」。
  16734: {
    date: "2026-07-24",
    sourceUrl: "https://game.watch.impress.co.jp/docs/news/2126703.html",
    confirmedDate: "2026-07-27",
  },
  // 映画名探偵プリキュア！不思議な庭と2人の秘密: 公式サイトに「9月18日(金)公開」。
  17379: {
    date: "2026-09-18",
    sourceUrl: "https://2026.precure-movie.com/",
    confirmedDate: "2026-07-27",
  },
  // SEKIRO: NO DEFEAT: 公式サイトに「9.4[FRI]」。
  16475: {
    date: "2026-09-04",
    sourceUrl: "https://sekiro-anime.jp/",
    confirmedDate: "2026-07-27",
  },
  // トイ・ストーリー5: 公式（disney.co.jp）が取得できなかったため映画.comの
  // 作品情報「劇場公開日：2026年7月3日」を出典にする。
  13779: {
    date: "2026-07-03",
    sourceUrl: "https://eiga.com/movie/104002/",
    confirmedDate: "2026-07-27",
  },
  // 機動警察パトレイバー EZY File 2: 公式サイトに「2026/08/14 FRI」。
  17054: {
    date: "2026-08-14",
    sourceUrl: "https://ezy.patlabor.tokyo/",
    confirmedDate: "2026-07-27",
  },
  // しらぬひ: 配給（ギャガ）の公式作品ページに「8.21 FRI」。
  17190: {
    date: "2026-08-21",
    sourceUrl: "https://gaga.ne.jp/shiranuhi/",
    confirmedDate: "2026-07-27",
  },
  // 縁の手紙: 公式サイトに「9月25日(金)に決定」。
  17347: {
    date: "2026-09-25",
    sourceUrl: "https://en-no-tegami.com/",
    confirmedDate: "2026-07-27",
  },
  // 我々は宇宙人: 公式サイトに日付の記載が見当たらないため、映画.comの作品情報
  // 「劇場公開日：2026年9月25日」を出典にする。
  16726: {
    date: "2026-09-25",
    sourceUrl: "https://eiga.com/movie/105075/",
    confirmedDate: "2026-07-27",
  },
  // 映画クレヨンしんちゃん 奇々怪々！オラの妖怪バケ～ション:
  // バンダイナムコ（V-STORAGE）の作品情報に「2026年7月31日（金）公開」。
  17130: {
    date: "2026-07-31",
    sourceUrl: "https://v-storage.jp/anime/shinchan-anime/276319/",
    confirmedDate: "2026-07-27",
  },
  // ミニオンズ＆モンスターズ: 公式サイトに「8.7 FRI」。
  17308: {
    date: "2026-08-07",
    sourceUrl: "https://minions.jp/",
    confirmedDate: "2026-07-27",
  },
  // 魔女の谷の夜: 一般の劇場公開ではなく、ジブリパーク「ジブリの大倉庫」内での上映
  // （公式のお知らせに「7月8日(水)より上映する」。終了日は記載なし）。日付の意味が
  // 通常の劇場公開と異なるが、「いつから観られるか」という点では同じなので載せる。
  17802: {
    date: "2026-07-08",
    sourceUrl: "https://ghibli-park.jp/info/info20260421-2.html",
    confirmedDate: "2026-07-27",
  },
  // るすばん: 全国公開ではなく新宿K's cinemaでの上映（劇場の作品ページに
  // 「2026/8/1(土)〜8/7(金)」）。初日を公開日として載せる。
  17865: {
    date: "2026-08-01",
    sourceUrl: "https://www.ks-cinema.com/movie/rusuban/",
    confirmedDate: "2026-07-27",
  },
  // パウ・パトロール ザ・ダイノ・ムービー: 映画.comの作品情報
  // 「劇場公開日：2026年7月24日」。
  17370: {
    date: "2026-07-24",
    sourceUrl: "https://eiga.com/movie/105057/",
    confirmedDate: "2026-07-27",
  },
  // 映画 宇宙なんちゃら こてつくん うっかり出てきた宇宙人を探せ！:
  // 公式サイト内に日付の記載ページが見当たらないため、公開告知記事
  // 「9月11日（金）より全国公開」を出典にする。
  17819: {
    date: "2026-09-11",
    sourceUrl: "https://movie.jorudan.co.jp/news/kine-latest-20260720-nw-a14946/",
    confirmedDate: "2026-07-27",
  },
  // 幻想水滸伝 先行プレミアム上映: 全国10劇場でのイベント上映。公式サイトの
  // 「8月21日（金）より」を初日として載せる（終了日は記載なし）。
  17902: {
    date: "2026-08-21",
    sourceUrl: "https://suikoden-anime.com/",
    confirmedDate: "2026-07-27",
  },
};
