// ───────────────────────────────────────────────────────────────
// 「完結」の判定（2026-10-19導入・重大度高）。
//
// 【推定はしない】完結したら表記が変わる情報源の「明示的な印」があるときだけ完結にする。
//   ① dアニメストアの作品ページの「（全N話）」
//   ② しょぼいカレンダーの最終回の枠の「終」フラグ
// 取得は GitHub Actions（scripts/fetch-completion.js）が行い content/works/completion.json に
// 書く。ここは読むだけで、Vercelの関数から外部へは一切出ない（無料枠のため）。
// 印が無い作品は「完結していない」ではなく「分からない」＝完結を出さない。
//
// 以前の推定（Annictの最後の放送枠が過ぎたら完結）は、Annictが枠を数週先までしか
// 登録しないため12話の作品を第4話の後に完結扱いにした（2026-10-18）。
// 話数の下限・期間・停滞日数で縛る案も利用者に却下された（1〜2話完結の作品があり、
// X投稿の「今日の配信」から外すのが目的なので待つ案はどれも遅い）。経緯は
// docs/operations.md の[65]。
//
// 【時刻は配信に合わせる】しょぼいカレンダーの「終」はTVの時刻（配信が先行する作品では
// 最大1週間遅い。LV999の村人＝TV 9/17・配信 9/10）。Annictに話数付きの配信枠があれば、
// その話の**最初の配信**の時刻に合わせる（画面とSNSの曜日は配信から出しているため）。
//
// ただし配信が「印より前」に出ている場合は、**1話前も同じだけ先行していたときだけ**合わせる
// （Annictに延期前の古い枠が残っていると、最終話だけが急に先行して見える。2026-10-19の反証）。
// 配信が印より後なら、そのまま配信に合わせる（遅い側＝誤って早く完結にしない）。
//
// 【矛盾したら完結にしない】印があっても、Annictの話数付きの配信と食い違うときは捨てる:
//   - 印の最終話より大きい番号の話が配信されている（続いている／番号の数え方が違う）
//   - 印の時刻より1日以上あとに初めて配信された話がある（延期で古い枠が残った等。
//     2026-10-18の反証で BLEACH のテレビ大阪の枠に実例）
//   - 印の時刻が、その作品の最初の配信より7日以上前（別の作品の印を拾っている）。
//     7日以内なら最初の配信の時刻に寄せる（TVで全話を先に放送してから配信が始まる短い作品。
//     わたしの幸せな結婚 特別篇＝TV 20:00に#29「終」・配信開始20:30）。これは完結を推す閾値ではなく
//     「同じ作品の印か」を確かめる範囲（配信先行・TV先行のずれは実測で最大7日）。
//   - Annictの話数付き配信の取得に失敗した（照合できない＝出さない。次の更新で戻る）
// 【キャッシュの外で決める】lib/getSeasonData.ts はクール一覧をキャッシュ（今期6時間・
// 終わったクール1週間）するので、印の照合はキャッシュの外で行う（completionInputOf で材料だけ
// キャッシュに入れる）。中で決めると completion.json を更新してデプロイしても最大1週間反映されない。
// ───────────────────────────────────────────────────────────────
import type { EpisodeTail } from "./types.ts";
import { classifyChannel } from "./services.ts";

export interface SyoboiCompletion {
  tid: number;
  finalCount: number;
  finalAt: string;
  // 最終話の1話前（#finalCount-1）の最も早い枠。配信先行の幅が毎週同じかを確かめるのに使う。
  prevAt: string | null;
}
export interface DanimeCompletion {
  workIds: string[];
  episodes: number;
  // 「（全N話）」を初めて見た時刻。dアニメの一覧は最終話の時刻を返さない
  // （latestPartPublicDate が全作品 null。2026-10-19実測）ので、番号がAnnictとそろわない作品は
  // この時刻（＝実際の最終話より必ず遅い＝安全側）で完結にする。
  seenAt: string;
}
// キャッシュに入れておく照合の材料（lib/getSeasonData.ts）。JSONにできる形だけ。
export interface CompletionInput {
  // [話数, その話の最初の配信のms]
  earliest: [number, number][];
  firstStreamMs: number | null;
  // Annictの話数付き配信を取れなかった（＝照合できない）
  unavailable?: boolean;
}
export interface CompletionSignal {
  syoboi?: SyoboiCompletion;
  danime?: DanimeCompletion;
}
export interface ResolvedCompletion {
  at: string;
  by: "syoboi" | "danime";
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function isIso(v: unknown): v is string {
  return typeof v === "string" && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
}
function isPosInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

// 1件を検証する。壊れた側だけ捨てる（片方が壊れていても、もう片方は使う）。
// 生成側の不具合で形が崩れても、誤った「完結」を出さずに黙って落ちる方向に倒す。
export function parseCompletionEntry(raw: unknown): CompletionSignal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: CompletionSignal = {};
  const s = r.syoboi as Record<string, unknown> | undefined;
  if (
    s &&
    typeof s === "object" &&
    isPosInt(s.tid) &&
    isPosInt(s.finalCount) &&
    isIso(s.finalAt) &&
    (s.prevAt === undefined || s.prevAt === null || isIso(s.prevAt))
  ) {
    out.syoboi = { tid: s.tid, finalCount: s.finalCount, finalAt: s.finalAt, prevAt: (s.prevAt as string | null | undefined) ?? null };
  }
  const d = r.danime as Record<string, unknown> | undefined;
  if (
    d &&
    typeof d === "object" &&
    Array.isArray(d.workIds) &&
    d.workIds.length > 0 &&
    d.workIds.every((x) => typeof x === "string" && /^\d+$/.test(x)) &&
    isPosInt(d.episodes) &&
    isIso(d.seenAt)
  ) {
    out.danime = { workIds: d.workIds as string[], episodes: d.episodes, seenAt: d.seenAt };
  }
  return out.syoboi || out.danime ? out : null;
}

export function parseCompletions(file: unknown): Record<number, CompletionSignal> {
  const out: Record<number, CompletionSignal> = {};
  if (!file || typeof file !== "object") return out;
  const works = (file as { works?: unknown }).works;
  if (!works || typeof works !== "object") return out;
  for (const [key, value] of Object.entries(works as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0) continue;
    const entry = parseCompletionEntry(value);
    if (entry) out[id] = entry;
  }
  return out;
}

// 話数ごとの「最初の配信」の時刻（ms）。TV局の枠は数えない（曜日・時刻と同じく配信で見る）。
// 遅れて配信するサービスがあっても、その話が最初に出た時刻だけが残る。
export function earliestStreamByEpisode(tail: EpisodeTail | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (!tail) return out;
  for (const p of tail.programs) {
    if (p.episodeNumber === null) continue;
    if (classifyChannel(p.channel).kind === "tv") continue;
    const ms = Date.parse(p.startedAt);
    if (Number.isNaN(ms)) continue;
    const prev = out.get(p.episodeNumber);
    if (prev === undefined || ms < prev) out.set(p.episodeNumber, ms);
  }
  return out;
}

// 照合の材料を作る（toAnimeItem から呼ぶ。キャッシュに入れるのでJSONにできる形）。
export function completionInputOf(tail: EpisodeTail | undefined, firstStreamMs: number | null): CompletionInput {
  return {
    earliest: [...earliestStreamByEpisode(tail).entries()],
    firstStreamMs,
    ...(tail?.unavailable ? { unavailable: true } : {}),
  };
}

// 印が同じ作品のものかを、最初の配信と比べて確かめる。7日以内の前なら最初の配信に寄せ、
// それより前なら捨てる（null）。冒頭コメントの「矛盾したら完結にしない」の3つ目。
const SAME_WORK_WINDOW_MS = 7 * DAY_MS;
function alignToFirstStream(atMs: number, firstStreamMs: number | null): number | null {
  if (firstStreamMs === null || atMs >= firstStreamMs) return atMs;
  return firstStreamMs - atMs <= SAME_WORK_WINDOW_MS ? firstStreamMs : null;
}

// 印の時刻より1日以上あとに**初めて**配信された話があれば矛盾（遅れて配信するサービスは
// 各話の最初の配信だけを見るので数えない）。
function noLaterEpisode(atMs: number, earliest: Map<number, number>): boolean {
  for (const ms of earliest.values()) {
    if (ms > atMs + DAY_MS) return false;
  }
  return true;
}

// 印と照合の材料から、完結した時刻を決める。決められなければ null。
export function resolveCompletionFrom(
  signal: CompletionSignal | undefined,
  input: CompletionInput
): ResolvedCompletion | null {
  if (!signal) return null;
  if (input.unavailable) return null;
  const earliest = new Map(input.earliest);
  const maxEpisode = earliest.size > 0 ? Math.max(...earliest.keys()) : null;
  const picks: { atMs: number; by: ResolvedCompletion["by"] }[] = [];

  if (signal.syoboi && !(maxEpisode !== null && maxEpisode > signal.syoboi.finalCount)) {
    const f = signal.syoboi.finalCount;
    const markMs = Date.parse(signal.syoboi.finalAt);
    const streamed = earliest.get(f);
    let atMs = markMs;
    if (streamed !== undefined) {
      if (streamed >= markMs) {
        atMs = streamed; // TVが先・配信が後 → 配信に合わせる（遅い側）
      } else {
        // 配信が印より先。1話前も同じだけ先行していたときだけ合わせる（LV999の村人は毎週7日先行）。
        const prevStreamed = earliest.get(f - 1);
        const prevMark = signal.syoboi.prevAt ? Date.parse(signal.syoboi.prevAt) : NaN;
        if (
          prevStreamed !== undefined &&
          !Number.isNaN(prevMark) &&
          Math.abs(markMs - streamed - (prevMark - prevStreamed)) <= DAY_MS
        ) {
          atMs = streamed;
        }
      }
    }
    const aligned = alignToFirstStream(atMs, input.firstStreamMs);
    if (aligned !== null && noLaterEpisode(aligned, earliest)) picks.push({ atMs: aligned, by: "syoboi" });
  }

  if (signal.danime && !(maxEpisode !== null && maxEpisode > signal.danime.episodes)) {
    const n = signal.danime.episodes;
    const seenMs = Date.parse(signal.danime.seenAt);
    // 番号がそろっていれば（Annictの最新話＝全N話の最終話）その話の最初の配信に合わせる。
    // 「（全N話）」は完結後にしか付かないので、ここで早めても「まだ続いている作品」にはならない。
    const streamed = maxEpisode === n ? earliest.get(n) : undefined;
    const atMs = streamed !== undefined ? Math.min(streamed, seenMs) : seenMs;
    const aligned = alignToFirstStream(atMs, input.firstStreamMs);
    if (aligned !== null && noLaterEpisode(aligned, earliest)) picks.push({ atMs: aligned, by: "danime" });
  }

  if (picks.length === 0) return null;
  // どちらも明示的な印なので、早いほうを採る（迅速さ）。
  picks.sort((a, b) => a.atMs - b.atMs);
  return { at: new Date(picks[0].atMs).toISOString(), by: picks[0].by };
}

// テストと作品ページ向けの入口（材料をその場で作る）。
export function resolveCompletion(
  signal: CompletionSignal | undefined,
  tail: EpisodeTail | undefined,
  firstStreamMs: number | null
): ResolvedCompletion | null {
  return resolveCompletionFrom(signal, completionInputOf(tail, firstStreamMs));
}

// 画面の「完結」を出すか（components/SeasonExplorer.tsx が使う）。最終回の枠が事前に入って
// いると completedAt は未来の時刻なので、必ず「いま」と比べる。
export function isCompletedAt(at: string | null | undefined, nowMs: number): boolean {
  if (!at) return false;
  const ms = Date.parse(at);
  return !Number.isNaN(ms) && nowMs >= ms;
}

// "YYYY-MM-DD"（JST）。SNSの「今日の一覧」は日付単位で判定する（最終話の当日は載せ、翌日から外す）。
export function completedDateJst(at: string | null | undefined): string | null {
  if (!at) return null;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
