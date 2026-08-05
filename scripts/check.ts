import { readFileSync } from "node:fs";
import { classifyChannel, toAnimeItem } from "../lib/services.ts";
import { PROGRAMS_QUERY, PROGRAMS_QUERY_LIST } from "../lib/annict.ts";
import type { AnnictWork } from "../lib/types.ts";
import { toSingleHashtagText, SLOTS, anchorToSlotDate, slotForNow, jstParts } from "./lib/build-digest.js";

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

  // ── 2026-07-12 service-mapper点検（2026冬・春クールの実データ）由来 ──
  ["Crunchyroll", "service:crunchyroll"],       // 旧: otherに漏れていた（2026春）
  ["ぎふチャン", "tv"],                          // ひらがな表記の岐阜CATV局。旧: otherに漏れていた（2026冬）
  ["チャンネルNECO", "tv"],                      // 時代劇専門CS局。旧: otherに漏れていた（2026冬）
  ["鉄道チャンネル", "tv"],                       // CS局。旧: otherに漏れていた（2026冬）
  ["カートゥーンネットワーク", "tv"],               // CS/CATV局。旧: otherに漏れていた（2026春）
  ["ディズニー・チャンネル", "tv"],                // CS/CATV局。Disney+（配信）とは別物。旧: otherに漏れていた（2026春）
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

// ── hasBroadcastData（TV放送のみ vs Annictにデータ自体が無い、の区別）の回帰テスト ──
// 2026-07-12 実例: 片田舎のおっさん、剣聖になるⅡはTV放送28局分のデータはあるが
// 配信サービス登録が0件。これを「programsが1件も無い」作品と同じ「配信情報なし」で
// 出すと実態と違う（ServiceMarksコンポーネント参照）。
let bdOk = 0;
let bdNg = 0;
function checkHasBroadcastData(name: string, w: AnnictWork, expect: boolean) {
  const item = toAnimeItem(w);
  const pass = item.hasBroadcastData === expect;
  if (pass) bdOk++; else bdNg++;
  console.log(
    `${pass ? "✓" : "✗"}  ${name.padEnd(28)} → hasBroadcastData=${item.hasBroadcastData}` +
      (pass ? "" : `  (期待: ${expect})`)
  );
}
checkHasBroadcastData(
  "TV局のみでもtrue",
  work([{ channel: "TOKYO MX", startedAt: "2026-08-12T14:00:00Z" }]),
  true
);
checkHasBroadcastData("programsなしはfalse", work([]), false);
console.log(`結果（hasBroadcastData）: ${bdOk} 件OK / ${bdNg} 件NG`);

// ── 人力補完サービス（content/works/extraServices.ts）マージの回帰テスト ──
// 2026-07-12導入。Annictにデータが無くても、extraで渡したサービスは services に
// manualSourceUrl付きで入り、かつ実際の配信日時が不明なため曜日/時刻は変えないこと。
let extraOk = 0;
let extraNg = 0;
type TestExtra = {
  key: import("../lib/services.ts").ServiceKey;
  sourceUrl: string;
  confirmedDate: string;
  schedule?: { weekday: number; time: string; startDate: string };
};
function checkExtraMerge(
  name: string,
  w: AnnictWork,
  extra: TestExtra[],
  expectKeys: string[],
  expectWeekday: number | null,
  expectTime: string | null = null
) {
  const item = toAnimeItem(w, extra);
  const gotKeys = item.services.map((s) => s.key).sort();
  // extraで渡したkeyだけがmanualSourceUrlを持つべき（実データ由来のkeyは持たない）。
  const manualKeys = new Set(extra.map((e) => e.key));
  const sourceCorrect = item.services.every(
    (s) => !!s.manualSourceUrl === manualKeys.has(s.key as import("../lib/services.ts").ServiceKey)
  );
  const pass =
    JSON.stringify(gotKeys) === JSON.stringify([...expectKeys].sort()) &&
    sourceCorrect &&
    item.broadcastWeekday === expectWeekday &&
    item.broadcastTime === expectTime;
  if (pass) extraOk++; else extraNg++;
  console.log(
    `${pass ? "✓" : "✗"}  ${name.padEnd(28)} → services=${gotKeys.join(",")} weekday=${item.broadcastWeekday} time=${item.broadcastTime}` +
      (pass ? "" : `  (期待: services=${expectKeys.join(",")} weekday=${expectWeekday} time=${expectTime})`)
  );
}
checkExtraMerge(
  "programsゼロでも手動補完が入る（schedule無し）",
  work([]),
  [{ key: "prime", sourceUrl: "https://example.com/", confirmedDate: "2026-07-12" }],
  ["prime"],
  null // 実際の配信日時が無いため曜日は算出しない
);
checkExtraMerge("extra未指定なら従来通り", work([]), [], [], null);
// 2026-07-12実例: 片田舎のおっさん、剣聖になるⅡ。Annictに配信の実データが無いとき、
// 一次情報で確認したscheduleをフォールバックとして使う。
checkExtraMerge(
  "Annict実データが無ければscheduleをフォールバック使用",
  work([]),
  [
    {
      key: "prime",
      sourceUrl: "https://example.com/",
      confirmedDate: "2026-07-12",
      schedule: { weekday: 4, time: "00:15", startDate: "2026-07-09" },
    },
  ],
  ["prime"],
  4,
  "00:15"
);
// Annictに実データ（配信サービスのstartedAt）があれば、そちらを必ず優先する
// （人力scheduleが古くなっていても実データで上書きされることを保証する）。
checkExtraMerge(
  "Annict実データがあればscheduleより優先",
  work([{ channel: "ABEMA", startedAt: "2026-08-12T13:30:00Z" }]), // JST 水22:30
  [
    {
      key: "prime",
      sourceUrl: "https://example.com/",
      confirmedDate: "2026-07-12",
      schedule: { weekday: 4, time: "00:15", startDate: "2026-07-09" },
    },
  ],
  ["abema", "prime"],
  3,
  "22:30"
);
console.log(`結果（人力補完マージ）: ${extraOk} 件OK / ${extraNg} 件NG`);

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

// ── Threadsのハッシュタグ1個制限の回帰テスト ──
// Threadsは1投稿につきトピックタグを1つしか受け付けず、2つ目以降の「#タグ」は
// リンクにならず地の文として残る（Meta公式の仕様）。2026-07-27にスポットライト枠へ
// 作品名タグを足して1投稿2タグになり、Threadsの投稿末尾だけが崩れる状態になった。
// post-threads.js は toSingleHashtagText を通してから投稿する。他SNS（X/Bluesky/
// Mastodon）は複数タグが正常に機能するため本文を変えてはいけない＝この関数は
// 「末尾がハッシュタグだけの行」以外に触らないことも同時に固定する。
let tagOk = 0;
let tagNg = 0;
function checkSingleHashtag(name: string, input: string, expected: string) {
  const actual = toSingleHashtagText(input);
  const pass = actual === expected;
  if (pass) tagOk++; else tagNg++;
  console.log(
    `${pass ? "✓" : "✗"}  ${name.padEnd(40)} → ${JSON.stringify(actual.split("\n").pop())}` +
      (pass ? "" : `  (期待: ${JSON.stringify(expected.split("\n").pop())})`)
  );
}
checkSingleHashtag(
  "2タグ（スポットライト）は先頭だけ残す",
  "【どこで見れる？】闇芝居 十七期\n\nhttps://example.com/anime/17812\n#闇芝居 #2026年夏アニメ",
  "【どこで見れる？】闇芝居 十七期\n\nhttps://example.com/anime/17812\n#闇芝居"
);
checkSingleHashtag(
  "1タグはそのまま",
  "今週の注目作TOP5\n\nhttps://example.com/\n#2026年夏アニメ",
  "今週の注目作TOP5\n\nhttps://example.com/\n#2026年夏アニメ"
);
checkSingleHashtag(
  "タグ無しはそのまま",
  "アニメ視聴ガイドに新機能を追加しました。\n\nhttps://example.com/",
  "アニメ視聴ガイドに新機能を追加しました。\n\nhttps://example.com/"
);
checkSingleHashtag(
  "本文中の#（末尾行がタグだけでない）には触らない",
  "1位 #1 の作品はこちら\nhttps://example.com/",
  "1位 #1 の作品はこちら\nhttps://example.com/"
);
console.log(`結果（Threadsのタグ1個制限）: ${tagOk} 件OK / ${tagNg} 件NG`);

// ── 配信バッジの中に「別の遷移先のリンク」を入れないことの回帰テスト（2026-07-28導入）──
// 事故の経緯: 人力補完サービスの出典（ニュース記事）へのリンクを「✓」としてバッジの中に
// 置いていたため、Prime Videoのバッジを押したつもりで無関係な記事に飛ぶ状態になっていた。
// 配信サービスのバッジは「押したら、そのサービスに行ける」以外の遷移先を持ってはいけない。
// バッジ列（.svc-chips）の中に現れる href は、pickAffiliate→officialUrl で決まる href 変数
// ただ1つであること、を機械的に固定する（人の目のレビューに頼らない）。
// この検査が落ちたら、リンクをバッジの外（呼び出し側の出典注記など）に出すこと。
let badgeNg = 0;
{
  const src = readFileSync(new URL("../components/ServiceMarks.tsx", import.meta.url), "utf8");
  // 目印はJSXの className に限定する（コメント内の同名文字列に当たらないようにするため）。
  // svc-manual-note は2026-07-29にServiceMarks.tsx本体から撤去され呼び出し側（作品ページ）
  // に移ったため、バッジ列の終端は次の svc-disclosure ブロックとの間で取る。
  const start = src.indexOf('className="svc-chips"');
  const end = src.indexOf('className="svc-disclosure"', start);
  const chips = start >= 0 && end > start ? src.slice(start, end) : null;
  if (!chips) {
    badgeNg++;
    console.log("✗  ServiceMarks.tsx のバッジ列（.svc-chips〜.svc-disclosure）を特定できない");
    console.log("   → 構造を変えたなら、この検査の目印も更新すること（検査を消さない）");
  } else {
    const hrefs = [...chips.matchAll(/href=\{([^}]*)\}/g)].map((m) => m[1].trim());
    const pass = hrefs.length === 1 && hrefs[0] === "href";
    if (!pass) badgeNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"バッジ内のリンク先は配信サービスのみ".padEnd(36)} → ${JSON.stringify(hrefs)}` +
        (pass ? "" : `  (期待: ["href"]＝pickAffiliate/officialUrl。出典等はバッジの外に出す)`)
    );
  }
}
console.log(`結果（配信バッジの遷移先）: ${badgeNg === 0 ? 1 : 0} 件OK / ${badgeNg} 件NG`);

// ── 日付アンカー（anchorToSlotDate）の回帰テスト（2026-08-05導入）──
// GitHub Actionsのscheduleは予定より数時間遅れて発火する（実測最大6.4時間）。旧cron
// （1日1回・21:00 JST枠）はJST日付が変わるまで3時間しか余裕が無く、遅延した実行が
// 翌JST日にずれ込んだ結果、2回の実行が同じJST日付を見て本文が完全一致した
// （実例: Issue #31 は8/4 03:27 JST発火、#32は8/4 23:05 JST発火、どちらも同じ内容）。
// 「いまのJST時刻が枠の予定時刻より前なら、日付をまたいで遅延した実行＝前日の枠」という
// 判定（anchorToSlotDate）がこれを防ぐ核心なので、退行させないよう固定する。
let anchorOk = 0;
let anchorNg = 0;
// 引数はJST基準の年月日時分。Date.UTCで組んでから9時間分引き、UTC内部表現のDateにする
// （jstParts/anchorToSlotDateは常にUTC内部表現のDateを受け取りJSTへ変換する前提のため）。
function jstDate(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 9 * 60 * 60 * 1000);
}
function jstDateStr(d: Date): string {
  const { year, month, day } = jstParts(d);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
// シフトが起きないこと（=時刻そのものが変わらないこと）を固定する版。
function checkAnchorNoShift(name: string, now: Date, slotHour: number | null | undefined) {
  const shifted = anchorToSlotDate(now, slotHour);
  const pass = shifted.getTime() === now.getTime();
  if (pass) anchorOk++; else anchorNg++;
  console.log(
    `${pass ? "✓" : "✗"}  ${name.padEnd(46)} → シフト${pass ? "なし" : "あり"}（期待: シフトなし）`
  );
}
// シフト後のJST日付を固定する版。
function checkAnchorDate(name: string, now: Date, slotHour: number | null | undefined, expectDate: string) {
  const shifted = anchorToSlotDate(now, slotHour);
  const got = jstDateStr(shifted);
  const pass = got === expectDate;
  if (pass) anchorOk++; else anchorNg++;
  console.log(
    `${pass ? "✓" : "✗"}  ${name.padEnd(46)} → ${got}` + (pass ? "" : `  (期待: ${expectDate})`)
  );
}
// evening枠(hour=20): 予定時刻(20時)より前にJST日付が変わっていなければシフトしない。
checkAnchorNoShift("evening枠・8/6 23:00 JST実行はシフトしない", jstDate(2026, 8, 6, 23, 0), 20);
// evening枠(hour=20): 日付をまたいで遅延（8/7 00:30着火）→前日8/6の枠と判定し直す。
checkAnchorDate("evening枠・8/7 00:30 JST実行は8/6に戻る", jstDate(2026, 8, 7, 0, 30), 20, "2026-08-06");
// morning枠(hour=9): 予定通りの時刻ならシフトしない。
checkAnchorNoShift("morning枠・8/6 09:05 JST実行はシフトしない", jstDate(2026, 8, 6, 9, 5), 9);
// morning枠(hour=9): 日付をまたいで遅延（8/7 02:00着火）→前日8/6の枠と判定し直す。
checkAnchorDate("morning枠・8/7 02:00 JST実行は8/6に戻る", jstDate(2026, 8, 7, 2, 0), 9, "2026-08-06");
// slotHourが無い（手動実行等）ときは何もしない。
checkAnchorNoShift("slotHourがnullならシフトしない", jstDate(2026, 8, 6, 3, 0), null);
checkAnchorNoShift("slotHourがundefinedならシフトしない", jstDate(2026, 8, 6, 3, 0), undefined);
// 実際に起きた事故の再現（旧構成=1日1回21:00 JST枠、hour=21相当）。
// Issue #31 は8/3 18:26 JST着火相当のUTC、#32は8/4 14:04 JST着火相当のUTC
//（CLAUDE.mdの経緯記述をUTCのまま採用: 8/3 18:26 UTC発火 / 8/4 14:04 UTC発火）。
// アンカー無し（旧実装）だとどちらも同じJST日付8/4に丸まってしまい重複投稿の原因になるが、
// アンカーありなら「#31は前日21:00枠の遅延=8/3」「#32は当日21:00枠=8/4」と正しく別日になる。
{
  const run31 = new Date("2026-08-03T18:26:00Z");
  const run32 = new Date("2026-08-04T14:04:00Z");
  const unanchored31 = jstDateStr(run31);
  const unanchored32 = jstDateStr(run32);
  const anchored31 = jstDateStr(anchorToSlotDate(run31, 21));
  const anchored32 = jstDateStr(anchorToSlotDate(run32, 21));
  const pass =
    unanchored31 === "2026-08-04" &&
    unanchored32 === "2026-08-04" && // ← ここが事故の原因（アンカー無しだと2回とも8/4に見える）
    anchored31 === "2026-08-03" &&
    anchored32 === "2026-08-04" &&
    anchored31 !== anchored32; // ← アンカーありなら別日になる（これが直った状態）
  if (pass) anchorOk++; else anchorNg++;
  console.log(
    `${pass ? "✓" : "✗"}  ${"事故の再現（Issue #31/#32・アンカーで別日になる）".padEnd(46)} → ` +
      `アンカー無し=[${unanchored31},${unanchored32}] アンカー有り=[${anchored31},${anchored32}]` +
      (pass ? "" : "  (期待: アンカー無しは両方8/4、アンカー有りは8/3と8/4に分かれる)")
  );
}
console.log(`結果（日付アンカー）: ${anchorOk} 件OK / ${anchorNg} 件NG`);

// ── 時間帯枠（SLOTS）の回帰テスト（2026-08-05導入。同日中に「予定時刻ちょうどに1回
// 起動」方式から「1時間おきに起動していまがどの枠の時間帯かを自分で判定する」方式へ
// 設計変更）──
// GitHub Actionsのscheduleは予定通りに発火しない（実測遅延2.1〜6.4時間・中央値約5時間）
// ため、「cronに20時と書けば20時台に投稿される」という前提そのものをやめた。SLOTSは
// hourではなくfromHour/toHourの時間帯を持ち、slotForNow(now)がJST時刻からその枠を返す。
// 投稿の種類（kind）がどの枠のkindsにも含まれていないと、その投稿は永久にどの
// DIGEST_SLOTでも出力されなくなる（黙って消える）ため、それは引き続き機械的に固定する。
let slotNg = 0;
{
  const slotNames = Object.keys(SLOTS).sort();
  const pass1 = JSON.stringify(slotNames) === JSON.stringify(["evening", "morning", "noon"]);
  if (!pass1) slotNg++;
  console.log(
    `${pass1 ? "✓" : "✗"}  ${"SLOTSの枠は3つ（morning/noon/evening）".padEnd(40)} → ${JSON.stringify(slotNames)}` +
      (pass1 ? "" : `  (期待: ["evening","morning","noon"])`)
  );

  const expectedShape: Record<string, { fromHour: number; toHour: number; kinds: string[] }> = {
    morning: { fromHour: 9, toHour: 11, kinds: ["top5"] },
    noon: { fromHour: 12, toHour: 14, kinds: ["spotlight"] },
    evening: { fromHour: 18, toHour: 21, kinds: ["airing"] },
  };
  for (const key of Object.keys(expectedShape)) {
    const got = SLOTS[key];
    const exp = expectedShape[key];
    const pass =
      !!got &&
      got.fromHour === exp.fromHour &&
      got.toHour === exp.toHour &&
      JSON.stringify(got.kinds) === JSON.stringify(exp.kinds);
    if (!pass) slotNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${`SLOTS.${key}`.padEnd(40)} → fromHour=${got?.fromHour} toHour=${got?.toHour} kinds=${JSON.stringify(got?.kinds)}` +
        (pass ? "" : `  (期待: fromHour=${exp.fromHour} toHour=${exp.toHour} kinds=${JSON.stringify(exp.kinds)})`)
    );
  }

  // 各枠が fromHour<=toHour であり、かつ枠同士の時間帯が重なっていないこと。重なると
  // slotForNow の結果が Object.entries の定義順（＝オブジェクトのキー挿入順）に依存して
  // 不安定になる（「どちらの枠として判定されるか」がコードの見た目上わからなくなる）。
  const slotEntries = Object.entries(SLOTS) as [string, { fromHour: number; toHour: number }][];
  const rangeOk = slotEntries.every(([, s]) => s.fromHour <= s.toHour);
  let overlapOk = true;
  const overlaps: string[] = [];
  for (let i = 0; i < slotEntries.length; i++) {
    for (let j = i + 1; j < slotEntries.length; j++) {
      const [nameA, a] = slotEntries[i];
      const [nameB, b] = slotEntries[j];
      if (a.fromHour <= b.toHour && b.fromHour <= a.toHour) {
        overlapOk = false;
        overlaps.push(`${nameA}×${nameB}`);
      }
    }
  }
  const pass1b = rangeOk && overlapOk;
  if (!pass1b) slotNg++;
  console.log(
    `${pass1b ? "✓" : "✗"}  ${"各枠がfromHour<=toHourかつ枠同士が重ならない".padEnd(40)} → ${JSON.stringify(
      Object.fromEntries(slotEntries.map(([k, s]) => [k, [s.fromHour, s.toHour]]))
    )}` +
      (pass1b
        ? ""
        : `  (期待: 全枠fromHour<=toHour・重なりなし${overlaps.length ? ` / 重なり: ${overlaps.join(",")}` : ""})`)
  );

  // build-digest.js が実際に生成しうる kind をソースから機械的に拾い、SLOTSの
  // kindsの合計と過不足なく一致することを固定する（「配信バッジの遷移先」検査と同じ
  // 「ソースを読んで機械的に照合する」やり方に倣う）。
  const digestSrc = readFileSync(new URL("./lib/build-digest.js", import.meta.url), "utf8");
  const producedKinds = [...new Set([...digestSrc.matchAll(/kind:\s*"([^"]+)"/g)].map((m) => m[1]))].sort();
  const slotKinds = [...new Set(Object.values(SLOTS).flatMap((s: { kinds: string[] }) => s.kinds))].sort();
  const pass2 = JSON.stringify(producedKinds) === JSON.stringify(slotKinds);
  if (!pass2) slotNg++;
  console.log(
    `${pass2 ? "✓" : "✗"}  ${"SLOTSのkindsがbuild-digest.jsの生成kindを過不足なく覆う".padEnd(40)} → 生成=${JSON.stringify(producedKinds)} SLOTS=${JSON.stringify(slotKinds)}` +
      (pass2 ? "" : "  (期待: 一致。どこにも出ないkindがあると投稿が黙って消える)")
  );

  // slotForNow の境界の挙動を固定する（今回の設計変更の肝）。JSTの各時刻帯を与えて
  // 期待する枠を返すことを確認する（分は境界と紛れないよう30分を使う）。
  function checkSlotForNow(hour: number, expect: string | null) {
    const now = jstDate(2026, 8, 6, hour, 30);
    const got = slotForNow(now);
    const pass = got === expect;
    if (!pass) slotNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${`slotForNow(JST ${String(hour).padStart(2, "0")}時台)`.padEnd(40)} → ${JSON.stringify(got)}` +
        (pass ? "" : `  (期待: ${JSON.stringify(expect)})`)
    );
  }
  checkSlotForNow(8, null);
  checkSlotForNow(9, "morning");
  checkSlotForNow(11, "morning");
  checkSlotForNow(12, "noon");
  checkSlotForNow(14, "noon");
  checkSlotForNow(15, null);
  checkSlotForNow(16, null);
  checkSlotForNow(17, null);
  checkSlotForNow(18, "evening");
  checkSlotForNow(21, "evening");
  checkSlotForNow(22, null);
  checkSlotForNow(0, null);

  // .github/workflows/daily-digest.yml に投稿時刻がハードコードされていないことを固定する。
  // 【なぜこれを固定するのか】時間帯の定義（SLOTS）は build-digest.js だけが持つ設計に
  // なっている（daily-digest.ymlは起動のたびにscripts/current-slot.js経由でSLOTSに聞く
  // だけで、YAML自身は時刻を持たない）。もしYAML側に時刻付きのcron（例: "0 20 * * *"）や
  // 独自の枠判定ロジックが書き足されると、build-digest.jsのSLOTSと2箇所目の「時間帯の
  // 定義」が生まれ、どちらかだけ直したときにズレる（旧設計＝cronの時刻とSLOTS.hourの
  // 整合検査で防いでいたのと同じ種類の事故）。cronの形とcurrent-slot.jsの呼び出しを
  // 機械的に固定することで、この逆戻りを検出する。
  const ymlSrc = readFileSync(new URL("../.github/workflows/daily-digest.yml", import.meta.url), "utf8");
  const cronLines = [...ymlSrc.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
  // 5フィールド中、時以降（hour/day/month/weekday）が全てワイルドカード＝「毎時」起動。
  // 分（先頭の\d+）だけは混雑回避でずらしてよい値なので固定しない。
  const hourlyPattern = /^\d+\s+\*\s+\*\s+\*\s+\*$/;
  const pass3 = cronLines.length === 1 && hourlyPattern.test(cronLines[0]);
  if (!pass3) slotNg++;
  console.log(
    `${pass3 ? "✓" : "✗"}  ${"daily-digest.ymlのcronは1本だけ・毎時起動（時刻を持たない）".padEnd(40)} → cron=${JSON.stringify(cronLines)}` +
      (pass3 ? "" : `  (期待: cronが1本だけ・"<分> * * * *"の形。時の位置が*でないcronはNG)`)
  );

  const pass4 = /node\s+scripts\/current-slot\.js/.test(ymlSrc);
  if (!pass4) slotNg++;
  console.log(
    `${pass4 ? "✓" : "✗"}  ${"daily-digest.ymlがscripts/current-slot.jsで枠判定している".padEnd(40)} → ${pass4}` +
      (pass4 ? "" : "  (期待: node scripts/current-slot.js の呼び出しがある。枠判定を自前で書き直さない)")
  );
}
console.log(`結果（時間帯枠SLOTS）: ${slotNg === 0 ? 1 : 0} 件OK / ${slotNg} 件NG`);

if (
  ng > 0 ||
  scheduleNg > 0 ||
  bdNg > 0 ||
  queryNg > 0 ||
  extraNg > 0 ||
  tagNg > 0 ||
  badgeNg > 0 ||
  anchorNg > 0 ||
  slotNg > 0
)
  process.exit(1);
