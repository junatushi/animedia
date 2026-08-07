// ───────────────────────────────────────────────────────────────
// 「選んだ作品を全部見るには、どの配信サービスに入れば足りるか」を求める。
//
// なぜ作るか（2026-08-07）:
//   このサイトは「その作品がどこで見られるか」には答えるが、利用者が実際に迫られる
//   判断は「**結局どれに入ればいいのか**」という組み合わせのほう。dアニメストアが
//   74〜82%をカバーする世界では作品単位の答えはほぼ同じになり、差がつくのは
//   「自分が見る5〜10本」をまとめて見たときだけ。ここは実データを持っていないと
//   計算できないので、静的な「おすすめVOD比較」記事では原理的に埋められない。
//
//   さらに、VOD比較アフィリエイトサイトは収益が契約数に比例するため
//   **「最小の組み合わせ」を教える動機を持たない**。利用者の利益と自分の収益が
//   一致する側に立てる、数少ない機能になる。
//
// 【この計算が答えないこと】
//   ここで言う「見られる」は、Annictに**配信の記録がある**という意味でしかない。
//   過去クールの作品について「いま配信されている」ことは保証しない
//   （lib/workAvailability.ts と同じ扱い。Annictは配信終了を記録しない）。
//   表示する側は「配信情報がある」までに留めること。
//
// 【料金は扱わない】月額料金は改定されるので、一次情報＋確認日の維持が必要になる。
//   いまは本数と組み合わせだけを出す（2026-08-07・利用者の判断）。
//
// 拡張子つき import を持たない素の .ts なのは `node scripts/check.ts` から
// 直接読めるようにするため（lib/personIndex.ts・lib/calendar.ts と同じ）。
// ───────────────────────────────────────────────────────────────

export interface PlanService {
  key: string;
  short: string;
}

export interface PlanWork {
  id: number;
  title: string;
  /** その作品を見られる配信サービス（レンタル/都度課金を除いた見放題のみを渡すこと） */
  services: PlanService[];
}

export interface ServicePlan {
  /** 選ばれた作品数 */
  selected: number;
  /** 配信情報がある作品数（= 組み合わせの対象） */
  covered: number;
  /** 配信情報が無く、どのサービスを選んでも埋められない作品 */
  uncovered: { id: number; title: string }[];
  /** 全部を満たすのに必要な最小のサービス数（対象0件なら0） */
  minCount: number;
  /** 最小サービス数を満たす組み合わせ（最大 MAX_COMBOS 件） */
  combos: PlanService[][];
}

/** 提示する組み合わせの上限。同数の解が多数あっても選択肢を出しすぎない。 */
export const MAX_COMBOS = 3;

/**
 * 最小のサービス組み合わせを求める（集合被覆の厳密解）。
 *
 * 総当たり（2^サービス数）はやらない。「まだ見られない作品のうち、**選択肢が
 * 最も少ない作品**」を1つ選び、その作品を見られるサービスだけに分岐する、という
 * 探索にしてある。必ずどれか1つは選ぶ必要があるので解を落とさず、分岐の幅が
 * サービス総数ではなく「その作品を配信している社数」に抑えられる。
 * 深さを1つずつ増やす反復深化なので、最初に見つかった深さが最小である
 * ことが保証される（貪欲法の近似ではない）。
 */
export function buildServicePlan(works: PlanWork[]): ServicePlan {
  const uncovered: { id: number; title: string }[] = [];
  const target: PlanWork[] = [];
  for (const w of works) {
    if (w.services.length === 0) uncovered.push({ id: w.id, title: w.title });
    else target.push(w);
  }

  const plan: ServicePlan = {
    selected: works.length,
    covered: target.length,
    uncovered,
    minCount: 0,
    combos: [],
  };
  if (target.length === 0) return plan;

  // サービスキー → そのサービスで見られる作品の添字。
  // 表示名はキーごとに1つに揃える（同じキーなら短縮名も同じ）。
  const byService = new Map<string, { service: PlanService; works: Set<number> }>();
  target.forEach((w, i) => {
    for (const s of w.services) {
      let e = byService.get(s.key);
      if (!e) {
        e = { service: { key: s.key, short: s.short }, works: new Set<number>() };
        byService.set(s.key, e);
      }
      e.works.add(i);
    }
  });

  // 分岐の順番を決めておく（カバー数の多い順）。最小数の解が複数あるとき、
  // 「より多くの作品を1社でまかなえる」組み合わせが先に出るようにするため。
  const services = [...byService.values()].sort(
    (a, b) => b.works.size - a.works.size || (a.service.key < b.service.key ? -1 : 1)
  );

  const allIdx = target.map((_, i) => i);
  const found: PlanService[][] = [];
  const seen = new Set<string>();

  function search(remaining: number[], chosen: string[], limit: number): void {
    if (found.length >= MAX_COMBOS) return;
    if (remaining.length === 0) {
      const sorted = [...chosen].sort();
      const sig = sorted.join("|");
      if (seen.has(sig)) return;
      seen.add(sig);
      found.push(chosen.map((k) => byService.get(k)!.service));
      return;
    }
    if (chosen.length >= limit) return;

    // 残っている作品のうち、配信社数が最も少ないものを起点にする。
    // そこを埋められるサービスは限られるので、分岐が最小になる。
    let pivot = remaining[0];
    let pivotOptions = countOptions(pivot, chosen);
    for (const i of remaining) {
      const n = countOptions(i, chosen);
      if (n < pivotOptions) {
        pivot = i;
        pivotOptions = n;
      }
    }

    for (const { service, works: covers } of services) {
      if (chosen.includes(service.key)) continue;
      if (!covers.has(pivot)) continue;
      const next = remaining.filter((i) => !covers.has(i));
      search(next, [...chosen, service.key], limit);
      if (found.length >= MAX_COMBOS) return;
    }
  }

  function countOptions(workIdx: number, chosen: string[]): number {
    let n = 0;
    for (const { service, works: covers } of services) {
      if (chosen.includes(service.key)) continue;
      if (covers.has(workIdx)) n++;
    }
    return n;
  }

  // 反復深化。最初に解が出た深さが最小サービス数。
  for (let limit = 1; limit <= services.length; limit++) {
    search(allIdx, [], limit);
    if (found.length > 0) {
      // limit ではなく実際の解の長さを使う（limit は上限でしかない）。
      plan.minCount = found[0].length;
      plan.combos = found;
      break;
    }
  }

  return plan;
}
