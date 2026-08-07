// ───────────────────────────────────────────────────────────────
// 放送・配信スケジュールの iCalendar（.ics）配信ロジック。
//
// なぜ作るか（2026-08-07 / docs/growth-strategy-2026-08.md）:
//   世界の類似サービス約100件を調べたところ、長く生き残っている側
//   （しょぼいカレンダー・Annict・AnimeSchedule・Senpai.moe・映画.com）は
//   例外なく「購読できるフィード」を持っていた。MyAnimeList/AniList/LiveChart/Simkl の
//   流入はいずれも Direct が49〜77%で、検索ではなく**定着**で回っている。
//   .ics は「一度購読されたら、こちらが何もしなくても毎週相手のカレンダーに出る」
//   という点で、投稿を毎日出し続ける SNS 運用とは性質がまるで違う。
//
// 【放送開始1週間前ルールとの関係】(CLAUDE.md の基本ルール)
//   UI で曜日・時刻を出さないのは「今週の水曜22:30」と誤読させないため。
//   カレンダーは**実日付**を持つので、その誤読は原理的に起きない。
//   ただし DTSTART は必ず broadcastStartDate（実際の放送開始日）に置く。
//   「次の水曜」から始めてはいけない（1話も配信されていない日に予定が入る）。
//   放送開始日が分からない作品はカレンダーに載せない（推測で日付を作らない）。
//
// 拡張子つき import なのは `node scripts/check.ts` から直接読めるようにするため
// （tsconfig.json の allowImportingTsExtensions と対。lib/embed.ts と同じ）。
// ───────────────────────────────────────────────────────────────
import { siteUrl } from "./siteUrl.ts";

export const CALENDAR_REF = "ics";

// RFC 5545: 1行75オクテットを超えたら折り返す。日本語（UTF-8で1文字3バイト）を
// 含むので、バイト数で数えて途中で切らないよう文字単位で積む。
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    // 継続行は先頭に空白1つを足すぶん、実質74オクテットまで
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  if (cur) out.push(cur);
  return out.join("\r\n ");
}

// RFC 5545 のテキスト値エスケープ（バックスラッシュ・セミコロン・カンマ・改行）。
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export interface CalendarWork {
  id: number;
  title: string;
  services: { key: string; short: string }[];
  otherServices: string[];
  broadcastStartDate: string | null; // "YYYY-MM-DD"（JST）
  broadcastTime: string | null; // "HH:MM"（JST）
}

// JSTの日付＋時刻を、iCalendar の UTC 形式（YYYYMMDDTHHMMSSZ）に変換する。
// JST は UTC+9 固定（サマータイム無し）なので、9時間引くだけでよい。
export function toUtcStamp(date: string, time: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const hour = Number(t[1]);
  const min = Number(t[2]);
  // 「26:30」のような放送業界表記（24時以降＝翌日）を素直に日付繰り上げで扱う。
  const dayShift = Math.floor(hour / 24);
  const d = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dayShift, (hour % 24) - 9, min, 0);
  if (Number.isNaN(d)) return null;
  return new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function serviceLine(work: CalendarWork): string {
  const names = [...work.services.map((s) => s.short), ...work.otherServices];
  return names.length ? names.join("・") : "配信情報は未登録";
}

export interface CalendarOptions {
  // 単一サービスで絞ったカレンダー（?service=d_anime）のときのサービス名。
  serviceName?: string | null;
  // カレンダー名に出すクール表記（例: "2026年夏"）。
  seasonLabel: string;
  // DTSTAMP に使う時刻（テスト時に固定できるよう引数化）。
  now?: Date;
}

// 週1回の繰り返し予定として組み立てる。放送は基本的に毎週同じ曜日・時刻なので、
// 話数ぶんの VEVENT を並べるより購読側で軽い。終了日は Annict が持たないため
// 指定しない（＝無期限）。放送終了後に予定が残るのを避けたい利用者のために
// SUMMARY と DESCRIPTION に作品ページへのリンクを入れておく。
export function buildCalendar(works: CalendarWork[], opts: CalendarOptions): string {
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const name = opts.serviceName
    ? `${opts.seasonLabel}アニメ（${opts.serviceName}）| アニメ視聴ガイド`
    : `${opts.seasonLabel}アニメ 放送・配信スケジュール | アニメ視聴ガイド`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//animedia//anime streaming guide//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(name)}`,
    "X-WR-TIMEZONE:Asia/Tokyo",
    `X-WR-CALDESC:${escapeIcsText(
      `${opts.seasonLabel}アニメの放送・配信スケジュール。出典: アニメ視聴ガイド（${siteUrl}）`
    )}`,
    // 購読側が更新を取りに来る間隔の希望値。放送情報は日単位でしか動かない。
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
  ];

  for (const w of works) {
    // 放送開始日が分からない作品は載せない（推測で日付を作らない＝CLAUDE.mdの方針）。
    if (!w.broadcastStartDate || !w.broadcastTime) continue;
    const dtstart = toUtcStamp(w.broadcastStartDate, w.broadcastTime);
    if (!dtstart) continue;
    const url = `${siteUrl}/anime/${w.id}?ref=${CALENDAR_REF}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:animedia-${w.id}@${siteUrl.replace(/^https?:\/\//, "")}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dtstart}`,
      // 放送1回ぶんの長さはAnnictが持たないので30分固定（尺の主張はしない）。
      "DURATION:PT30M",
      "RRULE:FREQ=WEEKLY",
      foldLine(`SUMMARY:${escapeIcsText(w.title)}`),
      foldLine(`DESCRIPTION:${escapeIcsText(`配信: ${serviceLine(w)}\n${url}`)}`),
      foldLine(`URL:${escapeIcsText(url)}`),
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
