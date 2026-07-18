// アフィリエイトリンクの自動選択ロジック。
// 同じサービスに複数ASPのリンクが登録されている場合、その時点で報酬額
// （content/affiliate/programs.ts の rewardYen）が最大の active なリンクを使う。
// データを更新するだけで採用リンクが切り替わる設計（コード変更不要）。
import { AFFILIATE_PROGRAMS, type AffiliateProgram } from "@/content/affiliate/programs";
import type { ServiceKey } from "@/lib/services";

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
