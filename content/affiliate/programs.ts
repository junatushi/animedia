// ───────────────────────────────────────────────────────────────
// アフィリエイトプログラムの登録データ（人力更新）
//   ・各配信サービスに対して、提携済みASPのリンクと報酬額を登録する。
//   ・表示時は「active かつ rewardYen が最大」のリンクが自動採用される
//     （同額なら confirmedDate が新しい方。ロジックは lib/affiliate.ts）。
//   ・報酬額はASP管理画面（ログイン制）でしか確認できないため、月1回の
//     定期確認で rewardYen / confirmedDate を更新する。更新すればリンクの
//     切り替えは自動。運用手順は docs/affiliate-setup.md。
//   ・未登録・全て inactive のサービスはCTA自体が表示されない（サイトの
//     見た目は従来のまま）。
// ───────────────────────────────────────────────────────────────
import type { ServiceKey } from "@/lib/services";

export interface AffiliateProgram {
  /** ASP名（例: "A8.net" | "afb" | "バリューコマース" | "アクセストレード" | "ドコモアフィリエイト" | "Amazonアソシエイト"） */
  asp: string;
  /** ASP管理画面で発行されたアフィリエイトリンク */
  url: string;
  /** 成果1件あたりの報酬額（円）。この値が最大のリンクが自動採用される */
  rewardYen: number;
  /** 税込/税抜と成果条件のメモ（例: "税込・無料トライアル登録"） */
  rewardNote?: string;
  /** 報酬額をASP管理画面で確認した日（"YYYY-MM-DD"） */
  confirmedDate: string;
  /** 提携終了・案件停止時に false（即座に次候補へ切替 or 非表示） */
  active: boolean;
}

// 提携承認が下りたサービスから順に追記していく。記入例:
// unext: [
//   { asp: "A8.net", url: "https://px.a8.net/svt/ejp?a8mat=XXXXX", rewardYen: 1430, rewardNote: "税込・無料トライアル登録", confirmedDate: "2026-07-20", active: true },
//   { asp: "バリューコマース", url: "https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=XXXX&pid=XXXX", rewardYen: 1320, rewardNote: "税込・無料トライアル登録", confirmedDate: "2026-07-20", active: true },
// ],
export const AFFILIATE_PROGRAMS: Partial<Record<ServiceKey, AffiliateProgram[]>> = {};
