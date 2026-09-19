// アフィリエイトリンクの自動選択ロジック。
// 同じサービスに複数ASPのリンクが登録されている場合、その時点で報酬額
// （content/affiliate/programs.ts の rewardYen）が最大の active なリンクを使う。
// データを更新するだけで採用リンクが切り替わる設計（コード変更不要）。
import { AFFILIATE_PROGRAMS, type AffiliateProgram } from "@/content/affiliate/programs";
import type { ServiceKey } from "@/lib/services";

// 広告の開示文（.svc-disclosure）を出してよいかの判定。
// 一覧画面は ServiceMarks を hideDisclosure 付きで呼び、開示文を画面につき1回だけ
// 呼び出し側が出す責任を負っている。そこが無条件だと、全リンクを止めた日に
// 「広告リンクが含まれます」という**事実でない記述だけが残る**（2026-09-09に実際に
// この状態になりかけた）。ステマ規制の要求は「広告なのに広告と分からないこと」を
// 防ぐことなので、広告が無いときに広告だと書くのは要求を満たすどころか嘘になる。
export function hasAnyActiveAffiliate(): boolean {
  return Object.values(AFFILIATE_PROGRAMS).some((list) => list?.some((p) => p.active));
}

export function pickAffiliate(serviceKey: string): AffiliateProgram | null {
  const list = AFFILIATE_PROGRAMS[serviceKey as ServiceKey];
  if (!list || list.length === 0) return null;
  const candidates = list.filter((p) => p.active);
  if (candidates.length === 0) return null;
  // 報酬額が最大のものを採用。同額なら確認日が新しい方（情報の鮮度を優先）。
  return candidates.reduce((best, p) =>
    p.rewardYen > best.rewardYen ||
    (p.rewardYen === best.rewardYen && p.confirmedDate > best.confirmedDate)
      ? p
      : best
  );
}
