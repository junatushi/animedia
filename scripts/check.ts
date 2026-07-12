import { classifyChannel, toAnimeItem } from "../lib/services.ts";
import { PROGRAMS_QUERY, PROGRAMS_QUERY_LIST } from "../lib/annict.ts";
import type { AnnictWork } from "../lib/types.ts";

const samples: Array<[string, string]> = [
  // [入力チャンネル名, 期待する分類]
  ["dアニメストア", "service:d_anime"],
  ["ABEMA", "service:abema"],
  ["AbemaTV", "service:abema"],          // 旧名でも配信判定が先
  ["Netflix", "service:netflix"],
  ["Amazon Prime Video", "service:prime"],
  ["U-NEXT", "service:unext"],
  ["Ｕ－ＮＥＸＴ", "service:unext"],        // 全角でも吸収
  ["DMM TV", "service:dmm"],             // "TV" を含むが配信
  ["Lemino", "service:lemino"],
  ["Disney+", "service:disney"],
  ["バンダイチャンネル", "service:bandai"],
  ["ニコニコ動画", "service:niconico"],
  ["アニメ放題", "service:anime_houdai"],
  ["WOWOWオンデマンド", "service:wowow_od"],
  // --- TV局は除外されるべき ---
  ["TOKYO MX", "tv"],
  ["BS11", "tv"],
  ["AT-X", "tv"],
  ["テレビ東京", "tv"],
  ["WOWOWプライム", "tv"],                // オンデマンドでないWOWOWはTV扱い
  ["サンテレビ", "tv"],
  // --- 未知の配信は other で拾う ---
  ["みんなの推し配信", "other"],

  // ── ここから下は 2026夏の実データ（Annict が実際に返す表記）由来 ──
  //    手作業サンプルと表記が違っても正しく仕分くことを固定する回帰テスト。
  ["ABEMAビデオ", "service:abema"],              // 実表記（"ABEMA"単体ではない）
  ["ABEMA アニメ", "service:abema"],             // 同上・別チャンネル
  ["Amazon プライム・ビデオ", "service:prime"],   // 実表記（全角中黒）。"amazon"で拾う
  ["dアニメストア ニコニコ支店", "service:d_anime"], // 支店表記。dアニメ判定が先
  ["ニコニコ生放送", "service:niconico"],         // 「放送」を含むが配信が先
  ["ニコニコチャンネル", "service:niconico"],
  ["FOD", "service:fod"],
  ["BS11イレブン", "tv"],                        // 実表記（"BS11"ではない）
  ["MBS毎日放送", "tv"],
  ["テレビ神奈川 (tvk)", "tv"],                   // 括弧・空白入りでもTV
  ["WOWOW", "tv"],                              // オンデマンド無しの素WOWOWは放送
  ["TVQ九州放送", "tv"],
  ["アニマックス", "tv"],                         // CS。国内“配信”ではないので除外
  ["YouTube", "service:youtube"],               // 正式サービス化（旧: otherだった）
  ["メ～テレ", "tv"],                            // 名古屋テレビ（波ダッシュ表記）。旧: otherに漏れていた
  ["メーテレ", "tv"],                            // 同上・長音表記ゆれ
];

let ok = 0;
let ng = 0;
for (const [input, expect] of samples) {
  const c = classifyChannel(input);
  const got = c.kind === "service" ? `service:${c.def.key}` : c.kind;
  const pass = got === expect;
  if (pass) ok++; else ng++;
  console.log(`${pass ? "✓" : "✗"}  ${input.padEnd(22)} → ${got}${pass ? "" : `  (期待: ${expect})`}`);
}
console.log(`\n結果: ${ok} 件OK / ${ng} 件NG`);

// ── 配信スケジュール（曜日・時刻）の回帰テスト ──
// 2026-07-11 実例: Re:ゼロ4期奪還編で AT-X（TV、非表示）が ABEMA/dアニメ（実際に
// カードへ表示される配信サービス）より30分早く放送されるデータになっており、
// カレンダーがカードに出ていないAT-Xの時刻（22:00）を表示していた
// （実際に見られるABEMA/dアニメは22:30開始）。TVチャンネルは曜日/時刻の算出対象から
// 除外し、カードに表示される配信サービス側の時刻を使うことを固定する。
function work(programs: { channel: string; startedAt: string }[]): AnnictWork {
  return {
    annictId: 1,
    title: "テスト作品",
    watchersCount: 0,
    officialSiteUrl: null,
    image: null,
    media: "TV",
    programs: {
      nodes: programs.map((p) => ({ channel: { name: p.channel }, startedAt: p.startedAt })),
    },
    casts: [],
    staffs: [],
  };
}

let scheduleOk = 0;
let scheduleNg = 0;
function checkSchedule(
  name: string,
  w: AnnictWork,
  expectWeekday: number | null,
  expectTime: string | null,
  expectDate: string | null
) {
  const item = toAnimeItem(w);
  const pass =
    item.broadcastWeekday === expectWeekday &&
    item.broadcastTime === expectTime &&
    item.broadcastStartDate === expectDate;
  if (pass) scheduleOk++; else scheduleNg++;
  console.log(
    `${pass ? "✓" : "✗"}  ${name.padEnd(28)} → weekday=${item.broadcastWeekday} time=${item.broadcastTime} date=${item.broadcastStartDate}` +
      (pass ? "" : `  (期待: weekday=${expectWeekday} time=${expectTime} date=${expectDate})`)
  );
}

// AT-X（TV, 22:00）の方がABEMA/dアニメ（配信, 22:30）より早いが、表示すべきは配信側の時刻。
checkSchedule(
  "TV局が配信サービスより早い場合",
  work([
    { channel: "AT-X", startedAt: "2026-08-12T13:00:00Z" }, // JST 22:00 (TV, 非表示)
    { channel: "ABEMA", startedAt: "2026-08-12T13:30:00Z" }, // JST 22:30 (配信, 表示対象)
    { channel: "dアニメストア", startedAt: "2026-08-12T13:30:00Z" }, // JST 22:30
  ]),
  3, // 水
  "22:30",
  "2026-08-12"
);
// 配信サービスが無くTVのみの場合は「配信日未定」（=null）扱いにする。
checkSchedule(
  "TV局のみ（配信情報なし）",
  work([{ channel: "TOKYO MX", startedAt: "2026-08-12T14:00:00Z" }]),
  null,
  null,
  null
);
// programsが無い場合もnull。
checkSchedule("programsなし", work([]), null, null, null);

console.log(`結果（配信スケジュール）: ${scheduleOk} 件OK / ${scheduleNg} 件NG`);

// ── シーズン一覧の追い取得クエリの回帰テスト ──
// 2026-07-12 実例: 片田舎のおっさん、剣聖になるⅡ（全国ネット24局+AT-X+BS朝日=
// 300件超のprograms）で、300件を超えた分の追い取得にepisodeフィールドを含む
// クエリ（PROGRAMS_QUERY）を使っていたため、Annictがepisode未紐付けprogramで
// 返すnon-nullフィールド違反によりノードが丸ごとnullになり、配信サービス側の
// programが失われて「配信情報なし」に見えていた。シーズン一覧の追い取得
// （fetchSeasonWorks → fetchRemainingPrograms）はepisodeを使わないPROGRAMS_QUERY_LIST
// を使うべきで、これが再び episode を含む形に統合されないよう固定する。
let queryOk = 0;
let queryNg = 0;
function checkQueryField(name: string, query: string, field: string, shouldContain: boolean) {
  const contains = query.includes(field);
  const pass = contains === shouldContain;
  if (pass) queryOk++; else queryNg++;
  console.log(
    `${pass ? "✓" : "✗"}  ${name.padEnd(40)} → ${field}を${contains ? "含む" : "含まない"}` +
      (pass ? "" : `  (期待: ${shouldContain ? "含む" : "含まない"})`)
  );
}
checkQueryField("PROGRAMS_QUERY_LIST（シーズン一覧の追い取得）", PROGRAMS_QUERY_LIST, "episode", false);
checkQueryField("PROGRAMS_QUERY（作品個別/通知機能）", PROGRAMS_QUERY, "episode", true);
console.log(`結果（追い取得クエリ）: ${queryOk} 件OK / ${queryNg} 件NG`);

if (ng > 0 || scheduleNg > 0 || queryNg > 0) process.exit(1);
