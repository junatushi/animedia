// ───────────────────────────────────────────────────────────────
// 「Annictに配信サービスが新しく登録された」ことの検知（2026-08-07導入）。
//
// なぜ作るか:
//   毎日のSNS投稿の中身が「今日の放送」「注目作TOP5」＝**サイトを見れば分かること**
//   しかなく、フォローする理由もリポストする理由も生まれていない
//   （docs/growth-strategy-2026-08.md 7章）。「その日はじめて分かったこと」を出せる
//   数少ない材料がこれ。
//
// 【この検知が抱える弱点と、その潰し方】
//   Annictはコミュニティ編集なので、登録ミスの取り消し・付け直しがそのまま
//   「イベント」に見える。ここを無防備に通知へ流すと、**上流の編集の揺れが
//   そのまま利用者への通知回数になる**（2026-08-07・利用者の指摘）。
//   そのため次の4つを、この純粋関数の側で機械的に保証する:
//
//   1. **消えたことは扱わない。** サービスが見えなくなっても行は消さず、報告もしない。
//      Annictは配信終了を記録しないので、消えた＝配信終了とは限らない
//      （CLAUDE.mdの「もう配信されていません と書かない」と同じ理由）。
//   2. **連続してCONFIRM_DAYS日見えてから確定。** 1日でも途切れたら連続日数はやり直し。
//      付けて消してを繰り返す編集はここで全部落ちる。
//   3. **一度報告した (作品×サービス) は永久に再報告しない。** 消えて付け直されても
//      2回目は出ない（reportedOn が残り続ける）。
//   4. **初回は全件を「報告済み」として黙って記録する（種まき）。** これが無いと、
//      導入初日に既存の全ペアが「新規追加」に見えて大量に出る。
//
// 【メール通知には繋がない】既存の /api/notify は「その日に放送がある」という
//   日付駆動なので1日1通に収まるが、これは変更駆動で上流の編集回数がそのまま
//   届いてしまう。詳細は docs/operations.md の⑱-13。
//
// 素の `.ts` なのは `node scripts/check.ts` から検査できるようにするため。
// ───────────────────────────────────────────────────────────────

/** 何日連続で見えたら「本当に追加された」と扱うか。 */
export const CONFIRM_DAYS = 3;

/** 保存されている観測記録（1行 = 作品×サービス）。 */
export interface Sighting {
  workId: number;
  serviceKey: string;
  /** 最後にそのサービスが見えたJST日付（YYYY-MM-DD） */
  lastSeen: string;
  /** 連続して見えている日数 */
  streak: number;
  /** 報告した日（未報告なら null）。一度入ったら二度と消さない。 */
  reportedOn: string | null;
}

/** 今日のシーズンデータから作った「作品×サービス」の組。 */
export interface TodayPair {
  workId: number;
  workTitle: string;
  serviceKey: string;
  serviceShort: string;
}

export interface SightingRow extends Sighting {
  workTitle: string;
  serviceShort: string;
  season: string;
}

export interface ApplyResult {
  /** 書き戻す行（今日見えたぶんだけ。見えなかった行は触らない＝消さない） */
  upserts: SightingRow[];
  /** 今日はじめて確定した追加。種まきのときは必ず空。 */
  confirmed: TodayPair[];
}

/** YYYY-MM-DD の1日前を返す（JST日付の文字列同士で比較するために使う）。 */
export function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000;
  const p = new Date(t);
  return `${p.getUTCFullYear()}-${String(p.getUTCMonth() + 1).padStart(2, "0")}-${String(
    p.getUTCDate()
  ).padStart(2, "0")}`;
}

function keyOf(workId: number, serviceKey: string): string {
  return `${workId}:${serviceKey}`;
}

/**
 * 今日の観測を既存の記録に突き合わせ、書き戻す行と「確定した追加」を返す。
 *
 * @param seed 初回（記録が空）のときtrue。全件を報告済みとして記録し、何も報告しない。
 */
export function applySightings(
  existing: Sighting[],
  today: TodayPair[],
  todayJst: string,
  season: string,
  seed: boolean,
  confirmDays: number = CONFIRM_DAYS
): ApplyResult {
  const prev = new Map<string, Sighting>();
  for (const s of existing) prev.set(keyOf(s.workId, s.serviceKey), s);

  const yesterday = previousDay(todayJst);
  const upserts: SightingRow[] = [];
  const confirmed: TodayPair[] = [];

  for (const pair of today) {
    const k = keyOf(pair.workId, pair.serviceKey);
    const before = prev.get(k);

    let streak: number;
    let reportedOn: string | null;

    if (!before) {
      streak = 1;
      // 種まきのときは、既にあるものを「新規追加」と誤認しないよう報告済みにする。
      reportedOn = seed ? todayJst : null;
    } else {
      reportedOn = before.reportedOn;
      if (before.lastSeen === todayJst) {
        // 同じ日に2回走っても連続日数を二重に伸ばさない（再実行に強くする）。
        streak = before.streak;
      } else if (before.lastSeen === yesterday) {
        streak = before.streak + 1;
      } else {
        // 1日でも途切れたらやり直し。付けて消してを繰り返す編集はここで落ちる。
        streak = 1;
      }
    }

    // 未報告のものだけが、連続日数を満たした時点で1度だけ確定する。
    if (!reportedOn && streak >= confirmDays) {
      reportedOn = todayJst;
      confirmed.push(pair);
    }

    upserts.push({
      workId: pair.workId,
      serviceKey: pair.serviceKey,
      workTitle: pair.workTitle,
      serviceShort: pair.serviceShort,
      season,
      lastSeen: todayJst,
      streak,
      reportedOn,
    });
  }

  return { upserts, confirmed };
}
