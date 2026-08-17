// ───────────────────────────────────────────────────────────────
// 機械補完した放送/公開の予定日（content/works/autoSchedule.json）の読み込み。
// 2026-08-17導入。
//
// 【何のための層か】
// 次クールの放送日はAnnictの programs（番組表）に載るのが遅い。2026-08-17の実測で、
// 2026秋はAnnictの99作品中 **programsを持つのが3件だけ**で、残り96件はサイト上
// 「放送時期未定」だった。同じ日にAniListは38件の日付（日まで）と28件の放送時刻を
// 持っていた。人力補完（extraServices.ts / releaseDates.ts）は一次情報の確認が要る
// ぶん速くならないので、**機械が毎日運ぶ層**を分けて置く（scripts/fetch-upcoming.js）。
//
// 【なぜ検証してから使うか】
// このJSONは人が書くファイルではなく、GitHub Actionsが1日2回上書きしてコミットする。
// 生成側の不具合や AniList 側の仕様変更で形が壊れることがありうるので、
// **読み込み時に1件ずつ検証して、おかしい件だけ捨てる**（ファイル全体を落として
// サイトが真っ白になる／不正な日付がそのまま表示される、のどちらも避ける）。
// 検証は `node scripts/check.ts` の「機械補完した放送予定日」節がテストする。
// ───────────────────────────────────────────────────────────────
import type { AutoScheduleEntry } from "./types";

// 生成側（scripts/fetch-upcoming.js）が書き出すファイルの形。
// works のキーはAnnictの作品ID（annictId）を文字列にしたもの。
export interface AutoScheduleFile {
  updatedAt?: unknown;
  source?: unknown;
  works?: unknown;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
// 出典は AniList の作品ページに限る（生成側が別の情報源に変わったら、表示の断り書きと
// 一緒に直す必要がある＝黙って別の出典に差し替わらないようにここで固定する）。
const SOURCE_HOST_RE = /^https:\/\/anilist\.co\/anime\/\d+/;

// 1件を検証する。1つでも条件を満たさなければ null（＝その作品は補完しない）。
// 「推測でデータを埋めない」方針に合わせ、迷ったら捨てる側に倒す。
export function parseAutoScheduleEntry(raw: unknown): AutoScheduleEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const precision = r.precision;
  if (precision !== "day" && precision !== "month") return null;

  const date = r.date;
  if (typeof date !== "string") return null;
  if (precision === "day" && !DAY_RE.test(date)) return null;
  if (precision === "month" && !MONTH_RE.test(date)) return null;

  const kind = r.kind;
  if (kind !== "broadcast" && kind !== "release") return null;

  const sourceUrl = r.sourceUrl;
  if (typeof sourceUrl !== "string" || !SOURCE_HOST_RE.test(sourceUrl)) return null;

  const fetchedDate = r.fetchedDate;
  if (typeof fetchedDate !== "string" || !DAY_RE.test(fetchedDate)) return null;

  const matchedBy = r.matchedBy;
  if (matchedBy !== "mal" && matchedBy !== "title" && matchedBy !== "url") return null;

  const entry: AutoScheduleEntry = { date, precision, kind, sourceUrl, fetchedDate, matchedBy };

  // 曜日・時刻は任意。**月までしか判明していない作品には付けない**（「10月放送予定」
  // なのに曜日が出ていたら、確定した放送枠があるように見えてしまう）。
  if (precision === "day") {
    const weekday = r.weekday;
    const time = r.time;
    if (typeof weekday === "number" && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) {
      entry.weekday = weekday;
    }
    if (typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      entry.time = time;
    }
    // 曜日と時刻は対で意味を持つ（片方だけでは「毎週その曜日」の誤読を招く）ので、
    // 揃わなければ両方落として日付だけにする。
    if (entry.weekday === undefined || entry.time === undefined) {
      delete entry.weekday;
      delete entry.time;
    }
  }

  return entry;
}

// ファイル全体を作品ID→エントリの表に変換する。壊れた件は黙って落とす（数は
// parseAutoSchedules の戻り値ではなく check.ts 側で見張る）。
export function parseAutoSchedules(file: unknown): Record<number, AutoScheduleEntry> {
  const out: Record<number, AutoScheduleEntry> = {};
  if (!file || typeof file !== "object") return out;
  const works = (file as AutoScheduleFile).works;
  if (!works || typeof works !== "object") return out;

  for (const [key, value] of Object.entries(works as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0) continue;
    const entry = parseAutoScheduleEntry(value);
    if (entry) out[id] = entry;
  }
  return out;
}
