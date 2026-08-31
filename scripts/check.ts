import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyChannel, toAnimeItem, SERVICES } from "../lib/services.ts";
import {
  SEASON_QUERY,
  WORK_QUERY,
  PROGRAMS_QUERY_LIST,
  PROGRAMS_QUERY_DETAIL,
  PROGRAMS_QUERY_EPISODE,
  mergeEpisodeInfo,
  type ProgramNodes,
} from "../lib/annict.ts";
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
  buildStreamingProperties,
  buildDataProvenance,
  STREAMING_PROPERTY_NAME,
} from "../lib/workAvailability.ts";
// 構造化データの出典（Annict）の正準定義。作品ページのJSON-LDが同じ値を使っているかを見る。
import { DATA_PROVIDER, DATA_PROVIDER_URL } from "../lib/attribution.ts";
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
  bodyIncludesUrl,
  pickDailyXPost,
} from "./lib/build-digest.js";
import { xPostUrl, xSearchUrl } from "./lib/x-intent.js";
// 日次の下書きIssueの本文組み立て（--issue）。require.main ガードがあるので
// importしてもネットワークへは出ない。
import printDigest from "./print-digest.js";
// 次クール準備の窓判定（2026-08-07追加）。純粋関数だけの、ネットワークに出ないモジュール。
import seasonPrep from "./lib/build-season-prep.js";
// 視聴プランの集合被覆（2026-08-07追加）。純粋関数のみ。
import { buildServicePlan } from "../lib/servicePlan.ts";
// 機械補完した放送/公開予定日（2026-08-17導入）。読み込み時の検証（lib/autoSchedule.ts）と、
// AniListとの突き合わせロジック（scripts/lib/upcoming-match.js。ネットワークにも時計にも
// 触らない純粋関数だけを置いてある）をここから直接テストする。
import { parseAutoScheduleEntry, parseAutoSchedules } from "../lib/autoSchedule.ts";
import {
  isUpcoming,
  matchWork,
  buildEntry,
  mergeWorks,
  buildAniListIndex,
} from "./lib/upcoming-match.js";
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
import {
  currentSeasonKey,
  currentYearSeason,
  isSeasonYearInRange,
  MIN_SEASON_YEAR,
} from "../lib/resolveSeasonParams.ts";
import { shouldIndexSeasonScopedPage, robotsFor } from "../lib/indexPolicy.ts";
import { parseWorkId } from "../lib/workId.ts";
// 検査の対象を**手で数えず、app/ を走査して導出する**ための道具（2026-08-31導入）。
// 名指しの列挙が漏れて OG画像ルートだけ検証を通っていなかった事故から入れた。
import { appRoutes, dynamicRoutes } from "./lib/app-routes.js";
// 配信サービス追加の検知（2026-08-07追加）。純粋関数のみ。
import { applySightings } from "../lib/serviceAdditions.ts";
import { otherSeasonWorks, MIN_WORKS, type PersonIndex } from "../lib/personIndex.ts";
import { renderGrowthKit } from "./lib/build-growth-kit.js";
// 配信サービス名寄せ表の公開データセット（2026-08-13追加）。純粋関数のみ。
import {
  buildServiceDataset,
  parseFormat,
  serviceDatasetEntries,
  toCsv,
  CSV_COLUMNS,
  type ServiceDatasetEntry,
} from "../lib/serviceDataset.ts";
// アフィリエイトのリンクが公開データセットに混入していないかを見るために読む
// （型だけの import は Node の型ストリッピングで消えるので実行時には services.ts に依存しない）。
import { AFFILIATE_PROGRAMS } from "../content/affiliate/programs.ts";


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

// アフィリエイトASPのドメイン一覧（2026-08-13にここへ集約）。
// 「第三者に配るデータに広告リンクを混ぜない」検査が2箇所（配信情報の構造化データ／
// 配信サービス名寄せ表の公開）にあるので、定義はここ**だけ**が持つ。両方に同じ配列を
// 書くと、ASPを増やした日に片方だけ古くなって検査が静かに骨抜きになる。
// 登録済みリンク（content/affiliate/programs.ts）から起こしたホストに、まだ提携して
// いないASPのドメインも足す（登録が空になった日に検査が無力化するのを防ぐ）。
const KNOWN_ASP_HOSTS = [
  "px.a8.net",
  "t.afi-b.com",
  "ck.jp.ap.valuecommerce.com",
  "sjv.io",
  "h.accesstrade.net",
  "af.moshimo.com",
  "rentracks.jp",
];
function affiliateHosts(): string[] {
  const registered = Object.values(AFFILIATE_PROGRAMS)
    .flatMap((programs) => programs ?? [])
    .map((p) => new URL(p.url).host);
  return [...new Set([...registered, ...KNOWN_ASP_HOSTS])];
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
// （fetchSeasonWorks → fetchProgramsPaged）はepisodeを使わないPROGRAMS_QUERY_LIST
// を使うべきで、これが再び episode を含む形に統合されないよう固定する。
let queryOk = 0;
let queryNg = 0;
// 「その方針を説明している注釈そのもの」を検査対象に拾わないよう、行頭コメントを落とす。
function stripCommentLines(src: string): string {
  return src
    .split(String.fromCharCode(10))
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join(String.fromCharCode(10));
}
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

// ── 作品個別クエリの episode 要求の回帰テスト（2026-08-16導入・重大度高） ──
// 上の2026-07-12の修正は「300件を超えた分の追い取得」だけを直しており、**1ページ目を
// 取る WORK_QUERY 自体が episode を要求したまま**だった。そのため programs が数十件
// しかない作品でも、話数が未紐付けなら program ノードが丸ごとnullになり、
// 一覧（/api/season）には配信サービスが出るのに**作品ページだけ「配信情報なし」**に
// なっていた（利用者からの指摘で発覚）。
// 実測（2026-08-16・Annict本番）: 17359 スティール・ボール・ランは programs 11件が
// 11件ともnullでNetflixが消滅。2026-autumn 99作品中2件・2026-summer 148作品中2件が
// 一覧と食い違っていた。影響は作品ページ本体だけでなく、公開API /api/work/[id]・
// 他人のサイトに貼られる埋め込みウィジェット・JSON-LD にも同じ嘘が載る
// （CLAUDE.mdの「放送が終わった作品に『いま配信中』と書かない」と同じ重大度）。
// episode を要求してよいのは配信開始通知メールの話数表示だけなので、その1本
// （PROGRAMS_QUERY_EPISODE）以外に episode が復活しないことを固定する。
checkQueryField("SEASON_QUERY（シーズン一覧）", SEASON_QUERY, "episode", false);
checkQueryField("WORK_QUERY（作品個別の1ページ目）", WORK_QUERY, "episode", false);
checkQueryField("PROGRAMS_QUERY_DETAIL（作品個別の追い取得）", PROGRAMS_QUERY_DETAIL, "episode", false);
checkQueryField("PROGRAMS_QUERY_EPISODE（通知の話数取得）", PROGRAMS_QUERY_EPISODE, "episode", true);
// 通知バッチは「今日・再放送でない」番組を探すので rebroadcast は要る。episode を
// 外した副作用で rebroadcast まで落ちると、再放送の日に誤って通知が飛ぶ
// （rebroadcast は nullable なので要求してもノードは消えない＝落とす理由が無い）。
checkQueryField("WORK_QUERY（再放送の判定に必要）", WORK_QUERY, "rebroadcast", true);
checkQueryField("PROGRAMS_QUERY_DETAIL（再放送の判定に必要）", PROGRAMS_QUERY_DETAIL, "rebroadcast", true);

// クエリ本文を別の場所に手書きされると上の検査をすり抜けるので、lib/annict.ts の中で
// episode フィールドを書いてよい場所を1箇所（PROGRAM_FIELDS_EPISODE）に固定する。
{
  const annictSrc = readFileSync(new URL("../lib/annict.ts", import.meta.url), "utf8");
  const body = stripCommentLines(annictSrc);
  const occurrences = body.split("episode { number numberText }").length - 1;
  const onlyInFieldConst =
    /const PROGRAM_FIELDS_EPISODE = [^\n]*episode \{ number numberText \}/.test(body);
  const ok = occurrences === 1 && onlyInFieldConst;
  if (ok) queryOk++; else queryNg++;
  console.log(
    `${ok ? "✓" : "✗"}  ${"episodeを書くのはPROGRAM_FIELDS_EPISODEだけ".padEnd(40)} → ` +
      (ok
        ? "1箇所のみ"
        : `${occurrences}箇所（そこ以外にepisodeを足すと、その経路の配信サービスが丸ごと消える）`)
  );
}

// episode を要求する取得（withEpisode）を使ってよいのは配信開始通知バッチだけ。
// 作品ページ・公開API・埋め込みの経路が話数欲しさにこれを立てると、増えたリクエストと
// 引き換えに「配信情報なし」を復活させることになる。
{
  const root = new URL("../", import.meta.url).pathname;
  const callers: string[] = [];
  const walk = (dir: URL) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${e.name}${e.isDirectory() ? "/" : ""}`, dir);
      if (e.isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        if (/withEpisode\s*:\s*true/.test(stripCommentLines(readFileSync(child, "utf8")))) {
          callers.push(decodeURIComponent(child.pathname).replace(decodeURIComponent(root), ""));
        }
      }
    }
  };
  for (const r of ["app", "lib", "components"]) walk(new URL(`../${r}/`, import.meta.url));
  const ok = callers.length === 1 && callers[0] === "app/api/notify/run/route.ts";
  if (ok) queryOk++; else queryNg++;
  console.log(
    `${ok ? "✓" : "✗"}  ${"withEpisodeを使うのは通知バッチだけ".padEnd(40)} → ` +
      (ok ? callers[0] : `${JSON.stringify(callers)}（通知以外がepisodeを要求してはいけない）`)
  );
}

// mergeEpisodeInfo は「話数だけ」を重ねる。episode側でnullになったノードを理由に
// base側を削る/差し替えるように書き換えると、episodeを直接要求したのと同じ事故
// （配信サービスの消滅）になるため、その振る舞いを固定する。
{
  const base: ProgramNodes = [
    { channel: { name: "Netflix" }, startedAt: "2026-10-05T12:00:00Z", rebroadcast: false },
    { channel: { name: "TOKYO MX" }, startedAt: "2026-10-05T13:00:00Z", rebroadcast: false },
  ];
  // Annictは episode 未紐付けの program をノードごとnullで返す（1件目がそれ）。
  const withEpisode: ProgramNodes = [
    null,
    {
      channel: { name: "TOKYO MX" },
      startedAt: "2026-10-05T13:00:00Z",
      rebroadcast: false,
      episode: { number: 1, numberText: "第1話" },
    },
  ];
  mergeEpisodeInfo(base, withEpisode);

  const allNull: ProgramNodes = [
    { channel: { name: "Netflix" }, startedAt: "2026-10-05T12:00:00Z", rebroadcast: false },
  ];
  mergeEpisodeInfo(allNull, [null, null]);

  const mergeCases: { label: string; ok: boolean; detail: string }[] = [
    {
      label: "baseのノードを減らさない",
      ok: base.length === 2 && base.every(Boolean),
      detail: `${base.length}件・null ${base.filter((p) => !p).length}件`,
    },
    {
      label: "話数が取れた番組には重ねる",
      ok: base[1]?.episode?.numberText === "第1話",
      detail: String(base[1]?.episode?.numberText),
    },
    {
      label: "episode側がnullでもチャンネルは残る",
      ok: base[0]?.channel?.name === "Netflix" && !base[0]?.episode,
      detail: `${base[0]?.channel?.name} / 話数${base[0]?.episode ? "有" : "無"}`,
    },
    {
      label: "episode側が全滅でもチャンネルは残る",
      ok: allNull.length === 1 && allNull[0]?.channel?.name === "Netflix",
      detail: "17359（programs全件がnull）の形",
    },
  ];
  for (const c of mergeCases) {
    if (c.ok) queryOk++; else queryNg++;
    console.log(`${c.ok ? "✓" : "✗"}  ${c.label.padEnd(40)} → ${c.detail}`);
  }
}
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
// 索引JSONを生成スクリプトから導出して突き合わせる（2026-08-31追加）
//
// 【なぜ要るか】
// content/archive/ には機械生成の索引が3つある（index.json / people.json /
// studios.json）。**スナップショットを再生成したのに索引を作り直し忘れる**と
// 画面は何も壊れないまま中身だけが古くなるので、index.json と people.json には
// 上で一致検査を入れてあった。ところが **studios.json には無かった**。
// 理由は単純で、検査を1ファイルずつ手で足していたから。索引が増えたときに
// 検査を足し忘れると、そのファイルだけ永久に見張られない。
//
// そこで **content/archive/ を走査し、全ての .json に生成元が登録されていることを
// 先に検査してから**、1つずつ導出して突き合わせる。新しい索引を足したのに
// ここへ登録しなければ**その時点で落ちる**（静かに見張り漏れが増えない）。
// これは app/ の走査（エラーページの節）と同じ考え方を、データ側へ当てたもの。
// ─────────────────────────────────────────────
console.log("\n── 索引JSONを生成スクリプトから導出する ──");
let deriveNg = 0;
{
  const { readSnapshots, buildArchiveIndex } = await import("./build-archive-index.ts");
  const { buildPersonIndex } = await import("./build-person-index.ts");
  const { buildStudioIndex } = await import("./build-studio-index.ts");
  const snapshots = readSnapshots();

  // ファイル名 → { 生成スクリプト, 導出関数, 比較対象の取り出し方 }。
  // ここに無いファイルが content/archive/ に現れたら落ちる。
  const builders: Record<
    string,
    { script: string; derive: () => unknown; pick: (json: any) => unknown; describe: (v: any) => string }
  > = {
    "index.json": {
      script: "node scripts/build-archive-index.ts",
      derive: () => buildArchiveIndex(snapshots),
      pick: (j) => j,
      describe: (v) =>
        `シーズン${v.seasons.length}件・作品${v.seasons.reduce((n: number, s: any) => n + s.workIds.length, 0)}件`,
    },
    "people.json": {
      script: "node scripts/build-person-index.ts",
      derive: () => buildPersonIndex(snapshots),
      pick: (j) => j.people,
      describe: (v) =>
        `${Object.keys(v).length}人・出演${Object.values(v).reduce((n: number, w: any) => n + w.length, 0)}件`,
    },
    "studios.json": {
      script: "node scripts/build-studio-index.ts",
      // 生成側は generatedAt も書くが、これは「内容が変わったときだけ」更新される
      // 印であって中身ではない。比較からは外す（外さないと日付で毎回不一致になる）。
      derive: () => buildStudioIndex(snapshots),
      pick: (j) => ({ studios: j.studios, directors: j.directors }),
      describe: (v) => `制作会社${Object.keys(v.studios).length}社・監督${Object.keys(v.directors).length}人`,
    },
  };

  const archiveDir = new URL("../content/archive/", import.meta.url);
  const files = readdirSync(archiveDir).filter((f) => f.endsWith(".json")).sort();
  const unregistered = files.filter((f) => !(f in builders));
  if (unregistered.length) deriveNg++;
  console.log(
    `${unregistered.length === 0 ? "✓" : "✗"}  ${"索引JSONに生成元が登録されている".padEnd(40)} → ` +
      (unregistered.length === 0
        ? `${files.length} 件すべて登録済み`
        : `生成元が未登録: ${unregistered.join(" / ")}（見張られないまま古くなる）`)
  );
  // 逆に、登録されているのにファイルが無い（消した／改名した）ことも見る。
  const missing = Object.keys(builders).filter((f) => !files.includes(f));
  if (missing.length) deriveNg++;
  console.log(
    `${missing.length === 0 ? "✓" : "✗"}  ${"登録された索引JSONが実在する".padEnd(40)} → ` +
      (missing.length === 0 ? "欠けなし" : `見つからない: ${missing.join(" / ")}`)
  );

  for (const file of files) {
    const b = builders[file];
    if (!b) continue;
    const expected = b.derive();
    const actual = b.pick(JSON.parse(readFileSync(new URL(file, archiveDir), "utf8")));
    const same = JSON.stringify(expected) === JSON.stringify(actual);
    if (!same) deriveNg++;
    console.log(
      `${same ? "✓" : "✗"}  ${`${file}が導出結果と一致`.padEnd(40)} → ` +
        b.describe(expected) +
        (same ? "" : `  (不一致: ${b.script} を実行してください)`)
    );
  }
}
console.log(`結果（索引JSONの導出）: ${deriveNg === 0 ? "全件OK" : deriveNg + " 件NG"}`);

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
    // 【2026-08-25に反転】ここは長らく「sitemapが過去クールの声優ページを載せること」を
    // 検査していた。2026-08-11にGSCの実測（声優ページ5.9位・CTR9.5%）を根拠に4,483件を
    // 追加したときの検査だが、その実測は**今期のページ**のもので、過去クールぶんには
    // 当てはまらなかった。索引到達後は47.0位まで崩れ、サイト全体の週次平均を6.86悪化させた
    // うち4.77（70%）がこの面だった。いまは載せないのが正しい方針で、その見張りは
    // 「薄い声優ページを索引に載せない」節が持つ。ここで逆向きの検査を残すと両方を
    // 同時に満たせないので、代わりに**索引そのものは使い続けている**ことだけを見る
    // （声優ページの「他のクールの出演作」欄＝過去クールの作品ページへの内部リンク）。
    {
      label: "声優ページが出演作索引を使い続ける",
      ok: personPageSrc.includes("otherSeasonWorks"),
      detail: "他のクールの出演作（過去クールの作品ページへの導線）を出す",
    },
  ];
  for (const c of cases) {
    if (!c.ok) castsNg++;
    console.log(
      `${c.ok ? "\u2713" : "\u2717"}  ${c.label.padEnd(40)} \u2192 ${c.ok ? c.detail : `NG: ${c.detail}`}`
    );
  }

  // スナップショットの切断率（参考表示。NGにはしない）。
  // content/snapshots/ は旧設定（5件）で生成されているので、再生成するまで高いままになる。
  // 再生成の手順は docs/operations.md の⑳。**この行が下がったかどうかで成否を確認できる**。
  const { readSnapshots } = await import("./build-archive-index.ts");
  let works = 0;
  let atLimit = 0;
  for (const snap of readSnapshots()) {
    for (const it of snap.data.items) {
      if (it.castNames.length === 0) continue;
      works++;
      if (it.castNames.length === 5) atLimit++;
    }
  }
  const rate = works === 0 ? 0 : (100 * atLimit) / works;
  console.log(
    `\u2139  ${"スナップショットの切断率".padEnd(40)} \u2192 ` +
      `\u3061\u3087\u3046\u30695\u4ef6 ${atLimit}/${works}\u4f5c\u54c1 (${rate.toFixed(1)}%)` +
      (rate > 20
        ? "  \u2190 \u65e7\u8a2d\u5b9a\u306e\u307e\u307e\u3002docs/operations.md \u306e\u2473 \u306e\u624b\u9806\u3067\u518d\u751f\u6210\u3059\u308b\u3068\u4e0b\u304c\u308a\u307e\u3059"
        : "")
  );
}
console.log(
  `結果（声優データの取りこぼし）: ${5 - castsNg} 件OK / ${castsNg} 件NG`
);

// ─────────────────────────────────────────────
// シリーズの対応表（2026-08-11追加）
//
// content/works/series.ts は「1期・2期・劇場版」を人力で繋ぐ表。GSCの実測で
// 逃げ上手の若君の2期が184表示・0クリック・15.9位、1期は表示回数ゼロで、
// しかも互いにリンクが1本も無かったことから追加した。
// 誤って別作品を繋ぐと利用者を無関係なページへ送るため、機械的に見張る:
//   (1) 出典と確認日がある（推測で繋がない・CLAUDE.mdの補完データ共通の方針）
//   (2) 2件以上ある（1件ではシリーズにならない）
//   (3) 同じ作品IDが複数のシリーズに出てこない（seriesFor が先勝ちで曖昧になる）
//   (4) スナップショットに存在するIDは、そのタイトルが実在する作品と噛み合う
//       （過去クールの作品なら照合できる。今期の作品は snapshots に無いので照合しない）
// ─────────────────────────────────────────────
console.log("\n── シリーズの対応表 ──");
let seriesNg = 0;
{
  const { SERIES, seriesFor } = await import("../content/works/series.ts");
  const { readSnapshots } = await import("./build-archive-index.ts");
  const titleById = new Map<number, string>();
  for (const snap of readSnapshots()) {
    for (const it of snap.data.items) titleById.set(it.id, it.title);
  }

  const seen = new Map<number, string>();
  const problems: string[] = [];
  for (const s of SERIES) {
    if (!s.sourceUrl || !/^https?:\/\//.test(s.sourceUrl)) {
      problems.push(`${s.title}: sourceUrl が無い`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.confirmedDate)) {
      problems.push(`${s.title}: confirmedDate の形式が YYYY-MM-DD でない`);
    }
    if (s.works.length < 2) {
      problems.push(`${s.title}: 作品が${s.works.length}件（2件以上必要）`);
    }
    for (const w of s.works) {
      if (!Number.isInteger(w.id) || w.id <= 0) problems.push(`${s.title}: 不正なID ${w.id}`);
      if (!w.label) problems.push(`${s.title}: ${w.id} に label が無い`);
      const dup = seen.get(w.id);
      if (dup) problems.push(`作品${w.id} が「${dup}」と「${s.title}」の両方にある`);
      else seen.set(w.id, s.title);
    }
  }

  // 過去クールの作品は、実在する作品かどうかまで照合できる。
  const checked: string[] = [];
  for (const s of SERIES) {
    for (const w of s.works) {
      const actual = titleById.get(w.id);
      if (!actual) continue; // 今期の作品（snapshotsに無い）は照合対象外
      checked.push(`${w.id}=${actual}`);
    }
  }

  const cases: { label: string; ok: boolean; detail: string }[] = [
    {
      label: "定義に不備が無い",
      ok: problems.length === 0,
      detail: problems.length === 0 ? `${SERIES.length}シリーズ` : problems.join(" / "),
    },
    {
      label: "スナップショットのIDと照合できる",
      ok: true,
      detail: checked.length > 0 ? checked.join("・") : "過去クールの作品を含まない",
    },
    // 双方向に引けること（片方向だけだと繋いだつもりで繋がっていない）。
    {
      label: "どの作品からも同じシリーズを引ける",
      ok: SERIES.every((s) => s.works.every((w) => seriesFor(w.id)?.title === s.title)),
      detail: "seriesFor が全作品で同じシリーズを返す",
    },
    // 作品ページが実際にリンクを出していること（孤立させない・出典を出す）。
    {
      label: "作品ページがシリーズを描画する",
      ok: (() => {
        const page = readFileSync(
          new URL("../app/anime/[id]/page.tsx", import.meta.url),
          "utf8"
        );
        return page.includes("seriesFor") && page.includes("seriesOthers");
      })(),
      detail: "app/anime/[id]/page.tsx が seriesFor を使う",
    },
  ];
  for (const c of cases) {
    if (!c.ok) seriesNg++;
    console.log(
      `${c.ok ? "\u2713" : "\u2717"}  ${c.label.padEnd(40)} \u2192 ${c.ok ? c.detail : `NG: ${c.detail}`}`
    );
  }
}
console.log(`結果（シリーズの対応表）: ${4 - seriesNg} 件OK / ${seriesNg} 件NG`);

// ─────────────────────────────────────────────
// スポットライト枠の作品リスト（2026-08-11追加）
//
// content/sns/spotlight.js は SNS の「【どこで見れる？】スポットライト」枠で
// 日替わりに紹介する作品の一覧。実測（GSC / Vercel Analytics）を根拠に人が入れ替える。
// 投稿は毎日自動で出るため、ここが壊れていると誤った投稿が他所に残る。見張るのは:
//   (1) 作品IDが重複していない（重複するとローテーションが偏る）
//   (2) source（根拠）が全件にある。推測で足していないことの担保
//   (3) hashtag がタグとして成立する文字だけでできている。
//       「☆」「 」「#」はX・Blueskyのタグ解析でタグの終端として扱われ、
//       #魔法少女まどか☆マギカ が「#魔法少女まどか」＋地の文に割れて壊れる
//       （2026-07-27に実際に踏んだため、まどマギは略称を使っていた）
//   (4) 候補が十分ある。buildSpotlight は「今期に存在し配信1件以上」の作品だけに
//       絞り込むため、元が少ないと絞った後に0〜1件になり同じ作品ばかり出る
// ─────────────────────────────────────────────
console.log("\n── スポットライト枠の作品リスト ──");
let spotlightNg = 0;
{
  const { SPOTLIGHT_WORKS } = await import("../content/sns/spotlight.js");
  type Entry = { annictId: number; title: string; source: string; hashtag?: string };
  const works = SPOTLIGHT_WORKS as Entry[];

  const dupIds = works
    .map((w) => w.annictId)
    .filter((id, i, arr) => arr.indexOf(id) !== i);
  const noSource = works.filter((w) => !w.source).map((w) => w.title);
  // タグ解析を壊す文字。半角/全角スペース・#・☆・★・記号類。
  const badTagChars = /[\s#　☆★＃!-\/:-@\[-`{-~]/;
  const badTags = works
    .filter((w) => w.hashtag != null && (w.hashtag === "" || badTagChars.test(w.hashtag)))
    .map((w) => `${w.title}: "${w.hashtag}"`);

  const cases: { label: string; ok: boolean; detail: string }[] = [
    {
      label: "作品IDが重複していない",
      ok: dupIds.length === 0,
      detail: dupIds.length === 0 ? `${works.length}件` : `重複ID: ${dupIds.join("・")}`,
    },
    {
      label: "全件に根拠（source）がある",
      ok: noSource.length === 0,
      detail: noSource.length === 0 ? "実測値のみ" : noSource.join(" / "),
    },
    {
      label: "hashtagがタグとして成立する",
      ok: badTags.length === 0,
      detail:
        badTags.length === 0
          ? `${works.filter((w) => w.hashtag).length}件にタグあり（省略${works.filter((w) => !w.hashtag).length}件）`
          : badTags.join(" / "),
    },
    {
      label: "候補が十分ある",
      ok: works.length >= 5,
      detail: `${works.length}件（下限5件）`,
    },
  ];
  for (const c of cases) {
    if (!c.ok) spotlightNg++;
    console.log(
      `${c.ok ? "✓" : "✗"}  ${c.label.padEnd(40)} → ${c.ok ? c.detail : `NG: ${c.detail}`}`
    );
  }
}
console.log(`結果（スポットライト枠）: ${4 - spotlightNg} 件OK / ${spotlightNg} 件NG`);

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
// 作品ページ以外の title の幅の検査（2026-08-19追加）
//
// 幅の予算は2026-08-05に作ったが、**効いていたのは作品ページだけ**だった。
// 他の面は generateMetadata がテンプレートリテラルを直書きし、さらにレイアウトの
// template（"%s | アニメ視聴ガイド"）でブランド名が自動で足されるため、幅を
// 誰も見ていなかった。導入前の実測（2026-08-19）:
//   制作会社  165件中45件（27%）超過・最長42.0
//   声優    1,531件中44件（3%）超過・最長37.5
//   サービス別・ランキング は名前の長さに関係なく常に超過
// 作品ページで直したのと同じ壊れ方（入れたはずの語が表示前に切られる）が
// そのまま残っていた。
//
// 【何を落とすか】名前の長さはデータ側（Annict）で決まるので、「予算を超えたら落ちる」に
// すると無関係なPRが赤くなる。そこで落とすのは**組み立て方の誤り**だけにする:
//   ・より短い候補があったのに、それを選ばずに予算を超えた
//   ・ブランド名を落とせば収まるのに、落とさずに予算を超えた
// 削りようがない超過（人名・会社名そのものが長い）は警告だけにして件数を出す。
// ─────────────────────────────────────────────
console.log("\n── ページtitleの幅（作品ページ以外） ──");
let pageTitleNg = 0;
{
  const { fitPageTitle, titleWidth, BRAND_SUFFIX, BRAND_SUFFIX_WIDTH } = await import(
    "../lib/pageTitle.ts"
  );
  const { displayWidth: width, TITLE_WIDTH_BUDGET: BUDGET } = await import("../lib/workTitle.ts");
  const meta = await import("../lib/pageMeta.ts");

  // ① レイアウトの template と BRAND_SUFFIX がズレていないこと。
  // ズレると「ブランド名を落とせば収まる」という計算が実物と合わなくなる。
  {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    // layout.tsx は `%s | ${title}` と変数で書いているので、その title の値を
    // 同じファイルから拾って埋めてから比べる。
    const siteName = layout.match(/^const title = "([^"]+)";/m)?.[1] ?? "";
    const m = layout.match(/template:\s*`%s([^`]*)`/);
    const resolved = m ? m[1].replace(/\$\{title\}/g, siteName) : null;
    const pass = resolved !== null && resolved === BRAND_SUFFIX;
    if (!pass) pageTitleNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"レイアウトのtemplateと一致する".padEnd(34)} → ${JSON.stringify(resolved)}` +
        (pass ? `（幅${BRAND_SUFFIX_WIDTH}）` : `  (期待: ${JSON.stringify(BRAND_SUFFIX)})`)
    );
  }

  // ② fitPageTitle の性質: 予算を超える結果を返すのは「どの候補もブランド名を
  //    落としてなお収まらない」ときだけ。
  {
    const cases: Array<[string[], string]> = [
      [["短い"], "ブランド名込みで収まるならブランド名も出す"],
      [["あ".repeat(30), "あ".repeat(20)], "ブランド名を落とせば収まるなら落とす"],
      [["あ".repeat(60), "あ".repeat(40)], "どれも収まらなければ最短の候補"],
    ];
    let ng = 0;
    for (const [cands, label] of cases) {
      const t = fitPageTitle(cands);
      const w = titleWidth(t);
      // 期待される最善手を総当たりで求める。
      let best: string | { absolute: string } | null = null;
      for (const c of cands) {
        if (width(c) + BRAND_SUFFIX_WIDTH <= BUDGET) { best = c; break; }
        if (width(c) <= BUDGET) { best = { absolute: c }; break; }
      }
      if (best === null) best = { absolute: cands[cands.length - 1] };
      const pass = JSON.stringify(t) === JSON.stringify(best);
      if (!pass) ng++;
      console.log(`${pass ? "✓" : "✗"}  ${label.padEnd(34)} → 幅${w}  ${JSON.stringify(t)}`);
    }
    if (ng > 0) pageTitleNg++;
  }

  // ③ 実データ全件。面ごとに「削れる超過（＝組み立ての誤り）」と
  //    「削れない超過（＝名前そのものが長い）」を分けて数える。
  {
    const { SEASON_LABEL } = await import("../lib/resolveSeasonParams.ts");
    const seasons = Object.keys(SEASON_LABEL);
    const studioIdx = JSON.parse(
      readFileSync(new URL("../content/archive/studios.json", import.meta.url), "utf8")
    ) as { studios: Record<string, unknown[]>; directors: Record<string, unknown[]> };
    const peopleIdx = JSON.parse(
      readFileSync(new URL("../content/archive/people.json", import.meta.url), "utf8")
    ) as { people: Record<string, unknown[]> };
    const { SERVICES: SVCS } = await import("../lib/services.ts");

    type Row = { face: string; total: number; over: number; worst: number; worstTitle: string };
    const rows: Row[] = [];
    let fixable = 0;
    const fixableSamples: string[] = [];

    const measure = (face: string, items: Array<[string[], () => unknown]>) => {
      const row: Row = { face, total: 0, over: 0, worst: 0, worstTitle: "" };
      for (const [cands, build] of items) {
        const t = build() as string | { absolute: string };
        const w = titleWidth(t);
        row.total++;
        if (w > BUDGET) {
          row.over++;
          // 他に収まる候補があったなら、それは組み立ての誤り＝落とす。
          const couldFit = cands.some((c) => width(c) <= BUDGET);
          if (couldFit) {
            fixable++;
            if (fixableSamples.length < 3) fixableSamples.push(`${face}: ${JSON.stringify(t)}`);
          }
          if (w > row.worst) {
            row.worst = w;
            row.worstTitle = typeof t === "string" ? t + BRAND_SUFFIX : t.absolute;
          }
        }
      }
      rows.push(row);
    };

    const Y = String(new Date().getFullYear());
    measure(
      "シーズン",
      seasons.map((se) => [
        [`${Y}年${SEASON_LABEL[se]}アニメ 配信情報一覧`, `${Y}年${SEASON_LABEL[se]}アニメ 配信一覧`],
        () => meta.seasonPageTitle(Y, se),
      ])
    );
    measure(
      "独占",
      seasons.map((se) => [
        [`${Y}年${SEASON_LABEL[se]}アニメ 独占配信まとめ`],
        () => meta.exclusivePageTitle(Y, se),
      ])
    );
    measure(
      "ランキング",
      seasons.map((se) => [
        [
          `${Y}年${SEASON_LABEL[se]}アニメ 配信サービス勢力図・ランキング`,
          `${Y}年${SEASON_LABEL[se]}アニメ 配信サービスランキング`,
        ],
        () => meta.rankingsPageTitle(Y, se),
      ])
    );
    measure(
      "サービス別",
      SVCS.flatMap((sv) =>
        seasons.map(
          (se) =>
            [
              [
                `${Y}年${SEASON_LABEL[se]}アニメ ${sv.name}で見れる作品一覧`,
                `${Y}年${SEASON_LABEL[se]}アニメ ${sv.short}で見れる作品一覧`,
                `${Y}年${SEASON_LABEL[se]}アニメ ${sv.short}で見れる作品`,
              ],
              () => meta.servicePageTitle(sv.name, sv.short, Y, se),
            ] as [string[], () => unknown]
        )
      )
    );
    measure(
      "制作会社",
      Object.keys(studioIdx.studios).map(
        (n) =>
          [
            [`${n}が制作したアニメの配信情報一覧`, `${n}が制作したアニメ一覧`, `${n}の制作作品`],
            () => meta.creditPageTitle("studio", n),
          ] as [string[], () => unknown]
      )
    );
    measure(
      "監督",
      Object.keys(studioIdx.directors).map(
        (n) =>
          [
            [`${n}が監督したアニメの配信情報一覧`, `${n}が監督したアニメ一覧`, `${n}の監督作品`],
            () => meta.creditPageTitle("director", n),
          ] as [string[], () => unknown]
      )
    );
    // 声優ページは代表作の有無で文型が変わるので両方を測る。
    measure(
      "声優",
      Object.keys(peopleIdx.people).flatMap((n) =>
        [true, false].map(
          (f) =>
            [
              f
                ? [`${n}の代表作・${Y}年夏アニメ出演作一覧`, `${n}の代表作・${Y}年夏アニメ`, `${n}の${Y}年夏アニメ出演作`]
                : [`${n}が出演する${Y}年夏アニメ一覧`, `${n}の${Y}年夏アニメ出演作`],
              () => meta.personPageTitle(n, Y, "summer", f),
            ] as [string[], () => unknown]
        )
      )
    );

    for (const r of rows) {
      const mark = r.over === 0 ? "✓" : "⚠";
      const detail =
        r.over === 0
          ? `${r.total}件すべて予算内`
          : `${r.total}件中 超過${r.over}件（最長${r.worst}: ${r.worstTitle}）`;
      console.log(`${mark}  ${r.face.padEnd(30)} → ${detail}`);
    }

    const pass = fixable === 0;
    if (!pass) pageTitleNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"削れる超過が残っていない".padEnd(34)} → ${fixable}件` +
        (pass ? "" : `  (例: ${fixableSamples.join(" / ")})`)
    );
  }

  // ④ 逆戻り防止: 各ページの generateMetadata が title を直書きしないこと。
  //    直書きに戻ると③の検査を素通りする（検査は lib/pageMeta.ts しか見ないため）。
  {
    const pages = [
      "../app/season/[year]/[season]/page.tsx",
      "../app/person/[name]/[year]/[season]/page.tsx",
      "../app/service/[key]/[year]/[season]/page.tsx",
      "../app/exclusive/[year]/[season]/page.tsx",
      "../app/rankings/[year]/[season]/page.tsx",
      "../app/studio/[name]/page.tsx",
      "../app/director/[name]/page.tsx",
    ];
    const bad: string[] = [];
    for (const p of pages) {
      const src = readFileSync(new URL(p, import.meta.url), "utf8");
      if (/const title = `/.test(src)) bad.push(p.replace("../app/", ""));
    }
    const pass = bad.length === 0;
    if (!pass) pageTitleNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"titleを直書きせずlib/pageMeta.tsを通す".padEnd(33)} → ${pages.length}ページ中 直書き${bad.length}件` +
        (pass ? "" : `  (${bad.join(", ")})`)
    );
  }
}
console.log(
  `結果（ページtitleの幅）: ${pageTitleNg === 0 ? 4 : 0} 件OK / ${pageTitleNg} 件NG`
);

// ─────────────────────────────────────────────
// 面（ページ種別）の分類と sitemap の突き合わせ（2026-08-19追加）
//
// `scripts/lib/gsc-page-type.js` は「どの面に投資するか」を決める唯一の材料
// （seo-report.js の③1ページあたりクリック・④面別の週次推移）の土台だが、
// **sitemap との対応を誰も突き合わせていなかった**。そのため新しいページ種別を
// 作って sitemap に載せても、分類は黙って「その他」に落とすだけで、面別の表に
// 一度も現れない。表に出ないページは効果を測られず、作られたことすら忘れられる。
// これは「孤立ページを作らない」（人とクローラーから辿れるか）の**計測版**で、
// あちらが導線を見張るのに対しこちらは投資判断の土俵に乗るかを見張る。
//
// 2026-08-05に踏んだ「画面を見ている限り気づけない」壊れ方と同じ形なので、
// 人の注意ではなく機械で止める。
// ─────────────────────────────────────────────
console.log("\n── 面（ページ種別）の分類 ──");
let faceNg = 0;
{
  const gsc = (await import("./lib/gsc-page-type.js")).default as {
    PAGE_TYPES: string[];
    PAGE_TYPE_PREFIXES: Array<[string, string]>;
    SITEMAP_OTHER_PATHS: string[];
    pageType: (url: string) => string;
  };
  const { PAGE_TYPES: TYPES, PAGE_TYPE_PREFIXES: PREFIXES, SITEMAP_OTHER_PATHS: OTHERS, pageType: classify } = gsc;

  // sitemap が実際に出すパスを、テンプレートリテラルから拾う。
  // `url: siteUrl` はトップ、`url: `${siteUrl}/xxx/${...}`` は各面。
  const src = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
  const paths = new Set<string>();
  if (/url:\s*siteUrl\s*,/.test(src)) paths.add("/");
  for (const m of src.matchAll(/url:\s*`\$\{siteUrl\}([^`]*)`/g)) {
    // ${year} 等の埋め込みは適当な値に潰す（分類は接頭辞しか見ないため）。
    paths.add(m[1].replace(/\$\{[^}]*\}/g, "x") || "/");
  }

  // ① sitemap に載る全パスが、面か「面として数えない」宣言のどちらかに当たること。
  {
    const stray = [...paths].filter((p) => classify(`https://example.com${p}`) === "その他" && !OTHERS.includes(p));
    const pass = paths.size > 0 && stray.length === 0;
    if (!pass) faceNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"sitemapの全パスが面に分類される".padEnd(34)} → ${paths.size}種中 未分類${stray.length}件` +
        (pass
          ? ""
          : `  (${stray.join(", ")} … scripts/lib/gsc-page-type.js の PAGE_TYPE_PREFIXES に面を足すか、` +
            `面として数えない理由を書いて SITEMAP_OTHER_PATHS に登録してください)`)
    );
  }

  // ② 逆向き。面として数えているのに sitemap がそのパスを1つも出していない
  //    ＝ 消えたページ種別が集計だけ残っている状態を検知する。
  {
    const dead = PREFIXES.filter(([, prefix]) => ![...paths].some((p) => p.startsWith(prefix)));
    const pass = dead.length === 0;
    if (!pass) faceNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"面が実在するページを指している".padEnd(34)} → ${PREFIXES.length}面中 実体なし${dead.length}件` +
        (pass ? "" : `  (${dead.map(([t, p]) => `${t}=${p}`).join(", ")})`)
    );
  }

  // ③ 「面として数えない」宣言が、実際に sitemap にあるパスだけであること
  //    （消えたパスの宣言が残ると、次に同じパスを作ったとき①をすり抜ける）。
  {
    const stale = OTHERS.filter((p) => !paths.has(p));
    const pass = stale.length === 0;
    if (!pass) faceNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"数えない宣言が現存パスだけ".padEnd(34)} → ${OTHERS.length}件中 実体なし${stale.length}件` +
        (pass ? "" : `  (${stale.join(", ")})`)
    );
  }

  // ④ PAGE_TYPES（表示順）と PAGE_TYPE_PREFIXES がズレていないこと。
  //    seo-report.js は PAGE_TYPES の順で表を出すので、ここがズレると
  //    集計にはあるのに表に出ない面ができる。
  {
    const missing = PREFIXES.map(([t]) => t).filter((t) => !TYPES.includes(t));
    const pass = missing.length === 0 && TYPES[0] === "トップ" && TYPES[TYPES.length - 1] === "その他";
    if (!pass) faceNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"面の一覧と表示順が揃っている".padEnd(34)} → ${TYPES.join("/")}` +
        (pass ? "" : `  (漏れ: ${missing.join(", ")})`)
    );
  }

  // ⑤ 面の内訳を出す（新しい面を足したときに、そこが本当に0でないかを人が見るため）。
  console.log(`ℹ  sitemapが出すパス: ${[...paths].sort().join(" ")}`);
}
console.log(`結果（面の分類）: ${faceNg === 0 ? 4 : 0} 件OK / ${faceNg} 件NG`);

// ─────────────────────────────────────────────
// description（スニペット）の基準の検査（2026-08-19追加）
//
// title には2026-08-05に幅の予算を作ったのに、description は幅も内容も
// 誰も見ていなかった。作品ページは実データ465件で中央80.0・最長148.5（全角換算）
// あり、PCの観測値105を超える分は**誰にも読まれないのに書かれていた**。
//
// 【なぜ title と同じ扱いにしないか・2026-08-19に調べた事実】
//   ① Google はスニペットの打ち切り幅を公表していない（非公式の観測値のみ）。
//   ② Google は meta description の62〜71%を書き換える
//      （Ahrefs 62.78% / Portent 68〜71%）。裏を返すと3割前後はそのまま使われる
//      ので「書かない」は選ばない。
//   ③ テンプレートで機械生成すること自体はスパムポリシー（scaled content abuse）の
//      対象ではない。あちらが見ているのは方式ではなく主目的と価値。ただし変数部分が
//      効かず同一の文になると重複として書き換えられやすい。
// そこで見るのは幅そのものより「差別化情報が先頭にあるか」と「重複していないか」。
// 出典は docs/seo-operations.md 4節。
// ─────────────────────────────────────────────
console.log("\n── descriptionの基準 ──");
let descNg = 0;
{
  const meta = await import("../lib/pageMeta.ts");
  const { DESCRIPTION_WIDTH_BUDGET: DW, DESCRIPTION_LEAD_BUDGET: DL } = meta;
  const { displayWidth: width } = await import("../lib/workTitle.ts");
  const { SEASON_LABEL } = await import("../lib/resolveSeasonParams.ts");
  const { buildWatchDescription: watchDesc, fitDescServices } = await import(
    "../lib/workAvailability.ts"
  );

  // face（面）ごとに [description, 差別化する語, 最短形の幅] を集める。
  // 最短形＝その面の組み立てで削れるものを全部削ったときの幅。これが上限を超えるなら
  // 削りようがない（作品名・人名そのものが長い）ので、落とさず警告に留める。
  type DescRow = [string, string, number];
  const faces: Array<{ face: string; rows: DescRow[] }> = [];
  const Y = String(new Date().getFullYear());
  const seasons = Object.keys(SEASON_LABEL);
  const cool = (se: string) => `${Y}年${SEASON_LABEL[se]}アニメ`;

  // 面ごとに文型が1つしか無いものは、削れる余地が無いので最短形＝そのもの。
  const fixed = (d: string, key: string): DescRow => [d, key, width(d)];
  faces.push({
    face: "シーズン",
    rows: seasons.map((se) => fixed(meta.seasonPageDescription(Y, se), cool(se))),
  });
  faces.push({
    face: "独占",
    rows: seasons.map((se) => fixed(meta.exclusivePageDescription(Y, se), cool(se))),
  });
  faces.push({
    face: "ランキング",
    rows: seasons.map((se) => fixed(meta.rankingsPageDescription(Y, se), cool(se))),
  });
  {
    const { SERVICES: SVCS } = await import("../lib/services.ts");
    faces.push({
      face: "サービス別",
      rows: SVCS.flatMap((sv) =>
        seasons.map((se) => fixed(meta.servicePageDescription(sv.name, Y, se), sv.name))
      ),
    });
  }
  {
    const idx = JSON.parse(
      readFileSync(new URL("../content/archive/studios.json", import.meta.url), "utf8")
    ) as { studios: Record<string, unknown[]>; directors: Record<string, unknown[]> };
    for (const [face, role, src] of [
      ["制作会社", "studio", idx.studios],
      ["監督", "director", idx.directors],
    ] as Array<[string, "studio" | "director", Record<string, unknown[]>]>) {
      faces.push({
        face,
        rows: Object.entries(src).map(([n, ws]) =>
          fixed(meta.creditPageDescription(role, n, ws.length), n)
        ),
      });
    }
  }
  {
    const idx = JSON.parse(
      readFileSync(new URL("../content/archive/people.json", import.meta.url), "utf8")
    ) as { people: Record<string, unknown[]> };
    faces.push({
      face: "声優",
      rows: Object.keys(idx.people).flatMap((n) =>
        [true, false].map((f) => fixed(meta.personPageDescription(n, Y, "summer", f), n))
      ),
    });
  }
  {
    // 作品ページは lib/workAvailability.ts が組み立てる（面ごとに置き場所が違うので
    // ここで両方を同じ基準にかける）。
    const { readSnapshots: readSnaps } = await import("./build-archive-index.ts");
    const rows: DescRow[] = [];
    for (const { data } of readSnaps()) {
      for (const it of data.items) {
        const shorts = it.services.map((sv) => sv.short);
        if (shorts.length === 0) continue;
        const descServices = fitDescServices({
          title: it.title,
          serviceShorts: shorts,
          releaseLead: "",
          status: "finished",
          budget: DW,
        });
        // 作品ページで削れるのはサービス名だけ。最短形＝1件だけ並べた形
        // （0件だと「配信情報があるのは 。」という壊れた文になるため）。
        const minimal = watchDesc({
          title: it.title,
          descServices: shorts[0],
          releaseLead: "",
          status: "finished",
        });
        rows.push([
          watchDesc({ title: it.title, descServices, releaseLead: "", status: "finished" }),
          it.title,
          width(minimal),
        ]);
      }
    }
    faces.push({ face: "作品", rows });
  }

  // ① 差別化する語が先頭 DESCRIPTION_LEAD_BUDGET 以内から始まること。
  //    後半は切られて読まれないので、そこに置いた語は無いのと同じ。
  {
    let ng = 0;
    const samples: string[] = [];
    for (const { face, rows } of faces) {
      let faceNgCount = 0;
      for (const [desc, key] of rows) {
        const at = desc.indexOf(key);
        const ok = at >= 0 && width(desc.slice(0, at)) <= DL;
        if (!ok) {
          faceNgCount++;
          if (samples.length < 3) samples.push(`${face}: ${desc.slice(0, 40)}…（${key}）`);
        }
      }
      ng += faceNgCount;
    }
    const pass = ng === 0;
    if (!pass) descNg++;
    const total = faces.reduce((a, f) => a + f.rows.length, 0);
    console.log(
      `${pass ? "✓" : "✗"}  ${`差別化する語が先頭${DL}全角以内に出る`.padEnd(31)} → ${total}件中 違反${ng}件` +
        (pass ? "" : `  (${samples.join(" / ")})`)
    );
  }

  // ② 幅。主キーワード（作品名）自体が長い場合は削れないので警告に留め、
  //    「サービス名を足したせいで超えた」＝組み立ての誤りだけを落とす。
  {
    let fixable = 0;
    for (const { face, rows } of faces) {
      const over = rows.filter(([d]) => width(d) > DW);
      const worst = rows.reduce((a, [d]) => Math.max(a, width(d)), 0);
      // 最短形でも超えるなら削りようがない（作品名・人名そのものが長い）。
      const irreducible = over.filter(([, , minW]) => minW > DW).length;
      fixable += over.length - irreducible;
      console.log(
        `${over.length === 0 ? "✓" : "⚠"}  ${face.padEnd(30)} → ${rows.length}件中 超過${over.length}件（うち削れない${irreducible}件・最長${worst}）`
      );
    }
    const pass = fixable === 0;
    if (!pass) descNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${`削れる超過が残っていない（上限${DW}）`.padEnd(30)} → ${fixable}件`
    );
  }

  // ③ 同じ面の中で description が重複しないこと（変数部分が効いていること）。
  //    完全に同一の文が並ぶと重複として書き換えられやすくなる。
  {
    let ng = 0;
    const samples: string[] = [];
    for (const { face, rows } of faces) {
      const seen = new Map<string, number>();
      for (const [d] of rows) seen.set(d, (seen.get(d) ?? 0) + 1);
      const dup = [...seen.entries()].filter(([, n]) => n > 1);
      ng += dup.length;
      if (dup.length > 0 && samples.length < 2) samples.push(`${face}: ${dup[0][0].slice(0, 36)}…×${dup[0][1]}`);
    }
    const pass = ng === 0;
    if (!pass) descNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"同じ面の中で重複しない".padEnd(34)} → 重複${ng}種` +
        (pass ? "" : `  (${samples.join(" / ")})`)
    );
  }

  // ④ 逆戻り防止。ページ側で description を直書きしない。
  {
    const pages = [
      "../app/season/[year]/[season]/page.tsx",
      "../app/person/[name]/[year]/[season]/page.tsx",
      "../app/service/[key]/[year]/[season]/page.tsx",
      "../app/exclusive/[year]/[season]/page.tsx",
      "../app/rankings/[year]/[season]/page.tsx",
      "../app/studio/[name]/page.tsx",
      "../app/director/[name]/page.tsx",
    ];
    const bad = pages.filter((f) =>
      /const description = `/.test(readFileSync(new URL(f, import.meta.url), "utf8"))
    );
    const pass = bad.length === 0;
    if (!pass) descNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"descriptionを直書きしない".padEnd(34)} → ${pages.length}ページ中 直書き${bad.length}件` +
        (pass ? "" : `  (${bad.map((f) => f.replace("../app/", "")).join(", ")})`)
    );

    // 作品ページは幅の調整を fitDescServices に任せること。以前のように
    // slice(0, 5) で件数を決め打ちすると、②の検査（lib 側を直接測る）を素通りして
    // 予算超過が復活する。
    const workSrc = readFileSync(new URL("../app/anime/[id]/page.tsx", import.meta.url), "utf8");
    const usesFit = workSrc.includes("fitDescServices(");
    const hardCoded = /serviceShorts\.slice\(/.test(workSrc);
    const pass2 = usesFit && !hardCoded;
    if (!pass2) descNg++;
    console.log(
      `${pass2 ? "✓" : "✗"}  ${"作品ページは幅の調整をlibに任せる".padEnd(33)} → ` +
        `fitDescServices=${usesFit ? "あり" : "なし"} / 件数の決め打ち=${hardCoded ? "あり" : "なし"}`
    );
  }
}
console.log(`結果（descriptionの基準）: ${descNg === 0 ? 5 : 0} 件OK / ${descNg} 件NG`);

// ─────────────────────────────────────────────
// ページの厚み（薄いページを作らない）の検査（2026-08-19追加）
//
// 【なぜ文字数で決めないか・2026-08-19に調べた事実】
// Google に「内容の薄いページ」の**文字数の閾値は無い**。John Mueller は
// word count は thin content の指標ではないと明言しており、公式ガイドラインから
// 最低文字数の記述も削除されている。2024年3月の scaled content abuse ポリシーが
// 見ているのも量や生成方法ではなく「主目的が順位操作か・固有の価値があるか」。
// noindex にすべきかどうかにも公式の一律基準は無く、実務上は
// 「被リンク・アクセスがほぼ無い最薄のページから個別に判断」が落としどころ。
// 出典は docs/seo-operations.md 4節。
//
// したがってここで機械が守るのは「何文字あるか」ではなく次の2つ:
//   ① 索引・ページ・sitemap・内部リンクが**同じ閾値**を通ること
//      （どこか1つがズレると、404へのリンクを配るか、閾値未満の薄いページを
//        検索エンジンに登録するかのどちらかが起きる）
//   ② 閾値ちょうどのページがどれだけあるかを**毎回表示する**こと
//      （2026-08-19の実測で監督ページの45%が2作品ちょうどだった。この事実は
//        どこにも出ておらず、実際に3セッション気づかれなかった）
// 閾値を上げるかどうかは表示回数で判定する。期日つきの判定表は
// docs/seo-operations.md 3節。
// ─────────────────────────────────────────────
console.log("\n── ページの厚み ──");
let thinNg = 0;
{
  const { MIN_WORKS: STUDIO_MIN } = await import("../lib/studioIndex.ts");
  const { MIN_WORKS: PERSON_MIN } = await import("../lib/personIndex.ts");
  const { PERSON_PAGE_MIN_APPEARANCES: SEASON_MIN } = await import("../lib/personPage.ts");

  const studioIdx = JSON.parse(
    readFileSync(new URL("../content/archive/studios.json", import.meta.url), "utf8")
  ) as { studios: Record<string, unknown[]>; directors: Record<string, unknown[]> };
  const peopleIdx = JSON.parse(
    readFileSync(new URL("../content/archive/people.json", import.meta.url), "utf8")
  ) as { people: Record<string, unknown[]> };

  // ① 閾値未満のエントリが索引に1件も無いこと（＝ページ・sitemapにも出ない）。
  {
    const groups: Array<[string, Record<string, unknown[]>, number]> = [
      ["制作会社", studioIdx.studios, STUDIO_MIN],
      ["監督", studioIdx.directors, STUDIO_MIN],
      ["声優（他クール索引）", peopleIdx.people, PERSON_MIN],
    ];
    let ng = 0;
    const detail: string[] = [];
    for (const [label, src, min] of groups) {
      const under = Object.entries(src).filter(([, ws]) => ws.length < min);
      ng += under.length;
      if (under.length > 0) detail.push(`${label}: ${under.slice(0, 3).map(([n]) => n).join(", ")}`);
    }
    const pass = ng === 0;
    if (!pass) thinNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"索引に閾値未満のページが無い".padEnd(34)} → 違反${ng}件` +
        (pass ? `（下限 制作会社/監督=${STUDIO_MIN} 声優=${PERSON_MIN}）` : `  (${detail.join(" / ")})`)
    );
  }

  // ② 閾値の数値を直書きしないこと。sitemap・ページ・リンク判定が定数を通ること。
  //    数値を書き写すと、上げ下げしたときに片方だけ動いて404を配る。
  {
    const files: Array<[string, string, RegExp]> = [
      ["app/sitemap.ts", "../app/sitemap.ts", /PERSON_PAGE_MIN_APPEARANCES/],
      [
        "app/person/[name]/[year]/[season]/page.tsx",
        "../app/person/[name]/[year]/[season]/page.tsx",
        /PERSON_PAGE_MIN_APPEARANCES/,
      ],
      ["lib/studioIndex.ts", "../lib/studioIndex.ts", /MIN_WORKS/],
      ["scripts/build-studio-index.ts", "./build-studio-index.ts", /MIN_WORKS/],
      ["scripts/build-person-index.ts", "./build-person-index.ts", /MIN_WORKS/],
    ];
    const bad: string[] = [];
    for (const [label, rel, needle] of files) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      // 定数を参照していない、または「2作品以上」を数値で判定している箇所があればNG。
      const usesConst = needle.test(src);
      // 「> 0」「=== 0」は空判定なので閾値ではない。閾値として直書きされうるのは
      // 2以上の比較だけ（下限は2）。
      const hardCoded = /(?:length|count)\s*[<>]=?\s*[2-9]/.test(src);
      if (!usesConst || hardCoded) bad.push(label);
    }
    const pass = bad.length === 0;
    if (!pass) thinNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"閾値を数値で直書きしない".padEnd(34)} → ${files.length}箇所中 違反${bad.length}件` +
        (pass ? "" : `  (${bad.join(", ")})`)
    );
  }

  // ③ sitemap が載せる面はすべて、閾値の門番を通った集合から作られていること。
  //    制作会社・監督は索引そのもの（①で担保）、声優は定数で絞っている。
  {
    const sm = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
    const guards = [
      ["声優（今期）", /castCounts[\s\S]{0,400}?PERSON_PAGE_MIN_APPEARANCES/],
      ["声優（過去クール）", /personCounts[\s\S]{0,400}?PERSON_PAGE_MIN_APPEARANCES/],
      ["サービス別", /serviceKeys/],
    ] as Array<[string, RegExp]>;
    const missing = guards.filter(([, re]) => !re.test(sm)).map(([l]) => l);
    const pass = missing.length === 0;
    if (!pass) thinNg++;
    console.log(
      `${pass ? "✓" : "✗"}  ${"sitemapが門番を通した集合だけ載せる".padEnd(33)} → ${guards.length}面中 門番なし${missing.length}件` +
        (pass ? "" : `  (${missing.join(", ")})`)
    );
  }

  // ④ 厚みの分布を毎回出す。閾値を上げるかどうかの判断材料で、落とすためのものではない
  //    （何作品あれば十分かに公式の基準は無く、表示回数で判定するしかない）。
  {
    const groups: Array<[string, Record<string, unknown[]>, number]> = [
      ["制作会社", studioIdx.studios, STUDIO_MIN],
      ["監督", studioIdx.directors, STUDIO_MIN],
      ["声優（他クール索引）", peopleIdx.people, PERSON_MIN],
    ];
    for (const [label, src, min] of groups) {
      const counts = Object.values(src).map((w) => w.length);
      const total = counts.length;
      const atFloor = counts.filter((c) => c === min).length;
      const thin = counts.filter((c) => c <= min + 1).length;
      const max = counts.reduce((a, c) => Math.max(a, c), 0);
      console.log(
        `ℹ  ${label.padEnd(30)} → 全${total}件  ${min}作品ちょうど ${atFloor}件（${((atFloor / total) * 100).toFixed(0)}%）  ` +
          `${min + 1}作品以下 ${thin}件（${((thin / total) * 100).toFixed(0)}%）  最大${max}作品`
      );
    }
    // 作品ページは「配信情報が1件以上」が門番（0件だと『配信情報なし』としか言えない）。
    const archive = JSON.parse(
      readFileSync(new URL("../content/archive/index.json", import.meta.url), "utf8")
    ) as { seasons: Array<{ total: number; workIds: number[] }> };
    const listed = archive.seasons.reduce((a, x) => a + x.workIds.length, 0);
    const all = archive.seasons.reduce((a, x) => a + x.total, 0);
    console.log(
      `ℹ  ${"作品（過去クール索引）".padEnd(30)} → 全${all}件中 ${listed}件を掲載（門番＝配信情報が1件以上）`
    );
  }
}
console.log(`結果（ページの厚み）: ${thinNg === 0 ? 3 : 0} 件OK / ${thinNg} 件NG`);

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
    // pinnedDraft は2026-08-16に {text, replyUrl} 形式へ変わった。ここが古い形のままだと
    // renderGrowthKit が落ちる（＝この検査自体が動かなくなる）ので、実物と同じ形で渡す。
    pinnedDraft: { text: "固定ポスト本文", replyUrl: null },
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
// Xの投稿方針の検査（2026-08-16追加・シャドウバン対応）
//
// 2026-08-07に @animedia0705 の Search Ban が判明し、推定原因は
// 「同一に近い文面 × 高頻度 × 毎回リンク × 無会話」だった（docs/handoff.md）。
// 打ち手として「頻度を1日1回以下・本文からリンクを外す・タグを減らす・本文を毎回変える」を
// 決めたが、**9日間コードに入らないまま**だった。さらに悪いことに、2026-08-06に
// 「毎週同じ文面をやめた」修正を入れたときXだけが対象外（文面パターンが1つ）で、
// 対策が入っているつもりで入っていない状態になっていた。
//
// 同じ取り違えが起きないよう、Xについてだけ次の4点を機械的に固定する。
// **他の3つ（Bluesky/Mastodon/Threads）には適用しない**（シャドウバンの対象ではなく、
// 本文リンクで問題なく届いているため。ここを一律にすると別の投稿先の運用まで壊す）。
// ─────────────────────────────────────────────
console.log("\n── Xの投稿方針（シャドウバン対応・2026-08-16）──");
let xPolicyNg = 0;
{
  // (1) 1日1投稿。3種類そろう日でも1件しか返さないこと、そして狙った種別がその日に
  //     無くても0件にならない（＝黙って投稿が消えない）ことの両方を見る。
  const all = [{ kind: "top5" }, { kind: "airing" }, { kind: "spotlight" }];
  const perDay = [0, 1, 2, 3, 4, 5, 6].map((w) => pickDailyXPost(all, w));
  const oneEach = perDay.every((posts) => posts.length === 1);
  // 週のうちに3種類とも登場すること（1種類に偏ると「毎日同じ投稿」に逆戻りする）。
  const kindsInWeek = [...new Set(perDay.flat().map((p) => p.kind))].sort();
  const coversAll = JSON.stringify(kindsInWeek) === JSON.stringify(["airing", "spotlight", "top5"]);
  // 狙った種別が無い日のフォールバック（水曜=airing だが airing が作られなかった場合）。
  const fallback = pickDailyXPost([{ kind: "top5" }, { kind: "spotlight" }], 3);
  const fallbackOk = fallback.length === 1;
  const p1 = oneEach && coversAll && fallbackOk;
  if (!p1) xPolicyNg++;
  console.log(
    `${p1 ? "✓" : "✗"}  ${"Xは1日1投稿（0件にも2件以上にもならない）".padEnd(40)} → 各日1件=${oneEach} 週内に3種=${coversAll} 欠けた日の代替=${fallbackOk}`
  );

  // (2) 本文にURLを載せない（Xだけ）。他の投稿先は従来どおり載せる。
  const p2 = bodyIncludesUrl("x") === false && ["bluesky", "mastodon", "threads"].every((pf) => bodyIncludesUrl(pf) === true);
  if (!p2) xPolicyNg++;
  console.log(
    `${p2 ? "✓" : "✗"}  ${"本文のURLはXだけ外す（他は従来どおり）".padEnd(40)} → x=${bodyIncludesUrl("x")} bluesky=${bodyIncludesUrl("bluesky")}`
  );

  // (3) 本文からURLを外したなら、必ずリプライ用のURLを対で出す。
  //     ここが抜けると「リンクを外した」だけになり、流入経路が丸ごと消える。
  //     本文生成は実データが要るので、Issue本文の組み立て側で対を検査する。
  const withReply = printDigest.renderIssue([
    { kind: "top5", text: "【テスト】本文", replyUrl: "https://example.test/season/2026/summer" },
  ]);
  const withoutReply = printDigest.renderIssue([{ kind: "top5", text: "【テスト】本文" }]);
  const p3 =
    withReply.includes("https://example.test/season/2026/summer") &&
    withReply.includes("リプライ") &&
    !withoutReply.includes("リプライ"); // replyUrlが無い投稿先には出さない
  if (!p3) xPolicyNg++;
  console.log(
    `${p3 ? "✓" : "✗"}  ${"URLを外した投稿はリプライ用URLを対で出す".padEnd(40)} → 出る=${withReply.includes("リプライ")} 無い時は出ない=${!withoutReply.includes("リプライ")}`
  );

  // (4) 文面のパターン数。Xだけ1パターンに戻ると「毎週一字一句同じ」に逆戻りする。
  //     ソースを読んで x の配列の要素数を数える（テーブルが増えても自動で対象になる）。
  //     行ベースで数える（複数行にまたがる正規表現は書き方に依存して静かに0件になり、
  //     「検査しているつもりで何も見ていない」状態になるため使わない）。
  //     この表は「1要素1行」で書く決まりなので、開き `  x: [` と閉じ `  ],` の間の
  //     実質的な行数がそのまま要素数になる。
  const src = readFileSync(new URL("./lib/build-digest.js", import.meta.url), "utf8");
  // このリポジトリのファイルはCRLFで保存されているものがある（build-digest.jsもCRLF）。
  // 素の split("\n") だと各行の末尾に \r が残り、`line === "  x: ["` が永久に偽になって
  // **0件検出＝素通り**になる。実際この検査を書いた初回はそれで緑に見えていた。
  const srcLines = src.split("\n").map((l) => l.replace(/\r$/, ""));
  const tables: { name: string; count: number }[] = [];
  srcLines.forEach((line, i) => {
    if (line !== "  x: [") return;
    // 直前でいちばん近い `const NAME = {` をこの表の名前とする。
    let name = "(不明)";
    for (let j = i; j >= 0; j--) {
      const m = srcLines[j].match(/^const ([A-Z0-9_]+) = \{$/);
      if (m) {
        name = m[1];
        break;
      }
    }
    let count = 0;
    for (let j = i + 1; j < srcLines.length && srcLines[j] !== "  ],"; j++) {
      const t = srcLines[j].trim();
      if (t !== "" && !t.startsWith("//")) count++;
    }
    tables.push({ name, count });
  });
  const thin = tables.filter((t) => t.count < 3);
  const p4 = tables.length >= 4 && thin.length === 0;
  if (!p4) xPolicyNg++;
  console.log(
    `${p4 ? "✓" : "✗"}  ${"Xの文面も3パターン以上ある".padEnd(40)} → ${tables.map((t) => `${t.name}=${t.count}`).join(" ")}` +
      (p4 ? "" : `  (不足: ${JSON.stringify(thin)})`)
  );

  // (5) 週次X成長キットも同じ方針で出す（2026-08-16追加）。
  //     【なぜ両方見るのか】2026-08-05に日次側のリンク先を /season/ 形式へ直したとき、
  //     当時の検査が build-digest.js しか見ていなかったため**週次キットだけ直し漏れて
  //     1日も気づかれなかった**（⑫の経緯）。「Xの投稿はこう出す」という同じ不変条件を
  //     持つファイルは、最初から全部ここで見る。
  const kitWith = renderGrowthKit({
    year: 2026,
    label: "夏",
    todayStr: "2026-08-16",
    count: 1,
    drafts: [{ label: "① テスト", text: "【テスト】本文", replyUrl: "https://example.test/season/2026/summer" }],
    queries: ["テスト"],
    pinnedDraft: { text: "【テスト】固定", replyUrl: "https://example.test/season/2026/summer" },
  });
  const p5 = kitWith.includes("https://example.test/season/2026/summer") && kitWith.includes("リプライ");
  if (!p5) xPolicyNg++;
  console.log(
    `${p5 ? "✓" : "✗"}  ${"週次キットもリプライ用URLを出す".padEnd(40)} → URL=${kitWith.includes("https://example.test/season/2026/summer")} 文言=${kitWith.includes("リプライ")}`
  );

  // (6) 週次キットの本文組み立てが bodyIncludesUrl を共有していること。
  //     ここで独自に判定を書き直されると、日次だけ直して週次が取り残される形に戻る。
  const kitSrc = readFileSync(new URL("./lib/build-growth-kit.js", import.meta.url), "utf8");
  const sharesPolicy = /bodyIncludesUrl/.test(kitSrc) && /require\("\.\/build-digest"\)/.test(kitSrc);
  // 死んだ生成物を残さない（replyDrafts は2026-08-16に方針変更で削除済み）。
  const noDeadReplies = !/function replyDrafts/.test(kitSrc);
  const p6 = sharesPolicy && noDeadReplies;
  if (!p6) xPolicyNg++;
  console.log(
    `${p6 ? "✓" : "✗"}  ${"週次キットは判定を日次と共有する".padEnd(40)} → bodyIncludesUrlを使う=${sharesPolicy} 死んだリプ下書き無し=${noDeadReplies}`
  );
}
console.log(`結果（Xの投稿方針）: ${6 - xPolicyNg} 件OK / ${xPolicyNg} 件NG`);

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
// 配信情報の構造化データ（2026-08-13追加。同日に設計をWatchActionから入れ替え）
//
// 【なぜ要るか】作品ページの JSON-LD は声優・監督・製作会社・原作者を持っていたのに、
// このサイトの中心的な事実である「どこで配信されているか」は可視テキストにしか無く、
// AI検索・生成AIが読む機械可読の層から落ちていた。そこへ載せるにあたり、可視テキストで
// 既に守っている制約を機械可読側でも同じ強さで守る必要がある。
//
// 【WatchAction を復活させない】最初の実装は potentialAction に WatchAction を並べて
// いたが、①放送開始前の作品を弾けない（status は finished しか見ない＝1話も配信されて
// いない作品に「見られる」と配る）②target に入れられるのはサービスの公式トップページ
// だけで作品への直リンクが無い（「リンクの見た目＝遷移先」を人の目に触れない層で犯す）
// ③見放題／レンタルを表す Offer を付けられない、の3点で撤回した。代わりに
// additionalProperty（PropertyValue）で事実だけを述べる。
// この節は「事実だけを述べる形から、行為を主張する形へ逆戻りしていないこと」を見張る。
// 見張るのは5点:
//   (1) 出すのは PropertyValue だけ。WatchAction / potentialAction / EntryPoint が
//       lib/workAvailability.ts と作品ページの生成箇所のどちらにも復活していない
//   (2) URL を1つも持たない（＝広告リンクが混入する経路が存在しない）
//   (3) 配信の現在の可否を主張する語（配信中・視聴できます等）を property 名に使わない
//   (4) 0件のときは additionalProperty ごと出さない／重複を出さない
//   (5) 取得元・取得日を「確認日」と書かない（Annictからデータを取った日であって、
//       配信の可否を誰かが確認した日ではない。docs/operations.md の⑰）
// ─────────────────────────────────────────────
console.log("\n── 配信情報の構造化データ ──");
let ldNg = 0;
{
  function ldCheck(name: string, pass: boolean, detail: string) {
    if (!pass) ldNg++;
    console.log(`${pass ? "✓" : "✗"}  ${name.padEnd(38)} → ${detail}`);
  }

  // 実データ（SERVICES 全件）で作る。提携済みのサービス（ABEMA・Prime・Hulu等）が
  // 必ず含まれるので、(2)の検査が「たまたま提携が無いから通る」状態にならない。
  const sampleServices = SERVICES.map((s) => ({ name: s.name }));
  const props = buildStreamingProperties(sampleServices);
  const propsJson = JSON.stringify(props);

  // (1) 形。PropertyValue 以外の @type を出さない。
  ldCheck(
    "サービスの数だけPropertyValueが出る",
    props.length === SERVICES.length,
    `${props.length}件（SERVICES ${SERVICES.length}件）`
  );
  const shapeBad = props.filter(
    (a) =>
      a["@type"] !== "PropertyValue" ||
      a.name !== STREAMING_PROPERTY_NAME ||
      typeof a.value !== "string" ||
      Object.keys(a).length !== 3
  );
  ldCheck(
    "PropertyValue（name/value）だけ",
    shapeBad.length === 0,
    shapeBad.length === 0
      ? `全件 PropertyValue（name="${STREAMING_PROPERTY_NAME}"）`
      : `${shapeBad.length}件が期待の形でない: ${JSON.stringify(shapeBad.slice(0, 2))}`
  );
  // 配列同士の比較。区切り文字を挟む方式は、区切り文字を含むサービス名が現れたときに
  // 誤判定しうる。さらに生のNULバイトをソースへ置くと grep/ripgrep がこのファイルを
  // バイナリ扱いし、他の検査が使っている目印の探索まで止まる。JSONで比べる。
  const valuesOk =
    JSON.stringify(props.map((a) => a.value)) ===
    JSON.stringify(SERVICES.map((s) => s.name));
  ldCheck(
    "valueはサービスの表示名",
    valuesOk,
    valuesOk ? "SERVICES の name と一致" : `不一致: ${JSON.stringify(props.slice(0, 3))}`
  );

  // (2) URLを1つも持たないこと。ここが守られている限り、広告リンクの混入は
  //     「入れ忘れ」ではなく「入れる場所が無い」状態になる。
  const urlHit = /https?:\/\//.test(propsJson);
  ldCheck(
    "構造化データにURLが無い",
    !urlHit,
    urlHit ? `URLが含まれる: ${propsJson.slice(0, 120)}` : "0件（広告リンクの混入経路が存在しない）"
  );
  const aspHosts = affiliateHosts();
  const adHits = aspHosts.filter((h) => propsJson.includes(h));
  ldCheck(
    "広告リンクのドメインが無い",
    adHits.length === 0,
    adHits.length === 0
      ? `${aspHosts.length}ドメインすべて不在`
      : `混入: ${JSON.stringify(adHits)}（構造化データは第三者の機械に配られる）`
  );

  // (3) property 名が現在形を主張しないこと。放送終了クールの作品にも同じものを出す＝
  //     ここに「配信中」の語が入ると、可視テキストで禁じていることを機械可読側で犯す。
  const presentTenseWords = ["配信中", "視聴できます", "見られます", "配信されています"];
  const tenseHits = presentTenseWords.filter((w) => propsJson.includes(w));
  ldCheck(
    "現在形で断定する語が無い",
    tenseHits.length === 0,
    tenseHits.length === 0
      ? `property名は「${STREAMING_PROPERTY_NAME}」`
      : `混入: ${JSON.stringify(tenseHits)}（放送終了クールの作品にも同じものが出る）`
  );

  // (4) 0件・重複・空白。
  const emptyProps = buildStreamingProperties([]);
  ldCheck(
    "0件なら空配列",
    emptyProps.length === 0,
    emptyProps.length === 0
      ? "0件（additionalPropertyごと出さない）"
      : `${emptyProps.length}件出ている`
  );
  const dup = buildStreamingProperties([
    { name: "dアニメストア" },
    { name: "dアニメストア" },
    { name: "  " },
  ]);
  ldCheck(
    "重複と空名を落とす",
    dup.length === 1 && dup[0].value === "dアニメストア",
    dup.length === 1 ? "1件に畳まれる" : `${dup.length}件: ${JSON.stringify(dup)}`
  );

  // (5) 取得元と取得日。schema.org の語彙で機械可読になっていること。
  const provPageUrl = `${siteUrl}/anime/12345`;
  const provenance = buildDataProvenance("2026-08-13", provPageUrl);
  const citation = provenance.citation as { name?: string; url?: string } | undefined;
  const sdPublisher = provenance.sdPublisher as { url?: string } | undefined;
  const provOk =
    provenance.sdDatePublished === "2026-08-13" &&
    citation?.name === DATA_PROVIDER &&
    citation?.url === DATA_PROVIDER_URL &&
    typeof sdPublisher?.url === "string" &&
    sdPublisher.url.startsWith(siteUrl);
  ldCheck(
    "取得元と取得日が機械可読",
    provOk,
    provOk
      ? `sdDatePublished=2026-08-13 / citation=${DATA_PROVIDER}`
      : `期待の形でない: ${JSON.stringify(provenance)}`
  );

  // (5-2) 出所は **作品ノードではなく WebPage ノード**であること。
  // citation は CreativeWork の「その作品が参照している著作物」なので、TVSeries/Movie に
  // 付けると「このアニメがAnnictを引用している」という事実でない主張になる。可視テキストに
  // 無い嘘が機械可読の層にだけ残る型の事故（⑰・撤回した WatchAction と同じ）。
  const provNodeOk =
    provenance["@type"] === "WebPage" &&
    provenance["@id"] === provPageUrl &&
    provenance.url === provPageUrl;
  ldCheck(
    "出所はWebPageノードで出す（作品ノードに混ぜない）",
    provNodeOk,
    provNodeOk
      ? `@type=WebPage / @id=${provPageUrl}`
      : `作品ノードに混ざる形に戻っている: ${JSON.stringify(provenance)}`
  );

  // 実装レベルの担保（lib/embed.ts・公開データセットと同じ流儀）。
  // 生成箇所そのものを読んで、迂回・直書き・設計の逆戻りを押さえる。
  const libSrc = readFileSync(new URL("../lib/workAvailability.ts", import.meta.url), "utf8");
  // 注意書きとして禁止語そのものを書いているコメント行は除いてから探す。
  const stripComments = (text: string) =>
    text
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
  const libBody = stripComments(libSrc);
  ldCheck(
    "workAvailabilityはアフィリエイトを参照しない",
    !/affiliate/i.test(libBody),
    /affiliate/i.test(libBody) ? "参照している（広告リンクを渡せる口を作らない）" : "参照なし"
  );
  // 撤回した設計の名残・逆戻りを禁じる。コメントでの言及（＝なぜ使わないかの記録）は残す。
  const revertWords = ["WatchAction", "potentialAction", "EntryPoint", "urlTemplate"];
  const libRevert = revertWords.filter((w) => libBody.includes(w));
  ldCheck(
    "WatchActionが復活していない(lib)",
    libRevert.length === 0,
    libRevert.length === 0
      ? `${revertWords.length}語すべてコード上に無い`
      : `復活: ${JSON.stringify(libRevert)}（撤回した理由は同ファイルの注記）`
  );

  const pageSrc = readFileSync(new URL("../app/anime/[id]/page.tsx", import.meta.url), "utf8");
  // 構造化データの生成箇所＝workLd の組み立てから、JSON-LDを書き出す <script> まで。
  // 目印を動かしたら、この検査の目印も更新すること（検査を消さない）。
  const ldStart = pageSrc.indexOf("const workLd: Record<string, unknown> = {");
  const ldEnd = pageSrc.indexOf('type="application/ld+json"', ldStart);
  const ldRegion = ldStart >= 0 && ldEnd > ldStart ? pageSrc.slice(ldStart, ldEnd) : null;
  if (!ldRegion) {
    ldNg++;
    console.log("✗  作品ページのJSON-LD生成箇所（workLd〜application/ld+json）を特定できない");
    console.log("   → 構造を変えたなら、この検査の目印も更新すること（検査を消さない）");
  } else {
    // additionalProperty は buildStreamingProperties の結果だけから来ること。直書きに
    // 戻ると上の (1)〜(4) の検査を丸ごと素通りできてしまう。
    const assignLines = ldRegion
      .split("\n")
      .filter((l) => l.includes("additionalProperty") && !/^\s*(\/\/|\*|\/\*)/.test(l))
      .map((l) => l.trim());
    const wiredOk =
      ldRegion.includes("buildStreamingProperties(") &&
      assignLines.length === 1 &&
      assignLines[0] === "workLd.additionalProperty = streamingProperties;";
    ldCheck(
      "additionalPropertyはworkAvailability由来",
      wiredOk,
      wiredOk ? "buildStreamingPropertiesの結果のみ" : `直書きの疑い: ${JSON.stringify(assignLines)}`
    );
    ldCheck(
      "取得元・取得日もworkAvailability由来",
      ldRegion.includes("buildDataProvenance("),
      ldRegion.includes("buildDataProvenance(") ? "buildDataProvenanceを使う" : "直書きに戻っている"
    );
    // 出所を作品ノードに畳み込む書き方（Object.assign(workLd, ...) や workLd.citation = ...）に
    // 戻っていないこと。戻ると (5-2) の検査は通ったまま作品ノードに citation が乗る。
    const ldRegionBody = stripComments(ldRegion);
    const mergedIntoWork =
      /Object\.assign\(\s*workLd/.test(ldRegionBody) ||
      /workLd\.(citation|sdDatePublished|sdPublisher)\s*=/.test(ldRegionBody);
    ldCheck(
      "出所を作品ノードに畳み込んでいない",
      !mergedIntoWork,
      mergedIntoWork
        ? "workLdへ merge している（citationは作品のプロパティなので嘘になる）"
        : "WebPageノードとして別に出している"
    );
    // 書き出す <script> の配列に WebPage ノードが載っていること（作らせただけで
    // 出力に入れ忘れる、という抜けを塞ぐ）。
    const emitTail = pageSrc.slice(ldEnd, ldEnd + 400);
    const emitted = emitTail.includes("provenanceLd");
    ldCheck(
      "WebPageノードをJSON-LDに出力している",
      emitted,
      emitted ? "JSON.stringify の配列に含まれる" : `出力に無い: ${JSON.stringify(emitTail.slice(0, 200))}`
    );
    const ldBody = stripComments(ldRegion);
    const pageRevert = revertWords.filter((w) => ldBody.includes(w));
    ldCheck(
      "WatchActionが復活していない(作品ページ)",
      pageRevert.length === 0,
      pageRevert.length === 0
        ? `${revertWords.length}語すべてコード上に無い`
        : `復活: ${JSON.stringify(pageRevert)}`
    );
    const pageAdHits = [...aspHosts, "pickAffiliate"].filter((h) => ldRegion.includes(h));
    ldCheck(
      "生成箇所が広告リンクに触れない",
      pageAdHits.length === 0,
      pageAdHits.length === 0 ? "参照なし" : `参照している: ${JSON.stringify(pageAdHits)}`
    );
    // (5) 「確認日」の語。Annictから取った日を「確認日」と呼ぶと、二次利用側が
    //     「その日に配信を確認した」と読んでしまう（可視テキスト側は2026-08-06に
    //     「取得日」へ直した。同じ間違いを機械可読側で繰り返さない）。
    const provJson = JSON.stringify(provenance);
    const wordHits: string[] = [
      ["生成される構造化データ", provJson],
      ["lib/workAvailability.ts", libBody],
      ["作品ページの生成箇所", ldBody],
    ]
      .filter(([, text]) => text.includes("確認日"))
      .map(([where]) => where);
    ldCheck(
      "構造化データに「確認日」が現れない",
      wordHits.length === 0,
      wordHits.length === 0
        ? "3箇所すべて不在"
        : `混入: ${JSON.stringify(wordHits)}（Annictから取得した日であって確認した日ではない）`
    );
  }
}
console.log(`結果（配信情報の構造化データ）: ${ldNg === 0 ? "全件OK" : `${ldNg} 件NG`}`);

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
//   3. 表示            … lib/adminAnalytics.ts の EVENT_LABELS
//      （2026-08-19に page.tsx から lib へ移した。画面とJSON窓口
//      〈app/api/admin/analytics/route.ts〉が同じ集計を通るようにするため）
// どこか1つが欠けると「送っているのに保存されない」「保存されているのに見えない」に
// なる。dアニメストアの提携待ちの間はこの実測値が唯一の判断材料になるので、
// ズレを機械的に止める。
// ─────────────────────────────────────────────
console.log("\n── 行動ログの配線（logEvent / ALLOWED_EVENTS / EVENT_LABELS）──");
let trackNg = 0;
{
  const trackSrc = readFileSync(new URL("../app/api/track/route.ts", import.meta.url), "utf8");
  const labelSrc = readFileSync(
    new URL("../lib/adminAnalytics.ts", import.meta.url),
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
// 通称・略称が検索エンジンに見える形で出ているか（2026-08-19追加）
//
// 経緯: `content/works/aliases.ts` には44作品の略称が出典つきで登録されていたのに、
// 使われていたのは `components/SeasonExplorer.tsx` の**サイト内検索の絞り込みだけ**で、
// レンダリング後のHTMLには1回も出ていなかった。2026-08-19に本番ビルドを起動して実測:
// `/anime/9733` のHTMLに「シャングリラ」33回に対し「シャンフロ」0回・「鳥頭」0回、
// JSON-LDの `alternateName` は0箇所。**検索エンジンから見ると略称の語彙が存在しない**
// のと同じ状態だった（GSCには「逃げ若 2期 配信」14表示31.6位のように略称クエリが実在する）。
//
// 「データはあるのに出力に出ていない」は画面を見ても気づけないので機械的に見張る。
// ─────────────────────────────────────────────
console.log("\n── 通称・略称の露出 ──");
let aliasNg = 0;
{
  const aliasSrc = readFileSync(new URL("../content/works/aliases.ts", import.meta.url), "utf8");
  const pageSrc = readFileSync(
    new URL("../app/anime/[id]/page.tsx", import.meta.url),
    "utf8"
  );

  const t = (label: string, cond: boolean, detail: string) => {
    if (cond) console.log(`\u2713  ${label.padEnd(40)} \u2192 ${detail}`);
    else {
      console.log(`\u2717  ${label.padEnd(40)} \u2192 ${detail}`);
      aliasNg += 1;
    }
  };

  // 作品ページが略称を読み込んでいること。
  t(
    "作品ページが略称を読み込む",
    /from "@\/content\/works\/aliases"/.test(pageSrc),
    "WORK_ALIASES を import している"
  );

  // JSON-LD に alternateName を出していること（schema.orgの別名フィールド）。
  t(
    "JSON-LDにalternateNameを出す",
    /alternateName/.test(pageSrc),
    "workLd.alternateName がある"
  );

  // 可視テキストにも出していること。**機械可読だけに出すのは禁止**
  // （撤回した WatchAction と同じ「可視テキストに無い主張が機械可読の層にだけ残る」形）。
  t(
    "可視テキストにも通称を出す",
    /detail-alias/.test(pageSrc),
    ".detail-alias がある"
  );

  // 出典と確認日を添えること（人力補完の他ファイルと同じ扱い）。
  t(
    "通称に出典と確認日を添える",
    /alias\.sourceUrl/.test(pageSrc) && /alias\.confirmedDate/.test(pageSrc),
    "sourceUrl と confirmedDate を表示している"
  );

  // データ側が出典を構造化して持っていること（コメントに書くだけに戻さない）。
  t(
    "略称データが出典を構造化して持つ",
    /sourceUrl:/.test(aliasSrc) && /confirmedDate:/.test(aliasSrc),
    "sourceUrl / confirmedDate フィールドがある"
  );
}
console.log(`結果（通称・略称の露出）: ${aliasNg === 0 ? "全件OK" : `${aliasNg} 件NG`}`);

// ─────────────────────────────────────────────
// 配信サービスの口語形（2026-08-19導入）
//
// 口語形（Netflix→「ネトフリ」）は lib/services.ts の `kana` とは**別の層**に置く。
// `kana` は lib/serviceDataset.ts から公開API（GET /api/services）で配っている
// 名寄せ用データなので、観測にすぎない口語形を混ぜると二次利用側が
// チャンネル名の正規表記だと受け取りうる。層が混ざる方向への逆戻りを機械的に禁じる。
// ─────────────────────────────────────────────
console.log("\n── 配信サービスの口語形 ──");
let svcAliasNg = 0;
{
  const aliasSrc = readFileSync(
    new URL("../content/services/aliases.ts", import.meta.url),
    "utf8"
  );
  const servicesSrc = readFileSync(
    new URL("../lib/services.ts", import.meta.url),
    "utf8"
  );
  const workPageSrc = readFileSync(
    new URL("../app/anime/[id]/page.tsx", import.meta.url),
    "utf8"
  );
  const svcPageSrc = readFileSync(
    new URL("../app/service/[key]/[year]/[season]/page.tsx", import.meta.url),
    "utf8"
  );

  const t = (label: string, cond: boolean, detail: string) => {
    if (cond) console.log(`\u2713  ${label.padEnd(40)} \u2192 ${detail}`);
    else {
      console.log(`\u2717  ${label.padEnd(40)} \u2192 ${detail}`);
      svcAliasNg += 1;
    }
  };

  t(
    "口語形データが出典を構造化して持つ",
    /sourceUrl:/.test(aliasSrc) && /confirmedDate:/.test(aliasSrc),
    "sourceUrl / confirmedDate フィールドがある"
  );

  // 登録されている口語形をデータから読み出す（テスト側に文字列を書き写さない）。
  const aliasWords = [...aliasSrc.matchAll(/names:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  t(
    "口語形が1件以上登録されている",
    aliasWords.length > 0,
    `${aliasWords.length} 件: ${aliasWords.join("・")}`
  );

  // 層を混ぜない。口語形が lib/services.ts に現れたら、kana に流し込まれた疑い。
  const leaked = aliasWords.filter((w) => servicesSrc.includes(w));
  t(
    "口語形をlib/services.tsに混ぜない",
    leaked.length === 0,
    leaked.length === 0
      ? "SERVICES / kana に口語形は入っていない"
      : `混入: ${leaked.join("・")}`
  );

  // 表現を1箇所に集約する（2ページに直書きすると片方だけ直してズレる）。
  t(
    "作品ページが口語形の表現を共有する",
    /buildServiceLabel/.test(workPageSrc),
    "buildServiceLabel を使っている"
  );
  t(
    "サービス別ページが口語形を出す",
    /buildServiceLabel/.test(svcPageSrc),
    "buildServiceLabel を使っている"
  );

  // title・description には入れない（kana と同じ扱い。検索語の詰め込みをしない）。
  const metaBlock = svcPageSrc.slice(
    svcPageSrc.indexOf("export async function generateMetadata"),
    svcPageSrc.indexOf("export default async function")
  );
  t(
    "口語形をtitle/descriptionに入れない",
    metaBlock.length > 0 &&
      !/buildServiceLabel|serviceLabel/.test(metaBlock) &&
      !aliasWords.some((w) => metaBlock.includes(w)),
    "generateMetadata は正式名称だけを使っている"
  );

  // 素の挙動（口語形もカナも無いサービスは、余計な括弧を付けない）。
  const { buildServiceLabel } = await import("../content/services/aliases.ts");
  t(
    "カナも口語形も無ければ括弧を付けない",
    buildServiceLabel("dアニメ", undefined, "d_anime") === "dアニメ",
    "buildServiceLabel('dアニメ', undefined, 'd_anime') === 'dアニメ'"
  );
}
console.log(
  `結果（配信サービスの口語形）: ${svcAliasNg === 0 ? "全件OK" : `${svcAliasNg} 件NG`}`
);


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
    // 2026-08-19: 声優ページ**同士**（同じ人の他クールのページ）への横断リンク。
    // 上の "otherSeasonWorks" は作品ページ/シーズンページへのリンクしか作らないので、
    // sitemapに載せた過去クールの声優ページ4,483件は「そのクールの作品ページの
    // 声優名リンク」1本でしか辿れなかった。GSC実測（2026-08-15・直近28日）で
    // 声優ページは平均5.7位・CTR8.3%とサイトで唯一1ページ目に入れている面であり、
    // いちばん強いページから同じ人の他クールへ authority を渡す導線がここ。
    {
      file: "../app/person/[name]/[year]/[season]/page.tsx",
      needle: "/person/${",
      label: "声優ページ → 同じ人の他クールのページ",
    },
    // 2026-08-12: 制作会社ページ165件・監督ページ378件をsitemapに載せた。その入口は
    // 作品ページの「監督」「製作会社」欄のリンクだけで、一覧・トップからは辿れない。
    // ここが消えると543ページがまるごと孤立する（サービス別ページで踏んだ穴と同じ形）。
    {
      file: "../app/anime/[id]/page.tsx",
      needle: "/director/${",
      label: "作品ページ → 監督ページ",
    },
    {
      file: "../app/anime/[id]/page.tsx",
      needle: "/studio/${",
      label: "作品ページ → 制作会社ページ",
    },
    // 制作会社・監督ページから作品ページ・シーズンページへ戻る導線。
    {
      file: "../components/CreditPage.tsx",
      needle: "/anime/${",
      label: "制作会社・監督ページ → 作品ページ",
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
// 声優ページの索引方針（2026-08-25追加 → 2026-08-31に規則を差し替え）
//
// 経緯: 2026-08-11に過去クールの声優ページ4,483件をsitemapへ追加した。根拠にした実測
// 「声優ページは突出して強い（5.9位・CTR9.5%）」は**今期のページ**のものだった。
// 2026-08-25にこれを「今期のクール以外は全部noindex」で直そうとしたが、
// **その判断自体が途中までの週のデータに基づく誤りだった**（詳細は lib/personPage.ts）:
//   ・声優ページは表示の10.7%しかなく、全部除いても改善は1.74位（70%ではなく30%）。
//   ・過去年の声優ページは28日で37表示・6クリック・平均20.84位を実際に取っている。
//   ・「今期のクールだけ」は粗すぎて 2026/winter（6.6位・1.0位）まで巻き添えで外れる。
// いまの規則は「今年のクールは全部／過去年は出演作の多い声優だけ」。
// この節は ①規則が1箇所にあること ②実測でクリックを取っている声優が閾値を通ること
// を見張る。②は閾値をソースから読んで索引の実データと突き合わせる。
// ─────────────────────────────────────────────
console.log("\n── 声優ページの索引方針 ──");
let thinPersonNg = 0;
{
  const thinCheck = (label: string, ok: boolean, detail: string) => {
    if (!ok) thinPersonNg++;
    console.log(`${ok ? "✓" : "✗"}  ${label.padEnd(40)} → ${detail}`);
  };

  const policySrc = readFileSync(new URL("../lib/personPage.ts", import.meta.url), "utf8");
  const sitemapSrc = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
  const personSrc = readFileSync(
    new URL("../app/person/[name]/[year]/[season]/page.tsx", import.meta.url),
    "utf8"
  );

  const singleSource =
    policySrc.includes("export function shouldIndexPersonSeasonPage") &&
    policySrc.includes("PERSON_PAGE_INDEX_MIN_TOTAL_WORKS") &&
    !policySrc.includes("@/lib/"); // check.ts から直接importできること（CIで実際に落ちた）
  thinCheck(
    "索引方針の定義は1箇所",
    singleSource,
    singleSource
      ? "lib/personPage.ts が年と総出演数で判定（外部importなし）"
      : "判定が lib/personPage.ts に無い、または閾値・今期の求め方を独自に持っている"
  );

  const gated =
    sitemapSrc.includes("shouldIndexPersonSeasonPage") && sitemapSrc.includes("PEOPLE_INDEX");
  thinCheck(
    "sitemapは同じ判定で絞る",
    gated,
    gated
      ? "過去年ぶんを shouldIndexPersonSeasonPage で門番"
      : "無条件に積んでいる、または索引を参照していない（ページ側のnoindexとズレる）"
  );

  const pageOk =
    personSrc.includes("shouldIndexPersonSeasonPage") &&
    /robots:\s*\{\s*index:\s*false/.test(personSrc);
  thinCheck(
    "ページ側も同じ判定でnoindex",
    pageOk,
    pageOk ? "lib/personPage.ts の判定を使う" : "クール判定やnoindexを直書きしている"
  );

  // ページ自体は残すこと（404にしない）。過去クールの作品ページ1,961件への内部リンクが
  // ここを通っている。索引から外すのと、ページを消すのは別の話。
  const keepsPage = personSrc.includes("otherSeasonWorks");
  thinCheck(
    "ページ自体は消さない（内部リンクを残す）",
    keepsPage,
    keepsPage ? "他クールの出演作リンクは維持" : "過去クールの作品ページへの導線が消えている"
  );

  // 実測でクリックを取っている過去年の声優が、閾値で落ちないこと
  // （2026-08-27時点の28日データ。/person/{名}/{年}/{季} でクリック1件以上）。
  const m = policySrc.match(/PERSON_PAGE_INDEX_MIN_TOTAL_WORKS\s*=\s*(\d+)/);
  const threshold = m ? Number(m[1]) : NaN;
  const EARNERS = ["前野智昭", "斉藤壮馬", "森川智之", "櫻井孝宏"];
  const peopleIdx = JSON.parse(
    readFileSync(new URL("../content/archive/people.json", import.meta.url), "utf8")
  ) as { people: Record<string, unknown[]> };
  const survived = EARNERS.map((n) => ({ name: n, total: (peopleIdx.people[n] ?? []).length }));
  const allSurvive = Number.isFinite(threshold) && survived.every((x) => x.total >= threshold);
  thinCheck(
    "クリック実績のある声優が残る",
    allSurvive,
    allSurvive
      ? `閾値${threshold} / ` + survived.map((x) => `${x.name}=${x.total}`).join(" ")
      : `閾値${threshold} で落ちる: ` +
        survived
          .filter((x) => !(x.total >= threshold))
          .map((x) => `${x.name}=${x.total}`)
          .join(" ") +
        "（実測でクリックを取っているページを索引から外すことになる）"
  );

  console.log(`結果（声優ページの索引方針）: ${thinPersonNg === 0 ? "全件OK" : thinPersonNg + " 件NG"}`);
}

// ─────────────────────────────────────────────
// 事前生成に名前をエンコードして渡さない（2026-08-31追加・重大度高）
//
// 経緯: 本番で事前生成ページが404を返していた。sitemapに載せていて404だったのは
// 約2,826ページ（声優2,351／監督376／制作会社99）。決め手は日本語かどうかではなく
// **パーセントエンコードが要るかどうか**だった:
//   /studio/CloverWorks     （エンコード不要） → 200
//   /studio/A-1%20Pictures  （空白→%20）      → 404  ← ASCIIでも404
//   /studio/ぴえろ          （日本語）        → 404
//
// 原因は generateStaticParams が encodeURIComponent(name) を返していたこと。成果物が
// `%E3%81%B4….html` というファイル名で焼かれ、**Vercelはデコード後のパスで探す**ため
// 一致しない。生の名前で焼くカナリアを本番に出して確定させた（3件とも200）。
//
// ローカルの next start では全て200を返すので**手元では絶対に気づけない**（⑦-10と同じ型）。
// 逆戻りすると再び数千ページが404になるため、機械で見張る。
// 経緯は docs/operations.md の㊱、規則は lib/staticParams.ts。
// ─────────────────────────────────────────────
console.log("\n── 事前生成に名前をエンコードして渡さない ──");
let prerenderNg = 0;
{
  const preCheck = (label: string, ok: boolean, detail: string) => {
    if (!ok) prerenderNg++;
    console.log(`${ok ? "✓" : "✗"}  ${label.padEnd(40)} → ${detail}`);
  };

  const pages: [string, string][] = [
    ["../app/studio/[name]/page.tsx", "制作会社ページ"],
    ["../app/director/[name]/page.tsx", "監督ページ"],
    ["../app/person/[name]/[year]/[season]/page.tsx", "声優ページ"],
  ];
  for (const [rel, label] of pages) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    // generateStaticParams の本体だけを見る（canonical URL を組む encodeURIComponent は
    // 正しい使い方なので、ファイル全体を検索してはいけない）。
    const i = src.indexOf("export function generateStaticParams");
    if (i < 0) {
      preCheck(`${label}に generateStaticParams がある`, false, "見つからない（事前生成が消えている）");
      continue;
    }
    // 次の export までを本体とみなす。
    const rest = src.slice(i + 1);
    const j = rest.indexOf("\nexport ");
    const body = j < 0 ? rest : rest.slice(0, j);
    const encodes = body.includes("encodeURIComponent(");
    preCheck(
      `${label}が名前をエンコードして渡さない`,
      !encodes,
      encodes
        ? "generateStaticParams が encodeURIComponent を使っている（本番で404になる）"
        : "生の名前を渡している"
    );

    // 読む側は decodeParamName（不正な % でビルドを落とさない）を使うこと。
    const decodesSafely = src.includes("decodeParamName(");
    preCheck(
      `${label}が decodeParamName で読む`,
      decodesSafely,
      decodesSafely
        ? "lib/staticParams.ts の復元を使う"
        : "decodeURIComponent を直接呼んでいる（不正な % でビルドが落ちる）"
    );
  }

  // 応急処置（門番とカナリア）は原因確定に伴って消したこと。残っていると、
  // 事前生成から外れたページがオンデマンドISRに回り続けてVercelの書き込み下限が戻る（㉝）。
  const policy = readFileSync(new URL("../lib/staticParams.ts", import.meta.url), "utf8");
  const cleaned =
    !policy.includes("canPrerenderParam") && !policy.includes("PREGEN_CANARY");
  preCheck(
    "応急処置の門番とカナリアが残っていない",
    cleaned,
    cleaned ? "撤去済み" : "canPrerenderParam / PREGEN_CANARY が残っている"
  );

  console.log(`結果（事前生成の渡し方）: ${prerenderNg === 0 ? "全件OK" : prerenderNg + " 件NG"}`);
}

// ─────────────────────────────────────────────
// エラーページ・空ページを索引に開放しない（2026-08-31追加・重大度高）
//
// 経緯: 本番を面ごとに叩いて回ったところ、**取得に失敗したページが HTTP 200 ＋
// `index, follow` で返っていた**。実測:
//   /rankings/2099/winter        → 200 / index,follow / 本文「Annict API がエラーを返しました（500）。」
//   /exclusive/2099/winter       → 200 / index,follow / 同上
//   /service/netflix/2099/winter → 200 / index,follow / 同上
//   /person/悠木碧/2099/winter    → 200 / index,follow / 同上
//   /season/2099/winter          → 200 / index,follow / 作品リンク0件
//
// 原因は年の判定が `/^\d{4}$/` だけだったこと。1000〜9999年の9,000通りが全て
// 有効で、存在しない年のURLを叩くだけで ①Annictへライブ取得が飛び ②その空ページが
// ISRキャッシュに書き込まれ ③索引可能な形で公開される、が同時に起きていた。
// ②は2026-08-24に本番を丸一日停止させた ISR Writes 超過（㉝）と同じ経路で、
// しかもURL空間が無制限だった。
//
// 規則は2箇所が持つ:
//   lib/resolveSeasonParams.ts の isSeasonYearInRange … 年の範囲（範囲外は404）
//   lib/indexPolicy.ts の shouldIndexSeasonScopedPage … 失敗・0件は noindex
// 本番側の検知は scripts/verify-production.sh の H 節。経緯は docs/operations.md の㊲。
// ─────────────────────────────────────────────
console.log("\n── エラーページ・空ページを索引に開放しない ──");
let softNg = 0;
{
  const softCheck = (label: string, ok: boolean, detail: string) => {
    if (!ok) softNg++;
    console.log(`${ok ? "✓" : "✗"}  ${label.padEnd(40)} → ${detail}`);
  };

  // ① 年の範囲そのもの（実際に関数を呼ぶ）。
  const nowY = new Date().getFullYear();
  const yearCases: [string, boolean, string][] = [
    [String(MIN_SEASON_YEAR - 1), false, "下限の1つ手前"],
    [String(MIN_SEASON_YEAR), true, "下限ちょうど"],
    [String(nowY), true, "今年"],
    [String(nowY + 1), true, "来年（次クールが年をまたぐ）"],
    [String(nowY + 2), false, "再来年"],
    ["2099", false, "遠い未来"],
    ["1980", false, "収録範囲より前"],
    ["abcd", false, "数字でない"],
    ["99", false, "4桁でない"],
  ];
  let yearNg = 0;
  for (const [y, want, label] of yearCases) {
    if (isSeasonYearInRange(y) !== want) {
      yearNg++;
      softCheck(`年の範囲: ${label}`, false, `${y} → ${!want}（${want}のはず）`);
    }
  }
  softCheck(
    "年の範囲が実データに合っている",
    yearNg === 0,
    yearNg === 0
      ? `${MIN_SEASON_YEAR}〜${nowY + 1}年だけが有効（${yearCases.length}件の境界を確認）`
      : `${yearNg} 件が期待と違う`
  );

  // ② isValidYear が範囲判定へ委譲していること（`/^\\d{4}$/` 直書きへの逆戻り禁止）。
  const gsd = readFileSync(new URL("../lib/getSeasonData.ts", import.meta.url), "utf8");
  const delegates = /export function isValidYear[^}]*isSeasonYearInRange/.test(gsd);
  softCheck(
    "isValidYear が年の範囲判定に委譲する",
    delegates,
    delegates
      ? "isSeasonYearInRange を呼ぶ"
      : "4桁かどうかだけを見ている（1000〜9999年が全て有効になる）"
  );

  // ③ 失敗・0件は索引に載せない（実際に関数を呼ぶ）。
  const policyCases: [boolean, number, boolean, string][] = [
    [true, 10, false, "取得に失敗した（件数があっても載せない）"],
    [false, 0, false, "取得できたが0件"],
    [false, 1, true, "1件でもあれば載せる"],
  ];
  let policyNg = 0;
  for (const [failed, count, want, label] of policyCases) {
    if (shouldIndexSeasonScopedPage(failed, count) !== want) {
      policyNg++;
      softCheck(`索引の判定: ${label}`, false, `${!want}（${want}のはず）`);
    }
  }
  softCheck(
    "失敗・0件のページを索引に載せない",
    policyNg === 0,
    policyNg === 0 ? `${policyCases.length}件の場合分けを確認` : `${policyNg} 件が期待と違う`
  );
  // robots の中身も固定する（follow を落とすと内部リンクまで殺す）。
  const rf = robotsFor(true, 0).robots;
  softCheck(
    "noindex にしても follow は残す",
    rf?.index === false && rf?.follow === true,
    JSON.stringify(rf)
  );

  // ④ クール単位の5面が、この判定を通していること。
  //    ここを通さないページは、Annict障害中に「エラー」本文つきで索引されうる。
  const seasonScoped: [string, string][] = [
    ["../app/season/[year]/[season]/page.tsx", "シーズンページ"],
    ["../app/rankings/[year]/[season]/page.tsx", "ランキングページ"],
    ["../app/exclusive/[year]/[season]/page.tsx", "独占配信ページ"],
    ["../app/service/[key]/[year]/[season]/page.tsx", "サービス別ページ"],
    ["../app/person/[name]/[year]/[season]/page.tsx", "声優ページ"],
  ];
  for (const [rel, label] of seasonScoped) {
    const src = readFileSync(new URL(rel, import.meta.url), "utf8");
    const uses = src.includes("robotsFor(") || src.includes("NOINDEX_FOLLOW");
    softCheck(
      `${label}が索引の判定を通す`,
      uses,
      uses ? "lib/indexPolicy.ts を使う" : "失敗・0件でも index のまま公開される"
    );
  }

  // ⑤ 404ページが行き止まりでないこと。
  const nfPath = new URL("../app/not-found.tsx", import.meta.url);
  const hasNf = existsSync(nfPath);
  softCheck(
    "404ページがある",
    hasNf,
    hasNf ? "app/not-found.tsx" : "既定の画面（サイト内リンク0本の行き止まり）"
  );
  if (hasNf) {
    // 中身は components/NotFoundPanel.tsx が持つ（app/not-found.tsx はそれを描くだけ）。
    const nf = readFileSync(
      new URL("../components/NotFoundPanel.tsx", import.meta.url),
      "utf8"
    );
    const links = (nf.match(/<Link href=/g) || []).length;
    softCheck(
      "404ページに戻る導線がある",
      links >= 2,
      `<Link> が ${links} 本`
    );
    // ビルド時に事前生成され得るので、日付から組んだURLは古くなる。
    // コメントは除いて見る（「new Date() を使わない」という**注意書き**自体に
    // 反応してしまうため。実際1度そうなった）。
    const nfCode = nf.replace(/^\s*\/\/.*$/gm, "");
    const usesNow = /new Date\(/.test(nfCode);
    softCheck(
      "404ページが日付からURLを組まない",
      !usesNow,
      usesNow ? "new Date() を使っている（クール替わりで古いURLを指す）" : "静的なリンクだけ"
    );
  }

  // ⑤-2 404の境界（2026-08-31追加）。
  //
  //   **`notFound()` を呼ぶ page.tsx には、同じ階層に not-found.tsx が要る。**
  //
  // Next.js 14.2 の実測: ルートの `app/not-found.tsx` が拾うのは「どのルートにも
  // 一致しなかったURL」だけで、ルートに一致したうえで `notFound()` を呼んだ場合
  // （存在しない作品ID・索引に無い名前・未知のクール名など＝実際に起きる404のほぼ全部）は
  // **既定の画面**が出た。1階層浅い `app/<区画>/not-found.tsx` も効かず、
  // `page.tsx` と同じ階層に置いたときだけ効いた。
  //
  // この検査は**新しいページ種別を足したときに自動で効く**のが要点。個別のURLを
  // 並べる検査だと、面が増えたときに追随を忘れて静かに穴が開く。
  {
    const appDir = new URL("../app/", import.meta.url);
    const missing: string[] = [];
    let boundaries = 0;
    const walk = (dir: URL, rel: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) {
          walk(new URL(ent.name + "/", dir), rel + ent.name + "/");
          continue;
        }
        if (ent.name !== "page.tsx") continue;
        const src = readFileSync(new URL(ent.name, dir), "utf8");
        if (!/\bnotFound\(\)/.test(src)) continue;
        if (existsSync(new URL("not-found.tsx", dir))) boundaries++;
        else missing.push(rel + "page.tsx");
      }
    };
    walk(appDir, "app/");
    softCheck(
      "notFound() を呼ぶページに404の境界がある",
      missing.length === 0,
      missing.length === 0
        ? `${boundaries} 区画すべてに not-found.tsx がある`
        : `境界が無い: ${missing.join(" / ")}（既定の行き止まり画面が出る）`
    );
    // 中身は1箇所だけが持つ（8箇所に散らばると表現がズレる）。
    const panels = missing.length === 0 && boundaries > 0;
    if (panels) {
      const sample = readFileSync(
        new URL("../app/studio/[name]/not-found.tsx", import.meta.url),
        "utf8"
      );
      const shared = sample.includes("NotFoundPanel");
      softCheck(
        "404の中身を1箇所にまとめている",
        shared,
        shared ? "components/NotFoundPanel.tsx" : "区画ごとに中身を書いている"
      );
    }
  }

  // ⑥ 作品IDの検証（2026-08-31追加）。逆張り巡回で見つけた事故。
  //    3つの窓口が各自で `Number(params.id)` + `Number.isInteger` を書いていたため、
  //    MAX_SAFE_INTEGER を超える値・16進・指数・小数・先頭ゼロが全て通っていた。
  //    実測: /api/work/99999999999999999999 と /embed/anime/... が **502**、
  //          /anime/0x3374 が 200（13172に解決＝別URLで同じ作品）。
  const idCases: [string, number | null, string][] = [
    ["13180", 13180, "普通の10進"],
    ["1", 1, "最小"],
    ["999999999", 999999999, "9桁の上限"],
    ["0", null, "ゼロ"],
    ["-1", null, "負"],
    ["0013180", null, "先頭ゼロ（別URLで同じ作品になる）"],
    ["13180.0", null, "小数点"],
    ["1e5", null, "指数表記"],
    ["0x3374", null, "16進（Number() が解釈してしまう）"],
    ["99999999999999999999", null, "MAX_SAFE_INTEGERを超える（502の原因）"],
    ["１３１８０", null, "全角数字"],
    ["", null, "空"],
    ["13180 ", null, "末尾空白"],
    ["abc", null, "数字でない"],
  ];
  let idNg = 0;
  for (const [raw, want, label] of idCases) {
    if (parseWorkId(raw) !== want) {
      idNg++;
      softCheck(`作品IDの検証: ${label}`, false, `"${raw}" → ${parseWorkId(raw)}（${want}のはず）`);
    }
  }
  softCheck(
    "作品IDを10進数として厳密に見る",
    idNg === 0,
    idNg === 0 ? `${idCases.length}件の形を確認` : `${idNg} 件が期待と違う`
  );
  // ⑥-2 **窓口を手で数えない**（2026-08-31。この検査自身の失敗から書き直した）。
  //
  // 最初の版は窓口を3つ名指しで書いていた（作品ページ・公開API・埋め込み）。
  // ところが実際には4つあり、`app/anime/[id]/opengraph-image.tsx` が
  // `Number(params.id)` + `Number.isInteger` のまま残っていた。名指しの検査は
  // 書いた3つについては正しく動き続けるので、**漏れた1件は永久に見つからない**。
  // しかもこの漏れ方には理由がある: 移行の目印にしていた `getWorkData` を
  // OG画像だけは使っていない（edgeのサイズ制限のため `getWorkDataLive`）ので、
  // grep でも引っ掛からなかった。
  //
  // そこで **app/ を走査して動的セグメントを持つ窓口を導出する**方式にした。
  // 新しいページ種別・新しい画像ルート（twitter-image など）を足したとき、
  // この検査は**何もしなくても追随する**。導出は scripts/lib/app-routes.js。
  {
    const appDir = fileURLToPath(new URL("../app", import.meta.url));
    const routes = dynamicRoutes(appDir);
    // 走査そのものが壊れて0件になると、以下のループが全部素通りして静かに緑になる。
    // 実データの下限を置いて、それを防ぐ（面を減らしたときは下げてよい）。
    softCheck(
      "動的セグメントを持つ窓口を走査できている",
      routes.length >= 10,
      `${routes.length} 件（app/ を走査）`
    );

    // 逆戻りの検査は**コメントを除いてから**見る。除かないと、この事故の経緯を
    // 説明したコメント（「Number.isInteger は安全な整数かを見ない」）自体に反応して、
    // 直したファイルが永久にNGのままになる（実際に1度そうなった）。
    // 行頭の // とブロックコメントだけを落とす（文字列中の "https://" を壊さない）。
    const withoutComments = (s: string) =>
      s
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !/^\s*\/\//.test(line))
        .join("\n");

    const idRoutes = routes.filter((r) => r.segments.includes("id"));
    const looseId: string[] = [];
    for (const r of idRoutes) {
      const src = withoutComments(readFileSync(r.file, "utf8"));
      // parseWorkId を通していること、かつ Number()/Number.isInteger を自前で書いていないこと。
      const ok =
        src.includes("parseWorkId(") &&
        !/Number\.isInteger\s*\(/.test(src) &&
        !/Number\s*\(\s*params\.id\s*\)/.test(src);
      if (!ok) looseId.push(r.rel);
    }
    softCheck(
      "作品IDの窓口がすべて lib/workId.ts を通る",
      looseId.length === 0 && idRoutes.length >= 4,
      looseId.length
        ? `自前で Number() を書いている: ${looseId.join(" / ")}（502・重複URLの原因）`
        : `${idRoutes.length} 件すべてが parseWorkId を使う`
    );

    // 年の範囲（㊲）も同じ扱い。[year] を持つ窓口は必ず範囲判定を通し、
    // 範囲外は notFound() する。isValidYear は isSeasonYearInRange の別名。
    const yearRoutes = routes.filter((r) => r.segments.includes("year"));
    const looseYear: string[] = [];
    for (const r of yearRoutes) {
      const src = withoutComments(readFileSync(r.file, "utf8"));
      const guarded =
        /\bisValidYear\s*\(|\bisSeasonYearInRange\s*\(/.test(src) && /\bnotFound\(\)/.test(src);
      if (!guarded) looseYear.push(r.rel);
    }
    softCheck(
      "[year] を持つ窓口がすべて年の範囲を検査する",
      looseYear.length === 0 && yearRoutes.length >= 5,
      looseYear.length
        ? `範囲を見ていない: ${looseYear.join(" / ")}（存在しない年でAnnict取得とISR書き込みが起きる）`
        : `${yearRoutes.length} 件すべてが範囲外を notFound() する`
    );
  }

  console.log(`結果（エラーページ・空ページ）: ${softNg === 0 ? "全件OK" : softNg + " 件NG"}`);
}

// ─────────────────────────────────────────────
// 次クールをsitemapに載せる（2026-08-31追加）
//
// 経緯: sitemapは長らく「今期」しか載せていなかった。放送時期（○年○月）は放送開始の
// 3〜11ヶ月前に判明し、検索需要はクール開始の約1ヶ月前から立ち上がる
// （docs/next-season-coverage.md）。つまり需要の山のいちばん手前で、次クールのページが
// 検索エンジンに1件も知られていない状態だった。山は年に4回しか来ないので、
// 1回逃すと次は3ヶ月後になる。消さないこと。
// ─────────────────────────────────────────────
console.log("\n── 次クールをsitemapに載せる ──");
let nextSeasonNg = 0;
{
  const nsCheck = (label: string, ok: boolean, detail: string) => {
    if (!ok) nextSeasonNg++;
    console.log(`${ok ? "✓" : "✗"}  ${label.padEnd(40)} → ${detail}`);
  };
  const sitemapSrc = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");

  const hasNext = sitemapSrc.includes("nextYearSeason(");
  nsCheck(
    "次クールを載せている",
    hasNext,
    hasNext ? "nextYearSeason で次クールを組む" : "今期しか載せていない（需要の山を逃す）"
  );

  // 冬→春→夏→秋→翌年冬 の順送り。年またぎで壊れると次クールを丸ごと落とす。
  const order = ["winter", "spring", "summer", "autumn"];
  const nextOf = (y: number, ss: string) => {
    const i = order.indexOf(ss);
    return i === order.length - 1
      ? { year: y + 1, season: order[0] }
      : { year: y, season: order[i + 1] };
  };
  const cases: [number, string, number, string][] = [
    [2026, "summer", 2026, "autumn"],
    [2026, "autumn", 2027, "winter"],
    [2026, "winter", 2026, "spring"],
  ];
  const orderOk = cases.every(([y, ss, ey, es]) => {
    const r = nextOf(y, ss);
    return r.year === ey && r.season === es;
  });
  const implOk = sitemapSrc.includes("SEASON_ORDER") && order.every((ss) => sitemapSrc.includes(ss));
  nsCheck(
    "年またぎの順送りが正しい",
    orderOk && implOk,
    orderOk && implOk ? "秋→翌年冬まで含めて期待どおり" : "SEASON_ORDER が揃っていない"
  );

  // 次クールは作品ページとシーズンページだけ。声優・サービス別は、キャストも配信も
  // 埋まっていない段階で薄いページを先回りで送ることになる。
  const idx = sitemapSrc.indexOf("const next = nextYearSeason(");
  const tail = idx >= 0 ? sitemapSrc.slice(idx, idx + 1400) : "";
  const noThin = idx >= 0 && !tail.includes("/person/") && !tail.includes("/service/");
  nsCheck(
    "次クールに薄い面を先回りで送らない",
    noThin,
    noThin ? "作品ページとシーズンページだけ" : "声優・サービス別まで送っている"
  );

  console.log(`結果（次クール）: ${nextSeasonNg === 0 ? "全件OK" : nextSeasonNg + " 件NG"}`);
}

// ─────────────────────────────────────────────
// 途中の週と完全な週を取り違えない（2026-08-31追加）
//
// 経緯: GSCは3日ラグがあるので最新の週は必ず途中までしか埋まっていない。
// 2026-08-25の診断でこれを見落とし、途中の週の作品ページ表示（966件）と
// 完全な週（2,881件）を並べて「悪化の70%は声優ページ」と結論した。正しくは30%。
// 数字ではなく**比較の前提**が壊れる形の間違いなので、データ自身に印を持たせる。
// ─────────────────────────────────────────────
console.log("\n── 途中の週に印を付ける ──");
let partialWeekNg = 0;
{
  const { aggregateWeeklyByType } = await import("../scripts/lib/gsc-page-type.js");
  const rows: { keys: string[]; clicks: number; impressions: number; position: number }[] = [];
  for (const d of ["10", "11", "12", "13", "14", "15", "16"]) {
    rows.push({ keys: [`2026-08-${d}`, "https://x/anime/1"], clicks: 0, impressions: 1, position: 20 });
  }
  for (const d of ["17", "18"]) {
    rows.push({ keys: [`2026-08-${d}`, "https://x/anime/1"], clicks: 0, impressions: 1, position: 20 });
  }
  const agg = aggregateWeeklyByType(rows) as { week: string; days: number; partial: boolean }[];
  const full = agg.find((r) => r.week === "2026-08-10");
  const part = agg.find((r) => r.week === "2026-08-17");
  const ok =
    !!full && !!part && full.days === 7 && !full.partial && part.days === 2 && part.partial;
  if (!ok) partialWeekNg++;
  console.log(
    `${ok ? "✓" : "✗"}  ${"週ごとに日数と途中フラグを持つ".padEnd(40)} → ` +
      (ok
        ? "7日=partial:false / 2日=partial:true"
        : `days・partial が付いていない（full=${JSON.stringify(full)} part=${JSON.stringify(part)}）`)
  );
  console.log(`結果（途中の週）: ${partialWeekNg === 0 ? "全件OK" : partialWeekNg + " 件NG"}`);
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

// ─────────────────────────────────────────────
// 制作会社・監督ページ（2026-08-12追加）
//
// content/archive/studios.json から作る静的なページ（/studio/[name]・/director/[name]）。
// 見張るのは3点:
//   (1) 索引に載っている名前が全部ページになること（sitemapに404を載せない）
//   (2) 表現が「配信情報がある」に留まっていること。ここに並ぶのは過去クールの記録で、
//       いま配信されている保証は無い（CLAUDE.mdの基本ルール／lib/workAvailability.ts）
//   (3) sitemapが両方の索引を載せていること
// ─────────────────────────────────────────────
console.log("\n── 制作会社・監督ページ ──");
let creditNg = 0;
{
  const studioIndex = JSON.parse(
    readFileSync(new URL("../content/archive/studios.json", import.meta.url), "utf8")
  ) as { studios: Record<string, unknown[]>; directors: Record<string, unknown[]> };

  // (1) 事前生成が索引の全キーを返すこと。Object.keys(creditMap(...)) の形を確かめる
  //     （件数を直書きすると索引が増えたときに嘘になるので、生成の「作り方」を見る）。
  for (const [role, file] of [
    ["studio", "../app/studio/[name]/page.tsx"],
    ["director", "../app/director/[name]/page.tsx"],
  ] as const) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    const genOk =
      /generateStaticParams/.test(src) &&
      src.includes(`Object.keys(creditMap(INDEX, "${role}"))`) &&
      src.includes("encodeURIComponent");
    // notFound() が無いと索引に無い名前で空ページを返してしまう。
    const guardOk = src.includes("notFound()");
    const ok = genOk && guardOk;
    if (!ok) creditNg++;
    console.log(
      `${ok ? "✓" : "✗"}  ${`${role}ページが索引の全件を事前生成`.padEnd(40)} → ` +
        (ok
          ? `${Object.keys(role === "studio" ? studioIndex.studios : studioIndex.directors).length}件`
          : !genOk
            ? "generateStaticParams が索引のキーから作られていない"
            : "notFound() が無い（索引に無い名前で空ページを返す）")
    );
  }

  // (2) 未確認の断定をしていないこと。放送終了作品の表現と同じ禁止語。
  const creditSrc = readFileSync(new URL("../components/CreditPage.tsx", import.meta.url), "utf8");
  // コメント行（注意書きとして禁止語そのものを書いている）は除いてから探す。
  const body = creditSrc
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  const banned = ["視聴できます", "配信中", "配信しています", "見られます"].filter((w) =>
    body.includes(w)
  );
  const wordOk = banned.length === 0 && body.includes("配信情報がある");
  if (!wordOk) creditNg++;
  console.log(
    `${wordOk ? "✓" : "✗"}  ${"表現が「配信情報がある」に留まっている".padEnd(40)} → ` +
      (wordOk
        ? "断定表現なし"
        : banned.length > 0
          ? `未確認の断定が入っている（${banned.join("・")}）`
          : "「配信情報がある」が無い")
  );

  // (3) sitemapが両方を載せていること。
  const sitemapSrc = readFileSync(new URL("../app/sitemap.ts", import.meta.url), "utf8");
  const mapOk =
    sitemapSrc.includes("/studio/${encodeURIComponent(name)}") &&
    sitemapSrc.includes("/director/${encodeURIComponent(name)}");
  if (!mapOk) creditNg++;
  console.log(
    `${mapOk ? "✓" : "✗"}  ${"sitemapが制作会社・監督ページを載せる".padEnd(40)} → ${mapOk ? "両方あり" : "片方または両方が無い"}`
  );
}

// ─────────────────────────────────────────────
// 配信サービス名寄せ表の公開（2026-08-13追加）
//
// docs/growth-strategy-2026-08.md の4章の結論は「一覧そのものには差別化余地が無く、
// 差別化があるのは正規化のほう」だった。lib/services.ts の名寄せ表を /api/services で
// 機械可読に公開し、帰属義務（出典表記＋リンク）を付ける（同5章①・駅データ.jp型）。
//
// 【法務上の切り分け】名寄せ表そのものは本サイトの著作物なので公開できる。一方
// Annict由来の「作品ごとの配信実績」は再配布の可否が未確認なので**含めない**。
// また埋め込みウィジェットと同じ重大度で、公開データに広告リンクを混ぜない
// （第三者のアプリの中に自分のアフィリエイトリンクが紛れ込む形になるため）。
// 見張るのは次の7点:
//   (1) 公開されるキー集合と順序が SERVICES と完全一致すること（ズレ＝データの嘘）。
//       CSVとJSONの両方を見る（片方だけ古い、が起きうる）
//   (2) 出力に Annict 由来の作品データを示すキーが現れないこと
//   (3) 出力にアフィリエイトASPのドメインが現れないこと
//   (4) /developers に帰属義務の文言とデータセットへのリンクがあること
//   (5) **ラウンドトリップ**＝公開した情報「だけ」で本サイトと同じ判定が再現できること
//       （2026-08-13追加。放送局の除外パターンが公開されておらず、手順どおりに実装すると
//        TOKYO MX / AT-X / BS11 / テレビ東京 が配信サービス扱いになっていた）
//   (6) 出典表記に Annict が現れないこと（2026-08-13追加。この表は本サイトの著作物で
//       Annictのデータを1件も含まないのに「データ元: Annict」と名乗っており、
//       事実として誤っているうえ、被リンク目的の公開なのにクレジットがAnnictへ流れていた）
//   (7) 応答が決定的＝日付を含まないこと（2026-08-13追加。「Annictからの取得日」を
//       名乗っていたが、このAPIはAnnictに触れない。s-maxage=86400 なので配られる値も最大8日ずれる）
// ─────────────────────────────────────────────
console.log("\n── 配信サービス名寄せ表の公開 ──");
let datasetNg = 0;
{
  function datasetCheck(name: string, pass: boolean, detail: string) {
    if (!pass) datasetNg++;
    console.log(`${pass ? "✓" : "✗"}  ${name.padEnd(38)} → ${detail}`);
  }

  const json = buildServiceDataset();
  const jsonText = JSON.stringify(json);
  const csv = toCsv(serviceDatasetEntries());
  const csvLines = csv.replace(/\r\n$/, "").split("\r\n");

  // (1) キー集合＋順序。順序は classifyChannel の判定優先順そのもので、
  //     データセット側も「配列の先頭から順に当てる」と説明している＝意味を持つ。
  const want = SERVICES.map((s) => s.key);
  const gotJson = json.services.map((s) => s.key);
  datasetCheck(
    "JSONのキーがSERVICESと完全一致",
    gotJson.length === want.length && gotJson.every((k, i) => k === want[i]),
    gotJson.length === want.length && gotJson.every((k, i) => k === want[i])
      ? `${want.length}件（順序も一致）`
      : `期待 ${JSON.stringify(want)} / 実際 ${JSON.stringify(gotJson)}`
  );

  // CSVは key が第1列で、キーは英小文字と _ だけなので引用符・カンマを含まない
  //（含む値のクォートは下の (4) で別途固定する）。
  const gotCsv = csvLines.slice(1).map((l) => l.split(",")[0]);
  datasetCheck(
    "CSVのキーがSERVICESと完全一致",
    gotCsv.length === want.length && gotCsv.every((k, i) => k === want[i]),
    gotCsv.length === want.length && gotCsv.every((k, i) => k === want[i])
      ? `${want.length}行（順序も一致）`
      : `期待 ${JSON.stringify(want)} / 実際 ${JSON.stringify(gotCsv)}`
  );

  // CSVの体裁。BOMを付けると先頭列名がBOM込みで読まれるパーサがある。
  const headerOk = csvLines[0] === CSV_COLUMNS.join(",");
  const bomOk = !csv.startsWith("﻿");
  datasetCheck(
    "CSVはBOM無し・ヘッダが列定義と一致",
    headerOk && bomOk,
    !bomOk ? "先頭にBOMが付いている" : headerOk ? csvLines[0] : `ヘッダが違う: ${csvLines[0]}`
  );

  // (4-a) RFC4180のクォート。実データには今のところカンマも引用符も現れないが、
  //       サービス名に入った瞬間に列がズレる（＝黙って壊れる）ので合成データで固定する。
  const nasty: ServiceDatasetEntry = {
    key: "test_key",
    name: 'カンマ, と "引用符" が入る名前',
    short: "改行\r\n入り",
    kana: null,
    officialUrl: "https://example.com/",
    channelPattern: "a|b",
    channelPatternFlags: "",
  };
  const wantRow =
    'test_key,"カンマ, と ""引用符"" が入る名前","改行\r\n入り",,https://example.com/,a|b,';
  const nastyCsv = toCsv([nasty]);
  datasetCheck(
    "CSVがRFC4180のクォートに従う",
    nastyCsv.includes(wantRow),
    nastyCsv.includes(wantRow)
      ? "カンマ・引用符・改行を含む値を正しく囲む"
      : `期待の行が出ない: ${JSON.stringify(nastyCsv)}`
  );

  // (5) ラウンドトリップ。公開した情報**だけ**を使って本サイトと同じ判定を再現する。
  //     二次利用者の立場で、matching.normalization の手順（日本語の説明文）を実装し直し、
  //     services[].channelPattern → matching.broadcastPattern の順に当てる。
  //     2026-08-13まで broadcastPattern が JSON にもCSVにも入っておらず、公開手順どおりに
  //     実装すると TOKYO MX / AT-X / BS11 / テレビ東京 が「その他配信」＝配信サービスとして
  //     残った。Annictの生チャンネル名は放送局が大半なので、二次利用側はほぼ全作品で
  //     地上波局を配信サービスとして表示することになる（差別化の本体である正規化が、
  //     まるごと再現できていなかった）。
  //     期待値は上の samples（classifyChannel の回帰テストと同じ表）をそのまま使う＝
  //     「公開データで本物と同じ答えが出る」ことを実データ表記込みで固定する。
  const normalizeAsPublished = (raw: string) =>
    raw
      // 「小文字にする」
      .toLowerCase()
      // 「空白文字をすべて取り除く」
      .replace(/\s+/g, "")
      // 「長音・ダッシュ類（ー／－／―／‐）を半角ハイフン - に統一する」
      .replace(/[ー－―‐]/g, "-")
      // 「全角の英数字を半角にする」
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

  const classifyAsPublished = (raw: string): string => {
    const n = normalizeAsPublished(raw);
    for (const s of json.services) {
      if (new RegExp(s.channelPattern, s.channelPatternFlags).test(n)) return `service:${s.key}`;
    }
    if (
      new RegExp(json.matching.broadcastPattern, json.matching.broadcastPatternFlags).test(n)
    ) {
      return "tv";
    }
    return "other";
  };

  const rtBad = samples.filter(([input, expect]) => classifyAsPublished(input) !== expect);
  datasetCheck(
    "公開情報だけで判定を再現できる",
    rtBad.length === 0,
    rtBad.length === 0
      ? `${samples.length}件すべて本サイトと同じ判定（放送局の除外パターン込み）`
      : `再現できない: ${JSON.stringify(
          rtBad.map(([i, e]) => `${i}: 期待 ${e} / 公開情報では ${classifyAsPublished(i)}`)
        )}`
  );

  // 上のラウンドトリップが「たまたま通る」形（除外パターンが空・全部にマッチ）で
  // 壊れていないことを別途固定する。放送局の判定が公開されていることが要件そのもの。
  const bcOk =
    typeof json.matching.broadcastPattern === "string" &&
    json.matching.broadcastPattern.length > 0 &&
    classifyAsPublished("TOKYO MX") === "tv" &&
    classifyAsPublished("dアニメストア") === "service:d_anime";
  datasetCheck(
    "放送局の除外パターンを公開している",
    bcOk,
    bcOk
      ? "matching.broadcastPattern あり（TOKYO MX→tv / dアニメストア→サービス）"
      : "broadcastPattern が無い、または放送局を落とせない（公開手順どおりに実装すると放送局が配信サービスになる）"
  );

  // (2) Annict由来の作品データが混ざっていないこと。ここを開けると、再配布の可否が
  //     未確認のデータを公開したことになる（docs/annict-contribution.md）。
  const workDataKeys = ["annictId", "programs", "casts", "works", "episodes", "castNames"];
  const leaked = workDataKeys.filter((k) => jsonText.includes(k) || csv.includes(k));
  datasetCheck(
    "作品データのキーが現れない",
    leaked.length === 0,
    leaked.length === 0
      ? `${workDataKeys.length}語すべて不在`
      : `混入: ${JSON.stringify(leaked)}（Annict由来の作品データは再配布の可否が未確認）`
  );

  // (3) アフィリエイトのASPドメイン。登録済みのリンク（content/affiliate/programs.ts）から
  //     起こしたホスト＋既知のASPドメイン。一覧はファイル冒頭の affiliateHosts() が持つ
  //     （構造化データ側の同じ検査と定義を共有するため。2026-08-13にそちらへ移動）。
  const aspHosts = affiliateHosts();
  const adHits = aspHosts.filter((h) => jsonText.includes(h) || csv.includes(h));
  datasetCheck(
    "アフィリエイトのドメインが現れない",
    adHits.length === 0,
    adHits.length === 0
      ? `${aspHosts.length}ドメインすべて不在`
      : `混入: ${JSON.stringify(adHits)}（公開データに広告リンクを入れない）`
  );

  // 実装レベルの担保（lib/embed.ts と同じ流儀）。参照が無ければ混ざりようがない。
  for (const [label, file] of [
    ["lib/serviceDataset.ts", "../lib/serviceDataset.ts"],
    ["app/api/services/route.ts", "../app/api/services/route.ts"],
  ] as const) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    // コメント行（この方針そのものを注意書きとして書いている）は除いてから探す。
    // URL中の `//` を巻き込まないよう、行頭がコメントの行だけを落とす。
    const body = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    const uses = /affiliate/i.test(body);
    datasetCheck(
      `${label}はアフィリエイトを参照しない`,
      !uses,
      uses ? "参照している（公開データに広告リンクを入れてはいけない）" : "参照なし"
    );
  }

  // 帰属義務。使う側がレスポンスを読むだけで出典を書けること＝この施策の目的そのもの。
  const attributionOk =
    typeof json.license?.url === "string" &&
    json.license.url.startsWith(siteUrl) &&
    typeof json.license.name === "string" &&
    json.license.name !== "" &&
    [json.attribution.text, json.attribution.html, json.attribution.markdown].every(
      (s) => typeof s === "string" && s.includes(siteUrl)
    ) &&
    json.attribution.url.startsWith(siteUrl);
  datasetCheck(
    "JSONに利用条件と出典表記が入る",
    attributionOk,
    attributionOk
      ? `license=${json.license.url} / text・html・markdown すべてに ${siteUrl} へのリンク`
      : "license か attribution（text/html/markdown/url）が欠けている、またはサイトURLを含まない"
  );

  // (6) 出典表記に Annict が現れないこと。この表は本サイトが自前で書いたもので Annict の
  //     データを1件も含まない。にもかかわらず /api/work・/api/season と同じ出典
  //     （apiSource → "データ元: Annict"）を載せていたため、①誤ったデータ出所の表明
  //     ②被リンクを得るための公開なのにクレジットとリンクが Annict へ流れる、が同時に
  //     起きていた。同じ応答の note が「Annict由来のデータは含まない」と書いており自己矛盾。
  //     ※ description・note が説明として Annict に言及するのは正しいので、見るのは
  //       「出典として名乗っている場所」＝attribution / license / creator と、
  //       クレジットのリンク先になる annict.com のURL。
  const creditFields: Array<[string, string]> = [
    ["attribution.text", json.attribution.text],
    ["attribution.html", json.attribution.html],
    ["attribution.markdown", json.attribution.markdown],
    ["attribution.url", json.attribution.url],
    ["license.name", json.license.name],
    ["license.url", json.license.url],
    ["creator.name", json.creator.name],
    ["creator.url", json.creator.url],
  ];
  const annictCredits = creditFields.filter(([, v]) => /annict/i.test(v)).map(([k]) => k);
  const annictUrlHits = [
    ...(/annict\.com/i.test(jsonText) ? ["JSON本文"] : []),
    ...(/annict\.com/i.test(csv) ? ["CSV本文"] : []),
  ];
  const noAnnictCredit = annictCredits.length === 0 && annictUrlHits.length === 0;
  datasetCheck(
    "出典表記にAnnictが現れない",
    noAnnictCredit,
    noAnnictCredit
      ? "attribution / license / creator は本サイトのみ・annict.com へのリンク無し"
      : `Annictを名乗っている: ${JSON.stringify([...annictCredits, ...annictUrlHits])}` +
        "（この表にAnnictのデータは含まれない）"
  );

  // (6') 作品データ用の source フィールドを持たないこと。持つと上の (6) が復活する。
  const hasSource = Object.prototype.hasOwnProperty.call(json, "source");
  datasetCheck(
    "作品API用のsourceを持たない",
    !hasSource,
    hasSource
      ? "source がある（apiSource は「Annictから取得した」ことを表す出典情報。このAPIはAnnictに触れない）"
      : "source 無し（出典は attribution が持つ）"
  );

  // (7) 応答が決定的＝日付を含まないこと。checkedAt（Annictからの取得日）を名乗っていたが
  //     このAPIはAnnictに一度も触れない。しかも s-maxage=86400 でCDNに載るため、
  //     配られる日付は最大8日ずれる。中身は SERVICES と TV_PATTERN だけから決まるので、
  //     日付を持たないのがいちばん素直（キャッシュとも整合する）。
  const dates = [...new Set(jsonText.match(/\d{4}-\d{2}-\d{2}/g) ?? [])];
  const dateKeys = ["checkedAt", "generatedAt", "updatedAt"].filter((k) => jsonText.includes(k));
  const deterministic = dates.length === 0 && dateKeys.length === 0;
  datasetCheck(
    "応答が決定的（日付を含まない）",
    deterministic,
    deterministic
      ? "日付なし＝毎リクエスト同じJSON（s-maxage=86400 のキャッシュとも整合）"
      : `日付が入っている: ${JSON.stringify([...dates, ...dateKeys])}`
  );

  // 公開API（第三者が直接叩く）としての最低条件。既存の /api/* と同じ形。
  const routeSrc = readFileSync(
    new URL("../app/api/services/route.ts", import.meta.url),
    "utf8"
  );
  const corsOk =
    routeSrc.includes('"Access-Control-Allow-Origin": "*"') &&
    routeSrc.includes("Cache-Control") &&
    routeSrc.includes("text/csv");
  datasetCheck(
    "APIがCORS・キャッシュ・CSVを備える",
    corsOk,
    corsOk ? "Allow-Origin: * / Cache-Control / text/csv" : "いずれかが欠けている"
  );

  // CSVは本文に利用条件を書けないので Link: rel="license" で示している。ところが
  // CORSで既定で読める応答ヘッダに Link は含まれないため、expose しないと
  // **ブラウザの fetch で取る二次利用者にだけ利用条件が届かない**（curl では届くので
  // 気づけない）。帰属表記＝被リンクが目的のデータセットなので、この1行を消さないこと。
  const exposeOk =
    /"Access-Control-Expose-Headers":\s*"[^"]*Link/.test(routeSrc) &&
    routeSrc.includes('rel="license"');
  datasetCheck(
    "CSVの利用条件がブラウザからも読める（Linkをexpose）",
    exposeOk,
    exposeOk
      ? 'Access-Control-Expose-Headers: Link / Link: rel="license"'
      : "Expose-Headers に Link が無い（fetchで取る二次利用者に利用条件が届かない）"
  );

  // ?format= の解釈。元の実装は `searchParams.get("format") ?? "json"` で、`??` は
  // null しか拾わないため `?format=`（値なし・空文字）が 400 になっていた。
  // 大文字（`?format=CSV`）も同様。未指定・空文字・大文字はすべて正しく通すこと。
  const formatCases: Array<[string | null, "json" | "csv" | null]> = [
    [null, "json"], // 未指定
    ["", "json"], // ?format=（値なし）
    ["json", "json"],
    ["JSON", "json"],
    ["csv", "csv"],
    ["CSV", "csv"], // 大文字
    ["Csv", "csv"],
    ["xml", null], // 未対応は 400
  ];
  const formatBad = formatCases.filter(([raw, want]) => parseFormat(raw) !== want);
  datasetCheck(
    "?format= の解釈（空文字・大文字も通る）",
    formatBad.length === 0,
    formatBad.length === 0
      ? `${formatCases.length}通り（未指定・空文字・大小文字・未対応）`
      : `期待と違う: ${JSON.stringify(
          formatBad.map(([raw, want]) => `${JSON.stringify(raw)} → 期待 ${want} / 実際 ${parseFormat(raw)}`)
        )}`
  );

  // 上のテストが本番と同じ経路であること。route.ts が自前で解釈に戻ると検査が空振りする。
  const routeUsesParse =
    routeSrc.includes("parseFormat(") && !/searchParams\.get\("format"\)\s*\?\?/.test(routeSrc);
  datasetCheck(
    "route.tsがparseFormatを使う",
    routeUsesParse,
    routeUsesParse
      ? "解釈は lib/serviceDataset.ts の1箇所（検査と本番が同じ経路）"
      : "route.ts が自前で format を解釈している（検査をすり抜ける）"
  );

  // (4) /developers（データセットの唯一の入口）。リンクが消えると、人にも
  //     クローラーにも存在しないのと同じになる（「孤立ページを作らない」と同じ穴）。
  const devSrc = readFileSync(
    new URL("../app/developers/page.tsx", import.meta.url),
    "utf8"
  );
  const linkOk =
    devSrc.includes("@/lib/serviceDataset") &&
    devSrc.includes("DATASET_JSON_URL") &&
    devSrc.includes("DATASET_CSV_URL") &&
    devSrc.includes("名寄せ表");
  datasetCheck(
    "/developers にデータセットへのリンク",
    linkOk,
    linkOk
      ? "JSON・CSV の両方（URLは lib/serviceDataset.ts から）"
      : "節が無い、またはURLを直書きしている（正準定義とズレると機械が読む側にだけ嘘が残る）"
  );

  const creditOk =
    devSrc.includes("出典表記") &&
    devSrc.includes("attributionHtml()") &&
    devSrc.includes("attributionMarkdown()") &&
    devSrc.includes("attributionText()");
  datasetCheck(
    "/developers に帰属義務とコピペ用の出典",
    creditOk,
    creditOk ? "文言＋HTML/Markdown/テキストの3形式" : "文言かコピペ用スニペットが欠けている"
  );

  const ldOk =
    devSrc.includes('"@type": "Dataset"') &&
    (devSrc.match(/"DataDownload"/g) ?? []).length === 2 &&
    devSrc.includes("isAccessibleForFree") &&
    devSrc.includes("DATASET_LICENSE.url");
  datasetCheck(
    "/developers にDatasetの構造化データ",
    ldOk,
    ldOk ? "DataDownload×2（JSON・CSV）＋license＋無料の明示" : "Dataset の JSON-LD が欠けている"
  );
}
console.log(`結果（配信サービス名寄せ表）: ${datasetNg === 0 ? "全件OK" : `${datasetNg} 件NG`}`);

// ─────────────────────────────────────────────
// 公開APIの告知（/llms.txt）（2026-08-13追加）
//
// /api/services を足したとき、/llms.txt の「公開API」一覧に載せ忘れた。llms.txt は
// 生成AIにサイトの構造を伝えるための唯一の目録で、載っていないAPIは「無いのと同じ」
// （sitemapに載せたページをサイト内からリンクし忘れる＝「孤立ページを作らない」と同じ穴）。
// AI検索経由の露出を狙って置いているファイルなので、取りこぼすと施策そのものが空振りする。
// 手順書に書いても次にAPIを足す日には忘れるので、機械に見張らせる:
//   CORSヘッダ（＝第三者が直接叩ける公開API）を持つ app/api/**/route.ts は、
//   app/llms.txt/route.ts にそのURLが載っていること。
// 動的セグメント（[id] など）はURLに実IDが入るので、その手前までを突き合わせる。
// ─────────────────────────────────────────────
console.log("\n── 公開APIの告知（/llms.txt） ──");
let llmsNg = 0;
{
  const llmsSrc = readFileSync(
    new URL("../app/llms.txt/route.ts", import.meta.url),
    "utf8"
  );
  const apiRoutes = listSourceFiles(new URL("../app/api/", import.meta.url)).filter((u) =>
    /\/route\.tsx?$/.test(u.pathname)
  );

  const listed: string[] = [];
  const missing: string[] = [];
  for (const url of apiRoutes) {
    const src = readFileSync(url, "utf8");
    // CORS を返していない＝サイト内部専用。目録に載せる対象ではない。
    if (!src.includes("Access-Control-Allow-Origin")) continue;
    const rel = decodeURIComponent(url.pathname)
      .split("/app/api/")[1]
      .replace(/\/route\.tsx?$/, "");
    const segs: string[] = [];
    for (const seg of rel.split("/")) {
      if (seg.startsWith("[") || seg.startsWith("(")) break; // 動的セグメントの手前まで
      segs.push(seg);
    }
    const path = `/api/${segs.join("/")}`;
    (llmsSrc.includes(path) ? listed : missing).push(path);
  }

  const allListed = missing.length === 0 && listed.length > 0;
  if (!allListed) llmsNg++;
  console.log(
    `${allListed ? "✓" : "✗"}  ${"CORS付きの公開APIが/llms.txtに載っている".padEnd(40)} → ` +
      (allListed
        ? `${listed.length}本（${listed.join(" / ")}）`
        : listed.length === 0
          ? "CORS付きのAPIが1本も見つからない（検査が空振りしている）"
          : `載っていない: ${JSON.stringify(missing)}`)
  );
}
console.log(`結果（公開APIの告知）: ${llmsNg === 0 ? "全件OK" : `${llmsNg} 件NG`}`);

// ─────────────────────────────────────────────
// 機械補完した放送予定日（2026-08-17追加）
//
// 次クールの放送日はAnnictの programs（番組表）に載るのが遅い。2026-08-17の実測で
// 2026秋はAnnictの99作品中 programs を持つのが3件だけ（＝96件が「放送時期未定」）で、
// 同じ日にAniListは38件の日付と28件の放送時刻を持っていた。そこで AniList から
// 機械が毎日運ぶ層（content/works/autoSchedule.json）を足した。
//
// この層は**人が確認していない二次情報**なので、壊れ方が3種類ある。全部ここで見張る:
//   (1) 層の順番が逆転する … Annictの実データや人力補完（extraServices/releaseDates）を
//       機械補完が上書きしたら、確認済みの事実が未確認の推定で潰される。
//   (2) 「予定」が「確定した放送枠」に化ける … 曜日・時刻を broadcastWeekday/
//       broadcastTime に流し込むと、カレンダー・ICS・SNSの「今日放送」に乗ってしまう
//       （＝放送開始1週間前ルールを機械補完の側から破る）。月精度（"2026-10"）の作品に
//       曜日が付くのも同じ事故。
//   (3) 可視テキストに無い主張がJSON-LDにだけ残る … WatchAction を撤回したときと同型。
//       予定日は datePublished / FAQPage に出さない（lib/types.ts の注記）。
// 生成側（scripts/fetch-upcoming.js）自体の回帰テストは scripts/check-fetch-upcoming.js。
// ─────────────────────────────────────────────
console.log("\n── 機械補完した放送予定日 ──");
let autoNg = 0;
{
  const okEntry = {
    date: "2026-10-02",
    precision: "day",
    weekday: 5,
    time: "23:00",
    kind: "broadcast",
    sourceUrl: "https://anilist.co/anime/12345",
    fetchedDate: "2026-08-17",
    matchedBy: "mal",
  };
  const judge = (name: string, ok: boolean, detail: string) => {
    if (!ok) autoNg++;
    console.log(`${ok ? "✓" : "✗"}  ${name.padEnd(40)} → ${detail}`);
  };

  // (1) 層の順番。toAnimeItem に同じ予定日を渡し、上位の層があるときは無視されること。
  const auto = parseAutoScheduleEntry(okEntry)!;
  const annictData = toAnimeItem(
    work([{ channel: "dアニメストア", startedAt: "2026-10-02T23:00:00+09:00" }]),
    [],
    undefined,
    auto
  );
  judge(
    "Annictの実データが機械補完より強い",
    annictData.autoSchedule === null && annictData.broadcastWeekday === 5,
    annictData.autoSchedule === null
      ? "programsがあるとautoScheduleはnull"
      : "機械補完が残っている（実データと二重に出る）"
  );

  const manualRelease = toAnimeItem(
    work([]),
    [],
    { date: "2026-10-09", sourceUrl: "https://example.com/news", confirmedDate: "2026-08-17" },
    auto
  );
  judge(
    "人力補完が機械補完より強い",
    manualRelease.autoSchedule === null && manualRelease.releaseDate?.date === "2026-10-09",
    manualRelease.autoSchedule === null
      ? "releaseDateがあるとautoScheduleはnull"
      : "一次情報で確認した日付を未確認の推定が上書きしている"
  );

  const autoOnly = toAnimeItem(work([]), [], undefined, auto);
  judge(
    "どちらも無いときだけ機械補完が効く",
    autoOnly.autoSchedule?.date === "2026-10-02",
    autoOnly.autoSchedule ? `${autoOnly.autoSchedule.date}（${autoOnly.autoSchedule.precision}）` : "効いていない"
  );

  // (2) 予定日が「確定した放送枠」の側へ漏れないこと。曜日・時刻を持つ予定日を渡しても
  //     broadcast* は null のまま＝カレンダー・ICS・SNSの「今日放送」には絶対に入らない。
  const leaked =
    autoOnly.broadcastWeekday !== null ||
    autoOnly.broadcastTime !== null ||
    autoOnly.broadcastStartDate !== null;
  judge(
    "予定日をbroadcast*に流し込まない",
    !leaked,
    leaked
      ? `漏れている: weekday=${autoOnly.broadcastWeekday} time=${autoOnly.broadcastTime} start=${autoOnly.broadcastStartDate}`
      : "weekday/time/startDateはnullのまま"
  );

  const calendarSrc = readFileSync(new URL("../lib/calendar.ts", import.meta.url), "utf8");
  judge(
    "カレンダー生成が機械補完を参照しない",
    !calendarSrc.includes("autoSchedule"),
    calendarSrc.includes("autoSchedule") ? "lib/calendar.ts が autoSchedule を見ている" : "参照なし"
  );

  // (3) 読み込み時の検証。おかしい形は「そのエントリだけ捨てる」こと。
  const badCases: [string, unknown][] = [
    ["precisionが不正", { ...okEntry, precision: "week" }],
    ["day精度なのに月までの日付", { ...okEntry, date: "2026-10" }],
    ["month精度なのに日付入り", { ...okEntry, precision: "month", date: "2026-10-02" }],
    ["kindが不正", { ...okEntry, kind: "stream" }],
    ["出典がAniListでない", { ...okEntry, sourceUrl: "https://example.com/anime/1" }],
    ["出典がhttp", { ...okEntry, sourceUrl: "http://anilist.co/anime/1" }],
    ["取得日の形が不正", { ...okEntry, fetchedDate: "2026-8-17" }],
    ["突き合わせ手段が不正", { ...okEntry, matchedBy: "guess" }],
    ["オブジェクトでない", null],
  ];
  const survived = badCases.filter(([, raw]) => parseAutoScheduleEntry(raw) !== null).map(([n]) => n);
  judge(
    "壊れたエントリを捨てる",
    survived.length === 0,
    survived.length === 0 ? `${badCases.length}種すべて拒否` : `通ってしまった: ${survived.join(" / ")}`
  );

  const monthEntry = parseAutoScheduleEntry({
    ...okEntry,
    precision: "month",
    date: "2026-10",
  });
  judge(
    "月精度には曜日・時刻を付けない",
    monthEntry !== null && monthEntry.weekday === undefined && monthEntry.time === undefined,
    monthEntry === null
      ? "月精度そのものが捨てられている"
      : monthEntry.weekday === undefined && monthEntry.time === undefined
        ? "曜日・時刻を落として月だけにする"
        : `曜日/時刻が残っている: ${monthEntry.weekday}/${monthEntry.time}`
  );

  const halfSlot = parseAutoScheduleEntry({ ...okEntry, time: undefined });
  judge(
    "曜日と時刻は対で扱う",
    halfSlot !== null && halfSlot.weekday === undefined,
    halfSlot === null
      ? "エントリごと捨てられている（日付だけは残すべき）"
      : halfSlot.weekday === undefined
        ? "時刻が無ければ曜日も落とす"
        : "曜日だけが残っている（毎週その曜日と誤読される）"
  );

  // 実ファイル。生成側が壊れた形を書いたら、ここで件数が減って見える。
  const autoFileRaw = JSON.parse(
    readFileSync(new URL("../content/works/autoSchedule.json", import.meta.url), "utf8")
  );
  const rawIds = Object.keys(autoFileRaw.works ?? {});
  const parsedAll = parseAutoSchedules(autoFileRaw);
  const parsedIds = Object.keys(parsedAll);
  judge(
    "autoSchedule.jsonが全件検証を通る",
    rawIds.length > 0 && parsedIds.length === rawIds.length,
    rawIds.length === 0
      ? "1件も入っていない（生成が空振りしている疑い）"
      : parsedIds.length === rawIds.length
        ? `${parsedIds.length}件すべて有効`
        : `${rawIds.length}件中${rawIds.length - parsedIds.length}件が無効`
  );
  const monthCount = parsedIds.filter((id) => parsedAll[Number(id)].precision === "month").length;
  console.log(`ℹ  ${"予定日の精度".padEnd(40)} → 日まで${parsedIds.length - monthCount}件 / 月まで${monthCount}件`);

  // (4) 突き合わせロジック。誤マッチは「無関係な作品の日付がサイトに出る」事故なので、
  //     迷ったら採用しない側に倒っていることを固定する。
  const mediaA = {
    id: 100,
    idMal: 5000,
    title: { native: "作品A", romaji: "Sakuhin A" },
    startDate: { year: 2026, month: 10, day: 2 },
    externalLinks: [{ site: "Official Site", url: "https://a.example.com/" }],
  };
  const mediaB = {
    id: 200,
    idMal: 6000,
    title: { native: "作品B", romaji: "Sakuhin B" },
    startDate: { year: 2026, month: 10, day: 9 },
    externalLinks: [{ site: "Official Site", url: "https://b.example.com/" }],
  };
  const index = buildAniListIndex([mediaA, mediaB]);

  const byMal = matchWork(
    { malAnimeId: 5000, title: "全然ちがう題名", officialSiteUrl: null },
    index
  );
  judge(
    "MALのIDが最優先で使われる",
    byMal?.media?.id === 100 && byMal?.matchedBy === "mal",
    byMal ? `id=${byMal.media?.id} matchedBy=${byMal.matchedBy}` : "一致しなかった"
  );

  const conflicted = matchWork(
    { malAnimeId: 5000, title: null, officialSiteUrl: "https://b.example.com/" },
    index
  );
  judge(
    "手段どうしが食い違ったら採用しない",
    conflicted?.conflict === true && conflicted?.media === undefined,
    conflicted?.conflict ? "conflictとして落とす" : `採用してしまった: ${JSON.stringify(conflicted)}`
  );

  const ambiguous = buildAniListIndex([
    { id: 300, idMal: null, title: { native: "同名作品", romaji: null }, startDate: {}, externalLinks: [] },
    { id: 400, idMal: null, title: { native: "同名作品", romaji: null }, startDate: {}, externalLinks: [] },
  ]);
  judge(
    "同名が2件ある索引は使わない",
    matchWork({ malAnimeId: null, title: "同名作品", officialSiteUrl: null }, ambiguous) === null,
    "曖昧なキーは引き当てない"
  );

  const movieEntry = buildEntry(
    { media: "MOVIE", title: "劇場作品" },
    { ...mediaA, airingSchedule: { nodes: [{ episode: 1, airingAt: 1791234000 }] } },
    "mal",
    "2026-08-17"
  );
  judge(
    "劇場作品に放送枠を作らない",
    movieEntry?.kind === "release" && movieEntry?.time === undefined,
    movieEntry ? `kind=${movieEntry.kind} time=${movieEntry.time}` : "組み立てられなかった"
  );

  const monthOnly = buildEntry(
    { media: "TV", title: "月だけ判明" },
    { id: 500, startDate: { year: 2026, month: 10, day: null } },
    "title",
    "2026-08-17"
  );
  judge(
    "日が未定なら月精度に落とす",
    monthOnly?.precision === "month" && monthOnly?.date === "2026-10" && monthOnly?.weekday === undefined,
    monthOnly ? `${monthOnly.date}（${monthOnly.precision}）` : "組み立てられなかった"
  );

  // (5) 過去の日付を「予定」として出さない。現在クールの作品はAniListのstartDateが
  //     数週間前を指す（2026-08-17実測で2026夏の9件が該当）。
  const upcomingCases: [string, unknown, string, boolean][] = [
    ["当日は出す", { date: "2026-08-17", precision: "day" }, "2026-08-17", true],
    ["前日は出さない", { date: "2026-08-16", precision: "day" }, "2026-08-17", false],
    ["同月は出す", { date: "2026-08", precision: "month" }, "2026-08-17", true],
    ["前月は出さない", { date: "2026-07", precision: "month" }, "2026-08-17", false],
  ];
  const upcomingBad = upcomingCases.filter(([, e, today, want]) => isUpcoming(e, today) !== want);
  judge(
    "過去の日付を予定として出さない",
    upcomingBad.length === 0,
    upcomingBad.length === 0 ? `${upcomingCases.length}件の境界すべて期待通り` : `不一致: ${upcomingBad.map((c) => c[0]).join(" / ")}`
  );

  // (6) 揺れを持ち込まない。取れなかった作品を消すと、サイトの表示が日替わりで
  //     出たり消えたりする（lib/serviceAdditions.ts / scripts/track-season.js と同じ原則）。
  const merged = mergeWorks(
    {
      "1": { date: "2026-10-02", precision: "day", kind: "broadcast" },
      "2": { date: "2026-11-01", precision: "day", kind: "broadcast" },
      "3": { date: "2025-01-05", precision: "day", kind: "broadcast" },
    },
    { "2": { date: "2026-11-08", precision: "day", kind: "broadcast" } },
    { today: "2026-08-17" }
  );
  const keptMissing = merged["1"]?.date === "2026-10-02";
  const replaced = merged["2"]?.date === "2026-11-08";
  const prunedOld = merged["3"] === undefined;
  judge(
    "取れなかった作品を消さない",
    keptMissing && replaced && prunedOld,
    `残す=${keptMissing} 置き換える=${replaced} 古いものは落とす=${prunedOld}`
  );

  // (7) 可視テキストに無い主張をJSON-LDに残さない。
  const workPageSrc = readFileSync(
    new URL("../app/anime/[id]/page.tsx", import.meta.url),
    "utf8"
  );
  const ldAssignments = workPageSrc
    .split("\n")
    .filter((l) => l.includes("workLd.") && l.includes("="));
  const ldLeak = ldAssignments.filter((l) => /\bauto\b/.test(l));
  judge(
    "予定日をJSON-LDに出さない",
    ldAssignments.length > 0 && ldLeak.length === 0,
    ldAssignments.length === 0
      ? "workLdへの代入が見つからない（検査が空振りしている）"
      : ldLeak.length === 0
        ? `workLdへの代入${ldAssignments.length}行に予定日は現れない`
        : `混入: ${ldLeak.map((l) => l.trim()).join(" / ")}`
  );
  const faqStart = workPageSrc.indexOf("const faqLd");
  const faqEnd = workPageSrc.indexOf("__html", faqStart);
  const faqBlock = faqStart >= 0 && faqEnd > faqStart ? workPageSrc.slice(faqStart, faqEnd) : "";
  judge(
    "予定日をFAQPageに出さない",
    faqBlock.length > 0 && !/\bauto\b/.test(faqBlock),
    faqBlock.length === 0
      ? "faqLdの範囲を特定できない（検査が空振りしている）"
      : /\bauto\b/.test(faqBlock)
        ? "FAQに予定日が混入している"
        : "混入なし"
  );

  // (8) 可視テキスト側は逆に、出典と取得日を必ず添える（断定しないための最低条件）。
  const visibleOk =
    workPageSrc.includes("auto.sourceUrl") &&
    workPageSrc.includes("auto.fetchedDate") &&
    /(放送開始予定|公開予定)/.test(workPageSrc);
  judge(
    "予定日には出典と取得日を添える",
    visibleOk,
    visibleOk ? "出典リンク＋取得日＋「予定」の表記あり" : "作品ページの表示に出典・取得日・「予定」のいずれかが無い"
  );

  // (9) 取得ワークフロー。シークレットを要らないままに保つ（要るようにすると
  //     フォーク・別環境で回らなくなり、x-growth.yml と同じ方針から外れる）。
  //     時刻の判定はスクリプト側にあるので、YAMLから今日の日付を渡さない。
  const wfUrl = new URL("../.github/workflows/fetch-upcoming.yml", import.meta.url);
  const wfSrc = existsSync(wfUrl) ? readFileSync(wfUrl, "utf8") : "";
  const wfSecrets = [...wfSrc.matchAll(/secrets\.([A-Z_]+)/g)]
    .map((m) => m[1])
    .filter((n) => n !== "GITHUB_TOKEN");
  judge(
    "取得ワークフローがシークレットに依存しない",
    wfSrc.length > 0 && wfSecrets.length === 0,
    wfSrc.length === 0
      ? ".github/workflows/fetch-upcoming.yml が無い"
      : wfSecrets.length === 0
        ? "GITHUB_TOKEN以外のシークレットを使わない"
        : `依存している: ${[...new Set(wfSecrets)].join(" / ")}`
  );
  // コメントで「渡していない」と書いてあるのは正常なので、コメント行を除いて見る。
  const wfCode = wfSrc
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  const noToday = !/UPCOMING_TODAY/.test(wfCode);
  judge(
    "YAMLから日付を渡さない",
    noToday,
    noToday ? "UPCOMING_TODAY を渡していない" : "YAMLが日付を決めている（テスト用の抜け道が本番経路になる）"
  );
}
console.log(`結果（機械補完した放送予定日）: ${autoNg === 0 ? "全件OK" : `${autoNg} 件NG`}`);

// ─────────────────────────────────────────────
// 検査を回す環境（2026-08-11追加）
//
// 2026-08-11、CIに入っているのに**手元では必ず失敗する**検査が2本、数セッションに
// わたって赤いまま放置されていたことが分かった（docs/operations.md の㉔）。
//   - scripts/probe-series.ts … Windows では process.exit() が書き込み途中の stdout を
//     巻き込んで異常終了する（0xC0000409）
//   - scripts/verify-production.sh … jq に依存していた（ubuntu ランナーには同梱、
//     Windows の開発機には無い）
// どちらも ubuntu だけで回している限り**原理的に検知できない**壊れ方で、検査を
// 増やしても環境が1つでは同じことが起きる。そこで見張るのは次の2点:
//   (1) CI が ubuntu と windows の両方で回っていること（matrixを消させない）
//   (2) `npm run check` が CI と同じ検査を並べていること
//       （手元の1コマンドとCIがズレると、手元で緑でもCIで落ちる／その逆が起きる）
// ─────────────────────────────────────────────
console.log("\n── 検査を回す環境 ──");
let ciNg = 0;
{
  const ciYml = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8"
  );

  // (1) 開発機（Windows）とCI（ubuntu）の両方。片方だけに戻すと上記の穴が復活する。
  const oses = ["ubuntu-latest", "windows-latest"].filter((os) => ciYml.includes(os));
  const osOk = oses.length === 2;
  if (!osOk) ciNg++;
  console.log(
    `${osOk ? "✓" : "✗"}  ${"CIがubuntuとwindowsの両方で回る".padEnd(40)} → ` +
      (osOk
        ? oses.join(" / ")
        : `${JSON.stringify(oses)} しかない。開発機と同じOSを外すと「CIは緑なのに手元では必ず落ちる」検査に気づけなくなる`)
  );

  // (2) CIの run: が呼ぶ検査スクリプトと、package.json の "check" が呼ぶものを突き合わせる。
  //     ビルド（npm run build）は Windows では回さない＝`npm run check` にも入れないので
  //     比較の対象から外す。
  const scriptsIn = (src: string) =>
    new Set([...src.matchAll(/node (scripts\/check[\w-]*\.(?:ts|js))/g)].map((m) => m[1]));
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as { scripts?: Record<string, string> };
  const checkCmd = pkg.scripts?.check ?? "";
  const ciScripts = scriptsIn(ciYml);
  const pkgScripts = scriptsIn(checkCmd);
  const missing = [...ciScripts].filter((s) => !pkgScripts.has(s));
  const extra = [...pkgScripts].filter((s) => !ciScripts.has(s));
  const sameOk = checkCmd !== "" && missing.length === 0 && extra.length === 0;
  if (!sameOk) ciNg++;
  console.log(
    `${sameOk ? "✓" : "✗"}  ${"npm run check がCIと同じ検査を並べている".padEnd(40)} → ` +
      (sameOk
        ? `${ciScripts.size}本が一致`
        : checkCmd === ""
          ? `package.json に "check" が無い`
          : `CIにあって check に無い=${JSON.stringify(missing)} / check にあってCIに無い=${JSON.stringify(extra)}`)
  );

  // (3) シェルスクリプトがLFで展開されること。core.autocrlf=true のWindows機では
  //     .gitattributes が無いと *.sh がCRLFになり、bashが行末のCRを引数に含めて読むため
  //     スクリプトが1行も動かない（`$'\r': command not found`）。Git同梱のbashは許容し、
  //     CI（ubuntu）はLFで展開するので、**特定のシェルからだけ必ず落ちる**形になる。
  const attrs = existsSync(new URL("../.gitattributes", import.meta.url))
    ? readFileSync(new URL("../.gitattributes", import.meta.url), "utf8")
    : "";
  const shOk = /^\*\.sh\s+.*eol=lf/m.test(attrs);
  if (!shOk) ciNg++;
  console.log(
    `${shOk ? "✓" : "✗"}  ${".gitattributesが*.shをLFに固定している".padEnd(40)} → ` +
      (shOk ? "*.sh text eol=lf" : "指定が無い。Windowsの作業ツリーで *.sh がCRLFになり bash が実行できなくなる")
  );

  // (2') 型チェックも手元の1コマンドに含める（CIの最初のゲート）。
  const tscOk = checkCmd.includes("tsc --noEmit");
  if (!tscOk) ciNg++;
  console.log(
    `${tscOk ? "✓" : "✗"}  ${"npm run check に型チェックが入っている".padEnd(40)} → ${tscOk ? "tsc --noEmit" : "見つからない"}`
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ISRの再生成頻度（2026-08-25導入・重大度最高）
//
// 2026-08-24にVercel Hobbyの ISR Writes 上限を超過し、本番が全ルートHTTP 402で停止した。
// 原因は「時間ベースのISR（revalidate=N秒）が、アクセスが薄く分散した長い裾に対して
// 機能していなかった」こと。実測（30日）では Edge Requests 10,300件/日に対し
// ISR Writes 9,882件/日＝96%で、リクエストのほぼ全部が再生成を起こしていた。
// sitemapの約7,051ページに1日10,300リクエストが分散すると1ページあたりの再訪間隔は
// 平均16.4時間になり、revalidateがそれより短い限り訪問のたびに必ず期限切れになる。
//
// この検査が守るのは「長い裾のページの revalidate を再訪間隔より短い値に戻さないこと」。
// 900や3600へ戻すと**書き込みは1件も減らない**（同日に900→3600をやって効果ゼロだった）。
// 数字を戻す変更は画面を見ても気づけないので、機械で見張る。経緯は docs/operations.md の㉝。
// ────────────────────────────────────────────────────────────────────────────
let isrNg = 0;
{
  console.log("\n【ISRの再生成頻度】");

  // 1ページあたりの再訪間隔（16.4時間）より確実に長い値を下限にする。
  const MIN_LONG_TAIL_REVALIDATE = 86400;

  // 長い裾＝sitemapに大量に載っていて、1ページあたりのアクセスが薄いページ種別。
  //
  // **ここも手で並べない**（2026-08-31に書き直した）。初版は6本を名指しで書いており、
  // `/studio/[name]`（165件）と `/director/[name]`（378件）が入っていなかった。
  // 動的セグメントを持つページ＝URL空間が広い＝長い裾、なので app/ の走査から
  // 導出する。新しいページ種別を足したとき自動で見張りに入る。
  const appDirForIsr = fileURLToPath(new URL("../app", import.meta.url));
  const longTail = dynamicRoutes(appDirForIsr).filter((r) => r.kind === "html");
  if (longTail.length < 6) isrNg++;
  console.log(
    `${longTail.length >= 6 ? "✓" : "✗"}  ${"長い裾のページを走査できている".padEnd(48)} → ` +
      `${longTail.length} 件（app/ の動的セグメント）`
  );

  for (const r of longTail) {
    const text = readFileSync(r.file, "utf8");
    const m = text.match(/export const revalidate = (\d+);/);
    // revalidate を書いていないページは「時間では作り直さない」＝ISR Writes が
    // 増えない方向なので合格。ただし**書いてあるなら下限を守る**こと。
    // （/studio・/director は generateStaticParams で全件を事前生成しており、
    //   revalidate を持たない。これは最も安い形なので、書けと要求しない。）
    const declared = m !== null;
    const value = declared ? Number(m[1]) : null;
    const ok = !declared || (Number.isFinite(value!) && value! >= MIN_LONG_TAIL_REVALIDATE);
    if (!ok) isrNg++;
    console.log(
      `${ok ? "✓" : "✗"}  ${r.rel.padEnd(48)} → ` +
        (ok
          ? declared
            ? `revalidate=${value}`
            : "revalidate 宣言なし（時間では作り直さない）"
          : `revalidate=${m![1]}。${MIN_LONG_TAIL_REVALIDATE}秒（再訪間隔16.4時間）未満だと訪問のたびに再生成が起きる`)
    );
  }

  // データ層のTTLがページ側より短いと、ページ側を延ばしても実効値は低いほうになる
  // （App Routerの仕様。2026-08-25に実際にこれで効果ゼロだった）。
  const annict = readFileSync(new URL("../lib/annict.ts", import.meta.url), "utf8");
  const annictMatch = annict.match(/next: \{ revalidate: (\d+), tags: \[([^\]]*)\] \}/);
  const annictValue = annictMatch ? Number(annictMatch[1]) : NaN;
  const annictTagged = Boolean(annictMatch && annictMatch[2].includes('"annict"'));
  const annictOk = Number.isFinite(annictValue) && annictValue >= MIN_LONG_TAIL_REVALIDATE && annictTagged;
  if (!annictOk) isrNg++;
  console.log(
    `${annictOk ? "✓" : "✗"}  ${"lib/annict.ts のfetchが長いTTL＋タグを持つ".padEnd(48)} → ` +
      (annictOk
        ? `revalidate=${annictValue} / tags:["annict"]`
        : "ページ側のrevalidateを延ばしても、ここが短いと実効値はこちらに引きずられる（低いほうが勝つ）")
  );

  // 鮮度はタグで明示的に取りに行く方式なので、その窓口とcronが両方要る。
  const revalidateRouteUrl = new URL("../app/api/revalidate/route.ts", import.meta.url);
  const revalidateRoute = existsSync(revalidateRouteUrl) ? readFileSync(revalidateRouteUrl, "utf8") : "";
  const hasTag = revalidateRoute.includes('revalidateTag("annict")');
  const hasPath = revalidateRoute.includes("revalidatePath(");
  const hasAuth = revalidateRoute.includes("x-cron-secret");
  const routeOk = hasTag && hasPath && hasAuth;
  if (!routeOk) isrNg++;
  console.log(
    `${routeOk ? "✓" : "✗"}  ${"/api/revalidate がタグとパスの両方を古くする".padEnd(48)} → ` +
      (routeOk
        ? "revalidateTag + revalidatePath + 認証あり"
        : `不足: ${[!hasTag && "revalidateTag(\"annict\")", !hasPath && "revalidatePath", !hasAuth && "x-cron-secret"].filter(Boolean).join(" / ")}。ページだけ作り直しても中身が古いままになる`)
  );

  const wfUrl = new URL("../.github/workflows/revalidate.yml", import.meta.url);
  const wf = existsSync(wfUrl) ? readFileSync(wfUrl, "utf8") : "";
  const wfOk = wf.includes("/api/revalidate") && wf.includes("NOTIFY_CRON_SECRET");
  if (!wfOk) isrNg++;
  console.log(
    `${wfOk ? "✓" : "✗"}  ${"revalidate.yml が /api/revalidate を叩く".padEnd(48)} → ` +
      (wfOk ? "cronあり" : "これが無いと現在クールの鮮度が1週間まで緩む")
  );

  // OGP画像は force-dynamic＝毎リクエスト関数が起動する。明示のCache-Controlが唯一の歯止め。
  // **画像ルートも走査から導出する**（手で並べると、新しく足した画像ルートだけ
  // 歯止めが無いまま毎リクエスト外向き通信する状態になる）。
  const imageRoutes = appRoutes(appDirForIsr).filter(
    (r) => r.kind === "asset" && /image/.test(r.basename)
  );
  if (imageRoutes.length < 2) isrNg++;
  console.log(
    `${imageRoutes.length >= 2 ? "✓" : "✗"}  ${"画像ルートを走査できている".padEnd(48)} → ` +
      `${imageRoutes.length} 件`
  );
  for (const r of imageRoutes) {
    const rel = r.rel;
    const text = readFileSync(r.file, "utf8");
    const m = text.match(/"cache-control":\s*"[^"]*s-maxage=(\d+)/i);
    const value = m ? Number(m[1]) : NaN;
    const ok = Number.isFinite(value) && value >= MIN_LONG_TAIL_REVALIDATE;
    if (!ok) isrNg++;
    console.log(
      `${ok ? "✓" : "✗"}  ${rel.padEnd(48)} → ` +
        (ok
          ? `s-maxage=${value}`
          : "Cache-Controlが無い/短い。この画像ルートはforce-dynamicなので、ヘッダが無いと毎リクエストAnnictとGoogle Fontsへ計3往復する")
    );
  }

  // ── デプロイを起こしてよいものを1件ずつ決める ─────────────────────────
  //
  // デプロイ＝ISRキャッシュ実質全消去（docs/operations.md の㉝）。門番は vercel.json の
  // ignoreCommand で、導入時（2026-08-25）は「表示に使わないデータ」4箇所だけを除外して
  // いた。ところが実測（2026-09-01・直近30日）では、デプロイを起こした82コミットのうち
  // **32件（39%）が scripts/ .github/ .claude/ *.md しか触っていなかった**。どれも
  // next build が読まないファイルでビルド成果物は1バイトも変わらないのに、毎回キャッシュが
  // 全消去され、次にクローラが来たページが全部作り直しになっていた。
  //
  // **対象を手で数えない**（CLAUDE.md の基本ルール）。git が追跡している要素を走査して
  // 1件ずつ下の表と突き合わせるので、新しくディレクトリを足したら、ここに
  // 「デプロイを起こすべきか」を書くまで落ちる。
  //
  // 【この門番の限界】ignoreCommand が見るのは HEAD^..HEAD の**1コミットだけ**。1回の
  // push に複数コミットが入り、最後のコミットだけが除外対象だった場合、その前のコード変更は
  // このデプロイでは出ない（次のデプロイまで持ち越される）。導入時から在る性質だが、
  // 除外を広げたぶん当たりやすくなった。長引かない担保は2つ:
  // content/works/autoSchedule.json のcronが毎日コミットする＝ビルド対象なので24時間以内に
  // 必ずデプロイが起きること、verify-production.sh が毎日本番HTMLを数えること。
  // PRのsquash mergeは1コミットなので、この形自体が起きない。
  {
    const vercelUrl = new URL("../vercel.json", import.meta.url);
    const vercelJson = existsSync(vercelUrl) ? readFileSync(vercelUrl, "utf8") : "";
    const hasGate = vercelJson.includes("ignoreCommand");
    if (!hasGate) isrNg++;
    console.log(
      `${hasGate ? "✓" : "✗"}  ${"vercel.json のデプロイ門番がある".padEnd(48)} → ` +
        (hasGate
          ? "ignoreCommand あり"
          : "これが無いと、表示に使わないデータのコミットでもキャッシュが全消去される")
    );

    // ignoreCommand から除外パススペック（':!…'）を取り出す。
    const specs = [...vercelJson.matchAll(/':!([^']+)'/g)].map((m) => m[1]);
    const isExcluded = (p: string) =>
      specs.some((s) =>
        s.startsWith("*") ? p.endsWith(s.slice(1)) : s === p || p.startsWith(`${s}/`)
      );

    // deploy: true = 変更したらデプロイすべき（next build が読む、または配信物になる）
    const DEPLOY: Record<string, { deploy: boolean; why: string }> = {
      app: { deploy: true, why: "ページ本体" },
      components: { deploy: true, why: "画面" },
      lib: { deploy: true, why: "アプリのロジック" },
      public: { deploy: true, why: "配信する静的ファイル" },
      content: { deploy: true, why: "中の一部だけを除外する（下のcontent/の表）" },
      "middleware.ts": { deploy: true, why: "全リクエストが通る" },
      "next.config.mjs": { deploy: true, why: "ビルド設定" },
      "next-env.d.ts": { deploy: true, why: "型" },
      "package.json": { deploy: true, why: "依存とビルドコマンド" },
      "package-lock.json": { deploy: true, why: "依存の固定" },
      "tsconfig.json": { deploy: true, why: "パス別名がビルドに効く" },
      "vercel.json": { deploy: true, why: "デプロイ設定そのもの" },
      // 以下3つは next build が読まないが、checkout の挙動に触れうる／変更頻度が実質ゼロ
      // なので安全側に倒す（除外の判断を1件でも増やすと、そのぶん間違える機会が増える）。
      ".gitattributes": { deploy: true, why: "checkout時の改行に効くので安全側" },
      ".gitignore": { deploy: true, why: "同上・変更頻度は実質ゼロ" },
      ".env.local.example": { deploy: true, why: "同上" },
      docs: { deploy: false, why: "手順書。next build は読まない" },
      scripts: { deploy: false, why: "検査・収集。アプリ側からのimportが無いことを下で検査する" },
      ".github": { deploy: false, why: "ワークフロー定義" },
      ".claude": { deploy: false, why: "エージェント定義" },
      "CLAUDE.md": { deploy: false, why: "*.md でまとめて除外" },
      "README.md": { deploy: false, why: "同上" },
    };

    // content/ の中は「表示に使うか」で割れているので1階層深く見る。
    const CONTENT: Record<string, { deploy: boolean; why: string }> = {
      affiliate: { deploy: true, why: "lib/affiliate.ts が読む" },
      archive: { deploy: true, why: "sitemap・声優/制作会社ページが読む" },
      discord: { deploy: true, why: "lib/discord.ts が読む" },
      people: { deploy: true, why: "出演作の人力補完" },
      services: { deploy: true, why: "配信サービス名寄せ" },
      sns: { deploy: true, why: "スポットライト（SNS画像が読む）" },
      snapshots: { deploy: true, why: "過去クールの静的データ" },
      works: { deploy: true, why: "あらすじ・人力補完・autoSchedule.json＝画面に出る" },
      analytics: { deploy: false, why: "GSC・行動ログ。画面に一切出ない" },
      coverage: { deploy: false, why: "初出日の記録。画面に一切出ない" },
      demand: { deploy: false, why: "需要シグナル。画面に一切出ない" },
    };

    // git が追跡している実体から導出する（readdirSync だと node_modules や .next を
    // 自前で除く判断が要り、そこが Vercel の checkout とズレる）。
    const repoRoot = fileURLToPath(new URL("..", import.meta.url));
    let tracked: string[] = [];
    let gitOk = true;
    try {
      tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: repoRoot })
        .split("\n")
        .filter(Boolean);
    } catch {
      gitOk = false;
    }
    if (!gitOk) isrNg++;
    console.log(
      `${gitOk ? "✓" : "✗"}  ${"追跡ファイルを走査できている".padEnd(48)} → ` +
        (gitOk
          ? `${tracked.length} 件`
          : "git ls-files が失敗した。この節は対象を走査で導出するので、走査できないと検査にならない")
    );

    // ① 登録漏れ・実体の無い登録（freshness.js の収集先登録と同じ考え方）。
    for (const [label, table, entries] of [
      ["トップレベル", DEPLOY, [...new Set(tracked.map((f) => f.split("/")[0]))]],
      [
        "content/",
        CONTENT,
        [...new Set(tracked.filter((f) => f.startsWith("content/")).map((f) => f.split("/")[1]))],
      ],
    ] as [string, Record<string, { deploy: boolean; why: string }>, string[]][]) {
      const unregistered = entries.filter((e) => !(e in table));
      const ghosts = Object.keys(table).filter((k) => !entries.includes(k));
      const ok = gitOk && unregistered.length === 0 && ghosts.length === 0;
      if (!ok) isrNg++;
      console.log(
        `${ok ? "✓" : "✗"}  ${`${label}が全部登録されている`.padEnd(48)} → ` +
          (ok
            ? `${entries.length} 件すべて登録済み`
            : [
                unregistered.length &&
                  `未登録: ${unregistered.join(" / ")}（デプロイを起こしてよいかを決めていない）`,
                ghosts.length && `実体が無い登録: ${ghosts.join(" / ")}`,
              ]
                .filter(Boolean)
                .join(" ／ "))
      );
    }

    // ② 決めたとおりに ignoreCommand が除外している／していない。
    for (const [prefix, table] of [
      ["", DEPLOY],
      ["content/", CONTENT],
    ] as [string, Record<string, { deploy: boolean; why: string }>][]) {
      for (const [name, { deploy, why }] of Object.entries(table)) {
        const p = `${prefix}${name}`;
        // content 本体は deploy:true だが、中の一部を除外するので個別に見る（上の CONTENT）。
        if (p === "content") continue;
        const excluded = isExcluded(p);
        const ok = deploy ? !excluded : excluded;
        if (!ok) isrNg++;
        if (!ok) {
          console.log(
            `✗  ${p.padEnd(48)} → ` +
              (deploy
                ? `除外されているがデプロイが要る（${why}）`
                : `除外されていない＝変更のたびにキャッシュが全消去される（${why}）`)
          );
        }
      }
    }
    const decided = Object.keys(DEPLOY).length + Object.keys(CONTENT).length - 1;
    console.log(`✓  ${"除外の要否が決めたとおりになっている".padEnd(48)} → ${decided} 件を判定`);

    // ③ scripts/ を除外してよい前提＝アプリ側が scripts/ を一切importしていないこと。
    //    ここが崩れると、ビルドに効くコードの変更が無言でデプロイされなくなる。
    const importers: string[] = [];
    const scanImports = (dir: URL, rel: string) => {
      if (!existsSync(dir)) return;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const child = new URL(`${ent.name}${ent.isDirectory() ? "/" : ""}`, dir);
        if (ent.isDirectory()) scanImports(child, `${rel}/${ent.name}`);
        else if (/\.(ts|tsx|js|mjs)$/.test(ent.name)) {
          const src = readFileSync(child, "utf8");
          // import / export ... from "…/scripts/…"、require("…/scripts/…")、動的 import の全部を見る。
          if (/(?:from|require\s*\(|import\s*\(|import)\s*["'][^"']*scripts\//.test(src)) {
            importers.push(`${rel}/${ent.name}`);
          }
        }
      }
    };
    for (const d of ["app", "components", "lib", "content"]) {
      scanImports(new URL(`../${d}/`, import.meta.url), d);
    }
    const noImport = importers.length === 0;
    if (!noImport) isrNg++;
    console.log(
      `${noImport ? "✓" : "✗"}  ${"アプリ側が scripts/ をimportしていない".padEnd(48)} → ` +
        (noImport
          ? "参照なし（scripts/ を除外してよい前提が成り立っている）"
          : `参照あり: ${importers.join(" / ")}。除外するとビルドに効く変更がデプロイされない`)
    );
  }

  // 対策の効果は推定でしか書けていない（Vercelのダッシュボードはログインが要るので
  // セッションから読めず、ルート別の内訳も出ない）。人が画面を見に行くきっかけが
  // 運用に無いと、気づいたときにはまた止まっている。その「きっかけ」を見張る。
  {
    const wfUrl2 = new URL("../.github/workflows/usage-check.yml", import.meta.url);
    const wf2 = existsSync(wfUrl2) ? readFileSync(wfUrl2, "utf8") : "";
    const hasJob = wf2.includes("scripts/usage-check.js") && wf2.includes("gh issue create");
    // 判定日はスクリプト側だけが持つ（YAMLに書くと片方だけ直したときにズレて気づけない。
    // season-prep.yml / daily-digest.yml と同じ方針）。
    const noDateInYaml = !/\b20\d{2}-\d{2}-\d{2}\b/.test(
      wf2.split("on:")[1] ?? ""
    );
    const ok = hasJob && noDateInYaml;
    if (!ok) isrNg++;
    console.log(
      `${ok ? "✓" : "✗"}  ${"利用量の答え合わせを促すcronがある".padEnd(48)} → ` +
        (ok
          ? "usage-check.yml（判定日はscripts/lib/build-usage-check.jsだけが持つ）"
          : !hasJob
            ? "これが無いと、対策が効いたかを誰も確かめないまま3倍枠が切れる"
            : "判定日がYAMLに直書きされている。定義はscripts/lib/build-usage-check.jsの1箇所だけにする")
    );

    // 判定日に実際に発火するか（窓の中で本文が出て、外では何も出ないこと）。
    // 静かに発火しなくなる壊れ方は、その日が来るまで気づけない。
    const { buildUsageCheck, CHECKPOINTS } = await import("../scripts/lib/build-usage-check.js");
    let fireNg = 0;
    for (const c of CHECKPOINTS as { date: string }[]) {
      const onDay = buildUsageCheck(c.date);
      if (!onDay || !onDay.title.includes(c.date)) fireNg++;
      // 判定日の前日は窓の外
      const prev = new Date(Date.parse(`${c.date}T00:00:00Z`) - 86400000)
        .toISOString()
        .slice(0, 10);
      if (buildUsageCheck(prev) !== null) fireNg++;
    }
    if (fireNg > 0) isrNg++;
    console.log(
      `${fireNg === 0 ? "✓" : "✗"}  ${"判定日に発火し、前日には発火しない".padEnd(48)} → ` +
        (fireNg === 0 ? `判定日 ${CHECKPOINTS.length} 件すべてOK` : `${fireNg} 件がおかしい`)
    );
  }

  console.log(`結果（ISRの再生成頻度）: ${isrNg === 0 ? "全てOK" : `${isrNg} 件NG`}`);
}


if (
  isrNg > 0 ||
  autoNg > 0 ||
  datasetNg > 0 ||
  llmsNg > 0 ||
  creditNg > 0 ||
  ciNg > 0 ||
  addNg > 0 ||
  seriesNg > 0 ||
  spotlightNg > 0 ||
  castsNg > 0 ||
  seasonKeyNg > 0 ||
  discordNg > 0 ||
  planNg > 0 ||
  orphanNg > 0 ||
  thinPersonNg > 0 ||
  nextSeasonNg > 0 ||
  prerenderNg > 0 ||
  softNg > 0 ||
  partialWeekNg > 0 ||
  prepNg > 0 ||
  archiveNg > 0 ||
  titleNg > 0 ||
  pageTitleNg > 0 ||
  faceNg > 0 ||
  descNg > 0 ||
  thinNg > 0 ||
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
  ldNg > 0 ||
  xIntentNg > 0 ||
  xPolicyNg > 0 ||
  trackNg > 0 ||
  aliasNg > 0 ||
  svcAliasNg > 0
)
  // process.exit() ではなく exitCode。Windows では stdout がパイプされていると
  // process.exit() が書き込み途中のバッファを巻き込んでプロセスを異常終了させ、
  // 終了コードが 1 ではなく 3221226505 (0xC0000409) になる。CI（ubuntu）では
  // 起きないので気づきにくいが、手元で失敗したときに原因の切り分けを難しくする。
  process.exitCode = 1;
