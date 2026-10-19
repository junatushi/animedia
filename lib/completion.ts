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
// 【矛盾したら完結にしない】印があっても、Annictの話数付きの配信と食い違うときは捨てる:
//   - 印の最終話より大きい番号の話が配信されている（続いている／番号の数え方が違う）
//   - 印の時刻より1日以上あとに初めて配信された話がある（延期で古い枠が残った等。
//     2026-10-18の反証で BLEACH のテレビ大阪の枠に実例）
//   - 印の時刻が、その作品の最初の配信より前（別の作品の印を拾っている）
// ───────────────────────────────────────────────────────────────
import type { EpisodeTail } from "./types.ts";
import { classifyChannel } from "./services.ts";

export interface SyoboiCompletion {
  tid: number;
  finalCount: number;
  finalAt: string;
}
export interface DanimeCompletion {
  workIds: string[];
  episodes: number;
  // dアニメで最終話が出た時刻（一覧の latestPartPublicDate）。取れなければ null。
  finalAt: string | null;
  // 「（全N話）」を初めて見た時刻。finalAt が無いときの代わり（遅い側＝安全側）。
  seenAt: string;
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
  if (s && typeof s === "object" && isPosInt(s.tid) && isPosInt(s.finalCount) && isIso(s.finalAt)) {
    out.syoboi = { tid: s.tid, finalCount: s.finalCount, finalAt: s.finalAt };
  }
  const d = r.danime as Record<string, unknown> | undefined;
  if (
    d &&
    typeof d === "object" &&
    Array.isArray(d.workIds) &&
    d.workIds.length > 0 &&
    d.workIds.every((x) => typeof x === "string" && /^\d+$/.test(x)) &&
    isPosInt(d.episodes) &&
    (d.finalAt === null || isIso(d.finalAt)) &&
    isIso(d.seenAt)
  ) {
    out.danime = {
      workIds: d.workIds as string[],
      episodes: d.episodes,
      finalAt: (d.finalAt as string | null) ?? null,
      seenAt: d.seenAt,
    };
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

// 印の時刻が Annict の配信と矛盾しないか（上の冒頭コメントの3条件）。
function consistent(atMs: number, earliest: Map<number, number>, firstStreamMs: number | null): boolean {
  if (firstStreamMs !== null && atMs < firstStreamMs) return false;
  for (const ms of earliest.values()) {
    if (ms > atMs + DAY_MS) return false;
  }
  return true;
}

// 印と Annict の話数付き配信（あれば）から、完結した時刻を決める。決められなければ null。
// firstStreamMs はその作品の最初の配信（toAnimeItem の放送枠の起点）。
export function resolveCompletion(
  signal: CompletionSignal | undefined,
  tail: EpisodeTail | undefined,
  firstStreamMs: number | null
): ResolvedCompletion | null {
  if (!signal) return null;
  const earliest = earliestStreamByEpisode(tail);
  const maxEpisode = earliest.size > 0 ? Math.max(...earliest.keys()) : null;
  const picks: { atMs: number; by: ResolvedCompletion["by"] }[] = [];

  if (signal.syoboi) {
    const f = signal.syoboi.finalCount;
    let atMs = Date.parse(signal.syoboi.finalAt);
    const streamed = earliest.get(f);
    if (maxEpisode !== null && maxEpisode > f) {
      // 印の最終話より先の話が配信されている＝矛盾。使わない。
    } else {
      if (streamed !== undefined) atMs = streamed;
      if (consistent(atMs, earliest, firstStreamMs)) picks.push({ atMs, by: "syoboi" });
    }
  }

  if (signal.danime) {
    const n = signal.danime.episodes;
    const ownMs = Date.parse(signal.danime.finalAt ?? signal.danime.seenAt);
    if (maxEpisode !== null && maxEpisode > n) {
      // dアニメの全話数より大きい番号の話が配信されている＝別の作品か数え方が違う。使わない。
    } else {
      // 番号がそろっていれば（Annictの最新話＝全N話の最終話）その話の最初の配信に合わせる。
      // そろわなければ dアニメ自身の時刻（無ければ初めて見た時刻＝遅い側）。
      const streamed = maxEpisode === n ? earliest.get(n) : undefined;
      const atMs = streamed !== undefined ? Math.min(streamed, ownMs) : ownMs;
      if (consistent(atMs, earliest, firstStreamMs)) picks.push({ atMs, by: "danime" });
    }
  }

  if (picks.length === 0) return null;
  // どちらも明示的な印なので、早いほうを採る（迅速さ）。
  picks.sort((a, b) => a.atMs - b.atMs);
  return { at: new Date(picks[0].atMs).toISOString(), by: picks[0].by };
}

// "YYYY-MM-DD"（JST）。SNSの「今日の一覧」は日付単位で判定する（最終話の当日は載せ、翌日から外す）。
export function completedDateJst(at: string | null | undefined): string | null {
  if (!at) return null;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
