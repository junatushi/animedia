import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyChannel, toAnimeItem } from "../lib/services.ts";
import { PROGRAMS_QUERY, PROGRAMS_QUERY_LIST } from "../lib/annict.ts";
import type { AnnictWork } from "../lib/types.ts";
import {
  buildEmbedSnippet,
  buildEmbedIframeSnippet,
  buildEmbedDocument,
  embedServiceSummary,
  type EmbedWork,
} from "../lib/embed.ts";
import { siteUrl } from "../lib/siteUrl.ts";
import { buildCalendar, CALENDAR_REF, type CalendarWork } from "../lib/calendar.ts";
import { aggregateYear, usableYears, currentState, pct } from "../lib/streamingTrends.ts";
import {
  airingStatus,
  buildWatchAnswer,
  buildWatchDescription,
  availabilityLabel,
  jstToday,
} from "../lib/workAvailability.ts";
import {
  toSingleHashtagText,
  SLOTS,
  BATCH_SLOTS,
  slotConfig,
  isMastodonBatchDue,
  anchorToSlotDate,
  slotForNow,
  dueSlots,
  jstParts,
} from "./lib/build-digest.js";
import { xPostUrl, xSearchUrl } from "./lib/x-intent.js";
// 日次の下書きIssueの本文組み立て（--issue）。require.main ガードがあるので
// importしてもネットワークへは出ない。
import printDigest from "./print-digest.js";
// 次クール準備の窓判定（2026-08-07追加）。純粋関数だけの、ネットワークに出ないモジュール。
import seasonPrep from "./lib/build-season-prep.js";
// 視聴プランの集合被覆（2026-08-07追加）。純粋関数のみ。
import { buildServicePlan } from "../lib/servicePlan.ts";
// Discordスラッシュコマンド（2026-08-07追加）。
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  verifyDiscordSignature,
  buildAnimeReply,
  buildCandidatesReply,
  buildUnavailableReply,
  messageResponse,
  MAX_CANDIDATES,
} from "../lib/discord.ts";
import { DISCORD_PUBLIC_KEY_FALLBACK } from "../content/discord/publicKey.ts";
import { currentSeasonKey, currentYearSeason } from "../lib/resolveSeasonParams.ts";
// 配信サービス追加の検知（2026-08-07追加）。純粋関数のみ。
import { applySightings } from "../lib/serviceAdditions.ts";
import { otherSeasonWorks, MIN_WORKS, type PersonIndex } from "../lib/personIndex.ts";
import { renderGrowthKit } from "./lib/build-growth-kit.js";


// ディレクトリ配下の .ts/.tsx を再帰的に列挙する（行動ログの配線検査で使う）。
function listSourceFiles(dir: URL): URL[] {
  const out: URL[] = [];
  for (const name of readdirSync(dir)) {
    const child = new URL(name, dir);
    let isDir = false;
    try {
      readdirSync(child);
      isDir = true;
    } catch {
      isDir = false;
    }
    if (isDir) out.push(...listSourceFiles(new URL(`${name}/`, dir)));
    else if (/\.tsx?$/.test(name)) out.push(child);
  }
  return out;
}

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
    morning: { fromHour: 7, toHour: 10, kinds: ["top5"] },
    noon: { fromHour: 11, toHour: 12, kinds: ["spotlight"] },
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
  // 【BATCH_SLOTSはこの重なり検査に含めない】この検査は SLOTS（Bluesky/Threads用。
  // slotForNow/dueSlotsがObject.entries順で「中にいる/開始済みの」枠を1つ選ぶ）だけが
  // 対象。BATCH_SLOTS.mastodon（5〜7時）は SLOTS.morning（7〜10時）と意図的に重なる
  // （Mastodonは時間帯で内容を絞らず1日1回まとめて出すだけなので、他の枠と重なっても
  // 「どちらとして判定されるか」が問題にならない。isMastodonBatchDueもslotForNow/
  // dueSlotsとは別の独立した判定関数）。BATCH_SLOTSをここに混ぜると、意図した重なりが
  // NG判定されてしまう。
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
  checkSlotForNow(6, null);
  checkSlotForNow(7, "morning");
  checkSlotForNow(8, "morning");
  checkSlotForNow(9, "morning");
  checkSlotForNow(10, "morning");
  checkSlotForNow(11, "noon");
  checkSlotForNow(12, "noon");
  checkSlotForNow(13, null);
  checkSlotForNow(14, null);
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

  // ── dueSlots（遅れ投稿）の回帰テスト（2026-08-05導入）──
  // GitHub Actionsのscheduleの間引き（実測: 本来1,046回中30回しか起動しない・起動間隔の
  // 中央値2.5時間・最大13時間）により、1時間おきに起動を頼んでも時間帯枠を丸ごと逃す日が
  // 約6日に1日ある。dueSlots(now) は「その日すでに開始時刻(fromHour)を迎えた枠」を
  // 時系列順（fromHourの昇順）で返し、daily-digest.yml が遅れ投稿の候補として使う。
  // 境界がズレると「取りこぼしても遅れて出る」が効かなくなる、または早すぎる時刻で
  // 未開始の枠を投げてしまう（内容がまだ無い/不自然）ので固定する。
  function checkDueSlots(hour: number, expect: string[]) {
    const now = jstDate(2026, 8, 6, hour, 30);
    const got = dueSlots(now);
    const pass = JSON.stringify(got) === JSON.stringify(expect);
    if (!pass) slotNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${`dueSlots(JST ${String(hour).padStart(2, "0")}時台)`.padEnd(40)} → ${JSON.stringify(got)}` +
        (pass ? "" : `  (期待: ${JSON.stringify(expect)})`)
    );
  }
  checkDueSlots(0, []);
  checkDueSlots(6, []);
  checkDueSlots(7, ["morning"]);
  checkDueSlots(8, ["morning"]);
  checkDueSlots(9, ["morning"]);
  checkDueSlots(10, ["morning"]);
  checkDueSlots(11, ["morning", "noon"]);
  checkDueSlots(12, ["morning", "noon"]);
  checkDueSlots(14, ["morning", "noon"]);
  checkDueSlots(16, ["morning", "noon"]);
  checkDueSlots(18, ["morning", "noon", "evening"]);
  checkDueSlots(21, ["morning", "noon", "evening"]);
  checkDueSlots(23, ["morning", "noon", "evening"]);

  // dueSlotsは必ずfromHourの昇順で返すこと。daily-digest.ymlは返り順で先頭から
  // 「古い枠から」拾って遅れ投稿するため、順序が崩れると新しい枠を先に投げてしまい、
  // 古い（より取りこぼしが長引いている）枠がいつまでも後回しになる。
  // 値そのものの一致（上のcheckDueSlots）とは別に、0〜23時全てで「返ってきた配列の
  // fromHourが単調非減少か」を機械的に確認する（SLOTSの定義順が変わっても効くように、
  // 期待値をハードコードせずSLOTSから逆算する）。
  let dueOrderNg = 0;
  for (let h = 0; h < 24; h++) {
    const got = dueSlots(jstDate(2026, 8, 6, h, 30));
    const hours = got.map((k) => (SLOTS as Record<string, { fromHour: number }>)[k].fromHour);
    const sorted = [...hours].sort((a, b) => a - b);
    if (JSON.stringify(hours) !== JSON.stringify(sorted)) dueOrderNg++;
  }
  if (dueOrderNg > 0) slotNg++;
  console.log(
    `${dueOrderNg === 0 ? "✓" : "✗"}  ${"dueSlotsは常にfromHour昇順で返す（0〜23時全時刻）".padEnd(40)} → 違反${dueOrderNg}件` +
      (dueOrderNg === 0 ? "" : "  (期待: 0件。遅れ投稿は古い枠から拾う設計のため順序が壊れると投稿順がおかしくなる)")
  );

  // slotForNow(いま時間帯の「中」にいる枠)が非nullなら、その枠は必ずdueSlots(その枠の
  // 開始時刻をもう過ぎている枠)にも含まれること。時間帯の中にいる＝開始時刻は当然過ぎて
  // いるはずなので、これが崩れるのは実装のバグ（片方だけいじって境界がズレた等）を示す。
  // 0〜23時の全時刻で確認する。
  let consistencyNg = 0;
  for (let h = 0; h < 24; h++) {
    const now = jstDate(2026, 8, 6, h, 30);
    const inWindow = slotForNow(now);
    if (inWindow != null && !dueSlots(now).includes(inWindow)) consistencyNg++;
  }
  if (consistencyNg > 0) slotNg++;
  console.log(
    `${consistencyNg === 0 ? "✓" : "✗"}  ${"slotForNowが非nullならdueSlotsにも含まれる（0〜23時全時刻）".padEnd(40)} → 違反${consistencyNg}件` +
      (consistencyNg === 0 ? "" : "  (期待: 0件。時間帯の中にいる枠は開始時刻を過ぎているはず)")
  );

  // ── current-slot.jsの出力キーがdaily-digest.ymlの参照キーを全部満たすことの回帰テスト
  // （2026-08-05導入）──
  // 【なぜこれを固定するのか】枠を1つ増やす／リネームするような変更で current-slot.js 側
  // だけ due_<枠名> の出力を足し忘れると、daily-digest.yml の steps.when.outputs.due_<枠名>
  // は常に空文字列（＝falsy）として扱われ、「その枠は遅れ投稿の対象にならない」という
  // 気づきにくい壊れ方をする（YAML側はエラーにならず黙って動く）。ymlが実際に参照している
  // steps.when.outputs.<キー> を機械的に拾い、current-slot.js のソースがそのキーを出力する
  // コードを持っているかを突き合わせる。
  {
    const ymlKeys = new Set([...ymlSrc.matchAll(/steps\.when\.outputs\.(\w+)/g)].map((m) => m[1]));
    // manual は「いまがどの枠の時間帯かを判定」ステップのrun:ブロックがecho "manual=..."で
    // 自分で出しているキーで、current-slot.jsの出力ではない（手動実行=workflow_dispatchの
    // 分岐でYAML側が直接足している）。よってcurrent-slot.js側に無くて構わないため対象から除外する。
    ymlKeys.delete("manual");

    // ソースを正規表現で読むのではなく、current-slot.js を**実際に実行して**出力キーを
    // 数える。ソースの見た目（テンプレートの有無）だけで判定すると、テンプレートは
    // 残したままループの対象を減らす、といった変更を見逃す（実際に見逃した）。
    // ネットワークには出ず、SLOTSを読んで時刻を見るだけのスクリプトなので実行して安全。
    const csOut = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./current-slot.js", import.meta.url))],
      { encoding: "utf8" }
    );
    const emittedKeys = new Set(
      csOut
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => line.split("=")[0].trim())
    );

    const missing = [...ymlKeys].filter((k) => !emittedKeys.has(k));
    const pass5 = missing.length === 0;
    if (!pass5) slotNg++;
    console.log(
      `${pass5 ? "✓" : "✗"}  ${"current-slot.jsがdaily-digest.ymlの参照キーを全部出力（manual除く）".padEnd(40)} → yml参照=${JSON.stringify(
        [...ymlKeys].sort()
      )} 出力=${JSON.stringify([...emittedKeys].sort())}` +
        (pass5 ? "" : `  (期待: yml参照キーが全部出力に含まれる。不足: ${JSON.stringify(missing)})`)
    );
  }

  // ── Mastodonのまとめ投稿枠（BATCH_SLOTS）の回帰テスト（2026-08-05追加。利用者の指定で
  // Mastodonだけ従来運用＝1日1回・その日の分をまとめて投稿、に戻した。
  // 2026-08-06に時間帯を21〜23時台から5〜7時台へ変更＝これも利用者の指定）──
  // BATCH_SLOTS は SLOTS と別物で「内容を絞る枠」ではなく「まとめて出す時刻」を表す。
  // kinds を持たないことが仕様そのもの（kinds が付くと slotConfig().kinds で絞り込みが
  // 働いてしまい、「その日の全投稿をまとめて出す」でなくなる）。キーが mastodon の1つ
  // だけであることも合わせて固定する。
  {
    const batchNames = Object.keys(BATCH_SLOTS).sort();
    const pass1 = JSON.stringify(batchNames) === JSON.stringify(["mastodon"]);
    if (!pass1) slotNg++;
    console.log(
      `${pass1 ? "✓" : "✗"}  ${"BATCH_SLOTSの枠はmastodonの1つだけ".padEnd(40)} → ${JSON.stringify(batchNames)}` +
        (pass1 ? "" : `  (期待: ["mastodon"])`)
    );

    const got = (BATCH_SLOTS as Record<string, { fromHour: number; toHour: number }>).mastodon;
    const hasKinds = !!got && "kinds" in got;
    const pass2 = !!got && got.fromHour === 5 && got.toHour === 7 && !hasKinds;
    if (!pass2) slotNg++;
    console.log(
      `${pass2 ? "✓" : "✗"}  ${"BATCH_SLOTS.mastodon".padEnd(40)} → fromHour=${got?.fromHour} toHour=${got?.toHour} kinds付き=${hasKinds}` +
        (pass2 ? "" : `  (期待: fromHour=5 toHour=7・kindsを持たない＝絞り込みをしない)`)
    );
  }

  // ── slotConfig の解決順の回帰テスト（2026-08-05追加）──
  // DIGEST_SLOT の値から設定を引く際、SLOTS（Bluesky/Threads用の時間帯枠）→
  // BATCH_SLOTS（Mastodon用のまとめ枠）の順で見て、どちらにも無ければ null
  // （絞り込みも日付固定もしない＝"all"や未設定＝手動実行用）を固定する。
  {
    function checkSlotConfig(name: string, arg: string | undefined, expect: unknown) {
      const got = slotConfig(arg as string);
      const pass = got === expect;
      if (!pass) slotNg++;
      console.log(
        `${pass ? "✓" : "✗"}  ${`slotConfig(${JSON.stringify(arg)})`.padEnd(40)} → ${JSON.stringify(got)}` +
          (pass ? "" : `  (期待: ${JSON.stringify(expect)})`)
      );
    }
    checkSlotConfig("evening→SLOTS.evening", "evening", SLOTS.evening);
    checkSlotConfig(
      "mastodon→BATCH_SLOTS.mastodon",
      "mastodon",
      (BATCH_SLOTS as Record<string, unknown>).mastodon
    );
    checkSlotConfig("all→null", "all", null);
    checkSlotConfig("undefined→null", undefined, null);
  }

  // ── isMastodonBatchDue の境界の回帰テスト（2026-08-05追加）──
  // JST時刻が5時（BATCH_SLOTS.mastodon.fromHour）以降ならtrue。dueSlotsと同じ
  // 「開始時刻を迎えたら、その日のうちは遅れてでも投げる」考え方。
  // 【5時起点にした副作用・2026-08-06】遅れ投稿を許す窓が3時間（21〜24時）から
  // 19時間（5〜24時）に広がる。これは意図した挙動で、内容が「その日の放送・配信」
  // ＝JST日付が変わらない限り古くならないため、消えるより遅れて出す方がよい。
  // 深夜（0〜4時台）がfalseであることは、日付をまたいだ遅延実行を前日分として
  // 投げ直してしまわないための境界なので必ず維持する。
  {
    function checkMastodonDue(hour: number, expect: boolean) {
      const now = jstDate(2026, 8, 6, hour, 30);
      const got = isMastodonBatchDue(now);
      const pass = got === expect;
      if (!pass) slotNg++;
      console.log(
        `${pass ? "✓" : "✗"}  ${`isMastodonBatchDue(JST ${String(hour).padStart(2, "0")}時台)`.padEnd(40)} → ${got}` +
          (pass ? "" : `  (期待: ${expect})`)
      );
    }
    checkMastodonDue(4, false);
    checkMastodonDue(5, true);
    checkMastodonDue(7, true);
    checkMastodonDue(9, true); // 5〜7時台を逃した日の遅れ投稿（その日のうちなら出す）
    checkMastodonDue(23, true);
    checkMastodonDue(0, false); // 日付をまたいだ遅延実行は前日分を投げ直さない
    checkMastodonDue(3, false);
  }

  // ── SLOTS と BATCH_SLOTS のキーが衝突しないことの回帰テスト（2026-08-05追加）──
  // 同じ名前のキーが両方にあると、slotConfig の `SLOTS[name] || BATCH_SLOTS[name]`
  // という解決順のせいで「常にSLOTS側が勝つ」という挙動になり、BATCH_SLOTS側の設定
  // （kindsを持たない＝まとめ投稿）に意図通り切り替わらなくなる。
  {
    const collide = Object.keys(SLOTS).filter((k) => k in BATCH_SLOTS);
    const pass = collide.length === 0;
    if (!pass) slotNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"SLOTSとBATCH_SLOTSのキーが衝突しない".padEnd(40)} → 衝突${collide.length}件` +
        (pass ? "" : `  (期待: 0件。衝突: ${JSON.stringify(collide)})`)
    );
  }
}
console.log(`結果（時間帯枠SLOTS）: ${slotNg === 0 ? 1 : 0} 件OK / ${slotNg} 件NG`);

// ─────────────────────────────────────────────
// 過去クール索引（content/archive/index.json）がスナップショットと一致するかの検査
// （2026-08-05追加）
//
// この索引は sitemap.xml に「過去クールのシーズンページ・作品ページ」を載せるための
// 元データ。content/snapshots/ を追加・再生成したのに索引を作り直し忘れると、
// 新しいクールが検索エンジンに知られないまま（あるいは消えた作品IDを送り続けたまま）に
// なるが、画面上は何も壊れないので気づけない。ここで機械的に検出する。
// ズレていたら `node scripts/build-archive-index.ts` を実行すれば直る。
// ─────────────────────────────────────────────
console.log("\n── 過去クール索引（sitemap用）──");
let archiveNg = 0;
{
  const { buildArchiveIndex, readSnapshots } = await import("./build-archive-index.ts");
  const expected = buildArchiveIndex(readSnapshots());
  const actual = JSON.parse(
    readFileSync(new URL("../content/archive/index.json", import.meta.url), "utf8")
  );
  const same = JSON.stringify(expected) === JSON.stringify(actual);
  if (!same) archiveNg++;
  const seasons = expected.seasons.length;
  const works = expected.seasons.reduce((n, s) => n + s.workIds.length, 0);
  console.log(
    `${same ? "✓" : "✗"}  ${"index.jsonがcontent/snapshots/と一致".padEnd(40)} → ` +
      `シーズン${seasons}件・作品${works}件` +
      (same ? "" : "  (不一致: node scripts/build-archive-index.ts を実行してください)")
  );

  // 索引に載せるのは「配信サービスが1件以上ある作品」だけ、という収録方針の検査。
  // 配信0件の作品ページは「配信情報なし」としか答えられない薄いページなので、
  // 大量にsitemapへ送るとサイト全体の評価を下げうる（build-archive-index.ts 冒頭参照）。
  const snapshots = readSnapshots();
  let leaked = 0;
  for (const { year, season, data } of snapshots) {
    const entry = expected.seasons.find((s) => s.year === year && s.season === season);
    if (!entry) continue;
    const listed = new Set(entry.workIds);
    for (const it of data.items) {
      if (listed.has(it.id) && it.services.length === 0) leaked++;
    }
  }
  const noLeak = leaked === 0;
  if (!noLeak) archiveNg++;
  console.log(
    `${noLeak ? "✓" : "✗"}  ${"配信0件の作品をsitemapに載せていない".padEnd(40)} → 混入${leaked}件` +
      (noLeak ? "" : "  (期待: 0件)")
  );
}
console.log(`結果（過去クール索引）: ${archiveNg === 0 ? 2 : 0} 件OK / ${archiveNg} 件NG`);

// ─────────────────────────────────────────────
// 声優の出演作索引（content/archive/people.json）の検査（2026-08-07追加）
//
// /person/[name]/[year]/[season] の「他のクールの出演作」の元データ。
// 過去クール索引と同じで、スナップショットを更新したのに作り直し忘れると
// 画面は壊れないまま中身だけ古くなる。
// ズレていたら `node scripts/build-person-index.ts` を実行すれば直る。
// ─────────────────────────────────────────────
console.log("\n── 声優の出演作索引 ──");
let peopleNg = 0;
{
  const { buildPersonIndex } = await import("./build-person-index.ts");
  const { readSnapshots } = await import("./build-archive-index.ts");
  const snapshots = readSnapshots();
  const expected = buildPersonIndex(snapshots);
  const actual = JSON.parse(
    readFileSync(new URL("../content/archive/people.json", import.meta.url), "utf8")
  ) as PersonIndex;

  const same = JSON.stringify(expected) === JSON.stringify(actual.people);
  if (!same) peopleNg++;
  const total = Object.values(expected).reduce((n, w) => n + w.length, 0);
  console.log(
    `${same ? "✓" : "✗"}  ${"people.jsonがcontent/snapshots/と一致".padEnd(40)} → ` +
      `${Object.keys(expected).length}人・出演${total}件` +
      (same ? "" : "  (不一致: node scripts/build-person-index.ts を実行してください)")
  );

  // 収録方針: 配信情報が1件も無い作品は載せない（過去クール索引と同じ理由）。
  // ここが崩れると、作品ページに飛んでも「配信情報なし」としか書いていない
  // リンクを声優ページから大量に生やすことになる。
  const noServices = new Set<string>();
  for (const { data } of snapshots) {
    for (const it of data.items) if (it.services.length === 0) noServices.add(it.id);
  }
  const leaked = Object.values(expected)
    .flat()
    .filter(([id]) => noServices.has(id)).length;
  if (leaked > 0) peopleNg++;
  console.log(
    `${leaked === 0 ? "✓" : "✗"}  ${"配信0件の作品を載せていない".padEnd(40)} → 混入${leaked}件`
  );

  // 1作品しか無い人を載せない（クール別ページと中身が同じになるため）。
  const thin = Object.entries(expected).filter(([, w]) => w.length < MIN_WORKS).length;
  if (thin > 0) peopleNg++;
  console.log(
    `${thin === 0 ? "✓" : "✗"}  ${`出演${MIN_WORKS}作品未満の人を載せていない`.padEnd(40)} → ${thin}人`
  );

  // 表示側は「そのクールに出ていた分」を二重に出さない（クール別ページが既に出している）。
  const sampleName = Object.keys(expected)[0];
  const sample = expected[sampleName]?.[0];
  const filtered = sample
    ? otherSeasonWorks({ generatedAt: "", people: expected }, sampleName, sample[2], sample[3])
    : [];
  const excluded = sample ? !filtered.some(([id]) => id === sample[0]) : false;
  if (!excluded) peopleNg++;
  console.log(
    `${excluded ? "✓" : "✗"}  ${"otherSeasonWorksが同一クールを除く".padEnd(40)} → ${sampleName ?? "(データなし)"}`
  );
}
console.log(`結果（声優の出演作索引）: ${peopleNg === 0 ? 4 : 0} 件OK / ${peopleNg} 件NG`);

// ─────────────────────────────────────────────
// 声優データの取りこぼし（2026-08-11追加・重大度高）
//
// シーズン一覧のGraphQLは長らく casts(first: 5) しか取っておらず、「一覧は主要5件で
// 足りる」という前提が誤っていた。castNames は検索欄の声優名マッチ・声優ページの
// 出演作一覧・作品ページの声優リンクの判定・sitemapの選定・過去クールの声優索引の
// **全部**が参照している。実データでは2025夏の172作品中87作品（50.6%）が
// ちょうど5件＝上限で切られており、6番目以降の声優は「出演していない」のと同じ
// 扱いになっていた（利用者からの指摘: 悠木碧が作品ページでリンクにならず、検索でも
// 1作品しかヒットしない）。しかも「そのクールに2作品以上」という閾値と噛み合って、
// リンクも声優ページも消える形で壊れる。画面にはエラーが出ないので気づけない。
// 転送量は実測でJSON全体の3.3%しかなく、件数をケチる理由が無い。
// ─────────────────────────────────────────────
console.log("\n── 声優データの取りこぼし ──");
let castsNg = 0;
{
  const annictSrc = readFileSync(new URL("../lib/annict.ts", import.meta.url), "utf8");
  // 一覧クエリが要求するキャスト件数。主要キャストを取りこぼさない下限。
  const MIN_CASTS_LIST = 20;
  const listCount = Number(/const CASTS_LIST = (\d+);/.exec(annictSrc)?.[1] ?? "0");
  const detailCount = Number(/const CASTS_DETAIL = (\d+);/.exec(annictSrc)?.[1] ?? "0");

  const sitemapSrc = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
  const personPageSrc = readFileSync(
    new URL("../app/person/[name]/[year]/[season]/page.tsx", import.meta.url),
    "utf8"
  );

  const cases: { label: string; ok: boolean; detail: string }[] = [
    {
      label: "一覧クエリのキャスト件数が十分",
      ok: listCount >= MIN_CASTS_LIST,
      detail: `CASTS_LIST=${listCount}（下限${MIN_CASTS_LIST}）`,
    },
    {
      label: "一覧が作品ページより少なく取らない",
      ok: listCount >= detailCount,
      detail: `一覧${listCount} / 個別${detailCount}`,
    },
    // 閾値を各所に直書きすると、sitemapに載せた声優ページがページ側で404になる
    // （またはその逆で載せ漏らす）。定数を1箇所に持つこと。
    {
      label: "sitemapが声優ページの閾値を直書きしない",
      ok: sitemapSrc.includes("PERSON_PAGE_MIN_APPEARANCES"),
      detail: "lib/personPage.ts の定数を使う",
    },
    {
      label: "声優ページ側も同じ定数を使う",
      ok: personPageSrc.includes("PERSON_PAGE_MIN_APPEARANCES"),
      detail: "lib/personPage.ts の定数を使う",
    },
    // GSCの実測でいちばん成果の出ているページ種別。過去クール分は
    // content/archive/people.json から載せる（Annictへの追加取得は不要）。
    {
      label: "sitemapが過去クールの声優ページを載せる",
      ok: sitemapSrc.includes("people.json"),
      detail: "content/archive/people.json を参照する",
    },
  ];
  for (const c of cases) {
    if (!c.ok) castsNg++;
    console.log(
      `${c.ok ? "\u2713" : "\u2717"}  ${c.label.padEnd(40)} \u2192 ${c.ok ? c.detail : `NG: ${c.detail}`}`
    );
  }
}
console.log(
  `結果（声優データの取りこぼし）: ${5 - castsNg} 件OK / ${castsNg} 件NG`
);

// ─────────────────────────────────────────────
// 作品ページ title の幅の検査（2026-08-05追加）
//
// 検索結果の日本語titleは概ね全角30〜33文字で切られる。2026-07-27に
// 「検索語に近づける」ためtitleへ配信サービス名を入れたとき幅を見ていなかったため、
// 2025年の実データ335作品で中央値47文字・99%が30文字超になり、入れたはずの
// サービス名がほぼ全作品で表示前に切り捨てられていた。同じ後戻りを防ぐ。
// ─────────────────────────────────────────────
console.log("\n── 作品ページ title の幅 ──");
let titleNg = 0;
{
  const { buildWorkTitle, displayWidth: width, TITLE_WIDTH_BUDGET: BUDGET } = await import(
    "../lib/workTitle.ts"
  );

  // 作品名が短ければサービス名が入り、長ければ作品名だけになる（作品名は削らない）。
  const cases: Array<[string, string[], (t: string) => boolean, string]> = [
    [
      "ダンダダン 第2期",
      ["DMM TV", "dアニメ", "U-NEXT", "ABEMA", "Netflix"],
      (t) => t.includes("DMM TV") && width(t) <= BUDGET,
      "短い作品名にはサービス名が入る",
    ],
    [
      "Re:ゼロから始める異世界生活 3rd season 反撃編",
      ["dアニメ", "ABEMA", "U-NEXT"],
      (t) => t.startsWith("Re:ゼロから始める異世界生活 3rd season 反撃編はどこで配信？"),
      "長い作品名でも作品名は削られない",
    ],
    ["薬屋のひとりごと 第2期", [], (t) => t === "薬屋のひとりごと 第2期はどこで配信？", "配信0件でも成立する"],
  ];
  for (const [workTitle, services, ok, label] of cases) {
    const t = buildWorkTitle(workTitle, services);
    const pass = ok(t);
    if (!pass) titleNg++;
    console.log(`${pass ? "✓" : "✗"}  ${label.padEnd(34)} → ${t}（幅${width(t)}）`);
  }

  // 実データ（スナップショット全件）で、作品名自体が予算内に収まる作品は
  // 必ずtitle全体も予算内に収まること。作品名だけで予算を超える作品は対象外
  // （削れないため。その場合もサービス名は足さない＝base のままであることを見る）。
  const { readSnapshots: readSnaps } = await import("./build-archive-index.ts");
  const snaps = readSnaps();
  let over = 0;
  let checked = 0;
  for (const { data } of snaps) {
    for (const it of data.items) {
      const shorts = it.services.map((s) => s.short);
      const t = buildWorkTitle(it.title, shorts);
      const base = `${it.title}はどこで配信？`;
      checked++;
      if (width(base) <= BUDGET) {
        if (width(t) > BUDGET) over++;
      } else if (t !== base) {
        // 作品名だけで予算超過なのにサービス名まで足していたらNG。
        over++;
      }
    }
  }
  const pass = over === 0;
  if (!pass) titleNg++;
  console.log(
    `${pass ? "✓" : "✗"}  ${"実データ全件が幅の予算を守る".padEnd(34)} → ${checked}件中 超過${over}件` +
      (pass ? "" : "  (期待: 0件)")
  );
}
console.log(`結果（titleの幅）: ${titleNg === 0 ? 4 : 0} 件OK / ${titleNg} 件NG`);

// ─────────────────────────────────────────────
// SNS投稿に貼るリンクの検査（2026-08-05追加）
//
// 投稿本文のリンクは `/?year=&season=` ではなく `/season/{year}/{season}` を指すこと。
// トップページの canonical は "/" なので、クエリ付きトップを貼っても検索エンジンには
// 「/」の重複URLとしか見えず、実際に順位を取らせたいシーズンページには何も渡らない。
// スクリーンショットの撮影先だけは、撮影用クエリ（view=calendar / ranking=open）を
// 解釈できるトップページのままでよい（/season/... は固定表示モードで読まない）。
// ─────────────────────────────────────────────
console.log("\n── SNS投稿のリンク先 ──");
let linkNg = 0;
{
  const src = readFileSync(new URL("./lib/build-digest.js", import.meta.url), "utf8");
  // 本文に使う共有URLは全て /season/ 形式であること。
  const shareDecls = [...src.matchAll(/const (shareUrl|url) = `\$\{SITE_URL\}([^`]*)`/g)];
  const bad = shareDecls.filter(([, , path]) => !path.startsWith("/season/"));
  const pass = shareDecls.length > 0 && bad.length === 0;
  if (!pass) linkNg++;
  console.log(
    `${pass ? "✓" : "✗"}  ${"本文のリンクはシーズンページを指す".padEnd(36)} → ${shareDecls.length}箇所中 違反${bad.length}件` +
      (pass ? "" : `  (違反: ${JSON.stringify(bad.map((m) => m[2]))})`)
  );

  // 撮影用URLはクエリを付けられる形（トップ + ?）であること。
  const shotOk = /const shotUrl = `\$\{SITE_URL\}\/\?year=/.test(src);
  if (!shotOk) linkNg++;
  console.log(
    `${shotOk ? "✓" : "✗"}  ${"撮影用URLはクエリ付きトップのまま".padEnd(36)} → ${shotOk ? "OK" : "見つからない"}`
  );

  // 【2026-08-06追加】週次X成長キット（build-growth-kit.js）も同じ規則で検査する。
  // 2026-08-05に日次投稿（build-digest.js）のリンク先を /season/ 形式へ直したとき、
  // この検査が build-digest.js しか見ていなかったため、週次キット側が
  // `${SITE_URL}/?year=&season=` のまま残っていたのに緑で通っていた。
  // 「SNS投稿のリンク先」という同じ不変条件を持つファイルは全部ここで見る。
  const kit = readFileSync(new URL("./lib/build-growth-kit.js", import.meta.url), "utf8");
  // 文字列リテラルの中（コメントの引用や説明文）ではなく、URL変数の宣言だけを見る。
  const kitDecls = [...kit.matchAll(/const (seasonUrl|shareUrl|url) = `\$\{SITE_URL\}([^`]*)`/g)];
  const kitBad = kitDecls.filter(([, , path]) => !path.startsWith("/season/"));
  const kitPass = kitDecls.length > 0 && kitBad.length === 0;
  if (!kitPass) linkNg++;
  console.log(
    `${kitPass ? "✓" : "✗"}  ${"週次X成長キットのリンクもシーズンページ".padEnd(36)} → ${kitDecls.length}箇所中 違反${kitBad.length}件` +
      (kitPass ? "" : `  (違反: ${JSON.stringify(kitBad.map((m) => m[2]))})`)
  );
}
console.log(`結果（SNS投稿のリンク先）: ${linkNg === 0 ? 3 : 0} 件OK / ${linkNg} 件NG`);

// ─────────────────────────────────────────────
// Xの手動運用リンク（Web Intent）の検査（2026-08-06追加）
//
// Xへの投稿・リプは手動運用（X APIが2026年2月に有料化）で、週次成長キットの
// GitHub Issueが下書きを配る。ところが実測では、日次の投稿下書きIssueは
// 7/20〜7/30こそ毎日closeされていたのに7/31以降は7件が連続でopenのまま、
// **週次成長キット（#22・#30）に至っては一度もcloseされずコメントも0**だった。
// フォロワーを増やすのはキットの「リーチ（会話に入る）」の部分なので、そこが
// 一度も回っていないことが「Xフォロワー0」の直接の原因にあたる。
// 手数を減らすため、下書きの隣にタップ1回でXの投稿画面/検索結果が開くリンクを置いた。
// このリンクが壊れる（エンコード漏れで # 以降が落ちる等）と静かに無効化されるので、
// 組み立て関数を直接呼んで固定する。
// ─────────────────────────────────────────────
console.log("\n── Xの手動運用リンク（Web Intent）──");
let xIntentNg = 0;
{
  // 本文に # と改行とURLを含む、実運用に近い入力。
  const sample = "【テスト】1社だけ\n#今期アニメ\nhttps://example.com/a?b=c";
  const postUrl = xPostUrl(sample);
  // 期待: text= 以降は完全にエンコードされ、生の # / 改行 / & が残らないこと。
  // （残ると # 以降がフラグメント扱いで丸ごと落ち、ハッシュタグとURLが消えた
  //   本文がXの投稿画面に出る。目視では「なんとなく短い」だけなので気づきにくい）
  const q = postUrl.slice(postUrl.indexOf("text=") + 5);
  const rawOk = !/[#\n&]/.test(q);
  const roundTripOk = decodeURIComponent(q) === sample;
  const originOk = postUrl.startsWith("https://x.com/intent/post?text=");
  const p1 = rawOk && roundTripOk && originOk;
  if (!p1) xIntentNg++;
  console.log(
    `${p1 ? "✓" : "✗"}  ${"xPostUrlが本文を完全にエンコードする".padEnd(40)} → 生の#/改行/&なし=${rawOk} 復元一致=${roundTripOk} 宛先=${originOk}`
  );

  // 検索は「最新」タブ固定。困りごとは鮮度が命で、既定の「話題」タブだと
  // 何日も前の投稿が出てリプライしても会話にならない。
  const searchUrl = xSearchUrl('"どこで見れる" アニメ -filter:links');
  const liveOk = searchUrl.endsWith("&f=live");
  const searchEncOk = !/[ "]/.test(searchUrl.slice(searchUrl.indexOf("q=") + 2));
  const p2 = liveOk && searchEncOk && searchUrl.startsWith("https://x.com/search?q=");
  if (!p2) xIntentNg++;
  console.log(
    `${p2 ? "✓" : "✗"}  ${"xSearchUrlは最新タブ固定でエンコード済み".padEnd(40)} → f=live=${liveOk} 生の空白/引用符なし=${searchEncOk}`
  );

  // キットのIssue本文に、実際にワンタップのリンクが出ていること
  // （組み立て関数だけ直っていて配線を忘れる、という壊れ方を防ぐ）。
  const md = renderGrowthKit({
    year: 2026,
    label: "夏",
    todayStr: "2026-08-06",
    count: 1,
    drafts: [{ label: "テスト", text: "本文\n#今期アニメ" }],
    queries: ["今期アニメ どこで見れる"],
    replies: ["テスト返信"],
  });
  const hasPost = md.includes("https://x.com/intent/post?text=");
  const hasSearch = md.includes("https://x.com/search?q=");
  const p3 = hasPost && hasSearch;
  if (!p3) xIntentNg++;
  console.log(
    `${p3 ? "✓" : "✗"}  ${"キット本文にワンタップのリンクが出る".padEnd(40)} → 投稿=${hasPost} 検索=${hasSearch}`
  );

  // 日次の下書きIssueにも同じリンクが入っていること（2026-08-07追加）。
  // 週次キットにだけ入れて日次を忘れていた期間があり、**毎日やる側**の手数が
  // 減らないままだった（日次のIssueは7/31以降7件が連続でopen）。
  // ワークフローが --issue を落とすとベタ書きに戻り、静かに元の運用へ逆戻りする。
  const digestYml = readFileSync(new URL("../.github/workflows/daily-digest.yml", import.meta.url), "utf8");
  const ymlOk = /print-digest\.js\s+--issue/.test(digestYml);
  // 本文は組み立て関数を直接呼んで確かめる（文字列grepだと書き換えに追随できない）。
  // 本文に # と改行を含む、実運用に近い入力。
  const issueMd = printDigest.renderIssue([{ kind: "top5", text: "【テスト】1話\n#今期アニメ" }]);
  const mdOk =
    issueMd.includes("https://x.com/intent/post?text=") &&
    issueMd.includes("注目作TOP5") &&
    issueMd.includes("【テスト】1話"); // コピー用のコードブロックも残っていること
  const p4 = ymlOk && mdOk;
  if (!p4) xIntentNg++;
  console.log(
    `${p4 ? "✓" : "✗"}  ${"日次の下書きIssueもワンタップで開く".padEnd(40)} → ワークフローが--issue=${ymlOk} 本文にリンクと下書き=${mdOk}`
  );
}
console.log(`結果（Xの手動運用リンク）: ${xIntentNg === 0 ? 4 : 0} 件OK / ${xIntentNg} 件NG`);

// ─────────────────────────────────────────────
// SSRの中身が空にならないことの検査（2026-08-05追加・重大度高）
//
// useSearchParams() を呼ぶクライアントコンポーネントがあると、Next.js 14 は静的生成
// （ISR）されるページでその Suspense 境界を丸ごとクライアント描画へ退避させ、
// サーバーHTMLには fallback しか出力しなくなる。
// 実際、SeasonExplorer がこれを呼んでいたせいで /season/[year]/[season] の本番HTMLは
// h1が0個・作品への<a href="/anime/..">が0個・可視テキスト0文字（中身はJSON-LDだけ、
// 188KBのうち本文ゼロ）だった。「SEO用のSSRページ」が実際には空を返していたことになる。
// 画面はクライアント描画で正常に見えるので、人間の目視では絶対に気づけない。
// クエリの読み取りは TopPageExplorer（トップページ専用の薄いラッパー）に閉じ込める。
// ─────────────────────────────────────────────
console.log("\n── SSRの中身（useSearchParamsの巻き込み）──");
let ssrNg = 0;
{
  // クエリを読んでよいのは TopPageExplorer（トップページ専用の薄いラッパー）だけ。
  // それ以外の components/ はすべて /season/** や /anime/** のSSRに乗りうるので、
  // useSearchParams を呼んだ時点でそのページのサーバーHTMLが空になる。
  // 2026-08-06にSeasonExplorer限定から全コンポーネントの検査へ広げた（新しく足した
  // クライアントコンポーネントが同じ穴を空けても気づけるように）。
  const ALLOWED_TO_READ_QUERY = new Set(["TopPageExplorer.tsx"]);
  const componentsDir = new URL("../components/", import.meta.url);
  const offenders = readdirSync(componentsDir)
    .filter((f) => f.endsWith(".tsx") && !ALLOWED_TO_READ_QUERY.has(f))
    .filter((f) => {
      const src = readFileSync(new URL(f, componentsDir), "utf8");
      // コメント行（なぜ呼ばないのかの説明）に名前が出てくるのは正常なので、
      // 実際の import 文だけを見る。
      return src.split("\n").some((l) => /^\s*import\b/.test(l) && /useSearchParams/.test(l));
    });
  const clean = offenders.length === 0;
  if (!clean) ssrNg++;
  console.log(
    `${clean ? "✓" : "✗"}  ${"components/がuseSearchParamsを呼ばない".padEnd(40)} → ` +
      (clean
        ? `OK（${[...ALLOWED_TO_READ_QUERY].join("・")}のみ許可）`
        : `${offenders.join("・")} が呼んでいる（SSRが空になります。TopPageExplorer側へ寄せてください）`)
  );

  // シーズンページは SeasonExplorer を直接使うこと（TopPageExplorer を挟むと
  // そちらが useSearchParams を呼ぶため、同じ理由でSSRが空になる）。
  const seasonPage = readFileSync(
    new URL("../app/season/[year]/[season]/page.tsx", import.meta.url),
    "utf8"
  );
  const direct = !/TopPageExplorer/.test(seasonPage) && /SeasonExplorer/.test(seasonPage);
  if (!direct) ssrNg++;
  console.log(
    `${direct ? "✓" : "✗"}  ${"シーズンページはSeasonExplorerを直接使う".padEnd(40)} → ${direct ? "OK" : "TopPageExplorer経由になっている"}`
  );
}
console.log(`結果（SSRの中身）: ${ssrNg === 0 ? 2 : 0} 件OK / ${ssrNg} 件NG`);

// ─────────────────────────────────────────────
// 配信先ウィジェット（他サイトへの埋め込み）の不変条件（2026-08-06追加）
//
// 埋め込みは**他人のサイトの中で表示される**ため、事故の影響が自サイトに閉じない。
// CLAUDE.mdの「配信バッジの遷移先」と同じ重大度で、以下を機械的に固定する:
//   ① 埋め込みHTMLに入るリンクは自サイト（siteUrl）配下だけ。アフィリエイトリンクや
//      配信サービスの公式サイトへのリンクを混ぜない（他人のブログに自分の広告リンクを
//      埋めるのはステマ規制・ASP規約の両面で事故になり、貼る側の信頼も壊す）。
//   ② <script> を含めない。他人のサイトで実行されるJSを配らない。
//   ③ 作品名などの外部由来文字列は必ずエスケープする（HTMLが壊れる／注入される）。
//   ④ 流入計測のための ?ref=embed が付く。
// この検査を消したり、リンクを増やしたりしないこと。
// ─────────────────────────────────────────────
console.log("\n── 配信先ウィジェットの不変条件 ──");
let embedNg = 0;
{
  function embedCheck(name: string, pass: boolean, detail: string) {
    if (!pass) embedNg++;
    console.log(`${pass ? "✓" : "✗"}  ${name.padEnd(38)} → ${detail}`);
  }

  const sample: EmbedWork = {
    id: 14132,
    title: "テスト作品",
    services: [
      { key: "d_anime", short: "dアニメ", name: "dアニメストア", color: "#ff7a00" },
      { key: "abema", short: "ABEMA", name: "ABEMA", color: "#22c55e" },
      { key: "unext", short: "U-NEXT", name: "U-NEXT", color: "#8b5cf6" },
      { key: "netflix", short: "Netflix", name: "Netflix", color: "#e50914" },
    ],
    otherServices: ["どこかの配信"],
    hasBroadcastData: true,
    // 現在クール（＝放送中）の作品として扱わせる。放送終了作品の出し分けは
    // このあとの「放送終了作品に現在形で断定しない」節で検査する。
    broadcastStartDate: "2026-07-05",
  };

  const snippet = buildEmbedSnippet(sample, "2026-08-06");
  const iframe = buildEmbedIframeSnippet(sample);
  const doc = buildEmbedDocument(sample, "2026-08-06");

  // ① リンク先は自サイトだけ（href/src の両方を見る）。
  for (const [label, html] of [
    ["HTMLスニペット", snippet],
    ["iframeスニペット", iframe],
    ["iframe本体のHTML", doc],
  ] as const) {
    const urls = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    const outside = urls.filter((u) => !u.startsWith(siteUrl));
    embedCheck(
      `${label}のリンク先は自サイトのみ`,
      urls.length > 0 && outside.length === 0,
      outside.length === 0 ? `${urls.length}件すべて ${siteUrl} 配下` : `外部リンク混入: ${JSON.stringify(outside)}`
    );
    embedCheck(`${label}に<script>が無い`, !/<script/i.test(html), /<script/i.test(html) ? "検出" : "なし");
  }

  // ④ 流入計測の印。
  embedCheck(
    "スニペットのリンクに?ref=embedが付く",
    snippet.includes("?ref=embed"),
    snippet.includes("?ref=embed") ? "あり" : "無い（埋め込み経由の流入が測れない）"
  );

  // ③ エスケープ。作品名に記号が入ってもHTMLを壊さない/注入されない。
  const nasty: EmbedWork = {
    ...sample,
    title: '<img src=x onerror="alert(1)"> & "引用" が入る作品',
  };
  for (const [label, html] of [
    ["HTMLスニペット", buildEmbedSnippet(nasty, "2026-08-06")],
    ["iframe本体のHTML", buildEmbedDocument(nasty, "2026-08-06")],
  ] as const) {
    // 生タグが出ていないこと＋エスケープ後の形が実際に入っていること、の両方を見る
    // （onerror= のような文字列はエスケープ後も本文に残るので、それ自体は違反ではない）。
    const rawTag = /<img\s/i.test(html);
    const escaped = html.includes("&lt;img");
    embedCheck(
      `${label}は作品名をエスケープする`,
      !rawTag && escaped,
      rawTag ? "生タグが出力されている" : escaped ? "&lt; などに変換済み" : "エスケープ後の文字列が見つからない"
    );
  }

  // 配信0件のときの出し分け（「データ自体が無い」と「TV放送のみ」を混同しない）。
  const noSvcWithTv = embedServiceSummary({ ...sample, services: [], otherServices: [] });
  const noSvcNoData = embedServiceSummary({
    ...sample,
    services: [],
    otherServices: [],
    hasBroadcastData: false,
  });
  embedCheck(
    "配信0件はTV放送有無で文言を分ける",
    noSvcWithTv !== noSvcNoData && noSvcWithTv.includes("TV放送"),
    `${JSON.stringify(noSvcWithTv)} / ${JSON.stringify(noSvcNoData)}`
  );

  // lib/embed.ts がアフィリエイトのモジュールに依存していないこと（①の実装レベルの担保）。
  const embedSrc = readFileSync(new URL("../lib/embed.ts", import.meta.url), "utf8");
  const usesAffiliate = /affiliate/i.test(embedSrc.replace(/\/\/[^\n]*/g, ""));
  embedCheck(
    "lib/embed.tsはアフィリエイトを参照しない",
    !usesAffiliate,
    usesAffiliate ? "参照している（埋め込みに広告リンクを入れてはいけない）" : "参照なし"
  );
}
console.log(`結果（配信先ウィジェット）: ${embedNg === 0 ? "全件OK" : `${embedNg} 件NG`}`);

// ─────────────────────────────────────────────
// カレンダー購読（.ics）の不変条件（2026-08-07追加）
//
// 【放送開始1週間前ルール】(CLAUDE.md) の派生。UIで曜日・時刻を出さないのは
// 「今週の水曜22:30」と誤読させないためで、カレンダーは実日付を持つのでその誤読は
// 起きない。ただし DTSTART を「次の水曜」から始めてしまうと、1話も配信されていない
// 日に予定が入る＝同じ誤誘導になる。DTSTART は必ず broadcastStartDate に置き、
// 放送開始日が分からない作品は**載せない**（推測で日付を作らない）。
//
// .ics は購読されたら相手のカレンダーに常駐する＝壊れた値の影響がこちらに見えない
// ので、ウィジェットと同じ強さで固定しておく。
// ─────────────────────────────────────────────
console.log("\n── カレンダー購読（.ics）の不変条件 ──");
let icsNg = 0;
{
  function icsCheck(name: string, pass: boolean, detail: string) {
    if (!pass) icsNg++;
    console.log(`${pass ? "✓" : "✗"}  ${name.padEnd(38)} → ${detail}`);
  }

  const works: CalendarWork[] = [
    {
      id: 100,
      title: "放送開始日あり作品",
      services: [{ key: "d_anime", short: "dアニメ" }],
      otherServices: [],
      broadcastStartDate: "2026-07-08",
      broadcastTime: "22:30",
    },
    {
      // 放送開始日が分からない作品。カレンダーに出してはいけない。
      id: 101,
      title: "放送開始日なし作品",
      services: [{ key: "abema", short: "ABEMA" }],
      otherServices: [],
      broadcastStartDate: null,
      broadcastTime: "22:30",
    },
    {
      // 時刻だけ無い作品も、開始時刻を決められないので出さない。
      id: 102,
      title: "時刻なし作品",
      services: [],
      otherServices: [],
      broadcastStartDate: "2026-07-08",
      broadcastTime: null,
    },
  ];

  const ics = buildCalendar(works, { seasonLabel: "2026年夏", now: new Date("2026-08-07T00:00:00Z") });

  icsCheck(
    "放送開始日が無い作品を載せない",
    !ics.includes("放送開始日なし作品") && !ics.includes("時刻なし作品"),
    ics.includes("放送開始日なし作品") || ics.includes("時刻なし作品") ? "混入" : "除外できている"
  );

  const uidCount = (ics.match(/^UID:/gm) ?? []).length;
  icsCheck("載るのは開始日が判明した作品だけ", uidCount === 1, `VEVENT ${uidCount}件（期待 1件）`);

  // JST 22:30 → UTC 13:30 同日。9時間の引き算がずれていないか。
  icsCheck(
    "DTSTARTがJST→UTCで正しい",
    ics.includes("DTSTART:20260708T133000Z"),
    ics.match(/DTSTART:[^\r\n]+/)?.[0] ?? "なし"
  );

  // 「26:30」のような24時以降表記が翌日に繰り上がるか（JST 26:30 = 翌日2:30 = UTC 前日17:30）。
  const late = buildCalendar(
    [{ ...works[0], broadcastTime: "26:30" }],
    { seasonLabel: "2026年夏", now: new Date("2026-08-07T00:00:00Z") }
  );
  icsCheck(
    "26:30表記が翌日に繰り上がる",
    late.includes("DTSTART:20260708T173000Z"),
    late.match(/DTSTART:[^\r\n]+/)?.[0] ?? "なし"
  );

  // 予定の中身から自サイトへ戻れること＋流入計測の印。
  icsCheck("作品ページへのリンクに?ref=が付く", ics.includes(`?ref=${CALENDAR_REF}`), `ref=${CALENDAR_REF}`);

  // RFC 5545 のテキストエスケープ。作品名にカンマ・セミコロンが入ると
  // エスケープ漏れでプロパティが壊れ、購読側でイベントが消える。
  const escaped = buildCalendar(
    [{ ...works[0], title: "A,B;C" }],
    { seasonLabel: "2026年夏", now: new Date("2026-08-07T00:00:00Z") }
  );
  icsCheck(
    "作品名のカンマ・セミコロンをエスケープする",
    escaped.includes("SUMMARY:A\\,B\\;C"),
    escaped.match(/SUMMARY:[^\r\n]+/)?.[0] ?? "なし"
  );

  // 改行は CRLF でなければならない（RFC 5545）。LFだけだと一部クライアントが読まない。
  icsCheck(
    "改行がCRLF",
    ics.includes("\r\n") && !/[^\r]\n/.test(ics),
    ics.includes("\r\n") ? "CRLF" : "LFのみ"
  );

  icsCheck(
    "VCALENDARが閉じている",
    ics.startsWith("BEGIN:VCALENDAR") && ics.trimEnd().endsWith("END:VCALENDAR"),
    "BEGIN/END"
  );
}
console.log(`結果（カレンダー購読）: ${icsNg === 0 ? "全件OK" : `${icsNg} 件NG`}`);

// ─────────────────────────────────────────────
// 配信状況の集計を年次比較に使わない（2026-08-07追加）
//
// スナップショットは「作品に配信情報があるか」の収録率が年々上がっているだけでなく、
// 「その作品の配信社が漏れなく記録されているか」も年々上がっている。後者は注目度上位
// への絞り込みでは補正できない（U-NEXTの掲載率が2021年=0%→2023年=79%と出るのが実例。
// U-NEXTが2021年にアニメを配信していなかったはずはない）。
// サービスが記録漏れすると作品は実際より「独占」に見え、平均社数は少なく出るため、
// 「独占が減った」「マルチ配信化した」は**収録改善だけでも同じ形になる**。
// 外向けに使ってよいのは記録が濃い直近年の現状だけ、という線をここで固定する。
// ─────────────────────────────────────────────
console.log("\n── 配信集計の年次比較を禁じる ──");
let trendNg = 0;
{
  function trendCheck(name: string, pass: boolean, detail: string) {
    if (!pass) trendNg++;
    console.log(`${pass ? "✓" : "✗"}  ${name.padEnd(38)} → ${detail}`);
  }

  const mk = (n: number, services: string[][]) =>
    Array.from({ length: n }, (_, i) => ({
      watchers: 1000 - i,
      hasBroadcastData: true,
      services: (services[i] ?? []).map((key) => ({ key })),
    }));

  // 収録が薄い年（配信情報が半分しか無い）は集計対象から落ちる。
  const thin = aggregateYear("2019", [mk(4, [["a"], [], [], []])]);
  const dense = aggregateYear("2025", [mk(4, [["a", "b"], ["a", "b"], ["a"], ["a", "b"]])]);
  trendCheck(
    "収録が薄い年はusableYearsが落とす",
    usableYears([thin, dense]).length === 1 && usableYears([thin, dense])[0].year === "2025",
    `${thin.year}=${pct(thin.coverage)} / ${dense.year}=${pct(dense.coverage)}`
  );

  // 外向けに出せるのは最新の使える年ひとつだけ（＝年次の差分APIを生やさない）。
  const state = currentState([thin, dense]);
  trendCheck("currentStateは最新の使える年を返す", state?.year === "2025", state?.year ?? "null");

  // 集計の中身が壊れていないこと（独占＝サービス1社の割合）。
  trendCheck(
    "独占率はサービス1社の割合",
    Math.abs(dense.exclusiveRate - 0.25) < 1e-9,
    `${pct(dense.exclusiveRate)}（期待 25%）`
  );
  trendCheck(
    "平均社数は配信情報がある作品での平均",
    Math.abs(dense.avgServices - 1.75) < 1e-9,
    `${dense.avgServices}（期待 1.75）`
  );

  // 年次の増減を出す関数が生えていないこと。生やすとこの節の意味が無くなる。
  const trendsSrc = readFileSync(new URL("../lib/streamingTrends.ts", import.meta.url), "utf8");
  trendCheck(
    "年次差分を返す関数を持たない",
    !/export function (delta|diff|trendOverYears|compareYears)/.test(trendsSrc),
    "delta/diff/compareYears なし"
  );
}
console.log(`結果（配信集計の年次比較）: ${trendNg === 0 ? "全件OK" : `${trendNg} 件NG`}`);

// ─────────────────────────────────────────────
// 放送終了作品に「いま配信中」と断定しない（2026-08-06追加）
//
// 2026-08-05に過去クール1,961ページを検索エンジンへ開放したが、作品ページは全作品に
// 対して「『X』は dアニメストア・U-NEXT で視聴できます（{今日}時点）」と現在形で
// 断定していた。Annictのprogramsは放送当時の番組表の記録であって現在の配信可否では
// ないため、これは誰も確認していない主張だった（lib/workAvailability.ts の冒頭参照）。
//
// 「無いものを推測で埋めない」（CLAUDE.md）と同じ性質の問題なので、同じ強さで固定する。
// 逆方向（「もう配信されていません」と断定する）も同じく未確認なので禁止する。
// ─────────────────────────────────────────────
console.log("\n── 放送終了作品の表現 ──");
let availNg = 0;
{
  function availCheck(name: string, pass: boolean, detail: string) {
    if (!pass) availNg++;
    console.log(`${pass ? "✓" : "✗"}  ${name.padEnd(38)} → ${detail}`);
  }

  const today = "2026-08-06"; // 2026年夏クールの最中
  const cases: Array<[string, string | null, string]> = [
    ["同じクール（放送中）", "2026-07-05", "airing"],
    ["同じクールの開始前", "2026-09-30", "airing"],
    ["直前のクール（春）", "2026-04-10", "finished"],
    ["前年", "2025-10-01", "finished"],
    ["11年前", "2015-01-08", "finished"],
    ["来年（放送予定）", "2027-01-05", "airing"],
    ["基準日なし（未定）", null, "airing"],
  ];
  for (const [label, base, expected] of cases) {
    const got = airingStatus(base, today);
    availCheck(`${label}`, got === expected, `${got}（期待 ${expected}）`);
  }

  // クールの境界。2026-09-30は夏、2026-10-01は秋。秋になった瞬間、夏作品はfinishedへ。
  availCheck(
    "クールの境界で切り替わる",
    airingStatus("2026-07-05", "2026-09-30") === "airing" &&
      airingStatus("2026-07-05", "2026-10-01") === "finished",
    "9/30=airing → 10/1=finished"
  );

  // 本命の検査: 放送終了作品の文面に現在形の断定が出ないこと。
  // 「視聴できます」「配信中」は、確認していない現在の可否を言い切る表現。
  const ASSERTIVE = ["視聴できます", "配信中", "配信しています", "見られます"];
  const finishedAnswer = buildWatchAnswer({
    title: "テスト作品",
    serviceLabels: ["dアニメ", "U-NEXT"],
    rentalNote: "",
    checkedDate: today,
    status: "finished",
  });
  const airingAnswer = buildWatchAnswer({
    title: "テスト作品",
    serviceLabels: ["dアニメ", "U-NEXT"],
    rentalNote: "",
    checkedDate: today,
    status: "airing",
  });
  const hit = ASSERTIVE.filter((w) => finishedAnswer.includes(w));
  availCheck(
    "放送終了の回答文に現在形の断定が無い",
    hit.length === 0,
    hit.length === 0 ? "断定表現なし" : `検出: ${JSON.stringify(hit)}`
  );
  availCheck(
    "放送中の回答文は従来どおり言い切る",
    airingAnswer.includes("視聴できます"),
    airingAnswer.includes("視聴できます") ? "「視聴できます」あり" : "表現が変わっている"
  );
  // 逆に「もう見られない」と断定するのも未確認なので禁止。
  const NEGATIVE = ["配信は終了しました", "視聴できません", "配信されていません"];
  const negHit = NEGATIVE.filter((w) => finishedAnswer.includes(w));
  availCheck(
    "放送終了の回答文が終了を断定しない",
    negHit.length === 0,
    negHit.length === 0 ? "断定なし" : `検出: ${JSON.stringify(negHit)}`
  );
  availCheck(
    "放送終了の回答文が確認を促す",
    finishedAnswer.includes("ご確認ください"),
    finishedAnswer.includes("ご確認ください") ? "あり" : "無い（誘導先が無い）"
  );

  // 検索結果のスニペット（description）も同じ扱い。
  const finishedDesc = buildWatchDescription({
    title: "テスト作品",
    descServices: "dアニメ・U-NEXT",
    releaseLead: "",
    status: "finished",
  });
  const descHit = ASSERTIVE.filter((w) => finishedDesc.includes(w));
  availCheck(
    "放送終了のdescriptionに断定が無い",
    descHit.length === 0 && !finishedDesc.includes("配信している"),
    descHit.length === 0 && !finishedDesc.includes("配信している")
      ? "断定表現なし"
      : `検出: ${JSON.stringify(descHit)}`
  );

  // ウィジェットのラベル。他人のブログの過去作記事に貼られたときに「配信中」と
  // 言い切らない（貼った側の記事の信頼まで巻き添えにするため）。
  availCheck(
    "ウィジェットのラベルを出し分ける",
    availabilityLabel("finished") === "配信情報" &&
      availabilityLabel("airing") === "配信中のサービス",
    `finished=${availabilityLabel("finished")} / airing=${availabilityLabel("airing")}`
  );
  const pastWork: EmbedWork = {
    id: 1,
    title: "むかしの作品",
    services: [{ key: "d_anime", short: "dアニメ", name: "dアニメストア", color: "#ff7a00" }],
    otherServices: [],
    hasBroadcastData: true,
    broadcastStartDate: "2015-01-08",
  };
  const pastSnippet = buildEmbedSnippet(pastWork, today);
  const pastDoc = buildEmbedDocument(pastWork, today);
  for (const [label, html] of [
    ["HTMLスニペット", pastSnippet],
    ["iframe本体のHTML", pastDoc],
  ] as const) {
    availCheck(
      `過去作の${label}が「配信中」と書かない`,
      !html.includes("配信中"),
      html.includes("配信中") ? "「配信中」が出力されている" : "出ていない"
    );
  }

  // 作品ページが判定ロジックを迂回して直書きしていないこと（実装レベルの担保）。
  // ここを素通しにすると、page.tsx 側にコピーが増えて検査が効かなくなる。
  const pageSrc = readFileSync(new URL("../app/anime/[id]/page.tsx", import.meta.url), "utf8");
  availCheck(
    "作品ページはworkAvailabilityを使う",
    pageSrc.includes("buildWatchAnswer") && pageSrc.includes("airingStatus"),
    pageSrc.includes("buildWatchAnswer") ? "import済み" : "直書きに戻っている"
  );
  // jstToday() が JST の日付を返すこと（UTCのままだと朝9時までズレる）。
  const noonUtc = Date.UTC(2026, 7, 5, 20, 0, 0); // 2026-08-05 20:00 UTC = 08-06 05:00 JST
  availCheck(
    "jstTodayはJSTの日付を返す",
    jstToday(noonUtc) === "2026-08-06",
    `${jstToday(noonUtc)}（期待 2026-08-06）`
  );

  // 本番の実地検査（scripts/verify-production.sh）が探す文言と、実際に出力される
  // 文言のズレを防ぐ（2026-08-07追加）。
  // shell 側は本番HTMLに対する grep なので、文言を書き換えると
  //   ・「含むべき」検査 → 落ちる（気づける）
  //   ・「含まぬべき」検査 → **黙って素通り**（＝検査が無力化する）
  // という非対称がある。後者が怖いので、ここで文言の同期をPR時点で押さえる。
  const verifySrc = readFileSync(new URL("./verify-production.sh", import.meta.url), "utf8");
  const airingSample = buildWatchAnswer({
    title: "X",
    serviceLabels: ["dアニメストア"],
    rentalNote: "",
    checkedDate: "2026-08-06",
    status: "airing",
  });
  const finishedSample = buildWatchAnswer({
    title: "X",
    serviceLabels: ["dアニメストア"],
    rentalNote: "",
    checkedDate: "2026-08-06",
    status: "finished",
  });
  for (const [needle, sample, which] of [
    ["で視聴できます", airingSample, "放送中"],
    ["の配信情報があるのは", finishedSample, "放送終了"],
  ] as const) {
    availCheck(
      `本番検査の文言と一致（${which}）`,
      verifySrc.includes(needle) && sample.includes(needle),
      verifySrc.includes(needle)
        ? sample.includes(needle)
          ? `「${needle}」で一致`
          : `文言を変えたなら scripts/verify-production.sh も直す`
        : `scripts/verify-production.sh に「${needle}」が無い`
    );
  }
}
console.log(`結果（放送終了作品の表現）: ${availNg === 0 ? "全件OK" : `${availNg} 件NG`}`);

// ─────────────────────────────────────────────
// 行動ログの配線が途中で切れていないことの検査（2026-08-06追加）
//
// 【なぜ要るか】components/ServiceMarks.tsx は 2026-07-19 から affiliate_click /
// official_link_click を記録していたのに、/admin/analytics の EVENT_LABELS に
// 載っていなかったため **約3週間ぶん、どの画面にも表示されていなかった**
// （ダッシュボードの表もグラフも EVENT_LABELS のキーから作られるので、
// そこに無いイベントは存在しないのと同じになる）。記録は静かに成功し続けるので、
// 画面を見ても記録漏れとの区別がつかない＝人間には気づけない壊れ方だった。
//
// 行動ログは3箇所の名前が揃って初めて機能する:
//   1. 呼び出し側      … logEvent("名前", ...)
//   2. サーバーの許可制 … app/api/track/route.ts の ALLOWED_EVENTS
//   3. 表示            … app/admin/analytics/page.tsx の EVENT_LABELS
// どこか1つが欠けると「送っているのに保存されない」「保存されているのに見えない」に
// なる。dアニメストアの提携待ちの間はこの実測値が唯一の判断材料になるので、
// ズレを機械的に止める。
// ─────────────────────────────────────────────
console.log("\n── 行動ログの配線（logEvent / ALLOWED_EVENTS / EVENT_LABELS）──");
let trackNg = 0;
{
  const trackSrc = readFileSync(new URL("../app/api/track/route.ts", import.meta.url), "utf8");
  const labelSrc = readFileSync(
    new URL("../app/admin/analytics/page.tsx", import.meta.url),
    "utf8"
  );

  // ALLOWED_EVENTS の Set リテラルから名前を拾う（コメント行は "..." を含まないので混ざらない）。
  const allowedBlock = trackSrc.slice(
    trackSrc.indexOf("ALLOWED_EVENTS = new Set(["),
    trackSrc.indexOf("]);", trackSrc.indexOf("ALLOWED_EVENTS = new Set(["))
  );
  const allowed = new Set([...allowedBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

  // EVENT_LABELS のキー（`名前: "日本語"` の形）を拾う。
  const labelBlock = labelSrc.slice(
    labelSrc.indexOf("EVENT_LABELS: Record<string, string> = {"),
    labelSrc.indexOf("};", labelSrc.indexOf("EVENT_LABELS: Record<string, string> = {"))
  );
  const labeled = new Set([...labelBlock.matchAll(/^\s*([a-z_]+):\s*"/gm)].map((m) => m[1]));

  // 実際に logEvent(...) で送っている名前を全ソースから拾う。
  const callers = new Set<string>();
  for (const file of listSourceFiles(new URL("../components/", import.meta.url))) {
    for (const m of readFileSync(file, "utf8").matchAll(/logEvent\(\s*"([a-z_]+)"/g)) {
      callers.add(m[1]);
    }
  }

  const notAllowed = [...callers].filter((e) => !allowed.has(e));
  const p1 = notAllowed.length === 0 && callers.size > 0;
  if (!p1) trackNg++;
  console.log(
    `${p1 ? "✓" : "✗"}  ${"送信している名前がALLOWED_EVENTSにある".padEnd(40)} → 送信${callers.size}種 / 未許可${notAllowed.length}件` +
      (p1 ? "" : `  (サーバー側で捨てられます: ${JSON.stringify(notAllowed)})`)
  );

  const notLabeled = [...allowed].filter((e) => !labeled.has(e));
  const p2 = notLabeled.length === 0 && allowed.size > 0;
  if (!p2) trackNg++;
  console.log(
    `${p2 ? "✓" : "✗"}  ${"ALLOWED_EVENTSが全部ダッシュボードに出る".padEnd(40)} → 許可${allowed.size}種 / 未表示${notLabeled.length}件` +
      (p2 ? "" : `  (記録されるのに画面に出ません: ${JSON.stringify(notLabeled)})`)
  );
}
console.log(`結果（行動ログの配線）: ${trackNg === 0 ? 2 : 0} 件OK / ${trackNg} 件NG`);

// ─────────────────────────────────────────────
// シーズンページのHTML量の見張り（2026-08-06追加）
//
// 2026-08-05にSSRを直した結果、シーズンページのHTMLは「作品数に比例して増える」形に
// なった（実測: 2024夏 = 158作品で raw 695KB / gzip 57.4KB。修正前は raw 188KB /
// gzip 33.5KB だったが、そちらは本文が空でSEO上は無価値だったので比較対象にならない）。
// 1作品あたり raw 約4.4KB / gzip 約363B。これは中身が増えたぶんの当然のコストで、
// いま問題になる水準ではない（ISR＋CDNキャッシュに載るので配信は速い）。
// ただし作品数が増え続ければいつかは重くなるので、**その「いつか」を人の記憶ではなく
// ここで見張る**。超えたら仮想化・分割・初期表示件数の制限などを検討する。
//
// 落ちない（警告だけ）。作品数はAnnict側の登録数で決まり、こちらのPRの是非とは
// 無関係なので、無関係な変更をブロックしてはいけない。日次巡回がこの警告を拾って
// 日報に載せる（`docs/operations.md`の⑮）。
// なお現在クールの件数はネットワーク無しでは分からないので、ここで見られるのは
// スナップショット済みの過去クールだけ。現在クールは巡回が`/api/season`で見る。
// ─────────────────────────────────────────────
console.log("\n── シーズンページのHTML量 ──");
{
  const GZIP_BYTES_PER_WORK = 363; // 実測: 2024夏 158作品 / gzip 57,373B
  const WARN_GZIP_BYTES = 100 * 1024; // ≒ 282作品
  const WARN_COUNT = Math.floor(WARN_GZIP_BYTES / GZIP_BYTES_PER_WORK);

  const dir = new URL("../content/snapshots/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let worst = { season: "", count: 0 };
  for (const f of files) {
    const snap = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as {
      season?: string;
      items?: unknown[];
    };
    const count = snap.items?.length ?? 0;
    if (count > worst.count) worst = { season: snap.season ?? f.replace(/\.json$/, ""), count };
  }

  const estGzipKb = ((worst.count * GZIP_BYTES_PER_WORK) / 1024).toFixed(1);
  const over = worst.count >= WARN_COUNT;
  console.log(
    `${over ? "⚠" : "✓"}  ${`最大クール ${worst.season}（${worst.count}作品・gzip推定${estGzipKb}KB）`.padEnd(40)} → ` +
      (over
        ? `見直し時期です（目安${WARN_COUNT}作品 / gzip 100KB）。一覧の分割・初期表示件数の制限を検討してください`
        : `OK（目安${WARN_COUNT}作品 / gzip 100KB まで）`)
  );
}

// ─────────────────────────────────────────────
// 配信サービス追加の検知（2026-08-07追加）
//
// Annictはコミュニティ編集なので、登録ミスの取り消し・付け直しがそのまま
// 「イベント」に見える。無防備に扱うと**上流の編集の揺れが利用者に届く**
// （2026-08-07・利用者の指摘）。ここで機械的に見張るのは次の4点:
//   1. 消えたことは扱わない
//   2. 連続してN日見えてから確定（1日でも途切れたらやり直し）
//   3. 一度報告した組は永久に再報告しない
//   4. 初回は種まき（既存の全ペアを黙って報告済みにする）
// ─────────────────────────────────────────────
console.log("\n── 配信サービス追加の検知 ──");
let addNg = 0;
{
  const pair = (workId: number, serviceKey: string) => ({
    workId,
    workTitle: `作品${workId}`,
    serviceKey,
    serviceShort: serviceKey,
  });
  const P = [pair(1, "d")];
  const SEASON = "2026-summer";
  const run = (
    existing: Parameters<typeof applySightings>[0],
    today: Parameters<typeof applySightings>[1],
    date: string,
    seed = false
  ) => applySightings(existing, today, date, SEASON, seed);

  // (4) 初回の種まきでは何も報告しない
  const seeded = run([], P, "2026-08-01", true);
  const seedOk = seeded.confirmed.length === 0 && seeded.upserts[0].reportedOn === "2026-08-01";
  if (!seedOk) addNg++;
  console.log(
    `${seedOk ? "✓" : "✗"}  ${"初回は既存ぶんを黙って記録する".padEnd(40)} → ` +
      (seedOk ? "報告0件" : `報告${seeded.confirmed.length}件（既存が全部「新規」に見えている）`)
  );

  // (2) 連続3日でだけ確定する
  let state = run([], P, "2026-08-01").upserts;
  const d1 = state[0].reportedOn === null;
  state = run(state, P, "2026-08-02").upserts;
  const d2 = state[0].reportedOn === null;
  const third = run(state, P, "2026-08-03");
  const d3 = third.confirmed.length === 1;
  const streakOk = d1 && d2 && d3;
  if (!streakOk) addNg++;
  console.log(
    `${streakOk ? "✓" : "✗"}  ${"連続3日見えてはじめて確定".padEnd(40)} → ` +
      (streakOk ? "1日目・2日目は出さず3日目に1件" : `1日目=${!d1 ? "出た" : "OK"} / 3日目=${d3 ? "OK" : "出ない"}`)
  );

  // (2') 途中で消えたら連続日数はやり直し＝確定しない（登録と削除の繰り返し）
  let churn = run([], P, "2026-08-01").upserts;
  // 8-02 は見えない（＝upsertされない）。8-03 に復活。
  const churn3 = run(churn, P, "2026-08-03");
  const churn4 = run(churn3.upserts, P, "2026-08-04");
  const churnOk = churn3.confirmed.length === 0 && churn4.confirmed.length === 0;
  if (!churnOk) addNg++;
  console.log(
    `${churnOk ? "✓" : "✗"}  ${"付けて消してを繰り返す編集は出さない".padEnd(40)} → ` +
      (churnOk ? "確定0件（連続が切れたのでやり直し）" : "確定してしまっている")
  );

  // (3) 一度報告したものは、消えて付け直されても二度と出さない
  const reported = third.upserts;
  let again = run(reported, P, "2026-08-10").upserts; // 大きく間が空いて復活
  again = run(again, P, "2026-08-11").upserts;
  const againRes = run(again, P, "2026-08-12");
  const onceOk = againRes.confirmed.length === 0;
  if (!onceOk) addNg++;
  console.log(
    `${onceOk ? "✓" : "✗"}  ${"報告済みの組は永久に再報告しない".padEnd(40)} → ` +
      (onceOk ? "再報告なし" : "再報告されている（通知が繰り返される）")
  );

  // (1) 消えたサービスは行が消えず、報告もされない
  const gone = run(third.upserts, [], "2026-08-04");
  const goneOk = gone.upserts.length === 0 && gone.confirmed.length === 0;
  if (!goneOk) addNg++;
  console.log(
    `${goneOk ? "✓" : "✗"}  ${"消えたことは扱わない".padEnd(40)} → ` +
      (goneOk ? "書き換えも報告もしない" : "消えたことを扱ってしまっている")
  );

  // 同じ日に2回走っても二重に進まない（再実行・遅延で2回叩かれる場合）
  const twice = run(run(state, P, "2026-08-03").upserts, P, "2026-08-03");
  const idemOk = twice.confirmed.length === 0 && twice.upserts[0].streak === 3;
  if (!idemOk) addNg++;
  console.log(
    `${idemOk ? "✓" : "✗"}  ${"同じ日に2回走っても二重に進まない".padEnd(40)} → ` +
      (idemOk ? `連続${twice.upserts[0].streak}日のまま・再報告なし` : "二重に進んでいる")
  );
}

// ─────────────────────────────────────────────
// Discord スラッシュコマンド（2026-08-07追加）
//
// 見張るのは2点:
//   (1) 署名検証が本当に効くこと。Discord はエンドポイント登録時に**わざと壊れた署名**を
//       送って401を返すか試すので、ここが緩むと登録できないだけでなく、
//       誰でも偽のリクエストを投げられる穴になる。
//   (2) 返信の文面が「放送終了作品に配信中と書かない」ルールを守ること
//       （lib/workAvailability.ts と同じ制約。Discordの返信は他人のサーバーに残る）。
// ─────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────
// currentSeasonKey() の誤用（2026-08-11追加）
//
// currentSeasonKey() が返すのは **クール名だけ**（"summer"）で "2026-summer" ではない。
// にもかかわらず `currentSeasonKey().split("-")` と書いて [year, season] に分解している
// 箇所が4つあり、year="summer" / season=undefined のまま getSeasonData に渡っていた。
// 実害: Discordの/animeが常に「見つかりませんでした」、/calendar.icsが空、
// 配信サービス追加の検知がAnnictの500で毎日スキップ（Annict障害に見えていた）、
// サービス別ページのisCurrentSeasonが常にfalse。
// どれも例外にならず「静かに何も出ない」形で壊れるため、画面を見ても気づけない。
// 年込みで欲しいときは currentYearSeason() を使うこと。
// ───────────────────────────────────────────────────────────────
console.log("\n── currentSeasonKey の誤用 ──");
let seasonKeyNg = 0;
{
  const roots = ["app", "lib", "components", "content"];
  const offenders: string[] = [];
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${e.name}${e.isDirectory() ? "/" : ""}`, dir);
      if (e.isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        // コメントは除いてから探す（この誤用を説明している注釈自体を拾わないため）。
        const src = readFileSync(child, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^[ \t]*\/\/.*$/gm, "");
        if (/currentSeasonKey\(\)\s*\.\s*split\s*\(/.test(src)) {
          offenders.push(child.pathname.split("/animedia/")[1] ?? e.name);
        }
      }
    }
  };
  for (const r of roots) walk(new URL(`../${r}/`, import.meta.url));

  const ok = offenders.length === 0;
  if (!ok) seasonKeyNg++;
  console.log(
    `${ok ? "✓" : "✗"}  ${"currentSeasonKey()をsplitしない".padEnd(40)} → ` +
      (ok
        ? "誤用なし（年込みは currentYearSeason() を使う）"
        : `year が "summer"、season が undefined になる: ${offenders.join(", ")}`)
  );

  // 関数そのものの契約も固定する（"2026-summer" 形式に変えるとsplit前提のコードが復活しうる）。
  const key = currentSeasonKey();
  const ys = currentYearSeason();
  const contractOk =
    !key.includes("-") &&
    ys.season === key &&
    /^\d{4}$/.test(ys.year);
  if (!contractOk) seasonKeyNg++;
  console.log(
    `${contractOk ? "✓" : "✗"}  ${"currentSeasonKey/YearSeasonの契約".padEnd(40)} → ` +
      (contractOk
        ? `currentSeasonKey()="${key}" / currentYearSeason()={${ys.year},${ys.season}}`
        : `想定外: key="${key}" ys=${JSON.stringify(ys)}`)
  );
}

console.log("\n── Discordスラッシュコマンド ──");
let discordNg = 0;
{
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
  const ts = "1754500000";
  const body = JSON.stringify({ type: 1 });
  const sig = cryptoSign(null, Buffer.from(ts + body), privateKey).toString("hex");

  const cases: { label: string; ok: boolean }[] = [
    { label: "正しい署名は通る", ok: verifyDiscordSignature(pub, sig, ts, body) === true },
    {
      label: "壊れた署名は弾く",
      ok: verifyDiscordSignature(pub, "ab".repeat(64), ts, body) === false,
    },
    {
      label: "ボディを差し替えたら弾く",
      ok: verifyDiscordSignature(pub, sig, ts, JSON.stringify({ type: 2 })) === false,
    },
    {
      label: "タイムスタンプを差し替えたら弾く",
      ok: verifyDiscordSignature(pub, sig, "1754500001", body) === false,
    },
    { label: "公開鍵が不正なら弾く", ok: verifyDiscordSignature("zz", sig, ts, body) === false },
    // リポジトリ同梱の Public Key（Vercelの環境変数を使えないときの代替。秘密情報ではない
    // 理由は content/discord/publicKey.ts の冒頭）。形式が違うと、Discordのエンドポイント
    // 登録が「認証できませんでした」で失敗するのに、原因が画面からは分からない。
    // 空（＝連携を使わない）か、16進64文字か、のどちらかであることを固定する。
    {
      label: "同梱の公開鍵は空か16進64文字",
      ok:
        DISCORD_PUBLIC_KEY_FALLBACK === "" ||
        /^[0-9a-f]{64}$/i.test(DISCORD_PUBLIC_KEY_FALLBACK),
    },
  ];
  for (const c of cases) {
    if (!c.ok) discordNg++;
    console.log(`${c.ok ? "✓" : "✗"}  ${c.label.padEnd(40)} → ${c.ok ? "OK" : "検証が期待どおりでない"}`);
  }

  // 放送終了作品の返信に、現在形の断定とサービス名の羅列が無いこと。
  const finished = buildAnimeReply("テスト", {
    id: 1,
    title: "テスト作品",
    serviceNames: ["dアニメ", "ABEMA"],
    year: 2020,
    season: "winter",
    finished: true,
  });
  const noAssert = !/配信されています|視聴できます|配信中/.test(finished);
  const noList = !finished.includes("dアニメ") && !finished.includes("ABEMA");
  if (!noAssert) discordNg++;
  if (!noList) discordNg++;
  console.log(
    `${noAssert ? "✓" : "✗"}  ${"放送終了作品に断定を書かない".padEnd(40)} → ${noAssert ? "断定なし" : "断定が入っている"}`
  );
  console.log(
    `${noList ? "✓" : "✗"}  ${"放送終了作品にサービス名を並べない".padEnd(40)} → ${noList ? "並べていない" : "並べてしまっている"}`
  );

  // 放送中の作品は従来どおり言い切ってよい。
  const airing = buildAnimeReply("テスト", {
    id: 2,
    title: "テスト作品",
    serviceNames: ["dアニメ"],
    year: 2026,
    season: "summer",
    finished: false,
  });
  const airOk = airing.includes("配信されています") && airing.includes("dアニメ");
  if (!airOk) discordNg++;
  console.log(
    `${airOk ? "✓" : "✗"}  ${"放送中の作品は言い切る".padEnd(40)} → ${airOk ? "サービス名あり" : "文面が変わっている"}`
  );

  // 候補が複数あるときの返信（2026-08-11追加）。
  // 「異世界」のような広い語で1件しか返さないと、他に該当作があること自体が
  // 分からない（利用者からの指摘）。件数・並び・上限・サービス名を並べないことを固定する。
  const many = Array.from({ length: MAX_CANDIDATES + 3 }, (_, i) => ({
    id: 100 + i,
    title: `異世界テスト${i}`,
    serviceNames: ["dアニメ", "ABEMA"],
    year: 2026,
    season: "summer",
    finished: false,
  }));
  const multi = buildCandidatesReply("異世界", many);
  const shownCount = (multi.match(/^・/gm) ?? []).length;
  const multiCases: { label: string; ok: boolean }[] = [
    { label: "候補の総件数を伝える", ok: multi.includes(`${many.length} 件`) },
    { label: "候補は上限まで（並べすぎない）", ok: shownCount === MAX_CANDIDATES },
    { label: "候補に作品ページのリンクを付ける", ok: multi.includes(`/anime/100?ref=`) },
    // 1行に収めるため、また放送終了作品が混ざったときに現在の可否と誤読されないため。
    {
      label: "候補一覧にサービス名を並べない",
      ok: !multi.includes("dアニメ") && !multi.includes("ABEMA"),
    },
    {
      label: "候補が上限以下なら「上位n件」と書かない",
      ok: !buildCandidatesReply("異世界", many.slice(0, 2)).includes("上位"),
    },
  ];
  for (const c of multiCases) {
    if (!c.ok) discordNg++;
    console.log(`${c.ok ? "✓" : "✗"}  ${c.label.padEnd(40)} → ${c.ok ? "OK" : "期待どおりでない"}`);
  }

  // データが取れなかったときの返信（2026-08-11追加）。
  // 「取れなかった」を「作品が無い」と混同しないこと。デプロイ直後はデータキャッシュが
  // 空になり（キーにビルドIDが入る）、今期の作品でも取得が上限を超えることがある。
  // そのとき「見つかりませんでした」と返すと存在しないという断定になる（実際に起きた）。
  const unavailable = buildUnavailableReply("異世界");
  const unavailableCases: { label: string; ok: boolean }[] = [
    {
      label: "取得失敗を「見つからない」と言わない",
      ok: !unavailable.includes("見つかりませんでした"),
    },
    { label: "取得できなかったことを伝える", ok: unavailable.includes("取得できませんでした") },
    { label: "再試行を促す", ok: unavailable.includes("もう一度") },
    { label: "検索語を含める", ok: unavailable.includes("異世界") },
  ];
  // ルート側が取得失敗を素通ししていないか（buildAnimeReply(null) に落とさないこと）。
  const routeSrc = readFileSync(
    new URL("../app/api/discord/route.ts", import.meta.url),
    "utf8"
  );
  unavailableCases.push({
    label: "ルートが取得失敗を別扱いにしている",
    ok: routeSrc.includes("buildUnavailableReply"),
  });
  for (const c of unavailableCases) {
    if (!c.ok) discordNg++;
    console.log(`${c.ok ? "✓" : "✗"}  ${c.label.padEnd(40)} → ${c.ok ? "OK" : "期待どおりでない"}`);
  }

  // 返信が誰かにメンションを飛ばさないこと（他人のサーバーで動くため）。
  const msg = messageResponse("テスト");
  const noMention = Array.isArray(msg.data.allowed_mentions?.parse) &&
    msg.data.allowed_mentions.parse.length === 0;
  if (!noMention) discordNg++;
  console.log(
    `${noMention ? "✓" : "✗"}  ${"返信でメンションを飛ばさない".padEnd(40)} → ${noMention ? "allowed_mentions は空" : "メンションが許可されている"}`
  );
}

// ─────────────────────────────────────────────
// 視聴プランの計算（2026-08-07追加）
//
// 「お気に入りに入れた作品を全部見るには、どのサービスに入れば足りるか」を出す
// 集合被覆の厳密解（lib/servicePlan.ts）。見張るのは2点:
//   (1) 正しさ … 最小のサービス数を本当に返すか（貪欲法だと1つ多い答えを返す形を含む）
//   (2) 速さ  … 利用者の指定で「一覧表示が2秒以上かからないこと」が要件。
//               計算は折りたたみを開いたときだけ走るが、それでも実データで上限を切る。
// ─────────────────────────────────────────────
console.log("\n── 視聴プランの計算 ──");
let planNg = 0;
{
  const svc = (key: string) => ({ key, short: key });
  const w = (id: number, ...keys: string[]) => ({
    id,
    title: `作品${id}`,
    services: keys.map(svc),
  });

  // (1-a) 1社で足りるなら1社と答える
  const a = buildServicePlan([w(1, "d"), w(2, "d", "abema"), w(3, "d")]);
  const aOk = a.minCount === 1 && a.combos[0][0].key === "d";
  if (!aOk) planNg++;
  console.log(
    `${aOk ? "✓" : "✗"}  ${"1社で足りるとき".padEnd(40)} → ` +
      (aOk ? "最小1サービス" : `最小${a.minCount} / ${JSON.stringify(a.combos)}`)
  );

  // (1-b) 貪欲法が誤る形。d は3本を覆うので貪欲だと d を先に取り、そのあと x と y が
  //       必要になって3社になる。正解は a2+b2 の2社。
  const g = buildServicePlan([
    w(1, "d", "a2"),
    w(2, "d", "a2"),
    w(3, "d", "b2"),
    w(4, "a2"),
    w(5, "b2"),
    w(6, "b2"),
  ]);
  const gOk = g.minCount === 2;
  if (!gOk) planNg++;
  console.log(
    `${gOk ? "✓" : "✗"}  ${"貪欲法では1社多くなる形".padEnd(40)} → ` +
      (gOk ? "最小2サービス（厳密解）" : `最小${g.minCount}（厳密解なら2）`)
  );

  // (1-c) 配信情報が無い作品は組み合わせに含めず、別枠で返す
  const u = buildServicePlan([w(1, "d"), w(2)]);
  const uOk = u.minCount === 1 && u.uncovered.length === 1 && u.covered === 1;
  if (!uOk) planNg++;
  console.log(
    `${uOk ? "✓" : "✗"}  ${"配信情報が無い作品は別枠".padEnd(40)} → ` +
      (uOk ? "対象1本 / 別枠1本" : `対象${u.covered} / 別枠${u.uncovered.length}`)
  );

  // (2) 速さ。実データのうち最も重いクールで測る。お気に入りは普通10本前後なので
  //     クール全作品はあり得ない上限だが、そこでも一瞬で終わることを確かめる。
  const BUDGET_MS = 200; // 一覧表示の要件（2秒）に対して10倍の余裕を取った上限
  const dir = new URL("../content/snapshots/", import.meta.url);
  let worst = { season: "", n: 0, ms: 0 };
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const snap = JSON.parse(readFileSync(new URL(f, dir), "utf8")) as {
      items?: { id: number; title: string; services: { key: string; short: string }[] }[];
    };
    const works = (snap.items ?? []).map((it) => ({
      id: it.id,
      title: it.title,
      services: it.services.map((s) => ({ key: s.key, short: s.short })),
    }));
    if (works.length === 0) continue;
    const t0 = performance.now();
    buildServicePlan(works);
    const ms = performance.now() - t0;
    if (ms > worst.ms) worst = { season: f.replace(/\.json$/, ""), n: works.length, ms };
  }
  const fast = worst.ms < BUDGET_MS;
  if (!fast) planNg++;
  console.log(
    `${fast ? "✓" : "✗"}  ${"最大クールでも上限内で終わる".padEnd(40)} → ` +
      `${worst.season}（${worst.n}作品）${worst.ms.toFixed(1)}ms` +
      (fast ? `（上限${BUDGET_MS}ms）` : ` — 上限${BUDGET_MS}msを超えた`)
  );
}

// ─────────────────────────────────────────────
// 孤立ページを作らない（2026-08-07追加）
//
// 経緯: `/service/[key]/[year]/[season]`（サービス別ページ）は実装済みで sitemap にも
// 載せていたのに、**サイト内からのリンクが1本も無かった**。人もクローラーも辿り着けず、
// 「このサービスに入るべきか」という加入判断の面＝アフィリエイトの転換が起きる唯一の
// 場面（docs/growth-strategy-2026-08.md の Tier3⑥）が事実上存在しないのと同じ状態に
// なっていた。画面上部のサービス絞り込みは <button> でクライアント状態を変えるだけで
// <a href> を持たないため、**画面を見ている限り「リンクがある」と錯覚する**。
// 2026-08-05に他クールへのリンクで踏んだのと同じ穴。
//
// sitemapに載っているページには、サイト内のどこかから実リンクがあること。
// ─────────────────────────────────────────────
console.log("\n── 孤立ページを作らない（内部リンク）──");
let orphanNg = 0;
{
  const cases: { file: string; needle: string; label: string }[] = [
    {
      file: "../components/SeasonExplorer.tsx",
      needle: "/service/${",
      label: "シーズン/トップ → サービス別ページ",
    },
    {
      file: "../app/anime/[id]/page.tsx",
      needle: "/service/${",
      label: "作品ページ → サービス別ページ",
    },
    // 2026-08-11: 過去クールの声優ページ1,413件をsitemapに載せた。その入口は
    // 「そのクールの作品ページ」からの声優名リンクしかない（一覧・トップからは
    // 今期しか辿れない）。作品ページ側のリンクが消えると、追加した分がまるごと
    // 孤立する。ここでの検証環境はAnnictトークンが無く作品ページのクレジットを
    // SSRで確かめられない（credits空の縮退版が返る）ため、機械的に見張る。
    {
      file: "../app/anime/[id]/page.tsx",
      needle: "/person/${",
      label: "作品ページ → 声優ページ",
    },
    // 声優ページ同士・過去クールの作品ページへの横断リンク。
    {
      file: "../app/person/[name]/[year]/[season]/page.tsx",
      needle: "otherSeasonWorks",
      label: "声優ページ → 他クールの出演作",
    },
  ];
  for (const c of cases) {
    const src = readFileSync(new URL(c.file, import.meta.url), "utf8");
    const ok = src.includes(c.needle);
    if (!ok) orphanNg++;
    console.log(
      `${ok ? "✓" : "✗"}  ${c.label.padEnd(40)} → ` +
        (ok
          ? "リンクあり"
          : `${c.file} に \`${c.needle}\` が無い。sitemapに載せているページはサイト内からも辿れるようにすること`)
    );
  }

  // サービス別ページの `.ics` 購読導線は「今期」に限ること。
  // /calendar.ics は year/season を受け取らず常に currentSeasonKey() の作品を返すので、
  // 過去クールのページに置くと「2020年冬の予定表」を期待した人に今期のカレンダーを渡す。
  // この環境ではAnnictトークンが無く今期のページをSSRで確かめられないため、機械的に見張る。
  const svc = readFileSync(
    new URL("../app/service/[key]/[year]/[season]/page.tsx", import.meta.url),
    "utf8"
  );
  const hasLink = svc.includes("CalendarSubscribeLink");
  const gated = /isCurrentSeason\s*&&/.test(svc) && svc.includes("currentYearSeason()");
  const icsOk = hasLink && gated;
  if (!icsOk) orphanNg++;
  console.log(
    `${icsOk ? "✓" : "✗"}  ${"サービス別の.ics導線は今期だけ".padEnd(40)} → ` +
      (icsOk
        ? "CalendarSubscribeLink を isCurrentSeason で出し分け"
        : hasLink
          ? "購読リンクが今期に限定されていない（/calendar.ics は常に今期を返す）"
          : "購読リンクが無い")
  );
}

// ─────────────────────────────────────────────
// 次クール準備の窓（2026-08-07追加）
//
// 検索需要はクール開始の約1ヶ月前から立ち上がり、山は年に4回しか来ない。
// その準備開始のきっかけを人の記憶に頼らず `.github/workflows/season-prep.yml` が
// Issueで出す。ここで見張るのは2点:
//   (1) 窓の定義が scripts/lib/build-season-prep.js だけにあること
//       （YAMLにも月日を書くと、ズレたときに気づけない。SLOTSと同じ方針）
//   (2) 4つの窓が意図した対象クールを返すこと。特に11月下旬の窓は**翌年**の冬クールで、
//       ここを取り違えると1年ずれたIssueが出る
// ─────────────────────────────────────────────
console.log("\n── 次クール準備の窓 ──");
let prepNg = 0;
{
  const { findPrepWindow } = seasonPrep;

  // (1) YAMLに月日を書いていないか。cronは5フィールド（分 時 日 月 曜日）で、
  //     日と月が両方 "*" であること＝「毎日起動するだけ」を確かめる。
  const yml = readFileSync(
    new URL("../.github/workflows/season-prep.yml", import.meta.url),
    "utf8"
  );
  const crons = [...yml.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
  const cronOk =
    crons.length > 0 &&
    crons.every((c) => {
      const f = c.trim().split(/\s+/);
      return f.length === 5 && f[2] === "*" && f[3] === "*";
    });
  if (!cronOk) prepNg++;
  console.log(
    `${cronOk ? "✓" : "✗"}  ${"cronに月日を書いていない".padEnd(40)} → ` +
      (cronOk
        ? `毎日起動のみ（${crons.join(", ")}）`
        : `season-prep.yml のcronに月日が入っている（${crons.join(", ")}）。窓の定義は scripts/lib/build-season-prep.js だけが持つこと`)
  );

  // (2) 4つの窓 ＋ 窓の外。JSTで判定されるので、UTCの15:00は翌日のJSTになる点に注意し、
  //     JSTの正午に相当する 03:00Z で確かめる。
  const at = (iso: string) => findPrepWindow(new Date(iso));
  const expectations: { iso: string; want: string | null; label: string }[] = [
    { iso: "2026-08-21T03:00:00Z", want: "2026-autumn", label: "8月下旬 → 今年の秋" },
    { iso: "2026-11-25T03:00:00Z", want: "2027-winter", label: "11月下旬 → 翌年の冬" },
    { iso: "2027-02-28T03:00:00Z", want: "2027-spring", label: "2月下旬 → 今年の春" },
    { iso: "2026-05-21T03:00:00Z", want: "2026-summer", label: "5月下旬 → 今年の夏" },
    { iso: "2026-08-20T03:00:00Z", want: null, label: "窓の直前（20日）は出さない" },
    { iso: "2026-09-25T03:00:00Z", want: null, label: "窓の無い月は出さない" },
  ];
  for (const e of expectations) {
    const w = at(e.iso);
    const got = w ? `${w.targetYear}-${w.targetSeason}` : null;
    const ok = got === e.want;
    if (!ok) prepNg++;
    console.log(
      `${ok ? "✓" : "✗"}  ${e.label.padEnd(40)} → ` +
        (ok ? (got ?? "窓の外") : `期待 ${e.want ?? "窓の外"} / 実際 ${got ?? "窓の外"}`)
    );
  }
}

if (
  addNg > 0 ||
  castsNg > 0 ||
  seasonKeyNg > 0 ||
  discordNg > 0 ||
  planNg > 0 ||
  orphanNg > 0 ||
  prepNg > 0 ||
  archiveNg > 0 ||
  titleNg > 0 ||
  linkNg > 0 ||
  ssrNg > 0 ||
  ng > 0 ||
  scheduleNg > 0 ||
  bdNg > 0 ||
  queryNg > 0 ||
  extraNg > 0 ||
  tagNg > 0 ||
  badgeNg > 0 ||
  anchorNg > 0 ||
  slotNg > 0 ||
  embedNg > 0 ||
  availNg > 0 ||
  xIntentNg > 0 ||
  trackNg > 0
)
  process.exit(1);
